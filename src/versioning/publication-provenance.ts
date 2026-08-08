import { DEFAULT_PUBLICATION_PROVENANCE_PRESENTATION } from '../types';
import type {
	PublicationProvenanceDelimiter,
	PublicationProvenanceFontSize,
	PublicationProvenancePresentation,
	PublicationProvenanceVisibility,
	PublicationProvenanceVisibilityOverride
} from '../types';

export { DEFAULT_PUBLICATION_PROVENANCE_PRESENTATION } from '../types';
export type { PublicationProvenanceVisibility } from '../types';

export const OMNIGHOST_REPOSITORY_URL = 'https://github.com/firstpair/omnighost';
export const PUBLICATION_PROVENANCE_SCHEMA = 'omnighost-publication-v1';
export const MANAGED_PUBLICATION_SCHEMA = 'omnighost-managed-publication-v1';

const PROVENANCE_LINK_TITLE = 'omnighost-provenance-v1';
const HIDDEN_BLOCK_START = '<!-- omnighost-provenance:v1:start -->';
const HIDDEN_BLOCK_END = '<!-- omnighost-provenance:v1:end -->';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface ManagedPublicationInput {
	title: string;
	lexical: string;
	status: string;
	visibility: string;
	featured: boolean;
	slug: string;
	custom_excerpt?: string | null;
	feature_image?: string | null;
	tags: ReadonlyArray<string | { name: string }>;
	published_at?: string | null;
}

export interface PublicationVersion {
	gitCommit?: string | null;
}

export interface PublicationVersionSelectionOptions {
	allowedExistingGitCommit?: string | null;
	currentVisible?: VisiblePublicationProvenance | null;
}

export interface PublicationProvenance {
	schema: typeof PUBLICATION_PROVENANCE_SCHEMA;
	publicationSha256: string;
	repositoryUrl: typeof OMNIGHOST_REPOSITORY_URL;
	gitCommit?: string;
}

export interface StrippedLexicalProvenance {
	lexical: string;
	removed: boolean;
	visible?: VisiblePublicationProvenance;
}

export interface VisiblePublicationProvenance {
	mode: Exclude<PublicationProvenanceVisibility, 'hidden'>;
	presentation: PublicationProvenancePresentation;
	publicationSha256?: string;
	gitCommitDisplay?: string;
}

export interface PreparedPublicationProvenance {
	publicationSha256: string;
	provenance: PublicationProvenance;
	lexical: string;
	hiddenBlock: string;
}

export interface ResolvedPublicationProvenanceImprint {
	visibility: PublicationProvenanceVisibility;
	presentation: PublicationProvenancePresentation;
}

export interface PublicationStateComparison {
	unchanged: boolean;
	contentMatches: boolean;
	visibleProvenanceMatches: boolean;
	hiddenMetadataMatches: boolean;
	embeddedDigestMatchesCurrent: boolean;
	embeddedDigestIsStale: boolean;
	desiredSha256: string;
	currentSha256: string;
	embeddedSha256: string | null;
	desired: PreparedPublicationProvenance;
	desiredCodeInjectionHead: string;
}

