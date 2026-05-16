import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
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
                  @if (u.isActive) {
                    @if (canCall(u)) {
                      <pf-touch-btn size="sm" variant="ghost"
                                    [disabled]="!isOnline(u.id)"
                                    [title]="isOnline(u.id) ? 'Voice call ' + u.displayName : u.displayName + ' is offline'"
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
  private readonly router = inject(Router);
  private readonly webrtc = inject(WebrtcService);
  private readonly signaling = inject(SignalingService);
  private readonly auth = inject(AuthService);

  /** Returns true if calling this user makes sense (active, not self). */
  canCall(u: User): boolean {
    return u.isActive && u.id !== this.auth.user()?.id;
  }

  /** Online presence check — used to disable the Call button when offline. */
  isOnline(userId: string): boolean {
    return this.signaling.onlineUserIds().has(userId);
  }

  async callUser(u: User): Promise<void> {
    if (!this.canCall(u)) return;
    if (!this.isOnline(u.id)) {
      this.toasts.info(`${u.displayName} is offline.`);
      return;
    }
    try {
      await this.webrtc.startCall(u.id, 'admin_internal');
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
    this.api.get<User[]>('/api/users/').subscribe({ next: l => this._users.set(l ?? []) });
    this.api.get<Role[]>('/api/roles/').subscribe({ next: l => this._roles.set(l ?? []) });
  }

  setTab(t: Tab) { this._tab.set(t); }
  onSearch(v: string) { this._search.set(v); }

  openInvite() { this.router.navigateByUrl('/admin/users/invite'); }
  openNewRole() { this.router.navigateByUrl('/admin/roles/new'); }
  openRole(r: Role) { this.router.navigate(['/admin/roles', r.id, 'edit']); }

  deactivate(u: User) {
    this.api.delete(`/api/users/${u.id}`).subscribe({
      next: () => {
        this._users.update(list => list.map(x => x.id === u.id ? { ...x, isActive: false } : x));
        this.toasts.success('User deactivated');
      }
    });
  }
}
