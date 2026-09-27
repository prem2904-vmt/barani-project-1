import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { SYSTEM_BAR_COLORS, barStyleFor, capacitorBarsHost, syncSystemBars } from './system-bars';
import { BarsHostKind, BarsTheme, NATIVE_BARS_HOST, NativeBarsHost } from './system-bars.token';

/**
 * The OS chrome follows the ACTIVE theme (owner, real iPad, light theme: the
 * status bar stayed white text on the light top band). ThemeService is the
 * single driver; these pin the mapping and every trigger.
 */
type Call = [string, ...unknown[]];

function fakeHost(kind: BarsHostKind) {
  const calls: Call[] = [];
  let resume: (() => void) | null = null;
  const host: NativeBarsHost = {
    kind: () => kind,
    setStatusBarStyle: async (s) => { calls.push(['status', s]); },
    reserveStatusBar: async () => { calls.push(['reserve']); },
    setStatusBarBackground: async (c) => { calls.push(['statusBg', c]); },
    setSystemBarsStyle: async (s) => { calls.push(['systemBars', s]); },
    setElectronTheme: (t, bg) => { calls.push(['electron', t, bg]); },
    onResume: (cb) => { resume = cb; },
  };
  return { host, calls, resume: () => resume?.() };
}

/** A controllable (prefers-color-scheme: light) media query. */
function fakeScheme(initialLight: boolean) {
  let matches = initialLight;
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    get matches() { return matches; },
    media: '(prefers-color-scheme: light)',
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.push(l),
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
  const orig = window.matchMedia;
  window.matchMedia = ((q: string) => (q.includes('prefers-color-scheme') ? mql : orig?.call(window, q))) as typeof window.matchMedia;
  return {
    set(light: boolean) {
      matches = light;
      listeners.forEach((l) => l({ matches: light } as MediaQueryListEvent));
    },
    restore() { window.matchMedia = orig; },
  };
}

/** In-memory Storage on every global the service might read (the runner's
 *  own localStorage may be missing). */
const mem = new Map<string, string>();
const store = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;
vi.stubGlobal('localStorage', store);
for (const w of [window, document.defaultView]) {
  if (w) Object.defineProperty(w, 'localStorage', { configurable: true, get: () => store });
}

/** The bridge is a lazy chunk: let the import + the queued syncs settle. */
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5)); };
const lastStatus = (calls: Call[]) => [...calls].reverse().find((c) => c[0] === 'status')?.[1];

function boot(kind: BarsHostKind, stored: 'light' | 'dark' | 'system', systemLight = false) {
  localStorage.setItem('pf-theme', stored);
  const scheme = fakeScheme(systemLight);
  const fake = fakeHost(kind);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: NATIVE_BARS_HOST, useValue: fake.host }] });
  const theme = TestBed.inject(ThemeService);
  return { theme, scheme, ...fake };
}

