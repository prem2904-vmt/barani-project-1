import { neuronAccess } from './neuron-access';

const has = (...held: string[]) => (codes: string[]) => codes.some(c => held.includes(c));
describe('Neuron access (mirrors the server)', () => {
  it('view_report alone: read + insert, no write, no patient names', () => {
    expect(neuronAccess(has('view_report'))).toEqual({ read: true, write: false, insert: true, patientNames: false });
  });
  it('enter_result / validate_result: everything but patient names', () => {
    expect(neuronAccess(has('enter_result'))).toEqual({ read: true, write: true, insert: true, patientNames: false });
    expect(neuronAccess(has('validate_result')).write).toBe(true);
  });
  it('view_analytics: read + write, no insert', () => {
    expect(neuronAccess(has('view_analytics'))).toEqual({ read: true, write: true, insert: false, patientNames: false });
  });
  it('export_patient_data alone grants nothing but the names', () => {
    expect(neuronAccess(has('export_patient_data'))).toEqual({ read: false, write: false, insert: false, patientNames: true });
  });
  it('nobody holds nothing', () => {
    expect(neuronAccess(has())).toEqual({ read: false, write: false, insert: false, patientNames: false });
  });
});
