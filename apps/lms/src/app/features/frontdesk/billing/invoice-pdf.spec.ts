import { STAFF_ORDER_QR_ENABLED, buildCashBillModel, invoiceTemplateFieldsFrom } from './invoice-pdf';
import type { Bill } from '../../../shared/models/bill.model';
import { readFileSync } from 'node:fs';

describe('invoiceTemplateFieldsFrom', () => {
  it('returns empty object when template is null', () => {
    expect(invoiceTemplateFieldsFrom(null)).toEqual({});
  });

  it('returns empty object when template is undefined', () => {
    expect(invoiceTemplateFieldsFrom(undefined)).toEqual({});
  });

  it('returns defaults when template is an empty object', () => {
    expect(invoiceTemplateFieldsFrom({})).toEqual({
      template: 'classic',
      paperSize: 'a4',
      accentColor: undefined,
      tagline: undefined,
      footerText: undefined,
      bankDetails: undefined,
      signatureLabel: undefined,
      jurisdiction: undefined,
      declaration: undefined,
    });
  });

  it('uses classic template style as default for falsy template value', () => {
    const result = invoiceTemplateFieldsFrom({ template: '' });
    expect(result.template).toBe('classic');
  });

  it('uses a4 paper size as default for falsy paperSize value', () => {
    const result = invoiceTemplateFieldsFrom({ paperSize: '' });
    expect(result.paperSize).toBe('a4');
  });

  it('passes through valid template style', () => {
    expect(invoiceTemplateFieldsFrom({ template: 'modern' }).template).toBe('modern');
    expect(invoiceTemplateFieldsFrom({ template: 'letterhead' }).template).toBe('letterhead');
    expect(invoiceTemplateFieldsFrom({ template: 'cashbill' }).template).toBe('cashbill');
    expect(invoiceTemplateFieldsFrom({ template: 'classic' }).template).toBe('classic');
  });

  it('passes through valid paperSize values', () => {
    expect(invoiceTemplateFieldsFrom({ paperSize: 'thermal' }).paperSize).toBe('thermal');
    expect(invoiceTemplateFieldsFrom({ paperSize: 'a4' }).paperSize).toBe('a4');
  });

  it('passes through accentColor when provided as a string', () => {
    expect(invoiceTemplateFieldsFrom({ accentColor: '#FF0000' }).accentColor).toBe('#FF0000');
    expect(invoiceTemplateFieldsFrom({ accentColor: 'rgb(255,0,0)' }).accentColor).toBe('rgb(255,0,0)');
  });

  it('returns undefined for accentColor when empty string', () => {
    expect(invoiceTemplateFieldsFrom({ accentColor: '' }).accentColor).toBeUndefined();
  });

  it('passes through tagline when provided', () => {
    expect(invoiceTemplateFieldsFrom({ tagline: 'Your Lab Logo Here' }).tagline).toBe('Your Lab Logo Here');
  });

  it('returns undefined for tagline when empty string', () => {
    expect(invoiceTemplateFieldsFrom({ tagline: '' }).tagline).toBeUndefined();
  });

  it('passes through footerText when provided', () => {
    expect(invoiceTemplateFieldsFrom({ footerText: 'Terms and Conditions' }).footerText).toBe('Terms and Conditions');
  });

  it('returns undefined for footerText when empty string', () => {
    expect(invoiceTemplateFieldsFrom({ footerText: '' }).footerText).toBeUndefined();
  });

  it('passes through bankDetails when provided', () => {
    expect(invoiceTemplateFieldsFrom({ bankDetails: 'Bank: HDFC, Account: 12345' }).bankDetails).toBe('Bank: HDFC, Account: 12345');
  });

  it('returns undefined for bankDetails when empty string', () => {
    expect(invoiceTemplateFieldsFrom({ bankDetails: '' }).bankDetails).toBeUndefined();
  });

  it('passes through signatureLabel when provided', () => {
    expect(invoiceTemplateFieldsFrom({ signatureLabel: 'Manager Signature' }).signatureLabel).toBe('Manager Signature');
  });

  it('returns undefined for signatureLabel when empty string', () => {
    expect(invoiceTemplateFieldsFrom({ signatureLabel: '' }).signatureLabel).toBeUndefined();
  });

  it('passes through jurisdiction when provided', () => {
    expect(invoiceTemplateFieldsFrom({ jurisdiction: 'Mumbai' }).jurisdiction).toBe('Mumbai');
  });

  it('returns undefined for jurisdiction when empty string', () => {
    expect(invoiceTemplateFieldsFrom({ jurisdiction: '' }).jurisdiction).toBeUndefined();
  });

  it('passes through declaration when provided', () => {
    expect(invoiceTemplateFieldsFrom({ declaration: 'This is a valid tax invoice' }).declaration).toBe('This is a valid tax invoice');
  });

  it('returns undefined for declaration when empty string', () => {
    expect(invoiceTemplateFieldsFrom({ declaration: '' }).declaration).toBeUndefined();
  });

  it('ignores unknown fields in the template object', () => {
    const result = invoiceTemplateFieldsFrom({
      template: 'classic',
      unknownField: 'should be ignored',
      anotherUnknown: 123,
    });
    expect(result).toEqual({
      template: 'classic',
      paperSize: 'a4',
      accentColor: undefined,
      tagline: undefined,
      footerText: undefined,
      bankDetails: undefined,
      signatureLabel: undefined,
      jurisdiction: undefined,
      declaration: undefined,
    });
    expect(result).not.toHaveProperty('unknownField');
    expect(result).not.toHaveProperty('anotherUnknown');
  });

  it('handles multiple fields together', () => {
    const result = invoiceTemplateFieldsFrom({
      template: 'modern',
      paperSize: 'thermal',
      accentColor: '#1B3A6B',
      tagline: 'Premium Healthcare Lab',
      footerText: 'Thank you for your business',
      bankDetails: 'Bank of India, Acc: 999888777',
      signatureLabel: 'Approved By',
      jurisdiction: 'New Delhi',
      declaration: 'As per GST Act, 2017',
    });
    expect(result).toEqual({
      template: 'modern',
      paperSize: 'thermal',
      accentColor: '#1B3A6B',
      tagline: 'Premium Healthcare Lab',
      footerText: 'Thank you for your business',
      bankDetails: 'Bank of India, Acc: 999888777',
      signatureLabel: 'Approved By',
      jurisdiction: 'New Delhi',
      declaration: 'As per GST Act, 2017',
    });
  });

  it('frozen: mapper is `x || undefined` — FALSY coerces to undefined, TRUTHY passes through un-type-guarded', () => {
    const result = invoiceTemplateFieldsFrom({
      accentColor: 123 as unknown as string,   // truthy → passes through
      tagline: null as unknown as string,       // falsy → undefined
      footerText: {} as unknown as string,      // truthy → passes through
    });
    expect(result.accentColor).toBe(123);
    expect(result.tagline).toBeUndefined();
    expect(result.footerText).toEqual({});
  });

  it('handles mix of provided and undefined fields', () => {
    const result = invoiceTemplateFieldsFrom({
      template: 'cashbill',
      tagline: 'Express Diagnostics',
      jurisdiction: undefined,
    });
    expect(result.template).toBe('cashbill');
    expect(result.tagline).toBe('Express Diagnostics');
    expect(result.jurisdiction).toBeUndefined();
    expect(result.accentColor).toBeUndefined();
  });
});

