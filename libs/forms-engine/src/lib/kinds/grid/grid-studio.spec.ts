import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FeDialog, FeDialogApi } from '../../kit';
import { vi } from 'vitest';
import { ApplyFieldChange } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { FE_KINDS, kindControl } from '../../fill/contract';
import { KIND_SPECS } from '../registry';
import { unnamed, untouchable } from '../../testing/render-kind';
import { GridEditorComponent, GridPanelComponent, gridSummary } from './grid.studio';
import { DENTAL } from './grid-model.spec';
import { GridConfig } from './grid-model';

@Component({
  standalone: true,
  imports: [GridPanelComponent],
  template: `<fe-grid-panel [field]="field()" [apply]="apply" />`,
})
class Host {
  readonly field = signal<FieldDef>({ key: 'teeth', kind: 'grid', label: 'Dental chart', config: structuredClone(DENTAL) as never });
  readonly applied: FieldDef[] = [];
  /** Like Studio: the change runs on a draft copy, and the new definition comes back as the field. */
  readonly apply: ApplyFieldChange = (change) => {
    const draft = structuredClone(this.field());
    change(draft);
    this.applied.push(draft);
    this.field.set(draft);
  };
}

async function setup(dialog: Partial<FeDialogApi> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: FE_KINDS, useValue: KIND_SPECS }, ...(Object.keys(dialog).length ? [{ provide: FeDialog, useValue: dialog }] : [])],
  });
  const fx = TestBed.createComponent(Host);
  fx.detectChanges();
  await fx.whenStable();
  const host = fx.componentInstance;
  const stable = async () => {
    fx.detectChanges();
    await fx.whenStable();
    await new Promise((r) => setTimeout(r));
    fx.detectChanges();
  };
  await stable();
  const panel = fx.nativeElement as HTMLElement;
  const ed = () => document.body.querySelector<HTMLElement>('fe-grid-editor')!;
  const click = async (root: HTMLElement, sel: string) => {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`nothing matches ${sel}`);
    el.click();
    await stable();
  };
  const type = async (root: HTMLElement, sel: string, value: string, ev: 'change' | 'input' = 'change') => {
    const el = root.querySelector<HTMLInputElement>(sel)!;
    el.value = value;
    el.dispatchEvent(new Event(ev));
    await stable();
  };
  const cfg = () => host.field().config as unknown as GridConfig;
  return { fx, host, panel, ed, click, type, cfg, stable };
}

