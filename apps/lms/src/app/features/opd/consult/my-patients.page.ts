import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, OnDestroy, OnInit, type WritableSignal, computed, inject, signal, viewChild,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ModuleScopeService } from '../../../core/services/module-scope.service';
import { labOrderTarget } from '../../../shared/opd/order-entry';
import { ApiError } from '../../../shared/models/api-response.model';
import { bmi, bmiBand } from '../vitals/vitals-rules';
import type { ConsultWorkspace } from './consult.api';
import { ADMIN_PERMS, FRONTDESK_PERMS } from '../../../core/auth/route-access';
import { OpdAdminApi, OpdDoctorLite } from '../admin/opd-admin.api';
import type { PfSelectOption } from '../../../shared/primitives/select.component';
import { ConsultApi, ConsultQueueRow } from './consult.api';
import { JourneyDockComponent } from '../shared/journey-dock.component';
import { JourneyDockService } from '../shared/journey-dock.service';

export type QueueTab = 'waiting' | 'in_consult' | 'completed';

/** Shows the doctor filter to anyone who isn't PURELY a doctor: front desk /
 *  admin staff always get it (today's "all doctors mixed" view needs a way to
 *  narrow it); a plain doctor keeps the unchanged own-queue-only view; a
 *  "staff doctor" (a doctor who ALSO holds front-desk/admin permissions —
 *  e.g. an admin who is also a doctor) gets it too, so they may switch to a
 *  colleague's queue. Pure — no Angular DI. */
export function showsDoctorFilter(isDoctor: boolean, hasAnyPermission: (perms: string[]) => boolean): boolean {
  return !isDoctor || hasAnyPermission([...FRONTDESK_PERMS, ...ADMIN_PERMS]);
}

/** Per-row "Dr X" only makes sense while the rows are a genuine MIX of
 *  doctors: the default ('' = no doctorId filter) for a non-doctor viewer.
 *  A doctor's own default queue is single-doctor by construction, and an
 *  explicit single-doctor pick already reads as one doctor via the filter
 *  chip, so neither needs the per-row label. Pure. */
export function showsDoctorName(isDoctor: boolean, selectedDoctorId: string): boolean {
  return !isDoctor && !selectedDoctorId;
}

/** Turn the doctor list (+ the caller's own-queue default) into pf-select
 *  options. Pure — the default option's label is the only thing that differs
 *  by caller (a doctor's blank filter is "My queue"; staff's is "All
 *  doctors"), matching what an omitted `doctorId` means server-side for each. */
export function doctorFilterOptions(doctors: readonly OpdDoctorLite[], isDoctor: boolean): PfSelectOption<string>[] {
  return [
    { value: '', label: isDoctor ? 'My queue' : 'All doctors' },
    ...doctors.map(d => ({ value: d.id, label: d.name })),
  ];
}

/** Fallback doctor list when `/api/doctors` isn't readable for this caller
 *  (or the call fails): derive the distinct doctors from the queue rows
 *  themselves (doctorUserId/doctorName), so the filter still works once at
 *  least one row has loaded. */
export function doctorsFromRows(rows: readonly ConsultQueueRow[]): OpdDoctorLite[] {
  const seen = new Map<string, OpdDoctorLite>();
  for (const r of rows) {
    if (!r.doctorUserId || seen.has(r.doctorUserId)) continue;
    seen.set(r.doctorUserId, { id: r.doctorUserId, name: r.doctorName || r.doctorUserId, specializations: [], fee: 0 });
  }
  return [...seen.values()];
}

/** Which tab a visit status belongs to (booked / at vitals count as waiting). */
export function tabOf(status: string): QueueTab | null {
  if (status === 'in_consult') return 'in_consult';
  if (status === 'completed') return 'completed';
  if (status === 'waiting' || status === 'booked' || status === 'vitals') return 'waiting';
  return null;
}

/** "Call next": the lowest token already through the desk (waiting), else any open one. */
export function nextToCall(rows: readonly ConsultQueueRow[]): ConsultQueueRow | null {
  const open = rows.filter(r => r.status === 'waiting').sort((a, b) => a.token - b.token);
  return open[0] ?? rows.filter(r => r.status === 'booked' || r.status === 'vitals').sort((a, b) => a.token - b.token)[0] ?? null;
}

