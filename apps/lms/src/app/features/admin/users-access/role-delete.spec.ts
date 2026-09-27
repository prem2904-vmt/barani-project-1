import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { PresenceService } from '../../../core/services/presence.service';
import { UserAccountActionsService } from './user-account-actions.service';
import { UsersAccessComponent, isDeletableRole } from './users-access.component';
import type { Role } from '../../../shared/models/user.model';

/**
 * Users & roles → Delete (DELETE /api/roles/{id}). Only a tenant's own CUSTOM
 * role offers Delete; the confirm is a DialogService danger dialog; the
 * server's refusal (409 "assigned to N users") is shown verbatim and the row
 * stays.
 */
const role = (over: Partial<Role>): Role =>
  ({ id: 'r', name: 'Night Shift Tech', scope: 'tenant', isPreSeeded: false, isActive: true, createdAt: '', tenantId: 't1', ...over });

function make(opts: { confirm?: boolean; del?: () => unknown } = {}) {
  const api = {
    get: vi.fn(() => of([])),
    delete: vi.fn(opts.del ?? (() => of({ deleted: true }))),
  };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true) };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { user: () => ({ id: 'me' }), hasPermission: () => true } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      { provide: WebrtcService, useValue: {} },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set<string>()) } },
      { provide: PresenceService, useValue: { seedFromUsers: vi.fn() } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
      { provide: UserAccountActionsService, useValue: {} },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new UsersAccessComponent()) as any;
  return { c, api, dialog, toasts };
}

afterEach(() => TestBed.resetTestingModule());

describe('isDeletableRole', () => {
  it('custom tenant role → deletable', () => expect(isDeletableRole(role({}))).toBe(true));
  it('shared pre-seeded role → not', () => expect(isDeletableRole(role({ isPreSeeded: true, tenantId: undefined }))).toBe(false));
  it("a tenant's customised copy of a seeded role (same name) → not", () =>
    expect(isDeletableRole(role({ name: 'Lab Technician' }))).toBe(false));
});

describe('Users & roles — Delete role', () => {
  it('the roles grid shows Delete (red kit row action) on custom roles only', () => {
    const { c } = make();
    const cell = (r: Role) => c.roleActionsCellRenderer({ data: r, context: c.gridContext }) as HTMLElement;
    const custom = cell(role({}));
    const del = custom.querySelector('.pf-ua-del') as HTMLButtonElement;
    expect(del).not.toBeNull();
    expect(del.classList.contains('nd-rowact')).toBe(true);
    expect(del.style.color).toContain('--red-text');
    expect(cell(role({ isPreSeeded: true, name: 'Receptionist', tenantId: undefined })).querySelector('.pf-ua-del')).toBeNull();
    expect(cell(role({ name: 'Receptionist' })).querySelector('.pf-ua-del')).toBeNull();
  });

  it('confirm (danger) → DELETE /api/roles/{id} → row removed + success toast', async () => {
    const { c, api, dialog, toasts } = make();
    c._roles.set([role({ id: 'keep', name: 'Other' }), role({ id: 'gone' })]);
    await c.deleteRole(role({ id: 'gone' }));
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', confirmLabel: 'Delete role' }));
    expect(api.delete).toHaveBeenCalledWith('/api/roles/gone');
    expect(c._roles().map((r: Role) => r.id)).toEqual(['keep']);
    expect(toasts.success).toHaveBeenCalled();
  });

  it('cancel → nothing is sent', async () => {
    const { c, api } = make({ confirm: false });
    await c.deleteRole(role({}));
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('server refuses (role still assigned) → its message is shown, the row stays', async () => {
    const msg = '"Night Shift Tech" is assigned to 3 users. Move them to another role first, then delete it.';
    const { c, toasts } = make({ del: () => throwError(() => ({ status: 409, error: { error: 'role_in_use', message: msg } })) });
    c._roles.set([role({ id: 'r' })]);
    await c.deleteRole(role({ id: 'r' }));
    expect(toasts.error).toHaveBeenCalledWith(msg);
    expect(c._roles().length).toBe(1);
  });

  it('a built-in role never reaches the API', async () => {
    const { c, api, dialog } = make();
    await c.deleteRole(role({ isPreSeeded: true, tenantId: undefined, name: 'Pathologist' }));
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
