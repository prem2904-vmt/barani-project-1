import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { BackToTodayComponent } from '../../../shared/components/back-to-today/back-to-today.component';
import { formatDate } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ExpenseService } from '../../../core/services/expense.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { DayClosing, cashVariance, expectedWithOpening } from '../../../shared/models/expense.model';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { LAB_TIME_ZONE } from '../../../shared/utils/lab-clock';
import { plural } from '../../../shared/utils/plural';
import { spinDelay } from '../../../shared/utils/busy';
import { dayLabel, inr } from './expense-format';

const MODE_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', other: 'Other' };
export const modeLabel = (m: string) => MODE_LABEL[m] ?? (m ? m.charAt(0).toUpperCase() + m.slice(1) : '');

/** "1,234.50" / "₹ 1,234.5" / "" → a paisa-exact number (null = blank / not money). */
export function parseRupees(text: string): number | null {
  const t = (text ?? '').replace(/[,₹\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) / 100 !== n) return null;
  return n;
}

/**
 * Expenses → Day closing (the cashier, expense_admin). ND split: the DAY
 * card (collections by mode, refunds, discounts, bills / orders / tests and
 * every staff member's expenses — the server's figures, never recomputed here)
 * and the CASH IN HAND side card: opening + cash collected − cash refunds −
 * cash expenses + cash top-ups = expected, counted cash → variance, note, and
 * the ONE primary — Close day (locks that day's expenses; counted cash is the
 * next day's opening). A closed day shows its snapshot + Reopen (latest day
 * only). On phones the cash card comes first.
 */
