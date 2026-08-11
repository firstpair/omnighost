/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { markdownToLexical } from './markdown-to-lexical';

interface LexicalNode {
	type: string;
	text?: string;
	url?: string;
	format?: number | string;
	children?: LexicalNode[];
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
