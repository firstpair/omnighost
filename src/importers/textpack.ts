/**
 * TextPack (zipped TextBundle) parsing for "Import textpack".
 *
 * A .textpack is a zip whose top-level entry is <name>.textbundle/ containing
 * text.markdown (or text.md), info.json, and assets/<images>. The zip is read
 * with a minimal inline parser (store + deflate entries only) so no bundled
 * zip library is needed; deflate entries are inflated with the platform's
 * DecompressionStream, available on desktop and on iOS 16.4+.
 */

import {
	TEXTPACK_PROVENANCE_SCHEMA,
	createTextpackSourceVersion,
	normalizeFullGitCommit,
	normalizeSha256
} from '../versioning/textpack-source';
import type { TextpackSourceVersion } from '../versioning/textpack-source';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_COUNT = 512;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

/** Ghost publishing metadata a bundler may embed under info.json's "omnighost" key. */
export interface TextpackGhostMeta {
	blog?: string;
	slug?: string;
	title?: string;
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
	/** Validated source commit and payload digest supplied by the producer. */
	sourceVersion?: TextpackSourceVersion;
	/** Invalid provenance never blocks content import, but is surfaced to the user. */
	provenanceWarning?: string;
}

interface DeclaredTextpackProvenance {
	schema?: unknown;
	payloadSha256?: unknown;
	gitCommit?: unknown;
}

interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
}

async function inflateRaw(data: Uint8Array, expectedSize: number): Promise<Uint8Array> {
	const ds = new DecompressionStream('deflate-raw');
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const part = await reader.read();
		if (part.done) break;
		total += part.value.byteLength;
		if (total > MAX_ENTRY_BYTES || total > expectedSize) {
			await reader.cancel();
			throw new Error('Textpack zip entry expands beyond its declared or permitted size');
		}
		chunks.push(part.value);
	}
	if (total !== expectedSize) throw new Error('Textpack zip entry size does not match its directory record');
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

