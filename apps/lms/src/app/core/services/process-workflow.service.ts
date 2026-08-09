import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ProcessWorkflowConfig, ProcessWorkflowRecord, collectsInLab, enforceCollectInLab } from '../../shared/models/process-workflow.model';

/**
 * Loads the tenant's ACTIVE process workflow (which drives navigation) and
 * provides CRUD for the admin builder. The active config is exposed as a
 * signal so the nav can react to it; falls back to null (hard-coded nav) when
 * none is set or the request fails.
 */
@Injectable({ providedIn: 'root' })
export class ProcessWorkflowService {
  private readonly api = inject(ApiService);

  private readonly _active = signal<ProcessWorkflowConfig | null>(null);
  readonly active = this._active.asReadonly();
  private loadPromise: Promise<void> | null = null;

  /** Load the active workflow once (idempotent — safe to call from nav). */
  loadActive(): void { void this.ensureLoaded(); }

  /** Resolve once the active workflow has loaded (used by the route guard so
   *  it decides on real data, not an empty default). Cached after first call. */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.fetch();
    return this.loadPromise;
  }

  /** Force a re-fetch (after the admin saves/activates a workflow). */
  refreshActive(): void { this.loadPromise = this.fetch(); }

  private fetch(): Promise<void> {
    return new Promise<void>(resolve => {
      this.api.get<ProcessWorkflowRecord | null>('/api/process-workflows/active').subscribe({
        next: w => { this._active.set(this.parse(w?.configJson)); resolve(); },
        error: () => { this._active.set(null); resolve(); },
      });
    });
  }

  /**
   * Is an action (treated as a placeable component) switched on in the active
   * workflow? Screens use this to show/hide their sub-components — e.g. the
   * Frontdesk "Appointments" tab is gated on `appointment`. Safe defaults:
   * no active workflow, or an action the workflow doesn't mention, ⇒ true
   * (never hide a component just because the workflow is silent about it).
   */
  isEnabled(type: string): boolean {
    const cfg = this._active();
    if (!cfg) return true;
    const a = cfg.actions?.find(x => x.type === type);
    return a ? a.enabled : true;
  }

  /**
   * Is "dispatch" a genuine front-desk→lab handoff step in this workflow?
   *
   * Unlike {@link isEnabled} (opt-out: silent ⇒ on), dispatch is OPT-IN and must
   * mirror the backend `ShouldAutoReceiveAsync`: a tube auto-receives into the lab
   * on collection — leaving no dispatch step — when the workflow collects in-lab,
   * OR omits/disables `lab_intake`, OR omits/disables `dispatch`. Only when none of
   * those hold is dispatch a real step. No active workflow ⇒ classic flow, which
   * does include dispatch. Screens use this to hide the Dispatch button/holds when
   * the workflow has no dispatch step (else the button rejects every attempt).
   */
  dispatchStepEnabled(): boolean {
    const cfg = this._active();
    if (!cfg) return true;                 // classic flow — dispatch exists
    if (collectsInLab(cfg)) return false;  // drawn at the bench ⇒ auto-received
    const on = (type: string) => !!cfg.actions?.find(x => x.type === type)?.enabled;
    return on('lab_intake') && on('dispatch');
  }

  /** Which menu/work-area an action is placed in (null if not placed/enabled). */
  placedIn(type: string): string | null {
    const a = this._active()?.actions?.find(x => x.type === type && x.enabled);
    return a?.categoryId ?? null;
  }

  /** True when sample collection happens inside the lab (the tube is drawn at the
   *  bench, so the lab shows a Collect step instead of Lab Intake and the sample
   *  auto-receives into the work queue). Silent workflow ⇒ false (classic flow). */
  collectsInLab(): boolean {
    return collectsInLab(this._active());
  }

  private parse(json?: string | null): ProcessWorkflowConfig | null {
    if (!json) return null;
    try {
      const c = JSON.parse(json) as ProcessWorkflowConfig;
      return Array.isArray(c?.categories) ? { categories: c.categories ?? [], actions: c.actions ?? [] } : null;
    } catch { return null; }
  }

  // ── Builder CRUD ─────────────────────────────────────────────────
  list(): Observable<ProcessWorkflowRecord[]> { return this.api.get<ProcessWorkflowRecord[]>('/api/process-workflows'); }
  create(name: string, config: ProcessWorkflowConfig, branchId: string | null = null): Observable<ProcessWorkflowRecord> {
    const cfg = enforceCollectInLab(config);
    return this.api.post<ProcessWorkflowRecord>('/api/process-workflows', { name, configJson: JSON.stringify(cfg), branchId });
  }
  update(id: string, name: string, config: ProcessWorkflowConfig, branchId: string | null = null): Observable<ProcessWorkflowRecord> {
    const cfg = enforceCollectInLab(config);
    return this.api.put<ProcessWorkflowRecord>(`/api/process-workflows/${id}`, { name, configJson: JSON.stringify(cfg), branchId });
  }
  activate(id: string): Observable<ProcessWorkflowRecord> { return this.api.post<ProcessWorkflowRecord>(`/api/process-workflows/${id}/activate`, {}); }
  duplicate(id: string): Observable<ProcessWorkflowRecord> { return this.api.post<ProcessWorkflowRecord>(`/api/process-workflows/${id}/duplicate`, {}); }
  remove(id: string): Observable<void> { return this.api.delete<void>(`/api/process-workflows/${id}`); }
}
