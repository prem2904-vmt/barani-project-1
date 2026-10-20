import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { InlinePaymentPanelComponent, InlinePaymentResult } from './inline-payment-panel.component';
import { ApiService } from '../../../core/services/api.service';

/** Designer payment panel: Pay now (UPI/Card/Cash/Split) · Bill to vendor
 *  (Credit Wallet) · Pay later — same PayMode result contract as before. */
function make(amount = 500, vendors: any[] = [], visibility: any = null) {
  const api = {
    get: vi.fn((path: string) => of(path === '/api/config/billing/visibility' ? visibility : vendors)),
  };
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

  it('Bill to vendor on a ₹0 order is not confirmable (never posts a ₹0 charge)', () => {
    const vendors = [{ id: 'v1', name: 'Apollo ERD', balance: 0, outstanding: 0, isActive: true }];
    const { c } = make(0, vendors);
    c.setKind('vendor');
    c.vendorId.set('v1');
    expect(c.canConfirm()).toBe(false);
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

  it('cash input sanitizes alphabetic and special characters from input and DOM element', () => {
    const { c } = make(500);
    const input = document.createElement('input');
    input.value = '4sdaasf!@#';
    c.onCashInput({ target: input } as unknown as Event);
    expect(input.value).toBe('4');
    expect(c.cash()).toBe('4');
    expect(c.cashNum()).toBe(4);
  });

  it('split input sanitizes alphabetic and special characters and normalizes decimals', () => {
    const { c } = make(500);
    c.setMode('split');
    const input1 = document.createElement('input');
    input1.value = '2 sdfl!@#';
    c.onSplitInput('upi', { target: input1 } as unknown as Event);
    expect(input1.value).toBe('2');
    expect(c.splitAmounts()['upi']).toBe(2);

    const input2 = document.createElement('input');
    input2.value = '@@##%eafasf';
    c.onSplitInput('cash', { target: input2 } as unknown as Event);
    expect(input2.value).toBe('');
    expect(c.splitAmounts()['cash']).toBe(0);

    const input3 = document.createElement('input');
    input3.value = '250.50.75';
    c.onSplitInput('card', { target: input3 } as unknown as Event);
    expect(input3.value).toBe('250.5075');
    expect(c.splitAmounts()['card']).toBe(250.5075);
  });

  it('advance input sanitizes alphabetic and special characters', () => {
    const { c } = make(500);
    c.setKind('later');
    const input = document.createElement('input');
    input.value = '150abc!@#';
    c.onAdvanceInput({ target: input } as unknown as Event);
    expect(input.value).toBe('150');
    expect(c.advance()).toBe('150');
    expect(c.advanceNum()).toBe(150);
  });

  it('blockNonNumericKeys prevents non-numeric keys and handles decimal rules', () => {
    const { c } = make(500);
    const mockEvent = (key: string, ctrl = false) => {
      let defaultPrevented = false;
      return {
        key,
        ctrlKey: ctrl,
        metaKey: false,
        altKey: false,
        preventDefault: () => { defaultPrevented = true; },
        get isPrevented() { return defaultPrevented; },
      } as unknown as KeyboardEvent & { isPrevented: boolean };
    };

    const evDigit = mockEvent('5');
    c.blockNonNumericKeys(evDigit, false);
    expect(evDigit.isPrevented).toBe(false);

    const evAlpha = mockEvent('a');
    c.blockNonNumericKeys(evAlpha, false);
    expect(evAlpha.isPrevented).toBe(true);

    const evSpecial = mockEvent('@');
    c.blockNonNumericKeys(evSpecial, false);
    expect(evSpecial.isPrevented).toBe(true);

    const evCtrlV = mockEvent('v', true);
    c.blockNonNumericKeys(evCtrlV, false);
    expect(evCtrlV.isPrevented).toBe(false);

    const evNav = mockEvent('Backspace');
    c.blockNonNumericKeys(evNav, false);
    expect(evNav.isPrevented).toBe(false);

    const input = document.createElement('input');
    input.value = '10';
    const evDot1 = {
      key: '.',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: input,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    c.blockNonNumericKeys(evDot1, true);
    expect(evDot1.preventDefault).not.toHaveBeenCalled();

    input.value = '10.5';
    const evDot2 = {
      key: '.',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: input,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    c.blockNonNumericKeys(evDot2, true);
    expect(evDot2.preventDefault).toHaveBeenCalled();
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

describe('InlinePaymentPanel — UPI QR uses the lab payee from Admin → Billing', () => {
  it('builds the upi://pay link from the configured VPA, payee name and amount', () => {
    const { c, fixture } = make(171.5, [], { upiVpa: 'lab.counter@okaxis', upiPayeeName: 'Micro World Lab' });
    c.setMode('upi');
    fixture.detectChanges();
    const link = c.upiLink()!;
    expect(link.startsWith('upi://pay?')).toBe(true);
    const q = new URLSearchParams(link.slice('upi://pay?'.length));
    expect(q.get('pa')).toBe('lab.counter@okaxis');
    expect(q.get('pn')).toBe('Micro World Lab');
    expect(q.get('am')).toBe('171.50');
    expect(q.get('cu')).toBe('INR');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('lab.counter@okaxis');
    expect(el.textContent).not.toContain('prefrontal@upi');
    expect(el.querySelector('[data-testid="upi-missing"]')).toBeNull();
  });

  it('the link follows the amount', () => {
    const { c, fixture } = make(100, [], { upiVpa: 'lab@upi' });
    fixture.componentRef.setInput('amount', 250);
    expect(new URLSearchParams(c.upiLink()!.split('?')[1]).get('am')).toBe('250.00');
  });

  it('no VPA configured → no QR, a clear hint instead (never a placeholder payee)', () => {
    const { c, fixture } = make(300, [], { gstEnabled: true });
    c.setMode('upi');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(c.upiLink()).toBeNull();
    expect(el.querySelector('[data-testid="upi-qr"]')).toBeNull();
    expect(el.querySelector('[data-testid="upi-missing"]')).not.toBeNull();
    expect(el.textContent).not.toContain('prefrontal@upi');
  });
});
