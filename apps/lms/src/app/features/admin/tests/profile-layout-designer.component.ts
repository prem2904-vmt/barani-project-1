import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { PageLayoutBox, PageLayoutBoxKind, ReportColumn, ReportSection } from '../../../shared/models/report-layout.model';
import type { ReportTemplate } from '../../../shared/models/report.model';
import {
  KNOWN_ANALYZER_IMAGES, MIN_BODY_FONT_PT, PAGE, RESIZE_HANDLES, addPaletteBox, analyzerLabel, analyzerSampleAsset, bodyArea,
  boxLabel, buildDefaultLayout, detectLayoutIssues, dragBox, fitMeter, isCbcFamily, nudgeBox, patchBox, readPageLayout, removeBox,
  resizeBox, resizeFromHandle, setBoxHidden, setColumnVisible, writePageLayout,
  type BodyArea, type PageLayoutIssue, type ResizeHandle, type SnapGuides,
} from '../../../shared/utils/report-profile-layout';
import { MM, ptToMm } from '../../../shared/utils/report-header-layout';
import { computeReportPageLayout, renderReportPdfBlobUrl, type ReportPdfInput } from '../../../shared/utils/report-pdf';
import {
  applyLivePageLayout, buildSamplePreviewInput, namesFromParametersJson, withSampleImagesLoaded, type PreviewProfileMember,
} from '../../../shared/utils/report-sample-preview';
import { defaultChartSpec } from '../../../shared/utils/report-chart/report-chart.model';
import type { ChartEditorContext } from '../../../shared/utils/report-chart/report-chart.sample';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ReportLayoutService, type ProfileAnalyzerImages } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { SelectComponent, type PfSelectOption } from '../../../shared/primitives/select.component';

/** Nudge steps (mm) — the letterhead editor's choice; Shift+arrow = 5 mm. */
const STEPS = [0.5, 1, 5];
const HISTORY_MAX = 60;

interface PaletteImage { code: string; label: string; detail: string; onPage: boolean; hidden: boolean }
interface ChartBlock { id: string; label: string; onPage: boolean }
interface DragState {
  id: string; mode: 'move' | 'resize'; handle?: ResizeHandle;
  /** px offset the ghost image is drawn at inside the moving box (resize from n/w). */
  ghost: string | null; origin: PageLayoutBox;
}

/**
 * The profile's ONE-PAGE report layout designer (owner review 2026-10-02 —
 * "the same interaction quality as the letterhead editor").
 *
 * The page IS the real report: the SAME sample report the test editor's Live
 * preview renders (report-sample-preview.ts — plausible member values with
 * their units and ranges, the tenant's real letterhead/footer, SAMPLE
 * analyzer graphs that look like the instrument's), drawn by the real PDF
 * pipeline and painted with pdf.js. Over it sits one outline per box, placed
 * from the EXACT body rect the renderer reports back (`onOnePageBody`), so
 * what you drag is what prints:
 *   · press-and-drag moves a box (edges and centres snap to the body and to
 *     the other boxes, with guide lines); 8 handles resize it;
 *   · arrow keys nudge (step 0.5 / 1 / 5 mm, Shift = 5 mm), Delete removes,
 *     Ctrl+Z / Ctrl+Shift+Z undo / redo, Esc clears the selection;
 *   · the side card adds boxes from a palette (results table, charts, the
 *     analyzer's own graphs with thumbnails, signatures, text) or edits the
 *     selected one in exact millimetres.
 *
 * Stateless towards storage: the host (pf-report-structure) owns the sections
 * array and autosaves; this emits the whole updated array (`sectionsChange`)
 * and the live box set (`liveChange`) for the Live preview.
 */
