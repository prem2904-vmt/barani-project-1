import {
  CumulativeResult, ProfileOrder, activeOrders, toneOf, buildCumulative, buildTimeline, deltaOf, filterCumulative, flagDir,
  lastVisit, needsAttention, normUnit, orderBucket, orderStage, ordersInBucket, parseRangeBounds, quickActions, shortDate, sparkline,
} from './patient-profile.clinical';

/**
 * Clinical-first patient profile helpers (docs/PF-PATTERN.md §22): the
 * snapshot's "needs attention" + deltas, the cumulative grid (grouping,
 * newest-first visits, unit-mismatch flag), sparklines, the permission-gated
 * quick actions and a timeline that only ever shows REAL records.
 */
const NOW = new Date('2026-09-27T10:00:00');
const at = (d: string) => new Date(`${d}T09:00:00`).toISOString();

const cbc = (orderId: string, date: string, hb: string, hbFlag: string, wbc: string, wbcFlag = 'N', opts: Partial<CumulativeResult> = {}): CumulativeResult => ({
  orderTestId: `${orderId}-cbc`, orderId, orderNumber: `LAB-${orderId}`, orderedAt: at(date), testId: 't-cbc',
  testName: 'Complete Blood Count', department: 'Haematology', panel: null, status: 'validated', final: true,
  values: [
    { name: 'hb', title: 'Haemoglobin', value: hb, num: +hb, unit: 'g/dL', range: '13 - 17', flag: hbFlag },
    { name: 'wbc', title: 'WBC count', value: wbc, num: +wbc, unit: '10^3/µL', range: '4 - 11', flag: wbcFlag },
  ],
  ...opts,
});
const glucose = (orderId: string, date: string, v: string, flag: string, unit = 'mg/dL'): CumulativeResult => ({
  orderTestId: `${orderId}-fbs`, orderId, orderNumber: `LAB-${orderId}`, orderedAt: at(date), testId: 't-fbs',
  testName: 'Fasting Blood Sugar', department: 'Biochemistry', panel: 'Diabetes Profile', status: 'validated', final: true,
  values: [{ name: 'Glucose', title: 'Glucose, fasting', value: v, num: +v, unit, range: '70 - 100', flag }],
});

const RESULTS: CumulativeResult[] = [
  cbc('o1', '2026-05-10', '12.1', 'L', '7.2'),
  glucose('o1', '2026-05-10', '96', 'N'),
  cbc('o2', '2026-08-12', '11.0', 'L', '9.4'),
  glucose('o2', '2026-08-12', '118', 'H'),
  cbc('o3', '2026-09-24', '6.4', 'CL', '12.9', 'H'),
  glucose('o3', '2026-09-24', '139', 'H'),
];

describe('parseRangeBounds / flagDir / normUnit / deltaOf', () => {
  it('reads the printed range forms', () => {
    expect(parseRangeBounds('13 - 17')).toEqual({ lo: 13, hi: 17 });
    expect(parseRangeBounds('13–17 g/dL')).toEqual({ lo: 13, hi: 17 });
    expect(parseRangeBounds('0.5 to 1.2')).toEqual({ lo: 0.5, hi: 1.2 });
    expect(parseRangeBounds('< 200')).toEqual({ hi: 200 });
    expect(parseRangeBounds('>40')).toEqual({ lo: 40 });
    expect(parseRangeBounds('Up to 5')).toEqual({ hi: 5 });
    expect(parseRangeBounds('Negative')).toBeNull();
    expect(parseRangeBounds('')).toBeNull();
  });
  it('CL / CH are critical with their stored direction; legacy C is critical, direction unknown', () => {
    expect(flagDir('H')).toBe('up');
    expect(flagDir('l')).toBe('down');
    expect(flagDir('CH')).toBe('up');
    expect(flagDir('cl')).toBe('down');
    expect(flagDir('C')).toBeNull();
    expect(flagDir('A')).toBeNull();
    expect(toneOf('CL')).toBe('critical');
    expect(toneOf('CH')).toBe('critical');
    expect(toneOf('C')).toBe('critical');
    expect(toneOf('H')).toBe('abnormal');
    expect(toneOf('N')).toBe('normal');
    // In the grid: a CL cell is a critical pointing down; a legacy C has no arrow.
    const g = buildCumulative([cbc('x', '2026-09-01', '6.4', 'CL', '7'), cbc('y', '2026-09-10', '6.1', 'C', '7')], NOW);
    const hb = g.groups[0].rows[0];
    expect(hb.cells['x']).toMatchObject({ tone: 'critical', dir: 'down', flag: 'CL' });
    expect(hb.cells['y']).toMatchObject({ tone: 'critical', dir: null, flag: 'C' });
  });
  it('units compare loosely (µ = u, case, spaces, ^)', () => {
    expect(normUnit('10^3/µL')).toBe(normUnit('10 3/uL'));
    expect(normUnit('mg/dL')).toBe(normUnit('MG/DL'));
    expect(normUnit('mmol/L')).not.toBe(normUnit('mg/dL'));
  });
  it('delta as a signed percentage', () => {
    expect(deltaOf(139, 118)).toEqual({ dir: 'up', pct: 18, text: '+18%' });
    expect(deltaOf(6.4, 11)).toEqual({ dir: 'down', pct: -42, text: '−42%' });
    expect(deltaOf(5, 5)?.dir).toBe('flat');
    expect(deltaOf(3, 0)?.text).toBe('+3');
    expect(deltaOf(null, 3)).toBeNull();
  });
});

