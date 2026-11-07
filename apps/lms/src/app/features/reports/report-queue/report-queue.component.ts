import { CommonModule, DatePipe } from "@angular/common";
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { firstValueFrom } from "rxjs";
import { busyWhile } from "../../../shared/utils/busy";
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import { DestroyRef,
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from "../../../../environments/environment";
import { Router } from "@angular/router";
import { ApiService } from "../../../core/services/api.service";
import { LiveQueueService } from "../../../core/services/live-queue.service";
import { AuthService } from "../../../core/auth/auth.service";
import { DialogService } from "../../../core/services/dialog.service";
import { ToastService } from "../../../core/services/toast.service";
import { Report } from "../../../shared/models/report.model";
import { ApiError } from "../../../shared/models/api-response.model";
import { Order, OrderTest } from "../../../shared/models/order.model";
import { formatPatientInfo, formatPatientMeta, patientDisplayName } from "../../../shared/models/patient.model";
import { buildPartialOrders, orderLabel, reportStatus, type PrelimOrder, type PrelimRow, type ReportStatus } from "./report-queue.partial";
import { webPointerSignal } from "../../../shared/utils/pointer-mode";
import {
  ChipComponent,
  ChipTone,
} from "../../../shared/primitives/chip.component";
import { ScreenHeaderComponent } from "../../../shared/primitives/screen-header.component";
import {
  SegmentedComponent,
  SegmentedOption,
} from "../../../shared/primitives/segmented.component";
import { SkeletonComponent } from "../../../shared/primitives/skeleton.component";
import {
  TileComponent,
  TileTone,
} from "../../../shared/primitives/tile.component";
import { TouchButtonComponent } from "../../../shared/primitives/touch-button.component";
import { KpiStripComponent } from "../../../shared/components/kpi-strip/kpi-strip.component";
import { reportPublicLink } from "../../../shared/utils/whatsapp-manual";
import { WhatsAppManualService } from "../../../core/services/whatsapp-manual.service";
import {
  REPORT_QUEUE_PAGE_SIZE,
  reportQueuePageUrl,
  reportQueueServerStatus,
  type ReportQueueCounts,
  type ReportQueuePage,
} from "../../../shared/utils/report-summary";
import { WhatsAppService, waStatusLabel, type WaMessage } from "../../../core/services/whatsapp.service";
import { WhatsAppSendService, waSendLabel } from "../../../core/services/whatsapp-send.service";
import { EditResultDialogComponent } from "../../../shared/components/edit-result-dialog/edit-result-dialog.component";
import { savedValueRows } from "../../../shared/utils/result-flag";
import { ZoomSourceDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, type PfAction } from '../../../shared/components/actions-menu/actions-menu.component';
import { PATIENT_PROFILE_PERMS, ReportActionsService, WA_MANUAL_NOTE } from '../../../core/services/report-actions.service';
import { formatAge } from "../../../shared/utils/patient-age";
import { BusyDirective } from "../../../shared/directives/busy.directive";
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';
import { matchesDailyNo } from '../../../shared/utils/daily-no';

type Filter = "all" | "partial" | "pending" | "delivered" | "failed";

@Component({
  selector: "pf-report-queue",
  standalone: true,
  imports: [
    DailyNoComponent,
    ZoomSourceDirective,
    CommonModule,
    DatePipe,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent,
    EditResultDialogComponent,
    KpiStripComponent,
    HeroBandComponent,
    ActionsMenuComponent,
    ActionsMenuTriggerDirective,
    BusyDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./report-queue.component.html",
  styleUrl: "./report-queue.component.scss"
})
export class ReportQueueComponent implements OnInit {
  formatReportPatient(p: any): string {
    return formatPatientInfo(p);
  }

  // ── New design (docs/PF-PATTERN.md → "Reports list") ─────────────
  /** Web (fine pointer) = text row actions; touch = 44px icon actions. */
  readonly web = webPointerSignal();

  /** FULL patient name — never cut (formatPatientInfo stops at 15 chars). */
  reportPatientName(r: Report): string {
    return patientDisplayName(r.order?.patient as never) || `Report #${r.id.slice(0, 8).toUpperCase()}`;
  }

  /** "29/M · AA0012 · Order LAB-2609-000089 · 26 Sep, 6:37 PM" — no "|", no mono. */
  reportMeta(r: Report): string {
    const p = r.order?.patient;
    const o = r.order as { id: string; orderNumber?: string | null } | undefined;
    const when = this.shortWhen(r.createdAt);
    return [p ? formatPatientMeta(p as never) : "", o?.id ? orderLabel(o) : "", when, ...this.cardStatus(r).extra, this.waMeta(r)]
      .filter(Boolean).join(" · ");
  }

  /** Latest automatic/resent WhatsApp message per report id (Meta Cloud API). */
  private readonly _wa = signal<Record<string, WaMessage>>({});

  /** "WhatsApp sent / delivered / read / queued / failed / not sent" for the
   *  row meta — a hidden fact, so it rides in the meta line (ND §20). Meta's
   *  "delivered" also flips the report to Delivered server-side. */
  waMeta(r: Report): string {
    const live = this.waSend?.state(r.id);
    if (live) {
      const word = waSendLabel(live.phase).toLowerCase();
      return live.to && live.phase !== "sending" && live.phase !== "failed" ? `WhatsApp ${word} · ${live.to}` : `WhatsApp ${word}`;
    }
    const m = this._wa()[r.id];
    if (!m) return "";
    return `WhatsApp ${waStatusLabel(m.status).toLowerCase()}`;
  }

  /** One batch call for the final reports on screen. Non-fatal. */
  private loadWaStatus(list: Report[], append = false): void {
    const ids = list.filter((r) => r.type === "final").map((r) => r.id);
    if (!ids.length) { if (!append) this._wa.set({}); return; }
    this.wa.statusBatch(ids).subscribe({
      next: (map) => {
        const m = map && typeof map === "object" ? map : {};
        this._wa.update((cur) => (append ? { ...cur, ...m } : m));
      },
      error: () => { /* no WhatsApp column — nothing else changes */ },
    });
  }

  /** The card's ONE status (dot + coloured word, right column) — see reportStatus. */
  cardStatus(r: Report): ReportStatus {
    return reportStatus(r.deliveryStatus, r.type, this.isUnpaid(r));
  }

  private shortWhen(iso: string | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return time;
    return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
  }

  /** ONE status filter, in the band pill: a neutral segmented control
   *  (raised neutral selected tab), plain tabular counts, no colour dots. */
  readonly ndFilters = computed<{ value: Filter; label: string; count: number }[]>(() => [
    { value: "all", label: "All", count: this.counts().all },
    { value: "pending", label: "Completed", count: this.counts().pending },
    { value: "partial", label: "Partial", count: this.partialOrders().length },
    { value: "delivered", label: "Delivered", count: this.counts().delivered },
    { value: "failed", label: "Failed", count: this.counts().failed },
  ]);

  /** Roving arrow keys across the band filter (radiogroup). */
  onFilterKey(ev: KeyboardEvent) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(ev.key)) return;
    ev.preventDefault();
    const list = this.ndFilters();
    const i = list.findIndex((f) => f.value === this._filter());
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? list.length - 1
      : (i + (ev.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
    this.setFilter(list[next].value);
    const host = ev.currentTarget as HTMLElement | null;
    (host?.querySelectorAll<HTMLElement>("[role=radio]")[next])?.focus();
  }
  private readonly api = inject(ApiService);
  private readonly wa = inject(WhatsAppService);
  private readonly waSend = inject(WhatsAppSendService);
  /** Design gate: the hero band renders in the NEW design only. */
  readonly theme = inject(ThemeService);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly zoom = inject(ZoomTransitionService);
  private readonly dialog = inject(DialogService);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);

  // "Completed" = lab work signed off, report generated, awaiting
  // delivery. Backed by deliveryStatus === 'pending' on the report row
  // (the technical name stays 'pending' for backwards compatibility;
  // the user-facing label reflects the semantic — these are completed
  // work products, not unfinished work).
  /**
   * The filter toggle IS the status legend (owner): each state carries
   * its colour dot and live count, so the rows themselves don't have to
   * repeat the word — their accent bar is enough.
   */
  readonly filterOptions = computed<SegmentedOption<Filter>[]>(() => [
    // Icons mirror the ones the old phone-only filter row used, so the
    // vocabulary is unchanged — they just moved into the search bar and
    // only replace the words on phones.
    { value: "all", label: "All", dot: "#a78bfa", count: this.counts().all,
      iconPath: ["M4 6h16", "M4 12h16", "M4 18h16"] },
    { value: "pending", label: "Completed", dot: "#f59e0b", count: this.counts().pending,
      iconPath: ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "M22 4 12 14.01l-3-3"] },
    { value: "partial", label: "Partial", dot: "#38bdf8", count: this.partialOrders().length,
      // Two arcs + Z so the circle actually CLOSES (a single 10-radius arc
      // only draws half of one, which rendered as a crescent), then two
      // radii mark the wedge: a pie, i.e. "some of it is done".
      iconPath: ["M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Z", "M12 12V3", "M12 12h9"] },
    { value: "delivered", label: "Delivered", dot: "#10b981", count: this.counts().delivered,
      iconPath: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"] },
    { value: "failed", label: "Failed", dot: "#f43f5e", count: this.counts().failed,
      iconPath: ["M10 10l4 4m0-4l-4 4", "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z"] },
  ]);

  // Default to 'pending' (Completed) — the queue's primary purpose is
  // showing what's done and waiting for handover.
  private readonly _filter = signal<Filter>("pending");
  readonly filter = this._filter.asReadonly();
  /** Human label for the active filter — shown on phone above the list so the
   *  icon-only filter row reads clearly ("which category am I looking at?"). */
  // ── Post-result edit ──────────────────────────────────
  // Same dialog the report viewer uses; the queue is where a finished
  // report is usually spotted, so the action belongs on the row too.
  // edit_result: Lab Technician, Pathologist, Lab Admin — not front desk.
  readonly canEditResult = computed(() => this.auth.hasPermission("edit_result"));
  /** Share / WhatsApp / Print-delivery record a DELIVERY (deliver_report).
   *  Everyone who can open this page sees the same reports; only the send
   *  actions depend on the permission. */
  readonly canDeliver = computed(() => this.auth.hasPermission("deliver_report"));
  /** Generate / Regenerate / Partial PDF change what the patient receives:
   *  the backend admits deliver_report | validate_result (same as Amend). */
  readonly canGenerate = computed(() => this.auth.hasAnyPermission(["deliver_report", "validate_result"]));
  /** VIEW-ONLY Results (view_report without deliver_report — Lab Tech, Branch
   *  Manager, Quality Manager): the same branch-scoped list, View + Download
   *  + Print (not recorded as a delivery). No Share / WhatsApp, no
   *  Generate / Regenerate. */
  readonly viewOnly = computed(() => !this.canDeliver());
  /** Print (owner, 2026-09-27): everyone who can open Results may print —
   *  view-only included, via the same letterpad choice. For them it is NOT a
   *  delivery: nothing is recorded (POST /deliver stays deliver_report). */
  readonly canPrint = computed(() => this.canDeliver() || this.auth.hasPermission("view_report"));
  /** "Open lab results" lands on /lab/sample/:id — its guard. */
  readonly canOpenLabResults = computed(() =>
    this.auth.hasAnyPermission(["enter_result", "edit_result", "validate_result"]));
  readonly editOrderId = signal<string | null>(null);

  /** The row's More menu has at least one item (else no empty menu button). */
  hasMore(r: Report): boolean {
    return (this.rowActions().get(r.id)?.length ?? 0) > 0;
  }

  // ── ⋮ Report actions per row (shared/components/actions-menu) ─────
  // EVERY action for the report in one place: share (patient link, WhatsApp,
  // print-as-delivery), the PDF (view / download / print), the workflow steps
  // (edit results, regenerate) and go-to (patient, lab results). Each row
  // follows the SAME permission + state rule as the button it mirrors.
  private readonly reportActions = inject(ReportActionsService);
  private readonly waManual = inject(WhatsAppManualService);
  readonly rowActions = computed<Map<string, PfAction[]>>(() => {
    const m = new Map<string, PfAction[]>();
    for (const r of this.visible()) m.set(r.id, this.buildRowActions(r));
    return m;
  });

  private buildRowActions(r: Report): PfAction[] {
    const a: PfAction[] = [];
    if (this.reportActions.canLink(r)) {
      a.push({ id: 'share', label: 'Share…', icon: 'share', group: 'Share', hint: this.reportActions.shareHint() });
      a.push({ id: 'copy-link', label: 'Copy patient link', icon: 'link', group: 'Share' });
    }
    // ONE WhatsApp row: WhatsApp Auto (entitled + a sender), else WhatsApp Chat (entitled), else none.
    a.push(...this.reportActions.whatsAppActions(r));
    a.push({ id: 'view', label: 'View report', icon: 'view', group: 'Report' });
    a.push({ id: 'download', label: 'Download PDF', icon: 'download', group: 'Report' });
    if (this.canPrint()) {
      a.push({ id: 'print', label: 'Print', icon: 'print', group: 'Report', hint: this.canDeliver() ? 'Recorded as delivered' : undefined });
    }
    if (this.canEditResult() && r.orderId) a.push({ id: 'edit', label: 'Edit results', icon: 'edit', group: 'Report' });
    if (this.canGenerate() && r.orderId) {
      a.push({ id: 'regenerate', label: 'Regenerate', icon: 'regenerate', group: 'Report', hint: 'Rebuild with the current report template' });
    }
    if (r.patientId && PATIENT_PROFILE_PERMS.some(p => this.auth.hasPermission(p))) {
      a.push({ id: 'patient', label: 'Open patient', icon: 'patient', group: 'Go to' });
    }
    if (this.canOpenLabResults() && r.orderId) a.push({ id: 'lab', label: 'Open lab results', icon: 'lab', group: 'Go to' });
    return a;
  }

  /** A row's menu opened: warm its patient link (Share… keeps the gesture). */
  onRowMenuOpened(r: Report): void { this.reportActions.prefetch(r); }

  runRowAction(r: Report, id: string): void {
    switch (id) {
      case 'share': void this.reportActions.share(r, this.reportPatientName(r)); break;
      case 'copy-link': void this.reportActions.copyLink(r); break;
      case 'whatsapp': this.deliver(r, 'whatsapp'); break;
      case 'whatsapp-mine': this.deliver(r, 'whatsapp-mine'); break;
      case 'view': this.view(r); break;
      case 'download': void this.downloadPdf(r); break;
      case 'print': void this.printReport(r); break;
      case 'edit': this.openEditDialog(r); break;
      case 'regenerate': void this.regenerate(r); break;
      case 'patient': void this.router.navigate(['/frontdesk/patients', r.patientId]); break;
      case 'lab': void this.viewLabResults(r); break;
    }
  }

  openEditDialog(r: Report) {
    if (r.orderId) this.editOrderId.set(r.orderId);
  }

  /** Corrected work left this report behind — reload the queue so its
   *  status/rows reflect the re-opened state. */
  onEdited() {
    this.editOrderId.set(null);
    this.refresh();
  }

  readonly activeFilterLabel = computed(
    () =>
      this.filterOptions().find((o) => o.value === this._filter())?.label ??
      "All",
  );
  setFilter(f: Filter) {
    const before = reportQueueServerStatus(this._filter());
    this._filter.set(f);
    // The report tabs are filtered server-side (paged queue); Partial reads
    // the whole queue for its counts, so switching to / from it only reloads
    // when the server status actually changes.
    if (reportQueueServerStatus(f) !== before) this.loadQueue("reset");
  }

  /** Phone-only presentational state: the compact stat summary's
   *  expanded/collapsed flag. No business logic. */
  private readonly _statsOpen = signal(false);
  readonly statsOpen = this._statsOpen.asReadonly();
  toggleStats() {
    this._statsOpen.update((v) => !v);
  }

  /** Which row has its "more" menu open — edit / regenerate / open lab
   *  results. Seven icons per row read as a wall at every width, so the row
   *  is View · Download · Share ▾ · More (owner) — four cells, with the two
   *  things people actually come here for out in the open and everything
   *  else one tap away. One row at a time; opening either menu closes the
   *  other. Presentational only. */
  private readonly _moreFor = signal<string | null>(null);
  readonly moreFor = this._moreFor.asReadonly();
  toggleMore(id: string, ev?: Event) {
    this._shareFor.set(null);
    this._moreFor.update((cur) => (cur === id ? null : id));
    if (this._moreFor() && ev) this.anchorMenu(ev, 3);
  }

  /** Where the open menu should sit, in viewport coordinates.
   *
   *  The menus used to be absolutely positioned inside the row, which the
   *  scrolling list clipped, and then a bottom sheet, which opened nowhere
   *  near the finger (owner). Fixed + measured from the button's own rect
   *  puts it exactly under what was tapped, and nothing can clip it. */
  readonly menuPos = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  private anchorMenu(ev: Event, items: number) {
    const el = ev.currentTarget as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 200;
    const H = items * 44 + 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Right-align to the button, then clamp inside the viewport.
    const left = Math.min(Math.max(8, r.right - W), Math.max(8, vw - W - 8));
    // Below by default; flip above when there isn't room (last rows).
    const top = r.bottom + 6 + H > vh ? Math.max(8, r.top - 6 - H) : r.bottom + 6;
    this.menuPos.set({ top, left });
  }

  /** Which row has its share-channel menu open (the split button's caret). */
  private readonly _shareFor = signal<string | null>(null);
  readonly shareFor = this._shareFor.asReadonly();
  toggleShare(id: string, ev?: Event) {
    this._moreFor.set(null);
    this._shareFor.update((cur) => (cur === id ? null : id));
    if (this._shareFor() && ev) this.anchorMenu(ev, 2);
  }

  /** Read the value off the phone filter <select> (drives the same
   *  filter signal the desktop pills drive). */
  asFilter(ev: Event): Filter {
    return (ev.target as HTMLSelectElement).value as Filter;
  }

  /** Free-text search across patient name, phone, order id and report
   *  id — same vibe as the FD landing's search box. */
  private readonly _query = signal<string>("");
  readonly query = this._query.asReadonly();
  setQuery(q: string) {
    const before = this._query().trim();
    this._query.set(q);
    // The loaded rows narrow instantly (client filter below); the server
    // search follows once typing pauses.
    if (q.trim() === before) return;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadQueue("reset"), 250);
  }
  private _searchTimer: ReturnType<typeof setTimeout> | undefined;
  asInput(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  private readonly _items = signal<Report[]>([]);
  readonly items = this._items.asReadonly();

  // Starts TRUE: the first page is always on its way (after the backfill
  // call), so the first frame is the list skeleton — never "No reports here".
  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();

  // Order IDs (lower-cased) that still carry an outstanding balance
  // (payment due). Populated once from /api/billing/outstanding on
  // refresh — a single branch-scoped bulk call, NOT a per-row fetch.
  // Every row in this queue is a generated ("report ready") report, so
  // a row whose order is in this set is "report ready + payment due" and
  // gets the Unpaid badge.
  private readonly _dueOrderIds = signal<Set<string>>(new Set());

  /** True when the report is ready (it's in the queue) AND the order's
   *  bill still has a balance due (> 0). Drives the "Unpaid" badge. */
  isUnpaid(r: Report): boolean {
    return this._dueOrderIds().has((r.orderId ?? "").toLowerCase());
  }

  // ── Server paging (DB optimisation phase 3) ─────────────────────
  // The queue loads a page at a time (status + search applied server-side);
  // "Load more" appends the next page. `_total` null = an older server that
  // answered the whole queue as an array (counted client-side, no paging).
  private readonly _total = signal<number | null>(null);
  readonly total = this._total.asReadonly();
  private readonly _serverCounts = signal<ReportQueueCounts | null>(null);
  private readonly _loadingMore = signal(false);
  readonly loadingMore = this._loadingMore.asReadonly();
  private _pages = 0;
  private _seq = 0;
  readonly hasMorePages = computed(() => {
    const t = this._total();
    return t != null && this._items().length < t;
  });
  /** Rows the next page brings ("Load 50 more"). */
  readonly nextPageCount = computed(() =>
    Math.max(0, Math.min(REPORT_QUEUE_PAGE_SIZE, (this._total() ?? 0) - this._items().length)));

  readonly counts = computed<ReportQueueCounts>(() => {
    const sc = this._serverCounts();
    if (sc) return sc;
    const l = this._items();
    return {
      all: l.length,
      pending: l.filter((r) => r.deliveryStatus === "pending").length,
      delivered: l.filter((r) => r.deliveryStatus === "delivered").length,
      failed: l.filter((r) => r.deliveryStatus === "failed").length,
    };
  });

  loadMore() {
    if (this._loadingMore() || !this.hasMorePages()) return;
    this.loadQueue("more");
  }

  /** reset = page 1 for the current tab + search; refresh = the same pages
   *  again (one request, so a live update never collapses a scrolled list);
   *  more = the next page, appended. Stale answers are dropped. */
  private loadQueue(mode: "reset" | "refresh" | "more") {
    const seq = ++this._seq;
    const pages = Math.max(1, this._pages);
    const page = mode === "more" ? this._pages + 1 : 1;
    const pageSize = mode === "refresh" ? REPORT_QUEUE_PAGE_SIZE * pages : REPORT_QUEUE_PAGE_SIZE;
    if (mode === "more") this._loadingMore.set(true); else this._loading.set(true);
    const sentQ = this._query().trim().toLowerCase();
    const url = reportQueuePageUrl({
      page, pageSize, status: reportQueueServerStatus(this._filter()), q: this._query(),
    });
    this.api.get<Report[] | ReportQueuePage<Report> | null>(url).subscribe({
      next: (res) => {
        if (seq !== this._seq) return;
        this._loading.set(false);
        this._loadingMore.set(false);
        if (!res || Array.isArray(res)) {
          const l = (res as Report[] | null) ?? [];
          this._servedQ.set(""); // an unpaged answer is not search-narrowed
          this._items.set(l);
          this._total.set(null);
          this._serverCounts.set(null);
          this._pages = 1;
          this.loadWaStatus(l);
          return;
        }
        const items = res.items ?? [];
        if (mode === "more") {
          const seen = new Set(this._items().map((r) => r.id));
          const fresh = items.filter((r) => !seen.has(r.id));
          this._items.update((cur) => [...cur, ...fresh]);
          this._pages += 1;
          this.loadWaStatus(fresh, true);
        } else {
          this._servedQ.set(sentQ);
          this._items.set(items);
          this._pages = mode === "refresh" ? pages : 1;
          this.loadWaStatus(items);
        }
        this._total.set(res.total ?? items.length);
        this._serverCounts.set(res.counts ?? null);
      },
      error: () => {
        if (seq !== this._seq) return;
        this._loading.set(false);
        this._loadingMore.set(false);
      },
    });
  }

  /** The search term the loaded rows were fetched for (lower-cased). When it
   *  equals the box, the SERVER already narrowed the page (order number,
   *  invoice number, name, phone…), so the client must not hide any of it. */
  private readonly _servedQ = signal<string>("");

  readonly visible = computed(() => {
    const f = this._filter();
    const q = this._query().trim().toLowerCase();
    let l = this._items();
    if (f !== "all") l = l.filter((r) => r.deliveryStatus === f);
    if (q && q !== this._servedQ()) {
      l = l.filter((r) => {
        const name = (r.order?.patient?.displayName ?? "").toLowerCase();
        const phone = (r.order?.patient?.phone ?? "").toLowerCase();
        const mrn = (r.order?.patient?.mrn ?? "").toLowerCase();
        const orderNo = (r.order?.orderNumber ?? "").toLowerCase();
        const invoiceNo = (r.order?.invoiceNumber ?? "").toLowerCase();
        // Match against patient name, phone, MRN, short order id, and
        // short report id — covers every reasonable lookup reception
        // runs from a paper slip.
        return (
          matchesDailyNo(q, r.order) ||
          name.includes(q) ||
          phone.includes(q) ||
          mrn.includes(q) ||
          orderNo.includes(q) ||
          invoiceNo.includes(q) ||
          r.orderId.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q)
        );
      });
    }
    return l;
  });

  /** Every row now uses the neutral 'default' tile tone — the per-status
   *  colour wash made the entire row feel amber-on-amber for the common
   *  "Completed" case. Status is communicated by the small icon badge
   *  + chip + the left-edge accent strip instead. */
  rowTone(_status: string): TileTone {
    return "default";
  }

  /** Phone-only subline text: "Male · 32y" built from the patient's sex and
   *  age. Reuses the already-loaded order.patient fields (no data fetch).
   *  Renders only what's available; returns '' if both are missing so the
   *  template's `@if … as` skips the element entirely. */
  patientSexAge(
    p: { sex?: string | null; age?: number | null; dateOfBirth?: string | null } | null | undefined,
  ): string {
    if (!p) return "";
    const parts: string[] = [];
    const sex = this.formatSex(p.sex);
    if (sex) parts.push(sex);
    const age = formatAge(p, "y");
    if (age) parts.push(age);
    return parts.join(" · ");
  }

  /** Normalise a raw sex value (e.g. 'm', 'FEMALE') to a short label. */
  private formatSex(sex?: string | null): string {
    const v = (sex ?? "").trim();
    if (!v) return "";
    const lc = v.toLowerCase();
    if (lc === "m" || lc === "male") return "Male";
    if (lc === "f" || lc === "female") return "Female";
    if (lc === "o" || lc === "other") return "Other";
    return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  }

  chipTone(status: string): ChipTone {
    if (status === "failed") return "rose";
    if (status === "pending") return "amber";
    if (status === "delivered") return "emerald";
    return "default";
  }

  /** Map raw deliveryStatus → user-facing label. The DB still stores
   *  'pending' for "report generated, awaiting handover" but the user
   *  thinks of these as Completed work, so we relabel at the edge. */
  statusLabel(status: string): string {
    if (status === "pending") return "Completed";
    if (status === "delivered") return "Delivered";
    if (status === "failed") return "Failed";
    return status;
  }

  // ── Preliminary report state ────────────────────────────────────
  // Loaded from /api/orders/partial-ready and filtered to orders with at
  // least one whole sample (department) validated. No PDF here —
  // values are read straight from each OrderTest.currentResult.
  private readonly _todayOrders = signal<Order[]>([]);
  private readonly _expanded = signal<string | null>(null);
  readonly expanded = this._expanded.asReadonly();
  toggle(id: string) {
    this._expanded.set(this._expanded() === id ? null : id);
  }

  // Single-flight guard while the partial PDF is being generated;
  // the value is the order ID currently being submitted (so we can
  // disable just that card's button, not all of them).
  private readonly _generating = signal<string | null>(null);
  readonly generating = this._generating.asReadonly();

  // ── Loading feedback (PF-PATTERN "Loading feedback") ──────────────
  // A row action that renders / posts (Download, Print, Regenerate) keeps
  // ITS button busy until it answers; keyed "<reportId>:<kind>" so several
  // rows can run at once and a repeat press on the same one is ignored.
  private readonly _rowBusy = signal<ReadonlySet<string>>(new Set());
  isRowBusy(id: string, kind: 'download' | 'print' | 'regenerate'): boolean {
    return this._rowBusy().has(`${id}:${kind}`);
  }
  private setRowBusy(id: string, kind: 'download' | 'print' | 'regenerate', on: boolean): void {
    const key = `${id}:${kind}`;
    const next = new Set(this._rowBusy());
    if (on) next.add(key); else next.delete(key);
    this._rowBusy.set(next);
  }
  /** The row's WhatsApp server send is running (its Share face is busy). */
  waSending(id: string): boolean { return !!this.waSend?.busy(id); }
  /** "Generate" (order id prompt) is posting. */
  readonly generatingReport = signal(false);

  generatePartial(po: PrelimOrder) {
    if (this._generating() || !this.canGenerate()) return;
    this._generating.set(po.id);
    const sampleIds = po.readySampleIds;
    this.api
      .post<Report>("/api/reports/generate/partial", {
        orderId: po.id,
        sampleIds,
      })
      .subscribe({
        next: (r) => {
          this._generating.set(null);
          if (r?.id) {
            this.toasts.success("Partial PDF generated");
            this.router.navigate(["/reports/view", r.id]);
          } else {
            this.toasts.warning(
              "Could not generate — check that all selected tubes are validated.",
            );
          }
        },
        error: (e) => {
          this._generating.set(null);
          this.toasts.error(ApiError.from(e).message);
        },
      });
  }

  /** Orders with ≥1 fully validated tube and ≥1 that isn't — grouped by
   *  DEPARTMENT with per-test readiness (see report-queue.partial.ts for why
   *  the old per-tube count read "MIC" as both ready and pending). */
  readonly partialOrders = computed<PrelimOrder[]>(() =>
    buildPartialOrders(this._todayOrders(), (t) => this.extractValues(t)));

  /** The Partial tab honours the band search too. */
  readonly visiblePartials = computed<PrelimOrder[]>(() => {
    const q = this._query().trim().toLowerCase();
    const l = this.partialOrders();
    return q ? l.filter((po) => matchesDailyNo(q, po) || po.searchText.includes(q)) : l;
  });

  /** Preliminary values with the flag + range mw SAVED with the result
   *  (snapshot `flagged` map) — never a browser recompute. */
  private extractValues(t: OrderTest): PrelimRow[] {
    if (!t.currentResult || !t.test?.parameters) return [];
    return savedValueRows(t.currentResult, t.test.parameters).map(r => ({
      name: r.name,
      title: r.title,
      value: r.value ?? "—",
      unit: r.unit,
      range: r.range,
      flag: r.flag,
      code: r.code,
    }));
  }

  ngOnInit() {
    this.waSend.ensure();
    // Live: a validation elsewhere can complete an order → its report appears.
    this.liveQ.on('reports', 'validation').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.destroyRef.onDestroy(() => clearTimeout(this._searchTimer));
    // Self-healing: ask the backend to generate any missing final
    // reports for orders that are already 'validated' but have no
    // report row yet (e.g. validations done before the
    // auto-report-on-validation hook landed). Idempotent on the
    // backend; failures are non-fatal — we still load the queue.
    this.api
      .post<{ generated: number }>("/api/reports/backfill", {})
      .subscribe({
        next: () => this.refresh(),
        error: () => this.refresh(),
      });
  }

  refresh() {
    // Summary rows (no rendered snapshot): render paths read the report by id.
    // Paged: the pages already on screen, reloaded in one request.
    this.loadQueue(this._pages > 0 ? "refresh" : "reset");
    // Independent fetch — partial reports come from today's orders that carry
    // a validated line, WITH their results (GET /api/orders/partial-ready; the
    // day feed itself no longer carries results). A failure here doesn't
    // block the main queue load.
    this.api.get<Order[]>("/api/orders/partial-ready").subscribe({
      next: (l) => this._todayOrders.set(l ?? []),
      error: () => {
        /* non-fatal */
      },
    });
    // One bulk, branch-scoped call for every bill that still owes money
    // (balance > 0). We only need the order IDs to flag "Unpaid" rows —
    // no per-row bill lookups. Non-fatal: if the user lacks billing
    // permission (403) or the call fails, we simply show no Unpaid tags.
    // Skip the call entirely for users the endpoint would 403 (e.g. a
    // Pathologist: no collect_payment | create_bill | view_bill).
    if (!["collect_payment", "create_bill", "view_bill"].some((c) => this.auth.hasPermission(c))) return;
    this.api
      .get<{ due?: { orderId: string }[] }>("/api/billing/outstanding")
      .subscribe({
        next: (res) =>
          this._dueOrderIds.set(
            new Set(
              (res?.due ?? []).map((d) => (d.orderId ?? "").toLowerCase()),
            ),
          ),
        error: () => {
          /* non-fatal — no Unpaid tags shown */
        },
      });
  }

  view(r: Report) {
    this.router.navigate(["/reports/view", r.id]);
  }

  /** Open the bench's result-entry screen READ-ONLY for this order (owner
   *  2026-09-20) — sibling-tube tabs inside the screen cover multi-tube
   *  orders, so the first sample is enough of an entry point. */
  async viewLabResults(r: Report) {
    if (!r.orderId) return;
    try {
      const order = await firstValueFrom(
        this.api.get<{ samples?: Array<{ id: string }> }>(`/api/orders/${r.orderId}`));
      const sid = order?.samples?.[0]?.id;
      if (!sid) { this.toasts.error("No sample found for this order."); return; }
      this.zoom.rearm(r.id);   // the order fetch can outlast the tap's arm
      void this.router.navigate(["/lab/sample", sid], { queryParams: { view: 1 } });
    } catch {
      this.toasts.error("Could not open the lab results.");
    }
  }

  /** Download the report's STORED PDF (owner rule 2026-09-29: the report is
   *  the file in blob storage). A report with nothing stored yet is rendered
   *  ONCE from its saved snapshot and stored first. */
  async downloadPdf(r: Report) {
    if (this.isRowBusy(r.id, 'download')) return;
    this.setRowBusy(r.id, 'download', true);
    try {
      const blob = await this.storedPdf(r);
      if (this.isNativePlatform()) {
        // Capacitor WKWebView: web blob downloads are no-ops. Hand the PDF to
        // the native iOS share sheet (Save to Files, AirDrop, etc.) via the
        // Web Share API — no Capacitor plugin needed.
        await this.sharePdfNative(r, blob, "Download report");
      } else {
        const { downloadPdfBlob } = await import('../../../shared/utils/stored-report-pdf');
        downloadPdfBlob(blob, this.pdfFileName(r));
      }
    } catch (err) {
      console.error("[reports] download failed", err);
      const { reportRenderErrorMessage } = await import("../../../shared/utils/report-render-input");
      this.toasts.error(reportRenderErrorMessage(err, "Could not download report"));
    } finally {
      this.setRowBusy(r.id, 'download', false);
    }
  }

  /** "REPORT-XXXXXXXX.pdf" / "PRELIM-…" — the name the jsPDF save used. */
  private pdfFileName(r: Report): string {
    const shortId = r.id.replace(/-/g, "").slice(-8).toUpperCase();
    return `${r.type === "partial" ? "PRELIM" : "REPORT"}-${shortId}.pdf`;
  }

  /** THE report PDF (stored; rendered + stored once when it has none). */
  private async storedPdf(r: Report, variant: 'full' | 'letterpad' = 'full'): Promise<Blob> {
    const { storedReportBlob } = await import('../../../shared/utils/report-blob');
    return storedReportBlob(r, this.api, this.injector, variant);
  }

  /** True when running inside the Capacitor native shell (iOS/Android),
   *  where web blob downloads and window.print are no-ops. */
  private isNativePlatform(): boolean {
    return !!(
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.();
  }

  /** Present a rendered report PDF through the native iOS/Android share sheet
   *  using the Web Share API (level 2 — file sharing). From the sheet the user
   *  can Save to Files, Print, AirDrop, etc. AbortError (user dismisses the
   *  sheet) is swallowed; anything else surfaces a toast. */
  private async sharePdfNative(r: Report, blob: Blob, title: string) {
    const shortId = r.id.replace(/-/g, "").slice(-8).toUpperCase();
    const name = r.order?.patient?.displayName ?? "";
    const file = new File([blob], `report-${shortId}.pdf`, {
      type: "application/pdf",
    });
    const text = name ? `Lab report for ${name}` : "Lab report";
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
      } else {
        // No file-share support — fall back to the web download path.
        const { downloadPdfBlob } = await import('../../../shared/utils/stored-report-pdf');
        downloadPdfBlob(blob, this.pdfFileName(r));
      }
    } catch (err) {
      // User cancelled the share sheet — not an error.
      if ((err as { name?: string })?.name === "AbortError") return;
      throw err;
    }
  }

  /** Make sure the report's PDF is STORED (no local download) so the public
   *  /reports/public/{qrToken} link serves the real file — a no-op when it
   *  already is. Best-effort. */
  private async archiveReportPdf(r: Report) {
    try { await this.storedPdf(r); } catch { /* best-effort */ }
  }

  /** The lab sends this report from its own number (WhatsApp Auto). */
  waAuto(r: Report): boolean { return !!this.waSend?.canSend(r); }
  /** The ONE WhatsApp action for a row: Auto, else Chat, else none. */
  waMode(r: Report): 'auto' | 'chat' | null { return this.waSend?.mode(r) ?? null; }
  waLabel(r: Report): string { const m = this.waMode(r); return m === 'auto' ? 'WhatsApp Auto' : m === 'chat' ? 'WhatsApp Chat' : ''; }

  deliver(r: Report, via: string) {
    if (!this.canDeliver()) return;
    // The lab sends WhatsApp from its Cloud API number: "WhatsApp" is the
    // server send to the patient's number (Sending… → Sent → Delivered / Read
    // in the row meta). "whatsapp-mine" is WhatsApp Chat from this computer.
    if (via === "whatsapp" && this.waSend?.canSend(r)) {
      if (r.qrToken || r.type === "final") void this.archiveReportPdf(r);
      void this.waSend.send(r.id).then((m) => { if (m && m.status !== "failed") this.refresh(); });
      return;
    }
    if (via === "whatsapp-mine" || via === "whatsapp") {
      if (this.waSend?.chatAllowed() !== false) void this.sendOnWhatsApp(r);   // archives + uploads the PDF as before; only an explicit "Chat is off" stops it
      return;
    }
    if (via === "print") {
      // Print is its own flow: it may ask letterhead vs plain paper first, and
      // the delivery is recorded only once something was actually printed.
      void this.printReport(r);
      return;
    }
    this.recordDelivery(r, via);
  }

  /** WhatsApp Chat — the manual flow on this computer (every lab):
   *  WhatsApp opens with the patient's chat and the report link ready; the
   *  person presses Send. Recorded as delivered once WhatsApp opened. */
  private async sendOnWhatsApp(r: Report) {
    // The public link must resolve to a real file: archive the PDF now
    // (best-effort, background) so it is there when the patient opens it.
    if (r.qrToken) this.archiveReportPdf(r);
    const out = await this.waManual.send({
      phone: r.order?.patient?.phone,
      patientName: r.order?.patient?.displayName,
      labName: this.auth.user()?.tenantName,
      link: reportPublicLink(environment.reportPublicBaseUrl, r.qrToken),
      reportId: r.id,
      pdf: () => this.storedPdf(r),
      pdfName: `report-${r.id.replace(/-/g, "").slice(-8).toUpperCase()}.pdf`,
    });
    if (out === "opened") this.recordDelivery(r, "whatsapp");
  }

  /** Print a report from the queue. A delivery for deliver_report users; a
   *  plain print (no delivery record, no send) for view-only users.
   *  Letterpad setting on → one quick choice (letterhead paper, header &
   *  footer blank — the default — or plain paper) for THIS job only. */
  async printReport(r: Report) {
    if (!this.canPrint() || this.isRowBusy(r.id, 'print')) return;
    this.setRowBusy(r.id, 'print', true);
    let printed = false;
    try {
      printed = await this.printJob(r);
    } finally {
      this.setRowBusy(r.id, 'print', false);
    }
    if (printed && this.canDeliver()) this.recordDelivery(r, "print");
  }

  /** Render + hand the report to the printer. True when something was
   *  printed (false: letterpad question dismissed, or the render failed). */
  private async printJob(r: Report): Promise<boolean> {
    try {
      const [{ askPrintLetterhead }, { loadReportTemplate }] = await Promise.all([
        import('../../../shared/utils/print-letterhead'),
        import('../../../shared/utils/report-render-input'),
      ]);
      const job = await askPrintLetterhead(await loadReportTemplate(this.api), this.dialog);
      if (!job) return false;   // dismissed — nothing printed, nothing recorded
      // The STORED copy for the paper (full, or the letterhead-paper variant).
      const blob = await this.storedPdf(r, job.blankLetterhead ? 'letterpad' : 'full');
      if (this.isNativePlatform()) {
        // Capacitor WKWebView: hand the PDF to the native share sheet (Print).
        await this.sharePdfNative(r, blob, 'Print report');
      } else {
        // Web: off-screen A4 iframe via the shared helper; a 0-sized frame printed blank.
        printPdfBlobUrl(URL.createObjectURL(blob), { revokeOnDone: true });
      }
      return true;
    } catch (err) {
      console.error("[reports] print failed", err);
      const { reportRenderErrorMessage } = await import("../../../shared/utils/report-render-input");
      this.toasts.error(reportRenderErrorMessage(err, "Could not open print window"));
      return false;
    }
  }

  private recordDelivery(r: Report, via: string) {
    this.api
      .post(`/api/reports/${r.id}/deliver`, {
        via,
        note: via === "whatsapp" ? WA_MANUAL_NOTE : null,
      })
      .subscribe({
        next: () => {
          if (via !== "whatsapp") this.toasts.success(`Delivered via ${via}`);
          this.refresh();
        },
        // WhatsApp already opened on this computer (the real handover), so its
        // delivery record is best-effort; for print/other, the POST *is* the
        // delivery — surface the backend's real reason on failure.
        error: (e) => {
          if (via !== "whatsapp") this.toasts.error(ApiError.from(e).message);
        },
      });
  }

  /** OPS-104: the popup takes whatever the user types (order number, short
   *  #abcd1234 id, invoice number, GUID); the API only takes a GUID, so resolve
   *  it through the order lookup first. Returns a GUID or null — never raw text. */
  async resolveTypedOrder(typed: string): Promise<string | null> {
    const t = String(typed ?? '').trim();
    if (!t) return null;
    const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (GUID.test(t)) return t;
    try {
      const r = await firstValueFrom(this.api.get<{ orderId?: string }>(`/api/orders/resolve?code=${encodeURIComponent(t)}`));
      return r?.orderId && GUID.test(r.orderId) ? r.orderId : null;
    } catch {
      return null;
    }
  }

  async promptGenerate() {
    if (!this.canGenerate()) return;
    const oid = await this.dialog.prompt({
      title: "Generate report",
      message: "Enter the order number (or order ID) to generate a final report.",
      placeholder: "order number",
      required: true,
      confirmLabel: "Generate",
    });
    if (!oid || this.generatingReport()) return;
    const orderId = await this.resolveTypedOrder(oid);
    if (!orderId) {
      this.toasts.error(`No order matches "${String(oid).trim()}"`);
      return;
    }
    this.api
      .post<Report>("/api/reports/generate", { orderId, type: "final" })
      .pipe(busyWhile(this.generatingReport))
      .subscribe({
        next: (r) => {
          this.toasts.success("Report generated");
          this.router.navigate(["/reports/view", r.id]);
        },
        error: (e) => this.toasts.error(ApiError.from(e).message),
      });
  }

  /** OPS-59: rebuild this order's final report from the CURRENT report template
   *  (admin may have changed columns / layout / signatures since it was issued).
   *  The backend re-snapshots and supersedes the previous final (kept, with
   *  its stored PDF, for audit); we then render the NEW report once and store
   *  it, so every view / the QR link serves the new file. */
  async regenerate(r: Report) {
    if (!r.orderId || !this.canGenerate()) return;
    const ok = await this.dialog.confirm({
      title: "Regenerate report?",
      message: "Rebuild this report using the current report template and Test Master. The previous version is replaced (it stays in the audit trail).",
      confirmLabel: "Regenerate",
      tone: "primary",
    });
    if (!ok || this.isRowBusy(r.id, 'regenerate')) return;
    this.setRowBusy(r.id, 'regenerate', true);
    this.api
      .post<Report>("/api/reports/generate", { orderId: r.orderId, type: "final" })
      .subscribe({
        next: async (r2) => {
          try { await this.archiveReportPdf(r2); } catch { /* archive is best-effort */ }
          this.setRowBusy(r.id, 'regenerate', false);
          this.toasts.success("Report regenerated with the latest template");
          this.refresh();
        },
        error: (e) => {
          this.setRowBusy(r.id, 'regenerate', false);
          this.toasts.error(ApiError.from(e).message);
        },
      });
  }
}
