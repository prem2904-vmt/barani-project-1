import { hasDoctorRole } from './doctor-role';

const roles = [
  { id: 'front', kind: null },
  { id: 'lab', kind: undefined },
  { id: 'cardio', kind: 'doctor' },
];

describe('hasDoctorRole', () => {
  it('is false when nothing is selected', () => {
    expect(hasDoctorRole(roles, [])).toBe(false);
  });
  it('is false when only non-doctor roles are selected', () => {
    expect(hasDoctorRole(roles, ['front', 'lab'])).toBe(false);
  });
  it('is true when a doctor-kind role is among the selection', () => {
    expect(hasDoctorRole(roles, ['front', 'cardio'])).toBe(true);
  });
  it('matches on kind, not on the role name/id — renaming is safe', () => {
    // A doctor role can have any id; only kind==="doctor" counts.
    expect(hasDoctorRole([{ id: 'x', kind: 'doctor' }], ['x'])).toBe(true);
    expect(hasDoctorRole([{ id: 'Doctor', kind: null }], ['Doctor'])).toBe(false);
  });
});