describe('staff order QR on invoices (owner 2026-09-26: disabled for now)', () => {
  it('is switched off; the entry strips orderQrDataUrl before any layout draws', () => {
    expect(STAFF_ORDER_QR_ENABLED).toBe(false);
    const src = readFileSync('apps/lms/src/app/features/frontdesk/billing/invoice-pdf.ts', 'utf8');
    expect(src).toMatch(/STAFF_ORDER_QR_ENABLED \? rawInput : \{ \.\.\.rawInput, orderQrDataUrl: undefined \}/);
  });
});

describe('buildCashBillModel — the receipt shows the invoice\'s own numbers', () => {
  // The server bill for ₹1000 @18% with ₹295 off: taxable 705, GST 126.90,
  // exact 831.90 → payable ₹832 with a +0.10 round-off (owner rule).
  const bill = (over: Partial<Bill> = {}): Bill => ({
    id: 'b', orderId: 'o', patientId: 'p', branchId: 'x', type: 'tax_invoice', isInterstate: false,
    subTotal: 1000, overrideDiscount: 0, totalDiscount: 295, totalTaxable: 705, totalCgst: 63.45, totalSgst: 63.45, totalIgst: 0,
    totalTax: 126.9, totalPayable: 832, roundOff: 0.1, totalPaid: 0, balance: 832, status: 'pending', createdAt: new Date().toISOString(),
    items: [{ id: 'i', billId: 'b', testId: 't', testName: 'CBC', price: 1000, discount: 295, taxableAmount: 705, taxSlab: 18,
      cgstRate: 9, sgstRate: 9, igstRate: 0, cgstAmount: 63.45, sgstAmount: 63.45, igstAmount: 0, total: 831.9 }],
    payments: [],
    ...over,
  } as Bill);
  const input = (b: Bill) => ({ bill: b, order: null, invoiceNumber: 'INV-1', effectivePayable: b.totalPayable } as never);

  it('GST bill: Total 1000 − Discount 295 + GST 126.90 + Round off 0.10 = Net Payable 832 (discount is the bill\'s, not gross − payable)', () => {
    const m = buildCashBillModel(input(bill()));
    expect(m.grossTotal).toBe('1,000');
    expect(m.discount).toBe('295');
    expect(m.hasTax).toBe(true);
    expect(m.tax).toBe('126.90');
    expect(m.hasRoundOff).toBe(true);
    expect(m.roundOff).toBe('+ 0.10');
    expect(m.netPayable).toBe('832');
    expect(m.amountWords).toMatch(/Eight Hundred Thirty[- ]Two/i);
  });

  it('a round-DOWN reads negative; a bill with none (or raised before round-off) has no row', () => {
    const down = buildCashBillModel(input(bill({ totalTax: 0, totalCgst: 0, totalSgst: 0, totalTaxable: 705.4, totalPayable: 705, roundOff: -0.4, balance: 705 })));
    expect(down.roundOff).toBe('- 0.40');
    const legacy = buildCashBillModel(input(bill({ totalPayable: 831.9, roundOff: undefined, balance: 831.9 })));
    expect(legacy.hasRoundOff).toBe(false);
  });

  it('GST-off bill is unchanged: Total − Discount = Net Payable, no GST row', () => {
    const m = buildCashBillModel(input(bill({ totalTax: 0, totalCgst: 0, totalSgst: 0, totalTaxable: 705, totalPayable: 705, roundOff: 0, balance: 705 })));
    expect(m.discount).toBe('295');
    expect(m.hasTax).toBe(false);
    expect(m.hasRoundOff).toBe(false);
    expect(m.netPayable).toBe('705');
  });
});
