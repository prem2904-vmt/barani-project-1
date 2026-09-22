import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DynamicInputComponent } from './dynamic-input.component';

/** yyyy-MM-dd for a date `months` whole months before today (local midnight),
 *  mirroring onHybridAge's arithmetic. */
function isoMonthsAgo(months: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

describe('DynamicInputComponent hybrid DOB age units', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()]
    });
  });

  function create() {
    const fixture = TestBed.createComponent(DynamicInputComponent);
    fixture.componentRef.setInput('field', {
      name: 'date_of_birth', title: 'Date of birth', type: 'date'
    });
    fixture.detectChanges();
    return fixture;
  }

  it('typing an age in Months emits a DOB that many months back', () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));

    cmp.setAgeUnit('months');
    cmp.onHybridAge(3);

    expect(emitted).toBe(isoMonthsAgo(3));
    expect(cmp.monthsFromValue()).toBe(3);
  });

  it('auto-selects Months for an infant DOB and Years otherwise', () => {
    const fixture = create();
    const cmp = fixture.componentInstance;

    cmp.value = isoMonthsAgo(5);           // 5-month-old
    expect(cmp.ageUnit()).toBe('months');
    expect(cmp.hybridAgeDisplay()).toBe(5);

    cmp.value = isoMonthsAgo(30 * 12);     // 30-year-old
    expect(cmp.ageUnit()).toBe('years');
    expect(cmp.hybridAgeDisplay()).toBe(30);
  });

  it('years unit keeps the original whole-years behaviour', () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));

    cmp.setAgeUnit('years');
    cmp.onHybridAge(40);

    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() - 40);
    expect(emitted).toBe(d.toISOString().slice(0, 10));
    expect(cmp.ageFromValue()).toBe(40);
  });

  it('rejects out-of-range ages per unit', () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    let emitted: unknown = 'untouched';
    cmp.valueChange.subscribe(v => (emitted = v));

    cmp.setAgeUnit('months');
    cmp.onHybridAge(500);                  // > 240 months
    expect(emitted).toBe('untouched');

    cmp.setAgeUnit('years');
    cmp.onHybridAge(200);                  // > 150 years
    expect(emitted).toBe('untouched');
  });
});
