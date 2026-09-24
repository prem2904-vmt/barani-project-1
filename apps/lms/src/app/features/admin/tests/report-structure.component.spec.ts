import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportStructureComponent } from './report-structure.component';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Test Master single-source — Stage 1 safety net for the printed-report
 * structure (pf-report-structure). TODAY the first edit of a test with no
 * saved layout MATERIALISES the implicit results table into a stored grid
 * section with ONE ROW PER PARAMETER (materialised() ~611) — a second list of
 * the test's values. A value added to the test later is therefore missing
 * from the stored layout. Phase 0/5: layout stores only overrides keyed by
 * param; unlisted params are appended at render.
 */
async function make(inputs: Record<string, unknown>) {
  const layout = {
    getTestLayout: vi.fn(async () => ({ sections: [], configured: false })),
    saveTestLayout: vi.fn(async () => ({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ReportLayoutService, useValue: layout },
      { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(ReportStructureComponent);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  // Let the load effect settle (no saved layout → implicit structure) BEFORE
  // the test drives edits with fake timers.
  f.detectChanges();
  await f.whenStable();
  vi.useFakeTimers();
  return { c: f.componentInstance as any, layout, f };
}

describe('ReportStructure — implicit structure + materialisation (CURRENT)', () => {
  afterEach(() => vi.useRealTimers());

  it('with no saved layout the print order is one implicit Results table (+ Images when attachments on)', async () => {
    const { c } = await make({ testId: 't1', parameters: ['hb', 'wbc'], attachments: true });
    expect(c.rows().map((r: any) => r.kind)).toEqual(['grid', 'image']);
    expect(c.rows()[0].implicit).toBe(true);
  });

  it('the first edit SNAPSHOTS every current parameter into stored grid rows', async () => {
    const { c, layout } = await make({ testId: 't1', parameters: ['hb', 'wbc', 'plt'] });
    c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(200);
    expect(layout.saveTestLayout).toHaveBeenCalledTimes(1);
    const [id, secs] = layout.saveTestLayout.mock.calls[0] as any[];
    expect(id).toBe('t1');
    expect(secs.map((s: any) => s.type)).toEqual(['grid', 'paragraph']);
    expect(secs[0].rows.map((r: any) => r.parameter_name)).toEqual(['hb', 'wbc', 'plt']);
    expect(secs.map((s: any) => s.order)).toEqual([1, 2]);
  });

  it('once stored, a parameter added to the test later is NOT in the saved rows', async () => {
    const { c, layout, f } = await make({ testId: 't1', parameters: ['hb'] });
    c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(200);
    // The host now lists a second value, but the stored grid keeps its snapshot.
    f.componentRef.setInput('parameters', ['hb', 'wbc']);
    c.moveRow(c.rows()[1], -1);
    await vi.advanceTimersByTimeAsync(200);
    const secs = (layout.saveTestLayout.mock.calls.at(-1) as any[])[1];
    const grid = secs.find((s: any) => s.type === 'grid');
    expect(grid.rows.map((r: any) => r.parameter_name)).toEqual(['hb']);
  });

  it('miniature table excludes hidden (printOnReport:false) values and caps at 6 (+N more)', async () => {
    const { c } = await make({ testId: 't1', parameters: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], hiddenParams: ['b'] });
    expect(c.shownParams()).toEqual(['a', 'c', 'd', 'e', 'f', 'g']);
    expect(c.moreParams()).toBe(1);
  });

  it.skip('TARGET phase 0/5: stored layout keeps only overrides — no per-parameter row snapshot', async () => {
    const { c, layout } = await make({ testId: 't1', parameters: ['hb', 'wbc'] });
    c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(200);
    const secs = (layout.saveTestLayout.mock.calls[0] as any[])[1];
    const grid = secs.find((s: any) => s.type === 'grid');
    expect(grid.rows ?? []).toEqual([]);   // rows only when a param carries an override (cells/conditions)
  });
});
