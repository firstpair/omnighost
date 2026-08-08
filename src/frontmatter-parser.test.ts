/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseGhostMetadata, upsertGhostMetadata } from './frontmatter-parser';
import { generateGhostFrontmatter } from './templates';
import { DEFAULT_SETTINGS } from './types';

void test('parses per-note provenance choices with a configurable prefix', () => {
	const metadata = parseGhostMetadata({
		x_post_access: 'public',
		x_provenance_override: ' TRUE ',
		x_provenance_visibility: ' Visible-Credit ',
		x_provenance_delimiter: ' Single ',
		x_provenance_size: ' Small ',
		x_provenance_italic: ' TRUE '
	}, 'x_');
	assert.ok(metadata);
	assert.equal(metadata.provenance_override, true);
	assert.equal(metadata.provenance_visibility, 'visible-credit');
	assert.equal(metadata.provenance_delimiter, 'single');
	assert.equal(metadata.provenance_size, 'small');
	assert.equal(metadata.provenance_italic, true);
});

void test('missing or invalid provenance choices use stable publishing defaults', () => {
	const missing = parseGhostMetadata({ g_post_access: 'public' }, 'g_');
	assert.ok(missing);
	assert.equal(missing.provenance_override, false);
	assert.equal(missing.provenance_visibility, 'default');
	assert.equal(missing.provenance_delimiter, 'double');
	assert.equal(missing.provenance_size, 'tiny');
	assert.equal(missing.provenance_italic, false);

	const invalid = parseGhostMetadata({
		g_post_access: 'public',
		g_provenance_override: 1,
		g_provenance_visibility: 'sometimes',
		g_provenance_delimiter: 'triple',
		g_provenance_size: 'huge',
		g_provenance_italic: 'no'
	}, 'g_');
	assert.ok(invalid);
	assert.equal(invalid.provenance_override, false);
	assert.equal(invalid.provenance_visibility, 'default');
	assert.equal(invalid.provenance_delimiter, 'double');
	assert.equal(invalid.provenance_size, 'tiny');
	assert.equal(invalid.provenance_italic, false);
});

void test('provenance choices persist without duplicating keys or changing body content', () => {
	const original = `---\ntitle: Keep me\ng_provenance_size: normal\n---\nBody stays byte-for-byte.\n`;
	const updated = upsertGhostMetadata(original, {
		provenance_override: 'true',
		provenance_visibility: 'hidden',
		provenance_delimiter: 'none',
		provenance_size: 'tiny',
		provenance_italic: 'true'
	}, 'g_');
	assert.match(updated, /^title: Keep me$/m);
	assert.match(updated, /^g_provenance_override: true$/m);
	assert.match(updated, /^g_provenance_visibility: hidden$/m);
	assert.match(updated, /^g_provenance_delimiter: none$/m);
	assert.match(updated, /^g_provenance_size: tiny$/m);
	assert.match(updated, /^g_provenance_italic: true$/m);
	assert.equal((updated.match(/^g_provenance_size:/gm) ?? []).length, 1);
	assert.equal(updated.endsWith('Body stays byte-for-byte.\n'), true);
});

void test('new post templates expose the default per-note provenance controls', () => {
	const template = generateGhostFrontmatter({ ...DEFAULT_SETTINGS, yamlPrefix: 'g_' });
	assert.match(template, /^g_published: true$/m);
	assert.match(template, /^g_cover_from_first_image: true$/m);
	assert.match(template, /^g_provenance_override: false$/m);
	assert.match(template, /^g_provenance_visibility: default$/m);
	assert.match(template, /^g_provenance_delimiter: double$/m);
	assert.match(template, /^g_provenance_size: tiny$/m);
	assert.match(template, /^g_provenance_italic: false$/m);
});

void test('missing publish and first-image cover properties use publishing defaults', () => {
	const metadata = parseGhostMetadata({ g_post_access: 'public' }, 'g_');
	assert.ok(metadata);
	assert.equal(metadata.published, true);
	assert.equal(metadata.cover_from_first_image, true);

	const explicitDraft = parseGhostMetadata({
		g_post_access: 'public',
		g_published: false,
		g_cover_from_first_image: false
	}, 'g_');
	assert.ok(explicitDraft);
	assert.equal(explicitDraft.published, false);
	assert.equal(explicitDraft.cover_from_first_image, false);
});
