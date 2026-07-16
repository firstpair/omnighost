import { splitFrontmatter, yamlString } from '../frontmatter-parser';
import { stableJsonStringify } from './publication-provenance';

export const TEXTPACK_PROVENANCE_SCHEMA = 'omnighost-textpack-v1';

const SOURCE_KIND_SUFFIX = 'source_kind';
const SOURCE_GIT_COMMIT_SUFFIX = 'source_git_commit';
const SOURCE_PAYLOAD_SHA_SUFFIX = 'source_payload_sha256';
const SOURCE_MARKDOWN_SHA_SUFFIX = 'source_markdown_sha256';
const SOURCE_ASSETS_SUFFIX = 'source_assets';
const SOURCE_SNAPSHOT_SHA_SUFFIX = 'source_snapshot_sha256';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FULL_GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface TextpackPublishingMetadata {
	blog?: string;
	slug?: string;
	title?: string;
	tags?: string[];
	excerpt?: string;
}

export interface TextpackPayloadAsset {
	name: string;
	sha256: string;
}

export interface TextpackSourceVersion {
	schema: typeof TEXTPACK_PROVENANCE_SCHEMA;
	payloadSha256: string;
	markdownSha256: string;
	assets: TextpackPayloadAsset[];
	gitCommit?: string;
}

export interface ImportedTextpackAsset {
	path: string;
	sha256: string;
}

export interface ImportedTextpackSourceFields {
	[sourceField: string]: string;
}

export type TextpackInheritanceValidation =
	| { kind: 'none' }
	| { kind: 'invalid'; reason: string }
	| { kind: 'valid'; source: TextpackSourceVersion };

export type TextpackAssetReader = (noteRelativePath: string) => Promise<Uint8Array | null>;

/** Compute the portable digest embedded by textpack producers and verified on import. */
export async function createTextpackSourceVersion(
	markdown: string,
	assets: ReadonlyMap<string, Uint8Array>,
	publishing: TextpackPublishingMetadata,
	gitCommit?: string | null
): Promise<TextpackSourceVersion> {
	const normalizedCommit = normalizeFullGitCommit(gitCommit);
	const markdownSha256 = await sha256Bytes(new TextEncoder().encode(markdown));
	const assetManifest = await Promise.all(
		Array.from(assets.entries())
			.sort(([left], [right]) => compareUnicodeCodePoints(left, right))
			.map(async ([name, data]) => ({ name, sha256: await sha256Bytes(data) }))
	);
	const payloadSha256 = await sha256Bytes(new TextEncoder().encode(stableJsonStringify({
		schema: TEXTPACK_PROVENANCE_SCHEMA,
		markdownSha256,
		assets: assetManifest,
		publishing: normalizedPublishingMetadata(publishing),
		gitCommit: normalizedCommit ?? null
	})));

	return {
		schema: TEXTPACK_PROVENANCE_SCHEMA,
		payloadSha256,
		markdownSha256,
		assets: assetManifest,
		...(normalizedCommit ? { gitCommit: normalizedCommit } : {})
	};
}

/** Fields persisted in an imported note before its post-import snapshot is hashed. */
export function importedTextpackSourceFields(
	prefix: string,
	source: TextpackSourceVersion,
	assets: ImportedTextpackAsset[]
): ImportedTextpackSourceFields {
	return {
		[`${prefix}${SOURCE_KIND_SUFFIX}`]: 'textpack',
		[`${prefix}${SOURCE_PAYLOAD_SHA_SUFFIX}`]: source.payloadSha256,
		[`${prefix}${SOURCE_MARKDOWN_SHA_SUFFIX}`]: source.markdownSha256,
		[`${prefix}${SOURCE_ASSETS_SUFFIX}`]: yamlString(stableJsonStringify(normalizeImportedAssets(assets)), true),
		...(source.gitCommit ? { [`${prefix}${SOURCE_GIT_COMMIT_SUFFIX}`]: source.gitCommit } : {})
	};
}