export interface ComparePublicationStateOptions extends PublicationVersion {
	desired: ManagedPublicationInput;
	current: ManagedPublicationInput;
	currentCodeInjectionHead?: string | null;
	visibility: PublicationProvenanceVisibility;
	presentation?: PublicationProvenancePresentation;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type UnknownRecord = Record<string, unknown>;

interface OwnedBlockRange {
	start: number;
	end: number;
}

/**
 * Serialize a JSON-compatible value with recursively sorted object keys.
 * Array order remains significant because Lexical child order and Ghost tag
 * order are semantically meaningful.
 */
export function stableJsonStringify(value: unknown): string {
	const canonical = canonicalizeJson(value, false);
	if (canonical === undefined) {
		throw new Error('Cannot canonicalize an undefined top-level value');
	}
	return JSON.stringify(canonical);
}

/** Build the deterministic managed representation used for publication hashes. */
export function canonicalManagedPublicationJson(publication: ManagedPublicationInput): string {
	const lexicalDocument = parseLexicalDocument(publication.lexical);
	stripTrailingProvenanceNode(lexicalDocument);

	const scheduledAt = publication.status === 'scheduled'
		? normalizeScheduledTimestamp(publication.published_at)
		: null;

	return stableJsonStringify({
		schema: MANAGED_PUBLICATION_SCHEMA,
		title: publication.title,
		lexical: lexicalDocument,
		status: publication.status,
		visibility: publication.visibility,
		featured: publication.featured,
		slug: publication.slug,
		custom_excerpt: publication.custom_excerpt ?? null,
		feature_image: publication.feature_image ?? null,
		tags: publication.tags.map((tag) => typeof tag === 'string' ? tag : tag.name),
		published_at: scheduledAt
	});
}

/** Hash all managed publication fields after removing Omnighost provenance. */
export async function hashManagedPublication(publication: ManagedPublicationInput): Promise<string> {
	return sha256Hex(canonicalManagedPublicationJson(publication));
}

/** Create a validated provenance record with the fixed Omnighost repository. */
export function createPublicationProvenance(
	publicationSha256: string,
	version: PublicationVersion = {}
): PublicationProvenance {
	const digest = publicationSha256.trim().toLowerCase();
	if (!SHA256_PATTERN.test(digest)) {
		throw new Error('Publication SHA-256 must contain exactly 64 hexadecimal characters');
	}

	const gitCommit = normalizeGitCommit(version.gitCommit);
	return {
		schema: PUBLICATION_PROVENANCE_SCHEMA,
		publicationSha256: digest,
		repositoryUrl: OMNIGHOST_REPOSITORY_URL,
		...(gitCommit ? { gitCommit } : {})
	};
}

/**
 * Remove a marked Omnighost card (or strict legacy paragraph) only when it is
 * the final Lexical block.
 * The original lexical string is returned byte-for-byte when nothing is removed.
 */
export function stripTrailingPublicationProvenance(lexical: string): StrippedLexicalProvenance {
	const document = parseLexicalDocument(lexical);
	const visible = stripTrailingProvenanceNode(document);
	if (!visible) {
		return { lexical, removed: false };
	}
	return { lexical: JSON.stringify(document), removed: true, visible };
}

/** Inspect the final Lexical block without changing the document. */
export function extractTrailingVisiblePublicationProvenance(
	lexical: string
): VisiblePublicationProvenance | null {
	const document = parseLexicalDocument(lexical);
	const children = lexicalChildren(document);
	if (children.length === 0) return null;
	return classifyProvenanceNode(children[children.length - 1]);
}

/** Compare content and the recognized trailing provenance semantically. */
export function publicationLexicalDocumentsEqual(left: string, right: string): boolean {
	const leftStripped = stripTrailingPublicationProvenance(left);
	const rightStripped = stripTrailingPublicationProvenance(right);
	if (!lexicalDocumentsEqual(leftStripped.lexical, rightStripped.lexical)) return false;
	return stableJsonStringify(leftStripped.visible ?? null)
		=== stableJsonStringify(rightStripped.visible ?? null);
}

/** Remove Omnighost's rendered final card or legacy paragraph before imports. */
export function stripRenderedPublicationProvenanceHtml(html: string): string {
	const cardMarker = '<div data-omnighost-provenance="v1"';
	const cardStart = html.toLowerCase().lastIndexOf(cardMarker);
	if (cardStart !== -1) {
		const cardEndMarker = '</div>';
		const cardEnd = html.indexOf(cardEndMarker, cardStart);
		if (cardEnd !== -1) {
			const candidateEnd = cardEnd + cardEndMarker.length;
			const suffix = html.slice(candidateEnd);
			if (/^(?:\s*<!--kg-card-end:\s*html-->)?\s*$/i.test(suffix)) {
				const candidate = html.slice(cardStart, candidateEnd);
				if (classifyProvenanceHtml(candidate)) {
					const before = html.slice(0, cardStart);
					const wrapper = /<!--kg-card-begin:\s*html-->\s*$/i.exec(before);
					return html.slice(0, wrapper?.index ?? cardStart);
				}
			}
		}
	}

	// Omnighost 0.13 and earlier used a native final paragraph. Keep recognizing
	// that strict legacy shape so Ghost-to-note imports do not pull it into notes.
	const paragraphStart = html.toLowerCase().lastIndexOf('<p');
	if (paragraphStart === -1) return html;
	const match = /^<p(?:\s[^>]*)?>([\s\S]*?)<\/p>\s*$/i.exec(html.slice(paragraphStart));
	if (!match) return html;

	const inner = match[1];
	const escapedRepository = OMNIGHOST_REPOSITORY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const repositoryLink = new RegExp(
		`<a\\b[^>]*\\bhref=(?:"${escapedRepository}"|'${escapedRepository}')[^>]*>\\s*omnighost\\s*<\\/a>`,
		'i'
	);
	if (!repositoryLink.test(inner)) return html;

	const text = decodeRenderedHtmlText(inner.replace(/<[^>]*>/g, ''));
	if (text === 'published with omnighost') return html.slice(0, paragraphStart);
	if (/^published with omnighost(?: · Git [0-9a-f]{7,64})? · SHA-256 [0-9a-f]{64}$/.test(text)) {
		return html.slice(0, paragraphStart);
	}
	return html;
}

/**
 * Replace the trailing Omnighost card for the selected visibility mode.
 * Hidden mode removes a previous marked card or legacy paragraph and appends nothing.
 */
export function applyVisiblePublicationProvenance(
	lexical: string,
	visibility: PublicationProvenanceVisibility,
	provenance: PublicationProvenance,
	presentation: PublicationProvenancePresentation = DEFAULT_PUBLICATION_PROVENANCE_PRESENTATION
): string {
	const document = parseLexicalDocument(lexical);
	const removed = stripTrailingProvenanceNode(document) !== null;
	if (visibility === 'hidden') {
		return removed ? JSON.stringify(document) : lexical;
	}

	lexicalChildren(document).push(createVisibleProvenanceCard(
		visibility,
		provenance,
		normalizePublicationProvenancePresentation(presentation)
	));
	return JSON.stringify(document);
}

/** Build the sentinel-owned, non-visible per-post code-injection block. */
export function buildHiddenPublicationProvenance(provenance: PublicationProvenance): string {
	const lines = [
		HIDDEN_BLOCK_START,
		metaTag('omnighost-schema', provenance.schema),
		metaTag('omnighost-publication-sha256', provenance.publicationSha256)
	];
	if (provenance.gitCommit) {
		lines.push(metaTag('omnighost-git-commit', provenance.gitCommit));
	}
	lines.push(metaTag('omnighost-repository', provenance.repositoryUrl));
	lines.push(HIDDEN_BLOCK_END);
	return lines.join('\n');
}

/** Extract only a complete, valid sentinel-owned provenance block. */
export function extractHiddenPublicationProvenance(
	codeInjectionHead: string | null | undefined
): PublicationProvenance | null {
	const source = codeInjectionHead ?? '';
	const range = findOwnedBlockRanges(source)[0];
	if (!range) return null;

	const values = parseOwnedMetaTags(source.slice(range.start, range.end));
	if (values.get('omnighost-schema') !== PUBLICATION_PROVENANCE_SCHEMA) return null;
	if (values.get('omnighost-repository') !== OMNIGHOST_REPOSITORY_URL) return null;

	const digest = (values.get('omnighost-publication-sha256') ?? '').toLowerCase();
	if (!SHA256_PATTERN.test(digest)) return null;

	const gitCommitValue = values.get('omnighost-git-commit');
	const gitCommit = gitCommitValue ? normalizeGitCommit(gitCommitValue) : undefined;
	if (gitCommitValue && !gitCommit) return null;

	return {
		schema: PUBLICATION_PROVENANCE_SCHEMA,
		publicationSha256: digest,
		repositoryUrl: OMNIGHOST_REPOSITORY_URL,
		...(gitCommit ? { gitCommit } : {})
	};
}

/**
 * Keep the Git commit already associated with an unchanged publication digest.
 * This prevents Ghost identifier write-backs in the note from replacing the
 * source commit for content that has not actually changed.
 */
export function selectPublicationVersion(
	desired: PublicationProvenance,
	currentCodeInjectionHead: string | null | undefined,
	options: PublicationVersionSelectionOptions = {}
): PublicationVersion {
	const current = extractHiddenPublicationProvenance(currentCodeInjectionHead);
	const displayedCommit = options.currentVisible?.gitCommitDisplay;
	const visibleAgrees = !displayedCommit || current?.gitCommit?.startsWith(displayedCommit) === true;
	const currentCommitIsAllowed = !desired.gitCommit
		|| current?.gitCommit === desired.gitCommit
		|| current?.gitCommit === normalizeGitCommit(options.allowedExistingGitCommit);
	const retainCurrent = current?.publicationSha256 === desired.publicationSha256
		&& visibleAgrees
		&& currentCommitIsAllowed;
	const gitCommit = retainCurrent
		? current.gitCommit ?? desired.gitCommit
		: desired.gitCommit;
	return gitCommit ? { gitCommit } : {};
}

/**
 * Replace all complete Omnighost-owned blocks with one current block while
 * preserving every byte outside those owned ranges. If none exists, append one.
 */
export function mergeHiddenPublicationProvenance(
	codeInjectionHead: string | null | undefined,
	provenance: PublicationProvenance
): string {
	const source = codeInjectionHead ?? '';
	const replacement = buildHiddenPublicationProvenance(provenance);
	const ranges = findOwnedBlockRanges(source);
	if (ranges.length === 0) {
		if (source === '') return replacement;
		const separator = source.endsWith('\n') || source.endsWith('\r') ? '' : '\n';
		return `${source}${separator}${replacement}`;
	}

	let result = '';
	let cursor = 0;
	ranges.forEach((range, index) => {
		result += source.slice(cursor, range.start);
		if (index === 0) result += replacement;
		cursor = range.end;
	});
	return result + source.slice(cursor);
}

/**
 * Fast-path comparison that trusts Ghost's stored provenance instead of
 * recomputing the fetched publication. Presentation mode and the complete
 * owned hidden block must still match.
 */
export function storedPublicationProvenanceMatches(
	currentLexical: string,
	currentCodeInjectionHead: string | null | undefined,
	desiredLexical: string,
	desiredCodeInjectionHead: string | null | undefined
): boolean {
	const desiredProvenance = extractHiddenPublicationProvenance(desiredCodeInjectionHead);
	const currentProvenance = extractHiddenPublicationProvenance(currentCodeInjectionHead);
	if (!desiredProvenance || !currentProvenance) return false;
	if (stableJsonStringify(desiredProvenance) !== stableJsonStringify(currentProvenance)) return false;

	const desiredHead = mergeHiddenPublicationProvenance(currentCodeInjectionHead, desiredProvenance);
	if ((currentCodeInjectionHead ?? '') !== desiredHead) return false;

	const desiredVisible = extractTrailingVisiblePublicationProvenance(desiredLexical);
	const currentVisible = extractTrailingVisiblePublicationProvenance(currentLexical);
	return stableJsonStringify(desiredVisible) === stableJsonStringify(currentVisible);
}

/** Hash and apply both visible and hidden representations for an outbound post. */
export async function preparePublicationProvenance(
	publication: ManagedPublicationInput,
	visibility: PublicationProvenanceVisibility,
	version: PublicationVersion = {},
	presentation: PublicationProvenancePresentation = DEFAULT_PUBLICATION_PROVENANCE_PRESENTATION
): Promise<PreparedPublicationProvenance> {
	const publicationSha256 = await hashManagedPublication(publication);
	const provenance = createPublicationProvenance(publicationSha256, version);
	return {
		publicationSha256,
		provenance,
		lexical: applyVisiblePublicationProvenance(publication.lexical, visibility, provenance, presentation),
		hiddenBlock: buildHiddenPublicationProvenance(provenance)
	};
}

/**
 * Compare desired and fetched Ghost state. The embedded digest is diagnostic,
 * never authoritative: a Ghost-side edit makes it stale and forces an update.
 */
export async function compareManagedPublicationState(
	options: ComparePublicationStateOptions
): Promise<PublicationStateComparison> {
	const desired = await preparePublicationProvenance(
		options.desired,
		options.visibility,
		{ gitCommit: options.gitCommit },
		options.presentation
	);
	const currentSha256 = await hashManagedPublication(options.current);
	const embedded = extractHiddenPublicationProvenance(options.currentCodeInjectionHead);
	const embeddedSha256 = embedded?.publicationSha256 ?? null;

	const desiredVisible = extractTrailingVisiblePublicationProvenance(desired.lexical);
	const currentVisible = extractTrailingVisiblePublicationProvenance(options.current.lexical);
	const visibleProvenanceMatches = stableJsonStringify(desiredVisible)
		=== stableJsonStringify(currentVisible);
	const desiredCodeInjectionHead = mergeHiddenPublicationProvenance(
		options.currentCodeInjectionHead,
		desired.provenance
	);
	const currentCodeInjectionHead = options.currentCodeInjectionHead ?? '';
	const hiddenMetadataMatches = desiredCodeInjectionHead === currentCodeInjectionHead;
	const contentMatches = desired.publicationSha256 === currentSha256;
	const embeddedDigestMatchesCurrent = embeddedSha256 === currentSha256;
	const embeddedDigestIsStale = embeddedSha256 !== null && !embeddedDigestMatchesCurrent;

	return {
		unchanged: contentMatches && visibleProvenanceMatches && hiddenMetadataMatches && embeddedDigestMatchesCurrent,
		contentMatches,
		visibleProvenanceMatches,
		hiddenMetadataMatches,
		embeddedDigestMatchesCurrent,
		embeddedDigestIsStale,
		desiredSha256: desired.publicationSha256,
		currentSha256,
		embeddedSha256,
		desired,
		desiredCodeInjectionHead
	};
}

function canonicalizeJson(value: unknown, insideArray: boolean): JsonValue | undefined {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
		return insideArray ? null : undefined;
	}
	if (typeof value === 'bigint') {
		throw new Error('Cannot canonicalize bigint values');
	}
	if (Array.isArray(value)) {
		return value.map((entry) => canonicalizeJson(entry, true) ?? null);
	}
	if (!isRecord(value)) {
		throw new Error('Cannot canonicalize a non-JSON object');
	}

