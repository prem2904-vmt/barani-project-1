import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { LabDepartmentsComponent } from './lab-departments.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { DEPARTMENT_ORIGIN_LABEL, departmentErrorMessage, departmentOrigin } from '../../../shared/utils/test-origin';

/**
 * Lab › Departments and lab spaces (owner 2026-11-17). The lab's own departments
 * ("Made here") can be added, renamed and deleted; the catalogue's ("From the
 * catalogue") only switch on or off. The lab-spaces board moved here from Branches.
 */
const MASTER = { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true, catalogKey: 'HAE', metadata: null };
const OWN = { id: 'd2', name: 'Cytogenetics', code: 'CYTO', isActive: true, catalogKey: null, metadata: '{"labMade":true}' };

function render(opts: { query?: string; confirm?: boolean } = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => of(
      url.startsWith('/api/tenants/departments') ? [MASTER, OWN]
        : url.startsWith('/api/tenants/branches') ? [{ id: 'b1', name: 'Main', code: 'MAIN', isActive: true }]
          : url === '/api/tenants/lab-spaces' ? [{ id: 's1', branchId: 'b1', name: 'Micro', code: 'MIC', order: 0 }]
            : url === '/api/tenants/department-space-links' ? [{ branchId: 'b1', departmentId: 'd1', spaceId: 's1' }]
              : [])),
    post: vi.fn((_u: string, b: any) => of({ id: 'd3', code: b.code, name: b.name, isActive: true, catalogKey: null, metadata: '{"labMade":true}' })),
    patch: vi.fn(() => of({})),
    put: vi.fn(() => of({})),
    delete: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    imports: [LabDepartmentsComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
    ],
  });
  const f = TestBed.createComponent(LabDepartmentsComponent);
  f.detectChanges();
  const c = f.componentInstance as any;
  if (opts.query) { c.tab.set(opts.query); f.detectChanges(); }
  const el = f.nativeElement as HTMLElement;
  const q = (s: string) => el.querySelector(s) as HTMLElement | null;
  const type = (s: string, v: string) => { const i = q(s) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')); f.detectChanges(); };
  return { f, c, api, toasts, dialog, el, q, type };
}

describe('departmentOrigin / messages', () => {
  it('a CatalogKey, a legacy un-keyed row and bad JSON are the catalogue; the labMade marker is the lab', () => {
    expect(departmentOrigin(MASTER)).toBe('catalogue');
    expect(departmentOrigin({ catalogKey: null, metadata: null })).toBe('catalogue');
    expect(departmentOrigin({ catalogKey: null, metadata: 'not json' })).toBe('catalogue');
    expect(departmentOrigin({ catalogKey: '', metadata: '{"labMade":true}' })).toBe('lab');
    expect(departmentOrigin({ catalogKey: 'X', metadata: '{"labMade":true}' })).toBe('catalogue');
  });
  it('plain words for the server codes, server text for others', () => {
    expect(departmentErrorMessage('dept_name_taken', 'x')).toMatch(/already exists/);
    expect(departmentErrorMessage('dept_code_taken', 'x')).toMatch(/code is already used/);
    expect(departmentErrorMessage('dept_in_use', 'x')).toMatch(/Switch it off/);
    expect(departmentErrorMessage('other', 'server words')).toBe('server words');
  });
});

