import { test as base, expect, devices, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type PlaywrightTestProject } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FORM FACTORS for the on-screen (Playwright) suites: every screens spec runs once per project.
 *
 *   phone             390×844, iPhone UA, touch, isMobile     → html.device-touch.device-phone, bottom bar floating inset
 *   tablet            820×1180 iPad portrait, iPad UA, touch  → html.device-touch.device-tablet (tablet tier, icon work tabs)
 *   tablet-landscape  1180×820 iPad landscape                → same tier (a touch device never flips to desktop)
 *   desktop           1440×900 desktop Chrome, mouse          → html.device-desktop, the web app in a browser
 *   desktop-app       1440×900 + a stub of electron/preload.js → html.device-desktop + html.electron, HASH routing,
 *                     the WhatsApp dock / printer / notify bridges answered in-page (Electron is NEVER launched)
 * BROWSERS (opt-in, PW_BROWSERS=webkit,firefox,chrome,edge — the configs never download browsers):
 *   phone-webkit / tablet-webkit / desktop-webkit   iPhone / iPad / Mac Safari (WebKit)
 *   desktop-firefox                                 Firefox on the desktop web app
 *   desktop-chrome / desktop-edge                   branded Google Chrome / Microsoft Edge (channel) on the desktop web app
 *   The base projects above stay on the box's Chromium. PW_WEBKIT=1 still means "webkit". The Linux dev PC (Ubuntu 26.04)
 *   can't run Playwright's WebKit/Edge natively, so CI runs the browser projects in the official Playwright image
 *   (tools/e2e-browsers.Dockerfile).
 *
 * Specs import `test` / `expect` from here (not '@playwright/test'): the `context` fixture installs the
 * desktop-app bridge, so a spec never has to know it is running in the desktop app unless it asserts on it.
 * Inside a test: formFactor(), isTouch(), isDesktopApp(), bridgeCalls(page), shotsDir(base), expectLayout(page).
 */

export type FormFactor = 'phone' | 'tablet' | 'desktop' | 'desktop-app';
export type Orientation = 'portrait' | 'landscape';
export type Engine = 'chromium' | 'webkit' | 'firefox';
export type BrowserKey = 'webkit' | 'firefox' | 'chrome' | 'edge';
export interface FormFactorMeta { formFactor: FormFactor; orientation: Orientation; engine: Engine; browser?: string }

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** The packaged desktop app: Chromium + "Electron/x" (what a real Electron renderer reports). */
export const DESKTOP_APP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) prefrontal/1.2.0 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36';

/** Context options per form factor (also used by specs that open their own contexts). */
export const FORM_FACTOR_OPTIONS: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  tablet: { viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA },
  'tablet-landscape': { viewport: { width: 1180, height: 820 }, screen: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA },
  desktop: { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  'desktop-app': { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: DESKTOP_APP_UA },
};

const META: Record<string, FormFactorMeta> = {
  phone: { formFactor: 'phone', orientation: 'portrait', engine: 'chromium' },
  tablet: { formFactor: 'tablet', orientation: 'portrait', engine: 'chromium' },
  'tablet-landscape': { formFactor: 'tablet', orientation: 'landscape', engine: 'chromium' },
  desktop: { formFactor: 'desktop', orientation: 'landscape', engine: 'chromium' },
  'desktop-app': { formFactor: 'desktop-app', orientation: 'landscape', engine: 'chromium' },
  'phone-webkit': { formFactor: 'phone', orientation: 'portrait', engine: 'webkit', browser: 'safari' },
  'tablet-webkit': { formFactor: 'tablet', orientation: 'portrait', engine: 'webkit', browser: 'safari' },
  'desktop-webkit': { formFactor: 'desktop', orientation: 'landscape', engine: 'webkit', browser: 'safari' },
  'desktop-firefox': { formFactor: 'desktop', orientation: 'landscape', engine: 'firefox', browser: 'firefox' },
  'desktop-chrome': { formFactor: 'desktop', orientation: 'landscape', engine: 'chromium', browser: 'chrome' },
  'desktop-edge': { formFactor: 'desktop', orientation: 'landscape', engine: 'chromium', browser: 'edge' },
};

