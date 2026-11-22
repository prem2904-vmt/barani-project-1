import { TestBed } from '@angular/core/testing';
import { SelectComponent } from './select.component';

/**
 * Owner 2026-11-21 (Settings › Auto-assign): a multi-select in a table row spilled its chips over the rows below.
 * `maxChips` caps the field at N chips + "+K" (the full list is the open panel); without it nothing changes.
 */
describe('SelectComponent maxChips', () => {
  const OPTS = ['Admin User', 'Anand Krishnan', 'Front Desk', 'Kavya Desk', 'Meena Lakshmi'].map((l, i) => ({ value: `u${i}`, label: l }));
  function make(values: string[], maxChips: number | null) {
    const f = TestBed.createComponent(SelectComponent<string>);
    const c = f.componentInstance;
    c.options = OPTS; c.multiple = true; c.values = values; c.maxChips = maxChips;
    c.ngOnChanges({});
    f.detectChanges();
    return { c, el: f.nativeElement as HTMLElement };
  }

  it('draws at most N chips and a "+K" count with the rest as its tooltip', () => {
    const { c, el } = make(['u0', 'u1', 'u2', 'u3', 'u4'], 2);
    expect(c.shownChips.map(o => o.label)).toEqual(['Admin User', 'Anand Krishnan']);
    expect(c.hiddenChipCount).toBe(3);
    expect(el.querySelectorAll('.pf-dd__chip:not(.pf-dd__chip--more)').length).toBe(2);
    const more = el.querySelector('.pf-dd__chip--more')!;
    expect(more.textContent?.trim()).toBe('+3');
    expect(more.getAttribute('title')).toBe('Front Desk, Kavya Desk, Meena Lakshmi');
    expect(el.querySelector('.pf-dd__chips--capped')).not.toBeNull();
  });

  it('no count when the picks fit; no cap = every chip (unchanged)', () => {
    expect(make(['u0', 'u1'], 2).el.querySelector('.pf-dd__chip--more')).toBeNull();
    const all = make(['u0', 'u1', 'u2', 'u3'], null);
    expect(all.el.querySelectorAll('.pf-dd__chip').length).toBe(4);
    expect(all.el.querySelector('.pf-dd__chips--capped')).toBeNull();
  });
});
