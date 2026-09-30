import { of, throwError, Subject } from 'rxjs';
import { vi } from 'vitest';
import { buildReportPdf } from './report-pdf';
import type { ReportColumn, ResolvedReportLayout } from '../models/report-layout.model';
import {
  ensureStoredReportPdf, fetchStoredReportPdf, storedReportPdfPath, storeReportPdf, StoredReportPdfError,
} from './stored-report-pdf';
import { ApiError } from '../models/api-response.model';

/**
 * Owner rule (2026-09-29): "Once a report has been generated, it has to stay in
 * blob storage. When they view it, it has to fetch it from blob storage only."
 * Every report screen goes through ensureStoredReportPdf.
 */
const pdf = (s: string) => new Blob([`%PDF-1.4 ${s}`], { type: 'application/pdf' });
const text = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(Buffer.from(r.result as ArrayBuffer).toString('latin1'));
  r.onerror = () => rej(r.error);
  r.readAsArrayBuffer(b);
});
const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function apiDouble(opts: { stored?: Blob | null; getError?: unknown; postError?: unknown } = {}) {
  let stored = opts.stored ?? null;
  const api = {
    getBlob: vi.fn(() => opts.getError ? throwError(() => opts.getError) : stored ? of(stored) : throwError(() => http(404))),
    post: vi.fn((_: string, body: FormData) => {
      if (opts.postError) return throwError(() => opts.postError);
      stored = body.get('file') as Blob;
      return of(null);
    }),
  };
  return api;
}