@Component({
  selector: 'pf-day-closing',
  standalone: true,
  imports: [PfDateComponent, BusyDirective, SkeletonTableComponent, BackToTodayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-dc" [class.pf-dc--narrow]="narrow()">
      <section class="pf-card pf-dc__main" aria-label="Day figures">
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="m9 16 2 2 4-4"/></svg>
          </span>
          <h2 class="pf-card__label">Day closing</h2>
          @if (data(); as d) {
            <span class="pf-chip pf-chip--static pf-dc__state" [attr.data-closed]="d.isClosed">{{ d.isClosed ? 'Closed' : 'Open' }}</span>
          }
          <span class="pf-card__spacer"></span>
          <div class="pf-dc__date">
            <pf-back-to-today [show]="date() !== today()" (reset)="pick(today())" />
            <label class="pf-dc__datelbl" for="pf-dc-date">Day (IST)</label>
            <pf-date label="Day" inputId="pf-dc-date" [value]="date()" [max]="today()" (valueChange)="pick($event)"></pf-date>
          </div>
        </header>

        <div class="pf-card__body pf-dc__body">
          @if (skeleton()) {
            <pf-skeleton-table [rows]="6" [cols]="3" label="Loading the day…"></pf-skeleton-table>
          } @else if (data(); as d) {
            <div class="pf-dc__section">
              <h3 class="pf-dc__h">Collections · {{ dayName(d.date) }}</h3>
              <div class="pf-dc__tiles" role="group" aria-label="Collections by payment mode">
                @for (b of buckets; track b) {
                  <div class="pf-dc__tile"><span class="pf-dc__k">{{ modeLabel(b) }}</span><span class="pf-dc__v pf-num">{{ inr(d.figures.collectionBuckets[b] ?? 0) }}</span></div>
                }
                <div class="pf-dc__tile pf-dc__tile--sum"><span class="pf-dc__k">Total collected</span><span class="pf-dc__v pf-num">{{ inr(d.figures.totalCollected) }}</span></div>
              </div>
              <ul class="pf-dc__rows">
                <li class="pf-row"><span class="pf-row__name">Refunds</span><span class="pf-row__meta pf-num">{{ refundCount() }}</span><span class="pf-row__value pf-num">{{ inr(d.figures.totalRefunded) }}</span></li>
                <li class="pf-row"><span class="pf-row__name">Discounts given</span><span class="pf-row__meta pf-num">{{ plural(d.figures.billed.bills, 'bill') }}</span><span class="pf-row__value pf-num">{{ inr(d.figures.billed.discount) }}</span></li>
                <li class="pf-row"><span class="pf-row__name">Billed</span><span class="pf-row__meta pf-num">{{ plural(d.figures.billed.bills, 'bill') }}</span><span class="pf-row__value pf-num">{{ inr(d.figures.billed.grossBilled) }}</span></li>
                <li class="pf-row"><span class="pf-row__name">Orders · tests</span><span class="pf-row__meta pf-num">{{ plural(d.figures.activity.patients, 'patient') }}</span><span class="pf-row__value pf-num">{{ d.figures.activity.orders }} · {{ d.figures.activity.tests }}</span></li>
              </ul>
            </div>

            <div class="pf-dc__section">
              <h3 class="pf-dc__h">Staff expenses · {{ plural(d.figures.expenses.count, 'entry', 'entries') }}</h3>
              @if (d.figures.expenses.byPerson.length === 0) {
                <p class="pf-dc__none">No one entered an expense on this day.</p>
              } @else {
                <ul class="pf-dc__rows" aria-label="Expenses by person">
                  @for (p of d.figures.expenses.byPerson; track p.userId) {
                    <li class="pf-row">
                      <span class="pf-row__name">{{ p.name || 'Staff' }}</span>
                      <span class="pf-row__meta pf-num">{{ plural(p.count, 'entry', 'entries') }}{{ p.cashIn ? ' · in ' + inr(p.cashIn) : '' }}</span>
                      <span class="pf-row__value pf-num">{{ inr(p.expenses) }}</span>
                    </li>
                  }
                  <li class="pf-row pf-dc__total"><span class="pf-row__name">All staff</span><span class="pf-row__meta pf-num">cash {{ inr(d.figures.expenses.cashExpenses) }}</span><span class="pf-row__value pf-num">{{ inr(d.figures.expenses.expenses) }}</span></li>
                </ul>
              }
            </div>
          }
        </div>
      </section>

      <aside class="pf-card pf-dc__side" aria-label="Cash in hand">
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M21 11h-5a2 2 0 0 0 0 4h5v-4Z"/></svg>
          </span>
          <h2 class="pf-card__label">Cash in hand</h2>
        </header>
        <div class="pf-card__body">
          @if (data(); as d) {
            <ul class="pf-dc__calc" aria-label="Expected cash">
              <li><span>Opening</span><span class="pf-num">{{ inr(openingShown()) }}</span></li>
              <li class="pf-dc__hint">{{ openingHint() }}</li>
              <li><span>+ Cash collected</span><span class="pf-num">{{ inr(d.figures.cashCollected) }}</span></li>
              <li><span>− Cash refunds</span><span class="pf-num">{{ inr(d.figures.cashRefunded) }}</span></li>
              <li><span>− Cash expenses</span><span class="pf-num">{{ inr(d.figures.expenses.cashExpenses) }}</span></li>
              <li><span>+ Cash in (top-ups)</span><span class="pf-num">{{ inr(d.figures.expenses.cashTopUps) }}</span></li>
              <li class="pf-dc__eq"><span>Expected cash</span><span class="pf-num">{{ inr(expected()) }}</span></li>
            </ul>

            @if (d.isClosed) {
              <ul class="pf-dc__calc">
                <li><span>Counted</span><span class="pf-num">{{ inr(d.countedCash) }}</span></li>
                <li class="pf-dc__eq"><span>Variance</span><span class="pf-num" [class.pf-dc__neg]="(d.variance ?? 0) < 0">{{ signed(d.variance ?? 0) }}</span></li>
              </ul>
              @if (d.note) { <p class="pf-dc__note">{{ d.note }}</p> }
              <p class="pf-dc__hint">Closed{{ d.closedByName ? ' by ' + d.closedByName : '' }}{{ d.closedAt ? ' · ' + when(d.closedAt) : '' }}. The day's expenses are locked.</p>
            } @else {
              @if (d.figures.openingSource === 'none') {
                <div class="pf-field">
                  <label class="pf-field__lbl" for="pf-dc-open">Opening cash (₹)</label>
                  <input id="pf-dc-open" class="pf-input pf-num" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"
                         [value]="openingText()" (input)="openingText.set($any($event.target).value)" />
                  <span class="pf-field__hint">First closing of this cash box — the float it started with.</span>
                </div>
              }
              <div class="pf-field">
                <label class="pf-field__lbl" for="pf-dc-count">Counted cash (₹)</label>
                <input id="pf-dc-count" class="pf-input pf-num pf-dc__count" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"
                       [class.pf-input--error]="countedText().trim() !== '' && counted() === null"
                       [value]="countedText()" (input)="countedText.set($any($event.target).value)" />
              </div>
              @if (counted() !== null) {
                <p class="pf-dc__var pf-num" [class.pf-dc__neg]="variance()! < 0" aria-live="polite">
                  Variance {{ signed(variance()!) }}{{ variance() === 0 ? ' — tallies' : (variance()! < 0 ? ' — short' : ' — excess') }}
                </p>
              }
              <div class="pf-field">
                <label class="pf-field__lbl" for="pf-dc-note">Note</label>
                <textarea id="pf-dc-note" class="pf-input" rows="2" maxlength="512" placeholder="Optional — e.g. ₹10 short, coin change"
                          [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
              </div>
            }
          }
        </div>
        @if (data(); as d) {
          <footer class="pf-card__foot">
            @if (d.isClosed) {
              @if (d.canReopen) {
                <button type="button" class="pf-btn pf-btn--secondary pf-span" [disabled]="busy()" [pfBusy]="busy()" pfBusyLabel="Reopening…" (click)="reopen()">Reopen day</button>
              } @else {
                <p class="pf-dc__hint pf-span">{{ d.lastClosed && d.lastClosed > d.date ? 'A later day is closed — reopen that first.' : 'This day stays closed.' }}</p>
              }
            } @else {
              <button type="button" class="pf-btn pf-btn--primary pf-span" [disabled]="!canClose() || busy()" [pfBusy]="busy()" pfBusyLabel="Closing the day…" (click)="close()">Close day</button>
            }
          </footer>
        }
      </aside>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 0; flex: 1 1 auto; }
    .pf-dc { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; min-height: 0; height: 100%; }
    .pf-dc--narrow { grid-template-columns: minmax(0, 1fr); height: auto; }
    .pf-dc--narrow .pf-dc__side { order: -1; }
    .pf-dc__main, .pf-dc__side { min-height: 0; }
    .pf-dc__state[data-closed='true'] { color: var(--violet-text, #7c3aed); }
    .pf-dc__date { display: flex; align-items: center; gap: 8px; min-width: 200px; }
    .pf-dc__datelbl { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-dc__body { gap: 18px; }
    .pf-dc__section { display: flex; flex-direction: column; gap: 10px; }
    .pf-dc__h { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-dc__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .pf-dc__tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--pf-line); background: var(--glass-bg); min-width: 0; }
    .pf-dc__tile--sum { background: var(--pf-in-tint, var(--glass-bg)); }
    .pf-dc__k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
    .pf-dc__v { font-size: 18px; font-weight: 600; color: var(--text-primary); }
    .pf-dc__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-dc__rows .pf-row { min-height: 44px; }
    .pf-dc__total .pf-row__name { font-weight: 600; }
    .pf-dc__none { margin: 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-dc__calc { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; color: var(--text-secondary); }
    .pf-dc__calc li { display: flex; justify-content: space-between; gap: 12px; }
    .pf-dc__calc .pf-num { color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-dc__eq { padding-top: 8px; border-top: 1px solid var(--pf-line); font-weight: 600; color: var(--text-primary) !important; font-size: 15px; }
    .pf-dc__hint { margin: 0; font-size: 12px; color: var(--text-tertiary); display: block !important; }
    .pf-dc__var { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-dc__neg { color: var(--red-text, #dc2626) !important; }
    .pf-dc__note { margin: 0; font-size: 13px; color: var(--text-secondary); white-space: pre-wrap; }
    @media (max-width: 640px) {
      .pf-dc__date { min-width: 0; width: 100%; }
      .pf-dc__tiles { grid-template-columns: 1fr 1fr; }
      .pf-dc__v { font-size: 16px; }
      .pf-dc .pf-input { font-size: 16px; min-height: 44px; }
    }
  `],
})
export class DayClosingComponent {
  private readonly svc = inject(ExpenseService);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);

  /** The IST day to show (yyyy-MM-dd). */
  readonly date = input.required<string>();
  readonly today = input.required<string>();
  readonly narrow = input(false);
  readonly dateChange = output<string>();
  /** The day was closed / reopened — the host reloads its book. */
  readonly changed = output<void>();

  readonly buckets = ['cash', 'upi', 'card', 'other'] as const;
  readonly data = signal<DayClosing | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly skeleton = spinDelay(computed(() => this.loading() && !this.data()));
  readonly countedText = signal('');
  readonly openingText = signal('');
  readonly note = signal('');

  readonly counted = computed(() => parseRupees(this.countedText()));
  readonly openingEntered = computed(() => parseRupees(this.openingText()));
  readonly openingShown = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return !d.isClosed && d.figures.openingSource === 'none' ? (this.openingEntered() ?? 0) : d.figures.opening;
  });
  readonly expected = computed(() => {
    const d = this.data();
    if (!d) return 0;
    return d.isClosed ? d.figures.expectedCash : expectedWithOpening(d.figures, this.openingEntered());
  });
  readonly variance = computed(() => { const c = this.counted(); return c === null ? null : cashVariance(c, this.expected()); });
  readonly canClose = computed(() => {
    const d = this.data();
    return !!d && !d.isClosed && d.canClose && this.counted() !== null
      && (d.figures.openingSource !== 'none' || this.openingText().trim() === '' || this.openingEntered() !== null);
  });
  readonly refundCount = computed(() => plural((this.data()?.figures.refunds ?? []).reduce((n, r) => n + r.count, 0), 'refund'));
  readonly openingHint = computed(() => {
    const f = this.data()?.figures;
    if (!f) return '';
    switch (f.openingSource) {
      case 'previous_closure': return `Counted cash at the close of ${dayLabel(f.openingFrom ?? '', false)}`;
      case 'entered': return 'Entered at the first closing';
      case 'closure': return 'From the Daily statement closure';
      default: return 'No earlier closing — enter the float below';
    }
  });

  readonly inr = inr;
  readonly plural = plural;
  readonly modeLabel = modeLabel;

  constructor() {
    effect(() => { const d = this.date(); untracked(() => this.load(d)); });
  }

  dayName(ymd: string) { return dayLabel(ymd); }
  when(iso: string) { try { return formatDate(iso, 'd MMM, h:mm a', 'en-US', LAB_TIME_ZONE); } catch { return ''; } }
  signed(n: number) { return (n > 0 ? '+' : n < 0 ? '−' : '') + inr(Math.abs(n)); }

  pick(v: string | null) { if (v && v !== this.date()) this.dateChange.emit(v); }

  load(date: string) {
    this.loading.set(true);
    this.svc.closing(date).subscribe({
      next: d => { this.data.set(d); this.loading.set(false); this.countedText.set(''); this.openingText.set(''); this.note.set(''); },
      error: err => { this.loading.set(false); this.toasts.error(ApiError.from(err).message); },
    });
  }

  async close() {
    const d = this.data();
    const counted = this.counted();
    if (!d || counted === null || this.busy()) return;
    const v = cashVariance(counted, this.expected());
    const ok = await this.dialogs.confirm({
      title: `Close ${dayLabel(d.date)}?`,
      message: `Expected ${inr(this.expected())}, counted ${inr(counted)} (variance ${this.signed(v)}). Every staff member's expenses of this day lock, and the counted cash becomes the next day's opening.`,
      confirmLabel: 'Close day',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const next = await firstValueFrom(this.svc.closeClosing(d.date, {
        countedCash: counted,
        openingBalance: d.figures.openingSource === 'none' ? this.openingEntered() : null,
        note: this.note().trim() || null,
      }));
      this.data.set(next);
      this.toasts.success('Day closed');
      this.changed.emit();
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  async reopen() {
    const d = this.data();
    if (!d || this.busy()) return;
    const ok = await this.dialogs.confirm({
      title: `Reopen ${dayLabel(d.date)}?`,
      message: 'The day\'s expenses can be changed again and the counted cash is cleared. Close it again once it is corrected.',
      confirmLabel: 'Reopen', tone: 'danger',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      this.data.set(await firstValueFrom(this.svc.reopenClosing(d.date)));
      this.toasts.success('Day reopened');
      this.changed.emit();
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
