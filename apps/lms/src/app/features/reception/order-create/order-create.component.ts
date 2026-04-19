import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WorkflowRendererComponent,
  splitByStep,
  splitByStorage
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { Test } from '../../../shared/models/test.model';
import {
  WorkflowConfig,
  WorkflowConfigRecord,
  WorkflowContext,
  WorkflowFormValues
} from '../../../shared/models/workflow.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

@Component({
  selector: 'pf-order-create',
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
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-6xl mx-auto">
      <pf-screen-header
        eyebrow="Reception"
        title="Create order"
        subtitle="Choose tests, referral, and priority. Flow is driven by the order_creation workflow.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>

      @if (patient(); as p) {
        <div class="pf-patient-banner">
          <pf-avatar [name]="p.name" [size]="40"></pf-avatar>
          <div class="min-w-0 flex-1">
            <p class="pf-patient-banner__name">{{ p.name }}</p>
            <p class="pf-patient-banner__meta">
              {{ p.sex ?? '—' }} · {{ p.age ?? '—' }}y
              @if (p.phone) { · {{ p.phone }} }
            </p>
          </div>
        </div>
      }

      <pf-tile tone="default" padding="lg">
        @if (config(); as cfg) {
          <pf-workflow-renderer
            [config]="cfg"
            [context]="context()"
            [resources]="resources()"
            [submitting]="saving()"
            [finishLabel]="'Create order → Billing'"
            (valuesChange)="values.set($event)"
            (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
        } @else {
          <div class="text-center py-12">
            <p class="text-[13px]" style="color: var(--text-tertiary);">Loading workflow…</p>
          </div>
        }
      </pf-tile>
    </section>
  `,
  styles: [`
    .pf-patient-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      margin-bottom: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
    }
    .pf-patient-banner__name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }
    .pf-patient-banner__meta {
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
      margin: 2px 0 0;
    }
  `]
})
export class OrderCreateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _patient = signal<Patient | null>(null);
  private readonly _tests = signal<Test[]>([]);
  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});

  readonly patient = this._patient.asReadonly();
  readonly config = this._config.asReadonly();
  readonly record = this._record.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly context = computed<WorkflowContext>(() => {
    const user = this.auth.user();
    const p = this._patient();
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      patientId: p?.id,
      patientAge: p?.age,
      patientSex: p?.sex,
      'user.permissions': user?.permissions ?? []
    };
  });

  readonly resources = computed(() => ({
    dataSources: {
      tests: this._tests().map(t => ({
        value: t.id,
        label: t.name,
        sublabel: `₹${t.price}${t.type === 'package' ? ' · package' : ''}`
      })),
      doctors: [] as Array<{ value: string; label: string }>,
      patients: this._patient()
        ? [{ value: this._patient()!.id, label: this._patient()!.name }]
        : []
    }
  }));

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: l => this._tests.set(l ?? []),
      error: e => this.toasts.error(`Could not load tests: ${e?.message ?? 'unknown error'}`)
    });
    this.api.get<WorkflowConfigRecord>('/api/workflows/order_creation').subscribe({
      next: r => { this._record.set(r); try { this._config.set(JSON.parse(r.configJson)); } catch { /* ignore */ } },
      error: () => this.toasts.error('Could not load order workflow')
    });

    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.api.get<{ patient: Patient; history: unknown[] }>(`/api/patients/${pid}`).subscribe({
        next: res => this._patient.set(res.patient),
        error: () => this.toasts.error('Could not load patient')
      });
    } else {
      this.toasts.warning('Open order create from a patient profile');
    }
  }

  onComplete(values: WorkflowFormValues): void {
    const cfg = this._config();
    const p = this._patient();
    if (!cfg || !p || this._saving()) return;

    const bySteps = splitByStep(values);
    const { metadata } = splitByStorage(cfg, values);

    const step = bySteps['order'] ?? {};
    const testIds = (step['test_ids'] as string[] | undefined) ?? [];
    if (!testIds.length) {
      this.toasts.warning('Select at least one test.');
      return;
    }

    const refDoctorName = step['ref_doctor_name'] as string | undefined;
    const refDoctorId = step['ref_doctor_id'] as string | undefined;
    const priority = (step['priority'] as string | undefined) ?? 'Normal';

    this._saving.set(true);
    this.api.post<Order>('/api/orders/', {
      patientId: p.id,
      priority,
      source: 'walkin',
      collectionType: 'walkin',
      refDoctorId: refDoctorId || undefined,
      refDoctorName: refDoctorName || undefined,
      testIds,
      metadataJson: Object.keys(metadata).length ? JSON.stringify(metadata) : undefined
    }).subscribe({
      next: order => {
        this._saving.set(false);
        this.toasts.success('Order created');
        this.router.navigate(['/reception/billing'], { queryParams: { orderId: order.id } });
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Order failed'); }
    });
  }

  back() { this.router.navigateByUrl('/reception'); }
}
