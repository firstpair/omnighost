import { App, TFile, Notice, parseYaml } from 'obsidian';
import { GhostAPIClient } from '../ghost/api-client';
import { GhostWriterSettings, GhostPost, GhostPostWrite } from '../types';
import { parseGhostMetadata, extractContent, updateFrontmatterWithGhostId, updateFrontmatterWithGhostUrl, upsertGhostMetadata, splitFrontmatter, joinFrontmatter, yamlString, yamlStringArray } from '../frontmatter-parser';
import { generateSlug, normalizePaywallMarker } from '../converters/markdown-to-html';
import { htmlToMarkdown } from '../converters/html-to-markdown';
import { markdownToLexical } from '../converters/markdown-to-lexical';
import { processPostImages } from '../ghost/image-uploader';
import { buildGhostEditorUrl, ghostHostname, normalizeGhostSiteUrl } from '../ghost/url';
import { analyzeTitleSources, resolvePrimaryTitle, updateSecondaryTitle } from '../title-policy';
import { preparePublicationProvenance, stripRenderedPublicationProvenanceHtml } from '../versioning/publication-provenance';
import type { NoteVersionResult } from '../versioning/note-version';

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
	private activeKnownId?: string;          // known post id on the active blog (multi-blog)
	private activeBlogName = '';             // active blog's name (for error messages)
	/** The post produced by the last syncFileToGhost call (for per-blog id/URL tracking). */
	lastSyncedPost: GhostPost | null = null;

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
		this.activeBaseUrl = normalizeGhostSiteUrl(settings.ghostUrl);
		this.activeFolder = settings.syncFolder;
	}

	/**
	 * Point the engine at a specific blog before a sync. `writeBack` controls
	 * whether ghost_id/url/public_url are written back to the note — enabled for a
	 * single-blog note (robust id tracking), disabled for multi-blog notes (each
	 * blog is matched by slug instead, so per-blog ids don't collide in one note).
	 */
	setActiveBlog(client: GhostAPIClient, baseUrl: string, folder: string, writeBack: boolean, knownId?: string, blogName = ''): void {
		this.ghostClient = client;
		this.activeBaseUrl = normalizeGhostSiteUrl(baseUrl);
		this.activeFolder = folder;
		this.writeBack = writeBack;
		this.activeKnownId = knownId;
		this.activeBlogName = blogName;
	}

	private activeBlogKeySuffix(): string {
		const base = ghostHostname(this.activeBaseUrl) || this.activeBlogName;
		return base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'blog';
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
		const ghostEditorUrl = buildGhostEditorUrl(this.activeBaseUrl, post.id);
		const blogSuffix = this.activeBlogKeySuffix();
		const isPublic = post.status === 'published' || post.status === 'scheduled';

		const tags = (post.tags ?? []).map(t => t.name);
		const tagsYaml = yamlStringArray(tags, true);

		const ghostFields: Record<string, string> = {
			post_access: post.visibility ?? 'public',
			published: isPublic ? 'true' : 'false',
			published_at: yamlString(post.published_at ?? '', true),
			featured: post.featured ? 'true' : 'false',
			tags: tagsYaml,
			excerpt: yamlString(post.excerpt ?? '', true),
			feature_image: yamlString(post.feature_image ?? '', true),
			no_sync: 'false',
			slug: yamlString(post.slug, true),
			[`id_${blogSuffix}`]: post.id,
			[`url_${blogSuffix}`]: ghostEditorUrl
		};
		if (isPublic && post.url) {
			ghostFields[`public_url_${blogSuffix}`] = post.url;
		}

		// Replace the body with the Ghost post content (HTML → Markdown).
		// Note: Ghost stores Lexical; this conversion is a close approximation.
		const title = post.title || 'Untitled Post';
		const bodyMarkdown = htmlToMarkdown(stripRenderedPublicationProvenanceHtml(post.html ?? ''));
		await this.app.vault.process(file, (raw) => {
			const content = upsertGhostMetadata(raw, ghostFields, prefix);
			const parsed = splitFrontmatter(content);
			return parsed
				? joinFrontmatter(parsed.raw, `\n# ${title}\n\n${bodyMarkdown}`)
				: `# ${title}\n\n${bodyMarkdown}`;
		});
		if (this.settings.showSyncNotifications) {
			new Notice(`Seeded from Ghost: "${title}"`);
		}
		console.debug(`[Ghost Sync] Seeded note from Ghost post ${post.id} (slug '${slug}')`);
		return true;
	}

	/**
	 * Sync a single file to Ghost
	 */
	async syncFileToGhost(
		file: TFile,
		noteVersion?: NoteVersionResult,
		sourceContent?: string,
		expectedAssetSha256?: ReadonlyMap<string, string>
	): Promise<boolean> {
		this.lastSyncedPost = null;
		try {
			// Read file content
			const hasFrozenSource = sourceContent !== undefined;
			const content = sourceContent ?? await this.app.vault.read(file);

			// A caller-provided source is a frozen publication snapshot: its body and
			// frontmatter must stay paired with the Git commit made for those bytes.
			// Without a frozen source, merge in the metadata cache so Properties edits
			// that have not yet flushed to disk still take effect on direct engine use.
			let diskFm: Record<string, unknown> = {};
			const fmParsed = splitFrontmatter(content);
			if (fmParsed) {
				try {
					const d = parseYaml(fmParsed.raw) as unknown;
					if (d && typeof d === 'object') diskFm = d as Record<string, unknown>;
				} catch (e) {
					console.debug('[Ghost Sync] Disk frontmatter parse failed:', e);
					throw new Error('Frontmatter YAML is invalid. Fix the red properties before syncing.');
				}
			}
			let frontmatterObj = diskFm;
			if (!hasFrozenSource) {
				let cache = this.app.metadataCache.getFileCache(file);
				if (!cache) {
					await new Promise(resolve => activeWindow.setTimeout(resolve, 100));
					cache = this.app.metadataCache.getFileCache(file);
				}
				const cacheFm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
				frontmatterObj = { ...diskFm, ...cacheFm };
			}

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
			if (this.writeBack && explicitSlug && !resolvedGhostId && rawMarkdown.trim() === '') {
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
				this.imageCache,
				expectedAssetSha256
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

			// Title: use the configured primary source, then fall back to the other
			// title slot and finally the note filename. Do NOT fall back to the first
			// body line — Ghost rejects over-long accidental titles/slugs.
			const titleAnalysis = analyzeTitleSources(content, file.basename);
			let title = resolvePrimaryTitle(titleAnalysis, this.settings.syncTitleSource);
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

			// Prepare the complete set of fields Omnighost manages. Empty tags and
			// nullable fields are sent explicitly so removals are real changes.
			// Ghost's writable excerpt field is `custom_excerpt`; `excerpt` is read-only.
			const postData: GhostPostWrite = {
				title,
				lexical,
				status,
				visibility: metadata.post_access,
				featured: metadata.featured,
				slug,
				custom_excerpt: (metadata.excerpt || '').slice(0, 300) || null,
				feature_image: metadata.feature_image || coverImageUrl || null,
				tags: metadata.tags.map(name => ({ name })),
				codeinjection_head: null
			};

			// Add published_at only when scheduling (future date).
			// Never sent for already-published posts to avoid overwriting Ghost's
			// real publication timestamp with the original scheduling date.
			if (publishedAt) {
				postData.published_at = publishedAt;
			}

			const preparedProvenance = await preparePublicationProvenance(
				postData,
				status === 'draft' ? 'hidden' : this.settings.publicationProvenanceVisibility,
				noteVersion?.kind === 'git'
					? { gitCommit: noteVersion.commit }
					: {}
			);
			postData.lexical = preparedProvenance.lexical;
			postData.codeinjection_head = preparedProvenance.hiddenBlock;

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
			// Rely on a known ghost_id if we have one, else the slug. For a multi-blog
			// note the per-blog id is supplied (activeKnownId); for a single-blog note
			// we use the note's own ghost_id. The slug fallback finds an existing post
			// on the active blog when there is no id yet.
			let targetId = this.activeKnownId || (this.writeBack ? resolvedGhostId : undefined);
			if (!targetId && slug) {
				const existing = await this.ghostClient.getPostBySlug(slug);
				if (existing) {
					targetId = existing.id;
					console.debug(`[Ghost Sync] Existing post with slug '${slug}' found (${targetId}); updating instead of creating`);
				}
			}

			let ghostPost: GhostPost;
			let outcomeMessage = `Synced: ${title}`;
			if (targetId) {
				// Update existing post (matched by ghost_id or adopted via slug)
				console.debug(`[Ghost Sync] Updating post ${targetId}`);
				const updateResult = await this.ghostClient.updatePost(targetId, postData, {
					visibility: status === 'draft' ? 'hidden' : this.settings.publicationProvenanceVisibility,
					verifyRemoteContent: this.settings.verifyGhostContentOnSync,
					allowedExistingGitCommit: noteVersion?.kind === 'git'
						? noteVersion.previousNoteCommit
						: undefined
				});
				ghostPost = updateResult.post;
				const blogName = this.activeBlogName || ghostHostname(this.activeBaseUrl) || 'Ghost';
				if (this.settings.showSyncNotifications) {
					if (updateResult.changed) {
						const label = this.activeBlogName ? `blog ${this.activeBlogName}` : 'in ghost';
						new Notice(`Updated ${label}: ${title}`);
					} else {
						new Notice(`Unchanged ${file.basename} in blog ${blogName}`);
					}
				}
				if (updateResult.changed) {
					console.debug(`[Ghost Sync] Updated: ${title}`);
				} else {
					outcomeMessage = `Unchanged ${file.basename} in blog ${blogName}`;
					console.debug(`[Ghost Sync] ${outcomeMessage}`);
				}

				// Persist identifiers back to frontmatter. After adopting a post by
				// slug (no ghost_id yet) record the id; for a published or scheduled
				// post, also record its public URL just below the editor URL.
				const publicUrl = (status === 'published' || status === 'scheduled') ? (ghostPost.url || undefined) : undefined;
				const ownsClean = !resolvedGhostId || resolvedGhostId === targetId;
				const needsId = !resolvedGhostId;
				const needsUrl = !metadata.ghost_url;
				const needsPublic = !!publicUrl && metadata.public_url !== publicUrl;
				if (this.writeBack && ownsClean && (needsId || needsUrl || needsPublic)) {
					const ghostEditorUrl = buildGhostEditorUrl(this.activeBaseUrl, targetId);
					const syncedPost = ghostPost;
					// vault.process: the network round-trip above can race a user edit,
					// so apply the frontmatter write-back to the file's CURRENT content.
					await this.app.vault.process(file, (raw) => {
						let updatedContent = raw;
						if (needsId) {
							updatedContent = updateFrontmatterWithGhostId(updatedContent, syncedPost.id, syncedPost.slug, this.settings.yamlPrefix);
						}
						return updateFrontmatterWithGhostUrl(updatedContent, ghostEditorUrl, this.settings.yamlPrefix, publicUrl);
					});
					console.debug('[Ghost Sync] Frontmatter updated with Ghost id/url/public_url');
				}
			} else {
				// Create new post
				console.debug('[Ghost Sync] Creating new post');
				ghostPost = await this.ghostClient.createPost(postData);
				if (this.settings.showSyncNotifications) {
					const label = this.activeBlogName ? `blog ${this.activeBlogName}` : 'in ghost';
					new Notice(`Created ${label}: ${title}`);
				}
				console.debug(`[Ghost Sync] Created: ${title}`, ghostPost);

				// Write the identifiers back immediately. A re-sync now reads
				// `ghost_id` from disk and updates in place, so this no longer needs a
				// delay to avoid a duplicate — and it makes the public URL available
				// right after publishing (e.g. for the properties modal).
				if (this.writeBack) {
					const capturedGhostPost = ghostPost;
					const ghostEditorUrl = buildGhostEditorUrl(this.activeBaseUrl, capturedGhostPost.id);
					const publicUrl = (status === 'published' || status === 'scheduled') ? (capturedGhostPost.url || undefined) : undefined;
					// vault.process: the create round-trip above can race a user edit,
					// so apply the frontmatter write-back to the file's CURRENT content.
					await this.app.vault.process(file, (raw) => {
						const updatedContent = updateFrontmatterWithGhostId(
							raw,
							capturedGhostPost.id,
							capturedGhostPost.slug,
							this.settings.yamlPrefix
						);
						return updateFrontmatterWithGhostUrl(updatedContent, ghostEditorUrl, this.settings.yamlPrefix, publicUrl);
					});
					console.debug('[Ghost Sync] Frontmatter updated with Ghost ID, editor URL, public URL');
				}
			}

			// Expose the synced post so the plugin can record per-blog ids/URLs
			this.lastSyncedPost = ghostPost;

			if (this.settings.syncUpdateSecondaryTitle) {
				const primarySource = this.settings.syncTitleSource;
				await this.app.vault.process(file, (raw) => updateSecondaryTitle(raw, title, primarySource));
			}

			// Update last sync time
			this.settings.lastSync = Date.now();

			this.onStatusChange?.('success', outcomeMessage);
			return true;
		} catch (error) {
			console.error(`[Ghost Sync] Error syncing ${file.path}:`, error);
			if (this.settings.showSyncNotifications) {
				const where = this.activeBlogName ? ` → ${this.activeBlogName}` : '';
				new Notice(`Failed to sync ${file.name}${where}: ${(error as Error).message}`);
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
