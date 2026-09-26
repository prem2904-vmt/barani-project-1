import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnDestroy, OnInit,
  computed, inject, signal, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { ScanService } from '../../core/services/scan.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { Bill } from '../../shared/models/bill.model';
import { Order } from '../../shared/models/order.model';
import { Patient, formatPatientMeta, patientDisplayName } from '../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../shared/pipes/currency-inr.pipe';
import { plural } from '../../shared/utils/plural';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { ScanIconComponent } from '../../shared/components/icons/scan-icon.component';
import { BarcodeScannerModalComponent } from '../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { NdDateComponent } from '../../shared/components/nd-date/nd-date.component';

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

/** The ONE primary for the selected order (ND-PATTERN §2). */
interface PrimaryAction { kind: 'collect' | 'refund' | 'bill'; label: string; }

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet', vendor: 'Vendor', split: 'Split',
  later: 'Pay later', cheque: 'Cheque', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', online: 'Online',
};

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

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/**
 * Billing counter — for branches in `billing_mode = separate_counter`.
 *
 * New-design pattern (docs/ND-PATTERN.md "Two jobs on one screen"):
 *   • Band: back · tenant; the pill is the CONTEXT BAR — ONE unified search
 *     (patients AND orders / invoices, grouped type-ahead) with the scan icon
 *     inside it. Enter on an exact order / invoice ID opens it.
 *   • LEFT main card BILLING: the selected patient's orders to bill, or one
 *     order's items + dues and the ONE primary ("Collect ₹X" / "Refund ₹X").
 *     Money is taken on Order & Payments' new-design inline payment panel
 *     (the primary hands the order to it) — never re-implemented here.
 *   • RIGHT side card MONEY (a summary companion): balances due / refunds
 *     owed and the day-end summary by date. Collapsible to a strip
 *     (remembered per user); ≤900px a segmented switch in the pill picks
 *     which card shows.
 */
