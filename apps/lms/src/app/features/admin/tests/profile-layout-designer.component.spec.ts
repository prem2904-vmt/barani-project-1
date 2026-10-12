import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { ProfileLayoutDesignerComponent } from './profile-layout-designer.component';
import type { PageLayoutBox, ReportColumn, ReportSection } from '../../../shared/models/report-layout.model';
import { readPageLayout } from '../../../shared/utils/report-profile-layout';
import { layoutSignatureBlock } from '../../../shared/utils/report-signatures';
import { ptToMm } from '../../../shared/utils/report-header-layout';
import type { PreviewProfileMember } from '../../../shared/utils/report-sample-preview';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ReportLayoutService, type ProfileAnalyzerImages } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';

const COLUMNS: ReportColumn[] = [
  { id: 'c-name', name: 'name', label: 'Investigation', order: 1, width: 34, type: 'name', locked: false } as ReportColumn,
  { id: 'c-result', name: 'result', label: 'Result', order: 2, width: 16, type: 'result', locked: false } as ReportColumn,
  { id: 'c-unit', name: 'unit', label: 'Unit', order: 3, width: 10, type: 'unit', locked: false } as ReportColumn,
  { id: 'c-range', name: 'range', label: 'Reference range', order: 4, width: 24, type: 'range', locked: false } as ReportColumn,
  { id: 'c-method', name: 'method', label: 'Methodology', order: 5, width: 16, type: 'method', locked: false } as ReportColumn,
];

const member = (id: string, key: string, name: string): PreviewProfileMember => ({
  id, name, catalogKey: key, department: 'Haematology',
  parameters: JSON.stringify({ parameters: [{ name, referenceRanges: [{ min: 1, max: 3 }] }] }),
});
const CBC_MEMBERS = [member('m1', 'HEM011', 'Haemoglobin'), member('m2', 'HEM019', 'Total Leukocyte Count'), member('m3', 'HEM030', 'Platelet Count')];

interface Opts {
  sections?: ReportSection[]; name?: string; members?: PreviewProfileMember[];
  departmentId?: string; signoff?: { department: string | null; signatures: Array<{ name?: string; title?: string; regNo?: string; signatureUrl?: string }> } | null;
  images?: ProfileAnalyzerImages; restore?: { sections: ReportSection[] } | null; confirm?: boolean;
}

/** The template request never answers (NEVER) — no PDF render in these
 *  tests: they pin the box model + interactions, not pixels (the render
 *  pipeline is covered by report-sample-preview.spec / report-pdf specs). */
function make(o: Opts = {}) {
  const layoutSvc = {
    analyzerImages: vi.fn(async () => o.images ?? { linked: false, instruments: [], images: [] }),
    restorePageLayoutDefault: vi.fn(async () => o.restore ?? null),
    signoffPreview: vi.fn(async () => o.signoff ?? null),
    preview: vi.fn(),
  };
  const toasts = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
  const dialog = { confirm: vi.fn(async () => o.confirm ?? true) };
  TestBed.configureTestingModule({
    imports: [ProfileLayoutDesignerComponent],
    providers: [
      { provide: ApiService, useValue: { get: () => NEVER } },
      { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      { provide: ReportLayoutService, useValue: layoutSvc },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
    ],
  });
  const f = TestBed.createComponent(ProfileLayoutDesignerComponent);
  f.componentRef.setInput('sections', o.sections ?? []);
  f.componentRef.setInput('resolvedColumns', COLUMNS);
  f.componentRef.setInput('profileTestId', 'pkg-1');
  f.componentRef.setInput('profileName', o.name ?? 'Liver panel');
  f.componentRef.setInput('members', o.members ?? []);
  if (o.departmentId) f.componentRef.setInput('departmentId', o.departmentId);
  f.detectChanges();
  const emitted: ReportSection[][] = [];
  f.componentInstance.sectionsChange.subscribe(s => emitted.push(s));
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, emitted, layoutSvc, toasts, dialog };
}

const flush = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  await Promise.resolve(); await Promise.resolve();
  f.detectChanges(); await f.whenStable(); f.detectChanges();
};
const saved = (boxes: PageLayoutBox[], enabled = true): ReportSection[] => [
  { id: 'page-layout', type: 'page_layout', order: 1, v: 1, enabled, boxes } as unknown as ReportSection,
];
const lastBoxes = (emitted: ReportSection[][]) => readPageLayout(emitted[emitted.length - 1])!.boxes;

