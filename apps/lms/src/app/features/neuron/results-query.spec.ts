import { TRUNCATED_NOTICE, fileNameFromDisposition, resultsFileName, resultsProblem, resultsWorkbookPath } from './results-query';

describe('Insert results: the request', () => {
  const base = { testIds: ['t2', 't1', 't1'], from: '2026-11-01', to: '2026-11-14' };
  it('builds the query: ids sorted + unique, dates, optional branch', () => {
    expect(resultsWorkbookPath(base)).toBe('/api/office/results-workbook?testIds=t1,t2&from=2026-11-01&to=2026-11-14');
    expect(resultsWorkbookPath({ ...base, branchId: 'b 1' })).toBe('/api/office/results-workbook?testIds=t1,t2&from=2026-11-01&to=2026-11-14&branchId=b%201');
    expect(resultsWorkbookPath({ ...base, branchId: '' })).not.toContain('branchId');
    expect(resultsWorkbookPath({ ...base, branchId: null })).not.toContain('branchId');
  });
  it('says in plain words why it cannot be sent', () => {
    expect(resultsProblem({ ...base, testIds: [] })).toBe('Pick at least one test.');
    expect(resultsProblem({ ...base, from: '' })).toBe('Pick the first and last date.');
    expect(resultsProblem({ ...base, from: '2026-11-15' })).toBe('The first date is after the last date.');
    expect(resultsProblem(base)).toBeNull();
  });
  it('the truncation notice is the agreed sentence', () => {
    expect(TRUNCATED_NOTICE).toBe('Only the first 5,000 rows were included. Narrow the dates to get the rest.');
  });
  it('names the new sheet from the response, else from the dates', () => {
    expect(resultsFileName('Glucose.xlsx', base)).toBe('Glucose.xlsx');
    expect(resultsFileName('Glucose', base)).toBe('Glucose.xlsx');
    expect(resultsFileName(null, base)).toBe('Results 2026-11-01 to 2026-11-14.xlsx');
    expect(fileNameFromDisposition('attachment; filename="Glucose results.xlsx"')).toBe('Glucose results.xlsx');
    expect(fileNameFromDisposition("attachment; filename=a.xlsx; filename*=UTF-8''G%C3%B6.xlsx")).toBe('Gö.xlsx');
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});
