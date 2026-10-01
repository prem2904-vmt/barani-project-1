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
  ConsultApi, ConsultDrug, ConsultDxSuggestion, ConsultInvestigationItem, ConsultUsual, ConsultWorkspace, LabTestRow, mediaRefOf,
} from './consult.api';
import {
  ConsultEditState, ConsultStep, DraftSection, FRESH_ACKS, SECTION_OF, STEP_TITLES, applyUsual, daysBetween, draftBody, draftPatchBody,
  procedureDraftOf, reconcileProcedureIds, reconcileRxIds, stepDone, stepSummary, undoUsual, usualsFrom,
} from './consult-state';
import { ConsultProceduresComponent } from './procedure-editor.component';
import { ConsultVitalsComponent, bmiOf } from './vitals-strip.component';
import { ConsultGlanceComponent, RecentResult, recentResultsOf } from './glance-panel.component';
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
 * `/opd/consult/:visitId` — the FULL-SCREEN consult (Agent C). Mirrors the
 * owner's mockup (Consultation v4): a top bar (patient, token, dept, doctor,
 * status, draft saved, Compare, ONE primary "Complete consult"), the vitals
 * strip in the header, a LEFT rail stepper (1 Assessment & diagnosis →
 * 2 Prescription → 3 Investigations → 4 Notes, one-line summaries + ticks,
 * then the visit journey), ONE working step in the centre (only the centre
 * animates on step change), the RIGHT "At a glance" panel (slide-over ≤1100px,
 * bottom sheet on phones) and the patient's time axis at the bottom — the
 * existing <pf-patient-timeline>, embedded. Toggles html.pf-opd-immersive
 * (the shell + bottom nav hide their chrome).
 */