function stripMobile<T extends object>(d: T): Omit<T, 'isMobile'> { const { isMobile: _m, ...rest } = d as T & { isMobile?: boolean }; return rest; }

/** PW_BROWSERS ("webkit,firefox,chrome,edge" or "all") + the old PW_WEBKIT=1 → the extra browsers to add. */
export function browsersFromEnv(env: Record<string, string | undefined> = process.env): BrowserKey[] {
  const all: BrowserKey[] = ['webkit', 'firefox', 'chrome', 'edge'];
  const raw = (env['PW_BROWSERS'] || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const set = new Set<BrowserKey>(raw.includes('all') ? all : (raw.filter(b => (all as string[]).includes(b)) as BrowserKey[]));
  if (env['PW_WEBKIT'] === '1') set.add('webkit');
  return all.filter(b => set.has(b));
}

export const ALL_PROJECT_NAMES = ['phone', 'tablet', 'tablet-landscape', 'desktop', 'desktop-app'] as const;

/**
 * The Playwright projects. `launch` = the Chromium launch options of the box (PW_CHROME_PATH / PW_CHROMIUM or the
 * `chrome` channel); WebKit projects are added only when `webkit` is true (PW_WEBKIT=1) and use Playwright's own WebKit.
 */
export function formFactorProjects(o: {
  names?: readonly string[];
  launch: Pick<NonNullable<PlaywrightTestProject['use']>, 'channel' | 'launchOptions'>;
  webkit?: boolean;
  /** Extra browsers (see browsersFromEnv). */
  browsers?: readonly BrowserKey[];
  extraUse?: PlaywrightTestProject['use'];
}): PlaywrightTestProject[] {
  const names = o.names ?? ALL_PROJECT_NAMES;
  const out: PlaywrightTestProject[] = names.map(name => ({
    name,
    metadata: META[name],
    use: { ...devices['Desktop Chrome'], ...o.extraUse, ...o.launch, ...FORM_FACTOR_OPTIONS[name] },
  }));
  const browsers = new Set<BrowserKey>(o.browsers ?? []);
  if (o.webkit) browsers.add('webkit');
  // Other engines must not inherit the Chromium binary path / flags of the box.
  const plain = { ...o.extraUse, launchOptions: {} };
  const desktop = FORM_FACTOR_OPTIONS['desktop'];
  const { isMobile: _noMobileOnFirefox, ...desktopNoMobile } = desktop;
  if (browsers.has('webkit')) {
    out.push(
      { name: 'phone-webkit', metadata: META['phone-webkit'], use: { ...devices['iPhone 14'], ...plain, browserName: 'webkit', viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } } },
      { name: 'tablet-webkit', metadata: META['tablet-webkit'], use: { ...devices['iPad Pro 11'], ...plain, browserName: 'webkit', viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 } } },
      { name: 'desktop-webkit', metadata: META['desktop-webkit'], use: { ...devices['Desktop Safari'], ...plain, browserName: 'webkit', ...desktop } },
    );
  }
  if (browsers.has('firefox')) out.push({ name: 'desktop-firefox', metadata: META['desktop-firefox'], use: { ...stripMobile(devices['Desktop Firefox']), ...plain, browserName: 'firefox', ...desktopNoMobile } });
  if (browsers.has('chrome')) out.push({ name: 'desktop-chrome', metadata: META['desktop-chrome'], use: { ...devices['Desktop Chrome'], ...plain, channel: 'chrome', ...desktop } });
  if (browsers.has('edge')) out.push({ name: 'desktop-edge', metadata: META['desktop-edge'], use: { ...devices['Desktop Edge'], ...plain, channel: 'msedge', ...desktop } });
  return out;
}

// ───────────────────────── inside a test ─────────────────────────

