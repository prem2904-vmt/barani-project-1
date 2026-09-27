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
 * (Harness copied from test-editor.nd.spec.ts.)
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
 * Owner 2026-09-27: "we don't need a department mentioned for a package".
 * A package has no Department field, no Dept chip, is never blocked on a
 * department and never sends one; tests and profiles keep all of it.
 */
const PKG = (over: any = {}) => OGTT({
  name: 'Wellness Basic', type: 'package', testCode: null, shortName: null,
  departmentId: 'd1', // a LEGACY stored department — must be ignored
  parameters: JSON.stringify({ items: [] }), ...over,
});
const deptField = (el: HTMLElement) => el.querySelector('[data-field="department"]');

describe('Test editor — a package carries no department', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('package: no Department field, no Dept chip, Basics says members keep theirs', () => {
    const { el, c, txt } = render({ test: PKG(), type: 'package' });
    expect(deptField(el)).toBeNull();
    expect(c.metaChips().some((x: any) => x.k === 'Dept')).toBe(false);
    expect(txt(el.querySelector('#sec-identity .pf-te2-sec__sub'))).toContain('Its members keep their own departments');
  });

  it('package: the identity checklist passes without a department', () => {
    const { c } = render({ test: PKG({ departmentId: null }), type: 'package' });
    const id = c.publishChecklist().find((r: any) => r.label === 'Identity & pricing');
    expect(id.ok).toBe(true);
  });

  it('package: the save payload never carries a department (even a legacy one)', () => {
    const { c } = render({ test: PKG(), type: 'package' });
    const body = c.buildSaveBody(c._draft());
    expect(body.type).toBe('package');
    expect(body.departmentId).toBeUndefined();
  });

  it('single test: the Department field, chip and requirement stay', () => {
    const { el, c } = render();
    expect(deptField(el)).not.toBeNull();
    expect(c.metaChips().find((x: any) => x.k === 'Dept')?.v).toBe('Biochemistry');
    const idOk = () => c.publishChecklist().find((r: any) => r.label === 'Identity & pricing').ok;
    expect(idOk()).toBe(true);
    c.patch({ departmentId: '' });
    expect(idOk()).toBe(false);
  });

  it('profile: the Department field and chip stay', () => {
    const { el, c } = render({
      test: OGTT({ type: 'profile', name: 'Diabetes Panel', parameters: JSON.stringify({ items: [] }) }),
      type: 'profile',
    });
    expect(deptField(el)).not.toBeNull();
    expect(c.metaChips().some((x: any) => x.k === 'Dept')).toBe(true);
  });

  it('switching a test to package hides the field; back to a test shows it', () => {
    const { f, el, c } = render();
    c.patch({ type: 'package' });
    f.detectChanges();
    expect(deptField(el)).toBeNull();
    c.patch({ type: 'individual' });
    f.detectChanges();
    expect(deptField(el)).not.toBeNull();
  });
});
