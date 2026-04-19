import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import {
  WorkflowRendererComponent,
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
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

@Component({
  selector: 'pf-billing',
  standalone: true,
  imports: [
    CurrencyInrPipe,
    WorkflowRendererComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-12 max-w-6xl mx-auto">
      <pf-screen-header
        eyebrow="Reception · Billing"
        title="Collect payment"
        [subtitle]="order()?.patient?.name ? 'Order for ' + order()!.patient!.name : 'Order billing'">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>

      @if (bill(); as b) {
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 items-start">
          <pf-tile tone="default" padding="lg">
            <p class="pf-bill-eyebrow">Order summary</p>
            <ul class="pf-bill-list">
              @for (item of b.items; track item.id) {
                <li class="pf-bill-row">
                  <div class="min-w-0 flex-1">
                    <p class="pf-bill-name">{{ item.testName }}</p>
                    @let tax = item.cgstAmount + item.sgstAmount + item.igstAmount;
                    @if (tax > 0) {
                      <p class="pf-bill-sub">incl. tax {{ tax | inr }}</p>
                    }
                  </div>
                  <p class="pf-bill-amount">{{ item.total | inr }}</p>
                </li>
              }
            </ul>

            <div class="pf-bill-totals">
              <div class="pf-bill-line">
                <span class="pf-bill-line-label">Sub-total</span>
                <span class="pf-bill-line-value">{{ b.subTotal | inr }}</span>
              </div>
              @if (b.totalDiscount) {
                <div class="pf-bill-line">
                  <span class="pf-bill-line-label">Discount</span>
                  <span class="pf-bill-line-value" style="color: var(--color-success);">−{{ b.totalDiscount | inr }}</span>
                </div>
              }
              <div class="pf-bill-line">
                <span class="pf-bill-line-label">GST</span>
                <span class="pf-bill-line-value">{{ b.totalTax | inr }}</span>
              </div>
              <div class="pf-bill-line pf-bill-line--total">
                <span class="pf-bill-line-label">Payable</span>
                <span class="pf-bill-line-value">{{ b.totalPayable | inr }}</span>
              </div>
            </div>
          </pf-tile>

          <pf-tile tone="default" padding="lg">
            @if (config(); as cfg) {
              <pf-workflow-renderer
                [config]="cfg"
                [context]="context()"
                [submitting]="saving()"
                [finishLabel]="'Collect ' + (b.totalPayable | inr)"
                (valuesChange)="values.set($event)"
                (workflowComplete)="onComplete($event)"></pf-workflow-renderer>
            } @else {
              <p class="text-[13px]" style="color: var(--text-tertiary);">Loading…</p>
            }
          </pf-tile>
        </div>
      } @else {
        <pf-tile tone="default" padding="xl">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">Generating bill…</p>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-bill-eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0 0 10px;
    }
    .pf-bill-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pf-bill-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-bill-row:last-child { border-bottom: 0; }
    .pf-bill-name {
      margin: 0;
      font-size: 13.5px;
      font-weight: 500;
      color: var(--text-primary);
    }
    .pf-bill-sub {
      margin: 2px 0 0;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .pf-bill-amount {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
      white-space: nowrap;
    }
    .pf-bill-totals {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--border-muted);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-bill-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .pf-bill-line-label {
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-bill-line-value {
      font-size: 13.5px;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    .pf-bill-line--total {
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1px dashed var(--border-muted);
    }
    .pf-bill-line--total .pf-bill-line-label { font-weight: 600; color: var(--text-primary); }
    .pf-bill-line--total .pf-bill-line-value { font-weight: 700; font-size: 18px; }
  `]
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

  onComplete(values: WorkflowFormValues): void {
    const b = this._bill();
    if (!b || this._saving()) return;

    const step = splitByStep(values)['payment'] ?? {};
    const mode = String(step['payment_mode'] ?? 'Cash').toLowerCase();
    const referenceNo = step['reference_no'] as string | undefined;
    const pct = Number(step['discount_pct']) || 0;
    const reason = (step['discount_reason'] as string) ?? 'Reception discount';

    this._saving.set(true);

    const payAfterDiscount = (bill: Bill) => {
      this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
        amount: bill.totalPayable, mode, referenceNo: referenceNo || undefined
      }).subscribe({
        next: () => {
          this._saving.set(false);
          this.toasts.success('Payment collected');
          this.router.navigate(['/reception/post-payment'], { queryParams: { orderId: bill.orderId } });
        },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Payment failed'); }
      });
    };

    if (pct > 0) {
      const amount = Math.round((b.subTotal * pct / 100) * 100) / 100;
      this.api.post<Bill>(`/api/billing/${b.id}/discount`, { amount, reason }).subscribe({
        next: updated => { this._bill.set(updated); payAfterDiscount(updated); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Could not apply discount'); }
      });
    } else {
      payAfterDiscount(b);
    }
  }

  back() { this.router.navigateByUrl('/reception'); }
}
