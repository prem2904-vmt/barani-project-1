import { describe, expect, it } from 'vitest';
import { FormSummary } from '../data/cases/case-models';
import { NO_DEPARTMENT, deptNavigation, groupDepartments, initialOf, orderByDepartments } from './forms.page';

const f = (key: string, title: string, specialty: string | null, pinned = false, departmentKey: string | null = null): FormSummary => ({
  id: key,
  key,
  title,
  specialty,
  departmentKey,
  publishedVersionId: 'v',
  versionNo: 1,
  publishedAt: null,
  pinned,
});

describe('departments (legacy speciality page)', () => {
  const forms = [
    f('nose', 'Nose history', 'ENT'),
    f('knee', 'Knee pain', 'Orthopaedics'),
    f('ear', 'Ear history', 'ENT', true),
    f('misc', 'Anything', null),
    f('blank', 'Blank dept', '  '),
  ];

  it('groups by specialty in first-seen order, unnamed under General', () => {
    const d = groupDepartments(forms);
    expect(d.map((x) => x.name)).toEqual(['ENT', 'Orthopaedics', NO_DEPARTMENT]);
    expect(d[2].forms.map((x) => x.key)).toEqual(['misc', 'blank']);
  });

  it('puts pinned case sheets first inside a department', () => {
    expect(groupDepartments(forms)[0].forms.map((x) => x.key)).toEqual(['ear', 'nose']);
  });

  it('search keeps matching case sheets (title or department) and drops empty departments', () => {
    expect(groupDepartments(forms, 'knee').map((d) => d.name)).toEqual(['Orthopaedics']);
    expect(groupDepartments(forms, 'ent')[0].forms).toHaveLength(2);
    expect(groupDepartments(forms, 'zzz')).toEqual([]);
  });

  it('tile initial is the first letter or digit, upper case', () => {
    expect(initialOf('nose history')).toBe('N');
    expect(initialOf('  (2) ENT')).toBe('2');
    expect(initialOf('')).toBe('?');
  });
});

describe('departments: master departments (Prefrontal, plan §3.3)', () => {
  const deps = [
    { key: 'ortho', name: 'Orthopaedics', sortOrder: 1 },
    { key: 'ent', name: 'ENT', sortOrder: 2 },
  ];

  it('orders forms by the master department order and names them by the department', () => {
    const forms = [
      f('nose', 'Nose history', 'old ent text', false, 'ent'),
      f('misc', 'Anything', null),
      f('knee', 'Knee pain', null, false, 'ortho'),
      f('gone', 'Retired dept', 'Old', false, 'missing'),
    ];
    const d = groupDepartments(orderByDepartments(forms, deps));
    expect(d.map((x) => x.name)).toEqual(['Orthopaedics', 'ENT', NO_DEPARTMENT, 'Old']);
    expect(d[1].forms[0].specialty).toBe('ENT');
  });

  it('no master departments = the forms as they came (Prepare behaviour)', () => {
    const forms = [f('b', 'B', 'X'), f('a', 'A', 'Y')];
    expect(orderByDepartments(forms, []).map((x) => x.key)).toEqual(['b', 'a']);
  });
});

describe('departments: picking a department keeps the patient (lab, WP11)', () => {
  it('merges ?dept= into the current query params, so ?patientId= survives', () => {
    expect(deptNavigation('ENT', null)).toEqual({ queryParams: { dept: 'ENT' }, queryParamsHandling: 'merge', replaceUrl: false });
  });

  it('switching or clearing a department replaces the history entry', () => {
    expect(deptNavigation('ENT', 'General Medicine').replaceUrl).toBe(true);
    expect(deptNavigation(null, 'ENT')).toEqual({ queryParams: { dept: null }, queryParamsHandling: 'merge', replaceUrl: true });
  });
});
