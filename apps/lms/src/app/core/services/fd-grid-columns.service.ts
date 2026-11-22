import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import {
  FD_MODULES, FdGridConfig, FdGridSettings, FdModule, fdConfigOf, fdHiddenKey, loadFdHidden, saveFdHidden, visibleFdColumns,
} from '../../shared/utils/fd-grid-columns';

/**
 * The Frontdesk WORK grid columns (Settings › <module> › Front desk › Work grid columns). Stored per BRANCH with the
 * Front desk's other settings (queue mode, booking slots, priority engine — `branch_appointment_configs`, key
 * `workGrid`): GET /api/appointments/work-grid (every module the branch saved), PUT /api/appointments/work-grid/<module>
 * (admin, like the sibling settings). One load per branch; a failure (no permission, offline) keeps the catalogue
 * defaults. The per-person hide list lives in localStorage (try/catch), only used while the admin lets staff hide.
 */
@Injectable({ providedIn: 'root' })
export class FdGridColumnsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  /** What the server returned (null until loaded / on failure = defaults). */
  readonly saved = signal<FdGridSettings | null>(null);
  private loadedFor: string | null = null;
  private inflight = false;
  /** Bumped when this person hides / shows a column (localStorage is not reactive). */
  private readonly hiddenVer = signal(0);

  private branchKey(): string {
    const u = this.auth.user();
    return `${u?.tenantId ?? ''}|${this.auth.activeBranchId() ?? u?.branchId ?? ''}`;
  }

  /** Load once per tenant + branch (the Frontdesk calls this when its grid appears). */
  ensureLoaded(): void {
    const key = this.branchKey();
    if (this.inflight || this.loadedFor === key) return;
    this.inflight = true;
    this.fetch().subscribe({
      next: () => { this.inflight = false; this.loadedFor = key; },
      error: () => { this.inflight = false; this.loadedFor = key; },
    });
  }

  /** Fresh read (the settings page). */
  fetch(): Observable<FdGridSettings> {
    return this.api.get<FdGridSettings>('/api/appointments/work-grid').pipe(tap(s => this.saved.set(s ?? {})));
  }

  save(module: FdModule, cfg: FdGridConfig): Observable<FdGridSettings> {
    return this.api.put<FdGridSettings>(`/api/appointments/work-grid/${module}`, { columns: cfg.columns, staffMayHide: cfg.staffMayHide })
      .pipe(tap(s => this.saved.set(s ?? { ...(this.saved() ?? {}), [module]: cfg })));
  }

  /** The admin's effective config for a module (merged with the catalogue). */
  configFor(module: FdModule): FdGridConfig {
    return fdConfigOf(module, this.saved()?.[module] ?? null);
  }

  readonly configs = computed(() => {
    const out = {} as Record<FdModule, FdGridConfig>;
    for (const m of FD_MODULES) out[m] = fdConfigOf(m, this.saved()?.[m] ?? null);
    return out;
  });

  private hiddenKey(module: FdModule): string {
    const u = this.auth.user();
    return fdHiddenKey(u?.tenantId, u?.id, module);
  }

  /** This person's hidden columns for a module ([] when the admin doesn't allow hiding). */
  hidden(module: FdModule): string[] {
    this.hiddenVer();
    return this.configs()[module].staffMayHide ? loadFdHidden(this.hiddenKey(module)) : [];
  }

  /** The columns this person sees, in order. */
  visible(module: FdModule): string[] {
    this.hiddenVer();
    return visibleFdColumns(module, this.configs()[module], this.hidden(module));
  }

  canHide(module: FdModule): boolean { return this.configs()[module].staffMayHide; }

  hide(module: FdModule, id: string): void {
    if (!this.canHide(module)) return;
    const list = loadFdHidden(this.hiddenKey(module));
    if (!list.includes(id)) saveFdHidden(this.hiddenKey(module), [...list, id]);
    this.hiddenVer.update(v => v + 1);
  }

  showAll(module: FdModule): void {
    saveFdHidden(this.hiddenKey(module), []);
    this.hiddenVer.update(v => v + 1);
  }
}
