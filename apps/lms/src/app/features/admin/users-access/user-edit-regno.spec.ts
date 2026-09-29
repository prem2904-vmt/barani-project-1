import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserEditComponent, regIdChanged } from './user-edit.component';

/**
 * Users & roles → Edit user: the admin edits the ONE registration number
 * (users.RegistrationId, what reports print) via PATCH /api/users/{id}. Sent
 * only when changed; blank clears.
 */
const USERS = [
  { id: 'u1', firstName: 'Prem', fathersName: 'Kumar', displayName: 'Dr. Prem Kumar', title: 'Dr.', username: 'drprem',
    email: '', isActive: true, registrationId: 'TN-100' },
];

function render() {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/roles')) return of([{ id: 'r-path', name: 'Pathologist', isPreSeeded: true, scope: 'tenant', assignable: true, assignableToSelf: true }]);
      if (url.startsWith('/api/tenants/branches')) return of([{ id: 'b1', name: 'Main Lab' }]);
      if (url === '/api/users/u1/roles') return of([{ roleId: 'r-path', branchId: 'b1' }]);
      if (url === '/api/users/u1/departments') return of({ userId: 'u1', departmentIds: [], viaRoles: [] });
      if (url.startsWith('/api/users')) return of(USERS);
      return of([]);
    }),
    post: vi.fn(() => of({})), patch: vi.fn((_u: string, _b: unknown) => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [UserEditComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: AuthService, useValue: { user: signal({ id: 'me', tenantName: 'Micro World', permissions: ['manage_users'] }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn(),
        registerBackInterceptor: vi.fn(), clearBackInterceptor: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'u1']]) }, queryParams: of({}) } },
    ],
  });
  const f = TestBed.createComponent(UserEditComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, api, c: f.componentInstance as any };
}

afterEach(() => TestBed.resetTestingModule());

describe('regIdChanged', () => {
  it('is trim-insensitive and treats null as blank', () => {
    expect(regIdChanged(' TN-1 ', 'TN-1')).toBe(false);
    expect(regIdChanged('', null)).toBe(false);
    expect(regIdChanged('TN-2', 'TN-1')).toBe(true);
    expect(regIdChanged('', 'TN-1')).toBe(true);
  });
});

describe('User edit — registration number (admin)', () => {
  it('loads the user\'s number into a kit text field (no native select)', async () => {
    const { f, el } = render();
    await f.whenStable(); f.detectChanges();
    const input = el.querySelector('input.pf-ue-regno') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.classList).toContain('nd-input');
    expect(input.value).toBe('TN-100');
    expect(el.textContent).toContain('prints under their signature');
    expect(el.querySelector('select, datalist')).toBeNull();
  });

  it('an admin edit is sent to PATCH /api/users/{id} as registrationId', async () => {
    const { f, c, api } = render();
    await f.whenStable(); f.detectChanges();
    c.patch({ registrationId: ' TN-200 ' });
    c.save();
    expect(api.patch).toHaveBeenCalledWith('/api/users/u1', expect.objectContaining({ registrationId: 'TN-200' }));
  });

  it('unchanged → the field is not sent; blank → sent as "" (clears)', async () => {
    const { f, c, api } = render();
    await f.whenStable(); f.detectChanges();
    c.save();
    expect((api.patch.mock.calls as unknown[][])[0][1]).not.toHaveProperty('registrationId');
    c.patch({ registrationId: '' });
    c.save();
    expect((api.patch.mock.calls as unknown[][])[1][1]).toMatchObject({ registrationId: '' });
  });
});
