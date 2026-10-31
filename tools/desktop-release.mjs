#!/usr/bin/env node
/**
 * Desktop release — builds the Electron app for one channel (dev / stage /
 * prod), notarizes the Mac build, and publishes to the DigitalOcean Spaces
 * bucket electron-updater reads from. See docs/DESKTOP-RELEASES.md.
 *
 * Usage:
 *   node tools/desktop-release.mjs --channel dev --version 1.0.1 --mac [--win]
 *   node tools/desktop-release.mjs --finish 1.0.1 --channel dev --mac
 *   node tools/desktop-release.mjs --rollback 1.0.0 --channel dev --mac [--win]
 *
 * Bucket layout (owner's design): `<base>/<channel>/<os>/latest(-mac).yml`
 * (the ACTIVE manifest clients poll) + `<base>/<channel>/<os>/<version>/`
 * (the binaries + blockmaps + an immutable COPY of that version's manifest,
 * used only by --rollback).
 *
 * Notarization is ASYNC (owner: a submission can sit in Apple's queue for
 * hours) — `--mac` submits and returns, it never blocks on Apple:
 *   - dev channel: publishes the SIGNED (not yet notarized) build right
 *     away. `--finish <version>` later staples + re-publishes once Apple
 *     accepts it — existing dev installs just see a same-version republish
 *     at their next check.
 *   - stage / prod: nothing is published until `--finish` — a stage/prod
 *     build is never pushed unnotarized.
 *
 * Credentials: PF_RELEASE_ENDPOINT / PF_RELEASE_BUCKET / PF_RELEASE_PUBLIC_BASE
 * / PF_RELEASE_KEY_ID / PF_RELEASE_SECRET, from the environment or
 * ~/.config/prefrontal/release-spaces.env. NEVER logged, NEVER written
 * anywhere else. After each build this script also greps the packaged
 * app.asar for the key id / secret and refuses to publish if either leaked
 * in (they never should — nothing in electron/ references them).
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist', 'electron');
const STATE_DIR = path.join(ROOT, 'tools', '.release-state');
const NOTARY_PROFILE = 'prefrontal-notary';
const CHANNELS = ['dev', 'stage', 'prod'];

// Every Angular build configuration this script knows how to produce an
// electron bundle from, per channel. `prod` has no backend of its own yet
// (no live production API — see apps/lms/src/environments/environment*.ts);
// it reuses the stage backend's build until the owner wires up a real one,
// at which point add an `electron-prod` Nx configuration + environment file
// and change ONLY this line.
const NX_CONFIG_BY_CHANNEL = { dev: 'electron-dev', stage: 'electron-stage', prod: 'electron-stage' };
// The real shipped app keeps its base identity (in.prefrontal.app /
// "Prefrontal") — only dev/stage test builds get a side-by-side identity so
// they can be installed next to it.
const APP_ID_BY_CHANNEL = { dev: 'in.prefrontal.app.dev', stage: 'in.prefrontal.app.stage', prod: null };
const PRODUCT_NAME_BY_CHANNEL = { dev: 'Prefrontal Dev', stage: 'Prefrontal Stage', prod: null };

function fail(msg) {
  console.error(`[release] ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[release] ${msg}`);
}

// ── CLI args ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { mac: false, win: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--channel') a.channel = argv[++i];
    else if (t === '--version') a.version = argv[++i];
    else if (t === '--mac') a.mac = true;
    else if (t === '--win') a.win = true;
    else if (t === '--finish') a.finish = argv[++i];
    else if (t === '--rollback') a.rollback = argv[++i];
    else if (t === '--win-icon') a.winIcon = argv[++i];
    else if (t === '--skip-notarize') a.skipNotarize = true;
    else if (t === '--base') a.base = argv[++i];
    else fail(`unknown argument "${t}"`);
  }
  if (!a.channel) fail('--channel <dev|stage|prod> is required');
  if (!CHANNELS.includes(a.channel)) fail(`--channel must be one of ${CHANNELS.join(', ')} — channels never cross`);
  if (!a.mac && !a.win) fail('pass --mac and/or --win');
  return a;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
function requireVersion(v, flag) {
  if (!v || !SEMVER_RE.test(v)) fail(`${flag} needs a semver version (e.g. 1.0.1 or 1.0.1-dev.1), got "${v}"`);
  return v;
}

// ── credentials (env, else the owner's local file — NEVER printed) ──────
const CRED_KEYS = ['PF_RELEASE_ENDPOINT', 'PF_RELEASE_BUCKET', 'PF_RELEASE_PUBLIC_BASE', 'PF_RELEASE_KEY_ID', 'PF_RELEASE_SECRET'];
function loadCreds() {
  const env = { ...process.env };
  const envFile = path.join(os.homedir(), '.config', 'prefrontal', 'release-spaces.env');
  if (CRED_KEYS.some((k) => !env[k]) && fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && CRED_KEYS.includes(m[1]) && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  const missing = CRED_KEYS.filter((k) => !env[k]);
  if (missing.length) fail(`missing release credentials: ${missing.join(', ')} (set env vars or ${envFile})`);
  return Object.fromEntries(CRED_KEYS.map((k) => [k, env[k]]));
}

function s3Client(creds) {
  const region = new URL(creds.PF_RELEASE_ENDPOINT).host.split('.')[0] || 'us-east-1';
  return new S3Client({
    endpoint: creds.PF_RELEASE_ENDPOINT,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId: creds.PF_RELEASE_KEY_ID, secretAccessKey: creds.PF_RELEASE_SECRET },
  });
}

const CONTENT_TYPES = {
  '.yml': 'text/yaml; charset=utf-8',
  '.zip': 'application/zip',
  '.dmg': 'application/x-apple-diskimage',
  '.exe': 'application/x-msdownload',
  '.blockmap': 'application/octet-stream',
};
function contentTypeFor(name) {
  const ext = Object.keys(CONTENT_TYPES).find((e) => name.endsWith(e));
  return ext ? CONTENT_TYPES[ext] : 'application/octet-stream';
}

async function putObject(s3, creds, key, body, { cacheControl } = {}) {
  await s3.send(new PutObjectCommand({
    Bucket: creds.PF_RELEASE_BUCKET,
    Key: key,
    Body: body,
    ACL: 'public-read',
    ContentType: contentTypeFor(key),
    CacheControl: cacheControl || 'public, max-age=31536000, immutable',
  }));
  log(`uploaded  ${key}  (${body.length} bytes)`);
}

async function getObjectText(s3, creds, key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: creds.PF_RELEASE_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of r.Body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ── shell helpers ─────────────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, env: process.env, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
}
function runCapture(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, env: process.env, ...opts });
}

// ── package.json version ─────────────────────────────────────────────────
function writeVersion(version) {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  log(`package.json version → ${version}`);
}

// ── build ─────────────────────────────────────────────────────────────────
function nxBuild(channel) {
  const cfg = NX_CONFIG_BY_CHANNEL[channel];
  if (!cfg) fail(`no Nx build configuration mapped for channel "${channel}" — add apps/lms/project.json's "electron-${channel}" configuration + environment file first`);
  run('npx', ['nx', 'build', 'lms', `--configuration=${cfg}`], {
    env: { ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true' },
  });
}

function electronBuilderBuild(a, osName, { base, channel, version }) {
  const args = [osName === 'mac' ? '--mac' : '--win'];
  args.push(`-c.extraMetadata.pfDataProfile=${channel}`);
  if (PRODUCT_NAME_BY_CHANNEL[channel]) args.push(`-c.productName=${PRODUCT_NAME_BY_CHANNEL[channel]}`);
  if (APP_ID_BY_CHANNEL[channel]) args.push(`-c.appId=${APP_ID_BY_CHANNEL[channel]}`);
  args.push('-c.npmRebuild=false');
  if (osName !== 'mac') {
    // electron-builder's default (no arch flag) is the HOST's arch, which on
    // this Mac is arm64 — wrong for real users. Build BOTH real Windows
    // arches into ONE NSIS installer (the installer picks x64 / ia32 at
    // install time), so latest.yml keeps a single .exe and existing 64-bit
    // installs auto-update unchanged. `nsis` only: the portable exe is never
    // published and would double in size with two arches.
    args.splice(1, 0, 'nsis');
    args.push('--x64', '--ia32');
    if (a.winIcon) args.push(`-c.win.icon=${a.winIcon}`, `-c.nsis.installerIcon=${a.winIcon}`, `-c.nsis.installerHeaderIcon=${a.winIcon}`);
  }
  // A publish config is REQUIRED for electron-builder to even write the
  // update-info yml/blockmaps — `--publish never` stops it from also trying
  // to upload anywhere itself (we do that ourselves, after notarizing).
  args.push('-c.publish.provider=generic', `-c.publish.url=${base}/${channel}/${osName}`, '--publish', 'never');
  run('npx', ['electron-builder', ...args]);
}

// ── secret-leak guard ─────────────────────────────────────────────────────
function findAsar(osName) {
  if (osName === 'mac') {
    const dirs = fs.readdirSync(OUT_DIR).filter((d) => d.startsWith('mac'));
    for (const d of dirs) {
      const appDir = path.join(OUT_DIR, d);
      const app = fs.readdirSync(appDir).find((f) => f.endsWith('.app'));
      if (app) {
        const p = path.join(appDir, app, 'Contents', 'Resources', 'app.asar');
        if (fs.existsSync(p)) return p;
      }
    }
  } else {
    // Both arches are packaged: win-unpacked (x64) and win-ia32-unpacked.
    const found = ['win-unpacked', 'win-ia32-unpacked']
      .map((d) => path.join(OUT_DIR, d, 'resources', 'app.asar'))
      .filter((p) => fs.existsSync(p));
    return found.length ? found : null;
  }
  return null;
}

function assertNoLeakedSecrets(osName, creds) {
  const found = findAsar(osName);
  const asarPaths = found ? [].concat(found) : [];
  if (!asarPaths.length) { log(`(no app.asar found to scan for ${osName} — skipping leak guard)`); return; }
  const needles = [creds.PF_RELEASE_KEY_ID, creds.PF_RELEASE_SECRET];
  for (const asarPath of asarPaths) {
    const buf = fs.readFileSync(asarPath);
    for (const needle of needles) {
      if (needle && buf.includes(Buffer.from(needle))) {
        fail(`SECURITY: the packaged app.asar (${asarPath}) contains a release credential — refusing to publish. Find and remove the leak before re-running.`);
      }
    }
  }
  log(`leak guard: ${asarPaths.length} app.asar (${osName}) clean`);
}

// ── notarization (async — never blocks on Apple) ─────────────────────────
function notaryProfileAvailable() {
  const r = runCapture('xcrun', ['notarytool', 'history', '--keychain-profile', NOTARY_PROFILE, '--output-format', 'json']);
  return r.status === 0;
}

function notarySubmit(filePath) {
  const r = runCapture('xcrun', ['notarytool', 'submit', filePath, '--keychain-profile', NOTARY_PROFILE, '--output-format', 'json']);
  if (r.status !== 0) {
    log(`WARNING: notarytool submit failed — continuing unnotarized. ${(r.stderr || '').split('\n')[0]}`);
    return null;
  }
  const out = JSON.parse(r.stdout);
  log(`notarization submitted — id=${out.id} (async; check later with --finish)`);
  return out.id;
}

function notaryStatus(id) {
  const r = runCapture('xcrun', ['notarytool', 'info', id, '--keychain-profile', NOTARY_PROFILE, '--output-format', 'json']);
  if (r.status !== 0) throw new Error(`notarytool info failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/**
 * Staples the notarization ticket into the .app inside the update zip
 * (that's the artifact actually submitted to notarytool and the one
 * electron-updater applies — see actionRelease) and re-zips it in place.
 * `ditto` (not a generic zip tool) is Apple's own documented way to do
 * this: it's what preserves the resource fork / xattrs / symlinks a
 * codesigned .app depends on; a plain zip can silently corrupt the
 * signature on re-extraction.
 *
 * Also best-effort staples the .dmg directly — but the dmg was never itself
 * submitted to notarytool (only the zip was, to keep one Apple submission
 * per release), so it has no ticket of its own and this is EXPECTED to fail
 * today. A user who downloads the dmg directly still launches fine: Gatekeeper
 * falls back to an online ticket lookup (by the app's own CDHash) as long as
 * they have internet, which is the normal unstapled-but-notarized path.
 *
 * Returns the path to the stapled .app (inside a temp dir) for verification
 * — call `cleanup()` once done with it.
 */
