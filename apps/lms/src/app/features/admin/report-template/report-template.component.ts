import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { normalizeHeaderPreset, ReportTemplate } from '../../../shared/models/report.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ReportColumn } from '../../../shared/models/report-layout.model';
import { ResolvedReportLayout } from '../../../shared/models/report-layout.model';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ReportColumnsEditorComponent } from './report-columns-editor.component';
import { ReportSequencingEditorComponent } from './report-sequencing-editor.component';
import { lastReportSqueeze, preloadReportImages, renderReportPdfBlobUrl } from '../../../shared/utils/report-pdf';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PlatformService } from '../../../core/services/platform.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ReportHeaderEditorComponent } from './report-header-editor.component';
import { DialogService } from '../../../core/services/dialog.service';
import { readReportOption, writeReportOption } from '../../../shared/utils/report-header-layout';
import { readReportStyle, writeReportStyle, type ReportStylePatch } from '../../../shared/utils/report-style';
import { squeezeMessage, type SqueezeReport } from '../../../shared/utils/report-density';
import {
  AGE_STYLE_CHOICES, LABEL_JOINER_CHOICES, PATIENT_LABELS, RENAMEABLE_LABEL_KEYS, ageSexText, ageText, miniStripText, patientLabel, sexText, swapAgeSexColumns,
} from '../../../shared/utils/report-patient-text';
import { reportIssues, type ReportIssues } from '../../../shared/utils/report-issues';
import { ReportStyleCardsComponent } from './report-style-cards.component';
import { applyStylePreset, detectPreset, type PresetId } from '../../../shared/utils/report-presets';
import { paletteById, paletteColumns, type PaletteColors, type PaletteId } from '../../../shared/utils/report-palettes';
import { readReportTheme, REPORT_THEME_OPTIONS, ReportThemeId, writeReportTheme } from '../../../shared/utils/report-theme';
import { INTER_DIR, INTER_FACES, SOURCE_SANS_DIR, SOURCE_SANS_FACES } from '../../../shared/utils/report-fonts';
import { ORDER_QR_KEY, PROFILE_QR_KEY } from '../../../shared/utils/patient-strip-qr';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonCardComponent, SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';

/** More sample tests so the live preview runs to three pages. */
const previewTest = (testId: string, name: string, rows: Array<[string, string, string, string]>) => ({
  testId, name, department: 'Biochemistry', departmentCode: 'BIO', sampleType: 'Serum', method: 'Photometry',
  result: { values: Object.fromEntries(rows.map(([n, value, unit, range]) => [n, { value, unit, range }])) },
});
const PREVIEW_EXTRA_TESTS = [
  previewTest('x1', 'Liver Function Test', [
    ['Total Bilirubin', '0.8', 'mg/dL', '0.3 – 1.2'], ['Direct Bilirubin', '0.2', 'mg/dL', '0.0 – 0.3'], ['SGOT (AST)', '28', 'U/L', '5 – 40'],
    ['SGPT (ALT)', '31', 'U/L', '5 – 45'], ['Alkaline Phosphatase', '96', 'U/L', '40 – 129'], ['Total Protein', '7.1', 'g/dL', '6.0 – 8.3'],
    ['Albumin', '4.2', 'g/dL', '3.5 – 5.2'], ['Globulin', '2.9', 'g/dL', '2.0 – 3.5'], ['GGT', '24', 'U/L', '8 – 61'],
  ]),
  previewTest('x2', 'Kidney Function Test', [
    ['Urea', '28', 'mg/dL', '15 – 40'], ['Creatinine', '0.8', 'mg/dL', '0.6 – 1.1'], ['Uric Acid', '4.6', 'mg/dL', '2.4 – 5.7'],
    ['Sodium', '139', 'mmol/L', '135 – 145'], ['Potassium', '4.2', 'mmol/L', '3.5 – 5.1'], ['Chloride', '102', 'mmol/L', '98 – 107'],
    ['Calcium', '9.4', 'mg/dL', '8.6 – 10.2'], ['Phosphorus', '3.5', 'mg/dL', '2.5 – 4.5'],
  ]),
  previewTest('x3', 'Iron Studies', [
    ['Serum Iron', '84', 'µg/dL', '60 – 170'], ['TIBC', '310', 'µg/dL', '250 – 450'], ['Transferrin Saturation', '27', '%', '20 – 50'], ['Ferritin', '62', 'ng/mL', '13 – 150'],
  ]),
  previewTest('x4', 'Thyroid Profile', [
    ['T3', '1.2', 'ng/mL', '0.8 – 2.0'], ['T4', '8.4', 'µg/dL', '5.1 – 14.1'], ['TSH', '2.6', 'µIU/mL', '0.27 – 4.20'],
  ]),
  previewTest('x5', 'Vitamin B12', [['Vitamin B12', '412', 'pg/mL', '211 – 911']]),
  previewTest('x6', 'HbA1c', [['HbA1c', '5.6', '%', '4.0 – 5.6'], ['Estimated Average Glucose', '114', 'mg/dL', '< 117']]),
];

type Tab = 'letterhead' | 'patient' | 'table' | 'columns' | 'sequence' | 'footer';

/** Admin editor for the per-tenant ReportTemplateEntity. Seven tabs:
 *  Identity / Header & Logo / Theme / Patient / Date & Time / Columns /
 *  Sign-off & Footer. The right-hand pane renders a live PDF preview
 *  (debounced 300ms after each edit) using the same generateReportPdf
 *  code path real reports use — so what admins see is what patients get. */
