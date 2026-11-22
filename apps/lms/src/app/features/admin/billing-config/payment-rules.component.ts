import { SkelSettingRowsComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { PAYMENT_RULE_PERMS } from '../../../core/auth/route-access';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { BranchLabConfig } from '../../../shared/models/branch-lab-config.model';
import { SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';

export type PaymentGateStage = 'none' | 'dispatch' | 'report';

export const PAYMENT_GATE_OPTIONS: ReadonlyArray<{ value: PaymentGateStage; label: string; desc: string }> = [
  { value: 'none', label: 'Off', desc: 'Billing, dispatch and reporting run independently (default).' },
  { value: 'dispatch', label: 'Block at dispatch', desc: "Samples can't be dispatched to the lab until the bill is fully paid (strongest)." },
  { value: 'report', label: 'Block at report', desc: "Dispatch is allowed, but the report can't be shared until the bill is fully paid." },
];

/**
 * Payment rules — "Require full payment" (off / block at dispatch / block at
 * report) and "Show the Payments due tab". They are BILLING rules, moved out
 * of Lab settings › Rules & gates; the Billing page places this ONE component
 * (`<pf-payment-rules-card>`). Same API as before: PATCH
 * /api/tenants/branch-lab-config { paymentGateStage | showPaymentsDueTab } —
 * revenue policy, so billing / organisation admins only (`PAYMENT_RULE_PERMS`;
 * the server refuses it the same way). Renders nothing for anyone else.
 */
@Component({
  selector: 'pf-payment-rules-card',
  standalone: true,
  imports: [SkelSettingRowsComponent, SettingRowComponent, SegmentedComponent, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canManage()) {
      @if (loading()) {
        <pf-skel-setting-rows [rows]="2" label="Loading payment rules…"></pf-skel-setting-rows>
      } @else {
        <pf-setting-row class="pf-pr" data-testid="pr-gate" label="Require full payment to progress"
                        [hint]="gateDesc()">
          <pf-segmented size="sm" ariaLabel="Require full payment" [options]="gateSeg" [value]="paymentGateStage()"
                        (valueChange)="setPaymentGateStage($any($event))"></pf-segmented>
        </pf-setting-row>
        <pf-setting-row class="pf-pr" data-testid="pr-due" label="Show the Payments due tab"
                        hint="The front desk lists every order with an outstanding balance. This branch.">
          <button type="button" class="pf-toggle pf-pr__switch" role="switch" [attr.aria-checked]="showPaymentsDue()" aria-label="Show &quot;Payments due&quot; tab"
                  (click)="setShowPaymentsDue(!showPaymentsDue())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
        <p class="pf-pr__note">Sample collection is never blocked — bill pay-later or part-advance and still draw the tube.</p>
      }
    } @else {
      <p class="pf-pr__hint" data-testid="pr-denied">Payment rules are changed by billing and organization admins.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-pr__scope { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 10.5px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .pf-pr__hint, .pf-pr__note { margin: 10px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.45; }
    .pf-pr__switch { flex: none; }
    @media (pointer: coarse) { :host .pf-pr__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
  `],
})
export class PaymentRulesCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly labCfg = inject(BranchLabConfigService);

  readonly gateOptions = PAYMENT_GATE_OPTIONS;
  readonly gateSeg = PAYMENT_GATE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  gateDesc(): string { return (PAYMENT_GATE_OPTIONS.find((o) => o.value === this.paymentGateStage())?.desc ?? '') + ' This branch.'; }
  readonly loading = signal(true);
  readonly paymentGateStage = signal<PaymentGateStage>('none');
  readonly showPaymentsDue = signal(true);
  /** Revenue policy — billing / organisation admins only (never the Lab Admin (Technical) role). */
  readonly canManage = computed(() => this.auth.hasAnyPermission(PAYMENT_RULE_PERMS));

  ngOnInit() {
    if (!this.canManage()) { this.loading.set(false); return; }
    this.api.get<any>('/api/tenants/branch-lab-config').subscribe({
      next: c => {
        this.paymentGateStage.set(c?.paymentGateStage ?? (c?.requireBillBeforeCollection ? 'dispatch' : 'none'));
        this.showPaymentsDue.set(c?.showPaymentsDueTab !== false);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setPaymentGateStage(v: PaymentGateStage) {
    const prev = this.paymentGateStage();
    if (prev === v) return;
    this.paymentGateStage.set(v);
    const msg = v === 'none' ? 'Payment gate removed'
      : v === 'dispatch' ? 'Full payment now required before dispatch'
      : 'Full payment now required before sharing the report';
    this.api.patch('/api/tenants/branch-lab-config', { paymentGateStage: v }).subscribe({
      next: () => this.toasts.success(msg),
      error: e => { this.paymentGateStage.set(prev); this.toasts.error(ApiError.from(e).message); },
    });
  }

  setShowPaymentsDue(v: boolean) {
    this.showPaymentsDue.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { showPaymentsDueTab: v }).subscribe({
      next: cfg => { if (cfg) this.labCfg.update(cfg); this.toasts.success(v ? '"Payments due" tab shown at the front desk' : '"Payments due" tab hidden'); },
      error: e => { this.showPaymentsDue.set(!v); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
