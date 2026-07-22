/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { htmlToMarkdown } from './html-to-markdown';

void test('ends a Ghost blockquote before the following paragraph', () => {
	const html = '<blockquote><p>A Python quotation.</p></blockquote><p>Back to ordinary prose.</p>';

	assert.equal(
		htmlToMarkdown(html),
		'> A Python quotation.\n\nBack to ordinary prose.'
	);
});

void test('preserves separate paragraphs inside a Ghost blockquote', () => {
	const html = '<blockquote><p>First quoted paragraph.</p><p>Second quoted paragraph.</p></blockquote><p>Outside.</p>';

	assert.equal(
		htmlToMarkdown(html),
		'> First quoted paragraph.\n>\n> Second quoted paragraph.\n\nOutside.'
	);
});
