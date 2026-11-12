import manifest from '../../testing/components.manifest.json';
import { FieldDef } from '../../core/types';
import { f, renderKind, unnamed, untouchable, vi } from '../../testing/render-kind';
import { GRID_ADVANCE_MS, GridFill, fitsAsTable } from './grid.fill';
import { GridConfig } from './grid-model';
import { DENTAL } from './grid-model.spec';
import { GRID_BUILD, gridSample } from './grid.build';

const grid = (config: GridConfig, extra: Partial<FieldDef> = {}) => f('teeth', 'grid', { label: 'Dental chart', config: config as never, ...extra });
const cell = (el: HTMLElement, id: string) => el.querySelector<HTMLButtonElement>(`[data-cell="${id}"]`)!;
const sheet = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-cell-sheet]');

describe('grid: the legacy layout', () => {
  it('a framed table: Quick fill bar, merged heading band, headings, row labels, a cell per column', async () => {
    const r = await renderKind(GridFill, grid(DENTAL));
    const el = r.el;
    expect(el.querySelector('.fe-gridk__qf')?.textContent).toContain('Quick fill');
    expect(el.querySelector('[data-chip="All sound"]')).toBeTruthy();
    // the column-scope chip is not above the grid
    expect(el.querySelector('.fe-gridk__bar [data-chip="No mobility"]')).toBeNull();
    const band = [...el.querySelectorAll<HTMLElement>('.fe-gridk__band')];
    expect(band.map((b) => b.textContent?.trim())).toEqual(['Findings', '']);
    expect(band[0].style.gridColumn).toBe('2 / span 2');
    expect([...el.querySelectorAll('.fe-gridk__head')].map((h) => h.textContent?.trim())).toEqual(['Status', 'Mobility', 'Note']);
    expect(el.querySelector('.fe-gridk__rowhead')?.textContent?.trim()).toBe('Tooth');
    expect([...el.querySelectorAll('[data-rowlabel]')].map((h) => h.textContent?.trim())).toEqual(['18', '17', '16']);
    expect(el.querySelectorAll('[data-cell]')).toHaveLength(9);
    // legacy column template: label column sized by its labels, data columns share the rest
    expect((el.querySelector('.fe-gridk__table') as HTMLElement).style.gridTemplateColumns).toContain('repeat(3, minmax(0, 1fr))');
    expect(untouchable(el)).toEqual([]);
    expect(unnamed(el)).toEqual([]);
  });

  it('shows the answers in words (choice labels, not keys)', async () => {
    const r = await renderKind(GridFill, grid(DENTAL), { cells: { t18: { status: 'caries', mobility: 'g1' }, t16: { note: 'extracted' } } });
    expect(cell(r.el, 't18/status').textContent?.trim()).toBe('Caries');
    expect(cell(r.el, 't18/mobility').textContent?.trim()).toBe('Grade 1');
    expect(cell(r.el, 't16/note').textContent?.trim()).toBe('extracted');
    expect(cell(r.el, 't18/status').getAttribute('aria-label')).toBe('Tooth 18, Status: Caries');
  });

  it('merged row labels and merged cells keep the table straight', async () => {
    const cfg: GridConfig = {
      columns: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
      ],
      rows: [
        { key: 'r1', label: 'Upper', labelSpan: 2, cells: [{ column: 'a', colSpan: 2 }] },
        { key: 'r2', label: '', cells: [{ column: 'c', fields: [] }] },
      ],
    };
    const r = await renderKind(GridFill, grid(cfg));
    const labels = r.el.querySelectorAll<HTMLElement>('.fe-gridk__labslot');
    expect(labels).toHaveLength(1);
    expect(labels[0].style.gridRow).toBe('2 / span 2');
    const merged = cell(r.el, 'r1/a').parentElement as HTMLElement;
    expect(merged.style.gridColumn).toBe('2 / span 2');
    expect(r.el.querySelector('.fe-gridk__cell--none')).toBeTruthy();
    // a cell in a merged row opens its sheet under the whole merge
    await r.click(cell(r.el, 'r1/a'));
    expect((sheet(r.el)!.closest('.fe-gridk__panelslot') as HTMLElement).style.gridRow).toBe('4');
  });

  it('a phone too narrow for the columns gets one card per row (no sideways scroll)', async () => {
    expect(fitsAsTable(0, 4, 24)).toBe(true);
    expect(fitsAsTable(358, 4, 3)).toBe(true);
    // a phone's dental chart: five columns side by side, like the legacy one
    expect(fitsAsTable(300, 5, 5)).toBe(true);
    expect(fitsAsTable(358, 4, 8)).toBe(false);
    const r = await renderKind(GridFill, grid({ ...DENTAL, columns: [...DENTAL.columns, ...[1, 2, 3, 4, 5].map((n) => ({ key: `x${n}`, label: `X${n}` }))] }));
    r.instance(GridFill).width.set(358);
    await r.stable();
    expect(r.el.querySelector('[data-layout="stacked"]')).toBeTruthy();
    expect(r.el.querySelectorAll('.fe-gridk__card')).toHaveLength(3);
    expect(r.el.querySelector('[data-cell="t17/x3"] .fe-gridk__cellhead')?.textContent).toBe('X3');
    await r.click(cell(r.el, 't17/status'));
    expect(sheet(r.el)).toBeTruthy();
  });
});

