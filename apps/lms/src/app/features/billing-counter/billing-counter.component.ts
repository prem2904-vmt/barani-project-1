import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { Order } from '../../shared/models/order.model';
import { Patient, patientDisplayName } from '../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../shared/pipes/currency-inr.pipe';
import { AvatarComponent } from '../../shared/primitives/avatar.component';
import { ChipComponent } from '../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../shared/components/kpi-strip/kpi-strip.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';

/** One row of GET /api/billing/outstanding — a bill with money still moving
 *  (balance > 0 → patient owes; balance < 0 → lab owes a refund). */
interface OutstandingRow {
  billId: string;
  orderId: string;
  patientName: string;
  totalPayable: number;
  totalPaid: number;
  balance: number;
  status: string;
  createdAt: string;
}

interface ReconcileModeRow {
  mode: string;
  count: number;
  total: number;
}

/** GET /api/billing/reconcile?date=YYYY-MM-DD — day-end closeout totals. */
interface ReconcileSummary {
  date: string;
  payments: ReconcileModeRow[];
  refunds: ReconcileModeRow[];
  totalCollected: number;
  totalRefunded: number;
  net: number;
}

/**
 * Billing counter — for branches in `billing_mode = separate_counter`.
 *
 * Two-pane workspace (mirrors the frontdesk-landing splitter pattern):
 *   • "Find & bill"  — search / scan an order and hand off to /frontdesk/billing.
 *   • "Money"        — outstanding balances + refunds owed, and the day-end summary.
 * Tablet/desktop show both panes side by side; phones show one at a time via a
 * segmented switch. Each pane scrolls independently so the fixed header + KPIs
 * stay put. The actual billing UI is reused from /frontdesk/billing, not duplicated.
 */
