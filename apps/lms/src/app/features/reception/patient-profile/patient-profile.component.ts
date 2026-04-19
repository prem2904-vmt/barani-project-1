import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, effect, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';

interface ProfilePayload {
  patient: Patient;
  history: Order[];
}

@Component({
  selector: 'pf-patient-profile',
  standalone: true,
  imports: [SlideOverComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-slide-over [open]="open" [title]="'Patient profile'" (closed)="closed.emit()">
      @if (patient(); as p) {
        <div class="space-y-4">
          <div class="rounded-xl border border-slate-200 p-4 bg-slate-50">
            <p class="text-lg font-semibold text-slate-900">{{ p.name }}</p>
            <div class="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-3">
              <span>{{ p.sex }}</span>
              <span>· {{ p.age }}y</span>
              @if (p.phone) { <span>· {{ p.phone }}</span> }
              @if (p.abhaId) { <span>· ABHA {{ p.abhaId }}</span> }
              @if (p.isMinor) { <span class="text-amber-600 font-medium">· Minor</span> }
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button class="pf-btn pf-btn-primary" (click)="startOrder.emit(p)">New order</button>
            <button class="pf-btn pf-btn-ghost" (click)="bookAppointment.emit(p)">Book appointment</button>
          </div>

          <div>
            <p class="text-xs uppercase tracking-wider text-slate-500 mb-2">Visit history</p>
            @if (loading()) {
              <p class="text-sm text-slate-500">Loading…</p>
            } @else if (history().length === 0) {
              <p class="text-sm text-slate-500">No previous visits.</p>
            } @else {
              <ul class="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                @for (o of history(); track o.id) {
                  <li class="px-3 py-2">
                    <div class="flex items-center justify-between">
                      <span class="text-sm font-medium">{{ o.createdAt | date:'MMM d, y' }}</span>
                      <span class="text-xs px-2 py-0.5 rounded-full"
                            [class.bg-emerald-50]="o.status === 'completed'"
                            [class.text-emerald-700]="o.status === 'completed'"
                            [class.bg-amber-50]="o.status !== 'completed' && o.status !== 'cancelled'"
                            [class.text-amber-700]="o.status !== 'completed' && o.status !== 'cancelled'"
                            [class.bg-slate-100]="o.status === 'cancelled'">
                        {{ o.status }}
                      </span>
                    </div>
                    <p class="text-xs text-slate-500">{{ o.priority }} · {{ o.collectionType }}</p>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      } @else {
        <p class="text-sm text-slate-500">Select a patient.</p>
      }

      <div footer class="flex justify-end">
        <button class="pf-btn pf-btn-ghost" (click)="closed.emit()">Close</button>
      </div>
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

  constructor() {
    // When slide-over opens, also refresh if we have a patient
    effect(() => {
      const p = this._patient();
      if (this.open && p?.id) {
        // nothing special
      }
    });
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
