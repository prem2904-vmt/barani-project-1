import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { TestEditorComponent } from './test-editor.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ReportLayoutService } from '../../../../core/services/report-layout.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { NavBackService } from '../../../../core/services/nav-back.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TenantStateService } from '../../../../core/services/tenant-state.service';

/**
 * (Harness copied from test-editor.package-dept.spec.ts.)
 * Test editor — NEW DESIGN (ND-PATTERN "Editors"). The band is back · tenant
 * · Save (ONE primary) with a neutral save state; the pill is the CONTEXT
 * BAR (the full test name + neutral chips); the SECTIONS rail is a tabs row;
 * the live preview is the side card, behind "Preview" on small screens.
 * Palette + font: no green / amber status classes, no monospace, no native
 * select, no emoji glyphs.
 */
const P = (parameters: any[]) => JSON.stringify({ parameters });
const OGTT = (over: any = {}) => ({
  id: 't1', tenantId: 'tn', name: 'Oral Glucose Challenge Test', type: 'individual', flow: 'direct',
  price: 1, taxSlab: 0, discount: 0, departmentId: 'd1', tatHours: 2,
  sampleType: 'Serum', tubeColor: 'grey', testCode: 'BIO005', shortName: 'OGCT', section: '',
  methodology: 'GOD-POD', resultType: 'numeric', unit: 'mg/dL', reportFormat: 'tabular',
  parameters: P([{ name: 'glucose', title: 'Glucose', type: 'numeric', unit: 'mg/dL', referenceRanges: [{ min: 70, max: 140 }] }]),
  conditions: '[]', isActive: true, createdAt: '', origin: 'master', fastingRequired: false, priceIsDefault: true,
  ...over,
});

function render(opts: { test?: any; type?: string; nd?: boolean } = {}) {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const test = opts.test ?? OGTT();
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/tenants/departments') return of([{ id: 'd1', name: 'Biochemistry' }]);
      if (url === '/api/tests/t1') return of(test);
      if (url === '/api/tests/?type=profile') return of([{ id: 'p1', name: 'Diabetes Panel', type: 'profile', testCode: 'PRO012', price: 900, tatHours: 4 }]);
      return of([]);
    }),
    patch: vi.fn(() => of({})), post: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [TestEditorComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      { provide: ReportLayoutService, useValue: {
        getDeptColumns: vi.fn(async () => ({ columns: [] })),
        getTestColumns: vi.fn(async () => ({ configured: false, columns: null })),
        getTestLayout: vi.fn(async () => ({ sections: [], configured: false })),
      } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: new Map([['id', 't1']]), queryParamMap: new Map([['type', opts.type ?? 'individual']]) } } },
      { provide: Router, useValue: { navigate: vi.fn(), url: '/admin/tests/t1/edit', events: of() } },
      { provide: NavBackService, useValue: { backTo: vi.fn(), back: vi.fn(), showBack: () => true } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => opts.nd ?? true } },
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
    ],
  });
  // The live PDF preview renders on a canvas; keep it inert in jsdom.
  TestBed.overrideComponent(TestEditorComponent, { set: { schemas: [] } });
  const f = TestBed.createComponent(TestEditorComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { f, el, c: f.componentInstance as any, api, txt };
}


/**
 * Owner 2026-09-29: a PROFILE carries its own "Tech picks what prints"
 * switch — ordered as this profile, ITS setting decides for every member.
 * Stored as `printPicker: true` in the profile blob; the bundle save (which
 * rebuilds the blob from its members) must carry it, a package never does.
 */
const PROFILE = (blob: any = {}) => OGTT({
  name: 'Diabetes Panel', type: 'profile', testCode: 'PRO012', shortName: null,
  parameters: JSON.stringify({ items: [{ testId: 'm1' }, { testId: 'm2' }], ...blob }),
});
const saved = (c: any) => JSON.parse(c.buildSaveBody(c._draft()).parametersJson);
/** The switch lives in the Members tab: render, then open it. */
const renderOpen = (opts: Parameters<typeof render>[0] = {}) => {
  const r = render(opts);
  r.c.jumpToSection('results');
  r.f.detectChanges();
  return r;
};
const toggle = (el: HTMLElement) => el.querySelector('[data-testid="profile-print-picker"]') as HTMLButtonElement | null;

