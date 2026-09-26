import { notOfferedElement } from './price-flag.component';
import * as mod from './price-flag.component';

describe('Price display — just the price (no "not priced yet" marker)', () => {
  it('the "₹1 · not priced yet" pill is gone (no component, no grid element)', () => {
    expect((mod as any).PriceFlagComponent).toBeUndefined();
    expect((mod as any).priceFlagElement).toBeUndefined();
  });

  it('"Not offered here" stays: a quiet neutral tag with an SVG glyph', () => {
    const off = notOfferedElement();
    expect(off.className).toContain('pf-price-flag--off');
    expect(off.textContent).toBe('Not offered here');
    expect(off.querySelector('svg')).not.toBeNull();
  });
});
