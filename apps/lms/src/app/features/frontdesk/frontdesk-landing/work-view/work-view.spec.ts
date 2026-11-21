import type { OpdVisitRow } from '../../../opd/frontdesk/desk.models';
import type { Order } from '../../../../shared/models/order.model';
import { opdVisitFlowRow } from '../opd-visits';
import type { FlowRow } from '../flow-grid/flow-row';
import { FLOW_MIN, FLOW_SLACK, flowLayout } from '../flow-grid/flow-fold';
import { foldSteps } from '../../../../shared/utils/work-grid';
import {
  SECTION_COLS, buildSections, loadSectionOrder, mergeSectionOrder, moveSection, saveSectionOrder, samplesText, sectionOrderKey,
  sectionPlan,
} from './sections';
import { blockRowWeights, blockSpans, byWait, chipOf, clinicServices, fitRoom, placeCols, placeOf, wrapLines } from './clinic';

/** Frontdesk WORK body (owner mocks 2026-11-21): All split by service · the user's section order · Clinic places +
 *  room fitting · the never-scroll-sideways fold. Fake data only. */
const now = Date.parse('2026-11-21T10:00:00Z');
const ago = (m: number) => new Date(now - m * 60000).toISOString();

const visit = (id: string, extra: Partial<OpdVisitRow> = {}): OpdVisitRow => ({
  id, patientId: `p-${id}`, patientName: `Ms. Patient ${id}`, patientMeta: '41/F', doctorUserId: 'd1', doctorName: 'Dr. Rao', departmentName: 'General',
  visitNumber: null, visitDate: '2026-11-21', token: 1, tokenLabel: `R-${id}`, status: 'waiting', isFollowUp: false, charged: 500, billStatus: 'paid',
  hasLabOrder: false, createdAt: ago(40), checkedInAt: ago(30), vitalsFlagged: false, ...extra,
});
const opd = (id: string, extra: Partial<OpdVisitRow> = {}, due = 0) => opdVisitFlowRow(visit(id, extra), now, { due });

/** A minimal order row (only what sections / clinic read). */
const row = (id: string, service: FlowRow['service'], extra: Partial<FlowRow> = {}): FlowRow => ({
  id, kind: 'order', order: { id, dailyNo: Number(id.replace(/\D/g, '')) || 1, samples: [{ status: 'pending' }, { status: 'collected' }], createdAt: ago(50), priority: 'Normal', refDoctorName: 'Dr. Menon' } as unknown as Order,
  draft: null, merged: null, status: 'ip', service, urgent: false, name: `Mr. Person ${id}`, meta: '', tags: [], where: 'Billed', whereSub: '', tone: 'violet',
  journey: [], journeyLabel: '', waitMin: 12, wait: '12m', late: false, pay: 'Paid', payDue: false, due: 0, createdMs: 0, dailyNo: 1, dailyNoDay: null,
  next: { id: 'collect', label: 'Collect', aria: 'Collect' }, more: [], tubes: [], ...extra,
});

describe('section order (the user\'s, owner 2026-11-21)', () => {
  it('default = the Services shelf order', () => {
    expect(mergeSectionOrder(null, ['lab', 'opd', 'ipd'])).toEqual(['lab', 'opd', 'ipd']);
  });
  it('saved order first; a newly granted service appends at the end; a retired one is ignored', () => {
    expect(mergeSectionOrder(['opd', 'er', 'lab'], ['lab', 'opd', 'scan'])).toEqual(['opd', 'lab', 'scan']);
    expect(mergeSectionOrder(['nope', 'opd', 'opd'], ['lab', 'opd'])).toEqual(['opd', 'lab']);
  });
  it('moving among the visible sections keeps hidden (row-less) services in their slots', () => {
    const order = ['lab', 'opd', 'ipd', 'scan'] as const;
    expect(moveSection([...order], ['lab', 'opd', 'scan'], 'scan', 0)).toEqual(['scan', 'lab', 'ipd', 'opd']);
    expect(moveSection([...order], ['lab', 'opd'], 'lab', 1)).toEqual(['opd', 'lab', 'ipd', 'scan']);
    expect(moveSection([...order], ['lab', 'opd'], 'lab', 5)).toEqual(['opd', 'lab', 'ipd', 'scan']);
    expect(moveSection([...order], ['lab'], 'opd', 0)).toEqual([...order]);
  });
  it('stored per tenant + user; a broken / blocked store reads as "no order"', () => {
    const key = sectionOrderKey('t1', 'u1');
    expect(key).toBe('pf.fd.sectionOrder.t1.u1');
    saveSectionOrder(key, ['opd', 'lab']);
    expect(loadSectionOrder(key)).toEqual(['opd', 'lab']);
    localStorage.setItem(key, '{bad json');
    expect(loadSectionOrder(key)).toBeNull();
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try { expect(loadSectionOrder(key)).toBeNull(); } finally { Storage.prototype.getItem = orig; }
    localStorage.removeItem(key);
  });
});

