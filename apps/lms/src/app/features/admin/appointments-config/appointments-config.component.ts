import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { AppointmentConfig, QueueMode } from '../../../shared/models/appointment.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';

interface ModeOption { value: QueueMode; label: string; desc: string }

const MODES: ModeOption[] = [
  { value: 'token_queue', label: 'Token queue', desc: 'Patients check in, get a token, and are called by priority. Full real-time queue board.' },
  { value: 'walk_up', label: 'Walk-up', desc: 'No formal queue — patients served roughly first-come. The board is a simple "who\'s here" list.' },
  { value: 'home_collection', label: 'Home collection', desc: 'Appointments are home-collection visits, ordered by scheduled time rather than a counter queue.' }
];

@Component({
  selector: 'pf-appointments-config',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, TileComponent, TouchButtonComponent, NumberInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-3xl">
      <pf-screen-header
        eyebrow="Admin"
        title="Appointments & queue"
        subtitle="Choose how this branch runs its front desk, and tune the priority engine.">
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving() || !cfg()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      @if (!cfg()) {
        <pf-tile tone="default" padding="lg" class="block"><p style="color: var(--text-tertiary);">Loading…</p></pf-tile>
      } @else {
        <!-- Queue mode -->
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="pf-section-title mb-3">Queue mode</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            @for (m of modes; track m.value) {
              <button type="button" class="text-left" (click)="setMode(m.value)">
                <pf-tile [tone]="cfg()!.queueMode === m.value ? 'violet' : 'default'" padding="md" class="block h-full">
                  <p class="font-semibold text-[14px]" style="color: var(--text-primary);">{{ m.label }}</p>
                  <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">{{ m.desc }}</p>
                </pf-tile>
              </button>
            }
          </div>
        </pf-tile>

        <!-- Slot config -->
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="pf-section-title mb-3">Booking slots</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="flex flex-col gap-1">
              <span class="pf-label">Slot length (min)</span>
              <pf-number-input [value]="cfg()!.slotMinutes" [step]="5" [min]="5" [max]="240"
                (valueChange)="patch({ slotMinutes: $event ?? 30 })"></pf-number-input>
            </label>
            <label class="flex flex-col gap-1">
              <span class="pf-label">Concurrent slots</span>
              <pf-number-input [value]="cfg()!.maxConcurrentSlots" [step]="1" [min]="1"
                (valueChange)="patch({ maxConcurrentSlots: $event ?? 1 })"></pf-number-input>
            </label>
            <label class="flex items-center gap-2 mt-6">
              <input type="checkbox" [checked]="cfg()!.open24h" (change)="patch({ open24h: $any($event.target).checked })" />
              <span class="text-[13px]" style="color: var(--text-secondary);">Open 24×7</span>
            </label>
          </div>
        </pf-tile>

        <!-- Priority engine -->
        <pf-tile tone="default" padding="lg" class="block">
          <h3 class="pf-section-title mb-1">Priority engine</h3>
          <p class="text-[12px] mb-3" style="color: var(--text-tertiary);">
            Higher score = called sooner. score = base(type) + minutes&nbsp;waited × weight − late penalty; urgent jumps to the top.
          </p>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
    </section>
  `
})
export class AppointmentsConfigComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);

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

  ngOnInit() {
    this.svc.getConfig().subscribe({ next: c => this._cfg.set(c) });
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
    this._saving.set(true);
    this.svc.saveConfig(cur).subscribe({
      next: c => { this._cfg.set(c); this._saving.set(false); this.toast.success('Saved.'); },
      error: () => { this._saving.set(false); this.toast.error('Could not save.'); }
    });
  }
}
