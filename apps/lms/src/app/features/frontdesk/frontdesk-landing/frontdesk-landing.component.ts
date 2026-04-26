import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { Appointment } from '../../../shared/models/appointment.model';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';

type Tab = 'appointments' | 'orders' | 'ready' | 'walkins' | 'payments';
type DateRange = 'today' | 'yesterday' | '7d' | 'month' | 'custom';

interface StragglerItem {
  id: string;
  kind: 'missed' | 'uncollected' | 'unpaid';
  title: string;
  sub: string;
  age: string;
  patientId?: string;
  orderId?: string;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  status: 'on_duty' | 'on_break' | 'busy';
}

@Component({
  selector: 'pf-frontdesk-landing',
  standalone: true,
  imports: [DatePipe, PatientSearchComponent, AvatarComponent, ChipComponent, CurrencyInrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">

      <!-- ── Compact header ─────────────────────────────────────── -->
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="pf-head">
          <h1 class="pf-head__title">
            Good day, <span class="pf-head__name">{{ firstName() }}</span>
          </h1>
          <p class="pf-head__sub">{{ statusHint() }}</p>

          <div class="pf-head__actions">
            <span class="pf-collection" [class.pf-collection--idle]="collectedToday() === 0"
                  [title]="'Collected today'">
              <span class="pf-collection__dot"></span>
              {{ collectedToday() | inr }} <span class="pf-collection__sep">·</span>
              <span class="pf-collection__due">{{ dueToday() | inr }} due</span>
            </span>
            <span class="pf-toptest-pill" [class.pf-toptest-pill--idle]="!topTest()"
                  [title]="'Most ordered test today'">
              <span class="pf-toptest-pill__label">Top</span>
              <span class="pf-toptest-pill__name">{{ topTest()?.name ?? '—' }}</span>
              @if (topTest()) {
                <span class="pf-toptest-pill__count">×{{ topTest()!.count }}</span>
              }
            </span>
            <button type="button" class="pf-head__btn pf-head__btn--secondary press"
                    (click)="searchFocus()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6"/>
              </svg>
              Scan QR
            </button>

            <!-- Staff on duty: secondary button next to Scan QR. The on-
                 duty count rides on the button as a badge, so it's still
                 a glance-able status indicator without taking up its own
                 row of screen real estate. Tap → popover anchored under
                 the button (desktop/tablet) or full-width sheet (mobile). -->
            <div class="pf-staff-anchor">
              <button type="button"
                      class="pf-head__btn pf-head__btn--secondary press"
                      [class.pf-head__btn--on]="staffPopoverOpen()"
                      (click)="toggleStaffPopover($event)"
                      aria-haspopup="dialog"
                      [attr.aria-expanded]="staffPopoverOpen()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Staff
                <span class="pf-head__btn-badge">{{ onDutyCount() }}</span>
              </button>

              @if (staffPopoverOpen()) {
                <div class="pf-staff-pop-bd" (click)="closeStaffPopover()"></div>
                <div class="pf-staff-pop" role="dialog" aria-label="Staff on duty"
                     (click)="$event.stopPropagation()">
                  <header class="pf-staff-pop__hdr">
                    <span class="pf-staff-pop__dot" aria-hidden="true"></span>
                    <h2 class="pf-staff-pop__title">Staff on duty</h2>
                    <span class="pf-staff-pop__count">{{ onDutyCount() }}/{{ staff.length }}</span>
                  </header>
                  <ul class="pf-staff">
                    @for (s of staff; track s.id) {
                      <li class="pf-staff__row">
                        <pf-avatar [name]="s.name" [size]="24"></pf-avatar>
                        <span class="pf-staff__name">{{ s.name }}</span>
                        <span class="pf-staff__role">{{ s.role }}</span>
                        <span class="pf-staff__dot" [attr.data-state]="s.status"></span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>

            <button type="button" class="pf-head__btn pf-head__btn--primary press"
                    (click)="openRegister()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              New patient
            </button>
          </div>
        </div>
      </header>

      <div class="pf-page__body px-4 md:px-8 lg:px-10 pt-2 pb-6">

        <!-- Stragglers banner — yesterday's missed / uncollected / unpaid -->
        @if (stragglers().length > 0 && !stragglersDismissed()) {
          <div class="pf-stragglers" [class.pf-stragglers--open]="stragglersOpen()">
            <header class="pf-stragglers__hdr" (click)="toggleStragglers()">
              <span class="pf-stragglers__dot pulse-dot"></span>
              <span class="pf-stragglers__label">
                {{ stragglers().length }} need follow-up
                <span class="pf-stragglers__sub">
                  · {{ countBy('missed') }} missed · {{ countBy('uncollected') }} uncollected · {{ countBy('unpaid') }} unpaid
                </span>
              </span>
              <button type="button" class="pf-stragglers__x press"
                      (click)="$event.stopPropagation(); dismissStragglers()"
                      aria-label="Dismiss">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 6l12 12M18 6 6 18"/>
                </svg>
              </button>
              <svg class="pf-stragglers__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </header>
            @if (stragglersOpen()) {
              <ul class="pf-stragglers__list">
                @for (s of stragglers(); track s.id) {
                  <li class="pf-stragglers__item" [attr.data-kind]="s.kind">
                    <span class="pf-stragglers__kind">{{ kindLabel(s.kind) }}</span>
                    <span class="pf-stragglers__title">{{ s.title }}</span>
                    <span class="pf-stragglers__meta">{{ s.sub }} · {{ s.age }}</span>
                    <button type="button" class="pf-stragglers__cta press" (click)="openStraggler(s)">
                      Open →
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        }

        <!-- STAT / critical pinned row — always visible when items exist -->
        @if (statItems().length > 0) {
          <div class="pf-stat-row">
            <span class="pf-stat-row__flag">
              <span class="pf-stat-row__flag-dot pulse-dot"></span>
              STAT · {{ statItems().length }}
            </span>
            <ul class="pf-stat-row__list">
              @for (item of statItems(); track item.id) {
                <li class="pf-stat-chip press" (click)="openOrder(item)">
                  <pf-avatar [name]="item.patient?.displayName ?? 'Patient'" [size]="24"></pf-avatar>
                  <span class="pf-stat-chip__name">{{ item.patient?.displayName ?? 'Patient' }}</span>
                  <span class="pf-stat-chip__sub">· {{ item.samples?.length ?? 0 }} samples</span>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Single-column layout — staff lives in the header now, so no
             right-side aside. -->
        <div class="grid grid-cols-1 gap-5 items-start">
          <div class="min-w-0">

            <!-- Filter row: search + date pills -->
            <div class="pf-filter-row">
              <div class="pf-search-wrap">
                <pf-patient-search placeholder="Search patient · name, phone, ABHA, UHID…"
                                   (picked)="openProfile($event)"></pf-patient-search>
              </div>
              <div class="pf-date-pills relative" role="tablist" aria-label="Date range">
                @for (d of dateOptions; track d.id) {
                  @if (d.id === 'custom') {
                    <button type="button"
                            class="pf-date-pill press pf-date-pill--custom"
                            [class.pf-date-pill--on]="dateRange() === 'custom'"
                            (click)="toggleCalendar()"
                            [attr.aria-expanded]="calendarOpen()">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2"/>
                        <path d="M16 2v4M8 2v4M3 10h18"/>
                      </svg>
                      {{ customRangeLabel() }}
                    </button>
                  } @else {
                    <button type="button"
                            class="pf-date-pill press"
                            [class.pf-date-pill--on]="dateRange() === d.id"
                            (click)="setDateRange(d.id)">
                      {{ d.label }}
                    </button>
                  }
                }

                <!-- Calendar popover — anchored to the Custom pill. Click
                     a day for a single-day range; click another day to
                     extend it into a range. -->
                @if (calendarOpen()) {
                  <div class="pf-calbd" (click)="closeCalendar()"></div>
                  <div class="pf-cal" role="dialog" aria-label="Pick date range"
                       (click)="$event.stopPropagation()">
                    <header class="pf-cal__hdr">
                      <button type="button" class="pf-cal__nav press" (click)="prevMonth()" aria-label="Previous month">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="m15 18-6-6 6-6"/>
                        </svg>
                      </button>
                      <span class="pf-cal__title">{{ calMonth() | date:'MMMM y' }}</span>
                      <button type="button" class="pf-cal__nav press" (click)="nextMonth()" aria-label="Next month">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="m9 18 6-6-6-6"/>
                        </svg>
                      </button>
                    </header>
                    <div class="pf-cal__dows">
                      @for (d of dows; track d) { <span>{{ d }}</span> }
                    </div>
                    <div class="pf-cal__grid">
                      @for (cell of calCells(); track cell.iso) {
                        <button type="button"
                                class="pf-cal__cell press"
                                [class.pf-cal__cell--out]="cell.outside"
                                [class.pf-cal__cell--today]="cell.today"
                                [class.pf-cal__cell--start]="cell.isStart"
                                [class.pf-cal__cell--end]="cell.isEnd"
                                [class.pf-cal__cell--in]="cell.inRange"
                                [disabled]="cell.future"
                                (click)="pickDay(cell.iso)">
                          {{ cell.day }}
                        </button>
                      }
                    </div>
                    <footer class="pf-cal__foot">
                      <span class="pf-cal__hint">{{ customRangeHint() }}</span>
                      <button type="button" class="pf-cal__btn pf-cal__btn--ghost press"
                              (click)="clearCustom()" [disabled]="!customStart()">
                        Clear
                      </button>
                      <button type="button" class="pf-cal__btn pf-cal__btn--apply press"
                              (click)="applyCustom()" [disabled]="!customStart()">
                        Apply
                      </button>
                    </footer>
                  </div>
                }
              </div>
            </div>

            <!-- Two-panel layout: left menu (tablet+) / horizontal strip
                 (mobile) on the left, list on the right. The menu and list
                 are siblings inside .pf-twopanel; the same .pf-tp-item
                 buttons reflow between layouts via media queries. -->
            <div class="pf-twopanel">
              <nav class="pf-twopanel__menu" role="tablist" aria-label="Frontdesk queue">
                @for (t of tabOptions; track t.id) {
                  <button type="button"
                          class="pf-tp-item press"
                          [class.pf-tp-item--on]="tab() === t.id"
                          (click)="setTab(t.id)"
                          role="tab"
                          [attr.aria-selected]="tab() === t.id">
                    <span class="pf-tp-item__label">{{ t.label }}</span>
                    <span class="pf-tp-item__count" [attr.data-tone]="t.tone">
                      {{ counts()[t.id] }}
                    </span>
                  </button>
                }
              </nav>

            <!-- List container -->
            <div class="pf-list-wrap">
              @switch (tab()) {
                @case ('appointments') {
                  @if (visibleAppointments().length === 0) {
                    <p class="pf-empty">No appointments for this date range.</p>
                  }
                  <ul class="pf-cards">
                    @for (a of visibleAppointments(); track a.id) {
                      <li>
                        <div class="pf-card"
                             [attr.data-priority]="apptPriority(a)"
                             [class.pf-card--selected]="selectedIds().has(a.id)"
                             (click)="openAppointment(a)">
                          <button type="button" class="pf-card__sel"
                                  (click)="$event.stopPropagation(); toggleSelect(a.id)"
                                  [attr.aria-label]="selectedIds().has(a.id) ? 'Deselect' : 'Select'">
                            @if (selectedIds().has(a.id)) {
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                                <path d="m5 12 4 4L19 6"/>
                              </svg>
                            }
                          </button>
                          <div class="pf-card__slot">
                            <p class="pf-card__time">{{ a.slotTime || (a.appointmentDate | date:'shortTime') }}</p>
                            <p class="pf-card__date">{{ a.appointmentDate | date:'MMM d' }}</p>
                          </div>
                          <pf-avatar [name]="a.patient?.displayName ?? 'Patient'" [size]="40"></pf-avatar>
                          <div class="pf-card__body">
                            <p class="pf-card__name">{{ a.patient?.displayName ?? 'Patient' }}</p>
                            <p class="pf-card__meta">
                              {{ a.patient?.sex ?? '—' }} · {{ a.patient?.age ?? '—' }}y
                              @if (a.patient?.phone) { · {{ a.patient?.phone }} }
                              @if (hasOutstanding(a.patient?.id)) {
                                <span class="pf-card__flag pf-card__flag--balance" title="Outstanding balance">
                                  ● ₹ owed
                                </span>
                              }
                            </p>
                          </div>
                          <pf-chip [tone]="apptTone(a)" size="sm">{{ a.status }}</pf-chip>
                          <div class="pf-card__actions" (click)="$event.stopPropagation()">
                            @if (a.patient?.phone) {
                              <a [href]="'tel:' + a.patient!.phone" class="pf-iconbtn press" title="Call">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2A20 20 0 0 1 2.1 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.7.5 2.5a2 2 0 0 1-.5 2.1L7.9 9.5a16 16 0 0 0 6.6 6.6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.2 1.6.4 2.5.5A2 2 0 0 1 22 16.9z"/>
                                </svg>
                              </a>
                              <a [href]="'https://wa.me/' + cleanPhone(a.patient!.phone!)" target="_blank" class="pf-iconbtn press" title="WhatsApp">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M20 12a8 8 0 1 1-15.3-3.2L3 20l6.2-1.6A8 8 0 0 0 20 12Z"/>
                                </svg>
                              </a>
                            }
                            @if (a.status === 'booked') {
                              <button type="button" class="pf-ghostbtn press" (click)="checkIn(a)">Check-in</button>
                            }
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }

                @case ('orders') {
                  @if (visibleOrders().length === 0) {
                    <p class="pf-empty">No orders for this date range.</p>
                  }
                  <ul class="pf-cards">
                    @for (o of visibleOrders(); track o.id) {
                      <li>
                        <div class="pf-card pf-card--order"
                             [attr.data-priority]="o.priority"
                             [class.pf-card--selected]="selectedIds().has(o.id)"
                             (click)="openOrder(o)">
                          <button type="button" class="pf-card__sel"
                                  (click)="$event.stopPropagation(); toggleSelect(o.id)">
                            @if (selectedIds().has(o.id)) {
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                                <path d="m5 12 4 4L19 6"/>
                              </svg>
                            }
                          </button>
                          <pf-avatar [name]="o.patient?.displayName ?? 'Patient'" [size]="40"></pf-avatar>
                          <div class="pf-card__body">
                            <p class="pf-card__name">
                              {{ o.patient?.displayName ?? 'Patient' }}
                              @if (o.priority !== 'Normal') {
                                <span class="pf-card__prio" [attr.data-prio]="o.priority">{{ o.priority }}</span>
                              }
                            </p>
                            <p class="pf-card__meta">
                              #{{ o.id.slice(0, 8) }} · {{ o.samples.length }} samples · {{ o.createdAt | date:'shortTime' }}
                            </p>
                          </div>
                          <div class="pf-pipeline">
                            @for (step of pipeline(o); track step.label) {
                              <span class="pf-pipeline__node" [attr.data-state]="step.state"
                                    [title]="step.label + ' — ' + step.state"></span>
                            }
                          </div>
                          <pf-chip [tone]="orderTone(o)" size="sm">{{ statusLabel(o.status) }}</pf-chip>
                          <div class="pf-card__actions" (click)="$event.stopPropagation()">
                            <!-- created: bill-side action depends on billing_mode -->
                            @if (o.status === 'created') {
                              @if (showCreateBillOn(o)) {
                                <button type="button" class="pf-ghostbtn press pf-ghostbtn--accent" (click)="goToBilling(o)">Create Bill</button>
                              } @else {
                                <span class="pf-tag pf-tag--warn">⏳ Awaiting Billing</span>
                              }
                            }
                            <!-- billed: collection-side action depends on collection_mode -->
                            @else if (o.status === 'billed') {
                              @if (showCollectOn(o)) {
                                <button type="button" class="pf-ghostbtn press" (click)="collectSample(o)">Collect Sample</button>
                              } @else if (isPartiallyCollected(o)) {
                                <span class="pf-tag pf-tag--ok">◐ Collecting</span>
                              } @else {
                                <span class="pf-tag pf-tag--warn">⏳ Awaiting Collection</span>
                              }
                            }
                            <!-- sample_collected: FD ships it to the lab -->
                            @else if (o.status === 'sample_collected') {
                              @if (showDispatchOn(o)) {
                                <button type="button" class="pf-ghostbtn press pf-ghostbtn--accent" (click)="markDispatched(o)">Mark Dispatched</button>
                              } @else {
                                <span class="pf-tag pf-tag--ok">✓ Collected</span>
                              }
                            }
                            <!-- post-dispatch lifecycle: read-only badges -->
                            @else if (o.status === 'dispatched') {
                              <span class="pf-tag pf-tag--ok">🚗 Dispatched</span>
                            } @else if (o.status === 'in_transit') {
                              <span class="pf-tag pf-tag--ok">📦 Arrived at lab</span>
                            } @else if (o.status === 'received_in_lab' || o.status === 'received' || o.status === 'processing') {
                              <span class="pf-tag pf-tag--ok">🔬 In Lab · TAT running</span>
                            } @else if (o.status === 'resulted') {
                              <span class="pf-tag pf-tag--ok">⏳ Awaiting Validation</span>
                            } @else if (o.status === 'validated') {
                              <span class="pf-tag pf-tag--ok">📄 Report Ready</span>
                            } @else if (o.status === 'delivered') {
                              <span class="pf-tag pf-tag--ok">✅ Delivered</span>
                            } @else if (o.status === 'rejected' || o.status === 'partially_rejected') {
                              <span class="pf-tag pf-tag--warn">❌ Rejected</span>
                            }
                            <button type="button" class="pf-ghostbtn press" (click)="quickBook(o)">Repeat</button>
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }

                @case ('ready') {
                  @if (readyForPickup().length === 0) {
                    <p class="pf-empty">No reports waiting for pickup.</p>
                  }
                  <ul class="pf-cards">
                    @for (o of readyForPickup(); track o.id) {
                      <li>
                        <div class="pf-card pf-card--ready" (click)="openOrder(o)">
                          <pf-avatar [name]="o.patient?.displayName ?? 'Patient'" [size]="40"></pf-avatar>
                          <div class="pf-card__body">
                            <p class="pf-card__name">{{ o.patient?.displayName ?? 'Patient' }}</p>
                            <p class="pf-card__meta">Report ready · waiting {{ reportAge(o) }}</p>
                          </div>
                          <pf-chip tone="emerald" size="sm">ready</pf-chip>
                          <div class="pf-card__actions" (click)="$event.stopPropagation()">
                            @if (o.patient?.phone) {
                              <a [href]="'https://wa.me/' + cleanPhone(o.patient!.phone!)" target="_blank" class="pf-ghostbtn press">Nudge</a>
                            }
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }

                @case ('walkins') {
                  @if (walkins().length === 0) {
                    <p class="pf-empty">No walk-ins waiting.</p>
                  }
                  <ul class="pf-cards">
                    @for (a of walkins(); track a.id) {
                      <li>
                        <div class="pf-card pf-card--walkin" (click)="openAppointment(a)">
                          <div class="pf-card__slot">
                            <p class="pf-card__time">{{ a.slotTime || (a.appointmentDate | date:'shortTime') }}</p>
                            <p class="pf-card__date pf-card__date--walkin">walk-in</p>
                          </div>
                          <pf-avatar [name]="a.patient?.displayName ?? 'Patient'" [size]="40"></pf-avatar>
                          <div class="pf-card__body">
                            <p class="pf-card__name">{{ a.patient?.displayName ?? 'Patient' }}</p>
                            <p class="pf-card__meta">
                              {{ a.patient?.sex ?? '—' }} · {{ a.patient?.age ?? '—' }}y · waiting
                            </p>
                          </div>
                          <pf-chip tone="amber" size="sm">waiting</pf-chip>
                          <div class="pf-card__actions" (click)="$event.stopPropagation()">
                            <button type="button" class="pf-ghostbtn press" (click)="checkIn(a)">Register</button>
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }

                @case ('payments') {
                  @if (paymentsDue().length === 0) {
                    <p class="pf-empty">No unpaid bills.</p>
                  }
                  <ul class="pf-cards">
                    @for (b of paymentsDue(); track b.id) {
                      <li>
                        <div class="pf-card pf-card--unpaid">
                          <div class="pf-card__slot">
                            <p class="pf-card__time pf-card__time--bill">{{ b.balance | inr }}</p>
                            <p class="pf-card__date">due</p>
                          </div>
                          <pf-avatar [name]="patientName(b.patientId)" [size]="40"></pf-avatar>
                          <div class="pf-card__body">
                            <p class="pf-card__name">{{ patientName(b.patientId) }}</p>
                            <p class="pf-card__meta">Bill #{{ b.id.slice(0, 8) }} · {{ b.createdAt | date:'MMM d' }}</p>
                          </div>
                          <pf-chip tone="rose" size="sm">unpaid</pf-chip>
                          <div class="pf-card__actions">
                            <button type="button" class="pf-ghostbtn press" (click)="collectPayment(b)">Collect</button>
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                }
              }
            </div>
            </div>
          </div>

        </div>

        <!-- Bulk actions — appears when 1+ selected -->
        @if (selectedIds().size > 0) {
          <div class="pf-bulkbar">
            <span class="pf-bulkbar__count">{{ selectedIds().size }} selected</span>
            <div class="flex-1"></div>
            <button type="button" class="pf-bulkbar__btn press" (click)="bulkSms()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              SMS
            </button>
            <button type="button" class="pf-bulkbar__btn press" (click)="bulkWhatsapp()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 12a8 8 0 1 1-15.3-3.2L3 20l6.2-1.6A8 8 0 0 0 20 12Z"/>
              </svg>
              WhatsApp
            </button>
            <button type="button" class="pf-bulkbar__btn pf-bulkbar__btn--ghost press" (click)="clearSelection()">Clear</button>
          </div>
        }
      </div>

      <!-- Order drawer (detail view) -->
      @if (selectedOrder(); as so) {
        <div class="pf-drawer-bd" (click)="closeOrder()"></div>
        <aside class="pf-drawer" role="dialog" aria-modal="true">
          <header class="pf-drawer__hdr">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <pf-avatar [name]="so.patient?.displayName ?? 'Patient'" [size]="44"></pf-avatar>
              <div class="min-w-0 flex-1">
                <p class="text-[10.5px] font-mono uppercase tracking-[0.16em]"
                   style="color: var(--text-muted);">Order · #{{ so.id.slice(0, 8) }}</p>
                <p class="text-[17px] font-semibold truncate"
                   style="color: var(--text-primary);">{{ so.patient?.displayName ?? 'Patient' }}</p>
              </div>
              <pf-chip [tone]="orderTone(so)" size="sm">{{ so.status }}</pf-chip>
            </div>
            <button type="button" class="pf-drawer__close" (click)="closeOrder()" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </header>

          <div class="pf-drawer__body">
            <dl class="pf-drawer__meta">
              <div><dt>Created</dt><dd>{{ so.createdAt | date:'MMM d, h:mm a' }}</dd></div>
              <div><dt>Priority</dt><dd>{{ so.priority }}</dd></div>
              <div><dt>Samples</dt><dd>{{ so.samples.length }}</dd></div>
              <div><dt>Doctor</dt><dd>{{ so.refDoctorName || '—' }}</dd></div>
            </dl>

            <section>
              <p class="pf-drawer__eyebrow">Timeline</p>
              <ol class="pf-vtl">
                @for (step of pipeline(so); track step.label) {
                  <li class="pf-vtl__row" [attr.data-state]="step.state">
                    <span class="pf-vtl__node">
                      @if (step.state === 'done') {
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="2 6 5 9 10 3"/>
                        </svg>
                      }
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="pf-vtl__label">{{ step.label }}</p>
                      <p class="pf-vtl__status">{{ stepCaption(so, step) }}</p>
                    </div>
                  </li>
                }
              </ol>
            </section>
          </div>
        </aside>
      }
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; overflow-x: hidden; }
    .pf-page { min-height: 100%; display: flex; flex-direction: column; }
    .pf-page__header { flex-shrink: 0; }
    .pf-page__body { padding-top: 4px; padding-bottom: 16px; }

    /* ── Compact header ─────────────────────────────────────── */
    .pf-head {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas:
        "title actions"
        "sub actions";
      gap: 2px 16px;
      align-items: center;
      padding: 6px 0 12px;
    }
    @media (max-width: 767px) {
      .pf-head {
        grid-template-columns: 1fr;
        grid-template-areas: "title" "sub" "actions";
        gap: 4px;
      }
      .pf-head__actions { justify-content: flex-start; flex-wrap: wrap; margin-top: 8px; }
    }
    .pf-head__title {
      grid-area: title;
      margin: 0;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      line-height: 1.1;
    }
    @media (min-width: 768px) { .pf-head__title { font-size: 32px; } }
    .pf-head__name {
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .pf-head__sub {
      grid-area: sub;
      margin: 0;
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-head__actions {
      grid-area: actions;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      align-self: center;
    }

    .pf-head__btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 38px;
      padding: 0 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
    }
    .pf-head__btn--secondary {
      background: var(--glass-bg);
      color: var(--text-primary);
      border-color: var(--glass-border);
    }
    .pf-head__btn--secondary:hover { background: var(--glass-bg-hover); }
    .pf-head__btn--primary {
      background: var(--gradient-primary);
      color: #fff;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4);
    }
    .pf-head__btn--primary:hover { box-shadow: 0 10px 24px rgba(124, 58, 237, 0.55); transform: translateY(-1px); }

    /* Today's collection chip */
    .pf-collection {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.28);
      color: #34d399;
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-collection--idle { background: var(--glass-bg); border-color: var(--glass-border); color: var(--text-muted); }
    .pf-collection__dot {
      width: 6px; height: 6px; border-radius: 9999px;
      background: #34d399;
      box-shadow: 0 0 8px rgba(52, 211, 153, 0.7);
    }
    .pf-collection--idle .pf-collection__dot { background: var(--text-muted); box-shadow: none; }
    .pf-collection__sep { opacity: 0.4; }
    .pf-collection__due { color: #fca5a5; font-weight: 500; }
    .pf-collection--idle .pf-collection__due { color: var(--text-muted); }

    /* ── Stragglers banner ──────────────────────────────────── */
    .pf-stragglers {
      margin-bottom: 12px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(239, 68, 68, 0.06));
      border: 1px solid rgba(245, 158, 11, 0.35);
      overflow: hidden;
    }
    .pf-stragglers__hdr {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      cursor: pointer;
    }
    .pf-stragglers__dot {
      width: 10px; height: 10px; border-radius: 9999px;
      background: #f59e0b;
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.8);
      flex-shrink: 0;
    }
    .pf-stragglers__label { font-size: 13px; font-weight: 600; color: var(--text-primary); flex: 1; min-width: 0; }
    .pf-stragglers__sub { font-weight: 400; color: var(--text-secondary); font-size: 12px; }
    .pf-stragglers__chev { color: var(--text-secondary); transition: transform 0.2s; }
    .pf-stragglers--open .pf-stragglers__chev { transform: rotate(180deg); }
    .pf-stragglers__x {
      width: 26px; height: 26px; border-radius: 9999px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .pf-stragglers__list {
      list-style: none; margin: 0; padding: 0 14px 12px;
      display: flex; flex-direction: column; gap: 4px;
      border-top: 1px solid rgba(245, 158, 11, 0.2);
      padding-top: 8px;
    }
    .pf-stragglers__item {
      display: grid;
      grid-template-columns: 110px 1fr auto auto;
      gap: 12px;
      align-items: center;
      padding: 8px 0;
      font-size: 12.5px;
    }
    @media (max-width: 767px) {
      .pf-stragglers__item { grid-template-columns: auto 1fr auto; }
      .pf-stragglers__meta { display: none; }
    }
    .pf-stragglers__kind {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 9999px;
      text-align: center;
    }
    .pf-stragglers__item[data-kind='missed'] .pf-stragglers__kind { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }
    .pf-stragglers__item[data-kind='uncollected'] .pf-stragglers__kind { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
    .pf-stragglers__item[data-kind='unpaid'] .pf-stragglers__kind { background: rgba(139, 92, 246, 0.18); color: #c4b5fd; }
    .pf-stragglers__title { color: var(--text-primary); font-weight: 500; }
    .pf-stragglers__meta { color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }
    .pf-stragglers__cta {
      height: 26px; padding: 0 10px;
      border-radius: 9999px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 11.5px; font-weight: 600;
      cursor: pointer;
    }
    .pf-stragglers__cta:hover { background: var(--glass-bg-hover); color: var(--text-primary); }

    /* ── STAT pinned row ────────────────────────────────────── */
    .pf-stat-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 14px;
      margin-bottom: 12px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(219, 39, 119, 0.06));
      border: 1px solid rgba(239, 68, 68, 0.38);
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08);
      overflow-x: auto;
    }
    .pf-stat-row__flag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-weight: 700;
      color: #fca5a5;
      flex-shrink: 0;
    }
    .pf-stat-row__flag-dot {
      width: 8px; height: 8px; border-radius: 9999px;
      background: #ef4444;
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.9);
    }
    .pf-stat-row__list {
      list-style: none; padding: 0; margin: 0;
      display: flex; gap: 8px; flex: 1;
    }
    .pf-stat-chip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px 6px 6px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      cursor: pointer;
      font-size: 12.5px;
      flex-shrink: 0;
    }
    .pf-stat-chip:hover { background: rgba(255, 255, 255, 0.1); }
    .pf-stat-chip__name { font-weight: 600; color: var(--text-primary); }
    .pf-stat-chip__sub { color: var(--text-tertiary); font-size: 11px; }

    /* ── Filter row (search + date pills) ───────────────────── */
    .pf-filter-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .pf-search-wrap { flex: 1; min-width: 260px; }
    .pf-date-pills {
      display: inline-flex;
      padding: 3px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      gap: 2px;
      flex-shrink: 0;
    }
    .pf-date-pill {
      height: 32px;
      padding: 0 14px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 600;
      border-radius: 9999px;
      cursor: pointer;
      transition: color 0.2s, background 0.2s;
    }
    .pf-date-pill:hover { color: var(--text-primary); }
    .pf-date-pill--on {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);
    }
    .pf-date-pill--custom {
      display: inline-flex; align-items: center; gap: 6px;
    }

    /* Calendar popover — anchored to the Custom pill. */
    .pf-calbd {
      position: fixed; inset: 0;
      z-index: 38;
      background: transparent;
    }
    .pf-cal {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 40;
      width: 286px;
      padding: 12px;
      border-radius: 16px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
      animation: pf-cal-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    @keyframes pf-cal-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (max-width: 480px) {
      /* On narrow viewports anchor full-width below the pills row. */
      .pf-cal { right: auto; left: 0; right: 0; width: auto; }
    }
    .pf-cal__hdr {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 10px;
    }
    .pf-cal__title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: 0.01em;
    }
    .pf-cal__nav {
      width: 28px; height: 28px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .pf-cal__nav:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-cal__dows {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
      margin-bottom: 4px;
    }
    .pf-cal__dows span {
      text-align: center;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 4px 0;
    }
    .pf-cal__grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    .pf-cal__cell {
      aspect-ratio: 1 / 1;
      border-radius: 8px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .pf-cal__cell:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      color: var(--text-primary);
    }
    .pf-cal__cell:disabled { opacity: 0.32; cursor: not-allowed; }
    .pf-cal__cell--out { color: var(--text-muted); }
    .pf-cal__cell--today {
      border-color: rgba(168, 85, 247, 0.5);
      color: #c4b5fd;
    }
    .pf-cal__cell--in {
      background: rgba(168, 85, 247, 0.16);
      color: var(--text-primary);
    }
    .pf-cal__cell--start,
    .pf-cal__cell--end {
      background: var(--gradient-primary) !important;
      color: #ffffff !important;
      border-color: transparent !important;
      box-shadow: 0 6px 14px rgba(124, 58, 237, 0.45);
    }
    .pf-cal__foot {
      display: flex; align-items: center; gap: 6px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border-muted);
    }
    .pf-cal__hint {
      flex: 1; min-width: 0;
      font-size: 11px;
      color: var(--text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-cal__btn {
      height: 28px;
      padding: 0 12px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .pf-cal__btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pf-cal__btn--ghost {
      background: var(--glass-bg);
      color: var(--text-secondary);
      border-color: var(--glass-border);
    }
    .pf-cal__btn--ghost:hover:not(:disabled) { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-cal__btn--apply {
      background: var(--gradient-primary);
      color: #ffffff;
    }
    .pf-cal__btn--apply:hover:not(:disabled) { box-shadow: 0 6px 16px rgba(124, 58, 237, 0.45); }

    /* ── Two-panel layout ─────────────────────────────────────
     * Same buttons reflow between layouts via media queries. On mobile
     * the menu becomes a horizontal scrollable strip with an underline
     * indicator; on tablet+ it becomes a sticky vertical menu.
     */
    .pf-twopanel { display: grid; }

    @media (max-width: 767px) {
      .pf-twopanel {
        grid-template-rows: auto 1fr;
        gap: 12px;
      }
      .pf-twopanel__menu {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--border-muted);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .pf-twopanel__menu::-webkit-scrollbar { display: none; }
      .pf-tp-item {
        position: relative;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 10px 14px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: color 0.2s;
      }
      .pf-tp-item:hover { color: var(--text-primary); }
      .pf-tp-item--on { color: var(--text-primary); }
      .pf-tp-item--on::after {
        content: '';
        position: absolute;
        left: 12px; right: 12px; bottom: -1px;
        height: 3px;
        background: var(--gradient-primary);
        border-radius: 3px;
        box-shadow: 0 0 12px rgba(168, 85, 247, 0.55);
        animation: pf-tp-in 0.25s ease both;
      }
    }

    @media (min-width: 768px) {
      .pf-twopanel {
        grid-template-columns: 220px minmax(0, 1fr);
        gap: 16px;
        align-items: start;
      }
      .pf-twopanel__menu {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border-radius: 14px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        position: sticky;
        top: 12px;
      }
      .pf-tp-item {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 600;
        text-align: left;
        border-radius: 10px;
        cursor: pointer;
        transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
      }
      .pf-tp-item:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
      .pf-tp-item--on {
        background: var(--gradient-primary);
        color: #ffffff;
        border-color: transparent;
        box-shadow: 0 6px 16px rgba(124, 58, 237, 0.35);
      }
      .pf-tp-item--on:hover { background: var(--gradient-primary); color: #ffffff; }
    }

    @keyframes pf-tp-in { from { transform: scaleX(0.4); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }

    .pf-tp-item__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-tp-item__count {
      min-width: 22px;
      padding: 2px 7px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-size: 10.5px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-tertiary);
      text-align: center;
      flex-shrink: 0;
    }
    .pf-tp-item--on .pf-tp-item__count {
      background: rgba(255, 255, 255, 0.22);
      color: #ffffff;
      border-color: transparent;
    }
    .pf-tp-item__count[data-tone='rose']    { color: #fca5a5; background: rgba(239, 68, 68, 0.16); border-color: rgba(239, 68, 68, 0.3); }
    .pf-tp-item__count[data-tone='amber']   { color: #fbbf24; background: rgba(245, 158, 11, 0.16); border-color: rgba(245, 158, 11, 0.3); }
    .pf-tp-item__count[data-tone='emerald'] { color: #34d399; background: rgba(16, 185, 129, 0.16); border-color: rgba(16, 185, 129, 0.3); }
    .pf-tp-item--on .pf-tp-item__count[data-tone] {
      background: rgba(255, 255, 255, 0.22);
      color: #ffffff;
      border-color: transparent;
    }

    /* ── Cards list ────────────────────────────────────────── */
    .pf-empty {
      margin: 0;
      padding: 36px 0;
      text-align: center;
      font-size: 13px;
      color: var(--text-tertiary);
    }
    .pf-cards {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-card {
      display: grid;
      grid-template-columns: auto auto auto minmax(0, 1fr) auto auto;
      gap: 12px;
      align-items: center;
      padding: 10px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.08s, box-shadow 0.25s;
      position: relative;
    }
    .pf-card:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }
    .pf-card:active { transform: scale(0.995); }
    .pf-card--selected {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.14), rgba(236, 72, 153, 0.06)) !important;
      border-color: rgba(168, 85, 247, 0.5) !important;
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.12);
    }
    /* STAT / Urgent accent stripe */
    .pf-card[data-priority='STAT']::before,
    .pf-card[data-priority='Urgent']::before {
      content: '';
      position: absolute;
      left: 0; top: 14%; bottom: 14%;
      width: 3px;
      border-radius: 3px;
    }
    .pf-card[data-priority='STAT']::before {
      background: linear-gradient(180deg, #ef4444, #db2777);
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.7);
    }
    .pf-card[data-priority='Urgent']::before {
      background: linear-gradient(180deg, #f59e0b, #fbbf24);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
    }

    .pf-card__sel {
      width: 22px; height: 22px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 2px solid var(--border-muted);
      color: #ffffff;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
    }
    .pf-card--selected .pf-card__sel {
      background: var(--gradient-primary);
      border-color: transparent;
    }

    .pf-card__slot {
      text-align: center;
      min-width: 56px;
      flex-shrink: 0;
    }
    .pf-card__time {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    .pf-card__time--bill {
      font-size: 15px;
      background: linear-gradient(135deg, #fca5a5, #f472b6);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .pf-card__date {
      margin: 1px 0 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-card__date--walkin { color: #fbbf24; }

    .pf-card__body { min-width: 0; }
    .pf-card__name {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex; align-items: center; gap: 8px;
    }
    .pf-card__prio {
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700;
      letter-spacing: 0.1em;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .pf-card__prio[data-prio='STAT'] { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
    .pf-card__prio[data-prio='Urgent'] { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .pf-card__meta {
      margin: 2px 0 0;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    .pf-card__flag--balance {
      color: #fca5a5;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(239, 68, 68, 0.28);
    }

    .pf-pipeline {
      display: inline-flex;
      gap: 4px;
      flex-shrink: 0;
    }
    .pf-pipeline__node {
      width: 8px; height: 8px; border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: all 0.2s;
    }
    .pf-pipeline__node[data-state='done']   { background: #10b981; border-color: transparent; box-shadow: 0 0 8px rgba(16, 185, 129, 0.55); }
    .pf-pipeline__node[data-state='active'] { background: #f59e0b; border-color: transparent; box-shadow: 0 0 8px rgba(245, 158, 11, 0.6); }

    .pf-card__actions {
      display: inline-flex;
      gap: 4px;
      flex-shrink: 0;
    }
    .pf-iconbtn {
      width: 30px; height: 30px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center;
      text-decoration: none;
      transition: background 0.15s, color 0.15s;
    }
    .pf-iconbtn:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-ghostbtn {
      height: 30px; padding: 0 12px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .pf-ghostbtn:hover { background: var(--gradient-primary); color: #ffffff; border-color: transparent; }
    .pf-ghostbtn--accent {
      background: rgba(45, 212, 191, 0.12);
      color: #5eead4;
      border-color: rgba(45, 212, 191, 0.4);
    }
    .pf-ghostbtn--accent:hover {
      background: linear-gradient(135deg, #14b8a6, #2dd4bf);
      color: #04221e;
      border-color: transparent;
    }
    .pf-tag {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 9px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.04em;
    }
    /* Top test today — compact stat pill in the header. */
    .pf-toptest-pill {
      display: inline-flex; align-items: center; gap: 6px;
      height: 32px;
      padding: 0 12px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.3);
      font-size: 12px;
      font-weight: 600;
      max-width: 220px;
    }
    .pf-toptest-pill--idle {
      background: var(--glass-bg);
      border-color: var(--glass-border);
    }
    .pf-toptest-pill__label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #c4b5fd;
      flex-shrink: 0;
    }
    .pf-toptest-pill--idle .pf-toptest-pill__label { color: var(--text-muted); }
    .pf-toptest-pill__name {
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .pf-toptest-pill--idle .pf-toptest-pill__name { color: var(--text-tertiary); }
    .pf-toptest-pill__count {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      color: #a78bfa;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .pf-tag--ok {
      color: #5eead4;
      background: rgba(45, 212, 191, 0.12);
      border: 1px solid rgba(45, 212, 191, 0.35);
    }
    .pf-tag--warn {
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.35);
    }

    /* Card at narrow widths — collapse actions */
    @media (max-width: 640px) {
      .pf-card {
        grid-template-columns: auto auto auto minmax(0, 1fr) auto;
        gap: 10px;
      }
      .pf-card__actions { display: none; }
      .pf-card__sel { display: none; }
    }

    /* ── Right sidebar widgets (xl+) ───────────────────────── */
    .pf-aside {
      position: sticky;
      top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pf-staff-card {
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      overflow: hidden;
    }
    .pf-staff-card[open] { background: var(--bg-card-solid); }
    .pf-staff-card__hdr {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      cursor: pointer;
      list-style: none;
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-staff-card__hdr::-webkit-details-marker { display: none; }
    .pf-staff-card__dot {
      width: 8px; height: 8px; border-radius: 9999px;
      background: #34d399;
      box-shadow: 0 0 6px rgba(52, 211, 153, 0.7);
      flex-shrink: 0;
    }
    .pf-staff-card__title { font-weight: 600; color: var(--text-primary); flex: 1; min-width: 0; }
    .pf-staff-card__count {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      color: var(--text-muted);
      letter-spacing: 0.06em;
    }
    .pf-staff-card__chev { color: var(--text-secondary); transition: transform 0.2s; flex-shrink: 0; }
    .pf-staff-card[open] .pf-staff-card__chev { transform: rotate(180deg); }
    .pf-staff-card .pf-staff {
      padding: 0 12px 12px;
      border-top: 1px solid var(--border-muted);
      padding-top: 10px;
    }

    .pf-staff { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-staff__row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
    .pf-staff__name { font-weight: 600; color: var(--text-primary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-staff__role { font-size: 10.5px; color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-staff__dot { width: 8px; height: 8px; border-radius: 9999px; flex-shrink: 0; }
    .pf-staff__dot[data-state='on_duty']  { background: #34d399; box-shadow: 0 0 6px rgba(52, 211, 153, 0.7); }
    .pf-staff__dot[data-state='on_break'] { background: #fbbf24; box-shadow: 0 0 6px rgba(251, 191, 36, 0.7); }
    .pf-staff__dot[data-state='busy']     { background: #f87171; box-shadow: 0 0 6px rgba(248, 113, 113, 0.7); }

    /* ── Mobile staff chip + bottom sheet ─────────────────────
     * The chip sits floating just above the bulkbar/ bottom-nav so it's
     * always reachable but never crowds the main column. Tap → slide-up
     * sheet with the full staff list. */
    .pf-staff-fab {
      position: fixed;
      right: 16px;
      bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
      z-index: 25;
      display: inline-flex; align-items: center; gap: 6px;
      height: 32px;
      padding: 0 12px;
      border-radius: 9999px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 11.5px;
      font-weight: 600;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
      cursor: pointer;
    }
    .pf-staff-fab:hover { color: var(--text-primary); background: var(--glass-bg-hover); }
    .pf-staff-fab__dot {
      width: 6px; height: 6px; border-radius: 9999px;
      background: #34d399;
      box-shadow: 0 0 6px rgba(52, 211, 153, 0.7);
    }
    .pf-staff-sheet-bd {
      position: fixed; inset: 0;
      z-index: 46;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      animation: pf-fade 0.2s ease both;
    }
    .pf-staff-sheet {
      position: fixed;
      left: 8px; right: 8px;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
      z-index: 47;
      max-height: 70vh;
      padding: 10px 14px 16px;
      border-radius: 22px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.55);
      animation: pf-sheet-up 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .pf-staff-sheet__handle {
      width: 36px; height: 4px;
      margin: 4px auto 12px;
      border-radius: 2px;
      background: var(--border-muted);
    }
    .pf-staff-sheet__hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .pf-staff-sheet__title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .pf-staff-sheet__x {
      width: 28px; height: 28px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    @keyframes pf-sheet-up {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0)   ; opacity: 1; }
    }

    /* ── Bulk action bar ────────────────────────────────────── */
    .pf-bulkbar {
      position: sticky;
      bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
      margin-top: 12px;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 18px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      animation: pf-bulkbar-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    @media (min-width: 1280px) {
      .pf-bulkbar { bottom: 1rem; }
    }
    @keyframes pf-bulkbar-in {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .pf-bulkbar__count {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-bulkbar__btn {
      display: inline-flex; align-items: center; gap: 6px;
      height: 34px;
      padding: 0 14px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      border: none;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .pf-bulkbar__btn:hover { box-shadow: 0 8px 18px rgba(124, 58, 237, 0.45); }
    .pf-bulkbar__btn--ghost {
      background: var(--glass-bg);
      color: var(--text-secondary);
      border: 1px solid var(--glass-border);
    }
    .pf-bulkbar__btn--ghost:hover { box-shadow: none; background: var(--glass-bg-hover); color: var(--text-primary); }

    /* ── Order drawer (kept mostly from previous) ──────────── */
    .pf-drawer-bd {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      z-index: 44;
      animation: pf-fade 0.2s ease both;
    }
    .pf-drawer {
      position: fixed;
      right: 0; top: 0; bottom: 0;
      width: min(100%, 480px);
      background: var(--bg-card-solid);
      border-left: 1px solid var(--glass-border);
      box-shadow: -12px 0 48px rgba(0, 0, 0, 0.5);
      z-index: 45;
      display: flex;
      flex-direction: column;
      animation: pf-drawer-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .pf-drawer__hdr {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-drawer__close {
      width: 36px; height: 36px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .pf-drawer__body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 16px;
    }
    .pf-drawer__meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 20px;
      margin: 0 0 20px;
    }
    .pf-drawer__meta > div { display: flex; flex-direction: column; gap: 2px; }
    .pf-drawer__meta dt {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0;
    }
    .pf-drawer__meta dd { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-drawer__eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0 0 10px;
    }

    .pf-vtl {
      list-style: none; padding: 0; margin: 0;
      position: relative;
    }
    .pf-vtl::before {
      content: '';
      position: absolute;
      left: 10px; top: 16px; bottom: 16px;
      width: 2px;
      background: var(--border-muted);
      border-radius: 1px;
    }
    .pf-vtl__row {
      position: relative;
      display: flex;
      gap: 12px;
      padding: 6px 0 14px;
      align-items: flex-start;
    }
    .pf-vtl__node {
      position: relative;
      z-index: 1;
      width: 22px; height: 22px;
      border-radius: 9999px;
      background: var(--bg-card-solid);
      border: 2px solid var(--border-muted);
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff;
      flex-shrink: 0;
    }
    .pf-vtl__row[data-state='done']   .pf-vtl__node { background: #10b981; border-color: #10b981; }
    .pf-vtl__row[data-state='active'] .pf-vtl__node { background: #f59e0b; border-color: #f59e0b; animation: pf-tl-pulse 1.6s infinite; }
    .pf-vtl__label { margin: 2px 0 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-vtl__status { margin: 2px 0 0; font-size: 11.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-tertiary); }
    .pf-vtl__row[data-state='pending'] .pf-vtl__label { color: var(--text-secondary); }

    @keyframes pf-tl-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55); }
      50%      { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
    }
    @keyframes pf-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-drawer-in { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `]
})
export class FrontdeskLandingComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly labCfg = inject(BranchLabConfigService);
  // Cached ETag from /api/orders/today; sent as If-None-Match next poll.
  private _ordersEtag: string | null = null;
  // Local content signature used as a belt-and-braces no-op detector when an
  // intermediary strips ETag headers.
  private _ordersSig: string | null = null;

  readonly tabOptions: Array<{ id: Tab; label: string; tone?: 'rose' | 'amber' | 'emerald' }> = [
    { id: 'appointments', label: 'Appointments' },
    { id: 'orders',       label: 'In progress' },
    { id: 'ready',        label: 'Ready for pickup', tone: 'emerald' },
    { id: 'walkins',      label: 'Walk-ins',         tone: 'amber' },
    { id: 'payments',     label: 'Payments due',     tone: 'rose' },
  ];

  readonly dateOptions: Array<{ id: DateRange; label: string }> = [
    { id: 'today',  label: 'Today' },
    { id: '7d',     label: 'Last 7 days' },
    { id: 'custom', label: 'Custom' },
  ];

  readonly dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Mocked staff — backend doesn't track duty status yet. */
  readonly staff: StaffMember[] = [
    { id: '1', name: 'Priya Sharma',   role: 'Receptionist',    status: 'on_duty' },
    { id: '2', name: 'Ravi Kumar',     role: 'Phlebotomist',    status: 'on_duty' },
    { id: '3', name: 'Dr. Arjun Mehta', role: 'Pathologist',    status: 'busy' },
    { id: '4', name: 'Kavita Reddy',   role: 'Lab technician',  status: 'on_break' },
  ];

  private readonly _tab = signal<Tab>('appointments');
  readonly tab = this._tab.asReadonly();

  private readonly _dateRange = signal<DateRange>('today');
  readonly dateRange = this._dateRange.asReadonly();

  // Custom date range — stored as ISO yyyy-MM-dd strings so signal equality
  // works with primitives. _customEnd is null until the user picks a second
  // day (single-day picks set start, leave end null and we treat end=start).
  private readonly _customStart = signal<string | null>(null);
  private readonly _customEnd = signal<string | null>(null);
  readonly customStart = this._customStart.asReadonly();
  readonly customEnd = this._customEnd.asReadonly();
  // Calendar popover open state + the month currently being viewed (1st of
  // month, so day-grid math doesn't drift across DST boundaries).
  private readonly _calendarOpen = signal(false);
  readonly calendarOpen = this._calendarOpen.asReadonly();
  private readonly _calMonth = signal<Date>(this.firstOfThisMonth());
  readonly calMonth = this._calMonth.asReadonly();

  private readonly _selectedIds = signal<Set<string>>(new Set());
  readonly selectedIds = this._selectedIds.asReadonly();

  private readonly _stragglersOpen = signal<boolean>(false);
  readonly stragglersOpen = this._stragglersOpen.asReadonly();
  private readonly _stragglersDismissed = signal<boolean>(false);
  readonly stragglersDismissed = this._stragglersDismissed.asReadonly();

  // Staff popover anchored to the header button. Single state across all
  // viewports — popover positioning falls back to a centred sheet on
  // narrow widths via CSS.
  private readonly _staffPopoverOpen = signal<boolean>(false);
  readonly staffPopoverOpen = this._staffPopoverOpen.asReadonly();

  private readonly _appointments = signal<Appointment[]>([]);
  private readonly _orders = signal<Order[]>([]);
  private readonly _bills = signal<Bill[]>([]);
  private readonly _selectedOrder = signal<Order | null>(null);

  readonly appointments = this._appointments.asReadonly();
  readonly orders = this._orders.asReadonly();
  readonly bills = this._bills.asReadonly();
  readonly selectedOrder = this._selectedOrder.asReadonly();

  readonly firstName = computed(() => this.auth.user()?.firstName || this.auth.user()?.displayName?.split(' ')[0] || 'there');

  readonly statusHint = computed(() => {
    const a = this._appointments().length;
    const o = this._orders().length;
    const due = this.paymentsDue().length;
    return `${a} scheduled · ${o} orders · ${due} payments due`;
  });

  // Date helpers ---------------------------------------------
  private inRange(d: Date | string | undefined): boolean {
    if (!d) return false;
    const when = new Date(d).getTime();
    const start = this.rangeStart();
    const end = this.rangeEnd();
    return when >= start && when < end;
  }
  private rangeStart(): number {
    const r = this._dateRange();
    const now = new Date(); now.setHours(0, 0, 0, 0);
    switch (r) {
      case 'today':     return now.getTime();
      case 'yesterday': return now.getTime() - 86_400_000;
      case '7d':        return now.getTime() - 7 * 86_400_000;
      case 'month':     return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      case 'custom': {
        const s = this._customStart();
        return s ? this.dayStart(s).getTime() : now.getTime();
      }
      default:          return now.getTime();
    }
  }
  private rangeEnd(): number {
    const r = this._dateRange();
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (r === 'yesterday') return now.getTime();
    if (r === 'custom') {
      // End is exclusive; use end-of-day + 1ms so the picked day is included.
      const e = this._customEnd() ?? this._customStart();
      if (e) return this.dayStart(e).getTime() + 86_400_000;
      return Date.now();
    }
    return Date.now();
  }
  private dayStart(iso: string): Date {
    const d = new Date(iso); d.setHours(0, 0, 0, 0); return d;
  }
  private toIsoDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Filtered lists -------------------------------------------
  readonly visibleAppointments = computed(() =>
    this._appointments().filter(a => this.inRange(a.appointmentDate))
  );
  readonly visibleOrders = computed(() =>
    this._orders().filter(o => this.inRange(o.createdAt) && o.status !== 'completed')
  );
  readonly readyForPickup = computed(() =>
    this._orders().filter(o => o.status === 'completed')
  );
  readonly walkins = computed(() =>
    this._appointments().filter(a =>
      this.inRange(a.appointmentDate) &&
      (a.type === 'walkin' || a.collectionType === 'walkin') &&
      (a.status === 'booked' || a.status === 'checked_in')
    )
  );
  readonly paymentsDue = computed(() =>
    this._bills().filter(b => b.balance > 0)
  );

  // Stragglers -----------------------------------------------
  readonly stragglers = computed<StragglerItem[]>(() => {
    const yesterdayStart = Date.now() - 86_400_000;
    const items: StragglerItem[] = [];

    // Missed appointments (booked but appointmentDate passed)
    for (const a of this._appointments()) {
      const when = new Date(a.appointmentDate).getTime();
      if (when < yesterdayStart && a.status === 'booked') {
        items.push({
          id: 'm-' + a.id,
          kind: 'missed',
          title: a.patient?.displayName ?? 'Patient',
          sub: a.slotTime || 'no slot',
          age: this.ago(when),
          patientId: a.patientId,
        });
      }
    }
    // Uncollected reports (>24h since completion)
    for (const o of this._orders()) {
      if (o.status === 'completed') {
        const when = new Date(o.createdAt).getTime();
        if (Date.now() - when > 86_400_000) {
          items.push({
            id: 'u-' + o.id,
            kind: 'uncollected',
            title: o.patient?.displayName ?? 'Patient',
            sub: `#${o.id.slice(0, 8)}`,
            age: this.ago(when),
            patientId: o.patientId,
            orderId: o.id,
          });
        }
      }
    }
    // Unpaid bills older than 24h
    for (const b of this._bills()) {
      if (b.balance > 0) {
        const when = new Date(b.createdAt).getTime();
        if (Date.now() - when > 86_400_000) {
          items.push({
            id: 'p-' + b.id,
            kind: 'unpaid',
            title: this.patientName(b.patientId),
            sub: `Bill #${b.id.slice(0, 8)}`,
            age: this.ago(when),
            patientId: b.patientId,
          });
        }
      }
    }
    return items;
  });

  // STAT pinned row
  readonly statItems = computed(() =>
    this._orders().filter(o => o.priority === 'STAT' && o.status !== 'completed')
  );

  // Tab counts
  readonly counts = computed(() => ({
    appointments: this.visibleAppointments().length,
    orders: this.visibleOrders().length,
    ready: this.readyForPickup().length,
    walkins: this.walkins().length,
    payments: this.paymentsDue().length,
  }));

  // Collection summary today
  readonly collectedToday = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return this._bills()
      .filter(b => new Date(b.createdAt).getTime() >= todayStart.getTime())
      .reduce((sum, b) => sum + b.totalPaid, 0);
  });
  readonly dueToday = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return this._bills()
      .filter(b => new Date(b.createdAt).getTime() >= todayStart.getTime())
      .reduce((sum, b) => sum + b.balance, 0);
  });

  // Top tests today — derive from today's orders. Drops entries whose Test
  // relation didn't load (so we never show a useless "Unknown" pill); the
  // header surfaces only the single top test as a compact metric.
  readonly topTests = computed(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const counts = new Map<string, number>();
    for (const o of this._orders()) {
      if (new Date(o.createdAt).getTime() < todayStart.getTime()) continue;
      for (const s of o.samples) {
        for (const t of s.tests ?? []) {
          const name = t.test?.name?.trim();
          if (!name) continue;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  });
  readonly topTest = computed(() => this.topTests()[0] ?? null);

  // Calendar grid: 6 weeks × 7 days, anchored on the visible month. Each
  // cell is fully self-describing so the template stays declarative.
  readonly calCells = computed<Array<{
    iso: string; day: number; outside: boolean; today: boolean;
    isStart: boolean; isEnd: boolean; inRange: boolean; future: boolean;
  }>>(() => {
    const month = this._calMonth();
    const year = month.getFullYear();
    const m = month.getMonth();
    const todayIso = this.toIsoDay(new Date());
    const todayMs = this.dayStart(todayIso).getTime();
    const start = this._customStart();
    const end = this._customEnd() ?? start;
    // Grid origin: the Sunday on/before the 1st of the month.
    const first = new Date(year, m, 1);
    const origin = new Date(year, m, 1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + i);
      const iso = this.toIsoDay(d);
      const ms = d.getTime();
      cells.push({
        iso,
        day: d.getDate(),
        outside: d.getMonth() !== m,
        today: iso === todayIso,
        isStart: !!start && iso === start,
        isEnd: !!end && !!start && end !== start && iso === end,
        inRange: !!start && !!end && ms >= this.dayStart(start).getTime()
                 && ms <= this.dayStart(end).getTime(),
        future: ms > todayMs,
      });
    }
    return cells;
  });

  // Live polling: 30s tick keeps Today's Orders fresh so reception sees
  // status changes (collected → dispatched → received → validated) without
  // a manual refresh. Stopped on destroy + when the tab is hidden so we
  // don't burn requests on a backgrounded laptop.
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  protected readonly lastUpdated = signal<number>(Date.now());

  ngOnInit() {
    this.labCfg.ensureLoaded();
    this.refresh();
    this.pollHandle = setInterval(() => {
      // Skip polls while the tab is hidden — saves bandwidth on inactive
      // tabs without changing perceived freshness once focus returns.
      if (typeof document !== 'undefined' && document.hidden) return;
      this.refresh();
    }, 30_000);
  }
  ngOnDestroy() {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  refresh() {
    this.api.get<Appointment[]>('/api/appointments/today').subscribe({
      next: l => this._appointments.set(l ?? []),
    });
    // Polled ~ every 30s — bypass ApiService here so we can drive If-None-Match.
    // Server returns 304 with no body when nothing material has changed,
    // letting us skip the signal write entirely (and the cascading recompute
    // through pipeline()/orderTone()/etc. that would otherwise re-render every
    // card every poll).
    this.fetchOrdersWithEtag();
    this.api.get<Bill[]>('/api/billing/').subscribe({
      next: l => this._bills.set(l ?? []),
      error: () => { /* endpoint may not exist; silently ignore */ }
    });
  }

  private async fetchOrdersWithEtag() {
    try {
      const headers: Record<string, string> = {};
      if (this._ordersEtag) headers['If-None-Match'] = `"${this._ordersEtag}"`;
      const token = await this.auth.getAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await firstValueFrom(this.http.get(`${environment.apiUrl}/api/orders/today`, {
        headers,
        observe: 'response',
        // Tell HttpClient that 304 is a successful (non-error) response — by
        // default it would route to the error handler.
        responseType: 'json'
      }));
      // 304 → server confirms our cached snapshot is still current. Bump
      // lastUpdated so the user sees "Updated just now" but skip the data
      // write so Angular has nothing to re-render.
      if (resp.status === 304) { this.lastUpdated.set(Date.now()); return; }
      const newEtag = resp.headers.get('ETag')?.replace(/"/g, '') ?? null;
      const body = resp.body as { success?: boolean; data?: Order[] } | null;
      const list = body?.data ?? [];
      // Defence in depth: even if the server didn't 304, do a local content
      // check to suppress no-op signal updates (e.g. ETag header stripped by
      // a proxy). Cheap signature over the same fields the server hashes.
      const incomingSig = this.computeOrdersSignature(list);
      if (incomingSig === this._ordersSig) {
        this._ordersEtag = newEtag;
        this.lastUpdated.set(Date.now());
        return;
      }
      this._orders.set(list);
      this._ordersSig = incomingSig;
      this._ordersEtag = newEtag;
      this.lastUpdated.set(Date.now());
    } catch {
      /* network blip — leave the existing list intact */
    }
  }

  /** Signature shape mirrors backend ETag input. Stable per (id, status). */
  private computeOrdersSignature(orders: Order[]): string {
    return orders
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(o => `${o.id}:${o.status}:` + (o.samples ?? [])
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(s => `${s.id}=${s.status}#` + (s.tests ?? [])
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(t => `${t.id}=${t.status}`).join(';'))
        .join(','))
      .join('|');
  }

  // ── Navigation & actions ──────────────────────────────────
  openRegister() { this.router.navigate(['/frontdesk/patients/new']); }
  searchFocus() { this.toasts.success('QR scanner · coming soon'); }
  openProfile(p: Patient) { this.router.navigate(['/frontdesk/patients', p.id]); }
  openAppointment(a: Appointment) {
    if (a.patientId) this.router.navigate(['/frontdesk/patients', a.patientId]);
  }
  openOrder(o: Order) { this._selectedOrder.set(o); }

  // Only show the inline "Collect Sample" action when reception owns collection
  // at this branch (dedicated_counter mode routes to a separate queue) and the
  // order has actually been billed (status=billed). Deep-links into /lab/collect
  // so the existing scan/pick flow handles everything downstream.
  // Critical: hide the action once ANY sample has moved past 'pending'. The
  // order status alone (often still 'billed' until every tube is drawn) is
  // not enough — re-prompting collection on a partially or fully collected
  // order would let users overwrite drawn tubes.
  showCollectOn(o: Order): boolean {
    if (this.labCfg.collectionMode() !== 'front_desk') return false;
    if (!this.auth.hasPermission('collect_sample')) return false;
    if (o.status !== 'billed') return false;
    const samples = o.samples ?? [];
    if (samples.length === 0) return false;
    return samples.every(s => !s.status || s.status === 'pending');
  }
  /**
   * "Create Bill" button only renders when this branch bills at the front
   * desk AND the user actually holds create_bill. Separate-counter mode
   * shows the "Awaiting Billing" badge instead so reception understands
   * who owns the next step.
   */
  showCreateBillOn(o: Order): boolean {
    if (this.labCfg.billingMode() !== 'front_desk') return false;
    return this.auth.hasPermission('create_bill') && o.status === 'created';
  }
  /** Reception jumps into the billing screen for this order. */
  goToBilling(o: Order) {
    this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: o.id } });
  }
  /** Friendly label for the status chip. snake_case statuses → Title Case. */
  statusLabel(status: string): string {
    const map: Record<string, string> = {
      created:           'Created',
      billed:            'Billed',
      sample_collected:  'Sample Collected',
      dispatched:        'Dispatched',
      in_transit:        'Arrived at Lab',
      received_in_lab:   'In Lab',
      received:          'In Lab',
      processing:        'Processing',
      resulted:          'Resulted',
      validated:         'Validated',
      delivered:         'Delivered',
      rejected:          'Rejected',
      partially_rejected:'Partially Rejected',
      cancelled:         'Cancelled',
      in_progress:       'In Progress',
      completed:         'Completed'
    };
    return map[status] ?? status;
  }
  /** All tubes drawn but none has left for the lab yet — read-only badge. */
  isFullyCollected(o: Order): boolean {
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.every(s => s.status === 'collected');
  }
  /** Some tubes drawn, others still pending — partial-progress badge. */
  isPartiallyCollected(o: Order): boolean {
    const samples = o.samples ?? [];
    if (samples.length === 0) return false;
    const anyDrawn = samples.some(s => s.status && s.status !== 'pending');
    const anyPending = samples.some(s => !s.status || s.status === 'pending');
    return anyDrawn && anyPending;
  }
  /** Lab tech has marked at least one tube received — TAT clock has started. */
  isAtLab(o: Order): boolean {
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.some(s =>
      s.status === 'received' || s.status === 'processing');
  }
  collectSample(o: Order) {
    this.router.navigate(['/lab/collect'], { queryParams: { orderId: o.id } });
  }

  // Dispatch button: visible when every tube on the order has been
  // collected but none has left for the lab yet. The FD/courier desk taps
  // it to mark all collected tubes 'dispatched' in one go.
  showDispatchOn(o: Order): boolean {
    if (!this.auth.hasPermission('dispatch_sample')) return false;
    const samples = o.samples ?? [];
    if (samples.length === 0) return false;
    const allCollected = samples.every(s => s.status === 'collected');
    return allCollected;
  }
  isDispatched(o: Order): boolean {
    const samples = o.samples ?? [];
    return samples.length > 0 && samples.every(s =>
      s.status === 'dispatched' || s.status === 'in_transit'
        || s.status === 'received' || s.status === 'processing');
  }
  markDispatched(o: Order) {
    this.api.patch<{ dispatched: number }>(`/api/orders/${o.id}/dispatch`, {}).subscribe({
      next: r => {
        this.toasts.success(`${r.dispatched} tube${r.dispatched === 1 ? '' : 's'} dispatched to lab`);
        // Optimistic local update so the badge flips immediately.
        this._orders.update(list => list.map(x => x.id === o.id
          ? { ...x, samples: x.samples.map(s => s.status === 'collected'
              ? { ...s, status: 'dispatched', dispatchedAt: new Date().toISOString() }
              : s) }
          : x));
      },
      error: e => this.toasts.error(e?.message ?? 'Could not mark dispatched')
    });
  }
  closeOrder() { this._selectedOrder.set(null); }
  openStraggler(s: StragglerItem) {
    if (s.orderId) this.router.navigate(['/frontdesk/patients', s.patientId]);
    else if (s.patientId) this.router.navigate(['/frontdesk/patients', s.patientId]);
  }
  quickBook(o: Order) {
    if (o.patientId) this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: o.patientId } });
  }
  collectPayment(b: Bill) {
    this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: b.orderId } });
  }
  checkIn(a: Appointment) {
    this.api.patch<Appointment>(`/api/appointments/${a.id}/checkin`).subscribe({
      next: () => { this.toasts.success('Checked in'); this.refresh(); }
    });
  }

  // ── UI state ──────────────────────────────────────────────
  setTab(t: Tab) { this._tab.set(t); }
  setDateRange(d: DateRange) {
    // Selecting a non-custom pill closes the calendar and clears any draft
    // custom range so re-opening starts fresh.
    if (d !== 'custom') {
      this._calendarOpen.set(false);
      this._customStart.set(null);
      this._customEnd.set(null);
    }
    this._dateRange.set(d);
  }

  // ── Custom date range / calendar ─────────────────────────
  private firstOfThisMonth(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  }
  toggleCalendar() {
    this._calendarOpen.update(v => !v);
    if (this._calendarOpen()) {
      // Anchor view to whichever month already holds the active selection
      // (or this month otherwise) so the user lands on familiar ground.
      const anchor = this._customStart() ?? this.toIsoDay(new Date());
      this._calMonth.set(this.firstOfMonth(new Date(anchor)));
    }
  }
  closeCalendar() { this._calendarOpen.set(false); }
  prevMonth() { this._calMonth.update(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  nextMonth() {
    // Don't let the user page past the current month — future-dated visits
    // aren't a thing in this product.
    const n = new Date();
    this._calMonth.update(d => {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const cap = new Date(n.getFullYear(), n.getMonth(), 1);
      return next > cap ? d : next;
    });
  }
  pickDay(iso: string) {
    const start = this._customStart();
    const end = this._customEnd();
    if (!start || (start && end)) {
      // Fresh pick (or restarting after a complete range) — set start, clear end.
      this._customStart.set(iso);
      this._customEnd.set(null);
      return;
    }
    // We already have a start, no end yet — the second pick closes the range.
    if (iso < start) {
      // Picked an earlier day; swap so start always precedes end.
      this._customEnd.set(start);
      this._customStart.set(iso);
    } else if (iso === start) {
      // Same day — keep as a single-day range, no end needed.
      this._customEnd.set(null);
    } else {
      this._customEnd.set(iso);
    }
  }
  applyCustom() {
    if (!this._customStart()) return;
    this._dateRange.set('custom');
    this._calendarOpen.set(false);
  }
  clearCustom() {
    this._customStart.set(null);
    this._customEnd.set(null);
    if (this._dateRange() === 'custom') this._dateRange.set('today');
  }
  /** Pill label for the Custom button — shows the active range when set. */
  customRangeLabel(): string {
    const s = this._customStart();
    const e = this._customEnd();
    if (!s) return 'Custom';
    const sDate = new Date(s);
    if (!e || e === s) {
      return sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const eDate = new Date(e);
    const sLabel = sDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const eLabel = eDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${sLabel} – ${eLabel}`;
  }
  /** Footer hint inside the popover — guides the click-once / click-twice flow. */
  customRangeHint(): string {
    const s = this._customStart();
    const e = this._customEnd();
    if (!s) return 'Pick a start day';
    if (s && !e) return 'Pick an end day, or Apply for just this day';
    return 'Range selected';
  }
  private firstOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
  toggleStragglers() { this._stragglersOpen.update(v => !v); }
  dismissStragglers() { this._stragglersDismissed.set(true); }

  // Staff popover — toggles open from the header button. Stop propagation
  // on the click so the same event doesn't immediately bubble up and
  // close it via the backdrop click handler.
  toggleStaffPopover(ev: MouseEvent) {
    ev.stopPropagation();
    this._staffPopoverOpen.update(v => !v);
  }
  closeStaffPopover() { this._staffPopoverOpen.set(false); }
  /** Count of staff with status === 'on_duty' for the button badge. */
  onDutyCount(): number { return this.staff.filter(s => s.status === 'on_duty').length; }
  toggleSelect(id: string) {
    this._selectedIds.update(cur => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  clearSelection() { this._selectedIds.set(new Set()); }
  bulkSms() { this.toasts.success(`SMS queued to ${this._selectedIds().size} recipients`); this.clearSelection(); }
  bulkWhatsapp() { this.toasts.success(`WhatsApp queued to ${this._selectedIds().size} recipients`); this.clearSelection(); }

  // ── Helpers ───────────────────────────────────────────────
  countBy(k: StragglerItem['kind']): number { return this.stragglers().filter(s => s.kind === k).length; }
  kindLabel(k: StragglerItem['kind']): string { return k === 'missed' ? 'MISSED' : k === 'uncollected' ? 'UNPICKED' : 'UNPAID'; }

  patientFor(id: string): Patient | undefined {
    return this._orders().find(o => o.patientId === id)?.patient
        ?? this._appointments().find(a => a.patientId === id)?.patient;
  }
  patientName(id: string): string {
    return patientDisplayName(this.patientFor(id)) || 'Patient';
  }
  hasOutstanding(pid?: string): boolean {
    if (!pid) return false;
    return this._bills().some(b => b.patientId === pid && b.balance > 0);
  }
  cleanPhone(p: string): string { return p.replace(/[^\d]/g, ''); }

  ago(ts: number): string {
    const diff = Date.now() - ts;
    const hrs = Math.floor(diff / 3_600_000);
    if (hrs < 1) return 'just now';
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
  reportAge(o: Order): string { return this.ago(new Date(o.createdAt).getTime()); }
  apptPriority(a: Appointment): string { return a.type === 'emergency' ? 'STAT' : a.type === 'followup' ? 'Urgent' : 'Normal'; }

  apptTone(a: Appointment): ChipTone {
    switch (a.status) {
      case 'checked_in': return 'emerald';
      case 'booked':     return 'amber';
      case 'completed':  return 'teal';
      case 'cancelled':
      case 'no_show':    return 'rose';
      default:           return 'default';
    }
  }
  orderTone(o: Order): ChipTone {
    switch (o.status) {
      case 'completed':
      case 'validated':
      case 'delivered': return 'emerald';
      case 'cancelled':
      case 'rejected':  return 'rose';
      case 'in_progress':
      case 'received':
      case 'processing':
      case 'resulted':  return 'violet';
      case 'collected':
      case 'dispatched':
      case 'in_transit': return 'teal';
      case 'billed':    return 'emerald';
      case 'created':
      case 'draft':     return 'amber';
      default:          return 'amber';
    }
  }

  pipeline(o: Order): Array<{ label: string; state: 'done' | 'active' | 'pending' }> {
    const billDone   = o.status !== 'draft' && o.status !== 'created';
    const collected  = o.samples.some(s => s.status && s.status !== 'pending');
    const dispatched = o.samples.some(s => s.status === 'dispatched' || s.status === 'in_transit'
                                         || s.status === 'received' || s.status === 'processing');
    const received   = o.samples.some(s => s.status === 'received' || s.status === 'processing');
    const completed  = o.status === 'completed';
    const anyResult  = (o.samples[0]?.tests ?? []).some(t => t.status === 'validated' || t.status === 'entered');
    return [
      { label: 'Billing',  state: billDone ? 'done' : 'active' },
      { label: 'Sample',   state: collected ? 'done' : billDone ? 'active' : 'pending' },
      { label: 'Dispatch', state: received ? 'done' : dispatched ? 'done' : collected ? 'active' : 'pending' },
      { label: 'Result',   state: anyResult ? 'done' : received ? 'active' : 'pending' },
      { label: 'Report',   state: completed ? 'done' : anyResult ? 'active' : 'pending' }
    ];
  }
  stepCaption(o: Order, step: { label: string; state: 'done' | 'active' | 'pending' }): string {
    if (step.state === 'pending') return 'Pending';
    switch (step.label) {
      case 'Billing': return step.state === 'done' ? 'Billed' : 'Billing in progress';
      case 'Sample': {
        const total = o.samples.length;
        const collected = o.samples.filter(s => s.status && s.status !== 'pending').length;
        const received = o.samples.filter(s => s.status === 'received' || s.status === 'processing').length;
        return step.state === 'done' ? `${received}/${total} received at lab` : `${collected}/${total} collected`;
      }
      case 'Result': {
        const all = o.samples.flatMap(s => s.tests ?? []);
        const validated = all.filter(t => t.status === 'validated' || t.status === 'entered').length;
        return `${validated}/${all.length} tests resulted`;
      }
      case 'Report': return step.state === 'done' ? 'Report dispatched' : 'Awaiting validation';
      default: return '';
    }
  }
}
