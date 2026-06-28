import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, normalizePath, debounce, Modal, ButtonComponent, parseYaml } from 'obsidian';
import { GhostWriterSettings, DEFAULT_SETTINGS, GhostPost, GhostBlog } from './src/types';
import { GhostAPIClient } from './src/ghost/api-client';
import { generateNewPostTemplate, addGhostPropertiesToContent } from './src/templates';
import { SyncEngine } from './src/sync/sync-engine';
import { CalendarView, CALENDAR_VIEW_TYPE } from './src/views/calendar-view';
import { ImportFromGhostModal } from './src/modals/import-from-ghost-modal';
import { LinkToGhostModal } from './src/modals/link-to-ghost-modal';
import { EditGhostPropertiesModal, GhostPropsForm } from './src/modals/edit-properties-modal';
import { MigratePrefixModal } from './src/modals/migrate-prefix-modal';
import { SelectBlogsModal } from './src/modals/select-blogs-modal';
import { updateFrontmatterWithGhostUrl, updateFrontmatterWithGhostId, upsertGhostMetadata, splitFrontmatter, joinFrontmatter, upsertFrontmatterKeys, parseGhostMetadata, migrateFrontmatterPrefix } from './src/frontmatter-parser';
import { htmlToMarkdown } from './src/converters/html-to-markdown';
import { paywallDecorationPlugin, paywallDeduplicateExtension } from './src/editor/paywall-decoration';

// ⚠️ IMPORTANT: Set to false before production build/release
// Development mode flag - enables auto-sync on file changes (2s debounce)
// Production mode - only syncs according to configured interval
const DEV_MODE = false;

export default class GhostWriterManagerPlugin extends Plugin {
	settings: GhostWriterSettings;
	ghostClient: GhostAPIClient;
	syncEngine: SyncEngine;
	/** Uploaded image content-hash → Ghost URL. Stored in its own file, separate from settings. */
	imageCache: Record<string, string> = {};
	/** API clients keyed by blog id. */
	private blogClients = new Map<string, GhostAPIClient>();
	private syncDebounced?: (file: TFile) => void;
	private statusBarItem: HTMLElement;
	private periodicSyncInterval: number;

