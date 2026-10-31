import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  ALL_BETA_OFF, BETA_FEATURE_KEYS, BETA_HEADER, BetaFeatureFlags, BetaFeatureKey, BetaStorage,
  betaHeaderValue, betaHeaders, betaVisible, installPfBeta, isDevEnvironment, parseBetaFlags,
  readBetaSwitches, safeBetaStorage,
} from '../beta/beta-gate';

export type { BetaFeatureFlags, BetaFeatureKey } from '../beta/beta-gate';

/**
 * THE beta gate for the UI (rule in core/beta/beta-gate.ts). Every beta
 * surface — routes (`betaGuard(key)`), tiles, menu items — asks
 * {@link enabled}; nothing else decides beta visibility.
 *
 *   enabled(key) = console switch pf.<key>() in this browser
 *               && server allows (GET /api/beta-features, sent with X-PF-BETA)
 *               && dev environment
 *
 * Generic: the passkeys / assistant builders reuse it as-is.
 */
@Injectable({ providedIn: 'root' })
export class BetaFeaturesService {
  static readonly TIMEOUT_MS = 5000;

  protected readonly storage: BetaStorage | null = this.openStorage();
  /** Read once per page load: `pf.<name>()` reloads the page to apply. */
  private readonly switches = signal<BetaFeatureFlags>(readBetaSwitches(this.storage));
  private readonly server = signal<BetaFeatureFlags>({ ...ALL_BETA_OFF });
  private readonly _loaded = signal(false);
  private inFlight: Promise<void> | null = null;

  readonly loaded = this._loaded.asReadonly();
  /** Effective flags. */
  readonly flags = computed<BetaFeatureFlags>(() => {
    const sw = this.switches();
    const srv = this.server();
    const isDev = this.isDev();
    const out = { ...ALL_BETA_OFF };
    for (const k of BETA_FEATURE_KEYS) out[k] = betaVisible({ switchOn: sw[k], serverAllowed: srv[k], isDev });
    return out;
  });

  /** The browser's localStorage (overridable in specs). */
  protected openStorage(): BetaStorage | null { return safeBetaStorage(); }

  /** Dev build / runtime? Reads `environment` lazily (runtime config merges first). */
  protected isDev(): boolean { return isDevEnvironment(environment); }

  enabled(key: BetaFeatureKey): boolean {
    return this.flags()[key];
  }

  /** Install `window.pf.mcp() / passkeys() / assistant() / beta()` silently. Once at app start. */
  install(): void {
    if (typeof window === 'undefined' || !this.storage) return;
    installPfBeta(window as unknown as { pf?: Record<string, unknown> } & Record<string, unknown>,
      this.storage, () => { try { window.location.reload(); } catch { /* noop */ } });
  }

  /** Ask the server once (single-flight). Never throws; failure keeps everything OFF. */
  ensureLoaded(): Promise<void> {
    this.inFlight ??= this.fetchFlags();
    return this.inFlight;
  }

  private async fetchFlags(): Promise<void> {
    // No switch on, or not dev: nothing can turn on — don't ask.
    if (!betaHeaderValue(this.storage) || !this.isDev()) { this._loaded.set(true); return; }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const killer = setTimeout(() => ctrl?.abort(), BetaFeaturesService.TIMEOUT_MS);
    try {
      const res = await fetch(`${environment.apiUrl}/api/beta-features`, {
        headers: betaHeaders(this.storage), cache: 'no-store', signal: ctrl?.signal,
      });
      if (res.ok) this.server.set(parseBetaFlags(await res.json().catch(() => null)));
    } catch { /* offline / blocked — stays OFF */ }
    finally {
      clearTimeout(killer);
      this._loaded.set(true);
    }
  }
}

/** Route gate for a beta surface: off ⇒ the app's normal unknown-URL handling
 *  (the `**` route sends it to the landing, '/'). */
export function betaGuard(key: BetaFeatureKey): CanActivateFn {
  return async () => {
    const beta = inject(BetaFeaturesService);
    const router = inject(Router);
    await beta.ensureLoaded();
    return beta.enabled(key) ? true : router.createUrlTree(['/']);
  };
}

/**
 * True only for requests to OUR API: the configured API base (`environment.apiUrl`, which the
 * runtime /config.json fills in) followed by `/api`, or a relative `/api…` URL when no absolute
 * base is configured. A third-party URL that merely contains "/api/" never matches.
 */
export function isOurApiRequest(url: string, apiBase: string): boolean {
  const base = (apiBase ?? '').trim().replace(/\/+$/, '');
  if (!base) return url.startsWith('/api') && !url.startsWith('//');
  return url.toLowerCase().startsWith(`${base.toLowerCase()}/api`);
}

/**
 * While any beta console switch is on, every request to OUR API carries
 * `X-PF-BETA: <comma list>`. No switch ⇒ requests are untouched. Never
 * touches third-party URLs (Supabase, signed storage links, anything else).
 */
export function makeBetaHeaderInterceptor(
  storage: () => BetaStorage | null = safeBetaStorage,
  apiBase: () => string = () => environment.apiUrl,
): HttpInterceptorFn {
  return (req, next) => {
    if (!isOurApiRequest(req.url, apiBase()) || req.headers.has(BETA_HEADER)) return next(req);
    const v = betaHeaderValue(storage());
    return v ? next(req.clone({ setHeaders: { [BETA_HEADER]: v } })) : next(req);
  };
}
export const betaHeaderInterceptor: HttpInterceptorFn = makeBetaHeaderInterceptor();
