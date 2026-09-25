import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { InlinePaymentPanelComponent, InlinePaymentResult } from './inline-payment-panel.component';
import { ApiService } from '../../../core/services/api.service';

/** Designer payment panel: Pay now (UPI/Card/Cash/Split) · Bill to vendor
 *  (Credit Wallet) · Pay later — same PayMode result contract as before. */
function make(amount = 500, vendors: any[] = []) {
  const api = { get: vi.fn(() => of(vendors)) };
  TestBed.configureTestingModule({
    providers: [{ provide: ApiService, useValue: api }],
  });
  const fixture = TestBed.createComponent(InlinePaymentPanelComponent);
  fixture.componentRef.setInput('amount', amount);
  const c = fixture.componentInstance;
  const emitted: InlinePaymentResult[] = [];
  c.confirm.subscribe(r => emitted.push(r));
  return { c, fixture, api, emitted };
}

describe('InlinePaymentPanel (designer panel)', () => {
  it('defaults to Pay now · Cash and labels Confirm with the real total', () => {
    const { c } = make(171);
    expect(c.kind()).toBe('now');
    expect(c.mode()).toBe('cash');
    expect(c.confirmLabel()).toBe('Confirm ₹171.00 received');
  });

  it('card: "Confirm ₹X by card" and the reference rides the result', () => {
    const { c, emitted } = make(171);
    c.setMode('card');
    expect(c.confirmLabel()).toBe('Confirm ₹171.00 by card');
    c.refNo.set(' 12345 ');
    c.emit();
    expect(emitted[0]).toEqual({ mode: 'card', referenceNo: '12345' });
  });

  it('cash needs at least the amount; Exact fills it', () => {
    const { c, emitted } = make(500);
    expect(c.confirmDisabled()).toBe(true);
    c.setExactCash();
    expect(c.confirmDisabled()).toBe(false);
    c.addCash(100);
    expect(c.change()).toBe(100);
    c.emit();
    expect(emitted[0]).toMatchObject({ mode: 'cash', cashTendered: 600 });
  });

  it('split: one amount per method, must add up to the total', () => {
    const { c, emitted } = make(500);
    c.setMode('split');
    c.setSplitAmount('upi', '300');
    expect(c.splitOk()).toBe(false);
    c.setSplitAmount('cash', '200');
    expect(c.splitOk()).toBe(true);
    c.emit();
    expect(emitted[0]).toEqual({ mode: 'split', splitParts: [{ mode: 'upi', amount: 300 }, { mode: 'cash', amount: 200 }] });
  });

  it('Bill to vendor = the Credit Wallet; pre-selects the vendor named like the referring hospital', () => {
    const vendors = [
      { id: 'v1', name: 'Apollo ERD', balance: 0, outstanding: 100, isActive: true },
      { id: 'v2', name: 'Kauvery', balance: 0, outstanding: 0, isActive: true },
    ];
    const { c, fixture, emitted } = make(250, vendors);
    fixture.componentRef.setInput('vendorHint', 'apollo erd');
    c.setKind('vendor');
    expect(c.mode()).toBe('wallet');
    expect(c.vendorId()).toBe('v1');
    expect(c.confirmLabel()).toBe('Bill ₹250.00 to vendor');
    c.emit();
    expect(emitted[0]).toEqual({ mode: 'wallet', vendorId: 'v1' });
  });

  it('Pay later: "Place order, ₹X due"; an advance is collected with its tender', () => {
    const { c, emitted } = make(500);
    c.setKind('later');
    expect(c.confirmLabel()).toBe('Place order, ₹500.00 due');
    c.setAdvance('200');
    c.setAdvanceMode('upi');
    expect(c.confirmLabel()).toBe('Collect ₹200.00 now, ₹300.00 due');
    c.emit();
    expect(emitted[0]).toEqual({ mode: 'later', advanceAmount: 200, advanceMode: 'upi' });
  });

  it('settling a due hides Pay later (allowLater=false)', () => {
    const { c, fixture } = make(500);
    fixture.componentRef.setInput('allowLater', false);
    expect(c.kinds().map(k => k.id)).toEqual(['now', 'vendor']);
    c.setKind('later');
    expect(c.kind()).toBe('now');
  });

  it('blocked (discount over cap) disables Confirm and emit is a no-op', () => {
    const { c, fixture, emitted } = make(500);
    c.setMode('upi');
    fixture.componentRef.setInput('blocked', true);
    expect(c.confirmDisabled()).toBe(true);
    c.emit();
    expect(emitted).toEqual([]);
  });
});

describe('InlinePaymentPanel — due-settlement drawer (payment only)', () => {
  it('without externalFooter it renders its own Confirm and has no cart phase', () => {
    const { c, fixture, emitted } = make(300);
    fixture.componentRef.setInput('allowLater', false);
    c.setMode('upi');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector('.pf-ipp__confirm') as HTMLButtonElement;
    expect(btn.textContent).toContain('Confirm ₹300.00 received');
    expect(el.querySelector('.pf-oc-phase, .pf-oc-sum, .pf-crt')).toBeNull();
    btn.click();
    expect(emitted[0]).toEqual({ mode: 'upi' });
  });
});
