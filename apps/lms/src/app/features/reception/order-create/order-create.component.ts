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

      <div class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
        <aside class="space-y-3">
          @if (patient(); as p) {
            <pf-tile tone="violet" padding="md">
              <div class="flex items-center gap-3">
                <pf-avatar [name]="p.name" [size]="48"></pf-avatar>
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-0.5"
                     style="color: var(--text-muted);">Patient</p>
                  <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ p.name }}</p>
                </div>
              </div>
              <dl class="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                <div>
                  <dt class="text-[10px] font-mono uppercase tracking-wider" style="color: var(--text-muted);">Sex</dt>
                  <dd class="mt-0.5" style="color: var(--text-primary);">{{ p.sex }}</dd>
                </div>
                <div>
                  <dt class="text-[10px] font-mono uppercase tracking-wider" style="color: var(--text-muted);">Age</dt>
                  <dd class="mt-0.5" style="color: var(--text-primary);">{{ p.age }}y</dd>
                </div>
                <div>
                  <dt class="text-[10px] font-mono uppercase tracking-wider" style="color: var(--text-muted);">Phone</dt>
                  <dd class="mt-0.5 truncate" style="color: var(--text-primary);">{{ p.phone }}</dd>
                </div>
              </dl>
            </pf-tile>
          } @else {
            <pf-tile tone="amber" padding="md">
              <p class="text-[13px]" style="color: var(--text-primary);">No patient selected.</p>
              <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
                Open order create from a patient profile.
              </p>
            </pf-tile>
          }

          <pf-tile tone="default" padding="md">
            <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1"
               style="color: var(--text-muted);">Workflow</p>
            <p class="text-[13px]" style="color: var(--text-secondary);">
              <code class="pf-code">order_creation</code>
              <span class="ml-1" style="color: var(--text-muted);">v{{ record()?.version ?? '—' }}</span>
            </p>
          </pf-tile>
        </aside>

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
      </div>
    </section>
  `,
  styles: [`
    .pf-code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
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
        label: `${t.name} — ₹${t.price}${t.type === 'package' ? ' (pkg)' : ''}`
      })),
      doctors: [] as Array<{ value: string; label: string }>,
      patients: this._patient()
        ? [{ value: this._patient()!.id, label: this._patient()!.name }]
        : []
    }
  }));

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
    this.api.get<WorkflowConfigRecord>('/api/workflows/order_creation').subscribe({
      next: r => { this._record.set(r); try { this._config.set(JSON.parse(r.configJson)); } catch { /* ignore */ } }
    });

    const pid = this.route.snapshot.queryParamMap.get('patientId');
    if (pid) {
      this.api.get<{ patient: Patient; history: unknown[] }>(`/api/patients/${pid}`).subscribe({
        next: res => this._patient.set(res.patient),
        error: () => this.toasts.error('Could not load patient')
      });
      this.values.set({ 'patient::patient_id': pid });
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

    const testIds = (bySteps['tests']?.['test_ids'] as string[] | undefined) ?? [];
    if (!testIds.length) {
      this.toasts.warning('Select at least one test.');
      return;
    }

    const refDoctorName = bySteps['referral']?.['ref_doctor_name'] as string | undefined;
    const refDoctorId = bySteps['referral']?.['ref_doctor_id'] as string | undefined;
    const priority = (bySteps['referral']?.['priority'] as string | undefined) ?? 'routine';

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
