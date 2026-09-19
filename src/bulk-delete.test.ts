/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { newestFirst, removableNotes, sharedWithOtherNotes, withGhostTimes } from './bulk-delete';

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

void test('rows are dated by ghost, not by the age of the note file', () => {
	const noteDate = Date.parse('2026-09-13T00:00:00Z');
	const items = [
		{ blogId: 'q', ghostId: 'dup', when: noteDate, published: true, title: 'duplicate, old note file' },
		{ blogId: 'q', ghostId: 'orig', when: Date.parse('2026-09-17T12:00:00Z'), published: true, title: 'original' },
		{ blogId: 'q', ghostId: 'draft', when: noteDate, published: true, title: 'a draft' },
		{ blogId: 'q', ghostId: 'gone', when: noteDate, published: false, title: 'unknown to ghost' },
		{ blogId: 'down', ghostId: 'x', when: noteDate, published: false, title: 'blog unreachable' }
	];
	const dated = withGhostTimes(items, new Map([['q', [
		{ id: 'dup', status: 'published', published_at: '2026-09-18T23:40:28.000Z', updated_at: '2026-09-18T23:40:28.000Z' },
		{ id: 'orig', status: 'published', published_at: '2026-09-17T19:04:02.000Z', updated_at: '2026-09-19T20:00:00.000Z' },
		{ id: 'draft', status: 'draft', published_at: null, updated_at: '2026-09-16T08:00:00.000Z' }
	]]]));

	// The duplicate made last night sorts first although its note file is the oldest.
	assert.deepEqual(newestFirst(dated).map(row => row.title).slice(0, 2), ['duplicate, old note file', 'original']);
	// A published post is dated by publication, not by its later edit.
	assert.equal(dated[1].when, Date.parse('2026-09-17T19:04:02.000Z'));
	// A draft is dated by its last change, and ghost's status wins over the note's.
	assert.equal(dated[2].when, Date.parse('2026-09-16T08:00:00.000Z'));
	assert.equal(dated[2].published, false);
	// No answer from ghost: the note's date stays, and the row says so.
	assert.deepEqual(dated.map(row => row.whenFromGhost), [true, true, true, false, false]);
	assert.equal(dated[3].when, noteDate);
});
