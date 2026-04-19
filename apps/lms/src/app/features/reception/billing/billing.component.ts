import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import {
  WorkflowRendererComponent,
  WorkflowStepCompleteEvent,
  splitByStep
} from '../../../shared/components/workflow-renderer/workflow-renderer.component';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import {
  WorkflowConfig,
  WorkflowConfigRecord,
  WorkflowContext,
  WorkflowFormValues
} from '../../../shared/models/workflow.model';

@Component({
  selector: 'pf-billing',
  standalone: true,
  imports: [CurrencyInrPipe, WorkflowRendererComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-6xl pb-12">
      <header class="mb-4">
        <button class="text-xs text-slate-500 hover:text-slate-900 mb-1" (click)="back()">← Back</button>
        <h1 class="text-2xl font-semibold">Billing</h1>
        @if (order()) { <p class="text-sm text-slate-600">Order for <strong>{{ order()!.patient?.name }}</strong></p> }
      </header>

      @if (bill(); as b) {
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
          <div class="pf-card p-0 overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-slate-50">
                <tr class="text-left">
                  <th class="px-4 py-2 font-medium">Test</th>
                  <th class="px-4 py-2 font-medium text-right">Price</th>
                  <th class="px-4 py-2 font-medium text-right">Tax</th>
                  <th class="px-4 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (item of b.items; track item.id) {
                  <tr class="border-t border-slate-100">
                    <td class="px-4 py-2">{{ item.testName }}</td>
                    <td class="px-4 py-2 text-right">{{ item.price | inr }}</td>
                    <td class="px-4 py-2 text-right text-slate-500">
                      {{ (item.cgstAmount + item.sgstAmount + item.igstAmount) | inr }}
                    </td>
                    <td class="px-4 py-2 text-right font-medium">{{ item.total | inr }}</td>
                  </tr>
                }
              </tbody>
              <tfoot class="bg-slate-50">
                <tr><td colspan="2" class="px-4 py-2 text-right text-slate-500">Sub-total</td>
                    <td colspan="2" class="px-4 py-2 text-right">{{ b.subTotal | inr }}</td></tr>
                @if (b.totalDiscount) {
                  <tr><td colspan="2" class="px-4 py-2 text-right text-slate-500">Discount</td>
                      <td colspan="2" class="px-4 py-2 text-right text-emerald-600">- {{ b.totalDiscount | inr }}</td></tr>
                }
                <tr><td colspan="2" class="px-4 py-2 text-right text-slate-500">GST</td>
                    <td colspan="2" class="px-4 py-2 text-right">{{ b.totalTax | inr }}</td></tr>
                <tr class="border-t border-slate-200">
                  <td colspan="2" class="px-4 py-3 text-right font-semibold">Payable</td>
                  <td colspan="2" class="px-4 py-3 text-right text-lg font-semibold">{{ b.totalPayable | inr }}</td></tr>
              </tfoot>
            </table>
          </div>

          <aside class="pf-card">
            @if (config(); as cfg) {
              <pf-workflow-renderer
                [config]="cfg"
                [context]="context()"
                [submitting]="saving()"
                [finishLabel]="'Collect payment →'"
                (valuesChange)="values.set($event)"
                (stepComplete)="onStepComplete($event)"
                (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
            } @else {
              <p class="text-sm text-slate-500">Loading workflow…</p>
            }
            <p class="text-[11px] text-slate-400 mt-2">
              Config: <code>billing v{{ record()?.version }}</code>
            </p>
          </aside>
        </div>
      } @else {
        <div class="pf-card text-sm text-slate-500">Generating bill…</div>
      }
    </section>
  `
})
export class BillingComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _order = signal<Order | null>(null);
  private readonly _bill = signal<Bill | null>(null);
  private readonly _record = signal<WorkflowConfigRecord | null>(null);
  private readonly _config = signal<WorkflowConfig | null>(null);
  private readonly _saving = signal(false);
  protected readonly values = signal<WorkflowFormValues>({});

  readonly order = this._order.asReadonly();
  readonly bill = this._bill.asReadonly();
  readonly config = this._config.asReadonly();
  readonly record = this._record.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly context = computed<WorkflowContext>(() => {
    const user = this.auth.user();
    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      branchId: user?.branchId,
      'user.permissions': user?.permissions ?? []
    };
  });

  ngOnInit() {
    const orderId = this.route.snapshot.queryParamMap.get('orderId');
    if (!orderId) { this.toasts.error('No order id'); this.router.navigateByUrl('/reception'); return; }

    this.api.get<Order>(`/api/orders/${orderId}`).subscribe({ next: o => this._order.set(o) });
    this.api.post<Bill>('/api/billing/', { orderId, discount: 0 }).subscribe({
      next: b => this._bill.set(b),
      error: e => this.toasts.error(e.message ?? 'Could not create bill')
    });
    this.api.get<WorkflowConfigRecord>('/api/workflows/billing').subscribe({
      next: r => { this._record.set(r); try { this._config.set(JSON.parse(r.configJson)); } catch { /* ignore */ } }
    });
  }

  onStepComplete(ev: WorkflowStepCompleteEvent): void {
    if (ev.step.name !== 'discount') return;
    const b = this._bill();
    if (!b) return;
    const bySteps = splitByStep(ev.values);
    const pct = Number(bySteps['discount']?.['discount_pct']) || 0;
    if (pct <= 0) return;
    const amount = Math.round((b.subTotal * pct / 100) * 100) / 100;
    this.api.post<Bill>(`/api/billing/${b.id}/discount`, {
      amount,
      reason: (bySteps['discount']?.['discount_reason'] as string) ?? 'Reception discount'
    }).subscribe({
      next: updated => { this._bill.set(updated); this.toasts.success(`Applied ${pct}% discount`); }
    });
  }

  onComplete(values: WorkflowFormValues): void {
    const b = this._bill();
    if (!b || this._saving()) return;
    const bySteps = splitByStep(values);
    const mode = String(bySteps['payment']?.['payment_mode'] ?? 'cash').toLowerCase();
    const referenceNo = bySteps['payment']?.['reference_no'] as string | undefined;

    this._saving.set(true);
    this.api.post<Bill>(`/api/billing/${b.id}/payment`, {
      amount: b.totalPayable, mode, referenceNo: referenceNo || undefined
    }).subscribe({
      next: () => {
        this._saving.set(false);
        this.toasts.success('Payment collected');
        this.router.navigate(['/reception/post-payment'], { queryParams: { orderId: b.orderId } });
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Payment failed'); }
    });
  }

  back() { this.router.navigateByUrl('/reception'); }
}