describe('All = one screen split by service', () => {
  it('groups by service in the given order, drops empty services, keeps the rows\' order, counts late', () => {
    const rows = [row('o1', 'lab'), opd('v1', { checkedInAt: ago(45) }), row('o2', 'lab', { late: true }), opd('v2', { status: 'in_consult', checkedInAt: ago(5) })];
    const s = buildSections(rows, ['opd', 'lab', 'ipd'], now);
    expect(s.map(x => x.id)).toEqual(['opd', 'lab']);
    expect(s[0].rows.map(r => r.id)).toEqual(['opd:v1', 'opd:v2']);
    expect(s[1].rows.map(r => r.id)).toEqual(['o1', 'o2']);
    expect(s.map(x => x.late)).toEqual([1, 1]);
    expect(s[0].label).toBe('OPD');
  });
  it('no automatic ordering: late sections do NOT move up', () => {
    const s = buildSections([row('o1', 'lab'), opd('v1', { checkedInAt: ago(90) })], ['lab', 'opd'], now);
    expect(s.map(x => x.id)).toEqual(['lab', 'opd']);
  });
  it('a row of a service the tenant no longer has is never hidden — its section comes after the ordered ones', () => {
    const s = buildSections([row('o1', 'ipd'), row('o2', 'lab')], ['lab'], now);
    expect(s.map(x => x.id)).toEqual(['lab', 'ipd']);
  });
  it('OPD cells: Doctor, Vitals (summary or Now), Consult with the queue position', () => {
    const rows = [opd('a', { checkedInAt: ago(30) }), opd('b', { checkedInAt: ago(20) }), opd('c', { checkedInAt: ago(10), doctorUserId: 'd2', doctorName: 'Dr. Menon' }),
      opd('d', { status: 'vitals' }), opd('e', { status: 'in_consult', vitalsSummary: 'BP 150/95', vitalsFlagged: true })];
    const cells = buildSections(rows, ['opd'], now)[0].rows.map(r => r.cells!);
    expect(cells[0].consult!.text).toBe('Waiting · next');
    expect(cells[1].consult!.text).toBe('Waiting · 1 ahead');
    expect(cells[2]).toMatchObject({ doctor: { text: 'Dr. Menon' }, consult: { text: 'Waiting · next' } });
    expect(cells[3].vitals!.text).toBe('Now');
    expect(cells[4]).toMatchObject({ vitals: { text: 'BP 150/95', late: true }, consult: { text: 'In consult' } });
  });
  it('Lab samples from the order\'s own tubes; ER triage from priority', () => {
    expect(samplesText([{ status: 'pending' }])).toBe('Not drawn');
    expect(samplesText([{ status: 'collected' }])).toBe('Drawn');
    expect(samplesText([{ status: 'pending' }, { status: 'received' }])).toBe('1 of 2 drawn');
    expect(samplesText([{ status: 'received' }, { status: 'received' }])).toBe('All 2 drawn');
    const er = buildSections([row('o9', 'er', { order: { id: 'o9', priority: 'Urgent', createdAt: ago(5), samples: [] } as unknown as Order })], ['er'], now)[0].rows[0];
    expect(er.cells!.triage).toEqual({ text: 'Urgent', late: true });
  });
  it('each service has its own columns — only ones we have data for (no Room, Bay, Ward · bed, Discharge, Meds, Diet)', () => {
    const all = Object.values(SECTION_COLS).flat().map(c => c.header);
    for (const dropped of ['Room', 'Bay', 'Ward · bed', 'Discharge', 'Meds due', 'Diet', 'Tests']) expect(all).not.toContain(dropped);
    expect(SECTION_COLS.opd.map(c => c.id)).toEqual(['doctor', 'vitals', 'consult', 'wait', 'pay']);
    expect(SECTION_COLS.lab.map(c => c.id)).toEqual(['samples', 'where', 'wait', 'pay']);
  });
  it('a narrow section folds Payment first, then its low-value columns; never-fold columns stay', () => {
    expect(sectionPlan('opd', 1000).cols.length).toBe(5);
    const p = sectionPlan('opd', 400);
    expect(p.folded).toBe(true);
    expect(p.cols.map(c => c.id)).toContain('consult');
    expect(sectionPlan('opd', 0).cols.map(c => c.id)).toEqual(['consult']);
  });
});

