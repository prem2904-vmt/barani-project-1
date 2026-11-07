import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { OrderPartnerPicksComponent } from './order-partner-picks.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * OPS-106: the billing screens (order screen pay step, billing counter) show the
 * order screen's per-line partner choice for outsourced lines that are not yet
 * collected / paid, saving through PATCH orders/{id}/tests (+ `outsourcing`).
 */
const TESTS = [
  { id: 'tsh', name: 'TSH', type: 'individual', outsourcedVendorId: 'v1' },
  { id: 'cbc', name: 'CBC', type: 'individual' },
];
const LABS = [{ id: 'v1', name: 'Metro Labs', isActive: true }, { id: 'v2', name: 'Quest Partner', isActive: true }];
const line = (testId: string, over: any = {}) => ({ testId, status: 'pending', test: { id: testId, name: testId.toUpperCase() }, ...over });
const ORDER: any = { id: 'o1', samples: [{ status: 'pending', tests: [line('tsh'), line('cbc')] }] };

function make(opts: { perms?: boolean; patch?: any; order?: any; locked?: boolean; tests?: any } = {}) {
  const patch = opts.patch ?? vi.fn(() => of({ order: ORDER, bill: { id: 'b2', totalPayable: 500 } }));
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/referral-labs') ? LABS : url.startsWith('/api/orders/') ? (opts.order ?? ORDER) : TESTS)),
    patch,
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info() {}, warning() {} };
  TestBed.configureTestingModule({
    imports: [OrderPartnerPicksComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { hasPermission: (p: string) => opts.perms !== false || p !== 'modify_order' } },
      { provide: ToastService, useValue: toasts },
    ],
  });
  const f = TestBed.createComponent(OrderPartnerPicksComponent);
  f.componentRef.setInput('order', opts.order ?? ORDER);
  if (opts.locked) f.componentRef.setInput('locked', true);
  if (opts.tests !== null) f.componentRef.setInput('tests', opts.tests ?? TESTS);
  f.detectChanges();
  const changed = vi.fn();
  f.componentInstance.changed.subscribe(changed);
  return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement, api, patch, toasts, changed };
}

describe('Order partner picks (OPS-106)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists only the outsourced line, with a pf-select (order screen options) and the partner names loaded', () => {
    const { c, el, api } = make();
    expect(api.get).toHaveBeenCalledWith('/api/referral-labs?includeInactive=true');
    expect(c.lines().map((r: any) => r.id)).toEqual(['tsh']);
    expect(c.lines()[0].options.map((o: any) => o.label)).toEqual(['Metro Labs (default)', 'In-house', 'Quest Partner']);
    expect(el.querySelector('[data-out-id="tsh"] pf-select')).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();
  });

  it('loads the catalogue itself when the host has none', () => {
    const { c, api } = make({ tests: null });
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/api/tests'));
    expect(c.lines().map((r: any) => r.id)).toEqual(['tsh']);
  });

  it('a pick PATCHes the ordered ids + one outsourcing entry, re-reads the order and emits it with the rebuilt bill', async () => {
    const { c, api, patch, toasts, changed } = make();
    await c.change(c.lines()[0], 'v2');
    expect(patch).toHaveBeenCalledWith('/api/orders/o1/tests',
      { testIds: ['tsh', 'cbc'], outsourcing: { tsh: 'v2' }, reason: 'billing partner change' });
    expect(api.get).toHaveBeenCalledWith('/api/orders/o1');
    expect(changed).toHaveBeenCalledWith({ order: ORDER, bill: { id: 'b2', totalPayable: 500 } });
    expect(toasts.success).toHaveBeenCalled();
  });

  it('"Test Master default" sends an empty pick; choosing the current value sends nothing', async () => {
    const o = { id: 'o1', samples: [{ status: 'pending', tests: [line('tsh', { outsourcingOverride: 'v2', effectivePartnerId: 'v2' }), line('cbc')] }] };
    const { c, patch } = make({ order: o });
    const row = c.lines()[0];
    expect(row.pick).toBe('v2');
    await c.change(row, 'v2');
    expect(patch).not.toHaveBeenCalled();
    await c.change(row, '');
    expect((patch.mock.calls[0] as any[])[1].outsourcing).toEqual({ tsh: '' });
  });

  it('a refusal shows the server words and still re-reads the order (it may have moved on)', async () => {
    const patch = vi.fn(() => throwError(() => ({ error: { success: false, error: 'outsourcing_locked', message: 'TSH already has results.' }, status: 409 })));
    const { c, toasts, changed } = make({ patch });
    await c.change(c.lines()[0], 'v2');
    expect(toasts.error).toHaveBeenCalled();
    expect(changed).toHaveBeenCalledWith({ order: ORDER, bill: null });
  });

  it('collected / settled / no modify_order: read-only text, no picker', () => {
    const drawn = { id: 'o1', samples: [{ status: 'collected', tests: [line('tsh', { effectivePartnerId: 'v1' }), line('cbc')] }] };
    const a = make({ order: drawn });
    expect(a.el.querySelector('[data-out-id="tsh"] pf-select')).toBeNull();
    expect(a.el.querySelector('[data-testid="outsourcing-meta"]')?.textContent).toContain('Outsourced · Metro Labs');
    TestBed.resetTestingModule();
    const b = make({ locked: true });
    expect(b.el.querySelector('pf-select')).toBeNull();
    TestBed.resetTestingModule();
    const c = make({ perms: false });
    expect(c.el.querySelector('pf-select')).toBeNull();
    expect(c.el.querySelector('[data-testid="outsourcing-meta"]')).not.toBeNull();
  });

  it('an in-house order renders nothing', () => {
    const o = { id: 'o2', samples: [{ status: 'pending', tests: [line('cbc')] }] };
    expect(make({ order: o }).el.querySelector('[data-order-partner-picks]')).toBeNull();
  });

  it('both billing screens host it (order screen pay step + billing counter); the unused pf-billing component is not the place', () => {
    const root = resolve(process.cwd(), 'apps/lms/src/app/features');
    for (const f of ['frontdesk/order-create/order-create.component.html', 'billing-counter/billing-counter.component.html']) {
      expect(readFileSync(resolve(root, f), 'utf8'), f).toContain('<pf-order-partner-picks');
    }
  });
});
