import {
  OutsourcedTube, absoluteFileUrl, actionLines, countByStatus, filterOutsourced, partnerFileProblem,
  partnerOptions, partnerReportShareLine, rowReport, attachState, firstAttachProblem, ATTACH_DEFAULT,
  partnerWhere, PartnerReport, PdfParts, outsourcedPageUrl, syntheticOrderFromOutsourcedTubes, buildFrontdeskMergedWork, isOutsourcedOnlyAwaitingPartner,
} from './outsourced-view';
import { Order } from '../../../shared/models/order.model';

const row = (o: Partial<OutsourcedTube> = {}): OutsourcedTube => ({
  sampleId: 's1', barcode: 'OUT-0001', sampleStatus: 'dispatched', orderId: 'o1', orderNumber: 'LAB-2609-000001',
  patientId: 'p1', patientName: 'Ms. Paravai Munusamy', partnerLabId: 'a', partnerLabName: 'Apollo Diagnostics',
  createdAt: '2026-09-25T00:00:00Z', dispatchedAt: '2026-09-25T02:00:00Z', status: 'outsourced', hasReport: false,
  tests: [{ orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false }],
  ...o,
});

describe('Outsourced tab — filters', () => {
  const rows = [
    row(),
    row({ sampleId: 's2', barcode: 'OUT-0002', partnerLabId: 'b', partnerLabName: 'Metropolis', status: 'completed', patientName: 'Mr. Arun Kumar',
          tests: [{ orderTestId: 't2', testId: 'y', testName: 'HbA1c', status: 'completed', completed: true }] }),
  ];

  it('filters by status', () => {
    expect(filterOutsourced(rows, { status: 'completed' }).map(r => r.sampleId)).toEqual(['s2']);
    expect(filterOutsourced(rows, { status: 'all' }).length).toBe(2);
  });
  it('filters by partner lab', () => {
    expect(filterOutsourced(rows, { partnerId: 'a' }).map(r => r.sampleId)).toEqual(['s1']);
  });
  it('searches patient, order, sample, test and partner', () => {
    expect(filterOutsourced(rows, { query: 'arun' }).map(r => r.sampleId)).toEqual(['s2']);
    expect(filterOutsourced(rows, { query: 'vitamin' }).map(r => r.sampleId)).toEqual(['s1']);
    expect(filterOutsourced(rows, { query: 'OUT-0001' }).length).toBe(1);
    expect(filterOutsourced(rows, { query: 'metro' }).map(r => r.sampleId)).toEqual(['s2']);
  });
  it('partner options are distinct and sorted; counts per status', () => {
    expect(partnerOptions([...rows, row({ sampleId: 's3' })]).map(p => p.label)).toEqual(['Apollo Diagnostics', 'Metropolis']);
    expect(countByStatus(rows)).toEqual({ outsourced: 1, completed: 1 });
  });
});

