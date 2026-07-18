import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WorkflowRendererComponent,
  splitByStorage
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Patient } from '../../../shared/models/patient.model';
import { ApiError } from '../../../shared/models/api-response.model';
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
    LoadingLogoComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-register-page px-3 sm:px-4 md:px-8 pt-5 sm:pt-6 pb-10">

      <pf-screen-header
        eyebrow="Frontdesk · Registration"
        [title]="patientId() ? 'Edit Patient Details' : 'Register Patient'"
        subtitle="Capture the patient's details — name, contact, ID, and any extras you collect.">
      </pf-screen-header>

      <pf-tile tone="default" padding="lg" class="block">
        @if (config(); as cfg) {
          <pf-workflow-renderer
            [config]="cfg"
            [context]="context()"
            [initialValues]="initialValues()"
            [submitting]="saving()"
            [finishLabel]="patientId() ? 'Save changes' : 'Register patient'"
            [extraActions]="patientId() ? [] : registerActions"
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
  `,
  styles: [
    `
      /* PHONE (≤640px): the floating bottom-nav pill overlaps the
         in-flow workflow footer (the "← Back / Next →" / "Register
         patient" action row rendered by pf-workflow-renderer), so the
         primary button can't be reached/tapped. Pad the page foot by
         (action-row height + the pill's reserved height,
         --tab-nav-total-height) so the form scrolls fully clear and the
         button sits above the pill. Additive + phone-only: ≥641px is
         byte-for-byte unchanged. */
      @media (max-width: 640px) {
        :host .pf-register-page {
          padding-bottom: calc(56px + var(--tab-nav-total-height)) !important;
        }
      }
    `
  ]
})
export class PatientRegisterComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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

  protected readonly patientId = signal<string | null>(null);
  protected readonly initialValues = signal<WorkflowFormValues>({});

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
    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.patientId.set(pid);
    }

    this.api.get<WorkflowConfigRecord>('/api/workflows/patient_registration').subscribe({
      next: r => {
        this._record.set(r);
        console.log('Parsing workflow config Patient', r.configJson);
        try {
          const cfg = JSON.parse(r.configJson) as WorkflowConfig;
          this._config.set(cfg);

          if (pid) {
            this.api.get<Patient>(`/api/patients/${pid}`).subscribe({
              next: p => {
                const init = this.buildInitialValues(cfg, p);
                this.initialValues.set(init);
                this.values.set(init);
              },
              error: () => this.toasts.error('Could not load patient details for editing')
            });
          }
        }
        catch { this.toasts.error('Could not parse workflow'); }
      },
      error: () => this.toasts.error('Could not load patient_registration workflow')
    });
  }

  back() {
    const pid = this.patientId();
    if (pid) {
      this.router.navigate(['/frontdesk/patients', pid]);
    } else {
      this.router.navigateByUrl('/frontdesk');
    }
  }

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

    this.applyHybridDob(body);
    this._saving.set(true);

    const pid = this.patientId();
    if (pid) {
      this.api.put<Patient>(`/api/patients/${pid}`, body).subscribe({
        next: patient => {
          this._saving.set(false);
          this.toasts.success(`Updated ${patient.displayName}`);
          this.router.navigate(['/frontdesk/patients', patient.id]);
        },
        error: e => {
          this._saving.set(false);
          this.toasts.error(ApiError.from(e).message);
        }
      });
    } else {
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
            this.router.navigate(['/frontdesk/patients', patient.id]);
          }
        },
        error: e => {
          this._saving.set(false);
          this.toasts.error(ApiError.from(e).message);
        }
      });
    }
  }

  private buildInitialValues(cfg: WorkflowConfig, p: Patient): WorkflowFormValues {
    const initial: WorkflowFormValues = {};
    let parsedAttrs: Record<string, unknown> = {};
    if (p.attributes) {
      try {
        parsedAttrs = JSON.parse(p.attributes);
      } catch (e) {
        console.error('Failed to parse patient attributes', e);
      }
    }

    for (const step of cfg.steps) {
      for (const f of step.fields) {
        const sk = f.storageKey;
        const key = `${step.name}::${f.name}`;
        if (sk.startsWith('metadata.')) {
          const metaKey = sk.slice('metadata.'.length);
          if (parsedAttrs[metaKey] !== undefined) {
            initial[key] = parsedAttrs[metaKey];
          }
        } else {
          const camelKey = this.toCamelCase(sk);
          const val = (p as any)[camelKey];
          if (val !== undefined && val !== null) {
            if (camelKey === 'dateOfBirth' && typeof val === 'string') {
              initial[key] = val.slice(0, 10);
            } else {
              initial[key] = val;
            }
          }
        }
      }
    }
    return initial;
  }

  private toCamelCase(snake: string): string {
    return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  }

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
