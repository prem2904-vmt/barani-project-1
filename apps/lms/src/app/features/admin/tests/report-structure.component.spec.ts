import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportStructureComponent } from './report-structure.component';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Test Master single-source — Stage 1 safety net for the printed-report
 * structure (pf-report-structure). Phase 0 (done): the first edit of a test
 * with no saved layout materialises the implicit results table as a grid
 * section with NO stored rows — parameters[] are the report rows; the layout
 * keeps only overrides keyed by param, unlisted params are listed at render.
 * (Before: one row per parameter was snapshotted, so later values vanished.)
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

describe('ReportStructure — implicit structure + materialisation (Phase 0: overrides only)', () => {
  afterEach(() => vi.useRealTimers());

  it('with no saved layout the print order is one implicit Results table (+ Images when attachments on)', async () => {
    const { c } = await make({ testId: 't1', parameters: ['hb', 'wbc'], attachments: true });
    expect(c.rows().map((r: any) => r.kind)).toEqual(['grid', 'image']);
    expect(c.rows()[0].implicit).toBe(true);
  });

  it('the first edit stores the sections with an EMPTY grid (no per-parameter snapshot)', async () => {
    const { c, layout } = await make({ testId: 't1', parameters: ['hb', 'wbc', 'plt'] });
    c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(200);
    expect(layout.saveTestLayout).toHaveBeenCalledTimes(1);
    const [id, secs] = layout.saveTestLayout.mock.calls[0] as any[];
    expect(id).toBe('t1');
    expect(secs.map((s: any) => s.type)).toEqual(['grid', 'paragraph']);
    expect(secs[0].rows).toEqual([]);
    expect(secs.map((s: any) => s.order)).toEqual([1, 2]);
  });

  it('a parameter added to the test later needs no layout change (rows stay override-only)', async () => {
    const { c, layout, f } = await make({ testId: 't1', parameters: ['hb'] });
    c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(200);
    f.componentRef.setInput('parameters', ['hb', 'wbc']);
    c.moveRow(c.rows()[1], -1);
    await vi.advanceTimersByTimeAsync(200);
    const secs = (layout.saveTestLayout.mock.calls.at(-1) as any[])[1];
    const grid = secs.find((s: any) => s.type === 'grid');
    expect(grid.rows).toEqual([]);
  });

  it('miniature table excludes hidden (printOnReport:false) values and caps at 6 (+N more)', async () => {
    const { c } = await make({ testId: 't1', parameters: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], hiddenParams: ['b'] });
    expect(c.shownParams()).toEqual(['a', 'c', 'd', 'e', 'f', 'g']);
    expect(c.moreParams()).toBe(1);
  });

  it('TARGET phase 0/5: stored layout keeps only overrides — no per-parameter row snapshot', async () => {
    const { c, layout } = await make({ testId: 't1', parameters: ['hb', 'wbc'] });
    c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(200);
    const secs = (layout.saveTestLayout.mock.calls[0] as any[])[1];
    const grid = secs.find((s: any) => s.type === 'grid');
    expect(grid.rows ?? []).toEqual([]);   // rows only when a param carries an override (cells/conditions)
  });
});

describe('ReportStructure — flag conditions (critical ⊂ high made explicit)', () => {
  afterEach(() => vi.useRealTimers());
  const defs = { wbc: { unit: 'x', referenceRanges: [{ segment: 'n', min: 4, max: 11, criticalHigh: 20 }] } };

  async function twoBlocks() {
    const r = await make({ testId: 't1', parameters: ['wbc'], paramDefs: defs });
    r.c.addSection('paragraph');
    r.c.addSection('paragraph');
    await vi.advanceTimersByTimeAsync(200);
    return r;
  }

  it('picking "is High or critical high" stores the engine\'s own shape: operator flag + the choice', async () => {
    const { c, layout } = await twoBlocks();
    const row = c.rows()[1];
    c.setCondMode(row, 'when');
    c.setOpChoice(c.rows()[1], 'flag:high_any');
    await vi.advanceTimersByTimeAsync(800);
    const secs = (layout.saveTestLayout.mock.calls.at(-1) as any[])[1];
    expect(secs[1].conditions).toEqual([
      { if: { parameter: 'wbc', operator: 'flag', value: 'high_any' }, then: { show: true } },
      { else: true, then: { show: false } },
    ]);
    expect(c.opChoice(c.rows()[1])).toBe('flag:high_any');
    expect(c.reachHint(c.rows()[1])).toBe('Prints for High and Critical high results.');
  });

  it('two blocks that both print for critical-high results say so; a flag the ranges never produce is flagged', async () => {
    const { c } = await twoBlocks();
    c.setCondMode(c.rows()[1], 'when');
    c.setOpChoice(c.rows()[1], 'flag:high_any');
    c.setCondMode(c.rows()[2], 'when');
    c.setOpChoice(c.rows()[2], 'flag:critical_high');
    expect(c.rowIssues(c.rows()[2]).map((i: any) => i.message)).toEqual(['Prints together with block 2 for Critical high results.']);
    c.setOpChoice(c.rows()[2], 'flag:critical_low');
    expect(c.rowIssues(c.rows()[2]).map((i: any) => i.message)).toEqual(['Never used — these ranges never produce Critical low.']);
  });
});
