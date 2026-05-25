import { Location, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';

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
  imports: [NgTemplateOutlet, CurrencyInrPipe, AvatarComponent, ScreenHeaderComponent, TouchButtonComponent, PatientSearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-create.component.html',
  styleUrls: ['./order-create.component.scss']
})
export class OrderCreateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly locationSvc = inject(Location);
  private readonly settings = inject(FrontdeskSettingsService);

  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

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
  readonly categoryTab = signal<'recent' | 'favourites' | 'packages' | 'all'>('all');
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
  readonly packages = computed(() => this._tests().filter(t => t.type === 'package'));

  // ── Category-aware test lists ────────────────────────────────────

  /** Tests pinned by the current user, in pin order. Filtered to active. */
  readonly favouriteTests = computed<Test[]>(() => {
    const ids = this.favouriteIds();
    if (ids.size === 0) return [];
    const byId = new Map(this._tests().map(t => [t.id, t]));
    return Array.from(ids).map(id => byId.get(id)).filter((t): t is Test => !!t && t.isActive);
  });

  /** Tests this user has ordered in the past, most-recent first. */
  readonly recentTests = computed<Test[]>(() => {
    const ids = this.recentIds();
    if (ids.length === 0) return [];
    const byId = new Map(this._tests().map(t => [t.id, t]));
    return ids.map(id => byId.get(id)).filter((t): t is Test => !!t && t.isActive);
  });

  /** True when the test id is in the user's favourites. */
  isFavourite(testId: string): boolean { return this.favouriteIds().has(testId); }

  readonly filteredTests = computed(() => {
    const q = this._query().trim().toLowerCase();
    const list = this.individualTests();
    if (!q) return list;
    // Common spelling divergences. US "hematology" wouldn't match the
    // British "haematology" stored in the dept catalogue otherwise; same
    // for paediatric / pediatric, anaesthesia / anesthesia. Expand the
    // query into all known variants and match if ANY hit.
    const variants = this.spellingVariants(q);
    return list.filter(t => {
      const hay = [
        t.name,
        t.hsnSacCode ?? '',
        t.department?.name ?? ''
      ].join(' ').toLowerCase();
      return variants.some(v => hay.includes(v));
    });
  });

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

  readonly subtotal = computed(() =>
    this._selected()
      .map(id => this._tests().find(t => t.id === id)?.price ?? 0)
      .reduce((a, b) => a + b, 0)
  );
  readonly gst = computed(() => Math.round(this.subtotal() * 0.18));
  readonly total = computed(() => this.subtotal() + this.gst());

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

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: l => this._tests.set(l ?? []),
      error: e => this.toasts.error(`Could not load tests: ${e?.message ?? 'unknown error'}`)
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
  private preselectFromOrder(prior: HistoryRow) {
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
      if (dropped > 0) {
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
  setQuery(q: string) { this._query.set(q); }
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

  submit() {
    const p = this._patient();
    if (!p || this._saving() || this._selected().length === 0) return;

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
        // Admin-controlled fork: if frontdesk collects payment, jump into
        // the Billing tab with the new order preselected; otherwise raise
        // a billing request and reset for the next patient/order.
        if (this.settings.collectsBilling()) {
          this.toasts.success('Order created — enter billing');
          this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: order.id } });
        } else {
          // Admin set "Frontdesk does not collect" — raise billing as a
          // separate request and return to Home for the next patient.
          this.toasts.success('Order created — billing request raised');
          this._selected.set([]);
          this._patient.set(null);
          this.router.navigateByUrl('/frontdesk');
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
