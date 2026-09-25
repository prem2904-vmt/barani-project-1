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
import { WebrtcService } from '../../../core/services/webrtc.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { PresenceService } from '../../../core/services/presence.service';
import { UserInviteComponent } from './user-invite.component';
import { UserEditComponent } from './user-edit.component';
import { RoleEditorComponent } from './role-editor.component';
import { UsersAccessComponent } from './users-access.component';

/**
 * Users & Access — ND-PATTERN "Editors". Create user, edit user and the role
 * editor carry the band (back · tenant · ONE primary) with the pill as the
 * CONTEXT BAR; sections are nd-cards with kit fields, roles / permissions are
 * slate switches (role=switch), no native select, no mono / green. The list's
 * row actions are kit .nd-rowact buttons and its status is a slate switch.
 */
const roles = [
  { id: 'r1', name: 'Lab Technician', isPreSeeded: true, scope: 'tenant' },
  { id: 'r2', name: 'Night Shift', isPreSeeded: false, scope: 'tenant' },
];
const users = [
  { id: 'u1', firstName: 'Prem', fathersName: 'Kumar', displayName: 'Dr. Prem Kumar', title: 'Dr.',
    username: 'drprem', email: '', phone: '+91 9876543210', isActive: true, authId: 'a1' },
];
const perms = [
  { id: 'p1', code: 'manage_users', name: 'Manage users', description: '' },
  { id: 'p2', code: 'enter_results', name: 'Enter results', description: '' },
];

function render<T>(cmp: Type<T>, opts: { id?: string; nd?: boolean } = {}) {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/roles/') && url.endsWith('/permissions')) return of(['p1']);
      if (url.startsWith('/api/roles')) return of(roles);
      if (url.startsWith('/api/permissions')) return of(perms);
      if (url.startsWith('/api/tenants/branches')) return of([{ id: 'b1', name: 'Main Lab', subBranches: [] }, { id: 'b2', name: 'Annex' }]);
      if (url.startsWith('/api/users/u1/roles')) return of([{ roleId: 'r1', branchId: 'b1' }]);
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
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => opts.nd ?? true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(opts.id ? [['id', opts.id]] : []) },
        queryParams: of({}) } },
      { provide: WebrtcService, useValue: { startCall: vi.fn() } },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set<string>()) } },
      { provide: PresenceService, useValue: { seedFromUsers: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
    ],
  });
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const chip = (k: string) => el.querySelector(`pf-hero-band .nd-ctx__chip[data-k="${k}"]`);
  return { f, el, api, c: f.componentInstance as any, txt, chip };
}

