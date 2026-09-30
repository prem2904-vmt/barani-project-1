import { Location, NgTemplateOutlet } from '@angular/common';
import { PfKeysDirective } from '../../../shared/components/numpad/pf-keys.directive';
import { PF_KEYS_EVENT, PF_KEYS_HEIGHT_VAR, PfKeysEnterTone } from '../../../shared/components/numpad/numpad.service';
import { PfKeysKind, PfKeysPrefix, deptPrefixes } from '../../../shared/components/numpad/pf-keys-layouts';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, OnDestroy, AfterViewInit, HostListener, computed, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TrendTest } from '../../../shared/utils/trend-chart';
import { firstValueFrom } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Order } from '../../../shared/models/order.model';
import { Bill } from '../../../shared/models/bill.model';
import { payBillFromWallet } from '../../../shared/utils/wallet-payment';
import { Patient, formatPatientInfo, patientDisplayName } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import { filterTestList as sharedFilterTestList, filterTestListStrict } from '../../../shared/utils/test-search';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { effectivePrice, isNotOfferedError, isOffered, isPriceDefault, taxSlabOf } from '../../../shared/utils/test-pricing';
import { computeBill } from '../../../shared/utils/bill-math';
import { cartOverlaps, overlapMessage, overlapOnAdd } from './cart-duplicates';
import { suggestBundles, type PackageSuggestion as BundleSuggestion } from './package-suggest';
import { PackageSuggestCardComponent } from './package-suggest-card.component';
import { collectedItemIds, orderedItemIds, type OrderLike } from './order-edit-items';
import { cartKey, discountNeedsSync, planConfirmOrder, type PendingOrder } from './pending-order';
import { buildOrderDraft, parseOrderDraft, orderDraftKey, orderDraftKeysFor, orderDraftInScope, parseOrderDraftKey, DraftScope } from './order-draft';
import { discountPctOf, fmtPct, percentDiscountAmount } from '../../../shared/utils/discount';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { extractAbhaNumber } from '../../../shared/components/abha-wizard/abha-prefill.component';
import { AuthService } from '../../../core/auth/auth.service';
import { generateInvoicePdf, invoiceTemplateFieldsFrom, loadImageDataUrl, invoiceGstinFrom } from '../billing/invoice-pdf';
import { waLink } from '../../../shared/utils/whatsapp';
import { environment } from '../../../../environments/environment';
import { InlinePaymentPanelComponent, InlinePaymentResult } from './inline-payment-panel.component';
import { SCOPE_PLACEHOLDERS, SCOPE_PLACEHOLDERS_SHORT, SCOPE_LABELS, SearchScope, ScopeRow, SEARCH_SCOPES } from './unified-search';

import { LabelCardComponent } from '../post-payment/label-card.component';
import { printTubeLabels } from '../../../shared/utils/print-label';
import { LabelPrintService } from '../../../core/printer/label-print.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { KeyboardService } from '../../../core/services/keyboard.service';
import {
  allowedSpecimensFor, asksSpecimen, deskDefaultCode, findAllowed, fixedSpecimenOf, hasSpecimen, specimenLinePrice,
  specimenLookupIds, specimenModeOf, type AllowedSpecimen, type TestSpecimenMap,
} from '../../../shared/utils/micro-specimen';
import { byName, mergeRecent, planRepeat, sortByName, type RepeatItem } from './catalogue-order';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { MIN_LOAD_MS, createLoadHold, heldFlag } from '../../../shared/utils/min-duration';
import { memberDepartmentNames, shownDepartmentName } from '../../../shared/utils/package-department';
import { testListUrl } from '../../../shared/utils/test-list-url';
import { formatAge } from '../../../shared/utils/patient-age';

type Priority = 'Normal' | 'Urgent';

/** Slimmed view of the patient-history row used for repeat-order seeding.
 *  Mirrors the enriched shape returned by GET /api/patients/{id}. */
interface HistoryRow {
  id: string;
  createdAt: string;
  samples?: Array<{ tests?: Array<{ testId?: string; packageTestId?: string; test?: { id?: string } }> }>;
}

