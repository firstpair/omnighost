import { GhostPostAccess } from './types';

/**
 * Ghost metadata extracted from frontmatter
 */
export interface GhostMetadata {
	post_access: GhostPostAccess;
	published: boolean;
	published_at?: string; // ISO date string for scheduling
	featured: boolean;
	tags: string[];
	excerpt: string;
	feature_image: string;
	no_sync: boolean;
	ghost_id?: string; // Ghost post ID if already synced
	slug?: string; // Custom slug
	ghost_url?: string; // Ghost editor URL for this post
	public_url?: string; // public URL of the published post
}

/**
 * Split file content into frontmatter block and body.
 * Returns null if no valid frontmatter is found.
 *
 * Handles edge cases:
 *  - trailing whitespace / CRLF line endings
 *  - closing `---` with or without a trailing newline
 */
export function splitFrontmatter(fileContent: string): { raw: string; body: string } | null {
	// Normalise line endings
	const content = fileContent.replace(/\r\n/g, '\n');

	if (!content.startsWith('---\n')) return null;

	const closeIndex = content.indexOf('\n---', 4);
	if (closeIndex === -1) return null;

	// raw = everything between the opening and closing ---
	const raw = content.slice(4, closeIndex);

	// body = everything after the closing --- (and optional newline)
	const afterClose = closeIndex + 4; // length of '\n---'
	const body = content.slice(
		content[afterClose] === '\n' ? afterClose + 1 : afterClose
	);

	return { raw, body };
}

/**
 * Rebuild a full file from a frontmatter block and a body.
 */
export function joinFrontmatter(raw: string, body: string): string {
	return `---\n${raw}\n---\n${body}`;
}

/**
 * Update (or add) a single key inside existing frontmatter raw text.
 * Preserves all other keys untouched.
 */
export function setFrontmatterKey(raw: string, key: string, value: string): string {
	// Escape special regex chars in key (dots, underscores, etc.)
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const linePattern = new RegExp(`^${escapedKey}:.*$`, 'm');

	if (linePattern.test(raw)) {
		return raw.replace(linePattern, `${key}: ${value}`);
	}
	// Key not found — append before the last line to keep things tidy
	return `${raw}\n${key}: ${value}`;
}

/**
 * Upsert multiple key/value pairs into frontmatter, preserving all existing keys.
 * `updates` is a plain object: { 'ghost_id': '123', 'ghost_slug': 'my-post' }
 */
export function upsertFrontmatterKeys(
	fileContent: string,
	updates: Record<string, string>
): string {
	const parsed = splitFrontmatter(fileContent);

	if (!parsed) {
		// No frontmatter — prepend a fresh block
		const lines = Object.entries(updates)
			.map(([k, v]) => `${k}: ${v}`)
			.join('\n');
		return joinFrontmatter(lines, `\n${fileContent}`);
	}

	let { raw, body } = parsed;

	for (const [key, value] of Object.entries(updates)) {
		raw = setFrontmatterKey(raw, key, value);
	}

	return joinFrontmatter(raw, body);
}

/**
 * Parse Ghost metadata from frontmatter
 */
