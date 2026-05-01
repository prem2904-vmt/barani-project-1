import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { Appointment } from '../../../shared/models/appointment.model';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';

type DateRange = 'today' | 'yesterday' | '7d' | 'month' | 'custom';

interface StragglerItem {
  id: string;
  kind: 'missed' | 'uncollected' | 'unpaid';
  title: string;
  sub: string;
  age: string;
  patientId?: string;
  orderId?: string;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  status: 'on_duty' | 'on_break' | 'busy';
}

@Component({
  selector: 'pf-frontdesk-landing',
  standalone: true,
  imports: [DatePipe, PatientSearchComponent, AvatarComponent, ChipComponent, CurrencyInrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './frontdesk-landing.component.html',
  styleUrl: './frontdesk-landing.component.scss',
})
export class FrontdeskLandingComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly labCfg = inject(BranchLabConfigService);
  // Cached ETag from /api/orders/today; sent as If-None-Match next poll.
  private _ordersEtag: string | null = null;
  // Local content signature used as a belt-and-braces no-op detector when an
  // intermediary strips ETag headers.
  private _ordersSig: string | null = null;

  readonly dateOptions: Array<{ id: DateRange; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 days' },
    { id: 'custom', label: 'Custom' },
  ];

  readonly dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Mocked staff — backend doesn't track duty status yet. */
  readonly staff: StaffMember[] = [
    { id: '1', name: 'Priya Sharma', role: 'Receptionist', status: 'on_duty' },
    { id: '2', name: 'Ravi Kumar', role: 'Phlebotomist', status: 'on_duty' },
    { id: '3', name: 'Dr. Arjun Mehta', role: 'Pathologist', status: 'busy' },
    { id: '4', name: 'Kavita Reddy', role: 'Lab technician', status: 'on_break' },
  ];

  private readonly _dateRange = signal<DateRange>('today');
  readonly dateRange = this._dateRange.asReadonly();

  // Custom date range — stored as ISO yyyy-MM-dd strings so signal equality
  // works with primitives. _customEnd is null until the user picks a second
  // day (single-day picks set start, leave end null and we treat end=start).
  private readonly _customStart = signal<string | null>(null);
  private readonly _customEnd = signal<string | null>(null);
  readonly customStart = this._customStart.asReadonly();
  readonly customEnd = this._customEnd.asReadonly();
  // Calendar popover open state + the month currently being viewed (1st of
  // month, so day-grid math doesn't drift across DST boundaries).
  private readonly _calendarOpen = signal(false);
  readonly calendarOpen = this._calendarOpen.asReadonly();
  private readonly _calMonth = signal<Date>(this.firstOfThisMonth());
  readonly calMonth = this._calMonth.asReadonly();

  private readonly _selectedIds = signal<Set<string>>(new Set());
  readonly selectedIds = this._selectedIds.asReadonly();

  private readonly _stragglersOpen = signal<boolean>(false);
  readonly stragglersOpen = this._stragglersOpen.asReadonly();
  private readonly _stragglersDismissed = signal<boolean>(false);
  readonly stragglersDismissed = this._stragglersDismissed.asReadonly();

  // Staff popover anchored to the header button. Single state across all
  // viewports — popover positioning falls back to a centred sheet on
  // narrow widths via CSS.
  private readonly _staffPopoverOpen = signal<boolean>(false);
  readonly staffPopoverOpen = this._staffPopoverOpen.asReadonly();
  private readonly _collectionPopoverOpen = signal<boolean>(false);
  readonly collectionPopoverOpen = this._collectionPopoverOpen.asReadonly();
  private readonly _topTestPopoverOpen = signal<boolean>(false);
  readonly topTestPopoverOpen = this._topTestPopoverOpen.asReadonly();

  /** Which exception-queue drawer is open (null = none). Walk-ins / Ready /
      Payments-due used to be tabs; they're now alert chips that open this
      drawer so the default page stays calm. */
  private readonly _openQueue = signal<'ready' | 'payments' | null>(null);
  readonly openQueue = this._openQueue.asReadonly();

  private readonly _appointments = signal<Appointment[]>([]);
  private readonly _orders = signal<Order[]>([]);
  private readonly _bills = signal<Bill[]>([]);
  private readonly _selectedOrder = signal<Order | null>(null);

  readonly appointments = this._appointments.asReadonly();
  readonly orders = this._orders.asReadonly();
  readonly bills = this._bills.asReadonly();
  readonly selectedOrder = this._selectedOrder.asReadonly();

  readonly firstName = computed(() => this.auth.user()?.firstName || this.auth.user()?.displayName?.split(' ')[0] || 'there');

  readonly statusHint = computed(() => {
    const a = this._appointments().length;
    const o = this._orders().length;
    const due = this.paymentsDue().length;
    return `${a} scheduled · ${o} orders · ${due} payments due`;
  });

  // Date helpers ---------------------------------------------
  private inRange(d: Date | string | undefined): boolean {
    if (!d) return false;
    const when = new Date(d).getTime();
    const start = this.rangeStart();
    const end = this.rangeEnd();
    return when >= start && when < end;
  }
  private rangeStart(): number {
    const r = this._dateRange();
    const now = new Date(); now.setHours(0, 0, 0, 0);
    switch (r) {
      case 'today': return now.getTime();
      case 'yesterday': return now.getTime() - 86_400_000;
      case '7d': return now.getTime() - 7 * 86_400_000;
      case 'month': return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      case 'custom': {
        const s = this._customStart();
        return s ? this.dayStart(s).getTime() : now.getTime();
      }
      default: return now.getTime();
    }
  }
  private rangeEnd(): number {
    const r = this._dateRange();
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (r === 'yesterday') return now.getTime();
    if (r === 'custom') {
      // End is exclusive; use end-of-day + 1ms so the picked day is included.
      const e = this._customEnd() ?? this._customStart();
      if (e) return this.dayStart(e).getTime() + 86_400_000;
      return Date.now();
    }
    return Date.now();
  }
  private dayStart(iso: string): Date {
    const d = new Date(iso); d.setHours(0, 0, 0, 0); return d;
  }
  private toIsoDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Filtered lists -------------------------------------------
  readonly visibleAppointments = computed(() =>
    this._appointments().filter(a => this.inRange(a.appointmentDate))
  );
  readonly visibleOrders = computed(() =>
    this._orders().filter(o => this.inRange(o.createdAt) && o.status !== 'completed')
  );
  readonly readyForPickup = computed(() =>
    this._orders().filter(o => o.status === 'completed')
  );
  readonly paymentsDue = computed(() =>
    this._bills().filter(b => b.balance > 0)
  );

  // Stragglers -----------------------------------------------
  readonly stragglers = computed<StragglerItem[]>(() => {
    const yesterdayStart = Date.now() - 86_400_000;
    const items: StragglerItem[] = [];

    // Missed appointments (booked but appointmentDate passed)
    for (const a of this._appointments()) {
      const when = new Date(a.appointmentDate).getTime();
      if (when < yesterdayStart && a.status === 'booked') {
        items.push({
          id: 'm-' + a.id,
          kind: 'missed',
          title: a.patient?.displayName ?? 'Patient',
          sub: a.slotTime || 'no slot',
          age: this.ago(when),
          patientId: a.patientId,
        });
      }
    }
    // Uncollected reports (>24h since completion)
    for (const o of this._orders()) {
      if (o.status === 'completed') {
        const when = new Date(o.createdAt).getTime();
        if (Date.now() - when > 86_400_000) {
          items.push({
            id: 'u-' + o.id,
            kind: 'uncollected',
            title: o.patient?.displayName ?? 'Patient',
            sub: `#${o.id.slice(0, 8)}`,
            age: this.ago(when),
            patientId: o.patientId,
            orderId: o.id,
          });
        }
      }
    }
    // Unpaid bills older than 24h
    for (const b of this._bills()) {
      if (b.balance > 0) {
        const when = new Date(b.createdAt).getTime();
        if (Date.now() - when > 86_400_000) {
          items.push({
            id: 'p-' + b.id,
            kind: 'unpaid',
            title: this.patientName(b.patientId),
            sub: `Bill #${b.id.slice(0, 8)}`,
            age: this.ago(when),
            patientId: b.patientId,
          });
        }
      }
    }
    return items;
  });

  // STAT pinned row
  readonly statItems = computed(() =>
    this._orders().filter(o => o.priority === 'STAT' && o.status !== 'completed')
  );

  // Tab counts
  readonly counts = computed(() => ({
    appointments: this.visibleAppointments().length,
    orders: this.visibleOrders().length,
    ready: this.readyForPickup().length,
    payments: this.paymentsDue().length,
  }));

  // Collection summary today
  readonly collectedToday = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return this._bills()
      .filter(b => new Date(b.createdAt).getTime() >= todayStart.getTime())
      .reduce((sum, b) => sum + b.totalPaid, 0);
  });
  readonly dueToday = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return this._bills()
      .filter(b => new Date(b.createdAt).getTime() >= todayStart.getTime())
      .reduce((sum, b) => sum + b.balance, 0);
  });
  readonly billsToday = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return this._bills().filter(b => new Date(b.createdAt).getTime() >= todayStart.getTime());
  });
  readonly paymentsByMode = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const totals = new Map<string, number>();
    for (const b of this._bills()) {
      for (const p of b.payments ?? []) {
        if (new Date(p.paidAt).getTime() < todayStart.getTime()) continue;
        const mode = (p.mode || 'other').toLowerCase();
        totals.set(mode, (totals.get(mode) ?? 0) + p.amount);
      }
    }
    return [...totals.entries()]
      .map(([mode, amount]) => ({ mode, amount }))
      .sort((a, b) => b.amount - a.amount);
  });
  readonly recentCollections = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const rows: Array<{ id: string; mode: string; amount: number; paidAt: string; patient: string }> = [];
    for (const b of this._bills()) {
      const patient = this.patientName(b.patientId);
      for (const p of b.payments ?? []) {
        if (new Date(p.paidAt).getTime() < todayStart.getTime()) continue;
        rows.push({ id: p.id, mode: p.mode || 'other', amount: p.amount, paidAt: p.paidAt, patient });
      }
    }
    return rows
      .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
      .slice(0, 6);
  });

  // Top tests today — derive from today's orders. Drops entries whose Test
  // relation didn't load (so we never show a useless "Unknown" pill); the
  // header surfaces only the single top test as a compact metric.
  readonly topTests = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const counts = new Map<string, number>();
    for (const o of this._orders()) {
      if (new Date(o.createdAt).getTime() < todayStart.getTime()) continue;
      for (const s of o.samples) {
        for (const t of s.tests ?? []) {
          const name = t.test?.name?.trim();
          if (!name) continue;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  });
  readonly topTest = computed(() => this.topTests()[0] ?? null);

  // Calendar grid: 6 weeks × 7 days, anchored on the visible month. Each
  // cell is fully self-describing so the template stays declarative.
  readonly calCells = computed<Array<{
    iso: string; day: number; outside: boolean; today: boolean;
    isStart: boolean; isEnd: boolean; inRange: boolean; future: boolean;
  }>>(() => {
    const month = this._calMonth();
    const year = month.getFullYear();
    const m = month.getMonth();
    const todayIso = this.toIsoDay(new Date());
    const todayMs = this.dayStart(todayIso).getTime();
    const start = this._customStart();
    const end = this._customEnd() ?? start;
    // Grid origin: the Sunday on/before the 1st of the month.
    const first = new Date(year, m, 1);
    const origin = new Date(year, m, 1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + i);
      const iso = this.toIsoDay(d);
      const ms = d.getTime();
      cells.push({
        iso,
        day: d.getDate(),
        outside: d.getMonth() !== m,
        today: iso === todayIso,
        isStart: !!start && iso === start,
        isEnd: !!end && !!start && end !== start && iso === end,
        inRange: !!start && !!end && ms >= this.dayStart(start).getTime()
          && ms <= this.dayStart(end).getTime(),
        future: ms > todayMs,
      });
    }
    return cells;
  });

  // Live polling: 30s tick keeps Today's Orders fresh so reception sees
  // status changes (collected → dispatched → received → validated) without
  // a manual refresh. Stopped on destroy + when the tab is hidden so we
  // don't burn requests on a backgrounded laptop.
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  protected readonly lastUpdated = signal<number>(Date.now());
  protected isAdmin = false;

    ngOnInit() {
    this.labCfg.ensureLoaded();
    this.refresh();
    this.pollHandle = setInterval(() => {
      // Skip polls while the tab is hidden — saves bandwidth on inactive
      // tabs without changing perceived freshness once focus returns.
      if (typeof document !== 'undefined' && document.hidden) return;
      this.refresh();
    }, 30_000);

    const perms = this.auth.user()?.permissions ?? [];
    this.isAdmin = perms.includes('*');
  }
  ngOnDestroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  refresh() {
    this.api.get<Appointment[]>('/api/appointments/today').subscribe({
      next: l => this._appointments.set(l ?? []),
    });
    // Polled ~ every 30s — bypass ApiService here so we can drive If-None-Match.
    // Server returns 304 with no body when nothing material has changed,
    // letting us skip the signal write entirely (and the cascading recompute
    // through pipeline()/orderTone()/etc. that would otherwise re-render every
    // card every poll).
    this.fetchOrdersWithEtag();
    this.api.get<Bill[]>('/api/billing/').subscribe({
      next: l => this._bills.set(l ?? []),
      error: () => { /* endpoint may not exist; silently ignore */ }
    });
  }

  private async fetchOrdersWithEtag() {
    try {
      const headers: Record<string, string> = {};
      if (this._ordersEtag) headers['If-None-Match'] = `"${this._ordersEtag}"`;
      const token = await this.auth.getAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await firstValueFrom(this.http.get(`${environment.apiUrl}/api/orders/today`, {
        headers,
        observe: 'response',
        // Tell HttpClient that 304 is a successful (non-error) response — by
        // default it would route to the error handler.
        responseType: 'json'
      }));
      // 304 → server confirms our cached snapshot is still current. Bump
      // lastUpdated so the user sees "Updated just now" but skip the data
      // write so Angular has nothing to re-render.
      if (resp.status === 304) { this.lastUpdated.set(Date.now()); return; }
      const newEtag = resp.headers.get('ETag')?.replace(/"/g, '') ?? null;
      const body = resp.body as { success?: boolean; data?: Order[] } | null;
      const list = body?.data ?? [];
      // Defence in depth: even if the server didn't 304, do a local content
      // check to suppress no-op signal updates (e.g. ETag header stripped by
      // a proxy). Cheap signature over the same fields the server hashes.
      const incomingSig = this.computeOrdersSignature(list);
      if (incomingSig === this._ordersSig) {
        this._ordersEtag = newEtag;
        this.lastUpdated.set(Date.now());
        return;
      }
      this._orders.set(list);
      this._ordersSig = incomingSig;
      this._ordersEtag = newEtag;
      this.lastUpdated.set(Date.now());
    } catch {
      /* network blip — leave the existing list intact */
    }
  }

  /** Signature shape mirrors backend ETag input. Stable per (id, status). */
  private computeOrdersSignature(orders: Order[]): string {
    return orders
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(o => `${o.id}:${o.status}:` + (o.samples ?? [])
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(s => `${s.id}=${s.status}#` + (s.tests ?? [])
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(t => `${t.id}=${t.status}`).join(';'))
        .join(','))
      .join('|');
  }

  // ── Navigation & actions ──────────────────────────────────
  openRegister() { this.router.navigate(['/frontdesk/patients/new']); }
  searchFocus() { this.toasts.success('QR scanner · coming soon'); }
  openProfile(p: Patient) { this.router.navigate(['/frontdesk/patients', p.id]); }
  openAppointment(a: Appointment) {
    if (a.patientId) this.router.navigate(['/frontdesk/patients', a.patientId]);
  }
  openOrder(o: Order) { this._selectedOrder.set(o); }

  // Only show the inline "Collect Sample" action when reception owns collection
  // at this branch (dedicated_counter mode routes to a separate queue) and the
  // order has actually been billed (status=billed). Deep-links into /lab/collect
  // so the existing scan/pick flow handles everything downstream.
  // Critical: hide the action once ANY sample has moved past 'pending'. The
  // order status alone (often still 'billed' until every tube is drawn) is
  // not enough — re-prompting collection on a partially or fully collected
  // order would let users overwrite drawn tubes.
  showCollectOn(o: Order): boolean {
    if (this.labCfg.collectionMode() !== 'front_desk') return false;
    if (!this.auth.hasPermission('collect_sample')) return false;
    if (o.status !== 'billed') return false;
    const samples = o.samples ?? [];
    if (samples.length === 0) return false;
    return samples.every(s => !s.status || s.status === 'pending');
  }
  /**
   * "Create Bill" button only renders when this branch bills at the front
   * desk AND the user actually holds create_bill. Separate-counter mode
   * shows the "Awaiting Billing" badge instead so reception understands
   * who owns the next step.
   */
  showCreateBillOn(o: Order): boolean {
    if (this.labCfg.billingMode() !== 'front_desk') return false;
    return this.auth.hasPermission('create_bill') && o.status === 'created';
  }
  reprintLabels(o: Order) {
    this.router.navigate(['/frontdesk/post-payment'], { queryParams: { orderId: o.id } });
  }
  /** Reception jumps into the billing screen for this order. */
  goToBilling(o: Order) {
    this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: o.id } });
  }
  /** Friendly label for the status chip. snake_case statuses → Title Case. */
  statusLabel(status: string): string {
    const map: Record<string, string> = {
      created: 'Created',
      billed: 'Billed',
      sample_collected: 'Sample Collected',
      dispatched: 'Dispatched',
      in_transit: 'Arrived at Lab',
      received_in_lab: 'In Lab',
      received: 'In Lab',
      processing: 'Processing',
      resulted: 'Resulted',
      validated: 'Validated',
      partially_validated: 'Partial Ready',
      delivered: 'Delivered',
      rejected: 'Rejected',
      partially_rejected: 'Partially Rejected',
      cancelled: 'Cancelled',
      in_progress: 'In Progress',
      completed: 'Completed'
    };
    return map[status] ?? status;
  }
  /** All tubes drawn but none has left for the lab yet — read-only badge. */
  isFullyCollected(o: Order): boolean {
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.every(s => s.status === 'collected');
  }
  /** Some tubes drawn, others still pending — partial-progress badge. */
  isPartiallyCollected(o: Order): boolean {
    const samples = o.samples ?? [];
    if (samples.length === 0) return false;
    const anyDrawn = samples.some(s => s.status && s.status !== 'pending');
    const anyPending = samples.some(s => !s.status || s.status === 'pending');
    return anyDrawn && anyPending;
  }
  /** Lab tech has marked at least one tube received — TAT clock has started. */
  isAtLab(o: Order): boolean {
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.some(s =>
      s.status === 'received' || s.status === 'processing');
  }
  collectSample(o: Order) {
    this.router.navigate(['/lab/collect'], { queryParams: { orderId: o.id } });
  }

  // Dispatch button: visible when every tube on the order has been
  // collected but none has left for the lab yet. The FD/courier desk taps
  // it to mark all collected tubes 'dispatched' in one go.
  showDispatchOn(o: Order): boolean {
    if (!this.auth.hasPermission('dispatch_sample')) return false;
    const samples = o.samples ?? [];
    if (samples.length === 0) return false;
    const allCollected = samples.every(s => s.status === 'collected');
    return allCollected;
  }

  /** Per-tube status in 5 buckets — finer than order.status. Drives the
      FD slim card's per-dept badge + the action button gating. */
  sampleStatus(o: Order): 'pending' | 'partially_collected' | 'fully_collected' | 'dispatched' | 'received' {
    const samples = o.samples ?? [];
    if (samples.length === 0) return 'pending';
    const isAtOrPast = (s: string, target: string) => {
      const order = ['pending', 'collected', 'dispatched', 'in_transit', 'received', 'processing'];
      return order.indexOf(s) >= order.indexOf(target);
    };
    if (samples.every(s => s.status === 'received' || s.status === 'processing')) return 'received';
    if (samples.every(s => isAtOrPast(s.status, 'dispatched'))) return 'dispatched';
    if (samples.every(s => isAtOrPast(s.status, 'collected'))) return 'fully_collected';
    if (samples.some(s => s.status !== 'pending' && s.status !== 'rejected')) return 'partially_collected';
    return 'pending';
  }
  /** Single-glyph status per tube (used in the FD slim card per-dept pill). */
  sampleGlyph(status: string): string {
    switch (status) {
      case 'collected': return '✅';
      case 'dispatched': return '🚗';
      case 'in_transit': return '📦';
      case 'received':
      case 'processing': return '🔬';
      case 'validated': return '✓';
      case 'rejected': return '❌';
      default: return '⏳';
    }
  }
  /** A sample (tube) is dept-validated when every OrderTest inside it
      has Status === 'validated'. Used by the FD card to show ✓ pills
      and to count how many depts are ready in a partial state. */
  isSampleValidated(s: { tests?: Array<{ status: string }> | null }): boolean {
    const tests = s.tests ?? [];
    return tests.length > 0 && tests.every(t => t.status === 'validated');
  }
  /** Glyph for a tube — uses isSampleValidated to upgrade ✓ when the
      whole tube is dept-validated, otherwise falls back to status-glyph. */
  tubeGlyph(s: { status: string; tests?: Array<{ status: string }> | null }): string {
    if (this.isSampleValidated(s)) return '✓';
    return this.sampleGlyph(s.status);
  }
  /** True when at least one whole sample is validated and others
      aren't — independent of o.status so the badge surfaces even if
      the backend hasn't yet recomputed the order's status under the
      new partially_validated rules. */
  hasPartialReady(o: Order): boolean {
    const samples = (o.samples ?? []).filter(s => s.status !== 'rejected');
    if (samples.length === 0) return false;
    const validated = samples.filter(s => this.isSampleValidated(s)).length;
    return validated > 0 && validated < samples.length;
  }
  /** Returns N/M of validated depts. Always derived from samples,
      not from o.status. Returns empty string when nothing's
      validated. */
  partialReadyLabel(o: Order): string {
    const samples = (o.samples ?? []).filter(s => s.status !== 'rejected');
    if (samples.length === 0) return '';
    const validated = samples.filter(s => this.isSampleValidated(s)).length;
    if (validated === 0) return '';
    return `${validated}/${samples.length}`;
  }
  /** All validated samples on the order — feeds the Preliminary report
      panel in the order drawer. */
  validatedSamples(o: Order): Array<{ id: string; deptName: string; deptCode: string; tests: Array<{ id: string; name: string; values: Array<{ name: string; title: string; value: unknown; unit?: string; range?: string; flag: 'normal' | 'abnormal' | 'critical' }> }> }> {
    const out: Array<any> = [];
    for (const s of (o.samples ?? [])) {
      if (!this.isSampleValidated(s)) continue;
      const sampleRow = {
        id: s.id,
        deptName: s.department?.name ?? '',
        deptCode: s.department?.code ?? '',
        tests: [] as Array<any>
      };
      for (const t of (s.tests ?? [])) {
        if (t.status !== 'validated') continue;
        sampleRow.tests.push({
          id: t.id,
          name: t.test?.name ?? 'Test',
          values: this.extractValuesFor(t)
        });
      }
      out.push(sampleRow);
    }
    return out;
  }
  /** Parse the OrderTest's currentResult JSON into per-parameter rows
      with reference range + flag. Mirrors what validate-result does. */
  private extractValuesFor(t: { currentResult?: string; test?: { parameters?: string } }):
    Array<{ name: string; title: string; value: unknown; unit?: string; range?: string; flag: 'normal' | 'abnormal' | 'critical' }> {
    if (!t.currentResult || !t.test?.parameters) return [];
    let snap: { values?: Record<string, unknown> };
    try { snap = JSON.parse(t.currentResult); } catch { return []; }
    if (!snap.values) return [];
    let params: Array<{
      name: string; title: string; unit?: string;
      criticalLow?: number; criticalHigh?: number;
      referenceRanges?: Array<{ min: number; max: number }>
    }> = [];
    try {
      const blob = JSON.parse(t.test.parameters) as { parameters?: any[] };
      params = blob.parameters ?? [];
    } catch { return []; }
    return params.map(p => {
      const v = snap.values![p.name];
      const n = Number(v);
      const isNum = !Number.isNaN(n) && v !== null && v !== undefined && v !== '';
      const r = (p.referenceRanges ?? [])[0];
      let flag: 'normal' | 'abnormal' | 'critical' = 'normal';
      if (isNum) {
        if ((p.criticalLow != null && n <= p.criticalLow) || (p.criticalHigh != null && n >= p.criticalHigh)) flag = 'critical';
        else if (r && (n < r.min || n > r.max)) flag = 'abnormal';
      }
      return {
        name: p.name,
        title: p.title || p.name,
        value: v ?? '—',
        unit: p.unit,
        range: r ? `${r.min}–${r.max}${p.unit ? ' ' + p.unit : ''}` : undefined,
        flag
      };
    });
  }
  isDispatched(o: Order): boolean {
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.every(s =>
      s.status === 'dispatched' || s.status === 'in_transit'
      || s.status === 'received' || s.status === 'processing');
  }
  markDispatched(o: Order) {
    this.api.patch<{ dispatched: number }>(`/api/orders/${o.id}/dispatch`, {}).subscribe({
      next: r => {
        this.toasts.success(`${r.dispatched} tube${r.dispatched === 1 ? '' : 's'} dispatched to lab`);
        // Optimistic local update so the badge flips immediately.
        this._orders.update(list => list.map(x => x.id === o.id
          ? {
            ...x, samples: x.samples.map(s => s.status === 'collected'
              ? { ...s, status: 'dispatched', dispatchedAt: new Date().toISOString() }
              : s)
          }
          : x));
        // Immediate server sync — don't make the FD wait for the next 30s
        // poll to confirm the order's overall status flipped.
        this.fetchOrdersWithEtag();
      },
      error: e => this.toasts.error(e?.message ?? 'Could not mark dispatched')
    });
  }
  closeOrder() { this._selectedOrder.set(null); }
  openStraggler(s: StragglerItem) {
    if (s.orderId) this.router.navigate(['/frontdesk/patients', s.patientId]);
    else if (s.patientId) this.router.navigate(['/frontdesk/patients', s.patientId]);
  }
  quickBook(o: Order) {
    if (o.patientId) this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: o.patientId } });
  }
  collectPayment(b: Bill) {
    this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: b.orderId } });
  }
  checkIn(a: Appointment) {
    this.api.patch<Appointment>(`/api/appointments/${a.id}/checkin`).subscribe({
      next: () => { this.toasts.success('Checked in'); this.refresh(); }
    });
  }

  // ── UI state ──────────────────────────────────────────────
  setDateRange(d: DateRange) {
    // Selecting a non-custom pill closes the calendar and clears any draft
    // custom range so re-opening starts fresh.
    if (d !== 'custom') {
      this._calendarOpen.set(false);
      this._customStart.set(null);
      this._customEnd.set(null);
    }
    this._dateRange.set(d);
  }

  // ── Custom date range / calendar ─────────────────────────
  private firstOfThisMonth(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  }
  toggleCalendar() {
    this._calendarOpen.update(v => !v);
    if (this._calendarOpen()) {
      // Anchor view to whichever month already holds the active selection
      // (or this month otherwise) so the user lands on familiar ground.
      const anchor = this._customStart() ?? this.toIsoDay(new Date());
      this._calMonth.set(this.firstOfMonth(new Date(anchor)));
    }
  }
  closeCalendar() { this._calendarOpen.set(false); }
  prevMonth() { this._calMonth.update(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  nextMonth() {
    // Don't let the user page past the current month — future-dated visits
    // aren't a thing in this product.
    const n = new Date();
    this._calMonth.update(d => {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const cap = new Date(n.getFullYear(), n.getMonth(), 1);
      return next > cap ? d : next;
    });
  }
  pickDay(iso: string) {
    const start = this._customStart();
    const end = this._customEnd();
    if (!start || (start && end)) {
      // Fresh pick (or restarting after a complete range) — set start, clear end.
      this._customStart.set(iso);
      this._customEnd.set(null);
      return;
    }
    // We already have a start, no end yet — the second pick closes the range.
    if (iso < start) {
      // Picked an earlier day; swap so start always precedes end.
      this._customEnd.set(start);
      this._customStart.set(iso);
    } else if (iso === start) {
      // Same day — keep as a single-day range, no end needed.
      this._customEnd.set(null);
    } else {
      this._customEnd.set(iso);
    }
  }
  applyCustom() {
    if (!this._customStart()) return;
    this._dateRange.set('custom');
    this._calendarOpen.set(false);
  }
  clearCustom() {
    this._customStart.set(null);
    this._customEnd.set(null);
    if (this._dateRange() === 'custom') this._dateRange.set('today');
  }
  /** Pill label for the Custom button — shows the active range when set. */
  customRangeLabel(): string {
    const s = this._customStart();
    const e = this._customEnd();
    if (!s) return 'Custom';
    const sDate = new Date(s);
    if (!e || e === s) {
      return sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const eDate = new Date(e);
    const sLabel = sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const eLabel = eDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${sLabel} – ${eLabel}`;
  }
  /** Footer hint inside the popover — guides the click-once / click-twice flow. */
  customRangeHint(): string {
    const s = this._customStart();
    const e = this._customEnd();
    if (!s) return 'Pick a start day';
    if (s && !e) return 'Pick an end day, or Apply for just this day';
    return 'Range selected';
  }
  private firstOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
  toggleStragglers() { this._stragglersOpen.update(v => !v); }
  dismissStragglers() { this._stragglersDismissed.set(true); }

  // Staff popover — toggles open from the header button. Stop propagation
  // on the click so the same event doesn't immediately bubble up and
  // close it via the backdrop click handler.
  toggleStaffPopover(ev: MouseEvent) {
    ev.stopPropagation();
    this._collectionPopoverOpen.set(false);
    this._topTestPopoverOpen.set(false);
    this._staffPopoverOpen.update(v => !v);
  }
  closeStaffPopover() { this._staffPopoverOpen.set(false); }
  toggleCollectionPopover(ev: MouseEvent) {
    ev.stopPropagation();
    this._staffPopoverOpen.set(false);
    this._topTestPopoverOpen.set(false);
    this._collectionPopoverOpen.update(v => !v);
  }
  closeCollectionPopover() { this._collectionPopoverOpen.set(false); }
  toggleTopTestPopover(ev: MouseEvent) {
    ev.stopPropagation();
    this._staffPopoverOpen.set(false);
    this._collectionPopoverOpen.set(false);
    this._topTestPopoverOpen.update(v => !v);
  }
  closeTopTestPopover() { this._topTestPopoverOpen.set(false); }
  openQueueDrawer(q: 'ready' | 'payments') { this._openQueue.set(q); }
  closeQueueDrawer() { this._openQueue.set(null); }
  queueTitle(q: 'ready' | 'payments' | null): string {
    switch (q) {
      case 'ready': return 'Ready for pickup';
      case 'payments': return 'Payments due';
      default: return '';
    }
  }
  /** Count of staff with status === 'on_duty' for the button badge. */
  onDutyCount(): number { return this.staff.filter(s => s.status === 'on_duty').length; }
  toggleSelect(id: string) {
    this._selectedIds.update(cur => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  clearSelection() { this._selectedIds.set(new Set()); }
  bulkSms() { this.toasts.success(`SMS queued to ${this._selectedIds().size} recipients`); this.clearSelection(); }
  bulkWhatsapp() { this.toasts.success(`WhatsApp queued to ${this._selectedIds().size} recipients`); this.clearSelection(); }

  // ── Helpers ───────────────────────────────────────────────
  countBy(k: StragglerItem['kind']): number { return this.stragglers().filter(s => s.kind === k).length; }
  kindLabel(k: StragglerItem['kind']): string { return k === 'missed' ? 'MISSED' : k === 'uncollected' ? 'UNPICKED' : 'UNPAID'; }

  patientFor(id: string): Patient | undefined {
    return this._orders().find(o => o.patientId === id)?.patient
      ?? this._appointments().find(a => a.patientId === id)?.patient;
  }
  patientName(id: string): string {
    return patientDisplayName(this.patientFor(id)) || 'Patient';
  }
  hasOutstanding(pid?: string): boolean {
    if (!pid) return false;
    return this._bills().some(b => b.patientId === pid && b.balance > 0);
  }
  cleanPhone(p: string): string { return p.replace(/[^\d]/g, ''); }

  ago(ts: number): string {
    const diff = Date.now() - ts;
    const hrs = Math.floor(diff / 3_600_000);
    if (hrs < 1) return 'just now';
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
  reportAge(o: Order): string { return this.ago(new Date(o.createdAt).getTime()); }
  apptPriority(a: Appointment): string { return a.type === 'emergency' ? 'STAT' : a.type === 'followup' ? 'Urgent' : 'Normal'; }

  apptTone(a: Appointment): ChipTone {
    switch (a.status) {
      case 'checked_in': return 'emerald';
      case 'booked': return 'amber';
      case 'completed': return 'teal';
      case 'cancelled':
      case 'no_show': return 'rose';
      default: return 'default';
    }
  }
  orderTone(o: Order): ChipTone {
    switch (o.status) {
      case 'completed':
      case 'validated':
      case 'delivered': return 'emerald';
      case 'cancelled':
      case 'rejected': return 'rose';
      case 'in_progress':
      case 'received':
      case 'processing':
      case 'resulted': return 'violet';
      case 'collected':
      case 'dispatched':
      case 'in_transit': return 'teal';
      case 'billed': return 'emerald';
      case 'created':
      case 'draft': return 'amber';
      default: return 'amber';
    }
  }

  pipeline(o: Order): Array<{ label: string; state: 'done' | 'active' | 'pending' }> {
    const billDone = o.status !== 'draft' && o.status !== 'created';
    const collected = o.samples.some(s => s.status && s.status !== 'pending');
    const dispatched = o.samples.some(s => s.status === 'dispatched' || s.status === 'in_transit'
      || s.status === 'received' || s.status === 'processing');
    const received = o.samples.some(s => s.status === 'received' || s.status === 'processing');
    const completed = o.status === 'completed';
    const anyResult = (o.samples[0]?.tests ?? []).some(t => t.status === 'validated' || t.status === 'entered');
    return [
      { label: 'Billing', state: billDone ? 'done' : 'active' },
      { label: 'Sample', state: collected ? 'done' : billDone ? 'active' : 'pending' },
      { label: 'Dispatch', state: received ? 'done' : dispatched ? 'done' : collected ? 'active' : 'pending' },
      { label: 'Result', state: anyResult ? 'done' : received ? 'active' : 'pending' },
      { label: 'Report', state: completed ? 'done' : anyResult ? 'active' : 'pending' }
    ];
  }
  stepCaption(o: Order, step: { label: string; state: 'done' | 'active' | 'pending' }): string {
    if (step.state === 'pending') return 'Pending';
    switch (step.label) {
      case 'Billing': return step.state === 'done' ? 'Billed' : 'Billing in progress';
      case 'Sample': {
        const total = o.samples.length;
        const collected = o.samples.filter(s => s.status && s.status !== 'pending').length;
        const received = o.samples.filter(s => s.status === 'received' || s.status === 'processing').length;
        return step.state === 'done' ? `${received}/${total} received at lab` : `${collected}/${total} collected`;
      }
      case 'Result': {
        const all = o.samples.flatMap(s => s.tests ?? []);
        const validated = all.filter(t => t.status === 'validated' || t.status === 'entered').length;
        return `${validated}/${all.length} tests resulted`;
      }
      case 'Report': return step.state === 'done' ? 'Report dispatched' : 'Awaiting validation';
      default: return '';
    }
  }
}
