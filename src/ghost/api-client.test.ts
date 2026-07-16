/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { preparePublicationProvenance } from '../versioning/publication-provenance';
import type { GhostPost, GhostPostWrite } from '../types';

interface RequestOptions {
	method?: string;
}

interface RequestResponse {
	status: number;
	text: string;
	json: unknown;
}

interface GhostApiClientLike {
	updatePost(
		postId: string,
		post: GhostPostWrite,
		options: { visibility: 'visible-hash'; verifyRemoteContent: boolean }
	): Promise<{ post: GhostPost; changed: boolean }>;
}

interface ApiClientModule {
	GhostAPIClient: new (url: string, key: string, app: unknown) => GhostApiClientLike;
}

type RequestHandler = (options: RequestOptions) => Promise<RequestResponse>;

async function loadApiClient(): Promise<ApiClientModule> {
	const result = await build({
		entryPoints: [path.join(process.cwd(), 'src/ghost/api-client.ts')],
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
						export async function requestUrl(options) {
							return globalThis.__omnighostApiRequest(options);
						}
					`
				}));
			}
		}]
	});
	const source = result.outputFiles[0]?.text;
	if (!source) throw new Error('Failed to bundle Ghost API client for tests');
	return await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as ApiClientModule;
}

function rawLexical(): string {
	return JSON.stringify({
		root: {
			type: 'root',
			version: 1,
			format: '',
			indent: 0,
			direction: null,
			children: []
		}
	});
}

void test('an unchanged inherited Git publication performs no Ghost PUT', async () => {
	const gitCommit = '0123456789abcdef0123456789abcdef01234567';
	const base: GhostPostWrite = {
		title: 'Imported title',
		lexical: rawLexical(),
		status: 'published',
		visibility: 'public',
		featured: false,
		slug: 'imported',
		custom_excerpt: 'Summary',
		feature_image: null,
		tags: [{ name: 'Test' }],
		codeinjection_head: null
	};
	const provenance = await preparePublicationProvenance(base, 'visible-hash', { gitCommit });
	const outbound: GhostPostWrite = {
		...base,
		lexical: provenance.lexical,
		codeinjection_head: provenance.hiddenBlock
	};
	const current: GhostPost = {
		id: 'post-id',
		uuid: 'post-uuid',
		title: outbound.title,
		slug: outbound.slug,
		lexical: outbound.lexical,
		html: '',
		status: 'published',
		visibility: 'public',
		featured: false,
		feature_image: null,
		excerpt: 'Summary',
		custom_excerpt: 'Summary',
		codeinjection_head: outbound.codeinjection_head,
		tags: [{ name: 'Test' }],
		published_at: '2026-07-15T12:00:00.000Z',
		updated_at: '2026-07-15T12:00:00.000Z',
		created_at: '2026-07-15T12:00:00.000Z',
		url: 'https://example.com/imported/'
	};
	const methods: string[] = [];
	const runtime = globalThis as typeof globalThis & { __omnighostApiRequest?: RequestHandler };
	runtime.__omnighostApiRequest = async (options) => {
		methods.push(options.method ?? 'GET');
		return { status: 200, text: '', json: { posts: [current] } };
	};
	try {
		const module = await loadApiClient();
		const client = new module.GhostAPIClient(
			'https://example.com',
			`0123456789abcdef01234567:${'00'.repeat(32)}`,
			{}
		);
		const result = await client.updatePost('post-id', outbound, {
			visibility: 'visible-hash',
			verifyRemoteContent: true
		});
		assert.equal(result.changed, false);
		assert.deepEqual(methods, ['GET']);
	} finally {
		delete runtime.__omnighostApiRequest;
	}
});
