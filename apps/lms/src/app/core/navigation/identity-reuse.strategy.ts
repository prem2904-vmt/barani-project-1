import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

/** Route `data` key: the identity of the record a screen shows. */
export const RECREATE_ON = 'recreateOn';

/**
 * Angular REUSES a routed component when only its params/query change
 * (/lab/culture/A → /lab/culture/B). A screen that reads its record id once
 * in ngOnInit then keeps showing A — the draft-shelf "I tapped B and still
 * see A" bug. Screens without an in-place switch of their own opt in here:
 *
 *   data: { recreateOn: ['orderTestId', '?stage'] }
 *
 * lists the path params (bare) and query params ('?name') that identify the
 * record. When any of them changes, the old component is destroyed (its
 * ngOnDestroy saves / cleans up) and a fresh one loads the new record — a
 * full reset, with nothing left over from A. Same identity → reused as
 * before (a same-URL tap reloads nothing). Routes without the key keep
 * Angular's default behaviour exactly.
 *
 * Screens with their own in-place switch (sample result entry's tube tabs,
 * Order & Payments' patient pick) stay reused and react to the param
 * streams instead.
 */
@Injectable()
export class IdentityRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.routeConfig !== curr.routeConfig) return false;
    const keys = future.routeConfig?.data?.[RECREATE_ON] as readonly string[] | undefined;
    if (!keys?.length) return true;
    return keys.every(k => identityOf(future, k) === identityOf(curr, k));
  }
}

function identityOf(s: ActivatedRouteSnapshot, key: string): string {
  const v = key.startsWith('?') ? s.queryParamMap.get(key.slice(1)) : s.paramMap.get(key);
  return v ?? '';
}
