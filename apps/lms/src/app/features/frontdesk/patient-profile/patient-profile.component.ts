import { DatePipe, Location, CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ChatService } from '../../../core/services/chat.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';
import type { RouteAccessCtx } from '../../../core/auth/route-access';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { Patient, patientDisplayName, formatPatientInfo } from '../../../shared/models/patient.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { PatientIdCardComponent } from './patient-id-card.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ZoomSourceDirective, ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { printTubeLabels } from '../../../shared/utils/print-label';
import { LabelPrintService } from '../../../core/printer/label-print.service';
import {
  ageSexLong, orderStatusLabel, orderTone, patientFlags, patientMetaLine, testStatusLabel, testTone,
} from './patient-profile.nd';
import {
  CumRow, CumulativePayload, CumulativeResult, PatientAppointment, ProfileOrder, QuickAction, RESULTS_PERMS, STAGES,
  TimelineEvent, activeOrders, buildCumulative, buildTimeline, lastVisit, needsAttention, quickActions, shortDate,
} from './patient-profile.clinical';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { LabTrendsComponent } from './lab-trends.component';
import { PatientTimelineService } from './patient-timeline.service';
import { LabOrdersComponent } from './lab-orders.component';
import { CumulativeResultsComponent } from './cumulative-results.component';
import { AbhaWizardComponent } from '../../../shared/components/abha-wizard/abha-wizard.component';
import { LabelCardComponent } from '../post-payment/label-card.component';
import { formatAge } from '../../../shared/utils/patient-age';

