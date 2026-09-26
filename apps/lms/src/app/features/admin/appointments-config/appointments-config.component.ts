import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { AppointmentConfig, QueueMode } from '../../../shared/models/appointment.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';
import { SettingsJumpComponent, SettingsSection } from '../../../shared/components/settings-page/settings-jump.component';
import { SettingAnchorDirective } from '../../../shared/components/settings-page/setting-anchor.directive';

/** Queue type: 3 short choices (a segmented radiogroup) + ONE help line each. */
const MODES: Array<SegmentedOption<QueueMode> & { help: string }> = [
  { value: 'token_queue', label: 'Token', help: 'Patients get a token and are called in order.' },
  { value: 'walk_up', label: 'Walk-in', help: 'No tokens. Serve people as they come.' },
  { value: 'home_collection', label: 'Home visits', help: 'Visits are ordered by their booked time.' },
];

@Component({
  selector: 'pf-appointments-config',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, TouchButtonComponent, NumberInputComponent, HeroBandComponent, SegmentedComponent, SettingsJumpComponent, SettingAnchorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; width: 100%; }
    .pf-ap-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .pf-ap-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 28rem; }
    .pf-ap-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    @media (max-width: 640px) {
      .pf-ap-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 379px) {
      .pf-ap-grid, .pf-ap-grid--2 { grid-template-columns: minmax(0, 1fr); }
    }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- ONE scrolling page (ND-PATTERN §19): no pill tabs; Save rides the band. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <h1 class="nd-band-page">Appointments &amp; queue</h1>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving() || !cfg()"
                    (click)="save()" aria-label="Save" title="Save">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <path d="M17 21v-8H7v8M7 3v5h8"/>
              </svg>
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Appointments & queue"
        subtitle="Queue type, booking slots and who goes next.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving() || !cfg()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      @if (!cfg()) {
        <p class="pf-band-empty">Loading…</p>
      } @else {
      <div class="nd-setpage nd-setpage--jump">
        <pf-settings-jump [sections]="sections"></pf-settings-jump>
        <div class="nd-setcol">

        <!-- Queue -->
        <section class="nd-card nd-setsec" id="sec-queue" aria-labelledby="sec-queue-h">
          <div class="nd-card__head"><span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span><h2 class="nd-card__label" id="sec-queue-h">Queue</h2></div>
          <div class="nd-set" pfSettingAnchor="queue-mode">
            <div class="nd-set__text">
              <span class="nd-set__label" id="queue-mode-l">Queue type</span>
              <p class="nd-set__help">{{ modeHelp() }}</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" [options]="modes" [value]="cfg()!.queueMode" ariaLabelledby="queue-mode-l"
                            (valueChange)="setMode($event)"></pf-segmented>
            </div>
          </div>
        </section>

        <!-- Booking -->
        <section class="nd-card nd-setsec" id="sec-booking" aria-labelledby="sec-booking-h">
          <div class="nd-card__head"><span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></span><h2 class="nd-card__label" id="sec-booking-h">Booking</h2></div>
          <div class="nd-set" pfSettingAnchor="booking-slots">
            <div class="nd-set__text">
              <span class="nd-set__label">Booking slots</span>
              <p class="nd-set__help">Slot length and patients per slot.</p>
            </div>
            <div class="nd-set__ctl pf-ap-grid pf-ap-grid--2">
              <label class="pf-ap-field">
                <span class="nd-field__lbl">Minutes per slot</span>
                <pf-number-input [value]="cfg()!.slotMinutes" [step]="5" [min]="5" [max]="240"
                  (valueChange)="patch({ slotMinutes: $event ?? 30 })"></pf-number-input>
              </label>
              <label class="pf-ap-field">
                <span class="nd-field__lbl">Patients per slot</span>
                <pf-number-input [value]="cfg()!.maxConcurrentSlots" [step]="1" [min]="1"
                  (valueChange)="patch({ maxConcurrentSlots: $event ?? 1 })"></pf-number-input>
              </label>
            </div>
          </div>
          <div class="nd-set">
            <div class="nd-set__text">
              <span class="nd-set__label" id="open24-l">Open all day, every day</span>
              <p class="nd-set__help">Off lets you set opening hours.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="cfg()!.open24h" aria-labelledby="open24-l"
                      (click)="patch({ open24h: !cfg()!.open24h })">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              </button>
            </div>
          </div>
          @if (!cfg()!.open24h) {
            <div class="nd-set nd-set--sub">
              <div class="nd-set__text">
                <span class="nd-set__label">Opening hours</span>
                <p class="nd-set__help">Same hours every day.</p>
              </div>
              <div class="nd-set__ctl pf-ap-grid pf-ap-grid--2">
                <div class="pf-ap-field">
                  <label class="nd-field__lbl" for="ap-start">Opens at</label>
                  <input id="ap-start" type="time" class="nd-input nd-num" [value]="startTime()"
                    (change)="setStart($any($event.target).value)" />
                </div>
                <div class="pf-ap-field">
                  <label class="nd-field__lbl" for="ap-end">Closes at</label>
                  <input id="ap-end" type="time" class="nd-input nd-num" [value]="endTime()"
                    (change)="setEnd($any($event.target).value)" />
                </div>
              </div>
            </div>
          }
        </section>

        <!-- Who goes next -->
        <section class="nd-card nd-setsec" id="sec-priority" aria-labelledby="sec-priority-h">
          <div class="nd-card__head"><span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></span><h2 class="nd-card__label" id="sec-priority-h">Who goes next</h2></div>
          <div class="nd-set" pfSettingAnchor="priority">
            <div class="nd-set__text">
              <span class="nd-set__label">Priority points</span>
              <p class="nd-set__help">Most points is called first. Urgent always goes first.</p>
            </div>
            <div class="nd-set__ctl nd-set__ctl--wide pf-ap-grid">
              @for (f of optionFields; track f.key) {
                <label class="pf-ap-field">
                  <span class="nd-field__lbl">{{ f.label }}</span>
                  <pf-number-input [value]="opt(f.key)" [step]="f.step" [min]="0"
                    (valueChange)="patchOpt(f.key, $event ?? 0)"></pf-number-input>
                </label>
              }
            </div>
          </div>
        </section>

        </div>
      </div>
      }
      </div>
    </section>
  `
})
export class AppointmentsConfigComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  /** "On this page" jump list (desktop). */
  readonly sections: SettingsSection[] = [
    { id: 'sec-queue', label: 'Queue' },
    { id: 'sec-booking', label: 'Booking' },
    { id: 'sec-priority', label: 'Who goes next' },
  ];

  readonly modes = MODES;
  /** One help line for the chosen queue type. */
  readonly modeHelp = computed(() => MODES.find(m => m.value === this._cfg()?.queueMode)?.help ?? 'How the front desk calls patients.');
  readonly optionFields: { key: keyof AppointmentConfig['queueOptions']; label: string; step: number }[] = [
    { key: 'baseAppointment', label: 'Booked patient points', step: 50 },
    { key: 'baseWalkin', label: 'Walk-in points', step: 50 },
    { key: 'baseFollowup', label: 'Follow-up points', step: 50 },
    { key: 'waitWeight', label: 'Points per minute waiting', step: 1 },
    { key: 'appointmentGraceMinutes', label: 'Late grace (min)', step: 5 },
    { key: 'latePenalty', label: 'Points lost if late', step: 50 },
    { key: 'noShowThresholdMinutes', label: 'No-show after (min)', step: 5 },
    { key: 'avgCollectionMinutes', label: 'Minutes per patient', step: 1 },
    { key: 'urgentOverrideScore', label: 'Urgent points', step: 100 }
  ];

  private readonly _cfg = signal<AppointmentConfig | null>(null);
  private readonly _saving = signal(false);
  readonly cfg = this._cfg.asReadonly();
  readonly saving = this._saving.asReadonly();

  // Daily open window (start → end). Persisted inside the config's
  // weeklyScheduleJson as the same window for every weekday — the booking
  // modal already reads that shape, so no schema/endpoint change is needed.
  private readonly _startTime = signal('09:00');
  private readonly _endTime = signal('17:00');
  readonly startTime = this._startTime.asReadonly();
  readonly endTime = this._endTime.asReadonly();

  ngOnInit() {
    this.svc.getConfig().subscribe({ next: c => { this._cfg.set(c); this.hydrateHours(c); } });
  }

  setStart(v: string) { if (v) this._startTime.set(v); }
  setEnd(v: string) { if (v) this._endTime.set(v); }

  /** Pull a representative start/end from the stored weekly schedule so the
   *  time pickers reflect what's actually saved. Falls back to 09:00–17:00. */
  private hydrateHours(c: AppointmentConfig) {
    const win = firstWindow(c.weeklyScheduleJson);
    if (win) { this._startTime.set(win.from); this._endTime.set(win.to); }
  }

  setMode(m: QueueMode) { this.patch({ queueMode: m }); }

  patch(p: Partial<AppointmentConfig>) {
    const cur = this._cfg();
    if (cur) this._cfg.set({ ...cur, ...p });
  }

  opt(key: keyof AppointmentConfig['queueOptions']): number {
    return this._cfg()?.queueOptions[key] ?? 0;
  }
  patchOpt(key: keyof AppointmentConfig['queueOptions'], value: number) {
    const cur = this._cfg();
    if (cur) this._cfg.set({ ...cur, queueOptions: { ...cur.queueOptions, [key]: value } });
  }

  save() {
    const cur = this._cfg();
    if (!cur) return;

    // Fold the start/end pickers into weeklyScheduleJson (same window every
    // day) when the branch isn't open 24×7. When it is, clear the schedule —
    // the booking modal ignores it and opens the full day.
    const payload: AppointmentConfig = { ...cur };
    if (payload.open24h) {
      payload.weeklyScheduleJson = null;
    } else {
      const from = this._startTime();
      const to = this._endTime();
      if (from >= to) { this.toast.error('End time must be after start time.'); return; }
      const window = [{ from, to }];
      const schedule: Record<string, { from: string; to: string }[]> = {};
      for (const d of DOW_KEYS) schedule[d] = window;
      payload.weeklyScheduleJson = JSON.stringify(schedule);
    }

    this._saving.set(true);
    this.svc.saveConfig(payload).subscribe({
      next: c => { this._cfg.set(c); this.hydrateHours(c); this._saving.set(false); this.toast.success('Saved.'); },
      error: e => { this._saving.set(false); this.toast.error(ApiError.from(e).message); }
    });
  }
}

const DOW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** First open window found in a weekly-schedule JSON blob, or null. Used to
 *  seed the start/end pickers from whatever was previously saved. */
function firstWindow(json?: string | null): { from: string; to: string } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, Array<{ from: string; to: string }>>;
    for (const key of Object.keys(parsed)) {
      const windows = parsed[key];
      if (Array.isArray(windows) && windows.length > 0 && windows[0]?.from && windows[0]?.to) {
        return { from: windows[0].from, to: windows[0].to };
      }
    }
  } catch { /* malformed JSON → fall back to defaults */ }
  return null;
}
