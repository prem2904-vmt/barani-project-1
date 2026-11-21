import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { LabDepartmentsComponent } from './lab-departments.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { sortsAndFilters } from '../../../shared/utils/work-grid';
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

  /** Grid helpers: a column's renderer output for a row (the grid's DOM is AG-Grid's). */
  const cell = (c: any, colId: string, d: any) => c.colDefs().find((x: any) => x.colId === colId).cellRenderer({ data: d }) as HTMLElement;
  const dept = (c: any, code: string) => c.departments().find((d: any) => d.code === code);

  it('every data column sorts and filters on its real value; actions is exempt', () => {
    const { c } = render();
    const cols = c.colDefs() as any[];
    const data = cols.filter((x) => x.colId !== 'actions');
    expect(data.map((x) => x.colId)).toEqual(['name', 'code', 'origin', 'status']);
    for (const x of data) expect(sortsAndFilters(x), x.colId).toBe(true);
    expect(cols.find((x) => x.colId === 'actions').sortable).toBe(false);
  });

  it('Test Master grid: every department, its origin, and only lab-made ones get rename / delete', () => {
    const { c, el } = render();
    expect(el.querySelector('.pf-sg-main pf-data-grid ag-grid-angular')).not.toBeNull();
    expect(c.visibleDepartments().map((d: any) => d.name)).toEqual(['Haematology', 'Cytogenetics']);
    expect(c.colDefs().map((x: any) => x.colId)).toEqual(['name', 'code', 'origin', 'status', 'actions']);
    // Pinned right at every size (owner 2026-11-21: row actions were cut off at the edge on phone / tablet).
    expect(c.colDefs().find((x: any) => x.colId === 'actions').pinned).toBe('right');
    expect(cell(c, 'origin', MASTER).textContent).toContain(DEPARTMENT_ORIGIN_LABEL.catalogue);
    expect(cell(c, 'origin', OWN).textContent).toContain(DEPARTMENT_ORIGIN_LABEL.lab);
    expect(c.actionsFor(MASTER)).toEqual([]);
    expect(c.actionsFor(OWN).map((a: any) => a.label)).toEqual(['Rename', 'Delete']);
    // name is inline-editable for lab-made rows only
    const nameCol = c.colDefs().find((x: any) => x.colId === 'name');
    expect(nameCol.editable({ data: MASTER })).toBe(false);
    expect(nameCol.editable({ data: OWN })).toBe(true);
    // every row has the on / off switch
    expect(cell(c, 'status', MASTER).querySelector('[role="switch"]')).not.toBeNull();
  });

  it('LEFT side card = the tree: Departments, Lab spaces and its branches', () => {
    const { el } = render();
    const side = el.querySelector('.pf-sg-panels')!.firstElementChild!;
    expect(side.classList.contains('ld-side')).toBe(true);
    expect(side.querySelector('[data-testid="ld-node-departments"]')).not.toBeNull();
    expect(side.querySelector('[data-testid="ld-node-spaces"]')).not.toBeNull();
    expect(side.querySelector('[data-testid="ld-branch-b1"]')!.textContent).toContain('1 space');
  });

  it('uses no native select / datalist / checkbox controls', () => {
    const { el } = render();
    expect(el.querySelector('select, datalist, input[type="checkbox"]')).toBeNull();
  });

  it('on / off works for a catalogue department (PATCH isActive); status filter', () => {
    const { f, api, c } = render();
    (cell(c, 'status', MASTER).querySelector('[role="switch"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d1', { isActive: false });
    expect(dept(c, 'HEM').isActive).toBe(false);
    c.status.set('inactive');
    expect(c.visibleDepartments().map((d: any) => d.code)).toEqual(['HEM']);
  });

  it('Add department: name + code POST, the new row appears marked "Made here"', () => {
    const { f, c, api, q, type, el } = render();
    c.toggleAdd(); f.detectChanges();
    type('[data-testid="ld-add-name"]', 'Toxicology');
    type('[data-testid="ld-add-code"]', 'tox');
    (q('[data-testid="ld-add-save"]') as HTMLButtonElement).click(); f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/tenants/departments', { name: 'Toxicology', code: 'TOX' });
    expect(cell(c, 'origin', dept(c, 'TOX')).textContent).toContain('Made here');
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

  it('rename a lab-made department inline in the grid: PATCH name; a clash is explained and the name stays', () => {
    const { c, api, toasts } = render();
    // AG-Grid writes the edit into the row object before the event (same object as the list's).
    const rowObj = c.departments().find((d: any) => d.id === 'd2');
    rowObj.name = 'Cytology';
    c.onCellValueChanged({ colDef: { colId: 'name' }, data: rowObj, newValue: 'Cytology', oldValue: 'Cytogenetics' });
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d2', { name: 'Cytology' });
    expect(c.departments().find((d: any) => d.id === 'd2').name).toBe('Cytology');

    api.patch.mockImplementation(() => throwError(() => new ApiError('dup', 'dept_name_taken', 'name', undefined, 409)));
    c.onCellValueChanged({ colDef: { colId: 'name' }, data: { id: 'd2' }, newValue: 'Haematology', oldValue: 'Cytology' });
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/already exists/));
    expect(c.departments().find((d: any) => d.id === 'd2').name).toBe('Cytology');
  });

  it('delete asks first (DialogService), then DELETE; declining changes nothing', async () => {
    const no = render({ confirm: false });
    no.c.actionsFor(OWN).find((a: any) => a.label === 'Delete').run();
    await Promise.resolve(); await Promise.resolve();
    expect(no.dialog.confirm).toHaveBeenCalled();
    expect(no.api.delete).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const yes = render();
    yes.c.actionsFor(OWN).find((a: any) => a.label === 'Delete').run();
    await Promise.resolve(); await Promise.resolve();
    expect(yes.api.delete).toHaveBeenCalledWith('/api/tenants/departments/d2');
    expect(yes.c.departments().some((d: any) => d.id === 'd2')).toBe(false);
  });

  it('a department in use (409 dept_in_use) is explained, not deleted', async () => {
    const { api, toasts, c } = render();
    api.delete.mockImplementation(() => throwError(() => new ApiError('in use', 'dept_in_use', undefined, undefined, 409)));
    c.actionsFor(OWN).find((a: any) => a.label === 'Delete').run();
    await Promise.resolve(); await Promise.resolve();
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/Switch it off/));
    expect(c.departments().some((d: any) => d.id === 'd2')).toBe(true);
  });
});

