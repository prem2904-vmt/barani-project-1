import { Location, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, AfterViewInit, computed, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { TrendTest } from '../../../shared/utils/trend-chart';
import { firstValueFrom } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Order } from '../../../shared/models/order.model';
import { Bill } from '../../../shared/models/bill.model';
import { Patient, formatPatientInfo } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import { filterTestList as sharedFilterTestList } from '../../../shared/utils/test-search';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { AuthService } from '../../../core/auth/auth.service';
import { generateInvoicePdf, invoiceTemplateFieldsFrom, loadImageDataUrl } from '../billing/invoice-pdf';
import { waLink } from '../../../shared/utils/whatsapp';
import { environment } from '../../../../environments/environment';
import { InlinePaymentPanelComponent, InlinePaymentResult } from './inline-payment-panel.component';

import { LabelCardComponent } from '../post-payment/label-card.component';
import { printLabelOnly } from '../../../shared/utils/print-label';
import { NavBackService } from '../../../core/services/nav-back.service';

type Priority = 'Normal' | 'Urgent';

/** Slimmed view of the patient-history row used for repeat-order seeding.
 *  Mirrors the enriched shape returned by GET /api/patients/{id}. */
interface HistoryRow {
  id: string;
  createdAt: string;
  samples?: Array<{ tests?: Array<{ testId?: string; test?: { id?: string } }> }>;
}

