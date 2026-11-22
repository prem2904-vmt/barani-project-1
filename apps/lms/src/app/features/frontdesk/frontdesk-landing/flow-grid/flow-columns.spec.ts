import type { Order } from '../../../../shared/models/order.model';
import type { FlowRow } from './flow-row';
import { FLOW_MIN, FLOW_SLACK, OWN_FLOOR } from './flow-fold';
import { agColsOf, fdCell, fdCellCtx, fdFlowLayout, fdIdOfAgCol, fdPreviewMin, fdPreviewPlan, labVisitType } from './flow-columns';
import { defaultFdColumns } from '../../../../shared/utils/fd-grid-columns';

/** The flow grid draws the admin's Work grid columns (owner 2026-11-21). Fake data only. */
const now = Date.parse('2026-11-21T10:00:00Z');
const ago = (m: number) => new Date(now - m * 60000).toISOString();

const row = (id: string, extra: Partial<FlowRow> = {}, order: Partial<Order> = {}): FlowRow => ({
  id, kind: 'order',
  order: { id, branchId: 'b1', samples: [{ status: 'pending' }, { status: 'collected' }], createdAt: ago(50), priority: 'Normal', refDoctorName: 'Dr. Menon',
    orderNumber: 'LAB-2611-000026', source: 'walkin', collectionType: 'walkin', ...order } as unknown as Order,
  draft: null, merged: null, status: 'ip', service: 'lab', urgent: false, name: `Mr. Person ${id}`, meta: '', tags: [], where: 'Billed', whereSub: '', tone: 'violet',
  journey: [], journeyLabel: '', waitMin: 12, wait: '12m', late: false, pay: 'Paid', payDue: false, due: 0, createdMs: 0, dailyNo: 1, dailyNoDay: null,
  next: { id: 'collect', label: 'Collect', aria: 'Collect' }, more: [], tubes: [], ...extra,
});
const ctx = fdCellCtx([], id => (id === 'b1' ? 'Anna Nagar' : ''), now);

describe('fold — one grid: the right-most middle columns first, then Waiting · Token · tight; never a sideways scroll', () => {
  const ids = defaultFdColumns('lab');   // token patient where | samples payment | waiting next
  const fixed = FLOW_MIN.token + FLOW_MIN.patient + FLOW_MIN.where + FLOW_MIN.wait + FLOW_MIN.next;
  const full = fixed + 120 + FLOW_MIN.pay;
  it('everything fits on a wide grid; Where now and Waiting are fixed columns', () => {
    const l = fdFlowLayout(full + FLOW_SLACK, 'lab', ids);
    expect(l.mid).toEqual(['samples', 'payment']);
    expect([...l.fold]).toEqual([]);
  });
  it('Payment (right-most) folds into the patient line first, then Samples, then Waiting rides Where now, then Token', () => {
    const one = fdFlowLayout(full + FLOW_SLACK - 1, 'lab', ids);
    expect(one.mid).toEqual(['samples']);
    expect(one.fold.has('pay')).toBe(true);
    const two = fdFlowLayout(fixed + FLOW_SLACK, 'lab', ids);
    expect(two.mid).toEqual([]);
    expect(two.fold.has('wait')).toBe(false);
    const three = fdFlowLayout(fixed + FLOW_SLACK - 1, 'lab', ids);
    expect(three.fold.has('wait')).toBe(true);
    expect(three.fold.has('token')).toBe(false);
    const n = fdFlowLayout(300, 'lab', ids);
    expect([...n.fold]).toEqual(expect.arrayContaining(['wait', 'token', 'tight', 'pay']));
  });
  it('the admin\'s order decides what folds: Payment placed first is kept, the column on the right goes', () => {
    const l = fdFlowLayout(fixed + FLOW_MIN.pay + FLOW_SLACK, 'lab', ['token', 'patient', 'where', 'payment', 'samples', 'waiting', 'next']);
    expect(l.mid).toEqual(['payment']);
    expect(l.fold.has('pay')).toBe(false);
  });
  it('a removed Payment is gone — it does not reappear on the patient line', () => {
    expect(fdFlowLayout(3000, 'lab', ['token', 'patient', 'where', 'waiting', 'next']).fold.has('pay')).toBe(false);
  });
  it('the settings preview shows every column (noFold)', () => {
    expect(fdFlowLayout(200, 'lab', ids, { noFold: true }).mid).toEqual(['samples', 'payment']);
  });
});

