import { CommonModule, Location } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  computed, effect, inject, signal
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { skip } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { AppointmentBookingService } from '../../../core/services/appointment-booking.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { PatientProfileService } from '../../../core/services/patient-profile.service';
import { ToastService } from '../../../core/services/toast.service';
import { Appointment } from '../../../shared/models/appointment.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { AuthService } from '../../../core/auth/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { ZoomSourceDirective, ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { NdDateComponent } from '../../../shared/components/nd-date/nd-date.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { formatPatientMeta, patientDisplayName } from '../../../shared/models/patient.model';
import { plural } from '../../../shared/utils/plural';
import {
  APPOINTMENTS_CALENDAR_ND_STYLES, ND_HOUR, apptStatusTone, apptStatusWord, apptTypeWord,
  matchesAppointment, placeLanes
} from './appointments-calendar.nd';

type CalView = 'day' | 'week' | 'month';

interface DayCell { iso: string; date: Date; today: boolean; outside: boolean; past: boolean; events: Appointment[]; }
interface WeekDay { iso: string; date: Date; today: boolean; past: boolean; label: string; weekday: string; }
interface PlacedEvent { appt: Appointment; topPct: number; heightPct: number; leftPct: number; widthPct: number; }

const HOUR_HEIGHT = 44;
const STATUS_CLASS: Record<string, string> = {
  booked:     'pf-cal-event--booked',
  checked_in: 'pf-cal-event--checked-in',
  completed:  'pf-cal-event--completed',
  cancelled:  'pf-cal-event--cancelled',
  no_show:    'pf-cal-event--no-show'
};

/**
 * Custom appointments calendar — Day / Week / Month views, all in pure
 * Angular signals. Replaces Schedule-X (Preact-based) which was tripping
 * Web Animations + scheduler races against the rest of the zoneless app.
 *
 * Public surface preserved (so the rest of the app — booking modal,
 * patient profile, range refetch on `bookedAt`) keeps working unchanged.
 */
@Component({
  selector: 'pf-appointments-calendar',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LoadingLogoComponent, HeroBandComponent, NdDateComponent, SelectComponent,
    ZoomSourceDirective, ZoomTargetDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
  template: `
    @if (theme.isNewDesign()) {
    <!-- NEW DESIGN (ND-PATTERN §21): band (back · tenant · ONE primary) +
         the pill = search + the view switch + date navigation; CALENDAR is
         the main card, DAY (the chosen day's list → an appointment's
         detail) the collapsible RIGHT companion. ≤900px: one card at a
         time, the detail is a sheet; phones open on the day list. -->
    <section class="pf-band-page pf-apc">
      <pf-hero-band class="pf-apc-band" [back]="true" backTo="/frontdesk" [customSearch]="true">
        <ng-container band-actions>
          @if (!phone()) {
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-apc-new press" (click)="bookNow()"
                    aria-label="New appointment" title="Book a new appointment">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              New appointment
            </button>
          }
        </ng-container>

        <label band-search class="pf-apc-search">
          <svg class="pf-apc-search__glass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <span class="sr-only">Search patient, phone or MRN</span>
          <input type="text" class="pf-apc-search__input" autocomplete="off" spellcheck="false"
                 [placeholder]="phone() ? 'Patient, phone or MRN' : 'Search patient, phone or MRN'"
                 [value]="query()" (input)="query.set($any($event.target).value)"
                 (keydown.escape)="query.set(''); $event.stopPropagation()" />
          @if (query()) {
            <button type="button" class="pf-apc-search__clear" (click)="query.set('')" aria-label="Clear search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          }
        </label>

        <div band-tools class="pf-apc-tools">
          <div class="nd-seg pf-apc-views" role="radiogroup" aria-label="Calendar view">
            @for (v of allViews; track v) {
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="view() === v"
                      [attr.tabindex]="view() === v ? 0 : -1"
                      (click)="setView(v)" (keydown)="onViewKey($event)">{{ viewLabel(v) }}</button>
            }
          </div>
          <div class="pf-apc-nav" role="group" aria-label="Date navigation">
            <button type="button" class="pf-apc-nav__btn" (click)="navigate(-1)" [attr.aria-label]="'Previous ' + view()" title="Previous">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <button type="button" class="pf-apc-nav__today" (click)="goToday()">Today</button>
            <button type="button" class="pf-apc-nav__btn" (click)="navigate(1)" [attr.aria-label]="'Next ' + view()" title="Next">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            </button>
            <button type="button" class="pf-apc-nav__btn pf-apc-jump" (click)="openJump(jump)" aria-label="Jump to a date" title="Jump to a date">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            </button>
            <input #jump type="date" class="pf-apc-jump__native" tabindex="-1" aria-hidden="true"
                   [value]="cursorIso()" (change)="jumpToDate($any($event.target).value)" />
          </div>
        </div>
      </pf-hero-band>

      <div class="pf-band-body pf-band-body--fill pf-apc-body">
        <div class="pf-apc-panels" [class.pf-apc-panels--collapsed]="sideCollapsed() && !narrow()"
             [class.pf-apc-panels--narrow]="narrow()">

          <!-- ══ MAIN card: the CALENDAR (≤900px Day view = the day list) ══ -->
          @if (narrow() && view() === 'day') {
            <section class="nd-card pf-apc-main pf-apc-daycard" aria-label="Day">
              <ng-container *ngTemplateOutlet="dayHead; context: { collapsible: false }"></ng-container>
              <ng-container *ngTemplateOutlet="dayBody"></ng-container>
              @if (phone()) { <ng-container *ngTemplateOutlet="phoneCta"></ng-container> }
            </section>
          } @else {
            <section class="nd-card pf-apc-main" aria-label="Calendar">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true"><ng-container *ngTemplateOutlet="calIcon"></ng-container></span>
                <span class="nd-card__label">Calendar</span>
                <span class="pf-apc-range">{{ rangeLabel() }}</span>
                <span class="nd-card__spacer"></span>
                @if (loading()) { <span class="pf-apc-count" role="status">Loading…</span> }
                @else if (query().trim()) { <span class="pf-apc-count nd-num" role="status">{{ plural(filteredCount(), 'match', 'matches') }}</span> }
                @else { <span class="pf-apc-count nd-num">{{ plural(filteredCount(), 'appointment') }}</span> }
              </header>
              <div class="pf-apc-canvas">
                @switch (view()) {
                  @case ('day') { <ng-container *ngTemplateOutlet="ndTimeTpl; context: { days: ndDayCols() }"></ng-container> }
                  @case ('week') { <ng-container *ngTemplateOutlet="ndTimeTpl; context: { days: weekDays() }"></ng-container> }
                  @case ('month') { <ng-container *ngTemplateOutlet="ndMonthTpl"></ng-container> }
                }
              </div>
              @if (phone()) { <ng-container *ngTemplateOutlet="phoneCta"></ng-container> }
            </section>
          }

          <!-- ══ SIDE card (RIGHT): the chosen DAY → an APPOINTMENT ════════ -->
          @if (!narrow()) {
            @if (sideCollapsed()) {
              <aside class="nd-card pf-apc-strip" aria-label="Day">
                <button type="button" class="pf-apc-strip__btn" (click)="toggleSide()"
                        title="Show the day" aria-label="Show the day" aria-expanded="false">
                  <span class="nd-btn nd-btn--icon pf-apc-strip__expand" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </span>
                  <span class="nd-card__icon" aria-hidden="true"><ng-container *ngTemplateOutlet="dayIcon"></ng-container></span>
                  <span class="pf-apc-strip__label">Day</span>
                  <span class="pf-apc-strip__n nd-num">{{ dayList().length }}</span>
                </button>
              </aside>
            } @else if (selectedAppt(); as a) {
              <aside class="nd-card pf-apc-side pf-apc-detail" aria-label="Appointment" [pfZoomTarget]="a.id">
                <ng-container *ngTemplateOutlet="detailTpl; context: { a: a }"></ng-container>
              </aside>
            } @else {
              <aside class="nd-card pf-apc-side" aria-label="Day">
                <ng-container *ngTemplateOutlet="dayHead; context: { collapsible: true }"></ng-container>
                <ng-container *ngTemplateOutlet="dayBody"></ng-container>
              </aside>
            }
          }
        </div>
      </div>

      <!-- ≤900px: an appointment's detail is a sheet above the navbar. -->
      @if (narrow()) {
        @if (selectedAppt(); as a) {
          <div class="nd-sheet-backdrop pf-apc-scrim" (click)="closeAppt()"></div>
          <div class="nd-card nd-sheet pf-apc-sheet" role="dialog" aria-modal="true" aria-label="Appointment" [pfZoomTarget]="a.id">
            <span class="nd-sheet__handle" aria-hidden="true"></span>
            <ng-container *ngTemplateOutlet="detailTpl; context: { a: a }"></ng-container>
          </div>
        }
      }
    </section>

    <!-- ── DAY header + list (side card on web; main card ≤900px) ── -->
    <ng-template #dayHead let-collapsible="collapsible">
      <header class="nd-card__head">
        <span class="nd-card__icon" aria-hidden="true"><ng-container *ngTemplateOutlet="dayIcon"></ng-container></span>
        <span class="nd-card__label">Day</span>
        <span class="pf-apc-range">{{ dayLabel() }}</span>
        <span class="nd-card__spacer"></span>
        <span class="pf-apc-count nd-num">{{ plural(dayList().length, 'appointment') }}</span>
        @if (collapsible) {
          <button type="button" class="nd-btn nd-btn--icon pf-apc-collapse" (click)="toggleSide()"
                  title="Hide the day" aria-label="Hide the day" aria-expanded="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        }
      </header>
      <div class="pf-apc-strip7" role="group" aria-label="Pick a day">
        @for (d of weekDays(); track d.iso) {
          <button type="button" class="pf-apc-strip7__day" [class.pf-apc-strip7__day--today]="d.today"
                  [class.pf-apc-strip7__day--past]="d.past"
                  [attr.aria-pressed]="d.iso === cursorIso()" [attr.aria-label]="longDate(d.date)"
                  (click)="pickDay(d.iso)">
            <span class="pf-apc-strip7__dow">{{ d.weekday }}</span>
            <span class="pf-apc-strip7__n nd-num">{{ d.label }}</span>
          </button>
        }
      </div>
    </ng-template>

    <ng-template #dayBody>
      <div class="nd-card__body pf-apc-list">
        @for (a of dayList(); track a.id; let i = $index) {
          <button type="button" class="pf-apc-row" [pfZoomSource]="a.id" [style.--i]="i"
                  [attr.aria-label]="rowLabel(a)" (click)="openAppt(a, $event)">
            <span class="pf-apc-row__who">
              <span class="pf-apc-row__name">{{ nameOf(a) }}</span>
              <span class="pf-apc-row__meta nd-num">{{ metaOf(a) }}</span>
            </span>
            <span class="pf-apc-status" [attr.data-tone]="statusTone(a.status)">
              <span class="pf-apc-status__dot" aria-hidden="true"></span>{{ statusWord(a.status) }}
            </span>
          </button>
        } @empty {
          <div class="nd-empty nd-empty--compact pf-apc-empty">
            <span class="nd-empty__icon" aria-hidden="true"><ng-container *ngTemplateOutlet="dayIcon"></ng-container></span>
            <p class="nd-empty__title">{{ query().trim() ? 'No match on this day' : 'No appointments on this day' }}</p>
            <p class="nd-empty__body">{{ query().trim() ? 'Clear the search or pick another day.' : 'Pick an empty slot in the calendar to book one.' }}</p>
            @if (!query().trim() && !cursorPast()) {
              <button type="button" class="nd-btn nd-btn--secondary nd-empty__action press" (click)="bookOnDay()">Book on this day</button>
            }
          </div>
        }
      </div>
    </ng-template>

    <!-- ── One appointment (side card on web, a sheet ≤900px) ── -->
    <ng-template #detailTpl let-a="a">
      <header class="nd-card__head">
        <button type="button" class="nd-btn nd-btn--icon pf-apc-collapse" (click)="rescheduleOpen() ? rescheduleOpen.set(false) : closeAppt()"
                [attr.aria-label]="rescheduleOpen() ? 'Back to the appointment' : 'Back to the day'"
                [title]="rescheduleOpen() ? 'Back to the appointment' : 'Back to the day'">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span class="nd-card__label">{{ rescheduleOpen() ? 'Reschedule' : 'Appointment' }}</span>
        <span class="nd-card__spacer"></span>
        @if (narrow()) {
          <button type="button" class="nd-btn nd-btn--icon pf-apc-collapse" (click)="closeAppt()" aria-label="Close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        }
      </header>
      <div class="nd-card__body pf-apc-dbody">
        <div class="pf-apc-subject">
          <p class="pf-apc-subject__name">{{ nameOf(a) }}</p>
          <p class="pf-apc-subject__meta nd-num">{{ metaOf(a) }}</p>
          <span class="pf-apc-status" [attr.data-tone]="statusTone(a.status)">
            <span class="pf-apc-status__dot" aria-hidden="true"></span>{{ statusWord(a.status) }}
          </span>
        </div>
        @if (!rescheduleOpen()) {
          <dl class="pf-apc-facts pf-apc-step" [class.pf-apc-step--back]="stepBack()">
            <div><dt>When</dt><dd class="nd-num">{{ whenOf(a) }}</dd></div>
            <div><dt>Type</dt><dd>{{ typeWord(a.type) }}</dd></div>
            <div><dt>Collection</dt><dd>{{ a.collectionType === 'home_collection' ? 'Home collection' : 'Walk-in (lab visit)' }}</dd></div>
            @if (a.tokenNumber) { <div><dt>Token</dt><dd class="nd-num">{{ a.tokenNumber }}</dd></div> }
            @if (a.patient?.phone) { <div><dt>Phone</dt><dd class="nd-num">{{ a.patient?.phone }}</dd></div> }
            @if (testCount(a) > 0) { <div><dt>Tests</dt><dd>{{ plural(testCount(a), 'test') }} booked</dd></div> }
            @if (a.address) { <div><dt>Address</dt><dd>{{ a.address }}@if (a.pincode) { · <span class="nd-num">{{ a.pincode }}</span> }</dd></div> }
            @if (a.notes) { <div><dt>Notes</dt><dd>{{ a.notes }}</dd></div> }
          </dl>
        } @else {
          <div class="pf-apc-resched pf-apc-step pf-apc-step--fwd">
            <label class="nd-field">
              <span class="nd-field__lbl">New date</span>
              <pf-nd-date label="New date" [value]="rDate || null" (valueChange)="rDate = $event ?? ''"></pf-nd-date>
            </label>
            <div class="nd-field">
              <span class="nd-field__lbl">New time</span>
              <pf-select [options]="timeOptions()" [value]="rTime" [searchable]="true" placeholder="Pick a time"
                         (valueChange)="rTime = $any($event)"></pf-select>
            </div>
            <p class="nd-field__hint">The patient keeps the same booking; only the date and time move.</p>
          </div>
        }
      </div>
      <footer class="nd-card__foot pf-apc-acts">
        @if (!rescheduleOpen()) {
          <button type="button" class="nd-btn nd-btn--secondary nd-span pf-apc-act" (click)="openProfile(a)">Open profile</button>
          @if (a.status === 'booked') {
            <button type="button" class="nd-btn nd-btn--secondary pf-apc-act" (click)="run(queue.checkIn(a.id))">Check in</button>
            <button type="button" class="nd-btn nd-btn--secondary pf-apc-act" (click)="openReschedule()">Reschedule</button>
            <button type="button" class="nd-btn nd-btn--secondary pf-apc-act" (click)="run(queue.noShow(a.id))">No-show</button>
          }
          @if (a.status === 'checked_in') {
            <button type="button" class="nd-btn nd-btn--secondary pf-apc-act" (click)="run(queue.complete(a.id))">Complete</button>
            @if (a.type !== 'urgent') {
              <button type="button" class="nd-btn nd-btn--secondary pf-apc-act" (click)="run(queue.markUrgent(a.id))">Mark urgent</button>
            }
            <button type="button" class="nd-btn nd-btn--secondary pf-apc-act" (click)="run(queue.noShow(a.id))">No-show</button>
          }
          @if (a.status !== 'cancelled' && a.status !== 'completed') {
            <button type="button" class="nd-btn nd-btn--danger pf-apc-act" (click)="run(queue.cancel(a.id))">Cancel appointment</button>
          }
        } @else {
          <button type="button" class="nd-btn nd-btn--tertiary pf-apc-act" (click)="closeReschedule()">Back</button>
          <button type="button" class="nd-btn nd-btn--secondary pf-apc-act" (click)="doReschedule(a)">Save new time</button>
        }
      </footer>
    </ng-template>

    <!-- ── Day / Week time grid: ONE scroller, sticky day headers ── -->
    <ng-template #ndTimeTpl let-days="days">
      <div class="pf-apc-time" [style.--cols]="days.length" [style.--hour]="ND_HOUR + 'px'">
        <div class="pf-apc-time__corner" aria-hidden="true"></div>
        @for (d of days; track d.iso) {
          <button type="button" class="pf-apc-dayhdr" [class.pf-apc-dayhdr--today]="d.today" [class.pf-apc-dayhdr--past]="d.past"
                  [attr.aria-current]="d.today ? 'date' : null" [attr.aria-label]="'Open ' + longDate(d.date)"
                  (click)="setDay(d.iso)">
            <span class="pf-apc-dayhdr__dow">{{ d.weekday }}</span>
            <span class="pf-apc-dayhdr__n nd-num">{{ d.label }}</span>
          </button>
        }
        <div class="pf-apc-rail" aria-hidden="true">
          @for (h of hours; track h) { <span class="pf-apc-rail__h nd-num" [style.top.px]="h * ND_HOUR">{{ hh(h) }}:00</span> }
        </div>
        @for (d of days; track d.iso) {
          <div class="pf-apc-col" [class.pf-apc-col--today]="d.today" [class.pf-apc-col--past]="d.past">
            @for (s of ndSlots; track s.top) {
              <button type="button" class="pf-apc-slot" [class.pf-apc-slot--half]="s.minute === 30"
                      [style.top.px]="s.top" [attr.aria-disabled]="slotPast(d.iso, s.time) ? true : null"
                      [attr.aria-label]="'Book ' + s.time + ', ' + longDate(d.date)"
                      (click)="onSlotClick(d.iso, s.hour, s.minute)">
                <span class="pf-apc-slot__hint nd-num" aria-hidden="true">+ {{ s.time }}</span>
              </button>
            }
            @if (d.today) {
              <div class="pf-apc-now" [style.top.px]="nowTopPx()" aria-hidden="true">
                <span class="pf-apc-now__t nd-num">{{ nowLabel() }}</span>
              </div>
            }
            @for (ev of evsFor(d.iso); track ev.appt.id) {
              <button type="button" class="pf-apc-ev" [pfZoomSource]="ev.appt.id"
                      [class.pf-apc-ev--tight]="days.length > 1 && ev.width < 100" [title]="rowLabel(ev.appt)"
                      [attr.aria-pressed]="selectedAppt()?.id === ev.appt.id"
                      [style.top.px]="ev.top" [style.left.%]="ev.left" [style.width.%]="ev.width"
                      [attr.aria-label]="rowLabel(ev.appt)" (click)="onEventClick(ev.appt, $event)">
                <span class="pf-apc-ev__name">{{ nameOf(ev.appt) }}</span>
                <span class="pf-apc-ev__meta nd-num">{{ metaOf(ev.appt) }}</span>
                <span class="pf-apc-status" [attr.data-tone]="statusTone(ev.appt.status)">
                  <span class="pf-apc-status__dot" aria-hidden="true"></span><span class="pf-apc-status__w">{{ statusWord(ev.appt.status) }}</span>
                </span>
              </button>
            }
          </div>
        }
      </div>
    </ng-template>

    <!-- ── Month grid ── -->
    <ng-template #ndMonthTpl>
      <div class="pf-apc-month">
        <div class="pf-apc-month__dows" aria-hidden="true">
          @for (w of weekdayHeaders; track w) { <span>{{ w }}</span> }
        </div>
        <div class="pf-apc-month__grid">
          @for (cell of monthCells(); track cell.iso) {
            <div class="pf-apc-mcell" role="button" tabindex="0"
                 [class.pf-apc-mcell--out]="cell.outside" [class.pf-apc-mcell--today]="cell.today" [class.pf-apc-mcell--past]="cell.past"
                 [attr.aria-label]="'Book on ' + longDate(cell.date)"
                 (click)="onMonthCellClick(cell, $event)" (keydown.enter)="onMonthCellClick(cell, $any($event))">
              <span class="pf-apc-mcell__n nd-num" [attr.aria-current]="cell.today ? 'date' : null">{{ cell.date.getDate() }}</span>
              @if (cell.events.length > 0) {
                <button type="button" class="nd-chip pf-apc-mcell__chip" (click)="onMonthPillClick(cell.iso, $event)"
                        (keydown.enter)="$event.stopPropagation()"
                        [attr.aria-label]="'Open ' + longDate(cell.date) + ': ' + plural(cell.events.length, 'appointment')">
                  <span class="nd-num">{{ cell.events.length }}</span>
                  <span class="pf-apc-mcell__word">{{ cell.events.length === 1 ? 'appointment' : 'appointments' }}</span>
                </button>
              }
            </div>
          }
        </div>
      </div>
    </ng-template>

    <ng-template #phoneCta>
      <footer class="nd-card__foot pf-apc-foot">
        <button type="button" class="nd-btn nd-btn--primary nd-span pf-apc-new press" (click)="bookNow()">New appointment</button>
      </footer>
    </ng-template>

    <ng-template #calIcon>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    </ng-template>
    <ng-template #dayIcon>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h8M8 18h5"/></svg>
    </ng-template>
    } @else {
    <section class="pf-cal-page">
      <header class="pf-cal-hdr">
        <button type="button" class="pf-cal-back press" (click)="goBack()"
                aria-label="Back to Frontdesk">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5"/>
            <path d="m12 19-7-7 7-7"/>
          </svg>
        </button>
        @if (navBack.showBack()) {
          <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        }
        <div class="pf-cal-hdr__l">
          <h1>Appointments</h1>
          <p>Tap an empty slot to book · click an event to open the patient profile</p>
        </div>
        <div class="pf-cal-hdr__r">
          <button type="button" class="pf-cal-book press" (click)="bookNow()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Book appointment
          </button>
        </div>
      </header>

      <!-- View switcher + nav -->
      <div class="pf-cal-toolbar">
        <div class="pf-cal-views" role="tablist" aria-label="Calendar view">
          @for (v of allViews; track v) {
            <button type="button" role="tab" [class.pf-cal-view--on]="view() === v"
                    [attr.aria-selected]="view() === v" (click)="setView(v)">
              {{ v[0].toUpperCase() + v.slice(1) }}
            </button>
          }
        </div>
        <div class="pf-cal-nav">
          <button type="button" class="pf-cal-nav__btn" (click)="navigate(-1)" aria-label="Previous">‹</button>
          <button type="button" class="pf-cal-nav__btn pf-cal-nav__today" (click)="goToday()">Today</button>
          <button type="button" class="pf-cal-nav__btn" (click)="navigate(1)" aria-label="Next">›</button>
          <label class="pf-cal-nav__jump" title="Jump to date">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            <span>Jump</span>
            <input type="date" class="pf-cal-nav__jump-input"
                   [value]="cursorIso()"
                   (change)="jumpToDate($any($event.target).value)" />
          </label>
          <span class="pf-cal-nav__title">{{ rangeLabel() }}</span>
        </div>
      </div>

      <!-- Calendar canvas -->
      <div class="pf-cal-frame">
        @switch (view()) {
          @case ('day')   { <ng-container *ngTemplateOutlet="dayTpl"></ng-container> }
          @case ('week')  { <ng-container *ngTemplateOutlet="weekTpl"></ng-container> }
          @case ('month') { <ng-container *ngTemplateOutlet="monthTpl"></ng-container> }
        }
      </div>

      @if (loading()) {
        <div class="pf-cal-loading">
          <pf-loading-logo size="lg" color="purple" [showDna]="true"
                           [showText]="true" text="Loading appointments…"></pf-loading-logo>
        </div>
      }
    </section>

    <!-- ─────────────── DAY VIEW ─────────────── -->
    <ng-template #dayTpl>
      <div class="pf-cal-time">
        <div class="pf-cal-time__head">
          <div class="pf-cal-time__col-hdr"></div>
          <div class="pf-cal-time__col-hdr pf-cal-time__col-hdr--day"
               [class.pf-cal-today]="weekDays()[dayIndex()]?.today"
               [class.pf-cal-past]="weekDays()[dayIndex()]?.past">
            <span class="pf-cal-time__weekday">{{ weekDays()[dayIndex()]?.weekday }}</span>
            <span class="pf-cal-time__daynum">{{ weekDays()[dayIndex()]?.label }}</span>
          </div>
        </div>
        <div class="pf-cal-time__body" [style.--col-count]="1">
          <div class="pf-cal-time__rail">
            @for (h of hours; track h) {
              <div class="pf-cal-time__hour"><span>{{ h }}:00</span></div>
            }
          </div>
          @if (weekDays()[dayIndex()]?.today) {
            <div class="pf-cal-time__overlay" [style.--today-col]="0" [style.--col-count]="1">
              <div class="pf-cal-now" [style.top]="nowTopPct() + '%'" aria-hidden="true">
                <span class="pf-cal-now__label">{{ nowLabel() }}</span>
              </div>
            </div>
          }
          <div class="pf-cal-time__col"
               [class.pf-cal-past]="weekDays()[dayIndex()]?.past"
               [style.height.px]="HOUR_HEIGHT * 24">
            @for (s of halfHourSlots; track s.topPx) {
              <button type="button" class="pf-cal-time__slot"
                      [class.pf-cal-time__slot--half]="s.minute === 30"
                      [style.top.px]="s.topPx" [style.height.px]="HALF_HOUR_HEIGHT"
                      (click)="onSlotClick(weekDays()[dayIndex()]?.iso ?? '', s.hour, s.minute)">
              </button>
            }
            @for (ev of dayEvents(); track ev.appt.id) {
              <button type="button" class="pf-cal-event {{ statusClass(ev.appt.status) }}"
                      [style.top]="ev.topPct + '%'"
                      [style.height]="ev.heightPct + '%'"
                      [style.left]="ev.leftPct + '%'"
                      [style.width]="ev.widthPct + '%'"
                      (click)="onEventClick(ev.appt, $event)">
                <span class="pf-cal-event__time">{{ ev.appt.slotTime ?? '—' }}</span>
                <span class="pf-cal-event__title">{{ ev.appt.patient?.displayName ?? 'Patient' }}</span>
              </button>
            }
          </div>
        </div>
      </div>
    </ng-template>

    <!-- ─────────────── WEEK VIEW ─────────────── -->
    <ng-template #weekTpl>
      <div class="pf-cal-time">
        <div class="pf-cal-time__head">
          <div class="pf-cal-time__col-hdr"></div>
          @for (d of weekDays(); track d.iso) {
            <div class="pf-cal-time__col-hdr"
                 [class.pf-cal-today]="d.today"
                 [class.pf-cal-past]="d.past"
                 (click)="setDay(d.iso)">
              <span class="pf-cal-time__weekday">{{ d.weekday }}</span>
              <span class="pf-cal-time__daynum">{{ d.label }}</span>
            </div>
          }
        </div>
        <div class="pf-cal-time__body" [style.--col-count]="7">
          <div class="pf-cal-time__rail">
            @for (h of hours; track h) {
              <div class="pf-cal-time__hour"><span>{{ h }}:00</span></div>
            }
          </div>
          @if (todayWeekIndex() >= 0) {
            <div class="pf-cal-time__overlay" [style.--today-col]="todayWeekIndex()" [style.--col-count]="7">
              <div class="pf-cal-now" [style.top]="nowTopPct() + '%'" aria-hidden="true">
                <span class="pf-cal-now__label">{{ nowLabel() }}</span>
              </div>
            </div>
          }
          @for (d of weekDays(); track d.iso) {
            <div class="pf-cal-time__col"
                 [class.pf-cal-past]="d.past"
                 [style.height.px]="HOUR_HEIGHT * 24">
              @for (s of halfHourSlots; track s.topPx) {
                <button type="button" class="pf-cal-time__slot"
                        [class.pf-cal-time__slot--half]="s.minute === 30"
                        [style.top.px]="s.topPx" [style.height.px]="HALF_HOUR_HEIGHT"
                        (click)="onSlotClick(d.iso, s.hour, s.minute)">
                </button>
              }
              @for (ev of weekEventsByDay()[d.iso]; track ev.appt.id) {
                <button type="button" class="pf-cal-event {{ statusClass(ev.appt.status) }}"
                        [style.top]="ev.topPct + '%'"
                        [style.height]="ev.heightPct + '%'"
                        [style.left]="ev.leftPct + '%'"
                        [style.width]="ev.widthPct + '%'"
                        (click)="onEventClick(ev.appt, $event)">
                  <span class="pf-cal-event__time">{{ ev.appt.slotTime ?? '—' }}</span>
                  <span class="pf-cal-event__title">{{ ev.appt.patient?.displayName ?? 'Patient' }}</span>
                </button>
              }
            </div>
          }
        </div>
      </div>
    </ng-template>

    <!-- ─────────────── MONTH VIEW ─────────────── -->
    <ng-template #monthTpl>
      <div class="pf-cal-month">
        <div class="pf-cal-month__dows">
          @for (w of weekdayHeaders; track w) { <span>{{ w }}</span> }
        </div>
        <div class="pf-cal-month__grid">
          @for (cell of monthCells(); track cell.iso) {
            <div class="pf-cal-month__cell"
                 [class.pf-cal-month__cell--out]="cell.outside"
                 [class.pf-cal-month__cell--today]="cell.today"
                 [class.pf-cal-past]="cell.past"
                 (click)="onMonthCellClick(cell, $event)">
              <span class="pf-cal-month__day">{{ cell.date.getDate() }}</span>
              <div class="pf-cal-month__summary">
                @if (cell.events.length > 0) {
                  <div class="pf-cal-month__pill" (click)="onMonthPillClick(cell.iso, $event)">
                    <span class="pf-cal-month__badge">{{ cell.events.length }}</span>
                    <span class="pf-cal-month__label">
                      {{ cell.events.length === 1 ? 'appointment' : 'appointments' }}
                    </span>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      </div>
    </ng-template>

    <!-- ── Appointment action sheet ── -->
    @if (selectedAppt(); as a) {
      <div class="pf-appt-overlay" (click)="closeAppt()">
        <div class="pf-appt-card" (click)="$event.stopPropagation()">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[15px] font-semibold truncate" style="color: var(--text-primary);">{{ a.patient?.displayName || 'Patient' }}</p>
              <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
                {{ a.type }} · {{ a.slotTime || '—' }} · <span class="capitalize">{{ a.status }}</span>
                @if (a.tokenNumber) { · token {{ a.tokenNumber }} }
              </p>
            </div>
            <button class="pf-appt-x" (click)="closeAppt()" aria-label="Close">✕</button>
          </div>

          @if (!rescheduleOpen()) {
            <div class="mt-3 flex flex-wrap gap-1.5">
              <button class="pf-appt-btn pf-appt-btn--primary" (click)="openProfile(a)">Open profile</button>
              @if (a.status === 'booked') {
                <button class="pf-appt-btn" (click)="run(queue.checkIn(a.id))">Check in</button>
                <button class="pf-appt-btn" (click)="rescheduleOpen.set(true)">Reschedule</button>
                <button class="pf-appt-btn" (click)="run(queue.noShow(a.id))">No-show</button>
              }
              @if (a.status === 'checked_in') {
                <button class="pf-appt-btn" (click)="run(queue.complete(a.id))">Complete</button>
                @if (a.type !== 'urgent') {
                  <button class="pf-appt-btn" (click)="run(queue.markUrgent(a.id))">Mark urgent</button>
                }
                <button class="pf-appt-btn" (click)="run(queue.noShow(a.id))">No-show</button>
              }
              @if (a.status !== 'cancelled' && a.status !== 'completed') {
                <button class="pf-appt-btn pf-appt-btn--danger" (click)="run(queue.cancel(a.id))">Cancel</button>
              }
            </div>
          } @else {
            <div class="mt-3 flex flex-col gap-2">
              <label class="text-[12px] flex flex-col gap-1" style="color: var(--text-secondary);">New date
                <input type="date" class="pf-input" [(ngModel)]="rDate" /></label>
              <label class="text-[12px] flex flex-col gap-1" style="color: var(--text-secondary);">New time
                <input type="time" class="pf-input" [(ngModel)]="rTime" /></label>
              <div class="flex gap-2 justify-end mt-1">
                <button class="pf-appt-btn" (click)="rescheduleOpen.set(false)">Back</button>
                <button class="pf-appt-btn pf-appt-btn--primary" (click)="doReschedule(a)">Save</button>
              </div>
            </div>
          }
        </div>
      </div>
    }
    }
  `,
  styles: [APPOINTMENTS_CALENDAR_ND_STYLES, `
    :host {
      display: block;
      /* WORK page: fill the shell's main area exactly so the PAGE itself
       * never scrolls — scrolling happens inside the calendar grid. */
      height: 100%;
      /* Theme-aware grid line. Dark mode: faint white. Light mode (set
       * via :host-context below): a soft slate so lines stay visible on
       * the light lavender background. */
      --pf-cal-grid: rgba(255, 255, 255, 0.10);
      --pf-cal-grid-strong: rgba(255, 255, 255, 0.18);
    }
    :host-context(html[data-theme="light"]) {
      --pf-cal-grid: rgba(15, 23, 42, 0.10);
      --pf-cal-grid-strong: rgba(15, 23, 42, 0.18);
    }
    .pf-cal-page {
      padding: 20px clamp(16px, 3vw, 32px);
      display: flex; flex-direction: column; gap: 16px;
      /* Non-scroll app screen: fill the host and clip — the only scroll
       * lives inside the calendar grid (.pf-cal-time__body). position
       * anchors the floating loading badge. */
      height: 100%; min-height: 0; overflow: hidden; position: relative;
    }
    .pf-cal-hdr {
      display: flex; align-items: center; justify-content: flex-start;
      gap: 16px; flex-wrap: wrap;
      flex: 0 0 auto;
    }
    .pf-cal-hdr__l { flex: 1; min-width: 0; }
    .pf-cal-hdr__l h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: var(--text-primary); }
    .pf-cal-hdr__l p { margin: 4px 0 0; font-size: 13px; color: var(--text-secondary); }
    .pf-cal-hdr__r { flex-shrink: 0; }

    /* Back button — returns to /frontdesk (or browser history if it's
     * the same origin). Sits at the very left of the calendar header. */
    .pf-cal-back {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 14px 7px 12px;
      font-size: 12.5px; font-weight: 600; letter-spacing: 0.01em;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.06s ease;
      flex-shrink: 0;
    }
    .pf-cal-back:hover {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.45);
      color: var(--text-primary);
    }
    .pf-cal-back:active { transform: translateY(1px); }
    .pf-cal-back svg { color: var(--text-muted); }
    .pf-cal-back:hover svg { color: var(--violet-text); }

    /* Standard back chevron (sits before the title). Shown at ALL widths as
     * the single, consistent back affordance. */
    .pf-hdr-back { width:38px; height:38px; margin-left:-8px; border-radius:11px; color:var(--text-primary); background:transparent; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform:scale(0.9); background:var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover:hover){ .pf-hdr-back:hover{ background:var(--glass-bg, rgba(255,255,255,0.06)); } }
    /* Legacy back pill fully retired at every width so only the chevron shows. */
    .pf-cal-back { display: none; }

    .pf-cal-book {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.55rem 1rem; font-size: 12.5px; font-weight: 600;
      border-radius: 9999px; border: 1px solid transparent;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white; cursor: pointer; box-shadow: 0 6px 18px rgba(124, 58, 237, 0.32);
    }
    .pf-cal-book:hover { filter: brightness(1.08); }

    /* ── Toolbar ─────────────────────────────────────────────── */
    .pf-cal-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; flex-wrap: wrap;
      flex: 0 0 auto;
    }
    .pf-cal-views {
      display: inline-flex; padding: 3px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 10px;
    }
    .pf-cal-views button {
      padding: 6px 14px; background: transparent; border: 0;
      border-radius: 7px; font-size: 12.5px; font-weight: 600;
      color: var(--text-secondary); cursor: pointer; letter-spacing: 0.02em;
    }
    .pf-cal-views button:hover { color: var(--text-primary); }
    .pf-cal-views .pf-cal-view--on {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.32);
    }
    .pf-cal-nav { display: inline-flex; align-items: center; gap: 6px; }
    .pf-cal-nav__btn {
      width: 30px; height: 30px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 8px; color: var(--text-primary); cursor: pointer;
      font-size: 16px; line-height: 1; display: inline-flex;
      align-items: center; justify-content: center;
    }
    .pf-cal-nav__btn:hover { background: var(--bg-hover); }
    .pf-cal-nav__today { width: auto; padding: 0 12px; font-size: 12px; font-weight: 600; }
    .pf-cal-nav__jump {
      position: relative;
      display: inline-flex; align-items: center; gap: 6px;
      height: 30px; padding: 0 12px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 8px; color: var(--text-primary);
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .pf-cal-nav__jump:hover {
      background: var(--bg-hover);
      border-color: rgba(168, 85, 247, 0.35);
    }
    .pf-cal-nav__jump-input {
      position: absolute; inset: 0;
      opacity: 0; cursor: pointer;
      width: 100%; height: 100%; border: 0; padding: 0;
    }
    .pf-cal-nav__title {
      margin-left: 12px; font-size: 14px; font-weight: 600;
      color: var(--text-primary); letter-spacing: -0.01em;
    }

    /* ── Frame ───────────────────────────────────────────────── */
    .pf-cal-frame {
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 16px; backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      overflow: hidden; display: flex; flex-direction: column;
      /* Non-scroll: the frame takes the remaining height of the page and
       * lets its inner grid scroll. min-height:0 is required so the flex
       * child can shrink below its content size. */
      flex: 1 1 auto; min-height: 0;
    }
    .pf-cal-loading {
      /* Float over the frame instead of taking flow space, so the
       * non-scroll page height stays exact while loading. */
      position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
      padding: 12px; text-align: center; font-size: 12.5px; color: var(--text-tertiary);
      pointer-events: none; z-index: 4;
    }
    .pf-cal-past { opacity: 0.5; filter: saturate(0.6); }

    /* ── Time grid (Day / Week) ──────────────────────────────── */
    .pf-cal-time {
      display: flex; flex-direction: column; flex: 1; min-height: 0;
    }
    .pf-cal-time__head {
      display: grid;
      grid-template-columns: 64px repeat(var(--col-count, 7), 1fr);
      border-bottom: 1px solid var(--pf-cal-grid-strong);
      background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent);
    }
    /* day view: head uses --col-count from body inline style; force it 1 */
    .pf-cal-time__head .pf-cal-time__col-hdr--day { grid-column: 2 / -1; }
    .pf-cal-time__col-hdr {
      padding: 12px 10px; display: flex; flex-direction: column;
      align-items: center; gap: 2px; cursor: pointer;
      border-left: 1px solid var(--pf-cal-grid);
    }
    .pf-cal-time__col-hdr:first-child { border-left: 0; cursor: default; }
    .pf-cal-time__weekday {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--text-tertiary);
    }
    .pf-cal-time__daynum {
      font-size: 16px; font-weight: 700; color: var(--text-primary);
    }
    .pf-cal-time__col-hdr.pf-cal-today .pf-cal-time__daynum {
      width: 30px; height: 30px; border-radius: 50%;
      background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white;
      display: inline-flex; align-items: center; justify-content: center;
    }

    .pf-cal-time__body {
      display: grid;
      grid-template-columns: 64px repeat(var(--col-count, 7), 1fr);
      flex: 1; min-height: 0; overflow-y: auto;
      position: relative; /* anchor for the .pf-cal-time__overlay */
    }
    .pf-cal-time__rail {
      position: relative;
      border-right: 1px solid var(--pf-cal-grid-strong);
    }
    .pf-cal-time__hour {
      height: 44px; position: relative;
      border-bottom: 1px dashed var(--pf-cal-grid);
    }
    .pf-cal-time__hour > span {
      position: absolute; top: -7px; right: 8px;
      font-size: 10.5px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    .pf-cal-time__col {
      position: relative;
      border-left: 1px solid var(--pf-cal-grid);
    }
    .pf-cal-time__slot {
      position: absolute; left: 0; right: 0;
      background: transparent; border: 0; cursor: pointer;
      /* Hour mark (:00) gets a solid line; half-hour (:30) gets a
       * lighter dashed line. Both use the calendar grid colour so they
       * adapt to light/dark mode. */
      border-bottom: 1px solid var(--pf-cal-grid-strong);
    }
    .pf-cal-time__slot--half {
      border-bottom-style: dashed;
      border-bottom-color: var(--pf-cal-grid);
    }
    .pf-cal-time__slot:hover {
      background: rgba(168, 85, 247, 0.08);
    }
    .pf-cal-past .pf-cal-time__slot { cursor: not-allowed; }
    .pf-cal-past .pf-cal-time__slot:hover { background: transparent; }

    /* ── Event chip (Day / Week) ─────────────────────────────── */
    .pf-cal-event {
      position: absolute;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid;
      border-left-width: 3px;
      border-radius: 6px;
      cursor: pointer;
      /* horizontal layout: monospace time on the left, name on the right */
      display: flex; align-items: center; gap: 6px;
      overflow: hidden; text-align: left;
      font-size: 11.5px; line-height: 1.2;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      box-shadow: 0 2px 6px rgba(0,0,0,0.18);
    }
    .pf-cal-event:hover { filter: brightness(1.15); z-index: 2; }
    .pf-cal-event__time {
      flex: 0 0 auto;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; font-weight: 600; opacity: 0.85;
      letter-spacing: 0.01em;
    }
    .pf-cal-event__title {
      flex: 1 1 auto; min-width: 0;
      font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Status palettes — dark mode (default). Light mode overrides below. */
    .pf-cal-event--booked,
    .pf-cal-month__event.pf-cal-event--booked {
      background: rgba(139, 92, 246, 0.22); border-color: #8b5cf6; color: var(--violet-text);
    }
    .pf-cal-event--checked-in,
    .pf-cal-month__event.pf-cal-event--checked-in {
      background: rgba(16, 185, 129, 0.22); border-color: #10b981; color: var(--green-text);
    }
    .pf-cal-event--completed,
    .pf-cal-month__event.pf-cal-event--completed {
      background: rgba(59, 130, 246, 0.22); border-color: #3b82f6; color: #bfdbfe;
    }
    .pf-cal-event--cancelled,
    .pf-cal-month__event.pf-cal-event--cancelled {
      background: rgba(156, 163, 175, 0.22); border-color: #9ca3af; color: #e5e7eb;
    }
    .pf-cal-event--no-show,
    .pf-cal-month__event.pf-cal-event--no-show {
      background: rgba(244, 63, 94, 0.22); border-color: #f43f5e; color: #fecdd3;
    }

    /* Light-mode palettes — solid darker text on the same tinted bg.
     * :host-context lets the per-component styles see the html
     * data-theme attribute set by the global theme switcher. */
    :host-context(html[data-theme="light"]) .pf-cal-event--booked,
    :host-context(html[data-theme="light"]) .pf-cal-month__event.pf-cal-event--booked {
      background: rgba(139, 92, 246, 0.16); border-color: #7c3aed; color: #4c1d95;
    }
    :host-context(html[data-theme="light"]) .pf-cal-event--checked-in,
    :host-context(html[data-theme="light"]) .pf-cal-month__event.pf-cal-event--checked-in {
      background: rgba(16, 185, 129, 0.18); border-color: #059669; color: #064e3b;
    }
    :host-context(html[data-theme="light"]) .pf-cal-event--completed,
    :host-context(html[data-theme="light"]) .pf-cal-month__event.pf-cal-event--completed {
      background: rgba(59, 130, 246, 0.16); border-color: #2563eb; color: #1e3a8a;
    }
    :host-context(html[data-theme="light"]) .pf-cal-event--cancelled,
    :host-context(html[data-theme="light"]) .pf-cal-month__event.pf-cal-event--cancelled {
      background: rgba(156, 163, 175, 0.20); border-color: #6b7280; color: #1f2937;
    }
    :host-context(html[data-theme="light"]) .pf-cal-event--no-show,
    :host-context(html[data-theme="light"]) .pf-cal-month__event.pf-cal-event--no-show {
      background: rgba(244, 63, 94, 0.16); border-color: #e11d48; color: #881337;
    }

    /* ── "Now" indicator overlay ─────────────────────────────── */
    /* Absolutely positioned over the day-column area so the line is
     * one continuous stroke across every day. Sits OUTSIDE the grid
     * flow (position: absolute) so it doesn't claim a grid cell and
     * push the day columns down. Pointer-events disabled so clicks
     * fall through to the slot/event buttons below. */
    .pf-cal-time__overlay {
      position: absolute;
      top: 0; bottom: 0; left: 64px; right: 0;
      pointer-events: none;
      z-index: 3;
    }
    .pf-cal-now {
      position: absolute; left: 0; right: 0;
      height: 0;
      border-top: 2px solid #ec4899;
      box-shadow: 0 0 8px rgba(236, 72, 153, 0.55);
      transform: translateY(-1px);
    }
    /* Dot anchored to today's column. --today-col is the 0-based index
     * of today within the visible week (0..6 in week view, 0 in day
     * view); --col-count is the total columns. left = (today / cols)
     * × 100% gives the column's left edge, then we nudge the dot to
     * straddle it. */
    .pf-cal-now::before {
      content: ''; position: absolute;
      left: calc((var(--today-col, 0) / var(--col-count, 1)) * 100% - 5px);
      top: -6px;
      width: 10px; height: 10px; border-radius: 50%;
      background: #ec4899;
      box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.25);
    }
    .pf-cal-now__label {
      position: absolute;
      left: calc((var(--today-col, 0) / var(--col-count, 1)) * 100% + 8px);
      top: -16px;
      padding: 1px 6px;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white; border-radius: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 9.5px; font-weight: 700;
      letter-spacing: 0.04em;
      box-shadow: 0 2px 6px rgba(236, 72, 153, 0.35);
    }

    /* ── Month grid ──────────────────────────────────────────── */
    .pf-cal-month { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .pf-cal-month__dows {
      display: grid; grid-template-columns: repeat(7, 1fr);
      padding: 10px 12px; border-bottom: 1px solid var(--pf-cal-grid-strong);
    }
    .pf-cal-month__dows span {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--text-tertiary); text-align: center;
    }
    .pf-cal-month__grid {
      flex: 1; min-height: 0;
      display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 1fr;
      /* Non-scroll page: if the 6 rows can't all fit the frame height
       * (short viewports / iPad split), scroll INSIDE the grid rather
       * than pushing the page. min-height:0 above lets this shrink. */
      overflow-y: auto; -webkit-overflow-scrolling: touch;
    }
    .pf-cal-month__cell {
      border-right: 1px solid var(--pf-cal-grid);
      border-bottom: 1px solid var(--pf-cal-grid);
      padding: 6px 6px 4px;
      display: flex; flex-direction: column; gap: 4px; min-height: 90px;
      cursor: pointer;
      position: relative;
    }
    .pf-cal-month__cell:hover { background: rgba(168, 85, 247, 0.05); }
    .pf-cal-month__cell:nth-child(7n) { border-right: 0; }
    .pf-cal-month__cell--out { background: rgba(255,255,255,0.015); }
    .pf-cal-month__cell--out .pf-cal-month__day { color: var(--text-muted); opacity: 0.55; }
    .pf-cal-month__day {
      font-size: 12.5px; font-weight: 600; color: var(--text-primary);
      align-self: flex-end;
    }
    .pf-cal-month__cell--today .pf-cal-month__day {
      width: 24px; height: 24px; border-radius: 50%;
      background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11.5px;
    }
    .pf-cal-month__summary {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding-bottom: 4px;
    }
    .pf-cal-month__pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(139, 92, 246, 0.12);
      border: 1px solid rgba(139, 92, 246, 0.25);
      color: var(--violet-text);
      font-size: 11px;
      font-weight: 600;
      transition: background 0.15s, border-color 0.15s;
    }
    :host-context(html[data-theme="light"]) .pf-cal-month__pill {
      background: rgba(124, 58, 237, 0.08);
      border-color: rgba(124, 58, 237, 0.22);
      color: #6d28d9;
    }
    .pf-cal-month__badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #8b5cf6;
      color: white;
      font-size: 10px;
      font-weight: 700;
    }
    :host-context(html[data-theme="light"]) .pf-cal-month__badge {
      background: #7c3aed;
    }
    .pf-cal-month__label {
      white-space: nowrap;
    }
    .pf-appt-overlay {
      position: fixed; inset: 0; z-index: 60;
      background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .pf-appt-card {
      width: 100%; max-width: 360px;
      background: var(--surface-1, #1b1b25);
      border: 1px solid var(--border-subtle); border-radius: 16px; padding: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .pf-appt-x {
      width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0;
      color: var(--text-tertiary); background: transparent; border: none; cursor: pointer;
    }
    .pf-appt-x:hover { background: var(--surface-2, rgba(255,255,255,0.06)); }
    .pf-appt-btn {
      font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 9px;
      border: 1px solid var(--border-subtle); background: var(--surface-2, rgba(255,255,255,0.04));
      color: var(--text-secondary); cursor: pointer;
    }
    .pf-appt-btn:hover { filter: brightness(1.15); }
    .pf-appt-btn--primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
    .pf-appt-btn--danger { color: var(--red-text); border-color: rgba(244,63,94,0.4); }

    /* ═══════════════════════════════════════════════════════════
     * CROSS-PLATFORM OVERRIDES (additive only)
     * Desktop-web (>=1280px) is untouched: every rule below is
     * gated by a max-width / pointer / platform query so it can
     * never reach the desktop layout.
     * ═══════════════════════════════════════════════════════════ */

    /* (Non-scroll layout: the frame is now flex:1 and fills the page's
     * remaining height on every size, so no explicit min-height is
     * needed — that also removes the old 60vh mobile-chrome clip.) */

    /* ── Touch affordances: only enable hover tint where a real hover
     * pointer exists; on touch these were causing sticky highlights. */
    @media (hover: none) {
      .pf-cal-back:hover,
      .pf-cal-book:hover,
      .pf-cal-views button:hover,
      .pf-cal-nav__btn:hover,
      .pf-cal-nav__jump:hover,
      .pf-cal-time__slot:hover,
      .pf-cal-event:hover,
      .pf-cal-month__cell:hover,
      .pf-cal-month__pill:hover,
      .pf-appt-btn:hover,
      .pf-appt-x:hover { filter: none; }
      .pf-cal-time__slot:hover { background: transparent; }
      .pf-cal-event:hover { filter: none; z-index: auto; }
      .pf-cal-month__cell:hover { background: transparent; }
    }

    /* ── Coarse pointer: bump small tap targets to >=44px without
     * changing their visual box on desktop. */
    @media (pointer: coarse) {
      .pf-cal-back { min-height: 44px; }
      .pf-cal-book { min-height: 44px; }
      .pf-cal-nav__btn { width: 44px; height: 44px; }
      .pf-cal-nav__today { width: auto; min-width: 44px; height: 44px; }
      .pf-cal-nav__jump { height: 44px; }
      .pf-cal-views button { padding-top: 11px; padding-bottom: 11px; min-height: 44px; }
      .pf-cal-month__pill { min-height: 32px; padding-top: 7px; padding-bottom: 7px; }
      .pf-appt-x { width: 44px; height: 44px; }
      .pf-appt-btn { min-height: 44px; }
    }

    /* ── iPad band (641–1279): the time grid stays comfortable, but
     * keep week columns from collapsing too far; month cells a touch
     * shorter so the grid fits the viewport height. */
    @media (min-width: 641px) and (max-width: 1279px) {
      .pf-cal-time__head,
      .pf-cal-time__body { min-width: 0; }
      .pf-cal-month__cell { min-height: 76px; }
    }

    /* ── Phone (<=640): single-column, no horizontal overflow,
     * full-width bottom sheet for the action card. */
    @media (max-width: 640px) {
      .pf-cal-page { padding: 14px 12px; gap: 12px; }

      /* Header: keep the back/title/book on a compact wrapping row. */
      .pf-cal-hdr { gap: 10px; }
      .pf-cal-hdr__l h1 { font-size: 19px; }
      .pf-cal-hdr__l p { font-size: 12px; }
      .pf-cal-book { width: 100%; justify-content: center; padding: 11px 1rem; }
      .pf-cal-hdr__r { width: 100%; }

      /* Toolbar stacks: view switcher full width, nav row below. */
      .pf-cal-toolbar { gap: 8px; }
      .pf-cal-views { width: 100%; justify-content: space-between; }
      .pf-cal-views button { flex: 1; text-align: center; }
      .pf-cal-nav { width: 100%; flex-wrap: wrap; }
      .pf-cal-nav__title {
        margin-left: 0; width: 100%; order: 5;
        font-size: 13px; text-align: center;
      }
      /* iOS: hidden jump-to-date input is focused on tap before its
       * native picker opens — keep it >=16px so WKWebView doesn't zoom. */
      .pf-cal-nav__jump-input { font-size: 16px; }

      /* Day / Week grid: narrower time rail + allow the 7-day week to
       * scroll horizontally instead of crushing columns to nothing.
       * Each day column gets a sensible min so events stay readable. */
      /* The FRAME scrolls, not the body: with the body as the scroller the
         day headers stayed frozen while columns slid beneath them — you
         could book against the wrong day. One scroller moves head, body and
         the now-line overlay as a unit. */
      .pf-cal-frame { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .pf-cal-time__body { overflow-x: visible; }
      .pf-cal-time__head,
      .pf-cal-time__body {
        grid-template-columns: 44px repeat(var(--col-count, 7), minmax(64px, 1fr));
        min-width: calc(44px + var(--col-count, 7) * 64px);
      }
      .pf-cal-time__overlay { left: 44px; }
      .pf-cal-time__hour > span { right: 5px; font-size: 9.5px; }
      .pf-cal-time__col-hdr { padding: 10px 6px; }

      /* Event chips: stack time over name so short columns still read. */
      .pf-cal-event { font-size: 11px; padding: 3px 6px; }
      .pf-cal-event__time { font-size: 10px; }

      /* Month grid: trim cell padding/height so all 6 rows fit. */
      .pf-cal-month__dows { padding: 8px 6px; }
      .pf-cal-month__cell { padding: 5px 4px 3px; min-height: 56px; }
      .pf-cal-month__pill { padding: 3px 7px; font-size: 10px; gap: 4px; }
      .pf-cal-month__label { display: none; }

      /* Action card → bottom sheet that clears the bottom-nav pill and
       * the home-indicator safe area on notched phones. */
      .pf-appt-overlay { align-items: flex-end; padding: 0; }
      .pf-appt-card {
        max-width: 100%;
        border-radius: 18px 18px 0 0;
        padding-bottom: calc(16px + var(--tab-nav-total-height, 0px) + env(safe-area-inset-bottom, 0px));
        max-height: 85dvh; overflow-y: auto;
      }
      /* iOS: 16px+ inputs to stop auto-zoom on focus. */
      .pf-appt-card .pf-input { font-size: 16px; }
      .pf-appt-btn { padding: 9px 14px; }
    }
  `]
})
export class AppointmentsCalendarComponent {
  private readonly api = inject(ApiService);
  private readonly profile = inject(PatientProfileService);
  private readonly booking = inject(AppointmentBookingService);
  protected readonly queue = inject(AppointmentQueueService);
  private readonly toasts = inject(ToastService);
  protected readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly zoom = inject(ZoomTransitionService);

  // ── New design (ND-PATTERN §21) ─────────────────────────────────────────
  protected readonly plural = plural;
  protected readonly ND_HOUR = ND_HOUR;
  /** ≤900px: one card at a time (Day view = the day list); ≤640px: phones. */
  readonly narrow = signal(mq('(max-width: 900px)', inject(DestroyRef), m => this.narrow?.set(m)));
  readonly phone = signal(mq('(max-width: 640px)', inject(DestroyRef), m => this.phone?.set(m)));
  /** The pill's search: patient name, phone or MRN — filters what is shown. */
  readonly query = signal('');
  /** The DAY companion collapsed to a strip on the right edge (per user). */
  readonly sideCollapsed = signal(readFlag(this.collapseKey()));
  /** The detail's step came back from Reschedule (slide from the left). */
  protected readonly stepBack = signal(false);
  /** 48 half-hour slots on the ND time grid (ND_HOUR px an hour). */
  protected readonly ndSlots = Array.from({ length: 48 }, (_, i) => {
    const hour = Math.floor(i / 2), minute = (i % 2) * 30;
    return { hour, minute, top: i * (ND_HOUR / 2), time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
  });

  // Action sheet for a clicked appointment.
  protected readonly selectedAppt = signal<Appointment | null>(null);
  protected readonly rescheduleOpen = signal(false);
  protected rDate = '';
  protected rTime = '';
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Back button — prefer browser history (so the user lands wherever
   * they came from), but fall back to /frontdesk if the calendar was
   * opened directly via deep-link (no history to pop). */
  goBack() {
    this.navBack.backTo('/frontdesk');
  }

  // exposed to template
  protected readonly HOUR_HEIGHT = HOUR_HEIGHT;
  protected readonly hours = Array.from({ length: 24 }, (_, i) => i);
  /** 48 half-hour click targets per day (00:00, 00:30, …, 23:30). Each
   *  has a dashed bottom border so the grid shows a line every 30 min;
   *  the button lets the user book at either :00 or :30. */
  protected readonly halfHourSlots = Array.from({ length: 48 }, (_, i) => ({
    hour: Math.floor(i / 2),
    minute: (i % 2) * 30,
    topPx: i * (HOUR_HEIGHT / 2)
  }));
  protected readonly HALF_HOUR_HEIGHT = HOUR_HEIGHT / 2;
  protected readonly weekdayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly allViews: CalView[] = ['day', 'week', 'month'];

  // state
  /** Phones open on the day list (ND); everywhere else the month, as before. */
  protected readonly view = signal<CalView>(this.theme.isNewDesign() && this.narrow() ? 'day' : 'month');
  /** Anchor date — for week view, any date in the visible week; for day,
   *  the day itself; for month, any date in the visible month. */
  protected readonly cursor = signal<Date>(new Date());
  /** Wall-clock minute. Drives the "now" indicator line on Day/Week. */
  private readonly _now = signal<Date>(new Date());
  private readonly _appointments = signal<Appointment[]>([]);
  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  /** Vertical position (% of the 24-hour rail) of the now line. */
  protected readonly nowTopPct = computed(() => {
    const n = this._now();
    return ((n.getHours() * 60 + n.getMinutes()) / (24 * 60)) * 100;
  });
  protected readonly nowLabel = computed(() => {
    const n = this._now();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  });

  // derived
  protected readonly weekDays = computed<WeekDay[]>(() => {
    const start = startOfWeek(this.cursor());
    const today = stripTime(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      return {
        iso: isoDate(d), date: d,
        today: sameDay(d, today),
        past: d.getTime() < today.getTime(),
        weekday: ['MON','TUE','WED','THU','FRI','SAT','SUN'][i],
        label: String(d.getDate())
      };
    });
  });

  /** Index of `cursor` within the current week — used by day view. */
  protected readonly dayIndex = computed(() => {
    const c = this.cursor();
    const start = startOfWeek(c);
    return Math.floor((stripTime(c).getTime() - start.getTime()) / (24 * 3600 * 1000));
  });

  /** Index (0–6) of "today" within the visible week, or -1 if today
   *  isn't in this week. Used to position the now-line's time badge
   *  over today's column. */
  protected readonly todayWeekIndex = computed(() => {
    const days = this.weekDays();
    return days.findIndex(d => d.today);
  });

  protected readonly monthCells = computed<DayCell[]>(() => {
    const cursor = this.cursor();
    const month = startOfMonth(cursor);
    const gridStart = startOfWeek(month);
    const today = stripTime(new Date());
    const byDay = this.appointmentsByDay();
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(gridStart, i);
      return {
        iso: isoDate(d), date: d,
        today: sameDay(d, today),
        outside: d.getMonth() !== month.getMonth(),
        past: d.getTime() < today.getTime(),
        events: byDay.get(isoDate(d)) ?? []
      };
    });
  });

  /** Range we should fetch for, given the current view + cursor. */
  protected readonly viewRange = computed<{ from: Date; to: Date }>(() => {
    const v = this.view();
    const c = this.cursor();
    if (v === 'day') {
      const from = stripTime(c);
      return { from, to: addDays(from, 1) };
    }
    if (v === 'week') {
      const from = startOfWeek(c);
      return { from, to: addDays(from, 7) };
    }
    // month — fetch the full grid window so peeked weeks show events too.
    const monthStart = startOfMonth(c);
    const from = startOfWeek(monthStart);
    return { from, to: addDays(from, 42) };
  });

  protected readonly rangeLabel = computed(() => {
    const { from, to } = this.viewRange();
    const v = this.view();
    if (v === 'day') return formatLong(from);
    if (v === 'week') {
      const last = addDays(to, -1);
      if (from.getMonth() === last.getMonth())
        return `${from.getDate()} – ${last.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
      return `${from.getDate()} ${MONTHS[from.getMonth()].slice(0,3)} – ${last.getDate()} ${MONTHS[last.getMonth()].slice(0,3)} ${last.getFullYear()}`;
    }
    const m = startOfMonth(this.cursor());
    return `${MONTHS[m.getMonth()]} ${m.getFullYear()}`;
  });

  /** What the calendar shows: every loaded appointment, narrowed by the
   *  pill's search (name, phone or MRN) when one is typed. */
  protected readonly visibleAppointments = computed(() => {
    const q = this.query();
    const all = this._appointments();
    return q.trim() ? all.filter(a => matchesAppointment(a, q)) : all;
  });
  protected readonly filteredCount = computed(() => this.visibleAppointments().length);

  /** Group appointments by ISO day for fast cell rendering. */
  private readonly appointmentsByDay = computed(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of this.visibleAppointments()) {
      const key = isoDate(parseAppointmentStart(a) ?? new Date());
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    // Sort within each day by start time.
    for (const list of map.values()) {
      list.sort((x, y) => (x.slotTime ?? '').localeCompare(y.slotTime ?? ''));
    }
    return map;
  });

  protected readonly weekEventsByDay = computed<Record<string, PlacedEvent[]>>(() => {
    const out: Record<string, PlacedEvent[]> = {};
    const byDay = this.appointmentsByDay();
    for (const d of this.weekDays()) {
      out[d.iso] = (byDay.get(d.iso) ?? []).map(a => placeEvent(a));
    }
    return out;
  });

  protected readonly dayEvents = computed<PlacedEvent[]>(() => {
    const d = this.weekDays()[this.dayIndex()];
    if (!d) return [];
    return (this.appointmentsByDay().get(d.iso) ?? []).map(a => placeEvent(a));
  });

  // ── ND derived ──────────────────────────────────────────────────────
  /** Day view's single column (the cursor's day). */
  protected readonly ndDayCols = computed<WeekDay[]>(() => {
    const d = this.weekDays()[this.dayIndex()];
    return d ? [d] : [];
  });
  /** ND time-grid cards per visible day: top in px, side-by-side lanes when
   *  several share a start time (never stacked on top of each other). */
  protected readonly ndEvents = computed(() => {
    const out: Record<string, ReturnType<typeof placeLanes>> = {};
    const byDay = this.appointmentsByDay();
    for (const d of this.weekDays()) out[d.iso] = placeLanes(byDay.get(d.iso) ?? [], parseAppointmentStart);
    return out;
  });
  protected evsFor(iso: string) { return this.ndEvents()[iso] ?? []; }
  protected readonly nowTopPx = computed(() => {
    const n = this._now();
    return ((n.getHours() * 60 + n.getMinutes()) / 60) * ND_HOUR;
  });
  /** The chosen day's appointments (the DAY card), in time order. */
  protected readonly dayList = computed(() => this.appointmentsByDay().get(this.cursorIso()) ?? []);
  protected readonly dayLabel = computed(() => {
    const c = stripTime(this.cursor());
    const t = stripTime(new Date());
    const diff = Math.round((c.getTime() - t.getTime()) / 86_400_000);
    const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : '';
    const d = `${WEEKDAYS[c.getDay()].slice(0, 3)} ${c.getDate()} ${MONTHS[c.getMonth()].slice(0, 3)}`;
    return rel ? `${rel} · ${d}` : d;
  });
  protected readonly cursorPast = computed(() => stripTime(this.cursor()).getTime() < stripTime(new Date()).getTime());
  /** Reschedule's time choices: every half hour (+ the booked time). */
  protected readonly timeOptions = signal<PfSelectOption<string>[]>([]);

  private readonly hostEl: ElementRef<HTMLElement> = inject(ElementRef);

  constructor() {
    // Refetch whenever the visible range changes. effect runs in DI ctx.
    effect(() => {
      const range = this.viewRange();
      this.fetchRange(range.from, range.to);
    });

    // Auto-scroll the Day / Week time grid to a position ~1.5 hours
    // above the current time whenever those views become active. So
    // opening the calendar at 3 PM lands you at ~1:30 PM with "now"
    // mid-screen, instead of staring at midnight. queueMicrotask gives
    // the @switch template a frame to render before we read the body.
    effect(() => {
      const v = this.view();
      if (v !== 'day' && v !== 'week') return;
      const hourPx = this.theme.isNewDesign() ? ND_HOUR : HOUR_HEIGHT;
      this.narrow();
      queueMicrotask(() => {
        const body = this.hostEl.nativeElement.querySelector<HTMLElement>('.pf-cal-time__body, .pf-apc-time');
        if (!body) return;
        const now = new Date();
        const currentHour = now.getHours() + now.getMinutes() / 60;
        const targetTop = Math.max(0, (currentHour - 1.5) * hourPx);
        // Phones (week scrolls sideways): bring today's column into view.
        const today = body.querySelector<HTMLElement>('.pf-apc-dayhdr--today');
        if (today && body.scrollWidth > body.clientWidth) body.scrollLeft = Math.max(0, today.offsetLeft - 44);
        body.scrollTop = targetTop;
      });
    });

    // Refetch after a successful booking. skip(1) drops the initial signal.
    toObservable(this.booking.bookedAt)
      .pipe(skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const r = this.viewRange();
        this.fetchRange(r.from, r.to);
      });

    // Tick the "now" line every 60 seconds. The interval is cleared
    // when the component is destroyed via DestroyRef.
    const tick = setInterval(() => this._now.set(new Date()), 60_000);
    this.destroyRef.onDestroy(() => clearInterval(tick));
  }

  // ── View nav ────────────────────────────────────────────────
  setView(v: CalView) { this.view.set(v); }
  setDay(iso: string) {
    this.cursor.set(new Date(`${iso}T12:00:00`));
    this.view.set('day');
  }
  goToday() { this.cursor.set(new Date()); }

  /** YYYY-MM-DD of the current cursor — fed to the jump-to-date input. */
  cursorIso(): string {
    const c = this.cursor();
    const y = c.getFullYear();
    const m = String(c.getMonth() + 1).padStart(2, '0');
    const d = String(c.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  /** Move cursor to picked date + switch to Day view. */
  jumpToDate(iso: string) {
    if (!iso) return;
    this.cursor.set(new Date(`${iso}T12:00:00`));
    this.view.set('day');
  }

  navigate(delta: number) {
    const c = this.cursor();
    if (this.view() === 'day') this.cursor.set(addDays(c, delta));
    else if (this.view() === 'week') this.cursor.set(addDays(c, delta * 7));
    else {
      const m = startOfMonth(c);
      this.cursor.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
    }
  }

  // ── Booking entrypoints ─────────────────────────────────────
  bookNow() {
    this.router.navigate(['/frontdesk/appointments/new']);
  }

  protected onSlotClick(iso: string, hour: number, minute: number) {
    if (!iso) return;
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (this.isInPast(iso, time)) {
      this.toasts.warning('Cannot book an appointment in the past');
      return;
    }
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { date: iso, time } });
  }

  protected onMonthCellClick(cell: DayCell, ev: MouseEvent) {
    if (!cell || !cell.iso) return;
    const today = stripTime(new Date());
    if (cell.date.getTime() < today.getTime()) {
      this.toasts.warning('Cannot book an appointment in the past');
      return;
    }
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { date: cell.iso } });
  }

  protected onMonthPillClick(iso: string, ev: MouseEvent) {
    if (ev) {
      ev.stopPropagation();
    }
    this.setDay(iso);
  }

  protected onEventClick(a: Appointment, ev: MouseEvent) {
    ev.stopPropagation();
    // New design: the appointment opens in the DAY companion (list → detail zoom).
    if (this.theme.isNewDesign()) { this.openAppt(a); return; }
    // Open an action sheet (check in / reschedule / no-show / cancel / profile)
    // instead of jumping straight to the profile.
    this.rescheduleOpen.set(false);
    this.rDate = a.appointmentDate ? a.appointmentDate.slice(0, 10) : '';
    this.rTime = a.slotTime ?? '';
    this.selectedAppt.set(a);
  }

  protected closeAppt() {
    const shut = () => { this.selectedAppt.set(null); this.rescheduleOpen.set(false); };
    if (this.theme.isNewDesign() && this.selectedAppt()) this.zoom.runLocal('out', shut);
    else shut();
  }

  // ── ND interactions ─────────────────────────────────────────────────
  /** A row / calendar card → that appointment's detail (zooms from the tap). */
  protected openAppt(a: Appointment, ev?: Event) {
    ev?.stopPropagation();
    if (this.selectedAppt()?.id === a.id) { this.zoom.disarm(); return; }
    const open = () => {
      this.rescheduleOpen.set(false);
      this.stepBack.set(false);
      this.rDate = a.appointmentDate ? a.appointmentDate.slice(0, 10) : '';
      this.rTime = a.slotTime ?? '';
      if (this.sideCollapsed() && !this.narrow()) this.setCollapsed(false);
      this.selectedAppt.set(a);
    };
    this.zoom.runLocal('in', open);
  }
  /** Reschedule is the detail's next STEP (slides forward; Back slides back). */
  protected openReschedule() {
    const opts: PfSelectOption<string>[] = this.ndSlots.map(s => ({ value: s.time, label: s.time }));
    if (this.rTime && !opts.some(o => o.value === this.rTime)) opts.unshift({ value: this.rTime, label: this.rTime });
    this.timeOptions.set(opts);
    this.stepBack.set(false);
    this.rescheduleOpen.set(true);
  }
  protected closeReschedule() { this.stepBack.set(true); this.rescheduleOpen.set(false); }
  protected onEscape(e?: Event) {
    if (!this.theme.isNewDesign() || e?.defaultPrevented) return;
    // An open dropdown (pf-select panel) owns its own Esc.
    const t = e?.target as HTMLElement | null;
    if (t?.closest?.('#pf-overlay-host, .pf-dd')) return;
    if (this.rescheduleOpen()) this.closeReschedule();
    else if (this.selectedAppt()) this.closeAppt();
  }
  /** The DAY card's week strip picks the day without changing the view. */
  protected pickDay(iso: string) { this.cursor.set(new Date(`${iso}T12:00:00`)); }
  protected bookOnDay() {
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { date: this.cursorIso() } });
  }
  toggleSide() { this.setCollapsed(!this.sideCollapsed()); }
  private setCollapsed(v: boolean) {
    this.sideCollapsed.set(v);
    try { localStorage.setItem(this.collapseKey(), v ? '1' : '0'); } catch { /* private mode */ }
  }
  private collapseKey(): string {
    let uid = '';
    try { uid = this.auth?.user()?.id ?? ''; } catch { /* no session */ }
    return 'pf:appt:side-collapsed:' + (uid || 'anon');
  }
  /** The pill's jump button opens the (hidden) native picker. */
  protected openJump(el: HTMLInputElement) {
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.click(); }
  }
  /** Day / Week / Month radio group: ←/→ move, Home / End jump. */
  protected onViewKey(e: KeyboardEvent) {
    const i = this.allViews.indexOf(this.view());
    const n = this.allViews.length;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    this.setView(this.allViews[next]);
    const group = (e.target as HTMLElement).parentElement;
    queueMicrotask(() => (group?.children[next] as HTMLElement | undefined)?.focus());
  }
  protected viewLabel(v: CalView): string { return v[0].toUpperCase() + v.slice(1); }
  protected nameOf(a: Appointment): string { return patientDisplayName(a.patient) || 'Patient'; }
  /** Quiet meta: "10:30 · 22/M · AA0006" (tabular, joined with ·). */
  protected metaOf(a: Appointment): string {
    const t = a.slotTime || '—';
    return a.patient ? `${t} · ${formatPatientMeta(a.patient)}` : t;
  }
  protected rowLabel(a: Appointment): string { return `${this.nameOf(a)}, ${this.metaOf(a)}, ${apptStatusWord(a.status)}`; }
  protected statusTone(s: string) { return apptStatusTone(s); }
  protected statusWord(s: string) { return apptStatusWord(s); }
  protected typeWord(t: string) { return apptTypeWord(t); }
  protected testCount(a: Appointment): number { return (a.testIds ?? '').split(',').filter(x => x.trim()).length; }
  protected whenOf(a: Appointment): string {
    const d = parseAppointmentStart(a);
    return d ? `${this.longDate(d)} · ${a.slotTime || '—'}` : (a.slotTime || '—');
  }
  protected longDate(d: Date): string {
    return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  }
  protected hh(h: number): string { return String(h).padStart(2, '0'); }
  protected slotPast(iso: string, time: string): boolean { return this.isInPast(iso, time); }

  protected openProfile(a: Appointment) {
    this.closeAppt();
    if (a.patientId) this.profile.open(a.patientId);
  }

  /** Run a queue transition, then refresh the calendar and close the sheet. */
  protected run(obs: Observable<unknown>) {
    obs.subscribe({
      next: () => { this.refresh(); this.closeAppt(); },
      error: (e) => { this.toasts.error(ApiError.from(e).message); this.refresh(); }
    });
  }

  protected doReschedule(a: Appointment) {
    if (!this.rDate) { this.toasts.warning('Pick a new date.'); return; }
    const iso = new Date(this.rDate).toISOString();
    this.run(this.queue.reschedule(a.id, iso, this.rTime || undefined));
  }

  private refresh() {
    const r = this.viewRange();
    this.fetchRange(r.from, r.to);
  }

  protected statusClass(status: string): string {
    return STATUS_CLASS[status] ?? STATUS_CLASS['booked'];
  }

  // ── Data ────────────────────────────────────────────────────
  private fetchRange(from: Date, to: Date) {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString()
    });
    this._loading.set(true);
    this.api.get<Appointment[]>(`/api/appointments?${params}`).subscribe({
      next: list => {
        this._appointments.set(list ?? []);
        this._loading.set(false);
      },
      error: () => {
        this._appointments.set([]);
        this._loading.set(false);
      }
    });
  }

  private isInPast(date: string, time: string): boolean {
    const target = new Date(`${date}T${time}:00`);
    return target.getTime() < Date.now() - 60_000;
  }
}

// ── Pure helpers ─────────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/** A reactive media query (removed with the component). */
function mq(query: string, ref: DestroyRef, on: (m: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const m = window.matchMedia(query);
  const fn = (e: MediaQueryListEvent) => on(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return !!m.matches;
}
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function stripTime(d: Date): Date {
  const r = new Date(d); r.setHours(0,0,0,0); return r;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function startOfWeek(d: Date): Date {
  const r = stripTime(d);
  const day = r.getDay(); // 0=Sun
  const offset = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + offset);
  return r;
}
function startOfMonth(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), 1);
  r.setHours(0,0,0,0); return r;
}
function formatLong(d: Date): string {
  const wk = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
  return `${wk}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function parseAppointmentStart(a: Appointment): Date | null {
  if (!a.appointmentDate) return null;
  const d = new Date(a.appointmentDate);
  if (isNaN(d.getTime())) return null;
  if (a.slotTime && /^\d{1,2}:\d{2}/.test(a.slotTime)) {
    const [hh, mm] = a.slotTime.split(':').map(n => parseInt(n, 10));
    if (Number.isFinite(hh) && Number.isFinite(mm)) d.setHours(hh, mm, 0, 0);
  }
  return d;
}

/** Place an appointment on the day-column track. Default to a 30-min
 *  block, full width. We don't currently overlap-resolve — if two
 *  events fall on the same slot they stack. */
function placeEvent(a: Appointment): PlacedEvent {
  const start = parseAppointmentStart(a);
  if (!start) return { appt: a, topPct: 0, heightPct: 4, leftPct: 2, widthPct: 96 };
  const minutes = start.getHours() * 60 + start.getMinutes();
  const topPct = (minutes / (24 * 60)) * 100;
  const heightPct = (30 / (24 * 60)) * 100;
  return { appt: a, topPct, heightPct, leftPct: 2, widthPct: 96 };
}
