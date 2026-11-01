import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { BranchesComponent } from './branches.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
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
