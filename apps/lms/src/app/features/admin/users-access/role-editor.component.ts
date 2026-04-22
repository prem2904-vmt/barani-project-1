import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
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
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
        @if (!editing()?.isPreSeeded) {
          <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" (pressed)="save()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </pf-touch-btn>
        }
      </pf-screen-header>

      @if (!editing()?.id) {
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <label class="pf-label">Role name</label>
          <input type="text" class="pf-input"
                 [ngModel]="newRoleName()" (ngModelChange)="newRoleName.set($event)"
                 placeholder="e.g. Billing Supervisor" />
        </pf-tile>
      } @else if (editing()?.isPreSeeded) {
        <pf-tile tone="violet" padding="md" class="block mb-4">
          <div class="flex items-center gap-2 flex-wrap">
            <pf-chip tone="violet" size="sm">Pre-seeded</pf-chip>
            <p class="text-[13px]" style="color: var(--text-secondary);">
              Permissions are locked for this role.
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
                  <label class="perm-row" [class.locked]="editing()?.isPreSeeded">
                    <input type="checkbox"
                           [checked]="isGranted(p.id)"
                           [disabled]="editing()?.isPreSeeded ?? false"
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
  `]
})
export class RoleEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _editing = signal<Role | null>(null);
  private readonly _permissions = signal<Permission[]>([]);
  private readonly _grantedIds = signal<Set<string>>(new Set());
  private readonly _saving = signal(false);

  readonly newRoleName = signal('');
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
    return r.isPreSeeded
      ? 'Pre-seeded roles are read-only.'
      : 'Toggle the capabilities for this role. Changes take effect immediately on save.';
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
    this.api.get<Permission[]>('/api/permissions').subscribe({
      next: l => this._permissions.set(l ?? [])
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.api.get<Role[]>('/api/roles/').subscribe({
        next: roles => {
          const r = (roles ?? []).find(x => x.id === id) ?? null;
          this._editing.set(r);
        }
      });
      this.api.get<string[]>(`/api/roles/${id}/permissions`).subscribe({
        next: ids => this._grantedIds.set(new Set(ids ?? []))
      });
    }
  }

  isGranted(pid: string) { return this._grantedIds().has(pid); }
  toggle(pid: string, ev: Event) {
    const checked = (ev.target as HTMLInputElement).checked;
    const next = new Set(this._grantedIds());
    if (checked) next.add(pid); else next.delete(pid);
    this._grantedIds.set(next);
  }

  back() { this.router.navigateByUrl('/admin/users'); }

  save() {
    const editing = this._editing();
    const ids = Array.from(this._grantedIds());
    this._saving.set(true);
    if (editing?.id) {
      this.api.patch(`/api/roles/${editing.id}/permissions`, { permissionIds: ids }).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Permissions updated'); this.back(); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Save failed'); }
      });
    } else {
      const name = this.newRoleName().trim();
      if (!name) { this._saving.set(false); this.toasts.warning('Role name required'); return; }
      this.api.post<Role>('/api/roles/', { name, scope: 'tenant', permissionIds: ids }).subscribe({
        next: r => { this._saving.set(false); this.toasts.success(`Role ${r.name} created`); this.back(); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Save failed'); }
      });
    }
  }
}
