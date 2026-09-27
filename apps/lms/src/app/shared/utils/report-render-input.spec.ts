import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiError } from '../models/api-response.model';
import { buildReportPdf } from './report-pdf';
import { isAccessFailure } from './report-layouts';
import { ApiLike, loadReportTemplate, prepareReportPdfInput, ReportRenderError, reportRenderErrorMessage } from './report-render-input';

/**
 * "The same report looks different depending on WHICH user views it"
 * (owner, 2026-09-27). Reception got a 403 on the report template and every
 * entry point swallowed it (`.catch(() => null)`), so the PDF silently fell
 * back to the product default: "PREFRONTAL PATHOLOGY LAB", no phone/email, no
 * Centre, letter flags, no department Sample IDs.
 *
 * The contract now: the render inputs come from ONE recipe that either loads
 * the lab's design or throws — it never renders a default-looking report — and
 * the same report renders byte-for-byte the same for every viewer.
 */

const TEMPLATE = {
  labName: 'Micro world',
  phone: '0427 555 0101',
  email: 'lab@microworld.test',
  flagIndicator: 'arrow',
  groupByDepartment: true,
  patientColumnsJson: JSON.stringify([['name', 'age', 'sex'], ['branch', 'refdoctor'], ['registered', 'reported']]),
};

const SNAPSHOT = {
  type: 'final',
  patient: { displayName: 'Mr. low', age: 45, sex: 'M' },
  order: { id: 'o1', orderNumber: 'LAB-2609-000106', createdAt: '2026-09-27T06:11:45Z', branchName: 'Salem' },
  tests: [{
    testId: 'fbs', name: 'Fasting Blood Sugar', packageTestId: null, packageType: null,
    department: 'Biochemistry', sampleType: 'Serum', sampleId: '26150',
    result: { values: { FBS: { value: 52, unit: 'mg/dL', range: '70-100', flag: 'L' } } },
  }],
};
const REPORT = { id: 'r1', type: 'final', createdAt: '2026-09-27T06:17:08Z', data: JSON.stringify(SNAPSHOT) };

const forbidden = () => throwError(() => new ApiError('Your role does not have permission for this action.', 'forbidden'));

/** An ApiService stand-in. `templateFails` models the pre-fix reception 403. */
function fakeApi(opts: { template?: unknown; templateFails?: boolean } = {}): ApiLike {
  const get = vi.fn((path: string) => {
    if (path === '/api/config/report-template') return opts.templateFails ? forbidden() : of(opts.template ?? null);
    return of(null);
  });
  return { get } as unknown as ApiLike;
}
const okPreview = vi.fn(async (testId: string) => ({ testId, testName: 'Fasting Blood Sugar', departmentName: 'Biochemistry', columns: [], sections: [] }));

function pdfText(doc: ReturnType<typeof buildReportPdf>): string {
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}
/** Page content streams only — no CreationDate / file ID, which vary per run. */
function pageStreams(doc: ReturnType<typeof buildReportPdf>): string {
  return JSON.stringify((doc as unknown as { internal: { pages: unknown[] } }).internal.pages);
}

describe('report render inputs never fall back to the default design', () => {
  it('a template 403 throws ReportRenderError instead of rendering the product default', async () => {
    const api = fakeApi({ templateFails: true });
    await expect(prepareReportPdfInput(REPORT, { api, preview: okPreview, apiUrl: '' }))
      .rejects.toBeInstanceOf(ReportRenderError);
    await expect(loadReportTemplate(api)).rejects.toMatchObject({ part: 'template' });
  });

  it('any template load failure (network, 500) throws too', async () => {
    const api = { get: vi.fn(() => throwError(() => new Error('Request timed out — check your connection'))) } as unknown as ApiLike;
    await expect(loadReportTemplate(api)).rejects.toBeInstanceOf(ReportRenderError);
  });

  it('a layout-preview 403 throws (the viewer would otherwise lose the lab\'s layout)', async () => {
    const preview = vi.fn(async () => { throw new ApiError('Your role does not have permission for this action.', 'forbidden'); });
    await expect(prepareReportPdfInput(REPORT, { api: fakeApi({ template: TEMPLATE }), preview, apiUrl: '' }))
      .rejects.toMatchObject({ name: 'ReportRenderError', part: 'layout' });
  });

  it('a deleted test (404) is the same for every viewer and keeps the plain-table fallback', async () => {
    const preview = vi.fn(async () => { throw new ApiError('Test not found', 'not_found'); });
    const input = await prepareReportPdfInput(REPORT, { api: fakeApi({ template: TEMPLATE }), preview, apiUrl: '' });
    expect(input.resolvedLayouts).toEqual({});
    expect(input.template).toEqual(TEMPLATE);
  });

  it('a lab that never saved a template (200, no data) gets null — same for everyone', async () => {
    expect(await loadReportTemplate(fakeApi({ template: null }))).toBeNull();
  });

  it('the error message is specific, the fallback stays for other failures', () => {
    expect(reportRenderErrorMessage(new ReportRenderError('design', 'template'), 'x')).toBe('design');
    expect(reportRenderErrorMessage(new Error('boom'), 'Could not download report')).toBe('Could not download report');
  });

  it('classifies viewer-dependent failures', () => {
    expect(isAccessFailure(new ApiError('nope', 'forbidden'))).toBe(true);
    expect(isAccessFailure({ status: 403 })).toBe(true);
    expect(isAccessFailure({ status: 0 })).toBe(true);
    expect(isAccessFailure(new Error('Request timed out — check your connection'))).toBe(true);
    expect(isAccessFailure(new ApiError('Test not found', 'not_found'))).toBe(false);
    expect(isAccessFailure(new Error('No layout'))).toBe(false);
  });
});

describe('the same report renders identically for every viewer', () => {
  it('admin and reception (different permission sets, same readable inputs) get the same PDF', async () => {
    // After the backend fix both can read the template + layouts; the renderer
    // takes no viewer / permission input at all, so the pages must match.
    const admin = await prepareReportPdfInput(REPORT, { api: fakeApi({ template: TEMPLATE }), preview: okPreview, apiUrl: '' });
    const reception = await prepareReportPdfInput(REPORT, { api: fakeApi({ template: { ...TEMPLATE } }), preview: okPreview, apiUrl: '' });
    expect(reception).toEqual(admin);
    expect(pageStreams(buildReportPdf(reception))).toBe(pageStreams(buildReportPdf(admin)));
  });

  it('the rendered report carries the lab\'s design, not the product default', async () => {
    const input = await prepareReportPdfInput(REPORT, { api: fakeApi({ template: TEMPLATE }), preview: okPreview, apiUrl: '' });
    const text = pdfText(buildReportPdf(input));
    // The wordmark prints its first word and the rest in two colours.
    expect(text).toContain('(MICRO)');
    expect(text).toContain('(WORLD)');
    expect(text).not.toContain('(PREFRONTAL)');
    expect(text).not.toContain('PATHOLOGY LAB');
    expect(text).toContain('Salem');                         // Centre, from the template's patient strip

    // Control: what reception used to get when the template 403'd.
    const fallback = pdfText(buildReportPdf({ ...input, template: null }));
    expect(fallback).toContain('(PREFRONTAL)');
    expect(fallback).not.toContain('Salem');
  });
});
