import { casesheetNavFor } from './casesheet-nav';

/** Where the case-sheet screens go in each app mode (Prepare hard-coded /forms, /cases, /cases/:id). */
describe('case-sheet navigation per app mode', () => {
  it('public site: Departments /, Cases /cases, a sheet /cases/:id (Prepare, renamed)', () => {
    const n = casesheetNavFor('casesheets');
    expect(n.departments('p1')).toEqual({ path: '/' });
    expect(n.list('p1')).toBe('/cases');
    expect(n.sheet('a b')).toBe('/cases/a%20b');
  });

  it('lab: Departments FOR the patient, the patient\'s sheets, /casesheets/:id; no patient = the front desk', () => {
    const n = casesheetNavFor('lms');
    expect(n.departments('p1')).toEqual({ path: '/casesheets/new', queryParams: { patientId: 'p1' } });
    expect(n.list('p1')).toBe('/casesheets/patient/p1');
    expect(n.sheet('s1')).toBe('/casesheets/s1');
    expect(n.departments(null)).toEqual({ path: '/frontdesk' });
    expect(n.list(null)).toBe('/frontdesk');
  });
});
