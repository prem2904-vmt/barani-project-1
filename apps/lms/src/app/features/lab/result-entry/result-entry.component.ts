import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import {
  WorkflowRendererComponent,
  splitByStep
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { OrderTest } from '../../../shared/models/order.model';
import { TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import {
  WorkflowConfig,
  WorkflowConfigRecord,
  WorkflowContext,
  WorkflowFormValues
} from '../../../shared/models/workflow.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface EnterResponse {
  orderTest: OrderTest;
  flags: { critical: boolean; notifications: string[] };
}

@Component({
  selector: 'pf-result-entry',
  standalone: true,
  imports: [
    DatePipe,
    TatIndicatorComponent,
    WorkflowRendererComponent,
    AvatarComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto">
      <pf-screen-header
        eyebrow="Lab"
        [title]="orderTest()?.test?.name ?? 'Result entry'"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>

      @if (orderTest(); as t) {
        <pf-tile [tone]="panelTone()" padding="md" class="mb-4 block">
          <div class="flex items-center gap-3 flex-wrap">
            <pf-avatar [name]="patientName()" [size]="48"></pf-avatar>

            <div class="min-w-0 flex-1">
              <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ patientName() }}</p>
              <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
                {{ patientSex() }} · {{ patientAge() }}y · {{ t.test?.department?.name }} · {{ t.test?.flow }} flow
              </p>
            </div>

            <pf-tat-indicator [tatLevel]="tatLevel()" [remainingMinutes]="tatRemaining()"></pf-tat-indicator>
          </div>

          <div class="mt-4">
            <div class="pf-tat-track">
              <div class="pf-tat-fill"
                   [class]="'pf-tat-' + tatLevel()"
                   [style.width.%]="tatPercent()"></div>
            </div>
            <div class="flex items-center justify-between mt-1.5 text-[11px]"
                 style="color: var(--text-muted);">
              <span>
                Received {{ t.subOrder?.receivedAtLab ? (t.subOrder?.receivedAtLab | date:'short') : '— not yet —' }}
              </span>
              <span class="font-mono">TAT {{ t.test?.tatHours }}h</span>
            </div>
          </div>
        </pf-tile>
      } @else {
        <pf-tile tone="default" padding="xl" class="mb-4 block">
          <p class="text-[13px] text-center" style="color: var(--text-tertiary);">Loading…</p>
        </pf-tile>
      }

      @if (orderTest() && config()) {
        <pf-tile tone="default" padding="lg" class="block">
          <pf-workflow-renderer
            [config]="config()!"
            [context]="context()"
            [resources]="resources()"
            [initialValues]="initialValues()"
            [submitting]="saving()"
            [finishLabel]="'Submit result'"
            (valuesChange)="values.set($event)"
            (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
        </pf-tile>

        <div class="flex items-center justify-between mt-3 px-1">
          <p class="text-[11px] font-mono" style="color: var(--text-muted);">
            result_entry v{{ record()?.version ?? '—' }}
          </p>
          <pf-touch-btn size="sm" variant="ghost" (pressed)="rejectSample()">
            Reject sample
          </pf-touch-btn>
        </div>
      }
    </section>
  `,
  styles: [`
    .pf-tat-track {
      height: 6px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      overflow: hidden;
    }
    .pf-tat-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .pf-tat-normal { background: linear-gradient(90deg, #10b981, #34d399); box-shadow: 0 0 12px rgba(16, 185, 129, 0.45); }
    .pf-tat-high   { background: linear-gradient(90deg, #f59e0b, #fbbf24); box-shadow: 0 0 12px rgba(245, 158, 11, 0.45); }
    .pf-tat-urgent { background: linear-gradient(90deg, #ef4444, #f87171); box-shadow: 0 0 14px rgba(239, 68, 68, 0.55); }
  `]
})
export class ResultEntryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);

  private readonly _ot = signal<OrderTest | null>(null);
  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});

  readonly orderTest = this._ot.asReadonly();
  readonly config = this._config.asReadonly();
  readonly record = this._record.asReadonly();
  readonly saving = this._saving.asReadonly();

  private readonly _paramsBlob = computed<TestParametersBlob | null>(() => {
    const raw = this._ot()?.test?.parameters;
    if (!raw) return null;
    try { return JSON.parse(raw) as TestParametersBlob; } catch { return null; }
  });
  readonly parameters = computed<TestParameter[]>(() => this._paramsBlob()?.parameters ?? []);

  readonly resources = computed(() => ({
    testParameters: this.parameters()
  }));

  /** Pre-fill workflow values from the existing result snapshot so edits start
   *  from the current state instead of an empty form. Keys match the
   *  workflow-renderer's `step::field` convention — the single entry step is
   *  named "results", and each field's name equals the parameter name. */
  readonly initialValues = computed<WorkflowFormValues>(() => {
    const raw = this._ot()?.currentResult;
    if (!raw) return {};
    try {
      const snap = JSON.parse(raw) as { values?: Record<string, unknown> };
      const out: WorkflowFormValues = {};
      for (const [k, v] of Object.entries(snap.values ?? {})) {
        out[`results::${k}`] = v;
      }
      return out;
    } catch { return {}; }
  });

  readonly context = computed<WorkflowContext>(() => {
    const p = this._ot()?.subOrder?.order?.patient;
    const user = this.auth.user();
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

  // TAT calc
  readonly tatElapsedMin = computed(() => {
    const ral = this._ot()?.subOrder?.receivedAtLab;
    if (!ral) return 0;
    return Math.max(0, (Date.now() - new Date(ral).getTime()) / 60000);
  });
  readonly tatBudgetMin = computed(() => (this._ot()?.test?.tatHours ?? 0) * 60);
  readonly tatRemaining = computed(() => this.tatBudgetMin() - this.tatElapsedMin());
  readonly tatLevel = computed<'urgent' | 'high' | 'normal'>(() => {
    const r = this.tatRemaining();
    if (r <= 0) return 'urgent';
    if (r <= 60) return 'high';
    return 'normal';
  });
  readonly tatPercent = computed(() => {
    const b = this.tatBudgetMin();
    if (!b) return 0;
    return Math.max(0, Math.min(100, (this.tatElapsedMin() / b) * 100));
  });

  readonly patientName = computed(() => this._ot()?.subOrder?.order?.patient?.name ?? '—');
  readonly patientSex = computed(() => this._ot()?.subOrder?.order?.patient?.sex ?? '—');
  readonly patientAge = computed(() => this._ot()?.subOrder?.order?.patient?.age ?? '—');

  readonly subtitle = computed(() => {
    const t = this._ot();
    if (!t) return 'Capturing parameter values for this test.';
    const rem = this.tatRemaining();
    const state =
      this.tatLevel() === 'urgent' ? 'past TAT' :
      this.tatLevel() === 'high'   ? `${Math.round(rem)}m remaining` :
      `${Math.round(rem)}m to go`;
    return `Enter parameter values. Currently ${state}.`;
  });

  readonly panelTone = computed<TileTone>(() => {
    const l = this.tatLevel();
    return l === 'urgent' ? 'rose' : l === 'high' ? 'amber' : 'violet';
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.back(); return; }
    this.api.get<OrderTest>(`/api/results/${id}`).subscribe({
      next: t => this._ot.set(t),
      error: () => this.toasts.error('Could not load result entry')
    });
    this.api.get<WorkflowConfigRecord>('/api/workflows/result_entry').subscribe({
      next: r => { this._record.set(r); try { this._config.set(JSON.parse(r.configJson)); } catch { /* ignore */ } }
    });
  }

  onComplete(values: WorkflowFormValues): void {
    const id = this._ot()?.id;
    if (!id || this._saving()) return;

    const bySteps = splitByStep(values);
    const paramValues: Record<string, unknown> = {};
    for (const p of this.parameters()) {
      const v = bySteps['results']?.[p.name];
      if (v !== undefined) paramValues[p.name] = v;
    }

    this._saving.set(true);
    this.api.post<EnterResponse>(`/api/results/${id}/enter`, {
      values: paramValues,
      note: null
    }).subscribe({
      next: res => {
        this._saving.set(false);
        if (res.flags.critical) this.toasts.warning('Submitted — flagged critical');
        else this.toasts.success('Result submitted');
        this.back();
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Submit failed'); }
    });
  }

  async rejectSample() {
    const id = this._ot()?.id;
    if (!id) return;
    const reason = await this.dialog.prompt({
      title: 'Reject this sample?',
      message: 'The sample will be sent back for re-collection. Please describe what went wrong.',
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject sample'
    });
    if (!reason) return;
    this.api.post(`/api/results/${id}/reject-sample`, { reason }).subscribe({
      next: () => { this.toasts.success('Sample rejected'); this.back(); }
    });
  }

  back() {
    const ot = this._ot();
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    if (returnTo === 'validate' && ot) {
      this.router.navigate(['/pathologist/validate', ot.id]);
      return;
    }
    this.router.navigateByUrl('/lab/my-work');
  }
}
