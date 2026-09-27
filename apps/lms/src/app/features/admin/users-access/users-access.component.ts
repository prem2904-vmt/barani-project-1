import { firstValueFrom } from 'rxjs';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AllCommunityModule,
  ColDef,
  GridApi,
  ICellRendererParams,
  ModuleRegistry,
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ApiService } from '../../../core/services/api.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { UserAccountActionsService } from './user-account-actions.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { Role, User, userDisplayName } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { PresenceService } from '../../../core/services/presence.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ROLE_INFO } from './permission-catalog';
import { UserBranchScope, branchScopeChips } from './branch-scope';
import { UserDepartmentsRow, departmentNames } from './consultant-departments';
import { Department } from '../../../shared/models/tenant.model';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';

ModuleRegistry.registerModules([AllCommunityModule]);

type Tab = 'users' | 'roles';

const svg = (d: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_CALL = svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>');
const ICON_EDIT = svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>');
const ICON_KEY = svg('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>');
const ICON_SHIELD = svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>');
const ICON_TRASH = svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>');

/** A tenant's own CUSTOM role — the only kind DELETE /api/roles/{id} accepts.
 *  Built-ins are the shared pre-seeded rows AND a tenant's customised copy of
 *  one (same seeded name, isPreSeeded false) — the server answers 400 for both. */
export function isDeletableRole(r: Pick<Role, 'isPreSeeded' | 'tenantId' | 'name'>): boolean {
  return !r.isPreSeeded && !!r.tenantId && !(r.name in ROLE_INFO);
}

/** Kit row action (ND-PATTERN): a 32px secondary TEXT button on web, a
 *  neutral 44px ICON button on touch (label kept for AT + tooltip). */
function rowAction(web: boolean, label: string, icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = web ? 'nd-rowact' : 'nd-rowact nd-rowact--icon';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `${icon}<span class="nd-rowact__t">${label}</span>`;
  return b;
}

const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: "'Noto Sans', system-ui, sans-serif",
  fontSize: 13,
  rowHeight: 52,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#7c3aed',
});

const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: "'Noto Sans', system-ui, sans-serif",
  fontSize: 13,
  rowHeight: 52,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#a855f7',
});

