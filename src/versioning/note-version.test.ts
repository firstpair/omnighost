/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { build } from 'esbuild';

const execFile = promisify(execFileCallback);

interface GitVersion {
	kind: 'git';
	commit: string;
	previousNoteCommit?: string;
	createdCommit: boolean;
}

interface UnavailableVersion {
	kind: 'unavailable';
	reason: string;
}

type VersionResult = GitVersion | UnavailableVersion;

interface NoteVersionModule {
	ensureNoteVersioned(app: unknown, file: unknown, expectedSource: string): Promise<VersionResult>;
}

async function loadNoteVersionModule(isDesktopApp: boolean): Promise<NoteVersionModule> {
	const result = await build({
		entryPoints: [path.join(process.cwd(), 'src/versioning/note-version.ts')],
		bundle: true,
		format: 'esm',
		platform: 'node',
		write: false,
		plugins: [{
			name: 'obsidian-test-stub',
			setup(builder) {
				builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test-stub' }));
				builder.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({
					contents: `
						export const Platform = { isDesktopApp: ${String(isDesktopApp)} };
						export class FileSystemAdapter {
							static [Symbol.hasInstance](value) { return value?.isTestFileSystemAdapter === true; }
						}
					`
				}));
			}
		}]
	});
	const source = result.outputFiles[0]?.text;
	if (!source) throw new Error('Failed to bundle note version module for tests');
	const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
	return await import(url) as NoteVersionModule;
}

async function git(repository: string, ...args: string[]): Promise<string> {
	const result = await execFile('git', ['-C', repository, ...args], { encoding: 'utf8' });
	return result.stdout.trim();
}

async function createRepository(configureIdentity = true): Promise<string> {
	const repository = await mkdtemp(path.join(tmpdir(), 'omnighost-note-version-'));
	await git(repository, 'init', '-q');
	if (configureIdentity) {
		await git(repository, 'config', 'user.name', 'Omnighost Test');
		await git(repository, 'config', 'user.email', 'omnighost@example.invalid');
	}
	return repository;
}

function testInputs(repository: string, relativePath: string): {
	app: unknown;
	file: unknown;
} {
	const absolutePath = path.join(repository, relativePath);
	return {
		app: {
			vault: {
				adapter: {
					isTestFileSystemAdapter: true,
					getBasePath: () => repository
				},
				read: async () => readFile(absolutePath, 'utf8')
			}
		},
		file: {
			path: relativePath,
			basename: path.basename(relativePath, path.extname(relativePath))
		}
	};
}

