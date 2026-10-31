# Desktop releases (Electron self-update)

The desktop app (electron/) updates itself: electron-updater polls a
DigitalOcean Spaces bucket in the background, downloads a verified build, and
the user clicks **Restart now** on a small in-app banner (or it installs
quietly on the app's next normal quit) — never a forced restart, never a
native dialog.

## Bucket layout

Bucket `prefrontal-updates` (blr1 — public base
`https://prefrontal-updates.blr1.digitaloceanspaces.com`). This is the ONLY
public Spaces bucket in the account; any other bucket is firewall-restricted,
so updates must never be pointed anywhere else:

```
/<channel>/<os>/latest(-mac).yml        ← ACTIVE manifest (what the app polls)
/<channel>/<os>/<version>/              ← that version's binaries + blockmaps
/<channel>/<os>/<version>/latest(-mac).yml   ← an immutable COPY, for --rollback
```

- `channel` = `dev` | `stage` | `prod`. **Channels never cross** — a build only
  ever reads its own channel's folder (baked in at build time, see below).
- `os` = `mac` | `windows` (Linux isn't published to).
- `latest-mac.yml` is electron-updater's default manifest name on macOS;
  `latest.yml` on Windows. Never renamed, never given a `channel:` override in
  `setFeedURL` — the channel lives in the URL path, not the filename.
- sha512 verification is **on** (electron-updater's default) and never
  disabled anywhere in this codebase.

## How a build knows its channel

`electron/updater-feed.js` (`resolveFeed`) reads the build's own
`pfDataProfile` (an `extraMetadata` field baked in by electron-builder at
build time — see Release below) and the running OS, and builds the feed URL.
No `pfDataProfile` (a plain `electron:build`/`electron:build:devapi` build) or
an unpublished OS → updates are silently disabled for that build.

`pfDataProfile` already drives per-build **userData isolation** (so a side
test build doesn't touch the real app's data — see `electron/main.js`). We
reuse the same field for the update channel instead of adding a second one,
with ONE exception: **`'prod'` is special-cased in `main.js` to skip userData
isolation.** The real shipped app sets no `pfDataProfile` today and uses the
default userData folder; the day it starts tagging itself `pfDataProfile=prod`
(purely so `updater.js` can resolve its channel) must not silently move every
real customer's local data to a new folder. Only `dev` / `stage` (genuine
side-by-side test builds) get isolated.

## Behaviour (electron/updater.js)

- Checks at launch, then every 4 hours. Downloads in the background
  (`autoDownload = true`). Never force-restarts (`autoInstallOnAppQuit = true`
  — installs quietly next time the user quits normally, if they never click
  Restart).
- A verified, fully-downloaded update shows the small banner
  (`shared/components/update-banner`): **Restart now** / **Later**. ND
  pattern — primary (violet) only on the actual call-to-action.
- **Restart now** is refused while a paired instrument connector looks busy
  (`electron/updater-guard.js`): `state === 'listening'` (an explicit
  listen/capture session), a non-empty upload queue, or a message received in
  the last 2 minutes. A steady `'connected'` idle connector is **not**
  treated as busy — otherwise updates would almost never install in a working
  lab. A refused restart shows "Analyzer is connected — restart after the
  current run?" and main retries automatically a few minutes later.
- Errors (offline, a channel with nothing published yet, etc.) are logged
  quietly to `<userData>/logs/updater.log` — never a popup.

## Release script — `tools/desktop-release.mjs`

```
node tools/desktop-release.mjs --channel dev --version 1.0.1 --mac [--win]
node tools/desktop-release.mjs --finish 1.0.1 --channel dev --mac
node tools/desktop-release.mjs --rollback 1.0.0 --channel dev --mac [--win]
```

Credentials: `PF_RELEASE_ENDPOINT` / `PF_RELEASE_BUCKET` /
`PF_RELEASE_PUBLIC_BASE` / `PF_RELEASE_KEY_ID` / `PF_RELEASE_SECRET`, from the
environment or `~/.config/prefrontal/release-spaces.env` (never written
anywhere else, never logged). After every build the script greps the packaged
`app.asar` for the key id / secret and refuses to publish if either leaked in
— nothing in `electron/` ever references them, so this should never trip.

Order: builds the Angular bundle once (shared by mac/win), then
electron-builder per `--mac`/`--win` with
`-c.extraMetadata.pfDataProfile=<channel>` (+ a side-by-side `productName` /
`appId` for `dev`/`stage` — `prod` keeps the base `in.prefrontal.app` /
"Prefrontal" identity), `--publish never` (electron-builder only needs a
publish config to *generate* the update-info yml/blockmaps; we upload
ourselves). Uploads binaries **first**, the active manifest **last**, so a
client never sees a manifest pointing at a file that isn't there yet. Objects
are `public-read` with the right `Content-Type`; manifests get
`Cache-Control: no-cache`, everything else `immutable`.

`NX_CONFIG_BY_CHANNEL` maps a channel to the Nx Angular build configuration
to use. **`prod` currently reuses `electron-stage`'s configuration** (there is
no live production backend yet — see `apps/lms/src/environments/`; the real
shipped app has always pointed at stage). When a real prod backend exists,
add an `electron-prod` Nx configuration + `environment.electron-prod.ts` and
change that one line — nothing else in the script needs to change.

### Notarization (macOS) — async, never blocks

Apple's notarization queue can sit for hours, so the script **never waits**
on it:

1. `release --mac` builds, signs, and (if the `prefrontal-notary` keychain
   profile is present — `xcrun notarytool store-credentials`, done once by
   the owner) runs `notarytool submit … ` **without `--wait`**, records the
   submission id locally (`tools/.release-state/<channel>-mac-<version>.json`
   — gitignored, never committed), and returns immediately.
   - **dev channel**: publishes the **signed-but-not-yet-notarized** build
     right away. Existing dev installs see it at their next check.
   - **stage / prod**: builds and submits, but publishes **nothing** — a
     stage/prod build is never shipped unnotarized.
2. `--finish <version> --channel <ch> --mac` (run any time after, including
   much later): checks the submission's status
   (`notarytool info`). Still `In Progress` → prints that and exits cleanly
   (safe to re-run). `Accepted` → staples the ticket into the `.app` inside
   the update zip (extract with `ditto`, `stapler staple`, re-zip with
   `ditto -c -k --keepParent` — a plain zip tool can silently break the code
   signature on re-extraction, `ditto` is Apple's own documented way to do
   this), recomputes the zip's sha512/size, verifies with
   `spctl -a -vvv -t install` and `xcrun stapler validate`, then publishes
   (re-publishing over the dev channel's earlier unstapled upload, or doing
   the first publish for stage/prod). Any other status → fails loudly,
   publishes nothing.
   - The `.dmg` is also stapled on a best-effort basis, but it was never
     separately submitted to notarytool (only the zip is, to keep one Apple
     submission per release) — this is **expected to fail** today and is
     logged as a warning, not an error. A direct dmg download still launches
     fine: Gatekeeper falls back to an online ticket lookup by the app's
     CDHash as long as the user has internet (the normal
     notarized-but-unstapled path).
   - The re-stapled zip's old blockmap is stale (different bytes) and is
     deleted rather than re-uploaded wrong; electron-updater falls back to a
     full download for that one version instead of a differential patch —
     harmless, just not maximally bandwidth-efficient.
3. If `prefrontal-notary` isn't set up on the build machine, the script warns
   clearly and ships an **unnotarized, still Developer-ID-signed** build
   instead of failing outright.

**Verified for real on 2026-10-02**: a dev build (`Prefrontal Dev-1.0.0`) was
notarized end-to-end — `notarytool submit` → accepted → `--finish`'s staple +
`spctl -a -vvv -t install` → `accepted, source=Notarized Developer ID` +
`stapler validate` → `worked`.

### Rollback

`--rollback <version>` fetches that version's own immutable manifest copy
(`/<channel>/<os>/<version>/latest(-mac).yml` — proof it was actually
published) and republishes it as the active channel manifest. Old version
folders are never deleted, so any previously-published version can be rolled
back to at any time.

## Testing

- **Unit** (`npm run test:electron`, `node --test electron/test/*.test.js`):
  - `updater-feed.test.js` — channel/os → feed URL selection, including "no
    channel disables updates" and "channels never cross".
  - `updater-guard.test.js` — the busy-analyzer restart guard, including the
    "idle-but-connected is not busy" and active-window-boundary cases.
  - `updater.test.js` — the main-process module end-to-end against a fake
    `electron` + `electron-updater` (IPC wiring, a safe restart calling
    `quitAndInstall` exactly once, a busy restart deferring and never calling
    it, state pushed to the renderer).
- **Real round trip against the live bucket, dev channel only (2026-10-02,
  bucket `prefrontal-updates`/blr1 — the account's one public bucket, others
  are firewall-restricted)**:
  1. `release --mac --win` published real `1.0.0` to
     `.../dev/mac/latest-mac.yml` and `.../dev/windows/latest.yml`. Confirmed
     anonymously fetchable (plain `curl`, no auth) and every object
     `public-read` with the right `Content-Type` / `Cache-Control` (`curl -I`).
  2. Ran the real signed `1.0.0.app` directly (no `PF_UPDATE_BASE` override —
     this used the actual baked-in default base URL): `update-not-available`
     against itself, exactly as it should.
  3. `release --mac --win --version 1.0.1` published `1.0.1`. Relaunching the
     installed `1.0.0` app: found `1.0.1`, attempted a **differential**
     download (electron-updater compared blockmaps, found 3279 changed
     blocks) — DO Spaces doesn't support the multi-range response
     (`multipart/byteranges`) electron-updater's differential downloader
     needs, so it logged the mismatch and **fell back to a full download
     automatically** (electron-updater's own documented behaviour, not a bug
     here) → `update 1.0.1 downloaded + verified, ready to install`. On quit,
     the real Squirrel.Mac/ShipIt path applied it — the installed app's
     `CFBundleShortVersionString` read back as **`1.0.1`**.
  4. `--rollback 1.0.0 --mac --win` against the real bucket: both manifests
     confirmed back to `1.0.0` (anonymous `curl`).
  5. Both `1.0.0` and `1.0.1` mac builds were really notarized (submit →
     Accepted) and `--finish 1.0.0` stapled + republished it — verified by
     downloading the PUBLISHED zip fresh from the bucket and running
     `spctl -a -vvv -t install` (**accepted, Notarized Developer ID**) +
     `xcrun stapler validate` (**worked**) on it.
  - **Bug found and fixed during this**: `--finish` was reading
    `dist/electron/latest-mac.yml` to know which files to re-upload — but
    that's a SHARED, overwritten-every-build file, and `--finish` can run
    long after a NEWER version was built in the same tree (by design — it
    never blocks on Apple). It briefly published a stale/wrong-version
    manifest once. Fixed: `--finish` now builds the manifest from scratch
    (state file's own filenames + freshly hashed bytes), never from that
    file. Caught and corrected on the live bucket before leaving it (final
    state: dev channel rolled back to the genuine, stapled, verified `1.0.0`).
- Windows: real `1.0.0` + `1.0.1` built and published (`-c.win.icon=…`, see
  `--win-icon`) and rolled back, all against the live bucket; manifests/sha512
  verified both by anonymous `curl` and local recomputation. No Windows
  machine was rebooted to actually install it.

## Known gaps / needs the owner

- `prod`'s Nx build configuration is a placeholder (reuses `electron-stage`)
  until a real production backend exists.
- Windows code signing isn't wired up (out of scope here — only macOS
  notarization was asked for); an unsigned/signing-less `.exe` will show the
  SmartScreen "unknown publisher" prompt on first run.
- Building `--win` from a Mac defaults to the HOST's arch (arm64 on Apple
  Silicon) unless told otherwise, so `tools/desktop-release.mjs` and
  `electron:build:win:prod` always pass `--win nsis --x64 --ia32` explicitly.

