import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { TrendTest } from "../../../shared/utils/trend-chart";
import {
  describeAllRanges,
  flagAgainst,
  normalizeSex,
  selectReferenceRange,
} from "../../../shared/utils/reference-range";
import { qualitativeOptionsFor } from "../../../shared/utils/qualitative";
import {
  CalcContext,
  CalcDef,
  ageYearsFromDob,
  evaluateCalc,
  parseCalc,
} from "../../../shared/utils/calculation";
import { TenantStateService } from "../../../core/services/tenant-state.service";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ApiService } from "../../../core/services/api.service";
import { ToastService } from "../../../core/services/toast.service";
import { NavBackService } from "../../../core/services/nav-back.service";
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
import { LoadingLogoComponent } from "../../../shared/components/loading-logo/loading-logo.component";
import { SelectComponent } from "../../../shared/primitives/select.component";
import { CultureEntryComponent } from "../culture-entry/culture-entry.component";
import { CultureResult } from "../../../shared/models/culture.model";
import { formatPatientInfo } from "../../../shared/models/patient.model";

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
    CommonModule,
    FormsModule,
    CommentThreadComponent,
    SelectComponent,
    LoadingLogoComponent,
    CultureEntryComponent,
  ],
  templateUrl: "./sample-result-entry.component.html",
  styleUrl: "./sample-result-entry.component.scss",
})
export class SampleResultEntryComponent {
  private readonly host = inject(ElementRef);
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly navBack = inject(NavBackService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly tenantState = inject(TenantStateService);
  protected readonly formatPatient = formatPatientInfo;

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
      age: typeof p?.age === "number" ? p.age : null,
    };
  }

  /** Instant H/L/critical chip as the tech types. Criticals are strict </>;
   *  in-range flags route through the ONE shared flagAgainst rule with the
   *  band picked for THIS patient's sex/age. Backend stays source of truth. */
  flagFor(t: OrderTest, p: TestParameter): LiveFlag | null {
    if (this.inputKindFor(p) !== "number") return null;
    const raw = this.getValue(t.id, p.name);
    if (raw === undefined || raw === null || raw === "") return null;
    const v = Number(String(raw).trim());
    if (Number.isNaN(v)) return null;
    if (p.criticalLow != null && v < p.criticalLow)
      return { tone: "critical", label: `Critical · below ${p.criticalLow}` };
    if (p.criticalHigh != null && v > p.criticalHigh)
      return { tone: "critical", label: `Critical · above ${p.criticalHigh}` };
    const { sex, age } = this.patientSexAge();
    const fl = flagAgainst(selectReferenceRange(p.referenceRanges, sex, age), v);
    if (fl === "L") return { tone: "low", label: "Low" };
    if (fl === "H") return { tone: "high", label: "High" };
    if (fl === "N") return { tone: "normal", label: "Normal" };
    return null;
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

  /** Pressing Enter inside any result input field advances focus to the next
   *  result field in DOM sequence (like Tab), skipping edit buttons. */
  onEnterKey(event: Event) {
    event.preventDefault();
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const container = this.host.nativeElement as HTMLElement;
    const inputs = Array.from(
      container.querySelectorAll<HTMLElement>(
        "input.pf-sre__ginput, input.pf-sre__input, select.pf-sre__ginput, select.pf-sre__input, textarea.pf-sre__ginput, textarea.pf-sre__input, input.pf-sre__cb, .pf-sre__select-wrap .pf-dd__trigger",
      ),
    ).filter((el) => {
      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !el.hasAttribute("disabled")
      );
    });

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
      const submitBtn = container.querySelector<HTMLElement>(".pf-sre__submit");
      if (submitBtn && !submitBtn.hasAttribute("disabled")) {
        submitBtn.focus();
      } else {
        inputs[0].focus();
      }
    }
  }
  /** Medical registration ID beside the name — a dash until the user sets one
   *  (editable on the My signature screen). */
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
    if (!s?.tests) return s;
    return { ...s, tests: sortTestsForDisplay(s.tests) };
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

  // ── Trendogram: add serial-result trend charts to this order's report ──
  readonly trendEligible = signal<TrendTest[]>([]);
  readonly trendogramOn = signal(false);
  readonly trendogramDuration = signal("5");
  private trendPatientId: string | null = null;

  constructor() {
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
        t.status !== "rejected",
    ),
  );

  /** Load each test's last saved values into the form (used on first load and
   *  after a re-open, so the prior submitted values come back for editing). */
  private prefillValues(sample: OrderSample | null) {
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
            params = blob.parameters ?? [];
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
  // Tests flagged microFormat=culture_sensitivity render the structured
  // culture screen (pf-culture-entry) instead of the flat parameter grid.
  // The whole CultureResult is stored as that test's values payload.
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
  cultureValueFor(t: OrderTest): CultureResult {
    return (this._values()[t.id] ?? {}) as CultureResult;
  }
  setCulture(testId: string, v: CultureResult) {
    this._values.update((all) => ({
      ...all,
      [testId]: v as unknown as Record<string, unknown>,
    }));
    this.scheduleDraftSave();
    this.scheduleServerAutosave();
  }

  // ── Background server autosave ────────────────────────────────────
  // A silent, debounced draft POST so typed-but-unsubmitted results reach
  // the server without the tech pressing Save draft. Unlike the manual
  // saveDraft() it does NOT navigate away, does NOT toast, and does NOT
  // reset the sample (which would disrupt in-progress typing). The manual
  // Save draft button stays exactly as-is.
  private scheduleServerAutosave() {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      void this.autoSaveDraft();
    }, 2500);
  }

  private async autoSaveDraft() {
    const s = this._sample();
    if (!s || this._submitting() || this._savingDraft() || this._autosaving())
      return;
    const all = this._values();
    const writable = (s.tests ?? []).filter(
      (t) => t.status !== "validated" && t.status !== "entered",
    );
    const payload = {
      results: writable
        .filter((t) => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map((t) => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined,
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
      this._lastSavedAt.set(new Date());
      // Keep the local crash-recovery copy until a manual save/submit clears it.
    } catch {
      /* silent — the localStorage draft remains the fallback */
    } finally {
      this._autosaving.set(false);
    }
  }

  inputKindFor(
    p: TestParameter,
  ): "number" | "textarea" | "select" | "checkbox" | "date" | "text" {
    switch (p.type as string) {
      case "numeric":
      case "numeric_with_range":
      case "number":
      case "decimal":
      case "float":
      case "integer":
      case "int":
        return "number";
      case "textarea":
        return "textarea";
      case "select":
      case "radio":
      case "button_select":
        return "select";
      case "yesno":
      case "toggle":
        return "checkbox";
      case "date":
        return "date";
      default:
        // Qualitative positive/negative-ish parameters (by options OR type)
        // render as a dropdown, never a free text box.
        return qualitativeOptionsFor(p) ? "select" : "text";
    }
  }

  /** Options for a select parameter. Qualitative detection may supply a
   *  default Positive/Negative-style pair when the schema has none. */
  selectOptionsFor(p: TestParameter): string[] {
    return qualitativeOptionsFor(p) ?? p.options ?? [];
  }

  /** Grid vs form view — grid is the default (mirrors report PDF columns).
   *  Persisted across sessions in localStorage. */
  private readonly _viewMode = signal<"grid" | "form">(
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("pf-sre-view") as "grid" | "form")) ||
      "grid",
  );
  readonly viewMode = this._viewMode.asReadonly();
  setViewMode(mode: "grid" | "form") {
    this._viewMode.set(mode);
    try {
      localStorage.setItem("pf-sre-view", mode);
    } catch {
      /* no-op */
    }
  }

  /** Per-test "show overall observation thread" toggle. The thread block
   *  is heavy (composer textarea + buttons), so we keep it collapsed until
   *  the tech clicks the compact "+ Note" pill in the test header. Threads
   *  with existing comments stay always-visible (see template @if). */
  private readonly _overallOpen = signal<Set<string>>(new Set<string>());
  isOverallOpen(testId: string): boolean {
    return this._overallOpen().has(testId);
  }
  toggleOverall(testId: string) {
    const next = new Set(this._overallOpen());
    next.has(testId) ? next.delete(testId) : next.add(testId);
    this._overallOpen.set(next);
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
    const bands = describeAllRanges(p.referenceRanges);
    if (bands.length) return bands.join(" · ");
    if (p.normalValue) return p.normalValue;
    return "";
  }

  /** Methodology lives on the legacy TestParameter, dropped through from
   *  the importer. Returns '—' so the column never reads blank. */
  methodologyOf(p: TestParameter): string {
    return (p as TestParameter & { methodology?: string }).methodology || "—";
  }

  getValue(testId: string, paramName: string): unknown {
    return this._values()[testId]?.[paramName] ?? "";
  }

  setValue(testId: string, paramName: string, v: unknown) {
    this._values.update((all) => ({
      ...all,
      [testId]: { ...(all[testId] ?? {}), [paramName]: v },
    }));
    // Typing INTO a calculated field is an override (analyzers report some of
    // these directly); clearing it hands the field back to the formula.
    // Typing into anything else re-runs the dependent formulas.
    this.markCalcOverride(testId, paramName, v);
    this.recomputeCalcFields(calcKey(testId, paramName));
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
    const age =
      typeof patient?.age === "number"
        ? patient.age
        : ageYearsFromDob(patient?.dateOfBirth);
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

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get("sampleId");
    if (!id) {
      this._loading.set(false);
      return;
    }
    this.draftKey = `pf-lms.sre-draft.${id}`;
    try {
      const sample = await firstValueFrom(
        this.api.get<OrderSample>(`/api/samples/${id}/tests`),
      );
      this._sample.set(this.normalizeSample(sample ?? null));
      // Pre-fill from any existing currentResult JSON so the tech can edit
      // a previously-entered value rather than starting from blank.
      this.prefillValues(sample ?? null);
      // Then overlay any locally-autosaved draft — typing that never
      // reached the server (app killed mid-entry) beats the prefill.
      this.restoreDraft();
      // Calc fields: stored values that match their formula stay live-updating;
      // ones that differ were overridden. Needs the tenant for ISI/MNPT.
      this.tenantState.ensureLoaded();
      this.seedCalcState();
      await this.loadComments();
    } catch (e) {
      this.toasts.error("Could not load sample");
    } finally {
      this._loading.set(false);
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
    this._submitting.set(true);
    const all = this._values();
    // Skip tests that the backend will refuse:
    //   - 'validated' is signed off (must be rejected before re-entry)
    //   - 'entered' is awaiting validation (re-saving overwrites the
    //     submitted value, which the backend blocks too)
    // The form pre-fills values for these from currentResult so they
    // can be SEEN, but submitting them would 409 the whole batch.
    const writable = (s.tests ?? []).filter(
      (t) => t.status !== "validated" && t.status !== "entered",
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
    const payload = {
      results: writable
        .filter((t) => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map((t) => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined,
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
      this._sample.set(this.normalizeSample(resp?.sample ?? s));
      // Values reached the server — the local crash-recovery draft is done.
      this.clearDraft();
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
      (t) => t.status !== "validated" && t.status !== "entered",
    );
    const payload = {
      results: writable
        .filter((t) => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map((t) => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined,
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

  back() {
    this.router.navigate(["/lab/my-work"]);
  }
}
