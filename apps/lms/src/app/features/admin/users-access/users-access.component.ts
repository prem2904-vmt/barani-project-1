import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { Role, User, userDisplayName } from '../../../shared/models/user.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { PresenceService } from '../../../core/services/presence.service';
import { AuthService } from '../../../core/auth/auth.service';

type Tab = 'users' | 'roles';

@Component({
  selector: 'pf-users-access',
  standalone: true,
  imports: [
    FormsModule,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
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

      <div class="mb-5 pf-tabbar">
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
                <div class="flex items-center gap-3 flex-wrap md:flex-nowrap pf-user-row">
                  <pf-avatar [name]="u.displayName" [size]="44"></pf-avatar>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ u.displayName }}</p>
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
                  <div class="pf-row-actions">
                    @if (u.isActive) {
                      @if (canCall(u) && u.authId) {
                        <pf-touch-btn size="sm" variant="ghost"
                                      [disabled]="!isOnline(u.authId)"
                                      [title]="isOnline(u.authId) ? 'Voice call ' + u.displayName : u.displayName + ' is offline'"
                                      (pressed)="callUser(u)">
                          <span icon-left aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
                            </svg>
                          </span>
                          Call
                        </pf-touch-btn>
                      }
                      <pf-touch-btn size="sm" variant="ghost" (pressed)="editUser(u)">Edit</pf-touch-btn>
                      <pf-touch-btn size="sm" variant="ghost" (pressed)="resetPassword(u)">Reset password</pf-touch-btn>
                      <pf-touch-btn size="sm" variant="ghost" (pressed)="deactivate(u)">Deactivate</pf-touch-btn>
                    } @else {
                      <pf-touch-btn size="sm" variant="secondary" (pressed)="reactivate(u)">Reactivate</pf-touch-btn>
                    }
                  </div>
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
              <div class="flex items-center gap-3 flex-wrap md:flex-nowrap pf-role-row">
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
                <div class="pf-row-actions">
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="openRole(r)">Manage permissions</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
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

    /* The action wrapper is transparent to layout by default so desktop/iPad
       rows render byte-identically (buttons stay direct flex children of the
       row via display:contents). Only the phone block below turns it into a
       real flex cluster. */
    .pf-row-actions { display: contents; }

    /* ── Phone (<=640): additive, scoped to this page only ─────────────
       Desktop/iPad layout is left byte-for-byte unchanged. */
    @media (max-width: 640px) {
      /* Search field: 16px min font-size stops iOS focus-zoom. Scoped to
         this page's search input only — the shared .pf-input primitive is
         not touched (raised globally would be a styles.scss change). */
      :host input.pf-input {
        font-size: 16px;
      }
      /* The search input keeps Tailwind's max-w-md on desktop; on phone let
         it span the row so the field stays comfortably tappable/legible. */
      :host input.pf-input.max-w-md {
        max-width: 100%;
      }

      /* User / role rows wrap on phone (Tailwind flex-wrap). When the action
         cluster wraps to its own line, make it span the full width and align
         right so the buttons sit under the text instead of crowding the
         avatar/badge. Buttons share the row and stay >=44px (sz-sm). */
      :host .pf-row-actions {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      /* pf-touch-btn host is inline-block with an internal width:100% button;
         let each chip size to its label and never overflow the row. */
      :host .pf-row-actions pf-touch-btn {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 100%;
      }

      /* The segmented tab bar can be wider than a small phone; let it scroll
         horizontally on its own rather than pushing the page sideways. */
      :host .pf-tabbar {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
    }
  `]
})
export class UsersAccessComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly webrtc = inject(WebrtcService);
  private readonly signaling = inject(SignalingService);
  private readonly presence = inject(PresenceService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly entitlements = inject(TenantEntitlementsService);

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
      // SignalR addresses users by Supabase sub (== UserEntity.AuthId), not
      // the prefrontal UserEntity.Id. SubClaimUserIdProvider on the server
      // registers each connection under its sub claim, so this id matches.
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
      ? this._users().filter(u => userDisplayName(u).toLowerCase().includes(s) || u.email.toLowerCase().includes(s))
      : this._users();
  });

  ngOnInit() {
    this.api.get<User[]>('/api/users/').subscribe({ next: l => {
      this._users.set(l ?? []);
      // The users list carries each user's persisted presenceStatus —
      // seed the presence map so people lists show statuses set before
      // this session's SignalR connection existed.
      this.presence.seedFromUsers(l ?? []);
    } });
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
  }

  setTab(t: Tab) { this._tab.set(t); }
  onSearch(v: string) { this._search.set(v); }

  openInvite() { this.router.navigateByUrl('/admin/users/invite'); }
  openNewRole() { this.router.navigateByUrl('/admin/roles/new'); }
  openRole(r: Role) { this.router.navigate(['/admin/roles', r.id, 'edit']); }
  editUser(u: User) { this.router.navigate(['/admin/users', u.id, 'edit']); }

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
      error: e => this.toasts.error(e?.message ?? 'Could not reactivate user')
    });
  }

  async resetPassword(u: User) {
    const ok = await this.dialog.confirm({
      title: `Reset password for ${u.displayName || u.firstName || 'this user'}?`,
      message: 'A new temporary password is generated and shown once — share it securely. They must change it at next login.',
      confirmLabel: 'Reset password',
    });
    if (!ok) return;
    // Readable temp password that satisfies the 8+ char policy; the user is
    // forced to change it on first login (MustChangePassword set server-side).
    const temp = 'Pf-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
    this.api.post(`/api/users/${u.id}/reset-password`, { newPassword: temp }).subscribe({
      next: () => {
        this.dialog.confirm({
          title: 'Password reset',
          message: `Temporary password for ${u.displayName}:\n\n${temp}\n\nShare it securely — it won't be shown again.`,
          confirmLabel: 'Done',
        });
      },
      error: e => this.toasts.error(e?.error?.message ?? e?.message ?? 'Could not reset password')
    });
  }

  async deactivate(u: User) {
    // Destructive, one-click, no undo path in the UI — confirm first (same
    // pattern as the data-wipe tile).
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
      error: e => this.toasts.error(e?.message ?? 'Could not deactivate user')
    });
  }
}
