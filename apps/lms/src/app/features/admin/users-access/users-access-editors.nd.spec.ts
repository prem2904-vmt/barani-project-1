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
 * Users & Access — PF-PATTERN "Editors". Create user, edit user and the role
 * editor carry the band (back · tenant · ONE primary) with the pill as the
 * CONTEXT BAR; sections are pf-cards with kit fields, roles / permissions are
 * slate switches (role=switch), no native select, no mono / green. The list's
 * row actions are kit .pf-rowact buttons and its status is a slate switch.
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

function render<T>(cmp: Type<T>, opts: { id?: string; nd?: boolean; confirm?: (...a: any[]) => Promise<boolean>; opd?: boolean } = {}) {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/roles/') && url.endsWith('/permissions')) return of(['p1']);
      if (url.startsWith('/api/roles')) return of(roles);
      if (url.startsWith('/api/permissions')) return of(perms);
      if (url.startsWith('/api/tenants/branches')) return of([{ id: 'b1', name: 'Main Lab' }, { id: 'b2', name: 'Annex' }]);
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
      { provide: DialogService, useValue: { confirm: opts.confirm ?? vi.fn(async () => false) } },
      // opd: the server's /me OPD flags (OPD dark build) — an explicitly OPD-entitled tenant.
      { provide: AuthService, useValue: { user: () => ({ id: 'me', tenantName: 'Micro World', ...(opts.opd ? { opdAccess: true, opdEntitled: true } : {}) }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn(),
        registerBackInterceptor: vi.fn(), clearBackInterceptor: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => opts.nd ?? true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(opts.id ? [['id', opts.id]] : []) },
        queryParams: of({}) } },
      { provide: WebrtcService, useValue: { startCall: vi.fn() } },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set<string>()), userPresences: signal(new Map<string, string>()) } },
      { provide: PresenceService, useValue: { seedFromUsers: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
    ],
  });
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { f, el, api, c: f.componentInstance as any, txt };
}

