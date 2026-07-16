import { App, FileSystemAdapter, Platform, TFile } from 'obsidian';

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 1024 * 1024;

export type NoteVersionUnavailableReason =
	| 'mobile'
	| 'no-filesystem'
	| 'source-changed'
	| 'git-unavailable'
	| 'not-repository'
	| 'path-outside-repository'
	| 'repository-busy'
	| 'detached-head'
	| 'conflict'
	| 'staged-note'
	| 'identity-missing'
	| 'ignored'
	| 'commit-failed'
	| 'verification-failed';

export interface GitNoteVersion {
	kind: 'git';
	/** Full commit object id. */
	commit: string;
	/** Previous commit that touched this note, used to recognize bookkeeping-only successors. */
	previousNoteCommit?: string;
	/** False when the existing committed version already matched the note. */
	createdCommit: boolean;
}

export interface UnavailableNoteVersion {
	kind: 'unavailable';
	reason: NoteVersionUnavailableReason;
	/** Short diagnostic suitable for logging, not publication. */
	detail?: string;
}

export type NoteVersionResult = GitNoteVersion | UnavailableNoteVersion;

type DesktopRuntime = {
	execFile: typeof import('child_process').execFile;
	fs: typeof import('fs/promises');
	path: typeof import('path');
	env: Record<string, string | undefined>;
};

interface GitCommandResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	errorCode?: string;
	timedOut: boolean;
}

interface RepositoryContext {
	runtime: DesktopRuntime;
	repositoryRoot: string;
	noteAbsolutePath: string;
	noteRelativePath: string;
}

/** In-process serialization only; external Git locks are detected and respected. */
const repositoryTails = new Map<string, Promise<void>>();

function unavailable(
	reason: NoteVersionUnavailableReason,
	detail?: string
): UnavailableNoteVersion {
	return detail ? { kind: 'unavailable', reason, detail } : { kind: 'unavailable', reason };
}

function stripFinalLineEnding(value: string): string {
	return value.endsWith('\r\n') ? value.slice(0, -2) : value.endsWith('\n') ? value.slice(0, -1) : value;
}

function commandDetail(result: GitCommandResult): string | undefined {
	const raw = result.stderr.trim() || result.stdout.trim();
	if (!raw) return undefined;
	return (raw.split(/\r?\n/, 1)[0] || '').replace(/\s+/g, ' ').slice(0, 240) || undefined;
}

async function sourceStillMatches(app: App, file: TFile, expectedSource: string): Promise<boolean> {
	try {
		return await app.vault.read(file) === expectedSource;
	} catch {
		return false;
	}
}

async function loadDesktopRuntime(): Promise<DesktopRuntime> {
	// These imports must never be evaluated by Obsidian's Capacitor mobile runtime.
	// eslint-disable-next-line import/no-nodejs-modules -- guarded by Platform.isDesktopApp and FileSystemAdapter
	const childProcess = await import('child_process');
	// eslint-disable-next-line import/no-nodejs-modules -- guarded by Platform.isDesktopApp and FileSystemAdapter
	const fs = await import('fs/promises');
	// eslint-disable-next-line import/no-nodejs-modules -- guarded by Platform.isDesktopApp and FileSystemAdapter
	const path = await import('path');
	// eslint-disable-next-line import/no-nodejs-modules -- guarded by Platform.isDesktopApp and FileSystemAdapter
	const processModule = await import('process');
	return { execFile: childProcess.execFile, fs, path, env: { ...processModule.env } };
}

function runGit(runtime: DesktopRuntime, args: string[]): Promise<GitCommandResult> {
	return new Promise((resolve) => {
		runtime.execFile(
			'git',
			args,
			{
				encoding: 'utf8',
				env: {
					...runtime.env,
					GCM_INTERACTIVE: 'Never',
					GIT_TERMINAL_PROMPT: '0',
					LC_ALL: 'C'
				},
				maxBuffer: GIT_MAX_BUFFER,
				timeout: GIT_TIMEOUT_MS,
				windowsHide: true
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ exitCode: 0, stdout: String(stdout), stderr: String(stderr), timedOut: false });
					return;
				}
				resolve({
					exitCode: typeof error.code === 'number' ? error.code : null,
					stdout: String(stdout ?? ''),
					stderr: String(stderr ?? ''),
					errorCode: typeof error.code === 'string' ? error.code : undefined,
					timedOut: error.killed === true || error.signal === 'SIGTERM'
				});
			}
		);
	});
}

