import { App, TFile, Notice, parseYaml } from 'obsidian';
import { GhostAPIClient } from '../ghost/api-client';
import { GhostWriterSettings, GhostPost } from '../types';
import { parseGhostMetadata, extractContent, updateFrontmatterWithGhostId, updateFrontmatterWithGhostUrl, upsertGhostMetadata, splitFrontmatter, joinFrontmatter } from '../frontmatter-parser';
import { generateSlug, normalizePaywallMarker } from '../converters/markdown-to-html';
import { htmlToMarkdown } from '../converters/html-to-markdown';
import { markdownToLexical } from '../converters/markdown-to-lexical';
import { processPostImages } from '../ghost/image-uploader';

/**
 * Sync Engine - Handles synchronization from Obsidian to Ghost
 */
export class SyncEngine {
	private app: App;
	private settings: GhostWriterSettings;
	private imageCache: Record<string, string>;
	private saveImageCache?: () => Promise<void>;
	public onStatusChange?: (status: 'idle' | 'syncing' | 'success' | 'error', message?: string) => void;

	// The blog a sync currently targets. The plugin points this at the right blog
	// before each sync, so one note can be published to several blogs in turn.
	private ghostClient: GhostAPIClient;     // active blog's API client
	private activeBaseUrl: string;           // active blog's site URL
	private activeFolder: string;            // active blog's vault folder
	private writeBack = true;                // write ghost_id/url back? (off for multi-blog)

	constructor(
		app: App,
		settings: GhostWriterSettings,
		ghostClient: GhostAPIClient,
		imageCache: Record<string, string>,
		saveImageCache?: () => Promise<void>
	) {
		this.app = app;
		this.settings = settings;
		this.ghostClient = ghostClient;
		this.imageCache = imageCache;
		this.saveImageCache = saveImageCache;
		this.activeBaseUrl = settings.ghostUrl;
		this.activeFolder = settings.syncFolder;
	}

	/**
	 * Point the engine at a specific blog before a sync. `writeBack` controls
	 * whether ghost_id/url/public_url are written back to the note — enabled for a
	 * single-blog note (robust id tracking), disabled for multi-blog notes (each
	 * blog is matched by slug instead, so per-blog ids don't collide in one note).
	 */
	setActiveBlog(client: GhostAPIClient, baseUrl: string, folder: string, writeBack: boolean): void {
		this.ghostClient = client;
		this.activeBaseUrl = baseUrl;
		this.activeFolder = folder;
		this.writeBack = writeBack;
	}

	/**
	 * Seed a note from an existing Ghost post matched by slug (Ghost → Obsidian).
	 *
	 * Looks up the post with the given slug, converts its content to markdown, and
	 * writes the post's metadata + body into the note (preserving any non-Ghost
	 * frontmatter keys). This records `ghost_id`, so subsequent syncs push in place.
	 * Returns false if no post with that slug exists.
	 */
	async seedNoteFromGhostBySlug(file: TFile, slug: string): Promise<boolean> {
		const post = await this.ghostClient.getPostBySlug(slug);
		if (!post) {
			new Notice(`No Ghost post found with slug "${slug}"`);
			return false;
		}

		const prefix = this.settings.yamlPrefix;
		const baseUrl = this.activeBaseUrl.replace(/\/$/, '');
		const ghostEditorUrl = `${baseUrl}/ghost/#/editor/post/${post.id}`;
		const isPublic = post.status === 'published' || post.status === 'scheduled';

		const tags = (post.tags ?? []).map(t => t.name);
		const tagsYaml = tags.length > 0 ? `[${tags.map(t => `"${t}"`).join(', ')}]` : '[]';

		const ghostFields: Record<string, string> = {
			post_access: post.visibility ?? 'public',
			published: isPublic ? 'true' : 'false',
			published_at: `"${post.published_at ?? ''}"`,
			featured: post.featured ? 'true' : 'false',
			tags: tagsYaml,
			excerpt: `"${post.excerpt ?? ''}"`,
			feature_image: `"${post.feature_image ?? ''}"`,
			no_sync: 'false',
			id: post.id,
			slug: post.slug,
			url: ghostEditorUrl
		};
		if (isPublic && post.url) {
			ghostFields.public_url = post.url;
		}

		let content = await this.app.vault.read(file);
		content = upsertGhostMetadata(content, ghostFields, prefix);

		// Replace the body with the Ghost post content (HTML → Markdown).
		// Note: Ghost stores Lexical; this conversion is a close approximation.
		const title = post.title || 'Untitled Post';
		const bodyMarkdown = htmlToMarkdown(post.html ?? '');
		const parsed = splitFrontmatter(content);
		content = parsed
			? joinFrontmatter(parsed.raw, `\n# ${title}\n\n${bodyMarkdown}`)
			: `# ${title}\n\n${bodyMarkdown}`;

		await this.app.vault.modify(file, content);
		if (this.settings.showSyncNotifications) {
			new Notice(`Seeded from Ghost: "${title}"`);
		}
		console.debug(`[Ghost Sync] Seeded note from Ghost post ${post.id} (slug '${slug}')`);
		return true;
	}

