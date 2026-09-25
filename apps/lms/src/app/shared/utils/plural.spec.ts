import { plural } from './plural';

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'sample')).toBe('1 sample');
  });
  it('uses the plural for zero and many', () => {
    expect(plural(0, 'sample')).toBe('0 samples');
    expect(plural(2, 'sample')).toBe('2 samples');
  });
  it('accepts an irregular plural', () => {
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });
});
