import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { CultureEntryComponent } from './culture-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { DiskReadApi } from './disk-read';
import { AuthService } from '../../../core/auth/auth.service';
import { reportedAstRows } from '../../../shared/utils/report-pdf';
import { PlateReading } from './plate-reading';

// This file stubs window.matchMedia: put the REAL one back after every test so the stub never leaks into other specs
// of the combined run (a leaked "reduce" / "pointer: coarse" answer flipped motion and touch rules elsewhere).
const realMatchMedia = window.matchMedia;
afterEach(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia }); });


/**
 * Owner (2026-09-26): the culture case's Identification header → Measure.
 * Inside the measure the organism is picked; its CLSI panel shows live
 * S / I / R; OK writes the organism and fills the AST table (zones + S/I/R),
 * never submits, and asks before replacing results already entered.
 */

const MASTER = [
  { name: 'Amoxicillin-Clavulanate', shortName: 'AMC' }, { name: 'Cefixime', shortName: 'CFM' },
  { name: 'Imipenem', shortName: 'IPM' }, { name: 'Piperacillin-Tazobactam', shortName: 'TZP' },
  { name: 'Vancomycin', shortName: 'VAN' },
];
const BPS = [
  { organismGroup: 'Enterobacterales', antibiotic: 'Amoxicillin-Clavulanate', susceptibleMin: 18, resistantMax: 13, enabled: true },
  { organismGroup: 'Enterobacterales', antibiotic: 'Gentamicin', susceptibleMin: 15, resistantMax: 12, enabled: true },
  { organismGroup: 'Enterobacterales', antibiotic: 'Imipenem', susceptibleMin: 23, resistantMax: 19, enabled: true },
  // split rows: the plate's "PIT 100/10" must land on the "…100" row
  { organismGroup: 'Enterobacterales', antibiotic: 'Piperacillin-Tazobactam 10', susceptibleMin: 20, resistantMax: 16, enabled: true },
  { organismGroup: 'Enterobacterales', antibiotic: 'Piperacillin-Tazobactam 100', susceptibleMin: 25, resistantMax: 20, enabled: true },
  { organismGroup: 'Staphylococcus', antibiotic: 'Amoxicillin-Clavulanate', susceptibleMin: 20, resistantMax: 19, enabled: true },
  { organismGroup: 'Staphylococcus', antibiotic: 'Vancomycin', susceptibleMin: 15, resistantMax: 14, enabled: true },
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

function render(opts: { embedded?: boolean; orderTestId?: string | null; caseView?: unknown; caseId?: string | null; canEditMaster?: boolean; reportHidden?: string[] | null } = {}) {
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
      // Private uploads: the plate photo comes from the session's blob cache.
      { provide: UploadsService, useValue: { src: (u?: string | null) => (u ? 'blob:' + u : ''), blob: async () => null } },
      { provide: CapacitorService, useValue: {} },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: DiskReadApi, useValue: { usage: () => throwError(() => ({ status: 404 })), read: () => new Subject(), confirm: () => of({}) } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => !!opts.canEditMaster && p === 'manage_tests' } },
    ],
  });
  const f = TestBed.createComponent(CultureEntryComponent);
  const c = f.componentInstance as any;
  c.embedded = opts.embedded ?? true;
  c.orderTestId = opts.orderTestId === undefined ? 'OT-1' : opts.orderTestId;
  if (opts.caseId !== undefined) c.plateCaseId = opts.caseId;
  c.reportHidden = opts.reportHidden === undefined ? [] : opts.reportHidden;
  c.reportHiddenChange.subscribe((h: string[]) => { c.reportHidden = h; });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rows = () => (c.m().organisms?.[0]?.antibiotics ?? []).map((a: any) => [a.name, a.zoneSize, a.interpretation]);
  /** [name, zone, S/I/R, ticked for the report] */
  const table = () => (c.m().organisms?.[0]?.antibiotics ?? []).map((a: any) => [a.name, a.zoneSize, a.interpretation, !(c.reportHidden ?? []).includes('ast:0:' + a.name)]);
  return { f, c, el, api, rows, table };
}


