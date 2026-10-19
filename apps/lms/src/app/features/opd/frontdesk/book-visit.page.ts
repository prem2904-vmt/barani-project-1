import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, type WritableSignal, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { ModuleScopeService } from '../../../core/services/module-scope.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { extractAbhaNumber } from '../../../shared/components/abha-wizard/abha-prefill.component';
import { PfKeysDirective } from '../../../shared/components/numpad/pf-keys.directive';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { type Patient, formatPatientInfo, patientDisplayName } from '../../../shared/models/patient.model';
import { formatAge } from '../../../shared/utils/patient-age';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  InlinePaymentPanelComponent, type InlinePaymentResult,
} from '../../frontdesk/order-create/inline-payment-panel.component';
import { SCOPE_LABELS, SCOPE_PLACEHOLDERS, SCOPE_PLACEHOLDERS_SHORT, type ScopeRow } from '../../frontdesk/order-create/unified-search';
import { labOrderTarget } from '../../../shared/opd/order-entry';
import { OpdDeskApi } from './desk-api.service';
import type { OpdVisitDetail, OpdVisitRow } from './desk.models';
import type { DeskData, DeskDepartment, DeskDoctor, DeskQuote, ServiceQuote } from './desk.models';
import { printTokenSlip } from './token-slip';
import {
  deskBillPreview, draftKey, feeLineLabel, paymentParts, parseOverride, readDraft, waitLabel, waitTone, writeDraft,
} from './desk-rules';

/** The band's scope tiles after the product switcher (same vocabulary as the
 *  lab's unified search: `unified-search.ts`). */
export type VisitScope = 'patient' | 'doctor';
/** The first band tile: the product switcher (static — it only switches screen). */
type BandMode = VisitScope | 'product';
/** Doctor column tabs (the order-create tab strip). */
export type DoctorTab = 'today' | 'all';

/** One department group of the doctor grid (the lab grid's department groups). */
export interface DoctorGroup { key: string; name: string; dept: DeskDepartment | null; anyTile: boolean; doctors: DeskDoctor[]; }

/**
 * OPD → New visit (`/opd/visit/new?patientId=`). The SAME screen as the lab's
 * Order & Payments (`features/frontdesk/order-create`) — it even wears that
 * page's stylesheet (one source for the look; the lab file is untouched):
 *
 * - Band: the product switcher (OPD · Tests — whatever the tenant/user has;
 *   it only switches screen), then the Patient and Doctor scope tiles and ONE
 *   search field — Patient finds patients, Doctor finds the OPD doctors.
 * - Left work card: In today / All doctors tabs, department chips + a
 *   "Free now" toggle chip, then the doctors as a full-width tile grid grouped
 *   by department (the lab test grid: 3 / 2 / 1 per row). "Any doctor in
 *   <department>" leads a department with more than one doctor. Picking a
 *   doctor opens the VISIT PURPOSE strip under the grid (the doctor's services
 *   as segmented choices, the default pre-picked) + the complaint.
 * - Right BILLING card: the consult line with its fee EDITABLE in place (the
 *   desk override — role cap / billing-admin rules stay on the server, reason
 *   printed on the bill), the total, Save as draft + Continue to payment →
 *   payment → token issued → Record vitals (the Vitals step, like Collect
 *   after a lab payment). Lab tests are ordered after the consult, from Tests.
 */
