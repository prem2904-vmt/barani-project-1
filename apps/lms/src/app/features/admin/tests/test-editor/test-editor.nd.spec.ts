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
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
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
    expect(el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary').length).toBe(1);
    expect(el.querySelector('.pf-te2-head')).toBeNull();
    expect(el.querySelector('.pf-te2-crumb')).toBeNull();
    expect(el.querySelector('h1')).toBeNull();
  });

  it('context bar: the FULL test name is the primary chip with a quiet pencil; neutral chips follow', () => {
    const { el, txt } = render();
    const ctx = el.querySelector('pf-hero-band .nd-ctx')!;
    expect(ctx).not.toBeNull();
    expect(txt(ctx.querySelector('.nd-ctx__primary'))).toContain('Oral Glucose Challenge Test');
    expect(ctx.querySelector('.nd-ctx__primary .nd-ctx__edit[aria-label="Edit name"]')).not.toBeNull();
    // Key + value are separate spans (the gap is CSS): read them as "K V".
    const chips = Array.from(ctx.querySelectorAll('.nd-ctx__chip')).map(ch =>
      Array.from(ch.childNodes).filter(n => n.nodeType !== 8).map(n => txt(n as Element)).filter(Boolean).join(' '));
    expect(chips).toContain('Master');
    expect(chips).toContain('Code BIO005');
    expect(chips).toContain('Dept Biochemistry');
    expect(chips.some(c => c.startsWith('Sample Serum'))).toBe(true);
    expect(chips.some(c => c.startsWith('TAT 2 hrs'))).toBe(true);
    expect(chips).toContain('Fasting No');
    // Code in Noto tabular numbers, never a mono face.
    const code = ctx.querySelector('.nd-ctx__chip[data-k="Code"] .nd-num');
    expect(code?.textContent).toBe('BIO005');
  });

  it('the unpriced price shows the ONE allowed amber mark (a dot), no pill', () => {
    const { el } = render();
    const price = el.querySelector('.nd-ctx__chip[data-k="Price"]')!;
    expect(price.querySelector('.nd-dot-unpriced')).not.toBeNull();
    TestBed.resetTestingModule();
    const priced = render({ test: OGTT({ price: 450, priceIsDefault: false }) });
    expect(priced.el.querySelector('.nd-ctx__chip[data-k="Price"] .nd-dot-unpriced')).toBeNull();
  });

  it('the pencil opens Basics and focuses the Name field', async () => {
    const { el, f, c } = render();
    c.jumpToSection('pricing');
    f.detectChanges();
    (el.querySelector('.nd-ctx__edit') as HTMLButtonElement).click();
    f.detectChanges();
    await new Promise(r => setTimeout(r));
    expect(c.section()).toBe('identity');
    expect(document.activeElement?.classList.contains('pf-te2-name')).toBe(true);
  });

  it('save state is neutral: a violet check when saved, "Unsaved changes" after an edit (never green/amber)', () => {
    const { el, f, c, txt } = render();
    const st = () => el.querySelector('pf-hero-band .nd-savestate')!;
    expect(txt(st())).toBe('All changes saved');
    expect(st().querySelector('svg')).not.toBeNull();
    c.patch({ methodology: 'Hexokinase' });
    f.detectChanges();
    expect(txt(st())).toBe('Unsaved changes');
    expect(el.querySelector('.c-green, .c-amber')).toBeNull();
  });
});

