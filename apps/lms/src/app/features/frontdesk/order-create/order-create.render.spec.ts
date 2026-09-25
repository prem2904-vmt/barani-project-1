import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/** Rendered Order & Payments: the band carries no New Patient button and the
 *  pill no scan icon or Urgent chip; Urgent is a switch in the billing card
 *  beside Include Trendogram; the Patient tile shows as required. */
const CATALOGUE = [
  { id: 't1', name: 'Haemoglobin', testCode: 'HEM011', type: 'individual', price: 10, priceIsDefault: false, tatHours: 2, isActive: true, department: { name: 'Haematology' } },
  { id: 't2', name: 'Urine Glucose', testCode: 'CLP012', type: 'individual', price: 1, priceIsDefault: true, tatHours: 24, isActive: true, department: { name: 'Clinical Pathology' } },
  { id: 'p1', name: 'Diabetes Panel', testCode: 'PRO001', type: 'profile', price: 400, priceIsDefault: false, tatHours: 8, isActive: true,
    department: { name: 'Biochemistry' }, parameters: JSON.stringify({ items: [{ testId: 't1' }, { testId: 't2' }, { testId: 'x' }] }) },
  { id: 'k1', name: 'Full Body Checkup', testCode: 'PKG001', type: 'package', price: 999, priceIsDefault: false, tatHours: 24, isActive: true,
    department: { name: 'Packages' }, parameters: JSON.stringify({ items: [{ testId: 't1' }] }) },
];

function render() {
  // lg+ desktop: the billing card is a persistent column.
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: {
        get: vi.fn((url: string) => of(url.startsWith('/api/tests/') ? CATALOGUE : url.startsWith('/api/test-picker/recent') ? ['t1', 'p1', 'k1'] : [])),
        post: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: new Map([['patientId', 'x']]) } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: FrontdeskSettingsService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'front_desk', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
}

describe('Order & Payments — rendered band, pill and billing header', () => {
  it('has no New Patient button in the band and no scan icon in the pill', () => {
    const { el } = render();
    expect(el.querySelector('[aria-label="New patient"]')).toBeNull();
    expect(el.querySelector('[aria-label^="Scan"]')).toBeNull();
    expect(el.querySelector('.pf-us__urgent')).toBeNull();
    expect(el.querySelector('.pf-us__cart')).not.toBeNull();
  });

  it('Urgent is a switch next to Include Trendogram in the billing header', () => {
    const { el, f, c } = render();
    const switches = [...el.querySelectorAll('.pf-oc-bill__head [role="switch"]')].map(b => b.textContent?.trim());
    expect(switches).toEqual(['Urgent', 'Include Trendogram']);
    const urgent = el.querySelector('.pf-oc-bill__head [role="switch"]') as HTMLButtonElement;
    urgent.click();
    f.detectChanges();
    expect(c.priority()).toBe('Urgent');
    expect(urgent.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('.pf-oc-urgent-tag')?.textContent).toContain('Urgent');
  });

  it('the Patient tile is marked required until a patient is picked', () => {
    const { el } = render();
    const tile = el.querySelectorAll('.pf-us__tile')[1];
    expect(tile.classList).toContain('pf-us__tile--req');
    expect(tile.textContent).toContain('(required)');
  });

  it('Confirm without a patient shows the inline hint under the band', async () => {
    vi.useFakeTimers();
    const { el, f } = render();
    (el.querySelector('.pf-oc-bill__foot .pf-oc-btn--primary') as HTMLButtonElement).click();
    vi.advanceTimersByTime(5);
    f.detectChanges();
    expect(el.querySelector('.pf-oc-need')?.textContent).toContain('Pick the patient');
    expect(el.querySelectorAll('.pf-us__tile')[1].classList).toContain('pf-us__tile--nudge');
    vi.useRealTimers();
  });
});

