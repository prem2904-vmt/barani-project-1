import { STAFF_ORDER_QR_ENABLED, invoiceTemplateFieldsFrom } from './invoice-pdf';
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
