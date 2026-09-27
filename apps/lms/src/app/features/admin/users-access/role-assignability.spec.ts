import { Type, signal } from '@angular/core';
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
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import type { Role } from '../../../shared/models/user.model';
import { canAssignRole, rolePickerRows } from './role-assignability';
import { UserInviteComponent } from './user-invite.component';
import { UserEditComponent } from './user-edit.component';

/**
 * Role pickers offer only what the server will accept. The rule lives in the
 * backend (RoleAssignmentRule.cs → GET /api/roles `assignable` /
 * `assignableToSelf`); the UI only reads the flags. Held roles the caller
 * can't assign stay ON and read-only, and ride the full-replace save.
 */
const role = (id: string, name: string, assignable?: boolean, assignableToSelf?: boolean): Role =>
  ({ id, name, scope: 'tenant', isPreSeeded: false, isActive: true, createdAt: '', assignable, assignableToSelf });

describe('role-assignability — reads the server flags', () => {
  it('assignable / assignableToSelf pick the flag for the target', () => {
    const r = role('a', 'A', true, false);
    expect(canAssignRole(r, false)).toBe(true);
    expect(canAssignRole(r, true)).toBe(false);
  });

  it('no flags (older server) → offered; the server still enforces', () => {
    expect(canAssignRole(role('a', 'A'), false)).toBe(true);
    expect(canAssignRole(role('a', 'A'), true)).toBe(true);
  });

  it('rows = assignable roles + held-but-unassignable (locked); the rest hidden, order kept', () => {
    const roles = [role('r1', 'Lab Admin', false, false), role('r2', 'Receptionist', true, true), role('r3', 'Owner', false, false)];
    expect(rolePickerRows(roles, ['r1'], false)).toEqual([
      { value: 'r1', label: 'Lab Admin', locked: true },
      { value: 'r2', label: 'Receptionist', locked: false },
    ]);
    expect(rolePickerRows(roles, [], false)).toEqual([{ value: 'r2', label: 'Receptionist', locked: false }]);
  });

  it('self uses assignableToSelf (manage_tenant does not exempt yourself)', () => {
    const roles = [role('r1', 'Bigger', true, false)];
    expect(rolePickerRows(roles, [], false)).toEqual([{ value: 'r1', label: 'Bigger', locked: false }]);
    expect(rolePickerRows(roles, [], true)).toEqual([]);
  });
});

const ROLES: Role[] = [
  role('r1', 'Lab Admin', false, false),     // beyond the caller
  role('r2', 'Receptionist', true, true),     // a subset of the caller's
  role('r3', 'Tenant Owner', true, false),    // caller has manage_tenant, but not these perms
];

function render<T>(cmp: Type<T>, opts: { id?: string; me?: string; held?: string[] } = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const id = opts.id ?? 'u1';
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/roles')) return of(ROLES);
      if (url.startsWith('/api/tenants/branches')) return of([{ id: 'b1', name: 'Main Lab' }]);
      if (url.startsWith(`/api/users/${id}/roles`)) return of((opts.held ?? []).map(r => ({ roleId: r, branchId: 'b1' })));
      if (url.startsWith('/api/users')) return of([{ id, firstName: 'Prem', fathersName: 'K', displayName: 'Prem K', username: 'prem', isActive: true }]);
      return of([]);
    }),
    post: vi.fn(() => of({ id: 'n1', username: 'x', displayName: 'X' })),
    patch: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [cmp],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: AuthService, useValue: { user: () => ({ id: opts.me ?? 'me', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn(),
        registerBackInterceptor: vi.fn(), clearBackInterceptor: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', id]]) }, queryParams: of({}) } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
    ],
  });
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const switches = () => [...el.querySelectorAll<HTMLButtonElement>('.pf-uf-roles .nd-toggle[role="switch"]')];
  const names = () => switches().map(b => b.querySelector('.pf-uf-sw__name')!.textContent!.trim());
  return { f, el, api, c: f.componentInstance as any, switches, names };
}

describe('Role pickers show only assignable roles', () => {
  it('Create user: roles the caller can\'t assign are not offered', () => {
    const { names } = render(UserInviteComponent);
    expect(names()).toEqual(['Receptionist', 'Tenant Owner']);
  });

  it('Edit user: a held role the caller can\'t assign is shown ON, read-only, and kept on save', () => {
    const { f, c, api, switches, names } = render(UserEditComponent, { held: ['r1', 'r2'] });
    expect(names()).toEqual(['Lab Admin', 'Receptionist', 'Tenant Owner']);
    const locked = switches()[0];
    expect(locked.getAttribute('aria-checked')).toBe('true');
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.classList.contains('pf-uf-sw--locked')).toBe(true);

    locked.click(); f.detectChanges();                 // inert
    expect(switches()[0].getAttribute('aria-checked')).toBe('true');
    switches()[1].click(); f.detectChanges();          // assignable ones still toggle
    expect(switches()[1].getAttribute('aria-checked')).toBe('false');

    c.save();
    expect(api.put).toHaveBeenCalledWith('/api/users/u1/roles', expect.objectContaining({ roleIds: ['r1'] }));
  });

  it('Edit user: an unassignable role the user does NOT hold is hidden', () => {
    const { names } = render(UserEditComponent, { held: ['r2'] });
    expect(names()).toEqual(['Receptionist', 'Tenant Owner']);
  });

  it('Editing yourself uses assignableToSelf', () => {
    const { names } = render(UserEditComponent, { id: 'me', me: 'me', held: ['r2'] });
    expect(names()).toEqual(['Receptionist']);
  });
});
