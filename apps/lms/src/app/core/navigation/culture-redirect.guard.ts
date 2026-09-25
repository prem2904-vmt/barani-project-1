import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';
import { AuthService } from '../auth/auth.service';
import { OrderSample, OrderTest } from '../../shared/models/order.model';

/**
 * ONE culture route (owner). Every way into a sample — the band search /
 * scan on My Work, notifications, deep links, Completed, the report queue —
 * lands on /lab/sample/:id or /lab/result/:id. A CULTURE test (the same
 * culture-bench marker the Culture panel uses: parameters.microFormat ===
 * 'culture_sensitivity') must open the Culture case page
 * (/lab/culture/:orderTestId), exactly like the Culture tile. These guards
 * sit on those two routes, so every entry point (and old bookmarks) is
 * redirected in one place. Non-culture samples pass straight through.
 */

/** The Culture panel's marker: the test's Parameters blob says C&S. */
export function isCultureOrderTest(t: Pick<OrderTest, 'test'> | null | undefined): boolean {
  const raw = t?.test?.parameters;
  if (!raw) return false;
  try { return (JSON.parse(raw) as { microFormat?: string }).microFormat === 'culture_sensitivity'; }
  catch { return false; }
}

/** The culture test to open when the tube holds ONLY culture work, else
 *  null (a mixed tube stays on result entry for its other tests). */
export function cultureOnlyTest(s: Pick<OrderSample, 'tests'> | null | undefined): OrderTest | null {
  const tests = s?.tests ?? [];
  if (!tests.length) return null;
  const culture = tests.filter(t => isCultureOrderTest(t));
  return culture.length && culture.length === tests.length ? culture[0] : null;
}

/** Who may land on the Culture case page: the bench (culture_workbench), or
 *  — for sign-out review (?validate=1, /pathologist/validate) — a validator.
 *  Anyone else keeps the page they can open. */
function mayRedirect(query: { get(k: string): string | null }, review = false): boolean {
  const auth = inject(AuthService);
  if (review || query.get('validate')) return auth.hasPermission('validate_result');
  return auth.hasPermission('culture_workbench');
}

/** /lab/sample/:sampleId → /lab/culture/:orderTestId for a culture tube. */
export const cultureSampleRedirectGuard: CanActivateFn = async route => {
  const id = route.paramMap.get('sampleId');
  if (!id || !mayRedirect(route.queryParamMap)) return true;
  const api = inject(ApiService);
  const router = inject(Router);
  try {
    const t = cultureOnlyTest(await firstValueFrom(api.get<OrderSample>(`/api/samples/${id}/tests`)));
    return t ? router.createUrlTree(['/lab/culture', t.id]) : true;
  } catch { return true; }   // the page shows its own error
};

/** /lab/result/:id (per-test entry) → /lab/culture/:id for a culture test. */
export const cultureResultRedirectGuard: CanActivateFn = async route => {
  const id = route.paramMap.get('id');
  if (!id || !mayRedirect(route.queryParamMap)) return true;
  const api = inject(ApiService);
  const router = inject(Router);
  try {
    const t = await firstValueFrom(api.get<OrderTest>(`/api/results/${id}`));
    return isCultureOrderTest(t) ? router.createUrlTree(['/lab/culture', t.id || id]) : true;
  } catch { return true; }
};

/** /pathologist/validate/:id (old culture sign-out screen) → the Culture case
 *  page, where sign-out now lives. Non-culture results stay. */
export const cultureValidateRedirectGuard: CanActivateFn = async route => {
  const id = route.paramMap.get('id');
  if (!id || !mayRedirect(route.queryParamMap, true)) return true;
  const api = inject(ApiService);
  const router = inject(Router);
  try {
    const t = await firstValueFrom(api.get<OrderTest>(`/api/results/${id}`));
    return isCultureOrderTest(t) ? router.createUrlTree(['/lab/culture', t.id || id]) : true;
  } catch { return true; }
};
