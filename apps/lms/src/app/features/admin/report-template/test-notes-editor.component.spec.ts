import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TestNotesEditorComponent } from './test-notes-editor.component';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Test Master single-source — Stage 1 safety net for the slim notes
 * (Description column) editor embedded in the test editor. TODAY writing the
 * first description SYNTHESISES a grid section with one row per parameter
 * (a stored copy of the value list), and the advanced cell editor lets an
 * admin TYPE the printed `unit` / `range` cells — a second source for what
 * the report prints next to the flag band.
 */
function make(params: string[]) {
  const layout = {
    getTestLayout: vi.fn(async () => ({ sections: [], configured: false })),
    saveTestLayout: vi.fn(async () => ({})),
    preview: vi.fn(async () => null),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn() } },
      { provide: ReportLayoutService, useValue: layout },
      { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(TestNotesEditorComponent);
  f.componentRef.setInput('parameters', params);
  const c = f.componentInstance as any;
  c.selectedTestId.set('t1');
  return { c, layout };
}

describe('TestNotesEditor — description rows (CURRENT)', () => {
  it('first description synthesises a grid with a row for EVERY host parameter, in order', () => {
    const { c } = make(['hb', 'wbc', 'plt']);
    c.setDescription('wbc', 'Raised in infection');
    const grid = c.sections().find((s: any) => s.type === 'grid');
    expect(grid.rows.map((r: any) => r.parameter_name)).toEqual(['hb', 'wbc', 'plt']);
    expect(c.descriptionFor('wbc')).toBe('Raised in infection');
    expect(c.descriptionFor('hb')).toBe('');
  });

  it('save() stores the synthesised rows (re-indexed) via saveTestLayout', async () => {
    const { c, layout } = make(['hb', 'wbc']);
    c.setDescription('hb', 'x');
    await c.save();
    const [id, payload] = layout.saveTestLayout.mock.calls[0] as any[];
    expect(id).toBe('t1');
    expect(payload[0].order).toBe(1);
    expect(payload[0].rows).toHaveLength(2);
  });

  it('typed unit / range cells are persisted verbatim (they override the engine value on print)', async () => {
    const { c, layout } = make(['hb']);
    c.setDescription('hb', 'x');
    c.patchCell(0, 0, 'unit', 'g%');
    c.patchCell(0, 0, 'range', '11-16');
    await c.save();
    const row = (layout.saveTestLayout.mock.calls[0] as any[])[1][0].rows[0];
    expect(row.cells).toMatchObject({ unit: 'g%', range: '11-16', description: 'x' });
  });

  it('cell placeholders advertise "blank → auto" for unit/range', () => {
    const { c } = make(['hb']);
    expect(c.cellPlaceholder('unit')).toBe('blank → auto');
    expect(c.cellPlaceholder('range')).toBe('blank → auto');
  });

  it.skip('TARGET phase 0: printed unit/range always come from params — typed unit/range cells are not offered/stored', async () => {
    const { c, layout } = make(['hb']);
    c.setDescription('hb', 'x');
    c.patchCell(0, 0, 'unit', 'g%');
    await c.save();
    const row = (layout.saveTestLayout.mock.calls[0] as any[])[1][0].rows[0];
    expect(row.cells.unit).toBeUndefined();
    expect(c.cellColumnNames()).not.toContain('unit');
  });

  it.skip('TARGET phase 0/5: a description override stores ONE row keyed by param (others appended at render)', async () => {
    const { c, layout } = make(['hb', 'wbc', 'plt']);
    c.setDescription('wbc', 'Raised in infection');
    await c.save();
    const rows = (layout.saveTestLayout.mock.calls[0] as any[])[1][0].rows;
    expect(rows.map((r: any) => r.parameter_name)).toEqual(['wbc']);
  });
});