@Component({
  selector: 'pf-billing-counter',
  standalone: true,
  imports: [
    DatePipe, NgTemplateOutlet, CurrencyInrPipe,
    HeroBandComponent, ScanIconComponent, BarcodeScannerModalComponent, NdDateComponent,
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
  private readonly destroyRef = inject(DestroyRef);
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

  ngOnInit() {
    this.loadOutstanding();
    this.loadReconcile();
  }

  ngOnDestroy() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.blurTimer) clearTimeout(this.blurTimer);
  }

  // ── Outstanding balances / refunds owed ───────────────────────────────
  private readonly _due = signal<OutstandingRow[]>([]);
  private readonly _refundsOwed = signal<OutstandingRow[]>([]);
  protected readonly loadingOutstanding = signal(false);
  readonly due = this._due.asReadonly();
  readonly refundsOwed = this._refundsOwed.asReadonly();
  readonly moneyCount = computed(() => this._due().length + this._refundsOwed().length);

  private loadOutstanding() {
    this.loadingOutstanding.set(true);
    this.api.get<{ due: OutstandingRow[]; refundsOwed: OutstandingRow[] }>('/api/billing/outstanding').subscribe({
      next: res => {
        this._due.set(res?.due ?? []);
        this._refundsOwed.set(res?.refundsOwed ?? []);
        this.loadingOutstanding.set(false);
      },
      error: () => {
        this.loadingOutstanding.set(false);
        this.toasts.error('Could not load outstanding balances');
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

  // ── Day-end reconciliation ────────────────────────────────────────────
  protected readonly reconcileDate = signal(BillingCounterComponent.todayIso());
  private readonly _reconcile = signal<ReconcileSummary | null>(null);
  protected readonly loadingReconcile = signal(false);
  readonly reconcile = this._reconcile.asReadonly();

  static todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  /** Resolve a typed / scanned code → order → open it in the BILLING card. */
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

  // ── Selection: a patient, then an order ───────────────────────────────
  private readonly _selectedPatient = signal<Patient | null>(null);
  private readonly _orders = signal<Order[]>([]);
  readonly loadingOrders = signal(false);
  readonly selectedPatient = this._selectedPatient.asReadonly();
  readonly billableOrders = computed(() => this._orders().filter(o => this.isBillable(o)));

  readonly selectedOrderId = signal<string | null>(null);
  readonly selectedOrder = signal<Order | null>(null);
  readonly selectedBill = signal<Bill | null>(null);
  readonly loadingOrder = signal(false);
  private orderSeq = 0;

  display(p: Patient | null | undefined): string { return patientDisplayName(p); }
  patientMeta(p: Patient): string { return formatPatientMeta(p); }

  /** Still to bill or settle: never a cancelled order; the server's
   *  billStatus when present, else the legacy created / pending rule. */
  private isBillable(o: Order): boolean {
    if (o.status === 'cancelled') return false;
    if (o.billStatus) return o.billStatus !== 'paid';
    return o.status === 'created' || o.status === 'pending';
  }

  selectPatient(p: Patient) {
    this._selectedPatient.set(p);
    this.selectedOrderId.set(null);
    this.selectedOrder.set(null);
    this.selectedBill.set(null);
    this._orders.set([]);
    this.loadingOrders.set(true);
    this.pane.set('bill');
    this.api.get<{ patient: Patient; history: Order[] }>(`/api/patients/${p.id}`).subscribe({
      next: res => { this._orders.set(res?.history ?? []); this.loadingOrders.set(false); },
      error: () => { this.loadingOrders.set(false); this.toasts.error('Could not load orders for this patient'); }
    });
  }

  openOrder(orderId: string) {
    const seq = ++this.orderSeq;
    // Coming from somewhere other than this patient's list drops the patient.
    const p = this._selectedPatient();
    if (p && !this._orders().some(o => o.id === orderId)) this._selectedPatient.set(null);
    this.selectedOrderId.set(orderId);
    this.selectedOrder.set(null);
    this.selectedBill.set(null);
    this.loadingOrder.set(true);
    this.pane.set('bill');
    this.api.get<Order>(`/api/orders/${orderId}`).subscribe({
      next: o => { if (seq === this.orderSeq) { this.selectedOrder.set(o ?? null); this.loadingOrder.set(false); } },
      error: () => {
        if (seq !== this.orderSeq) return;
        this.loadingOrder.set(false);
        this.toasts.error('Could not load order details');
      }
    });
    // Items + payments from the bill when one exists (read-only GET).
    const row = this.outstandingFor(orderId);
    if (row?.billId) {
      this.api.get<Bill>(`/api/billing/${row.billId}`).subscribe({
        next: b => { if (seq === this.orderSeq) this.selectedBill.set(b ?? null); },
        error: () => { /* the outstanding row still carries the totals */ }
      });
    }
  }

  backToPatient() {
    this.selectedOrderId.set(null);
    this.selectedOrder.set(null);
    this.selectedBill.set(null);
  }

  clearSelection() {
    this.backToPatient();
    this._selectedPatient.set(null);
    this._orders.set([]);
  }

  orderLabel(o: Pick<Order, 'id' | 'orderNumber'>): string {
    return o.orderNumber || 'Order ' + o.id.slice(0, 8).toUpperCase();
  }
  orderPatientName(o: Order): string {
    return patientDisplayName(o.patient) || patientDisplayName(this._selectedPatient()) || '';
  }
  totalTests(o: Order): number {
    return (o.samples ?? []).reduce((sum, s) => sum + (s.tests?.length ?? 0), 0);
  }
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

  readonly dues = computed<{ payable: number | null; paid: number | null; balance: number | null }>(() => {
    const bill = this.selectedBill();
    if (bill) return { payable: bill.totalPayable, paid: bill.totalPaid, balance: bill.balance };
    const row = this.outstandingFor(this.selectedOrderId());
    if (row) return { payable: row.totalPayable, paid: row.totalPaid, balance: row.balance };
    const o = this.selectedOrder();
    if (o && this.billState() === 'unbilled' && o.totalAmount) return { payable: o.totalAmount, paid: null, balance: null };
    return { payable: null, paid: null, balance: null };
  });

  /** ONE primary per view: Collect ₹X / Refund ₹X / Bill & collect; none
   *  when nothing is selected or the order is settled. */
  readonly primary = computed<PrimaryAction | null>(() => {
    if (!this.selectedOrder()) return null;
    const d = this.dues();
    switch (this.billState()) {
      case 'refund': return { kind: 'refund', label: 'Refund ' + inrFmt.format(Math.abs(d.balance ?? 0)) };
      case 'due': return d.balance ? { kind: 'collect', label: 'Collect ' + inrFmt.format(d.balance) } : { kind: 'collect', label: 'Collect payment' };
      case 'unbilled': return d.payable ? { kind: 'bill', label: 'Collect ' + inrFmt.format(d.payable) } : { kind: 'bill', label: 'Bill & collect' };
      default: return null;
    }
  });

  /** Payments + refunds are taken on Order & Payments' inline payment panel
   *  (the same hand-off this counter has always used). */
  runPrimary() { this.openInOrderScreen(); }

  openInOrderScreen() {
    const id = this.selectedOrderId();
    if (!id) return;
    this.router.navigate(['/frontdesk/order'], { queryParams: { orderId: id } });
  }
}