function meta(): FormFactorMeta {
  let m: Partial<FormFactorMeta> | undefined;
  try { m = base.info().project.metadata as Partial<FormFactorMeta>; } catch { m = undefined; }
  return { formFactor: m?.formFactor ?? 'desktop', orientation: m?.orientation ?? 'landscape', engine: m?.engine ?? 'chromium' };
}
export const formFactor = (): FormFactor => meta().formFactor;
export const orientation = (): Orientation => meta().orientation;
export const engine = (): Engine => meta().engine;
/** 'safari' | 'firefox' | 'chrome' | 'edge' on a browser project, else 'chromium'. */
export function browser(): string { try { return String((base.info().project.metadata as Partial<FormFactorMeta>)?.browser ?? 'chromium'); } catch { return 'chromium'; } }
export const isPhone = (): boolean => formFactor() === 'phone';
export const isTablet = (): boolean => formFactor() === 'tablet';
/** Phone or tablet: a finger, the touch layout (html.device-touch), the share sheet / wa.me for WhatsApp. */
export const isTouch = (): boolean => isPhone() || isTablet();
/** Below 1024px (phone, iPad portrait — on any engine): work lists are the shared <pf-work-list>, not a grid
 *  (owner 2026-11-21, small-screens). Use this instead of matching project names, which misses phone-webkit /
 *  tablet-webkit. */
export const belowGrid = (): boolean => isPhone() || (isTablet() && orientation() === 'portrait');
/** Chromium-only tooling (CDP touch events): webkit / firefox projects skip those steps. */
export const hasCdp = (): boolean => engine() === 'chromium';
export const isDesktopApp = (): boolean => formFactor() === 'desktop-app';
/** The web app in a desktop browser (not the desktop app). */
export const isDesktopWeb = (): boolean => formFactor() === 'desktop';
/** Desktop browser or desktop app: the mouse layout (html.device-desktop). */
export const isDesktop = (): boolean => isDesktopWeb() || isDesktopApp();
/** The project's name ("tablet-landscape"), or "default" outside a form-factor project. */
export function projectName(): string { try { return base.info().project.name || 'default'; } catch { return 'default'; } }
/** `<base>/<project>/`, created. Screenshots of each form factor land in their own folder. */
export function shotsDir(baseDir: string): string { const d = path.join(baseDir, projectName()); fs.mkdirSync(d, { recursive: true }); return d; }
/** The current project's context options (for a spec that opens its own context). */
export function contextOptions(): BrowserContextOptions {
  const n = projectName();
  return { ...(FORM_FACTOR_OPTIONS[n] ?? FORM_FACTOR_OPTIONS[formFactor()] ?? FORM_FACTOR_OPTIONS['desktop']) };
}
/** A new context shaped like the current project (+ the desktop-app bridge when that is the project). */
export async function newFormFactorContext(browser: Browser, extra: BrowserContextOptions = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...contextOptions(), ...extra });
  if (isDesktopApp()) await installDesktopBridge(ctx);
  return ctx;
}

// ───────────────────────── the desktop-app bridge ─────────────────────────

export interface BridgeCall { api: string; args: unknown[]; at: number }

/**
 * A stub of `window.electronAPI` (electron/preload.js), just enough for the renderer:
 *  - `isElectron: true` → PlatformService.isElectron, html.electron, hash routing (app.config.ts), device-desktop;
 *  - every method answers like main would when idle (null / [] / { ok: true }) and is RECORDED in
 *    `window.__pfBridgeCalls` ({ api: 'whatsapp.open', args }) — byte arrays are recorded as their length;
 *  - `whatsapp.open` / `close` / `setPdf` drive the dock state like electron/whatsapp-dock.js (open, width, top, pdfName,
 *    clipboard: 'copied' when the PDF was put on the clipboard);
 *  - a deep path (`/frontdesk`) is turned into the hash route Electron uses (`/#/frontdesk`) before the app boots, so
 *    specs keep `page.goto('/frontdesk')`. Only on the local app origin (never on a WhatsApp stub page).
 * Specs that need more (the analyzer wizard's `instruments.diag`) MERGE into `window.electronAPI`.
 */
