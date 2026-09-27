import { App } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { BarsTheme, NativeBarsHost } from './system-bars.token';

/**
 * OS chrome (status bar, Android navigation bar, Electron window) follows the
 * app's ACTIVE theme. Driven only by ThemeService — no per-screen calls.
 *
 * Owner, real iPad in the light theme: the status bar stayed WHITE text over
 * the light top band (the app set Style.Dark once at boot and never again).
 *
 *   light theme → dark bar content  (Capacitor Style.Light / SystemBarsStyle.Light)
 *   dark  theme → light bar content (Style.Dark / SystemBarsStyle.Dark)
 *
 * Web and plain desktop browsers: no-op (the <meta name="theme-color"> the
 * ThemeService already keeps in sync is all a browser takes).
 *
 * Lazy-loaded by ThemeService (keeps the plugin wrappers out of the initial
 * bundle); the DI seam lives in system-bars.token.ts.
 */
export type { BarsHostKind, BarsTheme, NativeBarsHost } from './system-bars.token';

/** Solid fallbacks, same as the theme-color metas in index.html. Only used
 *  where the OS still paints a bar background itself (Android < 15, the
 *  Electron window behind the page); edge-to-edge bars stay transparent and
 *  the app's own band / navbar shows through. */
export const SYSTEM_BAR_COLORS: Readonly<Record<BarsTheme, string>> = {
  dark: '#0a0a15',
  light: '#ede8f6',
};

type ElectronThemeApi = { theme?: { set?: (t: { theme: BarsTheme; background: string }) => void } };
const electronApi = (): ElectronThemeApi | null =>
  (typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: ElectronThemeApi & { isElectron?: boolean } }).electronAPI ?? null
    : null);

/** The real host: Capacitor plugins on native, the preload bridge on Electron. */
export function capacitorBarsHost(): NativeBarsHost {
  return {
    kind() {
      const p = Capacitor.getPlatform();
      if (p === 'ios' || p === 'android') return p;
      return electronApi() ? 'electron' : 'web';
    },
    async setStatusBarStyle(style) {
      await StatusBar.setStyle({ style: style === 'LIGHT' ? Style.Light : Style.Dark });
    },
    async reserveStatusBar() {
      await StatusBar.setOverlaysWebView({ overlay: false });
    },
    async setStatusBarBackground(color) {
      await StatusBar.setBackgroundColor({ color });
    },
    async setSystemBarsStyle(style) {
      await SystemBars.setStyle({ style: style === 'LIGHT' ? SystemBarsStyle.Light : SystemBarsStyle.Dark });
    },
    setElectronTheme(theme, background) {
      electronApi()?.theme?.set?.({ theme, background });
    },
    onResume(cb) {
      const p = Capacitor.getPlatform();
      if (p !== 'ios' && p !== 'android') return;
      // iOS can hand back a status-bar style from the system after the app
      // was backgrounded (share sheet, camera, call UI) — re-assert ours.
      void App.addListener('resume', cb).catch(() => undefined);
    },
  };
}

/** Bar-content style for a theme: dark text on light, light text on dark. */
export function barStyleFor(theme: BarsTheme): 'DARK' | 'LIGHT' {
  return theme === 'light' ? 'LIGHT' : 'DARK';
}

/**
 * Push the theme to the OS chrome. Never throws — a missing plugin (older
 * native build) or a web host simply does nothing.
 */
export async function syncSystemBars(host: NativeBarsHost, theme: BarsTheme): Promise<void> {
  const style = barStyleFor(theme);
  const color = SYSTEM_BAR_COLORS[theme];
  const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
  switch (host.kind()) {
    case 'ios':
      await quiet(host.setStatusBarStyle(style));
      return;
    case 'android':
      // Status + navigation bar icons (edge-to-edge: the bars are transparent
      // and the app paints under them), plus the painted colour on < 15.
      await quiet(host.reserveStatusBar());
      await quiet(host.setSystemBarsStyle(style));
      await quiet(host.setStatusBarStyle(style));
      await quiet(host.setStatusBarBackground(color));
      return;
    case 'electron':
      try { host.setElectronTheme(theme, color); } catch { /* old preload */ }
      return;
    default:
      return; // web: no-op
  }
}

/**
 * ThemeService's entry point (the only one): resolve the host, re-assert the
 * bars whenever the app comes back from the background, and hand back the
 * sync function for every resolved-theme change.
 */
export function connectSystemBars(
  override: NativeBarsHost | null,
  onResume: () => void,
): (theme: BarsTheme) => Promise<void> {
  const host = override ?? capacitorBarsHost();
  host.onResume(onResume);
  return (theme) => syncSystemBars(host, theme);
}