@Component({
  selector: 'pf-opd-book-visit',
  standalone: true,
  imports: [
    RouterLink, NgTemplateOutlet, HeroBandComponent, SkeletonRowsComponent, CurrencyInrPipe, BusyDirective, PfKeysDirective,
    InlinePaymentPanelComponent, BarcodeScannerModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './book-visit.page.html',
  // The lab's Order & Payments stylesheet FIRST (band pill, cards, tabs,
  // chips, rows, billing card, cart bar / sheet) — then only the OPD columns.
  styleUrls: ['../../frontdesk/order-create/order-create.component.scss', './book-visit.page.scss'],
})
export class OpdBookVisitPage {
  private readonly api = inject(ApiService);
  private readonly desk = inject(OpdDeskApi);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly modules = inject(ModuleScopeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly navBack = inject(NavBackService);

  readonly payPanel = viewChild(InlinePaymentPanelComponent);
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  readonly pillEl = viewChild<ElementRef<HTMLElement>>('pill');
  readonly feeInput = viewChild<ElementRef<HTMLInputElement>>('feeInput');

  // ── Loaded data ───────────────────────────────────────────────────────
  readonly data = signal<DeskData | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly quote = signal<DeskQuote | null>(null);
  readonly quoting = signal(false);

  // ── Choices ──────────────────────────────────────────────────────────
  readonly patient = signal<Patient | null>(null);
  readonly patientLoading = signal(false);
  readonly lastVisitText = signal<string | null>(null);
  readonly mode = signal<'doctor' | 'department'>('doctor');
  readonly doctorId = signal<string | null>(null);
  readonly departmentId = signal<string | null>(null);
  /** Doctor column tab (the order-create tab strip). */
  readonly doctorTab = signal<DoctorTab>('today');
  /** "Free now" toggle chip (end of the department chip row). */
  readonly freeOnly = signal(false);
  /** Department chip — filters the doctor grid; `null` = all departments. */
  readonly deptFilterId = signal<string | null>(null);
  readonly serviceId = signal<string | null | undefined>(undefined); // undefined = not picked; null = plain consultation
  readonly purpose = signal('');
  readonly overrideRaw = signal('');
  readonly overrideReason = signal('');
  /** The fee in the consult bill line is being edited (the desk override). */
  readonly overrideOpen = signal(false);

  // ── Flow ─────────────────────────────────────────────────────────────
  /** build → pay → issued (token on screen; next: Record vitals). */
  readonly stage = signal<'build' | 'pay' | 'issued'>('build');
  readonly submitting = signal(false);
  readonly issued = signal<OpdVisitDetail | null>(null);
  readonly printing = signal(false);

  readonly workflow = computed(() => this.data()?.config.workflow ?? { vitals: 'desk', labTestsAtDesk: true, billing: 'before_consult' as const });
  readonly payFirst = computed(() => this.workflow().billing !== 'after_consult');
  readonly doctors = computed(() => this.data()?.doctors ?? []);
  readonly departments = computed(() => this.data()?.departments ?? []);
  readonly doctor = computed<DeskDoctor | null>(() => this.doctors().find(d => d.id === this.doctorId()) ?? null);
  /** Today's open visits of the picked patient (duplicate-visit nudge). */
  readonly patientToday = signal<OpdVisitRow[]>([]);
  /** An open visit today with the SAME doctor — the desk should reopen it, not book twice. */
  readonly duplicateVisit = computed<OpdVisitRow | null>(() =>
    sameDoctorOpenVisit(this.patientToday(), this.doctorId()));
  readonly deptFilter = computed<DeskDepartment | null>(() => this.departments().find(d => d.id === this.deptFilterId()) ?? null);
  /** Doctors after the Free now chip (tab counts read this). */
  private readonly baseDoctors = computed(() => (this.freeOnly() ? this.doctors().filter(isFreeNow) : this.doctors()));
  readonly tabCounts = computed<Record<DoctorTab, number>>(() => {
    const dep = this.deptFilter();
    const l = dep ? this.baseDoctors().filter(d => dep.doctorIds.includes(d.id)) : this.baseDoctors();
    return { today: l.filter(inToday).length, all: l.length };
  });
  readonly filteredDoctors = computed(() => this.doctorGroups().flatMap(g => g.doctors).filter((d, i, a) => a.indexOf(d) === i));
  /** The grid: one group per department (the chip's only, when one is set),
   *  doctors without a department last. "Any doctor" leads a group that has
   *  more than one doctor in the department. */
  readonly doctorGroups = computed<DoctorGroup[]>(() => {
    const tab = this.doctorTab();
    const pool = this.baseDoctors().filter(d => tab === 'all' || inToday(d));
    const dep = this.deptFilter();
    const deps = dep ? [dep] : this.departments();
    const groups: DoctorGroup[] = deps.map(dp => ({
      key: dp.id, name: dp.name, dept: dp, anyTile: dp.doctorIds.length > 1,
      doctors: pool.filter(d => dp.doctorIds.includes(d.id)),
    })).filter(g => g.doctors.length > 0);
    if (!dep) {
      const placed = new Set(this.departments().flatMap(dp => dp.doctorIds));
      const rest = pool.filter(d => !placed.has(d.id));
      if (rest.length) groups.push({ key: '__none', name: groups.length ? 'Other doctors' : 'Doctors', dept: null, anyTile: false, doctors: rest });
    }
    return groups;
  });
  readonly doctorTabs: { id: DoctorTab; label: string }[] = [
    { id: 'today', label: 'In today' }, { id: 'all', label: 'All doctors' },
  ];
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
  /** The fee differs from the rule (what the bill line notes). */
  readonly overridden = computed(() => {
    const s = this.service(); const o = this.override();
    return !!s && o != null && o !== s.quoted;
  });
  /** Client mirror of the server rule (OpdDeskService.CheckoutAsync): charging
   *  MORE than the fee rule is a billing-admin power; the server decides. */
  readonly overrideAboveRule = computed(() => {
    const s = this.service(); const o = this.override();
    return !!s && o != null && o > s.quoted && !this.auth.hasPermission('manage_billing_config');
  });
  readonly preview = computed(() => deskBillPreview(this.service(), this.override(), []));
  readonly itemCount = computed(() => (this.service() ? 1 : 0));
  readonly ready = computed(() => !!this.patient() && !!this.doctor() && !!this.service() && !this.overrideInvalid());
  readonly missing = computed(() =>
    !this.patient() ? 'Find the patient first' : !this.doctor() ? 'Pick a doctor or department' : !this.service() ? 'Pick the visit purpose' : this.overrideInvalid() ? 'Check the fee amount' : '');
  readonly today = computed(() => {
    const d = this.data()?.today; if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  });
  readonly pronoun = computed(() => {
    const s = (this.patient()?.sex ?? '').toLowerCase();
    return s.startsWith('f') ? 'she' : s.startsWith('m') ? 'he' : 'they';
  });
  /** After the token: what happens next (the workflow decides). */
  readonly nextStepText = computed(() => {
    const d = this.doctor(); const who = d ? d.name : 'the doctor';
    const pron = this.pronoun();
    if (this.workflow().vitals === 'off') return `then ${pron} goes to ${who}'s queue.`;
    if (this.workflow().vitals === 'station') return `then ${pron} goes to the vitals station and on to ${who}'s queue.`;
    return `then record vitals on the Vitals step and ${pron} goes to ${who}'s queue.`;
  });
  readonly ctaLabel = computed(() => this.payFirst() && this.preview().total > 0 ? 'Continue to payment' : 'Book visit');
  readonly vitalsNext = computed(() => this.workflow().vitals !== 'off');

  // ── Layout (the order-create breakpoints) ────────────────────────────
  /** lg+ : BILLING is a persistent right column; below it opens as a sheet. */
  readonly isLg = signal(true);
  /** Phone width (≤640): short placeholders. */
  readonly isPhone = signal(false);
  readonly cartOpen = signal(false);

  // ── Band (unified search) ────────────────────────────────────────────
  protected readonly scopeLabels = SCOPE_LABELS;
  readonly bandMode = signal<BandMode>('patient');
  readonly scopeQuery = signal('');
  readonly scopeOpen = signal(false);
  readonly scopeHighlight = signal(0);
  readonly pillFocused = signal(false);
  readonly patientResults = signal<Patient[]>([]);
  readonly patientSearching = signal(false);
  readonly dropMaxH = signal<number | null>(null);
  readonly dropBox = signal<{ left: number; top: number; width: number } | null>(null);
  readonly scanning = signal(false);
  /** Tried to continue without a patient: shake the Patient tile once. */
  readonly patientNudge = signal(false);
  readonly dropOpen = computed(() => this.scopeOpen());
  readonly searchActive = computed(() => this.pillFocused() || this.dropOpen());
  /** The products this user may switch between (the first tile). OPD is the
   *  current one; Tests only when the lab is usable. */
  readonly products = computed(() => {
    const list: { id: 'opd' | 'lab'; label: string; meta: string }[] = [{ id: 'opd', label: 'OPD', meta: 'New visit · this screen' }];
    if (this.modules.labUsable()) list.push({ id: 'lab', label: 'Tests', meta: 'Lab order & payments' });
    return list;
  });
  readonly productSwitchable = computed(() => this.products().length > 1);
  readonly patientMissing = computed(() => !this.patient());
  readonly pillValue = computed(() => this.scopeQuery());
  readonly pillPlaceholder = computed(() => {
    const k = this.bandMode() === 'doctor' ? 'doctor' : 'patient';
    if (k === 'doctor') return this.isPhone() ? 'Find doctor' : 'Find a doctor or department';
    return (this.isPhone() ? SCOPE_PLACEHOLDERS_SHORT : SCOPE_PLACEHOLDERS).patient;
  });
  readonly pfKeysKind = computed(() => (this.bandMode() === 'patient' ? 'patient' as const : null));
  /** Dropdown rows for the active band tile. */
  readonly scopeRows = computed<ScopeRow[]>(() => {
    const k = this.bandMode();
    if (k === 'patient') {
      return this.patientResults().map(p => ({
        key: p.id, kind: 'match' as const, title: patientDisplayName(p),
        meta: [[formatAge(p, 'num'), (p.sex ?? '').charAt(0).toUpperCase()].filter(Boolean).join('/'), p.mrn, p.phone].filter(Boolean).join(' · '),
      }));
    }
    if (k === 'doctor') {
      const q = this.scopeQuery().trim().toLowerCase();
      const docs = this.doctors().filter(d => !q || d.name.toLowerCase().includes(q) || (d.department ?? '').toLowerCase().includes(q));
      return docs.map(d => ({
        key: d.id, kind: 'match' as const, title: d.name,
        meta: [d.department || 'OPD', d.sitsToday === false ? 'Not in today' : this.waitText(d), d.fee != null ? `₹${d.fee}` : ''].filter(Boolean).join(' · '),
      }));
    }
    return this.products().map(p => ({ key: p.id, kind: 'match' as const, title: p.label, meta: p.meta }));
  });
  readonly scopeTitle = computed(() => {
    const k = this.bandMode();
    if (k === 'product') return 'SWITCH TO';
    const n = this.scopeRows().length;
    return `${SCOPE_LABELS[k].toUpperCase()} · ${n} MATCH${n === 1 ? '' : 'ES'}`;
  });
  readonly patientStatus = computed<'hint' | 'loading' | 'empty' | null>(() => {
    if (this.bandMode() !== 'patient') return null;
    const q = this.scopeQuery().trim();
    if (q.length < 2) return 'hint';
    if (this.patientSearching()) return 'loading';
    return this.patientResults().length ? null : 'empty';
  });

  private draftStorage: Storage | null = null;
  private restoring = false;
  private patientTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.watchMedia('(min-width: 1024px)', this.isLg, true);
    this.watchMedia('(max-width: 640px)', this.isPhone, false);
    try { this.draftStorage = typeof localStorage !== 'undefined' ? localStorage : null; } catch { this.draftStorage = null; }
    this.desk.desk().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => { this.data.set(d); this.restore(); },
      error: e => this.loadError.set(ApiError.from(e).message),
    });

    effect(() => {
      const pid = this.patient()?.id ?? null;
      if (!pid) { this.patientToday.set([]); return; }
      this.desk.visits({}).subscribe({ next: rows => this.patientToday.set((rows ?? []).filter(r => r.patientId === pid)), error: () => this.patientToday.set([]) });
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
        overrideReason: this.overrideReason(),
        savedAt: Date.now(),
      };
      if (this.restoring || !this.data() || this.stage() === 'issued') return;
      const empty = !d.patientId && !d.doctorId && !d.purpose;
      untracked(() => writeDraft(this.draftStorage, this.key(), empty ? null : d));
    });
  }

  private watchMedia(q: string, sig: WritableSignal<boolean>, fallback: boolean): void {
    try {
      const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null;
      if (!mq) { sig.set(fallback); return; }
      sig.set(mq.matches);
      const on = (e: MediaQueryListEvent) => sig.set(e.matches);
      mq.addEventListener?.('change', on);
      this.destroyRef.onDestroy(() => mq.removeEventListener?.('change', on));
    } catch { sig.set(fallback); }
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
      this.restoring = false;
    }
    if (pid) { this.bandMode.set('doctor'); this.loadPatient(pid); }
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
        this.serviceId.set(defaultPurpose(q.services)?.serviceId);
      },
      error: e => { this.quoting.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  // ── Band: tiles, field, dropdown (order-create's unified search) ─────
  /** The value shown ON a tile ('' when empty). */
  tilePick(k: VisitScope): string {
    return k === 'patient' ? patientDisplayName(this.patient()) : (this.doctor()?.name ?? '');
  }
  tileLabel(k: VisitScope): string { return this.tilePick(k) || SCOPE_LABELS[k]; }
  tileTitle(k: VisitScope): string {
    const p = this.patient();
    if (k === 'patient' && p) return formatPatientInfo(p);
    const v = this.tilePick(k);
    return v ? `${SCOPE_LABELS[k]}: ${v}` : SCOPE_LABELS[k];
  }
  tileClearable(k: VisitScope): boolean { return !!this.tilePick(k) && this.bandMode() !== k && this.stage() !== 'issued'; }

  selectScope(k: BandMode): void {
    if (this.stage() === 'issued' && k !== 'product') return;
    if (k === 'product' && !this.productSwitchable()) return;
    this.bandMode.set(k);
    this.scopeQuery.set('');
    this.scopeHighlight.set(0);
    this.patientResults.set([]);
    this.patientSearching.set(false);
    if (k !== 'patient') this.patientNudge.set(false);
    this.sizeDropdown();
    this.scopeOpen.set(k !== 'patient');
    if (k !== 'product') this.focusSearchInput();
  }
  closeScope(): void {
    this.scopeOpen.set(false);
    this.scopeQuery.set('');
    if (this.bandMode() === 'product') this.bandMode.set(this.patient() ? 'doctor' : 'patient');
  }
  clearScope(k: VisitScope, ev?: Event): void {
    ev?.stopPropagation();
    if (k === 'patient') this.clearPatient(); else this.clearDoctor();
  }
  onPillInput(v: string): void {
    if (this.bandMode() === 'product') this.bandMode.set(this.patient() ? 'doctor' : 'patient');
    this.sizeDropdown();
    this.scopeQuery.set(v);
    this.scopeOpen.set(true);
    this.scopeHighlight.set(0);
    if (this.bandMode() === 'patient') this.searchPatients(v);
  }
  onPillFocus(): void {
    this.pillFocused.set(true);
    if (this.bandMode() === 'product') this.bandMode.set(this.patient() ? 'doctor' : 'patient');
    this.sizeDropdown();
    this.scopeOpen.set(true);
  }
  onPillBlur(): void { setTimeout(() => this.pillFocused.set(false), 0); }
  onPillArrow(e: Event, dir: number): void {
    const n = this.scopeRows().length;
    if (!n) return;
    e.preventDefault();
    this.scopeOpen.set(true);
    this.scopeHighlight.update(i => (i + dir + n) % n);
  }
  onPillEnter(e: Event): void {
    const rows = this.scopeRows();
    if (!rows.length) return;
    e.preventDefault();
    this.pickScopeRow(rows[Math.min(this.scopeHighlight(), rows.length - 1)]);
  }
  onPillEscape(): void { this.closeScope(); }
  focusSearchInput(): void { queueMicrotask(() => this.searchInput()?.nativeElement?.focus?.()); }

  @HostListener('document:pointerdown', ['$event'])
  onDocPointerDown(ev: Event): void {
    if (!this.scopeOpen()) return;
    const host = this.pillEl()?.nativeElement;
    if (host && ev.target instanceof Node && host.contains(ev.target)) return;
    this.closeScope();
  }

  pickScopeRow(row: ScopeRow): void {
    const k = this.bandMode();
    if (k === 'product') {
      this.scopeOpen.set(false);
      this.bandMode.set(this.patient() ? 'doctor' : 'patient');
      if (row.key === 'lab') {
        const t = labOrderTarget(this.patient()?.id ?? null);
        void this.router.navigate(t.commands as string[], t.queryParams ? { queryParams: t.queryParams } : undefined);
      }
      return;
    }
    if (k === 'patient') {
      const p = this.patientResults().find(x => x.id === row.key);
      if (p) this.pickPatient(p);
    } else {
      const d = this.doctors().find(x => x.id === row.key);
      if (d) this.pickDoctor(d);
    }
    this.scopeQuery.set('');
    this.scopeOpen.set(false);
    this.scopeHighlight.set(0);
  }

  /** The visible pill: the band's search bar (same measure as order-create). */
  private pillBox(): HTMLElement | null {
    const us = this.pillEl()?.nativeElement;
    if (!us) return null;
    const field = us.closest('.pf-hb__field') as HTMLElement | null;
    if (field && typeof getComputedStyle !== 'undefined' && getComputedStyle(field).display !== 'contents') return field;
    return (us.closest('.pf-hb__search') as HTMLElement | null) ?? us;
  }
  sizeDropdown(): void {
    if (typeof window === 'undefined') return;
    const us = this.pillEl()?.nativeElement;
    const pill = this.pillBox();
    if (!us || !pill || !us.getBoundingClientRect) return;
    const u = us.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    if (p.width > 0) this.dropBox.set({ left: p.left - u.left, top: p.bottom - u.top + 8, width: p.width });
    const vv = window.visualViewport;
    const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    this.dropMaxH.set(Math.max(160, Math.floor(viewBottom - (p.bottom + 8) - 12)));
  }

  private searchPatients(v: string): void {
    clearTimeout(this.patientTimer);
    const q = v.trim();
    if (q.length < 2) { this.patientResults.set([]); this.patientSearching.set(false); return; }
    this.patientSearching.set(true);
    this.patientTimer = setTimeout(() => {
      this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q)}&limit=10`).subscribe({
        next: list => { this.patientResults.set(list ?? []); this.patientSearching.set(false); },
        error: () => { this.patientResults.set([]); this.patientSearching.set(false); },
      });
    }, 220);
  }

  openScanner(): void { this.scanning.set(true); }
  /** ABHA / QR: the same rules as order-create's Patient dropdown. */
  onScanned(text: string): void {
    this.scanning.set(false);
    const abha = extractAbhaNumber(text || '');
    const term = abha || (text || '').trim();
    if (!term) return;
    this.selectScope('patient');
    this.scopeQuery.set(term);
    this.scopeOpen.set(true);
    this.patientSearching.set(true);
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(term)}&limit=10`).subscribe({
      next: list => {
        this.patientSearching.set(false);
        const arr = list ?? [];
        const exact = abha ? arr.find(p => (p.abhaId || '').replace(/\D/g, '') === abha) : undefined;
        const hit = exact ?? (arr.length === 1 ? arr[0] : undefined);
        if (hit) { this.pickPatient(hit); this.scopeQuery.set(''); this.scopeOpen.set(false); return; }
        this.patientResults.set(arr);
      },
      error: () => { this.patientSearching.set(false); this.patientResults.set([]); },
    });
  }

  newPatient(): void { void this.router.navigate(['/frontdesk/patients/new']); }

  // ── Patient ──────────────────────────────────────────────────────────
  pickPatient(p: Patient): void {
    this.patient.set(p);
    this.patientNudge.set(false);
    if (this.stage() !== 'issued') this.stage.set('build');
    this.bandMode.set('doctor');
  }
  clearPatient(): void { this.patient.set(null); this.lastVisitText.set(null); this.bandMode.set('patient'); }
  patientName(p: Patient): string { return patientDisplayName(p); }
  initials(name: string): string {
    return name.replace(/^(dr|mr|mrs|ms|master)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  }
  private shortDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  // ── Doctor column ────────────────────────────────────────────────────
  setDoctorTab(t: DoctorTab): void { this.doctorTab.set(t); }
  toggleFreeOnly(): void { this.freeOnly.update(v => !v); }
  /** Chevron: back to the OPD screen we came from (desk / queue / a visit),
   *  else the OPD desk. */
  readonly goBack = (): void => {
    const from = this.navBack.cameFrom?.() ?? null;
    this.navBack.backTo(from && from.startsWith('/opd') && !from.startsWith('/opd/visit/new') ? from : '/opd/desk');
  };
  /** Department chip: only FILTERS the doctor column — picking a doctor is
   *  always its own, separate, explicit click (never silent). */
  filterByDepartment(dep: DeskDepartment | null): void { this.deptFilterId.set(dep?.id ?? null); }
  pickDoctor(d: DeskDoctor): void {
    if (this.doctorId() !== d.id) { this.serviceId.set(undefined); this.clearOverride(); }
    this.doctorId.set(d.id);
    const dep = this.deptFilterId();
    if (dep && this.departments().find(x => x.id === dep)?.doctorIds.includes(d.id)) { this.mode.set('department'); this.departmentId.set(dep); }
    else { this.mode.set('doctor'); this.departmentId.set(null); }
  }
  clearDoctor(): void {
    this.doctorId.set(null); this.departmentId.set(null); this.mode.set('doctor');
    this.serviceId.set(undefined); this.clearOverride();
  }
  /** The EXPLICIT "Any doctor in <department>" tile — the least-waiting
   *  doctor of the department (the server's rule). */
  pickAnyInDepartment(dep: DeskDepartment): void {
    const docs = this.doctors().filter(d => dep.doctorIds.includes(d.id))
      .sort((a, b) => a.waiting - b.waiting || a.name.localeCompare(b.name));
    if (!docs.length) { this.toasts.info(`No doctor is set up in ${dep.name} yet.`); return; }
    if (this.doctorId() !== docs[0].id) { this.serviceId.set(undefined); this.clearOverride(); }
    this.doctorId.set(docs[0].id);
    this.mode.set('department');
    this.departmentId.set(dep.id);
    this.deptFilterId.set(dep.id);
  }
  dayName(k: string): string { return DAY_NAMES[k] ?? k; }
  waitText(d: { waiting: number; estWaitMinutes?: number }): string { return waitLabel(d.waiting, d.estWaitMinutes ?? d.waiting * 10); }
  waitTone(d: { waiting: number; estWaitMinutes?: number }): string { return waitTone(d.waiting, d.estWaitMinutes ?? d.waiting * 10); }
  /** Dept "Any doctor" tile: the least-waiting doctor's wait. */
  anyWait(g: DoctorGroup): { waiting: number; estWaitMinutes: number } {
    const best = [...g.doctors].sort((a, b) => a.waiting - b.waiting)[0];
    return best ? { waiting: best.waiting, estWaitMinutes: best.estWaitMinutes } : { waiting: 0, estWaitMinutes: 0 };
  }
  deptDoctorsText(dep: DeskDepartment): string {
    const n = dep.doctorIds.length;
    return n === 1 ? '1 doctor' : `${n} doctors`;
  }

  // ── Purpose column + the fee ─────────────────────────────────────────
  pickService(s: ServiceQuote): void {
    if (this.serviceId() !== s.serviceId) this.clearOverride();
    this.serviceId.set(s.serviceId);
  }
  serviceMeta(s: ServiceQuote): string {
    const doc = this.doctor()?.name ?? 'the doctor';
    if (s.isFollowUp) return `Same doctor within ${s.followUpWithinDays} days · follow-up rule`;
    const cat = s.category === 'procedure' ? 'Procedure' : 'Consultation';
    return s.priceSource === 'common' ? `${cat} · common price` : `${cat} · ${doc}'s fee`;
  }
  lineName(): string {
    const s = this.service(); if (!s) return '';
    return feeLineLabel(s.name, s.isFollowUp, s.quoted, this.override());
  }
  lineMeta(): string {
    const s = this.service(); if (!s) return '';
    const d = this.doctor()?.name ?? '';
    if (this.overridden()) return `${d} · set at the desk · rule ₹${s.quoted}`;
    return `${d} · ${s.isFollowUp ? 'follow-up fee' : s.priceSource === 'common' ? 'common price' : 'per-doctor fee'}`;
  }
  /** Tap the fee in the bill line: edit it in place (the desk override). */
  openOverride(): void {
    this.overrideOpen.set(true);
    if (!this.overrideRaw()) this.overrideRaw.set(String(this.service()?.quoted ?? ''));
    queueMicrotask(() => { const el = this.feeInput()?.nativeElement; el?.focus?.(); el?.select?.(); });
  }
  /** Done editing: an amount equal to the rule is no override at all. */
  closeOverride(): void {
    if (this.overrideInvalid()) return;
    if (!this.overridden()) { this.clearOverride(); return; }
    this.overrideOpen.set(false);
  }
  clearOverride(): void { this.overrideOpen.set(false); this.overrideRaw.set(''); this.overrideReason.set(''); }
  onOverride(v: string): void { this.overrideRaw.set(v.replace(/[^\d.]/g, '')); }
  onFeeKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') { ev.preventDefault(); this.closeOverride(); }
    if (ev.key === 'Escape') { ev.preventDefault(); this.clearOverride(); }
  }


  // ── Checkout ─────────────────────────────────────────────────────────
  continueToPayment(): void {
    if (!this.patient()) {
      this.patientNudge.set(true);
      this.toasts.info(this.missing());
      if (!this.isLg()) this.cartOpen.set(false);
      this.selectScope('patient');
      return;
    }
    if (!this.ready()) { this.toasts.info(this.missing()); return; }
    if (this.overrideAboveRule()) { this.toasts.error('Only a billing admin can charge more than the fee rule.'); return; }
    if (!this.payFirst() || this.preview().total <= 0) { void this.book([]); return; }
    this.overrideOpen.set(false);
    this.stage.set('pay');
  }
  backToBuild(): void { this.stage.set('build'); }
  toggleCart(): void { this.cartOpen.update(v => !v); }
  closeCart(): void { this.cartOpen.set(false); }

  onPaid(r: InlinePaymentResult): void {
    const parts = paymentParts(r, this.preview().total);
    if (parts === null) { this.toasts.info('Bill to vendor and Pay later are not taken at the OPD desk.'); return; }
    void this.book(parts);
  }

  private async book(payments: { mode: 'cash' | 'upi' | 'card' | 'other'; amount: number; reference?: string | null }[]): Promise<void> {
    const p = this.patient(); const d = this.doctor(); const s = this.service();
    if (!p || !d || !s || this.submitting()) return;
    this.submitting.set(true);
    try {
      // Vitals are no longer taken in the bill: the Vitals step follows the
      // token, like Collect follows a lab payment.
      const v = await firstValueFrom(this.desk.checkout({
        patientId: p.id, doctorUserId: d.id, departmentId: this.mode() === 'department' ? this.departmentId() : null,
        serviceId: s.serviceId, purpose: this.purpose().trim() || null,
        feeOverride: this.override(), feeOverrideReason: this.overrideReason().trim() || null,
        vitals: null, payments,
      }));
      writeDraft(this.draftStorage, this.key(), null);
      this.issued.set(v);
      this.stage.set('issued');
      this.toasts.success(`Token ${v.tokenLabel} issued for ${v.patient.name}`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.submitting.set(false);
    }
  }

  /** After the token: the Vitals step for THIS visit (Collect's twin). */
  recordVitals(): void {
    const v = this.issued(); if (!v) return;
    void this.router.navigate(['/opd/vitals', v.id]);
  }
  openVisit(): void {
    const v = this.issued(); if (!v) return;
    void this.router.navigate(['/opd/visit', v.id], { queryParams: { issued: 1 } });
  }
  async printToken(): Promise<void> {
    const v = this.issued(); if (!v || this.printing()) return;
    this.printing.set(true);
    try { await printTokenSlip(v, this.auth.user()?.tenantName ?? ''); }
    catch { this.toasts.error('The token slip could not be printed.'); }
    finally { this.printing.set(false); }
  }
  /** "New visit" after a token: a clean screen for the next patient. */
  startNewVisit(): void {
    this.issued.set(null);
    this.discardDraft();
  }

  discardDraft(): void {
    writeDraft(this.draftStorage, this.key(), null);
    this.patient.set(null); this.doctorId.set(null); this.departmentId.set(null); this.serviceId.set(undefined);
    this.purpose.set(''); this.clearOverride();
    this.deptFilterId.set(null); this.freeOnly.set(false); this.mode.set('doctor');
    this.stage.set('build'); this.cartOpen.set(false); this.bandMode.set('patient');
  }

  /** Footer "Save as draft" (order-create parity): the draft already
   *  autosaves on every change — this confirms it and returns to the desk. */
  saveDraftAndExit(): void {
    if (!this.patient()) { this.patientNudge.set(true); this.toasts.warning('Pick a patient first'); return; }
    this.toasts.success('Saved as draft');
    void this.router.navigateByUrl('/opd/desk');
  }
}

/** The purpose pre-picked for a doctor: the follow-up when its window
 *  applies (the server only quotes one then), else the consultation, else the
 *  first service — so the common case is pick a doctor → Continue to payment. */
export function defaultPurpose(services: readonly ServiceQuote[]): ServiceQuote | undefined {
  return services.find(s => s.isFollowUp) ?? services.find(s => s.category === 'consultation') ?? services[0];
}

/** In today: sits today (older servers omit the flag → counted in). */
function inToday(d: DeskDoctor): boolean { return d.sitsToday !== false; }
/** Free now: in today with nobody waiting. */
function isFreeNow(d: DeskDoctor): boolean { return d.sitsToday !== false && d.waiting <= 0; }

/** Pure: an open (not cancelled / no-show / completed) visit today with this doctor. */
export function sameDoctorOpenVisit(rows: readonly OpdVisitRow[], doctorId: string | null): OpdVisitRow | null {
  if (!doctorId) return null;
  return rows.find(r => r.doctorUserId === doctorId && !['cancelled', 'no_show', 'completed'].includes(r.status)) ?? null;
}

const DAY_NAMES: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
