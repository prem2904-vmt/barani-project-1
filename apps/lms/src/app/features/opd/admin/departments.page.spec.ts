import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { OpdAdminApi, OpdDepartmentRow, OpdFormListRow, OpdServiceRow } from './opd-admin.api';
import { OpdDepartmentsPage } from './departments.page';

/**
 * OPD Master — departments (filter side card) + the services grid (batch
 * Save), the department's consultation form picked from the ONE library,
 * the lazy starter set on first open, confirms through DialogService.
 */
const DEPTS: OpdDepartmentRow[] = [
  { id: 'gm', name: 'General Medicine', code: 'GM', defaultFormId: 'f-gen', sortOrder: 1, isActive: true },
  { id: 'ent', name: 'ENT', code: 'ENT', defaultFormId: 'f-ent', sortOrder: 2, isActive: true },
];
const FORMS: OpdFormListRow[] = [
  { id: 'f-gen', name: 'General assessment', code: 'g', isActive: true, publishedVersion: 1, questionCount: 6, usedByServices: 1, usedByDepartments: 1, updatedAt: '' },
  { id: 'f-ent', name: 'ENT assessment', code: 'e', isActive: true, publishedVersion: 3, draftVersion: 4, questionCount: 11, usedByServices: 1, usedByDepartments: 1, updatedAt: '' },
  { id: 'f-proc', name: 'Procedure note', code: 'p', isActive: true, publishedVersion: 1, questionCount: 4, usedByServices: 1, usedByDepartments: 0, updatedAt: '' },
];
const svc = (o: Partial<OpdServiceRow> & { id: string; departmentId: string }): OpdServiceRow => ({
  name: o.id, code: o.id.toUpperCase(), category: 'consultation', priceMode: 'common', commonPrice: 500, taxSlab: 0, sortOrder: 1, isActive: true, doctorPrices: [], ...o,
});
const SERVICES = [
  svc({ id: 'gm-c01', departmentId: 'gm' }),
  svc({ id: 'ent-c01', departmentId: 'ent', priceMode: 'per_doctor', doctorPrices: [{ doctorUserId: 'd1', price: 600, isActive: true }] }),
  svc({ id: 'ent-p01', departmentId: 'ent', category: 'procedure', formId: 'f-proc', commonPrice: 1500 }),
];

function render(opts: { confirm?: boolean; prompt?: string | null } = {}) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    ensureStarter: vi.fn(() => of({ seeded: true })),
    departments: vi.fn(() => of(DEPTS)),
    services: vi.fn(() => of(SERVICES.map((s) => ({ ...s })))),
    forms: vi.fn(() => of(FORMS)),
    saveDepartments: vi.fn((rows: OpdDepartmentRow[]) => of(DEPTS.map((d) => ({ ...d, ...(rows.find((r) => r.id === d.id) ?? {}) })))),
    saveServices: vi.fn((rows: OpdServiceRow[]) => of(rows.map((r) => ({ ...r, doctorPrices: [] })))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true), prompt: vi.fn(async () => opts.prompt ?? null) };
  const router = { navigate: vi.fn() };
  TestBed.configureTestingModule({
    imports: [OpdDepartmentsPage],
    providers: [
      { provide: OpdAdminApi, useValue: api }, { provide: ToastService, useValue: toasts }, { provide: DialogService, useValue: dialog },
      { provide: Router, useValue: router }, { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
    ],
  });
  TestBed.overrideComponent(OpdDepartmentsPage, { set: { imports: [NgTemplateOutlet], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  const f = TestBed.createComponent(OpdDepartmentsPage);
  f.detectChanges();
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, api, toasts, dialog, router };
}

describe('OPD Master page', () => {
  it('first open asks for the starter set, then loads departments, services and the library', () => {
    const { api, el, c } = render();
    expect(api.ensureStarter).toHaveBeenCalled();
    expect(api.departments).toHaveBeenCalled();
    expect(c.services().length).toBe(3);
    const names = Array.from(el.querySelectorAll('.oa-li__name')).map((x) => x.textContent?.trim());
    expect(names).toEqual(['All departments', 'General Medicine', 'ENT']);
    expect(el.textContent).toContain('Form · ENT assessment');
  });

  it('picking a department filters the grid and hides the Department column', () => {
    const { c } = render();
    c.pickDept('ent');
    expect(c.visible().map((s) => s.id)).toEqual(['ent-c01', 'ent-p01']);
    expect(c.colDefs().find((d) => d.field === 'departmentId')!.hide).toBe(true);
    c.cat.set('procedure');
    expect(c.visible().map((s) => s.id)).toEqual(['ent-p01']);
  });

  it("a service's form is its override, else the department's", () => {
    const { c } = render();
    expect(c.formName(c.effectiveForm(SERVICES[1]))).toBe('ENT assessment');
    expect(c.formName(c.effectiveForm(SERVICES[2]))).toBe('Procedure note');
  });

  it("changing a department's form saves it and says overrides keep theirs", () => {
    const { c, api, toasts } = render();
    c.setDeptForm(DEPTS[1], 'f-gen');
    expect(api.saveDepartments).toHaveBeenCalledWith([expect.objectContaining({ id: 'ent', defaultFormId: 'f-gen', code: 'ENT' })]);
    expect(toasts.success.mock.calls[0][0]).toContain('1 service with an override keep');
  });

  it('grid edits wait for ONE Save that sends only the changed rows', () => {
    const { c, api } = render();
    const row = { ...c.services()[0], commonPrice: 450 };
    c.onCell({ data: row } as never);
    expect(c.dirtyCount()).toBe(1);
    c.save();
    const sent = api.saveServices.mock.calls[0][0] as unknown as Record<string, unknown>[];
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ id: 'gm-c01', commonPrice: 450 });
    expect(sent[0]).not.toHaveProperty('doctorPrices');
    expect(sent[0]).not.toHaveProperty('_dirty');
    expect(c.dirtyCount()).toBe(0);
  });

  it('per-doctor price shows the range; editing that cell is off', () => {
    const { c } = render();
    const price = c.colDefs().find((d) => d.colId === 'price')!;
    expect((price.editable as (p: unknown) => boolean)({ data: SERVICES[1] })).toBe(false);
    expect((price.editable as (p: unknown) => boolean)({ data: SERVICES[0] })).toBe(true);
  });

  it('turning a department off asks first; No keeps it on', async () => {
    const { c, api, dialog } = render({ confirm: false });
    await c.toggleDept(DEPTS[0]);
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.saveDepartments).not.toHaveBeenCalled();
  });

  it('+ Add asks for a name and derives a unique code', async () => {
    const { c, api } = render({ prompt: 'Dermatology' });
    await c.addDepartment();
    expect(api.saveDepartments).toHaveBeenCalledWith([expect.objectContaining({ name: 'Dermatology', code: 'DERM', isActive: true })]);
  });

  it('Add service and + New form open the editors (a new form attaches to its department)', () => {
    const { c, router } = render();
    c.pickDept('ent');
    c.addService();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/opd/services', 'new'], { queryParams: { departmentId: 'ent' } });
    c.newForm(DEPTS[1]);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/opd/forms', 'new'], { queryParams: { departmentId: 'ent' } });
  });

  it('never renders a native select', () => {
    expect(render().el.querySelector('select')).toBeNull();
  });
});