describe('grid: the cell sheet', () => {
  afterEach(() => vi.useRealTimers());

  it('tap a cell → its sheet with the choice buttons; one tap answers and moves down the column', async () => {
    vi.useFakeTimers();
    const r = await renderKind(GridFill, grid(DENTAL));
    await r.click(cell(r.el, 't18/status'));
    expect(sheet(r.el)?.textContent).toContain('Tooth 18');
    expect(cell(r.el, 't18/status').getAttribute('aria-expanded')).toBe('true');
    await r.click(r.el.querySelector('[data-cell-sheet] [data-option="caries"]')!);
    expect(r.last()).toEqual({ cells: { t18: { status: 'caries' } } });
    vi.advanceTimersByTime(GRID_ADVANCE_MS + 10);
    await r.stable();
    expect(cell(r.el, 't17/status').getAttribute('aria-expanded')).toBe('true');
    expect(sheet(r.el)?.textContent).toContain('Tooth 17');
    // the bottom of a column goes on to the top of the next one
    await r.click(cell(r.el, 't16/mobility'));
    await r.click(r.el.querySelector('[data-cell-sheet] [data-option="g2"]')!);
    vi.advanceTimersByTime(GRID_ADVANCE_MS + 10);
    await r.stable();
    expect(cell(r.el, 't18/note').getAttribute('aria-expanded')).toBe('true');
  });

  it('previous / next cell and Done', async () => {
    const r = await renderKind(GridFill, grid(DENTAL));
    await r.click(cell(r.el, 't16/status'));
    await r.click('[data-act="next"]');
    expect(cell(r.el, 't18/mobility').getAttribute('aria-expanded')).toBe('true');
    await r.click('[data-act="prev"]');
    expect(cell(r.el, 't16/status').getAttribute('aria-expanded')).toBe('true');
    await r.click('[data-cell-sheet] [data-act="done"]');
    expect(sheet(r.el)).toBeNull();
  });

  it('a text cell: typing writes the words; Quick fill words that fit are offered', async () => {
    const r = await renderKind(GridFill, grid(DENTAL));
    await r.click(cell(r.el, 't17/note'));
    const input = r.el.querySelector<HTMLInputElement>('[data-cell-sheet] input[data-text="note"]')!;
    input.value = 'tender';
    input.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toEqual({ cells: { t17: { note: 'tender' } } });
    expect(r.byText('Sound', '[data-cell-sheet] .fe-gsheet__quick button')).toBeTruthy();
  });

  it('a number cell uses the in-app number pad and stores a number', async () => {
    const cfg: GridConfig = { rowHeader: 'Eye', columns: [{ key: 'iop', label: 'IOP', type: 'number', unit: 'mmHg' }], rows: [{ key: 're', label: 'RE' }] };
    const r = await renderKind(GridFill, grid(cfg));
    await r.click(cell(r.el, 're/iop'));
    for (const k of ['1', '4', '.', '5']) await r.click(r.el.querySelector(`[data-cell-sheet] .fe-pad__key[aria-label="${k === '.' ? 'decimal point' : k}"]`)!);
    expect(r.last()).toEqual({ cells: { re: { iop: 14.5 } } });
    expect(cell(r.el, 're/iop').textContent?.trim()).toBe('14.5 mmHg');
    expect(r.el.querySelector('input[type="number"]')).toBeNull();
  });

  it('a yes / no cell: Yes and No buttons, a No is an answer', async () => {
    const cfg: GridConfig = { columns: [{ key: 'reflex', label: 'Present', type: 'yesno' }], rows: [{ key: 'knee', label: 'Knee' }] };
    const r = await renderKind(GridFill, grid(cfg));
    await r.click(cell(r.el, 'knee/reflex'));
    await r.click(r.byText('No', '[data-cell-sheet] button[role="radio"]'));
    expect(r.last()).toEqual({ cells: { knee: { reflex: false } } });
    expect(cell(r.el, 'knee/reflex').textContent?.trim()).toBe('No');
  });

  it('a cell with several fields shows each one and its sheet asks all of them', async () => {
    const cfg: GridConfig = {
      columns: [{ key: 'v', label: 'Vision' }],
      rows: [{ key: 're', label: 'RE', cells: [{ column: 'v', fields: [{ key: 'dist', label: 'Distance' }, { key: 'near', label: 'Near', type: 'choice', options: [{ key: 'n6', label: 'N6' }] }] }] }],
    };
    const r = await renderKind(GridFill, grid(cfg), { cells: { re: { 'v.near': 'n6' } } });
    expect([...cell(r.el, 're/v').querySelectorAll('.fe-gridk__lk')].map((x) => x.textContent)).toEqual(['Distance', 'Near']);
    expect(cell(r.el, 're/v').textContent).toContain('N6');
    await r.click(cell(r.el, 're/v'));
    expect(r.el.querySelectorAll('[data-cell-sheet] [data-slot]')).toHaveLength(2);
    await r.click(r.el.querySelector('[data-cell-sheet] [data-option="n6"]')!);
    expect(r.last()).toBeUndefined();
  });

  it('"Same for all of" copies a cell down its column or across its row', async () => {
    const r = await renderKind(GridFill, grid(DENTAL), { cells: { t18: { status: 'filled' } } });
    await r.click(cell(r.el, 't18/status'));
    expect(r.el.querySelector('[data-act="fill-row"]')).toBeNull(); // nothing else in the row takes a status
    await r.click('[data-act="fill-column"]');
    expect(r.last()).toEqual({ print: true, cells: { t18: { status: 'filled' }, t17: { status: 'filled' }, t16: { status: 'filled' } } });
  });
});