	const result: { [key: string]: JsonValue } = {};
	for (const key of Object.keys(value).sort()) {
		const normalized = canonicalizeJson(value[key], false);
		if (normalized !== undefined) result[key] = normalized;
	}
	return result;
}

async function sha256Hex(value: string): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw new Error('Web Crypto SHA-256 is unavailable');
	}
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseLexicalDocument(lexical: string): UnknownRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(lexical) as unknown;
	} catch {
		throw new Error('Publication lexical content is not valid JSON');
	}
	if (!isRecord(parsed) || !isRecord(parsed.root) || !Array.isArray(parsed.root.children)) {
		throw new Error('Publication lexical content has no root children array');
	}
	return parsed;
}

function lexicalChildren(document: UnknownRecord): unknown[] {
	const root = document.root;
	if (!isRecord(root) || !Array.isArray(root.children)) {
		throw new Error('Publication lexical content has no root children array');
	}
	return root.children;
}

function stripTrailingProvenanceNode(document: UnknownRecord): VisiblePublicationProvenance | null {
	const children = lexicalChildren(document);
	if (children.length === 0) return null;
	const visible = classifyProvenanceNode(children[children.length - 1]);
	if (!visible) return null;
	children.pop();
	return visible;
}

function classifyProvenanceNode(node: unknown): VisiblePublicationProvenance | null {
	if (isRecord(node) && node.type === 'html' && typeof node.html === 'string') {
		return classifyProvenanceHtml(node.html);
	}
	return classifyLegacyProvenanceParagraph(node);
}

