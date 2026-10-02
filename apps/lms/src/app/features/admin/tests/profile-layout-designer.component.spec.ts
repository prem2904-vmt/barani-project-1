import { TestBed } from '@angular/core/testing';
import { ProfileLayoutDesignerComponent } from './profile-layout-designer.component';
import type { ReportColumn, ReportSection } from '../../../shared/models/report-layout.model';
import { readPageLayout } from '../../../shared/utils/report-profile-layout';

const COLUMNS: ReportColumn[] = [
  { id: 'c-name', name: 'name', label: 'Investigation', order: 1, width: 34, type: 'name', locked: false } as ReportColumn,
  { id: 'c-result', name: 'result', label: 'Result', order: 2, width: 16, type: 'result', locked: false } as ReportColumn,
  { id: 'c-unit', name: 'unit', label: 'Unit', order: 3, width: 10, type: 'unit', locked: false } as ReportColumn,
  { id: 'c-range', name: 'range', label: 'Reference range', order: 4, width: 24, type: 'range', locked: false } as ReportColumn,
  { id: 'c-method', name: 'method', label: 'Methodology', order: 5, width: 16, type: 'method', locked: false } as ReportColumn,
];

function make(sections: ReportSection[] = []) {
  TestBed.configureTestingModule({ imports: [ProfileLayoutDesignerComponent] });
  const f = TestBed.createComponent(ProfileLayoutDesignerComponent);
  f.componentRef.setInput('sections', sections);
  f.componentRef.setInput('resolvedColumns', COLUMNS);
  f.detectChanges();
  return f;
}

describe('ProfileLayoutDesignerComponent', () => {
  it('a profile with no saved layout starts from a plain table + signatures (not CBC-shaped)', () => {
    const f = make([]);
    const c = f.componentInstance;
    expect(c.boxes().some(b => b.kind === 'table')).toBe(true);
    expect(c.boxes().some(b => b.kind === 'signatures')).toBe(true);
    expect(c.boxes().some(b => b.kind === 'analyzer')).toBe(false);
    expect(c.enabled()).toBe(false);
  });

  it('turning the toggle on emits an updated sections array with enabled: true', () => {
    const f = make([]);
    const c = f.componentInstance;
    const emitted: ReportSection[][] = [];
    c.sectionsChange.subscribe(s => emitted.push(s));
    c.setEnabled(true);
    expect(emitted).toHaveLength(1);
    expect(readPageLayout(emitted[0])?.enabled).toBe(true);
  });

  it('reads an existing page_layout section back into editable boxes', () => {
    const existing: ReportSection[] = [{
      id: 'page-layout', type: 'page_layout', order: 1, v: 1, enabled: true,
      boxes: [
        { id: 'table', kind: 'table', x: 0, y: 0, w: 100, h: 150 },
        { id: 'analyzer-12003', kind: 'analyzer', ref: '12003', label: 'WBC histogram', x: 110, y: 0, w: 50, h: 40 },
      ],
    } as unknown as ReportSection];
    const f = make(existing);
    const c = f.componentInstance;
    expect(c.enabled()).toBe(true);
    expect(c.boxes()).toHaveLength(2);
    expect(c.boxes().find(b => b.id === 'analyzer-12003')?.label).toBe('WBC histogram');
  });

  it('selecting a box and nudging it moves it and emits', () => {
    const f = make([]);
    const c = f.componentInstance;
    // A freshly added analyzer box sits at mm (0,0) — away from the page's
    // vertical guides (left margin / centre / right margin only constrain
    // the X axis), so a vertical nudge is unambiguous and guide-free.
    c.addAnalyzer('12003');
    c.select('analyzer-12003');
    const before = c.selectedBox()!.y;
    const emitted: ReportSection[][] = [];
    c.sectionsChange.subscribe(s => emitted.push(s));
    c.onKey({ key: 'ArrowDown', shiftKey: false, preventDefault: () => {} } as unknown as KeyboardEvent);
    expect(c.selectedBox()!.y).toBeGreaterThan(before);
    expect(emitted).toHaveLength(1);
  });

  it('Escape clears the selection', () => {
    const f = make([]);
    const c = f.componentInstance;
    c.select(c.boxes()[0].id);
    c.onKey({ key: 'Escape' } as KeyboardEvent);
    expect(c.selected()).toBeNull();
  });

  it('adding an analyzer slot from the palette appends a box and emits', () => {
    const f = make([]);
    const c = f.componentInstance;
    const emitted: ReportSection[][] = [];
    c.sectionsChange.subscribe(s => emitted.push(s));
    c.addAnalyzer('12003');
    expect(c.boxes().some(b => b.id === 'analyzer-12003')).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it('removing a non-table/signatures box drops it', () => {
    const f = make([]);
    const c = f.componentInstance;
    c.addAnalyzer('12053');
    c.remove('analyzer-12053');
    expect(c.boxes().some(b => b.id === 'analyzer-12053')).toBe(false);
  });

  it('toggling off a column (Methodology) persists through the emitted sections', () => {
    const existing: ReportSection[] = [{
      id: 'page-layout', type: 'page_layout', order: 1, v: 1, enabled: true,
      boxes: [{ id: 'table', kind: 'table', x: 0, y: 0, w: 100, h: 150, columns: [
        { name: 'name', visible: true }, { name: 'method', visible: true },
      ] }],
    } as unknown as ReportSection];
    const f = make(existing);
    const c = f.componentInstance;
    c.select('table');
    c.toggleColumn('method', false);
    const read = readPageLayout(c.boxes().length ? [{ id: 'x', type: 'page_layout', order: 1, v: 1, enabled: true, boxes: c.boxes() } as unknown as ReportSection] : []);
    expect(read?.boxes.find(b => b.id === 'table')?.columns?.find(x => x.name === 'method')?.visible).toBe(false);
  });

  it('"Restore to default" only shows when the host says a default exists, and just emits an event', () => {
    const f = make([]);
    f.componentRef.setInput('hasDefault', true);
    f.detectChanges();
    const c = f.componentInstance;
    let fired = false;
    c.restoreDefault.subscribe(() => { fired = true; });
    const btn = Array.from(f.nativeElement.querySelectorAll('button')).find((b): b is HTMLButtonElement =>
      (b as HTMLButtonElement).textContent?.includes('Restore to default') ?? false);
    expect(btn).toBeTruthy();
    btn!.click();
    expect(fired).toBe(true);
  });
});