function gitInRepository(context: RepositoryContext, args: string[]): Promise<GitCommandResult> {
	return runGit(context.runtime, ['-C', context.repositoryRoot, ...args]);
}

async function pathExists(fs: DesktopRuntime['fs'], path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

async function withRepositoryLock<T>(repositoryRoot: string, action: () => Promise<T>): Promise<T> {
	const previous = repositoryTails.get(repositoryRoot) ?? Promise.resolve();
	let release = (): void => undefined;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => current);
	repositoryTails.set(repositoryRoot, tail);

	await previous;
	try {
		return await action();
	} finally {
		release();
		if (repositoryTails.get(repositoryRoot) === tail) {
			repositoryTails.delete(repositoryRoot);
		}
	}
}

async function repositoryIsBusy(context: RepositoryContext): Promise<boolean | null> {
	const gitDirResult = await gitInRepository(context, ['rev-parse', '--absolute-git-dir']);
	if (gitDirResult.exitCode !== 0) return null;

	const gitDir = stripFinalLineEnding(gitDirResult.stdout);
	const statePaths = [
		'index.lock',
		'MERGE_HEAD',
		'CHERRY_PICK_HEAD',
		'REVERT_HEAD',
		'BISECT_LOG',
		'rebase-merge',
		'rebase-apply',
		'sequencer'
	];
	for (const statePath of statePaths) {
		if (await pathExists(context.runtime.fs, context.runtime.path.join(gitDir, statePath))) {
			return true;
		}
	}
	return false;
}

async function worktreeBlobMatchesHead(
	context: RepositoryContext,
	hasHead: boolean
): Promise<{ headHasPath: boolean; matches: boolean } | null> {
	if (!hasHead) return { headHasPath: false, matches: false };

	const headBlob = await gitInRepository(context, [
		'rev-parse',
		'--verify',
		`HEAD:${context.noteRelativePath}`
	]);
	if (headBlob.exitCode !== 0) {
		return { headHasPath: false, matches: false };
	}

	const worktreeBlob = await gitInRepository(context, [
		'hash-object',
		`--path=${context.noteRelativePath}`,
		'--',
		context.noteAbsolutePath
	]);
	if (worktreeBlob.exitCode !== 0) return null;

	return {
		headHasPath: true,
		matches: stripFinalLineEnding(headBlob.stdout) === stripFinalLineEnding(worktreeBlob.stdout)
	};
}

async function previousNoteCommit(
	context: RepositoryContext,
	commit: string
): Promise<string | undefined> {
	const result = await gitInRepository(context, [
		'log',
		'-2',
		'--format=%H',
		commit,
		'--',
		context.noteRelativePath
	]);
	if (result.exitCode !== 0) return undefined;
	const commits = result.stdout.trim().toLowerCase().split(/\r?\n/);
	const previous = commits[0] === commit.toLowerCase() ? commits[1] : undefined;
	return previous && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(previous)
		? previous
		: undefined;
}

async function stagedNoteDiffersFromWorktree(
	context: RepositoryContext
): Promise<boolean | null> {
	const staged = await gitInRepository(context, [
		'diff',
		'--cached',
		'--quiet',
		'--',
		context.noteRelativePath
	]);
	if (staged.exitCode === 0) return false;
	if (staged.exitCode !== 1 || staged.errorCode || staged.timedOut) return null;

	const indexBlob = await gitInRepository(context, [
		'rev-parse',
		'--verify',
		`:${context.noteRelativePath}`
	]);
	if (indexBlob.exitCode !== 0) return true;
	const worktreeBlob = await gitInRepository(context, [
		'hash-object',
		`--path=${context.noteRelativePath}`,
		'--',
		context.noteAbsolutePath
	]);
	if (worktreeBlob.exitCode !== 0) return null;
	return stripFinalLineEnding(indexBlob.stdout) !== stripFinalLineEnding(worktreeBlob.stdout);
}

