import { TestBed } from '@angular/core/testing';
import { SelectComponent } from './select.component';

/**
 * pf-select `searchChange` (Edit referral, 2026-10-31): a searchable select can
 * let its host fetch SERVER matches while the user types (a large referring-
 * doctor directory). Additive: nothing emits it unless typed, and new options
 * arriving while the panel is open re-render in place.
 */
describe('SelectComponent searchChange', () => {
  function make() {
    const fixture = TestBed.createComponent(SelectComponent<string>);
    const c = fixture.componentInstance;
    c.options = [{ value: 'a', label: 'Dr Anand' }];
    c.searchable = true;
    const seen: string[] = [];
    c.searchChange.subscribe(v => seen.push(v));
    return { fixture, c, seen };
  }

  it('emits every keystroke of the filter box', () => {
    const { c, seen } = make();
    c.onSearchInput('Dr');
    c.onSearchInput('Dr K');
    expect(seen).toEqual(['Dr', 'Dr K']);
  });

  it('closing the panel after typing resets the host search with an empty string', () => {
    const { fixture, c, seen } = make();
    fixture.detectChanges();
    (c as unknown as { openPanel(): void }).openPanel();
    c.onSearchInput('Kum');
    (c as unknown as { closePanel(): void }).closePanel();
    expect(seen).toEqual(['Kum', '']);
  });

  it('never emits when nothing was typed', () => {
    const { fixture, c, seen } = make();
    fixture.detectChanges();
    (c as unknown as { openPanel(): void }).openPanel();
    (c as unknown as { closePanel(): void }).closePanel();
    expect(seen).toEqual([]);
  });

  it('options replaced while open re-render the portalled panel', () => {
    const { fixture, c } = make();
    fixture.detectChanges();
    (c as unknown as { openPanel(): void }).openPanel();
    fixture.componentRef.setInput('options', [{ value: 'k', label: 'Dr Kumar' }, { value: 'r', label: 'Dr Rao' }]);
    fixture.detectChanges();
    const labels = Array.from(document.querySelectorAll('#pf-overlay-host .pf-dd__option')).map(n => n.textContent?.trim());
    expect(labels.some(l => l?.includes('Dr Kumar'))).toBe(true);
    expect(labels.some(l => l?.includes('Dr Rao'))).toBe(true);
    (c as unknown as { closePanel(): void }).closePanel();
  });
});
