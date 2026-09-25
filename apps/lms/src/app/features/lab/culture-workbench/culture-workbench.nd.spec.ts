import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { CultureWorkbenchComponent } from './culture-workbench.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

/** Culture case on the nd pattern (owner): band + context bar, one primary,
 *  stage tabs, compact option controls, one-tap notes, phone stacking. */

const CASE = {
  id: 'case-1', orderTestId: 'ot-1', caseState: 'active', createdAt: new Date().toISOString(),
  barcode: 'MICRO26001', patientName: 'Mrs. Shanthi Murugesan', testName: 'Bacterial Culture & Sensitivity',
  departmentName: 'Microbiology', specimen: 'Body Fluid', incubateUntil: null,
  stages: [
    { key: 'gram', label: 'Gram / Direct smear', state: 'open' },
    { key: 'growth', label: 'Growth check', state: 'open' },
    { key: 'identification', label: 'Organism identification', state: 'open' },
    { key: 'ast', label: 'Antibiotic sensitivity', state: 'open' },
  ],
};
const SCHEMA = {
  gram: [
    { name: 'pus_cells', title: 'Pus Cells', type: 'select', options: ['Nil', 'Few', 'Moderate', 'Many'] },
    { name: 'morphology', title: 'Morphology', type: 'select',
      options: ['Cocci', 'Bacilli', 'Coccobacilli', 'Diplococci', 'Spirilla', 'Yeast', 'Mixed'] },
    { name: 'interpretation', title: 'Interpretation', type: 'textarea', options: [] },
  ],
};

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

function render(caseOver: Record<string, unknown> = {}) {
  stubMatchMedia();
  const c = { ...CASE, ...caseOver };
  const get = (url: string) => {
    if (url.includes('/stage-schema')) return of(SCHEMA);
    if (url.includes('/culture/')) return of(c);
    return of([]);
  };
  TestBed.configureTestingModule({
    imports: [CultureWorkbenchComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: () => of(c), put: () => of({}), delete: () => of({}) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me', displayName: 'Admin User', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: DialogService, useValue: {} },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ orderTestId: 'ot-1' }), queryParamMap: convertToParamMap({}) } } },
    ],
  });
  const f = TestBed.createComponent(CultureWorkbenchComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, cmp: f.componentInstance as any };
}

const css = () => ((CultureWorkbenchComponent as any).ɵcmp.styles as string[]).join('\n');

