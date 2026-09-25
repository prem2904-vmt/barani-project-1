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

/** New design (ND §14): one section at a time, no in-form actions, and
 *  validation that still covers every section and names the failing one. */
describe('WorkflowRendererComponent — new design', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  function create(active: string | null) {
    const f = TestBed.createComponent(WorkflowRendererComponent);
    f.componentRef.setInput('config', cfg());
    f.componentRef.setInput('singlePage', true);
    f.componentRef.setInput('nd', true);
    f.componentRef.setInput('hideActions', true);
    f.componentRef.setInput('activeStepId', active);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
  }

  it('renders only the active step, no headings, no action buttons', () => {
    const { el } = create('b');
    expect(el.querySelectorAll('.pf-wr-sec').length).toBe(1);
    expect(el.querySelector('[data-field="phone"]')).not.toBeNull();
    expect(el.querySelector('[data-field="first_name"]')).toBeNull();
    expect(el.querySelector('h3, button.pf-btn, .nd-btn')).toBeNull();
  });

  it('Title is its own segmented field in nd (not the first-name prefix)', () => {
    const { el } = create('a');
    expect(el.querySelector('[data-field="title"] .nd-seg')).not.toBeNull();
    expect(el.querySelector('pf-select.w-\\[104px\\]')).toBeNull();
  });

  it('finish() validates EVERY step and emits (invalid) with the failing step', () => {
    const { c, f, el } = create('a');
    const seen: string[] = [];
    let done = false;
    c.invalid.subscribe(e => seen.push(e.stepId));
    c.workflowComplete.subscribe(() => (done = true));
    c.setValue(cfg().steps[0], 'first_name', 'Ravi');
    c.finish();
    f.detectChanges();
    expect(done).toBe(false);
    expect(seen).toEqual(['b']);
    expect(el.querySelector('.pf-wr-err')!.textContent).toContain('Phone: Required');
  });

  it('isStepValid is pure: it never shows a message', () => {
    const { c, el, f } = create('a');
    expect(c.isStepValid(cfg().steps[0])).toBe(false);
    c.setValue(cfg().steps[0], 'first_name', 'Ravi');
    expect(c.isStepValid(cfg().steps[0])).toBe(true);
    f.detectChanges();
    expect(el.querySelector('.pf-wr-err')).toBeNull();
  });
});