export async function installDesktopBridge(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    if (w['__pfBridgeInstalled']) return;
    w['__pfBridgeInstalled'] = true;
    const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /^https?:$/.test(location.protocol);
    if (local && window.top === window && location.pathname !== '/' && !location.hash && !/\.[a-z0-9]+$/i.test(location.pathname)) {
      history.replaceState(history.state, '', '/#' + location.pathname + location.search);
    }
    const calls: { api: string; args: unknown[]; at: number }[] = [];
    w['__pfBridgeCalls'] = calls;
    const clean = (a: unknown): unknown => {
      if (a instanceof Uint8Array || a instanceof ArrayBuffer) return { bytes: (a as Uint8Array).byteLength };
      if (typeof a === 'function') return '[fn]';
      if (a && typeof a === 'object') { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(a)) o[k] = clean(v); return o; }
      return a;
    };
    const rec = (api: string, args: unknown[]) => { calls.push({ api, args: args.map(clean), at: Date.now() }); };
    const subs = (): { list: ((x: unknown) => void)[]; on: (cb: (x: unknown) => void) => () => void } => {
      const list: ((x: unknown) => void)[] = [];
      return { list, on: cb => { list.push(cb); return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); }; } };
    };
    const fn = <T>(api: string, ret: (...a: any[]) => T) => (...a: unknown[]) => { rec(api, a); return ret(...a); };
    const async_ = <T>(api: string, ret: (...a: any[]) => T) => (...a: unknown[]) => { rec(api, a); return Promise.resolve(ret(...a)); };
    const noop = () => undefined;
    const off = () => () => undefined;

    const wa = subs();
    const st = { open: false, width: 0, top: 112, loading: false, failed: false, pdfName: null as string | null, clipboard: 'idle' as 'idle' | 'copied' | 'failed', url: '' };
    const dockWidth = () => Math.max(0, Math.min(Math.round(Math.min(480, Math.max(380, innerWidth * 0.24))), innerWidth - 560));
    const emit = () => wa.list.forEach(f => f({ ...st }));

    w['electronAPI'] = {
      platform: 'win32',
      isElectron: true,
      onMenuAction: fn('onMenuAction', noop),
      sendReady: fn('sendReady', noop),
      theme: { set: fn('theme.set', noop) },
      window: { isFullScreen: async_('window.isFullScreen', () => true), setFullScreen: async_('window.setFullScreen', () => true), onFullScreenChange: fn('window.onFullScreenChange', off) },
      printer: { status: async_('printer.status', () => ({ connected: false })), print: async_('printer.print', () => ({ ok: true })) },
      ble: { onDevices: fn('ble.onDevices', off), choose: fn('ble.choose', noop), cancel: fn('ble.cancel', noop) },
      calls: { incoming: fn('calls.incoming', noop), dismiss: fn('calls.dismiss', noop), onAction: fn('calls.onAction', off) },
      chatNotify: { show: fn('chatNotify.show', noop), onAction: fn('chatNotify.onAction', off) },
      notify: {
        getSettings: async_('notify.getSettings', () => null), setSettings: async_('notify.setSettings', () => null),
        alert: fn('notify.alert', noop), badge: fn('notify.badge', noop),
        getWindowState: async_('notify.getWindowState', () => ({ visible: true, focused: true, minimized: false })),
        onWindowState: fn('notify.onWindowState', off), onResume: fn('notify.onResume', off), onAction: fn('notify.onAction', off),
      },
      instruments: {
        list: async_('instruments.list', () => []), status: async_('instruments.status', () => []), onStatus: fn('instruments.onStatus', off),
        pair: async_('instruments.pair', () => ({ ok: true })), unpair: async_('instruments.unpair', () => ({ ok: true })), reload: async_('instruments.reload', () => ({ ok: true })),
        rawLog: async_('instruments.rawLog', () => []), listSerialPorts: async_('instruments.listSerialPorts', () => []),
        listenStart: async_('instruments.listenStart', () => ({ sessionId: 'l1' })), listenStop: async_('instruments.listenStop', () => ({})),
        onListen: fn('instruments.onListen', off), preview: async_('instruments.preview', () => ({})),
      },
      bridges: { discoverStart: async_('bridges.discoverStart', () => ({ ok: true })), discoverStop: async_('bridges.discoverStop', () => ({ ok: true })), onFound: fn('bridges.onFound', off), onLost: fn('bridges.onLost', off), localRequest: async_('bridges.localRequest', () => ({ ok: false })) },
      doc: { listPrinters: async_('doc.listPrinters', () => []), print: async_('doc.print', () => ({ ok: true })), printPdf: async_('doc.printPdf', () => ({ ok: true })) },
      whatsapp: {
        open: async_('whatsapp.open', (url: string) => { st.open = true; st.url = String(url); st.width = dockWidth(); st.loading = false; st.failed = false; st.pdfName = null; st.clipboard = 'idle'; emit(); return { ok: true }; }),
        close: async_('whatsapp.close', () => { st.open = false; st.pdfName = null; emit(); return { ok: true }; }),
        signOut: async_('whatsapp.signOut', () => ({ ok: true })),
        state: async_('whatsapp.state', () => ({ ...st })),
        onState: fn('whatsapp.onState', (cb: (x: unknown) => void) => wa.on(cb)),
        openElsewhere: async_('whatsapp.openElsewhere', () => ({ ok: true })),
        // like main: the PDF kept for the drag chip, and put on OUR clipboard when asked (whatsapp-clipboard.js)
        setPdf: async_('whatsapp.setPdf', (p: { name?: string; copyToClipboard?: boolean }) => { st.pdfName = String(p?.name || 'report.pdf').replace(/\.pdf$/i, '') + '.pdf'; if (p?.copyToClipboard) st.clipboard = 'copied'; emit(); return { ok: true }; }),
        startDrag: fn('whatsapp.startDrag', noop),
      },
      updater: { getState: async_('updater.getState', () => null), restartNow: async_('updater.restartNow', () => ({ ok: true })), check: async_('updater.check', () => null), onState: fn('updater.onState', off) },
    };
  });
}