	/**
	 * Sync a single file to Ghost
	 */
	async syncFileToGhost(file: TFile): Promise<boolean> {
		try {
			// Read file content
			const content = await this.app.vault.read(file);

			// Parse frontmatter - need to wait for cache to be ready
			let cache = this.app.metadataCache.getFileCache(file);

			// If cache is not ready, wait a bit
			if (!cache) {
				await new Promise(resolve => activeWindow.setTimeout(resolve, 100));
				cache = this.app.metadataCache.getFileCache(file);
			}

			if (!cache?.frontmatter) {
				// Silently skip files without frontmatter (not an error)
				return false;
			}

			// Combine the on-disk frontmatter with the metadata cache. The cache
			// reflects edits made in the Properties UI immediately (which can happen
			// before the file is flushed to disk on mobile), so it wins for the fields
			// it has; the on-disk frontmatter fills in anything the cache lacks (e.g.
			// right after a plugin reload, which also recovers `ghost_id`). This makes
			// frontmatter-only changes take effect on sync without a body edit.
			let diskFm: Record<string, unknown> = {};
			const fmParsed = splitFrontmatter(content);
			if (fmParsed) {
				try {
					const d = parseYaml(fmParsed.raw) as unknown;
					if (d && typeof d === 'object') diskFm = d as Record<string, unknown>;
				} catch (e) {
					console.debug('[Ghost Sync] Disk frontmatter parse failed:', e);
				}
			}
			const cacheFm = (cache.frontmatter ?? {}) as Record<string, unknown>;
			const frontmatterObj: Record<string, unknown> = { ...diskFm, ...cacheFm };

			const metadata = parseGhostMetadata(frontmatterObj, this.settings.yamlPrefix);
			if (!metadata) {
				// Silently skip files without Ghost properties (not an error)
				return false;
			}

			// Check if sync is disabled
			if (metadata.no_sync) {
				return false;
			}

			const resolvedGhostId = metadata.ghost_id;
			const explicitSlug = metadata.slug;

			// Log that we're starting sync
			console.debug(`[Ghost Sync] Starting sync for ${file.path}`);
			this.onStatusChange?.('syncing', 'Syncing...');

			// Extract markdown content (without frontmatter)
			const rawMarkdown = extractContent(content);

			// Auto-seed: if g_slug is set, there is no ghost_id yet, and the note has
			// no body, pull the existing Ghost post INTO the note (Ghost → Obsidian)
			// instead of pushing an empty note over the live post.
			if (explicitSlug && !resolvedGhostId && rawMarkdown.trim() === '') {
				console.debug('[Ghost Sync] Empty note with explicit slug — seeding from Ghost instead of publishing');
				const seeded = await this.seedNoteFromGhostBySlug(file, explicitSlug);
				this.onStatusChange?.(seeded ? 'success' : 'idle', seeded ? 'Seeded from Ghost' : undefined);
				return seeded;
			}

			const baseMarkdown = normalizePaywallMarker(rawMarkdown);

			// Upload local images to Ghost and rewrite their references to the
			// uploaded URLs. The cover-swallow (first image becomes the feature image
			// and is removed from the body) only happens when the note opts in via
			// `cover_from_first_image` AND has no explicit feature image set.
			const hasExplicitFeature = !!(metadata.feature_image && metadata.feature_image.trim());
			const swallowCover = metadata.cover_from_first_image && !hasExplicitFeature;
			const { markdown: markdownContent, coverImageUrl, cacheUpdated } = await processPostImages(
				this.app,
				this.ghostClient,
				baseMarkdown,
				file,
				swallowCover,
				this.imageCache
			);
			if (cacheUpdated) {
				await this.saveImageCache?.();
			}
			console.debug('[Ghost Sync] Markdown content length:', markdownContent.length);
			console.debug('[Ghost Sync] Cover image (swallowed):', coverImageUrl);

			// Convert to Lexical format (Ghost's editor format)
			const lexical = markdownToLexical(markdownContent);
			console.debug('[Ghost Sync] Lexical length:', lexical.length);
			console.debug('[Ghost Sync] Lexical preview:', lexical.substring(0, 200));

			// Title: use the first H1 heading if present, otherwise the note's
			// filename. Do NOT fall back to the first body line — for a note with no
			// heading that would be a whole paragraph, producing an over-long title
			// and slug (Ghost rejects slugs over 191 chars).
			const h1 = markdownContent.match(/^#\s+(.+)$/m);
			let title = (h1 ? h1[1].trim() : '') || file.basename;
			title = title.slice(0, 255);
			console.debug('[Ghost Sync] Extracted title:', title);

			// Generate or use existing slug — cap at Ghost's 191-character limit.
			const slug = (metadata.slug || generateSlug(title)).slice(0, 191);
			console.debug('[Ghost Sync] Slug:', slug);

			// Determine status based on g_published and g_published_at
			//
			// g_published_at is used ONLY for scheduling (future date). When a
			// scheduled post's date has passed, we do NOT re-send published_at so
			// Ghost preserves its actual publication timestamp instead of
			// overwriting it with the original scheduling date.
			//
			// Rules:
			//   g_published: false                         → draft (ignore g_published_at)
			//   g_published: true, no g_published_at       → publish now (no published_at sent)
			//   g_published: true, g_published_at in future → schedule (send published_at)
			//   g_published: true, g_published_at in past   → publish now (do NOT send
			//       published_at — let Ghost keep its real publication timestamp)
			let status: 'draft' | 'published' | 'scheduled' = 'draft';
			let publishedAt: string | undefined;

			if (metadata.published) {
				if (metadata.published_at) {
					const scheduledDate = new Date(metadata.published_at);
					const now = new Date();

					if (scheduledDate > now) {
						// Future date → schedule the post
						status = 'scheduled';
						publishedAt = scheduledDate.toISOString();
						console.debug('[Ghost Sync] Scheduling post for:', publishedAt);
					} else {
						// Past date → scheduling window passed; publish now without
						// overwriting Ghost's real publication timestamp.
						status = 'published';
						publishedAt = undefined;
						console.debug('[Ghost Sync] Scheduled date is in the past — publishing now without custom published_at');
					}
				} else {
					// No scheduling date → publish immediately
					status = 'published';
					console.debug('[Ghost Sync] Publishing post immediately');
				}
			} else {
				// g_published is false, keep as draft regardless of date
				console.debug('[Ghost Sync] Keeping post as draft (g_published: false)');
			}

			console.debug('[Ghost Sync] Final status:', status);

			// Prepare Ghost post data
			const postData: Record<string, unknown> = {
				title,
				lexical,
				status,
				visibility: metadata.post_access,
				featured: metadata.featured,
				slug
			};

			// Add published_at only when scheduling (future date).
			// Never sent for already-published posts to avoid overwriting Ghost's
			// real publication timestamp with the original scheduling date.
			if (publishedAt) {
				postData.published_at = publishedAt;
			}

			// Add optional fields — send null to explicitly clear values in Ghost.
			// NOTE: the writable excerpt field in the Ghost Admin API is
			// `custom_excerpt` (max 300 chars); `excerpt` is read-only and sending a
			// non-empty value to it triggers a validation error.
			postData.custom_excerpt = (metadata.excerpt || '').slice(0, 300) || null;
			postData.feature_image = metadata.feature_image || coverImageUrl || null;
			if (metadata.tags.length > 0) {
				postData.tags = metadata.tags.map(name => ({ name }));
			}

			// Debug logging
			console.debug('[Ghost Sync] Post data to send:', {
				title,
				lexical: lexical.substring(0, 200) + '...',
				lexicalLength: lexical.length,
				excerpt: metadata.excerpt,
				tags: metadata.tags,
				status,
				published_at: publishedAt,
				visibility: metadata.post_access,
				featured: metadata.featured,
				slug
			});

			// Resolve the target post. `ghost_id` is the stable updater once a post
			// has been published from this note. As a fallback, adopt an existing
			// post by slug — but ONLY when the slug is set explicitly via frontmatter
			// (g_slug). Auto-derived (title-based) slugs are never used for adoption,
			// so a new note whose title happens to collide with an existing post can
			// never silently overwrite it.
			let targetId = resolvedGhostId;
			if (!targetId && explicitSlug) {
				const existing = await this.ghostClient.getPostBySlug(explicitSlug);
				if (existing) {
					targetId = existing.id;
					console.debug(`[Ghost Sync] Existing post with explicit slug '${explicitSlug}' found (${targetId}); updating instead of creating`);
				}
			}

			let ghostPost: GhostPost;
			if (targetId) {
				// Update existing post (matched by ghost_id or adopted via slug)
				console.debug(`[Ghost Sync] Updating post ${targetId}`);
				ghostPost = await this.ghostClient.updatePost(targetId, postData);
				if (this.settings.showSyncNotifications) {
					new Notice(`Updated in ghost: ${title}`);
				}
				console.debug(`[Ghost Sync] Updated: ${title}`);

				// Persist identifiers back to frontmatter. After adopting a post by
				// slug (no ghost_id yet) record the id; for a published or scheduled
				// post, also record its public URL just below the editor URL.
				const publicUrl = (status === 'published' || status === 'scheduled') ? (ghostPost.url || undefined) : undefined;
				const needsId = !resolvedGhostId;
				const needsUrl = !metadata.ghost_url;
				const needsPublic = !!publicUrl && metadata.public_url !== publicUrl;
				if (this.writeBack && (needsId || needsUrl || needsPublic)) {
					const baseUrl = this.activeBaseUrl.replace(/\/$/, '');
					const ghostEditorUrl = `${baseUrl}/ghost/#/editor/post/${targetId}`;
					let updatedContent = content;
					if (needsId) {
						updatedContent = updateFrontmatterWithGhostId(updatedContent, ghostPost.id, ghostPost.slug, this.settings.yamlPrefix);
					}
					updatedContent = updateFrontmatterWithGhostUrl(updatedContent, ghostEditorUrl, this.settings.yamlPrefix, publicUrl);
					await this.app.vault.modify(file, updatedContent);
					console.debug('[Ghost Sync] Frontmatter updated with Ghost id/url/public_url');
				}
			} else {
				// Create new post
				console.debug('[Ghost Sync] Creating new post');
				ghostPost = await this.ghostClient.createPost(postData);
				if (this.settings.showSyncNotifications) {
					new Notice(`Created in ghost: ${title}`);
				}
				console.debug(`[Ghost Sync] Created: ${title}`, ghostPost);

				// Write the identifiers back immediately. A re-sync now reads
				// `ghost_id` from disk and updates in place, so this no longer needs a
				// delay to avoid a duplicate — and it makes the public URL available
				// right after publishing (e.g. for the properties modal).
				if (this.writeBack) {
					const capturedGhostPost = ghostPost;
					const baseUrl = this.activeBaseUrl.replace(/\/$/, '');
					const ghostEditorUrl = `${baseUrl}/ghost/#/editor/post/${capturedGhostPost.id}`;
					const publicUrl = (status === 'published' || status === 'scheduled') ? (capturedGhostPost.url || undefined) : undefined;
					let updatedContent = updateFrontmatterWithGhostId(
						content,
						capturedGhostPost.id,
						capturedGhostPost.slug,
						this.settings.yamlPrefix
					);
					updatedContent = updateFrontmatterWithGhostUrl(updatedContent, ghostEditorUrl, this.settings.yamlPrefix, publicUrl);
					await this.app.vault.modify(file, updatedContent);
					console.debug('[Ghost Sync] Frontmatter updated with Ghost ID, editor URL, public URL');
				}
			}

			// Update last sync time
			this.settings.lastSync = Date.now();

			this.onStatusChange?.('success', `Synced: ${title}`);
			return true;
		} catch (error) {
			console.error(`[Ghost Sync] Error syncing ${file.path}:`, error);
			if (this.settings.showSyncNotifications) {
				new Notice(`Failed to sync ${file.name}: ${(error as Error).message}`);
			}
			this.onStatusChange?.('error', `Error: ${(error as Error).message}`);
			return false;
		}
	}

	/**
	 * Sync all files in sync folder
	 */
	async syncAllFiles(): Promise<{ success: number; failed: number }> {
		const results = { success: 0, failed: 0 };

		try {
			// Get all files in sync folder
			const syncFolder = this.app.vault.getAbstractFileByPath(this.activeFolder);
			if (!syncFolder) {
				new Notice(`Sync folder not found: ${this.activeFolder}`);
				return results;
			}

			// Get all markdown files recursively
			const files = this.app.vault.getMarkdownFiles().filter(file =>
				file.path.startsWith(this.activeFolder)
			);

			if (files.length === 0) {
				new Notice('No files to sync');
				return results;
			}

			new Notice(`Syncing ${files.length} file(s)...`);

			// Sync each file
			for (const file of files) {
				const success = await this.syncFileToGhost(file);
				if (success) {
					results.success++;
				} else {
					results.failed++;
				}
			}

			new Notice(`Sync complete: ${results.success} succeeded, ${results.failed} skipped/failed`);
		} catch (error) {
			console.error('[Ghost Sync] Error in syncAllFiles:', error);
			new Notice(`Sync failed: ${(error as Error).message}`);
		}

		return results;
	}

	/**
	 * Delete the Ghost post associated with a deleted Obsidian note.
	 * Only acts if the file has a ghost_id in its frontmatter.
	 */
	async deletePostForFile(file: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		if (!frontmatter) return;

		const postId = frontmatter[`${this.settings.yamlPrefix}id`] as string | undefined;
		if (!postId) return;

		await this.ghostClient.deletePost(postId);
		new Notice(`Post deletado no Ghost: "${file.basename}"`);
	}

	/**
	 * Check if file should be synced
	 */
	shouldSyncFile(file: TFile): boolean {
		// Must be in sync folder
		if (!file.path.startsWith(this.activeFolder)) {
			return false;
		}

		// Must be markdown
		if (file.extension !== 'md') {
			return false;
		}

		return true;
	}
}
