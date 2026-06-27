import { Location, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, AfterViewInit, computed, inject, signal, viewChild, ElementRef } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ToastService } from '../../../core/services/toast.service';
import { Order } from '../../../shared/models/order.model';
import { Bill } from '../../../shared/models/bill.model';
import { Patient } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { AuthService } from '../../../core/auth/auth.service';
import { generateInvoicePdf, invoiceTemplateFieldsFrom, loadImageDataUrl } from '../billing/invoice-pdf';
import { environment } from '../../../../environments/environment';
import { InlinePaymentPanelComponent, InlinePaymentResult } from './inline-payment-panel.component';

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
  imports: [NgTemplateOutlet, CurrencyInrPipe, AvatarComponent, ScreenHeaderComponent, PatientSearchComponent, InlinePaymentPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-create.component.html',
  styleUrls: ['./order-create.component.scss']
})
export class OrderCreateComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
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
  private readonly _priority = signal<Priority>('Normal');
  private readonly _query = signal<string>('');
  private readonly _cartOpen = signal<boolean>(false);

  // ── Categorized test picker state ─────────────────────────────────
  /** Active category tab. 'all' falls back to the existing dept-grouped grid. */
  readonly categoryTab = signal<'recent' | 'favourites' | 'packages' | 'all'>('recent');
  private preSearchTab: 'recent' | 'favourites' | 'packages' | 'all' = 'recent';
  /** Per-user pinned test ids, fetched from /api/test-picker/favorites. */
  readonly favouriteIds = signal<Set<string>>(new Set());
  /** Per-user recent test ids, fetched from /api/test-picker/recent. */
  readonly recentIds = signal<string[]>([]);

  // ── Ref-hospital + ref-doctor field state ─────────────────────────
  readonly refHospitalName = signal<string>('');
  readonly refHospitalOpen = signal(false);
  readonly refHospitalSuggestions = signal<string[]>([]);
  private refHospitalDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly refDoctorName = signal<string>('');
  readonly refDoctorOpen = signal(false);
  readonly refDoctorSuggestions = signal<string[]>([]);
  private refDoctorDebounce: ReturnType<typeof setTimeout> | null = null;

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
  readonly saving = this._saving.asReadonly();
  readonly selected = this._selected.asReadonly();
  readonly priority = this._priority.asReadonly();
  readonly query = this._query.asReadonly();
  readonly cartOpen = this._cartOpen.asReadonly();

  readonly individualTests = computed(() => this._tests().filter(t => t.type !== 'package'));
  readonly packages = computed(() => {
    const list = this._tests().filter(t => t.type === 'package');
    return this.filterTestList(list, this._query());
  });

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

  readonly filteredTests = computed(() => this.filterTestList(this.individualTests(), this._query()));

  private filterTestList(list: Test[], q: string): Test[] {
    const query = q.trim().toLowerCase();
    if (!query) return list;
    const variants = this.spellingVariants(query);
    return list.filter(t => {
      const hay = [
        t.name,
        t.hsnSacCode ?? '',
        t.department?.name ?? ''
      ].join(' ').toLowerCase();
      return variants.some(v => hay.includes(v));
    });
  }

  /** Generate US/UK spelling variants of a search string so the catalogue
   *  matches regardless of which spelling the lab catalogue or the user
   *  typed. Cheap substring substitution; not a full medical thesaurus. */
  private spellingVariants(q: string): string[] {
    const swaps: Array<[string, string]> = [
      ['hema',   'haema'],   // hematology ↔ haematology
      ['pedia',  'paedia'],  // pediatric ↔ paediatric
      ['anesth', 'anaesth'], // anesthesia ↔ anaesthesia
      ['fetal',  'foetal'],  // fetal ↔ foetal
      ['leuk',   'leuc'],    // leukocyte ↔ leucocyte
    ];
    const out = new Set<string>([q]);
    for (const [us, uk] of swaps) {
      if (q.includes(us)) out.add(q.replace(us, uk));
      if (q.includes(uk)) out.add(q.replace(uk, us));
    }
    return Array.from(out);
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
        tests: tests.slice().sort((a, b) => a.name.localeCompare(b.name))
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

  readonly subtotal = computed(() =>
    this._selected()
      .map(id => this._tests().find(t => t.id === id)?.price ?? 0)
      .reduce((a, b) => a + b, 0)
  );
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
    this.labCfg.ensureLoaded();
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: l => this._tests.set(l ?? []),
      error: e => this.toasts.error(`Could not load tests: ${e?.message ?? 'unknown error'}`)
    });

    // Honor the tenant GST + discount switches in the cart preview (best-effort).
    this.api.get<{ gstEnabled?: boolean; allowDiscounts?: boolean; maxDiscountPct?: number; overrideDiscountPct?: number }>('/api/config/billing').subscribe({
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
        testIds: this._selected()
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
    // ride along. The catalog list arrives async — re-run this once
    // _tests fills if it isn't there yet.
    const apply = () => {
      const ids = Array.from(want).filter(id => this._tests().some(x => x.id === id));
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

  isSelected(id: string): boolean { return this._selected().includes(id); }

  /** Swap the matching individual tests out of the cart and add the
   *  package in their place. The receptionist accepted the suggestion. */
  applyPackage(s: PackageSuggestion) {
    this._selected.update(cur => {
      const dropped = new Set(s.coveredIds);
      const next = cur.filter(id => !dropped.has(id));
      if (!next.includes(s.package.id)) next.push(s.package.id);
      return next;
    });
    this.toasts.success(`Switched to ${s.package.name} — saving ₹${s.savings}`);
  }
  findTest(id: string): Test | undefined { return this._tests().find(t => t.id === id); }

  toggleTest(t: Test) {
    this._selected.update(cur => cur.includes(t.id) ? cur.filter(id => id !== t.id) : [...cur, t.id]);
    if (this.query().trim() !== '') {
      this.setQuery('');
      this.focusSearchInput();
    }
  }
  removeTest(id: string) {
    this._selected.update(cur => cur.filter(x => x !== id));
  }
  clearCart() { this._selected.set([]); }

  /** Click toggles a quick-package: add if missing, remove if already in cart.
   * Quietly mutates selection without flooding the toast stack — the cart
   * sidebar is the source of truth and visually reflects the change. */
  togglePackage(pkg: Test) {
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

  shortCode(t: Test): string {
    if (t.hsnSacCode) return t.hsnSacCode.slice(0, 4);
    return t.name.replace(/\s+/g, '').slice(0, 4).toUpperCase();
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
  readonly showInlinePay = computed(() => this.labCfg.billingMode() === 'front_desk' && !this.editOrderId());
  readonly confirming = signal(false);
  /** Set once payment is taken → the pane swaps to Print / Show invoice. */
  readonly paidOrderId = signal<string | null>(null);
  private paidBill: Bill | null = null;

  /** Called by the inline payment pane's Confirm: create the order, the bill
   *  (with the cart discount), record the payment, then print the invoice. */
  async confirmPayment(d: InlinePaymentResult) {
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
        metadataJson: appointmentId ? JSON.stringify({ appointmentId }) : null
      }));
      const bill = await firstValueFrom(this.api.post<Bill>('/api/billing/', { orderId: order.id, discount: this.discountAmount() }));
      if (d.mode !== 'later') {
        if (d.mode === 'split' && d.splitParts?.length) {
          for (const part of d.splitParts) {
            await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, { amount: part.amount, mode: part.mode }));
          }
        } else {
          await firstValueFrom(this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
            amount: bill.totalPayable, mode: d.mode, referenceNo: d.referenceNo
          }));
        }
      }
      try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + p.id); } catch { /* ignore */ }
      this._hasDraft.set(false);
      this.paidBill = bill;
      this.paidOrderId.set(order.id);
      this.toasts.success(d.mode === 'later' ? 'Order placed — payment pending' : 'Payment collected');
      // Auto-open the invoice print dialog (best-effort).
      //this.printPaidInvoice();
    } catch (e: any) {
      this.toasts.error(e?.message ?? 'Could not complete payment');
    } finally {
      this.confirming.set(false);
    }
  }

  /** Show "Collect sample" after payment when collection happens at the front
   *  desk (in this workflow) and the user can collect. */
  readonly canCollectHere = computed(() =>
    this.labCfg.collectsAtFrontdesk() &&
    this.process.isEnabled('sample_collection') &&
    this.auth.hasPermission('collect_sample'));
  collectPaidSample() {
    const oid = this.paidOrderId();
    if (!oid) return;
    // After collection, return to the frontdesk landing (not back to the
    // build-order screen).
    this.router.navigate(['/lab/collect'], { queryParams: { orderId: oid, from: '/frontdesk' } });
  }

  /** Reset the screen for the next patient after a completed order. */
  startNewOrder() {
    this.paidOrderId.set(null);
    this.paidBill = null;
    this._selected.set([]);
    this._patient.set(null);
    this.discountValue.set('');
    this.router.navigateByUrl('/frontdesk/order');
    setTimeout(() => {
      this.patientSearch()?.focus();
    }, 0);
  }

  printPaidInvoice() { void this.emitPaidInvoice('print'); }
  showPaidInvoice() { void this.emitPaidInvoice('blob'); }

  /** Build the A4 invoice (letterhead + tracking QR) for the paid order and
   *  either print it or open it in the in-app preview. */
  private async emitPaidInvoice(action: 'print' | 'blob') {
    const bill = this.paidBill;
    const oid = this.paidOrderId();
    if (!bill || !oid) return;
    let tpl: any = null;
    try { tpl = await firstValueFrom(this.api.get<any>('/api/config/invoice-template')); } catch { /* optional */ }
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
      cashierName: this.auth.user()?.displayName || undefined,
      ...invoiceTemplateFieldsFrom(tpl),
      practice: {
        name: (tpl?.labName || this.auth.user()?.tenantName) || undefined,
        address: tpl?.address || undefined,
        phone: tpl?.phone || undefined,
        email: tpl?.email || undefined,
        gstin: tpl?.showGstin === false ? undefined : (tpl?.gstin || undefined),
      },
    };

    // Print on native: the hidden-iframe window.print() is a no-op in the
    // Capacitor WKWebView, so render to a blob and hand it to the native share
    // sheet (Print, Save to Files, AirDrop…) via the Web Share API.
    if (action === 'print' && this.isNativePlatform()) {
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

    const blobUrl = generateInvoicePdf({ ...input, action });
    if (action === 'blob' && blobUrl) {
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
  ngOnDestroy() { this.closeInvoicePreview(); }

  submit() {
    const p = this._patient();
    if (!p || this._saving() || this._selected().length === 0) return;

    // EDIT mode → PATCH the existing order's tests; the bill recomputes server-
    // side and we route to billing to collect-the-difference / refund.
    const editId = this.editOrderId();
    if (editId) {
      this._saving.set(true);
      this.api.patch<{ order: Order; bill: unknown }>(`/api/orders/${editId}/tests`, {
        testIds: this._selected(), reason: 'reception edit'
      }).subscribe({
        next: () => {
          this._saving.set(false);
          this.toasts.success('Order updated — reconcile payment');
          this.router.navigate(['/frontdesk/billing'], { queryParams: this.billingQueryParams(editId) });
        },
        error: e => { this._saving.set(false); this.toasts.error(e?.error?.error?.message ?? e?.message ?? 'Update failed'); }
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
      metadataJson: appointmentId ? JSON.stringify({ appointmentId }) : null
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
          this.router.navigate(['/frontdesk/billing'], { queryParams: this.billingQueryParams(order.id) });
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
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Order failed'); }
    });
  }

  back() {
    if (window.history.length > 1) this.locationSvc.back();
    else this.router.navigateByUrl('/frontdesk');
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
      error: () => {
        // Revert.
        const revert = new Set(this.favouriteIds());
        if (wasFav) revert.add(testId); else revert.delete(testId);
        this.favouriteIds.set(revert);
        this.toasts.error('Could not update favourites');
      }
    });
  }

  setCategoryTab(tab: 'recent' | 'favourites' | 'packages' | 'all'): void {
    this.categoryTab.set(tab);
    this.preSearchTab = tab;
  }

  // ── Ref hospital ─────────────────────────────────────────────────

  onRefHospitalInput(value: string): void {
    this.refHospitalName.set(value);
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
    this.refDoctorOpen.set(true);
    if (this.refDoctorDebounce) clearTimeout(this.refDoctorDebounce);
    this.refDoctorDebounce = setTimeout(() => this.fetchDoctorSuggestions(value), 200);
  }

  pickRefDoctor(name: string): void {
    this.refDoctorName.set(name);
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
