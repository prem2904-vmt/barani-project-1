import {
  OutsourcedTube, absoluteFileUrl, actionLines, countByStatus, filterOutsourced, partnerFileProblem,
  partnerOptions, partnerReportShareLine, rowReport, attachState, firstAttachProblem, ATTACH_DEFAULT,
  partnerWhere, PartnerReport, PdfParts, outsourcedPageUrl,
} from './outsourced-view';

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
