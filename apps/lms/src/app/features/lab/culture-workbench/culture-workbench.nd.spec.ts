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

function render(caseOver: Record<string, unknown> = {}, opts: { perms?: string[]; prompt?: string | null } = {}) {
  stubMatchMedia();
  const c = { ...CASE, ...caseOver };
  postSpy = vi.fn(() => of(c));
  const get = (url: string) => {
    if (url.includes('/stage-schema')) return of(SCHEMA);
    if (url.includes('/culture/')) return of(c);
    return of([]);
  };
  TestBed.configureTestingModule({
    imports: [CultureWorkbenchComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: postSpy, put: () => of({}), delete: () => of({}) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me', displayName: 'Admin User', tenantName: 'Micro World' }),
        hasPermission: (p: string) => (opts.perms ? opts.perms.includes(p) : true) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: DialogService, useValue: { prompt: vi.fn(() => Promise.resolve(opts.prompt ?? null)) } },
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

let postSpy: ReturnType<typeof vi.fn>;
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

  it('the band has exactly ONE primary: "Submit all results" (disabled until every stage is done)', () => {
    const { el } = render();
    const prim = el.querySelectorAll('.pf-hb__actions .pf-hb-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].textContent?.trim()).toBe('Submit all results');
    expect((prim[0] as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('.pf-cse-tech')?.classList.contains('pf-chip--static')).toBe(true);
    expect(el.querySelector('.pf-hb__actions .pf-cse-incubbtn')).toBeNull();
  });

  it('"Submit all results" enables once every stage is done and runs the case sign-out', () => {
    const done = CASE.stages.map(s => ({ ...s, state: 'done' }));
    const { el, cmp } = render({ stages: done });
    const spy = vi.spyOn(cmp, 'submitAndValidate').mockImplementation(() => {});
    const btn = el.querySelector<HTMLButtonElement>('.pf-hb__actions .pf-hb-btn--primary')!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('Inoculate & incubate lives in the nav row as a SECONDARY button', () => {
    const { el } = render();
    const btn = el.querySelector('.pf-cse-nav .pf-cse-incubgrp .pf-cse-incubbtn')!;
    expect(btn.textContent).toContain('Inoculate & incubate');
    expect(btn.classList.contains('pf-btn--secondary')).toBe(true);
    expect(btn.classList.contains('pf-hb-btn--primary')).toBe(false);
  });

  it('no green, no amber, no monospace, no spaced caps eyebrow', () => {
    const s = css();
    expect(s).not.toMatch(/#22c55e|#34d399|#fbbf24|#b45309|245,\s*158,\s*11|34,\s*197,\s*94|#22d3ee/i);
    expect(s).not.toMatch(/JetBrains|monospace/i);
    expect(s).not.toMatch(/letter-spacing:\s*\.1em/);
  });
});

describe('Culture case — stage tabs + rows', () => {
  it('no stage tabs: every stage renders as its own stacked card, in order', () => {
    const { el } = render();
    expect(el.querySelector('.pf-cse-tabs, [role="tablist"]')).toBeNull();
    const names = [...el.querySelectorAll('section.pf-stg .pf-stg__name')].map(n => n.textContent?.trim());
    expect(names).toEqual(['Gram / Direct smear', 'Growth check', 'Organism identification', 'Antibiotic sensitivity']);
  });

  it('each stage I hold has its own secondary Submit (plus Drop / Delegate)', () => {
    const held = CASE.stages.map(s => ({ ...s, state: 'picked', holderUserId: 'me' }));
    const { el } = render({ stages: held });
    const cards = el.querySelectorAll('section.pf-stg');
    expect(cards.length).toBe(4);
    cards.forEach(c => {
      const sub = c.querySelector('.pf-stg__submit')!;
      expect(sub.textContent?.trim()).toBe('Submit');
      expect(sub.classList.contains('pf-btn--secondary')).toBe(true);
    });
    expect(el.querySelectorAll('section.pf-stg .pf-btn--primary').length).toBe(0);
  });

  it('a done stage shows a violet-check "Done" chip in its header', () => {
    const st = CASE.stages.map((s, i) => (i === 0 ? { ...s, state: 'done' } : s));
    const { el } = render({ stages: st });
    expect(el.querySelector('section.pf-stg .pf-stg__state--done svg')).toBeTruthy();
  });

  it('option controls FILL the column with equal-width segments (many wrap into balanced rows)', () => {
    const { el } = render();
    const opts = el.querySelectorAll<HTMLElement>('.pf-cse-opts');
    expect(opts.length).toBe(2);
    expect(opts[0].classList.contains('pf-cse-opts--fill')).toBe(true);
    expect(opts[0].style.getPropertyValue('--n')).toBe('4');
    expect(opts[1].classList.contains('pf-cse-opts--many')).toBe(true);   // Morphology's 7
    const s = css();
    expect(s).toMatch(/\.pf-cse-opts--fill[^{]*\{[^}]*display:\s*grid[^}]*width:\s*100%[^}]*repeat\(var\(--n, 4\), minmax\(0, 1fr\)\)/);
    expect(s).toMatch(/\.pf-cse-opts--many[^{]*\{[^}]*repeat\(auto-fit, minmax\(110px, 1fr\)\)/);
  });

  it('free-text fields fill the column', () => {
    const { el } = render();
    expect(el.querySelector('textarea.pf-cse-field')).toBeTruthy();
    expect(css()).toMatch(/\.pf-cse-field\[_ngcontent-%COMP%\]\s*\{[^}]*width:\s*100%/);
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

describe('Culture case — pathologist sign-out (moved here from validate-result)', () => {
  const awaiting = { caseState: 'awaiting_signout', stages: CASE.stages.map(s => ({ ...s, state: 'done' })) };

  it('a validator on an awaiting case gets Reject (secondary) + Validate & sign out (THE primary)', () => {
    const { el } = render(awaiting, { perms: ['validate_result'] });
    const prim = el.querySelectorAll('.pf-hb__actions .pf-hb-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].textContent?.trim()).toBe('Validate & sign out');
    expect(el.querySelector('.pf-hb__actions .pf-cse-reject')?.classList.contains('pf-hb-btn--ghost')).toBe(true);
    expect(el.querySelector('.pf-cse-signout')).toBeNull();
    expect(el.querySelector('.pf-cse-incubgrp')).toBeNull();   // no bench tools while reviewing
  });

  it('no sign-out actions for a non-validator, or when the case is not awaiting sign-out', () => {
    expect(render(awaiting, { perms: ['culture_workbench'] }).el.querySelector('.pf-cse-validate')).toBeNull();
    TestBed.resetTestingModule();
    expect(render({}, { perms: ['validate_result'] }).el.querySelector('.pf-cse-validate')).toBeNull();
  });

  it('Validate calls the validation API for this order test', () => {
    const { el } = render(awaiting, { perms: ['validate_result'] });
    (el.querySelector('.pf-cse-validate') as HTMLButtonElement).click();
    expect(postSpy).toHaveBeenCalledWith('/api/validation/ot-1/validate', { note: null });
  });

  it('Reject needs a reason: cancelled prompt → no call; a reason → reject API', async () => {
    const a = render(awaiting, { perms: ['validate_result'], prompt: null });
    await a.cmp.rejectCase();
    expect(postSpy).not.toHaveBeenCalledWith(expect.stringContaining('/reject'), expect.anything());
    TestBed.resetTestingModule();
    const b = render(awaiting, { perms: ['validate_result'], prompt: 'Wrong organism' });
    await b.cmp.rejectCase();
    expect(postSpy).toHaveBeenCalledWith('/api/validation/ot-1/reject', { reason: 'Wrong organism', note: null });
  });
});
