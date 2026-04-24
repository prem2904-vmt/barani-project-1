import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type PayMode = 'upi' | 'card' | 'cash' | 'wallet' | 'split' | 'later';

interface PayModeDef {
  id: PayMode;
  label: string;
  hint: string;
  iconPath: string;
}

const PAY_MODES: PayModeDef[] = [
  { id: 'upi',    label: 'UPI',       hint: 'Scan QR',        iconPath: 'M12 4v16M5 8h14M5 16h14' },
  { id: 'card',   label: 'Card',      hint: 'Tap / Insert',   iconPath: 'M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 11h18' },
  { id: 'cash',   label: 'Cash',      hint: 'Collect note',   iconPath: 'M3 6h18v12H3zM7 12a5 3 0 0 1 10 0 5 3 0 0 1-10 0Z' },
  { id: 'wallet', label: 'Wallet',    hint: 'Paytm/PhonePe',  iconPath: 'M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14M17 14h.01' },
  { id: 'split',  label: 'Split',     hint: 'Mixed modes',    iconPath: 'M6 3v18M18 3v18M3 12h18' },
  { id: 'later',  label: 'Pay later', hint: 'On report',      iconPath: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
];

const QUICK_ADD = [100, 200, 500, 1000, 2000, 5000];

@Component({
  selector: 'pf-billing',
  standalone: true,
  imports: [
    CurrencyInrPipe,
    NumPadComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Frontdesk · Billing"
        title="Collect payment"
        [subtitle]="subtitle()">
        <!-- Admin toggle: when OFF, the Order tab stops auto-routing here
             after save and raises a billing request instead. Flag is
             persisted in localStorage via FrontdeskSettingsService. -->
        <label actions class="pf-collect-toggle" title="Frontdesk collects payment">
          <input type="checkbox"
                 [checked]="collectsBilling()"
                 (change)="setCollectsBilling($any($event.target).checked)" />
          <span>Frontdesk collects</span>
        </label>
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
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-5 items-start">

          <!-- LEFT: invoice preview -->
          <div class="space-y-5">
            <pf-tile tone="default" padding="lg" class="block">
              <div class="flex items-center justify-between mb-4">
                <div>
                  <p class="pf-eyebrow">Invoice</p>
                  <p class="pf-bill-no">{{ invoiceNumber() }}</p>
                </div>
                <div class="text-right">
                  <p class="pf-eyebrow">Due</p>
                  <p class="pf-bill-total">{{ effectivePayable() | inr }}</p>
                </div>
              </div>

              <ul class="pf-bill-items">
                @for (item of b.items; track item.id) {
                  <li class="pf-bill-row">
                    <span class="pf-bill-code">{{ item.hsnSacCode ?? '—' }}</span>
                    <span class="pf-bill-name">{{ item.testName }}</span>
                    <span class="pf-bill-amount">{{ item.total | inr }}</span>
                  </li>
                }
              </ul>

              <div class="pf-bill-totals">
                <div class="pf-bill-line">
                  <span>Subtotal</span>
                  <span class="tabular-nums">{{ b.subTotal | inr }}</span>
                </div>
                @if (b.totalTax > 0) {
                  <div class="pf-bill-line">
                    <span>GST</span>
                    <span class="tabular-nums">{{ b.totalTax | inr }}</span>
                  </div>
                }
                <div class="pf-bill-line pf-bill-line--discount">
                  <span>Discount</span>
                  <div class="pf-discount">
                    <input type="text"
                           inputmode="numeric"
                           [value]="discount()"
                           (input)="setDiscount(asInput($event))"
                           class="pf-discount__input"
                           placeholder="0"/>
                    <span class="pf-discount__rupee">₹</span>
                  </div>
                </div>
                <div class="pf-bill-line pf-bill-line--total">
                  <span>Total</span>
                  <span class="tabular-nums">{{ effectivePayable() | inr }}</span>
                </div>
              </div>
            </pf-tile>

            <!-- Payment mode grid -->
            <div>
              <p class="pf-eyebrow mb-3 px-1">Payment mode</p>
              <div class="grid grid-cols-3 gap-2">
                @for (m of modes; track m.id) {
                  <button type="button"
                          (click)="setMode(m.id)"
                          class="pf-mode"
                          [class.pf-mode--on]="mode() === m.id">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path [attr.d]="m.iconPath"/>
                    </svg>
                    <span class="pf-mode__label">{{ m.label }}</span>
                    <span class="pf-mode__hint">{{ m.hint }}</span>
                  </button>
                }
              </div>
            </div>
          </div>

          <!-- RIGHT: per-mode payment panel -->
          <div>
            <pf-tile tone="default" padding="lg" class="block min-h-[540px]">
              @switch (mode()) {
                @case ('upi') {
                  <div class="flex flex-col items-center text-center py-6">
                    <p class="pf-eyebrow mb-2">Scan to pay</p>
                    <p class="pf-big-amount mb-6">{{ effectivePayable() | inr }}</p>
                    <div class="pf-qr">
                      <div class="pf-qr__grid">
                        @for (i of qrCells; track i) {
                          <span class="pf-qr__cell" [style.background]="qrFill(i)"></span>
                        }
                      </div>
                    </div>
                    <p class="pf-qr__hint mt-5">prefrontal&#64;upi · Chennai Main</p>
                    <p class="pf-live">
                      <span class="pf-live__dot"></span>
                      Listening for payment…
                    </p>
                  </div>
                }
                @case ('card') {
                  <div class="flex flex-col items-center text-center py-6">
                    <p class="pf-eyebrow mb-2">Tap or insert card</p>
                    <p class="pf-big-amount mb-10">{{ effectivePayable() | inr }}</p>
                    <div class="pf-card-mock">
                      <span class="pf-card-chip"></span>
                      <span class="pf-card-wave"></span>
                      <p class="pf-card-pan">•••• •••• •••• 4242</p>
                      <p class="pf-card-foot">TAP TO PAY</p>
                    </div>
                    <p class="pf-live mt-8">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
                      </svg>
                      Waiting for card…
                    </p>
                  </div>
                }
                @case ('cash') {
                  <div>
                    <p class="pf-eyebrow mb-2">Cash tendered</p>
                    <p class="pf-big-amount mb-4">{{ cashAmountNum() | inr }}</p>

                    <div class="grid grid-cols-2 gap-3 mb-4">
                      <div class="pf-cash-chip">
                        <p class="pf-cash-chip__label">Due</p>
                        <p class="pf-cash-chip__value">{{ effectivePayable() | inr }}</p>
                      </div>
                      <div class="pf-cash-chip" [attr.data-kind]="changeAmount() >= 0 ? 'ok' : 'short'">
                        <p class="pf-cash-chip__label">{{ changeAmount() >= 0 ? 'Change' : 'Short' }}</p>
                        <p class="pf-cash-chip__value">{{ changeAbs() | inr }}</p>
                      </div>
                    </div>

                    <div class="grid grid-cols-4 gap-2 mb-4">
                      @for (d of quickAdd; track d) {
                        <button type="button" (click)="addCash(d)" class="pf-cash-btn press">+{{ d }}</button>
                      }
                      <button type="button" (click)="setCashExact()" class="pf-cash-btn pf-cash-btn--accent press">Exact</button>
                      <button type="button" (click)="clearCash()" class="pf-cash-btn press">Clear</button>
                    </div>

                    <pf-num-pad
                      [value]="cashAmount()"
                      [allowDecimal]="false"
                      [compact]="true"
                      (valueChange)="setCash($event)"></pf-num-pad>
                  </div>
                }
                @default {
                  <div class="flex flex-col items-center justify-center text-center py-16">
                    <div class="pf-placeholder-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path [attr.d]="currentModeDef()?.iconPath"/>
                      </svg>
                    </div>
                    <p class="text-[22px] font-semibold" style="color: var(--text-primary);">{{ currentModeDef()?.label }}</p>
                    <p class="text-[13px] mt-2 max-w-[280px]" style="color: var(--text-tertiary);">
                      @switch (mode()) {
                        @case ('wallet') { Follow the wallet app prompts to complete the payment. }
                        @case ('split')  { Collect each portion on the terminal, then confirm below. }
                        @case ('later')  { Mark as pending. Invoice will be sent on the report. }
                        @default { Follow on-screen prompts to complete the payment. }
                      }
                    </p>
                    @if (mode() === 'split' || mode() === 'wallet') {
                      <label class="pf-ref-row mt-6">
                        <span>Reference no.</span>
                        <input type="text"
                               [value]="referenceNo()"
                               (input)="setReferenceNo(asInput($event))"
                               placeholder="UTR / transaction id"
                               class="pf-ref-input"/>
                      </label>
                    }
                  </div>
                }
              }

              <pf-touch-btn size="xl" variant="primary" [full]="true"
                            (pressed)="confirm()"
                            [disabled]="saving() || !canConfirm()"
                            class="mt-6 block">
                <span icon-left>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m5 12 4 4L19 6"/>
                  </svg>
                </span>
                @if (mode() === 'later') { Mark as pay-later · {{ effectivePayable() | inr }} }
                @else { Confirm payment · {{ effectivePayable() | inr }} }
              </pf-touch-btn>
            </pf-tile>
          </div>

        </div>
      } @else {
        <pf-tile tone="default" padding="xl" class="block">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">Generating bill…</p>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    /* Admin flag in the header: "Frontdesk collects" toggles whether the
     * Order tab routes here automatically after save. */
    .pf-collect-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
    }
    .pf-collect-toggle:hover { background: var(--glass-bg-hover); }
    .pf-collect-toggle input[type="checkbox"] {
      width: 14px;
      height: 14px;
      accent-color: #a855f7;
    }

    .pf-eyebrow {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .pf-bill-no {
      margin: 2px 0 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-bill-total {
      margin: 2px 0 0;
      font-size: 18px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }

    .pf-bill-items {
      list-style: none;
      padding: 0;
      margin: 0 0 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-bill-row {
      display: grid;
      grid-template-columns: 56px 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-bill-code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      color: var(--text-muted);
    }
    .pf-bill-name { font-size: 13.5px; color: var(--text-primary); }
    .pf-bill-amount { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-primary); }

    .pf-bill-totals {
      padding-top: 14px;
      border-top: 1px solid var(--border-muted);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pf-bill-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .pf-bill-line--discount span { color: var(--text-secondary); }
    .pf-bill-line--total {
      margin-top: 6px;
      padding-top: 12px;
      border-top: 1px solid var(--border-muted);
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .pf-discount {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .pf-discount__input {
      width: 140px;
      height: 40px;
      padding: 0 30px 0 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13.5px;
      font-variant-numeric: tabular-nums;
      text-align: right;
      outline: none;
    }
    .pf-discount__input:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
    .pf-discount__rupee {
      position: absolute;
      right: 10px;
      color: var(--text-muted);
      font-size: 12px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      pointer-events: none;
    }

    /* Payment mode tiles */
    .pf-mode {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 14px 14px 14px 14px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.08s, box-shadow 0.25s;
    }
    .pf-mode:hover {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }
    .pf-mode:active { transform: scale(0.98); }
    .pf-mode svg {
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .pf-mode__label {
      font-size: 14px;
      font-weight: 600;
    }
    .pf-mode__hint {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .pf-mode--on {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
    }
    .pf-mode--on svg { color: #ffffff; }
    .pf-mode--on .pf-mode__hint { color: rgba(255, 255, 255, 0.75); }

    /* Big amount display */
    .pf-big-amount {
      font-size: 44px;
      line-height: 1;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    /* Cash panel chips */
    .pf-cash-chip {
      padding: 14px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-cash-chip__label {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-cash-chip__value {
      margin: 4px 0 0;
      font-size: 22px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    .pf-cash-chip[data-kind='ok'] {
      background: rgba(16, 185, 129, 0.14);
      border-color: rgba(16, 185, 129, 0.3);
    }
    .pf-cash-chip[data-kind='ok'] .pf-cash-chip__value { color: #34d399; }
    .pf-cash-chip[data-kind='short'] {
      background: rgba(239, 68, 68, 0.14);
      border-color: rgba(239, 68, 68, 0.3);
    }
    .pf-cash-chip[data-kind='short'] .pf-cash-chip__value { color: #f87171; }

    .pf-cash-btn {
      height: 48px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition: background 0.15s, transform 80ms, filter 80ms;
    }
    .pf-cash-btn:hover { background: var(--glass-bg-hover); }
    .pf-cash-btn--accent {
      background: rgba(124, 58, 237, 0.15);
      border-color: rgba(124, 58, 237, 0.35);
      color: #c4b5fd;
    }
    :root.light .pf-cash-btn--accent { color: #6d28d9; }

    /* UPI QR */
    .pf-qr {
      width: 224px;
      height: 224px;
      padding: 20px;
      border-radius: 24px;
      background: #ffffff;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }
    .pf-qr__grid {
      width: 100%;
      height: 100%;
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      grid-template-rows: repeat(12, 1fr);
      gap: 1px;
    }
    .pf-qr__cell { border-radius: 1px; }
    .pf-qr__hint {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .pf-live {
      margin: 8px 0 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #34d399;
    }
    .pf-live__dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: #34d399;
      animation: pf-live-pulse 1.6s ease-in-out infinite;
    }
    @keyframes pf-live-pulse {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50%      { opacity: 1;   transform: scale(1.25); box-shadow: 0 0 10px rgba(52, 211, 153, 0.9); }
    }

    /* Card mockup */
    .pf-card-mock {
      position: relative;
      width: 260px;
      height: 160px;
      border-radius: 20px;
      background: linear-gradient(135deg, #7c3aed, #ec4899);
      box-shadow: 0 20px 60px rgba(124, 58, 237, 0.45);
      padding: 20px;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .pf-card-chip {
      width: 36px;
      height: 26px;
      border-radius: 6px;
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.25);
    }
    .pf-card-wave {
      position: absolute;
      top: 22px;
      right: 20px;
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background:
        radial-gradient(circle at 50% 50%, transparent 0 4px, rgba(255, 255, 255, 0.65) 4px 6px, transparent 6px 9px, rgba(255, 255, 255, 0.45) 9px 11px, transparent 11px 14px);
    }
    .pf-card-pan {
      margin: 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 15px;
      letter-spacing: 0.18em;
    }
    .pf-card-foot {
      margin: 4px 0 0;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      opacity: 0.8;
    }

    /* Placeholder panel */
    .pf-placeholder-icon {
      width: 72px;
      height: 72px;
      border-radius: 24px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      margin-bottom: 14px;
    }

    /* Reference no. input */
    .pf-ref-row {
      display: inline-flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
      text-align: left;
    }
    .pf-ref-row > span {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-ref-input {
      width: 260px;
      height: 44px;
      padding: 0 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 14px;
      outline: none;
    }
    .pf-ref-input:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
  `]
})
export class BillingComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly settings = inject(FrontdeskSettingsService);

  readonly collectsBilling = this.settings.collectsBilling;
  setCollectsBilling(v: boolean) { this.settings.setCollectsBilling(v); }

  readonly modes = PAY_MODES;
  readonly quickAdd = QUICK_ADD;
  // 144-cell pseudo-QR renders once from this array.
  readonly qrCells = Array.from({ length: 144 }, (_, i) => i);

  private readonly _order = signal<Order | null>(null);
  private readonly _bill = signal<Bill | null>(null);
  private readonly _saving = signal(false);
  private readonly _mode = signal<PayMode>('upi');
  private readonly _cash = signal<string>('');
  private readonly _discount = signal<string>('');
  private readonly _referenceNo = signal<string>('');

  readonly order = this._order.asReadonly();
  readonly bill = this._bill.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly mode = this._mode.asReadonly();
  readonly cashAmount = this._cash.asReadonly();
  readonly discount = this._discount.asReadonly();
  readonly referenceNo = this._referenceNo.asReadonly();

  readonly discountNum = computed(() => {
    const n = parseInt(this._discount() || '0', 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
  });
  readonly effectivePayable = computed(() => {
    const b = this._bill();
    if (!b) return 0;
    return Math.max(0, b.totalPayable - this.discountNum());
  });
  readonly cashAmountNum = computed(() => {
    const n = parseInt(this._cash() || '0', 10);
    return Number.isNaN(n) ? 0 : n;
  });
  readonly changeAmount = computed(() => this.cashAmountNum() - this.effectivePayable());
  readonly changeAbs = computed(() => Math.abs(this.changeAmount()));

  readonly currentModeDef = computed(() => this.modes.find(m => m.id === this._mode()) ?? null);

  readonly subtitle = computed(() => {
    const p = this._order()?.patient;
    if (!p) return 'Choose a payment mode and confirm the total.';
    return `${p.displayName} · ${p.phone ?? ''}`.trim();
  });

  readonly invoiceNumber = computed(() => {
    const b = this._bill();
    if (!b) return '—';
    const shortId = b.id.replace(/-/g, '').slice(-8).toUpperCase();
    return `INV-${shortId}`;
  });

  readonly canConfirm = computed(() => {
    const m = this._mode();
    if (m === 'cash') return this.cashAmountNum() >= this.effectivePayable();
    return this.effectivePayable() >= 0;
  });

  ngOnInit() {
    const orderId = this.route.snapshot.queryParamMap.get('orderId');
    if (!orderId) { this.toasts.error('No order id'); this.router.navigateByUrl('/frontdesk'); return; }

    this.api.get<Order>(`/api/orders/${orderId}`).subscribe({ next: o => this._order.set(o) });
    this.api.post<Bill>('/api/billing/', { orderId, discount: 0 }).subscribe({
      next: b => this._bill.set(b),
      error: e => this.toasts.error(e.message ?? 'Could not create bill')
    });
  }

  setMode(m: PayMode) { this._mode.set(m); }
  setCash(v: string) { this._cash.set(v); }
  addCash(n: number) { this._cash.update(cur => String((parseInt(cur || '0', 10) || 0) + n)); }
  setCashExact() { this._cash.set(String(this.effectivePayable())); }
  clearCash() { this._cash.set(''); }

  setDiscount(v: string) {
    this._discount.set(v.replace(/[^\d]/g, ''));
  }
  setReferenceNo(v: string) { this._referenceNo.set(v); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  /** 144-cell pseudo-QR — same formula as the reference for visual parity. */
  qrFill(i: number): string {
    const on = (Math.sin(i * 7.13) + Math.cos(i * 3.71)) > 0.2;
    return on ? '#0f1827' : 'transparent';
  }

  confirm() {
    const b = this._bill();
    if (!b || this._saving()) return;
    if (!this.canConfirm()) {
      this.toasts.warning('Enter an amount at least equal to the total due.');
      return;
    }

    this._saving.set(true);
    const pay = (bill: Bill) => {
      this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
        amount: bill.totalPayable,
        mode: this._mode(),
        referenceNo: this._referenceNo() || undefined
      }).subscribe({
        next: () => {
          this._saving.set(false);
          this.toasts.success('Payment collected');
          this.router.navigate(['/frontdesk/post-payment'], { queryParams: { orderId: bill.orderId } });
        },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Payment failed'); }
      });
    };

    // If a flat discount was entered, apply it first and use the updated bill.
    const d = this.discountNum();
    if (d > 0) {
      this.api.post<Bill>(`/api/billing/${b.id}/discount`, {
        amount: d,
        reason: 'Reception discount'
      }).subscribe({
        next: updated => { this._bill.set(updated); pay(updated); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Could not apply discount'); }
      });
    } else {
      pay(b);
    }
  }

  back() { this.router.navigateByUrl('/frontdesk'); }
}
