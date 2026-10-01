import { RegnoPromptComponent } from '../../../shared/components/regno-prompt/regno-prompt.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { CriticalAckStripComponent } from '../../../shared/components/critical-ack-strip/critical-ack-strip.component';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { CriticalResultEvent } from '../../../shared/models/critical-result.model';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { effectiveHidden, hasEnteredValue, resolvePrintPicker, resolvePrintPickerDefault } from "../../../shared/utils/print-picker";
import { TrendTest } from "../../../shared/utils/trend-chart";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { combineLatest } from "rxjs";
import {
  describeAllRanges,
  normalizeSex,
  selectReferenceRange,
  isLegacyGroup,
  summarizeRanges,
} from "../../../shared/utils/reference-range";
import { criticalBadge, flagChipTitle, flagCodeOf, liveFlag, parseResultSnapshot, savedFlagOf } from "../../../shared/utils/result-flag";
import { effectiveMethodology } from "../../../shared/utils/methodology";
import { choiceOptionsFor, isMultiChoice, resolveParamEntryKind } from "../../../shared/utils/param-entry-kind";
import { readParameters } from "../../../shared/utils/test-parameters";
import { ageInYears, bandAgeYears } from "../../../shared/utils/patient-age";
import {
  CalcContext,
  CalcDef,
  evaluateCalc,
  parseCalc,
} from "../../../shared/utils/calculation";
import { TenantStateService } from "../../../core/services/tenant-state.service";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ApiService } from "../../../core/services/api.service";
import { ToastService } from "../../../core/services/toast.service";
import { NavBackService } from "../../../core/services/nav-back.service";
import { PlatformService } from "../../../core/services/platform.service";
import { UploadsService } from "../../../core/services/uploads.service";
import { isPrivateUploadPath } from "../../../shared/utils/upload-fetch";
import { AuthService } from "../../../core/auth/auth.service";
import { DialogService } from "../../../core/services/dialog.service";
import {
  OrderSample,
  OrderTest,
  logicalTestCount,
  sortTestsForDisplay,
} from "../../../shared/models/order.model";
import {
  TestParameter,
  TestParametersBlob,
} from "../../../shared/models/test.model";
import { OrderTestComment } from "../../../shared/models/comment.model";
import { ApiError } from "../../../shared/models/api-response.model";
import { CommentThreadComponent } from "../../../shared/components/comment-thread/comment-thread.component";
import { SelectComponent } from "../../../shared/primitives/select.component";
import { formatPatientMeta, patientDisplayName } from "../../../shared/models/patient.model";
import { HeroBandComponent } from "../../../shared/components/hero-band/hero-band.component";
import { ZoomTransitionService } from "../../../core/navigation/zoom-transition";
import { ZoomTargetDirective } from "../../../core/navigation/zoom.directive";
import { NumpadDirective, NumpadScopeDirective } from "../../../shared/components/numpad/numpad.directive";
import { outsourcedChip, splitOutsourced } from "./outsourced-lines";
import { chosenSpecimen } from "../../../shared/utils/micro-specimen";
import { normalizePriority } from "../../../shared/utils/lab-priority";
import { DraftShelfService } from "../../../core/services/draft-shelf.service";
import {
  MissingEntry,
  TabSnapshot,
  ValuesMap,
  invalidNumbers,
  isFilled,
  isWritableTest,
  missingEntries,
  missingLine,
  overlayDraft,
  prefillFromTests,
  tabMark,
  tabPayload,
  boldFromTests,
  type BoldMap,
} from "./submit-all";
import { ReportPrestoreService } from '../../../core/services/report-prestore.service';
import { formatDate } from "@angular/common";
import { LAB_TIME_ZONE } from "../../../shared/utils/lab-clock";
import { InstrumentsApiService } from "../../../shared/instruments/instruments-api.service";
import type { RunDto } from "../../../shared/instruments/instrument.models";
import {
  AnalyzerBadge,
  AppliedMap,
  PrefillLine,
  analyzerBadge,
  defaultRun,
  planPrefill,
  runOptions,
} from "../../../shared/instruments/instrument-prefill";
import { ReportNotesStore } from '../../../shared/components/report-note/report-notes.store';
import { ReportNoteButtonComponent, ReportNoteSlotComponent } from '../../../shared/components/report-note/report-note-slot.component';
import { ReportNotesCardComponent } from '../../../shared/components/report-note/report-notes-card.component';
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';


/** Live flag preview beside a numeric input — client mirror only; the
 *  backend conditions engine still decides the persisted/reported flag. */
interface LiveFlag {
  tone: "critical" | "low" | "high" | "normal";
  label: string;
}

interface BulkSubmitResponse {
  sample: OrderSample;
  submitted: number;
  results: Array<{
    orderTest: OrderTest;
    flags: { critical: boolean; notifications: string[] };
  }>;
}

/** Generic single-value field used when a (non-culture) test has no parameter
 *  schema configured, so the tech can still enter and submit a result. Stored
 *  under the `result` key — humanises to "Result" in the report. */
function defaultResultParam(): TestParameter {
  return { id: "result", name: "result", title: "Result", type: "text" };
}

/** Identity of one calculated input field (override tracking). */
function calcKey(testId: string, paramName: string): string {
  return `${testId}::${paramName}`;
}

/**
 * Sample-level result entry. One barcode scan loads ALL tests on the
 * tube; tech enters every value in one screen and submits once. Backend
 * runs the conditions engine per test and returns combined flags.
 *
 * The unit of work is the tube, not the individual test — see Fix 6 in
 * the brief that introduced this view.
 */
@Component({
  selector: "pf-sample-result-entry",
  standalone: true,
  imports: [
    DailyNoComponent,
    CommonModule,
    FormsModule,
    CommentThreadComponent,
    RegnoPromptComponent,
    CriticalAckStripComponent,
    SelectComponent,
    HeroBandComponent,
    ZoomTargetDirective,
    NumpadDirective,
    NumpadScopeDirective,
    BusyDirective,
    ReportNoteButtonComponent,
    ReportNoteSlotComponent,
    ReportNotesCardComponent,
  ],
  // Technician report notes (Lab settings switch) — one store per screen.
  providers: [ReportNotesStore],
  templateUrl: "./sample-result-entry.component.html",
  styleUrl: "./sample-result-entry.component.scss",
})
export class SampleResultEntryComponent {
  private readonly host = inject(ElementRef);
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly uploads = inject(UploadsService);
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  /** Technician notes that print on the report (per line, profile,
   *  department and the whole order) — see ReportNotesStore. */
  protected readonly notes = inject(ReportNotesStore);
  private readonly router = inject(Router);
  protected readonly navBack = inject(NavBackService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly tenantState = inject(TenantStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly draftShelf = inject(DraftShelfService);
  private readonly criticalSvc = inject(CriticalResultsService);
  private readonly instrumentsApi = inject(InstrumentsApiService);

  // ── New-design frame (docs/ND-PATTERN.md → "Result entry") ──────────
  /** The route's sample id, known before the tube loads — the RESULTS
   *  skeleton is the zoom target so the queue tile can morph into it. */
  readonly routeSampleId = signal<string | null>(null);
  /** Keys the list tile answers to (core/navigation/zoom.directive). */
  readonly zoomKeys = computed(() => [this.routeSampleId(), this._sample()?.id]);
  /** Keep the skeleton up while the zoom morphs into it: swapping the named
   *  card mid-animation cuts the transition short. */
  private readonly zoom = inject(ZoomTransitionService);
  readonly showSkeleton = computed(() => this.loading() || this.zoom.holding());

  /** Full patient name — never cut in code (ND rule 5). */
  readonly patientName = computed(() => patientDisplayName(this._sample()?.order?.patient) || "Patient");
  /** The ORDER priority is Urgent (urgent / STAT) — the lab has Urgent / Normal only. */
  readonly urgent = computed(() => normalizePriority(this._sample()?.order?.priority) === "urgent");
  /** "29/M · AA0012". */
  readonly patientMeta = computed(() => formatPatientMeta(this._sample()?.order?.patient));

  /** Tube tabs of this order in a FIXED order: the order's sample sequence
   *  (series offset, then sample ID — the same order the server lists
   *  siblings in). Switching tubes never reorders them; only the selected
   *  indicator moves. Kept across a switch so the strip never blinks. */
  private readonly _tubeTabs = signal<Array<{ id: string; barcode: string; tests: string; open: boolean }>>([]);
  readonly tubeTabs = this._tubeTabs.asReadonly();
  /** The selected tab — set on tap, before the tube loads. */
  readonly activeTubeId = computed(() => this.routeSampleId() ?? this._sample()?.id ?? null);

  private syncTubeTabs(s: OrderSample | null) {
    if (!s?.siblings?.length) { this._tubeTabs.set([]); return; }
    const self = {
      id: s.id, barcode: s.barcode || "", tests: this.headerChips().join(", "), open: false,
      off: s.repeatOffsetMin ?? -1,
    };
    const rest = s.siblings.map((sb) => ({
      id: sb.id, barcode: sb.barcode || "", tests: sb.tests.join(", "), open: !!sb.hasOpenWork,
      off: sb.repeatOffsetMin ?? -1,
    }));
    const all = [self, ...rest].sort((a, b) =>
      (a.off - b.off) || a.barcode.localeCompare(b.barcode, undefined, { numeric: true }) || a.id.localeCompare(b.id));
    this._tubeTabs.set(all.map(({ off: _off, ...t }) => t));
  }

  /** The sliding selected-tab indicator: measured after render and written
   *  straight to the DOM (no signal → no extra change detection). */
  private readonly tabsEl = viewChild<ElementRef<HTMLElement>>("tabsEl");
  private placeTabIndicator() {
    const host = this.tabsEl()?.nativeElement;
    if (!host) return;
    const ind = host.querySelector<HTMLElement>(".pf-sre-tabs__ind");
    const act = host.querySelector<HTMLElement>('.pf-sre-tab[aria-selected="true"]');
    if (!ind || !act || !act.offsetWidth) {
      host.classList.remove("pf-sre-tabs--ind", "pf-sre-tabs--anim");
      return;
    }
    // Slide only once the indicator has a position to slide FROM.
    if (host.classList.contains("pf-sre-tabs--ind")) host.classList.add("pf-sre-tabs--anim");
    ind.style.width = `${act.offsetWidth}px`;
    ind.style.height = `${act.offsetHeight}px`;
    ind.style.transform = `translate(${act.offsetLeft}px, ${act.offsetTop}px)`;
    host.classList.add("pf-sre-tabs--ind");
  }

  /** PHONES: the sample-ID chip doubles as the tube switcher. */
  readonly tubeMenuOpen = signal(false);
  readonly activeBarcode = computed(() => {
    const id = this.activeTubeId();
    return this._tubeTabs().find((t) => t.id === id)?.barcode || this._sample()?.barcode || "—";
  });
  pickTube(id: string) {
    this.tubeMenuOpen.set(false);
    void this.openSibling(id);
  }

  // ── PHONES: the per-row "i" peek (range · unit · method) ────────────
  private readonly _info = signal<string | null>(null);
  private infoTimer: ReturnType<typeof setTimeout> | null = null;
  hasInfo(t: OrderTest, p: TestParameter): boolean {
    return !!this.refLabelFor(p) || !!p.unit || this.methodologyOf(p, t.test) !== "—";
  }
  infoOpen(testId: string, name: string): boolean {
    return this._info() === `${testId}::${name}`;
  }
  /** One peek at a time; a second tap closes; auto-hides after ~4s. The
   *  peek is a BODY-level portal (position: fixed), so no card, scroller or
   *  transformed ancestor can clip it; it sits below the icon, flips above
   *  when there's no room, and always stays 16px inside the viewport. */
  toggleInfo(t: OrderTest, p: TestParameter, anchor?: HTMLElement | null) {
    const k = `${t.id}::${p.name}`;
    const wasOpen = this._info() === k;
    this.closeInfo();
    if (wasOpen) return;
    if (this._lastInfoClosed === k) { this._lastInfoClosed = null; return; }
    this._info.set(k);
    this.renderPeek(t, p, anchor ?? null);
    this.infoTimer = setTimeout(() => this.closeInfo(), 4000);
  }
  private _lastInfoClosed: string | null = null;
  private peekEl: HTMLElement | null = null;
  private readonly onPeekScroll = () => this.closeInfo();

  private renderPeek(t: OrderTest, p: TestParameter, anchor: HTMLElement | null) {
    if (typeof document === "undefined") return;
    const rows: Array<[string, string]> = [];
    const range = this.refLabelFor(p);
    const method = this.methodologyOf(p, t.test);
    if (range) rows.push(["Range", range]);
    if (p.unit) rows.push(["Unit", p.unit]);
    if (method !== "—") rows.push(["Method", method]);
    const el = document.createElement("div");
    el.className = "pf-sre-peek";
    el.setAttribute("role", "tooltip");
    // Property by property: one value a parser doesn't know must not drop
    // the rest (cssText is all-or-nothing in some engines).
    const style: Array<[string, string]> = [
      ["position", "fixed"], ["z-index", "2000"], ["top", "0px"], ["left", "0px"], ["box-sizing", "border-box"],
      ["width", "min(300px, calc(100vw - 32px))"], ["padding", "10px 12px"],
      ["display", "flex"], ["flex-direction", "column"], ["gap", "6px"],
      ["border-radius", "var(--nd-radius-sm, 10px)"], ["background", "var(--nd-card-bg, #fff)"],
      ["border", "1px solid var(--nd-line, #e5e7eb)"], ["box-shadow", "0 12px 32px rgba(15, 23, 42, 0.22)"],
      ["font-family", "inherit"], ["font-size", "12.5px"], ["line-height", "1.45"], ["color", "var(--text-primary)"],
      ["white-space", "normal"], ["overflow-wrap", "break-word"], ["pointer-events", "auto"],
    ];
    for (const [k, v] of style) el.style.setProperty(k, v);
    for (const [key, val] of rows) {
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:56px minmax(0,1fr);column-gap:8px";
      const kEl = document.createElement("span");
      kEl.textContent = key;
      kEl.style.cssText = "color:var(--text-muted);font-size:11.5px";
      const vEl = document.createElement("span");
      vEl.textContent = val;
      vEl.style.cssText = "font-variant-numeric:tabular-nums;white-space:pre-line";
      row.append(kEl, vEl);
      el.append(row);
    }
    document.body.appendChild(el);
    this.peekEl = el;
    // Place: under the icon, right-aligned to it; flip above if needed;
    // clamp into the viewport with 16px margins.
    const M = 16, GAP = 6;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const r = anchor?.getBoundingClientRect() ?? { top: M, bottom: M, left: M, right: vw - M } as DOMRect;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = r.right - w;
    left = Math.max(M, Math.min(left, vw - M - w));
    let top = r.bottom + GAP;
    let above = false;
    if (top + h > vh - M && r.top - GAP - h >= M) { top = r.top - GAP - h; above = true; }
    top = Math.max(M, Math.min(top, vh - M - h));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.transformOrigin = above ? "bottom right" : "top right";
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && typeof el.animate === "function") {
      el.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }],
        { duration: 200, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
    }
    window.addEventListener("scroll", this.onPeekScroll, true);
  }

