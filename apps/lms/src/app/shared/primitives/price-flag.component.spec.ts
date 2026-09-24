import { TestBed } from '@angular/core/testing';
import { PriceFlagComponent, notOfferedElement, priceFlagElement } from './price-flag.component';

describe('PriceFlag — "₹1 · not priced yet"', () => {
  it('component renders the owner wording with an SVG glyph (no emoji)', () => {
    const f = TestBed.createComponent(PriceFlagComponent);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.textContent?.trim()).toBe('₹1 · not priced yet');
    expect(el.querySelector('.pf-price-flag svg')).not.toBeNull();
  });

  it('compact drops the ₹1 prefix', () => {
    const f = TestBed.createComponent(PriceFlagComponent);
    f.componentRef.setInput('compact', true);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent?.trim()).toBe('not priced yet');
  });

  it('grid DOM builders render the same pill family', () => {
    const p = priceFlagElement();
    expect(p.className).toBe('pf-price-flag');
    expect(p.textContent).toBe('₹1 · not priced yet');
    expect(p.querySelector('svg')).not.toBeNull();
    const off = notOfferedElement();
    expect(off.className).toContain('pf-price-flag--off');
    expect(off.textContent).toBe('Not offered here');
  });
});