function classifyProvenanceHtml(html: string): VisiblePublicationProvenance | null {
	const outer = /^<div data-omnighost-provenance="v1" data-omnighost-mode="(visible-hash|visible-credit)" data-omnighost-delimiter="(none|single|double)" data-omnighost-size="(normal|small|tiny)" data-omnighost-italic="(true|false)">([\s\S]*)<\/div>$/.exec(html);
	if (!outer) return null;

	const mode = outer[1] as Exclude<PublicationProvenanceVisibility, 'hidden'>;
	const presentation: PublicationProvenancePresentation = {
		delimiter: outer[2] as PublicationProvenanceDelimiter,
		fontSize: outer[3] as PublicationProvenanceFontSize,
		italic: outer[4] === 'true'
	};
	const inner = outer[5];
	const repositoryLink = `<a href="${OMNIGHOST_REPOSITORY_URL}" rel="noopener">omnighost</a>`;
	if (!inner.includes(repositoryLink)) return null;
	const text = decodeRenderedHtmlText(inner.replace(/<[^>]*>/g, ''));

	let publicationSha256: string | undefined;
	let gitCommitDisplay: string | undefined;
	if (mode === 'visible-credit') {
		if (text !== 'published with omnighost') return null;
	} else {
		const full = text.match(
			/^published with omnighost(?: · Git ([0-9a-f]{7,64}))? · SHA-256 ([0-9a-f]{64})$/
		);
		if (!full) return null;
		gitCommitDisplay = full[1];
		publicationSha256 = full[2];
	}

	// The card's data attributes describe the presentation, but the exact HTML
	// remains the comparison authority. A manual Ghost edit to inline styles,
	// the divider, text, or link therefore invalidates the card and forces sync.
	const expected = createVisibleProvenanceHtml(
		mode,
		publicationSha256,
		gitCommitDisplay,
		presentation
	);
	if (html !== expected) return null;

	return {
		mode,
		presentation,
		...(publicationSha256 ? { publicationSha256 } : {}),
		...(gitCommitDisplay ? { gitCommitDisplay } : {})
	};
}