describe('Test editor — new design: sections as tabs, cards, preview', () => {
  it('the SECTIONS rail is gone; sections are a tabs row with violet/neutral dots', () => {
    const { el } = render();
    expect(el.querySelector('.pf-te2-nav')).toBeNull();
    const tabs = el.querySelectorAll('[role="tablist"].nd-tabs [role="tab"]');
    expect(Array.from(tabs).map(t => t.textContent!.trim())).toEqual(
      ['Basics', 'Price & sample', 'Result entry', 'Printed report', 'Consumables']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelectorAll('.nd-tabs__dot').length).toBe(5);
    expect(el.querySelector('.pf-te2-nav__dot--ok')).toBeNull();
  });

  it('a tab switches the focused section card (nd-card with the icon-chip header)', () => {
    const { el, f } = render();
    (el.querySelector('[role="tab"][data-sec="pricing"]') as HTMLButtonElement).click();
    f.detectChanges();
    const card = el.querySelector('#sec-pricing')!;
    expect(card.classList.contains('nd-card')).toBe(true);
    expect(card.querySelector('.nd-card__head .nd-card__icon svg')).not.toBeNull();
    expect(card.querySelector('.nd-card__label')!.textContent).toContain('Price');
    expect(el.querySelector('[role="tab"][data-sec="pricing"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('Basics: kit fields, the read-only code in tabular numbers, Profiles as kit rows with a kit search', () => {
    const { el } = render();
    const code = el.querySelector<HTMLInputElement>('#sec-identity input[readonly]')!;
    expect(code.classList.contains('nd-input')).toBe(true);
    expect(code.classList.contains('nd-num')).toBe(true);
    expect(code.value).toBe('BIO005');
    const row = el.querySelector('.pf-profpanel__item')!;
    expect(row.classList.contains('nd-row')).toBe(true);
    expect(row.querySelector('.nd-row__check')).not.toBeNull();
    expect(row.querySelector('.pf-profpanel__code')!.classList.contains('nd-num')).toBe(true);
  });

  it('toggles are slate switches (role=switch), not violet checkbox pills', () => {
    const { el, f, c } = render({ test: OGTT({ departmentId: 'd1' }) });
    c.jumpToSection('results');
    f.detectChanges();
    const sw = el.querySelectorAll('#sec-results .nd-toggle[role="switch"]');
    expect(sw.length).toBeGreaterThan(0);
    expect(el.querySelector('.pf-rep-toggle')).toBeNull();
  });

  it('LIVE PREVIEW is the side card; on small screens it opens behind "Preview" and Esc closes it', () => {
    const { el, f, c } = render();
    const aside = () => el.querySelector('#pf-te2-preview')!;
    expect(aside().querySelector('.nd-card .nd-card__label')!.textContent).toContain('Live preview');
    const btn = el.querySelector<HTMLButtonElement>('.pf-te2-previewbtn')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    f.detectChanges();
    expect(aside().classList.contains('pf-te2-aside--open')).toBe(true);
    expect(el.querySelector('.pf-te2-previewscrim')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(c.previewOpen()).toBe(false);
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
  it('profile: the same band + context bar, no Sample / Fasting chips, "Members" tab', () => {
    const { el, txt } = render({ test: PROFILE, type: 'profile' });
    expect(txt(el.querySelector('.nd-ctx__primary'))).toContain('Diabetes Panel');
    const keys = Array.from(el.querySelectorAll('.nd-ctx__chip .nd-ctx__k')).map(txt);
    expect(keys).not.toContain('Sample');
    expect(keys).not.toContain('Fasting');
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map(t => t.textContent!.trim());
    expect(tabs).toContain('Members');
    expect(el.querySelectorAll('.pf-hb-btn--primary').length).toBe(1);
  });

  it('package: "Package members" tab; the member picker is kit rows with a kit search', () => {
    const PKG = OGTT({ name: 'Wellness Package', type: 'package', testCode: '', parameters: JSON.stringify({ items: [] }) });
    const { el, f, c } = render({ test: PKG, type: 'package' });
    expect(Array.from(el.querySelectorAll('[role="tab"]')).map(t => t.textContent!.trim())).toContain('Package members');
    c.jumpToSection('results');
    f.detectChanges();
    expect(el.querySelector('#sec-results input.pf-picker-search.nd-input')).not.toBeNull();
  });

  it('classic design keeps the old header + rail (no band)', () => {
    const { el } = render({ nd: false });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('.pf-te2-head')).not.toBeNull();
    expect(el.querySelector('.pf-te2-nav')).not.toBeNull();
  });
});