describe('Lab departments — Lab spaces tab (moved from Branches)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a branch in the tree shows ONLY its board: lanes, space name + code, placed departments; head names the branch', () => {
    const { f, c, el } = render({ query: 'spaces' });
    c.pickBranch('b1'); f.detectChanges();
    expect(el.querySelector('[data-testid="ld-spaces-title"]')!.textContent).toContain('Lab spaces · Main');
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

  it('?tab= picks the tab; picking a branch writes ?tab=spaces&branch=<id>', () => {
    const { c } = render({ query: 'spaces' });
    expect(c.tab()).toBe('spaces');
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    c.pickBranch('b1');
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: 'spaces', branch: 'b1' } }));
    expect(c.selectedBranch().id).toBe('b1');
  });
});

describe('Lab departments — inside the Settings shell', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('the shell side card lists Departments + one row per branch; no own side card; grid bare; headTools exposed', async () => {
    const { SETTINGS_HOST, createSettingsHost } = await import('../../../shared/utils/settings-host');
    const host = createSettingsHost();
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    TestBed.configureTestingModule({
      imports: [LabDepartmentsComponent],
      providers: [
        provideRouter([]),
        { provide: SETTINGS_HOST, useValue: host },
        { provide: ApiService, useValue: { get: vi.fn((url: string) => of(
          url.startsWith('/api/tenants/departments') ? [MASTER, OWN]
            : url.startsWith('/api/tenants/branches') ? [{ id: 'b1', name: 'Main', code: 'MAIN', isActive: true }]
              : url === '/api/tenants/lab-spaces' ? [{ id: 's1', branchId: 'b1', name: 'Micro', code: 'MIC', order: 0 }] : [])),
          post: vi.fn(), patch: vi.fn(() => of({})), put: vi.fn(), delete: vi.fn() } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
        { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
      ],
    });
    const f = TestBed.createComponent(LabDepartmentsComponent);
    f.detectChanges(); f.detectChanges();
    const c = f.componentInstance as any;
    const el = f.nativeElement as HTMLElement;
    expect(host.categories()).toEqual([
      { id: 'departments', label: 'Departments', note: '2' },
      { id: 'spaces', label: 'Lab spaces', note: '1 branch', heading: true },
      { id: 'spaces-b1', label: 'Main', note: '1 space', parent: 'spaces' },
    ]);
    expect(el.querySelector('.ld-side')).toBeNull();
    expect(el.querySelector('.ld-main.pf-sg-main--bare')).not.toBeNull();
    expect(c.headTools()).toBeTruthy();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    c.pickBranch('b1');
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: 'spaces-b1', branch: null } }));
  });
});
