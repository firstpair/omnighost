import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TAbstractFile, TFolder, normalizePath, debounce, Modal, ButtonComponent, parseYaml, stringifyYaml, setIcon } from 'obsidian';
import { GhostWriterSettings, DEFAULT_SETTINGS, GhostPost, GhostBlog, TitlePrimarySource } from './src/types';
import { GhostAPIClient } from './src/ghost/api-client';
import { generateNewPostTemplate, addGhostPropertiesToContent } from './src/templates';
import { SyncEngine } from './src/sync/sync-engine';
import { CalendarView, CALENDAR_VIEW_TYPE } from './src/views/calendar-view';
import { ImportFromGhostModal } from './src/modals/import-from-ghost-modal';
import { LinkToGhostModal } from './src/modals/link-to-ghost-modal';
import { EditGhostPropertiesModal, GhostPropsForm } from './src/modals/edit-properties-modal';
import { MigratePrefixModal } from './src/modals/migrate-prefix-modal';
import { SelectBlogsModal } from './src/modals/select-blogs-modal';
import { upsertGhostMetadata, splitFrontmatter, joinFrontmatter, upsertFrontmatterKeys, removeFrontmatterKeys, parseGhostMetadata, migrateFrontmatterPrefix, yamlString, yamlStringArray } from './src/frontmatter-parser';
import { htmlToMarkdown } from './src/converters/html-to-markdown';
import { parseTextpack, ParsedTextpack } from './src/importers/textpack';
import { analyzeTextpackTitle, normalizeTextpackTitle } from './src/title-policy';
import type { TextpackTitleOptions } from './src/title-policy';
import { paywallDecorationPlugin, paywallDeduplicateExtension } from './src/editor/paywall-decoration';
import { buildGhostEditorUrl, ghostHostname, normalizeGhostSiteUrl } from './src/ghost/url';

// ⚠️ IMPORTANT: Set to false before production build/release
// Development mode flag - enables auto-sync on file changes (2s debounce)
// Production mode - only syncs according to configured interval
const DEV_MODE = false;

/** One deletable note↔post link, used by the bulk-delete flow. */
interface BulkDeleteItem {
	blogId: string;
	blogName: string;
	ghostId: string;
	title: string;
	published: boolean;
	path: string;
}

interface BulkDeleteOptions {
	heading: string;
	subtext: string;
	deleteLocal: boolean;
	items: BulkDeleteItem[];
}

