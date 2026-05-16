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
import { Patient, patientDisplayName } from "../../models/patient.model";
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
      class="pf-bk-root"
      [class.pf-bk-hidden]="!open()"
      role="dialog"
      aria-modal="true"
      [attr.aria-hidden]="!open()"
      aria-label="Book appointment"
    >
      <div class="pf-bk-backdrop" (click)="close()"></div>

      <div class="pf-bk-shell">
        <header class="pf-bk-hdr">
          <div>
            <h2>Book appointment</h2>
            <p>{{ headerSubtitle() }}</p>
          </div>
          <button
            type="button"
            class="pf-bk-x"
            (click)="close()"
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div class="pf-bk-grid">
          <!-- LEFT COLUMN: patient + date -->
          <div class="pf-bk-col">
            <!-- ── Step 1: pick patient ─────────────────────────── -->
            <section class="pf-bk-step">
              <header class="pf-bk-step__hdr"><span>1</span> Patient</header>
              @if (patient()) {
                <div class="pf-bk-patient">
                  <pf-avatar [name]="patientName()" [size]="32"></pf-avatar>
                  <div>
                    <p class="pf-bk-patient__name">{{ patientName() }}</p>
                    <p class="pf-bk-patient__meta">
                      {{ patient()!.age ?? "—" }}/{{ patient()!.sex ?? "—" }} ·
                      <span class="pf-bk-mono">{{
                        patient()!.phone ?? "no phone"
                      }}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    class="pf-bk-link"
                    (click)="clearPatient()"
                  >
                    Change
                  </button>
                </div>
              } @else {
                <pf-patient-search
                  placeholder="Search by name, MRN, phone, ABHA…"
                  (picked)="setPatient($event)"
                ></pf-patient-search>
              }
            </section>

            <!-- ── Step 2: pick date (mini calendar) ────────────── -->
            <section class="pf-bk-step">
              <header class="pf-bk-step__hdr">
                <span>2</span> Date
                <div class="pf-bk-mininav">
                  <button
                    type="button"
                    (click)="navMonth(-1)"
                    aria-label="Prev month"
                  >
                    ‹
                  </button>
                  <span>{{ calendarMonth() | date: "MMMM y" }}</span>
                  <button
                    type="button"
                    (click)="navMonth(1)"
                    aria-label="Next month"
                  >
                    ›
                  </button>
                </div>
              </header>
              <div class="pf-bk-cal">
                <div class="pf-bk-cal__dows">
                  @for (d of dows; track d) {
                    <span>{{ d }}</span>
                  }
                </div>
                <div class="pf-bk-cal__grid">
                  @for (cell of calCells(); track cell.iso) {
                    <button
                      type="button"
                      class="pf-bk-cal__cell"
                      [class.pf-bk-cal__cell--out]="cell.outside"
                      [class.pf-bk-cal__cell--today]="cell.today"
                      [class.pf-bk-cal__cell--on]="cell.iso === selectedDate()"
                      [disabled]="cell.past"
                      (click)="selectDate(cell.iso)"
                    >
                      {{ cell.day }}
                    </button>
                  }
                </div>
              </div>
            </section>
          </div>

          <!-- RIGHT COLUMN: slot + notes -->
          <div class="pf-bk-col">
            <!-- ── Step 3: pick slot ─────────────────────────────── -->
            <section class="pf-bk-step pf-bk-step--grow">
              <header class="pf-bk-step__hdr"><span>3</span> Time slot</header>
              @if (loadingSlots()) {
                <div class="pf-bk-empty flex justify-center py-4">
                  <pf-loading-logo size="md" color="purple" [showDna]="true"
                                   [showText]="true" text="Loading slots…"></pf-loading-logo>
                </div>
              } @else if (slots().length === 0) {
                <p class="pf-bk-empty">Branch is closed on this day.</p>
              } @else {
                <div class="pf-bk-slots">
                  @for (s of slots(); track s.time) {
                    <button
                      type="button"
                      class="pf-bk-slot"
                      [class.pf-bk-slot--on]="s.time === selectedTime()"
                      [disabled]="!s.available"
                      (click)="selectTime(s.time)"
                    >
                      {{ s.time }}
                      @if (!s.available) {
                        <span class="pf-bk-slot__note">full</span>
                      }
                    </button>
                  }
                </div>
              }
            </section>

            <!-- ── Step 4: tests (optional) ───────────────────────── -->
            <section class="pf-bk-step">
              <header class="pf-bk-step__hdr">
                <span>4</span> Tests (optional)
                @if (selectedTestIds().length > 0) {
                  <span class="pf-bk-step__badge"
                    >{{ selectedTestIds().length }} picked</span
                  >
                }
              </header>
              @if (selectedTests().length > 0) {
                <div class="pf-bk-tests__chips">
                  @for (t of selectedTests(); track t.id) {
                    <button
                      type="button"
                      class="pf-bk-tests__chip"
                      (click)="toggleTest(t.id)"
                      title="Remove"
                    >
                      <span>{{ t.name }}</span>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  }
                </div>
              }
              <input
                type="text"
                class="pf-bk-tests__search"
                placeholder="Search tests by name or code…"
                [value]="testQuery()"
                (input)="setTestQuery($any($event.target).value)"
              />
              @if (filteredTests().length > 0) {
                <ul class="pf-bk-tests__list">
                  @for (t of filteredTests(); track t.id) {
                    <li>
                      <button
                        type="button"
                        class="pf-bk-tests__row"
                        [class.pf-bk-tests__row--on]="isTestSelected(t.id)"
                        (click)="toggleTest(t.id)"
                      >
                        <span class="pf-bk-tests__name">{{ t.name }}</span>
                        @if (t.code) {
                          <span class="pf-bk-tests__code">{{ t.code }}</span>
                        }
                      </button>
                    </li>
                  }
                </ul>
              } @else {
                <p class="pf-bk-empty">No tests match.</p>
              }
            </section>

            <!-- ── Step 5: notes ─────────────────────────────────── -->
            <section class="pf-bk-step">
              <header class="pf-bk-step__hdr">
                <span>5</span> Notes (optional)
              </header>
              <textarea
                class="pf-bk-textarea"
                rows="2"
                placeholder="Anything reception needs to know…"
                [value]="notes()"
                (input)="notes.set($any($event.target).value)"
              ></textarea>
            </section>
          </div>
        </div>

        <footer class="pf-bk-foot">
          @if (errorMsg()) {
            <span class="pf-bk-error">{{ errorMsg() }}</span>
          }
          <button
            type="button"
            class="pf-bk-btn pf-bk-btn--ghost"
            (click)="close()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="pf-bk-btn pf-bk-btn--primary"
            [disabled]="!canSubmit() || saving()"
            (click)="submit()"
          >
            {{ saving() ? "Booking…" : "Book appointment" }}
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* Always-rendered modal: visibility is toggled via this class.
     * We intentionally avoid an *@if* guard around the modal body —
     * keeping the inner template always instantiated registers
     * signal consumers from boot, so signal updates re-render
     * via Angular's automatic OnPush path. (See plan
     * /Users/suganthan/.claude/plans/drifting-orbiting-anchor.md.) */
      .pf-bk-hidden {
        display: none !important;
      }

      /* ── Backdrop + shell ──────────────────────────────────── */
      .pf-bk-root {
        position: fixed;
        inset: 0;
        z-index: 1050;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 5vh 24px 24px;
      }
      .pf-bk-backdrop {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(
            900px 600px at 50% 100%,
            rgba(124, 58, 237, 0.12),
            transparent 60%
          ),
          rgba(5, 5, 15, 0.72);
        backdrop-filter: blur(14px) saturate(1.2);
      }
      .pf-bk-shell {
        position: relative;
        width: 100%;
        max-width: 980px;
        max-height: 90dvh;
        display: flex;
        flex-direction: column;
        background: var(--bg-card-solid);
        border: 1px solid var(--glass-border);
        border-radius: 18px;
        box-shadow: 0 30px 70px rgba(0, 0, 0, 0.55);
        overflow: hidden;
      }
      :host-context(html[data-theme="light"]) .pf-bk-backdrop {
        background:
          radial-gradient(
            900px 600px at 50% 100%,
            rgba(139, 92, 246, 0.08),
            transparent 55%
          ),
          rgba(255, 255, 255, 0.92);
      }
      :host-context(html[data-theme="light"]) .pf-bk-shell {
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
      }
      :host-context(html[data-theme="light"]) .pf-bk-x:hover {
        background: rgba(15, 23, 42, 0.04);
      }
      :host-context(html[data-theme="light"]) .pf-bk-link {
        color: #7c3aed;
      }
      :host-context(html[data-theme="light"]) .pf-bk-link:hover {
        color: #5b21b6;
      }
      :host-context(html[data-theme="light"])
        .pf-bk-cal__cell:hover:not([disabled]) {
        background: rgba(139, 92, 246, 0.1);
      }
      :host-context(html[data-theme="light"]) .pf-bk-cal__cell--today {
        color: #7c3aed;
      }
      :host-context(html[data-theme="light"])
        .pf-bk-step__hdr
        > span:first-child {
        background: rgba(139, 92, 246, 0.12);
        color: #7c3aed;
      }
      :host-context(html[data-theme="light"]) .pf-bk-tests__chip {
        background: rgba(139, 92, 246, 0.12);
        border-color: rgba(139, 92, 246, 0.22);
        color: #4c1d95;
      }
      :host-context(html[data-theme="light"]) .pf-bk-tests__row:hover {
        background: rgba(139, 92, 246, 0.08);
      }
      :host-context(html[data-theme="light"]) .pf-bk-tests__row--on {
        background: rgba(139, 92, 246, 0.16);
        color: #1e293b;
      }
      :host-context(html[data-theme="light"]) .pf-bk-tests__row--on::before {
        color: #7c3aed;
      }

      /* ── Header / footer ───────────────────────────────────── */
      .pf-bk-hdr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 18px 22px 14px;
        border-bottom: 1px solid var(--glass-border);
      }
      .pf-bk-hdr h2 {
        margin: 0;
        font-size: 17px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .pf-bk-hdr p {
        margin: 2px 0 0;
        font-size: 12.5px;
        color: var(--text-secondary);
      }
      .pf-bk-x {
        width: 32px;
        height: 32px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 9px;
        color: var(--text-muted);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .pf-bk-x:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
        border-color: var(--glass-border);
      }

      .pf-bk-foot {
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: flex-end;
        padding: 14px 22px;
        border-top: 1px solid var(--glass-border);
      }
      .pf-bk-error {
        flex: 1;
        color: #fca5a5;
        font-size: 12.5px;
      }

      .pf-bk-btn {
        padding: 0.55rem 1rem;
        font-size: 12.5px;
        font-weight: 600;
        border-radius: 9px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .pf-bk-btn[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .pf-bk-btn--ghost {
        background: transparent;
        color: var(--text-secondary);
        border-color: var(--glass-border);
      }
      .pf-bk-btn--ghost:hover:not([disabled]) {
        background: var(--bg-hover);
        color: var(--text-primary);
      }
      .pf-bk-btn--primary {
        background: linear-gradient(135deg, #8b5cf6, #ec4899);
        color: white;
        box-shadow: 0 6px 18px rgba(124, 58, 237, 0.32);
      }
      .pf-bk-btn--primary:hover:not([disabled]) {
        filter: brightness(1.08);
      }

      /* ── Body grid ─────────────────────────────────────────── */
      .pf-bk-grid {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 22px 6px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 18px;
      }
      @media (max-width: 760px) {
        .pf-bk-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .pf-bk-col {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
      }
      .pf-bk-step {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .pf-bk-step--grow {
        flex: 1;
        min-height: 0;
      }
      .pf-bk-step__hdr {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .pf-bk-step__hdr > span:first-child {
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        background: rgba(168, 85, 247, 0.16);
        color: #c4b5fd;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
      }

      /* Patient summary tile after pick */
      .pf-bk-patient {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
      }
      .pf-bk-patient__name {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .pf-bk-patient__meta {
        margin: 1px 0 0;
        font-size: 12px;
        color: var(--text-secondary);
      }
      .pf-bk-mono {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
      }
      .pf-bk-link {
        margin-left: auto;
        background: transparent;
        border: 0;
        color: #c4b5fd;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
      }
      .pf-bk-link:hover {
        color: #ddd6fe;
        text-decoration: underline;
      }

      /* Mini-month nav row */
      .pf-bk-mininav {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
        color: var(--text-secondary);
        letter-spacing: 0.04em;
        text-transform: none;
      }
      .pf-bk-mininav button {
        width: 22px;
        height: 22px;
        background: transparent;
        border: 1px solid var(--glass-border);
        border-radius: 6px;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
      }
      .pf-bk-mininav button:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      /* Mini-month grid */
      .pf-bk-cal {
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        padding: 10px;
      }
      .pf-bk-cal__dows {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
        margin-bottom: 6px;
        text-align: center;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        color: var(--text-tertiary);
        text-transform: uppercase;
      }
      .pf-bk-cal__grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
      }
      .pf-bk-cal__cell {
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background 0.12s ease,
          color 0.12s ease;
      }
      .pf-bk-cal__cell:hover:not([disabled]) {
        background: rgba(168, 85, 247, 0.1);
      }
      .pf-bk-cal__cell--out {
        color: var(--text-muted);
        opacity: 0.5;
      }
      .pf-bk-cal__cell--today {
        color: #c4b5fd;
      }
      .pf-bk-cal__cell--on {
        background: linear-gradient(135deg, #8b5cf6, #ec4899) !important;
        color: white !important;
        box-shadow: 0 4px 10px rgba(124, 58, 237, 0.32);
      }
      .pf-bk-cal__cell[disabled] {
        opacity: 0.32;
        cursor: not-allowed;
      }

      /* Slots */
      .pf-bk-slots {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
        gap: 6px;
        flex: 1;
        min-height: 140px;
        max-height: 360px;
        overflow-y: auto;
        padding: 6px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
      }
      .pf-bk-slot {
        padding: 8px 10px;
        background: transparent;
        border: 1px solid var(--glass-border);
        border-radius: 8px;
        color: var(--text-primary);
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background 0.12s ease,
          color 0.12s ease,
          border-color 0.12s ease;
        position: relative;
      }
      .pf-bk-slot:hover:not([disabled]) {
        background: rgba(168, 85, 247, 0.1);
        border-color: rgba(168, 85, 247, 0.4);
      }
      .pf-bk-slot--on {
        background: linear-gradient(135deg, #8b5cf6, #ec4899) !important;
        border-color: transparent !important;
        color: white !important;
      }
      .pf-bk-slot[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .pf-bk-slot__note {
        display: block;
        font-size: 9.5px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-weight: 600;
        color: #fca5a5;
        margin-top: 2px;
      }

      .pf-bk-textarea {
        width: 100%;
        padding: 10px 12px;
        background: var(--input-bg);
        border: 1px solid var(--input-border);
        color: var(--input-text);
        border-radius: 10px;
        font-family: inherit;
        font-size: 13px;
        resize: vertical;
        outline: none;
      }
      .pf-bk-textarea:focus {
        border-color: var(--input-border-focus);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
      }

      .pf-bk-empty {
        color: var(--text-muted);
        font-size: 12.5px;
        padding: 8px 4px;
      }

      /* ── Test picker (Step 4) ────────────────────────────────── */
      .pf-bk-step__badge {
        margin-left: auto;
        padding: 1px 8px;
        border-radius: 9999px;
        background: rgba(168, 85, 247, 0.18);
        color: #c4b5fd;
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: none;
      }
      .pf-bk-tests__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .pf-bk-tests__chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: linear-gradient(
          135deg,
          rgba(139, 92, 246, 0.32),
          rgba(236, 72, 153, 0.28)
        );
        border: 1px solid rgba(168, 85, 247, 0.45);
        border-radius: 9999px;
        color: #ede9fe;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .pf-bk-tests__chip:hover {
        filter: brightness(1.1);
      }
      .pf-bk-tests__chip > svg {
        opacity: 0.85;
      }

      .pf-bk-tests__search {
        width: 100%;
        padding: 8px 12px;
        background: var(--input-bg);
        border: 1px solid var(--input-border);
        color: var(--input-text);
        border-radius: 10px;
        font-size: 12.5px;
        outline: none;
        margin-bottom: 6px;
      }
      .pf-bk-tests__search:focus {
        border-color: var(--input-border-focus);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
      }
      .pf-bk-tests__list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 180px;
        overflow-y: auto;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 10px;
      }
      .pf-bk-tests__row {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: transparent;
        border: 0;
        cursor: pointer;
        color: var(--text-primary);
        font-size: 12.5px;
        text-align: left;
        border-bottom: 1px solid var(--glass-border);
      }
      .pf-bk-tests__row:last-child {
        border-bottom: 0;
      }
      .pf-bk-tests__row:hover {
        background: rgba(168, 85, 247, 0.08);
      }
      .pf-bk-tests__row--on {
        background: rgba(168, 85, 247, 0.16);
        color: #ede9fe;
      }
      .pf-bk-tests__row--on::before {
        content: "✓";
        color: #c4b5fd;
        font-weight: 700;
      }
      .pf-bk-tests__name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .pf-bk-tests__code {
        flex: 0 0 auto;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 10.5px;
        color: var(--text-tertiary);
        letter-spacing: 0.04em;
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

  // Branch config + slots.
  private readonly _config = signal<AppointmentConfigDto | null>(null);
  private readonly _slots = signal<SlotInfo[]>([]);
  private readonly _tests = signal<Test[]>([]);
  private readonly _saving = signal(false);
  private readonly _errorMsg = signal<string | null>(null);

  readonly slots = this._slots.asReadonly();
  /** Loading == "haven't fetched the branch config yet". Derived directly
   *  from _config so we can never end up with a stale loading flag. */
  readonly loadingSlots = computed(() => this._config() === null);
  readonly saving = this._saving.asReadonly();
  readonly errorMsg = this._errorMsg.asReadonly();

  readonly open = computed(() => this.booking.request() !== null);

  readonly patientName = computed(() => patientDisplayName(this.patient()));
  readonly canSubmit = computed(
    () => !!this.patient() && !!this.selectedDate() && !!this.selectedTime(),
  );

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
    if (req.time) this.selectedTime.set(req.time);
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
    this.recomputeSlots();
  }

  // ── Slots ───────────────────────────────────────────────────
  selectTime(t: string) {
    this.selectedTime.set(t);
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
   * branch config. We don't query the server for taken slots in v1 — the
   * grid is generated locally; uniqueness is enforced at submit.
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
        const hh = String(Math.floor(m / 60)).padStart(2, "0");
        const mm = String(m % 60).padStart(2, "0");
        slots.push({ time: `${hh}:${mm}`, available: true, bookedCount: 0 });
      }
    }
    this._slots.set(slots);

    // The user clicked a calendar slot at e.g. 08:43, but our grid is
    // built in 30-min increments (08:30, 09:00, …). Snap the staged
    // selection to the nearest available slot so it actually highlights
    // and the header reads the resolved time.
    const wanted = this.selectedTime();
    if (wanted && slots.length > 0 && !slots.some((s) => s.time === wanted)) {
      const wantedMin = parseHHmm(wanted);
      const nearest = slots.reduce((best, cur) => {
        const d = Math.abs(parseHHmm(cur.time) - wantedMin);
        return d < Math.abs(parseHHmm(best.time) - wantedMin) ? cur : best;
      });
      this.selectedTime.set(nearest.time);
    }
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