@Component({
  selector: 'pf-order-create',
  standalone: true,
  imports: [NgTemplateOutlet, CurrencyInrPipe, HeroBandComponent, BarcodeScannerModalComponent, InlinePaymentPanelComponent, LabelCardComponent, SelectComponent, SegmentedComponent, SkeletonComponent, SkeletonRowsComponent, ZoomTargetDirective, PfKeysDirective, BusyDirective, PackageSuggestCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-create.component.html',
  styleUrls: ['./order-create.component.scss']
})
export class OrderCreateComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly labelPrint = inject(LabelPrintService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly locationSvc = inject(Location);
  // Workflow is the source of truth for whether billing is a separate counter.
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly auth = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly keyboard = inject(KeyboardService);

  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  /** The unified search pill (tiles + input + urgent) — outside-click target. */
  readonly pillEl = viewChild<ElementRef<HTMLElement>>('pill');
  /** The live payment pane — its Confirm is rendered in the billing card's
   *  pinned footer (designer panel), so the host reads its label/state. */
  readonly payPanel = viewChild(InlinePaymentPanelComponent);
  /** The billing card's scroll body — the pill's cart icon scrolls it into view. */
  readonly billCard = viewChild<ElementRef<HTMLElement>>('billCard');

  focusSearchInput() {
    setTimeout(() => {
      this.searchInput()?.nativeElement?.focus();
    }, 0);
  }

  private readonly _patient = signal<Patient | null>(null);

  // ── Opening a draft / an order (owner, 2026-09-27: "when I click a draft
  //    and open it I need an animation — no PF loading, a skeleton in that
  //    part") ─────────────────────────────────────────────────────────────
  /** The record this screen opens with is still loading (patient for a
   *  ?patientId= draft, the order for ?orderId= / ?editOrderId=). */
  private readonly _opening = signal(false);
  private readonly zoom = inject(ZoomTransitionService);
  /** Only hold for the zoom when this screen was opened for a record. */
  private readonly _openingZoom = signal(false);
  /** Skeleton on (patient tile, picks chip, cart rows) while the record
   *  loads OR the list → order zoom is still morphing — held for at least
   *  MIN_LOAD_MS so a fast load reads as one calm motion, never a flash. */
  readonly opening = heldFlag(computed(() => this._opening() || (this._openingZoom() && this.zoom.holding())), MIN_LOAD_MS);
  /** Zoom keys this order screen answers to: the draft row / shelf chip
   *  (patient id, `fd:<patientId>`) or an order tile (order id). */
  readonly zoomKeys = signal<string[]>([]);
  private setOpeningKeys(pid: string | null, orderId: string | null): void {
    const keys = [pid, pid ? 'fd:' + pid : null, orderId].filter((k): k is string => !!k);
    this.zoomKeys.set(keys);
    this._openingZoom.set(keys.length > 0);
  }
  private readonly _tests = signal<Test[]>([]);
  /** First open: the orderable catalogue has not answered yet. Held so a
   *  fast answer never flashes; skipped when it answers in the same turn. */
  private readonly testsHold = createLoadHold(true);
  /** Catalogue skeleton: first load only (a background resync keeps the
   *  rows on screen). */
  readonly catalogSkeleton = computed(() => this.testsHold.active() && this._tests().length === 0);
  private readonly _saving = signal(false);
  private readonly _selected = signal<string[]>([]);
  // ── Specimen choice at the desk: testId → specimen CODE ──
  // The Test Master decides (shared/utils/micro-specimen, the server's
  // SpecimenRules twin): a "choose" test — or a bundle carrying one — picks
  // ONLY from its allowed specimens; a "fixed" test shows no picker (the
  // server stamps its one specimen); "none" shows nothing.
  private readonly _specimens = signal<Record<string, string>>({});
  /** The Specimen master (code + name) — what a test with an EMPTY allowed
   *  list offers; also names a stored code. */
  readonly specimenMaster = signal<AllowedSpecimen[]>([]);
  /** Kept for the template's "is there anything to pick" guard. */
  readonly specimenOpts = computed<PfSelectOption[]>(() => this.specimenMaster().map(s => ({ value: s.code, label: s.name })));
  /** test id → its allowed list (+ mode, default, prices), as loaded. */
  private readonly _specimenMaps = signal<Record<string, TestSpecimenMap | undefined>>({});
  private readonly _testById = computed(() => new Map(this._tests().map(t => [t.id, t] as const)));
  asksSpecimen(t: { parameters?: string | null; type?: string | null }): boolean {
    const byId = this._testById();
    return asksSpecimen(t, id => byId.get(id));
  }
  /** The allowed specimens for one cart line (a bundle: what every choosing
   *  member allows), as picker options — value = the master CODE. */
  private readonly _allowedById = computed<Record<string, AllowedSpecimen[]>>(() => {
    const byId = this._testById();
    const maps = this._specimenMaps();
    const master = this.specimenMaster();
    const out: Record<string, AllowedSpecimen[]> = {};
    for (const id of this._selected()) {
      const t = byId.get(id);
      if (t && this.asksSpecimen(t)) out[id] = allowedSpecimensFor(t, maps, master, mid => byId.get(mid));
    }
    return out;
  });
  allowedFor(id: string): AllowedSpecimen[] { return this._allowedById()[id] ?? []; }
  specimenOptsFor(id: string): PfSelectOption[] {
    return this.allowedFor(id).map(s => ({
      value: s.code, label: s.name,
      hint: s.price != null ? this.inrFmt.transform(Number(s.price)) : undefined,
    }));
  }
  /** Mode fixed: the specimen the server will stamp (shown, never picked). */
  fixedSpecimenName(t: { id: string; parameters?: string | null }): string | null {
    if (specimenModeOf(t.parameters) !== 'fixed') return null;
    return fixedSpecimenOf(this._specimenMaps()[t.id])?.name ?? null;
  }
  specimenOf(id: string): string { return this._specimens()[id] ?? ''; }
  /** The NAME of the line's specimen (a stored code or an older name). */
  specimenLabel(id: string): string {
    const v = this.specimenOf(id);
    if (!v) return '';
    return (findAllowed(this.allowedFor(id), v) ?? findAllowed(this.specimenMaster(), v))?.name ?? v;
  }
  /** The allowed row the line's pick names (null = none / not allowed). */
  private chosenRow(id: string): AllowedSpecimen | null {
    return findAllowed(this.allowedFor(id), this.specimenOf(id));
  }
  setSpecimen(id: string, v: string) {
    this._specimens.update(m => ({ ...m, [id]: v }));
    this._defaultApplied.add(id);
    if (v) this._specimenErr.update(m => { if (!m[id]) return m; const n = { ...m }; delete n[id]; return n; });
  }

  // ── "There is no default" (owner 2026-09-27) ──
  // The specimen starts EMPTY unless the test's Test–Specimen Mapping marks
  // exactly ONE default (then it is preselected); a bundle preselects only
  // when every asking member names the same single default. Picking is
  // REQUIRED before the order is saved or paid.
  /** test id → its single mapped default (null = none / several). */
  private readonly _specimenDefaults = signal<Record<string, string | null>>({});
  private readonly _defaultsAsked = new Set<string>();
  /** Lines whose default was already applied (or that the user picked) —
   *  never re-preselected, so clearing a pick sticks. */
  private readonly _defaultApplied = new Set<string>();
  /** Lines already on the order being edited: their specimen is history
   *  (the server never re-checks them), so they are not required here. */
  private readonly _onOrderIds = signal<ReadonlySet<string>>(new Set());
  /** Inline "Choose the specimen" per cart line (set by a blocked save/pay). */
  private readonly _specimenErr = signal<Record<string, true>>({});
  specimenError(id: string): boolean { return !!this._specimenErr()[id]; }
  /** Cart lines that choose a specimen and have none — they block save/pay.
   *  Only when there is something to pick (the allowed list, or the master). */
  readonly missingSpecimenIds = computed<string[]>(() => {
    if (this.specimenOpts().length === 0) return [];
    const byId = this._testById();
    const onOrder = this._onOrderIds();
    return this._selected().filter(id => {
      const t = byId.get(id);
      return !!t && !onOrder.has(id) && !this.isCollected(id) && this.asksSpecimen(t) && !this.specimenOf(id);
    });
  });
  /** Guard for Continue / Proceed / Confirm: true (and every missing picker
   *  shows its inline error, the first one scrolled to + focused) when a
   *  specimen is still to be chosen, so the caller stops. */
  requireSpecimens(): boolean {
    const missing = this.missingSpecimenIds();
    if (missing.length === 0) return false;
    this._specimenErr.set(Object.fromEntries(missing.map(id => [id, true as const])));
    this.billPhase.set('cart');
    setTimeout(() => {
      const host = typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>(`[data-spec-id="${missing[0]}"]`) : null;
      host?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      host?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    }, 0);
    return true;
  }
  /** Read the allowed lists (+ defaults, prices) of cart lines not yet asked about. */
  private loadSpecimenDefaults(ids: string[]) {
    const fresh = ids.filter(id => !this._defaultsAsked.has(id));
    if (fresh.length === 0) return;
    fresh.forEach(id => this._defaultsAsked.add(id));
    this.api.get<TestSpecimenMap[]>(`/api/microbiology/test-specimens?testIds=${fresh.join(',')}`).subscribe({
      next: rows => {
        this._specimenMaps.update(m => {
          const n = { ...m };
          for (const id of fresh) n[id] = { testId: id, specimens: [] };
          for (const r of rows ?? []) n[r.testId] = { ...r, specimens: r.specimens ?? [] };
          return n;
        });
        this._specimenDefaults.update(m => {
          const n = { ...m };
          for (const id of fresh) n[id] = null;
          for (const r of rows ?? []) n[r.testId] = r.defaultSpecimen ?? null;
          return n;
        });
      },
      error: () => { /* no mapping (or micro module absent): the master is offered, nothing preselects */ }
    });
  }
  /** Preselect the single default (by code) on lines that have no choice yet. */
  private applySpecimenDefaults() {
    if (this.isReadOnly()) return;
    const byId = this._testById();
    const maps = this._specimenMaps();
    const picks: Record<string, string> = {};
    for (const id of this._selected()) {
      if (this._defaultApplied.has(id) || this.specimenOf(id)) continue;
      const t = byId.get(id);
      if (!t || !this.asksSpecimen(t)) continue;
      const lookup = specimenLookupIds(t, mid => byId.get(mid));
      if (lookup.some(l => !maps[l])) continue;              // still loading
      this._defaultApplied.add(id);
      const d = deskDefaultCode(t, maps, mid => byId.get(mid));
      if (d && this.allowedFor(id).some(s => s.code.toUpperCase() === d)) picks[id] = d;
    }
    if (Object.keys(picks).length) this._specimens.update(m => ({ ...m, ...picks }));
  }
  /** Only the chosen specimens for tests still in the cart. */
  private specimenPayload(): Record<string, string> | null {
    const sel = new Set(this._selected());
    const out: Record<string, string> = {};
    for (const [id, sp] of Object.entries(this._specimens()))
      if (sel.has(id) && sp) out[id] = sp;
    return Object.keys(out).length ? out : null;
  }
  private loadSpecimens() {
    this.api.get<{ code: string; name: string; container?: string | null }[]>('/api/microbiology/specimens').subscribe({
      next: rows => this.specimenMaster.set((rows ?? []).map(r => ({ code: r.code, name: r.name, isDefault: false, container: r.container ?? null }))),
      error: () => { /* micro module absent — culture tests simply show no picker */ }
    });
  }
  private readonly _priority = signal<Priority>('Normal');

  // ── Trendogram: offer to embed serial-result trend charts in the report ──
  /** Tests this patient has taken 2+ times (from /lab-trends) — eligibility. */
  readonly trendEligible = signal<TrendTest[]>([]);
  readonly trendogramOn = signal(false);
  readonly trendogramDuration = signal<string>('5');
  /** Duration choices (pf-select — no native <select>). */
  readonly trendDurationOpts: PfSelectOption[] = [
    { value: '5', label: 'Last 5 tests' },
    { value: '10', label: 'Last 10 tests' },
    { value: '3m', label: 'Last 3 months' },
    { value: '6m', label: 'Last 6 months' },
    { value: 'all', label: 'All time' },
  ];
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
    // Specimen defaults: read the mapping for asking cart lines, then
    // preselect a single default (none / several → the picker stays empty).
    effect(() => {
      const byId = this._testById();
      if (this.specimenOpts().length === 0) return;
      const ids = this._selected().flatMap(id => {
        const t = byId.get(id);
        return t && this.asksSpecimen(t) ? specimenLookupIds(t, mid => byId.get(mid)) : [];
      });
      if (ids.length) this.loadSpecimenDefaults(ids);
    });
    effect(() => {
      this._specimenMaps(); this._selected(); this.specimenOpts(); this._testById();
      this.applySpecimenDefaults();
    });
    // A FIXED test's stamp (and its price) also come from its map, so read it
    // for every selected line that carries a specimen at all.
    effect(() => {
      const byId = this._testById();
      const ids = this._selected().filter(id => {
        const t = byId.get(id);
        return !!t && specimenModeOf(t.parameters) === 'fixed';
      });
      if (ids.length) this.loadSpecimenDefaults(ids);
    });
    // Fetch trend eligibility whenever the attached patient changes.
    effect(() => {
      const p = this._patient();
      if (p?.id) this.loadTrendEligible(p.id);
      else { this.trendEligible.set([]); this.trendogramOn.set(false); this.trendogramCharts.set(null); }
    });
  }

  /** lg+ (iPad-landscape and up): the billing card is a persistent right
   *  column. Below it, the same card opens as the checkout drawer. Only ONE
   *  of the two is ever rendered, so the pay pane (and its pinned Confirm)
   *  exists exactly once. */
  private static readonly LG_MQ = '(min-width: 1024px)';
  private readonly _lgMql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(OrderCreateComponent.LG_MQ) : null;
  readonly isLg = signal(!!this._lgMql?.matches);
  private readonly _onLgChange = (e: MediaQueryListEvent) => this.isLg.set(e.matches);

  /** ONE search mode per device type (owner): a mouse + hover device (web /
   *  desktop) searches in the DROPDOWN under the pill and the catalogue
   *  never changes; a touch device (iPad / phone) has NO dropdown for tests:
   *  the catalogue card itself becomes the results. Reactive via matchMedia. */
  private static readonly WEB_MQ = '(hover: hover) and (pointer: fine)';
  private readonly _webMql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(OrderCreateComponent.WEB_MQ) : null;
  readonly isWebSearch = signal(this._webMql ? !!this._webMql.matches : true);
  private readonly _onWebChange = (e: MediaQueryListEvent) => this.isWebSearch.set(e.matches);
  readonly searchMode = computed<'dropdown' | 'incard'>(() => this.isWebSearch() ? 'dropdown' : 'incard');

  /** Phone width (≤640): short placeholders, icon-only scope segment. */
  private static readonly PHONE_MQ = '(max-width: 640px)';
  private readonly _phoneMql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(OrderCreateComponent.PHONE_MQ) : null;
  readonly isPhone = signal(!!this._phoneMql?.matches);
  private readonly _onPhoneChange = (e: MediaQueryListEvent) => this.isPhone.set(e.matches);

  /** The checkout sheet (below lg) is open. The app's bottom navbar stays
   *  visible (owner rule): the sheet sits ON TOP of it (bottom = nav height)
   *  so its sticky footer is never under the nav. */
  readonly sheetOpen = computed(() => this.cartOpen() && !this.isLg());
  private readonly _onVisibleResync = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.loadOrderableTests();
  };
  private loadOrderableTests(): void {
    this.api.get<Test[]>(testListUrl({ activeOnly: true })).subscribe({
      // Belt and braces: even if a stale cache or future endpoint slips an
      // inactive row through, it never reaches the picker.
      // A test the tenant/branch doesn't offer (pricing table `is_offered`
      // = false) is not orderable either — ordering it would 409.
      next: l => { this._tests.set((l ?? []).filter(t => t.isActive !== false && isOffered(t))); this.testsHold.done(); },
      error: e => { this.testsHold.done(); this.toasts.error(`Could not load tests: ${e?.message ?? 'unknown error'}`); }
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
  /** Per-user pinned test ids, fetched from /api/test-picker/favorites. */
  readonly favouriteIds = signal<Set<string>>(new Set());
  /** Per-user recent test ids, fetched from /api/test-picker/recent. */
  readonly recentIds = signal<string[]>([]);

  // ── Ref-hospital + ref-doctor state ───────────────────────────────
  // Both are picked through the unified search pill's Doctor / Hospital
  // tiles (see the "Unified search" section). The value is free text — the
  // backend stores the name — so a new doctor/hospital is simply typed.
  readonly refHospitalName = signal<string>('');
  readonly refHospitalSuggestions = signal<string[]>([]);
  private refHospitalDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly refDoctorName = signal<string>('');
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
    if (isNotOfferedError(err)) {
      this.toasts.error('One of these tests is not offered at this branch any more. Remove it and try again.');
      this.loadOrderableTests();
      return;
    }
    switch (err.field) {
      case 'discount':        this.discountServerError.set(err.message); this.toasts.error(err.message); return;
      case 'refHospitalName': this.refHospitalError.set(err.message); return;
      case 'refDoctorName':   this.refDoctorError.set(err.message);   return;
      case 'specimen':        if (this.requireSpecimens()) return; this.toasts.error(err.message); return;
      default:                this.toasts.error(err.message);
    }
  }

  /** Per-patient localStorage key for draft order carts. We keep one
   *  draft per patient so reception can resume any half-built order
   *  on the same browser. Drafts older than 7 days are dropped on
   *  restore. */
  /** The branch this desk is working in. Drafts belong to it: a cart parked
   *  in Salem is never listed or restored in Trichy (see order-draft.ts). */
  private draftScope(): DraftScope {
    const u = this.auth.user?.();
    return {
      tenantId: u?.tenantId ?? null,
      branchId: this.auth.activeBranchId?.() ?? u?.branchId ?? null,
      defaultBranchId: u?.branchId ?? null,
    };
  }
  /** Drop this patient's draft in the current branch (never another branch's). */
  private removeDraft(patientId: string): void {
    for (const k of orderDraftKeysFor(this.draftScope(), patientId)) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  }
  private readonly DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  /** UI signal for "draft was just saved" — drives the toast badge. */
  private readonly _hasDraft = signal<boolean>(false);
  readonly hasDraft = this._hasDraft.asReadonly();

  readonly patient = this._patient.asReadonly();
  protected readonly formatPatient = formatPatientInfo;
  readonly saving = this._saving.asReadonly();
  readonly selected = this._selected.asReadonly();
  readonly priority = this._priority.asReadonly();
  readonly query = this._query.asReadonly();
  readonly cartOpen = this._cartOpen.asReadonly();

  readonly individualTests = computed(() => this._tests().filter(t => t.type === 'individual'));
  readonly packages = computed(() => {
    const list = this._tests().filter(t => t.type === 'package');
    return sortByName(list);   // A→Z; browse view: the pill query never filters the grid
  });
  /** Profiles — orderable coded bundles, their own filter tab (kept out of
   *  "All tests", which is individuals only). */
  readonly profiles = computed(() => {
    const list = this._tests().filter(t => t.type === 'profile');
    return this.filterByDept(list);   // browse view: never filtered by the query
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
      .map(([department, tests]) => ({ department, tests: tests.slice().sort(byName) }))
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
      const name = shownDepartmentName(t);   // a package carries no department
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
    // No user reordering exists for favourites, so they read A→Z like the
    // other lists (QA #4b). Browse view: the pill query never filters it.
    return sortByName(list);
  });

  /** Tests this user has ordered in the past, most-recent first. */
  readonly recentTests = computed<Test[]>(() => {
    const ids = this.recentIds();
    if (ids.length === 0) return [];
    const byId = new Map(this._tests().map(t => [t.id, t]));
    const list = ids.map(id => byId.get(id)).filter((t): t is Test => !!t && t.isActive);
    return list;   // browse view: the pill query never filters the grid
  });

  /** (Re)load this user's recent items from the server — the ordered
   *  tests, profiles and packages, most recent first. */
  private loadRecent(): void {
    this.api.get<string[]>('/api/test-picker/recent').subscribe({
      // Merge, don't clobber: an order placed a moment ago may not be in a
      // response that raced it.
      next: ids => this.recentIds.set(mergeRecent(this._justOrdered, ids ?? [])),
      error: () => { /* silent: keep what we have */ }
    });
  }
  /** Items ordered on this screen instance, newest first (the screen is
   *  reused across patients, so Recent must update without a reload). */
  private _justOrdered: string[] = [];
  /** An order was just placed with these cart ids: they go to the top of
   *  Recent right away (QA #4a), then the server list is re-read. */
  private noteOrdered(ids: readonly string[]): void {
    this._justOrdered = mergeRecent(ids, this._justOrdered);
    this.recentIds.set(mergeRecent(this._justOrdered, this.recentIds()));
    this.loadRecent();
  }

  /** True when the test id is in the user's favourites. */
  isFavourite(testId: string): boolean { return this.favouriteIds().has(testId); }

  readonly filteredTests = computed(() => {
    // The catalogue grid is a BROWSE view (tab + department). The pill's
    // query never filters it: search results live in the dropdown under the
    // pill, which stays visible above an on-screen keyboard (iPad / touch).
    return this.filterByDept(this.individualTests());
  });

  /** Search a (sub-)list; profile aliases are derived from the FULL loaded
   *  catalogue's memberships (SGOT is found by "LFT" / "liver"). */
  private filterTestList(list: Test[], q: string): Test[] {
    return sharedFilterTestList(list, q, this._tests());
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
        tests: tests.slice().sort(byName)
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

  /** Items in the cart that sit inside another bundle in the cart (owner rule:
   *  never orderable). Adds are refused up front (overlapOnAdd); this flags a
   *  cart that ARRIVED with one — a restored draft, a repeat, an appointment
   *  prefill — and blocks placing it until one side is removed. */
  readonly cartOverlapList = computed(() => cartOverlaps(this._tests(), this._selected()));
  readonly cartOverlapMessages = computed(() => this.cartOverlapList().map(o => overlapMessage(o)));

  /** Refuse an ADD that would put the same test in the order twice (a bundle
   *  beside its own member, either way round). Removing is never refused. */
  private refuseDuplicateAdd(id: string): boolean {
    if (this.isSelected(id)) return false;
    const o = overlapOnAdd(this._tests(), this._selected(), id);
    if (!o) return false;
    this.toasts.error(overlapMessage(o, !!this.editOrderId() && this._onOrderIds().has(o.container.id)));
    return true;
  }

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

  /** Price shown and totalled for a test: the DTO's effective price for the
   *  acting branch (pricing table), ₹1 when nobody has priced it — or, for a
   *  line ordered on a specimen with its OWN price (owner 2026-09-29), that
   *  price. Bundles keep one price. */
  priceOf(t: Test | null | undefined): number {
    if (!t) return 0;
    const base = effectivePrice(t);
    if (t.type !== 'individual' || !hasSpecimen(t.parameters)) return base;
    const row = specimenModeOf(t.parameters) === 'fixed'
      ? fixedSpecimenOf(this._specimenMaps()[t.id])
      : this.chosenRow(t.id);
    return specimenLinePrice(base, row);
  }
  /** Still at the ₹1 default (data only — the UI shows just the price). */
  notPriced(t: Test | null | undefined): boolean { return isPriceDefault(t); }
  isNotPriced(id: string): boolean { return isPriceDefault(this._tests().find(x => x.id === id)); }

  /** The billed lines of the cart: every selected test except a member that a
   *  package/profile in the cart already covers (billed within that package,
   *  #38–44). */
  private readonly billedLines = computed<Test[]>(() => {
    const all = this._tests();
    const covered = this.coveredMemberIds();
    const out: Test[] = [];
    for (const id of this._selected()) {
      const t = all.find(x => x.id === id);
      if (!t) continue;
      if (t.type !== 'package' && covered.has(id)) continue;
      out.push(t);
    }
    return out;
  });

  readonly subtotal = computed(() =>
    this.billedLines().reduce((a, t) => a + this.priceOf(t), 0));
  /** Tenant GST master switch — when off, the cart shows no tax (mirrors the
   *  backend bill, which bills at a zero slab → Bill of Supply). */
  readonly gstEnabled = signal(true);
  /** The cart as the bill's units: each billed line at its own `taxSlab`
   *  (0 when GST is off → Bill of Supply). */
  private readonly billUnits = computed(() => {
    const gstOn = this.gstEnabled();
    return this.billedLines().map(t => ({ price: this.priceOf(t), slab: gstOn ? taxSlabOf(t) : 0 }));
  });
  /** PRE-discount gross = subtotal + GST at full price — the total the patient
   *  sees before a discount and the ONE base every discount % / cap is measured
   *  on (server: BillingService.PreDiscountGross). */
  readonly grossTotal = computed(() => computeBill(this.billUnits(), 0).gross);
  /** The bill the server WILL raise (BillMath mirror): the discount comes off
   *  the taxable value, GST on the rest, split per line in whole paise. Drives
   *  the shown GST, the Total and the amount the payment panel charges. */
  readonly billPreview = computed(() => computeBill(this.billUnits(), this.discountAmount()));
  /** GST on the DISCOUNTED taxable value — exactly the invoice's GST. */
  readonly gst = computed(() => this.billPreview().tax);
  /** "GST · 5%" when every taxed line shares one slab, else plain "GST". */
  readonly gstLabel = computed(() => {
    const slabs = new Set(this.billedLines().map(t => taxSlabOf(t)).filter(x => x > 0));
    return slabs.size === 1 ? `GST · ${[...slabs][0]}%` : 'GST';
  });

  // ── Discount (cart preview; carried into billing) ──────────────
  /** Admin "Allow discounts" switch — hides the field entirely when off. */
  readonly allowDiscounts = signal(true);
  readonly maxDiscountPct = signal(100);
  readonly overrideDiscountPct = signal(100);
  readonly discountValue = signal<string>('');   // raw input
  readonly discountKind = signal<'flat' | 'percent'>('flat');
  /** The discount is frozen once the order is read-only or its payment is
   *  recorded (QA #3a) — the server rejects a change on a settled bill too. */
  readonly discountLocked = computed(() => this.orderLocked() || this.isPaymentSettled());
  setDiscountKind(k: 'flat' | 'percent') { if (this.discountLocked()) return; this.discountServerError.set(null); this.discountKind.set(k); }
  setDiscountValue(v: string) { if (this.discountLocked()) return; this.discountServerError.set(null); this.discountValue.set(v); }

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
    const base = this.grossTotal();
    // Percent → ₹ rounded DOWN to the paisa, never up to whole rupees: on a
    // small cart (₹3) 17% rounded to ₹1 = 33% and tripped the 25% cap.
    const amt = this.discountKind() === 'percent' ? percentDiscountAmount(base, raw) : raw;
    return Math.max(0, Math.min(amt, base));
  });
  /** Entered discount as a % of the pre-discount gross (subtotal + GST) — the
   *  same base the server's cap check uses (BillingService.PreDiscountGross). */
  readonly discountPct = computed(() => discountPctOf(this.discountAmount(), this.grossTotal()));
  /** True when the entered discount exceeds this user's cap → block + notify. */
  readonly discountOverCap = computed(() =>
    this.allowDiscounts() && this.discountAmount() > 0 && this.discountPct() > this.discountCapPct() + 0.01);
  /** Discount the bill will actually carry (≤ subtotal). */
  readonly discountApplied = computed(() => this.billPreview().discount);
  /** Total = the server bill's payable to the paisa (never gross − discount:
   *  ₹1000 @18% − ₹295 is 705 + 126.90 = ₹831.90, not 1180 − 295 = ₹885). */
  readonly total = computed(() => this.billPreview().payable);
  /** ±0.xx taking the exact taxable + GST to the whole-rupee Total (owner
   *  round-off rule) — shown as its own row when non-zero. */
  readonly roundOff = computed(() => this.billPreview().roundOff);
  /** Server-side discount rejection (e.g. cap) shown under the discount input;
   *  cleared on edit. */
  readonly discountServerError = signal<string | null>(null);

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
   * Package / profile suggestions (package-suggest.ts): a bundle that holds
   * something in the cart is shown as a SAVING (costs no more than the lines
   * it replaces — the only struck-through price) or a quiet UPGRADE (+₹X,
   * adds N tests, vs its members bought separately), else not at all.
   * Amounts use the cart's own billed unit per test (priceOf + GST slab)
   * through the BillMath mirror, so "Save ₹X" / "+₹X" is exactly the change
   * in the cart's pre-discount total when applied.
   */
  readonly packageSuggestions = computed<PackageSuggestion[]>(() => {
    const gstOn = this.gstEnabled();
    return suggestBundles(this._tests(), this._selected(),
      t => ({ price: this.priceOf(t), slab: gstOn ? taxSlabOf(t) : 0 }));
  });
  /** How a suggestion names a test — the cart's own display name. */
  readonly suggestName = (t: { name: string; shortName?: string | null }) => this.testDisplayName(t);

  ngAfterViewInit() {
    const hasPatientId = this.route.snapshot.queryParamMap.has('patientId');
    const hasEditOrderId = this.route.snapshot.queryParamMap.has('editOrderId');
    // No patient yet → open the pill on the Patient tile so reception can
    // type straight away (the old screen focused its patient box).
    if (!hasPatientId && !hasEditOrderId && !this.route.snapshot.queryParamMap.has('orderId') && !this.patient()) {
      setTimeout(() => this.selectScope('patient'), 0);
    }
  }

  ngOnInit() {
    this.loadSpecimens();
    this._lgMql?.addEventListener?.('change', this._onLgChange);
    this._webMql?.addEventListener?.('change', this._onWebChange);
    this._phoneMql?.addEventListener?.('change', this._onPhoneChange);
    if (typeof window !== 'undefined') {
      window.visualViewport?.addEventListener('resize', this._onViewport);
      window.addEventListener('resize', this._onViewport);
      window.addEventListener(PF_KEYS_EVENT, this._onViewport);
    }
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
    this.loadRecent();

    // Draft shelf: a later ?patientId= on this SAME, reused screen (another
    // parked order tapped in the app bar) swaps the patient + cart in place.
    this.stagedPid = this.route.snapshot.queryParamMap.get('patientId');
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(q => this.onQueryChange(q));

    // Deep-link support — if the route carries ?patientId= (e.g. coming
    // from a patient profile), pre-attach. Otherwise the inline picker
    // handles selection in-page.
    const orderId = this.route.snapshot.queryParamMap.get('orderId');
    this.setOpeningKeys(this.route.snapshot.queryParamMap.get('patientId'),
      orderId ?? this.route.snapshot.queryParamMap.get('editOrderId'));
    if (orderId) {
      this.viewOrderId.set(orderId);
      this.billPhase.set('pay');
      this._opening.set(true);
      this.api.get<Order>(`/api/orders/${orderId}`).subscribe({
        next: o => {
          this._opening.set(false);
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
          this.hydrateSpecimensFrom(o);
        },
        error: () => { this._opening.set(false); this.toasts.error('Could not load order details'); }
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
      this._opening.set(true);
      this.api.get<Order>(`/api/orders/${editOrderId}`).subscribe({
        next: o => {
          this._opening.set(false);
          if (o?.patient) this._patient.set(o.patient);
          if (o) this.extractCollectedTestIds(o);
          this.preselectFromOrder(o as unknown as HistoryRow, true);
          this.hydrateSpecimensFrom(o);
        },
        error: () => { this._opening.set(false); this.toasts.error('Could not load order'); }
      });
      return;
    }

    // Back from registration (ND-PATTERN §15): the cart stashed before it.
    const resumed = this.route.snapshot.queryParamMap.get('resume') === 'registration' && this.adoptPendingOrder();
    if (pid) {
      this._opening.set(true);
      this.api.get<{ patient: Patient; history: HistoryRow[] }>(`/api/patients/${pid}`).subscribe({
        next: res => {
          this._opening.set(false);
          this._patient.set(res.patient);
          if (resumed) return;
          // Preselection priority:
          //   1) ?fromOrderId=… (Repeat flow from a prior order) — an explicit
          //      Repeat always wins; a leftover draft for this patient used to
          //      win here and Repeat showed the DRAFT's tests (QA #5).
          //   2) localStorage draft for this patient
          //   3) ?appointmentId=… → fetch the appointment's draft TestIds
          //      and pre-load them into the cart (reception just clicks Create)
          if (fromOrderId) { this.repeatFromOrder(fromOrderId); return; }
          const restored = this.restoreDraftFor(pid);
          if (restored) return;
          if (appointmentId) this.preselectFromAppointment(appointmentId);
        },
        error: () => { this._opening.set(false); this.toasts.error('Could not load patient'); }
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

  // ── Draft shelf: another parked order, same screen ──────────────────
  /** The patientId this screen has on stage — from the URL it opened with,
   *  or written by the screen itself (attachPatient / clearPatient). A
   *  query emission equal to it is the screen's own URL sync, not a switch. */
  private stagedPid: string | null = null;
  private readonly destroyRef = inject(DestroyRef);

  /** The router REUSES this screen for /frontdesk/order?patientId=A → …=B
   *  (the app bar's draft chips), so the patient is followed LIVE. Bill /
   *  edit URLs (?orderId, ?editOrderId) keep their own flows untouched. */
  private onQueryChange(q: ParamMap) {
    const pid = q.get('patientId');
    // No patient in the URL ("New order", ×), or a bill/edit URL: nothing to
    // switch — just remember it so a later tap on ANY draft counts.
    if (!pid || q.has('orderId') || q.has('editOrderId')) { this.stagedPid = pid; return; }
    if (pid === this.stagedPid) return;
    this.switchToPatient(pid, q.get('fromOrderId'));
  }

  /** Put patient `pid`'s parked order on stage: park the cart on screen
   *  first (never lose a picked test), reset every per-order field, then
   *  load the patient and restore their draft — the same path a fresh
   *  /frontdesk/order?patientId= visit takes. */
  private switchToPatient(pid: string, fromOrderId: string | null = null) {
    this.parkCurrentCart();
    this.stagedPid = pid;
    this._patient.set(null);
    this._selected.set([]);
    this._specimens.set({});
    this._specimenErr.set({});
    this._defaultApplied.clear();
    this._onOrderIds.set(new Set());
    this._hasDraft.set(false);
    this.setPriority('Normal');
    this.discountValue.set('');
    this.discountKind.set('flat');
    this.refHospitalName.set('');
    this.refHospitalSuggestions.set([]);
    this.refHospitalError.set(null);
    this.refDoctorName.set('');
    this.refDoctorSuggestions.set([]);
    this.refDoctorError.set(null);
    this.viewOrderId.set(null);
    this.editOrderId.set(null);
    this._order.set(null);
    this.currentBill.set(null);
    this.collectedTestIds.set(new Set());
    this.billPhase.set('cart');
    this.setQuery('');
    // Draft → draft on the same screen: the patient tile + cart show their
    // skeleton until the other draft has loaded (the screen slides across).
    this.setOpeningKeys(pid, null);
    this._opening.set(true);
    this.api.get<{ patient: Patient; history: HistoryRow[] }>(`/api/patients/${pid}`).subscribe({
      next: res => {
        if (this.stagedPid !== pid) return;          // superseded by a later switch
        this._opening.set(false);
        this._patient.set(res.patient);
        if (fromOrderId) this.repeatFromOrder(fromOrderId);
        else this.restoreDraftFor(pid);
      },
      error: () => { if (this.stagedPid === pid) { this._opening.set(false); this.toasts.error('Could not load patient'); } }
    });
  }

  /** The cart on stage (a patient + at least one test, not an existing
   *  order) is saved as that patient's draft — silently, no navigation. */
  private parkCurrentCart() {
    const p = this._patient();
    if (!p || this.viewOrderId() || this.editOrderId() || this._selected().length === 0) return;
    if (this.writeDraft(p)) this.toasts.info(`${patientDisplayName(p) || 'Patient'}'s order kept as a draft`);
  }

  /** Persist the cart as `p`'s draft (the Draft tab / shelf read this key). */
  private writeDraft(p: Patient): boolean {
    try {
      const scope = this.draftScope();
      const written = orderDraftKey(scope, p.id);
      localStorage.setItem(written, JSON.stringify(buildOrderDraft({
        savedAt: Date.now(),
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        priority: this._priority(),
        testIds: this._selected(),
        specimens: this.specimenPayload(),
        // Snapshot the patient so the front-desk Draft tab can list it without
        // a lookup (the key only carries the id).
        patient: p,
        // The discount AS TYPED (₹ or %) — it was dropped from drafts.
        discountValue: this.discountValue(),
        discountKind: this.discountKind()
      })));
      // A legacy (branch-less) copy this save supersedes must not linger as a
      // second Drafts row.
      for (const k of orderDraftKeysFor(scope, p.id)) {
        if (k !== written) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Save the current cart to localStorage under the patient's id.
   *  No-op when there's no patient or nothing in the cart. */
  saveDraft() {
    const p = this._patient();
    if (!p) { this.toasts.warning('Pick a patient first'); return; }
    if (this._selected().length === 0) { this.toasts.info('Cart is empty — nothing to save'); return; }
    try {
      if (!this.writeDraft(p)) throw new Error('storage');
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
    this.removeDraft(p.id);
    this._hasDraft.set(false);
    this.toasts.info('Draft discarded');
  }

  /** Restore the saved draft (if any) for the supplied patient id.
   *  Returns true if a non-stale draft was applied. */
  private restoreDraftFor(patientId: string): boolean {
    // Only THIS branch's draft (or a legacy one that belongs here) — a cart
    // parked in another branch must never be restored into this one.
    const scope = this.draftScope();
    let raw: string | null = null;
    let key: string | null = null;
    try {
      for (const k of orderDraftKeysFor(scope, patientId)) {
        const r = localStorage.getItem(k);
        if (!r) continue;
        let body: { tenantId?: unknown; patient?: unknown } | null = null;
        try { body = JSON.parse(r); } catch { /* unreadable — parseOrderDraft rejects it */ }
        if (!orderDraftInScope(parseOrderDraftKey(k)?.branchId ?? null, body, scope)) continue;
        raw = r; key = k; break;
      }
    } catch { return false; }
    const parsed = parseOrderDraft(raw, Date.now(), this.DRAFT_TTL_MS);
    if (!parsed) {
      // Stale drafts are dropped (an empty/unreadable one is left alone).
      if (raw && key) {
        try {
          const savedAt = (JSON.parse(raw) as { savedAt?: number })?.savedAt;
          if (!savedAt || Date.now() - savedAt > this.DRAFT_TTL_MS) localStorage.removeItem(key);
        } catch { /* ignore */ }
      }
      return false;
    }
    try {
      const ids = parsed.testIds;
      this._selected.set(ids);
      // The draft's specimen picks come back too (a pick is a pick: never
      // overwritten by a mapping default).
      const picks = parsed.specimens;
      Object.keys(picks).forEach(k => this._defaultApplied.add(k));
      this._specimens.set(picks);
      if (parsed.priority === 'Normal' || parsed.priority === 'Urgent') this._priority.set(parsed.priority as Priority);
      // The discount comes back exactly as typed, so the over-cap check and the
      // totals rebuild the same; an old draft without one restores with none.
      this.discountServerError.set(null);
      this.discountKind.set(parsed.discount?.kind ?? 'flat');
      this.discountValue.set(parsed.discount?.value ?? '');
      this._hasDraft.set(true);
      this.toasts.info('Draft restored');
      // An old draft may hold a bundle beside its own member — flag it (the
      // cart shows it too), never crash or silently drop a line.
      const overlap = this.cartOverlapMessages();
      if (overlap.length > 0) this.toasts.warning(overlap[0]);
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

  /** An existing order's lines → the cart's specimen picks (keyed as
   *  ordered: the leaf, or the bundle it came in) and the set of lines
   *  already on the order (not re-required on edit). */
  private hydrateSpecimensFrom(o: Order | null | undefined) {
    const picks: Record<string, string> = {};
    const onOrder = new Set<string>();
    for (const s of o?.samples ?? []) for (const t of s.tests ?? []) {
      for (const k of [t.testId, t.packageTestId, t.profileTestId]) {
        if (!k) continue;
        onOrder.add(k);
        const sp = (t.specimenCode ?? t.specimen ?? '').trim();
        if (sp && !picks[k]) picks[k] = sp;
      }
    }
    Object.keys(picks).forEach(k => this._defaultApplied.add(k));
    onOrder.forEach(k => this._defaultApplied.add(k));
    this._onOrderIds.set(onOrder);
    this._specimens.update(m => ({ ...picks, ...m }));
  }

  /** Ordered items (package / profile / test — never a member leaf) with a
   *  line already collected: they stay in the edit cart (order-edit-items). */
  private extractCollectedTestIds(o: Order) {
    this.collectedTestIds.set(collectedItemIds(o as unknown as OrderLike));
  }

  /**
   * Repeat (?fromOrderId=): put EXACTLY the source order's items back in the
   * cart — the tests, profiles and packages that were picked, never a
   * bundle's members. The server resolves each to the tenant's CURRENT row
   * (reference mode: a master id follows a later tenant override), so the
   * cart holds the ids the catalogue lists. Anything no longer orderable is
   * named in a notice instead of silently dropped or swapped.
   *
   * QA #5 root cause: the old path read each sample line's leaf `testId`
   * from the patient history — a profile/package came back as its members,
   * ids that no longer matched the catalogue (overrides) were dropped, and a
   * saved draft for the patient took precedence over the Repeat itself.
   */
  private repeatFromOrder(orderId: string) {
    this.api.get<RepeatItem[]>(`/api/orders/${orderId}/repeat-items`).subscribe({
      next: items => this.whenCatalogue(() => this.applyRepeat(items ?? [])),
      error: e => this.toasts.error(`Could not repeat the order: ${ApiError.from(e).message}`),
    });
  }

  /** Cart ← the repeat plan, with a notice for anything left out. */
  applyRepeat(items: readonly RepeatItem[]) {
    if (items.length === 0) { this.toasts.warning('Repeated order had no tests'); return; }
    const plan = planRepeat(items, this._tests());
    this._selected.set(plan.ids);
    const n = plan.ids.length;
    if (plan.unavailable.length > 0) {
      this.toasts.warning(`Repeated ${n} item${n === 1 ? '' : 's'}. No longer available: ${plan.unavailable.join(', ')}`);
    } else {
      this.toasts.success(`Repeated ${n} item${n === 1 ? '' : 's'}`);
    }
  }

  /** Run `fn` once the orderable catalogue has loaded (it arrives async). */
  private whenCatalogue(fn: () => void) {
    if (this._tests().length > 0) { fn(); return; }
    const interval = setInterval(() => {
      if (this._tests().length > 0) { clearInterval(interval); fn(); }
    }, 150);
    setTimeout(() => clearInterval(interval), 10000);
  }

  private preselectFromOrder(prior: HistoryRow, isEdit = false) {
    // The ORDERED items (a package stays one package), never its member
    // lines — seeding the leaves made the save send a package beside its own
    // members (server: duplicate_item) or split it into loose tests.
    const want = new Set<string>(orderedItemIds(prior as unknown as OrderLike));
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
  }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  // ── Keyboard-first quick add (Tests scope) ──────────────────────
  /** Tests-scope matches shown in the dropdown under the pill: the whole
   *  orderable catalogue (tests, profiles, packages; profile aliases like
   *  "LFT" resolve), capped so the panel stays quick. ↑/↓ walk it, ⏎ adds. */
  readonly searchResults = computed<Test[]>(() =>
    this.searchBase()
      .filter(t => this.matchesSearchType(t) && this.matchesSearchDept(t))
      .slice(0, 50));
  /** Every match for the query, before the dropdown's own filters. */
  private readonly searchBase = computed<Test[]>(() => {
    const q = this._query().trim();
    // STRICT ranked matching (code, name, short name, profile label; no
    // fuzzy) — the dropdown must not bury "JAK2" under 190 near-misses.
    return q ? filterTestListStrict(this._tests(), q) : [];
  });

  // ── Dropdown filters (focus mode): type + department chips that narrow
  //    ONLY the dropdown results (never the catalogue grid). ──
  readonly searchType = signal<'all' | 'individual' | 'profile' | 'package'>('all');
  /** Department name ('' = all). */
  readonly searchDept = signal<string>('');
  readonly searchTypeDefs = [
    { id: 'all' as const, label: 'All' },
    { id: 'individual' as const, label: 'Tests' },
    { id: 'profile' as const, label: 'Profiles' },
    { id: 'package' as const, label: 'Packages' },
  ];
  private matchesSearchType(t: Test): boolean {
    const k = this.searchType();
    return k === 'all' || (t.type ?? 'individual') === k;
  }
  private matchesSearchDept(t: Test): boolean {
    const d = this.searchDept();
    return !d || this.searchDeptsOf(t).includes(d);
  }
  /** Every loaded row by id (package → member departments). */
  private readonly testById = computed(() => new Map(this._tests().map(t => [t.id, t] as const)));
  /** Departments a row counts under for the dropdown's department chips:
   *  its own; a PACKAGE has none of its own, so it counts under every
   *  department its members are in (never vanishes behind a chip). */
  private searchDeptsOf(t: Test): string[] {
    if (t.type === 'package') return memberDepartmentNames(t, this.testById());
    const own = shownDepartmentName(t);
    return own ? [own] : [''];
  }
  /** The muted department under a row / cart card: a package shows none. */
  deptLabel(t: Test): string { return shownDepartmentName(t); }
  /** Chip counts: each type within the current department, and each
   *  department within the current type (so the counts answer "what would
   *  I get if I tapped this"). */
  readonly searchTypeCounts = computed<Record<string, number>>(() => {
    const base = this.searchBase().filter(t => this.matchesSearchDept(t));
    const out: Record<string, number> = { all: base.length, individual: 0, profile: 0, package: 0 };
    for (const t of base) out[t.type ?? 'individual'] = (out[t.type ?? 'individual'] ?? 0) + 1;
    return out;
  });
  readonly searchDeptCounts = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const t of this.searchBase()) {
      if (!this.matchesSearchType(t)) continue;
      for (const d of this.searchDeptsOf(t)) out[d] = (out[d] ?? 0) + 1;
    }
    return out;
  });
  /** The type control's options (pf-segmented) with inline counts. */
  readonly searchTypeOpts = computed(() => this.searchTypeDefs.map(d => ({
    value: d.id, label: d.label, count: this.searchTypeCounts()[d.id] ?? 0,
  })));
  setSearchType(k: 'all' | 'individual' | 'profile' | 'package'): void {
    this.searchType.set(k);
    this.activeResult.set(0);
  }
  setSearchDept(name: string): void {
    this.searchDept.set(this.searchDept() === name ? '' : name);
    this.activeResult.set(0);
  }
  /** Id of the highlighted match (null when not searching). */
  readonly activeTestId = computed<string | null>(() => {
    const list = this.searchResults();
    return list.length ? list[Math.min(this.activeResult(), list.length - 1)].id : null;
  });
  /** Highlighted match (driven by ↑/↓ and hover); Enter adds it. */
  readonly activeResult = signal(0);

  onSearchArrow(e: Event, dir: number): void {
    const n = this.searchResults().length;
    if (n === 0) return;
    // Stop the browser (and any global arrow-key handler) from scrolling the page
    // while the dropdown owns ↑/↓.
    e.preventDefault();
    e.stopPropagation();
    this.activeResult.update(i => Math.max(0, Math.min(n - 1, i + dir)));
    this.revealActiveTest();
  }
  /** Keep the highlighted dropdown row visible inside the panel. */
  private revealActiveTest(): void {
    const id = this.activeTestId();
    if (!id || typeof document === 'undefined') return;
    setTimeout(() => {
      const el = document.querySelector(`[data-search-row="${id}"]`) as HTMLElement | null;
      el?.scrollIntoView?.({ block: 'nearest' });
    }, 0);
  }
  onSearchEnter(e: Event): void {
    const list = this.searchResults();
    if (list.length === 0) return;
    e.preventDefault();
    this.addSearchResult(list[Math.min(this.activeResult(), list.length - 1)], true);
  }
  /** Tap a dropdown hit: toggle it in the cart (the row shows ✓) and keep the
   *  panel open, so several matches can be added on a touch screen. ⏎ on a
   *  keyboard adds and clears the field — "⏎ add & keep typing". */
  addSearchResult(t: Test, clearAfter = false): void {
    if (t.type === 'package') this.togglePackage(t); else this.toggleTest(t);
    if (clearAfter) { this.setQuery(''); this.scopeOpen.set(false); }
    this.focusSearchInput();
  }

  isSelected(id: string): boolean { return this._selected().includes(id); }

  /** Swap the matching individual tests out of the cart and add the
   *  package in their place. The receptionist accepted the suggestion. */
  applyPackage(s: PackageSuggestion) {
    const droppedCollected = s.coveredIds.filter(id => this.isCollected(id));
    if (droppedCollected.length > 0) {
      this.toasts.warning(`Cannot switch to ${s.kind === 'upgrade' ? 'the' : 'a'} ${s.bundle.type === 'profile' ? 'profile' : 'package'} — some tests already have collected samples`);
      return;
    }
    this._selected.update(cur => {
      const dropped = new Set(s.coveredIds);
      const next = cur.filter(id => !dropped.has(id));
      if (!next.includes(s.bundle.id)) next.push(s.bundle.id);
      return next;
    });
    this.showCart();
    const inr = new CurrencyInrPipe();
    this.toasts.success(s.kind === 'upgrade'
      ? `Upgraded to ${s.bundle.name} (+${inr.transform(s.extraCost)})`
      : s.savings > 0
        ? `Switched to ${s.bundle.name} — saving ${inr.transform(s.savings)}`
        : `Switched to ${s.bundle.name} — same price, ${s.extraCount} more test${s.extraCount === 1 ? '' : 's'}`);
  }
  findTest(id: string): Test | undefined { return this._tests().find(t => t.id === id); }

  // ── Billing card phases: CART → PAYMENT ─────────────────────────────
  /** The billing card follows the flow: 'cart' while building the order
   *  (the list gets the whole body), 'pay' for totals + how it is paid.
   *  No manual expand toggle; see billPhaseView for the rules. */
  readonly billPhase = signal<'cart' | 'pay'>('cart');
  /** Phase actually shown: a paid order is always on payment; an empty
   *  cart on a new order is always the cart. */
  readonly billPhaseView = computed<'cart' | 'pay'>(() => {
    if (this.paidOrderId()) return this.billPhase() === 'cart' ? 'cart' : 'pay';
    if (!this.isReadOnly() && this._selected().length === 0) return 'cart';
    return this.billPhase();
  });
  /** "Continue to payment": needs tests, and a patient (else the nudge). */
  continueToPayment(): void {
    if (this._selected().length === 0) return;
    if (this.requirePatient()) return;
    if (this.requireSpecimens()) return;
    this.billPhase.set('pay');
  }
  /** The one-line cart summary in the payment phase → back to the cart. */
  editCart(): void { this.billPhase.set('cart'); }
  /** Any change to the cart shows the cart, so the change is visible. */
  private showCart(): void { if (!this.orderLocked()) this.billPhase.set('cart'); }

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
    if (this.refuseDuplicateAdd(t.id)) return;
    this._selected.update(cur => cur.includes(t.id) ? cur.filter(id => id !== t.id) : [...cur, t.id]);
    this.showCart();
  }
  removeTest(id: string) {
    if (this.rejectIfLocked()) return;
    if (this.isCollected(id)) {
      const t = this.findTest(id);
      this.toasts.warning(`Cannot remove ${t?.name ?? 'test'} — sample has already been collected`);
      return;
    }
    this._selected.update(cur => cur.filter(x => x !== id));
    this.showCart();
  }
  clearCart() {
    if (this.rejectIfLocked()) return;
    this.showCart();
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
    if (this.refuseDuplicateAdd(pkg.id)) return;
    this._selected.update(cur =>
      cur.includes(pkg.id) ? cur.filter(id => id !== pkg.id) : [...cur, pkg.id]
    );
    this.showCart();
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

  /** Type word for a catalogue row ('' for an individual test). The type is
   *  shown by the row's outline colour; this is its text for hover / AT. */
  typeWord(t: Test): string {
    return t.type === 'profile' ? 'Profile' : t.type === 'package' ? 'Package' : '';
  }
  /** Hover title: "Profile · Lipid Profile" / plain name for a test. */
  rowTitle(t: Test): string {
    const w = this.typeWord(t);
    return w ? `${w} · ${this.testDisplayName(t)}` : this.testDisplayName(t);
  }
  private readonly inrFmt = new CurrencyInrPipe();
  /** Screen-reader label: type, name, price, cart state. */
  rowLabel(t: Test): string {
    const w = this.typeWord(t);
    const price = this.inrFmt.transform(this.priceOf(t));
    return `${w ? w + ': ' : ''}${this.testDisplayName(t)}, ${price}${this.isSelected(t.id) ? ', in cart' : ''}`;
  }

  getPackageTestCount(pkg: Test): number {
    return parsePackageMembers(pkg.parameters).length;
  }

  // "Change patient" = click the pill's Patient tile and pick another one;
  // the × on the tile detaches the patient (clearPatient).
  attachPatient(p: Patient) {
    if (!p) return;
    this.patientNudge.set(false);
    this.stagedPid = p.id;               // our own URL sync — not a draft switch
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
  /** An order this Confirm created whose billing / payment hasn't completed —
   *  a retry reuses it (see planConfirmOrder). */
  private pendingOrder: PendingOrder | null = null;
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
        // Labels go ONLY to the station's label printer (LabelPrintService).
        // The off-screen sheet + label-sized system dialog is used only when a
        // web user explicitly picks it in the no-printer dialog.
        void this.labelPrint.printTubeLabels({
          samples: full.samples,
          patient: full.patient ?? null,
          systemPrint: () => {
            this._reprintOrder.set(full);
            // A beat for the cards to paint their codes, then print; keep the
            // sheet mounted until the dialog has consumed it.
            setTimeout(() => {
              printTubeLabels();
              setTimeout(() => this._reprintOrder.set(null), 2000);
            }, 350);
          },
        });
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
      // In-flight guard: a second Confirm tap must not post a second payment.
      if (!bill || this.confirming()) return;
      this.confirming.set(true);
      try {
        const amount = bill.balance;
        if (d.mode === 'wallet') {
          if (!d.vendorId) throw new Error('No vendor selected');
          // H8: ONE call — the payment and the partner's charge commit together.
          const updated = (await firstValueFrom(payBillFromWallet(this.api, bill.id, d.vendorId, amount, {
            referenceNo: d.referenceNo, reason: `Bill #${bill.id.substring(0, 8)}`
          }))).bill;
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
              amount: Math.min(d.advanceAmount, bill.balance), mode: d.advanceMode ?? 'cash'
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
    if (this.requireSpecimens()) return;
    if (this.discountOverCap()) {
      this.toasts.error(`Discount ${fmtPct(this.discountPct())} exceeds your limit of ${fmtPct(this.discountCapPct())}. Reduce it to continue.`);
      return;
    }
    this.confirming.set(true);
    try {
      const appointmentId = this.route.snapshot.queryParamMap.get('appointmentId');
      const discount = this.discountAmount();
      // Bug 3: a Confirm whose billing failed left its order behind. Retry
      // bills THAT order (tests re-synced if the cart changed) — never a
      // duplicate. A fresh order carries the discount so the server rejects an
      // over-cap discount BEFORE the order exists.
      const key = cartKey(this._selected(), this.specimenPayload());
      const plan = planConfirmOrder(this.pendingOrder, p.id, key);
      let order: { id: string };
      if (plan.action === 'create') {
        order = await firstValueFrom(this.api.post<Order>('/api/orders/', {
          patientId: p.id,
          refDoctorName: this.refDoctorName().trim() || null,
          refHospitalName: this.refHospitalName().trim() || null,
          priority: this._priority(),
          source: appointmentId ? 'appointment' : 'walkin',
          collectionType: 'walkin',
          testIds: this._selected(),
          specimens: this.specimenPayload(),
          // Same metadata as submit(): the appointment link AND the Trendogram
          // choice from the billing card (it was dropped on this path before).
          metadataJson: this.buildOrderMetadata(appointmentId),
          ...(discount > 0 ? { discount } : {})
        }));
        this.pendingOrder = { id: order.id, patientId: p.id, key };
        this.noteOrdered(this._selected());
      } else {
        if (plan.action === 'patch') {
          await firstValueFrom(this.api.patch<unknown>(`/api/orders/${plan.orderId}/tests`, {
            testIds: this._selected(), specimens: this.specimenPayload(), reason: 'reception edit'
          }));
          this.pendingOrder = { id: plan.orderId, patientId: p.id, key };
        }
        order = { id: plan.orderId };
      }
      const targetAmount = this.total();
      let bill = await firstValueFrom(this.api.post<Bill>('/api/billing/', {
        orderId: order.id,
        discount
      }));
      // Retrying an order whose bill already exists: POST /api/billing returns
      // that bill as-is, so bring its discount in line with the cart (the
      // server recomputes the money).
      if (discountNeedsSync(bill, discount)) {
        bill = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/discount`, {
          amount: discount, reason: 'Order & Payments'
        }));
      }
      // Track the latest bill state so the paid summary reflects the actual
      // amount paid / balance due (the payment endpoint returns the updated bill).
      let latest = bill;
      // Never post more than the bill actually owes: the server rejects an
      // overpayment (QA #3b), and the cart preview can differ from the
      // server's figure by rounding.
      const owed = (n: number) => (typeof bill?.balance === 'number' && bill.balance >= 0)
        ? Math.min(n, bill.balance) : n;
      if (d.mode !== 'later') {
        if (d.mode === 'split' && d.splitParts?.length) {
          for (const part of d.splitParts) {
            latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, { amount: part.amount, mode: part.mode }));
          }
        } else if (d.mode === 'wallet') {
          // Credit Wallet (H8): ONE call — the bill payment and the charge to
          // the partner's tab commit together (never one without the other).
          if (!d.vendorId) throw new Error('No vendor selected');
          const payAmt = owed(targetAmount);
          latest = (await firstValueFrom(payBillFromWallet(this.api, bill.id, d.vendorId, payAmt, {
            referenceNo: d.referenceNo, reason: `Bill #${bill.id.substring(0, 8)}`
          }))).bill;
        } else {
          const payAmt = owed(targetAmount);
          latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
            amount: payAmt, mode: d.mode, referenceNo: d.referenceNo
          }));
        }
      } else if (d.advanceAmount && d.advanceAmount > 0) {
        // Pay-later with an advance: record the partial payment now; the rest
        // of the bill stays outstanding (due on report).
        latest = await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
          amount: owed(d.advanceAmount), mode: d.advanceMode ?? 'cash'
        }));
      }

      // The paid summary shows the SERVER's bill as returned — the invoice is
      // the source of truth (it used to be patched up from the cart total).
      this.pendingOrder = null;
      this.removeDraft(p.id);
      this._hasDraft.set(false);
      this._paidBill.set(latest);
      this.paidOrderId.set(order.id);
      this.billPhase.set('pay');
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
    this.billPhase.set('cart');
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
    this.setPriority('Normal');
    this.router.navigateByUrl('/frontdesk/order');
    setTimeout(() => this.selectScope('patient'), 0);
  }

  /** Which paid-invoice action is building its PDF (template + QR fetches
   *  run first) — the pressed button shows its busy state meanwhile. */
  readonly invoiceBusy = signal<'print' | 'thermal' | 'share' | null>(null);
  private runInvoiceAction(kind: 'print' | 'thermal' | 'share', work: () => Promise<void>): void {
    if (this.invoiceBusy() === kind) return;
    this.invoiceBusy.set(kind);
    void work().finally(() => { if (this.invoiceBusy() === kind) this.invoiceBusy.set(null); });
  }
  printPaidInvoice() { this.runInvoiceAction('print', () => this.emitPaidInvoice('print')); }
  /** Force the receipt-roll layout for this print even when the tenant's saved
   *  default is A4 (a counter can have both printers). Width comes from the
   *  saved setting when that is already a roll; otherwise 3 in / 80 mm, the
   *  common desk receipt printer. */
  printPaidThermal() { this.runInvoiceAction('thermal', () => this.emitPaidInvoice('print', 'thermal_auto')); }

  /** Post-payment "Share on WhatsApp". On the native shell we hand the real
   *  invoice PDF to the OS share sheet (WhatsApp is a target and attaches the
   *  file). On the web, wa.me can't attach a file, so we open a click-to-chat
   *  pre-filled with the invoice details — same fallback the billing counter's
   *  "Send on WhatsApp" uses. Replaces the old "Show invoice" preview, which was
   *  redundant since the itemised cart is already on screen. */
  sharePaidInvoice() {
    const bill = this.paidBill();
    if (!bill) return;
    if (this.isNativePlatform()) { this.runInvoiceAction('share', () => this.emitPaidInvoice('share')); return; }
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
        gstin: invoiceGstinFrom(bill, tpl),   // the bill's branch-GST snapshot
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
    this._lgMql?.removeEventListener?.('change', this._onLgChange);
    this._webMql?.removeEventListener?.('change', this._onWebChange);
    this._phoneMql?.removeEventListener?.('change', this._onPhoneChange);
    this.keyboard.reset?.();
    if (typeof window !== 'undefined') {
      window.visualViewport?.removeEventListener('resize', this._onViewport);
      window.removeEventListener('resize', this._onViewport);
      window.removeEventListener(PF_KEYS_EVENT, this._onViewport);
    }
    clearTimeout(this.nudgeTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibleResync);
    this.closeInvoicePreview();
  }

  submit() {
    const p = this._patient();
    if (!p || this._saving() || this._selected().length === 0) return;
    if (this.requireSpecimens()) return;
    // A cart that arrived with a bundle beside its own member (old draft,
    // repeat, prefill) is flagged in the cart; a NEW order can't be placed
    // until one side is removed (the server refuses it: duplicate_item).
    const overlap = this.cartOverlapMessages();
    if (overlap.length > 0 && !this.editOrderId()) { this.toasts.error(overlap[0]); return; }

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
      // The desk's specimen choices (dropped on this path before).
      specimens: this.specimenPayload(),
      metadataJson: this.buildOrderMetadata(appointmentId),
      // Validated against the cap BEFORE the order exists (no orphan order).
      ...(this.discountAmount() > 0 ? { discount: this.discountAmount() } : {})
    }).subscribe({
      next: order => {
        this._saving.set(false);
        this.noteOrdered(this._selected());
        // Order persisted — drop any saved draft for this patient.
        const pid = p.id;
        this.removeDraft(pid);
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
  }

  // ── Ref hospital ─────────────────────────────────────────────────

  /** Pick (or clear, with '') the referring hospital. Changing it wipes the
   *  doctor, since the doctor list is filtered by hospital. */
  pickRefHospital(name: string): void {
    const prev = this.refHospitalName();
    this.refHospitalName.set(name);
    this.refHospitalError.set(null);
    // Hospital changed — wipe the doctor since it might be from a different hospital.
    if (name !== prev) {
      this.refDoctorName.set('');
      this.refDoctorSuggestions.set([]);
    }
  }

  /** Debounced hospital lookup for the Hospital scope. */
  private searchHospitals(q: string, immediate = false): void {
    if (this.refHospitalDebounce) clearTimeout(this.refHospitalDebounce);
    const run = () => {
      const t = q.trim();
      this.api.get<string[]>(`/api/test-picker/hospitals${t ? `?q=${encodeURIComponent(t)}` : ''}`).subscribe({
        next: names => this.refHospitalSuggestions.set(names ?? []),
        error: () => this.refHospitalSuggestions.set([])
      });
    };
    if (immediate) run(); else this.refHospitalDebounce = setTimeout(run, 200);
  }

  // ── Ref doctor (filtered by hospital when one is picked) ──────────

  pickRefDoctor(name: string): void {
    this.refDoctorName.set(name);
    this.refDoctorError.set(null);
  }

  /** Debounced doctor lookup for the Doctor scope. */
  private searchDoctors(q: string, immediate = false): void {
    if (this.refDoctorDebounce) clearTimeout(this.refDoctorDebounce);
    if (immediate) this.fetchDoctorSuggestions(q);
    else this.refDoctorDebounce = setTimeout(() => this.fetchDoctorSuggestions(q), 200);
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

  // ══ Unified search pill (Option A) ═══════════════════════════════
  // One pill in the hero band: scope tiles (Tests / Patient / Doctor /
  // Hospital) + ONE input + cart. Replaces the old patient box, the two
  // referral boxes and the test search box. Each scope is driven by the same
  // endpoint the old box used. EVERY scope's results open in one animated
  // dropdown under the pill, sized above the on-screen keyboard (iPad /
  // touch first), so results are never hidden in the page below.

  protected readonly scopes = SEARCH_SCOPES;
  protected readonly scopeLabels = SCOPE_LABELS;
  /** Which thing the single input is searching right now. */
  readonly scope = signal<SearchScope>('tests');
  /** Typed text for the Patient / Doctor / Hospital scopes (Tests uses query()). */
  readonly scopeQuery = signal('');
  /** The dropdown of matches under the pill (Tests: once something is typed). */
  readonly scopeOpen = signal(false);
  /** The dropdown is actually showing. */
  readonly dropOpen = computed(() =>
    this.scopeOpen() && (this.scope() !== 'tests'
      || (this.searchMode() === 'dropdown' && !!this._query().trim())));
  /** Touch: the catalogue card shows ranked results while a test query is
   *  typed (no dropdown); clearing it restores the browse view. */
  readonly inCardSearch = computed(() =>
    this.searchMode() === 'incard' && this.scope() === 'tests' && !!this._query().trim());
  /** The search input holds focus. */
  readonly pillFocused = signal(false);
  /** "You're about to search": drives the activation animation (pill grows,
   *  background recedes). */
  readonly searchActive = computed(() => this.pillFocused() || this.dropOpen() || this.inCardSearch());
  /** Touch: an iOS-style "Cancel" slides in at the field's right. */
  readonly showCancel = computed(() => !this.isWebSearch() && (this.pillFocused() || this.dropOpen() || this.inCardSearch()));
  onPillBlur(): void { setTimeout(() => this.pillFocused.set(false), 0); }
  /** Cancel (touch): clear the query, close any list, drop the keyboard. */
  cancelSearch(): void {
    this.setQuery('');
    this.closeScope();
    this.pillFocused.set(false);
    this.searchInput()?.nativeElement?.blur();
    this.keyboard.reset?.();
  }
  /** Panel max-height (px) so its bottom stays above the on-screen keyboard:
   *  measured from window.visualViewport, which shrinks when a keyboard
   *  opens on iPad / phones. null = CSS default. */
  readonly dropMaxH = signal<number | null>(null);
  /** Panel geometry: exactly the PILL's width, aligned to its left/right
   *  edges and hanging from its bottom (px, relative to the .pf-us box the
   *  panel is positioned in). null = CSS fallback. */
  readonly dropBox = signal<{ left: number; top: number; width: number } | null>(null);
  private readonly _onViewport = () => this.sizeDropdown();
  /** The visible pill: the band's search bar, or on phones its field row. */
  private pillBox(): HTMLElement | null {
    const us = this.pillEl()?.nativeElement;
    if (!us) return null;
    const field = us.closest('.pf-hb__field') as HTMLElement | null;
    if (field && typeof getComputedStyle !== 'undefined' && getComputedStyle(field).display !== 'contents') return field;
    return (us.closest('.pf-hb__search') as HTMLElement | null) ?? us;
  }
  /** Re-measure the panel against the pill and the visual viewport (which
   *  shrinks when an on-screen keyboard opens). */
  sizeDropdown(): void {
    if (typeof window === 'undefined') return;
    const us = this.pillEl()?.nativeElement;
    const pill = this.pillBox();
    if (!us || !pill) return;
    const u = us.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    if (p.width > 0) this.dropBox.set({ left: p.left - u.left, top: p.bottom - u.top + 8, width: p.width });
    const vv = window.visualViewport;
    // PF Keys (tablets) docks over the bottom like a keyboard, but the
    // visual viewport doesn't shrink for it: subtract its published height.
    const keysH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(PF_KEYS_HEIGHT_VAR)) || 0;
    const viewBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - keysH;
    this.dropMaxH.set(Math.max(160, Math.floor(viewBottom - (p.bottom + 8) - 12)));
  }

  /** Keyboard-highlighted dropdown row. */
  readonly scopeHighlight = signal(0);
  /** Phone: the compact scope picker menu (the tiles collapse into it). */
  readonly scopeMenuOpen = signal(false);

  // ── PF Keys (tablets): the pill is a search field for Tests (QWERTY,
  //    123 → department-prefix code pad) and Patient (number pad). Doctor /
  //    Hospital are free-text names → the system keyboard.
  readonly pfKeysKind = computed<PfKeysKind | null>(() =>
    this.scope() === 'tests' ? 'test' : this.scope() === 'patient' ? 'patient' : null);
  /** Tests scope: Enter would REMOVE the highlighted match (it is already
   *  in the order — Enter toggles, the row's chip already says "↵ Remove"). */
  readonly pfKeysEnterRemoves = computed(() => {
    if (this.scope() !== 'tests') return false;
    const id = this.activeTestId();
    return !!id && this._selected().includes(id);
  });
  /** The keypad's primary key says what Enter will do, live with the
   *  highlight and the cart: "Add ↵" ⇄ "Remove ↵" (patient: "Select ↵"). */
  readonly pfKeysEnter = computed(() =>
    this.scope() === 'patient' ? 'Select' : this.pfKeysEnterRemoves() ? 'Remove' : 'Add');
  readonly pfKeysEnterAria = computed(() =>
    this.scope() === 'patient' ? 'Select highlighted patient'
      : this.pfKeysEnterRemoves() ? 'Remove selected test' : 'Add selected test');
  readonly pfKeysEnterTone = computed<PfKeysEnterTone>(() => this.pfKeysEnterRemoves() ? 'remove' : 'primary');
  /** The lab's own department codes (from its Test Master) for the code pad. */
  readonly pfKeysPrefixes = computed<PfKeysPrefix[]>(() =>
    deptPrefixes(this.deptChips().map(d => ({ name: d.name, code: d.code })), 'test'));

  /** What the input shows: the test query in Tests scope, else the scope text. */
  readonly pillValue = computed(() => this.scope() === 'tests' ? this._query() : this.scopeQuery());
  readonly pillPlaceholder = computed(() =>
    (this.isPhone() ? SCOPE_PLACEHOLDERS_SHORT : SCOPE_PLACEHOLDERS)[this.scope()]);

  /** Can this tile be opened? Patient locks once the order exists; the
   *  referral tiles follow the OPS-58 rule (create, or "Edit referral"). */
  scopeEnabled(k: SearchScope): boolean {
    switch (k) {
      case 'tests': return !this.orderLocked();
      case 'patient': return !this.isReadOnly() && !this.paidOrderId() && !this.editOrderId();
      default: return this.referralInteractive() && !this.paidOrderId();
    }
  }

  /** The chosen value shown ON a tile ('' when empty). */
  tilePick(k: SearchScope): string {
    switch (k) {
      case 'patient': return patientDisplayName(this._patient());
      case 'doctor': return this.refDoctorName().trim();
      case 'hospital': return this.refHospitalName().trim();
      default: return '';
    }
  }
  tileLabel(k: SearchScope): string { return this.tilePick(k) || SCOPE_LABELS[k]; }
  /** Long form for the tile tooltip / aria (patient age/sex/MRN). */
  tileTitle(k: SearchScope): string {
    if (k === 'patient' && this._patient()) return formatPatientInfo(this._patient());
    const v = this.tilePick(k);
    return v ? `${SCOPE_LABELS[k]}: ${v}` : SCOPE_LABELS[k];
  }
  /** × on a filled tile — shown when it is filled, not active, and editable. */
  tileClearable(k: SearchScope): boolean {
    return k !== 'tests' && !!this.tilePick(k) && this.scope() !== k && this.scopeEnabled(k);
  }

  /** Click a tile: make it the active scope. Patient/Doctor/Hospital open
   *  their dropdown of matches below the pill; Tests closes it. */
  selectScope(k: SearchScope): void {
    this.scopeMenuOpen.set(false);
    if (!this.scopeEnabled(k)) return;
    this.scope.set(k);
    this.scopeQuery.set('');
    this.scopeHighlight.set(0);
    this.sizeDropdown();
    this.scopeOpen.set(k !== 'tests' || !!this._query().trim());
    if (k !== 'patient') this.patientNudge.set(false);
    if (k === 'patient') { this.patientResults.set([]); this.patientLoading.set(false); }
    if (k === 'doctor') this.searchDoctors('', true);
    if (k === 'hospital') this.searchHospitals('', true);
    this.focusSearchInput();
  }

  /** Close the dropdown and go back to searching tests (Esc / outside click). */
  closeScope(): void {
    this.scopeOpen.set(false);
    this.scopeMenuOpen.set(false);
    this.scopeQuery.set('');
    this.scope.set('tests');
  }

  /** × on a tile. */
  clearScope(k: SearchScope, ev?: Event): void {
    ev?.stopPropagation();
    if (!this.scopeEnabled(k)) return;
    if (k === 'patient') this.clearPatient();
    else if (k === 'doctor') this.pickRefDoctor('');
    else if (k === 'hospital') this.pickRefHospital('');
  }

  /** Detach the patient (the × on the Patient tile). The cart is kept — the
   *  receptionist may have picked tests first. */
  clearPatient(): void {
    if (!this._patient()) return;
    this._patient.set(null);
    this._hasDraft.set(false);
    this.stagedPid = null;
    this.router.navigate?.([], { queryParams: { patientId: null }, queryParamsHandling: 'merge' });
  }

  /** The single input's (input) handler. */
  onPillInput(v: string): void {
    const k = this.scope();
    this.sizeDropdown();
    if (k === 'tests') { this.setQuery(v); this.scopeOpen.set(true); return; }
    this.scopeQuery.set(v);
    this.scopeOpen.set(true);
    this.scopeHighlight.set(0);
    if (k === 'patient') this.searchPatients(v);
    else if (k === 'doctor') { this.refDoctorError.set(null); this.searchDoctors(v); }
    else if (k === 'hospital') { this.refHospitalError.set(null); this.searchHospitals(v); }
  }
  onPillFocus(): void { this.pillFocused.set(true); this.sizeDropdown(); this.scopeOpen.set(true); }

  onPillArrow(e: Event, dir: number): void {
    if (this.scope() === 'tests') { this.scopeOpen.set(true); this.onSearchArrow(e, dir); return; }
    const n = this.scopeRows().length;
    if (!n) return;
    e.preventDefault();
    this.scopeOpen.set(true);
    this.scopeHighlight.update(i => (i + dir + n) % n);
  }
  onPillEnter(e: Event): void {
    if (this.scope() === 'tests') { this.onSearchEnter(e); return; }
    const rows = this.scopeRows();
    if (!rows.length) return;
    e.preventDefault();
    this.pickScopeRow(rows[Math.min(this.scopeHighlight(), rows.length - 1)]);
  }
  onPillEscape(): void {
    if (this.scope() === 'tests') { this.setQuery(''); this.scopeOpen.set(false); }
    else this.closeScope();
  }

  /** Close the dropdown / phone menu on a click outside the pill. */
  @HostListener('document:pointerdown', ['$event'])
  onDocPointerDown(ev: Event): void {
    if (!this.scopeOpen() && !this.scopeMenuOpen()) return;
    const host = this.pillEl()?.nativeElement;
    if (host && ev.target instanceof Node && host.contains(ev.target)) return;
    this.closeScope();
  }

  // Patient scope — the same endpoint + ABHA rules as pf-patient-search.
  readonly patientResults = signal<Patient[]>([]);
  readonly patientLoading = signal(false);
  private patientTimer?: ReturnType<typeof setTimeout>;
  private searchPatients(v: string): void {
    clearTimeout(this.patientTimer);
    const q = v.trim();
    if (q.length < 2) { this.patientResults.set([]); this.patientLoading.set(false); return; }
    this.patientLoading.set(true);
    this.patientTimer = setTimeout(() => {
      this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q)}&limit=10`).subscribe({
        next: list => { this.patientResults.set(list ?? []); this.patientLoading.set(false); },
        error: () => { this.patientResults.set([]); this.patientLoading.set(false); }
      });
    }, 220);
  }

  /** Dropdown rows for the active scope (the typed "add as new" row is last). */
  readonly scopeRows = computed<ScopeRow[]>(() => {
    const k = this.scope();
    const q = this.scopeQuery().trim();
    if (k === 'patient') {
      return this.patientResults().map(p => ({
        key: p.id, kind: 'match' as const, title: patientDisplayName(p),
        meta: [
          [formatAge(p, 'num'), (p.sex ?? '').charAt(0).toUpperCase()].filter(Boolean).join('/'),
          p.mrn, p.phone,
        ].filter(Boolean).join(' · '),
      }));
    }
    if (k === 'doctor' || k === 'hospital') {
      const names = k === 'doctor' ? this.refDoctorSuggestions() : this.refHospitalSuggestions();
      const hosp = this.refHospitalName().trim();
      const meta = k === 'doctor' ? (hosp ? `Refers from ${hosp}` : 'Referring doctor') : 'Referring hospital';
      const rows: ScopeRow[] = names.map(n => ({ key: n, kind: 'match' as const, title: n, meta }));
      if (q && !names.some(n => n.trim().toLowerCase() === q.toLowerCase())) {
        rows.push({ key: '__new__', kind: 'new', title: q, meta: `Add as a new ${k === 'doctor' ? 'referring doctor' : 'referring hospital'}` });
      }
      return rows;
    }
    return [];
  });
  /** Dropdown header, e.g. "DOCTOR · 3 MATCHES". */
  readonly scopeTitle = computed(() => {
    const n = this.scopeRows().filter(r => r.kind === 'match').length;
    return `${SCOPE_LABELS[this.scope()].toUpperCase()} · ${n} MATCH${n === 1 ? '' : 'ES'}`;
  });
  /** Dropdown header for the Tests scope, e.g. "TESTS · 12 MATCHES". */
  readonly testsTitle = computed(() => {
    const n = this.searchResults().length;
    return `TESTS · ${n}${n === 50 ? '+' : ''} MATCH${n === 1 ? '' : 'ES'}`;
  });
  /** Status line for the Patient scope (hint / searching / nothing found). */
  readonly patientStatus = computed<'hint' | 'loading' | 'empty' | null>(() => {
    if (this.scope() !== 'patient') return null;
    const q = this.scopeQuery().trim();
    if (q.length < 2) return 'hint';
    if (this.patientLoading()) return 'loading';
    return this.patientResults().length ? null : 'empty';
  });

  /** Pick a dropdown row: fill that tile, return the scope to Tests. */
  pickScopeRow(row: ScopeRow): void {
    const k = this.scope();
    if (k === 'patient') {
      const p = this.patientResults().find(x => x.id === row.key);
      if (p) this.attachPatient(p);
    } else if (k === 'doctor') {
      this.pickRefDoctor(row.title.trim());
    } else if (k === 'hospital') {
      this.pickRefHospital(row.title.trim());
    }
    this.scope.set('tests');
    this.scopeQuery.set('');
    this.scopeOpen.set(false);
    this.scopeHighlight.set(0);
    this.focusSearchInput();
  }

  // Patient extras: register a new patient / edit the attached one — the
  // existing registration screen (workflow + permission gated).
  readonly canRegisterPatient = computed(() =>
    this.process.isEnabled?.('patient_registration') !== false && this.auth.hasPermission('register_patient'));
  // Registration opened from a half-built order comes BACK here with the
  // patient attached (?patientId=…&resume=registration); the cart it had is
  // stashed first and restored on return (ND-PATTERN §15).
  newPatient(): void {
    this.stashPendingOrder();
    this.router.navigate(['/frontdesk/patients/new'], { queryParams: { returnTo: 'order' } });
  }
  editPatient(): void {
    const p = this._patient();
    if (!p) return;
    this.stashPendingOrder();
    this.router.navigate(['/frontdesk/patients/new'], { queryParams: { patientId: p.id, returnTo: 'order' } });
  }

  /** The in-progress cart while the frontdesk registers / edits the patient. */
  static readonly PENDING_KEY = 'pf:order-draft:pending-registration';
  private stashPendingOrder(): void {
    const testIds = this._selected();
    const doctor = this.refDoctorName();
    const hospital = this.refHospitalName();
    try {
      if (!testIds.length && !doctor && !hospital) { localStorage.removeItem(OrderCreateComponent.PENDING_KEY); return; }
      localStorage.setItem(OrderCreateComponent.PENDING_KEY, JSON.stringify({
        savedAt: Date.now(), testIds, priority: this._priority(), refDoctorName: doctor, refHospitalName: hospital,
      }));
    } catch { /* storage unavailable — the order simply starts empty */ }
  }
  /** Restore the stashed cart (only on ?resume=registration). One-shot:
   *  the stash is removed; anything older than a day is ignored. */
  private adoptPendingOrder(): boolean {
    let raw: string | null = null;
    try { raw = localStorage.getItem(OrderCreateComponent.PENDING_KEY); localStorage.removeItem(OrderCreateComponent.PENDING_KEY); }
    catch { return false; }
    if (!raw) return false;
    try {
      const d = JSON.parse(raw) as { savedAt?: number; testIds?: string[]; priority?: Priority; refDoctorName?: string; refHospitalName?: string };
      if (!d?.savedAt || Date.now() - d.savedAt > 24 * 60 * 60 * 1000) return false;
      const ids = (d.testIds ?? []).filter(id => typeof id === 'string');
      if (ids.length) this._selected.set(ids);
      if (d.priority) this._priority.set(d.priority);
      if (d.refDoctorName) this.refDoctorName.set(d.refDoctorName);
      if (d.refHospitalName) this.refHospitalName.set(d.refHospitalName);
      return ids.length > 0 || !!d.refDoctorName || !!d.refHospitalName;
    } catch { return false; }
  }

  /** "Urgent" switch in the billing card — the same order-priority field the
   *  old Normal/Urgent switch set. Locked on a read-only order. */
  toggleUrgent(): void {
    if (this.orderLocked()) return;
    this.setPriority(this._priority() === 'Urgent' ? 'Normal' : 'Urgent');
  }

  // ── Patient is required ────────────────────────────────────────────
  /** No patient yet on an order being built → the Patient tile shows as
   *  required (outline, dot, gentle pulse). */
  readonly patientMissing = computed(() => !this._patient() && this.scopeEnabled('patient'));
  /** Set when Confirm / Save as draft was tried without a patient: the tile
   *  shakes and an inline hint shows under the band. */
  readonly patientNudge = signal(false);
  private nudgeTimer?: ReturnType<typeof setTimeout>;
  /** Guard for Confirm / Save as draft / Proceed. Returns true (and nudges)
   *  when the patient is missing, so the caller stops. */
  requirePatient(): boolean {
    if (this._patient()) return false;
    this.patientNudge.set(false);
    clearTimeout(this.nudgeTimer);
    // Re-trigger the shake even on a repeat click (class off → on).
    this.nudgeTimer = setTimeout(() => this.patientNudge.set(true), 0);
    this.selectScope('patient');
    return true;
  }
  onSaveDraftClick(): void { if (!this.requirePatient()) this.saveDraft(); }
  onProceedClick(): void { if (!this.requirePatient() && !this.requireSpecimens()) this.submit(); }
  onConfirmClick(): void {
    if (this.requirePatient()) return;
    if (this.requireSpecimens()) return;
    this.payPanel()?.emit();
  }

  /** Cart icon in the pill: the billing card is on screen at lg+ (bring it
   *  into view), below that it opens the checkout drawer. */
  openCartFromPill(): void {
    this.closeScope();
    if (this.isLg()) this.billCard()?.nativeElement?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    else this.toggleCart();
  }

  // "Scan ABHA / QR" in the Patient dropdown: look a patient up by ABHA QR /
  // number (the same rules pf-patient-search's scanner used): confident
  // match → attach it, otherwise show the matches in the Patient dropdown.
  readonly scanning = signal(false);
  openScanner(): void { if (this.scopeEnabled('patient')) this.scanning.set(true); }
  onScanned(text: string): void {
    this.scanning.set(false);
    const abha = extractAbhaNumber(text || '');
    const term = abha || (text || '').trim();
    if (!term) return;
    this.selectScope('patient');
    this.scopeQuery.set(term);
    this.patientLoading.set(true);
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(term)}&limit=10`).subscribe({
      next: list => {
        this.patientLoading.set(false);
        const arr = list ?? [];
        const exact = abha ? arr.find(p => (p.abhaId || '').replace(/\D/g, '') === abha) : undefined;
        const hit = exact ?? (arr.length === 1 ? arr[0] : undefined);
        if (hit) {
          this.patientResults.set([hit]);
          this.pickScopeRow({ key: hit.id, kind: 'match', title: patientDisplayName(hit), meta: '' });
          return;
        }
        this.patientResults.set(arr);
      },
      error: () => { this.patientLoading.set(false); this.patientResults.set([]); }
    });
  }
}

/** A package / profile suggestion for this cart (package-suggest.ts). */
type PackageSuggestion = BundleSuggestion<Test>;

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