function classifyLegacyProvenanceParagraph(node: unknown): VisiblePublicationProvenance | null {
	if (!isRecord(node) || node.type !== 'paragraph' || !Array.isArray(node.children)) return null;
	const links = collectLinkNodes(node.children);
	if (links.length !== 1 || !isOmnighostRepositoryLink(links[0])) return null;

	const text = collectLexicalText(node);
	if (text === 'published with omnighost') {
		return {
			mode: 'visible-credit',
			presentation: { delimiter: 'none', fontSize: 'normal', italic: false }
		};
	}

	const full = text.match(
		/^published with omnighost(?: · Git ([0-9a-f]{7,64}))? · SHA-256 ([0-9a-f]{64})$/
	);
	if (!full) return null;
	return {
		mode: 'visible-hash',
		presentation: { delimiter: 'none', fontSize: 'normal', italic: false },
		publicationSha256: full[2],
		...(full[1] ? { gitCommitDisplay: full[1] } : {})
	};
}

function collectLinkNodes(children: unknown[]): UnknownRecord[] {
	const links: UnknownRecord[] = [];
	for (const child of children) {
		if (!isRecord(child)) continue;
		if (child.type === 'link') links.push(child);
		if (Array.isArray(child.children)) links.push(...collectLinkNodes(child.children));
	}
	return links;
}

