/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { newestFirst, removableNotes, sharedWithOtherNotes } from './bulk-delete';

const link = (path: string, blogId: string, ghostId: string) => ({ path, blogId, ghostId });

void test('rows are latest first, ties by title', () => {
	const rows = newestFirst([
		{ when: 10, title: 'b' },
		{ when: 30, title: 'duplicate' },
		{ when: 10, title: 'a' },
		{ when: 20, title: 'c' }
	]);
	assert.deepEqual(rows.map(row => row.title), ['duplicate', 'c', 'a', 'b']);
});

void test('a note goes only when every post it links to is deleted', () => {
	const all = [
		link('strain.md', 'querygraph', 'q1'),
		link('strain.md', 'adversarial', 'a1'),
		link('strain.md', 'chief', 'c1'),
		link('duplicate.md', 'querygraph', 'q2')
	];
	// One of three posts: the note stays, or two posts lose their note.
	assert.deepEqual([...removableNotes(all, [all[0]])], []);
	// All three: the note may go.
	assert.deepEqual([...removableNotes(all, all.slice(0, 3))], ['strain.md']);
	// A single-blog duplicate: the note may go.
	assert.deepEqual([...removableNotes(all, [all[3]])], ['duplicate.md']);
});

void test('a selected post another note still links to is reported', () => {
	const all = [
		link('original.md', 'querygraph', 'q1'),
		link('adopted-copy.md', 'querygraph', 'q1'),
		link('other.md', 'querygraph', 'q9')
	];
	const shared = sharedWithOtherNotes(all, [all[1]]);
	assert.deepEqual([...shared], [['querygraph:q1', ['original.md']]]);
	// Selecting both notes of the shared post leaves nothing depending on it.
	assert.equal(sharedWithOtherNotes(all, [all[0], all[1]]).size, 0);
	assert.equal(sharedWithOtherNotes(all, [all[2]]).size, 0);
});