@Component({
  selector: 'pf-order-create',
  standalone: true,
  imports: [NgTemplateOutlet, CurrencyInrPipe, AvatarComponent, ScreenHeaderComponent, PatientSearchComponent, InlinePaymentPanelComponent, LabelCardComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-create.component.html',
  styleUrls: ['./order-create.component.scss']
})
export class OrderCreateComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly locationSvc = inject(Location);
  private readonly settings = inject(FrontdeskSettingsService);
  // Workflow is the source of truth for whether billing is a separate counter.
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  readonly patientSearch = viewChild<PatientSearchComponent>('patientSearch');

  focusSearchInput() {
    setTimeout(() => {
      this.searchInput()?.nativeElement?.focus();
    }, 0);
  }

  private readonly _patient = signal<Patient | null>(null);
  private readonly _tests = signal<Test[]>([]);
  private readonly _saving = signal(false);
  private readonly _selected = signal<string[]>([]);
  // ── Specimen choice at the desk (culture tests): testId → specimen ──
  private readonly _specimens = signal<Record<string, string>>({});
  readonly specimenOpts = signal<PfSelectOption[]>([]);
  isCultureTest(t: { parameters?: string }): boolean {
    return (t.parameters ?? '').includes('culture_sensitivity');
  }
  specimenOf(id: string): string { return this._specimens()[id] ?? ''; }
  setSpecimen(id: string, v: string) { this._specimens.update(m => ({ ...m, [id]: v })); }
  /** Only the chosen specimens for tests still in the cart. */
  private specimenPayload(): Record<string, string> | null {
    const sel = new Set(this._selected());
    const out: Record<string, string> = {};
    for (const [id, sp] of Object.entries(this._specimens()))
      if (sel.has(id) && sp) out[id] = sp;
    return Object.keys(out).length ? out : null;
  }
  private loadSpecimens() {
    this.api.get<{ name: string }[]>('/api/microbiology/specimens').subscribe({
      next: rows => this.specimenOpts.set((rows ?? []).map(r => ({ value: r.name, label: r.name }))),
      error: () => { /* micro module absent — culture tests simply show no picker */ }
    });
  }
  private readonly _priority = signal<Priority>('Normal');

  // ── Trendogram: offer to embed serial-result trend charts in the report ──
  /** Tests this patient has taken 2+ times (from /lab-trends) — eligibility. */
  readonly trendEligible = signal<TrendTest[]>([]);
  readonly trendogramOn = signal(false);
  readonly trendogramDuration = signal<string>('5');
  /** Explicit per-chart picks from the popup; null = auto (one per test). */
  readonly trendogramCharts = signal<Array<{ testId: string; parameter: string }> | null>(null);
  readonly trendPopupOpen = signal(false);

  /** The config merged into order metadata on submit (null when off). */
  readonly trendogramConfig = computed(() => {
    if (!this.trendogramOn() || this.trendEligible().length === 0) return null;
    const explicit = this.trendogramCharts();
    const charts = explicit ?? this.trendEligible()
      .map(t => ({ testId: t.testId, parameter: t.parameters[0]?.parameter ?? '' }))
      .filter(c => !!c.parameter);
    if (charts.length === 0) return null;
    return { enabled: true, duration: this.trendogramDuration(), chartType: 'line', charts };
  });
  /** How many charts will be included (for the panel label). */
  readonly trendogramCount = computed(() => this.trendogramConfig()?.charts.length ?? 0);

  constructor() {
    // Fetch trend eligibility whenever the attached patient changes.
    effect(() => {
      const p = this._patient();
      if (p?.id) this.loadTrendEligible(p.id);
      else { this.trendEligible.set([]); this.trendogramOn.set(false); this.trendogramCharts.set(null); }
    });
  }

  /** TRUE desktop/web only: wide AND a fine pointer (mouse). This is where the
   *  keyboard-first search dropdown makes sense and the catalog grid stays
   *  browse-only. A TOUCH device — phone OR iPad (pointer: coarse) — never gets
   *  the dropdown; there the list/grid just filters as you type (one search). */
  private static readonly WEB_MQ = '(min-width: 1024px) and (pointer: fine)';
  readonly isWide = signal(typeof window !== 'undefined' && window.matchMedia(OrderCreateComponent.WEB_MQ).matches);
  private readonly _wideMql = typeof window !== 'undefined' ? window.matchMedia(OrderCreateComponent.WEB_MQ) : null;
  private readonly _onWideChange = (e: MediaQueryListEvent) => this.isWide.set(e.matches);
  private readonly _onVisibleResync = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.loadOrderableTests();
  };
  private loadOrderableTests(): void {
    this.api.get<Test[]>('/api/tests/?activeOnly=true').subscribe({
      // Belt and braces: even if a stale cache or future endpoint slips an
      // inactive row through, it never reaches the picker.
      next: l => this._tests.set((l ?? []).filter(t => t.isActive !== false)),
      error: e => this.toasts.error(`Could not load tests: ${e?.message ?? 'unknown error'}`)
    });
  }

  private loadTrendEligible(patientId: string) {
    this.api.get<{ tests: TrendTest[] }>(`/api/patients/${patientId}/lab-trends`).subscribe({
      next: r => {
        this.trendEligible.set(r?.tests ?? []);
        this.trendogramCharts.set(null);
        if ((r?.tests?.length ?? 0) === 0) this.trendogramOn.set(false);
      },
      error: () => this.trendEligible.set([]),
    });
  }

  /** Popup: is a given (test, parameter) chart selected? (null charts = auto:
   *  each test's first param.) */
  isChartSelected(testId: string, parameter: string): boolean {
    const list = this.trendogramCharts();
    if (list) return list.some(c => c.testId === testId && c.parameter === parameter);
    const t = this.trendEligible().find(x => x.testId === testId);
    return t?.parameters[0]?.parameter === parameter;
  }
  toggleChart(testId: string, parameter: string) {
    // Materialize the auto default into an explicit list on first edit.
    let list = this.trendogramCharts();
    if (!list) {
      list = this.trendEligible()
        .map(t => ({ testId: t.testId, parameter: t.parameters[0]?.parameter ?? '' }))
        .filter(c => !!c.parameter);
    }
    const idx = list.findIndex(c => c.testId === testId && c.parameter === parameter);
    this.trendogramCharts.set(idx >= 0
      ? list.filter((_, i) => i !== idx)
      : [...list, { testId, parameter }]);
  }
  private readonly _query = signal<string>('');
  private readonly _cartOpen = signal<boolean>(false);

  private readonly _order = signal<Order | null>(null);
  readonly order = this._order.asReadonly();

  readonly viewOrderId = signal<string | null>(null);
  readonly currentBill = signal<Bill | null>(null);

  readonly isReadOnly = computed(() => !!this.viewOrderId());

  // ── Referral edit (OPS-58) — the FD can correct/add the referring doctor +
  //    hospital on an EXISTING order, including after it is completed. The
  //    order view is otherwise read-only; flipping `referralEditing` re-enables
  //    just the two referral inputs and shows Save/Cancel. Backend endpoint has
  //    no status gate, so this stays available on a finished order. ──────────
  readonly referralEditing = signal(false);
  readonly referralSaving = signal(false);
  /** Show the "Edit referral" affordance: viewing an existing (non-cancelled)
   *  order and the user may modify orders. */
  readonly canEditReferral = computed(() =>
    !!this.viewOrderId()
    && this.auth.hasPermission('modify_order')
    && this._order()?.status !== 'cancelled');
  /** The referral inputs are disabled when read-only UNLESS we're editing them. */
  readonly referralDisabled = computed(() => this.isReadOnly() && !this.referralEditing());
  /** Referral inputs are interactive when creating OR while editing the referral. */
  readonly referralInteractive = computed(() => !this.isReadOnly() || this.referralEditing());
  /**
   * The order is finished — its test list must not change any more. Two states
   * reach this: opening an existing order via ?orderId= (isReadOnly), and
   * completing payment inline in this session (paidOrderId). Only the second
   * one was unguarded, which is why the catalogue stayed clickable behind a
   * "Payment recorded" pane.
   *
   * Deliberately NOT tied to editOrderId: ?editOrderId= is the supervisor
   * Modify-tests flow, which is *supposed* to change tests on an already
   * billed order (the backend rebuilds the bill and can raise a refund), so
   * that mode must stay fully editable.
   */
  readonly orderLocked = computed(() => this.isReadOnly() || !!this.paidOrderId());

  readonly isPaymentSettled = computed(() => {
    if (!!this.paidOrderId()) return true;
    const bill = this.currentBill();
    if (this.isReadOnly() && bill) {
      return (bill.balance ?? 0) <= 0;
    }
    return false;
  });

  readonly isPaymentDueMode = computed(() => {
    const bill = this.currentBill();
    return !!this.viewOrderId() && !!bill && bill.balance > 0;
  });

  readonly pageTitle = computed(() => {
    // if (this.isReadOnly()) {
    //   const bill = this.currentBill();
    //   if (bill && bill.balance <= 0) return 'Order Settled';
    //   return 'Pending Payment';
    // }
    return 'Order & Payments';
  });

  readonly pageSubtitle = computed(() => {
    if (this.isReadOnly()) {
      const bill = this.currentBill();
      if (bill && bill.balance <= 0) return 'This order is settled and payment is recorded.';
      return 'Collect outstanding payment balance.';
    }
    return 'Pick tests, set priority, review cart.';
  });

  readonly refundDue = computed(() => {
    const bill = this.currentBill();
    if (!bill) return 0;
    return Math.max(0, bill.totalPaid - bill.totalPayable);
  });
  
  readonly refundModeDefs = [{ key: 'cash', label: 'Cash' }, { key: 'upi', label: 'UPI' }, { key: 'card', label: 'Card' }];
  readonly refundMode = signal('cash');
  readonly refunding = signal(false);

  doRefund() {
    const b = this.currentBill();
    const amt = this.refundDue();
    if (!b || amt <= 0 || this.refunding()) return;
    this.refunding.set(true);
    this.api.post<Bill>(`/api/billing/${b.id}/refund`, { amount: amt, mode: this.refundMode(), reason: 'order modified — test removed' })
      .subscribe({
        next: updated => {
          this.refunding.set(false);
          this.currentBill.set(updated);
          this.toasts.success(`Refunded ${amt}`);
          this._paidBill.set(updated);
          this.paidOrderId.set(b.orderId);
        },
        error: e => { this.refunding.set(false); this.toasts.error(ApiError.from(e).message); }
      });
  }

  // ── Categorized test picker state ─────────────────────────────────
  /** Active category tab. 'all' falls back to the existing dept-grouped grid. */
  readonly categoryTab = signal<'recent' | 'favourites' | 'packages' | 'profiles' | 'all'>('recent');
  private preSearchTab: 'recent' | 'favourites' | 'packages' | 'profiles' | 'all' = 'recent';
  /** Per-user pinned test ids, fetched from /api/test-picker/favorites. */
  readonly favouriteIds = signal<Set<string>>(new Set());
  /** Per-user recent test ids, fetched from /api/test-picker/recent. */
  readonly recentIds = signal<string[]>([]);

  // ── Ref-hospital + ref-doctor field state ─────────────────────────
  // On tablet/phone the patient search + referring hospital + referring doctor
  // don't fit one row, so referring is collapsed behind a toggle: tapping the
  // building icon expands the two referring inputs (full width) and shrinks the
  // patient field for the moment. Desktop (lg+) always shows all three.
  readonly refFieldsOpen = signal(false);
  toggleRefFields() { this.refFieldsOpen.update(v => !v); }

  readonly refHospitalName = signal<string>('');
  readonly refHospitalOpen = signal(false);
  readonly refHospitalSuggestions = signal<string[]>([]);
  private refHospitalDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly refDoctorName = signal<string>('');
  readonly refDoctorOpen = signal(false);
  readonly refDoctorSuggestions = signal<string[]>([]);
  private refDoctorDebounce: ReturnType<typeof setTimeout> | null = null;

  // ── Inline field-level errors from field-tagged API validation ────
  // Backend order-placement failures can carry a `field` (e.g. refDoctorName,
  // refHospitalName). Bind these under the matching input with a
  // `<p class="pf-field-error">` + `[class.pf-input-error]` on the control;
  // they clear as soon as the user edits that field (see the input handlers).
  readonly refHospitalError = signal<string | null>(null);
  readonly refDoctorError = signal<string | null>(null);

  /** Surface a mutation failure with the REAL backend message. Field-tagged
   *  validation for a form input highlights that input inline; everything else
   *  falls back to a toast so nothing fails silently. */
  private surfaceMutationError(e: unknown): void {
    const err = ApiError.from(e);
    switch (err.field) {
      case 'refHospitalName': this.refHospitalError.set(err.message); return;
      case 'refDoctorName':   this.refDoctorError.set(err.message);   return;
      default:                this.toasts.error(err.message);
    }
  }

  /** Per-patient localStorage key for draft order carts. We keep one
   *  draft per patient so reception can resume any half-built order
   *  on the same browser. Drafts older than 7 days are dropped on
   *  restore. */
  private readonly DRAFT_KEY_PREFIX = 'pf:order-draft:';
  private readonly DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  /** UI signal for "draft was just saved" — drives the toast badge. */
  private readonly _hasDraft = signal<boolean>(false);
  readonly hasDraft = this._hasDraft.asReadonly();

  readonly patient = this._patient.asReadonly();
  readonly isChangingPatient = signal(false);
  protected readonly formatPatient = formatPatientInfo;
  readonly saving = this._saving.asReadonly();
  readonly selected = this._selected.asReadonly();
  readonly priority = this._priority.asReadonly();
  readonly query = this._query.asReadonly();
  readonly cartOpen = this._cartOpen.asReadonly();

  readonly individualTests = computed(() => this._tests().filter(t => t.type === 'individual'));
  readonly packages = computed(() => {
    const list = this._tests().filter(t => t.type === 'package');
    return this.filterTestList(list, this._query());
  });
  /** Profiles — orderable coded bundles, their own filter tab (kept out of
   *  "All tests", which is individuals only). */
  readonly profiles = computed(() => {
    const list = this._tests().filter(t => t.type === 'profile');
    return this.filterByDept(this.filterTestList(list, this._query()));
  });
  /** Profiles grouped by department (dept header on top, like the tests view). */
  readonly profilesByDept = computed<Array<{ department: string; tests: Test[] }>>(() => {
    const groups = new Map<string, Test[]>();
    for (const p of this.profiles()) {
      const key = p.department?.name?.trim() || '(No department)';
      const arr = groups.get(key);
      if (arr) arr.push(p); else groups.set(key, [p]);
    }
    return [...groups.entries()]
      .map(([department, tests]) => ({ department, tests: tests.slice().sort(this.byCode) }))
      .sort((a, b) => a.department.localeCompare(b.department));
  });

  // ── Department quick-filter (pill row below the tabs) ──────────────
  /** '' = all departments. */
  private readonly _deptFilter = signal<string>('');
  readonly deptFilter = this._deptFilter.asReadonly();
  setDeptFilter(name: string) { this._deptFilter.set(this._deptFilter() === name ? '' : name); }

  /** Distinct departments across the loaded (active) tests, with their code —
   *  drives the pill filters. */
  readonly deptChips = computed<Array<{ name: string; code: string }>>(() => {
    const map = new Map<string, string>();
    for (const t of this._tests()) {
      const name = t.department?.name?.trim();
      if (name && !map.has(name)) map.set(name, (t.department?.code ?? '').trim());
    }
    return [...map.entries()].map(([name, code]) => ({ name, code })).sort((a, b) => a.name.localeCompare(b.name));
  });

  private filterByDept(list: Test[]): Test[] {
    const d = this._deptFilter();
    return d ? list.filter(t => (t.department?.name?.trim() || '') === d) : list;
  }

  // ── Category-aware test lists ────────────────────────────────────

  /** Tests pinned by the current user, in pin order. Filtered to active. */
  readonly favouriteTests = computed<Test[]>(() => {
    const ids = this.favouriteIds();
    if (ids.size === 0) return [];
    const byId = new Map(this._tests().map(t => [t.id, t]));
    const list = Array.from(ids).map(id => byId.get(id)).filter((t): t is Test => !!t && t.isActive);
    return this.filterTestList(list, this._query());
  });

  /** Tests this user has ordered in the past, most-recent first. */
  readonly recentTests = computed<Test[]>(() => {
    const ids = this.recentIds();
    if (ids.length === 0) return [];
    const byId = new Map(this._tests().map(t => [t.id, t]));
    const list = ids.map(id => byId.get(id)).filter((t): t is Test => !!t && t.isActive);
    return this.filterTestList(list, this._query());
  });

  /** True when the test id is in the user's favourites. */
  isFavourite(testId: string): boolean { return this.favouriteIds().has(testId); }

  /** Full-catalogue matches for the current query (individual + profile +
   *  package) — drives the desktop keyboard dropdown, independent of the browse
   *  grid so the grid can stay put while the dropdown searches. */
  readonly searchMatches = computed(() => {
    const q = this._query().trim();
    return q ? this.filterTestList(this._tests(), q) : [];
  });

  readonly filteredTests = computed(() => {
    const q = this._query().trim();
    // DESKTOP/WEB (≥1024): the catalog grid is BROWSE-ONLY — the keyboard
    // dropdown owns search, so the grid never reshuffles and competes with it
    // (design 1d: "the catalog below never reshuffles while searching").
    // PHONE/TABLET: no dropdown, so the grid itself narrows to the matches.
    if (q && !this.isWide()) return this.filterTestList(this._tests(), q);
    return this.filterByDept(this.individualTests());
  });

  /** Sort key: test code, natural/numeric-aware (BIO0002 before BIO0010). */
  private byCode = (a: Test, b: Test) =>
    ((a.testCode ?? a.code ?? '')).localeCompare(b.testCode ?? b.code ?? '', undefined, { numeric: true });

  private filterTestList(list: Test[], q: string): Test[] {
    return sharedFilterTestList(list, q);
  }

  /** Tests grouped by department, sorted by dept name. "(No department)"
   *  is a catch-all bucket so unclassified tests still render. Used by the
   *  catalog grid so admins can scan by dept rather than a flat list. */
  readonly filteredTestsByDept = computed<Array<{ department: string; tests: Test[] }>>(() => {
    const groups = new Map<string, Test[]>();
    for (const t of this.filteredTests()) {
      const key = t.department?.name?.trim() || '(No department)';
      const arr = groups.get(key);
      if (arr) arr.push(t); else groups.set(key, [t]);
    }
    return Array.from(groups.entries())
      .map(([department, tests]) => ({
        department,
        tests: tests.slice().sort(this.byCode)
      }))
      .sort((a, b) => a.department.localeCompare(b.department));
  });

  /** First A–Z letter of a department name (non-alpha → '#'). Used to build
   *  the phone A–Z index and to anchor each dept group (presentational). */
  deptFirstLetter(name: string): string {
    const c = (name || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  /** Sorted unique first-letters of the visible departments — drives the
   *  phone-only iOS-Contacts-style A–Z index strip. */
  readonly deptLetters = computed<string[]>(() => {
    const set = new Set<string>();
    for (const g of this.filteredTestsByDept()) set.add(this.deptFirstLetter(g.department));
    return Array.from(set).sort();
  });

  /** Scroll the first department whose name starts with `letter` to the top of
   *  the scrolling left column. Presentational only — no data changes. The
   *  groups render in alpha order, so the first match is the right anchor.
   *  `behavior` is 'smooth' for taps and 'auto' for live scrubbing so the list
   *  tracks the finger frame-by-frame (smooth queues animations that lag a drag). */
  jumpToLetter(letter: string, behavior: ScrollBehavior = 'smooth'): void {
    const root: ParentNode = this.searchInput()?.nativeElement?.ownerDocument ?? document;
    const el = root.querySelector(`[data-dept-letter="${letter}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'start', behavior });
  }

  // ── iOS-Contacts-style A–Z scrubber (phone ≤640 only) ─────────────
  // The index strip is a single continuous touch target: press anywhere on it
  // and slide — the finger's Y position maps proportionally to a letter (iOS
  // divides the strip uniformly by letter count, ignoring per-glyph heights),
  // and the list scrolls live to that department. A magnified callout shows the
  // current letter while dragging. Presentational + view-state only.

  /** The letter currently under the finger while scrubbing — drives the big
   *  callout bubble. `null` when not dragging (callout hidden). */
  readonly scrubLetter = signal<string | null>(null);
  /** True between pointer/touch-down and up on the index strip. */
  private scrubbing = false;
  /** Latch so the touch* fallback no-ops on devices that fire Pointer Events
   *  (which also synthesise compatibility touch events — we'd double-handle). */
  private scrubPointerActive = false;

  onScrubPointerDown(ev: PointerEvent): void {
    this.scrubPointerActive = true;
    const strip = ev.currentTarget as HTMLElement;
    // Keep tracking even if the finger drifts off the narrow strip.
    try { strip.setPointerCapture(ev.pointerId); } catch { /* unsupported */ }
    this.beginScrub(strip, ev.clientY);
    ev.preventDefault();
  }
  onScrubPointerMove(ev: PointerEvent): void {
    if (!this.scrubbing) return;
    this.scrubToY(ev.currentTarget as HTMLElement, ev.clientY);
    ev.preventDefault();
  }
  onScrubPointerUp(ev: PointerEvent): void {
    const strip = ev.currentTarget as HTMLElement;
    try { strip.releasePointerCapture(ev.pointerId); } catch { /* unsupported */ }
    this.endScrub();
  }

  // Touch fallback for browsers without Pointer Events.
  onScrubTouchStart(ev: TouchEvent): void {
    if (this.scrubPointerActive) return;
    const t = ev.touches[0];
    if (!t) return;
    this.beginScrub(ev.currentTarget as HTMLElement, t.clientY);
    ev.preventDefault();
  }
  onScrubTouchMove(ev: TouchEvent): void {
    if (this.scrubPointerActive || !this.scrubbing) return;
    const t = ev.touches[0];
    if (!t) return;
    this.scrubToY(ev.currentTarget as HTMLElement, t.clientY);
    ev.preventDefault();
  }
  onScrubTouchEnd(): void {
    if (this.scrubPointerActive) return;
    this.endScrub();
  }

  private beginScrub(strip: HTMLElement, clientY: number): void {
    this.scrubbing = true;
    this.scrubToY(strip, clientY);
  }
  private endScrub(): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.scrubLetter.set(null);
  }

  /** Map a Y coordinate over the strip to a letter and scroll there live.
   *  Only acts when the letter changes → one scroll per crossed section. */
  private scrubToY(strip: HTMLElement, clientY: number): void {
    const letters = this.deptLetters();
    if (letters.length === 0) return;
    const rect = strip.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = (clientY - rect.top) / rect.height;
    const idx = Math.max(0, Math.min(letters.length - 1, Math.floor(ratio * letters.length)));
    const letter = letters[idx];
    if (letter !== this.scrubLetter()) {
      this.scrubLetter.set(letter);
      this.jumpToLetter(letter, 'auto');
    }
  }

  /** Member (individual) test ids that are already covered by a package or
   *  profile currently in the cart (#38–44). Such tests are bundled into the
   *  package price and must NOT be billed as separate line items. Only
   *  individual members are collected here — a package is never zeroed out by
   *  another package (nested-package pricing is intentionally left intact). */
  readonly coveredMemberIds = computed<Set<string>>(() => {
    const all = this._tests();
    const covered = new Set<string>();
    for (const id of this._selected()) {
      const t = all.find(x => x.id === id);
      if (t?.type === 'package') {
        for (const mid of parsePackageMembers(t.parameters)) covered.add(mid);
      }
    }
    return covered;
  });

  /** True when an individual test in the cart is included in a package/profile
   *  that's also in the cart — it renders as "Included" and is not re-billed. */
  isCoveredMember(id: string): boolean {
    const t = this._tests().find(x => x.id === id);
    return !!t && t.type !== 'package' && this.coveredMemberIds().has(id);
  }

  /** Name of the package/profile covering this member test — drives the cart
   *  "Included in …" hint. Returns '' when the test isn't covered. */
  coveringPackageName(id: string): string {
    const all = this._tests();
    for (const sid of this._selected()) {
      const p = all.find(x => x.id === sid);
      if (p?.type === 'package' && parsePackageMembers(p.parameters).includes(id)) return p.name;
    }
    return '';
  }

  readonly subtotal = computed(() => {
    const all = this._tests();
    const covered = this.coveredMemberIds();
    return this._selected()
      .map(id => {
        const t = all.find(x => x.id === id);
        if (!t) return 0;
        // A member individual test covered by a package/profile in the cart is
        // billed within that package — don't double-charge it (#38–44).
        if (t.type !== 'package' && covered.has(id)) return 0;
        return t.price ?? 0;
      })
      .reduce((a, b) => a + b, 0);
  });
  /** Tenant GST master switch — when off, the cart shows no tax (mirrors the
   *  backend bill, which bills at a zero slab → Bill of Supply). */
  readonly gstEnabled = signal(true);
  readonly gst = computed(() => this.gstEnabled() ? Math.round(this.subtotal() * 0.18) : 0);

  // ── Discount (cart preview; carried into billing) ──────────────
  /** Admin "Allow discounts" switch — hides the field entirely when off. */
  readonly allowDiscounts = signal(true);
  readonly maxDiscountPct = signal(100);
  readonly overrideDiscountPct = signal(100);
  readonly discountValue = signal<string>('');   // raw input
  readonly discountKind = signal<'flat' | 'percent'>('flat');
  setDiscountKind(k: 'flat' | 'percent') { this.discountKind.set(k); }
  setDiscountValue(v: string) { this.discountValue.set(v); }

  /** The discount % this user may grant, by their role's permission tier:
   *  override_discount → Level-2 cap, else give_discount → Level-1 cap, else 0. */
  readonly discountCapPct = computed(() => {
    if (this.auth.hasPermission('override_discount')) return this.overrideDiscountPct();
    if (this.auth.hasPermission('give_discount')) return this.maxDiscountPct();
    return 0;
  });
  /** Resolved ₹ discount from the raw input — NOT clamped to the cap (so we can
   *  flag over-cap rather than silently apply the max). Still ≤ the bill total. */
  readonly discountAmount = computed(() => {
    if (!this.allowDiscounts()) return 0;
    const raw = parseFloat(this.discountValue() || '0');
    if (!isFinite(raw) || raw <= 0) return 0;
    const base = this.subtotal() + this.gst();
    const amt = this.discountKind() === 'percent' ? Math.round(base * raw / 100) : raw;
    return Math.max(0, Math.min(amt, base));
  });
  /** Entered discount as a % of the pre-discount total. */
  readonly discountPct = computed(() => {
    const base = this.subtotal() + this.gst();
    return base > 0 ? (this.discountAmount() / base) * 100 : 0;
  });
  /** True when the entered discount exceeds this user's cap → block + notify. */
  readonly discountOverCap = computed(() =>
    this.allowDiscounts() && this.discountAmount() > 0 && this.discountPct() > this.discountCapPct() + 0.01);
  readonly total = computed(() => Math.max(0, this.subtotal() + this.gst() - this.discountAmount()));

  /** Slowest test in the cart drives the report ETA. Packages count as
   *  the max of their member tests' tatHours. */
  readonly tatHours = computed<number>(() => {
    const all = this._tests();
    const sel = this._selected();
    let max = 0;
    for (const id of sel) {
      const t = all.find(x => x.id === id);
      if (!t) continue;
      if (t.type === 'package') {
        const memberIds = parsePackageMembers(t.parameters);
        for (const mid of memberIds) {
          const mt = all.find(x => x.id === mid);
          if (mt && Number.isFinite(mt.tatHours) && mt.tatHours > max) max = mt.tatHours;
        }
      } else if (Number.isFinite(t.tatHours) && t.tatHours > max) {
        max = t.tatHours;
      }
    }
    return max;
  });
  readonly tatLabel = computed<string>(() => {
    const h = this.tatHours();
    if (h <= 0) return '';
    if (h < 24) return `Report ready in ≈ ${h}h`;
    const d = Math.round(h / 24);
    return `Report ready in ≈ ${d} day${d === 1 ? '' : 's'}`;
  });

  /**
   * Package suggestions — when the cart contains individual tests that
   * are also bundled inside one or more packages, suggest the package(s)
   * that COVER ALL the picked individual tests so the patient saves
   * money. Sorted by package price ascending (cheapest deal first).
   *
   * Implementation: each package stores its member test ids inside the
   * `Parameters` JSON as { items: [{ testId: '...' }] } — same shape the
   * backend's OrderService.ParsePackageChildIds reads.
   */
  readonly packageSuggestions = computed<PackageSuggestion[]>(() => {
    const sel = new Set(this._selected());
    if (sel.size === 0) return [];
    const all = this._tests();
    const out: PackageSuggestion[] = [];
    for (const pkg of all) {
      if (pkg.type !== 'package' || !pkg.isActive) continue;
      // Skip if the package is already in the cart.
      if (sel.has(pkg.id)) continue;
      const memberIds = parsePackageMembers(pkg.parameters);
      if (memberIds.length === 0) continue;
      const memberSet = new Set(memberIds);
      // Only suggest if EVERY selected individual test is inside this
      // package. Filter out package-typed selections (rare edge case).
      const covered = [...sel].filter(id => {
        const t = all.find(x => x.id === id);
        return t && t.type !== 'package';
      });
      if (covered.length === 0) continue;
      const allCovered = covered.every(id => memberSet.has(id));
      if (!allCovered) continue;
      const individualSum = covered
        .map(id => all.find(t => t.id === id)?.price ?? 0)
        .reduce((a, b) => a + b, 0);
      const savings = Math.max(0, individualSum - pkg.price);
      out.push({
        package: pkg,
        coveredIds: covered,
        memberCount: memberIds.length,
        individualSum,
        savings
      });
    }
    // Cheapest-first per the user's preference: low value → high value.
    return out.sort((a, b) => a.package.price - b.package.price);
  });

  ngAfterViewInit() {
    const hasPatientId = this.route.snapshot.queryParamMap.has('patientId');
    const hasEditOrderId = this.route.snapshot.queryParamMap.has('editOrderId');
    if (!hasPatientId && !hasEditOrderId && !this.patient()) {
      setTimeout(() => {
        this.patientSearch()?.focus();
      }, 0);
    }
  }

  ngOnInit() {
    this.loadSpecimens();
    this._wideMql?.addEventListener('change', this._onWideChange);
    this.labCfg.ensureLoaded();
    // Only active tests are orderable — a disabled department's tests (cascaded
    // to inactive) must not appear in the picker.
    this.loadOrderableTests();
    // Reception keeps this tab open all day: re-sync the orderable list when
    // the tab comes back into view so a test/profile/package deactivated in
    // the Test Master meanwhile drops out of search without a reload.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibleResync);

    // Honor the tenant GST + discount switches in the cart preview. The slim
    // visibility endpoint is readable by reception — the full /api/config/billing
    // is admin-gated, so fetching it here 403'd for a receptionist and the
    // error fallback showed GST in the cart AFTER the admin disabled it.
    this.api.get<{ gstEnabled?: boolean; allowDiscounts?: boolean; maxDiscountPct?: number; overrideDiscountPct?: number }>('/api/config/billing/visibility').subscribe({
      next: c => {
        if (!c) return;
        this.gstEnabled.set(c.gstEnabled !== false);
        this.allowDiscounts.set(c.allowDiscounts !== false);
        if (typeof c.maxDiscountPct === 'number') this.maxDiscountPct.set(c.maxDiscountPct);
        if (typeof c.overrideDiscountPct === 'number') this.overrideDiscountPct.set(c.overrideDiscountPct);
      },
      error: () => { /* defaults: GST on, discounts on */ }
    });

    // Per-user pinned tests + recent test history. Both endpoints are
    // best-effort — if they fail the picker still works (tabs fall back to
    // "All"). Fire in parallel; either response order is fine.
    this.api.get<string[]>('/api/test-picker/favorites').subscribe({
      next: ids => this.favouriteIds.set(new Set(ids ?? [])),
      error: () => { /* silent: empty favourites list */ }
    });
    this.api.get<string[]>('/api/test-picker/recent').subscribe({
      next: ids => this.recentIds.set(ids ?? []),
      error: () => { /* silent: empty recent list */ }
    });

    // Deep-link support — if the route carries ?patientId= (e.g. coming
    // from a patient profile), pre-attach. Otherwise the inline picker
    // handles selection in-page.
    const orderId = this.route.snapshot.queryParamMap.get('orderId');
    if (orderId) {
      this.viewOrderId.set(orderId);
      this.api.get<Order>(`/api/orders/${orderId}`).subscribe({
        next: o => {
          this._order.set(o);
          if (o?.patient) this._patient.set(o.patient);
          this.refDoctorName.set(o.refDoctorName ?? '');
          this.refHospitalName.set(o.refHospitalName ?? '');
          this.setPriority(o.priority as Priority ?? 'Normal');
          
          // Pre-fill tests
          const testIds: string[] = [];
          for (const s of o.samples ?? []) {
            for (const t of s.tests ?? []) {
              if (t.testId) testIds.push(t.testId);
            }
          }
          this._selected.set(testIds);
        },
        error: () => this.toasts.error('Could not load order details')
      });
      
      this.api.post<Bill>('/api/billing/', { orderId, discount: 0 }).subscribe({
        next: b => {
          this.currentBill.set(b);
          if (b.totalDiscount > 0) {
            this.discountValue.set(String(b.totalDiscount));
            this.discountKind.set('flat');
          }
        },
        error: () => this.toasts.error('Could not load billing details')
      });
      return;
    }

    const pid = this.route.snapshot.queryParamMap.get('patientId');
    const fromOrderId = this.route.snapshot.queryParamMap.get('fromOrderId');
    const appointmentId = this.route.snapshot.queryParamMap.get('appointmentId');

    // EDIT mode: load the existing order, attach its patient, and pre-fill its
    // current tests for add/remove. Saving PATCHes the order (not create).
    const editOrderId = this.route.snapshot.queryParamMap.get('editOrderId');
    if (editOrderId) {
      this.editOrderId.set(editOrderId);
      this.api.get<Order>(`/api/orders/${editOrderId}`).subscribe({
        next: o => {
          if (o?.patient) this._patient.set(o.patient);
          if (o) this.extractCollectedTestIds(o);
          this.preselectFromOrder(o as unknown as HistoryRow, true);
        },
        error: () => this.toasts.error('Could not load order')
      });
      return;
    }

    if (pid) {
      this.api.get<{ patient: Patient; history: HistoryRow[] }>(`/api/patients/${pid}`).subscribe({
        next: res => {
          this._patient.set(res.patient);
          // Preselection priority:
          //   1) localStorage draft for this patient
          //   2) ?fromOrderId=… (Repeat flow from a prior order)
          //   3) ?appointmentId=… → fetch the appointment's draft TestIds
          //      and pre-load them into the cart (reception just clicks Create)
          const restored = this.restoreDraftFor(pid);
          if (restored) return;
          if (fromOrderId) {
            const prior = (res.history ?? []).find(h => h.id === fromOrderId);
            if (prior) { this.preselectFromOrder(prior); return; }
          }
          if (appointmentId) this.preselectFromAppointment(appointmentId);
        },
        error: () => this.toasts.error('Could not load patient')
      });
    }
  }

  /** Hydrate the cart from an appointment's draft TestIds (CSV stored on
   *  AppointmentEntity.TestIds during booking). */
  private preselectFromAppointment(appointmentId: string) {
    this.api.get<{ id: string; testIds?: string | null } | null>(`/api/appointments/${appointmentId}`).subscribe({
      next: appt => {
        const csv = appt?.testIds ?? '';
        const ids = csv.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (ids.length === 0) return;
        this._selected.set(ids);
        this.toasts.info(`Pre-filled ${ids.length} test${ids.length === 1 ? '' : 's'} from the appointment`);
      },
      error: () => { /* soft-fail */ }
    });
  }

  /** Save the current cart to localStorage under the patient's id.
   *  No-op when there's no patient or nothing in the cart. */
  saveDraft() {
    const p = this._patient();
    if (!p) { this.toasts.warning('Pick a patient first'); return; }
    if (this._selected().length === 0) { this.toasts.info('Cart is empty — nothing to save'); return; }
    try {
      localStorage.setItem(this.DRAFT_KEY_PREFIX + p.id, JSON.stringify({
        savedAt: Date.now(),
        priority: this._priority(),
        testIds: this._selected(),
        specimens: this.specimenPayload(),
        // Snapshot the patient so the front-desk Draft tab can list it without
        // a lookup (the key only carries the id).
        patient: p
      }));
      this._hasDraft.set(true);
      this.toasts.success('Saved as draft');
      // After saving there's nothing left to do here — return to FD so
      // reception can pick up the next patient. The draft survives in
      // localStorage and the next /frontdesk/order visit for the same
      // patient restores it automatically.
      this.router.navigateByUrl('/frontdesk');
    } catch {
      this.toasts.error('Could not save draft (storage full?)');
    }
  }

  /** Discard a saved draft for the current patient. */
  discardDraft() {
    const p = this._patient();
    if (!p) return;
    try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + p.id); } catch { /* ignore */ }
    this._hasDraft.set(false);
    this.toasts.info('Draft discarded');
  }

  /** Restore the saved draft (if any) for the supplied patient id.
   *  Returns true if a non-stale draft was applied. */
  private restoreDraftFor(patientId: string): boolean {
    let raw: string | null = null;
    try { raw = localStorage.getItem(this.DRAFT_KEY_PREFIX + patientId); } catch { return false; }
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { savedAt?: number; priority?: Priority; testIds?: string[] };
      if (!parsed?.savedAt || Date.now() - parsed.savedAt > this.DRAFT_TTL_MS) {
        try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + patientId); } catch { /* ignore */ }
        return false;
      }
      const ids = (parsed.testIds ?? []).filter(id => typeof id === 'string');
      if (ids.length === 0) return false;
      this._selected.set(ids);
      if (parsed.priority) this._priority.set(parsed.priority);
      this._hasDraft.set(true);
      this.toasts.info('Draft restored');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Repeat-from-prior-order helper. Pulls every test id that appeared on
   * the prior order's samples, intersects with the current tenant's
   * active test catalog so we don't preselect a test that's been
   * deactivated since, then sets the cart. Surfaces a toast summarising
   * what carried over and what was dropped so the user has a clear
   * audit trail.
   */
  /** Set when the screen is editing an existing order (?editOrderId=…) rather
   *  than creating a new one. Drives the submit button + PATCH-vs-POST. */
  readonly editOrderId = signal<string | null>(null);

  /** Test IDs whose samples have already been collected on the order being edited.
   *  These tests cannot be deleted/removed from the cart during order modification. */
  readonly collectedTestIds = signal<Set<string>>(new Set());

  isCollected(testId: string): boolean {
    return this.collectedTestIds().has(testId);
  }

  private extractCollectedTestIds(o: Order) {
    const collected = new Set<string>();
    for (const s of (o.samples ?? []) as unknown as Array<{ status?: string; collectedAt?: string; collectedBy?: string; tests?: Array<{ testId?: string; packageTestId?: string; status?: string; test?: { id?: string } }> }>) {
      const isSampleCollected = (!!s.status && s.status !== 'pending' && s.status !== 'requested') || !!s.collectedAt || !!s.collectedBy;
      for (const t of s.tests ?? []) {
        const isTestCollected = isSampleCollected || (!!t.status && t.status !== 'pending' && t.status !== 'requested');
        if (isTestCollected) {
          const testId = t.testId || t.test?.id;
          if (testId) collected.add(testId);
          if (t.packageTestId) collected.add(t.packageTestId);
        }
      }
    }
    this.collectedTestIds.set(collected);
  }

  private preselectFromOrder(prior: HistoryRow, isEdit = false) {
    const want = new Set<string>();
    for (const s of prior.samples ?? []) {
      for (const t of s.tests ?? []) {
        const testId = (t as { test?: { id?: string }; testId?: string }).testId
                    ?? (t as { test?: { id?: string }; testId?: string }).test?.id;
        if (testId) want.add(testId);
      }
    }
    if (want.size === 0) {
      this.toasts.warning('Repeated order had no tests');
      return;
    }
    // Intersect with the catalog we just loaded so removed tests don't
    // ride along (retaining any tests with collected samples). The catalog
    // list arrives async — re-run this once _tests fills if it isn't there yet.
    const apply = () => {
      const collected = this.collectedTestIds();
      const ids = Array.from(want).filter(id => collected.has(id) || this._tests().some(x => x.id === id));
      this._selected.set(ids);
      const date = new Date(prior.createdAt);
      const human = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const dropped = want.size - ids.length;
      if (isEdit) {
        this.toasts.info(`Editing order — ${ids.length} test${ids.length === 1 ? '' : 's'} loaded. Add or remove, then Update.`);
      } else if (dropped > 0) {
        this.toasts.warning(`Repeated from ${human}: ${ids.length} carried over, ${dropped} no longer available`);
      } else {
        this.toasts.success(`Repeated from ${human}: ${ids.length} test${ids.length === 1 ? '' : 's'} added`);
      }
    };
    if (this._tests().length > 0) {
      apply();
    } else {
      // Re-attempt once tests load. Cheaper than wiring an effect for a
      // one-shot deep-link.
      const interval = setInterval(() => {
        if (this._tests().length > 0) {
          clearInterval(interval);
          apply();
        }
      }, 150);
      setTimeout(() => clearInterval(interval), 5000);
    }
  }

  setPriority(p: Priority) { this._priority.set(p); }
  setQuery(q: string) {
    this._query.set(q);
    this.activeResult.set(0);
    const queryStr = q.trim();
    if (queryStr !== '') {
      if (this.categoryTab() !== 'all') {
        this.preSearchTab = this.categoryTab();
        this.categoryTab.set('all');
      }
    } else {
      this.categoryTab.set(this.preSearchTab);
    }
  }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  // ── Keyboard-first search dropdown ──────────────────────────────
  /** Top matches for the current query, shown in a dropdown under the search
   *  field for instant keyboard add. Empty when the field is empty. */
  readonly searchResults = computed<Test[]>(() =>
    this.isWide() && this._query().trim() ? this.searchMatches().slice(0, 7) : []);
  /** Highlighted dropdown row (driven by ↑/↓ and hover); Enter adds it. */
  readonly activeResult = signal(0);

  onSearchArrow(e: Event, dir: number): void {
    const n = this.searchResults().length;
    if (n === 0) return;
    // Stop the browser (and any global arrow-key handler) from scrolling the page
    // while the dropdown owns ↑/↓.
    e.preventDefault();
    e.stopPropagation();
    this.activeResult.update(i => Math.max(0, Math.min(n - 1, i + dir)));
  }
  onSearchEnter(e: Event): void {
    const list = this.searchResults();
    if (list.length === 0) return;
    e.preventDefault();
    this.addSearchResult(list[Math.min(this.activeResult(), list.length - 1)]);
  }
  /** Add a dropdown hit and keep focus for the next query. Adding a test already
   *  clears the field + refocuses (toggleTest/togglePackage) — "⏎ add & keep typing". */
  addSearchResult(t: Test): void {
    this.activeResult.set(0);
    if (t.type === 'package') this.togglePackage(t); else this.toggleTest(t);
  }

  isSelected(id: string): boolean { return this._selected().includes(id); }

  /** Swap the matching individual tests out of the cart and add the
   *  package in their place. The receptionist accepted the suggestion. */
  applyPackage(s: PackageSuggestion) {
    const droppedCollected = s.coveredIds.filter(id => this.isCollected(id));
    if (droppedCollected.length > 0) {
      this.toasts.warning('Cannot switch to package — some tests already have collected samples');
      return;
    }
    this._selected.update(cur => {
      const dropped = new Set(s.coveredIds);
      const next = cur.filter(id => !dropped.has(id));
      if (!next.includes(s.package.id)) next.push(s.package.id);
      return next;
    });
    this.toasts.success(`Switched to ${s.package.name} — saving ₹${s.savings}`);
  }
  findTest(id: string): Test | undefined { return this._tests().find(t => t.id === id); }

  /** Blocks every cart mutation once the order is complete. The template also
   *  swaps the catalogue for a read-only summary, so this is the belt-and-braces
   *  half: keyboard, stale DOM and programmatic paths can't slip through. */
  private rejectIfLocked(): boolean {
    if (!this.orderLocked()) return false;
    this.toasts.warning(
      this.paidOrderId()
        ? 'This order is already complete — start a new order to add tests.'
        : 'This order is closed for editing — use Modify to change its tests.');
    return true;
  }

  toggleTest(t: Test) {
    if (this.rejectIfLocked()) return;
    if (this.isSelected(t.id) && this.isCollected(t.id)) {
      this.toasts.warning(`Cannot remove ${t.name} — sample has already been collected`);
      return;
    }
    this._selected.update(cur => cur.includes(t.id) ? cur.filter(id => id !== t.id) : [...cur, t.id]);
    if (this.query().trim() !== '') {
      this.setQuery('');
      this.focusSearchInput();
    }
  }
  removeTest(id: string) {
    if (this.rejectIfLocked()) return;
    if (this.isCollected(id)) {
      const t = this.findTest(id);
      this.toasts.warning(`Cannot remove ${t?.name ?? 'test'} — sample has already been collected`);
      return;
    }
    this._selected.update(cur => cur.filter(x => x !== id));
  }
  clearCart() {
    if (this.rejectIfLocked()) return;
    const collected = this.collectedTestIds();
    if (collected.size > 0) {
      const kept = this._selected().filter(id => collected.has(id));
      const removedCount = this._selected().length - kept.length;
      if (removedCount > 0) {
        this._selected.set(kept);
        this.toasts.info('Cleared uncollected tests. Tests with collected samples were retained.');
      } else {
        this.toasts.warning('Cannot clear cart — all tests have collected samples');
      }
      return;
    }
    this._selected.set([]);
  }

  /** Click toggles a quick-package: add if missing, remove if already in cart.
   * Quietly mutates selection without flooding the toast stack — the cart
   * sidebar is the source of truth and visually reflects the change. */
  togglePackage(pkg: Test) {
    if (this.rejectIfLocked()) return;
    if (this.isSelected(pkg.id) && this.isCollected(pkg.id)) {
      this.toasts.warning(`Cannot remove ${pkg.name} — sample has already been collected`);
      return;
    }
    this._selected.update(cur =>
      cur.includes(pkg.id) ? cur.filter(id => id !== pkg.id) : [...cur, pkg.id]
    );
    if (this.query().trim() !== '') {
      this.setQuery('');
      this.focusSearchInput();
    }
  }

  toggleCart() { this._cartOpen.update(v => !v); }
  closeCart() { this._cartOpen.set(false); }

  /** Friendly "report ready" estimate for the sticky cart bar (from the cart's
   *  max TAT): ≈ N day(s) at/over 24h, else ≈ Nh. Empty when nothing's selected. */
  reportReadyLabel(): string {
    const h = this.tatHours();
    if (!h || h <= 0) return '';
    if (h >= 24) { const d = Math.round(h / 24); return `≈ ${d} day${d === 1 ? '' : 's'}`; }
    return `≈ ${h}h`;
  }

  shortCode(t: Test): string {
    // Prefer the real test ID / code (e.g. BIO00081) so reception can match it
    // to the requisition; fall back to HSN, then name initials.
    if (t.testCode) return t.testCode;
    if (t.hsnSacCode) return t.hsnSacCode.slice(0, 4);
    return t.name.replace(/\s+/g, '').slice(0, 4).toUpperCase();
  }

  testDisplayName(t?: { name: string; shortName?: string | null } | null): string {
    if (!t) return '';
    const name = t.name || '';
    const short = t.shortName?.trim();
    if (short && short.toLowerCase() !== name.trim().toLowerCase()) {
      return `${name} (${short})`;
    }
    return name;
  }

  getPackageTestCount(pkg: Test): number {
    return parsePackageMembers(pkg.parameters).length;
  }

  // Canonical flow: Home → patient history → New order (lands here with
  // ?patientId=). "Change" on the attached patient tile bounces back to
  // Home so the user can pick a different one from their records.
  changePatient() {
    this.isChangingPatient.set(true);
  }
  cancelChangePatient() {
    this.isChangingPatient.set(false);
  }
  attachPatient(p: Patient) {
    if (!p) return;
    this.isChangingPatient.set(false);
    this.router.navigate([], { queryParams: { patientId: p.id }, queryParamsHandling: 'merge' });
    this.api.get<{ patient: Patient; history: HistoryRow[] }>(`/api/patients/${p.id}`).subscribe({
      next: res => {
        this._patient.set(res.patient);
        this.restoreDraftFor(p.id);
      },
      error: () => this.toasts.error('Could not load patient details')
    });
  }
  /** Order metadata JSON — appointment link + optional trendogram config. */
  private buildOrderMetadata(appointmentId: string | null): string | null {
    const meta: Record<string, unknown> = {};
    if (appointmentId) meta['appointmentId'] = appointmentId;
    const tg = this.trendogramConfig();
    if (tg) meta['trendogram'] = tg;
    return Object.keys(meta).length ? JSON.stringify(meta) : null;
  }

  goHome() { this.router.navigateByUrl('/frontdesk'); }

  onSearchTab(event: Event) {
    if (this.query().trim() !== '') {
      const firstCard = document.querySelector('.pf-rail-card') as HTMLElement;
      if (firstCard) {
        event.preventDefault();
        firstCard.focus();
      }
    }
  }

  /** Billing route params — carry the cart discount (resolved ₹) so the
   *  billing screen opens with it pre-applied. */
  private billingQueryParams(orderId: string): Record<string, string> {
    const d = this.discountAmount();
    return d > 0 ? { orderId, discount: String(d) } : { orderId };
  }

  // ── Inline payment (front_desk: live pay pane in the right column) ──
  /** Show the live payment pane: billing is part of this workflow and we're
   *  creating a fresh order (not editing). */
  readonly showInlinePay = computed(() => 
    this.isReadOnly() || (this.labCfg.billingMode() === 'front_desk' && !this.editOrderId())
  );
  readonly confirming = signal(false);
  /** Set once payment is taken → the pane swaps to Print / Show invoice. */
  readonly paidOrderId = signal<string | null>(null);
  /** The bill in its post-payment state (has totalPayable / totalPaid /
   *  balance). A signal so the paid summary can render Total, Paid/Advance
   *  and Balance Due — including after a partial (advance) payment. */
  private readonly _paidBill = signal<Bill | null>(null);
  readonly paidBill = this._paidBill.asReadonly();

  /** Bill used to render the post-confirmation payment summary. Prefers the
   *  freshly-paid bill; falls back to the loaded bill in read-only mode. */
  readonly paymentSummaryBill = computed<Bill | null>(() => this._paidBill() ?? this.currentBill());

  protected readonly _reprintOrder = signal<Order | null>(null);
  readonly reprintOrder = this._reprintOrder.asReadonly();
  readonly reprintLoading = signal(false);

  printLabels() {
    const oid = this.paidOrderId() || this.viewOrderId() || this.editOrderId();
    if (!oid || this.reprintLoading()) return;
    this.reprintLoading.set(true);
    this.api.get<Order>(`/api/orders/${oid}`).subscribe({
      next: full => {
        this.reprintLoading.set(false);
        if (!full?.samples?.length) {
          this.toasts.warning('No samples on this order to print labels');
          return;
        }
        this._reprintOrder.set(full);
        setTimeout(() => {
          printLabelOnly();
          setTimeout(() => this._reprintOrder.set(null), 2000);
        }, 350);
      },
      error: () => {
        this.reprintLoading.set(false);
        this.toasts.error('Could not load the order for label printing');
      }
    });
  }

  /** Called by the inline payment pane's Confirm: create the order, the bill
   *  (with the cart discount), record the payment, then print the invoice. */
  async confirmPayment(d: InlinePaymentResult) {
    if (this.isPaymentDueMode()) {
      const bill = this.currentBill();
      if (!bill) return;
      this.confirming.set(true);
      try {
        const amount = bill.balance;
        if (d.mode === 'wallet') {
          if (!d.vendorId) throw new Error('No vendor selected');
          await firstValueFrom(this.api.post<unknown>(`/api/vendors/${d.vendorId}/charge`, {
            amount, billId: bill.id,
            reason: `Bill #${bill.id.substring(0, 8)}`
          }));
          const updated = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
            amount, mode: 'wallet', referenceNo: d.referenceNo || d.vendorId
          }));
          this.currentBill.set(updated);
        } else if (d.mode === 'split' && d.splitParts?.length) {
          for (const part of d.splitParts) {
            await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, { amount: part.amount, mode: part.mode }));
          }
          const updated = await firstValueFrom(this.api.post<Bill>('/api/billing/', { orderId: bill.orderId, discount: 0 }));
          this.currentBill.set(updated);
        } else if (d.mode === 'later') {
          if (d.advanceAmount && d.advanceAmount > 0) {
            const updated = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
              amount: d.advanceAmount, mode: d.advanceMode ?? 'cash'
            }));
            this.currentBill.set(updated);
          }
        } else {
          const updated = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
            amount, mode: d.mode, referenceNo: d.referenceNo
          }));
          this.currentBill.set(updated);
        }
        
        this._paidBill.set(this.currentBill());
        this.paidOrderId.set(bill.orderId);
        this.toasts.success('Payment collected');
      } catch (e) {
        this.toasts.error(ApiError.from(e).message);
      } finally {
        this.confirming.set(false);
      }
      return;
    }

    const p = this._patient();
    if (!p || this.confirming() || this._selected().length === 0) return;
    if (this.discountOverCap()) {
      this.toasts.error(`Discount ${this.discountPct().toFixed(0)}% exceeds your limit of ${this.discountCapPct()}%. Reduce it to continue.`);
      return;
    }
    this.confirming.set(true);
    try {
      const appointmentId = this.route.snapshot.queryParamMap.get('appointmentId');
      const order = await firstValueFrom(this.api.post<Order>('/api/orders/', {
        patientId: p.id,
        refDoctorName: this.refDoctorName().trim() || null,
        refHospitalName: this.refHospitalName().trim() || null,
        priority: this._priority(),
        source: appointmentId ? 'appointment' : 'walkin',
        collectionType: 'walkin',
        testIds: this._selected(),
        specimens: this.specimenPayload(),
        metadataJson: appointmentId ? JSON.stringify({ appointmentId }) : null
      }));
      const targetAmount = this.total();
      const bill = await firstValueFrom(this.api.post<Bill>('/api/billing/', {
        orderId: order.id,
        discount: this.discountAmount(),
        tax: this.gst()
      }));
      // Track the latest bill state so the paid summary reflects the actual
      // amount paid / balance due (the payment endpoint returns the updated bill).
      let latest = bill;
      if (d.mode !== 'later') {
        if (d.mode === 'split' && d.splitParts?.length) {
          for (const part of d.splitParts) {
            latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, { amount: part.amount, mode: part.mode }));
          }
        } else if (d.mode === 'wallet') {
          // Credit Wallet: accrue the charge to the vendor's tab FIRST, then
          // record the bill payment.
          if (!d.vendorId) throw new Error('No vendor selected');
          const payAmt = targetAmount;
          await firstValueFrom(this.api.post<unknown>(`/api/vendors/${d.vendorId}/charge`, {
            amount: payAmt, billId: bill.id, reason: `Bill #${bill.id.substring(0, 8)}`
          }));
          latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
            amount: payAmt, mode: 'wallet', referenceNo: d.referenceNo || d.vendorId
          }));
        } else {
          const payAmt = targetAmount;
          latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
            amount: payAmt, mode: d.mode, referenceNo: d.referenceNo
          }));
        }
      } else if (d.advanceAmount && d.advanceAmount > 0) {
        // Pay-later with an advance: record the partial payment now; the rest
        // of the bill stays outstanding (due on report).
        latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
          amount: d.advanceAmount, mode: d.advanceMode ?? 'cash'
        }));
      }

      if (latest) {
        const finalPayable = Math.max(latest.totalPayable ?? 0, latest.totalPaid ?? 0, targetAmount);
        const finalPaid = Math.max(latest.totalPaid ?? 0, (d.mode !== 'later' ? targetAmount : (d.advanceAmount ?? 0)));
        latest = {
          ...latest,
          totalPayable: finalPayable,
          totalPaid: finalPaid,
          balance: Math.max(0, finalPayable - finalPaid)
        };
      }

      try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + p.id); } catch { /* ignore */ }
      this._hasDraft.set(false);
      this._paidBill.set(latest);
      this.paidOrderId.set(order.id);
      this.toasts.success(
        d.mode !== 'later' ? 'Payment collected'
          : (d.advanceAmount && d.advanceAmount > 0) ? 'Advance collected — balance pending'
          : 'Order placed — payment pending');
      // Auto-open the invoice print dialog (best-effort).
      //this.printPaidInvoice();
    } catch (e) {
      this.surfaceMutationError(e);
    } finally {
      this.confirming.set(false);
    }
  }

  /** Show "Collect sample" after payment when collection happens at the front
   *  desk (in this workflow) and the user can collect. */
  readonly canCollectHere = computed(() =>
    this.labCfg.collectsAtFrontdesk() &&
    this.process.isEnabled('sample_collection') &&
    this.auth.hasPermission('collect_sample') &&
    (!this.viewOrderId() || (this.order()?.samples ?? []).some(s => s.status === 'pending'))
  );
  /** Switch this (unpaid) order into edit mode to change its tests. */
  editThisOrder() {
    const id = this.viewOrderId();
    if (id) this.router.navigate(['/frontdesk/order'], { queryParams: { editOrderId: id } });
  }

  /** Original referral, captured when the edit begins, so Cancel restores it. */
  private referralSnapshot: { doctor: string; hospital: string } | null = null;
  /** Begin editing the referring doctor/hospital on an existing order (OPS-58). */
  startReferralEdit() {
    if (!this.canEditReferral()) return;
    this.referralSnapshot = { doctor: this.refDoctorName(), hospital: this.refHospitalName() };
    this.refDoctorError.set(null);
    this.refHospitalError.set(null);
    this.referralEditing.set(true);
  }
  /** Discard referral edits and restore the loaded values. */
  cancelReferralEdit() {
    if (this.referralSnapshot) {
      this.refDoctorName.set(this.referralSnapshot.doctor);
      this.refHospitalName.set(this.referralSnapshot.hospital);
    }
    this.refDoctorSuggestions.set([]);
    this.refHospitalSuggestions.set([]);
    this.referralEditing.set(false);
  }
  /** Persist the referring doctor + hospital to the existing order. Works after
   *  completion — the backend endpoint has no status gate. */
  saveReferral() {
    const id = this.viewOrderId();
    if (!id || this.referralSaving()) return;
    this.referralSaving.set(true);
    this.api.patch<{ order: Order }>(`/api/orders/${id}/referral`, {
      refDoctorName: this.refDoctorName().trim() || null,
      refHospitalName: this.refHospitalName().trim() || null,
    }).subscribe({
      next: res => {
        this.referralSaving.set(false);
        this.referralEditing.set(false);
        if (res?.order) this._order.set(res.order);
        this.toasts.success('Referral updated');
      },
      error: () => {
        this.referralSaving.set(false);
        this.toasts.error('Could not update the referral');
      }
    });
  }

  collectPaidSample() {
    const oid = this.paidOrderId();
    if (!oid) return;
    // After collection, return to the frontdesk landing (not back to the
    // build-order screen).
    this.router.navigate(['/lab/collect'], { queryParams: { orderId: oid, from: '/frontdesk' } });
  }

  /** After clearing the due here (pay-later billing), if every tube is already
   *  collected the FD can dispatch right on this screen instead of hopping back
   *  to the landing. (Dispatch is payment-gated, so this only lights up once the
   *  balance is 0.) */
  readonly dispatching = signal(false);
  readonly canDispatchHere = computed(() => {
    if (!this.auth.hasPermission('dispatch_sample')) return false;
    const samples = (this.order()?.samples ?? []) as Array<{ status?: string }>;
    return samples.length > 0 && samples.every(s => s.status === 'collected');
  });
  dispatchOrder() {
    const oid = this.viewOrderId() ?? this.paidOrderId();
    if (!oid || this.dispatching()) return;
    this.dispatching.set(true);
    this.api.patch(`/api/orders/${oid}/dispatch`, {}).subscribe({
      next: () => {
        this.dispatching.set(false);
        this.toasts.success('Samples dispatched');
        this.router.navigate(['/frontdesk']);
      },
      error: () => {
        this.dispatching.set(false);
        this.toasts.error('Failed to dispatch samples');
      }
    });
  }

  /** Reset the screen for the next patient after a completed order. */
  startNewOrder() {
    this.paidOrderId.set(null);
    this._paidBill.set(null);
    this._selected.set([]);
    this._patient.set(null);
    this.discountValue.set('');
    // Clear the referring hospital + doctor (and their lookup state) so the
    // next order doesn't inherit the previous patient's referral. (item 133)
    this.refHospitalName.set('');
    this.refHospitalSuggestions.set([]);
    this.refHospitalError.set(null);
    this.refDoctorName.set('');
    this.refDoctorSuggestions.set([]);
    this.refDoctorError.set(null);
    this.router.navigateByUrl('/frontdesk/order');
    setTimeout(() => {
      this.patientSearch()?.focus();
    }, 0);
  }

  printPaidInvoice() { void this.emitPaidInvoice('print'); }
  /** Force the receipt-roll layout for this print even when the tenant's saved
   *  default is A4 (a counter can have both printers). Width comes from the
   *  saved setting when that is already a roll; otherwise 3 in / 80 mm, the
   *  common desk receipt printer. */
  printPaidThermal() { void this.emitPaidInvoice('print', 'thermal_auto'); }

  /** Post-payment "Share on WhatsApp". On the native shell we hand the real
   *  invoice PDF to the OS share sheet (WhatsApp is a target and attaches the
   *  file). On the web, wa.me can't attach a file, so we open a click-to-chat
   *  pre-filled with the invoice details — same fallback the billing counter's
   *  "Send on WhatsApp" uses. Replaces the old "Show invoice" preview, which was
   *  redundant since the itemised cart is already on screen. */
  sharePaidInvoice() {
    const bill = this.paidBill();
    if (!bill) return;
    if (this.isNativePlatform()) { void this.emitPaidInvoice('share'); return; }
    const p = this._patient();
    const lab = this.auth.user()?.tenantName || 'our lab';
    const lines = [
      `Hi ${p?.displayName ?? ''}, your invoice from ${lab}:`.replace(/\s+/g, ' ').trim(),
      `${bill.invoiceNumber ?? ''} — Paid ₹${bill.totalPayable}`.trim(),
      'Your report will be shared here once it is ready. Thank you for choosing us.',
    ];
    window.open(waLink(p?.phone, lines.join('\n')), '_blank', 'noopener');
  }

  /** Build the A4 invoice (letterhead + tracking QR) for the paid order and
   *  either print it or open it in the in-app preview. */
  private async emitPaidInvoice(
    action: 'print' | 'blob' | 'share',
    /** 'thermal_auto' = "a roll, width per the tenant's setting" — resolved
     *  below once the template has been fetched. */
    paperOverride?: 'a4' | 'thermal' | 'thermal_3in' | 'thermal_25in' | 'thermal_auto') {
    const bill = this.paidBill();
    const oid = this.paidOrderId();
    if (!bill || !oid) return;
    let tpl: any = null;
    try { tpl = await firstValueFrom(this.api.get<any>('/api/config/invoice-template')); } catch { /* optional */ }
    // Resolve the roll width now that the saved setting is in hand: reuse it
    // when it is already a roll, else 3 in / 80 mm.
    const savedPaper = tpl?.paperSize as 'a4' | 'thermal' | 'thermal_3in' | 'thermal_25in' | undefined;
    const paper = paperOverride === 'thermal_auto'
      ? (savedPaper && savedPaper !== 'a4' ? savedPaper : 'thermal_3in')
      : paperOverride;
    let qrDataUrl: string | undefined;
    let orderQrDataUrl: string | undefined;
    try {
      const QRCode = (await import('qrcode')).default;
      const res = await firstValueFrom(this.api.get<{ token: string }>(`/api/orders/${oid}/track-token`));
      if (res?.token) {
        qrDataUrl = await QRCode.toDataURL(`${window.location.origin}/track/${res.token}`, { margin: 1, width: 220 });
      }
      // Staff order QR — open the order to collect, etc.
      orderQrDataUrl = await QRCode.toDataURL(`${window.location.origin}/o/${oid}`, { margin: 1, width: 220 });
    } catch { /* QR best-effort */ }
    const mode = tpl?.documentMode ?? 'auto';
    const docTitle = mode === 'bill_of_supply' ? 'BILL OF SUPPLY'
      : mode === 'tax_invoice' ? 'TAX INVOICE'
      : (bill.totalTax > 0 ? 'TAX INVOICE' : 'BILL OF SUPPLY');
    const logoDataUrl = tpl?.showLogo === false ? undefined : await loadImageDataUrl(tpl?.logoUrl, environment.apiUrl);
    const input = {
      bill,
      order: ({ patient: this._patient() ?? undefined } as unknown as Order),
      invoiceNumber: bill.invoiceNumber ?? '',
      effectivePayable: bill.totalPayable,
      tatLabel: '',
      docTitle, qrDataUrl, orderQrDataUrl, logoDataUrl,
      // The BILL's cashier (server-resolved: who billed/collected), so a later
        // download by another user never swaps the attribution.
        cashierName: bill.cashierName || this.auth.user()?.displayName || undefined,
      cashierSignatureDataUrl: bill.cashierSignatureUrl || undefined,
      ...invoiceTemplateFieldsFrom(tpl),
      // A per-print choice beats the tenant default, so a counter with both an
      // A4 printer and a receipt roll can pick per patient.
      ...(paper ? { paperSize: paper } : {}),
      practice: {
        name: (tpl?.labName || this.auth.user()?.tenantName) || undefined,
        address: tpl?.address || undefined,
        phone: tpl?.phone || undefined,
        email: tpl?.email || undefined,
        gstin: tpl?.showGstin === false ? undefined : (tpl?.gstin || undefined),
      },
    };

    // Print/share on native: the hidden-iframe window.print() is a no-op in the
    // Capacitor WKWebView, so render to a blob and hand it to the native share
    // sheet (WhatsApp, Print, Save to Files, AirDrop…) via the Web Share API —
    // this is how "Share on WhatsApp" attaches the actual invoice PDF.
    if ((action === 'print' || action === 'share') && this.isNativePlatform()) {
      const blobUrl = generateInvoicePdf({ ...input, action: 'blob' }) as unknown as string;
      if (!blobUrl) return;
      const blob = await (await fetch(blobUrl)).blob();
      try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
      const file = new File([blob], `${bill.invoiceNumber || 'invoice'}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Invoice', text: `Invoice ${bill.invoiceNumber ?? ''}` });
        } catch (err) {
          if ((err as { name?: string })?.name !== 'AbortError') throw err;
        }
        return;
      }
      // No file-share support — fall back to the in-app preview instead.
      action = 'blob';
    }

    // 'share' only reaches here as the non-native no-canShare fallback → treat
    // as the in-app preview ('blob'); web share is handled in sharePaidInvoice.
    const finalAction: 'print' | 'blob' = action === 'print' ? 'print' : 'blob';
    const blobUrl = generateInvoicePdf({ ...input, action: finalAction });
    if (finalAction === 'blob' && blobUrl) {
      this.closeInvoicePreview();
      this.invoiceBlobUrl = blobUrl;
      this.invoicePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl));
    }
  }

  /** True inside the Capacitor native shell (iOS/Android), where window.print()
   *  and web blob downloads are no-ops. */
  private isNativePlatform(): boolean {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
  }

  /** Fit-to-width scale for the phone "Show invoice" preview. The PDF iframe
   *  renders the A4 page at its intrinsic ~794px CSS width; on a narrow screen
   *  we scale it down to the sheet width so the whole invoice is visible with
   *  nothing clipped. Capped at 1 (never upscales); only consumed by the
   *  <=640px CSS. */
  invoicePreviewScale(): number {
    const w = typeof window !== 'undefined' ? window.innerWidth : 794;
    return Math.min(1, Math.max(0.1, w / 794));
  }

  // In-app invoice preview (Show invoice) — iframe modal, no browser popup.
  readonly invoicePreviewUrl = signal<SafeResourceUrl | null>(null);
  private invoiceBlobUrl: string | null = null;
  closeInvoicePreview() {
    if (this.invoiceBlobUrl) { try { URL.revokeObjectURL(this.invoiceBlobUrl); } catch { /* noop */ } this.invoiceBlobUrl = null; }
    this.invoicePreviewUrl.set(null);
  }
  ngOnDestroy() {
    this._wideMql?.removeEventListener('change', this._onWideChange);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibleResync);
    this.closeInvoicePreview();
  }

  submit() {
    const p = this._patient();
    if (!p || this._saving() || this._selected().length === 0) return;

    // EDIT mode → PATCH the existing order's tests; the bill recomputes server-
    // side and we route to billing to collect-the-difference / refund.
    const editId = this.editOrderId();
    if (editId) {
      // Ensure all tests with collected samples remain in the selection payload
      const collected = this.collectedTestIds();
      if (collected.size > 0) {
        const cur = new Set(this._selected());
        let readded = false;
        for (const cid of collected) {
          if (!cur.has(cid)) {
            cur.add(cid);
            readded = true;
          }
        }
        if (readded) {
          this._selected.set(Array.from(cur));
        }
      }

      this._saving.set(true);
      this.api.patch<{ order: Order; bill: unknown }>(`/api/orders/${editId}/tests`, {
        testIds: this._selected(),
        specimens: this.specimenPayload(), reason: 'reception edit'
      }).subscribe({
        next: () => {
          this._saving.set(false);
          this.toasts.success('Order updated — reconcile payment');
          this.router.navigate(['/frontdesk/order'], { queryParams: this.billingQueryParams(editId) });
        },
        error: e => { this._saving.set(false); this.surfaceMutationError(e); }
      });
      return;
    }

    // If we arrived from an appointment check-in (?appointmentId=…),
    // tag the order so it traces back. Source flips to 'appointment'
    // so reports/queries can distinguish post-check-in orders from
    // pure walk-ins.
    const appointmentId = this.route.snapshot.queryParamMap.get('appointmentId');
    this._saving.set(true);
    this.api.post<Order>('/api/orders/', {
      patientId: p.id,
      refDoctorName: this.refDoctorName().trim() || null,
      refHospitalName: this.refHospitalName().trim() || null,
      priority: this._priority(),
      source: appointmentId ? 'appointment' : 'walkin',
      collectionType: 'walkin',
      testIds: this._selected(),
      metadataJson: this.buildOrderMetadata(appointmentId)
    }).subscribe({
      next: order => {
        this._saving.set(false);
        // Order persisted — drop any saved draft for this patient.
        const pid = p.id;
        try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + pid); } catch { /* ignore */ }
        this._hasDraft.set(false);
        // Workflow-driven fork: when billing is NOT a separate counter
        // (front_desk), payment is part of THIS walk-in flow — jump straight
        // into billing with the order preselected (no detour through the
        // queue). When the workflow puts billing on a separate counter, raise
        // the request and reset for the next patient.
        if (this.labCfg.billingMode() === 'front_desk') {
          // Front-desk collects via the inline pay pane (Confirm payment), so
          // submit() isn't the path here — fall back to the billing screen if
          // it's ever reached (e.g. edit-mode proceed).
          this.router.navigate(['/frontdesk/order'], { queryParams: this.billingQueryParams(order.id) });
        } else {
          // Billing lives on a separate counter. Generate the invoice HERE
          // (allocates the invoice number + tracking QR) so the patient leaves
          // with something to present; the standalone counter then scans the
          // QR / enters the invoice number to collect payment. The order stays
          // 'created' (awaiting payment) until the counter takes payment.
          this._selected.set([]);
          this._patient.set(null);
          this.api.post<Bill>('/api/billing/', { orderId: order.id, discount: this.discountAmount() }).subscribe({
            next: bill => {
              this.toasts.success(`Invoice ${bill.invoiceNumber ?? ''} generated — send the patient to the billing counter`);
              this.router.navigateByUrl('/frontdesk');
            },
            error: () => {
              // Order still exists — the counter can bill it by patient/order id.
              this.toasts.success('Order created — billing request raised');
              this.router.navigateByUrl('/frontdesk');
            }
          });
        }
      },
      error: e => { this._saving.set(false); this.surfaceMutationError(e); }
    });
  }

  back() {
    this.navBack.backTo('/frontdesk');
  }

  // ── Favourites + ref doctor handlers ────────────────────────────

  /** Click handler for the star icon on a test card. Optimistic toggle —
   *  on API failure we revert and toast. */
  toggleFavourite(testId: string, ev?: Event): void {
    ev?.stopPropagation();
    const next = new Set(this.favouriteIds());
    const wasFav = next.has(testId);
    if (wasFav) next.delete(testId); else next.add(testId);
    this.favouriteIds.set(next);

    const obs = wasFav
      ? this.api.delete<unknown>(`/api/test-picker/favorites/${testId}`)
      : this.api.post<unknown>(`/api/test-picker/favorites/${testId}`, {});
    obs.subscribe({
      error: e => {
        // Revert.
        const revert = new Set(this.favouriteIds());
        if (wasFav) revert.add(testId); else revert.delete(testId);
        this.favouriteIds.set(revert);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  setCategoryTab(tab: 'recent' | 'favourites' | 'packages' | 'profiles' | 'all'): void {
    this.categoryTab.set(tab);
    this.preSearchTab = tab;
  }

  // ── Ref hospital ─────────────────────────────────────────────────

  onRefHospitalInput(value: string): void {
    this.refHospitalName.set(value);
    this.refHospitalError.set(null);
    this.refHospitalOpen.set(true);
    if (this.refHospitalDebounce) clearTimeout(this.refHospitalDebounce);
    this.refHospitalDebounce = setTimeout(() => {
      const q = value.trim();
      this.api.get<string[]>(`/api/test-picker/hospitals${q ? `?q=${encodeURIComponent(q)}` : ''}`).subscribe({
        next: names => this.refHospitalSuggestions.set(names ?? []),
        error: () => this.refHospitalSuggestions.set([])
      });
    }, 200);
  }

  pickRefHospital(name: string): void {
    const prev = this.refHospitalName();
    this.refHospitalName.set(name);
    this.refHospitalError.set(null);
    this.refHospitalOpen.set(false);
    // Hospital changed — wipe the doctor since it might be from a different hospital.
    if (name !== prev) {
      this.refDoctorName.set('');
      this.refDoctorSuggestions.set([]);
    }
  }

  onRefHospitalBlur(): void { setTimeout(() => this.refHospitalOpen.set(false), 150); }
  onRefHospitalFocus(): void {
    if (this.refHospitalSuggestions().length === 0) {
      this.api.get<string[]>('/api/test-picker/hospitals').subscribe({
        next: names => this.refHospitalSuggestions.set(names ?? []),
        error: () => undefined
      });
    }
    this.refHospitalOpen.set(true);
  }

  // ── Ref doctor (filtered by hospital when one is picked) ──────────

  /** Reception types in the ref-doctor input — fetch suggestions debounced. */
  onRefDoctorInput(value: string): void {
    this.refDoctorName.set(value);
    this.refDoctorError.set(null);
    this.refDoctorOpen.set(true);
    if (this.refDoctorDebounce) clearTimeout(this.refDoctorDebounce);
    this.refDoctorDebounce = setTimeout(() => this.fetchDoctorSuggestions(value), 200);
  }

  pickRefDoctor(name: string): void {
    this.refDoctorName.set(name);
    this.refDoctorError.set(null);
    this.refDoctorOpen.set(false);
  }

  onRefDoctorBlur(): void {
    // Delay so a click on a suggestion fires before the popover hides.
    setTimeout(() => this.refDoctorOpen.set(false), 150);
  }

  onRefDoctorFocus(): void {
    // Show recent suggestions when the field is focused, even on empty input.
    if (this.refDoctorSuggestions().length === 0) this.fetchDoctorSuggestions('');
    this.refDoctorOpen.set(true);
  }

  private fetchDoctorSuggestions(q: string): void {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    const h = this.refHospitalName().trim();
    if (h) params.set('hospital', h);
    const qs = params.toString();
    this.api.get<string[]>(`/api/test-picker/doctors${qs ? `?${qs}` : ''}`).subscribe({
      next: names => this.refDoctorSuggestions.set(names ?? []),
      error: () => this.refDoctorSuggestions.set([])
    });
  }
}

/** Suggestion shown above the cart when picked individual tests are
 *  available as part of a cheaper package. */
interface PackageSuggestion {
  package: Test;
  /** Selected individual-test ids that this package contains. */
  coveredIds: string[];
  /** How many tests the package contains in total (covered + extras). */
  memberCount: number;
  /** Sum of the covered individual tests' prices (without GST). */
  individualSum: number;
  /** individualSum − package.price, clamped at 0. */
  savings: number;
}

/** Parse the package's `Parameters` JSON to extract member test ids.
 *  Mirrors the backend's OrderService.ParsePackageChildIds shape:
 *    { items: [{ testId: '<guid>' }, ...] }
 *  Returns [] for any malformed/missing payload — safe to call on
 *  every test, package or not. */
function parsePackageMembers(parametersJson: string | undefined | null): string[] {
  if (!parametersJson) return [];
  try {
    const parsed = JSON.parse(parametersJson) as { items?: Array<{ testId?: string }> };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items
      .map(it => (it?.testId ?? '').trim())
      .filter(id => id.length > 0);
  } catch {
    return [];
  }
}
