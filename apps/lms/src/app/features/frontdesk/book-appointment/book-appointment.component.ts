import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WorkflowRendererComponent,
  splitByStep
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Appointment } from '../../../shared/models/appointment.model';
import { Patient } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import {
  WorkflowConfig,
  WorkflowConfigRecord,
  WorkflowContext,
  WorkflowFormValues
} from '../../../shared/models/workflow.model';

@Component({
  selector: 'pf-book-appointment',
  standalone: true,
  imports: [
    WorkflowRendererComponent,
    AvatarComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
        eyebrow="Frontdesk · Appointments"
        title="Book appointment"
        subtitle="Pick a date and slot. WhatsApp confirmation queues automatically.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>

      <!-- Prefill patient card when patientId is in the URL -->
      @if (prefillPatient(); as p) {
        <pf-tile tone="violet" padding="md" class="block mb-4">
          <div class="flex items-center gap-3">
            <pf-avatar [name]="p.name" [size]="44"></pf-avatar>
            <div class="min-w-0 flex-1">
              <p class="text-[14px] font-semibold truncate"
                 style="color: var(--text-primary);">{{ p.name }}</p>
              <p class="text-[11.5px] font-mono mt-0.5"
                 style="color: var(--text-tertiary);">
                {{ p.sex ?? '—' }} · {{ p.age ?? '—' }}y
                @if (p.phone) { · {{ p.phone }} }
              </p>
            </div>
          </div>
        </pf-tile>
      }

      <pf-tile tone="default" padding="lg" class="block">
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
          <p class="text-[13px]" style="color: var(--text-tertiary);">Loading workflow…</p>
        }
      </pf-tile>

      <p class="text-[11px] font-mono mt-3 px-1" style="color: var(--text-muted);">
        Config: appointment_booking v{{ record()?.version ?? '—' }}
      </p>
    </section>
  `
})
export class BookAppointmentComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _tests = signal<Test[]>([]);
  private readonly _prefillPatient = signal<Patient | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});

  readonly record = this._record.asReadonly();
  readonly config = this._config.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly prefillPatient = this._prefillPatient.asReadonly();

  readonly context = computed<WorkflowContext>(() => {
    const user = this.auth.user();
    const p = this._prefillPatient();
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      patientId: p?.id,
      patientAge: p?.age,
      patientSex: p?.sex
    };
  });

  readonly resources = computed(() => {
    const p = this._prefillPatient();
    return {
      dataSources: {
        tests: this._tests().map(t => ({ value: t.id, label: `${t.name} — ₹${t.price}` })),
        patients: p ? [{ value: p.id, label: p.name }] : [],
        doctors: [] as Array<{ value: string; label: string }>,
        available_slots: ['09:00','09:30','10:00','10:30','11:00','11:30','12:00'].map(s => ({ value: s, label: s }))
      }
    };
  });

  readonly initialValues = computed<WorkflowFormValues>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const p = this._prefillPatient();
    return {
      'patient::patient_id': p?.id ?? '',
      'schedule::appointment_date': today
    };
  });

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
    this.api.get<WorkflowConfigRecord>('/api/workflows/appointment_booking').subscribe({
      next: r => { this._record.set(r); try { this._config.set(JSON.parse(r.configJson)); } catch { /* ignore */ } }
    });

    // Prefill patient from ?patientId= query param.
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.api.get<{ patient: Patient }>(`/api/patients/${pid}`).subscribe({
        next: res => this._prefillPatient.set(res.patient),
        error: () => { /* leave empty; user can pick via form */ }
      });
    }
  }

  back() { this.router.navigateByUrl('/frontdesk'); }

  onComplete(values: WorkflowFormValues): void {
    if (this._saving()) return;
    const bySteps = splitByStep(values);
    const patientId = (bySteps['patient']?.['patient_id'] as string) || this._prefillPatient()?.id || '';
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
      next: () => {
        this._saving.set(false);
        this.toasts.success(`Booked for ${this._prefillPatient()?.name ?? 'patient'}`);
        this.router.navigateByUrl('/frontdesk');
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Booking failed'); }
    });
  }
}