	async onload() {
		await this.loadSettings();
		await this.loadImageCache();
		await this.migrateLegacyImageCache();
		await this.migrateBlogs();

		// Get API key from secure keychain
		const apiKey = this.loadApiKey();

		// Initialize Ghost API client
		this.ghostClient = new GhostAPIClient(
			this.settings.ghostUrl,
			apiKey,
			this.app
		);

		// Initialize sync engine, pointed at the default blog
		this.syncEngine = new SyncEngine(this.app, this.settings, this.ghostClient, this.imageCache, () => this.saveImageCache());
		this.restoreDefaultBlogContext();

		// Connect sync engine to status bar
		this.syncEngine.onStatusChange = (status, message) => {
			this.updateStatusBar(status, message);
		};

		// Development mode: Enable auto-sync on file changes with debounce
		if (DEV_MODE) {
			console.debug('[Ghost] DEV_MODE enabled: Auto-sync on file changes (2s debounce)');
			this.syncDebounced = debounce(
				async (file: TFile) => {
					if (this.syncEngine.shouldSyncFile(file)) {
						await this.syncFileRouted(file);
					}
				},
				2000,
				true  // Reset timer on each change
			);

			// Watch for file modifications in dev mode
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (file instanceof TFile && this.syncDebounced) {
						this.syncDebounced(file);
					}
				})
			);
		}

		// Watch for file deletions — delete corresponding Ghost post if note has ghost_id
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.startsWith(normalizePath(this.settings.syncFolder))) return;
				if (file.extension !== 'md') return;

				void (async () => {
					try {
						await this.syncEngine.deletePostForFile(file);
					} catch (error) {
						new Notice(`Erro ao deletar post no Ghost: ${(error as Error).message}`);
					}
				})();
			})
		);

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('idle');

		// Setup periodic sync
		void this.setupPeriodicSync();

		// Register editorial calendar view
		this.registerView(
			CALENDAR_VIEW_TYPE,
			(leaf) => new CalendarView(leaf, this.settings, this.ghostClient)
		);

		// Ribbon icon to open editorial calendar
		this.addRibbonIcon('calendar-days', 'Open ghost editorial calendar', () => {
			void this.activateCalendarView();
		});

		// Ribbon icon to edit the active note's Ghost properties
		this.addRibbonIcon('ghost', 'Edit ghost properties', () => {
			const file = this.app.workspace.getActiveFile();
			if (!file || file.extension !== 'md') {
				new Notice('Open a note first');
				return;
			}
			void this.openEditPropertiesModal(file);
		});

		// Editor right-click menu: edit Ghost properties
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, _editor, view) => {
				const file = view.file;
				if (!file || file.extension !== 'md') return;
				menu.addItem(item => item
					.setTitle('Edit ghost properties')
					.setIcon('ghost')
					.onClick(() => { void this.openEditPropertiesModal(file); }));
			})
		);

		// Register editor extensions for --members-only-- line decoration and deduplication
		this.registerEditorExtension([paywallDecorationPlugin, paywallDeduplicateExtension]);

		// Add settings tab
		this.addSettingTab(new GhostWriterSettingTab(this.app, this));

		// Add command to open editorial calendar
		this.addCommand({
			id: 'open-editorial-calendar',
			name: 'Open editorial calendar',
			callback: () => { void this.activateCalendarView(); }
		});

		// Add command to test connection
		this.addCommand({
			id: 'test-ghost-connection',
			name: 'Test ghost connection',
			callback: async () => {
				await this.testGhostConnection();
			}
		});

		// Add command to create new Ghost post
		this.addCommand({
			id: 'create-new-ghost-post',
			name: 'Create new ghost post',
			callback: async () => {
				await this.createNewGhostPost();
			}
		});

		// Add command to add Ghost properties to current note
		this.addCommand({
			id: 'add-ghost-properties',
			name: 'Add ghost properties to current note',
			editorCallback: (_editor, view) => {
				void this.addGhostPropertiesToCurrentNote(view.file);
			}
		});

		// Add command to sync current note
		this.addCommand({
			id: 'sync-current-note',
			name: 'Sync current note to ghost',
			editorCallback: (_editor, view) => {
				void this.syncCurrentNote(view.file);
			}
		});

		// Add command to import a Ghost post as a new note
		this.addCommand({
			id: 'import-post-from-ghost',
			name: 'Import post from ghost',
			callback: () => { this.openImportFromGhostModal(); }
		});

		// Add command to link an existing note to an existing Ghost post
		this.addCommand({
			id: 'link-note-to-ghost',
			name: 'Link note to ghost post',
			callback: () => { this.openLinkToGhostModal(); }
		});

		// Seed the current note from an existing Ghost post matched by g_slug
		this.addCommand({
			id: 'seed-note-from-ghost-by-slug',
			name: 'Seed note from existing ghost post (by slug)',
			editorCallback: (_editor, view) => {
				if (!view.file) { new Notice('No active file'); return; }
				void this.seedActiveNoteFromGhost(view.file);
			}
		});

		// Edit Ghost properties of the current note via a modal with dropdowns
		this.addCommand({
			id: 'edit-ghost-properties',
			name: 'Edit ghost properties (modal)',
			editorCallback: (_editor, view) => {
				if (!view.file) { new Notice('No active file'); return; }
				void this.openEditPropertiesModal(view.file);
			}
		});

		// Clear the cached image-upload map so images re-upload on the next sync
		this.addCommand({
			id: 'clear-ghost-image-cache',
			name: 'Clear ghost image cache',
			callback: () => { void this.clearImageCache(); }
		});

		// Migrate the Ghost frontmatter prefix across all notes (e.g. ghost_ -> g_)
		this.addCommand({
			id: 'migrate-ghost-prefix',
			name: 'Migrate ghost property prefix',
			callback: () => {
				new MigratePrefixModal(this.app, this.settings.yamlPrefix, (np) => this.migratePrefix(np)).open();
			}
		});

		// Choose which blog(s) the active note publishes to
		this.addCommand({
			id: 'set-note-blogs',
			name: 'Set blog(s) for this note',
			editorCallback: (_editor, view) => {
				if (!view.file) { new Notice('No active file'); return; }
				this.openSetBlogsModal(view.file);
			}
		});

		// Import all posts from a Ghost blog into its folder
		this.addCommand({
			id: 'import-all-posts',
			name: 'Import all posts from a ghost blog',
			callback: () => { this.openImportAllModal(); }
		});

		// Add command to insert the paywall marker at the cursor
		this.addCommand({
			id: 'insert-paywall-marker',
			name: 'Insert paywall marker (members-only)',
			editorCallback: (editor) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const prefix = line.length > 0 ? '\n\n' : '';
				const suffix = '\n\n';
				editor.replaceRange(`${prefix}--members-only--${suffix}`, cursor);
			}
		});

		// Add debug command to check file properties
		this.addCommand({
			id: 'debug-ghost-properties',
			name: 'Debug: show ghost properties in current note',
			editorCallback: (_editor, view) => {
				if (!view.file) {
					new Notice('No active file');
					return;
				}

				const cache = this.app.metadataCache.getFileCache(view.file);
				if (!cache?.frontmatter) {
					new Notice('No frontmatter found');
					console.debug('[Ghost Debug] No frontmatter');
					return;
				}

				console.debug('[Ghost Debug] Frontmatter:', cache.frontmatter);
				console.debug('[Ghost Debug] YAML prefix:', this.settings.yamlPrefix);

				const ghostKeys = Object.keys(cache.frontmatter).filter(key =>
					key.startsWith(this.settings.yamlPrefix)
				);

				if (ghostKeys.length === 0) {
					new Notice(`No properties with prefix "${this.settings.yamlPrefix}" found`);
					console.debug('[Ghost Debug] Available keys:', Object.keys(cache.frontmatter));
				} else {
					new Notice(`Found ${ghostKeys.length} Ghost properties`);
					console.debug('[Ghost Debug] Ghost properties:', ghostKeys);
				}
			}
		});

		// Add debug command to test JWT token
		this.addCommand({
			id: 'debug-test-jwt',
			name: 'Debug: test JWT token generation',
			callback: async () => {
				const apiKey = this.loadApiKey();
				if (!this.settings.ghostUrl || !apiKey) {
					new Notice('Please configure ghost URL and admin API key first');
					return;
				}

				try {
					console.debug('[Ghost Debug] Testing JWT generation...');
					console.debug('[Ghost Debug] Ghost URL:', this.settings.ghostUrl);
					console.debug('[Ghost Debug] API key format:', apiKey.includes(':') ? 'Valid (contains :)' : 'Invalid (missing :)');

					// Test connection which will generate and use a JWT
					const result = await this.ghostClient.testConnection();
					if (result) {
						new Notice('JWT generation successful! Connection works.');
						console.debug('[Ghost Debug] JWT and connection working');
					} else {
						new Notice('Connection failed - check console for details');
						console.debug('[Ghost Debug] Connection failed');
					}
				} catch (error) {
					console.error('[Ghost Debug] Error:', error);
					new Notice(`Error: ${(error as Error).message}`);
				}
			}
		});

		// Add debug command to show file content and metadata
		this.addCommand({
			id: 'debug-show-file-data',
			name: 'Debug: show file content and metadata',
			editorCallback: (_editor, view) => {
				const file = view.file;
				if (!file) {
					new Notice('No active file');
					return;
				}

				void this.app.vault.read(file).then((content) => {
					const cache = this.app.metadataCache.getFileCache(file);

					console.debug('[Ghost Debug] ===== FILE DEBUG =====');
					console.debug('[Ghost Debug] File path:', file.path);
					console.debug('[Ghost Debug] File content:', content);
					console.debug('[Ghost Debug] Frontmatter:', cache?.frontmatter);
					console.debug('[Ghost Debug] Content length:', content.length);
					console.debug('[Ghost Debug] ===== END DEBUG =====');

					new Notice('File data logged to console');
				}).catch((error: Error) => {
					console.error('[Ghost Debug] Error reading file:', error);
					new Notice(`Error reading file: ${error.message}`);
				});
			}
		});

		this.addCommand({
			id: 'schedule-current-note',
			name: 'Schedule current note',
			editorCheckCallback: (checking, _editor, ctx) => {
				if (ctx.file) {
					if (!checking) void this.scheduleCurrentNote(ctx.file);
					return true;
				}
				return false;
			}
		});
	}

	async activateCalendarView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
		if (existing.length > 0) {
			void this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
	}

	onunload() {
		// Clear periodic sync interval
		if (this.periodicSyncInterval) {
			window.clearInterval(this.periodicSyncInterval);
		}
	}

	setupPeriodicSync() {
		// Clear existing interval if any
		if (this.periodicSyncInterval) {
			window.clearInterval(this.periodicSyncInterval);
		}

		// Only setup periodic sync if credentials are configured
		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			return;
		}

		// Convert minutes to milliseconds
		const intervalMs = this.settings.syncInterval * 60 * 1000;

		console.debug(`[Ghost Sync] Setting up periodic sync every ${this.settings.syncInterval} minutes`);

		// Setup periodic sync
		this.periodicSyncInterval = window.setInterval(() => {
			console.debug('[Ghost Sync] Running periodic sync...');
			void this.syncAllRouted();
		}, intervalMs);
	}

	updateStatusBar(status: 'idle' | 'syncing' | 'success' | 'error', message?: string) {
		const icons = {
			idle: '⚪',
			syncing: '🔄',
			success: '✅',
			error: '❌'
		};

		const texts = {
			idle: 'Ghost: Ready',
			syncing: 'Ghost: Syncing...',
			success: 'Ghost: Synced',
			error: 'Ghost: Error'
		};

		this.statusBarItem.setText(`${icons[status]} ${message || texts[status]}`);

		// Auto-reset to idle after success/error
		if (status === 'success' || status === 'error') {
			activeWindow.setTimeout(() => this.updateStatusBar('idle'), 3000);
		}
	}

	async loadSettings() {
		const savedData = await this.loadData() as Partial<GhostWriterSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Restart periodic sync with new settings
		void this.setupPeriodicSync();
	}

	/** Path of the image-cache file, kept in the plugin dir, separate from data.json. */
	private imageCachePath(): string {
		return normalizePath(`${this.manifest.dir ?? '.'}/image-cache.json`);
	}

	async loadImageCache(): Promise<void> {
		const path = this.imageCachePath();
		try {
			if (await this.app.vault.adapter.exists(path)) {
				const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
				if (parsed && typeof parsed === 'object') {
					this.imageCache = parsed as Record<string, string>;
				}
			}
		} catch (e) {
			console.error('[Ghost] Failed to load image cache:', e);
		}
	}

	async saveImageCache(): Promise<void> {
		try {
			await this.app.vault.adapter.write(this.imageCachePath(), JSON.stringify(this.imageCache));
		} catch (e) {
			console.error('[Ghost] Failed to save image cache:', e);
		}
	}

	/** Move an image cache that used to live inside data.json into its own file. */
	private async migrateLegacyImageCache(): Promise<void> {
		const legacy = (this.settings as unknown as { imageCache?: Record<string, string> }).imageCache;
		if (legacy && typeof legacy === 'object' && Object.keys(legacy).length > 0) {
			this.imageCache = { ...legacy, ...this.imageCache };
			await this.saveImageCache();
		}
		// Drop the legacy key from settings regardless, so it leaves data.json
		if ((this.settings as unknown as { imageCache?: unknown }).imageCache !== undefined) {
			delete (this.settings as unknown as { imageCache?: unknown }).imageCache;
			await this.saveData(this.settings);
		}
	}

	/**
	 * Load Ghost Admin API Key from Obsidian Secrets
	 */
	loadApiKey(): string {
		if (!this.settings.ghostApiKeySecretName) {
			console.warn('[Ghost] No secret name configured');
			return '';
		}

		console.debug('[Ghost] Attempting to load secret:', this.settings.ghostApiKeySecretName);

		try {
			// Use the correct API: app.secretStorage.getSecret()
			if (!this.app.secretStorage) {
				console.error('[Ghost] app.secretStorage is not available. Obsidian version may be too old.');
				new Notice('Obsidian secrets API not available. Please update Obsidian to the latest version.');
				return '';
			}

			const apiKey = this.app.secretStorage.getSecret(this.settings.ghostApiKeySecretName);

			if (!apiKey) {
				console.error('[Ghost] Secret not found or empty:', this.settings.ghostApiKeySecretName);
				new Notice(`Secret "${this.settings.ghostApiKeySecretName}" not found in Keychain. Please create it in settings → Keychain.`);
				return '';
			}

			console.debug('[Ghost] Successfully loaded secret (length:', apiKey.length, ')');

			// Always keep the ghost client in sync with the current credentials
			// so that any command invoked after plugin load uses the latest key.
			// Guard: ghostClient may not exist yet when loadApiKey() is called
			// during onload() before the client is instantiated.
			this.ghostClient?.updateCredentials(this.settings.ghostUrl, apiKey);

			return apiKey;
		} catch (error) {
			console.error('[Ghost] Error loading API key from secrets:', error);
			new Notice(`Error loading secret: ${(error as Error).message}`);
			return '';
		}
	}

	async testGhostConnection(): Promise<void> {
		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			new Notice('Please configure ghost URL and admin API key first');
			return;
		}

		try {
			const title = await this.ghostClient.testConnection();
			if (title) {
				new Notice(`Successfully connected to ${title}`);
			} else {
				new Notice('Failed to connect to ghost. Please check your credentials.');
			}
		} catch (error) {
			console.error('Ghost connection test failed:', error);
			new Notice(`Connection failed: ${(error as Error).message}`);
		}
	}

	async syncWithGhost(): Promise<void> {
		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			new Notice('Please configure ghost URL and admin API key first');
			return;
		}

		try {
			await this.syncAllRouted();
		} catch (error) {
			console.error('Sync failed:', error);
			new Notice(`Sync failed: ${(error as Error).message}`);
		}
	}

	async createNewGhostPost(): Promise<void> {
		try {
			// Ensure sync folder exists
			const syncFolderPath = normalizePath(this.settings.syncFolder);
			const syncFolder = this.app.vault.getAbstractFileByPath(syncFolderPath);

			if (!syncFolder) {
				await this.app.vault.createFolder(syncFolderPath);
			}

			// Generate unique filename
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `ghost-post-${timestamp}.md`;
			const filePath = normalizePath(`${syncFolderPath}/${fileName}`);

			// Generate content with Ghost properties
			const content = generateNewPostTemplate(this.settings);

			// Create the file
			const file = await this.app.vault.create(filePath, content);

			// Open the file
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);

			new Notice('New ghost post created!');
		} catch (error) {
			console.error('Error creating new Ghost post:', error);
			new Notice(`Failed to create new post: ${(error as Error).message}`);
		}
	}

	/**
	 * Open the "Import post from Ghost" modal and handle the import.
	 * Creates a new note in the sync folder with the post content and YAML.
	 */
	openImportFromGhostModal(): void {
		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			new Notice('Please configure ghost URL and admin API key first');
			return;
		}

		new ImportFromGhostModal(
			this.app,
			this.ghostClient,
			this.settings,
			async (post: GhostPost, ghostUrl: string) => {
				await this.importPostAsNote(post, ghostUrl);
			}
		).open();
	}

	/**
	 * Create a new Obsidian note from a fetched Ghost post.
	 */
	private async importPostAsNote(post: GhostPost, ghostUrl: string): Promise<void> {
		try {
			const prefix = this.settings.yamlPrefix;

			// Ensure sync folder exists
			const syncFolderPath = normalizePath(this.settings.syncFolder);
			if (!this.app.vault.getAbstractFileByPath(syncFolderPath)) {
				await this.app.vault.createFolder(syncFolderPath);
			}

			// Build YAML frontmatter from Ghost post data
			const tags = (post.tags ?? []).map(t => t.name);
			const tagsYaml = tags.length > 0
				? `[${tags.map(t => `"${t}"`).join(', ')}]`
				: '[]';

			const frontmatter = [
				`${prefix}post_access: ${post.visibility ?? 'public'}`,
				`${prefix}published: ${(post.status === 'published' || post.status === 'scheduled') ? 'true' : 'false'}`,
				`${prefix}published_at: "${post.published_at ?? ''}"`,
				`${prefix}featured: ${post.featured ? 'true' : 'false'}`,
				`${prefix}tags: ${tagsYaml}`,
				`${prefix}excerpt: "${post.excerpt ?? ''}"`,
				`${prefix}feature_image: "${post.feature_image ?? ''}"`,
				`${prefix}no_sync: false`,
				`${prefix}id: ${post.id}`,
				`${prefix}slug: ${post.slug}`,
				`${prefix}url: ${ghostUrl}`
			].join('\n');

			// Use the post title as the note title/filename
			const title = post.title || 'Untitled Post';
			const safeFileName = title.replace(/[\\/:*?"<>|]/g, '-').trim();
			const filePath = normalizePath(`${syncFolderPath}/${safeFileName}.md`);

			// Convert Ghost HTML content to Markdown for the note body
			const bodyMarkdown = htmlToMarkdown(post.html ?? '');
			const content = `---\n${frontmatter}\n---\n\n# ${title}\n\n${bodyMarkdown}`;

			// Avoid overwriting an existing file
			let finalPath = filePath;
			if (this.app.vault.getAbstractFileByPath(filePath)) {
				const ts = Date.now();
				finalPath = normalizePath(`${syncFolderPath}/${safeFileName}-${ts}.md`);
			}

			const file = await this.app.vault.create(finalPath, content);

			// Open the new note
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);

			new Notice(`Imported: "${title}"`);
		} catch (error) {
			console.error('[Ghost Import] Error importing post:', error);
			new Notice(`Failed to import post: ${(error as Error).message}`);
		}
	}

	/**
	 * Seed the active note from an existing Ghost post matched by its `g_slug`.
	 * Only runs when the note has an explicit slug and no `ghost_id` yet.
	 */
	private async seedActiveNoteFromGhost(file: TFile): Promise<void> {
		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			new Notice('Please configure ghost URL and admin API key first');
			return;
		}

		const prefix = this.settings.yamlPrefix;
		const cache = this.app.metadataCache.getFileCache(file);
		const metadata = cache?.frontmatter ? parseGhostMetadata(cache.frontmatter, prefix) : null;
		if (!metadata?.slug) {
			new Notice(`Set ${prefix}slug on this note first to seed from Ghost`);
			return;
		}
		if (metadata.ghost_id) {
			new Notice('This note is already linked to a ghost post; nothing to seed.');
			return;
		}

		try {
			new Notice(`Looking up Ghost post with slug "${metadata.slug}"...`);
			await this.syncEngine.seedNoteFromGhostBySlug(file, metadata.slug);
		} catch (error) {
			new Notice(`Seed failed: ${(error as Error).message}`);
		}
	}

	/**
	 * Clear the cached image-upload map (content hash -> Ghost URL) without
	 * touching any other settings. Use this instead of deleting data.json.
	 */
	// ─── Multiple Ghost blogs ────────────────────────────────────────────────

	genBlogId(): string {
		return 'blog-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	private deriveBlogName(url: string): string {
		try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
	}

	/** Read an Admin API key from the keychain by secret name. */
	loadApiKeyForSecret(secretName: string): string {
		if (!secretName || !this.app.secretStorage) return '';
		try {
			return this.app.secretStorage.getSecret(secretName) || '';
		} catch (e) {
			console.error('[Ghost] Error loading secret', secretName, e);
			return '';
		}
	}

	/** Migrate the legacy single-blog config into blogs[] on first run. */
	private async migrateBlogs(): Promise<void> {
		if (this.settings.blogs && this.settings.blogs.length > 0) {
			if (!this.settings.defaultBlogId || !this.settings.blogs.some(b => b.id === this.settings.defaultBlogId)) {
				this.settings.defaultBlogId = this.settings.blogs[0].id;
				await this.saveSettings();
			}
			return;
		}
		const blog: GhostBlog = {
			id: this.genBlogId(),
			name: this.deriveBlogName(this.settings.ghostUrl) || 'My blog',
			url: this.settings.ghostUrl,
			apiKeySecretName: this.settings.ghostApiKeySecretName,
			folder: this.settings.syncFolder
		};
		this.settings.blogs = [blog];
		this.settings.defaultBlogId = blog.id;
		await this.saveSettings();
	}

	/** Get (or create) the API client for a blog. */
	getClientForBlog(blog: GhostBlog): GhostAPIClient {
		const key = this.loadApiKeyForSecret(blog.apiKeySecretName);
		let client = this.blogClients.get(blog.id);
		if (!client) {
			client = new GhostAPIClient(blog.url, key, this.app);
			this.blogClients.set(blog.id, client);
		} else {
			client.updateCredentials(blog.url, key);
		}
		return client;
	}

	/** The default (last-selected) blog, or the first, or null. */
	defaultBlog(): GhostBlog | null {
		return this.settings.blogs.find(b => b.id === this.settings.defaultBlogId)
			?? this.settings.blogs[0] ?? null;
	}

	/** Resolve which blog(s) a note targets, from its g_blog property; else the default. */
	resolveBlogsForFile(file: TFile): GhostBlog[] {
		const prefix = this.settings.yamlPrefix;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const raw = fm ? fm[`${prefix}blog`] : undefined;
		const names = Array.isArray(raw)
			? raw.map(v => String(v).trim()).filter(Boolean)
			: (typeof raw === 'string' && raw.trim() ? [raw.trim()] : []);
		if (names.length > 0) {
			const lower = names.map(n => n.toLowerCase());
			const found = this.settings.blogs.filter(b => lower.includes(b.name.toLowerCase()));
			if (found.length > 0) return found;
		}
		const def = this.defaultBlog();
		return def ? [def] : [];
	}

	private restoreDefaultBlogContext(): void {
		const d = this.defaultBlog();
		if (d) this.syncEngine.setActiveBlog(this.getClientForBlog(d), d.url, d.folder, true);
	}

	/** Sync a note to each of its target blogs (one-to-many). */
	/** Read a blog→string map (g_ids / g_public_urls) from a note's frontmatter. */
	private readBlogMap(fmObj: Record<string, unknown>, key: string): Record<string, string> {
		const v = fmObj[key];
		const out: Record<string, string> = {};
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
				if (typeof val === 'string') out[k] = val;
			}
		}
		return out;
	}

	/** Serialize a blog→string map as an inline YAML flow mapping. */
	private serializeBlogMap(map: Record<string, string>): string {
		const entries = Object.entries(map);
		if (entries.length === 0) return '{}';
		return '{' + entries.map(([k, v]) => `"${k}": "${v}"`).join(', ') + '}';
	}

	/** Per-blog published/draft status + URL for a note (empty unless 2+ target blogs). */
	private buildBlogStatuses(file: TFile, fmObj: Record<string, unknown>): { name: string; url: string; published: boolean }[] {
		const prefix = this.settings.yamlPrefix;
		const targets = this.resolveBlogsForFile(file);
		if (targets.length < 2) return [];
		const urlsMap = this.readBlogMap(fmObj, `${prefix}public_urls`);
		const singlePublic = typeof fmObj[`${prefix}public_url`] === 'string' ? String(fmObj[`${prefix}public_url`]) : '';
		const pubVal = fmObj[`${prefix}published`];
		const isPub = pubVal === true || pubVal === 'true';
		return targets.map(b => {
			const url = urlsMap[b.name] || (b.id === this.settings.defaultBlogId ? singlePublic : '');
			return { name: b.name, url, published: isPub && !!url };
		});
	}

	/**
	 * Sync a note to a specific set of blogs (one-to-many). Each blog is matched
	 * by its own stored ghost_id (kept in the note's `g_ids` map) if we have one,
	 * else by slug. After syncing, the per-blog id and public URL are recorded.
	 */
	async syncFileToBlogs(file: TFile, blogs: GhostBlog[]): Promise<boolean> {
		if (blogs.length === 0) {
			new Notice('No ghost blog configured — add one in settings.');
			return false;
		}
		const prefix = this.settings.yamlPrefix;
		const writeBack = blogs.length === 1;

		// Read existing per-blog maps + the legacy single id from disk.
		const content0 = await this.app.vault.read(file);
		let fmObj: Record<string, unknown> = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		const split0 = splitFrontmatter(content0);
		if (split0) {
			try {
				const d = parseYaml(split0.raw) as unknown;
				if (d && typeof d === 'object') fmObj = d as Record<string, unknown>;
			} catch { /* ignore */ }
		}
		const idsMap = this.readBlogMap(fmObj, `${prefix}ids`);
		const urlsMap = this.readBlogMap(fmObj, `${prefix}public_urls`);
		const legacyId = typeof fmObj[`${prefix}id`] === 'string' ? String(fmObj[`${prefix}id`]) : '';

		let ok = true;
		let mapsChanged = false;
		for (const blog of blogs) {
			const knownId = idsMap[blog.name]
				|| (blog.id === this.settings.defaultBlogId && legacyId ? legacyId : undefined);
			this.syncEngine.setActiveBlog(this.getClientForBlog(blog), blog.url, blog.folder, writeBack, knownId);
			try {
				ok = (await this.syncEngine.syncFileToGhost(file)) && ok;
			} catch (e) {
				new Notice(`Sync to ${blog.name} failed: ${(e as Error).message}`);
				ok = false;
			}
			const post = this.syncEngine.lastSyncedPost;
			if (post) {
				if (idsMap[blog.name] !== post.id) { idsMap[blog.name] = post.id; mapsChanged = true; }
				const u = post.url || '';
				if (u && urlsMap[blog.name] !== u) { urlsMap[blog.name] = u; mapsChanged = true; }
			}
		}
		this.restoreDefaultBlogContext();

		// For multi-blog notes, persist the per-blog id / public-url maps. (Single-blog
		// notes already get g_id/g_url/g_public_url written by the sync engine.)
		if (!writeBack && mapsChanged) {
			let content = await this.app.vault.read(file);
			content = upsertFrontmatterKeys(content, {
				[`${prefix}ids`]: this.serializeBlogMap(idsMap),
				[`${prefix}public_urls`]: this.serializeBlogMap(urlsMap)
			});
			await this.app.vault.modify(file, content);
		}
		return ok;
	}

	/** Sync a note to the blog(s) named in its g_blog property (else the default). */
	async syncFileRouted(file: TFile): Promise<boolean> {
		return this.syncFileToBlogs(file, this.resolveBlogsForFile(file));
	}

	/** Sync every note across all blog folders, each to its own blog(s). */
	async syncAllRouted(): Promise<void> {
		const files = new Set<TFile>();
		for (const blog of this.settings.blogs) {
			const folder = normalizePath(blog.folder);
			this.app.vault.getMarkdownFiles()
				.filter(f => f.path === folder || f.path.startsWith(folder + '/'))
				.forEach(f => files.add(f));
		}
		if (files.size === 0) {
			new Notice('No notes to sync (check your blog folders).');
			return;
		}
		new Notice(`Syncing ${files.size} note(s)…`);
		let success = 0;
		let failed = 0;
		for (const f of files) {
			if (await this.syncFileRouted(f)) success++; else failed++;
		}
		new Notice(`Sync complete: ${success} ok${failed ? `, ${failed} failed` : ''}`);
	}

	/** Picker to set which blog(s) the active note publishes to. */
	private openSetBlogsModal(file: TFile): void {
		const current = this.resolveBlogsForFile(file).map(b => b.id);
		new SelectBlogsModal(
			this.app, this.settings.blogs, current,
			{ heading: 'Publish this note to…', confirmLabel: 'Set' },
			async (chosen) => {
				const prefix = this.settings.yamlPrefix;
				const names = chosen.map(b => b.name);
				const yaml = `[${names.map(n => `"${n}"`).join(', ')}]`;
				let content = await this.app.vault.read(file);
				content = upsertFrontmatterKeys(content, { [`${prefix}blog`]: yaml });
				await this.app.vault.modify(file, content);
				this.settings.defaultBlogId = chosen[chosen.length - 1].id; // last = default
				await this.saveSettings();
				new Notice(`Note will publish to: ${names.join(', ')}`);
			}
		).open();
	}

	/** Picker to choose a blog (or blogs) to import all posts from. */
	private openImportAllModal(): void {
		const def = this.defaultBlog();
		new SelectBlogsModal(
			this.app, this.settings.blogs, def ? [def.id] : [],
			{ heading: 'Import all posts from…', confirmLabel: 'Import' },
			async (chosen) => {
				for (const blog of chosen) await this.importAllFromBlog(blog);
			}
		).open();
	}

	/** Fetch every post from a blog and write each as a note in the blog's folder. */
	private async importAllFromBlog(blog: GhostBlog): Promise<void> {
		const apiKey = this.loadApiKeyForSecret(blog.apiKeySecretName);
		if (!blog.url || !apiKey) {
			new Notice(`Blog "${blog.name}" is missing its URL or API key.`);
			return;
		}
		const client = this.getClientForBlog(blog);
		try {
			new Notice(`Importing all posts from ${blog.name}…`);
			const posts = await client.getPosts(undefined, 'all', 'published_at desc');
			const folder = normalizePath(blog.folder);
			if (!this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
			let count = 0;
			for (const post of posts) {
				const editorUrl = `${blog.url.replace(/\/$/, '')}/ghost/#/editor/post/${post.id}`;
				await this.writePostAsNoteInFolder(post, editorUrl, folder, blog.name);
				count++;
			}
			new Notice(`Imported ${count} post${count === 1 ? '' : 's'} from ${blog.name} into ${folder}`);
		} catch (e) {
			new Notice(`Import from ${blog.name} failed: ${(e as Error).message}`);
		}
	}

	/** Write one Ghost post as a note in a folder, tagged with its blog. */
	private async writePostAsNoteInFolder(post: GhostPost, editorUrl: string, folder: string, blogName: string): Promise<void> {
		const prefix = this.settings.yamlPrefix;
		const tags = (post.tags ?? []).map(t => t.name);
		const tagsYaml = tags.length > 0 ? `[${tags.map(t => `"${t}"`).join(', ')}]` : '[]';
		const isPub = post.status === 'published' || post.status === 'scheduled';
		const frontmatter = [
			`${prefix}blog: ["${blogName}"]`,
			`${prefix}post_access: ${post.visibility ?? 'public'}`,
			`${prefix}published: ${isPub ? 'true' : 'false'}`,
			`${prefix}published_at: "${post.published_at ?? ''}"`,
			`${prefix}featured: ${post.featured ? 'true' : 'false'}`,
			`${prefix}tags: ${tagsYaml}`,
			`${prefix}excerpt: "${(post.excerpt ?? '').replace(/"/g, '\\"')}"`,
			`${prefix}feature_image: "${post.feature_image ?? ''}"`,
			`${prefix}no_sync: false`,
			`${prefix}id: ${post.id}`,
			`${prefix}slug: ${post.slug}`,
			`${prefix}url: ${editorUrl}`
		].join('\n');
		const title = post.title || 'Untitled Post';
		const safe = title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled Post';
		const body = htmlToMarkdown(post.html ?? '');
		const content = `---\n${frontmatter}\n---\n\n# ${title}\n\n${body}`;
		let path = normalizePath(`${folder}/${safe}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			path = normalizePath(`${folder}/${safe}-${post.id}.md`);
		}
		if (this.app.vault.getAbstractFileByPath(path)) return; // already imported
		await this.app.vault.create(path, content);
	}

	private async clearImageCache(): Promise<void> {
		const n = Object.keys(this.imageCache).length;
		this.imageCache = {};
		await this.saveImageCache();
		new Notice(`Cleared ghost image cache (${n} ${n === 1 ? 'entry' : 'entries'})`);
	}

	/**
	 * Rename all notes' Ghost frontmatter keys from the current prefix to a new
	 * one (e.g. ghost_ -> g_), then update the plugin setting.
	 */
	private async migratePrefix(newPrefix: string): Promise<void> {
		const oldPrefix = this.settings.yamlPrefix;
		if (!newPrefix || newPrefix === oldPrefix) return;

		new Notice('Migrating ghost property prefix…');
		const files = this.app.vault.getMarkdownFiles();
		let count = 0;
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const { content: migrated, changed } = migrateFrontmatterPrefix(content, oldPrefix, newPrefix);
				if (changed) {
					await this.app.vault.modify(file, migrated);
					count++;
				}
			} catch (e) {
				console.error('[Ghost] Prefix migration failed for', file.path, e);
			}
		}

		this.settings.yamlPrefix = newPrefix;
		await this.saveSettings();
		new Notice(`Migrated ${count} note${count === 1 ? '' : 's'} from "${oldPrefix}" to "${newPrefix}"`);
	}

	/**
	 * Open the "Edit Ghost properties" modal for the active note. Reads current
	 * values from the file on disk, then writes the chosen values back (preserving
	 * non-Ghost frontmatter), optionally syncing.
	 */
	private async openEditPropertiesModal(file: TFile): Promise<void> {
		const prefix = this.settings.yamlPrefix;
		const content = await this.app.vault.read(file);

		// Read current frontmatter from disk (cache can lag)
		let fmObj: Record<string, unknown> = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		const split = splitFrontmatter(content);
		if (split) {
			try {
				const d = parseYaml(split.raw) as unknown;
				if (d && typeof d === 'object') fmObj = d as Record<string, unknown>;
			} catch { /* ignore, use cache */ }
		}
		const md = parseGhostMetadata(fmObj, prefix);

		const status: GhostPropsForm['status'] = !md?.published
			? 'draft'
			: (md.published_at ? 'schedule' : 'publish');

		const initial: GhostPropsForm = {
			status,
			visibility: md?.post_access ?? 'public',
			featured: md?.featured ?? false,
			coverFromFirstImage: md?.cover_from_first_image ?? false,
			publishedAt: md?.published_at ?? '',
			excerpt: md?.excerpt ?? '',
			tags: (md?.tags ?? []).join(', '),
			slug: md?.slug ?? '',
			featureImage: md?.feature_image ?? '',
			blogIds: this.resolveBlogsForFile(file).map(b => b.id)
		};

		// The indicator reflects what's actually LIVE on Ghost, not the note's
		// intent: only show Published/Scheduled when a public URL exists (it is
		// written only after a successful publish sync). Otherwise show Draft.
		const initialPublicUrl = md?.public_url ?? '';
		const info = { savedStatus: initialPublicUrl ? status : 'draft', publicUrl: initialPublicUrl, blogStatuses: this.buildBlogStatuses(file, fmObj) };
		const availableBlogs = this.settings.blogs.map(b => ({ id: b.id, name: b.name }));
		new EditGhostPropertiesModal(this.app, file.basename, initial, info, availableBlogs, async (form, doSync) => {
			let updated = await this.app.vault.read(file);
			const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
			const tagsYaml = tags.length > 0 ? `[${tags.map(t => `"${t}"`).join(', ')}]` : '[]';
			const escq = (s: string): string => s.replace(/\n/g, ' ').replace(/"/g, '\\"');
			const ghostFields: Record<string, string> = {
				post_access: form.visibility,
				published: form.status === 'draft' ? 'false' : 'true',
				published_at: form.status === 'schedule' && form.publishedAt ? `"${form.publishedAt}"` : '""',
				featured: form.featured ? 'true' : 'false',
				cover_from_first_image: form.coverFromFirstImage ? 'true' : 'false',
				excerpt: `"${escq(form.excerpt)}"`,
				feature_image: `"${form.featureImage}"`,
				slug: form.slug,
				tags: tagsYaml
			};
			const selectedBlogs = form.blogIds
				.map(id => this.settings.blogs.find(b => b.id === id))
				.filter((b): b is GhostBlog => !!b);
			if (selectedBlogs.length > 0) {
				ghostFields.blog = `[${selectedBlogs.map(b => `"${b.name}"`).join(', ')}]`;
			}
			updated = upsertGhostMetadata(updated, ghostFields, prefix);
			await this.app.vault.modify(file, updated);
			if (selectedBlogs.length > 0) {
				this.settings.defaultBlogId = selectedBlogs[selectedBlogs.length - 1].id; // last = default
				await this.saveSettings();
			}
			new Notice('Ghost properties saved');
			if (doSync) {
				try {
					await this.syncFileToBlogs(file, selectedBlogs.length ? selectedBlogs : this.resolveBlogsForFile(file));
				} catch (e) {
					new Notice(`Sync failed: ${(e as Error).message}`);
				}
			}

			// Re-read the note to report the up-to-date status + public URL back to
			// the modal (the sync writes g_public_url / g_published back on success).
			const freshContent = await this.app.vault.read(file);
			let freshFm: Record<string, unknown> = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
			const freshSplit = splitFrontmatter(freshContent);
			if (freshSplit) {
				try {
					const d = parseYaml(freshSplit.raw) as unknown;
					if (d && typeof d === 'object') freshFm = d as Record<string, unknown>;
				} catch { /* ignore */ }
			}
			const fmd = parseGhostMetadata(freshFm, prefix);
			const freshPublicUrl = fmd?.public_url ?? '';
			const freshIntended: GhostPropsForm['status'] = !fmd?.published
				? 'draft'
				: (fmd.published_at ? 'schedule' : 'publish');
			// Only show Published/Scheduled if the sync actually wrote a public URL.
			return { savedStatus: freshPublicUrl ? freshIntended : 'draft', publicUrl: freshPublicUrl, blogStatuses: this.buildBlogStatuses(file, freshFm) };
		}).open();
	}

	/**
	 * Open the "Link note to Ghost post" modal and handle the linking.
	 */
	openLinkToGhostModal(): void {
		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			new Notice('Please configure ghost URL and admin API key first');
			return;
		}

		new LinkToGhostModal(
			this.app,
			this.ghostClient,
			this.settings,
			async ({ ghostPost, obsidianFile, source, ghostUrl }) => {
				await this.linkNoteToGhostPost(ghostPost, obsidianFile, source, ghostUrl);
			}
		).open();
	}

	/**
	 * Perform the actual linking between a Ghost post and an Obsidian note.
	 * The chosen source overwrites the destination.
	 */
	private async linkNoteToGhostPost(
		post: GhostPost,
		file: TFile,
		source: 'ghost' | 'obsidian',
		ghostUrl: string
	): Promise<void> {
		try {
			const prefix = this.settings.yamlPrefix;

			if (source === 'ghost') {
				// Ghost → Obsidian: upsert Ghost metadata into existing frontmatter.
				// All non-Ghost keys the user already has are preserved.
				const tags = (post.tags ?? []).map(t => t.name);
				const tagsYaml = tags.length > 0
					? `[${tags.map(t => `"${t}"`).join(', ')}]`
					: '[]';

				const ghostFields: Record<string, string> = {
					post_access: post.visibility ?? 'public',
					published: (post.status === 'published' || post.status === 'scheduled') ? 'true' : 'false',
					published_at: `"${post.published_at ?? ''}"`,
					featured: post.featured ? 'true' : 'false',
					tags: tagsYaml,
					excerpt: `"${post.excerpt ?? ''}"`,
					feature_image: `"${post.feature_image ?? ''}"`,
					no_sync: 'false',
					id: post.id,
					slug: post.slug,
					url: ghostUrl
				};

				let content = await this.app.vault.read(file);
				content = upsertGhostMetadata(content, ghostFields, prefix);

				// Replace the note body with the Ghost post content (HTML → Markdown).
				// We keep the frontmatter intact and only overwrite the body.
				const bodyMarkdown = htmlToMarkdown(post.html ?? '');
				const parsed = splitFrontmatter(content);
				const title = post.title || 'Untitled Post';

				if (parsed) {
					// Rebuild: frontmatter + title heading + converted body from Ghost
					content = joinFrontmatter(parsed.raw, `\n# ${title}\n\n${bodyMarkdown}`);
				} else {
					// No frontmatter block (shouldn't happen after upsert, but be safe)
					content = `# ${title}\n\n${bodyMarkdown}`;
				}

				await this.app.vault.modify(file, content);

				// Move to sync folder if necessary
				await this.ensureInSyncFolder(file);

				new Notice(`Linked and updated note from Ghost: "${title}"`);
			} else {
				// Obsidian → Ghost: update note's YAML with Ghost metadata, then sync
				let content = await this.app.vault.read(file);

				// Add Ghost properties if missing, and set the ghost_id + ghost_url
				content = addGhostPropertiesToContent(content, this.settings);
				content = updateFrontmatterWithGhostId(content, post.id, post.slug, prefix);
				content = updateFrontmatterWithGhostUrl(content, ghostUrl, prefix);

				await this.app.vault.modify(file, content);

				// Move to sync folder if necessary
				const movedFile = await this.ensureInSyncFolder(file);

				// Sync the note to Ghost (overwrites Ghost post)
				await this.syncFileRouted(movedFile ?? file);

				new Notice(`Linked and synced note to Ghost: "${file.basename}"`);
			}
		} catch (error) {
			console.error('[Ghost Link] Error linking note:', error);
			new Notice(`Failed to link note: ${(error as Error).message}`);
		}
	}

	/**
	 * Ensure a file is inside the configured sync folder.
	 * Moves it there if it isn't. Returns the (possibly moved) TFile.
	 */
	private async ensureInSyncFolder(file: TFile): Promise<TFile | null> {
		const syncFolderPath = normalizePath(this.settings.syncFolder);
		const currentFolder = file.parent?.path ?? '';

		if (currentFolder === syncFolderPath) {
			return null; // Already in the right place
		}

		if (!this.app.vault.getAbstractFileByPath(syncFolderPath)) {
			await this.app.vault.createFolder(syncFolderPath);
		}

		const newPath = normalizePath(`${syncFolderPath}/${file.name}`);
		await this.app.fileManager.renameFile(file, newPath);

		return this.app.vault.getFileByPath(newPath);
	}

	async syncCurrentNote(file: TFile | null): Promise<void> {
		if (!file) {
			new Notice('No active file');
			return;
		}

		// Check credentials
		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			new Notice('Please configure ghost URL and admin API key first');
			return;
		}

		// Check if file has Ghost frontmatter — add properties automatically if missing
		let cache = this.app.metadataCache.getFileCache(file);
		const hasGhostProps = cache?.frontmatter && Object.keys(cache.frontmatter).some(key =>
			key.startsWith(this.settings.yamlPrefix)
		);

		if (!hasGhostProps) {
			const content = await this.app.vault.read(file);
			const newContent = addGhostPropertiesToContent(content, this.settings);
			await this.app.vault.modify(file, newContent);
			new Notice('Ghost properties added. Syncing…');
			// Wait for metadata cache to update before proceeding
			await new Promise(resolve => activeWindow.setTimeout(resolve, 300));
			cache = this.app.metadataCache.getFileCache(file);
		}

		// Check no_sync flag
		const noSyncKey = `${this.settings.yamlPrefix}no_sync`;
		if (cache?.frontmatter?.[noSyncKey] === true || cache?.frontmatter?.[noSyncKey] === 'true') {
			new Notice('Sync is disabled for this note (no_sync: true).');
			return;
		}

		// Check if file is in sync folder — move it if needed
		const syncFolderPath = normalizePath(this.settings.syncFolder);
		const currentFolder = file.parent?.path ?? '';

		let targetFile = file;
		if (currentFolder !== syncFolderPath) {
			new Notice(`Moving note to sync folder: ${this.settings.syncFolder}`);
			if (!this.app.vault.getAbstractFileByPath(syncFolderPath)) {
				await this.app.vault.createFolder(syncFolderPath);
			}
			const newPath = normalizePath(`${syncFolderPath}/${file.name}`);
			await this.app.fileManager.renameFile(file, newPath);
			const movedFile = this.app.vault.getFileByPath(newPath);
			if (!movedFile) {
				new Notice('Failed to move file to sync folder.');
				return;
			}
			targetFile = movedFile;
		}

		// Run sync with user feedback
		new Notice(`Syncing "${targetFile.basename}"…`);
		const success = await this.syncFileRouted(targetFile);

		if (!success) {
			new Notice(`Sync failed for "${targetFile.basename}". Check the console for details.`);
		}
	}

	async addGhostPropertiesToCurrentNote(file: TFile | null): Promise<void> {
		if (!file) {
			new Notice('No active file');
			return;
		}

		try {
			// Read current content
			const content = await this.app.vault.read(file);

			// Add Ghost properties (will add only missing ones)
			const newContent = addGhostPropertiesToContent(content, this.settings);

			// Check if anything was added
			if (newContent === content) {
				new Notice('This note already has all ghost properties');
				return;
			}

			// Write back to file
			await this.app.vault.modify(file, newContent);

			new Notice('Ghost properties added! This note will now sync with ghost.');

			// Move file to sync folder if not already there
			const syncFolderPath = normalizePath(this.settings.syncFolder);
			const currentFolder = file.parent?.path || '';

			if (currentFolder !== syncFolderPath) {
				// Ensure sync folder exists
				const syncFolder = this.app.vault.getAbstractFileByPath(syncFolderPath);
				if (!syncFolder) {
					await this.app.vault.createFolder(syncFolderPath);
				}

				// Move file
				const newPath = normalizePath(`${syncFolderPath}/${file.name}`);
				await this.app.fileManager.renameFile(file, newPath);

				new Notice(`File moved to sync folder: ${this.settings.syncFolder}`);
			}
		} catch (error) {
			console.error('Error adding Ghost properties:', error);
			new Notice(`Failed to add Ghost properties: ${(error as Error).message}`);
		}
	}

	async scheduleCurrentNote(file: TFile | null): Promise<void> {
		if (!file) {
			new Notice('No active file');
			return;
		}

		const apiKey = this.loadApiKey();
		if (!this.settings.ghostUrl || !apiKey) {
			new Notice('Please configure ghost URL and admin API key first');
			return;
		}

		// Fetch the most recent published or scheduled post
		let lastPost: GhostPost | undefined;
		try {
			const posts = await this.ghostClient.getPosts(
				'status:[published,scheduled]',
				10,
				'published_at desc'
			);
			lastPost = posts[0];
		} catch (error) {
			new Notice(`Failed to fetch posts from Ghost: ${(error as Error).message}`);
			return;
		}

		// Calculate the new scheduled date
		const base = lastPost?.published_at ? new Date(lastPost.published_at) : new Date();
		base.setDate(base.getDate() + this.settings.schedulingIntervalDays);

		const [hh, mm] = this.settings.defaultPublishTime.split(':').map(Number);
		base.setUTCHours(hh, mm, 0, 0);

		const newIso = base.toISOString();
		const newDateLabel = base.toLocaleString();

		// Read current frontmatter to check for existing date
		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const existingDate = cache?.frontmatter?.[`${this.settings.yamlPrefix}published_at`] as string | undefined;

		const applyDate = async (): Promise<void> => {
			const updated = upsertFrontmatterKeys(content, {
				[`${this.settings.yamlPrefix}published_at`]: newIso,
				[`${this.settings.yamlPrefix}published`]: 'true',
			});
			await this.app.vault.modify(file, updated);
			new Notice(`Scheduled for ${newDateLabel}`);
		};

		if (existingDate) {
			const existingLabel = new Date(existingDate).toLocaleString();
			new ConfirmScheduleModal(this.app, existingLabel, newDateLabel, () => {
				void applyDate();
			}).open();
		} else {
			await applyDate();
		}
	}
}

