/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
	frontmatterBlocks,
	mergeTextpackUpdate,
	packOwnedKeys,
	staleAssetPaths,
	updateAssetFolderName
} from './textpack-update';

const EXISTING = `---
title: "Old title"
g_published: true
g_published_at: 2026-09-13T10:00:00.000Z
g_blog:
  - querygraph.ai
  - adversari.al
g_id_querygraph_ai: 66aa
g_id_adversari_al: 77bb
g_url_querygraph_ai: https://querygraph.ai/ghost/#/editor/post/66aa
g_slug: graph-stores-under-strain
g_tags: ["graphs", "old"]
g_excerpt: "Old excerpt"
g_post_access: members
g_cover_from_first_image: true
g_source_kind: textpack
g_source_git_commit: 1111111111111111111111111111111111111111
g_source_payload_sha256: aaaa
g_source_snapshot_sha256: bbbb
aliases:
  - strain
---
Old body.
`;

const FRESH = `---
title: "New title"
g_published: false
g_post_access: public
g_cover_from_first_image: false
g_featured: false
g_blog: ["querygraph.ai"]
g_slug: graph-stores-under-strain
g_tags: ["graphs", "benchmarks"]
g_excerpt: "New excerpt"
g_source_kind: textpack
g_source_payload_sha256: cccc
---
New body.

![cover](assets/graph-stores-under-strain/cover.png)
`;

const owned = packOwnedKeys('g_', { hasTags: true, hasExcerpt: true });

void test('splits top-level keys with their continuation lines', () => {
	const blocks = frontmatterBlocks('a: 1\nlist:\n  - x\n  - y\nb: "two"');
	assert.deepEqual(blocks.map(block => block.key), ['a', 'list', 'b']);
	assert.equal(blocks[1].text, 'list:\n  - x\n  - y');
});

void test('an update replaces what the pack owns and keeps everything else', () => {
	const merged = mergeTextpackUpdate(EXISTING, FRESH, owned);
	const blocks = new Map(frontmatterBlocks(merged.split('\n---\n')[0].slice(4)).map(b => [b.key, b.text]));

	// Pack-owned: replaced.
	assert.equal(blocks.get('title'), 'title: "New title"');
	assert.equal(blocks.get('g_tags'), 'g_tags: ["graphs", "benchmarks"]');
	assert.equal(blocks.get('g_excerpt'), 'g_excerpt: "New excerpt"');
	assert.equal(blocks.get('g_source_payload_sha256'), 'g_source_payload_sha256: cccc');
	assert.ok(merged.endsWith('New body.\n\n![cover](assets/graph-stores-under-strain/cover.png)\n'));

	// Routing and presentation: the note's own, verbatim, so every blog updates in place.
	assert.equal(blocks.get('g_blog'), 'g_blog:\n  - querygraph.ai\n  - adversari.al');
	assert.equal(blocks.get('g_id_querygraph_ai'), 'g_id_querygraph_ai: 66aa');
	assert.equal(blocks.get('g_id_adversari_al'), 'g_id_adversari_al: 77bb');
	assert.equal(blocks.get('g_published'), 'g_published: true');
	assert.equal(blocks.get('g_post_access'), 'g_post_access: members');
	assert.equal(blocks.get('g_cover_from_first_image'), 'g_cover_from_first_image: true');
	assert.equal(blocks.get('aliases'), 'aliases:\n  - strain');

	// A default only the fresh import has is added.
	assert.equal(blocks.get('g_featured'), 'g_featured: false');
});

void test('no source field of the previous pack survives', () => {
	const merged = mergeTextpackUpdate(EXISTING, FRESH, owned);
	assert.ok(!merged.includes('g_source_git_commit'), 'a pack without a commit must not inherit one');
	assert.ok(!merged.includes('g_source_snapshot_sha256'), 'the caller recomputes the snapshot');
	assert.ok(!merged.includes('aaaa'));
});

void test('a pack without tags or an excerpt leaves the note\'s own', () => {
	const bare = packOwnedKeys('g_', { hasTags: false, hasExcerpt: false });
	const merged = mergeTextpackUpdate(EXISTING, FRESH, bare);
	assert.ok(merged.includes('g_tags: ["graphs", "old"]'));
	assert.ok(merged.includes('g_excerpt: "Old excerpt"'));
});

void test('existing key order is kept and the merge is idempotent', () => {
	const merged = mergeTextpackUpdate(EXISTING, FRESH, owned);
	const keys = frontmatterBlocks(merged.split('\n---\n')[0].slice(4)).map(block => block.key);
	assert.deepEqual(keys.slice(0, 3), ['title', 'g_published', 'g_published_at']);
	assert.equal(mergeTextpackUpdate(merged, FRESH, owned), merged);
});

void test('a note without frontmatter becomes the fresh import', () => {
	assert.equal(mergeTextpackUpdate('Just a body.\n', FRESH, owned), FRESH);
});

void test('images stay in the folder the note already uses', () => {
	assert.equal(
		updateAssetFolderName(['assets/graph-stores-under-strain-1726650000000/cover.png'], 'graph-stores-under-strain'),
		'graph-stores-under-strain-1726650000000'
	);
	assert.equal(updateAssetFolderName([], 'graph-stores-under-strain'), 'graph-stores-under-strain');
	assert.deepEqual(
		staleAssetPaths(['assets/s/old.png', 'assets/s/cover.png'], ['assets/s/cover.png', 'assets/s/new.png']),
		['assets/s/old.png']
	);
});
