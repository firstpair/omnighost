/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pluginHost, reloadPlugin } from './self-reload';

void test('a host without the internal plugin manager is reported, not assumed', () => {
	assert.equal(pluginHost(null), null);
	assert.equal(pluginHost({}), null);
	assert.equal(pluginHost({ plugins: {} }), null);
	assert.equal(pluginHost({ plugins: { disablePlugin: () => Promise.resolve() } }), null);
	const plugins = { disablePlugin: () => Promise.resolve(), enablePlugin: () => Promise.resolve() };
	assert.equal(pluginHost({ plugins }), plugins);
});

void test('reload disables, refreshes the cached version, then enables', async () => {
	const calls: string[] = [];
	const manifests: Record<string, { version?: string }> = { omnighost: { version: '0.17.2' } };
	const host = {
		manifests,
		disablePlugin: (id: string) => { calls.push(`disable ${id}`); return Promise.resolve(); },
		enablePlugin: (id: string) => {
			calls.push(`enable ${id} at ${manifests[id].version}`);
			return Promise.resolve();
		}
	};
	await reloadPlugin(host, 'omnighost', '0.17.3');
	assert.deepEqual(calls, ['disable omnighost', 'enable omnighost at 0.17.3']);
});

void test('a missing manifest cache does not block the reload, and a failed enable surfaces', async () => {
	const calls: string[] = [];
	await reloadPlugin({
		disablePlugin: () => { calls.push('disable'); return Promise.resolve(); },
		enablePlugin: () => { calls.push('enable'); return Promise.resolve(); }
	}, 'omnighost', '0.17.3');
	assert.deepEqual(calls, ['disable', 'enable']);

	await assert.rejects(reloadPlugin({
		disablePlugin: () => Promise.resolve(),
		enablePlugin: () => Promise.reject(new Error('load failed'))
	}, 'omnighost'), /load failed/);
});