describe('fold — a section: fixed columns by width alone (same x in every section), then the middle columns', () => {
  const ids = defaultFdColumns('opd');
  const fixed = FLOW_MIN.token + FLOW_MIN.patient + FLOW_MIN.where + FLOW_MIN.wait + FLOW_MIN.next;
  it('the fixed folds depend on the width only, not on the module\'s own columns', () => {
    for (const w of [700, 900, 1100]) {
      const a = fdFlowLayout(w, 'opd', ids, { section: true });
      const b = fdFlowLayout(w, 'lab', defaultFdColumns('lab'), { section: true });
      expect([...a.fold].filter(f => f !== 'pay').sort(), `@${w}`).toEqual([...b.fold].filter(f => f !== 'pay').sort());
    }
  });
  it('Waiting folds first once the fixed set + the shared floor do not fit', () => {
    const l = fdFlowLayout(fixed + OWN_FLOOR + FLOW_SLACK - 1, 'opd', ids, { section: true });
    expect(l.fold.has('wait')).toBe(true);
    expect(l.fold.has('token')).toBe(false);
  });
  it('never overflows (card 520 · 600 · 720 · 900 · 1200)', () => {
    for (const w of [520, 600, 720, 900, 1200]) {
      for (const sec of [true, false]) {
        const l = fdFlowLayout(w, 'lab', defaultFdColumns('lab'), { section: sec });
        expect(l.need + FLOW_SLACK, `@${w} section=${sec}`).toBeLessThanOrEqual(w);
      }
    }
  });
});

describe('settings preview: readable (≥85%), folds the right-most, keeps the pinned column', () => {
  const all = ['token', 'patient', 'where', 'priority', 'samples', 'payment', 'refdoc', 'waiting', 'next'];
  const est = (ids: string[], tight: boolean) => ids.reduce((n, id) => n + fdPreviewMin('lab', id, tight), 4);
  it('a wide box shows every column', () => {
    expect(fdPreviewPlan('lab', all, 3000)).toEqual({ shown: all, folded: [], tight: false });
  });
  it('a narrow box folds the right-most movable columns first and fits at ≥85%', () => {
    const p = fdPreviewPlan('lab', all, 735);
    expect(p.tight).toBe(true);
    expect(p.folded[p.folded.length - 1]).toBe('refdoc');
    expect(est(p.shown, true)).toBeLessThanOrEqual(735 / 0.85);
    for (const id of ['token', 'patient', 'where', 'waiting', 'next']) expect(p.shown).toContain(id);
    expect([...p.shown.filter(id => !p.folded.includes(id))]).toEqual(p.shown);
  });
  it('the pinned column (dragged / just added / hovered) stays; a neighbour folds instead', () => {
    const p = fdPreviewPlan('lab', all, 735, { pin: 'refdoc' });
    expect(p.shown).toContain('refdoc');
    expect(p.folded).not.toContain('refdoc');
  });
});

describe('column ids ↔ AG-Grid columns', () => {
  it('Where now is one column; Waiting / Payment keep the old colIds; a legacy "journey" is Where now', () => {
    expect(agColsOf('where')).toEqual(['where']);
    expect(agColsOf('waiting')).toEqual(['wait']);
    expect(agColsOf('priority')).toEqual(['priority']);
    expect(fdIdOfAgCol('journey')).toBe('where');
    expect(fdIdOfAgCol('pay')).toBe('payment');
    expect(fdIdOfAgCol('samples')).toBe('samples');
  });
});

describe('cells come from data the row already carries', () => {
  it('lab columns', () => {
    const r = row('o1');
    expect(fdCell('lab', 'samples', r, ctx).text).toBe('1 of 2 drawn');
    expect(fdCell('lab', 'priority', r, ctx)).toEqual({ text: 'Normal', late: false });
    expect(fdCell('lab', 'priority', row('o2', {}, { priority: 'stat' }), ctx)).toEqual({ text: 'Urgent', late: true });
    expect(fdCell('lab', 'refdoc', r, ctx).text).toBe('Dr. Menon');
    expect(fdCell('lab', 'orderid', r, ctx).text).toBe('LAB-2611-000026');
    expect(fdCell('lab', 'branch', r, ctx).text).toBe('Anna Nagar');
    expect(fdCell('lab', 'visit', r, ctx).text).toBe('Walk-in');
  });
  it('visit type from the order\'s own source / collection type', () => {
    expect(labVisitType({ collectionType: 'home_collection', source: 'walkin' })).toBe('Home');
    expect(labVisitType({ collectionType: 'walkin', source: 'appointment' })).toBe('Appointment');
    expect(labVisitType({ collectionType: 'walk_in', source: '' })).toBe('Walk-in');
  });
  it('a needs-data column shows "—" until its field arrives, then the value', () => {
    expect(fdCell('lab', 'due', row('o1'), ctx).text).toBe('—');
    const due = fdCell('lab', 'due', row('o1', {}, { reportDueAt: new Date(now + 90 * 60000).toISOString() } as Partial<Order>), ctx);
    expect(due.text).toBe('in 1h 30m');
    expect(fdCell('lab', 'due', row('o1', {}, { reportDueAt: new Date(now - 20 * 60000).toISOString() } as Partial<Order>), ctx)).toEqual({ text: '20m late', late: true });
  });
  it('IPD days in / admitted', () => {
    const r = row('o3', { service: 'ipd' }, { createdAt: new Date(now - 3 * 86400000).toISOString() });
    expect(fdCell('ipd', 'days', r, ctx).text).toBe('3 days');
    expect(fdCell('ipd', 'admitted', r, ctx).text).not.toBe('—');
  });
});
