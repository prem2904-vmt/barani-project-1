import { of } from 'rxjs';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import { MergedWorkRow } from './work-merge';
import { Order } from '../../../shared/models/order.model';

/**
 * P2-10 (owner review, 2026-10-01): a SYNTHETIC merged row's `order` is a
 * display-only stand-in (status 'created'/'validated', no real samples) —
 * opening the drawer with it directly showed nonsense like "not collected".
 * openMergedRow must fetch the REAL order by id for a synthetic row and open
 * THAT instead; a real ("order"-source) row opens directly, no extra fetch.
 *
 * `openMergedRow` is a plain prototype method (not a field/computed), so it
 * can be exercised directly via the component's prototype — the established
 * pattern this file's siblings (work-status-filter.spec.ts,
 * work-rows.nd.spec.ts) already use for FrontdeskLandingComponent without
 * constructing the whole (huge, heavily-injected) component.
 */
describe('FrontdeskLandingComponent.openMergedRow', () => {
  const proto = FrontdeskLandingComponent.prototype as unknown as Record<string, (...a: unknown[]) => void>;

  function harness(apiGetReturn: Order | null = null) {
    const openOrder = vi.fn();
    const api = { get: vi.fn(() => of(apiGetReturn)) };
    const h = Object.create(proto);
    Object.assign(h, { swallowClick: false, api, openOrder });
    return { h, openOrder, api };
  }

  const syntheticOrder: Order = {
    id: 'o1', patientId: 'p1', branchId: '', priority: 'Normal', source: 'walkin', status: 'created',
    collectionType: 'walkin', createdAt: '2026-09-30T00:00:00Z', samples: [],
  };
  const row = (overrides: Partial<MergedWorkRow<Order>>): MergedWorkRow<Order> => ({
    order: syntheticOrder, statuses: ['out'], primary: 'out', secondary: [], source: 'order', annotateData: {},
    ...overrides,
  });

  it('a REAL row ("order" source) opens its own order directly — no extra fetch', () => {
    const { h, openOrder, api } = harness();
    proto['openMergedRow'].call(h, row({ source: 'order' }));
    expect(api.get).not.toHaveBeenCalled();
    expect(openOrder).toHaveBeenCalledWith(syntheticOrder);
  });

  it('a SYNTHETIC row fetches the REAL order by id and opens THAT, never the fake stand-in', () => {
    const real: Order = {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'Urgent', source: 'walkin', status: 'collected',
      collectionType: 'walkin', createdAt: '2026-09-30T00:00:00Z',
      samples: [{ id: 's1', orderId: 'o1', departmentId: 'd1', status: 'collected', rejectionCount: 0, createdAt: '2026-09-30T00:00:00Z', tests: [] }],
    };
    const { h, openOrder, api } = harness(real);
    proto['openMergedRow'].call(h, row({ source: 'synthetic' }));
    expect(api.get).toHaveBeenCalledWith('/api/orders/o1');
    expect(openOrder).toHaveBeenCalledWith(real); // the REAL order — never the fake 'created'/no-samples stand-in
    expect(openOrder).not.toHaveBeenCalledWith(syntheticOrder);
  });

  it('a SYNTHETIC row whose fetch comes back empty never opens the fake stand-in either', () => {
    const { h, openOrder, api } = harness(null);
    proto['openMergedRow'].call(h, row({ source: 'synthetic' }));
    expect(api.get).toHaveBeenCalled();
    expect(openOrder).not.toHaveBeenCalled();
  });

  it('respects swallowClick (a drag/long-press just ended) for either source — and consumes it', () => {
    const { h, openOrder, api } = harness();
    h.swallowClick = true;
    proto['openMergedRow'].call(h, row({ source: 'order' }));
    expect(openOrder).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(h.swallowClick).toBe(false); // consumed, same as onWorkRowClick
  });
});
