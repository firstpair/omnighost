/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { markdownToLexical } from './markdown-to-lexical';

interface LexicalNode {
	type: string;
	text?: string;
	url?: string;
	html?: string;
	format?: number | string;
	children?: LexicalNode[];
}

function blocks(markdown: string): LexicalNode[] {
	return (JSON.parse(markdownToLexical(markdown)) as { root: { children: LexicalNode[] } }).root.children;
}

function firstBlock(markdown: string): LexicalNode {
	const document = JSON.parse(markdownToLexical(markdown)) as { root: { children: LexicalNode[] } };
	const block = document.root.children[0];
	assert.ok(block);
	return block;
}

void test('keeps underscores inside link URLs opaque', () => {
	const heading = firstBlock(
		'### 9. [Rust Confessional: A Durable Agentic Loop on Temporal — Melanie Warrick and Melissa Herrera](https://www.youtube.com/watch?v=_t_Rxf8Z4mU)'
	);

	assert.equal(heading.type, 'heading');
	assert.equal(heading.children?.length, 2);
	assert.equal(heading.children?.[0]?.text, '9. ');
	assert.equal(heading.children?.[1]?.type, 'link');
	assert.equal(heading.children?.[1]?.url, 'https://www.youtube.com/watch?v=_t_Rxf8Z4mU');
	assert.equal(
		heading.children?.[1]?.children?.[0]?.text,
		'Rust Confessional: A Durable Agentic Loop on Temporal — Melanie Warrick and Melissa Herrera'
	);
});

void test('preserves formatting in link labels without formatting their URLs', () => {
	const paragraph = firstBlock(
		'Before [an _important_ **video**](https://example.com/path_with_pairs/file_name) after.'
	);
	const link = paragraph.children?.find(node => node.type === 'link');

	assert.equal(link?.url, 'https://example.com/path_with_pairs/file_name');
	assert.deepEqual(
		link?.children?.map(node => ({ text: node.text, format: node.format })),
		[
			{ text: 'an ', format: 0 },
			{ text: 'important', format: 2 },
			{ text: ' ', format: 0 },
			{ text: 'video', format: 1 }
		]
	);
	assert.equal(paragraph.children?.[0]?.text, 'Before ');
	assert.equal(paragraph.children?.[2]?.text, ' after.');
});

void test('parses multiple links without exposing internal formatting markers', () => {
	const paragraph = firstBlock(
		'[First](https://example.com/a_b_c) and [second](https://example.com/_x_y).'
	);
	const serialized = JSON.stringify(paragraph);

	assert.equal(paragraph.children?.filter(node => node.type === 'link').length, 2);
	assert.equal(serialized.includes('{{'), false);
	assert.equal(serialized.includes('}}'), false);
});

void test('converts a Markdown table to a responsive Ghost HTML card', () => {
	const documentBlocks = blocks([
		'Intro.',
		'',
		'| Mode | Attack safety | Utility |',
		'|---|---:|:---:|',
		'| Native | 0% | 100% |',
		'| **TypeSec** | 100% | [proof](https://example.com/a_b) |',
		'',
		'After.'
	].join('\n'));

	assert.equal(documentBlocks.length, 3);
	assert.equal(documentBlocks[1]?.type, 'html');
	assert.equal(documentBlocks[1]?.html, '<div class="omnighost-table" style="overflow-x:auto"><table><thead><tr><th>Mode</th><th style="text-align:right">Attack safety</th><th style="text-align:center">Utility</th></tr></thead><tbody><tr><td>Native</td><td style="text-align:right">0%</td><td style="text-align:center">100%</td></tr><tr><td><strong>TypeSec</strong></td><td style="text-align:right">100%</td><td style="text-align:center"><a href="https://example.com/a_b">proof</a></td></tr></tbody></table></div>');
});

void test('preserves escaped pipes and escapes unsafe table cell HTML', () => {
	const table = firstBlock([
		'Name | Value',
		'--- | ---',
		'Rust \\| Python | <script>alert("x")</script>',
		'Unsafe link | [click](javascript:alert(1))'
	].join('\n'));

	assert.equal(table.type, 'html');
	assert.equal(
		table.html,
		'<div class="omnighost-table" style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Rust | Python</td><td>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</td></tr><tr><td>Unsafe link</td><td><a href="#">click</a></td></tr></tbody></table></div>'
	);
});

void test('ends a table before a following block that contains a pipe', () => {
	const documentBlocks = blocks([
		'| Mode | Safety |',
		'| --- | ---: |',
		'| Native | 0% |',
		'## Follow-up | interpretation'
	].join('\n'));

	assert.equal(documentBlocks.length, 2);
	assert.equal(
		documentBlocks[0]?.html,
		'<div class="omnighost-table" style="overflow-x:auto"><table><thead><tr><th>Mode</th><th style="text-align:right">Safety</th></tr></thead><tbody><tr><td>Native</td><td style="text-align:right">0%</td></tr></tbody></table></div>'
	);
	assert.equal(documentBlocks[1]?.type, 'heading');
	assert.equal(documentBlocks[1]?.children?.map(node => node.text ?? '').join(''), 'Follow-up | interpretation');
});

void test('leaves malformed table-like Markdown as ordinary prose', () => {
	const block = firstBlock([
		'| Mode | Safety |',
		'| -- | nope |',
		'| Native | 0% |'
	].join('\n'));

	assert.equal(block.type, 'paragraph');
	assert.equal(
		block.children?.map(node => node.text ?? '').join(''),
		'| Mode | Safety | | -- | nope | | Native | 0% |'
	);
	assert.equal(block.html, undefined);
});
