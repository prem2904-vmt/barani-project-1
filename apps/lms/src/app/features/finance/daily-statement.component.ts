import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { CurrencyInrPipe } from '../../shared/pipes/currency-inr.pipe';
import { NumberInputComponent } from '../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TileComponent } from '../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../core/services/theme.service';
import { bandFilter } from '../../shared/utils/band-search';
import { labToday } from '../../shared/utils/lab-clock';

interface ModeTotal { mode: string; count: number; total: number; }

interface DayClosure {
  id: string;
  date: string;
  shift?: string | null;
  openingBalance: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  totalsJson?: string | null;
  note?: string | null;
  closedBy?: string | null;
  closedAt: string;
}

interface DailyStatement {
  date: string;
  shift?: string | null;
  openingBalance: number;
  payments: ModeTotal[];
  refunds: ModeTotal[];
  totalCollected: number;
  totalRefunded: number;
  net: number;
  cashCollected: number;
  cashRefunded: number;
  expectedCash: number;
  closure?: DayClosure | null;
}

interface ModeRow {
  mode: string;
  label: string;
  iconPath: string;
  collected: number;
  count: number;
  refunded: number;
}

/** Display defs for the known payment modes — mirrors the billing screen's
 *  PAY_MODES so the split reads the same everywhere. */
const MODE_DEFS: Array<{ id: string; label: string; iconPath: string }> = [
  { id: 'upi',    label: 'UPI',           iconPath: 'M12 4v16M5 8h14M5 16h14' },
  { id: 'card',   label: 'Card',          iconPath: 'M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 11h18' },
  { id: 'cash',   label: 'Cash',          iconPath: 'M3 6h18v12H3zM7 12a5 3 0 0 1 10 0 5 3 0 0 1-10 0Z' },
  { id: 'wallet', label: 'Credit Wallet', iconPath: 'M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14M17 14h.01' },
];
const OTHER_ICON = 'M12 8v8M8 12h8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';

/**
 * Finance — Daily Statement. Opening balance (chained from the previous
 * closure's counted cash), the day's collections split by payment mode,
 * refunds, an "enter counted cash" reconciliation and the day/shift account
 * closure. Once closed, the day renders as a locked summary.
 */
