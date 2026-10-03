import { completedTubeStatus, pendingLine, planReadiness, ReportReadiness, reportReadinessUrl } from './report-readiness';

const base: ReportReadiness = { hasReport: false, complete: false, pending: [], partialSampleIds: [] };

describe('planReadiness', () => {
  it('sample 26285: lines still open on the ONLY tube → explains, never "No report for this order"', () => {
    const p = planReadiness({
      ...base,
      pending: [{ sampleId: 's1', barcode: '26285', status: 'received',
        tests: ['Urine Bilirubin', 'Urine Urobilinogen', 'Urine Blood / Hemoglobin', 'Urine Nitrite', 'Urine Leukocyte Esterase'] }],
    }, true);
    expect(p.kind).toBe('pending');
    expect(p.message).toContain('created when all tests on this order are validated');
    expect(p.message).toContain('5 tests on 1 sample still pending');
    expect(p.items).toEqual(['26285 · Urine Bilirubin, Urine Urobilinogen, Urine Blood / Hemoglobin +2 more']);
    expect(p.openSampleId).toBe('s1');
  });

  it('another tube fully validated → offers a PRELIMINARY report of it (release rights only)', () => {
    const r: ReportReadiness = {
      ...base,
      pending: [{ sampleId: 's2', barcode: '26287', status: 'pending', tests: ['Epithelial Casts'] }],
      partialSampleIds: ['s1'],
    };
    const p = planReadiness(r, true);
    expect(p.kind).toBe('partial');
    expect(p.partialSampleIds).toEqual(['s1']);
    expect(p.message).toContain('PRELIMINARY');
    expect(p.items).toEqual(['26287 (not collected yet) · Epithelial Casts']);
    expect(planReadiness(r, false).kind).toBe('pending');
  });

  it('all validated but no report → Generate now; without release rights, says who can', () => {
    const r = { ...base, complete: true };
    expect(planReadiness(r, true).kind).toBe('generate');
    const p = planReadiness(r, false);
    expect(p.kind).toBe('pending');
    expect(p.message).toContain('Ask someone who releases reports');
  });

  it('a report exists → ready', () => {
    expect(planReadiness({ ...base, hasReport: true, reportId: 'r1' }, true).kind).toBe('ready');
  });

  it('url', () => {
    expect(reportReadinessUrl('a b')).toBe('/api/reports/readiness/a%20b');
  });

  it('pendingLine without a barcode', () => {
    expect(pendingLine({ sampleId: 'x', status: 'received', tests: ['A'] })).toBe('Sample · A');
  });
});

describe('completedTubeStatus', () => {
  it('own lines validated but other lines open → partial, never "validated"', () => {
    expect(completedTubeStatus(['validated', 'validated'], 5)).toBe('partial');
  });
  it('every line validated → validated', () => {
    expect(completedTubeStatus(['validated'], 0)).toBe('validated');
  });
  it('any own line only submitted → entered', () => {
    expect(completedTubeStatus(['validated', 'entered'], 0)).toBe('entered');
    expect(completedTubeStatus([], 0)).toBe('entered');
  });
});
