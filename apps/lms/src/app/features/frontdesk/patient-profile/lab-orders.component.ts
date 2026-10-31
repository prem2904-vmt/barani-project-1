import {
  ChangeDetectionStrategy, Component, Injector, OnDestroy, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { buildReportBlobUrl } from '../../../shared/utils/report-blob';
import { PdfCanvasComponent } from './pdf-canvas.component';
import { parseResultSnapshot, savedValueRows } from '../../../shared/utils/result-flag';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { ZoomSourceDirective, ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { AuthService } from '../../../core/auth/auth.service';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, type PfAction } from '../../../shared/components/actions-menu/actions-menu.component';
import { currentRecipient } from '../../../shared/utils/report-recipient';
import { REPORT_BY_ORDER_PERMS, ReportActionsService } from '../../../core/services/report-actions.service';
import {
  filterOrders, orderStatusLabel, orderTests, orderTitle, orderTone, testStatusLabel, testTone,
} from './patient-profile.nd';
import { resultValueText } from '../../../shared/utils/option-family';
import { ShareService } from '../../../core/services/share.service';
import { EditReferralDialogComponent } from '../../../shared/components/edit-referral-dialog/edit-referral-dialog.component';
import { EDIT_REFERRAL_PERM, ReferralSaveResult } from '../../../shared/components/edit-referral-dialog/referral-edit';

/** A stored report as `GET /api/reports/by-order/{id}` returns it. */
type StoredReport = { id: string; orderId?: string; qrToken?: string; data?: string } & Record<string, unknown>;

interface ResultRow { title: string; value: string; unit?: string; range?: string; flag: 'normal' | 'abnormal' | 'critical'; /** mw code — a critical badges CL / CH (legacy C). */ code?: string; }

/**
 * Lab orders — the patient's orders as ND list rows (docs/PF-PATTERN.md →
 * "Patient profile"): the tests as the primary line, a quiet tabular meta
 * line, the status as a dot + coloured word and the row action (Repeat)
 * stacked under it. A row ZOOMS into the order in the same card
 * (zoom.runLocal): its tests with their real digital results (parameter ·
 * value · unit · reference · the flag mw saved), Repeat order and the
 * generated report rendered in place. The card header (search + date range)
 * lives in the profile; this list reads them as inputs.
 */
@Component({
  selector: 'pf-lab-orders',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PdfCanvasComponent, ZoomSourceDirective, ZoomTargetDirective, ActionsMenuComponent, ActionsMenuTriggerDirective, EditReferralDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (openOrder(); as o) {
      <!-- ── ORDER (zoomed in from its row) ─────────────────────────── -->
      <section class="pf-lo-detail" [pfZoomTarget]="[o.id]" aria-label="Order details"
               (keydown.escape)="close(); $event.preventDefault()">
        <header class="pf-lo-detail__head">
          <button type="button" class="pf-btn pf-btn--icon pf-lo-detail__back" (click)="close()"
                  [attr.aria-label]="detailId() ? 'Back' : 'Back to orders'" [title]="detailId() ? 'Back' : 'Back to orders'">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div class="pf-lo-detail__who">
            <p class="pf-lo-detail__title">{{ title(o) }}</p>
            <p class="pf-lo-row__meta pf-num">
              @if (o.orderNumber) { <span class="pf-lo-mi">{{ o.orderNumber }}</span> }
              <span class="pf-lo-mi">{{ o.createdAt | date:'d MMM y, h:mm a' }}</span>
              <span class="pf-lo-mi">{{ doctorLabel(o) }}</span>
              @if (o.totalAmount != null) { <span class="pf-lo-mi">₹{{ o.totalAmount | number:'1.0-0' }}</span> }
            </p>
          </div>
          <span class="pf-lo-status" [attr.data-tone]="tone(o.status)"><span class="pf-lo-dot" aria-hidden="true"></span>{{ statusLabel(o.status) }}</span>
        </header>

        <div class="pf-lo-detail__acts">
          <button type="button" class="pf-btn pf-btn--secondary pf-lo-act pf-lo-act--repeat" (click)="repeat(o)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
            Repeat order
          </button>
          <button type="button" class="pf-btn pf-btn--secondary pf-lo-act pf-lo-act--report" (click)="toggleReport(o)"
                  [attr.aria-expanded]="!!showReport()[o.id]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>
            {{ showReport()[o.id] ? 'Hide report' : 'View report' }}
          </button>
          @if (share.available()) {
            <button type="button" class="pf-btn pf-btn--secondary pf-lo-act pf-lo-act--chat" (click)="sendToColleague(o)"
                    [class.pf-lo-act--icon]="!web()" aria-label="Send to colleague" title="Send to colleague">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span class="pf-lo-act__t">Send to colleague</span>
            </button>
          }
          <!-- ⋮ — every action for this order's REPORT (share, the PDF,
               open the full report) by permission, once a report exists —
               plus Edit referral (modify_order) on any live order. -->
          @if (detailActions().length) {
            <pf-actions-menu class="pf-lo-kebab" [actions]="detailActions()" [label]="menuLabel(o)" [heading]="title(o)"
                             (opened)="onMenuOpened(o)" (action)="runDetailAction(o, $event)">
              <button pfActionsTrigger type="button" class="pf-btn pf-btn--secondary pf-lo-act pf-lo-act--more"
                      [class.pf-lo-act--icon]="!web()" [attr.aria-label]="menuLabel(o)" [title]="menuLabel(o)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5h.01"/><path d="M12 12h.01"/><path d="M12 19h.01"/></svg>
                <span class="pf-lo-act__t">More</span>
              </button>
            </pf-actions-menu>
          }
        </div>

        @if (referralFor() === o.id) {
          <pf-edit-referral-dialog [orderId]="o.id" (saved)="onReferralSaved(o, $event)"
                                   (closed)="referralFor.set(null)"></pf-edit-referral-dialog>
        }

        <h3 class="pf-lo-sec">Tests</h3>
        <ul class="pf-lo-tests" role="list">
          @for (t of tests(o); track t.id) {
            <li class="pf-lo-test">
              <div class="pf-lo-test__head">
                <span class="pf-lo-test__name">{{ t.name || 'Test' }}
                  @if (t.test?.code) { <span class="pf-lo-test__code pf-num">{{ t.test?.code }}</span> }
                </span>
                <span class="pf-lo-status" [attr.data-tone]="testTone(t.status)"><span class="pf-lo-dot" aria-hidden="true"></span>{{ testLabel(t.status) }}</span>
              </div>
              @if (resultRows(t); as rows) {
                @if (rows.length) {
                  <div class="pf-lo-res" role="table" [attr.aria-label]="(t.name || 'Test') + ' results'">
                    <div class="pf-lo-res__row pf-lo-res__row--head" role="row">
                      <span role="columnheader">Parameter</span><span role="columnheader">Result</span><span role="columnheader">Reference</span>
                    </div>
                    @for (r of rows; track r.title) {
                      <div class="pf-lo-res__row" role="row" [attr.data-flag]="r.flag">
                        <span class="pf-lo-res__name" role="cell">{{ r.title }}</span>
                        <span class="pf-lo-res__val pf-num" role="cell">{{ r.value }}@if (r.unit) {<span class="pf-lo-res__unit">{{ r.unit }}</span>}
                          @if (r.flag !== 'normal') {
                            <span class="pf-lo-res__flag">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>
                              {{ r.flag === 'critical' ? (r.code || 'C') : 'Abnormal' }}
                            </span>
                          }
                        </span>
                        <span class="pf-lo-res__ref pf-num" role="cell">{{ r.range || '—' }}</span>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="pf-lo-pending">Results not entered yet.</p>
                }
              }
            </li>
          }
        </ul>

        @if (showReport()[o.id]) {
          <h3 class="pf-lo-sec">Report</h3>
          <div class="pf-lo-report">
            @if (reportBusy() === o.id) {
              <div class="pf-lo-report__skel" aria-hidden="true">
                <span class="pf-lo-skel" style="width: 42%"></span>
                <span class="pf-lo-skel"></span><span class="pf-lo-skel"></span><span class="pf-lo-skel" style="width: 70%"></span>
              </div>
            } @else if (reportUrl()[o.id]; as u) {
              <pf-pdf-canvas [src]="u"></pf-pdf-canvas>
            } @else if (reportFailed()[o.id]) {
              <div class="pf-empty pf-empty--compact" role="alert">
                <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 11v4"/><path d="M12 18h.01"/></svg></span>
                <p class="pf-empty__title">Couldn’t render this report</p>
                <p class="pf-empty__body">The lab’s report design couldn’t be loaded. Close and open the report again in a moment.</p>
              </div>
            } @else {
              <div class="pf-empty pf-empty--compact">
                <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>
                <p class="pf-empty__title">No report yet</p>
                <p class="pf-empty__body">No report has been generated for this order yet.</p>
              </div>
            }
          </div>
        }
      </section>
    } @else if (filtered().length === 0) {
      @if ((orders() ?? []).length === 0) {
        <div class="pf-empty">
          <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6.5L4.5 17a3 3 0 0 0 2.7 4.5h9.6a3 3 0 0 0 2.7-4.5L15 8.5V2"/><path d="M8 2h8"/><path d="M7 14h10"/></svg></span>
          <p class="pf-empty__title">No orders yet</p>
          <p class="pf-empty__body">This patient's lab orders, results and reports show up here.</p>
        </div>
      } @else {
        <div class="pf-empty">
          <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
          <p class="pf-empty__title">No orders match</p>
          <p class="pf-empty__body">Try another test name or a wider date range.</p>
          <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="clearFilters.emit()">Clear filters</button>
        </div>
      }
    } @else {
      <!-- ── ORDERS: one row per order ─────────────────────────────── -->
      <ul class="pf-lo-list" role="list" aria-label="Orders">
        @for (o of filtered(); track o.id; let i = $index) {
          <li class="pf-lo-li" [style.--i]="i < 12 ? i : 12">
            <div class="pf-lo-row" role="button" tabindex="0" [pfZoomSource]="[o.id]"
                 [attr.aria-label]="'Open order ' + (o.orderNumber || '') + ' · ' + title(o)"
                 (click)="open(o)" (keydown)="onRowKey($event, o)">
              <div class="pf-lo-row__body">
                <p class="pf-lo-row__name">{{ title(o) }}</p>
                <p class="pf-lo-row__meta pf-num">
                  @if (o.orderNumber) { <span class="pf-lo-mi">{{ o.orderNumber }}</span> }
                  <span class="pf-lo-mi">{{ o.createdAt | date:'d MMM y, h:mm a' }}</span>
                  <span class="pf-lo-mi">{{ countLabel(o) }}</span>
                  <span class="pf-lo-mi">{{ doctorLabel(o) }}</span>
                  @if (o.totalAmount != null) { <span class="pf-lo-mi">₹{{ o.totalAmount | number:'1.0-0' }}</span> }
                </p>
              </div>
              <span class="pf-lo-status" [attr.data-tone]="tone(o.status)"><span class="pf-lo-dot" aria-hidden="true"></span>{{ statusLabel(o.status) }}</span>
              <div class="pf-lo-row__acts" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
                <button type="button" class="pf-rowact pf-lo-repeat" [class.pf-rowact--icon]="!web()"
                        (click)="repeat(o)" aria-label="Repeat order" title="Repeat order">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
                  <span class="pf-rowact__t">Repeat</span>
                </button>
              </div>
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-width: 0; container-type: inline-size; }

    /* ── Rows: the Frontdesk list-row language (ND §6 "List rows") ── */
    .pf-lo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-lo-li { animation: pf-lo-in var(--pf-dur, 320ms) var(--pf-spring) both; animation-delay: calc(var(--i, 0) * 18ms); }
    @keyframes pf-lo-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .pf-lo-row {
      display: grid; grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'body status' 'body acts';
      align-items: center; column-gap: 12px; row-gap: 6px;
      min-height: 64px; padding: 10px 12px 10px 14px;
      border-radius: var(--pf-radius, 12px); border: 1px solid var(--glass-border); background: var(--glass-bg);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      color: var(--text-primary); cursor: pointer;
      transition: border-color var(--pf-dur-fast) ease, background var(--pf-dur-fast) ease;
    }
    .pf-lo-row:hover { border-color: var(--pf-sel-border); }
    .pf-lo-row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-lo-row__body { grid-area: body; min-width: 0; }
    .pf-lo-row__name { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--text-primary); white-space: normal; overflow-wrap: anywhere; }
    .pf-lo-row__meta { display: flex; flex-wrap: wrap; margin: 3px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--text-secondary); }
    .pf-lo-mi + .pf-lo-mi::before { content: '·'; margin: 0 6px; color: var(--text-muted, var(--text-tertiary)); }
    .pf-lo-row__acts { grid-area: acts; justify-self: end; align-self: start; display: flex; gap: 6px; }

    /* Status = a 7px dot + a coloured word (no chip) — the Frontdesk tones. */
    .pf-lo-status {
      --pf-tone: var(--amber-text);
      grid-area: status; justify-self: end; align-self: end;
      display: inline-flex; align-items: center; gap: 6px; flex: none;
      font-size: 12.5px; font-weight: 500; line-height: 16px; white-space: nowrap;
      color: color-mix(in srgb, var(--pf-tone) 70%, var(--text-primary));
    }
    .pf-lo-status[data-tone='green'] { --pf-tone: var(--green-text); }
    .pf-lo-status[data-tone='blue'] { --pf-tone: var(--blue-text); }
    .pf-lo-status[data-tone='red'] { --pf-tone: var(--red-text); }
    .pf-lo-status[data-tone='violet'] { --pf-tone: var(--violet-text); }
    .pf-lo-dot { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--pf-tone); }

    /* Narrow list (phones / squeezed): status left + action right on line 2. */
    @container (max-width: 520px) {
      .pf-lo-row { grid-template-areas: 'body body' 'status acts'; }
      .pf-lo-row .pf-lo-status { justify-self: start; align-self: center; font-size: 13px; }
      .pf-lo-row__acts { align-self: center; }
      .pf-lo-row__acts .pf-rowact { min-height: 44px; }
    }

    /* ── Order detail (zoomed in) ─────────────────────────────────── */
    .pf-lo-detail { display: flex; flex-direction: column; gap: 12px; min-width: 0; border-radius: var(--pf-radius, 12px); background: var(--pf-card-bg); }
    .pf-lo-detail__head { display: flex; align-items: flex-start; gap: 10px; }
    .pf-lo-detail__back { width: 36px !important; height: 36px; min-height: 36px; flex: none; }
    .pf-lo-detail__who { flex: 1 1 auto; min-width: 0; }
    .pf-lo-detail__title { margin: 6px 0 0; font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-lo-detail__head .pf-lo-status { margin-top: 8px; }
    .pf-lo-detail__acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-lo-act { gap: 6px; }
    .pf-lo-kebab { display: inline-flex; }
    .pf-lo-act--icon { width: 44px; min-width: 44px; min-height: 44px; padding: 0; justify-content: center; }
    .pf-lo-act--icon .pf-lo-act__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .pf-lo-sec { margin: 6px 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }

    .pf-lo-tests { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-lo-test { padding: 10px 12px; border-radius: var(--pf-radius-sm, 10px); border: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-lo-test__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .pf-lo-test__name { min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-lo-test__code { margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--text-tertiary); }
    .pf-lo-test .pf-lo-status { align-self: auto; }
    .pf-lo-pending { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }

    .pf-lo-res { border: 1px solid var(--pf-line); border-radius: 10px; overflow: hidden; }
    .pf-lo-res__row { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 8px; padding: 7px 12px; font-size: 13px; align-items: center; }
    .pf-lo-res__row + .pf-lo-res__row { border-top: 1px solid var(--pf-line); }
    .pf-lo-res__row--head { background: var(--pf-chip-bg); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-lo-res__name { color: var(--text-secondary); overflow-wrap: anywhere; }
    .pf-lo-res__val { font-weight: 600; color: var(--text-primary); display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; }
    .pf-lo-res__unit { font-weight: 400; font-size: 12px; color: var(--text-tertiary); margin-left: 4px; }
    .pf-lo-res__ref { font-size: 12.5px; color: var(--text-tertiary); white-space: pre-line; }
    /* The only colour here is a real flag: amber abnormal, red critical. */
    .pf-lo-res__flag { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 600; }
    .pf-lo-res__row[data-flag='abnormal'] .pf-lo-res__val { color: color-mix(in srgb, var(--amber-text) 75%, var(--text-primary)); }
    .pf-lo-res__row[data-flag='critical'] .pf-lo-res__val { color: color-mix(in srgb, var(--red-text) 80%, var(--text-primary)); }

    .pf-lo-report { padding: 10px; border: 1px solid var(--pf-line); border-radius: 12px; background: color-mix(in srgb, var(--text-primary) 3%, var(--pf-card-bg)); display: flex; justify-content: center; }
    .pf-lo-report pf-pdf-canvas { width: 100%; max-width: 820px; }
    .pf-lo-report__skel { width: 100%; max-width: 820px; aspect-ratio: 1 / 1.1; display: flex; flex-direction: column; gap: 12px; padding: 24px; border-radius: 8px; background: var(--pf-card-bg); border: 1px solid var(--pf-line); }
    .pf-lo-skel { display: block; height: 10px; width: 100%; border-radius: 6px; background: var(--pf-chip-bg); }

    @media (max-width: 640px) {
      .pf-lo-res__row { grid-template-columns: 1.3fr 1fr; }
      .pf-lo-res__ref { display: none; }
      .pf-lo-act { flex: 1 1 auto; min-height: 44px; }
      .pf-lo-detail__back { width: 44px !important; height: 44px; min-height: 44px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-lo-li { animation: none !important; }
      .pf-lo-row { transition: none; }
    }
  `],
})
export class LabOrdersComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly zoom = inject(ZoomTransitionService);

  readonly orders = input<Order[]>([]);
  readonly patientId = input<string>('');
  /** Card-header search (tests / order number / doctor) and date range. */
  readonly query = input<string>('');
  readonly fromDate = input<string>('');
  readonly toDate = input<string>('');
  /** "No orders match" → the profile clears its search + range. */
  readonly clearFilters = output<void>();
  /** An order opened / closed (the profile hides its list controls). */
  readonly detailChange = output<string | null>();
  /** DETAIL-ONLY mode (the clinical profile): show this one order, no list.
   *  The host owns the zoom; Back just emits detailChange(null). */
  readonly detailId = input<string | null>(null);
  /** With detailId: open the report straight away (a cumulative cell / "View
   *  last report" / a report in the timeline). */
  readonly autoReport = input(false);
  private readonly _detail = effect(() => {
    const id = this.detailId();
    const auto = this.autoReport();
    untracked(() => {
      this.openId.set(id);
      const o = id ? (this.orders() ?? []).find(x => x.id === id) : null;
      if (o && auto && !this.showReport()[o.id]) void this.toggleReport(o);
    });
  });

  /** Order ids whose report exists but could not be rendered (design did not load). */
  readonly reportFailed = signal<Record<string, boolean>>({});
  /** Web = text row actions; touch = 44px icons (ND §1 row actions). */
  protected readonly web = webPointerSignal();

  readonly openId = signal<string | null>(null);
  readonly showReport = signal<Record<string, boolean>>({});
  readonly reportUrl = signal<Record<string, string>>({});
  readonly reportBusy = signal<string | null>(null);
  private readonly blobUrls = new Set<string>();

  readonly filtered = computed<Order[]>(() => filterOrders(this.orders() ?? [], this.query(), this.fromDate(), this.toDate()));
  readonly openOrder = computed<Order | null>(() => {
    const id = this.openId();
    return id ? (this.orders() ?? []).find(o => o.id === id) ?? null : null;
  });

  protected readonly title = orderTitle;
  protected readonly statusLabel = orderStatusLabel;
  protected readonly tone = orderTone;
  protected readonly testLabel = testStatusLabel;
  protected readonly testTone = testTone;
  tests(o: Order): OrderTest[] { return orderTests(o); }
  countLabel(o: Order): string { const n = orderTests(o).length; return `${n} test${n === 1 ? '' : 's'}`; }

  /** Row → the order, zoomed in within the card. */
  open(o: Order): void {
    this.zoom.runLocal('in', () => { this.openId.set(o.id); this.detailChange.emit(o.id); });
  }
  onRowKey(ev: KeyboardEvent, o: Order): void {
    if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    this.open(o);
  }
  /** Back to the list, zoomed out into the row. */
  close(): void {
    if (this.detailId()) { this.detailChange.emit(null); return; }
    if (!this.openId()) return;
    this.zoom.runLocal('out', () => { this.openId.set(null); this.detailChange.emit(null); });
  }

  /** Parse a test's entered values × its parameter defs → per-parameter rows,
   *  flagged with the verdict mw SAVED with the result (no browser recompute). */
  resultRows(t: OrderTest): ResultRow[] {
    const snap = parseResultSnapshot(t.currentResult);
    if (!snap?.values) return [];
    const show = (v: unknown) => v === undefined || v === null || v === '' ? '—' : resultValueText(v) || '—';
    const rows = savedValueRows(t.currentResult, t.test?.parameters);
    if (rows.length) {
      return rows.map(r => ({ title: r.title, value: show(r.value), unit: r.unit, range: r.range, flag: r.flag, code: r.code }));
    }
    // Fallback: no parameter defs available — show the raw entered values.
    return Object.entries(snap.values).map(([k, v]) => ({
      title: k, value: show(v), flag: 'normal' as const,
    }));
  }

  /** Share to Messages: this order as a card (the server names it). */
  protected readonly share = inject(ShareService);
  sendToColleague(o: Order): void {
    this.share.openSheet({
      target: { type: 'order', id: o.id },
      title: o.orderNumber || 'Order',
      subtitle: this.title(o),
    });
  }

  repeat(o: Order) {
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: this.patientId(), fromOrderId: o.id } });
  }

  async toggleReport(o: Order) {
    const show = !this.showReport()[o.id];
    this.showReport.update(m => ({ ...m, [o.id]: show }));
    if (show && !this.reportUrl()[o.id] && this.reportBusy() !== o.id) {
      this.reportBusy.set(o.id);
      try {
        const rep = await this.ensureReport(o);
        if (rep) {
          const url = await buildReportBlobUrl(rep, this.api, this.injector);
          if (url) { this.blobUrls.add(url); this.reportUrl.update(m => ({ ...m, [o.id]: url })); }
          // Never a silent "No report yet" (or a default-design render) when
          // the report exists but its design couldn't load.
          this.reportFailed.update(m => ({ ...m, [o.id]: !url }));
        }
      } finally { this.reportBusy.set(null); }
    }
  }

  // ── ⋮ Report actions (order detail) ───────────────────────────────
  // The report shown in place gets the same menu as the Results list:
  // share (patient link, WhatsApp — delivery desk only), the PDF (download,
  // print) and the full report view — each by its endpoint / route guard.
  private readonly auth = inject(AuthService);
  private readonly reportActions = inject(ReportActionsService);
  // The delivery desk's "Send WhatsApp" row depends on the lab's sender.
  private readonly _waWarm = this.reportActions.warmWhatsApp();
  /** orderId → the stored report (by-order), fetched once. */
  private readonly repByOrder = new Map<string, Promise<StoredReport | null>>();
  private has(perms: string[]): boolean { return perms.some(p => this.auth.hasPermission(p)); }

  /** The order's report summary (the patient history carries it). */
  private reportOf(o: Order): { id: string; status?: string | null; type?: string | null } | null {
    const rep = (o as Order & { report?: { id: string; status?: string | null; type?: string | null } | null }).report ?? null;
    // An "Edit referral" here re-issued the report amended: point at the new one.
    const amended = this.referralFix()[o.id]?.reportId;
    return rep && amended ? { ...rep, id: amended } : rep;
  }

  /** The history summary's report type, when it carries one (else final). */
  private reportType(rep: { type?: string | null; status?: string | null }): string {
    return rep.type || (rep.status === 'partial' ? 'partial' : 'final');
  }

  // ── Edit referral (shared/components/edit-referral-dialog) ──────────
  /** The order whose referral dialog is open. */
  readonly referralFor = signal<string | null>(null);
  /** Saved referrals (the order list is the parent's input): the new doctor
   *  shows at once, and an amended report replaces the summary's id. */
  private readonly referralFix = signal<Record<string, { doctor: string | null; reportId: string | null }>>({});
  doctorLabel(o: Order): string {
    const fix = this.referralFix()[o.id];
    return (fix ? fix.doctor : o.refDoctorName)?.trim() || 'Self referral';
  }
  private canEditReferral(o: Order): boolean {
    return this.auth.hasPermission(EDIT_REFERRAL_PERM) && o.status !== 'cancelled';
  }
  menuLabel(o: Order): string { return this.reportOf(o) ? 'Report actions' : 'Order actions'; }
  onReferralSaved(o: Order, res: ReferralSaveResult): void {
    this.referralFor.set(null);
    if (!res.changed) return;
    const prev = this.referralFix()[o.id];
    this.referralFix.update(m => ({ ...m, [o.id]: {
      doctor: res.order?.refDoctorName ?? null,
      reportId: res.reportAmended ? (res.amendedReportId ?? null) : (prev?.reportId ?? null),
    } }));
    if (res.reportAmended) { this.repByOrder.delete(o.id); this.showReport.update(m => ({ ...m, [o.id]: false })); }
  }

  readonly detailActions = computed<PfAction[]>(() => {
    const o = this.openOrder();
    if (!o) return [];
    const rep = this.reportOf(o);
    const referral: PfAction[] = this.canEditReferral(o)
      ? [{ id: 'referral', label: 'Edit referral', icon: 'referral', group: 'Order', hint: 'Referring doctor, hospital or source' }]
      : [];
    if (!rep || !this.has(REPORT_BY_ORDER_PERMS)) return referral;
    const a: PfAction[] = [];
    if (this.reportActions.canLink({ id: rep.id, orderId: o.id })) {
      a.push({ id: 'share', label: 'Share…', icon: 'share', group: 'Share', hint: this.reportActions.shareHint() });
      a.push({ id: 'copy-link', label: 'Copy patient link', icon: 'link', group: 'Share' });
    }
    // Send WhatsApp (the lab's Cloud API number) + Share via my WhatsApp, or wa.me.
    a.push(...this.reportActions.whatsAppActions({ id: rep.id, orderId: o.id, type: this.reportType(rep) }));
    a.push({ id: 'download', label: 'Download PDF', icon: 'download', group: 'Report' });
    a.push({ id: 'print', label: 'Print', icon: 'print', group: 'Report', hint: this.auth.hasPermission('deliver_report') ? 'Recorded as delivered' : undefined });
    // The full viewer reads GET /api/reports/{id} (view_report | deliver_report).
    if (this.has(['view_report', 'deliver_report'])) a.push({ id: 'open-report', label: 'Open full report', icon: 'view', group: 'Go to' });
    a.push({ id: 'repeat', label: 'Repeat order', icon: 'repeat', group: 'Go to' });
    return [...referral, ...a];
  });

  private ensureReport(o: Order): Promise<StoredReport | null> {
    let p = this.repByOrder.get(o.id);
    if (!p) {
      p = firstValueFrom(this.api.get<StoredReport | null>(`/api/reports/by-order/${o.id}`)).catch(() => null);
      this.repByOrder.set(o.id, p);
      void p.then(r => { if (!r) this.repByOrder.delete(o.id); });
    }
    return p;
  }

  /** Menu opened: fetch the report + warm its patient link (Share… keeps the gesture). */
  onMenuOpened(o: Order): void {
    void this.ensureReport(o).then(r => { if (r) this.reportActions.prefetch({ id: r.id, orderId: o.id, qrToken: r.qrToken }); });
  }

  async runDetailAction(o: Order, id: string): Promise<void> {
    if (id === 'repeat') { this.repeat(o); return; }
    if (id === 'referral') { this.referralFor.set(o.id); return; }
    const summary = this.reportOf(o);
    if (id === 'open-report' && summary) { void this.router.navigate(['/reports/view', summary.id]); return; }
    const rep = await this.ensureReport(o);
    if (!rep) return;
    const ref = { ...rep, orderId: rep.orderId ?? o.id };
    switch (id) {
      case 'share': await this.reportActions.share(ref, this.snapshotPatient(rep).name); break;
      case 'copy-link': await this.reportActions.copyLink(ref); break;
      case 'whatsapp': this.reportActions.sendWhatsApp(ref, this.snapshotPatient(rep)); break;
      case 'whatsapp-mine': this.reportActions.whatsApp(ref, this.snapshotPatient(rep)); break;
      case 'download': await this.reportActions.download(ref); break;
      case 'print': await this.reportActions.print(ref); break;
    }
  }

  /** Patient name + phone from the report snapshot (for the message). */
  private snapshotPatient(rep: { data?: string; patient?: unknown }): { name: string | null; phone: string | null } {
    let snap: { displayName?: string; name?: string; phone?: string } | undefined;
    try { snap = JSON.parse(rep.data ?? '{}')?.patient; } catch { snap = undefined; }
    return currentRecipient(rep as never, snap);
  }

  ngOnDestroy() { for (const u of this.blobUrls) { try { URL.revokeObjectURL(u); } catch { /* */ } } }
}
