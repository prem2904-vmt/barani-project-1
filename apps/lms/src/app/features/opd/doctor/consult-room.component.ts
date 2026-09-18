import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { PatientTimelineComponent } from '../../frontdesk/patient-profile/patient-timeline.component';
import { Consultation } from './doctor-queue.component';

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
  imports: [FormsModule, SelectComponent, PatientTimelineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="cr-head">
          <button type="button" class="cr-back press" (click)="back()" aria-label="Back to queue">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div class="min-w-0">
            <h1 class="cr-title">{{ c()?.patientName || 'Consultation' }}</h1>
            <p class="cr-sub">{{ c()?.patientInfo || '—' }} · Token {{ c()?.token }} · ₹{{ c()?.fee }}</p>
          </div>
          @if (c(); as cc) {
            <span class="cr-status" [attr.data-status]="cc.status">
              @switch (cc.status) {
                @case ('waiting') { Waiting }
                @case ('in_consult') { In consult }
                @case ('done') { Completed }
                @case ('cancelled') { Cancelled }
              }
            </span>
          }
        </div>
      </header>

      <div class="pf-page__body px-4 md:px-8 lg:px-10 pt-2 pb-2">
        @if (c(); as cc) {
          <div class="cr-grid">
            <!-- ══ The patient's story — journey, files, trends ══ -->
            <main class="cr-journey">
              <pf-patient-timeline [patientId]="cc.patientId" [embedded]="true"></pf-patient-timeline>
            </main>

            <!-- ══ The consult — one panel, tabbed ══ -->
            <aside class="cr-rail">
              <div class="cr-tabs" role="tablist" aria-label="Consult sections">
                @for (t of tabs; track t.key) {
                  <button type="button" class="cr-tab press" role="tab"
                          [class.cr-tab--on]="tab() === t.key" [attr.aria-selected]="tab() === t.key"
                          (click)="tab.set(t.key)">{{ t.label }}</button>
                }
              </div>

              <div class="cr-pane">
                @switch (tab()) {
                  @case ('vitals') {
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
            </aside>
          </div>
        } @else if (!loading()) {
          <div class="cr-missing">Consultation not found.</div>
        }
      </div>

      @if (c(); as cc) {
        <footer class="cr-bar">
          <div class="cr-bar__inner">
            <span class="cr-bar__meta">
              @if (cc.status === 'done') {
                <span class="cr-bar__dot" data-state="done"></span> Completed
              } @else if (dirty()) {
                <span class="cr-bar__dot" data-state="edit"></span> Unsaved changes
              } @else {
                <span class="cr-bar__dot" data-state="ok"></span> Consult in progress
              }
            </span>
            <div class="flex-1"></div>
            @if (!readonly()) {
              <button type="button" class="cr-btn cr-btn--ghost press" [disabled]="saving() || !dirty()" (click)="save(false)">
                {{ saving() ? 'Saving…' : 'Save draft' }}
              </button>
              <button type="button" class="cr-btn cr-btn--primary press" [disabled]="saving()" (click)="save(true)">
                Complete consult
              </button>
            } @else {
              <button type="button" class="cr-btn cr-btn--ghost press" (click)="back()">Back to queue</button>
            }
          </div>
        </footer>
      }
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow: hidden; }
    .pf-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    .pf-page__header { flex: 0 0 auto; }
    .pf-page__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }

    .cr-head { display: flex; align-items: center; gap: 10px; padding: 6px 0 10px; }
    .cr-back { width: 38px; height: 38px; margin-left: -8px; border-radius: 11px; color: var(--text-primary);
      background: transparent; border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    @media (hover: hover) { .cr-back:hover { background: var(--glass-bg, rgba(255,255,255,0.06)); } }
    .cr-title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary); }
    .cr-sub { margin: 2px 0 0; font-size: 12px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-tertiary); }
    .cr-status { margin-left: auto; padding: 4px 12px; border-radius: 9999px; font-size: 10.5px; font-weight: 700;
      letter-spacing: .08em; text-transform: uppercase; border: 1px solid var(--glass-border); color: var(--text-tertiary); }
    .cr-status[data-status='waiting']    { color: #d97706; border-color: rgba(245, 158, 11, 0.35); }
    .cr-status[data-status='in_consult'] { color: var(--violet-text, #c4b5fd); border-color: rgba(168, 85, 247, 0.4); }
    :root.dark .cr-status[data-status='waiting'] { color: #fbbf24; }

    /* ONE screen: the grid fills the page body; only the rail pane and the
       journey's own internals scroll. */
    .pf-page__body { display: flex; }
    .cr-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: stretch; width: 100%; }
    .cr-journey { min-width: 0; min-height: 0; }
    .cr-journey pf-patient-timeline { display: block; height: 100%; }
    .cr-rail { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-radius: 16px;
      border: 1px solid var(--glass-border); background: var(--glass-bg); overflow: hidden; }

    .cr-tabs { flex: 0 0 auto; display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid var(--border-muted); }
    .cr-tab { flex: 1; height: 32px; border-radius: 9999px; border: 1px solid transparent; background: transparent;
      color: var(--text-tertiary); font-size: 12.5px; font-weight: 700; cursor: pointer;
      transition: background .15s, color .15s; }
    .cr-tab--on { background: var(--gradient-primary); color: #fff; }
    @media (hover: hover) { .cr-tab:not(.cr-tab--on):hover { color: var(--text-primary); background: var(--glass-bg-hover); } }

    .cr-pane { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; padding-bottom: 84px; }

    .cr-lbl { display: block; margin: 0 0 8px; font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); }
    .cr-lbl--gap { margin-top: 14px; }
    .cr-empty { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }

    .cr-bar { position: fixed; left: 0; right: 0; bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px)); z-index: 30;
      padding: 0 16px; pointer-events: none; }
    @media (min-width: 1280px) { .cr-bar { bottom: 1rem; } }
    .cr-bar__inner { pointer-events: auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 16px;
      background: var(--bg-card-solid); border: 1px solid var(--glass-border); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px); max-width: 1400px; margin: 0 auto; }
    .cr-bar__meta { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
    .cr-bar__dot { width: 7px; height: 7px; border-radius: 9999px; }
    .cr-bar__dot[data-state='ok']   { background: #a855f7; }
    .cr-bar__dot[data-state='edit'] { background: #8b5cf6; animation: cr-pulse 1.8s infinite; }
    .cr-bar__dot[data-state='done'] { background: var(--text-muted); }
    @keyframes cr-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
    .cr-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 9999px;
      font-size: 13px; font-weight: 600; border: 1px solid transparent; cursor: pointer; white-space: nowrap;
      transition: background .15s, color .15s, box-shadow .25s; }
    .cr-btn:disabled { opacity: .5; cursor: not-allowed; }
    .cr-btn--ghost { background: transparent; color: var(--text-secondary); }
    .cr-btn--ghost:hover:not(:disabled) { background: var(--glass-bg-hover); color: var(--text-primary); }
    .cr-btn--primary { background: var(--gradient-primary); color: #fff; box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4); }
    .cr-btn--primary:hover:not(:disabled) { box-shadow: 0 10px 26px rgba(124, 58, 237, 0.55); }

    .cr-missing { padding: 60px 0; text-align: center; font-size: 13px; color: var(--text-tertiary); }
    @media (max-width: 1199px) {
      .pf-page__body { display: block; overflow-y: auto; }
      .cr-grid { grid-template-columns: minmax(0, 1fr); }
      .cr-journey { height: 58vh; }
      .cr-rail { max-height: none; }
      .cr-pane { overflow: visible; }
    }
    @media (max-width: 640px) {
      :host .cr-text, :host .cr-in, :host .cr-vfield__in { font-size: 16px; }
      :host .pf-page__body { padding-bottom: calc(var(--tab-nav-total-height, 5.75rem) + 150px); }
    }
    @media (pointer: coarse) { :host .cr-btn { min-height: 44px; } :host .cr-rx__x { width: 38px; height: 38px; } }
  `]
})
export class ConsultRoomComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  readonly c = signal<Consultation | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly readonly = computed(() => {
    const s = this.c()?.status;
    return s === 'done' || s === 'cancelled';
  });

  readonly tabs: Array<{ key: 'vitals' | 'notes' | 'rx'; label: string }> = [
    { key: 'vitals', label: 'Vitals' },
    { key: 'notes', label: 'Notes' },
    { key: 'rx', label: 'Prescription' },
  ];
  readonly tab = signal<'vitals' | 'notes' | 'rx'>('vitals');

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

  back() { void this.router.navigate(['/doctor']); }
}
