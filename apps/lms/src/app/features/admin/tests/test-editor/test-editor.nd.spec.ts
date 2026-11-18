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
 * Test editor — NEW DESIGN (PF-PATTERN "Editors"). The band is back · tenant
 * · Save (ONE primary) with a neutral save state; the pill is the CONTEXT
 * BAR (the full test name + neutral chips); the SECTIONS are the LEFT side
 * card (shared pf-sg-side); there is NO permanent live preview — a Preview
 * button / Alt+P opens an A4 popup that closes with focus returned.
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

describe('Test editor — new design: band + context bar', () => {
  it('band: back + ONE primary (Save) in the band actions, no title block / breadcrumb', () => {
    const { el } = render();
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
    const primaries = el.querySelectorAll('pf-hero-band .pf-hb__actions .pf-hb-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].textContent).toContain('Save');
    expect(el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary').length).toBe(1);
    expect(el.querySelector('.pf-te2-head')).toBeNull();
    expect(el.querySelector('.pf-te2-crumb')).toBeNull();
    expect(el.querySelector('h1')).toBeNull();
  });

  it('pill = ONLY the full test name (+ tiny origin badge, quiet pencil) — no tabs, no fact chips', () => {
    const { el, txt } = render();
    const ctx = el.querySelector('pf-hero-band .pf-ctx')!;
    expect(ctx).not.toBeNull();
    expect(txt(ctx.querySelector('.pf-te2-ctx__nametext'))).toBe('Oral Glucose Challenge Test');
    expect(ctx.querySelector('.pf-ctx__primary .pf-ctx__edit[aria-label="Edit name"]')).not.toBeNull();
    expect(txt(ctx.querySelector('.pf-te2-ctx__origin'))).toBe('Master');
    // Code / Dept / Sample / Price / TAT / Fasting live in the sections, not the pill.
    expect(ctx.querySelectorAll('.pf-ctx__chip').length).toBe(0);
    expect(/BIO005|Biochemistry|Fasting|TAT/.test(txt(ctx))).toBe(false);
    expect(ctx.querySelector('[role="tablist"], .pf-te2-tabs')).toBeNull();
  });

  it('the pencil opens Basics and focuses the Name field', async () => {
    const { el, f, c } = render();
    c.jumpToSection('pricing');
    f.detectChanges();
    (el.querySelector('.pf-ctx__edit') as HTMLButtonElement).click();
    f.detectChanges();
    await new Promise(r => setTimeout(r));
    expect(c.section()).toBe('identity');
    expect(document.activeElement?.classList.contains('pf-te2-name')).toBe(true);
  });

  it('save state is neutral: a violet check when saved, "Unsaved changes" after an edit (never green/amber)', () => {
    const { el, f, c, txt } = render();
    const st = () => el.querySelector('pf-hero-band .pf-savestate')!;
    expect(txt(st())).toBe('All changes saved');
    expect(st().querySelector('svg')).not.toBeNull();
    c.patch({ methodology: 'Hexokinase' });
    f.detectChanges();
    expect(txt(st())).toBe('Unsaved changes');
    expect(el.querySelector('.c-green, .c-amber')).toBeNull();
  });
});

describe('Test editor — new design: sections as tabs, cards, preview', () => {
  it('the sections are the LEFT side card (shared pf-sg-side); no tab strip anywhere', () => {
    const { el } = render();
    expect(el.querySelector('.pf-te2-nav')).toBeNull();
    expect(el.querySelector('[role="tablist"], .pf-te2-tabs')).toBeNull();
    const side = el.querySelector('aside.pf-sg-side')!;
    expect(side).not.toBeNull();
    expect(side.classList.contains('pf-card')).toBe(true);
    expect(side.querySelector('.pf-card__head .pf-card__label')!.textContent).toContain('Sections');
    const btns = side.querySelectorAll('.pf-te2-sidebtn');
    expect(Array.from(btns).map(t => t.textContent!.trim())).toEqual(
      ['Basics', 'Price & sample', 'Result entry', 'Printed report', 'Consumables']);
    expect(btns[0].getAttribute('aria-pressed')).toBe('true');
    expect(side.querySelectorAll('.pf-te2-tab__dot').length).toBe(5);
    // Side card first in the DOM (left column), then the main card.
    expect(side.nextElementSibling!.classList.contains('pf-te2-main')).toBe(true);
  });

  it('a side-card item switches the main card (pf-card with the icon-chip header)', () => {
    const { el, f } = render();
    (el.querySelector('.pf-te2-sidebtn[data-sec="pricing"]') as HTMLButtonElement).click();
    f.detectChanges();
    const card = el.querySelector('#sec-pricing')!;
    expect(card.classList.contains('pf-card')).toBe(true);
    expect(card.querySelector('.pf-card__head .pf-card__icon svg')).not.toBeNull();
    expect(card.querySelector('.pf-card__label')!.textContent).toContain('Price');
    expect(el.querySelector('.pf-te2-sidebtn[data-sec="pricing"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('phones get a section picker (pf-select) in the main column', () => {
    const { el } = render();
    expect(el.querySelector('.pf-te2-pick pf-select')).not.toBeNull();
  });

  it('Basics: kit fields, the read-only code in tabular numbers, Profiles as kit rows with a kit search', () => {
    const { el } = render();
    const code = el.querySelector<HTMLInputElement>('#sec-identity input[readonly]')!;
    expect(code.classList.contains('pf-input')).toBe(true);
    expect(code.classList.contains('pf-num')).toBe(true);
    expect(code.value).toBe('BIO005');
    const row = el.querySelector('.pf-profpanel__item')!;
    expect(row.classList.contains('pf-row')).toBe(true);
    expect(row.querySelector('.pf-row__check')).not.toBeNull();
    expect(row.querySelector('.pf-profpanel__code')!.classList.contains('pf-num')).toBe(true);
  });

  it('toggles are slate switches (role=switch), not violet checkbox pills', () => {
    const { el, f, c } = render({ test: OGTT({ departmentId: 'd1' }) });
    c.jumpToSection('results');
    f.detectChanges();
    const sw = el.querySelectorAll('#sec-results .pf-toggle[role="switch"]');
    expect(sw.length).toBeGreaterThan(0);
    expect(el.querySelector('.pf-rep-toggle')).toBeNull();
  });

  it('NO permanent live preview; Preview (button + Alt+P) opens an A4 popup, Esc closes it and returns focus', async () => {
    const { el, f, c } = render();
    expect(el.querySelector('#pf-te2-preview, .pf-livewrap, pf-report-pdf-preview')).toBeNull();
    expect(el.querySelector('pf-hero-band .pf-te2-previewbtn')).toBeNull();
    const btn = el.querySelector<HTMLButtonElement>('#sec-identity .pf-card__head .pf-te2-previewbtn')!;
    expect(btn.textContent).toContain('Preview');
    expect(btn.querySelector('svg')).not.toBeNull();
    btn.focus();
    btn.click();
    f.detectChanges();
    await new Promise(r => setTimeout(r));
    expect(c.previewOpen()).toBe(true);
    const dlg = document.querySelector('[data-testid="preview-dialog"]') ?? el.querySelector('[data-testid="preview-dialog"]');
    expect(dlg!.getAttribute('role')).toBe('dialog');
    expect(dlg!.querySelector('pf-report-pdf-preview')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(c.previewOpen()).toBe(false);
    expect(el.querySelector('[data-testid="preview-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
    // Alt+P toggles it too.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', altKey: true }));
    f.detectChanges();
    expect(c.previewOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', altKey: true }));
    f.detectChanges();
    expect(c.previewOpen()).toBe(false);
  });

  it('Profiles: selected first, removable chips, search + filter, scroll inside the list', () => {
    const { el, f, c } = render();
    const profs = [
      { id: 'p1', name: 'Diabetes Panel', type: 'profile', testCode: 'PRO012', departmentId: 'd1', parameters: JSON.stringify({ items: [] }) },
      { id: 'p2', name: 'Lipid Profile', type: 'profile', testCode: 'PRO013', departmentId: 'd1', parameters: JSON.stringify({ items: [{ testId: 't1' }] }) },
    ];
    c._allProfiles.set(profs);
    f.detectChanges();
    expect(c.visibleProfiles().map((p: any) => p.id)).toEqual(['p2', 'p1']);
    expect(el.querySelectorAll('.pf-profpanel__chips .pf-lp-chip').length).toBe(1);
    expect(el.querySelector('.pf-profpanel__count')!.textContent).toContain('1 selected');
    expect(el.querySelector('.pf-profpanel__tools input[type="search"]')).not.toBeNull();
    expect(el.querySelector('.pf-profpanel__tools pf-select')).not.toBeNull();
    c.profFilter.set('selected');
    expect(c.visibleProfiles().map((p: any) => p.id)).toEqual(['p2']);
    c.profFilter.set('all'); c.profSearch.set('diab');
    expect(c.visibleProfiles().map((p: any) => p.id)).toEqual(['p1']);
  });

  it('palette + font hygiene: no monospace / green classes, no <code>, no native select, no emoji glyphs', () => {
    const { el, f, c } = render();
    for (const sec of ['identity', 'pricing', 'results', 'layout']) {
      c.jumpToSection(sec);
      f.detectChanges();
      expect(el.querySelector('code, select, .mono, .c-green, .c-amber')).toBeNull();
      expect(/[✕↑↓⠿ƒ●]/.test(el.textContent ?? '')).toBe(false);
    }
  });
});

describe('Test editor — profile / package variants and classic', () => {
  const PROFILE = OGTT({ name: 'Diabetes Panel', type: 'profile', testCode: 'PRO012', price: 900,
    parameters: JSON.stringify({ items: [] }) });
  it('profile: the same band + name pill, "Members" section', () => {
    const { el, txt } = render({ test: PROFILE, type: 'profile' });
    expect(txt(el.querySelector('.pf-ctx__primary'))).toContain('Diabetes Panel');
    expect(el.querySelectorAll('.pf-ctx__chip').length).toBe(0);
    const tabs = Array.from(el.querySelectorAll('.pf-te2-sidebtn')).map(t => t.textContent!.trim());
    expect(tabs).toContain('Members');
    expect(el.querySelectorAll('.pf-hb-btn--primary').length).toBe(1);
  });

  it('package: "Package members" tab; the member picker is kit rows with a kit search', () => {
    const PKG = OGTT({ name: 'Wellness Package', type: 'package', testCode: '', parameters: JSON.stringify({ items: [] }) });
    const { el, f, c } = render({ test: PKG, type: 'package' });
    expect(Array.from(el.querySelectorAll('.pf-te2-sidebtn')).map(t => t.textContent!.trim())).toContain('Package members');
    c.jumpToSection('results');
    f.detectChanges();
    expect(el.querySelector('#sec-results input.pf-picker-search.pf-input')).not.toBeNull();
  });

  it('classic design keeps the old header + rail (no band)', () => {
    const { el } = render({ nd: false });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('.pf-te2-head')).not.toBeNull();
    expect(el.querySelector('.pf-te2-nav')).not.toBeNull();
  });
});