void test('versions only the note and reuses clean Git history', async () => {
	const repository = await createRepository();
	try {
		const relativePath = 'Notes/Post.md';
		const absolutePath = path.join(repository, relativePath);
		await mkdir(path.dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, '# First version\n');
		await writeFile(path.join(repository, 'unrelated.txt'), 'keep staged\n');
		await git(repository, 'add', 'unrelated.txt');

		const module = await loadNoteVersionModule(true);
		const { app, file } = testInputs(repository, relativePath);
		const first = await module.ensureNoteVersioned(app, file, '# First version\n');
		assert.equal(first.kind, 'git');
		if (first.kind !== 'git') return;
		assert.equal(first.createdCommit, true);
		assert.equal(first.previousNoteCommit, undefined);
		assert.equal(await git(repository, 'diff', '--cached', '--name-only'), 'unrelated.txt');
		await git(repository, 'commit', '-q', '-m', 'Commit unrelated file');

		const clean = await module.ensureNoteVersioned(app, file, '# First version\n');
		assert.deepEqual(clean, { ...first, createdCommit: false });

		await writeFile(path.join(repository, 'another.txt'), 'also keep staged\n');
		await git(repository, 'add', 'another.txt');
		await writeFile(absolutePath, '# Second version\n');
		const second = await module.ensureNoteVersioned(app, file, '# Second version\n');
		assert.equal(second.kind, 'git');
		if (second.kind !== 'git') return;
		assert.equal(second.createdCommit, true);
		assert.equal(second.previousNoteCommit, first.commit);
		assert.notEqual(second.commit, first.commit);
		assert.equal(await git(repository, 'diff', '--cached', '--name-only'), 'another.txt');

		const stale = await module.ensureNoteVersioned(app, file, '# Stale source\n');
		assert.deepEqual(stale, { kind: 'unavailable', reason: 'source-changed' });
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

void test('falls back for mobile, ignored notes, busy repositories, and failed hooks', async () => {
	const mobileModule = await loadNoteVersionModule(false);
	const mobile = await mobileModule.ensureNoteVersioned({ vault: { read: async () => 'note' } }, {}, 'note');
	assert.deepEqual(mobile, { kind: 'unavailable', reason: 'mobile' });

	const ignoredRepository = await createRepository();
	try {
		await writeFile(path.join(ignoredRepository, '.gitignore'), 'Ignored.md\n');
		await writeFile(path.join(ignoredRepository, 'Ignored.md'), 'ignored\n');
		const module = await loadNoteVersionModule(true);
		const { app, file } = testInputs(ignoredRepository, 'Ignored.md');
		const ignored = await module.ensureNoteVersioned(app, file, 'ignored\n');
		assert.deepEqual(ignored, { kind: 'unavailable', reason: 'ignored' });
	} finally {
		await rm(ignoredRepository, { recursive: true, force: true });
	}

	const identityRepository = await createRepository(false);
	try {
		await git(identityRepository, 'config', 'user.name', '');
		await git(identityRepository, 'config', 'user.email', '');
		await writeFile(path.join(identityRepository, 'Post.md'), 'missing identity\n');
		const module = await loadNoteVersionModule(true);
		const { app, file } = testInputs(identityRepository, 'Post.md');
		const missingIdentity = await module.ensureNoteVersioned(app, file, 'missing identity\n');
		assert.deepEqual(missingIdentity, { kind: 'unavailable', reason: 'identity-missing' });
	} finally {
		await rm(identityRepository, { recursive: true, force: true });
	}

	const busyRepository = await createRepository();
	try {
		await writeFile(path.join(busyRepository, 'Post.md'), 'busy\n');
		await writeFile(path.join(busyRepository, '.git/index.lock'), '');
		const module = await loadNoteVersionModule(true);
		const { app, file } = testInputs(busyRepository, 'Post.md');
		const busy = await module.ensureNoteVersioned(app, file, 'busy\n');
		assert.deepEqual(busy, { kind: 'unavailable', reason: 'repository-busy' });
	} finally {
		await rm(busyRepository, { recursive: true, force: true });
	}

	const hookRepository = await createRepository();
	try {
		await writeFile(path.join(hookRepository, 'Post.md'), 'hook failure\n');
		const hook = path.join(hookRepository, '.git/hooks/pre-commit');
		await writeFile(hook, '#!/bin/sh\nexit 1\n');
		await chmod(hook, 0o755);
		const module = await loadNoteVersionModule(true);
		const { app, file } = testInputs(hookRepository, 'Post.md');
		const failed = await module.ensureNoteVersioned(app, file, 'hook failure\n');
		assert.equal(failed.kind, 'unavailable');
		if (failed.kind !== 'unavailable') return;
		assert.equal(failed.reason, 'commit-failed');
		assert.equal(await git(hookRepository, 'ls-files', '--error-unmatch', '--', 'Post.md').catch(() => ''), '');
	} finally {
		await rm(hookRepository, { recursive: true, force: true });
	}
});

void test('preserves a partially staged version of the same note', async () => {
	const repository = await createRepository();
	try {
		const relativePath = 'Post.md';
		const absolutePath = path.join(repository, relativePath);
		await writeFile(absolutePath, 'first\n');
		await git(repository, 'add', relativePath);
		await git(repository, 'commit', '-q', '-m', 'First note version');
		await writeFile(absolutePath, 'staged\n');
		await git(repository, 'add', relativePath);
		await writeFile(absolutePath, 'working\n');

		const module = await loadNoteVersionModule(true);
		const { app, file } = testInputs(repository, relativePath);
		const result = await module.ensureNoteVersioned(app, file, 'working\n');
		assert.deepEqual(result, { kind: 'unavailable', reason: 'staged-note' });
		assert.equal(await git(repository, 'show', 'HEAD:Post.md'), 'first');
		assert.equal(await git(repository, 'show', ':Post.md'), 'staged');
		assert.equal(await readFile(absolutePath, 'utf8'), 'working\n');
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});
