import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { TestsComponent } from './tests.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { AuthService } from '../../../../core/auth/auth.service';

/**
 * Test Master LIST — two cards (ND-PATTERN "two jobs on one screen"):
 * DEPARTMENTS is the SIDE card on the LEFT (a filter companion: filter
 * first, then content; the BILLING anatomy), the grid the MAIN card (right). Rows filter the grid, the slate switch asks before
 * turning a department OFF, the card collapses to a strip (remembered per
 * user) and on narrow widths it is a sheet opened from the band pill.
 * Child components (AG-Grid, band, panels) are left as unknown elements so
 * the page's own template is what renders.
 */
const KEY = 'pf:tm:depts-collapsed:u1';

const test = (over: any = {}) => ({
  id: 't1', name: 'Haemoglobin', type: 'individual', isActive: true, testCode: 'HEM012',
  price: 150, department: { id: 'd1', name: 'Haematology' }, ...over,
});
const TESTS = [
  test(),
  test({ id: 't2', name: 'Platelets', testCode: 'HEM013' }),
  test({ id: 't3', name: 'Glucose', testCode: 'BIO001', department: { id: 'd2', name: 'Biochemistry' } }),
];
const DEPTS = [
  { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true },
  { id: 'd2', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd3', name: 'Molecular', code: 'MOL', isActive: false },
];

function render(opts: { confirm?: boolean; narrow?: boolean } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!opts.narrow : false,
    addEventListener() {}, removeEventListener() {},
  });
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? TESTS
      : url.startsWith('/api/catalog-proposals') ? [] : DEPTS)),
    patch: vi.fn(() => of({})),
    post: vi.fn(() => of({})),
  };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? false) };
  TestBed.configureTestingModule({
    imports: [TestsComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false, priceFor: () => null } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
    ],
  });
  TestBed.overrideComponent(TestsComponent, {
    set: { imports: [FormsModule, NgTemplateOutlet], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const f = TestBed.createComponent(TestsComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  const rerender = () => { f.detectChanges(); };
  return { f, el, c, api, dialog, rerender };
}

const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.pf-tm-side .pf-tm-dept-row'));
const flush = () => new Promise(r => setTimeout(r, 0));

describe('Test Master list — main card + DEPARTMENTS side card', () => {
  // An in-memory Storage (the runner's own localStorage may be missing).
  let mem: Map<string, string>;
  beforeEach(() => {
    mem = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('side card (LEFT, the filter) comes first; the main card (right) holds the grid with the count + the muted hint', () => {
    const { el } = render();
    const panels = el.querySelector('.pf-tm-panels')!;
    const main = panels.querySelector(':scope > section.nd-card.pf-tm-main')!;
    const side = panels.querySelector(':scope > aside.nd-card.pf-tm-side')!;
    expect(main).toBeTruthy();
    expect(side).toBeTruthy();
    expect(side.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panels.firstElementChild).toBe(side);
    expect(main.querySelector('ag-grid-angular')).toBeTruthy();
    expect(main.querySelector('.pf-tm-count')!.textContent).toContain('3 tests');
    expect(main.querySelector('.nd-card__note')!.textContent).toContain('Double-click a cell to edit');
  });

  it('the side card is the BILLING header: violet icon chip + DEPARTMENTS + a collapse button', () => {
    const { el } = render();
    const head = el.querySelector('.pf-tm-side .nd-card__head')!;
    expect(head.querySelector('.nd-card__icon svg')).toBeTruthy();
    expect(head.querySelector('.nd-card__label')!.textContent!.trim()).toBe('Departments');
    const collapse = head.querySelector('button.pf-tm-side__collapse[aria-label="Hide departments"]')!;
    expect(collapse).toBeTruthy();
    expect(collapse.querySelector('path')!.getAttribute('d')).toBe('M15 18l-6-6 6-6');   // collapse points LEFT
  });

  it('renders "All" + one row per department: name, code chip (tabular), count and a slate switch', () => {
    const { el } = render();
    const r = rows(el);
    expect(r).toHaveLength(4);
    expect(r[0].querySelector('.pf-tm-dept-name')!.textContent!.trim()).toBe('All');
    expect(r[0].querySelector('.pf-tm-dept-count')!.textContent!.trim()).toBe('3');
    const haem = r.find(x => x.textContent!.includes('Haematology'))!;
    expect(haem.querySelector('.pf-tm-dept-code.nd-num')!.textContent!.trim()).toBe('HEM');
    expect(haem.querySelector('.pf-tm-dept-count')!.textContent!.trim()).toBe('2');
    const sw = haem.querySelector('.nd-toggle[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    // The switch is its own target, not inside the filter button.
    expect(haem.querySelector('.pf-tm-dept')!.contains(sw)).toBe(false);
  });

  it('a disabled department is muted with an "Off" tag', () => {
    const { el } = render();
    const mol = rows(el).find(x => x.textContent!.includes('Molecular'))!;
    expect(mol.classList.contains('pf-tm-dept-row--off')).toBe(true);
    expect(mol.querySelector('.pf-tm-dept-off')!.textContent!.trim()).toBe('Off');
    expect(mol.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('tapping a row filters the grid and shows the neutral selected state; "All" clears it', () => {
    const { el, c, rerender } = render();
    const bio = rows(el).find(x => x.textContent!.includes('Biochemistry'))!;
    bio.querySelector<HTMLButtonElement>('.pf-tm-dept')!.click();
    rerender();
    expect(c.rowData().map((t: any) => t.id)).toEqual(['t3']);
    const sel = el.querySelectorAll('.pf-tm-side .pf-tm-dept[aria-pressed="true"]');
    expect(sel).toHaveLength(1);
    expect(sel[0].textContent).toContain('Biochemistry');
    rows(el)[0].querySelector<HTMLButtonElement>('.pf-tm-dept')!.click();
    rerender();
    expect(c.rowData()).toHaveLength(3);
  });

  it('switching OFF asks first (DialogService); cancel sends nothing', async () => {
    const { el, api, dialog } = render({ confirm: false });
    rows(el).find(x => x.textContent!.includes('Haematology'))!
      .querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await flush();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect((dialog.confirm.mock.calls[0] as any[])[0]).toMatchObject({ title: 'Turn off Haematology?', tone: 'danger' });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('switching OFF confirmed PATCHes isActive:false; switching ON needs no confirm', async () => {
    const { el, api, dialog } = render({ confirm: true });
    rows(el).find(x => x.textContent!.includes('Haematology'))!
      .querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await flush();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d1', { isActive: false });
    dialog.confirm.mockClear();
    rows(el).find(x => x.textContent!.includes('Molecular'))!
      .querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await flush();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d3', { isActive: true });
  });

  it('collapse → a slim strip (icon + "Departments") and back; remembered per user', () => {
    const { el, rerender } = render();
    el.querySelector<HTMLButtonElement>('.pf-tm-side__collapse')!.click();
    rerender();
    expect(el.querySelector('.pf-tm-side')).toBeNull();
    const strip = el.querySelector('.pf-tm-strip')!;
    expect(strip.querySelector('.nd-card__icon')).toBeTruthy();
    expect(strip.querySelector('.pf-tm-strip__label')!.textContent!.trim()).toBe('Departments');
    expect(el.querySelector('.pf-tm-panels')!.classList.contains('pf-tm-panels--collapsed')).toBe(true);
    expect(el.querySelector('.pf-tm-panels')!.firstElementChild).toBe(strip);                       // strip on the LEFT edge
    expect(strip.querySelector('.pf-tm-strip__expand path')!.getAttribute('d')).toBe('M9 18l6-6-6-6'); // expand points RIGHT
    expect(localStorage.getItem(KEY)).toBe('1');

    strip.querySelector<HTMLButtonElement>('button[aria-label="Show departments"]')!.click();
    rerender();
    expect(el.querySelector('.pf-tm-side')).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('a remembered collapse is restored on the next visit (and survives storage failure)', () => {
    localStorage.setItem(KEY, '1');
    const { el } = render();
    expect(el.querySelector('.pf-tm-strip')).toBeTruthy();
    TestBed.resetTestingModule();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const again = render();
    expect(again.el.querySelector('.pf-tm-side')).toBeTruthy();   // falls back to expanded
    again.el.querySelector<HTMLButtonElement>('.pf-tm-side__collapse')!.click();
    again.rerender();
    expect(again.el.querySelector('.pf-tm-strip')).toBeTruthy();  // still works, just not remembered
  });

  it('narrow widths: no side column; the band pill\'s "Departments" button opens a sheet; a row pick filters + closes it', () => {
    const { el, c, rerender } = render({ narrow: true });
    expect(el.querySelector('.pf-tm-side')).toBeNull();
    expect(el.querySelector('.pf-tm-strip')).toBeNull();
    const btn = el.querySelector<HTMLButtonElement>('pf-hero-band .pf-tm-deptchip')!;
    expect(btn.textContent).toContain('Departments');
    btn.click();
    rerender();
    const sheet = el.querySelector('.pf-tm-side.pf-tm-side--sheet[role="dialog"]')!;
    expect(sheet).toBeTruthy();
    expect(sheet.querySelector('.nd-sheet__handle')).toBeTruthy();
    expect(el.querySelector('.nd-sheet-backdrop')).toBeTruthy();
    expect(sheet.querySelector('button[aria-label="Close departments"]')).toBeTruthy();
    rows(el).find(x => x.textContent!.includes('Haematology'))!.querySelector<HTMLButtonElement>('.pf-tm-dept')!.click();
    rerender();
    expect(c.rowData().map((t: any) => t.id)).toEqual(['t1', 't2']);
    expect(el.querySelector('.pf-tm-side--sheet')).toBeNull();
  });

  it('the sheet closes from the backdrop too', () => {
    const { el, rerender } = render({ narrow: true });
    el.querySelector<HTMLButtonElement>('.pf-tm-deptchip')!.click();
    rerender();
    el.querySelector<HTMLElement>('.nd-sheet-backdrop')!.click();
    rerender();
    expect(el.querySelector('.pf-tm-side--sheet')).toBeNull();
  });

  it('wide: no "Departments" button in the band pill', () => {
    const { el } = render();
    expect(el.querySelector('.pf-tm-deptchip')).toBeNull();
  });
});
