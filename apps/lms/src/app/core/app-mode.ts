import { CanMatchFn } from '@angular/router';
import { environment } from '../../environments/environment';

/**
 * WHICH APP this page load is (plan §4.4) — the one answer every shell-selection decision reads.
 *
 *  - `casesheets`: the public case-sheet site (prepare.prefrontal.health, served by this same LMS build). Only the
 *    public case-sheet routes can match (features/casesheets/casesheets.routes.ts); every LMS route is unmatchable.
 *  - `lms`: everything else (today's app). The public case-sheet routes do not exist.
 *
 * Decided by the host's `/config.json` `mode: 'casesheets'` (runtime-config merges it into `environment` before
 * bootstrap — the preferred switch, ENGINEERING-RULES "never branch on hostname"; an explicit `mode: 'lms'` also
 * wins) OR, when the config names no mode, as the plan's named fallback, the host itself. Read LAZILY (never at module
 * load) so the merged config is what counts.
 */
export type AppMode = 'lms' | 'casesheets';

/** Hosts that ARE the public case-sheet site (prod + dev; `casesheets-dev` is the parallel-run dev host, §11 Q3). */
export const CASESHEETS_HOST = /^(prepare(-dev)?|casesheets-dev)\.prefrontal\.health$/;

export function resolveAppMode(i: { configMode?: unknown; hostname?: string | null }): AppMode {
  if (i.configMode === 'casesheets' || i.configMode === 'lms') return i.configMode;
  return CASESHEETS_HOST.test((i.hostname ?? '').trim().toLowerCase()) ? 'casesheets' : 'lms';
}

function currentHostname(): string {
  try { return typeof location !== 'undefined' ? location.hostname : ''; } catch { return ''; }
}

/** This page load's mode (lazy: runtime config + host). */
export function appMode(): AppMode {
  return resolveAppMode({ configMode: (environment as { mode?: unknown }).mode, hostname: currentHostname() });
}

/** Top-level `canMatch`: the route group exists only in `mode`. Introspectable for the route specs. */
export function appModeMatch(mode: AppMode): CanMatchFn & { readonly appMode: AppMode } {
  const fn: CanMatchFn = () => appMode() === mode;
  return Object.assign(fn, { appMode: mode });
}