describe('buildCumulative — the analyte × visit grid', () => {
  it('visits newest first; rows grouped department (A–Z) → panel, analytes in authored order', () => {
    const g = buildCumulative(RESULTS, NOW);
    expect(g.columns.map(c => c.orderId)).toEqual(['o3', 'o2', 'o1']);
    expect(g.columns[0].label).toBe('24 Sep');
    expect(g.groups.map(x => `${x.department} · ${x.panel}`)).toEqual([
      'Biochemistry · Diabetes Profile', 'Haematology · Complete Blood Count',
    ]);
    expect(g.groups[1].rows.map(r => r.title)).toEqual(['Haemoglobin', 'WBC count']);
    expect(g.departments).toEqual(['Biochemistry', 'Haematology']);
    expect(g.rowCount).toBe(3);
  });

  it('cells carry value, tone and direction; the row keeps latest + a trend', () => {
    const hb = buildCumulative(RESULTS, NOW).groups.find(x => x.department === 'Haematology')!.rows[0];
    expect(hb.cells['o3']).toMatchObject({ value: '6.4', tone: 'critical', dir: 'down', flag: 'CL' });
    expect(hb.cells['o2']).toMatchObject({ tone: 'abnormal', dir: 'down' });
    expect(hb.latest.orderId).toBe('o3');
    expect(hb.prev?.orderId).toBe('o2');
    expect(hb.points.map(p => p.num)).toEqual([12.1, 11, 6.4]);      // oldest → latest
    expect(hb.trend).toEqual({ dir: 'down', pct: -42, text: '−42%' });
    expect(hb.unit).toBe('g/dL');
    expect(hb.range).toBe('13 - 17');
    expect(hb.unitMismatch).toBe(false);
  });

  it('a row whose visits used different units is FLAGGED (and no trend is drawn across them)', () => {
    const mixed = [glucose('a', '2026-06-01', '5.4', 'N', 'mmol/L'), glucose('b', '2026-09-01', '104', 'H', 'mg/dL')];
    const row = buildCumulative(mixed, NOW).groups[0].rows[0];
    expect(row.unitMismatch).toBe(true);
    expect(row.units).toEqual(['mmol/L', 'mg/dL']);
    expect(row.unit).toBe('mg/dL');                 // the latest unit heads the row
    expect(row.cells['a'].unitOff).toBe(true);       // the odd cell shows its own unit
    expect(row.cells['b'].unitOff).toBe(false);
    expect(row.trend).toBeNull();
    // Same unit spelled differently is NOT a mismatch.
    const same = [cbc('a', '2026-06-01', '14', 'N', '7'), cbc('b', '2026-09-01', '14', 'N', '8')];
    same[1].values[1].unit = '10^3/uL';
    expect(buildCumulative(same, NOW).groups[0].rows[1].unitMismatch).toBe(false);
  });

  it('one value per visit; empty results → an empty grid (never made up)', () => {
    const dup = [cbc('o1', '2026-05-10', '12', 'L', '7'), { ...cbc('o1', '2026-05-10', '99', 'H', '99'), orderTestId: 'x' }];
    expect(buildCumulative(dup, NOW).groups[0].rows[0].cells['o1'].value).toBe('12');
    expect(buildCumulative([], NOW)).toEqual({ columns: [], groups: [], departments: [], rowCount: 0 });
    expect(buildCumulative(null, NOW).rowCount).toBe(0);
  });

  it('filters: department chips, abnormal only, analyte search', () => {
    const g = buildCumulative([...RESULTS, cbc('o0', '2026-01-01', '14', 'N', '7')], NOW);
    expect(filterCumulative(g, { departments: ['Biochemistry'] }).map(x => x.department)).toEqual(['Biochemistry']);
    const abn = filterCumulative(g, { abnormalOnly: true });
    expect(abn.flatMap(x => x.rows.map(r => r.title))).toEqual(['Glucose, fasting', 'Haemoglobin', 'WBC count']);
    expect(filterCumulative(g, { query: 'haemo' }).flatMap(x => x.rows.map(r => r.name))).toEqual(['hb']);
    expect(filterCumulative(g, { query: 'diabetes' }).flatMap(x => x.rows.map(r => r.name))).toEqual(['Glucose']);
    expect(filterCumulative(g, { query: 'zzz' })).toEqual([]);
  });
});