/** Minimal pointer event for the handlers (jsdom has no PointerEvent ctor). */
function ptr(target: HTMLElement, x: number, y: number) {
  return { button: 0, clientX: x, clientY: y, pointerId: 1, altKey: false, currentTarget: target, target,
    stopPropagation() {}, preventDefault() {} } as unknown as PointerEvent;
}
function fire(target: HTMLElement, type: string, x: number, y: number) {
  const e = new Event(type) as Event & { clientX: number; clientY: number; altKey: boolean };
  e.clientX = x; e.clientY = y; e.altKey = false;
  target.dispatchEvent(e);
}

describe('ProfileLayoutDesignerComponent — starts from a sensible default', () => {
  it('no saved layout, ANY profile: results table + signatures, off until switched on', () => {
    const { c } = make();
    expect(c.boxes().map(b => b.kind)).toEqual(['table', 'signatures']);
    expect(c.enabled()).toBe(false);
  });

  it('a CBC-family profile with nothing linked yet: the 4 M51 graphs are placed beside the table', async () => {
    const { f, c } = make({ name: 'CBC Basic', members: CBC_MEMBERS });
    await flush(f);
    expect(c.boxes().filter(b => b.kind === 'analyzer').map(b => b.ref)).toEqual(['12003', '12053', '12103', '12153']);
  });

  it('a LINKED instrument: every image type it sent is in the palette (with thumbnails) and in the default', async () => {
    const { f, c, el } = make({
      name: 'Blood panel', members: CBC_MEMBERS,
      images: { linked: true, instruments: [{ id: 'i1', name: 'Arun CBC', model: 'Medonic M51' }], images: [
        { code: '12003', label: 'WBC', seen: 4 }, { code: '12153', label: 'DIFF', seen: 4 }, { code: '13001', label: 'BASO scattergram', seen: 1 },
      ] },
    });
    await flush(f);
    expect(c.paletteImages().map(i => i.code)).toEqual(['12003', '12153', '13001']);
    expect(c.paletteImages()[0].label).toBe('WBC histogram');      // known code → lab label
    expect(c.paletteImages()[2].label).toBe('BASO scattergram');   // unknown → what the analyzer called it
    expect(c.imageSourceNote()).toContain('Arun CBC (Medonic M51)');
    const thumbs = Array.from(el.querySelectorAll<HTMLImageElement>('.pld-img img')).map(i => i.getAttribute('src'));
    expect(thumbs).toEqual(['assets/analyzer-samples/m51-12003.png', 'assets/analyzer-samples/m51-12153.png', 'assets/analyzer-samples/generic.png']);
    expect(c.boxes().filter(b => b.kind === 'analyzer').map(b => b.ref)).toEqual(['12003', '12153', '13001']);
  });

  it('reads a saved layout back as-is (never replaced by the default)', () => {
    const { c } = make({ sections: saved([{ id: 'table', kind: 'table', x: 0, y: 0, w: 100, h: 150 }]) });
    expect(c.enabled()).toBe(true);
    expect(c.boxes()).toEqual([{ id: 'table', kind: 'table', x: 0, y: 0, w: 100, h: 150 }]);
  });

  it('the Live preview gets the arrangement being designed even while the layout is off', () => {
    const { c } = make();
    const live: Array<{ enabled: boolean }> = [];
    c.liveChange.subscribe(v => live.push(v));
    c.add('notes');
    expect(live[live.length - 1].enabled).toBe(true);
    expect(c.enabled()).toBe(false);
  });

  it('switching it on saves the default arrangement with enabled: true', () => {
    const { c, emitted } = make();
    c.setEnabled(true);
    const pl = readPageLayout(emitted[0])!;
    expect(pl.enabled).toBe(true);
    expect(pl.boxes.map(b => b.kind)).toEqual(['table', 'signatures']);
  });
});

describe('ProfileLayoutDesignerComponent — the REAL sign-off', () => {
  it('the signatures box is sized to the department\'s real sign-off block — the SAME geometry the report draws', async () => {
    const signatures = [
      { name: 'Ms. Priya Natarajan', title: 'Lab Technologist', regNo: 'TN-1' },
      { name: 'Dr. Rajesh Iyer', title: 'Consultant Pathologist', regNo: 'TN-2' },
      { name: 'Dr. Anita K', title: 'Microbiologist', regNo: 'TN-3' },
    ];
    const { f, c, layoutSvc } = make({ departmentId: 'dept-h', signoff: { department: 'Haematology', signatures } });
    await flush(f);
    expect(layoutSvc.signoffPreview).toHaveBeenCalledWith('dept-h');
    const sig = c.boxes().find(b => b.kind === 'signatures')!;
    const real = layoutSignatureBlock(signatures, 0, c.body().w, 0).height;   // what drawInlineSignatures lays out
    expect(sig.h).toBeCloseTo(Math.round(ptToMm(real) * 10) / 10 + 1, 1);
  });
});

