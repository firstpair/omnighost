/* eslint-disable import/no-nodejs-modules -- This file runs under Node's focused test runner, not in Obsidian. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeGhostSiteUrl } from './url';

void test('defaults a bare Ghost site address to HTTPS', () => {
	assert.equal(normalizeGhostSiteUrl('makeblog.example.com'), 'https://makeblog.example.com');
});

void test('preserves an explicitly configured HTTP scheme', () => {
	assert.equal(normalizeGhostSiteUrl('http://localhost:2368'), 'http://localhost:2368');
});

void test('trims whitespace and trailing slashes', () => {
	assert.equal(normalizeGhostSiteUrl('  https://makeblog.example.com///  '), 'https://makeblog.example.com');
});
