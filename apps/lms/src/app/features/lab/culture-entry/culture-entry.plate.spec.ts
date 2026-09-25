import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { CultureEntryComponent } from './culture-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { DiskReadApi } from './disk-read';
import { PlateReading } from './plate-reading';

/**
 * SME flow: the plate is measured BEFORE the organism (PF Sense reads the
 * codes against the whole antibiotic master), held on the case, and the AST
 * table is built from it when the organism is identified — only the plate's
 * antibiotics, zones filled, S / I / R from that organism's breakpoints; a
 * drug the organism has no breakpoint for says so. The manual path stays.
 */

const MASTER = [
  { name: 'Amoxicillin-Clavulanate', shortName: 'AMC' }, { name: 'Cefixime', shortName: 'CFM' },
  { name: 'Imipenem', shortName: 'IPM' }, { name: 'Piperacillin-Tazobactam', shortName: 'TZP' },
  { name: 'Vancomycin', shortName: 'VAN' },
];
const BPS = [
  { organismGroup: 'Enterobacterales', antibiotic: 'Amoxicillin-Clavulanate', susceptibleMin: 18, resistantMax: 13, enabled: true },
  { organismGroup: 'Enterobacterales', antibiotic: 'Imipenem', susceptibleMin: 23, resistantMax: 19, enabled: true },
  { organismGroup: 'Enterobacterales', antibiotic: 'Piperacillin-Tazobactam', susceptibleMin: 25, resistantMax: 20, enabled: true },
  { organismGroup: 'Staphylococcus', antibiotic: 'Amoxicillin-Clavulanate', susceptibleMin: 20, resistantMax: 19, enabled: true },
];
const ORGS = [{ name: 'Escherichia coli', group: 'Enterobacterales' }, { name: 'Staphylococcus aureus', group: 'Staphylococcus' }];

/** What the Measure modal applies: indices into the master list. */
const APPLIED = {
  measurements: [{ index: 0, zoneMm: 6 }, { index: 1, zoneMm: 20 }, { index: 2, zoneMm: 25 }, { index: 3, zoneMm: 10 }],
  imageUrl: '/uploads/plate.jpg',
  auditId: 'aud-9',
  session: { dishMm: 90, calPts: [{ x: 0, y: 0 }, { x: 500, y: 0 }], zones: [
    { cx: 1, cy: 1, r: 17, abName: 'Amoxicillin-Clavulanate', code: 'AMC 30', mm: 6, n: 1 },
    { cx: 2, cy: 1, r: 57, abName: 'Cefixime', code: 'CFM 5', mm: 20, n: 2 },
    { cx: 3, cy: 1, r: 71, abName: 'Imipenem', code: 'IPM 10', mm: 25, n: 4 },
    { cx: 4, cy: 1, r: 28, abName: 'Piperacillin-Tazobactam', code: 'PIT 100/10', mm: 10, n: 8 },
  ] },
};

function render(opts: { embedded?: boolean; orderTestId?: string | null; caseView?: unknown; caseId?: string | null } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(() => { /* */ }) } });
  const caseView = opts.caseView ?? { stages: [{ key: 'ast', plateJson: null }] };
  const api = {
    get: vi.fn((path: string) => {
      if (path === '/api/microbiology/antibiotics') return of(MASTER);
      if (path === '/api/microbiology/breakpoints') return of(BPS);
      if (path === '/api/microbiology/organisms') return of(ORGS);
      if (path.startsWith('/api/microbiology/culture/')) return of(caseView);
      return of([]);
    }),
    post: vi.fn(() => of({})),
    put: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [CultureEntryComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: PlatformService, useValue: { isCapacitor: () => false, isNative: () => false, getApiUrl: () => '' } },
      { provide: HttpClient, useValue: {} },
      { provide: CapacitorService, useValue: {} },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: DiskReadApi, useValue: { usage: () => throwError(() => ({ status: 404 })), read: () => new Subject(), confirm: () => of({}) } },
    ],
  });
  const f = TestBed.createComponent(CultureEntryComponent);
  const c = f.componentInstance as any;
  c.embedded = opts.embedded ?? true;
  c.orderTestId = opts.orderTestId === undefined ? 'OT-1' : opts.orderTestId;
  if (opts.caseId !== undefined) c.plateCaseId = opts.caseId;
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rows = () => (c.m().organisms?.[0]?.antibiotics ?? []).map((a: any) => [a.name, a.zoneSize, a.interpretation]);
  return { f, c, el, api, rows };
}