describe('Lab departments — Departments tab', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists every department, marks the origin, and only lab-made ones get rename / delete', () => {
    const { el, q } = render();
    expect(el.textContent).toContain('Haematology');
    expect(el.textContent).toContain('Cytogenetics');
    expect(q('[data-testid="ld-row-HEM"] [data-testid="ld-origin"]')!.textContent).toContain(DEPARTMENT_ORIGIN_LABEL.catalogue);
    expect(q('[data-testid="ld-row-CYTO"] [data-testid="ld-origin"]')!.textContent).toContain(DEPARTMENT_ORIGIN_LABEL.lab);
    expect(q('[data-testid="ld-row-HEM"] [data-testid="ld-rename"]')).toBeNull();
    expect(q('[data-testid="ld-row-HEM"] [data-testid="ld-delete"]')).toBeNull();
    expect(q('[data-testid="ld-row-CYTO"] [data-testid="ld-rename"]')).not.toBeNull();
    expect(q('[data-testid="ld-row-CYTO"] [data-testid="ld-delete"]')).not.toBeNull();
    // every row has the on / off switch
    expect(el.querySelectorAll('[data-testid="ld-switch"]').length).toBe(2);
  });

  it('uses no native select / datalist / checkbox controls', () => {
    const { el } = render();
    expect(el.querySelector('select, datalist, input[type="checkbox"]')).toBeNull();
  });

  it('on / off works for a catalogue department (PATCH isActive)', () => {
    const { f, api, el } = render();
    (el.querySelector('[data-testid="ld-row-HEM"] [data-testid="ld-switch"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d1', { isActive: false });
    expect(el.querySelector('[data-testid="ld-row-HEM"] [data-testid="ld-switch"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('Add department: name + code POST, the new row appears marked "Made here"', () => {
    const { f, c, api, q, type, el } = render();
    c.toggleAdd(); f.detectChanges();
    type('[data-testid="ld-add-name"]', 'Toxicology');
    type('[data-testid="ld-add-code"]', 'tox');
    (q('[data-testid="ld-add-save"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/tenants/departments', { name: 'Toxicology', code: 'TOX' });
    expect(q('[data-testid="ld-row-TOX"] [data-testid="ld-origin"]')!.textContent).toContain('Made here');
    expect(el.querySelector('[data-testid="ld-add-form"]')).toBeNull();
  });

  it('a blank name or code is refused before any request', () => {
    const { f, c, api, q } = render();
    c.toggleAdd(); f.detectChanges();
    (q('[data-testid="ld-add-save"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(api.post).not.toHaveBeenCalled();
    expect(q('[data-testid="ld-add-name-err"]')).not.toBeNull();
    expect(q('[data-testid="ld-add-code-err"]')).not.toBeNull();
  });

  it('a duplicate name (409 dept_name_taken) shows in plain words on the name field', () => {
    const { f, c, api, q, type } = render();
    api.post.mockImplementation(() => throwError(() => new ApiError('A department named "x" already exists.', 'dept_name_taken', 'name', undefined, 409)));
    c.toggleAdd(); f.detectChanges();
    type('[data-testid="ld-add-name"]', 'haematology');
    type('[data-testid="ld-add-code"]', 'HX');
    (q('[data-testid="ld-add-save"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(q('[data-testid="ld-add-name-err"]')!.textContent).toMatch(/already exists/);
    expect(q('[data-testid="ld-add-form"]')).not.toBeNull();
  });

  it('rename a lab-made department: PATCH name; a clash stays inline', () => {
    const { f, c, api, q, type } = render();
    (q('[data-testid="ld-row-CYTO"] [data-testid="ld-rename"]') as HTMLButtonElement).click(); f.detectChanges();
    type('[data-testid="ld-rename-input"]', 'Cytology');
    (q('[data-testid="ld-rename-save"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d2', { name: 'Cytology' });
    expect(c.departments().find((d: any) => d.id === 'd2').name).toBe('Cytology');

    api.patch.mockImplementation(() => throwError(() => new ApiError('dup', 'dept_name_taken', 'name', undefined, 409)));
    (q('[data-testid="ld-row-CYTO"] [data-testid="ld-rename"]') as HTMLButtonElement).click(); f.detectChanges();
    type('[data-testid="ld-rename-input"]', 'Haematology');
    (q('[data-testid="ld-rename-save"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(q('[data-testid="ld-rename-err"]')!.textContent).toMatch(/already exists/);
  });

  it('delete asks first (DialogService), then DELETE; declining changes nothing', async () => {
    const no = render({ confirm: false });
    (no.q('[data-testid="ld-row-CYTO"] [data-testid="ld-delete"]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(no.dialog.confirm).toHaveBeenCalled();
    expect(no.api.delete).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const yes = render();
    (yes.q('[data-testid="ld-row-CYTO"] [data-testid="ld-delete"]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(yes.api.delete).toHaveBeenCalledWith('/api/tenants/departments/d2');
    yes.f.detectChanges();
    expect(yes.q('[data-testid="ld-row-CYTO"]')).toBeNull();
  });

  it('a department in use (409 dept_in_use) is explained, not deleted', async () => {
    const { api, toasts, q, c } = render();
    api.delete.mockImplementation(() => throwError(() => new ApiError('in use', 'dept_in_use', undefined, undefined, 409)));
    (q('[data-testid="ld-row-CYTO"] [data-testid="ld-delete"]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/Switch it off/));
    expect(c.departments().some((d: any) => d.id === 'd2')).toBe(true);
  });
});

describe('Lab departments — Lab spaces tab (moved from Branches)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the per-branch board: lanes, space name + code, placed departments', () => {
    const { f, c, el } = render({ query: 'spaces' });
    c.toggleOpen('b1'); f.detectChanges();
    expect(el.querySelectorAll('.pf-lane').length).toBe(2); // default Lab + one space
    expect(el.textContent).toContain('Lab (default)');
    expect((el.querySelector('.pf-lane-name-input') as HTMLInputElement).value).toBe('Micro');
    expect((el.querySelector('.pf-lane-code-input--missing, .pf-lane + .pf-lane .pf-lane-code-input') as HTMLInputElement).value).toBe('MIC');
    expect(c.branchDeptsInSpace('s1').map((d: any) => d.id)).toEqual(['d1']);
    expect(c.branchDeptsNoSpace('b1').map((d: any) => d.id)).toEqual(['d2']);
    expect(el.querySelector('[data-testid="br-sample-id-note"]')).not.toBeNull();
  });

  it('moving a department re-places it for that branch only', () => {
    const { c, api } = render({ query: 'spaces' });
    c.setDeptSpace(c.departments().find((d: any) => d.id === 'd2'), 'b1', 's1');
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d2/space', { spaceId: 's1', branchId: 'b1' });
    expect(c.branchDeptsInSpace('s1').length).toBe(2);
  });

  it('?tab= picks the tab', () => {
    const { c } = render({ query: 'spaces' });
    expect(c.tab()).toBe('spaces');
  });
});
