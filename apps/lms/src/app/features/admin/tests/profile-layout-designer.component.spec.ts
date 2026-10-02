import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ProfileLayoutDesignerComponent } from './profile-layout-designer.component';
import type { ReportColumn, ReportSection } from '../../../shared/models/report-layout.model';
import { KNOWN_ANALYZER_IMAGES, readPageLayout } from '../../../shared/utils/report-profile-layout';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';

const COLUMNS: ReportColumn[] = [
  { id: 'c-name', name: 'name', label: 'Investigation', order: 1, width: 34, type: 'name', locked: false } as ReportColumn,
  { id: 'c-result', name: 'result', label: 'Result', order: 2, width: 16, type: 'result', locked: false } as ReportColumn,
  { id: 'c-unit', name: 'unit', label: 'Unit', order: 3, width: 10, type: 'unit', locked: false } as ReportColumn,
  { id: 'c-range', name: 'range', label: 'Reference range', order: 4, width: 24, type: 'range', locked: false } as ReportColumn,
  { id: 'c-method', name: 'method', label: 'Methodology', order: 5, width: 16, type: 'method', locked: false } as ReportColumn,
];

/** No real template configured — the designer falls back to the plain
 *  greyed frame (its own [pdf.js render]-failure path), which is exactly
 *  what every test below needs: the box geometry/behaviour, not pixels. */
function make(sections: ReportSection[] = []) {
  TestBed.configureTestingModule({
    imports: [ProfileLayoutDesignerComponent],
    providers: [
      { provide: ApiService, useValue: { get: () => of(null) } },
      { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
    ],
  });
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

  // ── Real header/footer (owner: "show the REAL header/footer, read-only,
  // greyed — the same page that prints") ─────────────────────────────────
  it('fetches the tenant report template once, to render the real letterhead/footer', () => {
    const get = vi.fn(() => of(null));
    TestBed.configureTestingModule({
      imports: [ProfileLayoutDesignerComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      ],
    });
    const f = TestBed.createComponent(ProfileLayoutDesignerComponent);
    f.componentRef.setInput('sections', []);
    f.detectChanges();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/config/report-template');
  });

  it('before the template arrives, the body geometry is the classic-template fallback (never NaN/zero)', () => {
    const f = make([]);
    const c = f.componentInstance;
    expect(c.bodyTopPx()).toBeGreaterThan(0);
    expect(c.bodyBottomPx()).toBeGreaterThan(c.bodyTopPx());
    expect(c.canvasReady()).toBe(false);
  });

  it('a template fetch error never throws — the designer still works with the fallback frame', () => {
    const get = vi.fn(() => throwError(() => new Error('network')));
    TestBed.configureTestingModule({
      imports: [ProfileLayoutDesignerComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      ],
    });
    const f = TestBed.createComponent(ProfileLayoutDesignerComponent);
    f.componentRef.setInput('sections', []);
    expect(() => f.detectChanges()).not.toThrow();
    expect(f.componentInstance.bodyTopPx()).toBeGreaterThan(0);
  });

  it('once the template resolves, body geometry comes from the REAL resolved layout (computeReportPageLayout), not the hardcoded fallback', () => {
    const get = vi.fn(() => of(null)); // null = "no custom template" — still a REAL resolved classic layout
    TestBed.configureTestingModule({
      imports: [ProfileLayoutDesignerComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      ],
    });
    const f = TestBed.createComponent(ProfileLayoutDesignerComponent);
    f.componentRef.setInput('sections', []);
    f.detectChanges();
    const c = f.componentInstance;
    // realLayout() is only non-null once the (resolved, even if null) template
    // has arrived — proving the fallback constant is no longer what's driving it.
    expect(c.realLayout()).not.toBeNull();
    expect(c.bodyTopPx()).toBeCloseTo(c.realLayout()!.bodyTop * (480 / 595.28), 1);
  });

  // ── Analyzer palette: codes actually SEEN, M51 as fallback ──────────────
  it('offers the codes actually attached to recent results, once the profile id resolves them', async () => {
    const get = vi.fn((url: string) =>
      url.includes('/analyzer-codes') ? of({ testId: 'p1', codes: ['12003', '99999'] }) : of(null));
    TestBed.configureTestingModule({
      imports: [ProfileLayoutDesignerComponent],
      providers: [
        { provide: ApiService, useValue: { get } },
        { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      ],
    });
    const f = TestBed.createComponent(ProfileLayoutDesignerComponent);
    f.componentRef.setInput('sections', []);
    f.componentRef.setInput('profileTestId', 'p1');
    f.detectChanges();
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); // firstValueFrom() + the service's + the effect's .then()
    f.detectChanges();
    expect(get).toHaveBeenCalledWith('/api/report-layout/test/p1/analyzer-codes');
    expect(f.componentInstance.effectiveAnalyzerCodes()).toEqual(['12003', '99999']);
  });

  it('nothing seen yet (or no profile id): falls back to the known M51 suggestions', () => {
    const f = make([]);
    expect(f.componentInstance.effectiveAnalyzerCodes()).toEqual(KNOWN_ANALYZER_IMAGES.map(i => i.code));
  });
});
