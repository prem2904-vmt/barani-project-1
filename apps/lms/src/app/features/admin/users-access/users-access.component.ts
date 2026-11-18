import { firstValueFrom } from 'rxjs';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AllCommunityModule,
  ColDef,
  GridApi,
  ICellRendererParams,
  ModuleRegistry,
  RowClickedEvent,
} from 'ag-grid-community';
import { ApiService } from '../../../core/services/api.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { UserAccountActionsService } from './user-account-actions.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { Role, User, userDisplayName } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { NgTemplateOutlet } from '@angular/common';
import { SG_NARROW_MQ, SgStatus, sgBare, sgByStatus, sgGridTheme, sgMedia, sgRowOff, sgStatusOptions } from '../../../shared/settings-grid/settings-grid';
import { UserEditComponent } from './user-edit.component';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { UserInviteComponent } from './user-invite.component';
import { confirmLeaveUnsaved } from '../../../shared/utils/unsaved-changes';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { CallReachService } from '../../../core/services/call-reach.service';
import { PresenceService } from '../../../core/services/presence.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ROLE_INFO } from './permission-catalog';
import { UserBranchScope, branchScopeChips } from './branch-scope';
import { UserDepartmentsRow, departmentNames } from './consultant-departments';
import { Department } from '../../../shared/models/tenant.model';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { prefetch, prefetchWhenIdle } from '../../../shared/utils/prefetch';
import { PageOpenService } from '../../../core/navigation/page-open.service';
import {
  ROLE_EDITOR_PREFETCH_KEY, USER_EDIT_PREFETCH_KEY, USER_INVITE_PREFETCH_KEY,
  loadRoleEditor, loadUserEdit, loadUserInvite,
} from './user-editors.loader';
import { bindTabQuery } from '../../../shared/utils/settings-host';

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

/** Kit row action (PF-PATTERN): a 32px secondary TEXT button on web, a
 *  neutral 44px ICON button on touch (label kept for AT + tooltip). */
function rowAction(web: boolean, label: string, icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  // Test Master's quiet row actions: same-size icons (28px on web, 44px on touch); the label stays for AT + tooltip.
  b.className = 'pf-rowact pf-rowact--icon' + (web ? ' pf-sg-rowact-sm' : '');
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `${icon}<span class="pf-rowact__t">${label}</span>`;
  return b;
}

