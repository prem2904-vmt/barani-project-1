import { patientSnapshot } from './lab-patient';

/** The patient block a lab sheet carries, from the LMS patient (plan §3.5: age from the DOB). */
describe('lab patient snapshot', () => {
  const now = new Date('2026-11-10T10:00:00Z');

  it('display name (with title), live age from the DOB, sex, MRN as the reference', () => {
    expect(
      patientSnapshot(
        { title: 'Mr.', firstName: 'Ravi', fathersName: 'Kumar', sex: 'Male', mrn: 'DEL-1', dateOfBirth: '1990-01-01T00:00:00Z' },
        now,
      ),
    ).toEqual({ name: 'Mr. Ravi Kumar', age: '36 years', sex: 'Male', ref: 'DEL-1' });
  });

  it('infants in months; unknowns are null; the server display name wins', () => {
    const s = patientSnapshot(
      { firstName: 'x', fathersName: 'y', displayName: 'Baby of Priya', sex: undefined, mrn: undefined, dateOfBirth: '2026-03-01T00:00:00Z' },
      now,
    );
    expect(s).toEqual({ name: 'Baby of Priya', age: '8 months', sex: null, ref: null });
  });

  it('keeps to the API limits (name 200, sex 20, ref 80)', () => {
    const s = patientSnapshot({ firstName: 'a'.repeat(300), fathersName: '', sex: 'x'.repeat(40), mrn: 'm'.repeat(100) }, now);
    expect(s.name!.length).toBe(200);
    expect(s.sex!.length).toBe(20);
    expect(s.ref!.length).toBe(80);
  });
});