describe('stored report PDF — fetch from storage only', () => {
  it('a stored report is served as stored: no render, no upload', async () => {
    const api = apiDouble({ stored: pdf('stored-at-release') });
    const render = vi.fn(async () => pdf('live-render'));
    const blob = await ensureStoredReportPdf(api, 'rep-a', render);
    expect(await text(blob)).toContain('stored-at-release');
    expect(render).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.getBlob).toHaveBeenCalledWith('/api/reports/rep-a/pdf');
  });

  it('nothing stored yet (404): rendered ONCE from the snapshot and stored; the next view reads the stored file', async () => {
    const api = apiDouble();
    const render = vi.fn(async () => pdf('first-render'));
    expect(await text(await ensureStoredReportPdf(api, 'rep-b', render))).toContain('first-render');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][0]).toBe('/api/reports/rep-b/pdf');
    const again = vi.fn(async () => pdf('would-be-live'));
    expect(await text(await ensureStoredReportPdf(api, 'rep-b', again))).toContain('first-render');
    expect(again).not.toHaveBeenCalled();
  });

  it('after the first store it shows what the server serves — our report + attached partner pages (one PDF)', async () => {
    const api = apiDouble();
    let calls = 0;
    api.getBlob.mockImplementation(() => (calls++ === 0 ? throwError(() => http(404)) : of(pdf('ours+partner'))));
    const blob = await ensureStoredReportPdf(api, 'rep-m', async () => pdf('ours-only'));
    expect(await text(blob)).toContain('ours+partner');
    expect(api.post).toHaveBeenCalledTimes(1);
    // A read-back that fails ONCE is retried — our render lacks the partner pages.
    const api3 = apiDouble();
    let c3 = 0;
    api3.getBlob.mockImplementation(() => {
      const n = c3++;
      return n === 0 ? throwError(() => http(404)) : n === 1 ? throwError(() => http(502)) : of(pdf('ours+partner'));
    });
    expect(await text(await ensureStoredReportPdf(api3, 'rep-r', async () => pdf('ours-only')))).toContain('ours+partner');
    expect(api3.getBlob).toHaveBeenCalledTimes(3);
    // The read-back failing for good falls back to our own render (never an error).
    const api2 = apiDouble();
    let c2 = 0;
    api2.getBlob.mockImplementation(() => (c2++ === 0 ? throwError(() => http(404)) : throwError(() => http(500))));
    expect(await text(await ensureStoredReportPdf(api2, 'rep-n', async () => pdf('ours-only')))).toContain('ours-only');
  });

  it('lost the race (409 already_stored): shows the file the other screen stored', async () => {
    const api = apiDouble({ postError: new ApiError('stored', 'already_stored') });
    let calls = 0;
    api.getBlob.mockImplementation(() => (calls++ === 0 ? throwError(() => http(404)) : of(pdf('winner'))));
    const blob = await ensureStoredReportPdf(api, 'rep-c', async () => pdf('loser'));
    expect(await text(blob)).toContain('winner');
    expect(await storeReportPdf(api, 'rep-c', pdf('x'))).toBe('exists');
  });

  it('upload failed (offline / storage down): the rendered copy is shown, the next view retries', async () => {
    const api = apiDouble({ postError: http(503) });
    const render = vi.fn(async () => pdf('unsaved'));
    expect(await text(await ensureStoredReportPdf(api, 'rep-d', render))).toContain('unsaved');
    await ensureStoredReportPdf(api, 'rep-d', render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('a failed READ is an error — never a silent live re-render', async () => {
    const api = apiDouble({ getError: http(500) });
    const render = vi.fn(async () => pdf('live'));
    await expect(ensureStoredReportPdf(api, 'rep-e', render)).rejects.toBeInstanceOf(StoredReportPdfError);
    expect(render).not.toHaveBeenCalled();
    await expect(fetchStoredReportPdf(api, 'rep-e')).rejects.toBeInstanceOf(StoredReportPdfError);
  });

  it('two screens at once share ONE render + upload', async () => {
    const api = apiDouble();
    const gate = new Subject<void>();
    const render = vi.fn(() => new Promise<Blob>(res => gate.subscribe(() => res(pdf('shared')))));
    const a = ensureStoredReportPdf(api, 'rep-f', render);
    const b = ensureStoredReportPdf(api, 'rep-f', render);
    await Promise.resolve(); await new Promise(r => setTimeout(r, 0));
    gate.next();
    expect(await text(await a)).toContain('shared');
    expect(await text(await b)).toContain('shared');
    expect(render).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('the letterhead-paper print is its own stored variant', async () => {
    expect(storedReportPdfPath('r1', 'letterpad')).toBe('/api/reports/r1/pdf?variant=letterpad');
    const api = apiDouble();
    await ensureStoredReportPdf(api, 'rep-g', async () => pdf('blank-letterhead'), 'letterpad');
    expect(api.getBlob).toHaveBeenCalledWith('/api/reports/rep-g/pdf?variant=letterpad');
    expect(api.post.mock.calls[0][0]).toBe('/api/reports/rep-g/pdf?variant=letterpad');
  });

  it('an api without getBlob (older doubles) counts as "nothing stored"', async () => {
    expect(await fetchStoredReportPdf({ post: vi.fn() } as never, 'x')).toBeNull();
  });
});

// ── The first (and only) render prints the SAVED range / unit ───────────────
const col = (name: string, label: string, type: string, order: number) =>
  ({ id: 'c-' + name, name, label, order, width: 20, type, locked: false, linkedNext: false }) as ReportColumn;

/** The layout engine resolves range / unit cells from the LIVE Test Master. */
const liveLayout = {
  testId: 'glu', testName: 'Glucose Fasting', departmentName: 'Biochemistry',
  columns: [col('name', 'Investigation', 'name', 1), col('result', 'Result', 'result', 2),
    col('unit', 'Unit', 'unit', 3), col('range', 'Reference range', 'range', 4)],
  sections: [{ id: 'g', type: 'grid', order: 1, isVisible: true, rows: [
    { id: 'r', parameterName: 'glu', title: 'Glucose Fasting', isMerged: false,
      cells: { name: 'Glucose Fasting', result: '132', unit: 'mmol/L', range: '900-999' } },
  ] }],
} as unknown as ResolvedReportLayout;

function renderWith(values: Record<string, unknown>): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 45, sex: 'Female' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-27T00:00:00Z' },
    type: 'final',
    tests: [{ testId: 'glu', name: 'Glucose Fasting', department: 'Biochemistry', result: { values } }],
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-27T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: { glu: liveLayout },
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

describe('report PDF: range / unit come from the snapshot, not the live Test Master (audit H1)', () => {
  it('prints the range + unit SAVED at sign-off even after the Test Master changed', () => {
    const out = renderWith({ glu: { value: '132', flag: 'H', unit: 'mg/dL', range: '70-110' } });
    expect(out).toContain('70-110');
    expect(out).toContain('mg/dL');
    expect(out).not.toContain('900-999');
    expect(out).not.toContain('mmol/L');
  });

  it('a legacy value saved without range / unit falls back to the layout (frozen once stored)', () => {
    const out = renderWith({ glu: { value: '132', flag: 'H' } });
    expect(out).toContain('900-999');
    expect(out).toContain('mmol/L');
  });
});