/** Optional chips on the patient list. */
export type QueueChip = 'followup' | 'vitals';

/** Search a row by name, MRN or token ("A3" / "3"). Pure. */
export function rowMatches(r: ConsultQueueRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return r.patientName.toLowerCase().includes(t) || (r.mrn ?? '').toLowerCase().includes(t)
    || r.tokenLabel.toLowerCase() === t || String(r.token) === t.replace(/^[a-z]+/, '');
}

/** Minutes since an ISO time (0 when missing / in the future). Pure. */
export function minutesSince(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0;
}

/** The tile's time line + dot tone, in plain words. Pure. */
export function waitInfo(r: ConsultQueueRow, now: number): { text: string; tone: 'free' | 'ok' | 'long' | 'live' | 'done' } {
  if (r.status === 'completed') return { text: 'Done', tone: 'done' };
  if (r.status === 'in_consult') {
    const m = minutesSince(r.consultStartedAt, now);
    return { text: m ? `With you · ${m} min` : 'With you now', tone: 'live' };
  }
  const m = minutesSince(r.checkedInAt, now);
  const where = r.status === 'vitals' ? 'At vitals' : r.status === 'booked' ? 'Booked' : 'Waiting';
  if (!r.checkedInAt) return { text: where, tone: 'free' };
  return { text: `${where} · ${m < 1 ? 'just now' : m + ' min'}`, tone: m > 45 ? 'long' : m > 15 ? 'ok' : 'free' };
}

/** One vitals reading for the at-a-glance grid. */
export interface GlanceVital { label: string; value: string; }
/** Today's vitals as label/value pairs (only the ones taken) + BMI. Pure. */
export function glanceVitals(v: ConsultWorkspace['vitals']): GlanceVital[] {
  if (!v) return [];
  const out: GlanceVital[] = [];
  if (v.bpSys && v.bpDia) out.push({ label: 'BP', value: `${v.bpSys}/${v.bpDia}` });
  if (v.pulse) out.push({ label: 'Pulse', value: `${v.pulse}/min` });
  if (v.spo2) out.push({ label: 'SpO₂', value: `${v.spo2}%` });
  if (v.tempF) out.push({ label: 'Temp', value: `${v.tempF}°F` });
  if (v.respRate) out.push({ label: 'Breaths', value: `${v.respRate}/min` });
  if (v.weightKg) out.push({ label: 'Weight', value: `${v.weightKg} kg` });
  if (v.heightCm) out.push({ label: 'Height', value: `${v.heightCm} cm` });
  const b = bmi(v.weightKg, v.heightCm);
  if (b != null) out.push({ label: 'BMI', value: `${b} · ${bmiBand(b)}` });
  if (v.grbs) out.push({ label: 'Sugar (GRBS)', value: `${v.grbs} mg/dL` });
  if (v.painScore != null) out.push({ label: 'Pain', value: `${v.painScore}/10` });
  return out;
}

type BandMode = 'product' | 'patient' | 'doctor';

/**
 * `/opd/consult` — the doctor's patients today. The SAME screen language as
 * OPD New visit / the lab's Order & Payments (it wears order-create's
 * stylesheet): band (OPD product tile · Doctor tile · one search that finds a
 * patient in this list by name, MRN or token), the MY PATIENTS work card
 * (Waiting / In consult / Done today, chips, patient tiles 2 / 1 per row)
 * and the AT A GLANCE side card for the picked patient (the next in line by
 * default) whose ONE primary opens the consult. Below 1024px the side card
 * is a bottom sheet. Refreshes every 30 s. Read-only — nothing is changed
 * until the doctor presses Start consult.
 */
