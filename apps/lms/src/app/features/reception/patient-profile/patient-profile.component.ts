import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface ProfilePayload {
  patient: Patient;
  history: Order[];
}

@Component({
  selector: 'pf-patient-profile',
  standalone: true,
  imports: [
    SlideOverComponent,
    DatePipe,
    AvatarComponent,
    ChipComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-slide-over
      [open]="open"
      eyebrow="Reception"
      title="Patient profile"
      subtitle="Contact details, identifiers, and past visits."
      (closed)="closed.emit()">

      @if (patient(); as p) {
        <div class="space-y-5">
          <!-- Hero card: avatar + name + vitals chip row -->
          <pf-tile tone="violet" padding="lg" class="block">
            <div class="flex items-center gap-4">
              <pf-avatar [name]="p.name" [size]="56"></pf-avatar>
              <div class="min-w-0 flex-1">
                <p class="text-[18px] font-semibold leading-tight truncate"
                   style="color: var(--text-primary);">{{ p.name }}</p>
                <p class="text-[12px] font-mono mt-1"
                   style="color: var(--text-tertiary);">
                  {{ p.sex ?? '—' }} · {{ p.age ?? '—' }}y
                  @if (p.phone) { · {{ p.phone }} }
                </p>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-4">
              @if (p.abhaId) {
                <pf-chip tone="sky" size="sm">ABHA · {{ p.abhaId }}</pf-chip>
              }
              @if (p.isMinor) {
                <pf-chip tone="amber" size="sm">Minor</pf-chip>
              }
              @if (p.hasKnownAllergies) {
                <pf-chip tone="rose" size="sm">Allergies</pf-chip>
              }
              @if (p.email) {
                <pf-chip tone="default" size="sm">{{ p.email }}</pf-chip>
              }
            </div>
          </pf-tile>

          <!-- Primary actions -->
          <div class="grid grid-cols-2 gap-2">
            <pf-touch-btn variant="primary" size="md" [full]="true" (pressed)="startOrder.emit(p)">
              <span icon-left aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5v14"/>
                  <path d="M5 12h14"/>
                </svg>
              </span>
              New order
            </pf-touch-btn>
            <pf-touch-btn variant="secondary" size="md" [full]="true" (pressed)="bookAppointment.emit(p)">
              <span icon-left aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
              </span>
              Book appointment
            </pf-touch-btn>
          </div>

          <!-- Visit history -->
          <div>
            <div class="flex items-center gap-2 mb-3 px-1">
              <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                    style="color: var(--text-muted);">Visit history</span>
              <span class="text-[11px] font-mono"
                    style="color: var(--text-muted);">· {{ history().length }}</span>
            </div>

            @if (loading()) {
              <div class="space-y-2">
                @for (i of [0,1,2]; track i) {
                  <pf-tile tone="default" padding="md">
                    <pf-skeleton variant="line" width="55%"></pf-skeleton>
                    <div class="mt-2"><pf-skeleton variant="line" width="80%" height="10px"></pf-skeleton></div>
                  </pf-tile>
                }
              </div>
            } @else if (history().length === 0) {
              <pf-tile tone="default" padding="lg">
                <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
                  No previous visits.
                </p>
              </pf-tile>
            } @else {
              <div class="space-y-2">
                @for (o of history(); track o.id) {
                  <pf-tile tone="default" padding="md">
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <p class="text-[13.5px] font-semibold"
                           style="color: var(--text-primary);">
                          {{ o.createdAt | date:'MMM d, y' }}
                        </p>
                        <p class="text-[11.5px] font-mono mt-0.5"
                           style="color: var(--text-tertiary);">
                          {{ o.priority }} · {{ o.collectionType }}
                          @if (o.id) { · #{{ o.id.slice(0, 8) }} }
                        </p>
                      </div>
                      <pf-chip [tone]="statusTone(o.status)" size="sm">{{ o.status }}</pf-chip>
                    </div>
                  </pf-tile>
                }
              </div>
            }
          </div>
        </div>
      } @else {
        <pf-tile tone="default" padding="lg">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
            Select a patient.
          </p>
        </pf-tile>
      }

      <ng-container footer>
        <div class="flex justify-end gap-2 w-full">
          <pf-touch-btn size="sm" variant="ghost" (pressed)="closed.emit()">Close</pf-touch-btn>
        </div>
      </ng-container>
    </pf-slide-over>
  `
})
export class PatientProfileComponent {
  private readonly api = inject(ApiService);

  @Input() open = false;
  @Output() closed = new EventEmitter<void>();
  @Output() startOrder = new EventEmitter<Patient>();
  @Output() bookAppointment = new EventEmitter<Patient>();

  private readonly _patient = signal<Patient | null>(null);
  private readonly _history = signal<Order[]>([]);
  private readonly _loading = signal(false);
  readonly patient = this._patient.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();

  @Input() set patientId(id: string | null | undefined) {
    if (!id || !this.open) return;
    this.load(id);
  }

  statusTone(status: string): ChipTone {
    switch (status) {
      case 'completed':   return 'emerald';
      case 'cancelled':   return 'rose';
      case 'in_progress': return 'violet';
      default:            return 'amber';
    }
  }

  private load(id: string) {
    this._loading.set(true);
    this.api.get<ProfilePayload>(`/api/patients/${id}`).subscribe({
      next: res => {
        this._patient.set(res.patient);
        this._history.set(res.history ?? []);
        this._loading.set(false);
      },
      error: () => this._loading.set(false)
    });
  }
}
