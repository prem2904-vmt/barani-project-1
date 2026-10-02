import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DynamicInputComponent } from './dynamic-input.component';

/**
 * The plain (non-DOB) date / datetime / time field types used native
 * `<input type="date"/"datetime-local"/"time">` in BOTH the classic and
 * [nd] templates — now `pf-nd-date` / `pf-nd-datetime` / `pf-nd-time`,
 * same value in/out (`emit()`/`value`), in both modes.
 */
describe('DynamicInputComponent — date/datetime/time (no native controls)', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  function create(field: Record<string, unknown>, nd: boolean, value: unknown = null) {
    const f = TestBed.createComponent(DynamicInputComponent);
    f.componentRef.setInput('field', field);
    f.componentRef.setInput('value', value);
    f.componentRef.setInput('nd', nd);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
  }

  for (const nd of [true, false]) {
    describe(nd ? '[nd] markup' : 'classic markup', () => {
      it('date: pf-nd-date, never a native date input; typing emits ISO yyyy-MM-dd', () => {
        const { el, f } = create({ name: 'collected_on', title: 'Collected on', type: 'date' }, nd);
        expect(el.querySelector('pf-nd-date')).not.toBeNull();
        expect(el.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
        let emitted: unknown;
        f.componentInstance.valueChange.subscribe((v: unknown) => (emitted = v));
        const txt = el.querySelector<HTMLInputElement>('pf-nd-date input[type="text"]')!;
        txt.value = '26092026';
        txt.dispatchEvent(new Event('input'));
        expect(emitted).toBe('2026-09-26');
      });

      it('time: pf-nd-time, never a native time input; typing emits HH:mm', () => {
        const { el, f } = create({ name: 'performed_at', title: 'Performed at', type: 'time' }, nd);
        expect(el.querySelector('pf-nd-time')).not.toBeNull();
        expect(el.querySelector('input[type="time"]:not([aria-hidden="true"])')).toBeNull();
        let emitted: unknown;
        f.componentInstance.valueChange.subscribe((v: unknown) => (emitted = v));
        const txt = el.querySelector<HTMLInputElement>('pf-nd-time input[type="text"]')!;
        txt.value = '1430';
        txt.dispatchEvent(new Event('input'));
        expect(emitted).toBe('14:30');
      });

      it('datetime: pf-nd-datetime, never a native datetime-local input', () => {
        const { el } = create({ name: 'recorded_at', title: 'Recorded at', type: 'datetime' }, nd, '2026-09-26T14:30');
        expect(el.querySelector('pf-nd-datetime')).not.toBeNull();
        expect(el.querySelector('input[type="datetime-local"]')).toBeNull();
        expect(el.querySelector('pf-nd-date')).not.toBeNull();
        expect(el.querySelector('pf-nd-time')).not.toBeNull();
      });
    });
  }

  it('DOB hybrid path is untouched: still the dd/mm/yyyy + age box, not a plain pf-nd-date', () => {
    const { el } = create({ name: 'date_of_birth', title: 'Date of birth', type: 'date' }, true);
    expect(el.querySelector('.pf-di-dob, .pf-age-unit')).not.toBeNull();
  });
});
