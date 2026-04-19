import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
import {
  WorkflowRendererComponent,
  splitByStep
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Appointment } from '../../../shared/models/appointment.model';
import { Patient } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import {
  WorkflowConfig,
  WorkflowConfigRecord,
  WorkflowContext,
  WorkflowFormValues
} from '../../../shared/models/workflow.model';

@Component({
  selector: 'pf-book-appointment',
  standalone: true,
  imports: [SlideOverComponent, WorkflowRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-slide-over [open]="open" [title]="'Book appointment'" (closed)="closed.emit()">
      @if (prefillPatient) {
        <div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <p class="font-medium">{{ prefillPatient.name }}</p>
          <p class="text-xs text-slate-500">{{ prefillPatient.phone }} · {{ prefillPatient.sex }} · {{ prefillPatient.age }}y</p>
        </div>
      }
      @if (config(); as cfg) {
        <pf-workflow-renderer
          [config]="cfg"
          [context]="context()"
          [resources]="resources()"
          [submitting]="saving()"
          [finishLabel]="'Book + Send WhatsApp'"
          [initialValues]="initialValues()"
          (valuesChange)="values.set($event)"
          (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
      } @else {
        <p class="text-sm text-slate-500">Loading workflow…</p>
      }

      <div footer>
        <p class="text-xs text-slate-500">
          Config: <code>appointment_booking v{{ record()?.version }}</code>
        </p>
      </div>
    </pf-slide-over>
  `
})
export class BookAppointmentComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  @Input() open = false;
  @Input() prefillPatient: Patient | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() booked = new EventEmitter<Appointment>();

  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _tests = signal<Test[]>([]);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});

  readonly record = this._record.asReadonly();
  readonly config = this._config.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly context = computed<WorkflowContext>(() => {
    const user = this.auth.user();
    const p = this.prefillPatient;
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      patientId: p?.id,
      patientAge: p?.age,
      patientSex: p?.sex
    };
  });

  readonly resources = computed(() => ({
    dataSources: {
      tests: this._tests().map(t => ({ value: t.id, label: `${t.name} — ₹${t.price}` })),
      patients: this.prefillPatient
        ? [{ value: this.prefillPatient.id, label: this.prefillPatient.name }]
        : [],
      doctors: [] as Array<{ value: string; label: string }>,
      available_slots: ['09:00','09:30','10:00','10:30','11:00','11:30','12:00'].map(s => ({ value: s, label: s }))
    }
  }));

  initialValues = computed<WorkflowFormValues>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      'patient::patient_id': this.prefillPatient?.id ?? '',
      'schedule::appointment_date': today
    };
  });

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
    this.api.get<WorkflowConfigRecord>('/api/workflows/appointment_booking').subscribe({
      next: r => { this._record.set(r); try { this._config.set(JSON.parse(r.configJson)); } catch { /* ignore */ } }
    });
  }

  onComplete(values: WorkflowFormValues): void {
    if (this._saving()) return;
    const bySteps = splitByStep(values);
    const patientId = (bySteps['patient']?.['patient_id'] as string) || this.prefillPatient?.id || '';
    if (!patientId) { this.toasts.warning('Patient required'); return; }

    const body = {
      patientId,
      type: 'appointment',
      collectionType: 'walkin',
      appointmentDate: String(bySteps['schedule']?.['appointment_date'] ?? new Date().toISOString().slice(0, 10)),
      slotTime: bySteps['schedule']?.['slot_time'] as string | undefined,
      consultationFee: 0,
      refDoctorId: bySteps['doctor']?.['ref_doctor_id'] as string | undefined,
      refDoctorName: bySteps['doctor']?.['ref_doctor_name'] as string | undefined,
      notes: bySteps['notes']?.['notes'] as string | undefined
    };

    this._saving.set(true);
    this.api.post<Appointment>('/api/appointments/', body).subscribe({
      next: a => {
        this._saving.set(false);
        this.toasts.success(`Booked for ${this.prefillPatient?.name ?? 'patient'}`);
        this.booked.emit(a);
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Booking failed'); }
    });
  }
}
