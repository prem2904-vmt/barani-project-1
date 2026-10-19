import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';

/**
 * Counts in-flight API requests so a load-driven transition (the branch
 * switch veil) can hold until the new screen's data has actually arrived,
 * instead of guessing with a fixed timer. Read-only bookkeeping: requests
 * are never altered, delayed or retried here.
 */
@Injectable({ providedIn: 'root' })
export class HttpActivityService {
  private readonly _pending = signal(0);
  /** API requests currently in flight. */
  readonly pending = this._pending.asReadonly();
  readonly busy = computed(() => this._pending() > 0);

  begin(): void { this._pending.update(n => n + 1); }
  end(): void { this._pending.update(n => Math.max(0, n - 1)); }

  /**
   * Resolve once no request has been in flight for `quietMs` (a screen's
   * first wave often chains a second fetch), or after `maxMs` at the latest
   * so a slow/stuck call never traps the UI behind the veil.
   */
  whenIdle(opts: { quietMs?: number; maxMs?: number } = {}): Promise<void> {
    const quietMs = opts.quietMs ?? 120;
    const maxMs = opts.maxMs ?? 5000;
    return new Promise<void>(resolve => {
      const started = Date.now();
      let quietSince = this._pending() === 0 ? Date.now() : 0;
      const tick = () => {
        const t = Date.now();
        if (this._pending() === 0) {
          if (!quietSince) quietSince = t;
          if (t - quietSince >= quietMs) { resolve(); return; }
        } else {
          quietSince = 0;
        }
        if (t - started >= maxMs) { resolve(); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    });
  }
}

/** Only our own API calls count (not fonts, uploads blobs, Supabase auth). */
function isApi(url: string): boolean {
  return url.startsWith('/api') || url.includes('/api/');
}

export const httpActivityInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApi(req.url)) return next(req);
  const activity = inject(HttpActivityService);
  activity.begin();
  return next(req).pipe(finalize(() => activity.end()));
};