@Component({
  selector: 'pf-opd-my-patients',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, HeroBandComponent, SkeletonRowsComponent, JourneyDockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-patients.page.html',
  styleUrls: ['../../frontdesk/order-create/order-create.component.scss', '../frontdesk/book-visit.page.scss', './my-patients.page.scss'],
})
export class OpdMyPatientsPage implements OnInit, OnDestroy {
  private readonly api = inject(ConsultApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly adminApi = inject(OpdAdminApi);
  private readonly modules = inject(ModuleScopeService);
  private readonly destroyRef = inject(DestroyRef);
  /** The journey dock (consult v6): shown for the patient the doctor TAPPED. */
  readonly dock = inject(JourneyDockService);

  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  readonly pillEl = viewChild<ElementRef<HTMLElement>>('pill');

  readonly today = new Date();
  readonly now = signal(Date.now());
  readonly tabs: { id: QueueTab; label: string }[] = [
    { id: 'waiting', label: 'Waiting' }, { id: 'in_consult', label: 'In consult' }, { id: 'completed', label: 'Done today' },
  ];
  readonly chipDefs: { id: QueueChip; label: string }[] = [
    { id: 'followup', label: 'Follow-ups' }, { id: 'vitals', label: 'Vitals pending' },
  ];
  readonly rows = signal<ConsultQueueRow[]>([]);
  readonly loading = signal(true);
  readonly tab = signal<QueueTab>('waiting');
  readonly chips = signal<Set<QueueChip>>(new Set());
  readonly query = signal('');
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Doctor filter (staff / staff-doctor only — showFilter()). '' = the
   *  caller's own default (own queue for a doctor, every doctor for staff). */
  readonly isDoctor = computed(() => this.auth.isDoctor());
  readonly showFilter = computed(() => showsDoctorFilter(this.isDoctor(), p => this.auth.hasAnyPermission(p)));
  readonly showDoctorName = computed(() => showsDoctorName(this.isDoctor(), this.selectedDoctorId()));
  readonly doctors = signal<OpdDoctorLite[]>([]);
  readonly selectedDoctorId = signal('');
  readonly doctorOptions = computed(() => doctorFilterOptions(this.doctors(), this.isDoctor()));
  readonly doctorLabel = computed(() => {
    const id = this.selectedDoctorId();
    if (!id) return this.isDoctor() ? (this.auth.user()?.displayName || 'My patients') : 'All doctors';
    return this.doctors().find(d => d.id === id)?.name ?? 'Doctor';
  });

  readonly counts = computed(() => {
    const c: Record<QueueTab, number> = { waiting: 0, in_consult: 0, completed: 0 };
    for (const r of this.searched()) { const t = tabOf(r.status); if (t) c[t]++; }
    return c;
  });
  private readonly searched = computed(() => {
    const q = this.query(); const ch = this.chips();
    return this.rows().filter(r => rowMatches(r, q)
      && (!ch.has('followup') || r.isFollowUp)
      && (!ch.has('vitals') || (!r.hasVitals && r.status !== 'completed')));
  });
  readonly visible = computed(() => this.searched().filter(r => tabOf(r.status) === this.tab()).sort((a, b) => a.token - b.token));
  readonly next = computed(() => nextToCall(this.rows()));
  readonly emptyText = computed(() => {
    if (this.query().trim() || this.chips().size) return 'No patient matches';
    return ({ waiting: 'No one waiting', in_consult: 'No one in consult', completed: 'No consults done yet today' })[this.tab()];
  });

  // ── Selection + at a glance ─────────────────────────────────────────
  readonly pickedId = signal<string | null>(null);
  /** The picked patient, else the one in consult, else the next in line. */
  readonly selected = computed<ConsultQueueRow | null>(() => {
    const rows = this.rows();
    return rows.find(r => r.visitId === this.pickedId())
      ?? rows.find(r => r.status === 'in_consult') ?? this.next() ?? this.visible()[0] ?? null;
  });
  readonly glance = signal<ConsultWorkspace | null>(null);
  readonly glanceLoading = signal(false);
  readonly glanceError = signal<string | null>(null);
  private glanceFor: string | null = null;
  readonly vitals = computed(() => glanceVitals(this.glance()?.vitals ?? null));
  readonly complaint = computed(() => this.glance()?.consult?.chiefComplaint || this.glance()?.visit.purpose || this.selected()?.purpose || '');
  readonly allergies = computed(() => (this.glance()?.allergies ?? []).filter(a => a.status !== 'inactive'));
  readonly ctaLabel = computed(() => this.selected()?.status === 'in_consult' ? 'Resume consult' : this.selected()?.status === 'completed' ? 'Open consult' : 'Start consult');

  // ── Layout (order-create's breakpoints) ─────────────────────────────
  readonly isLg = signal(true);
  readonly isPhone = signal(false);
  readonly sheetOpen = signal(false);

  // ── Band ────────────────────────────────────────────────────────────
  readonly bandMode = signal<BandMode>('patient');
  readonly scopeOpen = signal(false);
  readonly scopeHighlight = signal(0);
  readonly doctorQuery = signal('');
  readonly pillFocused = signal(false);
  readonly products = computed(() => {
    const list: { id: 'opd' | 'lab'; label: string; meta: string }[] = [{ id: 'opd', label: 'OPD', meta: 'My patients · this screen' }];
    if (this.modules.labUsable()) list.push({ id: 'lab', label: 'Tests', meta: 'Lab order & payments' });
    return list;
  });
  readonly productSwitchable = computed(() => this.products().length > 1);
  readonly pillValue = computed(() => (this.bandMode() === 'doctor' ? this.doctorQuery() : this.query()));
  readonly pillPlaceholder = computed(() => this.bandMode() === 'doctor'
    ? (this.isPhone() ? 'Find doctor' : 'Find a doctor')
    : (this.isPhone() ? 'Find patient' : 'Find a patient in this list: name, MRN or token'));
  readonly dropRows = computed(() => {
    if (this.bandMode() === 'product') return this.products().map(p => ({ key: p.id, title: p.label, meta: p.meta }));
    if (this.bandMode() === 'doctor') {
      const q = this.doctorQuery().trim().toLowerCase();
      return this.doctorOptions().filter(o => !q || o.label.toLowerCase().includes(q)).map(o => ({ key: o.value, title: o.label, meta: o.value ? 'Doctor' : 'Default view' }));
    }
    return [];
  });
  readonly dropOpen = computed(() => this.scopeOpen() && this.bandMode() !== 'patient');
  readonly searchActive = computed(() => this.pillFocused() || this.dropOpen());
  readonly dropBox = signal<{ left: number; top: number; width: number } | null>(null);

  ngOnInit() {
    this.watchMedia('(min-width: 1024px)', this.isLg, true);
    this.watchMedia('(max-width: 640px)', this.isPhone, false);
    if (this.showFilter()) this.loadDoctors();
    this.load();
    this.timer = setInterval(() => this.load(), 30_000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); this.dock.hide(); }

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

  /** The doctor picker list. Falls back to the doctors already seen in the
   *  queue rows when /api/doctors isn't readable for this caller (or errors). */
  private loadDoctors() {
    this.adminApi.doctorList().subscribe({
      next: docs => this.doctors.set(docs ?? []),
      error: () => this.doctors.set(doctorsFromRows(this.rows())),
    });
  }

  onDoctorChange(id: string) {
    this.selectedDoctorId.set(id);
    this.pickedId.set(null);
    this.load();
  }

  load() {
    this.now.set(Date.now());
    this.api.myQueue(undefined, this.selectedDoctorId() || undefined).subscribe({
      next: rows => {
        this.rows.set(rows ?? []);
        this.loading.set(false);
        // Someone already in consult → show that tab first.
        if (this.counts().in_consult && this.tab() === 'waiting' && !this.counts().waiting) this.tab.set('in_consult');
        if (this.showFilter() && !this.doctors().length && rows?.length) this.doctors.set(doctorsFromRows(rows));
        this.loadGlance();
      },
      error: e => { this.loading.set(false); this.toast.error(e?.message || 'Could not load your patients'); },
    });
  }

  /** At a glance for the selected visit — the consult's own read-only GET
   *  (no status change; only Start consult opens it). */
  private loadGlance(force = false): void {
    const r = this.selected();
    if (!r) { this.glance.set(null); this.glanceFor = null; return; }
    if (!force && this.glanceFor === r.visitId) return;
    this.glanceFor = r.visitId;
    this.glance.set(null); this.glanceError.set(null); this.glanceLoading.set(true);
    this.api.workspace(r.visitId).subscribe({
      next: w => { if (this.glanceFor === r.visitId) { this.glance.set(w); this.glanceLoading.set(false); } },
      error: e => { if (this.glanceFor === r.visitId) { this.glanceLoading.set(false); this.glanceError.set(ApiError.from(e).message); } },
    });
  }

  setTab(t: QueueTab) { this.tab.set(t); }
  isChip(c: QueueChip) { return this.chips().has(c); }
  toggleChip(c: QueueChip) {
    this.chips.update(s => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  }
  pick(r: ConsultQueueRow) {
    this.pickedId.set(r.visitId);
    this.dock.show({ id: r.patientId, name: r.patientName });
    this.loadGlance();
    if (!this.isLg()) this.sheetOpen.set(true);
  }
  closeSheet() { this.sheetOpen.set(false); }
  info(r: ConsultQueueRow) { return waitInfo(r, this.now()); }

  // ── Band ────────────────────────────────────────────────────────────
  selectScope(k: BandMode) {
    if (k === 'product' && !this.productSwitchable()) return;
    if (k === 'doctor' && !this.showFilter()) return;
    this.bandMode.set(k);
    this.doctorQuery.set('');
    this.scopeHighlight.set(0);
    this.sizeDropdown();
    this.scopeOpen.set(k !== 'patient');
    if (k !== 'product') queueMicrotask(() => this.searchInput()?.nativeElement?.focus?.());
  }
  closeScope() { this.scopeOpen.set(false); this.doctorQuery.set(''); this.bandMode.set('patient'); }
  onPillInput(v: string) {
    if (this.bandMode() === 'product') this.bandMode.set('patient');
    if (this.bandMode() === 'doctor') { this.doctorQuery.set(v); this.scopeOpen.set(true); this.scopeHighlight.set(0); return; }
    this.query.set(v);
  }
  onPillFocus() { this.pillFocused.set(true); if (this.bandMode() === 'product') this.closeScope(); }
  onPillBlur() { setTimeout(() => this.pillFocused.set(false), 0); }
  onPillArrow(e: Event, dir: number) {
    const n = this.dropRows().length; if (!n || !this.dropOpen()) return;
    e.preventDefault(); this.scopeHighlight.update(i => (i + dir + n) % n);
  }
  onPillEnter(e: Event) {
    if (!this.dropOpen()) { const v = this.visible(); if (v.length === 1) this.pick(v[0]); return; }
    const rows = this.dropRows(); if (!rows.length) return;
    e.preventDefault(); this.pickDropRow(rows[Math.min(this.scopeHighlight(), rows.length - 1)]);
  }
  onPillEscape() { if (this.dropOpen()) this.closeScope(); else this.query.set(''); }
  pickDropRow(row: { key: string }) {
    const k = this.bandMode();
    this.closeScope();
    if (k === 'product') {
      if (row.key === 'lab') { const t = labOrderTarget(null); void this.router.navigate(t.commands as string[]); }
      return;
    }
    if (k === 'doctor') this.onDoctorChange(row.key);
  }
  @HostListener('document:pointerdown', ['$event'])
  onDocPointerDown(ev: Event) {
    if (!this.scopeOpen()) return;
    const host = this.pillEl()?.nativeElement;
    if (host && ev.target instanceof Node && host.contains(ev.target)) return;
    this.closeScope();
  }
  private sizeDropdown() {
    if (typeof window === 'undefined') return;
    const us = this.pillEl()?.nativeElement;
    if (!us?.getBoundingClientRect) return;
    const field = (us.closest('.pf-hb__field') ?? us.closest('.pf-hb__search') ?? us) as HTMLElement;
    const u = us.getBoundingClientRect(); const p = field.getBoundingClientRect();
    if (p.width > 0) this.dropBox.set({ left: p.left - u.left, top: p.bottom - u.top + 8, width: p.width });
  }

  statusLabel(s: string) {
    return ({ booked: 'Booked', vitals: 'At vitals', waiting: 'Waiting', in_consult: 'In consult', completed: 'Done' } as Record<string, string>)[s] ?? s;
  }
  open(r: ConsultQueueRow) { this.router.navigate(['/opd/consult', r.visitId]); }
  callNext() { const n = this.next(); if (n) this.open(n); }
  startSelected() { const r = this.selected(); if (r) this.open(r); }
  history() { const r = this.selected(); if (r) this.router.navigate(['/opd/patient', r.patientId]); }
  /** A date tapped on the dock: that visit in the patient's history. */
  historyAt(day: string) { const r = this.selected(); if (r) this.router.navigate(['/opd/patient', r.patientId], { queryParams: { date: day } }); }
  dxText(dx: { label: string }[]): string { return dx.map(d => d.label).join(', '); }
}