describe('Test editor — profile-level print picker', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a profile shows the switch with the override hint; OFF by default', () => {
    const { el, c, txt } = renderOpen({ test: PROFILE(), type: 'profile' });
    const b = toggle(el);
    expect(b).not.toBeNull();
    expect(b!.getAttribute('aria-checked')).toBe('false');
    expect(txt(b!.closest('.pf-uf'))).toContain('Overrides the setting on each test when this profile is ordered.');
    expect(saved(c).printPicker).toBeUndefined();
  });

  it('loads ON from the stored blob and the save keeps it (with the members)', () => {
    const { el, c } = renderOpen({ test: PROFILE({ printPicker: true }), type: 'profile' });
    expect(toggle(el)!.getAttribute('aria-checked')).toBe('true');
    const blob = saved(c);
    expect(blob.printPicker).toBe(true);
    expect(blob.items.map((i: any) => i.testId)).toEqual(['m1', 'm2']);
    expect(c.dirty()).toBe(false);
  });

  it('turning it on writes printPicker:true and marks the editor dirty; off removes it', () => {
    const { el, f, c } = renderOpen({ test: PROFILE(), type: 'profile' });
    toggle(el)!.click();
    f.detectChanges();
    expect(toggle(el)!.getAttribute('aria-checked')).toBe('true');
    expect(c.dirty()).toBe(true);
    expect(saved(c).printPicker).toBe(true);
    toggle(el)!.click();
    f.detectChanges();
    expect(saved(c).printPicker).toBeUndefined();
  });

  it('a repetitive profile keeps it too', () => {
    const { c } = renderOpen({ test: PROFILE({ repetitive: true, printPicker: true }), type: 'profile' });
    const blob = saved(c);
    expect(blob.repetitive).toBe(true);
    expect(blob.printPicker).toBe(true);
  });

  it('a package has no switch and never saves the flag', () => {
    const { el, c } = renderOpen({ test: OGTT({ name: 'Wellness', type: 'package', testCode: null,
      parameters: JSON.stringify({ items: [], printPicker: true }) }), type: 'package' });
    expect(toggle(el)).toBeNull();
    expect(saved(c).printPicker).toBeUndefined();
  });

  it('a single test keeps its own switch, not the profile one', () => {
    const { el } = renderOpen();
    expect(toggle(el)).toBeNull();
  });
});

/**
 * Owner 2026-09-30: "Start with: All ticked | None ticked" next to the
 * switch — shown only while it is on, stored as `printPickerDefault: 'none'`
 * in the same wrapper (absent = all, so every existing test is unchanged).
 * The profile's value overrides its members' when ordered as the profile.
 */
describe('Test editor — print picker "Start with"', () => {
  afterEach(() => TestBed.resetTestingModule());
  const seg = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const opt = (el: HTMLElement, id: string, label: string) =>
    Array.from(seg(el, id)?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(b => b.textContent?.trim() === label)!;

  it('profile: hidden while the switch is off; picking None writes printPickerDefault:"none"; All removes it', () => {
    const { el, f, c } = renderOpen({ test: PROFILE(), type: 'profile' });
    expect(seg(el, 'profile-print-picker-default')).toBeNull();
    toggle(el)!.click(); f.detectChanges();
    expect(opt(el, 'profile-print-picker-default', 'All ticked').getAttribute('aria-checked')).toBe('true');
    expect(saved(c).printPickerDefault).toBeUndefined();
    opt(el, 'profile-print-picker-default', 'None ticked').click(); f.detectChanges();
    expect(opt(el, 'profile-print-picker-default', 'None ticked').getAttribute('aria-checked')).toBe('true');
    expect(saved(c)).toMatchObject({ printPicker: true, printPickerDefault: 'none' });
    opt(el, 'profile-print-picker-default', 'All ticked').click(); f.detectChanges();
    expect(saved(c).printPickerDefault).toBeUndefined();
  });

  it('profile: loads None from the blob; switching the picker off drops both keys', () => {
    const { el, f, c } = renderOpen({ test: PROFILE({ printPicker: true, printPickerDefault: 'none' }), type: 'profile' });
    expect(opt(el, 'profile-print-picker-default', 'None ticked').getAttribute('aria-checked')).toBe('true');
    expect(c.dirty()).toBe(false);
    toggle(el)!.click(); f.detectChanges();
    const blob = saved(c);
    expect(blob.printPicker).toBeUndefined();
    expect(blob.printPickerDefault).toBeUndefined();
  });

  it('single test: the Start-with control follows its own switch and wrapper', () => {
    const { el, f, c } = renderOpen({ test: OGTT({ parameters: JSON.stringify({ printPicker: true, parameters: [
      { name: 'glucose', title: 'Glucose', type: 'numeric', unit: 'mg/dL' }] }) }) });
    expect(opt(el, 'print-picker-default', 'All ticked').getAttribute('aria-checked')).toBe('true');
    opt(el, 'print-picker-default', 'None ticked').click(); f.detectChanges();
    expect(JSON.parse(c._draft().parametersJson).printPickerDefault).toBe('none');
    c.setPrintPickerEnabled(false); f.detectChanges();
    expect(seg(el, 'print-picker-default')).toBeNull();
    expect(JSON.parse(c._draft().parametersJson).printPickerDefault).toBeUndefined();
  });
});
