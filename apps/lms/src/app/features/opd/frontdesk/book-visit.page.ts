import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { type Patient, patientDisplayName } from '../../../shared/models/patient.model';
import type { Test } from '../../../shared/models/test.model';
import { formatAge } from '../../../shared/utils/patient-age';
import { filterTestListStrict } from '../../../shared/utils/test-search';
import { testListUrl } from '../../../shared/utils/test-list-url';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  InlinePaymentPanelComponent, type InlinePaymentResult,
} from '../../frontdesk/order-create/inline-payment-panel.component';
import { OpdVitalsFormComponent } from '../vitals/vitals-form.component';
import { OpdSpecimenPickerComponent } from '../shared/opd-specimen-picker.component';
import { missingSpecimens, specimenPayload, type OpdInvestigationItem, type OpdTestLookup } from '../shared/opd-specimen';
import { OpdDeskApi } from './desk-api.service';
import type { DeskData, DeskDepartment, DeskDoctor, DeskQuote, ServiceQuote } from './desk.models';
import {
  type LabLine, deskBillPreview, draftKey, feeLineLabel, paymentParts, parseOverride, readDraft, waitLabel, waitTone, writeDraft,
} from './desk-rules';

type PickMode = 'doctor' | 'department';
type CatalogTab = 'doctors' | 'departments' | 'labs';

/**
 * OPD → New visit (`/opd/visit/new?patientId=`). SAME shell as the lab's
 * Order & Payments (`features/frontdesk/order-create`): a band with chips
 * (Consultation / patient) + a catalogue search, a left catalogue card with
 * tabs (Doctors / Departments / Lab tests) and department filter chips, and
 * a right BILLING card that follows every choice — the consult line (with
 * the follow-up rule and an exact desk override), the lab tests' own lab
 * bill, one total and Save as draft + Continue to payment. The draft saves
 * itself (per user × branch). Payment reuses Order & Payments' inline
 * payment panel; the server books, bills and issues the token in one call,
 * then the visit screen shows the token.
 *
 * "Any doctor in <department>" is always an EXPLICIT tile the receptionist
 * taps (never a silent auto-pick on choosing the department) — see
 * {@link pickAnyInDepartment}.
 */
