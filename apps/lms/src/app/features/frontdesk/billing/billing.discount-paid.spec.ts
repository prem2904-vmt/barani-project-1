import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { BillingComponent } from './billing.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BillingEventsService } from '../../../core/services/billing-events.service';
import { PrinterService } from '../../../core/printer/printer.service';
import type { Bill } from '../../../shared/models/bill.model';

/**
 * D (owner rule): on a part-paid bill the counter may not discount the payable
 * below what is already paid — the server refuses it (400
 * discount_exceeds_balance). The counter shows the most it may give and blocks
 * Confirm. A: its totals carry the round-off row (payable is whole rupees).
 */
function make(bill: Bill) {
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) } },
      { provide: AuthService, useValue: { hasPermission: () => true } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: stub },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: BillingEventsService, useValue: stub },
      { provide: PrinterService, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new BillingComponent()) as any;
  c._bill.set(bill);
  return c;
}

// ₹1000 @18% → ₹1180, of which ₹1000 is already paid.
const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b', orderId: 'o', patientId: 'p', branchId: 'x', type: 'tax_invoice', isInterstate: false,
  subTotal: 1000, overrideDiscount: 0, totalDiscount: 0, totalTaxable: 1000, totalCgst: 90, totalSgst: 90, totalIgst: 0,
  totalTax: 180, totalPayable: 1180, totalPaid: 1000, balance: 180, status: 'partially_paid', createdAt: '',
  items: [{ id: 'i', billId: 'b', testId: 't', testName: 'T', price: 1000, discount: 0, taxableAmount: 1000, taxSlab: 18,
    cgstRate: 9, sgstRate: 9, igstRate: 0, cgstAmount: 90, sgstAmount: 90, igstAmount: 0, total: 1180 }],
  ...over,
} as Bill);

describe('Billing counter — discount on a part-paid bill (D)', () => {
  it('shows the most it may give (₹152.96 keeps ₹1000 payable)', () => {
    const c = make(bill());
    expect(c.maxDiscountAllowed()).toBe(152.96);
  });

  it('₹151 off → taxable 849 + GST 152.82 = 1001.82 → ₹1002 ≥ ₹1000 paid: allowed, round off +0.18', () => {
    const c = make(bill());
    c.setDiscount('151');
    expect(c.discountExceedsPaid()).toBe(false);
    expect(c.fullTotal()).toBe(1002);
    expect(c.shownRoundOff()).toBe(0.18);
  });

  it('₹200 off → ₹944 < ₹1000 paid: refused with the server\'s words and Confirm blocked', () => {
    const c = make(bill());
    c.setMode?.('cash');
    c.setDiscount('200');
    expect(c.discountExceedsPaid()).toBe(true);
    expect(c.discountExceedsPaidMessage()).toMatch(/more than the unpaid balance of ₹180/);
    expect(c.discountExceedsPaidMessage()).toMatch(/at most ₹152\.96/);
    expect(c.canConfirm()).toBe(false);
  });

  it('nothing paid → no paid-based limit', () => {
    const c = make(bill({ totalPaid: 0, balance: 1180, status: 'pending' }));
    expect(c.maxDiscountAllowed()).toBeNull();
    c.setDiscount('200');
    expect(c.discountExceedsPaid()).toBe(false);
  });
});
