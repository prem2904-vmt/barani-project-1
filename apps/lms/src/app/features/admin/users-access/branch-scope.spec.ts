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
import { Branch } from '../../../shared/models/tenant.model';
import {
  ALL_BRANCHES, applyScopePick, branchScopeChips, scopeOptions, scopePayload, scopeValuesFromRoles,
} from './branch-scope';
import { UserEditComponent } from './user-edit.component';
import { UserInviteComponent } from './user-invite.component';
import { UsersAccessComponent } from './users-access.component';

/**
 * Multi-branch user scope (owner, 2026-09-27): "A user can belong to two or
 * three branches, but we have only single-select in that area." The Branch
 * Scope card is a multi-select (All branches, or one or more branches / labs)
 * and saves one assignment per role × branch; the Users list shows the
 * branches as chips.
 */
const B = (id: string, name: string, subs: { id: string; name: string }[] = []) =>
  ({ id, name, subBranches: subs } as unknown as Branch);
const branches: Branch[] = [
  B('chn', 'Chennai Main', [{ id: 'micro', name: 'Micro lab' }, { id: 'histo', name: 'Histo lab' }]),
  B('slm', 'Salem'),
  B('mdu', 'Madurai'),
];

describe('branch-scope rules', () => {
  it('options: All branches first, then each branch with its labs indented', () => {
    const o = scopeOptions(branches);
    expect(o[0]).toEqual({ value: ALL_BRANCHES, label: 'All branches (tenant-wide)' });
    expect(o.map(x => x.value)).toEqual(['all', 'b:chn', 'sb:micro', 'sb:histo', 'b:slm', 'b:mdu']);
    expect(o[2].label).toContain('→ Micro lab');
  });

  it('All branches is exclusive both ways', () => {
    expect(applyScopePick(['b:chn', 'b:slm'], ['b:chn', 'b:slm', 'all'], branches)).toEqual(['all']);
    expect(applyScopePick(['all'], ['all', 'b:slm'], branches)).toEqual(['b:slm']);
  });

  it('a branch covers its labs; a lab narrows its branch; one lab per branch', () => {
    // Picking the parent does NOT add labs — it drops the lab already picked.
    expect(applyScopePick(['sb:micro', 'b:slm'], ['sb:micro', 'b:slm', 'b:chn'], branches)).toEqual(['b:slm', 'b:chn']);
    // Picking a lab replaces its whole branch.
    expect(applyScopePick(['b:chn', 'b:slm'], ['b:chn', 'b:slm', 'sb:micro'], branches)).toEqual(['b:slm', 'sb:micro']);
    // A second lab of the same branch replaces the first.
    expect(applyScopePick(['sb:micro'], ['sb:micro', 'sb:histo'], branches)).toEqual(['sb:histo']);
    // Other branches are untouched.
    expect(applyScopePick(['b:slm'], ['b:slm', 'b:mdu'], branches)).toEqual(['b:slm', 'b:mdu']);
  });

  it('role rows → values: a branch-less row is All branches; else distinct in order', () => {
    expect(scopeValuesFromRoles([{ branchId: null }])).toEqual(['all']);
    expect(scopeValuesFromRoles([
      { branchId: 'slm' }, { branchId: 'chn', subBranchId: 'micro' }, { branchId: 'slm' },
    ])).toEqual(['b:slm', 'sb:micro']);
    expect(scopeValuesFromRoles([])).toEqual([]);
  });

  it('payload: All → allBranches; else branches in list order (first = default)', () => {
    expect(scopePayload(['all'], branches)).toEqual({ allBranches: true });
    expect(scopePayload(['b:mdu', 'sb:micro'], branches)).toEqual({
      branches: [{ branchId: 'chn', subBranchId: 'micro' }, { branchId: 'mdu' }],
    });
  });

  it('list chips: "All branches", or each branch / lab', () => {
    expect(branchScopeChips({ userId: 'u', allBranches: true, branches: [] })).toEqual(['All branches']);
    expect(branchScopeChips({ userId: 'u', allBranches: false, branches: [
      { branchId: 'chn', branchName: 'Chennai Main' },
      { branchId: 'chn', branchName: 'Chennai Main', subBranchId: 'micro', subBranchName: 'Micro lab' },
    ] })).toEqual(['Chennai Main', 'Chennai Main → Micro lab']);
    expect(branchScopeChips(undefined)).toEqual([]);
  });
});

// ── Components ───────────────────────────────────────────────────────────

const roles = [{ id: 'r1', name: 'Receptionist', isPreSeeded: true, scope: 'tenant' },
               { id: 'r2', name: 'Lab Technician', isPreSeeded: true, scope: 'tenant' }];
