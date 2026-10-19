import { WritableSignal } from '@angular/core';
import { MonoTypeOperatorFunction, Observable, defer, finalize } from 'rxjs';

/**
 * Per-row sibling of `busyWhile` (shared/utils/busy.ts): `slot` holds `key`
 * (the pressed row's id / the pressed action) while the request runs, and is
 * cleared when it completes, errors or is unsubscribed — unless another press
 * has already taken the slot. Drives `[pfBusy]="slot() === row.id"`.
 *
 *   this.api.patch(url, {}).pipe(busyIdWhile(this.dispatchingId, o.id)).subscribe(...)
 */
export function busyIdWhile<T, K>(slot: WritableSignal<K | null>, key: K): MonoTypeOperatorFunction<T> {
  return (source$: Observable<T>) => defer(() => {
    slot.set(key);
    return source$.pipe(finalize(() => { if (slot() === key) slot.set(null); }));
  });
}