describe('grid Studio panel and editor', () => {
  // LMS port: the grid control is a lazy chunk; in the LMS test build it lands after one macrotask, so load it once
  // up front (the tryout then renders at once, as it did in Prepare's smaller build).
  beforeAll(async () => { await kindControl(KIND_SPECS['grid']); });
  afterEach(() => document.body.querySelectorAll('fe-grid-editor').forEach((e) => e.remove()));

  it('the panel: what the table holds, the real table to try, and Edit the table', async () => {
    const t = await setup();
    expect(t.panel.querySelector('.fe-kpanel__title')?.textContent).toContain('3 rows · 3 columns · 1 merged heading · 2 Quick fill chips');
    expect(t.panel.querySelectorAll('fe-grid-tryout [data-cell]')).toHaveLength(9);
    await t.click(t.panel, '[data-act="edit-table"]');
    expect(t.ed()).toBeTruthy();
    expect(t.ed().parentElement).toBe(document.body); // lifted out of the settings card
    expect(untouchable(t.ed())).toEqual([]);
    expect(unnamed(t.ed())).toEqual([]);
    expect(t.ed().textContent).not.toMatch(/\{(value|label|row|cells)\}/);
    await t.click(t.ed(), '[data-act="close-editor"]');
    expect(t.ed()).toBeNull();
  });

  it('adds a column, changes its type and adds a choice (one Studio edit each)', async () => {
    const t = await setup();
    await t.click(t.panel, '[data-act="edit-table"]');
    await t.type(t.ed(), '[data-input="new-column"]', 'Pocket depth');
    await t.click(t.ed(), '[data-act="add-column"]');
    expect(t.cfg().columns[3]).toEqual({ key: 'pocketDepth', label: 'Pocket depth', type: 'text' });
    // the new column is open
    await t.click(t.ed(), '[data-column="pocketDepth"] [data-type="number"]');
    await t.type(t.ed(), '[data-column="pocketDepth"] [data-input="unit"]', 'mm');
    expect(t.cfg().columns[3]).toEqual({ key: 'pocketDepth', label: 'Pocket depth', type: 'number', unit: 'mm' });
    await t.click(t.ed(), '[data-column="pocketDepth"] [data-type="choice"]');
    await t.type(t.ed(), '[data-column="pocketDepth"] [data-input="new-choice"]', 'Deep');
    await t.click(t.ed(), '[data-column="pocketDepth"] [data-act="add-choice"]');
    expect(t.cfg().columns[3].options).toEqual([
      { key: 'normal', label: 'Normal' },
      { key: 'deep', label: 'Deep' },
    ]);
    expect(t.host.applied).toHaveLength(5); // add, number, unit, choice, a choice
  });

  it('adds rows in one go (a dental quadrant) and merges a label', async () => {
    const t = await setup();
    await t.click(t.panel, '[data-act="edit-table"]');
    await t.click(t.ed(), '[data-tab="rows"]');
    const area = t.ed().querySelector<HTMLTextAreaElement>('[data-input="new-rows"]')!;
    area.value = '15-11';
    await t.click(t.ed(), '[data-act="add-rows"]');
    expect(t.cfg().rows.map((r) => r.label)).toEqual(['18', '17', '16', '15', '14', '13', '12', '11']);
    await t.click(t.ed(), '[data-row="t18"] [data-act="open-row"]');
    await t.click(t.ed(), '[data-row="t18"] [data-act="span-more"]');
    expect(t.cfg().rows[0].labelSpan).toBe(2);
    await t.click(t.ed(), '[data-row="t18"] [data-cell="status"] [data-act="merge"]');
    expect(t.cfg().rows[0].cells).toEqual([{ column: 'status', colSpan: 2 }]);
    await t.click(t.ed(), '[data-row="t18"] [data-cell="note"] [data-act="no-box"]');
    expect(t.cfg().rows[0].cells).toEqual([
      { column: 'status', colSpan: 2 },
      { column: 'note', fields: [] },
    ]);
  });

  it('adds a Quick fill chip that fills one column', async () => {
    const t = await setup();
    await t.click(t.panel, '[data-act="edit-table"]');
    await t.click(t.ed(), '[data-tab="quick"]');
    await t.type(t.ed(), '[data-input="new-chip"]', 'Grade 1');
    await t.click(t.ed(), '[data-act="add-chip"]');
    await t.click(t.ed(), '[data-preset="2"] [data-scope="column"]');
    expect(t.cfg().quickFill).toEqual({
      enabled: true,
      presets: [{ label: 'All sound', value: 'Sound' }, { label: 'No mobility', value: 'None', scope: 'column' }, { label: 'Grade 1', scope: 'column' }],
    });
    // an empty chip is refused in plain words
    await t.click(t.ed(), '[data-act="add-chip"]');
    expect(t.ed().querySelector('.fe-gedit__note')?.textContent).toContain('Type the chip first');
  });

  it('removing a column asks first', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const t = await setup({ confirm });
    await t.click(t.panel, '[data-act="edit-table"]');
    await t.click(t.ed(), '[data-column="status"] [data-act="open-column"]');
    await t.click(t.ed(), '[data-column="status"] [data-act="remove-column"]');
    expect(confirm).toHaveBeenCalled();
    expect(t.cfg().columns.map((c) => c.key)).toEqual(['mobility', 'note']);
    expect(t.cfg().headerGroups).toEqual([{ label: 'Findings', from: 'mobility' }]);
  });

  it('a cell sentence reads in words and is stored with its placeholders', async () => {
    const t = await setup();
    await t.click(t.panel, '[data-act="edit-table"]');
    await t.click(t.ed(), '[data-column="note"] [data-act="open-column"]');
    const read = t.ed().querySelector<HTMLElement>('[data-column="note"] .fe-gwords__read')!;
    expect(read.textContent?.replace(/\s+/g, ' ').trim()).toBe('the box name: the answer');
    await t.click(t.ed(), '[data-column="note"] .fe-gwords__read');
    await t.type(t.ed(), '[data-column="note"] .fe-gwords__edit input', '{row} {value}', 'input');
    await t.click(t.ed(), '[data-column="note"] [data-act="words-done"]');
    expect(t.cfg().columns[2].says).toEqual({ template: '{row} {value}' });
  });

  it('summary words', () => {
    expect(gridSummary({ columns: [{ key: 'a', label: 'A' }], rows: [{ key: 'r', label: 'R' }] })).toBe('1 row · 1 column');
    expect(GridEditorComponent).toBeTruthy();
  });
});