/** Hash authorial note state while ignoring publish controls and Ghost write-backs. */
export async function hashImportedTextpackSnapshot(
	content: string,
	frontmatter: Record<string, unknown>,
	prefix: string
): Promise<string> {
	const authorialFrontmatter: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		if (!isOperationalFrontmatterKey(key, prefix)) {
			authorialFrontmatter[key] = normalizeSnapshotValue(value);
		}
	}
	const coverFromFirstImageKey = `${prefix}cover_from_first_image`;
	if (!(coverFromFirstImageKey in authorialFrontmatter)) {
		authorialFrontmatter[coverFromFirstImageKey] = false;
	}
	canonicalizeManagedAuthorialFields(authorialFrontmatter, prefix);
	const body = (splitFrontmatter(content)?.body ?? content)
		.replace(/\r\n/g, '\n')
		.replace(/\n+$/, '');
	return sha256Bytes(new TextEncoder().encode(stableJsonStringify({
		frontmatter: authorialFrontmatter,
		body
	})));
}

export function importedTextpackSnapshotField(prefix: string, digest: string): Record<string, string> {
	const normalized = normalizeSha256(digest);
	if (!normalized) throw new Error('Imported textpack snapshot must be a SHA-256 digest');
	return { [`${prefix}${SOURCE_SNAPSHOT_SHA_SUFFIX}`]: normalized };
}

/** Validate persisted source metadata, note state, and every imported asset byte. */
export async function validateInheritedTextpackSource(
	content: string,
	frontmatter: Record<string, unknown>,
	prefix: string,
	readAsset: TextpackAssetReader
): Promise<TextpackInheritanceValidation> {
	const value = (suffix: string): unknown => frontmatter[`${prefix}${suffix}`];
	if (value(SOURCE_KIND_SUFFIX) !== 'textpack') return { kind: 'none' };

	const payloadSha256 = normalizeSha256(value(SOURCE_PAYLOAD_SHA_SUFFIX));
	const markdownSha256 = normalizeSha256(value(SOURCE_MARKDOWN_SHA_SUFFIX));
	const snapshotSha256 = normalizeSha256(value(SOURCE_SNAPSHOT_SHA_SUFFIX));
	const gitCommitValue = value(SOURCE_GIT_COMMIT_SUFFIX);
	const gitCommit = normalizeFullGitCommit(gitCommitValue);
	if (!payloadSha256 || !markdownSha256 || !snapshotSha256) {
		return { kind: 'invalid', reason: 'incomplete source metadata' };
	}
	if (gitCommitValue !== undefined && gitCommitValue !== null && !gitCommit) {
		return { kind: 'invalid', reason: 'invalid source Git commit' };
	}

	const assets = parseImportedAssets(value(SOURCE_ASSETS_SUFFIX));
	if (!assets) return { kind: 'invalid', reason: 'invalid source asset manifest' };
	const currentSnapshot = await hashImportedTextpackSnapshot(content, frontmatter, prefix);
	if (currentSnapshot !== snapshotSha256) {
		return { kind: 'invalid', reason: 'note content or publishing metadata changed' };
	}

	for (const asset of assets) {
		const data = await readAsset(asset.path);
		if (!data || await sha256Bytes(data) !== asset.sha256) {
			return { kind: 'invalid', reason: `imported asset changed: ${asset.path}` };
		}
	}

	return {
		kind: 'valid',
		source: {
			schema: TEXTPACK_PROVENANCE_SCHEMA,
			payloadSha256,
			markdownSha256,
			assets: assets.map(({ path, sha256 }) => ({ name: path, sha256 })),
			...(gitCommit ? { gitCommit } : {})
		}
	};
}

export function normalizeFullGitCommit(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim().toLowerCase();
	return FULL_GIT_COMMIT_PATTERN.test(normalized) ? normalized : undefined;
}

export function normalizeSha256(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim().toLowerCase();
	return SHA256_PATTERN.test(normalized) ? normalized : undefined;
}

export async function sha256Bytes(value: Uint8Array): Promise<string> {
	if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
	const bytes = new Uint8Array(value);
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedPublishingMetadata(metadata: TextpackPublishingMetadata): TextpackPublishingMetadata {
	return {
		...(metadata.blog ? { blog: metadata.blog } : {}),
		...(metadata.slug ? { slug: metadata.slug } : {}),
		...(metadata.title ? { title: metadata.title } : {}),
		...(metadata.tags ? { tags: [...metadata.tags] } : {}),
		...(metadata.excerpt ? { excerpt: metadata.excerpt } : {})
	};
}

function normalizeImportedAssets(assets: ImportedTextpackAsset[]): ImportedTextpackAsset[] {
	return assets
		.map(({ path, sha256 }) => ({ path: normalizeRelativeAssetPath(path), sha256: normalizeSha256(sha256) ?? '' }))
		.filter(({ path, sha256 }) => path !== '' && sha256 !== '')
		.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));
}

