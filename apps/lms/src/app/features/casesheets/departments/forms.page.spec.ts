import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { FormSummary } from '../data/cases/case-models';
import { CasesApi } from '../data/cases/cases-api';
import { MockCasesApi } from '../data/cases/mock-cases-api';
import { NO_DEPARTMENT, FormsPage, buildDepartmentRows, deptNavigation, groupDepartments, initialOf, orderByDepartments } from './forms.page';

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

describe('buildDepartmentRows: every department of the lab, then other names', () => {
  const deps = [
    { key: 'ortho', name: 'Orthopaedics', sortOrder: 1 },
    { key: 'ent', name: 'ENT', sortOrder: 2 },
    { key: 'derm', name: 'Dermatology', sortOrder: 3 },
  ];
  const forms = orderByDepartments(
    [f('nose', 'Nose history', null, false, 'ent'), f('misc', 'Anything', null), f('knee', 'Knee pain', null, false, 'ortho')],
    deps,
  );

  it('lists departments in their order even when one has no case sheet, then "General" for the rest', () => {
    const rows = buildDepartmentRows(forms, deps);
    expect(rows.map((r) => r.name)).toEqual(['Orthopaedics', 'ENT', 'Dermatology', NO_DEPARTMENT]);
    expect(rows.map((r) => r.forms.length)).toEqual([1, 1, 0, 1]);
    expect(rows[0].key).toBe('ortho');
  });

  it('search matches departments and case sheets; a department name keeps all its case sheets', () => {
    expect(buildDepartmentRows(forms, deps, 'derm').map((r) => r.name)).toEqual(['Dermatology']);
    const byForm = buildDepartmentRows(forms, deps, 'knee');
    expect(byForm.map((r) => r.name)).toEqual(['Orthopaedics']);
    expect(byForm[0].forms.map((x) => x.key)).toEqual(['knee']);
    expect(buildDepartmentRows(forms, deps, 'zzz')).toEqual([]);
  });

  it('with no departments it is just the forms\' own groups (the old Prepare behaviour)', () => {
    expect(buildDepartmentRows([f('b', 'B', 'X'), f('a', 'A', 'Y')], []).map((r) => r.name)).toEqual(['X', 'Y']);
  });
});