class ConfirmScheduleModal extends Modal {
	private currentDate: string;
	private newDate: string;
	private onConfirm: () => void;

	constructor(app: App, currentDate: string, newDate: string, onConfirm: () => void) {
		super(app);
		this.currentDate = currentDate;
		this.newDate = newDate;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Overwrite scheduled date?' });
		contentEl.createEl('p', {
			text: `This note already has a scheduled date: ${this.currentDate}`
		});
		contentEl.createEl('p', {
			text: `Replace with: ${this.newDate}`
		});

		const buttonRow = contentEl.createDiv({ cls: 'modal-button-container' });

		new ButtonComponent(buttonRow)
			.setButtonText('Overwrite')
			.setCta()
			.onClick(() => {
				this.onConfirm();
				this.close();
			});

		new ButtonComponent(buttonRow)
			.setButtonText('Cancel')
			.onClick(() => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class GhostWriterSettingTab extends PluginSettingTab {
	plugin: GhostWriterManagerPlugin;

	constructor(app: App, plugin: GhostWriterManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Render the multi-blog manager: one editable block per blog, plus "Add blog". */
	private renderBlogsSettings(containerEl: HTMLElement): void {
		const plugin = this.plugin;

		new Setting(containerEl).setHeading().setName('Ghost blogs');
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Each blog has its own address, key, and folder. A note publishes to the blog(s) named in its g_blog property; the last blog you pick becomes the default for new notes.'
		});

		plugin.settings.blogs.forEach((blog) => {
			const isDefault = blog.id === plugin.settings.defaultBlogId;
			new Setting(containerEl)
				.setHeading()
				.setName(`${blog.name || 'Untitled blog'}${isDefault ? '  ★ default' : ''}`)
				.addExtraButton(b => b
					.setIcon('star')
					.setTooltip('Set as default')
					.onClick(async () => { plugin.settings.defaultBlogId = blog.id; await plugin.saveSettings(); this.display(); }))
				.addExtraButton(b => b
					.setIcon('trash')
					.setTooltip('Remove blog')
					.onClick(async () => {
						plugin.settings.blogs = plugin.settings.blogs.filter(x => x.id !== blog.id);
						if (plugin.settings.defaultBlogId === blog.id) {
							plugin.settings.defaultBlogId = plugin.settings.blogs[0]?.id ?? '';
						}
						await plugin.saveSettings();
						this.display();
					}));

			new Setting(containerEl).setName('Name')
				.addText(t => t.setValue(blog.name).onChange(async v => { blog.name = v.trim(); await plugin.saveSettings(); }));
			new Setting(containerEl).setName('Site address')
				.addText(t => t.setPlaceholder('https://yourblog.com').setValue(blog.url).onChange(async v => { blog.url = v.trim(); await plugin.saveSettings(); }));
			new Setting(containerEl).setName('Key secret name')
				.setDesc('Name of the keychain secret holding the admin key')
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.addText(t => t.setPlaceholder('secret name').setValue(blog.apiKeySecretName).onChange(async v => { blog.apiKeySecretName = v.trim(); await plugin.saveSettings(); }))
				.addExtraButton(b => b.setIcon('key').setTooltip('Open keychain settings').onClick(() => {
					const a = this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } };
					a.setting.open(); a.setting.openTabById('keychain');
				}));
			new Setting(containerEl).setName('Folder')
				.setDesc("Vault folder for this blog's posts")
				.addText(t => t.setPlaceholder('Ghost posts').setValue(blog.folder).onChange(async v => { blog.folder = v.trim(); await plugin.saveSettings(); }));
			new Setting(containerEl).setName('Test connection')
				.addButton(btn => btn.setButtonText('Test').onClick(async () => {
					const title = await plugin.getClientForBlog(blog).testConnection();
					new Notice(title ? `Connected to ${title}` : `Failed to connect to ${blog.name}`);
				}));
		});

		new Setting(containerEl).addButton(b => b.setButtonText('Add blog').setCta().onClick(async () => {
			const blog: GhostBlog = { id: plugin.genBlogId(), name: 'New blog', url: '', apiKeySecretName: 'ghost-api-key', folder: 'Ghost Posts' };
			plugin.settings.blogs.push(blog);
			if (!plugin.settings.defaultBlogId) plugin.settings.defaultBlogId = blog.id;
			await plugin.saveSettings();
			this.display();
		}));
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Ghost blogs manager (URL, API key, and folder per blog)
		this.renderBlogsSettings(containerEl);

		// Sync settings heading
		new Setting(containerEl)
			.setHeading()
			.setName('Sync settings');

		new Setting(containerEl)
			.setName('Sync interval')
			.setDesc('How often to check for changes (in minutes)')
			.addText(text => text
				.setPlaceholder('15')
				.setValue(String(this.plugin.settings.syncInterval))
				.onChange(async (value) => {
					const interval = parseInt(value);
					if (!isNaN(interval) && interval > 0) {
						this.plugin.settings.syncInterval = interval;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('YAML prefix')
			.setDesc('Prefix for ghost metadata in frontmatter (e.g., "ghost_" will create ghost_status, ghost_tags)')
			.addText(text => text
				.setPlaceholder('Prefix used in YAML keys')
				.setValue(this.plugin.settings.yamlPrefix)
				.onChange(async (value) => {
					this.plugin.settings.yamlPrefix = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show sync notifications')
			.setDesc('Show notification popups when syncing files (status bar always shows sync status)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showSyncNotifications)
				.onChange(async (value) => {
					this.plugin.settings.showSyncNotifications = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setHeading()
			.setName('Scheduling');

		new Setting(containerEl)
			.setName('Interval between posts')
			.setDesc('Number of days between scheduled publications')
			.addText(text => text
				.setPlaceholder('7')
				.setValue(String(this.plugin.settings.schedulingIntervalDays))
				.onChange(async (value) => {
					const days = parseInt(value);
					if (!isNaN(days) && days > 0) {
						this.plugin.settings.schedulingIntervalDays = days;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Default publish time')
			.setDesc('Time of day for scheduled posts (e.g. 09:00).')
			.addText(text => text
				.setPlaceholder('09:00')
				.setValue(this.plugin.settings.defaultPublishTime)
				.onChange(async (value) => {
					if (/^\d{2}:\d{2}$/.test(value.trim())) {
						this.plugin.settings.defaultPublishTime = value.trim();
						await this.plugin.saveSettings();
					}
				}));
	}
}

