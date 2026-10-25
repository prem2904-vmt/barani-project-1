import {
  IN_HOUSE, effectiveDestinationLabel, isOutsourcedLine, lineDefaultPartners,
  outsourcingFromOrder, outsourcingOptions, outsourcingPayload,
} from './order-outsourcing';

const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const rows: Record<string, any> = {
  a: { id: 'a', outsourcedVendorId: 'v1' },
  b: { id: 'b', outsourcedVendorId: 'v2' },
  c: { id: 'c' },
  p: { id: 'p', type: 'profile', parameters: items('a', 'c') },
  pk: { id: 'pk', type: 'package', parameters: items('p', 'b', 'pk') },
  in: { id: 'in', type: 'profile', parameters: items('c') },
};
const byId = (id: string) => rows[id];
const partners = [{ id: 'v1', name: 'Thyrocare' }, { id: 'v2', name: 'Metropolis' }, { id: 'v3', name: 'Old', isActive: false }];

describe('order-outsourcing', () => {
  it('a line’s Test Master partners: own, else its outsourced members (recursive, cycle-safe)', () => {
    expect(lineDefaultPartners(rows['a'], byId)).toEqual(['v1']);
    expect(lineDefaultPartners(rows['p'], byId)).toEqual(['v1']);
    expect(lineDefaultPartners(rows['pk'], byId)).toEqual(['v1', 'v2']);
    expect(lineDefaultPartners(rows['in'], byId)).toEqual([]);
    expect(isOutsourcedLine(rows['c'], byId)).toBe(false);
    expect(lineDefaultPartners({ id: 'x', parameters: '{bad' }, byId)).toEqual([]);
  });

  it('options name the default, offer In-house and the other active partners', () => {
    expect(outsourcingOptions(['v1'], partners).map(o => o.label)).toEqual(['Thyrocare (default)', 'In-house', 'Metropolis']);
    const multi = outsourcingOptions(['v1', 'v2'], partners);
    expect(multi[0]).toEqual({ value: '', label: 'Test Master partners (default)', hint: 'Thyrocare, Metropolis' });
    expect(multi.map(o => o.value)).toEqual(['', IN_HOUSE, 'v1', 'v2']);
  });

  it('effective destination in plain words', () => {
    expect(effectiveDestinationLabel('', ['v1'], partners)).toBe('Outsourced · Thyrocare');
    expect(effectiveDestinationLabel(IN_HOUSE, ['v1'], partners)).toBe('In-house');
    expect(effectiveDestinationLabel('v2', ['v1'], partners)).toBe('Outsourced · Metropolis');
    expect(effectiveDestinationLabel('zz', [], partners)).toBe('Outsourced · Partner lab');
    expect(effectiveDestinationLabel(null, [], partners)).toBe('In-house');
  });

  it('payload: only real picks on outsourced lines still in the cart; empty → null', () => {
    const isOut = (id: string) => id !== 'c';
    expect(outsourcingPayload({ a: 'inhouse', b: '', c: 'v1', gone: 'v2' }, ['a', 'b', 'c'], isOut)).toEqual({ a: 'inhouse' });
    expect(outsourcingPayload({ b: '' }, ['b'], isOut)).toBeNull();
  });

  it('reads the stored picks and effective partners from an order, keyed as ordered', () => {
    const r = outsourcingFromOrder({ samples: [{ tests: [
      { testId: 'a', packageTestId: 'p', outsourcingOverride: 'inhouse', effectivePartnerId: null },
      { testId: 'b', outsourcingOverride: null, effectivePartnerId: 'v2' },
    ] }] });
    expect(r.picks).toEqual({ a: 'inhouse', p: 'inhouse' });
    expect(r.effective).toEqual({ a: null, p: null, b: 'v2' });
  });
});
