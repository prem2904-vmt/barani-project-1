import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnDestroy, OnInit,
  computed, inject, signal, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { BillingEventsService } from '../../core/services/billing-events.service';
import { ScanService } from '../../core/services/scan.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkEventsService } from '../../core/services/work-events.service';
import { ZoomTransitionService } from '../../core/navigation/zoom-transition';
import { ZoomSourceDirective, ZoomTargetDirective } from '../../core/navigation/zoom.directive';
import { ApiError } from '../../shared/models/api-response.model';
import { Bill } from '../../shared/models/bill.model';
import { payBillFromWallet } from '../../shared/utils/wallet-payment';
import { billRoundOff } from '../../shared/utils/bill-math';
import { Order } from '../../shared/models/order.model';
import { Patient, formatPatientMeta, patientDisplayName } from '../../shared/models/patient.model';
import { collectsAtBillingCounter } from '../../shared/models/process-workflow.model';
import { CurrencyInrPipe } from '../../shared/pipes/currency-inr.pipe';
import { plural } from '../../shared/utils/plural';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { CollectBandButtonComponent } from '../../shared/components/collect-band-button/collect-band-button.component';
import { ScanIconComponent } from '../../shared/components/icons/scan-icon.component';
import { BarcodeScannerModalComponent } from '../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { NdDateComponent } from '../../shared/components/nd-date/nd-date.component';
import { BusyDirective } from '../../shared/directives/busy.directive';
import { SkeletonCardComponent, SkeletonRowsComponent, SkeletonTableComponent } from '../../shared/primitives/skeleton-kit.component';
import { heldFlag } from '../../shared/utils/min-duration';
import {
  InlinePaymentPanelComponent, InlinePaymentResult,
} from '../frontdesk/order-create/inline-payment-panel.component';
import { generateInvoicePdf, invoiceTemplateFieldsFrom, loadImageDataUrl, invoiceGstinFrom } from '../frontdesk/billing/invoice-pdf';
import { environment } from '../../../environments/environment';
import { phoneMatches } from '../../shared/utils/indian-phone';
import { labToday } from '../../shared/utils/lab-clock';

/** One row of GET /api/billing/outstanding — a bill with money still moving
 *  (balance > 0 → patient owes; balance < 0 → lab owes a refund). */
export interface OutstandingRow {
  billId: string;
  orderId: string;
  patientId?: string;
  patientName: string;
  totalPayable: number;
  totalPaid: number;
  balance: number;
  status: string;
  createdAt: string;
  /** Deferred at the counter (POST /api/billing/{id}/pay-later): still due,
   *  but no longer "waiting to pay" in the queue. */
  payLater?: boolean;
}

interface ReconcileModeRow { mode: string; count: number; total: number; }

/** GET /api/billing/reconcile?date=YYYY-MM-DD — day-end closeout totals. */
export interface ReconcileSummary {
  date: string;
  payments: ReconcileModeRow[];
  refunds: ReconcileModeRow[];
  totalCollected: number;
  totalRefunded: number;
  net: number;
}

/** One row of the pill's grouped dropdown. `index` is its position across
 *  BOTH groups, so ↑/↓ walk Patients then Orders & invoices. */
export interface DropRow {
  key: string;
  index: number;
  kind: 'patient' | 'order';
  title: string;
  meta: string;
  amount?: string;
  patient?: Patient;
  orderId?: string;
}

/** One patient waiting at the counter (the LEFT queue). */
export interface QueueRow {
  orderId: string;
  /** Null for an order registered without a bill yet (billed on payment). */
  billId: string | null;
  patientId?: string;
  name: string;
  /** Order number (the token the patient carries), when known. */
  orderLabel: string | null;
  /** Tests on the order, once the order has been read. */
  tests: number | null;
  /** What they still owe. */
  amount: number;
  /** When they started waiting (order registered, else bill raised). */
  since: string;
  unbilled: boolean;
  phone?: string;
  mrn?: string;
}

/** The compact success state after a payment — or after Pay later. */
export interface PaidState {
  orderId: string;
  name: string;
  /** Collected now (for Pay later: the advance, often 0). */
  amount: number;
  mode: string;
  bill: Bill | null;
  /** Pay later: the bill is saved with this balance still due. */
  later?: boolean;
  due?: number;
  /** Pay later with an advance: how the advance was tendered. */
  advanceMode?: string;
}

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Vendor', vendor: 'Vendor', split: 'Split',
  later: 'Pay later', cheque: 'Cheque', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', online: 'Online',
};

/** Wait-time clock tick ("12 min"). Local only — no request. The queue itself
 *  refreshes on live work events (WorkEventsService: bill paid / pay later /
 *  order created …), with the service's slow poll as the fallback while the
 *  socket is down. Replaces the old 20 s network poll. */
export const QUEUE_POLL_MS = 30_000;
/** At most this many older balances are read for their order details. */
const ENRICH_CAP = 40;

