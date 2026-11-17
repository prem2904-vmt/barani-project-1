import { injectSettingsHosted } from '../../../shared/utils/settings-host';
import { SettingGroupComponent, SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandMatch } from '../../../shared/utils/band-search';
import { DialogService } from '../../../core/services/dialog.service';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { SettingsDepartment, alertModuleInDepartment } from '../../../shared/utils/department-scope';

/** One catalog event merged with the tenant's override — mirrors the
 *  middleware's NotificationCatalogRow. The catalog itself lives in the
 *  backend (NotificationCatalog.cs) so this page can never drift from what
 *  the emitters actually fire. */
interface CatalogRow {
  key: string;
  module: string;
  label: string;
  firesWhen: string;
  recipients: string;
  kind: 'instant' | 'overdue';
  enabled: boolean;
  thresholdMinutes: number | null;
  thresholdConfigurable: boolean;
  /** Patient-safety event: still sends while the master switch is off. */
  critical?: boolean;
}

/** GET/POST /api/config/notifications/master — the lab-wide switch. */
interface MasterView { enabled: boolean; alwaysSends?: string[] }

const MODULE_LABELS: Record<string, string> = {
  frontdesk:    'Front desk & orders',
  billing:      'Billing & payments',
  lab:          'Lab bench',
  results:      'Results & validation',
  reports:      'Reports',
  whatsapp:     'WhatsApp billing',
  inventory:    'Inventory',
  appointments: 'Appointments & home collection',
  team:         'Team & platform'
};

/** Which department's alerts a screen shows: the ONE mapping is `ALERT_MODULES` (shared/utils/department-scope.ts). */
export type AlertDepartment = SettingsDepartment;
const DEPARTMENT_NAMES: Record<AlertDepartment, string> = { lab: 'Lab', opd: 'OPD', ipd: 'IPD', pharmacy: 'Pharmacy' };