describe('ProfileLayoutDesignerComponent — real box editing', () => {
  const two = (): PageLayoutBox[] => [
    { id: 'table', kind: 'table', x: 0, y: 0, w: 100, h: 80 },
    { id: 'note', kind: 'notes', text: 'Hi', x: 120, y: 100, w: 40, h: 20 },
  ];

  it('every box renders with an outline; the selected one gets 8 resize handles', () => {
    const { f, c, el } = make({ sections: saved(two()) });
    expect(el.querySelectorAll('.pld-box').length).toBe(2);
    c.select('note'); f.detectChanges();
    expect(el.querySelectorAll('.pld-box--sel .pld-handle').length).toBe(8);
  });

  it('press-and-drag moves a box on the FIRST press (select + drag), saves once on release', () => {
    const { f, c, emitted } = make({ sections: saved(two()) });
    const boxEl = f.nativeElement.querySelectorAll('.pld-box')[1] as HTMLElement;
    const k = c.mmPx();
    c.onBoxPointerDown(ptr(boxEl, 100, 100), c.boxes()[1]);
    expect(c.selected()).toBe('note');
    fire(boxEl, 'pointermove', 100 + 10 * k, 100 + 5 * k);
    expect(c.drag()?.id).toBe('note');
    expect(emitted).toHaveLength(0); // nothing saved mid-drag
    fire(boxEl, 'pointerup', 100 + 10 * k, 100 + 5 * k);
    expect(c.drag()).toBeNull();
    expect(emitted).toHaveLength(1);
    const note = lastBoxes(emitted).find(b => b.id === 'note')!;
    expect(note.x).toBeCloseTo(130, 0);
    expect(note.y).toBeCloseTo(105, 0);
  });

  it('a press without movement only selects (no save)', () => {
    const { f, c, emitted } = make({ sections: saved(two()) });
    const boxEl = f.nativeElement.querySelectorAll('.pld-box')[1] as HTMLElement;
    c.onBoxPointerDown(ptr(boxEl, 50, 50), c.boxes()[1]);
    fire(boxEl, 'pointerup', 51, 50);
    expect(c.selected()).toBe('note');
    expect(emitted).toHaveLength(0);
  });

  it('dragging the south-east handle resizes', () => {
    const { f, c, emitted } = make({ sections: saved(two()) });
    c.select('note'); f.detectChanges();
    const handle = f.nativeElement.querySelector('.pld-handle--se') as HTMLElement;
    const k = c.mmPx();
    c.onHandlePointerDown(ptr(handle, 0, 0), c.boxes()[1], 'se');
    fire(handle, 'pointermove', 15 * k, 7 * k);
    fire(handle, 'pointerup', 15 * k, 7 * k);
    const note = lastBoxes(emitted).find(b => b.id === 'note')!;
    expect(note.w).toBeCloseTo(55, 0);
    expect(note.h).toBeCloseTo(27, 0);
  });

  it('arrow keys nudge by the step, Shift by 5 mm; Escape clears the selection', () => {
    const { c, emitted } = make({ sections: saved(two()) });
    c.select('note');
    c.onKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(lastBoxes(emitted).find(b => b.id === 'note')!.x).toBe(121);
    c.onKey(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
    expect(lastBoxes(emitted).find(b => b.id === 'note')!.y).toBe(105);
    c.onKey(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(c.selected()).toBeNull();
  });

  it('exact mm fields move / size the selected box', () => {
    const { c, emitted } = make({ sections: saved(two()) });
    c.select('note');
    c.setGeom('x', '20'); c.setGeom('w', '60');
    const note = lastBoxes(emitted).find(b => b.id === 'note')!;
    expect(note.x).toBe(20);
    expect(note.w).toBe(60);
  });

  it('Delete removes a box; the results table can be neither removed nor hidden', () => {
    const { c, emitted } = make({ sections: saved(two()) });
    c.select('table');
    c.onKey(new KeyboardEvent('keydown', { key: 'Delete' }));
    c.toggleHidden(c.boxes()[0]);
    expect(emitted).toHaveLength(0);
    c.select('note');
    c.onKey(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(lastBoxes(emitted).map(b => b.id)).toEqual(['table']);
    expect(c.selected()).toBeNull();
  });

  it('Hide keeps the box in the layout, marked hidden', () => {
    const { c, emitted } = make({ sections: saved(two()) });
    c.toggleHidden(c.boxes()[1]);
    expect(lastBoxes(emitted).find(b => b.id === 'note')!.hidden).toBe(true);
  });

  it('undo / redo walk the edit history', () => {
    const { c } = make({ sections: saved(two()) });
    c.select('note');
    c.nudge(5, 0);
    expect(c.boxes()[1].x).toBe(125);
    c.undo();
    expect(c.boxes()[1].x).toBe(120);
    c.redo();
    expect(c.boxes()[1].x).toBe(125);
  });

  it('table settings: column switches (type comes from the report theme, not the designer)', () => {
    const { c, emitted } = make({ sections: saved(two()) });
    c.select('table');
    c.toggleColumn('method', false);
    const t = lastBoxes(emitted).find(b => b.id === 'table')!;
    expect(t.columns?.find(col => col.name === 'method')?.visible).toBe(false);
  });
});

describe('ProfileLayoutDesignerComponent — Custom layout pages', () => {
  const tbl = (id: string, rows?: string[]): PageLayoutBox => ({ id, kind: 'table', x: 0, y: 0, w: 100, h: 80, ...(rows ? { rows } : {}) });
  const pagesOf = (emitted: ReportSection[][]) => readPageLayout(emitted[emitted.length - 1])!.pages!;

  it('a saved single-page layout opens as Page 1 and saves back as v2 pages', () => {
    const { c, emitted } = make({ sections: saved([tbl('table')]) });
    expect(c.pages().length).toBe(1);
    c.setEnabled(true);
    const raw = emitted[0].find(x => x.type === 'page_layout') as unknown as Record<string, unknown>;
    expect(raw['v']).toBe(2);
    expect((raw['pages'] as unknown[]).length).toBe(1);
  });

  it('Add page / move / Delete page: each one undoable; deleting the page with the ONLY table moves the table back', async () => {
    const { f, c, el, dialog } = make({ sections: saved([tbl('table')]) });
    f.detectChanges();
    const delBtn = () => el.querySelector('.pld-delpage') as HTMLButtonElement;
    expect(delBtn().textContent).toContain('Delete page');
    expect(delBtn().disabled).toBe(true);                  // the last remaining page
    c.addPage(); f.detectChanges();
    expect(c.pages().length).toBe(2);
    expect(c.activePage()).toBe(1);
    expect(el.querySelectorAll('.pld-pagetab').length).toBe(2);
    expect(delBtn().disabled).toBe(false);
    c.add('notes');
    c.movePage(-1);
    expect(c.pages()[0].boxes[0].kind).toBe('notes');      // the notes page moved first
    c.goPage(1);
    delBtn().click(); await f.whenStable();                // page 2 holds the only table
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete page 2?' }));
    expect(c.pages().length).toBe(1);
    expect(c.pages()[0].boxes.map(b => b.kind)).toEqual(['notes', 'table']);   // the table moved back
    c.undo();
    expect(c.pages().length).toBe(2);
  });

  it('Delete page: cancelling the confirm keeps the page; an empty page also asks', async () => {
    const { c, dialog } = make({ sections: saved([tbl('table')]), confirm: false });
    c.addPage();
    await c.removePage();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(c.pages().length).toBe(2);
  });

  it('Delete page in AUTO mode: the continued box goes, its rows reflow into the remaining table box', async () => {
    const { c } = make({ sections: saved([tbl('table')]), members: CBC_MEMBERS });
    c.addPage(); c.addTableBox();
    expect(c.pages()[1].boxes.some(b => b.kind === 'table')).toBe(true);
    await c.removePage();
    expect(c.pages().length).toBe(1);
    expect(c.pages()[0].boxes.filter(b => b.kind === 'table').length).toBe(1);
    expect(c.rowIssues().filter(i => i.kind === 'missing')).toEqual([]);
  });

  it('Delete page in MANUAL mode: that box\'s rows become unplaced, with the warning', async () => {
    const { c } = make({ sections: saved([tbl('table')]), members: CBC_MEMBERS });
    c.addPage(); c.addTableBox();
    const second = c.boxes()[0].id;
    c.changeTableMode('manual');
    c.toggleRow('Platelet Count', second);
    await c.removePage();
    const missing = c.rowIssues().find(i => i.kind === 'missing');
    expect(missing?.rows).toEqual(['Platelet Count']);
  });

  it('table box rows: Top / Fill / Center and Compact / Normal / Relaxed are saved on the box, undoable', () => {
    const { f, c, el, emitted } = make({ sections: saved([tbl('table')]) });
    c.select('table'); f.detectChanges();
    const segs = [...el.querySelectorAll('[aria-label="Rows in this box"] .pf-seg__item')].map(e => e.textContent!.trim());
    expect(segs).toEqual(['Top', 'Fill', 'Center']);
    expect([...el.querySelectorAll('[aria-label="Row spacing"] .pf-seg__item')].map(e => e.textContent!.trim())).toEqual(['Compact', 'Normal', 'Relaxed']);
    c.setVAlign('fill'); c.setRowSpacing('relaxed');
    let box = pagesOf(emitted)[0].boxes[0];
    expect([box.vAlign, box.rowSpacing]).toEqual(['fill', 'relaxed']);
    c.setVAlign('top'); c.setRowSpacing('normal');
    box = pagesOf(emitted)[0].boxes[0];
    expect([box.vAlign ?? null, box.rowSpacing ?? null]).toEqual([null, null]);
    c.undo();
    expect(pagesOf(emitted)[0].boxes[0].rowSpacing).toBe('relaxed');
  });

  it('the palette text renders as text (no raw template braces)', async () => {
    const { f, el } = make({ sections: saved([tbl('table')]) });
    f.detectChanges(); await f.whenStable(); f.detectChanges();
    expect(el.textContent).not.toContain('{{');
    expect(el.textContent).not.toContain('tableMode()');
  });

  it('AUTO mode: "Table (continued)" adds another table box on the current page', () => {
    const { c, emitted } = make({ sections: saved([tbl('table')]) });
    c.addPage();
    c.addTableBox();
    const p2 = pagesOf(emitted)[1].boxes;
    expect(p2[0].kind).toBe('table');
    expect(p2[0].id).not.toBe('table');
    expect(p2[0].label).toContain('continued');
  });

  it('MANUAL mode: every row starts in the first box; a row moved to the page-2 box leaves page 1; missing rows are listed', () => {
    const { c, emitted } = make({ sections: saved([tbl('table')]), members: CBC_MEMBERS });
    c.addPage(); c.addTableBox();
    const second = c.boxes()[0].id;
    c.changeTableMode('manual');
    let pg = pagesOf(emitted);
    expect(pg[0].boxes[0].rows).toEqual(['Haemoglobin', 'Total Leukocyte Count', 'Platelet Count']);
    c.toggleRow('Platelet Count', second);
    pg = pagesOf(emitted);
    expect(pg[0].boxes[0].rows).toEqual(['Haemoglobin', 'Total Leukocyte Count']);
    expect(pg[1].boxes[0].rows).toEqual(['Platelet Count']);
    c.toggleRow('Platelet Count', second);                 // off → placed nowhere
    expect(c.rowIssues()[0].kind).toBe('missing');
    expect(c.rowHome('Platelet Count', second)).toBe('Not placed yet');
  });

  it('dragging a row onto a table box (or a page tab) assigns it there', () => {
    const { c, emitted } = make({ sections: saved([tbl('table')]), members: CBC_MEMBERS });
    c.addPage(); c.addTableBox(); c.changeTableMode('manual');
    const second = c.boxes()[0];
    const dt = { data: {} as Record<string, string>, types: ['text/x-pf-row'], setData(k: string, v: string) { this.data[k] = v; }, getData(k: string) { return this.data[k]; } };
    c.onRowDragStart({ dataTransfer: dt } as unknown as DragEvent, 'Haemoglobin');
    c.onRowDropOnBox({ dataTransfer: dt, preventDefault() {} } as unknown as DragEvent, second);
    expect(pagesOf(emitted)[1].boxes[0].rows).toEqual(['Haemoglobin']);
    c.onRowDropOnPage({ dataTransfer: dt, preventDefault() {} } as unknown as DragEvent, 0);
    expect(pagesOf(emitted)[0].boxes[0].rows).toContain('Haemoglobin');
  });

  it('a graph already on another page is not added twice — the designer opens that page instead', () => {
    const { c } = make({ sections: saved([tbl('table'), { id: 'analyzer-12003', kind: 'analyzer', ref: '12003', x: 110, y: 0, w: 40, h: 30 }]) });
    c.addPage();
    c.addAnalyzer('12003', 'WBC histogram');
    expect(c.activePage()).toBe(0);
    expect(c.selected()).toBe('analyzer-12003');
    expect(c.pages()[1].boxes).toEqual([]);
  });

  it('the signatures box explains when it prints (department\'s last test)', () => {
    const { f, c, el } = make({ sections: saved([tbl('table'), { id: 'signatures', kind: 'signatures', x: 0, y: 100, w: 188, h: 24 }]) });
    c.select('signatures'); f.detectChanges();
    expect(el.textContent).toContain("department's LAST test");
  });
});

describe('ProfileLayoutDesignerComponent — palette', () => {
  it('adds a graph, a text box and a manual-code graph, each selected and in free space', () => {
    const { c, emitted } = make();
    c.addAnalyzer('12103', 'PLT histogram');
    expect(c.selected()).toBe('analyzer-12103');
    c.add('notes');
    c.manualCode.set('12999'); c.addManual();
    const boxes = lastBoxes(emitted);
    expect(boxes.find(b => b.ref === '12103')?.label).toBe('PLT histogram');
    expect(boxes.some(b => b.kind === 'notes')).toBe(true);
    expect(boxes.find(b => b.ref === '12999')?.label).toBe('Analyzer image 12999');
    expect(c.pageIssues().filter(i => i.kind === 'overlap')).toEqual([]);
  });

  it('"New chart" adds a chart BLOCK to the sections and its box, in one save', () => {
    const { c, emitted } = make();
    c.createChart();
    const secs = emitted[0];
    const chart = secs.find(s => s.type === 'chart')!;
    expect(chart).toBeTruthy();
    expect(readPageLayout(secs)!.boxes.find(b => b.kind === 'chart')?.ref).toBe(chart.id);
  });

  it('an existing chart block is offered and placed by reference', () => {
    const secs: ReportSection[] = [{ id: 'sec-c1', type: 'chart', order: 1, label: 'Trend', trend: { v: 1 } } as unknown as ReportSection];
    const { c, emitted } = make({ sections: secs });
    expect(c.chartBlocks()).toEqual([{ id: 'sec-c1', label: 'Trend', onPage: true }]); // the default places it
    c.addChart('sec-c1', 'Trend');
    expect(lastBoxes(emitted).filter(b => b.kind === 'chart')).toHaveLength(1); // never a duplicate
  });
});

describe('ProfileLayoutDesignerComponent — Restore to default', () => {
  it('server has a master default → those boxes', async () => {
    const restore = { sections: saved([{ id: 'table', kind: 'table', x: 0, y: 0, w: 99, h: 99 }]) };
    const { c, emitted } = make({ restore });
    await c.restoreDefault();
    expect(lastBoxes(emitted)).toEqual([{ id: 'table', kind: 'table', x: 0, y: 0, w: 99, h: 99 }]);
  });

  it('no master default (e.g. a dev catalogue, any non-CBC profile) → the built default, never "nothing happens"', async () => {
    const { f, c, emitted, toasts } = make({ name: 'CBC Basic', members: CBC_MEMBERS, sections: saved([{ id: 'table', kind: 'table', x: 5, y: 5, w: 50, h: 50 }]) });
    await flush(f);
    await c.restoreDefault();
    const boxes = lastBoxes(emitted);
    expect(boxes.filter(b => b.kind === 'analyzer')).toHaveLength(4);
    expect(boxes.some(b => b.kind === 'signatures')).toBe(true);
    expect(toasts.success).toHaveBeenCalled();
  });

  it('asks first; Cancel changes nothing', async () => {
    const { c, emitted } = make({ confirm: false });
    await c.restoreDefault();
    expect(emitted).toHaveLength(0);
  });
});

describe('ProfileLayoutDesignerComponent — kit rules', () => {
  it('no native select / datalist, no emoji; icons are SVG; no primary (gradient) button', () => {
    const { f, c, el } = make({ sections: saved([{ id: 'a', kind: 'analyzer', ref: '12003', x: 120, y: 0, w: 30, h: 30 }, { id: 'table', kind: 'table', x: 0, y: 0, w: 100, h: 80 }]) });
    c.select('a'); f.detectChanges();
    expect(el.querySelector('select, datalist')).toBeNull();
    expect(el.querySelector('.pf-btn--primary')).toBeNull();
    expect(el.querySelectorAll('svg').length).toBeGreaterThan(3);
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(el.textContent ?? '')).toBe(false);
  });
});
