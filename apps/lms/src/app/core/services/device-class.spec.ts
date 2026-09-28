import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import {
  DeviceClass, DeviceEnv, applyDeviceClass, detectDeviceClass, isTouchFirst, readDeviceEnv,
} from './device-class';
import { DeviceClassService } from './device-class.service';

/**
 * Device class = which LAYOUT a device gets. The owner's rule: the native app
 * and tablets (Android, iPad) get the tablet / phone layout at EVERY width,
 * in portrait and landscape; real desktops and laptops with a mouse keep the
 * desktop layout.
 */

const UA = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  androidTabletChrome: 'Mozilla/5.0 (Linux; Android 14; moto pad) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; moto pad Build/U1TA; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Safari/537.36',
  // Chrome's "desktop site" (the default on big Android tablets).
  androidDesktopSite: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  chromeOS: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  iPadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

const touchOnly = { anyCoarse: true, coarse: true, anyFine: false, fine: false };
const mouseOnly = { anyCoarse: false, coarse: false, anyFine: true, fine: true, maxTouchPoints: 0 };

type Case = [string, DeviceEnv, DeviceClass];
const CASES: Case[] = [
  // Native app — always touch, whatever the width / UA / pointer.
  ['native iPad (WKWebView desktop UA, Magic Keyboard trackpad)', { nativePlatform: true, userAgent: UA.macSafari, maxTouchPoints: 5, anyFine: true, fine: true, screenShort: 1024 }, 'tablet'],
  ['native Android tablet (Moto Pad, 1280x800 landscape)', { nativePlatform: true, userAgent: UA.androidWebView, maxTouchPoints: 10, ...touchOnly, screenShort: 800 }, 'tablet'],
  ['native iPhone', { nativePlatform: true, userAgent: UA.iPhone, maxTouchPoints: 5, ...touchOnly, screenShort: 393 }, 'phone'],
  ['native Android phone', { nativePlatform: true, userAgent: UA.androidWebView, maxTouchPoints: 10, ...touchOnly, screenShort: 412 }, 'phone'],
  // iPadOS Safari in desktop-UA mode (the default) — also with a trackpad.
  ['iPad-as-Mac Safari', { userAgent: UA.macSafari, maxTouchPoints: 5, ...touchOnly, screenShort: 1024 }, 'tablet'],
  ['iPad-as-Mac Safari + Magic Keyboard trackpad', { userAgent: UA.macSafari, maxTouchPoints: 5, anyCoarse: true, coarse: false, anyFine: true, fine: true, screenShort: 1024 }, 'tablet'],
  ['iPad Safari (mobile UA)', { userAgent: UA.iPadSafari, maxTouchPoints: 5, ...touchOnly, screenShort: 834 }, 'tablet'],
  // Android tablet in Chrome.
  ['Android tablet Chrome (tablet UA)', { userAgent: UA.androidTabletChrome, maxTouchPoints: 10, ...touchOnly, screenShort: 800 }, 'tablet'],
  ['Android tablet Chrome "desktop site" (Linux UA)', { userAgent: UA.androidDesktopSite, maxTouchPoints: 10, ...touchOnly, screenShort: 800 }, 'tablet'],
  ['Android tablet Chrome "desktop site" + keyboard trackpad', { userAgent: UA.androidDesktopSite, maxTouchPoints: 10, anyCoarse: true, anyFine: true, fine: true, screenShort: 800 }, 'tablet'],
  ['Android tablet Chrome + keyboard trackpad (tablet UA)', { userAgent: UA.androidTabletChrome, maxTouchPoints: 10, anyCoarse: true, anyFine: true, fine: true, screenShort: 800 }, 'tablet'],
  // Phones on the web.
  ['iPhone Safari', { userAgent: UA.iPhone, maxTouchPoints: 5, ...touchOnly, screenShort: 393 }, 'phone'],
  ['Android phone Chrome', { userAgent: UA.androidPhone, maxTouchPoints: 5, ...touchOnly, screenShort: 412 }, 'phone'],
  // Touch-only browser with an unknown UA (e.g. a Windows tablet, keyboard off).
  ['Windows tablet, no keyboard / mouse', { userAgent: UA.winChrome, maxTouchPoints: 10, ...touchOnly, screenShort: 912 }, 'tablet'],
  // Desktops and laptops keep the desktop layout.
  ['Windows touch laptop with trackpad', { userAgent: UA.winChrome, maxTouchPoints: 10, anyCoarse: true, coarse: false, anyFine: true, fine: true, screenShort: 1080 }, 'desktop'],
  ['Windows touch laptop, primary coarse but a mouse attached', { userAgent: UA.winChrome, maxTouchPoints: 10, anyCoarse: true, coarse: true, anyFine: true, fine: false, screenShort: 1080 }, 'desktop'],
  ['desktop Mac Chrome', { userAgent: UA.macChrome, ...mouseOnly, screenShort: 900 }, 'desktop'],
  ['desktop Mac Safari', { userAgent: UA.macSafari, ...mouseOnly, screenShort: 982 }, 'desktop'],
  ['Windows desktop', { userAgent: UA.winChrome, ...mouseOnly, screenShort: 1080 }, 'desktop'],
  ['ChromeOS touch laptop with trackpad', { userAgent: UA.chromeOS, maxTouchPoints: 10, anyCoarse: true, anyFine: true, fine: true, screenShort: 900 }, 'desktop'],
  ['Electron on a touchscreen PC', { electron: true, userAgent: UA.winChrome, maxTouchPoints: 10, ...touchOnly, screenShort: 1080 }, 'desktop'],
];

