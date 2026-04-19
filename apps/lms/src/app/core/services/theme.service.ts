import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'pf-theme';
const MEDIA_QUERY = '(prefers-color-scheme: light)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly win = this.doc.defaultView;

  private readonly _mode = signal<ThemeMode>(this.readStoredMode());
  private readonly _resolved = signal<ResolvedTheme>(this.resolve(this._mode()));

  readonly mode = this._mode.asReadonly();
  readonly resolved = this._resolved.asReadonly();
  readonly isDark = computed(() => this._resolved() === 'dark');

  private readonly _mediaListener = (e: MediaQueryListEvent) => {
    if (this._mode() === 'system') {
      this.apply(e.matches ? 'light' : 'dark');
    }
  };

  constructor() {
    this.apply(this._resolved());
    const mq = this.mediaQuery();
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', this._mediaListener);
    }
  }

  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
    try { this.win?.localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
    this.apply(this.resolve(mode));
  }

  toggle(): void {
    // toggle between dark and light; 'system' is treated as its current resolution.
    this.setMode(this._resolved() === 'dark' ? 'light' : 'dark');
  }

  clearOverride(): void {
    this.setMode('system');
  }

  private resolve(mode: ThemeMode): ResolvedTheme {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    return this.systemPrefersLight() ? 'light' : 'dark';
  }

  private systemPrefersLight(): boolean {
    return this.mediaQuery()?.matches ?? false;
  }

  private mediaQuery(): MediaQueryList | null {
    return this.win?.matchMedia ? this.win.matchMedia(MEDIA_QUERY) : null;
  }

  private apply(resolved: ResolvedTheme): void {
    this._resolved.set(resolved);
    const root = this.doc.documentElement;
    const useVT = typeof (this.doc as Document & { startViewTransition?: () => unknown }).startViewTransition === 'function';

    const mutate = () => {
      root.classList.remove('dark', 'light');
      root.classList.add(resolved);
      root.setAttribute('data-theme', resolved);
      root.setAttribute('data-theme-mode', this._mode());
      // Keep the browser chrome in sync on mobile
      const meta = this.doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
      if (meta) meta.content = resolved === 'dark' ? '#0a0a15' : '#ede8f6';
    };

    if (useVT) {
      (this.doc as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(mutate);
    } else {
      mutate();
    }
  }

  private readStoredMode(): ThemeMode {
    try {
      const raw = this.win?.localStorage.getItem(STORAGE_KEY);
      if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
    } catch { /* ignore */ }
    return 'system';
  }
}
