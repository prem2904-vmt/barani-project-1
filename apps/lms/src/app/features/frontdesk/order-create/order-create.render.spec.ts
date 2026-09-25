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

function render(opts: { web?: boolean; lg?: boolean } = {}) {
  // lg+ desktop: the billing card is a persistent column. `web` = a mouse +
  // hover device (dropdown search); false = touch (results in the card).
  const web = opts.web ?? true;
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover') ? web : q.includes('min-width: 1024px') ? (opts.lg ?? true) : true,
    addEventListener() {}, removeEventListener() {} });
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
    expect(el.querySelector('.pf-us__cart')).toBeNull();
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

  it('Continue to payment without a patient shows the inline hint under the band', async () => {
    vi.useFakeTimers();
    const { el, f, c } = render();
    c._selected.set(['t1']);
    f.detectChanges();
    const cont = [...el.querySelectorAll('.pf-oc-bill__foot button')].find(b => b.textContent?.includes('Continue to payment')) as HTMLButtonElement;
    cont.click();
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
    c.onPillInput('01');
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
    const cartPrice = el.querySelector('.pf-crt .pf-price') as HTMLElement;
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

describe('Order & Payments — two-phase billing card', () => {
  const footButtons = (el: HTMLElement) => [...el.querySelectorAll('.pf-oc-bill__foot button')] as HTMLButtonElement[];
  const cont = (el: HTMLElement) => footButtons(el).find(b => b.textContent?.includes('Continue to payment'));

  it('opens on the CART phase: list + Total + Continue (disabled while empty), no payment section', () => {
    const { el } = render();
    expect(el.querySelector('.pf-oc-phase')!.getAttribute('data-phase')).toBe('cart');
    expect(el.querySelector('.pf-oc-foot-total')?.textContent).toContain('Total');
    expect(cont(el)?.disabled).toBe(true);
    expect(footButtons(el).some(b => b.textContent?.includes('Save as draft'))).toBe(true);
    expect(el.querySelector('pf-inline-payment-panel')).toBeNull();
    expect(el.querySelector('.pf-cart-disc')).toBeNull();
  });

  it('Continue (with a patient) goes to PAYMENT; the summary line returns to the cart', () => {
    const { el, f, c } = render();
    c._patient.set({ id: 'x', displayName: 'Ms. Sansa Stark' });
    c._selected.set(['t1', 't2']);
    f.detectChanges();
    expect(cont(el)?.disabled).toBe(false);
    cont(el)!.click();
    f.detectChanges();
    expect(el.querySelector('.pf-oc-phase')!.getAttribute('data-phase')).toBe('pay');
    expect(el.querySelector('.pf-oc-sum')?.textContent).toContain('2 tests');
    expect(el.querySelector('pf-inline-payment-panel')).not.toBeNull();
    (el.querySelector('.pf-oc-sum') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-oc-phase')!.getAttribute('data-phase')).toBe('cart');
  });
});

describe('Order & Payments — search focus mode', () => {
  const scrim = (el: HTMLElement) => el.querySelector('.pf-oc-scrim') as HTMLElement;

  it('the scrim and the lifted pill appear only while the dropdown is open', () => {
    const { el, f, c } = render();
    expect(scrim(el).classList).not.toContain('pf-oc-scrim--on');
    c.onPillInput('glu');
    f.detectChanges();
    expect(scrim(el).classList).toContain('pf-oc-scrim--on');
    expect(el.querySelector('pf-hero-band')!.classList).toContain('pf-oc-band--focus');
    expect(el.querySelectorAll('.pf-us__filters pf-segmented button').length).toBe(4);
    expect(el.querySelectorAll('.pf-us__filters .pf-us__chip').length).toBeGreaterThan(1);
  });

  it('a scrim click closes the dropdown immediately (CSS-only fade, no JS delay)', () => {
    const { el, f, c } = render();
    c.onPillInput('glu');
    f.detectChanges();
    scrim(el).click();
    f.detectChanges();
    expect(c.dropOpen()).toBe(false);
    expect(el.querySelector('#pf-us-drop')).toBeNull();
    expect(scrim(el).classList).not.toContain('pf-oc-scrim--on');
  });

  it('Esc (from the input or a filter chip) closes it', () => {
    const { el, f, c } = render();
    c.onPillInput('glu');
    f.detectChanges();
    const chip = el.querySelector('.pf-us__filters button') as HTMLElement;
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(c.dropOpen()).toBe(false);
    c.onPillInput('glu');
    f.detectChanges();
    (el.querySelector('.pf-us__input') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(c.dropOpen()).toBe(false);
  });

  it('a filter chip narrows the rendered results', () => {
    const { el, f, c } = render();
    c.onPillInput('01');
    f.detectChanges();
    const all = el.querySelectorAll('.pf-us__trow').length;
    const profilesSeg = [...el.querySelectorAll('.pf-us__filters pf-segmented button')].find(b => b.textContent?.includes('Profiles')) as HTMLButtonElement;
    profilesSeg.click();
    f.detectChanges();
    const rows = [...el.querySelectorAll('.pf-us__trow')];
    expect(rows.length).toBeLessThan(all);
    expect(rows.every(r => r.getAttribute('data-type') === 'profile')).toBe(true);
    const dept = [...el.querySelectorAll('.pf-us__filters .pf-us__chip')].find(b => b.getAttribute('title') === 'Biochemistry') as HTMLButtonElement;
    dept.click();
    f.detectChanges();
    expect(dept.getAttribute('aria-pressed')).toBe('true');
    expect([...el.querySelectorAll('.pf-us__trow')].every(r => r.textContent?.includes('Diabetes'))).toBe(true);
  });
});

describe('Order & Payments — dropdown rows and filter row', () => {
  it('rows show check, code, name, price (no TAT); one filter row with no "All" dept chip', () => {
    const { el, f, c } = render();
    c.onPillInput('01');
    f.detectChanges();
    const text = [...el.querySelectorAll('.pf-us__trow')].map(r => r.textContent ?? '').join(' ');
    expect(el.querySelectorAll('.pf-us__trow').length).toBe(4);
    expect(text).not.toMatch(/TAT/);
    expect(el.querySelectorAll('.pf-us__filters').length).toBe(1);
    const deptLabels = [...el.querySelectorAll('.pf-us__filters .pf-us__chip')].map(b => b.textContent?.trim() ?? '');
    expect(deptLabels.some(l => /^All/.test(l))).toBe(false);
  });
});

describe('Order & Payments — dropdown is one result per row', () => {
  it('single column list, full names without truncation classes, department shown', () => {
    const { el, f, c } = render();
    c.onPillInput('01');
    f.detectChanges();
    expect(el.querySelector('.pf-us__tgrid')).toBeNull();
    const list = el.querySelector('.pf-us__tlist') as HTMLElement;
    expect(list).not.toBeNull();
    const rows = [...list.querySelectorAll(':scope > .pf-us__trow')];
    expect(rows.length).toBe(4);
    const names = rows.map(r => r.querySelector('.pf-us__tname') as HTMLElement);
    for (const n of names) {
      expect(n.className).not.toMatch(/truncate|ellipsis|clamp/);
      expect(n.getAttribute('title')).toBeNull();
    }
    expect(names.map(n => n.textContent?.trim())).toContain('Full Body Checkup');
    const hb = rows.find(r => r.textContent?.includes('Haemoglobin'))!;
    expect(hb.querySelector('.pf-us__tdept')?.textContent?.trim()).toBe('Haematology');
    expect(hb.querySelector('.pf-us__tprice .pf-price')).not.toBeNull();
  });

  it('↑↓ moves one row in list order', () => {
    const { el, f, c } = render();
    c.onPillInput('01');
    f.detectChanges();
    const order = [...el.querySelectorAll('.pf-us__tlist .pf-us__trow')].map(r => r.getAttribute('data-search-row'));
    expect(c.activeTestId()).toBe(order[0]);
    c.onPillArrow(new Event('keydown'), 1);
    expect(c.activeTestId()).toBe(order[1]);
    c.onPillArrow(new Event('keydown'), 1);
    expect(c.activeTestId()).toBe(order[2]);
  });
});

describe('Order & Payments — one search mode per device', () => {
  it('web: the catalogue card does not change at all while the dropdown is open', () => {
    const { el, f, c } = render({ web: true });
    c.setCategoryTab('all');
    f.detectChanges();
    const cat = el.querySelector('.pf-oc-cat') as HTMLElement;
    const before = cat.innerHTML;
    c.onPillInput('01');
    f.detectChanges();
    expect(el.querySelector('#pf-us-drop')).not.toBeNull();
    expect(cat.innerHTML).toBe(before);
    expect(el.querySelector('.pf-oc-cat__results')).toBeNull();
  });

  it('touch: no dropdown; the card becomes the results (header, filters, rows)', () => {
    const { el, f, c } = render({ web: false });
    c.onPillInput('01');
    f.detectChanges();
    expect(el.querySelector('#pf-us-drop')).toBeNull();
    expect(el.querySelector('.pf-oc-cat .pf-tabs')).toBeNull();
    expect(el.querySelector('.pf-oc-res__title')?.textContent).toContain('4 results for “01”');
    expect(el.querySelector('.pf-oc-cat__results .pf-us__filters')).not.toBeNull();
    const rows = el.querySelectorAll('.pf-oc-cat .pf-us__tlist .pf-us__trow');
    expect(rows.length).toBe(4);
    expect(rows[0].querySelector('.pf-us__tname')).not.toBeNull();
    expect(el.querySelector('.pf-oc-bill')!.classList).toContain('pf-oc-bill--recede');
    expect(el.querySelector('.pf-us__cancel')?.textContent?.trim()).toBe('Cancel');
    (el.querySelector('.pf-us__cancel') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-oc-cat .pf-tabs')).not.toBeNull();
    expect(el.querySelector('.pf-oc-cat__results')).toBeNull();
  });

  it('switching device mode at runtime swaps dropdown ↔ in-card', () => {
    const { el, f, c } = render({ web: true });
    c.onPillInput('01');
    f.detectChanges();
    expect(el.querySelector('#pf-us-drop')).not.toBeNull();
    c._onWebChange({ matches: false });
    f.detectChanges();
    expect(el.querySelector('#pf-us-drop')).toBeNull();
    expect(el.querySelector('.pf-oc-cat__results')).not.toBeNull();
  });
});

describe('Order & Payments — standard pill + animation hooks', () => {
  it('at rest the pill is the stock band search (no activation class, no inline styling)', () => {
    const { el, f, c } = render();
    const band = el.querySelector('pf-hero-band') as HTMLElement;
    expect(band.classList).not.toContain('pf-oc-band--focus');
    const search = band.querySelector('.pf-hb__search') as HTMLElement;
    expect(search).not.toBeNull();
    expect(search.getAttribute('style')).toBeNull();
    expect(search.querySelector('.pf-us__input')).not.toBeNull();
    c.onPillFocus();
    f.detectChanges();
    expect(band.classList).toContain('pf-oc-band--focus');
  });

  it('billing phases carry the sheet-rise / cart-drop animation classes', () => {
    const { el, f, c } = render();
    c._patient.set({ id: 'x', displayName: 'P' });
    c._selected.set(['t1']);
    f.detectChanges();
    expect(el.querySelector('.pf-oc-phase')!.classList).toContain('pf-oc-phase--cart');
    c.continueToPayment();
    f.detectChanges();
    const pay = el.querySelector('.pf-oc-phase')!;
    expect(pay.classList).toContain('pf-oc-phase--pay');
    expect(pay.classList).toContain('pf-oc-phase--rise');
  });

  it('dropdown rows carry a stagger index', () => {
    const { el, f, c } = render();
    c.onPillInput('01');
    f.detectChanges();
    const rows = [...el.querySelectorAll('#pf-us-drop .pf-us__trow')] as HTMLElement[];
    expect(rows.map(r => r.style.getPropertyValue('--pf-i'))).toEqual(['0', '1', '2', '3']);
  });
});

describe('Order & Payments — primary only for the main CTA; phone scope; sheet', () => {
  it('no cart icon anywhere in the search pill', () => {
    const { el } = render();
    const pill = el.querySelector('pf-hero-band .pf-hb__search') as HTMLElement;
    expect(pill.querySelector('.pf-us__cart, [aria-label^="Cart"]')).toBeNull();
  });

  it('the pill holds the four scope buttons on every width (no separate phone picker)', () => {
    const { el } = render({ web: false, lg: false });
    const btns = [...el.querySelectorAll('.pf-us__tiles .pf-us__tile-btn')] as HTMLButtonElement[];
    expect(btns.length).toBe(4);
    for (const b of btns) expect(b.getAttribute('aria-label')).toBeTruthy();
    expect(el.querySelector('.pf-us__compact, .pf-us__compact-btn, .pf-us__menu')).toBeNull();
  });

  it('a filled scope carries the phone dot; the active one is the tinted tile', () => {
    const { el, f, c } = render();
    c.pickRefDoctor('Dr. R. Iyer');
    f.detectChanges();
    const tiles = [...el.querySelectorAll('.pf-us__tile')];
    expect(tiles[2].querySelector('.pf-us__filled-dot')).not.toBeNull();
    expect(tiles[3].querySelector('.pf-us__filled-dot')).toBeNull();
    expect(tiles[0].classList).toContain('pf-us__tile--on');
  });

  it('Urgent and Include Trendogram are neutral toggles (not primary)', () => {
    const { el, f, c } = render();
    const toggles = [...el.querySelectorAll('.pf-oc-bill__head [role="switch"]')];
    expect(toggles.length).toBe(2);
    for (const t of toggles) expect(t.classList).toContain('pf-toggle-neutral');
    c.toggleUrgent();
    f.detectChanges();
    const urgent = toggles[0];
    expect(urgent.getAttribute('aria-checked')).toBe('true');
    expect(urgent.classList).toContain('pf-toggle-neutral');
    expect(urgent.classList).toContain('pf-oc-switch--urgent');
  });

  it('discount unit and department chips use state attributes, not the primary "--on" class', () => {
    const { el, f, c } = render();
    c._patient.set({ id: 'x', displayName: 'P' });
    c._selected.set(['t1']);
    c.continueToPayment();
    f.detectChanges();
    expect(el.querySelector('.pf-cart-disc__kind--on, .pf-deptpill--on')).toBeNull();
    expect(el.querySelector('.pf-cart-disc__kind [aria-checked="true"]')).not.toBeNull();
    expect(el.querySelector('.pf-deptpill[aria-pressed="true"]')).not.toBeNull();
  });

  it('phone checkout sheet is the tall variant with a grab handle; rows have no native tooltip on touch', () => {
    const { el, f, c } = render({ web: false, lg: false });
    c._selected.set(['t1']);
    c.toggleCart();
    f.detectChanges();
    const sheet = el.querySelector('.pf-cart-drawer') as HTMLElement;
    expect(sheet.classList).toContain('pf-cart-drawer--tall');
    expect(sheet.querySelector('.pf-sheet-handle')).not.toBeNull();
    const row = sheet.querySelector('.pf-crt') as HTMLElement;
    expect(row.getAttribute('title')).toBeNull();
    expect(row.classList).toContain('pf-crt--wrap');
  });
});
