import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ADMIN_PERMS, FRONTDESK_PERMS } from '../../../core/auth/route-access';
import { OpdAdminApi, OpdDoctorLite } from '../admin/opd-admin.api';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ConsultApi, ConsultQueueRow } from './consult.api';

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

/**
 * `/opd/consult` — the doctor's patients today (Agent C). ND pattern: band →
 * one work card; tabs Waiting / In consult / Completed with counts; ONE
 * primary ("Call next") that opens the lowest waiting token in the full-screen
 * consult (opening it moves the visit to "In consult"). Refreshes every 30 s.
 */
@Component({
  selector: 'pf-opd-my-patients',
  standalone: true,
  imports: [DatePipe, HeroBandComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page mp">
      <pf-hero-band [back]="true" [customSearch]="true" [contextBar]="true">
        <div band-search class="nd-ctx">
          <span class="nd-ctx__primary">My patients</span>
          <span class="nd-ctx__chip"><span class="nd-ctx__k">Today</span>{{ today | date:'EEE, MMM d' }}</span>
          <span class="nd-ctx__chip"><span class="nd-ctx__k">Waiting</span>{{ counts().waiting }}</span>
        </div>
        <div band-actions>
          <button type="button" class="nd-btn nd-btn--primary mp__call" [disabled]="!next()" (click)="callNext()">
            @if (next(); as n) { Call next · Token {{ n.token }} } @else { No one waiting }
          </button>
        </div>
      </pf-hero-band>

      <div class="pf-band-body mp__body">
        <div class="nd-card mp__card">
          <div class="nd-card__head">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v6a4 4 0 0 0 8 0V3"/><path d="M8 15a5 5 0 0 0 5 5h1a4 4 0 0 0 4-4v-2"/><circle cx="19" cy="10" r="2"/></svg></span>
            <span class="nd-card__label">Queue</span>
            @if (showFilter()) {
              <span class="mp__docfilter">
                <pf-select [options]="doctorOptions()" [value]="selectedDoctorId()" size="sm"
                           placeholder="All doctors" (valueChange)="onDoctorChange($event)"></pf-select>
              </span>
            }
            <span class="nd-card__spacer"></span>
            <div class="nd-tabs mp__tabs" role="tablist">
              @for (t of tabs; track t.id) {
                <button type="button" role="tab" class="nd-tabs__item" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">
                  {{ t.label }} <span class="mp__cnt">{{ counts()[t.id] }}</span>
                </button>
              }
            </div>
          </div>
          <div class="nd-card__body">
            @if (loading() && !rows().length) {
              @for (i of [1, 2, 3]; track i) { <div class="mp__skel"></div> }
            } @else {
              @for (r of visible(); track r.visitId) {
                <button type="button" class="nd-row mp__row" [class.nd-row--in]="r.status === 'in_consult'" (click)="open(r)">
                  <span class="mp__token">{{ r.token }}</span>
                  <span class="mp__main">
                    <span class="mp__name">{{ r.patientName }} @if (r.ageSex) { <em>{{ r.ageSex }}</em> } @if (r.isFollowUp) { <span class="mp__tag">Follow-up</span> }
                      @if (r.allergyCount) { <span class="mp__tag mp__tag--warn">Allergy</span> }</span>
                    <span class="mp__sub">{{ r.purpose || 'No purpose noted' }}@if (r.departmentName) { · {{ r.departmentName }}}@if (r.serviceName) { · {{ r.serviceName }}}@if (showDoctorName() && r.doctorName) { · Dr {{ r.doctorName }}}</span>
                  </span>
                  <span class="mp__side">
                    <span class="mp__status" [attr.data-status]="r.status">{{ statusLabel(r.status) }}</span>
                    <span class="mp__time">
                      @if (r.completedAt) { Done {{ r.completedAt | date:'h:mm a' }} }
                      @else if (r.consultStartedAt) { Since {{ r.consultStartedAt | date:'h:mm a' }} }
                      @else if (r.checkedInAt) { In {{ r.checkedInAt | date:'h:mm a' }} }
                      @if (!r.hasVitals && r.status !== 'completed') { · no vitals }
                    </span>
                  </span>
                  <svg class="mp__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              } @empty {
                <div class="nd-empty">
                  <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span>
                  <p class="nd-empty__title">{{ emptyText() }}</p>
                  <p class="nd-empty__body">Patients the front desk books with you today appear here.</p>
                </div>
              }
            }
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .mp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .mp__body { flex: 1; min-height: 0; display: flex; padding: 16px 20px 20px; }
    .mp__card { flex: 1; max-width: 1080px; margin: 0 auto; width: 100%; }
    .mp__tabs { flex: 0 1 auto; }
    .mp__docfilter { flex: 0 0 auto; width: 168px; margin-left: 4px; }
    @media (max-width: 640px) { .mp__docfilter { width: 100%; order: 3; } }
    .mp__cnt { font-variant-numeric: tabular-nums; color: var(--text-tertiary); font-weight: 500; }
    .mp__call { min-width: 180px; }
    .mp__row { width: 100%; cursor: pointer; min-height: 64px; gap: 14px; }
    .mp__row:hover { border-color: var(--nd-sel-border); }
    .mp__token { flex: none; width: 44px; height: 44px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; background: var(--nd-chip-bg); color: var(--text-primary); }
    .mp__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .mp__name { font-size: 14.5px; font-weight: 600; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
    .mp__name em { font-style: normal; font-weight: 400; font-size: 12.5px; color: var(--text-tertiary); }
    .mp__tag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 6px; background: var(--nd-chip-bg); color: var(--text-secondary); }
    .mp__tag--warn { color: var(--red-text, #dc2626); background: color-mix(in srgb, var(--red-text, #dc2626) 10%, transparent); }
    .mp__sub { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.4; }
    .mp__side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
    .mp__status { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
    .mp__status[data-status='in_consult'] { color: var(--violet-text, #6d28d9); }
    .mp__time { font-size: 12px; color: var(--text-tertiary); }
    .mp__chev { flex: none; color: var(--text-tertiary); }
    .mp__skel { height: 64px; border-radius: 12px; background: var(--nd-chip-bg); animation: mp-p 1.2s ease-in-out infinite; }
    @keyframes mp-p { 50% { opacity: 0.5; } }
    @media (prefers-reduced-motion: reduce) { .mp__skel { animation: none; } }
    @media (max-width: 640px) {
      .mp__body { padding: 12px; }
      .mp__side .mp__time { display: none; }
      .mp__card .nd-card__head { flex-wrap: wrap; }
      .mp__tabs { width: 100%; }
    }
  `],
})
export class OpdMyPatientsPage implements OnInit, OnDestroy {
  private readonly api = inject(ConsultApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly adminApi = inject(OpdAdminApi);

  readonly today = new Date();
  readonly tabs: { id: QueueTab; label: string }[] = [
    { id: 'waiting', label: 'Waiting' }, { id: 'in_consult', label: 'In consult' }, { id: 'completed', label: 'Completed' },
  ];
  readonly rows = signal<ConsultQueueRow[]>([]);
  readonly loading = signal(true);
  readonly tab = signal<QueueTab>('waiting');
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Doctor filter (Task C, staff/staff-doctor only — showFilter()). '' = the
   *  caller's own default (own queue for a doctor, every doctor's visits for
   *  staff — the server's existing `doctorId`-omitted behaviour). */
  readonly isDoctor = computed(() => this.auth.isDoctor());
  readonly showFilter = computed(() => showsDoctorFilter(this.isDoctor(), p => this.auth.hasAnyPermission(p)));
  readonly showDoctorName = computed(() => showsDoctorName(this.isDoctor(), this.selectedDoctorId()));
  readonly doctors = signal<OpdDoctorLite[]>([]);
  readonly selectedDoctorId = signal('');
  readonly doctorOptions = computed(() => doctorFilterOptions(this.doctors(), this.isDoctor()));

  readonly counts = computed(() => {
    const c: Record<QueueTab, number> = { waiting: 0, in_consult: 0, completed: 0 };
    for (const r of this.rows()) { const t = tabOf(r.status); if (t) c[t]++; }
    return c;
  });
  readonly visible = computed(() => this.rows().filter(r => tabOf(r.status) === this.tab()).sort((a, b) => a.token - b.token));
  readonly next = computed(() => nextToCall(this.rows()));
  readonly emptyText = computed(() => ({ waiting: 'No one waiting', in_consult: 'No one in consult', completed: 'No consults completed yet' })[this.tab()]);

  ngOnInit() {
    if (this.showFilter()) this.loadDoctors();
    this.load();
    this.timer = setInterval(() => this.load(), 30_000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

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
    this.load();
  }

  load() {
    this.api.myQueue(undefined, this.selectedDoctorId() || undefined).subscribe({
      next: rows => {
        this.rows.set(rows ?? []);
        this.loading.set(false);
        // Someone already in consult → show that tab first.
        if (this.loading() === false && this.counts().in_consult && this.tab() === 'waiting' && !this.counts().waiting) this.tab.set('in_consult');
        // Fallback doctor list never got a first fetch (or it failed before
        // any row existed) — top it up now that rows are in.
        if (this.showFilter() && !this.doctors().length && rows?.length) this.doctors.set(doctorsFromRows(rows));
      },
      error: e => { this.loading.set(false); this.toast.error(e?.message || 'Could not load your patients'); },
    });
  }

  statusLabel(s: string) {
    return ({ booked: 'Booked', vitals: 'At vitals', waiting: 'Waiting', in_consult: 'In consult', completed: 'Completed' } as Record<string, string>)[s] ?? s;
  }
  open(r: ConsultQueueRow) { this.router.navigate(['/opd/consult', r.visitId]); }
  callNext() { const n = this.next(); if (n) this.open(n); }
}
