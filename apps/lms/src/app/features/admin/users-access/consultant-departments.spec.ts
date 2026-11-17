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
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { PresenceService } from '../../../core/services/presence.service';
import { UserEditComponent } from './user-edit.component';
import { UsersAccessComponent } from './users-access.component';
import { DEPARTMENTS_HINT, allDepartmentIds, departmentNames, sameIds, viaRoleLabels } from './consultant-departments';

/**
 * Users & roles → a consultant's DEPARTMENTS (owner 2026-09-27: a
 * pathologist / microbiologist sees only their departments). The editor
 * picks them with pf-select (multiple) and saves them with PUT
 * /api/users/{id}/departments only when changed; role-derived departments
 * are shown read-only; the Users list shows them as chips.
 */
const DEPTS = [
  { id: 'd-hae', name: 'Haematology', code: 'HEM', isActive: true },
  { id: 'd-mic', name: 'Microbiology', code: 'MIC', isActive: true },
  { id: 'd-bio', name: 'Biochemistry', code: 'BIO', isActive: true },
];
const ROLES = [{ id: 'r-path', name: 'Pathologist', isPreSeeded: true, scope: 'tenant', assignable: true, assignableToSelf: true },
               { id: 'r-mic', name: 'Microbiologist', isPreSeeded: true, scope: 'tenant', assignable: true, assignableToSelf: true }];
const USERS = [
  { id: 'u1', firstName: 'Prem', fathersName: 'Kumar', displayName: 'Dr. Prem Kumar', title: 'Dr.', username: 'drprem', email: '', isActive: true },
  { id: 'u2', firstName: 'Lata', fathersName: 'Devi', displayName: 'Dr. Lata Devi', title: 'Dr.', username: 'drlata', email: '', isActive: true },
];
const U1_DEPTS = { userId: 'u1', departmentIds: ['d-hae'], viaRoles: [{ departmentId: 'd-mic', roleId: 'r-mic' }] };

function render<T>(cmp: new (...a: any[]) => T, id?: string) {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/roles')) return of(ROLES);
      if (url.startsWith('/api/tenants/branches')) return of([{ id: 'b1', name: 'Main Lab' }]);
      if (url.startsWith('/api/tenants/departments')) return of(DEPTS);
      if (url === '/api/users/departments') return of([U1_DEPTS]);
      if (url === '/api/users/u1/departments') return of(U1_DEPTS);
      if (url === '/api/users/u1/roles') return of([{ roleId: 'r-path', branchId: 'b1' }]);
      if (url.startsWith('/api/users/branch-scopes')) return of([]);
      if (url.startsWith('/api/users')) return of(USERS);
      return of([]);
    }),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [cmp],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn(),
        registerBackInterceptor: vi.fn(), clearBackInterceptor: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(id ? [['id', id]] : []) }, queryParams: of({}) } },
      { provide: WebrtcService, useValue: { startCall: vi.fn() } },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set<string>()) } },
      { provide: PresenceService, useValue: { seedFromUsers: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
    ],
  });
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, api, c: f.componentInstance as any };
}

afterEach(() => TestBed.resetTestingModule());

describe('consultant-departments helpers', () => {
  const names = new Map(DEPTS.map(d => [d.id, d.name]));
  it('direct ∪ role departments, deduped; names sorted, unknown ids skipped', () => {
    expect(allDepartmentIds(U1_DEPTS).sort()).toEqual(['d-hae', 'd-mic']);
    expect(allDepartmentIds(null)).toEqual([]);
    expect(departmentNames({ ...U1_DEPTS, departmentIds: ['d-hae', 'gone'] }, names)).toEqual(['Haematology', 'Microbiology']);
  });
  it('via-role labels name the role and skip departments already picked directly', () => {
    const roles = new Map([['r-mic', 'Microbiologist']]);
    expect(viaRoleLabels(U1_DEPTS, names, roles)).toEqual(['Microbiology (Microbiologist)']);
    expect(viaRoleLabels({ ...U1_DEPTS, departmentIds: ['d-mic'] }, names, roles)).toEqual([]);
  });
  it('sameIds ignores order', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('User edit — DEPARTMENTS card (Validates for is read-only)', () => {
  it('the "Validates for" section LISTS the departments (no select) and links to Lab › Collection and queues', async () => {
    const { el, f } = render(UserEditComponent, 'u1');
    await f.whenStable(); f.detectChanges();
    (f.componentInstance as any).pickSection('validates'); f.detectChanges();
    expect(el.querySelector('.ue-main .pf-card__label')!.textContent!.trim()).toBe('Validates for');
    const card = el.querySelector('.pf-ue-depts') as HTMLElement;
    expect(card.querySelector('pf-select')).toBeNull();
    expect(el.querySelector('select, datalist')).toBeNull();
    const chips = Array.from(card.querySelectorAll('[data-testid="ue-validates-for"] .pf-chip')).map(c => c.textContent!.trim());
    expect(chips).toEqual(['Haematology']);
    expect(card.textContent).toContain(DEPARTMENTS_HINT);
    // Role-derived department: read-only line naming the role.
    expect(card.querySelector('.pf-ue-via')!.textContent).toContain('Microbiology (Microbiologist)');
    const link = card.querySelector<HTMLAnchorElement>('[data-testid="ue-validates-link"]')!;
    expect(link.getAttribute('href')).toBe('/admin/lab/collection?tab=assign');
  });

  it('shows the direct departments by name and NEVER writes them from here (the validator pools have one home)', async () => {
    const { f, c, api } = render(UserEditComponent, 'u1');
    await f.whenStable(); f.detectChanges();
    expect(c.deptIds()).toEqual(['d-hae']);
    expect(c.deptNames()).toEqual(['Haematology']);
    expect(typeof c.setDepts).toBe('undefined');

    c.save();
    expect(api.put.mock.calls.filter((x: unknown[]) => String(x[0]).endsWith('/departments')).length).toBe(0);
  });
});

describe('Users list — Departments column', () => {
  it('shows each consultant\'s departments (direct + role) as names', async () => {
    const { f, c } = render(UsersAccessComponent);
    await f.whenStable(); f.detectChanges();
    const col = c.userColDefs().find((d: { colId?: string }) => d.colId === 'departments');
    expect(col.headerName).toBe('Departments');
    expect(c.userDepartments('u1')).toEqual(['Haematology', 'Microbiology']);
    expect(c.userDepartments('u2')).toEqual([]);
  });
});
