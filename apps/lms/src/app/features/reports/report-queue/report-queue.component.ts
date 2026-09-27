import { CommonModule, DatePipe } from "@angular/common";
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { firstValueFrom } from "rxjs";
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
import { waLink } from "../../../shared/utils/whatsapp";
import { EditResultDialogComponent } from "../../../shared/components/edit-result-dialog/edit-result-dialog.component";
import { savedValueRows } from "../../../shared/utils/result-flag";
import { ZoomSourceDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';

type Filter = "all" | "partial" | "pending" | "delivered" | "failed";

@Component({
  selector: "pf-report-queue",
  standalone: true,
  imports: [
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
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./report-queue.component.html",
  styleUrl: "./report-queue.component.scss"
})
export class ReportQueueComponent implements OnInit {
  formatReportPatient(p: any): string {
    return formatPatientInfo(p);
  }

  // ── New design (docs/ND-PATTERN.md → "Reports list") ─────────────
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
    return [p ? formatPatientMeta(p as never) : "", o?.id ? orderLabel(o) : "", when, ...this.cardStatus(r).extra]
      .filter(Boolean).join(" · ");
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
    { value: "all", label: "All", count: this.items().length },
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
    { value: "all", label: "All", dot: "#a78bfa", count: this.items().length,
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
  readonly editOrderId = signal<string | null>(null);

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
    this._filter.set(f);
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
    this._query.set(q);
  }
  asInput(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  private readonly _items = signal<Report[]>([]);
  readonly items = this._items.asReadonly();

  private readonly _loading = signal(false);
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

  readonly counts = computed(() => {
    const l = this._items();
    return {
      pending: l.filter((r) => r.deliveryStatus === "pending").length,
      delivered: l.filter((r) => r.deliveryStatus === "delivered").length,
      failed: l.filter((r) => r.deliveryStatus === "failed").length,
    };
  });

  readonly visible = computed(() => {
    const f = this._filter();
    const q = this._query().trim().toLowerCase();
    let l = this._items();
    if (f !== "all") l = l.filter((r) => r.deliveryStatus === f);
    if (q) {
      l = l.filter((r) => {
        const name = (r.order?.patient?.displayName ?? "").toLowerCase();
        const phone = (r.order?.patient?.phone ?? "").toLowerCase();
        const mrn = (r.order?.patient?.mrn ?? "").toLowerCase();
        // Match against patient name, phone, MRN, short order id, and
        // short report id — covers every reasonable lookup reception
        // runs from a paper slip.
        return (
          name.includes(q) ||
          phone.includes(q) ||
          mrn.includes(q) ||
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
    p: { sex?: string | null; age?: number | null } | null | undefined,
  ): string {
    if (!p) return "";
    const parts: string[] = [];
    const sex = this.formatSex(p.sex);
    if (sex) parts.push(sex);
    if (p.age != null && Number.isFinite(p.age) && p.age >= 0)
      parts.push(`${p.age}y`);
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
  // Loaded from /api/orders/today and filtered to orders with at
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

  generatePartial(po: PrelimOrder) {
    if (this._generating()) return;
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
    return q ? l.filter((po) => po.searchText.includes(q)) : l;
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
    // Live: a validation elsewhere can complete an order → its report appears.
    this.liveQ.on('reports', 'validation').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
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
    this._loading.set(true);
    this.api.get<Report[]>("/api/reports/queue").subscribe({
      next: (l) => {
        this._items.set(l ?? []);
        this._loading.set(false);
      },
      error: () => this._loading.set(false),
    });
    // Independent fetch — partial reports come from /api/orders/today
    // (the report queue endpoint only knows about generated PDFs). A
    // failure here doesn't block the main queue load.
    this.api.get<Order[]>("/api/orders/today").subscribe({
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

  /** Download the report as a PDF (client-side render via jsPDF). Pulls
   *  the per-test resolved layouts so the PDF matches the on-screen viewer
   *  exactly (column widths, row colors + bold from conditions, merged
   *  rows, paragraphs, charts). */
  async downloadPdf(r: Report) {
    try {
      const { generateReportPdf, buildReportPdf } = await import('../../../shared/utils/report-pdf');
      const { baseInput, imageCache, trendograms } = await this.buildReportRender(r);
      const blob = buildReportPdf({ ...baseInput, imageCache, trendograms }).output('blob');
      if (this.isNativePlatform()) {
        // Capacitor WKWebView: web blob downloads are no-ops. Hand the PDF to
        // the native iOS share sheet (Save to Files, AirDrop, etc.) via the
        // Web Share API — no Capacitor plugin needed.
        await this.sharePdfNative(r, blob, "Download report");
      } else {
        // Web/desktop: jsPDF's own download path still works.
        generateReportPdf({ ...baseInput, imageCache, trendograms });
      }
      // Archive the rendered PDF to object storage (Spaces) so finished results
      // are stored and the patient's public report / QR-tracking page can serve
      // the exact file. Best-effort — never affects the download.
      this.uploadReportPdf(r, blob);
    } catch (err) {
      console.error("[reports] download failed", err);
      this.toasts.error("Could not download report");
    }
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
        const { generateReportPdf } = await import('../../../shared/utils/report-pdf');
        const { baseInput, imageCache, trendograms } = await this.buildReportRender(r);
        generateReportPdf({ ...baseInput, imageCache, trendograms });
      }
    } catch (err) {
      // User cancelled the share sheet — not an error.
      if ((err as { name?: string })?.name === "AbortError") return;
      throw err;
    }
  }

  /** Resolve the tenant template + per-test layouts + images needed to render a
   *  report PDF from its stored snapshot. Shared by download and archive.
   *  The template carries the admin-tunable chrome (colours, logo, signatures);
   *  without it the PDF falls back to the hardcoded Drlogy defaults. */
  private async buildReportRender(r: Report) {
    const [
      { preloadReportImages },
      { ReportLayoutService },
      { PlatformService },
    ] = await Promise.all([
      import("../../../shared/utils/report-pdf"),
      import("../../../core/services/report-layout.service"),
      import("../../../core/services/platform.service"),
    ]);
    const svc = this.injector.get(ReportLayoutService);
    const platform = this.injector.get(PlatformService);
    const resolvedLayouts: Record<
      string,
      import("../../../shared/models/report-layout.model").ResolvedReportLayout
    > = {};

    let tests: Array<{
      testId?: string;
      result?: { values?: Record<string, unknown> };
    }> = [];
    let patient: { sex?: string | null; age?: number | null } | undefined;
    try {
      const snap = JSON.parse(r.data ?? "{}");
      tests = snap?.tests ?? [];
      patient = {
        sex: snap?.patient?.sex ?? null,
        age: snap?.patient?.age ?? null,
      };
    } catch {
      /* malformed snapshot — render PDF without layouts */
    }

    // ONE resolver for every report entry point: posts SCALAR values (so
    // "show when the result is above 70" conditions match), the snapshot's
    // images, and the PROFILE layouts whose notes print for ordered profiles.
    const { resolveReportLayouts } = await import("../../../shared/utils/report-layouts");
    const [template, layouts] = await Promise.all([
      this.api
        .get<
          import("../../../shared/models/report.model").ReportTemplate | null
        >("/api/config/report-template")
        .toPromise()
        .catch(() => null),
      resolveReportLayouts<import("../../../shared/models/report-layout.model").ResolvedReportLayout>(
        (id, values, images, p) => svc.preview(id, values, images as never, p),
        tests,
        patient,
      ),
    ]);
    Object.assign(resolvedLayouts, layouts);

    const baseInput = { report: r, resolvedLayouts, template: template ?? null };
    const [imageCache, trendograms] = await Promise.all([
      preloadReportImages(baseInput, platform.getApiUrl()),
      (await import('../../../shared/utils/trendogram-report')).prepareTrendograms(r, this.api),
    ]);
    return { baseInput, imageCache, trendograms };
  }

  /** Upload a rendered report PDF blob to storage (best-effort). */
  private uploadReportPdf(r: Report, blob: Blob) {
    try {
      const fd = new FormData();
      fd.append("file", blob, `${r.id}.pdf`);
      this.api
        .post(`/api/reports/${r.id}/pdf`, fd)
        .subscribe({ next: () => {}, error: () => {} });
    } catch {
      /* archive is best-effort */
    }
  }

  /** Render + archive the report PDF (no local download) so the public
   *  /reports/public/{qrToken} link resolves to a real file when shared. */
  private async archiveReportPdf(r: Report) {
    try {
      const { buildReportPdf } = await import('../../../shared/utils/report-pdf');
      const { baseInput, imageCache, trendograms } = await this.buildReportRender(r);
      this.uploadReportPdf(r, buildReportPdf({ ...baseInput, imageCache, trendograms }).output('blob'));
    } catch { /* best-effort */ }
  }

  deliver(r: Report, via: string) {
    // WhatsApp: the Meta API isn't wired up yet, so open WhatsApp Web / app
    // (wa.me) pre-filled with the patient's number + a message carrying the
    // report's QR verify link. wa.me can't auto-attach the PDF, so the link
    // stands in for it. Then record the delivery best-effort.
    if (via === "whatsapp") {
      // Ensure the public link resolves to a real file: render + archive the
      // PDF now (best-effort, in the background) so /reports/public/{qrToken}
      // can serve it by the time the patient opens the message. Fire before the
      // synchronous window.open so the popup isn't blocked.
      if (r.qrToken) this.archiveReportPdf(r);
      const lab = this.auth.user()?.tenantName || "our lab";
      const name = r.order?.patient?.displayName ?? "";
      const link = r.qrToken
        ? `${environment.reportPublicBaseUrl}/reports/public/${r.qrToken}`
        : "";
      const lines = [
        name ? `Hi ${name},` : "Hi,",
        `Your lab report from ${lab} is ready.`,
      ];
      if (link) lines.push(`View & download your report:\n${link}`);
      lines.push("Please contact us if you have any questions.");
      window.open(
        waLink(r.order?.patient?.phone, lines.join("\n\n")),
        "_blank",
        "noopener",
      );
    }
    if (via === "print") {
      if (this.isNativePlatform()) {
        // Capacitor WKWebView: render PDF and hand it to native share sheet
        (async () => {
          try {
            const { buildReportPdf } = await import('../../../shared/utils/report-pdf');
            const { baseInput, imageCache, trendograms } = await this.buildReportRender(r);
            await this.sharePdfNative(r, buildReportPdf({ ...baseInput, imageCache, trendograms }).output('blob'), 'Print report');
          } catch (err) {
            console.error("[reports] native print share failed", err);
            this.toasts.error("Could not open report");
          }
        })();
      } else {
        // Web: render PDF and open browser print window
        (async () => {
          try {
            const { buildReportPdf } = await import('../../../shared/utils/report-pdf');
            const { baseInput, imageCache, trendograms } = await this.buildReportRender(r);
            const doc = buildReportPdf({ ...baseInput, imageCache, trendograms });
            doc.autoPrint();
            const blob = doc.output('blob');
            // Off-screen A4 iframe via the shared helper; a 0-sized frame printed blank.
            printPdfBlobUrl(URL.createObjectURL(blob), { revokeOnDone: true });
          } catch (err) {
            console.error("[reports] print failed", err);
            this.toasts.error("Could not open print window");
          }
        })();
      }
    }
    this.api
      .post(`/api/reports/${r.id}/deliver`, {
        via,
        note: via === "whatsapp" ? "wa.me link" : null,
      })
      .subscribe({
        next: () => {
          if (via !== "whatsapp") this.toasts.success(`Delivered via ${via}`);
          this.refresh();
        },
        // WhatsApp already opened the wa.me window (the real handover), so its
        // delivery record is best-effort; for print/other, the POST *is* the
        // delivery — surface the backend's real reason on failure.
        error: (e) => {
          if (via !== "whatsapp") this.toasts.error(ApiError.from(e).message);
        },
      });
  }

  async promptGenerate() {
    const oid = await this.dialog.prompt({
      title: "Generate report",
      message: "Enter the order ID to generate a final report.",
      placeholder: "order id",
      required: true,
      confirmLabel: "Generate",
    });
    if (!oid) return;
    this.api
      .post<Report>("/api/reports/generate", { orderId: oid, type: "final" })
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
   *  The backend re-snapshots and supersedes the previous final; we then
   *  re-render and re-archive the PDF so the stored/QR copy matches too. */
  async regenerate(r: Report) {
    if (!r.orderId) return;
    const ok = await this.dialog.confirm({
      title: "Regenerate report?",
      message: "Rebuild this report using the current report template. The previous version is replaced.",
      confirmLabel: "Regenerate",
      tone: "primary",
    });
    if (!ok) return;
    this.api
      .post<Report>("/api/reports/generate", { orderId: r.orderId, type: "final" })
      .subscribe({
        next: async (r2) => {
          try { await this.archiveReportPdf(r2); } catch { /* archive is best-effort */ }
          this.toasts.success("Report regenerated with the latest template");
          this.refresh();
        },
        error: (e) => this.toasts.error(ApiError.from(e).message),
      });
  }
}
