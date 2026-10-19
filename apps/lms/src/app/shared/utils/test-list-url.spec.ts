import { testListUrl } from './test-list-url';
import { TENANT_PRICE_SCOPE } from './test-pricing';

describe('testListUrl (catalogue list screens read the summary view)', () => {
  it('always asks for the summary view', () => {
    expect(testListUrl()).toBe('/api/tests/?view=summary');
  });

  it('keeps the list filters the screens send', () => {
    expect(testListUrl({ activeOnly: true })).toBe('/api/tests/?activeOnly=true&view=summary');
    expect(testListUrl({ status: 'all' })).toBe('/api/tests/?status=all&view=summary');
    expect(testListUrl({ branchId: 'b-1' })).toBe('/api/tests/?branchId=b-1&view=summary');
    expect(testListUrl({ activeOnly: false, branchId: null })).toBe('/api/tests/?view=summary');
  });

  it('the pricing screen\'s tenant price scope rides along', () => {
    expect(testListUrl({ branchId: TENANT_PRICE_SCOPE })).toBe(`/api/tests/?branchId=${TENANT_PRICE_SCOPE}&view=summary`);
  });
});