@Component({
  selector: 'pf-users-access',
  standalone: true,
  imports: [
    FormsModule,
    ScreenHeaderComponent,
    SegmentedComponent,
    NgTemplateOutlet,
    UserEditComponent,
    DataGridComponent,
    UserInviteComponent,
    TouchButtonComponent,
    HeroBandComponent,
    SkeletonTableComponent,
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
          <span class="text-[12px] pf-num" style="color: var(--text-muted);">
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

      <!-- ONE Test Master grid card: Users or Roles. Inside the Settings shell / overview the grid is bare and the
           frame's card head shows #headTools (the Users | Roles switch, status filter, count). -->
      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels pf-ua-panels" [class.pf-sg-panels--single]="!panelOpen()" [class.pf-sg-panels--narrow]="narrow()">
        <!-- The user beside the grid (owner 2026-11-17: "too many clicks"): ONE form in a LEFT panel, sheet on narrow. -->
        @if (panelOpen()) {
          @if (narrow()) { <div class="pf-sheet-backdrop" (click)="requestClosePanel()"></div> }
          <aside class="pf-card pf-sg-side pf-ua-panel" [class.pf-sg-side--sheet]="narrow()" role="dialog" [attr.aria-modal]="narrow() ? 'true' : null"
                 [attr.aria-label]="creating() ? 'Create user' : 'Edit user'" (keydown.escape)="requestClosePanel()">
            @if (narrow()) { <span class="pf-sg-sheet-handle" aria-hidden="true"></span> }
            @if (creating()) {
              <pf-user-invite [panel]="true" (closed)="closePanel()" (saved)="reload()"></pf-user-invite>
            } @else {
              <pf-user-edit [panelId]="panelUserId()" (closed)="closePanel()" (saved)="reload()"></pf-user-edit>
            }
          </aside>
        }
        <section class="pf-card pf-sg-main pf-sg-main--clickable pf-ua-main" [class.pf-sg-main--bare]="bare" [attr.aria-label]="tab() === 'users' ? 'Users' : 'Roles'">
          <header class="pf-card__head pf-sg-main__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <span class="pf-card__label">{{ tab() === 'users' ? 'Users' : 'Roles' }}</span>
            <span class="pf-card__spacer"></span>
            <ng-container *ngTemplateOutlet="headToolsTpl"></ng-container>
          </header>
          <div class="pf-sg-main__body pf-ua-grid">
            @if (tab() === 'users') {
              <pf-data-grid [rowData]="gridUsers()" [columnDefs]="userColDefs()" [context]="gridContext" [getRowClass]="userRowClass"
                            [loading]="listSkeleton()" loadingLabel="Loading users…" [clickable]="true"
                            [emptyTitle]="search() ? 'No users match.' : 'No users yet.'" (rowClicked)="onUserRow($event)"></pf-data-grid>
            } @else {
              <pf-data-grid [rowData]="filteredRoles()" [columnDefs]="roleColDefs()" [context]="gridContext"
                            [loading]="listSkeleton()" loadingLabel="Loading roles…" [clickable]="true"
                            [emptyTitle]="search() ? 'No roles match.' : 'No roles yet.'" (rowClicked)="onRoleRow($event)"></pf-data-grid>
            }
          </div>
        </section>
        </div>
      </div>

      <!-- Head tools, left → right: count · dynamic filters · the STATIC view switch at the far right (owner). -->
      <ng-template #headToolsTpl>
        <span class="pf-sg-count pf-num pf-ua-count">
          @if (tab() === 'users') {
            {{ gridUsers().length }} user{{ gridUsers().length === 1 ? '' : 's' }}
          } @else {
            {{ filteredRoles().length }} role{{ filteredRoles().length === 1 ? '' : 's' }}
          }
        </span>
        @if (tab() === 'users') {
          <pf-segmented class="pf-sg-status-filter" size="sm" [options]="statusOptions()" [value]="status()" (valueChange)="status.set($event)" aria-label="Filter by status"></pf-segmented>
        }
        @if (!bare) {
          <!-- Hosted: the frame's head already carries the Users | Roles pill (the setting's categories). -->
          <pf-segmented class="pf-ua-tabseg" size="sm" [options]="tabOptions" [value]="tab()" (valueChange)="setTab($event)" aria-label="Users or roles"></pf-segmented>
        }
            <!-- The page's action, IN the pane (owner: no band buttons in Settings), after the head tools. -->
            @if (tab() === 'users') {
              <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press" (click)="openInvite()"
                      (pointerenter)="warmInvite()" (focus)="warmInvite()"
                      title="Create user" aria-label="Create user">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 5v14"/><path d="M5 12h14"/>
                </svg>
                Create user
              </button>
            } @else {
              <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press" (click)="openNewRole()"
                      (pointerenter)="warmRoleEditor()" (focus)="warmRoleEditor()"
                      title="Create role" aria-label="Create role">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 5v14"/><path d="M5 12h14"/>
                </svg>
                Create role
              </button>
            }
    </ng-template>
    </section>
  `,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  styles: [`
    /* The grid fills the card body (flex, never a % height — a host without a definite height left it at 0). */
    .pf-ua-tabseg { flex-shrink: 0; }
    /* The person / create panel is the standard side card (--pf-side-w, owner 2026-11-18): the row is bounded to the card
       body so the panel's own body scrolls — never the panels box (that slid the grid out of view, a blank column). */
    .pf-ua-panels { grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); flex: 1 1 auto; min-height: 0; }
    .pf-ua-panels:not(.pf-sg-panels--narrow) { grid-template-rows: minmax(0, 1fr); overflow: hidden; }
    .pf-ua-panels.pf-sg-panels--single, .pf-ua-panels.pf-sg-panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-ua-panel:not(.pf-sg-side--sheet) { overflow: hidden; min-height: 0; max-height: 100%; display: flex; flex-direction: column; }
    .pf-ua-panel.pf-sg-side--sheet { overflow: hidden; }
    .pf-ua-panel > pf-user-invite, .pf-ua-panel > pf-user-edit { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
    :root:not(.design-new) .pf-ua-main { height: calc(100vh - 240px); min-height: 420px; }
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
  private readonly reach = inject(CallReachService);
  private readonly presence = inject(PresenceService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly accountActions = inject(UserAccountActionsService);
  private readonly entitlements = inject(TenantEntitlementsService);

  readonly gridTheme = sgGridTheme();
  /** In the Settings shell / overview: bare grid; the frame's card head renders headTools. */
  protected readonly bare = sgBare();
  private readonly headToolsTpl = viewChild<TemplateRef<unknown>>('headToolsTpl');
  /** Users | Roles switch + status filter + count, for a host card head. */
  readonly headTools = computed(() => this.headToolsTpl());
  readonly status = signal<SgStatus>('all');
  readonly statusOptions = computed(() => sgStatusOptions(this._users().length, this._users().filter(u => !u.isActive).length));
  readonly gridUsers = computed(() => sgByStatus(this.filteredUsers(), this.status(), u => u.isActive));
  readonly userRowClass = sgRowOff<User>(u => u.isActive);
  /** A row opens its editor (the actions cell keeps its own clicks). */
  onUserRow(e: RowClickedEvent<User>): void {
    if ((e.event?.target as HTMLElement | null)?.closest?.('button, a')) return;
    if (e.data) this.editUser(e.data);
  }
  onRoleRow(e: RowClickedEvent<Role>): void {
    if ((e.event?.target as HTMLElement | null)?.closest?.('button, a')) return;
    if (e.data) this.openRole(e.data);
  }
  /** Row actions: TEXT on web (fine pointer + hover), ICON on touch. */
  readonly web = webPointerSignal();

  /** Returns true if calling this user makes sense: the Messages module is in
   *  the plan (calls are part of it), the user is active, and not yourself. */
  canCall(u: User): boolean {
    return this.entitlements.moduleEnabled('messages') && u.isActive && u.id !== this.auth.user()?.id;
  }

  /** Online presence check (live socket). Informational only — presence
   *  never disables the Call button (offline colleagues ring by push). */
  isOnline(userId: string): boolean {
    return this.signaling.onlineUserIds().has(userId);
  }

  /** Call-button tooltip: "Voice call …" / "Will ring their devices" / … */
  callHint(u: User): string {
    return u.authId ? this.reach.hint(u.authId, u.displayName) : `Voice call ${u.displayName}`;
  }

  async callUser(u: User): Promise<void> {
    if (!this.canCall(u) || !u.authId) return;
    try {
      await this.webrtc.startCall(u.authId, 'admin_internal', u.displayName);
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
      ? this._users().filter(u => (userDisplayName(u) ?? '').toLowerCase().includes(s) || (u.username ?? '').toLowerCase().includes(s) || (u.email ?? '').toLowerCase().includes(s)
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
    const initials = String(name).split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
    avatar.textContent = initials;
    wrap.appendChild(avatar);

    const text = document.createElement('span');
    text.style.cssText = 'display:flex;flex-direction:column;min-width:0;line-height:1.3;';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-weight:600;font-size:13.5px;color:var(--text-primary);overflow-wrap:anywhere;';
    nameSpan.textContent = name;
    text.appendChild(nameSpan);
    const handle = u.username || u.email;
    if (handle) {
      const sub = document.createElement('span');
      sub.style.cssText = 'font-size:11.5px;color:var(--text-tertiary);overflow-wrap:anywhere;';
      sub.textContent = handle;
      text.appendChild(sub);
    }
    wrap.appendChild(text);

    return wrap;
  };

  /** Branches column: "All branches", or one chip per branch / lab. */
  private userBranchesCellRenderer = (params: ICellRendererParams<User & { branchScope?: UserBranchScope }>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'pf-ua-branches';
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:100%;padding:6px 0;';
    for (const label of branchScopeChips(params.data?.branchScope)) {
      const chip = document.createElement('span');
      chip.className = 'pf-chip pf-chip--static pf-ua-branch';
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
      chip.className = 'pf-chip pf-chip--static pf-ua-dept';
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
    // Kit switch (.pf-toggle[role=switch]) — ON = brand violet, never green.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pf-toggle pf-ua-status';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(!!u.isActive));
    btn.setAttribute('aria-label', `${u.isActive ? 'Active' : 'Inactive'} — ${u.isActive ? 'deactivate' : 'reactivate'} ${u.displayName || u.username || 'user'}`);
    btn.title = u.isActive ? 'Active' : 'Inactive';
    btn.innerHTML = '<span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ctx = params.context as { toggleActive?: (u: User, el?: HTMLElement) => void };
      ctx?.toggleActive?.(u, btn);
    });
    wrap.appendChild(btn);
    return wrap;
  };

  private userActionsCellRenderer = (params: ICellRendererParams<User>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;gap:4px;justify-content:flex-end;width:100%;';
    if (!params.data) return wrap;

    const u = params.data;
    const ctx = params.context as {
      canCall?: (u: User) => boolean;
      callHint?: (u: User) => string;
      callUser?: (u: User) => void;
      editUser?: (u: User, el?: HTMLElement) => void;
      resetPassword?: (u: User, el?: HTMLElement) => void;
      warmUserEdit?: () => void;
    };

    const web = (params.context as { web?: () => boolean })?.web?.() ?? true;
    if (u.isActive && ctx?.canCall?.(u) && u.authId) {
      const callBtn = rowAction(web, 'Call', ICON_CALL,
        ctx?.callHint?.(u) ?? `Voice call ${u.displayName}`);
      callBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx.callUser?.(u); });
      wrap.appendChild(callBtn);
    }

    const editBtn = rowAction(web, 'Edit', ICON_EDIT, `Edit ${u.displayName || u.username || 'user'}`);
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx?.editUser?.(u, editBtn); });
    editBtn.addEventListener('pointerenter', () => ctx?.warmUserEdit?.());
    editBtn.addEventListener('focus', () => ctx?.warmUserEdit?.());
    wrap.appendChild(editBtn);

    const pwdBtn = rowAction(web, 'Reset password', ICON_KEY, `Reset password for ${u.displayName || u.username || 'user'}`);
    pwdBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx?.resetPassword?.(u, pwdBtn); });
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
    badge.className = 'pf-chip pf-chip--static pf-ua-type';
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
    const roleCtx = params.context as { openRole?: (r: Role, el?: HTMLElement) => void; warmRoleEditor?: () => void };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      roleCtx?.openRole?.(r, btn);
    });
    btn.addEventListener('pointerenter', () => roleCtx?.warmRoleEditor?.());
    btn.addEventListener('focus', () => roleCtx?.warmRoleEditor?.());
    wrap.appendChild(btn);

    if (isDeletableRole(r)) {
      // ND danger row action: same kit button, red text (no filled red).
      const del = rowAction(web, 'Delete', ICON_TRASH, `Delete ${r.name}`);
      del.classList.add('pf-ua-del');
      del.style.color = 'var(--red-text, #dc2626)';
      del.style.marginLeft = '4px';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const ctx = params.context as { deleteRole?: (r: Role, el?: HTMLElement) => void };
        ctx?.deleteRole?.(r, del);
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
      width: 170, minWidth: 160, flex: 0, wrapText: false, autoHeight: false, cellClass: 'pf-num',
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
      width: web ? 144 : 176, minWidth: web ? 144 : 176, maxWidth: web ? 144 : 176, pinned: 'right',
      cellClass: 'pf-sg-acts-cell',
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
      width: web ? 96 : 120, minWidth: web ? 96 : 120, maxWidth: web ? 96 : 120, pinned: 'right',
      cellClass: 'pf-sg-acts-cell',
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
    },
  ]; });

  readonly gridContext = {
    web: () => this.web(),
    canCall: (u: User) => this.canCall(u),
    callHint: (u: User) => this.callHint(u),
    callUser: (u: User) => this.callUser(u),
    editUser: (u: User, el?: HTMLElement) => this.editUser(u, el),
    resetPassword: (u: User, el?: HTMLElement) => this.holdBusy(el, () => this.resetPassword(u)),
    deactivate: (u: User) => this.deactivate(u),
    reactivate: (u: User) => this.reactivate(u),
    toggleActive: (u: User, el?: HTMLElement) => this.holdBusy(el, () => this.toggleUserActive(u)),
    openRole: (r: Role, el?: HTMLElement) => this.openRole(r, el),
    deleteRole: (r: Role, el?: HTMLElement) => this.holdBusy(el, () => this.deleteRole(r)),
    warmUserEdit: () => { void prefetch(USER_EDIT_PREFETCH_KEY, loadUserEdit); },
    warmRoleEditor: () => { void prefetch(ROLE_EDITOR_PREFETCH_KEY, loadRoleEditor); },
  };

  // ── Loading feedback (PF-PATTERN "Loading feedback") ──
  private readonly pageOpen = inject(PageOpenService);
  private readonly destroyRef = inject(DestroyRef);
  /** First load: skeleton rows over the grid until users + roles land. */
  private readonly listHold = createLoadHold(true);
  readonly listSkeleton = this.listHold.active;
  /** A DOM-built row action whose request is running: aria-busy + disabled
   *  the same frame (repeat presses ignored), released when it settles. */
  private async holdBusy(el: HTMLElement | undefined, work: () => Promise<unknown>): Promise<void> {
    if (el?.getAttribute('aria-busy') === 'true') return;
    const btn = el instanceof HTMLButtonElement ? el : null;
    el?.setAttribute('aria-busy', 'true');
    el?.classList.add('pf-is-busy');
    if (btn) btn.disabled = true;
    try { await work(); } finally {
      el?.removeAttribute('aria-busy');
      el?.classList.remove('pf-is-busy');
      if (btn) btn.disabled = false;
    }
  }

  ngOnInit() {
    let firstLoads = 2;
    const landed = () => {
      if (--firstLoads > 0) return;
      this.listHold.done();
      // The grid is on screen: warm the editors' code while the browser is idle.
      const cancels = [
        prefetchWhenIdle(USER_EDIT_PREFETCH_KEY, loadUserEdit),
        prefetchWhenIdle(ROLE_EDITOR_PREFETCH_KEY, loadRoleEditor),
      ];
      this.destroyRef.onDestroy(() => cancels.forEach(c => c()));
    };
    this.destroyRef.onDestroy(() => this.listHold.cancel());
    this.route.queryParams.subscribe(params => {
      if (params['tab'] === 'roles' || params['tab'] === 'users') {
        this._tab.set(params['tab']);
      }
      // /admin/users/:id/edit (and old links) land here with ?edit=<id>: open that user beside the grid.
      const edit = typeof params['edit'] === 'string' ? params['edit'] : null;
      if (edit !== this.panelUserId()) this.panelUserId.set(edit);
    });

    this.api.get<User[]>('/api/users/').subscribe({ next: l => {
      this._users.set(l ?? []);
      this.presence.seedFromUsers(l ?? []);
      landed();
    }, error: () => landed() });
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => { this._roles.set(l ?? []); landed(); }, error: () => landed() });
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

  /** Create user: the form opens beside the grid (owner: fewer clicks); pressing it again closes it. */
  async openInvite() {
    if (this.creating()) { void this.requestClosePanel(); return; }
    if (this.panelOpen() && !(await this.requestClosePanel())) return;
    this.panelUserId.set(null);
    this.creating.set(true);
  }
  openNewRole() { this.router.navigateByUrl('/admin/roles/new'); }
  /** Hover / focus of Create user / Create role: warm that editor's code. */
  warmInvite() { void prefetch(USER_INVITE_PREFETCH_KEY, loadUserInvite); }
  warmRoleEditor() { void prefetch(ROLE_EDITOR_PREFETCH_KEY, loadRoleEditor); }
  /** Row actions are DOM-built: the pressed button turns "held" the same
   *  frame, until the editor's navigation settles. */
  openRole(r: Role, el?: HTMLElement) {
    this.pageOpen.markSource(el);
    this.router.navigate(['/admin/roles', r.id, 'edit']);
  }
  /** Edit opens the user beside the grid (no page change); `?edit=<id>` deep-links it. */
  async editUser(u: User, _el?: HTMLElement) {
    if (this.panelOpen() && this.panelUserId() !== u.id && !(await this.requestClosePanel())) return;
    this.creating.set(false);
    this.panelUserId.set(u.id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { edit: u.id }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  readonly panelUserId = signal<string | null>(null);
  /** Create user opens the same panel (one form, no page change). */
  readonly creating = signal(false);
  readonly panelOpen = computed(() => this.creating() || !!this.panelUserId());
  readonly narrow = sgMedia(SG_NARROW_MQ);
  /** The open panel's form (edit or create) — its unsaved changes are asked about before it closes. */
  private readonly editPanel = viewChild(UserEditComponent);
  private readonly invitePanel = viewChild(UserInviteComponent);
  hasUnsavedChanges(): boolean { return !!(this.editPanel()?.hasUnsavedChanges() || this.invitePanel()?.hasUnsavedChanges()); }
  saveChanges(): Promise<boolean> { return this.editPanel()?.hasUnsavedChanges() ? this.editPanel()!.saveChanges() : Promise.resolve(false); }
  readonly unsavedLabel = 'this user';
  /** Backdrop / Escape / switching rows: ask first when the open form has unsaved changes. */
  async requestClosePanel(): Promise<boolean> {
    const open = this.editPanel() ?? this.invitePanel();
    if (open && !(await confirmLeaveUnsaved(this.dialog, open))) return false;
    this.closePanel();
    return true;
  }
  closePanel() {
    this.panelUserId.set(null);
    this.creating.set(false);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { edit: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  /** After a save in the panel: the grid shows the new name / roles / status. */
  reload() {
    this.api.get<User[]>('/api/users/').subscribe({ next: l => this._users.set(l ?? []) });
    this.api.get<UserBranchScope[]>('/api/users/branch-scopes').subscribe({ next: l => this._scopes.set(new Map((l ?? []).map(x => [x.userId, x] as const))) });
  }

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

  toggleUserActive(u: User): Promise<void> {
    if (u.isActive) {
      return this.deactivate(u);
    } else {
      return this.reactivate(u);
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