@Component({
  selector: 'pf-opd-consult-workspace',
  standalone: true,
  imports: [OpdSpecimenPickerComponent, ConsultProceduresComponent, 
    DatePipe, ConsultVitalsComponent, ConsultGlanceComponent, ConsultCompleteSheetComponent, OpdFormRendererComponent,
    RxEditorComponent, PatientTimelineComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ws(); as w) {
      <div class="cw" [class.cw--glance]="glanceOpen()" [class.cw--dock]="dockOpen()">
        <!-- ── Top bar ── -->
        <header class="cw__top">
          <button type="button" class="cw__back" (click)="back()" aria-label="Back to my patients">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div class="cw__who">
            <h1 class="cw__name">{{ w.patient.name }}</h1>
            <span class="cw__meta">{{ metaLine() }}</span>
          </div>
          <span class="cw__status" [attr.data-status]="w.visit.status">{{ statusLabel(w.visit.status) }}</span>
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
          <button type="button" class="nd-btn nd-btn--quiet cw__glance-btn" (click)="glanceOpen.set(!glanceOpen())" [attr.aria-expanded]="glanceOpen()" aria-label="At a glance">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>
            <span class="cw__hide-sm">At a glance</span>
          </button>
          <button type="button" class="nd-btn nd-btn--quiet" (click)="compare()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>
            Compare
          </button>
          @if (editable()) {
            <button type="button" class="nd-btn nd-btn--primary cw__cta" (click)="openComplete()">Complete consult</button>
          } @else if (w.visit.status === 'completed') {
            <button type="button" class="nd-btn nd-btn--secondary" (click)="share()">Share</button>
            <button type="button" class="nd-btn nd-btn--primary cw__cta" (click)="print()">Print prescription</button>
          }
        </header>

        <pf-consult-vitals class="cw__vitals" [vitals]="w.vitals" [history]="w.vitalsHistory"></pf-consult-vitals>

        <div class="cw__main">
          <!-- ── Left rail: stepper + journey ── -->
          <nav class="cw__rail" aria-label="Consult steps">
            <div class="cw__date">{{ w.visit.visitDate | date:'EEE, MMM d, y' }}</div>
            <div class="cw__railk">Today's consult</div>
            <ol class="cw__steps">
              @for (s of steps; track s) {
                @let sum = summary(s);
                <li>
                  <button type="button" class="cw__step" [class.on]="step() === s" [class.done]="done(s)" (click)="go(s)" [attr.aria-current]="step() === s ? 'step' : null">
                    <span class="cw__stepn" aria-hidden="true">
                      @if (done(s) && step() !== s) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> } @else { {{ s }} }
                    </span>
                    <span class="cw__stepb">
                      <span class="cw__stept">{{ titles[s] }}</span>
                      <span class="cw__steps2" [class.warn]="sum.warn">
                        @if (sum.warn) { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/></svg> }
                        {{ sum.text }}
                      </span>
                    </span>
                  </button>
                </li>
              }
            </ol>
            <div class="cw__railk">Journey</div>
            <button type="button" class="cw__jour" (click)="journey()">
              <span class="cw__jico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h5a4 4 0 0 1 4 4M7 18h5a4 4 0 0 0 4-4"/></svg></span>
              <span><b>Visit journey</b><em>Reports, images, compare</em></span>
            </button>
            @if (w.pastVisits.length) {
              <div class="cw__railk">Earlier OPD visits</div>
              @for (p of w.pastVisits.slice(0, 5); track p.visitId) {
                <div class="cw__past"><b>{{ p.visitDate | date:'MMM d, y' }}</b><span>{{ dxText(p.diagnoses) || 'No diagnosis' }} · {{ p.doctorName }}</span></div>
              }
            }
          </nav>

          <!-- ── Centre: ONE working step (only this animates) ── -->
          <main class="cw__center" #center>
            @for (s of [step()]; track s) {
              <div class="cw__pane">
                <div class="cw__stepk">Step {{ s }} of 4</div>
                @switch (s) {
                  @case (1) {
                    <div class="cw__h"><h2>Assessment & diagnosis</h2></div>
                    <div class="cw__sec">
                      <div class="cw__seck">Findings <span>{{ w.form?.formName || 'No consult form set for this service' }}@if (w.visit.purpose) { · desk note: {{ w.visit.purpose }}}</span></div>
                      <label class="nd-field">
                        <span class="nd-field__lbl">Chief complaints</span>
                        <input class="nd-input cw__in" type="text" [value]="st().chiefComplaint" [disabled]="!editable()"
                               (input)="patch({ chiefComplaint: $any($event.target).value })" placeholder="What brings the patient in" />
                      </label>
                      @if (w.form) {
                        <!-- Agent A's ONE form renderer (schema v2); media questions upload through the consult. -->
                        <pf-opd-form-renderer [schema]="formSchema()" [addons]="w.form.addonFields" [answers]="st().answers"
                                              [mode]="editable() ? 'edit' : 'readonly'" [layout]="phone() ? 'phone' : 'screen'" [visitDate]="w.visit.visitDate"
                                              (answersChange)="patch({ answers: $event })" (mediaRequest)="captureMedia($event)"></pf-opd-form-renderer>
                        <input #mediaIn class="cw__file" type="file" tabindex="-1" aria-hidden="true" (change)="onMediaPicked(mediaIn)" />
                        @if (uploading()) { <p class="cw__upl" role="status">Uploading {{ uploading() }}…</p> }
                      }
                    </div>
                    <div class="cw__sec">
                      <div class="cw__seck">Diagnosis</div>
                      <div class="cw__chips">
                        @for (d of st().diagnoses; track d.label; let i = $index) {
                          <span class="cw__dx" [class.cw__dx--p]="i === 0">
                            {{ d.label }}@if (d.code) { <em>{{ d.code }}</em> }
                            @if (editable()) {
                              <button type="button" (click)="removeDx(i)" [attr.aria-label]="'Remove ' + d.label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                            }
                          </span>
                        }
                      </div>
                      @if (editable()) {
                        <div class="cw__dxbox">
                          <input #dxIn class="nd-input cw__in" type="text" [value]="dxQuery()" (input)="onDxType(dxIn.value)" (keydown)="onDxKey($event)"
                                 placeholder="Type a diagnosis — pick one or press Enter to add as written" aria-label="Add a diagnosis"
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
                    </div>
                  }
                  @case (2) {
                    <div class="cw__h">
                      <h2>Prescription</h2>
                      @if (primaryDx()) { <span class="cw__dxtag">{{ primaryDx() }}</span> }
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
                    <div class="cw__h"><h2>Tests &amp; procedures</h2><span class="cw__hint">Tests go to the lab as a normal order when you complete the consult; procedures go to the front desk's bill.</span></div>
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
                        <input #tIn class="nd-input cw__in" type="text" [value]="testQuery()" (input)="testQuery.set(tIn.value)" placeholder="Search the lab's tests — name, code or short name (LFT, CBC…)" aria-label="Search lab tests" />
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
                    <div class="cw__h"><h2>Notes</h2></div>
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
                <div class="cw__stepnav">
                  @if (s > 1) { <button type="button" class="nd-btn nd-btn--secondary" (click)="go(prevStep(s))">Back</button> }
                  <span class="cw__grow"></span>
                  @if (s < 4) { <button type="button" class="nd-btn nd-btn--secondary" (click)="go(nextStep(s))">Next: {{ titles[nextStep(s)] }}</button> }
                </div>
              </div>
            }
          </main>

          <!-- ── Right: at a glance ── -->
          @if (glanceOpen()) { <div class="cw__scrim" (click)="glanceOpen.set(false)" aria-hidden="true"></div> }
          <aside class="cw__glance" aria-label="At a glance">
            <pf-consult-glance [ws]="w" [allergies]="allergies()" [lines]="st().lines" [drugs]="drugList()" [results]="results()"
                               [canEdit]="editable()" [closable]="true" [preferIds]="preferIds()"
                               (close)="glanceOpen.set(false)" (swap)="swapLine($event.key, $event.alt)" (seeLine)="seeLine()"
                               (repeatLast)="repeatLast()" (addAllergy)="addAllergy($event)" (removeAllergy)="removeAllergy($event)"></pf-consult-glance>
          </aside>
        </div>

        <!-- ── Bottom: the patient's time axis (the existing patient timeline) ── -->
        <section class="cw__dock" [class.open]="dockOpen()" [class.cw__dock--empty]="!hasJourney()">
          <button type="button" class="cw__dockbar" (click)="dockOpen.set(!dockOpen())" [attr.aria-expanded]="dockOpen()">
            {{ dockOpen() ? 'Hide the visit journey' : 'Visit journey · reports & images' }}
            <svg [class.up]="!dockOpen()" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
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
  readonly dockOpen = signal(false);
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
  readonly hasJourney = computed(() => (this.tl()?.visits().length ?? 0) > 0 || this.dockOpen());

  private readonly save$ = new Subject<void>();

  /** The service's form without the questions the consult owns (chief complaint). */
  readonly formSchema = computed(() => withoutConsultOwned(this.ws()?.form?.schema));

  /** Phone layout for the form renderer (one column) — the renderer's own ≤760px rule. */
  readonly phone = signal(typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches);
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
  journey() { this.dockOpen.set(true); queueMicrotask(() => this.tl()?.showJourney()); }
  compare() {
    this.dockOpen.set(true);
    queueMicrotask(() => { const t = this.tl(); if (t && !t.compareMode()) t.toggleCompare(); });
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
