/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
	OMNIGHOST_REPOSITORY_URL,
	applyVisiblePublicationProvenance,
	buildHiddenPublicationProvenance,
	canonicalManagedPublicationJson,
	compareManagedPublicationState,
	createPublicationProvenance,
	extractHiddenPublicationProvenance,
	extractTrailingVisiblePublicationProvenance,
	hashManagedPublication,
	mergeHiddenPublicationProvenance,
	preparePublicationProvenance,
	publicationLexicalDocumentsEqual,
	selectPublicationVersion,
	stableJsonStringify,
	storedPublicationProvenanceMatches,
	stripRenderedPublicationProvenanceHtml,
	stripTrailingPublicationProvenance,
	type ManagedPublicationInput
} from './publication-provenance';

const BASE_LEXICAL = JSON.stringify({
	root: {
		type: 'root',
		format: '',
		indent: 0,
		version: 1,
		children: [{
			type: 'paragraph',
			version: 1,
			children: [{
				type: 'extended-text',
				text: 'A durable paragraph.',
				version: 1,
				format: 0,
				detail: 0,
				mode: 'normal',
				style: ''
			}],
			direction: 'ltr',
			format: '',
			indent: 0
		}],
		direction: 'ltr'
	}
});

const GIT_COMMIT = '1234567890abcdef1234567890abcdef12345678';
const SOURCE_URL = 'https://github.com/example/notes/blob/1234567890abcdef1234567890abcdef12345678/post.md?x=1&y=2';

function publication(overrides: Partial<ManagedPublicationInput> = {}): ManagedPublicationInput {
	return {
		title: 'Durable post',
		lexical: BASE_LEXICAL,
		status: 'published',
		visibility: 'public',
		featured: false,
		slug: 'durable-post',
		custom_excerpt: null,
		feature_image: null,
		tags: [{ name: 'First' }, { name: 'Second' }],
		...overrides
	};
}

void test('stable JSON and publication hashes ignore object key ordering', async () => {
	assert.equal(
		stableJsonStringify({ z: 1, a: { d: 2, c: 3 } }),
		stableJsonStringify({ a: { c: 3, d: 2 }, z: 1 })
	);

	const reorderedLexical = JSON.stringify({
		root: {
			direction: 'ltr',
			children: [{
				indent: 0,
				format: '',
				direction: 'ltr',
				children: [{
					style: '',
					mode: 'normal',
					detail: 0,
					format: 0,
					version: 1,
					text: 'A durable paragraph.',
					type: 'extended-text'
				}],
				version: 1,
				type: 'paragraph'
			}],
			version: 1,
			indent: 0,
			format: '',
			type: 'root'
		}
	});

	assert.equal(
		await hashManagedPublication(publication()),
		await hashManagedPublication(publication({ lexical: reorderedLexical }))
	);
});