function stapleAndRezipMac(zipPath, dmgPath) {
  try {
    run('xcrun', ['stapler', 'staple', dmgPath]);
  } catch (e) {
    log(`WARNING: could not staple the .dmg directly (expected — only the .zip was submitted for notarization): ${e.message}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-staple-'));
  run('ditto', ['-xk', zipPath, tmp]);
  const appName = fs.readdirSync(tmp).find((f) => f.endsWith('.app'));
  if (!appName) throw new Error(`no .app found inside ${zipPath} after extracting`);
  const appPath = path.join(tmp, appName);
  run('xcrun', ['stapler', 'staple', appPath]);
  fs.rmSync(zipPath, { force: true });
  run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);
  return { appPath, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

function verifyMacNotarization(appPath) {
  const spctl = runCapture('spctl', ['-a', '-vvv', '-t', 'install', appPath]);
  const stapler = runCapture('xcrun', ['stapler', 'validate', appPath]);
  return {
    spctl: { ok: spctl.status === 0, output: `${spctl.stdout}${spctl.stderr}`.trim() },
    stapler: { ok: stapler.status === 0, output: `${stapler.stdout}${stapler.stderr}`.trim() },
  };
}

// ── state (pending notarization submissions — local only, gitignored) ───
function stateFile(channel, osName, version) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return path.join(STATE_DIR, `${channel}-${osName}-${version}.json`);
}
function saveState(channel, osName, version, data) {
  fs.writeFileSync(stateFile(channel, osName, version), JSON.stringify(data, null, 2));
}
function loadState(channel, osName, version) {
  const f = stateFile(channel, osName, version);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ── manifest publish ───────────────────────────────────────────────────────
function manifestName(osName) {
  return osName === 'mac' ? 'latest-mac.yml' : 'latest.yml';
}

/** Rewrite the electron-builder-generated manifest's (relative) file
 *  references to point into the version subfolder, matching the bucket
 *  layout — electron-builder itself writes bare filenames, assuming the
 *  binaries sit next to the manifest; ours don't. */
function rewriteManifestForVersion(localYmlPath, version) {
  const doc = yamlLoad(fs.readFileSync(localYmlPath, 'utf8'));
  const originalNames = new Set();
  if (doc.path) { originalNames.add(doc.path); doc.path = `${version}/${doc.path}`; }
  if (Array.isArray(doc.files)) {
    doc.files = doc.files.map((f) => { originalNames.add(f.url); return { ...f, url: `${version}/${f.url}` }; });
  }
  return { rewritten: yamlDump(doc), originalNames: [...originalNames] };
}

async function publishVersion(s3, creds, { channel, osName, version, localYmlPath, skipBlockmaps = false }) {
  const { rewritten, originalNames } = rewriteManifestForVersion(localYmlPath, version);
  const name = manifestName(osName);
  // 1) binaries (+ blockmaps) into the version subfolder FIRST.
  for (const fileName of originalNames) {
    const local = path.join(OUT_DIR, fileName);
    if (!fs.existsSync(local)) throw new Error(`expected build artifact missing: ${local}`);
    await putObject(s3, creds, `${channel}/${osName}/${version}/${fileName}`, fs.readFileSync(local));
    const bm = `${local}.blockmap`;
    if (!skipBlockmaps && fs.existsSync(bm)) {
      await putObject(s3, creds, `${channel}/${osName}/${version}/${fileName}.blockmap`, fs.readFileSync(bm));
    }
  }
  // 2) an immutable, versioned COPY of the manifest (rollback reads this —
  //    never the active pointer, which keeps moving).
  await putObject(s3, creds, `${channel}/${osName}/${version}/${name}`, Buffer.from(rewritten, 'utf8'));
  // 3) the ACTIVE channel manifest LAST, no-cache (clients must never cache
  //    a stale pointer, even briefly).
  await putObject(s3, creds, `${channel}/${osName}/${name}`, Buffer.from(rewritten, 'utf8'), { cacheControl: 'no-cache' });
  log(`published ${channel}/${osName} → ${version}`);
}

async function rollback(s3, creds, { channel, osName, version }) {
  const name = manifestName(osName);
  const key = `${channel}/${osName}/${version}/${name}`;
  let body;
  try {
    body = await getObjectText(s3, creds, key);
  } catch (e) {
    throw new Error(`cannot roll back to ${version} — ${key} was never published (${e.message})`);
  }
  await putObject(s3, creds, `${channel}/${osName}/${name}`, Buffer.from(body, 'utf8'), { cacheControl: 'no-cache' });
  log(`rolled back ${channel}/${osName} → ${version}`);
}

// ── manifest for --finish, built fresh (never from dist/electron/latest-
// mac.yml) ─────────────────────────────────────────────────────────────────
// `dist/electron/` is a SHARED build-output directory reused release after
// release — by the time `--finish` runs (possibly hours later, after a
// NEWER version has already been built in the same tree, per the async
// notarization design), `latest-mac.yml` there almost certainly describes a
// DIFFERENT version than the one being finished. Trusting it silently
// published the wrong bytes under the right version's path once already
// (2026-10-02) — never read it here. Build the manifest from only what we
// actually know: the state file's own filenames + freshly hashed bytes.
function hashFile(p) {
  const buf = fs.readFileSync(p);
  return { sha512: crypto.createHash('sha512').update(buf).digest('base64'), size: buf.length };
}

function buildFinishManifest(version, zipName, dmgName) {
  const zipPath = path.join(OUT_DIR, zipName);
  const entries = [{ url: zipName, ...hashFile(zipPath) }];
  if (dmgName) {
    const dmgPath = path.join(OUT_DIR, dmgName);
    if (fs.existsSync(dmgPath)) entries.push({ url: dmgName, ...hashFile(dmgPath) });
  }
  // The old blockmap was computed from the pre-staple zip bytes — it no
  // longer matches. Remove it rather than ship a wrong one; electron-updater
  // falls back to a full download when there's no (or a mismatching) blockmap.
  const bm = `${zipPath}.blockmap`;
  if (fs.existsSync(bm)) fs.rmSync(bm);
  return yamlDump({ version, files: entries, path: entries[0].url, sha512: entries[0].sha512, releaseDate: new Date().toISOString() });
}

// ── actions ────────────────────────────────────────────────────────────────
async function actionRelease(a) {
  const version = requireVersion(a.version, '--version');
  const creds = loadCreds();
  const base = a.base || creds.PF_RELEASE_PUBLIC_BASE;
  const s3 = s3Client(creds);
  writeVersion(version);
  nxBuild(a.channel); // Angular output is shared between mac/win — build once.

  if (a.mac) {
    electronBuilderBuild(a, 'mac', { base, channel: a.channel, version });
    assertNoLeakedSecrets('mac', creds);
    // Read the real filenames back from the manifest electron-builder just
    // wrote, rather than guessing its artifactName template (arch suffix
    // rules, defaultArch, etc. are electron-builder's to change).
    const macYml = yamlLoad(fs.readFileSync(path.join(OUT_DIR, 'latest-mac.yml'), 'utf8'));
    const zipName = macYml.path;
    const dmgName = (macYml.files || []).map((f) => f.url).find((u) => u.endsWith('.dmg'));
    if (!zipName || !dmgName) throw new Error(`could not find zip/dmg names in latest-mac.yml: ${JSON.stringify(macYml)}`);
    let submissionId = null;
    if (!a.skipNotarize) {
      if (!notaryProfileAvailable()) {
        log(`WARNING: keychain profile "${NOTARY_PROFILE}" not found/usable — shipping an UNNOTARIZED signed build.`);
      } else {
        submissionId = notarySubmit(path.join(OUT_DIR, zipName));
      }
    }
    saveState(a.channel, 'mac', version, { submissionId, zipName, dmgName, submittedAt: new Date().toISOString(), published: false });
    if (a.channel === 'dev') {
      await publishVersion(s3, creds, { channel: a.channel, osName: 'mac', version, localYmlPath: path.join(OUT_DIR, 'latest-mac.yml') });
      const st = loadState(a.channel, 'mac', version); st.published = true; st.publishedUnstapled = true; saveState(a.channel, 'mac', version, st);
      log('dev channel: published the SIGNED build now — notarization is running in the background; run --finish once Apple accepts it.');
    } else {
      log(`${a.channel} channel: built + submitted for notarization, NOT published yet. Run --finish ${version} --channel ${a.channel} --mac once Apple accepts it.`);
    }
  }
  if (a.win) {
    electronBuilderBuild(a, 'windows', { base, channel: a.channel, version });
    assertNoLeakedSecrets('win', creds);
    await publishVersion(s3, creds, { channel: a.channel, osName: 'windows', version, localYmlPath: path.join(OUT_DIR, 'latest.yml') });
  }
}

async function actionFinish(a) {
  const version = requireVersion(a.finish, '--finish');
  if (!a.mac) fail('--finish is only meaningful with --mac (Windows has nothing to notarize)');
  const creds = loadCreds();
  const base = a.base || creds.PF_RELEASE_PUBLIC_BASE;
  const s3 = s3Client(creds);
  const state = loadState(a.channel, 'mac', version);
  if (!state) fail(`no pending mac release found for ${a.channel} ${version} — run a normal --mac release first`);
  if (!state.submissionId) fail(`${a.channel} ${version} has no notarization submission on record (it may have been built with --skip-notarize) — nothing to finish`);

  const info = notaryStatus(state.submissionId);
  log(`notarization status: ${info.status}`);
  if (info.status === 'In Progress') { log('still pending — try again later.'); return; }
  if (info.status !== 'Accepted') {
    const detail = runCapture('xcrun', ['notarytool', 'log', state.submissionId, '--keychain-profile', NOTARY_PROFILE]);
    fail(`notarization ${info.status} — NOT publishing.\n${detail.stdout || detail.stderr || ''}`);
  }

  const zipPath = path.join(OUT_DIR, state.zipName);
  const dmgPath = path.join(OUT_DIR, state.dmgName);
  if (!fs.existsSync(zipPath)) fail(`${zipPath} is gone (dist/electron was cleaned since the release?) — rebuild ${version} with --mac first, then --finish again.`);
  const { appPath, cleanup } = stapleAndRezipMac(zipPath, dmgPath);
  const manifestYml = buildFinishManifest(version, state.zipName, state.dmgName);
  const tmpYml = path.join(os.tmpdir(), `pf-finish-${a.channel}-mac-${version}.yml`);
  fs.writeFileSync(tmpYml, manifestYml);
  assertNoLeakedSecrets('mac', creds);

  const check = verifyMacNotarization(appPath);
  cleanup();
  log(`spctl: ${check.spctl.ok ? 'accepted' : 'REJECTED'} — ${check.spctl.output.split('\n')[0] || ''}`);
  log(`stapler validate: ${check.stapler.ok ? 'ok' : 'FAILED'} — ${check.stapler.output.split('\n')[0] || ''}`);
  if (!check.spctl.ok || !check.stapler.ok) { fs.rmSync(tmpYml, { force: true }); fail('post-staple verification failed — not publishing.'); }

  await publishVersion(s3, creds, { channel: a.channel, osName: 'mac', version, localYmlPath: tmpYml, skipBlockmaps: true });
  fs.rmSync(tmpYml, { force: true });
  saveState(a.channel, 'mac', version, { ...state, published: true, publishedUnstapled: false, finishedAt: new Date().toISOString() });
  log(`${a.channel} mac ${version}: stapled, verified, published.`);
}

async function actionRollback(a) {
  const version = requireVersion(a.rollback, '--rollback');
  const creds = loadCreds();
  const s3 = s3Client(creds);
  if (a.mac) await rollback(s3, creds, { channel: a.channel, osName: 'mac', version });
  if (a.win) await rollback(s3, creds, { channel: a.channel, osName: 'windows', version });
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.rollback) return actionRollback(a);
  if (a.finish) return actionFinish(a);
  return actionRelease(a);
}

main().catch((e) => fail(e && e.stack || e));
