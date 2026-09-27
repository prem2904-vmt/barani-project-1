import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * B (owner rule): the cart refuses an add that would put the same test in the
 * order twice — a bundle beside its own member, either way round — with a
 * toast naming both (never a silent drop). A cart that ARRIVED with such an
 * overlap (old draft) is flagged and can't be placed. C/A: the cart Total is
 * the whole-rupee payable with its round-off row (BillMath mirror).
 */
function make(tests: any[], toasts: any, perms: string[] = []) {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) };
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: stub },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: BranchLabConfigService, useValue: stub },
      { provide: ProcessWorkflowService, useValue: stub },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
      { provide: DomSanitizer, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new OrderCreateComponent()) as any;
  c._tests.set(tests);
  return c;
}


const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const T = (id: string, price: number, extra: any = {}) =>
  ({ id, name: id.toUpperCase(), type: 'individual', price, tatHours: 4, isActive: true, ...extra });
const catalog = () => [
  T('sgot', 200), T('sgpt', 200), T('tsh', 300),
  T('lft', 500, { type: 'profile', parameters: items('sgot', 'sgpt') }),
  T('pkg', 900, { type: 'package', parameters: items('lft', 'tsh') }),
];
const spyToasts = () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() });

describe('OrderCreate — duplicate items are refused, never dropped', () => {
  it('adding a member of a profile already in the cart is refused with both names', () => {
    const toasts = spyToasts();
    const c = make(catalog(), toasts);
    c._selected.set(['lft']);
    c.toggleTest(c.findTest('sgot'));
    expect(c.selected()).toEqual(['lft']);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/“SGOT” is already included in “LFT”/));
  });

  it('adding a package whose profile is already in the cart is refused', () => {
    const toasts = spyToasts();
    const c = make(catalog(), toasts);
    c._selected.set(['lft']);
    c.togglePackage(c.findTest('pkg'));
    expect(c.selected()).toEqual(['lft']);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/“LFT” is already included in “PKG”/));
  });

  it('adding a test inside a package\'s profile is refused; unrelated adds and removals still work', () => {
    const toasts = spyToasts();
    const c = make([...catalog(), T('cbc', 250)], toasts);
    c._selected.set(['pkg']);
    c.toggleTest(c.findTest('sgpt'));
    expect(c.selected()).toEqual(['pkg']);
    c.toggleTest(c.findTest('cbc'));
    expect(c.selected()).toEqual(['pkg', 'cbc']);
    c.togglePackage(c.findTest('pkg'));   // removing is never refused
    expect(c.selected()).toEqual(['cbc']);
  });

  it('a cart that arrived with an overlap is flagged and cannot be placed', () => {
    const toasts = spyToasts();
    const c = make(catalog(), toasts);
    c._selected.set(['pkg', 'tsh']);
    expect(c.cartOverlapMessages()).toEqual(['“TSH” is already included in “PKG” — the same test can\'t be ordered twice. Remove one of them.']);
    c._patient.set({ id: 'p1' });
    c.submit();
    expect(toasts.error).toHaveBeenCalledWith(c.cartOverlapMessages()[0]);
    expect(c.api.post).not.toHaveBeenCalled();
  });
});

describe('OrderCreate — round-off (BillMath mirror)', () => {
  it('₹1000 @18% − ₹295: GST 126.90, round off +0.10, Total ₹832', () => {
    const c = make([T('cbc', 1000, { taxSlab: 18 })], spyToasts(), ['override_discount']);
    c._selected.set(['cbc']);
    c.setDiscountValue('295');
    expect(c.gst()).toBe(126.9);
    expect(c.roundOff()).toBe(0.1);
    expect(c.total()).toBe(832);
  });
});
