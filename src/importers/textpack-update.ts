/**
 * Updating a note that a textpack created, from a newer textpack.
 *
 * A textpack carries what the author wrote: body, title, tags, excerpt, images
 * and the source version. It knows nothing about where a note has since
 * been published. The note does: its blog list, per-blog Ghost ids and URLs,
 * publish and schedule switches, access, cover and provenance display settings,
 * and whatever properties the writer added by hand. An update therefore keeps
 * every frontmatter key the pack does not own and replaces the ones it does, so
 * the next sync updates the same posts on the same blogs.
 *
 * Text-level on purpose: values are carried as the YAML the note already holds,
 * never reparsed and reserialized, so nothing is reformatted in passing.
 */
import { joinFrontmatter, splitFrontmatter } from '../frontmatter-parser';

const SOURCE_KEY_PREFIX = 'source_';

export interface FrontmatterBlock {
	key: string;
	/** The `key: value` line and any indented continuation lines, verbatim. */
	text: string;
}

/** Split a frontmatter block into top-level keys, each with its continuation lines. */
export function frontmatterBlocks(raw: string): FrontmatterBlock[] {
	const blocks: FrontmatterBlock[] = [];
	for (const line of raw.split('\n')) {
		const top = /^([^\s#:][^:]*):/.exec(line);
		if (top) {
			blocks.push({ key: top[1].trim(), text: line });
		} else if (blocks.length > 0) {
			blocks[blocks.length - 1].text += `\n${line}`;
		}
		// Anything before the first key (a comment, a blank line) is dropped.
	}
	for (const block of blocks) block.text = block.text.replace(/\n+$/, '');
	return blocks;
}

/** Frontmatter key recording the slug a note's pack was built with. */
export function sourceSlugKey(prefix: string): string {
	return `${prefix}${SOURCE_KEY_PREFIX}slug`;
}

/**
 * Frontmatter keys an updated pack replaces. Tags and excerpt are optional in a
 * pack; when it carries none, the note's own stay.
 *
 * The slug is not among them. It is the address of a post that may already be
 * public, and a writer may have chosen a different one than the pack proposed;
 * replacing it would move the live URL. A note keeps its slug, and the pack's
 * own is recorded under `source_slug` so a later pack still finds the note.
 */
export function packOwnedKeys(
	prefix: string,
	pack: { hasTags: boolean; hasExcerpt: boolean }
): (key: string) => boolean {
	const owned = new Set<string>(['title']);
	if (pack.hasTags) owned.add(`${prefix}tags`);
	if (pack.hasExcerpt) owned.add(`${prefix}excerpt`);
	return (key: string) => owned.has(key) || key.startsWith(`${prefix}${SOURCE_KEY_PREFIX}`);
}

/**
 * Merge a freshly rendered import (`fresh`) into the note it updates
 * (`existing`). The result has the fresh body; the fresh value of every
 * pack-owned key; and, for every other key, the existing note's value when it
 * has one, else the fresh default. Existing keys keep their order, and keys
 * only the fresh import has are appended.
 *
 * Every `source_*` key of the existing note is dropped first, so a pack without
 * a Git commit cannot inherit the previous pack's.
 */
export function mergeTextpackUpdate(
	existing: string,
	fresh: string,
	isPackOwned: (key: string) => boolean
): string {
	const freshParts = splitFrontmatter(fresh);
	if (!freshParts) throw new Error('A rendered textpack import always has frontmatter');
	const existingParts = splitFrontmatter(existing);
	if (!existingParts) return fresh;

	const freshBlocks = frontmatterBlocks(freshParts.raw);
	const freshByKey = new Map(freshBlocks.map(block => [block.key, block]));
	const merged: FrontmatterBlock[] = [];
	const seen = new Set<string>();

	for (const block of frontmatterBlocks(existingParts.raw)) {
		if (seen.has(block.key)) continue;
		seen.add(block.key);
		if (isPackOwned(block.key)) {
			const replacement = freshByKey.get(block.key);
			if (replacement) merged.push(replacement);
			continue;
		}
		merged.push(block);
	}
	for (const block of freshBlocks) {
		if (!seen.has(block.key)) {
			seen.add(block.key);
			merged.push(block);
		}
	}

	return joinFrontmatter(merged.map(block => block.text).join('\n'), freshParts.body);
}

/**
 * The asset folder an update writes into: the one the note's images already
 * live in, so their references and the image-upload cache stay put. Falls back
 * to the slug for a note that had no images.
 */
export function updateAssetFolderName(existingAssetPaths: string[], slug: string): string {
	for (const path of existingAssetPaths) {
		const match = /^assets\/([^/]+)\/[^/]+$/.exec(path);
		if (match) return match[1];
	}
	return slug;
}

/** Previously imported asset paths the new pack no longer contains. */
export function staleAssetPaths(existingAssetPaths: string[], currentAssetPaths: string[]): string[] {
	const current = new Set(currentAssetPaths);
	return existingAssetPaths.filter(path => !current.has(path));
}

/** How well a note matches a pack, best first; `none` notes are offered last, for a manual choice. */
export type TextpackMatch = 'source-slug' | 'slug' | 'none';

/**
 * Match a note to a pack by the slug its last pack was built with, else by its
 * publishing slug. A note whose writer changed the publishing slug still
 * matches through the first once it has been imported or updated by a version
 * that records it.
 */
export function matchTextpackNote(
	frontmatter: Record<string, unknown>,
	prefix: string,
	packSlug: string
): TextpackMatch {
	if (frontmatter[sourceSlugKey(prefix)] === packSlug) return 'source-slug';
	if (frontmatter[`${prefix}slug`] === packSlug) return 'slug';
	return 'none';
}
