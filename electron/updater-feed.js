'use strict';
/**
 * Pick the electron-updater (generic provider) feed URL for THIS build, from
 * its own `pfDataProfile` extraMetadata and the running OS. Pure function —
 * no Electron, no network — so channel/os selection is unit tested head-on
 * (electron/test/updater-feed.test.js) instead of only inside the real app.
 *
 * Bucket layout (owner's design): `<base>/<channel>/<os>/` holds the update
 * manifest (`latest-mac.yml` / `latest.yml`), and `<base>/<channel>/<os>/<ver>/`
 * holds the binaries that manifest's (relative) `path` / `files[].url`
 * entries point into. Channels never cross: a build's own pfDataProfile
 * picks ONE `<channel>` and that's the only folder it ever reads.
 *
 * `pfDataProfile` already drives per-build userData isolation (main.js); we
 * reuse the same field for the update channel rather than adding a second
 * one, EXCEPT 'prod' is special-cased in main.js to skip userData isolation
 * (today's real shipped app has no profile at all and must keep its default
 * userData folder) — see the comment there.
 */
const DEFAULT_BASE = 'https://prefrontal-updates.blr1.digitaloceanspaces.com';

/** electron-updater / electron-builder os folder names we publish to. */
const OS_MAP = { darwin: 'mac', win32: 'windows' };

const CHANNEL_RE = /^[a-z0-9-]{1,40}$/i;

function resolveOs(platform) {
  return OS_MAP[platform] || null;
}

/**
 * @param {{ pfDataProfile?: string, platform?: string, base?: string }} o
 * @returns {{ channel: string, os: string, url: string } | null} null means
 *   "updates disabled for this build" — no channel (plain dev/local builds
 *   never set pfDataProfile) or an OS we don't publish for (Linux today).
 */
function resolveFeed(o = {}) {
  const channel = typeof o.pfDataProfile === 'string' && CHANNEL_RE.test(o.pfDataProfile)
    ? o.pfDataProfile.toLowerCase()
    : null;
  const os = resolveOs(o.platform);
  if (!channel || !os) return null;
  const base = String(o.base || DEFAULT_BASE).replace(/\/+$/, '');
  return { channel, os, url: `${base}/${channel}/${os}` };
}

module.exports = { resolveFeed, resolveOs, DEFAULT_BASE };
