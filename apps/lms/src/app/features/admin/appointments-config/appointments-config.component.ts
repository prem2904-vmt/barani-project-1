import { SettingsSavebarComponent } from '../../../shared/components/setting-row/settings-savebar.component';
import { SettingGroupComponent, SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
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
  imports: [SettingsSavebarComponent, SettingRowComponent, SettingGroupComponent, BusyDirective, RouterLink, SkeletonFormComponent, FormsModule, ScreenHeaderComponent, TouchButtonComponent, NumberInputComponent, HeroBandComponent, SegmentedComponent, PfTimeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Page is fluid; guard against any accidental horizontal overflow only. */
    :host { display: block; width: 100%; }
    /* ── ND audit: kit cards + neutral mode tiles ── */
    .pf-ap-to { font-size: 12.5px; color: var(--text-tertiary); }
    :host-context(.pf-sgrid) { display: contents; }
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
            @if (!hosted) {
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving() || !cfg()" [pfBusy]="saving()" pfBusyLabel="Saving…"
                    (click)="save()" aria-label="Save" title="Save">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <path d="M17 21v-8H7v8M7 3v5h8"/>
              </svg>
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
            }
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

      <div class="pf-band-body" [class.pf-sgrid]="hosted">
      @if (!cfg()) {
        <pf-skeleton-form [fields]="6" label="Loading appointment settings…"></pf-skeleton-form>
      } @else {
        @if (showSec('mode')) {
        <pf-setting-group class="pf-ap-card" id="mode" label="Queue mode" scope="this branch" icon="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01">
          @if (homeCollectionRuns()) {
            <p class="pf-ap-hint pf-ap-hc" data-testid="ap-hc-note">
              This branch's queue runs as <strong>home collection</strong> visits. Pick a queue mode to switch it back, or
              manage it in <a class="pf-ap-link" [routerLink]="homeCollectionPath">Lab › Home collection</a>.
            </p>
          }
          <pf-setting-row label="How patients are called" [hint]="modeDesc()">
            <pf-segmented size="sm" ariaLabel="Queue mode" [options]="modeSeg()" [value]="cfg()!.queueMode" (valueChange)="setMode($any($event))"></pf-segmented>
          </pf-setting-row>
          @if (hosted) { <pf-settings-savebar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()"></pf-settings-savebar> }
        </pf-setting-group>
        }

        @if (showSec('slots')) {
        <pf-setting-group class="pf-ap-card" id="slots" label="Booking slots" scope="this branch" icon="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM8 3v4M16 3v4M3 10h18">
          <pf-setting-row label="Time between appointments" hint="Minutes per slot.">
            <pf-number-input [value]="cfg()!.slotMinutes" [step]="5" [min]="5" [max]="240" suffix="min"
              (valueChange)="patch({ slotMinutes: $event ?? 30 })"></pf-number-input>
          </pf-setting-row>
          <pf-setting-row label="Concurrent slots" hint="Patients booked into the same slot.">
            <pf-number-input [value]="cfg()!.maxConcurrentSlots" [step]="1" [min]="1"
              (valueChange)="patch({ maxConcurrentSlots: $event ?? 1 })"></pf-number-input>
          </pf-setting-row>
          <pf-setting-row label="Open 24×7" [hint]="cfg()!.open24h ? 'Booking any time of day.' : 'Booking from ' + startTime() + ' to ' + endTime() + ', every day.'">
            <button type="button" class="pf-toggle" role="switch" aria-label="Open 24×7" [attr.aria-checked]="cfg()!.open24h"
                    (click)="patch({ open24h: !cfg()!.open24h })">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
          </pf-setting-row>
          @if (!cfg()!.open24h) {
            <pf-setting-row label="Opening hours">
              <pf-time label="Start time" [value]="startTime()" (valueChange)="setStart($event)"></pf-time>
              <span class="pf-ap-to">to</span>
              <pf-time label="End time" [value]="endTime()" (valueChange)="setEnd($event)"></pf-time>
            </pf-setting-row>
          }
          @if (hosted) { <pf-settings-savebar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()"></pf-settings-savebar> }
        </pf-setting-group>
        }

        @if (showSec('priority')) {
        <pf-setting-group class="pf-ap-card" id="priority" label="Priority engine" scope="this branch" icon="M3 12h4l3-9 4 18 3-9h4"
                          hint="Higher score is called sooner: base + minutes waited × weight − late penalty; urgent jumps to the top.">
          @for (f of optionFields; track f.key) {
            <pf-setting-row [label]="f.label">
              <pf-number-input [value]="opt(f.key)" [step]="f.step" [min]="0" (valueChange)="patchOpt(f.key, $event ?? 0)"></pf-number-input>
            </pf-setting-row>
          }
          @if (hosted) { <pf-settings-savebar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()"></pf-settings-savebar> }
        </pf-setting-group>
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
    // In the Settings shell every section is a group card on the one page (a department may pin some via `tabs`).
    if (this.hosted) { const t = this.tabs(); return !t || t.includes(key); }
    return !this.theme.isNewDesign() || this.tab() === key;
  }

  /** Home collection is no longer a queue mode here — it moved to Lab › Home
   *  collection (same server setting, `queueMode: 'home_collection'`). */
  readonly modes = computed(() => MODES);
  readonly modeSeg = computed(() => MODES.map((m) => ({ value: m.value, label: m.label })));
  readonly modeDesc = computed(() => MODES.find((m) => m.value === this.cfg()?.queueMode)?.desc ?? '');
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
    this.svc.getConfig().subscribe({ next: c => { this._cfg.set(c); this.hydrateHours(c); this.baseline.set(this.snapshot()); } });
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
    return this._cfg()?.queueOptions?.[key] ?? 0;
  }
  patchOpt(key: keyof AppointmentConfig['queueOptions'], value: number) {
    const cur = this._cfg();
    if (cur) this._cfg.set({ ...cur, queueOptions: { ...cur.queueOptions, [key]: value } });
  }

  // ── Unsaved changes: the group card's Save bar (owner: Save sits in the pane, never the band) ──
  private snapshot(): string { return JSON.stringify([this._cfg(), this._startTime(), this._endTime()]); }
  private readonly baseline = signal('');
  readonly dirty = computed(() => !!this._cfg() && this.snapshot() !== this.baseline());
  readonly unsavedLabel = 'the front desk settings';
  hasUnsavedChanges(): boolean { return this.dirty(); }
  discard(): void {
    const b = this.baseline();
    if (!b) return;
    const [c] = JSON.parse(b);
    this._cfg.set(c); this.hydrateHours(c);
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
      next: c => { this._cfg.set(c); this.hydrateHours(c); this.baseline.set(this.snapshot()); this._saving.set(false); this.toast.success('Saved.'); },
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