afterEach(() => { document.querySelectorAll('pf-plate-measure').forEach(n => n.remove()); });

describe('Plate before organism — measure first', () => {
  it('the AST area offers "Measure plate" before any organism exists', () => {
    const { el, c } = render();
    expect(c.m().organisms ?? []).toEqual([]);
    const block = el.querySelector('.ce-plate')!;
    expect(block).toBeTruthy();
    const btn = block.querySelector<HTMLButtonElement>('.ce-plate__btn')!;
    expect(btn.classList.contains('nd-btn--secondary')).toBe(true);
    expect(btn.textContent?.trim()).toBe('Measure plate');
    expect(block.textContent).toContain('before the organism is known');
  });

  it('Measure plate opens the modal with the WHOLE antibiotic master as candidates', () => {
    const { f, el, c } = render();
    el.querySelector<HTMLButtonElement>('.ce-plate__btn')!.click();
    f.detectChanges();
    const pm = document.querySelector('pf-plate-measure');
    expect(pm).toBeTruthy();
    const codes = c.masterCands().map((x: any) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['AMC 30', 'CFM 5', 'IPM 10', 'PIT 100/10', 'VA 30']));
  });

  it('confirmed plate → stored on the case (AST stage plateJson); nothing on a table until the organism', () => {
    const { f, el, c, api } = render();
    c.openPlateMeasure();
    c.onPlateMeasured(APPLIED);
    f.detectChanges();
    expect(api.put).toHaveBeenCalledTimes(1);
    const [path, body] = api.put.mock.calls[0] as unknown as [string, { plateJson: string }];
    expect(path).toBe('/api/microbiology/culture/OT-1/stage/ast/plate');
    const stored = JSON.parse(body.plateJson) as PlateReading;
    expect(stored.auditId).toBe('aud-9');
    expect(stored.disks.map(d => [d.n, d.code, d.drug, d.mm])).toEqual([
      [1, 'AMC 30', 'Amoxicillin-Clavulanate', 6], [2, 'CFM 5', 'Cefixime', 20],
      [4, 'IPM 10', 'Imipenem', 25], [8, 'PIT 100/10', 'Piperacillin-Tazobactam', 10],
    ]);
    expect(c.m().organisms ?? []).toEqual([]);
    expect(el.querySelectorAll('.ce-plate__chip').length).toBe(4);
    expect(el.querySelector('.ce-plate__note')?.textContent).toContain('Identify the organism');
    expect(c.measuringPlate()).toBe(false);
  });
});

describe('Plate before organism — the organism picks the breakpoints', () => {
  it('identifying the organism shows ONLY the plate\'s antibiotics, zones filled, S / I / R computed', () => {
    const { f, el, c, rows } = render();
    c.onPlateMeasured(APPLIED);
    c.seedOrganisms = ['Escherichia coli'];
    f.detectChanges();
    expect(rows()).toEqual([
      ['Amoxicillin-Clavulanate', 6, 'R'], ['Cefixime', 20, ''], ['Imipenem', 25, 'S'], ['Piperacillin-Tazobactam', 10, 'R'],
    ]);
    expect(c.m().organisms[0].fromPlate).toBe(true);
    expect(c.mode()).toBe('zone');
    const notes = [...el.querySelectorAll('.ce-abx__nobp')].map(n => n.textContent?.trim());
    expect(notes).toEqual(['No CLSI breakpoint for Escherichia coli']);   // Cefixime
    expect(el.querySelector('.ce-plate__note')?.textContent).toContain('On the table for Escherichia coli');
  });

  it('changing the organism re-maps breakpoints on the SAME zones and recomputes S / I / R', () => {
    const { f, el, c, rows } = render();
    c.onPlateMeasured(APPLIED);
    c.seedOrganisms = ['Escherichia coli'];
    c.setInterp(0, 2, 'R');                                   // a manual override for E. coli…
    c.seedOrganisms = ['Staphylococcus aureus'];              // …identification changed
    f.detectChanges();
    expect(c.m().organisms.length).toBe(1);
    expect(c.m().organisms[0].name).toBe('Staphylococcus aureus');
    expect(rows()).toEqual([
      ['Amoxicillin-Clavulanate', 6, 'R'], ['Cefixime', 20, ''], ['Imipenem', 25, ''], ['Piperacillin-Tazobactam', 10, ''],
    ]);
    expect(el.querySelectorAll('.ce-abx__nobp').length).toBe(3);
  });

  it('an organism identified BEFORE the measure gets the plate when it is confirmed', () => {
    const { c, rows } = render();
    c.seedOrganisms = ['Escherichia coli'];
    expect(rows().map((r: any[]) => r[0])).toEqual(['Amoxicillin-Clavulanate', 'Imipenem', 'Piperacillin-Tazobactam']); // CLSI panel
    c.onPlateMeasured(APPLIED);
    expect(rows().map((r: any[]) => r[0])).toEqual(['Amoxicillin-Clavulanate', 'Cefixime', 'Imipenem', 'Piperacillin-Tazobactam']);
    expect(rows()[0]).toEqual(['Amoxicillin-Clavulanate', 6, 'R']);
  });

  it('more antibiotics can still be added by hand', () => {
    const { c } = render();
    c.onPlateMeasured(APPLIED);
    c.seedOrganisms = ['Escherichia coli'];
    c.syncAbx(0, [...c.abxValuesOf(0), 'Vancomycin']);
    expect(c.m().organisms[0].antibiotics.map((a: any) => a.name)).toContain('Vancomycin');
    expect(c.m().organisms[0].antibiotics.find((a: any) => a.name === 'Imipenem').zoneSize).toBe(25);
  });
});

