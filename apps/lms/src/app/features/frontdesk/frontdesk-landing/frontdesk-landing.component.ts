import { DatePipe } from '@angular/common';
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Injector, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { skip } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { AppointmentBookingService } from '../../../core/services/appointment-booking.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { BillingEventsService } from '../../../core/services/billing-events.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { WorkAreaPanelsComponent } from '../../../shared/workflow/work-area-panels.component';
import { ToastService } from '../../../core/services/toast.service';

import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { extractAbhaNumber } from '../../../shared/components/abha-wizard/abha-prefill.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { Appointment, QueueItem, QueueResponse } from '../../../shared/models/appointment.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { Test } from '../../../shared/models/test.model';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import { generateInvoicePdf, invoiceTemplateFieldsFrom, loadImageDataUrl } from '../billing/invoice-pdf';
import { LabelCardComponent } from '../post-payment/label-card.component';
import { printLabelOnly } from '../../../shared/utils/print-label';
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
import flatpickr from 'flatpickr';
import { Patient, patientDisplayName, formatPatientInfo } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AdvancedPatientSearchComponent } from '../advanced-patient-search/advanced-patient-search.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';

type DateRange = 'today' | 'yesterday' | 'tomorrow' | '7d' | 'month' | 'custom';

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

/** A parked order draft read back from localStorage (`pf:order-draft:<id>`).
 *  There's no backend for drafts — order-create writes them, the Draft tab
 *  reads them. `patient` is a snapshot so we can render without a lookup. */
interface DraftOrder {
  patientId: string;
  patient: Patient;
  testIds: string[];
  savedAt: number;
  priority: string;
}

import { InlinePaymentPanelComponent, InlinePaymentResult } from '../order-create/inline-payment-panel.component';

