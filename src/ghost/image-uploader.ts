import { App, TFile } from 'obsidian';
import { GhostAPIClient } from './api-client';

/**
 * Uploads local images referenced in a note to Ghost and rewrites the
 * references to the uploaded URLs. Optionally promotes the first image to the
 * post cover and removes it from the body (the "cover swallow" behaviour, as
 * Ulysses / Ghosty Posty do).
 */

const MIME_BY_EXT: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	avif: 'image/avif',
	heic: 'image/heic',
};

function mimeFor(name: string): string {
	const ext = name.split('.').pop()?.toLowerCase() || '';
	return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isRemote(src: string): boolean {
	return /^(https?:|data:)/i.test(src);
}

/** SHA-256 hex digest of bytes, via Web Crypto (available in the iOS/Android WebView). */
async function sha256Hex(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, '0');
	}
	return hex;
}

interface ImageRef {
	/** the exact substring to remove/replace, e.g. `![alt](assets/x.png)` or `![[x.png]]` */
	match: string;
	/** decoded link target, e.g. `assets/x.png` or `x.png` */
	target: string;
	/** alt / caption text */
	alt: string;
	/** position in the source markdown (document order) */
	index: number;
}

/** Markdown images `![alt](src "title")` and Obsidian embeds `![[target|alt]]`, in document order. */
function findImageRefs(markdown: string): ImageRef[] {
	const refs: ImageRef[] = [];

	const mdRe = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
	let m: RegExpExecArray | null;
	while ((m = mdRe.exec(markdown)) !== null) {
		refs.push({ match: m[0], target: decodeURIComponent(m[2]), alt: m[1] || '', index: m.index });
	}

	const wikiRe = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
	while ((m = wikiRe.exec(markdown)) !== null) {
		refs.push({ match: m[0], target: m[1].trim(), alt: (m[2] || '').trim(), index: m.index });
	}

	refs.sort((a, b) => a.index - b.index);
	return refs;
}

/** Resolve a link target to a vault file, trying Obsidian link resolution then a note-relative path. */
function resolveFile(app: App, target: string, sourcePath: string): TFile | null {
	const dest = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
	if (dest) return dest;

	const parent = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
	const rel = (parent ? `${parent}/${target}` : target).replace(/^\.\//, '');
	const f = app.vault.getFileByPath(rel);
	return f instanceof TFile ? f : null;
}

export interface ProcessedImages {
	/** markdown with local image references rewritten to Ghost URLs (and the cover removed if swallowed) */
	markdown: string;
	/** URL to use as the post's feature image, when the cover was swallowed */
	coverImageUrl: string | null;
	/** true when at least one new image was uploaded (so the cache should be persisted) */
	cacheUpdated: boolean;
}

/**
 * Upload every local image in `markdown` to Ghost and rewrite references to the
 * uploaded URLs. When `swallowCover` is true, the first image becomes the cover
 * and is removed from the body.
 */
export async function processPostImages(
	app: App,
	ghostClient: GhostAPIClient,
	markdown: string,
	file: TFile,
	swallowCover: boolean,
	cache: Record<string, string>,
	expectedAssetSha256?: ReadonlyMap<string, string>
): Promise<ProcessedImages> {
	const refs = findImageRefs(markdown);
	if (refs.length === 0) {
		return { markdown, coverImageUrl: null, cacheUpdated: false };
	}

	// Upload each unique local target once; remote URLs are left untouched.
	// Images are keyed by a content hash, so an image whose bytes were already
	// uploaded reuses the cached Ghost URL instead of uploading again.
	const urlByTarget = new Map<string, string>();
	let cacheUpdated = false;
	for (const ref of refs) {
		if (isRemote(ref.target) || urlByTarget.has(ref.target)) continue;
		const tfile = resolveFile(app, ref.target, file.path);
		if (!tfile) {
			if (expectedAssetSha256) {
				throw new Error(`Imported textpack asset is unavailable: ${ref.target}`);
			}
			console.warn(`[Ghost Images] Could not resolve image in vault: ${ref.target}`);
			continue;
		}
		const data = await app.vault.readBinary(tfile);
		const hash = await sha256Hex(data);
		if (expectedAssetSha256) {
			const expected = expectedAssetSha256.get(tfile.path);
			if (!expected || hash !== expected) {
				throw new Error(`Imported textpack asset changed while preparing publication: ${tfile.path}`);
			}
		}
		let url = cache[hash];
		if (url) {
			console.debug(`[Ghost Images] Reusing cached upload for ${ref.target} -> ${url}`);
		} else {
			url = await ghostClient.uploadImage(data, tfile.name, mimeFor(tfile.name));
			cache[hash] = url;
			cacheUpdated = true;
			console.debug(`[Ghost Images] Uploaded ${ref.target} -> ${url}`);
		}
		urlByTarget.set(ref.target, url);
	}

	let out = markdown;
	let coverImageUrl: string | null = null;

	// Cover swallow: the first usable image becomes the cover and is removed from the body.
	if (swallowCover) {
		const first = refs.find((r) => isRemote(r.target) || urlByTarget.has(r.target));
		if (first) {
			coverImageUrl = isRemote(first.target) ? first.target : urlByTarget.get(first.target) ?? null;
			const at = out.indexOf(first.match);
			if (at !== -1) {
				let end = at + first.match.length;
				// also swallow up to one trailing blank line so no gap is left behind
				if (out[end] === '\n') end++;
				if (out[end] === '\n') end++;
				out = out.slice(0, at) + out.slice(end);
			}
		}
	}

	// Rewrite remaining references to the uploaded Ghost URLs.
	out = out.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (full: string, alt: string, src: string) => {
		const target = decodeURIComponent(src);
		const url = isRemote(target) ? null : urlByTarget.get(target);
		return url ? `![${alt}](${url})` : full;
	});
	// Convert Obsidian embeds to standard markdown images (the Lexical converter only understands `![](...)`).
	out = out.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (full: string, target: string, alt: string) => {
		const url = urlByTarget.get(target.trim());
		return url ? `![${(alt || '').trim()}](${url})` : full;
	});

	return { markdown: out, coverImageUrl, cacheUpdated };
}
