import {
  ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, inject, input, output, signal,
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import { SelectComponent } from '../../primitives/select.component';
import { ModalPortalDirective } from '../../directives/modal-portal.directive';
import { BusyDirective } from '../../directives/busy.directive';
import {
  NONE, OrderReferral, ReferralDoctorOption, ReferralForm, ReferralSaveResult,
  currentDoctorValue, doctorOptions, formFrom, hospitalOptions, parseDoctorKey,
  referralChanged, referralPayload, referralSummary, sourceOptions,
} from './referral-edit';

/**
 * "Edit referral" — change the referring doctor, hospital and referral source
 * of a BOOKED order (during result entry, before sign-off, after release).
 * One dialog for every screen that offers it (result entry, validation, the
 * report viewer, the patient's order). The host renders it only while open
 * with the order id, and listens for `saved` / `closed`.
 *
 * - Doctor / hospital: searchable pf-selects over the SAME referring-network
 *   endpoints as order booking (server matches as you type), with "Add …"
 *   for a new name — exactly what booking does. Never native controls.
 * - A released report is re-issued as an AMENDED report by the server; the
 *   dialog says so up front and asks once (DialogService) before saving.
 * - Phones: a bottom sheet, 44px targets, 16px inputs.
 */
@Component({
  selector: 'pf-edit-referral-dialog',
  standalone: true,
  imports: [SelectComponent, ModalPortalDirective, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-erd" [class.pf-erd--behind]="confirming()" role="dialog" aria-modal="true" aria-labelledby="pf-erd-title" pfModalPortal>
      <div class="pf-erd__backdrop" (click)="close()"></div>
      <form class="pf-erd__card" (submit)="$event.preventDefault(); save()">
        <header class="pf-erd__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M5 2v2"/><path d="M11 2v2"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/></svg>
          </span>
          <div class="pf-erd__head-text">
            <h2 id="pf-erd-title" class="pf-card__label">Edit referral</h2>
            @if (ref(); as r) {
              <p class="pf-erd__sub">
                @if (r.patientName) { <strong>{{ r.patientName }}</strong> }
                @if (r.patientName && r.orderNumber) { · }
                @if (r.orderNumber) { <span class="pf-num">{{ r.orderNumber }}</span> }
              </p>
            }
          </div>
          <button type="button" class="pf-btn pf-btn--icon pf-erd__close" (click)="close()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="pf-erd__body">
          @if (loading()) {
            <div class="pf-erd__skel" aria-busy="true" aria-label="Loading the referral">
              <span class="pf-erd__bar" style="width: 55%"></span>
              <span class="pf-erd__bar pf-erd__bar--field"></span>
              <span class="pf-erd__bar pf-erd__bar--field"></span>
              <span class="pf-erd__bar pf-erd__bar--field"></span>
            </div>
          } @else if (loadError()) {
            <p class="pf-erd__err" role="alert">{{ loadError() }}</p>
          } @else {
            <div class="pf-erd__now">
              <span class="pf-erd__now-k">Booked as</span>
              <span class="pf-erd__now-v">{{ bookedSummary() }}</span>
            </div>

            @if (ref()?.releasedReportId) {
              <div class="pf-erd__note" role="note">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/></svg>
                <span>
                  The report is already released. Changing the doctor or hospital issues an
                  <strong>amended report</strong> with the new referral; the released copy keeps the old one.
                  @if (ref()?.releasedReportDelivered) { The patient already has the old copy — send the amended one again. }
                </span>
              </div>
            }

            <div class="pf-field">
              <label class="pf-field__lbl" for="pf-erd-doctor">Referring doctor</label>
              <pf-select id="pf-erd-doctor" class="pf-erd__select" [options]="doctorOpts()" [value]="doctorValue()"
                         [searchable]="true" [allowCreate]="true" createVerb="Add"
                         createHint="Add as a new referring doctor" placeholder="Search doctors"
                         (searchChange)="searchDoctors($event)" (valueChange)="pickDoctor($event)"></pf-select>
            </div>
            <div class="pf-erd__row">
              <div class="pf-field">
                <label class="pf-field__lbl" for="pf-erd-hospital">Hospital</label>
                <pf-select id="pf-erd-hospital" class="pf-erd__select" [options]="hospitalOpts()" [value]="form().hospital"
                           [searchable]="true" [allowCreate]="true" createVerb="Add"
                           createHint="Add as a new referring hospital" placeholder="Search hospitals"
                           (searchChange)="searchHospitals($event)" (valueChange)="pickHospital($event)"></pf-select>
              </div>
              <div class="pf-field">
                <label class="pf-field__lbl" for="pf-erd-source">Referral source</label>
                <pf-select id="pf-erd-source" class="pf-erd__select" [options]="sourceOpts()" [value]="form().sourceType"
                           placeholder="Not set" (valueChange)="patch({ sourceType: $event })"></pf-select>
              </div>
            </div>
            <div class="pf-field">
              <label class="pf-field__lbl" for="pf-erd-reason">Reason <span class="pf-erd__opt">optional</span></label>
              <input id="pf-erd-reason" class="pf-input" type="text" autocomplete="off" maxlength="500"
                     placeholder="e.g. Wrong doctor picked at booking"
                     [value]="reason()" (input)="reason.set($any($event.target).value)" />
              <p class="pf-field__hint">Kept in the order history with the old and new referral, your name and the time.</p>
            </div>
            @if (error()) { <p class="pf-erd__err" role="alert">{{ error() }}</p> }
          }
        </div>

        <footer class="pf-erd__foot">
          <button type="button" class="pf-btn pf-btn--secondary" [disabled]="saving()" (click)="close()">Cancel</button>
          <button type="submit" class="pf-btn pf-btn--primary" [disabled]="!canSave() || saving()"
                  [pfBusy]="saving()" pfBusyLabel="Saving referral…">
            {{ saving() ? 'Saving…' : 'Save referral' }}
          </button>
        </footer>
      </form>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .pf-erd { position: fixed; inset: 0; z-index: 72; display: flex; align-items: center; justify-content: center; padding: 16px; }
    /* The DialogService confirm lives in the shell (its own stacking
       context) — this body-portalled dialog steps aside while it is open. */
    .pf-erd--behind { visibility: hidden; }
    .pf-erd__sub .pf-num { white-space: nowrap; }
    .pf-erd__backdrop { position: absolute; inset: 0; background: rgba(5, 5, 15, 0.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .pf-erd__card {
      position: relative; width: 100%; max-width: 36rem; max-height: calc(100dvh - 32px);
      display: flex; flex-direction: column; margin: 0; padding: 0;
      border-radius: var(--pf-radius-card, 18px); background: var(--pf-card-bg, var(--bg-card-solid));
      border: 1px solid var(--pf-line, var(--glass-border)); box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45); overflow: hidden;
    }
    .pf-erd__head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 16px 12px; border-bottom: 1px solid var(--pf-line); }
    .pf-erd__head-text { flex: 1 1 auto; min-width: 0; }
    .pf-erd__head .pf-card__label { margin: 0; line-height: 24px; }
    .pf-erd__sub { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .pf-erd__sub strong { font-weight: 600; color: var(--text-primary); }
    .pf-erd__close { flex: none; }
    .pf-erd__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
    .pf-erd__row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 12px; }
    .pf-erd__select { display: block; width: 100%; }
    .pf-erd__now {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 10px 12px;
      border-radius: 12px; background: var(--pf-chip-bg, rgba(100, 116, 139, 0.08));
      border: 1px solid var(--pf-line);
    }
    .pf-erd__now-k { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-erd__now-v { font-size: 13.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-erd__note {
      display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px;
      font-size: 12.5px; line-height: 1.5; text-wrap: pretty;
      color: var(--amber-text, #b45309); background: var(--warning-bg, rgba(245, 158, 11, 0.1));
      border: 1px solid var(--warning-border, rgba(245, 158, 11, 0.28));
    }
    .pf-erd__note svg { flex: none; margin-top: 1px; }
    .pf-erd__note strong { font-weight: 600; }
    .pf-erd__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-erd__err { margin: 0; font-size: 12.5px; color: var(--red-text, #dc2626); }
    .pf-erd__skel { display: flex; flex-direction: column; gap: 14px; }
    .pf-erd__bar { display: block; height: 14px; border-radius: 7px; background: var(--pf-line, rgba(100, 116, 139, 0.18)); animation: pf-erd-pulse 1.2s ease-in-out infinite; }
    .pf-erd__bar--field { height: 40px; border-radius: 10px; }
    @keyframes pf-erd-pulse { 50% { opacity: 0.55; } }
    @media (prefers-reduced-motion: reduce) { .pf-erd__bar { animation: none; } }
    .pf-erd__foot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 16px 16px; border-top: 1px solid var(--pf-line); }
    @media (max-width: 640px) {
      .pf-erd { align-items: flex-end; padding: 0; }
      .pf-erd__card { max-width: none; border-radius: 18px 18px 0 0; max-height: calc(100dvh - 24px); padding-bottom: env(safe-area-inset-bottom, 0px); }
      .pf-erd__row { grid-template-columns: minmax(0, 1fr); }
      .pf-erd__body .pf-input { font-size: 16px; min-height: 44px; }
      .pf-erd__foot .pf-btn { min-height: 44px; }
    }
  `],
})
export class EditReferralDialogComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly orderId = input.required<string>();
  readonly closed = output<void>();
  readonly saved = output<ReferralSaveResult>();

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly ref = signal<OrderReferral | null>(null);
  /** What the order carries now (the dialog's "before"). */
  private readonly booked = signal<ReferralForm>(formFrom(null));
  readonly form = signal<ReferralForm>(formFrom(null));
  readonly reason = signal('');
  readonly saving = signal(false);
  /** The amend confirm (DialogService) is open — this dialog steps aside. */
  readonly confirming = signal(false);
  readonly error = signal<string | null>(null);

  private readonly doctorList = signal<ReferralDoctorOption[]>([]);
  private readonly hospitalList = signal<string[]>([]);
  private doctorQuery = '';
  private timers: Record<'doctor' | 'hospital', ReturnType<typeof setTimeout> | null> = { doctor: null, hospital: null };

  readonly doctorOpts = computed(() => doctorOptions(this.doctorList(), this.form()));
  readonly doctorValue = computed(() => currentDoctorValue(this.form()));
  readonly hospitalOpts = computed(() => hospitalOptions(this.hospitalList(), this.form().hospital));
  readonly sourceOpts = computed(() => sourceOptions(this.ref()?.sourceTypes));
  readonly bookedSummary = computed(() => {
    const b = this.booked();
    return referralSummary(b) + (b.sourceType ? ` · ${b.sourceType}` : '');
  });
  readonly canSave = computed(() => !this.loading() && !this.loadError() && referralChanged(this.booked(), this.form()));

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const t of Object.values(this.timers)) if (t) clearTimeout(t);
    });
  }

  ngOnInit(): void {
    this.api.get<OrderReferral>(`/api/orders/${this.orderId()}/referral`).subscribe({
      next: r => {
        this.ref.set(r);
        const f = formFrom(r);
        this.booked.set(f);
        this.form.set(f);
        this.loading.set(false);
        this.fetchHospitals('');
        this.fetchDoctors('');
      },
      error: e => {
        this.loadError.set(ApiError.from(e).message || 'Could not load the referral.');
        this.loading.set(false);
      },
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (!this.saving() && !this.confirming()) this.close(); }

  close() { this.closed.emit(); }

  patch(p: Partial<ReferralForm>) {
    this.form.update(f => ({ ...f, ...p }));
    this.error.set(null);
  }

  /** A doctor row (directory) or a typed new name. A directory row tied to
   *  a hospital fills the hospital when none is chosen (as booking does). */
  pickDoctor(v: string) {
    const d = parseDoctorKey(v);
    if (!d) { this.patch({ doctor: '', doctorId: null }); return; }
    const p: Partial<ReferralForm> = { doctor: d.name, doctorId: d.doctorId ?? null };
    if (d.hospitalName && !this.form().hospital.trim()) p.hospital = d.hospitalName;
    this.patch(p);
  }

  pickHospital(v: string) {
    this.patch({ hospital: v === NONE ? '' : v.trim() });
    // The doctor list follows the hospital (that hospital's doctors first).
    this.fetchDoctors(this.doctorQuery);
  }

  searchDoctors(q: string) { this.doctorQuery = q; this.debounce('doctor', () => this.fetchDoctors(q)); }
  searchHospitals(q: string) { this.debounce('hospital', () => this.fetchHospitals(q)); }

  private debounce(k: 'doctor' | 'hospital', run: () => void) {
    const t = this.timers[k];
    if (t) clearTimeout(t);
    this.timers[k] = setTimeout(run, 200);
  }

  private fetchDoctors(q: string) {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    const h = this.form().hospital.trim();
    if (h) params.set('hospital', h);
    const qs = params.toString();
    this.api.get<Array<ReferralDoctorOption | string>>(`/api/test-picker/doctors/options${qs ? `?${qs}` : ''}`).subscribe({
      next: list => this.doctorList.set((list ?? []).map(x => (typeof x === 'string' ? { name: x } : x))),
      error: () => this.doctorList.set([]),
    });
  }

  private fetchHospitals(q: string) {
    const t = q.trim();
    this.api.get<string[]>(`/api/test-picker/hospitals${t ? `?q=${encodeURIComponent(t)}` : ''}`).subscribe({
      next: names => this.hospitalList.set(names ?? []),
      error: () => this.hospitalList.set([]),
    });
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    const r = this.ref();
    const f = this.form();
    const printedChange = f.doctor.trim() !== this.booked().doctor.trim() || f.hospital.trim() !== this.booked().hospital.trim();
    if (r?.releasedReportId && printedChange) {
      this.confirming.set(true);
      const ok = await this.dialog.confirm({
        title: 'Issue an amended report?',
        message: `The released report will be replaced by an amended report referred by ${referralSummary(f)}. The old copy stays in the record with ${referralSummary(this.booked())}.`,
        confirmLabel: 'Save and amend',
        tone: 'primary',
      }).finally(() => this.confirming.set(false));
      if (!ok) return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.patch<ReferralSaveResult>(`/api/orders/${this.orderId()}/referral`, referralPayload(f, this.reason())).subscribe({
      next: res => {
        this.saving.set(false);
        if (!res?.changed) this.toasts.info('The referral was already up to date');
        else if (res.reportAmended) this.toasts.success('Referral updated · amended report issued');
        else this.toasts.success('Referral updated');
        if (res?.amendError) this.toasts.warning(res.amendError, 8000);
        this.saved.emit(res);
      },
      error: e => {
        this.saving.set(false);
        this.error.set(ApiError.from(e).message || 'Could not save the referral.');
      },
    });
  }
}
