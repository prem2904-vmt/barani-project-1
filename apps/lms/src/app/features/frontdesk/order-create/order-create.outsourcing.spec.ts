import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';
import { cartKey } from './pending-order';

/**
 * Outsourcing choice at billing (owner 2026-10-25): ONLY a line the Test
 * Master marks as outsourced gets a pf-select — "<Partner> (default)" /
 * "In-house" / every other ACTIVE partner. The pick rides the create /
 * modify request as `outsourcing` (keyed as ordered, like `specimens`), is
 * left out when untouched, and the line locks once its sample is collected
 * (it then just says where it goes).
 */
const T = (id: string, name: string, price: number, extra: any = {}) =>
  ({ id, name, type: 'individual', price, priceIsDefault: false, isActive: true, tatHours: 4, department: { name: 'Biochemistry' }, ...extra });
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const CATALOGUE = [
  T('vitd', 'Vitamin D (25-OH)', 1200, { outsourcedVendorId: 'thyro' }),
  T('b12', 'Vitamin B12', 900, { outsourcedVendorId: 'thyro' }),
  T('glu', 'Glucose Fasting', 80),
  T('vitpanel', 'Vitamin panel', 1800, { type: 'profile', parameters: items('vitd', 'b12') }),
];
const PARTNERS = [
  { id: 'thyro', name: 'Thyrocare', isActive: true },
  { id: 'metro', name: 'Metropolis', isActive: true },
  { id: 'old', name: 'Old Partner Labs', isActive: false },
];

function render() {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/tests/')) return of(CATALOGUE);
    if (url.startsWith('/api/referral-labs')) return of(PARTNERS);
    return of([]);
  });
  const post = vi.fn(() => of({ id: 'o1' }));
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: { get, post, patch: vi.fn(() => of({ order: {}, bill: null })), delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error: vi.fn(), info() {}, warning: vi.fn() } },
      { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'counter', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  const c = f.componentInstance as any;
  c._patient.set({ id: 'pA', displayName: 'Mr. Arun' });
  return { f, c, post, get, el: f.nativeElement as HTMLElement };
}
function settle(f: any) { f.detectChanges(); TestBed.flushEffects(); f.detectChanges(); TestBed.flushEffects(); f.detectChanges(); }

describe('Order desk — outsourcing choice (outsourced lines only)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('an outsourced line gets the picker; an in-house line never does', () => {
    const { f, c, el } = render();
    c._selected.set(['vitd', 'glu']);
    settle(f);
    expect(el.querySelector('[data-out-id="vitd"] pf-select')).not.toBeNull();
    expect(el.querySelector('[data-out-id="glu"]')).toBeNull();
    expect(c.isOutsourcedLine('glu')).toBe(false);
  });

  it('options: "<Partner> (default)", In-house, then the OTHER active partners (never an inactive one)', () => {
    const { f, c, get } = render();
    c._selected.set(['vitd']);
    settle(f);
    expect(get).toHaveBeenCalledWith('/api/referral-labs?includeInactive=true');
    expect(c.outsourcingOptsFor('vitd').map((o: any) => [o.value, o.label])).toEqual([
      ['', 'Thyrocare (default)'],
      ['inhouse', 'In-house'],
      ['metro', 'Metropolis'],
    ]);
  });

  it('partners load only once an outsourced line is in the cart', () => {
    const { f, c, get } = render();
    c._selected.set(['glu']);
    settle(f);
    expect(get.mock.calls.some(([u]: any[]) => String(u).startsWith('/api/referral-labs'))).toBe(false);
  });

  it('a profile of outsourced members gets the choice too (keyed by the profile, as ordered)', () => {
    const { f, c, el } = render();
    c._selected.set(['vitpanel']);
    settle(f);
    expect(el.querySelector('[data-out-id="vitpanel"]')).not.toBeNull();
    expect(c.outsourcingOptsFor('vitpanel')[0].label).toBe('Thyrocare (default)');
  });

  it('untouched → no `outsourcing` key; In-house / another partner → sent keyed as ordered', () => {
    const { f, c, post } = render();
    c._selected.set(['vitd', 'b12', 'glu']);
    settle(f);
    c.onProceedClick();
    const first = (post.mock.calls[0] as any[])[1];
    expect('outsourcing' in first).toBe(false);

    TestBed.resetTestingModule();
    const r = render();
    r.c._selected.set(['vitd', 'b12', 'glu']);
    settle(r.f);
    r.c.setOutsourcing('vitd', 'inhouse');
    r.c.setOutsourcing('b12', 'metro');
    r.c.setOutsourcing('glu', 'metro');      // not an outsourced line → never sent
    r.c.onProceedClick();
    expect(r.post).toHaveBeenCalledWith('/api/orders/', expect.objectContaining({
      outsourcing: { vitd: 'inhouse', b12: 'metro' },
    }));
  });

  it('the line says where it goes: default partner, In-house, or the picked partner', () => {
    const { f, c } = render();
    c._selected.set(['vitd']);
    settle(f);
    expect(c.outsourcingLabel('vitd')).toBe('Outsourced · Thyrocare');
    c.setOutsourcing('vitd', 'inhouse');
    expect(c.outsourcingLabel('vitd')).toBe('In-house');
    c.setOutsourcing('vitd', 'metro');
    expect(c.outsourcingLabel('vitd')).toBe('Outsourced · Metropolis');
  });

  it('edit order: the stored pick comes back; a collected line is locked and shows the server’s partner', () => {
    const { f, c, el } = render();
    const o = { id: 'o9', samples: [
      { status: 'collected', collectedAt: '2026-10-25T04:00:00Z',
        tests: [{ testId: 'vitd', status: 'pending', outsourcingOverride: 'inhouse', effectivePartnerId: null }] },
      { status: 'pending',
        tests: [{ testId: 'b12', status: 'pending', outsourcingOverride: 'metro', effectivePartnerId: 'metro' }] },
    ] };
    c.editOrderId.set('o9');
    c._selected.set(['vitd', 'b12']);
    c.extractCollectedTestIds(o);
    c.hydrateOutsourcingFrom(o);
    settle(f);
    expect(c.outsourcingOf('b12')).toBe('metro');
    expect(c.isCollected('vitd')).toBe(true);
    expect(el.querySelector('[data-out-id="vitd"]')).toBeNull();          // locked
    const metas = [...el.querySelectorAll('[data-testid="outsourcing-meta"]')].map(n => n.textContent!.trim());
    expect(metas).toEqual(['In-house']);
    expect(el.querySelector('[data-out-id="b12"] pf-select')).not.toBeNull();
    expect(c.outsourcingLabel('b12')).toBe('Outsourced · Metropolis');
  });

  it('edit Update carries the picks on PATCH /tests', () => {
    const { f, c } = render();
    const api = TestBed.inject(ApiService) as any;
    c.editOrderId.set('o9');
    c._selected.set(['vitd']);
    settle(f);
    c.setOutsourcing('vitd', 'inhouse');
    c.submit();
    const [url, body] = api.patch.mock.calls.find(([u]: any[]) => String(u).endsWith('/tests'));
    expect(url).toBe('/api/orders/o9/tests');
    expect(body.outsourcing).toEqual({ vitd: 'inhouse' });
  });

  it('cart key: unchanged without picks; a pick changes it (the pending order re-syncs)', () => {
    expect(cartKey(['a'], null)).toBe(JSON.stringify([['a'], []]));
    expect(cartKey(['a'], null, null)).toBe(cartKey(['a'], null));
    expect(cartKey(['a'], null, { a: 'inhouse' })).not.toBe(cartKey(['a'], null));
  });
});
