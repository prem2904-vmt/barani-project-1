import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { WorkflowRendererComponent } from './workflow-renderer.component';
import { DynamicInputComponent } from '../dynamic-input/dynamic-input.component';
import { WorkflowConfig } from '../../models/workflow.model';

/**
 * `dynamic-input`'s data-entry use (test-parameter fields, `f.type ===
 * 'test_parameters'`) opts into `enterAdvances`; the general WorkflowField
 * path (registration-style fields) is untouched — every other dynamic-input
 * host keeps today's behaviour.
 */
function makeConfig(): WorkflowConfig {
  return {
    id: 'cfg', name: 'intake', title: 'Intake', module: 'lms', screenName: 'intake', version: 1,
    status: 'published', globalConditions: [], actions: [],
    steps: [
      {
        id: 's1', name: 'basic_info', title: 'Basic Info', type: 'entry',
        isRequired: true, canSkip: false, isStandard: true,
        afterStep: { defaultNextStep: null },
        fields: [
          { id: 'f1', name: 'occupation', title: 'Occupation', type: 'text',
            isStandard: false, isRequired: false, isEditable: true, storageKey: 'occupation', width: 'full' },
          { id: 'f2', name: 'params', title: 'Test parameters', type: 'test_parameters',
            isStandard: false, isRequired: false, isEditable: true, storageKey: 'params', width: 'full' },
        ]
      }
    ]
  } as WorkflowConfig;
}

describe('WorkflowRendererComponent — dynamic-input enterAdvances', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  function create() {
    const fixture = TestBed.createComponent(WorkflowRendererComponent);
    fixture.componentRef.setInput('config', makeConfig());
    fixture.componentRef.setInput('singlePage', true);
    fixture.componentRef.setInput('resources', {
      testParameters: [{ id: 'p1', name: 'appearance', title: 'Appearance', type: 'select', options: ['Clear', 'Turbid'] }],
    });
    fixture.detectChanges();
    return fixture;
  }

  it('the test-parameter field (test_parameters) opts in', () => {
    const f = create();
    const inputs = f.debugElement.queryAll(By.directive(DynamicInputComponent));
    const paramInput = inputs.find(i => (i.componentInstance as DynamicInputComponent).field.name === 'appearance');
    expect(paramInput).toBeTruthy();
    expect((paramInput!.componentInstance as DynamicInputComponent).enterAdvances).toBe(true);
  });

  it('a plain registration field stays off', () => {
    const f = create();
    const inputs = f.debugElement.queryAll(By.directive(DynamicInputComponent));
    const regInput = inputs.find(i => (i.componentInstance as DynamicInputComponent).field.name === 'occupation');
    expect(regInput).toBeTruthy();
    expect((regInput!.componentInstance as DynamicInputComponent).enterAdvances).toBe(false);
  });
});