@Component({
  selector: 'pf-users-access',
  standalone: true,
  imports: [
    FormsModule,
    AgGridAngular,
    ScreenHeaderComponent,
    SegmentedComponent,
    TouchButtonComponent,
    HeroBandComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the search and the Users / Roles switch ride
             inside the pill; Create user / Create role sits top-right. -->
        <pf-hero-band [back]="true"
                      [placeholder]="tab() === 'users' ? 'Search users — name, username, email…' : 'Search roles…'"
                      [value]="search()" (valueChange)="onSearch($event)">
          <span band-inline class="pf-ua-count">
            @if (tab() === 'users') {
              {{ filteredUsers().length }} user{{ filteredUsers().length === 1 ? '' : 's' }}
            } @else {
              {{ filteredRoles().length }} role{{ filteredRoles().length === 1 ? '' : 's' }}
            }
          </span>
          <ng-container band-tools>
            <pf-segmented size="sm" [options]="tabOptions" [value]="tab()"
                          (valueChange)="setTab($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            @if (tab() === 'users') {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="openInvite()"
                      title="Create user" aria-label="Create user">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 5v14"/><path d="M5 12h14"/>
                </svg>
                Create user
              </button>
            } @else {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="openNewRole()"
                      title="Create role" aria-label="Create role">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 5v14"/><path d="M5 12h14"/>
                </svg>
                Create role
              </button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Users & Access"
        subtitle="Create users, assign roles, and control permissions across your branches.">
        @if (tab() === 'users') {
          <pf-touch-btn actions size="sm" variant="primary" (pressed)="openInvite()">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
              </svg>
            </span>
            Create user
          </pf-touch-btn>
        } @else {
          <pf-touch-btn actions size="sm" variant="primary" (pressed)="openNewRole()">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
              </svg>
            </span>
            Create role
          </pf-touch-btn>
        }
      </pf-screen-header>

      <div class="pf-classic-only flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div class="pf-tabbar">
          <pf-segmented
            [options]="tabOptions"
            [value]="tab()"
            size="md"
            (valueChange)="setTab($event)">
          </pf-segmented>
        </div>

        <div class="flex items-center gap-3 ml-auto">
          <span class="text-[12px] nd-num" style="color: var(--text-muted);">
            @if (tab() === 'users') {
              {{ filteredUsers().length }} user{{ filteredUsers().length === 1 ? '' : 's' }}
            } @else {
              {{ filteredRoles().length }} role{{ filteredRoles().length === 1 ? '' : 's' }}
            }
          </span>
          <input type="text" class="pf-input w-64" placeholder="Search name or username…"
                 [ngModel]="search()" (ngModelChange)="onSearch($event)" />
        </div>
      </div>

      <!-- The grid fills the band body and scrolls itself (no page scroll). -->
      <div class="pf-band-body pf-band-body--fill">
      @if (tab() === 'users') {
        <div class="pf-ua-grid w-full rounded-2xl overflow-hidden border shadow-sm"
             style="border-color: var(--border-color, rgba(0,0,0,0.1));">
          <ag-grid-angular
            style="width: 100%; height: 100%;"
            [theme]="gridTheme()"
            [rowData]="filteredUsers()"
            [columnDefs]="userColDefs()"
            [context]="gridContext"
            [animateRows]="true"
            [rowSelection]="'single'">
          </ag-grid-angular>
        </div>
      } @else {
        <div class="pf-ua-grid w-full rounded-2xl overflow-hidden border shadow-sm"
             style="border-color: var(--border-color, rgba(0,0,0,0.1));">
          <ag-grid-angular
            style="width: 100%; height: 100%;"
            [theme]="gridTheme()"
            [rowData]="filteredRoles()"
            [columnDefs]="roleColDefs()"
            [context]="gridContext"
            [animateRows]="true"
            [rowSelection]="'single'">
          </ag-grid-angular>
        </div>
      }
      </div>
    </section>
  `,
  styles: [`
    /* Classic: the grid sizes off the viewport; new design: it fills the band body. */
    .pf-ua-grid { height: calc(100vh - 240px); min-height: 420px; }
    :host-context(.design-new) .pf-ua-grid { flex: 1 1 auto; height: auto; min-height: 320px; }
    .pf-ua-count {
      font-size: 12px; font-variant-numeric: tabular-nums;
      color: var(--text-muted); white-space: nowrap; padding: 0 6px;
    }
    @media (max-width: 640px) {
      .pf-ua-count { display: none; }
      :host input.pf-input { font-size: 16px; }
      :host .pf-tabbar { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    }
  `]
})
export class UsersAccessComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly theme = inject(ThemeService);
  private readonly webrtc = inject(WebrtcService);
  private readonly signaling = inject(SignalingService);
  private readonly presence = inject(PresenceService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly accountActions = inject(UserAccountActionsService);
  private readonly entitlements = inject(TenantEntitlementsService);

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  /** Row actions: TEXT on web (fine pointer + hover), ICON on touch. */
  readonly web = webPointerSignal();

  /** Returns true if calling this user makes sense: the Messages module is in
   *  the plan (calls are part of it), the user is active, and not yourself. */
  canCall(u: User): boolean {
    return this.entitlements.moduleEnabled('messages') && u.isActive && u.id !== this.auth.user()?.id;
  }

  /** Online presence check — used to disable the Call button when offline. */
  isOnline(userId: string): boolean {
    return this.signaling.onlineUserIds().has(userId);
  }

  async callUser(u: User): Promise<void> {
    if (!this.canCall(u) || !u.authId) return;
    if (!this.isOnline(u.authId)) {
      this.toasts.info(`${u.displayName} is offline.`);
      return;
    }
    try {
      await this.webrtc.startCall(u.authId, 'admin_internal');
      this.toasts.info(`Ringing ${u.displayName}…`);
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not place call.');
    }
  }

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'users', label: 'Users' },
    { value: 'roles', label: 'Roles & Permissions' }
  ];
  private readonly _tab = signal<Tab>('users');
  readonly tab = this._tab.asReadonly();

  private readonly _users = signal<User[]>([]);
  private readonly _roles = signal<Role[]>([]);
  private readonly _search = signal('');
  /** Each user's branch scope (the Branches column), keyed by user id. */
  private readonly _scopes = signal<Map<string, UserBranchScope>>(new Map());
  /** Each consultant's departments (the Departments column), keyed by user id. */
  private readonly _depts = signal<Map<string, UserDepartmentsRow>>(new Map());
  private readonly _deptNames = signal<Map<string, string>>(new Map());
  /** A user's department names for the Departments column (empty = none assigned). */
  userDepartments(userId: string | undefined): string[] {
    return userId ? departmentNames(this._depts().get(userId), this._deptNames()) : [];
  }

  readonly users = this._users.asReadonly();
  readonly roles = this._roles.asReadonly();
  readonly search = this._search.asReadonly();

  readonly filteredUsers = computed<(User & { branchScope?: UserBranchScope })[]>(() => {
    const s = this._search().toLowerCase();
    const scopes = this._scopes();
    const list = s
      ? this._users().filter(u => userDisplayName(u).toLowerCase().includes(s) || (u.username ?? '').toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
          || branchScopeChips(scopes.get(u.id)).some(c => c.toLowerCase().includes(s)))
      : this._users();
    return scopes.size ? list.map(u => ({ ...u, branchScope: scopes.get(u.id) })) : list;
  });

  readonly filteredRoles = computed(() => {
    const s = this._search().toLowerCase();
    return s
      ? this._roles().filter(r => r.name.toLowerCase().includes(s) || (r.scope ?? '').toLowerCase().includes(s))
      : this._roles();
  });

  private userCellRenderer = (params: ICellRendererParams<User>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;min-width:0;gap:10px;';
    if (!params.data) return wrap;

    const u = params.data;
    const name = u.displayName || u.firstName || u.username || 'User';

    const avatar = document.createElement('div');
    // Designer avatar: flat soft-violet disc, violet initials (no gradient —
    // the gradient is reserved for the ONE primary action).
    avatar.className = 'pf-ua-avatar';
    avatar.style.cssText = 'width:32px;height:32px;border-radius:50%;background:color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);color:var(--violet-text, #6d28d9);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;';
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    avatar.textContent = initials;
    wrap.appendChild(avatar);

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-weight:500;font-size:14px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameSpan.textContent = name;
    wrap.appendChild(nameSpan);

    return wrap;
  };

  /** Branches column: "All branches", or one chip per branch / lab. */
  private userBranchesCellRenderer = (params: ICellRendererParams<User & { branchScope?: UserBranchScope }>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'pf-ua-branches';
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:100%;padding:6px 0;';
    for (const label of branchScopeChips(params.data?.branchScope)) {
      const chip = document.createElement('span');
      chip.className = 'nd-chip nd-chip--static pf-ua-branch';
      chip.style.cssText = 'cursor:default;height:24px;white-space:nowrap;';
      chip.textContent = label;
      wrap.appendChild(chip);
    }
    return wrap;
  };

  /** Departments column: one static chip per department the consultant covers. */
  private userDepartmentsCellRenderer = (params: ICellRendererParams<User>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'pf-ua-depts';
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:100%;padding:6px 0;';
    for (const label of this.userDepartments(params.data?.id)) {
      const chip = document.createElement('span');
      chip.className = 'nd-chip nd-chip--static pf-ua-dept';
      chip.style.cssText = 'cursor:default;height:24px;white-space:nowrap;';
      chip.textContent = label;
      wrap.appendChild(chip);
    }
    return wrap;
  };

  private userStatusCellRenderer = (params: ICellRendererParams<User>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;';
    if (!params.data) return wrap;

    const u = params.data;
    // Kit switch (.nd-toggle[role=switch]) — ON = brand violet, never green.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nd-toggle pf-ua-status';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(!!u.isActive));
    btn.setAttribute('aria-label', `${u.isActive ? 'Active' : 'Inactive'} — ${u.isActive ? 'deactivate' : 'reactivate'} ${u.displayName || u.username || 'user'}`);
    btn.title = u.isActive ? 'Active' : 'Inactive';
    btn.innerHTML = '<span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ctx = params.context as { toggleActive?: (u: User) => void };
      ctx?.toggleActive?.(u);
    });
    wrap.appendChild(btn);
    return wrap;
  };

  private userActionsCellRenderer = (params: ICellRendererParams<User>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;gap:8px;justify-content:flex-end;width:100%;';
    if (!params.data) return wrap;

    const u = params.data;
    const ctx = params.context as {
      canCall?: (u: User) => boolean;
      isOnline?: (authId: string) => boolean;
      callUser?: (u: User) => void;
      editUser?: (u: User) => void;
      resetPassword?: (u: User) => void;
    };

    const web = (params.context as { web?: () => boolean })?.web?.() ?? true;
    if (u.isActive && ctx?.canCall?.(u) && u.authId) {
      const online = ctx?.isOnline?.(u.authId);
      const callBtn = rowAction(web, 'Call', ICON_CALL,
        online ? `Voice call ${u.displayName}` : `${u.displayName} is offline`);
      callBtn.disabled = !online;
      callBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx.callUser?.(u); });
      wrap.appendChild(callBtn);
    }

    const editBtn = rowAction(web, 'Edit', ICON_EDIT, `Edit ${u.displayName || u.username || 'user'}`);
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx?.editUser?.(u); });
    wrap.appendChild(editBtn);

    const pwdBtn = rowAction(web, 'Reset password', ICON_KEY, `Reset password for ${u.displayName || u.username || 'user'}`);
    pwdBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx?.resetPassword?.(u); });
    wrap.appendChild(pwdBtn);

    return wrap;
  };

  private roleTypeCellRenderer = (params: ICellRendererParams<Role>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;';
    if (!params.data) return wrap;

    const r = params.data;
    // Neutral static chip; the small violet dot marks a pre-seeded role. No green.
    const badge = document.createElement('span');
    badge.className = 'nd-chip nd-chip--static pf-ua-type';
    badge.style.cssText = 'cursor:default;height:26px;';
    if (r.isPreSeeded) {
      badge.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:var(--color-violet-600, #7c3aed);display:inline-block;flex-shrink:0;" aria-hidden="true"></span>Pre-seeded';
    } else {
      badge.textContent = 'Custom';
    }
    wrap.appendChild(badge);
    return wrap;
  };

  private roleScopeCellRenderer = (params: ICellRendererParams<Role>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;font-size:13px;color:var(--text-secondary);font-weight:500;';
    if (!params.data) return wrap;

    const scope = params.data.scope;
    const label = scope ? scope.charAt(0).toUpperCase() + scope.slice(1) : 'Tenant';
    wrap.textContent = label;
    return wrap;
  };

  private roleActionsCellRenderer = (params: ICellRendererParams<Role>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;justify-content:flex-end;width:100%;';
    if (!params.data) return wrap;

    const r = params.data;
    const web = (params.context as { web?: () => boolean })?.web?.() ?? true;
    const btn = rowAction(web, 'Manage permissions', ICON_SHIELD, `Manage permissions for ${r.name}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ctx = params.context as { openRole?: (r: Role) => void };
      ctx?.openRole?.(r);
    });
    wrap.appendChild(btn);

    if (isDeletableRole(r)) {
      // ND danger row action: same kit button, red text (no filled red).
      const del = rowAction(web, 'Delete', ICON_TRASH, `Delete ${r.name}`);
      del.classList.add('pf-ua-del');
      del.style.color = 'var(--red-text, #dc2626)';
      del.style.marginLeft = '8px';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const ctx = params.context as { deleteRole?: (r: Role) => void };
        ctx?.deleteRole?.(r);
      });
      wrap.appendChild(del);
    }
    return wrap;
  };

  readonly userColDefs = computed<ColDef<User>[]>(() => { const web = this.web();
    // Re-render the Departments column once the pools / names land.
    this._depts(); this._deptNames();
    return [
    {
      headerName: 'User',
      colId: 'displayName',
      field: 'displayName',
      cellRenderer: this.userCellRenderer,
      flex: 1.2,
      minWidth: 220,
      sortable: true,
      filter: true,
    },
    {
      headerName: 'Username / Email',
      colId: 'username',
      valueGetter: p => p.data?.username || p.data?.email || 'no login',
      flex: 1,
      minWidth: 180,
      sortable: true,
      filter: true,
    },
    {
      headerName: 'Branches',
      colId: 'branches',
      valueGetter: p => branchScopeChips((p.data as { branchScope?: UserBranchScope } | undefined)?.branchScope).join(', '),
      cellRenderer: this.userBranchesCellRenderer,
      flex: 1.2,
      minWidth: 200,
      autoHeight: true,
      sortable: true,
      filter: true,
    },
    {
      // Consultants' departments (validator pools). Empty = every department.
      headerName: 'Departments',
      colId: 'departments',
      valueGetter: p => this.userDepartments(p.data?.id).join(', '),
      cellRenderer: this.userDepartmentsCellRenderer,
      flex: 1,
      minWidth: 180,
      autoHeight: true,
      sortable: true,
      filter: true,
    },
    {
      headerName: 'Phone',
      colId: 'phone',
      valueGetter: p => p.data?.phone || 'no phone',
      width: 150,
      sortable: true,
      filter: true,
    },
    {
      headerName: 'Status',
      colId: 'status',
      field: 'isActive',
      cellRenderer: this.userStatusCellRenderer,
      width: 100,
      sortable: true,
      filter: false,
    },
    {
      headerName: '',
      colId: 'actions',
      cellRenderer: this.userActionsCellRenderer,
      minWidth: web ? 300 : 170,
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
    },
  ]; });

  readonly roleColDefs = computed<ColDef<Role>[]>(() => { const web = this.web(); return [
    {
      headerName: 'Role Name',
      colId: 'name',
      field: 'name',
      flex: 1,
      minWidth: 200,
      sortable: true,
      filter: true,
    },
    {
      headerName: 'Who this is',
      colId: 'who',
      valueGetter: p => ROLE_INFO[p.data?.name ?? ''] ?? 'Custom role — open it to see exactly what it grants.',
      flex: 2,
      minWidth: 320,
      wrapText: true,
      autoHeight: true,
      sortable: false,
      filter: false,
      cellStyle: { lineHeight: '1.5', fontSize: '12.5px', color: 'var(--text-tertiary)', paddingTop: '8px', paddingBottom: '8px' },
    },
    {
      headerName: 'Type',
      colId: 'isPreSeeded',
      field: 'isPreSeeded',
      cellRenderer: this.roleTypeCellRenderer,
      width: 150,
      sortable: true,
      filter: true,
    },
    {
      headerName: 'Scope',
      colId: 'scope',
      field: 'scope',
      cellRenderer: this.roleScopeCellRenderer,
      width: 150,
      sortable: true,
      filter: true,
    },
    {
      headerName: '',
      colId: 'actions',
      cellRenderer: this.roleActionsCellRenderer,
      width: web ? 300 : 120,
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
    },
  ]; });

  readonly gridContext = {
    web: () => this.web(),
    canCall: (u: User) => this.canCall(u),
    isOnline: (authId: string) => this.isOnline(authId),
    callUser: (u: User) => this.callUser(u),
    editUser: (u: User) => this.editUser(u),
    resetPassword: (u: User) => this.resetPassword(u),
    deactivate: (u: User) => this.deactivate(u),
    reactivate: (u: User) => this.reactivate(u),
    toggleActive: (u: User) => this.toggleUserActive(u),
    openRole: (r: Role) => this.openRole(r),
    deleteRole: (r: Role) => this.deleteRole(r),
  };

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['tab'] === 'roles' || params['tab'] === 'users') {
        this._tab.set(params['tab']);
      }
    });

    this.api.get<User[]>('/api/users/').subscribe({ next: l => {
      this._users.set(l ?? []);
      this.presence.seedFromUsers(l ?? []);
    } });
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
    this.api.get<UserBranchScope[]>('/api/users/branch-scopes').subscribe({
      next: l => this._scopes.set(new Map((l ?? []).map(s => [s.userId, s]))),
      error: () => { /* older server: the column stays empty */ },
    });
    this.api.get<UserDepartmentsRow[]>('/api/users/departments').subscribe({
      next: l => this._depts.set(new Map((l ?? []).map(r => [r.userId, r]))),
      error: () => { /* older server: the column stays empty */ },
    });
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => this._deptNames.set(new Map((l ?? []).map(d => [d.id, d.name]))),
      error: () => {},
    });
  }

  setTab(t: Tab) {
    this._tab.set(t);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: t },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }
  onSearch(v: string) { this._search.set(v); }

  openInvite() { this.router.navigateByUrl('/admin/users/invite'); }
  openNewRole() { this.router.navigateByUrl('/admin/roles/new'); }
  openRole(r: Role) { this.router.navigate(['/admin/roles', r.id, 'edit']); }
  editUser(u: User) { this.router.navigate(['/admin/users', u.id, 'edit']); }

  /** Delete a custom role (DialogService confirm, danger tone). The server
   *  refuses a role that is still assigned (409, with the user count) rather
   *  than silently stripping access — its message is shown as-is. */
  async deleteRole(r: Role) {
    if (!isDeletableRole(r)) return;
    const ok = await this.dialog.confirm({
      title: `Delete ${r.name}?`,
      message: 'The role and its permissions are removed for good. A role that is still assigned to someone can\'t be deleted — move those users to another role first.',
      tone: 'danger',
      confirmLabel: 'Delete role',
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.delete(`/api/roles/${r.id}`));
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
      return;
    }
    this._roles.update(list => list.filter(x => x.id !== r.id));
    this.toasts.success(`Role "${r.name}" deleted`);
  }

  toggleUserActive(u: User) {
    if (u.isActive) {
      this.deactivate(u);
    } else {
      this.reactivate(u);
    }
  }

  // Reset / deactivate / reactivate: shared with the Edit-user band.
  async reactivate(u: User) {
    if (await this.accountActions.reactivate(u))
      this._users.update(list => list.map(x => x.id === u.id ? { ...x, isActive: true } : x));
  }

  async resetPassword(u: User) {
    await this.accountActions.resetPassword(u);
  }

  async deactivate(u: User) {
    if (await this.accountActions.deactivate(u))
      this._users.update(list => list.map(x => x.id === u.id ? { ...x, isActive: false } : x));
  }
}
