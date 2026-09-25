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

ModuleRegistry.registerModules([AllCommunityModule]);

type Tab = 'users' | 'roles';

const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 13,
  rowHeight: 52,
  headerHeight: 40,
  borderRadius: 12,
  accentColor: '#7c3aed',
});

const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'Inter, system-ui, sans-serif',
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
          <span class="text-[12px] font-mono" style="color: var(--text-muted);">
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
      font-size: 12px; font-family: 'JetBrains Mono', ui-monospace, monospace;
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
  private readonly entitlements = inject(TenantEntitlementsService);

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

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

  readonly users = this._users.asReadonly();
  readonly roles = this._roles.asReadonly();
  readonly search = this._search.asReadonly();

  readonly filteredUsers = computed(() => {
    const s = this._search().toLowerCase();
    return s
      ? this._users().filter(u => userDisplayName(u).toLowerCase().includes(s) || (u.username ?? '').toLowerCase().includes(s) || u.email.toLowerCase().includes(s))
      : this._users();
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
    avatar.style.cssText = 'width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg, #7c3aed, #a855f7);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;box-shadow:0 2px 6px rgba(124,58,237,0.25);';
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    avatar.textContent = initials;
    wrap.appendChild(avatar);

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-weight:600;font-size:14px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameSpan.textContent = name;
    wrap.appendChild(nameSpan);

    return wrap;
  };

  private userStatusCellRenderer = (params: ICellRendererParams<User>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;';
    if (!params.data) return wrap;

    const u = params.data;
    const label = document.createElement('label');
    label.style.cssText = 'position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!u.isActive;
    input.style.cssText = 'opacity:0;width:0;height:0;margin:0;';

    const slider = document.createElement('span');
    slider.style.cssText = `position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${u.isActive ? 'var(--nd-toggle-on, #aeb8c2)' : 'var(--nd-toggle-off, #e3e7eb)'};transition:.2s;border-radius:20px;`;

    const dot = document.createElement('span');
    dot.style.cssText = `position:absolute;content:"";height:14px;width:14px;left:${u.isActive ? '18px' : '3px'};bottom:3px;background-color:white;transition:.2s;border-radius:50%;`;

    slider.appendChild(dot);
    label.appendChild(input);
    label.appendChild(slider);

    input.addEventListener('change', (e) => {
      e.stopPropagation();
      const ctx = params.context as { toggleActive?: (u: User) => void };
      ctx?.toggleActive?.(u);
    });

    wrap.appendChild(label);
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

    if (u.isActive && ctx?.canCall?.(u) && u.authId) {
      const online = ctx?.isOnline?.(u.authId);
      const callBtn = document.createElement('button');
      callBtn.type = 'button';
      callBtn.style.cssText = `padding:4px 10px;font-size:12px;font-weight:600;border-radius:6px;border:none;background:transparent;cursor:${online ? 'pointer' : 'not-allowed'};color:${online ? '#7c3aed' : 'var(--text-muted)'};display:inline-flex;align-items:center;gap:4px;`;
      callBtn.disabled = !online;
      callBtn.title = online ? `Voice call ${u.displayName}` : `${u.displayName} is offline`;
      callBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg> Call`;
      callBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx.callUser?.(u); });
      wrap.appendChild(callBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.style.cssText = 'padding:4px 10px;font-size:12px;font-weight:600;border-radius:6px;border:none;background:transparent;cursor:pointer;color:var(--text-secondary);';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx?.editUser?.(u); });
    wrap.appendChild(editBtn);

    const pwdBtn = document.createElement('button');
    pwdBtn.type = 'button';
    pwdBtn.style.cssText = 'padding:4px 10px;font-size:12px;font-weight:600;border-radius:6px;border:none;background:transparent;cursor:pointer;color:var(--text-secondary);';
    pwdBtn.textContent = 'Reset password';
    pwdBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx?.resetPassword?.(u); });
    wrap.appendChild(pwdBtn);

    return wrap;
  };

  private roleTypeCellRenderer = (params: ICellRendererParams<Role>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;height:100%;';
    if (!params.data) return wrap;

    const r = params.data;
    const badge = document.createElement('span');
    if (r.isPreSeeded) {
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);color:#7c3aed;line-height:1.2;';
      badge.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#7c3aed;display:inline-block;flex-shrink:0;"></span>Pre-seeded';
    } else {
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);color:#059669;line-height:1.2;';
      badge.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;flex-shrink:0;"></span>Custom';
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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'padding:4px 12px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid var(--border-color, #e5e7eb);background:var(--bg-card);cursor:pointer;color:var(--text-primary);';
    btn.textContent = 'Manage permissions';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ctx = params.context as { openRole?: (r: Role) => void };
      ctx?.openRole?.(r);
    });
    wrap.appendChild(btn);
    return wrap;
  };

  readonly userColDefs = computed<ColDef<User>[]>(() => [
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
      minWidth: 280,
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
    },
  ]);

  readonly roleColDefs = computed<ColDef<Role>[]>(() => [
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
      width: 180,
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
    },
  ]);

  readonly gridContext = {
    canCall: (u: User) => this.canCall(u),
    isOnline: (authId: string) => this.isOnline(authId),
    callUser: (u: User) => this.callUser(u),
    editUser: (u: User) => this.editUser(u),
    resetPassword: (u: User) => this.resetPassword(u),
    deactivate: (u: User) => this.deactivate(u),
    reactivate: (u: User) => this.reactivate(u),
    toggleActive: (u: User) => this.toggleUserActive(u),
    openRole: (r: Role) => this.openRole(r),
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

  toggleUserActive(u: User) {
    if (u.isActive) {
      this.deactivate(u);
    } else {
      this.reactivate(u);
    }
  }

  async reactivate(u: User) {
    const ok = await this.dialog.confirm({
      title: `Reactivate ${u.displayName || u.firstName || 'this user'}?`,
      message: 'They regain access immediately with their previous roles.',
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;
    this.api.patch(`/api/users/${u.id}`, { isActive: true }).subscribe({
      next: () => {
        this._users.update(list => list.map(x => x.id === u.id ? { ...x, isActive: true } : x));
        this.toasts.success('User reactivated');
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  async resetPassword(u: User) {
    const ok = await this.dialog.confirm({
      title: `Reset password for ${u.displayName || u.firstName || 'this user'}?`,
      message: 'A new temporary password is generated and shown once — share it securely. They must change it at next login.',
      confirmLabel: 'Reset password',
    });
    if (!ok) return;
    const temp = 'Pf-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
    this.api.post(`/api/users/${u.id}/reset-password`, { newPassword: temp }).subscribe({
      next: () => {
        this.dialog.confirm({
          title: 'Password reset',
          message: `Temporary password for ${u.displayName}:\n\n${temp}\n\nShare it securely — it won't be shown again.`,
          confirmLabel: 'Done',
        });
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  async deactivate(u: User) {
    const ok = await this.dialog.confirm({
      title: `Deactivate ${u.displayName || u.firstName || 'this user'}?`,
      message: 'They lose access immediately. Their history and assignments are kept.',
      tone: 'danger',
      confirmLabel: 'Deactivate',
    });
    if (!ok) return;
    this.api.delete(`/api/users/${u.id}`).subscribe({
      next: () => {
        this._users.update(list => list.map(x => x.id === u.id ? { ...x, isActive: false } : x));
        this.toasts.success('User deactivated');
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
