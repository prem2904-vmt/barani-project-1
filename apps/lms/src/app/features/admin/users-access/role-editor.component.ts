import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Permission, Role } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { NgTemplateOutlet } from '@angular/common';
import { AllCommunityModule, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { SG_NARROW_MQ, SG_PHONE_MQ, sgCell, sgGridTheme, sgMedia, sgSwitch } from '../../../shared/settings-grid/settings-grid';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { PERMISSION_GROUPS, PERMISSION_INFO, ROLE_INFO } from './permission-catalog';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';

import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonCardComponent, SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { OpdGateService } from '../../opd/shared/opd-gate.service';
import { CasesheetGateService } from '../../casesheets/shared/casesheet-gate.service';
import { visibleGatedPermissions } from '../../casesheets/shared/gated-permissions';

ModuleRegistry.registerModules([AllCommunityModule]);

/** A permission joined with its plain-language catalog entry. */
interface PermRow {
  perm: Permission;
  title: string;
  what: string;
  sensitive: boolean;
  group: string;
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
    NgTemplateOutlet,
    AgGridAngular,
    SelectComponent,
    ScreenHeaderComponent,
    TouchButtonComponent,
    HeroBandComponent,
    BusyDirective,
    SkeletonFormComponent,
    SkeletonCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Test Master frame: the band pill FINDS a permission across all
             groups; Save is the ONE primary. The role itself rides the slim
             summary card under the band. -->
        <pf-hero-band [back]="true" [backTo]="'/admin/users?tab=roles'"
                      placeholder="Find a permission — try “discount” or “sign out”"
                      [value]="search()" (valueChange)="onSearch($event)">
          <ng-container band-tools>
            @if (narrow()) {
              <button type="button" class="pf-chip pf-sg-chip press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" [attr.aria-pressed]="!!groupKey()" title="Permission groups">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
                {{ selectedGroup()?.label || 'Groups' }}
              </button>
            }
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-uf-primary press"
                    [disabled]="saving() || recordSkeleton()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()"
                    [attr.aria-label]="saving() ? 'Saving' : (editing()?.id ? 'Save' : 'Create role')"
                    [title]="editing()?.id ? 'Save' : 'Create role'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ saving() ? 'Saving…' : (editing()?.id ? 'Save' : 'Create role') }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Roles"
        [title]="heading()"
        parentRoute="/admin/users?tab=roles"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving() || recordSkeleton()" [busy]="saving()" busyLabel="Saving…" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill re-body">
        @if (recordSkeleton()) {
          <!-- Opening the role editor: its own shape until the role + the
               permission catalogue land — never the create form flashing. -->
          <div class="pf-re-loading re-loading">
            <section class="pf-card re-strip"><div class="pf-card__body"><pf-skeleton-form [fields]="2" [cols]="2" label="Loading role…"></pf-skeleton-form></div></section>
            <section class="pf-card re-loading__main"><div class="pf-card__body"><pf-skeleton-card [lines]="8" [boxed]="false" label="Loading permissions…"></pf-skeleton-card></div></section>
          </div>
        } @else {
          <!-- SUMMARY strip: the role (name + type), who it is in one line,
               the work areas it covers and the grant count. -->
          <section class="pf-card re-strip" aria-label="Role">
            <div class="re-strip__row">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
              @if (!editing()?.id) {
                <label class="re-strip__name-field">
                  <span class="sr-only">Role name</span>
                  <input type="text" #nameInput class="pf-input pf-re-name" [class.pf-input--error]="!!nameError()"
                         [ngModel]="newRoleName()" (ngModelChange)="onNameChange($event)"
                         placeholder="Role name * — e.g. Billing Supervisor" aria-required="true" />
                </label>
                @if (opdGate.visible()) {
                  <span class="pf-seg re-type" role="radiogroup" aria-label="Role type">
                    @for (o of roleTypeOptions; track o.value) {
                      <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="roleType() === o.value"
                              (click)="roleType.set($any(o.value))">{{ o.label }}</button>
                    }
                  </span>
                }
                @if (templateRoles().length > 0) {
                  <pf-select class="re-template-pick" size="sm" [options]="templateOptions()" [value]="templateApplied() ?? ''"
                             placeholder="Start from a role (optional)" (valueChange)="applyTemplateId($event)"></pf-select>
                }
              } @else {
                <span class="pf-uf-ctx__name re-strip__name">
                  <span class="pf-uf-ctx__text">{{ editing()!.name }}</span>
                  <span class="pf-uf-ctx__badge" role="note">{{ typeLabel() }}</span>
                </span>
                <span class="re-strip__who" [title]="whoLine()">{{ whoLine() }}</span>
              }
              <span class="pf-card__spacer"></span>
              <span class="re-sum__count"><span class="pf-num">{{ grantedCount() }}</span> of <span class="pf-num">{{ permissions().length }}</span> permissions</span>
            </div>
            @if (nameError()) { <p class="pf-uf-err re-strip__err">{{ nameError() }}</p> }
            <div class="re-strip__row re-strip__row--chips">
              <span class="re-strip__k">Works in</span>
              <div class="re-sum">
                @if (capabilityChips().length === 0) {
                  <span class="re-sum__none">Nothing yet — switch permissions on below.</span>
                }
                @for (c of capabilityChips(); track c) {
                  <span class="pf-chip pf-chip--static re-sum__chip">{{ c }}</span>
                }
              </div>
            </div>
            @if (editing()?.isPreSeeded) {
              <p class="pf-field__hint re-strip__lock">System role — the name is locked. Editing the permissions saves a copy for your organisation only.</p>
            }
          </section>

          <div class="pf-sg-panels re-panels" [class.pf-sg-panels--narrow]="narrow()">
            <!-- SIDE card (LEFT): permission groups with granted/total. -->
            @if (narrow()) {
              @if (sheetOpen()) {
                <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
                <aside class="pf-card pf-sg-side pf-sg-side--sheet re-side" role="dialog" aria-modal="true" aria-label="Permission groups"
                       (keydown.escape)="sheetOpen.set(false)">
                  <span class="pf-sg-sheet-handle" aria-hidden="true"></span>
                  <ng-container *ngTemplateOutlet="groupsCard; context: { sheet: true }"></ng-container>
                </aside>
              }
            } @else {
              <aside class="pf-card pf-sg-side re-side" aria-label="Permission groups">
                <ng-container *ngTemplateOutlet="groupsCard; context: { sheet: false }"></ng-container>
              </aside>
            }

            <!-- MAIN card (RIGHT): the selected group's permissions. -->
            <section class="pf-card pf-sg-main re-main" aria-label="Permissions">
              <header class="pf-card__head pf-sg-main__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                <span class="pf-card__label">{{ selectedGroup()?.label || 'All permissions' }}</span>
                <span class="pf-card__note pf-sg-hint">{{ selectedGroup()?.blurb || 'What can this person do? Switch a permission on to allow it.' }}</span>
                <span class="pf-sg-count pf-num">{{ mainCountLabel() }}</span>
                @if (selectedGroup(); as g) {
                  @if (g.granted < g.items.length) {
                    <button type="button" class="pf-btn pf-btn--tertiary re-group__link" (click)="grantGroup(g, true)">Grant all</button>
                  }
                  @if (g.granted > 0) {
                    <button type="button" class="pf-btn pf-btn--tertiary re-group__link" (click)="grantGroup(g, false)">Clear</button>
                  }
                }
              </header>
              <div class="pf-sg-main__body">
                <ag-grid-angular class="pf-sg-grid re-grid" [theme]="gridTheme()" [rowData]="gridRows()" [columnDefs]="colDefs()"
                                 [defaultColDef]="defaultColDef" [getRowId]="getRowId" [animateRows]="true"
                                 [suppressNoRowsOverlay]="true" [suppressCellFocus]="true"></ag-grid-angular>
                @if (gridRows().length === 0) {
                  <div class="pf-sg-empty"><p class="pf-sg-empty__title re-empty">Nothing matches “{{ search() }}”.</p></div>
                }
              </div>
            </section>
          </div>
        }
      </div>
    </section>

    <ng-template #groupsCard let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
        <span class="pf-card__label">Groups</span>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close groups">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      <ul class="pf-card__body re-groups">
        <li class="re-g">
          <button type="button" class="re-g__btn" [attr.aria-pressed]="!groupKey()" (click)="pickGroup(null)">
            <span class="re-g__name">All</span>
            <span class="re-g__n pf-num">{{ allGranted() }}/{{ allItems() }}</span>
          </button>
        </li>
        @for (g of groupViews(); track g.key) {
          <li class="re-g re-group">
            <button type="button" class="re-g__btn" [attr.aria-pressed]="groupKey() === g.key" (click)="pickGroup(g.key)">
              <span class="re-g__name re-group__title">{{ g.label }}</span>
              <span class="re-g__n re-group__count pf-num" [class.re-g__n--full]="g.granted === g.items.length">{{ g.granted }}/{{ g.items.length }}</span>
            </button>
          </li>
        }
      </ul>
    </ng-template>
  `,
  styleUrls: ['./user-form.styles.scss', '../../../shared/settings-grid/settings-grid.scss', './role-editor.component.scss']
})
export class RoleEditorComponent implements OnInit {
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  /** The pill's pencil: put the caret in the name field. */
  editName(): void {
    const el = this.nameInput()?.nativeElement;
    if (el) { el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); el.focus(); el.select(); }
  }

  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);
  /** OPD dark build: Doctor role type + OPD permission codes only when OPD is visible. */
  protected readonly opdGate = inject(OpdGateService);
  private readonly casesheetGate = inject(CasesheetGateService);

  private readonly _editing = signal<Role | null>(null);
  private readonly _permissions = signal<Permission[]>([]);
  private readonly _grantedIds = signal<Set<string>>(new Set());
  private readonly _saving = signal(false);
  /** Opening the editor: skeleton until its data lands (held, no flash). */
  private readonly recordHold = createLoadHold(true);
  readonly recordSkeleton = this.recordHold.active;
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
        group: info?.group ?? 'other',
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

  // ── Test Master frame: groups side card (LEFT) + permissions grid ──────
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly sheetOpen = signal(false);
  /** The selected permission group; null = All. */
  readonly groupKey = signal<string | null>(null);
  readonly selectedGroup = computed(() => this.groupViews().find(g => g.key === this.groupKey()) ?? null);
  readonly allItems = computed(() => this.groupViews().reduce((n, g) => n + g.items.length, 0));
  readonly allGranted = computed(() => this.groupViews().reduce((n, g) => n + g.granted, 0));
  /** The grid's rows: the selected group's permissions (all groups for All),
   *  each carrying its Allowed state so a switch repaints its row. */
  readonly gridRows = computed(() => {
    const g = this._grantedIds();
    const sel = this.selectedGroup();
    const rows = sel ? sel.items : this.groupViews().flatMap(v => v.items);
    return rows.map(r => ({ ...r, allowed: g.has(r.perm.id) }));
  });
  readonly mainCountLabel = computed(() => {
    const sel = this.selectedGroup();
    const total = sel ? sel.items.length : this.allItems();
    const on = sel ? sel.granted : this.allGranted();
    return `${on} of ${total} allowed`;
  });
  /** "Who this is" in one line (the catalogue's sentence, or the custom-role line). */
  readonly whoLine = computed(() => {
    const r = this._editing();
    return (r && ROLE_INFO[r.name]) || 'A custom role for your organisation — the summary updates as you switch permissions.';
  });
  readonly templateOptions = computed<PfSelectOption[]>(() =>
    this.templateRoles().map(r => ({ value: r.id, label: r.name, hint: ROLE_INFO[r.name] ?? undefined })));

  readonly gridTheme = sgGridTheme();
  readonly getRowId = (p: GetRowIdParams<PermRow & { allowed: boolean }>) => p.data.perm.id;
  readonly defaultColDef: ColDef = { sortable: false, resizable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };
  readonly colDefs = computed<ColDef<PermRow & { allowed: boolean }>[]>(() => {
    const all = !this.groupKey();
    const groupLabel = new Map(PERMISSION_GROUPS.map(g => [g.key, g.label] as const));
    const cols: ColDef<PermRow & { allowed: boolean }>[] = [
      { colId: 'allowed', headerName: 'Allowed', width: 96, minWidth: 96, maxWidth: 96, flex: 0, wrapText: false, autoHeight: false,
        cellRenderer: (p: ICellRendererParams<PermRow & { allowed: boolean }>) => {
          const d = p.data;
          if (!d) return document.createElement('span');
          const el = sgSwitch(d.allowed, d.title, () => this.setGranted(d.perm.id, !this.isGranted(d.perm.id)));
          const b = el.querySelector('button')!;
          b.setAttribute('aria-label', d.title);
          b.title = d.allowed ? 'Allowed — switch off' : 'Not allowed — switch on';
          return el;
        } },
      { colId: 'title', headerName: 'Permission', flex: 1.1, minWidth: 180,
        valueGetter: p => p.data?.title ?? '',
        cellRenderer: (p: ICellRendererParams<PermRow & { allowed: boolean }>) =>
          sgCell(p.data?.title, all && !this.phone() ? groupLabel.get(p.data?.group ?? '') : null, true) },
      { colId: 'what', headerName: 'What it does', flex: 2, minWidth: 220, valueGetter: p => p.data?.what ?? '',
        cellRenderer: (p: ICellRendererParams<PermRow & { allowed: boolean }>) => sgCell(p.data?.what) },
      { colId: 'impact', headerName: 'Impact', width: 128, minWidth: 116, flex: 0, wrapText: false, autoHeight: false,
        valueGetter: p => (p.data?.sensitive ? 'High impact' : ''),
        cellRenderer: (p: ICellRendererParams<PermRow & { allowed: boolean }>) => {
          const el = document.createElement('span');
          if (p.data?.sensitive) { el.className = 'pf-chip pf-chip--static re-perm__flag'; el.textContent = 'High impact'; }
          return el;
        } },
      { colId: 'code', headerName: 'Code', flex: 0.8, minWidth: 150, valueGetter: p => p.data?.perm.code ?? '',
        cellClass: 'pf-num re-code' },
    ];
    if (this.phone()) return cols.filter(c => c.colId === 'allowed' || c.colId === 'title' || c.colId === 'impact');
    return cols;
  });

  /** Band search finds a permission across ALL groups. */
  onSearch(v: string) {
    this.search.set(v);
    if (v.trim()) this.groupKey.set(null);
  }
  pickGroup(key: string | null) {
    this.groupKey.set(key);
    if (this.narrow()) this.sheetOpen.set(false);
  }
  applyTemplateId(id: string) {
    const r = this.templateRoles().find(x => x.id === id);
    if (r) this.applyTemplate(r);
  }

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

  /** Granted among the LISTED permissions (hidden OPD codes stay granted —
   *  saves send every granted id — but are not counted while OPD is dark). */
  readonly grantedCount = computed(() => {
    const g = this._grantedIds();
    return this._permissions().filter(p => g.has(p.id)).length;
  });

  ngOnInit() {
    const backHandler = () => {
      this.back();
      return true;
    };
    this.navBack.registerBackInterceptor(backHandler);
    this.destroyRef.onDestroy(() => {
      this.navBack.clearBackInterceptor(backHandler);
    });

    const id = this.route.snapshot.paramMap.get('id');
    // First load: permissions + roles (+ this role's grants) — then the form.
    let left = id ? 3 : 2;
    const landed = () => { if (--left === 0) this.recordHold.done(); };
    this.destroyRef.onDestroy(() => this.recordHold.cancel());

    this.api.get<Permission[]>('/api/permissions').subscribe({
      // Gated codes (OPD, case sheets) are hidden while their gate is closed; grants are preserved on save.
      next: l => { this._permissions.set(visibleGatedPermissions(l ?? [], { opd: this.opdGate.visible(), casesheets: this.casesheetGate.visible() })); landed(); },
      error: () => landed(),
    });

    // Load the full roles list always — for edit it identifies the role, and for
    // create it lets us reject a duplicate name before hitting the server.
    this.api.get<Role[]>('/api/roles/').subscribe({
      next: roles => {
        this._allRoles.set(roles ?? []);
        if (id) this._editing.set((roles ?? []).find(x => x.id === id) ?? null);
        landed();
      },
      error: () => landed(),
    });
    if (id) {
      this.api.get<string[]>(`/api/roles/${id}/permissions`).subscribe({
        next: ids => { this._grantedIds.set(new Set(ids ?? [])); landed(); },
        error: () => landed(),
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
