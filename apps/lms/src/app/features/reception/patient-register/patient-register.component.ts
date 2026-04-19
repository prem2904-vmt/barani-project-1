import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
import {
  WorkflowRendererComponent,
  splitByStorage
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Patient } from '../../../shared/models/patient.model';
import { WorkflowConfig, WorkflowConfigRecord, WorkflowContext, WorkflowFormValues } from '../../../shared/models/workflow.model';

@Component({
  selector: 'pf-patient-register',
  standalone: true,
  imports: [SlideOverComponent, WorkflowRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-slide-over [open]="open" [title]="'Register patient'" (closed)="closed.emit()">
      @if (config(); as cfg) {
        <pf-workflow-renderer
          [config]="cfg"
          [context]="context()"
          [submitting]="saving()"
          [finishLabel]="'Register patient'"
          (valuesChange)="values.set($event)"
          (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
      } @else {
        <p class="text-sm text-slate-500">Loading workflow…</p>
      }

      <div footer>
        <p class="text-xs text-slate-500">
          Config: <code>patient_registration v{{ record()?.version }}</code>
          · standard fields write to dedicated columns, custom fields into <code>attributes</code>.
        </p>
      </div>
    </pf-slide-over>
  `
})
export class PatientRegisterComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  @Input() open = false;
  @Output() closed = new EventEmitter<void>();
  @Output() registered = new EventEmitter<{ patient: Patient; createOrder: boolean }>();

  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});

  readonly record = this._record.asReadonly();
  readonly config = this._config.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly context = computed<WorkflowContext>(() => {
    const user = this.auth.user();
    const v = this.values();
    const dobKey = Object.keys(v).find(k => k.endsWith('::date_of_birth'));
    const dob = dobKey ? v[dobKey] : undefined;
    const age = dob ? this.yearsBetween(String(dob), new Date()) : undefined;
    const sexKey = Object.keys(v).find(k => k.endsWith('::sex'));
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      patientAge: age,
      patientSex: sexKey ? String(v[sexKey]) : undefined,
      'user.permissions': user?.permissions ?? []
    };
  });

  ngOnInit() {
    this.api.get<WorkflowConfigRecord>('/api/workflows/patient_registration').subscribe({
      next: r => {
        this._record.set(r);
        try { this._config.set(JSON.parse(r.configJson)); }
        catch { this.toasts.error('Could not parse workflow'); }
      },
      error: () => this.toasts.error('Could not load patient_registration workflow')
    });
  }

  onComplete(values: WorkflowFormValues) {
    const cfg = this._config();
    if (!cfg || this._saving()) return;
    const { standard, metadata } = splitByStorage(cfg, values);

    // Standard storageKeys come in snake_case (matching DB columns); wire DTO expects camelCase.
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(standard)) {
      if (v === null || v === undefined || v === '') continue;
      body[this.toCamelCase(k)] = v;
    }
    if (Object.keys(metadata).length > 0) {
      body['attributes'] = JSON.stringify(metadata);
    }

    this._saving.set(true);
    this.api.post<Patient>('/api/patients/', body).subscribe({
      next: patient => {
        this._saving.set(false);
        this.toasts.success(`Registered ${patient.name}`);
        this.values.set({});
        this.registered.emit({ patient, createOrder: false });
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(e.message ?? 'Registration failed');
      }
    });
  }

  private toCamelCase(snake: string): string {
    return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  }

  private yearsBetween(dobIso: string, now: Date): number {
    const dob = new Date(dobIso);
    if (Number.isNaN(dob.getTime())) return 0;
    let age = now.getFullYear() - dob.getFullYear();
    if (now.getMonth() < dob.getMonth() ||
        (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) {
      age--;
    }
    return Math.max(0, age);
  }
}