const users = [{ id: 'u1', firstName: 'Priya', fathersName: 'Sharma', displayName: 'Priya Sharma',
                 username: 'priya', email: '', isActive: true },
               { id: 'u2', firstName: 'Ravi', fathersName: 'K', displayName: 'Ravi K', username: 'ravi', email: '', isActive: true }];

function render<T>(cmp: new (...a: any[]) => T, userRoles: unknown[], id?: string) {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/roles')) return of(roles);
      if (url.startsWith('/api/tenants/branches')) return of(branches);
      if (url === '/api/users/branch-scopes') return of([
        { userId: 'u1', allBranches: false, branches: [{ branchId: 'chn', branchName: 'Chennai Main' }] },
        { userId: 'u2', allBranches: true, branches: [] },
      ]);
      if (url.startsWith(`/api/users/${id}/roles`)) return of(userRoles);
      if (url.startsWith('/api/users')) return of(users);
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

describe('Edit user — Branch scope multi-select', () => {
  it('Priya (Chennai Main only) loads as exactly that one branch, and saves it unchanged', () => {
    const { f, el, c, api } = render(UserEditComponent, [{ roleId: 'r1', branchId: 'chn' }], 'u1');
    expect(c.form().scope).toEqual(['b:chn']);
    const sel = el.querySelector('pf-select.pf-uf-scope');
    expect(sel).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();                 // no native control
    f.detectChanges();
    expect(el.querySelector('pf-select.pf-uf-scope .pf-dd__chip')?.textContent).toContain('Chennai Main');
    c.save();
    expect(api.put).toHaveBeenCalledWith('/api/users/u1/roles', { roleIds: ['r1'], branches: [{ branchId: 'chn' }] });
  });

  it('two branches → one payload entry per branch, in list order; roles apply to both', () => {
    const { c, api } = render(UserEditComponent, [{ roleId: 'r1', branchId: 'chn' }, { roleId: 'r2', branchId: 'chn' }], 'u1');
    c.onScopeChange(['b:chn', 'b:slm']);
    c.save();
    expect(api.put).toHaveBeenCalledWith('/api/users/u1/roles', {
      roleIds: ['r1', 'r2'], branches: [{ branchId: 'chn' }, { branchId: 'slm' }],
    });
  });

  it('a multi-branch user loads every branch; All branches saves tenant-wide', () => {
    const { c, api } = render(UserEditComponent, [
      { roleId: 'r1', branchId: 'slm' }, { roleId: 'r1', branchId: 'mdu' },
    ], 'u1');
    expect(c.form().scope).toEqual(['b:slm', 'b:mdu']);
    c.onScopeChange(['b:slm', 'b:mdu', 'all']);
    expect(c.form().scope).toEqual(['all']);
    c.save();
    expect(api.put).toHaveBeenCalledWith('/api/users/u1/roles', { roleIds: ['r1'], allBranches: true });
  });

  it('no branch picked → Save disabled with an inline message', () => {
    const { f, el, c, api } = render(UserEditComponent, [{ roleId: 'r1', branchId: 'chn' }], 'u1');
    c.onScopeChange([]);
    f.detectChanges();
    expect(c.canSave()).toBe(false);
    expect(el.textContent).toContain('Pick at least one branch, or All branches.');
    c.save();
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('Create user — Branch scope multi-select', () => {
  it('sends the selected branches with the new user', () => {
    const { c, api } = render(UserInviteComponent, []);
    c.patch({ username: 'newuser', password: 'longenough1' });
    c.toggleRole('r1');
    c.onScopeChange(['all', 'sb:micro']);          // picking a lab clears All
    c.onScopeChange(['sb:micro', 'b:mdu']);
    c.submit();
    const body = (api.post.mock.calls as unknown as unknown[][])[0][1] as Record<string, unknown>;
    expect(body['branches']).toEqual([{ branchId: 'chn', subBranchId: 'micro' }, { branchId: 'mdu' }]);
    expect(body['allBranches']).toBeUndefined();
    expect(body['branchId']).toBeUndefined();
  });
});

describe('Users list — Branches column', () => {
  it('shows each user\'s branches as chips, or "All branches"', () => {
    const { c } = render(UsersAccessComponent, []);
    const rows = c.filteredUsers();
    expect(rows.find((u: any) => u.id === 'u1').branchScope.branches[0].branchName).toBe('Chennai Main');
    expect(rows.find((u: any) => u.id === 'u2').branchScope.allBranches).toBe(true);
    const col = c.userColDefs().find((d: any) => d.colId === 'branches');
    expect(col.valueGetter({ data: rows[0] })).toBe('Chennai Main');
    const cell: HTMLElement = col.cellRenderer({ data: rows[1] });
    expect(Array.from(cell.querySelectorAll('.nd-chip')).map(x => x.textContent)).toEqual(['All branches']);
  });
});
