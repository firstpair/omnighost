/**
 * One configured Ghost blog. Each blog has its own URL, Admin API key (stored in
 * the keychain under `apiKeySecretName`), and its own folder for imported posts.
 */
export interface GhostBlog {
	id: string;               // stable, generated id
	name: string;             // display name
	url: string;
	apiKeySecretName: string; // name of the secret in Obsidian's keychain
	folder: string;           // vault folder for this blog's posts
	folderAuto?: boolean;     // folder is derived from the URL: "<root>/<domain>"
	syncEnabled?: boolean;    // per-blog periodic sync toggle
	syncIntervalMinutes?: number; // optional per-blog sync cadence override
	aliases?: string[];       // previous names/tokens accepted by g_blog matching
}

/**
 * Plugin settings interface
 * Note: ghostAdminApiKey is stored securely in Obsidian's Secrets (Keychain)
 */
export interface GhostWriterSettings {
	// Multiple blogs. The first time the plugin loads, the legacy single-blog
	// fields below are migrated into blogs[0].
	blogs: GhostBlog[];
	defaultBlogId: string; // last-selected blog; default for new notes

	// Legacy single-blog fields (kept for migration / backward compatibility).
	ghostUrl: string;
	ghostApiKeySecretName: string; // Name of the secret in Obsidian's Keychain
	syncFolder: string;

	syncInterval: number; // in minutes
	autoImportTextpacks: boolean; // import .textpack files that appear in the vault
	yamlPrefix: string;
	lastSync: number;
	showSyncNotifications: boolean;
	promptDeleteOnFolderDelete: boolean;
	confirmEachRemoteDelete: boolean;
	archiveDeletedNotes: boolean;
	archiveFolderName: string;
	schedulingIntervalDays: number; // days between scheduled publications
	defaultPublishTime: string; // HH:MM (UTC) for scheduled posts
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: GhostWriterSettings = {
	blogs: [],
	defaultBlogId: '',
	ghostUrl: '',
	ghostApiKeySecretName: 'ghost-api-key',
	syncFolder: 'Ghost Posts',
	syncInterval: 15,
	autoImportTextpacks: true,
	yamlPrefix: 'ghost_',
	lastSync: 0,
	showSyncNotifications: true,
	promptDeleteOnFolderDelete: true,
	confirmEachRemoteDelete: true,
	archiveDeletedNotes: true,
	archiveFolderName: 'Archive',
	schedulingIntervalDays: 7,
	defaultPublishTime: '09:00',
};

/**
 * Ghost post status
 */
export type GhostPostStatus = 'draft' | 'published' | 'scheduled';

/**
 * Ghost post access (visibility)
 */
export type GhostPostAccess = 'public' | 'members' | 'paid';

/**
 * Ghost post interface (simplified for now)
 */
export interface GhostPost {
	id: string;
	uuid: string;
	title: string;
	slug: string;
	html: string;
	lexical: string;
	status: GhostPostStatus;
	visibility: GhostPostAccess; // Ghost API uses 'visibility' field
	featured: boolean;
	feature_image: string | null;
	excerpt: string | null;
	tags: Array<{ name: string }>;
	published_at: string | null;
	updated_at: string;
	created_at: string;
	url?: string; // public URL of the post (returned by the Ghost Admin API)
}
