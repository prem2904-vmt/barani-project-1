/**
 * Pure predicates for the sample-collection dispatch footer. Kept out of the
 * component so the logic is unit-testable (the component itself has no test
 * harness). "Dispatched" means a tube has moved past `collected`; a fixed
 * done-status whitelist used to drift and leave the Dispatch button showing
 * after everything was already dispatched.
 */

export interface DispatchSampleLike {
  status: string;
}

/** True once every tube on the order has moved past `collected` — i.e. none is
 *  still `pending` or awaiting dispatch (`collected`). Matches the per-tube
 *  "Dispatched" badge, which excludes exactly those two states. */
export function isOrderDispatched(samples: readonly DispatchSampleLike[]): boolean {
  return samples.length > 0
    && samples.every(s => s.status !== 'pending' && s.status !== 'collected');
}

/** Count of tubes drawn but not yet dispatched (the ones a Dispatch action
 *  would send). */
export function countCollected(samples: readonly DispatchSampleLike[]): number {
  return samples.filter(s => s.status === 'collected').length;
}
