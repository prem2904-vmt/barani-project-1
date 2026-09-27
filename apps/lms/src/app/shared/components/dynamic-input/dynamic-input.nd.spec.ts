import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DynamicInputComponent } from './dynamic-input.component';

/** [nd] (ND-PATTERN §14 fields): kit markup; OFF by default, so every
 *  other host (result entry, workflow preview) keeps the classic look. */
describe('DynamicInputComponent — new-design markup', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  function create(field: Record<string, unknown>, nd = true, value: unknown = null) {
    const f = TestBed.createComponent(DynamicInputComponent);
    f.componentRef.setInput('field', field);
    f.componentRef.setInput('value', value);
    f.componentRef.setInput('nd', nd);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
  }

  it('off by default: the classic pf-input + pf-label markup', () => {
    const { el } = create({ name: 'first_name', title: 'First name', type: 'text', required: true }, false);
    expect(el.querySelector('input.pf-input')).not.toBeNull();
    expect(el.querySelector('label.pf-label')).not.toBeNull();
    expect(el.querySelector('.nd-input, .nd-field')).toBeNull();
  });

  it('text: a kit field; the label points at the input; required = the amber dot (not a red *)', () => {
    const { el } = create({ name: 'first_name', title: 'First name', type: 'text', required: true });
    const input = el.querySelector<HTMLInputElement>('input.nd-input')!;
    const label = el.querySelector('label.nd-field__lbl')!;
    expect(label.getAttribute('for')).toBe(input.id);
    expect(label.querySelector('.nd-dot-unpriced[aria-label="required"]')).not.toBeNull();
    expect(el.querySelector('.text-red-500')).toBeNull();
  });

  it('2–4 options (Sex) → an equal-width neutral radio group, aria-checked, no --on class', () => {
    const { el, f } = create({ name: 'sex', title: 'Sex', type: 'select', options: ['Male', 'Female', 'Other'] });
    const seg = el.querySelector('[role="radiogroup"].nd-seg.pf-di-seg--fill')!;
    expect(seg).not.toBeNull();
    const items = seg.querySelectorAll<HTMLButtonElement>('.nd-seg__item[role="radio"]');
    expect(items.length).toBe(3);
    items[1].click();
    f.detectChanges();
    expect(items[1].getAttribute('aria-checked')).toBe('true');
    expect(Array.from(items).map(b => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(el.querySelector('pf-select, [class*="--on"]')).toBeNull();
  });

  it('segment keyboard: arrows move + select, a letter picks (and cycles) the matching option', () => {
    const { el, f, c } = create({ name: 'title', title: 'Title', type: 'button_select',
      options: ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby'] });
    const g = el.querySelector<HTMLElement>('[role="radiogroup"]')!;
    const key = (k: string) => { g.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); f.detectChanges(); };
    key('m'); expect(c.value).toBe('Mr.');
    key('m'); expect(c.value).toBe('Mrs.');
    key('d'); expect(c.value).toBe('Dr.');
    key('ArrowRight'); expect(c.value).toBe('Master');
    key('End'); expect(c.value).toBe('Baby');
    key('Home'); expect(c.value).toBe('Mr.');
  });

  it('a field-level error outlines the control and shows the message under it', () => {
    const f = TestBed.createComponent(DynamicInputComponent);
    f.componentRef.setInput('field', { name: 'first_name', title: 'First name', type: 'text', required: true });
    f.componentRef.setInput('nd', true);
    f.componentRef.setInput('error', 'Required');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const input = el.querySelector('input')!;
    expect(input.classList.contains('nd-input--error')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const msg = el.querySelector('.pf-di-err')!;
    expect(msg.textContent!.trim()).toBe('Required');
    expect(input.getAttribute('aria-describedby')).toBe(msg.id);
  });

  it('phone: the default country code (the tenant\'s) applies while empty', () => {
    const f = TestBed.createComponent(DynamicInputComponent);
    f.componentRef.setInput('field', { name: 'phone', title: 'Phone', type: 'phone' });
    f.componentRef.setInput('nd', true);
    f.componentRef.setInput('defaultCountryCode', '+971');
    f.detectChanges();
    expect(f.componentInstance.selectedCountryCode()).toBe('+971');
  });

  it('5+ options stay a searchable pf-select (no native select)', () => {
    const { el } = create({ name: 'blood_group', title: 'Blood group', type: 'select',
      options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] });
    expect(el.querySelector('pf-select')).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();
  });

  it('phone: one kit shell, tabular number, country codes WITHOUT flag emoji', () => {
    const { el, c } = create({ name: 'phone', title: 'Phone', type: 'phone' });
    expect(el.querySelector('.pf-di-phone input[type="tel"].nd-num')).not.toBeNull();
    expect(c.countrySelectOptionsNd.every(o => !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(o.label))).toBe(true);
    expect(c.countrySelectOptionsNd[0]).toMatchObject({ value: '+91', label: '+91', hint: 'India' });
  });

  it('DOB keeps the date ⇄ age logic: typed dd/mm/yyyy + numeric-text age + a neutral Yrs / Mo / Days segment', () => {
    const { el, c } = create({ name: 'date_of_birth', title: 'Date of birth', type: 'date' });
    const dob = el.querySelector<HTMLInputElement>('input.pf-di-date__in.nd-input.nd-num')!;
    expect(dob.value).toBe('');
    expect(dob.placeholder).toBe('dd/mm/yyyy');
    expect(el.querySelector('input.pf-di-dob__age[type="text"][inputmode="numeric"]')).not.toBeNull();
    expect(el.querySelector('input[type="number"]')).toBeNull();
    const unit = el.querySelectorAll('.pf-di-seg--unit .nd-seg__item');
    expect(Array.from(unit).map(b => b.textContent!.trim())).toEqual(['Yrs', 'Mo', 'Days']);
    expect(unit[0].getAttribute('aria-checked')).toBe('true');
    let out: unknown;
    c.valueChange.subscribe(v => (out = v));
    c.onHybridAge(30);
    expect(String(out)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('DOB: an impossible or future date is an inline error and never stored', () => {
    const { el, f, c } = create({ name: 'date_of_birth', title: 'Date of birth', type: 'date' });
    let out: unknown = 'unset';
    c.valueChange.subscribe(v => (out = v));
    const dob = el.querySelector<HTMLInputElement>('input.pf-di-date__in')!;
    dob.value = '31022020'; dob.dispatchEvent(new Event('input')); f.detectChanges();
    expect(el.querySelector('.pf-di-err')!.textContent).toContain('valid date');
    expect(out).toBeNull();
    dob.value = '01012999'; dob.dispatchEvent(new Event('input')); f.detectChanges();
    expect(el.querySelector('.pf-di-err')!.textContent).toContain('future');
    dob.value = '15051990'; dob.dispatchEvent(new Event('input')); f.detectChanges();
    expect(out).toBe('1990-05-15');
    expect(el.querySelector('.pf-di-err')).toBeNull();
  });

  it('a number field that is really a phone ("Additional contact") gets the phone treatment — no spinner', () => {
    const { el, c } = create({ name: 'additional_contact', title: 'Additional contact', type: 'number' });
    expect(el.querySelector('.pf-di-phone input[type="tel"]')).not.toBeNull();
    expect(el.querySelector('input[type="number"]')).toBeNull();
    let out: unknown;
    c.valueChange.subscribe(v => (out = v));
    c.onPhoneDigitsChange('9876543210');
    expect(out).toBe('+919876543210');
    // A real number field keeps its input (spinner hidden by the kit).
    const n = create({ name: 'weight', title: 'Weight', type: 'number' });
    expect(n.el.querySelector('input[type="number"].nd-input')).not.toBeNull();
  });

  it('identity numbers (ABHA) are grouped in tabular numbers; checkbox → slate switch', () => {
    const a = create({ name: 'abha_id', title: 'ABHA ID', type: 'text' }, true, '12345678901234');
    expect(a.el.querySelector('input.nd-input.nd-num')).not.toBeNull();
    const t = create({ name: 'consent', title: 'Consent', type: 'checkbox' });
    const sw = t.el.querySelector<HTMLButtonElement>('.nd-toggle[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    t.f.detectChanges();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(t.el.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