void test('all visibility modes replace or remove one trailing provenance paragraph', async () => {
	const prepared = await preparePublicationProvenance(
		publication(),
		'visible-hash',
		{ gitCommit: GIT_COMMIT }
	);
	const visibleHash = extractTrailingVisiblePublicationProvenance(prepared.lexical);
	assert.deepEqual(visibleHash, {
		mode: 'visible-hash',
		publicationSha256: prepared.publicationSha256,
		gitCommitDisplay: GIT_COMMIT.slice(0, 12)
	});
	assert.match(prepared.lexical, new RegExp(OMNIGHOST_REPOSITORY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

	const creditLexical = applyVisiblePublicationProvenance(
		prepared.lexical,
		'visible-credit',
		prepared.provenance
	);
	assert.deepEqual(extractTrailingVisiblePublicationProvenance(creditLexical), {
		mode: 'visible-credit'
	});

	const hiddenLexical = applyVisiblePublicationProvenance(
		creditLexical,
		'hidden',
		prepared.provenance
	);
	assert.equal(extractTrailingVisiblePublicationProvenance(hiddenLexical), null);
	assert.equal(canonicalManagedPublicationJson(publication({ lexical: hiddenLexical })), canonicalManagedPublicationJson(publication()));
});

void test('strict legacy visible shape can be stripped after an HTML round trip loses the link title', () => {
	const provenance = createPublicationProvenance('a'.repeat(64));
	const visible = applyVisiblePublicationProvenance(BASE_LEXICAL, 'visible-credit', provenance);
	const parsed = JSON.parse(visible) as { root: { children: Array<{ children?: Array<{ title?: string | null }> }> } };
	const last = parsed.root.children[parsed.root.children.length - 1];
	const link = last.children?.find((child) => 'title' in child);
	if (link) link.title = null;

	const stripped = stripTrailingPublicationProvenance(JSON.stringify(parsed));
	assert.equal(stripped.removed, true);
	assert.equal(extractTrailingVisiblePublicationProvenance(stripped.lexical), null);
	assert.equal(publicationLexicalDocumentsEqual(visible, JSON.stringify(parsed)), true);
});

void test('a linked or rewritten Git display is not equal to the plain generated Git hash', async () => {
	const prepared = await preparePublicationProvenance(
		publication(),
		'visible-hash',
		{ gitCommit: GIT_COMMIT }
	);
	const parsed = JSON.parse(prepared.lexical) as {
		root: { children: Array<{ children?: Array<Record<string, unknown>> }> };
	};
	const last = parsed.root.children[parsed.root.children.length - 1];
	const shortCommit = GIT_COMMIT.slice(0, 12);
	const index = last.children?.findIndex((child) => child.text === shortCommit) ?? -1;
	assert.notEqual(index, -1);
	const textNode = last.children?.[index];
	if (!last.children || !textNode) throw new Error('Expected generated Git text node');
	last.children[index] = {
		type: 'link',
		url: SOURCE_URL,
		rel: null,
		target: null,
		title: null,
		version: 1,
		children: [textNode],
		direction: 'ltr'
	};

	assert.equal(publicationLexicalDocumentsEqual(prepared.lexical, JSON.stringify(parsed)), false);

	const wrapped = JSON.parse(prepared.lexical) as {
		root: { children: Array<{ children?: Array<Record<string, unknown>> }> };
	};
	const wrappedChildren = wrapped.root.children[wrapped.root.children.length - 1].children;
	if (!wrappedChildren) throw new Error('Expected generated provenance children');
	const gitPrefixIndex = wrappedChildren.findIndex((child) => child.text === ' · Git ');
	assert.notEqual(gitPrefixIndex, -1);
	const wrappedNodes = wrappedChildren.splice(gitPrefixIndex, 2, {
		type: 'link',
		url: 'javascript:alert(1)',
		rel: null,
		target: null,
		title: null,
		version: 1,
		children: wrappedChildren.slice(gitPrefixIndex, gitPrefixIndex + 2),
		direction: 'ltr'
	});
	assert.equal(wrappedNodes.length, 2);
	assert.equal(publicationLexicalDocumentsEqual(prepared.lexical, JSON.stringify(wrapped)), false);
});

void test('similar author text without the exact repository link is not stripped', () => {
	const parsed = JSON.parse(BASE_LEXICAL) as { root: { children: unknown[] } };
	parsed.root.children.push({
		type: 'paragraph',
		children: [{ type: 'extended-text', text: 'published with omnighost' }]
	});
	const lexical = JSON.stringify(parsed);
	assert.deepEqual(stripTrailingPublicationProvenance(lexical), { lexical, removed: false });
});

void test('rendered provenance is removed from inbound Ghost HTML only at the end', () => {
	const prefix = '<p>Keep this paragraph.</p>';
	const credit = '<p>published with <a href="https://github.com/firstpair/omnighost">omnighost</a></p>';
	const version = `<p>published with <a title="omnighost-provenance-v1" href="${OMNIGHOST_REPOSITORY_URL}">omnighost</a> · Git <a href="${SOURCE_URL}">${GIT_COMMIT.slice(0, 12)}</a> · SHA-256 ${'a'.repeat(64)}</p>`;
	assert.equal(stripRenderedPublicationProvenanceHtml(prefix + credit), prefix);
	assert.equal(stripRenderedPublicationProvenanceHtml(prefix + version), prefix);
	assert.equal(stripRenderedPublicationProvenanceHtml(credit + prefix), credit + prefix);
	assert.equal(stripRenderedPublicationProvenanceHtml('<p>published with omnighost</p>'), '<p>published with omnighost</p>');
});

void test('hidden metadata round-trips and preserves unrelated code injection bytes', () => {
	const provenance = createPublicationProvenance('b'.repeat(64), { gitCommit: GIT_COMMIT });
	const block = buildHiddenPublicationProvenance(provenance);
	assert.deepEqual(extractHiddenPublicationProvenance(block), provenance);

	const original = '<script data-value="x=1&amp;y=2">window.keep = true;</script>\r\n';
	const merged = mergeHiddenPublicationProvenance(original, provenance);
	assert.equal(merged.slice(0, original.length), original);
	assert.equal(mergeHiddenPublicationProvenance(merged, provenance), merged);

	const updated = createPublicationProvenance('c'.repeat(64));
	const prefix = 'PREFIX\u0000';
	const suffix = '\u0000SUFFIX';
	const wrapped = `${prefix}${merged}${suffix}`;
	const replaced = mergeHiddenPublicationProvenance(wrapped, updated);
	assert.equal(replaced.startsWith(prefix + original), true);
	assert.equal(replaced.endsWith(suffix), true);
	assert.deepEqual(extractHiddenPublicationProvenance(replaced), updated);
});

void test('an existing Git commit stays attached to the same publication digest', async () => {
	const existing = await preparePublicationProvenance(
		publication(),
		'visible-hash',
		{ gitCommit: GIT_COMMIT }
	);
	const bookkeepingCommit = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
	const desiredSameContent = await preparePublicationProvenance(
		publication(),
		'visible-hash',
		{ gitCommit: bookkeepingCommit }
	);
	const currentVisible = extractTrailingVisiblePublicationProvenance(existing.lexical);
	const retained = selectPublicationVersion(desiredSameContent.provenance, existing.hiddenBlock, {
		allowedExistingGitCommit: GIT_COMMIT,
		currentVisible
	});
	assert.deepEqual(retained, { gitCommit: GIT_COMMIT });
	const stableComparison = await compareManagedPublicationState({
		desired: publication(),
		current: publication({ lexical: existing.lexical }),
		currentCodeInjectionHead: existing.hiddenBlock,
		visibility: 'visible-hash',
		gitCommit: retained.gitCommit
	});
	assert.equal(stableComparison.unchanged, true);
	const retainedFastPath = await preparePublicationProvenance(
		publication(),
		'visible-hash',
		retained
	);
	assert.equal(storedPublicationProvenanceMatches(
		existing.lexical,
		existing.hiddenBlock,
		retainedFastPath.lexical,
		retainedFastPath.hiddenBlock
	), true);
	assert.deepEqual(
		selectPublicationVersion(desiredSameContent.provenance, existing.hiddenBlock, { currentVisible }),
		{ gitCommit: bookkeepingCommit }
	);

	const tamperedCommit = 'ffffffffffffffffffffffffffffffffffffffff';
	const tamperedHead = buildHiddenPublicationProvenance(createPublicationProvenance(
		existing.publicationSha256,
		{ gitCommit: tamperedCommit }
	));
	assert.deepEqual(
		selectPublicationVersion(desiredSameContent.provenance, tamperedHead, {
			allowedExistingGitCommit: GIT_COMMIT,
			currentVisible
		}),
		{ gitCommit: bookkeepingCommit }
	);

	const desiredChangedContent = await preparePublicationProvenance(
		publication({ title: 'Changed publication' }),
		'visible-hash',
		{ gitCommit: bookkeepingCommit }
	);
	assert.deepEqual(
		selectPublicationVersion(desiredChangedContent.provenance, existing.hiddenBlock),
		{ gitCommit: bookkeepingCommit }
	);
});

void test('duplicate owned blocks collapse without changing bytes between or around them', () => {
	const first = createPublicationProvenance('d'.repeat(64));
	const second = createPublicationProvenance('e'.repeat(64));
	const source = `before${buildHiddenPublicationProvenance(first)}MIDDLE${buildHiddenPublicationProvenance(first)}after`;
	const merged = mergeHiddenPublicationProvenance(source, second);
	assert.equal(merged, `before${buildHiddenPublicationProvenance(second)}MIDDLEafter`);
});

void test('stale embedded metadata never hides a Ghost-side content change', async () => {
	const desired = publication();
	const prepared = await preparePublicationProvenance(desired, 'hidden');
	const stale = createPublicationProvenance('0'.repeat(64));

	const comparison = await compareManagedPublicationState({
		desired,
		current: desired,
		currentCodeInjectionHead: buildHiddenPublicationProvenance(stale),
		visibility: 'hidden'
	});
	assert.equal(comparison.contentMatches, true);
	assert.equal(comparison.embeddedDigestIsStale, true);
	assert.equal(comparison.unchanged, false);

	const currentHead = buildHiddenPublicationProvenance(prepared.provenance);
	const unchanged = await compareManagedPublicationState({
		desired,
		current: desired,
		currentCodeInjectionHead: currentHead,
		visibility: 'hidden'
	});
	assert.equal(unchanged.unchanged, true);
	assert.equal(unchanged.embeddedDigestMatchesCurrent, true);
});

void test('stored-provenance fast path can be disabled to catch a Ghost-side edit', async () => {
	const desired = publication();
	const prepared = await preparePublicationProvenance(desired, 'visible-credit');
	const changedCurrent = publication({ title: 'Changed only in Ghost', lexical: prepared.lexical });

	assert.equal(storedPublicationProvenanceMatches(
		changedCurrent.lexical,
		prepared.hiddenBlock,
		prepared.lexical,
		prepared.hiddenBlock
	), true);

	const verified = await compareManagedPublicationState({
		desired,
		current: changedCurrent,
		currentCodeInjectionHead: prepared.hiddenBlock,
		visibility: 'visible-credit'
	});
	assert.equal(verified.contentMatches, false);
	assert.equal(verified.unchanged, false);
});

void test('managed metadata and tag order affect publication hashes', async () => {
	const baseHash = await hashManagedPublication(publication());
	assert.notEqual(baseHash, await hashManagedPublication(publication({ title: 'Changed title' })));
	assert.notEqual(baseHash, await hashManagedPublication(publication({ custom_excerpt: 'Changed excerpt' })));
	assert.notEqual(baseHash, await hashManagedPublication(publication({ tags: [{ name: 'Second' }, { name: 'First' }] })));
});

void test('scheduled timestamps canonicalize equivalent time-zone representations', () => {
	const first = canonicalManagedPublicationJson(publication({
		status: 'scheduled',
		published_at: '2026-07-16T12:00:00-07:00'
	}));
	const second = canonicalManagedPublicationJson(publication({
		status: 'scheduled',
		published_at: '2026-07-16T19:00:00.000Z'
	}));
	assert.equal(first, second);
});
