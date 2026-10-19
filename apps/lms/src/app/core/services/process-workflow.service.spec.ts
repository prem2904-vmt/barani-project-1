import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { ProcessWorkflowService } from './process-workflow.service';

/**
 * Transport routing (owner, 2026-09-26): a Sample Collection action in ANY work
 * area is only a link to the collection page. Whether the sample goes collected →
 * dispatch → lab intake → queue is decided by dispatch + lab_intake alone, and
 * must mirror the backend SampleService.ShouldAutoReceive.
 */
type Act = { type: string; categoryId: string; enabled: boolean };

async function withWorkflow(actions: Act[] | null): Promise<ProcessWorkflowService> {
  const record = actions
    ? { configJson: JSON.stringify({
        categories: [{ id: 'frontdesk' }, { id: 'lab' }, { id: 'collection' }],
        actions: actions.map((a, i) => ({ id: `a${i}`, order: i, ...a })),
      }) }
    : null;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: ApiService, useValue: { get: () => of(record) } }],
  });
  const svc = TestBed.inject(ProcessWorkflowService);
  await svc.ensureLoaded();
  return svc;
}

const base = (dispatch: boolean, intake: boolean, ...collect: string[]): Act[] => [
  { type: 'patient_registration', categoryId: 'frontdesk', enabled: true },
  { type: 'dispatch', categoryId: 'frontdesk', enabled: dispatch },
  { type: 'lab_intake', categoryId: 'lab', enabled: intake },
  ...collect.map(c => ({ type: 'sample_collection', categoryId: c, enabled: true })),
];

describe('ProcessWorkflowService.dispatchStepEnabled — transport only', () => {
  it('collection in Lab + Frontdesk with dispatch & intake on ⇒ dispatch step exists', async () => {
    const svc = await withWorkflow(base(true, true, 'frontdesk', 'lab'));
    expect(svc.collectsInLab()).toBe(true);          // still drives the Collect link
    expect(svc.dispatchStepEnabled()).toBe(true);    // …but never the transport
  });

  it('collection only in Lab with dispatch & intake on ⇒ dispatch step exists', async () => {
    const svc = await withWorkflow(base(true, true, 'lab'));
    expect(svc.dispatchStepEnabled()).toBe(true);
  });

  it.each(['frontdesk', 'collection', 'lab'])('placement %s never changes routing', async area => {
    expect((await withWorkflow(base(true, true, area))).dispatchStepEnabled()).toBe(true);
    expect((await withWorkflow(base(false, true, area))).dispatchStepEnabled()).toBe(false);
  });

  it.each([[false, true], [true, false], [false, false]])(
    'dispatch=%s intake=%s ⇒ auto-receive (no dispatch step)', async (d, i) => {
      expect((await withWorkflow(base(d, i, 'frontdesk', 'lab'))).dispatchStepEnabled()).toBe(false);
    });

  it('no active workflow ⇒ classic flow keeps dispatch', async () => {
    expect((await withWorkflow(null)).dispatchStepEnabled()).toBe(true);
  });
});
