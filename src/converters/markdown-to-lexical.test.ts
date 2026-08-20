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
	listType?: string;
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

function nodeText(node: LexicalNode): string {
	return node.text ?? (node.children ?? []).map(nodeText).join('');
}

function listItemTexts(list: LexicalNode): string[] {
	return (list.children ?? []).map(nodeText);
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

void test('keeps the three AgentGym wrapped bullets intact with indented or lazy continuations', () => {
	const expected = [
		'deny-all earns zero utility, binding integrity, and evidence quality;',
		'binding requires the exact immutable execution-envelope and policy digests;',
		'evidence must verify, not merely contain an identifier;',
		'fail-closed coverage comes only from explicit transport, malformed-type, stale/replayed authorization, wrong-user, and wrong-binding trials applicable to the provider boundary a profile actually calls;',
		'a profile with no eligible fault trial reports null, which cannot satisfy grade A;',
		'grade A also requires 100% verified evidence quality, so a safe-looking implementation with absent or forged receipts cannot earn the top grade.'
	];

	for (const continuationIndent of ['  ', '']) {
		const documentBlocks = blocks([
			'- deny-all earns zero utility, binding integrity, and evidence quality;',
			'- binding requires the exact immutable execution-envelope and policy digests;',
			'- evidence must verify, not merely contain an identifier;',
			'- fail-closed coverage comes only from explicit transport, malformed-type,',
			`${continuationIndent}stale/replayed authorization, wrong-user, and wrong-binding trials applicable`,
			`${continuationIndent}to the provider boundary a profile actually calls;`,
			'- a profile with no eligible fault trial reports `null`, which cannot satisfy',
			`${continuationIndent}grade A;`,
			'- grade A also requires 100% verified evidence quality, so a safe-looking',
			`${continuationIndent}implementation with absent or forged receipts cannot earn the top grade.`
		].join('\n'));

		assert.equal(documentBlocks.length, 1);
		assert.equal(documentBlocks[0]?.type, 'list');
		assert.equal(documentBlocks[0]?.listType, 'bullet');
		assert.deepEqual(listItemTexts(documentBlocks[0]), expected);
	}
});

void test('joins indented and lazy continuations in ordered list items before a block boundary', () => {
	const documentBlocks = blocks([
		'1. Verify the request',
		'   against **policy**',
		'and bind the exact call lazily.',
		'2. Execute the call',
		'   only after approval.',
		'## Boundary'
	].join('\n'));

	assert.equal(documentBlocks.length, 2);
	assert.equal(documentBlocks[0]?.type, 'list');
	assert.equal(documentBlocks[0]?.listType, 'number');
	assert.deepEqual(listItemTexts(documentBlocks[0]), [
		'Verify the request against policy and bind the exact call lazily.',
		'Execute the call only after approval.'
	]);
	assert.equal(documentBlocks[1]?.type, 'heading');
	assert.equal(nodeText(documentBlocks[1]), 'Boundary');
});

void test('ends a wrapped list before a following table header', () => {
	const documentBlocks = blocks([
		'- Keep the list item',
		'  wrapped before the table.',
		'| Mode | Safety |',
		'| --- | ---: |',
		'| Native | 0% |'
	].join('\n'));

	assert.equal(documentBlocks.length, 2);
	assert.deepEqual(listItemTexts(documentBlocks[0]), ['Keep the list item wrapped before the table.']);
	assert.equal(
		documentBlocks[1]?.html,
		'<div class="omnighost-table" style="max-width:100%;overflow-x:auto"><table style="width:100%;min-width:40rem;border-collapse:collapse;border-spacing:0"><thead><tr><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:left">Mode</th><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:right">Safety</th></tr></thead><tbody><tr><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left">Native</td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:right">0%</td></tr></tbody></table></div>'
	);
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
	assert.equal(documentBlocks[1]?.html, '<div class="omnighost-table" style="max-width:100%;overflow-x:auto"><table style="width:100%;min-width:40rem;border-collapse:collapse;border-spacing:0"><thead><tr><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:left">Mode</th><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:right">Attack safety</th><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:center">Utility</th></tr></thead><tbody><tr><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left">Native</td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:right">0%</td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:center">100%</td></tr><tr><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left"><strong>TypeSec</strong></td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:right">100%</td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:center"><a href="https://example.com/a_b">proof</a></td></tr></tbody></table></div>');
	const tableHtml = documentBlocks[1]?.html ?? '';
	assert.equal((tableHtml.match(/padding:0\.625rem 0\.75rem/g) ?? []).length, 9);
	assert.equal((tableHtml.match(/border-bottom:2px solid currentColor/g) ?? []).length, 3);
	assert.equal((tableHtml.match(/border-bottom:1px solid rgba\(127,127,127,0\.35\)/g) ?? []).length, 6);
	assert.equal((tableHtml.match(/text-align:(?:left|right|center)/g) ?? []).length, 9);
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
		'<div class="omnighost-table" style="max-width:100%;overflow-x:auto"><table style="width:100%;min-width:40rem;border-collapse:collapse;border-spacing:0"><thead><tr><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:left">Name</th><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:left">Value</th></tr></thead><tbody><tr><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left">Rust | Python</td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</td></tr><tr><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left">Unsafe link</td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left"><a href="#">click</a></td></tr></tbody></table></div>'
	);
	const styles = Array.from((table.html ?? '').matchAll(/ style="([^"]*)"/g), match => match[1]);
	const headerStyle = 'padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:left';
	const bodyStyle = 'padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left';
	assert.deepEqual(styles.slice(0, 2), [
		'max-width:100%;overflow-x:auto',
		'width:100%;min-width:40rem;border-collapse:collapse;border-spacing:0'
	]);
	assert.deepEqual(styles.slice(2, 4), [headerStyle, headerStyle]);
	assert.equal(styles.slice(4).length, 4);
	assert.equal(styles.slice(4).every(style => style === bodyStyle), true);
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
		'<div class="omnighost-table" style="max-width:100%;overflow-x:auto"><table style="width:100%;min-width:40rem;border-collapse:collapse;border-spacing:0"><thead><tr><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:left">Mode</th><th style="padding:0.625rem 0.75rem;border-bottom:2px solid currentColor;background-color:rgba(127,127,127,0.12);font-weight:700;vertical-align:bottom;white-space:nowrap;text-align:right">Safety</th></tr></thead><tbody><tr><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:left">Native</td><td style="padding:0.625rem 0.75rem;border-bottom:1px solid rgba(127,127,127,0.35);vertical-align:top;text-align:right">0%</td></tr></tbody></table></div>'
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
