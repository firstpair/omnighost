/**
 * Decisions behind the bulk-delete checklist, kept free of Obsidian so they can
 * be tested: the order rows are shown in, which notes may be removed along with
 * their posts, and which selected posts another note still depends on.
 */

/** One note↔post link. A note published to three blogs is three links. */
export interface PostLink {
	path: string;
	blogId: string;
	ghostId: string;
}

export function postKey(link: { blogId: string; ghostId: string }): string {
	return `${link.blogId}:${link.ghostId}`;
}

/** Latest first, so a post made a moment ago is at the top of a long list. */
export function newestFirst<T extends { when: number; title: string }>(items: T[]): T[] {
	return [...items].sort((a, b) => b.when - a.when || a.title.localeCompare(b.title));
}

/**
 * Notes that may be removed once `deleted` posts are gone: those with no linked
 * post left. A note that is still published elsewhere stays, because removing
 * it would leave those posts with nothing in the vault to update them from.
 */
export function removableNotes(allLinks: PostLink[], deleted: PostLink[]): Set<string> {
	const gone = new Set(deleted.map(link => `${link.path}|${postKey(link)}`));
	const touched = new Set(deleted.map(link => link.path));
	const removable = new Set(touched);
	for (const link of allLinks) {
		if (touched.has(link.path) && !gone.has(`${link.path}|${postKey(link)}`)) {
			removable.delete(link.path);
		}
	}
	return removable;
}

/**
 * Selected posts that a note outside the selection also links to, by post key,
 * with the paths of those other notes. Deleting such a post breaks them.
 */
export function sharedWithOtherNotes(allLinks: PostLink[], selected: PostLink[]): Map<string, string[]> {
	const selectedPaths = new Set(selected.map(link => link.path));
	const selectedKeys = new Set(selected.map(postKey));
	const shared = new Map<string, string[]>();
	for (const link of allLinks) {
		if (selectedPaths.has(link.path) || !selectedKeys.has(postKey(link))) continue;
		const paths = shared.get(postKey(link)) ?? [];
		if (!paths.includes(link.path)) paths.push(link.path);
		shared.set(postKey(link), paths);
	}
	return shared;
}

/** What Ghost says about one post. */
export interface PostTime {
	id: string;
	status: string;
	published_at: string | null;
	updated_at: string | null;
}

/**
 * Date rows from Ghost rather than from the note. A note's own date is a poor
 * guide: its `published_at` property is often empty, and its file may be far
 * older than the post it links to. A published post is dated by when it was
 * published, a draft by when it was last changed. Rows on a blog that could not
 * be asked, or whose post Ghost no longer has, keep the note's date and are
 * marked, so an approximate date is never mistaken for a real one.
 */
export function withGhostTimes<T extends { blogId: string; ghostId: string; when: number; published: boolean }>(
	items: T[],
	timesByBlog: Map<string, PostTime[]>
): (T & { whenFromGhost: boolean })[] {
	const byKey = new Map<string, PostTime>();
	for (const [blogId, times] of timesByBlog) {
		for (const time of times) byKey.set(`${blogId}:${time.id}`, time);
	}
	return items.map((item) => {
		const time = byKey.get(postKey(item));
		const stamp = time ? Date.parse((time.status === 'published' ? time.published_at : null) ?? time.updated_at ?? '') : NaN;
		if (!time || Number.isNaN(stamp)) return { ...item, whenFromGhost: false };
		return { ...item, when: stamp, published: time.status === 'published', whenFromGhost: true };
	});
}
