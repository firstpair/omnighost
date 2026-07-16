/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
	createTextpackSourceVersion,
	hashImportedTextpackSnapshot,
	importedTextpackSnapshotField,
	importedTextpackSourceFields,
	sha256Bytes,
	validateInheritedTextpackSource
} from './textpack-source';
import type { ImportedTextpackAsset } from './textpack-source';
import { compareManagedPublicationState, preparePublicationProvenance } from './publication-provenance';

const PREFIX = 'g_';
const GIT_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const CONTENT = `---
title: Imported title
---
Imported body.
`;
const ASSET_PATH = 'assets/imported/picture.png';
const ASSET_BYTES = new TextEncoder().encode('image bytes');

async function importedState(): Promise<{
	frontmatter: Record<string, unknown>;
	assets: Map<string, Uint8Array>;
}> {
	const bundledAssets = new Map([['picture.png', ASSET_BYTES]]);
	const source = await createTextpackSourceVersion(
		'# Imported title\n\nImported body.\n',
		bundledAssets,
		{ blog: 'example.com', slug: 'imported', tags: ['Test'], excerpt: 'Summary' },
		GIT_COMMIT
	);
	const importedAssets: ImportedTextpackAsset[] = [{
		path: ASSET_PATH,
		sha256: await sha256Bytes(ASSET_BYTES)
	}];
	const serialized = importedTextpackSourceFields(PREFIX, source, importedAssets);
	const frontmatter: Record<string, unknown> = {
		title: 'Imported title',
		editorial_date: new Date('2026-07-20T00:00:00.000Z'),
		g_post_access: 'public',
		g_published: false,
		g_published_at: '',
		g_featured: false,
		g_tags: ['Test'],
		g_excerpt: 'Summary',
		g_feature_image: '',
		g_cover_from_first_image: false,
		g_no_sync: false,
		g_blog: 'example.com',
		g_slug: 'imported',
		...serialized,
		g_source_assets: JSON.parse(serialized.g_source_assets) as unknown
	};
	const snapshot = await hashImportedTextpackSnapshot(CONTENT, frontmatter, PREFIX);
	Object.assign(frontmatter, importedTextpackSnapshotField(PREFIX, snapshot));
	return { frontmatter, assets: new Map([[ASSET_PATH, ASSET_BYTES]]) };
}

async function validate(
	content: string,
	frontmatter: Record<string, unknown>,
	assets: Map<string, Uint8Array>
) {
	return validateInheritedTextpackSource(
		content,
		frontmatter,
		PREFIX,
		async (path) => assets.get(path) ?? null
	);
}

void test('inherits a textpack Git version across publishing and Ghost write-backs', async () => {
	const state = await importedState();
	const initial = await validate(CONTENT, state.frontmatter, state.assets);
	assert.equal(initial.kind, 'valid');
	if (initial.kind !== 'valid') return;
	assert.equal(initial.source.gitCommit, GIT_COMMIT);

	const afterPublishing: Record<string, unknown> = {
		...state.frontmatter,
		g_published: true,
		g_published_at: '2026-07-20T16:00:00.000Z',
		g_no_sync: true,
		g_blog: ['example.com', 'second.example'],
		g_id: 'legacy-id',
		g_url: 'https://example.com/ghost/#/editor/post/legacy-id',
		g_public_url: 'https://example.com/imported/',
		g_id_example_com: 'domain-id',
		g_url_example_com: 'https://example.com/ghost/#/editor/post/domain-id',
		g_public_url_example_com: 'https://example.com/imported/'
	};
	const inherited = await validate(CONTENT, afterPublishing, state.assets);
	assert.equal(inherited.kind, 'valid');
	if (inherited.kind === 'valid') assert.equal(inherited.source.gitCommit, GIT_COMMIT);

	const missingDefault = { ...state.frontmatter };
	delete missingDefault.g_cover_from_first_image;
	assert.equal((await validate(CONTENT, missingDefault, state.assets)).kind, 'valid');

	const equivalentModalFormatting = {
		...state.frontmatter,
		g_post_access: ' Public ',
		g_featured: 'false',
		g_cover_from_first_image: 'false',
		g_tags: [' Test ', ''],
		g_excerpt: ' Summary ',
		g_feature_image: ' '
	};
	assert.equal((await validate(CONTENT, equivalentModalFormatting, state.assets)).kind, 'valid');
});

