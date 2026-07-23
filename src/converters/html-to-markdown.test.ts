/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { htmlToMarkdown } from './html-to-markdown';

void test('ends a Ghost code block before the following paragraph', () => {
	const html = '<pre><code class="language-python">spark = (\n    SparkSession.builder\n)</code></pre><p>The protocol boundary lets Sail replace the engine.</p><h2>Why Replace the Engine</h2>';

	assert.equal(
		htmlToMarkdown(html),
		'```python\nspark = (\n    SparkSession.builder\n)\n```\n\nThe protocol boundary lets Sail replace the engine.\n\n## Why Replace the Engine'
	);
});

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

void test('imports Ghost HTML unordered lists as separate Markdown items', () => {
	const html = '<p>Before.</p><ul><li><p>First item</p></li><li><p>Second <strong>item</strong></p></li></ul><p>After.</p>';

	assert.equal(
		htmlToMarkdown(html),
		'Before.\n\n- First item\n- Second **item**\n\nAfter.'
	);
});

void test('imports Ghost HTML ordered lists as separate Markdown items', () => {
	const html = '<ol><li><p>Alpha</p></li><li><p>Beta with <a href="https://example.com">link</a></p></li></ol>';

	assert.equal(
		htmlToMarkdown(html),
		'1. Alpha\n2. Beta with [link](https://example.com)'
	);
});