function isOmnighostRepositoryLink(child: UnknownRecord): boolean {
	if (child.url !== OMNIGHOST_REPOSITORY_URL || !Array.isArray(child.children)) return false;
	const linkText = child.children.map(collectLexicalText).join('');
	return linkText === 'omnighost' && (
		child.title === PROVENANCE_LINK_TITLE || child.title === null || child.title === undefined
	);
}

function collectLexicalText(node: unknown): string {
	if (!isRecord(node)) return '';
	let text = typeof node.text === 'string' ? node.text : '';
	if (Array.isArray(node.children)) {
		text += node.children.map(collectLexicalText).join('');
	}
	return text;
}

function createVisibleProvenanceCard(
	visibility: Exclude<PublicationProvenanceVisibility, 'hidden'>,
	provenance: PublicationProvenance,
	presentation: PublicationProvenancePresentation
): UnknownRecord {
	return {
		type: 'html',
		version: 1,
		html: createVisibleProvenanceHtml(
			visibility,
			visibility === 'visible-hash' ? provenance.publicationSha256 : undefined,
			visibility === 'visible-hash' && provenance.gitCommit
				? provenance.gitCommit.slice(0, 12)
				: undefined,
			presentation
		)
	};
}

function createVisibleProvenanceHtml(
	visibility: Exclude<PublicationProvenanceVisibility, 'hidden'>,
	publicationSha256: string | undefined,
	gitCommitDisplay: string | undefined,
	presentation: PublicationProvenancePresentation
): string {
	const delimiter = presentation.delimiter === 'none'
		? ''
		: `<hr data-omnighost-delimiter="${presentation.delimiter}" style="border:0;border-top:${presentation.delimiter === 'double' ? '3px double' : '1px solid'} currentColor;margin:0 0 0.5em;">`;
	const size = publicationProvenanceFontSizeCss(presentation.fontSize);
	const paragraphStyle = `margin:0;font-size:${size};line-height:1.4;overflow-wrap:anywhere;font-style:${presentation.italic ? 'italic' : 'normal'};`;
	let text = `published with <a href="${OMNIGHOST_REPOSITORY_URL}" rel="noopener">omnighost</a>`;
	if (visibility === 'visible-hash') {
		if (!publicationSha256 || !SHA256_PATTERN.test(publicationSha256)) {
			throw new Error('Visible publication provenance requires a valid SHA-256 digest');
		}
		if (gitCommitDisplay) text += ` · Git ${gitCommitDisplay}`;
		text += ` · SHA-256 ${publicationSha256}`;
	}
	return `<div data-omnighost-provenance="v1" data-omnighost-mode="${visibility}" data-omnighost-delimiter="${presentation.delimiter}" data-omnighost-size="${presentation.fontSize}" data-omnighost-italic="${presentation.italic}">${delimiter}<p style="${paragraphStyle}">${text}</p></div>`;
}

