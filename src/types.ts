/**
 * Plugin settings interface
 * Note: ghostAdminApiKey is stored securely in Obsidian's Secrets (Keychain)
 */
export interface GhostWriterSettings {
	ghostUrl: string;
	ghostApiKeySecretName: string; // Name of the secret in Obsidian's Keychain
	syncFolder: string;
	syncInterval: number; // in minutes
	yamlPrefix: string;
	lastSync: number;
	showSyncNotifications: boolean;
	schedulingIntervalDays: number; // days between scheduled publications
	defaultPublishTime: string; // HH:MM (UTC) for scheduled posts
	/** Cache of uploaded image content-hash → Ghost URL, so images aren't re-uploaded. */
	imageCache: Record<string, string>;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: GhostWriterSettings = {
	ghostUrl: '',
	ghostApiKeySecretName: 'ghost-api-key',
	syncFolder: 'Ghost Posts',
	syncInterval: 15,
	yamlPrefix: 'ghost_',
	lastSync: 0,
	showSyncNotifications: true,
	schedulingIntervalDays: 7,
	defaultPublishTime: '09:00',
	imageCache: {},
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