describe('grid: Quick fill', () => {
  it('a chip above the grid fills every cell it fits; tapping it again takes it back', async () => {
    const r = await renderKind(GridFill, grid(DENTAL));
    await r.click('[data-chip="All sound"]');
    expect(r.last()).toEqual({
      print: true,
      cells: { t18: { status: 'sound', note: 'Sound' }, t17: { status: 'sound', note: 'Sound' }, t16: { status: 'sound', note: 'Sound' } },
    });
    expect(r.el.querySelector('[data-chip="All sound"]')?.getAttribute('aria-pressed')).toBe('true');
    await r.click('[data-chip="All sound"]');
    expect(r.last()).toEqual({ print: true, cells: {} });
  });

  it('a column heading opens the column sheet: its chips and Clear', async () => {
    const dialog = { confirm: vi.fn().mockResolvedValue(true) };
    const r = await renderKind(GridFill, grid(DENTAL), null, { dialog });
    await r.click('button[data-col="mobility"]');
    const line = r.el.querySelector('[data-line-sheet]')!;
    expect(line.getAttribute('data-for')).toBe('column');
    await r.click(line.querySelector('[data-chip="No mobility"]')!);
    expect(r.last()).toEqual({ print: true, cells: { t18: { mobility: 'none' }, t17: { mobility: 'none' }, t16: { mobility: 'none' } } });
    await r.click('[data-act="clear-line"]');
    expect(dialog.confirm).toHaveBeenCalled();
    expect(r.last()).toEqual({ print: true, cells: {} });
  });

  it('a row label opens the row sheet with that row\'s chips', async () => {
    const cfg = { ...DENTAL, quickFill: { enabled: true, presets: [{ label: 'NAD', scope: 'row' as const }] } };
    const r = await renderKind(GridFill, grid(cfg));
    await r.click('button[data-rowlabel="t17"]');
    await r.click(r.el.querySelector('[data-line-sheet] [data-chip="NAD"]')!);
    expect(r.last()).toEqual({ print: true, cells: { t17: { note: 'NAD' } } });
    // the row's chips are in each of its cells' sheets too
    await r.click(cell(r.el, 't17/note'));
    expect(r.el.querySelector('[data-cell-sheet] [data-chip="NAD"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('Quick fill switched off hides the chips', async () => {
    const r = await renderKind(GridFill, grid({ ...DENTAL, quickFill: { enabled: false, presets: DENTAL.quickFill!.presets } }));
    expect(r.el.querySelector('[data-chip]')).toBeNull();
  });
});

describe('grid: include in narrative, locked, shapes', () => {
  it('the include switch writes print false / true', async () => {
    const r = await renderKind(GridFill, grid({ ...DENTAL, includeSwitch: true }), { cells: { t18: { status: 'sound' } } });
    const sw = r.el.querySelector<HTMLButtonElement>('[data-act="print"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.textContent).toContain('Include in Narrative');
    await r.click(sw);
    expect(r.last()).toEqual({ print: false, cells: { t18: { status: 'sound' } } });
    await r.click(sw);
    expect(r.last()).toEqual({ print: true, cells: { t18: { status: 'sound' } } });
  });

  it('a locked grid shows its answers and has nothing to tap', async () => {
    const r = await renderKind(GridFill, grid(DENTAL), { cells: { t18: { status: 'caries' } } });
    await r.setDisabled(true);
    expect(r.el.querySelectorAll('.fe-gridk__table button')).toHaveLength(0);
    expect(r.el.querySelector('[data-cell="t18/status"]')?.textContent?.trim()).toBe('Caries');
  });

  it('the legacy circle: boxes around the centre, numbered', async () => {
    const cfg: GridConfig = {
      columns: ['Upper', 'Right', 'Lower', 'Left'].map((l) => ({ key: l.toLowerCase(), label: l })),
      rows: [{ key: 'row1', label: '' }],
      shape: { layout: 'circle' },
    };
    const r = await renderKind(GridFill, grid(cfg));
    expect(r.el.querySelector('[data-layout="shape"] [data-shape="circle"]')).toBeTruthy();
    const boxes = [...r.el.querySelectorAll<HTMLElement>('.fe-gridk__pos')];
    expect(boxes).toHaveLength(4);
    expect(boxes[0].style.top).toBe('14%');
    await r.click(cell(r.el, 'row1/right'));
    expect(sheet(r.el)).toBeTruthy();
  });
});

describe('grid: the catalogue', () => {
  const entry = (manifest as { kinds: { name: string; examples: { field: FieldDef; answers: Record<string, unknown> }[] }[] }).kinds.find(
    (k) => k.name === 'grid',
  )!;

  it.each(entry.examples.map((e) => [e.field.label, e] as const))('renders the API example "%s" with its answer', async (_n, ex) => {
    const r = await renderKind(GridFill, ex.field, ex.answers[ex.field.key]);
    expect(r.el.querySelectorAll('[data-cell]').length).toBeGreaterThan(0);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('Studio: a new table starts with the API defaults and a sample answer in the API shape', () => {
    const start = (manifest as { kinds: { name: string; defaults: Record<string, unknown> }[] }).kinds.find((k) => k.name === 'grid')!.defaults;
    expect(GRID_BUILD.starterConfig).toEqual(start);
    expect(gridSample(grid(DENTAL))).toEqual({
      print: true,
      cells: { t18: { status: 'sound', mobility: 'none', note: 'Normal' }, t17: { status: 'sound', mobility: 'none', note: 'Normal' }, t16: { status: 'sound', mobility: 'none', note: 'Normal' } },
    });
  });
});