/** Every bridge call the page made so far (desktop-app project; [] elsewhere). */
export async function bridgeCalls(page: Page, api?: string | RegExp): Promise<BridgeCall[]> {
  const all = await page.evaluate(() => ((window as unknown as { __pfBridgeCalls?: BridgeCall[] }).__pfBridgeCalls ?? []).map(c => ({ ...c })));
  if (!api) return all;
  return all.filter(c => (typeof api === 'string' ? c.api === api : api.test(c.api)));
}

/** The route of an app URL in either routing mode ("/#/lab/collect?x" and "/lab/collect?x" → "/lab/collect?x"). */
export function routeOf(url: string): string {
  const u = new URL(url);
  if (u.hash.startsWith('#/')) return u.hash.slice(1);
  return u.pathname + u.search;
}

// ───────────────────────── layout rules ─────────────────────────

/** Nothing scrolls sideways (the page, at any width). */
export async function expectNoHorizontalScroll(page: Page, tag = ''): Promise<void> {
  const over = await page.evaluate(() => {
    const d = document.documentElement;
    return Math.max(d.scrollWidth - d.clientWidth, document.body ? document.body.scrollWidth - d.clientWidth : 0);
  });
  expect(over, `${tag} horizontal overflow (px) at ${projectName()}`).toBeLessThanOrEqual(1);
}

/** The device tier the app chose for this form factor (html classes set by index.html / DeviceClassService). */
export async function expectDeviceTier(page: Page): Promise<void> {
  const html = await page.evaluate(() => ({ cls: document.documentElement.className, device: document.documentElement.getAttribute('data-device') }));
  const ff = formFactor();
  if (ff === 'phone') { expect(html.device, 'phone tier').toBe('phone'); expect(html.cls).toContain('device-touch'); }
  else if (ff === 'tablet') { expect(html.device, 'tablet tier').toBe('tablet'); expect(html.cls).toContain('device-touch'); }
  else { expect(html.device, 'desktop tier').toBe('desktop'); expect(html.cls).not.toContain('device-touch'); }
  if (ff === 'desktop-app') expect(html.cls, 'html.electron on the desktop app').toContain('electron');
  else expect(html.cls.split(/\s+/)).not.toContain('electron');
}

/** The nav for this form factor — the docked BOTTOM bar (`html.nav-bottom`, `.pf-topstrip-bar`) on every size, never a
 *  side rail and never the old floating pill:
 *  - phone: floating inside the screen edges (inset), along the bottom;
 *  - tablet (both orientations), desktop, desktop app: docked full width along the bottom;
 *  - touch (phone / tablet): the bar's buttons are finger-sized (≥ 40 px tall). */
