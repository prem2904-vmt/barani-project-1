import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportStructureComponent } from './report-structure.component';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Patient-safety RCA (2026-09-27): the print order must ALWAYS keep the
 * results table in what it saves for a test with values — it can be moved,
 * never deleted. A layout stored before the fix with ONLY a Sentence (the
 * server stripped the table) opens WITH the table and saves it back.
 */
async function make(inputs: Record<string, unknown>, stored: unknown[] = []) {
  let latest = stored;
  const layout = {
    getTestLayout: vi.fn(async () => ({ sections: latest, configured: latest.length > 0 })),
    saveTestLayout: vi.fn(async (_id: string, secs: unknown[]) => { latest = secs; return {}; }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ReportLayoutService, useValue: layout },
      { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(ReportStructureComponent);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  await f.whenStable();
  vi.useFakeTimers();
  return { c: f.componentInstance as any, layout };
}
const lastSave = (layout: { saveTestLayout: { mock: { calls: unknown[][] } } }) =>
  layout.saveTestLayout.mock.calls.at(-1)![1] as Array<{ type?: string; template?: string }>;

const SENTENCE_ONLY = [{ id: 'p1', type: 'paragraph', order: 1, template: 'Fasting of 8-10 hours is required' }];

describe('ReportStructure — the results table is always saved for a test with values', () => {
  afterEach(() => vi.useRealTimers());

  it('adding a Sentence to a test with no layout saves the table AND the Sentence', async () => {
    const { c, layout } = await make({ testId: 'glu', parameters: ['Glucose Fasting'], recordsValues: true });
    c.addSection('paragraph');
    c.setTemplate(c.rows()[1], 'Fasting of 8-10 hours is required');
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastSave(layout).map(s => s.type)).toEqual(['grid', 'paragraph']);
  });

  it('a stored Sentence-only layout opens with the results table first and saves it back', async () => {
    const { c, layout } = await make({ testId: 'glu', parameters: ['Glucose Fasting'], recordsValues: true }, SENTENCE_ONLY);
    expect(c.rows().map((r: any) => r.kind)).toEqual(['grid', 'paragraph']);
    expect(c.rows()[0].canDelete).toBe(false);
    c.setTemplate(c.rows()[1], 'Fasting of 10 hours is required');
    await vi.advanceTimersByTimeAsync(1000);
    const secs = lastSave(layout);
    expect(secs.map(s => s.type)).toEqual(['grid', 'paragraph']);
    expect(secs[1].template).toBe('Fasting of 10 hours is required');
  });

  it('the table can be MOVED below the Sentence — still saved', async () => {
    const { c, layout } = await make({ testId: 'glu', parameters: ['Glucose Fasting'], recordsValues: true }, SENTENCE_ONLY);
    c.moveRow(c.rows()[0], 1);
    await vi.advanceTimersByTimeAsync(300);
    expect(lastSave(layout).map(s => s.type)).toEqual(['paragraph', 'grid']);
  });

  it('removing the table is refused — the save still carries it', async () => {
    const { c, layout } = await make({ testId: 'glu', parameters: ['Glucose Fasting'], recordsValues: true });
    c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(300);
    c.removeRow(c.rows()[0]);
    await vi.advanceTimersByTimeAsync(300);
    expect(lastSave(layout).map(s => s.type)).toEqual(['grid', 'paragraph']);
  });

  it('narrative-only (the Sentence writes out every value) is left alone', async () => {
    const stored = [{ id: 'p1', type: 'paragraph', order: 1, template: 'Gross: {{Gross}}' }];
    const { c } = await make({ testId: 'histo', parameters: ['Gross'], recordsValues: true }, stored);
    expect(c.rows().map((r: any) => r.kind)).toEqual(['paragraph']);
  });

  it('a profile (no values of its own) keeps its Sentence-only print order', async () => {
    const { c, layout } = await make({ testId: 'dp', parameters: ['HbA1c'], recordsValues: false }, SENTENCE_ONLY);
    expect(c.rows().map((r: any) => r.kind)).toEqual(['paragraph']);
    c.setTemplate(c.rows()[0], 'x');
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastSave(layout).map(s => s.type)).toEqual(['paragraph']);
  });
});