@Component({
  selector: 'pf-opd-book-visit',
  standalone: true,
  imports: [
    RouterLink, HeroBandComponent, PatientSearchComponent, ScreenHeaderComponent, SkeletonRowsComponent,
    CurrencyInrPipe, BusyDirective, InlinePaymentPanelComponent, OpdVitalsFormComponent, OpdSpecimenPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './book-visit.page.html',
  styleUrls: ['./opd-b.scss', './book-visit.page.scss'],
})
export class OpdBookVisitPage {
  private readonly api = inject(ApiService);
  private readonly desk = inject(OpdDeskApi);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  readonly vitalsForm = viewChild(OpdVitalsFormComponent);
  readonly payPanel = viewChild(InlinePaymentPanelComponent);

  // ── Loaded data ───────────────────────────────────────────────────────
  readonly data = signal<DeskData | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly quote = signal<DeskQuote | null>(null);
  readonly quoting = signal(false);
  readonly tests = signal<Test[]>([]);
  readonly gstOn = signal(false);

  // ── Choices ──────────────────────────────────────────────────────────
  readonly patient = signal<Patient | null>(null);
  readonly patientLoading = signal(false);
  readonly lastVisitText = signal<string | null>(null);
  readonly mode = signal<PickMode>('doctor');
  readonly doctorId = signal<string | null>(null);
  readonly departmentId = signal<string | null>(null);
  /** Catalogue card (order-create shell): Doctors / Departments / Lab tests. */
  readonly catalogTab = signal<CatalogTab>('doctors');
  /** Department filter chip selected in the Doctors tab (also the expanded
   *  row in the Departments tab) — `null` = all departments. */
  readonly deptFilterId = signal<string | null>(null);
  /** Band search once a patient is picked: "Search doctors, departments or
   *  services" — filters the Doctors / Departments tabs only (Lab tests
   *  keeps its own search, unchanged). */
  readonly catalogQuery = signal('');
  readonly serviceId = signal<string | null | undefined>(undefined); // undefined = not picked; null = plain consultation
  readonly purpose = signal('');
  readonly overrideRaw = signal('');
  readonly overrideReason = signal('');
  readonly overrideOpen = signal(false);
  readonly labIds = signal<string[]>([]);
  readonly labQuery = signal('');
  /** testId → the picked specimen (choose-mode tests only) — see
   *  `features/opd/shared/opd-specimen.ts` / `pf-opd-specimen-picker`. */
  readonly labSpecimens = signal<Record<string, string>>({});
  /** Cart rows a blocked Checkout must point at (cleared as each is picked). */
  readonly specimenErr = signal<Record<string, true>>({});
  readonly urgent = signal(false);
  readonly vitalsHere = signal(false);

  // ── Flow ─────────────────────────────────────────────────────────────
  readonly stage = signal<'build' | 'pay'>('build');
  readonly submitting = signal(false);

  readonly workflow = computed(() => this.data()?.config.workflow ?? { vitals: 'desk', labTestsAtDesk: true, billing: 'before_consult' as const });
  readonly payFirst = computed(() => this.workflow().billing !== 'after_consult');
  readonly doctors = computed(() => this.data()?.doctors ?? []);
  readonly departments = computed(() => this.data()?.departments ?? []);
  readonly doctor = computed<DeskDoctor | null>(() => this.doctors().find(d => d.id === this.doctorId()) ?? null);
  readonly department = computed<DeskDepartment | null>(() => this.departments().find(d => d.id === this.departmentId()) ?? null);
  /** Doctors tab: department chip filter, then the band's catalogue search. */
  readonly deptFilter = computed<DeskDepartment | null>(() => this.departments().find(d => d.id === this.deptFilterId()) ?? null);
  readonly filteredDoctors = computed(() => {
    const dep = this.deptFilter();
    const q = this.catalogQuery().trim().toLowerCase();
    return this.doctors().filter(d => {
      if (dep && !dep.doctorIds.includes(d.id)) return false;
      if (!q) return true;
      return d.name.toLowerCase().includes(q) || (d.department ?? '').toLowerCase().includes(q);
    });
  });
  readonly filteredDepartments = computed(() => {
    const q = this.catalogQuery().trim().toLowerCase();
    if (!q) return this.departments();
    return this.departments().filter(d => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q));
  });
  readonly services = computed(() => this.quote()?.services ?? []);
  readonly service = computed<ServiceQuote | null>(() => {
    const id = this.serviceId();
    if (id === undefined) return null;
    return this.services().find(s => s.serviceId === id) ?? null;
  });
  readonly override = computed(() => {
    const v = parseOverride(this.overrideRaw());
    return v != null && Number.isNaN(v) ? null : v;
  });
  readonly overrideInvalid = computed(() => Number.isNaN(parseOverride(this.overrideRaw()) as number));
  readonly testById = computed<Map<string, Test>>(() => new Map(this.tests().map(t => [t.id, t])));
  readonly labTests = computed<LabLine[]>(() => {
    const byId = this.testById();
    return this.labIds().map(id => byId.get(id)).filter((t): t is Test => !!t)
      .map(t => ({ id: t.id, name: t.name, price: t.price ?? 0, slab: this.gstOn() ? t.taxSlab ?? 0 : 0 }));
  });
  readonly labResults = computed(() => {
    const q = this.labQuery().trim();
    if (!q) return [];
    const chosen = new Set(this.labIds());
    return filterTestListStrict(this.tests(), q).filter(t => !chosen.has(t.id)).slice(0, 8);
  });
  readonly preview = computed(() => deskBillPreview(this.service(), this.override(), this.labTests()));
  readonly stepCount = computed(() => 3 + (this.workflow().labTestsAtDesk ? 1 : 0) + (this.workflow().vitals !== 'off' ? 1 : 0));
  readonly vitalsStep = computed(() => (this.workflow().labTestsAtDesk ? 5 : 4));
  readonly takeVitalsHere = computed(() => this.workflow().vitals === 'desk' || (this.workflow().vitals === 'station' && this.vitalsHere()));
  readonly ready = computed(() => !!this.patient() && !!this.doctor() && !!this.service() && !this.overrideInvalid());
  readonly missing = computed(() =>
    !this.patient() ? 'Find the patient first' : !this.doctor() ? 'Pick a doctor or department' : !this.service() ? 'Pick the visit purpose' : this.overrideInvalid() ? 'Check the fee amount' : '');
  readonly today = computed(() => {
    const d = this.data()?.today; if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  });
  readonly nextStepText = computed(() => {
    const d = this.doctor(); const who = d ? d.name : 'the doctor';
    const pron = this.pronoun();
    if (this.workflow().vitals === 'off') return `then ${pron} goes to ${who}'s queue.`;
    if (this.takeVitalsHere() || this.workflow().vitals === 'desk') return `record ${pron === 'they' ? 'their' : pron === 'she' ? 'her' : 'his'} vitals here, then ${pron} goes to ${who}'s queue.`;
    return `then ${pron} goes to the vitals station.`;
  });
  readonly pronoun = computed(() => {
    const s = (this.patient()?.sex ?? '').toLowerCase();
    return s.startsWith('f') ? 'she' : s.startsWith('m') ? 'he' : 'they';
  });

  readonly ctaLabel = computed(() => !this.ready() ? this.missing() : this.payFirst() && this.preview().total > 0 ? 'Continue to payment' : 'Book visit');
  /** Phones (≤640px): the CTA docks in the bottom bar (ND §8). */
  readonly phone = signal(false);
  readonly objectPronoun = computed(() => ({ she: 'her', he: 'him', they: 'the patient' } as Record<string, string>)[this.pronoun()]);

  private draftStorage: Storage | null = null;
  private restoring = false;

  constructor() {
    try {
      const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
      if (mq) {
        this.phone.set(mq.matches);
        const on = (e: MediaQueryListEvent) => this.phone.set(e.matches);
        mq.addEventListener?.('change', on);
        this.destroyRef.onDestroy(() => mq.removeEventListener?.('change', on));
      }
    } catch { /* no matchMedia */ }
    try { this.draftStorage = typeof localStorage !== 'undefined' ? localStorage : null; } catch { this.draftStorage = null; }
    this.desk.desk().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => {
        this.data.set(d);
        this.vitalsHere.set(d.config.workflow.vitals === 'desk');
        this.restore();
      },
      error: e => this.loadError.set(ApiError.from(e).message),
    });
    this.api.get<Test[]>(testListUrl({ activeOnly: true })).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: l => this.tests.set((l ?? []).filter(t => t.isEnabled !== false && t.isOffered !== false)),
      error: () => this.tests.set([]),
    });
    this.api.get<{ gstEnabled?: boolean }>('/api/config/billing/visibility').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: c => this.gstOn.set(!!c?.gstEnabled), error: () => this.gstOn.set(false),
    });

    // Re-quote whenever the doctor or the patient changes.
    effect(() => {
      const doc = this.doctorId();
      const pid = this.patient()?.id ?? null;
      untracked(() => this.loadQuote(doc, pid));
    });
    // Draft: save every change (per user × branch). A convenience only.
    effect(() => {
      const d = {
        patientId: this.patient()?.id ?? null, doctorId: this.doctorId(), departmentId: this.departmentId(),
        serviceId: this.serviceId() ?? null, purpose: this.purpose(), override: this.overrideRaw(),
        overrideReason: this.overrideReason(), labIds: this.labIds(), urgent: this.urgent(), vitalsHere: this.vitalsHere(),
        savedAt: Date.now(),
      };
      if (this.restoring || !this.data()) return;
      const empty = !d.patientId && !d.doctorId && !d.labIds.length && !d.purpose;
      untracked(() => writeDraft(this.draftStorage, this.key(), empty ? null : d));
    });
  }

  private key(): string {
    const u = this.auth.user();
    return draftKey(u?.id ?? 'anon', this.auth.activeBranchId?.() ?? u?.branchId ?? 'main');
  }

  /** ?patientId= (the new-order fork) wins; else the saved draft. */
  private restore(): void {
    const qp = this.route.snapshot.queryParamMap.get('patientId');
    const draft = readDraft(this.draftStorage, this.key());
    const pid = qp ?? draft?.patientId ?? null;
    if (draft && (!qp || qp === draft.patientId)) {
      this.restoring = true;
      this.doctorId.set(draft.doctorId ?? null);
      this.departmentId.set(draft.departmentId ?? null);
      if (draft.departmentId) { this.mode.set('department'); this.deptFilterId.set(draft.departmentId); }
      this.serviceId.set(draft.serviceId === null && draft.doctorId ? null : draft.serviceId ?? undefined);
      this.purpose.set(draft.purpose ?? '');
      this.overrideRaw.set(draft.override ?? '');
      this.overrideReason.set(draft.overrideReason ?? '');
      this.overrideOpen.set(!!draft.override);
      this.labIds.set(draft.labIds ?? []);
      this.urgent.set(!!draft.urgent);
      if (draft.vitalsHere != null) this.vitalsHere.set(draft.vitalsHere);
      this.restoring = false;
    }
    if (pid) this.loadPatient(pid);
  }

  private loadPatient(id: string): void {
    this.patientLoading.set(true);
    this.api.get<{ patient: Patient }>(`/api/patients/${id}`).subscribe({
      next: r => { this.patientLoading.set(false); if (r?.patient) this.patient.set(r.patient); },
      error: () => { this.patientLoading.set(false); this.toasts.error('That patient could not be opened. Search again.'); },
    });
  }

  private loadQuote(doctorId: string | null, patientId: string | null): void {
    if (!doctorId) { this.quote.set(null); return; }
    this.quoting.set(true);
    this.desk.quote(doctorId, patientId).subscribe({
      next: q => {
        this.quoting.set(false);
        if (this.doctorId() !== doctorId) return;
        this.quote.set(q);
        const lw = q.lastWithDoctor ?? q.lastVisit;
        this.lastVisitText.set(lw ? `${this.shortDate(lw.visitDate)} · ${lw.departmentName ?? lw.doctorName}` : null);
        // Keep a still-valid pick; else pre-pick the single option or the follow-up.
        const cur = this.serviceId();
        if (cur !== undefined && q.services.some(s => s.serviceId === cur)) return;
        const fu = q.services.find(s => s.isFollowUp);
        this.serviceId.set(fu ? fu.serviceId : q.services.length === 1 ? q.services[0].serviceId : undefined);
      },
      error: e => { this.quoting.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  // ── Patient ──────────────────────────────────────────────────────────
  pickPatient(p: Patient): void {
    this.patient.set(p);
    this.stage.set('build');
  }
  clearPatient(): void { this.patient.set(null); this.lastVisitText.set(null); }
  patientName(p: Patient): string { return patientDisplayName(p); }
  patientBits(p: Patient): string[] {
    const sex = (p.sex ?? '').trim().charAt(0).toUpperCase();
    return [
      [formatAge(p, 'y', ''), sex].filter(Boolean).join(' '),
      p.mrn ?? '',
      p.phone ? this.maskPhone(p.phone) : '',
      p.abhaId ? 'ABHA linked' : '',
    ].filter(Boolean);
  }
  private maskPhone(ph: string): string {
    const d = ph.replace(/\D/g, '').slice(-10);
    return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5, 7)}xxx` : ph;
  }
  initials(name: string): string {
    return name.replace(/^(dr|mr|mrs|ms|master)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  }
  private shortDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  // ── Catalogue tabs ───────────────────────────────────────────────────
  setCatalogTab(t: CatalogTab): void { this.catalogTab.set(t); }
  /** Department chip / tile: only FILTERS the Doctors tab — picking a
   *  doctor is always its own, separate, explicit click (never silent). */
  filterByDepartment(dep: DeskDepartment | null): void {
    this.deptFilterId.set(dep?.id ?? null);
    this.catalogTab.set('doctors');
  }
  // ── Doctor / department ──────────────────────────────────────────────
  pickDoctor(d: DeskDoctor): void {
    if (this.doctorId() !== d.id) { this.serviceId.set(undefined); this.clearOverride(); }
    this.doctorId.set(d.id);
    const dep = this.deptFilterId();
    if (dep) { this.mode.set('department'); this.departmentId.set(dep); } else { this.mode.set('doctor'); this.departmentId.set(null); }
  }
  /** The EXPLICIT "Any doctor in <department>" tile — the least-waiting
   *  doctor of the department (the server's rule), never picked silently
   *  just because the department was selected. */
  pickAnyInDepartment(dep: DeskDepartment): void {
    const docs = this.doctors().filter(d => dep.doctorIds.includes(d.id))
      .sort((a, b) => a.waiting - b.waiting || a.name.localeCompare(b.name));
    if (!docs.length) { this.toasts.info(`No doctor is set up in ${dep.name} yet.`); return; }
    if (this.doctorId() !== docs[0].id) { this.serviceId.set(undefined); this.clearOverride(); }
    this.doctorId.set(docs[0].id);
    this.mode.set('department');
    this.departmentId.set(dep.id);
    this.deptFilterId.set(dep.id);
    this.catalogTab.set('doctors');
  }
  waitText(d: { waiting: number; estWaitMinutes?: number }): string { return waitLabel(d.waiting, d.estWaitMinutes ?? d.waiting * 10); }
  waitClass(d: { waiting: number; estWaitMinutes?: number }): string { return 'pf-ob-dot--' + waitTone(d.waiting, d.estWaitMinutes ?? d.waiting * 10); }
  deptDoctorsText(dep: DeskDepartment): string {
    const n = dep.doctorIds.length;
    return n === 1 ? '1 doctor' : `${n} doctors`;
  }

  // ── Service + fee ────────────────────────────────────────────────────
  pickService(s: ServiceQuote): void {
    if (this.serviceId() !== s.serviceId) this.clearOverride();
    this.serviceId.set(s.serviceId);
  }
  serviceMeta(s: ServiceQuote): string {
    const doc = this.doctor()?.name ?? 'the doctor';
    if (s.isFollowUp) return `Same doctor within ${s.followUpWithinDays} days · ${doc}'s follow-up rule`;
    const cat = s.category === 'procedure' ? 'Procedure' : 'Consultation';
    return s.priceSource === 'per_doctor' ? `${cat} · ${doc}'s fee` : s.priceSource === 'doctor_fee' ? `${cat} · ${doc}'s fee` : `${cat} · common price`;
  }
  lineName(): string {
    const s = this.service(); if (!s) return '';
    return feeLineLabel(s.name, s.isFollowUp, s.quoted, this.override());
  }
  lineMeta(): string {
    const s = this.service(); if (!s) return '';
    const d = this.doctor()?.name ?? '';
    if (this.override() != null && this.override() !== s.quoted) return `${d} · ${s.isFollowUp ? 'follow-up fee, ' : ''}set at the desk`;
    return `${d} · ${s.isFollowUp ? 'follow-up fee' : s.priceSource === 'common' ? 'common price' : 'per-doctor fee'}`;
  }
  openOverride(): void { this.overrideOpen.set(true); if (!this.overrideRaw()) this.overrideRaw.set(String(this.service()?.quoted ?? '')); }
  clearOverride(): void { this.overrideOpen.set(false); this.overrideRaw.set(''); this.overrideReason.set(''); }
  onOverride(v: string): void { this.overrideRaw.set(v.replace(/[^\d.]/g, '')); }

  // ── Lab tests ────────────────────────────────────────────────────────
  addLab(t: Test): void { this.labIds.update(l => (l.includes(t.id) ? l : [...l, t.id])); this.labQuery.set(''); }
  removeLab(id: string): void {
    this.labIds.update(l => l.filter(x => x !== id));
    this.labSpecimens.update(m => { if (!(id in m)) return m; const n = { ...m }; delete n[id]; return n; });
    this.specimenErr.update(m => { if (!(id in m)) return m; const n = { ...m }; delete n[id]; return n; });
  }
  clearLabs(): void { this.labIds.set([]); this.labSpecimens.set({}); this.specimenErr.set({}); }
  onLabKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && this.labResults().length) { ev.preventDefault(); this.addLab(this.labResults()[0]); }
    if (ev.key === 'Escape') this.labQuery.set('');
  }
  testCode(t: Test): string { return t.shortName || t.testCode || ''; }

  // ── Specimen (choose-mode lab tests) ────────────────────────────────────
  testForPicker(id: string): { id: string; name: string; parameters?: string | null } {
    const t = this.testById().get(id);
    return { id, name: t?.name ?? '', parameters: t?.parameters ?? null };
  }
  specimenOf(id: string): string | null { return this.labSpecimens()[id] ?? null; }
  specimenInvalid(id: string): boolean { return !!this.specimenErr()[id]; }
  setSpecimen(id: string, v: string): void {
    this.labSpecimens.update(m => ({ ...m, [id]: v }));
    if (v) this.specimenErr.update(m => { if (!m[id]) return m; const n = { ...m }; delete n[id]; return n; });
  }
  /** Picked lab tests as `opd-specimen.ts` items — the same shape Complete
   *  (consult) will build from `ItemDto`. */
  private specimenItems(): OpdInvestigationItem[] {
    return this.labTests().map(l => ({ testId: l.id, name: l.name, specimen: this.labSpecimens()[l.id] }));
  }
  /** Blocks Checkout the same way `order-create`'s `requireSpecimens()`
   *  blocks Save/Pay — a choose-mode test with nothing picked yet would
   *  otherwise make the server refuse the WHOLE booking (400
   *  `specimen_required`, thrown before anything OPD is written). */
  private requireLabSpecimens(): boolean {
    const byId = this.testById();
    const testsById: OpdTestLookup = {};
    for (const l of this.labTests()) { const t = byId.get(l.id); if (t) testsById[l.id] = t; }
    const missing = missingSpecimens(this.specimenItems(), testsById);
    if (!missing.length) return true;
    this.specimenErr.set(Object.fromEntries(missing.map(m => [m.testId, true as const])));
    this.catalogTab.set('labs');
    setTimeout(() => {
      const host = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.pf-opd-spec--err') : null;
      host?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 0);
    return false;
  }

  // ── Checkout ─────────────────────────────────────────────────────────
  continueToPayment(): void {
    if (!this.ready()) { this.toasts.info(this.missing()); return; }
    if (!this.requireLabSpecimens()) { this.toasts.error('Choose the specimen for the highlighted lab test(s).'); return; }
    if (this.phone()) queueMicrotask(() => document.querySelector('.pf-ov-bill')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (this.takeVitalsHere()) {
      const f = this.vitalsForm();
      if (f && !f.empty() && !f.valid()) { f.reveal(); this.toasts.error('Check the vitals.'); return; }
    }
    if (!this.payFirst() || this.preview().total <= 0) { void this.book([]); return; }
    this.stage.set('pay');
  }
  backToBuild(): void { this.stage.set('build'); }

  onPaid(r: InlinePaymentResult): void {
    const parts = paymentParts(r, this.preview().total);
    if (parts === null) { this.toasts.info('Bill to vendor and Pay later are not taken at the OPD desk.'); return; }
    void this.book(parts);
  }

  private async book(payments: { mode: 'cash' | 'upi' | 'card' | 'other'; amount: number; reference?: string | null }[]): Promise<void> {
    const p = this.patient(); const d = this.doctor(); const s = this.service();
    if (!p || !d || !s || this.submitting()) return;
    const f = this.vitalsForm();
    const vitals = this.takeVitalsHere() && f && !f.empty() ? f.vitals() : null;
    this.submitting.set(true);
    try {
      const v = await firstValueFrom(this.desk.checkout({
        patientId: p.id, doctorUserId: d.id, departmentId: this.mode() === 'department' ? this.departmentId() : null,
        serviceId: s.serviceId, purpose: this.purpose().trim() || null,
        feeOverride: this.override(), feeOverrideReason: this.overrideReason().trim() || null,
        labTestIds: this.labIds(), labTestSpecimens: specimenPayload(this.specimenItems()) ?? undefined,
        urgent: this.urgent(), vitals, payments,
      }));
      writeDraft(this.draftStorage, this.key(), null);
      this.toasts.success(`Token ${v.tokenLabel} issued for ${v.patient.name}`);
      void this.router.navigate(['/opd/visit', v.id], { queryParams: { issued: 1 } });
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.submitting.set(false);
    }
  }

  discardDraft(): void {
    writeDraft(this.draftStorage, this.key(), null);
    this.patient.set(null); this.doctorId.set(null); this.departmentId.set(null); this.serviceId.set(undefined);
    this.purpose.set(''); this.clearOverride(); this.labIds.set([]); this.labSpecimens.set({}); this.specimenErr.set({}); this.urgent.set(false);
    this.deptFilterId.set(null); this.catalogQuery.set(''); this.catalogTab.set('doctors');
    this.vitalsForm()?.reset(); this.stage.set('build');
  }

  /** Footer "Save as draft" (order-create parity): the draft already
   *  autosaves on every change — this just confirms it and sends the
   *  receptionist back to the OPD desk to pick up the next patient. */
  saveDraftAndExit(): void {
    if (!this.patient()) { this.toasts.warning('Pick a patient first'); return; }
    this.toasts.success('Saved as draft');
    void this.router.navigateByUrl('/opd/desk');
  }
}