@Component({
  selector: 'pf-billing-counter',
  standalone: true,
  imports: [
    FormsModule, DatePipe, CurrencyInrPipe,
    AvatarComponent, ChipComponent,
    ScreenHeaderComponent, TouchButtonComponent, KpiStripComponent,
    LoadingLogoComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <!-- Fixed (non-scrolling) top zone: KPIs, header, phone pane switch. -->
      <div class="pf-page__top px-4 md:px-8 lg:px-10 pt-6">
        <pf-kpi-strip screen="billing_counter"></pf-kpi-strip>
        <pf-screen-header
          eyebrow="Billing · Counter"
          title="Billing counter"
          subtitle="Find an order to take payment — and keep an eye on balances & day-end totals.">
        </pf-screen-header>

        <!-- Phone-only pane switch (Bill · Money). Hidden from tablet up. -->
        <div class="pf-pswitch md:hidden" role="tablist" aria-label="Billing counter view">
          <button type="button" role="tab" class="pf-pswitch__btn"
                  [class.pf-pswitch__btn--on]="mobilePane() === 'bill'"
                  [attr.aria-selected]="mobilePane() === 'bill'"
                  (click)="mobilePane.set('bill')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
            Find &amp; bill
          </button>
          <button type="button" role="tab" class="pf-pswitch__btn"
                  [class.pf-pswitch__btn--on]="mobilePane() === 'money'"
                  [attr.aria-selected]="mobilePane() === 'money'"
                  (click)="mobilePane.set('money')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2"/>
              <path d="M16 12h5v-2h-5a1 1 0 0 0 0 2Z" fill="currentColor" stroke="none"/>
            </svg>
            Money
            @if (moneyCount() > 0) { <span class="pf-pswitch__count">{{ moneyCount() }}</span> }
          </button>
        </div>
      </div>

      <!-- Two-pane workspace. -->
      <div class="pf-page__body px-4 md:px-8 lg:px-10 pb-6">
        <div class="pf-work">

          <!-- ══ PANE A · Find & bill ══════════════════════════════════ -->
          <section class="pf-pane" [class.pf-pane--hidden-mobile]="mobilePane() !== 'bill'">
            <header class="pf-pane__hdr">
              <h2 class="pf-pane__title">Find &amp; bill</h2>
            </header>
            <div class="pf-pane__body">

              <!-- Unified search + direct lookup / scan. -->
              <div class="pf-find">
                <div class="pf-find__search">
                  <svg class="pf-find__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                  </svg>
                  <input class="pf-input pf-find__input" type="search"
                         placeholder="Search patient · name, phone, MRN, order ID"
                         [ngModel]="query()" (ngModelChange)="onSearch($event)" />
                  @if (searching()) { <span class="pf-find__spin" aria-hidden="true"></span> }
                </div>
                <div class="pf-find__direct">
                  <input class="pf-input pf-find__code" type="search"
                         placeholder="Invoice / order ID"
                         [ngModel]="lookupCode()" (ngModelChange)="lookupCode.set($event)"
                         (keydown.enter)="resolveLookup()" />
                  <pf-touch-btn size="sm" variant="primary" [disabled]="resolving()" (pressed)="resolveLookup()">
                    {{ resolving() ? 'Finding…' : 'Open' }}
                  </pf-touch-btn>
                  <pf-touch-btn size="sm" variant="ghost" (pressed)="startScan()" aria-label="Scan invoice QR">
                    <span icon-left aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>
                      </svg>
                    </span>
                    Scan
                  </pf-touch-btn>
                </div>
              </div>

              <!-- Patient results. -->
              @if (results().length > 0) {
                <h3 class="pf-section">Patients · {{ results().length }}</h3>
                <ul class="pf-list">
                  @for (p of results(); track p.id) {
                    <li>
                      <button type="button" class="pf-row pf-row--inline" (click)="selectPatient(p)">
                        <pf-avatar [name]="display(p)" [size]="44"></pf-avatar>
                        <div class="min-w-0 flex-1">
                          <p class="pf-row__name">{{ display(p) }}</p>
                          <p class="pf-row__meta">
                            {{ p.sex || '—' }}
                            @if (p.age != null) { · {{ p.age }}y }
                            @if (p.phone) { · {{ p.phone }} }
                          </p>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="m9 18 6-6-6-6"/>
                        </svg>
                      </button>
                    </li>
                  }
                </ul>
              } @else if (query().trim().length > 0 && !searching()) {
                <div class="pf-empty pf-empty--sm">
                  No matching patient. Check the spelling, phone, or order ID.
                </div>
              }

              <!-- Selected patient's unbilled orders. -->
              @if (selectedPatient(); as p) {
                <h3 class="pf-section mt-5">{{ display(p) }} · unbilled orders</h3>
                @if (loadingOrders()) {
                  <div class="flex justify-center py-6">
                    <pf-loading-logo size="lg" color="purple"
                                     [showText]="true" text="Loading orders…"></pf-loading-logo>
                  </div>
                } @else if (unbilledOrders().length === 0) {
                  <div class="pf-empty pf-empty--sm">
                    All orders for this patient are billed already.
                  </div>
                } @else {
                  <ul class="pf-list">
                    @for (o of unbilledOrders(); track o.id) {
                      <li>
                        <button type="button" class="pf-row" (click)="bill(o)">
                          <div class="pf-row__id">#{{ o.id.slice(0, 8) }}</div>
                          <div class="min-w-0 flex-1">
                            <p class="pf-row__name">
                              {{ totalTests(o) }} test<span [class.hidden]="totalTests(o) === 1">s</span>
                              <pf-chip [tone]="priorityTone(o)" size="sm" class="ml-2">{{ o.priority }}</pf-chip>
                            </p>
                            <p class="pf-row__meta">
                              Created {{ o.createdAt | date:'shortTime' }} · {{ o.collectionType }}
                            </p>
                          </div>
                          <pf-touch-btn size="sm" variant="primary">Process payment →</pf-touch-btn>
                        </button>
                      </li>
                    }
                  </ul>
                }
              }

              <!-- Resting state: nothing searched, no patient picked. -->
              @if (results().length === 0 && !selectedPatient() && query().trim().length === 0) {
                <div class="pf-empty">
                  <svg class="pf-empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1Z"/>
                    <path d="M8 8h8M8 12h8M8 16h5"/>
                  </svg>
                  <p class="pf-empty__title">Find an order to bill</p>
                  <p class="pf-empty__hint">Search a patient above, or scan / type an invoice or order ID to jump straight to payment.</p>
                </div>
              }
            </div>
          </section>

          <!-- ══ PANE B · Money ════════════════════════════════════════ -->
          <section class="pf-pane" [class.pf-pane--hidden-mobile]="mobilePane() !== 'money'">
            <header class="pf-pane__hdr">
              <h2 class="pf-pane__title">Money</h2>
              @if (moneyCount() > 0) { <span class="pf-pane__badge">{{ moneyCount() }} open</span> }
            </header>
            <div class="pf-pane__body">

              <!-- ── Outstanding: pay-later balances + refunds the lab owes ── -->
              <h3 class="pf-section">Balances due / refunds owed</h3>
              @if (loadingOutstanding()) {
                <div class="flex justify-center py-6">
                  <pf-loading-logo size="lg" color="purple"
                                   [showText]="true" text="Loading balances…"></pf-loading-logo>
                </div>
              } @else if (due().length === 0 && refundsOwed().length === 0) {
                <div class="pf-empty pf-empty--sm">
                  No balances due and no refunds owed — everything is settled.
                </div>
              } @else {
                @if (due().length > 0) {
                  <h4 class="pf-subsection">Due · {{ due().length }}</h4>
                  <ul class="pf-list">
                    @for (r of due(); track r.billId) {
                      <li>
                        <button type="button" class="pf-row pf-row--inline" (click)="openOutstanding(r)">
                          <div class="min-w-0 flex-1">
                            <p class="pf-row__name">{{ r.patientName || '—' }}</p>
                            <p class="pf-row__meta">
                              {{ r.createdAt | date:'mediumDate' }} · paid {{ r.totalPaid | inr }} of {{ r.totalPayable | inr }}
                            </p>
                          </div>
                          <span class="pf-balance pf-balance--due">{{ r.balance | inr }}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="m9 18 6-6-6-6"/>
                          </svg>
                        </button>
                      </li>
                    }
                  </ul>
                }
                @if (refundsOwed().length > 0) {
                  <h4 class="pf-subsection">Refunds owed · {{ refundsOwed().length }}</h4>
                  <ul class="pf-list">
                    @for (r of refundsOwed(); track r.billId) {
                      <li>
                        <button type="button" class="pf-row pf-row--inline" (click)="openOutstanding(r)">
                          <div class="min-w-0 flex-1">
                            <p class="pf-row__name">{{ r.patientName || '—' }}</p>
                            <p class="pf-row__meta">
                              {{ r.createdAt | date:'mediumDate' }} · paid {{ r.totalPaid | inr }} of {{ r.totalPayable | inr }}
                            </p>
                          </div>
                          <span class="pf-balance pf-balance--refund">{{ refundAmount(r) | inr }}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="m9 18 6-6-6-6"/>
                          </svg>
                        </button>
                      </li>
                    }
                  </ul>
                }
              }

              <!-- ── Day-end summary: per-mode payment/refund totals for one day ── -->
              <div class="pf-recon-head mt-5">
                <h3 class="pf-section pf-section--flush">Day-end summary</h3>
                <input id="pf-recon-date" type="date" class="pf-input pf-recon-date"
                       aria-label="Business day"
                       [ngModel]="reconcileDate()" (ngModelChange)="setReconcileDate($event)" />
              </div>
              @if (loadingReconcile()) {
                <div class="flex justify-center py-6">
                  <pf-loading-logo size="lg" color="purple"
                                   [showText]="true" text="Loading summary…"></pf-loading-logo>
                </div>
              } @else if (reconcile(); as r) {
                <div class="pf-recon-wrap">
                  <table class="pf-recon-table">
                    <thead>
                      <tr><th>Mode</th><th class="num">Count</th><th class="num">Total</th></tr>
                    </thead>
                    <tbody>
                      @for (p of r.payments; track p.mode) {
                        <tr>
                          <td>{{ p.mode }}</td>
                          <td class="num">{{ p.count }}</td>
                          <td class="num">{{ p.total | inr }}</td>
                        </tr>
                      } @empty {
                        <tr><td colspan="3" class="pf-recon-empty">No payments on this day</td></tr>
                      }
                      @for (f of r.refunds; track f.mode) {
                        <tr class="pf-recon-refund">
                          <td>{{ f.mode }} · refund</td>
                          <td class="num">{{ f.count }}</td>
                          <td class="num">−{{ f.total | inr }}</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Collected</td><td class="num"></td>
                        <td class="num">{{ r.totalCollected | inr }}</td>
                      </tr>
                      <tr>
                        <td>Refunded</td><td class="num"></td>
                        <td class="num">{{ r.totalRefunded | inr }}</td>
                      </tr>
                      <tr class="pf-recon-net">
                        <td>Net</td><td class="num"></td>
                        <td class="num">{{ r.net | inr }}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              } @else {
                <div class="pf-empty pf-empty--sm">
                  Could not load the summary for this day.
                </div>
              }
            </div>
          </section>
        </div>
      </div>

      <!-- Camera scan dialog (invoice QR). -->
      @if (scanning()) {
        <div class="pf-scan" role="dialog" aria-modal="true" aria-label="Scan invoice QR">
          <div class="pf-scan__bd" (click)="stopScan()"></div>
          <div class="pf-scan__panel">
            <video #scanVideo class="pf-scan__video" muted playsinline></video>
            <p class="pf-scan__hint">Point the camera at the invoice QR code</p>
            <pf-touch-btn size="sm" variant="ghost" (pressed)="stopScan()">Cancel</pf-touch-btn>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    /* ── WORK page: fill the shell's main area; the panes scroll INSIDE, not
       the page. No outer page scroll, no double scrollbars. ── */
    :host { display: block; height: 100%; }
    .pf-page {
      display: flex; flex-direction: column;
      height: 100%; min-height: 0; overflow: hidden;
    }
    .pf-page__top { flex: 0 0 auto; min-height: 0; }
    .pf-page__body { flex: 1 1 auto; min-height: 0; overflow: hidden; padding-top: 10px; }

    /* ── Two-pane workspace ──────────────────────────────────────────
       Tablet/desktop: panes side by side, each its own scroll container.
       Phone: one pane at a time (segmented switch drives which). ── */
    .pf-work { display: flex; gap: 14px; height: 100%; min-height: 0; }
    .pf-pane {
      flex: 1 1 0; min-width: 0; min-height: 0;
      display: flex; flex-direction: column;
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      background: var(--glass-bg);
      overflow: hidden;
    }
    /* The "Money" pane is the secondary monitor — give the action pane a touch
       more room on wide screens so orders/results breathe. */
    @media (min-width: 1024px) {
      .pf-pane:first-of-type { flex: 1.08 1 0; }
    }
    .pf-pane__hdr {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-pane__title {
      margin: 0; font-size: 13.5px; font-weight: 700;
      color: var(--text-primary); letter-spacing: 0.01em;
    }
    .pf-pane__badge {
      margin-left: auto;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; font-weight: 700; color: #fbbf24;
      padding: 3px 9px; border-radius: 999px;
      background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.28);
    }
    .pf-pane__body {
      flex: 1 1 auto; min-height: 0;
      overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      padding: 14px 16px;
    }

    @media (max-width: 767px) {
      .pf-work { display: block; }
      .pf-pane { height: 100%; }
      .pf-pane--hidden-mobile { display: none; }
      /* Keep the last row reachable above the bottom-nav pill. */
      .pf-pane__body { padding-bottom: calc(16px + var(--tab-nav-total-height, 0px)); }
    }

    /* ── Phone pane switch (Bill · Money) ── */
    .pf-pswitch {
      display: flex; gap: 6px; margin-top: 10px;
      padding: 4px; border-radius: 14px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
    }
    .pf-pswitch__btn {
      all: unset; box-sizing: border-box; cursor: pointer;
      flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      min-height: 42px; padding: 0 12px; border-radius: 10px;
      font-size: 13px; font-weight: 600; color: var(--text-tertiary);
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-pswitch__btn svg { width: 16px; height: 16px; flex-shrink: 0; }
    .pf-pswitch__btn--on {
      background: var(--gradient-primary); color: #fff;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
    }
    .pf-pswitch__count {
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 10.5px; font-weight: 700;
      background: rgba(0, 0, 0, 0.2); color: inherit;
    }

    /* ── Unified search / direct lookup ── */
    .pf-find {
      display: flex; flex-direction: column; gap: 10px;
      padding: 12px; margin-bottom: 6px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 14px;
    }
    .pf-find__search { position: relative; display: flex; align-items: center; }
    .pf-find__icon {
      position: absolute; left: 12px; width: 16px; height: 16px;
      color: var(--text-tertiary); pointer-events: none;
    }
    .pf-find__input { width: 100%; padding-left: 36px; }
    .pf-find__spin {
      position: absolute; right: 12px; width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid var(--glass-border); border-top-color: #c4b5fd;
      animation: pf-bc-spin 0.7s linear infinite;
    }
    @keyframes pf-bc-spin { to { transform: rotate(360deg); } }
    .pf-find__direct { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .pf-find__code { flex: 1 1 160px; min-width: 140px; }

    /* ── Section labels ── */
    .pf-section {
      margin: 14px 0 8px;
      font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);
    }
    .pf-section:first-child { margin-top: 0; }
    .pf-section--flush { margin: 0; }
    .pf-subsection {
      margin: 10px 0 6px;
      font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-tertiary);
    }

    /* ── Rows / lists ── */
    .pf-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-row {
      all: unset; cursor: pointer;
      /* Phone: stack the order summary and the Process button so the button is
         full-width and tappable. Tablet+ returns to the inline row layout. */
      display: flex; flex-direction: column; align-items: stretch; gap: 10px;
      width: 100%; padding: 12px 16px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 14px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    @media (min-width: 640px) {
      .pf-row { flex-direction: row; align-items: center; gap: 14px; }
    }
    /* Phone: a patient / balance row (name · chevron) reads better inline than
       stacked, so keep those horizontal; order rows still stack for the button. */
    @media (max-width: 639px) {
      .pf-row--inline { flex-direction: row; align-items: center; gap: 12px; }
      .pf-row__id { align-self: flex-start; }
    }
    .pf-row > pf-avatar,
    .pf-row > svg,
    .pf-row > pf-touch-btn,
    .pf-row > .pf-balance { flex-shrink: 0; }
    @media (hover: hover) {
      .pf-row:hover { border-color: rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.04); }
    }
    .pf-row__id {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px; font-weight: 700; color: #c4b5fd;
      padding: 6px 10px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.28);
      flex-shrink: 0;
    }
    .pf-row__name {
      margin: 0; font-weight: 600; font-size: 14.5px; color: var(--text-primary); text-align: left;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-row__meta {
      margin: 2px 0 0; font-size: 11px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace; text-align: left;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hidden { display: none; }

    /* ── Empty / resting states ── */
    .pf-empty {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px;
      padding: 40px 20px; color: var(--text-tertiary);
    }
    .pf-empty__icon { width: 42px; height: 42px; color: var(--text-muted); opacity: 0.85; }
    .pf-empty__title { margin: 4px 0 0; font-size: 14.5px; font-weight: 600; color: var(--text-secondary); }
    .pf-empty__hint { margin: 0; font-size: 12.5px; max-width: 320px; line-height: 1.5; }
    .pf-empty--sm {
      padding: 16px; font-size: 13px;
      border: 1px dashed var(--glass-border); border-radius: 14px;
    }

    /* ── Balance pills ── */
    .pf-balance {
      flex-shrink: 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13px; font-weight: 700;
      padding: 6px 10px; border-radius: 999px; white-space: nowrap;
    }
    .pf-balance--due { color: #fbbf24; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.28); }
    .pf-balance--refund { color: #f87171; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.28); }

    /* ── Day-end reconciliation ── */
    .pf-recon-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; flex-wrap: wrap; margin-bottom: 10px;
    }
    .pf-recon-date { width: 168px; max-width: 60%; }
    .pf-recon-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .pf-recon-table { width: 100%; border-collapse: collapse; font-size: 13px; color: var(--text-primary); }
    .pf-recon-table th {
      text-align: left; padding: 6px 8px;
      font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600;
      color: var(--text-muted); border-bottom: 1px solid var(--border-muted);
    }
    .pf-recon-table td { padding: 8px; border-bottom: 1px solid var(--border-muted); }
    .pf-recon-table .num { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; white-space: nowrap; }
    .pf-recon-refund td { color: #f87171; }
    .pf-recon-empty { color: var(--text-tertiary); }
    .pf-recon-table tfoot td { border-bottom: none; color: var(--text-secondary); padding: 6px 8px; }
    .pf-recon-net td { color: var(--text-primary); font-weight: 700; border-top: 1px solid var(--glass-border) !important; }

    /* Phone: iOS zooms sub-16px inputs on focus — lift the date field. */
    @media (max-width: 640px) { .pf-recon-date { font-size: 16px; } }

    /* ── Camera scan dialog ── */
    .pf-scan { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .pf-scan__bd { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
    .pf-scan__panel {
      position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 12px;
      width: min(420px, 100%); padding: 16px;
      background: var(--bg-card-solid, #14141f);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
      border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .pf-scan__video {
      width: 100%; aspect-ratio: 1 / 1; object-fit: cover;
      border-radius: 14px; background: #000; border: 2px solid rgba(168, 85, 247, 0.5);
    }
    .pf-scan__hint { font-size: 12.5px; color: var(--text-tertiary); text-align: center; }

    /* Phone: scan dialog becomes a full-bleed bottom sheet above the nav pill. */
    @media (max-width: 640px) {
      .pf-scan { align-items: flex-end; padding: 12px; }
      .pf-scan__panel {
        width: 100%; max-height: 88dvh; overflow-y: auto;
        border-radius: 18px 18px 14px 14px;
        padding-bottom: calc(16px + var(--tab-nav-total-height, 0px));
      }
    }

    /* Capacitor native: absorb notch / home-indicator insets on the fixed dialog. */
    :host-context(html.cap-native) .pf-scan {
      padding-top: calc(20px + env(safe-area-inset-top));
      padding-bottom: calc(20px + env(safe-area-inset-bottom));
      padding-left: calc(20px + env(safe-area-inset-left));
      padding-right: calc(20px + env(safe-area-inset-right));
    }
  `]
})
export class BillingCounterComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  /** Phone-only: which pane is visible (tablet+ shows both). */
  protected readonly mobilePane = signal<'bill' | 'money'>('bill');

  ngOnInit() {
    this.loadOutstanding();
    this.loadReconcile();
  }

  // ── Outstanding balances / refunds owed ──
  private readonly _due = signal<OutstandingRow[]>([]);
  private readonly _refundsOwed = signal<OutstandingRow[]>([]);
  protected readonly loadingOutstanding = signal(false);
  readonly due = this._due.asReadonly();
  readonly refundsOwed = this._refundsOwed.asReadonly();
  /** Count badge for the Money pane / phone switch. */
  readonly moneyCount = computed(() => this._due().length + this._refundsOwed().length);

  private loadOutstanding() {
    this.loadingOutstanding.set(true);
    this.api.get<{ due: OutstandingRow[]; refundsOwed: OutstandingRow[] }>('/api/billing/outstanding').subscribe({
      next: res => {
        this._due.set(res?.due ?? []);
        this._refundsOwed.set(res?.refundsOwed ?? []);
        this.loadingOutstanding.set(false);
      },
      error: () => {
        this.loadingOutstanding.set(false);
        this.toasts.error('Could not load outstanding balances');
      }
    });
  }

  /** Open the standard billing screen on the row's order — same hand-off as
   *  the lookup + unbilled-order flows above. */
  openOutstanding(r: OutstandingRow) {
    this.router.navigate(['/frontdesk/order'], { queryParams: { orderId: r.orderId } });
  }

  /** Refund rows carry a negative balance — render the amount owed back. */
  refundAmount(r: OutstandingRow): number {
    return Math.abs(r.balance);
  }

  // ── Day-end reconciliation ──
  protected readonly reconcileDate = signal(BillingCounterComponent.todayIso());
  private readonly _reconcile = signal<ReconcileSummary | null>(null);
  protected readonly loadingReconcile = signal(false);
  readonly reconcile = this._reconcile.asReadonly();

  private static todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  setReconcileDate(date: string) {
    if (!date || date === this.reconcileDate()) return;
    this.reconcileDate.set(date);
    this.loadReconcile();
  }

  private loadReconcile() {
    this.loadingReconcile.set(true);
    this.api.get<ReconcileSummary>(`/api/billing/reconcile?date=${encodeURIComponent(this.reconcileDate())}`).subscribe({
      next: res => { this._reconcile.set(res ?? null); this.loadingReconcile.set(false); },
      error: () => {
        this._reconcile.set(null);
        this.loadingReconcile.set(false);
        this.toasts.error('Could not load the day-end summary');
      }
    });
  }

  // ── Scan / lookup (invoice number · order id · tracking QR) ──
  protected readonly lookupCode = signal('');
  protected readonly resolving = signal(false);
  protected readonly scanning = signal(false);
  protected readonly scanSupported = typeof (window as any).BarcodeDetector !== 'undefined';
  private readonly scanVideo = viewChild<ElementRef<HTMLVideoElement>>('scanVideo');
  private mediaStream: MediaStream | null = null;
  private scanRaf = 0;

  /** Resolve a typed/scanned code → order → open the collect-payment screen. */
  resolveLookup(code?: string) {
    const raw = (code ?? this.lookupCode()).trim();
    if (!raw || this.resolving()) return;
    this.resolving.set(true);
    this.api.get<{ orderId: string }>(`/api/billing/lookup?code=${encodeURIComponent(raw)}`).subscribe({
      next: r => {
        this.resolving.set(false);
        if (r?.orderId) this.router.navigate(['/frontdesk/order'], { queryParams: { orderId: r.orderId } });
        else this.toasts.error('No order matches that code');
      },
      error: e => { this.resolving.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  async startScan() {
    if (!this.scanSupported) { this.toasts.warning('Camera scan is not supported on this browser — type the invoice number instead'); return; }
    this.scanning.set(true);
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      // Wait a tick for the <video> to render, then attach + start detecting.
      setTimeout(() => {
        const video = this.scanVideo()?.nativeElement;
        if (!video || !this.mediaStream) { this.stopScan(); return; }
        video.srcObject = this.mediaStream;
        video.play().catch(() => { /* autoplay quirks — user gesture already given */ });
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        const tick = async () => {
          if (!this.scanning()) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length && codes[0].rawValue) {
              const value = codes[0].rawValue as string;
              this.stopScan();
              this.resolveLookup(value);
              return;
            }
          } catch { /* transient frame error — keep scanning */ }
          this.scanRaf = requestAnimationFrame(tick);
        };
        this.scanRaf = requestAnimationFrame(tick);
      }, 0);
    } catch {
      this.stopScan();
      this.toasts.error('Could not access the camera');
    }
  }

  stopScan() {
    this.scanning.set(false);
    if (this.scanRaf) { cancelAnimationFrame(this.scanRaf); this.scanRaf = 0; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
  }

  ngOnDestroy() { this.stopScan(); }

  protected readonly query = signal('');
  private readonly _results = signal<Patient[]>([]);
  private readonly _searching = signal(false);
  private readonly _selectedPatient = signal<Patient | null>(null);
  private readonly _orders = signal<Order[]>([]);
  private readonly _loadingOrders = signal(false);

  readonly results = this._results.asReadonly();
  readonly searching = this._searching.asReadonly();
  readonly selectedPatient = this._selectedPatient.asReadonly();
  readonly loadingOrders = this._loadingOrders.asReadonly();
  readonly unbilledOrders = computed(() =>
    this._orders().filter(o => o.status === 'created' || o.status === 'pending'));

  display(p: Patient | null | undefined): string { return patientDisplayName(p); }

  onSearch(q: string) {
    this.query.set(q);
    if (q.trim().length === 0) { this._results.set([]); return; }
    this._searching.set(true);
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q.trim())}`).subscribe({
      next: list => { this._results.set(list ?? []); this._searching.set(false); },
      error: () => { this._results.set([]); this._searching.set(false); }
    });
  }

  selectPatient(p: Patient) {
    this._selectedPatient.set(p);
    this._orders.set([]);
    this._loadingOrders.set(true);
    // Reuse the patient profile endpoint which returns orders.
    this.api.get<{ patient: Patient; history: Order[] }>(`/api/patients/${p.id}`).subscribe({
      next: res => {
        this._orders.set(res.history ?? []);
        this._loadingOrders.set(false);
      },
      error: () => {
        this._loadingOrders.set(false);
        this.toasts.error('Could not load orders for this patient');
      }
    });
  }

  bill(o: Order) {
    // Hand off to the existing billing screen with the order id pre-loaded.
    this.router.navigate(['/frontdesk/order'], { queryParams: { orderId: o.id } });
  }

  totalTests(o: Order): number {
    return (o.samples ?? []).reduce((sum, s) => sum + (s.tests?.length ?? 0), 0);
  }

  priorityTone(o: Order): 'default' | 'amber' | 'rose' {
    if (o.priority === 'STAT' || o.priority === 'Urgent') return 'rose';
    if (o.priority === 'High') return 'amber';
    return 'default';
  }
}
