import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandMatch } from '../../../shared/utils/band-search';

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
}

const MODULE_LABELS: Record<string, string> = {
  frontdesk:    'Front desk & orders',
  billing:      'Billing & payments',
  lab:          'Lab bench',
  results:      'Results & validation',
  reports:      'Reports',
  inventory:    'Inventory',
  appointments: 'Appointments & home collection',
  team:         'Team & platform'
};

@Component({
  selector: 'pf-notifications-config',
  standalone: true,
  imports: [FormsModule, NumberInputComponent, ScreenHeaderComponent, TileComponent, ToggleComponent, HeroBandComponent, SelectComponent],
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
        subtitle="Every in-app alert the platform can raise — switch each one on or off, and set how long to wait before 'didn't happen in time' alerts fire.">
      </pf-screen-header>

      <div class="pf-band-body">
      <!-- Module filter chips (classic; the new design has them in the pill) -->
      <div class="pf-nc-chips pf-classic-only mb-5">
        <button type="button" class="pf-nc-chip" [class.pf-nc-chip--on]="moduleFilter() === null"
                (click)="setModuleFilter(null)">
          All
          <span class="pf-nc-chip__count">{{ rows().length }}</span>
        </button>
        @for (m of modules(); track m) {
          <button type="button" class="pf-nc-chip" [class.pf-nc-chip--on]="moduleFilter() === m"
                  (click)="setModuleFilter(m)">
            {{ moduleLabel(m) }}
            <span class="pf-nc-chip__count">{{ countFor(m) }}</span>
          </button>
        }
      </div>

      @if (loading()) {
        <p class="text-[13px] px-1" style="color: var(--text-muted);">Loading the event catalog…</p>
      }

      @for (m of visibleModules(); track m) {
        <div class="mb-6">
          <div class="pf-nc-section">
            <h3 class="pf-nc-section__title">{{ moduleLabel(m) }}</h3>
            <span class="pf-nc-section__meta">{{ enabledCount(m) }}/{{ countFor(m) }} on</span>
          </div>
          <div class="space-y-2">
            @for (r of rowsFor(m); track r.key) {
              <pf-tile tone="default" padding="md">
                <div class="pf-nc-row">
                  <div class="pf-nc-row__icon" [class.pf-nc-row__icon--overdue]="r.kind === 'overdue'"
                       [class.pf-nc-row__icon--off]="!r.enabled">
                    @if (r.kind === 'overdue') {
                      <!-- clock: something did NOT happen in time -->
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9"/>
                        <path d="M12 7v5l3 2"/>
                      </svg>
                    } @else {
                      <!-- bell: something happened -->
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
                      </svg>
                    }
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <p class="font-semibold text-[14.5px]" style="color: var(--text-primary);">{{ r.label }}</p>
                      @if (r.kind === 'overdue') {
                        <span class="pf-nc-badge pf-nc-badge--overdue">overdue watch</span>
                      }
                    </div>
                    <p class="text-[12.5px] mt-0.5 leading-snug" style="color: var(--text-secondary);">{{ r.firesWhen }}</p>
                    <p class="text-[11.5px] mt-1" style="color: var(--text-muted);">
                      Notifies: {{ r.recipients }}
                    </p>

                    @if (r.thresholdConfigurable && r.enabled) {
                      <div class="pf-nc-threshold mt-2.5">
                        <span class="text-[12px]" style="color: var(--text-secondary);">Alert after</span>
                        <pf-number-input
                          [value]="r.thresholdMinutes ?? 0"
                          [min]="5" [step]="5" suffix="min"
                          (valueChange)="setThreshold(r, $event)">
                        </pf-number-input>
                      </div>
                    }
                  </div>

                  <pf-toggle [checked]="r.enabled" (checkedChange)="setEnabled(r, $event)"></pf-toggle>
                </div>
              </pf-tile>
            }
          </div>
        </div>
      }
      @if (!loading() && q().trim() && !visibleModules().length) {
        <p class="pf-band-empty">No alerts match "{{ q() }}".</p>
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-nc-modsel { display: block; min-width: 200px; }
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
    .pf-nc-chip--on {
      color: var(--text-primary);
      border-color: rgba(139, 92, 246, 0.55);
      background: rgba(139, 92, 246, 0.14);
    }
    .pf-nc-chip__count {
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }
    .pf-nc-chip--on .pf-nc-chip__count { color: var(--text-secondary); }

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
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(139, 92, 246, 0.07));
      border: 1px solid rgba(139, 92, 246, 0.3);
      color: var(--violet-text, #a78bfa);
    }
    .pf-nc-row__icon--overdue {
      background: linear-gradient(135deg, rgba(232, 119, 34, 0.2), rgba(232, 119, 34, 0.06));
      border-color: rgba(232, 119, 34, 0.32);
      color: #f0a35e;
    }
    .pf-nc-row__icon--off {
      background: var(--glass-bg);
      border-color: var(--glass-border);
      color: var(--text-muted);
    }

    .pf-nc-badge {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 999px;
    }
    .pf-nc-badge--overdue {
      color: #f0a35e;
      background: rgba(232, 119, 34, 0.12);
      border: 1px solid rgba(232, 119, 34, 0.3);
    }

    .pf-nc-threshold {
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 240px;
    }

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
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  private readonly _rows = signal<CatalogRow[]>([]);
  readonly rows = this._rows.asReadonly();
  readonly loading = signal<boolean>(true);

  private readonly _moduleFilter = signal<string | null>(null);
  readonly moduleFilter = this._moduleFilter.asReadonly();
  setModuleFilter(m: string | null) { this._moduleFilter.set(m); }

  /** Module keys in backend catalog order (first-seen order of rows). */
  readonly modules = computed(() => {
    const seen: string[] = [];
    for (const r of this._rows()) if (!seen.includes(r.module)) seen.push(r.module);
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
    return mods.filter(m => this._rows().some(r => r.module === m && this.matches(r)));
  });
  /** Module picker in the pill ('' = All), counts in the label. */
  readonly moduleOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: `All modules · ${this._rows().length}` },
    ...this.modules().map(m => ({ value: m, label: `${this.moduleLabel(m)} · ${this.countFor(m)}` })),
  ]);

  moduleLabel(m: string): string { return MODULE_LABELS[m] ?? m; }
  /** Rows of a module that pass the pill search (all rows when no query). */
  rowsFor(m: string): CatalogRow[] { return this._rows().filter(r => r.module === m && this.matches(r)); }
  private allRowsFor(m: string): CatalogRow[] { return this._rows().filter(r => r.module === m); }
  countFor(m: string): number { return this.allRowsFor(m).length; }
  enabledCount(m: string): number { return this.allRowsFor(m).filter(r => r.enabled).length; }

  ngOnInit() {
    this.api.get<CatalogRow[]>('/api/config/notifications/catalog').subscribe({
      next: rows => { this._rows.set(rows ?? []); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toasts.error(ApiError.from(e).message); }
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
