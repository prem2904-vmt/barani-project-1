import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WaBillingView, WaCredits, WaSettings, WhatsAppService, inr, waPaymentLabel,
} from '../../../core/services/whatsapp.service';
import { ApiError } from '../../../shared/models/api-response.model';

/**
 * Lab settings → "WhatsApp usage & billing". Two modes, decided by the server:
 *
 *  • OWN number — the lab pays Meta directly (Prefrontal is a Tech Provider):
 *    messages + ₹ this / last month (Meta's cost when synced, else an
 *    estimate from the rate table), delivered / read / failed, the payment
 *    chip (set · missing · failed) with "Add or update payment method" deep
 *    linking to the lab's Meta Billing hub + the official steps, the PREPAID
 *    BALANCE (estimated: what the admin confirmed minus our sends since —
 *    Meta exposes no balance API) with "I added funds", and the alert levels.
 *  • SHARED Prefrontal number — no bill for the lab: the message count, and
 *    the CREDITS Prefrontal granted (tracking only) when an allowance is set.
 *
 * Reads the server's cache — never Meta per page; "Refresh usage" is
 * rate-limited on the server. Changes need `manage_tenant`.
 */
@Component({
  selector: 'pf-wa-billing-card',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
    <section class="nd-card pf-wab" data-testid="ls-wa-billing-card" [attr.data-mode]="v.billing.own ? 'own' : 'shared'">
      <div class="nd-card__head">
        <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg></span>
        <h3 class="nd-card__label pf-wab__title">WhatsApp usage &amp; billing</h3>
        <span class="nd-card__spacer"></span>
        @if (v.billing.own) {
          <span class="nd-chip nd-chip--static pf-wab__chip" data-testid="wab-payment" [attr.data-status]="v.billing.payment.status">
            <span class="pf-wab__dot" [attr.data-tone]="payment().tone" aria-hidden="true"></span>{{ payment().label }}
          </span>
        } @else {
          <span class="nd-chip nd-chip--static pf-wab__chip" data-testid="wab-payment" data-status="shared">
            <span class="pf-wab__dot" data-tone="muted" aria-hidden="true"></span>Prefrontal pays
          </span>
        }
      </div>

      <div class="pf-wab__body">
        @if (v.billing.own) {
          <!-- ── Payment health ── -->
          @if (v.billing.payment.status === 'failed' || v.billing.payment.status === 'missing') {
            <div class="pf-wab__alert" role="alert" data-testid="wab-payment-alert" [attr.data-tone]="v.billing.payment.status === 'failed' ? 'bad' : 'wait'">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>
              <div>
                <p class="pf-wab__alert-t">{{ v.billing.payment.status === 'failed' ? 'WhatsApp messages are failing: payment method needed' : 'Add a payment method to your WhatsApp account' }}</p>
                <p class="pf-wab__alert-s">{{ v.billing.payment.reason || (v.billing.payment.status === 'failed'
                  ? 'Meta refused to send from your number because of a payment problem (error 131042): the card was declined, the prepaid funds ran out, or no payment method is attached.'
                  : 'Meta has no payment method for your WhatsApp Business Account yet.') }}</p>
                @if (v.billing.payment.fallingBack) {
                  <p class="pf-wab__alert-s">Until this is fixed, reports go from Prefrontal's shared number.</p>
                }
              </div>
            </div>
          }
          @if (v.billing.currencyWarning) {
            <p class="pf-wab__warn" role="status" data-testid="wab-currency-warning">{{ v.billing.currencyWarning }}</p>
          }

          <!-- ── Usage & spend ── -->
          <dl class="pf-wab__facts" data-testid="wab-usage">
            <div class="pf-wab__fact">
              <dt>This month</dt>
              <dd><strong>{{ v.billing.usage.thisMonth?.messages ?? 0 }}</strong> messages · {{ inr(v.billing.usage.thisMonth?.cost ?? 0) }}
                <span class="pf-wab__src">{{ v.billing.usage.thisMonth?.costSource === 'meta' ? 'from Meta' : 'estimated' }}</span></dd>
            </div>
            <div class="pf-wab__fact">
              <dt>Last month</dt>
              <dd><strong>{{ v.billing.usage.lastMonth?.messages ?? 0 }}</strong> messages · {{ inr(v.billing.usage.lastMonth?.cost ?? 0) }}
                <span class="pf-wab__src">{{ v.billing.usage.lastMonth?.costSource === 'meta' ? 'from Meta' : 'estimated' }}</span></dd>
            </div>
            <div class="pf-wab__fact">
              <dt>Delivered · read · failed</dt>
              <dd data-testid="wab-delivery">{{ v.billing.delivery.thisMonth.delivered }} · {{ v.billing.delivery.thisMonth.read }} · {{ v.billing.delivery.thisMonth.failed }}
                @if (v.billing.delivery.thisMonth.held) { <span class="pf-wab__src">{{ v.billing.delivery.thisMonth.held }} on hold</span> }</dd>
            </div>
            @if (v.billing.spend.monthlyThreshold) {
              <div class="pf-wab__fact">
                <dt>Monthly limit</dt>
                <dd data-testid="wab-limit-progress">{{ v.billing.spend.percent ?? 0 }}% of {{ inr(v.billing.spend.monthlyThreshold) }}</dd>
              </div>
            }
          </dl>
          @if (categories().length) {
            <ul class="pf-wab__cats" data-testid="wab-categories" aria-label="Messages by Meta pricing category this month">
              @for (c of categories(); track c.category) {
                <li class="nd-chip nd-chip--static pf-wab__cat">{{ categoryLabel(c.category) }} <strong>{{ c.volume }}</strong> · {{ inr(c.cost) }}</li>
              }
            </ul>
          }

          <!-- ── Prepaid balance (estimated) ── -->
          <div class="pf-wab__block" data-testid="wab-balance" [attr.data-state]="balanceState()">
            <div class="pf-wab__block-head">
              <span class="pf-wab__block-t">Prepaid balance <span class="pf-wab__src">estimated</span></span>
              @if (canManage()) {
                <button type="button" class="nd-btn nd-btn--secondary pf-wab__btn-sm" data-testid="wab-balance-update" [disabled]="busy()" (click)="updateBalance()">
                  {{ v.billing.balance?.source ? 'I added funds' : 'Start tracking' }}
                </button>
              }
            </div>
            @if (v.billing.balance?.source; as src) {
              <p class="pf-wab__big" data-testid="wab-balance-amount">{{ inr(v.billing.balance!.estimated) }}
                @if (v.billing.balance!.isOut) { <span class="nd-chip nd-chip--static pf-wab__flag" data-tone="bad">Used up</span> }
                @else if (v.billing.balance!.isLow) { <span class="nd-chip nd-chip--static pf-wab__flag" data-tone="wait">Low</span> }
              </p>
              <p class="pf-wab__hint">You confirmed {{ inr(v.billing.balance!.reported) }} on {{ date(v.billing.balance!.reportedAt) }}; Prefrontal sent
                {{ v.billing.balance!.messagesSince }} message(s) from your number since, about {{ inr(v.billing.balance!.spentSince) }} at Meta's utility rate.
                Meta does not share the exact balance — check it at Meta and press <em>I added funds</em> after each top-up.</p>
            } @else {
              <p class="pf-wab__hint">Meta does not share your prepaid balance with apps. Tell us what you added and we'll estimate what's left from the messages we send, and warn you before it runs out.</p>
            }
          </div>

          <!-- ── Pay at Meta ── -->
          <div class="pf-wab__actions">
            <a class="nd-btn nd-btn--primary pf-wab__btn" data-testid="wab-add-payment" [href]="v.billing.links.paymentMethods" target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
              {{ v.billing.payment.status === 'set' ? 'Add funds or update payment method' : 'Add or update payment method' }}
            </a>
            <a class="nd-btn nd-btn--secondary pf-wab__btn" data-testid="wab-account-billing" [href]="v.billing.links.accountBilling" target="_blank" rel="noopener noreferrer">Billing &amp; payments at Meta</a>
            <button type="button" class="nd-btn nd-btn--secondary pf-wab__btn" data-testid="wab-steps-toggle" (click)="showSteps.set(!showSteps())" [attr.aria-expanded]="showSteps()">
              {{ showSteps() ? 'Hide steps' : 'How to pay Meta' }}
            </button>
          </div>
          @if (!v.billing.links.precise) {
            <p class="pf-wab__hint">We don't know your Meta business id yet — the link opens Meta's Billing hub; pick your WhatsApp account there. Press Check status on the number card to fetch it.</p>
          }
          @if (showSteps()) {
            <ol class="pf-wab__steps" data-testid="wab-steps">
              @for (s of v.billing.steps; track $index) { <li>{{ s }}</li> }
              <li>Prepaid (India, INR): on the account's Billing &amp; payments page choose <strong>Add funds</strong> and pay with a card, UPI or net banking; then press <em>I added funds</em> here.</li>
            </ol>
            <p class="pf-wab__hint">Meta's articles: <a [href]="v.billing.links.helpAddPaymentMethod" target="_blank" rel="noopener noreferrer">Add a card</a> ·
              <a [href]="v.billing.links.helpAboutBilling" target="_blank" rel="noopener noreferrer">About billing</a> ·
              <a [href]="v.billing.links.helpPaymentThreshold" target="_blank" rel="noopener noreferrer">Payment threshold</a> ·
              <a [href]="v.billing.links.insights" target="_blank" rel="noopener noreferrer">Meta's own usage view</a></p>
          }

          <!-- ── Alert levels ── -->
          @if (canManage()) {
            <div class="pf-wab__block" data-testid="wab-thresholds">
              <span class="pf-wab__block-t">Alerts</span>
              <div class="pf-wab__fields">
                <label class="pf-wab__field">
                  <span class="nd-field__lbl">Monthly spend limit (₹, blank = off)</span>
                  <input class="nd-input" type="text" inputmode="decimal" autocomplete="off" data-testid="wab-limit"
                         [ngModel]="limitText()" (ngModelChange)="limitText.set($event)" [disabled]="busy()" placeholder="e.g. 500" />
                </label>
                <label class="pf-wab__field">
                  <span class="nd-field__lbl">Warn when the estimated balance is below (₹)</span>
                  <input class="nd-input" type="text" inputmode="decimal" autocomplete="off" data-testid="wab-lowlevel"
                         [ngModel]="lowText()" (ngModelChange)="lowText.set($event)" [disabled]="busy()" placeholder="200" />
                </label>
                <button type="button" class="nd-btn nd-btn--secondary pf-wab__btn" data-testid="wab-save-thresholds" [disabled]="busy() || !thresholdsDirty()" (click)="saveThresholds()">Save alerts</button>
              </div>
              <p class="pf-wab__hint">Alerts go to lab admins: at 80 % and 100 % of the monthly limit (once a month), when the estimated balance drops below the level, and whenever Meta refuses a message for payment.</p>
            </div>
          }
        } @else {
          <!-- ── Shared Prefrontal number ── -->
          <p class="pf-wab__lead">
            Reports go from <strong>Prefrontal's shared WhatsApp number</strong> — there is nothing for you to pay Meta.
            This month: <strong data-testid="wab-shared-count">{{ v.billing.delivery.thisMonth.shared }}</strong> sent
            ({{ v.billing.delivery.thisMonth.delivered }} delivered, {{ v.billing.delivery.thisMonth.read }} read, {{ v.billing.delivery.thisMonth.failed }} failed@if (v.billing.delivery.thisMonth.held) {, {{ v.billing.delivery.thisMonth.held }} on hold}).
          </p>
        }

        <!-- ── Shared-number credits (tracking only) ── -->
        @if (v.credits.tracked && (!v.billing.own || v.billing.payment.fallingBack)) {
          <div class="pf-wab__block" data-testid="wab-credits" [attr.data-state]="v.credits.isExhausted ? 'exhausted' : v.credits.isLow ? 'low' : 'ok'">
            <div class="pf-wab__block-head">
              <span class="pf-wab__block-t">Message credits on the shared number</span>
              @if (v.credits.isExhausted) { <span class="nd-chip nd-chip--static pf-wab__flag" data-tone="bad">Used up</span> }
              @else if (v.credits.isLow) { <span class="nd-chip nd-chip--static pf-wab__flag" data-tone="wait">Running low</span> }
            </div>
            <p class="pf-wab__big" data-testid="wab-credits-balance">{{ v.credits.balance ?? 0 }} <span class="pf-wab__src">credits left</span></p>
            <p class="pf-wab__hint">{{ v.credits.usedThisMonth }} used this month · one credit per message sent from the shared number.
              @if (v.credits.isExhausted) { <strong>Report messages are on hold and Send WhatsApp is paused until Prefrontal adds credits.</strong> }
              Contact Prefrontal to add credits.</p>
          </div>
        } @else if (!v.billing.own) {
          <p class="pf-wab__hint" data-testid="wab-credits-untracked">Prefrontal pays for these messages. Connect your own WhatsApp number (card above) to see Meta's charges here.</p>
        }

        <div class="pf-wab__foot">
          <span class="pf-wab__synced" data-testid="wab-synced">
            @if (v.billing.own) {
              {{ v.billing.usage.syncedAt ? 'Usage synced ' + date(v.billing.usage.syncedAt) : 'Usage not synced from Meta yet' }}
              @if (v.billing.usage.syncError) { · <span class="pf-wab__err">{{ v.billing.usage.syncError }}</span> }
              · {{ v.billing.rates.note }}
            } @else {
              Counts from this app's own message log.
            }
          </span>
          @if (v.billing.own && canManage()) {
            <button type="button" class="nd-btn nd-btn--secondary pf-wab__btn-sm" data-testid="wab-refresh" [disabled]="busy()" (click)="refresh()">Refresh usage</button>
          }
        </div>
      </div>
    </section>
    } @else if (error()) {
      <p class="pf-note pf-note--err pf-wab__load-err" role="alert" data-testid="ls-wa-billing-error">{{ error() }}</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-wab { margin-bottom: 16px; }
    .pf-wab__title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-wab__chip { height: auto; min-height: 28px; gap: 6px; white-space: nowrap; }
    .pf-wab__body { padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
    .pf-wab__lead, .pf-wab__hint { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--text-secondary); }
    .pf-wab__lead strong, .pf-wab__hint strong { color: var(--text-primary); font-weight: 600; }
    .pf-wab__hint { color: var(--text-tertiary); }
    .pf-wab__hint a { color: var(--color-violet-500, #7c3aed); text-decoration: underline; }
    .pf-wab__src { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); margin-left: 4px; }
    .pf-wab__err { color: #b91c1c; }
    .pf-wab__dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; background: var(--text-tertiary, #94a3b8); flex-shrink: 0; }
    .pf-wab__dot[data-tone='ok']   { background: var(--color-violet-500, #7c3aed); }
    .pf-wab__dot[data-tone='wait'] { background: #d97706; }
    .pf-wab__dot[data-tone='bad']  { background: #dc2626; }

    .pf-wab__alert { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--nd-radius, 12px);
      border: 1px solid rgba(220, 38, 38, 0.35); background: rgba(220, 38, 38, 0.06); color: #b91c1c; }
    .pf-wab__alert[data-tone='wait'] { border-color: rgba(217, 119, 6, 0.4); background: rgba(217, 119, 6, 0.08); color: #b45309; }
    .pf-wab__alert svg { flex-shrink: 0; margin-top: 1px; }
    .pf-wab__alert-t { margin: 0; font-size: 13px; font-weight: 600; }
    .pf-wab__alert-s { margin: 2px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-wab__warn { margin: 0; padding: 10px 12px; border-radius: var(--nd-radius, 12px); font-size: 12.5px; line-height: 1.5;
      border: 1px solid rgba(217, 119, 6, 0.4); background: rgba(217, 119, 6, 0.08); color: #b45309; }

    .pf-wab__facts { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 16px; }
    .pf-wab__fact { min-width: 0; }
    .pf-wab__fact dt { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-wab__fact dd { margin: 3px 0 0; font-size: 13.5px; color: var(--text-primary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .pf-wab__cats { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-wab__cat { height: auto; min-height: 28px; gap: 4px; }

    .pf-wab__block { border-top: 1px solid var(--nd-line, rgba(148,163,184,0.25)); padding-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    .pf-wab__block-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .pf-wab__block-t { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-wab__big { margin: 0; font-size: 22px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-wab__flag { height: auto; min-height: 24px; font-size: 11.5px; }
    .pf-wab__flag[data-tone='bad'] { color: #b91c1c; }
    .pf-wab__flag[data-tone='wait'] { color: #b45309; }
    .pf-wab__block[data-state='out'] .pf-wab__big, .pf-wab__block[data-state='exhausted'] .pf-wab__big { color: #b91c1c; }

    .pf-wab__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-wab__btn { min-height: 40px; display: inline-flex; align-items: center; gap: 8px; text-decoration: none; }
    .pf-wab__btn-sm { min-height: 36px; }
    .pf-wab__steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-wab__fields { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; }
    .pf-wab__field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 220px; min-width: 0; }
    .pf-wab__field .nd-input { font-size: 16px; }
    .pf-wab__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; border-top: 1px solid var(--nd-line, rgba(148,163,184,0.25)); padding-top: 10px; }
    .pf-wab__synced { font-size: 11.5px; color: var(--text-tertiary); line-height: 1.5; }
    .pf-wab__load-err { margin: 0 0 16px; }

    :host-context([data-theme='dark']) .pf-wab__alert { color: #fca5a5; border-color: rgba(248,113,113,0.4); background: rgba(248,113,113,0.08); }
    :host-context([data-theme='dark']) .pf-wab__alert[data-tone='wait'], :host-context([data-theme='dark']) .pf-wab__warn { color: #fcd34d; border-color: rgba(251,191,36,0.4); background: rgba(251,191,36,0.08); }
    :host-context([data-theme='dark']) .pf-wab__err, :host-context([data-theme='dark']) .pf-wab__flag[data-tone='bad'] { color: #fca5a5; }

    @media (max-width: 640px) {
      .pf-wab__body { padding: 12px 14px 16px; }
      .pf-wab__actions { flex-direction: column; }
      .pf-wab__btn { width: 100%; min-height: 44px; justify-content: center; }
      .pf-wab__facts { grid-template-columns: 1fr; }
    }
  `],
})
export class WaBillingCardComponent implements OnInit {
  /** The settings card's data — a change of connection state reloads the billing view. */
  readonly settings = input.required<WaSettings>();

  private readonly wa = inject(WhatsAppService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);

  protected readonly view = signal<WaBillingView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly showSteps = signal(false);
  protected readonly limitText = signal('');
  protected readonly lowText = signal('');

  readonly canManage = computed(() => this.auth.hasPermission('manage_tenant'));
  protected readonly payment = computed(() => waPaymentLabel(this.view()?.billing.payment.status));
  protected readonly categories = computed(() => this.view()?.billing.usage.thisMonth?.byCategory ?? []);
  protected readonly balanceState = computed(() => {
    const b = this.view()?.billing.balance;
    if (!b?.source) return 'none';
    return b.isOut ? 'out' : b.isLow ? 'low' : 'ok';
  });
  protected readonly thresholdsDirty = computed(() => {
    const v = this.view();
    if (!v) return false;
    return this.limitText().trim() !== numText(v.billing.spend.monthlyThreshold)
      || this.lowText().trim() !== numText(v.billing.balance?.threshold ?? null);
  });

  private lastKey = '';
  constructor() {
    effect(() => {
      const s = this.settings().sender;
      const key = `${s?.state ?? ''}|${s?.phoneNumberId ?? ''}|${s?.paymentStatus ?? ''}`;
      if (this.lastKey && key !== this.lastKey) this.load();
      this.lastKey = key;
    });
  }

  ngOnInit() { this.load(); }

  protected inr = inr;
  protected date(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  protected categoryLabel(c: string): string {
    switch (c) {
      case 'utility': return 'Utility';
      case 'marketing': return 'Marketing';
      case 'authentication': return 'Authentication';
      case 'authentication_international': return 'Authentication (intl)';
      case 'service': return 'Service';
      default: return c;
    }
  }

  private load() {
    this.wa.billing().subscribe({
      next: v => {
        if (!v || typeof v !== 'object' || !('billing' in v) || !v.billing) { this.view.set(null); return; }
        this.apply(v);
      },
      error: e => { this.view.set(null); this.error.set(ApiError.from(e).message || 'Could not load WhatsApp billing.'); },
    });
  }

  private apply(v: WaBillingView) {
    this.view.set(v);
    this.error.set(null);
    this.limitText.set(numText(v.billing.spend.monthlyThreshold));
    this.lowText.set(numText(v.billing.balance?.threshold ?? null));
  }

  refresh() {
    if (this.busy()) return;
    this.busy.set(true);
    this.wa.refreshBilling().subscribe({
      next: v => { this.busy.set(false); this.apply(v); this.toasts.success('WhatsApp usage refreshed'); },
      error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  saveThresholds() {
    if (this.busy()) return;
    const limit = parseAmount(this.limitText());
    const low = parseAmount(this.lowText());
    if (limit === undefined || low === undefined) { this.toasts.error('Enter amounts in rupees (numbers only).'); return; }
    this.busy.set(true);
    this.wa.saveBillingSettings({ monthlySpendThreshold: limit, lowBalanceThreshold: low ?? 200 }).subscribe({
      next: v => { this.busy.set(false); this.apply(v); this.toasts.success('WhatsApp alert levels saved'); },
      error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  /** "I added funds": the prepaid amount now on the account (Meta's page shows it). */
  async updateBalance() {
    if (this.busy()) return;
    const cur = this.view()?.billing.balance;
    const raw = await this.dialog.prompt({
      title: cur?.source ? 'What is on your WhatsApp account now?' : 'Track your prepaid balance',
      message: 'Open Billing & payments at Meta, read the balance after your top-up and enter it here in rupees. We estimate what is left from the messages we send.',
      placeholder: 'e.g. 500',
      confirmLabel: 'Save',
      tone: 'primary',
    });
    if (raw === null) return;
    const amount = parseAmount(raw);
    if (amount === undefined || amount === null) { this.toasts.error('Enter the amount in rupees (numbers only).'); return; }
    this.busy.set(true);
    this.wa.setBillingBalance(amount).subscribe({
      next: v => { this.busy.set(false); this.apply(v); this.toasts.success(`Prepaid balance set to ${inr(amount)} — we'll estimate from here`); },
      error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}

/** "" ↔ null; a rupee amount as typed. `undefined` = not a number. */
export function parseAmount(s: string | null | undefined): number | null | undefined {
  const t = (s ?? '').replace(/[₹,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

function numText(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n);
}

/** Type re-export for the admin console's credits card. */
export type { WaCredits };
