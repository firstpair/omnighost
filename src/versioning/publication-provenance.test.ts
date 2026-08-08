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
	resolvePublicationProvenanceImprint,
	resolvePublicationProvenanceVisibility,
	selectPublicationVersion,
	stableJsonStringify,
	storedPublicationProvenanceMatches,
	stripRenderedPublicationProvenanceHtml,
	stripTrailingPublicationProvenance,
	type ManagedPublicationInput
} from './publication-provenance';
import type { PublicationProvenancePresentation } from '../types';

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

void test('all visibility modes replace or remove one trailing provenance card', async () => {
	const prepared = await preparePublicationProvenance(
		publication(),
		'visible-hash',
		{ gitCommit: GIT_COMMIT }
	);
	const visibleHash = extractTrailingVisiblePublicationProvenance(prepared.lexical);
	assert.deepEqual(visibleHash, {
		mode: 'visible-hash',
		presentation: { delimiter: 'double', fontSize: 'tiny', italic: false },
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
		mode: 'visible-credit',
		presentation: { delimiter: 'double', fontSize: 'tiny', italic: false }
	});

	const hiddenLexical = applyVisiblePublicationProvenance(
		creditLexical,
		'hidden',
		prepared.provenance
	);
	assert.equal(extractTrailingVisiblePublicationProvenance(hiddenLexical), null);
	assert.equal(canonicalManagedPublicationJson(publication({ lexical: hiddenLexical })), canonicalManagedPublicationJson(publication()));
});

void test('delimiter, font size, and italic choices render canonically and do not affect the content hash', async () => {
	const delimiters = ['none', 'single', 'double'] as const;
	const fontSizes = ['normal', 'small', 'tiny'] as const;
	const baseHash = await hashManagedPublication(publication());

	for (const delimiter of delimiters) {
		for (const fontSize of fontSizes) {
			for (const italic of [false, true]) {
				const presentation: PublicationProvenancePresentation = { delimiter, fontSize, italic };
				const prepared = await preparePublicationProvenance(
					publication(),
					'visible-hash',
					{ gitCommit: GIT_COMMIT },
					presentation
				);
				assert.deepEqual(extractTrailingVisiblePublicationProvenance(prepared.lexical), {
					mode: 'visible-hash',
					presentation,
					publicationSha256: prepared.publicationSha256,
					gitCommitDisplay: GIT_COMMIT.slice(0, 12)
				});
				const parsed = JSON.parse(prepared.lexical) as { root: { children: Array<{ html?: string }> } };
				const html = parsed.root.children[parsed.root.children.length - 1].html ?? '';
				assert.equal(html.includes('<hr '), delimiter !== 'none');
				if (delimiter === 'single') assert.match(html, /border-top:1px solid/);
				if (delimiter === 'double') assert.match(html, /border-top:3px double/);
				assert.match(html, new RegExp(`data-omnighost-size="${fontSize}"`));
				const expectedSize = fontSize === 'normal' ? '1em' : fontSize === 'small' ? '0.8em' : '0.625em';
				assert.match(html, new RegExp(`font-size:${expectedSize}`));
				assert.match(html, new RegExp(`font-style:${italic ? 'italic' : 'normal'}`));
				assert.equal(await hashManagedPublication(publication({ lexical: prepared.lexical })), baseHash);

				const appliedAgain = applyVisiblePublicationProvenance(
					prepared.lexical,
					'visible-hash',
					prepared.provenance,
					presentation
				);
				assert.equal(appliedAgain, prepared.lexical);
			}
		}
	}
});

void test('per-note visibility inherits global mode unless explicit, and drafts stay hidden', () => {
	assert.equal(resolvePublicationProvenanceVisibility('default', 'visible-credit', false), 'visible-credit');
	assert.equal(resolvePublicationProvenanceVisibility('default', 'hidden', false), 'hidden');
	assert.equal(resolvePublicationProvenanceVisibility('visible-hash', 'hidden', false), 'visible-hash');
	assert.equal(resolvePublicationProvenanceVisibility('visible-credit', 'hidden', false), 'visible-credit');
	assert.equal(resolvePublicationProvenanceVisibility('hidden', 'visible-hash', false), 'hidden');
	assert.equal(resolvePublicationProvenanceVisibility('visible-hash', 'visible-hash', true), 'hidden');

	assert.deepEqual(resolvePublicationProvenanceImprint(
		false,
		'visible-credit',
		'visible-hash',
		{ delimiter: 'none', fontSize: 'normal', italic: true },
		false
	), {
		visibility: 'visible-hash',
		presentation: { delimiter: 'double', fontSize: 'tiny', italic: false }
	});
	assert.deepEqual(resolvePublicationProvenanceImprint(
		true,
		'visible-credit',
		'visible-hash',
		{ delimiter: 'none', fontSize: 'normal', italic: true },
		false
	), {
		visibility: 'visible-credit',
		presentation: { delimiter: 'none', fontSize: 'normal', italic: true }
	});
});