@Component({
  selector: 'pf-report-template',
  standalone: true,
  imports: [ReportStyleCardsComponent, SkeletonCardComponent, SkeletonFormComponent, BusyDirective, 
    FormsModule,
    DragDropModule,
    SegmentedComponent,
    SelectComponent,
    TouchButtonComponent,
    ReportColumnsEditorComponent,
    ReportSequencingEditorComponent,
    HeroBandComponent,
    ReportHeaderEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-6 lg:px-8 pt-3 pb-10 pf-rt-page">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): the report's sections are the pill's tabs (tabs-only
             pill — the page has nothing to search); Save rides the band. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="sectionOptions"
                          [value]="tab()" (valueChange)="setTab($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            @if (issues().count > 0) {
              <button type="button" class="pf-rt-issues press" (click)="openIssues()"
                      [attr.aria-label]="issuesLabel()" [title]="issuesTitle()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                <span class="pf-rt-issues__t">{{ issuesLabel() }}</span>
              </button>
            }
            <span class="pf-savestate pf-rt-savestate" role="status" aria-live="polite">
              @if (dirty()) {
                <span class="pf-savestate__dot" aria-hidden="true"></span><span class="pf-rt-savestate__t">Unsaved changes</span>
              } @else {
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span class="pf-rt-savestate__t">All changes saved</span>
              }
            </span>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press"
                    [disabled]="saving() || tplSkeleton()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()" aria-label="Save template" title="Save template">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>
              </svg>
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <header class="pf-rt-head pf-classic-only">
        <div class="min-w-0">
          <h1 class="pf-rt-title">Report designer</h1>
          <p class="pf-rt-sub">How every printed report looks — edit on the left, watch the page on the right.</p>
        </div>
        @if (issues().count > 0) {
          <button type="button" class="pf-rt-issues press" (click)="openIssues()"
                  [attr.aria-label]="issuesLabel()" [title]="issuesTitle()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            <span class="pf-rt-issues__t">{{ issuesLabel() }}</span>
          </button>
        }
        <span class="pf-savestate pf-rt-savestate" role="status" aria-live="polite">
          @if (dirty()) { <span class="pf-savestate__dot" aria-hidden="true"></span>Unsaved changes } @else { All changes saved }
        </span>
        <pf-touch-btn size="sm" variant="primary" (pressed)="save()" [disabled]="saving() || tplSkeleton()" [busy]="saving()" busyLabel="Saving…">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </header>

      <div class="pf-band-body pf-band-body--fill">
      @if (tplSkeleton()) {
        <!-- First load: the designer's shape until the lab's template lands
             (never the defaults flashing before the saved template). -->
        <div class="pf-rt-loading">
          <section class="pf-card"><div class="pf-card__body"><pf-skeleton-form [fields]="8" [cols]="2" label="Loading report template…"></pf-skeleton-form></div></section>
          <section class="pf-card"><div class="pf-card__body"><pf-skeleton-card [lines]="8" [boxed]="false" label="Loading preview…"></pf-skeleton-card></div></section>
        </div>
      } @else {
      <div class="pf-rt-grid" [class.pf-rt-grid--norail]="railHidden() || theme.isNewDesign()"
           [class.pf-rt-grid--designer]="designerTab()">
        <!-- ── Section rail (CLASSIC only): the new design puts the
             sections in the band pill, so the rail is gone and the editor +
             preview get the full width. ── -->
        @if (!theme.isNewDesign()) {
        <nav class="pf-rt-rail" aria-label="Report template sections">
          <div class="pf-rt-rail__head">
            <span>Sections</span>
            <button type="button" class="pf-rt-side-toggle" (click)="toggleRail()"
                    title="Collapse panel" aria-label="Collapse section panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
          @for (sec of sections; track sec.value) {
            <button type="button" class="pf-rt-rail__item press"
                    [class.pf-rt-rail__item--on]="tab() === sec.value"
                    (click)="setTab(sec.value)" [title]="sec.desc">
              <span class="pf-rt-rail__txt">{{ sec.label }}</span>
            </button>
          }
        </nav>
        }

        @if (designerTab()) {
          <!-- ── Letterhead / Footer: the page IS the editor (WYSIWYG). ── -->
          <pf-report-header-editor class="pf-rt-designer"
            [template]="tpl()" [region]="tab() === 'footer' ? 'footer' : 'header'"
            [pdfUrl]="rawPreviewUrl()" [imageCache]="imageCache()" [rendering]="rendering()"
            [canUndo]="canUndo()" [canRedo]="canRedo()"
            (patch)="patch($event)" (undo)="undo()" (redo)="redo()"></pf-report-header-editor>
        } @else {
        <!-- ── Focused section panel. ── -->
        <div class="pf-rt-work">
          @if (!theme.isNewDesign()) {
            @if (railHidden()) {
              <button type="button" class="pf-rt-side-expand" (click)="toggleRail()"
                      title="Show sections" aria-label="Show section panel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                Sections
              </button>
            }
            @if (activeSection(); as sec) {
              <div class="pf-rt-work__hdr">
                <h2 class="pf-rt-work__title">{{ sec.label }}</h2>
                <p class="pf-rt-work__sub">{{ sec.desc }}</p>
              </div>
            }
          }
          @switch (tab()) {

            <!-- ══ PATIENT STRIP ══ -->
            @case ('patient') {
              <div class="pf-rt-flat">
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Who is this strip for?</h4>
                  <p class="pf-rtb-s">Default prints on every report. A department's own arrangement prints when a report holds ONLY that department's tests — e.g. Microbiology showing just name, age and sex.</p>
                  <div class="pf-pt-scope">
                    <div class="pf-pt-scope__sel">
                      <pf-select [options]="$any(patientScopeOptions())" [value]="patientScope()"
                                 (valueChange)="onPatientScopeChange($any($event))"></pf-select>
                    </div>
                    @if (patientScope() !== 'default') {
                      @if (deptPatientConfigured()) { <span class="pf-pt-chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Configured</span> }
                      <button type="button" class="pf-btn pf-btn--tertiary pf-pt-btn press"
                              [disabled]="!deptPatientConfigured()"
                              (click)="resetDeptPatient()">Reset to default</button>
                      <!-- Secondary: the band's Save owns the ONE primary. -->
                      <button type="button" class="pf-btn pf-btn--secondary pf-pt-btn press"
                              [disabled]="!deptPatientDirty() || deptPatientSaving()" [pfBusy]="deptPatientSaving()" pfBusyLabel="Saving…"
                              (click)="saveDeptPatient()">{{ deptPatientSaving() ? 'Saving…' : 'Save for department' }}</button>
                    }
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Patient block</h4>
                  <p class="pf-rtb-s">Choose the layout, then drag fields between the columns — exactly how they print in the report's patient strip.</p>
                <div class="space-y-3">
                  <div>
                    <label class="pf-label">Patient block layout</label>
                    <pf-segmented
                      [options]="patientLayoutOptions"
                      [value]="patientLayoutValue()"
                      size="md"
                      (valueChange)="setPatientLayout($event)">
                    </pf-segmented>
                  </div>

                </div>
                </div>


                <div class="pf-rtb" id="pf-long-text">
                  <h4 class="pf-rtb-h">Long text</h4>
                  <p class="pf-rtb-s">A long patient, doctor or hospital name wraps onto a second line instead of running into the next field. If it is still too long it gets a little smaller, never below the size you choose. Names are never cut off. The block grows and the results move down to make room.</p>
                  <div class="pf-sqr">
                    <div class="pf-sqr__row">
                      <span class="pf-sqr__ic" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>
                      </span>
                      <span class="pf-sqr__txt">
                        <span class="pf-sqr__label">Fit long text</span>
                        <span class="pf-sqr__desc">
                          @if (fitOn()) { Long names wrap or shrink to fit. }
                          @else if (issues().count > 0) { Off. With long names, {{ issues().count }} {{ issues().count === 1 ? 'place' : 'places' }} on your report can overlap. }
                          @else { Off. Long names print as they always did. }
                        </span>
                      </span>
                      <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [attr.aria-checked]="fitOn()"
                              aria-label="Fit long text" (click)="setFit({ enabled: !fitOn() })">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    </div>
                    @if (fitOn()) {
                      <div class="pf-sqr__row">
                        <span class="pf-sqr__txt">
                          <span class="pf-sqr__label">Smallest size</span>
                          <span class="pf-sqr__desc">Text never goes below this.</span>
                        </span>
                        <div class="pf-lt-size">
                          <pf-select [options]="$any(minPtOptions)" [value]="'' + reportStyle().fit.minPt"
                                     (valueChange)="setMinPt($any($event))"></pf-select>
                        </div>
                      </div>
                    }
                  </div>
                  @if (issues().count > 0 && !fitOn()) {
                    <ul class="pf-lt-issues" aria-label="Where long names overlap">
                      @for (l of issues().lines; track l) { <li>{{ l }}</li> }
                    </ul>
                  }
                </div>

                <div class="pf-rtb" id="pf-age-sex">
                  <h4 class="pf-rtb-h">Age &amp; sex</h4>
                  <p class="pf-rtb-s">Print age and sex as one field, like “45 Y / Male”, or on their own lines. Only the wording changes, never the patient’s details.</p>
                  <div class="space-y-3">
                    <div>
                      <label class="pf-label">Show as</label>
                      <pf-segmented [options]="ageSexModeOptions" [value]="reportStyle().patient.ageSex" size="md"
                                    (valueChange)="setAgeSex($event)"></pf-segmented>
                    </div>
                    <div class="pf-ps-grid">
                      <div>
                        <label class="pf-label">Age</label>
                        <pf-select [options]="$any(ageStyleOptions)" [value]="reportStyle().patient.ageStyle"
                                   (valueChange)="setPatientStyle({ ageStyle: $any($event) })"></pf-select>
                      </div>
                      <div>
                        <label class="pf-label">Sex</label>
                        <pf-segmented [options]="sexStyleOptions" [value]="reportStyle().patient.sexStyle" size="md"
                                      (valueChange)="setPatientStyle({ sexStyle: $any($event) })"></pf-segmented>
                      </div>
                      @if (reportStyle().patient.ageSex === 'combined') {
                        <div>
                          <label class="pf-label">Between age and sex</label>
                          <pf-select [options]="$any(joinerOptions)" [value]="reportStyle().patient.joiner"
                                     (valueChange)="setPatientStyle({ joiner: $any($event) })"></pf-select>
                        </div>
                      }
                    </div>
                    <div class="pf-ps-sample" role="status" aria-live="polite">
                      <span class="pf-ps-sample__k">Prints as</span>
                      <span class="pf-ps-sample__v">{{ ageSexSample() }}</span>
                    </div>
                  </div>
                </div>

                <div class="pf-rtb" id="pf-field-names">
                  <h4 class="pf-rtb-h">Field names</h4>
                  <p class="pf-rtb-s">Rename a field in the strip, for example Order to Lab No. or MRN to UHID. Clear the box to go back to the usual name.</p>
                  <div class="space-y-3">
                    <div class="pf-ps-rename">
                      <div class="pf-ps-rename__f">
                        <label class="pf-label">Field</label>
                        <pf-select [options]="$any(labelFieldOptions())" [value]="labelField()"
                                   (valueChange)="labelField.set($any($event))"></pf-select>
                      </div>
                      <div class="pf-ps-rename__i">
                        <label class="pf-label" for="pf-label-input">Printed as</label>
                        <input id="pf-label-input" class="pf-input" type="text" maxlength="40"
                               [placeholder]="defaultLabelText(labelField())" [value]="labelValue()"
                               (input)="setLabel(labelField(), $any($event.target).value)" />
                      </div>
                    </div>
                    <div>
                      <label class="pf-label">Between the name and the value</label>
                      <pf-select [options]="$any(labelJoinerOptions)" [value]="reportStyle().patient.labelJoiner"
                                 (valueChange)="setPatientStyle({ labelJoiner: $any($event) })"></pf-select>
                    </div>
                    @if (renamedLabels().length) {
                      <ul class="pf-ps-chips" aria-label="Renamed fields">
                        @for (r of renamedLabels(); track r.key) {
                          <li class="pf-ps-chip">
                            <span class="pf-ps-chip__t"><span>{{ r.was }}</span><span aria-hidden="true">&rarr;</span><span class="pf-sr">printed as</span><strong>{{ r.now }}</strong></span>
                            <button type="button" class="pf-ps-chip__x press" [attr.aria-label]="'Use the usual name for ' + r.was" (click)="setLabel(r.key, '')">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
                            </button>
                          </li>
                        }
                      </ul>
                    }
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Frame</h4>
                  <p class="pf-rtb-s">How the strip is set off from the results.</p>
                  <pf-segmented [options]="frameOptions" [value]="reportStyle().patient.frame" size="md"
                                (valueChange)="setPatientStyle({ frame: $any($event) })"></pf-segmented>
                </div>

                <div class="pf-rtb" id="pf-every-page">
                  <h4 class="pf-rtb-h">Every page</h4>
                  <p class="pf-rtb-s">So a loose page can always be matched to its patient and a missing page is easy to spot.</p>
                  <div class="pf-sqr">
                    <div class="pf-sqr__row">
                      <span class="pf-sqr__ic" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8"/><path d="M8 12h8M8 16h5"/></svg>
                      </span>
                      <span class="pf-sqr__txt">
                        <span class="pf-sqr__label">Patient line on pages 2, 3 and on</span>
                        <span class="pf-sqr__desc">{{ continuationSample() }}</span>
                      </span>
                      <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [attr.aria-checked]="reportStyle().patient.continuation !== 'none'"
                              aria-label="Patient line on every page after the first"
                              (click)="setPatientStyle({ continuation: reportStyle().patient.continuation === 'none' ? 'mini' : 'none' })">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    </div>
                    <div class="pf-sqr__row">
                      <span class="pf-sqr__ic" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>
                      </span>
                      <span class="pf-sqr__txt">
                        <span class="pf-sqr__label">Page N of M</span>
                        <span class="pf-sqr__desc">{{ reportStyle().pageNumbers === 'n-of-m' ? 'The footer prints “Page 2 of 3”.' : 'The footer prints just the page number.' }}</span>
                      </span>
                      <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [attr.aria-checked]="reportStyle().pageNumbers === 'n-of-m'"
                              aria-label="Page N of M" (click)="setPageNumbers(reportStyle().pageNumbers !== 'n-of-m')">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    </div>
                    <div class="pf-sqr__row">
                      <span class="pf-sqr__ic" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
                      </span>
                      <span class="pf-sqr__txt">
                        <span class="pf-sqr__label">Report status</span>
                        <span class="pf-sqr__desc">Print “Final” or “Preliminary” in the strip.</span>
                      </span>
                      <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [attr.aria-checked]="reportStyle().patient.showReportStatus"
                              aria-label="Report status" (click)="setPatientStyle({ showReportStatus: !reportStyle().patient.showReportStatus })">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    </div>
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">QR codes</h4>
                  <p class="pf-rtb-s">Print QR codes in the patient strip. Each switch adds its code to the arrangement below — drag it to move it.</p>
                  <div class="pf-sqr">
                    @for (q of stripQrOptions; track q.key) {
                      <div class="pf-sqr__row">
                        <span class="pf-sqr__ic" aria-hidden="true">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-4M14 18v3"/></svg>
                        </span>
                        <span class="pf-sqr__txt">
                          <span class="pf-sqr__label">{{ q.label }}</span>
                          <span class="pf-sqr__desc">{{ q.desc }}</span>
                        </span>
                        <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [attr.aria-checked]="stripQrOn(q.key)"
                                [attr.aria-label]="q.label" (click)="toggleStripQr(q.key)">
                          <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                        </button>
                      </div>
                    }
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Date &amp; time format</h4>
                  <p class="pf-rtb-s">The date fields print inside the patient block using this format.
                    @if (patientScope() !== 'default') { <strong>Shared across departments — edits here change the Default.</strong> }
                  </p>
                  <div class="pf-rt-datesgrid">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label class="pf-label">Date format</label>
                      <pf-select [options]="$any(dateFormatOptions)" [value]="dateFormatValue()"
                                 (valueChange)="patch({ dateFormat: $any($event) })"></pf-select>
                    </div>
                    <div>
                      <label class="pf-label">Time format</label>
                      <pf-segmented [options]="timeFormatOptions" [value]="tpl().timeFormat ?? '12h'" size="sm"
                                    (valueChange)="patch({ timeFormat: $event })"></pf-segmented>
                    </div>
                  </div>
                  <div>
                    <label class="pf-label">Joiner between date and time</label>
                    <pf-select [options]="$any(separatorOptions)" [value]="separatorValue()"
                               (valueChange)="patch({ dateTimeSeparator: $any($event) })"></pf-select>
                  </div>

                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Arrange the fields</h4>
                  <p class="pf-rtb-s">
                    Drag a field <strong>into a column</strong> to print it (placement &amp; order = how it prints); drag it to <strong>Unused</strong> to hide it. The layout above sets the number of columns.</p>
                  <div cdkDropListGroup>
                    <div class="pf-pcols" [style.grid-template-columns]="'repeat(' + patientCols().length + ', minmax(0, 1fr))'">
                      @for (col of patientCols(); track $index; let i = $index) {
                        <div class="pf-pcol">
                          <span class="pf-pcol-h">Column {{ i + 1 }}</span>
                          <div class="pf-pcol-drop" cdkDropList [id]="'pcol-' + i"
                               [cdkDropListData]="col"
                               (cdkDropListDropped)="dropPatientItem($event)">
                            @for (k of col; track k) {
                              <div class="pf-pchip" cdkDrag>
                                <svg class="pf-pchip-grip" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/></svg>{{ patientItemLabel(k) }}
                              </div>
                            }
                            @if (col.length === 0) { <span class="pf-pcol-empty">Drop here</span> }
                          </div>
                        </div>
                      }
                    </div>
                    <p class="text-[11px] mt-3 mb-1" style="color: var(--text-muted);">Unused — not printed</p>
                    <div class="pf-ppool" cdkDropList id="pcol-pool" [cdkDropListData]="patientPool()"
                         (cdkDropListDropped)="dropPatientItem($event)">
                      @for (k of patientPool(); track k) {
                        <div class="pf-pchip pf-pchip--pool" cdkDrag>
                          <svg class="pf-pchip-grip" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/></svg>{{ patientItemLabel(k) }}
                        </div>
                      }
                      @if (patientPool().length === 0) { <span class="pf-pcol-empty">All fields are in columns — drag one here to hide it.</span> }
                    </div>
                  </div>
                </div>
              </div>
            }

            <!-- ══ RESULTS TABLE — style ══ -->
            @case ('table') {
              <div class="pf-rt-flat">
                <pf-report-style-cards [tpl]="tpl()" [applied]="appliedBanner()"
                  (preset)="applyPreset($event)" (palette)="applyPalette($event)" (custom)="applyCustomColors($event)"
                  (printSafeChange)="setPrintSafe($event)" (undo)="undo()"></pf-report-style-cards>
                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Report theme</h4>
                  <p class="pf-rtb-s">The typeface and size scale of the whole report — letterhead, patient strip, results, sign-off and footer. Colours stay yours.</p>
                  <div class="pf-rtheme" role="radiogroup" aria-label="Report theme">
                    @for (o of reportThemeOptions; track o.value) {
                      <button type="button" class="pf-rtheme__card press" role="radio"
                              [attr.aria-checked]="reportTheme() === o.value" (click)="setReportTheme(o.value)">
                        <span class="pf-rtheme__spec" aria-hidden="true"
                              [style.fontFamily]="themeSpecimenCss(o.value)">
                          <span class="pf-rtheme__lab" [style.fontWeight]="700">LAB NAME</span>
                          <span class="pf-rtheme__dept" [style.fontWeight]="700">HAEMATOLOGY</span>
                          <span class="pf-rtheme__row">
                            <span [style.fontWeight]="o.value !== 'classic' ? 600 : 700">Haemoglobin</span>
                            <span [style.fontWeight]="o.value !== 'classic' ? 600 : 400">13.8</span>
                            <span class="pf-rtheme__dim">13.0 – 17.0</span>
                          </span>
                          <span class="pf-rtheme__row">
                            <span [style.fontWeight]="o.value !== 'classic' ? 600 : 700">MCV</span>
                            <span [style.fontWeight]="700">101.7 H</span>
                            <span class="pf-rtheme__dim">83 – 101</span>
                          </span>
                        </span>
                        <span class="pf-rtheme__name">{{ o.label }}</span>
                        <span class="pf-rtheme__desc">{{ o.desc }}</span>
                      </button>
                    }
                  </div>
                </div>

                <div class="pf-rtb" id="pf-density">
                  <h4 class="pf-rtb-h">Page density</h4>
                  <p class="pf-rtb-s">Compact tightens the rows, prints each Method and Specimen beside its test name, and slims the department headings, so a long report takes fewer pages. Results keep their size.</p>
                  <div>
                    <label class="pf-label">Density</label>
                    <pf-segmented [options]="densityOptions" [value]="reportStyle().density === 'compact' ? 'compact' : 'normal'" size="md"
                                  (valueChange)="setDensity($event)"></pf-segmented>
                  </div>
                  <div class="pf-sqr pf-rt-after">
                    <div class="pf-sqr__row">
                      <span class="pf-sqr__ic" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v7"/><path d="M9 7l3 3 3-3"/><path d="M12 21v-7"/><path d="M9 17l3-3 3 3"/><path d="M4 12h16"/></svg>
                      </span>
                      <span class="pf-sqr__txt">
                        <span class="pf-sqr__label">Squeeze onto one page</span>
                        <span class="pf-sqr__desc">
                          @if (!reportStyle().squeeze) { Off. A report that runs a few lines onto a second page prints on two pages. }
                          @else { When a report runs only a little over (up to 12% of a page), it prints Compact, then a touch smaller, so it fits one page less. Results never go below your smallest size. }
                        </span>
                        @if (reportStyle().squeeze && squeezeNote(); as note) { <span class="pf-sqr__note" role="status">{{ note }}</span> }
                      </span>
                      <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [attr.aria-checked]="reportStyle().squeeze"
                              aria-label="Squeeze onto one page" (click)="setSqueeze(!reportStyle().squeeze)">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    </div>
                    <div class="pf-sqr__row">
                      <span class="pf-sqr__txt">
                        <span class="pf-sqr__label">Widen the name column</span>
                        <span class="pf-sqr__desc">
                          @if (fitOn()) { In the results table, give long test names more room and keep each result on one line. }
                          @else { Needs “Fit long text” on the Patient strip tab. }
                        </span>
                      </span>
                      <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [disabled]="!fitOn()"
                              [attr.aria-checked]="fitOn() && reportStyle().fit.autoColumns"
                              aria-label="Widen the name column" (click)="setFit({ autoColumns: !reportStyle().fit.autoColumns })">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    </div>
                  </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Table colours</h4>
                  <p class="pf-rtb-s">Header row, body text and hairlines of the results table.</p>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                  @for (c of tableColorFields; track c.key) {
                    <div>
                      <label class="pf-label">{{ c.label }}</label>
                      <label class="pf-color-field">
                        <input type="color"
                               [ngModel]="colorOf(c.key) || c.fallback"
                               (ngModelChange)="patchKey(c.key, $event)" />
                        <span class="pf-color-field__hex">{{ colorOf(c.key) || c.fallback }}</span>
                      </label>
                    </div>
                  }
                </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Typography &amp; table</h4>
                  <p class="pf-rtb-s">Font, table lines and department behaviour.</p>
                @if (reportTheme() !== 'classic') {
                  <p class="pf-rtb-s pf-rtheme__note">Font family and size are set by the {{ reportThemeLabel() }} theme — switch to Classic to choose them.</p>
                }
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div [class.pf-rtheme__off]="reportTheme() !== 'classic'" [attr.inert]="reportTheme() !== 'classic' ? '' : null">
                    <label class="pf-label">Font family</label>
                    <div class="pf-wys-fonts">
                      @for (o of fontOptions; track o.value) {
                        <button type="button" class="pf-wys-font press"
                                [attr.aria-pressed]="(tpl().fontFamily ?? 'helvetica') === o.value"
                                [style.fontFamily]="fontCss($any(o.value))"
                                (click)="patch({ fontFamily: $any(o.value) })">
                          <span class="pf-wys-font__sample">AaBb123</span>
                          <span class="pf-wys-font__name">{{ o.label }}</span>
                        </button>
                      }
                    </div>
                  </div>
                  <div [class.pf-rtheme__off]="reportTheme() !== 'classic'" [attr.inert]="reportTheme() !== 'classic' ? '' : null">
                    <label class="pf-label">Font size</label>
                    <pf-segmented
                      [options]="sizeOptions"
                      [value]="tpl().fontSize ?? 'md'"
                      size="sm"
                      (valueChange)="patch({ fontSize: $event })">
                    </pf-segmented>
                  </div>
                  <div>
                    <label class="pf-label">Table style</label>
                    <div class="pf-wys-thumbs">
                      @for (o of tableStyleOptions; track o.value) {
                        <button type="button" class="pf-wys-thumb press"
                                [attr.aria-pressed]="(tpl().tableStyle ?? 'plain') === o.value"
                                (click)="patch({ tableStyle: $any(o.value) })">
                          <span class="pf-wys-mini" [class]="'pf-wys-mini--' + o.value">
                            <i></i><i></i><i></i><i></i>
                          </span>
                          <span class="pf-wys-thumb__name">{{ o.label }}</span>
                        </button>
                      }
                    </div>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Zebra rows</span>
                    <button type="button" class="pf-toggle pf-rt-sw" role="switch" [attr.aria-checked]="!!(tpl().zebraRows ?? false)"
                            aria-label="Zebra rows" (click)="patch({ zebraRows: !(tpl().zebraRows ?? false) })">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Abnormal results</h4>
                  <p class="pf-rtb-s">How out-of-range values are marked — a high and a low result, live:</p>
                  <div class="pf-wys-paper pf-wys-demo">
                    @for (row of flagDemoRows; track row.dir) {
                      <div class="pf-wys-demo__row">
                        <span class="pf-wys-demo__kind">{{ row.dir === 'high' ? 'High' : 'Low' }}</span>
                        <span class="pf-wys-demo__name">{{ row.name }}</span>
                        <span [style.fontWeight]="(tpl().flagIndicator ?? 'letter') === 'none' ? '400' : '700'"
                              [style.color]="flagDemoColor(row.dir)">
                          {{ row.value }}@if (flagGlyph(row.dir); as g) {<span>&nbsp;{{ g }}</span>}
                        </span>
                        <span class="pf-wys-demo__range">{{ row.range }}</span>
                      </div>
                    }
                  </div>
                  <p class="pf-rtb-s pf-flag-legend">{{ flagLegend() }}</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div [style.opacity]="(tpl().flagIndicator ?? 'letter') === 'none' ? '0.4' : null"
                       [style.pointerEvents]="(tpl().flagIndicator ?? 'letter') === 'none' ? 'none' : null">
                    <label class="pf-label">Abnormal value style</label>
                    <pf-segmented
                      [options]="flagStyleOptions"
                      [value]="tpl().flagStyle ?? 'bold'"
                      size="sm"
                      (valueChange)="patch({ flagStyle: $event })">
                    </pf-segmented>
                    <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
                      How out-of-range results are emphasised. NABL reports typically use bold; colour is optional.
                    </p>
                  </div>
                  <div>
                    <label class="pf-label">Abnormal indicator</label>
                    <pf-segmented
                      [options]="flagIndicatorOptions"
                      [value]="tpl().flagIndicator ?? 'letter'"
                      size="sm"
                      (valueChange)="patch({ flagIndicator: $event })">
                    </pf-segmented>
                    <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
                      Letters: <b>H</b> marks a <b>High</b> result, <b>L</b> a <b>Low</b> one. Arrows: <b>▲</b> High, <b>▼</b> Low. Choose <b>None</b> for a plain report — no letters, arrows, bold or colour.
                    </p>
                  </div>
                  @if ((tpl().flagStyle ?? 'bold') === 'bold_color') {
                    <div class="pf-toggle-row"
                         [style.opacity]="(tpl().flagIndicator ?? 'letter') === 'none' ? '0.4' : null"
                         [style.pointerEvents]="(tpl().flagIndicator ?? 'letter') === 'none' ? 'none' : null">
                      <span class="text-[13px]" style="color: var(--text-primary);">High value colour</span>
                      <input type="color"
                             style="width:46px;height:30px;border:1px solid var(--glass-border);border-radius:8px;background:transparent;cursor:pointer;padding:2px"
                             [ngModel]="tpl().abnormalColor || '#dc2626'"
                             (ngModelChange)="patch({ abnormalColor: $event })" />
                    </div>
                    <div class="pf-toggle-row"
                         [style.opacity]="(tpl().flagIndicator ?? 'letter') === 'none' ? '0.4' : null"
                         [style.pointerEvents]="(tpl().flagIndicator ?? 'letter') === 'none' ? 'none' : null">
                      <span class="text-[13px]" style="color: var(--text-primary);">Low value colour</span>
                      <input type="color"
                             style="width:46px;height:30px;border:1px solid var(--glass-border);border-radius:8px;background:transparent;cursor:pointer;padding:2px"
                             [ngModel]="tpl().abnormalLowColor || '#2563eb'"
                             (ngModelChange)="patch({ abnormalLowColor: $event })" />
                    </div>
                  }
                </div>
                </div>

                <div class="pf-rtb">
                  <h4 class="pf-rtb-h">Departments &amp; details</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Group by department</span>
                    <button type="button" class="pf-toggle pf-rt-sw" role="switch" [attr.aria-checked]="!!(tpl().groupByDepartment)"
                            aria-label="Group by department" (click)="patch({ groupByDepartment: !(tpl().groupByDepartment) })">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                  <div class="pf-toggle-row">
                    <div class="flex flex-col pr-3">
                      <span class="text-[13px]" style="color: var(--text-primary);">Each department on a new page</span>
                      <span class="text-[12px]" style="color: var(--text-tertiary);">Start every department's tests on a fresh page.</span>
                    </div>
                    <button type="button" class="pf-toggle pf-rt-sw" role="switch" [attr.aria-checked]="!!(tpl().departmentPageBreak ?? false)"
                            aria-label="Each department on a new page" (click)="patch({ departmentPageBreak: !(tpl().departmentPageBreak ?? false) })">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Show method line</span>
                    <button type="button" class="pf-toggle pf-rt-sw" role="switch" [attr.aria-checked]="!!(tpl().showMethod)"
                            aria-label="Show method line" (click)="patch({ showMethod: !(tpl().showMethod) })">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                  <div class="pf-toggle-row">
                    <span class="text-[13px]" style="color: var(--text-primary);">Show specimen line</span>
                    <button type="button" class="pf-toggle pf-rt-sw" role="switch" [attr.aria-checked]="specimenLineOn()"
                            aria-label="Show specimen line" (click)="toggleSpecimenLine()">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                  <!-- The ONE home of this switch (Lab settings only links here). -->
                  <div class="pf-toggle-row">
                    <div class="flex flex-col pr-3">
                      <span class="text-[13px]" style="color: var(--text-primary);">Consolidated abnormal results sheet</span>
                      <span class="text-[12px]" style="color: var(--text-tertiary);">Print a first page listing every high and low result.</span>
                    </div>
                    <button type="button" class="pf-toggle pf-rt-sw" role="switch" [attr.aria-checked]="abnormalSummaryOn()"
                            aria-label="Consolidated abnormal results sheet" (click)="toggleAbnormalSummary()">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                </div>
                </div>
              </div>
            }

            <!-- ══ TABLE COLUMNS — per department ══ -->
            @case ('columns') {
              <pf-report-columns-editor (stateChange)="onColumnsState($event)">
              </pf-report-columns-editor>
            }

            <!-- ══ SEQUENCING — department + test print order ══ -->
            @case ('sequence') {
              <pf-report-sequencing-editor [template]="tpl()"
                (metadataChange)="patch({ metadata: $event })"
                (previewTests)="seqPreviewTests.set($event)"></pf-report-sequencing-editor>
            }

          }
        </div>

        <!-- ── Right: live PDF preview, shared by every section. ─────── -->
        <aside class="pf-rt-aside" [class.pf-card]="theme.isNewDesign()" aria-label="Live preview">
          @if (theme.isNewDesign()) {
            <div class="pf-card__head pf-rt-aside__head">
              <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></span>
              <span class="pf-card__label">Live preview</span>
              <span class="pf-card__note">{{ rendering() ? 'Rendering…' : 'PDF' }}</span>
            </div>
          } @else {
          <p class="pf-rt-aside__k">Live preview ({{ rendering() ? 'rendering…' : 'PDF' }})</p>
          }
          <div class="pf-rt-bw">
            <button type="button" class="pf-toggle pf-rt-sw" role="switch" [attr.aria-checked]="bwPreview()"
                    aria-label="Black and white preview" (click)="bwPreview.set(!bwPreview())">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
            <span class="pf-rt-bw__t">Black &amp; white preview <span class="pf-rt-bw__d">— see how it photocopies</span></span>
          </div>
          <div class="pf-pdf-frame" [class.pf-bw]="bwPreview()">
            @if (previewSafe()) {
              <iframe [src]="previewSafe()" title="Report PDF preview"
                      class="w-full pf-pdf-iframe"></iframe>
            } @else {
              <div class="flex items-center justify-center h-[600px]" style="color: var(--text-tertiary);">
                Loading preview…
              </div>
            }
          </div>
          <p class="pf-rt-aside__hint">Preview uses a sample order. Save to apply this template to real reports.</p>
        </aside>
        }
      </div>
      }
      </div>
    </section>
  `,
  styles: [`
    /* ── WYSIWYG paper insets: light "print" surfaces on the dark page ── */
    .pf-wys-paper { background: #ffffff; color: #111; border-radius: 10px; padding: 12px 14px;
      border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 1px 6px rgba(0,0,0,0.35); }
    .pf-wys-masthead { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
    .pf-wys-masthead__name { font-size: 20px; font-weight: 800; letter-spacing: 0.02em; }
    .pf-wys-masthead__tag { font-size: 11.5px; color: #555; }
    .pf-wys-masthead__bar { height: 4px; border-radius: 2px; margin-top: 8px; }

    .pf-wys-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
    .pf-wys-thumb { display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 8px; border-radius: 12px; cursor: pointer; background: transparent;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); }
    .pf-wys-thumb[aria-pressed='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-wys-thumb__name { font-size: 11px; font-weight: 600; color: var(--text-secondary, #cbd5e1); }
    .pf-wys-thumb__paper { position: relative; width: 116px; height: 62px; border-radius: 6px; background: #fff;
      display: block; overflow: hidden; border: 1px solid rgba(0,0,0,0.1); }
    .pf-wys-thumb__logo { position: absolute; top: 8px; left: 8px; width: 14px; height: 14px; border-radius: 3px; background: #94a3b8; }
    .pf-wys-thumb__lines { position: absolute; top: 9px; left: 28px; right: 10px; display: flex; flex-direction: column; gap: 4px; }
    .pf-wys-thumb__lines i { height: 5px; border-radius: 2px; background: #cbd5e1; display: block; }
    .pf-wys-thumb__lines i:first-child { background: #64748b; width: 70%; }
    .pf-wys-thumb__accent { position: absolute; left: 0; right: 0; top: 30px; height: 3px; background: #3b82f6; }
    .pf-wys-thumb__paper--banner .pf-wys-thumb__accent { top: 0; height: 10px; }
    .pf-wys-thumb__paper--banner .pf-wys-thumb__logo { top: 16px; }
    .pf-wys-thumb__paper--banner .pf-wys-thumb__lines { top: 18px; }
    .pf-wys-thumb__paper--classic .pf-wys-thumb__accent { display: none; }
    .pf-wys-thumb__paper--minimal .pf-wys-thumb__accent { display: none; }
    .pf-wys-thumb__paper--minimal .pf-wys-thumb__logo { display: none; }
    .pf-wys-thumb__paper--minimal .pf-wys-thumb__lines { left: 10px; }

    .pf-wys-fonts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .pf-wys-font { display: flex; flex-direction: column; align-items: center; gap: 1px;
      padding: 8px 6px; border-radius: 11px; cursor: pointer; background: transparent;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); color: var(--text-primary, #e2e8f0); }
    .pf-wys-font[aria-pressed='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-wys-font__sample { font-size: 15px; }
    .pf-wys-font__name { font-size: 10.5px; color: var(--text-tertiary, #94a3b8); font-family: system-ui, sans-serif; }

    /* Report theme cards — a paper specimen set in the theme's own face. */
    .pf-rtheme { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 520px) { .pf-rtheme { grid-template-columns: 1fr; } }
    .pf-rtheme__card { display: flex; flex-direction: column; align-items: stretch; gap: 6px; text-align: left;
      min-height: 44px; padding: 10px; border-radius: 12px; cursor: pointer; font: inherit; background: transparent;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); color: var(--text-primary, #e2e8f0); }
    .pf-rtheme__card[aria-checked='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-rtheme__card:focus-visible { outline: 2px solid var(--pf-sel-border); outline-offset: 2px; }
    .pf-rtheme__spec { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 8px;
      background: #fff; color: #1B3A6B; border: 1px solid rgba(0,0,0,0.08); }
    .pf-rtheme__lab { font-size: 17px; line-height: 1.1; }
    .pf-rtheme__dept { font-size: 11.5px; border-bottom: 1.5px solid #1B3A6B; padding-bottom: 2px; margin-bottom: 2px; }
    .pf-rtheme__row { display: grid; grid-template-columns: 1.3fr 0.9fr 1fr; gap: 6px; font-size: 10.5px; color: #1a1a1a; }
    .pf-rtheme__dim { color: #666; font-weight: 400; }
    .pf-rtheme__name { font-size: 13px; font-weight: 600; }
    .pf-rtheme__desc { font-size: 12px; line-height: 1.4; color: var(--text-secondary, #94a3b8); }
    .pf-rtheme__note { margin: 0 0 8px; }
    .pf-rtheme__off { opacity: 0.4; pointer-events: none; }

    .pf-wys-mini { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 7px;
      background: #fff; border-radius: 6px; border: 1px solid rgba(0,0,0,0.1); }
    .pf-wys-mini i { display: block; height: 6px; border-radius: 2px; background: #e2e8f0; }
    .pf-wys-mini i:first-child { background: #64748b; }
    .pf-wys-mini--bordered i { border: 1px solid #94a3b8; background: #fff; height: 8px; }
    .pf-wys-mini--bordered i:first-child { background: #cbd5e1; }
    .pf-wys-mini--striped i:nth-child(odd) { background: #cbd5e1; }

    .pf-wys-demo { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; font-size: 13px; }
    .pf-wys-demo__row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .pf-wys-demo__kind { min-width: 38px; font-size: 10px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; color: #666; }
    .pf-wys-demo__name { min-width: 128px; }
    .pf-wys-demo__range { color: #777; font-size: 12px; }
    .pf-flag-legend { margin-bottom: 12px; font-weight: 600; color: var(--text-secondary); white-space: pre-wrap; }

    .pf-wys-sigs { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
    .pf-wys-sig { display: flex; flex-direction: column; align-items: center; gap: 1px; flex: 1; min-width: 120px; font-size: 12px; }
    .pf-wys-sig__img { max-height: 30px; max-width: 90px; object-fit: contain; }
    .pf-wys-sig__scribble { font-size: 20px; color: #999; }
    .pf-wys-sig i { color: #666; font-size: 11px; }
    .pf-wys-sig small { color: #888; font-size: 10px; }
    .pf-wys-sig--empty { font-size: 11.5px; color: #666; text-align: center; }

    /* Patient drag area framed like the printed patient strip */
    .pf-pcols { position: relative; padding-top: 26px !important; border: 1px solid var(--glass-border, rgba(148,163,184,0.2));
      border-radius: 12px; padding: 26px 10px 10px; }
    .pf-pcols::before { content: 'PATIENT BLOCK — AS PRINTED'; position: absolute; top: 6px; left: 12px;
      font-size: 9.5px; letter-spacing: 0.14em; color: var(--text-tertiary, #94a3b8); font-weight: 700; }

    /* ── Titled setting groups — FLAT on the panel surface. The work panel
       already provides the card; boxing each group again read as
       card-in-card clutter. Groups separate with hairlines instead. ── */
    .pf-rtb { margin: 0; padding: 16px 0; border: 0; border-radius: 0; background: transparent;
      border-top: 1px solid var(--glass-border, rgba(148,163,184,0.14)); }
    .pf-rtb:first-child { border-top: 0; padding-top: 2px; }
    .pf-rtb:last-child { padding-bottom: 0; }
    .pf-rtb-h { margin: 0 0 2px; font-size: 13px; font-weight: 600; color: var(--text-primary, #e2e8f0); }
    .pf-rtb-s { margin: 0 0 12px; font-size: 12px; line-height: 1.45; color: var(--text-tertiary, #94a3b8); }

    /* Compact field vocabulary inside the panel (test-editor density). */
    .pf-rt-work .pf-label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500;
      color: var(--text-tertiary, #94a3b8); }
    .pf-rt-work .pf-input { padding: 8px 12px; font-size: 13.5px; border-radius: 10px; }
    .pf-rt-work textarea.pf-input { font-size: 13px; line-height: 1.5; }
    .pf-rt-work .pf-rtb .grid { row-gap: 12px; }

    /* ── Workspace shell: rail | focused panel | preview (test-editor kin). ── */
    .pf-rt-head { display: flex; align-items: flex-start; gap: 12px; padding: 6px 0 10px; }
    .pf-rt-head > .min-w-0 { flex: 1; }
    .pf-rt-title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.01em; color: var(--text-primary); }
    .pf-rt-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-tertiary, #94a3b8); }

    .pf-rt-grid { display: grid; grid-template-columns: 188px minmax(0, 1fr) minmax(400px, 40%); gap: 18px; align-items: start; }
    .pf-rt-loading { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 40%); gap: 18px; align-items: start; }
    @media (max-width: 1180px) { .pf-rt-loading { grid-template-columns: 1fr; } }
    @media (max-width: 1180px) { .pf-rt-grid { grid-template-columns: 1fr; } }

    /* ── Section list (left panel). ── */
    .pf-rt-rail { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 70px; }
    .pf-rt-rail__head { display: flex; align-items: center; justify-content: space-between;
      padding: 2px 6px 8px 14px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--text-tertiary, #94a3b8); }
    .pf-rt-side-toggle, .pf-rt-side-expand { display: inline-flex; align-items: center; gap: 6px;
      padding: 5px; border-radius: 8px; border: none; background: transparent;
      color: var(--text-tertiary, #94a3b8); cursor: pointer; }
    .pf-rt-side-toggle:hover, .pf-rt-side-expand:hover { background: var(--glass-bg-hover, rgba(255,255,255,.05)); color: var(--text-primary); }
    .pf-rt-side-expand { margin: 0 0 10px; padding: 6px 12px; font-size: 12px; font-weight: 600;
      border: 1px solid var(--glass-border); border-radius: 10px; }
    .pf-rt-grid--norail { grid-template-columns: minmax(0, 1fr) minmax(400px, 40%); }
    @media (min-width: 1181px) { .pf-rt-grid--norail .pf-rt-rail { display: none; } }
    @media (max-width: 1180px) {
      .pf-rt-rail__head, .pf-rt-side-expand { display: none; }
      .pf-rt-grid--norail { grid-template-columns: 1fr; }
    }
    .pf-rt-rail__item { display: flex; align-items: center; height: 40px; padding: 0 14px;
      border-radius: 11px; border: none; background: transparent; color: var(--text-secondary);
      font-size: 13px; font-weight: 600; cursor: pointer; text-align: left;
      transition: color .15s, background .15s; }
    .pf-rt-rail__txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (hover: hover) {
      .pf-rt-rail__item:hover { color: var(--text-primary); background: var(--glass-bg-hover, rgba(255,255,255,.05)); }
    }
    .pf-rt-rail__item--on { color: var(--text-primary); font-weight: 700;
      background: color-mix(in srgb, #a855f7 14%, transparent); }
    @media (max-width: 1180px) {
      .pf-rt-rail { position: sticky; top: 58px; z-index: 4; flex-direction: row; overflow-x: auto;
        scrollbar-width: none; padding: 6px 0; background: var(--bg-primary, #0a0a15); }
      .pf-rt-rail::-webkit-scrollbar { display: none; }
      .pf-rt-rail__item { flex: 0 0 auto; height: 34px; }
    }

    .pf-rt-work { min-width: 0; background: var(--glass-bg, rgba(255,255,255,.03));
      border: 1px solid var(--glass-border); border-radius: 16px; padding: 16px 20px 20px;
      animation: rt-sec-in .18s cubic-bezier(0, 0, 0.2, 1); }
    @media (prefers-reduced-motion: reduce) { .pf-rt-work { animation: none; } }
    @keyframes rt-sec-in { from { opacity: .4; transform: translateY(5px); } to { opacity: 1; transform: none; } }
    .pf-rt-work__hdr { padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--glass-border); }
    .pf-rt-work__title { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: var(--text-primary); }
    .pf-rt-work__sub { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary, #94a3b8); }
    .pf-rt-flat + .pf-rt-flat .pf-rtb:first-child { border-top: 1px solid var(--glass-border); }

    .pf-rt-aside { min-width: 0; }
    .pf-rt-aside__k { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .08em;
      text-transform: uppercase; color: var(--text-tertiary); }
    /* New design: the preview is an pf-card side card (header + framed PDF). */
    .pf-rt-aside.pf-card .pf-pdf-frame { margin: 12px; }
    .pf-rt-aside.pf-card .pf-rt-aside__hint { margin: 0 14px 12px; }
    .pf-rt-aside__head { flex: none; }
    .pf-rt-aside__hint { margin: 8px 0 0; font-size: 12px; color: var(--text-tertiary); }

    /* Desktop: the page holds still; work panel + preview scroll internally. */
    @media (min-width: 1181px) {
      :host { display: block; height: 100%; overflow: hidden; }
      .pf-rt-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; padding-bottom: 12px; }
      .pf-rt-head { flex: 0 0 auto; }
      .pf-rt-grid { flex: 1 1 auto; min-height: 0; align-items: stretch; }
      .pf-rt-rail { position: static; overflow-y: auto; min-height: 0; }
      .pf-rt-work { height: 100%; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
      .pf-rt-aside { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
      .pf-pdf-frame { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
      .pf-pdf-iframe { flex: 1 1 auto; min-height: 0; height: auto; }
    }

    /* NEW design (band page): the band body fills the shell; the editor
       panel and the preview each scroll on their own — no page scroll. On
       narrow screens (single column) the grid itself scrolls. */
    :host-context(.design-new) .pf-rt-grid { flex: 1 1 auto; min-height: 0; }
    @media (min-width: 1181px) {
      :host-context(.design-new) .pf-rt-grid { align-items: stretch; }
      :host-context(.design-new) .pf-rt-work { height: 100%; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
      :host-context(.design-new) .pf-rt-aside { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    }
    @media (max-width: 1180px) {
      :host-context(.design-new) .pf-rt-grid { overflow-y: auto; overscroll-behavior: contain; }
    }

    /* Colour field: swatch + hex as ONE 38px control. */
    .pf-color-field { display: flex; align-items: center; height: 38px; border-radius: 10px;
      border: 1px solid var(--input-border, var(--glass-border)); background: var(--input-bg, rgba(255,255,255,.03));
      overflow: hidden; cursor: pointer; }
    .pf-color-field input[type="color"] { width: 42px; height: 46px; margin: -4px 0 -4px -4px;
      border: 0; padding: 0; background: transparent; cursor: pointer; }
    .pf-color-field__hex { padding: 0 10px; font-variant-numeric: tabular-nums; font-size: 12px;
      color: var(--text-secondary, #cbd5e1); }

    .pf-rt-work input[type="range"] { width: 100%; accent-color: var(--pf-toggle-on, #aeb8c2); }
    .pf-rt-datesgrid { display: flex; flex-direction: column; gap: 12px; }

    /* Patient-strip QR switches */
    .pf-sqr { display: flex; flex-direction: column; gap: 2px; }
    .pf-sqr__row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 8px 0;
      border-top: 1px solid var(--glass-border, rgba(148,163,184,0.14)); }
    .pf-sqr__row:first-child { border-top: 0; }
    .pf-sqr__ic { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px;
      color: var(--text-secondary); background: var(--surface-2); border: 1px solid var(--border-muted); }
    .pf-sqr__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-sqr__label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-sqr__desc { font-size: 12px; line-height: 1.4; color: var(--text-muted); }
    .pf-sqr__sw { flex: none; min-width: 44px; min-height: 44px; }
    .pf-sqr__sw:disabled { opacity: .45; cursor: not-allowed; }
    .pf-sqr__note { font-size: 12px; font-weight: 600; line-height: 1.4; color: var(--text-secondary); }
    .pf-rt-after { margin-top: 10px; }

    /* Department scope row for the patient strip */
    .pf-pt-scope { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .pf-pt-scope__sel { flex: 1 1 240px; min-width: 220px; }
    .pf-pt-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; padding: 4px 10px;
      border-radius: var(--pf-radius-chip, 8px); color: var(--text-secondary); border: 1px solid var(--pf-line); background: var(--pf-chip-bg); }
    .pf-pt-chip svg { color: var(--violet-text, #7c3aed); }
    .pf-pt-btn { height: 36px; min-height: 36px; }

    .pf-rt-sw { flex-shrink: 0; }
    .pf-rt-bw { display: flex; align-items: center; gap: 10px; margin: 0 0 8px; font-size: 12.5px; color: var(--text-secondary); }
    .pf-rt-bw__d { color: var(--text-tertiary); }
    .pf-bw .pf-pdf-iframe { filter: grayscale(1); }
    /* New design: the focused section is an pf-card surface (kit line/shadow). */
    :host-context(.design-new) .pf-rt-work { background: var(--pf-card-bg); border-color: var(--pf-line); box-shadow: var(--pf-shadow-sm); }
    .pf-color-picker { height: 36px; width: 56px; border-radius: 8px;
      border: 1px solid var(--glass-border); cursor: pointer;
      background: var(--glass-bg); }

    /* ── Drag-arrange patient columns ── */
    .pf-pcols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    @media (max-width: 640px) { .pf-pcols { grid-template-columns: 1fr; } }
    .pf-pcol { display: flex; flex-direction: column; gap: 6px; }
    .pf-pcol-h { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); }
    .pf-pcol-drop { display: flex; flex-direction: column; gap: 6px; min-height: 64px; padding: 8px;
      border-radius: 12px; border: 1px dashed var(--glass-border); background: rgba(255,255,255,0.02); }
    .pf-pcol-empty { font-size: 11.5px; color: var(--text-tertiary); text-align: center; padding: 8px 0; }
    .pf-ppool { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-radius: 12px;
      border: 1px dashed var(--glass-border); background: rgba(255,255,255,0.02); min-height: 44px; }
    .pf-pchip { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: 9px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary);
      font-size: 12.5px; font-weight: 600; cursor: grab; }
    .pf-pchip--pool { background: rgba(124,58,237,0.10); border-color: rgba(168,85,247,0.30); }
    .pf-pchip-grip { color: var(--text-muted); font-size: 12px; }
    .pf-pchip.cdk-drag-preview { box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .pf-pchip.cdk-drag-placeholder { opacity: 0.4; }
    .cdk-drop-list-dragging .pf-pchip:not(.cdk-drag-placeholder) { transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1); }
    .pf-toggle-row { display: flex; align-items: center; align-self: start; gap: 12px;
      justify-content: space-between; min-height: 40px; padding: 8px 12px; border-radius: 10px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-divider { height: 1px; background: var(--border-muted, #e2e8f0);
      margin: 8px 0; opacity: 0.6; }
    .pf-pdf-frame { border-radius: 14px; border: 1px solid var(--glass-border);
      background: #ffffff; overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18); }
    .pf-pdf-iframe { height: 760px; border: 0; background: #ffffff; display: block; }
    .pf-sig-card { border: 1px solid var(--glass-border); border-radius: 12px;
      padding: 12px; margin-bottom: 10px; background: rgba(255,255,255,0.02); }
    .pf-link-btn { background: transparent; border: none; color: #ef4444;
      cursor: pointer; font-size: 12px; text-decoration: underline; }
    .pf-add-btn { width: 100%; padding: 10px; border-radius: 10px;
      background: rgba(168,85,247,0.08); border: 1px dashed rgba(168,85,247,0.5);
      color: #c4b5fd; cursor: pointer; font-weight: 600; font-size: 13px; }

    /* ── Additive cross-platform overrides only — desktop-web (>=1280)
         is intentionally untouched. ──────────────────────────────── */

    /* Hover affordances gated to real pointers so touch devices don't
       get stuck-hover states. */
    @media (hover: hover) {
      .pf-add-btn:hover { background: rgba(168,85,247,0.14); }
    }

    /* Touch sizing: color pickers + small action buttons get >=44px
       tap targets on coarse pointers without changing visual size on
       mouse-driven desktop. */
    @media (pointer: coarse) {
      .pf-color-picker { min-height: 44px; }
      .pf-link-btn { min-height: 44px; padding: 6px 4px; }
      /* Inline-styled high/low colour swatches (Theme tab) sit at 30px;
         lift them to a real tap target on touch. !important is needed
         to win over the element's inline height. Scoped to this page's
         toggle rows so no global swatch is affected. */
      .pf-toggle-row input[type="color"] { min-height: 44px !important; }
    }

    /* Phone (<=640): the NABL number field + badge-image uploader are
       too cramped side-by-side — stack them. Width-gated, so the
       tablet/desktop 2-col layout is untouched. */
    @media (max-width: 640px) {
      .pf-nabl-grid { grid-template-columns: 1fr; }
    }

    /* Phone (<=640): the live-preview pane sits below the form as a tall
       block. Cap its height so it doesn't dominate the scroll, and let
       the placeholder match. Cannot affect desktop — width-gated. */
    @media (max-width: 640px) {
      .pf-pdf-iframe { height: 70dvh; min-height: 360px; max-height: 560px; }
      .pf-add-btn { padding: 12px; }
    }

    /* ── Letterhead / Footer designer: the page card + its side card take
       the whole body (after the classic rail, when it shows). ── */
    .pf-rt-grid.pf-rt-grid--designer { grid-template-columns: 188px minmax(0, 1fr); }
    .pf-rt-grid.pf-rt-grid--designer.pf-rt-grid--norail { grid-template-columns: minmax(0, 1fr); }
    @media (max-width: 1180px) { .pf-rt-grid.pf-rt-grid--designer { grid-template-columns: minmax(0, 1fr); } }
    .pf-rt-designer { min-width: 0; min-height: 0; }
    @media (min-width: 901px) and (min-height: 560px) { .pf-rt-designer { height: 100%; } }
    .pf-lt-size { flex: none; width: 120px; }
    .pf-ps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; align-items: start; }
    .pf-ps-sample { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--surface-2, var(--bg-subtle)); border: 1px solid var(--border-subtle, var(--border)); }
    .pf-ps-sample__k { font-size: 11.5px; color: var(--text-muted); }
    .pf-ps-sample__v { font-size: 14px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; white-space: pre-wrap; }
    .pf-ps-rename { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
    .pf-ps-rename__f { flex: 1 1 200px; min-width: 0; }
    .pf-ps-rename__i { flex: 1 1 200px; min-width: 0; }
    .pf-ps-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-ps-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; border-radius: 999px; font-size: 12px;
      background: var(--surface-2, var(--bg-subtle)); border: 1px solid var(--border-subtle, var(--border)); color: var(--text); }
    .pf-ps-chip__t { display: inline-flex; align-items: center; gap: 6px; }
    .pf-ps-chip__x { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 999px; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; }
    .pf-ps-chip__x:hover { background: var(--bg-hover, rgba(127,127,127,.15)); color: var(--text); }
    .pf-ps-chip__x:focus-visible { outline: 2px solid var(--focus-ring, var(--primary)); outline-offset: 1px; }
    .pf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .pf-lt-issues { margin: 8px 0 0; padding: 0 0 0 18px; font-size: 12px; line-height: 1.5; color: var(--text-muted); }
    .pf-rt-issues { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: var(--pf-radius-chip, 8px);
      font-size: 12.5px; font-weight: 600; cursor: pointer;
      background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border); }
    .pf-rt-issues:focus-visible { outline: 2px solid var(--warning-text); outline-offset: 2px; }
    @media (max-width: 640px) { .pf-rt-issues__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } .pf-rt-issues { width: 34px; padding: 0; justify-content: center; } }
    .pf-rt-savestate { margin-right: 4px; }
    .pf-classic-only .pf-rt-savestate, .pf-rt-head .pf-rt-savestate { align-self: center; }
    @media (max-width: 640px) { .pf-rt-savestate__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } }
  `],
})
export class ReportTemplateComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly platform = inject(PlatformService);
  private readonly dialog = inject(DialogService);
  protected readonly theme = inject(ThemeService);

  /** Section cards for the left nav — a plain-words label + what it changes,
   *  so the admin never has to guess what lives behind a tab. */
  readonly sections: Array<{ value: Tab; label: string; desc: string }> = [
    { value: 'letterhead', label: 'Letterhead',    desc: 'Name, tagline, logo, brand colours, NABL — everything at the top of the page' },
    { value: 'patient',    label: 'Patient strip', desc: 'Which patient fields print, arranged how, with the date format' },
    { value: 'columns',    label: 'Table columns', desc: 'Per-department table columns & widths' },
    { value: 'table',      label: 'Results table', desc: 'Report theme, font, table colours, zebra rows, abnormal marking, departments' },
    { value: 'sequence',   label: 'Sequencing',    desc: 'The order departments and tests print in' },
    { value: 'footer',     label: 'Footer',        desc: 'Disclaimer, end-of-report, watermark, page extras' },
  ];
  /** The same sections as the band pill's tabs (new design). The
   *  description rides as the tab's tooltip. */
  readonly sectionOptions: SegmentedOption<Tab>[] = this.sections.map(s => ({ value: s.value, label: s.label, hint: s.desc }));
  readonly activeSection = () => this.sections.find(s => s.value === this._tab()) ?? null;
  private readonly _tab = signal<Tab>('letterhead');
  readonly tab = this._tab.asReadonly();
  /** Left section list hide/unhide — Test Master departments pattern. */
  readonly railHidden = signal<boolean>(
    typeof localStorage !== 'undefined' && localStorage.getItem('pf-rt-rail') === 'hidden');
  toggleRail() {
    this.railHidden.update(v => !v);
    try { localStorage.setItem('pf-rt-rail', this.railHidden() ? 'hidden' : 'shown'); } catch { /* private mode */ }
  }

  setTab(t: Tab) {
    this._tab.set(t);
    if (t === 'table') this.loadSourceSansFace();
    // Re-pull the form-flow fields when entering the Patient tab so the list
    // reflects the latest saved Patient Registration flow (not a stale copy).
    if (t === 'patient') this.loadCustomPatientFields();
  }

  readonly headerPresetOptions: SegmentedOption<string>[] = [
    { value: 'classic',  label: 'Classic'  },
    { value: 'centered', label: 'Centered' },
    { value: 'banner',   label: 'Banner'   },
    { value: 'minimal',  label: 'Minimal'  },
  ];
  readonly logoPositionOptions: SegmentedOption<string>[] = [
    { value: 'left',   label: 'Left'   },
    { value: 'center', label: 'Center' },
    { value: 'right',  label: 'Right'  },
  ];
  readonly sizeOptions: SegmentedOption<string>[] = [
    { value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' },
  ];
  readonly fontOptions: SegmentedOption<string>[] = [
    { value: 'helvetica', label: 'Sans (Helvetica)' },
    { value: 'times',     label: 'Serif (Times)'    },
    { value: 'courier',   label: 'Mono (Courier)'   },
  ];
  readonly tableStyleOptions: SegmentedOption<string>[] = [
    { value: 'plain',    label: 'Plain'    },
    { value: 'bordered', label: 'Bordered' },
    { value: 'striped',  label: 'Striped'  },
  ];
  // High / Low made explicit (QA 2026-09-24): users could not tell which
  // mark meant which. Each option names both marks; the live preview shows a
  // HIGH and a LOW row side by side, and the legend spells the pair out.
  readonly flagIndicatorOptions: SegmentedOption<string>[] = [
    { value: 'letter', label: 'Letters H · L' },
    { value: 'arrow',  label: 'Arrows ▲ · ▼' },
    { value: 'none',   label: 'None' },
  ];
  readonly flagStyleOptions: SegmentedOption<string>[] = [
    { value: 'bold',       label: 'Bold'          },
    { value: 'bold_color', label: 'Bold + colour' },
  ];
  /** The two sample results of the abnormal-marks preview. */
  readonly flagDemoRows: ReadonlyArray<{ dir: 'high' | 'low'; name: string; value: string; range: string }> = [
    { dir: 'high', name: 'Glucose, fasting', value: '182 mg/dL', range: '70 – 99' },
    { dir: 'low',  name: 'Hemoglobin',       value: '11.4 g/dL', range: '12.0 – 16.0' },
  ];
  /** The mark the report prints after a high / low result (PDF: letter, or a
   *  ▲ / ▼ triangle in arrow mode; nothing for None). */
  flagGlyph(dir: 'high' | 'low'): string {
    const mode = this.tpl().flagIndicator ?? 'letter';
    if (mode === 'none') return '';
    if (mode === 'arrow') return dir === 'high' ? '▲' : '▼';
    return dir === 'high' ? 'H' : 'L';
  }
  flagDemoColor(dir: 'high' | 'low'): string {
    const t = this.tpl();
    if ((t.flagStyle ?? 'bold') !== 'bold_color' || (t.flagIndicator ?? 'letter') === 'none') return '#111';
    return dir === 'high' ? (t.abnormalColor || '#dc2626') : (t.abnormalLowColor || '#2563eb');
  }
  /** One line naming both marks, e.g. "High: H  ·  Low: L". */
  flagLegend(): string {
    if ((this.tpl().flagIndicator ?? 'letter') === 'none') return 'No marks — high and low results print as plain values.';
    return `High: ${this.flagGlyph('high')}   ·   Low: ${this.flagGlyph('low')}   ·   Critical values print as high / low`;
  }
  readonly patientLayoutOptions: SegmentedOption<string>[] = [
    { value: 'three-col',     label: '3-column (Classic)' },
    { value: 'four-col-grid', label: '4-column grid'     },
    { value: 'stacked',       label: 'Stacked'           },
  ];
  readonly timeFormatOptions: SegmentedOption<string>[] = [
    { value: 'none', label: 'Date only' },
    { value: '12h',  label: '12h AM/PM' },
    { value: '24h',  label: '24h'       },
  ];
  readonly dateFormatOptions = [
    { value: 'dd MMM yyyy',   label: 'dd MMM yyyy   →  14 May 2026'   },
    { value: 'dd/MM/yyyy',    label: 'dd/MM/yyyy    →  14/05/2026'    },
    { value: 'MMM dd, yyyy',  label: 'MMM dd, yyyy  →  May 14, 2026'  },
    { value: 'yyyy-MM-dd',    label: 'yyyy-MM-dd    →  2026-05-14'    },
  ];
  readonly separatorOptions = [
    { value: ', ',   label: '", "   →  May 14, 2026, 11:01 PM' },
    { value: '  ',   label: '"  "   →  May 14, 2026 11:01 PM' },
    { value: ' · ',  label: '" · "  →  May 14, 2026 · 11:01 PM' },
    { value: ' | ',  label: '" | "  →  May 14, 2026 | 11:01 PM' },
  ];

  /** Colours are homed by WHERE they print: brand in the letterhead,
   *  the rest on the results table. */
  readonly brandColorFields: Array<{ key: keyof ReportTemplate; label: string; fallback: string }> = [
    { key: 'primaryColor',    label: 'Lab name colour',   fallback: '#1B3A6B' },
    { key: 'accentColor',     label: 'Accent bar',        fallback: '#0066CC' },
  ];
  readonly tableColorFields: Array<{ key: keyof ReportTemplate; label: string; fallback: string }> = [
    { key: 'tableHeaderBg',   label: 'Header row bg',     fallback: '#ffffff' },
    { key: 'tableHeaderText', label: 'Header row text',   fallback: '#000000' },
    { key: 'bodyTextColor',   label: 'Body text',         fallback: '#1a1a1a' },
    { key: 'dividerColor',    label: 'Divider / hairline',fallback: '#cccccc' },
  ];

  readonly patientToggles: Array<{ key: keyof ReportTemplate; label: string; defaultVal: boolean }> = [
    { key: 'showPatientName', label: 'Patient name',       defaultVal: true  },
    { key: 'showAge',         label: 'Age & sex',          defaultVal: true  },
    { key: 'showOrderId',     label: 'Patient / Order ID', defaultVal: true  },
    { key: 'showRefDoctor',   label: 'Referring doctor',   defaultVal: true  },
    { key: 'showAbhaId',      label: 'ABHA ID',            defaultVal: false },
    { key: 'showBarcode',     label: 'Barcode',            defaultVal: true  },
  ];
  readonly timestampToggles: Array<{ key: keyof ReportTemplate; label: string }> = [
    { key: 'showRegistered',     label: 'Registered on' },
    { key: 'showCollectionDate', label: 'Collected on' },
    { key: 'showReportDate',     label: 'Reported on' },
  ];

  // ── Template state ──────────────────────────────────────────
  private readonly _tpl = signal<ReportTemplate>(this.defaultTemplate());
  readonly tpl = this._tpl.asReadonly();
  /** Letterhead + Footer are edited ON the page (report-header-editor). */
  readonly designerTab = computed(() => this._tab() === 'letterhead' || this._tab() === 'footer');

  // ── Undo / redo + unsaved changes ───────────────────────────
  // Every edit is a patch of the one template object, so history is a stack
  // of template snapshots. Typing into one field (same keys, < 700 ms apart)
  // coalesces into a single step.
  private readonly past = signal<ReportTemplate[]>([]);
  private readonly future = signal<ReportTemplate[]>([]);
  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);
  private lastPatch = { at: 0, keys: '' };
  /** JSON of the template as last loaded / saved — "dirty" compares to it. */
  private readonly savedJson = signal<string>(JSON.stringify(this.defaultTemplate()));
  readonly dirty = computed(() => JSON.stringify(this._tpl()) !== this.savedJson());

  /** "Show specimen line" lives in the template metadata (no column). */
  specimenLineOn(): boolean { return readReportOption(this.tpl(), 'specimenLine'); }
  toggleSpecimenLine() {
    this.patch({ metadata: writeReportOption(this.tpl(), 'specimenLine', !this.specimenLineOn()) });
  }
  /** Consolidated "Summary of abnormal results" first page (metadata option). */
  abnormalSummaryOn(): boolean { return readReportOption(this.tpl(), 'abnormalSummary'); }
  toggleAbnormalSummary() {
    this.patch({ metadata: writeReportOption(this.tpl(), 'abnormalSummary', !this.abnormalSummaryOn()) });
  }

  /** `step: true` = a one-click action (preset, palette): always its own undo step, never merged with a patch just before it. */
  patch(p: Partial<ReportTemplate>, opts?: { step?: boolean }) {
    const keys = Object.keys(p).sort().join(',');
    const now = Date.now();
    const coalesce = !opts?.step && keys === this.lastPatch.keys && now - this.lastPatch.at < 700 && this.past().length > 0;
    this.lastPatch = { at: now, keys };
    if (!coalesce) {
      const cur = this._tpl();
      this.past.update(h => [...h.slice(-99), cur]);
    }
    this.future.set([]);
    this._tpl.update(v => ({ ...v, ...p }));
  }
  undo() {
    const h = this.past();
    if (!h.length) return;
    this.future.update(f => [this._tpl(), ...f]);
    this.past.set(h.slice(0, -1));
    this._tpl.set(h[h.length - 1]);
    this.lastPatch = { at: 0, keys: '' };
    this.initPatientCols();
  }
  redo() {
    const f = this.future();
    if (!f.length) return;
    this.past.update(h => [...h, this._tpl()]);
    this.future.set(f.slice(1));
    this._tpl.set(f[0]);
    this.lastPatch = { at: 0, keys: '' };
    this.initPatientCols();
  }
  /** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl+Y) — but never while typing in a
   *  field, where the browser's own text undo belongs. */
  @HostListener('document:keydown', ['$event'])
  onUndoKey(ev: KeyboardEvent) {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    const k = ev.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const el = ev.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    ev.preventDefault();
    if (k === 'y' || ev.shiftKey) this.redo(); else this.undo();
  }
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(ev: BeforeUnloadEvent) {
    if (this.dirty() || this.deptPatientDirty()) { ev.preventDefault(); ev.returnValue = ''; }
  }
  /** Route guard: leaving with unsaved changes asks first. */
  async canLeave(): Promise<boolean> {
    if (!this.dirty() && !this.deptPatientDirty()) return true;
    return this.dialog.confirm({
      title: 'Leave without saving?',
      message: 'Your report design changes are not saved yet. Save first to keep them.',
      confirmLabel: 'Leave without saving', cancelLabel: 'Stay', tone: 'danger',
    });
  }

  // ── Report style (report-style.ts) — text fitting, stored in the template metadata ──
  readonly reportStyle = computed(() => readReportStyle(this.tpl()));
  readonly fitOn = computed(() => this.reportStyle().fit.enabled);
  readonly minPtOptions = [6, 6.5, 7, 7.5, 8].map(v => ({ value: '' + v, label: `${v} pt${v === 7 ? ' (usual)' : ''}` }));
  setFit(p: { enabled?: boolean; minPt?: number; autoColumns?: boolean }) {
    this.patch({ metadata: writeReportStyle(this.tpl(), { fit: p }) });
  }
  // ── Style presets, colour palettes and the print check (report-presets.ts, report-palettes.ts) ──
  /** Editor-only: preview the sample report in greyscale, as a photocopy shows it. */
  readonly bwPreview = signal(false);
  private readonly lastPreset = signal<PresetId | null>(null);
  /** The preset just applied, while the settings still equal it (else the banner goes away). */
  readonly appliedBanner = computed<PresetId | null>(() => {
    const id = this.lastPreset();
    return id && detectPreset(this.tpl()) === id ? id : null;
  });
  applyPreset(id: PresetId) {
    const next = applyStylePreset(this.tpl(), id);
    if (next.patientColumnsJson) {
      // The arranged strip is only swapped for the default strip (as the Age & sex switch does).
      if (this.patientScope() === 'default') this.patientCols.set(JSON.parse(next.patientColumnsJson) as string[][]);
      else delete next.patientColumnsJson;
    }
    this.lastPreset.set(id);
    this.patch(next, { step: true });
  }
  applyPalette(id: PaletteId) {
    const pal = paletteById(id);
    if (!pal) return;
    this.lastPreset.set(null);
    this.patch({ ...paletteColumns(pal.colors), metadata: writeReportStyle(this.tpl(), { colors: { palette: id } } as ReportStylePatch) }, { step: true });
  }
  applyCustomColors(colors: PaletteColors) {
    this.lastPreset.set(null);
    this.patch({ ...paletteColumns(colors), metadata: writeReportStyle(this.tpl(), { colors: { palette: 'custom' } } as ReportStylePatch) }, { step: true });
  }
  setPrintSafe(on: boolean) {
    this.patch({ metadata: writeReportStyle(this.tpl(), { colors: { printSafe: on } } as ReportStylePatch) });
  }
  // ── Page density + squeeze (report-density.ts) ──
  readonly densityOptions: SegmentedOption<string>[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'compact', label: 'Compact' },
  ];
  /** What the squeeze did to the designer's sample report (null = not asked / not run). */
  readonly squeeze = signal<SqueezeReport | null>(null);
  readonly squeezeNote = computed<string>(() => squeezeMessage(this.squeeze()));
  setDensity(v: string) {
    this.patch({ metadata: writeReportStyle(this.tpl(), { density: v === 'compact' ? 'compact' : 'normal' }) });
  }
  setSqueeze(on: boolean) {
    this.patch({ metadata: writeReportStyle(this.tpl(), { squeeze: on }) });
  }
  setMinPt(v: string) {
    const n = parseFloat(v);
    if (isFinite(n)) this.setFit({ minPt: n });
  }
  // ── Patient block wording (report-patient-text.ts) — stored in the same style object ──
  readonly ageSexModeOptions: SegmentedOption<string>[] = [
    { value: 'separate', label: 'Two lines' },
    { value: 'combined', label: 'One field' },
  ];
  readonly sexStyleOptions: SegmentedOption<string>[] = [
    { value: 'word', label: 'Male' },
    { value: 'letter', label: 'M' },
  ];
  readonly frameOptions: SegmentedOption<string>[] = [
    { value: 'rules', label: 'Lines' },
    { value: 'box', label: 'Box' },
    { value: 'tint', label: 'Tint' },
    { value: 'none', label: 'None' },
  ];
  readonly ageStyleOptions = [{ value: 'auto', label: 'As the layout prints it' }, ...AGE_STYLE_CHOICES];
  readonly joinerOptions = [{ value: ' / ', label: '45 Y / Male' }, { value: ', ', label: '45 Y, Male' }, { value: ' ', label: '45 Y Male' }, { value: '/', label: '45 Y/Male' }];
  readonly labelJoinerOptions = LABEL_JOINER_CHOICES;
  /** A fixed sample (45-year-old male) so the chip shows the wording, not this lab's preview patient. */
  private readonly SAMPLE_PATIENT = { age: 45, sex: 'Male', displayName: 'Ravi Kumar', mrn: 'CHN-2609-004217-3' };
  readonly ageSexSample = computed(() => {
    const ps = this.reportStyle().patient;
    if (ps.ageSex === 'combined') return `${patientLabel(ps, 'ageSex', 'Age / Sex : ')}${ageSexText(this.SAMPLE_PATIENT, ps, 'short')}`;
    return `${patientLabel(ps, 'age', 'Age : ')}${ageText(this.SAMPLE_PATIENT, ps, 'Years')}     ${patientLabel(ps, 'sex', 'Sex : ')}${sexText(this.SAMPLE_PATIENT.sex, ps.sexStyle)}`;
  });
  readonly continuationSample = computed(() => this.reportStyle().patient.continuation === 'none'
    ? 'Off. Pages after the first have no patient name on them.'
    : `Prints  ${miniStripText(this.SAMPLE_PATIENT, 'LAB-2609-000142', this.reportStyle().patient).replace(/\s{2,}/g, ' ')}  and “Page 2 of 3”.`);
  setPatientStyle(p: Partial<ReturnType<typeof readReportStyle>['patient']>) {
    this.patch({ metadata: writeReportStyle(this.tpl(), { patient: p } as ReportStylePatch) });
  }
  setPageNumbers(on: boolean) {
    this.patch({ metadata: writeReportStyle(this.tpl(), { pageNumbers: on ? 'n-of-m' : 'n' }) });
  }
  /** One field or two lines. An arranged strip swaps its `age` + `sex` chips for the one `ageSex` chip (and back). */
  setAgeSex(mode: string) {
    const combined = mode === 'combined';
    const ps = this.reportStyle().patient;
    const patient: Record<string, unknown> = { ageSex: combined ? 'combined' : 'separate' };
    // "45 Y / Male" is what a lab means by one field; keep a lab's own wording choice if it made one.
    if (combined && ps.ageStyle === 'auto') patient['ageStyle'] = 'short';
    if (!combined && ps.ageStyle === 'short') patient['ageStyle'] = 'auto';
    const next: Partial<ReportTemplate> = { metadata: writeReportStyle(this.tpl(), { patient } as ReportStylePatch) };
    if (this.tpl().patientColumnsJson && this.patientScope() === 'default') {
      const cols = swapAgeSexColumns(this.patientCols(), combined);
      this.patientCols.set(cols);
      next.patientColumnsJson = JSON.stringify(cols);
    }
    this.patch(next);
  }
  readonly labelField = signal<string>('orderid');
  readonly labelFieldOptions = computed(() => {
    const combined = this.reportStyle().patient.ageSex === 'combined';
    return RENAMEABLE_LABEL_KEYS
      .filter(k => (combined ? k !== 'age' && k !== 'sex' : k !== 'ageSex'))
      .map(k => ({ value: k, label: PATIENT_LABELS[k].text }));
  });
  readonly labelValue = computed(() => this.reportStyle().patient.labels[this.labelField()] ?? '');
  defaultLabelText(key: string): string { return PATIENT_LABELS[key]?.text ?? ''; }
  setLabel(key: string, value: string) {
    const labels = { ...this.reportStyle().patient.labels };
    const v = value.trim() === '' ? '' : value;
    if (v === '') delete labels[key]; else labels[key] = v;
    this.patch({ metadata: writeReportStyle(this.tpl(), { patient: { labels } } as ReportStylePatch) });
  }
  readonly renamedLabels = computed(() =>
    Object.entries(this.reportStyle().patient.labels)
      .filter(([k]) => PATIENT_LABELS[k])
      .map(([key, now]) => ({ key, was: PATIENT_LABELS[key].text, now })));

  /** Would long names overlap on this template? Re-rendered with long sample names after each preview render. */
  readonly issues = signal<ReportIssues>({ count: 0, lines: [] });
  readonly issuesLabel = computed(() => {
    const n = this.issues().count;
    return `${n} ${n === 1 ? 'issue' : 'issues'}`;
  });
  readonly issuesTitle = computed(() => {
    const i = this.issues();
    return i.count ? `With long names: ${i.lines.join('; ')}${i.count > i.lines.length ? '…' : ''}. Open Patient strip to fix.` : '';
  });
  openIssues() {
    this.setTab('patient');
    setTimeout(() => document.getElementById('pf-long-text')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }

  // ── Report theme (report-theme.ts) — stored in the template metadata ──
  readonly reportThemeOptions = REPORT_THEME_OPTIONS;
  readonly reportTheme = computed<ReportThemeId>(() => readReportTheme(this.tpl()));
  readonly reportThemeLabel = computed(() => REPORT_THEME_OPTIONS.find(o => o.value === this.reportTheme())?.label ?? '');
  setReportTheme(id: ReportThemeId) {
    if (this.reportTheme() === id) return;
    this.patch({ metadata: writeReportTheme(this.tpl(), id) });
  }
  /** The theme card's specimen font: the report's own Source Sans 3 files,
   *  registered once as a web font when the card is shown. */
  readonly sourceSansCss = "'PF Source Sans 3', 'Source Sans 3', system-ui, sans-serif";
  readonly interCss = "'PF Inter', Inter, system-ui, sans-serif";
  /** The font a theme card's specimen is set in. */
  themeSpecimenCss(id: ReportThemeId): string {
    return id === 'source-sans' ? this.sourceSansCss : id === 'inter' ? this.interCss : this.fontCss(this.tpl().fontFamily ?? 'helvetica');
  }
  private themeFacesLoaded = false;
  private loadSourceSansFace() {
    if (this.themeFacesLoaded || typeof FontFace === 'undefined' || typeof document === 'undefined') return;
    this.themeFacesLoaded = true;
    const faces: Array<[keyof typeof SOURCE_SANS_FACES, string, string]> =
      [['normal', '400', 'normal'], ['semibold', '600', 'normal'], ['bold', '700', 'normal']];
    const sets: Array<[string, string, typeof SOURCE_SANS_FACES]> =
      [['PF Source Sans 3', SOURCE_SANS_DIR, SOURCE_SANS_FACES], ['PF Inter', INTER_DIR, INTER_FACES]];
    for (const [family, dir, table] of sets) {
      for (const [f, weight, style] of faces) {
        const url = new URL(dir + table[f].file, document.baseURI).toString();
        const face = new FontFace(family, `url(${url})`, { weight, style });
        face.load().then(ff => document.fonts.add(ff)).catch(() => { /* card falls back to system sans */ });
      }
    }
  }

  /** Browser stand-ins for the PDF font families, so the picker cards render
   *  IN the face they select. */
  fontCss(v: string): string {
    if (v === 'times') return "'Times New Roman', Georgia, serif";
    if (v === 'courier') return "'Courier New', ui-monospace, monospace";
    return 'Arial, Helvetica, sans-serif';
  }

  // Live columns being edited in the Columns tab + their department, so the
  // preview can apply them to that department's sample tests before save.
  private readonly editedCols = signal<ReportColumn[]>([]);
  /** Sequencing tab: a sample order from the lab's own departments + tests. */
  readonly seqPreviewTests = signal<Array<Record<string, unknown>>>([]);
  /** Entering / leaving Sequencing swaps the preview's sample order. */
  private readonly onSequenceTab = computed(() => this._tab() === 'sequence');
  private readonly editedDeptName = signal<string>('');
  private readonly editedDeptCode = signal<string>('');
  onColumnsState(s: { departmentName: string; departmentCode: string; columns: ReportColumn[] }) {
    this.editedDeptName.set(s.departmentName);
    this.editedDeptCode.set(s.departmentCode);
    this.editedCols.set(s.columns);
  }
  patchKey(key: keyof ReportTemplate, val: unknown) {
    this.patch({ [key]: val } as Partial<ReportTemplate>);
  }
  patchBool(key: keyof ReportTemplate, v: boolean) {
    this.patch({ [key]: v } as Partial<ReportTemplate>);
  }
  getBool(key: keyof ReportTemplate, dflt: boolean): boolean {
    const v = (this._tpl() as unknown as Record<string, unknown>)[key];
    return typeof v === 'boolean' ? v : dflt;
  }
  colorOf(key: keyof ReportTemplate): string {
    return (this._tpl() as unknown as Record<string, string>)[key as string] ?? '';
  }

  private defaultTemplate(): ReportTemplate {
    return {
      id: '', tenantId: '',
      labName: 'Prefrontal Pathology Lab',
      tagline: 'Accurate | Caring | Instant',
      address: '', phone: '', email: '', website: '', logoUrl: '',
      nablAccredited: false, nablNumber: '', nablLogoUrl: '',
      headerPreset: 'classic', logoPosition: 'left', logoSize: 'md', topAccentBar: true,
      primaryColor: '#1B3A6B', accentColor: '#0066CC',
      tableHeaderBg: '#ffffff', tableHeaderText: '#000000',
      bodyTextColor: '#1a1a1a', dividerColor: '#cccccc',
      fontFamily: 'helvetica', fontSize: 'md',
      tableStyle: 'plain', zebraRows: false,
      patientLayout: 'three-col',
      showPatientName: true, showAge: true, showRefDoctor: true,
      showOrderId: true, showAbhaId: false,
      showBarcode: true, showQrCode: true,
      dateFormat: 'dd MMM yyyy', timeFormat: '12h', dateTimeSeparator: ', ',
      showRegistered: true, showCollectionDate: true, showReportDate: true,
      showMethod: false, showInstrument: false,
      groupByDepartment: false, showCriticalFlag: true, flagStyle: 'bold', flagIndicator: 'letter', abnormalColor: '#dc2626', abnormalLowColor: '#2563eb',
      showPathologistName: true, showSignature: true,
      signatureUrl: '', signaturesJson: '[]',
      disclaimer: 'Test results should be correlated clinically.',
      footerText: '',
      watermarkText: '', watermarkOpacity: 0.08,
      showSampleCollectionBand: true,
      endOfReportText: '****End of Report****',
      showPoweredBy: true,
    };
  }

  // (Dead signature-editor UI removed — the "Sign-off & Footer" tab never bound
  //  add/remove/updateSignature; the PDF renderer reads signaturesJson directly.)

  // ── Live preview ─────────────────────────────────────────────
  private readonly _previewUrl = signal<string | null>(null);
  readonly previewUrl = this._previewUrl.asReadonly();
  /** The same preview's blob URL without viewer hints — the designer draws page 1. */
  readonly rawPreviewUrl = signal<string | null>(null);
  /** Uploaded images (logo, NABL…) as data URLs — the designer measures with them. */
  readonly imageCache = signal<Record<string, string>>({});
  /** Sanitised version of the blob URL — Angular blocks raw blob: URIs
   *  in `[src]` bindings otherwise. */
  readonly previewSafe = computed<SafeResourceUrl | null>(() => {
    const u = this._previewUrl();
    return u ? this.sanitizer.bypassSecurityTrustResourceUrl(u) : null;
  });
  readonly rendering = signal<boolean>(false);
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Debounced live-preview render — every template change schedules a
    // 300ms tick that regenerates the blob URL (avoids hammering jsPDF
    // on every keystroke).
    effect(() => {
      const tpl = this._tpl();
      // Also depend on the columns being edited so the preview reflects the
      // Columns tab live (per-department), and on the patient-strip scope
      // draft so a department arrangement previews as you drag.
      this.editedCols(); this.editedDeptName(); this.editedDeptCode();
      this.patientScope(); this.patientCols(); this.deptPatientLayout();
      // Sequencing tab: the preview runs on the lab's own departments/tests.
      this.seqPreviewTests(); this.onSequenceTab();
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.rendering.set(true);
      this.renderTimer = setTimeout(() => this.renderPreview(tpl), 300);
    });
  }

  /** Build resolved layouts for the sample tests so the preview applies the
   *  columns being edited to that department's tests (other departments fall
   *  back to the default layout — demonstrating per-department sections). */
  private buildPreviewLayouts(): Record<string, ResolvedReportLayout> {
    const cols = this.editedCols();
    if (!cols.length) return {};
    const dn = this.editedDeptName().trim().toLowerCase();
    const dc = this.editedDeptCode().trim().toLowerCase();
    if (!dn && !dc) return {};
    let snap: { tests?: { testId: string; name?: string; department?: string; departmentCode?: string; sampleType?: string }[] };
    try { snap = JSON.parse(this.sampleSnapshot()); } catch { return {}; }
    const out: Record<string, ResolvedReportLayout> = {};
    const apply = (t: { testId: string; name?: string; sampleType?: string }) => {
      out[t.testId] = {
        testId: t.testId, testName: t.name ?? '', sampleType: t.sampleType ?? '',
        columns: cols, sections: [], configured: true, version: 1,
      } as unknown as ResolvedReportLayout;
    };
    // Columns tab: the preview mirrors the department being edited — every
    // sample test takes the edited columns (the render step also relabels the
    // department bands), so what you see IS what you're configuring.
    if (this.tab() === 'columns') {
      for (const t of snap.tests ?? []) apply(t);
      return out;
    }
    let matched = 0;
    for (const t of snap.tests ?? []) {
      const td = (t.department ?? '').trim().toLowerCase();
      const tc = (t.departmentCode ?? '').trim().toLowerCase();
      const match = (!!td && (td === dn || td === dc)) || (!!tc && (tc === dn || tc === dc));
      if (match) { apply(t); matched++; }
    }
    // When the edited department isn't in the sample data, apply to every test
    // so the edit is ALWAYS visible instead of silently no-oping.
    if (matched === 0) for (const t of snap.tests ?? []) apply(t);
    return out;
  }

  private async renderPreview(tpl: ReportTemplate) {
    try {
      // Columns tab: relabel the whole sample report to the department being
      // edited so ONE section — titled with that department — previews the
      // strip exactly; empty configured columns stay visible.
      let data = this.tab() === 'sequence' ? sequencePreviewSnapshot(this.sampleSnapshot(), this.seqPreviewTests()) : this.sampleSnapshot();
      const onColumns = this.tab() === 'columns';
      if (onColumns && (this.editedDeptName() || this.editedDeptCode())) {
        try {
          const snap = JSON.parse(data);
          for (const t of snap.tests ?? []) {
            t.department = this.editedDeptName() || t.department;
            t.departmentCode = this.editedDeptCode() || t.departmentCode;
          }
          data = JSON.stringify(snap);
        } catch { /* keep the raw sample */ }
      }
      // A department scope previews ITS draft arrangement — swap the strip
      // fields on a copy so the preview shows what that department prints.
      const scopedTpl = this.patientScope() === 'default' ? tpl : {
        ...tpl,
        patientLayout: this.deptPatientLayout(),
        patientColumnsJson: JSON.stringify(this.patientCols()),
      };
      const effTpl = previewTemplateForTab(this.tab(), scopedTpl);
      const baseInput = {
        report: { id: 'preview-' + Date.now(), type: 'final',
                  createdAt: new Date().toISOString(), data },
        template: effTpl,
        resolvedLayouts: this.buildPreviewLayouts(),
        previewKeepEmptyColumns: onColumns,
      };
      // Preload uploaded images (logo, NABL, sig scans) as data URLs.
      // The sync renderer can't fetch images itself, so this step
      // hydrates an IMG_CACHE map keyed by the relative URL.
      const imageCache = await preloadReportImages(baseInput, this.platform.getApiUrl());
      const prev = this._previewUrl();
      if (prev) URL.revokeObjectURL(prev);
      const url = renderReportPdfBlobUrl({ ...baseInput, imageCache });
      this.squeeze.set(lastReportSqueeze());
      this.issues.set(reportIssues({ ...baseInput, imageCache }));
      this.imageCache.set(imageCache);
      this.rawPreviewUrl.set(url);
      // #view=FitH&toolbar=0 gives a clean top-fit preview in Chrome/FF.
      this._previewUrl.set(url + '#view=FitH&toolbar=0');
    } catch (e) {
      console.error('preview render failed', e);
    } finally {
      this.rendering.set(false);
    }
  }

  /** Sample report payload that exercises the visible chrome — patient
   *  block, multi-test grouping, sample type, multi-parameter test. */
  private sampleSnapshot(): string {
    return JSON.stringify({
      patient: { id: 'preview-patient', displayName: 'Sita Raman', age: 37, sex: 'Female', phone: '9080706050' },
      order:   { id: 'preview-order-12345',
                 // A realistic order number so the preview's barcode is a true
                 // Code-128 of a scannable value, not a placeholder.
                 orderNumber: 'LAB-2608-000042',
                 // Sample token so a placed patient-strip Order QR previews.
                 trackToken: 'SAMPLE',
                 createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
                 refDoctorName: 'Dr. A. Sharma',
                 refHospitalName: 'Apollo Speciality Hospital',
                 branchName: 'Chennai Main',
                 collectedBy: 'S. Priya',
                 departments: 'Haematology, Biochemistry' },
      type: 'final',
      tests: [
        { testId: 'd1', name: 'Complete Blood Count (CBC)', department: 'Haematology', departmentCode: 'HAEM',
          sampleType: 'EDTA Whole Blood', method: 'Automated cell counter',
          result: { values: {
            'Hemoglobin':   { value: '11.4', unit: 'g/dL',     range: '12.0 – 16.0', flag: 'L', description: 'Low in anaemia / blood loss' },
            'RBC Count':    { value: '4.6',  unit: 'mill/cmm',  range: '3.8 – 4.8' },
            'WBC Count':    { value: '12800', unit: '/cmm',     range: '4000 – 11000', flag: 'H', description: 'Raised in acute infection' },
            'Platelets':    { value: '240000', unit: '/cmm',    range: '150000 – 410000' },
          } } },
        { testId: 'd2', name: 'Lipid Profile', department: 'Biochemistry', departmentCode: 'BIO',
          sampleType: 'Serum', method: 'Photometry',
          result: { values: {
            'Total Cholesterol': { value: '210', unit: 'mg/dL', range: '< 200', flag: 'H', description: 'Dietary review advised' },
            'HDL Cholesterol':   { value: '52',  unit: 'mg/dL', range: '> 40' },
            'LDL Cholesterol':   { value: '135', unit: 'mg/dL', range: '< 100', flag: 'H' },
            'Triglycerides':     { value: '120', unit: 'mg/dL', range: '< 150' },
          } } },
        { testId: 'd3', name: 'Vitamin D (25-OH)', department: 'Biochemistry', departmentCode: 'BIO',
          sampleType: 'Serum', nablScope: false, referralLab: 'Reference Labs Pvt. Ltd., Mumbai',
          result: { values: {
            '25-Hydroxy Vitamin D': { value: '18', unit: 'ng/mL', range: '30 – 100', flag: 'L' },
          } } },
        // A multi-page preview, only while a choice that shows on pages 2+ is on (the patient line, "Page N of M").
        ...(this.reportStyle().patient.continuation !== 'none' || this.reportStyle().pageNumbers === 'n-of-m' ? PREVIEW_EXTRA_TESTS : []),
      ],
    });
  }

  /** First load: skeleton until the lab's template lands (held, no flash). */
  private readonly tplHold = createLoadHold(true);
  readonly tplSkeleton = this.tplHold.active;
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit() {
    const initial = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (initial && this.sections.some(o => o.value === initial)) {
      this._tab.set(initial);
    }
    if (this._tab() === 'table') this.loadSourceSansFace();
    this.destroyRef.onDestroy(() => this.tplHold.cancel());
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({
      next: t => {
        if (t) this._tpl.set({ ...this._tpl(), ...t, headerPreset: normalizeHeaderPreset(t.headerPreset ?? this._tpl().headerPreset) });
        this.savedJson.set(JSON.stringify(this._tpl()));
        this.past.set([]); this.future.set([]);
        this.initPatientCols();
        this.tplHold.done();
      },
      error: () => this.tplHold.done(),
    });
    this.loadCustomPatientFields();
    this.initPatientCols();
    this.api.get<{ id: string; name: string }[]>('/api/tenants/departments').subscribe({
      next: d => this.departments.set((d ?? []).map(x => ({ id: x.id, name: x.name }))),
    });
  }

  // ── Custom patient fields (from the Patient Registration form flow) ──
  readonly customPatientFields = signal<{ name: string; title: string }[]>([]);

  /** Pull the non-standard fields defined in the patient_registration form flow
   *  so the lab can choose which to print on the report. */
  private loadCustomPatientFields() {
    this.api.get<{ configJson?: string }>('/api/workflows/patient_registration').subscribe({
      next: rec => {
        try {
          const cfg = rec?.configJson ? JSON.parse(rec.configJson) : null;
          // Offer EVERY registration field that isn't already a built-in patient
          // toggle (matched by name) — so "whatever is there" in the form flow
          // becomes an option, regardless of the isStandard flag.
          const builtIn = new Set([
            'first_name', 'fathers_name', 'father_name', 'last_name', 'middle_name',
            'displayname', 'display_name', 'name', 'full_name',
            'sex', 'gender', 'age', 'date_of_birth', 'dob',
            'phone', 'mobile', 'abha_id', 'mrn', 'patient_id', 'order_id',
            'barcode', 'ref_doctor', 'referring_doctor', 'ref_doctor_name', 'refdoctor',
          ]);
          const fields: { name: string; title: string }[] = [];
          const seen = new Set<string>();
          for (const step of cfg?.steps ?? []) {
            for (const f of step?.fields ?? []) {
              if (f && f.name && !builtIn.has(String(f.name).toLowerCase()) && !seen.has(f.name)) {
                seen.add(f.name);
                fields.push({ name: f.name, title: f.title || f.name });
              }
            }
          }
          this.customPatientFields.set(fields);
        } catch { this.customPatientFields.set([]); }
      },
      error: () => this.customPatientFields.set([]),
    });
  }

  private enabledPatientFields(): { name: string; title: string }[] {
    try {
      const arr = JSON.parse(this._tpl().patientFieldsJson || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  isPatientFieldOn(name: string): boolean {
    return this.enabledPatientFields().some(f => f.name === name);
  }
  togglePatientField(field: { name: string; title: string }, on: boolean) {
    const cur = this.enabledPatientFields().filter(f => f.name !== field.name);
    if (on) cur.push({ name: field.name, title: field.title });
    this.patch({ patientFieldsJson: JSON.stringify(cur) });
  }

  // ── Drag-arranged 3-column patient block ──
  private readonly ALL_PATIENT_ITEMS = [
    'name', 'age', 'sex', 'mrn', 'phone', 'orderid', 'refdoctor',
    // Referral + collection details. Sourced from the ORDER (not the patient
    // record), so they arrive via the report snapshot's `order` block.
    'refhospital', 'collectedby', 'department', 'branch',
    'specimen', 'barcode', 'registered', 'collected', 'reported',
    // Patient-strip QR codes (owner, 2026-09-28) — opt-in, start in Unused.
    PROFILE_QR_KEY, ORDER_QR_KEY,
  ];
  private readonly DEFAULT_PATIENT_COLS: string[][] = [
    ['name', 'age', 'sex', 'mrn'],
    ['specimen', 'refdoctor'],
    ['barcode', 'registered', 'collected', 'reported'],
  ];
  private readonly PATIENT_ITEM_LABELS: Record<string, string> = {
    name: 'Patient name', age: 'Age', sex: 'Sex', mrn: 'MRN', phone: 'Phone',
    ageSex: 'Age / Sex', orderid: 'Order ID', refdoctor: 'Referring doctor', specimen: 'Specimen(s)',
    barcode: 'Barcode', registered: 'Registered date', collected: 'Collected date',
    reported: 'Reported date',
    refhospital: 'Referring hospital', collectedby: 'Collected by',
    department: 'Department', branch: 'Branch / collection centre',
    [PROFILE_QR_KEY]: 'Patient profile QR', [ORDER_QR_KEY]: 'Order QR (report download)',
  };

  /** The two patient-strip QR options, surfaced as switches above the
   *  drag board (the chips stay draggable like any other field). */
  readonly stripQrOptions = [
    { key: PROFILE_QR_KEY, label: 'Patient profile QR',
      desc: 'Scanning opens this patient\u2019s profile in the app. Staff sign in first; anyone else only reaches the login.' },
    { key: ORDER_QR_KEY, label: 'Order QR \u2014 report soft copy',
      desc: 'Scanning opens the patient\u2019s report page: they confirm date of birth, phone or invoice no. and download the report. Until it is ready, the page shows the order status.' },
  ];
  stripQrOn(key: string): boolean { return this.patientCols().some(c => c.includes(key)); }
  toggleStripQr(key: string) {
    this.commitPatientCols(toggleStripQrKey(this.patientCols(), key));
  }

  readonly patientCols = signal<string[][]>([[], [], []]);

  /** Items not currently placed in any column (built-ins + ALL custom fields).
   *  In a column = printed; here in Unused = hidden. */
  readonly patientPool = computed<string[]>(() => {
    const placed = new Set(this.patientCols().flat());
    const custom = this.customPatientFields().map(f => f.name);
    // One field for age and sex: its chip stands where the two stood.
    const combined = this.reportStyle().patient.ageSex === 'combined';
    const builtIn = combined ? this.ALL_PATIENT_ITEMS.flatMap(k => (k === 'age' ? ['ageSex'] : k === 'sex' ? [] : [k])) : this.ALL_PATIENT_ITEMS;
    const all = [...builtIn, ...custom];
    return all.filter((k, i) => all.indexOf(k) === i && !placed.has(k));
  });

  patientItemLabel(k: string): string {
    return this.PATIENT_ITEM_LABELS[k]
      ?? this.customPatientFields().find(f => f.name === k)?.title
      ?? this.enabledPatientFields().find(f => f.name === k)?.title
      ?? k;
  }

  /** Number of patient-block columns for a layout. */
  private colCountFor(layout: string | undefined): number {
    return layout === 'four-col-grid' ? 4 : layout === 'stacked' ? 1 : 3;
  }

  // ── Department-specific patient strip ─────────────────────
  // 'default' edits the tenant template (autosaved with the page's Save);
  // a department id edits that department's own arrangement, stored via
  // /api/report-layout/department/{id}/patient and applied by the PDF
  // renderer when a report holds only that department's tests.
  readonly departments = signal<{ id: string; name: string }[]>([]);
  readonly patientScope = signal<string>('default');
  readonly patientScopeOptions = computed(() => [
    { value: 'default', label: 'Default — all departments' },
    ...this.departments().map(d => ({ value: d.id, label: d.name })),
  ]);
  readonly deptPatientConfigured = signal(false);
  readonly deptPatientDirty = signal(false);
  readonly deptPatientSaving = signal(false);
  private readonly deptPatientLayout = signal<string>('three-col');

  patientLayoutValue(): string {
    return this.patientScope() === 'default'
      ? (this._tpl().patientLayout ?? 'three-col')
      : this.deptPatientLayout();
  }

  onPatientScopeChange(scope: string) {
    this.patientScope.set(scope);
    this.deptPatientDirty.set(false);
    if (scope === 'default') { this.deptPatientConfigured.set(false); this.initPatientCols(); return; }
    this.api.get<{ patient?: { layout?: string; columns?: string[][] } | null; configured?: boolean }>(
      `/api/report-layout/department/${scope}/patient`).subscribe({
      next: r => {
        this.deptPatientConfigured.set(!!r?.configured);
        const cols = r?.patient?.columns;
        if (cols && cols.length && cols.some(c => Array.isArray(c))) {
          const layout = r!.patient!.layout ?? 'three-col';
          this.deptPatientLayout.set(layout);
          this.patientCols.set(this.fitColumns(cols.map(c => [...(c ?? [])]), this.colCountFor(layout)));
        } else {
          // No override yet — the draft starts from the tenant default.
          this.deptPatientLayout.set(this._tpl().patientLayout ?? 'three-col');
          this.seedPatientColsFromTemplate();
        }
      },
      error: (e: ApiError) => {
        // Snap back to a safe state, but LOUDLY — a silent revert reads as
        // "the switch does nothing" (it did, against an mw without this
        // endpoint).
        this.patientScope.set('default');
        this.deptPatientConfigured.set(false);
        this.initPatientCols();
        this.toasts.error(e?.message || 'Could not load that department\'s strip — is the server up to date?');
      },
    });
  }

  saveDeptPatient() {
    const dept = this.patientScope();
    if (dept === 'default' || this.deptPatientSaving()) return;
    this.deptPatientSaving.set(true);
    this.api.post(`/api/report-layout/department/${dept}/patient`, {
      patient: { layout: this.deptPatientLayout(), columns: this.patientCols() },
    }).subscribe({
      next: () => {
        this.deptPatientSaving.set(false);
        this.deptPatientConfigured.set(true);
        this.deptPatientDirty.set(false);
        this.toasts.success('Department patient strip saved');
      },
      error: (e: ApiError) => { this.deptPatientSaving.set(false); this.toasts.error(e?.message || 'Save failed'); },
    });
  }

  resetDeptPatient() {
    const dept = this.patientScope();
    if (dept === 'default') return;
    this.api.post(`/api/report-layout/department/${dept}/patient`, { patient: null }).subscribe({
      next: () => {
        this.deptPatientConfigured.set(false);
        this.deptPatientDirty.set(false);
        this.deptPatientLayout.set(this._tpl().patientLayout ?? 'three-col');
        this.seedPatientColsFromTemplate();
        this.toasts.success('Back to the default strip');
      },
      error: (e: ApiError) => this.toasts.error(e?.message || 'Reset failed'),
    });
  }

  /** Load the tenant-default arrangement into the editor WITHOUT touching
   *  scope state — used to seed a fresh department draft. */
  private seedPatientColsFromTemplate() {
    const n = this.colCountFor(this.deptPatientLayout());
    let cols: string[][] | null = null;
    const saved = this._tpl().patientColumnsJson;
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.every(Array.isArray)) cols = arr;
      } catch { cols = null; }
    }
    cols = cols ?? this.DEFAULT_PATIENT_COLS.map(c => [...c]);
    if (this.reportStyle().patient.ageSex === 'combined') cols = swapAgeSexColumns(cols, true);
    this.patientCols.set(this.fitColumns(cols, n));
  }

  private initPatientCols() {
    if (this.patientScope() !== 'default') return;
    const n = this.colCountFor(this._tpl().patientLayout);
    let cols: string[][] | null = null;
    const saved = this._tpl().patientColumnsJson;
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.every(Array.isArray)) cols = arr;
      } catch { cols = null; }
    }
    cols = cols ?? this.DEFAULT_PATIENT_COLS.map(c => [...c]);
    if (this.reportStyle().patient.ageSex === 'combined') cols = swapAgeSexColumns(cols, true);
    this.patientCols.set(this.fitColumns(cols, n));
  }

  /** Reshape a column set to exactly n columns, preserving item placement
   *  (pad with empty columns, or merge overflow into the last kept column). */
  private fitColumns(cols: string[][], n: number): string[][] {
    const out = cols.map(c => [...c]);
    if (out.length < n) while (out.length < n) out.push([]);
    else if (out.length > n) {
      const extra = out.slice(n).flat();
      out.length = n;
      out[n - 1] = [...out[n - 1], ...extra];
    }
    return out;
  }

  /** Always show a valid option in the date-format / separator selects, even if
   *  the saved value is empty or no longer a known option. */
  dateFormatValue(): string {
    const v = this._tpl().dateFormat;
    return this.dateFormatOptions.some(o => o.value === v) ? v! : 'dd MMM yyyy';
  }
  separatorValue(): string {
    const v = this._tpl().dateTimeSeparator;
    return this.separatorOptions.some(o => o.value === v) ? v! : ', ';
  }

  /** Per-column-count cache so switching layouts (e.g. 3 → stacked → 3) restores
   *  the previous arrangement instead of dumping everything into column 1. */
  private patientColsCache = new Map<number, string[][]>();

  /** Switch layout → set the column count and reshape the arrangement, keeping
   *  the previous arrangement for that count if we've seen it this session. */
  setPatientLayout(layout: string) {
    const curN = this.patientCols().length;
    this.patientColsCache.set(curN, this.patientCols().map(c => [...c]));
    const n = this.colCountFor(layout);
    const cols = this.patientColsCache.has(n)
      ? this.patientColsCache.get(n)!.map(c => [...c])
      : this.redistribute(this.patientCols(), n);
    this.patientCols.set(cols);
    this.patientColsCache.set(n, cols.map(c => [...c]));
    if (this.patientScope() !== 'default') {
      this.deptPatientLayout.set(layout);
      this.deptPatientDirty.set(true);
      return;
    }
    const placed = new Set(cols.flat());
    const placedCustom = this.customPatientFields().filter(f => placed.has(f.name));
    this.patch({
      patientLayout: layout,
      patientColumnsJson: JSON.stringify(cols),
      patientFieldsJson: JSON.stringify(placedCustom),
    });
  }

  /** Spread the currently-placed items into n columns as contiguous chunks
   *  (preserves order; for n=1 everything stacks into one column). */
  private redistribute(cols: string[][], n: number): string[][] {
    const flat = cols.flat();
    const out: string[][] = Array.from({ length: n }, () => []);
    const per = Math.max(1, Math.ceil(flat.length / n));
    flat.forEach((item, i) => out[Math.min(n - 1, Math.floor(i / per))].push(item));
    return out;
  }

  dropPatientItem(ev: CdkDragDrop<string[]>) {
    const cols = this.patientCols().map(c => [...c]);
    const pool = [...this.patientPool()];
    const arrOf = (id: string) => id === 'pcol-pool' ? pool : cols[Number(id.replace('pcol-', ''))];
    const from = arrOf(ev.previousContainer.id);
    const to = arrOf(ev.container.id);
    if (ev.previousContainer === ev.container) {
      moveItemInArray(to, ev.previousIndex, ev.currentIndex);
    } else {
      transferArrayItem(from, to, ev.previousIndex, ev.currentIndex);
    }
    this.commitPatientCols(cols);
  }

  /** Apply a new column arrangement: a department scope marks its draft dirty;
   *  the default scope patches the template. */
  private commitPatientCols(cols: string[][]) {
    this.patientCols.set(cols);                    // pool is derived → recomputes
    if (this.patientScope() !== 'default') { this.deptPatientDirty.set(true); return; }
    // Persist the arrangement + the titles of any custom fields now placed in a
    // column (so the PDF can label them; placement is the single shown/hidden
    // control — no separate toggle).
    const placed = new Set(cols.flat());
    const placedCustom = this.customPatientFields().filter(f => placed.has(f.name));
    this.patch({
      patientColumnsJson: JSON.stringify(cols),
      patientFieldsJson: JSON.stringify(placedCustom),
    });
  }

  ngOnDestroy() {
    const prev = this._previewUrl();
    if (prev) URL.revokeObjectURL(prev);
    if (this.renderTimer) clearTimeout(this.renderTimer);
  }

  // ── Save ────────────────────────────────────────────────────
  readonly saving = signal<boolean>(false);
  save() {
    if (this.saving()) return;
    this.saving.set(true);
    // Send every field — the server merges with defaults and writes one row.
    const sent = this._tpl();
    this.api.post('/api/config/report-template', sent).subscribe({
      next: () => { this.savedJson.set(JSON.stringify(sent)); this.toasts.success('Template saved'); this.saving.set(false); },
      error: (e) => { this.toasts.error(ApiError.from(e).message); this.saving.set(false); },
    });
  }
}

/** Sequencing tab: the sample report with the lab's own departments and
 *  tests (a desk order), so every move shows on the page. Falls back to the
 *  standard sample until those load. */
export function sequencePreviewSnapshot(sample: string, tests: Array<Record<string, unknown>>): string {
  if (!tests.length) return sample;
  try {
    const snap = JSON.parse(sample) as Record<string, unknown>;
    const depts = [...new Set(tests.map(t => String(t['department'] ?? '')).filter(Boolean))];
    const order = { ...(snap['order'] as Record<string, unknown>), departments: depts.join(', ') };
    return JSON.stringify({ ...snap, order, tests });
  } catch { return sample; }
}

/** Table columns tab: the preview must open on the department table being
 *  edited — the consolidated abnormal-results sheet (a fixed 3-column page 1)
 *  would hide it. Preview only; the saved template and real reports keep the
 *  lab's setting. */
export function previewTemplateForTab<T extends Pick<ReportTemplate, 'metadata'>>(tab: string, tpl: T): T {
  if (tab !== 'columns' || !readReportOption(tpl, 'abnormalSummary')) return tpl;
  return { ...tpl, metadata: writeReportOption(tpl, 'abnormalSummary', false) };
}

/** Switch a patient-strip QR on/off in a column arrangement. Off: removed from
 *  every column. On: placed beside the other QR when that one is already
 *  printing (they then print side by side), else at the end of the last column. */
export function toggleStripQrKey(cols: string[][], key: string): string[][] {
  const out = cols.map(c => [...c]);
  if (out.some(c => c.includes(key))) return out.map(c => c.filter(k => k !== key));
  if (out.length === 0) return [[key]];
  const other = key === PROFILE_QR_KEY ? ORDER_QR_KEY : PROFILE_QR_KEY;
  const withOther = out.find(c => c.includes(other));
  if (withOther) {
    const i = withOther.indexOf(other);
    // Profile first, then Order — a stable reading order on the page.
    withOther.splice(key === PROFILE_QR_KEY ? i : i + 1, 0, key);
    return out;
  }
  out[out.length - 1].push(key);
  return out;
}