type OrphanDecision = 'delete' | 'keep' | 'later';

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
	/** Per-blog periodic-sync timers, keyed by blog id. */
	private blogSyncTimers = new Map<string, number>();
	/** In-memory index of synced notes: file path → { blog id → ghost post id }. */
	/** In-memory index of synced notes: file path → its deletable note↔post links. */
	private ghostIndex = new Map<string, BulkDeleteItem[]>();
	/** Folders deleted since the last batch tick (collected to detect a cascade). */
	private pendingDeletedFolders: string[] = [];
	private deleteBatchTimer?: number;

	async onload() {
		await this.loadSettings();
		await this.loadImageCache();
		await this.migrateLegacyImageCache();
		await this.migrateBlogs();

		const defaultCredentials = this.defaultGhostClientCredentials();

		// Initialize Ghost API client
		this.ghostClient = new GhostAPIClient(
			defaultCredentials.url,
			defaultCredentials.apiKey,
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

		// In-memory index of synced notes (path → blog id → ghost post id), rebuilt on
		// layout-ready and kept fresh on metadata changes. A folder-delete cascade is
		// batched and offered as a bulk-delete checklist — nothing is deleted silently.
		this.ghostIndex = new Map();
		this.pendingDeletedFolders = [];
		this.app.workspace.onLayoutReady(() => this.rebuildGhostIndex());
		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.indexFile(file)));
		this.registerEvent(this.app.vault.on('rename', (af, oldPath) => this.reindexRenamed(af, normalizePath(oldPath))));
		this.registerEvent(
			this.app.vault.on('delete', (af) => {
				if (!this.settings.promptDeleteOnFolderDelete) return;
				if (af instanceof TFolder) {
					this.pendingDeletedFolders.push(normalizePath(af.path));
					this.scheduleDeleteBatch();
				}
			})
		);

		// Textpacks dropped into the vault (e.g. saved from the iOS Files app,
		// where Obsidian cannot appear in "Open With…") are imported automatically:
		// scan what arrived while the app was closed, then watch for new ones.
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.autoImportTextpacks) void this.importVaultTextpacks(false);
			this.registerEvent(this.app.vault.on('create', (af) => {
				if (!this.settings.autoImportTextpacks) return;
				if (af instanceof TFile && af.extension === 'textpack') {
					// Small delay: Files/iCloud may still be flushing the copy.
					window.setTimeout(() => { void this.importVaultTextpack(af); }, 800);
				}
			}));
		});

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
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;
				void this.addGhostPropertiesToCurrentNote(file);
			}
		});

		// Add command to sync current note
		this.addCommand({
			id: 'sync-current-note',
			name: 'Sync current note to ghost',
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;
				void this.syncCurrentNote(file);
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
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;
				void this.seedActiveNoteFromGhost(file);
			}
		});

		// Edit Ghost properties of the current note via a modal with dropdowns
		this.addCommand({
			id: 'edit-ghost-properties',
			name: 'Edit ghost properties (modal)',
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;
				void this.openEditPropertiesModal(file);
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
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;
				this.openSetBlogsModal(file);
			}
		});

		// Import all posts from a Ghost blog into its folder
		this.addCommand({
			id: 'import-all-posts',
			name: 'Import all posts from a ghost blog',
			callback: () => { this.openImportAllModal(); }
		});

		// Import a .textpack (zipped TextBundle: markdown + images) as a blog note
		this.addCommand({
			id: 'import-textpack',
			name: 'Import textpack',
			callback: () => { new ImportTextpackModal(this.app, this).open(); }
		});

		// Import every .textpack file currently sitting in the vault
		this.addCommand({
			id: 'import-vault-textpacks',
			name: 'Import textpacks found in vault',
			callback: () => { void this.importVaultTextpacks(true); }
		});

		// Bulk delete: pick synced notes and remove their Ghost posts (and local notes)
		this.addCommand({
			id: 'bulk-delete-ghost-posts',
			name: 'Bulk delete posts (local notes + ghost)',
			callback: () => { this.openBulkDeleteCommand(); }
		});

		// One-shot upgrade of existing notes to domain-keyed blog references
		this.addCommand({
			id: 'normalize-blog-references',
			name: 'Normalize blog references (use domain keys)',
			callback: () => {
				new SimpleConfirmModal(
					this.app,
					'Normalize blog references?',
					"Rewrites g_blog and per-blog id/URL keys across your notes to use each blog's domain as a stable key, so renaming a blog won't break references. Values are preserved.",
					'Normalize',
					(ok) => { if (ok) void this.normalizeBlogReferences(); }
				).open();
			}
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
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;

				const cache = this.app.metadataCache.getFileCache(file);
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
				const { blog, url, apiKey } = this.defaultGhostClientCredentials();
				if (!url || !apiKey) {
					new Notice('Please configure a blog URL and admin API key first');
					return;
				}

				try {
					console.debug('[Ghost Debug] Testing JWT generation...');
					console.debug('[Ghost Debug] Ghost URL:', url);
					console.debug('[Ghost Debug] API key format:', apiKey.includes(':') ? 'Valid (contains :)' : 'Invalid (missing :)');

					// Test connection which will generate and use a JWT
					const client = blog ? this.getClientForBlog(blog) : this.ghostClient;
					const result = await client.testConnection();
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
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;

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
			callback: () => {
				const file = this.activeMarkdownFile();
				if (!file) return;
				void this.scheduleCurrentNote(file);
			}
		});
	}

	private activeMarkdownFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			new Notice('Open a note first');
			return null;
		}
		return file;
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
		if (this.blogSyncTimers) {
			for (const id of this.blogSyncTimers.values()) window.clearInterval(id);
			this.blogSyncTimers.clear();
		}
		if (this.deleteBatchTimer) window.clearTimeout(this.deleteBatchTimer);
	}

	setupPeriodicSync() {
		if (!this.blogSyncTimers) this.blogSyncTimers = new Map();
		for (const id of this.blogSyncTimers.values()) window.clearInterval(id);
		this.blogSyncTimers.clear();

		for (const blog of this.settings.blogs) {
			const enabled = blog.syncEnabled !== false;
			const mins = blog.syncIntervalMinutes != null ? blog.syncIntervalMinutes : this.settings.syncInterval;
			if (!enabled || !mins || mins <= 0) continue;
			if (!this.loadApiKeyForSecret(blog.apiKeySecretName).trim()) continue;
			console.debug(`[Ghost Sync] Periodic sync for "${blog.name}" every ${mins} min`);
			const timer = window.setInterval(() => {
				console.debug(`[Ghost Sync] Running periodic sync for "${blog.name}"...`);
				void this.syncBlogFolder(blog);
			}, mins * 60 * 1000);
			this.blogSyncTimers.set(blog.id, timer);
		}
	}

	/** Auto-sync only the notes inside one blog's folder. */
	async syncBlogFolder(blog: GhostBlog): Promise<void> {
		const folder = normalizePath(blog.folder);
		const files = this.app.vault.getMarkdownFiles().filter(f =>
			!this.isArchivePath(f.path) && (f.path === folder || f.path.startsWith(folder + '/')));
		for (const f of files) {
			try {
				await this.syncFileRouted(f);
			} catch (e) {
				console.error('[Ghost Sync] periodic sync failed:', e);
			}
		}
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
		const { blog, url, apiKey } = this.defaultGhostClientCredentials();
		if (!url || !apiKey) {
			new Notice('Please configure a blog URL and admin API key first');
			return;
		}

		try {
			const client = blog ? this.getClientForBlog(blog) : this.ghostClient;
			const title = await client.testConnection();
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
		if (!this.hasAnyConfiguredBlogCredentials()) {
			new Notice('Please configure a blog URL and admin API key first');
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
			// Create in the default blog's folder (falls back to the root).
			const syncFolderPath = normalizePath(this.defaultBlog()?.folder || this.settings.syncFolder);
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
		const hasBlogKey = this.settings.blogs.some(b => this.loadApiKeyForSecret(b.apiKeySecretName).trim());
		const hasGlobal = !!(this.settings.ghostUrl && this.loadApiKeyForSecret(this.settings.ghostApiKeySecretName).trim());
		if (!hasBlogKey && !hasGlobal) {
			new Notice('Configure a blog (URL + admin API key) in settings first');
			return;
		}

		new ImportFromGhostModal(
			this.app,
			this.ghostClient,
			this.settings,
			async (post: GhostPost, ghostUrl: string, blog: GhostBlog | null) => {
				await this.importPostAsNote(post, ghostUrl, blog);
			},
			this
		).open();
	}

	/**
	 * Create a new Obsidian note from a fetched Ghost post. When `blog` is known
	 * (resolved from the source URL), the note is placed in that blog's folder and
	 * tagged with its domain key, and records that blog's per-blog id/url/public keys.
	 */
	private async importPostAsNote(post: GhostPost, ghostUrl: string, blog: GhostBlog | null): Promise<void> {
		try {
			const prefix = this.settings.yamlPrefix;
			const folderPath = normalizePath(blog ? blog.folder : this.settings.syncFolder);
			if (!this.app.vault.getAbstractFileByPath(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			const tags = (post.tags ?? []).map(t => t.name);
			const fm: Record<string, unknown> = {};
			if (blog) fm[`${prefix}blog`] = [this.blogDomainKey(blog)];
			fm[`${prefix}post_access`] = post.visibility ?? 'public';
			fm[`${prefix}published`] = post.status === 'published' || post.status === 'scheduled';
			fm[`${prefix}published_at`] = post.published_at ?? '';
			fm[`${prefix}featured`] = !!post.featured;
			fm[`${prefix}tags`] = tags;
			fm[`${prefix}excerpt`] = post.excerpt ?? '';
			fm[`${prefix}feature_image`] = post.feature_image ?? '';
			fm[`${prefix}no_sync`] = false;
			fm[`${prefix}slug`] = post.slug;
			if (blog) {
				const keys = this.blogKeys(blog);
				fm[keys.id] = post.id;
				fm[keys.url] = ghostUrl;
				if (post.url) fm[keys.pub] = post.url;
			}

			const title = post.title || 'Untitled Post';
			const safeFileName = title.replace(/[\\/:*?"<>|]/g, '-').trim();
			const filePath = normalizePath(`${folderPath}/${safeFileName}.md`);
			const bodyMarkdown = htmlToMarkdown(post.html ?? '');
			const content = `---\n${stringifyYaml(fm)}---\n\n# ${title}\n\n${bodyMarkdown}`;

			let finalPath = filePath;
			if (this.app.vault.getAbstractFileByPath(filePath)) {
				const ts = Date.now();
				finalPath = normalizePath(`${folderPath}/${safeFileName}-${ts}.md`);
			}

			const file = await this.app.vault.create(finalPath, content);
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);

			new Notice(`Imported: "${title}"${blog ? ` (${blog.name})` : ''}`);
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
		const prefix = this.settings.yamlPrefix;
		const cache = this.app.metadataCache.getFileCache(file);
		const fmObj = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const metadata = cache?.frontmatter ? parseGhostMetadata(cache.frontmatter, prefix) : null;
		if (!metadata?.slug) {
			new Notice(`Set ${prefix}slug on this note first to seed from Ghost`);
			return;
		}

		const blog = this.resolveBlogsForFile(file)[0];
		if (!blog || !this.loadApiKeyForSecret(blog.apiKeySecretName).trim()) {
			new Notice("This note's blog has no API key — set it in settings.");
			return;
		}
		if (this.readBlogId(fmObj, blog)) {
			new Notice(`This note is already linked to a post on ${blog.name}; nothing to seed.`);
			return;
		}

		this.syncEngine.setActiveBlog(this.getClientForBlog(blog), blog.url, blog.folder, false, undefined, blog.name);
		try {
			new Notice(`Looking up "${metadata.slug}" on ${blog.name}…`);
			await this.syncEngine.seedNoteFromGhostBySlug(file, metadata.slug);
		} catch (error) {
			new Notice(`Seed failed: ${(error as Error).message}`);
		} finally {
			this.restoreDefaultBlogContext();
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
		return ghostHostname(url);
	}

	/** Lowercased hostname of a URL, or '' if unparseable. */
	hostOf(url: string): string {
		return ghostHostname(url);
	}

	/** Root folder all blog folders nest under (the legacy sync folder, default "Ghost Posts"). */
	ghostPostsRoot(): string {
		return normalizePath((this.settings.syncFolder || 'Ghost Posts').trim() || 'Ghost Posts');
	}

	/** Derived folder for a blog: "<root>/<domain>", or the root itself if the URL has no host. */
	defaultFolderFor(blog: GhostBlog): string {
		const host = this.hostOf(blog.url);
		const root = this.ghostPostsRoot();
		return host ? normalizePath(`${root}/${host}`) : root;
	}

	/** True if any markdown file lives in this folder (or below). */
	folderHasNotes(folder: string): boolean {
		const f = normalizePath(folder || '');
		if (!f || f === '/') return false;
		return this.app.vault.getMarkdownFiles().some(x => x.path === f || x.path.startsWith(f + '/'));
	}

	/** Frontmatter-key-safe suffix for a blog name (e.g. "Chief Scientist" → "chief_scientist"). */
	private blogKeySuffix(name: string): string {
		return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'blog';
	}

	/** Stable, human-readable key for a blog: its domain (preferred) else lowercased name. */
	blogDomainKey(blog: GhostBlog): string {
		return this.hostOf(blog.url) || blog.name.trim().toLowerCase();
	}

	/** Frontmatter-key suffix for a blog, derived from its domain (stable across renames). */
	blogKeyFor(blog: GhostBlog): string {
		return this.blogKeySuffix(this.hostOf(blog.url) || blog.name);
	}

	/** Does a g_blog token refer to this blog? Matches current domain, current name, or any alias. */
	blogMatchesToken(blog: GhostBlog, token: string): boolean {
		const t = token.trim().toLowerCase();
		if (t === this.blogDomainKey(blog) || t === blog.name.trim().toLowerCase()) return true;
		return Array.isArray(blog.aliases) && blog.aliases.includes(t);
	}

	/** YAML array literal of stable domain keys for the g_blog property. */
	blogPropertyYaml(blogs: GhostBlog[]): string {
		return `[${blogs.map(b => `"${this.blogDomainKey(b)}"`).join(', ')}]`;
	}

	/** The frontmatter key names that store this blog's id / editor url / public url (writes target the domain suffix). */
	blogKeys(blog: GhostBlog): { id: string; url: string; pub: string } {
		const p = this.settings.yamlPrefix;
		const s = this.blogKeyFor(blog);
		return { id: `${p}id_${s}`, url: `${p}url_${s}`, pub: `${p}public_url_${s}` };
	}

	/** Suffixes to try when READING a blog's per-blog keys: domain, current name, aliases. */
	blogReadSuffixes(blog: GhostBlog): string[] {
		const set = new Set<string>([this.blogKeyFor(blog), this.blogKeySuffix(blog.name), ...(blog.aliases ?? []).map(a => this.blogKeySuffix(a))]);
		return [...set];
	}

	/** Read a blog's stored post id from a note's frontmatter (domain/name/alias keys, or old g_ids map). */
	readBlogId(fmObj: Record<string, unknown>, blog: GhostBlog): string {
		const p = this.settings.yamlPrefix;
		const fmStr = (k: string) => typeof fmObj[k] === 'string' ? String(fmObj[k]) : '';
		for (const s of this.blogReadSuffixes(blog)) {
			const v = fmStr(`${p}id_${s}`);
			if (v) return v;
		}
		return this.readBlogMap(fmObj, `${p}ids`)[blog.name] || '';
	}

	/** Read a blog's stored public URL from a note's frontmatter. */
	readBlogPublicUrl(fmObj: Record<string, unknown>, blog: GhostBlog): string {
		const p = this.settings.yamlPrefix;
		const fmStr = (k: string) => typeof fmObj[k] === 'string' ? String(fmObj[k]) : '';
		for (const s of this.blogReadSuffixes(blog)) {
			const v = fmStr(`${p}public_url_${s}`);
			if (v) return v;
		}
		return this.readBlogMap(fmObj, `${p}public_urls`)[blog.name] || '';
	}

	/** Every per-blog id/url/public_url key name for a blog (domain + name/alias variants). */
	allBlogKeyNames(blog: GhostBlog): string[] {
		const p = this.settings.yamlPrefix;
		const names: string[] = [];
		for (const s of this.blogReadSuffixes(blog)) names.push(`${p}id_${s}`, `${p}url_${s}`, `${p}public_url_${s}`);
		return names;
	}

	/** The configured blog whose site host matches a pasted URL's host, else null. */
	blogForUrl(url: string): GhostBlog | null {
		const host = this.hostOf(url);
		if (!host) return null;
		return this.settings.blogs.find(b => this.hostOf(b.url) === host) ?? null;
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

	private defaultGhostClientCredentials(): { blog: GhostBlog | null; url: string; apiKey: string } {
		const blog = this.defaultBlog();
		if (blog) {
			return {
				blog,
				url: blog.url,
				apiKey: this.loadApiKeyForSecret(blog.apiKeySecretName)
			};
		}
		return {
			blog: null,
			url: this.settings.ghostUrl,
			apiKey: this.loadApiKey()
		};
	}

	private hasAnyConfiguredBlogCredentials(): boolean {
		return this.settings.blogs.some((blog) =>
			!!blog.url.trim() && !!this.loadApiKeyForSecret(blog.apiKeySecretName).trim()
		);
	}

	/** Migrate the legacy single-blog config into blogs[] on first run. */
	private async migrateBlogs(): Promise<void> {
		if (this.settings.blogs && this.settings.blogs.length > 0) {
			let changed = false;
			// Blogs configured before folder auto-derivation keep their folder as-is.
			for (const b of this.settings.blogs) {
				if (b.folderAuto === undefined) { b.folderAuto = false; changed = true; }
			}
			if (!this.settings.defaultBlogId || !this.settings.blogs.some(b => b.id === this.settings.defaultBlogId)) {
				this.settings.defaultBlogId = this.settings.blogs[0].id;
				changed = true;
			}
			if (changed) await this.saveSettings();
			return;
		}
		const blog: GhostBlog = {
			id: this.genBlogId(),
			name: this.deriveBlogName(this.settings.ghostUrl) || 'My blog',
			url: this.settings.ghostUrl,
			apiKeySecretName: this.settings.ghostApiKeySecretName,
			folder: this.settings.syncFolder,
			folderAuto: false
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

	/**
	 * Ensure a blog has its OWN keychain secret name. If it's empty or shared with
	 * another blog, assign a unique one derived from the blog id. Without this, two
	 * blogs reading the same secret get the same admin key → 401 on the second site.
	 */
	ensureUniqueSecretName(blog: GhostBlog): void {
		const shared = !blog.apiKeySecretName
			|| this.settings.blogs.some(b => b.id !== blog.id && b.apiKeySecretName === blog.apiKeySecretName);
		if (shared) blog.apiKeySecretName = `omnighost-key-${blog.id}`;
	}

	/** Blogs that share a keychain secret name (a key collision → wrong-key 401s). */
	collidingSecretBlogs(): GhostBlog[] {
		const counts = new Map<string, number>();
		for (const b of this.settings.blogs) {
			if (b.apiKeySecretName) counts.set(b.apiKeySecretName, (counts.get(b.apiKeySecretName) ?? 0) + 1);
		}
		return this.settings.blogs.filter(b => b.apiKeySecretName && (counts.get(b.apiKeySecretName) ?? 0) > 1);
	}

	/** The default (last-selected) blog, or the first, or null. */
	defaultBlog(): GhostBlog | null {
		return this.settings.blogs.find(b => b.id === this.settings.defaultBlogId)
			?? this.settings.blogs[0] ?? null;
	}

	/** Blogs explicitly named by a note's g_blog property (empty if none match). */
	private explicitBlogsForFile(file: TFile): GhostBlog[] {
		const prefix = this.settings.yamlPrefix;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const raw = fm ? fm[`${prefix}blog`] : undefined;
		const tokens = Array.isArray(raw)
			? raw.map(v => String(v).trim()).filter(Boolean)
			: (typeof raw === 'string' && raw.trim() ? [raw.trim()] : []);
		const seen = new Set<string>();
		const found: GhostBlog[] = [];
		for (const t of tokens) {
			const b = this.settings.blogs.find(bl => this.blogMatchesToken(bl, t));
			if (b && !seen.has(b.id)) { seen.add(b.id); found.push(b); }
		}
		return found;
	}

	/** The blog whose folder contains this path (longest folder wins), if any. */
	private blogForPath(path: string): GhostBlog | null {
		let best: GhostBlog | null = null;
		let bestLen = -1;
		for (const b of this.settings.blogs) {
			const f = normalizePath(b.folder);
			if (f && (path === f || path.startsWith(f + '/')) && f.length > bestLen) { best = b; bestLen = f.length; }
		}
		return best;
	}

	/** Resolve which blog(s) a note targets: its g_blog property, else the blog whose
	 *  folder contains it (a note dropped in "Ghost Posts/chief.sc/" publishes there),
	 *  else the default blog. Notes directly under the shared root stay with the
	 *  default blog — a blog whose folder IS the root never wins by location alone. */
	resolveBlogsForFile(file: TFile): GhostBlog[] {
		const explicit = this.explicitBlogsForFile(file);
		if (explicit.length > 0) return explicit;
		const inferred = this.blogForPath(file.path);
		if (inferred && normalizePath(inferred.folder) !== this.ghostPostsRoot()) return [inferred];
		const def = this.defaultBlog();
		return def ? [def] : [];
	}

	/** Move a note to `dest`, creating parent folders and de-colliding an occupied
	 *  destination with a timestamp suffix. Uses fileManager.renameFile so vault
	 *  links stay intact. Returns the final destination path, or null if no-op. */
	private async moveNoteTo(file: TFile, dest: string): Promise<string | null> {
		if (dest === file.path) return null;
		const parent = dest.split('/').slice(0, -1).join('/');
		if (parent && !this.app.vault.getAbstractFileByPath(parent)) {
			try { await this.app.vault.createFolder(parent); } catch { /* exists */ }
		}
		if (this.app.vault.getAbstractFileByPath(dest)) {
			const slash = dest.lastIndexOf('/');
			const dot = dest.lastIndexOf('.');
			const stamp = Date.now();
			dest = dot > slash ? `${dest.slice(0, dot)}-${stamp}${dest.slice(dot)}` : `${dest}-${stamp}`;
		}
		await this.app.fileManager.renameFile(file, dest);
		return dest;
	}

	/** The single blog a note is filed under when organizing folders: its first
	 *  explicit g_blog target, else the first blog it has a stored post id for,
	 *  else the blog whose folder contains it, else the default blog. */
	private organizeOwnerFor(file: TFile): GhostBlog | null {
		const explicit = this.explicitBlogsForFile(file);
		if (explicit.length > 0) return explicit[0];
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (fm) {
			const withId = this.settings.blogs.find(b => this.readBlogId(fm, b));
			if (withId) return withId;
		}
		const inferred = this.blogForPath(file.path);
		if (inferred && normalizePath(inferred.folder) !== this.ghostPostsRoot()) return inferred;
		return this.defaultBlog();
	}

	/** Move every blog's notes under "<root>/<domain>" and re-point the blog folders.
	 *  Notes are moved with fileManager.renameFile so vault links stay intact. */
	async organizeBlogFolders(): Promise<{ moved: number; failed: number }> {
		let moved = 0;
		let failed = 0;
		// Plan targets against the CURRENT layout before mutating any folder.
		const plans: { blog: GhostBlog; from: string; to: string }[] = [];
		const fromCounts = new Map<string, number>();
		for (const blog of this.settings.blogs) {
			if (!this.hostOf(blog.url)) continue; // no domain to derive a folder from
			const from = normalizePath(blog.folder);
			const to = this.defaultFolderFor(blog);
			plans.push({ blog, from, to });
			fromCounts.set(from, (fromCounts.get(from) ?? 0) + 1);
		}
		const owners = new Map<string, string>(); // file path → owning blog id
		for (const { from } of plans) {
			for (const f of this.app.vault.getMarkdownFiles()) {
				if (owners.has(f.path) || this.isArchivePath(f.path)) continue;
				if (f.path === from || f.path.startsWith(from + '/')) {
					owners.set(f.path, this.organizeOwnerFor(f)?.id ?? '');
				}
			}
		}
		for (const { blog, from, to } of plans) {
			if (from !== to) {
				for (const [path, ownerId] of owners) {
					if (ownerId !== blog.id) continue;
					if (path !== from && !path.startsWith(from + '/')) continue;
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) continue;
					const rel = path.startsWith(from + '/') ? path.slice(from.length + 1) : file.name;
					try {
						if (await this.moveNoteTo(file, normalizePath(`${to}/${rel}`))) moved++;
					} catch (e) {
						console.error('[Ghost] organize move failed:', path, e);
						failed++;
					}
				}
				// The folder's archive moves with it — but only when the source folder
				// belongs to exactly one blog (a shared archive would be ambiguous).
				if (fromCounts.get(from) === 1) {
					const archPrefix = `${from}/${this.archiveName()}/`;
					for (const f of this.app.vault.getMarkdownFiles().filter(x => x.path.startsWith(archPrefix))) {
						try {
							if (await this.moveNoteTo(f, normalizePath(`${to}/${this.archiveName()}/${f.path.slice(archPrefix.length)}`))) moved++;
						} catch (e) {
							console.error('[Ghost] organize archive move failed:', f.path, e);
							failed++;
						}
					}
				}
			}
			blog.folder = to;
			blog.folderAuto = true;
		}
		await this.saveSettings();
		this.setupPeriodicSync();
		// Re-key the delete-offer index to the new layout so deleting a now-empty
		// old folder never surfaces the moved notes' posts.
		this.rebuildGhostIndex();
		return { moved, failed };
	}

	private restoreDefaultBlogContext(): void {
		const d = this.defaultBlog();
		if (d) this.syncEngine.setActiveBlog(this.getClientForBlog(d), d.url, d.folder, false);
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

	/** Per-blog published/draft status + public URL for a note, for every target blog. */
	private buildBlogStatuses(file: TFile, fmObj: Record<string, unknown>): { name: string; url: string; published: boolean }[] {
		const prefix = this.settings.yamlPrefix;
		const targets = this.resolveBlogsForFile(file);
		if (targets.length === 0) return [];
		const pubVal = fmObj[`${prefix}published`];
		const isPub = pubVal === true || pubVal === 'true';
		return targets.map(b => {
			const url = this.readBlogPublicUrl(fmObj, b);
			return { name: b.name, url, published: isPub && !!url };
		});
	}

	/**
	 * Sync a note to a set of blogs. All blogs are equal: each is matched by its own
	 * stored id (g_id_<domain>, with name/alias fallbacks) else by slug, and after
	 * syncing the note records per-blog g_id_/g_url_/g_public_url_<domain> for it.
	 * The shared g_slug is written once. No blog "owns" the bare g_id/g_url keys.
	 */
	async syncFileToBlogs(file: TFile, blogs: GhostBlog[]): Promise<boolean> {
		if (blogs.length === 0) {
			new Notice('No ghost blog configured — add one in settings.');
			return false;
		}
		const prefix = this.settings.yamlPrefix;

		const content0 = await this.app.vault.read(file);
		let fmObj: Record<string, unknown> = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		const split0 = splitFrontmatter(content0);
		if (split0) {
			try {
				const d = parseYaml(split0.raw) as unknown;
				if (d && typeof d === 'object') fmObj = d as Record<string, unknown>;
			} catch (e) {
				console.debug('[Ghost Sync] Cannot sync note with invalid frontmatter:', file.path, e);
				new Notice(`Cannot sync "${file.basename}": frontmatter YAML is invalid. Fix the red properties and try again.`);
				return false;
			}
		}
		const fmStr = (k: string) => typeof fmObj[k] === 'string' ? String(fmObj[k]) : '';
		const hadOldMaps = `${prefix}ids` in fmObj || `${prefix}public_urls` in fmObj;
		const hadLegacyClean = [`${prefix}id`, `${prefix}url`, `${prefix}public_url`].some(k => k in fmObj);

		let ok = true;
		const updates: Record<string, string> = {};
		const staleKeys: string[] = [];
		let wroteSlug = !!fmStr(`${prefix}slug`);

		for (const blog of blogs) {
			const keys = this.blogKeys(blog);
			const knownId = this.readBlogId(fmObj, blog) || undefined;
			if (!this.loadApiKeyForSecret(blog.apiKeySecretName).trim()) {
				new Notice(`Blog "${blog.name}" has no API key — set it in settings.`);
				ok = false;
				continue;
			}
			this.syncEngine.setActiveBlog(this.getClientForBlog(blog), blog.url, blog.folder, false, knownId, blog.name);
			try {
				ok = (await this.syncEngine.syncFileToGhost(file)) && ok;
			} catch (e) {
				new Notice(`Sync to ${blog.name} failed: ${(e as Error).message}`);
				ok = false;
			}
			const post = this.syncEngine.lastSyncedPost;
			if (post) {
				const editorUrl = buildGhostEditorUrl(blog.url, post.id);
				const isPublic = post.status === 'published' || post.status === 'scheduled';
				if (fmStr(keys.id) !== post.id) updates[keys.id] = post.id;
				if (fmStr(keys.url) !== editorUrl) updates[keys.url] = editorUrl;
				if (isPublic && post.url && fmStr(keys.pub) !== post.url) {
					updates[keys.pub] = post.url;
				} else if (!isPublic && keys.pub in fmObj) {
					staleKeys.push(keys.pub);
				}
				if (!wroteSlug && post.slug) { updates[`${prefix}slug`] = post.slug; wroteSlug = true; }
				// Purge name/alias-suffix variants now that the domain key is authoritative.
				for (const k of this.blogReadSuffixes(blog)) {
					if (`${prefix}id_${k}` !== keys.id && `${prefix}id_${k}` in fmObj) staleKeys.push(`${prefix}id_${k}`);
					if (`${prefix}url_${k}` !== keys.url && `${prefix}url_${k}` in fmObj) staleKeys.push(`${prefix}url_${k}`);
					if (`${prefix}public_url_${k}` !== keys.pub && `${prefix}public_url_${k}` in fmObj) staleKeys.push(`${prefix}public_url_${k}`);
				}
			}
		}
		this.restoreDefaultBlogContext();

		const toRemove = [...new Set(staleKeys)];
		if (hadOldMaps) toRemove.push(`${prefix}ids`, `${prefix}public_urls`);
		if (hadLegacyClean) toRemove.push(`${prefix}id`, `${prefix}url`, `${prefix}public_url`);
		if (Object.keys(updates).length > 0 || toRemove.length > 0) {
			await this.app.vault.process(file, (raw) => {
				let content = raw;
				if (Object.keys(updates).length > 0) content = upsertFrontmatterKeys(content, updates);
				if (toRemove.length > 0) content = removeFrontmatterKeys(content, toRemove);
				return content;
			});
		}
		return ok;
	}

	/** Sync a note to the blog(s) named in its g_blog property (else the default).
	 *  When interactive, warn about posts on blogs no longer listed in g_blog. */
	async syncFileRouted(file: TFile, interactive = false): Promise<boolean> {
		const named = this.resolveBlogsForFile(file);
		const ok = await this.syncFileToBlogs(file, named);
		if (interactive) {
			const orphans = this.orphanedJobsForFile(file);
			if (orphans.length) this.promptOrphanedPosts(file, orphans);
		}
		return ok;
	}

	/** Sync every note across all blog folders, each to its own blog(s). */
	async syncAllRouted(): Promise<void> {
		const files = new Set<TFile>();
		for (const blog of this.settings.blogs) {
			const folder = normalizePath(blog.folder);
			this.app.vault.getMarkdownFiles()
				.filter(f => !this.isArchivePath(f.path) && (f.path === folder || f.path.startsWith(folder + '/')))
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
				// Write stable domain keys, not display names (names break on rename).
				const yaml = this.blogPropertyYaml(chosen);
				await this.app.vault.process(file, (content) =>
					upsertFrontmatterKeys(content, { [`${prefix}blog`]: yaml }));
				this.settings.defaultBlogId = chosen[chosen.length - 1].id; // last = default
				await this.saveSettings();
				new Notice(`Note will publish to: ${chosen.map(b => b.name).join(', ')}`);
			}
		).open();
	}

	/** Import a parsed .textpack as a new note in `blog`'s folder: write its
	 *  images under assets/<slug>/, rewrite the refs, add Ghost frontmatter
	 *  (blog, slug, tags, excerpt from the bundle's metadata), open the note. */
	async importTextpack(pack: ParsedTextpack, blog: GhostBlog, titleOptions?: TextpackTitleOptions): Promise<void> {
		const prefix = this.settings.yamlPrefix;
		const slug = (pack.ghost.slug || pack.name).toLowerCase()
			.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'post';
		const folder = normalizePath(blog.folder || this.settings.syncFolder);
		const titleAnalysis = analyzeTextpackTitle(pack);
		const normalizedTitle = normalizeTextpackTitle(pack, titleOptions ?? {
			primarySource: titleAnalysis.defaultSource,
			updateSecondary: true
		});
		const title = normalizedTitle.title;
		const fileName = title.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || slug;

		let markdown = normalizedTitle.markdown;
		if (pack.assets.size > 0) {
			const assetDir = normalizePath(`${folder}/assets/${slug}`);
			if (!this.app.vault.getAbstractFileByPath(assetDir)) {
				try { await this.app.vault.createFolder(assetDir); } catch { /* exists */ }
			}
			for (const [base, data] of pack.assets) {
				const path = normalizePath(`${assetDir}/${base}`);
				const buf = data.slice().buffer;
				const existing = this.app.vault.getAbstractFileByPath(path);
				if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buf);
				else await this.app.vault.createBinary(path, buf);
			}
			// Bundle refs are assets/<file>; the note lives in the blog folder, so
			// they resolve note-relatively once scoped by slug: assets/<slug>/<file>.
			markdown = markdown.replace(/(!\[[^\]]*\]\()assets\//g, `$1assets/${slug}/`);
		}

		let content = addGhostPropertiesToContent(markdown, this.settings);
		const upserts: Record<string, string> = {
			[`${prefix}blog`]: this.blogPropertyYaml([blog]),
			[`${prefix}slug`]: slug,
		};
		if (pack.ghost.tags && pack.ghost.tags.length > 0) {
			upserts[`${prefix}tags`] = yamlStringArray(pack.ghost.tags, true);
		}
		if (pack.ghost.excerpt) upserts[`${prefix}excerpt`] = yamlString(pack.ghost.excerpt, true);
		content = upsertFrontmatterKeys(content, upserts);

		if (!this.app.vault.getAbstractFileByPath(folder)) {
			try { await this.app.vault.createFolder(folder); } catch { /* exists */ }
		}
		let notePath = normalizePath(`${folder}/${fileName}.md`);
		if (this.app.vault.getAbstractFileByPath(notePath)) {
			notePath = normalizePath(`${folder}/${fileName}-${Date.now()}.md`);
		}
		const file = await this.app.vault.create(notePath, content);
		await this.app.workspace.getLeaf(false).openFile(file);
		const imgs = pack.assets.size;
		new Notice(`Imported "${title}" → ${blog.name}${imgs ? ` (${imgs} image${imgs === 1 ? '' : 's'})` : ''}`);
	}

	/** Import one .textpack file that lives inside the vault, then trash the pack.
	 *  Target blog: the pack's own metadata, else the blog whose folder holds the
	 *  file, else the default blog. */
	async importVaultTextpack(file: TFile): Promise<boolean> {
		// The create event may race the trash() of a pack just imported.
		if (!this.app.vault.getAbstractFileByPath(file.path)) return false;
		try {
			const buf = await this.app.vault.readBinary(file);
			const pack = await parseTextpack(buf, file.name);
			const hinted = pack.ghost.blog
				? this.settings.blogs.find(b => this.blogMatchesToken(b, pack.ghost.blog as string))
				: null;
			const blog = hinted ?? this.blogForPath(file.path) ?? this.defaultBlog();
			if (!blog) {
				new Notice(`Found ${file.name} but no blog is configured — add one in settings.`);
				return false;
			}
			await this.importTextpack(pack, blog);
			await this.app.fileManager.trashFile(file);
			return true;
		} catch (e) {
			console.error('[Ghost] textpack import failed:', file.path, e);
			new Notice(`Textpack import failed for ${file.name}: ${(e as Error).message}`);
			return false;
		}
	}

	/** Import every .textpack file currently in the vault. */
	async importVaultTextpacks(notifyWhenNone: boolean): Promise<void> {
		const packs = this.app.vault.getFiles().filter(f => f.extension === 'textpack');
		if (packs.length === 0) {
			if (notifyWhenNone) new Notice('No .textpack files found in the vault.');
			return;
		}
		for (const p of packs) await this.importVaultTextpack(p);
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
				const editorUrl = buildGhostEditorUrl(blog.url, post.id);
				await this.writePostAsNoteInFolder(post, editorUrl, folder, blog);
				count++;
			}
			new Notice(`Imported ${count} post${count === 1 ? '' : 's'} from ${blog.name} into ${folder}`);
		} catch (e) {
			new Notice(`Import from ${blog.name} failed: ${(e as Error).message}`);
		}
	}

	/** Write one Ghost post as a note in a folder, tagged with its blog (per-blog keys). */
	private async writePostAsNoteInFolder(post: GhostPost, editorUrl: string, folder: string, blog: GhostBlog): Promise<void> {
		const prefix = this.settings.yamlPrefix;
		const keys = this.blogKeys(blog);
		const tags = (post.tags ?? []).map(t => t.name);
		const isPub = post.status === 'published' || post.status === 'scheduled';
		const fm: Record<string, unknown> = {
			[`${prefix}blog`]: [this.blogDomainKey(blog)],
			[`${prefix}post_access`]: post.visibility ?? 'public',
			[`${prefix}published`]: isPub,
			[`${prefix}published_at`]: post.published_at ?? '',
			[`${prefix}featured`]: !!post.featured,
			[`${prefix}tags`]: tags,
			[`${prefix}excerpt`]: post.excerpt ?? '',
			[`${prefix}feature_image`]: post.feature_image ?? '',
			[`${prefix}no_sync`]: false,
			[`${prefix}slug`]: post.slug,
			[keys.id]: post.id,
			[keys.url]: editorUrl,
		};
		if (post.url) fm[keys.pub] = post.url;
		const title = post.title || 'Untitled Post';
		const safe = title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled Post';
		const body = htmlToMarkdown(post.html ?? '');
		const content = `---\n${stringifyYaml(fm)}---\n\n# ${title}\n\n${body}`;
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
				// Cheap no-op check first so unaffected notes are not rewritten.
				const before = await this.app.vault.cachedRead(file);
				if (!migrateFrontmatterPrefix(before, oldPrefix, newPrefix).changed) continue;
				await this.app.vault.process(file, (content) => migrateFrontmatterPrefix(content, oldPrefix, newPrefix).content);
				count++;
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
			const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
			const tagsYaml = yamlStringArray(tags, true);
			const ghostFields: Record<string, string> = {
				post_access: form.visibility,
				published: form.status === 'draft' ? 'false' : 'true',
				published_at: yamlString(form.status === 'schedule' && form.publishedAt ? form.publishedAt : '', true),
				featured: form.featured ? 'true' : 'false',
				cover_from_first_image: form.coverFromFirstImage ? 'true' : 'false',
				excerpt: yamlString(form.excerpt, true),
				feature_image: yamlString(form.featureImage, true),
				slug: yamlString(form.slug, true),
				tags: tagsYaml
			};
			const selectedBlogs = form.blogIds
				.map(id => this.settings.blogs.find(b => b.id === id))
				.filter((b): b is GhostBlog => !!b);
			if (selectedBlogs.length > 0) {
				// Write stable domain keys, not display names (names break on rename).
				ghostFields.blog = this.blogPropertyYaml(selectedBlogs);
			}
			await this.app.vault.process(file, (content) => upsertGhostMetadata(content, ghostFields, prefix));
			if (selectedBlogs.length > 0) {
				this.settings.defaultBlogId = selectedBlogs[selectedBlogs.length - 1].id; // last = default
				await this.saveSettings();
			}
			new Notice('Ghost properties saved');
			if (doSync) {
				try {
					const synced = await this.syncFileToBlogs(file, selectedBlogs.length ? selectedBlogs : this.resolveBlogsForFile(file));
					if (!synced) {
						new Notice('Ghost properties saved, but sync did not complete. Check the note properties and blog settings.');
					}
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
		const hasBlogKey = this.settings.blogs.some(b => this.loadApiKeyForSecret(b.apiKeySecretName).trim());
		const hasGlobal = !!(this.settings.ghostUrl && this.loadApiKeyForSecret(this.settings.ghostApiKeySecretName).trim());
		if (!hasBlogKey && !hasGlobal) {
			new Notice('Configure a blog (URL + admin API key) in settings first');
			return;
		}

		new LinkToGhostModal(
			this.app,
			this.ghostClient,
			this.settings,
			async ({ ghostPost, obsidianFile, source, ghostUrl, blog }) => {
				await this.linkNoteToGhostPost(ghostPost, obsidianFile, source, ghostUrl, blog);
			},
			this
		).open();
	}

	/**
	 * Perform the actual linking between a Ghost post and an Obsidian note.
	 * The chosen source overwrites the destination. When `blog` is known (resolved
	 * from the post URL), the note is tagged with its domain key and moved into that
	 * blog's folder so it routes back to the right blog.
	 */
	private async linkNoteToGhostPost(
		post: GhostPost,
		file: TFile,
		source: 'ghost' | 'obsidian',
		ghostUrl: string,
		blog: GhostBlog | null
	): Promise<void> {
		try {
			const prefix = this.settings.yamlPrefix;
			const targetFolder = blog ? blog.folder : this.settings.syncFolder;

			if (source === 'ghost') {
				const s = blog ? this.blogKeyFor(blog) : '';
				const tags = (post.tags ?? []).map(t => t.name);
				const tagsYaml = yamlStringArray(tags, true);
				const ghostFields: Record<string, string> = {
					post_access: post.visibility ?? 'public',
					published: (post.status === 'published' || post.status === 'scheduled') ? 'true' : 'false',
					published_at: yamlString(post.published_at ?? '', true),
					featured: post.featured ? 'true' : 'false',
					tags: tagsYaml,
					excerpt: yamlString(post.excerpt ?? '', true),
					feature_image: yamlString(post.feature_image ?? '', true),
					no_sync: 'false',
					slug: yamlString(post.slug, true),
				};
				if (blog) {
					ghostFields[`id_${s}`] = post.id;
					ghostFields[`url_${s}`] = ghostUrl;
					if (post.url) ghostFields[`public_url_${s}`] = post.url;
					ghostFields.blog = this.blogPropertyYaml([blog]);
				}

				const bodyMarkdown = htmlToMarkdown(post.html ?? '');
				const title = post.title || 'Untitled Post';
				await this.app.vault.process(file, (raw) => {
					const content = upsertGhostMetadata(raw, ghostFields, prefix);
					const parsed = splitFrontmatter(content);
					return parsed
						? joinFrontmatter(parsed.raw, `\n# ${title}\n\n${bodyMarkdown}`)
						: `# ${title}\n\n${bodyMarkdown}`;
				});
				await this.ensureInFolder(file, targetFolder);
				new Notice(`Linked and updated note from Ghost: "${title}"${blog ? ` (${blog.name})` : ''}`);
			} else {
				const upserts: Record<string, string> = { [`${prefix}slug`]: post.slug };
				if (blog) {
					const keys = this.blogKeys(blog);
					upserts[keys.id] = post.id;
					upserts[keys.url] = ghostUrl;
					upserts[`${prefix}blog`] = this.blogPropertyYaml([blog]);
				}
				await this.app.vault.process(file, (raw) =>
					upsertFrontmatterKeys(addGhostPropertiesToContent(raw, this.settings), upserts));
				const movedFile = await this.ensureInFolder(file, targetFolder);
				await this.syncFileRouted(movedFile ?? file);
				new Notice(`Linked and synced note to Ghost: "${file.basename}"${blog ? ` (${blog.name})` : ''}`);
			}
		} catch (error) {
			console.error('[Ghost Link] Error linking note:', error);
			new Notice(`Failed to link note: ${(error as Error).message}`);
		}
	}

	/** Move a file into `folderPath` if it isn't already there. Returns the moved TFile, or null if unchanged. */
	private async ensureInFolder(file: TFile, folderPath: string): Promise<TFile | null> {
		const dest = normalizePath(folderPath);
		const currentFolder = file.parent?.path ?? '';
		if (currentFolder === dest) {
			return null;
		}
		if (!this.app.vault.getAbstractFileByPath(dest)) {
			await this.app.vault.createFolder(dest);
		}
		const newPath = normalizePath(`${dest}/${file.name}`);
		await this.app.fileManager.renameFile(file, newPath);
		return this.app.vault.getFileByPath(newPath);
	}

	async syncCurrentNote(file: TFile | null): Promise<void> {
		if (!file) {
			new Notice('No active file');
			return;
		}

		// Check credentials
		if (!this.hasAnyConfiguredBlogCredentials()) {
			new Notice('Please configure a blog URL and admin API key first');
			return;
		}

		// Check if file has Ghost frontmatter — add properties automatically if missing
		let cache = this.app.metadataCache.getFileCache(file);
		const hasGhostProps = cache?.frontmatter && Object.keys(cache.frontmatter).some(key =>
			key.startsWith(this.settings.yamlPrefix)
		);

		if (!hasGhostProps) {
			await this.app.vault.process(file, (content) => addGhostPropertiesToContent(content, this.settings));
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

		// A note already inside any blog's folder (or the root) stays where it is;
		// otherwise move it into its target blog's folder.
		let targetFile = file;
		if (!this.fileInAnyBlogFolder(file)) {
			const blog = this.resolveBlogsForFile(file)[0];
			const folder = normalizePath((blog ? blog.folder : '') || this.settings.syncFolder);
			new Notice(`Moving note to ${folder}`);
			const newPath = await this.moveNoteTo(file, normalizePath(`${folder}/${file.name}`));
			const movedFile = newPath ? this.app.vault.getFileByPath(newPath) : null;
			if (!movedFile) {
				new Notice('Failed to move file to the blog folder.');
				return;
			}
			targetFile = movedFile;
		}

		// Run sync with user feedback
		new Notice(`Syncing "${targetFile.basename}"…`);
		const success = await this.syncFileRouted(targetFile, true);

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
			// No-op check first, so a note that already has every property
			// is not rewritten (a write would bump mtime and trigger auto-sync).
			const before = await this.app.vault.cachedRead(file);
			if (addGhostPropertiesToContent(before, this.settings) === before) {
				new Notice('This note already has all ghost properties');
				return;
			}

			// Add Ghost properties (will add only missing ones)
			await this.app.vault.process(file, (content) => addGhostPropertiesToContent(content, this.settings));

			new Notice('Ghost properties added! This note will now sync with ghost.');

			// A note already inside any blog's folder (or the root) stays put;
			// otherwise move it into its target blog's folder.
			if (!this.fileInAnyBlogFolder(file)) {
				const blog = this.resolveBlogsForFile(file)[0];
				const folder = normalizePath((blog ? blog.folder : '') || this.settings.syncFolder);
				const newPath = await this.moveNoteTo(file, normalizePath(`${folder}/${file.name}`));
				if (newPath) new Notice(`File moved to ${folder}`);
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

		const blog = this.resolveBlogsForFile(file)[0];
		if (!blog || !this.loadApiKeyForSecret(blog.apiKeySecretName).trim()) {
			new Notice("This note's blog has no API key — set it in settings.");
			return;
		}

		// Fetch the most recent published or scheduled post from that blog
		let lastPost: GhostPost | undefined;
		try {
			const posts = await this.getClientForBlog(blog).getPosts(
				'status:[published,scheduled]',
				10,
				'published_at desc'
			);
			lastPost = posts[0];
		} catch (error) {
			new Notice(`Failed to fetch posts from ${blog.name}: ${(error as Error).message}`);
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
		const cache = this.app.metadataCache.getFileCache(file);
		const existingDate = cache?.frontmatter?.[`${this.settings.yamlPrefix}published_at`] as string | undefined;

		const applyDate = async (): Promise<void> => {
			await this.app.vault.process(file, (content) => upsertFrontmatterKeys(content, {
				[`${this.settings.yamlPrefix}published_at`]: newIso,
				[`${this.settings.yamlPrefix}published`]: 'true',
			}));
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

	// ─── Archive (move-on-delete instead of trash) ───────────────────────────

	private archiveName(): string {
		return (this.settings.archiveFolderName || 'Archive').trim() || 'Archive';
	}

	/** True if a path is inside any blog's archive subfolder. */
	private isArchivePath(path: string): boolean {
		const name = this.archiveName();
		const folders = this.settings.blogs.map(b => normalizePath(b.folder));
		folders.push(normalizePath(this.settings.syncFolder));
		return folders.some(f => f && path.startsWith(`${f}/${name}/`));
	}

	/** Where a deleted note is archived: <its blog folder>/<archiveName>/<relative path>. */
	private archiveTargetFor(notePath: string): string {
		const name = this.archiveName();
		const folders = this.settings.blogs.map(b => normalizePath(b.folder));
		folders.push(normalizePath(this.settings.syncFolder));
		let base = '';
		for (const f of folders) {
			if (f && (notePath === f || notePath.startsWith(f + '/')) && f.length > base.length) base = f;
		}
		if (!base) base = notePath.split('/').slice(0, -1).join('/');
		const rel = notePath.startsWith(base + '/') ? notePath.slice(base.length + 1) : notePath.split('/').pop();
		return normalizePath(`${base}/${name}/${rel}`);
	}

	/** Move a note into its blog's archive subfolder (instead of trashing it),
	 *  preserving its frontmatter and adding an archive record. */
	private async archiveNote(file: TFile): Promise<void> {
		const originalPath = file.path;
		const dest = await this.moveNoteTo(file, this.archiveTargetFor(file.path));
		if (!dest) return;
		const moved = this.app.vault.getAbstractFileByPath(dest);
		if (moved instanceof TFile) {
			try {
				const prefix = this.settings.yamlPrefix;
				await this.app.vault.process(moved, (content) => upsertFrontmatterKeys(content, {
					[`${prefix}archived`]: 'true',
					[`${prefix}archived_at`]: `"${new Date().toISOString()}"`,
					[`${prefix}archived_from`]: `"${originalPath}"`,
					[`${prefix}no_sync`]: 'true',
				}));
			} catch (e) {
				console.error('[Ghost] archive metadata stamp failed:', e);
			}
		}
	}

	/** True if the file sits inside ANY blog's folder (or the primary sync folder), excluding archives. */
	private fileInAnyBlogFolder(file: TFile): boolean {
		if (this.isArchivePath(file.path)) return false;
		const folders = this.settings.blogs.map(b => normalizePath(b.folder));
		folders.push(normalizePath(this.settings.syncFolder));
		return folders.some(f => f && (file.path === f || file.path.startsWith(f + '/')));
	}

	// ─── Ghost index + bulk delete ───────────────────────────────────────────

	/** Resolve the Ghost post id for each blog this note has one stored for. */
	resolveGhostJobs(fmObj: Record<string, unknown>): { blog: GhostBlog; id: string }[] {
		const jobs: { blog: GhostBlog; id: string }[] = [];
		for (const blog of this.settings.blogs) {
			const id = this.readBlogId(fmObj, blog);
			if (id) jobs.push({ blog, id });
		}
		return jobs;
	}

	/** Build a bulk-delete item list for a file from its (live) frontmatter. */
	bulkItemsForFile(file: TFile): BulkDeleteItem[] {
		const prefix = this.settings.yamlPrefix;
		const cache = this.app.metadataCache.getFileCache(file);
		const fmObj = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const pub = fmObj[`${prefix}published`];
		const published = pub === true || pub === 'true';
		return this.resolveGhostJobs(fmObj).map(j => ({
			blogId: j.blog.id, blogName: j.blog.name, ghostId: j.id, title: file.basename, published, path: file.path,
		}));
	}

	/** Maintain the in-memory index (path → linked Ghost posts) used to know what
	 *  to offer for deletion AFTER a note/folder is gone (its cache is purged). */
	indexFile(file: TAbstractFile): void {
		if (!this.ghostIndex) this.ghostIndex = new Map();
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (!this.fileInAnyBlogFolder(file)) { this.ghostIndex.delete(file.path); return; }
		const items = this.bulkItemsForFile(file);
		if (items.length === 0) this.ghostIndex.delete(file.path);
		else this.ghostIndex.set(file.path, items);
	}

	rebuildGhostIndex(): void {
		this.ghostIndex = new Map();
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (this.fileInAnyBlogFolder(f)) this.indexFile(f);
		}
	}

	/** Re-key ghost-index entries when a note or folder is renamed/moved, so a
	 *  later folder delete never matches stale paths of notes that only moved. */
	private reindexRenamed(af: TAbstractFile, oldPath: string): void {
		if (!this.ghostIndex) return;
		if (af instanceof TFolder) {
			const prefix = oldPath + '/';
			for (const [path, entries] of [...this.ghostIndex]) {
				if (!path.startsWith(prefix)) continue;
				this.ghostIndex.delete(path);
				const np = normalizePath(`${af.path}/${path.slice(prefix.length)}`);
				this.ghostIndex.set(np, entries.map(e => ({ ...e, path: np })));
			}
			return;
		}
		const entries = this.ghostIndex.get(oldPath);
		this.ghostIndex.delete(oldPath);
		if (af instanceof TFile && af.extension === 'md' && this.fileInAnyBlogFolder(af)) {
			const items = this.bulkItemsForFile(af);
			if (items.length > 0) {
				this.ghostIndex.set(af.path, items);
			} else if (entries) {
				// Metadata cache may not be re-keyed yet right after a move — carry
				// the old entries over to the new path instead of losing them.
				this.ghostIndex.set(af.path, entries.map(e => ({ ...e, path: af.path })));
			}
		}
	}

	private scheduleDeleteBatch(): void {
		if (this.deleteBatchTimer) window.clearTimeout(this.deleteBatchTimer);
		this.deleteBatchTimer = window.setTimeout(() => { void this.processDeleteBatch(); }, 400);
	}

	/** A folder (with its notes) was just deleted locally. Offer the bulk-delete
	 *  workflow for the remote posts those notes were linked to. Never auto-deletes. */
	private async processDeleteBatch(): Promise<void> {
		this.deleteBatchTimer = undefined;
		const folders = this.pendingDeletedFolders.splice(0).map(p => p.replace(/\/+$/, ''));
		if (folders.length === 0 || !this.ghostIndex) return;
		const inDeleted = (p: string) => folders.some(fp => p === fp || p.startsWith(fp + '/'));
		// Posts whose note still exists elsewhere in the vault were moved, not
		// deleted — never offer them for remote deletion.
		const live = new Set<string>();
		for (const [path, entries] of this.ghostIndex) {
			if (inDeleted(path)) continue;
			if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) continue;
			for (const e of entries) live.add(`${e.blogId}:${e.ghostId}`);
		}
		const items: BulkDeleteItem[] = [];
		for (const [path, entries] of [...this.ghostIndex]) {
			if (!inDeleted(path)) continue;
			this.ghostIndex.delete(path);
			if (this.app.vault.getAbstractFileByPath(path)) continue; // note still exists → stale entry
			for (const e of entries) {
				if (!live.has(`${e.blogId}:${e.ghostId}`)) items.push({ ...e, path });
			}
		}
		if (items.length === 0) return;
		new BulkDeleteModal(this.app, this, {
			heading: `Folder deleted — delete ${items.length} linked Ghost post${items.length === 1 ? '' : 's'}?`,
			subtext: 'These notes were just removed locally. Choose which of their Ghost posts to also delete. Nothing is deleted until you confirm.',
			deleteLocal: false,
			items,
		}).open();
	}

	/** Delete one remote post on its blog. */
	async deleteOneRemote(blogId: string, ghostId: string): Promise<void> {
		const blog = this.settings.blogs.find(b => b.id === blogId);
		if (!blog) throw new Error('Unknown blog for delete');
		await this.getClientForBlog(blog).deletePost(ghostId);
	}

	/** Run the confirmed bulk delete: optional per-post confirm, Stop aborts the rest. */
	async executeBulkDelete(items: BulkDeleteItem[], deleteLocal: boolean): Promise<void> {
		let ok = 0, fail = 0, skipped = 0;
		for (const it of items) {
			if (this.settings.confirmEachRemoteDelete) {
				const decision = await new Promise<string>((resolve) => {
					new DeleteConfirmModal(this.app, it.title, it.blogName, resolve).open();
				});
				if (decision === 'stop') break;
				if (decision === 'skip') { skipped++; continue; }
			}
			try {
				await this.deleteOneRemote(it.blogId, it.ghostId);
				ok++;
			} catch (e) {
				fail++;
				console.error('[Ghost] bulk delete failed:', e);
				continue;
			}
				if (deleteLocal && it.path) {
					const f = this.app.vault.getAbstractFileByPath(it.path);
					if (f instanceof TFile) {
						try {
							if (this.settings.archiveDeletedNotes) await this.archiveNote(f);
							else await this.app.fileManager.trashFile(f);
						} catch (e) {
							console.error('[Ghost] local note archive/delete failed:', e);
						}
					}
			}
			if (it.path && this.ghostIndex) this.ghostIndex.delete(it.path);
		}
		new Notice(`Deleted ${ok} post${ok === 1 ? '' : 's'} on Ghost${fail ? `, ${fail} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}`);
	}

	/** On-demand bulk delete: pick blog(s), list their linked posts (all checked). */
	openBulkDeleteCommand(): void {
		if (this.settings.blogs.length === 0) {
			new Notice('No blogs configured.');
			return;
		}
		const def = this.defaultBlog();
		new SelectBlogsModal(
			this.app,
			this.settings.blogs,
			def ? [def.id] : [],
			{ heading: 'Bulk delete — choose blog(s)', confirmLabel: 'Next' },
			(chosen) => {
				const chosenIds = new Set(chosen.map(b => b.id));
				const folders = chosen.map(b => normalizePath(b.folder));
				const items: BulkDeleteItem[] = [];
				for (const f of this.app.vault.getMarkdownFiles()) {
					if (this.isArchivePath(f.path)) continue;
					if (!folders.some(fp => f.path === fp || f.path.startsWith(fp + '/'))) continue;
					for (const it of this.bulkItemsForFile(f)) {
						if (chosenIds.has(it.blogId)) items.push(it);
				}
			}
			if (items.length === 0) {
					new Notice('No linked ghost posts found in the selected folder(s).');
					return;
				}
				new BulkDeleteModal(this.app, this, {
					heading: `Delete ${items.length} note${items.length === 1 ? '' : 's'} + their Ghost posts?`,
					subtext: 'Unchecked items are left alone. For checked items, both the local note and the remote post are deleted.',
					deleteLocal: true,
					items,
				}).open();
			}
		).open();
	}

	// ─── Orphaned posts (blogs removed from g_blog) ──────────────────────────

	/** Posts the note still has on blogs NOT named in g_blog (stored id, no longer targeted). */
	orphanedJobsForFile(file: TFile): { blog: GhostBlog; id: string }[] {
		const fmObj = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		const namedIds = new Set(this.resolveBlogsForFile(file).map(b => b.id));
		return this.resolveGhostJobs(fmObj).filter(j => !namedIds.has(j.blog.id));
	}

	/** Frontmatter keys that hold the stored id/URL for one blog on this note, and the public URL. */
	storedKeysForBlog(file: TFile, blog: GhostBlog): { keys: string[]; url: string } {
		const fmObj = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		return { keys: this.allBlogKeyNames(blog), url: this.readBlogPublicUrl(fmObj, blog) };
	}

	/** Warn about each orphaned post in turn; let the user delete it on Ghost or keep both. */
	promptOrphanedPosts(file: TFile, orphans: { blog: GhostBlog; id: string }[]): void {
		const job = orphans[0];
		if (!job) return;
		const { url } = this.storedKeysForBlog(file, job.blog);
		new OrphanPostModal(this.app, job.blog.name, url, (decision) => {
			void (async () => {
				try {
					if (decision === 'delete') await this.deleteOrphanPost(file, job.blog, job.id);
					else if (decision === 'keep') await this.keepOrphanInBoth(file, job.blog);
				} catch (e) {
					new Notice(`Failed: ${(e as Error).message}`);
				}
				this.promptOrphanedPosts(file, orphans.slice(1));
			})();
		}).open();
	}

	/** Delete an orphaned post on Ghost and strip its id/URL keys from the note. */
	async deleteOrphanPost(file: TFile, blog: GhostBlog, ghostId: string): Promise<void> {
		await this.deleteOneRemote(blog.id, ghostId);
		const { keys } = this.storedKeysForBlog(file, blog);
		await this.app.vault.process(file, (content) => removeFrontmatterKeys(content, keys));
		new Notice(`Deleted orphaned post on ${blog.name}`);
	}

	/** Re-add an orphaned blog to g_blog and sync it now, so the note publishes to both. */
	async keepOrphanInBoth(file: TFile, blog: GhostBlog): Promise<void> {
		const named = this.resolveBlogsForFile(file);
		const all = named.some(b => b.id === blog.id) ? named : [...named, blog];
		await this.ensureBlogProperty(file, all);
		await this.syncFileToBlogs(file, all);
		new Notice(`Kept "${blog.name}" — this note now publishes to both`);
	}

	/** Write g_blog so it lists exactly `blogs` (used when keeping an orphan in both). */
	async ensureBlogProperty(file: TFile, blogs: GhostBlog[]): Promise<void> {
		if (blogs.length === 0) return;
		const prefix = this.settings.yamlPrefix;
		const yaml = this.blogPropertyYaml(blogs);
		await this.app.vault.process(file, (content) => upsertFrontmatterKeys(content, { [`${prefix}blog`]: yaml }));
	}

	// ─── Domain-key normalization + rename migration ─────────────────────────

	/** One-shot upgrade of existing notes to domain-keyed blog references. Idempotent. */
	async normalizeBlogReferences(): Promise<void> {
		const prefix = this.settings.yamlPrefix;
		const files = this.app.vault.getMarkdownFiles().filter(f => this.fileInAnyBlogFolder(f));
		let changed = 0;
		for (const file of files) {
			try {
				const before = await this.app.vault.read(file);
				const split = splitFrontmatter(before);
				if (!split) continue;
				let fmObj: Record<string, unknown>;
				try { fmObj = (parseYaml(split.raw) as Record<string, unknown>) || {}; } catch { continue; }
				if (!fmObj || typeof fmObj !== 'object') continue;
				const updates: Record<string, string> = {};
				const removals: string[] = [];
				const raw = fmObj[`${prefix}blog`];
				const tokens = Array.isArray(raw) ? raw.map(v => String(v).trim()).filter(Boolean)
					: (typeof raw === 'string' && raw.trim() ? [raw.trim()] : []);
				if (tokens.length) {
					const seen = new Set<string>();
					const out: string[] = [];
					for (const t of tokens) {
						const b = this.settings.blogs.find(bl => this.blogMatchesToken(bl, t));
						const key = b ? this.blogDomainKey(b) : t;       // keep unknown tokens verbatim
						const lk = key.toLowerCase();
						if (!seen.has(lk)) { seen.add(lk); out.push(key); }
					}
					const want = `[${out.map(k => `"${k}"`).join(', ')}]`;
					const current = `[${tokens.map(t => `"${t}"`).join(', ')}]`;
					if (want !== current) updates[`${prefix}blog`] = want;
				}
				for (const blog of this.settings.blogs) {
					const domSuffix = this.blogKeyFor(blog);
					const srcSuffixes = new Set<string>([this.blogKeySuffix(blog.name), ...(blog.aliases ?? []).map(a => this.blogKeySuffix(a))]);
					srcSuffixes.delete(domSuffix);
					for (const srcSuffix of srcSuffixes) {
						for (const base of ['id', 'public_url']) {
							const oldKey = `${prefix}${base}_${srcSuffix}`;
							const newKey = `${prefix}${base}_${domSuffix}`;
							const val = fmObj[oldKey];
							if (newKey in fmObj) { if (oldKey in fmObj) removals.push(oldKey); }
							else if (typeof val === 'string' && val) { updates[newKey] = val; removals.push(oldKey); }
						}
					}
				}
				if (Object.keys(updates).length === 0 && removals.length === 0) continue;
				let didChange = false;
				await this.app.vault.process(file, (raw) => {
					let content = raw;
					if (Object.keys(updates).length) content = upsertFrontmatterKeys(content, updates);
					if (removals.length) content = removeFrontmatterKeys(content, removals);
					didChange = content !== raw;
					return content;
				});
				if (didChange) changed++;
			} catch (e) {
				console.error('[Ghost] normalize failed for', file.path, e);
			}
		}
		new Notice(`Normalized blog references in ${changed} note${changed === 1 ? '' : 's'}`);
	}

	/** A blog was renamed from `oldName`. Rewrite existing notes so their references follow it. */
	async migrateBlogRename(oldName: string, blog: GhostBlog): Promise<void> {
		const prefix = this.settings.yamlPrefix;
		const oldTok = oldName.trim().toLowerCase();
		const oldSuffix = this.blogKeySuffix(oldName);
		const newKey = this.blogDomainKey(blog);
		const newSuffix = this.blogKeyFor(blog);
		if (!oldTok) return;
		const files = this.app.vault.getMarkdownFiles().filter(f => this.fileInAnyBlogFolder(f));
		let changed = 0;
		for (const file of files) {
			try {
				const before = await this.app.vault.read(file);
				const split = splitFrontmatter(before);
				if (!split) continue;
				let fmObj: Record<string, unknown>;
				try { fmObj = (parseYaml(split.raw) as Record<string, unknown>) || {}; } catch { continue; }
				if (!fmObj || typeof fmObj !== 'object') continue;
				const updates: Record<string, string> = {};
				const removals: string[] = [];
				const raw = fmObj[`${prefix}blog`];
				const tokens = Array.isArray(raw) ? raw.map(v => String(v).trim()).filter(Boolean)
					: (typeof raw === 'string' && raw.trim() ? [raw.trim()] : []);
				if (tokens.some(t => t.toLowerCase() === oldTok)) {
					const seen = new Set<string>();
					const out: string[] = [];
					for (const t of tokens) {
						const k = t.toLowerCase() === oldTok ? newKey : t;
						const lk = k.toLowerCase();
						if (!seen.has(lk)) { seen.add(lk); out.push(k); }
					}
					updates[`${prefix}blog`] = `[${out.map(k => `"${k}"`).join(', ')}]`;
				}
				if (oldSuffix !== newSuffix) {
					for (const base of ['id', 'public_url']) {
						const oldKey = `${prefix}${base}_${oldSuffix}`;
						const newKey2 = `${prefix}${base}_${newSuffix}`;
						const val = fmObj[oldKey];
						if (newKey2 in fmObj) { if (oldKey in fmObj) removals.push(oldKey); }
						else if (typeof val === 'string' && val) { updates[newKey2] = val; removals.push(oldKey); }
					}
				}
				if (Object.keys(updates).length === 0 && removals.length === 0) continue;
				let didChange = false;
				await this.app.vault.process(file, (raw) => {
					let content = raw;
					if (Object.keys(updates).length) content = upsertFrontmatterKeys(content, updates);
					if (removals.length) content = removeFrontmatterKeys(content, removals);
					didChange = content !== raw;
					return content;
				});
				if (didChange) changed++;
			} catch (e) {
				console.error('[Ghost] rename migration failed for', file.path, e);
			}
		}
		if (changed) new Notice(`Updated ${changed} note${changed === 1 ? '' : 's'} for renamed blog "${blog.name}"`);
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

/** Per-post confirmation during a bulk delete: Delete / Skip / Stop. */
class DeleteConfirmModal extends Modal {
	private decided = false;
	constructor(app: App, private postTitle: string, private blogName: string, private resolve: (decision: string) => void) {
		super(app);
	}
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Delete post on ghost?' });
		const p1 = contentEl.createEl('p');
		p1.createSpan({ text: 'Post: ' });
		p1.createEl('strong', { text: this.postTitle });
		const p2 = contentEl.createEl('p');
		p2.createSpan({ text: 'Blog: ' });
		p2.createEl('strong', { text: this.blogName });
		contentEl.createEl('p', { text: 'This permanently deletes the post on ghost and cannot be undone.' });
		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(row).setButtonText('Delete').setWarning().onClick(() => this.finish('delete'));
		new ButtonComponent(row).setButtonText('Skip').onClick(() => this.finish('skip'));
		new ButtonComponent(row).setButtonText('Stop — cancel all remaining').onClick(() => this.finish('stop'));
	}
	private finish(decision: string): void {
		this.decided = true;
		this.resolve(decision);
		this.close();
	}
	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.resolve('stop');
	}
}

/** Generic warn-and-confirm modal (used by normalize + bulk-delete confirm). */
class SimpleConfirmModal extends Modal {
	private decided = false;
	constructor(app: App, private title: string, private body: string, private confirmLabel: string, private onResult: (ok: boolean) => void) {
		super(app);
	}
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: this.title });
		contentEl.createEl('p', { text: this.body });
		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(row).setButtonText(this.confirmLabel).setWarning().onClick(() => this.finish(true));
		new ButtonComponent(row).setButtonText('Cancel').onClick(() => this.finish(false));
	}
	private finish(v: boolean): void {
		this.decided = true;
		this.onResult(v);
		this.close();
	}
	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.onResult(false);
	}
}

/** Pick a .textpack file and a target blog, then import it as a synced note. */
class ImportTextpackModal extends Modal {
	private parsed: ParsedTextpack | null = null;
	private blogSelect: HTMLSelectElement | null = null;
	private titleSource: TitlePrimarySource = 'heading';
	private updateSecondaryTitle = true;
	private titleSelect: HTMLSelectElement | null = null;
	private titleDesc: HTMLElement | null = null;
	constructor(app: App, private plugin: GhostWriterManagerPlugin) {
		super(app);
	}
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Import textpack' });
		contentEl.createEl('p', {
			text: 'Choose a .textpack file (a zipped text bundle). The note and its images land in the selected blog\'s folder, with ghost properties set, ready to sync.'
		});

		const status = contentEl.createEl('p', { text: 'No file selected.' });
		// No `accept` filter: iOS greys out extensions it has no type mapping
		// for (like .textpack), so allow any file and validate in the parser.
		const input = contentEl.createEl('input', {
			attr: { type: 'file', 'aria-label': 'Textpack file' }
		});
		input.addEventListener('change', () => {
			void (async () => {
				const f = input.files?.[0];
				if (!f) return;
				try {
					this.parsed = await parseTextpack(await f.arrayBuffer(), f.name);
					const hint = this.parsed.ghost.blog;
					const titleAnalysis = analyzeTextpackTitle(this.parsed);
					this.titleSource = titleAnalysis.defaultSource;
					if (this.titleSelect) this.titleSelect.value = this.titleSource;
					if (this.titleDesc) {
						this.titleDesc.setText(this.describeImportTitles(titleAnalysis));
					}
					status.setText(`"${this.parsed.name}" — ${this.parsed.assets.size} image(s)${hint ? `, blog: ${hint}` : ''}`);
					const hinted = hint
						? this.plugin.settings.blogs.find(b => this.plugin.blogMatchesToken(b, hint))
						: null;
					if (hinted && this.blogSelect) this.blogSelect.value = hinted.id;
				} catch (e) {
					this.parsed = null;
					status.setText(`Could not read file: ${(e as Error).message}`);
				}
			})();
		});

		new Setting(contentEl).setName('Import into blog').addDropdown(d => {
			for (const b of this.plugin.settings.blogs) d.addOption(b.id, b.name || b.url || 'unnamed blog');
			const def = this.plugin.defaultBlog();
			if (def) d.setValue(def.id);
			this.blogSelect = d.selectEl;
		});

		new Setting(contentEl)
			.setName('Primary title on import')
				.setDesc('Choose which source becomes the publishing title. Imported notes collapse a leading heading when it duplicates the chosen title.')
				.addDropdown(d => {
					d.addOption('heading', 'First heading');
					d.addOption('metadata', 'Metadata title');
				d.setValue(this.titleSource);
				d.onChange((value) => {
					this.titleSource = value as TitlePrimarySource;
				});
				this.titleSelect = d.selectEl;
			});

		new Setting(contentEl)
			.setName('Update secondary title')
			.setDesc('When the chosen source differs, rewrite the other title slot to match before collapsing duplicate headings.')
			.addToggle(t => t
				.setValue(this.updateSecondaryTitle)
				.onChange((value) => {
					this.updateSecondaryTitle = value;
				}));

			this.titleDesc = contentEl.createEl('p', {
				text: 'Choose a textpack to inspect its metadata title and first heading.'
			});

		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(row).setButtonText('Import').setCta().onClick(() => {
			void (async () => {
				if (!this.parsed) { new Notice('Choose a .textpack file first'); return; }
				const blog = this.plugin.settings.blogs.find(b => b.id === this.blogSelect?.value) ?? this.plugin.defaultBlog();
				if (!blog) { new Notice('No blog configured — add one in settings.'); return; }
				this.close();
				try {
					await this.plugin.importTextpack(this.parsed, blog, {
						primarySource: this.titleSource,
						updateSecondary: this.updateSecondaryTitle
					});
				} catch (e) {
					new Notice(`Import failed: ${(e as Error).message}`);
				}
			})();
		});
		new ButtonComponent(row).setButtonText('Cancel').onClick(() => this.close());
	}
	onClose(): void {
		this.contentEl.empty();
	}

	private describeImportTitles(analysis: ReturnType<typeof analyzeTextpackTitle>): string {
		const metadata = analysis.metadataTitle ? `"${analysis.metadataTitle}"` : 'none';
		const heading = analysis.headingTitle ? `"${analysis.headingTitle}"` : 'none';
		const conflict = analysis.hasConflict ? ' Conflict found.' : '';
		return `Metadata title: ${metadata}. First H1: ${heading}.${conflict}`;
	}
}

/** Prompt shown when a note still has a post on a blog dropped from g_blog. */
class OrphanPostModal extends Modal {
	private decided = false;
	constructor(app: App, private blogName: string, private url: string, private onResult: (decision: OrphanDecision) => void) {
		super(app);
	}
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Orphaned ghost post' });
		const p = contentEl.createEl('p');
		p.createSpan({ text: 'This note still has a published post on ' });
		p.createEl('strong', { text: this.blogName });
		p.createSpan({ text: ', but that blog is no longer listed in g_blog, so syncing skips it.' });
		if (this.url) {
			const u = contentEl.createEl('p');
			u.createSpan({ text: 'Post: ' });
			const a = u.createEl('a', { text: this.url, href: this.url });
			a.setAttr('target', '_blank');
			a.setAttr('rel', 'noopener');
		}
		contentEl.createEl('p', { text: 'Delete it on ghost, or keep it — keeping re-adds the blog to g_blog and the note will publish to both again.' });
		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(row).setButtonText('Delete on ghost').setWarning().onClick(() => this.finish('delete'));
		new ButtonComponent(row).setButtonText('Keep in both').onClick(() => this.finish('keep'));
		new ButtonComponent(row).setButtonText('Decide later').onClick(() => this.finish('later'));
	}
	private finish(decision: OrphanDecision): void {
		this.decided = true;
		this.onResult(decision);
		this.close();
	}
	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.onResult('later');
	}
}

/** Checklist of note↔post links to delete (local + remote), with a final confirm. */
class BulkDeleteModal extends Modal {
	private checked: boolean[];
	constructor(app: App, private plugin: GhostWriterManagerPlugin, private opts: BulkDeleteOptions) {
		super(app);
		// Destructive list: nothing is preselected — the user opts each post in.
		this.checked = opts.items.map(() => false);
	}
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: this.opts.heading });
		if (this.opts.subtext) contentEl.createEl('p', { text: this.opts.subtext });

		const rowBoxes: HTMLInputElement[] = [];
		const master = contentEl.createEl('label', { cls: 'omnighost-bulk-row omnighost-bulk-master' });
		const masterCb = master.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Select all' } });
		master.createSpan({ text: ` Select all (${this.opts.items.length})` });
		const syncMaster = () => {
			const on = this.checked.filter(Boolean).length;
			masterCb.checked = on === this.checked.length && on > 0;
			masterCb.indeterminate = on > 0 && on < this.checked.length;
		};
		masterCb.onchange = () => {
			const on = masterCb.checked;
			this.checked = this.checked.map(() => on);
			rowBoxes.forEach(cb => { cb.checked = on; });
			syncMaster();
		};

		const list = contentEl.createDiv({ cls: 'omnighost-bulk-list' });
		this.opts.items.forEach((it, i) => {
			const row = list.createEl('label', { cls: 'omnighost-bulk-row' });
			const cb = row.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = false;
			cb.onchange = () => { this.checked[i] = cb.checked; syncMaster(); };
			rowBoxes.push(cb);
			row.createSpan({ text: ` ${it.title}  —  ${it.blogName}  (${it.published ? 'published' : 'draft'})` });
			row.createEl('br');
		});
		const row = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(row).setButtonText('Delete selected').setWarning().onClick(() => this.submit());
		new ButtonComponent(row).setButtonText('Cancel').onClick(() => this.close());
	}
	private submit(): void {
		const items = this.opts.items.filter((_, i) => this.checked[i]);
		if (items.length === 0) {
			new Notice('Nothing selected.');
			return;
		}
		const localPart = this.opts.deleteLocal ? ` and ${items.length} local note${items.length === 1 ? '' : 's'}` : '';
		new SimpleConfirmModal(
			this.app,
			'Confirm bulk delete',
			`Permanently delete ${items.length} post${items.length === 1 ? '' : 's'} on Ghost${localPart}? This cannot be undone.`,
			'Delete',
			(confirmed) => {
				if (!confirmed) return;
				this.close();
				void this.plugin.executeBulkDelete(items, this.opts.deleteLocal);
			}
		).open();
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

		let warnEl: HTMLElement | null = null;
		const colliding = plugin.collidingSecretBlogs();
		if (colliding.length >= 2) {
			warnEl = containerEl.createEl('p', { cls: 'setting-item-description omnighost-warning' });
			setIcon(warnEl.createSpan({ cls: 'omnighost-status-icon' }), 'alert-triangle');
			warnEl.createSpan({ text: ` These blogs share one keychain secret (${colliding.map(b => b.name || 'untitled').join(', ')}), so they use the same admin key — the wrong one will fail with a 401. Set each blog's own key below.` });
		}
		const refreshWarn = () => {
			if (warnEl && plugin.collidingSecretBlogs().length < 2) { warnEl.remove(); warnEl = null; }
		};

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
				.addText(t => {
					let originalName = blog.name;
					t.setValue(blog.name).onChange(async v => { blog.name = v.trim(); await plugin.saveSettings(); });
					t.inputEl.addEventListener('blur', () => {
						void (async () => {
							const prev = originalName;
							if (blog.name && prev && blog.name !== prev) {
								originalName = blog.name;
								blog.aliases = blog.aliases || [];
								const lp = prev.trim().toLowerCase();
								if (lp && lp !== blog.name.trim().toLowerCase() && !blog.aliases.includes(lp)) blog.aliases.push(lp);
								await plugin.saveSettings();
								await plugin.migrateBlogRename(prev, blog);
							}
						})();
					});
				});
			let folderInput: HTMLInputElement | null = null;
			new Setting(containerEl).setName('Site address')
				.addText(t => {
					let originalUrl = blog.url;
					t.setPlaceholder('https://yourblog.com').setValue(blog.url).onChange(async v => {
						blog.url = v.trim();
						await plugin.saveSettings();
					});
					// Folder derivation and identity migration run on blur, not per
					// keystroke — a half-typed URL must not re-point anything.
					t.inputEl.addEventListener('blur', () => {
						void (async () => {
							const prevHost = plugin.hostOf(originalUrl);
							const normalizedUrl = normalizeGhostSiteUrl(blog.url);
							let normalizedChanged = false;
							if (normalizedUrl && normalizedUrl !== blog.url) {
								blog.url = normalizedUrl;
								t.setValue(normalizedUrl);
								normalizedChanged = true;
							}
							const newHost = plugin.hostOf(blog.url);
							if (newHost === prevHost) {
								if (normalizedChanged) {
									originalUrl = blog.url;
									await plugin.saveSettings();
								}
								return;
							}
							originalUrl = blog.url;
							// The domain is the blog's stable identity: keep the old one as
							// an alias so existing g_blog tokens and g_id_<domain> keys
							// still match after the address change.
							if (prevHost) {
								blog.aliases = blog.aliases || [];
								if (!blog.aliases.includes(prevHost)) blog.aliases.push(prevHost);
							}
							if (blog.folderAuto !== false) {
								const derived = plugin.defaultFolderFor(blog);
								const cur = normalizePath(blog.folder || '');
								// Re-point only when nothing can be stranded: the current
								// folder is the shared root, or it holds no notes. Otherwise
								// keep it — "Organize folders by domain" moves the notes.
								if (cur === plugin.ghostPostsRoot() || !plugin.folderHasNotes(cur)) {
									blog.folder = derived;
								} else {
									new Notice(`"${blog.name}": folder kept at ${cur} — run "Organize folders by domain" to move its notes to ${derived}`);
								}
								if (folderInput) folderInput.placeholder = plugin.defaultFolderFor(blog);
							}
							await plugin.saveSettings();
						})();
					});
				});
			const hasKey = !!(blog.apiKeySecretName && plugin.loadApiKeyForSecret(blog.apiKeySecretName).trim());
			let pendingKey = '';
			let keyInput: HTMLInputElement | null = null;
			let secretNameInput: HTMLInputElement | null = null;
			const keySetting = new Setting(containerEl).setName('Admin API key');
			const setKeyDesc = (stored: boolean) => keySetting.setDesc(stored
				? '✓ Key stored for this blog. Enter a new one to replace it.'
				: "Paste this blog's admin key (id:secret) and save.");
			setKeyDesc(hasKey);
			keySetting
				.addText(t => {
					keyInput = t.inputEl;
					t.inputEl.type = 'password';
					t.setPlaceholder(hasKey ? 'Stored — enter to replace' : 'id:secret');
					t.onChange(v => { pendingKey = v.trim(); });
				})
				.addButton(b => b.setButtonText('Save key').onClick(async () => {
					if (!pendingKey) { new Notice('Enter a key first'); return; }
					const prevName = blog.apiKeySecretName;
					plugin.ensureUniqueSecretName(blog);
					try {
						this.app.secretStorage.setSecret(blog.apiKeySecretName, pendingKey);
						await plugin.saveSettings();
						pendingKey = '';
						if (keyInput) { keyInput.value = ''; keyInput.placeholder = 'Stored — enter to replace'; }
						if (secretNameInput && blog.apiKeySecretName !== prevName) secretNameInput.value = blog.apiKeySecretName;
						refreshWarn();
						// Auto-test the connection with the key we just stored.
						b.setDisabled(true);
						keySetting.setDesc('Key stored — testing connection…');
						const title = await plugin.getClientForBlog(blog).testConnection();
						b.setDisabled(false);
						if (title) {
							keySetting.setDesc(`✓ Connected to ${title}. Enter a new key to replace it.`);
							new Notice(`${blog.name || 'Blog'}: connected to ${title} ✓`);
						} else {
							// eslint-disable-next-line obsidianmd/ui/sentence-case
							keySetting.setDesc('⚠ Key saved but the connection failed — check the key and site address.');
							new Notice(`${blog.name || 'Blog'}: key saved but connection failed`);
						}
					} catch (e) {
						b.setDisabled(false);
						new Notice(`Could not save key: ${(e as Error).message}`);
					}
				}));
			new Setting(containerEl).setName('Key secret name')
				.setDesc('Keychain secret holding this key (managed automatically; one per blog)')
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.addText(t => { secretNameInput = t.inputEl; t.setPlaceholder('secret name').setValue(blog.apiKeySecretName).onChange(async v => { blog.apiKeySecretName = v.trim(); await plugin.saveSettings(); }); });
			new Setting(containerEl).setName('Folder')
				.setDesc("Vault folder for this blog's posts. Leave blank to derive it from the site address (root/domain).")
				.addText(t => {
					folderInput = t.inputEl;
					t.setPlaceholder(plugin.defaultFolderFor(blog))
						.setValue(blog.folderAuto !== false ? '' : blog.folder)
						.onChange(async v => {
							const val = v.trim();
							if (val) {
								blog.folder = normalizePath(val);
								blog.folderAuto = false;
							} else {
								blog.folderAuto = true;
								blog.folder = plugin.defaultFolderFor(blog);
								t.inputEl.placeholder = blog.folder;
							}
							await plugin.saveSettings();
						});
				});
			new Setting(containerEl).setName('Auto-sync this folder')
				.setDesc('When off, this folder is never auto-synced (manual sync still works).')
				.addToggle(t => t.setValue(blog.syncEnabled !== false).onChange(async v => { blog.syncEnabled = v; await plugin.saveSettings(); }));
			new Setting(containerEl).setName('Sync interval (minutes)')
				.setDesc('How often to auto-sync this folder. 0 = off. Leave blank to use the global interval.')
				.addText(t => t.setPlaceholder(`global (${plugin.settings.syncInterval})`)
					.setValue(blog.syncIntervalMinutes == null ? '' : String(blog.syncIntervalMinutes))
					.onChange(async v => {
						const s = v.trim();
						if (s === '') { blog.syncIntervalMinutes = undefined; }
						else { const n = parseInt(s, 10); if (isNaN(n) || n < 0) return; blog.syncIntervalMinutes = n; }
						await plugin.saveSettings();
					}));
			new Setting(containerEl).setName('Test connection')
				.addButton(btn => btn.setButtonText('Test').onClick(async () => {
					const title = await plugin.getClientForBlog(blog).testConnection();
					new Notice(title ? `Connected to ${title}` : `Failed to connect to ${blog.name}`);
				}));
		});

		new Setting(containerEl).addButton(b => b.setButtonText('Add blog').setCta().onClick(async () => {
			const id = plugin.genBlogId();
			const blog: GhostBlog = { id, name: 'New blog', url: '', apiKeySecretName: `omnighost-key-${id}`, folder: plugin.ghostPostsRoot(), folderAuto: true };
			plugin.settings.blogs.push(blog);
			if (!plugin.settings.defaultBlogId) plugin.settings.defaultBlogId = blog.id;
			await plugin.saveSettings();
			this.display();
		}));

		new Setting(containerEl)
			.setName('Organize folders by domain')
			.setDesc(`Move each blog's notes into ${plugin.ghostPostsRoot()}/<domain> (derived from its site address) and point the blog folders there. Notes are moved with link updates.`)
			.addButton(b => b.setButtonText('Organize').onClick(() => {
				new SimpleConfirmModal(
					this.app,
					'Organize blog folders?',
					`Each blog's notes move into "${plugin.ghostPostsRoot()}/<domain>" and the blog folders switch to automatic (derived) mode. Vault links are updated as files move.`,
					'Organize',
					(ok) => {
						if (!ok) return;
						void (async () => {
							const { moved, failed } = await plugin.organizeBlogFolders();
							new Notice(`Organized: ${moved} note(s) moved${failed ? `, ${failed} FAILED — those notes stayed put, see console` : ''}`);
							this.display();
						})();
					}
				).open();
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
			.setName('Ghost posts root folder')
			.setDesc('Folder that blog folders nest under: each blog with an automatic folder lives in root/domain (e.g. "Ghost Posts/chief.sc").')
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- literal default folder name
				.setPlaceholder('Ghost Posts')
				.setValue(this.plugin.settings.syncFolder)
				.onChange(async (value) => {
					const oldRoot = this.plugin.ghostPostsRoot();
					this.plugin.settings.syncFolder = value.trim() || 'Ghost Posts';
					for (const b of this.plugin.settings.blogs) {
						if (b.folderAuto === false) continue;
						const cur = normalizePath(b.folder || '');
						// Re-point only folders that cannot strand notes; populated
						// folders keep their path until "Organize" moves the notes.
						if (cur === oldRoot || !this.plugin.folderHasNotes(cur)) {
							b.folder = this.plugin.defaultFolderFor(b);
						}
					}
					await this.plugin.saveSettings();
				}));

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
			.setName('Auto-import textpacks')
			.setDesc('When a .textpack file appears in the vault — for instance saved there from your phone — import it as a blog note and move the pack to trash.')
			.addToggle(t => t
				.setValue(this.plugin.settings.autoImportTextpacks)
				.onChange(async (value) => {
					this.plugin.settings.autoImportTextpacks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync title source')
				.setDesc('Choose which note title source is sent to ghost when syncing.')
				.addDropdown(d => d
					.addOption('metadata', 'Metadata title property')
					.addOption('heading', 'First heading')
				.setValue(this.plugin.settings.syncTitleSource)
				.onChange(async (value) => {
					this.plugin.settings.syncTitleSource = value as TitlePrimarySource;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Update secondary title on sync')
				.setDesc('When syncing, rewrite the non-primary title slot to match the source sent to ghost.')
			.addToggle(t => t
				.setValue(this.plugin.settings.syncUpdateSecondaryTitle)
				.onChange(async (value) => {
					this.plugin.settings.syncUpdateSecondaryTitle = value;
					await this.plugin.saveSettings();
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

		new Setting(containerEl).setHeading().setName('Deletion');
		new Setting(containerEl).setDesc('Deletion is never automatic. Run the command “bulk delete posts (local notes + ghost)” to pick a blog, review a checklist of its linked posts, and confirm.');
		new Setting(containerEl).setName('Prompt on folder delete')
			.setDesc('When you delete a folder of synced notes, pop up the same bulk-delete checklist for their ghost posts (the local notes are already gone). Nothing is deleted until you confirm. Turn off to ignore folder deletes entirely.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.promptDeleteOnFolderDelete).onChange(async value => {
				this.plugin.settings.promptDeleteOnFolderDelete = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl).setName('Confirm each remote delete')
			.setDesc('During a bulk delete, also show a per-post confirmation (post + blog name) with delete / skip / stop. The final bulk confirmation always shows regardless.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.confirmEachRemoteDelete).onChange(async value => {
				this.plugin.settings.confirmEachRemoteDelete = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl).setName('Archive deleted notes')
			.setDesc('When a bulk delete removes a local note, move it into an archive subfolder of its blog folder instead of trashing it (the ghost post is still deleted). Archived notes are never re-synced.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.archiveDeletedNotes).onChange(async value => {
				this.plugin.settings.archiveDeletedNotes = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl).setName('Archive subfolder name')
			.setDesc('Name of the archive subfolder created inside each blog folder (default: archive).')
			.addText(text => text.setPlaceholder('Archive').setValue(this.plugin.settings.archiveFolderName).onChange(async value => {
				this.plugin.settings.archiveFolderName = value.trim() || 'Archive';
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
