/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { parseTextpack } from './textpack';

const execFile = promisify(execFileCallback);
const TEXTPACK_SCRIPT = path.join(process.cwd(), 'scripts/textpack.py');

async function git(repository: string, ...args: string[]): Promise<string> {
	const result = await execFile('git', ['-C', repository, ...args], { encoding: 'utf8' });
	return result.stdout.trim();
}

async function parseFile(file: string) {
	const bytes = await readFile(file);
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return parseTextpack(buffer, path.basename(file));
}

void test('the textpack producer versions exact inputs and the importer inherits that commit', async () => {
	const repository = await mkdtemp(path.join(tmpdir(), 'omnighost-textpack-'));
	try {
		await git(repository, 'init', '-q');
		await git(repository, 'config', 'user.name', 'Omnighost Test');
		await git(repository, 'config', 'user.email', 'omnighost@example.invalid');
		await mkdir(path.join(repository, 'images'));
		await writeFile(
			path.join(repository, 'post.md'),
			'# Imported title\n\nBody.\n\n![Picture](images/picture.png)\n![Z](images/z.png)\n![Unicode](images/ä.png)\n'
		);
		await writeFile(path.join(repository, 'images/picture.png'), 'image bytes');
		await writeFile(path.join(repository, 'images/z.png'), 'z image');
		await writeFile(path.join(repository, 'images/ä.png'), 'unicode image');
		await writeFile(path.join(repository, 'unrelated.txt'), 'keep staged\n');
		await git(repository, 'add', 'unrelated.txt');

		const output = path.join(repository, 'dist', 'post.textpack');
		const first = await execFile('python3', [
			TEXTPACK_SCRIPT,
			path.join(repository, 'post.md'),
			'--blog', 'example.com',
			'--slug', 'imported',
			'--tags', 'one,two',
			'--excerpt', 'Summary',
			'--no-reflow',
			'--out', output
		], { encoding: 'utf8' });
		const commit = await git(repository, 'rev-parse', 'HEAD');
		assert.match(first.stdout, new RegExp(`source git ${commit}`));
		assert.deepEqual(
			(await git(repository, 'ls-tree', '-r', '--name-only', '-z', 'HEAD')).split('\0').filter(Boolean),
			['images/picture.png', 'images/z.png', 'images/ä.png', 'post.md']
		);
		assert.equal(await git(repository, 'diff', '--cached', '--name-only'), 'unrelated.txt');

		const pack = await parseFile(output);
		assert.equal(pack.provenanceWarning, undefined);
		assert.equal(pack.sourceVersion?.gitCommit, commit);
		assert.equal(pack.sourceVersion?.assets[0]?.name, 'picture.png');

		await execFile('python3', [
			TEXTPACK_SCRIPT,
			path.join(repository, 'post.md'),
			'--blog', 'example.com',
			'--slug', 'imported',
			'--tags', 'one,two',
			'--excerpt', 'Summary',
			'--no-reflow',
			'--out', output
		], { encoding: 'utf8' });
		assert.equal(await git(repository, 'rev-parse', 'HEAD'), commit);
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

void test('a partially staged source falls back to a validated payload SHA', async () => {
	const repository = await mkdtemp(path.join(tmpdir(), 'omnighost-textpack-fallback-'));
	try {
		await git(repository, 'init', '-q');
		await git(repository, 'config', 'user.name', 'Omnighost Test');
		await git(repository, 'config', 'user.email', 'omnighost@example.invalid');
		const post = path.join(repository, 'post.md');
		await writeFile(post, '# Title\n\nFirst.\n');
		await git(repository, 'add', 'post.md');
		await git(repository, 'commit', '-q', '-m', 'First');
		await writeFile(post, '# Title\n\nStaged.\n');
		await git(repository, 'add', 'post.md');
		await writeFile(post, '# Title\n\nWorking.\n');

		const output = path.join(repository, 'fallback.textpack');
		const built = await execFile('python3', [
			TEXTPACK_SCRIPT,
			post,
			'--no-reflow',
			'--out', output
		], { encoding: 'utf8' });
		assert.match(built.stderr, /partially staged input/);
		assert.equal((await parseFile(output)).sourceVersion?.gitCommit, undefined);
		assert.equal(await git(repository, 'show', 'HEAD:post.md'), '# Title\n\nFirst.');
		assert.equal(await git(repository, 'show', ':post.md'), '# Title\n\nStaged.');
		assert.equal(await readFile(post, 'utf8'), '# Title\n\nWorking.\n');
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

void test('a source outside Git still imports with validated hash-only provenance', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'omnighost-textpack-no-git-'));
	try {
		const post = path.join(directory, 'post.md');
		const output = path.join(directory, 'post.textpack');
		await writeFile(post, '# Title\n\nHash-only source.\n');
		const built = await execFile('python3', [
			TEXTPACK_SCRIPT,
			post,
			'--no-reflow',
			'--out', output
		], { encoding: 'utf8' });
		assert.match(built.stderr, /not inside a Git repository/);
		const pack = await parseFile(output);
		assert.ok(pack.sourceVersion?.payloadSha256);
		assert.equal(pack.sourceVersion?.gitCommit, undefined);
		assert.equal(pack.provenanceWarning, undefined);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