async function cleanVersion(
	context: RepositoryContext,
	app: App,
	file: TFile,
	expectedSource: string
): Promise<NoteVersionResult> {
	const lastCommit = await gitInRepository(context, [
		'log',
		'-1',
		'--format=%H',
		'--',
		context.noteRelativePath
	]);
	const commit = stripFinalLineEnding(lastCommit.stdout);
	if (!await sourceStillMatches(app, file, expectedSource)) {
		return unavailable('source-changed');
	}
	if (lastCommit.exitCode !== 0 || !commit) {
		return unavailable('verification-failed', commandDetail(lastCommit));
	}

	const previous = await previousNoteCommit(context, commit);
	return previous
		? { kind: 'git', commit, previousNoteCommit: previous, createdCommit: false }
		: { kind: 'git', commit, createdCommit: false };
}

async function ensureVersionInRepository(
	context: RepositoryContext,
	app: App,
	file: TFile,
	expectedSource: string
): Promise<NoteVersionResult> {
	if (!await sourceStillMatches(app, file, expectedSource)) {
		return unavailable('source-changed');
	}

	const busy = await repositoryIsBusy(context);
	if (busy === null) return unavailable('repository-busy', 'Could not inspect the Git repository state.');
	if (busy) return unavailable('repository-busy');

	const branch = await gitInRepository(context, ['symbolic-ref', '-q', 'HEAD']);
	if (branch.exitCode !== 0) return unavailable('detached-head', commandDetail(branch));

	const conflicts = await gitInRepository(context, ['ls-files', '--unmerged']);
	if (conflicts.exitCode !== 0) return unavailable('repository-busy', commandDetail(conflicts));
	if (conflicts.stdout.trim()) return unavailable('conflict');

	const head = await gitInRepository(context, ['rev-parse', '--verify', 'HEAD']);
	if (head.errorCode || head.timedOut) return unavailable('repository-busy', commandDetail(head));
	const hasHead = head.exitCode === 0;

	const blobState = await worktreeBlobMatchesHead(context, hasHead);
	if (!blobState) return unavailable('verification-failed', 'Could not hash the note through Git.');
	if (blobState.matches) {
		return cleanVersion(context, app, file, expectedSource);
	}

	const indexEntry = await gitInRepository(context, [
		'ls-files',
		'--error-unmatch',
		'--',
		context.noteRelativePath
	]);
	if (indexEntry.errorCode || indexEntry.timedOut || (indexEntry.exitCode !== 0 && indexEntry.exitCode !== 1)) {
		return unavailable('repository-busy', commandDetail(indexEntry));
	}
	const knownToIndex = indexEntry.exitCode === 0;
	const needsIntentToAdd = !blobState.headHasPath && !knownToIndex;
	const stagedNoteDiffers = await stagedNoteDiffersFromWorktree(context);
	if (stagedNoteDiffers === null) {
		return unavailable('verification-failed', 'Could not compare the staged and working note.');
	}
	if (stagedNoteDiffers) return unavailable('staged-note');

	if (needsIntentToAdd) {
		const ignored = await gitInRepository(context, [
			'check-ignore',
			'-q',
			'--',
			context.noteRelativePath
		]);
		if (ignored.exitCode === 0) return unavailable('ignored');
		if (ignored.exitCode !== 1) return unavailable('commit-failed', commandDetail(ignored));
	}

	// `git var GIT_AUTHOR_IDENT` may silently invent a host-local email address.
	// Require an identity the user explicitly configured instead.
	const userName = await gitInRepository(context, ['config', '--get', 'user.name']);
	const userEmail = await gitInRepository(context, ['config', '--get', 'user.email']);
	if (
		userName.exitCode !== 0
		|| userEmail.exitCode !== 0
		|| !userName.stdout.trim()
		|| !userEmail.stdout.trim()
	) {
		return unavailable('identity-missing', commandDetail(userName) ?? commandDetail(userEmail));
	}

	if (!await sourceStillMatches(app, file, expectedSource)) {
		return unavailable('source-changed');
	}

	let addedIntent = false;
	if (needsIntentToAdd) {
		const addIntent = await gitInRepository(context, [
			'add',
			'--intent-to-add',
			'--',
			context.noteRelativePath
		]);
		if (addIntent.exitCode !== 0) return unavailable('commit-failed', commandDetail(addIntent));
		addedIntent = true;
	}

	const safeName = file.basename.replace(/[\r\n]+/g, ' ').slice(0, 160) || 'note';
	const commitResult = await gitInRepository(context, [
		'commit',
		'--only',
		'-m',
		`Publish ${safeName} with Omnighost`,
		'--',
		context.noteRelativePath
	]);
	if (commitResult.exitCode !== 0) {
		if (addedIntent) {
			await gitInRepository(context, ['reset', '-q', '--', context.noteRelativePath]);
		}
		return unavailable('commit-failed', commandDetail(commitResult));
	}

	const committedHead = await gitInRepository(context, ['rev-parse', '--verify', 'HEAD']);
	const commit = stripFinalLineEnding(committedHead.stdout);
	const verifiedBlob = await worktreeBlobMatchesHead(context, true);
	if (!await sourceStillMatches(app, file, expectedSource)) {
		return unavailable('source-changed');
	}
	if (
		committedHead.exitCode !== 0
		|| !commit
		|| !verifiedBlob?.matches
	) {
		return unavailable('verification-failed', commandDetail(committedHead));
	}

	const previous = await previousNoteCommit(context, commit);
	return previous
		? { kind: 'git', commit, previousNoteCommit: previous, createdCommit: true }
		: { kind: 'git', commit, createdCommit: true };
}