/** Read all file entries of a zip archive. Supports methods 0 (store) and 8 (deflate). */
export async function readZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
	if (buf.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Textpack archive is too large');
	if (buf.byteLength < 22) throw new Error('Not a zip file (archive is too short)');
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
	if (entryCount > MAX_ENTRY_COUNT) throw new Error('Textpack contains too many files');
	if (cdOffset >= eocd) throw new Error('Corrupt zip central-directory offset');

	const entries: ZipEntry[] = [];
	const entryNames = new Set<string>();
	let declaredTotal = 0;
	let p = cdOffset;
	for (let i = 0; i < entryCount; i++) {
		if (p + 46 > eocd) throw new Error('Corrupt zip central directory');
		if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip central directory');
		const method = view.getUint16(p + 10, true);
		const compressedSize = view.getUint32(p + 20, true);
		const uncompressedSize = view.getUint32(p + 24, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const localHeaderOffset = view.getUint32(p + 42, true);
		const next = p + 46 + nameLen + extraLen + commentLen;
		if (next > eocd) throw new Error('Corrupt zip central-directory entry');
		const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
		if (entryNames.has(name)) throw new Error(`Textpack contains a duplicate zip path: ${name}`);
		entryNames.add(name);
		if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`Textpack entry is too large: ${name}`);
		declaredTotal += uncompressedSize;
		if (declaredTotal > MAX_TOTAL_UNCOMPRESSED_BYTES) {
			throw new Error('Textpack expands beyond the permitted total size');
		}
		entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
		p = next;
	}

	const files = new Map<string, Uint8Array>();
	for (const e of entries) {
		if (e.name.endsWith('/')) continue; // directory entry
		const lh = e.localHeaderOffset;
		if (lh + 30 > buf.byteLength) throw new Error('Corrupt zip local-header offset');
		if (view.getUint32(lh, true) !== 0x04034b50) throw new Error('Corrupt zip local header');
		if (view.getUint16(lh + 8, true) !== e.method) throw new Error('Zip method differs between directory records');
		const nameLen = view.getUint16(lh + 26, true);
		const extraLen = view.getUint16(lh + 28, true);
		const dataStart = lh + 30 + nameLen + extraLen;
		if (dataStart + e.compressedSize > buf.byteLength) throw new Error('Corrupt zip entry data range');
		const localName = new TextDecoder().decode(bytes.subarray(lh + 30, lh + 30 + nameLen));
		if (localName !== e.name) throw new Error('Zip path differs between directory records');
		const raw = bytes.subarray(dataStart, dataStart + e.compressedSize);
		if (e.method === 0) {
			if (raw.byteLength !== e.uncompressedSize) throw new Error(`Stored zip entry has the wrong size: ${e.name}`);
			files.set(e.name, raw.slice());
		} else if (e.method === 8) {
			files.set(e.name, await inflateRaw(raw, e.uncompressedSize));
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
	let declaredProvenance: DeclaredTextpackProvenance | undefined;
	let bundleRoot: string | undefined;
	let sawRootlessContent = false;
	let sawInfo = false;
	const assets = new Map<string, Uint8Array>();

	for (const [path, data] of files) {
		const parts = path.split('/').filter(Boolean);
		if (parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') continue;
		if (parts[0]?.endsWith('.textbundle')) {
			if (sawRootlessContent) throw new Error('Textpack mixes rooted and rootless content');
			if (bundleRoot && bundleRoot !== parts[0]) throw new Error('Textpack contains multiple bundle roots');
			bundleRoot = parts[0];
			name = parts[0].replace(/\.textbundle$/i, '');
			parts.shift();
		} else if (bundleRoot) {
			throw new Error('Textpack mixes rooted and rootless content');
		} else {
			sawRootlessContent = true;
		}
		const rel = parts.join('/');
		const base = parts[parts.length - 1];
		if (/^text\.(markdown|md|txt)$/i.test(rel)) {
			if (markdown !== null) throw new Error('Textpack contains more than one Markdown document');
			markdown = new TextDecoder().decode(data);
		} else if (rel === 'info.json') {
			if (sawInfo) throw new Error('Textpack contains more than one info.json');
			sawInfo = true;
			try {
				const info = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
				const og = info['omnighost'];
				if (og && typeof og === 'object' && !Array.isArray(og)) {
					const o = og as Record<string, unknown>;
					ghost = {
						blog: typeof o.blog === 'string' ? o.blog : undefined,
						slug: typeof o.slug === 'string' ? o.slug : undefined,
						title: typeof o.title === 'string' ? o.title : undefined,
						tags: Array.isArray(o.tags) ? o.tags.map(t => String(t)) : undefined,
						excerpt: typeof o.excerpt === 'string' ? o.excerpt : undefined,
					};
					const provenance = o.provenance;
					if (provenance && typeof provenance === 'object' && !Array.isArray(provenance)) {
						const p = provenance as Record<string, unknown>;
						declaredProvenance = {
							schema: p.schema,
							payloadSha256: p.payloadSha256,
							gitCommit: p.gitCommit
						};
					}
				}
			} catch { /* metadata is optional; a bad info.json should not block import */ }
		} else if (parts[0] === 'assets' && parts.length === 2 && base) {
			if (assets.has(base)) throw new Error(`Textpack contains duplicate asset name: ${base}`);
			assets.set(base, data);
		} else if (parts[0] === 'assets') {
			throw new Error(`Textpack asset path is not canonical: ${rel}`);
		}
	}

	if (markdown === null) {
		throw new Error('No text.markdown found — is this a TextPack/TextBundle?');
	}

	let sourceVersion: TextpackSourceVersion | undefined;
	let provenanceWarning: string | undefined;
	if (declaredProvenance) {
		const declaredPayload = normalizeSha256(declaredProvenance.payloadSha256);
		const hasDeclaredCommit = declaredProvenance.gitCommit !== undefined
			&& declaredProvenance.gitCommit !== null;
		const declaredCommit = normalizeFullGitCommit(declaredProvenance.gitCommit);
		if (
			declaredProvenance.schema !== TEXTPACK_PROVENANCE_SCHEMA
			|| !declaredPayload
			|| (hasDeclaredCommit && !declaredCommit)
		) {
			provenanceWarning = 'Textpack source provenance is malformed and was ignored.';
		} else {
			const computed = await createTextpackSourceVersion(markdown, assets, ghost, declaredCommit);
			if (computed.payloadSha256 === declaredPayload) {
				sourceVersion = computed;
			} else {
				provenanceWarning = 'Textpack contents do not match their source provenance; the inherited version was ignored.';
			}
		}
	}

	return {
		name,
		markdown,
		assets,
		ghost,
		...(sourceVersion ? { sourceVersion } : {}),
		...(provenanceWarning ? { provenanceWarning } : {})
	};
}
