/**
 * Pure predicates for the sample-collection dispatch footer. Kept out of the
 * component so the logic is unit-testable (the component itself has no test
 * harness). "Dispatched" means a tube has moved past `collected`; a fixed
 * done-status whitelist used to drift and leave the Dispatch button showing
 * after everything was already dispatched.
 */
import { isNotCollected } from '../../../shared/utils/sample-not-collected';

export interface DispatchSampleLike {
  status: string;
  collectedAt?: string | null;
}

/** True once every tube on the order has moved past `collected` — i.e. none is
 *  still `pending` or awaiting dispatch (`collected`). Matches the per-tube
 *  "Dispatched" badge, which excludes exactly those two states.
 *  Not-collected tubes ("Can't collect") are ignored: they never left the
 *  counter, so they can neither make an order "dispatched" nor hold it back —
 *  and an order whose every tube is not collected is NOT dispatched (QA #6:
 *  it used to read "Dispatched"). */
export function isOrderDispatched(samples: readonly DispatchSampleLike[]): boolean {
  const live = samples.filter(s => !isNotCollected(s));
  return live.length > 0
    && live.every(s => s.status !== 'pending' && s.status !== 'collected');
}

/** Count of tubes drawn but not yet dispatched (the ones a Dispatch action
 *  would send). */
export function countCollected(samples: readonly DispatchSampleLike[]): number {
  return samples.filter(s => s.status === 'collected').length;
}
