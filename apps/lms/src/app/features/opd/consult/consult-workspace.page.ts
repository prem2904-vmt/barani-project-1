import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, filter, switchMap, of, catchError } from 'rxjs';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { PatientTimelineComponent } from '../../frontdesk/patient-profile/patient-timeline.component';
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import type { OpdDiagnosis, OpdNoteVisibility, OpdPatientAllergy } from '../shared/opd.models';
import {
  ConsultApi, ConsultDrug, ConsultDxSuggestion, ConsultInvestigationItem, ConsultPastConsult, ConsultUsual, ConsultWorkspace, LabTestRow, mediaRefOf,
} from './consult.api';
import {
  ConsultEditState, ConsultStep, DraftSection, FRESH_ACKS, SECTION_OF, STEP_TITLES, applyUsual, daysBetween, draftBody, draftPatchBody,
  procedureDraftOf, reconcileProcedureIds, reconcileRxIds, stepDone, stepSummary, undoUsual, usualsFrom,
} from './consult-state';
import { ConsultProceduresComponent } from './procedure-editor.component';
import { ConsultVitalsComponent, bmiOf } from './vitals-strip.component';
import { ConsultGlanceComponent, RecentResult, recentResultsOf } from './glance-panel.component';
import { ConsultTimelineComponent, type HistoryNode, type TimelineStepView } from './consult-timeline.component';
import { ConsultCompleteSheetComponent, addDaysIso } from './complete-sheet.component';
import {
  OpdFormRendererComponent, allQuestions, missingRequired, normalizeSchema,
  type OpdAnswers, type OpdFormDoc, type OpdMediaRef, type OpdMediaRequest,
} from '../admin/forms/renderer';
import { RxEditorComponent } from './rx/rx-editor.component';
import { ConsultDrugRef, ConsultRxLine, drugRefOf, fromDto, unresolvedAllergies, unresolvedPregnancyRisks } from './rx/rx-model';
import { newRxLine } from '../shared/rx-schedule';
import { buildRxPdf } from './rx-print';
import { OpdSpecimenPickerComponent } from '../shared/opd-specimen-picker.component';
import { missingSpecimens, type OpdTestLookup } from '../shared/opd-specimen';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const EMPTY: ConsultEditState = {
  answers: {}, chiefComplaint: '', diagnoses: [], advice: '', privateNotes: '', privateNotesVisibility: 'doctor',
  lines: [], tests: [], followUpDays: null,
};

/**
 * `/opd/consult/:visitId` — the FULL-SCREEN consult (Agent C), in the New
 * visit / My patients design language (owner 2026-10-03). ONE screen:
 *  - Header: who (name, age/sex, MRN, token, department, doctor, status),
 *    the draft state, Compare and ONE primary "Complete consult"; today's
 *    vitals as stat tiles under it (High / Low tinted, an arrow vs the last
 *    visit).
 *  - Left TIMELINE card: today's consult with its four steps (tap = go
 *    there), then the patient's dated history — visits, lab results,
 *    prescriptions, files — expanding in place with Open / Compare (which
 *    open the existing patient journey / compare viewer in a sheet).
 *  - Centre card: the current step with a "Step n of 4" header and a sticky
 *    Back / Next footer.
 *  - Right AT A GLANCE card.
 * Tablet: the timeline is a slim rail (expands as a sheet), the glance a
 * slide-over. Phone: one column; timeline + glance are sheets from header
 * buttons. Toggles html.pf-opd-immersive (the shell hides its chrome).
 */