function mq(query: string, ref: DestroyRef, on: (m: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const m = window.matchMedia(query);
  const fn = (e: MediaQueryListEvent) => on(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return !!m.matches;
}

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function decimal2(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 100) / 100;
}

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/** Distinct tests on an order (a test split across tubes counts once). */
export function orderTestCount(o: Order | null | undefined): number {
  const seen = new Set<string>();
  for (const s of o?.samples ?? []) for (const t of s.tests ?? []) seen.add(t.id || t.name);
  return seen.size;
}

/** Quiet "waiting since" label: just now · 12 min · 2 h 5 min · 3 d. */
export function waitingLabel(iso: string | null | undefined, now: number): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/**
 * Billing counter — for branches in `billing_mode = separate_counter`
 * (ND-PATTERN §17).
 *
 *   • Band: back · tenant; the pill is ONE unified search (patients AND
 *     orders / invoices, grouped type-ahead) with the scan icon inside. Typing
 *     also filters the queue; Enter on an exact order / invoice ID opens it.
 *   • LEFT card QUEUE: the patients waiting to pay in this branch (bills with a
 *     balance due + today's orders not billed yet), oldest first, refreshed.
 *   • MAIN card BILLING: the picked patient's cart — items, discount, Payable /
 *     Paid / Balance — and the payment taken RIGHT HERE on Order & Payments'
 *     inline payment panel. ONE primary: "Collect ₹X". After payment a compact
 *     success state (print receipt, Next patient). "Collect sample" only when
 *     the workflow puts collection at this counter.
 *   • RIGHT card MONEY: balances due / refunds owed and the day-end summary,
 *     collapsible. ≤900px: one card at a time (Billing · Money switch); the
 *     queue is full screen and a pick zooms the cart in, back returns.
 */
@Component({
  selector: 'pf-billing-counter',
  standalone: true,
  imports: [
    DatePipe, NgTemplateOutlet, CurrencyInrPipe,
    HeroBandComponent, CollectBandButtonComponent, ScanIconComponent, BarcodeScannerModalComponent, NdDateComponent,
    InlinePaymentPanelComponent, ZoomSourceDirective, ZoomTargetDirective,
    BusyDirective, SkeletonRowsComponent, SkeletonCardComponent, SkeletonTableComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './billing-counter.component.html',
  styleUrl: './billing-counter.component.scss',
})
export class BillingCounterComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly process = inject(ProcessWorkflowService, { optional: true });
  private readonly labCfg = inject(BranchLabConfigService, { optional: true });
  private readonly billingEvents = inject(BillingEventsService, { optional: true });
  private readonly zoom = inject(ZoomTransitionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly work = inject(WorkEventsService);
  protected readonly scan = inject(ScanService);

  protected readonly plural = plural;
  protected readonly today = BillingCounterComponent.todayIso();

  // ── Layout ────────────────────────────────────────────────────────────
  /** ≤900px: one column — the pill's segmented switch picks the card. */
  readonly narrow = signal(mq('(max-width: 900px)', this.destroyRef, m => this.narrow?.set(m)));
  readonly phone = signal(mq('(max-width: 640px)', this.destroyRef, m => this.phone?.set(m)));
  /** Narrow widths: which card is showing. */
  readonly pane = signal<'bill' | 'money'>('bill');
  readonly moneyCollapsed = signal(readFlag(this.collapseKey()));
  toggleMoney() {
    const next = !this.moneyCollapsed();
    this.moneyCollapsed.set(next);
    try { localStorage.setItem(this.collapseKey(), next ? '1' : '0'); } catch { /* private mode */ }
  }
  private collapseKey(): string {
    let uid = '';
    try { uid = this.auth?.user()?.id ?? ''; } catch { /* no session */ }
    return 'pf:bc:money-collapsed:' + (uid || 'anon');
  }

  readonly placeholder = computed(() => this.phone()
    ? 'Patient, order or invoice ID'
    : 'Search patient, phone, MRN, order or invoice ID');

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  readonly now = signal(Date.now());

  ngOnInit() {
    try { this.process?.loadActive(); } catch { /* nav falls back */ }
    try { this.labCfg?.ensureLoaded(); } catch { /* gate hint is optional */ }
    this.loadOutstanding();
    this.loadToday();
    this.loadReconcile();
    this.pollTimer = setInterval(() => this.now.set(Date.now()), QUEUE_POLL_MS);
    this.work.on('billing', 'frontdesk')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.poll());
  }

  ngOnDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.blurTimer) clearTimeout(this.blurTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Live refresh of the queue + balances — lists only; the bill being
   *  settled in the BILLING card is never reloaded from here. */
  poll() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this.now.set(Date.now());
    this.loadOutstanding(true);
    this.loadToday();
  }

  // ── Workflow: is sample collection at THIS counter? ───────────────────
  /** True only when the active workflow places `sample_collection` in the
   *  same menu as `billing` (Process builder). Otherwise the paid patient
   *  goes on to the collection queue and no "Collect sample" is offered. */
  readonly collectsHere = computed(() => collectsAtBillingCounter(this.process?.active() ?? null));
  /** Band "Collect" context: the selected patient's order (or the one just
   *  paid); none → the general collection queue. */
  readonly collectOrderId = computed(() => this.selectedOrderId() ?? this.paid()?.orderId ?? null);

  // ── Outstanding balances / refunds owed ───────────────────────────────
  private readonly _due = signal<OutstandingRow[]>([]);
  private readonly _refundsOwed = signal<OutstandingRow[]>([]);
  protected readonly loadingOutstanding = signal(false);
  /** Skeleton flag for the queue / balances (held so it never flashes). */
  protected readonly outstandingSkel = heldFlag(this.loadingOutstanding);
  private outstandingLoaded = false;
  /** Balances due — a balance deferred here this session reads as Pay later
   *  even before the server's flag comes back. */
  readonly due = computed<OutstandingRow[]>(() => {
    const later = this._laterIds();
    return later.size ? this._due().map(r => !r.payLater && later.has(r.orderId) ? { ...r, payLater: true } : r) : this._due();
  });
  readonly refundsOwed = this._refundsOwed.asReadonly();
  readonly moneyCount = computed(() => this._due().length + this._refundsOwed().length);

  private loadOutstanding(quiet = false) {
    if (!quiet) this.loadingOutstanding.set(true);
    this.api.get<{ due: OutstandingRow[]; refundsOwed: OutstandingRow[] }>('/api/billing/outstanding').subscribe({
      next: res => {
        this._due.set(res?.due ?? []);
        this._refundsOwed.set(res?.refundsOwed ?? []);
        this.loadingOutstanding.set(false);
        this.outstandingLoaded = true;
        this.prunePaid();
        this.enrich();
      },
      error: () => {
        this.loadingOutstanding.set(false);
        if (!quiet) this.toasts.error('Could not load outstanding balances');
      }
    });
  }

  private outstandingFor(orderId: string | null): OutstandingRow | null {
    if (!orderId) return null;
    return this._due().find(r => r.orderId === orderId)
      ?? this._refundsOwed().find(r => r.orderId === orderId) ?? null;
  }

  /** Tap a balance → open that order in the BILLING card. */
  openOutstanding(r: OutstandingRow) {
    this.openOrder(r.orderId);
  }

  /** Refund rows carry a negative balance — render the amount owed back. */
  refundAmount(r: OutstandingRow): number { return Math.abs(r.balance); }
  absAmount(n: number | null | undefined): number { return Math.abs(n ?? 0); }

  // ── The queue: patients waiting to pay ────────────────────────────────
  /** Today's branch orders (GET /api/orders/today, annotated with billStatus)
   *  — the source of order number / tests for today's rows and of orders
   *  registered without a bill yet. */
  private readonly _today = signal<Order[]>([]);
  /** Orders read one by one for older balances (not in today's feed). */
  private readonly _orderInfo = signal<Record<string, Order>>({});
  private readonly fetching = new Set<string>();
  /** Paid at this counter this session — kept off the queue even if a poll
   *  lands before the server's outstanding list catches up. */
  private readonly _paidIds = signal<ReadonlySet<string>>(new Set());
  /** Deferred (Pay later) at this counter this session — off the queue at
   *  once, still listed in MONEY's balances due. The server's `payLater`
   *  flag keeps them off for every cashier after the next refresh. */
  private readonly _laterIds = signal<ReadonlySet<string>>(new Set());

  private loadToday() {
    // Summary view: the counter reads statuses + billing, never line results.
    this.api.get<Order[]>('/api/orders/today?view=summary').subscribe({
      next: list => { this._today.set(list ?? []); this.enrich(); },
      error: () => { /* no view_order: the queue still has every bill due */ },
    });
  }

  private orderById(id: string): Order | undefined {
    return this._orderInfo()[id] ?? this._today().find(o => o.id === id);
  }

  /** Read the order details (number, tests) for balances not in today's feed. */
  private enrich() {
    if (!this.outstandingLoaded) return;
    const today = new Set(this._today().map(o => o.id));
    const info = this._orderInfo();
    const missing = [...this._due()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .filter(r => !today.has(r.orderId) && !info[r.orderId] && !this.fetching.has(r.orderId))
      .slice(0, ENRICH_CAP);
    for (const r of missing) {
      this.fetching.add(r.orderId);
      this.api.get<Order>(`/api/orders/${r.orderId}`).subscribe({
        next: o => {
          this.fetching.delete(r.orderId);
          if (o) this._orderInfo.update(m => ({ ...m, [r.orderId]: o }));
        },
        error: () => this.fetching.delete(r.orderId),
      });
    }
  }

  /** Every patient waiting to pay, OLDEST first. */
  readonly queue = computed<QueueRow[]>(() => {
    const paid = this._paidIds();
    const later = this._laterIds();
    const rows: QueueRow[] = [];
    const seen = new Set<string>();
    for (const r of this._due()) {
      if (paid.has(r.orderId) || seen.has(r.orderId)) continue;
      // Pay later: the balance is due, but the patient isn't in the line.
      if (r.payLater || later.has(r.orderId)) { seen.add(r.orderId); continue; }
      seen.add(r.orderId);
      const o = this.orderById(r.orderId);
      rows.push({
        orderId: r.orderId, billId: r.billId, patientId: r.patientId,
        name: r.patientName?.trim() || patientDisplayName(o?.patient) || 'Unnamed patient',
        orderLabel: o?.orderNumber || null,
        tests: o ? orderTestCount(o) : null,
        amount: r.balance,
        since: o?.createdAt || r.createdAt,
        unbilled: false,
        phone: o?.patient?.phone, mrn: o?.patient?.mrn,
      });
    }
    for (const o of this._today()) {
      if (seen.has(o.id) || paid.has(o.id) || later.has(o.id) || o.billStatus !== 'unbilled') continue;
      if (o.status === 'cancelled' || o.status === 'draft') continue;
      seen.add(o.id);
      rows.push({
        orderId: o.id, billId: null, patientId: o.patientId,
        name: patientDisplayName(o.patient) || 'Unnamed patient',
        orderLabel: o.orderNumber || null,
        tests: orderTestCount(o),
        amount: o.totalAmount ?? 0,
        since: o.createdAt,
        unbilled: true,
        phone: o.patient?.phone, mrn: o.patient?.mrn,
      });
    }
    return rows.sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime());
  });

  /** The pill filters the queue as you type (name, phone, MRN, order no.). */
  readonly filteredQueue = computed<QueueRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.queue();
    if (!q) return all;
    const digits = q.replace(/\D/g, '');
    return all.filter(r =>
      r.name.toLowerCase().includes(q)
      || (r.orderLabel ?? '').toLowerCase().includes(q)
      || (r.mrn ?? '').toLowerCase().includes(q)
      || phoneMatches(r.phone, digits)   // last 10 digits for a full number, else partial
      || r.orderId.toLowerCase().startsWith(q));
  });

  waiting(r: QueueRow): string { return waitingLabel(r.since, this.now()); }

  /** Pick a patient in the queue → their cart in the main card. On narrow
   *  widths the list is full screen, so the cart zooms in from the row. */
  selectRow(r: QueueRow) {
    const open = () => this.openOrder(r.orderId);
    if (this.narrow()) this.zoom.runLocal('in', open);
    else { this.zoom.disarm(); open(); }
  }

  /** Narrow: back from the cart / patient to the queue (reverses the zoom). */
  backToQueue() {
    const shut = () => this.clearSelection();
    if (this.narrow()) this.zoom.runLocal('out', shut); else shut();
  }

  private markPaid(orderId: string) {
    this._paidIds.update(s => new Set([...s, orderId]));
    this._due.update(list => list.filter(r => r.orderId !== orderId));
  }

  /** Pay later: keep the balance in MONEY (flagged) but off the queue. */
  private markLater(orderId: string, bill: Bill, name: string) {
    this._laterIds.update(s => new Set([...s, orderId]));
    this._paidIds.update(s => { const n = new Set(s); n.delete(orderId); return n; });
    const row: OutstandingRow = {
      billId: bill.id, orderId, patientId: bill.patientId, patientName: name,
      totalPayable: bill.totalPayable, totalPaid: bill.totalPaid, balance: bill.balance,
      status: bill.status, createdAt: bill.createdAt || new Date().toISOString(), payLater: true,
    };
    this._due.update(list => list.some(r => r.orderId === orderId)
      ? list.map(r => r.orderId === orderId ? { ...r, ...row, patientName: r.patientName || name, createdAt: r.createdAt } : r)
      : [row, ...list]);
  }

  /** Forget session-paid / deferred ids the server no longer lists as due. */
  private prunePaid() {
    const still = new Set(this._due().map(r => r.orderId));
    const today = new Set(this._today().filter(o => o.billStatus === 'unbilled').map(o => o.id));
    for (const sig of [this._paidIds, this._laterIds]) {
      const ids = sig();
      if (!ids.size) continue;
      const next = new Set([...ids].filter(id => still.has(id) || today.has(id)));
      if (next.size !== ids.size) sig.set(next);
    }
  }

  // ── Day-end reconciliation ────────────────────────────────────────────
  protected readonly reconcileDate = signal(BillingCounterComponent.todayIso());
  private readonly _reconcile = signal<ReconcileSummary | null>(null);
  protected readonly loadingReconcile = signal(false);
  protected readonly reconcileSkel = heldFlag(this.loadingReconcile);
  readonly reconcile = this._reconcile.asReadonly();

  /** Today's business date for the day-end reconcile — strictly IST. */
  static todayIso(): string {
    return labToday();
  }

  setReconcileDate(date: string | null) {
    if (!date || date === this.reconcileDate()) return;
    this.reconcileDate.set(date);
    this.loadReconcile();
  }

  private loadReconcile() {
    this.loadingReconcile.set(true);
    this.api.get<ReconcileSummary>(`/api/billing/reconcile?date=${encodeURIComponent(this.reconcileDate())}`).subscribe({
      next: res => { this._reconcile.set(res ?? null); this.loadingReconcile.set(false); },
      error: () => {
        this._reconcile.set(null);
        this.loadingReconcile.set(false);
        this.toasts.error('Could not load the day-end summary');
      }
    });
  }

  /** "cash" → "Cash", "upi" → "UPI"; anything else title-cased. */
  modeLabel(mode: string | null | undefined): string {
    const m = (mode ?? '').trim();
    if (!m) return 'Other';
    return MODE_LABELS[m.toLowerCase()]
      ?? m.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── Unified search (the pill) ─────────────────────────────────────────
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly pill = viewChild<ElementRef<HTMLElement>>('pill');
  readonly query = signal('');
  private readonly _patients = signal<Patient[]>([]);
  private readonly _orderHits = signal<Array<{ orderId: string; title: string; meta: string; amount?: string }>>([]);
  readonly searching = signal(false);
  readonly resolving = signal(false);
  readonly focused = signal(false);
  readonly highlight = signal(-1);
  readonly dropBox = signal<{ left: number; top: number; width: number; maxH: number } | null>(null);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  readonly dropOpen = computed(() => this.focused() && this.query().trim().length > 0);

  /** Codes that look like an order / invoice ID (a digit, or a URL / token). */
  idLike(q: string): boolean {
    const t = (q ?? '').trim();
    return t.length >= 3 && (/\d/.test(t) || t.includes('/'));
  }

  readonly patientRows = computed<DropRow[]>(() =>
    this._patients().slice(0, 8).map((p, i) => ({
      key: 'p:' + p.id, index: i, kind: 'patient' as const,
      title: patientDisplayName(p),
      meta: [formatPatientMeta(p), p.phone].filter(Boolean).join(' · '),
      patient: p,
    })));

  /** Orders & invoices: the exact lookup hit, then open balances whose
   *  patient name matches (so a name finds what they still owe). */
  readonly orderRows = computed<DropRow[]>(() => {
    const base = this.patientRows().length;
    const q = this.query().trim().toLowerCase();
    const seen = new Set<string>();
    const out: DropRow[] = [];
    for (const h of this._orderHits()) {
      if (seen.has(h.orderId)) continue;
      seen.add(h.orderId);
      out.push({ key: 'o:' + h.orderId, index: 0, kind: 'order', title: h.title, meta: h.meta, amount: h.amount, orderId: h.orderId });
    }
    if (q.length >= 2) {
      for (const r of [...this._due(), ...this._refundsOwed()]) {
        if (seen.has(r.orderId) || !(r.patientName ?? '').toLowerCase().includes(q)) continue;
        seen.add(r.orderId);
        const refund = r.balance < 0;
        out.push({
          key: 'o:' + r.orderId, index: 0, kind: 'order',
          title: r.patientName || 'Unnamed patient',
          meta: (refund ? 'Refund owed' : 'Balance due') + ' · ' + new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          amount: (refund ? '−' : '') + inrFmt.format(Math.abs(r.balance)),
          orderId: r.orderId,
        });
        if (out.length >= 8) break;
      }
    }
    return out.map((r, i) => ({ ...r, index: base + i }));
  });

  readonly allRows = computed(() => [...this.patientRows(), ...this.orderRows()]);

  onQuery(v: string) {
    this.query.set(v);
    this.highlight.set(-1);
    this.focused.set(true);
    this.measureDrop();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = v.trim();
    if (!q) { this._patients.set([]); this._orderHits.set([]); this.searching.set(false); return; }
    this.searchTimer = setTimeout(() => this.runSearch(q), 220);
  }

  private runSearch(q: string) {
    const seq = ++this.searchSeq;
    let pending = 0;
    const done = () => { if (--pending <= 0 && seq === this.searchSeq) this.searching.set(false); };
    this.searching.set(true);
    if (q.length >= 2) {
      pending++;
      this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q)}`).subscribe({
        next: list => { if (seq === this.searchSeq) this._patients.set(list ?? []); done(); },
        error: () => { if (seq === this.searchSeq) this._patients.set([]); done(); },
      });
    } else {
      this._patients.set([]);
    }
    this._orderHits.set([]);
    if (this.idLike(q)) {
      pending++;
      this.api.get<{ orderId: string }>(`/api/billing/lookup?code=${encodeURIComponent(q)}`).subscribe({
        next: r => {
          if (seq !== this.searchSeq || !r?.orderId) { done(); return; }
          const id = r.orderId;
          this.api.get<Order>(`/api/orders/${id}`).subscribe({
            next: o => {
              if (seq === this.searchSeq) this._orderHits.set([this.hitFromOrder(id, o, q)]);
              done();
            },
            error: () => {
              if (seq === this.searchSeq) this._orderHits.set([{ orderId: id, title: q, meta: 'Order' }]);
              done();
            },
          });
        },
        error: () => done(),
      });
    }
    if (pending === 0) this.searching.set(false);
  }

  private hitFromOrder(id: string, o: Order | null, code: string): { orderId: string; title: string; meta: string; amount?: string } {
    const due = this.outstandingFor(id);
    const who = o ? this.orderPatientName(o) : '';
    const title = o ? this.orderLabel(o) : code;
    const invoice = o?.orderNumber && code.toUpperCase() !== o.orderNumber.toUpperCase() ? 'Invoice ' + code + ' · ' : '';
    return {
      orderId: id, title,
      meta: invoice + (who || 'Order'),
      amount: due ? (due.balance < 0 ? '−' : '') + inrFmt.format(Math.abs(due.balance)) : undefined,
    };
  }

  onFocus() {
    if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
    this.focused.set(true);
    this.measureDrop();
  }
  onBlur() {
    this.blurTimer = setTimeout(() => this.focused.set(false), 120);
  }
  closeDrop() {
    this.focused.set(false);
    this.highlight.set(-1);
  }
  clearQuery() {
    this.onQuery('');
    this.searchInput()?.nativeElement.focus();
  }

  onArrow(e: Event, step: 1 | -1) {
    const n = this.allRows().length;
    if (!this.dropOpen() || n === 0) return;
    e.preventDefault();
    const cur = this.highlight();
    this.highlight.set(cur < 0 ? (step > 0 ? 0 : n - 1) : (cur + step + n) % n);
  }

  /** Enter: the highlighted row, else an exact order / invoice ID lookup. */
  onEnter(e: Event) {
    e.preventDefault();
    const rows = this.allRows();
    const i = this.highlight();
    if (this.dropOpen() && i >= 0 && i < rows.length) { this.pick(rows[i]); return; }
    const q = this.query().trim();
    if (!q) return;
    this.resolveLookup(q);
  }

  pick(r: DropRow) {
    this.closeDrop();
    this.searchInput()?.nativeElement.blur();
    if (r.kind === 'patient' && r.patient) this.selectPatient(r.patient);
    else if (r.orderId) this.openOrder(r.orderId);
  }

  private measureDrop() {
    const host = this.pill()?.nativeElement;
    if (!host) return;
    // Anchor to the visible pill: the band's pill box (web / tablet) or the
    // phone field row. The dropdown is the pill's width (ND-PATTERN §7).
    const box = (host.closest('.pf-hb__search') as HTMLElement | null) ?? host;
    const anchor = this.phone() ? ((host.closest('.pf-hb__field') as HTMLElement | null) ?? box) : box;
    const r = anchor.getBoundingClientRect?.();
    if (!r) return;
    const vh = (typeof window !== 'undefined' && (window.visualViewport?.height ?? window.innerHeight)) || 800;
    const top = Math.round(r.bottom + 6);
    this.dropBox.set({ left: Math.round(r.left), top, width: Math.round(r.width), maxH: Math.max(200, Math.round(vh - top - 90)) });
  }

  // ── Scan / exact lookup (invoice number · order number / id · tracking QR) ──
  readonly scanning = signal(false);

  startScan() { this.scanning.set(true); }

  onScanned(code: string) {
    this.scanning.set(false);
    this.resolveLookup(code);
  }

  /** Resolve a typed / scanned code → order → open its cart. */
  resolveLookup(code: string) {
    const raw = (code ?? '').trim();
    if (!raw || this.resolving()) return;
    this.resolving.set(true);
    this.api.get<{ orderId: string }>(`/api/billing/lookup?code=${encodeURIComponent(raw)}`).subscribe({
      next: r => {
        this.resolving.set(false);
        if (r?.orderId) { this.closeDrop(); this.openOrder(r.orderId); }
        else this.toasts.error('No order matches that code');
      },
      error: e => { this.resolving.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  // ── Selection: a patient (from search), then an order's cart ──────────
  private readonly _selectedPatient = signal<Patient | null>(null);
  private readonly _orders = signal<Order[]>([]);
  readonly loadingOrders = signal(false);
  readonly ordersSkel = heldFlag(this.loadingOrders);
  readonly selectedPatient = this._selectedPatient.asReadonly();
  readonly billableOrders = computed(() => this._orders().filter(o => this.isBillable(o)));

  readonly selectedOrderId = signal<string | null>(null);
  readonly selectedOrder = signal<Order | null>(null);
  readonly selectedBill = signal<Bill | null>(null);
  readonly loadingOrder = signal(false);
  readonly orderSkel = heldFlag(this.loadingOrder);
  private orderSeq = 0;

  /** Narrow: something is open in the Billing pane (the cart or a patient). */
  readonly detailOpen = computed(() => !!(this.selectedOrderId() || this.selectedPatient()));
  /** Narrow + a cart open: the band's back returns to the queue. */
  readonly bandBack = computed<(() => void) | null>(() =>
    this.narrow() && this.pane() === 'bill' && this.detailOpen() ? () => this.backToQueue() : null);

  display(p: Patient | null | undefined): string { return patientDisplayName(p); }
  patientMeta(p: Patient): string { return formatPatientMeta(p); }

  /** Still to bill or settle: never a cancelled order; the server's
   *  billStatus when present, else the legacy created / pending rule. */
  private isBillable(o: Order): boolean {
    if (o.status === 'cancelled') return false;
    if (o.billStatus) return o.billStatus !== 'paid';
    return o.status === 'created' || o.status === 'pending';
  }

  /** A patient picked in the search: straight to their cart when they are
   *  in the queue once, else their orders still to bill. */
  selectPatient(p: Patient) {
    const inQueue = this.queue().filter(r => r.patientId === p.id);
    if (inQueue.length === 1) { this.openOrder(inQueue[0].orderId); return; }
    this._selectedPatient.set(p);
    this.selectedOrderId.set(null);
    this.selectedOrder.set(null);
    this.selectedBill.set(null);
    this.paid.set(null);
    this._orders.set([]);
    this.loadingOrders.set(true);
    this.pane.set('bill');
    this.api.get<{ patient: Patient; history: Order[] }>(`/api/patients/${p.id}`).subscribe({
      next: res => { this._orders.set(res?.history ?? []); this.loadingOrders.set(false); },
      error: () => { this.loadingOrders.set(false); this.toasts.error('Could not load orders for this patient'); }
    });
  }

  /** Open one order's cart: the order (tests, patient) and its bill. */
  openOrder(orderId: string) {
    const seq = ++this.orderSeq;
    // Coming from somewhere other than this patient's list drops the patient.
    const p = this._selectedPatient();
    if (p && !this._orders().some(o => o.id === orderId)) this._selectedPatient.set(null);
    this.selectedOrderId.set(orderId);
    this.selectedOrder.set(this.orderById(orderId) ?? null);
    this.selectedBill.set(null);
    this.paid.set(null);
    this.refundMode.set('cash');
    this.loadingOrder.set(!this.selectedOrder());
    this.pane.set('bill');
    this.api.get<Order>(`/api/orders/${orderId}`).subscribe({
      next: o => { if (seq === this.orderSeq) { if (o) this.selectedOrder.set(o); this.loadingOrder.set(false); } },
      error: () => {
        if (seq !== this.orderSeq) return;
        this.loadingOrder.set(false);
        if (!this.selectedOrder()) this.toasts.error('Could not load order details');
      }
    });
    // Items, discount + payments from the bill when one exists (read-only GET).
    const row = this.outstandingFor(orderId);
    if (row?.billId) {
      this.api.get<Bill>(`/api/billing/${row.billId}`).subscribe({
        next: b => { if (seq === this.orderSeq) this.selectedBill.set(b ?? null); },
        error: () => { /* the outstanding row still carries the totals */ }
      });
    }
  }

  clearSelection() {
    this.orderSeq++;
    this.selectedOrderId.set(null);
    this.selectedOrder.set(null);
    this.selectedBill.set(null);
    this.loadingOrder.set(false);
    this.paid.set(null);
    this._selectedPatient.set(null);
    this._orders.set([]);
  }

  /** From an order back to the searched patient's list. */
  backToPatient() {
    this.selectedOrderId.set(null);
    this.selectedOrder.set(null);
    this.selectedBill.set(null);
    this.paid.set(null);
  }

  orderLabel(o: Pick<Order, 'id' | 'orderNumber'>): string {
    return o.orderNumber || 'Order ' + o.id.slice(0, 8).toUpperCase();
  }
  orderPatientName(o: Order): string {
    return patientDisplayName(o.patient) || patientDisplayName(this._selectedPatient()) || '';
  }
  totalTests(o: Order): number { return orderTestCount(o); }
  orderAmount(o: Order): number | null {
    const row = this.outstandingFor(o.id);
    if (row) return Math.abs(row.balance);
    return o.totalAmount && o.totalAmount > 0 ? o.totalAmount : null;
  }

  /** Items: the bill's lines (with prices) when loaded, else the order's tests. */
  readonly orderItems = computed<Array<{ key: string; name: string; price: number | null }>>(() => {
    const bill = this.selectedBill();
    if (bill?.items?.length) return bill.items.map(i => ({ key: i.id, name: i.testName, price: i.total ?? i.price }));
    const o = this.selectedOrder();
    const seen = new Set<string>();
    const out: Array<{ key: string; name: string; price: number | null }> = [];
    for (const s of o?.samples ?? []) {
      for (const t of s.tests ?? []) {
        const k = t.id || t.name;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ key: k, name: t.name, price: null });
      }
    }
    return out;
  });

  readonly billState = computed<'refund' | 'due' | 'unbilled' | 'paid' | 'unknown'>(() => {
    const id = this.selectedOrderId();
    const row = this.outstandingFor(id);
    const bill = this.selectedBill();
    const bal = bill?.balance ?? row?.balance;
    if (bal != null && bal < 0) return 'refund';
    if (bal != null && bal > 0) return 'due';
    const o = this.selectedOrder();
    if (o?.billStatus === 'paid' || (bal === 0 && (bill || row))) return 'paid';
    if (o?.billStatus === 'unpaid') return 'due';
    if (o?.billStatus === 'unbilled' || (o && this.isBillable(o))) return 'unbilled';
    return 'unknown';
  });

  readonly billStateLabel = computed(() => ({
    refund: 'Refund owed', due: 'Balance due', unbilled: 'Not billed yet', paid: 'Paid', unknown: 'Billing',
  })[this.billState()]);

  readonly dues = computed<{ payable: number | null; paid: number | null; balance: number | null; discount: number | null; roundOff: number | null }>(() => {
    const bill = this.selectedBill();
    if (bill) {
      const ro = billRoundOff(bill);
      return { payable: bill.totalPayable, paid: bill.totalPaid, balance: bill.balance, discount: bill.totalDiscount > 0 ? bill.totalDiscount : null, roundOff: ro !== 0 ? ro : null };
    }
    const row = this.outstandingFor(this.selectedOrderId());
    if (row) return { payable: row.totalPayable, paid: row.totalPaid, balance: row.balance, discount: null, roundOff: null };
    const o = this.selectedOrder();
    if (o && this.billState() === 'unbilled' && o.totalAmount) return { payable: o.totalAmount, paid: null, balance: null, discount: null, roundOff: null };
    return { payable: null, paid: null, balance: null, discount: null, roundOff: null };
  });
  /** "+₹0.10" / "−₹0.40" for the Round off row. */
  signedInr(n: number | null): string {
    const v = n ?? 0;
    return (v > 0 ? '+' : '−') + new CurrencyInrPipe().transform(Math.abs(v));
  }

  /** What the counter collects now: the balance, or the order total when it
   *  has no bill yet. 0 when nothing is owed. */
  readonly payAmount = computed(() => {
    const st = this.billState();
    const d = this.dues();
    if (st === 'due') return Math.max(0, d.balance ?? 0);
    if (st === 'unbilled') return Math.max(0, d.payable ?? 0);
    return 0;
  });

  // ── Payment (Order & Payments' inline panel, right here) ──────────────
  readonly payPanel = viewChild(InlinePaymentPanelComponent);
  readonly paying = signal(false);
  readonly paid = signal<PaidState | null>(null);

  /** The cart takes money: something is owed and it isn't paid yet here. */
  readonly canCollect = computed(() => !!this.selectedOrder() && !this.paid() && this.payAmount() > 0);

  /** Pay later is picked in the panel (a secondary choice, not a CTA). */
  readonly laterPicked = computed(() => this.payPanel()?.mode() === 'later');

  /** The ONE primary: "Collect ₹X" (vendor: "Bill ₹X to vendor"; Pay later:
   *  "Save — pay later", or "Collect ₹A — rest later" with an advance). */
  readonly collectLabel = computed(() => {
    const p = this.payPanel();
    const mode = p?.mode();
    if (this.paying()) return mode === 'later' ? 'Saving…' : 'Collecting…';
    const amt = inrFmt.format(this.payAmount());
    if (mode === 'later') {
      const adv = p?.advanceOver() ? 0 : (p?.advanceNum() ?? 0);
      return adv > 0 ? `Collect ${inrFmt.format(adv)} — rest later` : 'Save — pay later';
    }
    return mode === 'wallet' ? `Bill ${amt} to vendor` : `Collect ${amt}`;
  });
  /** Until the panel is complete (e.g. cash received typed) the CTA is a
   *  disabled secondary; it turns primary when it can go (ND-PATTERN §2). */
  readonly collectReady = computed(() => {
    const p = this.payPanel();
    return !!p && !p.confirmDisabled() && !this.paying();
  });

  /** Footer CTA → the panel validates and emits (confirm) → confirmPayment. */
  runCollect() { this.payPanel()?.emit(); }

  /** Record the payment on the order's bill (raising the bill first when the
   *  order has none), then show the success state. Never leaves the counter. */
  async confirmPayment(d: InlinePaymentResult) {
    const orderId = this.selectedOrderId();
    if (!orderId || this.paying()) return;
    if (d.mode === 'later') { await this.saveLater(orderId, d); return; }
    this.paying.set(true);
    try {
      let bill = this.selectedBill();
      if (!bill) {
        const row = this.outstandingFor(orderId);
        bill = row?.billId
          ? await firstValueFrom(this.api.get<Bill>(`/api/billing/${row.billId}`))
          : await firstValueFrom(this.api.post<Bill>('/api/billing/', { orderId, discount: 0 }));
      }
      if (!bill) throw new Error('Could not raise the bill for this order');
      const amount = decimal2(bill.balance);
      if (!(amount > 0)) throw new Error('Nothing left to collect on this bill');
      let latest: Bill = bill;
      if (d.mode === 'wallet') {
        if (!d.vendorId) throw new Error('Pick a vendor to bill');
        // H8: ONE call — the payment and the partner's charge commit together.
        latest = (await firstValueFrom(payBillFromWallet(this.api, bill.id, d.vendorId, amount, {
          referenceNo: d.referenceNo, reason: `Bill #${bill.invoiceNumber || bill.id.substring(0, 8)}`,
        }))).bill;
      } else if (d.mode === 'split' && d.splitParts?.length) {
        for (const part of d.splitParts) {
          if (!(part.amount > 0)) continue;
          latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, { amount: part.amount, mode: part.mode }));
        }
      } else {
        latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
          amount, mode: d.mode, referenceNo: d.referenceNo,
        }));
      }
      const o = this.selectedOrder();
      this.selectedBill.set(latest ?? bill);
      this.paid.set({
        orderId,
        name: (o && this.orderPatientName(o)) || this.queue().find(r => r.orderId === orderId)?.name || 'Patient',
        amount, mode: d.mode, bill: latest ?? bill,
      });
      this.markPaid(orderId);
      this.toasts.success('Payment collected');
      this.loadOutstanding(true);
      this.loadToday();
      this.loadReconcile();
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.paying.set(false);
    }
  }

  /** Pay later — the same rules as Order & Payments: the bill is raised (or
   *  kept) with its balance, an optional advance is recorded as a payment,
   *  and nothing else changes; the branch payment gate (dispatch / report)
   *  still holds the order until the balance is paid. The bill is stamped
   *  `payLater` so the patient leaves the waiting queue for every cashier;
   *  the balance stays in MONEY's "Balances due" for later collection. */
  private async saveLater(orderId: string, d: InlinePaymentResult) {
    this.paying.set(true);
    try {
      let bill = this.selectedBill();
      if (!bill) {
        const row = this.outstandingFor(orderId);
        bill = row?.billId
          ? await firstValueFrom(this.api.get<Bill>(`/api/billing/${row.billId}`))
          : await firstValueFrom(this.api.post<Bill>('/api/billing/', { orderId, discount: 0 }));
      }
      if (!bill) throw new Error('Could not raise the bill for this order');
      if (!(decimal2(bill.balance) > 0)) throw new Error('Nothing left to collect on this bill');
      let latest: Bill = bill;
      const adv = decimal2(Math.min(d.advanceAmount ?? 0, bill.balance));
      if (adv > 0) {
        latest = (await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
          amount: adv, mode: d.advanceMode ?? 'cash',
        }))) ?? latest;
      }
      if (decimal2(latest.balance) > 0) {
        // Best-effort stamp: an older server without the endpoint still keeps
        // the patient off this counter's queue for the session.
        try {
          latest = (await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/pay-later`, {}))) ?? latest;
        } catch { /* session set covers it */ }
      }
      const o = this.selectedOrder();
      const name = (o && this.orderPatientName(o)) || this.queue().find(r => r.orderId === orderId)?.name || 'Patient';
      const due = Math.max(0, decimal2(latest.balance));
      this.selectedBill.set(latest);
      this.paid.set({
        orderId, name, amount: adv, mode: 'later', bill: latest,
        later: due > 0, due, advanceMode: adv > 0 ? (d.advanceMode ?? 'cash') : undefined,
      });
      if (due > 0) this.markLater(orderId, latest, name); else this.markPaid(orderId);
      this.toasts.success(due > 0 ? `Bill saved — ${inrFmt.format(due)} due later` : 'Payment collected');
      this.billingEvents?.notifyPayLater();
      this.loadOutstanding(true);
      this.loadToday();
      if (adv > 0) this.loadReconcile();
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.paying.set(false);
    }
  }

  /** Where the branch holds a pay-later order until the balance is paid
   *  (Lab settings → payment gate). Read-only here — the gate is enforced
   *  by the server; the counter only says it. */
  readonly gateNote = computed(() => {
    const stage = this.labCfg?.config()?.paymentGateStage;
    return stage === 'dispatch' ? 'Samples are held at dispatch until it is paid.'
      : stage === 'report' ? 'The report is released once it is paid.'
      : 'Collect it before the report is handed over.';
  });

  /** The next patient in the queue (the paid one has already dropped off). */
  readonly nextRow = computed<QueueRow | null>(() => {
    const cur = this.selectedOrderId();
    return this.filteredQueue().find(r => r.orderId !== cur) ?? null;
  });

  nextPatient() {
    const n = this.nextRow();
    if (n) this.openOrder(n.orderId);
    else this.clearSelection();
  }

  /** Only when the workflow puts collection at this counter. */
  collectSample() {
    const p = this.paid();
    if (!p || !this.collectsHere()) return;
    this.router.navigate(['/sample-collection'], { queryParams: { orderId: p.orderId } });
  }

  readonly printing = signal(false);

  /** Print the paid invoice / receipt (same generator as Order & Payments). */
  async printReceipt() {
    const orderId = this.paid()?.orderId ?? this.selectedOrderId();
    if (!orderId || this.printing()) return;
    this.printing.set(true);
    try {
      let bill = this.paid()?.bill ?? this.selectedBill();
      if (bill?.id) {
        try { bill = (await firstValueFrom(this.api.get<Bill>(`/api/billing/${bill.id}`))) ?? bill; } catch { /* use what we have */ }
      }
      if (!bill) { this.toasts.error('No bill to print yet'); return; }
      let tpl: any = null;
      try { tpl = await firstValueFrom(this.api.get<any>('/api/config/invoice-template')); } catch { /* optional */ }
      let qrDataUrl: string | undefined;
      let orderQrDataUrl: string | undefined;
      try {
        const QRCode = (await import('qrcode')).default;
        const res = await firstValueFrom(this.api.get<{ token: string }>(`/api/orders/${orderId}/track-token`));
        if (res?.token) qrDataUrl = await QRCode.toDataURL(`${window.location.origin}/track/${res.token}`, { margin: 1, width: 220 });
        orderQrDataUrl = await QRCode.toDataURL(`${window.location.origin}/o/${orderId}`, { margin: 1, width: 220 });
      } catch { /* QR best-effort */ }
      const docMode = tpl?.documentMode ?? 'auto';
      const docTitle = docMode === 'bill_of_supply' ? 'BILL OF SUPPLY'
        : docMode === 'tax_invoice' ? 'TAX INVOICE'
        : (bill.totalTax > 0 ? 'TAX INVOICE' : 'BILL OF SUPPLY');
      const logoDataUrl = tpl?.showLogo === false ? undefined : await loadImageDataUrl(tpl?.logoUrl, environment.apiUrl);
      const user = this.auth?.user();
      generateInvoicePdf({
        bill,
        order: (this.selectedOrder() ?? ({ patient: undefined } as unknown as Order)),
        invoiceNumber: bill.invoiceNumber ?? '',
        effectivePayable: bill.totalPayable,
        tatLabel: '',
        docTitle, qrDataUrl, orderQrDataUrl, logoDataUrl,
        cashierName: bill.cashierName || user?.displayName || undefined,
        cashierSignatureDataUrl: bill.cashierSignatureUrl || undefined,
        ...invoiceTemplateFieldsFrom(tpl),
        practice: {
          name: (tpl?.labName || user?.tenantName) || undefined,
          address: tpl?.address || undefined,
          phone: tpl?.phone || undefined,
          email: tpl?.email || undefined,
          gstin: invoiceGstinFrom(bill, tpl),   // the bill's branch-GST snapshot
        },
        action: 'print',
      });
    } catch (e) {
      this.toasts.error(ApiError.from(e).message || 'Could not print the receipt');
    } finally {
      this.printing.set(false);
    }
  }

  // ── Refund owed (balance < 0) — handled here too ──────────────────────
  readonly refundMode = signal<'cash' | 'upi' | 'card'>('cash');
  readonly refundModes: Array<{ id: 'cash' | 'upi' | 'card'; label: string }> = [
    { id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI' }, { id: 'card', label: 'Card' },
  ];
  readonly refunding = signal(false);
  readonly canRefund = computed(() => {
    try { return !!this.auth?.hasPermission('process_refund'); } catch { return false; }
  });
  readonly refundDue = computed(() => this.billState() === 'refund' ? Math.abs(this.dues().balance ?? 0) : 0);

  refund() {
    const orderId = this.selectedOrderId();
    const billId = this.selectedBill()?.id ?? this.outstandingFor(orderId)?.billId;
    const amount = decimal2(this.refundDue());
    if (!orderId || !billId || !(amount > 0) || this.refunding() || !this.canRefund()) return;
    this.refunding.set(true);
    this.api.post<Bill>(`/api/billing/${billId}/refund`, {
      amount, mode: this.refundMode(), reason: 'Refunded at the billing counter',
    }).subscribe({
      next: b => {
        this.refunding.set(false);
        if (b) this.selectedBill.set(b);
        this._refundsOwed.update(list => list.filter(r => r.orderId !== orderId));
        this.toasts.success(`Refunded ${inrFmt.format(amount)}`);
        this.loadOutstanding(true);
        this.loadReconcile();
      },
      error: e => { this.refunding.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