afterEach(() => { document.querySelectorAll('pf-plate-measure').forEach(n => n.remove()); });

/** The measure modal's live disks (what the review template is fed). */
const LIVE = [
  { n: 1, code: 'AMC 30', drug: 'Amoxicillin-Clavulanate', mm: 6 },
  { n: 2, code: 'CFM 5', drug: 'Cefixime', mm: 20 },
  { n: 4, code: 'IPM 10', drug: 'Imipenem', mm: 25 },
  { n: 8, code: 'PIT 100/10', drug: 'Piperacillin-Tazobactam', mm: 10 },
];

describe('Identification → Measure: organism picked INSIDE the measure', () => {
  it('a measure request opens the plate measure — organism step, one "OK" primary, full screen on phones', () => {
    const { f, c } = render();
    c.measureRequest = { org: 'Escherichia coli', n: 1 };
    f.detectChanges();
    const pm = document.querySelector('pf-plate-measure');
    expect(pm).toBeTruthy();
    expect(c.mOrg()).toBe('Escherichia coli');                    // pre-filled from Organism isolated
    const steps = [...pm!.querySelectorAll('.pm-step__lbl')].map(s => s.textContent?.trim());
    expect(steps).toEqual(['Capture', 'Calibrate', 'Measure & read', 'Organism']);
    expect(pm!.querySelector('.pm-backdrop')?.classList.contains('pm-backdrop--phonefull')).toBe(true);
    // The same request again does not reopen it; a new one does.
    c.closeOrgMeasure(); f.detectChanges();
    c.measureRequest = { org: 'Escherichia coli', n: 1 }; f.detectChanges();
    expect(c.orgMeasureOpen()).toBe(false);
    c.measureRequest = { org: null, n: 2 }; f.detectChanges();
    expect(c.orgMeasureOpen()).toBe(true);
    expect(c.mOrg()).toBe('');
  });

  it('review step: organism picker + the CLSI panel with live S / I / R per measured zone', () => {
    const { f, c } = render();
    c.openOrgMeasure(null);
    f.detectChanges();
    const pmEl = document.querySelector('pf-plate-measure')!;
    // Drive the modal to Review with four coded disks.
    const inst = (f.debugElement.query(d => d.name === 'pf-plate-measure')?.componentInstance) as any;
    inst.rows.set(LIVE.map((d, i) => ({ id: i + 1, n: d.n, cx: 0, cy: 0, own: { rx: 1, ry: 1, angle: 0 }, ruler: { rx: 1, ry: 1, angle: 0 },
      k: d.mm / 6, zoneFound: d.mm > 6, code: d.code, codeSrc: 'tech', aiConf: null, notDisk: false })));
    inst.imageSrc.set('data:image/png;base64,AA');
    inst.mode.set('review');
    f.detectChanges();
    expect(pmEl.querySelector('.ce-mo pf-select')).toBeTruthy();
    expect(pmEl.querySelector('.ce-mo__trigger')).toBeTruthy();   // phones: the sheet trigger
    const ok = pmEl.querySelector<HTMLButtonElement>('.pm-apply')!;
    expect(ok.textContent?.trim()).toBe('OK');
    expect(ok.classList.contains('pf-btn--primary')).toBe(true);
    expect(ok.disabled).toBe(true);                                 // no organism yet
    c.setMeasureOrg('Escherichia coli');
    f.detectChanges();
    const rows = [...pmEl.querySelectorAll('.ce-mo__row')].map(r => [
      r.querySelector('.ce-mo__name')?.textContent?.trim(), r.querySelector('.ce-mo__mm')?.textContent?.trim(),
      r.querySelector('.ce-mo__sir')?.textContent?.trim(), r.querySelector('.ce-mo__tick--on') !== null]);
    expect(rows).toEqual([
      ['Amoxicillin-Clavulanate', '6 mm', 'R', true],
      ['Cefixime', '20 mm', '–', true],                             // outside the panel → asks for breakpoints
      ['Imipenem', '25 mm', 'S', true],
      ['Piperacillin-Tazobactam 100', '10 mm', 'R', true],
      ['Gentamicin', '—', '–', false],
      ['Piperacillin-Tazobactam 10', '—', '–', false],
    ]);
    expect(pmEl.querySelectorAll('.ce-mo__row')[1].querySelector('.ce-mo__bpnote')?.textContent).toContain('No CLSI breakpoint for Escherichia coli');
    c.setMeasureBp('Cefixime', 's', '19'); c.setMeasureBp('Cefixime', 'r', '15');
    f.detectChanges();
    expect(pmEl.querySelectorAll('.ce-mo__row')[1].querySelector('.ce-mo__sir')?.textContent?.trim()).toBe('S');
    expect(pmEl.querySelector<HTMLButtonElement>('.pm-apply')!.disabled).toBe(false);
    // Live S / I / R reaches the disk list / rings too (by printed code).
    expect(c.orgSrI('Piperacillin-Tazobactam', 10, 'PIT 100/10')).toBe('R');
    expect(c.orgSrI('Imipenem', 25, 'IPM 10')).toBe('S');
  });

  it('OK writes the organism and fills its AST rows (zone mm + S / I / R); nothing is submitted', () => {
    const { c, api, table } = render();
    const measured: string[] = [];
    c.organismMeasured.subscribe((n: string) => measured.push(n));
    c.openOrgMeasure('Escherichia coli');
    c.setMeasureBp('Cefixime', 's', '19'); c.setMeasureBp('Cefixime', 'r', '15');
    c.onOrganismMeasured(APPLIED);
    expect(c.m().organisms.map((o: any) => o.name)).toEqual(['Escherichia coli']);
    expect(table()).toEqual([
      ['Amoxicillin-Clavulanate', 6, 'R', true],
      ['Cefixime', 20, 'S', true],                                  // from the breakpoints typed in the measure
      ['Imipenem', 25, 'S', true],
      ['Piperacillin-Tazobactam 100', 10, 'R', true],
      ['Gentamicin', null, '', false],
      ['Piperacillin-Tazobactam 10', null, '', false],
    ]);
    expect(c.m().organisms[0].antibiotics[1]).toMatchObject({ sMin: 19, rMax: 15 });
    expect(measured).toEqual(['Escherichia coli']);
    expect(c.orgMeasureOpen()).toBe(false);
    // The reading is kept on the case (re-measure reopens on it) — and no submit.
    expect(api.put).toHaveBeenCalledWith('/api/microbiology/culture/OT-1/stage/ast/plate', expect.anything());
    const posted = (api.post.mock.calls as unknown as [string][]).map(x => x[0]);
    expect(posted.some(p => /submit/.test(p))).toBe(false);
  });

  it('OK adds a second organism without touching the first', () => {
    const { c } = render();
    c.seedOrganisms = ['Staphylococcus aureus'];
    c.setZone(0, 0, 22);
    c.openOrgMeasure('Escherichia coli');
    c.onOrganismMeasured(APPLIED);
    const orgs = c.m().organisms;
    expect(orgs.map((o: any) => o.name)).toEqual(['Staphylococcus aureus', 'Escherichia coli']);
    expect(orgs[0].antibiotics[0].zoneSize).toBe(22);
    expect(orgs[1].fromPlate).toBe(true);
  });

  it('entered results are never replaced without the inline confirm', () => {
    const { f, c, rows } = render();
    c.openOrgMeasure('Escherichia coli');
    c.onOrganismMeasured(APPLIED);                                   // first measure
    c.setZone(0, 2, 30);                                             // tech edits a zone
    c.openOrgMeasure('Escherichia coli');                            // re-measure
    expect(c.overwriteTarget()).toBe('Escherichia coli');
    expect(c.orgMeasureCanApply()).toBe(false);
    f.detectChanges();
    const pm = f.debugElement.query(d => d.name === 'pf-plate-measure')!.componentInstance as any;
    pm.mode.set('review');
    f.detectChanges();
    const pmEl = document.querySelector('pf-plate-measure')!;
    expect(pmEl.querySelector('.ce-mo__warn')?.textContent).toContain('Escherichia coli already has sensitivity results');
    expect(pmEl.querySelector<HTMLButtonElement>('.pm-apply')!.disabled).toBe(true);
    c.onOrganismMeasured(APPLIED);                                   // blocked: nothing changes
    expect(rows()[2]).toEqual(['Imipenem', 30, 'S']);
    c.mReplace.set(true);
    c.onOrganismMeasured(APPLIED);
    expect(rows()[2]).toEqual(['Imipenem', 25, 'S']);
  });

  it('AST rows stay editable: a zone edit recomputes S / I / R (also after the parent echoes the value)', () => {
    const { c, rows } = render();
    c.onPlateMeasured(APPLIED);
    c.seedOrganisms = ['Escherichia coli'];                          // auto build from the case plate
    c.value = c.m();                                                 // the workbench echoes [value]
    expect(rows()[2]).toEqual(['Imipenem', 25, 'S']);
    c.setZone(0, 2, 18);
    expect(rows()[2]).toEqual(['Imipenem', 18, 'R']);                // recomputed from 23 / 19
    c.setInterp(0, 2, 'I');                                          // a manual override…
    c.setZone(0, 2, 30);
    expect(rows()[2]).toEqual(['Imipenem', 30, 'I']);                // …is kept
  });

  it('a table the plate built untouched is re-measured without asking', () => {
    const { c } = render();
    c.openOrgMeasure('Escherichia coli');
    c.onOrganismMeasured(APPLIED);
    c.openOrgMeasure('Escherichia coli');
    expect(c.overwriteTarget()).toBeNull();
    expect(c.orgMeasureCanApply()).toBe(true);
    c.setInterp(0, 0, 'S');                                          // a verdict typed by hand
    expect(c.overwriteTarget()).toBe('Escherichia coli');
  });

  it('re-measure reopens on the organism\'s own photo + rings', () => {
    const { c } = render();
    c.openOrgMeasure('Escherichia coli');
    c.onOrganismMeasured(APPLIED);
    c.openOrgMeasure('Escherichia coli');
    expect(c.orgMeasureStart()).toMatchObject({ imageUrl: '/uploads/plate.jpg' });
    expect(c.orgMeasureStart()!.session.zones.length).toBe(4);
    c.closeOrgMeasure();
    c.openOrgMeasure('Staphylococcus aureus');                       // no own photo → the case plate
    expect(c.orgMeasureStart()).toMatchObject({ imageUrl: '/uploads/plate.jpg' });
  });

  it('phones: the organism picker is a sheet with search and 44px rows', () => {
    const { f, c } = render();
    c.organismNames = ['Escherichia coli', 'Staphylococcus aureus'];
    c.openOrgMeasure(null);
    f.detectChanges();
    const pm = f.debugElement.query(d => d.name === 'pf-plate-measure')!.componentInstance as any;
    pm.imageSrc.set('data:image/png;base64,AA');
    pm.mode.set('review'); f.detectChanges();
    c.openOrgSheet(); f.detectChanges();
    const sheet = document.querySelector('pf-plate-measure .ce-mo-sheet')!;
    expect(sheet.getAttribute('role')).toBe('dialog');
    c.orgQuery.set('staph'); f.detectChanges();
    const opts = [...sheet.querySelectorAll('.ce-mo-sheet__opt')].map(b => b.textContent?.trim());
    expect(opts).toEqual(['Staphylococcus aureus']);
    (sheet.querySelector('.ce-mo-sheet__opt') as HTMLButtonElement).click(); f.detectChanges();
    expect(c.mOrg()).toBe('Staphylococcus aureus');
    expect(c.orgSheet()).toBe(false);
    const css = ((CultureEntryComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(css).toMatch(/\.ce-mo-sheet__opt[^{,]*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.ce-mo-sheet__q[^{,]*\{[^}]*font-size:\s*16px/);
  });
});