/** The palette / font / native-control hygiene every editor must pass. */
function hygiene(el: HTMLElement) {
  expect(el.querySelector('select, datalist, code, .mono, .font-mono, .c-green, .c-amber, pf-tile')).toBeNull();
  expect(el.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  expect(/[✕✓✔●↑↓]/.test(el.textContent ?? '')).toBe(false);
  // Settings: no band buttons and no violet primary — the page's action is a secondary IN the pane.
  expect(el.querySelectorAll('pf-hero-band .pf-hb__actions button:not([data-testid="band-save"] button)').length).toBe(0);
  expect(el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary, pf-touch-btn:not(.pf-classic-only pf-touch-btn) .v-primary').length).toBe(0);
}

describe('Users & Access editors — new design (ND §14: pill = name only)', () => {
  const noFacts = (el: HTMLElement) => {
    expect(el.querySelectorAll('pf-hero-band .pf-ctx__chip').length).toBe(0);
    expect(el.querySelectorAll('pf-hero-band .pf-ctx > *').length).toBe(1);
  };

  it('Create user: Create at the form\'s foot (in the pane, secondary); the pill is only the name ("New user" → typed) with a pencil', async () => {
    const { el, f, c, txt } = render(UserInviteComponent);
    const create = el.querySelectorAll('.pf-band-body .ui-page-foot .pf-btn--secondary');
    expect(create.length).toBe(1);
    expect(create[0].textContent).toContain('Create user');
    expect(txt(el.querySelector('.pf-uf-ctx__text'))).toBe('New user');
    c.patch({ title: 'Dr.', firstName: 'Priya', fathersName: 'Raman', username: 'DrPriya' });
    f.detectChanges();
    expect(txt(el.querySelector('.pf-uf-ctx__text'))).toBe('Dr. Priya Raman');
    noFacts(el);
    (el.querySelector('.pf-ctx__edit') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(el.querySelector('.pf-band-body input.pf-input'));
    expect(el.querySelector('pf-screen-header')!.classList.contains('pf-classic-only')).toBe(true);
    hygiene(el);
  });

  it('Create user: roles are slate switches (aria-checked, no --on class); one on enables Create', () => {
    const { el, f, c } = render(UserInviteComponent);
    const sw = el.querySelectorAll<HTMLButtonElement>('.pf-uf-roles .pf-toggle[role="switch"]');
    expect(sw.length).toBe(2);
    expect(sw[0].getAttribute('aria-checked')).toBe('false');
    sw[0].click();
    f.detectChanges();
    expect(sw[0].getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('button[class*="--on"], label[class*="--on"], a[class*="--on"]')).toBeNull();
    c.patch({ username: 'drpriya', password: 'secret123' });
    f.detectChanges();
    expect((el.querySelector('.ui-page-foot .pf-uf-primary') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Create user: sections are pf-cards with kit fields; title + country code are pf-select', () => {
    const { el } = render(UserInviteComponent);
    expect(el.querySelectorAll('.pf-band-body .pf-card .pf-card__head .pf-card__icon svg').length).toBeGreaterThanOrEqual(3);
    expect(el.querySelectorAll('.pf-band-body input.pf-input').length).toBeGreaterThanOrEqual(4);
    expect(el.querySelector('.pf-uf-phone pf-select')).not.toBeNull();
  });

  it('Edit user: the pill is the full name only; Save in the card\'s Save bar once changed; summary strip; sections LEFT, roles pre-switched', () => {
    const { el, f, c, txt } = render(UserEditComponent, { id: 'u1' });
    expect(txt(el.querySelector('.pf-uf-ctx__text'))).toBe('Dr. Prem Kumar');
    noFacts(el);
    expect(el.querySelector('[data-testid="ue-save"]')).toBeNull();   // nothing changed yet
    // Slim summary strip: name, username, status, branches.
    const strip = el.querySelector('.ue-strip')!;
    expect(txt(strip)).toContain('Dr. Prem Kumar');
    expect(txt(strip)).toContain('drprem');
    expect(txt(strip.querySelector('[data-testid="ue-status"]'))).toBe('Active');
    // Sections side card first (LEFT), main card second; Profile rows are label-left / control-right.
    const panels = el.querySelector('.pf-sg-panels')!;
    expect(panels.firstElementChild!.classList.contains('ue-side')).toBe(true);
    expect(Array.from(el.querySelectorAll('.ue-sec__name')).map(n => txt(n).replace('*', ''))).toEqual(['Profile', 'Branches', 'Roles', 'Validates for']);
    expect(el.querySelectorAll('.ue-main pf-setting-row').length).toBeGreaterThanOrEqual(5);
    expect(txt(el.querySelector('.ue-main .ue-ro'))).toBe('drprem');
    // Roles section: Role | what it means | switch, one on; the combined-permissions note in the head.
    c.pickSection('roles'); f.detectChanges();
    expect(el.querySelectorAll('.pf-uf-roles .pf-toggle[aria-checked="true"]').length).toBe(1);
    expect(txt(el.querySelector('[data-testid="ue-perm-note"]'))).toContain('1 of 2 permissions from 1 role');
    hygiene(el);
    c.patch({ firstName: 'Premnath' }); f.detectChanges();
    expect(el.querySelector('pf-hero-band [data-testid="ue-save"]')).not.toBeNull();
  });

  it('Edit user: a missing branch / role flags its section; Save stays off', () => {
    const { f, c, el } = render(UserEditComponent, { id: 'u1' });
    c.toggleRole('r1'); f.detectChanges();
    expect(c.canSave()).toBe(false);
    expect(el.querySelector('[data-testid="ue-sec-roles"] .ue-sec__note--err')).not.toBeNull();
  });

  it('Edit user: Reset password + Deactivate are quiet icons in the summary strip (in the pane) that reuse the list\'s confirms', async () => {
    const confirm = vi.fn(async () => true);
    const { el, f, api } = render(UserEditComponent, { id: 'u1', confirm });
    const reset = el.querySelector<HTMLButtonElement>('.ue-strip .pf-ue-reset')!;
    const active = () => el.querySelector<HTMLButtonElement>('.ue-strip .pf-ue-active')!;
    expect(reset.classList.contains('pf-rowact--icon')).toBe(true);
    expect(active().classList.contains('pf-rowact--icon')).toBe(true);
    expect(active().textContent).toContain('Deactivate');
    expect(el.querySelectorAll('pf-hero-band .pf-hb__actions button:not([data-testid="band-save"] button)').length).toBe(0);

    reset.click();
    await new Promise(r => setTimeout(r));
    expect((confirm.mock.calls[0] as any[])[0].title).toBe('Reset password for Dr. Prem Kumar?');
    expect(api.post).toHaveBeenCalledWith('/api/users/u1/reset-password', expect.objectContaining({ newPassword: expect.any(String) }));

    active().click();
    await new Promise(r => setTimeout(r));
    f.detectChanges();
    expect(confirm.mock.calls.some((c: any[]) => c[0].title === 'Deactivate Dr. Prem Kumar?' && c[0].tone === 'danger')).toBe(true);
    expect(api.delete).toHaveBeenCalledWith('/api/users/u1');
    expect(active().textContent).toContain('Reactivate');

    active().click();
    await new Promise(r => setTimeout(r));
    expect(api.patch).toHaveBeenCalledWith('/api/users/u1', { isActive: true });
  });

  it('Edit user: a cancelled confirm changes nothing', async () => {
    const { el, api } = render(UserEditComponent, { id: 'u1' });
    el.querySelector<HTMLButtonElement>('.ue-strip .pf-ue-active')!.click();
    await new Promise(r => setTimeout(r));
    expect(api.delete).not.toHaveBeenCalled();
    expect(el.querySelector('.ue-strip .pf-ue-active')!.textContent).toContain('Deactivate');
  });

  it('New role: Test Master frame — band pill finds a permission, Save in the card\'s Save bar once named; name in the summary strip; groups LEFT, permissions grid RIGHT', () => {
    const { el, f, c } = render(RoleEditorComponent);
    // The band pill is the permission search (no record chips in the band).
    expect(el.querySelector('pf-hero-band .pf-hb__input')).not.toBeNull();
    expect(el.querySelectorAll('pf-hero-band .pf-ctx__chip').length).toBe(0);
    expect(el.querySelector('pf-hero-band .pf-hb__actions button')).toBeNull();
    expect(el.querySelector('[data-testid="role-save"]')).toBeNull();
    // Role name lives in the slim summary strip.
    const name = el.querySelector<HTMLInputElement>('.re-strip input.pf-re-name')!;
    expect(name).not.toBeNull();
    c.onNameChange('Billing Supervisor');
    f.detectChanges();
    expect(c.newRoleName()).toBe('Billing Supervisor');
    expect(el.querySelector('pf-hero-band [data-testid="role-save"]')).not.toBeNull();
    expect(el.querySelector('.re-strip')!.textContent).toContain('of');
    // OPD dark build: the Doctor role type is an OPD surface — hidden while OPD is dark.
    expect(el.querySelectorAll('.re-type.pf-seg [role="radio"]').length).toBe(0);
    // Side card first (LEFT): All + one row per group; the grid card second.
    const panels = el.querySelector('.pf-sg-panels')!;
    expect(panels.firstElementChild!.classList.contains('re-side')).toBe(true);
    expect(el.querySelectorAll('.re-side .re-g__btn').length).toBeGreaterThan(1);
    expect(c.colDefs().map((d: any) => d.colId)).toEqual(['allowed', 'title', 'what', 'impact', 'code']);
    expect(c.gridRows().length).toBe(2);
    // The Allowed cell is the kit switch; flipping it grants the permission.
    const cell = c.colDefs()[0].cellRenderer({ data: c.gridRows()[1] }) as HTMLElement;
    const sw = cell.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    f.detectChanges();
    expect(c.grantedCount()).toBe(1);
    expect(c.gridRows()[1].allowed).toBe(true);
    hygiene(el);
  });

  it('Role editor: band search finds a permission across all groups; a group filters the grid; Grant all / Clear', () => {
    const { f, c } = render(RoleEditorComponent);
    const groups = c.groupViews();
    c.pickGroup(groups[0].key);
    f.detectChanges();
    expect(c.gridRows().every((r: any) => r.group === groups[0].key)).toBe(true);
    c.grantGroup(c.selectedGroup(), true);
    expect(c.selectedGroup().granted).toBe(c.selectedGroup().items.length);
    c.grantGroup(c.selectedGroup(), false);
    expect(c.selectedGroup().granted).toBe(0);
    c.onSearch('enter_results');
    expect(c.groupKey()).toBeNull();
    expect(c.gridRows().map((r: any) => r.perm.code)).toEqual(['enter_results']);
  });

  it('Create user, doctor-type role, OPD dark: registration number only (no OPD department / specialisation / procedures)', () => {
    const { el, f, c } = render(UserInviteComponent);
    (c as any)._roles.set([...roles, { id: 'r3', name: 'Pathologist', isPreSeeded: true, scope: 'tenant', kind: 'doctor' }]);
    (c as any).toggleRole('r3');
    f.detectChanges();
    const doc = el.querySelector('.pf-doc')!;
    expect(doc).not.toBeNull();
    expect(doc.textContent).toContain('Medical Registration No.');
    expect(doc.textContent).not.toContain('Department');
    expect(doc.textContent).not.toContain('Specialisation');
    expect(doc.textContent).not.toContain('Procedures');
  });

  it('Create user, doctor-type role, OPD tenant: the OPD doctor fields appear', () => {
    const { el, f, c } = render(UserInviteComponent, { opd: true });
    (c as any)._roles.set([...roles, { id: 'r3', name: 'Pathologist', isPreSeeded: true, scope: 'tenant', kind: 'doctor' }]);
    (c as any).toggleRole('r3');
    f.detectChanges();
    const doc = el.querySelector('.pf-doc')!;
    expect(doc.textContent).toContain('Department');
    expect(doc.textContent).toContain('Specialisation');
  });

  it('New role in an OPD tenant: role type General / Doctor is a 2-item pf-seg', () => {
    const { el } = render(RoleEditorComponent, { opd: true });
    expect(el.querySelectorAll('.re-type.pf-seg [role="radio"]').length).toBe(2);
  });

  it('Edit role: the name + ONE tiny muted badge (Pre-seeded) in the summary strip, no name field (locked), system-role wording kept', () => {
    const { el, txt } = render(RoleEditorComponent, { id: 'r1' });
    expect(txt(el.querySelector('.re-strip .pf-uf-ctx__text'))).toBe('Lab Technician');
    expect(txt(el.querySelector('.re-strip .pf-uf-ctx__badge'))).toBe('Pre-seeded');
    expect(el.querySelector('input.pf-re-name')).toBeNull();
    expect(el.querySelector('.re-strip')!.textContent).toContain('Editing the permissions saves a copy for your organisation only.');
    expect(el.querySelectorAll('pf-hero-band .pf-ctx__chip').length).toBe(0);
    expect(el.querySelector('pf-hero-band .pf-hb__actions button')).toBeNull();
    hygiene(el);
  });

  it('classic design keeps pf-screen-header and no band', () => {
    const { el } = render(RoleEditorComponent, { nd: false });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('pf-screen-header')).not.toBeNull();
  });
});

describe('Users & Access list — current rules', () => {
  it('Noto grid, Create user in the card head (no band buttons), no mono count', () => {
    const { el, c } = render(UsersAccessComponent);
    expect(c.gridTheme()).toBeTruthy();
    expect(el.querySelectorAll('pf-hero-band .pf-hb__actions button:not([data-testid="band-save"] button)').length).toBe(0);
    expect(el.querySelector('.pf-sg-act')!.textContent).toContain('Create user');
    expect(el.querySelector('.font-mono')).toBeNull();
  });

  it('row actions are kit .pf-rowact (text on web), status is a slate switch, role type a neutral chip', () => {
    const { c } = render(UsersAccessComponent);
    const actions = c.userColDefs().find((d: any) => d.colId === 'actions').cellRenderer;
    const ctx = { ...c.gridContext, canCall: () => true, isOnline: () => true };
    const cell = actions({ data: users[0], context: ctx }) as HTMLElement;
    const btns = Array.from(cell.querySelectorAll('button'));
    expect(btns.every(b => b.classList.contains('pf-rowact'))).toBe(true);
    expect(btns.map(b => b.querySelector('.pf-rowact__t')!.textContent)).toEqual(['Call', 'Edit', 'Reset password']);
    const status = c.userColDefs().find((d: any) => d.colId === 'status').cellRenderer;
    const sw = (status({ data: users[0], context: ctx }) as HTMLElement).querySelector('button')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.classList.contains('pf-toggle')).toBe(true);
    const type = c.roleColDefs().find((d: any) => d.colId === 'isPreSeeded').cellRenderer;
    const custom = (type({ data: roles[1] }) as HTMLElement).querySelector('.pf-chip')!;
    expect(custom.textContent).toBe('Custom');
    expect(custom.getAttribute('style') ?? '').not.toMatch(/16,\s*185|10b981|059669/);
  });

  it('ONE Test Master grid card: the Users | Roles switch, status filter and count are head tools (headTools for a host head)', () => {
    const { c, f, el } = render(UsersAccessComponent);
    expect(el.querySelector('.pf-sg-main .pf-sg-main__head pf-segmented.pf-ua-tabseg')).not.toBeNull();
    expect(c.headTools()).toBeTruthy();
    expect(c.gridUsers().length).toBe(1);
    c.status.set('inactive'); f.detectChanges();
    expect(c.gridUsers().length).toBe(0);
    // The grid sizes by flex (never a % height that a host without a definite height collapses to 0).
    expect(el.querySelector('pf-data-grid ag-grid-angular')).not.toBeNull();
  });

  it('touch: row actions become 44px icon buttons (label kept for AT)', () => {
    const { c } = render(UsersAccessComponent);
    const actions = c.userColDefs().find((d: any) => d.colId === 'actions').cellRenderer;
    const cell = actions({ data: users[0], context: { ...c.gridContext, web: () => false } }) as HTMLElement;
    const edit = Array.from(cell.querySelectorAll('button')).find(b => b.textContent === 'Edit')!;
    expect(edit.classList.contains('pf-rowact--icon')).toBe(true);
    expect(edit.querySelector('svg')).not.toBeNull();
    expect(edit.getAttribute('aria-label')).toContain('Edit');
  });
});

describe('User editor — panel mode (beside the People grid)', () => {
  it('ONE scrolling form: Profile · Branches · Roles · Validates for, account actions in the head, Save at the foot; save closes', () => {
    const { el, f, c, api } = render(UserEditComponent);
    f.componentRef.setInput('panelId', 'u1');
    c.ngOnInit(); f.detectChanges();
    const panel = el.querySelector('[data-testid="ue-panel"]')!;
    expect(panel).not.toBeNull();
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(Array.from(panel.querySelectorAll('.ue-panel__sec')).map(h => h.textContent!.trim().split(' ')[0])).toEqual(['Profile', 'Branches', 'Roles', 'Validates']);
    expect(panel.querySelector('.pf-ue-reset')).not.toBeNull();
    expect(panel.querySelectorAll('.pf-btn--primary').length).toBe(1);
    let closed = 0; c.closed.subscribe(() => closed++);
    c.save();
    expect(api.patch).toHaveBeenCalledWith('/api/users/u1', expect.anything());
    expect(closed).toBe(1);
  });
});

describe('People grid — Create user opens the form beside the grid', () => {
  it('Create user → the invite panel (one form, Create at the foot); the band button steps down to ghost', async () => {
    const { el, f, c } = render(UsersAccessComponent);
    c.openInvite(); f.detectChanges();
    expect(el.querySelector('.pf-ua-panel [data-testid="ui-panel"]')).not.toBeNull();
    expect(el.querySelector('.pf-sg-panels')!.firstElementChild!.classList.contains('pf-ua-panel')).toBe(true);
    expect(el.querySelector('pf-hero-band .pf-hb-btn--primary')).toBeNull();
    expect(el.querySelectorAll('.pf-ua-panel .pf-btn--primary').length).toBe(1);
    await c.openInvite(); await Promise.resolve(); f.detectChanges();
    expect(el.querySelector('.pf-ua-panel')).toBeNull();
  });

  it('closing a panel with unsaved edits asks first (DialogService "Save your changes?"); Stay keeps it open', async () => {
    const { el, f, c } = render(UsersAccessComponent);
    const dialog = TestBed.inject(DialogService) as any;
    dialog.actions = vi.fn(async () => ({ action: null, checked: false }));
    await c.openInvite(); f.detectChanges();
    const inv = (c as any).invitePanel();
    inv.patch({ firstName: 'Priya' });
    expect(c.hasUnsavedChanges()).toBe(true);
    await c.requestClosePanel(); f.detectChanges();
    expect(dialog.actions).toHaveBeenCalled();
    expect(el.querySelector('.pf-ua-panel')).not.toBeNull();
    dialog.actions = vi.fn(async () => ({ action: 'leave', checked: false }));
    await c.requestClosePanel(); f.detectChanges();
    expect(el.querySelector('.pf-ua-panel')).toBeNull();
  });
});

describe('Role editor — unsaved changes', () => {
  it('a changed grant is an unsaved change; the prompt\'s Save sends the same PATCH and clears it', async () => {
    const { f, c, api } = render(RoleEditorComponent, { id: 'r1' });
    f.detectChanges();
    expect(c.hasUnsavedChanges()).toBe(false);
    c.setGranted('p2', true);
    expect(c.hasUnsavedChanges()).toBe(true);
    expect(await c.saveChanges()).toBe(true);
    expect(api.patch).toHaveBeenCalledWith('/api/roles/r1/permissions', { permissionIds: ['p1', 'p2'] });
    expect(c.hasUnsavedChanges()).toBe(false);
  });
});
