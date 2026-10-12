import { TestBed } from '@angular/core/testing';
import { PfTimeComponent } from './pf-time.component';

/** Kit time: typed hh:mm (24h), HH:mm out, never a visible native time input. */
function render(value: string | null = null) {
  TestBed.configureTestingModule({ imports: [PfTimeComponent] });
  const f = TestBed.createComponent(PfTimeComponent);
  f.componentRef.setInput('value', value);
  f.componentRef.setInput('label', 'Start time');
  f.detectChanges();
  const out: Array<string | null> = [];
  f.componentInstance.valueChange.subscribe(v => out.push(v));
  const el = f.nativeElement as HTMLElement;
  const txt = el.querySelector('input[type="text"]') as HTMLInputElement;
  const type = (s: string) => { txt.value = s; txt.dispatchEvent(new Event('input')); f.detectChanges(); };
  return { f, el, txt, out, type };
}

afterEach(() => TestBed.resetTestingModule());

describe('pf-time', () => {
  it('shows the HH:mm value as hh:mm in a text box; the native picker is hidden', () => {
    const { el, txt } = render('14:30');
    expect(txt.value).toBe('14:30');
    expect(txt.classList.contains('pf-input')).toBe(true);
    expect(txt.classList.contains('pf-num')).toBe(true);
    const native = el.querySelector('input[type="time"]')!;
    expect(native.getAttribute('aria-hidden')).toBe('true');
    expect(native.classList.contains('pf-time__native')).toBe(true);
    expect(el.querySelector('button[aria-label="Pick start time"]')).toBeTruthy();
  });

  it('auto-colons and emits HH:mm when the time is complete', () => {
    const { txt, out, type } = render();
    type('14');
    expect(txt.value).toBe('14');
    expect(out).toEqual([]);
    type('1430');
    expect(out).toEqual(['14:30']);
  });

  it('an impossible hour or minute is an inline error, never emitted', () => {
    const { el, out, type } = render(null);
    type('2561');
    expect(el.querySelector('.pf-time__err')?.textContent).toContain('Not a valid time');
    expect(out).toEqual([]);
  });

  it('a pick from the clock emits as-is', () => {
    const { f, out } = render();
    f.componentInstance.onPicked('09:05');
    expect(out).toEqual(['09:05']);
  });
});
