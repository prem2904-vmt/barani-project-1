import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DynamicInputComponent } from './dynamic-input.component';

/** yyyy-MM-dd for a date `months` whole months before today (local midnight),
 *  mirroring onHybridAge's arithmetic. */
function isoMonthsAgo(months: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const t = d.getFullYear() * 12 + d.getMonth() - months;
  const y = Math.floor(t / 12), m = t - y * 12;
  return localIso(new Date(y, m, Math.min(d.getDate(), new Date(y, m + 1, 0).getDate())));
}
/** yyyy-MM-dd of a LOCAL date (the DOB is a calendar date: toISOString()
 *  would shift it a day back east of UTC — the old bug in IST). */
function localIso(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  it('flags an age-box DOB as ESTIMATED and a picked date as real (DOB = single source)', () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    const flags: boolean[] = [];
    cmp.dobEstimatedChange.subscribe(v => flags.push(v));

    cmp.setAgeUnit('years');
    cmp.onHybridAge(40);
    cmp.onDobPicked('1990-05-01');
    cmp.onHybridAge(null);                 // cleared → no flag emitted

    expect(flags).toEqual([true, false]);
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

    expect(emitted).toBe(isoMonthsAgo(40 * 12));
    expect(cmp.ageFromValue()).toBe(40);
  });

  it('out-of-range ages are an inline error and clear the DOB (never a stale value)', () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    let emitted: unknown = 'untouched';
    const local: Array<string | null> = [];
    cmp.valueChange.subscribe(v => (emitted = v));
    cmp.localErrorChange.subscribe(v => local.push(v));

    cmp.setAgeUnit('years');
    cmp.onHybridAge(40);
    expect(emitted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    cmp.onHybridAge(151);                  // > 150 years
    expect(emitted).toBeNull();
    expect(cmp.dobError()).toContain('0–150 years');
    expect(local.at(-1)).toContain('0–150 years');

    cmp.onHybridAge(150);                  // the limit itself is fine
    expect(emitted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cmp.dobError()).toBeNull();
    expect(local.at(-1)).toBeNull();
  });

  it('months: 0–1199 (a months-only age); 1200 is an error pointing at Yrs', () => {
    const cmp = create().componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    cmp.setAgeUnit('months');
    cmp.onHybridAge(500);                  // used to be silently ignored (> 240)
    expect(emitted).toBe(isoMonthsAgo(500));
    cmp.onHybridAge(1199);
    expect(emitted).toBe(isoMonthsAgo(1199));
    cmp.onHybridAge(1200);
    expect(emitted).toBeNull();
    expect(cmp.dobError()).toMatch(/0–1199.*Yrs/);
    expect(cmp.ageMaxLength()).toBe(4);
  });

  it('days: 0–365 for newborns; auto-selects Days in the first month', () => {
    const cmp = create().componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    cmp.setAgeUnit('days');
    cmp.onHybridAge(10);
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 10);
    expect(emitted).toBe(localIso(d));
    expect(cmp.daysFromValue()).toBe(10);
    cmp.onHybridAge(366);
    expect(emitted).toBeNull();
    expect(cmp.dobError()).toContain('0–365');

    const fresh = create().componentInstance;
    fresh.value = localIso(d);
    expect(fresh.ageUnit()).toBe('days');
    expect(fresh.hybridAgeDisplay()).toBe(10);
  });

  it('switching the unit re-reads an age still in error (300 Yrs → 300 Mo)', () => {
    const cmp = create().componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    const box = document.createElement('input');
    cmp.setAgeUnit('years');
    box.value = '300'; cmp.onAgeText(box);
    expect(cmp.dobError()).toBeTruthy();
    expect(emitted).toBeNull();
    cmp.setAgeUnit('months');
    expect(cmp.dobError()).toBeNull();
    expect(emitted).toBe(isoMonthsAgo(300));
  });

  // OPS-135: the typed NUMBER survives a unit switch; only the unit changes.
  function typeAge(cmp: DynamicInputComponent, text: string) {
    const box = document.createElement('input');
    box.value = text; cmp.onAgeText(box);
    cmp.onAgeBlur();                                   // the click on the unit button blurs the box first
  }
  const daysAgo = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return localIso(d); };

  it('OPS-135: 6 typed in Years, then Months → 6 months (not 72), DOB follows', () => {
    const cmp = create().componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    typeAge(cmp, '6');                                  // default unit is Years
    expect(emitted).toBe(isoMonthsAgo(72));
    cmp.setAgeUnit('months');
    expect(cmp.hybridAgeDisplay()).toBe(6);
    expect(cmp.ageUnit()).toBe('months');
    expect(emitted).toBe(isoMonthsAgo(6));
  });

  it('OPS-135: Years → Days keeps the number; switching twice and back keeps it', () => {
    const cmp = create().componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    typeAge(cmp, '10');
    cmp.setAgeUnit('days');
    expect(cmp.hybridAgeDisplay()).toBe(10);
    expect(emitted).toBe(daysAgo(10));
    cmp.setAgeUnit('months');
    expect(cmp.hybridAgeDisplay()).toBe(10);
    expect(emitted).toBe(isoMonthsAgo(10));
    cmp.setAgeUnit('years');
    expect(cmp.hybridAgeDisplay()).toBe(10);
    expect(emitted).toBe(isoMonthsAgo(120));
  });

  it('OPS-135: a small number typed in Years does not flip itself to months (1 stays 1 Yrs)', () => {
    const cmp = create().componentInstance;
    typeAge(cmp, '1');
    expect(cmp.ageUnit()).toBe('years');
    expect(cmp.hybridAgeDisplay()).toBe(1);
  });

  it('OPS-135: 0 months and a unit-limit overflow are handled (0 stays 0; 400 Days is an error, not a conversion)', () => {
    const cmp = create().componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    cmp.setAgeUnit('months');
    typeAge(cmp, '0');
    expect(emitted).toBe(isoMonthsAgo(0));
    expect(cmp.hybridAgeDisplay()).toBe(0);
    cmp.setAgeUnit('years');
    expect(cmp.hybridAgeDisplay()).toBe(0);
    expect(emitted).toBe(isoMonthsAgo(0));
    cmp.setAgeUnit('days');
    typeAge(cmp, '365');
    cmp.setAgeUnit('years');                            // 365 years is out of range: error, number kept on screen
    expect(cmp.dobError()).toContain('0–150');
    expect(emitted).toBeNull();
    cmp.setAgeUnit('months');                           // 365 months is fine again
    expect(cmp.dobError()).toBeNull();
    expect(emitted).toBe(isoMonthsAgo(365));
  });

  it('OPS-135: a DOB picked as a real date still just re-shows in the new unit (no typed number to keep)', () => {
    const cmp = create().componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    typeAge(cmp, '6');
    cmp.onDobPicked(isoMonthsAgo(30));
    cmp.setAgeUnit('months');
    expect(emitted).toBe(isoMonthsAgo(30));
    expect(cmp.hybridAgeDisplay()).toBe(30);
  });

  it('OPS-135: a DOB set from outside (prefill) drops the typed number', () => {
    const cmp = create().componentInstance;
    typeAge(cmp, '6');
    cmp.value = isoMonthsAgo(30);
    cmp.setAgeUnit('months');
    expect(cmp.hybridAgeDisplay()).toBe(30);
  });

  it('OPS-135: clearing the box forgets the number', () => {
    const cmp = create().componentInstance;
    let emitted: unknown = 'x';
    cmp.valueChange.subscribe(v => (emitted = v));
    typeAge(cmp, '6');
    typeAge(cmp, '');
    cmp.setAgeUnit('months');
    expect(emitted).toBeNull();
  });

  it('the age box caps its digits at the unit width (Yrs 3, Mo 4, Days 3)', () => {
    const cmp = create().componentInstance;
    const box = document.createElement('input');
    cmp.setAgeUnit('years');
    box.value = '12345'; cmp.onAgeText(box);
    expect(box.value).toBe('123');
    cmp.setAgeUnit('months');
    box.value = '12a345'; cmp.onAgeText(box);
    expect(box.value).toBe('1234');
  });

  it('a half-typed DOB blocks submit (localErrorChange) but is shown only on blur', () => {
    const cmp = create().componentInstance;
    const local: Array<string | null> = [];
    cmp.localErrorChange.subscribe(v => local.push(v));
    const box = document.createElement('input');
    box.value = '1505'; cmp.onDobInput(box);
    expect(local.at(-1)).toContain('full date');
    expect(cmp.dobError()).toBeNull();
    cmp.onDobBlur();
    expect(cmp.dobError()).toContain('full date');
    box.value = ''; cmp.onDobInput(box);
    expect(local.at(-1)).toBeNull();
    expect(cmp.dobError()).toBeNull();
  });

  it('a DOB before 1900 is an error', () => {
    const cmp = create().componentInstance;
    const box = document.createElement('input');
    box.value = '01011860'; cmp.onDobInput(box);
    expect(cmp.dobError()).toBeTruthy();
  });
});

describe('DynamicInputComponent phone digits', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  it('blocks extra typing: the box is forced back to the country length (+91 = 10)', () => {
    const fixture = TestBed.createComponent(DynamicInputComponent);
    fixture.componentRef.setInput('field', { name: 'phone', title: 'Phone', type: 'phone' });
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    let emitted: unknown;
    cmp.valueChange.subscribe(v => (emitted = v));
    const box = document.createElement('input');
    box.value = '98765432101';             // 11 digits
    cmp.onPhoneDigitsChange(box.value, box);
    expect(box.value).toBe('9876543210');
    expect(emitted).toBe('+919876543210');
  });

  it('the rendered input carries maxlength = 10 (the +91 mobile; no other code exists)', () => {
    const fixture = TestBed.createComponent(DynamicInputComponent);
    fixture.componentRef.setInput('field', { name: 'additional_contact', title: 'Additional contact', type: 'number' });
    fixture.componentRef.setInput('nd', true);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="tel"]')!;
    expect(input.getAttribute('maxlength')).toBe('10');
    fixture.componentInstance.onCountryCodeChange('+65');   // not offered → the +91 rule
    fixture.detectChanges();
    expect(input.getAttribute('maxlength')).toBe('10');
  });
});
