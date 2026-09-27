import { Location, DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  DestroyRef,
  computed,
  inject,
  signal,
  effect,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import flatpickr from "flatpickr";
import { ActivatedRoute, Router } from "@angular/router";
import { AuthService } from "../../../core/auth/auth.service";
import { ApiService } from "../../../core/services/api.service";
import { ToastService } from "../../../core/services/toast.service";
import { AppointmentBookingService } from "../../../core/services/appointment-booking.service";
import { Appointment } from "../../../shared/models/appointment.model";
import { ApiError } from "../../../shared/models/api-response.model";
import {
  Patient,
  patientDisplayName,
  formatPatientInfo,
} from "../../../shared/models/patient.model";
import { Test } from "../../../shared/models/test.model";
import { effectivePrice, isOffered, isPriceDefault } from "../../../shared/utils/test-pricing";
import { CurrencyInrPipe } from "../../../shared/pipes/currency-inr.pipe";
import {
  filterTestList,
  matchTestSearch,
} from "../../../shared/utils/test-search";
import { AvatarComponent } from "../../../shared/primitives/avatar.component";
import { ScreenHeaderComponent } from "../../../shared/primitives/screen-header.component";
import { LoadingLogoComponent } from "../../../shared/components/loading-logo/loading-logo.component";
import { PatientSearchComponent } from "../../../shared/components/patient-search/patient-search.component";
import { NavBackService } from '../../../core/services/nav-back.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { NdDateComponent } from '../../../shared/components/nd-date/nd-date.component';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { plural } from '../../../shared/utils/plural';
import { formatPatientMeta } from '../../../shared/models/patient.model';
import { BOOK_APPOINTMENT_ND_STYLES, SlotPeriod, nextFocus, rovingIndex } from './book-appointment.nd';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";

interface AppointmentConfigDto {
  branchId: string;
  slotMinutes: number;
  open24h: boolean;
  weeklyScheduleJson: string | null;
  maxConcurrentSlots: number;
}

interface SlotInfo {
  time: string;
  available: boolean;
  bookedCount: number;
}

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

@Component({
  selector: "pf-book-appointment",
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    AvatarComponent,
    ScreenHeaderComponent,
    LoadingLogoComponent,
    PatientSearchComponent,
    CurrencyInrPipe,
    HeroBandComponent,
    NdDateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (theme.isNewDesign()) {
    <!-- NEW DESIGN (ND-PATTERN §21): ONE page, no tabs, keyboard-first.
         Band = back · tenant · Cancel + the ONE primary "Book appointment";
         the pill = the context bar (date · slot · patient). Cards in reading
         order: PATIENT · DATE → TIME SLOT → DETAILS. Enter = next field;
         Ctrl/⌘+Enter books from anywhere. -->
    <section class="pf-band-page pf-bka" (keydown)="onFormKey($event)">
      <pf-hero-band class="pf-bka-band" [back]="true" backTo="/frontdesk/appointments"
                    [customSearch]="true" [contextBar]="true" [standardPill]="true">
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-bka-cancel press" [disabled]="saving()" (click)="back()"
                  aria-label="Cancel" title="Cancel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            <span class="pf-bka-cancel__t">Cancel</span>
          </button>
          @if (!phone()) {
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-bka-book press" [disabled]="saving()"
                    (click)="attemptBook()" [attr.aria-label]="saving() ? 'Booking' : 'Book appointment'"
                    title="Book appointment (Ctrl/⌘+Enter)" aria-keyshortcuts="Control+Enter Meta+Enter">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>
              {{ saving() ? 'Booking…' : 'Book appointment' }}
            </button>
          }
        </ng-container>

        <!-- The pill = the CONTEXT BAR: date · slot · patient (once chosen). -->
        <div band-search class="nd-ctx pf-bka-ctx">
          <span class="nd-ctx__chip pf-bka-ctx__date"><span class="nd-ctx__k">Date</span><span class="nd-num">{{ dateLabel() }}</span></span>
          <span class="nd-ctx__chip pf-bka-ctx__slot">
            <span class="nd-ctx__k">Slot</span>
            @if (selectedTime()) { <span class="nd-num">{{ selectedTime() }}</span> } @else { <span class="pf-bka-ctx__none">Not picked</span> }
          </span>
          @if (patient(); as p) {
            <span class="nd-ctx__primary pf-bka-ctx__patient">
              <span>{{ patientName() }}</span>
              <span class="pf-bka-ctx__pmeta nd-num">{{ patientMeta(p) }}</span>
            </span>
          }
        </div>
      </pf-hero-band>

      <div class="pf-band-body pf-bka-body">
        @if (errorMsg()) {
          <p class="pf-bka-alert" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            {{ errorMsg() }}
          </p>
        }
        <div class="pf-bka-grid">
          <!-- ── Column 1: PATIENT + DATE ── -->
          <div class="pf-bka-col">
            <section class="nd-card pf-bka-card pf-bka-patient" aria-labelledby="pf-bka-l-patient">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <span class="nd-card__label" id="pf-bka-l-patient">Patient</span>
                <span class="nd-card__spacer"></span>
                <span class="pf-bka-req"><span class="nd-dot-unpriced" aria-hidden="true"></span>Required</span>
              </header>
              <div class="nd-card__body">
                @if (patient(); as p) {
                  <div class="pf-bka-picked nd-row nd-row--in">
                    <span class="pf-bka-picked__who">
                      <span class="pf-bka-picked__name">{{ patientName() }}</span>
                      <span class="pf-bka-picked__meta nd-num">{{ patientMeta(p) }}@if (p.phone) { · {{ p.phone }} }</span>
                    </span>
                    <button type="button" class="nd-btn nd-btn--tertiary pf-bka-change" data-nav (click)="changePatient()">Change</button>
                  </div>
                } @else {
                  <div class="nd-field pf-bka-psearch">
                    <label class="nd-field__lbl" for="pf-bka-pq">Find the patient</label>
                    <span class="pf-bka-inputwrap">
                      <svg class="pf-bka-inputwrap__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                      <input #patientInput id="pf-bka-pq" type="text" class="nd-input pf-bka-pq" data-nav autocomplete="off" spellcheck="false"
                             role="combobox" aria-autocomplete="list" aria-controls="pf-bka-plist" [attr.aria-expanded]="pResults().length > 0"
                             [attr.aria-activedescendant]="pHighlight() >= 0 ? 'pf-bka-p-' + pHighlight() : null"
                             [class.nd-input--error]="showErr() && !patient()" [attr.aria-invalid]="showErr() && !patient() ? true : null"
                             [attr.aria-describedby]="showErr() && !patient() ? 'pf-bka-e-patient' : null"
                             placeholder="Name, phone or MRN" [value]="pQuery()" (input)="onPatientQuery($any($event.target).value)"
                             (keydown.arrowDown)="movePatient($event, 1)" (keydown.arrowUp)="movePatient($event, -1)" />
                    </span>
                    @if (showErr() && !patient()) { <p class="pf-bka-err" id="pf-bka-e-patient">Pick the patient to book for.</p> }
                    @if (pQuery().trim().length >= 2) {
                      <ul class="pf-bka-results" id="pf-bka-plist" role="listbox" aria-label="Patients">
                        @for (p of pResults(); track p.id; let i = $index) {
                          <li>
                            <button type="button" class="pf-bka-result" role="option" [id]="'pf-bka-p-' + i" tabindex="-1"
                                    [attr.aria-selected]="i === pHighlight()" (mouseenter)="pHighlight.set(i)"
                                    (mousedown)="$event.preventDefault()" (click)="pickPatient(p)">
                              <span class="pf-bka-result__name">{{ nameOf(p) }}</span>
                              <span class="pf-bka-result__meta nd-num">{{ patientMeta(p) }}@if (p.phone) { · {{ p.phone }} }</span>
                            </button>
                          </li>
                        } @empty {
                          <li class="pf-bka-note">{{ pLoading() ? 'Searching…' : 'No patient matches.' }}</li>
                        }
                      </ul>
                    }
                  </div>
                }
              </div>
            </section>

            <section class="nd-card pf-bka-card pf-bka-date" aria-labelledby="pf-bka-l-date">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                </span>
                <span class="nd-card__label" id="pf-bka-l-date">Date</span>
                <span class="nd-card__spacer"></span>
                <span class="pf-bka-req"><span class="nd-dot-unpriced" aria-hidden="true"></span>Required</span>
              </header>
              <div class="nd-card__body">
                <label class="nd-field">
                  <span class="nd-field__lbl">Appointment date</span>
                  <pf-nd-date data-nav label="Appointment date" [value]="selectedDate()" [min]="todayIso"
                              (valueChange)="$event && selectDate($event)"></pf-nd-date>
                </label>
                <div class="pf-bka-days" role="group" aria-label="Quick pick a day">
                  @for (d of quickDays(); track d.iso) {
                    <button type="button" class="pf-bka-day" tabindex="-1" [attr.aria-pressed]="d.iso === selectedDate()"
                            [class.pf-bka-day--today]="d.today" [attr.aria-label]="d.long" (click)="selectDate(d.iso)">
                      <span class="pf-bka-day__dow">{{ d.dow }}</span>
                      <span class="pf-bka-day__n nd-num">{{ d.n }}</span>
                    </button>
                  }
                </div>
              </div>
            </section>
          </div>

          <!-- ── Column 2: TIME SLOT ── -->
          <section class="nd-card pf-bka-card pf-bka-slots" aria-labelledby="pf-bka-l-slot">
            <header class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              </span>
              <span class="nd-card__label" id="pf-bka-l-slot">Time slot</span>
              <span class="nd-card__spacer"></span>
              <span class="pf-bka-req"><span class="nd-dot-unpriced" aria-hidden="true"></span>Required</span>
            </header>
            <div class="nd-card__body">
              @if (loadingSlots()) {
                <p class="pf-bka-note" role="status">Loading slots…</p>
              } @else if (slots().length === 0) {
                <div class="nd-empty nd-empty--compact">
                  <span class="nd-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                  </span>
                  <p class="nd-empty__title">No slots on this day</p>
                  <p class="nd-empty__body">The branch is closed, or every slot has passed. Pick another day.</p>
                </div>
              } @else {
                <div class="nd-seg pf-bka-periods" role="radiogroup" aria-label="Part of the day">
                  @for (per of periods; track per.id) {
                    <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="timePeriod() === per.id"
                            tabindex="-1" (click)="timePeriod.set(per.id)">
                      {{ per.label }} <span class="pf-bka-periods__n nd-num">{{ periodsWithSlots()[per.id] }}</span>
                    </button>
                  }
                </div>
                @if (visibleSlots().length === 0) {
                  <p class="pf-bka-note">No slots in this part of the day.</p>
                } @else {
                  <div class="pf-bka-chips" role="radiogroup" aria-label="Time slot" data-nav
                       [class.pf-bka-chips--error]="showErr() && !selectedTime()"
                       [attr.aria-invalid]="showErr() && !selectedTime() ? true : null"
                       [attr.aria-describedby]="showErr() && !selectedTime() ? 'pf-bka-e-slot' : null"
                       (keydown)="onSlotKey($event)">
                    @for (s of visibleSlots(); track s.time) {
                      <button type="button" class="pf-bka-chip" role="radio"
                              [attr.aria-checked]="s.time === selectedTime()" [attr.aria-disabled]="!s.available ? true : null"
                              [attr.tabindex]="s.time === rovingSlot() ? 0 : -1" [attr.data-time]="s.time"
                              [attr.aria-label]="s.time + (s.available ? '' : ', full')"
                              (click)="s.available && selectTime(s.time)">
                        <span class="pf-bka-chip__t nd-num">{{ s.time }}</span>
                        @if (!s.available) { <span class="pf-bka-chip__full">Full</span> }
                        @else if (s.time === selectedTime()) {
                          <svg class="pf-bka-chip__ok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                        }
                      </button>
                    }
                  </div>
                }
                @if (showErr() && !selectedTime()) { <p class="pf-bka-err" id="pf-bka-e-slot">Pick a time slot.</p> }
                @else if (showErr() && slotFull()) { <p class="pf-bka-err" id="pf-bka-e-slot">That slot is full — pick another.</p> }
                <p class="pf-bka-legend" aria-hidden="true">
                  <span class="pf-bka-legend__k pf-bka-legend__k--free"></span>Available
                  <span class="pf-bka-legend__k pf-bka-legend__k--sel"></span>Selected
                  <span class="pf-bka-legend__k pf-bka-legend__k--full"></span>Full
                </p>
              }
            </div>
          </section>

          <!-- ── Column 3: DETAILS (tests · collection · notes) ── -->
          <section class="nd-card pf-bka-card pf-bka-details" aria-labelledby="pf-bka-l-details">
            <header class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3"/></svg>
              </span>
              <span class="nd-card__label" id="pf-bka-l-details">Details</span>
              <span class="nd-card__spacer"></span>
              <span class="pf-bka-opt">Optional</span>
            </header>
            <div class="nd-card__body pf-bka-dbody">
              <div class="nd-field pf-bka-tests">
                <label class="nd-field__lbl" for="pf-bka-tq">Tests</label>
                <span class="pf-bka-inputwrap">
                  <svg class="pf-bka-inputwrap__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                  <input #testSearchInput id="pf-bka-tq" type="text" class="nd-input" data-nav autocomplete="off" spellcheck="false"
                         role="combobox" aria-autocomplete="list" aria-controls="pf-bka-tlist"
                         [attr.aria-expanded]="testDropOpen()"
                         [attr.aria-activedescendant]="testDropOpen() && tHighlight() >= 0 ? 'pf-bka-t-' + tHighlight() : null"
                         placeholder="Code, name, short name or profile" [value]="testQuery()"
                         (input)="setTestQuery($any($event.target).value); tHighlight.set(0)" (focus)="onSearchFocus()" (blur)="onSearchBlur()"
                         (keydown.arrowDown)="moveTest($event, 1)" (keydown.arrowUp)="moveTest($event, -1)"
                         (keydown.escape)="testQuery.set('')" />
                </span>
                @if (testDropOpen()) {
                  <ul class="pf-bka-results pf-bka-results--float" id="pf-bka-tlist" role="listbox" aria-label="Tests" aria-multiselectable="true">
                    @for (t of filteredTests(); track t.id; let i = $index) {
                      <li>
                        <button type="button" class="pf-bka-result pf-bka-result--test" role="option" [id]="'pf-bka-t-' + i" tabindex="-1"
                                [attr.aria-selected]="i === tHighlight()" [attr.aria-checked]="isTestSelected(t.id)"
                                (mouseenter)="tHighlight.set(i)" (mousedown)="$event.preventDefault(); selectTest(t.id)">
                          <span class="pf-bka-result__check" aria-hidden="true">
                            @if (isTestSelected(t.id)) {
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                            }
                          </span>
                          <span class="pf-bka-result__code nd-num">{{ t.testCode || t.code }}</span>
                          <span class="pf-bka-result__name">{{ t.name }}@if (t.shortName) { <span class="pf-bka-result__short"> · {{ t.shortName }}</span> }</span>
                          <span class="pf-bka-result__price nd-num">{{ priceOf(t) | inr }}</span>
                        </button>
                      </li>
                    } @empty {
                      <li class="pf-bka-note">No tests match.</li>
                    }
                  </ul>
                }
                @if (selectedTests().length > 0) {
                  <ul class="pf-bka-picked-tests" aria-label="Tests booked">
                    @for (t of selectedTests(); track t.id) {
                      <li class="pf-bka-ptest">
                        <span class="pf-bka-ptest__name">{{ t.name }}</span>
                        <span class="pf-bka-ptest__price nd-num">{{ priceOf(t) | inr }}</span>
                        <button type="button" class="pf-bka-ptest__x" tabindex="-1" (click)="toggleTest(t.id)" [attr.aria-label]="'Remove ' + t.name" title="Remove">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                        </button>
                      </li>
                    }
                    <li class="pf-bka-ptest pf-bka-ptest--total">
                      <span class="pf-bka-ptest__name">{{ plural(selectedTests().length, 'test') }}</span>
                      <span class="pf-bka-ptest__price nd-num">{{ selectedTestsTotal() | inr }}</span>
                    </li>
                  </ul>
                }
              </div>

              <div class="nd-field">
                <span class="nd-field__lbl" id="pf-bka-l-coll">Collection</span>
                <div class="nd-seg pf-bka-coll" role="radiogroup" aria-labelledby="pf-bka-l-coll" data-nav (keydown)="onCollKey($event)">
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="collectionType() === 'walkin'"
                          [attr.tabindex]="collectionType() === 'walkin' ? 0 : -1" (click)="collectionType.set('walkin')">Walk-in (lab visit)</button>
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="collectionType() === 'home_collection'"
                          [attr.tabindex]="collectionType() === 'home_collection' ? 0 : -1" (click)="collectionType.set('home_collection')">Home collection</button>
                </div>
              </div>
              @if (collectionType() === 'home_collection') {
                <div class="pf-bka-home">
                  <label class="nd-field pf-bka-span">
                    <span class="nd-field__lbl">Address <span class="nd-dot-unpriced" aria-hidden="true"></span></span>
                    <input type="text" class="nd-input" data-nav placeholder="Patient address" [value]="hcAddress()" (input)="hcAddress.set($any($event.target).value)" />
                  </label>
                  <label class="nd-field">
                    <span class="nd-field__lbl">Pincode</span>
                    <input type="text" inputmode="numeric" class="nd-input nd-num" data-nav [value]="hcPincode()" (input)="hcPincode.set($any($event.target).value)" />
                  </label>
                  <label class="nd-field">
                    <span class="nd-field__lbl">Latitude</span>
                    <input type="text" inputmode="decimal" class="nd-input nd-num" data-nav placeholder="Optional" [value]="hcLat() ?? ''" (input)="setCoord('lat', $any($event.target).value)" />
                  </label>
                  <label class="nd-field">
                    <span class="nd-field__lbl">Longitude</span>
                    <input type="text" inputmode="decimal" class="nd-input nd-num" data-nav placeholder="Optional" [value]="hcLng() ?? ''" (input)="setCoord('lng', $any($event.target).value)" />
                  </label>
                  <p class="nd-field__hint pf-bka-span">The pincode (or coordinates) assigns the nearest agent automatically.</p>
                </div>
              }

              <label class="nd-field">
                <span class="nd-field__lbl">Notes</span>
                <textarea class="nd-input pf-bka-notes" data-nav rows="3" placeholder="Booking instructions or clinical notes"
                          [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea>
              </label>
              <p class="nd-field__hint">WhatsApp confirmation goes out automatically once booked.</p>
            </div>
          </section>
        </div>
      </div>

      @if (phone()) {
        <div class="nd-bottombar pf-bka-bar">
          <span class="nd-bottombar__info nd-num">{{ dateLabel() }}@if (selectedTime()) { · {{ selectedTime() }} }</span>
          <button type="button" class="nd-btn nd-btn--primary pf-bka-book press" [disabled]="saving()" (click)="attemptBook()">
            {{ saving() ? 'Booking…' : 'Book appointment' }}
          </button>
        </div>
      }
    </section>
    } @else {
    <section class="book-appt-page px-4 md:px-8 pt-4 pb-10 flex flex-col gap-3">
      <pf-screen-header
        eyebrow="Frontdesk · Appointments"
        title="Book appointment"
        subtitle="Pick a date and slot. WhatsApp confirmation queues automatically."
      >
      </pf-screen-header>

      <!-- Grid Layout Container for Desktop (3 columns) -->
      <div
        class="book-appt-grid grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch w-full"
      >
        <!-- CARD 1: Patient Selection & Date Picker (Spans 1 column on desktop) -->
        <div
          class="lg:col-span-1 bg-[var(--bg-card-solid)] border border-[var(--glass-border)] rounded-2xl p-6 flex flex-col gap-4 h-full overflow-hidden"
        >
          <!-- Step 1: Patient Picker -->
          <section class="flex flex-col min-h-0 shrink-0">
            <div class="flex items-center gap-2 mb-2">
              <span
                class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold"
                >1</span
              >
              <span
                class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]"
                >Patient</span
              >
            </div>
            @if (patient()) {
              <div
                class="flex items-center gap-4 p-4 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl hover:border-purple-500/30 transition-all duration-200"
              >
                <pf-avatar
                  [name]="patientName()"
                  [size]="40"
                  class="shrink-0"
                ></pf-avatar>
                <div class="min-w-0 flex-1">
                  <p
                    class="text-sm font-semibold text-[var(--text-primary)] truncate"
                  >
                    {{ formatPatient(patient()) }}
                  </p>
                  @if (patient()!.phone) {
                    <p
                      class="text-xs text-[var(--text-secondary)] mt-0.5 truncate"
                    >
                      <span
                        class="font-mono tracking-wider text-[var(--text-muted)]"
                        >{{ patient()!.phone }}</span
                      >
                    </p>
                  }
                </div>
                <button
                  type="button"
                  class="text-xs font-semibold text-purple-400 hover:text-purple-300 hover:underline px-2 py-1 shrink-0 bg-transparent border-0 cursor-pointer"
                  (click)="clearPatient()"
                >
                  Change
                </button>
              </div>
            } @else {
              <pf-patient-search
                placeholder="Search patient by name, MRN, phone..."
                (picked)="setPatient($event)"
                class="w-full"
              ></pf-patient-search>
            }
          </section>

          <!-- Step 2: Date Picker (Flatpickr inline) -->
          <section class="flex flex-col min-h-0 flex-1 justify-start">
            <div class="flex items-center gap-2 mb-2">
              <span
                class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold"
                >2</span
              >
              <span
                class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]"
                >Date</span
              >
            </div>

            <div
              class="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-1 flex justify-center min-h-0 w-full"
            >
              <div #flatpickrEl class="w-full"></div>
            </div>
          </section>
        </div>

        <!-- CARD 2: Time Slots, Tests Selection & Notes (Spans 1 column on desktop) -->
        <div
          class="lg:col-span-1 bg-[var(--bg-card-solid)] border border-[var(--glass-border)] rounded-2xl p-6 flex flex-col gap-5 h-full overflow-visible relative"
        >
          <!-- Step 3: Time slot -->
          <section class="flex flex-col min-h-0 shrink-0">
            <div class="flex items-center gap-2 mb-2 shrink-0">
              <span
                class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold"
                >3</span
              >
              <span
                class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]"
                >Time slot</span
              >
            </div>

            @if (loadingSlots()) {
              <div
                class="flex flex-col items-center justify-center py-6 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl"
              >
                <pf-loading-logo
                  size="sm"
                  color="purple"
                  [showDna]="false"
                  [showText]="true"
                  text="Loading slots…"
                ></pf-loading-logo>
              </div>
            } @else if (slots().length === 0) {
              <div
                class="flex items-center justify-center p-6 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-xs text-[var(--text-muted)]"
              >
                Branch is closed on this day (or all slots have passed).
              </div>
            } @else {
              <!-- Segmented glass control -->
              <div
                class="flex p-1 bg-[var(--bg-secondary)] border border-[var(--glass-border)] rounded-xl gap-1 mb-2 shrink-0"
              >
                <button
                  type="button"
                  class="flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer border-0 bg-transparent text-[var(--text-secondary)]"
                  [class.bg-[var(--bg-card-solid)]]="timePeriod() === 'morning'"
                  [class.text-[var(--text-primary)]]="
                    timePeriod() === 'morning'
                  "
                  [class.shadow-sm]="timePeriod() === 'morning'"
                  [class.text-[var(--text-secondary)]]="
                    timePeriod() !== 'morning'
                  "
                  [class.hover:text-[var(--text-primary)]]="
                    timePeriod() !== 'morning'
                  "
                  (click)="timePeriod.set('morning')"
                >
                  <span>Morning</span>
                  <span class="text-[9px] opacity-60 font-mono"
                    >({{ periodsWithSlots().morning }})</span
                  >
                </button>
                <button
                  type="button"
                  class="flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer border-0 bg-transparent text-[var(--text-secondary)]"
                  [class.bg-[var(--bg-card-solid)]]="
                    timePeriod() === 'afternoon'
                  "
                  [class.text-[var(--text-primary)]]="
                    timePeriod() === 'afternoon'
                  "
                  [class.shadow-sm]="timePeriod() === 'afternoon'"
                  [class.text-[var(--text-secondary)]]="
                    timePeriod() !== 'afternoon'
                  "
                  [class.hover:text-[var(--text-primary)]]="
                    timePeriod() !== 'afternoon'
                  "
                  (click)="timePeriod.set('afternoon')"
                >
                  <span>Afternoon</span>
                  <span class="text-[9px] opacity-60 font-mono"
                    >({{ periodsWithSlots().afternoon }})</span
                  >
                </button>
                <button
                  type="button"
                  class="flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer border-0 bg-transparent text-[var(--text-secondary)]"
                  [class.bg-[var(--bg-card-solid)]]="timePeriod() === 'evening'"
                  [class.text-[var(--text-primary)]]="
                    timePeriod() === 'evening'
                  "
                  [class.shadow-sm]="timePeriod() === 'evening'"
                  [class.text-[var(--text-secondary)]]="
                    timePeriod() !== 'evening'
                  "
                  [class.hover:text-[var(--text-primary)]]="
                    timePeriod() !== 'evening'
                  "
                  (click)="timePeriod.set('evening')"
                >
                  <span>Evening</span>
                  <span class="text-[9px] opacity-60 font-mono"
                    >({{ periodsWithSlots().evening }})</span
                  >
                </button>
                <button
                  type="button"
                  class="flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer border-0 bg-transparent text-[var(--text-secondary)]"
                  [class.bg-[var(--bg-card-solid)]]="timePeriod() === 'night'"
                  [class.text-[var(--text-primary)]]="timePeriod() === 'night'"
                  [class.shadow-sm]="timePeriod() === 'night'"
                  [class.text-[var(--text-secondary)]]="
                    timePeriod() !== 'night'
                  "
                  [class.hover:text-[var(--text-primary)]]="
                    timePeriod() !== 'night'
                  "
                  (click)="timePeriod.set('night')"
                >
                  <span>Night</span>
                  <span class="text-[9px] opacity-60 font-mono"
                    >({{ periodsWithSlots().night }})</span
                  >
                </button>
              </div>

              <!-- Slots grid container -->
              <div
                class="border border-[var(--glass-border)] rounded-xl bg-[var(--glass-bg)] p-3 overflow-y-auto max-h-[125px] shrink-0"
              >
                @if (visibleSlots().length === 0) {
                  <div
                    class="text-center py-4 text-xs text-[var(--text-muted)] h-full flex items-center justify-center"
                  >
                    No slots available in this period.
                  </div>
                } @else {
                  <div class="grid grid-cols-4 gap-2 pr-1">
                    @for (s of visibleSlots(); track s.time) {
                      <button
                        type="button"
                        class="py-2 rounded-lg text-xs font-mono font-bold border transition-all duration-150 flex flex-col items-center justify-center relative group cursor-pointer bg-transparent border-[var(--glass-border)] text-[var(--text-primary)]"
                        [class.bg-gradient-to-br]="s.time === selectedTime()"
                        [class.from-purple-600]="s.time === selectedTime()"
                        [class.to-pink-600]="s.time === selectedTime()"
                        [class.border-transparent]="s.time === selectedTime()"
                        [class.text-white]="s.time === selectedTime()"
                        [class.shadow-sm]="s.time === selectedTime()"
                        [class.bg-[var(--bg-card-solid)]]="
                          s.time !== selectedTime() && s.available
                        "
                        [class.border-[var(--glass-border)]]="
                          s.time !== selectedTime() && s.available
                        "
                        [class.text-[var(--text-primary)]]="
                          s.time !== selectedTime() && s.available
                        "
                        [class.hover:border-purple-500/40]="
                          s.time !== selectedTime() && s.available
                        "
                        [class.hover:bg-[var(--bg-hover)]]="
                          s.time !== selectedTime() && s.available
                        "
                        [disabled]="!s.available"
                        [class.opacity-30]="!s.available"
                        [class.cursor-not-allowed]="!s.available"
                        [class.bg-red-500/5]="!s.available"
                        [class.border-red-500/10]="!s.available"
                        (click)="selectTime(s.time)"
                      >
                        <span>{{ s.time }}</span>
                        @if (!s.available) {
                          <span
                            class="text-[8px] text-red-400 font-bold uppercase tracking-wider mt-0.5 scale-90"
                            >full</span
                          >
                        }
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </section>

          <!-- Step 4: Tests selection (Search + chips + absolute popup suggestions) -->
          <section
            class="flex flex-col relative overflow-visible flex-1 min-h-0"
          >
            <div class="flex items-center justify-between gap-2 mb-2 shrink-0">
              <div class="flex items-center gap-2">
                <span
                  class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold"
                  >4</span
                >
                <span
                  class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]"
                  >Tests
                  <span
                    class="text-[10px] text-[var(--text-muted)] lowercase font-normal"
                    >(optional)</span
                  ></span
                >
              </div>
              @if (selectedTestIds().length > 0) {
                <span
                  class="text-[10px] font-bold px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full border border-purple-500/20 shrink-0"
                >
                  {{ selectedTestIds().length }} picked
                </span>
              }
            </div>

            <!-- Selected test chips -->
            @if (selectedTests().length > 0) {
              <!-- Selected test chips: vertical list, dynamic height with scrolling -->
              <div
                class="flex flex-col gap-1.5 mb-3 overflow-y-auto max-h-[120px] shrink-0 pr-1"
              >
                @for (t of selectedTests(); track t.id) {
                  <span
                    class="inline-flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg text-xs text-[var(--text-primary)] font-medium w-full min-w-0"
                  >
                    <span class="truncate flex-1 min-w-0 text-[11px]">{{
                      t.name
                    }}</span>
                    <button
                      type="button"
                      class="text-[var(--text-muted)] hover:text-red-400 transition-colors p-0.5 bg-transparent border-0 cursor-pointer"
                      (click)="toggleTest(t.id)"
                      title="Remove"
                    >
                      <svg
                        class="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                }
              </div>
            }

            <!-- Search input container -->
            <div class="relative shrink-0">
              <div
                class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                #testSearchInput
                type="text"
                class="w-full pl-10 pr-4 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all duration-200"
                placeholder="Search tests by code, name, short name, profile..."
                [value]="testQuery()"
                (input)="setTestQuery($any($event.target).value)"
                (focus)="onSearchFocus()"
                (blur)="onSearchBlur()"
              />

              <!-- Floating Suggestions Dropdown (overlaying on top of notes, etc.) -->
              @if (
                testSearchFocused() &&
                testQuery().trim() !== "" &&
                filteredTests().length > 0
              ) {
                <div
                  class="absolute left-0 right-0 z-50 mt-1 max-h-[220px] overflow-y-auto bg-[var(--bg-card-solid)] border border-[var(--glass-border)] rounded-xl shadow-2xl backdrop-blur-lg pr-1"
                >
                  <ul class="py-1 list-none m-0 p-0">
                    @for (t of filteredTests(); track t.id) {
                      <li>
                        <button
                          type="button"
                          class="w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors bg-transparent border-0 cursor-pointer"
                          [class.bg-purple-500/10]="isTestSelected(t.id)"
                          [class.text-purple-400]="isTestSelected(t.id)"
                          [class.hover:bg-[var(--bg-hover)]]="
                            !isTestSelected(t.id)
                          "
                          [class.text-[var(--text-primary)]]="
                            !isTestSelected(t.id)
                          "
                          (mousedown)="
                            $event.preventDefault(); selectTest(t.id)
                          "
                        >
                          <div class="flex items-center gap-2 min-w-0 flex-1">
                            @if (isTestSelected(t.id)) {
                              <svg
                                class="w-3.5 h-3.5 text-purple-500 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="3"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            }
                            <span class="truncate font-medium text-[11px]"
                              >{{ t.testCode }} {{ t.name }} ({{
                                t.shortName
                              }})</span
                            >
                          </div>
                          @if (t.code) {
                            <span
                              class="font-mono text-[9px] text-[var(--text-tertiary)] shrink-0 ml-2 bg-[var(--glass-bg)] px-1.5 py-0.5 rounded border border-[var(--glass-border)]"
                            >
                              {{ t.code }}
                            </span>
                          }
                        </button>
                      </li>
                    }
                  </ul>
                </div>
              } @else if (testSearchFocused() && testQuery().trim() !== "") {
                <div
                  class="absolute left-0 right-0 z-50 mt-1 p-3 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-card-solid)] border border-[var(--glass-border)] rounded-xl shadow-2xl"
                >
                  No tests match.
                </div>
              }
            </div>
          </section>

          <!-- Collection type -->
          <section class="flex flex-col shrink-0">
            <div class="flex items-center gap-2 mb-2">
              <span
                class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 12l9-9 9 9M5 10v10h14V10" />
                </svg>
              </span>
              <span
                class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]"
                >Collection</span
              >
            </div>
            <div class="flex gap-2 mb-2">
              <button
                type="button"
                class="flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition"
                [style.borderColor]="
                  collectionType() === 'walkin'
                    ? '#a855f7'
                    : 'var(--input-border)'
                "
                [style.color]="
                  collectionType() === 'walkin'
                    ? '#d8b4fe'
                    : 'var(--text-secondary)'
                "
                (click)="collectionType.set('walkin')"
              >
                Walk-in (lab visit)
              </button>
              <button
                type="button"
                class="flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition"
                [style.borderColor]="
                  collectionType() === 'home_collection'
                    ? '#a855f7'
                    : 'var(--input-border)'
                "
                [style.color]="
                  collectionType() === 'home_collection'
                    ? '#d8b4fe'
                    : 'var(--text-secondary)'
                "
                (click)="collectionType.set('home_collection')"
              >
                Home collection
              </button>
            </div>
            @if (collectionType() === "home_collection") {
              <input
                type="text"
                class="w-full p-3 mb-2 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] outline-none focus:border-purple-500"
                placeholder="Patient address (required)"
                [value]="hcAddress()"
                (input)="hcAddress.set($any($event.target).value)"
              />
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  inputmode="numeric"
                  class="p-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] outline-none focus:border-purple-500"
                  placeholder="Pincode"
                  [value]="hcPincode()"
                  (input)="hcPincode.set($any($event.target).value)"
                />
                <input
                  type="number"
                  step="0.0001"
                  class="p-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] outline-none focus:border-purple-500"
                  placeholder="Lat (opt)"
                  [value]="hcLat()"
                  (input)="hcLat.set($any($event.target).valueAsNumber || null)"
                />
                <input
                  type="number"
                  step="0.0001"
                  class="p-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] outline-none focus:border-purple-500"
                  placeholder="Lng (opt)"
                  [value]="hcLng()"
                  (input)="hcLng.set($any($event.target).valueAsNumber || null)"
                />
              </div>
              <p class="text-[10px] mt-1 text-[var(--text-muted)]">
                Pincode (or coordinates) auto-assigns the nearest agent.
                Coordinates are optional.
              </p>
            }
          </section>

          <!-- Step 5: Notes -->
          <section class="flex flex-col shrink-0">
            <div class="flex items-center gap-2 mb-2">
              <span
                class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold"
                >5</span
              >
              <span
                class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]"
                >Notes
                <span
                  class="text-[10px] text-[var(--text-muted)] lowercase font-normal"
                  >(optional)</span
                ></span
              >
            </div>
            <textarea
              rows="4"
              class="w-full p-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none resize-none h-[88px]"
              placeholder="Enter any booking instructions or clinical notes..."
              [value]="notes()"
              (input)="notes.set($any($event.target).value)"
            ></textarea>
          </section>
        </div>

        <!-- CARD 3: Appointment Summary & Actions (Spans 1 column on desktop) -->
        <section
          class="lg:col-span-1 bg-[var(--bg-card-solid)] border border-[var(--glass-border)] rounded-2xl p-6 flex flex-col h-full"
        >
          <h3
            class="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5 pb-2 border-b border-[var(--glass-border)]"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            Appointment Summary
          </h3>

          <div
            class="flex flex-col gap-4 text-xs flex-1 pt-4 min-h-0 overflow-hidden"
          >
            <!-- Patient info summary -->
            <div
              class="flex justify-between items-start border-b border-[var(--glass-border)] pb-3"
            >
              <span class="text-[var(--text-secondary)] font-medium"
                >Patient</span
              >
              <div class="text-right">
                @if (patient()) {
                  <span class="font-semibold text-[var(--text-primary)]">{{
                    formatPatient(patient())
                  }}</span>
                } @else {
                  <span class="text-[var(--text-muted)] italic"
                    >No patient selected</span
                  >
                }
              </div>
            </div>

            <!-- Date & Slot summary -->
            <div
              class="flex justify-between items-center border-b border-[var(--glass-border)] pb-3"
            >
              <span class="text-[var(--text-secondary)] font-medium"
                >Schedule</span
              >
              <div class="text-right">
                <span class="font-semibold text-[var(--text-primary)]">{{
                  selectedDate() | date: "EEE, dd MMM yyyy"
                }}</span>
                @if (selectedTime()) {
                  <span
                    class="ml-1.5 px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded text-[10px] font-mono font-bold"
                    >{{ selectedTime() }}</span
                  >
                } @else {
                  <p class="text-[10px] text-[var(--text-muted)] mt-0.5 italic">
                    Pick a time slot
                  </p>
                }
              </div>
            </div>

            <!-- Tests attached summary: fills remaining space, scrolls only when overflowing -->
            <div
              class="flex justify-between items-start flex-1 min-h-0 overflow-hidden"
            >
              <span class="text-[var(--text-secondary)] font-medium"
                >Draft Tests</span
              >
              <div class="text-right flex flex-col items-end">
                @if (selectedTests().length > 0) {
                  <span class="font-semibold text-[var(--text-primary)]"
                    >{{ selectedTests().length }} test(s) attached</span
                  >
                  <!-- Show all tests; scrolls only when overflowing available space -->
                  <div
                    class="flex flex-col gap-1 mt-1 text-[10px] text-[var(--text-muted)] font-mono w-full text-right font-semibold overflow-y-auto flex-1 min-h-0"
                  >
                    @for (t of selectedTests(); track t.id) {
                      <div class="inline-flex items-center justify-end gap-1.5">
                        <span>{{ t.name }}</span>
                        <span class="nd-num">({{ priceOf(t) | inr }})</span>
                      </div>
                    }
                  </div>
                  <div
                    class="mt-3 text-sm font-bold text-[var(--text-primary)]"
                  >
                    Total Price:
                    <span class="text-gradient"
                      >{{ selectedTestsTotal() | inr }}</span
                    >
                  </div>
                } @else {
                  <span class="text-[var(--text-muted)] italic"
                    >No tests attached</span
                  >
                }
              </div>
            </div>
          </div>

          <!-- Error Message if any -->
          @if (errorMsg()) {
            <div
              class="flex items-center gap-1.5 text-xs text-red-400 font-semibold pt-2 border-t border-[var(--glass-border)]"
            >
              <svg
                class="w-4 h-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>{{ errorMsg() }}</span>
            </div>
          }

          <!-- Action buttons pinned to bottom of card -->
          <div
            class="flex flex-col sm:flex-row gap-2.5 pt-4 mt-auto border-t border-[var(--glass-border)]"
          >
            <button
              type="button"
              class="flex-1 py-2.5 text-xs font-semibold rounded-xl border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] bg-transparent cursor-pointer transition-colors"
              (click)="back()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="flex-[2] py-2.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white disabled:opacity-50 disabled:pointer-events-none border-0 cursor-pointer transition-all"
              [disabled]="!canSubmit() || saving()"
              (click)="submit()"
            >
              {{ saving() ? "Booking…" : "Book" }}
            </button>
          </div>
        </section>
      </div>
    </section>
    }
  `,
  styles: [
    BOOK_APPOINTMENT_ND_STYLES,
    `
      :host {
        display: block;
      }

      /* Hide scrollbar on date strip while keeping scrollability */
      .date-strip-scroll::-webkit-scrollbar {
        display: none;
      }
      .date-strip-scroll {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }

      /* Slim scrollbars for test list and other scrollable areas */
      :host ::-webkit-scrollbar {
        width: 3px;
        height: 3px;
      }

      :host ::-webkit-scrollbar-track {
        background: transparent;
      }

      :host ::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb, rgba(139, 92, 246, 0.3));
        border-radius: 4px;
      }

      :host ::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover, rgba(139, 92, 246, 0.6));
      }

      /* Flatpickr layout and theme styling overrides to center and stretch it to 100% width */
      ::ng-deep {
        .flatpickr-calendar.inline {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 100% !important;
          box-shadow: none !important;
          background: transparent !important;
          border: none !important;
          display: block !important;
          font-family: "Outfit", sans-serif !important;
        }
        .flatpickr-innerContainer {
          width: 100% !important;
          display: block !important;
        }
        .flatpickr-rContainer {
          width: 100% !important;
          max-width: 100% !important;
          display: block !important;
        }
        .flatpickr-days {
          width: 100% !important;
          max-width: 100% !important;
          display: block !important;
        }
        .dayContainer {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 100% !important;
          display: flex !important;
          flex-wrap: wrap !important;
          justify-content: space-between !important;
        }
        .flatpickr-day {
          width: 14.28% !important;
          max-width: 14.28% !important;
          height: auto !important;
          aspect-ratio: 1 !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          line-height: 1 !important;
          margin: 1px 0 !important;
          box-sizing: border-box !important;
          color: var(--text-primary) !important;
          border-radius: 8px !important;
          transition: all 0.15s ease !important;
          border: 1px solid transparent !important;
          font-weight: 500 !important;
        }
        .flatpickr-day:hover,
        .flatpickr-day:focus {
          background: var(--bg-hover) !important;
          color: var(--text-primary) !important;
          border-color: transparent !important;
        }
        .flatpickr-day.today {
          border-color: var(--color-primary) !important;
          color: var(--text-primary) !important;
        }
        .flatpickr-day.today:hover {
          background: var(--bg-hover) !important;
          color: var(--text-primary) !important;
        }
        .flatpickr-day.selected {
          background: var(--gradient-primary) !important;
          border-color: transparent !important;
          color: #ffffff !important;
          box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4) !important;
        }
        .flatpickr-day.prevMonthDay,
        .flatpickr-day.nextMonthDay {
          color: var(--text-muted) !important;
          opacity: 0.5 !important;
        }
        .flatpickr-day.disabled,
        .flatpickr-day.disabled:hover {
          color: var(--text-muted) !important;
          background: transparent !important;
          cursor: not-allowed !important;
          opacity: 0.25 !important;
        }
        .flatpickr-weekdaycontainer {
          display: flex !important;
          width: 100% !important;
        }
        span.flatpickr-weekday {
          flex: 1 !important;
          text-align: center !important;
          max-width: 14.28% !important;
          color: var(--text-tertiary) !important;
          font-weight: 700 !important;
          font-size: 11px !important;
        }
        .flatpickr-months {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          width: 100% !important;
        }
        .flatpickr-month {
          flex: 1 !important;
          width: 100% !important;
          color: var(--text-primary) !important;
          fill: var(--text-primary) !important;
        }
        .flatpickr-current-month {
          font-weight: 600 !important;
          color: var(--text-primary) !important;
          font-size: 14px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 4px !important;
        }
        .flatpickr-current-month .numInputWrapper {
          width: 65px !important;
        }
        .flatpickr-current-month input.cur-year {
          font-weight: 600 !important;
          color: var(--text-primary) !important;
          background: transparent !important;
          border: none !important;
        }
        .flatpickr-current-month .flatpickr-monthDropdown-months {
          font-weight: 600 !important;
          color: var(--text-primary) !important;
          background: var(--bg-card-solid) !important;
          border: 1px solid var(--glass-border) !important;
          border-radius: 6px !important;
          padding: 2px 4px !important;
          outline: none !important;
        }
        .flatpickr-prev-month,
        .flatpickr-next-month {
          color: var(--text-primary) !important;
          fill: var(--text-primary) !important;
          padding: 4px !important;
        }
        .flatpickr-prev-month:hover svg,
        .flatpickr-next-month:hover svg {
          fill: var(--color-primary) !important;
        }
      }

      /* ──────────────────────────────────────────────────────────
         CROSS-PLATFORM RESPONSIVE OVERRIDES (additive only).
         Desktop-web ≥1280px is intentionally untouched: every rule
         below is gated to a sub-desktop width or to coarse pointers.
         All selectors are scoped to this page (:host / page-root).
         ────────────────────────────────────────────────────────── */

      /* iPad band (641–1279px): the page only had grid-cols-1 until the
         lg breakpoint (1024px), so 641–1023px rendered a single tall
         column and wasted the tablet width. Use two columns here so
         Card 1 + Card 2 sit side-by-side and Card 3 (summary) spans the
         full width beneath them. Does not affect ≥1280px (3-col lg). */
      @media (min-width: 641px) and (max-width: 1023px) {
        :host .book-appt-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
        /* Summary/actions card spans the full row under the two cards. */
        :host .book-appt-grid > :nth-child(3) {
          grid-column: 1 / -1 !important;
        }
        /* Cards no longer need to stretch to a shared row height when
           the summary is full-width below — let them size to content. */
        :host .book-appt-grid {
          align-items: start !important;
        }
      }

      /* Phone (≤640px): single column already (grid-cols-1). Stop iOS
         from auto-zooming on focus by ensuring form controls are ≥16px.
         (Note: input font-size guards are global, but the inputs here are
         text-xs, so we keep an explicit page-scoped guard.) These element
         selectors are scoped under :host so they cannot leak to shared
         primitives or other pages. */
      @media (max-width: 640px) {
        :host input[type="text"],
        :host input[type="number"],
        :host textarea {
          font-size: 16px !important;
        }
        /* The card paddings (p-6) eat a lot of width on a narrow phone;
           trim them so content isn't cramped. Scoped to this page. */
        :host .book-appt-grid > * {
          padding: 1rem !important;
        }
        :host .book-appt-grid {
          gap: 1rem !important;
        }
        /* Segmented period control: 4 labels ("Morning/Afternoon/Evening/
           Night" + count) cannot fit a narrow phone row, so each child is
           crushed and the count text overlaps the label. Wrap to 2x2 and
           give each pill a min-width so labels stay legible. */
        :host .book-appt-grid .flex.p-1.gap-1 {
          flex-wrap: wrap !important;
        }
        :host .book-appt-grid .flex.p-1.gap-1 > button {
          flex: 1 1 calc(50% - 0.25rem) !important;
        }
        /* PHONE: the floating bottom-nav pill overlaps the in-flow
           Cancel/Book action row at the foot of the summary card, so the
           primary "Book" button can't be reached/tapped. Pad the page
           foot by (action-row height + the pill's reserved height,
           --tab-nav-total-height) so the content scrolls fully clear and
           the button sits above the pill. Phone-only; ≥641px untouched. */
        :host .book-appt-page {
          padding-bottom: calc(64px + var(--tab-nav-total-height)) !important;
        }
      }

      /* Touch devices (coarse pointer, any size): give the primary,
         block-level tap targets a comfortable ≥44px hit area without
         changing their visual size on mouse/desktop. Inline affordances
         (chip-remove X, "Change", patient-row actions) are intentionally
         left alone so a 44px box doesn't distort the rows that contain
         them. Scoped to this page only via :host + page-root class. */
      @media (pointer: coarse) {
        /* Segmented period control (direct children of the .flex p-1 row),
           the slot grid cells, collection-type pills, and the bottom
           action bar (Cancel / Book): all are block buttons that own their
           row, safe to enlarge. We DON'T target the patient "Change" row
           (.flex.items-center.gap-4 > button) which would push the avatar
           row to 44px and distort it. */
        :host .book-appt-grid .grid > button,
        :host .book-appt-grid .flex.p-1.gap-1 > button,
        :host .book-appt-grid .flex.gap-2 > button,
        :host .book-appt-grid .flex.gap-2\\.5 > button {
          min-height: 44px;
        }
        /* The slot grid above caps its scroll area at 125px, which — once
           each slot button becomes 44px tall (rule above) — only reveals
           ~2 rows of times before scrolling. Raise the cap on touch so
           several rows are visible at once. Desktop (fine pointer) keeps
           the original 125px. Scoped to this page's unique slot container. */
        :host .book-appt-grid .overflow-y-auto.max-h-\\[125px\\] {
          max-height: 220px !important;
        }
      }
    `,
  ],
})
export class BookAppointmentComponent implements OnInit, OnDestroy {
  readonly flatpickrEl = viewChild<ElementRef<HTMLDivElement>>("flatpickrEl");
  readonly testSearchInput =
    viewChild<ElementRef<HTMLInputElement>>("testSearchInput");
  private fpInstance: any = null;

  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly locationSvc = inject(Location);
  private readonly bookingSvc = inject(AppointmentBookingService);

  protected readonly dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ── New design (ND-PATTERN §21): one keyboard-first page ────────────────
  protected readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostEl = inject(ElementRef<HTMLElement>, { optional: true });
  private host(): HTMLElement { return (this.hostEl?.nativeElement as HTMLElement | undefined) ?? document.createElement('div'); }
  /** Web pointer: the patient search takes focus on arrival (never on touch). */
  protected readonly web = webPointerSignal();
  /** ≤640px: the primary moves to a full-width bottom bar above the navbar. */
  readonly phone = signal(false);
  protected readonly plural = plural;
  protected readonly todayIso = format(new Date(), "yyyy-MM-dd");
  readonly patientInput = viewChild<ElementRef<HTMLInputElement>>("patientInput");
  protected readonly periods: Array<{ id: SlotPeriod; label: string }> = [
    { id: "morning", label: "Morning" }, { id: "afternoon", label: "Afternoon" },
    { id: "evening", label: "Evening" }, { id: "night", label: "Night" },
  ];
  /** Book was pressed with something missing → inline field errors show. */
  protected readonly showErr = signal(false);
  // Patient pick (same lookup as the shared patient search).
  protected readonly pQuery = signal("");
  protected readonly pResults = signal<Patient[]>([]);
  protected readonly pLoading = signal(false);
  protected readonly pHighlight = signal(-1);
  private pTimer?: ReturnType<typeof setTimeout>;
  // Tests dropdown highlight (↑/↓ + Enter adds).
  protected readonly tHighlight = signal(0);
  protected readonly testDropOpen = computed(() => this.testSearchFocused() && this.testQuery().trim() !== "");

  protected readonly dateLabel = computed(() => {
    const d = this.selectedDate();
    return d ? format(parse(d, "yyyy-MM-dd", new Date()), "EEE d MMM yyyy") : "—";
  });
  /** Today + the next 6 days as one-tap chips beside the typed date. */
  protected readonly quickDays = computed(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(t, i);
      return { iso: format(d, "yyyy-MM-dd"), dow: i === 0 ? "Today" : format(d, "EEE"), n: format(d, "d"),
               today: i === 0, long: format(d, "EEEE d MMMM yyyy") };
    });
  });
  /** The chip that holds the slot grid's single Tab stop. */
  protected readonly rovingSlot = computed(() => {
    const list = this.visibleSlots();
    const i = rovingIndex(list, this.selectedTime());
    return i >= 0 ? list[i].time : "";
  });
  /** The picked time exists but is already full. */
  protected readonly slotFull = computed(() => {
    const t = this.selectedTime();
    const s = t ? this._slots().find(x => x.time === t) : undefined;
    return !!s && !s.available;
  });

  protected nameOf(p: Patient): string { return patientDisplayName(p) || "Patient"; }
  /** "22/M · AA0006" — the name has its own emphasis. */
  protected patientMeta(p: Patient): string { return formatPatientMeta(p); }

  onPatientQuery(v: string) {
    this.pQuery.set(v);
    clearTimeout(this.pTimer);
    const q = v.trim();
    if (q.length < 2) { this.pResults.set([]); this.pLoading.set(false); this.pHighlight.set(-1); return; }
    this.pLoading.set(true);
    this.pTimer = setTimeout(() => {
      this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q)}&limit=10`).subscribe({
        next: (list) => { this.pResults.set(list ?? []); this.pLoading.set(false); this.pHighlight.set(list?.length ? 0 : -1); },
        error: () => { this.pResults.set([]); this.pLoading.set(false); },
      });
    }, 220);
  }
  movePatient(e: Event, delta: number) {
    const n = this.pResults().length;
    if (!n) return;
    e.preventDefault();
    const i = this.pHighlight();
    this.pHighlight.set(i < 0 ? (delta > 0 ? 0 : n - 1) : (i + delta + n) % n);
  }
  pickPatient(p: Patient) {
    this.setPatient(p);
    this.pQuery.set(""); this.pResults.set([]); this.pHighlight.set(-1);
    // Keyboard-first: straight on to the date.
    setTimeout(() => this.focusNav(this.navEls().findIndex(el => el.matches("pf-nd-date"))));
  }
  changePatient() {
    this.clearPatient();
    setTimeout(() => this.patientInput()?.nativeElement.focus());
  }
  moveTest(e: Event, delta: number) {
    const n = this.filteredTests().length;
    if (!this.testDropOpen() || !n) return;
    e.preventDefault();
    this.tHighlight.set((Math.max(0, this.tHighlight()) + delta + n) % n);
  }
  setCoord(which: "lat" | "lng", v: string) {
    const n = parseFloat(String(v).replace(",", "."));
    (which === "lat" ? this.hcLat : this.hcLng).set(Number.isFinite(n) ? n || null : null);
  }

  /** Book: every problem shows at its field (and focus goes to the first);
   *  a complete form books exactly as before. */
  attemptBook() {
    if (this.saving()) return;
    this.showErr.set(true);
    if (this.canSubmit()) { this.submit(); return; }
    setTimeout(() => {
      const root = this.host();
      const bad = !this.patient()
        ? root.querySelector<HTMLElement>(".pf-bka-pq")
        : root.querySelector<HTMLElement>('.pf-bka-chip[tabindex="0"]');
      bad?.focus();
      bad?.scrollIntoView?.({ block: "nearest" });
    });
  }

  /** Keyboard-first (like registration): Enter = the next field, a textarea
   *  keeps Enter, Ctrl/⌘+Enter books from anywhere. */
  onFormKey(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.defaultPrevented || e.isComposing) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.attemptBook(); return; }
    const t = e.target as HTMLElement;
    if (t.tagName === "TEXTAREA") return;
    if (t.classList.contains("pf-bka-pq")) {
      e.preventDefault();
      const p = this.pResults()[this.pHighlight()];
      if (p) this.pickPatient(p);
      return;
    }
    if (t.id === "pf-bka-tq" && this.testDropOpen()) {
      e.preventDefault();
      const tt = this.filteredTests()[this.tHighlight()];
      if (tt) this.selectTest(tt.id);
      return;
    }
    // Plain buttons (Change, remove) keep their own Enter.
    if (t.tagName === "BUTTON" && !t.closest(".pf-bka-coll")) return;
    const els = this.navEls();
    const i = els.findIndex(el => el === t || el.contains(t));
    if (i < 0) return;
    e.preventDefault();
    this.focusNav(i + 1);
  }
  /** The slot grid (one Tab stop): arrows move, Enter / Space picks and
   *  moves on to the next field. */
  onSlotKey(e: KeyboardEvent) {
    const chips = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".pf-bka-chip"));
    const i = chips.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    const cols = Math.max(1, getComputedStyle(e.currentTarget as HTMLElement).gridTemplateColumns.split(" ").filter(Boolean).length);
    const to = (j: number) => { e.preventDefault(); chips[Math.max(0, Math.min(chips.length - 1, j))]?.focus(); };
    switch (e.key) {
      case "ArrowRight": return to(i + 1);
      case "ArrowLeft": return to(i - 1);
      case "ArrowDown": return to(i + cols);
      case "ArrowUp": return to(i - cols);
      case "Home": return to(0);
      case "End": return to(chips.length - 1);
      case "Enter":
      case " ": {
        e.preventDefault();
        const time = chips[i].getAttribute("data-time") ?? "";
        const s = this.visibleSlots().find(x => x.time === time);
        if (!s?.available) return;
        this.selectTime(time);
        const els = this.navEls();
        this.focusNav(els.findIndex(el => el.classList.contains("pf-bka-chips")) + 1);
      }
    }
  }
  /** Walk-in / Home collection radio group: arrows switch. */
  onCollKey(e: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = this.collectionType() === "walkin" ? "home_collection" : "walkin";
    this.collectionType.set(e.key === "Home" ? "walkin" : e.key === "End" ? "home_collection" : next);
    setTimeout(() => this.host()
      .querySelector<HTMLElement>('.pf-bka-coll [aria-checked="true"]')?.focus());
  }
  private navEls(): HTMLElement[] {
    return Array.from(this.host().querySelectorAll<HTMLElement>("[data-nav]"));
  }
  private focusNav(i: number) {
    const el = nextFocus(this.navEls(), i);
    el?.focus();
  }

  // Booking state.
  protected readonly patient = signal<Patient | null>(null);
  protected readonly selectedDate = signal<string>(
    format(new Date(), "yyyy-MM-dd"),
  );
  protected readonly selectedTime = signal<string>("");
  protected readonly notes = signal<string>("");
  // Collection type + home-collection details.
  protected readonly collectionType = signal<"walkin" | "home_collection">(
    "walkin",
  );
  protected readonly hcAddress = signal<string>("");
  protected readonly hcPincode = signal<string>("");
  protected readonly hcLat = signal<number | null>(null);
  protected readonly hcLng = signal<number | null>(null);
  protected readonly calendarMonth = signal<Date>(startOfMonth(new Date()));
  protected readonly selectedTestIds = signal<string[]>([]);
  protected readonly testQuery = signal<string>("");

  // UI state
  protected readonly timePeriod = signal<
    "morning" | "afternoon" | "evening" | "night"
  >("morning");
  protected readonly testSearchFocused = signal<boolean>(false);

  // Data state
  protected readonly _config = signal<AppointmentConfigDto | null>(null);
  protected readonly _slots = signal<SlotInfo[]>([]);
  protected readonly _tests = signal<Test[]>([]);
  protected readonly _saving = signal(false);
  protected readonly _errorMsg = signal<string | null>(null);
  protected readonly _dayAppointments = signal<Appointment[]>([]);
  protected readonly _loadingAppointments = signal<boolean>(false);

  readonly slots = this._slots.asReadonly();

  readonly periodsWithSlots = computed(() => {
    const all = this._slots();
    const counts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    for (const s of all) {
      counts[getTimePeriod(s.time)]++;
    }
    return counts;
  });

  readonly visibleSlots = computed(() => {
    const all = this._slots();
    const period = this.timePeriod();
    return all.filter((s) => getTimePeriod(s.time) === period);
  });

  readonly loadingSlots = computed(
    () => this._config() === null || this._loadingAppointments(),
  );
  readonly saving = this._saving.asReadonly();
  readonly errorMsg = this._errorMsg.asReadonly();

  readonly patientName = computed(() => patientDisplayName(this.patient()));
  protected readonly formatPatient = formatPatientInfo;
  readonly canSubmit = computed(() => {
    if (!this.patient() || !this.selectedDate() || !this.selectedTime()) {
      return false;
    }
    const sel = normalizeTimeStr(this.selectedTime()) ?? this.selectedTime();
    const list = this._slots();
    const match = list.find(
      (s) => (normalizeTimeStr(s.time) ?? s.time) === sel,
    );
    return !match || match.available;
  });

  readonly filteredTests = computed<Test[]>(() => {
    // Not offered at this branch (pricing table) → not bookable either.
    const active = this._tests().filter((t) => t.isActive && isOffered(t));
    return filterTestList(active, this.testQuery()).slice(0, 25);
  });

  readonly selectedTests = computed<Test[]>(() => {
    const ids = new Set(this.selectedTestIds());
    return this._tests().filter((t) => ids.has(t.id));
  });

  readonly selectedTestsTotal = computed<number>(() =>
    this.selectedTests().reduce((sum, t) => sum + effectivePrice(t), 0),
  );

  /** The acting branch's price for a test (₹1 when nobody has priced it). */
  priceOf(t: Test): number { return effectivePrice(t); }
  /** Still at the ₹1 default (data only — the UI shows just the price). */
  isPriceDefault(t: Test): boolean { return isPriceDefault(t); }
  isNotPriced(id: string): boolean { return isPriceDefault(this._tests().find(t => t.id === id)); }

  readonly headerSubtitle = computed(() => {
    const d = this.selectedDate();
    const t = this.selectedTime();
    if (!d) return "Pick a patient, day, and time slot.";
    const day = parse(d, "yyyy-MM-dd", new Date());
    const stamp = format(day, "EEE, dd MMM yyyy");
    return t ? `${stamp} · ${t}` : stamp;
  });

  readonly daysInMonthList = computed(() => {
    const month = this.calendarMonth();
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const days: Array<{
      iso: string;
      day: number;
      dayName: string;
      today: boolean;
      past: boolean;
    }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const cell = new Date(d);
      days.push({
        iso: format(cell, "yyyy-MM-dd"),
        day: cell.getDate(),
        dayName: format(cell, "EEE"),
        today: isSameDay(cell, new Date()),
        past: cell.getTime() < today.getTime(),
      });
    }
    return days;
  });

  readonly calCells = computed(() => {
    const month = this.calendarMonth();
    const ws = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const we = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const cells: Array<{
      iso: string;
      day: number;
      outside: boolean;
      today: boolean;
      past: boolean;
    }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let d = new Date(ws); d <= we; d.setDate(d.getDate() + 1)) {
      const cell = new Date(d);
      cells.push({
        iso: format(cell, "yyyy-MM-dd"),
        day: cell.getDate(),
        outside: !isSameMonth(cell, month),
        today: isSameDay(cell, new Date()),
        past: cell.getTime() < today.getTime(),
      });
    }
    return cells;
  });

  constructor() {
    if (typeof window !== "undefined" && window.matchMedia) {
      const m = window.matchMedia("(max-width: 640px)");
      this.phone.set(!!m.matches);
      const on = (e: MediaQueryListEvent) => this.phone.set(e.matches);
      try { m.addEventListener?.("change", on); this.destroyRef.onDestroy(() => m.removeEventListener?.("change", on)); } catch { /* old engines */ }
    }
    // New design, web only: the patient search has focus on arrival.
    let autofocused = false;
    effect(() => {
      const el = this.patientInput()?.nativeElement;
      if (!el || autofocused || !this.web() || !this.theme.isNewDesign()) return;
      autofocused = true;
      setTimeout(() => el.focus());
    });

    effect(() => {
      const el = this.flatpickrEl()?.nativeElement;
      if (el) {
        this.initFlatpickr(el);
      }
    });

    effect(() => {
      const date = this.selectedDate();
      if (this.fpInstance && date) {
        try {
          const fpDate = format(this.fpInstance.selectedDates[0], "yyyy-MM-dd");
          if (fpDate !== date) {
            this.fpInstance.setDate(date, false);
          }
        } catch {
          // ignore parsing error if date array is empty or partial
        }
      }
    });

    effect(() => {
      const date = this.selectedDate();
      if (date) {
        this.fetchAppointmentsForDate(date);
      }
    });
  }

  private initFlatpickr(el: HTMLElement) {
    if (this.fpInstance) {
      this.fpInstance.destroy();
    }
    this.fpInstance = flatpickr(el, {
      inline: true,
      defaultDate: this.selectedDate(),
      minDate: "today",
      dateFormat: "Y-m-d",
      onChange: (selectedDates) => {
        if (selectedDates.length > 0) {
          const iso = format(selectedDates[0], "yyyy-MM-dd");
          this.selectDate(iso);
        }
      },
    });
  }

  ngOnDestroy() {
    if (this.fpInstance) {
      this.fpInstance.destroy();
    }
  }

  ngOnInit() {
    this.loadTestsIfNeeded();
    this.loadConfig();

    // Prefill patient, date, and time from query params.
    const pid = this.route.snapshot.queryParamMap.get("patientId");
    const dateParam = this.route.snapshot.queryParamMap.get("date");
    const timeParam = this.route.snapshot.queryParamMap.get("time");

    if (dateParam) {
      this.selectedDate.set(dateParam);
      this.calendarMonth.set(
        startOfMonth(parse(dateParam, "yyyy-MM-dd", new Date())),
      );
    }
    if (timeParam) {
      const norm = normalizeTimeStr(timeParam) ?? timeParam;
      this.selectedTime.set(norm);
      this.timePeriod.set(getTimePeriod(norm));
    }
    if (pid) {
      this.api.get<{ patient: Patient }>(`/api/patients/${pid}`).subscribe({
        next: (r) => this.patient.set(r.patient),
        error: () => {
          /* leave empty */
        },
      });
    }
  }

  back() {
    this.navBack.backTo("/frontdesk/appointments");
  }

  // ── Patient ─────────────────────────────────────────────────
  setPatient(p: Patient) {
    this.patient.set(p);
  }
  clearPatient() {
    this.patient.set(null);
  }

  // ── Date ────────────────────────────────────────────────────
  navMonth(delta: number) {
    const cur = this.calendarMonth();
    this.calendarMonth.set(delta < 0 ? subMonths(cur, 1) : addMonths(cur, 1));
  }
  selectDate(iso: string) {
    if (iso === this.selectedDate()) return;
    this.selectedDate.set(iso);
    this.selectedTime.set("");
  }

  // ── Slots ───────────────────────────────────────────────────
  selectTime(t: string) {
    const norm = normalizeTimeStr(t) ?? t;
    this.selectedTime.set(norm);
    this.updatePeriodForTime(norm);
  }

  // ── Tests (optional pre-selection) ──────────────────────────
  toggleTest(id: string) {
    const cur = this.selectedTestIds();
    if (cur.includes(id)) this.selectedTestIds.set(cur.filter((x) => x !== id));
    else this.selectedTestIds.set([...cur, id]);
  }
  selectTest(id: string) {
    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
      this.blurTimeout = null;
    }
    this.toggleTest(id);
    this.testQuery.set("");
    this.focusSearchInput();
  }
  focusSearchInput() {
    setTimeout(() => {
      this.testSearchInput()?.nativeElement?.focus();
    }, 0);
  }
  private blurTimeout: any = null;
  onSearchFocus() {
    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
      this.blurTimeout = null;
    }
    this.testSearchFocused.set(true);
  }
  onSearchBlur() {
    this.blurTimeout = setTimeout(() => {
      this.testSearchFocused.set(false);
    }, 200);
  }
  isTestSelected(id: string): boolean {
    return this.selectedTestIds().includes(id);
  }
  setTestQuery(q: string) {
    this.testQuery.set(q);
  }

  private loadTestsIfNeeded() {
    if (this._tests().length > 0) return;
    this.api.get<Test[]>("/api/tests/").subscribe({
      next: (l) => this._tests.set(l ?? []),
      error: () => {
        /* silent */
      },
    });
  }

  private loadConfig() {
    this.api.get<AppointmentConfigDto>("/api/appointments/config").subscribe({
      next: (cfg) => {
        const safe = { ...this.defaultConfig(), ...(cfg ?? {}) };
        if (!safe.slotMinutes || safe.slotMinutes <= 0) safe.slotMinutes = 30;
        this._config.set(safe);
        this.safeRecompute();
      },
      error: () => {
        this._config.set(this.defaultConfig());
        this.safeRecompute();
      },
    });
  }

  private fetchAppointmentsForDate(iso: string) {
    if (!iso) return;
    this._dayAppointments.set([]);
    this._loadingAppointments.set(true);

    const baseDate = parse(iso, "yyyy-MM-dd", new Date());
    baseDate.setHours(0, 0, 0, 0);
    const start = addDays(baseDate, -1);
    const end = addDays(baseDate, 2);

    this.api
      .get<
        Appointment[]
      >(`/api/appointments?from=${start.toISOString()}&to=${end.toISOString()}`)
      .subscribe({
        next: (list) => {
          this._dayAppointments.set(list ?? []);
          this._loadingAppointments.set(false);
          this.safeRecompute();
        },
        error: () => {
          this._dayAppointments.set([]);
          this._loadingAppointments.set(false);
          this.safeRecompute();
        },
      });
  }

  private safeRecompute() {
    try {
      this.recomputeSlots();
    } catch (err) {
      console.error("[book-appointment] recomputeSlots failed", err);
      this._slots.set([]);
      this._errorMsg.set("Could not load slots — try a different day.");
    }
  }

  private defaultConfig(): AppointmentConfigDto {
    return {
      branchId: "",
      slotMinutes: 30,
      open24h: true,
      weeklyScheduleJson: null,
      maxConcurrentSlots: 1,
    };
  }

  private recomputeSlots() {
    const cfg = this._config();
    const dateIso = this.selectedDate();
    if (!cfg || !dateIso) {
      this._slots.set([]);
      return;
    }

    const date = parse(dateIso, "yyyy-MM-dd", new Date());
    const dow = DOW_KEYS[date.getDay()];
    const windows = this.openWindowsForDay(cfg, dow);
    if (windows.length === 0) {
      this._slots.set([]);
      return;
    }

    const todayIso = format(new Date(), "yyyy-MM-dd");
    const isToday = dateIso === todayIso;
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();

    const appointments = this._dayAppointments();
    const bookedCounts: Record<string, number> = {};
    for (const a of appointments) {
      if (a.status === "cancelled" || a.status === "no_show") {
        continue;
      }
      const apptStart = parseAppointmentStart(a);
      if (!apptStart) continue;
      const apptDateIso = isoDate(apptStart);
      if (apptDateIso !== dateIso) {
        continue;
      }
      const normTime = normalizeTimeStr(a.slotTime);
      if (normTime) {
        bookedCounts[normTime] = (bookedCounts[normTime] || 0) + 1;
      }
    }

    const maxConcurrent = Math.max(1, cfg.maxConcurrentSlots ?? 1);
    const step =
      Number.isFinite(cfg.slotMinutes) && cfg.slotMinutes > 0
        ? cfg.slotMinutes
        : 30;
    const slots: SlotInfo[] = [];
    for (const w of windows) {
      const start = parseHHmm(w.from);
      const end = parseHHmm(w.to);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        continue;
      let iter = 0;
      for (let m = start; m < end && iter < 500; m += step, iter++) {
        if (isToday && m < currentMin) continue;
        const hh = String(Math.floor(m / 60)).padStart(2, "0");
        const mm = String(m % 60).padStart(2, "0");
        const timeStr = `${hh}:${mm}`;
        const bookedCount = bookedCounts[timeStr] || 0;
        const available = bookedCount < maxConcurrent;
        slots.push({ time: timeStr, available, bookedCount });
      }
    }
    this._slots.set(slots);

    const wanted = normalizeTimeStr(this.selectedTime()) ?? this.selectedTime();
    let resolvedTime = wanted;

    if (wanted && slots.length > 0) {
      const match = slots.find((s) => s.time === wanted);
      if (!match || !match.available) {
        const wantedMin = parseHHmm(wanted);
        const availSlots = slots.filter((s) => s.available);
        if (availSlots.length > 0) {
          const nearest = availSlots.reduce((best, cur) => {
            const d = Math.abs(parseHHmm(cur.time) - wantedMin);
            return d < Math.abs(parseHHmm(best.time) - wantedMin) ? cur : best;
          });
          resolvedTime = nearest.time;
          this.selectedTime.set(resolvedTime);
        } else {
          resolvedTime = "";
          this.selectedTime.set("");
        }
      }
    }

    if (resolvedTime) {
      this.updatePeriodForTime(resolvedTime);
    } else {
      const counts = slots.reduce(
        (acc, s) => {
          if (s.available) acc[getTimePeriod(s.time)]++;
          return acc;
        },
        { morning: 0, afternoon: 0, evening: 0, night: 0 } as Record<
          "morning" | "afternoon" | "evening" | "night",
          number
        >,
      );
      if (counts.morning > 0) this.timePeriod.set("morning");
      else if (counts.afternoon > 0) this.timePeriod.set("afternoon");
      else if (counts.evening > 0) this.timePeriod.set("evening");
      else if (counts.night > 0) this.timePeriod.set("night");
    }
  }

  private updatePeriodForTime(time: string) {
    if (!time) return;
    this.timePeriod.set(getTimePeriod(time));
  }

  private openWindowsForDay(
    cfg: AppointmentConfigDto,
    dow: (typeof DOW_KEYS)[number],
  ): Array<{ from: string; to: string }> {
    if (cfg.open24h) return [{ from: "00:00", to: "24:00" }];
    if (!cfg.weeklyScheduleJson) return [];
    try {
      const parsed = JSON.parse(cfg.weeklyScheduleJson) as Record<
        string,
        Array<{ from: string; to: string }>
      >;
      return parsed?.[dow] ?? [];
    } catch {
      return [];
    }
  }

  submit() {
    const p = this.patient();
    const date = this.selectedDate();
    const time = this.selectedTime();
    if (!p || !date || !time) return;

    this._saving.set(true);
    this._errorMsg.set(null);
    const apptDate = parse(`${date} ${time}`, "yyyy-MM-dd HH:mm", new Date());
    const testIds = this.selectedTestIds();
    this.api
      .post<unknown>("/api/appointments", {
        patientId: p.id,
        type: "appointment",
        collectionType: this.collectionType(),
        appointmentDate: apptDate.toISOString(),
        slotTime: time,
        consultationFee: 0,
        notes: this.notes() || null,
        testIds: testIds.length ? testIds.join(",") : null,
        // Home-collection details (ignored server-side for walk-in).
        address:
          this.collectionType() === "home_collection"
            ? this.hcAddress() || null
            : null,
        pincode:
          this.collectionType() === "home_collection"
            ? this.hcPincode() || null
            : null,
        latitude:
          this.collectionType() === "home_collection" ? this.hcLat() : null,
        longitude:
          this.collectionType() === "home_collection" ? this.hcLng() : null,
      })
      .subscribe({
        next: () => {
          this._saving.set(false);
          this.bookingSvc.notifyBooked();
          this.toasts.success("Appointment booked");
          this.router.navigateByUrl("/frontdesk");
        },
        error: (err) => {
          this._saving.set(false);
          // Surface the real backend message inline. Field-named failures
          // (patient / slot) are inherently shown inline via errorMsg beside
          // the offending step rather than as a toast.
          this._errorMsg.set(ApiError.from(err).message);
        },
      });
  }
}

function parseHHmm(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  if (h === 24 && m === 0) return 24 * 60;
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function getTimePeriod(
  time: string,
): "morning" | "afternoon" | "evening" | "night" {
  const [hStr] = time.split(":");
  const h = parseInt(hStr, 10);
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

function parseAppointmentStart(a: Appointment): Date | null {
  if (!a.appointmentDate) return null;
  const d = new Date(a.appointmentDate);
  if (isNaN(d.getTime())) return null;
  if (a.slotTime && /^\d{1,2}:\d{2}/.test(a.slotTime)) {
    const [hh, mm] = a.slotTime.split(":").map((n) => parseInt(n, 10));
    if (Number.isFinite(hh) && Number.isFinite(mm)) d.setHours(hh, mm, 0, 0);
  }
  return d;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeTimeStr(time: string | undefined | null): string | null {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = match[1].padStart(2, "0");
  const mm = match[2];
  return `${hh}:${mm}`;
}