describe('Order & Payments — catalogue rows', () => {
  const rowsOf = (el: HTMLElement) => [...el.querySelectorAll('.pf-oc-cat .pf-crow')] as HTMLElement[];

  it('rows show code, name and price only: no TAT, no member count, no type badge', () => {
    const { el, f, c } = render();
    for (const tab of ['recent', 'profiles', 'packages', 'all']) {
      c.setCategoryTab(tab);
      f.detectChanges();
      const text = rowsOf(el).map(r => r.textContent ?? '').join(' | ');
      expect(rowsOf(el).length).toBeGreaterThan(0);
      expect(text).not.toMatch(/TAT/);
      expect(text).not.toMatch(/\d+ tests/);
      expect(text).not.toMatch(/PROFILE|PACKAGE|Profile|Package/);
    }
  });

  it('list rows carry no type outline hook; the type is title / aria-label text', () => {
    const { el, f, c } = render();
    c.setCategoryTab('recent');
    f.detectChanges();
    const [test, profile, pkg] = rowsOf(el);
    for (const r of [test, profile, pkg]) expect(r.hasAttribute('data-type')).toBe(false);
    const main = profile.querySelector('.pf-crow__main') as HTMLElement;
    expect(main.getAttribute('title')).toBe('Profile · Diabetes Panel');
    expect(main.getAttribute('aria-label')).toContain('Profile: Diabetes Panel');
    expect(pkg.querySelector('.pf-crow__main')!.getAttribute('title')).toBe('Package · Full Body Checkup');
    expect(test.querySelector('.pf-crow__main')!.getAttribute('title')).toBe('Haemoglobin');
  });

  it('search dropdown rows (mixed types) mark profile / package with the outline hook', () => {
    const { el, f, c } = render();
    c.onPillInput('a');
    f.detectChanges();
    const types = [...el.querySelectorAll('.pf-us__trow')].map(r => r.getAttribute('data-type'));
    expect(types).toEqual(expect.arrayContaining(['individual', 'profile', 'package']));
    expect([...el.querySelectorAll('.pf-us__trow')].map(r => r.textContent ?? '').join(' ')).not.toMatch(/PROFILE|PACKAGE/);
  });

  it('in cart = tint class + check, independent of the type outline', () => {
    const { el, f, c } = render();
    c.setCategoryTab('profiles');
    f.detectChanges();
    (rowsOf(el)[0].querySelector('.pf-crow__main') as HTMLButtonElement).click();
    f.detectChanges();
    const row = rowsOf(el)[0];
    expect(row.classList).toContain('pf-crow--in');
    expect(row.querySelector('.pf-crow__check svg')).not.toBeNull();
    expect(row.querySelector('.pf-crow__main')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('an unpriced test shows a muted price with a dot titled "Not priced yet" (also in the cart)', () => {
    const { el, f, c } = render();
    c.setCategoryTab('all');
    f.detectChanges();
    const urine = rowsOf(el).find(r => r.textContent?.includes('Urine Glucose'))!;
    const price = urine.querySelector('.pf-price') as HTMLElement;
    expect(price.classList).toContain('pf-price--unpriced');
    expect(price.getAttribute('title')).toBe('Not priced yet');
    expect(price.querySelector('.pf-price__dot')).not.toBeNull();
    expect(el.querySelector('pf-price-flag')).toBeNull();
    const hb = rowsOf(el).find(r => r.textContent?.includes('Haemoglobin'))!;
    expect(hb.querySelector('.pf-price')!.classList).not.toContain('pf-price--unpriced');
    c._selected.set(['t2']);
    f.detectChanges();
    const cartPrice = el.querySelector('.pf-cart-row .pf-price') as HTMLElement;
    expect(cartPrice.classList).toContain('pf-price--unpriced');
  });

  it('the favourite star is a sibling button, not nested in the row button', () => {
    const { el, f, c } = render();
    c.setCategoryTab('all');
    f.detectChanges();
    expect(el.querySelector('.pf-oc-cat button button')).toBeNull();
    expect(rowsOf(el)[0].querySelector(':scope > .pf-crow__star')).not.toBeNull();
  });
});