describe('Plate before organism — survives a reload', () => {
  const stored = JSON.stringify({ v: 1, measuredAt: '2026-09-25T10:00:00Z', imageUrl: '/p.jpg', auditId: 'a1', session: APPLIED.session,
    disks: [{ n: 1, code: 'AMC 30', drug: 'Amoxicillin-Clavulanate', mm: 6 }, { n: 4, code: 'IPM 10', drug: 'Imipenem', mm: 25 }] });

  it('reloads the case\'s plate and builds the table when the organism is known', () => {
    const { f, el, c, api, rows } = render({ caseView: { stages: [{ key: 'gram' }, { key: 'ast', plateJson: stored }] } });
    expect(api.get).toHaveBeenCalledWith('/api/microbiology/culture/OT-1');
    expect(c.plate()?.disks.length).toBe(2);
    f.detectChanges();
    expect(el.querySelector('.ce-plate__btn')?.textContent?.trim()).toBe('Re-measure plate');
    c.seedOrganisms = ['Escherichia coli'];
    expect(rows()).toEqual([['Amoxicillin-Clavulanate', 6, 'R'], ['Imipenem', 25, 'S']]);
    expect(c.userEdited).toBe(false);                         // automatic — the parent can still re-seed
  });

  it('a subculture branch reads (and writes) ITS AST stage', () => {
    const { c, api } = render({ caseId: 'SUB-1', caseView: { stages: [{ key: 'ast', plateJson: null }], subCultures: [{ id: 'SUB-1', stages: [{ key: 'ast', plateJson: stored }] }] } });
    expect(c.plate()?.disks.length).toBe(2);
    c.onPlateMeasured(APPLIED);
    expect((api.put.mock.calls[0] as unknown as [string])[0]).toBe('/api/microbiology/culture/OT-1/stage/ast/plate?caseId=SUB-1');
  });
});

describe('The manual path is unchanged', () => {
  it('no case (standalone entry) → no plate block, organism first as today', () => {
    const { el, c, rows } = render({ embedded: false, orderTestId: null });
    expect(el.querySelector('.ce-plate')).toBeNull();
    c.seedOrganisms = ['Escherichia coli'];
    expect(rows().map((r: any[]) => r[0])).toEqual(['Amoxicillin-Clavulanate', 'Imipenem', 'Piperacillin-Tazobactam']);
    expect(c.m().organisms[0].fromPlate).toBeUndefined();
  });

  it('workbench without a plate: organism first → its CLSI panel, no plate notes', () => {
    const { f, el, c, rows } = render();
    c.seedOrganisms = ['Escherichia coli'];
    f.detectChanges();
    expect(rows().every((r: any[]) => r[1] == null && r[2] === '')).toBe(true);
    expect(el.querySelectorAll('.ce-abx__nobp').length).toBe(0);
    expect(c.m().organisms[0].fromPlate).toBeUndefined();
  });

  it('an organism with entered results is never overwritten by a plate', () => {
    const { c, rows } = render();
    c.seedOrganisms = ['Escherichia coli'];
    c.setZone(0, 0, 21);
    c.onPlateMeasured(APPLIED);
    expect(rows()[0]).toEqual(['Amoxicillin-Clavulanate', 21, 'S']);
    expect(c.m().organisms[0].fromPlate).toBeUndefined();
  });
});