export function parseGhostMetadata(
	frontmatter: Record<string, unknown>,
	prefix: string
): GhostMetadata | null {
	console.debug('[Ghost Parse] Starting parse with prefix:', prefix);
	console.debug('[Ghost Parse] Frontmatter keys:', Object.keys(frontmatter));

	// Helper to get prefixed property
	const get = (key: string): unknown => {
		return frontmatter[`${prefix}${key}`];
	};

	// Check if has any Ghost properties
	const hasGhostProps = Object.keys(frontmatter).some(key => {
		// Handle both with and without trailing underscore
		return key.startsWith(prefix) || key.startsWith(prefix.replace(/_$/, ''));
	});

	console.debug('[Ghost Parse] Has Ghost props?', hasGhostProps);

	if (!hasGhostProps) {
		return null;
	}

	// Parse post_access (visibility)
	const rawPostAccess = get('post_access');
	let post_access: GhostPostAccess = 'paid'; // Default: paid-members only
	if (rawPostAccess === 'public' || rawPostAccess === 'members' || rawPostAccess === 'paid') {
		post_access = rawPostAccess as GhostPostAccess;
	}

	// Parse tags
	let tags: string[] = [];
	const rawTags = get('tags');
	if (Array.isArray(rawTags)) {
		tags = rawTags.filter((t): t is string => typeof t === 'string');
	}

	// Parse boolean values properly (Obsidian can store as true/false or "true"/"false")
	const parseBool = (value: unknown): boolean => {
		if (typeof value === 'boolean') return value;
		if (typeof value === 'string') return value.toLowerCase() === 'true';
		return Boolean(value);
	};

	const featured = parseBool(get('featured'));
	const published = parseBool(get('published'));
	const no_sync = parseBool(get('no_sync'));

	console.debug('[Ghost Parse] Featured value:', get('featured'), '=> parsed:', featured);
	console.debug('[Ghost Parse] Published value:', get('published'), '=> parsed:', published);

	// Helper to safely convert unknown to string (returns '' for objects/arrays/null/undefined)
	const toSafeString = (value: unknown): string => {
		if (typeof value === 'string') return value.trim();
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		return '';
	};

	// Parse excerpt and feature_image (only if not empty)
	console.debug('[Ghost Parse] Excerpt raw value:', get('excerpt'));
	const excerpt = toSafeString(get('excerpt'));
	const feature_image = toSafeString(get('feature_image'));

	console.debug('[Ghost Parse] Excerpt parsed:', excerpt, '(length:', excerpt.length, ')');

	// Parse published_at (optional date for scheduling)
	const publishedAtStr = toSafeString(get('published_at'));
	const published_at = publishedAtStr !== '' ? publishedAtStr : undefined;

	return {
		post_access,
		published,
		published_at,
		featured,
		tags,
		excerpt,
		feature_image,
		no_sync,
		ghost_id: get('id') ? String(get('id')) : undefined,
		slug: get('slug') ? String(get('slug')) : undefined,
		ghost_url: get('url') ? String(get('url')) : undefined,
		public_url: get('public_url') ? String(get('public_url')) : undefined
	};
}

/**
 * Extract content without frontmatter
 */
export function extractContent(fileContent: string): string {
	const parsed = splitFrontmatter(fileContent);
	if (!parsed) return fileContent.trim();
	return parsed.body.trim();
}

/**
 * Update frontmatter with Ghost URL (editor link).
 * Preserves all existing frontmatter keys.
 */
export function updateFrontmatterWithGhostUrl(
	fileContent: string,
	ghostUrl: string,
	prefix: string,
	publicUrl?: string
): string {
	const updates: Record<string, string> = {
		[`${prefix}url`]: ghostUrl
	};
	// For published/scheduled posts, record the public URL just below the editor URL.
	if (publicUrl) {
		updates[`${prefix}public_url`] = publicUrl;
	}
	return upsertFrontmatterKeys(fileContent, updates);
}

/**
 * Update frontmatter with Ghost ID and slug after sync.
 * Preserves all existing frontmatter keys.
 */
export function updateFrontmatterWithGhostId(
	fileContent: string,
	ghostId: string,
	slug: string,
	prefix: string
): string {
	return upsertFrontmatterKeys(fileContent, {
		[`${prefix}id`]: ghostId,
		[`${prefix}slug`]: slug
	});
}

/**
 * Upsert Ghost post metadata into existing frontmatter.
 * Preserves ALL existing keys (both Ghost and non-Ghost).
 * Only the keys present in `fields` are created or updated.
 */
export function upsertGhostMetadata(
	fileContent: string,
	fields: Record<string, string>,
	prefix: string
): string {
	const prefixedFields: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		prefixedFields[`${prefix}${key}`] = value;
	}
	return upsertFrontmatterKeys(fileContent, prefixedFields);
}