@Component({
  selector: 'pf-daily-statement',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    CurrencyInrPipe,
    NumberInputComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): the pill searches the recent closures; business day
             + shift ride inside it; Close day is the band's primary action. -->
        <pf-hero-band [back]="true" placeholder="Search closures — date or shift…"
                      [value]="closureQ()" (valueChange)="closureQ.set($event)">
          <ng-container band-tools>
            <div class="pf-ds-band" role="group" aria-label="Business day and shift">
              <input type="date" class="pf-ds-band__in" aria-label="Business day" [max]="todayStr"
                     [ngModel]="dateStr()" (ngModelChange)="setDate($event)" />
              <input type="text" class="pf-ds-band__in pf-ds-band__shift" aria-label="Shift (optional)"
                     placeholder="Shift (optional)"
                     [ngModel]="shiftName()" (ngModelChange)="shiftName.set($event)" (change)="load()" />
            </div>
          </ng-container>
          <ng-container band-actions>
            @if (stmt(); as s) {
              @if (!s.closure) {
                <button type="button" class="pf-hb-btn pf-hb-btn--primary press"
                        [disabled]="countedCash() === null || saving()" (click)="closeDay()"
                        [attr.aria-label]="shiftName().trim() ? 'Close shift' : 'Close day'"
                        [title]="countedCash() === null ? 'Enter the counted cash first' : (shiftName().trim() ? 'Close shift' : 'Close day')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/></svg>
                  {{ saving() ? 'Closing…' : (shiftName().trim() ? 'Close shift' : 'Close day') }}
                </button>
              }
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Finance"
        title="Daily Statement"
        subtitle="Collections by mode, cash count and day closure.">
      </pf-screen-header>

      <div class="pf-band-body">
      <!-- Business day + optional shift (classic; in the band pill in the new design) -->
      <div class="flex flex-wrap items-end gap-3 mb-5 pf-classic-only">
        <div>
          <label class="pf-label">Business day</label>
          <input type="date" class="pf-input" [max]="todayStr"
                 [ngModel]="dateStr()" (ngModelChange)="setDate($event)" />
        </div>
        <div>
          <label class="pf-label">Shift (optional)</label>
          <input type="text" class="pf-input" placeholder="e.g. day / evening"
                 [ngModel]="shiftName()" (ngModelChange)="shiftName.set($event)"
                 (change)="load()" />
        </div>
      </div>

      @if (stmt(); as s) {
        <!-- Headline figures -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <pf-tile tone="default" padding="lg" class="block">
            <p class="pf-stat-label">Opening balance</p>
            <p class="pf-stat-value">{{ s.openingBalance | inr }}</p>
            <p class="pf-stat-hint">Carried from the previous closure</p>
          </pf-tile>
          <pf-tile tone="default" padding="lg" class="block">
            <p class="pf-stat-label">Total collected</p>
            <p class="pf-stat-value">{{ s.totalCollected | inr }}</p>
            <p class="pf-stat-hint">All modes, this day</p>
          </pf-tile>
          <pf-tile tone="default" padding="lg" class="block">
            <p class="pf-stat-label">Refunds</p>
            <p class="pf-stat-value">{{ s.totalRefunded | inr }}</p>
            <p class="pf-stat-hint">Paid back to patients</p>
          </pf-tile>
          <pf-tile tone="default" padding="lg" class="block">
            <p class="pf-stat-label">Expected cash</p>
            <p class="pf-stat-value">{{ s.expectedCash | inr }}</p>
            <p class="pf-stat-hint">Opening + cash in − cash refunds</p>
          </pf-tile>
        </div>

        <!-- Collection split by mode -->
        <pf-tile tone="default" padding="lg" class="block mb-5">
          <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
              style="color: var(--text-muted);">Collections by mode</h3>
          <div class="space-y-2">
            @for (row of modeRows(); track row.mode) {
              <div class="pf-mode-row">
                <span class="pf-mode-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path [attr.d]="row.iconPath"/>
                  </svg>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-[14px] font-semibold truncate" style="color: var(--text-primary);">{{ row.label }}</p>
                  <p class="text-[11px]" style="color: var(--text-tertiary);">
                    {{ row.count }} payment{{ row.count === 1 ? '' : 's' }}
                    @if (row.refunded > 0) { · {{ row.refunded | inr }} refunded }
                  </p>
                </div>
                <p class="text-[15px] font-bold font-mono" style="color: var(--text-primary);">{{ row.collected | inr }}</p>
              </div>
            }
          </div>
          <div class="flex items-center justify-between mt-4 pt-3" style="border-top: 1px solid var(--border-muted);">
            <p class="text-[13px] font-semibold" style="color: var(--text-secondary);">Net collected</p>
            <p class="text-[15px] font-bold font-mono" style="color: var(--text-primary);">{{ s.net | inr }}</p>
          </div>
        </pf-tile>

        <!-- Closure: locked summary when closed, entry form otherwise -->
        @if (s.closure; as c) {
          <pf-tile tone="default" padding="lg" class="block mb-5 pf-closed-tile">
            <div class="flex items-center gap-2 mb-3">
              <span class="pf-lock-badge" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/>
                </svg>
              </span>
              <h3 class="text-[14px] font-bold" style="color: var(--text-primary);">
                {{ c.shift ? (c.shift + ' shift closed') : 'Day closed' }}
              </h3>
              <span class="text-[11px] ml-auto" style="color: var(--text-tertiary);">
                {{ c.closedAt | date:'MMM d, h:mm a' }}
              </span>
            </div>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div><p class="pf-stat-label">Opening</p><p class="pf-stat-value">{{ c.openingBalance | inr }}</p></div>
              <div><p class="pf-stat-label">Expected cash</p><p class="pf-stat-value">{{ c.expectedCash | inr }}</p></div>
              <div><p class="pf-stat-label">Counted cash</p><p class="pf-stat-value">{{ c.countedCash | inr }}</p></div>
              <div>
                <p class="pf-stat-label">Variance</p>
                <p class="pf-stat-value" [style.color]="c.variance < 0 ? 'var(--rose-500, #f43f5e)' : 'var(--emerald-500, #10b981)'">
                  {{ c.variance | inr }}
                </p>
              </div>
            </div>
            @if (c.note) {
              <p class="text-[12px] mt-3" style="color: var(--text-tertiary);">Note: {{ c.note }}</p>
            }
          </pf-tile>
        } @else {
          <pf-tile tone="default" padding="lg" class="block mb-5">
            <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
                style="color: var(--text-muted);">Close the {{ shiftName().trim() ? 'shift' : 'day' }}</h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label class="pf-label">Counted cash (physical)</label>
                <pf-number-input
                  [value]="countedCash()"
                  [min]="0" [step]="100" [allowEmpty]="true"
                  placeholder="0"
                  (valueChange)="countedCash.set($event)">
                </pf-number-input>
              </div>
              <div>
                <label class="pf-label">Expected cash</label>
                <p class="text-[17px] font-bold font-mono pt-2" style="color: var(--text-primary);">
                  {{ s.expectedCash | inr }}
                </p>
              </div>
              <div>
                <label class="pf-label">Variance (counted − expected)</label>
                <p class="text-[17px] font-bold font-mono pt-2"
                   [style.color]="variance() === null ? 'var(--text-tertiary)'
                                  : variance()! < 0 ? 'var(--rose-500, #f43f5e)' : 'var(--emerald-500, #10b981)'">
                  {{ variance() === null ? '—' : (variance() | inr) }}
                </p>
              </div>
            </div>
            <div class="mt-3">
              <label class="pf-label">Note (optional)</label>
              <input type="text" class="pf-input" placeholder="e.g. short ₹200 — change float"
                     [ngModel]="note()" (ngModelChange)="note.set($event)" />
            </div>
            <div class="mt-4 pf-classic-only">
              <pf-touch-btn size="md" variant="primary"
                            [disabled]="countedCash() === null || saving()"
                            (pressed)="closeDay()">
                <span icon-left aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/>
                  </svg>
                </span>
                {{ saving() ? 'Closing…' : (shiftName().trim() ? 'Close shift' : 'Close day') }}
              </pf-touch-btn>
            </div>
          </pf-tile>
        }
      } @else {
        <pf-tile tone="default" padding="lg" class="block mb-5">
          <p class="text-[13px]" style="color: var(--text-tertiary);">Loading statement…</p>
        </pf-tile>
      }

      <!-- Recent closures -->
      <pf-tile tone="default" padding="lg" class="block">
        <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
            style="color: var(--text-muted);">Recent closures</h3>
        @if (closures().length === 0) {
          <p class="text-[13px]" style="color: var(--text-tertiary);">No closures in the last 30 days.</p>
        } @else if (visibleClosures().length === 0) {
          <p class="pf-band-empty">No closures match "{{ closureQ() }}".</p>
        } @else {
          <div class="space-y-2">
            @for (c of visibleClosures(); track c.id) {
              <div class="pf-mode-row">
                <div class="min-w-0 flex-1">
                  <p class="text-[14px] font-semibold" style="color: var(--text-primary);">
                    {{ c.date | date:'EEE, MMM d' }}@if (c.shift) { · {{ c.shift }} }
                  </p>
                  <p class="text-[11px]" style="color: var(--text-tertiary);">
                    Expected {{ c.expectedCash | inr }} · Counted {{ c.countedCash | inr }}
                  </p>
                </div>
                <p class="text-[14px] font-bold font-mono"
                   [style.color]="c.variance < 0 ? 'var(--rose-500, #f43f5e)' : 'var(--emerald-500, #10b981)'">
                  {{ c.variance >= 0 ? '+' : '' }}{{ c.variance | inr }}
                </p>
              </div>
            }
          </div>
        }
      </pf-tile>
      </div>
    </section>
  `,
  styles: [`
    /* Band pill: business day + shift. */
    .pf-ds-band { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .pf-ds-band__in {
      height: 32px; padding: 0 9px; border-radius: 9px; font-size: 12.5px; font-family: inherit;
      color: var(--text-primary); background: var(--glass-bg); border: 1px solid var(--glass-border);
      color-scheme: light dark; outline: none;
    }
    .pf-ds-band__in:focus { border-color: rgba(139, 92, 246, 0.55); }
    .pf-ds-band__shift { width: 130px; }
    @media (max-width: 640px) { .pf-ds-band__in { height: 40px; font-size: 16px; } }
    .pf-stat-label {
      font-size: 11px;
      font-family: var(--font-mono, ui-monospace, monospace);
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .pf-stat-value {
      font-size: 18px;
      font-weight: 700;
      font-family: var(--font-mono, ui-monospace, monospace);
      color: var(--text-primary);
    }
    .pf-stat-hint {
      font-size: 11px;
      margin-top: 2px;
      color: var(--text-tertiary);
    }

    .pf-mode-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-mode-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 10px;
      flex-shrink: 0;
      color: var(--text-secondary);
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.14), rgba(236, 72, 153, 0.06));
      border: 1px solid rgba(168, 85, 247, 0.25);
    }

    .pf-closed-tile {
      border-radius: 16px;
    }
    .pf-lock-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      color: var(--emerald-500, #10b981);
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    /* Phone: keep form text >= 16px so iOS doesn't auto-zoom on focus. */
    @media (max-width: 640px) {
      :host .pf-input,
      :host input[type="date"],
      :host input[type="text"] {
        font-size: 16px;
      }
    }
  `]
})
export class DailyStatementComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  /** Band pill search over the recent closures (date, weekday, shift). */
  readonly closureQ = signal('');
  readonly visibleClosures = computed(() => bandFilter(this._closures(), this.closureQ(), (c) => [
    c.date,
    new Date(c.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    c.shift,
  ]));

  /** Today's business date — strictly IST (lab-clock), never the device's day. */
  readonly todayStr = labToday();

  readonly dateStr = signal<string>(this.todayStr);
  readonly shiftName = signal<string>('');
  readonly note = signal<string>('');
  readonly countedCash = signal<number | null>(null);
  readonly saving = signal(false);

  private readonly _stmt = signal<DailyStatement | null>(null);
  readonly stmt = this._stmt.asReadonly();

  private readonly _closures = signal<DayClosure[]>([]);
  readonly closures = this._closures.asReadonly();

  /** Counted − expected; null until a count is typed. Red when negative. */
  readonly variance = computed<number | null>(() => {
    const s = this._stmt();
    const counted = this.countedCash();
    if (!s || counted === null) return null;
    return counted - s.expectedCash;
  });

  /** UPI / Card / Cash / Credit Wallet always shown (0 when idle), any other
   *  modes present in the day appended after. */
  readonly modeRows = computed<ModeRow[]>(() => {
    const s = this._stmt();
    if (!s) return [];
    const pay = new Map(s.payments.map(p => [p.mode, p]));
    const ref = new Map(s.refunds.map(r => [r.mode, r]));
    const rows: ModeRow[] = MODE_DEFS.map(d => ({
      mode: d.id,
      label: d.label,
      iconPath: d.iconPath,
      collected: pay.get(d.id)?.total ?? 0,
      count: pay.get(d.id)?.count ?? 0,
      refunded: ref.get(d.id)?.total ?? 0
    }));
    const known = new Set(MODE_DEFS.map(d => d.id));
    const extras = new Set([...pay.keys(), ...ref.keys()].filter(m => !known.has(m)));
    for (const m of extras) {
      rows.push({
        mode: m,
        label: m.charAt(0).toUpperCase() + m.slice(1),
        iconPath: OTHER_ICON,
        collected: pay.get(m)?.total ?? 0,
        count: pay.get(m)?.count ?? 0,
        refunded: ref.get(m)?.total ?? 0
      });
    }
    return rows;
  });

  ngOnInit() {
    this.load();
    this.loadClosures();
  }

  setDate(d: string) {
    if (!d) return;
    this.dateStr.set(d);
    this.load();
  }

  load() {
    this._stmt.set(null);
    const shift = this.shiftName().trim();
    const q = `/api/finance/daily?date=${this.dateStr()}${shift ? `&shift=${encodeURIComponent(shift)}` : ''}`;
    this.api.get<DailyStatement>(q).subscribe({
      next: s => this._stmt.set(s),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  private loadClosures() {
    this.api.get<DayClosure[]>('/api/finance/closures?days=30').subscribe({
      next: l => this._closures.set(l ?? [])
    });
  }

  closeDay() {
    const s = this._stmt();
    const counted = this.countedCash();
    if (!s || counted === null || this.saving()) return;
    this.saving.set(true);
    this.api.post<DayClosure>('/api/finance/close', {
      date: this.dateStr(),
      shift: this.shiftName().trim() || null,
      openingBalance: s.openingBalance,
      countedCash: counted,
      note: this.note().trim() || null
    }).subscribe({
      next: c => {
        this.saving.set(false);
        this._stmt.set({ ...s, closure: c });
        this.countedCash.set(null);
        this.note.set('');
        this.loadClosures();
        this.toasts.success(c.shift ? 'Shift closed' : 'Day closed');
      },
      error: e => {
        this.saving.set(false);
        const err = ApiError.from(e);
        this.toasts.error(err.message);
        if (err.code === 'already_closed') this.load();
      }
    });
  }
}
