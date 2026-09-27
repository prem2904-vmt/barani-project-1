import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { ReportPdfPreviewComponent } from './report-pdf-preview.component';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { PlatformService } from '../../../core/services/platform.service';
import { buildReportPdf } from '../../../shared/utils/report-pdf';

/**
 * Owner bug 2026-09-27 ("the desc are not coming in preview"): Micro World is a
 * reference-mode lab, so the first print-order save on the MASTER "Diabetes
 * Profile" materialised the lab's own row (new id) and stored the Sentence
 * THERE — but the open editor still carried the master id, and the engine's
 * preview renders the exact row it is given: the master's layout, with no
 * Sentence. The preview must render the row the edits (and new orders) reach.
 */
const MASTER = 'master-profile';
const OWN = 'lab-own-profile';
const SENTENCE = 'Kindly correlate HbA1c with fasting glucose';

function setup() {
  const layoutFor = (id: string) => {
    const cols = [
      { id: 'r', name: 'result', label: 'Result', order: 2, width: 40, type: 'result', locked: false },
      { id: 'd', name: 'description', label: 'Description', order: 3, width: 60, type: 'text', locked: false },
    ];
    if (id === OWN) return { testId: OWN, testName: 'Diabetes Profile', columns: cols, sections: [
      { id: 'p', type: 'paragraph', order: 1, isVisible: true, content: SENTENCE },
    ] };
    if (id === MASTER) return { testId: MASTER, testName: 'Diabetes Profile', columns: cols, sections: [] };
    return { testId: id, testName: 'Fasting Blood Sugar', columns: cols, sections: [
      { id: 'g', type: 'grid', order: 1, isVisible: true, rows: [
        { id: 'r1', parameterName: 'fbs', title: 'Fasting Blood Sugar', isMerged: false,
          cells: { result: '1.0', description: 'Raised in diabetes' } },
      ] },
    ] };
  };
  const layout = { preview: vi.fn(async (id: string) => layoutFor(id)) };
  const api = { get: vi.fn((path: string) =>
    of(path === `/api/tests/${MASTER}` ? { id: OWN } : path.startsWith('/api/tests/') ? { id: path.split('/').pop() } : null)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ReportLayoutService, useValue: layout },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
    ],
  });
  const f = TestBed.createComponent(ReportPdfPreviewComponent);
  f.componentRef.setInput('testId', MASTER);
  f.componentRef.setInput('testName', 'Diabetes Profile');
  f.componentRef.setInput('department', 'Biochemistry');
  f.componentRef.setInput('profileMembers', [
    { id: 'fbs-test', name: 'Fasting Blood Sugar', parameters: JSON.stringify({ parameters: [{ name: 'fbs' }] }) },
  ]);
  return { c: f.componentInstance, layout };
}

const pdfText = (input: unknown) =>
  Buffer.from(buildReportPdf(input as never).output('arraybuffer')).toString('latin1');

describe('ReportPdfPreview — renders what the editor saved', () => {
  it("previews the lab's own (effective) row, not the master it was opened from", async () => {
    const { c, layout } = setup();
    await c.buildPreviewInput();
    const ids = layout.preview.mock.calls.map(call => call[0]);
    expect(ids).toContain(OWN);
    expect(ids).not.toContain(MASTER);
  });

  it("the profile's Sentence prints in the preview PDF", async () => {
    const { c } = setup();
    expect(pdfText(await c.buildPreviewInput())).toContain(SENTENCE);
  });

  it("a member's description prints in the Description column of the profile block", async () => {
    const { c } = setup();
    expect(pdfText(await c.buildPreviewInput())).toContain('Raised in diabetes');
  });
});
