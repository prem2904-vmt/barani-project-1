import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Permission, Role } from '../../../shared/models/user.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

@Component({
  selector: 'pf-role-editor',
  standalone: true,
  imports: [
    FormsModule,
    ChipComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Roles"
        [title]="heading()"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      @if (!editing()?.id) {
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <label class="pf-label">Role name <span style="color: var(--danger, #ef4444); font-weight:700;">*</span></label>
          <input type="text" class="pf-input" [class.pf-input-error]="!!nameError()"
                 [ngModel]="newRoleName()" (ngModelChange)="onNameChange($event)"
                 placeholder="e.g. Billing Supervisor" />
          @if (nameError()) { <p class="text-[12px] mt-1" style="color: var(--danger, #ef4444);">{{ nameError() }}</p> }
        </pf-tile>
      } @else if (editing()?.isPreSeeded) {
        <pf-tile tone="violet" padding="md" class="block mb-4">
          <div class="flex items-center gap-2 flex-wrap">
            <pf-chip tone="violet" size="sm">Pre-seeded</pf-chip>
            <p class="text-[13px]" style="color: var(--text-secondary);">
              System role — the name is locked. Editing the permissions saves a copy for your organization only; other organizations are unaffected.
            </p>
          </div>
        </pf-tile>
      }

      <pf-tile tone="default" padding="lg" class="block">
        <h3 class="section-title">Permissions</h3>
        <p class="text-[12px] mt-1 mb-4" style="color: var(--text-tertiary);">
          {{ grantedCount() }} of {{ permissions().length }} granted
        </p>

        <div class="space-y-5">
          @for (group of permissionGroups(); track group.module) {
            <div>
              <h4 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
                  style="color: var(--text-muted);">{{ group.module }}</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                @for (p of group.items; track p.id) {
                  <label class="perm-row">
                    <input type="checkbox"
                           [checked]="isGranted(p.id)"
                           (change)="toggle(p.id, $event)" />
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
      </pf-tile>
    </section>
  `,
  styles: [`
    .pf-input-error { border-color: var(--danger, #ef4444) !important; }
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      margin: 0;
    }
    .perm-row {
      display: inline-flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 13px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .perm-row:hover:not(.locked) {
      border-color: rgba(168, 85, 247, 0.35);
      background: rgba(168, 85, 247, 0.05);
    }
    .perm-row.locked { cursor: not-allowed; opacity: 0.6; }
    .perm-row input[type="checkbox"] { margin-top: 2px; }

    /* ----- Cross-platform overrides (additive only; desktop >=1280 untouched) ----- */

    /* Touch devices: enlarge permission rows + checkboxes to >=44px tap targets */
    @media (pointer: coarse) {
      :host .perm-row {
        min-height: 44px;
        align-items: center;
        padding: 12px 14px;
      }
      :host .perm-row input[type="checkbox"] {
        width: 20px;
        height: 20px;
        margin-top: 0;
        flex: 0 0 auto;
      }
    }

    /* Touch / no-hover: kill sticky hover highlight from base rule */
    @media (hover: none) {
      :host .perm-row:hover:not(.locked) {
        border-color: var(--glass-border);
        background: var(--glass-bg);
      }
    }

    /* Phone (<=640): rows span full width; long permission codes must
       truncate/wrap instead of pushing the row (and page) wider */
    @media (max-width: 640px) {
      :host .perm-row {
        display: flex;
        width: 100%;
        min-width: 0;
      }
      :host .perm-row > span {
        min-width: 0;
        flex: 1 1 auto;
      }
      :host .perm-row > span > .font-mono {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    /* Web-below-desktop band (641-1279, incl. iPad + narrow browser):
       the 2-col permission grid uses inline-flex rows whose default
       min-width:auto lets a long mono permission code overflow its grid
       track and push horizontal page scroll. Fill the track and let the
       code truncate so the grid stays aligned with no page scroll. */
    @media (min-width: 641px) and (max-width: 1279px) {
      :host .perm-row {
        display: flex;
        width: 100%;
        min-width: 0;
      }
      :host .perm-row > span {
        min-width: 0;
        flex: 1 1 auto;
      }
      :host .perm-row > span > .font-mono {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  `]
})
export class RoleEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _editing = signal<Role | null>(null);
  private readonly _permissions = signal<Permission[]>([]);
  private readonly _grantedIds = signal<Set<string>>(new Set());
  private readonly _saving = signal(false);
  private readonly _allRoles = signal<Role[]>([]);
  private readonly _nameError = signal<string | null>(null);

  readonly newRoleName = signal('');
  readonly nameError = this._nameError.asReadonly();
  readonly editing = this._editing.asReadonly();
  readonly permissions = this._permissions.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly heading = computed(() => {
    const r = this._editing();
    if (!r) return 'Create role';
    return `Permissions — ${r.name}`;
  });
  readonly subtitle = computed(() => {
    const r = this._editing();
    if (!r) return 'Pick a name and toggle the permissions this role should grant.';
    return 'Toggle the capabilities for this role. Changes take effect immediately on save.';
  });

  readonly permissionGroups = computed(() => {
    const groups = new Map<string, Permission[]>();
    for (const p of this._permissions()) {
      if (!groups.has(p.module)) groups.set(p.module, []);
      groups.get(p.module)!.push(p);
    }
    return Array.from(groups.entries()).map(([module, items]) => ({ module, items }));
  });

  readonly grantedCount = computed(() => this._grantedIds().size);

  ngOnInit() {
    const backHandler = () => {
      this.back();
      return true;
    };
    this.navBack.registerBackInterceptor(backHandler);
    this.destroyRef.onDestroy(() => {
      this.navBack.clearBackInterceptor(backHandler);
    });

    this.api.get<Permission[]>('/api/permissions').subscribe({
      next: l => this._permissions.set(l ?? [])
    });

    const id = this.route.snapshot.paramMap.get('id');
    // Load the full roles list always — for edit it identifies the role, and for
    // create it lets us reject a duplicate name before hitting the server.
    this.api.get<Role[]>('/api/roles/').subscribe({
      next: roles => {
        this._allRoles.set(roles ?? []);
        if (id) this._editing.set((roles ?? []).find(x => x.id === id) ?? null);
      }
    });
    if (id) {
      this.api.get<string[]>(`/api/roles/${id}/permissions`).subscribe({
        next: ids => this._grantedIds.set(new Set(ids ?? []))
      });
    }
  }

  onNameChange(v: string) { this.newRoleName.set(v); if (this._nameError()) this._nameError.set(null); }

  isGranted(pid: string) { return this._grantedIds().has(pid); }
  toggle(pid: string, ev: Event) {
    const checked = (ev.target as HTMLInputElement).checked;
    const next = new Set(this._grantedIds());
    if (checked) next.add(pid); else next.delete(pid);
    this._grantedIds.set(next);
  }

  back() { this.router.navigate(['/admin/users'], { queryParams: { tab: 'roles' } }); }

  save() {
    const editing = this._editing();
    const ids = Array.from(this._grantedIds());
    this._saving.set(true);
    if (editing?.id) {
      this.api.patch(`/api/roles/${editing.id}/permissions`, { permissionIds: ids }).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Permissions updated'); this.back(); },
        error: e => {
          this._saving.set(false);
          const err = ApiError.from(e);
          if (err.field === 'name' || err.code === 'name_exists') this._nameError.set(err.message);
          else this.toasts.error(err.message);
        }
      });
    } else {
      const name = this.newRoleName().trim();
      if (!name) { this._saving.set(false); this._nameError.set('Role name is required.'); return; }
      // Reject a duplicate name up front (case-insensitive) against tenant + shared
      // roles — the backend enforces it too, but this is immediate feedback.
      if (this._allRoles().some(r => r.name.trim().toLowerCase() === name.toLowerCase())) {
        this._saving.set(false); this._nameError.set(`A role named "${name}" already exists.`); return;
      }
      this.api.post<Role>('/api/roles/', { name, scope: 'tenant', permissionIds: ids }).subscribe({
        next: r => { this._saving.set(false); this.toasts.success(`Role ${r.name} created`); this.back(); },
        error: e => {
          this._saving.set(false);
          const err = ApiError.from(e);
          if (err.field === 'name' || err.code === 'name_exists') this._nameError.set(err.message);
          else this.toasts.error(err.message);
        }
      });
    }
  }
}
