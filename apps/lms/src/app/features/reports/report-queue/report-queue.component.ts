import { SheetEditorService } from '../../neuron/sheet-editor.service';
import { labDaysAgo, labToday } from '../../../shared/utils/lab-clock';
import { CommonModule, DatePipe } from "@angular/common";
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { firstValueFrom, forkJoin, of } from "rxjs";
import { catchError } from "rxjs/operators";
import { busyWhile } from "../../../shared/utils/busy";
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import { DestroyRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  TemplateRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import type { ColDef, GridReadyEvent, IsFullWidthRowParams, RowClassParams, RowClickedEvent } from "ag-grid-community";
import { DataGridComponent } from "../../../shared/components/data-grid/data-grid.component";
import { DataGridTemplateCellComponent } from "../../../shared/components/data-grid/template-cell.component";
import { ModalPortalDirective } from "../../../shared/directives/modal-portal.directive";
import { mediaSignal, TM_TWO_PANEL_STYLES } from "../../admin/tests/tests/tm-two-panel";
import { plural } from "../../../shared/utils/plural";
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
import { buildPartialOrders, orderLabel, queueStatus, QUEUE_DOT, reportStatus, type PrelimOrder, type PrelimRow, type QueueStatus, type QueueStatusKey, type ReportStatus } from "./report-queue.partial";
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
import { PATIENT_PROFILE_PERMS, ReportActionsService, WA_MANUAL_NOTE, type ChannelContext } from '../../../core/services/report-actions.service';
import { formatAge } from "../../../shared/utils/patient-age";
import { BusyDirective } from "../../../shared/directives/busy.directive";
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';
import { matchesDailyNo } from '../../../shared/utils/daily-no';

type Filter = "all" | "partial" | "pending" | "delivered" | "failed";

/** One row of the Reports grid (new design): a report, a partly-reported order, or the order's inline detail
 *  (a full-width row right under it while it is open). */
export type RqRow =
  | { id: string; kind: "report"; r: Report }
  | { id: string; kind: "partial"; po: PrelimOrder; r?: Report }
  | { id: string; kind: "detail"; po: PrelimOrder; r?: Report };

/** The TO SEND queue reads up to this many pending / failed reports (its own page size, never the list's). */
const TO_SEND_PAGE = 200;

/** Filter → the status dot it carries (All = an empty ring). */
const FILTER_DOT: Record<Filter, QueueStatusKey | "ring"> = {
  all: "ring", pending: "completed", partial: "partial", delivered: "delivered", failed: "failed",
};

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
    BusyDirective,
    DataGridComponent,
    ModalPortalDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./report-queue.component.html",
  styleUrl: "./report-queue.component.scss",
  styles: [TM_TWO_PANEL_STYLES],
})
export class ReportQueueComponent implements OnInit {
  /** "Open in sheet": the sheet editor with Insert results ready for the last 7 days; Back returns to this list. */
  protected readonly sheets = inject(SheetEditorService);
  protected openInSheet(): void {
    void this.sheets.open({ source: 'Reports', insert: { from: labDaysAgo(6), to: labToday() } });
  }

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
    { value: "all", label: "All", count: this.allCount() },
    { value: "pending", label: "Completed", count: this.counts().pending },
    { value: "partial", label: "Partial", count: this.partialOrders().length },
    { value: "delivered", label: "Delivered", count: this.counts().delivered },
  ]);

  /** The main card head's status pill (owner 2026-11-19, "To send" queue): All · Completed · Partial · Delivered,
   *  dot + count. "Failed" is no report status here — a failed WhatsApp is a TO SEND row. */
  readonly pillOptions = computed<SegmentedOption<Filter>[]>(() => this.ndFilters().map((f) => ({
    value: f.value, label: f.label, count: f.count, dot: this.filterDot(f.value) ?? undefined,
  })));

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
    { value: "all", label: "All", dot: "#a78bfa", count: this.allCount(),
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
    for (const r of this._items()) m.set(r.id, this.buildRowActions(r));
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
    // Email (the lab sends it) + SMS Chat (phones / tablets only).
    a.push(...this.reportActions.channelActions(r, this.channelCtx(r)));
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

  /** What this row knows about the recipients (email unknown on the queue unless the server sends it). */
  private channelCtx(r: Report): ChannelContext {
    const p = r.order?.patient as { phone?: string | null; email?: string | null } | null | undefined;
    return { patientPhone: p?.phone ?? r.patient?.phone ?? undefined, patientEmail: p && 'email' in p ? p.email ?? null : undefined };
  }

  runRowAction(r: Report, id: string): void {
    if (this.reportActions.runChannel(id, r as never, { name: this.reportPatientName(r), phone: r.order?.patient?.phone ?? r.patient?.phone }, this.channelCtx(r))) return;
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

  /** Partly-reported orders that have NO report row loaded yet. Reports already
   *  carry their own row (a generated partial is a report); these orders have
   *  tubes validated but nothing generated, so the list never showed them. */
  private readonly partialsWithoutRow = computed<PrelimOrder[]>(() => {
    const have = new Set(this._items().map((r) => (r.orderId ?? "").toLowerCase()));
    return this.partialOrders().filter((po) => !have.has(po.id.toLowerCase()));
  });

  /** OPS-136: the All tab shows these Preliminary orders too (search applies). */
  readonly allTabPartials = computed<PrelimOrder[]>(() => {
    const q = this._query().trim().toLowerCase();
    const l = this.partialsWithoutRow();
    return q ? l.filter((po) => matchesDailyNo(q, po) || po.searchText.includes(q)) : l;
  });

  /** The All pill: every report plus the partly-reported orders without a row. */
  readonly allCount = computed(() => this.counts().all + this.partialsWithoutRow().length);

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

  // ── New design v2 (owner 2026-11-19): Test Master's frame ─────────────────
  // Band = lab + search. LEFT side card STATUS (dots + counts), RIGHT main card = the reports grid (pf-data-grid);
  // a partly-reported order opens an inline detail row. ≤900px: no side card — the status filter is a menu under
  // the filter button inside the search. ≤640px: the grid folds into two-line rows; a tap opens the actions sheet.
  /** ≤900px: no side column (the filter moves into the search). */
  readonly narrow = mediaSignal("(max-width: 900px)", inject(DestroyRef));
  /** ≤640px: rows instead of the grid, a bottom sheet per row. */
  readonly phone = mediaSignal("(max-width: 640px)", inject(DestroyRef));
  /** <1280px: the grid folds Order + Generated into the Patient cell (the actions keep their room). */
  readonly compact = mediaSignal("(max-width: 1279px)", inject(DestroyRef));

  /** Status dot colour for a side-card row / menu row (null = the empty ring for All). */
  filterDot(f: Filter): string | null {
    const k = FILTER_DOT[f];
    return k === "ring" ? null : QUEUE_DOT[k];
  }

  /** The filter button's menu (phones / narrow tablets): dot · label · count · tick on the current one. */
  readonly filterMenu = computed<PfAction[]>(() => this.ndFilters().map((f) => ({
    id: f.value, label: f.label, count: f.count, current: f.value === this._filter(),
    dot: this.filterDot(f.value) ?? "ring",
  })));
  onFilterMenu(id: string): void { this.setFilter(id as Filter); }

  /** The grid's Status pill + the Unpaid line under it. */
  rowStatus(r: Report): QueueStatus {
    return queueStatus(r.deliveryStatus, r.type, this.isUnpaid(r));
  }
  statusDot(k: QueueStatusKey): string { return QUEUE_DOT[k]; }

  /** "30/F · AA0010" (the Patient cell's second line). */
  whoMeta(r: Report): string {
    const p = r.order?.patient;
    return p ? formatPatientMeta(p as never) : "";
  }
  /** The Order cell: the order number, or the short id of a legacy order. */
  orderNo(r: Report): string {
    const o = r.order;
    return o?.orderNumber || (r.orderId ? `#${r.orderId.slice(0, 8).toUpperCase()}` : "—");
  }
  /** The Generated cell ("10:42 AM" today, else "18 Nov, 10:42 AM"). */
  when(iso: string | undefined): string { return this.shortWhen(iso) || "—"; }

  /** The Sent cell: what happened to the report (WhatsApp status, printed / delivered via …, failed note),
   *  plus "Preliminary" when the pill (Delivered / Failed) hides it. */
  sentMeta(r: Report): string {
    const st = this.rowStatus(r);
    const parts: string[] = [];
    const wa = this.waMeta(r);
    if (wa) parts.push(wa);
    else if (r.deliveryStatus === "delivered") parts.push(this.viaWords(r.deliveredVia));
    else if (r.deliveryStatus === "failed") parts.push(r.deliveryNote?.trim() || "Not delivered");
    if (st.prelim && st.key !== "partial") parts.push("Preliminary");
    return parts.filter(Boolean).join(" · ");
  }
  private viaWords(via: string | undefined): string {
    const v = (via ?? "").toLowerCase();
    if (v === "print") return "Printed";
    if (v === "whatsapp") return "WhatsApp";
    if (v === "email") return "Email";
    if (v === "sms") return "SMS";
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : "Delivered";
  }

  /** Phone row second line: "30/F · LAB-… · 10:42" (or what was sent). */
  phoneLine(r: Report): string {
    const p = r.order?.patient;
    const age = p ? formatPatientMeta(p as never).split(" · ")[0] : "";
    return [age, this.orderNo(r), this.sentMeta(r) || this.shortWhen(r.createdAt)].filter(Boolean).join(" · ");
  }
  phoneLinePartial(po: PrelimOrder): string {
    return [po.whoMeta.split(" · ")[0], po.orderNo, po.countLabel].filter(Boolean).join(" · ");
  }

  /** The report already generated for a partly-reported order (a preliminary), if it is loaded. */
  partialReport(po: PrelimOrder): Report | undefined {
    const id = po.id.toLowerCase();
    return this._items().find((r) => (r.orderId ?? "").toLowerCase() === id);
  }

  /** Grid rows for the current tab: Partial = the partly-reported orders; All = those without a report row first,
   *  then every report; the other tabs = their reports. An open order is followed by its detail row. */
  readonly gridRows = computed<RqRow[]>(() => {
    const f = this._filter();
    const open = this._expanded();
    const out: RqRow[] = [];
    const addPartial = (po: PrelimOrder) => {
      const r = this.partialReport(po);
      out.push({ id: `p:${po.id}`, kind: "partial", po, r });
      if (open === po.id) out.push({ id: `d:${po.id}`, kind: "detail", po, r });
    };
    if (f === "partial") { this.visiblePartials().forEach(addPartial); return out; }
    if (f === "all") this.allTabPartials().forEach(addPartial);
    for (const r of this.visible()) out.push({ id: `r:${r.id}`, kind: "report", r });
    return out;
  });

  /** How many rows the head counts ("18 reports", "50 of 120 reports"). */
  readonly headCount = computed(() => {
    if (this._filter() === "partial") return plural(this.visiblePartials().length, "order");
    const shown = this.gridRows().filter((x) => x.kind !== "detail").length;
    const total = this._total();
    const extra = this._filter() === "all" ? this.allTabPartials().length : 0;
    if (total != null && this.hasMorePages()) return `${shown} of ${total + extra} reports`;
    return plural(shown, "report");
  });

  private readonly noTpl = viewChild<TemplateRef<unknown>>("cNo");
  private readonly patientTpl = viewChild<TemplateRef<unknown>>("cPatient");
  private readonly orderTpl = viewChild<TemplateRef<unknown>>("cOrder");
  private readonly statusTpl = viewChild<TemplateRef<unknown>>("cStatus");
  private readonly genTpl = viewChild<TemplateRef<unknown>>("cGen");
  private readonly sentTpl = viewChild<TemplateRef<unknown>>("cSent");
  private readonly actsTpl = viewChild<TemplateRef<unknown>>("cActs");
  private readonly detailTpl = viewChild<TemplateRef<unknown>>("cDetail");

  readonly rqDefaultColDef: ColDef<RqRow> = { sortable: false, resizable: false, filter: false, wrapText: true, autoHeight: true, suppressMovable: true };
  readonly colDefs = computed<ColDef<RqRow>[]>(() => {
    const cell = (tpl: TemplateRef<unknown> | undefined) => ({ cellRenderer: DataGridTemplateCellComponent, cellRendererParams: { tpl } });
    const touch = !this.web();
    const narrow = this.narrow();
    // Below 1280px (tablet landscape, a narrow window) Order + Generated fold into the Patient cell's meta line.
    const compact = this.compact();
    return [
      // # = the full daily-number chip ("21 · 15 Nov" on an older order) — never clipped.
      { colId: "no", headerName: "#", width: 94, minWidth: 94, cellClass: "pf-rq2-nowrap", ...cell(this.noTpl()) },
      { colId: "patient", headerName: "Patient", flex: 1, minWidth: 140, ...cell(this.patientTpl()) },
      // Order + Generated stay on ONE line; the Patient column takes the slack.
      { colId: "order", headerName: "Order", width: 130, minWidth: 130, hide: compact, wrapText: false, cellClass: "pf-rq2-nowrap", ...cell(this.orderTpl()) },
      { colId: "status", headerName: "Status", width: 120, minWidth: 116, ...cell(this.statusTpl()) },
      { colId: "generated", headerName: "Generated", width: 128, minWidth: 128, hide: compact, wrapText: false, cellClass: "pf-rq2-nowrap", ...cell(this.genTpl()) },
      { colId: "sent", headerName: "Sent", flex: 1, minWidth: 96, ...cell(this.sentTpl()) },
      // View · Download · Share ▾ · ⋯ — text on web, 44px icons on touch (+ Details on a partly-reported order).
      { colId: "actions", headerName: "Actions", width: touch ? 256 : 290, minWidth: touch ? 256 : 290,
        headerClass: "ag-right-aligned-header", cellClass: "pf-rq2-actcell", ...cell(this.actsTpl()) },
    ];
  });
  readonly rqRowId = (p: { data: RqRow }) => p.data.id;
  readonly rqFullWidth = (p: IsFullWidthRowParams<RqRow>) => p.rowNode.data?.kind === "detail";
  readonly rqFullWidthRenderer = DataGridTemplateCellComponent;
  readonly rqFullWidthParams = computed(() => ({ tpl: this.detailTpl(), measure: true }));
  readonly rqRowClass = (p: RowClassParams<RqRow>) => {
    const d = p.data;
    if (!d) return undefined;
    if (d.kind === "detail") return "pf-rq2-detailrow";
    if (this.picked() === d.id) return d.kind === "partial" ? "pf-rq2-row pf-rq2-row--partial pf-rq2-row--picked" : "pf-rq2-row pf-rq2-row--picked";
    if (d.kind === "partial") return this._expanded() === d.po.id ? "pf-rq2-row pf-rq2-row--partial is-open" : "pf-rq2-row pf-rq2-row--partial";
    return "pf-rq2-row";
  };
  /** A partly-reported order's row opens / closes its detail (a click on a button inside the row does its own thing). */
  onGridRowClicked(e: RowClickedEvent<RqRow>): void {
    const t = e.event?.target as HTMLElement | null;
    if (t?.closest?.("button, a, [role=menu]")) return;
    const d = e.data;
    if (d?.kind === "partial") this.toggle(d.po.id);
  }

  /** Paging without a button at the bottom (owner: nothing clickable at the bottom): the next page loads as the
   *  grid nears its end. */
  onGridReady(e: GridReadyEvent<RqRow>): void {
    this._gridApi = e.api;
    const near = () => {
      const n = e.api.getDisplayedRowCount();
      if (n && e.api.getLastDisplayedRowIndex() >= n - 6) this.loadMore();
    };
    e.api.addEventListener("bodyScroll", near);
    e.api.addEventListener("viewportChanged", near);
  }

  // ── Phone: the actions sheet ────────────────────────────────────────────────
  private readonly _sheet = signal<RqRow | null>(null);
  readonly sheet = this._sheet.asReadonly();
  openSheet(row: RqRow): void { this.reportOf(row) && this.onRowMenuOpened(this.reportOf(row)!); this._sheet.set(row); }
  closeSheet(): void { this._sheet.set(null); }
  reportOf(row: RqRow | null): Report | undefined { return row ? (row.kind === "report" ? row.r : row.r) : undefined; }
  /** The sheet's ONE primary: WhatsApp (Auto or Chat — waMode), else Print; none for a view-only desk. */
  sheetPrimary(r: Report): { label: string; via: "whatsapp" | "print" } | null {
    if (!this.canDeliver()) return null;
    return this.waMode(r) ? { label: "Share on WhatsApp", via: "whatsapp" } : { label: "Print", via: "print" };
  }
  /** The rest of the ⋯ actions, under the primary and View · Download · Print (no duplicates). */
  sheetMore(r: Report): PfAction[] {
    const shown = new Set(["view", "download", "print", "whatsapp", "whatsapp-mine"]);
    return this.actionsFor(r).filter((a) => !shown.has(a.id));
  }
  /** The sheet's Print tile: the view-only print, or the desk's print when WhatsApp is the primary. */
  sheetShowsPrint(r: Report): boolean {
    if (!this.canPrint()) return false;
    const p = this.sheetPrimary(r);
    return !p || p.via !== "print";
  }
  sheetRun(r: Report, id: string): void { this.closeSheet(); this.runRowAction(r, id); }
  sheetDeliver(r: Report, via: string): void { this.closeSheet(); this.deliver(r, via); }

  /** The ⋯ rows for a report (built for every loaded report). */
  actionsFor(r: Report): PfAction[] { return this.rowActions().get(r.id) ?? this.buildRowActions(r); }

  /** Phones: the next page loads when the end of the list comes into view. */
  private readonly listEnd = viewChild<ElementRef<HTMLElement>>("listEnd");
  private _io: IntersectionObserver | null = null;
  private readonly _ioWatch = effect(() => {
    const el = this.listEnd()?.nativeElement;
    this._io?.disconnect();
    this._io = null;
    if (!el || typeof IntersectionObserver === "undefined") return;
    this._io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) this.loadMore(); });
    this._io.observe(el);
  });


  // ── TO SEND (owner 2026-11-19, option A): the reports the desk still has to hand over ─────────────────────────────
  // From EXISTING delivery data only: the pending + failed queue pages, their WhatsApp message status (one batch call)
  // and each patient's "Don't send WhatsApp" opt-out (the per-report WhatsApp status). Sends go through the SAME flows
  // as the row's Share: WhatsApp Auto (`WhatsAppSendService.send`) or WhatsApp Chat (`deliver(r, 'whatsapp-mine')`).
  private readonly _toSendRows = signal<Report[]>([]);
  private readonly _toSendWa = signal<Record<string, WaMessage>>({});
  /** reportId → the patient opted out of WhatsApp (absent = not known yet). */
  private readonly _optOut = signal<Record<string, boolean>>({});
  /** Rows with a send in flight (this screen's guard; the service also refuses a second send). */
  private readonly _inFlight = signal<ReadonlySet<string>>(new Set());
  /** What happened to a row this session ("sent" / "failed"), shown on the row until the queue reloads. */
  private readonly _sendResult = signal<Record<string, "sent" | "failed">>({});
  readonly sendingAll = signal(false);
  /** The report picked from the queue — highlighted in the grid. */
  readonly picked = signal<string | null>(null);
  /** Phones / narrow: the queue is a sheet opened from the "To send" chip in the search. */
  readonly toSendOpen = signal(false);

  private loadToSend(): void {
    if (!this.canDeliver()) { this._toSendRows.set([]); return; }
    const page = (status: string) => this.api.get<Report[] | ReportQueuePage<Report> | null>(
      reportQueuePageUrl({ page: 1, pageSize: TO_SEND_PAGE, status })).pipe(catchError(() => of(null)));
    forkJoin([page("pending"), page("failed")]).subscribe(([p, f]) => {
      const rows = (res: Report[] | ReportQueuePage<Report> | null, st: string) =>
        (!res ? [] : Array.isArray(res) ? res : res.items ?? []).filter((r) => r.deliveryStatus === st);
      const all = [...rows(p, "pending"), ...rows(f, "failed")];
      this._toSendRows.set(all);
      const finals = all.filter((r) => r.type === "final").map((r) => r.id);
      if (finals.length) {
        this.wa.statusBatch(finals).subscribe({
          next: (m) => this._toSendWa.set(m && typeof m === "object" ? m : {}),
          error: () => { /* no WhatsApp column: the queue still lists the pending reports */ },
        });
      }
      void this.ensureOptOut(all.map((r) => r.id));
    });
  }

  /** Read each report's WhatsApp status once for the patient's opt-out (cached per report). */
  private async ensureOptOut(ids: string[]): Promise<void> {
    const known = this._optOut();
    const todo = ids.filter((id) => !(id in known)).slice(0, 100);
    await Promise.all(todo.map(async (id) => {
      try {
        const st = await firstValueFrom(this.wa.reportStatus(id));
        this._optOut.update((m) => ({ ...m, [id]: st?.patientOptOut === true }));
      } catch { /* unknown: the send flow itself still checks */ }
    }));
  }

  /** One TO SEND row. */
  private toSendRow(r: Report, reason: string | null) {
    const live = this.waSend?.state(r.id);
    const inFlight = this._inFlight().has(r.id) || live?.phase === "sending";
    const result = this._sendResult()[r.id] ?? (live && live.phase !== "sending" ? (live.phase === "failed" ? "failed" : "sent") : null);
    return {
      r, id: r.id, name: this.reportPatientName(r), order: this.orderNo(r), reason,
      optOut: this._optOut()[r.id] === true, mode: this.waMode(r), auto: this.waAuto(r),
      sending: inFlight, result,
    };
  }

  /** The queue's groups: WhatsApp failed (Retry) · Not sent yet (Send) · Partial, waiting on results (no action). */
  readonly toSend = computed(() => {
    const wa = this._toSendWa();
    const failed: ReturnType<ReportQueueComponent["toSendRow"]>[] = [];
    const notSent: ReturnType<ReportQueueComponent["toSendRow"]>[] = [];
    for (const r of this._toSendRows()) {
      if (r.type !== "final") continue;   // a preliminary is never sent from here (the partial group names it)
      const m = wa[r.id];
      if (r.deliveryStatus === "failed" || m?.status === "failed") {
        failed.push(this.toSendRow(r, m?.errorReason?.trim() || r.deliveryNote?.trim() || "WhatsApp failed"));
      } else if (r.deliveryStatus === "pending" && !(m && ["sent", "delivered", "read", "queued", "sending"].includes(m.status))) {
        notSent.push(this.toSendRow(r, m?.status === "held" ? "Sends by itself once the bill is paid" : null));
      }
    }
    const partial = this.partialOrders();
    return { failed, notSent, partial, total: failed.length + notSent.length + partial.length };
  });

  /** What "Send all" sends: WhatsApp Auto rows not opted out, not sent this session, not in flight. */
  readonly sendAllRows = computed(() => [...this.toSend().failed, ...this.toSend().notSent]
    .filter((x) => x.auto && !x.optOut && !x.sending && x.result !== "sent"));

  /** Retry / Send one report — the row's existing flow, guarded against double sends. */
  async sendOne(r: Report): Promise<void> {
    if (!this.canDeliver() || this._inFlight().has(r.id) || this.waSend.busy(r.id) || this._optOut()[r.id] === true) return;
    if (!this.waSend.canSend(r)) {
      // WhatsApp Chat on this computer: the person presses Send (opens WhatsApp; its own opt-out question).
      if (this.waMode(r) === "chat") this.deliver(r, "whatsapp-mine");
      return;
    }
    this.markInFlight(r.id, true);
    try {
      if (r.qrToken || r.type === "final") void this.archiveReportPdf(r);
      const m = await this.waSend.send(r.id);
      this._sendResult.update((x) => ({ ...x, [r.id]: m && m.status !== "failed" ? "sent" : "failed" }));
    } finally {
      this.markInFlight(r.id, false);
    }
  }

  private markInFlight(id: string, on: boolean): void {
    const next = new Set(this._inFlight());
    if (on) next.add(id); else next.delete(id);
    this._inFlight.set(next);
  }

  /** Send every WhatsApp Auto report in the queue — always asks first (count + who is skipped). */
  async sendAll(): Promise<void> {
    if (this.sendingAll() || !this.canDeliver()) return;
    this.sendingAll.set(true);
    try {
      const queue = [...this.toSend().failed, ...this.toSend().notSent];
      await this.ensureOptOut(queue.map((x) => x.id));
      const fresh = [...this.toSend().failed, ...this.toSend().notSent];
      const go = fresh.filter((x) => x.auto && !x.optOut && !x.sending && x.result !== "sent");
      if (!go.length) { this.toasts.info("Nothing to send with WhatsApp Auto."); return; }
      const optedOut = fresh.filter((x) => x.optOut).length;
      const chatOnly = fresh.filter((x) => !x.optOut && !x.auto && x.result !== "sent").length;
      const skipped = [
        optedOut ? `${plural(optedOut, "patient")} opted out of WhatsApp` : "",
        chatOnly ? `${plural(chatOnly, "report")} can only go by WhatsApp Chat (send each one)` : "",
      ].filter(Boolean);
      const ok = await this.dialog.confirm({
        title: `Send ${plural(go.length, "report")} on WhatsApp?`,
        message: skipped.length ? `Skipped: ${skipped.join("; ")}.` : "Each patient gets their report link from the lab's WhatsApp number.",
        confirmLabel: "Send",
        tone: "primary",
      });
      if (!ok) return;
      for (const x of go) {
        // Re-check right before each send: another tab / a live update may have sent it meanwhile.
        if (this._inFlight().has(x.id) || this.waSend.busy(x.id) || this._sendResult()[x.id] === "sent") continue;
        await this.sendOne(x.r);
      }
      this.refresh();
    } finally {
      this.sendingAll.set(false);
    }
  }

  /** A queue row picked: show + highlight that report in the grid (All when the tab hides it). */
  pickFromQueue(id: string, isOrder = false): void {
    this.toSendOpen.set(false);
    const rowId = isOrder ? `p:${id}` : `r:${id}`;
    this.picked.set(rowId);
    if (!this.gridRows().some((x) => x.id === rowId) && this._filter() !== "all") this.setFilter("all");
    setTimeout(() => {
      const api = this._gridApi;
      const node = api?.getRowNode(rowId);
      if (api && node) { api.ensureNodeVisible(node, "middle"); api.redrawRows(); }
    }, 60);
  }
  private _gridApi: GridReadyEvent<RqRow>["api"] | null = null;

  ngOnInit() {
    this.waSend.ensure();
    this.reportActions.warmChannels();
    // Live: a validation elsewhere can complete an order → its report appears.
    this.liveQ.on('reports', 'validation').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.destroyRef.onDestroy(() => { clearTimeout(this._searchTimer); this._io?.disconnect(); });
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
    this.loadToSend();
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
    // The referral doctor's copy is not the patient's hand-over: no delivery record.
    if (out === "opened" && this.waManual.lastRecipient !== "doctor") this.recordDelivery(r, "whatsapp");
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