describe('detectDeviceClass', () => {
  for (const [name, env, want] of CASES) {
    it(`${name} → ${want}`, () => expect(detectDeviceClass(env)).toBe(want));
  }

  it('rotation never flips the class — tablet vs phone keys on the SHORT side', () => {
    const tab = { userAgent: UA.androidTabletChrome, maxTouchPoints: 10, ...touchOnly };
    // 1280x800 landscape and 800x1280 portrait have the same short side.
    expect(detectDeviceClass({ ...tab, screenShort: Math.min(1280, 800) })).toBe('tablet');
    expect(detectDeviceClass({ ...tab, screenShort: Math.min(800, 1280) })).toBe('tablet');
    // iPad Pro 13" landscape / portrait.
    expect(detectDeviceClass({ userAgent: UA.macSafari, maxTouchPoints: 5, ...touchOnly, screenShort: 1024 })).toBe('tablet');
  });

  it('600 CSS px short side is the tablet floor; unknown size → tablet', () => {
    const t = { nativePlatform: true };
    expect(detectDeviceClass({ ...t, screenShort: 599 })).toBe('phone');
    expect(detectDeviceClass({ ...t, screenShort: 600 })).toBe('tablet');
    expect(detectDeviceClass({ ...t, screenShort: 0 })).toBe('tablet');
  });

  it('isTouchFirst: nothing at all → desktop (SSR / test env default)', () => {
    expect(isTouchFirst({})).toBe(false);
    expect(detectDeviceClass({})).toBe('desktop');
  });
});

describe('applyDeviceClass', () => {
  it('sets exactly one set of classes + data-device, and clears the previous one', () => {
    const root = document.createElement('html');
    applyDeviceClass(root, 'tablet');
    expect([...root.classList].sort()).toEqual(['device-tablet', 'device-touch']);
    expect(root.getAttribute('data-device')).toBe('tablet');
    applyDeviceClass(root, 'desktop');
    expect([...root.classList]).toEqual(['device-desktop']);
    applyDeviceClass(root, 'phone');
    expect([...root.classList].sort()).toEqual(['device-phone', 'device-touch']);
  });
});

/* ── index.html: the SAME rules run inline, before the first paint ── */

const INDEX = readFileSync(resolve(process.cwd(), 'apps/lms/src/index.html'), 'utf8');
const inlineScript = (): string => {
  const m = /<script id="pf-device-class">([\s\S]*?)<\/script>/.exec(INDEX);
  if (!m) throw new Error('pf-device-class inline script missing from index.html');
  return m[1];
};

/** Run the inline script against a fake window built from a DeviceEnv. */
function runInline(env: DeviceEnv): { cls: string[]; attr: string | null } {
  const root = document.createElement('html');
  const media: Record<string, boolean> = {
    '(any-pointer: coarse)': !!env.anyCoarse,
    '(pointer: coarse)': !!env.coarse,
    '(any-pointer: fine)': !!env.anyFine,
    '(pointer: fine)': !!env.fine,
  };
  const short = env.screenShort ?? 0;
  const win = {
    navigator: { userAgent: env.userAgent ?? '', maxTouchPoints: env.maxTouchPoints ?? 0 },
    matchMedia: (q: string) => ({ matches: !!media[q] }),
    screen: { width: short ? short + 400 : 0, height: short },
    innerWidth: 0, innerHeight: 0,
    Capacitor: env.nativePlatform ? { isNativePlatform: () => true } : undefined,
    electronAPI: env.electron ? { isElectron: true } : undefined,
  };
  new Function('window', 'document', inlineScript())(win, { documentElement: root });
  return { cls: [...root.classList].sort(), attr: root.getAttribute('data-device') };
}

describe('index.html pf-device-class (pre-paint, before Angular boots)', () => {
  it('runs in <head> BEFORE the app bundle and before the theme script', () => {
    const head = INDEX.slice(0, INDEX.indexOf('</head>'));
    expect(head).toContain('<script id="pf-device-class">');
    expect(INDEX.indexOf('pf-device-class')).toBeLessThan(INDEX.indexOf("localStorage.getItem('pf-theme')"));
    expect(INDEX.indexOf('pf-device-class')).toBeLessThan(INDEX.indexOf('<app-root>'));
  });

  for (const [name, env, want] of CASES) {
    it(`mirrors detectDeviceClass: ${name}`, () => {
      const r = runInline(env);
      const expected = want === 'desktop' ? ['device-desktop'] : ['device-touch', `device-${want}`].sort();
      expect(r.cls).toEqual(expected);
      expect(r.attr).toBe(want);
    });
  }

  it('a throwing environment falls back to the desktop class (never breaks boot)', () => {
    const root = document.createElement('html');
    const win = { get navigator() { throw new Error('boom'); } };
    new Function('window', 'document', inlineScript())(win, { documentElement: root });
    expect([...root.classList]).toEqual(['device-desktop']);
  });
});

describe('DeviceClassService', () => {
  afterEach(() => {
    for (const c of ['device-touch', 'device-tablet', 'device-phone', 'device-desktop']) document.documentElement.classList.remove(c);
  });

  it('applies the detected class to <html> at boot (jsdom = a mouse desktop)', () => {
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(DeviceClassService);
    expect(svc.deviceClass()).toBe(detectDeviceClass(readDeviceEnv(window)));
    expect(document.documentElement.getAttribute('data-device')).toBe(svc.deviceClass());
    expect(document.documentElement.classList.contains(`device-${svc.deviceClass()}`)).toBe(true);
  });

  it('App injects it eagerly (so the class is kept current from boot)', () => {
    const app = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/app.ts'), 'utf8');
    expect(app).toMatch(/inject\(DeviceClassService\)/);
  });
});
