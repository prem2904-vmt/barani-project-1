import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WorkflowRendererComponent,
  splitByStorage
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Patient } from '../../../shared/models/patient.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { WorkflowConfig, WorkflowConfigRecord, WorkflowContext, WorkflowFormValues } from '../../../shared/models/workflow.model';

@Component({
  selector: 'pf-patient-register',
  standalone: true,
  imports: [
    WorkflowRendererComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent,
    LoadingLogoComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-3 sm:px-4 md:px-8 pt-5 sm:pt-6 pb-10">

      <pf-screen-header
        eyebrow="Frontdesk · Registration"
        title="Register Patient"
        subtitle="Capture the patient's details — name, contact, ID, and any extras you collect.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>

      <pf-tile tone="default" padding="lg" class="block">
        @if (config(); as cfg) {
          <pf-workflow-renderer
            [config]="cfg"
            [context]="context()"
            [submitting]="saving()"
            [finishLabel]="'Register patient'"
            [extraActions]="registerActions"
            (valuesChange)="values.set($event)"
            (extraActionClicked)="onExtraAction($event)"
            (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
        } @else {
          <div class="flex justify-center py-10">
            <pf-loading-logo size="xl" color="purple" [showDna]="true"
                             [showText]="true" text="Loading workflow…"></pf-loading-logo>
          </div>
        }
      </pf-tile>

      <!-- <p class="text-[11px] font-mono mt-3 px-1" style="color: var(--text-muted);">
        Config: patient_registration v{{ record()?.version ?? '—' }}
      </p> -->
    </section>
  `
})
export class PatientRegisterComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});
  protected readonly registerActions: Array<{ id: string; label: string; variant?: 'primary' | 'ghost' }> = [
    { id: 'create_order', label: 'Create Order', variant: 'ghost' },
    { id: 'create_appointment', label: 'Create Appointment', variant: 'ghost' }
  ];

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
        console.log('Parsing workflow config Patient', r.configJson);
        try { this._config.set(JSON.parse(r.configJson)); }
        catch { this.toasts.error('Could not parse workflow'); }
      },
      error: () => this.toasts.error('Could not load patient_registration workflow')
    });
  }

  back() { this.router.navigateByUrl('/frontdesk'); }

  onComplete(values: WorkflowFormValues) {
    this.savePatient(values, 'profile');
  }

  onExtraAction(event: { actionId: string; values: WorkflowFormValues }) {
    if (event.actionId === 'create_order') {
      this.savePatient(event.values, 'order');
    } else if (event.actionId === 'create_appointment') {
      this.savePatient(event.values, 'appointment');
    }
  }

  private savePatient(values: WorkflowFormValues, target: 'profile' | 'order' | 'appointment') {
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

    // Hybrid DOB / age: registration captures EITHER an exact date of birth OR
    // an approximate age. When only age is given, anchor a synthetic DOB to the
    // registration date (today − age years) so the displayed age increments over
    // time (30 today → 31 next year). DOB always wins; once a DOB exists we drop
    // the static age so age is recomputed from DOB everywhere (and stays live).
    this.applyHybridDob(body);

    this._saving.set(true);
    this.api.post<Patient>('/api/patients/', body).subscribe({
      next: patient => {
        this._saving.set(false);
        this.toasts.success(`Registered ${patient.displayName}`);
        this.values.set({});
        if (target === 'order') {
          this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: patient.id } });
        } else if (target === 'appointment') {
          this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: patient.id } });
        } else {
          // After registration: navigate to the new patient's profile page.
          this.router.navigate(['/frontdesk/patients', patient.id]);
        }
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

  /** Hybrid DOB/age on the patient body: if only an age is given, derive a DOB
   *  anchored to today (registration date) so the age increments over time;
   *  whenever a DOB exists, drop the static age so it's recomputed from DOB. */
  private applyHybridDob(body: Record<string, unknown>): void {
    const dob = body['dateOfBirth'];
    const ageRaw = body['age'];
    if ((dob === undefined || dob === null || dob === '') && ageRaw != null && `${ageRaw}` !== '') {
      const age = Math.floor(Number(ageRaw));
      if (Number.isFinite(age) && age >= 0 && age < 150) {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        d.setFullYear(d.getFullYear() - age);
        body['dateOfBirth'] = d.toISOString();
      }
    }
    if (body['dateOfBirth']) delete body['age'];
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
