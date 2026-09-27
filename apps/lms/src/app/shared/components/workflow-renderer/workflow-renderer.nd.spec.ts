import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { WorkflowRendererComponent } from './workflow-renderer.component';
import { WorkflowConfig } from '../../models/workflow.model';

const F = (id: string, name: string, title: string, type: string, isRequired = false, extra: object = {}) =>
  ({ id, name, title, type, isRequired, isStandard: true, isEditable: true, storageKey: name, width: 'half', ...extra });

function cfg(): WorkflowConfig {
  return {
    id: 'c', name: 'patient_registration', title: 'Patient Registration', module: 'lms', screenName: 'patient_registration',
    version: 1, status: 'published', globalConditions: [], actions: [],
    steps: [
      { id: 'a', name: 'basic_info', title: 'Identity', type: 'entry', isRequired: true, canSkip: false, isStandard: true,
        fields: [F('t', 'title', 'Title', 'button_select', false, { options: [{ value: 'Mr.', label: 'Mr.' }, { value: 'Ms.', label: 'Ms.' }] }),
                 F('f', 'first_name', 'First name', 'text', true)] },
      { id: 'b', name: 'basic_info', title: 'Contact', type: 'entry', isRequired: true, canSkip: false, isStandard: true,
        fields: [F('p', 'phone', 'Phone', 'phone', true)] },
    ],
  } as unknown as WorkflowConfig;
}

/** New design (ND §15): ONE form — every step a card at once, no in-form
 *  actions, field-level errors (focus the first), Enter walks the fields. */
describe('WorkflowRendererComponent — new design', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  function create() {
    const f = TestBed.createComponent(WorkflowRendererComponent);
    f.componentRef.setInput('config', cfg());
    f.componentRef.setInput('singlePage', true);
    f.componentRef.setInput('nd', true);
    f.componentRef.setInput('hideActions', true);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
  }

  it('every step is its own nd-card at once (icon chip, label, "N required"); no action buttons', () => {
    const { el } = create();
    const cards = el.querySelectorAll('.pf-wr-cards > .pf-wr-card.nd-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.nd-card__icon svg')).not.toBeNull();
    expect(cards[0].querySelector('.nd-card__label')!.textContent!.trim()).toBe('Identity');
    expect(cards[0].querySelector('.pf-wr-card__note')!.textContent!.trim()).toBe('1 required');
    expect(el.querySelector('[data-field="phone"]')).not.toBeNull();
    expect(el.querySelector('[data-field="first_name"]')).not.toBeNull();
    expect(el.querySelector('h3, button.pf-btn, .nd-btn--primary, [role="tablist"]')).toBeNull();
  });

  it('Title is its own segmented field in nd (not the first-name prefix); wide fields span the card', () => {
    const { el } = create();
    expect(el.querySelector('[data-field="title"] [role="radiogroup"].nd-seg')).not.toBeNull();
    expect(el.querySelector('pf-select.w-\\[104px\\]')).toBeNull();
    expect(el.querySelector('[data-field="phone"]')!.closest('.pf-wr-span')).not.toBeNull();
    expect(el.querySelector('[data-field="first_name"]')!.closest('.pf-wr-span')).toBeNull();
  });

  it('finish() validates EVERY step: each invalid field gets its own error; (invalid) names the first', async () => {
    const { c, f, el } = create();
    const seen: string[] = [];
    let done = false;
    c.invalid.subscribe(e => seen.push(e.fieldName));
    c.workflowComplete.subscribe(() => (done = true));
    c.finish();
    f.detectChanges();
    expect(done).toBe(false);
    expect(seen).toEqual(['first_name']);
    expect(el.querySelector('[data-field="first_name"] .pf-di-err')!.textContent).toContain('Required');
    expect(el.querySelector('[data-field="phone"] .pf-di-err')!.textContent).toContain('Required');
    c.setValue(cfg().steps[0], 'first_name', 'Ravi');
    f.detectChanges();
    expect(el.querySelector('[data-field="first_name"] .pf-di-err')).toBeNull();
    expect(el.querySelector('[data-field="phone"] .pf-di-err')).not.toBeNull();
  });

  it('Enter moves to the next field; on the last one it emits enterSubmit', () => {
    const { el, c } = create();
    let submitted = 0;
    c.enterSubmit.subscribe(() => submitted++);
    const first = el.querySelector<HTMLInputElement>('[data-field="first_name"] input')!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const tel = el.querySelector<HTMLInputElement>('[data-field="phone"] input[type="tel"]')!;
    expect(document.activeElement).toBe(tel);
    tel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(submitted).toBe(1);
  });

  it('isStepValid is pure: it never shows a message', () => {
    const { c, el, f } = create();
    expect(c.isStepValid(cfg().steps[0])).toBe(false);
    c.setValue(cfg().steps[0], 'first_name', 'Ravi');
    expect(c.isStepValid(cfg().steps[0])).toBe(true);
    f.detectChanges();
    expect(el.querySelector('.pf-di-err')).toBeNull();
  });
});