## Windows architectures (64-bit + 32-bit) — desktop 1.1.2+

- **One** NSIS installer contains both x64 and ia32 (`package.json`
  `build.win.target` nsis `arch: [x64, ia32]`; release script passes
  `--x64 --ia32`). At install time the installer's `RunningX64` check extracts
  the matching package, so a 32-bit Windows PC gets the ia32 app and a 64-bit
  PC the x64 app. Nothing changes in the channel layout or `updater-feed.js`:
  `latest.yml` still lists a single `Prefrontal Setup <v>.exe`
  (`files[0].url` == `path`), so existing 64-bit installs auto-update as
  before and the public site's download button (reads `latest.yml`) needs no
  change — it points at the one `.exe`, which works for both.
- Native modules: `usb` and `@serialport/bindings-cpp` ship every
  `prebuilds/<platform>-<arch>` and `node-gyp-build` picks the right one at
  runtime from `process.platform/arch`, so `-c.npmRebuild=false` is correct for
  both arches (verified: both `win-unpacked` and `win-ia32-unpacked` contain
  the `win32-x64` and `win32-ia32` `.node` files in `app.asar.unpacked`;
  `Prefrontal.exe` is PE32+ x86-64 in one and PE32 i386 in the other). No other
  native module is loaded by `electron/`.
- Cost: the combined installer is ~308 MB vs ~161 MB for x64 only (the 320 MB
  `app.asar` is carried once per arch). Updates are full downloads anyway (DO
  Spaces has no multi-range support). The `portable` target stays x64 only and
  is never published.
- Minimum OS: **Windows 10 (32- or 64-bit)**. Electron 41 does not run on
  Windows 7/8/8.1.
- The leak guard scans BOTH `win-unpacked/…/app.asar` and
  `win-ia32-unpacked/…/app.asar`.
- If the size becomes a problem, the fallback is separate per-arch installers
  with a second feed (`<channel>/windows-ia32/`, selected in `updater-feed.js`
  by `process.arch`) and an arch-aware site button — more moving parts, not done.

## Key rotation

Rotating `PF_RELEASE_KEY_ID` / `PF_RELEASE_SECRET`: generate a new DO Spaces
access key, update `~/.config/prefrontal/release-spaces.env` (owner's machine
only — never commit it), and revoke the old key in the DO control panel.
Nothing else needs to change; the script never persists credentials anywhere
else.