/** Match Python's deterministic Unicode code-point ordering (never the device locale). */
function compareUnicodeCodePoints(left: string, right: string): number {
	const leftIterator = left[Symbol.iterator]();
	const rightIterator = right[Symbol.iterator]();
	while (true) {
		const leftPart = leftIterator.next();
		const rightPart = rightIterator.next();
		if (leftPart.done || rightPart.done) {
			if (leftPart.done && rightPart.done) return 0;
			return leftPart.done ? -1 : 1;
		}
		const leftPoint = leftPart.value.codePointAt(0) ?? 0;
		const rightPoint = rightPart.value.codePointAt(0) ?? 0;
		if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
	}
}

function parseImportedAssets(value: unknown): ImportedTextpackAsset[] | null {
	if (typeof value !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	const assets: ImportedTextpackAsset[] = [];
	for (const entry of parsed) {
		if (!isRecord(entry)) return null;
		const path = normalizeRelativeAssetPath(entry.path);
		const sha256 = normalizeSha256(entry.sha256);
		if (!path || !sha256) return null;
		assets.push({ path, sha256 });
	}
	const normalized = normalizeImportedAssets(assets);
	return normalized.length === assets.length ? normalized : null;
}

function normalizeRelativeAssetPath(value: unknown): string {
	if (typeof value !== 'string') return '';
	const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
	if (
		normalized === ''
		|| normalized.startsWith('/')
		|| normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
	) return '';
	return normalized;
}

function isOperationalFrontmatterKey(key: string, prefix: string): boolean {
	if (!key.startsWith(prefix)) return false;
	const suffix = key.slice(prefix.length);
	if (suffix === SOURCE_SNAPSHOT_SHA_SUFFIX) return true;
	if ([
		'published',
		'published_at',
		'no_sync',
		'blog',
		'id',
		'url',
		'public_url',
		'ids',
		'public_urls'
	].includes(suffix)) return true;
	return suffix.startsWith('id_') || suffix.startsWith('url_') || suffix.startsWith('public_url_');
}

function normalizeSnapshotValue(value: unknown): unknown {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}
	if (Array.isArray(value)) return value.map(normalizeSnapshotValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, normalizeSnapshotValue(entry)])
	);
}

/** Match the semantics used by the properties modal, avoiding formatting-only invalidation. */
function canonicalizeManagedAuthorialFields(
	frontmatter: Record<string, unknown>,
	prefix: string
): void {
	const key = (suffix: string): string => `${prefix}${suffix}`;
	const value = (suffix: string): unknown => frontmatter[key(suffix)];
	const safeString = (input: unknown): string => {
		if (typeof input === 'string') return input.trim();
		if (typeof input === 'number' || typeof input === 'boolean') return String(input);
		return '';
	};
	const booleanValue = (input: unknown): boolean => {
		if (typeof input === 'boolean') return input;
		if (typeof input === 'string') return input.toLowerCase() === 'true';
		return Boolean(input);
	};

	const rawAccess = safeString(value('post_access')).toLowerCase();
	frontmatter[key('post_access')] = ['public', 'members', 'paid'].includes(rawAccess)
		? rawAccess
		: 'paid';
	frontmatter[key('featured')] = booleanValue(value('featured'));
	frontmatter[key('cover_from_first_image')] = booleanValue(value('cover_from_first_image'));
	frontmatter[key('excerpt')] = safeString(value('excerpt'));
	frontmatter[key('feature_image')] = safeString(value('feature_image'));
	frontmatter[key('slug')] = safeString(value('slug'));
	const tags = value('tags');
	frontmatter[key('tags')] = Array.isArray(tags)
		? tags
			.filter((tag): tag is string => typeof tag === 'string')
			.flatMap((tag) => tag.split(',').map((part) => part.trim()).filter(Boolean))
		: [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
