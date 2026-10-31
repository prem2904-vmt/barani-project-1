import { signal } from '@angular/core';
import { PfSenseFeatureKey, PfSenseService } from './pf-sense.service';

/**
 * Spec helper: a PfSenseService stand-in with no HTTP. `off` lists switched-off
 * features; `master: false` is the whole switch; `limit` the used-up cap.
 * Returns the provider plus spies/handles to flip state mid-test.
 */
export function fakePfSense(o: { off?: PfSenseFeatureKey[]; master?: boolean; limit?: boolean; loaded?: boolean } = {}) {
  const off = signal<PfSenseFeatureKey[]>(o.off ?? []);
  const master = signal(o.master !== false);
  const limit = signal(o.limit === true);
  const loaded = signal(o.loaded !== false);
  const featureOn = (k: PfSenseFeatureKey) => master() && !off().includes(k);
  const impl = {
    loaded, limitReached: limit, enabled: master,
    featureOn, shown: (k: PfSenseFeatureKey) => loaded() && featureOn(k),
    ensureLoaded: async () => undefined,
    refresh: async () => undefined,
    noteRefusal: () => undefined,
  };
  return { provide: PfSenseService, useValue: impl, impl, off, master, limit, loaded };
}

/** Everything on, no limit. */
export const SENSE_ON = { provide: PfSenseService, useValue: fakePfSense().impl };
