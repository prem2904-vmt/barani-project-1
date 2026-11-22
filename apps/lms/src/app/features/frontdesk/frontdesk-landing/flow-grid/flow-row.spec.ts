import type { Order, OrderSample } from '../../../../shared/models/order.model';
import type { OutsourcedTube } from '../../outsourced/outsourced-view';
import {
  FlowPredicates, LATE_AFTER_MIN, draftFlowRow, journeyDots, menuActions, orderActions, orderFlowRow, orderIsLate, pickNext,
} from './flow-row';

/**
 * Flow grid rows (owner-approved redesign 2026-11-19): every column comes from what the work list already loads,
 * and the Next / ⋯ actions are EXACTLY the old row's actions behind the old row's predicates.
 */
const NOW = Date.parse('2026-11-19T10:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

const smp = (status: string, extra: Partial<OrderSample> = {}): OrderSample => ({
  id: 's-' + status + Math.random().toString(36).slice(2, 6), orderId: 'o1', departmentId: 'd', status, rejectionCount: 0,
  createdAt: minsAgo(60), tests: [{ id: 't', subOrderId: 'x', testId: 'y', name: 'Glucose', status: 'pending' }], ...extra,
} as OrderSample);

const ord = (status: string, samples: OrderSample[] = [smp('pending')], extra: Partial<Order> = {}): Order => ({
  id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'Normal', source: 'walkin', status, collectionType: 'walkin',
  createdAt: minsAgo(90), updatedAt: minsAgo(40), dailyNo: 4, dailyNoDay: '2026-11-19', samples,
  patient: { id: 'p1', displayName: 'Ms. Meenakshi Sundareswaran Ramanathan', firstName: 'Meenakshi', age: 41, sex: 'Female', mrn: 'AA0044' } as Order['patient'],
  ...extra,
} as Order);

/** The landing's predicates, simplified the way the template reads them (each one switchable per test). */
function preds(over: Partial<FlowPredicates> = {}): FlowPredicates {
  return {
    showCreateBillOn: () => true,
    showRecollectOn: () => false,
    showCollectOn: o => (o.samples ?? []).some(s => s.status === 'pending'),
    showDispatchOn: o => (o.samples ?? []).length > 0 && o.samples.every(s => s.status === 'collected'),
    showDispatchDrawn: () => false,
    showBillInsteadOfDispatch: () => false,
    sampleStatus: () => 'pending',
    isSeriesOrder: () => false,
    shareAvailable: () => true,
    effectiveStatusLabel: o => o.status === 'billed' ? 'Billed' : o.status === 'validated' ? 'Validated' : o.status,
    balance: () => 0,
    ...over,
  };
}
const ids = (a: { id: string }[]) => a.map(x => x.id);

describe('flow grid — Next = the row\'s next step, ⋯ = the rest (the old row\'s actions)', () => {
  it('an unbilled order: Bill first, then Collect (collection is decoupled from payment)', () => {
    const a = orderActions(ord('created'), preds());
    expect(ids(a)).toEqual(['bill', 'collect']);
    expect(pickNext(a, 'ip')?.id).toBe('bill');
  });

  it('billed, tubes pending: Collect; drawn with more to come: Collect + Dispatch drawn tubes', () => {
    expect(ids(orderActions(ord('billed'), preds()))).toEqual(['collect']);
    const a = orderActions(ord('billed', [smp('collected'), smp('pending')]), preds({ sampleStatus: () => 'partially_collected', showDispatchDrawn: () => true }));
    expect(ids(a)).toEqual(['collect', 'dispatch-drawn']);
    expect(a[1].aria).toBe('Dispatch drawn tubes');
  });

  it('every tube drawn: Dispatch; under a payment hold at a front-desk counter: Bill in that slot', () => {
    expect(ids(orderActions(ord('sample_collected', [smp('collected')]), preds()))).toEqual(['dispatch']);
    const held = orderActions(ord('sample_collected', [smp('collected')], { paymentHold: true }),
      preds({ showDispatchOn: () => false, showBillInsteadOfDispatch: () => true }));
    expect(ids(held)).toEqual(['bill']);
  });

  it('a "Can\'t collect" tube: Recollect takes the Collect slot (never Collect / Dispatch as if nothing happened)', () => {
    const a = orderActions(ord('billed', [smp('rejected')]), preds({ showRecollectOn: () => true }));
    expect(ids(a)).toEqual(['recollect']);
  });

  it('billed and at the lab: Reprint labels; a series adds Status; a partial report adds Download', () => {
    const p = preds({ showCollectOn: () => false, showDispatchOn: () => false });
    expect(ids(orderActions(ord('billed', [smp('received')]), p))).toEqual(['reprint']);
    expect(ids(orderActions(ord('billed', [smp('received')]), { ...p, isSeriesOrder: () => true }))).toEqual(['reprint', 'series']);
    expect(ids(orderActions(ord('partially_validated', [smp('received')]), p))).toEqual(['download']);
  });

  it('completed: Share report (Next) + Download; delivered: Download only; no share channel: Download only', () => {
    const p = preds({ showCollectOn: () => false, showDispatchOn: () => false });
    const done = orderActions(ord('validated', [smp('received')]), p);
    expect(ids(done)).toEqual(['share', 'download']);
    expect(done[0].aria).toBe('Share report');
    expect(pickNext(done, 'done')?.id).toBe('share');
    expect(ids(orderActions(ord('delivered', [smp('received')]), p))).toEqual(['download']);
    expect(ids(orderActions(ord('validated', [smp('received')]), { ...p, shareAvailable: () => false }))).toEqual(['download']);
  });

  it('a due at the desk: Pay now leads (Payments due), and is offered on any row that carries a balance', () => {
    const p = preds({ showCollectOn: () => false, showDispatchOn: () => false, balance: () => 450 });
    const a = orderActions(ord('billed', [smp('received')]), p, { primary: 'billing' });
    expect(ids(a)).toEqual(['reprint', 'pay']);
    expect(pickNext(a, 'billing')?.id).toBe('pay');
  });

  it('outsourced tubes: the tube\'s own actions; a pending partner tube leads with Mark completed / Upload', () => {
    const tube = { sampleId: 's9', barcode: 'MW-9', status: 'outsourced', hasReport: false, tests: [{ report: null }] } as unknown as OutsourcedTube;
    const withReport = { ...tube, hasReport: true, tests: [{ report: { url: '/u/x.pdf', attachToReport: false } }] } as unknown as OutsourcedTube;
    const a = orderActions(ord('billed', [smp('received')]), preds({ showCollectOn: () => false, showDispatchOn: () => false }), { tubes: [tube] });
    expect(ids(a)).toEqual(['reprint', 'out-upload:s9']);
    expect(pickNext(a, 'out')?.id).toBe('out-upload:s9');
    const b = orderActions(ord('billed', [smp('received')]), preds({ showCollectOn: () => false, showDispatchOn: () => false }), { tubes: [withReport] });
    expect(ids(b)).toEqual(['reprint', 'out-complete:s9', 'out-upload:s9', 'out-view:s9', 'out-attach:s9']);
    expect(pickNext(b, 'out')?.id).toBe('out-complete:s9');
    expect(b.find(x => x.id === 'out-complete:s9')?.aria).toBe('Mark completed for MW-9');
  });

  it('the ⋯ menu holds the rest, then Order details + Patient profile (a draft: Discard only)', () => {
    const a = orderActions(ord('created'), preds());
    const next = pickNext(a, 'ip');
    expect(ids(menuActions(a, next, 'order'))).toEqual(['collect', 'open', 'profile']);
    const draft = draftFlowRow({ key: 'k', patientId: 'p2', patient: { id: 'p2', displayName: 'Arun Kumar' } as never, testIds: ['a', 'b'], savedAt: NOW - 5 * 60000, priority: 'Normal' }, NOW);
    expect(draft.next?.id).toBe('resume');
    expect(ids(draft.more)).toEqual(['discard']);
    expect(draft.where).toBe('Draft');
    expect(draft.whereSub).toBe('2 tests · not ordered yet');
  });
});

describe('flow grid — the columns from existing data', () => {
  it('Patient: the FULL name (never cut) + age/sex · MRN; Token = the day\'s #N; Visit for = the order\'s service', () => {
    const r = orderFlowRow(ord('billed'), preds(), NOW, { primary: 'ip' });
    expect(r.name).toBe('Ms. Meenakshi Sundareswaran Ramanathan');
    expect(r.meta).toBe('41/F · AA0044');
    expect(r.dailyNo).toBe(4);
    expect(r.tags).toEqual(['LAB']);
    expect(orderFlowRow(ord('billed', undefined, { module: 'opd' }), preds(), NOW, { primary: 'ip' }).tags).toEqual(['OPD']);
  });

  it('Journey: done steps, ONE current step, then the rest (a stopped step in its place)', () => {
    expect(journeyDots(ord('created')).dots).toEqual(['now', 'todo', 'todo', 'todo', 'todo']);
    expect(journeyDots(ord('billed', [smp('collected')])).dots).toEqual(['done', 'done', 'now', 'todo', 'todo']);
    expect(journeyDots(ord('billed', [smp('rejected', { rejectedReason: 'Patient refused' } as Partial<OrderSample>)])).dots[1]).toBe('stopped');
    const done = journeyDots(ord('delivered', [smp('received', { tests: [{ id: 't', subOrderId: 'x', testId: 'y', name: 'G', status: 'validated' }] } as Partial<OrderSample>)]));
    expect(done.dots).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('Waiting: minutes at the current stage; rose (late) over 30 minutes; finished rows show none', () => {
    const r = orderFlowRow(ord('billed'), preds(), NOW, { primary: 'ip' });
    expect(r.waitMin).toBe(40);
    expect(r.wait).toBe('40m');
    expect(r.late).toBe(true);
    const fresh = orderFlowRow(ord('billed', undefined, { updatedAt: minsAgo(LATE_AFTER_MIN - 1) }), preds(), NOW, { primary: 'ip' });
    expect(fresh.late).toBe(false);
    const done = orderFlowRow(ord('validated', [smp('received')]), preds(), NOW, { primary: 'done' });
    expect(done.waitMin).toBeNull();
    expect(done.wait).toBe('—');
    expect(orderIsLate(ord('validated'), NOW)).toBe(false);
  });

  it('Payment: "₹450 due" (rose) from the bill balance; Not billed; Paid', () => {
    const due = orderFlowRow(ord('billed'), preds({ balance: () => 450 }), NOW, { primary: 'billing' });
    expect(due.pay).toMatch(/450/);
    expect(due.pay).toMatch(/due$/);
    expect(due.payDue).toBe(true);
    expect(orderFlowRow(ord('created'), preds(), NOW, { primary: 'ip' }).pay).toBe('Not billed');
    const paid = orderFlowRow(ord('billed'), preds(), NOW, { primary: 'ip' });
    expect(paid.pay).toBe('Paid');
    expect(paid.payDue).toBe(false);
  });

  it('Where now: the order\'s own status word + the current step\'s caption; the stage dot follows the status pill', () => {
    const r = orderFlowRow(ord('billed', [smp('pending'), smp('pending')]), preds(), NOW, { primary: 'ip' });
    expect(r.where).toBe('Billed');
    expect(r.whereSub).toBe('0/2 collected');
    expect(r.tone).toBe('violet');
    expect(orderFlowRow(ord('validated', [smp('received')]), preds(), NOW, { primary: 'done' }).tone).toBe('green');
    expect(orderFlowRow(ord('billed'), preds(), NOW, { primary: 'billing' }).tone).toBe('rose');
  });
});