describe('Prepare home', () => {
  let current: MockCasesApi;
  const noop = (): void => undefined;

  async function open(opts: { perms?: string[]; wide?: boolean; dept?: string; seed?: (api: MockCasesApi) => void } = {}) {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: opts.wide ?? true, addEventListener: noop, removeEventListener: noop });
    const api = (current = new MockCasesApi());
    api.forms.clear(); // the mock starts with one sample ENT form
    opts.seed?.(api);
    const params = new BehaviorSubject(convertToParamMap(opts.dept ? { dept: opts.dept } : {}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { hasPermission: (c: string) => (opts.perms ?? []).includes(c), user: signal(null) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
      ],
    });
    TestBed.overrideComponent(FormsPage, { add: { providers: [{ provide: CasesApi, useFactory: () => current }] } });
    const fx = TestBed.createComponent(FormsPage);
    for (let i = 0; i < 6; i++) {
      fx.detectChanges();
      await fx.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    return { fx, el, q: (s: string) => el.querySelector<HTMLElement>(s) };
  }
  const def = (title: string) => ({ title, pages: [{ key: 'p', title: 'P', fields: [{ key: 'a', kind: 'text', label: 'A' }] }] }) as never;
  const depts = (api: MockCasesApi) => api.departments.push({ key: 'ent', name: 'ENT', sortOrder: 1 }, { key: 'ortho', name: 'Orthopaedics', sortOrder: 2 });

  afterEach(() => TestBed.resetTestingModule());

  it('header row: "Prepare", the subtitle and "My case sheets" as a secondary button; no stray "Case sheets" subtitle', async () => {
    const { el, q } = await open({ seed: (a) => { depts(a); a.addForm('f1', def('Nose history'), 'nose', 'ent'); } });
    expect(q('.dp__title')!.textContent!.trim()).toBe('Prepare');
    expect(q('[data-sub]')!.textContent).toContain('Pick a department and a case sheet to start');
    const mine = q('[data-my-sheets]')!;
    expect(mine.classList.contains('pf-btn--secondary')).toBe(true);
    expect(mine.textContent).toContain('My case sheets');
    expect(el.querySelector('.dp__sub')!.textContent!.trim()).not.toBe('Case sheets');
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
  });

  it('no departments + builder permission: one empty state with "Add departments" to the new page', async () => {
    const { el, q } = await open({ perms: ['casesheet_forms_manage'] });
    expect(q('[data-empty="departments"]')!.textContent).toContain('No IPD departments yet');
    expect(q('[data-act="add-departments"]')!.getAttribute('href')).toBe('/admin/ipd/departments');
    expect(el.textContent).not.toContain('Select a department');
    expect(el.textContent).not.toContain('No case sheets yet');
  });

  it('no departments + no permission: ask the case sheet admin, no button', async () => {
    const { q } = await open();
    expect(q('[data-empty="departments"]')!.textContent).toContain('Ask your case sheet admin to add departments in Settings → IPD.');
    expect(q('[data-act="add-departments"]')).toBeNull();
  });

  it('departments but no published case sheet: says so; builders get a link to Case sheets, others are told to ask', async () => {
    const seed = (a: MockCasesApi) => depts(a);
    const b = await open({ perms: ['casesheet_forms_manage'], seed });
    expect(b.q('[data-empty="forms"]')!.textContent).toContain('No case sheets are published yet');
    expect(b.q('[data-act="open-myprefrontal"]')!.getAttribute('href')).toBe('/admin/ipd/myprefrontal');
    const d = await open({ seed });
    expect(d.q('[data-empty="forms"]')!.textContent).toContain('Ask your case sheet admin');
    expect(d.q('[data-act="open-myprefrontal"]')).toBeNull();
  });

  it('wide screen: the departments are listed with their counts and the first one opens by itself', async () => {
    const { el, q } = await open({ seed: (a) => { depts(a); a.addForm('f1', def('Nose history'), 'nose', 'ent'); a.addForm('f2', def('Knee pain'), 'knee', 'ortho'); a.addForm('f3', def('Ear history'), 'ear', 'ent'); } });
    const rows = [...el.querySelectorAll('[data-dept]')];
    expect(rows.map((r) => r.getAttribute('data-dept'))).toEqual(['ENT', 'Orthopaedics']);
    expect(rows[0].textContent).toContain('2 case sheets');
    expect(rows[1].textContent).toContain('1 case sheet');
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    expect(q('#dp-sh')!.textContent).toContain('ENT');
    expect([...el.querySelectorAll('[data-form]')].map((t) => t.getAttribute('data-form')).sort()).toEqual(['ear', 'nose']);
    expect(el.textContent).not.toContain('Select a department');
    expect(q('.dp')!.classList.contains('dp--picked')).toBe(false); // phone list stays the first step
  });

  it('phone: a two-step list; nothing is opened until one is picked (?dept=)', async () => {
    const seed = (a: MockCasesApi) => { depts(a); a.addForm('f1', def('Nose history'), 'nose', 'ent'); };
    const list = await open({ wide: false, seed });
    expect(list.q('#dp-sh')).toBeNull();
    expect(list.q('.dp')!.classList.contains('dp--picked')).toBe(false);
    const picked = await open({ wide: false, dept: 'ENT', seed });
    expect(picked.q('#dp-sh')!.textContent).toContain('ENT');
    expect(picked.q('.dp')!.classList.contains('dp--picked')).toBe(true);
  });

  it('a department with no case sheets is still listed, and its pane says so (builders can open Case sheets)', async () => {
    const { q, el } = await open({ perms: ['casesheet_forms_manage'], dept: 'Orthopaedics', seed: (a) => { depts(a); a.addForm('f1', def('Nose history'), 'nose', 'ent'); } });
    expect([...el.querySelectorAll('[data-dept]')].map((r) => r.getAttribute('data-dept'))).toEqual(['ENT', 'Orthopaedics']);
    expect(q('[data-dept="Orthopaedics"]')!.textContent).toContain('No case sheets yet');
    expect(q('[data-empty="dept-forms"]')!.textContent).toContain('No case sheets in Orthopaedics yet');
    expect(q('[data-empty="dept-forms"] [data-act="open-myprefrontal"]')).not.toBeNull();
  });

  it('a department the lab switched off is not offered (its forms are hidden from doctors)', async () => {
    const { el } = await open({ seed: (a) => { a.departments.push({ key: 'ent', name: 'ENT', sortOrder: 1 }); a.addForm('f1', def('Nose history'), 'nose', 'ent'); a.addForm('f2', def('Old sheet'), 'old', 'switched-off'); } });
    expect([...el.querySelectorAll('[data-form]')].map((t) => t.getAttribute('data-form'))).toEqual(['nose']);
  });

  it('the search box searches departments and case sheets', async () => {
    const { fx, el } = await open({ seed: (a) => { depts(a); a.addForm('f1', def('Nose history'), 'nose', 'ent'); a.addForm('f2', def('Knee pain'), 'knee', 'ortho'); } });
    const set = async (v: string) => {
      (fx.componentInstance as unknown as { onSearch(v: string): void }).onSearch(v);
      fx.detectChanges();
      await fx.whenStable();
      await new Promise((r) => setTimeout(r, 0));
      fx.detectChanges();
    };
    await set('knee');
    expect([...el.querySelectorAll('[data-dept]')].map((r) => r.getAttribute('data-dept'))).toEqual(['Orthopaedics']);
    await set('ENT');
    expect([...el.querySelectorAll('[data-dept]')].map((r) => r.getAttribute('data-dept'))).toEqual(['ENT']);
    await set('zzz');
    expect(el.querySelector('[data-empty="search"]')!.textContent).toContain('Nothing matches');
  });

  it('copy: no "AI", no emoji', async () => {
    const { el } = await open({ seed: (a) => { depts(a); a.addForm('f1', def('Nose history'), 'nose', 'ent'); } });
    expect(el.textContent).not.toMatch(/\bAI\b/);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