void test('an untouched inherited textpack publication is unchanged on the next sync', async () => {
	const state = await importedState();
	const inherited = await validate(CONTENT, state.frontmatter, state.assets);
	assert.equal(inherited.kind, 'valid');
	if (inherited.kind !== 'valid') return;

	const publication = {
		title: 'Imported title',
		lexical: JSON.stringify({
			root: {
				type: 'root',
				version: 1,
				format: '',
				indent: 0,
				direction: null,
				children: []
			}
		}),
		status: 'published',
		visibility: 'public',
		featured: false,
		slug: 'imported',
		custom_excerpt: 'Summary',
		feature_image: null,
		tags: ['Test']
	};
	const firstPublish = await preparePublicationProvenance(
		publication,
		'visible-hash',
		{ gitCommit: inherited.source.gitCommit }
	);
	const secondSync = await compareManagedPublicationState({
		desired: publication,
		current: { ...publication, lexical: firstPublish.lexical },
		currentCodeInjectionHead: firstPublish.hiddenBlock,
		visibility: 'visible-hash',
		gitCommit: inherited.source.gitCommit
	});
	assert.equal(secondSync.unchanged, true);
});

void test('invalidates inherited provenance after authorial metadata, body, or asset edits', async () => {
	const state = await importedState();
	const changedFields: Array<[string, unknown]> = [
		['title', 'Changed title'],
		['editorial_date', new Date('2026-07-21T00:00:00.000Z')],
		['g_post_access', 'members'],
		['g_featured', true],
		['g_cover_from_first_image', true],
		['g_tags', ['Changed']],
		['g_excerpt', 'Changed summary'],
		['g_feature_image', 'https://example.com/changed.png'],
		['g_slug', 'changed-slug']
	];
	for (const [key, value] of changedFields) {
		const result = await validate(CONTENT, { ...state.frontmatter, [key]: value }, state.assets);
		assert.equal(result.kind, 'invalid', key);
	}

	const changedBody = await validate(CONTENT.replace('Imported body.', 'Changed body.'), state.frontmatter, state.assets);
	assert.equal(changedBody.kind, 'invalid');

	const changedAssets = new Map(state.assets);
	changedAssets.set(ASSET_PATH, new TextEncoder().encode('changed image bytes'));
	const changedAsset = await validate(CONTENT, state.frontmatter, changedAssets);
	assert.equal(changedAsset.kind, 'invalid');
	if (changedAsset.kind === 'invalid') assert.match(changedAsset.reason, /asset changed/);
});

void test('rejects malformed or tampered inherited source metadata', async () => {
	const state = await importedState();
	const malformed = await validate(CONTENT, {
		...state.frontmatter,
		g_source_git_commit: 'not-a-commit'
	}, state.assets);
	assert.equal(malformed.kind, 'invalid');

	const tampered = await validate(CONTENT, {
		...state.frontmatter,
		g_source_payload_sha256: 'f'.repeat(64)
	}, state.assets);
	assert.equal(tampered.kind, 'invalid');
});

void test('textpack payload hashes are deterministic and cover source inputs', async () => {
	const assets = new Map<string, Uint8Array>([
		['z.png', new TextEncoder().encode('z')],
		['a.png', new TextEncoder().encode('a')]
	]);
	const metadata = { blog: 'example.com', slug: 'post', tags: ['one', 'two'] };
	const first = await createTextpackSourceVersion('body\n', assets, metadata, GIT_COMMIT);
	const reordered = await createTextpackSourceVersion(
		'body\n',
		new Map(Array.from(assets.entries()).reverse()),
		metadata,
		GIT_COMMIT
	);
	assert.equal(first.payloadSha256, reordered.payloadSha256);
	assert.notEqual(
		first.payloadSha256,
		(await createTextpackSourceVersion('changed\n', assets, metadata, GIT_COMMIT)).payloadSha256
	);
	assert.notEqual(
		first.payloadSha256,
		(await createTextpackSourceVersion('body\n', assets, { ...metadata, slug: 'changed' }, GIT_COMMIT)).payloadSha256
	);
});
