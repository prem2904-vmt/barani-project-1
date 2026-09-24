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
import { formatPatientInfo } from "../../../shared/models/patient.model";
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

type Filter = "all" | "partial" | "pending" | "delivered" | "failed";

interface PrelimRow {
  name: string;
  title: string;
  value: unknown;
  unit?: string;
  range?: string;
  flag: "normal" | "abnormal" | "critical";
}
interface PrelimTest {
  id: string;
  name: string;
  values: PrelimRow[];
}
interface PrelimSample {
  id: string;
  deptName: string;
  deptCode: string;
  tests: PrelimTest[];
}
interface PrelimOrder {
  id: string;
  patientName: string;
  patientMeta: string;
  totalSamples: number;
  validatedSamples: PrelimSample[];
  pendingSampleNames: string[];
}

@Component({
  selector: "pf-report-queue",
  standalone: true,
  imports: [
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
  private readonly api = inject(ApiService);
  /** Design gate: the hero band renders in the NEW design only. */
  readonly theme = inject(ThemeService);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
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
    { value: "all", label: "All", dot: "#a78bfa", count: this.items().length },
    { value: "pending", label: "Completed", dot: "#f59e0b", count: this.counts().pending },
    { value: "partial", label: "Partial", dot: "#38bdf8", count: this.partialOrders().length },
    { value: "delivered", label: "Delivered", dot: "#10b981", count: this.counts().delivered },
    { value: "failed", label: "Failed", dot: "#f43f5e", count: this.counts().failed },
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

  /** Phone-only: which row has its overflow actions open. Seven icons per
   *  row is a wall on a 390px screen, so the three delivery actions stay
   *  out and the rest fold behind a "more" button (owner). One row at a
   *  time — opening another closes the last. Presentational only. */
  private readonly _moreFor = signal<string | null>(null);
  readonly moreFor = this._moreFor.asReadonly();
  toggleMore(id: string) {
    this._moreFor.update((cur) => (cur === id ? null : id));
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
    const sampleIds = po.validatedSamples.map((s) => s.id);
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

  /** Build PrelimOrder rows for any order with ≥1 validated sample.
   *  validate-result already used the same projection — we replicate
   *  it locally so this screen has no dependency on FD landing's
   *  helpers. */
  readonly partialOrders = computed<PrelimOrder[]>(() => {
    const out: PrelimOrder[] = [];
    for (const o of this._todayOrders()) {
      const samples = (o.samples ?? []).filter((s) => s.status !== "rejected");
      if (samples.length === 0) continue;
      const validated: PrelimSample[] = [];
      const pendingNames: string[] = [];
      for (const s of samples) {
        const tests = s.tests ?? [];
        const allDone =
          tests.length > 0 && tests.every((t) => t.status === "validated");
        if (allDone) {
          validated.push({
            id: s.id,
            deptName: s.department?.name ?? "",
            deptCode: s.department?.code ?? "",
            tests: tests.map((t) => ({
              id: t.id,
              name: t.test?.name ?? "Test",
              values: this.extractValues(t),
            })),
          });
        } else {
          pendingNames.push(s.department?.code || s.department?.name || "Tube");
        }
      }
      // Skip orders with no validated samples (nothing to show) and
      // orders with EVERYTHING validated (those go through the regular
      // PDF queue, not here).
      if (validated.length === 0 || validated.length === samples.length)
        continue;
      out.push({
        id: o.id,
        patientName: o.patient ? formatPatientInfo(o.patient) : "Patient",
        patientMeta: `#${o.id.slice(0, 8)} · created ${this.formatTime(o.createdAt)}`,
        totalSamples: samples.length,
        validatedSamples: validated,
        pendingSampleNames: pendingNames,
      });
    }
    return out;
  });

  private extractValues(t: OrderTest): PrelimRow[] {
    if (!t.currentResult || !t.test?.parameters) return [];
    let snap: { values?: Record<string, unknown> };
    try {
      snap = JSON.parse(t.currentResult);
    } catch {
      return [];
    }
    if (!snap.values) return [];
    let params: Array<{
      name: string;
      title: string;
      unit?: string;
      criticalLow?: number;
      criticalHigh?: number;
      referenceRanges?: Array<{ min: number; max: number }>;
    }> = [];
    try {
      const blob = JSON.parse(t.test.parameters) as { parameters?: any[] };
      params = blob.parameters ?? [];
    } catch {
      return [];
    }
    return params.map((p) => {
      const v = snap.values![p.name];
      const n = Number(v);
      const isNum =
        !Number.isNaN(n) && v !== null && v !== undefined && v !== "";
      const r = (p.referenceRanges ?? [])[0];
      let flag: "normal" | "abnormal" | "critical" = "normal";
      if (isNum) {
        if (
          (p.criticalLow != null && n <= p.criticalLow) ||
          (p.criticalHigh != null && n >= p.criticalHigh)
        )
          flag = "critical";
        else if (r && (n < r.min || n > r.max)) flag = "abnormal";
      }
      return {
        name: p.name,
        title: p.title || p.name,
        value: v ?? "—",
        unit: p.unit,
        range: r ? `${r.min}–${r.max}${p.unit ? " " + p.unit : ""}` : undefined,
        flag,
      };
    });
  }

  private formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
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

    const [template] = await Promise.all([
      this.api
        .get<
          import("../../../shared/models/report.model").ReportTemplate | null
        >("/api/config/report-template")
        .toPromise()
        .catch(() => null),
      ...tests.map(async (t) => {
        if (!t.testId) return;
        try {
          resolvedLayouts[t.testId] = await svc.preview(
            t.testId,
            (t.result?.values ?? {}) as Record<string, unknown>,
            (t as { images?: string[] | null }).images ?? [],
            patient,
          );
        } catch {
          /* test without a configured layout — fallback table */
        }
      }),
    ]);

    // Tests ordered through a PROFILE print the PROFILE's notes, not their own,
    // so the profile's layout must be resolved as well. Profiles aren't
    // snapshot rows — only their members are, carrying packageTestId.
    const pkgIds = [
      ...new Set(
        (tests as Array<{ packageTestId?: string | null }>)
          .map((t) => t.packageTestId)
          .filter((id): id is string => !!id),
      ),
    ];
    await Promise.all(
      pkgIds.map(async (id) => {
        if (resolvedLayouts[id]) return;
        try {
          resolvedLayouts[id] = await svc.preview(id, {}, [], patient);
        } catch {
          /* profile without notes — nothing extra prints */
        }
      }),
    );

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
