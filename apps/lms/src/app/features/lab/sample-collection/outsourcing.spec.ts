import { outsourcedTag, partnerName, splitFromOf, splitPrompt, splitsByOrder, OutsourceSplit } from './outsourcing';

const names = { a: 'Apollo Diagnostics', b: '  ' };

const split = (o: Partial<OutsourceSplit> = {}): OutsourceSplit => ({
  orderId: 'o1', sampleId: 's1', sampleStatus: 'collected', orderTestId: 't1',
  testId: 'x', testName: 'Vitamin D', toVendorId: 'a', ...o,
});

describe('outsourcedTag', () => {
  it('is null for an in-house tube', () => {
    expect(outsourcedTag({ outsourcedVendorId: null }, names)).toBeNull();
  });
  it('names the partner lab', () => {
    expect(outsourcedTag({ outsourcedVendorId: 'a' }, names)).toBe('Outsourced · Apollo Diagnostics');
  });
  it('falls back to a bare tag when the partner is unknown or blank', () => {
    expect(outsourcedTag({ outsourcedVendorId: 'zz' }, names)).toBe('Outsourced');
    expect(outsourcedTag({ outsourcedVendorId: 'b' }, names)).toBe('Outsourced');
  });
});

describe('partnerName', () => {
  it('is null without an id', () => {
    expect(partnerName(null, names)).toBeNull();
  });
});

describe('splitFromOf', () => {
  it('reads the barcode the tube was split from', () => {
    expect(splitFromOf({ metadata: JSON.stringify({ splitFrom: 'LAB-2609-00012' }) })).toBe('LAB-2609-00012');
  });
  it('is null for no / malformed / unrelated metadata', () => {
    expect(splitFromOf({})).toBeNull();
    expect(splitFromOf({ metadata: '{not json' })).toBeNull();
    expect(splitFromOf({ metadata: JSON.stringify({ other: 1 }) })).toBeNull();
  });
});

describe('splitPrompt', () => {
  it('asks for a separate tube for the outsourced partner', () => {
    expect(splitPrompt(split(), names)).toBe('Draw/split a separate tube for Vitamin D (outsourced · Apollo Diagnostics)');
  });
  it('says in-house when outsourcing was removed', () => {
    expect(splitPrompt(split({ toVendorId: null, fromVendorId: 'a' }), names))
      .toBe('Draw/split a separate tube for Vitamin D (in-house)');
  });
  it('falls back to "partner lab" for an unknown partner', () => {
    expect(splitPrompt(split({ toVendorId: 'zz' }), names)).toContain('(outsourced · partner lab)');
  });
});

describe('splitsByOrder', () => {
  it('groups lines per order preserving order', () => {
    const m = splitsByOrder([split({ orderTestId: '1' }), split({ orderId: 'o2', orderTestId: '2' }), split({ orderTestId: '3' })]);
    expect([...m.keys()]).toEqual(['o1', 'o2']);
    expect(m.get('o1')!.map(x => x.orderTestId)).toEqual(['1', '3']);
  });
});