@Component({
  selector: 'pf-opd-consult-workspace',
  standalone: true,
  imports: [OpdSpecimenPickerComponent, ConsultProceduresComponent, 
    DatePipe, ConsultVitalsComponent, ConsultGlanceComponent, ConsultCompleteSheetComponent, OpdFormRendererComponent,
    RxEditorComponent, PatientTimelineComponent, ConsultTimelineComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ws(); as w) {
      <div class="cw" [class.cw--glance]="glanceOpen()" [class.cw--tl]="timelineOpen()" [class.cw--journey]="journeyOpen()">
        <!-- ── Header: who + the one action; today's vitals as stat tiles ── -->
        <header class="cw__top">
          <div class="cw__bar">
            <button type="button" class="cw__iconbtn" (click)="back()" aria-label="Back to my patients">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <span class="cw__avatar nd-num" aria-hidden="true">{{ initials(w.patient.name) }}</span>
            <div class="cw__who">
              <div class="cw__nameline">
                <h1 class="cw__name">{{ w.patient.name }}</h1>
                <span class="cw__status" [attr.data-status]="w.visit.status">
                  @if (w.visit.status === 'in_consult') { <span class="cw__live" aria-hidden="true"></span> }
                  {{ statusLabel(w.visit.status) }}
                </span>
              </div>
              <div class="cw__meta nd-num">
                @for (m of metaBits(); track $index) { <span>{{ m }}</span> }
              </div>
            </div>
            <span class="cw__grow"></span>
            @if (editable()) {
              <span class="nd-savestate cw__save" aria-live="polite">
                @switch (saveState()) {
                  @case ('saving') { <span class="nd-savestate__dot"></span> Saving… }
                  @case ('dirty') { <span class="nd-savestate__dot"></span> Unsaved changes }
                  @case ('error') { <span class="cw__saveerr">Not saved — retrying</span> }
                  @default { @if (savedAt()) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Draft saved {{ savedAt() | date:'h:mm a' }} } }
                }
              </span>
            }
            <button type="button" class="nd-btn nd-btn--quiet cw__tl-btn" (click)="timelineOpen.set(!timelineOpen())" [attr.aria-expanded]="timelineOpen()" aria-label="Timeline">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="6" cy="12" r="2"/><path d="M6 7v3M6 14v3M11 5h9M11 12h9M11 19h9"/></svg>
              <span class="cw__hide-sm">Timeline</span>
            </button>
            <button type="button" class="nd-btn nd-btn--quiet cw__glance-btn" (click)="glanceOpen.set(!glanceOpen())" [attr.aria-expanded]="glanceOpen()" aria-label="At a glance">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
              <span class="cw__hide-sm">At a glance</span>
              @if (allergies().length) { <span class="cw__alertdot" aria-label="has allergies"></span> }
            </button>
            <button type="button" class="nd-btn nd-btn--quiet cw__cmp" (click)="compare()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>
              <span class="cw__hide-sm">Compare</span>
            </button>
            @if (editable()) {
              <button type="button" class="nd-btn nd-btn--primary cw__cta" (click)="openComplete()">
                Complete consult
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              </button>
            } @else if (w.visit.status === 'completed') {
              <button type="button" class="nd-btn nd-btn--secondary" (click)="share()">Share</button>
              <button type="button" class="nd-btn nd-btn--primary cw__cta" (click)="print()">Print prescription</button>
            }
          </div>
          <pf-consult-vitals class="cw__vitals" [vitals]="w.vitals" [history]="w.vitalsHistory"></pf-consult-vitals>
        </header>

        <div class="cw__main">
          <!-- ── Left: TIMELINE (today's steps + the patient's history) ── -->
          @if (timelineOpen()) { <div class="cw__scrim cw__scrim--tl" (click)="timelineOpen.set(false)" aria-hidden="true"></div> }
          <aside class="nd-card cw__tl" aria-label="Timeline">
            <pf-consult-timeline [steps]="stepViews()" [nodes]="historyNodes()" [visitDate]="w.visit.visitDate" [loading]="historyLoading()"
                                 [slim]="tablet() && !timelineOpen()" (go)="goFromTimeline($event)" (open)="openNode($event)"
                                 (compare)="compareNode($event)" (expand)="timelineOpen.set(true)"></pf-consult-timeline>
          </aside>

          <!-- ── Centre: the current step ── -->
          <section class="nd-card cw__center" [attr.aria-label]="titles[step()]">
            <header class="nd-card__head cw__stephead">
              <span class="nd-card__icon" aria-hidden="true">
                @switch (step()) {
                  @case (1) { <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/></svg> }
                  @case (2) { <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="m9 9 6 6"/></svg> }
                  @case (3) { <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/></svg> }
                  @default { <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> }
                }
              </span>
              <span class="nd-card__label">{{ titles[step()] }}</span>
              <span class="nd-card__spacer"></span>
              <span class="cw__stepof nd-num">Step {{ step() }} of 4</span>
              <span class="cw__dots" aria-hidden="true">
                @for (s of steps; track s) { <span class="cw__dot" [class.on]="s === step()" [class.done]="done(s) && s !== step()"></span> }
              </span>
            </header>

            <div class="cw__body" #center>
              @for (s of [step()]; track s) {
                <div class="cw__pane">
                  @switch (s) {
                    @case (1) {
                      <!-- Complaint -->
                      <section class="cw__grp" data-grp="complaint">
                        <div class="cw__grph">
                          <span class="cw__grpt">Complaint</span>
                          @if (w.visit.purpose) { <span class="cw__grpn">Desk note: {{ w.visit.purpose }}</span> }
                        </div>
                        <input class="nd-input cw__in" type="text" [value]="st().chiefComplaint" [disabled]="!editable()" aria-label="Chief complaints"
                               (input)="patch({ chiefComplaint: $any($event.target).value })" placeholder="What brings the patient in" />
                      </section>

                      <!-- The service's consult form (History, Known conditions, Examination…) -->
                      @if (w.form) {
                        <section class="cw__grp cw__form" data-grp="form">
                          <pf-opd-form-renderer [schema]="formSchema()" [addons]="w.form.addonFields" [answers]="st().answers"
                                                [mode]="editable() ? 'edit' : 'readonly'" [layout]="phone() ? 'phone' : 'screen'" [visitDate]="w.visit.visitDate"
                                                (answersChange)="patch({ answers: $event })" (mediaRequest)="captureMedia($event)"></pf-opd-form-renderer>
                          <input #mediaIn class="cw__file" type="file" tabindex="-1" aria-hidden="true" (change)="onMediaPicked(mediaIn)" />
                          @if (uploading()) { <p class="cw__upl" role="status">Uploading {{ uploading() }}…</p> }
                        </section>
                      } @else {
                        <p class="cw__muted">No consult form is set for this service — the complaint and diagnosis are enough to finish.</p>
                      }

                      <!-- Diagnosis -->
                      <section class="cw__grp cw__grp--dx" data-grp="diagnosis">
                        <div class="cw__grph"><span class="cw__grpt">Diagnosis</span>@if (st().diagnoses.length) { <span class="cw__grpn">The first one is the main diagnosis</span> }</div>
                        @if (st().diagnoses.length) {
                          <div class="cw__chips">
                            @for (d of st().diagnoses; track d.label; let i = $index) {
                              <span class="cw__dx" [class.cw__dx--p]="i === 0">
                                @if (i === 0) { <span class="cw__dxmain">Main</span> }
                                {{ d.label }}@if (d.code) { <em>{{ d.code }}</em> }
                                @if (editable()) {
                                  <button type="button" (click)="removeDx(i)" [attr.aria-label]="'Remove ' + d.label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                                }
                              </span>
                            }
                          </div>
                        } @else if (!editable()) { <p class="cw__muted">No diagnosis recorded.</p> }
                        @if (editable()) {
                          <div class="cw__dxbox">
                            <svg class="cw__dxglass" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                            <input #dxIn class="nd-input cw__in cw__dxin" type="text" [value]="dxQuery()" (input)="onDxType(dxIn.value)" (keydown)="onDxKey($event)"
                                   placeholder="Search a diagnosis — pick one, or press Enter to add it as written" aria-label="Add a diagnosis"
                                   role="combobox" [attr.aria-expanded]="dxOpen()" aria-controls="cw-dx-list" autocomplete="off" />
                            @if (dxOpen()) {
                              <div id="cw-dx-list" class="cw__dxlist" role="listbox">
                                @for (o of dxSuggest(); track o.label; let i = $index) {
                                  <button type="button" role="option" class="cw__dxopt" [class.act]="i === dxActive()" [attr.aria-selected]="i === dxActive()" (mousedown)="$event.preventDefault()" (click)="addDx(o)">
                                    <span>{{ o.label }}</span><em>{{ o.code }}@if (o.source === 'mine') { · yours } @else if (o.source === 'template') { · usual set }</em>
                                  </button>
                                }
                                @if (dxQuery().trim()) {
                                  <button type="button" class="cw__dxopt" [class.act]="dxActive() === dxSuggest().length" (mousedown)="$event.preventDefault()" (click)="addDx({ label: dxQuery().trim(), source: 'mine' })">
                                    <span>Add “{{ dxQuery().trim() }}” as written</span>
                                  </button>
                                }
                              </div>
                            }
                          </div>
                          <div class="cw__quick">
                            @if (usual(); as u) {
                              @if (!usualApplied()) {
                                <button type="button" class="cw__usual" (click)="applyUsualSet()">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>
                                  <span><b>{{ u.source === 'template' ? 'Template' : 'Usual' }} for {{ primaryDx() }}</b> — {{ u.rx.length }} medicine{{ u.rx.length === 1 ? '' : 's' }}@if (u.tests.length) { + {{ u.tests.length }} test{{ u.tests.length === 1 ? '' : 's' }}} · one tap</span>
                                </button>
                              }
                            }
                            @if (w.lastVisit?.rx?.length) {
                              <button type="button" class="nd-btn nd-btn--quiet" (click)="repeatLast()">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                                Repeat {{ w.lastVisit!.visitDate | date:'MMM d' }} Rx
                              </button>
                            }
                          </div>
                        }
                        @if (usualApplied()) {
                          <div class="cw__banner">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>
                            <span>Your usual for <b>{{ usualApplied()!.dx }}</b> is in. Tap any value to change just that.</span>
                            <button type="button" class="nd-btn nd-btn--tertiary" (click)="undoUsualSet()">Undo</button>
                          </div>
                        }
                      </section>
                    }
                  @case (2) {
                    <div class="cw__h">
                      @if (primaryDx()) { <span class="cw__dxtag">For {{ primaryDx() }}</span> }
                      <span class="cw__grow"></span>
                      @if (editable() && w.lastVisit?.rx?.length) {
                        <button type="button" class="nd-btn nd-btn--quiet" (click)="repeatLast()">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                          Repeat {{ w.lastVisit!.visitDate | date:'MMM d' }} Rx
                        </button>
                      }
                    </div>
                    @if (usualApplied()) {
                      <div class="cw__banner">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>
                        <span>Your usual for <b>{{ usualApplied()!.dx }}</b> is in. Tap any value to change just that.</span>
                        <button type="button" class="nd-btn nd-btn--tertiary" (click)="undoUsualSet()">Undo</button>
                      </div>
                    } @else if (editable() && usual() && !st().lines.length) {
                      <button type="button" class="cw__usual" (click)="applyUsualSet()">
                        <span><b>{{ usual()!.source === 'template' ? 'Template' : 'Usual' }} for {{ primaryDx() }}</b> — add {{ usual()!.rx.length }} medicine{{ usual()!.rx.length === 1 ? '' : 's' }} in one tap</span>
                      </button>
                    }
                    <pf-rx-editor [lines]="st().lines" (linesChange)="patch({ lines: $event })" [drugs]="drugList()" [allergies]="allergies()"
                                  [pregnant]="ws()?.pregnancy ?? null"
                                  [readonly]="!editable()" [start]="visitDay()" [usuals]="usuals()" [preferIds]="preferIds()"
                                  (search)="drugSearch$.next($event)" (notice)="toast.info($event)"></pf-rx-editor>
                  }
                  @case (3) {
                    <div class="cw__h"><span class="cw__hint">Tests go to the lab as a normal order when you complete the consult; procedures go to the front desk's bill.</span></div>
                    @if (suggested().length) {
                      <div class="cw__sec">
                        <div class="cw__seck cw__seck--row">Suggested for {{ primaryDx() }}
                          @if (editable() && suggestedMissing().length) { <button type="button" class="nd-btn nd-btn--quiet" (click)="orderAll()">+ Order all {{ suggestedMissing().length }}</button> }
                        </div>
                        <div class="cw__tiles">
                          @for (t of suggested(); track t.testId) {
                            <button type="button" class="cw__tile" [class.on]="hasTest(t.testId)" [disabled]="!editable()" (click)="toggleTest(t)" [attr.aria-pressed]="hasTest(t.testId)">
                              <span class="cw__tico">@if (hasTest(t.testId)) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> } @else { + }</span>
                              <span class="cw__tn">{{ t.name }}</span>@if (t.price) { <span class="cw__tp">₹{{ t.price }}</span> }
                            </button>
                          }
                        </div>
                      </div>
                    }
                    @if (editable()) {
                      <div class="cw__sec">
                        <div class="cw__seck">All tests</div>
                        <input #tIn class="nd-input cw__in cw__search" type="text" [value]="testQuery()" (input)="testQuery.set(tIn.value)" placeholder="Search the lab's tests — name, code or short name (LFT, CBC…)" aria-label="Search lab tests" />
                        @if (testLoadError()) { <p class="cw__muted">The lab test list could not be loaded for your role.</p> }
                        <div class="cw__tiles">
                          @for (t of testHits(); track t.id) {
                            <button type="button" class="cw__tile" [class.on]="hasTest(t.id)" (click)="toggleTest({ testId: t.id, name: t.name, price: t.price })" [attr.aria-pressed]="hasTest(t.id)">
                              <span class="cw__tico">@if (hasTest(t.id)) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> } @else { + }</span>
                              <span class="cw__tn">{{ t.name }}</span>@if (t.price) { <span class="cw__tp">₹{{ t.price }}</span> }
                            </button>
                          }
                        </div>
                      </div>
                    }
                    <div class="cw__sec">
                      <div class="cw__seck">Ordered <span>{{ st().tests.length }} test{{ st().tests.length === 1 ? '' : 's' }}@if (testTotal()) { · ₹{{ testTotal() }}}</span></div>
                      @for (t of st().tests; track t.testId) {
                        <div class="nd-row cw__ordered">
                          <span class="nd-row__name">{{ t.name }}</span>
                          @if (editable()) {
                            <pf-opd-specimen-picker [test]="testForPicker(t.testId)" [value]="t.specimen ?? null" [invalid]="specimenInvalid(t.testId)"
                                                    (valueChange)="setSpecimen(t.testId, $event)"></pf-opd-specimen-picker>
                          } @else if (t.specimen) {
                            <pf-opd-specimen-picker [test]="testForPicker(t.testId)" [value]="t.specimen" [readonly]="true"></pf-opd-specimen-picker>
                          }
                          @if (t.price) { <span class="nd-row__value">₹{{ t.price }}</span> }
                          @if (editable()) { <button type="button" class="cw__x" (click)="toggleTest(t)" [attr.aria-label]="'Remove ' + t.name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button> }
                        </div>
                      } @empty { <p class="cw__muted">{{ editable() ? 'No tests yet.' : 'No tests were ordered.' }}</p> }
                      @if (w.visit.labOrderId && !editable() && st().tests.length) { <p class="cw__muted">Sent to the lab as a normal order.</p> }
                    </div>
                    @if (st().procedures; as procs) {
                      <div class="cw__sec" id="cw-procedures">
                        <div class="cw__seck">Procedures <span>{{ procs.length ? procs.length + ' added' : (editable() ? 'Did you do one? Add it here — it is billed at the desk.' : '') }}</span></div>
                        <pf-consult-procedures [options]="w.procedureOptions ?? []" [items]="procs" [pricing]="w.procedurePricing ?? null"
                                               [readonly]="!editable()" [payAfter]="w.billing?.mode === 'after_consult'"
                                               (itemsChange)="patch({ procedures: $event })"></pf-consult-procedures>
                      </div>
                    }
                  }
                  @case (4) {
                    <div class="cw__sec">
                      <label class="nd-field">
                        <span class="nd-field__lbl">Advice for the patient <em class="cw__lblhint">printed on the prescription</em></span>
                        <textarea class="nd-input cw__in" rows="3" [value]="st().advice" [disabled]="!editable()" (input)="patch({ advice: $any($event.target).value })" placeholder="Diet, rest, red flags to watch for…"></textarea>
                      </label>
                    </div>
                    <div class="cw__sec">
                      <div class="cw__seck cw__seck--row">Private notes
                        <span class="cw__lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Private</span>
                      </div>
                      @if (w.consult?.privateNotesHidden) {
                        <p class="cw__muted">The consulting doctor's private notes are not visible to you.</p>
                      } @else {
                        <textarea class="nd-input cw__in cw__notes" rows="7" [value]="st().privateNotes" [disabled]="!editable()" (input)="patch({ privateNotes: $any($event.target).value })" placeholder="Only for you — never printed, never sent to the patient."></textarea>
                        <p class="cw__muted">{{ visibilityText() }} Never printed, never sent on WhatsApp.</p>
                      }
                    </div>
                  }
                  }
                </div>
              }
            </div>

            <footer class="cw__foot">
              @if (step() > 1) {
                <button type="button" class="nd-btn nd-btn--secondary cw__navbtn" (click)="go(prevStep(step()))" data-back>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m6 6-6-6 6-6"/></svg>
                  Back
                </button>
              }
              <span class="cw__grow"></span>
              @if (step() < 4) {
                <button type="button" class="nd-btn nd-btn--secondary cw__navbtn cw__navbtn--next" (click)="go(nextStep(step()))" data-next>
                  Next: {{ titles[nextStep(step())] }}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-6 6 6-6 6"/></svg>
                </button>
              } @else if (editable()) {
                <button type="button" class="nd-btn nd-btn--secondary cw__navbtn cw__navbtn--next" (click)="openComplete()">
                  Review &amp; complete
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-6 6 6-6 6"/></svg>
                </button>
              }
            </footer>
          </section>

          <!-- ── Right: AT A GLANCE ── -->
          @if (glanceOpen()) { <div class="cw__scrim" (click)="glanceOpen.set(false)" aria-hidden="true"></div> }
          <aside class="nd-card cw__glance" aria-label="At a glance">
            <pf-consult-glance [ws]="w" [allergies]="allergies()" [lines]="st().lines" [drugs]="drugList()" [results]="results()"
                               [canEdit]="editable()" [closable]="narrow()" [preferIds]="preferIds()"
                               (close)="glanceOpen.set(false)" (swap)="swapLine($event.key, $event.alt)" (seeLine)="seeLine()"
                               (repeatLast)="repeatLast()" (addAllergy)="addAllergy($event)" (removeAllergy)="removeAllergy($event)"></pf-consult-glance>
          </aside>
        </div>

        <!-- Visit journey: reports, images and Compare — opened from the timeline or Compare. -->
        @if (journeyOpen()) { <div class="cw__scrim cw__scrim--journey" (click)="journeyOpen.set(false)" aria-hidden="true"></div> }
        <section class="cw__journey" [class.open]="journeyOpen()" aria-label="Visit journey" [attr.aria-hidden]="!journeyOpen()">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h5a4 4 0 0 1 4 4M7 18h5a4 4 0 0 0 4-4"/></svg></span>
            <span class="nd-card__label">Reports, images &amp; compare</span>
            <span class="nd-card__spacer"></span>
            <button type="button" class="cw__iconbtn" (click)="journeyOpen.set(false)" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>
          <pf-patient-timeline #tl [patientId]="w.patient.id" [embedded]="true" [hideTitle]="true"></pf-patient-timeline>
        </section>

        @if (completeOpen()) {
          <pf-consult-complete-sheet [patientName]="w.patient.name" [token]="w.visit.tokenLabel" [diagnoses]="st().diagnoses" [lines]="st().lines"
                                     [tests]="st().tests" [procedures]="st().procedures ?? []" [billing]="w.billing ?? null" [followUpDays]="st().followUpDays" [followUpRule]="w.followUpRule ?? null" [visitDate]="visitDay()"
                                     [unresolved]="unresolved().length" [pregnancyUnresolved]="pregnancyUnresolved().length" [missingRequired]="requiredMissing()" [busy]="completing()"
                                     (followUpDaysChange)="patch({ followUpDays: $event })" (cancel)="completeOpen.set(false)" (confirm)="complete()"></pf-consult-complete-sheet>
        }
      </div>
    } @else if (loading()) {
      <div class="cw cw--loading"><div class="cw__skel" aria-label="Opening the consult"><span></span><span></span><span></span></div></div>
    } @else {
      <div class="cw cw--loading">
        <div class="nd-empty">
          <p class="nd-empty__title">{{ loadError() || 'Visit not found' }}</p>
          <button type="button" class="nd-btn nd-btn--secondary" (click)="back()">Back to my patients</button>
        </div>
      </div>
    }
  `,
  styleUrl: './consult-workspace.page.scss',
})
export class OpdConsultWorkspacePage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly consultApi = inject(ConsultApi);
  private readonly api = inject(ApiService);
  private readonly navBack = inject(NavBackService);
  private readonly auth = inject(AuthService);
  private readonly doc = inject(DOCUMENT);
  readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly titles = STEP_TITLES;
  readonly steps: ConsultStep[] = [1, 2, 3, 4];

  readonly ws = signal<ConsultWorkspace | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly st = signal<ConsultEditState>(EMPTY);
  readonly step = signal<ConsultStep>(1);
  readonly allergies = signal<OpdPatientAllergy[]>([]);
  readonly results = signal<RecentResult[]>([]);
  readonly glanceOpen = signal(false);
  /** Tablet / phone: the full timeline as a sheet. */
  readonly timelineOpen = signal(false);
  /** The patient journey / compare viewer (pf-patient-timeline) sheet. */
  readonly journeyOpen = signal(false);
  /** Past consults of this patient (GET …/patients/{id}/history) — the timeline's visits + prescriptions. */
  readonly historyRows = signal<ConsultPastConsult[] | null>(null);
  readonly historyLoading = signal(false);
  readonly completeOpen = signal(false);
  readonly completing = signal(false);
  readonly saveState = signal<SaveState>('idle');
  readonly savedAt = signal<string | null>(null);
  /** Autosave (owner 2026-10-01): only the sections edited since the last
   *  save ride the PATCH — set by patch(), drained by saveNow(). */
  private readonly dirty = new Set<DraftSection>();
  /** The last-saved consult.updatedAt — the PATCH's optimistic-concurrency token. */
  private draftUpdatedAt: string | null = null;
  /** Critic P1-2: a REAL in-flight flag (not saveState — patch() can
   *  overwrite that with 'dirty' mid-request). While true, saveNow() never
   *  fires a second PATCH; it just returns, and the one in flight drains
   *  whatever is left in `dirty` itself once it resolves. */
  private inFlight = false;
  /** Consecutive stale_draft hits with no successful save between them — a
   *  circuit breaker so a draft that keeps changing elsewhere doesn't retry
   *  forever; past the limit we stop and ask (DialogService) instead. */
  private staleRetries = 0;

  private readonly drugCache = signal<Map<string, ConsultDrugRef>>(new Map());
  readonly drugList = computed(() => [...this.drugCache().values()]);
  readonly drugSearch$ = new Subject<string>();

  readonly usual = signal<ConsultUsual | null>(null);
  readonly usualApplied = signal<{ dx: string; keys: string[]; tests: string[]; advice: boolean } | null>(null);

  readonly testCatalog = signal<LabTestRow[]>([]);
  readonly testLoadError = signal(false);
  readonly testQuery = signal('');

  readonly dxQuery = signal('');
  readonly dxSuggest = signal<ConsultDxSuggestion[]>([]);
  readonly dxActive = signal(0);
  readonly dxOpen = computed(() => !!this.dxQuery().trim());
  private readonly dx$ = new Subject<string>();

  private readonly tl = viewChild<PatientTimelineComponent>('tl');

  private readonly save$ = new Subject<void>();

  /** The service's form without the questions the consult owns (chief complaint). */
  readonly formSchema = computed(() => withoutConsultOwned(this.ws()?.form?.schema));

  /** Phone layout for the form renderer (one column) — the renderer's own ≤760px rule. */
  readonly phone = signal(typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches);
  /** ≤1100px: the glance is a slide-over (tablet + phone). */
  readonly narrow = signal(typeof matchMedia === 'function' && matchMedia('(max-width: 1100px)').matches);
  /** 761–1100px: the timeline is a slim rail. */
  readonly tablet = computed(() => this.narrow() && !this.phone());
  private readonly narrowMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 1100px)') : null;
  private readonly onNarrowMq = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
  private readonly phoneMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  private readonly onPhoneMq = (e: MediaQueryListEvent) => this.phone.set(e.matches);
  private readonly mediaIn = viewChild<{ nativeElement: HTMLInputElement }>('mediaIn');
  private pendingMedia: OpdMediaRequest | null = null;
  /** The file name being uploaded (null = idle). */
  readonly uploading = signal<string | null>(null);

  readonly editable = computed(() => {
    const w = this.ws();
    return !!w && w.visit.canEdit && w.visit.status === 'in_consult' && w.consult?.status !== 'completed';
  });
  readonly visitDay = computed(() => { const d = this.ws()?.visit.visitDate; return d ? new Date(d.slice(0, 10) + 'T00:00:00') : new Date(); });
  readonly primaryDx = computed(() => this.st().diagnoses[0]?.label ?? '');
  readonly unresolved = computed(() => unresolvedAllergies(this.st().lines, this.allergies()));
  /** Pregnancy-safety guard (night/safety, critic P0 #1c) — blocks Complete like unresolved allergies. */
  readonly pregnancyUnresolved = computed(() => unresolvedPregnancyRisks(this.st().lines, this.ws()?.pregnancy ?? null));
  /** Required fields (night/safety, critic P1 #2) — visible, required consult-form questions with no answer. */
  readonly requiredMissing = computed(() => missingRequired(allQuestions(this.formSchema()), this.st().answers));
  readonly usuals = computed(() => usualsFrom(this.usual()?.rx, this.ws()?.lastVisit?.rx, this.ws()?.rx));
  readonly preferIds = computed(() => (this.usual()?.rx ?? []).map(r => r.drugId).filter((x): x is string => !!x));
  readonly suggested = computed<ConsultInvestigationItem[]>(() => (this.usual()?.tests ?? []).map(t => ({ ...t, price: this.priceOf(t.testId) })));
  readonly suggestedMissing = computed(() => this.suggested().filter(t => !this.hasTest(t.testId)));
  readonly testTotal = computed(() => this.st().tests.reduce((a, t) => a + (Number(t.price) || 0), 0));
  readonly testHits = computed(() => {
    const q = this.testQuery().trim().toLowerCase();
    if (!q) return [];
    return this.testCatalog().filter(t => `${t.name} ${t.testCode ?? ''} ${t.shortName ?? ''}`.toLowerCase().includes(q)).slice(0, 12);
  });
  /** Header meta as separate bits (age / sex · MRN · token · department · doctor). */
  readonly metaBits = computed(() => {
    const w = this.ws();
    if (!w) return [] as string[];
    const sex = w.patient.sex ? w.patient.sex.charAt(0).toUpperCase() : '';
    return [[w.patient.ageDisplay, sex].filter(Boolean).join(' '), w.patient.mrn ?? '', 'Token ' + w.visit.tokenLabel,
      w.visit.departmentName ?? '', w.visit.doctorName ?? ''].filter(Boolean);
  });
  /** Today's four steps as the timeline shows them. */
  readonly stepViews = computed<TimelineStepView[]>(() => this.steps.map(n => {
    const sum = stepSummary(n, this.st(), this.allergies(), this.st().privateNotesVisibility);
    return { n, title: this.titles[n], summary: sum.text, warn: sum.warn, done: stepDone(n, this.st()), current: this.step() === n };
  }));
  /** The patient's dated history for the timeline: past consults (visits +
   *  their prescriptions) from the consult history, lab reports and files
   *  from the patient journey (pf-patient-timeline's own loads). */
  readonly historyNodes = computed<HistoryNode[]>(() => {
    const w = this.ws();
    if (!w) return [];
    const out: HistoryNode[] = [];
    const rows = this.historyRows();
    if (rows) {
      for (const c of rows) {
        if (c.visitId === w.visit.id) continue;
        const key = dayKeyOf(c.visitDate);
        out.push({
          id: 'v:' + c.visitId, type: 'visit', date: c.visitDate, dayKey: key, canCompare: true,
          title: c.diagnoses.length ? c.diagnoses.map(d => d.label).join(', ') : 'No diagnosis recorded',
          sub: [c.doctorName, c.departmentName].filter(Boolean).join(' · ') || null,
          lines: [
            c.chiefComplaint ? 'Complaint: ' + c.chiefComplaint : '',
            c.investigations.length ? `Tests: ${c.investigations.flatMap(i => i.items).map(t => t.name).join(', ')}` : '',
            c.procedures?.length ? `Procedures: ${c.procedures.map(p => p.name).join(', ')}` : '',
            c.advice ? 'Advice: ' + c.advice : '',
          ].filter(Boolean),
        });
        if (c.rx.length) {
          out.push({
            id: 'rx:' + c.visitId, type: 'rx', date: c.visitDate, dayKey: key, canCompare: false,
            title: `${c.rx.length} medicine${c.rx.length === 1 ? '' : 's'}`,
            sub: c.rx.map(r => r.drugName).join(', '),
            lines: c.rx.map(r => `${r.drugName} · ${r.durationDays} day${r.durationDays === 1 ? '' : 's'}`),
          });
        }
      }
    } else {
      for (const p of w.pastVisits) {
        out.push({ id: 'v:' + p.visitId, type: 'visit', date: p.visitDate, dayKey: dayKeyOf(p.visitDate), canCompare: true,
          title: p.diagnoses.length ? p.diagnoses.map(d => d.label).join(', ') : 'No diagnosis recorded',
          sub: [p.doctorName, p.departmentName].filter(Boolean).join(' · ') || null, lines: [] });
      }
    }
    const tl = this.tl();
    if (tl) {
      const abn = tl.abnormalDays();
      for (const v of tl.visits()) {
        for (const o of v.orders) {
          const tests = tl.tests(o).map(t => t.name);
          out.push({ id: 'lab:' + o.id, type: 'result', date: o.createdAt, dayKey: v.key, canCompare: true, flag: abn.has(v.key),
            title: tl.orderPanelName(o), sub: o.orderNumber ?? null,
            lines: [tests.length > 1 ? tests.join(', ') : '', abn.has(v.key) ? 'Has values outside the normal range that day.' : ''].filter(Boolean) });
        }
        for (const d of v.docs) {
          out.push({ id: 'doc:' + d.id, type: 'file', date: d.uploadedAt, dayKey: v.key, canCompare: d.isImage,
            title: d.fileName, sub: d.isImage ? 'Image' : 'Document', lines: [] });
        }
      }
    }
    return out;
  });
  readonly metaLine = computed(() => {
    const w = this.ws();
    if (!w) return '';
    return [w.patient.ageDisplay && w.patient.sex ? `${w.patient.ageDisplay} ${w.patient.sex.charAt(0).toUpperCase()}` : w.patient.ageDisplay,
      w.patient.mrn, 'Token ' + w.visit.tokenLabel, w.visit.departmentName, w.visit.doctorName].filter(Boolean).join(' · ');
  });
  readonly visibilityText = computed(() => {
    const v = this.st().privateNotesVisibility;
    return v === 'doctor' ? 'Visible to you only (OPD workflow setting).' : v === 'department' ? 'Visible to doctors of this department.' : 'Visible to all doctors.';
  });

  constructor() {
    // Autosave: 1.2 s after the last edit.
    this.save$.pipe(debounceTime(1200), takeUntilDestroyed()).subscribe(() => this.saveNow());
    // Drug master search (debounced) merges into the local cache parseRx reads.
    this.drugSearch$.pipe(debounceTime(220), distinctUntilChanged(),
      switchMap(q => this.consultApi.drugs(q).pipe(catchError(() => of([] as ConsultDrug[])))), takeUntilDestroyed())
      .subscribe(rows => this.mergeDrugs(rows));
    this.dx$.pipe(debounceTime(180), distinctUntilChanged(), filter(q => q.trim().length > 0),
      switchMap(q => this.consultApi.diagnoses(q).pipe(catchError(() => of([] as ConsultDxSuggestion[])))), takeUntilDestroyed())
      .subscribe(rows => { this.dxSuggest.set(rows.slice(0, 8)); this.dxActive.set(0); });
    // The "usual" for the primary diagnosis.
    effect(() => {
      const dx = this.primaryDx();
      if (!dx || !this.ws()) { this.usual.set(null); return; }
      this.consultApi.usual(dx).subscribe({ next: u => this.usual.set(u && (u.rx.length || u.tests.length) ? u : null), error: () => this.usual.set(null) });
    });
  }

  ngOnInit() {
    this.phoneMq?.addEventListener?.('change', this.onPhoneMq);
    this.narrowMq?.addEventListener?.('change', this.onNarrowMq);
    this.doc.documentElement.classList.add('pf-opd-immersive');
    const id = this.route.snapshot.paramMap.get('visitId');
    if (!id) { this.loading.set(false); return; }
    this.consultApi.workspace(id).subscribe({
      next: w => {
        const openable = w.visit.canEdit && ['booked', 'vitals', 'waiting'].includes(w.visit.status);
        if (openable) {
          this.consultApi.start(id).subscribe({ next: s => this.hydrate(s), error: () => this.hydrate(w) });
        } else this.hydrate(w);
      },
      error: e => { this.loading.set(false); this.loadError.set(e?.message ?? null); },
    });
    this.consultApi.drugs().subscribe({ next: rows => this.mergeDrugs(rows), error: () => { /* free-text still works */ } });
    this.consultApi.labTests().subscribe({ next: rows => this.testCatalog.set((rows ?? []).filter(t => t.isActive !== false)), error: () => this.testLoadError.set(true) });
  }

  ngOnDestroy() {
    this.phoneMq?.removeEventListener?.('change', this.onPhoneMq);
    this.narrowMq?.removeEventListener?.('change', this.onNarrowMq);
    this.doc.documentElement.classList.remove('pf-opd-immersive');
    if (this.saveState() === 'dirty') this.saveNow();
  }

  private hydrate(w: ConsultWorkspace) {
    this.ws.set(w);
    this.loading.set(false);
    this.allergies.set(w.allergies ?? []);
    const c = w.consult;
    const followUpDays = c?.followUpDate ? daysBetween(w.visit.visitDate.slice(0, 10), c.followUpDate.slice(0, 10)) : null;
    this.st.set({
      answers: (c?.answers as Record<string, unknown>) ?? {},
      chiefComplaint: c?.chiefComplaint ?? (c ? '' : (w.visit.purpose ?? '')),
      diagnoses: c?.diagnoses ?? [],
      advice: c?.advice ?? '',
      privateNotes: c?.privateNotes ?? '',
      privateNotesVisibility: c?.privateNotesVisibility ?? w.noteVisibilityDefault ?? 'doctor',
      lines: w.rx.map(d => fromDto(d, this.drugList())),
      tests: (w.investigations ?? []).flatMap(i => i.items).map(t => ({ ...t, price: t.price ?? this.priceOf(t.testId) })),
      followUpDays,
      procedures: w.procedures ? w.procedures.map(procedureDraftOf) : undefined,
    });
    this.savedAt.set(c?.updatedAt ?? null);
    this.draftUpdatedAt = c?.updatedAt ?? null;
    this.dirty.clear();
    this.saveState.set('idle');
    this.consultApi.labTrends(w.patient.id).subscribe({ next: t => this.results.set(recentResultsOf(t)), error: () => this.results.set([]) });
    if (this.historyRows() === null && !this.historyLoading()) {
      this.historyLoading.set(true);
      this.consultApi.history(w.patient.id).subscribe({
        next: rows => { this.historyLoading.set(false); this.historyRows.set(rows ?? []); },
        error: () => { this.historyLoading.set(false); /* falls back to the workspace's past visits */ },
      });
    }
  }

  private mergeDrugs(rows: ConsultDrug[]) {
    const m = new Map(this.drugCache());
    for (const r of rows) m.set(r.id, drugRefOf(r));
    this.drugCache.set(m);
    // Upgrade lines that were hydrated before their master row arrived.
    const lines = this.st().lines;
    if (lines.some(l => !l.drug.free && m.has(l.drug.id) && m.get(l.drug.id) !== l.drug)) {
      this.st.update(s => ({ ...s, lines: s.lines.map(l => (!l.drug.free && m.has(l.drug.id) ? { ...l, drug: m.get(l.drug.id)! } : l)) }));
    }
  }

  private priceOf(testId: string): number | null { return this.testCatalog().find(t => t.id === testId)?.price ?? null; }

  // ── State ──────────────────────────────────────────────────────────
  /** The renderer asked for a file for a media question: open the picker
   *  (camera on phones via the OS sheet; any format). */
  captureMedia(req: OpdMediaRequest) {
    if (!this.editable()) return;
    this.pendingMedia = req;
    const el = this.mediaIn()?.nativeElement;
    if (!el) return;
    el.value = '';
    el.click();
  }

  /** Upload the picked file, then add its reference to the answer (or its side). */
  onMediaPicked(el: HTMLInputElement) {
    const file = el.files?.[0];
    const req = this.pendingMedia;
    const visitId = this.ws()?.visit.id;
    this.pendingMedia = null;
    if (!file || !req || !visitId) return;
    this.uploading.set(file.name);
    this.consultApi.uploadMedia(visitId, file).subscribe({
      next: stored => {
        this.uploading.set(null);
        this.patch({ answers: addMedia(this.st().answers, req, mediaRefOf(stored)) });
        this.toast.success(`${stored.name} added`);
      },
      error: e => {
        this.uploading.set(null);
        this.toast.error(e?.error?.message || e?.message || 'Could not upload the file');
      },
    });
  }

  patch(p: Partial<ConsultEditState>) {
    if (!this.editable() && !('followUpDays' in p)) return;
    this.st.update(s => ({ ...s, ...p }));
    if (this.editable()) {
      // Dirty-section autosave (owner 2026-10-01): remember exactly which
      // sections this edit touched — saveNow() PATCHes only those.
      for (const k of Object.keys(p) as (keyof ConsultEditState)[]) this.dirty.add(SECTION_OF[k]);
      this.saveState.set('dirty'); this.save$.next();
    }
  }

  private followUpIso(): string | null {
    const d = this.st().followUpDays;
    return d == null ? null : addDaysIso(this.visitDay(), d);
  }

  /** Dirty-section autosave: PATCHes only the sections edited since the last
   *  save (never the whole edit state) and gets a SLIM result back — never
   *  the whole workspace. Complete still sends the FULL draftBody via the
   *  unchanged full endpoint (below).
   *  <p>Critic P1-2: guarded by the REAL in-flight flag, not `saveState`
   *  (`patch()` can stomp that to 'dirty' mid-request while the doctor keeps
   *  typing). A call that lands while one is already in flight is a no-op —
   *  it doesn't need to do anything, because the in-flight request's own
   *  completion handler unconditionally calls `saveNow()` again, which drains
   *  whatever is left in `dirty` (including edits made during the request)
   *  with the FRESH `baseUpdatedAt`. So edits during a save are QUEUED, never
   *  sent as a second concurrent PATCH against the same stale base.</p> */
  saveNow() {
    const w = this.ws();
    if (!w || !this.editable()) return;
    if (this.inFlight) return;
    if (this.dirty.size === 0) { this.saveState.set('saved'); return; }
    const sections = new Set(this.dirty);
    this.dirty.clear();
    this.inFlight = true;
    this.saveState.set('saving');
    const body = draftPatchBody(sections, this.st(), this.followUpIso(), this.visitDay());
    body.baseUpdatedAt = this.draftUpdatedAt;
    this.consultApi.patchDraft(w.visit.id, body).subscribe({
      next: res => {
        this.inFlight = false;
        this.staleRetries = 0;
        this.savedAt.set(res.updatedAt ?? new Date().toISOString());
        this.draftUpdatedAt = res.updatedAt ?? this.draftUpdatedAt;
        // Learn the server-assigned ids a touched section echoed back —
        // undefined when that section wasn't part of THIS patch.
        if (res.rx) this.st.update(s => ({ ...s, lines: reconcileRxIds(s.lines, res.rx!) }));
        if (res.procedures && this.st().procedures)
          this.st.update(s => ({ ...s, procedures: reconcileProcedureIds(s.procedures!, res.procedures!) }));
        this.saveState.set(this.dirty.size > 0 ? 'dirty' : 'saved');
        this.saveNow();   // drain anything that piled up while this one was in flight (no-op if nothing dirty)
      },
      error: e => {
        this.inFlight = false;
        // Put the sections back so nothing this patch would have saved is lost.
        for (const sec of sections) this.dirty.add(sec);
        if (e?.code === 'stale_draft') { this.handleStaleDraft(w.visit.id); return; }
        this.saveState.set('error');
        setTimeout(() => { if (this.saveState() === 'error') { this.saveState.set('dirty'); this.saveNow(); } }, 4000);
      },
    });
  }

  /** Critic P1-2: a stale_draft NEVER silently discards what the doctor
   *  typed. Re-fetch the latest workspace, then re-apply (overlay) whatever
   *  sections are STILL dirty from the local copy onto it — a section not
   *  dirty takes the fresh server value, a section still dirty keeps the
   *  doctor's unsaved edit — and re-PATCH with the fresh base. If the same
   *  visit keeps going stale (another device / process saving concurrently,
   *  not just one race), stop auto-retrying after a couple of attempts and
   *  ask via DialogService instead of looping forever. */
  private handleStaleDraft(visitId: string): void {
    const stillDirty = new Set(this.dirty);
    const localState = this.st();
    this.staleRetries++;
    if (this.staleRetries > 2) {
      this.saveState.set('error');
      this.dialog.confirm({
        title: 'This draft keeps changing elsewhere',
        message: 'Someone else (another device, or Complete) keeps saving this consult while you type.',
        question: 'Keep your unsaved changes and try again, or reload the latest version from the server?',
        confirmLabel: 'Keep my changes', cancelLabel: 'Reload latest', tone: 'danger',
      }).then(keepLocal => {
        this.staleRetries = 0;
        if (keepLocal) {
          for (const sec of stillDirty) this.dirty.add(sec);
          this.consultApi.workspace(visitId).subscribe({
            next: fresh => { this.draftUpdatedAt = fresh.consult?.updatedAt ?? this.draftUpdatedAt; this.saveState.set('dirty'); this.saveNow(); },
            error: () => { this.saveState.set('dirty'); this.saveNow(); },
          });
        } else {
          this.consultApi.workspace(visitId).subscribe({ next: fresh => this.hydrate(fresh), error: () => undefined });
        }
      });
      return;
    }
    this.toast.error('This draft changed elsewhere — merging your unsaved edits with the latest version.');
    this.consultApi.workspace(visitId).subscribe({
      next: fresh => {
        this.hydrate(fresh);
        if (stillDirty.size === 0) return;
        const overlay: Partial<ConsultEditState> = {};
        (Object.keys(SECTION_OF) as (keyof ConsultEditState)[]).forEach(key => {
          if (stillDirty.has(SECTION_OF[key])) (overlay as Record<string, unknown>)[key] = localState[key];
        });
        this.st.update(s => ({ ...s, ...overlay }));
        for (const sec of stillDirty) this.dirty.add(sec);
        this.saveState.set('dirty');
        this.saveNow();
      },
      error: () => {
        // Couldn't even refetch — never discard: keep the edits locally and
        // let the next debounce tick retry once the connection recovers.
        for (const sec of stillDirty) this.dirty.add(sec);
        this.saveState.set('dirty');
        this.toast.error('Could not reload the latest draft — your edits are kept; will retry.');
      },
    });
  }

  summary(s: ConsultStep) { return stepSummary(s, this.st(), this.allergies(), this.st().privateNotesVisibility); }
  done(s: ConsultStep) { return stepDone(s, this.st()); }
  go(s: ConsultStep) { this.step.set(s); }
  nextStep(s: ConsultStep): ConsultStep { return Math.min(4, s + 1) as ConsultStep; }
  prevStep(s: ConsultStep): ConsultStep { return Math.max(1, s - 1) as ConsultStep; }
  statusLabel(s: string) {
    return ({ booked: 'Booked', vitals: 'At vitals', waiting: 'Waiting', in_consult: 'In consult', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No show' } as Record<string, string>)[s] ?? s;
  }
  dxText(d: OpdDiagnosis[]) { return d.map(x => x.label).join(', '); }

  // ── Diagnosis ──────────────────────────────────────────────────────
  onDxType(v: string) { this.dxQuery.set(v); this.dx$.next(v); if (!v.trim()) this.dxSuggest.set([]); }
  onDxKey(e: KeyboardEvent) {
    const n = this.dxSuggest().length + (this.dxQuery().trim() ? 1 : 0);
    if (e.key === 'ArrowDown') { this.dxActive.set((this.dxActive() + 1) % Math.max(1, n)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { this.dxActive.set((this.dxActive() - 1 + n) % Math.max(1, n)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = this.dxSuggest()[this.dxActive()];
      if (o) this.addDx(o); else if (this.dxQuery().trim()) this.addDx({ label: this.dxQuery().trim(), source: 'mine' });
    } else if (e.key === 'Escape') { this.dxQuery.set(''); this.dxSuggest.set([]); }
  }
  addDx(o: { label: string; code?: string | null; source?: string }) {
    const label = o.label.trim();
    if (!label || this.st().diagnoses.some(d => d.label.toLowerCase() === label.toLowerCase())) { this.dxQuery.set(''); return; }
    const primary = this.st().diagnoses.length === 0;
    this.patch({ diagnoses: [...this.st().diagnoses, { label, code: o.code ?? undefined, primary }] });
    this.dxQuery.set(''); this.dxSuggest.set([]);
  }
  removeDx(i: number) {
    const next = this.st().diagnoses.filter((_, k) => k !== i).map((d, k) => ({ ...d, primary: k === 0 }));
    this.patch({ diagnoses: next });
  }

  // ── Usual / repeat ─────────────────────────────────────────────────
  applyUsualSet() {
    const u = this.usual();
    if (!u || !this.editable()) return;
    const r = applyUsual(this.st(), u, this.drugList());
    this.patch({ lines: r.next.lines, tests: r.next.tests.map(t => ({ ...t, price: t.price ?? this.priceOf(t.testId) })), advice: r.next.advice });
    this.usualApplied.set({ dx: this.primaryDx(), keys: r.addedKeys, tests: r.addedTests, advice: r.addedAdvice });
    const from = u.source === 'template' ? 'Template' : 'Usual prescription';
    this.toast.info(`${from} added · ${r.addedKeys.length} medicine${r.addedKeys.length === 1 ? '' : 's'}`);
  }
  undoUsualSet() {
    const a = this.usualApplied();
    if (!a) return;
    const s = undoUsual(this.st(), a.keys, a.tests, a.advice);
    this.patch({ lines: s.lines, tests: s.tests, advice: s.advice });
    this.usualApplied.set(null);
  }
  repeatLast() {
    const lv = this.ws()?.lastVisit;
    if (!lv || !this.editable()) return;
    const have = new Set(this.st().lines.map(l => l.drug.id));
    const add = lv.rx.map(d => fromDto({ ...d, id: undefined, ...FRESH_ACKS }, this.drugList())).filter(l => !have.has(l.drug.id));
    this.patch({ lines: [...this.st().lines, ...add] });
    this.toast.info(`Repeated ${add.length} medicine${add.length === 1 ? '' : 's'} from ${new Date(lv.visitDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
    this.step.set(2);
  }
  swapLine(key: string, alt: ConsultDrugRef) {
    const old = this.st().lines.find(l => l.key === key);
    if (!old) return;
    const line = newRxLine(alt.id, this.usuals()[alt.id] ?? null);
    this.patch({ lines: this.st().lines.map(l => (l.key === key ? { ...l, id: undefined, drug: alt, line, ...FRESH_ACKS } : l)) });
    this.toast.info(`${old.drug.name} swapped for ${alt.name}`);
  }
  seeLine() { this.step.set(2); this.glanceOpen.set(false); }
  /** A step tapped on the timeline (closes the timeline sheet on small screens). */
  goFromTimeline(n: ConsultStep) { this.step.set(n); this.timelineOpen.set(false); }
  initials(name: string): string {
    return name.replace(/^(dr|mr|mrs|ms|master|baby)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  }

  // ── Tests ──────────────────────────────────────────────────────────
  hasTest(id: string) { return this.st().tests.some(t => t.testId === id); }

  // ── Specimen for a Test Master "choose" test (shared/opd-specimen.ts) ──
  readonly specimenErr = signal<Record<string, boolean>>({});
  testForPicker(id: string): { id: string; name: string; parameters?: string | null } {
    const t = this.testCatalog().find(x => x.id === id);
    return { id, name: t?.name ?? '', parameters: t?.parameters ?? null };
  }
  specimenInvalid(id: string): boolean { return !!this.specimenErr()[id]; }
  setSpecimen(id: string, v: string): void {
    this.patch({ tests: this.st().tests.map(t => (t.testId === id ? { ...t, specimen: v || null } : t)) });
    if (v) this.specimenErr.update(m => { if (!m[id]) return m; const n = { ...m }; delete n[id]; return n; });
  }
  /** Tests still needing a specimen; flags their rows. Empty = Complete may go. */
  private missingSpecimenTests(): string[] {
    const byId: OpdTestLookup = Object.fromEntries(this.testCatalog().map(t => [t.id, t]));
    const miss = missingSpecimens(this.st().tests, byId);
    this.specimenErr.set(Object.fromEntries(miss.map(m => [m.testId, true])));
    return miss.map(m => m.name);
  }
  toggleTest(t: ConsultInvestigationItem) {
    if (!this.editable()) return;
    this.patch({ tests: this.hasTest(t.testId) ? this.st().tests.filter(x => x.testId !== t.testId) : [...this.st().tests, t] });
  }
  orderAll() { this.patch({ tests: [...this.st().tests, ...this.suggestedMissing()] }); }

  // ── Allergies ──────────────────────────────────────────────────────
  addAllergy(a: Partial<OpdPatientAllergy>) {
    const w = this.ws();
    if (!w) return;
    this.consultApi.addAllergy(w.patient.id, a).subscribe({
      next: row => { this.allergies.update(x => [...x, row]); this.toast.success('Allergy recorded'); },
      error: e => this.toast.error(e?.message || 'Could not record the allergy'),
    });
  }
  removeAllergy(a: OpdPatientAllergy) {
    if (!a.id) return;
    this.consultApi.removeAllergy(a.id).subscribe({
      next: () => this.allergies.update(x => x.filter(y => y.id !== a.id)),
      error: e => this.toast.error(e?.message || 'Could not remove the allergy'),
    });
  }

  // ── Journey / compare ──────────────────────────────────────────────
  journey() { this.journeyOpen.set(true); queueMicrotask(() => this.tl()?.showJourney()); }
  compare() {
    this.journeyOpen.set(true);
    queueMicrotask(() => { const t = this.tl(); if (t && !t.compareMode()) t.toggleCompare(); });
  }
  /** Timeline "Open": the journey viewer at that day — a report or a file opens itself. */
  openNode(n: HistoryNode) {
    this.timelineOpen.set(false);
    this.journeyOpen.set(true);
    queueMicrotask(() => {
      const t = this.tl();
      if (!t) return;
      if (t.compareMode()) t.toggleCompare();
      if (n.dayKey) t.selectKey(n.dayKey);
      const v = t.visits().find(x => x.key === n.dayKey);
      if (n.type === 'result' && v) {
        const o = v.orders.find(x => 'lab:' + x.id === n.id);
        const rep = o ? t.reportFor(o.id) : null;
        if (o && rep) { void t.openSingle({ id: 'rep:' + o.id, kind: 'report', name: t.orderPanelName(o), date: v.date, report: rep, order: o }); return; }
      }
      if (n.type === 'file' && v) {
        const d = v.docs.find(x => 'doc:' + x.id === n.id);
        if (d) { void t.openSingle({ id: 'doc:' + d.id, kind: d.isImage ? 'image' : 'doc', name: d.fileName, date: v.date, url: d.url }); return; }
      }
      t.showJourney();
    });
  }
  /** Timeline "Compare": the journey viewer in compare mode at that day. */
  compareNode(n: HistoryNode) {
    this.timelineOpen.set(false);
    this.journeyOpen.set(true);
    queueMicrotask(() => {
      const t = this.tl();
      if (!t) return;
      if (n.dayKey) t.selectKey(n.dayKey);
      if (!t.compareMode()) t.toggleCompare();
    });
  }

  // ── Complete ───────────────────────────────────────────────────────
  openComplete() { if (this.editable()) this.completeOpen.set(true); }
  complete() {
    const w = this.ws();
    if (!w || this.completing() || this.unresolved().length || this.pregnancyUnresolved().length) return;
    if (this.requiredMissing().length) {
      this.toast.error(`Please answer: ${this.requiredMissing().join(', ')}.`);
      return;
    }
    const noSpecimen = this.missingSpecimenTests();
    if (noSpecimen.length) {
      this.completeOpen.set(false);
      this.step.set(3);
      this.toast.error(`Choose the specimen for: ${noSpecimen.join(', ')}.`);
      return;
    }
    this.completing.set(true);
    this.consultApi.complete(w.visit.id, draftBody(this.st(), this.followUpIso(), this.visitDay())).subscribe({
      next: done => {
        this.completing.set(false);
        this.completeOpen.set(false);
        const nRx = this.st().lines.length, nT = this.st().tests.length, nP = this.st().procedures?.length ?? 0;
        this.hydrate(done);
        this.toast.success(['Consult completed', nRx ? `${nRx} medicine${nRx === 1 ? '' : 's'} to pharmacy` : '', nT ? `${nT} test${nT === 1 ? '' : 's'} to the lab` : '',
          nP ? `${nP} procedure${nP === 1 ? '' : 's'} to the front desk` : ''].filter(Boolean).join(' · '));
      },
      error: e => {
        this.completing.set(false);
        const msg = e?.code === 'allergy_unacknowledged' ? 'A medicine conflicts with an allergy — review it first.'
          : e?.code === 'pregnancy_unacknowledged' ? 'A medicine should be avoided in pregnancy — review it first.'
          : e?.code === 'required_missing' ? (e?.message || 'Please answer the required questions first.')
          : (e?.message || 'Could not complete the consult');
        this.toast.error(msg);
      },
    });
  }

  // ── Print / share (after completion) ───────────────────────────────
  private async pdfBlob(): Promise<Blob | null> {
    const w = this.ws();
    if (!w) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tpl: any = null;
    try { tpl = await new Promise(res => this.api.get('/api/config/invoice-template').subscribe({ next: res, error: () => res(null) })); } catch { tpl = null; }
    const v = w.vitals;
    const vit = v ? [v.pulse ? `Pulse ${v.pulse}` : '', v.bpSys ? `BP ${v.bpSys}/${v.bpDia ?? ''}` : '', v.tempF ? `Temp ${v.tempF} F` : '',
      v.spo2 ? `SpO2 ${v.spo2}%` : '', v.weightKg ? `Wt ${v.weightKg} kg` : '', bmiOf(v) ? `BMI ${bmiOf(v)}` : ''].filter(Boolean).join(' · ') : null;
    const fu = w.consult?.followUpDate ? new Date(w.consult.followUpDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
    const user = this.auth.user();
    const doc = buildRxPdf({
      practice: { name: tpl?.labName || user?.tenantName, address: tpl?.address, phone: tpl?.phone, email: tpl?.email },
      patient: { name: w.patient.name, ageSex: [w.patient.ageDisplay, w.patient.sex].filter(Boolean).join(' '), mrn: w.patient.mrn, phone: w.patient.phone },
      doctor: { name: w.visit.doctorName, department: w.visit.departmentName, regNo: w.visit.doctorUserId === user?.id ? user?.registrationId : null },
      visit: { date: this.visitDay(), tokenLabel: w.visit.tokenLabel, visitNumber: w.visit.visitNumber },
      vitals: vit, chiefComplaint: this.st().chiefComplaint, diagnoses: this.st().diagnoses,
      lines: this.st().lines, tests: this.st().tests, advice: this.st().advice, followUp: fu,
      procedures: (this.st().procedures ?? []).map(p => ({ name: p.name, side: p.side ?? null, qty: p.qty, note: p.note ?? null })),
    });
    return doc.output('blob');
  }
  async print() {
    const blob = await this.pdfBlob();
    if (blob) printPdfBlobUrl(URL.createObjectURL(blob), { revokeOnDone: true });
  }
  async share() {
    const blob = await this.pdfBlob();
    const w = this.ws();
    if (!blob || !w) return;
    const file = new File([blob], `Prescription-${w.patient.name.replace(/\s+/g, '-')}.pdf`, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: 'Prescription' }); } catch { /* cancelled */ }
    } else {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  back() { this.navBack.backTo('/opd/consult'); }
}

/** Local yyyy-mm-dd of a date or date-time — the patient journey's day key. Pure. */
export function dayKeyOf(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Adds a stored file to a media answer (a left / right question keeps `{ r, l }`). Pure. */
export function addMedia(answers: OpdAnswers, req: OpdMediaRequest, ref: OpdMediaRef): OpdAnswers {
  const cur = answers ?? {};
  const list = (v: unknown): OpdMediaRef[] => (Array.isArray(v) ? (v as OpdMediaRef[]) : []);
  if (req.side) {
    const sided = (cur[req.key] ?? {}) as Record<string, unknown>;
    return { ...cur, [req.key]: { ...sided, [req.side]: [...list(sided[req.side]), ref] } };
  }
  return { ...cur, [req.key]: [...list(cur[req.key]), ref] };
}

/** Question keys the consult owns as built-in fields (a form that asks them too
 *  would ask twice — the consult's chief complaint is pre-filled from the desk). */
export const CONSULT_OWNED_KEYS = new Set(['chief_complaints', 'chief_complaint']);

/** The form's schema v2 minus consult-owned questions. Pure. */
export function withoutConsultOwned(schema: unknown): OpdFormDoc {
  const doc = normalizeSchema(schema);
  return { ...doc, sections: doc.sections.map(s => ({ ...s, fields: s.fields.filter(q => !CONSULT_OWNED_KEYS.has(q.key)) })) };
}
