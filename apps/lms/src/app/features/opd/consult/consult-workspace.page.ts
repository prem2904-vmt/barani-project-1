import {
  ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild,
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
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { PatientTimelineComponent, type TimelineItem } from '../../frontdesk/patient-profile/patient-timeline.component';
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import type { OpdDiagnosis, OpdPatientAllergy, OpdRxLineDto } from '../shared/opd.models';
import {
  ConsultApi, ConsultDrug, ConsultDxSuggestion, ConsultInvestigationItem, ConsultUsual, ConsultWorkspace, LabTestRow, mediaRefOf,
} from './consult.api';
import {
  BodyOpts, ConsultEditState, DraftSection, FRESH_ACKS, SECTION_OF, applyUsual, daysBetween, draftBody, draftPatchBody,
  procedureDraftOf, reconcileProcedureIds, reconcileRxIds, undoUsual, usualsFrom,
} from './consult-state';
import { ConsultProceduresComponent } from './procedure-editor.component';
import { needsPriceReason } from './procedure-rules';
import { ConsultVitalsComponent, bmiOf, vitalFlag, vitalText } from './vitals-strip.component';
import { ConsultCompleteSheetComponent, FOLLOW_UP_PICKS, addDaysIso, followUpFeeText } from './complete-sheet.component';
import {
  OpdFormRendererComponent, allQuestions, missingRequired, normalizeSchema,
  type OpdAnswers, type OpdFormDoc, type OpdMediaRef, type OpdMediaRequest,
} from '../admin/forms/renderer';
import { RxEditorComponent } from './rx/rx-editor.component';
import { ConsultDrugRef, ConsultRxLine, drugRefOf, fromDto, unresolvedAllergies, unresolvedPregnancyRisks } from './rx/rx-model';
import { rxSentence, usualFromJson } from './rx/rx-line';
import { CompareConsult, compareMatrix } from './consult-compare';
import { ComparePreset, CompareSection, PresetFile, PresetTrend, comparePresets, presetTitle } from './compare-presets';
import type { RxUsual } from '../shared/rx-schedule';
import { lineShort } from '../shared/rx-schedule';
import { newRxLine } from '../shared/rx-schedule';
import { buildRxPdf } from './rx-print';
import { OpdSpecimenPickerComponent } from '../shared/opd-specimen-picker.component';
import { missingSpecimens, type OpdTestLookup } from '../shared/opd-specimen';
import { JourneyDockComponent } from '../shared/journey-dock.component';
import { JourneyDockService, journeyDayKey } from '../shared/journey-dock.service';
import {
  ConsultSpace, Prefill, SPACES, balancePanels, chromeInsets, recentResultsOf, VisitItem, prefillsOf, sparkPoints, spaceCount, visitItems, watchLine,
} from './consult-records';
import { ConsultVisitCardComponent } from './visit-card.component';
import { PadAddComponent } from './pad-add.component';
import { COMMON_ADVICE, PadOption, PadRow, adviceLines, padCollapseKey, parseCollapsed, toggleRow as toggleRowSet } from './pad';
import { vitalsWarnings } from './consult-records';
import { printRows } from '../admin/forms/renderer';
import { ConsultPageAssistantComponent } from './page-assistant.component';
import { ADMIN_PERMS } from '../../../core/auth/route-access';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const EMPTY: ConsultEditState = {
  answers: {}, chiefComplaint: '', diagnoses: [], advice: '', privateNotes: '', privateNotesVisibility: 'doctor',
  lines: [], tests: [], followUpDays: null,
};

/** localStorage key of the prefills the doctor confirmed on a visit. */
export const prefillKey = (visitId: string) => `pf.opd.prefill.${visitId}`;

/**
 * `/opd/consult/:visitId` — the consult (consult v6, owner-approved canvas).
 *  - Patient band, ONE row: back · avatar · name / meta · In consult · today's
 *    vitals as compact chips (amber out of range, "+N" overflow) · save
 *    state · Page (the doctor's assistant) · Patient (tablet / phone) ·
 *    Compare · Complete.
 *  - Centre (the full width between the gutters): the spaces as a tab strip
 *    in the card head — Findings · Diagnosis · Prescription · Procedures ·
 *    Tests · Advice & notes, in any order, each with a count (an amber dot on
 *    Findings while prefills are unconfirmed); each space has its own header
 *    and add bar; Findings starts with the prefill review.
 *  - The band's "Patient" button opens the patient card — the "Always" strip
 *    and the selected visit's records — as a panel over the centre (outside
 *    tap / Esc closes it; it stays open while comparing). Pinned (per user,
 *    off by default) it docks as a 300px column while the centre keeps
 *    ≥680px. Phone: a sheet.
 *  - The journey dock above the bottom navbar (which stays visible); a date
 *    there selects the visit the left card shows.
 * Autosave, the Complete gates, print and share are unchanged. Complete only
 * WARNS about unreviewed prefills (once) — it never blocks on them.
 */
@Component({
  selector: 'pf-opd-consult-workspace',
  standalone: true,
  imports: [OpdSpecimenPickerComponent, ConsultProceduresComponent,
    DatePipe, ConsultVitalsComponent, ConsultCompleteSheetComponent, OpdFormRendererComponent,
    RxEditorComponent, PatientTimelineComponent, ConsultVisitCardComponent, ConsultPageAssistantComponent, JourneyDockComponent, PadAddComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ws(); as w) {
      <div class="cw" [style.bottom.px]="insets()?.bottom" [style.left.px]="insets()?.left">
        <!-- ── Patient band: one row ── -->
        <header class="cw__band">
          <div class="cw__row">
            <button type="button" class="cw__iconbtn" (click)="back()" aria-label="Back to my patients">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <span class="cw__avatar nd-num" aria-hidden="true">{{ initials(w.patient.name) }}</span>
            <div class="cw__who">
              <div class="cw__nameline">
                <h1 class="cw__name"><button type="button" class="cw__namebtn" (click)="togglePatient()" [attr.aria-expanded]="rightDocked() || rightOverlay()" data-patient
                        title="Allergies, history and reports" [attr.aria-label]="w.patient.name + ' — allergies, history and reports'">{{ w.patient.name }}
                  @if (allergies().length) { <span class="cw__ndot" aria-label="has allergies"></span> }
                  @else if (watch()) { <span class="cw__ndot cw__ndot--amber" aria-label="a value to watch"></span> }
                </button></h1>
                <span class="cw__status" [attr.data-status]="w.visit.status">
                  @if (w.visit.status === 'in_consult') { <span class="cw__live" aria-hidden="true"></span> }
                  {{ statusLabel(w.visit.status) }}
                </span>
              </div>
              <div class="cw__meta nd-num">@for (m of metaBits(); track $index) { <span>{{ m }}</span> }</div>
            </div>
            <pf-consult-vitals class="cw__vitals" [vitals]="w.vitals" [history]="w.vitalsHistory" [scroll]="compact()"></pf-consult-vitals>
            <div class="cw__acts">
              @if (editable()) {
                <span class="nd-savestate cw__save" aria-live="polite">
                  @switch (saveState()) {
                    @case ('saving') { <span class="nd-savestate__dot"></span> Saving… }
                    @case ('dirty') { <span class="nd-savestate__dot"></span> Unsaved }
                    @case ('error') { <span class="cw__saveerr">Not saved — retrying</span> }
                    @default { @if (savedAt()) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Saved {{ savedAt() | date:'h:mm' }} } }
                  }
                </span>
              }
              @if (showPage()) {
                <pf-consult-page-assistant [assistantId]="w.assistant?.userId ?? null" [assistantName]="w.assistant?.name ?? null" [isAdmin]="isAdmin()"
                                           [patientId]="w.patient.id" [patientName]="w.patient.name" [token]="w.visit.tokenLabel" [iconOnly]="true"></pf-consult-page-assistant>
              }
              <span class="cw__split" [class.cw__split--on]="compareMode()">
                <button type="button" class="cw__split-main" (click)="toggleCompareMode()" [attr.aria-pressed]="compareMode()" data-compare
                        title="Compare visits side by side" aria-label="Compare visits side by side">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/></svg>
                  @if (compareItems().length) { <span class="cw__ct nd-num">{{ compareItems().length }}</span> }
                </button>
                <button type="button" class="cw__split-more" (click)="presetsOpen.set(!presetsOpen())" [attr.aria-expanded]="presetsOpen()" aria-haspopup="menu"
                        title="Compare presets" aria-label="Compare presets" data-compare-presets>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                @if (presetsOpen()) {
                  <span class="cw__pscrim" (click)="presetsOpen.set(false)" aria-hidden="true"></span>
                  <span class="cw__pmenu" role="menu" aria-label="Compare presets">
                    <span class="cw__pmh">Compare</span>
                    @for (p of presets(); track p.id) {
                      <button type="button" class="cw__pmi" role="menuitem" [disabled]="!p.count" [attr.aria-checked]="activePreset()?.id === p.id" [attr.data-preset]="p.id" (click)="applyPreset(p)">
                        <span>{{ p.label }}</span><span class="nd-num cw__pmc">{{ p.count }}</span>
                      </button>
                    }
                  </span>
                }
              </span>
              @if (editable()) {
                <button type="button" class="nd-btn nd-btn--primary cw__cta" (click)="openComplete()" data-complete>Complete consult</button>
              } @else if (w.visit.status === 'completed') {
                <button type="button" class="nd-btn nd-btn--secondary cw__cmp" (click)="share()">Share</button>
                <button type="button" class="nd-btn nd-btn--primary cw__cta" (click)="print()">Print prescription</button>
              }
            </div>
          </div>
        </header>

        <div #body class="cw__body" [class.cw__body--docked]="rightDocked()">

          <!-- ── Centre ── -->
          <main class="nd-card cw__centre" [class.cw__centre--viewing]="viewing()">
            @if (viewing()) {
              <header class="nd-card__head cw__vbar">
                <button type="button" class="cw__iconbtn cw__iconbtn--sm" (click)="closeViewer()" aria-label="Back to the consult">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                @if (compareOn()) {
                  <span class="cw__vt"><b>{{ activePreset() ? presetTitle(activePreset()!.label) : 'Compare' }} · {{ compareItems().length }} picked</b><span class="cw__hide-sm">Tap dates on the timeline or records on the right to add or remove</span></span>
                } @else if (viewItem(); as it) {
                  <span class="cw__vt"><b>{{ it.title }}</b><span class="nd-num">{{ it.date + 'T00:00:00' | date:'d MMM y' }}</span></span>
                }
                <span class="nd-card__spacer"></span>
                @if (compareOn() && compareItems().length) { <button type="button" class="nd-btn nd-btn--tertiary" (click)="clearCompare()">Clear</button> }
                <button type="button" class="nd-btn nd-btn--secondary cw__back" (click)="closeViewer()" data-back>{{ compareOn() ? 'Back to consult' : 'Back to the consult' }}</button>
              </header>
              <div class="cw__viewer" [class.cw__viewer--none]="fileView() && !compareOn()">
                @if (compareOn()) {
                  @if (!compareItems().length) { <p class="cw__muted">Tap dates on the timeline, or consults and reports on the right, to compare them here.</p> }
                  @if (compareCols().length; as n) {
                    @let m = matrix();
                    <div class="cmx" [style.--cmx-n]="n" role="table" aria-label="Consults side by side">
                      <div class="cmx__row cmx__row--head" role="row">
                        <span class="cmx__lbl" role="columnheader"></span>
                        @for (c of compareCols(); track c.id; let i = $index) {
                          <span class="cmx__col" role="columnheader">
                            <span class="cmx__ord nd-num">{{ orderOf('consult:' + c.id) }}</span>
                            <b>{{ c.label }}</b><small>{{ c.sub }}</small>
                            <button type="button" class="cmx__x" (click)="unpick('consult:' + c.id)" [attr.aria-label]="'Remove ' + c.label + ' from compare'">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                            </button>
                          </span>
                        }
                      </div>
                      @if (showSec('findings') && m.findings.length) { <div class="cmx__sec" role="row"><span role="cell">Findings</span></div> }
                      @for (r of showSec('findings') ? m.findings : []; track r.key) {
                        <div class="cmx__row" role="row"><span class="cmx__lbl" role="rowheader">{{ r.label }}</span>
                          @for (c of r.cells; track $index; let i = $index) { <span class="cmx__cell" role="cell" [class.cmx__cell--chg]="r.changed[i]">{{ c || '—' }}</span> }
                        </div>
                      }
                      @if (showSec('dx')) {
                        <div class="cmx__sec" role="row"><span role="cell">Diagnosis</span></div>
                        <div class="cmx__row" role="row"><span class="cmx__lbl" role="rowheader">Diagnosis</span>
                          @for (c of m.diagnosis.cells; track $index; let i = $index) { <span class="cmx__cell" role="cell" [class.cmx__cell--chg]="m.diagnosis.changed[i]">{{ c || '—' }}</span> }
                        </div>
                      }
                      <div class="cmx__sec" role="row"><span role="cell">Prescription</span></div>
                      @for (r of m.rx; track r.key) {
                        <div class="cmx__row" role="row"><span class="cmx__lbl" role="rowheader">{{ r.label }}</span>
                          @for (c of r.cells; track $index; let i = $index) { <span class="cmx__cell nd-num" role="cell" [class.cmx__cell--chg]="r.changed[i]">{{ c || '—' }}</span> }
                        </div>
                      } @empty { <div class="cmx__row" role="row"><span class="cmx__lbl" role="rowheader">—</span>@for (c of compareCols(); track c.id) { <span class="cmx__cell" role="cell">No medicines</span> }</div> }
                      @if (showSec('tests')) {
                        <div class="cmx__sec" role="row"><span role="cell">Tests</span></div>
                        <div class="cmx__row" role="row"><span class="cmx__lbl" role="rowheader">Tests</span>
                          @for (c of m.tests.cells; track $index; let i = $index) { <span class="cmx__cell" role="cell" [class.cmx__cell--chg]="m.tests.changed[i]">{{ c || '—' }}</span> }
                        </div>
                      }
                    </div>
                  }
                  @if (resultGroups().length) {
                    <div class="cw__cmpgrid">
                      @for (g of resultGroups(); track g.title) {
                        <div class="cw__cp">
                          <b>{{ g.title }} @for (it of g.items; track it.id) { <span class="cmx__ord nd-num">{{ orderOf(it.id) }}</span> }</b>
                          <span class="cw__big nd-num" [class.cw__big--h]="g.last.high">{{ g.last.result!.value }} <small>{{ g.last.result!.unit }} · {{ g.last.date + 'T00:00:00' | date:'d MMM y' }}</small></span>
                          @if (spark(g.last.result!.points); as p) { <svg class="cw__spark" viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true"><polyline [attr.points]="p" fill="none" stroke="currentColor" stroke-width="2"/></svg> }
                          <p class="cw__muted nd-num">@for (pt of g.last.result!.points; track $index; let last = $last) { {{ pt.date | date:'d MMM' }}: {{ pt.value }}@if (!last) { · } }</p>
                          <button type="button" class="nd-btn nd-btn--tertiary" (click)="unpickAll(g.items)">Remove</button>
                        </div>
                      }
                    </div>
                  }
                } @else if (viewItem(); as it) {
                  @switch (it.type) {
                    @case ('flow') {
                      <div class="cw__flow">
                        @for (s of it.steps ?? []; track $index; let last = $last) {
                          <div class="cw__fs" [class.cw__fs--now]="last"><span class="nd-num">{{ s.at }}</span><b>{{ s.what }}</b></div>
                        } @empty { <p class="cw__muted">No steps recorded for this visit.</p> }
                      </div>
                    }
                    @case ('vit') {
                      <div class="cw__cp cw__cp--wide">
                        @for (v of vitalRows(); track v.label) {
                          <div class="cw__kv" [class.cw__kv--warn]="v.warn"><span>{{ v.label }}</span><b class="nd-num">{{ v.value }}</b></div>
                        }
                        <p class="cw__muted">{{ w.vitals?.recordedByName || 'Recorded' }}@if (w.vitals?.recordedAt) { · {{ w.vitals?.recordedAt | date:'h:mm a' }} }</p>
                      </div>
                    }
                    @case ('pre') {
                      <div class="cw__cp cw__cp--wide">
                        @if (it.id === 'today:desk') { <p class="cw__p">Complaint: {{ it.text }}</p> }
                        @else { @for (p of intakePrefills(); track p.id) { <div class="cw__kv"><span>{{ p.label }}</span><b>{{ p.value }}</b></div> } }
                        @if (editable()) { <div><button type="button" class="nd-btn nd-btn--secondary" (click)="closeViewer(); openFindings()">Review in Findings</button></div> }
                      </div>
                    }
                    @case ('res') {
                      @if (it.result; as r) {
                        <div class="cw__cp cw__cp--wide">
                          <span class="cw__big nd-num" [class.cw__big--h]="it.high">{{ r.value }} <small>{{ r.unit }}@if (r.range) { · normal {{ r.range }}}</small></span>
                          @if (spark(r.points); as p) {
                            <span class="cw__k">Trend</span>
                            <svg class="cw__spark" viewBox="0 0 240 64" preserveAspectRatio="none" aria-hidden="true"><polyline [attr.points]="p" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                            <p class="cw__muted nd-num">@for (pt of r.points; track $index; let last = $last) { {{ pt.date | date:'d MMM' }}: {{ pt.value }}@if (!last) { · } }</p>
                          }
                        </div>
                      }
                    }
                    @case ('rx') {
                      <div class="cw__cp cw__cp--wide">
                        @for (d of it.rx ?? []; track $index; let i = $index) { <div class="cw__rxl"><span class="nd-num">{{ i + 1 }}</span><span>{{ rxText(d) }}</span></div> }
                        @if (editable()) { <div><button type="button" class="nd-btn nd-btn--secondary" (click)="repeatRx(it)" data-repeat>Repeat this prescription today</button></div> }
                      </div>
                    }
                  }
                }
              </div>
            }
            <!-- The patient-journey viewer (reports / images / compare grid) — reused, viewer only. -->
            <pf-patient-timeline #tl class="cw__tl" [class.cw__tl--on]="fileView()" [patientId]="w.patient.id" [embedded]="true" [hideTitle]="true" [viewerOnly]="true"></pf-patient-timeline>

            @if (!viewing()) {
              <!-- ── The prescription pad: rows in printed order; a label folds its row ── -->
              <div class="pad" role="form" aria-label="Prescription pad">
                <!-- C/O -->
                <section class="prow" [class.prow--coll]="isColl('find')" data-row="find">
                  <button type="button" class="plab" (click)="toggleRow('find')" [attr.aria-expanded]="!isColl('find')">
                    <span class="plab__chev" aria-hidden="true">▾</span><b>C/O</b> · Complaint
                  </button>
                  <div class="pbody">
                    @if (isColl('find')) { <p class="psum">{{ coText() || 'Nothing noted yet' }}</p> }
                    @else {
                      <button type="button" class="pfind" (click)="openFindings()" data-findings>
                        <span class="pfind__t">{{ st().chiefComplaint || 'Add the complaint and examination' }}</span>
                        @for (w of coWarn(); track w) { <span class="pfind__w">· {{ w }}</span> }
                        @for (a of coAnswers(); track a) { <span class="pfind__a">· {{ a }}</span> }
                        @if (editable() && pending().length) { <span class="pfind__rv">Check {{ pending().length }}</span> }
                      </button>
                    }
                  </div>
                </section>

                <!-- Dx -->
                <section class="prow" [class.prow--coll]="isColl('dx')" data-row="dx">
                  <button type="button" class="plab" (click)="toggleRow('dx')" [attr.aria-expanded]="!isColl('dx')">
                    <span class="plab__chev" aria-hidden="true">▾</span><b>Dx</b> · Diagnosis
                  </button>
                  <div class="pbody">
                    @if (isColl('dx')) { <p class="psum">{{ dxText(st().diagnoses) || 'None' }}</p> }
                    @else {
                      @if (st().diagnoses.length) {
                        <div class="pchips">
                          @for (d of st().diagnoses; track d.label; let i = $index) {
                            @if (editDx() === i) {
                              <input class="nd-input pchip-edit" type="text" [value]="d.label" (keydown.enter)="renameDx(i, $any($event.target).value)" (blur)="renameDx(i, $any($event.target).value)"
                                     (keydown.escape)="editDx.set(null)" aria-label="Edit the diagnosis" />
                            } @else {
                              <span class="pchip" [class.pchip--main]="i === 0">
                                <button type="button" class="pchip__t" (click)="editable() && editDx.set(i)" [attr.aria-label]="'Edit ' + d.label">{{ d.label }}@if (d.code) { <em>{{ d.code }}</em> }@if (i === 0) { <small>Main</small> }</button>
                                @if (editable()) { <button type="button" class="pchip__x" (click)="removeDx(i)" [attr.aria-label]="'Remove ' + d.label">×</button> }
                              </span>
                            }
                          }
                        </div>
                      } @else if (!editable()) { <p class="psum">No diagnosis recorded.</p> }
                      @if (editable()) {
                        <pf-pad-add placeholder="Add a diagnosis…" [options]="dxOptions()" [exclude]="dxLabels()" [quick]="dxQuick()" quickLabel="Suggested" [allowFree]="true"
                                    (query)="onDxType($event)" (pick)="addDx({ label: $event.label, code: $event.meta ?? null })" (free)="addDx({ label: $event, source: 'mine' })"></pf-pad-add>
                      }
                    }
                  </div>
                </section>

                <!-- Rx -->
                <section class="prow" [class.prow--coll]="isColl('rx')" data-row="rx">
                  <button type="button" class="plab" (click)="toggleRow('rx')" [attr.aria-expanded]="!isColl('rx')">
                    <span class="plab__chev" aria-hidden="true">▾</span><b>Rx</b> · Medicines
                  </button>
                  <div class="pbody">
                    @if (isColl('rx')) { <p class="psum">{{ rxSum() }}</p> }
                    <div [hidden]="isColl('rx')">
                      <pf-rx-editor #rx [lines]="st().lines" (linesChange)="patch({ lines: $event })" [drugs]="drugList()" [allergies]="allergies()"
                                    [pregnant]="ws()?.pregnancy ?? null" [readonly]="!editable()" [start]="visitDay()" [usuals]="usuals()" [preferIds]="preferIds()"
                                    (search)="drugSearch$.next($event)" (notice)="toast.info($event)">
                        @if (editable() && (usualSet() || w.lastVisit?.rx?.length || favs().length)) {
                          <div rx-quick class="pquick" role="group" aria-label="One tap">
                            @if (w.lastVisit?.rx?.length) {
                              <button type="button" class="pquick__c pquick__c--set" (click)="repeatLast()" data-repeat-last>+ Repeat {{ w.lastVisit!.visitDate | date:'d MMM' }}</button>
                            }
                            @if (usualSet(); as u) {
                              <button type="button" class="pquick__c pquick__c--set" (click)="applyUsualSet()" data-dxset>+ {{ primaryDx() }} set <small>{{ u.rx.length }}</small></button>
                            }
                            @for (d of favs(); track d.id) { <button type="button" class="pquick__c" (click)="addFav(d)">+ {{ d.name }}</button> }
                          </div>
                        }
                        @if (usualApplied()) {
                          <div rx-quick class="cw__banner">
                            <span>Your usual for <b>{{ usualApplied()!.dx }}</b> is in.</span>
                            <button type="button" class="nd-btn nd-btn--tertiary" (click)="undoUsualSet()">Undo</button>
                          </div>
                        }
                      </pf-rx-editor>
                    </div>
                  </div>
                </section>

                <!-- Procedures -->
                <section class="prow" [class.prow--coll]="isColl('proc')" data-row="proc">
                  <button type="button" class="plab" (click)="toggleRow('proc')" [attr.aria-expanded]="!isColl('proc')">
                    <span class="plab__chev" aria-hidden="true">▾</span>Procedures
                  </button>
                  <div class="pbody">
                    @if (isColl('proc')) { <p class="psum">{{ procSum() }}</p> }
                    @else {
                      @if (st().procedures; as procs) {
                        <pf-consult-procedures [options]="w.procedureOptions ?? []" [items]="procs" [pricing]="w.procedurePricing ?? null"
                                               [readonly]="!editable()" [payAfter]="w.billing?.mode === 'after_consult'" [laterEnabled]="laterEnabled()"
                                               [showReasonErr]="reasonErr()" [recordEnabled]="recordEnabled()" [files]="procFiles()" [uploading]="procUploading()" [canRemoveFiles]="editable()"
                                               (itemsChange)="patch({ procedures: $event })" (upload)="uploadProcFiles($event)" (removeFile)="removeProcFile($event.id)"></pf-consult-procedures>
                      } @else { <p class="psum">Procedures aren't available on this server yet.</p> }
                    }
                  </div>
                </section>

                <!-- Ix -->
                <section class="prow" [class.prow--coll]="isColl('test')" data-row="test">
                  <button type="button" class="plab" (click)="toggleRow('test')" [attr.aria-expanded]="!isColl('test')">
                    <span class="plab__chev" aria-hidden="true">▾</span><b>Ix</b> · Tests
                  </button>
                  <div class="pbody">
                    @if (isColl('test')) { <p class="psum">{{ testSum() }}</p> }
                    @else {
                      @if (st().tests.length) {
                        <div class="pchips">
                          @for (t of st().tests; track t.testId) {
                            <span class="pchip">
                              <span class="pchip__t">{{ t.name }}@if (t.price) { <small class="nd-num">₹{{ t.price }}</small> }</span>
                              @if (editable() || t.specimen) {
                                <pf-opd-specimen-picker [test]="testForPicker(t.testId)" [value]="t.specimen ?? null" [invalid]="specimenInvalid(t.testId)" [readonly]="!editable()"
                                                        (valueChange)="setSpecimen(t.testId, $event)"></pf-opd-specimen-picker>
                              }
                              @if (editable()) { <button type="button" class="pchip__x" (click)="toggleTest(t)" [attr.aria-label]="'Remove ' + t.name">×</button> }
                            </span>
                          }
                        </div>
                      } @else if (!editable()) { <p class="psum">No tests were ordered.</p> }
                      @if (w.visit.labOrderId && !editable() && st().tests.length) { <p class="psum">Sent to the lab as a normal order.</p> }
                      @if (editable()) {
                        <pf-pad-add placeholder="Add a test…" [options]="testOptions()" [exclude]="testIds()" [quick]="testQuick()" quickLabel="Common for the diagnosis"
                                    (pick)="addTestById($event.id)"></pf-pad-add>
                        @if (testLoadError()) { <p class="psum">The lab test list could not be loaded for your role.</p> }
                      }
                    }
                  </div>
                </section>

                <!-- Adv -->
                <section class="prow" [class.prow--coll]="isColl('adv')" data-row="adv">
                  <button type="button" class="plab" (click)="toggleRow('adv')" [attr.aria-expanded]="!isColl('adv')">
                    <span class="plab__chev" aria-hidden="true">▾</span><b>Adv</b> · Advice
                  </button>
                  <div class="pbody">
                    @if (isColl('adv')) { <p class="psum">{{ advice().join(' · ') || 'None' }}</p> }
                    @else {
                      @if (advice().length) {
                        <div class="pchips">
                          @for (a of advice(); track $index; let i = $index) {
                            @if (editAdv() === i) {
                              <input class="nd-input pchip-edit" type="text" [value]="a" (keydown.enter)="renameAdvice(i, $any($event.target).value)" (blur)="renameAdvice(i, $any($event.target).value)"
                                     (keydown.escape)="editAdv.set(null)" aria-label="Edit the advice" />
                            } @else {
                              <span class="pchip">
                                <button type="button" class="pchip__t" (click)="editable() && editAdv.set(i)" [attr.aria-label]="'Edit ' + a">{{ a }}</button>
                                @if (editable()) { <button type="button" class="pchip__x" (click)="removeAdvice(i)" aria-label="Remove this advice">×</button> }
                              </span>
                            }
                          }
                        </div>
                      } @else if (!editable()) { <p class="psum">No advice.</p> }
                      @if (editable()) {
                        <pf-pad-add placeholder="Add advice…" [options]="adviceOptions()" [exclude]="advice()" [quick]="adviceQuick()" quickLabel="Common advice" [allowFree]="true"
                                    (pick)="addAdvice($event.label)" (free)="addAdvice($event)"></pf-pad-add>
                      }
                    }
                  </div>
                </section>

                <!-- F/U -->
                <section class="prow" [class.prow--coll]="isColl('fu')" data-row="fu">
                  <button type="button" class="plab" (click)="toggleRow('fu')" [attr.aria-expanded]="!isColl('fu')">
                    <span class="plab__chev" aria-hidden="true">▾</span><b>F/U</b> · Follow-up
                  </button>
                  <div class="pbody">
                    @if (isColl('fu')) { <p class="psum">{{ fuLabel() }}</p> }
                    @else {
                      <div class="popts" role="radiogroup" aria-label="Follow-up">
                        @for (p of fuPicks; track p.label) {
                          <button type="button" class="o" role="radio" [attr.aria-checked]="p.days === st().followUpDays" [disabled]="!editable()" (click)="patch({ followUpDays: p.days })">{{ p.label }}</button>
                        }
                        @if (st().followUpDays != null) { <span class="phint">{{ fuText() }}</span> }
                      </div>
                    }
                  </div>
                </section>

                <!-- Private note -->
                <section class="prow" [class.prow--coll]="isColl('note')" data-row="note">
                  <button type="button" class="plab" (click)="toggleRow('note')" [attr.aria-expanded]="!isColl('note')">
                    <span class="plab__chev" aria-hidden="true">▾</span>Private note
                  </button>
                  <div class="pbody">
                    @if (isColl('note')) { <p class="psum">{{ st().privateNotes ? 'Written · only you see it' : 'None' }}</p> }
                    @else if (w.consult?.privateNotesHidden) { <p class="psum">The consulting doctor's private notes are not visible to you.</p> }
                    @else {
                      <textarea class="nd-input pnote" rows="1" [value]="st().privateNotes" [disabled]="!editable()" (input)="patch({ privateNotes: $any($event.target).value })"
                                placeholder="Only you see this. Never printed or sent." [attr.aria-label]="'Private note. ' + visibilityText()"></textarea>
                    }
                  </div>
                </section>
              </div>
            }
          </main>

          <!-- ── Right: the patient card (Always strip + the visit's records) ── -->
          @if (rightOverlay()) { <div class="cw__scrim" (click)="closeRight()" aria-hidden="true"></div> }
          <aside class="nd-card cw__right" [class.cw__right--float]="!rightDocked() || phone()" [class.cw__right--open]="rightOverlay()" aria-label="Patient records">
            <pf-consult-visit-card [items]="items()" [dayKey]="dayKey()" [isToday]="dayKey() === todayKey()" [loading]="dock.loading()"
                                   [selectedId]="viewItem()?.id ?? null" [compareIds]="compareIdList()" [compareMode]="compareMode()" [closable]="!rightDocked() || phone()" [pinned]="rightPinned()" [autoCollapsed]="rightPinned() && !rightDocked()" [pinnable]="!phone()"
                                   [allergies]="allergies()" [pregnancy]="w.pregnancy ?? null" [conditions]="w.conditions" [medicines]="w.currentMedicines"
                                   [watch]="watch()" [results]="recentResults()" [lines]="st().lines" [drugs]="drugList()" [preferIds]="preferIds()" [canEdit]="editable()"
                                   (open)="onTile($event)" (today)="dock.select(todayKey())" (close)="closeRight(true)" (togglePin)="toggleRightPin()"
                                   (swap)="swapLine($event.key, $event.alt)" (seeLine)="seeLine()"
                                   (addAllergy)="addAllergy($event)" (removeAllergy)="removeAllergy($event)"></pf-consult-visit-card>
          </aside>

          <!-- ── The Findings drawer (C/O): prefill review + the consult form ── -->
          @if (findingsOpen()) {
            <div class="cw__scrim" (click)="findingsOpen.set(false)" aria-hidden="true"></div>
            <aside class="nd-card cw__drawer" role="dialog" aria-label="Complaint and findings">
              <header class="nd-card__head">
                <span class="nd-card__label">Complaint &amp; findings</span>
                <span class="nd-card__spacer"></span>
                <button type="button" class="cw__iconbtn cw__iconbtn--sm" (click)="findingsOpen.set(false)" aria-label="Close the findings">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </header>
              <div class="cw__drawerb">
                @if (editable() && pending().length) {
                  <div class="cw__review" data-review>
                    <div class="cw__rh"><span>Check what was filled in before the consult · {{ pending().length }}</span>
                      <button type="button" class="nd-btn nd-btn--secondary cw__xs" (click)="confirmAll()">Confirm all</button></div>
                    @for (p of pending(); track p.id) {
                      <div class="cw__pf" [class.cw__pf--w]="p.warn" [attr.data-prefill]="p.id">
                        <div class="cw__pfm"><span class="cw__pfv">{{ p.label }}: {{ p.value }}</span><span class="cw__pfs">{{ p.src }}</span></div>
                        <div class="cw__pfa">
                          <button type="button" class="nd-btn nd-btn--tertiary cw__xs" (click)="editPrefill(p)">Edit</button>
                          <button type="button" class="nd-btn nd-btn--secondary cw__xs" (click)="confirm(p.id)">Confirm</button>
                        </div>
                      </div>
                    }
                  </div>
                }
                <label class="cw__f" [class.cw__f--pre]="isPending('complaint')">
                  <span>Complaint @if (isPending('complaint')) { <em class="cw__ptag">From the front desk</em> }</span>
                  <input id="cw-complaint" class="nd-input cw__in" type="text" [value]="st().chiefComplaint" [disabled]="!editable()" aria-label="Chief complaints"
                         (input)="onComplaint($any($event.target).value)" placeholder="What brings the patient in" />
                </label>
                @if (w.form) {
                  <section class="cw__form" data-grp="form">
                    <pf-opd-form-renderer [schema]="formSchema()" [addons]="w.form.addonFields" [answers]="st().answers"
                                          [mode]="editable() ? 'edit' : 'readonly'" [layout]="phone() ? 'phone' : 'screen'" [compact]="true" [visitDate]="w.visit.visitDate"
                                          (answersChange)="patch({ answers: $event })" (mediaRequest)="captureMedia($event)"></pf-opd-form-renderer>
                    <input #mediaIn class="cw__file" type="file" tabindex="-1" aria-hidden="true" (change)="onMediaPicked(mediaIn)" />
                    @if (uploading()) { <p class="cw__upl" role="status">Uploading {{ uploading() }}…</p> }
                    <p class="cw__muted">These questions come from the {{ w.form.formName }} form set up in OPD admin.</p>
                  </section>
                } @else {
                  <p class="cw__muted">No consult form is set for this service — the complaint and diagnosis are enough to finish.</p>
                }
              </div>
            </aside>
          }
        </div>

        <pf-journey-dock class="cw__dock" (picked)="onDockPick($event)"></pf-journey-dock>

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
  private readonly entitlements = inject(TenantEntitlementsService, { optional: true });
  readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  readonly dock = inject(JourneyDockService);

  readonly spaces = SPACES;
  readonly fuPicks = FOLLOW_UP_PICKS;

  readonly ws = signal<ConsultWorkspace | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly st = signal<ConsultEditState>(EMPTY);
  readonly space = signal<ConsultSpace>('find');
  readonly allergies = signal<OpdPatientAllergy[]>([]);
  readonly completeOpen = signal(false);
  readonly completing = signal(false);
  readonly saveState = signal<SaveState>('idle');
  readonly savedAt = signal<string | null>(null);
  /** The left card's record open in the centre viewer. */
  readonly viewItem = signal<VisitItem | null>(null);
  /** Compare: the ticked records (any visit), and whether the compare view is open. */
  readonly compareItems = signal<VisitItem[]>([]);
  readonly compareOn = signal(false);
  /** Compare mode (the band's pressed Compare): a tile tap adds / removes it. */
  readonly compareMode = computed(() => this.compareOn());
  /** The unpinned patient card open as an overlay (phone: the sheet). */
  readonly patientOpen = signal(false);
  /** Pins (per user, localStorage). Default: pinned at ≥1280px, a rail below. */
  readonly rightPinned = signal(true);
  /** The overlay shows when opened — and stays while compare mode is on. */
  /** The body's content width + column gaps (ResizeObserver) → auto-balance. */
  readonly bodyW = signal(0);
  /** The real app-nav insets (bottom bar / floating pill / left rail), measured. */
  readonly insets = signal<{ bottom: number; left: number } | null>(null);
  private chromeRo: ResizeObserver | null = null;
  private readonly onWinResize = () => this.measureChrome();
  /** Fit the consult exactly beside the visible nav, so neither the dock nor
   *  the pad sits under it, and nothing starts under a left rail. */
  measureChrome() {
    if (typeof window === 'undefined') return;
    const els = Array.from(this.doc.querySelectorAll<HTMLElement>('.pf-bottom-nav, .pf-chrome'))
      .filter(el => { const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden'; });
    const next = chromeInsets(els.map(el => el.getBoundingClientRect()), window.innerWidth, window.innerHeight);
    const cur = this.insets();
    if (!cur || cur.bottom !== next.bottom || cur.left !== next.left) this.insets.set(next);
  }
  private bodyGaps = 16;
  private readonly balance = computed(() => balancePanels(this.bodyW(), this.bodyGaps, this.rightPinned()));
  /** Docked = pinned AND the centre still has room for the form (≥680px). */
  readonly rightDocked = computed(() => this.balance().rightDocked);
  private readonly bodyEl = viewChild<{ nativeElement: HTMLElement }>('body');
  private bodyRo: ResizeObserver | null = null;
  readonly rightOverlay = computed(() => (!this.rightDocked() || this.phone()) && (this.patientOpen() || (this.compareMode() && !this.phone())));
  readonly isAdmin = computed(() => { try { return !!this.auth.hasAnyPermission?.(ADMIN_PERMS); } catch { return false; } });
  readonly compareIdList = computed(() => this.compareItems().map(i => i.id));
  /** Prefills the doctor confirmed (per visit, remembered on this device). */
  readonly confirmed = signal<Set<string>>(new Set());
  /** Complete warns about unreviewed prefills only once. */
  private prefillWarned = false;
  /** Complete was refused for a changed procedure price without a reason. */
  readonly reasonErr = signal(false);
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
  /** The drug master's UsualJson per drug id (doctor favourites). */
  private readonly drugUsual = signal<Record<string, RxUsual>>({});
  readonly drugList = computed(() => [...this.drugCache().values()]);
  readonly drugSearch$ = new Subject<string>();

  readonly usual = signal<ConsultUsual | null>(null);
  readonly usualApplied = signal<{ dx: string; keys: string[]; tests: string[]; advice: boolean } | null>(null);

  readonly testCatalog = signal<LabTestRow[]>([]);
  readonly testLoadError = signal(false);
  readonly testQuery = signal('');
  readonly testActive = signal(0);

  readonly dxQuery = signal('');
  readonly dxSuggest = signal<ConsultDxSuggestion[]>([]);
  readonly dxActive = signal(0);
  readonly dxOpen = computed(() => !!this.dxQuery().trim());
  private readonly dx$ = new Subject<string>();

  private readonly tl = viewChild<PatientTimelineComponent>('tl');
  private readonly rx = viewChild<RxEditorComponent>('rx');

  private readonly save$ = new Subject<void>();

  /** The service's form without the questions the consult owns (chief complaint). */
  readonly formSchema = computed(() => withoutConsultOwned(this.ws()?.form?.schema));

  /** Phone layout for the form renderer (one column) — the renderer's own ≤760px rule. */
  readonly phone = signal(typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches);
  /** ≤1180px (tablet + phone): the vitals chips scroll. */
  readonly compact = signal(typeof matchMedia === 'function' && matchMedia('(max-width: 1180px)').matches);
  private readonly phoneMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  private readonly onPhoneMq = (e: MediaQueryListEvent) => this.phone.set(e.matches);
  private readonly compactMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 1180px)') : null;
  private readonly onCompactMq = (e: MediaQueryListEvent) => this.compact.set(e.matches);
  private readonly mediaIn = viewChild<{ nativeElement: HTMLInputElement }>('mediaIn');
  private pendingMedia: OpdMediaRequest | null = null;
  /** The file name being uploaded (null = idle). */
  readonly uploading = signal<string | null>(null);

  readonly editable = computed(() => {
    const w = this.ws();
    return !!w && w.visit.canEdit && w.visit.status === 'in_consult' && w.consult?.status !== 'completed';
  });
  readonly visitDay = computed(() => { const d = this.ws()?.visit.visitDate; return d ? new Date(d.slice(0, 10) + 'T00:00:00') : new Date(); });
  readonly todayKey = computed(() => journeyDayKey(this.ws()?.visit.visitDate ?? new Date().toISOString()));
  readonly dayKey = computed(() => this.dock.selectedKey() ?? this.todayKey());
  readonly primaryDx = computed(() => this.st().diagnoses[0]?.label ?? '');
  readonly unresolved = computed(() => unresolvedAllergies(this.st().lines, this.allergies()));
  /** Pregnancy-safety guard (night/safety, critic P0 #1c) — blocks Complete like unresolved allergies. */
  readonly pregnancyUnresolved = computed(() => unresolvedPregnancyRisks(this.st().lines, this.ws()?.pregnancy ?? null));
  /** Required fields (night/safety, critic P1 #2) — visible, required consult-form questions with no answer. */
  readonly requiredMissing = computed(() => missingRequired(allQuestions(this.formSchema()), this.st().answers));
  /** The usual dose per drug: the doctor's own last line wins over the master's UsualJson. */
  readonly usuals = computed<Record<string, RxUsual>>(() => ({
    ...this.drugUsual(), ...usualsFrom(this.usual()?.rx, this.ws()?.lastVisit?.rx, this.ws()?.rx),
  }));
  readonly preferIds = computed(() => (this.usual()?.rx ?? []).map(r => r.drugId).filter((x): x is string => !!x));
  /** Server features (feature-detected; older servers have none). */
  readonly laterEnabled = computed(() => this.ws()?.features?.procedureLater === true);
  private readonly bodyOpts = computed<BodyOpts>(() => ({ procedureLater: this.laterEnabled(), procedureRecord: this.recordEnabled() }));
  /** Page: whenever Messages is on (no assistant → the popover says how to set one). */
  readonly showPage = computed(() => this.entitlements?.moduleEnabled('messages') !== false);
  readonly suggested = computed<ConsultInvestigationItem[]>(() => (this.usual()?.tests ?? []).map(t => ({ ...t, price: this.priceOf(t.testId) })));
  readonly suggestedMissing = computed(() => this.suggested().filter(t => !this.hasTest(t.testId)));
  readonly testTotal = computed(() => this.st().tests.reduce((a, t) => a + (Number(t.price) || 0), 0));
  readonly testHits = computed(() => {
    const q = this.testQuery().trim().toLowerCase();
    if (!q) return [];
    return this.testCatalog().filter(t => `${t.name} ${t.testCode ?? ''} ${t.shortName ?? ''}`.toLowerCase().includes(q)).slice(0, 10);
  });
  /** The diagnosis set chip (GET usual?dx) while it hasn't been applied. */
  readonly usualSet = computed(() => (this.usualApplied() ? null : this.usual()) && this.usual()?.rx.length ? this.usual() : null);
  /** One-tap usual medicines (UsualJson / recent lines) not already on the Rx. */
  readonly favs = computed(() => {
    const on = new Set(this.st().lines.map(l => l.drug.id));
    const ids = Object.keys(this.usuals());
    return ids.map(id => this.drugCache().get(id)).filter((d): d is ConsultDrugRef => !!d && !on.has(d.id)).slice(0, 3);
  });
  /** Header meta as separate bits (age / sex · MRN · token · department · doctor). */
  readonly metaBits = computed(() => {
    const w = this.ws();
    if (!w) return [] as string[];
    const sex = w.patient.sex ? w.patient.sex.charAt(0).toUpperCase() : '';
    // The doctor is the one using the screen — no doctor / department here.
    return [[w.patient.ageDisplay, sex].filter(Boolean).join(' '), w.patient.mrn ?? '', 'Token ' + w.visit.tokenLabel].filter(Boolean);
  });
  readonly visibilityText = computed(() => {
    const v = this.st().privateNotesVisibility;
    return v === 'doctor' ? 'Visible to you only (OPD workflow setting).' : v === 'department' ? 'Visible to doctors of this department.' : 'Visible to all doctors.';
  });
  readonly fuText = computed(() => followUpFeeText(this.st().followUpDays, this.ws()?.followUpRule ?? null));
  readonly spaceLabel = computed(() => SPACES.find(s => s.id === this.space())?.label ?? '');

  // ── Prefill review ─────────────────────────────────────────────────
  readonly prefills = computed<Prefill[]>(() => {
    const w = this.ws();
    if (!w) return [];
    const qs = allQuestions(this.formSchema());
    return prefillsOf(w, this.st(), k => qs.find(q => q.key === k)?.label ?? k);
  });
  readonly pending = computed(() => this.prefills().filter(p => !this.confirmed().has(p.id)));
  readonly intakePrefills = computed(() => this.prefills().filter(p => p.id.startsWith('ans:')));

  // ── The left card's records ────────────────────────────────────────
  readonly watch = computed(() => watchLine(this.dock.trends()));
  /** The patient card's recent results (latest value per test, with H / L). */
  readonly recentResults = computed(() => recentResultsOf(this.dock.trends(), 6));
  readonly items = computed<VisitItem[]>(() => {
    const w = this.ws();
    if (!w) return [];
    const tl = this.tl();
    const orders = tl ? tl.visits().flatMap(v => v.orders.map(o => ({ id: o.id, name: tl.orderPanelName(o), createdAt: o.createdAt, hasReport: !!tl.reportFor(o.id) }))) : [];
    const docs = tl ? tl.visits().flatMap(v => v.docs.map(d => ({ id: d.id, fileName: d.fileName, isImage: d.isImage, uploadedAt: d.uploadedAt }))) : [];
    return visitItems({
      dayKey: this.dayKey(), todayKey: this.todayKey(), ws: w, history: (this.dock.history() ?? []).filter(h => h.visitId !== w.visit.id),
      orders, docs, trends: this.dock.trends(), intakeCount: (w.prefilledAnswerKeys ?? []).length,
    });
  });
  readonly viewing = computed(() => this.compareOn() || !!this.viewItem());
  /** The reused journey viewer shows: a report / image, or compared files. */
  readonly fileView = computed(() => (this.compareOn() && this.compareItems().some(i => !!i.fileId)) || (!this.compareOn() && !!this.viewItem()?.fileId));
  /** Compare cards for what the journey viewer doesn't draw (results, prescriptions). */
  /** The picked consults as columns, oldest → newest. */
  readonly compareCols = computed<CompareConsult[]>(() => {
    const w = this.ws();
    if (!w) return [];
    const hist = this.dock.history() ?? [];
    const out: CompareConsult[] = [];
    for (const it of this.compareItems()) {
      if (!it.consultId) continue;
      if (it.consultId === w.visit.id) {
        const s = this.st();
        out.push({ id: w.visit.id, date: this.todayKey(), label: 'Today', sub: w.visit.doctorName ?? '', complaint: s.chiefComplaint,
          schema: this.formSchema(), answers: s.answers, diagnoses: s.diagnoses.map(d => d.label),
          rx: s.lines.map(l => ({ key: l.drug.free ? l.drug.name.toLowerCase() : l.drug.id, name: l.drug.name, text: lineShort(l.line, l.drug) })),
          tests: s.tests.map(t => t.name) });
      } else {
        const c = hist.find(h => h.visitId === it.consultId);
        if (!c) continue;
        out.push({ id: c.visitId, date: journeyDayKey(c.visitDate), label: new Date(journeyDayKey(c.visitDate) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
          sub: c.doctorName ?? '', complaint: c.chiefComplaint ?? '', schema: c.form?.schema ?? null, answers: (c.answers as Record<string, unknown>) ?? {},
          diagnoses: c.diagnoses.map(d => d.label),
          rx: c.rx.map(d => { const l = fromDto(d, this.drugList()); return { key: d.drugId ?? d.drugName.toLowerCase(), name: d.drugName, text: lineShort(l.line, l.drug) }; }),
          tests: c.investigations.flatMap(i => i.items).map(t => t.name) });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });
  readonly matrix = computed(() => compareMatrix(this.compareCols()));

  // ── Compare presets (the Compare ▾ menu) ───────────────────────────
  readonly presetsOpen = signal(false);
  readonly activePreset = signal<ComparePreset | null>(null);
  readonly presetTitle = presetTitle;
  showSec(s: CompareSection) { const p = this.activePreset(); return !p?.sections || p.sections.includes(s); }
  /** What each preset would pick, from the data the consult already loads. */
  readonly presets = computed<ComparePreset[]>(() => {
    const w = this.ws();
    if (!w) return [];
    const tl = this.tl();
    const reports: PresetFile[] = [], images: PresetFile[] = [];
    for (const v of tl?.visits() ?? []) {
      for (const o of v.orders) reports.push({ fileId: 'rep:' + o.id, date: journeyDayKey(o.createdAt), title: tl!.orderPanelName(o) });
      for (const d of v.docs) (d.isImage ? images : reports).push({ fileId: 'doc:' + d.id, date: journeyDayKey(d.uploadedAt), title: d.fileName });
    }
    const trends: PresetTrend[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const t of (this.dock.trends() as any)?.tests ?? []) for (const p of t.parameters ?? []) {
      const pts = [...(p.points ?? [])].map((x: { date: string; value: unknown; flag?: string | null }) => ({ date: journeyDayKey(String(x.date)), value: Number(x.value), flag: x.flag ?? null }))
        .filter(x => Number.isFinite(x.value)).sort((a, b) => a.date.localeCompare(b.date));
      trends.push({ key: `${t.testName}:${p.name ?? p.parameter ?? t.testName}`, title: p.name ?? p.parameter ?? t.testName, unit: p.unit ?? null, points: pts });
    }
    const consults = [{ visitId: w.visit.id, date: this.todayKey(), hasRx: this.st().lines.length > 0 },
      ...(this.dock.history() ?? []).filter(h => h.visitId !== w.visit.id).map(h => ({ visitId: h.visitId, date: journeyDayKey(h.visitDate), hasRx: h.rx.length > 0 }))];
    return comparePresets({ consults, reports, images, trends });
  });
  /** A preset: fill the picks and open the compare view straight away. */
  applyPreset(p: ComparePreset) {
    if (!p.count) return;
    this.presetsOpen.set(false);
    const items: VisitItem[] = [];
    for (const k of p.picks) {
      if (k.kind === 'consult') { const it = this.consultItem(k.visitId); if (it) items.push(it); }
      else if (k.kind === 'file') items.push({ id: k.fileId, type: k.image ? 'img' : 'pdf', title: k.title, sub: '', compare: true, date: k.date, fileId: k.fileId });
      else {
        const last = k.trend.points[k.trend.points.length - 1];
        const flag = String(last?.flag ?? '').toUpperCase();
        items.push({ id: 'trend:' + k.trend.key, type: 'res', title: k.trend.title, sub: '', compare: true, date: last?.date ?? this.todayKey(), high: !!flag && flag !== 'N',
          result: { value: String(last?.value ?? ''), unit: k.trend.unit, flag: last?.flag ?? null, points: k.trend.points.map(x => ({ date: x.date, value: x.value })) } });
      }
    }
    // Reports need their summaries before the viewer can show them.
    const tl = this.tl();
    if (tl) tl.loadReports(tl.visits().flatMap(v => v.orders).filter(o => items.some(i => i.fileId === 'rep:' + o.id)));
    this.compareItems.set(items);
    this.activePreset.set(p);
    this.viewItem.set(null);
    this.compareOn.set(true);
    queueMicrotask(() => this.syncCompareFiles());
  }
  /** Picked lab results, one card per test (its trend over time). */
  readonly resultGroups = computed(() => {
    const m = new Map<string, VisitItem[]>();
    for (const it of this.compareItems()) if (it.type === 'res' && it.result) m.set(it.title, [...(m.get(it.title) ?? []), it]);
    return [...m.entries()].map(([title, items]) => ({ title, items, last: [...items].sort((a, b) => b.date.localeCompare(a.date))[0] }));
  });
  readonly vitalRows = computed(() => {
    const v = this.ws()?.vitals;
    if (!v) return [] as { label: string; value: string; warn: boolean }[];
    const L: Record<string, [string, string]> = { bp: ['BP', 'mmHg'], pulse: ['Pulse', 'bpm'], temp: ['Temp', '°F'], spo2: ['SpO₂', '%'], rr: ['RR', '/min'], weight: ['Weight', 'kg'], bmi: ['BMI', ''] };
    return (['bp', 'pulse', 'temp', 'spo2', 'rr', 'weight', 'bmi'] as const)
      .map(k => ({ k, t: k === 'bmi' ? (bmiOf(v) != null ? String(bmiOf(v)) : '—') : vitalText(k, v) }))
      .filter(x => x.t !== '—')
      .map(x => { const f = vitalFlag(x.k, v); return { label: L[x.k][0], value: `${x.t} ${L[x.k][1]}${f ? ' · ' + (f === 'high' ? 'High' : 'Low') : ''}`.trim(), warn: !!f }; });
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
    // Auto-balance: watch the body's width (it exists once the workspace renders).
    effect(() => {
      const el = this.bodyEl()?.nativeElement;
      untracked(() => {
        this.bodyRo?.disconnect();
        if (!el || typeof ResizeObserver !== 'function') return;
        this.bodyRo = new ResizeObserver(entries => {
          const w = entries[0]?.contentRect.width ?? 0;
          const g = parseFloat(getComputedStyle(el).columnGap) || 16;
          this.bodyGaps = g;
          if (Math.abs(w - this.bodyW()) >= 1) this.bodyW.set(w);
        });
        this.bodyRo.observe(el);
      });
    });
    // Compare mode: a date picked on the timeline opens the patient card (tablet / phone).
    effect(() => {
      this.dock.selectedKey();
      untracked(() => { if (this.compareOn() && this.phone()) this.patientOpen.set(true); });
    });
    // Compare: picked reports show once their summaries arrive.
    effect(() => {
      const tl = this.tl();
      if (!tl || !this.compareOn()) return;
      tl.reportCache();
      untracked(() => this.syncCompareFiles());
    });
    // The journey viewer follows the visit the dock selected (its reports load per day).
    effect(() => {
      const k = this.dayKey();
      const tl = this.tl();
      if (tl) untracked(() => tl.selectKey(k));
    });
  }

  ngOnInit() {
    this.phoneMq?.addEventListener?.('change', this.onPhoneMq);
    this.compactMq?.addEventListener?.('change', this.onCompactMq);
    this.doc.documentElement.classList.add('pf-opd-immersive');
    // Measure the nav once the immersive chrome rule applies, then on changes.
    setTimeout(() => this.measureChrome());
    setTimeout(() => this.measureChrome(), 400);
    window.addEventListener('resize', this.onWinResize);
    if (typeof ResizeObserver === 'function') {
      this.chromeRo = new ResizeObserver(() => this.measureChrome());
      for (const el of Array.from(this.doc.querySelectorAll<HTMLElement>('.pf-bottom-nav, .pf-chrome'))) this.chromeRo.observe(el);
    }
    this.rightPinned.set(this.readPin('Right'));
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
    this.compactMq?.removeEventListener?.('change', this.onCompactMq);
    this.doc.documentElement.classList.remove('pf-opd-immersive');
    this.dock.hide();
    this.bodyRo?.disconnect();
    this.chromeRo?.disconnect();
    window.removeEventListener('resize', this.onWinResize);
    if (this.saveState() === 'dirty') this.saveNow();
  }

  private hydrate(w: ConsultWorkspace) {
    const first = !this.ws();
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
    this.dock.show({ id: w.patient.id, name: w.patient.name }, w.visit.visitDate);
    if (first) {
      // The consult opens on today's visit, whatever the dock showed before.
      this.dock.select(journeyDayKey(w.visit.visitDate));
      this.confirmed.set(this.readConfirmed(w.visit.id));
      // Nothing to review → open where the doctor works most: the diagnosis.
      this.collapsed.set((() => { try { return parseCollapsed(localStorage.getItem(padCollapseKey(this.auth.user()?.id))); } catch { return new Set<PadRow>(); } })());
    }
  }

  private mergeDrugs(rows: ConsultDrug[]) {
    const m = new Map(this.drugCache());
    const u = { ...this.drugUsual() };
    for (const r of rows) {
      m.set(r.id, drugRefOf(r));
      const usual = usualFromJson(r.usual ?? null);
      if (usual) u[r.id] = usual;
    }
    this.drugCache.set(m);
    this.drugUsual.set(u);
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
      // The doctor is typing: an unpinned journey dock folds away.
      this.dock.noteTyping();
      if (!this.rightDocked() && this.patientOpen() && !this.compareMode()) this.patientOpen.set(false);
      if ('procedures' in p && this.reasonErr() && !(p.procedures ?? []).some(x => needsPriceReason(x))) this.reasonErr.set(false);
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
    const body = draftPatchBody(sections, this.st(), this.followUpIso(), this.visitDay(), this.bodyOpts());
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

  count(id: ConsultSpace) { return spaceCount(id, this.st()); }
  /** Bring a pad row into view (unfolded); 'find' opens the Findings drawer. */
  goSpace(id: ConsultSpace) {
    this.space.set(id);
    this.viewItem.set(null);
    this.leaveCompare();
    const row = ({ find: 'find', dx: 'dx', med: 'rx', proc: 'proc', test: 'test', adv: 'adv' } as Record<ConsultSpace, PadRow>)[id];
    if (id === 'find') { this.openFindings(); return; }
    if (this.collapsed().has(row)) this.toggleRow(row);
    queueMicrotask(() => this.doc.querySelector(`[data-row="${row}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
  }

  // ── The pad ────────────────────────────────────────────────────────
  readonly collapsed = signal<Set<PadRow>>(new Set());
  readonly findingsOpen = signal(false);
  readonly editDx = signal<number | null>(null);
  readonly editAdv = signal<number | null>(null);
  isColl(r: PadRow) { return this.collapsed().has(r); }
  toggleRow(r: PadRow) {
    this.collapsed.set(toggleRowSet(this.collapsed(), r));
    try { localStorage.setItem(padCollapseKey(this.auth.user()?.id), JSON.stringify([...this.collapsed()])); } catch { /* private mode */ }
  }
  openFindings() { this.findingsOpen.set(true); this.patientOpen.set(false); }
  /** C/O summary: the complaint, what's out of range, a few key answers. */
  readonly coWarn = computed(() => vitalsWarnings(this.ws()?.vitals));
  readonly coAnswers = computed(() => printRows(allQuestions(this.formSchema()), this.st().answers ?? {})
    .filter(r => r.text).slice(0, 3).map(r => `${r.label}: ${r.text}`));
  readonly coText = computed(() => [this.st().chiefComplaint, ...this.coWarn(), ...this.coAnswers()].filter(Boolean).join(' · '));
  readonly rxSum = computed(() => { const l = this.st().lines; return l.length ? `${l.length} medicine${l.length === 1 ? '' : 's'}: ${l.map(x => x.drug.name).join(', ')}` : 'None'; });
  readonly procSum = computed(() => (this.st().procedures ?? []).map(p => p.name).join(', ') || 'None');
  readonly testSum = computed(() => this.st().tests.map(t => t.name).join(', ') || 'None');
  readonly fuLabel = computed(() => FOLLOW_UP_PICKS.find(p => p.days === this.st().followUpDays)?.label ?? (this.st().followUpDays != null ? `${this.st().followUpDays} days` : 'Not set'));
  // Dx
  readonly dxOptions = computed<PadOption[]>(() => this.dxSuggest().map(o => ({ id: o.label, label: o.label, meta: o.code ?? undefined })));
  readonly dxLabels = computed(() => this.st().diagnoses.map(d => d.label));
  /** One-tap diagnoses: the patient's known conditions and the last visit's diagnoses. */
  readonly dxQuick = computed<PadOption[]>(() => {
    const have = new Set(this.dxLabels().map(x => x.toLowerCase()));
    const src = [...(this.ws()?.lastVisit?.diagnoses ?? []), ...(this.ws()?.conditions ?? [])];
    const seen = new Set<string>();
    return src.filter(d => { const k = d.label.toLowerCase(); if (have.has(k) || seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 4).map(d => ({ id: d.label, label: d.label, meta: d.code ?? undefined }));
  });
  renameDx(i: number, v: string) {
    this.editDx.set(null);
    const label = v.trim();
    const cur = this.st().diagnoses[i];
    if (!cur || !label || label === cur.label) return;
    this.patch({ diagnoses: this.st().diagnoses.map((d, k) => (k === i ? { ...d, label, code: undefined } : d)) });
  }
  // Tests
  readonly testOptions = computed<PadOption[]>(() => this.testCatalog().map(t => ({ id: t.id, label: t.name, meta: [t.shortName, t.testCode].filter(Boolean).join(' · ') || undefined })));
  readonly testIds = computed(() => this.st().tests.map(t => t.testId));
  readonly testQuick = computed<PadOption[]>(() => this.suggestedMissing().slice(0, 4).map(t => ({ id: t.testId, label: t.name })));
  addTestById(id: string) {
    const t = this.testCatalog().find(x => x.id === id) ?? this.suggested().find(x => x.testId === id);
    if (!t) return;
    if ('testId' in t) this.addTest(t); else this.addTest({ testId: t.id, name: t.name, price: t.price });
  }
  // Advice (one chip per line of the advice text)
  readonly advice = computed(() => adviceLines(this.st().advice));
  readonly adviceOptions = computed<PadOption[]>(() => [...new Set([...adviceLines(this.usual()?.advice ?? ''), ...COMMON_ADVICE])].map(a => ({ id: a, label: a })));
  readonly adviceQuick = computed<PadOption[]>(() => this.adviceOptions().filter(o => !this.advice().includes(o.label)).slice(0, 3));
  addAdvice(text: string) { const t = text.trim(); if (t && !this.advice().includes(t)) this.patch({ advice: [...this.advice(), t].join('\n') }); }
  removeAdvice(i: number) { this.patch({ advice: this.advice().filter((_, k) => k !== i).join('\n') }); }
  renameAdvice(i: number, v: string) {
    this.editAdv.set(null);
    const t = v.trim();
    const list = this.advice();
    if (!t || t === list[i]) return;
    this.patch({ advice: list.map((a, k) => (k === i ? t : a)).join('\n') });
  }
  // Procedure record files (feature-detected)
  readonly recordEnabled = computed(() => this.ws()?.features?.procedureRecord === true || (this.ws()?.procedures ?? []).some(p => 'record' in p));
  private readonly procUploads = signal<Record<string, { id: string; name: string; kind: string; procedureId?: string | null }[]>>({});
  readonly procUploading = signal<Record<string, boolean>>({});
  /** Files removed here (hidden at once; restored if the server refuses). */
  private readonly removedMedia = signal<ReadonlySet<string>>(new Set());
  readonly procFiles = computed(() => {
    const media = this.ws()?.media ?? [];
    const up = this.procUploads();
    const out: Record<string, { id: string; name: string; kind: string }[]> = {};
    for (const p of this.st().procedures ?? []) {
      const saved = p.id ? media.filter(m => m.procedureId === p.id) : [];
      const mine = Object.values(up).flat().filter(m => p.id && m.procedureId === p.id && !saved.some(x => x.id === m.id));
      const gone = this.removedMedia();
      out[p.key] = [...saved, ...mine].filter(f => !gone.has(f.id));
    }
    return out;
  });
  /** × on a procedure file: hide it now, delete it, put it back if that fails
   *  (404 = already gone, so it stays hidden). */
  removeProcFile(id: string) {
    const visitId = this.ws()?.visit.id;
    if (!visitId || !this.editable()) return;
    this.removedMedia.update(s => new Set([...s, id]));
    this.consultApi.deleteMedia(visitId, id).subscribe({
      error: e => {
        const err = e as { status?: number; code?: string; message?: string };
        if (err?.status === 404 || /not found/i.test(err?.message ?? '')) return;
        this.removedMedia.update(s => { const n = new Set(s); n.delete(id); return n; });
        this.toast.error(err?.code === 'consult_completed' ? 'The consult is completed — its files can no longer be removed.' : (err?.message || 'Could not remove the file'));
      },
    });
  }
  uploadProcFiles(e: { key: string; procedureId: string; files: File[] }) {
    const visitId = this.ws()?.visit.id;
    if (!visitId) return;
    this.procUploading.update(m => ({ ...m, [e.key]: true }));
    let left = e.files.length;
    for (const f of e.files) {
      this.consultApi.uploadMedia(visitId, f, e.procedureId).subscribe({
        next: stored => this.procUploads.update(m => ({ ...m, [e.key]: [...(m[e.key] ?? []), { ...stored, procedureId: e.procedureId }] })),
        error: err => this.toast.error(err?.message || `Could not upload ${f.name}`),
        complete: () => { if (--left <= 0) this.procUploading.update(m => ({ ...m, [e.key]: false })); },
      });
    }
  }
  statusLabel(s: string) {
    return ({ booked: 'Booked', vitals: 'At vitals', waiting: 'Waiting', in_consult: 'In consult', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No show' } as Record<string, string>)[s] ?? s;
  }
  dxText(d: OpdDiagnosis[]) { return d.map(x => x.label).join(', '); }
  initials(name: string): string {
    return name.replace(/^(dr|mr|mrs|ms|master|baby)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  }
  spark(points: { value: number }[]) { return sparkPoints(points.map(p => p.value), 240, 64); }
  rxText(d: OpdRxLineDto) { const l = fromDto(d, this.drugList()); return `${l.drug.name} · ${rxSentence(l, this.visitDay()).text}`; }

  // ── Prefill review ─────────────────────────────────────────────────
  isPending(id: string) { return this.pending().some(p => p.id === id); }
  confirm(id: string) {
    this.confirmed.update(s => new Set([...s, id]));
    this.saveConfirmed();
  }
  confirmAll() {
    this.confirmed.update(s => new Set([...s, ...this.prefills().map(p => p.id)]));
    this.saveConfirmed();
  }
  editPrefill(p: Prefill) {
    this.confirm(p.id);
    this.goSpace('find');
    queueMicrotask(() => {
      const el = p.id === 'complaint' ? this.doc.getElementById('cw-complaint') : null;
      if (el) { el.scrollIntoView?.({ block: 'center' }); (el as HTMLInputElement).focus(); }
    });
  }
  onComplaint(v: string) {
    if (this.isPending('complaint')) this.confirm('complaint');
    this.patch({ chiefComplaint: v });
  }
  private readConfirmed(visitId: string): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(prefillKey(visitId)) || '[]') as string[]); } catch { return new Set(); }
  }
  private saveConfirmed() {
    const id = this.ws()?.visit.id;
    if (!id) return;
    try { localStorage.setItem(prefillKey(id), JSON.stringify([...this.confirmed()])); } catch { /* private mode */ }
  }

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
    this.addRx(lv.rx, new Date(lv.visitDate));
  }
  /** "Repeat this prescription today" from a past visit's record. */
  repeatRx(it: VisitItem) {
    if (!it.rx?.length || !this.editable()) return;
    this.addRx(it.rx, new Date(it.date + 'T00:00:00'));
  }
  private addRx(rx: OpdRxLineDto[], from: Date) {
    const have = new Set(this.st().lines.map(l => l.drug.id));
    const add = rx.map(d => fromDto({ ...d, id: undefined, ...FRESH_ACKS }, this.drugList())).filter(l => !have.has(l.drug.id));
    this.patch({ lines: [...this.st().lines, ...add] });
    this.toast.info(`Repeated ${add.length} medicine${add.length === 1 ? '' : 's'} from ${from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
    this.goSpace('med');
  }
  addFav(d: ConsultDrugRef) {
    const ed = this.rx();
    if (ed) { ed.addDrug(d); return; }
    const line = newRxLine(d.id, this.usuals()[d.id] ?? null);
    this.patch({ lines: [...this.st().lines, { key: 'fav' + Date.now(), drug: d, line } as ConsultRxLine] });
  }
  swapLine(key: string, alt: ConsultDrugRef) {
    const old = this.st().lines.find(l => l.key === key);
    if (!old) return;
    const line = newRxLine(alt.id, this.usuals()[alt.id] ?? null);
    this.patch({ lines: this.st().lines.map(l => (l.key === key ? { ...l, id: undefined, drug: alt, line, ...FRESH_ACKS } : l)) });
    this.toast.info(`${old.drug.name} swapped for ${alt.name}`);
  }
  seeLine() { this.goSpace('med'); }

  // ── Tests ──────────────────────────────────────────────────────────
  hasTest(id: string) { return this.st().tests.some(t => t.testId === id); }
  onTestKey(e: KeyboardEvent) {
    const hits = this.testHits();
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); this.testActive.set((this.testActive() + 1) % hits.length); }
    else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); this.testActive.set((this.testActive() - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const t = hits[this.testActive()];
      if (t) this.addTest({ testId: t.id, name: t.name, price: t.price });
    } else if (e.key === 'Escape') this.testQuery.set('');
  }
  addTest(t: ConsultInvestigationItem) {
    if (!this.hasTest(t.testId)) this.toggleTest(t);
    this.testQuery.set(''); this.testActive.set(0);
  }

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

  // ── The centre viewer + compare ────────────────────────────────────
  /** A record tile: in compare mode it joins / leaves the comparison; else it opens. */
  onTile(it: VisitItem) {
    if (this.compareOn() && it.compare) { this.toggleCompare(it); return; }
    this.openItem(it);
    this.patientOpen.set(false);
  }
  openRight() { this.patientOpen.set(true); }
  /** Outside tap / Esc / ×: closes the overlay — but not while comparing (keep tapping reports). */
  closeRight(force = false) {
    if (this.compareOn() && !force && !this.phone()) return;
    this.patientOpen.set(false);
  }
  toggleRightPin() { this.rightPinned.update(v => !v); this.patientOpen.set(false); this.savePin('Right', this.rightPinned()); }
  /** The band's "Patient" button: docked → nothing to open (it's there); else the panel toggles. */
  togglePatient() { if (this.rightDocked() && !this.phone()) return; this.findingsOpen.set(false); this.patientOpen.update(v => !v); }
  private pinKey(which: 'Right') { return `pf.opd.consult${which}Pin.${this.auth.user()?.id || 'anon'}`; }
  private savePin(which: 'Right', v: boolean) { try { localStorage.setItem(this.pinKey(which), v ? '1' : '0'); } catch { /* private mode */ } }
  /** Default: pinned on wide screens (the right column then fills the space
   *  beside the pad); the doctor's own unpin / pin is remembered. */
  private readPin(which: 'Right'): boolean {
    const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 1280px)').matches;
    try { const v = localStorage.getItem(this.pinKey(which)); return v == null ? wide : v === '1'; } catch { return wide; }
  }
  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.completeOpen()) return;
    if (this.presetsOpen()) { this.presetsOpen.set(false); return; }
    if (this.findingsOpen()) { this.findingsOpen.set(false); return; }
    if (this.patientOpen()) { this.closeRight(true); return; }
    if (this.compareOn()) this.leaveCompare();
  }
  /** Compare: straight into the side-by-side view (today's consult + the
   *  latest earlier one + anything already picked); pressing it again leaves. */
  toggleCompareMode() { if (this.compareOn()) this.leaveCompare(); else this.enterCompare(); }
  enterCompare() {
    this.activePreset.set(null);
    this.viewItem.set(null);
    const w = this.ws();
    if (w) {
      const have = new Set(this.compareIdList());
      const add: VisitItem[] = [];
      const today = this.consultItem(w.visit.id);
      if (today && !have.has(today.id)) add.push(today);
      const prev = [...(this.dock.history() ?? [])].filter(h => h.visitId !== w.visit.id).sort((a, b) => b.visitDate.localeCompare(a.visitDate))[0];
      const p = prev ? this.consultItem(prev.visitId) : null;
      if (p && !have.has(p.id)) add.push(p);
      if (add.length) this.compareItems.update(l => [...add, ...l]);
    }
    this.compareOn.set(true);
    queueMicrotask(() => this.syncCompareFiles());
  }
  /** A whole consult as a compare pick (today's draft or a past one). */
  private consultItem(visitId: string): VisitItem | null {
    const w = this.ws();
    if (!w) return null;
    if (visitId === w.visit.id) return { id: 'consult:' + visitId, consultId: visitId, type: 'flow', title: "Today's consult", sub: '', compare: true, date: this.todayKey() };
    const c = (this.dock.history() ?? []).find(h => h.visitId === visitId);
    return c ? { id: 'consult:' + visitId, consultId: visitId, type: 'flow', title: 'Consult', sub: c.doctorName ?? '', compare: true, date: journeyDayKey(c.visitDate) } : null;
  }
  /** A date tapped on the timeline while comparing: that day's consult joins / leaves. */
  onDockPick(day: string) {
    if (!this.compareOn()) return;
    const w = this.ws();
    if (!w) return;
    const visitId = day === this.todayKey() ? w.visit.id : (this.dock.history() ?? []).find(h => journeyDayKey(h.visitDate) === day && h.visitId !== w.visit.id)?.visitId;
    const it = visitId ? this.consultItem(visitId) : null;
    if (it) this.toggleCompare(it);
  }
  orderOf(id: string) { return this.compareIdList().indexOf(id) + 1; }
  unpick(id: string) { this.compareItems.update(l => l.filter(x => x.id !== id)); this.syncCompareFiles(); }
  unpickAll(items: VisitItem[]) { const ids = new Set(items.map(i => i.id)); this.compareItems.update(l => l.filter(x => !ids.has(x.id))); this.syncCompareFiles(); }
  openItem(it: VisitItem) {
    this.leaveCompare();
    this.viewItem.set(it);
    if (it.fileId) queueMicrotask(() => { const t = this.timelineItem(it); if (t) void this.tl()?.openSingle(t); });
  }
  closeViewer() { this.viewItem.set(null); this.leaveCompare(); }
  toggleCompare(it: VisitItem) {
    this.compareItems.update(l => (l.some(x => x.id === it.id) ? l.filter(x => x.id !== it.id) : [...l, it]));
    if (this.compareOn()) this.syncCompareFiles();
  }
  clearCompare() { this.compareItems.set([]); this.activePreset.set(null); this.syncCompareFiles(); }
  private leaveCompare() {
    if (!this.compareOn()) return;
    this.compareOn.set(false);
    const tl = this.tl();
    if (tl?.compareMode()) tl.toggleCompare();
  }
  private syncCompareFiles() {
    const tl = this.tl();
    if (!tl) return;
    const files = this.compareItems().map(i => this.timelineItem(i)).filter((x): x is TimelineItem => !!x);
    tl.setPicked(files);
  }
  /** A left-card record → the journey viewer's item (report / image / doc). */
  private timelineItem(it: VisitItem): TimelineItem | null {
    const tl = this.tl();
    if (!tl || !it.fileId) return null;
    for (const v of tl.visits()) {
      if (it.fileId.startsWith('rep:')) {
        const o = v.orders.find(x => 'rep:' + x.id === it.fileId);
        const rep = o ? tl.reportFor(o.id) : null;
        if (o && rep) return { id: 'rep:' + o.id, kind: 'report', name: tl.orderPanelName(o), date: v.date, report: rep, order: o };
      } else {
        const d = v.docs.find(x => 'doc:' + x.id === it.fileId);
        if (d) return { id: 'doc:' + d.id, kind: d.isImage ? 'image' : 'doc', name: d.fileName, date: v.date, url: d.url };
      }
    }
    return null;
  }

  // ── Complete ───────────────────────────────────────────────────────
  /** Complete: a changed procedure price needs its reason first; unreviewed
   *  prefills WARN once ("Review now" / "Complete anyway") — never block. */
  async openComplete() {
    if (!this.editable()) return;
    const canChange = !!this.ws()?.procedurePricing?.doctorCanChange;
    const noReason = canChange ? (this.st().procedures ?? []).find(p => needsPriceReason(p)) : undefined;
    if (noReason) {
      this.reasonErr.set(true);
      this.goSpace('proc');
      this.toast.error(`${noReason.name}: give a reason for the price change.`);
      return;
    }
    const pend = this.pending();
    if (pend.length && !this.prefillWarned) {
      this.prefillWarned = true;
      const go = await this.dialog.confirm({
        title: `${pend.length} prefill${pend.length === 1 ? '' : 's'} not reviewed`,
        message: `${pend.map(p => p.label).join(', ')} came from the desk or the patient and ${pend.length === 1 ? "hasn't" : "haven't"} been checked.`,
        confirmLabel: 'Complete anyway', cancelLabel: 'Review now',
      });
      if (!go) { this.goSpace('find'); return; }
    }
    this.completeOpen.set(true);
  }
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
      this.goSpace('test');
      this.toast.error(`Choose the specimen for: ${noSpecimen.join(', ')}.`);
      return;
    }
    this.completing.set(true);
    this.consultApi.complete(w.visit.id, draftBody(this.st(), this.followUpIso(), this.visitDay(), this.bodyOpts())).subscribe({
      next: done => {
        this.completing.set(false);
        this.completeOpen.set(false);
        const procs = this.st().procedures ?? [];
        const nRx = this.st().lines.length, nT = this.st().tests.length;
        const nNow = procs.filter(p => p.when !== 'later').length, nLater = procs.filter(p => p.when === 'later').length;
        this.hydrate(done);
        this.toast.success(['Consult completed', nRx ? `${nRx} medicine${nRx === 1 ? '' : 's'} to pharmacy` : '', nT ? `${nT} test${nT === 1 ? '' : 's'} to the lab` : '',
          nNow ? `${nNow} procedure${nNow === 1 ? '' : 's'} to the front desk` : '', nLater ? `${nLater} procedure${nLater === 1 ? '' : 's'} to book` : ''].filter(Boolean).join(' · '));
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

  // ── Print / share / preview ────────────────────────────────────────
  private async pdfBlob(): Promise<Blob | null> {
    const w = this.ws();
    if (!w) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tpl: any = null;
    try { tpl = await new Promise(res => this.api.get('/api/config/invoice-template').subscribe({ next: res, error: () => res(null) })); } catch { tpl = null; }
    const v = w.vitals;
    const vit = v ? [v.pulse ? `Pulse ${v.pulse}` : '', v.bpSys ? `BP ${v.bpSys}/${v.bpDia ?? ''}` : '', v.tempF ? `Temp ${v.tempF} F` : '',
      v.spo2 ? `SpO2 ${v.spo2}%` : '', v.weightKg ? `Wt ${v.weightKg} kg` : '', bmiOf(v) ? `BMI ${bmiOf(v)}` : ''].filter(Boolean).join(' · ') : null;
    const fuIso = this.followUpIso() ?? w.consult?.followUpDate ?? null;
    const fu = fuIso ? new Date(fuIso.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
    const user = this.auth.user();
    const doc = buildRxPdf({
      practice: { name: tpl?.labName || user?.tenantName, address: tpl?.address, phone: tpl?.phone, email: tpl?.email },
      patient: { name: w.patient.name, ageSex: [w.patient.ageDisplay, w.patient.sex].filter(Boolean).join(' '), mrn: w.patient.mrn, phone: w.patient.phone },
      doctor: { name: w.visit.doctorName, department: w.visit.departmentName, regNo: w.visit.doctorUserId === user?.id ? user?.registrationId : null },
      visit: { date: this.visitDay(), tokenLabel: w.visit.tokenLabel, visitNumber: w.visit.visitNumber },
      vitals: vit, chiefComplaint: this.st().chiefComplaint, diagnoses: this.st().diagnoses,
      lines: this.st().lines, tests: this.st().tests, advice: this.st().advice, followUp: fu,
      procedures: (this.st().procedures ?? []).map(p => ({ name: p.name, side: p.side ?? null, qty: p.qty, note: p.note ?? null, when: p.when, preferredWithin: p.preferredWithin ?? null, prepNote: p.prepNote ?? null })),
    });
    return doc.output('blob');
  }
  async print() {
    const blob = await this.pdfBlob();
    if (blob) printPdfBlobUrl(URL.createObjectURL(blob), { revokeOnDone: true });
  }
  /** "Preview prescription": the slip as it will print, in a new tab. */
  async preview() {
    const blob = await this.pdfBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
export function dayKeyOf(iso: string): string { return journeyDayKey(iso); }

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
