import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { PlatformService } from './platform.service';

/** The PF Sense features an admin can switch (keys are a cross-repo contract). */
export type PfSenseFeatureKey = 'ast_disk_read' | 'instruments_assistant' | 'insights_assistant' | 'test_master_assistant' | 'report_tidy';
export const PF_SENSE_FEATURES: readonly PfSenseFeatureKey[] = ['ast_disk_read', 'instruments_assistant', 'insights_assistant', 'test_master_assistant', 'report_tidy'];

/** Server refusal codes that mean "the admin switch / cap changed" — re-read the status. */
export const PF_SENSE_REFUSALS: readonly string[] = ['pf_sense_off', 'ai_cap_reached'];

export interface PfSenseStatus {
  enabled: boolean;
  features: Partial<Record<PfSenseFeatureKey, boolean>>;
  limitReached: boolean;
}

/** Untrusted `GET /api/pf-sense/status` envelope → status, or null when it isn't one. */
export function parsePfSenseStatus(raw: unknown): PfSenseStatus | null {
  const env = raw as { success?: unknown; data?: unknown } | null;
  const d = env && typeof env === 'object' && env.success === true ? (env.data as Record<string, unknown> | null) : null;
  if (!d || typeof d !== 'object' || typeof d['enabled'] !== 'boolean') return null;
  const f = (d['features'] && typeof d['features'] === 'object' ? d['features'] : {}) as Record<string, unknown>;
  const features: PfSenseStatus['features'] = {};
  for (const k of PF_SENSE_FEATURES) if (typeof f[k] === 'boolean') features[k] = f[k] as boolean;
  return { enabled: d['enabled'] as boolean, features, limitReached: d['limitReached'] === true };
}

/**
 * THE gate for every PF Sense surface (rule in docs/ENGINEERING-RULES.md §6).
 * The platform admin switches PF Sense per lab, as a whole and per feature,
 * and sets a monthly cap; the SERVER enforces it. This service only decides
 * what the UI shows:
 *   featureOn(key) — effective switch (master AND feature AND cap > 0).
 *   limitReached() — the month's cap is used up.
 * Fail-open: a status read that fails (offline, 404 on an older backend)
 * keeps today's behaviour (show the feature) — the server still refuses.
 * A key the server did not send is ON unless the master switch is off.
 * Beta gates (BetaFeaturesService) stay separate and additional.
 *
 * Load once per session (single-flight, started by a surface's constructor —
 * never from a template or computed); `refresh()` re-reads after a
 * `pf_sense_off` / `ai_cap_reached` refusal so the UI converges.
 */
@Injectable({ providedIn: 'root' })
export class PfSenseService {
  static readonly TIMEOUT_MS = 8000;

  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);

  private readonly _status = signal<PfSenseStatus | null>(null);
  private readonly _loaded = signal(false);
  private inFlight: Promise<void> | null = null;

  /** True once the first read finished (success or failure). */
  readonly loaded = this._loaded.asReadonly();
  readonly status = this._status.asReadonly();
  readonly limitReached = computed(() => this._status()?.limitReached === true);
  /** Master switch (true when unknown). */
  readonly enabled = computed(() => this._status()?.enabled !== false);

  /** Effective switch for logic (fail-open: unknown = on; the server decides). */
  featureOn(key: PfSenseFeatureKey): boolean {
    const s = this._status();
    if (!s) return true;
    if (!s.enabled) return false;
    return s.features[key] !== false;
  }

  /** For DISPLAY: a surface appears only after the status is known (no flash of a feature about to vanish). */
  shown(key: PfSenseFeatureKey): boolean {
    return this._loaded() && this.featureOn(key);
  }

  /** Read the status once (single-flight, cached for the session). Never throws. */
  ensureLoaded(): Promise<void> {
    this.inFlight ??= this.fetchStatus();
    return this.inFlight;
  }

  /** Re-read (after a refusal). Coalesces concurrent calls. Never throws. */
  refresh(): Promise<void> {
    this.inFlight = this.fetchStatus();
    return this.inFlight;
  }

  /** Call with a failed feature call's error code: re-reads on an off / limit refusal. */
  noteRefusal(code: string | null | undefined): void {
    if (code && PF_SENSE_REFUSALS.includes(code)) void this.refresh();
  }

  private async fetchStatus(): Promise<void> {
    try {
      const raw = await firstValueFrom(
        this.http.get<unknown>(`${this.platform.getApiUrl()}/api/pf-sense/status`).pipe(timeout(PfSenseService.TIMEOUT_MS)),
      );
      const parsed = parsePfSenseStatus(raw);
      if (parsed) this._status.set(parsed);
    } catch { /* fail-open: keep what we had (nothing = everything shown) */ }
    finally { this._loaded.set(true); }
  }
}
