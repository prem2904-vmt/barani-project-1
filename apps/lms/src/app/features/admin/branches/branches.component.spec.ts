import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { BranchesComponent } from './branches.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { DEPARTMENTS_FROM_MASTER } from '../../../shared/utils/test-origin';

/**
 * Test Master single source, owner rule 4: departments come ONLY from the
 * Admin Test Master. The branch board places / enables / disables them and
 * never offers to create one (the server refuses with 403
 * `departments_master_only`).
 */
function render() {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const branch = { id: 'b1', name: 'Main', code: 'MAIN', city: 'Chennai', isActive: true, departments: [] };
  const api = {
    get: vi.fn((url: string) => of(
      url.startsWith('/api/tenants/branches') ? [branch]
        : url.startsWith('/api/tenants/departments') ? [{ id: 'd1', name: 'Haematology', code: 'HEM', isActive: true }]
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
  const c = f.componentInstance as any;
  c.toggle('b1');
  f.detectChanges();
  return { f, c, api, el: f.nativeElement as HTMLElement };
}

describe('Branches — departments are master-provided', () => {
  it('the branch board has no "add department" affordance and explains where departments come from', () => {
    const { el } = render();
    expect(el.textContent).toContain('Departments & lab spaces');
    expect(el.textContent).not.toMatch(/add department/i);
    expect(el.textContent).toContain(DEPARTMENTS_FROM_MASTER);
    expect(el.querySelector('.pf-dept-source svg')).not.toBeNull();
  });

  it('the component carries no department-create path at all', () => {
    const { c, api } = render();
    expect(c.createDepartment).toBeUndefined();
    expect(c.beginAddDept).toBeUndefined();
    expect(api.post).not.toHaveBeenCalledWith('/api/tenants/departments', expect.anything());
  });

  it('enable / disable stays (Deactivate toggle on a department card)', () => {
    const { el } = render();
    expect(el.textContent).toMatch(/Deactivate|Reactivate/);
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
    (f.componentInstance as any).toggle('b2');
    f.detectChanges();
    return { f, api, toasts, dialog, el: f.nativeElement as HTMLElement };
  }

  it('the board asks for inactive branches too (to offer Reactivate)', () => {
    const { api } = renderAs(true);
    expect(api.get).toHaveBeenCalledWith('/api/tenants/branches?includeInactive=true');
  });

  it('non-admins get no deactivate control', () => {
    const { el } = renderAs(false);
    expect(el.querySelector('[data-testid="br-toggle-active"]')).toBeNull();
  });

  it('admin: confirm, then PATCH isActive=false', async () => {
    const { f, api, dialog, el } = renderAs(true);
    (el.querySelector('[data-testid="br-toggle-active"]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/branches/b2', { isActive: false });
    f.detectChanges();
    expect(el.querySelector('[data-testid="br-inactive-chip"]')).not.toBeNull();
  });

  it('declining the confirm changes nothing', async () => {
    const { api, el } = renderAs(true, false);
    (el.querySelector('[data-testid="br-toggle-active"]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('an inactive branch offers Reactivate with no confirm', async () => {
    const { api, dialog, el } = renderAs(true, true, false);
    const btn = el.querySelector('[data-testid="br-toggle-active"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Reactivate branch');
    btn.click();
    await Promise.resolve();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/branches/b2', { isActive: true });
  });
});
