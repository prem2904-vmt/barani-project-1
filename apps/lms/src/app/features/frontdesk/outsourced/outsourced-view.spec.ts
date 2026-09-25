import {
  OutsourcedTube, absoluteFileUrl, actionLines, countByStatus, filterOutsourced, partnerFileProblem,
  partnerOptions, partnerReportShareLine, rowReport,
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
