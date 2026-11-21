import type { Order, OrderSample } from '../../../../shared/models/order.model';
import { FlowPredicates, orderFlowRow, whereWords } from './flow-row';
import { flowListItems } from './flow-list';

/** Frontdesk below 1024px: the flow grid's OWN rows become the shared work-list items — same rows, same order. */
const NOW = Date.parse('2026-11-19T10:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60000).toISOString();
const smp = (status: string): OrderSample => ({
  id: 's-' + status, orderId: 'o1', departmentId: 'd', status, rejectionCount: 0, createdAt: minsAgo(60),
  tests: [{ id: 't', subOrderId: 'x', testId: 'y', name: 'Glucose', status: 'pending' }],
} as OrderSample);
const ord = (id: string, status: string): Order => ({
  id, patientId: 'p1', branchId: 'b1', priority: 'Normal', source: 'walkin', status, collectionType: 'walkin',
  createdAt: minsAgo(90), updatedAt: minsAgo(40), dailyNo: 4, dailyNoDay: '2026-11-19', samples: [smp('pending')],
  patient: { id: 'p1', displayName: 'Ms. Meenakshi Sundareswaran Ramanathan', firstName: 'Meenakshi', age: 41, sex: 'Female', mrn: 'AA0044' } as Order['patient'],
} as Order);
const preds: FlowPredicates = {
  showCreateBillOn: () => true, showRecollectOn: () => false, showCollectOn: () => true, showDispatchOn: () => false,
  showDispatchDrawn: () => false, showBillInsteadOfDispatch: () => false, sampleStatus: () => 'pending', isSeriesOrder: () => false,
  shareAvailable: () => true, effectiveStatusLabel: o => (o.status === 'billed' ? 'Billed' : o.status), balance: () => 0,
};

describe('flowListItems', () => {
  it('keeps the rows and their order; name + token, Where now as words, the row itself as data', () => {
    const rows = [orderFlowRow(ord('a', 'billed'), preds, NOW, { primary: 'ip' }), orderFlowRow(ord('b', 'created'), preds, NOW, { primary: 'ip' })];
    const items = flowListItems(rows);
    expect(items.map(i => i.id)).toEqual(['a', 'b']);
    expect(items[0].name).toBe(rows[0].name);
    expect(items[0].daily).toEqual({ dailyNo: 4, dailyNoDay: '2026-11-19' });
    expect(items[0].status).toEqual(whereWords(rows[0]));
    expect(items[0].data).toBe(rows[0]);
    expect(items[0].facts?.[0]).toBe(rows[0].meta);
    expect(items[0].noAction).toBe(!rows[0].next && !rows[0].more.length);
  });
});