describe('Outsourced tab — upload flow helpers', () => {
  it('actions target the open lines, or every line when all are done (replace)', () => {
    const r = row({ tests: [
      { orderTestId: 't1', testId: 'x', testName: 'A', status: 'completed', completed: true },
      { orderTestId: 't2', testId: 'y', testName: 'B', status: 'outsourced', completed: false },
    ] });
    expect(actionLines(r)).toEqual(['t2']);
    expect(actionLines(row({ tests: [{ orderTestId: 't9', testId: 'z', testName: 'C', status: 'completed', completed: true }] }))).toEqual(['t9']);
  });
  it('accepts PDF / images up to 15 MB only', () => {
    expect(partnerFileProblem({ type: 'application/pdf', size: 1000 })).toBeNull();
    expect(partnerFileProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(partnerFileProblem({ type: 'text/plain', size: 10 })).toContain('PDF');
    expect(partnerFileProblem({ type: 'application/pdf', size: 16 * 1024 * 1024 })).toContain('15 MB');
  });
  it('resolves the attached report and absolute file URLs', () => {
    const rep = { orderTestId: 't1', testName: 'Vitamin D', url: '/uploads/t/x.pdf' };
    expect(rowReport(row())).toBeNull();
    expect(rowReport(row({ tests: [{ orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true, report: rep }] }))).toEqual(rep);
    expect(absoluteFileUrl('/uploads/t/x.pdf', 'https://api.example/')).toBe('https://api.example/uploads/t/x.pdf');
    expect(absoluteFileUrl('https://cdn/x.pdf', 'https://api')).toBe('https://cdn/x.pdf');
  });
  it('WhatsApp line mentions the partner report only when there is one', () => {
    expect(partnerReportShareLine([])).toBeNull();
    expect(partnerReportShareLine([{ orderTestId: 't', testName: 'Vitamin D', partnerLabName: 'Apollo', url: '/u' }]))
      .toContain('Vitamin D (tested at Apollo)');
  });
});

describe('Outsourced tab — attach to our report', () => {
  const withRep = (rep: Record<string, unknown> | null) => row({ hasReport: !!rep, tests: [
    { orderTestId: 't1', testId: 'x', testName: 'Vitamin D', status: 'completed', completed: true,
      report: rep ? { orderTestId: 't1', testName: 'Vitamin D', url: '/u', ...rep } : null },
  ] });

  it('defaults ON at upload', () => expect(ATTACH_DEFAULT).toBe(true));

  it('attach state: none / in-report / separate (legacy = no flag) / problem', () => {
    expect(attachState(withRep(null))).toBe('none');
    expect(attachState(withRep({ attachToReport: true, inReport: true }))).toBe('in-report');
    expect(attachState(withRep({}))).toBe('separate');
    expect(attachState(withRep({ attachToReport: false }))).toBe('separate');
    expect(attachState(withRep({ attachToReport: true, attachProblem: 'locked' }))).toBe('problem');
    expect(firstAttachProblem([withRep({ attachToReport: true, attachProblem: 'locked' })])).toBe('locked');
    expect(firstAttachProblem([withRep({ attachToReport: false, attachProblem: 'stale' })])).toBeNull();
    expect(firstAttachProblem(null)).toBeNull();
  });

  it('share line: joined reports are "in your report PDF", the rest ride on the link', () => {
    const line = partnerReportShareLine([
      { orderTestId: 'a', testName: 'Vitamin D', partnerLabName: 'Apollo', url: '/u1', attachToReport: true, inReport: true },
      { orderTestId: 'b', testName: 'HbA1c', url: '/u2' },
    ])!;
    expect(line).toContain('Your report PDF also includes the partner lab report for Vitamin D (tested at Apollo).');
    expect(line).toContain('Also included on the same link: the partner lab report for HbA1c.');
    expect(partnerReportShareLine([{ orderTestId: 'a', testName: 'X', url: '/u', inReport: true }]))
      .not.toContain('same link');
  });
});

describe('Report viewer — where a partner report goes (the served PDF wins over the flag)', () => {
  const rep = (o: Partial<PartnerReport> = {}): PartnerReport =>
    ({ orderTestId: 't1', testName: 'Testing', partnerLabName: 'ABC Lab', url: '/uploads/t/a.pdf', ...o });
  const parts = (joined: boolean, problem: string | null = null): PdfParts =>
    ({ stored: true, combined: joined, parts: [{ url: '/uploads/t/a.pdf', joined, problem }] });

  it('a legacy upload (no flag) is a separate file the desk can still attach', () => {
    expect(partnerWhere(rep(), null)).toEqual({ text: 'Sent as a separate file — attach it to send one PDF', warn: false, canAttach: true });
    expect(partnerWhere(rep({ attachToReport: false }), parts(false)).canAttach).toBe(true);
  });
  it('attached AND joined in the served PDF: "In this PDF"', () => {
    expect(partnerWhere(rep({ attachToReport: true, inReport: true }), parts(true)))
      .toEqual({ text: 'In this PDF, after our report', warn: false, canAttach: false });
  });
  it('attached but NOT in the served PDF: says so with the reason, as a warning (LAB-2609-000154)', () => {
    const w = partnerWhere(rep({ attachToReport: true, inReport: true }), parts(false, 'The partner file is no longer on the server.'));
    expect(w.warn).toBe(true);
    expect(w.text).toBe('Not in this PDF — The partner file is no longer on the server.');
    expect(partnerWhere(rep({ attachToReport: true }), parts(false)).text).toBe('Not in this PDF — it couldn’t be joined');
  });
  it('a file flagged unjoinable at upload (password-protected) stays a separate file', () => {
    const w = partnerWhere(rep({ attachToReport: true, attachProblem: 'This PDF is password-protected.' }), null);
    expect(w).toEqual({ text: 'Sent as a separate file — This PDF is password-protected.', warn: true, canAttach: false });
  });
  it('no answer yet: the flag\'s wording, never "In this PDF"', () => {
    expect(partnerWhere(rep({ attachToReport: true, inReport: true }), null).text).toBe('Attached — joined after our report');
    expect(partnerWhere(rep({ attachToReport: true }), { stored: false, combined: false, parts: [] }).text).toBe('Attached — joined after our report');
  });
});

describe('Outsourced tab — paged URL (DB optimisation, release 2026-10-01)', () => {
  it('builds days / page / pageSize / status', () => {
    expect(outsourcedPageUrl({ days: 90, page: 1, pageSize: 50, status: 'outsourced' }))
      .toBe('/api/samples/outsourced?days=90&page=1&pageSize=50&status=outsourced');
    expect(outsourcedPageUrl({ days: 90, page: 2, pageSize: 50, status: 'all' }))
      .toBe('/api/samples/outsourced?days=90&page=2&pageSize=50&status=all');
  });
  it('blank / missing status defaults to "all"', () => {
    expect(outsourcedPageUrl({ days: 90, page: 1, pageSize: 50, status: '' as never }))
      .toBe('/api/samples/outsourced?days=90&page=1&pageSize=50&status=all');
  });
  it('a partner id is appended, URL-encoded; none = omitted entirely', () => {
    expect(outsourcedPageUrl({ days: 90, page: 1, pageSize: 50, status: 'completed', partnerId: 'a b/c' }))
      .toBe('/api/samples/outsourced?days=90&page=1&pageSize=50&status=completed&partnerLabId=a%20b%2Fc');
    expect(outsourcedPageUrl({ days: 90, page: 1, pageSize: 50, status: 'completed', partnerId: null }))
      .not.toContain('partnerLabId');
  });
});

describe('Outsourced tab — synthetic order (an order that is ONLY outsourced, release 2026-10-01)', () => {
  it('builds a display-ready Order + Patient from the tube(s)', () => {
    const o = syntheticOrderFromOutsourcedTubes('o1', [row()]);
    expect(o.id).toBe('o1');
    expect(o.orderNumber).toBe('LAB-2609-000001');
    expect(o.patient?.displayName).toBe('Ms. Paravai Munusamy');
    expect(o.patientId).toBe('p1');
    expect(o.samples).toEqual([]);
  });

  it('uses the EARLIEST tube\'s createdAt when an order has more than one outsourced tube', () => {
    const later = row({ sampleId: 's2', createdAt: '2026-09-26T00:00:00Z' });
    const earlier = row({ sampleId: 's3', createdAt: '2026-09-20T00:00:00Z' });
    const o = syntheticOrderFromOutsourcedTubes('o1', [later, earlier]);
    expect(o.createdAt).toBe('2026-09-20T00:00:00Z');
  });

  it('carries dailyNo / dailyNoDay through for the merged list\'s sort + #N chip', () => {
    const o = syntheticOrderFromOutsourcedTubes('o1', [row({ dailyNo: 4, dailyNoDay: '2026-09-25' })]);
    expect(o.dailyNo).toBe(4);
    expect(o.dailyNoDay).toBe('2026-09-25');
  });

  it('never a real in-progress/completed/payments-due status — "created" + no samples, so a merged row must hide those actions', () => {
    const o = syntheticOrderFromOutsourcedTubes('o1', [row()]);
    expect(o.status).toBe('created');
    expect(o.samples.length).toBe(0);
  });
});

/**
 * The reviewer's exact scenario (owner, 2026-10-01): outsourced lines are
 * excluded from the lab's own work queues (OutsourcingRules) — so an order
 * every one of whose tests is outsourced never reaches an in-house status
 * the ip/done/billing feeds would pick up. Depending on when the front desk
 * looks, such an order is EITHER:
 *  - still "created"/"collected" (physically drawn, not yet dispatched to
 *    the partner, nothing resulted) — which IS an active status, so it
 *    normally WOULD show in shownInProgress; but the ip/done/billing feeds
 *    are scoped to the work date range / "today" feed, and a long-outstanding
 *    outsourced order (or a test added later to an older order) can fall
 *    outside that scope while its tube is still within the Outsourced tab's
 *    own (wider) window — or
 *  - fully "validated"/"delivered" once every outsourced line completes,
 *    which WOULD show in shownCompleted/shownPaymentsDueOnly — EXCEPT the
 *    desk may be looking at a date range that doesn't include the order's
 *    own creation day at all.
 * Either way, `buildFrontdeskMergedWork`'s caller only ever hands it orders
 * that ARE in the ip/done/billing feeds for the CURRENT view — so an order
 * absent from all three (outsourced-only for this view) is a real,
 * non-theoretical input this function must still turn into exactly one row.
 */
describe('buildFrontdeskMergedWork — an order that is ONLY in the outsourced bucket', () => {
  const minimalOrder = (id: string): Order => ({
    id, patientId: 'p-other', branchId: 'b1', priority: 'Normal', source: 'walkin', status: 'created',
    collectionType: 'walkin', createdAt: '2026-09-30T01:00:00Z', samples: [],
  });

  it('a PENDING outsourced tube, order absent from ip/done/billing entirely: one synthetic row', () => {
    const tube = row({ orderId: 'out-only-1', status: 'outsourced' });
    const rows = buildFrontdeskMergedWork([], [], [], [tube]);
    expect(rows.length).toBe(1);
    expect(rows[0].order.id).toBe('out-only-1');
    expect(rows[0].source).toBe('synthetic');
    expect(rows[0].primary).toBe('out');
    expect(rows[0].order.patient?.displayName).toBe('Ms. Paravai Munusamy');
  });

  it('a COMPLETED outsourced tube (within the window), order still absent from ip/done/billing: STILL one row — never dropped', () => {
    const tube = row({ orderId: 'out-only-2', status: 'completed', hasReport: true });
    const rows = buildFrontdeskMergedWork([], [], [], [tube]);
    expect(rows.length).toBe(1);
    expect(rows[0].order.id).toBe('out-only-2');
    expect(rows[0].source).toBe('synthetic');
    // P1-5: a completed-only outsourced-only order synthesizes a 'done' row
    // (never 'out' — it has nothing pending to lead with "Outsourced" for).
    expect(rows[0].primary).toBe('done');
    expect(rows[0].statuses).toEqual(['done']);
    expect(rows[0].annotateData.done).toEqual([tube]); // inline actions (View etc.) still have the tube
  });

  it('an order with BOTH an ip row and an outsourced tube: ONE row, annotated (not synthetic), tube available for inline actions', () => {
    const ip = [minimalOrder('shared-1')];
    const tube = row({ orderId: 'shared-1' });
    const rows = buildFrontdeskMergedWork(ip, [], [], [tube]);
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe('order');
    expect(rows[0].order).toBe(ip[0]); // the REAL order, not a synthetic stand-in
    expect(new Set(rows[0].statuses)).toEqual(new Set(['ip', 'out']));
    expect(rows[0].primary).toBe('out'); // outsourced still outranks in-progress
    expect(rows[0].annotateData.out).toEqual([tube]);
  });

  it('two outsourced tubes on the SAME outsourced-only order: still one row, both tubes attached', () => {
    const t1 = row({ sampleId: 's1', orderId: 'out-only-3' });
    const t2 = row({ sampleId: 's2', orderId: 'out-only-3', status: 'completed', hasReport: true });
    const rows = buildFrontdeskMergedWork([], [], [], [t1, t2]);
    expect(rows.length).toBe(1);
    expect((rows[0].annotateData.out as OutsourcedTube[]).map(t => t.sampleId).sort()).toEqual(['s1', 's2']);
  });

  it('an outsourced tube for an order NOT in range, alongside unrelated ip/done/billing orders: no cross-contamination', () => {
    const ip = [minimalOrder('ip-1')];
    const done = [minimalOrder('done-1')];
    const billing = [minimalOrder('billing-1')];
    const tube = row({ orderId: 'out-only-4' });
    const rows = buildFrontdeskMergedWork(ip, done, billing, [tube]);
    expect(rows.length).toBe(4);
    expect(rows.find(r => r.order.id === 'out-only-4')?.source).toBe('synthetic');
    expect(rows.filter(r => r.source === 'order').map(r => r.order.id).sort()).toEqual(['billing-1', 'done-1', 'ip-1']);
  });

  it('P1-5: an order with BOTH a pending and a completed tube still leads with "out" (pending outranks), carrying BOTH tubes for inline actions', () => {
    const pending = row({ sampleId: 's1', orderId: 'out-only-5', status: 'outsourced' });
    const completed = row({ sampleId: 's2', orderId: 'out-only-5', status: 'completed', hasReport: true });
    const rows = buildFrontdeskMergedWork([], [], [], [pending, completed]);
    expect(rows.length).toBe(1);
    expect(rows[0].primary).toBe('out');
    expect(rows[0].statuses).toEqual(['out']); // never ALSO 'done' — see the next test for why
    expect((rows[0].annotateData.out as OutsourcedTube[]).map(t => t.sampleId).sort()).toEqual(['s1', 's2']);
  });

  it('P1-5: a completed-only outsourced tube on an order that is genuinely ACTIVE for other reasons never marks it "done"', () => {
    // An order still 'ip' (other in-house tests pending) that also happens
    // to have a completed outsourced line: it must stay exactly 'ip' — a
    // completed outsourced tube never implies the WHOLE order is done.
    const ip = [minimalOrder('mixed-1')];
    const completedTube = row({ orderId: 'mixed-1', status: 'completed', hasReport: true });
    const rows = buildFrontdeskMergedWork(ip, [], [], [completedTube]);
    expect(rows.length).toBe(1);
    expect(rows[0].statuses).toEqual(['ip']); // 'done' never added
    expect(rows[0].primary).toBe('ip');
    expect(rows[0].source).toBe('order');
    expect(rows[0].annotateData.done).toBeUndefined();
  });
});

describe('buildFrontdeskMergedWork — search (P1-6: the work card query must narrow synthesized rows too)', () => {
  const minimalOrder = (id: string): Order => ({
    id, patientId: 'p-other', branchId: 'b1', priority: 'Normal', source: 'walkin', status: 'created',
    collectionType: 'walkin', createdAt: '2026-09-30T01:00:00Z', samples: [],
  });

  it('a query that matches no tube never synthesizes a row for it', () => {
    const tube = row({ orderId: 'out-only-9', patientName: 'Mr. Arun Kumar' });
    const matched = filterOutsourced([tube], { query: 'arun' });
    const unmatched = filterOutsourced([tube], { query: 'zzz-no-match' });
    expect(buildFrontdeskMergedWork([], [], [], matched).length).toBe(1);
    expect(buildFrontdeskMergedWork([], [], [], unmatched).length).toBe(0); // "No matches" — not a stray row
  });

  it('a query narrows which tubes annotate a REAL row too (never shows an unrelated tube\'s data)', () => {
    const ip = [minimalOrder('shared-2')];
    const matching = row({ sampleId: 's1', orderId: 'shared-2', patientName: 'Ms. Target Patient' });
    const other = row({ sampleId: 's2', orderId: 'other-order', patientName: 'Mr. Someone Else' });
    const filtered = filterOutsourced([matching, other], { query: 'target' });
    const rows = buildFrontdeskMergedWork(ip, [], [], filtered);
    expect(rows.length).toBe(1); // only shared-2 (a real ip row) — 'other-order' never synthesized
    expect(rows[0].order.id).toBe('shared-2');
    expect(rows[0].statuses).toEqual(['ip', 'out']);
  });
});

describe('buildFrontdeskMergedWork — a part-paid order that is ALSO in progress (regression, 2026-10-01 E2E)', () => {
  // The reported bug: an in-progress order with an outstanding balance
  // rendered its real order.status (e.g. "Billed", green) with no
  // payment-due cue at all — it had silently fallen out of the 'billing'
  // bucket. Root cause: FrontdeskLandingComponent.mergedWork fed
  // `shownPaymentsDueOnly()` (which excludes an order that's ALSO
  // in-progress — a dedup that belonged to the OLD sectioned no-chip view)
  // into the 'billing' bucket instead of the plain `shownPaymentsDue()`.
  // buildFrontdeskMergedWork/mergeWorkRows already does the union+precedence
  // correctly — this pins that an order present in BOTH `ip` and `billing`
  // comes out as ONE row, led by 'billing' (not silently 'ip' only).
  const billedButUnpaid = (id: string): Order => ({
    id, patientId: 'p1', branchId: 'b1', priority: 'Normal', source: 'walkin', status: 'billed',
    collectionType: 'walkin', createdAt: '2026-09-30T01:00:00Z', samples: [],
  });

  it('an order in BOTH ip and billing: ONE row, primary "billing", "In progress" as the secondary badge', () => {
    const order = billedButUnpaid('part-paid-1');
    const rows = buildFrontdeskMergedWork([order], [], [order], []);
    expect(rows.length).toBe(1); // never two rows for the same order
    expect(rows[0].order).toBe(order); // the real order — its own status ('billed') is still there to read
    expect(new Set(rows[0].statuses)).toEqual(new Set(['ip', 'billing']));
    expect(rows[0].primary).toBe('billing'); // never left as plain 'ip' (which read as green "Billed")
    expect(rows[0].secondary).toEqual(['ip']);
    expect(rows[0].source).toBe('order');
  });

  it('an order ONLY in ip (fully paid, no balance) stays "ip" — the fix never force-adds billing', () => {
    const order = billedButUnpaid('paid-in-full');
    const rows = buildFrontdeskMergedWork([order], [], [], []);
    expect(rows[0].statuses).toEqual(['ip']);
    expect(rows[0].primary).toBe('ip');
  });
});

describe('OPS-114 - an order with only partner-lab work left is not "In progress"', () => {
  const tube = (status: string, vendor: string | null) => ({ status, outsourcedVendorId: vendor });
  it('every live tube outsourced and drawn: outsourced-only', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tube('dispatched', 'v1'), tube('collected', 'v2')] })).toBe(true);
  });
  it('a mixed order (one in-house tube) stays In progress', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tube('collected', 'v1'), tube('received', null)] })).toBe(false);
  });
  it('an outsourced tube still to draw keeps the Collect action under In progress', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tube('pending', 'v1')] })).toBe(false);
  });
  it('cancelled / merged / rejected tubes are ignored; no live tube = not outsourced-only', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tube('cancelled', null), tube('dispatched', 'v1')] })).toBe(true);
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tube('cancelled', 'v1')] })).toBe(false);
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [] })).toBe(false);
    expect(isOutsourcedOnlyAwaitingPartner({})).toBe(false);
  });

  // OPS-114 re-test: the same rule as the server's Outsourced tab (OutsourcingRules.IsOutsourced).
  const line = (status: string, vendor: string | null, ov: string | null = null) =>
    ({ status, outsourcingOverride: ov, test: { outsourcedVendorId: vendor } });
  const tubeL = (status: string, vendor: string | null, tests: ReturnType<typeof line>[]) => ({ status, outsourcedVendorId: vendor, tests });

  it('an older tube with no frozen destination whose every live line is an outsourced test is outsourced-only', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tubeL('dispatched', null, [line('pending', 'v1'), line('pending', 'v2')])] })).toBe(true);
  });
  it('a desk override of "inhouse" keeps the line (and the order) in the lab', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tubeL('collected', null, [line('pending', 'v1', 'inhouse')])] })).toBe(false);
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tubeL('collected', null, [line('pending', 'v1', 'inhouse'), line('pending', 'v1')])] })).toBe(false);
  });
  it('a tube with an in-house line next to an outsourced one stays In progress', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tubeL('dispatched', null, [line('pending', 'v1'), line('pending', null)])] })).toBe(false);
  });
  it('cancelled / rejected / missed LINES are ignored; a tube whose only live lines are dead is not outsourced-only', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tubeL('dispatched', null, [line('pending', 'v1'), line('cancelled', null), line('rejected', null)])] })).toBe(true);
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tubeL('dispatched', null, [line('cancelled', 'v1')])] })).toBe(false);
  });
  it('rejected and missed TUBES are ignored; a pending outsourced tube next to a drawn one stays In progress', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tube('rejected', null), tube('missed', null), tube('dispatched', 'v1')] })).toBe(true);
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tube('pending', 'v1'), tube('dispatched', 'v1')] })).toBe(false);
  });
  it('once the partner report is uploaded the lines are validated: still outsourced-only (the order status takes it to Completed)', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [tubeL('dispatched', 'v1', [line('validated', 'v1')])] })).toBe(true);
  });
  it('no vendor id and no tests loaded: in-house, stays In progress', () => {
    expect(isOutsourcedOnlyAwaitingPartner({ samples: [{ status: 'collected' }] })).toBe(false);
  });
});
