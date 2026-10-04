import { Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
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
import { PageOpenService } from '../../../core/navigation/page-open.service';
import { UserEditComponent } from './user-edit.component';
import { RoleEditorComponent } from './role-editor.component';
import { UsersAccessComponent } from './users-access.component';

/**
 * Users & access — LOADING FEEDBACK (ND-PATTERN "Loading feedback"). Opening
 * a user / role draws the editor's own shape on the FIRST frame (never a
 * blank form, never the "create" form flashing before an existing role),
 * Save is not offered until the record is on screen, Save turns busy while
 * it runs, and the list shows skeleton rows until users + roles land.
 */
const roles = [
  { id: 'r1', name: 'Lab Technician', isPreSeeded: true, scope: 'tenant' },
  { id: 'r2', name: 'Night Shift', isPreSeeded: false, scope: 'tenant' },
];
const users = [
  { id: 'u1', firstName: 'Prem', fathersName: 'Kumar', displayName: 'Dr. Prem Kumar', title: 'Dr.',
    username: 'drprem', email: '', phone: '+91 9876543210', isActive: true, authId: 'a1' },
];
const perms = [{ id: 'p1', code: 'manage_users', name: 'Manage users', description: '' }];

function render<T>(cmp: Type<T>, opts: { id?: string; slow?: Record<string, Subject<unknown>>; put$?: Subject<unknown> } = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const slow = (url: string, v: unknown): Observable<unknown> => {
    const hit = Object.keys(opts.slow ?? {}).find(k => url === k);
    return hit ? opts.slow![hit] : of(v);
  };
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/roles/') && url.endsWith('/permissions')) return slow(url, ['p1']);
      if (url.startsWith('/api/roles')) return slow(url, roles);
      if (url.startsWith('/api/permissions')) return slow(url, perms);
      if (url.startsWith('/api/tenants/branches')) return of([{ id: 'b1', name: 'Main Lab' }]);
      if (url.startsWith('/api/users/u1/roles')) return slow(url, [{ roleId: 'r1', branchId: 'b1' }]);
      if (url.startsWith('/api/users')) return slow(url, users);
      return of([]);
    }),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})),
    put: vi.fn(() => opts.put$ ?? of({})),
  };
  const pageOpen = { markSource: vi.fn(), pending: signal(false), frame: signal(null) };
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
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(opts.id ? [['id', opts.id]] : []) },
        queryParams: of({}) } },
      { provide: WebrtcService, useValue: { startCall: vi.fn() } },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set<string>()), userPresences: signal(new Map<string, string>()) } },
      { provide: PresenceService, useValue: { seedFromUsers: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
      { provide: PageOpenService, useValue: pageOpen },
    ],
  });
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, api, c: f.componentInstance as any, pageOpen };
}

describe('Users & access — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); TestBed.resetTestingModule(); });

  it('Edit user: the first render is the editor skeleton (no blank form) and Save is not offered yet', () => {
    const rec$ = new Subject<unknown>();
    const { el } = render(UserEditComponent, { id: 'u1', slow: { '/api/users/': rec$ } });
    expect(el.querySelector('.pf-ue-loading pf-skeleton-form[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('.pf-band-body input.nd-input')).toBeNull();
    const save = el.querySelector<HTMLButtonElement>('.pf-uf-primary')!;
    expect(save.disabled).toBe(true);
  });

  it('Edit user: the record lands → skeleton held for the minimum, then the real form', async () => {
    const rec$ = new Subject<unknown>();
    const { f, el } = render(UserEditComponent, { id: 'u1', slow: { '/api/users/': rec$ } });
    await Promise.resolve();                      // the request is genuinely async
    rec$.next(users); rec$.complete();
    f.detectChanges();
    expect(el.querySelector('.pf-ue-loading')).not.toBeNull();       // held — no flash
    vi.advanceTimersByTime(600);
    f.detectChanges();
    expect(el.querySelector('.pf-ue-loading')).toBeNull();
    expect(el.querySelector('.pf-band-body input.nd-input')).not.toBeNull();
  });

  it('Edit user: Save is disabled + aria-busy the same frame, dots after 150ms', () => {
    const put$ = new Subject<unknown>();
    const { f, el } = render(UserEditComponent, { id: 'u1', put$ });
    const save = el.querySelector<HTMLButtonElement>('.pf-uf-primary')!;
    expect(save.disabled).toBe(false);
    save.click();
    f.detectChanges();
    expect(save.disabled).toBe(true);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.querySelector('pf-busy')).toBeNull();
    vi.advanceTimersByTime(150);
    f.detectChanges();
    expect(save.querySelector('pf-busy')).not.toBeNull();
  });

  it('Role editor (edit): skeleton until role + permissions land — the create form never flashes', () => {
    const roles$ = new Subject<unknown>();
    const { f, el } = render(RoleEditorComponent, { id: 'r2', slow: { '/api/roles/': roles$ } });
    expect(el.querySelector('.pf-re-loading pf-skeleton-card[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('input.pf-re-name')).toBeNull();          // no "Role name" create field
    roles$.next(roles); roles$.complete();
    vi.advanceTimersByTime(600);
    f.detectChanges();
    expect(el.querySelector('.pf-re-loading')).toBeNull();
    expect(el.querySelector('input.pf-re-name')).toBeNull();          // it is an existing role
  });

  it('Users list: skeleton rows over the grid until users + roles land', async () => {
    const users$ = new Subject<unknown>();
    const { f, el } = render(UsersAccessComponent, { slow: { '/api/users/': users$ } });
    expect(el.querySelector('.pf-ua-grid pf-skeleton-table[aria-busy="true"]')).not.toBeNull();
    await Promise.resolve();
    users$.next(users); users$.complete();
    vi.advanceTimersByTime(600);
    f.detectChanges();
    expect(el.querySelector('.pf-ua-grid pf-skeleton-table')).toBeNull();
  });

  it('Users list: a row\'s Edit marks the pressed button busy (held until the editor opens)', () => {
    const { c, pageOpen } = render(UsersAccessComponent);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const btn = document.createElement('button');
    c.gridContext.editUser(users[0], btn);
    expect(pageOpen.markSource).toHaveBeenCalledWith(btn);
    expect(navigate).toHaveBeenCalledWith(['/admin/users', 'u1', 'edit']);
  });
});
