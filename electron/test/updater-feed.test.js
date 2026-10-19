// electron/updater-feed.js — pure feed-URL selection per channel/os. No
// Electron needed. Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFeed, resolveOs, DEFAULT_BASE } = require('../updater-feed');

test('dev build on macOS → /dev/mac', () => {
  const feed = resolveFeed({ pfDataProfile: 'dev', platform: 'darwin' });
  assert.deepEqual(feed, { channel: 'dev', os: 'mac', url: `${DEFAULT_BASE}/dev/mac` });
});

test('stage build on Windows → /stage/windows', () => {
  const feed = resolveFeed({ pfDataProfile: 'stage', platform: 'win32' });
  assert.deepEqual(feed, { channel: 'stage', os: 'windows', url: `${DEFAULT_BASE}/stage/windows` });
});

test('prod build on macOS → /prod/mac', () => {
  const feed = resolveFeed({ pfDataProfile: 'prod', platform: 'darwin' });
  assert.deepEqual(feed, { channel: 'prod', os: 'mac', url: `${DEFAULT_BASE}/prod/mac` });
});

test('channels never cross: each profile only ever resolves its own folder', () => {
  const dev = resolveFeed({ pfDataProfile: 'dev', platform: 'darwin' });
  const stage = resolveFeed({ pfDataProfile: 'stage', platform: 'darwin' });
  const prod = resolveFeed({ pfDataProfile: 'prod', platform: 'darwin' });
  const urls = new Set([dev.url, stage.url, prod.url]);
  assert.equal(urls.size, 3, 'three distinct channel URLs, none shared');
  for (const u of urls) assert.equal((u.match(/\/(dev|stage|prod)\//g) || []).length, 1);
});

test('no pfDataProfile (plain dev / devapi builds) → updates disabled (null)', () => {
  assert.equal(resolveFeed({ platform: 'darwin' }), null);
  assert.equal(resolveFeed({ pfDataProfile: undefined, platform: 'win32' }), null);
  assert.equal(resolveFeed({ pfDataProfile: '', platform: 'win32' }), null);
});

test('an unpublished OS (e.g. Linux) → updates disabled (null)', () => {
  assert.equal(resolveFeed({ pfDataProfile: 'dev', platform: 'linux' }), null);
  assert.equal(resolveOs('linux'), null);
});

test('a malformed profile (path traversal / junk) is rejected, not passed through', () => {
  assert.equal(resolveFeed({ pfDataProfile: '../etc', platform: 'darwin' }), null);
  assert.equal(resolveFeed({ pfDataProfile: 'dev/mac', platform: 'darwin' }), null);
  assert.equal(resolveFeed({ pfDataProfile: 'a'.repeat(41), platform: 'darwin' }), null);
});

test('profile is case-folded (defensive — real builds always lower-case it)', () => {
  const feed = resolveFeed({ pfDataProfile: 'DEV', platform: 'darwin' });
  assert.equal(feed.channel, 'dev');
});

test('a custom base URL is honoured and trailing slashes are stripped', () => {
  const feed = resolveFeed({ pfDataProfile: 'dev', platform: 'darwin', base: 'https://example.test/updates///' });
  assert.equal(feed.url, 'https://example.test/updates/dev/mac');
});

test('resolveOs maps exactly darwin→mac and win32→windows, nothing else', () => {
  assert.equal(resolveOs('darwin'), 'mac');
  assert.equal(resolveOs('win32'), 'windows');
  assert.equal(resolveOs('linux'), null);
  assert.equal(resolveOs('freebsd'), null);
});