describe('System bars follow the active theme', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; localStorage.removeItem('pf-theme'); });

  it('maps light → dark bar content (LIGHT) and dark → light content (DARK)', () => {
    expect(barStyleFor('light')).toBe('LIGHT');
    expect(barStyleFor('dark')).toBe('DARK');
  });

  it('iOS: boots in the stored theme, then every setMode re-styles the status bar', async () => {
    const t = boot('ios', 'light');
    restore = t.scheme.restore;
    await flush();
    expect(lastStatus(t.calls)).toBe('LIGHT');
    t.theme.setMode('dark');
    await flush();
    expect(lastStatus(t.calls)).toBe('DARK');
    t.theme.toggle();
    await flush();
    expect(lastStatus(t.calls)).toBe('LIGHT');
    // iOS touches only the status-bar style — no Android / Electron calls.
    expect(t.calls.every((c) => c[0] === 'status')).toBe(true);
  });

  it('system mode: a prefers-color-scheme change while open re-styles the bar', async () => {
    const t = boot('ios', 'system', /* systemLight */ false);
    restore = t.scheme.restore;
    await flush();
    expect(lastStatus(t.calls)).toBe('DARK');
    t.scheme.set(true);
    await flush();
    expect(t.theme.resolved()).toBe('light');
    expect(lastStatus(t.calls)).toBe('LIGHT');
    t.scheme.set(false);
    await flush();
    expect(lastStatus(t.calls)).toBe('DARK');
  });

  it('an explicit light/dark choice ignores system scheme changes', async () => {
    const t = boot('ios', 'dark', false);
    restore = t.scheme.restore;
    await flush();
    const n = t.calls.length;
    t.scheme.set(true);
    await flush();
    expect(t.calls.length).toBe(n);
    expect(lastStatus(t.calls)).toBe('DARK');
  });

  it('back from the background: re-asserts the style, re-resolving system mode', async () => {
    const t = boot('ios', 'system', false);
    restore = t.scheme.restore;
    await flush();
    t.calls.length = 0;
    t.resume();
    await flush();
    expect(t.calls).toEqual([['status', 'DARK']]);
    // Scheme flipped (listener already re-styled); resume keeps it right.
    t.scheme.set(true);
    t.calls.length = 0;
    t.resume();
    await flush();
    expect(lastStatus(t.calls)).toBe('LIGHT');
  });

  it('Android: status + navigation bar icons and the painted colour follow the theme', async () => {
    const t = boot('android', 'light');
    restore = t.scheme.restore;
    await flush();
    expect(t.calls).toEqual([
      ['reserve'],
      ['systemBars', 'LIGHT'],
      ['status', 'LIGHT'],
      ['statusBg', SYSTEM_BAR_COLORS.light],
    ]);
    t.calls.length = 0;
    t.theme.setMode('dark');
    await flush();
    expect(t.calls).toEqual([
      ['reserve'],
      ['systemBars', 'DARK'],
      ['status', 'DARK'],
      ['statusBg', SYSTEM_BAR_COLORS.dark],
    ]);
  });

  it('Electron: title bar + window background follow the theme', async () => {
    const t = boot('electron', 'light');
    restore = t.scheme.restore;
    await flush();
    expect(t.calls).toEqual([['electron', 'light', SYSTEM_BAR_COLORS.light]]);
    t.theme.setMode('dark');
    await flush();
    expect(t.calls.at(-1)).toEqual(['electron', 'dark', SYSTEM_BAR_COLORS.dark]);
    expect(SYSTEM_BAR_COLORS.dark).toBe('#0a0a15');
  });

  it('web: no-op — no plugin call, whatever the theme does', async () => {
    const t = boot('web', 'light');
    restore = t.scheme.restore;
    t.theme.setMode('dark');
    t.theme.setMode('system');
    t.scheme.set(true);
    t.resume();
    await flush();
    expect(t.calls).toEqual([]);
  });

  it('the real host resolves to web in a browser and never throws', async () => {
    const host = capacitorBarsHost();
    expect(host.kind()).toBe('web');
    for (const th of ['light', 'dark'] as BarsTheme[]) await expect(syncSystemBars(host, th)).resolves.toBeUndefined();
  });

  it('a failing plugin (old native build) is swallowed', async () => {
    const { host } = fakeHost('android');
    host.setSystemBarsStyle = () => Promise.reject(new Error('not implemented'));
    host.setStatusBarBackground = () => Promise.reject(new Error('not implemented'));
    await expect(syncSystemBars(host, 'light')).resolves.toBeUndefined();
  });

  it('ThemeService is the one driver, and loads the plugin bridge lazily (not in the initial bundle)', () => {
    const ts = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/core/services/theme.service.ts'), 'utf8');
    expect(ts).toMatch(/import\('\.\/system-bars'\)/);
    expect(ts).not.toMatch(/from '\.\/system-bars'/);
    expect(ts).not.toMatch(/@capacitor\//);
  });

  it('no per-screen / boot-time hard-coded status bar style is left', () => {
    const cap = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/core/services/capacitor.service.ts'), 'utf8');
    expect(cap).not.toMatch(/@capacitor\/status-bar/);
    expect(cap).not.toMatch(/StatusBar\.setStyle/);
    expect(cap).not.toMatch(/StatusBar\.setBackgroundColor/);
    expect(cap).not.toMatch(/#1B3A6B/i);
  });
});