describe('Culture case — band + context bar', () => {
  it('context bar: case ID (primary chip), full patient name, test, Day N, stage progress', () => {
    const { el } = render();
    const ctx = el.querySelector('.pf-cse-ctx')!;
    expect(ctx.querySelector('.pf-cse-chip--id')?.textContent?.trim()).toBe('MICRO26001');
    expect(ctx.querySelector('.pf-cse-chip--patient')?.textContent?.trim()).toBe('Mrs. Shanthi Murugesan');
    expect(ctx.querySelector('.pf-cse-chip--test')?.textContent?.trim()).toBe('Bacterial Culture & Sensitivity');
    expect(ctx.querySelector('.pf-cse-chip--day')?.textContent?.trim()).toBe('Day 1');
    expect(ctx.querySelector('.pf-cse-chip--progress')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('0/4 stages');
  });

  it('the band has exactly ONE primary: Inoculate & incubate (violet), tech chip neutral', () => {
    const { el } = render();
    const prim = el.querySelectorAll('.pf-hb__actions .pf-hb-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].textContent).toContain('Inoculate & incubate');
    expect(el.querySelector('.pf-cse-tech')?.classList.contains('nd-chip--static')).toBe(true);
    expect(el.querySelector('.pf-cse__tech-dot')).toBeNull();
  });

  it('once every stage is done the sign-out button is the one primary; incubate goes secondary', () => {
    const done = CASE.stages.map(s => ({ ...s, state: 'done' }));
    const { el } = render({ stages: done });
    const prim = el.querySelectorAll('.pf-hb__actions .pf-hb-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].classList.contains('pf-cse-signout')).toBe(true);
    expect(el.querySelector('.pf-cse-incubbtn')?.classList.contains('pf-hb-btn--ghost')).toBe(true);
  });

  it('no green, no amber, no monospace, no spaced caps eyebrow', () => {
    const s = css();
    expect(s).not.toMatch(/#22c55e|#34d399|#fbbf24|#b45309|245,\s*158,\s*11|34,\s*197,\s*94|#22d3ee/i);
    expect(s).not.toMatch(/JetBrains|monospace/i);
    expect(s).not.toMatch(/letter-spacing:\s*\.1em/);
  });
});

describe('Culture case — stage tabs + rows', () => {
  it('stage tabs: one tab per stage, the selected one shows its card; switching swaps the card', () => {
    const { f, el } = render();
    const tabs = el.querySelectorAll<HTMLButtonElement>('.pf-cse-tabs .pf-cse-tab');
    expect(tabs.length).toBe(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelectorAll('section.pf-stg').length).toBe(1);
    expect(el.querySelector('.pf-stg__name')?.textContent?.trim()).toBe('Gram / Direct smear');
    tabs[1].click();
    f.detectChanges();
    expect(el.querySelector('.pf-stg__name')?.textContent?.trim()).toBe('Growth check');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('done stages carry a small violet check in their tab', () => {
    const st = CASE.stages.map((s, i) => (i === 0 ? { ...s, state: 'done' } : s));
    const { el } = render({ stages: st });
    const first = el.querySelector('.pf-cse-tab[data-stage="gram"]')!;
    expect(first.querySelector('.pf-cse-tab__check')).toBeTruthy();
  });

  it('options are a compact segmented control sized to content (not full width), neutral selection', () => {
    const { el } = render();
    const opts = el.querySelectorAll('.pf-cse-opts');
    expect(opts.length).toBe(2);
    expect(opts[0].classList.contains('nd-seg')).toBe(true);
    expect(opts[0].querySelectorAll('.pf-cse-opt').length).toBe(4);
    expect(css()).toMatch(/\.pf-cse-opts[^{]*\{[^}]*display:\s*inline-flex[^}]*flex-wrap:\s*wrap[^}]*width:\s*auto/);
    expect(css()).not.toMatch(/\.pf-cse-opts[^{]*\{[^}]*(?<!-)width:\s*100%/);
  });

  it('free-text fields are kit fields at a comfortable width (~60%)', () => {
    const { el } = render();
    expect(el.querySelector('textarea.pf-cse-field')).toBeTruthy();
    expect(css()).toMatch(/\.pf-cse-field\[_ngcontent-%COMP%\]\s*\{[^}]*width:\s*60%/);
  });

  it('one tap on a row pencil opens the inline note composer', () => {
    const { f, el } = render();
    const pencil = el.querySelector<HTMLButtonElement>('.pf-cse-row .pf-cse-note')!;
    expect(pencil.getAttribute('aria-label')).toBe('Note on Pus Cells');
    pencil.click();
    f.detectChanges();
    expect(el.querySelector('.pf-stg__thread--field pf-comment-thread')).toBeTruthy();
    expect(pencil.getAttribute('aria-expanded')).toBe('true');
  });

  it('phones: rows stack (name + pencil, then the control full width); tabs span the row', () => {
    const s = css();
    const phone = s.slice(s.indexOf('max-width: 640px'));
    expect(phone).toMatch(/\.pf-cse-row[^{]*\{[^}]*grid-template-areas:\s*["']name note["']\s*["']ctl ctl["']/);
    expect(phone).toMatch(/\.pf-cse-field[^{]*\{[^}]*width:\s*100%/);
    expect(phone).toMatch(/\.pf-cse-act__i[^{]*\{[^}]*display:\s*block/);
  });
});
