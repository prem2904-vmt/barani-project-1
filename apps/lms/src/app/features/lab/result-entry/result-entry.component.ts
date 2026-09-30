import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, QueryList, ViewChildren, computed, effect, inject, signal } from '@angular/core';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { finalize } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ScanService } from '../../../core/services/scan.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { OrderTest } from '../../../shared/models/order.model';
import { chosenSpecimen } from '../../../shared/utils/micro-specimen';
import { TatState, linePriority, tatDetail, tatInfo } from '../../../shared/utils/lab-priority';
import { patientDisplayName, formatPatientInfo } from '../../../shared/models/patient.model';
import { ReferenceRange, TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { EditResultDialogComponent } from '../../../shared/components/edit-result-dialog/edit-result-dialog.component';
import { AuthService } from '../../../core/auth/auth.service';
import { fillUnit, formatRange, normalizeReportText, normalizeSex, selectReferenceRange } from '../../../shared/utils/reference-range';
import { criticalBadge, flagChipTitle, flagCodeOf, liveFlag, parseResultSnapshot, savedFlagOf } from '../../../shared/utils/result-flag';
import { effectiveMethodology } from '../../../shared/utils/methodology';
import { qualitativeOptionsFor } from '../../../shared/utils/qualitative';
import { choiceOptionsFor, resolveParamEntryKind } from '../../../shared/utils/param-entry-kind';
import { paramToField, readParameters } from '../../../shared/utils/test-parameters';
import { CalcContext, evaluateCalc, parseCalc } from '../../../shared/utils/calculation';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { FormField, evaluateShowWhen, validateFieldValue } from '../../../shared/forms';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { NumpadDirective, NumpadScopeDirective } from '../../../shared/components/numpad/numpad.directive';
import { NumpadService } from '../../../shared/components/numpad/numpad.service';
import { ageInYears, bandAgeYears, formatAge } from '../../../shared/utils/patient-age';
import { ReportNotesStore } from '../../../shared/components/report-note/report-notes.store';
import { ReportNotesCardComponent } from '../../../shared/components/report-note/report-notes-card.component';

interface EnterResponse {
  orderTest: OrderTest;
  flags: { critical: boolean; notifications: string[] };
}

type FlagTone = 'critical' | 'low' | 'high' | 'normal';
interface Flag { tone: FlagTone; label: string }

// Render kinds the main parameter switch handles. Used by inputKindFor()
// and the template below. Kept broad so each field type can diverge from
// the single-chip 'choice' bucket they used to share.
type InputKind =
  | 'numeric'
  | 'text'
  | 'textarea'
  | 'radio'
  | 'yesno'
  | 'yesnona'
  | 'dropdown'
  | 'chips-multi'
  | 'buttonSelect'
  | 'toggle'
  | 'checkbox'
  | 'date'
  | 'time'
  | 'datetime'
  | 'phone'
  | 'email'
  | 'duration'
  | 'size'
  | 'measure'
  | 'image-select'
  | 'voice-text'
  | 'file'
  | 'image-gallery'
  | 'canvas'
  | 'stub'
  | 'section-header'
  | 'info-text';

// Duration unit options by field type — keeps the compound input simple.
const DURATION_UNITS_LONG = ['days', 'weeks', 'months', 'years'] as const;
const DURATION_UNITS_TIME = ['seconds', 'minutes', 'hours', 'days'] as const;
const DURATION_PERIODS = ['morning', 'afternoon', 'evening', 'night'] as const;
const SIZE_UNITS = ['cm', 'mm', 'inch', 'feet', 'meter'] as const;

@Component({
  selector: 'pf-result-entry',
  standalone: true,
  imports: [
    BarcodeScannerModalComponent,
    TatIndicatorComponent,
    AvatarComponent,
    ChipComponent,
    NumPadComponent,
    TileComponent,
    SelectComponent,
    EditResultDialogComponent,
    NumpadDirective,
    NumpadScopeDirective,
    BusyDirective,
    SkeletonCardComponent,
    ReportNotesCardComponent,
  ],
  // Technician report notes (Lab settings switch) — one store per screen.
  providers: [ReportNotesStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- pfNumpadScope: the touch numpad's Next walks the parameters down the
         list and ends on Submit. -->
    <section class="pf-page" pfNumpadScope="[data-param]" pfNumpadCta=".pf-head__btn--primary">
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="pf-head">
          <button type="button" class="pf-head__back press" (click)="back()" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            <span class="hidden sm:inline">Back</span>
          </button>

          @if (navBack.showBack()) {
            <button type="button" class="pf-hdr-back shrink-0 self-center inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          }

          <h1 class="pf-head__title">{{ orderTest()?.test?.name ?? 'Result entry' }}</h1>
          @if (specimenLabel(); as sp) {
            <!-- Specimen chosen at the order desk (non-culture; culture shows it on the bench). -->
            <span class="nd-chip nd-chip--static pf-head__spec" title="Specimen chosen at the order desk">Specimen: {{ sp }}</span>
          }

          @if (autoSavedAgo(); as t) {
            <span class="pf-autosave"><span class="pf-autosave__dot"></span>saved · {{ t }}</span>
          }

          <!-- Primary & secondary actions right-aligned in the header -->
          <div class="pf-head__actions">
            @if (canEditResult() && editOrderId()) {
              <!-- Submitted or signed off already? Pull the work back for correction. -->
              <button type="button" class="pf-head__btn pf-head__btn--ghost press"
                      (click)="editDialogOpen.set(true)" aria-label="Edit result">
                Edit
              </button>
            }
            <button type="button" class="pf-head__btn pf-head__btn--ghost press"
                    (click)="rejectSample()" aria-label="Reject sample"
                    [disabled]="rejecting()" [pfBusy]="rejecting()" pfBusyLabel="Rejecting…">
              Reject
            </button>
            <button type="button" class="pf-head__btn pf-head__btn--secondary press"
                    (click)="saveDraft()" [disabled]="saving()">
              Save draft
            </button>
            <button type="button"
                    class="pf-head__btn pf-head__btn--primary press"
                    [class.pf-head__btn--danger]="hasCritical()"
                    (click)="submit()"
                    [disabled]="saving() || !canSubmit()" [pfBusy]="saving()" pfBusyLabel="Submitting…">
              {{ hasCritical() ? 'Submit · notify' : 'Submit' }}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14m-5-6 6 6-6 6"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      @if (editDialogOpen() && editOrderId(); as oid) {
        <pf-edit-result-dialog
          [orderId]="oid"
          title="Send results back for correction"
          (edited)="onEdited()"
          (closed)="editDialogOpen.set(false)">
        </pf-edit-result-dialog>
      }

      <!-- Body: static chrome around a scrolling param list.
           Mobile (<md): single col, FAB opens numpad drawer.
           Tablet / iPad (md to xl-): rail docked on the right.
           Desktop (≥1280px with a mouse, dt.desktop-only on .pf-re-body): no
           rail, full-width params; touch-first devices keep the rail. -->
      <div class="pf-page__body px-4 md:px-8 lg:px-10 grid grid-cols-1 md:grid-cols-[1fr_300px] lg:grid-cols-[1fr_340px] gap-5 pf-re-body">

        <!-- LEFT COLUMN — flex column, only params inside scroll -->
        <div class="pf-col-left min-w-0">

          <!-- Sent-back banner — the pathologist rejected this result and
               sent it back for re-entry. Surfaces the WHY at the top so
               the tech reads it before touching the values. Visual pattern
               mirrors sample-result-entry's reject banner. -->
          @if (orderTest(); as t) {
            @if (t.status === 're_entry' && t.rejectionReason) {
              <div class="pf-reject-banner pf-col-static">
                <span class="pf-reject-banner__icon" aria-hidden="true">↻</span>
                <p class="pf-reject-banner__text">
                  <strong>Sent back:</strong> {{ t.rejectionReason }}
                </p>
              </div>
            }
          }

          <!-- Patient + TAT — single compact row -->
          @if (orderTest(); as t) {
            <pf-tile [tone]="panelTone()" padding="sm" class="pf-col-static pf-patient-tile">
              <div class="pf-patient-bar">
                <pf-avatar [name]="patientName()" [size]="40"></pf-avatar>
                <div class="pf-patient-bar__id">
                  <p class="pf-patient-bar__name">{{ patientInfoString() }}</p>
                  <p class="pf-patient-bar__meta">
                    {{ t.test?.department?.name ?? '—' }}
                    <span class="pf-patient-bar__sep">·</span> TAT {{ t.test?.tatHours }}h
                    @if (priority() === 'urgent') {
                      <span class="pf-patient-bar__sep">·</span> <span class="pf-prio-urgent">Urgent</span>
                    }
                  </p>
                </div>
                <div class="pf-patient-bar__prog">
                  <div class="pf-tat-track">
                    <div class="pf-tat-fill"
                         [class]="'pf-tat-' + tatState()"
                         [style.width.%]="tatPercent()"></div>
                  </div>
                </div>
                <pf-tat-indicator [remainingMinutes]="tatClock().remainingMin" [dueAt]="tatClock().dueAt"></pf-tat-indicator>
              </div>
            </pf-tile>
          }

          <!-- Results — the ONLY scrolling area on the page -->
          <!-- Critical values indicate themselves via row tint + flag pill;
               no separate banner needed. -->
          @if (recordSkeleton()) {
            <!-- The result on its way: the results card's shape on the first
                 frame (held 600ms), never an empty column. -->
            <pf-tile tone="default" padding="lg" class="pf-col-static pf-re-skel">
              <pf-skeleton-card [lines]="5" [boxed]="false" label="Loading the result…"></pf-skeleton-card>
            </pf-tile>
          } @else if (isCulture()) {
            <pf-tile tone="default" padding="lg" class="pf-col-scrolls">
              <header class="pf-col-scrolls__head pf-results-head">
                <span class="pf-results-head__eyebrow">Culture &amp; Sensitivity</span>
              </header>
              <div class="pf-col-scrolls__body px-1 pt-2">
                <!-- Culture is worked on the Culture case page (one screen). -->
                <button type="button" class="nd-row pf-re-culturelink press" (click)="openCultureBench()"
                        aria-label="Open this culture on the culture bench">
                  <span class="nd-row__name">Culture: open on the bench</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>
            </pf-tile>
          } @else if (parameters().length > 0) {
            <pf-tile tone="default" padding="sm" class="pf-col-scrolls">
              <header class="pf-col-scrolls__head pf-results-head">
                <span class="pf-results-head__eyebrow">Results</span>
                <span class="pf-results-head__count">
                  <span class="pf-results-head__filled">{{ filledCount() }}</span>
                  <span class="pf-results-head__sep">/</span>
                  <span class="pf-results-head__total">{{ requiredCount() }}</span>
                </span>
                <span class="pf-results-head__dots" aria-hidden="true">
                  @for (p of parameters(); track p.name) {
                    <span class="pf-dot-pip"
                          [class.pf-dot-pip--filled]="isFilled(p.name)"
                          [class.pf-dot-pip--active]="activeParam() === p.name"></span>
                  }
                </span>
                <span class="pf-results-head__pct">{{ filledPercentRounded() }}%</span>

                <!-- Grid / Cards view toggle. Grid mirrors the eventual report
                     PDF (Parameter · Result · Unit · Reference · Method) so
                     techs see the same layout they're filling toward. Cards
                     are kept as the fallback for tests with complex composed
                     widgets that don't fit a single-cell input. -->
                <span class="pf-view-toggle" role="group" aria-label="Result view">
                  <button type="button"
                          class="pf-view-toggle__btn"
                          [class.pf-view-toggle__btn--on]="viewMode() === 'grid'"
                          (click)="setViewMode('grid')"
                          aria-label="Grid view">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
                    </svg>
                  </button>
                  <button type="button"
                          class="pf-view-toggle__btn"
                          [class.pf-view-toggle__btn--on]="viewMode() === 'cards'"
                          (click)="setViewMode('cards')"
                          aria-label="Card view">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="4" width="18" height="5" rx="1"/>
                      <rect x="3" y="11" width="18" height="5" rx="1"/>
                      <rect x="3" y="18" width="18" height="3" rx="1"/>
                    </svg>
                  </button>
                </span>
              </header>

              <!-- ── GRID VIEW ── Mirrors the report layout columns. -->
              @if (viewMode() === 'grid') {
                <div class="pf-result-grid-wrap pf-col-scrolls__body">
                  <table class="pf-result-grid">
                    <thead>
                      <tr>
                        <th class="pf-rg__col-param">Parameter</th>
                        <th class="pf-rg__col-result">Result</th>
                        <th class="pf-rg__col-unit">Unit</th>
                        <th class="pf-rg__col-range">Reference range</th>
                        <th class="pf-rg__col-method">Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (p of parameters(); track p.name; let idx = $index) {
                        @let kind = inputKindFor(p);
                        @if (isLayoutKind(kind)) {
                          <tr class="pf-result-grid__row pf-result-grid__row--section">
                            <td colspan="5">
                              @if (kind === 'section-header') {
                                <strong>{{ p.title }}</strong>
                              } @else {
                                <em>{{ p.normalValue ?? p.title }}</em>
                              }
                            </td>
                          </tr>
                        } @else {
                          <tr class="pf-result-grid__row"
                              [class.pf-result-grid__row--filled]="isFilled(p.name)"
                              [class.pf-result-grid__row--active]="activeParam() === p.name"
                              [class.pf-result-grid__row--critical]="isParamCritical(p)">
                            <td class="pf-rg__c-param">
                              <span class="pf-rg__idx">{{ idx + 1 }}</span>
                              {{ p.title }}
                              <span class="pf-rg__req">*</span>
                            </td>
                            <td class="pf-rg__c-result">
                              @switch (kind) {
                                @case ('numeric') {
                                  <input type="number" inputmode="decimal" step="any"
                                         class="pf-rg__input pf-rg__input--num"
                                         pfNumpad
                                         [pfNumpadLabel]="p.title || p.name"
                                         [pfNumpadUnit]="p.unit ?? null"
                                         [pfNumpadFlag]="flagFor(p)"
                                         [attr.data-numpad-skip]="calcChipFor(p) ? '' : null"
                                         [class.pf-rg__input--outr]="isOutOfRange(p)"
                                         [class.pf-rg__input--crit]="isParamCritical(p)"
                                         [class.pf-rg__input--invalid]="isInvalidNumeric(p)"
                                         [value]="valueOf(p.name) ?? ''"
                                         [attr.data-param]="p.name"
                                         (focus)="setActive(p.name)"
                                         (input)="setValue(p.name, asInput($event))"
                                         (keydown)="allowOnlyNumbers($event)"
                                         (keydown.enter)="advanceFrom(p.name)"
                                         (paste)="onNumericPaste($event, p.name)"
                                         placeholder="—"/>
                                }
                                @case ('dropdown') {
                                  <select class="pf-rg__input pf-rg__select"
                                          [value]="valueOf(p.name) ?? ''"
                                          [attr.data-param]="p.name"
                                          (focus)="setActive(p.name)"
                                          (change)="setValue(p.name, asSelect($event))"
                                          (keydown.enter)="advanceFrom(p.name)">
                                    @if (isQualitative(p)) {
                                      <!-- Qualitative pos/neg results are optional — offer a real empty choice. -->
                                      <option value="" [selected]="!valueOf(p.name)">—</option>
                                    } @else {
                                      <option value="" disabled [selected]="!valueOf(p.name)">— Choose —</option>
                                    }
                                    @for (opt of optionsFor(p); track opt) {
                                      <option [value]="opt" [selected]="valueOf(p.name) === opt">{{ opt }}</option>
                                    }
                                  </select>
                                }
                                @case ('radio') {
                                  <select class="pf-rg__input pf-rg__select"
                                          [value]="valueOf(p.name) ?? ''"
                                          [attr.data-param]="p.name"
                                          (focus)="setActive(p.name)"
                                          (change)="setValue(p.name, asSelect($event))"
                                          (keydown.enter)="advanceFrom(p.name)">
                                    <option value="" disabled [selected]="!valueOf(p.name)">— Choose —</option>
                                    @for (opt of optionsFor(p); track opt) {
                                      <option [value]="opt" [selected]="valueOf(p.name) === opt">{{ opt }}</option>
                                    }
                                  </select>
                                }
                                @case ('yesno') {
                                  <select class="pf-rg__input pf-rg__select"
                                          [value]="valueOf(p.name) ?? ''"
                                          [attr.data-param]="p.name"
                                          (focus)="setActive(p.name)"
                                          (change)="setValue(p.name, asSelect($event))"
                                          (keydown.enter)="advanceFrom(p.name)">
                                    <option value="" disabled [selected]="!valueOf(p.name)">— Choose —</option>
                                    <option value="yes" [selected]="valueOf(p.name) === 'yes'">Yes</option>
                                    <option value="no"  [selected]="valueOf(p.name) === 'no'">No</option>
                                  </select>
                                }
                                @case ('textarea') {
                                  <textarea class="pf-rg__input pf-rg__textarea" rows="1"
                                            [value]="valueOf(p.name) ?? ''"
                                            [attr.data-param]="p.name"
                                            (focus)="setActive(p.name)"
                                            (input)="setValue(p.name, asInput($event))"
                                            (keydown.enter)="advanceFrom(p.name)"
                                            placeholder="—"></textarea>
                                }
                                @case ('date') {
                                  <input type="date" class="pf-rg__input pf-rg__date"
                                         [value]="valueOf(p.name) ?? ''"
                                         [attr.data-param]="p.name"
                                         (focus)="setActive(p.name)"
                                         (change)="setValue(p.name, asInput($event))"
                                         (keydown.enter)="advanceFrom(p.name)"/>
                                }
                                @case ('phone') {
                                  <input type="tel" inputmode="tel" class="pf-rg__input"
                                         [value]="valueOf(p.name) ?? ''"
                                         [attr.data-param]="p.name"
                                         (focus)="setActive(p.name)"
                                         (input)="setValue(p.name, asInput($event))"
                                         (keydown.enter)="advanceFrom(p.name)"
                                         placeholder="—"/>
                                }
                                @case ('email') {
                                  <input type="email" inputmode="email" class="pf-rg__input"
                                         [value]="valueOf(p.name) ?? ''"
                                         [attr.data-param]="p.name"
                                         (focus)="setActive(p.name)"
                                         (input)="setValue(p.name, asInput($event))"
                                         (keydown.enter)="advanceFrom(p.name)"
                                         placeholder="—"/>
                                }
                                @case ('time') {
                                  <input type="time" class="pf-rg__input pf-rg__date"
                                         [value]="valueOf(p.name) ?? ''"
                                         [attr.data-param]="p.name"
                                         (focus)="setActive(p.name)"
                                         (change)="setValue(p.name, asInput($event))"
                                         (keydown.enter)="advanceFrom(p.name)"/>
                                }
                                @case ('datetime') {
                                  <input type="datetime-local" class="pf-rg__input pf-rg__date"
                                         [value]="valueOf(p.name) ?? ''"
                                         [attr.data-param]="p.name"
                                         (focus)="setActive(p.name)"
                                         (change)="setValue(p.name, asInput($event))"
                                         (keydown.enter)="advanceFrom(p.name)"/>
                                }
                                @default {
                                  <input type="text" class="pf-rg__input"
                                         [value]="valueOf(p.name) ?? ''"
                                         [attr.data-param]="p.name"
                                         (focus)="setActive(p.name)"
                                         (input)="setValue(p.name, asInput($event))"
                                         (keydown.enter)="advanceFrom(p.name)"
                                         placeholder="—"/>
                                }
                              }
                              @if (calcChipFor(p); as c) {
                                <span class="pf-rg__calc" [attr.data-kind]="c.kind">{{ c.label }}</span>
                              }
                              @if (flagFor(p); as fl) {
                                <span class="pf-rg__flag" [attr.data-tone]="fl.tone" [attr.title]="flagChipTitle(fl)">{{ fl.label }}</span>
                              }
                            </td>
                            <td class="pf-rg__c-unit">{{ p.unit ?? '—' }}</td>
                            <td class="pf-rg__c-range">
                              @if (refLabel(p); as r) { {{ r }} } @else { — }
                            </td>
                            <td class="pf-rg__c-method">
                              {{ methodologyFor(p) }}
                            </td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              } @else {

              <div class="pf-params pf-col-scrolls__body">
                @for (p of parameters(); track p.name; let idx = $index) {
                  <div class="pf-param"
                       [class.pf-param--active]="activeParam() === p.name"
                       [class.pf-param--critical]="isParamCritical(p)"
                       [class.pf-param--error]="hasErrorFor(p.name)"
                       [attr.data-kind]="inputKindFor(p)"
                       (click)="setActive(p.name)">
                    <div class="pf-param__head">
                      <p class="pf-param__label">
                        <span class="pf-param__idx">{{ idx + 1 }}</span>
                        {{ p.title }}
                        <span class="pf-param__req">*</span>
                      </p>
                      <p class="pf-param__ref">
                        @if (refLabel(p); as r) { Reference: {{ r }} }
                        @else if (p.unit) { in {{ p.unit }} }
                      </p>
                    </div>

                    <!-- Input + inline flag live in the same cell; the flag pushes
                         to the right when present, otherwise input gets the full width. -->
                    <div class="pf-param__cell">
                      @switch (inputKindFor(p)) {
                        @case ('dropdown') {
                          <div [attr.data-param]="p.name" (click)="setActive(p.name)">
                            <!-- Qualitative pos/neg results are optional — prepend a real empty '—' choice. -->
                            <pf-select
                              placeholder="— Choose —"
                              [options]="isQualitative(p)
                                ? [{ value: '', label: '—' }, ...optionsFor(p).map(o => ({ value: o, label: o }))]
                                : optionsFor(p).map(o => ({ value: o, label: o }))"
                              [value]="valueOf(p.name) ?? ''"
                              (valueChange)="setValue(p.name, $event)">
                            </pf-select>
                          </div>
                        }
                        @case ('chips-multi') {
                          <div class="pf-param__choices">
                            @for (opt of p.options ?? []; track opt) {
                              <pf-chip
                                [selected]="isOptionOn(p.name, opt)"
                                (tapped)="toggleOption(p.name, opt)">
                                {{ opt }}
                              </pf-chip>
                            }
                          </div>
                        }
                        @case ('buttonSelect') {
                          <div class="pf-param__btnsel">
                            @for (opt of p.options ?? []; track opt) {
                              <button type="button"
                                      class="pf-btnsel__opt press"
                                      [class.pf-btnsel__opt--on]="valueOf(p.name) === opt"
                                      (click)="setValue(p.name, opt)">
                                {{ opt }}
                              </button>
                            }
                          </div>
                        }
                        @case ('toggle') {
                          <label class="pf-toggle-row">
                            <input type="checkbox"
                                   class="pf-toggle-input"
                                   [checked]="boolValueOf(p.name)"
                                   (change)="setBoolValue(p.name, $any($event.target).checked)" />
                            <span class="pf-toggle-track"><span class="pf-toggle-thumb"></span></span>
                            <span class="pf-toggle-label">{{ boolValueOf(p.name) ? 'On' : 'Off' }}</span>
                          </label>
                        }
                        @case ('checkbox') {
                          <label class="pf-checkbox-row">
                            <input type="checkbox"
                                   [checked]="boolValueOf(p.name)"
                                   (change)="setBoolValue(p.name, $any($event.target).checked)" />
                            <span>{{ boolValueOf(p.name) ? 'Yes' : 'No' }}</span>
                          </label>
                        }
                        @case ('date') {
                          <input type="date"
                                 class="pf-param__input pf-param__date"
                                 [value]="valueOf(p.name) ?? ''"
                                 [attr.data-param]="p.name"
                                 (focus)="setActive(p.name)"
                                 (change)="setValue(p.name, asInput($event))"
                                 (keydown.enter)="advanceFrom(p.name)"/>
                        }
                        @case ('section-header') {
                          <h4 class="pf-section-heading">{{ p.title }}</h4>
                        }
                        @case ('info-text') {
                          <p class="pf-info-note">{{ p.normalValue ?? p.title }}</p>
                        }
                        @case ('radio') {
                          <div class="pf-param__radio">
                            @for (opt of p.options ?? []; track opt) {
                              <label class="pf-radio-row" (click)="setValue(p.name, opt)">
                                <span class="pf-radio-dot"
                                      [class.pf-radio-dot--on]="valueOf(p.name) === opt"></span>
                                <span>{{ opt }}</span>
                              </label>
                            }
                          </div>
                        }
                        @case ('yesno') {
                          <div class="pf-param__choices">
                            <pf-chip [selected]="valueOf(p.name) === 'yes'" (tapped)="setValue(p.name, 'yes')">Yes</pf-chip>
                            <pf-chip [selected]="valueOf(p.name) === 'no'"  (tapped)="setValue(p.name, 'no')">No</pf-chip>
                          </div>
                        }
                        @case ('yesnona') {
                          <div class="pf-param__choices">
                            <pf-chip [selected]="valueOf(p.name) === 'yes'" (tapped)="setValue(p.name, 'yes')">Yes</pf-chip>
                            <pf-chip [selected]="valueOf(p.name) === 'no'"  (tapped)="setValue(p.name, 'no')">No</pf-chip>
                            <pf-chip [selected]="valueOf(p.name) === 'na'"  (tapped)="setValue(p.name, 'na')">N/A</pf-chip>
                          </div>
                        }
                        @case ('phone') {
                          <input type="tel"
                                 inputmode="tel"
                                 class="pf-param__input"
                                 [value]="valueOf(p.name) ?? ''"
                                 [attr.data-param]="p.name"
                                 (focus)="setActive(p.name)"
                                 (input)="setValue(p.name, asInput($event))"
                                 (keydown.enter)="advanceFrom(p.name)"
                                 placeholder="+91 98765 43210"/>
                        }
                        @case ('email') {
                          <input type="email"
                                 inputmode="email"
                                 class="pf-param__input"
                                 [value]="valueOf(p.name) ?? ''"
                                 [attr.data-param]="p.name"
                                 (focus)="setActive(p.name)"
                                 (input)="setValue(p.name, asInput($event))"
                                 (keydown.enter)="advanceFrom(p.name)"
                                 placeholder="name@example.com"/>
                        }
                        @case ('time') {
                          <input type="time"
                                 class="pf-param__input pf-param__date"
                                 [value]="valueOf(p.name) ?? ''"
                                 [attr.data-param]="p.name"
                                 (focus)="setActive(p.name)"
                                 (change)="setValue(p.name, asInput($event))"
                                 (keydown.enter)="advanceFrom(p.name)"/>
                        }
                        @case ('datetime') {
                          <input type="datetime-local"
                                 class="pf-param__input pf-param__date"
                                 [value]="valueOf(p.name) ?? ''"
                                 [attr.data-param]="p.name"
                                 (focus)="setActive(p.name)"
                                 (change)="setValue(p.name, asInput($event))"
                                 (keydown.enter)="advanceFrom(p.name)"/>
                        }
                        @case ('duration') {
                          <div class="pf-param__duration">
                            <input type="text"
                                   inputmode="numeric"
                                   class="pf-param__input pf-param__input--num"
                                   pfNumpad pfNumpadKeys="digits"
                                   [pfNumpadLabel]="p.title || p.name"
                                   [value]="durationValueOf(p.name).value ?? ''"
                                   (focus)="setActive(p.name)"
                                   (input)="setDurationValue(p.name, { value: toNumOrNull(asInput($event)) })"
                                   (keydown)="allowOnlyNumbers($event)"
                                   placeholder="0" />
                            <pf-select
                              [options]="durationUnitsFor(p).map(u => ({ value: u, label: u }))"
                              [value]="durationValueOf(p.name).unit"
                              (valueChange)="setDurationValue(p.name, { unit: $any($event) })">
                            </pf-select>
                          </div>
                        }
                        @case ('size') {
                          <div class="pf-param__size">
                            @for (i of sizeIndexesFor(p); track i) {
                              <input type="text"
                                     inputmode="decimal"
                                     class="pf-param__input pf-param__input--num"
                                     pfNumpad pfNumpadKeys="digits ."
                                     [pfNumpadLabel]="p.title || p.name"
                                     [pfNumpadUnit]="sizeValueOf(p.name).unit"
                                     [value]="sizeValueOf(p.name).values[i] ?? ''"
                                     (focus)="setActive(p.name)"
                                     (input)="setSizeValueAt(p.name, i, toNumOrNull(asInput($event)))"
                                     (keydown)="allowOnlyNumbers($event)"
                                     placeholder="—"/>
                            }
                            <pf-select
                              class="pf-param__size-unit"
                              [options]="sizeUnits.map(u => ({ value: u, label: u }))"
                              [value]="sizeValueOf(p.name).unit"
                              (valueChange)="setSizeUnit(p.name, $any($event))">
                            </pf-select>
                          </div>
                        }
                        @case ('measure') {
                          <div class="pf-param__measure">
                            <input type="range"
                                   class="pf-param__range"
                                   [attr.min]="measureBounds(p).min"
                                   [attr.max]="measureBounds(p).max"
                                   [attr.step]="measureBounds(p).step"
                                   [value]="measureValueOf(p.name).value ?? measureBounds(p).min"
                                   (input)="setMeasureValue(p.name, toNum(asInput($event)))"/>
                            <span class="pf-param__measure-readout">
                              {{ measureValueOf(p.name).value ?? '—' }}
                              <span class="pf-param__measure-unit">{{ measureValueOf(p.name).unit || p.unit || '' }}</span>
                            </span>
                          </div>
                        }
                        @case ('image-select') {
                          <div class="pf-param__image-grid">
                            @for (opt of p.options ?? []; track opt) {
                              <button type="button"
                                      class="pf-image-tile"
                                      [class.pf-image-tile--on]="valueOf(p.name) === opt"
                                      (click)="setValue(p.name, opt)">
                                <span class="pf-image-tile__frame">
                                  <!-- Options are stored as strings in legacy TestParameter.
                                       When an image URL is provided by the field's options[],
                                       it renders; otherwise the tile shows just the label. -->
                                  <span class="pf-image-tile__label">{{ opt }}</span>
                                </span>
                              </button>
                            }
                          </div>
                        }
                        @case ('voice-text') {
                          <div class="pf-param__voice">
                            <textarea class="pf-param__input pf-param__textarea"
                                      [value]="valueOf(p.name) ?? ''"
                                      (focus)="setActive(p.name)"
                                      (input)="setValue(p.name, asArea($event))"
                                      rows="3"
                                      placeholder="Speak or type…"></textarea>
                            @if (voiceSupported) {
                              <button type="button"
                                      class="pf-param__voice-mic"
                                      [class.pf-param__voice-mic--on]="voiceActiveFor() === p.name"
                                      (click)="toggleVoiceCapture(p.name)"
                                      [attr.aria-label]="voiceActiveFor() === p.name ? 'Stop voice capture' : 'Start voice capture'">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                  <path d="M12 19v3"/>
                                </svg>
                              </button>
                            }
                          </div>
                        }
                        @case ('file') {
                          <div class="pf-param__file">
                            <label class="pf-param__filebtn press">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <path d="M17 8l-5-5-5 5"/>
                                <path d="M12 3v12"/>
                              </svg>
                              {{ fileEntryFor(p.name) ? 'Replace' : 'Choose file' }}
                              <input type="file"
                                     hidden
                                     (change)="onSingleFile(p.name, $any($event.target).files)"/>
                            </label>
                            @if (fileEntryFor(p.name); as f) {
                              <span class="pf-param__filename">{{ f.name }}</span>
                              <button type="button" class="pf-param__file-clear" (click)="clearFile(p.name)">×</button>
                            }
                          </div>
                        }
                        @case ('image-gallery') {
                          <div class="pf-param__gallery">
                            <label class="pf-param__filebtn press">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="5" width="18" height="14" rx="2"/>
                                <circle cx="9" cy="11" r="2"/>
                                <path d="m21 15-4-4-7 7"/>
                              </svg>
                              Add images
                              <input type="file"
                                     multiple accept="image/*"
                                     hidden
                                     (change)="onGalleryFiles(p.name, $any($event.target).files)"/>
                            </label>
                            @if (galleryOf(p.name).length > 0) {
                              <div class="pf-param__thumbs">
                                @for (src of galleryOf(p.name); track src; let i = $index) {
                                  <span class="pf-thumb">
                                    <img [src]="src" alt="" />
                                    <button type="button" class="pf-thumb__x" (click)="removeGalleryItem(p.name, i)">×</button>
                                  </span>
                                }
                              </div>
                            }
                          </div>
                        }
                        @case ('canvas') {
                          <div class="pf-param__canvas-wrap">
                            <canvas #pad
                                    class="pf-param__canvas"
                                    [attr.data-param]="p.name"
                                    [attr.width]="canvasWidthFor(p)"
                                    [attr.height]="canvasHeightFor(p)"
                                    (pointerdown)="canvasDown($event, p.name, pad)"
                                    (pointermove)="canvasMove($event, p.name, pad)"
                                    (pointerup)="canvasUp($event, p.name, pad)"
                                    (pointerleave)="canvasUp($event, p.name, pad)"></canvas>
                            <div class="pf-param__canvas-actions">
                              <button type="button" class="pf-param__canvas-clear" (click)="clearCanvas(p.name, pad)">Clear</button>
                            </div>
                          </div>
                        }
                        @case ('stub') {
                          <div class="pf-param__stub">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>
                            </svg>
                            Preview only — interactive editor coming in a future release.
                          </div>
                        }
                        @case ('text') {
                          <input type="text"
                                 class="pf-param__input"
                                 [value]="valueOf(p.name) ?? ''"
                                 [attr.data-param]="p.name"
                                 (focus)="setActive(p.name)"
                                 (input)="setValue(p.name, asInput($event))"
                                 (keydown.enter)="advanceFrom(p.name)"
                                 [placeholder]="p.unit ?? ''"/>
                        }
                        @case ('textarea') {
                          <textarea class="pf-param__input pf-param__textarea"
                                    [value]="valueOf(p.name) ?? ''"
                                    [attr.data-param]="p.name"
                                    (focus)="setActive(p.name)"
                                    (input)="setValue(p.name, asArea($event))"
                                    rows="3"
                                    placeholder="Notes…"></textarea>
                        }
                        @default {
                          <div class="pf-param__num">
                            <input type="text"
                                   inputmode="decimal"
                                   class="pf-param__input pf-param__input--num"
                                   pfNumpad
                                   [pfNumpadLabel]="p.title || p.name"
                                   [pfNumpadUnit]="p.unit ?? null"
                                   [pfNumpadFlag]="flagFor(p)"
                                   [attr.data-numpad-skip]="calcChipFor(p) ? '' : null"
                                   [class.pf-param__input--outr]="isOutOfRange(p)"
                                   [class.pf-param__input--crit]="isParamCritical(p)"
                                   [class.pf-param__input--invalid]="isInvalidNumeric(p)"
                                   [value]="valueOf(p.name) ?? ''"
                                   (focus)="setActive(p.name)"
                                   (input)="setValue(p.name, asInput($event))"
                                   (keydown)="allowOnlyNumbers($event)"
                                   (keydown.enter)="advanceFrom(p.name)"
                                   (paste)="onNumericPaste($event, p.name)"
                                   [attr.data-param]="p.name"
                                   #numInput
                                   [placeholder]="'—'"/>
                            @if (p.unit) { <span class="pf-param__unit">{{ p.unit }}</span> }
                          </div>
                        }
                      }

                      @if (calcChipFor(p); as c) {
                        <span class="pf-rg__calc" [attr.data-kind]="c.kind">{{ c.label }}</span>
                      }
                      @if (flagFor(p); as f) {
                        @if (f.tone !== 'critical') {
                          <span class="pf-flag" [attr.data-tone]="f.tone" [attr.title]="flagChipTitle(f)">
                            <span class="pf-flag__dot"></span>
                            {{ f.label }}
                          </span>
                        }
                      }
                    </div>

                    @if (errorFor(p.name); as err) {
                      <p class="pf-param__error">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
                        </svg>
                        {{ err }}
                      </p>
                    }
                  </div>
                }
              </div>
              }
            </pf-tile>
          } @else if (orderTest() && parameters().length === 0) {
            <pf-tile tone="amber" padding="lg" class="pf-col-static">
              <p class="text-[13px]" style="color: var(--text-primary);">
                This test has no parameter schema. Use free-form notes below, or ask an admin to configure parameters.
              </p>
            </pf-tile>
          }

          <!-- Notes — compact collapsed row -->
          <pf-tile tone="default" padding="sm" class="pf-col-static pf-notes-tile">
            <div class="pf-notes-wrap">
              <span class="pf-notes-label">Notes</span>
              <input type="text"
                     class="pf-notes-inline"
                     [value]="note()"
                     (focus)="clearActive()"
                     (input)="setNote(asInput($event))"
                     placeholder="Optional · visible to the validating pathologist"/>
            </div>
          </pf-tile>

          <!-- Technician notes that PRINT on the report (Lab settings switch):
               this test's, its profile's, its department's and the whole
               report's. Hidden when off and nothing was written. -->
          @if (orderTest(); as ot) {
            <pf-report-notes-card class="pf-col-static" [lineIds]="[ot.id]" [showLines]="true" [showProfiles]="true"></pf-report-notes-card>
          }
        </div>

        <!-- RIGHT RAIL: always rendered. On lg+ lives in the grid column.
             On <lg it positions as a bottom drawer toggled by the FAB. -->
        <aside class="pf-rail" [class.pf-rail--drawer-open]="mobileRailOpen()">
          <div class="pf-rail__sticky">
            <div class="pf-rail__header">
              <div class="pf-rail__eyebrow-row">
                <p class="pf-rail__eyebrow">{{ railEyebrow() }}</p>
                <button type="button"
                        class="pf-rail__close press md:hidden"
                        (click)="closeMobileRail()"
                        aria-label="Hide keypad">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 6l12 12M18 6 6 18"/>
                  </svg>
                </button>
              </div>
              @if (activeParam(); as name) {
                <p class="pf-rail__target" [title]="titleFor(name)">
                  <span class="pf-rail__dot"></span>
                  {{ titleFor(name) }}
                </p>
                <p class="pf-rail__value">
                  <span class="pf-rail__value-num">{{ prettyValue(name) }}</span>
                  @if (unitFor(name); as u) { <span class="pf-rail__value-unit">{{ u }}</span> }
                </p>
              } @else {
                <p class="pf-rail__target pf-rail__target--idle">
                  <span class="pf-rail__dot pf-rail__dot--idle"></span>
                  Tap a field
                </p>
                <p class="pf-rail__value pf-rail__value--idle">—</p>
              }
            </div>

            <!-- Body: swaps based on active param kind -->
            @switch (railKind()) {
              @case ('numeric') {
                <!-- Touch devices get the shared result numpad beside the
                     field itself (pfNumpad) — no second keypad here. -->
                @if (!touchPad()) {
                  <pf-num-pad
                    [value]="(activeParam() ? (valueOf(activeParam()!) ?? '') : '').toString()"
                    [allowDecimal]="true"
                    [allowNegative]="false"
                    (valueChange)="padChange($event)"></pf-num-pad>
                } @else {
                  <p class="pf-rail__padhint">Tap a result — the number pad opens beside it.</p>
                }
              }

              @case ('choice') {
                <div class="pf-rail__options">
                  @for (opt of activeOptions(); track opt) {
                    <button type="button"
                            class="pf-rail__opt press"
                            [class.pf-rail__opt--on]="valueOf(activeParam()!) === opt"
                            (click)="pickOption(opt)">
                      <span class="pf-rail__opt-tick">
                        @if (valueOf(activeParam()!) === opt) {
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="m5 12 4 4L19 6"/>
                          </svg>
                        }
                      </span>
                      <span class="pf-rail__opt-label">{{ opt }}</span>
                    </button>
                  }
                </div>
              }

              @case ('choice-multi') {
                <div class="pf-rail__options">
                  @for (opt of activeOptions(); track opt) {
                    <button type="button"
                            class="pf-rail__opt press"
                            [class.pf-rail__opt--on]="isOptionOn(activeParam()!, opt)"
                            (click)="toggleOption(activeParam()!, opt)">
                      <span class="pf-rail__opt-tick">
                        @if (isOptionOn(activeParam()!, opt)) {
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="m5 12 4 4L19 6"/>
                          </svg>
                        }
                      </span>
                      <span class="pf-rail__opt-label">{{ opt }}</span>
                    </button>
                  }
                </div>
              }

              @case ('radio') {
                <div class="pf-rail__options">
                  @for (opt of activeOptions(); track opt) {
                    <button type="button"
                            class="pf-rail__opt press"
                            [class.pf-rail__opt--on]="valueOf(activeParam()!) === opt"
                            (click)="pickOption(opt)">
                      <span class="pf-radio-dot" [class.pf-radio-dot--on]="valueOf(activeParam()!) === opt"></span>
                      <span class="pf-rail__opt-label">{{ opt }}</span>
                    </button>
                  }
                </div>
              }

              @case ('yesno') {
                <div class="pf-rail__yesno">
                  <button type="button"
                          class="pf-rail__yn press"
                          [class.pf-rail__yn--on]="valueOf(activeParam()!) === 'yes'"
                          (click)="pickOption('yes')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 12 4 4L19 6"/>
                    </svg>
                    Yes
                  </button>
                  <button type="button"
                          class="pf-rail__yn press"
                          [class.pf-rail__yn--on]="valueOf(activeParam()!) === 'no'"
                          (click)="pickOption('no')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M6 6l12 12M18 6 6 18"/>
                    </svg>
                    No
                  </button>
                </div>
              }

              @case ('text') {
                <div class="pf-rail__kbd">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="2" y="6" width="20" height="12" rx="2"/>
                    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>
                  </svg>
                  <p>Type directly in the field. Press <kbd>Enter</kbd> to jump to the next.</p>
                </div>
              }

              @default {
                <div class="pf-rail__kbd">
                  <p>Tap any field on the left to begin.</p>
                </div>
              }
            }

            <div class="pf-rail__actions">
              <button type="button" class="pf-rail__next press" (click)="advance()" [disabled]="!hasNextEmpty()">
                Next empty
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14m-5-6 6 6-6 6"/>
                </svg>
              </button>
              <button type="button" class="pf-rail__clear press" (click)="clearActiveValue()" [disabled]="!activeParam()">
                Clear
              </button>
            </div>

            <p class="pf-rail__hint">
              <kbd>Tab</kbd>
              <span>between fields.</span>
              <kbd>Enter</kbd>
              <span>next empty.</span>
            </p>
          </div>
        </aside>

      </div>

      <!-- Mobile/tablet: backdrop dismisses the rail drawer -->
      @if (mobileRailOpen()) {
        <div class="pf-rail-backdrop md:hidden" (click)="closeMobileRail()"></div>
      }

      <!-- Mobile/tablet: FAB to toggle the rail drawer. Icon adapts to the
           active param kind so users know what's behind the button. -->
      <button type="button"
              class="pf-rail-fab press md:hidden"
              [class.pf-rail-fab--active]="mobileRailOpen()"
              (click)="toggleMobileRail()"
              [attr.aria-label]="mobileRailOpen() ? 'Hide input helper' : 'Show input helper'">
        @switch (railKind()) {
          @case ('numeric') {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <path d="M7 9h.01M12 9h.01M17 9h.01M7 13h.01M12 13h.01M17 13h.01M7 17h10"/>
            </svg>
          }
          @case ('choice') {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
            </svg>
          }
          @case ('radio') {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
            </svg>
          }
          @default {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <path d="M7 9h.01M12 9h.01M17 9h.01M7 13h.01M12 13h.01M17 13h.01M7 17h10"/>
            </svg>
          }
        }
      </button>
    </section>

    @if (!resultEntryUnlocked() && orderTest()) {
      <pf-barcode-scanner-modal
        [manualOnly]="scan.manualEntry()"
        title="Scan vial to open result entry"
        [expectedBarcode]="expectedScanBarcode()"
        (matched)="onResumeScanMatched($event)"
        (cancelled)="onResumeScanCancelled()">
      </pf-barcode-scanner-modal>
    }
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    /* ── Sent-back banner (result rejected by pathologist) ─────
       Visual pattern copied from sample-result-entry's reject banner. */
    .pf-reject-banner {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04));
      border: 1px solid rgba(239, 68, 68, 0.34);
    }
    .pf-reject-banner__icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22);
      color: var(--red-text);
      font-size: 13px; font-weight: 700;
      flex-shrink: 0;
    }
    .pf-reject-banner__text {
      margin: 0;
      font-size: 13px; line-height: 1.4;
      color: var(--text-secondary);
    }
    .pf-reject-banner__text strong { color: var(--red-text); margin-right: 4px; }

    /* ── Patient bar (compact one-row banner) ─────────────────── */
    .pf-patient-tile { padding: 10px 14px !important; }
    .pf-patient-bar {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) minmax(120px, 220px) auto;
      align-items: center;
      gap: 14px;
    }
    @media (max-width: 767px) {
      .pf-patient-bar { grid-template-columns: auto 1fr auto; }
      .pf-patient-bar__prog { display: none; }
    }
    .pf-patient-bar__id { min-width: 0; }
    .pf-patient-bar__name {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pf-patient-bar__meta {
      margin: 2px 0 0;
      font-size: 11.5px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pf-patient-bar__sep { margin: 0 4px; opacity: 0.4; }

    /* ── TAT bar ──────────────────────────────────────────────── */
    .pf-tat-track {
      height: 6px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      overflow: hidden;
    }
    .pf-tat-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }
    /* TAT bar = the clock (on track / due soon / overdue) — not a priority. */
    .pf-tat-onTrack { background: linear-gradient(90deg, #10b981, #34d399); box-shadow: 0 0 12px rgba(16, 185, 129, 0.45); }
    .pf-tat-dueSoon { background: linear-gradient(90deg, #f59e0b, #fbbf24); box-shadow: 0 0 12px rgba(245, 158, 11, 0.45); }
    .pf-tat-overdue { background: linear-gradient(90deg, #ef4444, #f87171); box-shadow: 0 0 14px rgba(239, 68, 68, 0.55); }
    /* Order priority — the front desk's Urgent (the lab has Urgent / Normal only). */
    .pf-prio-urgent { color: var(--red-text, #dc2626); font-weight: 600; }


    /* ── Results head — eyebrow + count + dot pips + % ──────── */
    .pf-results-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .pf-results-head__eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-muted);
    }
    .pf-results-head__count {
      display: inline-flex;
      align-items: baseline;
      gap: 2px;
      font-variant-numeric: tabular-nums;
    }
    .pf-results-head__filled {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.02em;
    }
    .pf-results-head__sep {
      font-size: 14px;
      color: var(--text-muted);
      margin: 0 2px;
    }
    .pf-results-head__total {
      font-size: 14px;
      color: var(--text-secondary);
      font-weight: 600;
    }
    .pf-results-head__dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      justify-content: center;
    }
    .pf-dot-pip {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: all 0.2s ease;
    }
    .pf-dot-pip--filled {
      background: var(--gradient-primary);
      border-color: transparent;
      box-shadow: 0 0 8px rgba(124, 58, 237, 0.6);
    }
    .pf-dot-pip--active {
      transform: scale(1.4);
      background: var(--gradient-primary);
      border-color: rgba(255, 255, 255, 0.3);
      box-shadow: 0 0 12px rgba(236, 72, 153, 0.8);
    }
    .pf-results-head__pct {
      font-size: 13px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.01em;
      min-width: 40px;
      text-align: right;
    }

    /* ── Param cards — adaptive grid ──
       Mobile: single column, label + input stack cleanly.
       Tablet+: multi-column adaptive flow. Multi-option (choice / radio /
       textarea) params always span the full row. */
    .pf-params {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      align-items: stretch;  /* symmetric — every card in a row matches the tallest's height */
    }
    @media (min-width: 640px) {
      /* min(300px, 100%) protects narrow tablets where the docked rail
         leaves <300px of content width — without it the auto-fill would
         force horizontal overflow on column 1. */
      .pf-params { grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); }
    }
    .pf-param {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      position: relative;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.25s ease;
    }
    /* Push the input to the bottom so all numeric/text cards line up the same way. */
    .pf-param[data-kind='numeric'] .pf-param__cell,
    .pf-param[data-kind='text'] .pf-param__cell { margin-top: auto; }

    /* Only numeric + text cards participate in the multi-column grid.
       Choice / radio / yesno / textarea take the full row — they have their
       own layout needs (option chips, radio dots, multiline text) and don't
       benefit from sitting in a narrow grid cell. */
    .pf-param[data-kind='choice'],
    .pf-param[data-kind='radio'],
    .pf-param[data-kind='yesno'],
    .pf-param[data-kind='textarea'] {
      grid-column: 1 / -1;
    }
    .pf-param:hover {
      background: var(--glass-bg);
      border-color: var(--glass-border);
    }
    .pf-param--active {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.16), rgba(236, 72, 153, 0.06)) !important;
      border-color: rgba(168, 85, 247, 0.5) !important;
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.14), 0 10px 28px rgba(124, 58, 237, 0.22);
    }
    .pf-param--active::before {
      content: '';
      position: absolute;
      left: -1px;
      top: 14%;
      bottom: 14%;
      width: 3px;
      border-radius: 3px;
      background: var(--gradient-primary);
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.7);
    }

    /* Critical — the row becomes its own alert. Beats any top-of-page banner. */
    .pf-param--critical {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04)) !important;
      border-color: rgba(239, 68, 68, 0.45) !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
    }
    .pf-param--critical::before {
      content: '';
      position: absolute;
      left: -1px;
      top: 14%;
      bottom: 14%;
      width: 3px;
      border-radius: 3px;
      background: linear-gradient(180deg, #ef4444, #db2777);
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.7);
    }
    /* If a row is both active AND critical, the critical tint wins — the ::before accent
       also uses the red gradient so the user sees exactly which row is the problem. */
    .pf-param--critical.pf-param--active {
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18), 0 10px 28px rgba(239, 68, 68, 0.22);
    }
    .pf-param--critical .pf-param__idx {
      background: linear-gradient(135deg, #ef4444, #db2777);
      border-color: transparent;
      color: #ffffff;
    }

    .pf-param__head {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    /* Input + flag area */
    .pf-param__cell {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .pf-param__cell > :first-child { flex: 1; min-width: 0; }
    .pf-param__cell .pf-param__num { flex: 1; min-width: 0; }

    /* Tablet+ only: pull the flag pill up to the card's top-right corner so the
       input cell gets the full width. Mobile keeps it inline for simplicity. */
    @media (min-width: 640px) {
      .pf-param[data-kind='numeric'] .pf-param__head,
      .pf-param[data-kind='text'] .pf-param__head { padding-right: 92px; }
      .pf-param[data-kind='numeric'] .pf-param__cell .pf-flag,
      .pf-param[data-kind='text'] .pf-param__cell .pf-flag {
        position: absolute;
        top: 10px;
        right: 12px;
      }
    }
    .pf-param__label {
      margin: 0;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
      line-height: 1.2;
    }
    .pf-param__idx {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-size: 10.5px;
      font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
      flex-shrink: 0;
    }
    .pf-param--active .pf-param__idx {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 3px 10px rgba(124, 58, 237, 0.5);
    }
    .pf-param__req { color: var(--red-text); font-weight: 700; margin-left: 2px; }
    .pf-param__ref {
      white-space: pre-line;
      margin: 0 0 0 28px;
      font-size: 11px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      line-height: 1.3;
    }

    .pf-param__num {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pf-param__input {
      flex: 1;
      min-width: 0;
      width: 100%;
      height: 42px;
      padding: 0 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 15px;
      font-variant-numeric: tabular-nums;
      outline: none;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.2s;
    }
    .pf-param__input:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
    .pf-param--active .pf-param__input {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(168, 85, 247, 0.45);
    }
    .pf-param__input--num {
      text-align: right;
      padding-right: 48px;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    /* Live value feedback on the INPUT itself (card view). Amber tint for a
       plain high/low; red is reserved for critical; dashed red for a value
       that isn't a parseable number. Beats focus/active borders. */
    .pf-param__input--outr {
      border-color: rgba(245, 158, 11, 0.55) !important;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.1) !important;
    }
    .pf-param__input--crit {
      border-color: rgba(239, 68, 68, 0.75) !important;
      background: rgba(239, 68, 68, 0.1) !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16) !important;
    }
    .pf-param__input--invalid {
      border-style: dashed !important;
      border-color: rgba(239, 68, 68, 0.55) !important;
    }
    .pf-param__unit {
      position: absolute;
      right: 14px;
      font-size: 12px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      pointer-events: none;
    }
    .pf-param__textarea { min-height: 56px; padding: 8px 12px; resize: vertical; font-size: 13px; height: auto; }

    .pf-param__choices { display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-param__radio { display: flex; flex-wrap: wrap; gap: 16px; }

    /* ── Dropdown (type: select) ─────────────────────────────── */
    .pf-param__select {
      appearance: none;
      -webkit-appearance: none;
      padding-right: 32px;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237c7c8a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>");
      background-repeat: no-repeat;
      background-position: right 12px center;
      cursor: pointer;
    }
    .pf-param__date { cursor: pointer; }

    /* ── Button-select pills (type: buttonSelect) ────────────── */
    .pf-param__btnsel { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-btnsel__opt {
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pf-btnsel__opt:hover {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }
    .pf-btnsel__opt--on {
      background: var(--gradient-primary);
      color: #fff;
      border-color: transparent;
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.35);
    }

    /* ── Toggle switch (type: toggle) ────────────────────────── */
    .pf-toggle-row {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .pf-toggle-input { position: absolute; opacity: 0; pointer-events: none; }
    .pf-toggle-track {
      position: relative;
      width: 44px;
      height: 24px;
      border-radius: 9999px;
      background: var(--border-muted);
      transition: background 0.2s ease;
      flex-shrink: 0;
    }
    .pf-toggle-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      background: #fff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      transition: transform 0.2s ease;
    }
    .pf-toggle-input:checked + .pf-toggle-track { background: var(--gradient-primary); }
    .pf-toggle-input:checked + .pf-toggle-track .pf-toggle-thumb { transform: translateX(20px); }
    .pf-toggle-label { font-weight: 500; color: var(--text-primary); }

    /* ── Checkbox (type: checkbox) ───────────────────────────── */
    .pf-checkbox-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 13.5px;
      color: var(--text-primary);
    }
    .pf-checkbox-row input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: #a855f7;
    }

    /* ── Layout-only kinds ───────────────────────────────────── */
    .pf-section-heading {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-secondary);
      padding-top: 6px;
      border-top: 1px dashed var(--border-muted);
    }
    .pf-info-note {
      margin: 0;
      font-size: 12.5px;
      color: var(--text-tertiary);
      font-style: italic;
      line-height: 1.5;
    }

    /* ── Duration / size / measure compound inputs ──────────── */
    .pf-param__duration { display: flex; gap: 8px; }
    .pf-param__duration .pf-param__input { flex: 1 1 auto; min-width: 0; }
    .pf-param__duration .pf-param__select { flex: 0 0 120px; }

    .pf-param__size { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .pf-param__size .pf-param__input { width: 80px; }
    .pf-param__size-unit { flex: 0 0 110px; }

    .pf-param__measure {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pf-param__range {
      flex: 1 1 200px;
      min-width: 120px;
      accent-color: #a855f7;
    }
    .pf-param__measure-readout {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      min-width: 70px;
      text-align: right;
    }
    .pf-param__measure-unit {
      font-size: 11px;
      color: var(--text-muted);
      margin-left: 4px;
    }

    /* ── Image-select grid ──────────────────────────────────── */
    .pf-param__image-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: 8px;
    }
    .pf-image-tile {
      padding: 0;
      background: transparent;
      border: none;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .pf-image-tile__frame {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .pf-image-tile--on .pf-image-tile__frame {
      border-color: #a855f7;
      box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.25);
    }
    .pf-image-tile__label {
      font-size: 11px;
      color: var(--text-secondary);
      padding: 4px 6px;
      text-align: center;
    }

    /* ── Voice-text textarea with mic overlay ───────────────── */
    .pf-param__voice { position: relative; }
    .pf-param__voice-mic {
      position: absolute;
      right: 8px;
      bottom: 8px;
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-param__voice-mic:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-param__voice-mic--on {
      background: var(--gradient-primary);
      color: #fff;
      border-color: transparent;
      box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.2);
    }

    /* ── File + image gallery ───────────────────────────────── */
    .pf-param__file, .pf-param__gallery { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .pf-param__filebtn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .pf-param__filebtn:hover { background: var(--glass-bg-hover); }
    .pf-param__filename { font-size: 12px; color: var(--text-secondary); }
    .pf-param__file-clear {
      width: 24px;
      height: 24px;
      border-radius: 9999px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 14px;
    }
    .pf-param__file-clear:hover { background: var(--bg-hover); color: var(--text-primary); }
    .pf-param__thumbs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
      gap: 6px;
      width: 100%;
    }
    .pf-thumb {
      position: relative;
      display: inline-flex;
      border-radius: 8px;
      overflow: hidden;
      aspect-ratio: 1;
      background: var(--bg-card-solid);
    }
    .pf-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .pf-thumb__x {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 20px;
      height: 20px;
      border-radius: 9999px;
      border: none;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
    }

    /* ── Canvas (signature / scribblePad) ───────────────────── */
    .pf-param__canvas-wrap { display: inline-flex; flex-direction: column; gap: 6px; }
    .pf-param__canvas {
      border: 1px dashed var(--glass-border);
      border-radius: 10px;
      background: var(--bg-card-solid);
      touch-action: none;
      cursor: crosshair;
      width: 100%;
      max-width: 320px;
    }
    .pf-param__canvas-actions { display: flex; gap: 8px; }
    .pf-param__canvas-clear {
      padding: 4px 10px;
      border-radius: 8px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
    }

    /* ── Stub tile for complex-widget previews ──────────────── */
    .pf-param__stub {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px dashed var(--border-muted);
      background: var(--glass-bg);
      color: var(--text-tertiary);
      font-size: 12.5px;
      font-style: italic;
    }

    /* ── Inline validation error ─────────────────────────────── */
    .pf-param__error {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 6px 0 0 12px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: var(--red-text);
      font-size: 11.5px;
      font-weight: 500;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.02em;
    }
    :root.light .pf-param__error {
      background: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.4);
      color: #b91c1c;
    }
    /* Field-level failure — red border on the card + its input so the tech's
       eye lands on the offending parameter. */
    .pf-param--error {
      border-color: rgba(239, 68, 68, 0.55) !important;
    }
    .pf-param--error .pf-param__input {
      border-color: rgba(239, 68, 68, 0.55);
    }
    .pf-radio-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .pf-radio-dot {
      width: 16px;
      height: 16px;
      border-radius: 9999px;
      border: 2px solid var(--border-muted);
      transition: all 0.15s;
    }
    .pf-radio-dot--on {
      border-color: transparent;
      background: var(--gradient-primary);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.18);
    }

    /* ── Grid view (mirrors the report PDF columns) ─────────── */
    .pf-view-toggle {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      margin-left: 8px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-view-toggle__btn {
      width: 28px; height: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 0;
      border-radius: 9999px;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .pf-view-toggle__btn:hover { color: var(--text-primary); }
    .pf-view-toggle__btn--on {
      background: rgba(168, 85, 247, 0.16);
      color: var(--violet-text);
    }

    .pf-result-grid-wrap {
      padding: 8px 4px 16px;
      overflow-x: auto;
    }
    .pf-result-grid {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      min-width: 760px;
      font-size: 13px;
    }
    .pf-result-grid thead th {
      text-align: left;
      padding: 9px 10px;
      font-size: 10.5px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--violet-text);
      background: linear-gradient(180deg, rgba(168, 85, 247, 0.18), rgba(168, 85, 247, 0.06));
      border-bottom: 1px solid rgba(168, 85, 247, 0.4);
      position: sticky; top: 0; z-index: 1;
    }
    .pf-rg__col-param  { width: 28%; }
    .pf-rg__col-result { width: 22%; }
    .pf-rg__col-unit   { width: 12%; }
    .pf-rg__col-range  { width: 22%; }
    .pf-rg__col-method { width: 16%; }

    .pf-result-grid__row td {
      padding: 5px 8px;
      border-bottom: 1px solid var(--glass-border);
      vertical-align: middle;
    }
    .pf-result-grid__row:nth-child(odd) td { background: rgba(255, 255, 255, 0.012); }
    .pf-result-grid__row:hover td { background: rgba(168, 85, 247, 0.06); }
    .pf-result-grid__row--active td { background: rgba(168, 85, 247, 0.12) !important; }
    .pf-result-grid__row--filled td { color: var(--text-primary); }
    .pf-result-grid__row--critical td {
      background: rgba(239, 68, 68, 0.10) !important;
    }
    .pf-result-grid__row--section td {
      padding: 10px 10px 6px !important;
      background: rgba(168, 85, 247, 0.10) !important;
      color: var(--text-primary);
      font-size: 11.5px;
      letter-spacing: 0.04em;
    }

    .pf-rg__c-param {
      display: flex; align-items: center; gap: 6px;
      color: var(--text-primary);
      font-weight: 500;
    }
    .pf-rg__idx {
      font-size: 9.5px; font-weight: 700;
      color: var(--text-muted);
      min-width: 18px;
    }
    .pf-rg__req {
      color: rgba(244, 63, 94, 0.6);
      font-weight: 700;
      margin-left: 2px;
    }
    .pf-rg__c-result {
      position: relative;
    }
    .pf-rg__input {
      width: 100%;
      padding: 6px 8px;
      font-size: 13.5px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--glass-border);
      border-radius: 6px;
      color: var(--text-primary);
      transition: border-color 0.12s, background 0.12s;
    }
    .pf-rg__input:focus {
      outline: 0;
      border-color: rgba(168, 85, 247, 0.6);
      background: rgba(168, 85, 247, 0.1);
    }
    .pf-rg__input--num { text-align: right; font-variant-numeric: tabular-nums; }
    /* Live value feedback on the INPUT itself (grid view) — mirrors the card
       view: amber = high/low, red = critical, dashed red = not a number. */
    .pf-rg__input--outr {
      border-color: rgba(245, 158, 11, 0.55) !important;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.1);
    }
    .pf-rg__input--crit {
      border-color: rgba(239, 68, 68, 0.75) !important;
      background: rgba(239, 68, 68, 0.1) !important;
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.14);
    }
    .pf-rg__input--invalid {
      border-style: dashed !important;
      border-color: rgba(239, 68, 68, 0.55) !important;
    }
    .pf-rg__select { font-weight: 500; }
    .pf-rg__textarea { resize: vertical; min-height: 32px; }
    .pf-rg__c-unit, .pf-rg__c-range, .pf-rg__c-method {
      color: var(--text-tertiary);
      font-size: 12px;
    }
    /* A typed report text keeps its line breaks. */
    .pf-rg__c-range { white-space: pre-line; }
    .pf-rg__flag {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 8px;
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.12em; text-transform: uppercase;
      border-radius: 9999px;
    }
    .pf-rg__flag[data-tone='low']      { background: rgba(59, 130, 246, 0.16); color: var(--blue-text); border: 1px solid rgba(59, 130, 246, 0.4); }
    .pf-rg__flag[data-tone='high']     { background: rgba(245, 158, 11, 0.16); color: var(--amber-text); border: 1px solid rgba(245, 158, 11, 0.4); }
    .pf-rg__flag[data-tone='critical'] { background: rgba(239, 68, 68, 0.18);  color: var(--red-text); border: 1px solid rgba(239, 68, 68, 0.45); }
    .pf-rg__flag[data-tone='normal']   { background: rgba(16, 185, 129, 0.16); color: var(--green-text); border: 1px solid rgba(16, 185, 129, 0.4); }

    /* Calculated-field chip: Auto = formula live, Manual = tech override,
       Not calculable = validity gate failed — never a partial number. */
    .pf-rg__calc {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 8px;
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.12em; text-transform: uppercase;
      border-radius: 9999px;
      white-space: nowrap;
    }
    .pf-rg__calc[data-kind='auto']   { background: rgba(139, 92, 246, 0.14); color: var(--violet-text, #a78bfa); border: 1px solid rgba(139, 92, 246, 0.38); }
    .pf-rg__calc[data-kind='manual'] { background: rgba(148, 163, 184, 0.14); color: var(--text-secondary, rgba(255,255,255,0.7)); border: 1px solid rgba(148, 163, 184, 0.35); }
    .pf-rg__calc[data-kind='na']     { background: transparent; color: var(--text-muted, rgba(255,255,255,0.45)); border: 1px dashed rgba(148, 163, 184, 0.4); text-transform: none; letter-spacing: 0.02em; }

    /* ── Live flag pill ─────────────────────────────────────── */
    .pf-flag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
      border: 1px solid transparent;
      justify-self: start;
      white-space: nowrap;
      animation: pf-flag-in 0.25s ease both;
    }
    .pf-flag--empty {
      background: transparent;
      border-color: transparent;
      padding: 0;
      animation: none;
    }
    .pf-flag__dot { width: 6px; height: 6px; border-radius: 9999px; background: currentColor; }
    .pf-flag[data-tone='normal']   { background: rgba(16, 185, 129, 0.14);  color: var(--green-text); border-color: rgba(16, 185, 129, 0.3); }
    .pf-flag[data-tone='low']      { background: rgba(245, 158, 11, 0.14);  color: var(--amber-text); border-color: rgba(245, 158, 11, 0.3); }
    .pf-flag[data-tone='high']     { background: rgba(245, 158, 11, 0.14);  color: var(--amber-text); border-color: rgba(245, 158, 11, 0.3); }
    .pf-flag[data-tone='critical'] {
      background: rgba(239, 68, 68, 0.2);
      color: var(--red-text);
      border-color: rgba(239, 68, 68, 0.4);
      animation: pf-flag-crit 1.6s ease-in-out infinite, pf-flag-in 0.25s ease both;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08);
    }
    :root.light .pf-flag[data-tone='normal']   { color: #047857; }
    :root.light .pf-flag[data-tone='low'],
    :root.light .pf-flag[data-tone='high']     { color: #b45309; }
    :root.light .pf-flag[data-tone='critical'] { color: #b91c1c; }

    @keyframes pf-flag-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.92); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    @keyframes pf-flag-crit {
      0%, 100% { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08); }
      50%      { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.16); }
    }

    /* ── Notes ─────────────────────────────────────────────── */
    .pf-notes-tile { padding: 8px 12px !important; }
    .pf-notes-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .pf-notes-label {
      flex-shrink: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-notes-inline {
      flex: 1;
      min-width: 0;
      height: 36px;
      padding: 0 10px;
      border-radius: 10px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    .pf-notes-inline::placeholder { color: var(--text-muted); }
    .pf-notes-inline:hover {
      background: var(--glass-bg);
      border-color: var(--glass-border);
    }
    .pf-notes-inline:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }

    /* ── Right rail: lg+ is docked in the grid column, <lg is a bottom drawer ── */
    .pf-rail__padhint { margin: 12px 4px 0; font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
    .pf-rail {
      display: block;
      min-height: 0;
      overflow: hidden;
      height: 100%;
    }
    /* Mobile only (<md, phone-size): the rail positions as a fixed bottom drawer,
       toggled by the FAB. Native keyboard is the default; users tap the FAB to
       reveal the touch keypad / option picker when they want it. */
    @media (max-width: 767px) {
      .pf-rail {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
        top: auto;
        height: auto;
        max-height: 70dvh;
        z-index: 45;
        transform: translateY(120%) scale(0.98);
        opacity: 0;
        visibility: hidden;
        transition:
          transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 0.2s ease,
          visibility 0s linear 0.25s;
      }
      .pf-rail--drawer-open {
        transform: translateY(0) scale(1);
        opacity: 1;
        visibility: visible;
        transition:
          transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 0.2s ease,
          visibility 0s linear;
      }
      .pf-rail__sticky { max-height: 70dvh; }
    }

    /* Backdrop behind the drawer on mobile/tablet */
    .pf-rail-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 44;
      animation: pf-backdrop-in 0.2s ease both;
    }
    @keyframes pf-backdrop-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* Floating action button to toggle the rail drawer on mobile/tablet.
       Positioned above the bottom-nav pill, with a breathing-glow pulse so
       first-time users notice it. */
    .pf-rail-fab {
      position: fixed;
      right: 16px;
      bottom: calc(7.5rem + env(safe-area-inset-bottom, 0px));
      z-index: 46;
      width: 60px;
      height: 60px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.18);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow:
        0 14px 36px rgba(124, 58, 237, 0.55),
        0 0 0 0 rgba(168, 85, 247, 0.45);
      transition:
        transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
        box-shadow 0.3s ease,
        background 0.25s ease,
        filter 80ms ease;
      animation: pf-fab-breathe 2.6s ease-in-out infinite;
    }
    @keyframes pf-fab-breathe {
      0%, 100% {
        box-shadow:
          0 14px 36px rgba(124, 58, 237, 0.55),
          0 0 0 0 rgba(168, 85, 247, 0.45);
      }
      50% {
        box-shadow:
          0 16px 40px rgba(124, 58, 237, 0.65),
          0 0 0 12px rgba(168, 85, 247, 0);
      }
    }
    .pf-rail-fab:hover {
      box-shadow: 0 18px 42px rgba(124, 58, 237, 0.7);
      animation-play-state: paused;
    }
    .pf-rail-fab:active { transform: scale(0.93); filter: brightness(1.08); }
    .pf-rail-fab--active {
      background: linear-gradient(135deg, #ef4444, #db2777);
      box-shadow: 0 14px 34px rgba(239, 68, 68, 0.55);
      transform: rotate(45deg);
      animation: none;
    }
    @media (prefers-reduced-motion: reduce) { .pf-rail-fab { animation: none; } }

    /* Tablet / iPad (md–xl-): rail is docked in the grid column, FAB + backdrop
       + close button all hidden (they're mobile-only affordances). */
    @media (min-width: 768px) {
      .pf-rail-fab,
      .pf-rail__close,
      .pf-rail-backdrop { display: none !important; }
    }
    /* Desktop (≥1280px with a mouse) has a real keyboard — the whole rail
       is hidden so the params get the full viewport width. Touch-first
       devices (html.device-touch) keep the rail at every width. */
    @include dt.desktop-only {
      .pf-rail { display: none !important; }
      /* Was the template's xl:grid-cols-1 (a Tailwind utility can't tell a
         tablet from a desktop). Unlayered, so it beats lg:grid-cols-[…]. */
      .pf-page__body.pf-re-body { grid-template-columns: repeat(1, minmax(0, 1fr)); }
    }

    /* ── Rail header row: eyebrow + close (mobile only) ── */
    .pf-rail__eyebrow-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .pf-rail__close {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .pf-rail__close:hover { background: var(--glass-bg-hover); color: var(--text-primary); }

    .pf-rail__sticky {
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 18px;
      border-radius: 24px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      overflow: hidden;
    }
    .pf-rail__header { flex-shrink: 0; }
    .pf-rail__actions { flex-shrink: 0; }
    .pf-rail__hint    { flex-shrink: 0; }
    /* The central body (numpad / options / radio / yesno / kbd hint) gets
       whatever space is left between header and actions. */
    .pf-rail pf-num-pad,
    .pf-rail__options,
    .pf-rail__yesno,
    .pf-rail__kbd { flex-shrink: 0; }
    .pf-rail__options { max-height: 100%; overflow-y: auto; }

    .pf-rail__header { margin-bottom: 14px; }
    .pf-rail__eyebrow {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-rail__target {
      margin: 8px 0 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      max-width: 100%;
      min-height: 22px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-rail__target--idle { color: var(--text-muted); font-weight: 500; font-size: 13px; }
    .pf-rail__dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.7);
      flex-shrink: 0;
    }
    .pf-rail__dot--idle {
      background: var(--text-muted);
      box-shadow: none;
      opacity: 0.5;
    }

    .pf-rail__value {
      margin: 6px 0 14px;
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 14px 18px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(236, 72, 153, 0.08));
      border: 1px solid rgba(168, 85, 247, 0.35);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(124, 58, 237, 0.2);
      min-height: 64px;
      position: relative;
      overflow: hidden;
    }
    .pf-rail__value::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 60% 80% at 20% 30%, rgba(168, 85, 247, 0.25), transparent 60%),
        radial-gradient(ellipse 60% 80% at 80% 70%, rgba(236, 72, 153, 0.18), transparent 60%);
      pointer-events: none;
    }
    .pf-rail__value-num {
      position: relative;
      font-size: 32px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      color: var(--text-primary);
      line-height: 1;
    }
    .pf-rail__value-unit {
      position: relative;
      font-size: 13px;
      color: var(--text-secondary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-rail__value--idle {
      background: var(--glass-bg);
      border-color: var(--glass-border);
      box-shadow: none;
    }
    .pf-rail__value--idle::before { display: none; }
    .pf-rail__value--idle .pf-rail__value-num { color: var(--text-muted); font-size: 24px; }

    /* Rail body variants -------------------------------------- */
    .pf-rail__options {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 2px;
    }
    .pf-rail__opt {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 14px;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 80ms;
    }
    .pf-rail__opt:hover { background: var(--glass-bg-hover); }
    .pf-rail__opt:active { transform: scale(0.98); }
    .pf-rail__opt--on {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
    }
    .pf-rail__opt-tick {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      border: 2px solid var(--border-muted);
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .pf-rail__opt--on .pf-rail__opt-tick {
      border-color: #ffffff;
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }
    .pf-rail__opt-label { flex: 1; min-width: 0; }

    .pf-rail__yesno {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .pf-rail__yn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 72px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 80ms;
    }
    .pf-rail__yn:hover { background: var(--glass-bg-hover); }
    .pf-rail__yn:active { transform: scale(0.98); }
    .pf-rail__yn--on {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
    }

    .pf-rail__kbd {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 32px 12px;
      text-align: center;
      color: var(--text-tertiary);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .pf-rail__kbd svg { color: var(--text-muted); }
    .pf-rail__kbd kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 20px;
      padding: 0 6px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      color: var(--text-secondary);
      margin: 0 2px;
    }

    .pf-rail__actions {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      margin-top: 12px;
    }
    .pf-rail__next {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 44px;
      padding: 0 14px;
      border-radius: 14px;
      background: var(--gradient-primary);
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.35);
      transition: box-shadow 0.25s, transform 80ms, filter 80ms;
    }
    .pf-rail__next:hover:not(:disabled) {
      box-shadow: 0 10px 22px rgba(124, 58, 237, 0.5);
      transform: translateY(-1px);
    }
    .pf-rail__next:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
    .pf-rail__clear {
      height: 44px;
      padding: 0 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .pf-rail__clear:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      color: var(--text-primary);
    }
    .pf-rail__clear:disabled { opacity: 0.4; cursor: not-allowed; }

    .pf-rail__hint {
      margin: 12px 0 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 6px;
      font-size: 10.5px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .pf-rail__hint kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 20px;
      padding: 0 6px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      color: var(--text-secondary);
    }

    /* ── Page layout: NON-SCROLL app screen (WORK page).
       The page fills the shell's main area exactly (shell-main is
       flex:1; min-height:0; overflow-y:auto — a height:100% child fits).
       The page itself never scrolls: header is fixed, the body fills the
       rest, and scrolling happens INSIDE the results panel only. No outer
       page scroll, no double scrollbars. Same behaviour at every size. */
    :host {
      display: block;
      height: 100%;
      overflow: hidden;
    }
    .pf-page {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pf-page__header { flex: 0 0 auto; }
    .pf-page__body   {
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      padding-top: 8px;
      padding-bottom: 12px;
    }
    /* The grid tracks must be able to shrink so their children can own the
       scroll instead of the page. min-height:0 on the body's grid items. */
    .pf-page__body > * { min-height: 0; }

    /* ── Compact page header (pill row) ──────────────────────── */
    .pf-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
      padding: 6px 0 10px;
    }
    .pf-head__back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 32px;
      padding: 0 10px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      align-self: center;
      flex-shrink: 0;
    }
    .pf-head__back:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-head__eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .pf-head__title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      line-height: 1.1;
      flex-shrink: 0;
    }
    @media (min-width: 768px) { .pf-head__title { font-size: 26px; } }
    .pf-head__spec { height: 26px; font-size: 11.5px; flex: none; }
    .pf-head__sep { color: var(--text-muted); opacity: 0.6; }
    .pf-head__sub {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Left column: fills the body height. Static tiles (patient bar, notes,
       empty-state) keep their natural height; the results tile takes the rest
       and scrolls INTERNALLY so the page itself never scrolls. */
    .pf-col-left {
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .pf-col-static { flex: 0 0 auto; }
    /* The scrolling tile is a flex column: its head is fixed, its body owns the
       scroll. It's the one element allowed to grow + shrink in the column. */
    .pf-col-scrolls {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pf-col-scrolls__head { flex: 0 0 auto; }
    .pf-col-scrolls__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }

    /* ── Header action cluster (replaces the old bottom action bar) ── */
    .pf-head__actions {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .pf-head__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.25s ease, transform 80ms ease;
    }
    .pf-head__btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .pf-head__btn--ghost {
      background: transparent;
      color: var(--red-text);
      border-color: transparent;
    }
    .pf-head__btn--ghost:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.12);
      color: var(--red-text);
    }
    :root.light .pf-head__btn--ghost { color: #b91c1c; }

    .pf-head__btn--secondary {
      background: var(--glass-bg);
      color: var(--text-primary);
      border-color: var(--glass-border);
    }
    .pf-head__btn--secondary:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }

    .pf-head__btn--primary {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4);
    }
    .pf-head__btn--primary:hover:not(:disabled) {
      box-shadow: 0 10px 26px rgba(124, 58, 237, 0.55);
      transform: translateY(-1px);
    }
    .pf-head__btn--danger {
      background: linear-gradient(135deg, #ef4444, #db2777);
      box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
    }
    .pf-head__btn--danger:hover:not(:disabled) {
      box-shadow: 0 10px 26px rgba(239, 68, 68, 0.6);
    }

    /* Autosave status chip inline with the eyebrow */
    .pf-autosave {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: 10px;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--green-text);
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: none;
      letter-spacing: 0;
    }
    :root.light .pf-autosave { color: #047857; }
    .pf-autosave__dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: #34d399;
      box-shadow: 0 0 6px rgba(52, 211, 153, 0.7);
    }

    /* On narrow screens, allow the action cluster to wrap onto a second header row. */
    @media (max-width: 640px) {
      .pf-head { row-gap: 8px; }
      .pf-head__actions {
        order: 10;
        width: 100%;
        justify-content: flex-end;
        margin-left: 0;
      }
    }

    /* ════════════════════════════════════════════════════════════════
       CROSS-PLATFORM ADDITIVE OVERRIDES (scoped, below-desktop only).
       Desktop-web at >=1280px is byte-for-byte unchanged: nothing here
       touches base rules; every block is gated by a max-width / pointer
       / hover / platform query so it cannot reach the wide desktop view.
       The mobile rail drawer's max-height now uses dvh directly in its base
       rule (a literal vh->dvh swap), so no duplicate override is needed here.
       ════════════════════════════════════════════════════════════════ */

    /* App-wide back chevron (sits before the title). Renders at all widths so
       a single, consistent back affordance shows everywhere. The legacy
       pf-head__back pill is fully hidden (see rule below) to avoid duplicates. */
    .pf-hdr-back { width: 38px; height: 38px; margin-left: -8px; border-radius: 11px; color: var(--text-primary); background: transparent; border: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform: scale(0.9); background: var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover: hover) { .pf-hdr-back:hover { background: var(--glass-bg, rgba(255,255,255,0.06)); } }
    /* Legacy desktop Back pill retired in favor of the chevron at every width. */
    .pf-head__back { display: none; }

    /* iOS zoom-guard: any focusable input below 16px triggers an
       auto-zoom on focus in mobile Safari/WKWebView. Bump to 16px on
       phone widths only — desktop keeps its tighter typography. */
    @media (max-width: 640px) {
      .pf-param__input,
      .pf-param__textarea,
      .pf-param__input--num,
      .pf-notes-inline,
      .pf-rg__input,
      .pf-rg__textarea,
      .pf-rg__select { font-size: 16px; }
    }

    /* Touch sizing: on coarse pointers the header pills + the back button
       are below the 44px minimum tap target. Grow their height (and the
       view-toggle hit area) without disturbing the mouse/desktop layout.
       Padding-only growth keeps the pill shape; line-height stays intact. */
    @media (pointer: coarse) { @include dt.tablet-tier {
      .pf-head__back { height: 44px; padding: 0 16px; }
      .pf-head__btn { height: 44px; padding: 0 18px; }
      /* Icon-only view toggle: full 44px tap target on touch. */
      .pf-view-toggle__btn { width: 44px; height: 44px; }
      .pf-param__file-clear { width: 44px; height: 44px; }
      /* Corner badge sits on an 80px thumbnail — a 32px hit area is the most
         it can take without overlapping the image; still comfortably tappable. */
      .pf-thumb__x { width: 32px; height: 32px; font-size: 15px; }
      .pf-rail__close { width: 44px; height: 44px; }
      .pf-rg__input,
      .pf-rg__select,
      .pf-rg__textarea { padding-top: 10px; padding-bottom: 10px; }
      .pf-image-tile__frame { width: 80px; height: 80px; }
      .pf-param__image-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); }

      /* Card-view choice controls: the radio / checkbox / toggle rows,
         button-select chips, file picker + canvas-clear all sit below the
         44px touch floor (label text + a ~16-24px glyph). These are
         inline-flex / button controls already centred on their cross axis,
         so a min-height growth enlarges the tappable zone without shifting
         the visual layout. Desktop (pointer:fine) and >=1280px untouched. */
      .pf-radio-row,
      .pf-checkbox-row,
      .pf-toggle-row,
      .pf-btnsel__opt,
      .pf-param__filebtn { min-height: 44px; }
      .pf-param__canvas-clear { min-height: 44px; padding-top: 8px; padding-bottom: 8px; }
    } }

    /* Touch (no real hover): neutralise the :hover background swaps on the
       primary controls so a tap doesn't leave them "stuck" in a hover tint
       until the next interaction. Desktop (hover:hover) is untouched. */
    @media (hover: none) {
      .pf-head__back:hover { background: var(--glass-bg); color: var(--text-secondary); }
      .pf-view-toggle__btn:hover { color: var(--text-muted); }
      .pf-param__file-clear:hover { background: var(--glass-bg); color: var(--text-secondary); }
      .pf-rail__close:hover { background: var(--glass-bg); color: var(--text-secondary); }
      .pf-notes-inline:hover { background: transparent; border-color: transparent; }
    }

    /* Phone: the size compound input's fixed 80px boxes + 110px unit can
       overflow a narrow card. Let them flex so the row wraps cleanly. */
    @media (max-width: 640px) {
      .pf-param__size .pf-param__input { width: auto; flex: 1 1 96px; min-width: 0; }
      .pf-param__size-unit { flex: 1 1 110px; }
      .pf-param__duration { flex-wrap: wrap; }
      .pf-param__duration .pf-param__select { flex: 1 1 120px; }
    }

    /* Capacitor native: the mobile rail drawer + FAB are this page's own
       fixed chrome. The global safe-area is already absorbed on body, but
       these are position:fixed and escape that flow, so re-add the bottom
       inset explicitly. The existing rules already include
       env(safe-area-inset-bottom); these only widen the side gutters so
       the sheet/FAB clear a rounded-corner notch device in landscape. */
    :host-context(html.cap-native) .pf-rail {
      left: max(12px, env(safe-area-inset-left));
      right: max(12px, env(safe-area-inset-right));
    }
    :host-context(html.cap-native) .pf-rail-fab {
      right: max(16px, env(safe-area-inset-right));
    }

    /* Electron + desktop web share the >=1280px layout already; nothing to
       add. (No raw 100vh exists on this page; :host uses height:100%.) */
  `]
})
export class ResultEntryComponent implements OnInit, AfterViewInit {
  private readonly api = inject(ApiService);
  /** Touch device → the shared result numpad replaces the rail keypad. */
  readonly touchPad = inject(NumpadService).touch;
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  protected readonly navBack = inject(NavBackService);
  protected readonly scan = inject(ScanService);
  private readonly tenantState = inject(TenantStateService);
  private readonly host = inject(ElementRef<HTMLElement>);

  @ViewChildren('numInput') private numInputs!: QueryList<ElementRef<HTMLInputElement>>;

  private readonly auth = inject(AuthService);

  // ── Post-result edit ──────────────────────────────────
  // edit_result: Lab Technician, Pathologist, Lab Admin — never front desk.
  readonly canEditResult = computed(() => this.auth.hasPermission('edit_result'));
  readonly editDialogOpen = signal(false);
  /** The dialog acts on the ORDER — read it off this test's sample. */
  readonly editOrderId = computed(() =>
    this._ot()?.subOrder?.orderId ?? this._ot()?.subOrder?.order?.id ?? null);

  /** Re-opened work changes this test's status/assignee — reload it. */
  onEdited() {
    this.editDialogOpen.set(false);
    const id = this._ot()?.id;
    if (!id) return;
    this.api.get<OrderTest>(`/api/results/${id}`).subscribe({
      next: t => this._ot.set(t),
      error: () => { /* the dialog's toast already reported the outcome */ }
    });
  }

  private readonly _ot = signal<OrderTest | null>(null);
  /** First-load skeleton for the result (ND-PATTERN "Loading feedback"). */
  private readonly recordHold = createLoadHold(true);
  readonly recordSkeleton = this.recordHold.active;
  /** Reject-sample request in flight (after the reason prompt). */
  readonly rejecting = signal(false);
  private readonly _saving = signal(false);
  private readonly _values = signal<Record<string, unknown>>({});
  // Backend field errors from the last submit, keyed by param name. Surfaced
  // inline via errorFor() and cleared the moment the tech edits that field.
  private readonly _serverErrors = signal<Record<string, string>>({});
  private readonly _note = signal<string>('');
  private readonly _active = signal<string | null>(null);
  private readonly _lastSavedAt = signal<Date | null>(null);
  private readonly _now = signal<number>(Date.now());
  private readonly _mobileRailOpen = signal<boolean>(false);
  readonly mobileRailOpen = this._mobileRailOpen.asReadonly();

  readonly orderTest = this._ot.asReadonly();

  /** Technician report notes of this test's order (re-read when its status
   *  changes: submit / validate / Edit result lock or unlock them). */
  protected readonly notes = inject(ReportNotesStore);
  private notesKey = '';
  private readonly _notesSync = effect(() => {
    const ot = this._ot();
    const oid = ot?.subOrder?.orderId ?? ot?.subOrder?.order?.id ?? null;
    const key = oid ? `${oid}|${ot?.id}:${ot?.status}` : '';
    if (key === this.notesKey) return;
    this.notesKey = key;
    void this.notes.load(oid);
  });
  readonly saving = this._saving.asReadonly();
  readonly activeParam = this._active.asReadonly();
  readonly note = this._note.asReadonly();

  /** Result entry layout — `grid` mirrors the report PDF's column
   *  structure (Parameter · Result · Unit · Reference · Method), so a
   *  tech sees the same shape they're filling toward. `cards` is the
   *  legacy vertical-card layout, kept for tests with composed widgets
   *  (image input, size/duration tuples). Persisted across sessions in
   *  localStorage. */
  private readonly _viewMode = signal<'grid' | 'cards'>(
    (typeof localStorage !== 'undefined' && (localStorage.getItem('pf-result-view') as 'grid' | 'cards')) || 'grid'
  );
  readonly viewMode = this._viewMode.asReadonly();
  setViewMode(mode: 'grid' | 'cards') {
    this._viewMode.set(mode);
    try { localStorage.setItem('pf-result-view', mode); } catch { /* no-op */ }
  }

  /** Restricts keydown events for numeric parameters to valid numbers (digits 0-9, decimal point, minus) and navigation keys, preventing letter input. */
  allowOnlyNumbers(event: KeyboardEvent) {
    const key = event.key;
    if (
      [
        'Backspace',
        'Tab',
        'Enter',
        'Escape',
        'Delete',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ].includes(key) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target as HTMLInputElement | null;
    const val = target?.value || '';

    if (key === '.' && !val.includes('.')) {
      return;
    }
    if (key === '-' && !val.includes('-')) {
      return;
    }
    if (!/^[0-9]$/.test(key)) {
      event.preventDefault();
    }
  }

  /** Paste into a numeric field: strip everything that isn't a digit, dot or
   *  leading minus so "one hundred" or "12 mg/dL" can never land as the raw
   *  value. A clean numeric paste falls through to the browser default. */
  onNumericPaste(event: ClipboardEvent, name: string) {
    const input = event.target as HTMLInputElement | null;
    const raw = event.clipboardData?.getData('text') ?? '';
    let cleaned = raw.replace(/[^0-9.\-]/g, '');
    const neg = cleaned.startsWith('-');
    cleaned = cleaned.replace(/-/g, '');
    const [head, ...rest] = cleaned.split('.');
    cleaned = (neg ? '-' : '') + head + (rest.length ? '.' + rest.join('') : '');
    if (cleaned === raw) return; // already numeric — let the default paste run
    event.preventDefault();
    if (!input) return;
    let next = cleaned;
    try {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      next = input.value.slice(0, start) + cleaned + input.value.slice(end);
    } catch {
      /* selection API unavailable (type=number) — replace wholesale */
    }
    input.value = next;
    this.setValue(name, next);
  }

  private readonly _paramsBlob = computed<TestParametersBlob | null>(() => {
    const raw = this._ot()?.test?.parameters;
    if (!raw) return null;
    try { return JSON.parse(raw) as TestParametersBlob; } catch { return null; }
  });
  readonly allParameters = computed<TestParameter[]>(() => {
    // The ONE list (legacy `fields[]` twins folded in by the shared reader).
    const params = readParameters(this._paramsBlob());
    // A non-culture test with no configured parameter schema would otherwise
    // dead-end at "No parameter schema — this test has no inputs" and be
    // impossible to fill. Fall back to a single generic "Result" field so the
    // test is always enterable. (Mirrors the sample-result-entry fix.)
    if (params.length === 0 && this._paramsBlob()?.microFormat !== 'culture_sensitivity') {
      return [{ id: 'result', name: 'result', title: 'Result', type: 'text' }];
    }
    return params;
  });

  // ── Microbiology Culture & Sensitivity ───────────────────────────────
  readonly microFormat = computed<string | null>(() => this._paramsBlob()?.microFormat ?? null);
  readonly isCulture = computed(() => this.microFormat() === 'culture_sensitivity');
  /** "Specimen: Urine" — chosen at the order desk; culture keeps it on the bench. */
  readonly specimenLabel = computed(() => this.isCulture() ? null : chosenSpecimen(this.orderTest()));
  /** Culture tests are entered on the Culture case page, never here. */
  openCultureBench() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) void this.router.navigate(['/lab/culture', id]);
  }
  // Form view of the SAME parameters (rich type, showWhen, validation) —
  // derived, never a second stored list.
  private readonly _fields = computed<FormField[]>(() =>
    readParameters(this._paramsBlob()).map((p, i) => paramToField(p, i)));
  private readonly _fieldByName = computed<Map<string, FormField>>(() => {
    const map = new Map<string, FormField>();
    for (const f of this._fields()) map.set(f.name, f);
    return map;
  });
  // Map field values keyed by FormField.id, which is what showWhen rules
  // reference. Result-entry stores values under param.name, so we
  // translate via the FormField.name → FormField.id mapping.
  private readonly _valuesByFieldId = computed<Record<string, unknown>>(() => {
    const values = this._values();
    const out: Record<string, unknown> = {};
    for (const f of this._fields()) out[f.id] = values[f.name];
    return out;
  });
  // Visibility-filtered view. Fields with no showWhen always pass; fields
  // from legacy tests (no FormField entry) always pass too.
  readonly parameters = computed<TestParameter[]>(() => {
    const all = this.allParameters();
    const fields = this._fields();
    if (fields.length === 0) return all;
    const showWhenByName = new Map(fields.map(f => [f.name, f.showWhen]));
    const valsById = this._valuesByFieldId();
    return all.filter(p => {
      const sw = showWhenByName.get(p.name);
      return sw ? evaluateShowWhen(sw, valsById) : true;
    });
  });

  // Layout-only kinds don't participate in required/filled accounting.
  // 'stub' joins them so admins can drop Tier 3 complex widgets into a
  // schema without them blocking canSubmit (the widgets don't render
  // interactive UI yet, so users couldn't fill them even if required).
  isLayoutKind(k: InputKind): boolean {
    return k === 'section-header' || k === 'info-text' || k === 'stub';
  }
  private hasValue(v: unknown, kind: InputKind): boolean {
    if (kind === 'checkbox' || kind === 'toggle') return typeof v === 'boolean';
    // Composed shapes — duration { value, unit }, size { values[], unit },
    // measure { value, unit } — count as filled when the primary field
    // carries a number.
    if (kind === 'duration' || kind === 'measure') {
      return !!v && typeof (v as { value?: unknown }).value === 'number';
    }
    if (kind === 'size') {
      const vals = (v as { values?: unknown[] } | null)?.values;
      return Array.isArray(vals) && vals.some(x => typeof x === 'number' && !Number.isNaN(x));
    }
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && v !== '';
  }

  private countableParameters(): TestParameter[] {
    return this.parameters().filter(p => !this.isLayoutKind(this.inputKindFor(p)));
  }

  readonly requiredCount = computed(() => this.countableParameters().length);
  readonly filledCount = computed(() => {
    const v = this._values();
    return this.countableParameters().filter(p => this.hasValue(v[p.name], this.inputKindFor(p))).length;
  });
  readonly filledPercent = computed(() => {
    const r = this.requiredCount();
    return r ? (this.filledCount() / r) * 100 : 0;
  });
  readonly filledPercentRounded = computed(() => Math.round(this.filledPercent()));

  isFilled(name: string): boolean {
    const p = this.parameters().find(x => x.name === name);
    const kind: InputKind = p ? this.inputKindFor(p) : 'text';
    return this.hasValue(this._values()[name], kind);
  }

  // Run the FormField validator (if a new-format field exists). Returns the
  // first failing message or null. Drives the inline error under each input
  // and gates canSubmit.
  errorFor(name: string): string | null {
    // Backend field error (e.g. from a failed submit) takes precedence over
    // client validation so the tech sees the REAL server message on the input.
    const serverErr = this._serverErrors()[name];
    if (serverErr) return serverErr;
    const field = this._fieldByName().get(name);
    if (!field) return null;
    return validateFieldValue(field, this._values()[name]);
  }

  /** Drop the backend error for a field once the tech edits it. */
  private clearServerError(name: string) {
    if (!this._serverErrors()[name]) return;
    this._serverErrors.update(s => { const next = { ...s }; delete next[name]; return next; });
  }
  hasErrorFor(name: string): boolean { return !!this.errorFor(name); }

  // True when ANY visible parameter has an error. Submit is blocked while true.
  readonly hasValidationErrors = computed(() => {
    const fieldByName = this._fieldByName();
    if (fieldByName.size === 0) return false;
    const values = this._values();
    return this.parameters().some(p => {
      const f = fieldByName.get(p.name);
      return f ? !!validateFieldValue(f, values[p.name]) : false;
    });
  });

  isParamCritical(p: TestParameter): boolean {
    return this.flagFor(p)?.tone === 'critical';
  }
  readonly canSubmit = computed(() =>
    this.isCulture()
      ? false                       // culture submits on the Culture case page
      : (this.filledCount() === this.requiredCount() &&
         this.requiredCount() > 0 &&
         !this.hasValidationErrors())
  );

  // TAT
  readonly tatElapsedMin = computed(() => {
    const ral = this._ot()?.subOrder?.receivedAtLab;
    if (!ral) return 0;
    return Math.max(0, (Date.now() - new Date(ral).getTime()) / 60000);
  });
  readonly tatBudgetMin = computed(() => (this._ot()?.test?.tatHours ?? 0) * 60);
  /** TAT clock (from lab receipt). A clock, never a priority. */
  readonly tatClock = computed(() => tatInfo(this._ot()?.subOrder?.receivedAtLab, this._ot()?.test?.tatHours));
  readonly tatState = computed<TatState>(() => this.tatClock().state);
  /** The ORDER's priority, normalised: Urgent (urgent / STAT) or Normal. */
  readonly priority = computed(() => linePriority(this._ot()));
  readonly tatPercent = computed(() => {
    const b = this.tatBudgetMin();
    if (!b) return 0;
    return Math.max(0, Math.min(100, (this.tatElapsedMin() / b) * 100));
  });

  readonly patientName = computed(() => patientDisplayName(this._ot()?.subOrder?.order?.patient) || '—');
  readonly patientSex  = computed(() => this._ot()?.subOrder?.order?.patient?.sex ?? '—');
  readonly patientAge  = computed(() => formatAge(this._ot()?.subOrder?.order?.patient, 'num', '—'));
  readonly patientInfoString = computed(() => formatPatientInfo(this._ot()?.subOrder?.order?.patient));

  readonly subtitle = computed(() => {
    if (!this._ot()) return 'Capturing parameter values for this test.';
    return `Enter parameter values. ${tatDetail(this.tatClock().remainingMin)}.`;
  });

  readonly panelTone = computed<TileTone>(() => {
    // Tint follows the ORDER priority (Urgent = rose); TAT has its own chip.
    return this.priority() === 'urgent' ? 'rose' : 'violet';
  });

  readonly criticalFlags = computed<Array<TestParameter & { value: string }>>(() => {
    const v = this._values();
    return this.parameters()
      .filter(p => this.inputKindFor(p) === 'numeric')
      .map(p => ({ ...p, value: String(v[p.name] ?? '') }))
      .filter(p => {
        if (!p.value) return false;
        const f = this.flagFor(p);
        return f?.tone === 'critical';
      });
  });
  readonly hasCritical = computed(() => this.criticalFlags().length > 0);

  readonly autoSavedAgo = computed(() => {
    const t = this._lastSavedAt();
    if (!t) return '';
    const secs = Math.max(1, Math.round((this._now() - t.getTime()) / 1000));
    if (secs < 60) return `${secs}s ago`;
    return `${Math.round(secs / 60)}m ago`;
  });

  readonly hasNextEmpty = computed(() => {
    const v = this._values();
    return this.parameters().some(p => {
      const val = v[p.name];
      return val === undefined || val === null || val === '';
    });
  });

  readonly activeParamDef = computed<TestParameter | null>(() => {
    const name = this._active();
    if (!name) return null;
    return this.parameters().find(p => p.name === name) ?? null;
  });

  // Rail is a simpler UI than the main param cell — it only understands a
  // handful of input surfaces. Map richer kinds to the closest rail
  // affordance ('choice' = single-select list, 'choice-multi' = toggle
  // list, 'yesno' = on/off, 'text' = keyboard hint, 'idle' = hide the rail).
  readonly railKind = computed<'numeric' | 'choice' | 'choice-multi' | 'radio' | 'yesno' | 'text' | 'idle'>(() => {
    const p = this.activeParamDef();
    if (!p) return 'idle';
    const k = this.inputKindFor(p);
    switch (k) {
      case 'numeric':
      case 'measure':          return 'numeric';
      case 'textarea':
      case 'text':
      case 'voice-text':
      case 'phone':
      case 'email':
      case 'date':
      case 'time':
      case 'datetime':
      case 'duration':
      case 'size':             return 'text';
      case 'dropdown':
      case 'buttonSelect':
      case 'image-select':     return 'choice';
      case 'chips-multi':      return 'choice-multi';
      case 'radio':            return 'radio';
      case 'yesno':
      case 'yesnona':
      case 'toggle':
      case 'checkbox':         return 'yesno';
      case 'section-header':
      case 'info-text':
      case 'stub':
      case 'file':
      case 'image-gallery':
      case 'canvas':           return 'idle';
      default:                 return 'idle';
    }
  });

  readonly railEyebrow = computed(() => {
    switch (this.railKind()) {
      case 'numeric':      return 'Numeric keypad';
      case 'choice':       return 'Options';
      case 'choice-multi': return 'Select any';
      case 'radio':        return 'Select one';
      case 'yesno':        return 'Yes or No';
      case 'text':         return 'Keyboard input';
      default:             return 'Input helper';
    }
  });

  readonly activeOptions = computed<string[]>(() => this.activeParamDef()?.options ?? []);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.back(); return; }

    // Re-scan gate: the result-entry screen is only unlocked when the
    // tech has the vial in hand. If they arrived here directly from a
    // fresh claim-by-scan in my-work, the navigation state carries
    // `justScanned: true` so we skip the modal this once. Otherwise —
    // revisit after save, reload, deep link — the modal blocks editing
    // until the vial barcode is scanned again.
    //
    // We check both router.getCurrentNavigation() (populated during the
    // navigation transition) and history.state (the persisted snapshot)
    // because the former returns null once the route has settled, which
    // makes the bypass flaky depending on micro-task timing.
    const nav = this.router.getCurrentNavigation();
    const navState = (nav?.extras?.state as { justScanned?: boolean } | undefined);
    const histState = (typeof history !== 'undefined' ? history.state : null) as { justScanned?: boolean } | null;
    const justScanned = navState?.justScanned === true || histState?.justScanned === true;
    this._verified.set(justScanned);

    this.api.get<OrderTest>(`/api/results/${id}`).subscribe({
      next: t => {
        this.recordHold.done();
        this._ot.set(t);
        const raw = t.currentResult;
        if (raw) {
          try {
            const snap = JSON.parse(raw) as { values?: Record<string, unknown>; note?: string };
            if (snap.values) this._values.set({ ...snap.values });
            if (snap.note)   this._note.set(snap.note);
          } catch { /* ignore */ }
        }
        // Seed the right-rail target with the first numeric param so the pad has something to drive.
        const firstNumeric = this.parameters().find(p => this.inputKindFor(p) === 'numeric');
        if (firstNumeric) this._active.set(firstNumeric.name);
        // Calculated test → fetch tube siblings and prefill from the formula.
        this.initCalc();
      },
      error: () => { this.recordHold.done(); this.toasts.error('Could not load result entry'); }
    });
    // Cleared on destroy: the route recreates this screen per test
    // (data.recreateOn), so a leaked ticker would pile up per switch.
    const tick = setInterval(() => this._now.set(Date.now()), 10_000);
    this.destroyRef.onDestroy(() => clearInterval(tick));
  }
  private readonly destroyRef = inject(DestroyRef);

  // ── Re-scan gate ──────────────────────────────────────
  private readonly _verified = signal(false);
  readonly verified = this._verified.asReadonly();
  // In manual mode there is no vial QR to scan, so the re-scan gate must not
  // block: manual tenants count as always-verified. In scan mode this is
  // exactly `_verified()`, so that path is unchanged.
  readonly resultEntryUnlocked = computed(() => this._verified() || this.scan.manualEntry());
  readonly expectedScanBarcode = computed(() => this._ot()?.subOrder?.barcode ?? '');

  onResumeScanMatched(code: string) {
    // Double-check the code matches before dropping the gate. Modal enforces
    // this already, but belt-and-braces keeps the signal honest.
    const expected = this.expectedScanBarcode();
    if (expected && expected.toLowerCase() !== code.trim().toLowerCase()) return;
    this._verified.set(true);
  }
  onResumeScanCancelled() {
    // Cancel bounces back to the queue — no peeking at half-entered
    // results without proving you have the vial.
    this.back();
  }

  ngAfterViewInit() { /* no-op — numInputs are ready for advance() */ }

  // Unified render-kind enum. When the test carries new-format `fields[]`,
  // we route off FormField.type (richer vocabulary); otherwise fall back to
  // the legacy TestParameter.type. Every FormFieldType must land on a known
  // InputKind here — silent fall-through would hide data-entry bugs.
  inputKindFor(p: TestParameter): InputKind {
    const field = this._fieldByName().get(p.name);
    // Widened: catalog data carries type strings ('options', 'choice') the
    // FormFieldType union doesn't know.
    const t = (field?.type ?? p.type) as string;
    switch (t) {
      case 'numeric':
      case 'numeric_with_range':
      case 'number':          return 'numeric';
      // Qualitative positive/negative-ish parameters (by options OR type)
      // render as a dropdown, never a free text box.
      case 'text':            return resolveParamEntryKind(p) === 'select' ? 'dropdown' : 'text';
      case 'textarea':        return 'textarea';
      case 'voice-text':      return 'voice-text';
      case 'phone':           return 'phone';
      case 'email':           return 'email';
      case 'date':            return 'date';
      case 'time':            return 'time';
      case 'datetime':        return 'datetime';
      case 'select':
      // "options"/"choice": the option-group mapper / option-table catalogs
      // write these — a curated list must never render as a text box.
      case 'options':
      case 'choice':          return 'dropdown';
      case 'multiselect':     return 'chips-multi';
      case 'buttonSelect':
      case 'button_select':   return 'buttonSelect';
      case 'imageSelect':     return 'image-select';
      case 'radio':           return 'radio';
      case 'yesno':           return 'yesno';
      case 'yesNoNa':         return 'yesnona';
      case 'toggle':          return 'toggle';
      case 'checkbox':        return 'checkbox';
      case 'duration':
      case 'duration-time':   return 'duration';
      // duration-period reuses the buttonSelect case — we inject the
      // morning/afternoon/evening/night options when the field has none.
      case 'duration-period': return 'buttonSelect';
      case 'size':            return 'size';
      case 'measure':         return 'measure';
      case 'file-upload':     return 'file';
      case 'imageGallery':    return 'image-gallery';
      case 'signature':
      case 'scribblePad':     return 'canvas';
      case 'section-header':  return 'section-header';
      case 'info-text':       return 'info-text';
      // Tier 3 — complex widgets render as a neutral preview tile so the
      // admin can still configure them; interactive render lands later.
      case 'imageInfo':
      case 'multiTextbox':
      case 'table':
      case 'recursive':
      case 'recursivePages':  return 'stub';
      default:
        // 'dropdown' / 'qualitative' / capitalised spellings / unknown types
        // carrying options — the shared resolver decides.
        switch (resolveParamEntryKind(p)) {
          case 'select':   return 'dropdown';
          case 'number':   return 'numeric';
          case 'textarea': return 'textarea';
          case 'date':     return 'date';
          case 'checkbox': return 'yesno';
          default:         return 'text';
        }
    }
  }

  /** True when the parameter is a qualitative pos/neg-style result — its
   *  dropdown then carries a real empty '—' choice (these are optional). */
  isQualitative(p: TestParameter): boolean {
    return !!qualitativeOptionsFor(p);
  }

  /** Dropdown options: the schema's own list, or the qualitative default
   *  pair when only the type marks the field qualitative. */
  optionsFor(p: TestParameter): string[] {
    return choiceOptionsFor(p);
  }

  refLabel(p: TestParameter): string {
    if (p.normalValue) return p.normalValue;
    const r = this.rangeFor(p);
    // The group's typed report text prints exactly as typed (simple model),
    // line breaks included (the cells are white-space: pre-line), `{u}` →
    // the value's unit.
    const typed = normalizeReportText(fillUnit(r?.reportText, p.unit));
    if (typed) return typed;
    // Route through the shared formatter so one-sided bands ("< 200",
    // "≤ 140") get a label too — they used to render blank here.
    const text = formatRange(r);
    if (r && text) {
      const seg = r.segment ? this.prettySegment(r.segment) : '';
      return `${text}${p.unit ? ' ' + p.unit : ''}${seg ? ' · ' + seg : ''}`;
    }
    if (p.criticalLow !== undefined && p.criticalHigh !== undefined) return `${p.criticalLow}–${p.criticalHigh}`;
    return '';
  }

  /** Turn backend segment keys like "adult_male" into "Adult male" for display. */
  private prettySegment(s: string): string {
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Pick the reference band that fits THIS patient's sex/age — mirrors the
   * backend's selection so the entry preview matches the persisted/reported
   * flag. Replaces the old "always referenceRanges[0]" shortcut that flagged
   * every patient against whatever band happened to be first.
   */
  private rangeFor(p: TestParameter): ReferenceRange | undefined {
    // DOB-derived fractional age — the server's band-pick metric.
    const ageYears = bandAgeYears(this._ot()?.subOrder?.order?.patient);
    const sex = normalizeSex(this._ot()?.subOrder?.order?.patient?.sex);
    return selectReferenceRange(p.referenceRanges, sex, ageYears);
  }

  /** The bench chip. A value that is still the one SAVED with the result
   *  shows mw's saved verdict (snapshot `flagged`); a value being typed gets
   *  the shared live hint (patient band, band → param criticals, strict). */
  /** Chip tooltip: what H / L / critical mean (QA 2026-09-24). */
  readonly flagChipTitle = flagChipTitle;

  flagFor(p: TestParameter): Flag | null {
    if (this.inputKindFor(p) !== 'numeric') return null;
    const raw = this._values()[p.name];
    if (raw === undefined || raw === null || raw === '') return null;
    const v = parseFloat(String(raw));
    if (Number.isNaN(v)) return null;

    const ot = this._ot();
    const saved = savedFlagOf(parseResultSnapshot(ot?.currentResult), p.name);
    if (saved && saved.flag != null && String(saved.value ?? '') === String(raw)) {
      const code = flagCodeOf(saved.flag);
      // Lab badge keeps the direction: CL / CH (legacy rows: C).
      const crit = criticalBadge(code);
      if (crit) return { tone: 'critical', label: crit };
      if (code === 'L') return { tone: 'low', label: 'Low' };
      if (code === 'H') return { tone: 'high', label: 'High' };
      if (code === 'A') return { tone: 'high', label: 'Abnormal' };
      if (code === 'N') return { tone: 'normal', label: 'Normal' };
      return null;
    }

    const lf = liveFlag(p, v, normalizeSex(ot?.subOrder?.order?.patient?.sex),
      bandAgeYears(ot?.subOrder?.order?.patient), ot?.profileCode);
    if (!lf) return null;
    if (lf.code === 'CL' || lf.code === 'CH') return { tone: 'critical', label: `${lf.code} · ${lf.code === 'CL' ? 'below' : 'above'} ${lf.limit}` };
    if (lf.code === 'L') return { tone: 'low',  label: 'Low' };
    if (lf.code === 'H') return { tone: 'high', label: 'High' };
    return { tone: 'normal', label: 'Normal' };
  }

  /** Methodology for one value — HYBRID: the value's own override, else the
   *  test-level default (shared resolver, same as the report). */
  methodologyFor(p: TestParameter): string {
    return effectiveMethodology(p, this._ot()?.test) || '—';
  }

  /** Softer amber input tint for plain high/low (red stays critical-only). */
  isOutOfRange(p: TestParameter): boolean {
    const tone = this.flagFor(p)?.tone;
    return tone === 'low' || tone === 'high';
  }

  /** A numeric parameter holding a non-parseable value — near-impossible past
   *  the keydown/paste guards, but IME/autofill can slip through. Shown as a
   *  subtle invalid state and blocks submit. */
  isInvalidNumeric(p: TestParameter): boolean {
    if (this.inputKindFor(p) !== 'numeric') return false;
    const raw = this._values()[p.name];
    if (raw === undefined || raw === null || raw === '') return false;
    return Number.isNaN(Number(String(raw).trim()));
  }

  private hasInvalidNumeric(): boolean {
    return this.parameters().some(p => this.isInvalidNumeric(p));
  }

  valueOf(name: string | null): string | undefined {
    if (!name) return undefined;
    const v = this._values()[name];
    return v === undefined || v === null ? undefined : String(v);
  }

  titleFor(name: string): string {
    return this.parameters().find(p => p.name === name)?.title ?? name;
  }

  unitFor(name: string): string | undefined {
    return this.parameters().find(p => p.name === name)?.unit;
  }

  // Multi-value helpers for multiselect fields. Values stored as string[],
  // with toggle semantics: tapping an option flips it in/out of the array.
  isOptionOn(name: string, opt: string): boolean {
    const v = this._values()[name];
    return Array.isArray(v) && (v as unknown[]).map(String).includes(opt);
  }
  toggleOption(name: string, opt: string) {
    this.clearServerError(name);
    this._values.update(s => {
      const current = Array.isArray(s[name]) ? (s[name] as unknown[]).map(String) : [];
      const idx = current.indexOf(opt);
      const next = idx >= 0 ? current.filter(x => x !== opt) : [...current, opt];
      return { ...s, [name]: next };
    });
  }
  boolValueOf(name: string): boolean {
    return this._values()[name] === true;
  }
  setBoolValue(name: string, v: boolean) {
    this.clearServerError(name);
    this._values.update(s => ({ ...s, [name]: v }));
  }
  // <select> change handler — emits the chosen option value.
  asSelect(ev: Event): string { return (ev.target as HTMLSelectElement).value; }

  // Number coercers used by composed-shape renderers. Keeps the '0 is a
  // valid value' distinction: `toNumOrNull` returns null for empty strings
  // but 0 for a typed zero, so signal updates distinguish "not set" from
  // "set to 0".
  toNumOrNull(v: string): number | null {
    const trimmed = (v ?? '').trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isNaN(n) ? null : n;
  }
  toNum(v: string): number { return Number(v || 0); }

  // ── Duration compound input ───────────────────────────
  // Stored shape: { value: number | null, unit: string }. Units list
  // depends on whether the field is 'duration' (long-form) or
  // 'duration-time' (short-form).
  protected readonly durationLongUnits = DURATION_UNITS_LONG as unknown as readonly string[];
  protected readonly durationTimeUnits = DURATION_UNITS_TIME as unknown as readonly string[];
  durationUnitsFor(p: TestParameter): readonly string[] {
    const t = this._fieldByName().get(p.name)?.type ?? p.type;
    return t === 'duration-time' ? this.durationTimeUnits : this.durationLongUnits;
  }
  durationValueOf(name: string): { value: number | null; unit: string } {
    const v = this._values()[name];
    if (v && typeof v === 'object' && 'value' in (v as object)) {
      const obj = v as { value: number | null; unit: string };
      return { value: obj.value ?? null, unit: obj.unit || 'days' };
    }
    return { value: null, unit: 'days' };
  }
  setDurationValue(name: string, patch: Partial<{ value: number | null; unit: string }>) {
    const current = this.durationValueOf(name);
    const next = { ...current, ...patch };
    this._values.update(s => ({ ...s, [name]: next }));
  }

  // ── Size compound input ───────────────────────────────
  // Stored as { values: (number|null)[], unit: string }. boxCount comes
  // from field.sizeConfig when present; falls back to 2 for legacy fields.
  protected readonly sizeUnits = SIZE_UNITS as unknown as readonly string[];
  sizeIndexesFor(p: TestParameter): number[] {
    const field = this._fieldByName().get(p.name);
    const n = field?.sizeConfig?.boxCount ?? 2;
    return Array.from({ length: Math.max(1, Math.min(5, n)) }, (_, i) => i);
  }
  sizeValueOf(name: string): { values: (number | null)[]; unit: string } {
    const v = this._values()[name];
    if (v && typeof v === 'object' && 'values' in (v as object)) {
      const obj = v as { values: (number | null)[]; unit: string };
      return { values: Array.isArray(obj.values) ? obj.values : [], unit: obj.unit || 'cm' };
    }
    return { values: [], unit: 'cm' };
  }
  setSizeValueAt(name: string, index: number, value: number | null) {
    const current = this.sizeValueOf(name);
    const values = [...current.values];
    while (values.length <= index) values.push(null);
    values[index] = value;
    this._values.update(s => ({ ...s, [name]: { ...current, values } }));
  }
  setSizeUnit(name: string, unit: string) {
    const current = this.sizeValueOf(name);
    this._values.update(s => ({ ...s, [name]: { ...current, unit } }));
  }

  // ── Measure slider ────────────────────────────────────
  // Stored as { value: number, unit: string }. Bounds come from
  // field.measureConfig; defaults chosen so the slider is usable even
  // when the field is unconfigured.
  measureBounds(p: TestParameter): { min: number; max: number; step: number } {
    const cfg = this._fieldByName().get(p.name)?.measureConfig;
    return {
      min: cfg?.min ?? 0,
      max: cfg?.max ?? 100,
      step: cfg?.step ?? 1
    };
  }
  measureValueOf(name: string): { value: number | null; unit: string } {
    const v = this._values()[name];
    if (v && typeof v === 'object' && 'value' in (v as object)) {
      const obj = v as { value: number | null; unit: string };
      return { value: obj.value ?? null, unit: obj.unit || '' };
    }
    const unit = this._fieldByName().get(name)?.measureConfig?.defaultUnit || '';
    return { value: null, unit };
  }
  setMeasureValue(name: string, value: number) {
    const current = this.measureValueOf(name);
    this._values.update(s => ({ ...s, [name]: { ...current, value } }));
  }

  // ── File-upload + image-gallery ───────────────────────
  // Stored as a data URL string for single-file, or data URL array for
  // gallery. Same base64 pattern as the tenant logo uploader so results
  // survive a JSON round-trip.
  fileEntryFor(name: string): { name: string; dataUrl: string } | null {
    const v = this._values()[name];
    if (v && typeof v === 'object' && 'dataUrl' in (v as object)) {
      return v as { name: string; dataUrl: string };
    }
    return null;
  }
  onSingleFile(name: string, files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      this._values.update(s => ({
        ...s,
        [name]: { name: f.name, dataUrl: String(reader.result ?? '') }
      }));
    };
    reader.readAsDataURL(f);
  }
  clearFile(name: string) {
    this._values.update(s => ({ ...s, [name]: '' }));
  }
  galleryOf(name: string): string[] {
    const v = this._values()[name];
    return Array.isArray(v) ? (v as unknown[]).map(String) : [];
  }
  onGalleryFiles(name: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    const existing = this.galleryOf(name);
    const readers = Array.from(files).map(f => new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    }));
    Promise.all(readers).then(urls => {
      this._values.update(s => ({ ...s, [name]: [...existing, ...urls] }));
    });
  }
  removeGalleryItem(name: string, index: number) {
    const list = this.galleryOf(name).filter((_, i) => i !== index);
    this._values.update(s => ({ ...s, [name]: list }));
  }

  // ── Voice-text ────────────────────────────────────────
  // Chrome/Edge ship webkitSpeechRecognition. Other browsers get the
  // plain textarea fallback (mic button hidden via [voiceSupported]).
  readonly voiceSupported: boolean = typeof (globalThis as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition !== 'undefined'
                                  || typeof (globalThis as unknown as { SpeechRecognition?: unknown }).SpeechRecognition !== 'undefined';
  private readonly _voiceActive = signal<string | null>(null);
  private _voiceRecognition: { stop(): void } | null = null;
  voiceActiveFor() { return this._voiceActive(); }
  toggleVoiceCapture(name: string) {
    if (this._voiceActive() === name) {
      this.stopVoiceCapture();
      return;
    }
    this.stopVoiceCapture();
    const Ctor = (globalThis as unknown as { webkitSpeechRecognition?: new () => unknown; SpeechRecognition?: new () => unknown }).webkitSpeechRecognition
              ?? (globalThis as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor() as {
      lang: string; continuous: boolean; interimResults: boolean;
      start(): void; stop(): void;
      onresult: (ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; resultIndex: number }) => void;
      onend: () => void;
      onerror: () => void;
    };
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = ev => {
      let transcript = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) transcript += result[0].transcript + ' ';
      }
      if (transcript) {
        const existing = this.valueOf(name) ?? '';
        this.setValue(name, `${existing}${existing && !existing.endsWith(' ') ? ' ' : ''}${transcript.trim()}`);
      }
    };
    rec.onend = () => { this._voiceActive.set(null); this._voiceRecognition = null; };
    rec.onerror = () => { this._voiceActive.set(null); this._voiceRecognition = null; };
    rec.start();
    this._voiceRecognition = rec;
    this._voiceActive.set(name);
  }
  private stopVoiceCapture() {
    this._voiceRecognition?.stop();
    this._voiceRecognition = null;
    this._voiceActive.set(null);
  }

  // ── Canvas (signature + scribblePad) ──────────────────
  // Minimal pointer-event drawing; persists the rendered bitmap as a
  // data URL on pointerup. scribblePadConfig drives dimensions/stroke
  // when the field carries one.
  private _canvasCtx = new Map<string, CanvasRenderingContext2D>();
  private _canvasDrawing = new Map<string, boolean>();
  canvasWidthFor(p: TestParameter): number {
    return this._fieldByName().get(p.name)?.scribblePadConfig?.width ?? 320;
  }
  canvasHeightFor(p: TestParameter): number {
    return this._fieldByName().get(p.name)?.scribblePadConfig?.height ?? 140;
  }
  private ensureCanvasCtx(name: string, el: HTMLCanvasElement): CanvasRenderingContext2D | null {
    let ctx = this._canvasCtx.get(name);
    if (!ctx) {
      ctx = el.getContext('2d') ?? undefined;
      if (!ctx) return null;
      const cfg = this._fieldByName().get(name)?.scribblePadConfig;
      ctx.strokeStyle = cfg?.strokeColor ?? '#a855f7';
      ctx.lineWidth = cfg?.strokeWidth ?? 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const bg = cfg?.backgroundColor;
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, el.width, el.height); }
      // Restore any existing bitmap stored for this field.
      const existing = this.valueOf(name);
      if (existing && typeof existing === 'string' && existing.startsWith('data:')) {
        const img = new Image();
        img.onload = () => ctx!.drawImage(img, 0, 0);
        img.src = existing;
      }
      this._canvasCtx.set(name, ctx);
    }
    return ctx;
  }
  private canvasPoint(ev: PointerEvent, el: HTMLCanvasElement): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * el.width,
      y: ((ev.clientY - rect.top) / rect.height) * el.height
    };
  }
  canvasDown(ev: PointerEvent, name: string, el: HTMLCanvasElement) {
    ev.preventDefault();
    const ctx = this.ensureCanvasCtx(name, el);
    if (!ctx) return;
    this._canvasDrawing.set(name, true);
    const p = this.canvasPoint(ev, el);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    el.setPointerCapture(ev.pointerId);
  }
  canvasMove(ev: PointerEvent, name: string, el: HTMLCanvasElement) {
    if (!this._canvasDrawing.get(name)) return;
    const ctx = this._canvasCtx.get(name);
    if (!ctx) return;
    const p = this.canvasPoint(ev, el);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  canvasUp(_ev: PointerEvent, name: string, el: HTMLCanvasElement) {
    if (!this._canvasDrawing.get(name)) return;
    this._canvasDrawing.set(name, false);
    try { el.releasePointerCapture(_ev.pointerId); } catch { /* ignore */ }
    // Persist bitmap as data URL so it survives route changes / saves.
    this.setValue(name, el.toDataURL('image/png'));
  }
  clearCanvas(name: string, el: HTMLCanvasElement) {
    const ctx = this._canvasCtx.get(name) ?? el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    this.setValue(name, '');
  }

  setValue(name: string, value: string) {
    this.clearServerError(name);
    this._values.update(s => ({ ...s, [name]: value }));
    // Calculated test: typing into the formula's target field is an override;
    // clearing it hands the field back to the formula. Typing anywhere else
    // (a same-test input the formula reads) re-runs the prefill.
    if (this._calcDef()) {
      const target = this.calcTargetParam();
      if (target?.name === name) {
        this._calcOverridden.set(value !== '' && value != null);
        if (value === '' || value == null) this.applyCalcPrefill();
      } else {
        this.applyCalcPrefill();
      }
    }
  }

  // ── Calculated result (profile formulas — VLDL = TG/5, eGFR…) ────────
  // This screen holds ONE test, so sibling inputs come from the tube's other
  // tests: fetched once, values read from their saved result snapshots. The
  // computed value is a PREFILL — overridable, autosaved like typed input.
  private readonly _calcDef = computed(() => parseCalc(this._ot()?.test?.calculation));
  private readonly _calcSiblings = signal<OrderTest[] | null>(null);
  private readonly _calcOverridden = signal(false);

  private readonly _calcConstants = computed<Record<string, number>>(() => {
    const raw = this.tenantState.tenant()?.calcConstants;
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj))
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      return out;
    } catch { return {}; }
  });

  /** The field the formula writes into — this test's first numeric param. */
  private calcTargetParam(): TestParameter | null {
    return this.parameters().find(p => this.inputKindFor(p) === 'numeric') ?? null;
  }

  /** A sibling's saved value: handles both snapshot shapes
   *  ({p:{value,unit}} and flat {p:value}); param null → first numeric-ish. */
  private siblingValue(t: OrderTest, param: string | null): number | null {
    if (!t.currentResult) return null;
    let values: Record<string, unknown>;
    try { values = (JSON.parse(t.currentResult) as { values?: Record<string, unknown> })?.values ?? {}; }
    catch { return null; }
    const read = (v: unknown): number | null => {
      const raw = v != null && typeof v === 'object' ? (v as { value?: unknown }).value : v;
      if (raw === undefined || raw === null || raw === '') return null;
      const n = Number(String(raw).trim());
      return Number.isFinite(n) ? n : null;
    };
    if (param) {
      const want = param.trim().toLowerCase();
      for (const [k, v] of Object.entries(values))
        if (k.trim().toLowerCase() === want) return read(v);
      return null;
    }
    for (const v of Object.values(values)) {
      const n = read(v);
      if (n != null) return n;
    }
    return null;
  }

  private calcContext(): CalcContext {
    const self = this._ot();
    const selfCode = self?.test?.testCode?.trim().toUpperCase() ?? null;
    const siblings = this._calcSiblings() ?? [];
    const consts = this._calcConstants();
    const patient = self?.subOrder?.order?.patient;
    // Formula AGE: whole years from the DOB (shared helper; as before for
    // every patient with a stored age), never a stale stored value.
    const age = ageInYears(patient);
    const findSibling = (code: string) =>
      siblings.find(t => t.test?.testCode?.trim().toUpperCase() === code) ?? null;
    return {
      value: ref => {
        const sep = ref.indexOf(':');
        const code = (sep < 0 ? ref : ref.slice(0, sep)).trim().toUpperCase();
        const param = sep < 0 ? null : ref.slice(sep + 1);
        if (code === selfCode) {
          // Same-test input (rare): read the live form value.
          const want = param?.trim().toLowerCase();
          const p = want
            ? this.parameters().find(x => x.name.trim().toLowerCase() === want
                || (x.title ?? '').trim().toLowerCase() === want)
            : this.calcTargetParam();
          const raw = p ? this._values()[p.name] : undefined;
          if (raw === undefined || raw === null || raw === '') return null;
          const n = Number(String(raw).trim());
          return Number.isFinite(n) ? n : null;
        }
        const t = findSibling(code);
        return t ? this.siblingValue(t, param) : null;
      },
      constant: name => consts[name],
      age,
      sex: patient?.sex ?? null,
      uln: code => {
        const t = findSibling(code.trim().toUpperCase());
        const raw = t?.test?.parameters;
        if (!raw) return null;
        try {
          const params = (JSON.parse(raw) as TestParametersBlob).parameters ?? [];
          const p = params.find(x => (x.referenceRanges?.length ?? 0) > 0);
          if (!p) return null;
          const sex = normalizeSex(this._ot()?.subOrder?.order?.patient?.sex);
          return selectReferenceRange(p.referenceRanges, sex,
            bandAgeYears(this._ot()?.subOrder?.order?.patient))?.max ?? null;
        } catch { return null; }
      },
    };
  }

  /** Fill the target field from the formula unless the tech has overridden. */
  private applyCalcPrefill() {
    const def = this._calcDef();
    if (!def || this._calcOverridden()) return;
    const target = this.calcTargetParam();
    if (!target) return;
    const res = evaluateCalc(def, this.calcContext());
    const next = res.value != null ? String(res.value) : '';
    const cur = String(this._values()[target.name] ?? '');
    if (cur === next) return;
    this._values.update(s => ({ ...s, [target.name]: next }));
  }

  /** After load: fetch tube siblings for the inputs, then decide auto vs
   *  overridden exactly like the sample screen — a stored value matching the
   *  formula stays live; a differing one was deliberate. */
  private initCalc() {
    const def = this._calcDef();
    const sampleId = this._ot()?.subOrderId ?? this._ot()?.subOrder?.id;
    if (!def || !sampleId) return;
    this.tenantState.ensureLoaded();
    this.api.get<{ tests?: OrderTest[] }>(`/api/samples/${sampleId}/tests`).subscribe({
      next: full => {
        const selfId = this._ot()?.id;
        this._calcSiblings.set((full?.tests ?? []).filter(t => t.id !== selfId));
        const target = this.calcTargetParam();
        const cur = target ? String(this._values()[target.name] ?? '') : '';
        if (cur) {
          const res = evaluateCalc(def, this.calcContext());
          this._calcOverridden.set(res.value == null || String(res.value) !== cur);
        }
        this.applyCalcPrefill();
      },
      error: () => this._calcSiblings.set([]),
    });
  }

  /** Chip beside the calculated field: how the current value got there. */
  calcChipFor(p: TestParameter): { kind: 'auto' | 'manual' | 'na'; label: string } | null {
    const def = this._calcDef();
    if (!def) return null;
    const target = this.calcTargetParam();
    if (!target || target.name !== p.name) return null;
    if (this._calcOverridden()) return { kind: 'manual', label: 'Manual' };
    const res = evaluateCalc(def, this.calcContext());
    if (res.invalid) return { kind: 'na', label: 'Not calculable' };
    if (res.value != null) return { kind: 'auto', label: 'Calculated' };
    return { kind: 'auto', label: 'Auto' };
  }

  setNote(n: string) { this._note.set(n); }
  setActive(name: string) { this._active.set(name); }
  clearActive() { /* keep last target visible rather than blanking */ }

  toggleMobileRail() { this._mobileRailOpen.update(v => !v); }
  closeMobileRail() { this._mobileRailOpen.set(false); }

  /** NumPad changes only route when an input is active AND it's numeric. */
  padChange(v: string) {
    const name = this._active();
    if (!name) return;
    const p = this.parameters().find(x => x.name === name);
    if (!p || this.inputKindFor(p) !== 'numeric') return;
    this.setValue(name, v);
  }

  clearActiveValue() {
    const name = this._active();
    if (!name) return;
    this.setValue(name, '');
  }

  /** Called by the rail when an option tile is tapped. Writes the value and
   *  auto-advances to the next empty param. */
  pickOption(opt: string) {
    const name = this._active();
    if (!name) return;
    this.setValue(name, opt);
    // Advance after the signal settles so the new value counts toward "empty" check.
    queueMicrotask(() => this.advance());
  }

  /** Human-readable render of a value for the rail header. Shows the number
   *  right-aligned for numerics, passes through for choices. */
  prettyValue(name: string): string {
    const v = this.valueOf(name);
    if (v === undefined || v === '') return '—';
    return v;
  }

  /** Jump focus to the next empty numeric parameter (after current active). */
  advance() {
    const params = this.parameters();
    const cur = this._active();
    const startIdx = cur ? Math.max(0, params.findIndex(p => p.name === cur)) : -1;
    // Look forward first, then wrap around.
    const order = [
      ...params.slice(startIdx + 1),
      ...params.slice(0, startIdx + 1),
    ];
    const next = order.find(p => {
      if (this.inputKindFor(p) !== 'numeric') return false;
      const v = this._values()[p.name];
      return v === undefined || v === null || v === '';
    });
    if (!next) return;
    this._active.set(next.name);
    this.focusInput(next.name);
  }

  advanceFrom(name: string) {
    // Called from Enter in ANY input kind. Walk the parameters in document
    // order (wrapping past the end) and land on the FIRST one that actually
    // has a focusable input rendered — kinds without a native focus target
    // (chips, toggles, canvas…) are skipped so Enter never dead-ends.
    const params = this.parameters();
    const idx = params.findIndex(p => p.name === name);
    if (idx < 0) return;
    const candidates = params.slice(idx + 1).concat(params.slice(0, idx));
    for (const p of candidates) {
      if (this.isLayoutKind(this.inputKindFor(p))) continue;
      if (this.focusParam(p.name)) return;
    }
  }

  /** Focus the rendered input for a parameter (input/textarea/select, or the
   *  pf-select trigger inside a data-param wrapper). Scrolls it into view so
   *  Enter-Enter-Enter feels seamless on the bench iPad. Returns false when
   *  no focusable element exists for this parameter in the current view. */
  private focusParam(name: string): boolean {
    const host = this.host.nativeElement as HTMLElement;
    const el = host.querySelector(`[data-param="${CSS.escape(name)}"]`) as HTMLElement | null;
    if (!el) return false;
    const target = el.matches('input, textarea, select, button, [tabindex]')
      ? el
      : el.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]');
    if (!target) return false;
    this._active.set(name);
    target.focus();
    if (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')) {
      target.select();
    }
    target.scrollIntoView({ block: 'nearest' });
    return true;
  }

  private focusInput(name: string) {
    this.focusParam(name);
  }

  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }
  asArea(ev: Event): string  { return (ev.target as HTMLTextAreaElement).value; }

  saveDraft() {
    this._lastSavedAt.set(new Date());
    this.toasts.success('Draft saved');
  }

  submit() {
    const id = this._ot()?.id;
    if (!id || this._saving()) return;
    if (!this.canSubmit()) {
      this.toasts.warning(`Fill all ${this.requiredCount()} required parameters before submit.`);
      return;
    }
    // A numeric parameter holding a non-parseable value must never be
    // submitted as the result — the input already shows the invalid state.
    if (this.hasInvalidNumeric()) {
      this.toasts.warning('One or more numeric results are not valid numbers — fix them before submitting.');
      return;
    }
    this._saving.set(true);
    this.api.post<EnterResponse>(`/api/results/${id}/enter`, {
      values: this._values(),
      note: this._note() || null
    }).subscribe({
      next: res => {
        this._saving.set(false);
        if (res.flags.critical) this.toasts.warning('Submitted — flagged critical');
        else this.toasts.success('Result submitted');
        this.back();
      },
      error: e => {
        this._saving.set(false);
        const err = ApiError.from(e);
        // Field-named failure → highlight that input inline; otherwise toast the
        // real backend message.
        if (err.field && this.parameters().some(p => p.name === err.field)) {
          this._serverErrors.update(s => ({ ...s, [err.field!]: err.message }));
          this._active.set(err.field);
        } else {
          this.toasts.error(err.message);
        }
      }
    });
  }

  async rejectSample() {
    const id = this._ot()?.id;
    if (!id) return;
    const reason = await this.dialog.prompt({
      title: 'Reject this sample?',
      message: 'The sample will be sent back for re-collection. Please describe what went wrong.',
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject sample'
    });
    if (!reason) return;
    this.rejecting.set(true);
    this.api.post(`/api/results/${id}/reject-sample`, { reason }).pipe(finalize(() => this.rejecting.set(false))).subscribe({
      next: () => { this.toasts.success('Sample rejected'); this.back(); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  back() {
    const ot = this._ot();
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    if (returnTo === 'validate' && ot) {
      this.router.navigate(['/pathologist/validate', ot.id]);
      return;
    }
    this.router.navigateByUrl('/lab/my-work');
  }
}