describe('never scroll sideways (owner 2026-11-21)', () => {
  it('foldSteps folds a prefix until the minimums fit', () => {
    const steps = [{ id: 'a', saves: 100 }, { id: 'b', saves: 50 }];
    expect([...foldSteps(1000, 500, steps)]).toEqual([]);
    expect([...foldSteps(450, 500, steps)]).toEqual(['a']);
    expect([...foldSteps(300, 500, steps)]).toEqual(['a', 'b']);
  });
  it('fold order: Payment → Waiting → Token → Journey 32px → tight', () => {
    const at = (w: number) => [...flowLayout(w).fold];
    expect(at(1400)).toEqual([]);
    expect(at(900)).toEqual(['pay']);
    expect(at(750)).toEqual(['pay', 'wait']);
    expect(at(650)).toEqual(['pay', 'wait', 'token']);
    expect(at(520)).toEqual(['pay', 'wait', 'token', 'ring', 'tight']);
  });
  for (const w of [520, 600, 720, 900, 1200]) {
    for (const selecting of [false, true]) {
      it(`one grid at ${w}px${selecting ? ' (selecting)' : ''}: the visible minimums fit`, () => {
        const l = flowLayout(w, { selecting });
        expect(l.need + FLOW_SLACK).toBeLessThanOrEqual(w);
      });
      for (const service of ['lab', 'opd', 'ipd', 'er', 'scan'] as const) {
        it(`${service} section at ${w}px${selecting ? ' (selecting)' : ''}: the visible minimums fit`, () => {
          const l = flowLayout(w, { selecting, service });
          expect(l.need + FLOW_SLACK).toBeLessThanOrEqual(w + (w <= 520 && selecting ? 10 : 0));
        });
      }
    }
  }
  it('the action column keeps room for its button + ⋯ at the floor', () => {
    expect(FLOW_MIN.nextTight).toBeGreaterThanOrEqual(140);
  });
});

describe('Clinic places (only places our data names)', () => {
  it('OPD: waiting area, vitals, a room per doctor of today\'s open visits (Free when nobody inside), booked, billing, seen', () => {
    const rows = [
      opd('w1', { checkedInAt: ago(41) }), opd('w2', { checkedInAt: ago(10), doctorUserId: 'd2', doctorName: 'Dr. Menon' }),
      opd('v', { status: 'vitals' }), opd('c', { status: 'in_consult' }), opd('b', { status: 'booked' }),
      opd('x', { status: 'completed' }, 300), opd('y', { status: 'completed' }),
    ];
    const [s] = clinicServices(rows, ['opd']);
    expect(s.places.map(p => p.title)).toEqual(['Waiting area', 'Vitals', 'Dr. Menon', 'Dr. Rao', 'Booked · not here yet', 'Billing counter', 'Seen today']);
    const wait = s.places[0];
    expect(wait).toMatchObject({ wait: true, who: '2 waiting · longest 41m', by: 'Dr. Rao 1 · Dr. Menon 1' });
    expect(wait.chips[0].late).toBe(true);
    expect(s.places.find(p => p.title === 'Dr. Rao')!.status).toEqual({ label: 'Seeing', run: true });
    expect(s.places.find(p => p.title === 'Dr. Menon')!.status).toEqual({ label: 'Free', run: false });
  });
  it('Lab: billing counter (drafts, Bill / Pay), collection, the rows\' own steps, partner lab, reports ready', () => {
    const rows = [
      row('o1', 'lab', { next: { id: 'bill', label: 'Bill', aria: 'Bill' } }),
      row('o2', 'lab'),
      row('o3', 'lab', { where: 'Sample dispatched', next: { id: 'reprint', label: 'Reprint', aria: 'Reprint' } }),
      row('o4', 'lab', { kind: 'synthetic' }),
      row('o5', 'lab', { status: 'done', next: null }),
      row('d1', 'lab', { kind: 'draft', order: null }),
    ];
    expect(rows.map(r => placeOf(r).title)).toEqual(['Billing counter', 'Collection', 'Sample dispatched', 'At partner lab', 'Reports ready', 'Billing counter']);
    const [s] = clinicServices(rows, ['lab']);
    expect(s.places.map(p => p.title)).toEqual(['Billing counter', 'Collection', 'Sample dispatched', 'At partner lab', 'Reports ready']);
    expect(s.places[0].chips.length).toBe(2);
  });
  it('blocks follow the user\'s order; a chip = token + short name + wait; late first, then longest wait', () => {
    const s = clinicServices([row('o1', 'lab'), opd('v1')], ['opd', 'lab']);
    expect(s.map(x => x.id)).toEqual(['opd', 'lab']);
    expect(chipOf(opd('v1'))).toMatchObject({ token: 'R-v1', name: 'Patient v1' });
    const chips = [{ late: false, waitMin: 50 }, { late: true, waitMin: 31 }, { late: false, waitMin: 70 }].map((c, i) => ({ ...c, id: `${i}`, token: '', name: '', wait: '', now: false }));
    expect(chips.sort(byWait).map(c => c.id)).toEqual(['1', '2', '0']);
  });
  it('block spans fill 12 columns per row; places get as many columns as their width allows', () => {
    const two = blockSpans([5, 3]);
    expect(two.reduce((n, b) => n + b.span, 0)).toBe(12);
    expect(two[0].span).toBeGreaterThan(two[1].span);
    const four = blockSpans([4, 3, 2, 1]);
    expect(four.filter(b => b.row === 0).reduce((n, b) => n + b.span, 0)).toBe(12);
    expect(four.filter(b => b.row === 1).reduce((n, b) => n + b.span, 0)).toBe(12);
    expect(blockSpans([4, 3], true).every(b => b.span === 12)).toBe(true);
    const narrow = blockSpans([5, 7, 1], false, 840);
    expect(narrow.map(b => b.row)).toEqual([0, 0, 1]);
    expect(blockRowWeights([5, 7, 1], narrow)).toEqual([7, 2]);
    expect(placeCols(6, 900)).toBe(3);
    expect(placeCols(6, 300)).toBe(1);
  });
});