export async function expectNav(page: Page): Promise<void> {
  const vw = page.viewportSize()!;
  const ff = formFactor();
  expect(await page.evaluate(() => document.documentElement.classList.contains('nav-bottom')), 'html.nav-bottom').toBe(true);
  const bar = page.locator('.pf-topstrip-bar').locator('visible=true').first();
  await expect(bar, 'bottom bar').toBeVisible();
  const b = (await bar.boundingBox())!;
  expect(b.y + b.height, 'bar sits on the bottom edge').toBeGreaterThanOrEqual(vw.height - 24);
  expect(b.y + b.height).toBeLessThanOrEqual(vw.height + 1);
  expect(b.x, 'bar inside the screen (left)').toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, 'bar inside the screen (right)').toBeLessThanOrEqual(vw.width + 0.5);
  if (ff === 'phone') expect(b.width, 'phone bar floats inside the edges').toBeLessThan(vw.width);
  else expect(b.width, 'docked full width').toBeGreaterThanOrEqual(vw.width - 1);
  // never a side rail / floating pill
  const rail = await page.locator('nav.pf-bottom-nav .pf-pill').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0).length);
  expect(rail, 'no side rail / pill').toBe(0);
  if (ff === 'phone' || ff === 'tablet') {
    const hs = await bar.locator('button, a').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0).map(r => Math.round(r.height)));
    expect(hs.length, 'bar has buttons').toBeGreaterThan(0);
    expect(Math.max(...hs), 'touch-sized bar buttons').toBeGreaterThanOrEqual(40);
  }
}

/** The shared layout rules every screen keeps at every form factor: the right tier, the right nav, no sideways scroll. */
export async function expectLayout(page: Page, tag = '', o: { nav?: boolean } = {}): Promise<void> {
  await expectDeviceTier(page);
  if (o.nav !== false) await expectNav(page);
  await expectNoHorizontalScroll(page, tag);
}

/** An element (a drawer, a sheet, a dialog) fits inside the viewport horizontally. */
export async function expectFitsWidth(page: Page, selector: string, tag = ''): Promise<void> {
  const vw = page.viewportSize()!;
  const loc = page.locator(selector).locator('visible=true').first();
  await expect(loc, `${tag} ${selector} is shown`).toBeVisible();
  // Drawers / sheets slide in: judge the settled position.
  const edges = async () => { const b = await loc.boundingBox(); return b ? [Math.round(b.x), Math.round(b.x + b.width)] : [NaN, NaN]; };
  await expect.poll(async () => { const [l, r] = await edges(); return l >= -1 && r <= vw.width + 1; },
    { message: `${tag} ${selector} fits the ${vw.width}px width at ${projectName()} (edges ${JSON.stringify(await edges())})`, timeout: 4_000 }).toBe(true);
}

/** EVERY visible match of `selector` (a row of actions) fits the width and no two overlap (a row that can't fit wraps). */
export async function expectRowFits(page: Page, selector: string, tag = ''): Promise<void> {
  const vw = page.viewportSize()!;
  const read = () => page.locator(selector).evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
    .map(r => ({ l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) })));
  await expect.poll(async () => {
    const bs = await read();
    const outside = bs.filter(x => x.l < -1 || x.r > vw.width + 1).length;
    let overlap = 0;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], c = bs[j];
      if (Math.min(a.r, c.r) - Math.max(a.l, c.l) > 1 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 1) overlap++;
    }
    return { count: bs.length > 0, outside, overlap };
  }, { message: `${tag} ${selector}: every item inside ${vw.width}px, none overlapping, at ${projectName()}`, timeout: 4_000 })
    .toEqual({ count: true, outside: 0, overlap: 0 });
}

/** `test` with the desktop-app bridge on every context of the desktop-app project. */
export const test = base.extend({
  context: async ({ context }, use) => {
    if (isDesktopApp()) await installDesktopBridge(context);
    await use(context);
  },
});
export { expect };