describe('sparkline', () => {
  const pts = (ns: number[]) => ns.map((num, i) => ({ date: at(`2026-0${i + 1}-01`), num, tone: 'normal' as const, orderId: `o${i}` }));
  it('a path through every point, the reference band shaded, the latest dot always drawn', () => {
    const s = sparkline(pts([12, 11, 6.4]), '13 - 17', 72, 24)!;
    expect(s.d.startsWith('M3 ')).toBe(true);
    expect(s.d.match(/[ML]/g)?.length).toBe(3);
    expect(s.dots).toHaveLength(3);
    expect(s.dots[2].x).toBeCloseTo(69);
    expect(s.band).not.toBeNull();
    // The band (13–17) sits ABOVE the falling line (smaller y = higher).
    expect(s.band!.y).toBeLessThan(s.dots[2].y);
    for (const d of s.dots) { expect(d.y).toBeGreaterThanOrEqual(0); expect(d.y).toBeLessThanOrEqual(24); }
  });
  it('no band when the range does not read; nothing for < 2 numbers', () => {
    expect(sparkline(pts([1, 2]), 'Negative')!.band).toBeNull();
    expect(sparkline(pts([5]), '1 - 9')).toBeNull();
    expect(sparkline([], '1 - 9')).toBeNull();
  });
  it('a flat series still draws inside the box', () => {
    const s = sparkline(pts([5, 5, 5]), null)!;
    expect(new Set(s.dots.map(d => d.y)).size).toBe(1);
    expect(Number.isFinite(s.dots[0].y)).toBe(true);
  });
});

describe('needsAttention — the snapshot abnormal list', () => {
  it('each analyte\'s LATEST flagged value, criticals first, with the delta vs the previous value', () => {
    const list = needsAttention(buildCumulative(RESULTS, NOW), 3, NOW);
    expect(list.map(a => a.title)).toEqual(['Haemoglobin', 'Glucose, fasting', 'WBC count']);
    const [hb, glu, wbc] = list;
    expect(hb).toMatchObject({ tone: 'critical', dir: 'down', value: '6.4', unit: 'g/dL', range: '13 - 17', dateLabel: '24 Sep' });
    expect(hb.delta).toMatchObject({ dir: 'down', text: '−42%', since: '12 Aug' });
    expect(wbc).toMatchObject({ tone: 'abnormal', dir: 'up' });
    expect(wbc.delta?.text).toBe('+37%');
    expect(glu.delta).toMatchObject({ dir: 'up', text: '+18%', since: '12 Aug' });
  });
  it('normal latest values drop out; an old flag never re-tested is history, not "now"', () => {
    const recovered = [...RESULTS, cbc('o4', '2026-09-26', '14.2', 'N', '8')];
    expect(needsAttention(buildCumulative(recovered, NOW), 3, NOW).map(a => a.title)).toEqual(['Glucose, fasting']);
    const stale = [glucose('old', '2025-01-01', '180', 'H'), cbc('n1', '2026-09-01', '14', 'N', '7'),
      cbc('n2', '2026-09-10', '14', 'N', '7'), cbc('n3', '2026-09-20', '14', 'N', '7')];
    expect(needsAttention(buildCumulative(stale, NOW), 3, NOW)).toEqual([]);
  });
  it('no delta across different units, or with a single value', () => {
    const mixed = [glucose('a', '2026-08-01', '5.4', 'N', 'mmol/L'), glucose('b', '2026-09-20', '140', 'H', 'mg/dL')];
    expect(needsAttention(buildCumulative(mixed, NOW), 3, NOW)[0].delta).toBeNull();
    expect(needsAttention(buildCumulative([glucose('a', '2026-09-20', '140', 'H')], NOW), 3, NOW)[0].delta).toBeNull();
  });
});

