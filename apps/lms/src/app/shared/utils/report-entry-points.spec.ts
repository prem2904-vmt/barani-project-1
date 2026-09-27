import { of } from 'rxjs';
import { vi } from 'vitest';
import { signal } from '@angular/core';
import { ReportLayoutService } from '../../core/services/report-layout.service';
import { PlatformService } from '../../core/services/platform.service';
import { ReportQueueComponent } from '../../features/reports/report-queue/report-queue.component';
import { FrontdeskLandingComponent } from '../../features/frontdesk/frontdesk-landing/frontdesk-landing.component';
import { ReportViewerComponent } from '../../features/reports/report-viewer/report-viewer.component';
import { buildReportBlobUrl } from './report-blob';

/**
 * Test Master single source, phase-0 leftover: EVERY report entry point
 * resolves layouts through the ONE resolver (`resolveReportLayouts`), which
 * posts PLAIN values — the snapshot's `{ value, unit, range, flag }` wrappers
 * unwrapped — so a layout condition like "show when the result is above 70"
 * matches no matter which screen renders the report. Profile layouts (whose
 * notes print for ordered profiles) are resolved on every path too.
 */
const snapshot = {
  patient: { sex: 'M', age: 40 },
  tests: [
    { testId: 'glu', packageTestId: 'lipid', result: { values: { glucose: { value: 92, unit: 'mg/dL', range: '70–100', flag: 'N' } } }, images: ['a.jpg'] },
    { testId: 'hb', result: { values: { hb: 11.2, note: 'plain' } } },
  ],
};
const report = { id: 'r1', data: JSON.stringify(snapshot) } as any;

function previewSpy() {
  return vi.fn(async (testId: string) => ({ testId, sections: [], columns: [] }));
}
function injectorWith(preview: ReturnType<typeof previewSpy>) {
  const svc = { preview };
  const platform = { getApiUrl: () => '' };
  return {
    get: (token: unknown) => (token === ReportLayoutService ? svc : token === PlatformService ? platform : null),
  };
}
const api = { get: vi.fn(() => of(null)), post: vi.fn(() => of(null)) };

function expectPlainValues(preview: ReturnType<typeof previewSpy>) {
  const glu = preview.mock.calls.find(c => c[0] === 'glu') as unknown[] | undefined;
  expect(glu).toBeDefined();
  expect(glu![1]).toEqual({ glucose: 92 });                  // unwrapped scalar
  const hb = preview.mock.calls.find(c => c[0] === 'hb') as unknown[] | undefined;
  expect(hb![1]).toEqual({ hb: 11.2, note: 'plain' });       // already-plain values pass through
  expect(preview.mock.calls.some(c => c[0] === 'lipid')).toBe(true);   // profile layout resolved
}

describe('report entry points post PLAIN values to the layout preview', () => {
  it('report blob (patient timeline / share)', async () => {
    const preview = previewSpy();
    await buildReportBlobUrl(report, api, injectorWith(preview) as any);
    expectPlainValues(preview);
    const glu = preview.mock.calls.find(c => c[0] === 'glu') as unknown[];
    expect(glu[2]).toEqual(['a.jpg']);                        // snapshot images ride along
  });

  it('report queue (download / archive)', async () => {
    const preview = previewSpy();
    const c = Object.create(ReportQueueComponent.prototype) as any;
    c.injector = injectorWith(preview);
    c.api = api;
    await c.buildReportRender(report);
    expectPlainValues(preview);
  });

  it('front desk (collect / print)', async () => {
    const preview = previewSpy();
    const c = Object.create(FrontdeskLandingComponent.prototype) as any;
    c.injector = injectorWith(preview);
    c.api = api;
    await c.reportInput(report);
    expectPlainValues(preview);
  });

  it('report viewer (on-screen report)', async () => {
    const preview = previewSpy();
    const c = Object.create(ReportViewerComponent.prototype) as any;
    Object.defineProperty(c, 'data', { value: () => snapshot });
    Object.defineProperty(c, 'layoutSvc', { value: { preview } });
    Object.defineProperty(c, '_resolved', { value: signal({}) });
    await c.resolveLayouts();
    expectPlainValues(preview);
    expect(Object.keys(c._resolved())).toEqual(expect.arrayContaining(['glu', 'hb']));
  });
});