/** The palette / font / native-control hygiene every editor must pass. */
function hygiene(el: HTMLElement) {
  expect(el.querySelector('select, datalist, code, .mono, .font-mono, .c-green, .c-amber, pf-tile')).toBeNull();
  expect(el.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  expect(/[✕✓✔●↑↓]/.test(el.textContent ?? '')).toBe(false);
  expect(el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary, pf-touch-btn:not(.pf-classic-only pf-touch-btn) .v-primary').length).toBe(1);
}

describe('Users & Access editors — new design', () => {
  it('Create user: band + ONE primary; context bar = "New user" then the typed name / username / roles / branch', () => {
    const { el, f, c, txt, chip } = render(UserInviteComponent);
    const primaries = el.querySelectorAll('pf-hero-band .pf-hb__actions .pf-hb-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].textContent).toContain('Create user');
    expect(txt(el.querySelector('.nd-ctx__primary'))).toBe('New user');
    expect(txt(chip('Roles'))).toContain('None yet');
    c.patch({ title: 'Dr.', firstName: 'Priya', fathersName: 'Raman', username: 'DrPriya' });
    f.detectChanges();
    expect(txt(el.querySelector('.nd-ctx__primary'))).toBe('Dr. Priya Raman');
    expect(chip('Username')!.querySelector('.nd-num')!.textContent).toBe('drpriya');
    expect(el.querySelector('pf-screen-header')!.classList.contains('pf-classic-only')).toBe(true);
    hygiene(el);
  });

  it('Create user: roles are slate switches; turning one on updates the context bar and enables Create', () => {
    const { el, f, c, txt, chip } = render(UserInviteComponent);
    const sw = el.querySelectorAll<HTMLButtonElement>('.pf-uf-roles .nd-toggle[role="switch"]');
    expect(sw.length).toBe(2);
    expect(sw[0].getAttribute('aria-checked')).toBe('false');
    sw[0].click();
    f.detectChanges();
    expect(sw[0].getAttribute('aria-checked')).toBe('true');
    expect(txt(chip('Roles'))).toContain('Lab Technician');
    c.patch({ username: 'drpriya', password: 'secret123' });
    f.detectChanges();
    expect((el.querySelector('pf-hero-band .pf-hb-btn--primary') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Create user: sections are nd-cards with kit fields; title + country code are pf-select', () => {
    const { el } = render(UserInviteComponent);
    expect(el.querySelectorAll('.pf-band-body .nd-card .nd-card__head .nd-card__icon svg').length).toBeGreaterThanOrEqual(3);
    expect(el.querySelectorAll('.pf-band-body input.nd-input').length).toBeGreaterThanOrEqual(4);
    expect(el.querySelector('.pf-uf-phone pf-select')).not.toBeNull();
  });

  it('Edit user: context bar shows the user (full name, username in tabular numbers, roles, branch); Save changes is the primary', () => {
    const { el, txt, chip } = render(UserEditComponent, { id: 'u1' });
    expect(txt(el.querySelector('.nd-ctx__primary'))).toBe('Dr. Prem Kumar');
    expect(chip('Username')!.querySelector('.nd-num')!.textContent).toBe('drprem');
    expect(txt(chip('Roles'))).toContain('Lab Technician');
    expect(txt(chip('Branch'))).toContain('Main Lab');
    expect(el.querySelector('pf-hero-band .pf-hb-btn--primary')!.textContent).toContain('Save changes');
    const on = el.querySelectorAll('.pf-uf-roles .nd-toggle[aria-checked="true"]');
    expect(on.length).toBe(1);
    const user = el.querySelector<HTMLInputElement>('input[readonly]')!;
    expect(user.classList.contains('nd-input')).toBe(true);
    hygiene(el);
  });

  it('New role: "New role" → the typed name; role type is a neutral nd-seg; permissions are slate switches', () => {
    const { el, f, c, txt, chip } = render(RoleEditorComponent);
    expect(txt(el.querySelector('.nd-ctx__primary'))).toBe('New role');
    c.onNameChange('Billing Supervisor');
    f.detectChanges();
    expect(txt(el.querySelector('.nd-ctx__primary'))).toBe('Billing Supervisor');
    expect(el.querySelector('pf-hero-band .pf-hb-btn--primary')!.textContent).toContain('Create role');
    expect(el.querySelectorAll('.re-type.nd-seg [role="radio"]').length).toBe(2);
    const sw = el.querySelectorAll<HTMLButtonElement>('.re-perm-grid .nd-toggle[role="switch"]');
    expect(sw.length).toBe(2);
    sw[1].click();
    f.detectChanges();
    expect(chip('Granted')!.querySelector('.nd-num')!.textContent).toBe('1 / 2');
    hygiene(el);
  });

  it('Edit role: the role name + Pre-seeded type chip; granted count from the server', () => {
    const { el, txt, chip } = render(RoleEditorComponent, { id: 'r1' });
    expect(txt(el.querySelector('.nd-ctx__primary'))).toBe('Lab Technician');
    expect(txt(chip('Type'))).toContain('Pre-seeded');
    expect(txt(chip('Granted'))).toContain('1 / 2');
    expect(el.querySelector('pf-hero-band .pf-hb-btn--primary')!.textContent).toContain('Save');
    hygiene(el);
  });

  it('classic design keeps pf-screen-header and no band', () => {
    const { el } = render(RoleEditorComponent, { nd: false });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('pf-screen-header')).not.toBeNull();
  });
});

describe('Users & Access list — current rules', () => {
  it('Noto grid, one primary in the band, no mono count', () => {
    const { el, c } = render(UsersAccessComponent);
    expect(c.gridTheme()).toBeTruthy();
    expect(el.querySelectorAll('pf-hero-band .pf-hb-btn--primary').length).toBe(1);
    expect(el.querySelector('.font-mono')).toBeNull();
  });

  it('row actions are kit .nd-rowact (text on web), status is a slate switch, role type a neutral chip', () => {
    const { c } = render(UsersAccessComponent);
    const actions = c.userColDefs().find((d: any) => d.colId === 'actions').cellRenderer;
    const ctx = { ...c.gridContext, canCall: () => true, isOnline: () => true };
    const cell = actions({ data: users[0], context: ctx }) as HTMLElement;
    const btns = Array.from(cell.querySelectorAll('button'));
    expect(btns.every(b => b.classList.contains('nd-rowact'))).toBe(true);
    expect(btns.map(b => b.querySelector('.nd-rowact__t')!.textContent)).toEqual(['Call', 'Edit', 'Reset password']);
    const status = c.userColDefs().find((d: any) => d.colId === 'status').cellRenderer;
    const sw = (status({ data: users[0], context: ctx }) as HTMLElement).querySelector('button')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.classList.contains('nd-toggle')).toBe(true);
    const type = c.roleColDefs().find((d: any) => d.colId === 'isPreSeeded').cellRenderer;
    const custom = (type({ data: roles[1] }) as HTMLElement).querySelector('.nd-chip')!;
    expect(custom.textContent).toBe('Custom');
    expect(custom.getAttribute('style') ?? '').not.toMatch(/16,\s*185|10b981|059669/);
  });

  it('touch: row actions become 44px icon buttons (label kept for AT)', () => {
    const { c } = render(UsersAccessComponent);
    const actions = c.userColDefs().find((d: any) => d.colId === 'actions').cellRenderer;
    const cell = actions({ data: users[0], context: { ...c.gridContext, web: () => false } }) as HTMLElement;
    const edit = Array.from(cell.querySelectorAll('button')).find(b => b.textContent === 'Edit')!;
    expect(edit.classList.contains('nd-rowact--icon')).toBe(true);
    expect(edit.querySelector('svg')).not.toBeNull();
    expect(edit.getAttribute('aria-label')).toContain('Edit');
  });
});
