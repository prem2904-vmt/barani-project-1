import { DatePipe } from "@angular/common";
import { ThemeService } from '../../../core/services/theme.service';
import { DestroyRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  output,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ApiService } from "../../../core/services/api.service";
import { LiveQueueService } from "../../../core/services/live-queue.service";
import { ScanService } from "../../../core/services/scan.service";
import { AuthService } from "../../../core/auth/auth.service";
import { DialogService } from "../../../core/services/dialog.service";
import { ToastService } from "../../../core/services/toast.service";
import { ProcessWorkflowService } from "../../../core/services/process-workflow.service";
import {
  Order,
  OrderSample,
  logicalTestCount,
} from "../../../shared/models/order.model";
import { ApiError } from "../../../shared/models/api-response.model";
import {
  formatPatientInfo,
  patientDisplayName,
} from "../../../shared/models/patient.model";
import { BarcodeScannerModalComponent } from "../../../shared/components/barcode-scanner/barcode-scanner-modal.component";
import { AvatarComponent } from "../../../shared/primitives/avatar.component";
import { HeroBandComponent } from "../../../shared/components/hero-band/hero-band.component";
import { ScreenHeaderComponent } from "../../../shared/primitives/screen-header.component";
import { TouchButtonComponent } from "../../../shared/primitives/touch-button.component";
import { KpiStripComponent } from "../../../shared/components/kpi-strip/kpi-strip.component";
import {
  LabelCardComponent,
  tubeSpec,
  labelTubeLine,
} from "../../frontdesk/post-payment/label-card.component";
import { tubeChosenSpecimen, tubeSpecimen } from "../../../shared/utils/micro-specimen";
import { PrinterService } from "../../../core/printer/printer.service";
import { PrintConfigService } from "../../../core/printer/print-config.service";
import { BranchLabConfigService } from "../../../core/services/branch-lab-config.service";
import { printTubeLabels } from "../../../shared/utils/print-label";
import {
  SeriesState,
  countdownLabel,
  dueClockLabel,
  offsetLabel,
  seriesState,
  sortForCollection,
} from "../../../shared/utils/series-schedule";
import { countCollected, isOrderDispatched } from "./dispatch-state";
import {
  isDrawn,
  isNotCollected,
  notCollectedLabel,
} from "../../../shared/utils/sample-not-collected";
import { ScanIconComponent } from '../../../shared/components/icons/scan-icon.component';
import { ZoomSourceDirective, ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { tubeDepartmentCodes, tubeDepartmentLabel } from '../../../shared/utils/shared-tube';
import { SkeletonDetailComponent } from '../../../shared/primitives/skeleton-kit.component';

/**
 * What the phlebotomist actually holds. "Kind" drives which illustration we
 * render (blood vacutainer vs. urine cup vs. generic jar); "color" is the
 * cap/container colour so labelling matches what's on the rack; "fill" is the
 * liquid colour used when the sample's drawn.
 */
type ContainerKind = "vacutainer" | "urine_cup" | "jar" | "bottle";
interface Container {
  kind: ContainerKind;
  color: string; // cap / container accent
  fill: string; // liquid fill when collected
  label: string;
}

// Tube colour conventions for blood vacutainers, keyed by department code.
// Keyed by DEPARTMENT CODE. HEM / MIC are the codes going forward (owner
// 2026-09-26: department codes follow the test codes); HAE / HAEM / MICRO stay
// for departments that still carry the old codes.
export const DEPT_VACUTAINER: Record<string, { color: string; label: string }> = {
  HAEM: { color: "#a855f7", label: "EDTA · Lavender" },
  HAE: { color: "#a855f7", label: "EDTA · Lavender" },
  HEM: { color: "#a855f7", label: "EDTA · Lavender" },
  BIO: { color: "#eab308", label: "SST · Gold" },
  SERO: { color: "#ef4444", label: "Plain · Red" },
  MICRO: { color: "#e5e7eb", label: "Sterile container" },
  MIC: { color: "#e5e7eb", label: "Sterile container" },
  HISTO: { color: "#64748b", label: "Formalin tube" },
};
const BLOOD_FILL = "#b91c1c";
const URINE_FILL = "#f59e0b";

/**
 * Picks the container for a sample. Priority: explicit sampleType on the
 * first test (authoritative — "Urine", "Blood - EDTA", …), then fall back to
 * the sample's department code for colour.
 */
// The four vacutainer tube colours a vial can be grouped by (space, colour).
const TUBE_COLOR_MAP: Record<string, { color: string; label: string }> = {
  // NABL / standard vacutainer cap colours.
  sst: { color: "#eab308", label: "SST · Gold" },
  plain: { color: "#ef4444", label: "Plain · Red" },
  edta: { color: "#a855f7", label: "EDTA · Lavender" },
  fluoride: { color: "#9ca3af", label: "Fluoride · Grey" },
  heparin: { color: "#22c55e", label: "Lithium Heparin · Green" },
  citrate: { color: "#38bdf8", label: "Sodium Citrate · Blue" },
  esr: { color: "#1f2937", label: "ESR · Black" },
  trace: { color: "#1d4ed8", label: "Trace metal · Royal blue" },
  sterile: { color: "#e5e7eb", label: "Sterile Container" },
  urine: { color: "#facc15", label: "Urine Bottle" },
  // Microbiology blood-culture bottle — drawn as a bottle (neck + crimped
  // flip-cap), filling with blood like the vacutainer (shared/utils/tube-colors).
  blood_culture: { color: "#0f766e", label: "Blood culture bottle" },
  multiple: { color: "#6366f1", label: "Multiple" },
  // Legacy keys (pre-NABL) so older tests still render a colour.
  red: { color: "#ef4444", label: "Plain · Red" },
  lavender: { color: "#a855f7", label: "EDTA · Lavender" },
  grey: { color: "#9ca3af", label: "Fluoride · Grey" },
  blue: { color: "#38bdf8", label: "Sodium Citrate · Blue" },
};

/** Map ONE specimen/sampleType token to its NABL vacutainer container, or null
 *  when it doesn't match a known specimen (the caller then tries the next A/B
 *  option, and finally the department default). Ordered specific → general so
 *  "EDTA Plasma" resolves to EDTA, not the generic plasma branch. */
/** "synovial fluid" → "Synovial Fluid"; "csf" → "CSF". */
function specimenTitle(s: string): string {
  const t = s.trim().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  return t.replace(/\bCsf\b/g, "CSF");
}

function specimenContainer(sampleType: string): Container | null {
  if (!sampleType) return null;
  if (sampleType.includes("urine"))
    return {
      kind: "urine_cup",
      color: "#facc15",
      fill: URINE_FILL,
      label: "Urine bottle",
    };
  if (
    sampleType.includes("stool") ||
    sampleType.includes("sputum") ||
    sampleType.includes("swab") ||
    sampleType.includes("csf") ||
    sampleType.includes("fluid") ||
    sampleType.includes("sterile") ||
    sampleType.includes("semen") ||
    sampleType.includes("secretion")
  )
    // One container PER SPECIMEN TYPE (stool ≠ CSF ≠ semen…) — name the
    // specimen so two sterile pots on one order are distinguishable.
    return {
      kind: "jar",
      color: "#e5e7eb",
      fill: "#9ca3af",
      label: `Sterile · ${specimenTitle(sampleType)}`,
    };
  if (sampleType.includes("edta"))
    return {
      kind: "vacutainer",
      color: "#a855f7",
      fill: BLOOD_FILL,
      label: "EDTA · Lavender",
    };
  if (
    sampleType.includes("fluoride") ||
    sampleType.includes("glucose") ||
    sampleType.includes("oxalate") ||
    sampleType.includes("grey")
  )
    return {
      kind: "vacutainer",
      color: "#9ca3af",
      fill: BLOOD_FILL,
      label: "Fluoride · Grey",
    };
  if (sampleType.includes("citrate") || sampleType.includes("coag"))
    return {
      kind: "vacutainer",
      color: "#38bdf8",
      fill: BLOOD_FILL,
      label: "Sodium Citrate · Blue",
    };
  if (sampleType.includes("esr"))
    return {
      kind: "vacutainer",
      color: "#1f2937",
      fill: BLOOD_FILL,
      label: "ESR · Black",
    };
  if (
    sampleType.includes("heparin") ||
    sampleType.includes("arterial") ||
    sampleType.includes("abg")
  )
    return {
      kind: "vacutainer",
      color: "#22c55e",
      fill: BLOOD_FILL,
      label: "Lithium Heparin · Green",
    };
  if (
    sampleType.includes("sst") ||
    sampleType.includes("gold") ||
    sampleType.includes("serum")
  )
    return {
      kind: "vacutainer",
      color: "#eab308",
      fill: BLOOD_FILL,
      label: "SST · Gold",
    };
  if (sampleType.includes("plain") || sampleType.includes("red"))
    return {
      kind: "vacutainer",
      color: "#ef4444",
      fill: BLOOD_FILL,
      label: "Plain · Red",
    };
  if (sampleType.includes("plasma"))
    return {
      kind: "vacutainer",
      color: "#22c55e",
      fill: BLOOD_FILL,
      label: "Lithium Heparin · Green",
    };
  if (sampleType.includes("blood"))
    return {
      kind: "vacutainer",
      color: "#a855f7",
      fill: BLOOD_FILL,
      label: "EDTA · Lavender",
    };
  return null;
}

export function containerFor(
  s: OrderSample,
  deptCfg?: Record<string, { color?: string | null; label?: string | null }>,
): Container {
  // The vial's own colour (set on the test → grouped into this vial) is
  // authoritative: it's what defined this tube's (space, colour) group.
  const tc = s.tubeColor && TUBE_COLOR_MAP[s.tubeColor];
  if (tc) {
    // Sterile pots hold ONE specimen type each — label it with the specimen so
    // two sterile containers on an order read differently (Stool vs CSF…).
    if (s.tubeColor === "sterile") {
      // The specimen CHOSEN at the desk wins (tubes group by it), else the
      // Test Master's own specimen.
      const spec = (tubeSpecimen(s) ?? "").toLowerCase().trim();
      return {
        kind: "jar",
        color: tc.color,
        fill: "#9ca3af",
        label: spec ? `Sterile · ${specimenTitle(spec)}` : tc.label,
      };
    }
    if (s.tubeColor === "blood_culture") {
      const chosen = tubeChosenSpecimen(s);
      return {
        kind: "bottle",
        color: tc.color,
        fill: BLOOD_FILL,
        label: chosen ? `${tc.label} · ${specimenTitle(chosen.toLowerCase())}` : tc.label,
      };
    }
    if (s.tubeColor === "urine")
      return {
        kind: "urine_cup",
        color: tc.color,
        fill: URINE_FILL,
        label: tc.label,
      };
    return {
      kind: "vacutainer",
      color: tc.color,
      fill: BLOOD_FILL,
      label: tc.label,
    };
  }
  // Analyte-driven tubes (NABL): a few analytes dictate the tube regardless of a
  // generic serum/plasma specimen. Blood sugar / glucose-tolerance → sodium
  // fluoride (grey, stops glycolysis); HbA1c → EDTA (lavender). An explicit
  // per-test tube colour above still wins.
  const testName = (s.tests[0]?.test?.name ?? "").toLowerCase();
  if (/hba1c|glycated h|glycosylated h/.test(testName)) {
    return {
      kind: "vacutainer",
      color: "#a855f7",
      fill: BLOOD_FILL,
      label: "EDTA · Lavender",
    };
  }
  if (/\bsugar\b|glucose tolerance|\bogtt\b|\bgtt\b/.test(testName)) {
    return {
      kind: "vacutainer",
      color: "#9ca3af",
      fill: BLOOD_FILL,
      label: "Fluoride · Grey",
    };
  }
  // Map the test's specimen/sampleType to the NABL vacutainer cap colour.
  // Ordered specific → general so e.g. "EDTA Plasma" resolves to EDTA, not
  // the generic plasma branch below.
  const raw = (tubeSpecimen(s) ?? "").toLowerCase().trim();
  // "A + B" ("Serum + 24h Urine") means BOTH containers are drawn; a literal
  // "Multiple" specimen likewise → the Multiple tube.
  if (raw === "multiple" || raw.includes("+")) {
    return {
      kind: "vacutainer",
      color: "#6366f1",
      fill: BLOOD_FILL,
      label: "Multiple",
    };
  }
  // "A / B" ("Serum/Plasma") means EITHER is acceptable — resolve to the first
  // option that maps, falling through to the next ("use A, else B").
  for (const part of raw.split("/")) {
    const hit = specimenContainer(part.trim());
    if (hit) return hit;
  }
  // Department container: the admin-configured colour/label wins (set per
  // department in Branches → Departments), then the sample's own department
  // record, then the built-in convention, then a neutral grey tube.
  const code = s.department?.code ?? "";
  const cfg = deptCfg?.[code];
  const conv = DEPT_VACUTAINER[code];
  const color =
    s.department?.containerColor || cfg?.color || conv?.color || "#6b7280";
  const label =
    s.department?.containerLabel || cfg?.label || conv?.label || "Tube";
  return { kind: "vacutainer", color, fill: BLOOD_FILL, label };
}

interface OrderGroup {
  orderId: string;
  /** Human-readable order number (LAB-2607-000042); falls back to a short id.
   *  Shown in the collect drawer's header — the order is what the collector is
   *  working, while each tube's own barcode sits on its card. */
  orderNo: string;
  patientName: string;
  patientMeta: string;
  createdAt: string;
  samples: OrderSample[];
  totalVials: number;
  /** Tubes DRAWN (collected or further). A not-collected tube never counts. */
  collected: number;
  /** Tubes marked "Can't collect" (rejected before any draw) — a sink: they
   *  are neither drawn nor pending, and never dispatchable. */
  notCollected: number;
  /** Server-computed on the embedded order: the require-bill gate is on and
   *  the bill isn't settled — dispatch would be rejected, offer "Bill". */
  paymentHold: boolean;
  /** FULL display name (never the 15-char cut of formatPatientInfo). */
  patientFull?: string;
  patientId?: string;
}

@Component({
  selector: "pf-sample-collection",
  standalone: true,
  imports: [SkeletonDetailComponent,
    ZoomSourceDirective,
    ZoomTargetDirective,
    FormsModule,
    DatePipe,
    AvatarComponent,
    HeroBandComponent,
    BarcodeScannerModalComponent,
    ScreenHeaderComponent,
    TouchButtonComponent,
    KpiStripComponent,
    LabelCardComponent,
    ScanIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./sample-collection.component.html",
  styleUrl: "./sample-collection.component.scss",
})
export class SampleCollectionComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  /** Design version gate — 'new' renders the designer band/skin, 'classic' the pre-port look. */
  readonly theme = inject(ThemeService);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly printer = inject(PrinterService);
  private readonly printConfig = inject(PrintConfigService);
  private readonly labCfg = inject(BranchLabConfigService);
  /** Show the department on a tube only for standalone labs; an integrated lab
   *  (all departments run as one lab) hides it. (Cortex OPS-37) */
  protected readonly showTubeDept = computed(() => this.labCfg.standaloneLab());
  private readonly dialog = inject(DialogService);
  private readonly process = inject(ProcessWorkflowService);
  protected readonly scan = inject(ScanService);

  /** Rendered embedded inside a host pane: the host supplies its own header, so
   *  we suppress our KPI strip + screen header + outer page padding while
   *  keeping the queue + scan + drawer. (My Work no longer embeds it — the band
   *  "Collect" button opens the full page.) */
  @Input() embedded = false;
  readonly sampleCollected = output<void>();

  /** Whether this user can dispatch (hand collected tubes to the lab) — needs
   *  the permission AND the workflow to actually include a dispatch step (else
   *  the backend rejects it, so the button must not show at all). */
  readonly canDispatch = computed(
    () =>
      this.auth.hasPermission("dispatch_sample") &&
      this.process.dispatchStepEnabled(),
  );

  /** True when the workflow actually has a dispatch step (independent of the
   *  user's permission) — hides ALL dispatch chrome (button + payment-hold note)
   *  in auto-receive workflows where there's nothing to dispatch. */
  readonly dispatchStep = computed(() => this.process.dispatchStepEnabled());
  /** Whether this user can take a payment-held order to the billing screen
   *  (route /frontdesk/order needs create_order; create_bill implies desk staff). */
  readonly canBill = computed(
    () =>
      this.auth.hasPermission("create_bill") ||
      this.auth.hasPermission("create_order"),
  );
  /** Payment-held order: jump to the billing screen with the order loaded. */
  goToBilling(g: OrderGroup) {
    this.router.navigate(["/frontdesk/order"], {
      queryParams: { orderId: g.orderId },
    });
  }
  private readonly _dispatching = signal(false);
  readonly dispatching = this._dispatching.asReadonly();

  /** True once every tube on the order has moved past 'collected' (dispatched
   *  or further) — used to flip the UI from "collected" to "dispatched".
   *  Defined as "no tube is still pending or awaiting dispatch" rather than a
   *  fixed done-status whitelist, so a tube in any post-dispatch state
   *  (received / in-lab / completed …) still counts — otherwise the drawer
   *  kept offering Dispatch after everything was already dispatched. Matches
   *  the per-tube "Dispatched" badge, which uses the same rule. */
  isDispatched(g: OrderGroup): boolean {
    return isOrderDispatched(g.samples);
  }

  /** Per-tube External mark: THIS tube was brought in from outside — one
   *  tap collects it as brought-in (no draw, full collect machine on the
   *  server incl. auto-receive workflows); tapping the mark again reverts
   *  while the tube hasn't moved past the counter. Per-tube on purpose: an
   *  order routinely has one walked-in specimen among several draws. */
  private readonly _sourceBusy = signal(false);
  readonly sourceBusy = this._sourceBusy.asReadonly();
  /** The flag shows on tubes that can still be marked: pending and not a
   *  locked/not-yet-due series time point. */
  canMarkExternal(s: OrderSample): boolean {
    return s.status === "pending" && this.tubeState(s).kind !== "locked";
  }
  async toggleExternal(s: OrderSample, ev: Event) {
    ev.stopPropagation();
    ev.preventDefault();
    if (this._sourceBusy()) return;
    const source = s.source === "external" ? "internal" : "external";
    this._sourceBusy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.patch<OrderSample>(`/api/samples/${s.id}/source`, { source }),
      );
      // Trust the server's resulting state (auto-receive workflows may land
      // the tube on 'received' rather than 'collected').
      this._pending.update((list) =>
        list.map((x) =>
          x.id === s.id
            ? { ...x, status: updated?.status ?? x.status, source: updated?.source ?? null,
                collectedAt: updated?.collectedAt ?? undefined }
            : x,
        ),
      );
      this.toasts.success(
        source === "external"
          ? "Marked External — no draw needed"
          : "Back to in-house draw",
      );
      if (source === "external") this.sampleCollected.emit();
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._sourceBusy.set(false);
    }
  }

  /** Mark every collected tube on this order as dispatched to the lab. */
  async dispatchOrder(g: OrderGroup) {
    if (this._dispatching()) return;
    this._dispatching.set(true);
    try {
      await firstValueFrom(
        this.api.patch(`/api/orders/${g.orderId}/dispatch`, {}),
      );
      // Reflect dispatched status locally so the drawer shows "Dispatched"
      // without a round-trip (pending-collection wouldn't return these anymore).
      this._pending.update((list) =>
        list.map((s) =>
          s.orderId === g.orderId && s.status === "collected"
            ? { ...s, status: "dispatched" }
            : s,
        ),
      );
      this.toasts.success("Dispatched to lab");
      // Reached from the front desk (?from=…) → go back there automatically.
      // In the standalone lab queue (_returnTo null) stay put.
      if (this._returnTo) {
        const target = this._returnTo;
        this._returnTo = null;
        this.router.navigateByUrl(target);
      }
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._dispatching.set(false);
    }
  }

  /** Undo dispatch — revert dispatched tubes back to collected (only while the
   *  lab hasn't received them). */
  async undispatchOrder(g: OrderGroup) {
    if (this._dispatching()) return;
    this._dispatching.set(true);
    try {
      await firstValueFrom(
        this.api.patch(`/api/orders/${g.orderId}/undispatch`, {}),
      );
      this._pending.update((list) =>
        list.map((s) =>
          s.orderId === g.orderId && s.status === "dispatched"
            ? { ...s, status: "collected" }
            : s,
        ),
      );
      this.toasts.success("Dispatch undone");
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._dispatching.set(false);
    }
  }
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  /** List → detail zoom (core/navigation/zoom-transition): the tapped
   *  patient card morphs into the collection view, and closing reverses it. */
  private readonly zoom = inject(ZoomTransitionService);
  // Set when the user lands here from another screen via ?orderId=… (e.g. FD's
  // "Collect Sample" button). On close, we send them back to that origin
  // instead of leaving them stranded on the queue.
  private _returnTo: string | null = null;
  /** Queue mode reached from another screen's band "Collect" (?from=…, no
   *  orderId): the queue band shows Back to that screen. */
  private readonly _queueFrom = signal<string | null>(null);
  readonly queueFrom = this._queueFrom.asReadonly();
  readonly queueBackFn = () => { const t = this._queueFrom(); if (t) this.router.navigateByUrl(t); };

  @ViewChild("drawerEl") private drawerRef?: ElementRef<HTMLElement>;
  private teleportedEl: HTMLElement | null = null;

  constructor() {
    // The shell component forms a stacking context (z-index: 1) and the
    // top-strip inside it sits at z-index: 40 — as a sibling of the router
    // outlet, that top-strip paints above anything nested inside the outlet,
    // regardless of its own z-index. So we move the drawer element to
    // <body> whenever it opens; that escapes the stacking context and lets
    // the full-screen overlay actually cover the nav.
    effect(() => {
      const hasDrawer = !!this.activeGroup();
      // The bottom navbar stays visible (owner rule): the drawer is an
      // .nd-fullscreen view that ends ABOVE it.
      if (!hasDrawer) {
        this.detachTeleport();
        return;
      }
      // NEW design: no teleport. The drawer stays in the page (under the
      // shell's stacking context) at a z-index BELOW the docked app bar, so
      // the bar's own menus (avatar / branch / bell) open above it instead
      // of behind it. The drawer already ends above the bar (.nd-fullscreen).
      if (this.theme.isNewDesign()) return;
      // Wait a frame for @if to render the element before reparenting.
      queueMicrotask(() => {
        const el = this.drawerRef?.nativeElement;
        if (el && el.parentNode !== document.body) {
          document.body.appendChild(el);
          this.teleportedEl = el;
        }
      });
    });

    // Repetitive mode: a 1 Hz clock drives the "not due" countdowns and the
    // due/missed transitions. It runs ONLY while the open drawer holds
    // pending series tubes — normal orders never tick, and the interval is
    // cleared the moment the drawer closes or the last series tube is drawn.
    effect(() => {
      const g = this.activeGroup();
      const needsClock =
        !!g &&
        g.samples.some(
          (s) => s.repeatOffsetMin != null && s.status === "pending",
        );
      if (needsClock && this._clock == null) {
        this.nowMs.set(Date.now());
        this._clock = setInterval(() => this.nowMs.set(Date.now()), 1000);
      } else if (!needsClock && this._clock != null) {
        clearInterval(this._clock);
        this._clock = null;
      }
    });
  }

  ngOnDestroy() {
    if (this._clock != null) {
      clearInterval(this._clock);
      this._clock = null;
    }
    this.detachTeleport();
  }

  private detachTeleport() {
    if (this.teleportedEl && this.teleportedEl.parentNode === document.body) {
      document.body.removeChild(this.teleportedEl);
    }
    this.teleportedEl = null;
  }

  protected readonly scanValue = signal("");
  protected readonly scannerOpen = signal(false);
  private readonly _pending = signal<OrderSample[]>([]);
  private readonly _openOrderId = signal<string | null>(null);
  /** Admin-configured container colour/label per department code (Branches →
   *  Departments). Loaded once so the tube guide reflects the lab's own scheme. */
  private readonly _deptContainers = signal<
    Record<string, { color?: string | null; label?: string | null }>
  >({});
  /** True when the user landed here via ?orderId=… (e.g. FD's "Collect"
   *  button on an order row). Suppresses the queue list + scan row so
   *  the page reads as a direct order-collection view, not a queue +
   *  popup. Set once in ngOnInit and not cleared until navigation. */
  private readonly _deepLinkMode = signal<boolean>(false);
  readonly deepLinkMode = this._deepLinkMode.asReadonly();
  protected readonly REJECT_REASONS: ReadonlyArray<{
    code: string;
    label: string;
  }> = [
    { code: "refused", label: "Patient refused" },
    { code: "fainted", label: "Patient fainted" },
    { code: "no_vein", label: "Vein not found" },
    { code: "insufficient", label: "Insufficient sample" },
    { code: "wrong_tube", label: "Wrong tube" },
    { code: "other", label: "Other" },
  ];
  protected readonly _rejectModal = signal<{
    group: OrderGroup;
    reason: string;
    note: string;
  } | null>(null);

  readonly pending = this._pending.asReadonly();
  readonly openOrderId = this._openOrderId.asReadonly();

  readonly groups = computed<OrderGroup[]>(() => {
    const byOrder = new Map<string, OrderGroup>();
    for (const s of this._pending()) {
      let g = byOrder.get(s.orderId);
      if (!g) {
        const p = s.order?.patient;
        g = {
          orderId: s.orderId,
          orderNo:
            s.order?.orderNumber ||
            "#" + s.orderId.replace(/-/g, "").slice(-8).toUpperCase(),
          patientName: formatPatientInfo(p),
          patientFull: (p && patientDisplayName(p)) || undefined,
          patientId: p?.id,
          patientMeta: "",
          createdAt: s.createdAt,
          samples: [],
          totalVials: 0,
          collected: 0,
          notCollected: 0,
          paymentHold: false,
        };
        byOrder.set(s.orderId, g);
      }
      g.samples.push(s);
      g.totalVials++;
      if (isNotCollected(s)) g.notCollected++;
      else if (s.status !== "pending") g.collected++;
      if (s.order?.paymentHold) g.paymentHold = true;
    }
    // Meta line = the SAMPLE barcode(s), not the order number — the tube in
    // hand is what the collector matches against. Multi-tube orders show the
    // first barcode + a count; each tube's own barcode is on its card/row.
    const list = Array.from(byOrder.values());
    for (const g of list) {
      const codes = g.samples
        .map((x) => x.barcode)
        .filter((b): b is string => !!b);
      g.patientMeta =
        codes.length === 0
          ? "—"
          : codes.length === 1
            ? codes[0]
            : `${codes[0]} +${codes.length - 1}`;
    }
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });

  /** "12 min waiting" — how long since the order was raised. */
  protected waitingLabel(g: OrderGroup): string {
    const ms = Date.now() - new Date(g.createdAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min waiting`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60 > 0 ? (m % 60) + ' m ' : ''}waiting`;
    return `${Math.floor(h / 24)} d waiting`;
  }
  /** Escalating tone for the waiting badge: >30 min amber, >60 min red. */
  protected waitingTone(g: OrderGroup): 'ok' | 'warn' | 'late' {
    const m = (Date.now() - new Date(g.createdAt).getTime()) / 60000;
    return m > 60 ? 'late' : m > 30 ? 'warn' : 'ok';
  }

  /** Same as groups() but filtered by the live search box. Empty input shows all. */
  readonly filteredGroups = computed<OrderGroup[]>(() => {
    const q = this.scanValue().trim().toLowerCase();
    if (!q) return this.groups();
    return this.groups().filter((g) => {
      if (g.patientName.toLowerCase().includes(q)) return true;
      if (g.orderId.toLowerCase().startsWith(q.replace(/^#/, ""))) return true;
      return g.samples.some(
        (s) =>
          (s.barcode ?? "").toLowerCase().includes(q) ||
          (s.order?.patient?.phone ?? "").includes(this.scanValue().trim()) ||
          (s.order?.patient?.mrn ?? "").toLowerCase().includes(q),
      );
    });
  });

  // The group currently shown in the drawer, kept in sync with live refreshes.
  readonly activeGroup = computed<OrderGroup | null>(() => {
    const id = this._openOrderId();
    if (!id) return null;
    return this.groups().find((g) => g.orderId === id) ?? null;
  });

  // ─── Repetitive mode (Phase 3) ────────────────────────────────────────
  /** Wall clock, ticked at 1 Hz by the constructor effect ONLY while the
   *  open drawer contains pending series tubes. */
  readonly nowMs = signal(Date.now());
  private _clock: ReturnType<typeof setInterval> | null = null;
  /** Client-side override: locked 'not-due' tubes force-unlocked by 4 rapid
   *  taps — they render (and collect) as 'due'. */
  readonly earlyUnlocked = signal<Set<string>>(new Set());
  /** Client-side override: 'missed' tubes reopened by a double-tap — they
   *  render (and collect) as 'due'. */
  readonly reopened = signal<Set<string>>(new Set());
  /** Per-sample rapid-tap tracker for the two override gestures. */
  private readonly _taps = new Map<string, { count: number; lastTs: number }>();
  /** 4 taps, each ≤1.5s after the previous, unlock a 'not-due' tube. */
  private static readonly EARLY_UNLOCK_TAPS = 4;
  private static readonly EARLY_UNLOCK_GAP_MS = 1500;
  /** Double-tap within 400ms reopens a 'missed' tube. */
  private static readonly REOPEN_TAP_MS = 400;

  /** Series state per sample of the ACTIVE group, memoized per clock tick /
   *  data change so the template can call tubeState() freely. Overrides
   *  (early unlock / reopen) are applied here, converting to 'due'. */
  private readonly _tubeStates = computed<Map<string, SeriesState>>(() => {
    const map = new Map<string, SeriesState>();
    const g = this.activeGroup();
    if (!g) return map;
    const now = this.nowMs();
    const early = this.earlyUnlocked();
    const reopened = this.reopened();
    for (const s of g.samples) {
      let st = seriesState(s, g.samples, now);
      if (st.kind === "locked" && st.reason === "not-due" && early.has(s.id)) {
        st = { kind: "due", dueAt: st.dueAt };
      } else if (st.kind === "missed" && reopened.has(s.id)) {
        st = { kind: "due", dueAt: st.dueAt };
      }
      map.set(s.id, st);
    }
    return map;
  });

  patientTitle(rawName: string): string {
    if (!rawName) return '—';
    const parts = rawName.split('|').map(s => s.trim());
    return parts[0] || rawName;
  }

  patientSub(rawName: string): string {
    if (!rawName) return '';
    const parts = rawName.split('|').map(s => s.trim());
    if (parts.length > 1) {
      return parts.slice(1).join(' · ');
    }
    return '';
  }

  /** The tube's series state ('normal' for every non-series tube — all the
   *  pre-existing template branches key off that). */
  tubeState(s: OrderSample): SeriesState {
    return this._tubeStates().get(s.id) ?? { kind: "normal" };
  }

  /** Drawer order: normal tubes first (existing order), then series tubes by
   *  (series, ascending offset). */
  // ─── Context bar (band pill) + VIALS filter (nd pattern) ─────────────
  /** Status filter for the VIALS card (All · Pending · Drawn · External). */
  readonly vialFilter = signal<'all' | 'pending' | 'drawn' | 'external'>('all');
  /** "N samples" chip expanded (lists the sample IDs). */
  readonly samplesOpen = signal(false);
  /** Phone: the COLLECTION card opens as a sheet from the bottom bar. */
  readonly actionsOpen = signal(false);
  /** Back chevron in the band closes this step (hero-band backAction). */
  readonly closeFn = () => this.close();

  vialFilterOpts(g: OrderGroup): Array<{ id: 'all' | 'pending' | 'drawn' | 'external'; label: string; count: number }> {
    const ss = g.samples;
    return [
      { id: 'all', label: 'All', count: ss.length },
      { id: 'pending', label: 'Pending', count: ss.filter(s => s.status === 'pending').length },
      { id: 'drawn', label: 'Drawn', count: ss.filter(s => isDrawn(s)).length },
      { id: 'external', label: 'External', count: ss.filter(s => s.source === 'external').length },
    ];
  }
  /** Adaptive tile size from the vial count (usually ≤ 6–7 vials, so use
   *  the big screen): 1–2 → xl, 3–4 → lg, 5–7 → md, 8+ → sm. */
  tileSize(g: OrderGroup): 'xl' | 'lg' | 'md' | 'sm' {
    const n = this.visibleSamples(g).length;
    return n <= 2 ? 'xl' : n <= 4 ? 'lg' : n <= 7 ? 'md' : 'sm';
  }
  /** The vial tiles shown under the current filter. */
  visibleSamples(g: OrderGroup): OrderSample[] {
    const f = this.vialFilter();
    const list = this.orderedSamples(g);
    if (f === 'pending') return list.filter(s => s.status === 'pending');
    if (f === 'drawn') return list.filter(s => isDrawn(s));
    if (f === 'external') return list.filter(s => s.source === 'external');
    return list;
  }
  /** Collection info the vial tiles DON'T already show — only fields the
   *  collect payload actually carries (order priority, referral, per-test
   *  fasting flag). Nothing is invented; empty → the panel stays lean. */
  collectInfo(g: OrderGroup): { urgent: boolean; fasting: string[]; refDoctor: string; refHospital: string } {
    const o = g.samples.find((x) => !!x.order)?.order;
    const fasting = new Set<string>();
    for (const smp of g.samples)
      for (const t of smp.tests ?? [])
        if ((t as { test?: { fastingRequired?: boolean; name?: string } }).test?.fastingRequired)
          fasting.add((t as { test?: { name?: string } }).test?.name ?? "Test");
    return {
      urgent: (o?.priority ?? "").toLowerCase() === "urgent",
      fasting: [...fasting],
      refDoctor: (o?.refDoctorName ?? "").trim(),
      refHospital: (o?.refHospitalName ?? "").trim(),
    };
  }
  /** Tests carried by one tube (the tile hides them; the panel lists them
   *  so the collector sees what each tube is for + the volume to draw). */
  tubeTests(smp: OrderSample): Array<{ name: string; vol: number | null }> {
    return (smp.tests ?? [])
      .map((t) => ({
        name: (t as { test?: { name?: string } }).test?.name ?? t.name,
        vol: (t as { test?: { sampleVolumeMl?: number | null } }).test?.sampleVolumeMl ?? null,
      }))
      .filter((x) => !!x.name);
  }

  /** Order → drawn → dispatched, from the timestamps the payload carries. */
  collectTimeline(g: OrderGroup): Array<{ key: string; label: string; at: string | null; done: boolean; note?: string; tone?: "stopped" }> {
    const o = g.samples.find((x) => !!x.order)?.order;
    const drawnAts = g.samples.map((x) => x.collectedAt).filter((x): x is string => !!x).sort();
    const dispAts = g.samples.map((x) => x.dispatchedAt).filter((x): x is string => !!x).sort();
    const allDrawn = g.collected === g.totalVials;
    const steps: Array<{ key: string; label: string; at: string | null; done: boolean; note?: string; tone?: "stopped" }> = [
      { key: "ordered", label: "Ordered", at: o?.createdAt ?? g.createdAt ?? null, done: true },
      {
        key: "drawn", label: "Drawn", done: allDrawn,
        at: allDrawn ? drawnAts[drawnAts.length - 1] ?? null : null,
        note: allDrawn ? undefined : `${g.collected} of ${g.totalVials}`,
      },
    ];
    // "Can't collect" is its own stop on the timeline — never folded into
    // Drawn / Dispatched (QA #6).
    if (g.notCollected > 0) {
      const reasons = [...new Set(g.samples.filter(isNotCollected).map((x) => (x.rejectedReason ?? "").trim()).filter(Boolean))];
      steps.push({
        key: "not_collected", label: "Not collected", at: null, done: false, tone: "stopped",
        note: `${g.notCollected} of ${g.totalVials}${reasons.length ? " · " + reasons.join(", ") : ""}`,
      });
    }
    steps.push({ key: "dispatched", label: "Dispatched", done: this.isDispatched(g), at: dispAts[dispAts.length - 1] ?? null });
    return steps;
  }

  hasCollectInfo(g: OrderGroup): boolean {
    const i = this.collectInfo(g);
    return i.urgent || i.fasting.length > 0 || !!i.refDoctor || !!i.refHospital;
  }

  /** Full patient name for the context chip (falls back to the list name). */
  patientFullName(g: OrderGroup): string {
    return g.patientFull || this.patientTitle(g.patientName);
  }
  /** The patient chip opens the profile when the user may view patients. */
  canOpenPatient(g: OrderGroup): boolean {
    return !!g.patientId && (this.auth.hasPermission('view_patient') || this.auth.hasPermission('register_patient'));
  }
  openPatient(g: OrderGroup): void {
    if (!this.canOpenPatient(g)) return;
    const id = g.patientId!;
    this._openOrderId.set(null);
    this.router.navigate(['/frontdesk/patients', id]);
  }

  /** Every department on the tube — a shared tube (CBC + HbA1c on one EDTA)
   *  names them all. */
  tubeDeptLabel(s: OrderSample): string {
    return tubeDepartmentLabel(s);
  }

  orderedSamples(g: OrderGroup): OrderSample[] {
    return sortForCollection(g.samples);
  }

  /** Caption chip beside the container name. Offsets >0 always show
   *  ("+30 min"); the anchor shows "First draw" only once it's no longer
   *  pending (while pending, the status pill already says it). */
  captionOffset(s: OrderSample): string | null {
    const off = s.repeatOffsetMin;
    if (off == null) return null;
    if (off > 0) return offsetLabel(off);
    return s.status !== "pending" ? "First draw" : null;
  }

  /** Live "m:ss" countdown for the locked-not-due pill. */
  countdown(msUntilDue: number | undefined): string {
    return countdownLabel(msUntilDue ?? 0);
  }

  hasSeries(g: OrderGroup): boolean {
    return g.samples.some((s) => s.repeatOffsetMin != null);
  }

  /** Footer Done gate. Non-series groups keep the exact legacy rule (every
   *  vial drawn). Series groups block only on tubes collectable RIGHT NOW
   *  ('normal' | 'anchor' | 'due') — locked future offsets and missed
   *  windows don't hold the collector hostage in the drawer. */
  doneDisabled(g: OrderGroup): boolean {
    // A not-collected tube is settled (it waits for Recollect at the desk),
    // so it doesn't hold the collector in the drawer.
    if (!this.hasSeries(g)) return g.collected + (g.notCollected ?? 0) < g.totalVials;
    return g.samples.some((s) => {
      if (s.status !== "pending") return false;
      const k = this.tubeState(s).kind;
      return k === "normal" || k === "anchor" || k === "due";
    });
  }

  /** A dispatch / bill action is the footer's call to action right now
   *  (mirrors the template's footer branches). */
  dispatchCtaShown(g: OrderGroup): boolean {
    if (this.isDispatched(g)) return false;
    if (g.collected === g.totalVials && g.paymentHold && this.dispatchStep()) return this.canBill();
    if (g.collected === g.totalVials && this.canDispatch()) return true;
    return this.canPartialDispatch(g);
  }

  /** Colour discipline: ONLY the main call to action is primary. The
   *  finish button is it when enabled and no dispatch / bill action is on
   *  offer (and after dispatch, as before). */
  finishIsPrimary(g: OrderGroup): boolean {
    return this.isDispatched(g) || (!this.doneDisabled(g) && !this.dispatchCtaShown(g));
  }

  doneLabel(g: OrderGroup): string {
    if (this.doneDisabled(g)) return "Collect all to finish";
    if (this.hasSeries(g) && g.samples.some((s) => s.status === "pending"))
      return "Done for now";
    return "Done";
  }

  /** Clear all per-drawer client-side series/dispatch state (overrides, tap
   *  trackers, selection mode) — called on drawer open and close. */
  private resetSeriesOverrides(): void {
    this._taps.clear();
    if (this.earlyUnlocked().size) this.earlyUnlocked.set(new Set());
    if (this.reopened().size) this.reopened.set(new Set());
    this.dispatchSelect.set(null);
  }

  // ─── Partial dispatch (Phase 4) ───────────────────────────────────────
  /** Non-null while selection mode is active: the set of sample ids chosen
   *  for a partial dispatch. */
  readonly dispatchSelect = signal<Set<string> | null>(null);

  collectedCount(g: OrderGroup): number {
    return countCollected(g.samples);
  }

  /** "Dispatch tubes…" shows when the workflow has a dispatch step, the user
   *  may dispatch, there's no payment hold, and the order is PARTIALLY
   *  collected (≥1 tube 'collected' but not every tube drawn) — the
   *  all-collected case keeps the classic whole-order Dispatch button. */
  canPartialDispatch(g: OrderGroup): boolean {
    return (
      this.dispatchStep() &&
      this.canDispatch() &&
      !g.paymentHold &&
      !this.isDispatched(g) &&
      this.collectedCount(g) > 0 &&
      g.collected < g.totalVials
    );
  }

  /** Enter selection mode with every currently-collected tube pre-selected
   *  (the overwhelmingly common intent: "send what I've drawn so far"). */
  startPartialDispatch(g: OrderGroup): void {
    this.dispatchSelect.set(
      new Set(
        g.samples.filter((s) => s.status === "collected").map((s) => s.id),
      ),
    );
  }

  cancelPartialDispatch(): void {
    this.dispatchSelect.set(null);
  }

  /** One-click (OPS-66): dispatch every currently-collected tube — the
   *  overwhelmingly common series intent, "send what I've drawn so far". No
   *  intermediate select-then-confirm step; picking a subset stays available
   *  via startPartialDispatch()/"Choose". */
  async dispatchCollected(g: OrderGroup): Promise<void> {
    if (this._dispatching()) return;
    const ids = g.samples
      .filter((s) => s.status === "collected")
      .map((s) => s.id);
    await this.dispatchSampleIds(g, ids);
  }

  /** Confirm the tubes chosen in selection mode ("Choose" path). */
  async confirmPartialDispatch(g: OrderGroup): Promise<void> {
    const sel = this.dispatchSelect();
    if (!sel || sel.size === 0 || this._dispatching()) return;
    const ids = g.samples
      .filter((s) => sel.has(s.id) && s.status === "collected")
      .map((s) => s.id);
    this.dispatchSelect.set(null);
    await this.dispatchSampleIds(g, ids);
  }

  /** Dispatch the given tubes one by one (PATCH /api/samples/{id}/dispatch),
   *  optimistically flipping each to 'dispatched' and rolling back on error.
   *  STAYS in the drawer — the _returnTo navigation is exclusive to the
   *  whole-order dispatchOrder() path. */
  private async dispatchSampleIds(g: OrderGroup, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    this._dispatching.set(true);
    let ok = 0;
    let firstError: string | null = null;
    for (const id of ids) {
      // Optimistic flip; sequential PATCH; roll back this tube on failure.
      this._pending.update((list) =>
        list.map((x) => (x.id === id ? { ...x, status: "dispatched" } : x)),
      );
      try {
        await firstValueFrom(this.api.patch(`/api/samples/${id}/dispatch`, {}));
        ok++;
      } catch (e) {
        this._pending.update((list) =>
          list.map((x) => (x.id === id ? { ...x, status: "collected" } : x)),
        );
        if (!firstError) firstError = ApiError.from(e).message;
      }
    }
    if (ok > 0) {
      this.toasts.success(`${ok} tube${ok === 1 ? "" : "s"} dispatched to lab`);
      this.sampleCollected.emit();
    }
    if (firstError) this.toasts.error(firstError);
    this._dispatching.set(false);
  }

  async ngOnInit() {
    // Live queue: refetch when an order is created / a tube changes (no
    // polling) — but NEVER while the drawer is open. Our own collect /
    // External / dispatch actions echo back as collection events, and a
    // mid-flow refresh replaces the pending list, dropping the open order's
    // tubes: activeGroup() goes null, the drawer unmounts (or, deep-linked,
    // the page falls into the eternal "Opening collection…" loader). close()
    // already refreshes, so nothing is lost by waiting.
    this.liveQ.on('collection', 'frontdesk').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this._openOrderId()) return;
      this.refresh();
    });
    // Per-branch label config (size + code) for direct-to-printer label print.
    this.labCfg.ensureLoaded();
    // Load the lab's configured container colours (best-effort — falls back to
    // the built-in conventions if it fails or a department has none set).
    this.api
      .get<
        {
          code: string;
          containerColor?: string | null;
          containerLabel?: string | null;
        }[]
      >("/api/tenants/departments")
      .subscribe({
        next: (list) => {
          const map: Record<
            string,
            { color?: string | null; label?: string | null }
          > = {};
          for (const d of list ?? [])
            map[d.code] = { color: d.containerColor, label: d.containerLabel };
          this._deptContainers.set(map);
        },
        error: () => {},
      });

    const oid = this.route.snapshot.queryParamMap.get("orderId");
    if (oid) {
      this._openOrderId.set(oid);
      this._deepLinkMode.set(true);
      // Honour an explicit ?from=… if the caller passes one (e.g. lab dispatch
      // counter), otherwise default deep-links back to /frontdesk since that's
      // the only screen that links here today.
      const from = this.route.snapshot.queryParamMap.get("from");
      this._returnTo = from && from.startsWith("/") ? from : "/frontdesk";
    } else {
      // The band "Collect" button (pf-collect-band-button) opens the
      // unfiltered queue with ?from=… — Back on the queue band returns there.
      const from = this.route.snapshot.queryParamMap.get("from");
      this._queueFrom.set(from && from.startsWith("/") && !from.startsWith("//") ? from : null);
    }

    // /pending-collection only returns samples currently in pending status.
    // When deep-linked from FD's "Collect Sample" button (?orderId=…), fetch
    // the order directly and merge any missing samples in so the drawer can
    // render its tubes regardless of where the order is in the lifecycle.
    try {
      const list = await firstValueFrom(
        this.api.get<OrderSample[]>("/api/samples/pending-collection"),
      );
      let merged: OrderSample[] = list ?? [];
      if (oid) {
        try {
          const order = await firstValueFrom(
            this.api.get<Order>(`/api/orders/${oid}`),
          );
          if (order?.samples?.length) {
            const have = new Set(merged.map((s) => s.id));
            const extras = order.samples
              .filter((s) => !have.has(s.id))
              .map((s) => ({ ...s, order }) as OrderSample);
            if (extras.length) merged = [...merged, ...extras];
          }
        } catch {
          /* leave list as-is, drawer will be empty */
        }
      }
      this._pending.set(merged);
    } catch {
      this._pending.set([]);
    }
  }

  tube(s: OrderSample) {
    return containerFor(s, this._deptContainers());
  }
  container(s: OrderSample) {
    return containerFor(s, this._deptContainers());
  }

  /** Fluid gradient for the cup/jar graphic: amber for urine, neutral grey
   *  for sterile jars (body fluid, stool, CSF …). */
  cupFluid(s: OrderSample): {
    top: string;
    mid: string;
    bottom: string;
    surface: string;
    surfaceHi: string;
  } {
    return this.container(s).kind === "urine_cup"
      ? {
          top: "#fcd34d",
          mid: "#f59e0b",
          bottom: "#b45309",
          surface: "#fde68a",
          surfaceHi: "#fef3c7",
        }
      : {
          top: "#e2e8f0",
          mid: "#94a3b8",
          bottom: "#64748b",
          surface: "#e2e8f0",
          surfaceHi: "#f8fafc",
        };
  }

  /** Long-press (hold ~2s) a vial to peek its test list; a normal tap collects.
   *  The list floats as a popover that stays open while held. A move (scroll)
   *  or early release cancels the peek; once the peek fires, the release's
   *  click is suppressed so it never also collects. */
  readonly peekId = signal<string | null>(null);
  readonly peekPos = signal<{ x: number; y: number } | null>(null);
  readonly peekTests = signal<string[]>([]);
  /** Manual-mode "Label by hand" sheet: what to hand-write on each container. */
  readonly writeUpOpen = signal(false);
  /** Which vial is mid-hold — drives the progress-fill animation. */
  readonly holdingId = signal<string | null>(null);
  private static readonly HOLD_MS = 2000;
  private _pressTimer: ReturnType<typeof setTimeout> | null = null;
  private _longPressFired = false;
  private _downX = 0;
  private _downY = 0;

  onVialDown(s: OrderSample, ev: PointerEvent): void {
    if (ev.button != null && ev.button !== 0) return; // primary / touch only
    this._longPressFired = false;
    this._downX = ev.clientX;
    this._downY = ev.clientY;
    // Float the popover beside the vial (right, or left if no room) so the
    // holding finger never covers it.
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 260;
    let x = r.right + 10;
    if (x + W > window.innerWidth - 8) x = r.left - W - 10;
    x = Math.max(8, Math.min(x, window.innerWidth - W - 8));
    const y = Math.max(8, Math.min(r.top, window.innerHeight - 260));
    const tests = (s.tests ?? [])
      .map((t) => t.test?.name ?? t.name)
      .filter((n): n is string => !!n);
    this.clearPress();
    this.holdingId.set(s.id); // start the hold-progress fill
    this._pressTimer = setTimeout(() => {
      this._longPressFired = true;
      this.holdingId.set(null);
      this.peekPos.set({ x, y });
      this.peekTests.set(tests);
      this.peekId.set(s.id); // popover shows while held
    }, SampleCollectionComponent.HOLD_MS);
  }
  onVialMove(ev: PointerEvent): void {
    if (
      this._pressTimer &&
      (Math.abs(ev.clientX - this._downX) > 10 ||
        Math.abs(ev.clientY - this._downY) > 10)
    ) {
      this.clearPress();
    }
  }
  onVialUp(): void {
    this.clearPress();
  }
  private clearPress(): void {
    if (this._pressTimer) {
      clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
    this.holdingId.set(null);
    this.peekId.set(null); // release hides the peek
  }

  /** The vial's click: suppress it when a long-press just peeked; in
   *  partial-dispatch selection mode taps only toggle collected tubes; on a
   *  locked/missed series tube the tap runs the override gesture counters;
   *  otherwise ('normal' | 'anchor' | 'due') the FIRST tap collects exactly
   *  as it always has. */
  onVialClick(s: OrderSample, ev: Event): void {
    if (this._longPressFired) {
      this._longPressFired = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    // Selection mode: taps toggle membership of collected tubes; every
    // other tube is inert until Cancel / confirm.
    if (this.dispatchSelect() !== null) {
      if (s.status !== "collected") return;
      this.dispatchSelect.update((set) => {
        const next = new Set(set);
        if (next.has(s.id)) next.delete(s.id);
        else next.add(s.id);
        return next;
      });
      return;
    }

    const st = this.tubeState(s);

    if (st.kind === "locked") {
      if (st.reason === "awaiting-anchor") {
        this.toasts.info("Draw the first tube of this series first");
        return;
      }
      // Not due yet: 4 rapid taps (≤1.5s between taps) force-unlock early.
      const now = Date.now();
      const t = this._taps.get(s.id);
      const count =
        t && now - t.lastTs <= SampleCollectionComponent.EARLY_UNLOCK_GAP_MS
          ? t.count + 1
          : 1;
      this._taps.set(s.id, { count, lastTs: now });
      if (count >= SampleCollectionComponent.EARLY_UNLOCK_TAPS) {
        this._taps.delete(s.id);
        this.earlyUnlocked.update((set) => new Set(set).add(s.id));
        this.toasts.success("Unlocked early — tap to collect");
      } else if (count === 1) {
        this.toasts.info(
          `Not due yet — ${dueClockLabel(st.dueAt ?? now)} (tap 4× to override)`,
        );
      }
      return;
    }

    if (st.kind === "missed") {
      // Double-tap (≤400ms) reopens the missed window.
      const now = Date.now();
      const t = this._taps.get(s.id);
      if (t && now - t.lastTs <= SampleCollectionComponent.REOPEN_TAP_MS) {
        this._taps.delete(s.id);
        this.reopened.update((set) => new Set(set).add(s.id));
        this.toasts.success("Missed draw reopened — tap to collect");
      } else {
        this._taps.set(s.id, { count: 1, lastTs: now });
      }
      return;
    }

    this._taps.delete(s.id);
    this.toggleCollected(s);
  }

  /** Total volume to draw for this tube — the sum of its tests' sampleVolumeMl,
   *  skipping tests that don't declare one. Null when NO test declares a
   *  volume, so the "Draw ~N mL" pill is omitted rather than lying with 0. */
  /** Display count where a PROFILE counts as ONE test. */
  testCount(tests: Array<{ packageTestId?: string | null }>): number {
    return logicalTestCount(tests);
  }

  drawVolume(s: OrderSample): number | null {
    let sum = 0;
    let any = false;
    for (const t of s.tests) {
      const v = t.test?.sampleVolumeMl;
      if (v != null) {
        sum += v;
        any = true;
      }
    }
    return any ? Math.round(sum * 10) / 10 : null;
  }

  /** Tube drawn (collected or further) — drives the filled tube, the check
   *  and the time stamp. A not-collected tube is NOT drawn. */
  drawn(s: OrderSample): boolean {
    return isDrawn(s);
  }
  /** Tube marked "Can't collect" (rejected before any draw). */
  notCollected(s: OrderSample): boolean {
    return isNotCollected(s);
  }
  /** "Not collected — Patient refused" / "1 of 2 not collected — …" for the
   *  drawer's status line; null when every tube is drawable. */
  notCollectedText(g: OrderGroup): string | null {
    return notCollectedLabel(g.samples, { full: true });
  }

  openOrder(id: string) {
    this.zoom.runLocal('in', () => {
      this.resetSeriesOverrides();
      this._openOrderId.set(id);
    });
  }

  /** Open a specific order's collection drawer (e.g. from a scanned order QR).
   *  Best-effort merges the order's samples in case they aren't in the pending
   *  list (already collected / different lifecycle). */
  async openOrderById(id: string) {
    this.resetSeriesOverrides();
    this._openOrderId.set(id);
    this.scanValue.set("");
    try {
      const order = await firstValueFrom(
        this.api.get<Order>(`/api/orders/${id}`),
      );
      if (order?.samples?.length) {
        const have = new Set(this._pending().map((s) => s.id));
        const extras = order.samples
          .filter((s) => !have.has(s.id))
          .map((s) => ({ ...s, order }) as OrderSample);
        if (extras.length) this._pending.update((cur) => [...cur, ...extras]);
      }
    } catch {
      /* drawer still shows any pending samples for this order */
    }
    // The loader under the drawer waits on activeGroup(). If the order has
    // nothing collectable AND nothing merged (bad id, fully processed order),
    // activeGroup stays null and the deep-link page would spin forever —
    // bail back to where the user came from instead.
    if (!this.activeGroup()) {
      this.toasts.warning("Nothing left to collect on this order.");
      this.close();
    }
  }

  /** Resolve a scanned order QR / URL / GUID / invoice number to an order and
   *  open it. Uses the collector-accessible resolve endpoint. */
  private resolveOrderCode(code: string) {
    this.api
      .get<{
        orderId: string;
      }>(`/api/orders/resolve?code=${encodeURIComponent(code)}`)
      .subscribe({
        next: (r) => {
          if (r?.orderId) this.openOrderById(r.orderId);
          else this.toasts.warning("No matching order for that scan.");
        },
        error: () => this.toasts.warning("No matching order for that scan."),
      });
  }
  close() {
    const open = this._openOrderId();
    const shut = () => {
      if (this._openOrderId() !== open) return;   // another order opened meanwhile
      this.resetSeriesOverrides();
      this.vialFilter.set('all');
      this.samplesOpen.set(false);
      this.actionsOpen.set(false);
      this._openOrderId.set(null);
    };
    // Back to the list it was opened from: reverse the zoom. Leaving for the
    // front desk is a step → step slide (router), so shut instantly there.
    if (this._returnTo) shut(); else this.zoom.runLocal('out', shut);
    // Deep-linked from another screen (FD "Collect Sample") — return there
    // rather than leaving the user on an unrelated queue.
    if (this._returnTo) {
      const target = this._returnTo;
      this._returnTo = null;
      this.router.navigateByUrl(target);
      return;
    }
    // Refresh once the drawer is gone so the pending queue outside drops any
    // orders that are now fully collected. While the drawer is open we never
    // re-fetch from the server — pending-collection omits drawn samples, and
    // reading that list would make just-tapped vials vanish mid-flow.
    this.refresh();
  }

  refresh() {
    this.api.get<OrderSample[]>("/api/samples/pending-collection").subscribe({
      next: (l) => this._pending.set(l ?? []),
    });
  }

  /** Print every tube label for this order (barcode + QR). The hidden
   *  `.pf-print-label` block in the drawer already holds the rendered labels;
   *  `printTubeLabels()` prints each label on its own W×H mm page so ONLY those
   *  labels reach paper — nothing else on the screen prints. */
  printLabels(g: OrderGroup) {
    if (!g.samples.length) {
      this.toasts.warning("No tubes to label");
      return;
    }
    if (this.printer.directPrintAvailable()) {
      void this.directPrint(g);
      return;
    }
    printTubeLabels();
  }

  /** Render each tube label at the branch's configured size + single code and
   *  stream it straight to the label printer (Electron USB / iPad BLE). */
  private async directPrint(g: OrderGroup) {
    const opts = this.printConfig.labelOpts();
    this.toasts.info(
      `Printing ${g.samples.length} label${g.samples.length > 1 ? "s" : ""}…`,
    );
    let ok = 0,
      fail = 0;
    for (const s of g.samples) {
      const p = s.order?.patient;
      const code = s.barcode ?? s.id;
      const mrn = p?.mrn ?? undefined;
      const res = await this.printer
        .printLabelData(
          {
            code,
            qrValue: mrn ? `${mrn}|${code}` : code,
            // Just the name — age/sex + MRN print as their own lines below, so the
            // combined "name | age/sex | id" string would duplicate them.
            patientName: (p && patientDisplayName(p)) || g.patientName,
            ageSex: this.labelAgeSex(p),
            mrn,
            deptCode: tubeDepartmentCodes(s),
            tube: labelTubeLine(s),
            outsourced: !!s.outsourcedVendorId,
          },
          opts,
        )
        .catch((e: unknown) => ({
          ok: false,
          direct: true,
          error: (e as Error)?.message,
        }));
      if (res.ok) ok++;
      else {
        fail++;
        if (res.error) this.toasts.error(res.error);
      }
    }
    if (ok) this.toasts.success(`Printed ${ok} label${ok > 1 ? "s" : ""}`);
    else if (fail) this.toasts.error("Label print failed");
  }

  private labelAgeSex(
    p:
      | {
          age?: number | null;
          dateOfBirth?: string | null;
          sex?: string | null;
        }
      | null
      | undefined,
  ): string {
    if (!p) return "";
    let age = p.age ?? null;
    if (age == null && p.dateOfBirth) {
      const d = new Date(p.dateOfBirth),
        now = new Date();
      age = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    }
    const s = p.sex ? p.sex.charAt(0).toUpperCase() : "";
    return [age != null ? `${age}Y` : null, s].filter(Boolean).join(" ");
  }

  openScanner() {
    this.scannerOpen.set(true);
  }
  onScanMatched(code: string) {
    this.scannerOpen.set(false);
    this.scanValue.set(code);
    this.runSearch();
  }

  /**
   * Free-text search: live-filters the local pending list while typing,
   * then on Enter does an exact-barcode lookup if the input
   * looks like a code (e.g. starts with "PF-"). Patient name / phone / order
   * id matches are handled in-memory against `groups()` since the backend
   * already streams every pending order to this screen.
   */
  onSearchInput(v: string) {
    this.scanValue.set(v);
  }

  runSearch() {
    const raw = this.scanValue().trim();
    if (!raw) return;

    // Filter the visible queue — works for name, phone, order-id prefix.
    const matches = this.matchGroups(raw);
    if (matches.length === 1) {
      // Single hit → open it.
      this._openOrderId.set(matches[0].orderId);
      this.scanValue.set("");
      return;
    }

    if (matches.length === 0) {
      // Sample vial barcode (PF-… / long digits) → exact barcode lookup.
      if (this.looksLikeBarcode(raw)) {
        this.findByBarcode();
        return;
      }
      // Otherwise treat it as an order QR / URL / GUID / invoice number.
      this.resolveOrderCode(raw);
      return;
    }
    // Multiple in-list matches → user keeps typing; the live filter is
    // surfaced via filteredGroups() in the template.
  }

  private looksLikeBarcode(s: string): boolean {
    return /^PF-/i.test(s) || /^[0-9]{6,}$/.test(s);
  }

  private matchGroups(query: string): OrderGroup[] {
    const q = query.toLowerCase();
    return this.groups().filter((g) => {
      if (g.patientName.toLowerCase().includes(q)) return true;
      if (g.orderId.toLowerCase().startsWith(q.replace(/^#/, ""))) return true;
      return g.samples.some(
        (s) =>
          (s.barcode ?? "").toLowerCase().includes(q) ||
          (s.order?.patient?.phone ?? "").includes(query) ||
          (s.order?.patient?.mrn ?? "").toLowerCase().includes(q),
      );
    });
  }

  findByBarcode() {
    const code = this.scanValue().trim();
    if (!code) return;
    this.api
      .get<OrderSample>(`/api/samples/by-barcode/${encodeURIComponent(code)}`)
      .subscribe({
        next: (s) => {
          if (s) {
            this._openOrderId.set(s.orderId);
            this.scanValue.set("");
          }
        },
        error: () => {
          this.toasts.error("No sample with that barcode");
        },
      });
  }

  /**
   * Tap toggles the vial: pending → collected, or collected → pending when
   * the tube hasn't moved past the counter yet. Refusals (rejected/in_transit
   * /received) are no-ops. While the drawer is open we never re-fetch from
   * /api/samples/pending-collection, since that endpoint strips drawn vials
   * and would make the one just tapped vanish mid-animation.
   */
  toggleCollected(s: OrderSample) {
    if (s.status === "pending") {
      this.markCollected(s);
      return;
    }
    if (s.status === "collected") {
      this.markPending(s);
      return;
    }
    // "Can't collect" tube: the patient is back → offer Recollect (the tube
    // returns to pending with the same barcode — it was never drawn).
    if (isNotCollected(s)) {
      void this.recollect(s);
      return;
    }
    // Auto-receive workflows have NO dispatch step: collection immediately marks
    // the tube 'received' at the lab. The front desk must still be able to undo a
    // mis-tap, so treat an auto-received tube as un-collectable here — the backend
    // reverses the auto-receipt. Genuine dispatch-workflow receipts stay locked.
    if (s.status === "received" && !this.dispatchStep()) {
      this.markPending(s);
      return;
    }
    // dispatched / picked_up / processing / rejected / validated → locked.
  }

  private markCollected(s: OrderSample) {
    const now = new Date().toISOString();
    this._pending.update((list) =>
      list.map((x) =>
        x.id === s.id ? { ...x, status: "collected", collectedAt: now } : x,
      ),
    );

    this.api.patch<OrderSample>(`/api/samples/${s.id}/collect`).subscribe({
      next: () => {
        this.sampleCollected.emit();
      },
      error: (e) => {
        // Only roll back if the local state still says 'collected'. If the
        // user has already toggled away (rapid tap-back), respect their newer
        // intent — its own PATCH will reconcile against the server.
        const current = this._pending().find((x) => x.id === s.id);
        if (current?.status !== "collected") return;
        this._pending.update((list) =>
          list.map((x) =>
            x.id === s.id
              ? { ...x, status: "pending", collectedAt: undefined }
              : x,
          ),
        );
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  private markPending(s: OrderSample) {
    const prev = { status: s.status, collectedAt: s.collectedAt };
    this._pending.update((list) =>
      list.map((x) =>
        x.id === s.id ? { ...x, status: "pending", collectedAt: undefined } : x,
      ),
    );

    this.api.patch<OrderSample>(`/api/samples/${s.id}/uncollect`).subscribe({
      error: (e) => {
        // Same guard as markCollected: only roll back if local state still
        // matches what we attempted, so a fast re-tap isn't fought by the
        // first request's late failure.
        const current = this._pending().find((x) => x.id === s.id);
        if (current?.status !== "pending") return;
        this._pending.update((list) =>
          list.map((x) => (x.id === s.id ? { ...x, ...prev } : x)),
        );
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  /** Open the structured rejection picker for the active order. */
  rejectOrder(g: OrderGroup) {
    const pending = g.samples.filter((s) => s.status === "pending");
    if (pending.length === 0) return;
    this._rejectModal.set({ group: g, reason: "", note: "" });
  }

  setRejectReason(code: string) {
    this._rejectModal.update((m) => (m ? { ...m, reason: code } : m));
  }
  setRejectNote(v: string) {
    this._rejectModal.update((m) => (m ? { ...m, note: v } : m));
  }
  cancelReject() {
    this._rejectModal.set(null);
  }
  pendingCount(g: OrderGroup): number {
    return g.samples.filter((s) => s.status === "pending").length;
  }
  canSubmitReject(): boolean {
    const m = this._rejectModal();
    if (!m || !m.reason) return false;
    if (m.reason === "other" && m.note.trim().length === 0) return false;
    return true;
  }

  /** True while the "Can't collect" submit is in flight (no double submit). */
  protected readonly rejectBusy = signal(false);

  /**
   * "Can't collect" submit (QA #6). Marks every pending tube on the order NOT
   * COLLECTED with the reason (PATCH /api/samples/{id}/reject — the server
   * keeps it as 'rejected' with no collection stamp), then:
   *   - reflects the new state locally (tube shows "Not collected — reason"),
   *   - toasts what happened,
   *   - returns to where the user came from (the Frontdesk for a deep link),
   *     or back to the collection queue.
   * The old code cleared the open order without navigating: on a deep link
   * (FD "Collect" → /lab/collect?orderId=…) the queue is suppressed, so the
   * page fell into the "Opening collection…" skeleton for ever — the BLANK
   * PAGE. When every PATCH fails nothing changed: the dialog stays open with
   * the error so the user can retry or cancel.
   */
  async submitReject() {
    const m = this._rejectModal();
    if (!m || !this.canSubmitReject() || this.rejectBusy()) return;
    const label =
      this.REJECT_REASONS.find((r) => r.code === m.reason)?.label ?? m.reason;
    const reason =
      m.note.trim().length > 0 ? `${label} — ${m.note.trim()}` : label;
    const pending = m.group.samples.filter((s) => s.status === "pending");
    if (pending.length === 0) {
      this._rejectModal.set(null);
      return;
    }
    this.rejectBusy.set(true);
    const results = await Promise.all(
      pending.map((s) =>
        firstValueFrom(
          this.api.patch<OrderSample>(`/api/samples/${s.id}/reject`, { reason }),
        )
          .then(() => ({ id: s.id, error: null as ApiError | null }))
          .catch((e) => ({ id: s.id, error: ApiError.from(e) })),
      ),
    );
    this.rejectBusy.set(false);
    const done = new Set(results.filter((r) => !r.error).map((r) => r.id));
    const failed = results.filter((r) => !!r.error);
    if (done.size === 0) {
      this.toasts.error(failed[0]?.error?.message ?? "Could not mark the tubes not collected");
      return;
    }
    this._pending.update((list) =>
      list.map((x) =>
        done.has(x.id)
          ? { ...x, status: "rejected", rejectedReason: reason, collectedAt: undefined }
          : x,
      ),
    );
    const n = done.size;
    this.toasts.success(
      `${n} tube${n === 1 ? "" : "s"} marked not collected — ${label}`,
    );
    if (failed.length) this.toasts.error(failed[0].error!.message);
    this._rejectModal.set(null);
    this.sampleCollected.emit();
    // All marked → back to the Frontdesk (deep link) or the queue — never a
    // dead page. Some failed → stay and refresh so the desk sees what's left.
    if (failed.length === 0) this.close();
    else this.refresh();
  }

  /** Recollect a "Can't collect" tube — the patient is back. The tube returns
   *  to pending (back in the collection queue) and can be drawn right here. */
  async recollect(s: OrderSample) {
    const ok = await this.dialog.confirm({
      title: "Recollect this tube?",
      message: `It was marked not collected${s.rejectedReason ? ` (${s.rejectedReason})` : ""}. It goes back to pending so you can draw it now.`,
      confirmLabel: "Recollect",
      tone: "primary",
    });
    if (!ok) return;
    try {
      await firstValueFrom(
        this.api.patch<OrderSample>(`/api/samples/${s.id}/recollect`, {}),
      );
      this._pending.update((list) =>
        list.map((x) =>
          x.id === s.id ? { ...x, status: "pending", rejectedReason: undefined } : x,
        ),
      );
      this.toasts.success("Back to pending — tap the tube when drawn");
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    }
  }

  // Original free-text dialog kept as fallback for any other call sites.
  async legacyRejectOrder(g: OrderGroup) {
    const pending = g.samples.filter((s) => s.status === "pending");
    if (pending.length === 0) return;
    const reason = await this.dialog.prompt({
      title: `Can't collect for ${g.patientName}?`,
      message: `Flags ${pending.length} pending vial${pending.length === 1 ? "" : "s"} for re-collection.`,
      placeholder: "Patient refused, vein not found, wrong tube, …",
      multiline: true,
      required: true,
      tone: "danger",
      confirmLabel: "Reject vials",
    });
    if (!reason) return;
    const failures = await Promise.all(
      pending.map((s) =>
        firstValueFrom(
          this.api.patch(`/api/samples/${s.id}/reject`, { reason }),
        )
          .then(() => null)
          .catch((e) => ApiError.from(e)),
      ),
    );
    const failed = failures.filter((e): e is ApiError => e !== null);
    if (failed.length < pending.length)
      this.toasts.success("Marked for re-collection");
    if (failed.length) this.toasts.error(failed[0].message);
    // close(), not a bare _openOrderId reset: a deep link must navigate back
    // (the bare reset stranded it on the loader — QA #6).
    this.close();
  }
}
