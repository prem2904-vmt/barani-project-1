import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
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
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { RouterLink } from '@angular/router';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { PfTimeComponent } from '../../../shared/components/pf-time/pf-time.component';
import { bindTabQuery, injectSettingsHosted } from '../../../shared/utils/settings-host';

/** Band pill tabs — one per section card. */
export type AppointmentsTab = 'mode' | 'slots' | 'priority';

interface ModeOption { value: QueueMode; label: string; desc: string }

const MODES: ModeOption[] = [
  { value: 'token_queue', label: 'Token queue', desc: 'Patients check in, get a token, and are called by priority. Full real-time queue board.' },
  { value: 'walk_up', label: 'Walk-up', desc: 'No formal queue — patients served roughly first-come. The board is a simple "who\'s here" list.' },
];

/** The mode the Home collection setting turns on (Lab › Home collection owns it). */
export const HOME_COLLECTION_MODE: QueueMode = 'home_collection';

@Component({
  selector: 'pf-appointments-config',
  standalone: true,
  imports: [BusyDirective, RouterLink, SkeletonFormComponent, FormsModule, ScreenHeaderComponent, TouchButtonComponent, NumberInputComponent, HeroBandComponent, SegmentedComponent, PfTimeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Page is fluid; guard against any accidental horizontal overflow only. */
    :host { display: block; width: 100%; }
    /* ── ND audit: kit cards + neutral mode tiles ── */
    .pf-ap-card { margin-bottom: 16px; }
    .pf-ap-card .pf-section-title { margin: 0; }
    .pf-ap-body { padding: 16px 18px 18px; }
    .pf-ap-hint { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--text-tertiary); }
    .pf-ap-hc { padding-bottom: 0; }
    .pf-ap-link { color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; }
    .pf-ap-hint--top { margin: 0 0 12px; }
    .pf-mode-btn {
      display: flex; flex-direction: column; gap: 4px; height: 100%; padding: 12px 14px;
      border-radius: var(--pf-radius); border: 1px solid var(--pf-line); background: var(--pf-card-bg);
      cursor: pointer; transition: border-color var(--pf-dur-fast) ease, background var(--pf-dur-fast) ease;
    }
    .pf-mode-btn:hover { border-color: var(--pf-sel-border); }
    .pf-mode-btn[aria-checked='true'] { background: var(--pf-sel-bg); border-color: var(--pf-sel-border); }
    .pf-mode-btn:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-mode-btn__t { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-mode-btn__d { font-size: 12px; line-height: 1.45; color: var(--text-tertiary); }

    /* Touch: the "Open 24×7" slate switch row is a >=44px tap zone. */
    @media (pointer: coarse) {
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
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions()" [value]="tab()"
                          (valueChange)="tab.set($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving() || !cfg()" [pfBusy]="saving()" pfBusyLabel="Saving…"
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
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving() || !cfg()" [busy]="saving()" busyLabel="Saving…" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      @if (!cfg()) {
        <pf-skeleton-form [fields]="6" label="Loading appointment settings…"></pf-skeleton-form>
      } @else {
        @if (showSec('mode')) {
        <!-- Queue mode -->
        <section class="pf-card pf-ap-card">
          <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span><h3 class="pf-card__label pf-section-title">Queue mode</h3></div>
          @if (homeCollectionRuns()) {
            <p class="pf-ap-hint pf-ap-body pf-ap-hc" data-testid="ap-hc-note">
              This branch's queue runs as <strong>home collection</strong> visits. Pick a queue mode below to switch it back, or
              manage home collection in <a class="pf-ap-link" [routerLink]="homeCollectionPath">Lab › Home collection</a>.
            </p>
          }
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pf-ap-body" role="radiogroup" aria-label="Queue mode">
            @for (m of modes(); track m.value) {
              <!-- Neutral selected tile (PF-PATTERN §3), never a violet tile. -->
              <button type="button" class="pf-mode-btn pf-tile-sel text-left" role="radio"
                      [attr.aria-checked]="cfg()!.queueMode === m.value" (click)="setMode(m.value)">
                <span class="pf-mode-btn__t">{{ m.label }}</span>
                <span class="pf-mode-btn__d">{{ m.desc }}</span>
              </button>
            }
          </div>
        </section>

        }

        @if (showSec('slots')) {
        <!-- Slot config -->
        <section class="pf-card pf-ap-card">
          <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></span><h3 class="pf-card__label pf-section-title">Booking slots</h3></div>
          <div class="pf-ap-body">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="flex flex-col gap-1">
              <span class="pf-field__lbl">Time between appointments (min)</span>
              <pf-number-input [value]="cfg()!.slotMinutes" [step]="5" [min]="5" [max]="240"
                (valueChange)="patch({ slotMinutes: $event ?? 30 })"></pf-number-input>
            </label>
            <label class="flex flex-col gap-1">
              <span class="pf-field__lbl">Concurrent slots</span>
              <pf-number-input [value]="cfg()!.maxConcurrentSlots" [step]="1" [min]="1"
                (valueChange)="patch({ maxConcurrentSlots: $event ?? 1 })"></pf-number-input>
            </label>
            <div class="pf-check-row flex items-center sm:mt-6">
              <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="cfg()!.open24h"
                      (click)="patch({ open24h: !cfg()!.open24h })">
                <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                <span>Open 24×7</span>
              </button>
            </div>
          </div>

          @if (!cfg()!.open24h) {
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <label class="flex flex-col gap-1">
                <span class="pf-field__lbl">Start time</span>
                <pf-time label="Start time" [value]="startTime()"
                  (valueChange)="setStart($event)"></pf-time>
              </label>
              <label class="flex flex-col gap-1">
                <span class="pf-field__lbl">End time</span>
                <pf-time label="End time" [value]="endTime()"
                  (valueChange)="setEnd($event)"></pf-time>
              </label>
            </div>
            <p class="pf-ap-hint">
              Booking is open every day from <span class="pf-num">{{ startTime() }}</span> to <span class="pf-num">{{ endTime() }}</span>,
              in <span class="pf-num">{{ cfg()!.slotMinutes }}</span>-minute steps.
            </p>
          }
          </div>
        </section>

        }

        @if (showSec('priority')) {
        <!-- Priority engine -->
        <section class="pf-card pf-ap-card">
          <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></span><h3 class="pf-card__label pf-section-title">Priority engine</h3></div>
          <div class="pf-ap-body">
          <p class="pf-ap-hint pf-ap-hint--top">
            Higher score = called sooner. score = base(type) + minutes&nbsp;waited × weight − late penalty; urgent jumps to the top.
          </p>
          <div class="pf-priority-grid grid grid-cols-2 sm:grid-cols-3 gap-3">
            @for (f of optionFields; track f.key) {
              <label class="flex flex-col gap-1">
                <span class="pf-field__lbl">{{ f.label }}</span>
                <pf-number-input [value]="opt(f.key)" [step]="f.step" [min]="0"
                  (valueChange)="patchOpt(f.key, $event ?? 0)"></pf-number-input>
              </label>
            }
          </div>
          </div>
        </section>
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
  private readonly allTabOptions: SegmentedOption<AppointmentsTab>[] = [
    { value: 'mode', label: 'Queue mode' },
    { value: 'slots', label: 'Booking slots' },
    { value: 'priority', label: 'Priority engine' },
  ];
  /** Settings re-home: a department's Front desk shows only some of the cards (OPD: Booking slots), so it pins the
   *  tabs here. Unset = all three, exactly as before. */
  readonly tabs = input<AppointmentsTab[] | null>(null);
  readonly tabOptions = computed(() => { const t = this.tabs(); return t ? this.allTabOptions.filter(o => t.includes(o.value)) : this.allTabOptions; });
  readonly tab = signal<AppointmentsTab>('mode');
  protected readonly hosted = injectSettingsHosted();
  private readonly followTab = bindTabQuery(['mode', 'slots', 'priority'] as const, (t) => this.tab.set(t));
  private readonly pinFirstTab = effect(() => { const t = this.tabs(); if (t?.length && !t.includes(this.tab())) this.tab.set(t[0]); });
  showSec(key: AppointmentsTab): boolean {
    return !this.theme.isNewDesign() || this.tab() === key;
  }

  /** Home collection is no longer a queue mode here — it moved to Lab › Home
   *  collection (same server setting, `queueMode: 'home_collection'`). */
  readonly modes = computed(() => MODES);
  protected readonly homeCollectionPath = LAB_PAGES.homeCollection.path;
  /** The stored mode is the home-collection one: say so instead of showing nothing selected. */
  readonly homeCollectionRuns = computed(() => this.cfg()?.queueMode === HOME_COLLECTION_MODE);
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

  setStart(v: string | null) { if (v) this._startTime.set(v); }
  setEnd(v: string | null) { if (v) this._endTime.set(v); }

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
