import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { skip } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { AppointmentBookingService } from '../../../core/services/appointment-booking.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { BillingEventsService } from '../../../core/services/billing-events.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { PatientProfileService } from '../../../core/services/patient-profile.service';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { Appointment } from '../../../shared/models/appointment.model';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import { Report } from '../../../shared/models/report.model';

/** Slim shape of /api/dispatch-packages — used by the bulk-dispatch
 *  modal on the landing. Mirrors DispatchPackageDto from the backend. */
interface DispatchPackage {
  id: string;
  code: string;
  branchId: string;
  createdAt: string;
  receivedAt?: string | null;
  orderCount: number;
  orders: Array<{ id: string; patientName: string; sampleCount: number; status: string }>;
}
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AdvancedPatientSearchComponent } from '../advanced-patient-search/advanced-patient-search.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';

type DateRange = 'today' | 'yesterday' | '7d' | 'month' | 'custom';

/** Mirrors the AdvancedFilters shape inside the modal — kept in this file
 *  so we don't pull a heavy import just for typing. */
interface AdvancedSearchPreset {
  phone: string;
  name: string;
  patientId: string;
  dateRange: 'any' | 'today' | 'yesterday' | '7d' | 'month' | 'custom';
  dateFrom: string;
  dateTo: string;
  branchId: string;
  testIds: string[];
  age: string;
  sex: '' | 'male' | 'female' | 'other';
}

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
  imports: [DatePipe, RouterLink, PatientSearchComponent, AvatarComponent, ChipComponent, CurrencyInrPipe, AdvancedPatientSearchComponent, KpiStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './frontdesk-landing.component.html',
  styleUrl: './frontdesk-landing.component.scss',
})
export class FrontdeskLandingComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly booking = inject(AppointmentBookingService);
  private readonly billingEvents = inject(BillingEventsService);
  // Cached ETag from /api/orders/today; sent as If-None-Match next poll.
  private _ordersEtag: string | null = null;
  // Local content signature used as a belt-and-braces no-op detector when an
  // intermediary strips ETag headers.
  private _ordersSig: string | null = null;

  // Flags to skip initial effect runs (equivalent to skip(1))
  private bookingSkipped = false;
  private paidSkipped = false;
  private payLaterSkipped = false;

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

  // Mobile / tablet accordion state — which of the 3 split panes is
  // currently expanded. Single-expand for predictable layout: tapping a
  // header expands that pane and collapses the other two; tapping the
  // already-expanded header collapses everything ('none' state shows
  // just the 3 header bars). Ignored at desktop (≥1024px) where the CSS
  // grid lays all three panes out side-by-side.
  private readonly _expandedPane = signal<'appt' | 'work' | 'none'>('appt');
  readonly expandedPane = this._expandedPane.asReadonly();
  togglePane(id: 'appt' | 'work') {
    this._expandedPane.update(curr => curr === id ? 'none' : id);
  }


  // Active tab inside the Work pane — In progress vs Completed. Persisted
  // so the user lands on the same tab next session.
  private static readonly WORK_TAB_KEY = 'pf.lms.frontdesk.workTab';
  private readonly _workTab = signal<'ip' | 'done'>(this.loadWorkTab());
  readonly workTab = this._workTab.asReadonly();
  setWorkTab(t: 'ip' | 'done') {
    this._workTab.set(t);
    try { localStorage.setItem(FrontdeskLandingComponent.WORK_TAB_KEY, t); } catch { /* ignore */ }
  }
  private loadWorkTab(): 'ip' | 'done' {
    try {
      const raw = localStorage.getItem(FrontdeskLandingComponent.WORK_TAB_KEY);
      return raw === 'done' ? 'done' : 'ip';
    } catch { return 'ip'; }
  }

  // ── Two-pane split (when one column is hidden) ────────────
  // When the user hides one pane, the remaining two share the row. This
  // is a separate split percentage from the 3-pane case (--appt-a/--b)
  // so toggling between modes preserves both mental models. Persisted
  // independently. 0-100 = % width of the FIRST visible pane.
  private static readonly TWO_SPLIT_KEY = 'pf.lms.frontdesk.twoPaneSplit';
  protected readonly _twoPaneSplit = signal<number>(this.loadTwoPaneSplit());
  readonly twoPaneSplit = this._twoPaneSplit.asReadonly();
  private loadTwoPaneSplit(): number {
    try {
      const raw = localStorage.getItem(FrontdeskLandingComponent.TWO_SPLIT_KEY);
      const n = raw ? Number(raw) : 50;
      return Number.isFinite(n) && n >= 15 && n <= 85 ? n : 50;
    } catch { return 50; }
  }
  private persistTwoPaneSplit(n: number) {
    try { localStorage.setItem(FrontdeskLandingComponent.TWO_SPLIT_KEY, String(n)); }
    catch { /* quota / private mode */ }
  }

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

  /** Two-slider track for the 3-pane layout (Appointments | In Progress | Completed).
   *  Each slider stores the LEFT EDGE of the slider as a % of the row width.
   *  • _apptSplitPctA = position of slider 1 (between Appointments & In Progress)
   *  • _apptSplitPctB = position of slider 2 (between In Progress & Completed)
   *  Constraints: 15 ≤ A ≤ B−15 ≤ 85, so no pane collapses below 15%.
   *  Persisted in localStorage as a "A,B" pair so the chosen ratios stick. */
  private static readonly APPT_SPLIT_KEY = 'pf.lms.frontdesk.apptSplitPct';
  private static readonly APPT_SPLIT_DEFAULT_A = 33;
  private static readonly APPT_SPLIT_DEFAULT_B = 66;
  private static readonly APPT_SPLIT_MIN = 15;
  private static readonly APPT_SPLIT_MAX = 85;
  private static readonly APPT_SPLIT_GAP = 15; // min % between A and B
  private readonly _apptSplitPctA = signal<number>(0);
  private readonly _apptSplitPctB = signal<number>(0);
  readonly apptSplitPctA = this._apptSplitPctA.asReadonly();
  readonly apptSplitPctB = this._apptSplitPctB.asReadonly();
  /** Back-compat alias — older template references read this. */
  readonly apptSplitPct = this.apptSplitPctA;
  private readonly _apptSplitDragging = signal<boolean>(false);
  readonly apptSplitDragging = this._apptSplitDragging.asReadonly();
  /** Which slider is currently being dragged: 'a' (left) or 'b' (right). */
  private _draggingHandle: 'a' | 'b' | 'two' | null = null;
  /** ViewChild ref — gives us the container's bounding rect so we can
   *  translate pointer X into a percentage. */
  protected readonly apptSplitEl = viewChild<ElementRef<HTMLDivElement>>('apptSplit');
  /** Active pointer id during drag — set in pointerdown, cleared in
   *  pointerup. Used to ignore stray pointermove events from a different
   *  pointer (e.g. a second touch). */
  private _activePointerId: number | null = null;

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
      return now.getTime() + 86_400_000;
    }
    // For 'today' / '7d' / 'month', include the rest of the current day —
    // future appointments today must show in the queue, not be filtered out
    // because they happen after Date.now(). End is the start of tomorrow
    // (exclusive bound).
    return now.getTime() + 86_400_000;
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
  // Show only appointments that are still actionable on the desk.
  // Checked-in patients have moved to In-progress (the order takes over);
  // cancelled appointments shouldn't clutter the queue. Both stay
  // visible on the calendar route, just not on the operational landing.
  readonly visibleAppointments = computed(() =>
    this._appointments().filter(a =>
      this.inRange(a.appointmentDate)
      && a.status !== 'checked_in'
      && a.status !== 'cancelled'
    )
  );
  /** "In progress" — actively-moving orders. Excludes terminal /
   *  ready-to-deliver states; those land in completedOrders below so
   *  the FD board has two clear panes. */
  readonly visibleOrders = computed(() =>
    this._orders().filter(o =>
      this.inRange(o.createdAt)
      && o.status !== 'completed'
      && o.status !== 'validated'
      && o.status !== 'partially_validated'
      && o.status !== 'delivered'
      && o.status !== 'cancelled'
    )
  );
  /** "Completed" — work the lab has signed off on (validated /
   *  partially_validated / delivered / completed). Drives the new
   *  third FD pane next to In Progress so reception can see at a
   *  glance which patients are ready to hand over. */
  readonly completedOrders = computed(() =>
    this._orders().filter(o =>
      this.inRange(o.createdAt) && (
        o.status === 'validated' ||
        o.status === 'partially_validated' ||
        o.status === 'delivered' ||
        o.status === 'completed'
      )
    )
  );
  /** Subset of completedOrders still needing delivery (for the alert
   *  chip + ready count). */
  readonly readyForPickup = computed(() =>
    this.completedOrders().filter(o => o.status !== 'delivered')
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

  constructor() {
    // Restore saved 3-pane split positions (Appointments | In Progress | Completed).
    // Done in the constructor so the first render uses the persisted ratio
    // and we don't flicker from defaults to user values.
    const restored = this.readApptSplitFromStorage();
    this._apptSplitPctA.set(restored.a);
    this._apptSplitPctB.set(restored.b);

    // One-shot toast + tab-title pulse when new orders flip to
    // "Ready for delivery" (status 'validated' / 'partially_validated').
    // Drives the "completed → notify FD" hand-off — every time the
    // count rises during this session, reception gets a visible cue
    // that there's something new to hand over.
    let prevReady = -1; // -1 = first run, suppress initial toast
    effect(() => {
      const list = this.readyForPickup();
      const next = list.length;
      if (prevReady >= 0 && next > prevReady) {
        const delta = next - prevReady;
        this.toasts.success(`${delta} report${delta === 1 ? '' : 's'} ready for delivery`);
      }
      prevReady = next;
    });

    // Mirror the Appt|Work split into the first pane's `flex-basis`
    // whenever the value changes (or the viewChild ref becomes
    // available). Belt-and-braces alongside the [style.flex-basis.%]
    // template binding — guarantees the layout reacts to drag updates
    // even if the binding's CD pass is delayed.
    effect(() => {
      const v = this._twoPaneSplit();
      const el = this.apptSplitEl()?.nativeElement;
      if (!el) return;
      const firstPane = el.querySelector<HTMLElement>(':scope > .pf-appt-split__pane');
      if (firstPane) firstPane.style.flexBasis = v + '%';
    });

    // Refresh the queue immediately when a new appointment is booked
    // (e.g. via the calendar's quick-book modal). Without this, a fresh
    // booking only shows up at the next 30s poll.
    effect(() => {
      this.booking.bookedAt();
      if (!this.bookingSkipped) {
        this.bookingSkipped = true;
        return;
      }
      this.refresh();
    });

    // Same for billing events — a freshly-marked Pay later or a new
    // payment should reflect on the landing instantly so reception
    // sees outstanding balances without waiting for the poll.
    effect(() => {
      this.billingEvents.paid();
      if (!this.paidSkipped) {
        this.paidSkipped = true;
        return;
      }
      this.refresh();
    });
    effect(() => {
      this.billingEvents.payLater();
      if (!this.payLaterSkipped) {
        this.payLaterSkipped = true;
        return;
      }
      this.refresh();
      // Surface the alert so reception can't miss it: pop the
      // payments-due drawer open as soon as the new pay-later lands.
      this._openQueue.set('payments');
    });
  }

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

    // Re-open the advanced search modal whenever ?aps=1 appears in the URL.
    // Subscribing to queryParamMap (not just snapshot) handles browser
    // back/forward — same component instance, query params change in place.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.hydrateApsFromUrl());
  }
  ngOnDestroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  refresh() {
    // Date-range scoped fetch: fall back to /today when the active
    // range is exactly today (keeps the optimised endpoint + ETag
    // path), otherwise hit the new /range endpoint with from/to.
    const r = this.dateRangeBounds();
    if (r.isToday) {
      this.api.get<Appointment[]>('/api/appointments/today').subscribe({
        next: l => this._appointments.set(l ?? []),
      });
      this.fetchOrdersWithEtag();
    } else {
      const params = new URLSearchParams({
        from: new Date(r.start).toISOString(),
        to:   new Date(r.end).toISOString()
      });
      this.api.get<Appointment[]>(`/api/appointments?${params}`).subscribe({
        next: l => this._appointments.set(l ?? []),
        error: () => this._appointments.set([])
      });
      this.api.get<Order[]>(`/api/orders/range?${params}`).subscribe({
        next: l => { this._orders.set(l ?? []); this.lastUpdated.set(Date.now()); },
        error: () => this._orders.set([])
      });
      // Reset ETag so the next /today switch refetches fresh instead
      // of comparing against a stale signature.
      this._ordersEtag = null;
      this._ordersSig = null;
    }
    this.api.get<Bill[]>('/api/billing/').subscribe({
      next: l => this._bills.set(l ?? []),
      error: () => { /* endpoint may not exist; silently ignore */ }
    });
  }

  /** Read the active date filter into start/end timestamps + a hint
   *  for whether it's the simple "today" case (so we can keep the
   *  optimised /today + ETag path for the most common selection). */
  private dateRangeBounds(): { start: number; end: number; isToday: boolean } {
    const start = this.rangeStart();
    const end = this.rangeEnd();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const isToday = this._dateRange() === 'today'
      && start === today0.getTime()
      && end === today0.getTime() + 86_400_000;
    return { start, end, isToday };
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

  // ── Advanced patient search modal ─────────────────────────
  // The simple inline search above only handles a single fuzzy term. The
  // advanced modal layers in mobile / patient ID / branch / date range /
  // test name / age so reception can fall back to it when the primary
  // mobile-number lookup fails or is ambiguous. Cmd/Ctrl+K opens it from
  // anywhere on the landing page; the modal manages its own ESC + backdrop
  // close. We don't open it on text inputs to avoid hijacking native
  // browser shortcuts.
  //
  // State is mirrored into the URL when a search executes (?aps=1&aps_phone=…)
  // so the back-button after picking a patient lands the user on the same
  // filter set + result list. The modal hydrates from the preset Input on
  // open and runs the search once.
  private readonly _advancedOpen = signal(false);
  readonly advancedOpen = this._advancedOpen.asReadonly();
  private readonly _advancedPreset = signal<AdvancedSearchPreset | null>(null);
  readonly advancedPreset = this._advancedPreset.asReadonly();

  openAdvancedSearch() {
    this._advancedPreset.set(null);
    this._advancedOpen.set(true);
  }
  closeAdvancedSearch() {
    this._advancedOpen.set(false);
    this._advancedPreset.set(null);
    // Strip search params from the URL on explicit close (X / ESC / backdrop)
    // so they don't leak into a fresh open — but only if we're still on
    // /frontdesk. Picking a patient navigates away first, leaving the
    // params intact in history for back-button restore.
    if (this.router.url.startsWith('/frontdesk') && this.hasApsParams()) {
      this.router.navigate(['/frontdesk'], { queryParams: {}, replaceUrl: true });
    }
  }

  /** Persist the active filters into the URL after each successful search.
   *  Absolute path (not relativeTo+empty) so the URL writes reliably from
   *  any router state. We push a NEW history entry per search instead of
   *  using replaceUrl — that way the browser's back button always returns
   *  here from the patient profile, regardless of how many searches the
   *  user ran in between. Each refinement adds one back-press, which is
   *  more predictable than silent in-place URL replacement. */
  onAdvancedSearchExecuted(filters: AdvancedSearchPreset) {
    const params = this.serializeAps(filters);
    console.info('[adv-search] writing URL', params);
    this.router.navigate(['/frontdesk'], { queryParams: params });
  }

  private hasApsParams(): boolean {
    const snap = this.route.snapshot.queryParamMap;
    return snap.get('aps') === '1';
  }

  private emptyApsQueryParams(): Record<string, null> {
    return {
      aps: null,
      aps_phone: null, aps_name: null, aps_pid: null,
      aps_date: null, aps_from: null, aps_to: null,
      aps_branch: null, aps_tests: null, aps_age: null, aps_sex: null
    };
  }

  private serializeAps(f: AdvancedSearchPreset): Record<string, string | null> {
    return {
      aps: '1',
      aps_phone: f.phone || null,
      aps_name: f.name || null,
      aps_pid: f.patientId || null,
      aps_date: f.dateRange === 'any' ? null : f.dateRange,
      aps_from: f.dateRange === 'custom' && f.dateFrom ? f.dateFrom : null,
      aps_to:   f.dateRange === 'custom' && f.dateTo ? f.dateTo : null,
      aps_branch: f.branchId || null,
      aps_tests: f.testIds.length ? f.testIds.join(',') : null,
      aps_age: f.age || null,
      aps_sex: f.sex || null
    };
  }

  private hydrateApsFromUrl() {
    const q = this.route.snapshot.queryParamMap;
    console.info('[adv-search] hydrate', { url: this.router.url, aps: q.get('aps') });
    if (q.get('aps') !== '1') {
      // No advanced-search params in the URL — make sure the modal is shut.
      // This handles browser-forward navigations away from a previously open
      // modal as well as fresh visits.
      if (this._advancedOpen()) {
        this._advancedOpen.set(false);
        this._advancedPreset.set(null);
      }
      return;
    }
    const date = (q.get('aps_date') ?? 'any') as AdvancedSearchPreset['dateRange'];
    const sex = (q.get('aps_sex') ?? '') as AdvancedSearchPreset['sex'];
    const preset: AdvancedSearchPreset = {
      phone:     q.get('aps_phone')  ?? '',
      name:      q.get('aps_name')   ?? '',
      patientId: q.get('aps_pid')    ?? '',
      dateRange: ['any','today','yesterday','7d','month','custom'].includes(date) ? date : 'any',
      dateFrom:  q.get('aps_from')   ?? '',
      dateTo:    q.get('aps_to')     ?? '',
      branchId:  q.get('aps_branch') ?? '',
      testIds:   (q.get('aps_tests') ?? '').split(',').filter(Boolean),
      age:       q.get('aps_age')    ?? '',
      sex:       ['', 'male', 'female', 'other'].includes(sex) ? sex : ''
    };
    this._advancedPreset.set(preset);
    this._advancedOpen.set(true);
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(ev: KeyboardEvent) {
    if (ev.key !== 'k' && ev.key !== 'K') return;
    if (!(ev.metaKey || ev.ctrlKey)) return;
    // Don't intercept the OS shortcut while typing in another input — Ctrl+K
    // is a legitimate URL clear in some browsers, and we don't want to
    // surprise users mid-type. The modal's own input is fine to capture.
    const t = ev.target as HTMLElement | null;
    const tag = (t?.tagName || '').toLowerCase();
    if ((tag === 'input' || tag === 'textarea' || t?.isContentEditable) && !this.advancedOpen()) return;
    ev.preventDefault();
    this._advancedOpen.update(o => !o);
  }

  // ── Splitter drag (Pointer Events API) ─────────────────────
  // Pointer Events with setPointerCapture is the modern, reliable way
  // to handle drag — works for mouse, touch, and pen with the same
  // code, doesn't lose track when the cursor leaves the viewport, and
  // doesn't need fragile window-level mousemove listeners.

  /** Pointerdown on the handle: capture the pointer so every
   *  subsequent move + up event is delivered to this element. */
  onSplitPointerDown(ev: PointerEvent) {
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    this._activePointerId = ev.pointerId;
    this._draggingHandle = 'two';
    this._apptSplitDragging.set(true);
    ev.preventDefault();
  }

  /** Pointermove on the handle (delivered here directly because we
   *  captured the pointer in pointerdown). Translate clientX into a
   *  percentage of the splitter row, clamp 15–85, write to both the
   *  signal and the pane's inline flex-basis for snappy feedback. */
  onSplitPointerMove(ev: PointerEvent) {
    if (this._activePointerId !== ev.pointerId) return;
    const el = this.apptSplitEl()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const raw = ((ev.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(15, Math.min(85, raw));
    this._twoPaneSplit.set(clamped);
    const firstPane = el.querySelector<HTMLElement>(':scope > .pf-appt-split__pane');
    if (firstPane) firstPane.style.flexBasis = clamped + '%';
  }

  /** Pointerup / pointercancel / lostpointercapture — release capture,
   *  flush the persisted value, drop dragging state. */
  onSplitPointerUp(ev: PointerEvent) {
    if (this._activePointerId !== ev.pointerId && ev.type !== 'lostpointercapture') return;
    const target = ev.currentTarget as HTMLElement;
    if (target.hasPointerCapture(ev.pointerId)) {
      target.releasePointerCapture(ev.pointerId);
    }
    this._activePointerId = null;
    this._draggingHandle = null;
    this._apptSplitDragging.set(false);
    this.persistTwoPaneSplit(this._twoPaneSplit());
  }

  /** Keyboard accessibility — left/right arrows nudge the focused
   *  divider in 2% steps; Home/End jump to the bounds for that
   *  handle's allowed range. The handle ('a' or 'b') is passed via
   *  the (keydown) binding on each separator element. */
  onApptSplitKey(ev: KeyboardEvent, handle: 'a' | 'b' | 'two' = 'a') {
    const step =
      ev.key === 'ArrowLeft'  ? -2 :
      ev.key === 'ArrowRight' ? +2 :
      ev.key === 'Home'       ? -100 :
      ev.key === 'End'        ? +100 : 0;
    if (!step) return;
    ev.preventDefault();
    if (handle === 'a') {
      const { a, b } = this.clampSplit(this._apptSplitPctA() + step, this._apptSplitPctB());
      this._apptSplitPctA.set(a);
      this._apptSplitPctB.set(b);
      this.persistApptSplit();
    } else if (handle === 'b') {
      const { a, b } = this.clampSplit(this._apptSplitPctA(), this._apptSplitPctB() + step);
      this._apptSplitPctA.set(a);
      this._apptSplitPctB.set(b);
      this.persistApptSplit();
    } else {
      const next = Math.max(15, Math.min(85, this._twoPaneSplit() + step));
      this._twoPaneSplit.set(next);
      this.persistTwoPaneSplit(next);
    }
  }

  resetApptSplit() {
    this._apptSplitPctA.set(FrontdeskLandingComponent.APPT_SPLIT_DEFAULT_A);
    this._apptSplitPctB.set(FrontdeskLandingComponent.APPT_SPLIT_DEFAULT_B);
    this.persistApptSplit();
  }

  /** Persist both slider positions as "A,B". Earlier single-value
   *  format is silently upgraded on first save. */
  private persistApptSplit(a: number = this._apptSplitPctA(), b: number = this._apptSplitPctB()) {
    try { localStorage.setItem(FrontdeskLandingComponent.APPT_SPLIT_KEY, `${a},${b}`); } catch { /* SSR / private mode — ignore */ }
  }

  /** Read both slider positions from localStorage. Tolerates the
   *  legacy single-number format (just A) and falls back to defaults
   *  if anything's malformed. */
  private readApptSplitFromStorage(): { a: number; b: number } {
    const fallback = {
      a: FrontdeskLandingComponent.APPT_SPLIT_DEFAULT_A,
      b: FrontdeskLandingComponent.APPT_SPLIT_DEFAULT_B
    };
    try {
      const raw = localStorage.getItem(FrontdeskLandingComponent.APPT_SPLIT_KEY);
      if (!raw) return fallback;
      const parts = raw.split(',');
      const a = Number(parts[0]);
      const b = parts.length > 1 ? Number(parts[1]) : NaN;
      // Legacy single-value entry: keep A, derive B as A + ~half of remaining.
      if (Number.isFinite(a) && !Number.isFinite(b)) {
        const derivedB = Math.min(
          FrontdeskLandingComponent.APPT_SPLIT_MAX,
          a + Math.max(FrontdeskLandingComponent.APPT_SPLIT_GAP, (100 - a) / 2)
        );
        return this.clampSplit(a, derivedB);
      }
      if (Number.isFinite(a) && Number.isFinite(b)) return this.clampSplit(a, b);
    } catch { /* ignore */ }
    return fallback;
  }

  /** Clamp A and B so they respect the min/max bounds and the min
   *  gap between handles (so neither pane can collapse below 15%). */
  private clampSplit(a: number, b: number): { a: number; b: number } {
    const min = FrontdeskLandingComponent.APPT_SPLIT_MIN;
    const max = FrontdeskLandingComponent.APPT_SPLIT_MAX;
    const gap = FrontdeskLandingComponent.APPT_SPLIT_GAP;
    const aClamped = Math.max(min, Math.min(max - gap, a));
    const bClamped = Math.max(aClamped + gap, Math.min(max, b));
    return { a: Math.round(aClamped), b: Math.round(bClamped) };
  }

  // ── Navigation & actions ──────────────────────────────────
  private readonly profileSvc = inject(PatientProfileService);

  openRegister() { this.router.navigate(['/frontdesk/patients/new']); }
  searchFocus() { this.toasts.success('QR scanner · coming soon'); }
  openProfile(p: Patient) { this.profileSvc.open(p.id); }
  newOrderFor(p: Patient) {
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: p.id } });
  }
  bookAppointmentFor(p: Patient) {
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: p.id } });
  }
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
    // Backend returns { appointment, order, next }:
    //   • order != null  → tests were pre-booked, an order has been
    //     spawned automatically. The patient is now in In-Progress on
    //     this same screen — no navigation needed.
    //   • order == null  → no tests on the appointment, reception must
    //     pick tests now. We navigate to the order-create page with
    //     ?patientId=&appointmentId= so the order links back.
    this.api.patch<{ appointment: Appointment; order: Order | null; next: string }>(
      `/api/appointments/${a.id}/checkin`
    ).subscribe({
      next: res => {
        if (res?.order) {
          this.toasts.success(`${a.patient?.displayName ?? 'Patient'} checked in — order in progress`);
          this.refresh();
        } else {
          // No tests yet → reception needs to add them on the order
          // page, then the order will appear in In-Progress on return.
          this.toasts.info(`${a.patient?.displayName ?? 'Patient'} checked in — pick tests to start the order`);
          this.refresh();
          this.router.navigate(['/frontdesk/order'], {
            queryParams: { patientId: a.patientId, appointmentId: a.id }
          });
        }
      },
      error: () => this.toasts.error('Could not check in')
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
    // Pulling a wider window means the FE needs MORE data than the
    // /today endpoints return — kick off a fresh fetch through the
    // range-aware refresh path so the panes actually populate.
    this.refresh();
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
    this.refresh();
  }
  clearCustom() {
    this._customStart.set(null);
    this._customEnd.set(null);
    if (this._dateRange() === 'custom') this._dateRange.set('today');
    this.refresh();
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
      case 'ready': return 'Ready for delivery';
      case 'payments': return 'Payments due';
      default: return '';
    }
  }
  /** Direct navigation to the Results page when reception clicks the
   *  "ready for delivery" alert — skips the local drawer in favour of
   *  the full Results queue with deliver / print actions. */
  goToResults() { this.router.navigateByUrl('/reports'); }

  /** UI flag for the "Download report" button while we fetch + render. */
  protected readonly _downloadingReport = signal<boolean>(false);
  readonly downloadingReport = this._downloadingReport.asReadonly();

  /** Pull the latest final report for the order and render it as a
   *  client-side PDF. Mirrors the invoice download — no server PDF
   *  endpoint required, jsPDF builds the document from the snapshot
   *  the backend already stores on Report.Data. */
  async downloadReport(o: Order) {
    if (this._downloadingReport()) return;
    this._downloadingReport.set(true);
    try {
      const report = await firstValueFrom(
        this.api.get<Report | null>(`/api/reports/by-order/${o.id}`)
      );
      if (!report) {
        this.toasts.warning('No report yet for this order — try again in a moment.');
        return;
      }
      const { generateReportPdf } = await import('../../../shared/utils/report-pdf');
      const resolvedLayouts = await this.fetchResolvedLayouts(report);
      generateReportPdf({ report, resolvedLayouts });
    } catch (err) {
      console.error('[fd] download report failed', err);
      this.toasts.error('Could not download the report');
    } finally {
      this._downloadingReport.set(false);
    }
  }
  /** Walk every test on the report and ask the engine to resolve its
   *  per-test layout against the entered values. Returns a testId →
   *  ResolvedReportLayout map that the PDF generator consumes; the map
   *  is empty for tests without a configured layout (PDF then falls
   *  back to the legacy parameter table for those). */
  private async fetchResolvedLayouts(report: Report): Promise<Record<string, import('../../../shared/models/report-layout.model').ResolvedReportLayout>> {
    const out: Record<string, import('../../../shared/models/report-layout.model').ResolvedReportLayout> = {};
    let tests: Array<{ testId?: string; result?: { values?: Record<string, unknown> } }> = [];
    try {
      const snap = JSON.parse(report.data ?? '{}');
      tests = snap?.tests ?? [];
    } catch { /* malformed — proceed with empty layouts map */ }
    if (tests.length === 0) return out;

    const { ReportLayoutService } = await import('../../../core/services/report-layout.service');
    const svc = this.injector.get(ReportLayoutService);
    await Promise.all(tests.map(async t => {
      if (!t.testId) return;
      try {
        out[t.testId] = await svc.preview(t.testId, (t.result?.values ?? {}) as Record<string, unknown>, []);
      } catch { /* test without a layout — fallback table renders */ }
    }));
    return out;
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

  /** Selected IDs that are also valid orders ready to dispatch — i.e.
   *  intersection of the global selection set with the In-Progress
   *  orders that have at least one collected (not yet dispatched)
   *  tube. The bulk action bar uses this count to enable/disable
   *  the dispatch buttons. */
  readonly dispatchableSelected = computed<string[]>(() => {
    const sel = this._selectedIds();
    return this.visibleOrders()
      .filter(o => sel.has(o.id) && o.samples.some(s => s.status === 'collected'))
      .map(o => o.id);
  });

  /** Plain bulk dispatch — flip every selected order's tubes to
   *  dispatched, no package wrapper. */
  bulkDispatch() {
    const ids = this.dispatchableSelected();
    if (ids.length === 0) { this.toasts.info('Select orders that have collected tubes ready to dispatch.'); return; }
    this.api.post<{ ordersTouched: number; samplesDispatched: number }>(
      '/api/orders/bulk-dispatch', { orderIds: ids }
    ).subscribe({
      next: res => {
        this.toasts.success(`Dispatched ${res.samplesDispatched} sample${res.samplesDispatched === 1 ? '' : 's'} across ${res.ordersTouched} order${res.ordersTouched === 1 ? '' : 's'}`);
        this.clearSelection();
        this.refresh();
      },
      error: e => this.toasts.error(e?.message ?? 'Bulk dispatch failed')
    });
  }

  // ── Dispatch package + QR ─────────────────────────────────
  /** Active dispatch package — set when reception generates one, used
   *  by the modal to show the code + QR + manifest. Null = no modal. */
  private readonly _activePackage = signal<DispatchPackage | null>(null);
  readonly activePackage = this._activePackage.asReadonly();
  /** PNG URL for the QR — uses the same external generator as the
   *  billing UPI QR (same lib, no bundle weight). The QR encodes the
   *  package code so the lab's "scan to receive" reads it directly. */
  readonly activePackageQr = computed<string | null>(() => {
    const p = this._activePackage();
    if (!p) return null;
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(p.code)}`;
  });

  /** Bundle every selected dispatchable order into a single package,
   *  show the modal with QR + code so reception can hand the lab
   *  one scannable token. */
  createDispatchPackage() {
    const ids = this.dispatchableSelected();
    if (ids.length === 0) { this.toasts.info('Pick at least one in-progress order with collected tubes.'); return; }
    this.api.post<DispatchPackage>('/api/dispatch-packages', { orderIds: ids }).subscribe({
      next: pkg => {
        this._activePackage.set(pkg);
        this.toasts.success(`Package ${pkg.code} created with ${pkg.orderCount} order${pkg.orderCount === 1 ? '' : 's'}`);
        this.clearSelection();
        this.refresh();
      },
      error: e => this.toasts.error(e?.message ?? 'Could not create package')
    });
  }
  closeDispatchPackage() { this._activePackage.set(null); }
  /** Copy the package code to clipboard so reception can WhatsApp /
   *  type it to the lab if scanning isn't an option. */
  async copyPackageCode() {
    const p = this._activePackage();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p.code);
      this.toasts.success(`Code ${p.code} copied`);
    } catch {
      this.toasts.warning('Couldn’t copy — read the code from the screen.');
    }
  }

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
    // "Report" step is done once the order has reached validated /
    // partially_validated / delivered / completed — those all mean
    // the lab work is signed off and the report is generated.
    const reportDone = o.status === 'validated' || o.status === 'partially_validated'
                    || o.status === 'delivered'  || o.status === 'completed';
    // "Result" step is done as soon as every test has a value entered
    // or already validated. Differs from reportDone — entered values
    // still need a pathologist's signature before the report exists.
    const allTests = o.samples.flatMap(s => s.tests ?? []);
    const allTestsResulted = allTests.length > 0
      && allTests.every(t => t.status === 'validated' || t.status === 'entered');
    const anyResult = allTests.some(t => t.status === 'validated' || t.status === 'entered');
    return [
      { label: 'Billing', state: billDone ? 'done' : 'active' },
      { label: 'Sample', state: collected ? 'done' : billDone ? 'active' : 'pending' },
      { label: 'Dispatch', state: received ? 'done' : dispatched ? 'done' : collected ? 'active' : 'pending' },
      { label: 'Result', state: allTestsResulted ? 'done' : anyResult ? 'active' : received ? 'active' : 'pending' },
      { label: 'Report', state: reportDone ? 'done' : anyResult ? 'active' : 'pending' }
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
      case 'Report': {
        if (step.state !== 'done') return 'Awaiting validation';
        if (o.status === 'delivered') return 'Report delivered';
        if (o.status === 'partially_validated') return 'Partial ready · awaiting full sign-off';
        // 'validated' / 'completed' → ready for handover at the desk.
        return 'Ready for delivery';
      }
      default: return '';
    }
  }
}
