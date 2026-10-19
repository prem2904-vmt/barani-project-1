import { of, throwError } from 'rxjs';
import { prepareTrendograms } from './trendogram-report';
import type { ApiService } from '../../core/services/api.service';

/**
 * Characterization tests for prepareTrendograms — MOCK-FREE.
 *
 * The Angular unit-test builder forbids `vi.mock` for relative imports, so we
 * do NOT module-mock ./trend-chart. Instead we inject a fake `api` (the
 * function takes ApiService as a parameter) and exercise every guard /
 * early-return branch, which never reaches the echarts/canvas render path.
 *
 * needs-harness: the actual render branch (>=2 filtered points →
 * renderTrendogramPng) depends on echarts + a real canvas and cannot run in
 * jsdom; it is intentionally not exercised here.
 */

const fakeApi = (impl: (url: string) => unknown): ApiService =>
  ({ get: (url: string) => impl(url) } as unknown as ApiService);

const reportWith = (obj: unknown) => ({ data: JSON.stringify(obj) });
const enabled = (patientId: string | undefined, extra: Record<string, unknown> = {}) =>
  reportWith({ trendogram: { enabled: true, ...extra }, patient: patientId ? { id: patientId } : {} });

describe('prepareTrendograms — guards & early returns (mock-free)', () => {
  it('returns [] on invalid JSON in report.data', async () => {
    const out = await prepareTrendograms({ data: '{not json' }, fakeApi(() => of({ tests: [] })));
    expect(out).toEqual([]);
  });

  it('returns [] when report.data is null', async () => {
    expect(await prepareTrendograms({ data: null }, fakeApi(() => of({ tests: [] })))).toEqual([]);
  });

  it('returns [] when the trendogram config is missing', async () => {
    expect(await prepareTrendograms(reportWith({ patient: { id: 'p1' } }), fakeApi(() => of({ tests: [] })))).toEqual([]);
  });

  it('returns [] when trendogram is explicitly disabled', async () => {
    const report = reportWith({ trendogram: { enabled: false }, patient: { id: 'p1' } });
    expect(await prepareTrendograms(report, fakeApi(() => of({ tests: [] })))).toEqual([]);
  });

  it('returns [] when the patient id is missing', async () => {
    expect(await prepareTrendograms(enabled(undefined), fakeApi(() => of({ tests: [] })))).toEqual([]);
  });

  it('returns [] (never throws) when the lab-trends call errors', async () => {
    const out = await prepareTrendograms(enabled('p1'), fakeApi(() => throwError(() => new Error('boom'))));
    expect(out).toEqual([]);
  });

  it('returns [] when the API returns an empty tests array', async () => {
    expect(await prepareTrendograms(enabled('p1'), fakeApi(() => of({ tests: [] })))).toEqual([]);
  });

  it('returns [] when the API response lacks a tests property', async () => {
    expect(await prepareTrendograms(enabled('p1'), fakeApi(() => of({})))).toEqual([]);
  });

  it('fetches the lab-trends endpoint for the specific patient id', async () => {
    let calledUrl = '';
    await prepareTrendograms(enabled('patient-xyz'), fakeApi((url) => { calledUrl = url; return of({ tests: [] }); }));
    expect(calledUrl).toBe('/api/patients/patient-xyz/lab-trends');
  });

  it('skips a chart whose points filter to fewer than 2 → [] (no render)', async () => {
    const trends = [{ testId: 't1', testName: 'CBC', parameters: [{ parameter: 'HGB', unit: 'g/dL', points: [] }] }];
    expect(await prepareTrendograms(enabled('p1'), fakeApi(() => of({ tests: trends })))).toEqual([]);
  });

  it('skips when an explicit chart references a missing test/parameter → []', async () => {
    const trends = [{ testId: 't1', testName: 'CBC', parameters: [{ parameter: 'HGB', unit: 'g/dL', points: [] }] }];
    const report = enabled('p1', { charts: [{ testId: 'does-not-exist', parameter: 'X' }] });
    expect(await prepareTrendograms(report, fakeApi(() => of({ tests: trends })))).toEqual([]);
  });

  it('falls back to one chart per test (first param) when no explicit charts, still skipping empty points → []', async () => {
    const trends = [{ testId: 't1', testName: 'CBC', parameters: [{ parameter: 'HGB', unit: 'g/dL', points: [] }] }];
    expect(await prepareTrendograms(enabled('p1'), fakeApi(() => of({ tests: trends })))).toEqual([]);
  });
});