  closeInfo() {
    if (this.infoTimer !== null) { clearTimeout(this.infoTimer); this.infoTimer = null; }
    this._info.set(null);
    if (this.peekEl) {
      this.peekEl.remove();
      this.peekEl = null;
      window.removeEventListener("scroll", this.onPeekScroll, true);
    }
  }
  ngOnDestroy() {
    this.closeInfo();
    // Leaving the screen (another draft on a different route, a culture
    // redirect, the back chevron…) must never drop typing: park the pending
    // local copy and push the pending server autosave now.
    this.flushPending();
  }
  /** Tapping anywhere else closes the peek. The icon's own pointerdown is
   *  remembered so its click toggles it shut instead of re-opening. */
  @HostListener("document:pointerdown", ["$event"])
  onDocPointerDown(ev: Event) {
    const open = this._info();
    if (!open) { this._lastInfoClosed = null; return; }
    const target = ev.target as HTMLElement | null;
    if (target?.closest?.(".pf-sre-peek")) return;   // taps inside the peek keep it
    const inside = target?.closest?.(".pf-sre__info");
    this._lastInfoClosed = inside ? open : null;
    this.closeInfo();
  }

  /** Free-text / long results grow with their content. */
  autoGrow(ev: Event) {
    const el = ev.target as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  /** RESULTS card label for a grid block: the profile name, the single
   *  test's name, or "Results" for a run of single-value tests. */
  blockLabel(blk: { title?: string | null; tests: OrderTest[] }): string {
    if (blk.title) return blk.title;
    if (blk.tests.length === 1) return blk.tests[0].test?.name ?? "Test";
    return "Results";
  }

  /** Signed-in technician shown on the right of the header. Properly formats
   *  displayName or falls back to full name / 'Technician'. */
  readonly techName = computed(() => {
    const u = this.auth.user();
    if (!u) return "Technician";
    const name =
      u.displayName?.trim() ||
      [u.firstName, u.fathersName].filter(Boolean).join(" ").trim();
    return name || "Technician";
  });

  /** Restricts keydown events for numeric parameters to valid numbers (digits 0-9, decimal point, minus) and navigation keys, preventing letter input. */
  allowOnlyNumbers(event: KeyboardEvent) {
    const key = event.key;
    // Allow control & navigation keys
    if (
      [
        "Backspace",
        "Tab",
        "Enter",
        "Escape",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(key) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target as HTMLInputElement | null;
    const val = target?.value || "";

    // Allow decimal point if not already in value
    if (key === "." && !val.includes(".")) {
      return;
    }
    // Allow minus sign if not already in value
    if (key === "-" && !val.includes("-")) {
      return;
    }
    // Block non-digit keys
    if (!/^[0-9]$/.test(key)) {
      event.preventDefault();
    }
  }

  /** Paste into a numeric field: strip everything that isn't a digit, dot or
   *  leading minus so "one hundred" or "12 mg/dL" can never land as the raw
   *  value. A clean numeric paste falls through to the browser default. */
  onNumericPaste(event: ClipboardEvent, testId: string, paramName: string) {
    const input = event.target as HTMLInputElement | null;
    const raw = event.clipboardData?.getData("text") ?? "";
    let cleaned = raw.replace(/[^0-9.\-]/g, "");
    const neg = cleaned.startsWith("-");
    cleaned = cleaned.replace(/-/g, "");
    const [head, ...rest] = cleaned.split(".");
    cleaned =
      (neg ? "-" : "") + head + (rest.length ? "." + rest.join("") : "");
    if (cleaned === raw) return; // already numeric — let the default paste run
    event.preventDefault();
    if (!input) return;
    let next = cleaned;
    try {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      next = input.value.slice(0, start) + cleaned + input.value.slice(end);
    } catch {
      /* selection API unavailable on this input type — replace wholesale */
    }
    input.value = next;
    this.setValue(testId, paramName, next);
  }

  // ── Live out-of-range / critical preview ──────────────────────────
  /** Patient sex/age (from the loaded order) for reference-band selection. */
  private patientSexAge(): {
    sex: "M" | "F" | "O" | null;
    age: number | null;
  } {
    const p = this._sample()?.order?.patient;
    return {
      sex: normalizeSex(p?.sex),
      // DOB-derived fractional age — the server's band-pick metric.
      age: bandAgeYears(p),
    };
  }

  /** The bench chip. A value still equal to the one SAVED with the result
   *  shows mw's saved verdict (snapshot `flagged`); a value being typed gets
   *  the shared live hint — the band for THIS patient's sex/age (profile-
   *  scoped under a profile), band → param criticals (strict), then the
   *  shared in-range rule. One implementation: shared/utils/result-flag. */
  /** Chip tooltip: what H / L / critical mean (QA 2026-09-24). */
  readonly flagChipTitle = flagChipTitle;

  flagFor(t: OrderTest, p: TestParameter): LiveFlag | null {
    const kind = this.inputKindFor(p);
    if (kind !== "select" && kind !== "number") return null;
    const raw = this.getValue(t.id, p.name);
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    const saved = savedFlagOf(parseResultSnapshot(t.currentResult), p.name);
    if (saved && saved.flag != null && String(saved.value ?? "") === String(raw)) {
      const code = flagCodeOf(saved.flag);
      // Lab badge keeps the direction: CL / CH (legacy rows: C).
      const crit = criticalBadge(code);
      if (crit) return { tone: "critical", label: crit };
      if (code === "L") return { tone: "low", label: "Low" };
      if (code === "H") return { tone: "high", label: "High" };
      if (code === "A") return { tone: "high", label: "Abnormal" };
      return null;
    }
    if (kind === "select") return this.qualitativeFlagFor(t, p);
    const v = Number(String(raw).trim());
    if (Number.isNaN(v)) return null;
    const { sex, age } = this.patientSexAge();
    const lf = liveFlag(p, v, sex, age, t.profileCode);
    if (lf?.code === "CL" || lf?.code === "CH")
      return { tone: "critical", label: `${lf.code} · ${lf.code === "CL" ? "below" : "above"} ${lf.limit}` };
    if (lf?.code === "L") return { tone: "low", label: "Low" };
    if (lf?.code === "H") return { tone: "high", label: "High" };
    return null;
  }

  /** Dropdown normality: the LIVE option table's normal rows decide (an
   *  empty normal set means every option is abnormal — e.g. pathogen lists);
   *  parameters without a table fall back to normalValue, which may name
   *  several normals joined with "/". Mirrors mw ResultFlaggingService. */
  private qualitativeFlagFor(t: OrderTest, p: TestParameter): LiveFlag | null {
    const raw = this.getValue(t.id, p.name);
    // A multi-select holds several picks: abnormal when ANY pick is not normal.
    const picks = (Array.isArray(raw) ? raw : [raw])
      .map((x) => (x === undefined || x === null ? "" : String(x).trim().toLowerCase()))
      .filter((x) => x !== "");
    if (!picks.length) return null;
    // The embedded table's Normal rows decide; normalValue is the fallback
    // for legacy parameters. No normals configured = not flaggable (e.g.
    // stone colours, which have no clinical "normal").
    let normals = (p.optionRows ?? [])
      .filter(r => r.normal === true && r.active !== false)
      .map(r => r.value);
    if (!normals.length) {
      const nv = (p.normalValue ?? "").trim();
      if (!nv) return null;
      normals = nv.split("/").map(x => x.trim()).filter(Boolean);
    }
    const isNormal = picks.every(v => normals.some(n => n.toLowerCase() === v));
    return isNormal
      ? null
      : { tone: "high", label: "Abnormal" };
  }

  /** Red input treatment — reserved for critical values only. */
  isCriticalValue(t: OrderTest, p: TestParameter): boolean {
    return this.flagFor(t, p)?.tone === "critical";
  }

  /** Softer amber input tint for plain high/low (distinct from critical red). */
  isOutOfRange(t: OrderTest, p: TestParameter): boolean {
    const tone = this.flagFor(t, p)?.tone;
    return tone === "low" || tone === "high";
  }

  /** A numeric parameter holding a non-parseable value (should be near-
   *  impossible past the keydown/paste guards, but IME/autofill can slip
   *  through). Shown as a subtle invalid state and blocks submit. */
  isInvalidNumber(t: OrderTest, p: TestParameter): boolean {
    if (this.inputKindFor(p) !== "number") return false;
    const raw = this.getValue(t.id, p.name);
    if (raw === undefined || raw === null || raw === "") return false;
    return Number.isNaN(Number(String(raw).trim()));
  }

  /** A choice list where the tech may pick several answers (stored as string[]). */
  isMultiSelect(p: TestParameter): boolean {
    return isMultiChoice(p);
  }

  /** The current picks of a multi-select (a legacy single string reads as one pick). */
  multiValuesOf(testId: string, paramName: string): string[] {
    const v = this.getValue(testId, paramName);
    if (Array.isArray(v)) return v.map((x) => String(x ?? "")).filter((x) => x.trim() !== "");
    return v === undefined || v === null || String(v).trim() === "" ? [] : [String(v)];
  }

  onMultiSelectChange(testId: string, paramName: string, values: unknown[]) {
    this.setValue(testId, paramName, (values ?? []).map((x) => String(x ?? "")).filter((x) => x.trim() !== ""));
  }

  onSelectChange(testId: string, paramName: string, value: any) {
    this.setValue(testId, paramName, String(value ?? ''));
    this.advanceFromSelect(testId, paramName);
  }

  advanceFromSelect(testId: string, paramName: string) {
    const container = this.host.nativeElement as HTMLElement;
    const inputs = this.getAllFocusableInputs(container);
    const activeTrigger = container.querySelector<HTMLElement>(
      `[data-sre-param="${testId}::${paramName}"] .pf-dd__trigger`,
    );
    if (!activeTrigger) return;
    const currentIndex = inputs.indexOf(activeTrigger);
    if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
      const next = inputs[currentIndex + 1];
      next.focus();
      if (
        next instanceof HTMLInputElement &&
        (next.type === "text" || next.type === "number")
      ) {
        next.select();
      }
      next.scrollIntoView({ block: "nearest" });
    }
  }

  private getAllFocusableInputs(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        "input.pf-sre__ginput, textarea.pf-sre__ginput, input.pf-sre__cb, .pf-sre__gselect .pf-dd__trigger",
      ),
    ).filter((el) => {
      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !el.hasAttribute("disabled")
      );
    });
  }

  /** Pressing Enter inside any result input field advances focus to the next
   *  result field in DOM sequence (like Tab), skipping edit buttons. */
  onEnterKey(event: Event) {
    event.preventDefault();
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const container = this.host.nativeElement as HTMLElement;
    const inputs = this.getAllFocusableInputs(container);

    const currentIndex = inputs.indexOf(target);
    if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
      const next = inputs[currentIndex + 1];
      next.focus();
      if (
        next instanceof HTMLInputElement &&
        (next.type === "text" || next.type === "number")
      ) {
        next.select();
      }
      // Keep the freshly-focused field visible so Enter-Enter-Enter walks the
      // whole tube without the tech ever reaching for the scrollbar.
      next.scrollIntoView({ block: "nearest" });
    } else if (inputs.length > 0) {
      // The visible Submit (side card on desktop, bottom bar on phones).
      const submits = Array.from(container.querySelectorAll<HTMLElement>(".pf-sre-submit"));
      const submitBtn = submits.find((b) => b.getClientRects().length > 0) ?? submits[0];
      if (submitBtn && !submitBtn.hasAttribute("disabled")) {
        submitBtn.focus();
      } else {
        inputs[0].focus();
      }
    }
  }
  /** Compact technician mark for the phone action bar ("AU"). */
  readonly techInitials = computed(() =>
    this.techName().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "T");

  /** Medical registration ID beside the name — a dash until the user sets one
   *  (editable on the My signature screen; a validator without one sees the
   *  pf-regno-prompt line in the strip). */
  readonly techRegId = computed(
    () => this.auth.user()?.registrationId?.trim() || "—",
  );

  /** Entry blocks for the grid view.
   *  - 'flat'  → ONE column-header strip + a sequence of rows. Used for
   *    profile/package members (titled with the profile name) AND for plain
   *    single-parameter tests (untitled — the row already names the test, so
   *    no per-test header/card).
   *  - 'card'  → the classic per-test card, kept only where it's needed:
   *    multi-parameter standalone tests, cultures, and schema-less tests. */
  /** Keep the tube's tests in their authored display order (profile member
   *  sequence), and expose the logical count (a profile counts as ONE). */
  private normalizeSample(s: OrderSample | null): OrderSample | null {
    if (!s?.tests) { this._outsourcedTests.set([]); return s; }
    // Outsourced lines (old shared tubes) never enter the editable set —
    // they render read-only with an "Outsourced · <partner>" chip.
    const { inHouse, outsourced } = splitOutsourced(s.tests, s.outsourcedVendorId);
    this._outsourcedTests.set(outsourced);
    if (outsourced.length) this.loadPartnerNames();
    return { ...s, tests: sortTestsForDisplay(inHouse) };
  }

  // ── Outsourced lines (read-only) ─────────────────────────────────────
  private readonly _outsourcedTests = signal<OrderTest[]>([]);
  readonly outsourcedTests = this._outsourcedTests.asReadonly();
  private readonly _partnerNames = signal<Record<string, string>>({});
  private partnerNamesLoaded = false;
  private loadPartnerNames() {
    if (this.partnerNamesLoaded) return;
    this.partnerNamesLoaded = true;
    this.api.get<{ id: string; name: string }[]>("/api/referral-labs?includeInactive=true").subscribe({
      next: (l) => this._partnerNames.set(Object.fromEntries((l ?? []).map((x) => [x.id, x.name]))),
      error: () => { /* chip falls back to "Outsourced" */ },
    });
  }
  outsourcedChip(t: OrderTest): string {
    return outsourcedChip(t, this._partnerNames(), this._sample()?.outsourcedVendorId);
  }
  readonly logicalCount = computed(() =>
    logicalTestCount(this.sample()?.tests),
  );

  /**
   * Header chips — one per LOGICAL test, matching the "N tests on this tube"
   * count beside them. A profile collapses to a single chip carrying its own
   * name; its member analytes are NOT listed here (a 20-analyte CBC used to
   * spray 20 chips across the header while the counter next to it said "1").
   * The members are already laid out in the profile's block below, which is
   * where the tech actually reads them.
   */
  /**
   * The bench grouping rule: results compile under a PROFILE, never under a
   * package. A package is a commercial wrapper — "3 profiles + 4 tests" must
   * appear as those 3 profile blocks and 4 individual tests. Nearest profile
   * (profileTestId) wins; legacy rows without it fall back by the bundle's
   * TYPE, and rows where even the type is unknown keep the old
   * group-by-bundle behaviour rather than silently splitting.
   */
  private benchGroup(t: OrderTest): { id: string; name: string } | null {
    if (t.profileTestId)
      return {
        id: t.profileTestId,
        name: t.profileName || t.packageName || "Profile",
      };
    if (!t.packageTestId) return null;
    if (t.packageType === "profile")
      return { id: t.packageTestId, name: t.packageName || "Profile" };
    if (t.packageType) return null; // known package → members stand alone
    return { id: t.packageTestId, name: t.packageName || "Profile" }; // unknown → legacy behaviour
  }

  readonly headerChips = computed<string[]>(() => {
    const out: string[] = [];
    const seenPkg = new Set<string>();
    for (const t of this.sample()?.tests ?? []) {
      const grp = this.benchGroup(t);
      if (grp) {
        if (seenPkg.has(grp.id)) continue;
        seenPkg.add(grp.id);
        out.push(grp.name);
        continue;
      }
      out.push(t.test?.shortName || t.test?.name || "Test");
    }
    return out;
  });

  readonly entryBlocks = computed<
    Array<
      | { kind: "flat"; key: string; title: string | null; tests: OrderTest[] }
      | { kind: "card"; key: string; tests: OrderTest[] }
    >
  >(() => {
    const tests = this.sample()?.tests ?? [];
    const out: Array<
      | { kind: "flat"; key: string; title: string | null; tests: OrderTest[] }
      | { kind: "card"; key: string; tests: OrderTest[] }
    > = [];
    const byPkg = new Map<
      string,
      { kind: "flat"; key: string; title: string | null; tests: OrderTest[] }
    >();
    let loose: {
      kind: "flat";
      key: string;
      title: string | null;
      tests: OrderTest[];
    } | null = null;
    for (const t of tests) {
      const rowable =
        !this.isCultureTest(t) && this.parametersFor(t).length > 0;
      const grp = this.benchGroup(t);
      if (grp) {
        if (!rowable) {
          out.push({ kind: "card", key: t.id, tests: [t] });
          continue;
        }
        let g = byPkg.get(grp.id);
        if (!g) {
          g = {
            kind: "flat",
            key: "pkg-" + grp.id,
            title: grp.name,
            tests: [],
          };
          byPkg.set(grp.id, g);
          out.push(g);
        }
        g.tests.push(t);
        continue;
      }
      if (rowable && this.parametersFor(t).length === 1) {
        if (!loose) {
          loose = { kind: "flat", key: "loose", title: null, tests: [] };
          out.push(loose);
        }
        loose.tests.push(t);
        continue;
      }
      out.push({ kind: "card", key: t.id, tests: [t] });
    }
    return out.filter((b) => b.tests.length > 0);
  });

  // ── Background autosave (manual Save draft is still available) ──────
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _autosaving = signal(false);
  readonly autosaving = this._autosaving.asReadonly();
  private readonly _lastSavedAt = signal<Date | null>(null);
  readonly lastSavedLabel = computed(() => {
    const t = this._lastSavedAt();
    if (!t) return "";
    return `Saved ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  });

  private readonly _sample = signal<OrderSample | null>(null);
  private readonly _loading = signal<boolean>(true);
  private readonly _submitting = signal<boolean>(false);
  private readonly _savingDraft = signal<boolean>(false);
  readonly savingDraft = this._savingDraft.asReadonly();
  // values per OrderTestId → param.name → value
  private readonly _values = signal<Record<string, Record<string, unknown>>>(
    {},
  );
  private readonly _flags = signal<
    Array<{ label: string; note?: string; critical: boolean }>
  >([]);

  readonly sample = this._sample.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly submitting = this._submitting.asReadonly();
  /** WHICH header action started the running `submitting()` request — only
   *  that button shows the busy dots (ND-PATTERN "Loading feedback"). */
  readonly submitAct = signal<'reopen' | 'validate' | 'reject' | 'submit' | 'all' | null>(null);

  // ── NABL critical-result records of this tube (open / acknowledged) ──
  private readonly _critical = signal<CriticalResultEvent[]>([]);
  readonly critical = this._critical.asReadonly();
  /** The channel stored on the acknowledgement: the validator's review or the bench. */
  readonly criticalVia = computed(() => (this.validateMode() ? "validate" : "result_entry") as "validate" | "result_entry");
  hasOpenCritical(t: { id: string }): boolean {
    return this._critical().some((e) => e.orderTestId === t.id && e.status === "open");
  }
  /** Every record of the tube's tests that still needs a hand — after load and after each submit. */
  loadCritical(): void {
    const ids = (this._sample()?.tests ?? []).map((t) => t.id);
    if (ids.length === 0) { this._critical.set([]); return; }
    this.criticalSvc.lookupOpen(ids).subscribe({
      next: (list) => this._critical.set(list ?? []),
      error: () => { /* the badge is advisory — the register is the record */ },
    });
  }
  onCriticalChanged(updated: CriticalResultEvent): void {
    this._critical.update((list) =>
      updated.status === "communicated" ? list.filter((e) => e.id !== updated.id) : list.map((e) => (e.id === updated.id ? updated : e)));
  }

  // ── Trendogram: add serial-result trend charts to this order's report ──
  readonly trendEligible = signal<TrendTest[]>([]);
  readonly trendogramOn = signal(false);
  readonly trendogramDuration = signal("5");
  private trendPatientId: string | null = null;

  /** This tube's lines — the report-notes card lists their departments. */
  readonly noteLineIds = computed(() => (this.sample()?.tests ?? []).map((t) => t.id));

  /** The profile a flat block prints under (server-resolved), for its
   *  "profile note" — null for a run of single tests. */
  blockProfileId(blk: { title?: string | null; tests: OrderTest[] }): string | null {
    if (!blk.title || !blk.tests.length) return null;
    return this.notes.line(blk.tests[0].id)?.profileId ?? null;
  }

  constructor() {
    // Report notes follow the order, and re-read whenever a line's status
    // changes (submit / validate / Edit result lock or unlock them).
    let notesKey = "";
    effect(() => {
      const s = this.sample();
      const oid = s?.orderId ?? s?.order?.id ?? null;
      const key = oid ? `${oid}|${(s?.tests ?? []).map((t) => `${t.id}:${t.status}`).join(",")}` : "";
      if (key === notesKey) return;
      notesKey = key;
      void this.notes.load(oid);
    });
    afterRenderEffect(() => {
      this.tubeTabs();
      this.activeTubeId();
      this.placeTabIndicator();
    });
    effect(() => {
      const pid = this.sample()?.order?.patient?.id ?? null;
      if (pid && pid !== this.trendPatientId) {
        this.trendPatientId = pid;
        this.api
          .get<{ tests: TrendTest[] }>(`/api/patients/${pid}/lab-trends`)
          .subscribe({
            next: (r) => this.trendEligible.set(r?.tests ?? []),
            error: () => this.trendEligible.set([]),
          });
      }
    });
  }

  toggleTrendogram() {
    this.trendogramOn.set(!this.trendogramOn());
    this.saveTrendogram();
  }
  setTrendDuration(d: string) {
    this.trendogramDuration.set(d);
    if (this.trendogramOn()) this.saveTrendogram();
  }
  private saveTrendogram() {
    const oid = this.sample()?.orderId ?? this.sample()?.order?.id;
    if (!oid) return;
    const body = this.trendogramOn()
      ? {
          enabled: true,
          duration: this.trendogramDuration(),
          chartType: "line",
          charts: this.trendEligible()
            .map((t) => ({
              testId: t.testId,
              parameter: t.parameters[0]?.parameter ?? "",
            }))
            .filter((c) => !!c.parameter),
        }
      : {};
    this.api.patch(`/api/orders/${oid}/trendogram`, body).subscribe({
      next: () =>
        this.toasts.success(
          this.trendogramOn()
            ? "Trendogram will be added to the report"
            : "Trendogram removed",
        ),
      error: () => this.toasts.error("Could not update trendogram"),
    });
  }

  /** A submitted (awaiting-validation) test exists → can be re-opened to edit. */
  // A finished tube is editable whether it is merely SUBMITTED or already
  // SIGNED OFF — scanning a completed sample number must offer Edit either
  // way. edit_result is held by Lab Technician, Pathologist and Lab Admin.
  readonly canEditResult = computed(() => this.auth.hasPermission("edit_result"));
  readonly hasReopenable = computed(() =>
    this.canEditResult() &&
    (this._sample()?.tests ?? []).some(
      (t) => t.status === "entered" || t.status === "validated",
    ),
  );
  /** At least one test is in an editable/submittable state. */
  readonly hasWritable = computed(() =>
    (this._sample()?.tests ?? []).some(
      (t) =>
        t.status !== "entered" &&
        t.status !== "validated" &&
        t.status !== "rejected" &&
        !this.isCultureTest(t),
    ),
  );

  /** Load each test's last saved values into the form (used on first load and
   *  after a re-open, so the prior submitted values come back for editing). */
  private prefillValues(sample: OrderSample | null) {
    // "Print in bold" picks come back with the saved result, like its values.
    this._bold.set(boldFromTests(sample?.tests ?? []));
    if (!sample?.tests) {
      this._values.set({});
      return;
    }
    const init: Record<string, Record<string, unknown>> = {};
    for (const t of sample.tests) {
      if (!t.currentResult) continue;
      try {
        init[t.id] = JSON.parse(t.currentResult)?.values ?? {};
      } catch {
        /* ignore */
      }
    }
    this._values.set(init);
  }

  /** Edit a finished tube: mandatory reason, then the server re-opens every
   *  submitted/validated result on it back to THIS tech (audited), and the
   *  values reload editable so they can correct and submit again. Works for a
   *  signed-off tube too — scanning a completed sample number lands here. */
  async reopenSample() {
    const s = this._sample();
    if (!s || this._submitting()) return;

    const reason = await this.dialog.prompt({
      title: "Edit this result?",
      message:
        "The current values stay in history and the reason is recorded in the audit trail. If a report was already released, an amended one is issued once this is validated again.",
      placeholder: "e.g. wrong sample, typo in Hb…",
      multiline: true,
      required: true,
      confirmLabel: "Edit",
    });
    if (!reason || !reason.trim()) return;

    this.submitAct.set('reopen');
    this._submitting.set(true);
    try {
      await firstValueFrom(
        this.api.post<{ reopened: number }>(
          `/api/results/tube/${s.id}/reopen-mine`,
          { reason: reason.trim() },
        ),
      );
      // Re-fetch rather than trusting the POST's shape — the tube now carries
      // fresh statuses, assignment and a new result version.
      const updated = await firstValueFrom(
        this.api.get<OrderSample>(`/api/samples/${s.id}/tests`),
      );
      if (updated) {
        this._sample.set(this.normalizeSample(updated));
        this.prefillValues(updated);
        this.seedCalcState();
      }
      this.toasts.success("Open for editing — correct the values and submit");
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._submitting.set(false);
    }
  }
  readonly lastFlags = this._flags.asReadonly();

  /** Tests on this sample that the pathologist sent back for re-entry. */
  readonly rejectedTests = computed<OrderTest[]>(() =>
    (this._sample()?.tests ?? []).filter((t) => t.status === "re_entry"),
  );

  // ── Validator ↔ tech conversation ─────────────────────────────────
  // Loaded from /api/samples/:id/comments — flat list across every
  // test in the sample. The view splits it: overall (parameterName ===
  // null) under the test header, per-parameter inline under each
  // input field. See comment.model.ts for the threading shape.
  private readonly _comments = signal<OrderTestComment[]>([]);
  readonly comments = this._comments.asReadonly();

  /** Comments for a single test, optionally filtered to one parameter. */
  commentsFor(
    testId: string,
    parameterName: string | null = null,
  ): OrderTestComment[] {
    return this._comments().filter(
      (c) =>
        c.orderTestId === testId &&
        ((parameterName === null && !c.parameterName) ||
          c.parameterName === parameterName),
    );
  }

  /** True if this parameter has at least one open thread — used to
      red-border the input so the tech focuses there. */
  /** Per-parameter note toggles — lets ANYONE start a row conversation,
   *  not just continue one that already exists (the crucial review tool:
   *  the validator questions ONE value in place, the tech answers there). */
  // ONE step (owner): the pencil opens an inline textarea under the row
  // with focus in it. Enter or blur saves, Shift+Enter is a new line, Esc
  // cancels. One quick note is open at a time.
  private readonly _quickNote = signal<{ testId: string; param: string | null } | null>(null);
  readonly quickNote = this._quickNote.asReadonly();
  private quickNoteSaving = false;
  paramNoteOpen(testId: string, name: string): boolean {
    const q = this._quickNote();
    return !!q && q.testId === testId && q.param === name;
  }
  toggleParamNote(testId: string, name: string) {
    this.openQuickNote(testId, name);
  }
  /** Stable DOM key of a quick-note box (for focus). */
  quickNoteKey(testId: string, param: string | null): string {
    return `${testId}::${param ?? ""}`;
  }
  openQuickNote(testId: string, param: string | null) {
    if (this.paramNoteOrOverallOpen(testId, param)) { this._quickNote.set(null); return; }
    this._quickNote.set({ testId, param });
    // Focus after the textarea renders — on phones this opens the keyboard.
    const key = this.quickNoteKey(testId, param);
    const focus = () => {
      const el = (this.host.nativeElement as HTMLElement)
        .querySelector<HTMLTextAreaElement>(`textarea[data-quicknote="${key}"]`);
      if (el) { el.focus(); return true; }
      return false;
    };
    queueMicrotask(() => { if (!focus()) setTimeout(focus, 0); });
  }
  private paramNoteOrOverallOpen(testId: string, param: string | null): boolean {
    const q = this._quickNote();
    return !!q && q.testId === testId && q.param === param;
  }
  cancelQuickNote() {
    this._quickNote.set(null);
  }
  /** Enter (without Shift) saves; Esc cancels. */
  onQuickNoteKey(ev: KeyboardEvent, testId: string, param: string | null) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      this.cancelQuickNote();
    } else if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void this.saveQuickNote(testId, param, (ev.target as HTMLTextAreaElement).value);
    }
  }
  /** Blur saves a non-empty note; an empty one just closes. */
  onQuickNoteBlur(testId: string, param: string | null, value: string) {
    if (!this.paramNoteOrOverallOpen(testId, param)) return;   // already saved / cancelled
    if (!value.trim()) { this.cancelQuickNote(); return; }
    void this.saveQuickNote(testId, param, value);
  }
  async saveQuickNote(testId: string, param: string | null, value: string) {
    const body = value.trim();
    if (this.quickNoteSaving) return;
    this._quickNote.set(null);
    if (!body) return;
    this.quickNoteSaving = true;
    const type = this.commentRole() === "validator" ? "correction" : "observation";
    try {
      if (param) await this.addParameterComment(testId, param, body, type);
      else await this.addOverallComment(testId, body, type);
    } finally {
      this.quickNoteSaving = false;
    }
  }
  /** Comments author role follows the screen mode. */
  commentRole(): 'tech' | 'validator' {
    return this.validateMode() ? 'validator' : 'tech';
  }

  hasOpenComment(testId: string, parameterName: string): boolean {
    return this._comments().some(
      (c) =>
        c.orderTestId === testId &&
        c.parameterName === parameterName &&
        !c.isResolved,
    );
  }

  // Cached parsed parameters per test so JSON.parse runs once per render.
  private readonly _paramsByTest = computed<Map<string, TestParameter[]>>(
    () => {
      const out = new Map<string, TestParameter[]>();
      const s = this._sample();
      if (!s) return out;
      for (const t of s.tests ?? []) {
        const raw = t.test?.parameters;
        let params: TestParameter[] = [];
        let isCulture = false;
        if (raw) {
          try {
            const blob = JSON.parse(raw) as TestParametersBlob;
            params = readParameters(blob);
            isCulture = blob.microFormat === "culture_sensitivity";
          } catch {
            params = [];
          }
        }
        // A non-culture test with no configured parameter schema would otherwise
        // dead-end at "No parameter schema — this test has no inputs" and be
        // impossible to fill (this is why a multi-dept order where one dept's
        // tests had no schema couldn't be entered). Fall back to a single generic
        // "Result" field so EVERY non-culture test is always enterable.
        out.set(
          t.id,
          params.length === 0 && !isCulture ? [defaultResultParam()] : params,
        );
      }
      return out;
    },
  );

  parametersFor(t: OrderTest): TestParameter[] {
    return this._paramsByTest().get(t.id) ?? [];
  }

  // ── Microbiology Culture & Sensitivity ───────────────────────────────
  // Tests flagged microFormat=culture_sensitivity are NOT entered here: the
  // card links to the Culture case page, and they never ride this tube's
  // draft / submit / validate batches (a mixed tube keeps its other tests).
  private readonly _cultureTestIds = computed<Set<string>>(() => {
    const set = new Set<string>();
    for (const t of this._sample()?.tests ?? []) {
      const raw = t.test?.parameters;
      if (!raw) continue;
      try {
        if (
          (JSON.parse(raw) as TestParametersBlob).microFormat ===
          "culture_sensitivity"
        )
          set.add(t.id);
      } catch {
        /* malformed blob → treat as non-culture */
      }
    }
    return set;
  });
  isCultureTest(t: OrderTest): boolean {
    return this._cultureTestIds().has(t.id);
  }
  /** "Specimen: Urine" — the specimen chosen at the order desk, for a
   *  non-culture test that has one (culture shows it on the bench). */
  specimenLabel(t: OrderTest): string | null {
    return this.isCultureTest(t) ? null : chosenSpecimen(t);
  }
  /** Culture tests live on the Culture case page (entry AND sign-out). */
  openCultureBench(t: OrderTest) {
    void this.router.navigate(["/lab/culture", t.id]);
  }

  // ── Background server autosave ────────────────────────────────────
  // A silent, debounced draft POST so typed-but-unsubmitted results reach
  // the server without the tech pressing Save draft. Unlike the manual
  // saveDraft() it does NOT navigate away, does NOT toast, and does NOT
  // reset the sample (which would disrupt in-progress typing). The manual
  // Save draft button stays exactly as-is.
  private scheduleServerAutosave() {
    if (this.viewOnly()) return;   // read-only view never writes drafts
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.autosaveRun = this.autoSaveDraft();
    }, 2500);
  }

  /** The last background draft POST (awaited by Submit all, so a draft can
   *  never land on the server AFTER the submit). */
  private autosaveRun: Promise<void> | null = null;

  private async autoSaveDraft() {
    const s = this._sample();
    if (!s || this._submitting() || this._savingDraft() || this._autosaving())
      return;
    const all = this._values();
    const writable = (s.tests ?? []).filter(
      (t) => t.status !== "validated" && t.status !== "entered" && !this.isCultureTest(t),
    );
    const payload = {
      results: writable
        .filter((t) => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map((t) => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined,
          bold: this.boldFor(t.id),
        })),
    };
    if (payload.results.length === 0) return;
    this._autosaving.set(true);
    try {
      await firstValueFrom(
        this.api.post<BulkSubmitResponse>(
          `/api/samples/${s.id}/results/draft`,
          payload,
        ),
      );
      // A flush on the way to another tube must not stamp "Saved" on it.
      if (this._sample()?.id === s.id) this._lastSavedAt.set(new Date());
      // Keep the local crash-recovery copy until a manual save/submit clears it.
    } catch {
      /* silent — the localStorage draft remains the fallback */
    } finally {
      this._autosaving.set(false);
    }
  }

  /** Render kind — the SHARED resolver (also used by the Test Master
   *  editor) so a parameter can never be a dropdown here and free text
   *  there. */
  inputKindFor(
    p: TestParameter,
  ): "number" | "textarea" | "select" | "checkbox" | "date" | "text" {
    return resolveParamEntryKind(p);
  }

  /** Options for a select parameter: the test's own option table (active
   *  rows) wins; qualitative detection may supply a default pair. */
  selectOptionsFor(p: TestParameter): string[] {
    return choiceOptionsFor(p);
  }

  /** Per-test "show overall observation thread" toggle. The thread block
   *  is heavy (composer textarea + buttons), so we keep it collapsed until
   *  the tech clicks the compact "+ Note" pill in the test header. Threads
   *  with existing comments stay always-visible (see template @if). */
  isOverallOpen(testId: string): boolean {
    return this.paramNoteOrOverallOpen(testId, null);
  }
  toggleOverall(testId: string) {
    this.openQuickNote(testId, null);
  }

  /** Pretty-formatted reference range for the grid's Range column. Handles
   *  the standard {min,max} pair plus the `ref_range` text fallback used
   *  for sex-segmented + qualitative ranges. */
  refLabelFor(p: TestParameter): string {
    const r = (p as TestParameter & { ref_range?: string }).ref_range;
    if (r) return r;
    // Every band, labelled ("Adult Male 13–17 · Adult Female 12–15"). This
    // showed referenceRanges[0] alone, so a tech entering a FEMALE patient's
    // haemoglobin was shown the MALE band to judge it against. This screen has
    // no patient sex/age in scope, so naming a single band would be a guess —
    // showing them all is the honest form, and the backend still decides the
    // flag that gets persisted and printed.
    // A typed report text keeps its own line breaks (the cell is pre-line).
    const bands = (p.referenceRanges ?? []).some(b => b.reportText?.trim() || !isLegacyGroup(b))
      ? summarizeRanges(p.referenceRanges, p.unit, { keepLines: true })
      : describeAllRanges(p.referenceRanges).join(" · ");
    if (bands) return bands;
    if (p.normalValue) return p.normalValue;
    return "";
  }

  /** Methodology — HYBRID: the value's own override, else the test-level
   *  default (shared resolver; the report uses the same rule). */
  methodologyOf(p: TestParameter, test?: { methodology?: string | null } | null): string {
    return effectiveMethodology(p, test) || "—";
  }

  getValue(testId: string, paramName: string): unknown {
    return this._values()[testId]?.[paramName] ?? "";
  }

  setValue(testId: string, paramName: string, v: unknown) {
    const before = this._values()[testId]?.[paramName];
    this._values.update((all) => ({
      ...all,
      [testId]: { ...(all[testId] ?? {}), [paramName]: v },
    }));
    // Typing INTO a calculated field is an override (analyzers report some of
    // these directly); clearing it hands the field back to the formula.
    // Typing into anything else re-runs the dependent formulas.
    this.markCalcOverride(testId, paramName, v);
    this.recomputeCalcFields(calcKey(testId, paramName));
    this.autoTickOnEntry(testId, paramName, before, v);
    this.scheduleDraftSave();
    this.scheduleServerAutosave();
  }

  // ── Calculated results (profile formulas — VLDL = TG/5, eGFR…) ──────
  // The formula lives on the TEST (test.calculation, document-verbatim from
  // the master); inputs are sibling tests on this same tube, addressed by
  // code. The computed value is a PREFILL: it fills the field live while the
  // tech hasn't typed there, participates in autosave/flags exactly like a
  // typed value, and steps aside the moment the tech overrides it.

  /** CalcDef per order-test id (only computable kinds parse). */
  private readonly _calcByTest = computed<Map<string, CalcDef>>(() => {
    const out = new Map<string, CalcDef>();
    for (const t of this._sample()?.tests ?? []) {
      const def = parseCalc(t.test?.calculation);
      if (def) out.set(t.id, def);
    }
    return out;
  });

  /** Sibling lookup: canonical code → order test on this tube. */
  private readonly _testByCode = computed<Map<string, OrderTest>>(() => {
    const out = new Map<string, OrderTest>();
    for (const t of this._sample()?.tests ?? []) {
      const code = t.test?.testCode?.trim().toUpperCase();
      if (code && !out.has(code)) out.set(code, t);
    }
    return out;
  });

  /** Calc fields the tech has taken over (calcKey → manual). */
  private readonly _calcOverridden = signal<Set<string>>(new Set());

  /** Tenant lab constants (ISI/MNPT/NORMAL_HCT), parsed once per change;
   *  evaluateCalc falls back to the shipped defaults for missing keys. */
  private readonly _calcConstants = computed<Record<string, number>>(() => {
    const raw = this.tenantState.tenant()?.calcConstants;
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj))
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      return out;
    } catch {
      return {};
    }
  });

  /** The parameter a formula writes into — the test's first numeric one. */
  private calcTargetParam(t: OrderTest): TestParameter | null {
    return (
      this.parametersFor(t).find((p) => this.inputKindFor(p) === "number") ??
      null
    );
  }

  private calcContext(): CalcContext {
    const byCode = this._testByCode();
    const consts = this._calcConstants();
    const patient = this._sample()?.order?.patient;
    // Formula AGE: whole years from the DOB (shared helper).
    const age = ageInYears(patient);
    const resolveParam = (t: OrderTest, name: string | null) => {
      if (!name) return this.calcTargetParam(t);
      const want = name.trim().toLowerCase();
      return (
        this.parametersFor(t).find(
          (p) =>
            p.name.trim().toLowerCase() === want ||
            (p.title ?? "").trim().toLowerCase() === want,
        ) ?? null
      );
    };
    return {
      value: (ref) => {
        const sep = ref.indexOf(":");
        const code = (sep < 0 ? ref : ref.slice(0, sep)).trim().toUpperCase();
        const param = sep < 0 ? null : ref.slice(sep + 1);
        const t = byCode.get(code);
        if (!t) return null;
        const p = resolveParam(t, param);
        if (!p) return null;
        const raw = this.getValue(t.id, p.name);
        if (raw === undefined || raw === null || raw === "") return null;
        const v = Number(String(raw).trim());
        return Number.isFinite(v) ? v : null;
      },
      constant: (name) => consts[name],
      age,
      sex: patient?.sex ?? null,
      uln: (code) => {
        const t = byCode.get(code.trim().toUpperCase());
        const p = t ? this.calcTargetParam(t) : null;
        if (!p) return null;
        const { sex, age: bandAge } = this.patientSexAge();
        return (
          selectReferenceRange(p.referenceRanges, sex, bandAge)?.max ?? null
        );
      },
    };
  }

  private markCalcOverride(testId: string, paramName: string, v: unknown) {
    const def = this._calcByTest().get(testId);
    if (!def) return;
    const target = this.calcTargetParam(
      (this._sample()?.tests ?? []).find((t) => t.id === testId) ??
        ({} as OrderTest),
    );
    if (!target || target.name !== paramName) return;
    const key = calcKey(testId, paramName);
    const next = new Set(this._calcOverridden());
    if (v === "" || v === null || v === undefined) next.delete(key);
    else next.add(key);
    this._calcOverridden.set(next);
  }

  /** Recompute every non-overridden calculated field from the live values.
   *  Runs up to three passes so chained formulas settle (Globulin = TP − Alb,
   *  then A/G = Alb / Globulin) regardless of iteration order. */
  private recomputeCalcFields(excludeKey?: string) {
    const defs = this._calcByTest();
    if (defs.size === 0) return;
    const tests = this._sample()?.tests ?? [];
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      const ctx = this.calcContext();
      for (const [testId, def] of defs) {
        const t = tests.find((x) => x.id === testId);
        if (!t || t.status === "validated" || t.status === "entered") continue;
        const target = this.calcTargetParam(t);
        if (!target) continue;
        const key = calcKey(testId, target.name);
        if (key === excludeKey || this._calcOverridden().has(key)) continue;
        const res = evaluateCalc(def, ctx);
        const next = res.value != null ? String(res.value) : "";
        const cur = String(this.getValue(testId, target.name) ?? "");
        if (cur === next) continue;
        this._values.update((all) => ({
          ...all,
          [testId]: { ...(all[testId] ?? {}), [target.name]: next },
        }));
        changed = true;
      }
      if (!changed) break;
    }
  }

  /** After prefill/draft restore: a stored value that MATCHES the formula
   *  keeps auto-updating; one that differs was a deliberate override and
   *  must survive the reload untouched. */
  private seedCalcState() {
    const defs = this._calcByTest();
    if (defs.size === 0) return;
    const ctx = this.calcContext();
    const over = new Set<string>();
    for (const [testId, def] of defs) {
      const t = (this._sample()?.tests ?? []).find((x) => x.id === testId);
      const target = t ? this.calcTargetParam(t) : null;
      if (!target) continue;
      const cur = String(this.getValue(testId, target.name) ?? "");
      if (!cur) continue;
      const res = evaluateCalc(def, ctx);
      if (res.value == null || String(res.value) !== cur)
        over.add(calcKey(testId, target.name));
    }
    this._calcOverridden.set(over);
    this.recomputeCalcFields();
  }

  /** Chip beside a calculated field: how the current value got there. */
  calcChip(
    t: OrderTest,
    p: TestParameter,
  ): { kind: "auto" | "manual" | "na"; label: string } | null {
    const def = this._calcByTest().get(t.id);
    if (!def) return null;
    const target = this.calcTargetParam(t);
    if (!target || target.name !== p.name) return null;
    if (this._calcOverridden().has(calcKey(t.id, p.name)))
      return { kind: "manual", label: "Manual" };
    const res = evaluateCalc(def, this.calcContext());
    if (res.invalid) return { kind: "na", label: "Not calculable" };
    if (res.value != null) return { kind: "auto", label: "Calculated" };
    return { kind: "auto", label: "Auto" };
  }

  // ── Local draft persistence ───────────────────────────────────────
  // Typed-but-unsubmitted values survive an app kill / reload: every
  // change autosaves the whole _values map to localStorage (debounced),
  // and the draft is overlaid on top of the server prefill on the next
  // load (draft wins — it's newer typing that never reached the server).
  // Cleared once the values DO reach the server (submitAll / saveDraft).
  private draftKey: string | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleDraftSave() {
    if (!this.draftKey) return;
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      try {
        localStorage.setItem(this.draftKey!, JSON.stringify(this._values()));
      } catch {
        /* private mode */
      }
    }, 500);
  }

  private flushLocalDraft() {
    if (this.draftTimer === null || !this.draftKey) return;
    clearTimeout(this.draftTimer);
    this.draftTimer = null;
    try {
      localStorage.setItem(this.draftKey, JSON.stringify(this._values()));
    } catch {
      /* private mode */
    }
  }

  private restoreDraft() {
    if (!this.draftKey) return;
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      this._values.update((all) => {
        const merged = { ...all };
        for (const [testId, vals] of Object.entries(draft)) {
          merged[testId] = { ...(merged[testId] ?? {}), ...vals };
        }
        return merged;
      });
    } catch {
      /* private mode / malformed draft */
    }
  }

  private clearDraft() {
    if (this.draftTimer !== null) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    if (!this.draftKey) return;
    try {
      localStorage.removeItem(this.draftKey);
    } catch {
      /* private mode */
    }
  }

  /** VALIDATION mode (?validate=1): the pathologist reviews the tube on the
   *  SAME screen the tech used — fields already render read-only for entered
   *  tests; drafts/autosave stay off; the footer swaps to Reject / Validate. */
  readonly validateMode = signal(false);
  /** Read-only VIEW (?view=1): inputs untouchable, no submit, no autosave —
   *  opened from the Completed tab / reports queue to inspect results. */
  readonly viewOnly = signal(false);

  enteredTests() {
    return (this._sample()?.tests ?? []).filter(t => t.status === 'entered' && !this.isCultureTest(t));
  }
  /** When the tube was submitted (latest resultedAt across its tests). */
  submittedAtLabel(): string {
    const ts = (this._sample()?.tests ?? [])
      .map(t => t.resultedAt).filter(Boolean).sort();
    return ts.length ? this.fmtShort(ts[ts.length - 1] as string) : '';
  }
  /** "Priya Raman · Sep 14, 2:51 AM" — who entered THIS test's result and
   *  when. Shown per test section so the validator sees provenance in place. */
  enteredByLabel(t: OrderTest): string {
    if (!t.resultedByName) return '';
    const when = t.resultedAt ? this.fmtShort(t.resultedAt) : '';
    return when ? `${t.resultedByName} · ${when}` : t.resultedByName;
  }
  private fmtShort(iso: string): string {
    try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return ''; }
  }

  private readonly prestore = inject(ReportPrestoreService);

  // ── Analyzer prefill (instrument connector) ─────────────────────────
  // GET /api/instruments/results/by-sample/{id} → runs (newest first). The
  // selected run PREFILLS empty fields only (pure rules: shared/instruments/
  // instrument-prefill.ts): never overwrites typed values, never submits,
  // never validates, never saves a draft by itself. Errors / 404 → silent.
  readonly analyzerRuns = signal<RunDto[]>([]);
  readonly analyzerRunId = signal<string | null>(null);
  private readonly _analyzerApplied = signal<AppliedMap>({});
  readonly analyzerRunOptions = computed(() => runOptions(this.analyzerRuns(), (iso) => this.analyzerTime(iso)));

  private analyzerTime(iso: string | null): string {
    if (!iso) return "";
    try { return formatDate(iso, "h:mm a", "en-US", LAB_TIME_ZONE); } catch { return ""; }
  }

  private resetAnalyzerPrefill() {
    this.analyzerRuns.set([]);
    this.analyzerRunId.set(null);
    this._analyzerApplied.set({});
  }

  /** The writable lines on screen and the fields an analyzer value may take. */
  private analyzerLines(): PrefillLine[] {
    const out: PrefillLine[] = [];
    const s = this._sample();
    const skip = new Set(["boolean", "checkbox", "toggle", "yesno"]);
    for (const t of splitOutsourced(s?.tests ?? [], s?.outsourcedVendorId).inHouse) {
      if (!isWritableTest(t)) continue;
      const params = this.parametersFor(t).filter((p) => !this.isMultiSelect(p) && !skip.has(String(p.type)));
      if (params.length) out.push({ orderTestId: t.id, params: params.map((p) => ({ name: p.name, title: p.title ?? null })) });
    }
    return out;
  }

  private async loadAnalyzerPrefill(seq: number, sampleId: string) {
    if (this.validateMode() || this.viewOnly()) return;
    try {
      const dto = await firstValueFrom(this.instrumentsApi.prefillForSample(sampleId));
      if (seq !== this.loadSeq || this.validateMode() || this.viewOnly()) return;
      const runs = Array.isArray(dto?.runs) ? dto.runs.filter((r) => !!r?.messageId) : [];
      this.analyzerRuns.set(runs);
      const first = defaultRun(runs);
      if (first) this.applyAnalyzerRun(first.messageId);
    } catch {
      /* no analyzer / endpoint not there yet — result entry works as before */
    }
  }

  /** Apply one run (the picker): fills empty fields and fields still equal to
   *  the previous run's prefill; typed values are never touched. */
  applyAnalyzerRun(messageId: string | null) {
    const run = this.analyzerRuns().find((r) => r.messageId === messageId) ?? null;
    if (!run) return;
    const plan = planPrefill({
      run,
      lines: this.analyzerLines(),
      current: (ot, p) => this._values()[ot]?.[p],
      previous: this._analyzerApplied(),
    });
    if (plan.writes.length) {
      this._values.update((all) => {
        const next = { ...all };
        for (const w of plan.writes) next[w.orderTestId] = { ...(next[w.orderTestId] ?? {}), [w.paramName]: w.value };
        return next;
      });
      this.recomputeCalcFields();
    }
    this._analyzerApplied.set(plan.applied);
    this.analyzerRunId.set(run.messageId);
  }

  /** The small "From Sysmex · 10:42 am" badge (+ analyzer H/L chips). */
  analyzerBadgeFor(t: { id: string }, p: { name: string }): AnalyzerBadge | null {
    const applied = this._analyzerApplied();
    if (!Object.keys(applied).length) return null;
    return analyzerBadge(applied, t.id, p.name, this._values()[t.id]?.[p.name], (iso) => this.analyzerTime(iso));
  }

  async validateTube() {
    const targets = this.enteredTests();
    if (!targets.length || this.submitting()) return;
    if (!(await this.confirmNothingPrints(targets, "validate"))) return;
    this.submitAct.set('validate');
    this._submitting.set(true);
    await this.hiddenSettled();
    let ok = 0, lastErr = '';
    for (const t of targets) {
      try { await firstValueFrom(this.api.post(`/api/validation/${t.id}/validate`, { note: null })); ok++; }
      catch (e) { lastErr = ApiError.from(e).message; }
    }
    this._submitting.set(false);
    // The tube's validation can complete the final report — store its PDF now
    // (background) so the patient's WhatsApp carries it.
    if (ok > 0) this.prestore.afterValidation(this.sample()?.orderId ?? this.sample()?.order?.id);
    if (ok === targets.length) {
      this.toasts.success(ok === 1 ? 'Result validated' : `${ok} results validated`);
      void this.router.navigate(['/pathologist']);
    } else {
      this.toasts.error(lastErr || 'Some results could not be validated');
      await this.load(this._sample()?.id ?? '');
    }
  }

  async rejectTube() {
    const targets = this.enteredTests();
    if (!targets.length || this.submitting()) return;
    const reason = await this.dialog.prompt({
      title: 'Reject this tube?',
      message: 'Every submitted result on this sample goes back to the technician for re-entry.',
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject results',
    });
    if (!reason) return;
    this.submitAct.set('reject');
    this._submitting.set(true);
    let ok = 0, lastErr = '';
    for (const t of targets) {
      try { await firstValueFrom(this.api.post(`/api/validation/${t.id}/reject`, { reason, note: null })); ok++; }
      catch (e) { lastErr = ApiError.from(e).message; }
    }
    this._submitting.set(false);
    if (ok === targets.length) {
      this.toasts.success('Rejected — technician notified');
      void this.router.navigate(['/pathologist']);
    } else {
      this.toasts.error(lastErr || 'Some results could not be rejected');
    }
  }

  /** "sampleId|mode" of the tube on stage — a route emission for the same
   *  key is a no-op (re-tapping the draft you're on reloads nothing). */
  private loadedKey: string | null = null;
  /** Bumps per switch; a slower earlier load never paints over a later one. */
  private loadSeq = 0;

  ngOnInit() {
    // The router REUSES this component for /lab/sample/A → /lab/sample/B
    // (draft shelf, tube tabs, notifications, scan): the tube is driven by
    // the LIVE param + query streams, never a one-off snapshot read — that
    // snapshot read is what kept tube A on screen after tapping B's draft.
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([p, q]) => void this.onRoute(
        p.get("sampleId"), q.get("validate") === "1", q.get("view") === "1"));
  }

  /** Show the tube the URL names. Same tube + mode → nothing happens.
   *  Another tube → the current one's typing is saved first (local copy +
   *  server draft), per-tube UI state is reset, and the new tube loads. */
  private async onRoute(id: string | null, validate: boolean, view: boolean) {
    const key = `${id ?? ""}|${validate ? "v" : ""}${view ? "r" : ""}`;
    if (key === this.loadedKey) return;
    const first = this.loadedKey === null;
    this.loadedKey = key;
    if (!first) {
      this.flushPending();
      this.parkLiveSnapshot();
    }
    this.validateMode.set(validate);
    this.viewOnly.set(view);
    this.routeSampleId.set(id);          // the tab indicator moves now
    if (!id) {
      this._loading.set(false);
      return;
    }
    if (!first) this.resetForSwitch(id);
    this._loading.set(true);
    await this.load(id);
  }

  /** Save whatever the tech typed on the tube on stage, without waiting:
   *  the debounced localStorage copy is written under ITS key (restored on
   *  the next visit), and a pending background server draft is sent now. */
  private flushPending() {
    this.flushLocalDraft();
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
      this.autosaveRun = this.autoSaveDraft();   // snapshots sample + values synchronously
    }
  }

  /** Per-tube state that must not leak into the next tube. The tube TABS
   *  stay (a sibling switch never blinks the strip; load() re-syncs them). */
  private resetForSwitch(nextId: string) {
    this.closeInfo();
    this.tubeMenuOpen.set(false);
    this._quickNote.set(null);
    this._flags.set([]);
    this._comments.set([]);
    this._lastSavedAt.set(null);
    this._calcOverridden.set(new Set());
    this._attach.set({});
    this._reportHidden.set({});
    this._autoTicked.clear();
    this.resetAnalyzerPrefill();
    this.draftKey = null;                // no stray debounced write under the old key
    if (!this._tubeTabs().some((t) => t.id === nextId)) {
      // A different ORDER, not a sibling tube: order-level UI resets too.
      this._tubeTabs.set([]);
      this._siblingSnaps.set({});
      this.submitReport.set([]);
      this.trendogramOn.set(false);
      this.trendogramDuration.set("5");
    }
  }

  /** Switch to a sibling tube of the same order without leaving the screen:
   *  the URL moves and the route stream (onRoute) saves this tube's typing
   *  and loads the next one in place (OPS-51: FBS/PPBS live in different
   *  tubes of one order). */
  async openSibling(id: string) {
    if (!id || id === this.activeTubeId()) return;
    this.routeSampleId.set(id);          // the tab indicator moves now
    await this.router.navigate(["/lab/sample", id], { replaceUrl: false });
  }

  private async load(id: string) {
    const seq = ++this.loadSeq;
    try {
      const sample = await firstValueFrom(
        this.api.get<OrderSample>(`/api/samples/${id}/tests`),
      );
      if (seq !== this.loadSeq) return;  // superseded by a later switch
      this.draftKey = `pf-lms.sre-draft.${id}`;
      this._sample.set(this.normalizeSample(sample ?? null));
      this.syncTubeTabs(this._sample());
      // Pre-fill from any existing currentResult JSON so the tech can edit
      // a previously-entered value rather than starting from blank.
      this.prefillValues(sample ?? null);
      // Then overlay any locally-autosaved draft — typing that never
      // reached the server (app killed mid-entry) beats the prefill.
      // (Never in VALIDATION mode: the pathologist must review exactly what
      // the tech SUBMITTED, not a stale local draft on this device.)
      if (!this.validateMode()) this.restoreDraft();
      // Calc fields: stored values that match their formula stay live-updating;
      // ones that differ were overridden. Needs the tenant for ISI/MNPT.
      this.tenantState.ensureLoaded();
      this.seedCalcState();
      if (this.multiTube()) void this.fetchSiblingSnaps();
      const focusTest = this.pendingFocusTest;
      if (focusTest && (this._sample()?.tests ?? []).some((t) => t.id === focusTest)) {
        this.pendingFocusTest = null;
        this.focusFirstEmpty(focusTest);
      }
      await this.loadComments();
      this.loadCritical();
      // Analyzer results (instrument connector): PREFILL only, after the
      // tube + drafts are on screen; never blocks or fails the load.
      void this.loadAnalyzerPrefill(seq, id);
    } catch (e) {
      if (seq === this.loadSeq) this.toasts.error("Could not load sample");
    } finally {
      if (seq === this.loadSeq) this._loading.set(false);
    }
  }

  private async loadComments() {
    const s = this._sample();
    if (!s) return;
    try {
      const list = await firstValueFrom(
        this.api.get<OrderTestComment[]>(`/api/samples/${s.id}/comments`),
      );
      this._comments.set(list ?? []);
    } catch {
      /* non-fatal — entry still works without comments */
    }
  }

  async addOverallComment(
    testId: string,
    body: string,
    type: "observation" | "correction",
  ) {
    await this.postComment(testId, null, null, body, type);
  }
  async replyToOverall(testId: string, parentId: string, body: string) {
    await this.postComment(testId, null, parentId, body, "observation");
  }
  async addParameterComment(
    testId: string,
    paramName: string,
    body: string,
    type: "observation" | "correction",
  ) {
    await this.postComment(testId, paramName, null, body, type);
  }
  async replyToParameter(
    testId: string,
    paramName: string,
    parentId: string,
    body: string,
  ) {
    await this.postComment(testId, paramName, parentId, body, "observation");
  }

  private async postComment(
    testId: string,
    parameterName: string | null,
    parentId: string | null,
    body: string,
    commentType: "observation" | "correction",
  ) {
    try {
      await firstValueFrom(
        this.api.post<OrderTestComment>(`/api/results/${testId}/comments`, {
          parameterName,
          parentId,
          commentType,
          body,
        }),
      );
      await this.loadComments();
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    }
  }

  async submitAll() {
    const s = this._sample();
    if (!s || this._submitting()) return;
    this.submitAct.set('submit');
    this._submitting.set(true);
    await this.hiddenSettled();
    const all = this._values();
    // Skip tests that the backend will refuse:
    //   - 'validated' is signed off (must be rejected before re-entry)
    //   - 'entered' is awaiting validation (re-saving overwrites the
    //     submitted value, which the backend blocks too)
    // The form pre-fills values for these from currentResult so they
    // can be SEEN, but submitting them would 409 the whole batch.
    const writable = (s.tests ?? []).filter(
      (t) => t.status !== "validated" && t.status !== "entered" && !this.isCultureTest(t),
    );
    // A numeric parameter holding a non-parseable value must never be
    // submitted as the result — surface which ones and stop.
    const invalid: string[] = [];
    for (const t of writable) {
      for (const p of this.parametersFor(t)) {
        if (this.isInvalidNumber(t, p)) invalid.push(p.title || p.name);
      }
    }
    if (invalid.length > 0) {
      this.toasts.warning(
        `Not a valid number: ${invalid.join(", ")} — fix before submitting`,
      );
      this._submitting.set(false);
      return;
    }
    if (!(await this.confirmNothingPrints(writable.filter((t) => !!all[t.id] && Object.keys(all[t.id]).length > 0), "submit"))) {
      this._submitting.set(false);
      return;
    }
    const payload = {
      results: writable
        .filter((t) => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map((t) => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined,
          bold: this.boldFor(t.id),
        })),
    };
    if (payload.results.length === 0) {
      const allDone = (s.tests ?? []).length > 0 && writable.length === 0;
      this.toasts.warning(
        allDone
          ? "Every test on this tube is already submitted or validated."
          : "Enter at least one value before submitting",
      );
      this._submitting.set(false);
      return;
    }
    try {
      const resp = await firstValueFrom(
        this.api.post<BulkSubmitResponse>(
          `/api/samples/${s.id}/results`,
          payload,
        ),
      );
      const flags: Array<{ label: string; note?: string; critical: boolean }> =
        [];
      for (const r of resp?.results ?? []) {
        const name = r.orderTest?.test?.name ?? "Test";
        if (r.flags?.critical) {
          flags.push({ label: `${name}: critical`, critical: true });
        }
        for (const n of r.flags?.notifications ?? []) {
          flags.push({ label: name, note: n, critical: false });
        }
      }
      this._flags.set(flags);
      this.loadCritical();
      this._sample.set(this.normalizeSample(resp?.sample ?? s));
      // Values reached the server — the local crash-recovery draft is done.
      this.clearDraft();
      this.draftShelf.drop("lab", ["lab:" + s.id]);
      // Backend auto-resolves correction threads on submit (see
      // ResultService.EnterAsync). Reload to reflect the new
      // resolution state in the UI.
      await this.loadComments();
      const n = resp?.submitted ?? 0;
      this.toasts.success(
        `Submitted ${n} test${n === 1 ? "" : "s"} — back to your queue`,
      );
      // Hand the tech back to /lab/my-work so they can pick the next
      // tube. Without this nav, submitAll only ever showed a toast and
      // the user was stuck on the now-empty entry page.
      setTimeout(() => this.router.navigate(["/lab/my-work"]), 700);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._submitting.set(false);
    }
  }

  /** Save whatever is filled so far WITHOUT finalising — the tech can leave
   *  and come back to finish. Persists partial values to each test's draft
   *  (status stays in_progress) so reopening pre-fills them, and the tube shows
   *  as in-progress under "My Work". Mirrors submitAll but targets the draft
   *  endpoint (no plausibility/critical engine, no validation transition). */
  async saveDraft() {
    const s = this._sample();
    if (!s || this._submitting() || this._savingDraft()) return;
    const all = this._values();
    const writable = (s.tests ?? []).filter(
      (t) => t.status !== "validated" && t.status !== "entered" && !this.isCultureTest(t),
    );
    const payload = {
      results: writable
        .filter((t) => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map((t) => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined,
          bold: this.boldFor(t.id),
        })),
    };
    if (payload.results.length === 0) {
      this.toasts.warning("Nothing to save yet — enter a value first.");
      return;
    }
    this._savingDraft.set(true);
    try {
      const resp = await firstValueFrom(
        this.api.post<BulkSubmitResponse>(
          `/api/samples/${s.id}/results/draft`,
          payload,
        ),
      );
      this._sample.set(this.normalizeSample(resp?.sample ?? s));
      // Draft now lives on the server (currentResult prefills it next
      // open) — drop the local crash-recovery copy.
      this.clearDraft();
      this.toasts.success("Draft saved — you can finish this tube later");
      setTimeout(() => this.router.navigate(["/lab/my-work"]), 600);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._savingDraft.set(false);
    }
  }

  // ── Submit all (owner 2026-09-27) ────────────────────────────────────
  // Two or more tube tabs of one order: the band's ONE primary becomes
  // "Submit all" (every tab, the per-tab submit path, tab by tab), and the
  // per-tab submit stays as the secondary "Submit this sample". Every field
  // filled → straight through; any empty field → one confirmation listing
  // them (Submit anyway / Go back → the first empty field). Rules:
  // ./submit-all.ts.

  /** Other tabs' tube + values: the server's saved drafts (currentResult)
   *  overlaid with the local unsaved copy — what that tab shows on open. */
  private readonly _siblingSnaps = signal<Record<string, TabSnapshot>>({});
  private siblingSeq = 0;
  /** A test to focus once its tube has loaded (Go back → first empty field). */
  private pendingFocusTest: string | null = null;
  private submitAllRunning = false;
  readonly missingLine = missingLine;

  /** Per-tab outcome of the last Submit all that did not fully succeed. */
  readonly submitReport = signal<Array<{ sampleId: string; barcode: string; ok: boolean; message?: string }>>([]);

  /** Submit all is offered when the pill shows more than one tube tab. */
  readonly multiTube = computed(() =>
    this._tubeTabs().length > 1 && !this.validateMode() && !this.viewOnly());

  private readonly liveSnap = computed<TabSnapshot | null>(() => {
    const s = this._sample();
    return s ? { sampleId: s.id, barcode: s.barcode || "", tests: s.tests ?? [], values: this._values(), bold: this._bold() } : null;
  });

  /** One snapshot per tab, in tab order (null = that tube not fetched yet). */
  readonly tabSnaps = computed<Array<TabSnapshot | null>>(() => {
    const live = this.liveSnap();
    const others = this._siblingSnaps();
    return this._tubeTabs().map((tab) => (live && tab.id === live.sampleId ? live : others[tab.id] ?? null));
  });

  /** Tab indicator per tube: ✓ every field has a value / dot some value. */
  readonly tabMarks = computed<Record<string, "complete" | "draft" | null>>(() => {
    const out: Record<string, "complete" | "draft" | null> = {};
    for (const snap of this.tabSnaps()) if (snap) out[snap.sampleId] = tabMark(snap);
    return out;
  });

  /** Anything left to submit on any tab (unknown tabs count as "maybe"). */
  readonly anyWritableAcrossTabs = computed(() =>
    this.tabSnaps().some((snap) => !snap || snap.tests.some(isWritableTest)));

  private readLocalDraft(sampleId: string): ValuesMap | null {
    try {
      const raw = localStorage.getItem(`pf-lms.sre-draft.${sampleId}`);
      return raw ? (JSON.parse(raw) as ValuesMap) : null;
    } catch {
      return null;
    }
  }

  private removeLocalDraft(sampleId: string) {
    try { localStorage.removeItem(`pf-lms.sre-draft.${sampleId}`); } catch { /* private mode */ }
  }

  private snapshotOf(s: OrderSample): TabSnapshot {
    const tests = this.normalizeSampleTests(s);
    return {
      sampleId: s.id,
      barcode: s.barcode || "",
      tests,
      values: overlayDraft(prefillFromTests(tests), this.readLocalDraft(s.id)),
      bold: boldFromTests(tests),
    };
  }

  /** In-house tests in display order (the same split the screen uses). */
  private normalizeSampleTests(s: OrderSample): OrderTest[] {
    const { inHouse } = splitOutsourced(s.tests ?? [], s.outsourcedVendorId);
    return sortTestsForDisplay(inHouse);
  }

  /** Leaving a tab: its live values become its snapshot at once, so the
   *  tab marks never blink while the next tube loads. */
  private parkLiveSnapshot() {
    const live = this.liveSnap();
    if (live && this._tubeTabs().some((t) => t.id === live.sampleId))
      this._siblingSnaps.update((m) => ({ ...m, [live.sampleId]: live }));
  }

  /** Fetch every OTHER tab's tube (read-only GET) and rebuild its snapshot.
   *  Returns the barcodes that could not be loaded. */
  private async fetchSiblingSnaps(): Promise<{ failed: string[] }> {
    const cur = this._sample();
    if (!cur) return { failed: [] };
    const others = this._tubeTabs().filter((t) => t.id !== cur.id);
    if (!others.length) return { failed: [] };
    const seq = ++this.siblingSeq;
    const got = await Promise.all(others.map(async (tab) => {
      try {
        const s = await firstValueFrom(this.api.get<OrderSample>(`/api/samples/${tab.id}/tests`));
        return s ? this.snapshotOf(s) : null;
      } catch {
        return null;
      }
    }));
    const failed = others.filter((_, i) => !got[i]).map((t) => t.barcode || "Tube");
    if (seq === this.siblingSeq) {
      this._siblingSnaps.update((m) => {
        const next: Record<string, TabSnapshot> = {};
        for (const tab of others) {
          const fresh = got.find((g) => g?.sampleId === tab.id);
          if (fresh) next[tab.id] = fresh;
          else if (m[tab.id]) next[tab.id] = m[tab.id];
        }
        return next;
      });
    }
    return { failed };
  }

  /** Save the unsaved typing now and WAIT for it: the local copy, a pending
   *  background draft, and one already on the wire. */
  private async flushPendingNow() {
    this.flushLocalDraft();
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
      this.autosaveRun = this.autoSaveDraft();
    }
    if (this.autosaveRun) await this.autosaveRun;
  }

  /** Focus the first empty field of a test on the tube on stage (the first
   *  field when none is empty); retried briefly while the cards render. */
  private focusFirstEmpty(testId: string, attempt = 0) {
    const t = (this._sample()?.tests ?? []).find((x) => x.id === testId);
    if (!t) return;
    const params = this.parametersFor(t);
    const target =
      params.find((p) => this.inputKindFor(p) !== "checkbox" && !isFilled(this.getValue(t.id, p.name))) ?? params[0];
    if (!target) return;
    const key = `${t.id}::${target.name}`.replace(/["\\]/g, "\\$&");
    const tryFocus = () => {
      const root = this.host.nativeElement as HTMLElement;
      const el =
        root.querySelector<HTMLElement>(`[data-sre-field="${key}"]`) ??
        root.querySelector<HTMLElement>(`[data-sre-param="${key}"] .pf-dd__trigger`);
      if (!el) return false;
      el.focus();
      el.scrollIntoView?.({ block: "center" });
      return true;
    };
    afterNextRender(() => {
      if (!tryFocus() && attempt < 20) setTimeout(() => this.focusFirstEmpty(testId, attempt + 1), 60);
    }, { injector: this.injector });
  }

  /** Move to an empty field: switch tab first when it is on another tube. */
  async goToMissing(m: MissingEntry) {
    if (m.sampleId !== this._sample()?.id) {
      this.pendingFocusTest = m.testId;
      await this.openSibling(m.sampleId);
    } else {
      this.focusFirstEmpty(m.testId);
    }
  }

  /** Submit every tab of this order, tab by tab, through the per-tab path. */
  async submitAllTabs() {
    const cur = this._sample();
    if (!cur || this.submitAllRunning || this._submitting() || this._savingDraft()) return;
    this.submitAllRunning = true;
    try {
      // 1. The unsaved typing first (local copy + server draft, awaited).
      await this.flushPendingNow();
      await this.hiddenSettled();
      this.submitAct.set('all');
      this._submitting.set(true);
      this.submitReport.set([]);
      // 2. Every tab's latest state.
      const { failed } = await this.fetchSiblingSnaps();
      if (failed.length) {
        this.toasts.error(`Could not load ${failed.join(", ")} — try again`);
        return;
      }
      const snaps = this.tabSnaps().filter((x): x is TabSnapshot => !!x);
      const targets = snaps.filter((snap) => snap.tests.some(isWritableTest));
      if (!targets.length) {
        this.toasts.warning("Every test on these tubes is already submitted or validated.");
        return;
      }
      // 3. The per-tab submit's own check: a number field must hold a number.
      for (const snap of targets) {
        const bad = invalidNumbers(snap);
        if (bad.length) {
          this.toasts.warning(`${snap.barcode || "Tube"} · Not a valid number: ${bad.join(", ")} — fix before submitting`);
          if (snap.sampleId !== this._sample()?.id) await this.openSibling(snap.sampleId);
          return;
        }
      }
      // 4. Empty fields → ONE confirmation; Go back → the first empty field.
      const missing = missingEntries(targets);
      if (missing.length) {
        this._submitting.set(false);
        const go = await this.dialog.confirm({
          title: "Some fields are empty",
          message: "These fields have no value:",
          items: missing.map(missingLine),
          question: "Do you still want to submit?",
          cancelLabel: "Go back",
          confirmLabel: "Submit anyway",
        });
        if (!go) {
          await this.goToMissing(missing[0]);
          return;
        }
        this.submitAct.set('all');
        this._submitting.set(true);
      }
      // 4b. A test with every value unticked prints nothing — ask first.
      this._submitting.set(false);
      const printOk = await this.confirmNothingPrints(
        targets.flatMap((snap) => snap.tests.filter(isWritableTest)), "submit");
      if (!printOk) return;
      this.submitAct.set('all');
      this._submitting.set(true);
      // 5. Tab by tab, the per-tab endpoint. One tab failing never stops
      //    the others; its data stays (local copy kept, not cleared).
      const report: Array<{ sampleId: string; barcode: string; ok: boolean; message?: string }> = [];
      const flags: Array<{ label: string; note?: string; critical: boolean }> = [];
      for (const snap of targets) {
        try {
          const resp = await firstValueFrom(
            this.api.post<BulkSubmitResponse>(`/api/samples/${snap.sampleId}/results`, tabPayload(snap)),
          );
          for (const r of resp?.results ?? []) {
            const name = r.orderTest?.test?.name ?? "Test";
            if (r.flags?.critical) flags.push({ label: `${snap.barcode} · ${name}: critical`, critical: true });
            for (const n of r.flags?.notifications ?? []) flags.push({ label: `${snap.barcode} · ${name}`, note: n, critical: false });
          }
          if (snap.sampleId === this._sample()?.id) {
            if (resp?.sample) this._sample.set(this.normalizeSample(resp.sample));
            this.clearDraft();
          } else {
            this.removeLocalDraft(snap.sampleId);
            this._siblingSnaps.update((m) => {
              const { [snap.sampleId]: _gone, ...rest } = m;
              return rest;
            });
          }
          report.push({ sampleId: snap.sampleId, barcode: snap.barcode || "Tube", ok: true });
        } catch (e) {
          report.push({ sampleId: snap.sampleId, barcode: snap.barcode || "Tube", ok: false, message: ApiError.from(e).message });
        }
      }
      this._flags.set(flags);
      this.loadCritical();
      const ok = report.filter((r) => r.ok);
      // Submitted tubes leave the draft shelf now.
      this.draftShelf.drop("lab", ok.map((r) => "lab:" + r.sampleId));
      const bad = report.filter((r) => !r.ok);
      if (!bad.length) {
        this.toasts.success(`${ok.length} sample${ok.length === 1 ? "" : "s"} submitted — back to your queue`);
        setTimeout(() => this.router.navigate(["/lab/my-work"]), 700);
        return;
      }
      // Partial (or full) failure: say which tab did what, stay on the
      // first failed tab with its data.
      this.submitReport.set(report);
      this.toasts.error(report.map((r) => (r.ok ? `${r.barcode} submitted` : `${r.barcode} failed: ${r.message}`)).join(" · "));
      if (bad[0].sampleId !== this._sample()?.id) {
        this._submitting.set(false);
        await this.openSibling(bad[0].sampleId);
      } else {
        void this.fetchSiblingSnaps();
      }
    } finally {
      this._submitting.set(false);
      this.submitAllRunning = false;
    }
  }

  back() {
    this.navBack.backTo("/lab/my-work");
  }

  // ── Result attachments (owner's model, 2026-09-20) ───────────────────
  // The tech attaches images/videos to a result; each image carries a
  // show-on-report toggle (mirrors the culture bench's checkboxes — the
  // bench keeps everything, only `show` images print). Videos never print.
  readonly attachBusy = signal(false);
  /** `testId|param` of the paperclip whose upload is running (its busy dots). */
  readonly attachBusyKey = signal<string | null>(null);
  private readonly _attach = signal<Record<string, ResultAttachment[]>>({});
  private attachTargetId: string | null = null;
  private attachTargetParam: string | null = null;

  // Opt-in per VALUE: each parameter's `attachments: true` (the batch toggle
  // in Test Master) puts the paperclip on THAT row; the legacy Parameters-root
  // `attachments: true` means every value. No flag = no paperclip (existing
  // attachments stay visible so they can be removed).
  private readonly _attachInfoByTest = computed<Map<string, { all: boolean; params: Set<string> }>>(() => {
    const out = new Map<string, { all: boolean; params: Set<string> }>();
    for (const t of this._sample()?.tests ?? []) {
      try {
        const blob = JSON.parse(t.test?.parameters || "{}");
        const all = blob?.attachments === true;
        const params = new Set<string>();
        for (const p of blob?.parameters ?? []) {
          if (p?.attachments === true && p?.name) params.add(String(p.name));
        }
        if (all || params.size > 0) out.set(t.id, { all, params });
      } catch { /* malformed parameters — leave disabled */ }
    }
    return out;
  });
  attachEnabled(t: { id: string }): boolean {
    return this._attachInfoByTest().has(t.id);
  }
  attachEnabledForParam(t: { id: string }, p: { name: string }): boolean {
    const info = this._attachInfoByTest().get(t.id);
    return !!info && (info.all || info.params.has(p.name));
  }
  attachCountForParam(t: { id: string }, p: { name: string }): number {
    return this.attachmentsFor(t).filter((a) => a.param === p.name).length;
  }

  // ── Per-REPORT value picker (owner 2026-09-20, culture-checkbox pattern):
  // Test Master's `printPicker: true` marker puts a print checkbox on every
  // value row; unticked names ride order_tests.ReportHiddenJson and the
  // report renderer drops those rows for THIS order only. The setting follows
  // what was ORDERED — the profile's for a profile member, else the test's
  // (resolved by the server; see resolvePrintPicker). ────────────────────
  private readonly _reportHidden = signal<Record<string, string[]>>({});
  private readonly _printPickerByTest = computed<Set<string>>(() => {
    const out = new Set<string>();
    for (const t of this._sample()?.tests ?? []) {
      if (resolvePrintPicker(t)) out.add(t.id);
    }
    return out;
  });
  printPickerEnabled(t: { id: string }): boolean {
    return this._printPickerByTest().has(t.id);
  }
  /** Parameter names CRITICAL on this line (owner 2026-10-01: live-typed OR
   *  already saved — the same single check {@link isCriticalValue} the red
   *  input treatment uses). They always print, whatever the picker says (see
   *  {@link reportHiddenFor}). The saved-only mirror of mw's
   *  `PrintPickerRules.CriticalNames` ({@link criticalNames} from
   *  shared/utils/print-picker) agrees once the value is saved — what the
   *  server will actually print reads the SAME saved snapshot. */
  private criticalFor(t: OrderTest): string[] {
    return this.parametersFor(t).filter(p => this.isCriticalValue(t, p)).map(p => p.name);
  }
  /** Hidden value names as the tech sees them: this session's pick, else
   *  the SAVED pick (even "[]" — a saved choice is never reset on reload),
   *  else the resolved "Start with": 'none' → every value unticked. A
   *  CRITICAL value is never in this set — it always prints (owner
   *  2026-10-01), whatever the picker / saved hide-list says. */
  private reportHiddenFor(t: OrderTest): string[] {
    const critical = this.criticalFor(t);
    const local = this._reportHidden()[t.id];
    let hidden: string[];
    if (local) {
      hidden = local;
    } else {
      const raw = (t as { reportHiddenJson?: string | null }).reportHiddenJson;
      return effectiveHidden(raw, resolvePrintPickerDefault(t), this.parametersFor(t).map(p => p.name), critical);
    }
    if (critical.length === 0) return hidden;
    const crit = new Set(critical.map((c) => c.toLowerCase()));
    return hidden.filter((n) => !crit.has(n.toLowerCase()));
  }
  isValuePrinted(t: OrderTest, p: { name: string }): boolean {
    return !this.reportHiddenFor(t).includes(p.name);
  }
  /** The picker is on and EVERY value is unticked: nothing from this test
   *  reaches the report. Never shown per row (owner 2026-09-30: "no need to
   *  tell this") — it only feeds the one whole-batch check below. */
  nothingPrints(t: OrderTest): boolean {
    if (!this.printPickerEnabled(t)) return false;
    const params = this.parametersFor(t);
    return params.length > 0 && params.every(p => !this.isValuePrinted(t, p));
  }
  /** The ONE safeguard left (owner 2026-09-30): ask once, before a submit /
   *  validate, only when NOTHING AT ALL in the batch (the tube, or every tube
   *  on Submit all) would print — every line has the picker on with every
   *  value unticked. One ticked value anywhere, or any line without the
   *  picker, and there is no dialog. True = go ahead. */
  private async confirmNothingPrints(tests: readonly OrderTest[], verb: "submit" | "validate"): Promise<boolean> {
    if (!tests.length || !tests.every(t => this.nothingPrints(t))) return true;
    return this.dialog.confirm({
      title: "Nothing will print on this report",
      message: "Every value is unticked, so the report will leave out:",
      items: tests.map(t => t.test?.name ?? "Test"),
      question: `Tick the values that should print, or ${verb} anyway?`,
      cancelLabel: "Go back",
      confirmLabel: verb === "submit" ? "Submit anyway" : "Validate anyway",
    });
  }
  toggleValuePrinted(t: OrderTest, p: { name: string }) {
    // Critical always prints — nothing to toggle (owner 2026-10-01).
    if (this.criticalFor(t).some(n => n.toLowerCase() === p.name.toLowerCase())) return;
    const cur = this.reportHiddenFor(t);
    const next = cur.includes(p.name) ? cur.filter(n => n !== p.name) : [...cur, p.name];
    // A hand tick / untick makes the row the tech's own choice: clearing its
    // value later never unticks it, and more keystrokes never re-tick it.
    this._autoTicked.get(t.id)?.delete(p.name);
    this.setReportHidden(t.id, next);
  }

  // ── Entering a value ticks its print box (owner 2026-09-30) ───────────
  // Typing / picking a value into an EMPTY row ticks that row (the moment
  // the value appears — later keystrokes are not new entries, so a row the
  // tech unticked by hand stays unticked). Clearing the value of a row that
  // was ticked this way unticks it again; a hand-ticked row stays ticked.
  // In "All ticked" the row is already ticked → no-op. Only the tech's own
  // input (setValue) counts — load, draft restore, formulas and analyzer
  // prefill never move a tick, so a SAVED pick always wins on reload. Every
  // change is saved like a hand tick (order_tests.ReportHiddenJson).
  private readonly _autoTicked = new Map<string, Set<string>>();
  private autoTickOnEntry(testId: string, paramName: string, before: unknown, after: unknown) {
    const t = this._sample()?.tests?.find((x) => x.id === testId);
    if (!t || !this.printPickerEnabled(t)) return;
    const had = hasEnteredValue(before);
    const has = hasEnteredValue(after);
    if (had === has) return;
    const hidden = this.reportHiddenFor(t);
    if (has) {
      if (!hidden.includes(paramName)) return;          // already ticked
      let set = this._autoTicked.get(testId);
      if (!set) this._autoTicked.set(testId, (set = new Set()));
      set.add(paramName);
      this.setReportHidden(testId, hidden.filter((n) => n !== paramName));
    } else {
      const set = this._autoTicked.get(testId);
      if (!set?.has(paramName)) return;                 // ticked by hand / by default
      set.delete(paramName);
      if (!hidden.includes(paramName)) this.setReportHidden(testId, [...hidden, paramName]);
    }
  }
  /** Record + save a line's hidden list. One request per line in flight; a
   *  change made meanwhile is sent (as the LATEST list) when it returns, so
   *  quick ticks can never land on the server out of order. */
  private readonly _hiddenInFlight = new Set<string>();
  private readonly _hiddenDirty = new Set<string>();
  private readonly _hiddenIdle: Array<() => void> = [];
  /** Resolves once every print-choice save has reached the server (capped).
   *  Logic audit: Submit / Validate can issue the FINAL report straight away
   *  (direct flow), and the report reads the SAVED hidden list — a tick still
   *  in flight left that value off the issued final. */
  hiddenSettled(maxMs = 10_000): Promise<void> {
    if (this._hiddenInFlight.size === 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      const t = setTimeout(resolve, maxMs);
      this._hiddenIdle.push(() => { clearTimeout(t); resolve(); });
    });
  }
  private setReportHidden(testId: string, next: string[]) {
    this._reportHidden.update(m => ({ ...m, [testId]: next }));
    this.saveReportHidden(testId);
  }
  private saveReportHidden(testId: string) {
    if (this._hiddenInFlight.has(testId)) { this._hiddenDirty.add(testId); return; }
    this._hiddenInFlight.add(testId);
    const hidden = this._reportHidden()[testId] ?? [];
    const done = () => {
      this._hiddenInFlight.delete(testId);
      if (this._hiddenDirty.delete(testId)) this.saveReportHidden(testId);
      if (this._hiddenInFlight.size === 0) this._hiddenIdle.splice(0).forEach(r => r());
    };
    this.api.put(`/api/results/${testId}/report-hidden`, { hidden }).subscribe({
      complete: done,
      error: () => { done(); this.toasts.error("Could not save the print choice — retry."); },
    });
  }
  // ── "Print in bold" per value (owner 2026-09-30) ─────────────────────
  // A B toggle beside every result input (and Ctrl/Cmd+B inside it) makes
  // THAT value print bold on the report even when it is normal. It only ADDS
  // bold — an abnormal value prints bold regardless (Test Master rules).
  // The picks ride the result snapshot as `bold[]` (value names), sent with
  // every draft / submit; the report snapshot copies them (mw
  // BuildResultPayload) and report-pdf bolds the value cell.
  private readonly _bold = signal<BoldMap>({});
  boldFor(testId: string): string[] {
    return this._bold()[testId] ?? [];
  }
  isBold(t: { id: string }, p: { name: string }): boolean {
    return this.boldFor(t.id).includes(p.name);
  }
  /** The toggle writes only where the values can still be written. */
  canBold(t: OrderTest): boolean {
    return !this.viewOnly() && !this.isCultureTest(t)
      && t.status !== "entered" && t.status !== "validated" && t.status !== "rejected";
  }
  toggleBold(t: OrderTest, p: { name: string }) {
    if (!this.canBold(t)) return;
    const cur = this.boldFor(t.id);
    const next = cur.includes(p.name) ? cur.filter(n => n !== p.name) : [...cur, p.name];
    this._bold.update(m => ({ ...m, [t.id]: next }));
    this.scheduleServerAutosave();
  }
  /** Ctrl/Cmd+B while focus is inside a result's input toggles its bold. */
  onBoldKey(ev: KeyboardEvent, t: OrderTest, p: { name: string }) {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
    if (ev.key !== "b" && ev.key !== "B") return;
    ev.preventDefault();
    this.toggleBold(t, p);
  }
  /** Chip prefix for a value-tagged attachment — the value's display title. */
  attachParamTitle(t: OrderTest, a: ResultAttachment): string | null {
    if (!a.param) return null;
    const p = this.parametersFor(t).find(x => x.name === a.param);
    return p?.title || p?.name || a.param;
  }

  attachmentsFor(t: { id: string }): ResultAttachment[] {
    const local = this._attach()[t.id];
    if (local) return local;
    const raw = (t as { attachmentsJson?: string | null }).attachmentsJson;
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  /** Attachments are private uploads: thumbnails render from a blob: URL
   *  fetched with the session ('' until it lands). */
  attachSrc(a: ResultAttachment): string {
    return this.uploads.src(a.url);
  }
  /** The server answered 410 file_missing for it (it sat on a wiped disk). */
  attachMissing(a: ResultAttachment): boolean {
    return this.uploads.isMissing(a.url);
  }
  /** Videos aren't pre-fetched: the link opens a signed URL on click. */
  attachHref(a: ResultAttachment): string {
    return isPrivateUploadPath(a.url) ? '#' : this.uploads.src(a.url);
  }
  openAttach(ev: Event, a: ResultAttachment) {
    if (!isPrivateUploadPath(a.url)) return;
    ev.preventDefault();
    void this.uploads.open(a.url);
  }
  pickAttachment(t: { id: string }, input: HTMLInputElement, param?: string) {
    this.attachTargetId = t.id;
    this.attachTargetParam = param ?? null;
    input.click();
  }
  async onAttachPicked(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    const targetId = this.attachTargetId;
    if (!files.length || !targetId) return;
    this.attachBusyKey.set(`${targetId}|${this.attachTargetParam ?? ''}`);
    this.attachBusy.set(true);
    try {
      const target = { id: targetId };
      let list = this.attachmentsFor(target);
      for (const file of files) {
        const kind: ResultAttachment["kind"] = file.type.startsWith("video/") ? "video" : "image";
        if (file.size > (kind === "video" ? 30 : 5) * 1024 * 1024) {
          this.toasts.error(`${file.name}: too large — max ${kind === "video" ? 30 : 5} MB`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file, file.name);
        const resp = await this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(
          `${this.platform.getApiUrl()}/api/uploads/result-file`, fd).toPromise();
        if (!resp?.success || !resp.data?.url) {
          this.toasts.error(resp?.message ?? `${file.name}: upload failed`);
          continue;
        }
        list = [...list, {
          id: Math.random().toString(36).slice(2, 10),
          url: resp.data.url,
          kind,
          show: kind === "image",       // images print by default; videos never
          name: file.name,
          param: this.attachTargetParam ?? undefined,
        }];
      }
      if (list !== this.attachmentsFor(target)) await this.saveAttachments(targetId, list);
    } catch {
      this.toasts.error("Upload failed — check the connection and try again.");
    } finally {
      this.attachBusy.set(false);
    }
  }
  toggleAttachmentShow(t: { id: string }, a: ResultAttachment) {
    if (a.kind !== "image") return;
    void this.saveAttachments(t.id,
      this.attachmentsFor(t).map(x => x.id === a.id ? { ...x, show: !x.show } : x));
  }
  removeAttachment(t: { id: string }, a: ResultAttachment) {
    void this.saveAttachments(t.id, this.attachmentsFor(t).filter(x => x.id !== a.id));
  }
  private async saveAttachments(otId: string, list: ResultAttachment[]) {
    this._attach.update(m => ({ ...m, [otId]: list }));
    try {
      await firstValueFrom(this.api.put<{ id: string }>(
        `/api/results/${otId}/attachments`, { attachments: list }));
    } catch {
      this.toasts.error("Could not save the attachments — retry.");
    }
  }
}

interface ResultAttachment {
  id: string;
  url: string;
  kind: "image" | "video";
  show: boolean;
  name?: string | null;
  /** The value (parameter name) this file belongs to; absent = whole test. */
  param?: string | null;
}