@Component({
  selector: 'pf-profile-layout-designer',
  standalone: true,
  imports: [FormsModule, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pld-host' },
  template: `
  <div class="pld" [class.pld--guides]="guides()">
    <!-- ══ MAIN CARD: the page ══ -->
    <section class="nd-card pld-main" aria-label="One-page layout">
      <div class="nd-card__head pld-main__head">
        <span class="nd-card__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></svg>
        </span>
        <span class="nd-card__label">One-page layout</span>
        <div class="pld-tools">
          <button type="button" class="nd-btn nd-btn--icon pld-tool" [disabled]="!canUndo()" (click)="undo()" aria-label="Undo" title="Undo (Ctrl+Z)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
          </button>
          <button type="button" class="nd-btn nd-btn--icon pld-tool" [disabled]="!canRedo()" (click)="redo()" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
          </button>
          <div class="nd-seg pld-zoom" role="radiogroup" aria-label="Zoom">
            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="zoom() === 1" (click)="zoom.set(1)">Fit</button>
            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="zoom() === 1.5" (click)="zoom.set(1.5)">150%</button>
          </div>
          <button type="button" class="nd-toggle pld-guides" role="switch" [attr.aria-checked]="guides()" (click)="guides.set(!guides())">
            <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Guides
          </button>
        </div>
      </div>

      <div class="pld-onrow">
        <div class="pld-onrow__txt">
          <p class="pld-onrow__t">Print this profile as one page</p>
          <p class="pld-onrow__s">{{ enabled() ? 'On — reports print this arrangement.' : 'Off — reports print the normal results table. Arrange the page, then switch it on.' }}</p>
        </div>
        <button type="button" class="nd-btn nd-btn--tertiary" (click)="restoreDefault()" [disabled]="restoring()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
          {{ restoring() ? 'Restoring…' : 'Restore to default' }}
        </button>
        <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="enabled()" aria-label="Print this profile as one page" (click)="setEnabled(!enabled())">
          <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
        </button>
      </div>

      <div class="pld-viewport" #viewport>
        <div class="pld-page" #page [style.width.px]="pageW()" [style.height.px]="pageW() * PAGE_RATIO"
             tabindex="0" role="application"
             aria-label="Report page. Tab to a box; arrow keys move the selected box, Delete removes it, Escape clears the selection."
             (keydown)="onKey($event)" (pointerdown)="onPagePointerDown($event)">
          <div class="pld-canvas" #canvasHost aria-hidden="true"></div>
          @if (!canvasReady()) {
            <div class="pld-loading" role="status" aria-busy="true" aria-label="Rendering the page…">
              <span class="pld-skel pld-skel--head"></span>
              <span class="pld-skel"></span><span class="pld-skel"></span><span class="pld-skel pld-skel--short"></span>
            </div>
          }

          <!-- The body the boxes live in (between the fixed letterhead/patient
               block and the fixed footer) — always outlined; guides add the
               centre line. -->
          <div class="pld-body" aria-hidden="true"
               [style.left.px]="bodyPx().x" [style.top.px]="bodyPx().y" [style.width.px]="bodyPx().w" [style.height.px]="bodyPx().h">
            <span class="pld-body__tag">Body · {{ round(bodyMm().w) }} × {{ round(bodyMm().h) }} mm</span>
            @if (guides()) { <span class="pld-body__centre"></span> }
          </div>
          <div class="pld-fixed pld-fixed--top" aria-hidden="true" [style.height.px]="bodyPx().y"><span>Letterhead &amp; patient details — fixed, from the Report template</span></div>
          <div class="pld-fixed pld-fixed--bottom" aria-hidden="true" [style.top.px]="bodyPx().y + bodyPx().h"><span>Footer — fixed</span></div>

          <!-- Snap guides while dragging / resizing. -->
          @for (g of guideLines().v; track $index) {
            <div class="pld-guide pld-guide--v" aria-hidden="true" [style.left.px]="bodyPx().x + g * mmPx()" [style.top.px]="bodyPx().y" [style.height.px]="bodyPx().h"></div>
          }
          @for (g of guideLines().h; track $index) {
            <div class="pld-guide pld-guide--h" aria-hidden="true" [style.top.px]="bodyPx().y + g * mmPx()" [style.left.px]="bodyPx().x" [style.width.px]="bodyPx().w"></div>
          }

          <!-- Where a dragged box came from: blanked until the page re-renders. -->
          @if (drag(); as d) {
            <div class="pld-hole" aria-hidden="true"
                 [style.left.px]="boxRect(d.origin).x" [style.top.px]="boxRect(d.origin).y"
                 [style.width.px]="boxRect(d.origin).w" [style.height.px]="boxRect(d.origin).h"></div>
          }
          @for (h of holes(); track h.id) {
            <div class="pld-hole" aria-hidden="true" [style.left.px]="h.x" [style.top.px]="h.y" [style.width.px]="h.w" [style.height.px]="h.h"></div>
          }

          @for (b of boxes(); track b.id) {
            <div class="pld-box" role="button" tabindex="0"
                 [class.pld-box--sel]="selected() === b.id"
                 [class.pld-box--hidden]="b.hidden"
                 [class.pld-box--warn]="warnIds().has(b.id)"
                 [class.pld-box--drag]="drag()?.id === b.id"
                 [style.left.px]="boxRect(b).x" [style.top.px]="boxRect(b).y"
                 [style.width.px]="boxRect(b).w" [style.height.px]="boxRect(b).h"
                 [attr.aria-label]="labelFor(b) + (b.hidden ? ' (hidden)' : '') + (selected() === b.id ? ', selected' : '')"
                 [attr.aria-pressed]="selected() === b.id"
                 (pointerdown)="onBoxPointerDown($event, b)" (focus)="focusSelect(b.id)">
              @if (ghostFor(b.id); as g) {
                <span class="pld-box__ghost" aria-hidden="true" [style.background-image]="'url(' + g.url + ')'"
                      [style.background-size]="g.w + 'px ' + g.h + 'px'" [style.background-position]="g.dx + 'px ' + g.dy + 'px'"></span>
              }
              @if (b.hidden) { <span class="pld-box__hiddenmark" aria-hidden="true">Hidden</span> }
              <span class="pld-box__tag">
                @switch (b.kind) {
                  @case ('table') { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 10v10"/></svg> }
                  @case ('chart') { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> }
                  @case ('analyzer') { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20h18"/><path d="M4 19c3-1 4-12 7-12s3 9 5 9 3-3 4-3"/></svg> }
                  @case ('signatures') { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17c3 0 4-8 6-8s0 8 3 8 3-4 5-4 2 2 4 2"/><path d="M3 21h18"/></svg> }
                  @default { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg> }
                }
                {{ labelFor(b) }}
              </span>
              @if (drag()?.id === b.id) {
                <span class="pld-box__live nd-num">{{ readout(b) }}</span>
              }
              @if (selected() === b.id) {
                @for (h of handles; track h) {
                  <span class="pld-handle pld-handle--{{ h }}" aria-hidden="true" (pointerdown)="onHandlePointerDown($event, b, h)"></span>
                }
              }
            </div>
          }
        </div>
      </div>
      <div class="pld-foot">
        <span class="pld-fit" [class.pld-fit--bad]="!fit().fits">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            @if (fit().fits) { <path d="M20 6 9 17l-5-5"/> } @else { <path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/> }
          </svg>
          @if (fit().fits) {
            {{ rowCount() }} rows fit on one page{{ fit().shrinkToPt < (tableBox()?.fontSize ?? 9) ? ' at ' + fit().shrinkToPt + ' pt' : '' }}.
          } @else {
            {{ rowCount() }} rows don't fit the table box even at {{ minFontPt }} pt — make it taller, or the rest flows onto page 2.
          }
        </span>
        <span class="pld-foot__note">
          @if (rendering()) { Updating the page… } @else { Sample values and sample analyzer graphs — the real report prints the patient's. }
        </span>
      </div>
    </section>

    <!-- ══ SIDE CARD: selected box, or the palette ══ -->
    <aside class="nd-card pld-side" aria-label="Layout settings">
      <div class="nd-card__head">
        <span class="nd-card__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
        </span>
        <span class="nd-card__label">{{ selectedBox() ? labelFor(selectedBox()!) : 'Add to the page' }}</span>
        <span class="nd-card__spacer"></span>
        @if (selectedBox()) {
          <button type="button" class="nd-btn nd-btn--quiet" (click)="select(null)" aria-label="Back to the palette">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
            All boxes
          </button>
        }
      </div>

      <div class="nd-card__body pld-side__body">
        @if (selectedBox(); as b) {
          @if (issuesFor(b.id).length) {
            <ul class="pld-issues" role="status">
              @for (iss of issuesFor(b.id); track iss.message) {
                <li><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span>{{ iss.message }}</span></li>
              }
            </ul>
          }

          @if (b.kind !== 'table') {
            <div class="pld-row">
              <div><p class="pld-row__t">Print this box</p><p class="pld-row__s">{{ b.hidden ? 'Hidden — kept here, not printed' : 'Printed on the report' }}</p></div>
              <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="!b.hidden" aria-label="Print this box" (click)="toggleHidden(b)">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              </button>
            </div>
          } @else {
            <p class="nd-field__hint">The results table always prints — move and size it, choose its columns and type size.</p>
          }

          <section class="pld-sec" aria-label="Position and size">
            <h4 class="pld-sec__h">Position &amp; size (mm from the body's top-left)</h4>
            <div class="pld-nudge">
              <div class="pld-pad" role="group" aria-label="Move box">
                <button type="button" class="nd-btn nd-btn--icon pld-pad__up" (click)="nudge(0, -step())" aria-label="Move up"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
                <button type="button" class="nd-btn nd-btn--icon pld-pad__left" (click)="nudge(-step(), 0)" aria-label="Move left"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
                <button type="button" class="nd-btn nd-btn--icon pld-pad__right" (click)="nudge(step(), 0)" aria-label="Move right"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
                <button type="button" class="nd-btn nd-btn--icon pld-pad__down" (click)="nudge(0, step())" aria-label="Move down"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
              </div>
              <div class="pld-step">
                <span class="nd-field__lbl">Step</span>
                <div class="nd-seg" role="radiogroup" aria-label="Step size">
                  @for (st of steps; track st) {
                    <button type="button" class="nd-seg__item nd-num" role="radio" [attr.aria-checked]="step() === st" (click)="step.set(st)">{{ st }} mm</button>
                  }
                </div>
              </div>
            </div>
            <div class="pld-grid2">
              <label class="nd-field"><span class="nd-field__lbl">Left</span>
                <input class="nd-input nd-num" type="number" step="0.5" [ngModel]="round(b.x)" (change)="setGeom('x', $any($event.target).value)" /></label>
              <label class="nd-field"><span class="nd-field__lbl">Top</span>
                <input class="nd-input nd-num" type="number" step="0.5" [ngModel]="round(b.y)" (change)="setGeom('y', $any($event.target).value)" /></label>
              <label class="nd-field"><span class="nd-field__lbl">Width</span>
                <input class="nd-input nd-num" type="number" step="0.5" min="10" [ngModel]="round(b.w)" (change)="setGeom('w', $any($event.target).value)" /></label>
              <label class="nd-field"><span class="nd-field__lbl">Height</span>
                <input class="nd-input nd-num" type="number" step="0.5" min="8" [ngModel]="round(b.h)" (change)="setGeom('h', $any($event.target).value)" /></label>
            </div>
          </section>

          @switch (b.kind) {
            @case ('table') {
              <section class="pld-sec" aria-label="Table">
                <h4 class="pld-sec__h">Type size</h4>
                <div class="nd-seg" role="radiogroup" aria-label="Type size">
                  @for (f of fontSizes; track f) {
                    <button type="button" class="nd-seg__item nd-num" role="radio" [attr.aria-checked]="(b.fontSize ?? 9) === f" (click)="setFontSize(f)">{{ f }} pt</button>
                  }
                </div>
                <h4 class="pld-sec__h">Columns</h4>
                <ul class="pld-cols">
                  @for (c of tableColumns(); track c.name) {
                    <li>
                      <span>{{ c.label }}</span>
                      <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="colVisible(b, c.name)" [attr.aria-label]="'Print the ' + c.label + ' column'"
                              (click)="toggleColumn(c.name, !colVisible(b, c.name))">
                        <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
                      </button>
                    </li>
                  }
                </ul>
              </section>
            }
            @case ('analyzer') {
              <section class="pld-sec" aria-label="Analyzer graph">
                <div class="pld-thumbrow">
                  <span class="pld-thumb pld-thumb--lg"><img [src]="sampleAsset(b.ref ?? '')" alt="" /></span>
                  <p class="nd-field__hint">The analyzer's own graph prints here. When a run hasn't sent it, the box is left out and the table takes the room — never an empty frame.</p>
                </div>
                <label class="nd-field"><span class="nd-field__lbl">Graph</span>
                  <pf-select size="sm" [options]="imageOptions()" [value]="b.ref ?? ''" (valueChange)="setRef($event)" /></label>
                <label class="nd-field"><span class="nd-field__lbl">Caption</span>
                  <input class="nd-input" [ngModel]="b.label ?? ''" (change)="setLabel($any($event.target).value)" /></label>
              </section>
            }
            @case ('chart') {
              <section class="pld-sec" aria-label="Chart">
                <label class="nd-field"><span class="nd-field__lbl">Chart block</span>
                  <pf-select size="sm" [options]="chartOptions()" [value]="b.ref ?? ''" (valueChange)="setRef($event)" /></label>
                <p class="nd-field__hint">Edit what the chart shows in its block in the print order below.</p>
              </section>
            }
            @case ('notes') {
              <section class="pld-sec" aria-label="Text">
                <label class="nd-field"><span class="nd-field__lbl">Text that prints</span>
                  <textarea class="nd-input pld-ta" rows="3" [ngModel]="b.text ?? b.label ?? ''" (ngModelChange)="setText($event)"
                            placeholder="e.g. Kindly correlate clinically."></textarea></label>
              </section>
            }
          }

          @if (b.kind !== 'table') {
            <div class="pld-selfoot">
              <button type="button" class="nd-btn nd-btn--danger" (click)="remove(b.id)">Remove from the page</button>
            </div>
          }
        } @else {
          <!-- ── Palette ── -->
          <div class="pld-pal">
            @if (!hasVisible('table')) {
              <button type="button" class="pld-pal__item" (click)="add('table')">
                <span class="pld-pal__ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 10v10"/></svg></span>
                <span><b>Results table</b><small>Every value with its unit and reference range</small></span>
              </button>
            }
            <button type="button" class="pld-pal__item" [disabled]="hasVisible('signatures')" (click)="add('signatures')">
              <span class="pld-pal__ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3 0 4-8 6-8s0 8 3 8 3-4 5-4 2 2 4 2"/><path d="M3 21h18"/></svg></span>
              <span><b>Signatures</b><small>{{ hasVisible('signatures') ? 'On the page' : "The department's sign-off" }}</small></span>
            </button>
            <button type="button" class="pld-pal__item" (click)="add('notes')">
              <span class="pld-pal__ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>
              <span><b>Notes / text</b><small>A short line that prints in its own box</small></span>
            </button>
          </div>

          <section class="pld-sec" aria-label="Charts">
            <h4 class="pld-sec__h">Charts</h4>
            @for (c of chartBlocks(); track c.id) {
              <button type="button" class="pld-pal__item" (click)="addChart(c.id, c.label)">
                <span class="pld-pal__ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></span>
                <span><b>{{ c.label }}</b><small>{{ c.onPage ? 'On the page — select it' : "This profile's chart block" }}</small></span>
              </button>
            }
            <button type="button" class="nd-btn nd-btn--secondary pld-wide" (click)="createChart()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              New chart
            </button>
          </section>

          <section class="pld-sec" aria-label="Analyzer graphs">
            <h4 class="pld-sec__h">Analyzer graphs</h4>
            <p class="pld-pal__src">{{ imageSourceNote() }}</p>
            @if (paletteImages().length) {
              <div class="pld-imgs">
                @for (img of paletteImages(); track img.code) {
                  <button type="button" class="pld-img" [attr.aria-pressed]="img.onPage && !img.hidden" (click)="addAnalyzer(img.code, img.label)"
                          [attr.aria-label]="'Add ' + img.label + ' (' + img.code + ')'">
                    <span class="pld-thumb"><img [src]="sampleAsset(img.code)" alt="" loading="lazy" /></span>
                    <span class="pld-img__t">{{ img.label }}</span>
                    <span class="pld-img__s nd-num">{{ img.detail }}</span>
                    @if (img.onPage && !img.hidden) {
                      <span class="pld-img__check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                    }
                  </button>
                }
              </div>
            }
            <button type="button" class="nd-btn nd-btn--tertiary pld-adv" [attr.aria-expanded]="advancedOpen()" (click)="advancedOpen.set(!advancedOpen())">
              {{ advancedOpen() ? 'Hide' : 'Advanced:' }} add by image code
            </button>
            @if (advancedOpen()) {
              <div class="pld-manual">
                <input class="nd-input nd-num" type="text" inputmode="numeric" placeholder="Image code, e.g. 12003" aria-label="Analyzer image code"
                       [ngModel]="manualCode()" (ngModelChange)="manualCode.set($event)" (keydown.enter)="addManual()" />
                <button type="button" class="nd-btn nd-btn--secondary" [disabled]="!manualCode().trim()" (click)="addManual()">Add</button>
              </div>
            }
          </section>

          <section class="pld-sec" aria-label="On this page">
            <h4 class="pld-sec__h">On this page</h4>
            <ul class="pld-list">
              @for (b of boxes(); track b.id) {
                <li class="pld-li" [class.pld-li--off]="b.hidden">
                  <button type="button" class="pld-li__main" (click)="select(b.id)">
                    <span class="pld-li__name">{{ labelFor(b) }}</span>
                    <span class="pld-li__val nd-num">{{ round(b.w) }} × {{ round(b.h) }} mm · at {{ round(b.x) }}, {{ round(b.y) }}{{ b.hidden ? ' · hidden' : '' }}</span>
                  </button>
                  @if (b.kind !== 'table') {
                    <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="!b.hidden" [attr.aria-label]="'Print ' + labelFor(b)" (click)="toggleHidden(b)">
                      <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
                    </button>
                  }
                </li>
              }
            </ul>
            @if (pageIssues().length) {
              <ul class="pld-issues" role="status">
                @for (iss of pageIssues(); track iss.message) {
                  <li><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span>{{ iss.message }}</span></li>
                }
              </ul>
            }
          </section>
        }
      </div>
    </aside>
  </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; container-type: inline-size; }
    .pld { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; align-items: start; }
    /* Side card beside the page only when the page still gets a readable width. */
    @container (max-width: 860px) { .pld { grid-template-columns: minmax(0, 1fr); } }
    .pld-main, .pld-side { min-width: 0; }
    .pld-main__head { row-gap: 8px; flex-wrap: wrap; }
    .pld-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
    .pld-tool { width: 36px; min-height: 36px; height: 36px; }
    @media (pointer: coarse) { .pld-tool { width: 44px; min-height: 44px; height: 44px; } .nd-seg__item { min-height: 40px; } }
    .nd-toggle { min-height: 44px; }

    .pld-onrow { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--nd-line); flex-wrap: wrap; }
    .pld-onrow__txt { flex: 1 1 220px; min-width: 0; }
    .pld-onrow__t { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pld-onrow__s { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-tertiary); }
    .pld-onrow .nd-btn--tertiary { display: inline-flex; align-items: center; gap: 6px; }

    .pld-viewport { overflow: auto; padding: 16px; max-height: 1180px;
      background: color-mix(in srgb, var(--text-primary) 5%, var(--nd-card-bg)); overscroll-behavior: contain; }
    .pld-page { position: relative; margin: 0 auto; background: #fff; border-radius: 4px; outline: none; user-select: none;
      box-shadow: 0 1px 3px rgba(15, 23, 42, .18), 0 10px 28px rgba(15, 23, 42, .12); touch-action: pan-y pinch-zoom; }
    .pld-page:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 40%, transparent), 0 10px 28px rgba(15, 23, 42, .12); }
    .pld-canvas, .pld-canvas ::ng-deep canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border-radius: 4px; }
    .pld-loading { position: absolute; inset: 9% 8% auto; display: flex; flex-direction: column; gap: 12px; }
    .pld-skel { display: block; height: 14px; border-radius: 6px; background: linear-gradient(90deg, #eef0f4 0%, #f6f7fa 50%, #eef0f4 100%);
      background-size: 200% 100%; animation: pld-shimmer 1.2s ease-in-out infinite; }
    .pld-skel--head { height: 48px; } .pld-skel--short { width: 60%; }
    @keyframes pld-shimmer { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .pld-skel { animation: none; } }

    /* Fixed regions: a faint wash + a label on hover of the page only. */
    .pld-fixed { position: absolute; left: 0; right: 0; pointer-events: none; z-index: 1; background: rgba(148, 163, 184, .10); }
    .pld-fixed--top { top: 0; border-bottom: 1px dashed rgba(100, 116, 139, .45); }
    .pld-fixed--bottom { bottom: 0; border-top: 1px dashed rgba(100, 116, 139, .45); }
    .pld-fixed span { position: absolute; right: 6px; bottom: 3px; padding: 1px 6px; border-radius: 6px; font-size: 10px; font-weight: 500;
      color: #475569; background: rgba(255, 255, 255, .9); opacity: 0; transition: opacity var(--nd-dur-fast, 200ms) ease; }
    .pld-fixed--bottom span { top: 3px; bottom: auto; }
    .pld-page:hover .pld-fixed span, .pld--guides .pld-fixed span { opacity: 1; }
    .pld-body { position: absolute; z-index: 1; pointer-events: none; outline: 1px dashed rgba(124, 58, 237, .38); }
    .pld-body__tag { position: absolute; left: 0; top: -17px; padding: 1px 6px; border-radius: 6px; white-space: nowrap; font-size: 10px; font-weight: 600;
      color: #5b21b6; background: rgba(245, 243, 255, .95); opacity: 0; transition: opacity var(--nd-dur-fast, 200ms) ease; font-variant-numeric: tabular-nums; }
    .pld--guides .pld-body__tag, .pld-page:hover .pld-body__tag { opacity: 1; }
    .pld-body__centre { position: absolute; top: 0; bottom: 0; left: 50%; border-left: 1px dotted rgba(124, 58, 237, .4); }
    .pld-guide { position: absolute; z-index: 4; pointer-events: none; }
    .pld-guide--v { width: 0; border-left: 1.5px solid #7c3aed; }
    .pld-guide--h { height: 0; border-top: 1.5px solid #7c3aed; }
    .pld-hole { position: absolute; z-index: 2; background: #fff; pointer-events: none; }

    .pld-box { position: absolute; z-index: 3; box-sizing: border-box; cursor: grab; touch-action: none; outline: none;
      border: 1px dashed rgba(124, 58, 237, .32); border-radius: 2px; background: transparent;
      transition: border-color var(--nd-dur-fast, 200ms) ease, background var(--nd-dur-fast, 200ms) ease, box-shadow var(--nd-dur-fast, 200ms) ease; }
    .pld-box:hover, .pld-box:focus-visible { border-color: rgba(124, 58, 237, .75); background: rgba(124, 58, 237, .04); }
    .pld-box--sel, .pld-box--sel:hover { border: 1.5px solid #7c3aed; background: rgba(124, 58, 237, .05); box-shadow: 0 0 0 3px rgba(124, 58, 237, .14); }
    .pld-box--drag { cursor: grabbing; transition: none; z-index: 5; box-shadow: 0 8px 24px rgba(15, 23, 42, .22), 0 0 0 1.5px #7c3aed; }
    .pld-box--warn:not(.pld-box--sel) { border: 1.5px solid rgba(217, 119, 6, .85); }
    .pld-box--hidden { border-color: rgba(100, 116, 139, .6); background: repeating-linear-gradient(135deg, rgba(100,116,139,.12) 0 5px, rgba(255,255,255,.7) 5px 10px); }
    .pld-box__ghost { position: absolute; inset: 0; background-repeat: no-repeat; background-color: #fff; opacity: .96; pointer-events: none; }
    .pld-box__hiddenmark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #475569; pointer-events: none; }
    .pld-box__tag { position: absolute; left: -1px; bottom: calc(100% + 2px); display: none; align-items: center; gap: 4px;
      padding: 2px 7px; border-radius: 6px; white-space: nowrap; font-size: 11px; font-weight: 600; line-height: 1.3;
      color: #fff; background: #6d28d9; box-shadow: 0 2px 6px rgba(15,23,42,.2); pointer-events: none; }
    .pld-box--warn .pld-box__tag { background: #b45309; }
    .pld-box:hover .pld-box__tag, .pld-box:focus-visible .pld-box__tag, .pld-box--sel .pld-box__tag, .pld--guides .pld-box__tag { display: inline-flex; }
    .pld--guides .pld-box:not(.pld-box--sel):not(:hover) .pld-box__tag { background: rgba(109, 40, 217, .78); }
    .pld-box__live { position: absolute; left: 0; top: calc(100% + 4px); padding: 2px 7px; border-radius: 6px; white-space: nowrap;
      font-size: 11px; color: #fff; background: #0f172a; pointer-events: none; z-index: 6; }

    .pld-handle { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; box-sizing: border-box;
      background: #fff; border: 1.5px solid #7c3aed; border-radius: 2px; z-index: 6; touch-action: none; }
    .pld-handle::before { content: ''; position: absolute; inset: -7px; }
    @media (pointer: coarse) { .pld-handle { width: 16px; height: 16px; margin: -8px 0 0 -8px; } .pld-handle::before { inset: -14px; } }
    .pld-handle--nw { left: 0; top: 0; cursor: nwse-resize; } .pld-handle--n { left: 50%; top: 0; cursor: ns-resize; }
    .pld-handle--ne { left: 100%; top: 0; cursor: nesw-resize; } .pld-handle--e { left: 100%; top: 50%; cursor: ew-resize; }
    .pld-handle--se { left: 100%; top: 100%; cursor: nwse-resize; } .pld-handle--s { left: 50%; top: 100%; cursor: ns-resize; }
    .pld-handle--sw { left: 0; top: 100%; cursor: nesw-resize; } .pld-handle--w { left: 0; top: 50%; cursor: ew-resize; }

    .pld-foot { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; padding: 8px 14px 10px; border-top: 1px solid var(--nd-line); font-size: 12.5px; }
    .pld-fit { display: inline-flex; align-items: center; gap: 6px; color: var(--text-primary); font-weight: 500; }
    .pld-fit svg { color: var(--color-violet-600, #7c3aed); }
    .pld-fit--bad svg { color: #b45309; }
    .pld-foot__note { color: var(--text-tertiary); font-size: 12px; }

    .pld-side__body { display: flex; flex-direction: column; gap: 14px; }
    .nd-card__spacer { flex: 1 1 auto; }
    .pld-sec { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--nd-line); }
    .pld-sec__h { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pld-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; min-height: 44px;
      border-radius: var(--nd-radius-sm); border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .pld-row__t { margin: 0; font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .pld-row__s { margin: 2px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-tertiary); }
    .pld-nudge { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .pld-pad { display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 44px); gap: 2px; flex: none; }
    .pld-pad .nd-btn--icon { width: 44px; height: 44px; }
    .pld-pad__up { grid-column: 2; grid-row: 1; } .pld-pad__left { grid-column: 1; grid-row: 2; }
    .pld-pad__right { grid-column: 3; grid-row: 2; } .pld-pad__down { grid-column: 2; grid-row: 3; }
    .pld-step { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 140px; }
    .pld-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .pld-cols { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .pld-cols li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--text-primary); }
    .pld-ta { min-height: 72px; resize: vertical; }
    .pld-selfoot { display: flex; justify-content: flex-start; padding-top: 12px; border-top: 1px solid var(--nd-line); }
    .pld-issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pld-issues li { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: var(--nd-radius-sm);
      font-size: 12.5px; line-height: 1.4; color: var(--text-primary);
      background: color-mix(in srgb, #d97706 10%, var(--nd-card-bg)); border: 1px solid color-mix(in srgb, #d97706 35%, transparent); }
    .pld-issues li svg { flex: none; margin-top: 2px; color: #b45309; }

    .pld-pal { display: flex; flex-direction: column; gap: 6px; }
    .pld-pal__item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 8px 12px; text-align: left; font: inherit; cursor: pointer;
      color: var(--text-primary); background: var(--nd-card-bg); border: 1px solid var(--nd-line); border-radius: var(--nd-radius-sm);
      transition: border-color var(--nd-dur-fast, 200ms) ease, background var(--nd-dur-fast, 200ms) ease; }
    .pld-pal__item:hover:not(:disabled) { border-color: var(--nd-sel-border, rgba(124, 58, 237, .45)); }
    .pld-pal__item:disabled { opacity: .55; cursor: default; }
    .pld-pal__item b { display: block; font-size: 13px; font-weight: 600; }
    .pld-pal__item small { display: block; font-size: 12px; color: var(--text-tertiary); line-height: 1.35; }
    .pld-pal__ico { flex: none; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px;
      color: var(--color-violet-600, #7c3aed); background: color-mix(in srgb, #7c3aed 10%, var(--nd-card-bg)); }
    .pld-pal__src { margin: -4px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-tertiary); }
    .pld-wide { width: 100%; justify-content: center; display: inline-flex; align-items: center; gap: 6px; }
    .pld-imgs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .pld-img { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 6px; text-align: left; font: inherit; cursor: pointer;
      color: var(--text-primary); background: var(--nd-card-bg); border: 1px solid var(--nd-line); border-radius: var(--nd-radius-sm);
      transition: border-color var(--nd-dur-fast, 200ms) ease, background var(--nd-dur-fast, 200ms) ease; }
    .pld-img:hover { border-color: var(--nd-sel-border, rgba(124, 58, 237, .45)); }
    .pld-img[aria-pressed="true"] { border-color: var(--nd-sel-border, rgba(124, 58, 237, .55)); background: var(--nd-done-tint, color-mix(in srgb, #7c3aed 6%, var(--nd-card-bg))); }
    .pld-thumb { display: flex; align-items: center; justify-content: center; aspect-ratio: 156 / 111; border-radius: 4px; background: #fff; border: 1px solid #e2e8f0; overflow: hidden; }
    .pld-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .pld-thumb--lg { width: 120px; flex: none; }
    .pld-img__t { font-size: 12px; font-weight: 600; line-height: 1.3; }
    .pld-img__s { font-size: 11px; color: var(--text-tertiary); }
    .pld-img__check { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      color: #fff; background: var(--color-violet-600, #7c3aed); }
    .pld-thumbrow { display: flex; gap: 10px; align-items: flex-start; }
    .pld-adv { align-self: flex-start; }
    .pld-manual { display: flex; gap: 6px; }
    .pld-manual .nd-input { flex: 1 1 auto; min-width: 0; }
    .pld-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pld-li { display: flex; align-items: center; gap: 8px; padding-right: 10px; border-radius: var(--nd-radius-sm); border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .pld-li:hover { border-color: var(--nd-sel-border, rgba(124, 58, 237, .45)); }
    .pld-li--off .pld-li__name { color: var(--text-tertiary); }
    .pld-li__main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; min-height: 48px; justify-content: center;
      padding: 6px 12px; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; color: inherit; border-radius: var(--nd-radius-sm); }
    .pld-li__name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pld-li__val { font-size: 12px; color: var(--text-tertiary); }

    /* Dark: the page stays paper-white; the viewport around it darkens. */
    :host-context(.dark) .pld-viewport, :host-context([data-theme='dark']) .pld-viewport { background: rgba(0, 0, 0, .28); }
    :host-context(.dark) .pld-thumb, :host-context([data-theme='dark']) .pld-thumb { border-color: rgba(148, 163, 184, .35); }
  `],
})
export class ProfileLayoutDesignerComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly platform = inject(PlatformService);
  private readonly layoutSvc = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  // ── inputs / outputs ────────────────────────────────────────────────
  readonly sections = input.required<ReportSection[]>();
  readonly resolvedColumns = input<ReportColumn[]>([]);
  /** The profile's own (effective) test id. */
  readonly profileTestId = input<string | null>(null);
  readonly profileName = input<string>('');
  readonly profileCatalogKey = input<string | null>(null);
  readonly department = input<string>('');
  readonly sampleType = input<string>('');
  /** The profile's members — the sample report's rows (same list the Live preview uses). */
  readonly members = input<PreviewProfileMember[]>([]);
  /** Live (unsaved) column override, as the Live preview gets it. */
  readonly columnsOverride = input<ReportColumn[] | null>(null);
  /** What a NEW chart block starts from (the report-structure's chart context). */
  readonly chartContext = input<ChartEditorContext | null>(null);

  readonly sectionsChange = output<ReportSection[]>();
  /** The box set as it is right now — for the Live preview while editing. */
  readonly liveChange = output<{ enabled: boolean; boxes: PageLayoutBox[] }>();

  // ── state ───────────────────────────────────────────────────────────
  readonly boxes = signal<PageLayoutBox[]>([]);
  readonly enabled = signal(false);
  /** True while the boxes are the auto-built default nobody has touched —
   *  rebuilt as better information (real body rect, linked graphs) arrives. */
  private readonly draft = signal(true);
  private lastEmitted: ReportSection[] | null = null;
  readonly selected = signal<string | null>(null);
  readonly step = signal<number>(1);
  readonly zoom = signal<1 | 1.5>(1);
  readonly guides = signal(false);
  readonly manualCode = signal('');
  readonly advancedOpen = signal(false);
  readonly restoring = signal(false);
  readonly drag = signal<DragState | null>(null);
  readonly guideLines = signal<SnapGuides>({ v: [], h: [] });
  /** Original spots of just-moved boxes, blanked until the page re-renders. */
  readonly holes = signal<Array<{ id: string; x: number; y: number; w: number; h: number }>>([]);
  /** Cropped page pixels that travel with a moved box until the re-render lands. */
  private readonly ghosts = signal<Record<string, { url: string; w: number; h: number; dx: number; dy: number }>>({});
  private readonly history = signal<PageLayoutBox[][]>([]);
  private readonly future = signal<PageLayoutBox[][]>([]);
  readonly canUndo = computed(() => this.history().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);
  readonly analyzerInfo = signal<ProfileAnalyzerImages | null>(null);

  protected readonly steps = STEPS;
  protected readonly handles = RESIZE_HANDLES;
  protected readonly fontSizes = [8, 8.5, 9, 10];
  protected readonly minFontPt = MIN_BODY_FONT_PT;
  protected readonly PAGE_RATIO = PAGE.h / PAGE.w;

  // ── page geometry ───────────────────────────────────────────────────
  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private readonly pageEl = viewChild<ElementRef<HTMLDivElement>>('page');
  private readonly canvasHost = viewChild<ElementRef<HTMLDivElement>>('canvasHost');
  private readonly viewportW = signal(560);
  readonly pageW = computed(() => Math.round(Math.max(300, Math.min(760, this.viewportW() - 32)) * this.zoom()));
  /** px per PDF point. */
  private readonly pxPerPt = computed(() => this.pageW() / PAGE.w);
  /** px per millimetre (box geometry is stored in mm). */
  readonly mmPx = computed(() => this.pxPerPt() * MM);

  private readonly template = signal<ReportTemplate | null | undefined>(undefined);
  /** The EXACT body rect (pt) the renderer placed the boxes in — reported by
   *  the PDF pipeline itself (`onOnePageBody`). Until the first render: an
   *  estimate below the letterhead + patient block. */
  private readonly renderedBody = signal<BodyArea | null>(null);
  private readonly estimatedBody = computed((): BodyArea => {
    const tpl = this.template();
    let top = 98 + 128; // classic letterhead + patient block + headings
    if (tpl !== undefined) {
      try { top = computeReportPageLayout({ report: { id: 'pld', type: 'final', data: '{}' }, template: tpl }).bodyTop + 128; } catch { /* estimate */ }
    }
    return bodyArea(top, PAGE.h - 64);
  });
  readonly body = computed(() => this.renderedBody() ?? this.estimatedBody());
  readonly bodyPx = computed(() => {
    const b = this.body(), k = this.pxPerPt();
    return { x: b.left * k, y: b.top * k, w: b.w * k, h: b.h * k };
  });
  readonly bodyMm = computed(() => ({ w: ptToMm(this.body().w), h: ptToMm(this.body().h) }));

  boxRect(b: Pick<PageLayoutBox, 'x' | 'y' | 'w' | 'h'>) {
    const p = this.bodyPx(), k = this.mmPx();
    return { x: p.x + b.x * k, y: p.y + b.y * k, w: b.w * k, h: b.h * k };
  }

  // ── derived ─────────────────────────────────────────────────────────
  readonly selectedBox = computed(() => this.boxes().find(b => b.id === this.selected()) ?? null);
  readonly tableBox = computed(() => this.boxes().find(b => b.kind === 'table') ?? null);
  readonly rowCount = computed(() => {
    const n = this.members().reduce((s, m) => s + Math.max(1, namesFromParametersJson(m.parameters).length), 0);
    return n || 1;
  });
  readonly fit = computed(() => {
    const t = this.tableBox();
    if (!t) return { fits: true, shrinkToPt: 9, overflowsToPage2: false, estimatedRows: 0 };
    return fitMeter(this.rowCount(), t.h * MM, t.fontSize ?? 9);
  });
  readonly issues = computed((): PageLayoutIssue[] => detectLayoutIssues(this.boxes(), this.body()));
  readonly pageIssues = computed(() => this.issues().slice(0, 4));
  readonly warnIds = computed(() => new Set(this.issues().filter(i => i.level === 'warn').map(i => i.boxId)));
  issuesFor(id: string): PageLayoutIssue[] { return this.issues().filter(i => i.boxId === id); }

  readonly isCbc = computed(() => isCbcFamily({
    catalogKey: this.profileCatalogKey(), name: this.profileName(), memberKeys: this.members().map(m => m.catalogKey),
  }));
  /** The analyzer graph types this profile can show: every image type the
   *  LINKED instrument(s) sent; a CBC with nothing linked yet gets the four
   *  M51 graphs as suggestions. */
  private readonly analyzerCodes = computed((): Array<{ code: string; label: string; seen: number }> => {
    const info = this.analyzerInfo();
    const seen = (info?.images ?? []).map(i => ({ code: i.code, label: this.codeLabel(i.code, i.label), seen: i.seen }));
    if (seen.length) return seen;
    return this.isCbc() ? KNOWN_ANALYZER_IMAGES.map(i => ({ code: i.code, label: i.label, seen: 0 })) : [];
  });
  readonly paletteImages = computed((): PaletteImage[] => {
    const boxes = this.boxes();
    const list = this.analyzerCodes().map(i => {
      const box = boxes.find(b => b.kind === 'analyzer' && b.ref === i.code);
      return { code: i.code, label: i.label, detail: i.seen ? `Code ${i.code} · seen ${i.seen}×` : `Code ${i.code}`, onPage: !!box, hidden: !!box?.hidden };
    });
    // Boxes for codes no longer in the list (manual / older) stay pickable.
    for (const b of boxes) {
      if (b.kind === 'analyzer' && b.ref && !list.some(l => l.code === b.ref)) {
        list.push({ code: b.ref, label: b.label || analyzerLabel(b.ref), detail: `Code ${b.ref}`, onPage: true, hidden: !!b.hidden });
      }
    }
    return list;
  });
  readonly imageSourceNote = computed(() => {
    const info = this.analyzerInfo();
    if (info?.linked && info.instruments.length) {
      const names = info.instruments.map(i => i.model ? `${i.name} (${i.model})` : i.name).join(', ');
      return info.images.length
        ? `Graphs ${names} sends for these tests. Thumbnails are samples.`
        : `${names} is linked to these tests but hasn't sent a graph yet.`;
    }
    if (info?.images.length) return 'Graphs already attached to this profile\'s results. Thumbnails are samples.';
    return this.isCbc()
      ? 'No analyzer is linked to these tests yet — the usual CBC graphs are suggested.'
      : 'No analyzer is linked to these tests. Link one in Instruments to list its graphs.';
  });
  readonly imageOptions = computed((): PfSelectOption<string>[] =>
    this.paletteImages().map(i => ({ value: i.code, label: `${i.label} · ${i.code}` })));
  /** The profile's report-chart blocks (independent of the boxes — the
   *  default builder reads this, so it must never depend on them). */
  private readonly chartSections = computed(() => (this.sections() ?? [])
    .filter(s => s.type === 'chart' && (s as { trend?: unknown }).trend)
    .map(s => ({ id: s.id, label: s.label || 'Chart' })), { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  readonly chartBlocks = computed((): ChartBlock[] => {
    const boxes = this.boxes();
    return this.chartSections().map(c => ({ ...c, onPage: boxes.some(b => b.kind === 'chart' && b.ref === c.id) }));
  });
  readonly chartOptions = computed((): PfSelectOption<string>[] => this.chartBlocks().map(c => ({ value: c.id, label: c.label })));
  readonly tableColumns = computed(() => {
    const cols = this.resolvedColumns();
    const base = cols.length ? cols : [
      { name: 'name', label: 'Investigation' }, { name: 'result', label: 'Result' }, { name: 'unit', label: 'Unit' },
      { name: 'range', label: 'Reference range' }, { name: 'method', label: 'Method' }, { name: 'specimen', label: 'Specimen' },
    ];
    return base.map(c => ({ name: c.name, label: c.label || c.name }));
  });

  // ── rendering ───────────────────────────────────────────────────────
  readonly canvasReady = signal(false);
  readonly rendering = signal(false);
  private baseInput: ReportPdfInput | null = null;
  private baseKey = '';
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private renderSeq = 0;
  private drawSeq = 0;
  private resizeObs: ResizeObserver | null = null;

  constructor() {
    // Saved layout in → editable boxes (our own emits come back unchanged).
    effect(() => {
      const secs = this.sections();
      untracked(() => {
        if (secs === this.lastEmitted) return;
        const cfg = readPageLayout(secs);
        this.enabled.set(cfg?.enabled ?? false);
        if (cfg?.boxes.length) { this.boxes.set(cfg.boxes); this.draft.set(false); }
        else { this.draft.set(true); this.boxes.set(this.buildDefault()); }
        this.history.set([]); this.future.set([]);
      });
    });
    // The untouched default follows better information as it arrives.
    effect(() => {
      this.body(); this.analyzerCodes(); this.members(); this.chartSections();
      untracked(() => { if (this.draft()) this.boxes.set(this.buildDefault()); });
    });
    this.api.get<ReportTemplate>('/api/config/report-template').subscribe({
      next: t => this.template.set(t ?? null),
      error: () => this.template.set(null),
    });
    effect(() => {
      const id = this.profileTestId();
      if (!id) { this.analyzerInfo.set(null); return; }
      void this.layoutSvc.analyzerImages(id).then(info => this.analyzerInfo.set(info));
    });
    // The sample report base (engine round trips) — only when its inputs change.
    effect(() => {
      const key = JSON.stringify([this.profileTestId(), this.profileName(), this.department(), this.sampleType(),
        this.members().map(m => [m.id, m.offsetMin ?? null]), this.columnsOverride(), this.template() === undefined]);
      untracked(() => { if (key !== this.baseKey) { this.baseKey = key; this.baseInput = null; } this.scheduleRender(0); });
    });
    // Every box change re-paints the page (no engine call).
    effect(() => {
      this.boxes(); this.template();
      untracked(() => this.scheduleRender(this.drag() ? 0 : 120));
    });
    effect(() => {
      const el = this.viewport()?.nativeElement;
      if (!el || this.resizeObs || typeof ResizeObserver === 'undefined') return;
      this.resizeObs = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width;
        // The viewport's own width — independent of zoom (zoom scrolls).
        if (w && Math.abs(w - this.viewportW()) > 1 && this.zoom() === 1) this.viewportW.set(w + 32);
      });
      this.resizeObs.observe(el);
    });
    // Zoom / width changes re-draw the canvas at the new size.
    effect(() => { this.pageW(); untracked(() => this.scheduleRender(60)); });
  }

  ngOnDestroy(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.resizeObs?.disconnect();
    if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
  }

  private codeLabel(code: string, serverLabel?: string | null): string {
    const known = KNOWN_ANALYZER_IMAGES.find(i => i.code === code);
    if (known) return known.label;
    return (serverLabel ?? '').trim() || `Analyzer image ${code}`;
  }

  /** The default for ANY profile (report-profile-layout.ts buildDefaultLayout). */
  private buildDefault(): PageLayoutBox[] {
    return buildDefaultLayout({
      body: this.body(),
      rowCount: this.rowCount(),
      analyzerCodes: this.analyzerCodes().map(i => i.code),
      chartIds: this.chartSections(),
      labelFor: code => this.codeLabel(code, this.analyzerInfo()?.images.find(i => i.code === code)?.label),
    });
  }

  private scheduleRender(delay: number): void {
    if (this.template() === undefined) return; // wait for the real letterhead
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.render(), delay);
  }

  private lastBlobUrl: string | null = null;
  private async render(): Promise<void> {
    if (this.drag()) return; // repaint on drop, not mid-drag
    const id = this.profileTestId();
    const seq = ++this.renderSeq;
    this.rendering.set(true);
    try {
      if (!this.baseInput && id) {
        this.baseInput = await buildSamplePreviewInput({
          testId: id, testName: this.profileName(), department: this.department(), sampleType: this.sampleType(),
          parameters: [], members: this.members(), columnsOverride: this.columnsOverride(),
          template: this.template() ?? null, apiUrl: this.platform.getApiUrl(),
          preview: (tid, vals, imgs, p, pj) => this.layoutSvc.preview(tid, vals, imgs, p, pj),
          assetBase: typeof document !== 'undefined' ? document.baseURI : null,
        }, () => seq !== this.renderSeq);
        if (seq !== this.renderSeq) return;
      }
      if (!this.baseInput || !id) return;
      const live = { enabled: true, boxes: this.boxes() };
      let input = applyLivePageLayout(this.baseInput, id, live, typeof document !== 'undefined' ? document.baseURI : null);
      input = await withSampleImagesLoaded(input, this.platform.getApiUrl());
      if (seq !== this.renderSeq) return;
      // Keep newly fetched sample graphs on the base (fetched once per session).
      this.baseInput = { ...this.baseInput, imageCache: input.imageCache };
      let page = 1;
      const url = renderReportPdfBlobUrl({
        ...input,
        onOnePageBody: info => { if (info.pkg === id) { page = info.page; this.setBody(info.body); } },
      });
      if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
      this.lastBlobUrl = url;
      const host = this.canvasHost()?.nativeElement;
      if (host) await this.drawPage(url, host, page);
    } catch (e) {
      console.error('one-page layout render failed', e);
    } finally {
      if (seq === this.renderSeq) this.rendering.set(false);
    }
  }

  private setBody(b: BodyArea): void {
    const cur = this.renderedBody();
    if (cur && Math.abs(cur.top - b.top) < 0.01 && Math.abs(cur.h - b.h) < 0.01 && Math.abs(cur.left - b.left) < 0.01) return;
    this.renderedBody.set({ ...b });
  }

  /** pdf.js → canvas — the letterhead editor's drawPage(). */
  private async drawPage(url: string, host: HTMLDivElement, pageNo: number): Promise<void> {
    const my = ++this.drawSeq;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjs: any = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
      const buf = await fetch(url).then(r => r.arrayBuffer());
      if (my !== this.drawSeq) return;
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
      if (my !== this.drawSeq) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (this.pageW() / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      if (my !== this.drawSeq) return;
      host.replaceChildren(canvas);
      this.canvasReady.set(true);
      // The page now shows every box where it is — drop the drag stand-ins.
      if (!this.drag()) { this.holes.set([]); this.ghosts.set({}); }
    } catch { /* keep the previous page */ }
  }

  // ── emitting ────────────────────────────────────────────────────────
  private emit(): void {
    const next = writePageLayout(this.sections(), { enabled: this.enabled(), boxes: this.boxes() });
    this.lastEmitted = next;
    this.sectionsChange.emit(next);
    this.liveChange.emit({ enabled: this.enabled(), boxes: this.boxes() });
  }
  /** Apply an edit: history, then save. */
  private commit(next: PageLayoutBox[], prev = this.boxes()): void {
    if (next === prev) return;
    this.history.update(h => [...h.slice(-(HISTORY_MAX - 1)), prev]);
    this.future.set([]);
    this.draft.set(false);
    this.boxes.set(next);
    this.emit();
  }
  undo(): void {
    const h = this.history();
    if (!h.length) return;
    this.future.update(f => [this.boxes(), ...f]);
    this.history.set(h.slice(0, -1));
    this.boxes.set(h[h.length - 1]);
    this.draft.set(false);
    this.emit();
  }
  redo(): void {
    const f = this.future();
    if (!f.length) return;
    this.history.update(h => [...h, this.boxes()]);
    this.future.set(f.slice(1));
    this.boxes.set(f[0]);
    this.emit();
  }
  setEnabled(on: boolean): void {
    this.enabled.set(on);
    this.draft.set(false);
    this.emit();
  }

  async restoreDefault(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Restore the default layout?',
      message: this.isCbc()
        ? 'The page goes back to the standard CBC arrangement: results table, the analyzer graphs beside it, signatures below.'
        : 'The page goes back to the standard arrangement: results table, its charts and graphs beside it, signatures below.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    this.restoring.set(true);
    try {
      const id = this.profileTestId();
      const res = id ? await this.layoutSvc.restorePageLayoutDefault(id).catch(() => null) : null;
      const fromMaster = res ? readPageLayout(res.sections) : null;
      const boxes = fromMaster?.boxes.length ? fromMaster.boxes : this.buildDefault();
      this.commit(boxes);
      this.selected.set(null);
      this.toasts.success('Restored the default one-page layout.');
    } finally {
      this.restoring.set(false);
    }
  }

  // ── selection / edits ───────────────────────────────────────────────
  labelFor(b: PageLayoutBox): string { return boxLabel(b); }
  sampleAsset(code: string): string { return analyzerSampleAsset(code); }
  round(n: number): number { return Math.round(n * 10) / 10; }
  hasVisible(kind: PageLayoutBoxKind): boolean { return this.boxes().some(b => b.kind === kind && !b.hidden); }
  colVisible(b: PageLayoutBox, name: string): boolean { return b.columns?.find(c => c.name === name)?.visible ?? true; }
  ghostFor(id: string) { return this.ghosts()[id] ?? null; }
  select(id: string | null): void { this.selected.set(id); }
  focusSelect(id: string): void { if (this.selected() !== id && !this.drag()) this.selected.set(id); }
  readout(b: PageLayoutBox): string {
    return this.drag()?.mode === 'resize' ? `${this.round(b.w)} × ${this.round(b.h)} mm` : `${this.round(b.x)}, ${this.round(b.y)} mm`;
  }

  nudge(dx: number, dy: number): void {
    const id = this.selected(); if (!id) return;
    this.commit(nudgeBox(this.boxes(), id, dx, dy, this.body()).boxes);
  }
  setGeom(k: 'x' | 'y' | 'w' | 'h', raw: string): void {
    const b = this.selectedBox(); const v = parseFloat(raw);
    if (!b || !isFinite(v)) return;
    if (k === 'w' || k === 'h') {
      this.commit(resizeBox(this.boxes(), b.id, k === 'w' ? v : b.w, k === 'h' ? v : b.h, this.body()));
    } else {
      this.commit(dragBox(this.boxes(), b.id, k === 'x' ? v : b.x, k === 'y' ? v : b.y, this.body(), false).boxes);
    }
  }
  setFontSize(v: number): void {
    const id = this.selected(); if (!id) return;
    this.commit(patchBox(this.boxes(), id, { fontSize: Math.max(MIN_BODY_FONT_PT, Math.min(14, v)) }));
  }
  setLabel(v: string): void {
    const id = this.selected(); if (!id) return;
    this.commit(patchBox(this.boxes(), id, { label: v.trim() || null }));
  }
  setText(v: string): void {
    const id = this.selected(); if (!id) return;
    this.commit(patchBox(this.boxes(), id, { text: v }));
  }
  setRef(ref: string): void {
    const b = this.selectedBox(); if (!b || !ref) return;
    const patch: Partial<PageLayoutBox> = { ref };
    if (b.kind === 'analyzer') patch.label = this.paletteImages().find(i => i.code === ref)?.label ?? analyzerLabel(ref);
    if (b.kind === 'chart') patch.label = this.chartBlocks().find(c => c.id === ref)?.label ?? 'Chart';
    this.commit(patchBox(this.boxes(), b.id, patch));
  }
  toggleColumn(name: string, visible: boolean): void {
    const id = this.selected(); if (!id) return;
    this.commit(setColumnVisible(this.boxes(), id, name, visible));
  }
  toggleHidden(b: PageLayoutBox): void {
    if (b.kind === 'table') return; // results always print
    this.commit(setBoxHidden(this.boxes(), b.id, !b.hidden));
  }
  remove(id: string): void {
    const b = this.boxes().find(x => x.id === id);
    if (!b || b.kind === 'table') return;
    this.commit(removeBox(this.boxes(), id));
    if (this.selected() === id) this.selected.set(null);
  }

  // ── palette ─────────────────────────────────────────────────────────
  add(kind: PageLayoutBoxKind, opts: { ref?: string; label?: string } = {}): void {
    const r = addPaletteBox(this.boxes(), kind, this.body(), opts);
    this.commit(r.boxes);
    this.selected.set(r.id);
  }
  addAnalyzer(code: string, label: string): void { this.add('analyzer', { ref: code, label }); }
  addChart(id: string, label: string): void { this.add('chart', { ref: id, label }); }
  addManual(): void {
    const code = this.manualCode().trim();
    if (!code) return;
    this.add('analyzer', { ref: code, label: this.codeLabel(code) });
    this.manualCode.set('');
  }
  /** A NEW chart block (same default spec the print order's "+ Chart" uses)
   *  and its box, in one save. */
  createChart(): void {
    const ctx = this.chartContext();
    const secId = 'sec-' + Math.random().toString(36).slice(2, 10);
    const order = Math.max(0, ...this.sections().map(s => s.order ?? 0)) + 1;
    const chart = {
      id: secId, type: 'chart', order, label: 'Chart', conditions: [],
      trend: defaultChartSpec({ series: !!ctx?.series, parameters: ctx?.params.map(p => p.name) ?? [] }),
    } as unknown as ReportSection;
    const r = addPaletteBox(this.boxes(), 'chart', this.body(), { ref: secId, label: 'Chart' });
    this.history.update(h => [...h.slice(-(HISTORY_MAX - 1)), this.boxes()]);
    this.draft.set(false);
    this.boxes.set(r.boxes);
    const next = writePageLayout([...this.sections(), chart], { enabled: this.enabled(), boxes: r.boxes });
    this.lastEmitted = next;
    this.sectionsChange.emit(next);
    this.liveChange.emit({ enabled: this.enabled(), boxes: r.boxes });
    this.selected.set(r.id);
    this.toasts.info('Chart added — set what it shows in its block in the print order.');
  }

  // ── pointer: move / resize ──────────────────────────────────────────
  onPagePointerDown(ev: PointerEvent): void {
    const t = ev.target as HTMLElement | null;
    if (t === this.pageEl()?.nativeElement || t?.closest?.('.pld-canvas') || t?.classList?.contains('pld-fixed')) this.select(null);
  }

  /** Press on a box = select it AND start dragging it (no second tap). */
  onBoxPointerDown(ev: PointerEvent, b: PageLayoutBox): void {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    this.select(b.id);
    this.pageEl()?.nativeElement.focus({ preventScroll: true });
    this.track(ev, b, 'move');
  }
  onHandlePointerDown(ev: PointerEvent, b: PageLayoutBox, handle: ResizeHandle): void {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    this.track(ev, b, 'resize', handle);
  }

  private track(ev: PointerEvent, start: PageLayoutBox, mode: 'move' | 'resize', handle?: ResizeHandle): void {
    const el = ev.currentTarget as HTMLElement;
    const sx = ev.clientX, sy = ev.clientY;
    const before = this.boxes();
    let moved = false;
    try { el.setPointerCapture(ev.pointerId); } catch { /* jsdom */ }
    const onMove = (e: PointerEvent) => {
      const dxPx = e.clientX - sx, dyPx = e.clientY - sy;
      if (!moved && Math.hypot(dxPx, dyPx) < 3) return;
      if (!moved) {
        moved = true;
        this.drag.set({ id: start.id, mode, handle, ghost: null, origin: start });
        this.captureGhost(start);
      }
      const k = this.mmPx();
      const snap = !e.altKey; // Alt = free placement
      const r = mode === 'move'
        ? dragBox(before, start.id, start.x + dxPx / k, start.y + dyPx / k, this.body(), snap)
        : resizeFromHandle(before, start, handle!, dxPx / k, dyPx / k, this.body(), snap);
      this.guideLines.set(r.guides);
      this.boxes.set(r.boxes);
      if (mode === 'resize') this.shiftGhost(start, r.boxes.find(x => x.id === start.id)!);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      this.guideLines.set({ v: [], h: [] });
      if (!moved) return;
      const r = this.boxRect(start);
      this.holes.update(hs => [...hs.filter(h => h.id !== start.id), { id: start.id, ...r }]);
      this.drag.set(null);
      const next = this.boxes();
      this.boxes.set(before);
      this.commit(next, before);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  /** Copy the box's pixels off the rendered page so its CONTENT travels with
   *  the pointer (the page itself re-renders only on drop). */
  private captureGhost(b: PageLayoutBox): void {
    const canvas = this.canvasHost()?.nativeElement.querySelector('canvas');
    if (!canvas) return;
    try {
      const r = this.boxRect(b);
      const scale = canvas.width / this.pageW();
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(r.w * scale)); c.height = Math.max(1, Math.round(r.h * scale));
      c.getContext('2d')!.drawImage(canvas, r.x * scale, r.y * scale, r.w * scale, r.h * scale, 0, 0, c.width, c.height);
      this.ghosts.update(g => ({ ...g, [b.id]: { url: c.toDataURL('image/png'), w: r.w, h: r.h, dx: 0, dy: 0 } }));
    } catch { /* tainted / jsdom — outline only */ }
  }
  /** While resizing from a top/left handle, keep the ghost's content anchored. */
  private shiftGhost(start: PageLayoutBox, now: PageLayoutBox): void {
    const g = this.ghosts()[start.id];
    if (!g) return;
    const k = this.mmPx();
    this.ghosts.update(all => ({ ...all, [start.id]: { ...g, dx: (start.x - now.x) * k, dy: (start.y - now.y) * k } }));
  }

  onKey(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) this.redo(); else this.undo(); return; }
    if (ev.key === 'Escape') {
      if (this.selected()) ev.preventDefault(); // the screen used the Esc (desktop full screen stays)
      this.select(null);
      return;
    }
    const id = this.selected();
    if (!id) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.remove(id); return; }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[ev.key];
    if (!d) return;
    ev.preventDefault();
    const s = ev.shiftKey ? 5 : this.step();
    this.nudge(d[0] * s, d[1] * s);
  }
}
