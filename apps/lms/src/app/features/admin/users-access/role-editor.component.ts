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
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { PERMISSION_GROUPS, PERMISSION_INFO, ROLE_INFO } from './permission-catalog';

/** A permission joined with its plain-language catalog entry. */
interface PermRow {
  perm: Permission;
  title: string;
  what: string;
  sensitive: boolean;
}
interface PermGroupView {
  key: string;
  label: string;
  blurb: string;
  items: PermRow[];
  granted: number;
}

/**
 * Role editor — plain-language RBAC (owner's 2026-09-20 brief).
 *
 * Design rules (industry RBAC-UX practice, adapted to a lab):
 *  - every permission reads as WHAT THE USER CAN DO, one sentence, no codes
 *    up front (the code stays as small print for support conversations);
 *  - permissions group by the lab's own workflow (front desk → collection →
 *    bench → sign-out → reports), not by technical module;
 *  - pre-seeded roles carry a one-breath description of WHO that person is;
 *  - high-impact grants (money overrides, config, two-person-rule bypass)
 *    are visibly flagged;
 *  - a live "this role can…" summary keeps the big picture while toggling.
 */
@Component({
  selector: 'pf-role-editor',
  standalone: true,
  imports: [
    FormsModule,
    ChipComponent,
    ScreenHeaderComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Roles"
        [title]="heading()"
        parentRoute="/admin/users?tab=roles"
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

          <!-- Role type (OPD build): 'Doctor' reveals the doctor-details
               section in Create User for anyone given this role. -->
          <label class="pf-label" style="margin-top: 14px;">Role type</label>
          <pf-select [options]="roleTypeOptions" [value]="roleType()"
                     (valueChange)="roleType.set($any($event))"></pf-select>
          <p class="text-[12px] mt-1" style="color: var(--text-muted);">
            Choose “Doctor” for a clinician role — users given it will capture registration &amp; specialisation.
          </p>

          <!-- Start from a known role: the fastest way to a correct custom
               role is copying the closest real one, then trimming. -->
          @if (templateRoles().length > 0) {
            <label class="pf-label" style="margin-top: 18px;">Start from an existing role <span class="re-optional">optional</span></label>
            <div class="re-templates">
              @for (r of templateRoles(); track r.id) {
                <button type="button" class="re-template" (click)="applyTemplate(r)"
                        [class.re-template--on]="templateApplied() === r.id">
                  <span class="re-template__name">{{ r.name }}</span>
                  <span class="re-template__who">{{ roleWho(r.name) }}</span>
                </button>
              }
            </div>
          }
        </pf-tile>
      } @else {
        <!-- WHO this role is — the one-breath answer before any toggles. -->
        <pf-tile [tone]="editing()!.isPreSeeded ? 'violet' : 'default'" padding="md" class="block mb-4">
          <div class="re-who">
            @if (editing()!.isPreSeeded) { <pf-chip tone="violet" size="sm">Pre-seeded</pf-chip> }
            <p class="re-who__text">
              @if (roleWho(editing()!.name); as who) {
                {{ who }}
              } @else {
                A custom role for your organisation — the summary below updates as you toggle.
              }
            </p>
          </div>
          @if (editing()!.isPreSeeded) {
            <p class="re-who__note">
              System role — the name is locked. Editing the permissions saves a copy for your organisation only.
            </p>
          }
        </pf-tile>
      }

      <!-- Live capability summary — the big picture while toggling. -->
      <pf-tile tone="default" padding="md" class="block mb-4">
        <div class="re-sum">
          <span class="re-sum__lbl">This role can work in</span>
          @if (capabilityChips().length === 0) {
            <span class="re-sum__none">nothing yet — grant permissions below</span>
          }
          @for (c of capabilityChips(); track c) {
            <pf-chip tone="violet" size="sm">{{ c }}</pf-chip>
          }
          <span class="re-sum__count">{{ grantedCount() }} of {{ permissions().length }} permissions</span>
        </div>
      </pf-tile>

      <pf-tile tone="default" padding="lg" class="block">
        <div class="re-toolbar">
          <h3 class="section-title">What can this person do?</h3>
          <input type="search" class="pf-input re-search" placeholder="Find a permission — try “discount” or “sign out”"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </div>

        <div class="re-groups">
          @for (group of groupViews(); track group.key) {
            <div class="re-group">
              <div class="re-group__head">
                <div class="re-group__title-wrap">
                  <h4 class="re-group__title">{{ group.label }}</h4>
                  <p class="re-group__blurb">{{ group.blurb }}</p>
                </div>
                <div class="re-group__tools">
                  <span class="re-group__count">{{ group.granted }}/{{ group.items.length }}</span>
                  @if (group.granted < group.items.length) {
                    <button type="button" class="re-group__link" (click)="grantGroup(group, true)">Grant all</button>
                  }
                  @if (group.granted > 0) {
                    <button type="button" class="re-group__link" (click)="grantGroup(group, false)">Clear</button>
                  }
                </div>
              </div>
              <div class="re-perm-grid">
                @for (row of group.items; track row.perm.id) {
                  <label class="re-perm" [class.re-perm--on]="isGranted(row.perm.id)">
                    <input type="checkbox"
                           [checked]="isGranted(row.perm.id)"
                           (change)="toggle(row.perm.id, $event)" />
                    <span class="re-perm__body">
                      <span class="re-perm__title">
                        {{ row.title }}
                        @if (row.sensitive) { <span class="re-perm__flag">high impact</span> }
                      </span>
                      <span class="re-perm__what">{{ row.what }}</span>
                      <span class="re-perm__code">{{ row.perm.code }}</span>
                    </span>
                  </label>
                }
              </div>
            </div>
          }
          @if (groupViews().length === 0) {
            <p class="re-empty">Nothing matches “{{ search() }}”.</p>
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
    .re-optional { font-size: 11px; font-weight: 500; color: var(--text-muted); margin-left: 6px; }

    /* Template picker (create) */
    .re-templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; margin-top: 8px; }
    .re-template { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 10px 12px;
      border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-bg); cursor: pointer;
      transition: border-color .15s, background .15s; }
    .re-template:hover { border-color: rgba(168,85,247,.35); }
    .re-template--on { border-color: rgba(168,85,247,.6); background: rgba(168,85,247,.08); }
    .re-template__name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
    .re-template__who { font-size: 11.5px; line-height: 1.45; color: var(--text-tertiary); }

    /* Who-this-role-is */
    .re-who { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
    .re-who__text { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--text-secondary); flex: 1 1 260px; }
    .re-who__note { margin: 8px 0 0; font-size: 11.5px; color: var(--text-muted); }

    /* Capability summary */
    .re-sum { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .re-sum__lbl { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
    .re-sum__none { font-size: 12.5px; color: var(--text-muted); font-style: italic; }
    .re-sum__count { margin-left: auto; font-size: 11.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-muted); }

    /* Toolbar */
    .re-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .re-search { max-width: 340px; font-size: 13px; }

    /* Groups */
    .re-groups { display: flex; flex-direction: column; gap: 22px; }
    .re-group__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .re-group__title { margin: 0; font-size: 13px; font-weight: 700; color: var(--text-primary); letter-spacing: .01em; }
    .re-group__blurb { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary); }
    .re-group__tools { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .re-group__count { font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-muted); }
    .re-group__link { border: none; background: none; padding: 0; cursor: pointer;
      font-size: 11.5px; font-weight: 600; color: var(--violet-text, #a78bfa); }
    .re-group__link:hover { text-decoration: underline; }

    /* Permission rows */
    .re-perm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .re-perm {
      display: flex; align-items: flex-start; gap: 10px; min-width: 0;
      padding: 10px 12px; border-radius: 12px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      cursor: pointer; transition: background .15s ease, border-color .15s ease;
    }
    .re-perm:hover { border-color: rgba(168, 85, 247, 0.35); background: rgba(168, 85, 247, 0.05); }
    .re-perm--on { border-color: rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.07); }
    .re-perm input[type="checkbox"] { margin-top: 3px; flex: 0 0 auto; accent-color: #a855f7; }
    .re-perm__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .re-perm__title { font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .re-perm__flag { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
      color: #fbbf24; border: 1px solid rgba(251,191,36,.45); border-radius: 6px; padding: 1px 6px; }
    .re-perm__what { font-size: 12px; line-height: 1.5; color: var(--text-tertiary); }
    .re-perm__code { font-size: 10px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .re-empty { font-size: 13px; color: var(--text-muted); }

    /* ----- Cross-platform (additive; desktop >=1280 untouched) ----- */
    @media (pointer: coarse) {
      :host .re-perm { min-height: 44px; padding: 12px 14px; }
      :host .re-perm input[type="checkbox"] { width: 20px; height: 20px; margin-top: 1px; }
    }
    @media (hover: none) {
      :host .re-perm:hover { border-color: var(--glass-border); background: var(--glass-bg); }
      :host .re-perm--on { border-color: rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.07); }
    }
    @media (max-width: 900px) {
      :host .re-perm-grid { grid-template-columns: 1fr; }
      :host .re-group__head { flex-direction: column; align-items: flex-start; gap: 4px; }
      :host .re-search { max-width: none; width: 100%; }
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
  /** Role type for a new role (OPD build): 'general' | 'doctor'. */
  readonly roleType = signal<'general' | 'doctor'>('general');
  readonly roleTypeOptions: PfSelectOption[] = [
    { value: 'general', label: 'General' },
    { value: 'doctor', label: 'Doctor' },
  ];
  readonly search = signal('');
  readonly templateApplied = signal<string | null>(null);
  readonly nameError = this._nameError.asReadonly();
  readonly editing = this._editing.asReadonly();
  readonly permissions = this._permissions.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly heading = computed(() => {
    const r = this._editing();
    if (!r) return 'Create role';
    return r.name;
  });
  readonly subtitle = computed(() => {
    const r = this._editing();
    if (!r) return 'Name the role, then grant what this person should be able to do.';
    return 'Every permission says what it lets the person do. Changes apply on save.';
  });

  roleWho(name: string): string | null {
    return ROLE_INFO[name] ?? null;
  }

  /** Pre-seeded roles offered as starting points when creating. */
  readonly templateRoles = computed<Role[]>(() =>
    this._allRoles().filter(r => r.isPreSeeded && !!ROLE_INFO[r.name]));

  /** Permissions joined with the plain-language catalog, in workflow order. */
  readonly groupViews = computed<PermGroupView[]>(() => {
    const q = this.search().trim().toLowerCase();
    const byGroup = new Map<string, PermRow[]>();
    for (const perm of this._permissions()) {
      const info = PERMISSION_INFO[perm.code];
      const row: PermRow = {
        perm,
        title: info?.title ?? perm.name,
        what: info?.what ?? (perm.description || 'Added after this screen — see the code below.'),
        sensitive: info?.sensitive === true,
      };
      if (q && !(`${row.title} ${row.what} ${perm.code} ${perm.name}`.toLowerCase().includes(q))) continue;
      const key = info?.group ?? 'other';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(row);
    }
    const granted = this._grantedIds();
    return PERMISSION_GROUPS
      .filter(g => (byGroup.get(g.key)?.length ?? 0) > 0)
      .map(g => ({
        key: g.key, label: g.label, blurb: g.blurb,
        items: byGroup.get(g.key)!,
        granted: byGroup.get(g.key)!.filter(r => granted.has(r.perm.id)).length,
      }));
  });

  /** "This role can work in …" — one chip per workflow area with any grant. */
  private static readonly CHIP_LABELS: Record<string, string> = {
    frontdesk: 'Front desk', orders: 'Orders', billing: 'Billing',
    collection: 'Sample collection', bench: 'Results entry', signout: 'Doctor sign-out',
    reports: 'Reports', inventory: 'Inventory', oversight: 'Oversight',
    setup: 'Configuration', alerts: 'Alerts',
  };
  readonly capabilityChips = computed<string[]>(() => {
    const granted = this._grantedIds();
    const areas = new Set<string>();
    for (const perm of this._permissions()) {
      if (!granted.has(perm.id)) continue;
      areas.add(PERMISSION_INFO[perm.code]?.group ?? 'other');
    }
    return PERMISSION_GROUPS
      .filter(g => areas.has(g.key))
      .map(g => RoleEditorComponent.CHIP_LABELS[g.key] ?? g.label);
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
  grantGroup(group: PermGroupView, on: boolean) {
    const next = new Set(this._grantedIds());
    for (const r of group.items) {
      if (on) next.add(r.perm.id); else next.delete(r.perm.id);
    }
    this._grantedIds.set(next);
  }

  /** Copy a seeded role's grants as the starting point for a new role. */
  applyTemplate(r: Role) {
    this.api.get<string[]>(`/api/roles/${r.id}/permissions`).subscribe({
      next: ids => {
        this._grantedIds.set(new Set(ids ?? []));
        this.templateApplied.set(r.id);
        this.toasts.success(`Copied ${r.name}'s permissions — trim from here`);
      },
      error: () => this.toasts.error('Could not load that role’s permissions.')
    });
  }

  back() { this.navBack.backTo('/admin/users?tab=roles'); }

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
      this.api.post<Role>('/api/roles/', { name, scope: 'tenant', permissionIds: ids, kind: this.roleType() === 'doctor' ? 'doctor' : null }).subscribe({
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