void test('strict legacy 0.13 paragraph is recognized, stripped, and upgraded', () => {
	const parsed = JSON.parse(BASE_LEXICAL) as { root: { children: unknown[] } };
	parsed.root.children.push({
		type: 'paragraph',
		version: 1,
		children: [
			{ type: 'extended-text', text: 'published with ' },
			{
				type: 'link',
				url: OMNIGHOST_REPOSITORY_URL,
				title: null,
				children: [{ type: 'extended-text', text: 'omnighost' }]
			}
		],
		direction: 'ltr',
		format: '',
		indent: 0
	});
	const legacyLexical = JSON.stringify(parsed);
	assert.deepEqual(extractTrailingVisiblePublicationProvenance(legacyLexical), {
		mode: 'visible-credit',
		presentation: { delimiter: 'none', fontSize: 'normal', italic: false }
	});
	const stripped = stripTrailingPublicationProvenance(legacyLexical);
	assert.equal(stripped.removed, true);
	assert.equal(extractTrailingVisiblePublicationProvenance(stripped.lexical), null);
	const upgraded = applyVisiblePublicationProvenance(legacyLexical, 'visible-credit', createPublicationProvenance('a'.repeat(64)));
	assert.deepEqual(extractTrailingVisiblePublicationProvenance(upgraded), {
		mode: 'visible-credit',
		presentation: { delimiter: 'double', fontSize: 'tiny', italic: false }
	});
});

void test('manual changes to the owned card are detected instead of trusted', async () => {
	const prepared = await preparePublicationProvenance(
		publication(),
		'visible-hash',
		{ gitCommit: GIT_COMMIT }
	);
	const parsed = JSON.parse(prepared.lexical) as { root: { children: Array<{ html?: string }> } };
	const last = parsed.root.children[parsed.root.children.length - 1];
	if (!last.html) throw new Error('Expected generated provenance HTML card');
	last.html = last.html.replace('font-size:0.625em', 'font-size:2em');
	assert.equal(extractTrailingVisiblePublicationProvenance(JSON.stringify(parsed)), null);
	assert.equal(publicationLexicalDocumentsEqual(prepared.lexical, JSON.stringify(parsed)), false);
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

void test('rendered provenance is removed from inbound Ghost HTML only at the end', async () => {
	const prefix = '<p>Keep this paragraph.</p>';
	const credit = '<p>published with <a href="https://github.com/firstpair/omnighost">omnighost</a></p>';
	const version = `<p>published with <a title="omnighost-provenance-v1" href="${OMNIGHOST_REPOSITORY_URL}">omnighost</a> · Git <a href="${SOURCE_URL}">${GIT_COMMIT.slice(0, 12)}</a> · SHA-256 ${'a'.repeat(64)}</p>`;
	assert.equal(stripRenderedPublicationProvenanceHtml(prefix + credit), prefix);
	assert.equal(stripRenderedPublicationProvenanceHtml(prefix + version), prefix);
	assert.equal(stripRenderedPublicationProvenanceHtml(credit + prefix), credit + prefix);
	assert.equal(stripRenderedPublicationProvenanceHtml('<p>published with omnighost</p>'), '<p>published with omnighost</p>');

	const prepared = await preparePublicationProvenance(publication(), 'visible-hash', { gitCommit: GIT_COMMIT });
	const lexical = JSON.parse(prepared.lexical) as { root: { children: Array<{ html?: string }> } };
	const card = lexical.root.children[lexical.root.children.length - 1].html;
	if (!card) throw new Error('Expected rendered provenance card');
	assert.equal(stripRenderedPublicationProvenanceHtml(`${prefix}<!--kg-card-begin: html-->${card}<!--kg-card-end: html-->`), prefix);
	assert.equal(stripRenderedPublicationProvenanceHtml(`${card}${prefix}`), `${card}${prefix}`);
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

void test('presentation drift forces an update while hidden mode ignores presentation', async () => {
	const desired = publication();
	const currentPrepared = await preparePublicationProvenance(
		desired,
		'visible-hash',
		{},
		{ delimiter: 'double', fontSize: 'tiny', italic: false }
	);
	const changedPresentation = await compareManagedPublicationState({
		desired,
		current: publication({ lexical: currentPrepared.lexical }),
		currentCodeInjectionHead: currentPrepared.hiddenBlock,
		visibility: 'visible-hash',
		presentation: { delimiter: 'single', fontSize: 'small', italic: true }
	});
	assert.equal(changedPresentation.contentMatches, true);
	assert.equal(changedPresentation.visibleProvenanceMatches, false);
	assert.equal(changedPresentation.unchanged, false);

	const hidden = await preparePublicationProvenance(desired, 'hidden');
	const hiddenComparison = await compareManagedPublicationState({
		desired,
		current: desired,
		currentCodeInjectionHead: hidden.hiddenBlock,
		visibility: 'hidden',
		presentation: { delimiter: 'none', fontSize: 'normal', italic: true }
	});
	assert.equal(hiddenComparison.visibleProvenanceMatches, true);
	assert.equal(hiddenComparison.unchanged, true);
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