/** matchMedia as a live boolean (same helper shape as the report view). */
function mq(query: string, ref: DestroyRef, on: (m: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const m = window.matchMedia(query);
  const fn = (e: MediaQueryListEvent) => on(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return !!m.matches;
}

interface DirectoryUser { id: string; displayName: string; email: string; isActive: boolean; }

interface ProfilePayload {
  patient: Patient;
  history: ProfileOrder[];
  appointments?: PatientAppointment[];
}

/** POST /api/patients/{sourceId}/merge-into/{targetId} response. */
interface MergeResult {
  merged: { orders: number; bills: number; appointments: number; messages: number; documents: number; reports: number; };
  sourceDeactivated: boolean;
  targetId: string;
}

/** What the main column is zoomed into (list → detail). */
export type PpDetail =
  | { kind: 'order'; id: string; report: boolean }
  | { kind: 'trend'; key: string; testId: string; parameter: string; title: string };

/**
 * Patient profile — CLINICAL-FIRST (docs/ND-PATTERN.md §22). A doctor or tech
 * reads the patient's lab story in five seconds, then acts:
 *  band (context bar + New order) → SNAPSHOT (needs attention · in progress
 *  now · last visit) → CUMULATIVE RESULTS (analyte × visit grid) ‖ the
 *  PATIENT companion (quick actions, timeline feed, details).
 * Data: GET /api/patients/{id} (patient, orders, appointments) and
 * GET /api/patients/{id}/cumulative-results (one query), fetched in parallel;
 * the trend chart loads /lab-trends only when opened.
 */
@Component({
  selector: 'pf-patient-profile',
  standalone: true,
  imports: [DatePipe, FormsModule, CurrencyInrPipe, CommonModule, NgTemplateOutlet, PatientIdCardComponent, BarcodeDisplayComponent,
    LabTrendsComponent, LabOrdersComponent, CumulativeResultsComponent, AbhaWizardComponent, HeroBandComponent,
    ZoomTargetDirective, ZoomSourceDirective, LabelCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './patient-profile.component.html',
  styleUrls: ['./patient-profile.component.scss', './patient-profile.clinical.scss']
})
export class PatientProfileComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly entitlements = inject(TenantEntitlementsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orderEntry = inject(OrderEntryService);
  private readonly locationSvc = inject(Location);
  private readonly chat = inject(ChatService);
  private readonly dialog = inject(DialogService);
  protected readonly toasts = inject(ToastService);
  private readonly labelPrint = inject(LabelPrintService);
  private readonly auth = inject(AuthService);
  private readonly workflow = inject(ProcessWorkflowService, { optional: true });
  protected readonly navBack = inject(NavBackService);
  private readonly destroyRef = inject(DestroyRef);

  /** Web (fine pointer + hover) = text buttons; touch = 44px icons. */
  protected readonly web = webPointerSignal();
  /** ≤900px: one stacked column (snapshot → results → timeline → details). */
  readonly narrow = signal(mq('(max-width: 900px)', this.destroyRef, m => this.narrow?.set(m)));
  /** ≤640px: cumulative results as cards; New order in the bottom bar. */
  readonly phone = signal(mq('(max-width: 640px)', this.destroyRef, m => this.phone?.set(m)));
  /** List → detail zoom: the tapped Front desk card / drawer button morphs
   *  into the main column (keys = the patient id). */
  protected readonly zoom = inject(ZoomTransitionService);
  private readonly routeId = inject(ActivatedRoute).snapshot?.paramMap?.get('id') ?? null;
  readonly zoomKeys = computed(() => [this.routeId, this._patient()?.id]);
  /** Skeleton until the patient is here — and while the ROUTE zoom morphs. */
  readonly showSkeleton = computed(() => (!this._patient() && !this.loadFailed()) || (this.arrivalHold() && this.zoom.holding()));
  private readonly arrivalHold = signal(true);
  private readonly _releaseHold = effect(() => { if (!this.zoom.holding()) untracked(() => this.arrivalHold.set(false)); });
  readonly loadFailed = signal(false);

  // ── Data ────────────────────────────────────────────────────────────────
  private readonly _patient = signal<Patient | null>(null);
  private readonly _history = signal<ProfileOrder[]>([]);
  private readonly _appointments = signal<PatientAppointment[]>([]);
  private readonly _loading = signal(false);
  readonly patient = this._patient.asReadonly();
  readonly history = this._history.asReadonly();
  readonly appointments = this._appointments.asReadonly();
  readonly loading = this._loading.asReadonly();

  /** Cumulative results (GET …/cumulative-results), fetched alongside. */
  readonly canResults = computed(() => this.auth.hasAnyPermission(RESULTS_PERMS));
  readonly cumResults = signal<CumulativeResult[] | null>(null);
  readonly cumLoading = signal(false);
  readonly cumFailed = signal(false);
  readonly cumTruncated = signal(false);
  readonly grid = computed(() => buildCumulative(this.cumResults() ?? []));
  readonly attention = computed(() => needsAttention(this.grid()));
  /** The snapshot lists this many before "Show all N". */
  readonly attentionMax = computed(() => (this.narrow() ? 3 : 4));
  readonly active = computed(() => activeOrders(this._history()));
  readonly lastVisit = computed(() => lastVisit(this._history()));
  readonly timeline = computed(() => buildTimeline(this._history(), this._appointments()));
  /** "Show all N" in the snapshot → the grid's Abnormal only. */
  readonly abnormalSeed = signal(0);
  protected readonly STAGES = STAGES;
  protected readonly shortDate = shortDate;

  // ── Quick actions (permission-gated via route-access) ──────────────────
  private readonly routeCtx: RouteAccessCtx = {
    hasAny: p => this.auth.hasAnyPermission(p),
    isEnabled: a => this.workflow?.isEnabled(a) ?? true,
    moduleEnabled: m => this.entitlements.moduleEnabled(m),
  };
  readonly quick = computed<QuickAction[]>(() => {
    this.workflow?.active?.();   // re-evaluate once the workflow loads
    return quickActions(this._history(), this.routeCtx);
  });
  readonly canNewOrder = computed(() => this.quick().some(q => q.key === 'new'));
  /** The side card's tech actions (New order is THE band primary). */
  readonly sideQuick = computed(() => this.quick().filter(q => q.key !== 'new'));

  // ── Main column: list → detail ──────────────────────────────────────────
  readonly detail = signal<PpDetail | null>(null);
  openOrder(id: string, report = false): void {
    this.moreOpen.set(false);
    this.zoom.runLocal('in', () => this.detail.set({ kind: 'order', id, report }));
  }
  openTrend(r: CumRow): void {
    this.zoom.runLocal('in', () => this.detail.set({ kind: 'trend', key: r.key, testId: r.testId, parameter: r.name, title: r.title }));
  }
  /** Needs attention → the analyte's chart (or its visit when it has one value). */
  openAttention(key: string, orderId: string): void {
    const row = this.grid().groups.flatMap(g => g.rows).find(r => r.key === key);
    if (row && row.points.length >= 2) this.openTrend(row); else this.openOrder(orderId);
  }
  closeDetail(): void {
    if (!this.detail()) return;
    this.zoom.runLocal('out', () => this.detail.set(null));
  }
  readonly detailKeys = computed(() => {
    const d = this.detail();
    return d ? [d.kind === 'order' ? d.id : d.key] : [];
  });

  // ── Side card: timeline | details ───────────────────────────────────────
  readonly sideView = signal<'timeline' | 'details'>('timeline');
  onSideSegKey(ev: KeyboardEvent): void {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const next = ev.key === 'Home' ? 'timeline' : ev.key === 'End' ? 'details' : this.sideView() === 'timeline' ? 'details' : 'timeline';
    this.sideView.set(next);
    (ev.currentTarget as HTMLElement | null)?.querySelectorAll<HTMLElement>('[role=radio]')[next === 'timeline' ? 0 : 1]?.focus();
  }
  /** Timeline rows: orders / reports zoom into the order; appointments expand. */
  readonly expanded = signal<Record<string, boolean>>({});
  onEvent(e: TimelineEvent): void {
    if (e.orderId) { this.openOrder(e.orderId, e.kind === 'report'); return; }
    this.expanded.update(m => ({ ...m, [e.id]: !m[e.id] }));
  }
  onEventKey(ev: KeyboardEvent, e: TimelineEvent): void {
    if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    this.onEvent(e);
  }

  /** The PATIENT companion collapsed to a strip on the RIGHT edge (remembered per user). */
  readonly sideCollapsed = signal(this.readCollapsed());
  toggleSide(): void {
    const next = !this.sideCollapsed();
    this.sideCollapsed.set(next);
    try { localStorage.setItem(this.collapseKey(), next ? '1' : '0'); } catch { /* private mode */ }
  }
  private collapseKey(): string {
    const u = this.auth.user();
    return 'pf:pp:side-collapsed:' + (u?.id || u?.authId || 'anon');
  }
  private readCollapsed(): boolean {
    try { return localStorage.getItem(this.collapseKey()) === '1'; } catch { return false; }
  }
  /** The ABHA health card (the official card look) in a modal. */
  readonly abhaCardOpen = signal(false);

  /** Band context line + flags. */
  readonly metaLine = computed(() => patientMetaLine(this._patient()));
  readonly flags = computed(() => patientFlags(this._patient(), this._history()));
  readonly ageSex = computed(() => ageSexLong(this._patient()));
  readonly unpaidOrders = computed(() => this._history().filter(o => o.billStatus === 'unpaid' && o.status !== 'cancelled').length);
  /** Outstanding balance across the patient's bills. */
  readonly outstanding = computed(() => this._history()
    .filter(o => o.status !== 'cancelled')
    .reduce((s, o) => s + Math.max(0, Number(o.bill?.balance) || 0), 0));
  protected readonly orderStatusLabel = orderStatusLabel;
  protected readonly orderTone = orderTone;
  protected readonly testStatusLabel = testStatusLabel;
  protected readonly testTone = testTone;
  readonly closeQr = (): void => this.qrOpen.set(false);
  readonly closeIdCard = (): void => this.showIdCard.set(false);
  readonly closeAbhaCard = (): void => this.abhaCardOpen.set(false);
  kycAddress(k: { address?: string; district?: string; state?: string }): string {
    return [k.address, k.district, k.state].filter(Boolean).join(', ');
  }

  /** Back = where you came from (history) when that was an in-app list;
   *  otherwise up to the front desk. An open detail closes first. */
  goBack = (): void => {
    if (this.detail()) { this.closeDetail(); return; }
    const last = this.router.lastSuccessfulNavigation as unknown;
    const nav = (typeof last === 'function' ? (last as () => unknown)() : last) as
      { previousNavigation?: { finalUrl?: unknown } | null } | null | undefined;
    const prev = nav?.previousNavigation?.finalUrl ? String(nav.previousNavigation.finalUrl) : '';
    const path = prev.split(/[?#]/)[0];
    const isForm = /^\/frontdesk\/(patients\/new|order)(\/|$)/.test(path);
    if (prev && !isForm && path !== this.router.url.split(/[?#]/)[0]) { this.locationSvc.back(); return; }
    this.navBack.backTo('/frontdesk');
  };

  /** Esc closes the top-most layer. */
  onEsc(): void {
    if (this.moreOpen()) { this.closeMore(); return; }
    if (this.abhaCardOpen()) { this.abhaCardOpen.set(false); return; }
    if (this.qrOpen()) { this.qrOpen.set(false); return; }
    if (this.showIdCard()) { this.showIdCard.set(false); return; }
    if (this.chatPickerOpen()) { this.closeChatPicker(); return; }
    if (this.mergeOpen()) { this.closeMerge(); return; }
    if (this.detail()) this.closeDetail();
  }

  readonly showIdCard = signal(false);
  /** Full-screen Patient Timeline overlay (rendered at shell root). */
  readonly patientTimeline = inject(PatientTimelineService);
  /** Open the full timeline — real lab history only (the LMS holds no OPD /
   *  IPD records for the patient; nothing is made up). */
  openFullTimeline(): void {
    const p = this._patient();
    if (p) this.patientTimeline.open(p.id, [], [], []);
  }
  /** ABHA (ABDM) create/verify wizard. */
  readonly abhaWizardOpen = signal(false);
  onAbhaDone(updated: Patient) {
    if (updated) this._patient.set({ ...(this._patient() ?? {} as Patient), ...updated });
    this.abhaWizardOpen.set(false);
    this.toasts.success('ABHA linked & verified');
  }
  readonly moreOpen = signal(false);
  readonly qrOpen = signal(false);
  toggleMore() { this.moreOpen.update(v => !v); }
  closeMore() { this.moreOpen.set(false); }
  readonly qrValue = computed(() => {
    const p = this._patient();
    if (!p) return '';
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}/p/${p.id}`;
  });
  readonly displayName = computed(() => patientDisplayName(this._patient()));
  protected readonly formatPatient = formatPatientInfo;

  // ── ABHA health card (real ABDM card look) ──────────────────────────────
  readonly abhaFormatted = computed(() => {
    const id = (this._patient()?.abhaId || '').replace(/\D/g, '');
    return id.length === 14
      ? `${id.slice(0, 2)}-${id.slice(2, 6)}-${id.slice(6, 10)}-${id.slice(10, 14)}`
      : (this._patient()?.abhaId || '—');
  });
  readonly abhaQrValue = computed(() => {
    const p = this._patient();
    if (!p?.abhaId) return '';
    return JSON.stringify({
      hidn: (p.abhaId || '').replace(/\D/g, ''),
      hid: p.abhaAddress || this.kyc()?.abhaAddress || '',
      name: patientDisplayName(p),
      gender: p.sex || '',
      dob: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : '',
      mobile: p.phone || ''
    });
  });
  readonly initials = computed(() => {
    const parts = this.displayName().trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  });
  protected readonly chakraSpokes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  readonly kyc = computed(() => {
    const raw = this._patient()?.attributes;
    if (!raw) return null;
    let a: Record<string, unknown>;
    try { a = JSON.parse(raw); } catch { return null; }
    const pick = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim()) ? (a[k] as string).trim() : undefined;
    const d = { address: pick('address'), pincode: pick('pincode'), district: pick('district'), state: pick('state'), abhaAddress: pick('abhaAddress') };
    return (d.address || d.pincode || d.district || d.state || d.abhaAddress) ? d : null;
  });
  readonly cardAbhaAddress = computed(() => this._patient()?.abhaAddress || this.kyc()?.abhaAddress || '');
  readonly abhaPhoto = computed(() => {
    const raw = this._patient()?.attributes;
    if (!raw) return null;
    let a: Record<string, unknown>;
    try { a = JSON.parse(raw); } catch { return null; }
    const p = a['abhaPhoto'] ?? a['photo'];
    if (typeof p !== 'string' || !p.trim()) return null;
    return p.startsWith('data:') ? p : `data:image/jpeg;base64,${p}`;
  });

  readonly copied = signal(false);
  copyToClipboard(text: string | undefined) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
      this.toasts.success('Patient ID copied to clipboard');
    }).catch(() => this.toasts.error('Failed to copy to clipboard'));
  }

  /** "37y" (infants "8m" / "12d") — the shared patient-age helper: a DOB
   *  always wins so the age stays live; else the stored age. */
  ageLabel(p: Patient): string {
    return formatAge(p, 'y', '—');
  }

  // ── Edit patient ────────────────────────────────────────────────────────
  readonly canEdit = computed(() => this.auth.hasAnyPermission(['edit_patient', 'register_patient']));
  openEdit(p: Patient) {
    this.router.navigate(['/frontdesk/patients/new'], { queryParams: { patientId: p.id } });
  }

  // ── Real activity stats ────────────────────────────────────────────────
  readonly realVisits = computed(() => this.history().length);
  readonly realTotalSpent = computed(() => this.history().reduce((sum, o) => sum + (o.totalAmount ?? o.bill?.totalPayable ?? 0), 0));
  readonly realTestsDone = computed(() => this.history().reduce((sum, o) => sum + this.orderTests(o).length, 0));
  readonly realLastVisit = computed(() => {
    const times = this.history().map(o => new Date(o.createdAt).getTime()).filter(n => !isNaN(n));
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  });

  // Send-to-chat colleague picker state.
  protected readonly chatPickerOpen = signal(false);
  protected readonly chatPickerSearch = signal('');
  protected readonly chatPickerUsers = signal<DirectoryUser[]>([]);
  protected readonly chatPickerSending = signal(false);
  protected readonly chatPickerFiltered = computed(() => {
    const term = this.chatPickerSearch().toLowerCase().trim();
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    const all = this.chatPickerUsers().filter(u => u.id !== me && u.isActive);
    return term ? all.filter(u => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)) : all;
  });

  ngOnInit() {
    this.route.paramMap.subscribe(map => {
      const id = map.get('id');
      if (id) this.load(id);
    });
  }

  orderTests(o: Order): OrderTest[] {
    const tests: OrderTest[] = [];
    for (const s of o.samples ?? []) for (const t of s.tests ?? []) tests.push(t);
    return tests;
  }

  back() { this.navBack.backTo('/frontdesk'); }

  startOrder(p: Patient) {
    // Routes lab/OPD by module scope; 'lab' (today's default) → order-create.
    void this.orderEntry.startNewOrder(p.id);
  }

  /** Re-order the same tests from a prior order (order-create preselects them). */
  repeatOrder(o: Pick<Order, 'id'> & { patientId?: string }) {
    const patientId = o.patientId || this.patient()?.id;
    if (!patientId) return;
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId, fromOrderId: o.id } });
  }

  bookAppointment(p: Patient) {
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: p.id } });
  }

  /** Run a quick action. */
  runQuick(q: QuickAction): void {
    const p = this._patient();
    if (!p) return;
    switch (q.key) {
      case 'new': this.startOrder(p); break;
      case 'repeat': if (q.orderId) this.repeatOrder({ id: q.orderId, patientId: p.id }); break;
      case 'labels': if (q.orderId) this.reprintLabels(q.orderId); break;
      case 'report': if (q.orderId) this.openOrder(q.orderId, true); break;
    }
  }

  // ── Label reprint (no bill, no navigation; same cards as post-payment) ──
  readonly reprintOrder = signal<Order | null>(null);
  readonly reprintLoading = signal(false);
  reprintLabels(orderId: string): void {
    if (this.reprintLoading()) return;
    this.reprintLoading.set(true);
    this.api.get<Order>(`/api/orders/${orderId}`).subscribe({
      next: full => {
        this.reprintLoading.set(false);
        if (!full?.samples?.length) { this.toasts.warning('No samples on this order to print'); return; }
        // Labels go ONLY to the station's label printer (LabelPrintService).
        // The off-screen sheet + label-sized system dialog is used only when a
        // web user explicitly picks it in the no-printer dialog.
        void this.labelPrint.printTubeLabels({
          samples: full.samples,
          patient: full.patient ?? null,
          systemPrint: () => {
            this.reprintOrder.set(full);
            // A beat for the cards to paint their codes, then print; keep the
            // sheet mounted until the dialog has consumed it.
            setTimeout(() => {
              printTubeLabels();
              setTimeout(() => this.reprintOrder.set(null), 2000);
            }, 350);
          },
        });
      },
      error: () => { this.reprintLoading.set(false); this.toasts.error('Could not load the order for label reprint'); },
    });
  }

  // ── Send-to-chat ──────────────────────────────────────────────────
  async openChatPicker(): Promise<void> {
    this.chatPickerOpen.set(true);
    this.chatPickerSearch.set('');
    if (this.chatPickerUsers().length === 0) {
      try {
        const users = await firstValueFrom(this.api.get<DirectoryUser[]>('/api/directory/users'));
        this.chatPickerUsers.set(users ?? []);
      } catch {
        this.toasts.error('Could not load directory.');
      }
    }
  }
  closeChatPicker(): void {
    this.chatPickerOpen.set(false);
    this.chatPickerSending.set(false);
  }
  async sendPatientToColleague(u: DirectoryUser): Promise<void> {
    const p = this.patient();
    if (!p) return;
    this.chatPickerSending.set(true);
    try {
      const label = `${this.displayName()}${p.mrn ? ' · ' + p.mrn : ''}`;
      await this.chat.sharePatientWithUser(u.id, p.id, label);
      this.toasts.info(`Sent ${this.displayName()} to ${u.displayName}`);
      this.closeChatPicker();
      this.router.navigate(['/messages']);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.chatPickerSending.set(false);
    }
  }

  // ── Merge duplicate into this patient ─────────────────────────────
  protected readonly mergeOpen = signal(false);
  protected readonly mergeSearch = signal('');
  protected readonly mergeResults = signal<Patient[]>([]);
  protected readonly merging = signal(false);

  displayOf(p: Patient): string { return patientDisplayName(p); }
  openMerge(): void {
    this.mergeOpen.set(true);
    this.mergeSearch.set('');
    this.mergeResults.set([]);
  }
  closeMerge(): void {
    if (this.merging()) return;
    this.mergeOpen.set(false);
  }
  onMergeSearch(q: string): void {
    this.mergeSearch.set(q);
    const term = q.trim();
    if (!term) { this.mergeResults.set([]); return; }
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(term)}`).subscribe({
      next: list => {
        const targetId = this.patient()?.id;
        this.mergeResults.set((list ?? []).filter(p => p.id !== targetId));
      },
      error: () => this.mergeResults.set([])
    });
  }
  async mergeFrom(source: Patient): Promise<void> {
    const target = this.patient();
    if (!target || this.merging()) return;
    const ok = await this.dialog.confirm({
      title: `Merge ${patientDisplayName(source)} into ${this.displayName()}?`,
      message: 'All orders, bills and appointments of the duplicate move into this record, '
        + 'and the duplicate is deactivated. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Merge records',
    });
    if (!ok) return;
    this.merging.set(true);
    try {
      const res = await firstValueFrom(this.api.post<MergeResult>(`/api/patients/${source.id}/merge-into/${target.id}`, {}));
      const m = res?.merged;
      this.toasts.success(m
        ? `Merged ${m.orders} order${m.orders === 1 ? '' : 's'}, `
          + `${m.bills} bill${m.bills === 1 ? '' : 's'}, `
          + `${m.appointments} appointment${m.appointments === 1 ? '' : 's'} into this record`
        : 'Patients merged');
      this.mergeOpen.set(false);
      this.load(target.id);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.merging.set(false);
    }
  }

  /** Profile + cumulative results in PARALLEL (neither waits on the other). */
  private load(id: string) {
    this.loadFailed.set(false);
    this._loading.set(true);
    this.detail.set(null);
    this.api.get<ProfilePayload>(`/api/patients/${id}`).subscribe({
      next: res => {
        this._patient.set(res.patient);
        if (!res.patient) this.loadFailed.set(true);
        this._history.set(res.history ?? []);
        this._appointments.set(res.appointments ?? []);
        this._loading.set(false);
      },
      error: () => { this.loadFailed.set(true); this._loading.set(false); },
    });
    this.loadResults(id);
  }

  loadResults(id = this._patient()?.id ?? this.routeId ?? ''): void {
    if (!id || !this.canResults()) { this.cumResults.set(null); return; }
    this.cumLoading.set(true);
    this.cumFailed.set(false);
    this.api.get<CumulativePayload>(`/api/patients/${id}/cumulative-results`).subscribe({
      next: r => {
        this.cumResults.set(r?.results ?? []);
        this.cumTruncated.set(!!r?.truncated);
        this.cumLoading.set(false);
      },
      error: () => { this.cumResults.set(null); this.cumFailed.set(true); this.cumLoading.set(false); },
    });
  }
}
