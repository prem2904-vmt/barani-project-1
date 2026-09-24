import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
/** 'new' = the designer port (Figma 452-3); 'classic' = the pre-port look
 *  kept around so long-time users don't feel the change. */
export type DesignVersion = 'new' | 'classic';

const STORAGE_KEY = 'pf-theme';
const DESIGN_KEY = 'pf-design';
const MEDIA_QUERY = '(prefers-color-scheme: light)';

/**
 * UI switches lock (owner, 2026-09-24): everyone runs the NEW design with the
 * BOTTOM bar. The Classic/New switch, the Bottom-bar switch and Design mode
 * (capture) are hidden and stored preferences are ignored. Classic's code is
 * untouched — flip this to true to bring the switches back.
 */
export const UI_SWITCHES_ENABLED = false;

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly win = this.doc.defaultView;

  private readonly _mode = signal<ThemeMode>(this.readStoredMode());
  private readonly _resolved = signal<ResolvedTheme>(this.resolve(this._mode()));

  readonly mode = this._mode.asReadonly();
  readonly resolved = this._resolved.asReadonly();
  readonly isDark = computed(() => this._resolved() === 'dark');

  private readonly _design = signal<DesignVersion>(this.readStoredDesign());
  readonly design = this._design.asReadonly();
  readonly isNewDesign = computed(() => this._design() === 'new');

  /** EXPERIMENT (owner preview): bottom navbar — pages left, chat dock
   *  right. New design only; off by default. */
  private readonly _bottomNav = signal<boolean>(this.readStoredBottomNav());
  readonly bottomNav = this._bottomNav.asReadonly();

  /** Whether the design / bottom-bar switches are offered at all. */
  readonly switchesEnabled = UI_SWITCHES_ENABLED;

  private readonly _mediaListener = (e: MediaQueryListEvent) => {
    if (this._mode() === 'system') {
      this.apply(e.matches ? 'light' : 'dark');
    }
  };

  constructor() {
    this.apply(this._resolved());
    this.applyDesign(this._design());
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

  setDesign(version: DesignVersion): void {
    this._design.set(version);
    try { this.win?.localStorage.setItem(DESIGN_KEY, version); } catch { /* ignore */ }
    this.applyDesign(version);
  }

  toggleDesign(): void {
    this.setDesign(this._design() === 'new' ? 'classic' : 'new');
  }

  private applyDesign(version: DesignVersion): void {
    const root = this.doc.documentElement;
    root.classList.toggle('design-new', version === 'new');
    root.classList.toggle('design-classic', version === 'classic');
    root.setAttribute('data-design', version);
    // Bottom-nav experiment rides the same boot path.
    root.classList.toggle('nav-bottom', this._bottomNav());
  }

  toggleBottomNav(): void {
    const next = !this._bottomNav();
    this._bottomNav.set(next);
    try { this.win?.localStorage.setItem('pf-bottom-nav', next ? '1' : '0'); } catch { /* ignore */ }
    this.doc.documentElement.classList.toggle('nav-bottom', next);
  }

  private readStoredBottomNav(): boolean {
    if (!UI_SWITCHES_ENABLED) return true;
    try { return this.win?.localStorage.getItem('pf-bottom-nav') === '1'; } catch { return false; }
  }

  private readStoredDesign(): DesignVersion {
    if (!UI_SWITCHES_ENABLED) return 'new';
    try {
      const raw = this.win?.localStorage.getItem(DESIGN_KEY);
      if (raw === 'new' || raw === 'classic') return raw;
    } catch { /* ignore */ }
    return 'new';
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