/** Normalize untrusted presentation values to stable publishing defaults. */
export function normalizePublicationProvenancePresentation(
	presentation: Partial<PublicationProvenancePresentation> | null | undefined
): PublicationProvenancePresentation {
	const delimiter = presentation?.delimiter;
	const fontSize = presentation?.fontSize;
	return {
		delimiter: delimiter === 'none' || delimiter === 'single' || delimiter === 'double'
			? delimiter
			: DEFAULT_PUBLICATION_PROVENANCE_PRESENTATION.delimiter,
		fontSize: fontSize === 'normal' || fontSize === 'small' || fontSize === 'tiny'
			? fontSize
			: DEFAULT_PUBLICATION_PROVENANCE_PRESENTATION.fontSize,
		italic: presentation?.italic === true
	};
}

/** Resolve a note override once so preparation and comparison use one mode. */
export function resolvePublicationProvenanceVisibility(
	override: PublicationProvenanceVisibilityOverride,
	globalVisibility: PublicationProvenanceVisibility,
	isDraft: boolean
): PublicationProvenanceVisibility {
	if (isDraft) return 'hidden';
	return override === 'default' ? globalVisibility : override;
}

/** Resolve the blog imprint defaults or the complete enabled per-note override. */
export function resolvePublicationProvenanceImprint(
	overrideEnabled: boolean,
	visibilityOverride: PublicationProvenanceVisibilityOverride,
	globalVisibility: PublicationProvenanceVisibility,
	presentationOverride: Partial<PublicationProvenancePresentation> | null | undefined,
	isDraft: boolean
): ResolvedPublicationProvenanceImprint {
	return {
		visibility: resolvePublicationProvenanceVisibility(
			overrideEnabled ? visibilityOverride : 'default',
			globalVisibility,
			isDraft
		),
		presentation: overrideEnabled
			? normalizePublicationProvenancePresentation(presentationOverride)
			: { ...DEFAULT_PUBLICATION_PROVENANCE_PRESENTATION }
	};
}

function publicationProvenanceFontSizeCss(size: PublicationProvenanceFontSize): string {
	if (size === 'normal') return '1em';
	if (size === 'small') return '0.8em';
	return '0.625em';
}

function lexicalDocumentsEqual(left: string, right: string): boolean {
	try {
		return stableJsonStringify(JSON.parse(left) as unknown) === stableJsonStringify(JSON.parse(right) as unknown);
	} catch {
		return false;
	}
}

function normalizeScheduledTimestamp(value: string | null | undefined): string | null {
	if (!value) return null;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		throw new Error('Scheduled publication timestamp is invalid');
	}
	return new Date(timestamp).toISOString();
}

function normalizeGitCommit(value: string | null | undefined): string | undefined {
	const commit = normalizeOptionalString(value)?.toLowerCase();
	return commit && GIT_COMMIT_PATTERN.test(commit) ? commit : undefined;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function metaTag(name: string, value: string): string {
	return `<meta name="${name}" content="${escapeHtmlAttribute(value)}">`;
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function decodeRenderedHtmlText(value: string): string {
	return decodeHtmlAttribute(value)
		.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
		.replace(/&middot;|&#183;|&#xB7;/gi, '·')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseOwnedMetaTags(block: string): Map<string, string> {
	const values = new Map<string, string>();
	const pattern = /<meta\s+name="([^"]+)"\s+content="([^"]*)"\s*>/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(block)) !== null) {
		values.set(match[1], decodeHtmlAttribute(match[2]));
	}
	return values;
}

function findOwnedBlockRanges(source: string): OwnedBlockRange[] {
	const ranges: OwnedBlockRange[] = [];
	let cursor = 0;
	while (cursor < source.length) {
		const start = source.indexOf(HIDDEN_BLOCK_START, cursor);
		if (start === -1) break;
		const contentStart = start + HIDDEN_BLOCK_START.length;
		const endMarker = source.indexOf(HIDDEN_BLOCK_END, contentStart);
		if (endMarker === -1) break;

		const nestedStart = source.indexOf(HIDDEN_BLOCK_START, contentStart);
		if (nestedStart !== -1 && nestedStart < endMarker) {
			cursor = nestedStart;
			continue;
		}

		const end = endMarker + HIDDEN_BLOCK_END.length;
		ranges.push({ start, end });
		cursor = end;
	}
	return ranges;
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
