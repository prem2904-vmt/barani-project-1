import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { AppointmentConfig, QueueMode } from '../../../shared/models/appointment.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';

/** Band pill tabs — one per section card. */
export type AppointmentsTab = 'mode' | 'slots' | 'priority';

interface ModeOption { value: QueueMode; label: string; desc: string }

const MODES: ModeOption[] = [
  { value: 'token_queue', label: 'Token queue', desc: 'Patients check in, get a token, and are called by priority. Full real-time queue board.' },
  { value: 'walk_up', label: 'Walk-up', desc: 'No formal queue — patients served roughly first-come. The board is a simple "who\'s here" list.' },
  { value: 'home_collection', label: 'Home collection', desc: 'Appointments are home-collection visits, ordered by scheduled time rather than a counter queue.' }
];

@Component({
  selector: 'pf-appointments-config',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, TileComponent, TouchButtonComponent, NumberInputComponent, HeroBandComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Page is fluid; guard against any accidental horizontal overflow only. */
    :host { display: block; width: 100%; }

    /* Touch: give the native "Open 24×7" checkbox a comfortable hit target
       without changing its painted size or affecting desktop/mouse users. The
       wrapping label becomes a >=44px tap zone while the painted box grows
       modestly for easier toggling. */
    @media (pointer: coarse) {
      :host input[type='checkbox'] {
        min-width: 22px;
        min-height: 22px;
      }
      :host .pf-check-row {
        min-height: 44px;
      }
    }

    /* Touch: each mode tile is a full-row choice; ensure a tall enough tap
       target on coarse pointers without altering its desktop appearance. */
    @media (pointer: coarse) {
      :host .pf-mode-btn { min-height: 44px; }
    }

    /* Hover affordances only where a real pointer can hover, so taps don't
       leave sticky hover states on touch devices. */
    @media (hover: hover) {
      :host .pf-mode-btn:hover { opacity: 0.95; }
    }

    /* Phone (<=640): the 2-col priority grid can get tight on very narrow
       devices — collapse to a single column below 380px only. Desktop and
       iPad are unaffected (they already use sm:grid-cols-3). */
    @media (max-width: 379px) {
      :host .pf-priority-grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }
    }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): no search — the three sections become tabs in a
             tabs-only pill; Save rides the band actions. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()"
                          (valueChange)="tab.set($event)"></pf-segmented>
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
        subtitle="Choose how this branch runs its front desk, and tune the priority engine.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving() || !cfg()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      @if (!cfg()) {
        <pf-tile tone="default" padding="lg" class="block"><p style="color: var(--text-tertiary);">Loading…</p></pf-tile>
      } @else {
        @if (showSec('mode')) {
        <!-- Queue mode -->
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="pf-section-title mb-3">Queue mode</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            @for (m of modes; track m.value) {
              <button type="button" class="pf-mode-btn text-left" (click)="setMode(m.value)">
                <pf-tile [tone]="cfg()!.queueMode === m.value ? 'violet' : 'default'" padding="md" class="block h-full">
                  <p class="font-semibold text-[14px]" style="color: var(--text-primary);">{{ m.label }}</p>
                  <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">{{ m.desc }}</p>
                </pf-tile>
              </button>
            }
          </div>
        </pf-tile>

        }

        @if (showSec('slots')) {
        <!-- Slot config -->
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="pf-section-title mb-3">Booking slots</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="flex flex-col gap-1">
              <span class="pf-label">Time between appointments (min)</span>
              <pf-number-input [value]="cfg()!.slotMinutes" [step]="5" [min]="5" [max]="240"
                (valueChange)="patch({ slotMinutes: $event ?? 30 })"></pf-number-input>
            </label>
            <label class="flex flex-col gap-1">
              <span class="pf-label">Concurrent slots</span>
              <pf-number-input [value]="cfg()!.maxConcurrentSlots" [step]="1" [min]="1"
                (valueChange)="patch({ maxConcurrentSlots: $event ?? 1 })"></pf-number-input>
            </label>
            <label class="pf-check-row flex items-center gap-2 sm:mt-6">
              <input type="checkbox" [checked]="cfg()!.open24h" (change)="patch({ open24h: $any($event.target).checked })" />
              <span class="text-[13px]" style="color: var(--text-secondary);">Open 24×7</span>
            </label>
          </div>

          @if (!cfg()!.open24h) {
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <label class="flex flex-col gap-1">
                <span class="pf-label">Start time</span>
                <input type="time" class="pf-input" [value]="startTime()"
                  (change)="setStart($any($event.target).value)" />
              </label>
              <label class="flex flex-col gap-1">
                <span class="pf-label">End time</span>
                <input type="time" class="pf-input" [value]="endTime()"
                  (change)="setEnd($any($event.target).value)" />
              </label>
            </div>
            <p class="text-[12px] mt-2" style="color: var(--text-tertiary);">
              Booking is open every day from {{ startTime() }} to {{ endTime() }},
              in {{ cfg()!.slotMinutes }}-minute steps.
            </p>
          }
        </pf-tile>

        }

        @if (showSec('priority')) {
        <!-- Priority engine -->
        <pf-tile tone="default" padding="lg" class="block">
          <h3 class="pf-section-title mb-1">Priority engine</h3>
          <p class="text-[12px] mb-3" style="color: var(--text-tertiary);">
            Higher score = called sooner. score = base(type) + minutes&nbsp;waited × weight − late penalty; urgent jumps to the top.
          </p>
          <div class="pf-priority-grid grid grid-cols-2 sm:grid-cols-3 gap-3">
            @for (f of optionFields; track f.key) {
              <label class="flex flex-col gap-1">
                <span class="pf-label">{{ f.label }}</span>
                <pf-number-input [value]="opt(f.key)" [step]="f.step" [min]="0"
                  (valueChange)="patchOpt(f.key, $event ?? 0)"></pf-number-input>
              </label>
            }
          </div>
        </pf-tile>
        }
      }
      </div>
    </section>
  `
})
export class AppointmentsConfigComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  /** Band pill tabs (new design). Classic shows every card, as before. */
  readonly tabOptions: SegmentedOption<AppointmentsTab>[] = [
    { value: 'mode', label: 'Queue mode' },
    { value: 'slots', label: 'Booking slots' },
    { value: 'priority', label: 'Priority engine' },
  ];
  readonly tab = signal<AppointmentsTab>('mode');
  showSec(key: AppointmentsTab): boolean {
    return !this.theme.isNewDesign() || this.tab() === key;
  }

  readonly modes = MODES;
  readonly optionFields: { key: keyof AppointmentConfig['queueOptions']; label: string; step: number }[] = [
    { key: 'baseAppointment', label: 'Appointment base', step: 50 },
    { key: 'baseWalkin', label: 'Walk-in base', step: 50 },
    { key: 'baseFollowup', label: 'Follow-up base', step: 50 },
    { key: 'waitWeight', label: 'Wait weight / min', step: 1 },
    { key: 'appointmentGraceMinutes', label: 'Grace (min)', step: 5 },
    { key: 'latePenalty', label: 'Late penalty', step: 50 },
    { key: 'noShowThresholdMinutes', label: 'No-show after (min)', step: 5 },
    { key: 'avgCollectionMinutes', label: 'Avg collection (min)', step: 1 },
    { key: 'urgentOverrideScore', label: 'Urgent score', step: 100 }
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
