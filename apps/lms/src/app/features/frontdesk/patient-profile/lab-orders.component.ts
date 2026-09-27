import {
  ChangeDetectionStrategy, Component, Injector, OnDestroy, computed, inject, input, output, signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { buildReportBlobUrl } from '../../../shared/utils/report-blob';
import { PdfCanvasComponent } from './pdf-canvas.component';
import { parseResultSnapshot, savedValueRows } from '../../../shared/utils/result-flag';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { ZoomSourceDirective, ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import {
  filterOrders, orderStatusLabel, orderTests, orderTitle, orderTone, testStatusLabel, testTone,
} from './patient-profile.nd';

interface ResultRow { title: string; value: string; unit?: string; range?: string; flag: 'normal' | 'abnormal' | 'critical'; }

/**
 * Lab orders — the patient's orders as ND list rows (docs/ND-PATTERN.md →
 * "Patient profile"): the tests as the primary line, a quiet tabular meta
 * line, the status as a dot + coloured word and the row action (Repeat)
 * stacked under it. A row ZOOMS into the order in the same card
 * (zoom.runLocal): its tests with their real digital results (parameter ·
 * value · unit · reference · the flag mw saved), Repeat order and the
 * generated report rendered in place. The card header (search + date range)
 * lives in the profile; this list reads them as inputs.
 */
@Component({
  selector: 'pf-lab-orders',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PdfCanvasComponent, ZoomSourceDirective, ZoomTargetDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (openOrder(); as o) {
      <!-- ── ORDER (zoomed in from its row) ─────────────────────────── -->
      <section class="pf-lo-detail" [pfZoomTarget]="[o.id]" aria-label="Order details"
               (keydown.escape)="close()">
        <header class="pf-lo-detail__head">
          <button type="button" class="nd-btn nd-btn--icon pf-lo-detail__back" (click)="close()"
                  aria-label="Back to orders" title="Back to orders">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div class="pf-lo-detail__who">
            <p class="pf-lo-detail__title">{{ title(o) }}</p>
            <p class="pf-lo-row__meta nd-num">
              @if (o.orderNumber) { <span class="pf-lo-mi">{{ o.orderNumber }}</span> }
              <span class="pf-lo-mi">{{ o.createdAt | date:'d MMM y, h:mm a' }}</span>
              <span class="pf-lo-mi">{{ o.refDoctorName || 'Self referral' }}</span>
              @if (o.totalAmount != null) { <span class="pf-lo-mi">₹{{ o.totalAmount | number:'1.0-0' }}</span> }
            </p>
          </div>
          <span class="pf-lo-status" [attr.data-tone]="tone(o.status)"><span class="pf-lo-dot" aria-hidden="true"></span>{{ statusLabel(o.status) }}</span>
        </header>

        <div class="pf-lo-detail__acts">
          <button type="button" class="nd-btn nd-btn--secondary pf-lo-act pf-lo-act--repeat" (click)="repeat(o)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
            Repeat order
          </button>
          <button type="button" class="nd-btn nd-btn--secondary pf-lo-act pf-lo-act--report" (click)="toggleReport(o)"
                  [attr.aria-expanded]="!!showReport()[o.id]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>
            {{ showReport()[o.id] ? 'Hide report' : 'View report' }}
          </button>
        </div>

        <h3 class="pf-lo-sec">Tests</h3>
        <ul class="pf-lo-tests" role="list">
          @for (t of tests(o); track t.id) {
            <li class="pf-lo-test">
              <div class="pf-lo-test__head">
                <span class="pf-lo-test__name">{{ t.name || 'Test' }}
                  @if (t.test?.code) { <span class="pf-lo-test__code nd-num">{{ t.test?.code }}</span> }
                </span>
                <span class="pf-lo-status" [attr.data-tone]="testTone(t.status)"><span class="pf-lo-dot" aria-hidden="true"></span>{{ testLabel(t.status) }}</span>
              </div>
              @if (resultRows(t); as rows) {
                @if (rows.length) {
                  <div class="pf-lo-res" role="table" [attr.aria-label]="(t.name || 'Test') + ' results'">
                    <div class="pf-lo-res__row pf-lo-res__row--head" role="row">
                      <span role="columnheader">Parameter</span><span role="columnheader">Result</span><span role="columnheader">Reference</span>
                    </div>
                    @for (r of rows; track r.title) {
                      <div class="pf-lo-res__row" role="row" [attr.data-flag]="r.flag">
                        <span class="pf-lo-res__name" role="cell">{{ r.title }}</span>
                        <span class="pf-lo-res__val nd-num" role="cell">{{ r.value }}@if (r.unit) {<span class="pf-lo-res__unit">{{ r.unit }}</span>}
                          @if (r.flag !== 'normal') {
                            <span class="pf-lo-res__flag">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>
                              {{ r.flag === 'critical' ? 'Critical' : 'Abnormal' }}
                            </span>
                          }
                        </span>
                        <span class="pf-lo-res__ref nd-num" role="cell">{{ r.range || '—' }}</span>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="pf-lo-pending">Results not entered yet.</p>
                }
              }
            </li>
          }
        </ul>

        @if (showReport()[o.id]) {
          <h3 class="pf-lo-sec">Report</h3>
          <div class="pf-lo-report">
            @if (reportBusy() === o.id) {
              <div class="pf-lo-report__skel" aria-hidden="true">
                <span class="pf-lo-skel" style="width: 42%"></span>
                <span class="pf-lo-skel"></span><span class="pf-lo-skel"></span><span class="pf-lo-skel" style="width: 70%"></span>
              </div>
            } @else if (reportUrl()[o.id]; as u) {
              <pf-pdf-canvas [src]="u"></pf-pdf-canvas>
            } @else if (reportFailed()[o.id]) {
              <div class="nd-empty nd-empty--compact" role="alert">
                <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 11v4"/><path d="M12 18h.01"/></svg></span>
                <p class="nd-empty__title">Couldn’t render this report</p>
                <p class="nd-empty__body">The lab’s report design couldn’t be loaded. Close and open the report again in a moment.</p>
              </div>
            } @else {
              <div class="nd-empty nd-empty--compact">
                <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>
                <p class="nd-empty__title">No report yet</p>
                <p class="nd-empty__body">No report has been generated for this order yet.</p>
              </div>
            }
          </div>
        }
      </section>
    } @else if (filtered().length === 0) {
      @if ((orders() ?? []).length === 0) {
        <div class="nd-empty">
          <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6.5L4.5 17a3 3 0 0 0 2.7 4.5h9.6a3 3 0 0 0 2.7-4.5L15 8.5V2"/><path d="M8 2h8"/><path d="M7 14h10"/></svg></span>
          <p class="nd-empty__title">No orders yet</p>
          <p class="nd-empty__body">This patient's lab orders, results and reports show up here.</p>
        </div>
      } @else {
        <div class="nd-empty">
          <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
          <p class="nd-empty__title">No orders match</p>
          <p class="nd-empty__body">Try another test name or a wider date range.</p>
          <button type="button" class="nd-btn nd-btn--secondary nd-empty__action" (click)="clearFilters.emit()">Clear filters</button>
        </div>
      }
    } @else {
      <!-- ── ORDERS: one row per order ─────────────────────────────── -->
      <ul class="pf-lo-list" role="list" aria-label="Orders">
        @for (o of filtered(); track o.id; let i = $index) {
          <li class="pf-lo-li" [style.--i]="i < 12 ? i : 12">
            <div class="pf-lo-row" role="button" tabindex="0" [pfZoomSource]="[o.id]"
                 [attr.aria-label]="'Open order ' + (o.orderNumber || '') + ' · ' + title(o)"
                 (click)="open(o)" (keydown)="onRowKey($event, o)">
              <div class="pf-lo-row__body">
                <p class="pf-lo-row__name">{{ title(o) }}</p>
                <p class="pf-lo-row__meta nd-num">
                  @if (o.orderNumber) { <span class="pf-lo-mi">{{ o.orderNumber }}</span> }
                  <span class="pf-lo-mi">{{ o.createdAt | date:'d MMM y, h:mm a' }}</span>
                  <span class="pf-lo-mi">{{ countLabel(o) }}</span>
                  <span class="pf-lo-mi">{{ o.refDoctorName || 'Self referral' }}</span>
                  @if (o.totalAmount != null) { <span class="pf-lo-mi">₹{{ o.totalAmount | number:'1.0-0' }}</span> }
                </p>
              </div>
              <span class="pf-lo-status" [attr.data-tone]="tone(o.status)"><span class="pf-lo-dot" aria-hidden="true"></span>{{ statusLabel(o.status) }}</span>
              <div class="pf-lo-row__acts" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
                <button type="button" class="nd-rowact pf-lo-repeat" [class.nd-rowact--icon]="!web()"
                        (click)="repeat(o)" aria-label="Repeat order" title="Repeat order">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
                  <span class="nd-rowact__t">Repeat</span>
                </button>
              </div>
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-width: 0; container-type: inline-size; }

    /* ── Rows: the Frontdesk list-row language (ND §6 "List rows") ── */
    .pf-lo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-lo-li { animation: pf-lo-in var(--nd-dur, 320ms) var(--nd-spring) both; animation-delay: calc(var(--i, 0) * 18ms); }
    @keyframes pf-lo-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .pf-lo-row {
      display: grid; grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'body status' 'body acts';
      align-items: center; column-gap: 12px; row-gap: 6px;
      min-height: 64px; padding: 10px 12px 10px 14px;
      border-radius: var(--nd-radius, 12px); border: 1px solid var(--glass-border); background: var(--glass-bg);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      color: var(--text-primary); cursor: pointer;
      transition: border-color var(--nd-dur-fast) ease, background var(--nd-dur-fast) ease;
    }
    .pf-lo-row:hover { border-color: var(--nd-sel-border); }
    .pf-lo-row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-lo-row__body { grid-area: body; min-width: 0; }
    .pf-lo-row__name { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--text-primary); white-space: normal; overflow-wrap: anywhere; }
    .pf-lo-row__meta { display: flex; flex-wrap: wrap; margin: 3px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--text-secondary); }
    .pf-lo-mi + .pf-lo-mi::before { content: '·'; margin: 0 6px; color: var(--text-muted, var(--text-tertiary)); }
    .pf-lo-row__acts { grid-area: acts; justify-self: end; align-self: start; display: flex; gap: 6px; }

    /* Status = a 7px dot + a coloured word (no chip) — the Frontdesk tones. */
    .pf-lo-status {
      --pf-tone: var(--amber-text);
      grid-area: status; justify-self: end; align-self: end;
      display: inline-flex; align-items: center; gap: 6px; flex: none;
      font-size: 12.5px; font-weight: 500; line-height: 16px; white-space: nowrap;
      color: color-mix(in srgb, var(--pf-tone) 70%, var(--text-primary));
    }
    .pf-lo-status[data-tone='green'] { --pf-tone: var(--green-text); }
    .pf-lo-status[data-tone='blue'] { --pf-tone: var(--blue-text); }
    .pf-lo-status[data-tone='red'] { --pf-tone: var(--red-text); }
    .pf-lo-status[data-tone='violet'] { --pf-tone: var(--violet-text); }
    .pf-lo-dot { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--pf-tone); }

    /* Narrow list (phones / squeezed): status left + action right on line 2. */
    @container (max-width: 520px) {
      .pf-lo-row { grid-template-areas: 'body body' 'status acts'; }
      .pf-lo-row .pf-lo-status { justify-self: start; align-self: center; font-size: 13px; }
      .pf-lo-row__acts { align-self: center; }
      .pf-lo-row__acts .nd-rowact { min-height: 44px; }
    }

    /* ── Order detail (zoomed in) ─────────────────────────────────── */
    .pf-lo-detail { display: flex; flex-direction: column; gap: 12px; min-width: 0; border-radius: var(--nd-radius, 12px); background: var(--nd-card-bg); }
    .pf-lo-detail__head { display: flex; align-items: flex-start; gap: 10px; }
    .pf-lo-detail__back { width: 36px !important; height: 36px; min-height: 36px; flex: none; }
    .pf-lo-detail__who { flex: 1 1 auto; min-width: 0; }
    .pf-lo-detail__title { margin: 6px 0 0; font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-lo-detail__head .pf-lo-status { margin-top: 8px; }
    .pf-lo-detail__acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-lo-act { gap: 6px; }
    .pf-lo-sec { margin: 6px 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }

    .pf-lo-tests { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-lo-test { padding: 10px 12px; border-radius: var(--nd-radius-sm, 10px); border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .pf-lo-test__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .pf-lo-test__name { min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-lo-test__code { margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--text-tertiary); }
    .pf-lo-test .pf-lo-status { align-self: auto; }
    .pf-lo-pending { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }

    .pf-lo-res { border: 1px solid var(--nd-line); border-radius: 10px; overflow: hidden; }
    .pf-lo-res__row { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 8px; padding: 7px 12px; font-size: 13px; align-items: center; }
    .pf-lo-res__row + .pf-lo-res__row { border-top: 1px solid var(--nd-line); }
    .pf-lo-res__row--head { background: var(--nd-chip-bg); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-lo-res__name { color: var(--text-secondary); overflow-wrap: anywhere; }
    .pf-lo-res__val { font-weight: 600; color: var(--text-primary); display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; }
    .pf-lo-res__unit { font-weight: 400; font-size: 12px; color: var(--text-tertiary); margin-left: 4px; }
    .pf-lo-res__ref { font-size: 12.5px; color: var(--text-tertiary); white-space: pre-line; }
    /* The only colour here is a real flag: amber abnormal, red critical. */
    .pf-lo-res__flag { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 600; }
    .pf-lo-res__row[data-flag='abnormal'] .pf-lo-res__val { color: color-mix(in srgb, var(--amber-text) 75%, var(--text-primary)); }
    .pf-lo-res__row[data-flag='critical'] .pf-lo-res__val { color: color-mix(in srgb, var(--red-text) 80%, var(--text-primary)); }

    .pf-lo-report { padding: 10px; border: 1px solid var(--nd-line); border-radius: 12px; background: color-mix(in srgb, var(--text-primary) 3%, var(--nd-card-bg)); display: flex; justify-content: center; }
    .pf-lo-report pf-pdf-canvas { width: 100%; max-width: 820px; }
    .pf-lo-report__skel { width: 100%; max-width: 820px; aspect-ratio: 1 / 1.1; display: flex; flex-direction: column; gap: 12px; padding: 24px; border-radius: 8px; background: var(--nd-card-bg); border: 1px solid var(--nd-line); }
    .pf-lo-skel { display: block; height: 10px; width: 100%; border-radius: 6px; background: var(--nd-chip-bg); }

    @media (max-width: 640px) {
      .pf-lo-res__row { grid-template-columns: 1.3fr 1fr; }
      .pf-lo-res__ref { display: none; }
      .pf-lo-act { flex: 1 1 auto; min-height: 44px; }
      .pf-lo-detail__back { width: 44px !important; height: 44px; min-height: 44px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-lo-li { animation: none !important; }
      .pf-lo-row { transition: none; }
    }
  `],
})
export class LabOrdersComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly zoom = inject(ZoomTransitionService);

  readonly orders = input<Order[]>([]);
  readonly patientId = input<string>('');
  /** Card-header search (tests / order number / doctor) and date range. */
  readonly query = input<string>('');
  readonly fromDate = input<string>('');
  readonly toDate = input<string>('');
  /** "No orders match" → the profile clears its search + range. */
  readonly clearFilters = output<void>();
  /** An order opened / closed (the profile hides its list controls). */
  readonly detailChange = output<string | null>();

  /** Order ids whose report exists but could not be rendered (design did not load). */
  readonly reportFailed = signal<Record<string, boolean>>({});
  /** Web = text row actions; touch = 44px icons (ND §1 row actions). */
  protected readonly web = webPointerSignal();

  readonly openId = signal<string | null>(null);
  readonly showReport = signal<Record<string, boolean>>({});
  readonly reportUrl = signal<Record<string, string>>({});
  readonly reportBusy = signal<string | null>(null);
  private readonly blobUrls = new Set<string>();

  readonly filtered = computed<Order[]>(() => filterOrders(this.orders() ?? [], this.query(), this.fromDate(), this.toDate()));
  readonly openOrder = computed<Order | null>(() => {
    const id = this.openId();
    return id ? (this.orders() ?? []).find(o => o.id === id) ?? null : null;
  });

  protected readonly title = orderTitle;
  protected readonly statusLabel = orderStatusLabel;
  protected readonly tone = orderTone;
  protected readonly testLabel = testStatusLabel;
  protected readonly testTone = testTone;
  tests(o: Order): OrderTest[] { return orderTests(o); }
  countLabel(o: Order): string { const n = orderTests(o).length; return `${n} test${n === 1 ? '' : 's'}`; }

  /** Row → the order, zoomed in within the card. */
  open(o: Order): void {
    this.zoom.runLocal('in', () => { this.openId.set(o.id); this.detailChange.emit(o.id); });
  }
  onRowKey(ev: KeyboardEvent, o: Order): void {
    if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    this.open(o);
  }
  /** Back to the list, zoomed out into the row. */
  close(): void {
    if (!this.openId()) return;
    this.zoom.runLocal('out', () => { this.openId.set(null); this.detailChange.emit(null); });
  }

  /** Parse a test's entered values × its parameter defs → per-parameter rows,
   *  flagged with the verdict mw SAVED with the result (no browser recompute). */
  resultRows(t: OrderTest): ResultRow[] {
    const snap = parseResultSnapshot(t.currentResult);
    if (!snap?.values) return [];
    const show = (v: unknown) => v === undefined || v === null || v === '' ? '—' : String(v);
    const rows = savedValueRows(t.currentResult, t.test?.parameters);
    if (rows.length) {
      return rows.map(r => ({ title: r.title, value: show(r.value), unit: r.unit, range: r.range, flag: r.flag }));
    }
    // Fallback: no parameter defs available — show the raw entered values.
    return Object.entries(snap.values).map(([k, v]) => ({
      title: k, value: show(v), flag: 'normal' as const,
    }));
  }

  repeat(o: Order) {
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: this.patientId(), fromOrderId: o.id } });
  }

  async toggleReport(o: Order) {
    const show = !this.showReport()[o.id];
    this.showReport.update(m => ({ ...m, [o.id]: show }));
    if (show && !this.reportUrl()[o.id] && this.reportBusy() !== o.id) {
      this.reportBusy.set(o.id);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rep = await firstValueFrom(this.api.get<any>(`/api/reports/by-order/${o.id}`)).catch(() => null);
        if (rep) {
          const url = await buildReportBlobUrl(rep, this.api, this.injector);
          if (url) { this.blobUrls.add(url); this.reportUrl.update(m => ({ ...m, [o.id]: url })); }
          // Never a silent "No report yet" (or a default-design render) when
          // the report exists but its design couldn't load.
          this.reportFailed.update(m => ({ ...m, [o.id]: !url }));
        }
      } finally { this.reportBusy.set(null); }
    }
  }

  ngOnDestroy() { for (const u of this.blobUrls) { try { URL.revokeObjectURL(u); } catch { /* */ } } }
}
