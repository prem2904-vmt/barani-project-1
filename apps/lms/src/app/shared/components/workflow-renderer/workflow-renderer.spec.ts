import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { WorkflowRendererComponent } from './workflow-renderer.component';
import { WorkflowConfig, WorkflowStep } from '../../models/workflow.model';

/** Minimal patient-registration-shaped config exercising the redesign:
 *  a basic step with an OR-visibility "Baby of" field, plus an additional
 *  step that must render as a visible titled section (no hidden reveal). */
function makeConfig(): WorkflowConfig {
  return {
    id: 'cfg', name: 'patient_registration', title: 'Patient Registration',
    module: 'lms', screenName: 'patient_registration', version: 1,
    status: 'published', globalConditions: [], actions: [],
    steps: [
      {
        id: 's1', name: 'basic_info', title: 'Basic Info', type: 'entry',
        isRequired: true, canSkip: false, isStandard: true,
        afterStep: { defaultNextStep: 'additional_info' },
        fields: [
          {
            id: 'f1', name: 'title', title: 'Title', type: 'button_select',
            isStandard: true, isRequired: false, isEditable: true,
            storageKey: 'title', width: 'full',
            options: [
              { value: 'Mr.', label: 'Mr.' }, { value: 'Baby', label: 'Baby' }
            ]
          },
          {
            id: 'f2', name: 'guardian_name', title: 'Baby of / Guardian', type: 'text',
            isStandard: true, isRequired: false, isEditable: true,
            storageKey: 'guardian_name', width: 'half',
            showWhen: [
              { field: 'age', operator: 'lessThan', value: 18 },
              { field: 'title', operator: 'equals', value: 'Baby' }
            ],
            showWhenLogic: 'OR'
          },
          {
            id: 'f3', name: 'both_rules', title: 'Both rules (AND default)', type: 'text',
            isStandard: true, isRequired: false, isEditable: true,
            storageKey: 'both_rules', width: 'half',
            showWhen: [
              { field: 'age', operator: 'lessThan', value: 18 },
              { field: 'title', operator: 'equals', value: 'Baby' }
            ]
          }
        ]
      },
      {
        id: 's2', name: 'additional_info', title: 'Additional details', type: 'entry',
        isRequired: false, canSkip: true, isStandard: true,
        afterStep: { defaultNextStep: null },
        fields: [
          {
            id: 'f4', name: 'occupation', title: 'Occupation', type: 'text',
            isStandard: false, isRequired: false, isEditable: true,
            storageKey: 'metadata.occupation', width: 'half'
          }
        ]
      }
    ]
  } as WorkflowConfig;
}

describe('WorkflowRendererComponent (registration redesign)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()]
    });
  });

  function create(cfg: WorkflowConfig) {
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('config', cfg);
    fixture.componentRef.setInput('singlePage', true);
    fixture.detectChanges();
    return fixture;
  }

  it('showWhenLogic OR shows the field when ANY rule passes', () => {
    const fixture = create(makeConfig());
    const cmp = fixture.componentInstance;
    const basic = cmp.visibleSteps()[0] as WorkflowStep;

    // No title, no age → hidden.
    expect(cmp.visibleFields(basic).map(f => f.name)).not.toContain('guardian_name');

    // Title = Baby alone (no DOB typed yet) → visible via the OR leg.
    cmp.setValue(basic, 'title', 'Baby');
    expect(cmp.visibleFields(basic).map(f => f.name)).toContain('guardian_name');
  });

  it('missing showWhenLogic keeps legacy AND semantics', () => {
    const fixture = create(makeConfig());
    const cmp = fixture.componentInstance;
    const basic = cmp.visibleSteps()[0] as WorkflowStep;

    // Only one of the two rules passes → AND field stays hidden.
    cmp.setValue(basic, 'title', 'Baby');
    expect(cmp.visibleFields(basic).map(f => f.name)).not.toContain('both_rules');
  });

  it('merges Title and Sex into the first-name row', () => {
    const cfg = makeConfig();
    cfg.steps[0].fields.push(
      {
        id: 'f5', name: 'first_name', title: 'First name', type: 'text',
        isStandard: true, isRequired: true, isEditable: true,
        storageKey: 'first_name', width: 'third'
      },
      {
        id: 'f6', name: 'sex', title: 'Sex', type: 'select',
        isStandard: true, isRequired: true, isEditable: true,
        storageKey: 'sex', width: 'half',
        options: [
          { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' },
          { value: 'Other', label: 'Other' }
        ]
      }
    );
    const fixture = create(cfg);
    const el = fixture.nativeElement as HTMLElement;

    // Title + Sex ride the name row as compact selects — no standalone pill
    // row, no separate grid cells for either.
    expect(el.querySelectorAll('pf-select').length).toBe(2);
    expect(el.querySelector('.pf-bsel')).toBeNull();
    expect(el.textContent).toContain('First name');

    // Typing through the merged inputs still lands in normal form values.
    const cmp = fixture.componentInstance;
    const basic = cmp.visibleSteps()[0] as WorkflowStep;
    cmp.setValue(basic, 'title', 'Mr.');
    cmp.setValue(basic, 'sex', 'Male');
    expect(cmp.formValues()['basic_info::title']).toBe('Mr.');
    expect(cmp.formValues()['basic_info::sex']).toBe('Male');
  });

  it('single-page mode renders later steps as visible titled sections', () => {
    const fixture = create(makeConfig());
    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // Section header AND its field are on screen without any toggle click.
    expect(html).toContain('Additional details');
    expect(html).toContain('Occupation');
    // The old hidden-reveal affordance is gone.
    expect(html).not.toContain('Add more details');
  });
});