/** QA #2 (2026-09-27): registration field rules surface inline — on blur
 *  (format only; empty stays quiet) and on submit (focus the first). */
describe('WorkflowRendererComponent — registration field validation', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  const reg = (): WorkflowConfig => ({
    id: 'c', name: 'patient_registration', title: 'Patient Registration', module: 'lms', screenName: 'patient_registration',
    version: 1, status: 'published', globalConditions: [], actions: [],
    steps: [
      { id: 'a', name: 'basic_info', title: 'Contact', type: 'entry', isRequired: true, canSkip: false, isStandard: true,
        fields: [F('p', 'phone', 'Phone', 'phone', true),
                 F('d', 'date_of_birth', 'Date of birth', 'date'),
                 F('ab', 'abha_id', 'ABHA ID', 'text'),
                 F('aa', 'aadhaar_last4', 'Aadhaar (last 4)', 'text'),
                 F('x', 'additional_contact', 'Additional contact', 'number', false, { storageKey: 'metadata.additional_contact' }),
                 F('e', 'email', 'Email', 'email')] },
    ],
  } as unknown as WorkflowConfig);

  function create() {
    const f = TestBed.createComponent(WorkflowRendererComponent);
    f.componentRef.setInput('config', reg());
    f.componentRef.setInput('singlePage', true);
    f.componentRef.setInput('nd', true);
    f.componentRef.setInput('hideActions', true);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
  }
  const step = () => reg().steps[0];
  const errOf = (el: HTMLElement, name: string) => el.querySelector(`[data-field="${name}"] .pf-di-err`)?.textContent ?? null;

  it('blur on a short ABHA / Aadhaar-last-4 / bad email shows the error under that field; empty stays quiet', () => {
    const { c, f, el } = create();
    c.setValue(step(), 'abha_id', '1234567');
    c.setValue(step(), 'aadhaar_last4', '12');
    c.setValue(step(), 'email', 'ravi@');
    f.detectChanges();
    for (const name of ['abha_id', 'aadhaar_last4', 'email', 'additional_contact']) {
      el.querySelector<HTMLInputElement>(`[data-field="${name}"] input`)!
        .dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
    f.detectChanges();
    expect(errOf(el, 'abha_id')).toContain('14 digits (7 entered)');
    expect(errOf(el, 'aadhaar_last4')).toContain('last 4');
    expect(errOf(el, 'email')).toContain('valid email');
    expect(errOf(el, 'additional_contact')).toBeNull();     // empty optional → no error
  });

  it('submit blocks on each invalid field (incl. the additional contact) and names the first', () => {
    const { c, f, el } = create();
    const seen: string[] = [];
    let done = false;
    c.invalid.subscribe(e => seen.push(e.fieldName));
    c.workflowComplete.subscribe(() => (done = true));
    c.setValue(step(), 'phone', '+919876543210');
    c.setValue(step(), 'abha_id', '12345678901234');
    c.setValue(step(), 'additional_contact', '+91123');
    c.setValue(step(), 'email', 'x@y');
    c.finish();
    f.detectChanges();
    expect(done).toBe(false);
    expect(seen).toEqual(['additional_contact']);
    expect(errOf(el, 'additional_contact')).toMatch(/10-digit/);
    expect(errOf(el, 'email')).toMatch(/valid email/);
    expect(errOf(el, 'abha_id')).toBeNull();
  });

  it('an age the DOB box rejected (value null) still blocks submit on an OPTIONAL DOB', () => {
    const { c, f, el } = create();
    let done = false;
    c.workflowComplete.subscribe(() => (done = true));
    c.setValue(step(), 'phone', '+919876543210');
    c.setLocalError(step(), 'date_of_birth', 'Age must be 0–150 years');
    c.finish();
    f.detectChanges();
    expect(done).toBe(false);
    expect(errOf(el, 'date_of_birth')).toContain('0–150');
    c.setLocalError(step(), 'date_of_birth', null);
    c.finish();
    expect(done).toBe(true);
  });

  it('valid values submit', () => {
    const { c } = create();
    let done = false;
    c.workflowComplete.subscribe(() => (done = true));
    c.setValue(step(), 'phone', '+919876543210');
    c.setValue(step(), 'abha_id', '12345678901234');
    c.setValue(step(), 'aadhaar_last4', '1234');
    c.setValue(step(), 'additional_contact', '+918765432109');
    c.setValue(step(), 'email', 'ravi@example.com');
    c.finish();
    expect(done).toBe(true);
  });
});