@Component({
  selector: 'pf-notifications-config',
  standalone: true,
  imports: [SettingRowComponent, SettingGroupComponent, SkeletonRowsComponent, FormsModule, NumberInputComponent, ScreenHeaderComponent, HeroBandComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): search every alert; the module filter rides in
             the pill (a dropdown — eight modules don't fit as chips). -->
        <pf-hero-band [back]="true" placeholder="Search alerts — what fires, who's notified…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            <pf-select class="pf-nc-modsel" size="sm" [options]="moduleOptions()" [value]="moduleFilter() ?? ''"
                       (valueChange)="setModuleFilter($event || null)"></pf-select>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Notifications"
        subtitle="Every in-app alert the platform can raise — switch them all off at once, switch each one on or off, and set how long to wait before 'didn't happen in time' alerts fire.">
      </pf-screen-header>

      <div class="pf-band-body" [class.pf-sgrid]="hosted">
      <!-- Master switch (owner): one lab-wide "All notifications" control above
           the list. Off = nothing sends (bells, phone / browser pushes, overdue
           watches) except critical result alerts; the per-alert choices below
           are kept untouched and come back exactly when it's switched on. -->
      @if (!loading()) {
        <!-- Master switch: ONE row above the list. Off = nothing sends except critical result alerts; the per-alert
             choices below are kept and come back when it is switched on. -->
        <pf-setting-group class="pf-nc-mastergroup" label="All notifications" scope="lab-wide" icon="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0">
        <pf-setting-row class="pf-nc-master" [class.pf-nc-master--off]="!masterOn()" label="Every alert"
                        [hint]="masterOn() ? 'On for the whole lab — ' + enabledTotal() + ' of ' + rows().length + ' alerts are on. Critical result alerts always send.' : 'Off for the whole lab — your choices below are kept. Critical result alerts always send.'">
          <button type="button" class="pf-toggle pf-nc-switch pf-nc-master__switch" role="switch"
                  [attr.aria-checked]="masterOn()" [disabled]="masterSaving()"
                  [attr.aria-label]="'All notifications — ' + (masterOn() ? 'on' : 'off')"
                  (click)="toggleMaster()">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
        </pf-setting-group>
      }

      <!-- Module filter chips (classic; the new design has them in the pill) -->
      <div class="pf-nc-chips pf-classic-only mb-5">
        <button type="button" class="pf-nc-chip" [attr.aria-pressed]="moduleFilter() === null"
                (click)="setModuleFilter(null)">
          All
          <span class="pf-nc-chip__count">{{ rows().length }}</span>
        </button>
        @for (m of modules(); track m) {
          <button type="button" class="pf-nc-chip" [attr.aria-pressed]="moduleFilter() === m"
                  (click)="setModuleFilter(m)">
            {{ moduleLabel(m) }}
            <span class="pf-nc-chip__count">{{ countFor(m) }}</span>
          </button>
        }
      </div>

      @if (loading()) {
        <pf-skeleton-rows [rows]="6" [avatar]="false" label="Loading the event catalog…"></pf-skeleton-rows>
      }

      @for (m of visibleModules(); track m) {
        <pf-setting-group class="pf-nc-group" [class.pf-nc-paused]="!masterOn()" [label]="moduleLabel(m)" icon="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0">
          <span group-tools class="pf-nc-section__meta pf-num">{{ enabledCount(m) }}/{{ countFor(m) }} on</span>
          @for (r of rowsFor(m); track r.key) {
            <div class="pf-nc-card" data-testid="alert-row" [class.pf-nc-card--live]="r.critical" [class.pf-nc-card--off]="!r.enabled">
              <div class="pf-nc-row__text">
                <div class="pf-nc-row__name">
                  <p class="font-semibold pf-nc-row__label">{{ r.label }}</p>
                  @if (r.kind === 'overdue') { <span class="pf-nc-badge">Overdue watch</span> }
                  @if (r.critical && !masterOn()) { <span class="pf-nc-badge pf-nc-badge--always">Always sends</span> }
                </div>
                <p class="pf-nc-row__hint" [title]="r.firesWhen + ' — notifies: ' + r.recipients">{{ r.firesWhen }} · {{ r.recipients }}</p>
              </div>
              <div class="pf-nc-row__ctl">
                @if (r.thresholdConfigurable && r.enabled) {
                  <span class="pf-nc-threshold">after
                    <pf-number-input [value]="r.thresholdMinutes ?? 0" [min]="5" [step]="5" suffix="min"
                                     (valueChange)="setThreshold(r, $event)"></pf-number-input>
                  </span>
                }
                <button type="button" class="pf-toggle pf-nc-switch" role="switch" [attr.aria-checked]="r.enabled"
                        [attr.aria-label]="r.label + (r.enabled ? ' — on' : ' — off')" (click)="setEnabled(r, !r.enabled)">
                  <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                </button>
              </div>
            </div>
          }
        </pf-setting-group>
      }
      @if (!loading() && dept() && !scoped().length) {
        <p class="pf-band-empty" data-testid="nc-dept-empty">There are no {{ deptName() }} alerts yet. They will appear here, each with its own on / off, as {{ deptName() }} raises them.</p>
      }
      @if (!loading() && q().trim() && !visibleModules().length) {
        <p class="pf-band-empty">No alerts match "{{ q() }}".</p>
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-nc-modsel { display: block; min-width: 200px; }
    /* Minimal rows (DESIGN-V2 rule 5): name + one hint line | "after" + switch. */
    .pf-nc-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 20px; padding: 10px 0; border-bottom: 1px solid var(--pf-line); }
    .pf-nc-card:last-child { border-bottom: 0; }
    .pf-nc-row__name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-nc-row__label { margin: 0; font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
    .pf-nc-row__hint { margin: 2px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-nc-card--off .pf-nc-row__label { color: var(--text-secondary); }
    .pf-nc-row__ctl { display: flex; align-items: center; gap: 14px; }
    .pf-nc-threshold { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
    .pf-nc-badge { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 10.5px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .pf-nc-section__meta { font-size: 12px; color: var(--text-tertiary); }
    .pf-nc-paused .pf-nc-card:not(.pf-nc-card--live) { opacity: .55; }
    @media (max-width: 767px) { .pf-nc-card { grid-template-columns: minmax(0, 1fr); } .pf-nc-row__hint { white-space: normal; } }

    /* Master switch card — the one lab-wide control, above the list. */
    .pf-nc-master__row { display: flex; align-items: center; gap: 14px; }
    .pf-nc-master__icon {
      width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);
      color: var(--violet-text, #7c3aed);
    }
    .pf-nc-master--off .pf-nc-master__icon { background: var(--pf-chip-bg); color: var(--text-muted); }
    .pf-nc-master__title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-nc-master__sub { font-size: 12.5px; line-height: 1.4; margin-top: 2px; color: var(--text-secondary); }
    .pf-nc-master__note {
      display: inline-flex; align-items: center; gap: 6px; margin-top: 6px;
      font-size: 12px; font-weight: 500; color: var(--text-secondary);
    }
    .pf-nc-master__note svg { color: var(--violet-text, #7c3aed); flex: none; }
    .pf-nc-switch { flex: none; }
    /* Master off: the per-alert list stays editable (choices are kept) but
       reads as paused; critical rows carry an "Always sends" chip. */
    .pf-nc-badge--always { color: var(--text-primary); }
    @media (max-width: 640px) { .pf-nc-modsel { min-width: 0; width: 100%; } }
    .pf-nc-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pf-nc-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      cursor: pointer;
      transition: border-color .15s ease, color .15s ease;
    }
    .pf-nc-chip:hover { color: var(--text-primary); }
    .pf-nc-chip[aria-pressed='true'] {
      color: var(--text-primary);
      border-color: var(--pf-sel-border);
      background: var(--pf-sel-bg);
    }
    .pf-nc-chip__count {
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }
    .pf-nc-chip[aria-pressed='true'] .pf-nc-chip__count { color: var(--text-secondary); }

    .pf-nc-section {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 0 2px 8px;
    }
    .pf-nc-section__title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    .pf-nc-section__meta {
      font-size: 11.5px;
      color: var(--text-muted);
    }

    .pf-nc-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .pf-nc-row__icon {
      width: 36px;
      height: 36px;
      border-radius: 11px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);
      color: var(--violet-text, #7c3aed);
    }
    /* Overdue watches: the same violet chip — the clock glyph + "Overdue
       watch" chip say it; no orange (palette only). */
    .pf-nc-row__icon--off {
      background: var(--pf-chip-bg);
      color: var(--text-muted);
    }

    @media (pointer: coarse) { .pf-nc-switch { min-width: 44px; min-height: 44px; justify-content: center; } }


    /* ===== Phone overrides (<=640px) — additive only ===== */
    @media (max-width: 640px) {
      /* iOS zooms inputs under 16px on focus — scope to this page's nested
         number-input only, never the shared primitive. */
      :host ::ng-deep pf-number-input input {
        font-size: 16px;
      }
      .pf-nc-row { gap: 10px; }
      .pf-nc-row__icon { width: 32px; height: 32px; border-radius: 9px; }
    }

    /* ===== Coarse-pointer (touch) sizing ===== */
    @media (pointer: coarse) {
      .pf-nc-chip { min-height: 40px; }
    }
  `]
})
export class NotificationsConfigComponent implements OnInit {
  /** In the Settings shell: the alert groups are cards in the page grid. */
  protected readonly hosted = injectSettingsHosted();
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  /** Lab-wide "All notifications" switch (server-enforced in the single
   *  notification gate; this only reflects and flips it). */
  readonly masterOn = signal<boolean>(true);
  readonly masterSaving = signal<boolean>(false);
  readonly enabledTotal = computed(() => this.scoped().filter(r => r.enabled).length);

  /** Show only one department's alerts (Lab alerts, OPD alerts, IPD alerts).
   *  No value = every alert (the old single page). The master switch stays
   *  lab-wide either way. */
  readonly department = input<SettingsDepartment | null>(null);
  private readonly _rows = signal<CatalogRow[]>([]);
  /** Which department this screen is for: the `department` input, else the route's `data.department`. */
  private readonly routeDept = inject(ActivatedRoute, { optional: true })?.snapshot.data?.['department'] as AlertDepartment | undefined;
  readonly dept = computed<AlertDepartment | null>(() => this.department() ?? this.routeDept ?? null);
  readonly deptName = computed(() => { const d = this.dept(); return d ? DEPARTMENT_NAMES[d] : ''; });
  /** The rows this screen shows (all of them without a department). */
  readonly scoped = computed(() => this._rows().filter(r => alertModuleInDepartment(r.module, this.dept())));
  readonly rows = this.scoped;
  readonly loading = signal<boolean>(true);

  private readonly _moduleFilter = signal<string | null>(null);
  readonly moduleFilter = this._moduleFilter.asReadonly();
  setModuleFilter(m: string | null) { this._moduleFilter.set(m); }

  /** Module keys in backend catalog order (first-seen order of rows). */
  readonly modules = computed(() => {
    const seen: string[] = [];
    for (const r of this.scoped()) if (!seen.includes(r.module)) seen.push(r.module);
    return seen;
  });
  protected readonly theme = inject(ThemeService);
  /** Band pill search over label / fires-when / recipients. */
  readonly q = signal('');
  private matches(r: CatalogRow): boolean { return bandMatch(this.q(), r.label, r.firesWhen, r.recipients, this.moduleLabel(r.module)); }

  readonly visibleModules = computed(() => {
    const f = this._moduleFilter();
    const mods = f === null ? this.modules() : this.modules().filter(m => m === f);
    if (!this.q().trim()) return mods;
    return mods.filter(m => this.scoped().some(r => r.module === m && this.matches(r)));
  });
  /** Module picker in the pill ('' = All), counts in the label. */
  readonly moduleOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: `All modules · ${this.scoped().length}` },
    ...this.modules().map(m => ({ value: m, label: `${this.moduleLabel(m)} · ${this.countFor(m)}` })),
  ]);

  moduleLabel(m: string): string { return MODULE_LABELS[m] ?? m; }
  /** Rows of a module that pass the pill search (all rows when no query). */
  rowsFor(m: string): CatalogRow[] { return this.scoped().filter(r => r.module === m && this.matches(r)); }
  private allRowsFor(m: string): CatalogRow[] { return this.scoped().filter(r => r.module === m); }
  countFor(m: string): number { return this.allRowsFor(m).length; }
  enabledCount(m: string): number { return this.allRowsFor(m).filter(r => r.enabled).length; }

  ngOnInit() {
    this.api.get<CatalogRow[]>('/api/config/notifications/catalog').subscribe({
      next: rows => { this._rows.set(rows ?? []); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toasts.error(ApiError.from(e).message); }
    });
    this.api.get<MasterView>('/api/config/notifications/master').subscribe({
      // Missing / older backend → on (the server default).
      next: m => this.masterOn.set((m as MasterView | null)?.enabled !== false),
      error: () => this.masterOn.set(true)
    });
  }

  /** Flip the master switch. Turning it OFF asks first (it silences the whole
   *  lab); ON is instant. Never touches the per-alert rows. */
  async toggleMaster() {
    if (this.masterSaving()) return;
    const next = !this.masterOn();
    if (!next) {
      const ok = await this.dialog.confirm({
        title: 'Turn off all notifications?',
        message: 'No one in the lab gets bells, phone or browser alerts until you switch this back on. Critical result alerts always send. Your individual alert choices are kept.',
        confirmLabel: 'Turn off',
        tone: 'danger'
      });
      if (!ok) return;
    }
    this.masterSaving.set(true);
    this.masterOn.set(next);
    this.api.post('/api/config/notifications/master', { enabled: next }).subscribe({
      next: () => {
        this.masterSaving.set(false);
        this.toasts.success(next ? 'All notifications on' : 'All notifications off — critical result alerts still send');
      },
      error: e => {
        this.masterSaving.set(false);
        this.masterOn.set(!next);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  setEnabled(r: CatalogRow, enabled: boolean) {
    this.patchRow(r.key, { enabled });
    this.save({ ...r, enabled }, enabled ? `${r.label} on` : `${r.label} off`);
  }

  setThreshold(r: CatalogRow, minutes: number | null) {
    if (minutes == null || minutes < 5) return;
    if (minutes === r.thresholdMinutes) return;
    this.patchRow(r.key, { thresholdMinutes: minutes });
    this.save({ ...r, thresholdMinutes: minutes }, `${r.label}: after ${minutes} min`);
  }

  private patchRow(key: string, p: Partial<CatalogRow>) {
    this._rows.update(list => list.map(r => r.key === key ? { ...r, ...p } : r));
  }

  /** Autosave — one POST per change; always sends the row's full state so a
   *  toggle never wipes a saved threshold (the backend stores them together). */
  private save(r: CatalogRow, toast: string) {
    this.api.post('/api/config/notifications', {
      eventType: r.key,
      inAppEnabled: r.enabled,
      thresholdMinutes: r.thresholdConfigurable ? r.thresholdMinutes : null
    }).subscribe({
      next: () => this.toasts.success(toast),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
