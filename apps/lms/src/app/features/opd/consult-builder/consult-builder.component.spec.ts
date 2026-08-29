import { ConsultBuilderComponent } from './consult-builder.component';
import { ConsultDraft } from '../../../shared/opd/consult';

/** No injected deps, so the component can be exercised directly (no TestBed). */
function make(): ConsultBuilderComponent {
  const c = new ConsultBuilderComponent();
  c.doctors = [
    { id: 'd1', name: 'Dr Asha', department: 'General Medicine' },
    { id: 'd2', name: 'Dr Ravi' },
  ];
  return c;
}

describe('ConsultBuilderComponent (shell)', () => {
  it('cannot submit until a doctor is chosen', () => {
    const c = make();
    expect(c.canSubmit()).toBe(false);
    c.onDoctor('d1');
    expect(c.canSubmit()).toBe(true);
  });

  it('clamps a negative/invalid fee to 0', () => {
    const c = make();
    c.onFee('-50'); expect(c.fee()).toBe(0);
    c.onFee('abc'); expect(c.fee()).toBe(0);
    c.onFee('300'); expect(c.fee()).toBe(300);
  });

  it('emits a draft with the resolved doctor + fee and empty procedures', () => {
    const c = make();
    let emitted: ConsultDraft | undefined;
    c.added.subscribe(d => (emitted = d));
    c.onDoctor('d1');
    c.onFee('250');
    c.submit();
    expect(emitted).toEqual({ doctorId: 'd1', doctorName: 'Dr Asha', fee: 250, procedures: [] });
  });

  it('does not emit when no doctor is selected', () => {
    const c = make();
    let called = false;
    c.added.subscribe(() => (called = true));
    c.submit();
    expect(called).toBe(false);
  });
});
