import { TestBed } from '@angular/core/testing';
import { SegmentedComponent } from './segmented.component';

/** pf-segmented is a real WAI-ARIA radiogroup (ND-PATTERN "Admin pages"). */
describe('pf-segmented a11y', () => {
  function make(value = 'b') {
    const f = TestBed.createComponent(SegmentedComponent<string>);
    f.componentRef.setInput('options', [
      { value: 'a', label: 'Scan code' }, { value: 'b', label: 'Type number' }, { value: 'c', label: 'Off', disabled: true },
    ]);
    f.componentRef.setInput('value', value);
    f.componentRef.setInput('ariaLabelledby', 'lbl');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const radios = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    return { f, el, radios };
  }

  it('radiogroup named by the row label; radios with aria-checked', () => {
    const { el, radios } = make();
    const g = el.querySelector('[role="radiogroup"]')!;
    expect(g.getAttribute('aria-labelledby')).toBe('lbl');
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it('one Tab stop: the selected radio (roving tabindex)', () => {
    const { radios } = make();
    expect(radios().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('arrow keys move AND select, skipping disabled options', () => {
    const { f, el, radios } = make('a');
    const emitted: string[] = [];
    f.componentInstance.valueChange.subscribe((v: string) => emitted.push(v));
    const g = el.querySelector('[role="radiogroup"]')!;
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    f.detectChanges();
    expect(emitted).toEqual(['b']);
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement === radios()[1] || !document.body.contains(el)).toBe(true);
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    f.detectChanges();
    expect(emitted).toEqual(['b', 'a']); // wraps past the disabled "Off"
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    f.detectChanges();
    expect(emitted.at(-1)).toBe('b');
  });
});
