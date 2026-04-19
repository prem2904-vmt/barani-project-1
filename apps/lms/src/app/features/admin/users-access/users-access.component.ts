import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
import { Branch } from '../../../shared/models/tenant.model';
import { Permission, Role, User } from '../../../shared/models/user.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Tab = 'users' | 'roles';

@Component({
  selector: 'pf-users-access',
  standalone: true,
  imports: [
    FormsModule,
    SlideOverComponent,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-6xl mx-auto">
      <pf-screen-header
        eyebrow="Admin"
        title="Users & Access"
        subtitle="Invite users, assign roles, and control permissions across your branches.">
        @if (tab() === 'users') {
          <pf-touch-btn actions size="sm" variant="primary" (pressed)="openInvite()">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
              </svg>
            </span>
            Invite
          </pf-touch-btn>
        } @else {
          <pf-touch-btn actions size="sm" variant="primary" (pressed)="openRole(null)">
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

      <div class="mb-5">
        <pf-segmented
          [options]="tabOptions"
          [value]="tab()"
          size="md"
          (valueChange)="setTab($event)">
        </pf-segmented>
      </div>

      @if (tab() === 'users') {
        <div class="mb-4">
          <input type="text" class="pf-input max-w-md" placeholder="Search name or email…"
                 [ngModel]="search()" (ngModelChange)="onSearch($event)" />
        </div>

        @if (filteredUsers().length === 0) {
          <pf-tile tone="default" padding="xl">
            <div class="text-center py-6">
              <p class="text-[14px]" style="color: var(--text-secondary);">No users found.</p>
            </div>
          </pf-tile>
        } @else {
          <div class="space-y-2.5">
            @for (u of filteredUsers(); track u.id) {
              <pf-tile [tone]="u.isActive ? 'default' : 'default'" padding="md">
                <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                  <pf-avatar [name]="u.name" [size]="44"></pf-avatar>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ u.name }}</p>
                      @if (u.isActive) {
                        <pf-chip tone="emerald" size="sm">Active</pf-chip>
                      } @else {
                        <pf-chip tone="default" size="sm">Inactive</pf-chip>
                      }
                    </div>
                    <p class="text-[12px] mt-0.5 truncate" style="color: var(--text-tertiary);">
                      {{ u.email }} · {{ u.phone || 'no phone' }}
                    </p>
                  </div>
                  @if (u.isActive) {
                    <pf-touch-btn size="sm" variant="ghost" (pressed)="deactivate(u)">Deactivate</pf-touch-btn>
                  }
                </div>
              </pf-tile>
            }
          </div>
        }
      } @else {
        <div class="mb-4 text-[12px] font-mono" style="color: var(--text-muted);">
          {{ roles().length }} roles configured
        </div>

        <div class="space-y-2.5">
          @for (r of roles(); track r.id) {
            <pf-tile [tone]="r.isPreSeeded ? 'violet' : 'default'" padding="md">
              <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                <div class="pf-role-badge" [class.pf-role-seeded]="r.isPreSeeded">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 7h-9"/>
                    <path d="M14 17H5"/>
                    <circle cx="17" cy="17" r="3"/>
                    <circle cx="7" cy="7" r="3"/>
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ r.name }}</p>
                    @if (r.isPreSeeded) {
                      <pf-chip tone="violet" size="sm">Pre-seeded</pf-chip>
                    } @else {
                      <pf-chip tone="emerald" size="sm">Custom</pf-chip>
                    }
                  </div>
                  <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
                    Scope: {{ r.scope }}
                  </p>
                </div>
                <pf-touch-btn size="sm" variant="secondary" (pressed)="openRole(r)">Manage permissions</pf-touch-btn>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>

    <pf-slide-over [open]="inviteOpen()" title="Invite user" (closed)="inviteOpen.set(false)">
      <div class="space-y-3">
        <div><label class="pf-label">Name</label>
          <input type="text" class="pf-input" [ngModel]="invite().name" (ngModelChange)="setInvite({ name: $event })" /></div>
        <div><label class="pf-label">Email</label>
          <input type="email" class="pf-input" [ngModel]="invite().email" (ngModelChange)="setInvite({ email: $event })" /></div>
        <div><label class="pf-label">Phone</label>
          <input type="tel" class="pf-input" [ngModel]="invite().phone" (ngModelChange)="setInvite({ phone: $event })" /></div>
        <div><label class="pf-label">Role</label>
          <pf-select [options]="roleOptions()" [value]="invite().roleId"
                     placeholder="— Select role —"
                     (valueChange)="setInvite({ roleId: $event })"></pf-select>
        </div>
        <div><label class="pf-label">Branch</label>
          <pf-select [options]="branchOptions()" [value]="invite().branchId"
                     placeholder="All branches"
                     (valueChange)="setInvite({ branchId: $event })"></pf-select>
        </div>
      </div>
      <ng-container footer>
        <div class="flex justify-end gap-2 w-full">
          <pf-touch-btn size="sm" variant="ghost" (pressed)="inviteOpen.set(false)">Cancel</pf-touch-btn>
          <pf-touch-btn size="sm" variant="primary" [disabled]="!canInvite()" (pressed)="submitInvite()">Send invite</pf-touch-btn>
        </div>
      </ng-container>
    </pf-slide-over>

    <pf-slide-over [open]="roleOpen()" [title]="roleTitle()" (closed)="roleOpen.set(false)">
      <div class="space-y-4">
        @if (!editingRole()?.id) {
          <div>
            <label class="pf-label">Role name</label>
            <input type="text" class="pf-input" [ngModel]="newRoleName()" (ngModelChange)="newRoleName.set($event)" />
          </div>
        }
        @for (group of permissionGroups(); track group.module) {
          <div>
            <h4 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
                style="color: var(--text-muted);">{{ group.module }}</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              @for (p of group.items; track p.id) {
                <label class="inline-flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox"
                         [checked]="isGranted(p.id)"
                         [disabled]="editingRole()?.isPreSeeded ?? false"
                         (change)="togglePermission(p.id, $event)" />
                  <span>
                    <span class="font-medium" style="color: var(--text-primary);">{{ p.name }}</span>
                    <span class="block text-[11px] font-mono" style="color: var(--text-muted);">{{ p.code }}</span>
                  </span>
                </label>
              }
            </div>
          </div>
        }
      </div>
      <ng-container footer>
        <div class="flex justify-end gap-2 w-full">
          <pf-touch-btn size="sm" variant="ghost" (pressed)="roleOpen.set(false)">Close</pf-touch-btn>
          @if (!editingRole()?.isPreSeeded) {
            <pf-touch-btn size="sm" variant="primary" (pressed)="saveRole()">Save</pf-touch-btn>
          }
        </div>
      </ng-container>
    </pf-slide-over>
  `,
  styles: [`
    .pf-role-badge {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    .pf-role-seeded {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.25), rgba(168, 85, 247, 0.1));
      border-color: rgba(168, 85, 247, 0.35);
      color: #c4b5fd;
    }
  `]
})
export class UsersAccessComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'users', label: 'Users' },
    { value: 'roles', label: 'Roles & Permissions' }
  ];
  private readonly _tab = signal<Tab>('users');
  readonly tab = this._tab.asReadonly();

  private readonly _users = signal<User[]>([]);
  private readonly _roles = signal<Role[]>([]);
  private readonly _permissions = signal<Permission[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  private readonly _search = signal('');

  readonly users = this._users.asReadonly();
  readonly roles = this._roles.asReadonly();
  readonly permissions = this._permissions.asReadonly();
  readonly branches = this._branches.asReadonly();
  readonly search = this._search.asReadonly();

  readonly filteredUsers = computed(() => {
    const s = this._search().toLowerCase();
    return s
      ? this._users().filter(u => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s))
      : this._users();
  });

  readonly roleOptions = computed<PfSelectOption<string>[]>(() =>
    this._roles().map(r => ({ value: r.id, label: r.name }))
  );
  readonly branchOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All branches' },
    ...this._branches().map(b => ({ value: b.id, label: b.name }))
  ]);

  readonly permissionGroups = computed(() => {
    const groups = new Map<string, Permission[]>();
    for (const p of this._permissions()) {
      if (!groups.has(p.module)) groups.set(p.module, []);
      groups.get(p.module)!.push(p);
    }
    return Array.from(groups.entries()).map(([module, items]) => ({ module, items }));
  });

  // Invite slide-over
  protected readonly inviteOpen = signal(false);
  private readonly _invite = signal({ name: '', email: '', phone: '', roleId: '', branchId: '' });
  readonly invite = this._invite.asReadonly();
  readonly canInvite = computed(() => {
    const i = this._invite();
    return i.name.trim().length > 0 && i.email.trim().length > 0 && !!i.roleId;
  });

  // Role slide-over
  protected readonly roleOpen = signal(false);
  private readonly _editingRole = signal<Role | null>(null);
  private readonly _grantedIds = signal<Set<string>>(new Set());
  readonly newRoleName = signal('');
  readonly editingRole = this._editingRole.asReadonly();
  readonly roleTitle = computed(() =>
    this._editingRole()?.id ? `Permissions for ${this._editingRole()?.name}` : 'Create custom role');

  ngOnInit() {
    this.loadUsers();
    this.loadRoles();
    this.loadPermissions();
    this.loadBranches();
  }

  setTab(t: Tab) { this._tab.set(t); }
  onSearch(v: string) { this._search.set(v); }

  private loadUsers() {
    this.api.get<User[]>('/api/users/').subscribe({ next: l => this._users.set(l ?? []) });
  }
  private loadRoles() {
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
  }
  private loadPermissions() {
    this.api.get<Permission[]>('/api/permissions').subscribe({ next: l => this._permissions.set(l ?? []) });
  }
  private loadBranches() {
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({ next: l => this._branches.set(l ?? []) });
  }

  openInvite() {
    this._invite.set({ name: '', email: '', phone: '', roleId: '', branchId: '' });
    this.inviteOpen.set(true);
  }
  setInvite(patch: Partial<{ name: string; email: string; phone: string; roleId: string; branchId: string }>) {
    this._invite.update(v => ({ ...v, ...patch }));
  }
  submitInvite() {
    const i = this._invite();
    this.api.post<User>('/api/users/invite', {
      name: i.name, email: i.email, phone: i.phone || undefined,
      roleIds: [i.roleId], branchId: i.branchId || undefined
    }).subscribe({
      next: u => { this._users.update(list => [u, ...list]); this.toasts.success(`Invited ${u.name}`); this.inviteOpen.set(false); },
      error: e => this.toasts.error(e.message ?? 'Failed to invite')
    });
  }

  deactivate(u: User) {
    this.api.delete(`/api/users/${u.id}`).subscribe({
      next: () => { this._users.update(list => list.map(x => x.id === u.id ? { ...x, isActive: false } : x)); this.toasts.success('User deactivated'); }
    });
  }

  openRole(r: Role | null) {
    this._editingRole.set(r);
    this.newRoleName.set('');
    this._grantedIds.set(new Set());
    if (r) {
      this.api.get<string[]>(`/api/roles/${r.id}/permissions`).subscribe({
        next: ids => this._grantedIds.set(new Set(ids ?? []))
      });
    }
    this.roleOpen.set(true);
  }
  isGranted(pid: string) { return this._grantedIds().has(pid); }
  togglePermission(pid: string, ev: Event) {
    const checked = (ev.target as HTMLInputElement).checked;
    const next = new Set(this._grantedIds());
    if (checked) next.add(pid); else next.delete(pid);
    this._grantedIds.set(next);
  }

  saveRole() {
    const editing = this._editingRole();
    const ids = Array.from(this._grantedIds());
    if (editing?.id) {
      this.api.patch(`/api/roles/${editing.id}/permissions`, { permissionIds: ids }).subscribe({
        next: () => { this.toasts.success('Permissions updated'); this.roleOpen.set(false); }
      });
    } else {
      const name = this.newRoleName().trim();
      if (!name) { this.toasts.warning('Role name required'); return; }
      this.api.post<Role>('/api/roles/', { name, scope: 'tenant', permissionIds: ids }).subscribe({
        next: r => { this._roles.update(l => [...l, r]); this.toasts.success(`Role ${r.name} created`); this.roleOpen.set(false); }
      });
    }
  }
}