describe('room fitting (full → dense → hide who → +N more → count in title)', () => {
  const base = { w: 300, head: 20, who: 16, gap: 6, chipH: 30, moreW: (n: number) => 50 + String(n).length * 7 };
  const chips = (n: number, full = 140, dense = 70) => ({ full: Array(n).fill(full), dense: Array(n).fill(dense) });
  it('wraps chips by whole chips', () => {
    expect(wrapLines([140, 140, 140], 300, 6)).toBe(2);
    expect(wrapLines([400], 300, 6)).toBe(1);
    expect(wrapLines([], 300, 6)).toBe(0);
  });
  it('steps down one level at a time as the room fills', () => {
    expect(fitRoom({ ...base, h: 200, ...chips(4) })).toEqual({ level: 'full', shown: 4 });
    expect(fitRoom({ ...base, h: 110, ...chips(8) })).toEqual({ level: 'dense', shown: 8 });
    expect(fitRoom({ ...base, h: 100, ...chips(8) })).toEqual({ level: 'tight', shown: 8 });
    const more = fitRoom({ ...base, h: 100, ...chips(30) });
    expect(more.level).toBe('more');
    expect(more.shown).toBeGreaterThan(0);
    expect(more.shown).toBeLessThan(30);
    expect(fitRoom({ ...base, h: 40, ...chips(5) })).toEqual({ level: 'counted', shown: 0 });
  });
  it('a chip wider than the room never shows cut: it drops to token + wait; the waiting area keeps its count line', () => {
    expect(fitRoom({ ...base, h: 200, full: [320], dense: [80] }).level).toBe('dense');
    const keep = fitRoom({ ...base, h: 100, keepWho: true, ...chips(8) });
    expect(keep.level).toBe('more');
  });
  it('10+ waiting never overlaps: every shown chip + the "+N" fits the room', () => {
    for (const n of [10, 14, 25, 60]) {
      for (const h of [90, 140, 220, 400]) {
        const f = { ...base, h, ...chips(n) };
        const r = fitRoom(f);
        if (r.level === 'counted') continue;
        const widths = r.level === 'full' ? f.full.slice(0, r.shown) : [...f.dense.slice(0, r.shown), ...(r.level === 'more' ? [f.moreW(n - r.shown)] : [])];
        const lines = wrapLines(widths, f.w, f.gap);
        const room = h - f.head - f.gap - (r.level === 'full' || r.level === 'dense' ? f.who : 0);
        expect(lines * f.chipH + (lines - 1) * f.gap).toBeLessThanOrEqual(room);
        expect(n - r.shown).not.toBe(1);                          // never "+1 more"
      }
    }
  });
});
