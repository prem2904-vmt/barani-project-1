import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, OnInit, computed, inject, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { Report } from '../../../shared/models/report.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { Order, OrderSample, OrderTest } from '../../../shared/models/order.model';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { waLink } from '../../../shared/utils/whatsapp';

type Filter = 'all' | 'partial' | 'pending' | 'delivered' | 'failed';

interface PrelimRow {
  name: string;
  title: string;
  value: unknown;
  unit?: string;
  range?: string;
  flag: 'normal' | 'abnormal' | 'critical';
}
interface PrelimTest { id: string; name: string; values: PrelimRow[] }
interface PrelimSample { id: string; deptName: string; deptCode: string; tests: PrelimTest[] }
interface PrelimOrder {
  id: string;
  patientName: string;
  patientMeta: string;
  totalSamples: number;
  validatedSamples: PrelimSample[];
  pendingSampleNames: string[];
}

@Component({
  selector: 'pf-report-queue',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent,
    KpiStripComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-rq-page px-4 md:px-8 pt-6">
     <div class="pf-rq-chrome">
      <pf-kpi-strip screen="report_queue"></pf-kpi-strip>
      <pf-screen-header
        eyebrow="Delivery queue"
        title="Report queue"
        subtitle="Validated orders ready to deliver to patients and referring doctors.">
        <pf-touch-btn actions size="sm" variant="secondary" (pressed)="refresh()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          </span>
          <span class="pf-rq-btn-label">Refresh</span>
        </pf-touch-btn>

        <!-- Phone-only (<=640px): a compact status icon between Refresh and
             Generate. Tapping opens a small popover with the same count
             breakdown the old .pf-rq-stats-m summary showed. Same signals,
             no business logic. -->
        <div actions class="pf-rq-statbtn-m">
          <button type="button" class="pf-rq-statbtn"
                  [class.is-open]="statsOpen()"
                  [attr.aria-expanded]="statsOpen()"
                  aria-label="Queue stats"
                  aria-controls="pf-rq-statpop"
                  (click)="toggleStats()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </button>
          @if (statsOpen()) {
            <div class="pf-rq-statpop__backdrop" aria-hidden="true" (click)="toggleStats()"></div>
            <div class="pf-rq-statpop" id="pf-rq-statpop" role="dialog" aria-label="Queue stats">
              <span class="pf-rq-stat" data-color="violet">
                <span class="pf-rq-stat__dot" aria-hidden="true"></span>
                <span class="pf-rq-stat__label">Total</span>
                <span class="pf-rq-stat__value">{{ items().length }}</span>
              </span>
              <span class="pf-rq-stat" data-color="amber">
                <span class="pf-rq-stat__dot" aria-hidden="true"></span>
                <span class="pf-rq-stat__label">Completed</span>
                <span class="pf-rq-stat__value">{{ counts().pending }}</span>
              </span>
              <span class="pf-rq-stat" data-color="sky">
                <span class="pf-rq-stat__dot" aria-hidden="true"></span>
                <span class="pf-rq-stat__label">Partial</span>
                <span class="pf-rq-stat__value">{{ partialOrders().length }}</span>
              </span>
              <span class="pf-rq-stat" data-color="emerald">
                <span class="pf-rq-stat__dot" aria-hidden="true"></span>
                <span class="pf-rq-stat__label">Delivered</span>
                <span class="pf-rq-stat__value">{{ counts().delivered }}</span>
              </span>
              <span class="pf-rq-stat" data-color="rose">
                <span class="pf-rq-stat__dot" aria-hidden="true"></span>
                <span class="pf-rq-stat__label">Failed</span>
                <span class="pf-rq-stat__value">{{ counts().failed }}</span>
              </span>
            </div>
          }
        </div>

        <pf-touch-btn actions size="sm" variant="primary" (pressed)="promptGenerate()" aria-label="Generate">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"/>
              <path d="M5 12h14"/>
            </svg>
          </span>
          <span class="pf-rq-btn-label">Generate</span>
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-rq-stats" aria-label="Report queue stats">
        <span class="pf-rq-stat" data-color="violet">
          <span class="pf-rq-stat__dot" aria-hidden="true"></span>
          <span class="pf-rq-stat__label">Total</span>
          <span class="pf-rq-stat__value">{{ items().length }}</span>
        </span>
        <span class="pf-rq-stat" data-color="amber">
          <span class="pf-rq-stat__dot" aria-hidden="true"></span>
          <span class="pf-rq-stat__label">Completed</span>
          <span class="pf-rq-stat__value">{{ counts().pending }}</span>
        </span>
        <span class="pf-rq-stat" data-color="sky">
          <span class="pf-rq-stat__dot" aria-hidden="true"></span>
          <span class="pf-rq-stat__label">Partial</span>
          <span class="pf-rq-stat__value">{{ partialOrders().length }}</span>
        </span>
        <span class="pf-rq-stat" data-color="emerald">
          <span class="pf-rq-stat__dot" aria-hidden="true"></span>
          <span class="pf-rq-stat__label">Delivered</span>
          <span class="pf-rq-stat__value">{{ counts().delivered }}</span>
        </span>
        <span class="pf-rq-stat" data-color="rose">
          <span class="pf-rq-stat__dot" aria-hidden="true"></span>
          <span class="pf-rq-stat__label">Failed</span>
          <span class="pf-rq-stat__value">{{ counts().failed }}</span>
        </span>
      </div>

      <div class="mb-4">
        <div class="pf-results-search">
          <svg class="pf-results-search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input type="text" class="pf-results-search__input"
                 [value]="query()"
                 (input)="setQuery(asInput($event))"
                 placeholder="Search by patient, MRN, phone, or order/report id…"/>
          @if (query()) {
            <button type="button" class="pf-results-search__clear"
                    (click)="setQuery('')" aria-label="Clear search">×</button>
          }
        </div>
      </div>

      <div class="mb-5">
        <pf-segmented
          [options]="filterOptions"
          [value]="filter()"
          size="md"
          (valueChange)="setFilter($event)">
        </pf-segmented>

        <!-- Phone-only (<=640px): the scrolling pill row becomes an
             icon-only filter row driving the SAME filter signal the pills
             drive (setFilter). Active status is highlighted in violet. -->
        <div class="pf-rq-filter-m" role="group" aria-label="Filter reports">
          <button type="button" class="pf-rq-filticon"
                  [class.is-active]="filter() === 'all'"
                  aria-label="All" title="All"
                  (click)="setFilter('all')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button type="button" class="pf-rq-filticon"
                  [class.is-active]="filter() === 'pending'"
                  aria-label="Completed" title="Completed"
                  (click)="setFilter('pending')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </button>
          <button type="button" class="pf-rq-filticon"
                  [class.is-active]="filter() === 'partial'"
                  aria-label="Partial" title="Partial"
                  (click)="setFilter('partial')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
              <path d="M22 12A10 10 0 0 0 12 2v10z"/>
            </svg>
          </button>
          <button type="button" class="pf-rq-filticon"
                  [class.is-active]="filter() === 'delivered'"
                  aria-label="Delivered" title="Delivered"
                  (click)="setFilter('delivered')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
          <button type="button" class="pf-rq-filticon"
                  [class.is-active]="filter() === 'failed'"
                  aria-label="Failed" title="Failed"
                  (click)="setFilter('failed')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </button>
        </div>
      </div>
     </div>

     <!-- Phone-only: name the active category so the icon-only filter row is
          unambiguous. Hidden >=641px (the pills are self-labelling there). -->
     <div class="pf-rq-filter-active" aria-live="polite">{{ activeFilterLabel() }}</div>

     <div class="pf-rq-body">
      @if (loading() && items().length === 0) {
        <div class="space-y-2.5">
          @for (i of [0,1,2,3]; track i) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-center gap-3">
                <pf-skeleton variant="block" width="40px" height="40px"></pf-skeleton>
                <div class="flex-1 space-y-2">
                  <pf-skeleton variant="line" width="45%"></pf-skeleton>
                  <pf-skeleton variant="line" width="70%" height="10px"></pf-skeleton>
                </div>
                <pf-skeleton variant="line" width="180px" height="28px"></pf-skeleton>
              </div>
            </pf-tile>
          }
        </div>
      } @else if (filter() === 'partial') {
        <!-- Partial tab content — orders with at least one whole
             sample (department) validated. Cards expand inline to
             show parameter values; "Generate partial PDF" releases
             a preliminary report (per-dept signed) for urgent
             handover, latest-supersedes-previous. -->
        @if (partialOrders().length === 0) {
          <pf-tile tone="default" padding="xl">
            <div class="text-center py-6">
              <p class="text-[14px]" style="color: var(--text-secondary);">
                No partial reports right now. They show up here as soon as one
                department finishes validation.
              </p>
            </div>
          </pf-tile>
        } @else {
          <div class="pf-prelim-list">
            @for (po of partialOrders(); track po.id) {
              <div class="pf-prelim-card"
                   [class.pf-prelim-card--open]="expanded() === po.id">
                <button type="button" class="pf-prelim-card__head" (click)="toggle(po.id)">
                  <div class="flex-1 min-w-0">
                    <p class="pf-prelim-card__name">{{ po.patientName }}</p>
                    <p class="pf-prelim-card__meta">{{ po.patientMeta }}</p>
                  </div>
                  <span class="pf-prelim-card__count">
                    {{ po.validatedSamples.length }}/{{ po.totalSamples }} depts
                  </span>
                  <svg class="pf-prelim-card__chev" width="18" height="18" viewBox="0 0 24 24"
                       fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </button>
                @if (expanded() === po.id) {
                  <div class="pf-prelim-card__body">
                    @for (vs of po.validatedSamples; track vs.id) {
                      <div class="pf-prelim-card__sample">
                        <header class="pf-prelim-card__sample-hdr">
                          <span class="pf-prelim-card__sample-dept">{{ vs.deptCode || vs.deptName }}</span>
                          <span class="pf-prelim-card__sample-name">{{ vs.deptName }}</span>
                        </header>
                        @for (t of vs.tests; track t.id) {
                          <div class="pf-prelim-card__test">
                            <p class="pf-prelim-card__test-name">{{ t.name }}</p>
                            @if (t.values.length === 0) {
                              <p class="pf-prelim-card__no-values">No parameter values recorded.</p>
                            } @else {
                              <ul class="pf-prelim-card__values">
                                @for (v of t.values; track v.name) {
                                  <li class="pf-prelim-card__row" [attr.data-flag]="v.flag">
                                    <span class="pf-prelim-card__row-name">{{ v.title }}</span>
                                    <span class="pf-prelim-card__row-value">
                                      {{ v.value }}@if (v.unit) {<span class="pf-prelim-card__row-unit"> {{ v.unit }}</span>}
                                    </span>
                                    <span class="pf-prelim-card__row-range">{{ v.range || '—' }}</span>
                                    <span class="pf-prelim-card__row-flag" [attr.data-flag]="v.flag">
                                      @switch (v.flag) {
                                        @case ('critical') { ⚠ Critical }
                                        @case ('abnormal') { ⚑ Abnormal }
                                        @default { ✓ Normal }
                                      }
                                    </span>
                                  </li>
                                }
                              </ul>
                            }
                          </div>
                        }
                      </div>
                    }
                    @if (po.pendingSampleNames.length > 0) {
                      <p class="pf-prelim-card__pending">
                        ⏳ Still pending: {{ po.pendingSampleNames.join(', ') }}
                      </p>
                    }
                    <div class="pf-prelim-card__actions">
                      <pf-touch-btn
                        size="md"
                        variant="primary"
                        [disabled]="generating() === po.id"
                        (pressed)="generatePartial(po)">
                        @if (generating() === po.id) {
                          Generating…
                        } @else {
                          Generate partial PDF
                        }
                      </pf-touch-btn>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      } @else if (visible().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">
              Queue is empty.
            </p>
          </div>
        </pf-tile>
      } @else {
        <div class="space-y-2.5">
          @for (r of visible(); track r.id) {
            <div class="pf-rq-row" [class]="'pf-rq-row--' + r.deliveryStatus">
              <span class="pf-rq-row__accent" aria-hidden="true"></span>
              <div class="pf-report-icon" [class]="'pf-report-' + r.deliveryStatus">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <path d="M14 2v6h6"/>
                  <path d="M16 13H8"/>
                  <path d="M16 17H8"/>
                  <path d="M10 9H8"/>
                </svg>
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="font-semibold text-[15px]" style="color: var(--text-primary);">
                    {{ r.order?.patient?.displayName ?? ('Report #' + r.id.slice(0, 8)) }}
                  </p>
                  <span class="pf-rq-row__badge">
                    <pf-chip [tone]="chipTone(r.deliveryStatus)" size="sm">{{ statusLabel(r.deliveryStatus) }}</pf-chip>
                  </span>
                </div>
                <!-- Phone-only (<=640px) subline: sex · age, shown under the
                     name since the full meta line is hidden on phone. Same
                     already-loaded order.patient data — no fetch. -->
                @if (patientSexAge(r.order?.patient); as sa) {
                  <p class="pf-rq-row__sexage">{{ sa }}</p>
                }
                <p class="pf-rq-row__meta text-[12px] mt-0.5 truncate" style="color: var(--text-tertiary);">
                  Order #{{ r.orderId.slice(0, 8) }}
                  · {{ r.type }}
                  · generated {{ r.createdAt | date:'short' }}
                  @if (r.order?.patient?.phone) { · {{ r.order?.patient?.phone }} }
                </p>
              </div>

              <div class="pf-rq-actions">
                <button type="button" class="pf-rq-iconbtn" title="Download PDF" (click)="downloadPdf(r)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span>Download</span>
                </button>
                <button type="button" class="pf-rq-iconbtn" title="View on screen" (click)="view(r)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span>View</span>
                </button>
                <button type="button" class="pf-rq-iconbtn pf-rq-iconbtn--wa" title="Send via WhatsApp" (click)="deliver(r, 'whatsapp')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01Zm-7.01 15.24h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.23 8.23 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.22 8.23Z"/>
                  </svg>
                  <span>WhatsApp</span>
                </button>
                <button type="button" class="pf-rq-iconbtn" title="Print" (click)="deliver(r, 'print')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9"/>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                    <rect x="6" y="14" width="12" height="8"/>
                  </svg>
                  <span>Print</span>
                </button>
              </div>
            </div>
          }
        </div>
      }
     </div>
    </section>
  `,
  styles: [`
    /* ───────────────────────────────────────────────────────────────
       NON-SCROLL WORK LAYOUT (all sizes — approved desktop change).
       The page fills the shell's main area exactly and never scrolls
       as a whole; the header chrome (kpi strip, screen header, stat
       bar, search, filter) is fixed and only the results body scrolls
       internally. dvh, not vh, for any height. No double scrollbars.
       ─────────────────────────────────────────────────────────────── */
    :host {
      display: block;
      height: 100%;
    }
    .pf-rq-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .pf-rq-chrome {
      flex: 0 0 auto;
      min-height: 0;
    }
    .pf-rq-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      /* Bottom breathing room (was pb-10 on the page) + safe-area for
         devices with a home indicator / phone tab nav. */
      padding-bottom: calc(28px + env(safe-area-inset-bottom, 0px));
      /* Smooth momentum scroll inside the panel on touch. */
      -webkit-overflow-scrolling: touch;
    }

    /* Segmented stat bar — full width, each stat owns an equal slice
     * with a hairline divider between. Reads as one structural row,
     * not 5 floating items spread thin on a wide page. */
    .pf-rq-stats {
      display: flex;
      flex-wrap: wrap;
      align-items: stretch;
      width: 100%;
      margin-bottom: 16px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .pf-rq-stat {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; padding: 7px 14px;
      line-height: 1.2;
      flex: 1 1 0; min-width: 0;
      border-right: 1px solid var(--glass-border);
    }
    .pf-rq-stat:last-child { border-right: none; }
    .pf-rq-stat__dot {
      width: 6px; height: 6px; border-radius: 999px;
      align-self: center;
      background: var(--rq-dot);
      box-shadow: 0 0 6px var(--rq-glow);
      flex: 0 0 6px;
    }
    .pf-rq-stat__label {
      font-size: 11px; font-weight: 500;
      color: var(--text-tertiary); letter-spacing: 0.01em;
    }
    .pf-rq-stat__value {
      font-size: 12.5px; font-weight: 600;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: -0.01em;
    }
    .pf-rq-stat:hover .pf-rq-stat__value {
      color: var(--rq-dot); transition: color 0.18s ease;
    }
    .pf-rq-stat[data-color='violet']  { --rq-dot: #a78bfa; --rq-glow: rgba(168, 85, 247, 0.45); }
    .pf-rq-stat[data-color='emerald'] { --rq-dot: #34d399; --rq-glow: rgba(16, 185, 129, 0.45); }
    .pf-rq-stat[data-color='amber']   { --rq-dot: #fbbf24; --rq-glow: rgba(245, 158, 11, 0.45); }
    .pf-rq-stat[data-color='rose']    { --rq-dot: #fb7185; --rq-glow: rgba(244, 63, 94, 0.45); }
    .pf-rq-stat[data-color='sky']     { --rq-dot: #38bdf8; --rq-glow: rgba(14, 165, 233, 0.45); }
    @media (max-width: 720px) {
      /* Phones / iPad portrait: drop the bar chrome, items wrap as pills. */
      .pf-rq-stats {
        background: transparent; border: none; border-radius: 0;
        gap: 4px 8px;
      }
      .pf-rq-stat {
        border-right: none; padding: 4px 10px; flex: 0 1 auto;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 999px;
      }
      .pf-rq-stat__label { font-size: 10.5px; }
      .pf-rq-stat__value { font-size: 12px; }
    }

    /* Search bar at top of Results — same visual rhythm as the FD
     * landing's main search so reception's muscle memory carries over. */
    .pf-results-search {
      position: relative;
      display: flex; align-items: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 0 12px 0 36px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .pf-results-search:focus-within {
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 247, 0.18);
    }
    .pf-results-search__icon {
      position: absolute; left: 12px; top: 50%;
      transform: translateY(-50%);
      color: var(--text-tertiary);
    }
    .pf-results-search__input {
      flex: 1;
      background: transparent; border: 0; outline: none;
      padding: 11px 0;
      color: var(--text-primary);
      font-size: 13.5px;
    }
    .pf-results-search__input::placeholder { color: var(--text-muted); }
    .pf-results-search__clear {
      background: transparent; border: 0;
      width: 24px; height: 24px;
      border-radius: 50%;
      color: var(--text-secondary); cursor: pointer;
      font-size: 18px; line-height: 1;
    }
    .pf-results-search__clear:hover { background: var(--bg-hover); color: var(--text-primary); }

    /* Row card — neutral glass background with a left-edge accent strip
       that carries the status colour. Replaces the previous full-tile
       amber/emerald/rose wash which made every row feel tinted. */
    .pf-rq-row {
      position: relative;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px 12px 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      transition: border-color 0.15s, background 0.15s, transform 0.1s;
    }
    .pf-rq-row:hover {
      background: rgba(255,255,255,0.04);
      border-color: rgba(168, 85, 247, 0.35);
    }
    .pf-rq-row__accent {
      position: absolute; left: 0; top: 10px; bottom: 10px;
      width: 3px; border-radius: 0 4px 4px 0;
      background: var(--text-muted);
    }
    .pf-rq-row--pending   .pf-rq-row__accent { background: #f59e0b; }
    .pf-rq-row--delivered .pf-rq-row__accent { background: #10b981; }
    .pf-rq-row--failed    .pf-rq-row__accent { background: #ef4444; }

    /* Action cluster — icon + label buttons in a unified group with
       subtle dividers, replacing the previous loose row of ghost +
       secondary buttons which competed visually. */
    .pf-rq-actions {
      display: flex; align-items: stretch; gap: 0;
      margin-left: auto;
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(0,0,0,0.18);
    }
    .pf-rq-iconbtn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 12px;
      background: transparent; border: 0;
      border-right: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 12.5px; font-weight: 500;
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .pf-rq-iconbtn:last-child { border-right: 0; }
    .pf-rq-iconbtn:hover {
      background: rgba(168, 85, 247, 0.12);
      color: var(--text-primary);
    }
    .pf-rq-iconbtn--wa:hover {
      background: rgba(37, 211, 102, 0.14);
      color: #4ade80;
    }
    @media (max-width: 720px) {
      .pf-rq-iconbtn span { display: none; }
      .pf-rq-iconbtn { padding: 9px 11px; }
    }

    .pf-report-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .pf-report-delivered {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(16, 185, 129, 0.08));
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .pf-report-pending {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(245, 158, 11, 0.08));
      color: #fcd34d;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .pf-report-failed {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(239, 68, 68, 0.08));
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    /* Cards list — the Partial tab renders this directly under the
       segmented filter, same vertical rhythm as the PDF list. No
       highlighted wrapper any more; the cards stand on their own. */
    .pf-prelim-list { display: flex; flex-direction: column; gap: 10px; }

    .pf-prelim-card {
      border-radius: 12px;
      background: var(--bg-card-solid, rgba(20, 22, 30, 0.6));
      border: 1px solid var(--glass-border);
      overflow: hidden;
      transition: border-color 0.18s;
    }
    .pf-prelim-card--open { border-color: rgba(34, 211, 238, 0.45); }

    .pf-prelim-card__head {
      width: 100%;
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px;
      background: transparent;
      border: none;
      color: var(--text-primary);
      cursor: pointer;
      text-align: left;
    }
    .pf-prelim-card__head:hover { background: var(--glass-bg); }
    .pf-prelim-card__name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-prelim-card__meta { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-prelim-card__count {
      flex-shrink: 0;
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.04em; text-transform: uppercase;
      padding: 4px 10px; border-radius: 9999px;
      background: rgba(34, 211, 238, 0.16);
      color: #67e8f9;
      border: 1px solid rgba(34, 211, 238, 0.34);
    }
    .pf-prelim-card__chev {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform 0.18s;
    }
    .pf-prelim-card--open .pf-prelim-card__chev { transform: rotate(180deg); }

    .pf-prelim-card__body {
      padding: 4px 14px 14px;
      border-top: 1px solid var(--glass-border);
    }
    .pf-prelim-card__sample {
      padding: 10px 12px;
      margin-top: 10px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--glass-border);
    }
    .pf-prelim-card__sample-hdr {
      display: flex; align-items: baseline; gap: 8px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-prelim-card__sample-dept {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.08em;
      padding: 2px 6px; border-radius: 4px;
      background: rgba(34, 211, 238, 0.16); color: #67e8f9;
    }
    .pf-prelim-card__sample-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-prelim-card__test { margin-bottom: 8px; }
    .pf-prelim-card__test:last-child { margin-bottom: 0; }
    .pf-prelim-card__test-name {
      margin: 0 0 4px;
      font-size: 12.5px; font-weight: 600;
      color: var(--text-secondary);
    }
    .pf-prelim-card__no-values { margin: 0; padding: 6px 0; font-size: 11.5px; color: var(--text-tertiary); font-style: italic; }
    .pf-prelim-card__values { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-prelim-card__row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr) auto;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 12px;
    }
    .pf-prelim-card__row[data-flag='abnormal'] { background: rgba(245, 158, 11, 0.08); }
    .pf-prelim-card__row[data-flag='critical'] { background: rgba(239, 68, 68, 0.10); }
    .pf-prelim-card__row-name { color: var(--text-primary); font-weight: 500; }
    .pf-prelim-card__row-value {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700; color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }
    .pf-prelim-card__row-unit { font-weight: 400; color: var(--text-tertiary); font-size: 11px; }
    .pf-prelim-card__row-range {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; color: var(--text-tertiary);
    }
    .pf-prelim-card__row-flag {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.05em;
      padding: 2px 6px; border-radius: 9999px;
      background: rgba(16, 185, 129, 0.16); color: #6ee7b7;
    }
    .pf-prelim-card__row-flag[data-flag='abnormal'] { background: rgba(245, 158, 11, 0.20); color: #fbbf24; }
    .pf-prelim-card__row-flag[data-flag='critical'] { background: rgba(239, 68, 68, 0.20); color: #fca5a5; }

    .pf-prelim-card__pending {
      margin: 12px 0 0;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.08);
      border-left: 3px solid #f59e0b;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .pf-prelim-card__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--glass-border);
    }
    @media (max-width: 639px) {
      .pf-prelim-card__actions { justify-content: stretch; }
      .pf-prelim-card__actions > * { flex: 1 1 0; }
    }

    @media (max-width: 639px) {
      .pf-prelim-card__row {
        grid-template-columns: 1fr auto;
        grid-template-areas: 'name flag' 'value flag' 'range flag';
        gap: 2px 12px;
      }
      .pf-prelim-card__row-name  { grid-area: name; }
      .pf-prelim-card__row-value { grid-area: value; }
      .pf-prelim-card__row-range { grid-area: range; }
      .pf-prelim-card__row-flag  { grid-area: flag; align-self: center; }
    }

    /* ───────────────────────────────────────────────────────────────
       CROSS-PLATFORM ADDITIVE OVERRIDES — phone / iPad / touch only.
       Desktop-web (>=1280px) is intentionally untouched: every rule
       below is gated behind a max-width / pointer / hover query so the
       base layout above never changes on desktop. No new logic.
       ─────────────────────────────────────────────────────────────── */

    /* PHONE (<=640px): the report row is icon + info + a 4-button action
       cluster. On a narrow phone the cluster + content can't fit on one
       line, so let the row wrap and push the actions onto their own full
       line. The action cluster then stretches edge-to-edge with each
       button taking an equal slice — easy to thumb. */
    @media (max-width: 640px) {
      .pf-rq-row {
        flex-wrap: wrap;
        row-gap: 10px;
      }
      .pf-rq-actions {
        margin-left: 0;
        width: 100%;
      }
      .pf-rq-iconbtn {
        flex: 1 1 0;
        justify-content: center;
        min-height: 44px;          /* >=44px tap target */
        padding: 11px 8px;
      }
      /* Keep the search clear button thumb-friendly. */
      .pf-results-search__clear {
        width: 32px; height: 32px;
        font-size: 20px;
      }
      /* iOS WKWebView auto-zooms any focused field whose font-size is
         < 16px. Bump the search input to 16px on phones only (desktop
         keeps its 13.5px density) and give it a comfortable >=44px
         tap height. */
      .pf-results-search__input {
        font-size: 16px;
        padding: 12px 0;
      }
    }

    /* TOUCH SIZING (coarse pointer, any width): the dense desktop icon
       buttons are too small to tap reliably. Bump min height without
       affecting mouse/desktop. */
    @media (pointer: coarse) {
      .pf-rq-iconbtn { min-height: 44px; }
      .pf-prelim-card__head { min-height: 52px; }
      .pf-results-search__clear { width: 32px; height: 32px; }
    }

    /* HOVER GATING: the row / button / stat hover affordances were
       written unconditionally and "stick" after a tap on touch devices.
       Re-assert them only where a real hover pointer exists. The base
       rules above stay intact for desktop; these just stop the sticky
       hover state on touch by not re-applying — but since the base
       rules already apply, we instead neutralise them on coarse-only
       pointers below. */
    @media (hover: none) {
      .pf-rq-row:hover {
        background: var(--glass-bg);
        border-color: var(--glass-border);
      }
      .pf-rq-iconbtn:hover {
        background: transparent;
        color: var(--text-secondary);
      }
      .pf-rq-iconbtn--wa:hover {
        background: transparent;
        color: var(--text-secondary);
      }
      .pf-prelim-card__head:hover { background: transparent; }
      .pf-results-search__clear:hover {
        background: transparent;
        color: var(--text-secondary);
      }
    }

    /* iPad / mid-width (641–1279px): the page already uses the full
       width well (stat bar segments, single-column rows that span the
       width). Nothing needs to collapse here — the row layout that
       works on desktop reads fine at tablet widths. Content already
       clears the 64px left rail via the shell. No overrides required;
       this comment documents the deliberate no-op so a future editor
       doesn't "fix" a band that isn't broken. */

    /* ───────────────────────────────────────────────────────────────
       PHONE-ONLY SLEEK PASS (<=640px). Every phone-only control is
       display:none by default so tablet/desktop (>=641px) is byte-for-
       byte unchanged. The phone variants only ever toggle on inside the
       max-width:640 query. No business logic — the select & dropdown
       drive the same filter / view-state signals as the desktop UI.
       ─────────────────────────────────────────────────────────────── */
    .pf-rq-statbtn-m { display: none; }
    .pf-rq-filter-m { display: none; }
    /* Sex · age subline is phone-only — desktop shows the full meta line. */
    .pf-rq-row__sexage { display: none; }
    /* Active-category label is phone-only — the desktop pills already label
       themselves. */
    .pf-rq-filter-active { display: none; }

    @media (max-width: 640px) {
      /* Refresh → icon-only: hide the label visually but keep it in the
         a11y tree (sr-only) so the button still has an accessible name. */
      .pf-rq-btn-label {
        position: absolute;
        width: 1px; height: 1px;
        padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0);
        white-space: nowrap; border: 0;
      }

      /* Drop the full stat bar — its data now lives behind the header
         status icon's popover. */
      .pf-rq-stats { display: none; }

      /* Header status icon + popover. The button sits in the action row
         between Refresh and Generate; the popover floats below it. */
      .pf-rq-statbtn-m { display: inline-flex; position: relative; }
      .pf-rq-statbtn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 10px;
        color: var(--text-secondary);
        cursor: pointer;
      }
      .pf-rq-statbtn.is-open {
        border-color: rgba(168, 85, 247, 0.55);
        color: #c4b5fd;
        background: rgba(124, 58, 247, 0.16);
      }
      .pf-rq-statpop__backdrop {
        position: fixed; inset: 0;
        z-index: 40;
        background: transparent;
      }
      .pf-rq-statpop {
        position: absolute; top: calc(100% + 8px); right: 0;
        z-index: 41;
        display: flex; flex-direction: column; gap: 4px;
        min-width: 168px;
        padding: 8px;
        background: var(--bg-card-solid, rgba(20, 22, 30, 0.96));
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      }
      .pf-rq-statpop .pf-rq-stat {
        justify-content: flex-start;
        gap: 8px; padding: 6px 8px;
        border-right: none; flex: 0 0 auto;
        border-radius: 8px;
      }
      .pf-rq-statpop .pf-rq-stat__label {
        flex: 1 1 auto; font-size: 12px;
      }
      .pf-rq-statpop .pf-rq-stat__value { font-size: 13px; }

      /* Swap the pill filter row for an icon-only filter row (same
         filter signal — setFilter). */
      pf-segmented { display: none; }
      /* The active category name, so icon-only filters read clearly. */
      .pf-rq-filter-active {
        display: block;
        margin: 10px 2px 2px;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.01em;
        color: var(--text-primary);
      }
      .pf-rq-filter-m {
        display: flex; align-items: center; gap: 8px;
      }
      .pf-rq-filticon {
        flex: 1 1 0;
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 40px; min-height: 44px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        color: var(--text-tertiary);
        cursor: pointer;
        transition: color 0.12s, border-color 0.12s, background 0.12s;
      }
      .pf-rq-filticon.is-active {
        color: #fff;
        border-color: rgba(168, 85, 247, 0.55);
        background: linear-gradient(135deg, rgba(124, 58, 247, 0.85), rgba(168, 85, 247, 0.7));
        box-shadow: 0 4px 14px rgba(124, 58, 247, 0.35);
      }

      /* Sleeker card: the colored status badge is redundant on phone —
         the left accent strip + icon already carry status. */
      .pf-rq-row__badge { display: none; }

      /* Phone card shows only patient name + the 4 action icons — drop
         the order/type/generated meta line entirely. */
      .pf-rq-row__meta { display: none; }

      /* …but show a compact sex · age line directly under the name. */
      .pf-rq-row__sexage {
        display: block;
        margin-top: 2px;
        font-size: 11.5px;
        line-height: 1.2;
        color: var(--text-tertiary);
      }
    }
  `]
})
export class ReportQueueComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);

  // "Completed" = lab work signed off, report generated, awaiting
  // delivery. Backed by deliveryStatus === 'pending' on the report row
  // (the technical name stays 'pending' for backwards compatibility;
  // the user-facing label reflects the semantic — these are completed
  // work products, not unfinished work).
  readonly filterOptions: SegmentedOption<Filter>[] = [
    { value: 'all',       label: 'All' },
    { value: 'pending',   label: 'Completed' },
    { value: 'partial',   label: 'Partial' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'failed',    label: 'Failed' }
  ];

  // Default to 'pending' (Completed) — the queue's primary purpose is
  // showing what's done and waiting for handover.
  private readonly _filter = signal<Filter>('pending');
  readonly filter = this._filter.asReadonly();
  /** Human label for the active filter — shown on phone above the list so the
   *  icon-only filter row reads clearly ("which category am I looking at?"). */
  readonly activeFilterLabel = computed(() =>
    this.filterOptions.find(o => o.value === this._filter())?.label ?? 'All');
  setFilter(f: Filter) { this._filter.set(f); }

  /** Phone-only presentational state: the compact stat summary's
   *  expanded/collapsed flag. No business logic. */
  private readonly _statsOpen = signal(false);
  readonly statsOpen = this._statsOpen.asReadonly();
  toggleStats() { this._statsOpen.update(v => !v); }

  /** Read the value off the phone filter <select> (drives the same
   *  filter signal the desktop pills drive). */
  asFilter(ev: Event): Filter { return (ev.target as HTMLSelectElement).value as Filter; }

  /** Free-text search across patient name, phone, order id and report
   *  id — same vibe as the FD landing's search box. */
  private readonly _query = signal<string>('');
  readonly query = this._query.asReadonly();
  setQuery(q: string) { this._query.set(q); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  private readonly _items = signal<Report[]>([]);
  readonly items = this._items.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  readonly counts = computed(() => {
    const l = this._items();
    return {
      pending:   l.filter(r => r.deliveryStatus === 'pending').length,
      delivered: l.filter(r => r.deliveryStatus === 'delivered').length,
      failed:    l.filter(r => r.deliveryStatus === 'failed').length
    };
  });

  readonly visible = computed(() => {
    const f = this._filter();
    const q = this._query().trim().toLowerCase();
    let l = this._items();
    if (f !== 'all') l = l.filter(r => r.deliveryStatus === f);
    if (q) {
      l = l.filter(r => {
        const name = (r.order?.patient?.displayName ?? '').toLowerCase();
        const phone = (r.order?.patient?.phone ?? '').toLowerCase();
        const mrn = (r.order?.patient?.mrn ?? '').toLowerCase();
        // Match against patient name, phone, MRN, short order id, and
        // short report id — covers every reasonable lookup reception
        // runs from a paper slip.
        return name.includes(q)
          || phone.includes(q)
          || mrn.includes(q)
          || r.orderId.toLowerCase().includes(q)
          || r.id.toLowerCase().includes(q);
      });
    }
    return l;
  });

  /** Every row now uses the neutral 'default' tile tone — the per-status
   *  colour wash made the entire row feel amber-on-amber for the common
   *  "Completed" case. Status is communicated by the small icon badge
   *  + chip + the left-edge accent strip instead. */
  rowTone(_status: string): TileTone {
    return 'default';
  }

  /** Phone-only subline text: "Male · 32y" built from the patient's sex and
   *  age. Reuses the already-loaded order.patient fields (no data fetch).
   *  Renders only what's available; returns '' if both are missing so the
   *  template's `@if … as` skips the element entirely. */
  patientSexAge(p: { sex?: string | null; age?: number | null } | null | undefined): string {
    if (!p) return '';
    const parts: string[] = [];
    const sex = this.formatSex(p.sex);
    if (sex) parts.push(sex);
    if (p.age != null && Number.isFinite(p.age) && p.age >= 0) parts.push(`${p.age}y`);
    return parts.join(' · ');
  }

  /** Normalise a raw sex value (e.g. 'm', 'FEMALE') to a short label. */
  private formatSex(sex?: string | null): string {
    const v = (sex ?? '').trim();
    if (!v) return '';
    const lc = v.toLowerCase();
    if (lc === 'm' || lc === 'male') return 'Male';
    if (lc === 'f' || lc === 'female') return 'Female';
    if (lc === 'o' || lc === 'other') return 'Other';
    return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  }

  chipTone(status: string): ChipTone {
    if (status === 'failed') return 'rose';
    if (status === 'pending') return 'amber';
    if (status === 'delivered') return 'emerald';
    return 'default';
  }

  /** Map raw deliveryStatus → user-facing label. The DB still stores
   *  'pending' for "report generated, awaiting handover" but the user
   *  thinks of these as Completed work, so we relabel at the edge. */
  statusLabel(status: string): string {
    if (status === 'pending') return 'Completed';
    if (status === 'delivered') return 'Delivered';
    if (status === 'failed') return 'Failed';
    return status;
  }

  // ── Preliminary report state ────────────────────────────────────
  // Loaded from /api/orders/today and filtered to orders with at
  // least one whole sample (department) validated. No PDF here —
  // values are read straight from each OrderTest.currentResult.
  private readonly _todayOrders = signal<Order[]>([]);
  private readonly _expanded = signal<string | null>(null);
  readonly expanded = this._expanded.asReadonly();
  toggle(id: string) { this._expanded.set(this._expanded() === id ? null : id); }

  // Single-flight guard while the partial PDF is being generated;
  // the value is the order ID currently being submitted (so we can
  // disable just that card's button, not all of them).
  private readonly _generating = signal<string | null>(null);
  readonly generating = this._generating.asReadonly();

  generatePartial(po: PrelimOrder) {
    if (this._generating()) return;
    this._generating.set(po.id);
    const sampleIds = po.validatedSamples.map(s => s.id);
    this.api.post<Report>('/api/reports/generate/partial', { orderId: po.id, sampleIds }).subscribe({
      next: r => {
        this._generating.set(null);
        if (r?.id) {
          this.toasts.success('Partial PDF generated');
          this.router.navigate(['/reports/view', r.id]);
        } else {
          this.toasts.warning('Could not generate — check that all selected tubes are validated.');
        }
      },
      error: e => {
        this._generating.set(null);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  /** Build PrelimOrder rows for any order with ≥1 validated sample.
   *  validate-result already used the same projection — we replicate
   *  it locally so this screen has no dependency on FD landing's
   *  helpers. */
  readonly partialOrders = computed<PrelimOrder[]>(() => {
    const out: PrelimOrder[] = [];
    for (const o of this._todayOrders()) {
      const samples = (o.samples ?? []).filter(s => s.status !== 'rejected');
      if (samples.length === 0) continue;
      const validated: PrelimSample[] = [];
      const pendingNames: string[] = [];
      for (const s of samples) {
        const tests = s.tests ?? [];
        const allDone = tests.length > 0 && tests.every(t => t.status === 'validated');
        if (allDone) {
          validated.push({
            id: s.id,
            deptName: s.department?.name ?? '',
            deptCode: s.department?.code ?? '',
            tests: tests.map(t => ({
              id: t.id,
              name: t.test?.name ?? 'Test',
              values: this.extractValues(t)
            }))
          });
        } else {
          pendingNames.push(s.department?.code || s.department?.name || 'Tube');
        }
      }
      // Skip orders with no validated samples (nothing to show) and
      // orders with EVERYTHING validated (those go through the regular
      // PDF queue, not here).
      if (validated.length === 0 || validated.length === samples.length) continue;
      out.push({
        id: o.id,
        patientName: o.patient?.displayName ?? 'Patient',
        patientMeta: `#${o.id.slice(0, 8)} · created ${this.formatTime(o.createdAt)}`,
        totalSamples: samples.length,
        validatedSamples: validated,
        pendingSampleNames: pendingNames
      });
    }
    return out;
  });

  private extractValues(t: OrderTest): PrelimRow[] {
    if (!t.currentResult || !t.test?.parameters) return [];
    let snap: { values?: Record<string, unknown> };
    try { snap = JSON.parse(t.currentResult); } catch { return []; }
    if (!snap.values) return [];
    let params: Array<{ name: string; title: string; unit?: string;
                        criticalLow?: number; criticalHigh?: number;
                        referenceRanges?: Array<{ min: number; max: number }> }> = [];
    try {
      const blob = JSON.parse(t.test.parameters) as { parameters?: any[] };
      params = blob.parameters ?? [];
    } catch { return []; }
    return params.map(p => {
      const v = snap.values![p.name];
      const n = Number(v);
      const isNum = !Number.isNaN(n) && v !== null && v !== undefined && v !== '';
      const r = (p.referenceRanges ?? [])[0];
      let flag: 'normal'|'abnormal'|'critical' = 'normal';
      if (isNum) {
        if ((p.criticalLow != null && n <= p.criticalLow) || (p.criticalHigh != null && n >= p.criticalHigh)) flag = 'critical';
        else if (r && (n < r.min || n > r.max)) flag = 'abnormal';
      }
      return {
        name: p.name,
        title: p.title || p.name,
        value: v ?? '—',
        unit: p.unit,
        range: r ? `${r.min}–${r.max}${p.unit ? ' ' + p.unit : ''}` : undefined,
        flag
      };
    });
  }

  private formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch { return ''; }
  }

  ngOnInit() {
    // Self-healing: ask the backend to generate any missing final
    // reports for orders that are already 'validated' but have no
    // report row yet (e.g. validations done before the
    // auto-report-on-validation hook landed). Idempotent on the
    // backend; failures are non-fatal — we still load the queue.
    this.api.post<{ generated: number }>('/api/reports/backfill', {}).subscribe({
      next: () => this.refresh(),
      error: () => this.refresh()
    });
  }

  refresh() {
    this._loading.set(true);
    this.api.get<Report[]>('/api/reports/queue').subscribe({
      next: l => { this._items.set(l ?? []); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
    // Independent fetch — partial reports come from /api/orders/today
    // (the report queue endpoint only knows about generated PDFs). A
    // failure here doesn't block the main queue load.
    this.api.get<Order[]>('/api/orders/today').subscribe({
      next: l => this._todayOrders.set(l ?? []),
      error: () => { /* non-fatal */ }
    });
  }

  view(r: Report) { this.router.navigate(['/reports/view', r.id]); }

  /** Download the report as a PDF (client-side render via jsPDF). Pulls
   *  the per-test resolved layouts so the PDF matches the on-screen viewer
   *  exactly (column widths, row colors + bold from conditions, merged
   *  rows, paragraphs, charts). */
  async downloadPdf(r: Report) {
    try {
      const { generateReportPdf, buildReportPdf } = await import('../../../shared/utils/report-pdf');
      const { baseInput, imageCache } = await this.buildReportRender(r);
      const blob = buildReportPdf({ ...baseInput, imageCache }).output('blob');
      if (this.isNativePlatform()) {
        // Capacitor WKWebView: web blob downloads are no-ops. Hand the PDF to
        // the native iOS share sheet (Save to Files, AirDrop, etc.) via the
        // Web Share API — no Capacitor plugin needed.
        await this.sharePdfNative(r, blob, 'Download report');
      } else {
        // Web/desktop: jsPDF's own download path still works.
        generateReportPdf({ ...baseInput, imageCache });
      }
      // Archive the rendered PDF to object storage (Spaces) so finished results
      // are stored and the patient's public report / QR-tracking page can serve
      // the exact file. Best-effort — never affects the download.
      this.uploadReportPdf(r, blob);
    } catch (err) {
      console.error('[reports] download failed', err);
      this.toasts.error('Could not download report');
    }
  }

  /** True when running inside the Capacitor native shell (iOS/Android),
   *  where web blob downloads and window.print are no-ops. */
  private isNativePlatform(): boolean {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
  }

  /** Present a rendered report PDF through the native iOS/Android share sheet
   *  using the Web Share API (level 2 — file sharing). From the sheet the user
   *  can Save to Files, Print, AirDrop, etc. AbortError (user dismisses the
   *  sheet) is swallowed; anything else surfaces a toast. */
  private async sharePdfNative(r: Report, blob: Blob, title: string) {
    const shortId = r.id.replace(/-/g, '').slice(-8).toUpperCase();
    const name = r.order?.patient?.displayName ?? '';
    const file = new File([blob], `report-${shortId}.pdf`, { type: 'application/pdf' });
    const text = name ? `Lab report for ${name}` : 'Lab report';
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
      } else {
        // No file-share support — fall back to the web download path.
        const { generateReportPdf } = await import('../../../shared/utils/report-pdf');
        const { baseInput, imageCache } = await this.buildReportRender(r);
        generateReportPdf({ ...baseInput, imageCache });
      }
    } catch (err) {
      // User cancelled the share sheet — not an error.
      if ((err as { name?: string })?.name === 'AbortError') return;
      throw err;
    }
  }

  /** Resolve the tenant template + per-test layouts + images needed to render a
   *  report PDF from its stored snapshot. Shared by download and archive.
   *  The template carries the admin-tunable chrome (colours, logo, signatures);
   *  without it the PDF falls back to the hardcoded Drlogy defaults. */
  private async buildReportRender(r: Report) {
    const [{ preloadReportImages }, { ReportLayoutService }, { PlatformService }] = await Promise.all([
      import('../../../shared/utils/report-pdf'),
      import('../../../core/services/report-layout.service'),
      import('../../../core/services/platform.service'),
    ]);
    const svc = this.injector.get(ReportLayoutService);
    const platform = this.injector.get(PlatformService);
    const resolvedLayouts: Record<string, import('../../../shared/models/report-layout.model').ResolvedReportLayout> = {};

    let tests: Array<{ testId?: string; result?: { values?: Record<string, unknown> } }> = [];
    let patient: { sex?: string | null; age?: number | null } | undefined;
    try {
      const snap = JSON.parse(r.data ?? '{}');
      tests = snap?.tests ?? [];
      patient = { sex: snap?.patient?.sex ?? null, age: snap?.patient?.age ?? null };
    } catch { /* malformed snapshot — render PDF without layouts */ }

    const [template] = await Promise.all([
      this.api.get<import('../../../shared/models/report.model').ReportTemplate | null>('/api/config/report-template').toPromise().catch(() => null),
      ...tests.map(async t => {
        if (!t.testId) return;
        try {
          resolvedLayouts[t.testId] = await svc.preview(
            t.testId,
            (t.result?.values ?? {}) as Record<string, unknown>,
            [],
            patient
          );
        } catch { /* test without a configured layout — fallback table */ }
      }),
    ]);

    const baseInput = { report: r, resolvedLayouts, template: template ?? null };
    const imageCache = await preloadReportImages(baseInput, platform.getApiUrl());
    return { baseInput, imageCache };
  }

  /** Upload a rendered report PDF blob to storage (best-effort). */
  private uploadReportPdf(r: Report, blob: Blob) {
    try {
      const fd = new FormData();
      fd.append('file', blob, `${r.id}.pdf`);
      this.api.post(`/api/reports/${r.id}/pdf`, fd).subscribe({ next: () => {}, error: () => {} });
    } catch { /* archive is best-effort */ }
  }

  /** Render + archive the report PDF (no local download) so the public
   *  /reports/public/{qrToken} link resolves to a real file when shared. */
  private async archiveReportPdf(r: Report) {
    try {
      const { buildReportPdf } = await import('../../../shared/utils/report-pdf');
      const { baseInput, imageCache } = await this.buildReportRender(r);
      this.uploadReportPdf(r, buildReportPdf({ ...baseInput, imageCache }).output('blob'));
    } catch { /* best-effort */ }
  }

  deliver(r: Report, via: string) {
    // WhatsApp: the Meta API isn't wired up yet, so open WhatsApp Web / app
    // (wa.me) pre-filled with the patient's number + a message carrying the
    // report's QR verify link. wa.me can't auto-attach the PDF, so the link
    // stands in for it. Then record the delivery best-effort.
    if (via === 'whatsapp') {
      // Ensure the public link resolves to a real file: render + archive the
      // PDF now (best-effort, in the background) so /reports/public/{qrToken}
      // can serve it by the time the patient opens the message. Fire before the
      // synchronous window.open so the popup isn't blocked.
      if (r.qrToken) this.archiveReportPdf(r);
      const lab = this.auth.user()?.tenantName || 'our lab';
      const name = r.order?.patient?.displayName ?? '';
      const link = r.qrToken ? `${environment.reportPublicBaseUrl}/reports/public/${r.qrToken}` : '';
      const lines = [
        name ? `Hi ${name},` : 'Hi,',
        `Your lab report from ${lab} is ready.`,
      ];
      if (link) lines.push(`View & download your report:\n${link}`);
      lines.push('Please contact us if you have any questions.');
      window.open(waLink(r.order?.patient?.phone, lines.join('\n\n')), '_blank', 'noopener');
    }
    if (via === 'print' && this.isNativePlatform()) {
      // There's no reliable print() inside the Capacitor WKWebView, so render
      // the PDF and hand it to the native share sheet — the user can pick Print
      // (or Save to Files) from there. Best-effort; the deliver record below
      // still fires regardless.
      (async () => {
        try {
          const { buildReportPdf } = await import('../../../shared/utils/report-pdf');
          const { baseInput, imageCache } = await this.buildReportRender(r);
          await this.sharePdfNative(r, buildReportPdf({ ...baseInput, imageCache }).output('blob'), 'Print report');
        } catch (err) {
          console.error('[reports] native print share failed', err);
          this.toasts.error('Could not open report');
        }
      })();
    }
    this.api.post(`/api/reports/${r.id}/deliver`, { via, note: via === 'whatsapp' ? 'wa.me link' : null }).subscribe({
      next: () => { if (via !== 'whatsapp') this.toasts.success(`Delivered via ${via}`); this.refresh(); },
      // WhatsApp already opened the wa.me window (the real handover), so its
      // delivery record is best-effort; for print/other, the POST *is* the
      // delivery — surface the backend's real reason on failure.
      error: e => { if (via !== 'whatsapp') this.toasts.error(ApiError.from(e).message); }
    });
  }

  async promptGenerate() {
    const oid = await this.dialog.prompt({
      title: 'Generate report',
      message: 'Enter the order ID to generate a final report.',
      placeholder: 'order id',
      required: true,
      confirmLabel: 'Generate'
    });
    if (!oid) return;
    this.api.post<Report>('/api/reports/generate', { orderId: oid, type: 'final' }).subscribe({
      next: r => { this.toasts.success('Report generated'); this.router.navigate(['/reports/view', r.id]); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