// ── Orders ────────────────────────────────────────────────────────────────
const test = (id: string, name: string, status: string, tatHours = 6, validatedAt?: string) =>
  ({ id, name, status, subOrderId: 's', testId: id, validatedAt, test: { code: id, name, tatHours } });
const order = (id: string, created: string, status: string, tests: ReturnType<typeof test>[], extra: Partial<ProfileOrder> = {}): ProfileOrder => ({
  id, orderNumber: `LAB-${id}`, patientId: 'p1', branchId: 'b', priority: 'Routine', source: 'walk_in', status,
  collectionType: 'walk_in', createdAt: created, refDoctorName: 'Dr. Priya Nair',
  samples: [{ id: `s-${id}`, orderId: id, departmentId: 'd', status: 'x', rejectionCount: 0, createdAt: created, tests } as never],
  ...extra,
}) as ProfileOrder;

describe('in progress / last visit', () => {
  const ORDERS = [
    order('done', '2026-09-20T09:00:00', 'validated', [test('cbc', 'CBC', 'validated', 6, '2026-09-20T14:00:00')], {
      report: { id: 'r1', status: 'final', deliveryStatus: 'delivered' }, bill: { id: 'b1', status: 'paid', totalPayable: 1200, balance: 0 } }),
    order('lab', '2026-09-27T08:00:00', 'received_in_lab', [test('tsh', 'TSH', 'in_progress', 24), test('lft', 'LFT', 'pending', 6)]),
    order('val', '2026-09-26T08:00:00', 'in_progress', [test('hba1c', 'HbA1c', 'entered', 4)]),
    order('new', '2026-09-27T09:30:00', 'billed', [test('fbs', 'FBS', 'pending', 4)]),
    order('col', '2026-09-27T09:00:00', 'sample_collected', [test('crp', 'CRP', 'pending', 2)]),
    order('x', '2026-09-27T07:00:00', 'cancelled', [test('esr', 'ESR', 'cancelled', 2)]),
  ];
  it('stages: ordered → collected → in lab → awaiting validation → ready; cancelled is out', () => {
    expect(ORDERS.map(o => orderStage(o))).toEqual([4, 2, 3, 0, 1, -1]);
  });
  it('OPS-109 buckets: every order lands in exactly one of In progress / Completed / Cancelled; All is everything', () => {
    expect(ORDERS.map(o => orderBucket(o))).toEqual(['done', 'progress', 'progress', 'progress', 'progress', 'cancelled']);
    expect(ordersInBucket(ORDERS, 'all').length).toBe(6);
    expect(ordersInBucket(ORDERS, 'progress').length).toBe(4);
    expect(ordersInBucket(ORDERS, 'done').map(o => o.id)).toEqual(['done']);
    expect(ordersInBucket(null, 'all')).toEqual([]);
  });
  it('active orders, newest first, with a ready-by from the slowest test\'s TAT (overdue flagged)', () => {
    const a = activeOrders(ORDERS, NOW);
    expect(a.map(x => x.order.id)).toEqual(['new', 'col', 'lab', 'val']);
    expect(a.map(x => x.stageLabel)).toEqual(['Ordered', 'Collected', 'In lab', 'Awaiting validation']);
    const lab = a.find(x => x.order.id === 'lab')!;
    expect(lab.due).toBe(new Date('2026-09-28T08:00:00').toISOString());       // +24h (TSH)
    expect(lab.dueLabel).toBe('Ready by 28 Sep, 8:00 AM');
    expect(lab.overdue).toBe(false);
    const val = a.find(x => x.order.id === 'val')!;
    expect(val.overdue).toBe(true);
    expect(val.dueLabel).toBe('Overdue by 22 h');
    expect(a.find(x => x.order.id === 'new')!.dueLabel).toBe('Ready by 1:30 PM');
  });
  it('last visit = the newest COMPLETED visit (else the newest order) and its report state', () => {
    const lv = lastVisit(ORDERS)!;
    expect(lv.order.id).toBe('done');
    expect(lv.report).toBe('ready');
    expect(lastVisit([ORDERS[3]])!.report).toBe('pending');
    expect(lastVisit([ORDERS[0]])!.reportLabel).toBe('Report ready');
    expect(lastVisit([])).toBeNull();
  });
});

