import { TestBed } from '@angular/core/testing';
import { PfDateComponent } from './pf-date.component';

/** Kit date: typed dd/mm/yyyy, ISO out, never a visible native date input. */
function render(value: string | null = null, max: string | null = null) {
  TestBed.configureTestingModule({ imports: [PfDateComponent] });
  const f = TestBed.createComponent(PfDateComponent);
  f.componentRef.setInput('value', value);
  if (max) f.componentRef.setInput('max', max);
  f.componentRef.setInput('label', 'Business day');
  f.detectChanges();
  const out: Array<string | null> = [];
  f.componentInstance.valueChange.subscribe(v => out.push(v));
  const el = f.nativeElement as HTMLElement;
  const txt = el.querySelector('input[type="text"]') as HTMLInputElement;
  const type = (s: string) => { txt.value = s; txt.dispatchEvent(new Event('input')); f.detectChanges(); };
  return { f, el, txt, out, type };
}

afterEach(() => TestBed.resetTestingModule());

describe('pf-date', () => {
  it('shows the ISO value as dd/mm/yyyy in a text box; the native picker is hidden', () => {
    const { el, txt } = render('2026-09-26');
    expect(txt.value).toBe('26/09/2026');
    expect(txt.classList.contains('pf-input')).toBe(true);
    expect(txt.classList.contains('pf-num')).toBe(true);
    const native = el.querySelector('input[type="date"]')!;
    expect(native.getAttribute('aria-hidden')).toBe('true');
    expect(native.classList.contains('pf-date__native')).toBe(true);
    expect(el.querySelector('button[aria-label="Pick business day"]')).toBeTruthy();
  });

  it('auto-slashes and emits ISO when the date is complete', () => {
    const { txt, out, type } = render();
    type('2609');
    expect(txt.value).toBe('26/09');
    expect(out).toEqual([]);
    type('26092026');
    expect(out).toEqual(['2026-09-26']);
  });

  it('an impossible or after-max date is an inline error, never emitted', () => {
    const { el, out, type } = render(null, '2026-09-26');
    type('31022026');
    expect(el.querySelector('.pf-date__err')?.textContent).toContain('Not a valid date');
    type('27092026');
    expect(el.querySelector('.pf-date__err')?.textContent).toContain("Can't be after 26/09/2026");
    expect(out).toEqual([]);
  });

  it('a pick from the calendar emits as-is', () => {
    const { f, out } = render();
    f.componentInstance.onPicked('2026-09-20');
    expect(out).toEqual(['2026-09-20']);
  });
});
