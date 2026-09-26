import {
  DEFAULT_TEST_PRICE, PRICE_BULK_PATH, TENANT_PRICE_SCOPE,
  effectivePrice, isNotOfferedError, isOffered, isPriceDefault, lineGst, priceBulkBody, priceListUrl, roundPaiseHalfEven, taxSlabOf,
} from './test-pricing';
import { ApiError } from '../models/api-response.model';

describe('test-pricing (pricing single source)', () => {
  it('the default is ₹1 (shown as just the price; no "not priced" wording)', async () => {
    expect(DEFAULT_TEST_PRICE).toBe(1);
    expect((await import('./test-pricing') as any).NOT_PRICED_LABEL).toBeUndefined();
    expect(PRICE_BULK_PATH).toBe('/api/tests/prices/bulk');
  });

  it('isPriceDefault: the server flag wins; a row with no price is the default', () => {
    expect(isPriceDefault({ price: 1, priceIsDefault: true })).toBe(true);
    expect(isPriceDefault({ price: 1, priceIsDefault: false })).toBe(false);   // priced at exactly ₹1
    expect(isPriceDefault({ price: undefined })).toBe(true);
    expect(isPriceDefault({ price: null })).toBe(true);
    expect(isPriceDefault({ price: 0 })).toBe(false);
    expect(isPriceDefault(null)).toBe(false);
  });

  it('effectivePrice: DTO price (strings coerced), ₹1 when absent, a real ₹0 stays 0', () => {
    expect(effectivePrice({ price: 250 })).toBe(250);
    expect(effectivePrice({ price: '120' })).toBe(120);
    expect(effectivePrice({ price: 0 })).toBe(0);
    expect(effectivePrice({})).toBe(1);
    expect(effectivePrice({ price: 'abc' })).toBe(1);
    expect(effectivePrice(undefined)).toBe(0);
  });

  it('isOffered: only an explicit false hides a test', () => {
    expect(isOffered({})).toBe(true);
    expect(isOffered({ isOffered: true })).toBe(true);
    expect(isOffered({ isOffered: null })).toBe(true);
    expect(isOffered({ isOffered: false })).toBe(false);
    expect(isOffered(null)).toBe(false);
  });

  it('taxSlabOf / lineGst mirror the bill (CGST+SGST halves rounded to paise)', () => {
    expect(taxSlabOf({ taxSlab: 18 })).toBe(18);
    expect(taxSlabOf({ taxSlab: '5' })).toBe(5);
    expect(taxSlabOf({})).toBe(0);
    expect(taxSlabOf({ taxSlab: -3 })).toBe(0);
    expect(lineGst(305, 18)).toBe(54.9);
    expect(lineGst(333, 5)).toBe(16.64);     // 8.325 → 8.32 (banker's, like decimal.Round) ×2
    expect(lineGst(335, 5)).toBe(16.76);     // 8.375 → 8.38 ×2
    expect(roundPaiseHalfEven(0.125)).toBe(0.12);
    expect(roundPaiseHalfEven(0.135)).toBe(0.14);
    expect(roundPaiseHalfEven(2.6789)).toBe(2.68);
    expect(lineGst(1000, 0)).toBe(0);
    expect(lineGst(0, 18)).toBe(0);
  });

  it('priceBulkBody: rounds/clamps, keeps only the fields given, branchId only when scoped', () => {
    expect(priceBulkBody([{ testId: 'a', price: 10.005 }])).toEqual({ updates: [{ testId: 'a', price: 10.01 }] });
    expect(priceBulkBody([{ testId: 'a', price: -4, taxSlab: 5 }], 'b1'))
      .toEqual({ updates: [{ testId: 'a', price: 0, taxSlab: 5 }], branchId: 'b1' });
    expect(priceBulkBody([{ testId: 'a', isOffered: false }], null)).toEqual({ updates: [{ testId: 'a', isOffered: false }] });
    expect(priceBulkBody([{ testId: 'a', price: 5, discount: 2 }])).toEqual({ updates: [{ testId: 'a', price: 5, discount: 2 }] });
  });

  it('priceListUrl: acting branch by default, a branch or the tenant view by branchId', () => {
    expect(priceListUrl()).toBe('/api/tests/');
    expect(priceListUrl('b1')).toBe('/api/tests/?branchId=b1');
    expect(priceListUrl(TENANT_PRICE_SCOPE)).toBe(`/api/tests/?branchId=${TENANT_PRICE_SCOPE}`);
  });

  it('isNotOfferedError recognises the 409 not_offered in every error shape', () => {
    expect(isNotOfferedError(new ApiError('Not offered', 'not_offered'))).toBe(true);
    expect(isNotOfferedError({ error: { error: 'not_offered', message: 'x' } })).toBe(true);
    expect(isNotOfferedError({ code: 'not_offered' })).toBe(true);
    expect(isNotOfferedError(new ApiError('Conflict', 'conflict'))).toBe(false);
    expect(isNotOfferedError(null)).toBe(false);
  });
});