describe('timeline — real records only', () => {
  it('orders (bill folded in), reports and appointments / home visits, newest first', () => {
    const tl = buildTimeline([
      order('done', '2026-09-20T09:00:00', 'validated', [test('cbc', 'Complete Blood Count', 'validated', 6, '2026-09-20T14:00:00')], {
        report: { id: 'r1', status: 'final', deliveryStatus: 'delivered' }, bill: { id: 'b1', status: 'paid', totalPayable: 1200, balance: 0 } }),
      order('due', '2026-09-25T09:00:00', 'billed', [test('tft', 'Thyroid Profile', 'pending')], {
        bill: { id: 'b2', status: 'unpaid', totalPayable: 400, balance: 400 } }),
    ], [
      { id: 'a1', type: 'home_collection', collectionType: 'home', appointmentDate: '2026-09-30T00:00:00', slotTime: '09:00', status: 'booked' },
      { id: 'a2', type: 'appointment', collectionType: 'walkin', appointmentDate: '2026-08-01T00:00:00', status: 'completed' },
    ]);
    expect(tl.map(e => e.kind)).toEqual(['home', 'order', 'report', 'order', 'appointment']);
    expect(tl[1]).toMatchObject({ title: 'Thyroid Profile', status: 'Ordered', orderId: 'due' });
    expect(tl[1].meta).toContain('₹400 due');
    expect(tl[2]).toMatchObject({ kind: 'report', status: 'Ready', orderId: 'done', date: new Date('2026-09-20T14:00:00').toISOString() });
    expect(tl[3].meta).toContain('₹1,200 paid');
    expect(tl[0]).toMatchObject({ title: 'Home collection', status: 'Booked', tone: 'blue' });
  });
  it('no orders and no appointments → NO events (no generated OPD / IPD records)', () => {
    expect(buildTimeline([], [])).toEqual([]);
    expect(buildTimeline(null, undefined)).toEqual([]);
    const kinds = buildTimeline([order('o', '2026-09-01T09:00:00', 'billed', [test('a', 'A', 'pending')])], []).map(e => e.kind);
    expect(kinds).toEqual(['order']);
  });
});

describe('quickActions — only what this user may do', () => {
  const ORDERS = [
    order('o1', '2026-09-20T09:00:00', 'validated', [test('cbc', 'CBC', 'validated')], { report: { id: 'r1', status: 'final' } }),
    order('o2', '2026-09-25T09:00:00', 'billed', [test('tft', 'TFT', 'pending')]),
  ];
  const ctx = (perms: string[], opts: { super?: boolean; workflowOff?: boolean } = {}) => ({
    hasAny: (p: string[]) => p.some(x => perms.includes(x)),
    isSuper: !!opts.super,
    isEnabled: (a: string) => !(opts.workflowOff && (a === 'walk_in_order' || a === 'appointment')),
  });
  const keys = (perms: string[], o = {}) => quickActions(ORDERS, ctx(perms, o)).map(q => q.key);

  it('a receptionist (orders + labels + reports): all four; repeat = the newest order, report = the newest with one', () => {
    const q = quickActions(ORDERS, ctx(['register_patient', 'create_order', 'view_order', 'print_barcode', 'view_report']));
    expect(q.map(x => x.key)).toEqual(['new', 'repeat', 'labels', 'report']);
    expect(q.find(x => x.key === 'repeat')!.orderId).toBe('o2');
    expect(q.find(x => x.key === 'report')!.orderId).toBe('o1');
  });
  it('a lab tech (view only): no New / Repeat; reprint needs a label role', () => {
    expect(keys(['view_patient', 'view_order', 'view_report'])).toEqual(['report']);
    expect(keys(['view_order', 'collect_sample', 'view_report'])).toEqual(['labels', 'report']);
  });
  it('create_order without a front-desk parent perm, or with ordering switched off in the workflow → no New order', () => {
    expect(keys(['create_order', 'register_patient'], { workflowOff: true })).not.toContain('new');
    expect(keys(['register_patient'])).not.toContain('new');
  });
  it('nothing to act on → no Repeat / labels / report', () => {
    expect(quickActions([], ctx(['create_order', 'view_order', 'print_barcode', 'view_report'])).map(q => q.key)).toEqual(['new']);
  });
  it('super-admin passes', () => {
    expect(keys([], { super: true })).toEqual(['new', 'repeat', 'labels', 'report']);
  });
});

describe('shortDate', () => {
  it('drops the year this year, keeps it otherwise', () => {
    expect(shortDate('2026-08-12T09:00:00', NOW)).toBe('12 Aug');
    expect(shortDate('2025-08-12T09:00:00', NOW)).toBe('12 Aug 25');
    expect(shortDate(null, NOW)).toBe('—');
  });
});
