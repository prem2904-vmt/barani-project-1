import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
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
import { ApiService } from "../../../core/services/api.service";
import { AppointmentBookingService } from "../../../core/services/appointment-booking.service";
import { ToastService } from "../../../core/services/toast.service";
import { Patient, patientDisplayName, formatPatientInfo } from "../../models/patient.model";
import { Appointment } from "../../models/appointment.model";
import { Test } from "../../models/test.model";
import { AvatarComponent } from "../../primitives/avatar.component";
import { PatientSearchComponent } from "../patient-search/patient-search.component";
import { LoadingLogoComponent } from "../loading-logo/loading-logo.component";

interface AppointmentConfigDto {
  branchId: string;
  slotMinutes: number;
  open24h: boolean;
  weeklyScheduleJson: string | null;
  maxConcurrentSlots: number;
}

interface SlotInfo {
  /** "HH:mm" */
  time: string;
  available: boolean;
  bookedCount: number;
}

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

@Component({
  selector: "pf-appointment-booking-modal",
  standalone: true,
  imports: [CommonModule, AvatarComponent, PatientSearchComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-[1050] flex items-center justify-center p-4 md:p-6"
      [class.hidden]="!open()"
      role="dialog"
      aria-modal="true"
      [attr.aria-hidden]="!open()"
      aria-label="Book appointment"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-slate-950/70 backdrop-blur-md transition-opacity animate-modal-backdrop"
        (click)="close()"
      ></div>

      <!-- Modal Shell Panel -->
      <div
        class="relative w-full max-w-7xl h-[90vh] min-h-[750px] max-h-[95dvh] flex flex-col bg-[var(--bg-card-solid)] border border-[var(--glass-border)] rounded-2xl shadow-2xl overflow-hidden animate-modal-shell"
      >
        <!-- Header -->
        <header class="flex items-center justify-between px-6 py-4 border-b border-[var(--glass-border)] bg-[var(--bg-card-solid)] shrink-0">
          <div>
            <h2 class="text-base font-bold text-[var(--text-primary)]">Book appointment</h2>
            <p class="text-xs text-[var(--text-secondary)] mt-0.5 font-mono">{{ headerSubtitle() }}</p>
          </div>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent hover:border-[var(--glass-border)] transition-all duration-200"
            (click)="close()"
            aria-label="Close"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <!-- Body grid container -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8 overflow-y-auto lg:overflow-y-hidden flex-1 min-h-0">
          
          <!-- LEFT COLUMN: Patient + Date picker -->
          <div class="flex flex-col gap-6 min-w-0">
            <!-- Step 1: Patient Picker -->
            <section class="flex flex-col min-h-0">
              <div class="flex items-center gap-2 mb-2">
                <span class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold">1</span>
                <span class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]">Patient</span>
              </div>
              @if (patient()) {
                <div class="flex items-center gap-4 p-4 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl hover:border-purple-500/30 transition-all duration-200">
                  <pf-avatar [name]="patientName()" [size]="40" class="shrink-0"></pf-avatar>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-[var(--text-primary)] truncate">{{ formatPatient(patient()) }}</p>
                    @if (patient()!.phone) {
                      <p class="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                        <span class="font-mono tracking-wider text-[var(--text-muted)]">{{ patient()!.phone }}</span>
                      </p>
                    }
                  </div>
                  <button
                    type="button"
                    class="text-xs font-semibold text-purple-400 hover:text-purple-300 hover:underline px-2 py-1 shrink-0"
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

            <!-- Step 2: Date Picker (Mini-calendar) -->
            <section class="flex flex-col min-h-0 flex-1">
              <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2">
                  <span class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold">2</span>
                  <span class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]">Date</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="w-6 h-6 flex items-center justify-center bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
                    (click)="navMonth(-1)"
                    aria-label="Prev month"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span class="text-xs font-mono font-semibold text-[var(--text-secondary)] min-w-[90px] text-center">
                    {{ calendarMonth() | date: "MMM yyyy" }}
                  </span>
                  <button
                    type="button"
                    class="w-6 h-6 flex items-center justify-center bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
                    (click)="navMonth(1)"
                    aria-label="Next month"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              
              <div class="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4 flex-1 flex flex-col min-h-0">
                <!-- Day of week headers -->
                <div class="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  @for (d of dows; track d) {
                    <span>{{ d }}</span>
                  }
                </div>
                <!-- Calendar cells -->
                <div class="grid grid-cols-7 grid-rows-6 gap-2 flex-1">
                  @for (cell of calCells(); track cell.iso) {
                    <button
                      type="button"
                      class="h-full min-h-[44px] flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-150 relative"
                      [class.text-[var(--text-muted)]]="cell.outside"
                      [class.opacity-40]="cell.outside"
                      [class.text-purple-400]="cell.today && cell.iso !== selectedDate()"
                      [class.border]="cell.today && cell.iso !== selectedDate()"
                      [class.border-purple-500/30]="cell.today && cell.iso !== selectedDate()"
                      [class.bg-gradient-to-br]="cell.iso === selectedDate()"
                      [class.from-purple-600]="cell.iso === selectedDate()"
                      [class.to-pink-600]="cell.iso === selectedDate()"
                      [class.text-white]="cell.iso === selectedDate()"
                      [class.shadow-md]="cell.iso === selectedDate()"
                      [class.shadow-purple-500/20]="cell.iso === selectedDate()"
                      [class.hover:bg-[var(--bg-hover)]]="cell.iso !== selectedDate() && !cell.past"
                      [disabled]="cell.past"
                      [class.opacity-30]="cell.past"
                      [class.cursor-not-allowed]="cell.past"
                      (click)="selectDate(cell.iso)"
                    >
                      {{ cell.day }}
                      @if (cell.today && cell.iso !== selectedDate()) {
                        <span class="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                      }
                    </button>
                  }
                </div>
              </div>
            </section>
          </div>

          <!-- RIGHT COLUMN: Time slot + Tests + Notes -->
          <div class="flex flex-col gap-6 min-w-0 lg:overflow-y-auto lg:max-h-full pr-1">
            <!-- Step 3: Time slot (Segmented controls + Grid) -->
            <section class="flex flex-col min-h-0 flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold">3</span>
                <span class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]">Time slot</span>
              </div>

              @if (loadingSlots()) {
                <div class="flex flex-col items-center justify-center py-10 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl flex-1">
                  <pf-loading-logo size="md" color="purple" [showDna]="true" [showText]="true" text="Loading slots…"></pf-loading-logo>
                </div>
              } @else if (slots().length === 0) {
                <div class="flex items-center justify-center p-8 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl text-sm text-[var(--text-muted)] flex-1">
                  Branch is closed on this day (or all slots have passed).
                </div>
              } @else {
                <!-- Segmented glass control -->
                <div class="flex p-1 bg-[var(--bg-secondary)] border border-[var(--glass-border)] rounded-xl gap-1.5 mb-4">
                  <button
                    type="button"
                    class="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-1"
                    [class.bg-[var(--bg-card-solid)]]="timePeriod() === 'morning'"
                    [class.text-[var(--text-primary)]]="timePeriod() === 'morning'"
                    [class.shadow-sm]="timePeriod() === 'morning'"
                    [class.text-[var(--text-secondary)]]="timePeriod() !== 'morning'"
                    [class.hover:text-[var(--text-primary)]]="timePeriod() !== 'morning'"
                    (click)="timePeriod.set('morning')"
                  >
                    <span>Morning</span>
                    <span class="text-[10px] opacity-60 font-mono">({{ periodsWithSlots().morning }})</span>
                  </button>
                  <button
                    type="button"
                    class="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-1"
                    [class.bg-[var(--bg-card-solid)]]="timePeriod() === 'afternoon'"
                    [class.text-[var(--text-primary)]]="timePeriod() === 'afternoon'"
                    [class.shadow-sm]="timePeriod() === 'afternoon'"
                    [class.text-[var(--text-secondary)]]="timePeriod() !== 'afternoon'"
                    [class.hover:text-[var(--text-primary)]]="timePeriod() !== 'afternoon'"
                    (click)="timePeriod.set('afternoon')"
                  >
                    <span>Afternoon</span>
                    <span class="text-[10px] opacity-60 font-mono">({{ periodsWithSlots().afternoon }})</span>
                  </button>
                  <button
                    type="button"
                    class="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-1"
                    [class.bg-[var(--bg-card-solid)]]="timePeriod() === 'evening'"
                    [class.text-[var(--text-primary)]]="timePeriod() === 'evening'"
                    [class.shadow-sm]="timePeriod() === 'evening'"
                    [class.text-[var(--text-secondary)]]="timePeriod() !== 'evening'"
                    [class.hover:text-[var(--text-primary)]]="timePeriod() !== 'evening'"
                    (click)="timePeriod.set('evening')"
                  >
                    <span>Evening</span>
                    <span class="text-[10px] opacity-60 font-mono">({{ periodsWithSlots().evening }})</span>
                  </button>
                  <button
                    type="button"
                    class="flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-1"
                    [class.bg-[var(--bg-card-solid)]]="timePeriod() === 'night'"
                    [class.text-[var(--text-primary)]]="timePeriod() === 'night'"
                    [class.shadow-sm]="timePeriod() === 'night'"
                    [class.text-[var(--text-secondary)]]="timePeriod() !== 'night'"
                    [class.hover:text-[var(--text-primary)]]="timePeriod() !== 'night'"
                    (click)="timePeriod.set('night')"
                  >
                    <span>Night</span>
                    <span class="text-[10px] opacity-60 font-mono">({{ periodsWithSlots().night }})</span>
                  </button>
                </div>

                <!-- Slots grid container -->
                <div class="border border-[var(--glass-border)] rounded-xl bg-[var(--glass-bg)] p-4 flex-1 flex flex-col min-h-0">
                  @if (visibleSlots().length === 0) {
                    <div class="text-center py-10 text-xs text-[var(--text-muted)] flex-1 flex items-center justify-center">
                      No slots available in this period.
                    </div>
                  } @else {
                    <div class="grid grid-cols-4 sm:grid-cols-5 gap-2.5 overflow-y-auto pr-1 flex-1 min-h-[220px]">
                      @for (s of visibleSlots(); track s.time) {
                        <button
                          type="button"
                          class="py-3 rounded-lg text-xs font-mono font-medium border transition-all duration-150 flex flex-col items-center justify-center relative group"
                          [class.bg-gradient-to-br]="s.time === selectedTime()"
                          [class.from-purple-600]="s.time === selectedTime()"
                          [class.to-pink-600]="s.time === selectedTime()"
                          [class.border-transparent]="s.time === selectedTime()"
                          [class.text-white]="s.time === selectedTime()"
                          [class.shadow-sm]="s.time === selectedTime()"
                          [class.bg-[var(--bg-card-solid)]]="s.time !== selectedTime() && s.available"
                          [class.border-[var(--glass-border)]]="s.time !== selectedTime() && s.available"
                          [class.text-[var(--text-primary)]]="s.time !== selectedTime() && s.available"
                          [class.hover:border-purple-500/40]="s.time !== selectedTime() && s.available"
                          [class.hover:bg-[var(--bg-hover)]]="s.time !== selectedTime() && s.available"
                          [disabled]="!s.available"
                          [class.opacity-30]="!s.available"
                          [class.cursor-not-allowed]="!s.available"
                          [class.bg-red-500/5]="!s.available"
                          [class.border-red-500/10]="!s.available"
                          (click)="selectTime(s.time)"
                        >
                          <span>{{ s.time }}</span>
                          @if (!s.available) {
                            <span class="text-[8px] text-red-400 font-bold uppercase tracking-wider mt-0.5 scale-90">full</span>
                          }
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </section>

            <!-- Step 4: Tests selection (Search + chips + absolute popup suggestions) -->
            <section class="flex flex-col min-h-0 relative overflow-visible">
              <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2">
                  <span class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold">4</span>
                  <span class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]">Tests <span class="text-[10px] text-[var(--text-muted)] lowercase font-normal">(optional)</span></span>
                </div>
                @if (selectedTestIds().length > 0) {
                  <span class="text-[10px] font-bold px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full border border-purple-500/20">
                    {{ selectedTestIds().length }} picked
                  </span>
                }
              </div>

              <!-- Selected test chips -->
              @if (selectedTests().length > 0) {
                <div class="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1.5 w-full shrink-0">
                  @for (t of selectedTests(); track t.id) {
                    <span
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-full text-xs text-[var(--text-primary)] font-medium shrink-0"
                    >
                      <span>{{ t.name }}</span>
                      <button
                        type="button"
                        class="text-[var(--text-muted)] hover:text-red-400 transition-colors p-0.5"
                        (click)="toggleTest(t.id)"
                        title="Remove"
                      >
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  }
                </div>
              }

              <!-- Search input container -->
              <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  class="w-full pl-10 pr-4 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all duration-200"
                  placeholder="Search tests by name or code..."
                  [value]="testQuery()"
                  (input)="setTestQuery($any($event.target).value)"
                  (focus)="testSearchFocused.set(true)"
                  (blur)="testSearchFocused.set(false)"
                />

                <!-- Absolute Popover Suggestions List -->
                @if (testSearchFocused() && filteredTests().length > 0) {
                  <div
                    class="absolute left-0 right-0 z-50 mt-1 max-h-[220px] overflow-y-auto bg-[var(--bg-card-solid)] border border-[var(--glass-border)] rounded-xl shadow-2xl backdrop-blur-lg pr-1"
                  >
                    <ul class="py-1">
                      @for (t of filteredTests(); track t.id) {
                        <li>
                          <button
                            type="button"
                            class="w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors"
                            [class.bg-purple-500/10]="isTestSelected(t.id)"
                            [class.text-purple-400]="isTestSelected(t.id)"
                            [class.hover:bg-[var(--bg-hover)]]="!isTestSelected(t.id)"
                            [class.text-[var(--text-primary)]]="!isTestSelected(t.id)"
                            (mousedown)="$event.preventDefault(); toggleTest(t.id)"
                          >
                            <div class="flex items-center gap-2 min-w-0 flex-1">
                              @if (isTestSelected(t.id)) {
                                <svg class="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              }
                              <span class="truncate font-medium">{{ t.name }}</span>
                            </div>
                            @if (t.code) {
                              <span class="font-mono text-[10px] text-[var(--text-tertiary)] shrink-0 ml-2 bg-[var(--glass-bg)] px-1.5 py-0.5 rounded border border-[var(--glass-border)]">
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

            <!-- Step 5: Notes -->
            <section class="flex flex-col min-h-0 animate-in fade-in">
              <div class="flex items-center gap-2 mb-2">
                <span class="w-5 h-5 flex items-center justify-center rounded-full bg-purple-500/10 text-purple-400 font-mono text-xs font-bold">5</span>
                <span class="text-xs font-bold tracking-wider uppercase text-[var(--text-tertiary)]">Notes <span class="text-[10px] text-[var(--text-muted)] lowercase font-normal">(optional)</span></span>
              </div>
              <textarea
                class="w-full p-3 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl text-xs placeholder-[var(--input-placeholder)] focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all duration-200 resize-none animate-in fade-in"
                rows="3"
                placeholder="Enter any booking instructions or clinical notes..."
                [value]="notes()"
                (input)="notes.set($any($event.target).value)"
              ></textarea>
            </section>
          </div>
        </div>

        <!-- Footer -->
        <footer class="flex items-center justify-between px-6 py-4 border-t border-[var(--glass-border)] bg-[var(--bg-card-solid)] shrink-0">
          <div class="min-w-0 flex-1 mr-4">
            @if (errorMsg()) {
              <div class="flex items-center gap-1.5 text-xs text-red-400 font-semibold truncate animate-pulse">
                <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{{ errorMsg() }}</span>
              </div>
            }
          </div>
          <div class="flex gap-2 shrink-0">
            <button
              type="button"
              class="px-4 py-2 text-xs font-semibold rounded-xl border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all duration-200"
              (click)="close()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="px-5 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 disabled:opacity-50 disabled:pointer-events-none transition-all duration-200"
              [disabled]="!canSubmit() || saving()"
              (click)="submit()"
            >
              {{ saving() ? "Booking…" : "Book appointment" }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      @keyframes modal-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes modal-slide-up {
        from { transform: translateY(16px) scale(0.98); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }

      .animate-modal-backdrop {
        animation: modal-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      .animate-modal-shell {
        animation: modal-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      /* Custom slim scrollbars */
      :host ::-webkit-scrollbar {
        width: 4px;
        height: 4px;
      }

      :host ::-webkit-scrollbar-track {
        background: transparent;
      }

      :host ::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 4px;
      }

      :host ::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-thumb-hover);
      }
    `,
  ],
})
export class AppointmentBookingModalComponent {
  private readonly api = inject(ApiService);
  private readonly booking = inject(AppointmentBookingService);
  private readonly toasts = inject(ToastService);

  protected readonly dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Booking state.
  protected readonly patient = signal<Patient | null>(null);
  protected readonly selectedDate = signal<string>(
    format(new Date(), "yyyy-MM-dd"),
  );
  protected readonly selectedTime = signal<string>("");
  protected readonly notes = signal<string>("");
  protected readonly calendarMonth = signal<Date>(startOfMonth(new Date()));
  /** Optional pre-selected tests. If present at booking time, auto-check-in
   *  spawns the order without the receptionist having to pick tests at
   *  the desk. Empty list = no pre-selection (tests will be picked at
   *  check-in). */
  protected readonly selectedTestIds = signal<string[]>([]);
  protected readonly testQuery = signal<string>("");

  // UI display & segmentation signals.
  protected readonly timePeriod = signal<'morning' | 'afternoon' | 'evening' | 'night'>('morning');
  protected readonly testSearchFocused = signal<boolean>(false);

  // Branch config + slots.
  private readonly _config = signal<AppointmentConfigDto | null>(null);
  private readonly _slots = signal<SlotInfo[]>([]);
  private readonly _tests = signal<Test[]>([]);
  private readonly _saving = signal(false);
  private readonly _errorMsg = signal<string | null>(null);
  private readonly _dayAppointments = signal<Appointment[]>([]);
  private readonly _loadingAppointments = signal<boolean>(false);

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
  /** Loading == "haven't fetched the branch config yet" or "still fetching the appointments".
   *  Derived directly from _config and _loadingAppointments so we never end up with a stale loading flag. */
  readonly loadingSlots = computed(() => this._config() === null || this._loadingAppointments());
  readonly saving = this._saving.asReadonly();
  readonly errorMsg = this._errorMsg.asReadonly();

  readonly open = computed(() => this.booking.request() !== null);

  readonly patientName = computed(() => patientDisplayName(this.patient()));
  protected readonly formatPatient = formatPatientInfo;
  readonly canSubmit = computed(() => {
    if (!this.patient() || !this.selectedDate() || !this.selectedTime()) {
      return false;
    }
    const sel = normalizeTimeStr(this.selectedTime()) ?? this.selectedTime();
    const list = this._slots();
    const match = list.find((s) => (normalizeTimeStr(s.time) ?? s.time) === sel);
    return !match || match.available;
  });

  /** Tests filtered by the in-modal search box. Empty query → top 25
   *  active tests by name. Limited to 25 hits so the list stays a
   *  scannable strip rather than a wall. */
  readonly filteredTests = computed<Test[]>(() => {
    const q = this.testQuery().trim().toLowerCase();
    const all = this._tests().filter((t) => t.isActive);
    const matches = q
      ? all.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.code ?? "").toLowerCase().includes(q),
        )
      : all;
    return matches.slice(0, 25);
  });
  /** Resolved Test objects for the chips above the picker. */
  readonly selectedTests = computed<Test[]>(() => {
    const ids = new Set(this.selectedTestIds());
    return this._tests().filter((t) => ids.has(t.id));
  });

  readonly headerSubtitle = computed(() => {
    const d = this.selectedDate();
    const t = this.selectedTime();
    if (!d) return "Pick a patient, day, and time slot.";
    const day = parse(d, "yyyy-MM-dd", new Date());
    const stamp = format(day, "EEE, dd MMM yyyy");
    return t ? `${stamp} · ${t}` : stamp;
  });

  /** Mini-month grid cells — 6 rows × 7 cols, padded to the visible week
   *  bounds. Past dates get [disabled] so reception can't book backwards. */
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
    // React to open() flips. Effect runs in injection context, so it
    // auto-cleans on destroy. NOTE: we deliberately no longer portal the
    // host into document.body — the reparent was causing a Web Animations
    // InvalidStateError at boot that poisoned Angular's microtask
    // scheduler (subscribe callbacks downstream silently never fired).
    // The modal lives in the shell's view tree; position:fixed +
    // z-index:1050 already escape any stacking context the shell creates.
    effect(() => {
      const req = this.booking.request();
      if (req) {
        this.applyPreset(req);
        this.loadTestsIfNeeded();
        if (this._config() === null) this.loadConfig();
        else this.safeRecompute();
      } else {
        this.reset();
      }
    });

    // React to selectedDate changes to fetch appointments for that day.
    effect(() => {
      const open = this.open();
      const date = this.selectedDate();
      if (open && date) {
        this.fetchAppointmentsForDate(date);
      }
    });
  }

  @HostListener("document:keydown.escape")
  onEsc() {
    if (this.open()) this.close();
  }

  close() {
    this.booking.close();
  }

  private reset() {
    this.patient.set(null);
    this.selectedDate.set(format(new Date(), "yyyy-MM-dd"));
    this.selectedTime.set("");
    this.notes.set("");
    this.calendarMonth.set(startOfMonth(new Date()));
    this._slots.set([]);
    this._errorMsg.set(null);
    this.selectedTestIds.set([]);
    this.testQuery.set("");
    this.timePeriod.set("morning");
    this._dayAppointments.set([]);
    this._loadingAppointments.set(false);
  }

  private applyPreset(req: {
    patientId?: string;
    date?: string;
    time?: string;
  }) {
    if (req.date) {
      this.selectedDate.set(req.date);
      this.calendarMonth.set(
        startOfMonth(parse(req.date, "yyyy-MM-dd", new Date())),
      );
    }
    if (req.time) {
      const norm = normalizeTimeStr(req.time) ?? req.time;
      this.selectedTime.set(norm);
      this.updatePeriodForTime(norm);
    }
    if (req.patientId) {
      // Fetch the patient summary so the picker shows context. Tolerate
      // the new enriched response shape by typing as `unknown`.
      this.api
        .get<{ patient: Patient }>(`/api/patients/${req.patientId}`)
        .subscribe({
          next: (r) => this.patient.set(r.patient),
          error: () => {
            /* leave picker empty */
          },
        });
    }
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
  isTestSelected(id: string): boolean {
    return this.selectedTestIds().includes(id);
  }
  setTestQuery(q: string) {
    this.testQuery.set(q);
  }

  /** Lazy-load the test catalogue the first time the modal opens. We
   *  cache it on the modal instance for the rest of the session. */
  private loadTestsIfNeeded() {
    if (this._tests().length > 0) return;
    this.api.get<Test[]>("/api/tests/").subscribe({
      next: (l) => this._tests.set(l ?? []),
      error: () => {
        /* silent — test picker just stays empty */
      },
    });
  }

  private loadConfig() {
    console.info("[booking-modal] loadConfig start");
    this.api.get<AppointmentConfigDto>("/api/appointments/config").subscribe({
      next: (cfg) => {
        const safe = { ...this.defaultConfig(), ...(cfg ?? {}) };
        if (!safe.slotMinutes || safe.slotMinutes <= 0) safe.slotMinutes = 30;
        this._config.set(safe);
        this.safeRecompute();
      },
      error: (err) => {
        console.warn("[booking-modal] loadConfig.error", err);
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
      .get<Appointment[]>(
        `/api/appointments?from=${start.toISOString()}&to=${end.toISOString()}`
      )
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

  /** Wraps recomputeSlots so a thrown error can never leave the slot
   *  grid in an indeterminate state — slots become [] and we surface
   *  a footer error message. */
  private safeRecompute() {
    try {
      this.recomputeSlots();
    } catch (err) {
      console.error("[appointment-booking-modal] recomputeSlots failed", err);
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

  /**
   * Compute the visible slot grid for the selected date based on the
   * branch config. We query the server for taken slots and overlay them
   * to mark full slots as unavailable.
   */
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

    // Group active appointments by slot time.
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

    // Guard against a misconfigured slot length that would loop forever.
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
      // Hard cap iterations as a final safety net (24h / 5min = 288).
      let iter = 0;
      for (let m = start; m < end && iter < 500; m += step, iter++) {
        if (isToday && m < currentMin) {
          continue; // Don't show past times if date is today
        }
        const hh = String(Math.floor(m / 60)).padStart(2, "0");
        const mm = String(m % 60).padStart(2, "0");
        const timeStr = `${hh}:${mm}`;
        const bookedCount = bookedCounts[timeStr] || 0;
        const available = bookedCount < maxConcurrent;
        slots.push({ time: timeStr, available, bookedCount });
      }
    }
    this._slots.set(slots);

    // Snap target selection to nearest available slot if needed
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
          if (s.available) {
            acc[getTimePeriod(s.time)]++;
          }
          return acc;
        },
        { morning: 0, afternoon: 0, evening: 0, night: 0 } as Record<
          "morning" | "afternoon" | "evening" | "night",
          number
        >
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

  /** Resolve the open windows for a given weekday. 24/7 short-circuits to
   *  a single full-day window; otherwise read the JSON schedule. */
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

  // ── Submit ──────────────────────────────────────────────────
  submit() {
    const p = this.patient();
    const date = this.selectedDate();
    const time = this.selectedTime();
    if (!p || !date || !time) return;

    this._saving.set(true);
    this._errorMsg.set(null);
    const apptDate = parse(`${date} ${time}`, "yyyy-MM-dd HH:mm", new Date());
    // Backend takes testIds as a comma-separated string (matches the
    // CSV shape stored on the appointment row). Empty list = null so
    // the backend's check-in path falls back to "pick tests at desk".
    const testIds = this.selectedTestIds();
    this.api
      .post<unknown>("/api/appointments", {
        patientId: p.id,
        type: "appointment",
        collectionType: "walkin",
        appointmentDate: apptDate.toISOString(),
        slotTime: time,
        consultationFee: 0,
        notes: this.notes() || null,
        testIds: testIds.length ? testIds.join(",") : null,
      })
      .subscribe({
        next: () => {
          this._saving.set(false);
          this.toasts.success("Appointment booked");
          this.booking.notifyBooked();
          this.close();
        },
        error: (err) => {
          this._saving.set(false);
          const msg = (err as { error?: { message?: string } })?.error?.message;
          this._errorMsg.set(msg ?? "Could not book — try again");
        },
      });
  }
}

function parseHHmm(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  // Treat "24:00" as the end-of-day sentinel.
  if (h === 24 && m === 0) return 24 * 60;
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function getTimePeriod(time: string): 'morning' | 'afternoon' | 'evening' | 'night' {
  const [hStr] = time.split(':');
  const h = parseInt(hStr, 10);
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function parseAppointmentStart(a: Appointment): Date | null {
  if (!a.appointmentDate) return null;
  const d = new Date(a.appointmentDate);
  if (isNaN(d.getTime())) return null;
  if (a.slotTime && /^\d{1,2}:\d{2}/.test(a.slotTime)) {
    const [hh, mm] = a.slotTime.split(':').map((n) => parseInt(n, 10));
    if (Number.isFinite(hh) && Number.isFinite(mm)) d.setHours(hh, mm, 0, 0);
  }
  return d;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeTimeStr(time: string | undefined | null): string | null {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = match[1].padStart(2, "0");
  const mm = match[2];
  return `${hh}:${mm}`;
}
