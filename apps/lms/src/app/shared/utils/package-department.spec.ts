import { bundleMemberIds, departmentKeys, isPackage, memberDepartmentNames, shownDepartmentName } from './package-department';

/** Owner 2026-09-27: a package carries no department; filters follow its members. */
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const rows = [
  { id: 't1', type: 'individual', department: { name: 'Haematology' } },
  { id: 't2', type: 'individual', department: { name: 'Biochemistry' } },
  { id: 't3', type: 'individual', department: null },
  { id: 'p1', type: 'profile', department: { name: 'Biochemistry' }, parameters: items('t2') },
  { id: 'k1', type: 'package', department: { name: 'Legacy' }, parameters: items('t1', 'p1', 'k2', 'missing') },
  { id: 'k2', type: 'package', department: null, parameters: items('t3', 'k1') },   // cycle back to k1
];
const byId = new Map(rows.map(r => [r.id, r] as const));
const row = (id: string) => byId.get(id)!;

describe('package-department', () => {
  it('a package shows no department, even a legacy stored one', () => {
    expect(isPackage(row('k1'))).toBe(true);
    expect(shownDepartmentName(row('k1'))).toBe('');
    expect(shownDepartmentName(row('t1'))).toBe('Haematology');
    expect(shownDepartmentName(row('p1'))).toBe('Biochemistry');
    expect(shownDepartmentName(null)).toBe('');
  });

  it('reads bundle members; bad JSON is empty', () => {
    expect(bundleMemberIds(row('k1'))).toEqual(['t1', 'p1', 'k2', 'missing']);
    expect(bundleMemberIds({ type: 'package', parameters: '{oops' })).toEqual([]);
    expect(bundleMemberIds({ type: 'package' })).toEqual([]);
  });

  it('member departments walk profiles and nested packages, cycle-safe', () => {
    expect(memberDepartmentNames(row('k1'), byId)).toEqual(['Biochemistry', 'Haematology']);
    expect(memberDepartmentNames(row('k2'), byId)).toEqual(['Biochemistry', 'Haematology']);
  });

  it('filter keys: own department for tests/profiles, members for a package', () => {
    expect(departmentKeys(row('t1'), byId, 'Unassigned')).toEqual(['Haematology']);
    expect(departmentKeys(row('t3'), byId, 'Unassigned')).toEqual(['Unassigned']);
    expect(departmentKeys(row('p1'), byId, 'Unassigned')).toEqual(['Biochemistry']);
    expect(departmentKeys(row('k1'), byId, 'Unassigned')).toEqual(['Biochemistry', 'Haematology']);
    expect(departmentKeys({ id: 'k9', type: 'package', parameters: items() }, byId, 'Unassigned')).toEqual([]);
  });
});
