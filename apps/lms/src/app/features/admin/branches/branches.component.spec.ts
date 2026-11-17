import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { BranchesComponent } from './branches.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * Departments and lab spaces moved to Lab (owner 2026-11-17): Branches keeps
 * new branch, deactivate / reactivate and the GSTIN (shown, not edited).
 */
function render() {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const branch = { id: 'b1', name: 'Main', code: 'MAIN', city: 'Chennai', isActive: true, departments: [] };
  const api = {
    get: vi.fn((url: string) => of(
      url.startsWith('/api/tenants/branches') ? [branch]
        : url.startsWith('/api/config/gst') ? [{ branchId: 'b1', gstin: '33AAAAA0000A1Z5' }]
          : [])),
    post: vi.fn(() => of({})),
    patch: vi.fn(() => of({})),
    put: vi.fn(() => of({})),
    delete: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [BranchesComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      { provide: AuthService, useValue: { hasPermission: () => false, user: () => null } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
    ],
  });
  const f = TestBed.createComponent(BranchesComponent);
  f.detectChanges();
  return { f, c: f.componentInstance as any, api, el: f.nativeElement as HTMLElement };
}

describe('Branches — departments and lab spaces moved to Lab', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('no departments / lab spaces board, no department or space calls', () => {
    const { el, api } = render();
    expect(el.textContent).not.toContain('Departments & lab spaces');
    expect(el.querySelector('.pf-board')).toBeNull();
    const urls = api.get.mock.calls.map((c: any[]) => c[0] as string);
    expect(urls.some((u: string) => u.startsWith('/api/tenants/departments'))).toBe(false);
    expect(urls).not.toContain('/api/tenants/lab-spaces');
    expect(urls).not.toContain('/api/tenants/department-space-links');
  });

  it('the dead department helpers are gone', () => {
    const { c } = render();
    expect(c.saveSampleCode).toBeUndefined();
    expect(c.saveContainer).toBeUndefined();
    expect(c.toggleDeptActive).toBeUndefined();
    expect(c.createDepartment).toBeUndefined();
  });

  it('a Test Master grid: each branch GSTIN read-only in its column (muted "Not set" otherwise)', () => {
    const { el, c } = render();
    expect(el.querySelector('.pf-br-main pf-data-grid')).not.toBeNull();
    const col = c.colDefs().find((d: any) => d.colId === 'gstin');
    const cell = col.cellRenderer({ data: c.branches()[0] }) as HTMLElement;
    expect(cell.textContent).toContain('33AAAAA0000A1Z5');
    expect(cell.querySelector('input')).toBeNull();
  });
});

describe('Branches — OPS-11 deactivate a branch', () => {
  afterEach(() => TestBed.resetTestingModule());
  function renderAs(canRetire: boolean, confirmAnswer = true, branchActive = true) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const api = {
      get: vi.fn((url: string) => of(url.startsWith('/api/tenants/branches')
        ? [{ id: 'b2', name: 'Annex', code: 'ANX', city: 'Salem', isActive: branchActive }] : [])),
      post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
    };
    const toasts = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    const dialog = { confirm: vi.fn(async () => confirmAnswer) };
    TestBed.configureTestingModule({
      imports: [BranchesComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toasts },
        { provide: DialogService, useValue: dialog },
        { provide: AuthService, useValue: { hasPermission: (p: string) => canRetire && p === 'manage_tenant', user: () => null } },
      ],
    });
    const f = TestBed.createComponent(BranchesComponent);
    f.detectChanges();
    const c = f.componentInstance as any;
    // The grid's actions cell (rendered by AG-Grid): the row's Deactivate / Reactivate icon.
    const act = () => {
      const col = c.colDefs().find((d: any) => d.colId === 'actions');
      if (!col) return null;
      const cell = col.cellRenderer({ data: c.branches()[0] }) as HTMLElement;
      return cell.querySelector('button') as HTMLButtonElement | null;
    };
    return { f, api, toasts, dialog, c, act, el: f.nativeElement as HTMLElement };
  }

  it('the board asks for inactive branches too (to offer Reactivate)', () => {
    const { api } = renderAs(true);
    expect(api.get).toHaveBeenCalledWith('/api/tenants/branches?includeInactive=true');
  });

  it('non-admins get no deactivate control', () => {
    const { act } = renderAs(false);
    expect(act()).toBeNull();
  });

  it('admin: confirm, then PATCH isActive=false', async () => {
    const { api, dialog, c, act } = renderAs(true);
    act()!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/branches/b2', { isActive: false });
    expect((c.colDefs().find((d: any) => d.colId === 'status').cellRenderer({ data: c.branches()[0] }) as HTMLElement).textContent).toBe('Inactive');
  });

  it('declining the confirm changes nothing', async () => {
    const { api, act } = renderAs(true, false);
    act()!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('an inactive branch offers Reactivate with no confirm', async () => {
    const { api, dialog, act } = renderAs(true, true, false);
    const btn = act()!;
    expect(btn.getAttribute('aria-label')).toContain('Reactivate');
    btn.click();
    await Promise.resolve();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/branches/b2', { isActive: true });
  });
});
