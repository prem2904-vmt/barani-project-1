import { InjectionToken } from '@angular/core';

/**
 * The seam between ThemeService and the OS chrome (status bar, Android
 * navigation bar, Electron window). Kept tiny and eager; the implementation
 * (system-bars.ts, with the Capacitor plugin calls) is lazy-loaded so it adds
 * nothing to the initial bundle. Specs provide a fake host here.
 */
export type BarsTheme = 'dark' | 'light';
export type BarsHostKind = 'ios' | 'android' | 'electron' | 'web';

export interface NativeBarsHost {
  kind(): BarsHostKind;
  /** iOS / Android status bar content style ('LIGHT' = dark text). */
  setStatusBarStyle(style: 'DARK' | 'LIGHT'): Promise<void>;
  /** Android: keep the WebView BELOW the status bar where the OS allows it
   *  (< 15; edge-to-edge 15+ ignores it and env() carries the inset). */
  reserveStatusBar(): Promise<void>;
  /** Android: status-bar colour where the OS still paints one (< 15). */
  setStatusBarBackground(color: string): Promise<void>;
  /** Android: status + navigation (gesture) bar icon style together. */
  setSystemBarsStyle(style: 'DARK' | 'LIGHT'): Promise<void>;
  /** Electron: native title bar + window background. */
  setElectronTheme(theme: BarsTheme, background: string): void;
  /** Run `cb` whenever the app returns from the background. */
  onResume(cb: () => void): void;
}

/** Optional override; unset = the real Capacitor / Electron host. */
export const NATIVE_BARS_HOST = new InjectionToken<NativeBarsHost>('NATIVE_BARS_HOST');
