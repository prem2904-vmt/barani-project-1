import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Permission, Role } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { PERMISSION_GROUPS, PERMISSION_INFO, ROLE_INFO } from './permission-catalog';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { USER_FORM_STYLES } from './user-form.styles';

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
    ScreenHeaderComponent,
    TouchButtonComponent,
    HeroBandComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- ND "Editors": band = back · tenant · the ONE primary; the pill is
             the CONTEXT BAR (the role as read-only chips + grant count). -->
        <pf-hero-band [back]="true" [backTo]="'/admin/users?tab=roles'" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-uf-primary press"
                    [disabled]="saving()" (click)="save()"
                    [attr.aria-label]="saving() ? 'Saving' : (editing()?.id ? 'Save' : 'Create role')"
                    [title]="editing()?.id ? 'Save' : 'Create role'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ saving() ? 'Saving…' : (editing()?.id ? 'Save' : 'Create role') }}
            </button>
          </ng-container>
          <div band-search class="nd-ctx pf-uf-ctx">
            <span class="nd-ctx__primary pf-uf-ctx__name">{{ editing()?.name || newRoleName().trim() || 'New role' }}</span>
            <span class="nd-ctx__chip" data-k="Type"><span class="nd-ctx__k">Type</span><span>{{ typeLabel() }}</span></span>
            @if (!editing()?.id) {
              <span class="nd-ctx__chip" data-k="Kind"><span class="nd-ctx__k">Role type</span><span>{{ roleType() === 'doctor' ? 'Doctor' : 'General' }}</span></span>
            }
            <span class="nd-ctx__chip" data-k="Granted"><span class="nd-ctx__k">Granted</span><span class="nd-num">{{ grantedCount() }} / {{ permissions().length }}</span></span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Roles"
        [title]="heading()"
        parentRoute="/admin/users?tab=roles"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
        <div class="pf-uf-body">
          <div class="pf-uf-grid2">
            @if (!editing()?.id) {
              <!-- ROLE (create) -->
              <section class="nd-card pf-uf-card">
                <div class="nd-card__head">
                  <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
                  <h2 class="nd-card__label pf-uf-h">Role</h2>
                  <span class="nd-card__note"><span class="pf-uf-req">*</span> required</span>
                </div>
                <div class="nd-card__body">
                  <label class="nd-field">
                    <span class="nd-field__lbl">Role name <span class="pf-uf-req">*</span></span>
                    <input type="text" class="nd-input pf-re-name" [class.nd-input--error]="!!nameError()"
                           [ngModel]="newRoleName()" (ngModelChange)="onNameChange($event)"
                           placeholder="e.g. Billing Supervisor" />
                    @if (nameError()) { <p class="pf-uf-err">{{ nameError() }}</p> }
                  </label>
                  <!-- Role type (OPD build): 'Doctor' reveals the doctor-details
                       section in Create User for anyone given this role. -->
                  <div class="nd-field">
                    <span class="nd-field__lbl">Role type</span>
                    <span class="nd-seg re-type" role="radiogroup" aria-label="Role type">
                      @for (o of roleTypeOptions; track o.value) {
                        <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="roleType() === o.value"
                                (click)="roleType.set($any(o.value))">{{ o.label }}</button>
                      }
                    </span>
                    <p class="nd-field__hint">Choose “Doctor” for a clinician role — users given it will capture registration &amp; specialisation.</p>
                  </div>
                </div>
              </section>
            } @else {
              <!-- WHO this role is — the one-breath answer before any toggles. -->
              <section class="nd-card pf-uf-card">
                <div class="nd-card__head">
                  <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
                  <h2 class="nd-card__label pf-uf-h">Who this is</h2>
                </div>
                <div class="nd-card__body">
                  <p class="re-who__text">
                    @if (roleWho(editing()!.name); as who) { {{ who }} }
                    @else { A custom role for your organisation — the summary updates as you switch permissions. }
                  </p>
                  @if (editing()!.isPreSeeded) {
                    <p class="nd-field__hint">System role — the name is locked. Editing the permissions saves a copy for your organisation only.</p>
                  }
                </div>
              </section>
            }

            <!-- Live capability summary — the big picture while toggling. -->
            <section class="nd-card pf-uf-card">
              <div class="nd-card__head">
                <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span>
                <h2 class="nd-card__label pf-uf-h">This role can work in</h2>
                <span class="nd-card__spacer"></span>
                <span class="re-sum__count"><span class="nd-num">{{ grantedCount() }}</span> of <span class="nd-num">{{ permissions().length }}</span> permissions</span>
              </div>
              <div class="nd-card__body">
                <div class="re-sum">
                  @if (capabilityChips().length === 0) {
                    <span class="re-sum__none">Nothing yet — switch permissions on below.</span>
                  }
                  @for (c of capabilityChips(); track c) {
                    <span class="nd-chip nd-chip--static re-sum__chip">{{ c }}</span>
                  }
                </div>
                @if (!editing()?.id && templateRoles().length > 0) {
                  <!-- Start from a known role: the fastest way to a correct
                       custom role is copying the closest real one, then trimming. -->
                  <div class="nd-field">
                    <span class="nd-field__lbl">Start from an existing role <span class="re-optional">optional</span></span>
                    <div class="re-templates">
                      @for (r of templateRoles(); track r.id) {
                        <button type="button" class="nd-tile-sel re-template press" (click)="applyTemplate(r)"
                                [attr.aria-pressed]="templateApplied() === r.id">
                          <span class="re-template__name">{{ r.name }}</span>
                          <span class="re-template__who">{{ roleWho(r.name) }}</span>
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </section>
          </div>

          <!-- PERMISSIONS -->
          <section class="nd-card pf-uf-card">
            <div class="nd-card__head">
              <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
              <h2 class="nd-card__label pf-uf-h">What can this person do?</h2>
              <span class="nd-card__spacer"></span>
              <input type="search" class="nd-input re-search" aria-label="Find a permission"
                     placeholder="Find a permission — try “discount” or “sign out”"
                     [ngModel]="search()" (ngModelChange)="search.set($event)" />
            </div>
            <div class="nd-card__body">
              <div class="re-groups">
                @for (group of groupViews(); track group.key) {
                  <div class="re-group">
                    <div class="re-group__head">
                      <div class="re-group__title-wrap">
                        <h3 class="re-group__title">{{ group.label }}</h3>
                        <p class="re-group__blurb">{{ group.blurb }}</p>
                      </div>
                      <div class="re-group__tools">
                        <span class="re-group__count nd-num">{{ group.granted }}/{{ group.items.length }}</span>
                        @if (group.granted < group.items.length) {
                          <button type="button" class="nd-btn nd-btn--tertiary re-group__link" (click)="grantGroup(group, true)">Grant all</button>
                        }
                        @if (group.granted > 0) {
                          <button type="button" class="nd-btn nd-btn--tertiary re-group__link" (click)="grantGroup(group, false)">Clear</button>
                        }
                      </div>
                    </div>
                    <div class="re-perm-grid">
                      @for (row of group.items; track row.perm.id) {
                        <button type="button" class="nd-toggle pf-uf-sw re-perm" role="switch"
                                [attr.aria-checked]="isGranted(row.perm.id)" (click)="setGranted(row.perm.id, !isGranted(row.perm.id))">
                          <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
                          <span class="pf-uf-sw__txt">
                            <span class="pf-uf-sw__name re-perm__title">
                              {{ row.title }}
                              @if (row.sensitive) { <span class="nd-chip nd-chip--static re-perm__flag">High impact</span> }
                            </span>
                            <span class="pf-uf-sw__what">{{ row.what }}</span>
                            <span class="pf-uf-sw__code nd-num">{{ row.perm.code }}</span>
                          </span>
                        </button>
                      }
                    </div>
                  </div>
                }
                @if (groupViews().length === 0) {
                  <p class="re-empty">Nothing matches “{{ search() }}”.</p>
                }
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  `,
  styles: [USER_FORM_STYLES, `
    .re-optional { font-size: 11px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }
    .re-type { align-self: flex-start; }
    .re-type .nd-seg__item { height: 36px; min-width: 88px; font-size: 13px; }

    /* Template picker (create) */
    .re-templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
    .re-template { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 10px 12px;
      border-radius: var(--nd-radius-sm); border: 1px solid var(--nd-line); background: var(--nd-card-bg); cursor: pointer;
      font: inherit; transition: border-color var(--nd-dur-fast) ease, background var(--nd-dur-fast) ease; }
    .re-template:hover { border-color: var(--nd-sel-border); }
    .re-template[aria-pressed='true'] { background: var(--nd-sel-bg); border-color: var(--nd-sel-border); }
    .re-template__name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .re-template__who { font-size: 12px; line-height: 1.45; color: var(--text-tertiary); }

    .re-who__text { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--text-secondary); }

    /* Capability summary */
    .re-sum { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .re-sum__chip { cursor: default; }
    .re-sum__none { font-size: 12.5px; color: var(--text-muted); }
    .re-sum__count { font-size: 12px; color: var(--text-tertiary); }
    .re-sum__count .nd-num { color: var(--text-primary); font-weight: 500; }

    /* Permissions */
    .re-search { flex: 0 1 340px; min-height: 36px; }
    .re-groups { display: flex; flex-direction: column; gap: 22px; }
    .re-group__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .re-group__title { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .re-group__blurb { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .re-group__tools { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .re-group__count { font-size: 12px; color: var(--text-tertiary); }
    .re-group__link { height: 32px; min-height: 32px; font-size: 12.5px; }
    .re-perm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .re-perm__title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .re-perm__flag { height: 22px; padding: 0 8px; font-size: 11px; }
    .re-empty { font-size: 13px; color: var(--text-muted); }

    @media (max-width: 900px) {
      .re-perm-grid { grid-template-columns: 1fr; }
      .re-group__head { flex-direction: column; align-items: flex-start; gap: 4px; }
      .re-search { flex: 1 1 100%; }
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
  protected readonly theme = inject(ThemeService);

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

  /** Context-bar "Type": pre-seeded system role vs this lab's own. */
  readonly typeLabel = computed(() => {
    const r = this._editing();
    if (!r) return 'Custom';
    return r.isPreSeeded ? 'Pre-seeded' : 'Custom';
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
    this.setGranted(pid, (ev.target as HTMLInputElement).checked);
  }
  /** Switch one permission on / off (the slate switch rows). */
  setGranted(pid: string, on: boolean) {
    const next = new Set(this._grantedIds());
    if (on) next.add(pid); else next.delete(pid);
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
