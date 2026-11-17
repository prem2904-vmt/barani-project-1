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
  imports: [SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canManage()) {
      @if (loading()) {
        <pf-skeleton-card [lines]="3" label="Loading payment rules…"></pf-skeleton-card>
      } @else {
        <section class="pf-card pf-pr" data-testid="pr-gate">
          <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg></span><h3 class="pf-card__label pf-pr__title">Require full payment to progress</h3><span class="pf-pr__scope" title="Applies to the branch you are signed in to">This branch</span></div>
          <div class="pf-pr__body">
            <p class="pf-pr__hint">
              Choose where an unpaid balance blocks the workflow. Sample <em>collection</em> is never blocked —
              you can bill pay-later / part-advance and still draw the tube; the difference is settled at the gate.
            </p>
            <div class="pf-pr__gate" role="radiogroup" aria-label="Require full payment">
              @for (opt of gateOptions; track opt.value) {
                <button type="button" class="pf-pr__opt" role="radio" [attr.aria-checked]="paymentGateStage() === opt.value"
                        (click)="setPaymentGateStage(opt.value)">
                  <span class="pf-pr__radio"></span>
                  <span class="pf-pr__text">
                    <span class="pf-pr__t">{{ opt.label }}</span>
                    <span class="pf-pr__s">{{ opt.desc }}</span>
                  </span>
                </button>
              }
            </div>
          </div>
        </section>

        <section class="pf-card pf-pr" data-testid="pr-due">
          <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg></span><h3 class="pf-card__label pf-pr__title">Show "Payments due" tab</h3><span class="pf-pr__scope" title="Applies to the branch you are signed in to">This branch</span><span class="pf-card__spacer"></span>
            <button type="button" class="pf-toggle pf-pr__switch" role="switch" [attr.aria-checked]="showPaymentsDue()" aria-label="Show &quot;Payments due&quot; tab"
                    (click)="setShowPaymentsDue(!showPaymentsDue())">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
          </div>
          <div class="pf-pr__body">
            <p class="pf-pr__hint">
              When ON, the front-desk shows a <strong>Payments due</strong> tab listing every order with an
              outstanding balance. In Progress and Completed are always shown. Leave OFF to hide it.
            </p>
          </div>
        </section>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-pr { margin-bottom: 16px; overflow: visible; }
    .pf-pr__title { margin: 0; font-size: 13px; }
    .pf-pr__scope { margin-left: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 11px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .pf-pr__body { padding: 14px 18px 18px; }
    .pf-pr__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-pr__switch { flex: none; }
    .pf-pr__gate { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .pf-pr__opt { display: flex; align-items: flex-start; gap: 12px; text-align: left; padding: 12px 14px; border-radius: var(--pf-radius); background: var(--pf-card-bg); border: 1px solid var(--pf-line); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
    .pf-pr__opt:hover { border-color: var(--pf-sel-border); }
    .pf-pr__opt[aria-checked='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-pr__opt:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-pr__radio { flex-shrink: 0; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; border: 2px solid var(--border-input, #cbd5e1); position: relative; transition: border-color .15s ease; }
    .pf-pr__opt[aria-checked='true'] .pf-pr__radio { border-color: var(--color-violet-500, #7c3aed); }
    .pf-pr__opt[aria-checked='true'] .pf-pr__radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--color-violet-500, #7c3aed); }
    .pf-pr__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-pr__t { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-pr__s { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }
    @media (pointer: coarse) { :host .pf-pr__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
  `],
})
export class PaymentRulesCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly labCfg = inject(BranchLabConfigService);

  readonly gateOptions = PAYMENT_GATE_OPTIONS;
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