/**
 * Ensure the exact current note is represented by a Git commit before publication.
 *
 * This function never pushes, changes Git configuration, bypasses hooks, or commits
 * unrelated paths. Mobile and every unsafe Git state return a typed fallback result
 * so the caller can publish using a platform-neutral content hash instead.
 */
export async function ensureNoteVersioned(
	app: App,
	file: TFile,
	expectedSource: string
): Promise<NoteVersionResult> {
	if (!await sourceStillMatches(app, file, expectedSource)) {
		return unavailable('source-changed');
	}
	if (!Platform.isDesktopApp) return unavailable('mobile');
	if (!(app.vault.adapter instanceof FileSystemAdapter)) return unavailable('no-filesystem');

	let runtime: DesktopRuntime;
	try {
		runtime = await loadDesktopRuntime();
	} catch (error) {
		return unavailable('git-unavailable', error instanceof Error ? error.message : undefined);
	}

	let noteAbsolutePath: string;
	try {
		const unresolvedPath = runtime.path.resolve(app.vault.adapter.getBasePath(), file.path);
		noteAbsolutePath = await runtime.fs.realpath(unresolvedPath);
	} catch (error) {
		return unavailable('no-filesystem', error instanceof Error ? error.message : undefined);
	}

	const repository = await runGit(runtime, [
		'-C',
		runtime.path.dirname(noteAbsolutePath),
		'rev-parse',
		'--show-toplevel'
	]);
	if (repository.errorCode === 'ENOENT' || repository.errorCode === 'EACCES') {
		return unavailable('git-unavailable', commandDetail(repository));
	}
	if (repository.exitCode !== 0) return unavailable('not-repository', commandDetail(repository));

	let repositoryRoot: string;
	try {
		repositoryRoot = await runtime.fs.realpath(stripFinalLineEnding(repository.stdout));
	} catch (error) {
		return unavailable('not-repository', error instanceof Error ? error.message : undefined);
	}

	const relativePath = runtime.path.relative(repositoryRoot, noteAbsolutePath);
	if (
		!relativePath
		|| relativePath === '..'
		|| relativePath.startsWith(`..${runtime.path.sep}`)
		|| runtime.path.isAbsolute(relativePath)
	) {
		return unavailable('path-outside-repository');
	}
	const noteRelativePath = relativePath.split(runtime.path.sep).join('/');
	const context: RepositoryContext = {
		runtime,
		repositoryRoot,
		noteAbsolutePath,
		noteRelativePath
	};

	return withRepositoryLock(repositoryRoot, () =>
		ensureVersionInRepository(context, app, file, expectedSource));
}