@Component({
  selector: 'pf-frontdesk-landing',
  standalone: true,
  imports: [DatePipe, RouterLink, PatientSearchComponent, AvatarComponent, ChipComponent, CurrencyInrPipe, AdvancedPatientSearchComponent, KpiStripComponent, WorkAreaPanelsComponent, BarcodeScannerModalComponent, LabelCardComponent, InlinePaymentPanelComponent],
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
  private readonly sanitizer = inject(DomSanitizer);
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

  readonly apptDateOptions = [
    { id: 'yesterday' as DateRange, label: 'Yesterday' },
    { id: 'today' as DateRange, label: 'Today' },
    { id: 'tomorrow' as DateRange, label: 'Tomorrow' },
    { id: 'custom' as DateRange, label: 'Custom' },
  ];

  readonly workDateOptions = [
    { id: 'yesterday' as DateRange, label: 'Yesterday' },
    { id: 'today' as DateRange, label: 'Today' },
    { id: 'custom' as DateRange, label: 'Custom' },
  ];

  readonly dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Mocked staff — backend doesn't track duty status yet. */
  readonly staff: StaffMember[] = [
    { id: '1', name: 'Priya Sharma', role: 'Receptionist', status: 'on_duty' },
    { id: '2', name: 'Ravi Kumar', role: 'Phlebotomist', status: 'on_duty' },
    { id: '3', name: 'Dr. Arjun Mehta', role: 'Pathologist', status: 'busy' },
    { id: '4', name: 'Kavita Reddy', role: 'Lab technician', status: 'on_break' },
  ];



  private readonly _apptDateRange = signal<DateRange>('today');
  readonly apptDateRange = this._apptDateRange.asReadonly();

  private readonly _apptCustomStart = signal<string | null>(null);
  private readonly _apptCustomEnd = signal<string | null>(null);
  readonly apptCustomStart = this._apptCustomStart.asReadonly();
  readonly apptCustomEnd = this._apptCustomEnd.asReadonly();

  private readonly _workDateRange = signal<DateRange>('today');
  readonly workDateRange = this._workDateRange.asReadonly();

  private readonly _workCustomStart = signal<string | null>(null);
  private readonly _workCustomEnd = signal<string | null>(null);
  readonly workCustomStart = this._workCustomStart.asReadonly();
  readonly workCustomEnd = this._workCustomEnd.asReadonly();

  // ── Date-filter popovers ──────────────────────────────────────────
  // The Yesterday/Today/Tomorrow/Custom pill rows ate a whole header
  // row. They now collapse behind a single filter icon per pane; the
  // icon shows the active range, tapping it opens a popover with the
  // options. Only one filter popover open at a time.
  private readonly _apptFilterOpen = signal(false);
  private readonly _workFilterOpen = signal(false);
  readonly apptFilterOpen = this._apptFilterOpen.asReadonly();
  readonly workFilterOpen = this._workFilterOpen.asReadonly();

  toggleApptFilter(): void {
    this._workFilterOpen.set(false);
    this._apptFilterOpen.update(v => !v);
  }
  toggleWorkFilter(): void {
    this._apptFilterOpen.set(false);
    this._workFilterOpen.update(v => !v);
  }
  closeDateFilters(): void {
    this._apptFilterOpen.set(false);
    this._workFilterOpen.set(false);
  }

  /** Short label of the active range — shown on the filter icon button. */
  readonly apptRangeLabel = computed(() => {
    const r = this._apptDateRange();
    if (r === 'custom') return this._apptCustomStart() ? 'Custom' : 'Custom';
    return this.apptDateOptions.find(o => o.id === r)?.label ?? 'Today';
  });
  readonly workRangeLabel = computed(() => {
    const r = this._workDateRange();
    if (r === 'custom') return 'Custom';
    return this.workDateOptions.find(o => o.id === r)?.label ?? 'Today';
  });

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


  // Active tabs inside the Left and Right panes — persisted so the user lands
  // on the same tabs next session.
  private static readonly LEFT_TAB_KEY = 'pf.lms.frontdesk.leftTab';
  private readonly _leftTab = signal<'appt' | 'home'>(this.loadLeftTab());
  readonly leftTab = this._leftTab.asReadonly();
  // Workflow-as-source-of-truth: each action is a placeable component. When the
  // admin switches an action OFF in the process workflow, its component vanishes
  // from this screen (no nav/route change — the real Frontdesk stays put).
  private readonly process = inject(ProcessWorkflowService);
  // Placement-aware: the appointment UI lives on Frontdesk only while the action
  // is placed in the frontdesk work-area. Drag it to Lab in /admin/process and it
  // leaves here and renders on the Lab screen instead (no active workflow ⇒ native).
  readonly showAppt = computed(() => {
    const cfg = this.process.active();
    return !cfg ? true : this.process.placedIn('appointment') === 'frontdesk';
  });
  readonly showHome = computed(() => this.process.isEnabled('home_visits'));
  /** The left pane only exists if at least one of its tabs (Appointments /
   *  Home collection) is enabled — otherwise it's hidden and the work pane
   *  fills the row. */
  readonly showLeftPane = computed(() => this.showAppt() || this.showHome());
  readonly showOrder = computed(() => this.process.isEnabled('walk_in_order'));
  readonly showRegister = computed(() => this.process.isEnabled('patient_registration'));
  // If the currently-selected left tab gets disabled, fall back to the other one.
  private readonly _leftTabGuard = effect(() => {
    const appt = this.showAppt(), home = this.showHome();
    if (!appt && home && this._leftTab() === 'appt') this._leftTab.set('home');
    else if (!home && appt && this._leftTab() === 'home') this._leftTab.set('appt');
  });
  setLeftTab(t: 'appt' | 'home') {
    this._leftTab.set(t);
    try { localStorage.setItem(FrontdeskLandingComponent.LEFT_TAB_KEY, t); } catch { /* ignore */ }
  }
  private loadLeftTab(): 'appt' | 'home' {
    try {
      const raw = localStorage.getItem(FrontdeskLandingComponent.LEFT_TAB_KEY);
      return raw === 'home' ? 'home' : 'appt';
    } catch { return 'appt'; }
  }

  private static readonly RIGHT_TAB_KEY = 'pf.lms.frontdesk.rightTab';
  private readonly _rightTab = signal<'ip' | 'done' | 'billing'>(this.loadRightTab());
  readonly rightTab = this._rightTab.asReadonly();
  setRightTab(t: 'ip' | 'done' | 'billing') {
    this._rightTab.set(t);
    // Drafts (localStorage) surface at the top of the In Progress list — re-scan
    // when that tab is opened to catch any saved from a prior order-create visit.
    if (t === 'ip') this.refreshDrafts();
    try { localStorage.setItem(FrontdeskLandingComponent.RIGHT_TAB_KEY, t); } catch { /* ignore */ }
  }
  private loadRightTab(): 'ip' | 'done' | 'billing' {
    try {
      const raw = localStorage.getItem(FrontdeskLandingComponent.RIGHT_TAB_KEY);
      return raw === 'done' ? 'done' : raw === 'billing' ? 'billing' : 'ip';
    } catch { return 'ip'; }
  }

  // ── Draft orders (local-only) ─────────────────────────────
  // order-create parks an in-progress cart in localStorage under
  // `pf:order-draft:<patientId>` so reception can resume it later. There's no
  // backend for drafts — we scan localStorage here, drop stale (>7d) and
  // malformed entries, and surface them as their own work-pane tab.
  private static readonly DRAFT_KEY_PREFIX = 'pf:order-draft:';
  private static readonly DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  private readonly _drafts = signal<DraftOrder[]>([]);
  readonly draftOrders = this._drafts.asReadonly();

  /** Scan localStorage for saved order drafts, newest first. Skips stale
   *  (savedAt older than 7 days) and malformed entries. */
  private loadDrafts(): DraftOrder[] {
    const out: DraftOrder[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(FrontdeskLandingComponent.DRAFT_KEY_PREFIX)) continue;
        let raw: string | null;
        try { raw = localStorage.getItem(key); } catch { continue; }
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as { savedAt?: number; priority?: string; testIds?: string[]; patient?: Patient };
          const savedAt = parsed?.savedAt;
          if (typeof savedAt !== 'number' || Date.now() - savedAt > FrontdeskLandingComponent.DRAFT_TTL_MS) continue;
          if (!parsed.patient || !Array.isArray(parsed.testIds)) continue;
          out.push({
            patientId: key.slice(FrontdeskLandingComponent.DRAFT_KEY_PREFIX.length),
            patient: parsed.patient,
            testIds: parsed.testIds.filter(id => typeof id === 'string'),
            savedAt,
            priority: parsed.priority ?? 'Normal',
          });
        } catch { /* malformed JSON — skip this entry */ }
      }
    } catch { /* localStorage unavailable */ }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Re-scan localStorage and publish the draft list. */
  private refreshDrafts() { this._drafts.set(this.loadDrafts()); }

  /** Resume a parked draft — order-create auto-restores it for this patient. */
  resumeDraft(d: DraftOrder) {
    this.router.navigateByUrl('/frontdesk/order?patientId=' + d.patientId);
  }

  /** Discard a parked draft: drop its localStorage key, reload the list, toast. */
  discardDraft(d: DraftOrder, ev?: Event) {
    ev?.stopPropagation();
    try { localStorage.removeItem(FrontdeskLandingComponent.DRAFT_KEY_PREFIX + d.patientId); } catch { /* ignore */ }
    this.refreshDrafts();
    this.toasts.success('Draft discarded');
  }

  // ── Tab visibility ────────────────────────────────────────
  // In progress + Completed are ALWAYS displayed. Payments due is
  // hide/show-configurable per branch by an admin. We read an optional
  // `showPaymentsDueTab` flag off the branch lab config: absent/undefined
  // keeps the tab visible (preserves today's behaviour), an explicit `false`
  // hides it. NOTE: the flag is not yet part of the BranchLabConfig model,
  // the backend, or the admin Lab Settings UI, so until those are added this
  // always resolves to visible (see the wiring note in the delivery report).
  readonly showPaymentsDue = computed(() =>
    (this.labCfg.config() as { showPaymentsDueTab?: boolean } | null)?.showPaymentsDueTab !== false
  );
  /** If Payments due is hidden while it happens to be the active tab, fall
   *  back to In progress so the pane never renders an empty/absent tab. */
  private readonly _rightTabGuard = effect(() => {
    if (!this.showPaymentsDue() && this._rightTab() === 'billing') {
      this._rightTab.set('ip');
    }
  });

  // ── Mobile list selector ──────────────────────────────────
  // Phones (≤640px) drop the pane accordion for a single list with a
  // dropdown picker (Appointments / In progress / Completed). It's a
  // thin projection over expandedPane + active tabs — desktop/iPad layout
  // is untouched.
  readonly mobileListOpen = signal(false);
  readonly mobileList = computed<'appt' | 'ip' | 'done' | 'home' | 'billing'>(() =>
    this.expandedPane() === 'appt' ? this.leftTab() : this.rightTab());
  readonly mobileListLabel = computed(() => {
    switch (this.mobileList()) {
      case 'appt': return 'Appointments';
      case 'ip': return 'In progress';
      case 'home': return 'Home collection';
      case 'billing': return 'Payments due';
      default: return 'Completed';
    }
  });
  setMobileList(v: 'appt' | 'ip' | 'done' | 'home' | 'billing') {
    if (v === 'appt' || v === 'home') {
      this._expandedPane.set('appt');
      this.setLeftTab(v);
    } else {
      this._expandedPane.set('work');
      this.setRightTab(v);
    }
    this.mobileListOpen.set(false);
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
      let n = raw ? Number(raw) : 50;
      if (!Number.isFinite(n) || n < 15 || n > 85) {
        n = 50;
      }
      if (typeof window !== 'undefined') {
        const width = window.innerWidth;
        if (width > 0) {
          const avail = Math.max(500, width - 80);
          const minPx = 260;
          const handlePx = 8;
          const minPct = (minPx / avail) * 100;
          const maxPct = ((avail - minPx - handlePx) / avail) * 100;
          n = Math.max(minPct, Math.min(maxPct, n));
        }
      }
      return n;
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

  readonly activeShareMenuOrderId = signal<string | null>(null);

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
  private readonly _queueItems = signal<QueueItem[]>([]);
  private readonly _orders = signal<Order[]>([]);
  private readonly _homeCollections = signal<Appointment[]>([]);
  
  readonly homeCollections = computed(() => {
    return this._homeCollections().filter(a => this.inApptRange(a.appointmentDate));
  });

  private readonly _tests = signal<Test[]>([]);
  readonly testsById = computed(() => {
    const m = new Map<string, string>();
    for (const t of this._tests()) m.set(t.id, t.name);
    return m;
  });
  // The home-collection request opened in the detail drawer.
  private readonly _selectedHc = signal<Appointment | null>(null);
  readonly selectedHc = this._selectedHc.asReadonly();
  private readonly _bills = signal<Bill[]>([]);
  private readonly _selectedOrder = signal<Order | null>(null);

  readonly appointments = this._appointments.asReadonly();
  readonly orders = this._orders.asReadonly();
  readonly bills = this._bills.asReadonly();
  readonly selectedOrder = this._selectedOrder.asReadonly();

  // Always the FIRST word only — profiles routinely carry the full name in
  // firstName, which made the greeting read "Good day, First Last".
  readonly firstName = computed(() => {
    const raw = this.auth.user()?.firstName || this.auth.user()?.displayName || 'there';
    return raw.trim().split(/\s+/)[0] || 'there';
  });

  /** Today's date — shown as a small eyebrow above the greeting. */
  readonly today = new Date();

  // Search bar is now permanently visible in the header layout.

  readonly statusHint = computed(() => {
    const a = this._appointments().length;
    const o = this._orders().length;
    const due = this.paymentsDue().length;
    return `${a} scheduled · ${o} orders · ${due} payments due`;
  });

  // Date helpers ---------------------------------------------
  private getRangeBounds(r: DateRange, customStart: string | null, customEnd: string | null): { start: number; end: number; isToday: boolean } {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let start = now.getTime();
    let end = now.getTime() + 86_400_000;

    switch (r) {
      case 'yesterday':
        start = now.getTime() - 86_400_000;
        end = now.getTime();
        break;
      case 'today':
        start = now.getTime();
        end = now.getTime() + 86_400_000;
        break;
      case 'tomorrow':
        start = now.getTime() + 86_400_000;
        end = now.getTime() + 2 * 86_400_000;
        break;
      case '7d':
        start = now.getTime() - 7 * 86_400_000;
        end = now.getTime() + 86_400_000;
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        end = now.getTime() + 86_400_000;
        break;
      case 'custom':
        if (customStart) {
          start = this.dayStart(customStart).getTime();
          const e = customEnd ?? customStart;
          end = this.dayStart(e).getTime() + 86_400_000;
        } else {
          start = now.getTime();
          end = now.getTime() + 86_400_000;
        }
        break;
    }

    const isToday = r === 'today' && start === now.getTime() && end === now.getTime() + 86_400_000;
    return { start, end, isToday };
  }

  readonly apptBounds = computed(() => this.getRangeBounds(this._apptDateRange(), this._apptCustomStart(), this._apptCustomEnd()));
  readonly workBounds = computed(() => this.getRangeBounds(this._workDateRange(), this._workCustomStart(), this._workCustomEnd()));

  private inApptRange(d: Date | string | undefined): boolean {
    if (!d) return false;
    const when = new Date(d).getTime();
    const bounds = this.apptBounds();
    return when >= bounds.start && when < bounds.end;
  }

  private inWorkRange(d: Date | string | undefined): boolean {
    if (!d) return false;
    const when = new Date(d).getTime();
    const bounds = this.workBounds();
    return when >= bounds.start && when < bounds.end;
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
  // Show the actionable appointments on the operational landing: booked (needs
  // check-in), confirmed, and checked-in. Checked-in ones STAY here (as a
  // "Resume order" card) because check-in no longer auto-creates an order — if
  // the FD backs out of the order page the patient must still be reachable.
  // Terminal states (completed / cancelled / no-show) drop off (they remain on
  // the calendar route), as do home collections.
  readonly visibleAppointments = computed(() =>
    this._appointments().filter(a =>
      this.inApptRange(a.appointmentDate)
      && a.status !== 'cancelled'
      && a.status !== 'completed'
      && a.status !== 'no_show'
      && a.collectionType !== 'home_collection'
    )
  );
  /** "In progress" — actively-moving orders. Excludes terminal /
   *  ready-to-deliver states; those land in completedOrders below so
   *  the FD board has two clear panes. */
  readonly visibleOrders = computed(() =>
    this._orders().filter(o => {
      const active = o.status !== 'completed'
        && o.status !== 'validated'
        && o.status !== 'delivered'
        && o.status !== 'cancelled';
      if (!active) return false;

      // If the order is partially validated and we are viewing today's work,
      // it should be visible in the queue (since today's validation activity
      // brought it into the Today feed).
      if (o.status === 'partially_validated' && this.workBounds().isToday) {
        return true;
      }

      return this.inWorkRange(o.createdAt);
    })
  );
  /** Order ids that still carry an outstanding balance (from the branch's
   *  /api/billing/outstanding feed — which only returns non-settled bills).
   *  Fully-paid orders never appear here. Used to keep unpaid work OUT of the
   *  Completed pane: a validated-but-unpaid order belongs in Payments due. */
  private readonly _unpaidOrderIds = computed(() => {
    const s = new Set<string>();
    for (const b of this._bills()) if (b.balance > 0) s.add(b.orderId);
    return s;
  });
  /** "Completed" — orders that are BOTH report-generated (validated /
   *  delivered / completed) AND payment-completed (no outstanding balance).
   *  Drives the third FD pane next to In Progress so reception can see at a
   *  glance which patients are ready to hand over. Sorted ascending by
   *  creation time so the oldest ready-for-handover sits on top. */
  readonly completedOrders = computed(() => {
    const unpaid = this._unpaidOrderIds();
    return this._orders().filter(o => {
      const done = o.status === 'validated'
        || o.status === 'delivered' || o.status === 'completed';
      if (!done) return false;
      // Payment must be completed too — an order with an outstanding balance
      // stays in Payments due until it's settled, not here.
      if (unpaid.has(o.id)) return false;
      // A report completed TODAY for an order created on an earlier day must
      // still surface for hand-over. The Today feed includes such orders (see
      // ListTodayAsync), so don't gate completed work by creation date in the
      // today view; only constrain by creation date for historical ranges.
      return this.workBounds().isToday ? true : this.inWorkRange(o.createdAt);
    }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });
  /** Subset of completedOrders still needing delivery (for the alert
   *  chip + ready count). */
  readonly readyForPickup = computed(() =>
    this.completedOrders().filter(o => o.status !== 'delivered')
  );
  readonly paymentsDue = computed(() =>
    this._bills().filter(b => b.balance > 0)
  );

  private readonly _billingOrdersMap = signal<Record<string, Order>>({});
  private readonly _fetchingOrderIds = new Set<string>();

  readonly paymentsDueOrders = computed(() => {
    const map = this._billingOrdersMap();
    const ordersToday = this._orders();
    const pendingBills = this._bills().filter(b => b.balance > 0);
    const list: Order[] = [];
    for (const b of pendingBills) {
      let o = ordersToday.find(ord => ord.id === b.orderId);
      if (!o) {
        o = map[b.orderId];
      }
      if (o) {
        list.push(o);
      }
    }
    return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });

  getBillBalance(orderId: string): number {
    return this._bills().find(b => b.orderId === orderId)?.balance ?? 0;
  }

  private fetchOrdersForBills(bills: Bill[]) {
    const map = { ...this._billingOrdersMap() };
    const ordersToday = this._orders();
    const pendingBills = bills.filter(b => b.balance > 0);
    for (const b of pendingBills) {
      if (ordersToday.some(ord => ord.id === b.orderId)) {
        continue;
      }
      if (map[b.orderId]) {
        continue;
      }
      if (this._fetchingOrderIds.has(b.orderId)) {
        continue;
      }
      this._fetchingOrderIds.add(b.orderId);
      this.api.get<Order>(`/api/orders/${b.orderId}`).subscribe({
        next: o => {
          if (o) {
            this._billingOrdersMap.update(m => ({ ...m, [b.orderId]: o }));
          }
          this._fetchingOrderIds.delete(b.orderId);
        },
        error: () => {
          this._fetchingOrderIds.delete(b.orderId);
        }
      });
    }
  }

  readonly selectedBillingOrder = signal<Order | null>(null);
  readonly selectedBill = signal<Bill | null>(null);
  readonly confirmingPayment = signal(false);
  /** After a due is cleared in the drawer, if the samples are all collected we
   *  keep the drawer open and offer "Dispatch" so the FD doesn't have to go back
   *  to the landing to release the samples. */
  readonly paidReadyToDispatch = signal(false);

  openPaymentDrawer(o: Order) {
    this.paidReadyToDispatch.set(false);
    this.selectedBillingOrder.set(o);
    this.api.get<Order>(`/api/orders/${o.id}`).subscribe({
      next: fullOrder => {
        if (fullOrder) {
          this.selectedBillingOrder.set(fullOrder);
        }
      }
    });

    const b = this._bills().find(bill => bill.orderId === o.id);
    if (b) {
      this.selectedBill.set(b);
    } else {
      this.api.post<Bill>('/api/billing/', { orderId: o.id, discount: 0 }).subscribe({
        next: bill => this.selectedBill.set(bill)
      });
    }
  }

  closePaymentDrawer() {
    this.selectedBillingOrder.set(null);
    this.selectedBill.set(null);
    this.paidReadyToDispatch.set(false);
  }

  /** Can we offer Dispatch straight after clearing the due? (all tubes collected
   *  + user can dispatch). Payment hold is moot here — we just cleared it. */
  private dispatchEligibleAfterPay(o: Order): boolean {
    if (!this.auth.hasPermission('dispatch_sample')) return false;
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.every(s => s.status === 'collected');
  }

  /** Dispatch from the settle drawer, then close + refresh the landing. */
  dispatchFromDrawer(o: Order) {
    this.confirmingPayment.set(true);
    this.api.patch<{ dispatched: number }>(`/api/orders/${o.id}/dispatch`, {}).subscribe({
      next: () => {
        this.confirmingPayment.set(false);
        this.toasts.success('Samples dispatched');
        this.closePaymentDrawer();
        this.refresh();
      },
      error: err => {
        this.confirmingPayment.set(false);
        this.toasts.error(err.message || 'Failed to dispatch');
      }
    });
  }

  orderTests(o: Order): any[] {
    const list: any[] = [];
    for (const s of o.samples ?? []) {
      for (const t of s.tests ?? []) {
        list.push(t);
      }
    }
    return list;
  }

  confirmOutstandingPayment(o: Order, b: Bill, ev: InlinePaymentResult) {
    // A due is one-time: it must be cleared, never re-deferred. The "Pay later"
    // tile is hidden in settle mode, but guard the emit too.
    if (ev.mode === 'later') {
      this.toasts.error('This balance must be cleared — pay by Cash or UPI.');
      return;
    }
    this.confirmingPayment.set(true);
    const amount = b.balance;
    this.api.post<Bill>(`/api/billing/${b.id}/payment`, {
      amount,
      mode: ev.mode,
      referenceNo: ev.referenceNo
    }).subscribe({
      next: () => {
        this.confirmingPayment.set(false);
        this.toasts.success('Payment recorded — balance cleared');
        this.refresh();
        // Samples already collected? Keep the drawer open and offer Dispatch so
        // the FD can release them without hopping back to the landing.
        if (this.dispatchEligibleAfterPay(o)) {
          this.paidReadyToDispatch.set(true);
        } else {
          this.closePaymentDrawer();
        }
      },
      error: err => {
        this.confirmingPayment.set(false);
        this.toasts.error(err.message || 'Failed to record payment');
      }
    });
  }

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



    // (Removed the "N reports ready for delivery" toast — it fired on the
    // initial data load every time the user navigated to the front desk, which
    // read as noise rather than a useful new-arrival cue.)

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
    // Re-fetch the active workflow each visit so toggles made in /admin/process
    // (e.g. disabling Appointments / Home visits) reflect here immediately.
    this.process.refreshActive();
    this.refresh();
    // Drafts are local-only — load them once on init so the tab badge is
    // correct even before the Draft tab is opened.
    this.refreshDrafts();
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
    this.closeInvoicePreview();
  }

  refresh() {
    // Fetch Appointments based on apptBounds
    const apptB = this.apptBounds();
    if (apptB.isToday) {
      this.api.get<Appointment[]>('/api/appointments/today').subscribe({
        next: l => this._appointments.set(l ?? []),
      });
    } else {
      const params = new URLSearchParams({
        from: new Date(apptB.start).toISOString(),
        to:   new Date(apptB.end).toISOString()
      });
      this.api.get<Appointment[]>(`/api/appointments?${params}`).subscribe({
        next: l => this._appointments.set(l ?? []),
        error: () => this._appointments.set([])
      });
    }

    // Fetch Queue items to get correct tokens for checked-in/completed patients
    this.api.get<QueueResponse>('/api/appointments/queue').subscribe({
      next: r => this._queueItems.set(r?.items ?? []),
      error: () => this._queueItems.set([])
    });

    // Fetch Orders based on workBounds
    const workB = this.workBounds();
    if (workB.isToday) {
      this.fetchOrdersWithEtag();
    } else {
      const params = new URLSearchParams({
        from: new Date(workB.start).toISOString(),
        to:   new Date(workB.end).toISOString()
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

    // Fetch outstanding bills (branch-scoped): pay-later remainders / partial
    // payments (balance > 0) and refunds owed (balance < 0). This is what the
    // "Payments due" drawer lists so a returning patient with a balance can be
    // found and their remaining balance collected. (Previously this hit the
    // /lookup resolver with a dummy code, so the drawer was always empty.)
    this.api.get<{ due: Bill[]; refundsOwed: Bill[] }>('/api/billing/outstanding').subscribe({
      next: r => {
        const bills = [...(r?.due ?? []), ...(r?.refundsOwed ?? [])];
        this._bills.set(bills);
        this.fetchOrdersForBills(bills);
      },
      error: () => { /* endpoint may not exist; silently ignore */ }
    });

    // Fetch open home-collection requests for the Home Collection tab.
    this.api.get<Appointment[]>('/api/home-collection/all').subscribe({
      next: l => this._homeCollections.set(l ?? []),
      error: () => this._homeCollections.set([])
    });

    // Test catalogue (once) — used to show requested-test names in the
    // home-collection detail.
    if (this._tests().length === 0) {
      this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
    }
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

  @HostListener('window:resize')
  onResize() {
    const el = this.apptSplitEl()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const minPx = 260;
    const handlePx = 8;
    const minPct = Math.max(15, (minPx / rect.width) * 100);
    const maxPct = Math.min(85, ((rect.width - minPx - handlePx) / rect.width) * 100);
    const clamped = Math.max(minPct, Math.min(maxPct, this._twoPaneSplit()));
    if (clamped !== this._twoPaneSplit()) {
      this._twoPaneSplit.set(clamped);
      const firstPane = el.querySelector<HTMLElement>(':scope > .pf-appt-split__pane');
      if (firstPane) firstPane.style.flexBasis = clamped + '%';
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.pf-share-wrapper')) {
      this.activeShareMenuOrderId.set(null);
    }
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
    const minPx = 260;
    const handlePx = 8;
    const minPct = Math.max(15, (minPx / rect.width) * 100);
    const maxPct = Math.min(85, ((rect.width - minPx - handlePx) / rect.width) * 100);
    const clamped = Math.max(minPct, Math.min(maxPct, raw));
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
      const el = this.apptSplitEl()?.nativeElement;
      let minPct = 15;
      let maxPct = 85;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          const minPx = 260;
          const handlePx = 8;
          minPct = Math.max(15, (minPx / rect.width) * 100);
          maxPct = Math.min(85, ((rect.width - minPx - handlePx) / rect.width) * 100);
        }
      }
      const next = Math.max(minPct, Math.min(maxPct, this._twoPaneSplit() + step));
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

  openRegister() { this.router.navigate(['/frontdesk/patients/new']); }

  // ── QR / barcode scanner ──────────────────────────────────
  // The header's "Scan QR" button opens the shared scanner modal; a
  // decoded value routes exactly like the search bar would. Rendered in
  // this component's template (like my-work) — the landing's other
  // fixed-position modals already overlay the full viewport, so there's
  // no backdrop-filter containing-block problem here.
  private readonly _qrScannerOpen = signal(false);
  readonly qrScannerOpen = this._qrScannerOpen.asReadonly();
  openQrScanner() { this._qrScannerOpen.set(true); }
  closeQrScanner() { this._qrScannerOpen.set(false); }

  /** A scanned code → same paths the typed search uses. Order/track QRs
   *  encode full URLs (…/o/{id} on invoices, …/track/{token} on the
   *  patient copy) — open those directly. Anything else (MRN / phone on
   *  a patient card) runs through the same lookup the search field's
   *  typeahead uses and opens the top match, mirroring how Enter picks
   *  the highlighted first result. */
  onQrScanned(code: string) {
    this._qrScannerOpen.set(false);
    const text = (code || '').trim();
    if (!text) return;
    const order = text.match(/\/o\/([0-9a-fA-F-]{6,})/);
    if (order) { this.router.navigate(['/o', order[1]]); return; }
    const track = text.match(/\/track\/([^/?#\s]+)/);
    if (track) { this.router.navigate(['/track', track[1]]); return; }
    // ABHA card QR / number → pull the 14-digit ABHA and open the patient it's
    // linked to (backend patient search matches abhaId).
    const abha = extractAbhaNumber(text);
    const term = abha || text;
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(term)}&limit=10`).subscribe({
      next: list => {
        const arr = list ?? [];
        const p = (abha ? arr.find(x => (x.abhaId || '').replace(/\D/g, '') === abha) : undefined) ?? arr[0];
        if (p) this.openProfile(p);
        else this.toasts.warning('No patient matches that ABHA / code');
      },
      error: () => this.toasts.warning('No match for that code'),
    });
  }
  openProfile(p: Patient) { this.router.navigate(['/frontdesk/patients', p.id]); }
  /** Order-drawer shortcut → the patient's profile page. */
  openPatientProfile(o: Order) {
    if (!o.patientId) { this.toasts.error('No patient linked to this order'); return; }
    this.router.navigate(['/frontdesk/patients', o.patientId]);
  }
  newOrderFor(p: Patient) {
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: p.id } });
  }
  bookAppointmentFor(p: Patient) {
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: p.id } });
  }
  openAppointment(a: Appointment) {
    if (a.patientId) this.router.navigate(['/frontdesk/patients', a.patientId]);
  }

  // ── Home-collection request detail ───────────────────────────────
  openHomeCollection(a: Appointment) { this._selectedHc.set(a); }
  closeHomeCollection() { this._selectedHc.set(null); }

  /** Resolve a home collection's pre-booked test ids to names. */
  homeCollectionTests(a: Appointment | null): string[] {
    if (!a?.testIds) return [];
    const map = this.testsById();
    return a.testIds.split(',').map(s => s.trim()).filter(Boolean)
      .map(id => map.get(id) ?? id.slice(0, 8));
  }
  hcMapUrl(a: Appointment): string | null {
    if (a.latitude != null && a.longitude != null) {
      return `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
    }
    if (a.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address + ' ' + (a.pincode ?? ''))}`;
    return null;
  }
  openOrder(o: Order) { this._selectedOrder.set(o); }
  /** Build a fresh order pre-populated with the tests from a prior order.
   *  Routes through order-create with `?fromOrderId=…` which triggers
   *  preselectFromOrder() there — the catalog auto-fills, the
   *  receptionist confirms or edits before clicking Create Order. */
  repeatOrder(o: Order) {
    if (!o.patientId) return;
    this._selectedOrder.set(null);
    this.router.navigate(['/frontdesk/order'], {
      queryParams: { patientId: o.patientId, fromOrderId: o.id }
    });
  }

  // Only show the inline "Collect Sample" action when reception owns collection
  // at this branch (dedicated_counter mode routes to a separate queue) and the
  // order has actually been billed (status=billed). Deep-links into /lab/collect
  // so the existing scan/pick flow handles everything downstream.
  // Critical: hide the action once ANY sample has moved past 'pending'. The
  // order status alone (often still 'billed' until every tube is drawn) is
  // not enough — re-prompting collection on a partially or fully collected
  // order would let users overwrite drawn tubes.
  showCollectOn(o: Order): boolean {
    if (!this.labCfg.collectsAtFrontdesk()) return false;
    if (!this.auth.hasPermission('collect_sample')) return false;
    // Collection is decoupled from payment: a pay-later order stays 'created'
    // (invoice may be unpaid) but its tubes can still be drawn. Allow collect
    // on both 'created' and 'billed' as long as no tube has moved past pending.
    if (o.status !== 'billed' && o.status !== 'created') return false;
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
  // ── Label reprint (no bill, no navigation) ───────────────────────
  /** Order whose tube labels are being reprinted — renders the hidden
   *  print-only label sheet in the template while set. */
  private readonly _reprintOrder = signal<Order | null>(null);
  readonly reprintOrder = this._reprintOrder.asReadonly();
  private readonly _reprintLoading = signal(false);
  readonly reprintLoading = this._reprintLoading.asReadonly();

  /** Reprint the tube labels straight from the landing. Fetches the full
   *  order (guarantees samples + barcodes regardless of how slim the
   *  today-feed row was), renders the same label cards post-payment
   *  uses into an off-screen `.pf-print-label` block, then runs the
   *  label-only print path — no bill required, no route change. */
  reprintLabels(o: Order) {
    if (this._reprintLoading()) return;
    this._reprintLoading.set(true);
    this.api.get<Order>(`/api/orders/${o.id}`).subscribe({
      next: full => {
        this._reprintLoading.set(false);
        if (!full?.samples?.length) {
          this.toasts.warning('No samples on this order to print');
          return;
        }
        this._reprintOrder.set(full);
        // Give the off-screen label cards a beat to paint their barcodes
        // (JsBarcode is sync but QRCode.toCanvas is async) before printing.
        setTimeout(() => {
          printLabelOnly();
          // Keep the sheet mounted until the print dialog has definitely
          // consumed it (print() isn't blocking on every platform).
          setTimeout(() => this._reprintOrder.set(null), 2000);
        }, 350);
      },
      error: () => {
        this._reprintLoading.set(false);
        this.toasts.error('Could not load the order for label reprint');
      }
    });
  }

  // ── Post-billing modify / cancel (supervisor-gated) ──────────────
  readonly refundModes = [{ key: 'cash', label: 'Cash' }, { key: 'upi', label: 'UPI' }, { key: 'card', label: 'Card' }];
  readonly cancelTarget = signal<Order | null>(null);
  readonly cancelReason = signal('');
  readonly cancelRefundMode = signal('cash');
  readonly cancelling = signal(false);

  /** Modify allowed at any live stage (the backend blocks removing a validated
   *  test). Hidden once the order is cancelled. */
  canModifyOrder(o: Order): boolean {
    return this.auth.hasPermission('modify_order') && o.status !== 'cancelled';
  }
  canCancelOrder(o: Order): boolean {
    return this.auth.hasPermission('cancel_order') && o.status !== 'cancelled';
  }

  /** Open the order-create screen in EDIT mode — same tests pre-filled, saving
   *  recomputes the bill and routes to collect-the-difference / refund. */
  modifyOrder(o: Order) {
    if (!o.patientId) return;
    this._selectedOrder.set(null);
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: o.patientId, editOrderId: o.id } });
  }

  openCancel(o: Order) {
    this.cancelReason.set('');
    this.cancelRefundMode.set('cash');
    this.cancelTarget.set(o);
  }

  confirmCancel() {
    const o = this.cancelTarget();
    if (!o || this.cancelling()) return;
    this.cancelling.set(true);
    this.api.patch(`/api/orders/${o.id}/cancel`, { reason: this.cancelReason().trim() || null, refundMode: this.cancelRefundMode() })
      .subscribe({
        next: () => {
          this.cancelling.set(false);
          this.cancelTarget.set(null);
          this._selectedOrder.set(null);
          this.toasts.success('Order cancelled — any payment refunded');
          this.refresh();
        },
        error: (e) => {
          this.cancelling.set(false);
          this.toasts.error(ApiError.from(e).message);
        }
      });
  }
  /** Reception jumps into the billing screen for this order. */
  /** Invoice is viewable both during billing (bill created, maybe unpaid — the
   *  order is still 'created') and post-billing (paid and beyond). Hidden only
   *  for an abandoned draft or a cancelled order. Opens the billing screen,
   *  which shows the invoice (read/print state once paid). */
  canViewInvoice(o: Order): boolean {
    return o.status !== 'draft' && o.status !== 'cancelled';
  }
  // ── Invoice preview modal (in-app, no browser popup) ────────
  /** Safe object-URL of the rendered PDF, bound to the preview iframe. */
  protected readonly invoicePreviewUrl = signal<SafeResourceUrl | null>(null);
  /** Raw blob URL — kept so we can revoke it and feed the print iframe. */
  private invoiceBlobUrl: string | null = null;
  protected readonly invoicePreviewNumber = signal('');
  protected readonly invoiceLoading = signal(false);

  /** Fit-to-width scale for the phone invoice preview. The PDF iframe renders
   *  the A4 page at its intrinsic ~794px CSS width (595.28pt × 96/72), so on a
   *  narrow screen we scale it down to the modal's content width (= 100vw − 32px
   *  gutters) — keeping the whole bill width visible with nothing clipped. Capped
   *  at 1 so it never upscales. Only consumed by the ≤640px CSS; ignored above. */
  protected invoicePreviewScale(): number {
    const w = typeof window !== 'undefined' ? window.innerWidth : 794;
    return Math.min(1, Math.max(0.1, (w - 32) / 794));
  }

  /** Open the invoice in an in-app preview (fetches the bill + letterhead +
   *  tracking QR and renders the A4 invoice) — distinct from collect-payment. */
  async viewInvoice(o: Order) {
    if (this.invoiceLoading()) return;
    this.invoiceLoading.set(true);
    try {
      const bill = await firstValueFrom(
        this.api.post<Bill>('/api/billing/', { orderId: o.id, discount: 0 })
      );
      let tpl: any = null;
      try { tpl = await firstValueFrom(this.api.get<any>('/api/config/invoice-template')); }
      catch { /* letterhead is optional */ }
      await this.emitInvoicePdf(o, bill, tpl);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.invoiceLoading.set(false);
    }
  }

  private async emitInvoicePdf(o: Order, bill: Bill, tpl: any) {
    const mode = tpl?.documentMode ?? 'auto';
    const docTitle = mode === 'bill_of_supply' ? 'BILL OF SUPPLY'
      : mode === 'tax_invoice' ? 'TAX INVOICE'
      : (bill.totalTax > 0 ? 'TAX INVOICE' : 'BILL OF SUPPLY');

    // Result-tracking QR (PNG) — the user wants this on every invoice, so we
    // always try to render it (no letterhead gate). If the token can't be
    // minted or the QR fails, surface WHY rather than silently dropping it.
    let qrDataUrl: string | undefined;
    let orderQrDataUrl: string | undefined;
    try {
      const QRCode = (await import('qrcode')).default;
      const res = await firstValueFrom(
        this.api.get<{ token: string }>(`/api/orders/${o.id}/track-token`)
      );
      if (res?.token) {
        qrDataUrl = await QRCode.toDataURL(`${window.location.origin}/track/${res.token}`, { margin: 1, width: 220 });
      } else {
        this.toasts.warning('Invoice ready, but the tracking QR could not be generated (no token returned).');
      }
      // Staff order QR — scan to open the order.
      orderQrDataUrl = await QRCode.toDataURL(`${window.location.origin}/o/${o.id}`, { margin: 1, width: 220 });
    } catch (err: any) {
      console.error('[invoice] tracking QR failed', err);
      this.toasts.warning(`Invoice ready, but the tracking QR failed: ${err?.message ?? 'request error'}`);
    }

    const logoDataUrl = tpl?.showLogo === false ? undefined : await loadImageDataUrl(tpl?.logoUrl, environment.apiUrl);
    try {
      const blobUrl = generateInvoicePdf({
        bill, order: o,
        invoiceNumber: bill.invoiceNumber ?? '',
        effectivePayable: bill.totalPayable,
        tatLabel: '',
        docTitle,
        qrDataUrl, orderQrDataUrl, logoDataUrl,
        // The BILL's cashier (server-resolved: who billed/collected), so a later
        // download by another user never swaps the attribution.
        cashierName: bill.cashierName || this.auth.user()?.displayName || undefined,
        cashierSignatureDataUrl: bill.cashierSignatureUrl || undefined,
        ...invoiceTemplateFieldsFrom(tpl),
        // Always carry a name so the invoice never reads "Prefrontal Lab":
        // configured letterhead first, else the tenant's own name.
        practice: {
          name: (tpl?.labName || this.auth.user()?.tenantName) || undefined,
          address: tpl?.address || undefined,
          phone: tpl?.phone || undefined,
          email: tpl?.email || undefined,
          gstin: tpl?.showGstin === false ? undefined : (tpl?.gstin || undefined),
        },
        action: 'blob',
      });
      if (!blobUrl) { this.toasts.error('Could not generate the invoice PDF'); return; }
      this.closeInvoicePreview(); // revoke any prior blob first
      this.invoiceBlobUrl = blobUrl;
      this.invoicePreviewNumber.set(bill.invoiceNumber ?? 'Invoice');
      this.invoicePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl));
    } catch { this.toasts.error('Could not generate the invoice PDF'); }
  }

  /** Download the previewed PDF (anchor on the same blob — no re-render). */
  downloadInvoice() {
    if (!this.invoiceBlobUrl) return;
    const a = document.createElement('a');
    a.href = this.invoiceBlobUrl;
    a.download = `${this.invoicePreviewNumber() || 'invoice'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Open the browser print dialog for the previewed PDF via a hidden iframe. */
  printInvoicePreview() {
    const blobUrl = this.invoiceBlobUrl;
    if (!blobUrl) return;
    // The preview is already on screen, so a failure needs no tab fallback.
    // The blob stays alive for that preview — closeInvoicePreview revokes it.
    printPdfBlobUrl(blobUrl, { onFallback: () => { /* preview already visible */ } });
  }

  closeInvoicePreview() {
    if (this.invoiceBlobUrl) {
      try { URL.revokeObjectURL(this.invoiceBlobUrl); } catch { /* noop */ }
      this.invoiceBlobUrl = null;
    }
    this.invoicePreviewUrl.set(null);
  }
  goToBilling(o: Order) {
    // Already billed with a due → settle it in the in-place drawer (tests +
    // Cash/UPI for the balance). Only a genuinely unbilled order needs the full
    // order-create page (discount + first payment).
    if (this.getBillBalance(o.id) > 0) { this.openPaymentDrawer(o); return; }
    this.router.navigate(['/frontdesk/order'], { queryParams: { orderId: o.id } });
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

  /** Chip label that reflects the tubes' real state: the order status can lag
   *  at 'sample_collected' after the FD dispatches (the backend keeps it there
   *  until the lab receives), so when the order reads collected but the tubes
   *  have actually been dispatched / received, show the further-along state.
   *  Past the lab (validated/delivered/etc.) the raw status wins. */
  effectiveStatusLabel(o: Order): string {
    if (o.status === 'sample_collected' || o.status === 'collected') {
      const ss = this.sampleStatus(o);
      if (ss === 'received') return 'In Lab';
      if (ss === 'dispatched') return 'Dispatched';
    }
    return this.statusLabel(o.status);
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
    // Payment hold (server-computed): dispatch WOULD be rejected — the card
    // shows "Bill" (showBillInsteadOfDispatch) in this slot instead.
    if (o.paymentHold) return false;
    const samples = o.samples ?? [];
    if (samples.length === 0) return false;
    const allCollected = samples.every(s => s.status === 'collected');
    return allCollected;
  }

  /** Same all-collected moment as showDispatchOn, but the order is under a
   *  payment hold — offer "Bill" (→ billing screen) in the Dispatch slot. */
  showBillInsteadOfDispatch(o: Order): boolean {
    if (!o.paymentHold) return false;
    // The standing "Bill" button (status 'created') already covers it — don't
    // render two Bill buttons on one card.
    if (o.status === 'created' && this.showCreateBillOn(o)) return false;
    if (!this.auth.hasPermission('create_bill') && !this.auth.hasPermission('create_order')) return false;
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.every(s => s.status === 'collected');
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
      error: e => this.toasts.error(ApiError.from(e).message)
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
    // Settle the due in the same in-place drawer the payments-due card uses
    // (loads the tests + Cash/UPI for the balance) rather than bouncing to the
    // full order-create page. openPaymentDrawer fetches the full order + bill.
    const o = this.paymentsDueOrders().find(x => x.id === b.orderId);
    this.openPaymentDrawer(o ?? ({ id: b.orderId } as Order));
  }
  checkIn(a: Appointment) {
    // Check-in flips the appointment to checked-in but does NOT auto-create an
    // order. Reception always lands on a FRESH order at the desk with the
    // pre-booked tests PRE-FILLED (?patientId=&appointmentId= preloads the
    // appointment's TestIds) — they review/change the tests, then Create + bill
    // + collect payment exactly like a manual walk-in.
    this.api.patch(`/api/appointments/${a.id}/checkin`).subscribe({
      next: () => {
        const name = a.patient?.displayName ?? 'Patient';
        this.toasts.success(`${name} checked in — review & create the order`);
        this.refresh();
        this.router.navigate(['/frontdesk/order'], {
          queryParams: { patientId: a.patientId, appointmentId: a.id }
        });
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /** Already checked-in but the order wasn't created yet → jump back to the
   *  order page with the pre-booked tests pre-filled to finish it. */
  resumeAppointmentOrder(a: Appointment) {
    this.router.navigate(['/frontdesk/order'], {
      queryParams: { patientId: a.patientId, appointmentId: a.id }
    });
  }

  private firstOfThisMonth(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  }

  setApptDateRange(d: DateRange) {
    if (d !== 'custom') {
      this._apptCustomStart.set(null);
      this._apptCustomEnd.set(null);
    }
    this._apptDateRange.set(d);
    this.refresh();
  }

  clearApptCustom() {
    this._apptCustomStart.set(null);
    this._apptCustomEnd.set(null);
    if (this._apptDateRange() === 'custom') {
      this._apptDateRange.set('today');
    }
    this.refresh();
  }

  apptCustomRangeLabel(): string {
    const s = this._apptCustomStart();
    const e = this._apptCustomEnd();
    if (!s) return 'Custom';
    const sDate = new Date(s!);
    if (!e || e === s) {
      return sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const eDate = new Date(e!);
    const sLabel = sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const eLabel = eDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${sLabel} – ${eLabel}`;
  }

  setWorkDateRange(d: DateRange) {
    if (d !== 'custom') {
      this._workCustomStart.set(null);
      this._workCustomEnd.set(null);
    }
    this._workDateRange.set(d);
    this.refresh();
  }

  clearWorkCustom() {
    this._workCustomStart.set(null);
    this._workCustomEnd.set(null);
    if (this._workDateRange() === 'custom') {
      this._workDateRange.set('today');
    }
    this.refresh();
  }

  workCustomRangeLabel(): string {
    const s = this._workCustomStart();
    const e = this._workCustomEnd();
    if (!s) return 'Custom';
    const sDate = new Date(s!);
    if (!e || e === s) {
      return sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const eDate = new Date(e!);
    const sLabel = sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const eLabel = eDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${sLabel} – ${eLabel}`;
  }

  openApptDatePicker(element: HTMLButtonElement, event: Event) {
    event.stopPropagation();
    if ((element as any)._flatpickr) {
      (element as any)._flatpickr.open();
      return;
    }
    const fp = flatpickr(element, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      onClose: (selectedDates) => {
        if (selectedDates.length === 2) {
          const start = this.toIsoDay(selectedDates[0]);
          const end = this.toIsoDay(selectedDates[1]);
          this._apptCustomStart.set(start);
          this._apptCustomEnd.set(end);
          this._apptDateRange.set('custom');
          this.refresh();
          this.closeDateFilters();
        } else if (selectedDates.length === 1) {
          const start = this.toIsoDay(selectedDates[0]);
          this._apptCustomStart.set(start);
          this._apptCustomEnd.set(start);
          this._apptDateRange.set('custom');
          this.refresh();
          this.closeDateFilters();
        }
      }
    });
    (element as any)._flatpickr = fp;
    fp.open();
  }

  openWorkDatePicker(element: HTMLButtonElement, event: Event) {
    event.stopPropagation();
    if ((element as any)._flatpickr) {
      (element as any)._flatpickr.open();
      return;
    }
    const fp = flatpickr(element, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      maxDate: 'today',
      onClose: (selectedDates) => {
        if (selectedDates.length === 2) {
          const start = this.toIsoDay(selectedDates[0]);
          const end = this.toIsoDay(selectedDates[1]);
          this._workCustomStart.set(start);
          this._workCustomEnd.set(end);
          this._workDateRange.set('custom');
          this.refresh();
          this.closeDateFilters();
        } else if (selectedDates.length === 1) {
          const start = this.toIsoDay(selectedDates[0]);
          this._workCustomStart.set(start);
          this._workCustomEnd.set(start);
          this._workDateRange.set('custom');
          this.refresh();
          this.closeDateFilters();
        }
      }
    });
    (element as any)._flatpickr = fp;
    fp.open();
  }
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

  shareReportSMS(o: Order) {
    const contact = o.patient?.phone || 'No phone number';
    this.toasts.success(`Report link sent via SMS to ${contact}`);
  }
  shareReportWhatsapp(o: Order) {
    const contact = o.patient?.phone || 'No phone number';
    this.toasts.success(`Report link sent via WhatsApp to ${contact}`);
  }
  shareReportEmail(o: Order) {
    const contact = o.patient?.email || 'No email address';
    this.toasts.success(`Report link sent via Email to ${contact}`);
  }

  /** Order id whose report is currently being fetched + rendered — null when
   *  idle. Holds the ID (not a boolean) so the template can mark ONLY the
   *  clicked row as "Preparing…"; a shared boolean flipped every row's
   *  Download button at once, which read as "all rows show the same
   *  download". */
  protected readonly _downloadingReport = signal<string | null>(null);
  readonly downloadingReport = this._downloadingReport.asReadonly();

  /** Pull the latest final report for the order and render it as a
   *  client-side PDF. Mirrors the invoice download — no server PDF
   *  endpoint required, jsPDF builds the document from the snapshot
   *  the backend already stores on Report.Data. */
  async downloadReport(o: Order) {
    if (this._downloadingReport()) return;
    this._downloadingReport.set(o.id);
    try {
      const report = await firstValueFrom(
        this.api.get<Report | null>(`/api/reports/by-order/${o.id}`)
      );
      if (!report) {
        this.toasts.warning('No report yet for this order — try again in a moment.');
        return;
      }
      const { generateReportPdf, preloadReportImages } = await import('../../../shared/utils/report-pdf');
      const { PlatformService } = await import('../../../core/services/platform.service');
      const platform = this.injector.get(PlatformService);
      const [template, resolvedLayouts] = await Promise.all([
        // Fetch the tenant's report template so colors / logo / signatures
        // / date format flow into the PDF. Soft-fail (null) so an unconfigured
        // tenant still gets a sensible default-themed report.
        firstValueFrom(this.api.get<import('../../../shared/models/report.model').ReportTemplate | null>('/api/config/report-template')).catch(() => null),
        this.fetchResolvedLayouts(report),
      ]);
      const baseInput = { report, resolvedLayouts, template: template ?? null };
      const imageCache = await preloadReportImages(baseInput, platform.getApiUrl());
      generateReportPdf({ ...baseInput, imageCache });
    } catch (err) {
      console.error('[fd] download report failed', err);
      this.toasts.error('Could not download the report');
    } finally {
      this._downloadingReport.set(null);
    }
  }
  /** Walk every test on the report and ask the engine to resolve its
   *  per-test layout against the entered values. Returns a testId →
   *  ResolvedReportLayout map that the PDF generator consumes; the map
   *  is empty for tests without a configured layout (PDF then falls
   *  back to the legacy parameter table for those). */
  private async fetchResolvedLayouts(report: Report): Promise<Record<string, import('../../../shared/models/report-layout.model').ResolvedReportLayout>> {
    const out: Record<string, import('../../../shared/models/report-layout.model').ResolvedReportLayout> = {};
    let tests: Array<{ testId?: string; packageTestId?: string | null; result?: { values?: Record<string, unknown> } }> = [];
    let patient: { sex?: string | null; age?: number | null } | undefined;
    try {
      const snap = JSON.parse(report.data ?? '{}');
      tests = snap?.tests ?? [];
      patient = { sex: snap?.patient?.sex ?? null, age: snap?.patient?.age ?? null };
    } catch { /* malformed — proceed with empty layouts map */ }
    if (tests.length === 0) return out;

    const { ReportLayoutService } = await import('../../../core/services/report-layout.service');
    const svc = this.injector.get(ReportLayoutService);
    await Promise.all(tests.map(async t => {
      if (!t.testId) return;
      try {
        out[t.testId] = await svc.preview(t.testId, (t.result?.values ?? {}) as Record<string, unknown>, [], patient);
      } catch { /* test without a layout — fallback table renders */ }
    }));
    // A test ordered through a PROFILE prints the PROFILE's notes, never its
    // own — so the profile's layout has to be fetched too. Profiles aren't
    // snapshot rows (only their members are), so collect the distinct
    // packageTestIds and resolve those as well.
    const pkgIds = [...new Set(tests.map(t => t.packageTestId).filter((id): id is string => !!id))];
    await Promise.all(pkgIds.map(async id => {
      if (out[id]) return;
      try {
        out[id] = await svc.preview(id, {}, [], patient);
      } catch { /* profile without notes — nothing extra prints */ }
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
      // paymentHold orders are excluded: the backend gate would reject them —
      // they need billing/payment first (their card shows "Bill").
      .filter(o => sel.has(o.id) && !o.paymentHold && o.samples.some(s => s.status === 'collected'))
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
      error: e => this.toasts.error(ApiError.from(e).message)
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
      error: e => this.toasts.error(ApiError.from(e).message)
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
  protected readonly formatPatient = formatPatientInfo;
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
  readonly patientTokens = computed(() => {
    const tokens = new Map<string, number>();
    
    // Collect all unique patient visits today with their earliest timestamp
    const patientVisits: Array<{ patientId: string; time: number; existingToken?: number }> = [];
    const seenPatients = new Set<string>();

    // 1. Process queue items
    for (const q of this._queueItems()) {
      if (q.patientId && !seenPatients.has(q.patientId)) {
        seenPatients.add(q.patientId);
        const time = q.checkedInAt ? new Date(q.checkedInAt).getTime() : new Date(q.appointmentDate).getTime();
        patientVisits.push({ patientId: q.patientId, time, existingToken: q.tokenNumber });
      }
    }

    // 2. Process appointments
    for (const a of this._appointments()) {
      if (a.patientId && !seenPatients.has(a.patientId)) {
        seenPatients.add(a.patientId);
        const time = a.checkedInAt ? new Date(a.checkedInAt).getTime() : new Date(a.appointmentDate).getTime();
        patientVisits.push({ patientId: a.patientId, time, existingToken: a.tokenNumber });
      }
    }

    // 3. Process orders
    for (const o of this._orders()) {
      if (o.patientId && !seenPatients.has(o.patientId)) {
        seenPatients.add(o.patientId);
        const time = new Date(o.createdAt).getTime();
        patientVisits.push({ patientId: o.patientId, time });
      }
    }

    // Sort visits chronologically
    patientVisits.sort((a, b) => a.time - b.time);

    // Assign sequential tokens
    let nextToken = 1;
    for (const visit of patientVisits) {
      if (visit.existingToken && Number.isFinite(visit.existingToken)) {
        tokens.set(visit.patientId, visit.existingToken);
        if (visit.existingToken >= nextToken) {
          nextToken = visit.existingToken + 1;
        }
      } else {
        tokens.set(visit.patientId, nextToken);
        nextToken++;
      }
    }

    return tokens;
  });

  getAppointmentForOrder(o: Order): Appointment | null {
    if (!o.patientId) return null;
    const token = this.patientTokens().get(o.patientId);
    
    // Find any existing appointment/queue item to copy other properties (type, slotTime etc)
    const queue = this._queueItems();
    const qItem = queue.find(q => q.patientId === o.patientId);
    if (qItem) {
      return {
        id: qItem.id,
        patientId: qItem.patientId,
        type: qItem.type,
        tokenNumber: token ?? qItem.tokenNumber,
        status: qItem.status,
        appointmentDate: qItem.appointmentDate,
        slotTime: qItem.slotTime
      } as Appointment;
    }

    const list = this._appointments();
    const appt = list.find(a => a.patientId === o.patientId);
    if (appt) {
      return {
        ...appt,
        tokenNumber: token ?? appt.tokenNumber
      };
    }

    return {
      id: '',
      patientId: o.patientId,
      type: 'walkin',
      tokenNumber: token,
      status: 'completed',
      appointmentDate: o.createdAt
    } as unknown as Appointment;
  }
  typeColor(type?: string): string {
    const TYPE_COLOR: Record<string, string> = {
      urgent: '#ef4444', emergency: '#ef4444',
      appointment: '#f59e0b', walkin: '#eab308', followup: '#22c55e'
    };
    return TYPE_COLOR[type ?? ''] ?? '#94a3b8';
  }
}
