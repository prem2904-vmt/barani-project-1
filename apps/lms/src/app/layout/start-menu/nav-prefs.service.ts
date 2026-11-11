import { Injectable, InjectionToken, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { RoleNav, mergeRoleDefaults, navCapacity } from './nav-pins';

/** Where a person's bar choices live: THIS browser, never the server (owner 2026-11-11). Swappable in tests. */
export const NAV_PREFS_STORAGE = new InjectionToken<() => Storage | null>('pf.nav.prefs.storage', {
  providedIn: 'root',
  factory: () => () => {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
  },
});

export interface NavPrefs {
  v: 1;
  /** null = never customised (the role's defaults apply). */
  pinned: string[] | null;
  iconsOnly: boolean;
}

const DEFAULT_PREFS: NavPrefs = { v: 1, pinned: null, iconsOnly: false };

/** Read one stored value; anything unreadable, corrupt or of another shape is "never customised". Pure. */
export function parsePrefs(raw: string | null): NavPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const j = JSON.parse(raw) as Partial<NavPrefs> | null;
    if (!j || typeof j !== 'object' || j.v !== 1) return { ...DEFAULT_PREFS };
    const pinned = Array.isArray(j.pinned) && j.pinned.every(x => typeof x === 'string') ? [...j.pinned] : null;
    return { v: 1, pinned, iconsOnly: j.iconsOnly === true };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * The person's bar choices (pinned screens + icons-only) in localStorage, plus the admin's per-role
 * defaults from `GET /api/tenants/nav-defaults` (loaded once per session). A blocked or full storage,
 * or a failed defaults call, never blocks the bar: the choice then lives in memory for the session.
 * The bar itself is decided only by `nav-pins.ts` (`computeNavLayout`).
 */
@Injectable({ providedIn: 'root' })
export class NavPrefsService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly storage = inject(NAV_PREFS_STORAGE);

  /** `pf.nav.prefs.<tenantId>.<userId>`; null while nobody is signed in. */
  readonly key = computed<string | null>(() => {
    const u = this.auth.user();
    return u ? `pf.nav.prefs.${u.tenantId}.${u.id}` : null;
  });

  /** Values written this session (so a blocked storage still remembers them until reload). */
  private readonly written = signal<Record<string, NavPrefs>>({});

  readonly prefs = computed<NavPrefs>(() => {
    const k = this.key();
    if (!k) return { ...DEFAULT_PREFS };
    const w = this.written()[k];
    if (w) return w;
    try { return parsePrefs(this.storage()?.getItem(k) ?? null); } catch { return { ...DEFAULT_PREFS }; }
  });

  readonly pinned = computed(() => this.prefs().pinned);
  readonly iconsOnly = computed(() => this.prefs().iconsOnly);

  private readonly viewportW = signal(typeof window !== 'undefined' ? window.innerWidth : 1440);
  /** How many screens fit on the bar at this width (and icons-only setting). */
  readonly capacity = computed(() => navCapacity(this.viewportW(), this.iconsOnly()));

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.viewportW.set(window.innerWidth));
    }
    // The bar needs the role defaults from the first paint after sign-in, not only once the menu opens.
    effect(() => {
      if (this.key()) untracked(() => this.ensureDefaults());
    });
  }

  private write(next: NavPrefs): void {
    const k = this.key();
    if (!k) return;
    this.written.update(w => ({ ...w, [k]: next }));
    try { this.storage()?.setItem(k, JSON.stringify(next)); } catch { /* blocked / full: memory only */ }
  }

  setPinned(ids: string[]): void {
    this.write({ ...this.prefs(), pinned: [...ids] });
  }

  setIconsOnly(on: boolean): void {
    this.write({ ...this.prefs(), iconsOnly: on });
  }

  /** "Reset to my role's defaults": forget the personal pins (icons-only is a display choice and stays). */
  resetPins(): void {
    this.write({ ...this.prefs(), pinned: null });
  }

  // ── The admin's per-role defaults ──────────────────────────────────────────

  private readonly _roleMap = signal<Record<string, RoleNav> | null>(null);
  readonly roleMap = this._roleMap.asReadonly();
  private loadedFor: string | null = null;

  /** Merged defaults for the roles this person holds; null = none configured. */
  readonly roleDefaults = computed(() => mergeRoleDefaults(this._roleMap(), this.auth.user()?.roles ?? []));

  /** Load the defaults once per session (and again if another account signs in). A failure means "no defaults". */
  ensureDefaults(): void {
    const k = this.key();
    if (!k || this.loadedFor === k) return;
    this.loadedFor = k;
    this._roleMap.set(null);
    this.api.get<{ roles?: Record<string, RoleNav> }>('/api/tenants/nav-defaults').subscribe({
      next: d => this._roleMap.set(d?.roles ?? {}),
      error: () => this._roleMap.set(null),
    });
  }

  /** manage_roles only (the server enforces it): replace every role's defaults. */
  saveRoleDefaults(roles: Record<string, RoleNav>): Observable<unknown> {
    return this.api.put('/api/tenants/nav-defaults', { roles }).pipe(tap(() => this._roleMap.set(roles)));
  }
}
