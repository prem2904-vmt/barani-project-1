import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TestNotesEditorComponent } from './test-notes-editor.component';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Test Master single-source — Stage 1 safety net for the slim notes
 * (Description column) editor embedded in the test editor. Phase 0 (done):
 * a description stores ONE override row keyed by param (no snapshot of every
 * parameter), and the printed `unit` / `range` cells are never typed — they
 * always come from the parameter (the backend ignores typed ones too).
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

describe('TestNotesEditor — description rows (Phase 0: overrides only)', () => {
  it('first description creates a grid with ONE row — the edited parameter (no snapshot)', () => {
    const { c } = make(['hb', 'wbc', 'plt']);
    c.setDescription('wbc', 'Raised in infection');
    const grid = c.sections().find((s: any) => s.type === 'grid');
    expect(grid.rows.map((r: any) => r.parameter_name)).toEqual(['wbc']);
    expect(c.descriptionFor('wbc')).toBe('Raised in infection');
    expect(c.descriptionFor('hb')).toBe('');
  });

  it('save() stores the override rows (re-indexed) via saveTestLayout', async () => {
    const { c, layout } = make(['hb', 'wbc']);
    c.setDescription('hb', 'x');
    await c.save();
    const [id, payload] = layout.saveTestLayout.mock.calls[0] as any[];
    expect(id).toBe('t1');
    expect(payload[0].order).toBe(1);
    expect(payload[0].rows).toHaveLength(1);
  });

  it('legacy typed unit / range cells are dropped on save (they print from the parameter)', async () => {
    const { c, layout } = make(['hb']);
    c.sections.set([{ id: 's', type: 'grid', order: 1, isVisible: true,
      rows: [{ id: 'r', row_merge: false, parameter_name: 'hb', cells: { unit: 'g%', range: '11-16', description: 'x' } }] }]);
    await c.save();
    const row = (layout.saveTestLayout.mock.calls[0] as any[])[1][0].rows[0];
    expect(row.cells).toEqual({ description: 'x' });
  });

  it('unit / range are not offered as editable cells', () => {
    const { c } = make(['hb']);
    expect(c.cellColumnNames()).not.toContain('unit');
    expect(c.cellColumnNames()).not.toContain('range');
    c.preview.set({ columns: [{ name: 'Units', type: 'unit' }, { name: 'Ref', type: 'range' }, { name: 'description', type: 'text' }] });
    expect(c.cellColumnNames()).toEqual(['description']);
  });

  it('TARGET phase 0: printed unit/range always come from params — typed unit/range cells are not offered/stored', async () => {
    const { c, layout } = make(['hb']);
    c.setDescription('hb', 'x');
    c.patchCell(0, 0, 'unit', 'g%');
    await c.save();
    const row = (layout.saveTestLayout.mock.calls[0] as any[])[1][0].rows[0];
    expect(row.cells.unit).toBeUndefined();
    expect(c.cellColumnNames()).not.toContain('unit');
  });

  it('TARGET phase 0/5: a description override stores ONE row keyed by param (others appended at render)', async () => {
    const { c, layout } = make(['hb', 'wbc', 'plt']);
    c.setDescription('wbc', 'Raised in infection');
    await c.save();
    const rows = (layout.saveTestLayout.mock.calls[0] as any[])[1][0].rows;
    expect(rows.map((r: any) => r.parameter_name)).toEqual(['wbc']);
  });
});
