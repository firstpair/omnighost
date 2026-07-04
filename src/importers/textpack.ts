/**
 * TextPack (zipped TextBundle) parsing for "Import textpack".
 *
 * A .textpack is a zip whose top-level entry is <name>.textbundle/ containing
 * text.markdown (or text.md), info.json, and assets/<images>. The zip is read
 * with a minimal inline parser (store + deflate entries only) so no bundled
 * zip library is needed; deflate entries are inflated with the platform's
 * DecompressionStream, available on desktop and on iOS 16.4+.
 */

/** Ghost publishing metadata a bundler may embed under info.json's "omnighost" key. */
export interface TextpackGhostMeta {
	blog?: string;
	slug?: string;
	tags?: string[];
	excerpt?: string;
}

export interface ParsedTextpack {
	/** bundle name: the top-level directory minus ".textbundle" */
	name: string;
	/** contents of text.markdown / text.md */
	markdown: string;
	/** asset basename → bytes */
	assets: Map<string, Uint8Array>;
	/** Ghost metadata from info.json's "omnighost" key, if present */
	ghost: TextpackGhostMeta;
}

interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	localHeaderOffset: number;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream('deflate-raw');
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read all file entries of a zip archive. Supports methods 0 (store) and 8 (deflate). */
export async function readZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
	const view = new DataView(buf);
	const bytes = new Uint8Array(buf);

	// Locate the End Of Central Directory record (sig 0x06054b50), scanning
	// backwards past an optional trailing comment (max 64 KiB).
	let eocd = -1;
	const scanFrom = Math.max(0, buf.byteLength - 22 - 65536);
	for (let i = buf.byteLength - 22; i >= scanFrom; i--) {
		if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');

	const entryCount = view.getUint16(eocd + 10, true);
	const cdOffset = view.getUint32(eocd + 16, true);

	const entries: ZipEntry[] = [];
	let p = cdOffset;
	for (let i = 0; i < entryCount; i++) {
		if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip central directory');
		const method = view.getUint16(p + 10, true);
		const compressedSize = view.getUint32(p + 20, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const localHeaderOffset = view.getUint32(p + 42, true);
		const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
		entries.push({ name, method, compressedSize, localHeaderOffset });
		p += 46 + nameLen + extraLen + commentLen;
	}

	const files = new Map<string, Uint8Array>();
	for (const e of entries) {
		if (e.name.endsWith('/')) continue; // directory entry
		const lh = e.localHeaderOffset;
		if (view.getUint32(lh, true) !== 0x04034b50) throw new Error('Corrupt zip local header');
		const nameLen = view.getUint16(lh + 26, true);
		const extraLen = view.getUint16(lh + 28, true);
		const dataStart = lh + 30 + nameLen + extraLen;
		const raw = bytes.subarray(dataStart, dataStart + e.compressedSize);
		if (e.method === 0) {
			files.set(e.name, raw.slice());
		} else if (e.method === 8) {
			files.set(e.name, await inflateRaw(raw));
		} else {
			throw new Error(`Unsupported zip compression method ${e.method} for ${e.name}`);
		}
	}
	return files;
}

/** Parse a .textpack (or zipped .textbundle) into its markdown, assets, and metadata. */
export async function parseTextpack(buf: ArrayBuffer, fallbackName: string): Promise<ParsedTextpack> {
	const files = await readZip(buf);

	let markdown: string | null = null;
	let name = fallbackName.replace(/\.(textpack|textbundle|zip)$/i, '');
	let ghost: TextpackGhostMeta = {};
	const assets = new Map<string, Uint8Array>();

	for (const [path, data] of files) {
		const parts = path.split('/').filter(Boolean);
		if (parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') continue;
		if (parts[0]?.endsWith('.textbundle')) {
			name = parts[0].replace(/\.textbundle$/i, '');
			parts.shift();
		}
		const rel = parts.join('/');
		const base = parts[parts.length - 1];
		if (/^text\.(markdown|md|txt)$/i.test(rel)) {
			markdown = new TextDecoder().decode(data);
		} else if (rel === 'info.json') {
			try {
				const info = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
				const og = info['omnighost'];
				if (og && typeof og === 'object' && !Array.isArray(og)) {
					const o = og as Record<string, unknown>;
					ghost = {
						blog: typeof o.blog === 'string' ? o.blog : undefined,
						slug: typeof o.slug === 'string' ? o.slug : undefined,
						tags: Array.isArray(o.tags) ? o.tags.map(t => String(t)) : undefined,
						excerpt: typeof o.excerpt === 'string' ? o.excerpt : undefined,
					};
				}
			} catch { /* metadata is optional; a bad info.json should not block import */ }
		} else if (parts[0] === 'assets' && base) {
			assets.set(base, data);
		}
	}

	if (markdown === null) {
		throw new Error('No text.markdown found — is this a TextPack/TextBundle?');
	}
	return { name, markdown, assets, ghost };
}
