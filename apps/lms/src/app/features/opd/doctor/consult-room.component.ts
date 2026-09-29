import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonDetailComponent } from '../../../shared/primitives/skeleton-kit.component';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { PatientTimelineComponent } from '../../frontdesk/patient-profile/patient-timeline.component';
import { Consultation } from './doctor-queue.component';
import { NavBackService } from '../../../core/services/nav-back.service';

interface Vitals {
  bpSys?: number | null; bpDia?: number | null; pulse?: number | null; spo2?: number | null;
  tempF?: number | null; rr?: number | null; weightKg?: number | null; heightCm?: number | null;
}
interface RxLine { drug: string; dose: string; frequency: string; durationDays: number | null; instructions: string; }

interface VitalField {
  key: keyof Vitals; label: string; unit: string;
  /** Amber-flag when outside [lo, hi] (either side optional). */
  lo?: number; hi?: number;
}

/**
 * The Consult Room — the doctor's workspace for ONE consultation. The
 * patient's journey (the timeline screen) is the canvas; the right rail is
 * the consult itself: vitals → complaint/diagnosis/advice → prescription →
 * follow-up. Save keeps a draft; Complete signs the consult off.
 */
@Component({
  selector: 'pf-consult-room',
  standalone: true,
  imports: [FormsModule, SelectComponent, PatientTimelineComponent, BusyDirective, SkeletonDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cr-shell">
      @if (c(); as cc) {
        <pf-patient-timeline [patientId]="cc.patientId" [embedded]="true" [hideTitle]="true"
                             [extraNav]="consultNav" (extraChange)="onPane($event)">
          <!-- The journey's top bar carries the consult identity + actions. -->
          <div tl-bar class="crb">
            <button type="button" class="crb__back press" (click)="back()" aria-label="Back to queue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <span class="crb__name">{{ cc.patientName || 'Patient' }}</span>
            <span class="crb__meta">{{ cc.patientInfo || '—' }} · Token {{ cc.token }} · ₹{{ cc.fee }}</span>
            <span class="crb__status" [attr.data-status]="cc.status">
              @switch (cc.status) {
                @case ('waiting') { Waiting }
                @case ('in_consult') { In consult }
                @case ('done') { Completed }
                @case ('cancelled') { Cancelled }
              }
            </span>
            <span class="crb__grow"></span>
            @if (!readonly()) {
              <button type="button" class="crb__btn press" [disabled]="saving() || !dirty()" (click)="save(false)"
                      [pfBusy]="saving() && !completing()" pfBusyLabel="Saving…">
                {{ saving() ? 'Saving…' : 'Save draft' }}
              </button>
              <button type="button" class="crb__btn crb__btn--primary press" [disabled]="saving()" (click)="save(true)"
                      [pfBusy]="saving() && completing()" pfBusyLabel="Completing…">
                Complete consult
              </button>
            }
          </div>

          <!-- The stage pane the journey shows when a consult nav item is active. -->
          <div class="cr-pane-body">
            @switch (pane()) {
              @case ('vitals') {
                <p class="cr-lbl">Vitals</p>
                <div class="cr-vgrid">
                  @for (f of vitalFields; track f.key) {
                    <label class="cr-vfield" [class.cr-vfield--flag]="vitalFlagged(f)">
                      <span class="cr-vfield__lbl">{{ f.label }}</span>
                      <span class="cr-vfield__wrap">
                        <input type="number" inputmode="decimal" class="cr-vfield__in"
                               [ngModel]="vitals()[f.key]" (ngModelChange)="setVital(f.key, $event)"
                               [disabled]="readonly()" placeholder="—" />
                        <em>{{ f.unit }}</em>
                      </span>
                    </label>
                  }
                </div>
              }
              @case ('notes') {
                <label class="cr-lbl" for="cr-complaint">Complaint & findings</label>
                <textarea id="cr-complaint" class="cr-text" rows="5" [ngModel]="complaint()" (ngModelChange)="complaint.set($event); dirty.set(true)"
                          [disabled]="readonly()" placeholder="Chief complaint, duration, examination findings…"></textarea>
                <label class="cr-lbl cr-lbl--gap" for="cr-diagnosis">Diagnosis</label>
                <input id="cr-diagnosis" type="text" class="cr-in" [ngModel]="diagnosis()" (ngModelChange)="diagnosis.set($event); dirty.set(true)"
                       [disabled]="readonly()" placeholder="Provisional / final diagnosis" />
                <label class="cr-lbl cr-lbl--gap" for="cr-advice">Advice</label>
                <textarea id="cr-advice" class="cr-text" rows="3" [ngModel]="advice()" (ngModelChange)="advice.set($event); dirty.set(true)"
                          [disabled]="readonly()" placeholder="Diet, rest, red flags to watch for…"></textarea>
              }
              @case ('rx') {
                <p class="cr-lbl">Prescription</p>
                @if (rx().length === 0 && readonly()) {
                  <p class="cr-empty">No drugs prescribed.</p>
                }
                @for (r of rx(); track $index; let i = $index) {
                  <div class="cr-rx">
                    <input type="text" class="cr-in cr-rx__drug" [ngModel]="r.drug" (ngModelChange)="setRx(i, 'drug', $event)"
                           [disabled]="readonly()" placeholder="Drug & strength" [attr.aria-label]="'Drug ' + (i + 1)" />
                    <div class="cr-rx__row">
                      <input type="text" class="cr-in cr-rx__dose" [ngModel]="r.dose" (ngModelChange)="setRx(i, 'dose', $event)"
                             [disabled]="readonly()" placeholder="Dose" aria-label="Dose" />
                      <pf-select class="cr-rx__freq" size="sm" [options]="freqOpts" [value]="r.frequency"
                                 placeholder="Frequency" [disabled]="readonly()"
                                 (valueChange)="setRx(i, 'frequency', $event)"></pf-select>
                      <input type="number" class="cr-in cr-rx__days" inputmode="numeric" [ngModel]="r.durationDays"
                             (ngModelChange)="setRx(i, 'durationDays', $event)" [disabled]="readonly()"
                             placeholder="Days" aria-label="Duration (days)" />
                      @if (!readonly()) {
                        <button type="button" class="cr-rx__x press" (click)="removeRx(i)" [attr.aria-label]="'Remove ' + (r.drug || 'drug')">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
                        </button>
                      }
                    </div>
                    <input type="text" class="cr-in cr-rx__note" [ngModel]="r.instructions" (ngModelChange)="setRx(i, 'instructions', $event)"
                           [disabled]="readonly()" placeholder="Instructions (after food, with water…)" aria-label="Instructions" />
                  </div>
                }
                @if (!readonly()) {
                  <button type="button" class="cr-add press" (click)="addRx()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                    Add drug
                  </button>
                }
                <label class="cr-lbl cr-lbl--gap">Follow-up</label>
                <pf-select class="cr-follow" [options]="followOpts" [value]="followUp()" [disabled]="readonly()"
                           (valueChange)="followUp.set($event); dirty.set(true)"></pf-select>
              }
            }
          </div>
        </pf-patient-timeline>
      } @else if (loading()) {
        <!-- The consult on its way: the journey's shape, not a blank page. -->
        <pf-skeleton-detail class="cr-skel" [fields]="6" [sections]="2" label="Opening the consultation…"></pf-skeleton-detail>
      } @else {
        <div class="cr-missing">Consultation not found.</div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow: hidden; }
    .cr-shell { height: 100%; padding: 8px 12px 10px; }
    .cr-shell pf-patient-timeline { display: block; height: 100%; }
    .cr-skel { padding: 12px 4px; }

    /* ── The consult strip inside the journey's top bar ── */
    .crb { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
    .crb__back { width: 32px; height: 32px; margin-left: -4px; border-radius: 9px; color: var(--text-primary, #fff);
      background: transparent; border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
    @media (hover: hover) { .crb__back:hover { background: rgba(255, 255, 255, 0.08); } }
    .crb__name { font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .crb__meta { font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: rgba(255, 255, 255, 0.55);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .crb__status { padding: 3px 10px; border-radius: 9999px; font-size: 10px; font-weight: 700; letter-spacing: .07em;
      text-transform: uppercase; border: 1px solid rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.6); white-space: nowrap; }
    .crb__status[data-status='waiting']    { color: #fbbf24; border-color: rgba(245, 158, 11, 0.45); }
    .crb__status[data-status='in_consult'] { color: #c4b5fd; border-color: rgba(168, 85, 247, 0.5); }
    .crb__grow { flex: 1; }
    .crb__btn { height: 32px; padding: 0 14px; border-radius: 9999px; font-size: 12.5px; font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.18); background: transparent; color: rgba(255, 255, 255, 0.75);
      cursor: pointer; white-space: nowrap; transition: background .15s, color .15s, box-shadow .25s; }
    .crb__btn:disabled { opacity: .45; cursor: not-allowed; }
    @media (hover: hover) { .crb__btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); color: #fff; } }
    .crb__btn--primary { background: var(--gradient-primary); color: #fff; border-color: transparent;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4); }
    .crb__btn--primary:hover:not(:disabled) { box-shadow: 0 8px 22px rgba(124, 58, 237, 0.55); }

    /* ── The consult pane (projected into the journey stage) ── */
    .cr-pane-body { max-width: 720px; }
    .cr-lbl { display: block; margin: 0 0 8px; font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted, rgba(255,255,255,.45)); }
    .cr-lbl--gap { margin-top: 16px; }
    .cr-empty { margin: 0; font-size: 12.5px; color: var(--text-tertiary, rgba(255,255,255,.5)); }

    .cr-vgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px 14px; }
    .cr-vfield { display: flex; flex-direction: column; gap: 3px; }
    .cr-vfield__lbl { font-size: 11px; font-weight: 600; color: var(--text-secondary, rgba(255,255,255,.72)); }
    .cr-vfield__wrap { display: flex; align-items: center; gap: 6px; }
    .cr-vfield__in { width: 100%; min-width: 0; padding: 8px 10px; border-radius: 9px; font-size: 14px; font-weight: 600;
      font-variant-numeric: tabular-nums; background: rgba(10, 8, 20, 0.6); border: 1px solid rgba(168, 85, 247, 0.22);
      color: var(--text-primary, #fff); outline: none; }
    .cr-vfield__in:focus { border-color: rgba(168, 85, 247, 0.55); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.16); }
    .cr-vfield__wrap em { font-style: normal; font-size: 10.5px; color: var(--text-muted, rgba(255,255,255,.4)); white-space: nowrap; }
    .cr-vfield--flag .cr-vfield__in { border-color: rgba(245, 158, 11, 0.6); color: #fbbf24; }

    .cr-text, .cr-in { width: 100%; padding: 9px 11px; border-radius: 9px; font-size: 13px; background: rgba(10, 8, 20, 0.6);
      border: 1px solid rgba(168, 85, 247, 0.22); color: var(--text-primary, #fff); outline: none; font-family: inherit; }
    .cr-text { resize: vertical; }
    .cr-text:focus, .cr-in:focus { border-color: rgba(168, 85, 247, 0.55); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.16); }
    .cr-text:disabled, .cr-in:disabled, .cr-vfield__in:disabled { opacity: .7; }

    .cr-rx { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; }
    .cr-rx + .cr-rx { border-top: 1px solid rgba(168, 85, 247, 0.14); }
    .cr-rx__row { display: grid; grid-template-columns: 84px minmax(0, 1fr) 70px auto; gap: 6px; align-items: center; }
    .cr-rx__x { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9999px; border: none; background: transparent; color: var(--text-muted, rgba(255,255,255,.4)); cursor: pointer; }
    @media (hover: hover) { .cr-rx__x:hover { color: #f87171; background: rgba(239, 68, 68, 0.12); } }
    .cr-add { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px;
      padding: 9px; border-radius: 10px; border: 1px dashed rgba(168, 85, 247, 0.35); background: transparent;
      color: var(--text-tertiary, rgba(255,255,255,.55)); font-size: 12.5px; font-weight: 600; cursor: pointer; }
    @media (hover: hover) { .cr-add:hover { color: #fff; background: rgba(168, 85, 247, 0.1); } }
    .cr-follow { display: block; max-width: 220px; }

    .cr-missing { padding: 60px 0; text-align: center; font-size: 13px; color: var(--text-tertiary); }
    @media (max-width: 640px) {
      :host .cr-text, :host .cr-in, :host .cr-vfield__in { font-size: 16px; }
      .crb__meta { display: none; }
      .crb__btn { padding: 0 10px; }
    }
    @media (pointer: coarse) { :host .crb__btn { min-height: 40px; } :host .cr-rx__x { width: 38px; height: 38px; } }
  `]
})
export class ConsultRoomComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly toasts = inject(ToastService);

  readonly c = signal<Consultation | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  /** The running save is "Complete consult" (vs "Save draft"): which button shows busy. */
  readonly completing = signal(false);
  readonly dirty = signal(false);
  readonly readonly = computed(() => {
    const s = this.c()?.status;
    return s === 'done' || s === 'cancelled';
  });

  /** Consult entries injected into the journey's LEFT rail. */
  readonly consultNav = [
    { id: 'vitals', label: 'Vitals', kind: 'Consult' },
    { id: 'notes', label: 'Notes & diagnosis', kind: 'Consult' },
    { id: 'rx', label: 'Prescription', kind: 'Consult' },
  ];
  readonly pane = signal<'vitals' | 'notes' | 'rx' | null>(null);
  onPane(id: string | null) { this.pane.set(id as 'vitals' | 'notes' | 'rx' | null); }

  readonly vitals = signal<Vitals>({});
  readonly complaint = signal('');
  readonly diagnosis = signal('');
  readonly advice = signal('');
  readonly rx = signal<RxLine[]>([]);
  readonly followUp = signal('0');

  /** In-room sanity bands — amber highlight, never a block. */
  readonly vitalFields: VitalField[] = [
    { key: 'bpSys', label: 'BP systolic', unit: 'mmHg', lo: 90, hi: 140 },
    { key: 'bpDia', label: 'BP diastolic', unit: 'mmHg', lo: 60, hi: 90 },
    { key: 'pulse', label: 'Pulse', unit: '/min', lo: 60, hi: 100 },
    { key: 'spo2', label: 'SpO₂', unit: '%', lo: 94 },
    { key: 'tempF', label: 'Temp', unit: '°F', lo: 96.5, hi: 99.5 },
    { key: 'rr', label: 'Resp rate', unit: '/min', lo: 12, hi: 20 },
    { key: 'weightKg', label: 'Weight', unit: 'kg' },
    { key: 'heightCm', label: 'Height', unit: 'cm' },
  ];
  readonly freqOpts: PfSelectOption[] = ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', 'SOS', 'HS', 'Weekly']
    .map(v => ({ value: v, label: v }));
  readonly followOpts: PfSelectOption[] = [
    { value: '0', label: 'No follow-up' },
    { value: '3', label: 'After 3 days' },
    { value: '7', label: 'After 1 week' },
    { value: '14', label: 'After 2 weeks' },
    { value: '30', label: 'After 1 month' },
  ];

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.loading.set(false); return; }
    this.api.get<Consultation>(`/api/opd/consultations/${id}`).subscribe({
      next: cc => {
        this.loading.set(false);
        if (!cc) return;
        this.hydrate(cc);
        // Opening a waiting consult starts it — the queue shows "In consult".
        if (cc.status === 'waiting') {
          this.api.patch<Consultation>(`/api/opd/consultations/${cc.id}`, { status: 'in_consult' }).subscribe({
            next: up => { if (up) this.c.set(up); },
            error: () => { /* non-blocking */ },
          });
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private hydrate(cc: Consultation) {
    this.c.set(cc);
    try { this.vitals.set(cc.vitalsJson ? JSON.parse(cc.vitalsJson) as Vitals : {}); } catch { this.vitals.set({}); }
    this.complaint.set(cc.complaintText ?? '');
    this.diagnosis.set(cc.diagnosisText ?? '');
    this.advice.set(cc.adviceText ?? '');
    try { this.rx.set(cc.prescriptionJson ? JSON.parse(cc.prescriptionJson) as RxLine[] : []); } catch { this.rx.set([]); }
    this.followUp.set(String(cc.followUpDays ?? 0));
    this.dirty.set(false);
  }

  vitalFlagged(f: VitalField): boolean {
    const v = this.vitals()[f.key];
    if (v == null || v === ('' as unknown)) return false;
    const n = Number(v);
    if (Number.isNaN(n)) return false;
    return (f.lo != null && n < f.lo) || (f.hi != null && n > f.hi);
  }
  setVital(key: keyof Vitals, v: number | null) {
    this.vitals.update(x => ({ ...x, [key]: v === null || (v as unknown) === '' ? null : Number(v) }));
    this.dirty.set(true);
  }

  addRx() {
    this.rx.update(rows => [...rows, { drug: '', dose: '', frequency: '1-0-1', durationDays: 5, instructions: '' }]);
    this.dirty.set(true);
  }
  removeRx(i: number) { this.rx.update(rows => rows.filter((_, k) => k !== i)); this.dirty.set(true); }
  setRx(i: number, key: keyof RxLine, v: unknown) {
    this.rx.update(rows => rows.map((r, k) => k === i ? { ...r, [key]: v } : r));
    this.dirty.set(true);
  }

  save(complete: boolean) {
    const cc = this.c();
    if (!cc || this.saving()) return;
    const cleanVitals = Object.fromEntries(Object.entries(this.vitals()).filter(([, v]) => v != null && (v as unknown) !== ''));
    const cleanRx = this.rx().filter(r => r.drug.trim());
    this.completing.set(complete);
    this.saving.set(true);
    this.api.patch<Consultation>(`/api/opd/consultations/${cc.id}`, {
      vitalsJson: JSON.stringify(cleanVitals),
      complaintText: this.complaint(),
      diagnosisText: this.diagnosis(),
      adviceText: this.advice(),
      prescriptionJson: JSON.stringify(cleanRx),
      followUpDays: Number(this.followUp()) || 0,
      status: complete ? 'done' : null,
    }).subscribe({
      next: up => {
        this.saving.set(false);
        if (!up) { this.toasts.error('Could not save the consultation'); return; }
        if (complete) {
          this.toasts.success('Consultation completed');
          this.back();
        } else {
          this.hydrate(up);
          this.toasts.success('Draft saved');
        }
      },
      error: () => {
        this.saving.set(false);
        this.toasts.error('Could not save the consultation');
      },
    });
  }

  back() { this.navBack.backTo('/doctor'); }
}
