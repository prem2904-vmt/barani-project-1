import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { RouterLink } from '@angular/router';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  ColumnLock,
  ConditionRule,
  DEFAULT_REPORT_COLUMNS,
  GridRow,
  GridRowMerged,
  GridRowParameter,
  GridSection,
  ImageSection,
  ParagraphSection,
  ChartSection,
  ReportColumn,
  ReportSection,
  ReportSectionType,
  ResolvedRow,
  ResolvedSection,
} from '../../../shared/models/report-layout.model';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ReportPdfPreviewComponent } from '../report-template/report-pdf-preview.component';

const COLOR_TOKENS: Array<{ value: string; label: string; hex: string }> = [
  { value: '',       label: 'Default', hex: '#cbd5e1' },
  { value: 'red',    label: 'Red',     hex: '#C0392B' },
  { value: 'orange', label: 'Orange',  hex: '#E87722' },
  { value: 'green',  label: 'Green',   hex: '#1D9E75' },
];

const OPERATORS = [
  { value: '<',  label: '<' },
  { value: '<=', label: '≤' },
  { value: '>',  label: '>' },
  { value: '>=', label: '≥' },
  { value: '=',  label: '=' },
  { value: '!=', label: '≠' },
] as const;

/**
 * Per-test report layout editor — slot inside the Tests admin editor.
 * Builds the same JSON structure the backend ReportLayoutEngineService
 * consumes; sends to /api/report-layout/test/:id on save and renders a
 * live preview by hitting /api/report-layout/preview/:id with sample
 * values the admin types into the preview panel.
 *
 * Scope: section list (grid/paragraph/chart/image) + per-section
 * editors + condition builder + preview. Conditions UI uses the same
 * if/then/else-if/else shape the existing TestEntity.Conditions uses,
 * so admins moving between the two read the same mental model.
 */
@Component({
  selector: 'pf-test-layout-editor',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, RouterLink, SelectComponent, TileComponent, TouchButtonComponent, ReportPdfPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-tile tone="default" padding="lg" class="block">
      <div class="pf-le-toolbar">
        <div class="pf-le-toolbar__title">
          <h3 class="section-title">Report Layout</h3>
          <p class="pf-le-toolbar__sub">Sections render top-to-bottom · column structure inherits from the test's department.</p>
        </div>
        <span class="grow"></span>
        @if (configured()) {
          <span class="pf-pill pf-pill--ok">v{{ version() }}</span>
        }
        <pf-touch-btn size="sm" variant="secondary"
                      [disabled]="!testId() || sections().length === 0"
                      (pressed)="togglePreview()">
          {{ previewOpen() ? 'Hide preview' : 'Preview' }}
        </pf-touch-btn>
        <!-- Secondary: embedded in the test editor, whose band owns the ONE primary. -->
        <pf-touch-btn size="sm" variant="secondary"
                      [disabled]="saving() || !testId()" [busy]="saving()" busyLabel="Saving layout…"
                      (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save layout' }}
        </pf-touch-btn>
      </div>

      <!-- ── Body ────────────────────────────────────── -->
      @if (!testId()) {
        <p class="pf-le-empty">Save the test first — then come back here to design its report layout.</p>
      } @else {
        <div class="pf-le-shell" [class.pf-le-shell--preview]="previewOpen()">
          <main class="pf-le-main">

            <!-- Section tabs strip + add picker. Tabs scroll horizontally
                 if the test has many sections (rare, but defended). -->
            <nav class="pf-le-stabs">
              <div class="pf-le-stabs__scroll">
                @if (sections().length === 0) {
                  <p class="pf-le-stabs__empty">No sections yet — add one to start.</p>
                  @if (culture()) {
                    <button type="button" class="pf-link-btn" (click)="seedCultureLayout()">
                      Start from the classic C&amp;S structure
                    </button>
                  }
                }
                @for (s of sections(); track s.id) {
                  <button type="button" class="pf-le-stab"
                          [class.pf-le-stab--active]="selectedSectionId() === s.id"
                          (click)="selectSection(s.id)">
                    <span class="pf-le-stab__type" [attr.data-type]="s.type">{{ s.type }}</span>
                    <span class="pf-le-stab__label">{{ s.label || defaultLabel(s.type) }}</span>
                  </button>
                }
              </div>
              <div class="pf-le-stabs__addwrap">
                <button type="button" class="pf-le-stab pf-le-stab--add"
                        (click)="toggleAddPicker()">
                  + Add section
                  <span class="pf-le-stab__caret" [class.pf-le-stab__caret--open]="addPickerOpen()">▾</span>
                </button>
                @if (addPickerOpen()) {
                  <div class="pf-le-addmenu">
                    <button type="button" data-type="grid"      (click)="addAndCloseMenu('grid')">Grid (results table)</button>
                    <button type="button" data-type="paragraph" (click)="addAndCloseMenu('paragraph')">Paragraph (interpretation)</button>
                    <button type="button" data-type="chart"     (click)="addAndCloseMenu('chart')">Chart (gauge / bar)</button>
                    <button type="button" data-type="image"     (click)="addAndCloseMenu('image')">Image (attachments)</button>
                    @if (culture()) {
                      <button type="button" data-type="culture_line" (click)="addAndCloseMenu('culture_line')">Culture line (Gram / growth / notes)</button>
                      <button type="button" data-type="culture_ast"  (click)="addAndCloseMenu('culture_ast')">AST table (per-organism)</button>
                    }
                  </div>
                }
              </div>
            </nav>

            @if (selectedSection(); as s) {
              <!-- Section meta row: label + reorder + delete. Single line. -->
              <header class="pf-le-smeta">
                <input type="text" class="pf-input pf-input--inline-label grow"
                       [value]="s.label ?? ''"
                       (input)="patchSection(selectedSectionIndex(), { label: $any($event.target).value || null })"
                       [placeholder]="defaultLabel(s.type)" />
                <button type="button" class="pf-icon-btn"
                        [disabled]="selectedSectionIndex() <= 0"
                        (click)="moveSelected(-1)" aria-label="Move section up">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m18 15-6-6-6 6"/>
                  </svg>
                </button>
                <button type="button" class="pf-icon-btn"
                        [disabled]="selectedSectionIndex() === sections().length - 1"
                        (click)="moveSelected(1)" aria-label="Move section down">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </button>
                <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                        (click)="removeSelected()" aria-label="Delete section">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </header>

              <!-- ── GRID SECTION → spreadsheet ── -->
              @if (s.type === 'grid') {
                @if (deptColumns().length === 0 && departmentId()) {
                  <p class="pf-le-tip">
                    Department columns aren't configured yet —
                    <a routerLink="/admin/reports" [queryParams]="{ tab: 'columns' }">configure them</a>
                    so cells line up with the canonical structure. Defaults below until then.
                  </p>
                }

                <div class="pf-le-sheet">
                  <div class="pf-le-sheet__scroll">
                  <table class="pf-le-sheet__tbl">
                    <thead>
                      <tr>
                        <th class="pf-le-sheet__hdr-param">Parameter</th>
                        @for (col of deptColumnsForRender(); track col.id) {
                          <th class="pf-le-sheet__hdr" [style.width.%]="col.width">
                            <span class="pf-le-sheet__hdr-label">{{ col.label }}</span>
                            <span class="pf-le-sheet__hdr-meta">{{ col.type }}</span>
                          </th>
                        }
                        <th class="pf-le-sheet__hdr-actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of asGrid(s).rows; track r.id; let ri = $index) {
                        <tr class="pf-le-sheet__row"
                            [class.pf-le-sheet__row--merged]="r.row_merge"
                            [class.pf-le-sheet__row--open]="expandedRowId() === r.id">
                          @if (r.row_merge) {
                            <!-- Merged row: badge + (optional) inline "Show
                                 when" rule. The rule editor only renders
                                 once admin clicks "+ Show when" — by default
                                 the row is unconditional and shows the
                                 add button instead. Clearing the rule
                                 (picking "— always —") collapses back to
                                 the add-button state. -->
                            <td class="pf-le-sheet__c-merged-rule" [attr.colspan]="2">
                              <div class="pf-merged-rule">
                                <span class="pf-row__badge pf-row__badge--merged">Merged</span>
                                @if ((r.conditions ?? []).length === 0) {
                                  <button type="button" class="pf-link-btn pf-merged-rule__add"
                                          (click)="addShowOnlyWhen(selectedSectionIndex(), ri)"
                                          title="Add a show-when condition for this row">
                                    + Show when
                                  </button>
                                } @else {
                                  <span class="pf-merged-rule__lbl">Show when</span>
                                  <pf-select
                                    class="pf-merged-rule__param"
                                    size="sm"
                                    [options]="toOpts(parameters(), '— always —')"
                                    [value]="getMergedRulePart(r, 'parameter')"
                                    (valueChange)="setMergedRulePart(selectedSectionIndex(), ri, 'parameter', $event)">
                                  </pf-select>
                                  @if (getMergedRulePart(r, 'parameter')) {
                                    <pf-select
                                      class="pf-merged-rule__op"
                                      style="width: 72px"
                                      size="sm"
                                      [options]="operators"
                                      [value]="getMergedRulePart(r, 'operator')"
                                      (valueChange)="setMergedRulePart(selectedSectionIndex(), ri, 'operator', $event)">
                                    </pf-select>
                                    <input type="number" class="pf-input pf-input--cell pf-merged-rule__val"
                                           [value]="getMergedRulePart(r, 'value')"
                                           (input)="setMergedRulePart(selectedSectionIndex(), ri, 'value', $any($event.target).value)" />
                                  }
                                }
                              </div>
                            </td>
                            <td [attr.colspan]="deptColumnsForRender().length - 1" class="pf-le-sheet__c-merged">
                              <input type="text" class="pf-input pf-input--cell"
                                     [value]="asMerged(r).merge_content.template ?? ''"
                                     (input)="patchMergeTpl(selectedSectionIndex(), ri, $any($event.target).value)"
                                     [attr.placeholder]="mergedTplPlaceholder" />
                            </td>
                          } @else {
                            <td class="pf-le-sheet__c-param">
                              <pf-select
                                size="sm"
                                [options]="toOpts(parameters(), '— pick —')"
                                [value]="asParam(r).parameter_name"
                                (valueChange)="patchRow(selectedSectionIndex(), ri, { parameter_name: $event })">
                              </pf-select>
                              @if (condCount(r) > 0) {
                                <span class="pf-le-sheet__cond-pill" [title]="condCount(r) + ' condition(s)'">
                                  <span class="pf-num">{{ condCount(r) }}</span> if
                                </span>
                              }
                            </td>
                            @for (col of deptColumnsForRender(); track col.id) {
                              @let locked = hasLock(asParam(r).parameter_name, col.name);
                              @let suggestions = cellSuggestions(col, r);
                              @if (isDerivedCol(col)) {
                                <!-- Unit / reference range print from the value's own
                                     definition (single source) — never typed here. -->
                                <td class="pf-le-sheet__c pf-le-sheet__c--derived"
                                    title="Printed from the value's own {{ col.type === 'unit' ? 'unit' : 'reference range' }} in the Test Master">
                                  <span class="pf-le-sheet__derived">from the value</span>
                                </td>
                              } @else {
                              <td class="pf-le-sheet__c"
                                  [class.pf-le-sheet__c--locked]="locked">
                                <!-- All cell controls live inside the inner div so the absolute
                                     menu anchors to it reliably. <td> doesn't honor
                                     position: relative across browsers. -->
                                <div class="pf-le-sheet__c-inner">
                                  <input type="text" class="pf-input pf-input--cell"
                                         [value]="displayCellValue(r, col.name)"
                                         (input)="setCellReadable(selectedSectionIndex(), ri, col.name, $any($event.target).value)"
                                         (blur)="locked && commitLock(asParam(r).parameter_name)"
                                         [attr.placeholder]="cellPlaceholder(col)" />

                                  <!-- Right-side icon: ▾ suggestion trigger only. Cells are pure
                                       per-row templates — locks were causing cross-row bleed
                                       because they're parameter-keyed, so the toggle was
                                       removed. Typing in a previously-locked cell auto-migrates
                                       the value into the row's per-row template (see
                                       setCellOrLock). -->
                                  @if (suggestions.length > 0) {
                                    <span class="pf-le-sheet__c-icons">
                                      <button type="button" class="pf-le-sheet__caret"
                                              (click)="toggleSuggest(r.id, col.name)"
                                              [class.pf-le-sheet__caret--open]="isSuggestOpen(r.id, col.name)"
                                              aria-label="Insert template"
                                              title="Insert template">▾</button>
                                    </span>
                                  }

                                  <!-- Suggestion popup — anchored to .pf-le-sheet__c-inner.
                                       Label is the readable name; hint is the muted helper. -->
                                  @if (isSuggestOpen(r.id, col.name)) {
                                    <div class="pf-le-sheet__menu">
                                      @for (sug of suggestions; track sug.value) {
                                        <button type="button"
                                                (click)="pickSuggestion(selectedSectionIndex(), ri, col.name, sug.value)">
                                          <span class="pf-le-sheet__menu-lbl">{{ sug.label }}</span>
                                          @if (sug.hint) {
                                            <span class="pf-le-sheet__menu-hint">{{ sug.hint }}</span>
                                          }
                                        </button>
                                      }
                                    </div>
                                  }
                                </div>
                              </td>
                              }
                            }
                          }
                          <td class="pf-le-sheet__c-actions">
                            <button type="button" class="pf-icon-btn pf-icon-btn--sm"
                                    [class.pf-icon-btn--on]="expandedRowId() === r.id"
                                    (click)="toggleRow(r.id)"
                                    [attr.aria-label]="expandedRowId() === r.id ? 'Hide row options' : 'Show row options'"
                                    title="Conditions / move / delete">⋯</button>
                          </td>
                        </tr>

                        <!-- Inline detail — sits BETWEEN this row and the next.
                             Banner names the row being edited; coloured left
                             border keeps ownership unambiguous. -->
                        @if (expandedRowId() === r.id) {
                          <tr class="pf-le-sheet__detail-row"
                              [class.pf-le-sheet__detail-row--merged]="r.row_merge">
                            <td [attr.colspan]="deptColumnsForRender().length + 2">
                              <header class="pf-le-detail-banner"
                                      [class.pf-le-detail-banner--merged]="r.row_merge">
                                <span class="pf-row__badge"
                                      [class.pf-row__badge--merged]="r.row_merge">
                                  {{ r.row_merge ? 'Merged' : 'Param' }}
                                </span>
                                <span class="pf-le-detail-banner__lbl">
                                  Editing — {{ rowSummary(r) }}
                                </span>
                                <span class="grow"></span>
                                <button type="button" class="pf-link-btn"
                                        (click)="toggleRow(r.id)">Close</button>
                              </header>

                              <div class="pf-le-detail">
                                <section class="pf-le-detail__col">
                                  <header class="pf-le-detail__hdr">
                                    <h5>Conditions for this row</h5>
                                    <span class="grow"></span>
                                    @if (r.row_merge && (r.conditions ?? []).length === 0) {
                                      <button type="button" class="pf-link-btn"
                                              (click)="addShowOnlyWhen(selectedSectionIndex(), ri)"
                                              title="Adds an IF + ELSE pair so this merged row appears only when the condition matches">
                                        Show only when…
                                      </button>
                                    }
                                    <button type="button" class="pf-link-btn"
                                            (click)="addCondition(selectedSectionIndex(), ri)">+ IF</button>
                                    @if (!hasElseCondition(r)) {
                                      <button type="button" class="pf-link-btn"
                                              (click)="addElseCondition(selectedSectionIndex(), ri)">+ ELSE</button>
                                    }
                                  </header>
                                  @if ((r.conditions ?? []).length === 0) {
                                    <p class="pf-le-tip">None. Add an IF branch to color the row, set a cell, or hide it on certain results. Add an ELSE branch as the fallback.</p>
                                  }
                                  @for (c of (r.conditions ?? []); track $index; let ci = $index) {
                                    <ng-container *ngTemplateOutlet="rowCondTpl; context: { c, ci, ri, isMerged: r.row_merge }"></ng-container>
                                  }
                                </section>

                                <section class="pf-le-detail__col pf-le-detail__col--narrow">
                                  <h5>Row</h5>
                                  <div class="pf-le-detail__actions">
                                    <button type="button" class="pf-link-btn"
                                            [disabled]="ri === 0"
                                            (click)="moveRow(selectedSectionIndex(), ri, -1)">Move up</button>
                                    <button type="button" class="pf-link-btn"
                                            [disabled]="ri === asGrid(s).rows.length - 1"
                                            (click)="moveRow(selectedSectionIndex(), ri, 1)">Move down</button>
                                    <button type="button" class="pf-link-btn pf-link-btn--danger"
                                            (click)="removeRow(selectedSectionIndex(), ri)">Delete row</button>
                                  </div>
                                </section>
                              </div>
                            </td>
                          </tr>
                        }
                      }
                      <tr class="pf-le-sheet__add">
                        <td [attr.colspan]="deptColumnsForRender().length + 2">
                          <button type="button" class="pf-link-btn"
                                  (click)="addRowAndExpand(selectedSectionIndex(), false)">+ Parameter row</button>
                          <button type="button" class="pf-link-btn"
                                  (click)="addRowAndExpand(selectedSectionIndex(), true)">+ Merged row</button>
                          <button type="button" class="pf-link-btn"
                                  (click)="addConditionalNote(selectedSectionIndex())"
                                  title="A merged note row that's only shown when a condition matches">
                            + Conditional note
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>

              }

              <!-- ── PARAGRAPH SECTION ── -->
              @if (s.type === 'paragraph') {
                <label class="pf-label-mini">Template</label>
                <p class="pf-le-tip">Use {{ phLabel }} for results, {{ phUnitLabel }} or {{ phRangeLabel }} for metadata.</p>
                <textarea class="pf-input pf-input--ta"
                          rows="6"
                          [value]="asPara(s).template"
                          (input)="patchSection(selectedSectionIndex(), { template: $any($event.target).value })"
                          [attr.placeholder]="paragraphPlaceholder"></textarea>

                <div class="pf-le-cond-block">
                  <div class="pf-le-cond-block__hdr">
                    <label class="pf-label-mini">Show this section when…</label>
                    <span class="grow"></span>
                    <button type="button" class="pf-link-btn"
                            (click)="addSectionCondition(selectedSectionIndex())">+ IF</button>
                    @if (!hasElseSectionCondition(s)) {
                      <button type="button" class="pf-link-btn"
                              (click)="addElseSectionCondition(selectedSectionIndex())">+ ELSE</button>
                    }
                  </div>
                  @if ((s.conditions ?? []).length === 0) {
                    <p class="pf-le-tip">Always shown by default. Add an IF to gate it on a result, plus an ELSE as the fallback.</p>
                  }
                  @for (c of (s.conditions ?? []); track $index; let ci = $index) {
                    <ng-container *ngTemplateOutlet="sectionCondTpl; context: { c, ci, sec: s }"></ng-container>
                  }
                </div>
              }

              <!-- ── CULTURE SECTIONS (offered only for culture tests) ── -->
              @if (s.type === 'culture_line') {
                <label class="pf-label-mini">Label on the report</label>
                <input class="pf-input" [value]="s.label || ''"
                       (input)="patchSection(selectedSectionIndex(), { label: $any($event.target).value })"
                       placeholder="e.g. GRAM STAIN" />
                <label class="pf-label-mini">Data source</label>
                <pf-select [options]="cultureSourceOptions" [value]="asCultureLine(s).source"
                           (valueChange)="patchSection(selectedSectionIndex(), $any({ source: $event }))"></pf-select>
                <p class="pf-le-tip">The line's text comes from the culture bench (stage findings, notes). Empty sources are skipped on the PDF.</p>
              }
              @if (s.type === 'culture_ast') {
                <p class="pf-le-tip">Per-organism antimicrobial tables + the S/R/M legend. Content comes from the bench AST stage — the bench's row checkboxes still hide individual antibiotics or organisms.</p>
                <!-- The exact legend the PDF prints under the AST tables — shown
                     here so the print-order surface carries the full picture. -->
                <div class="pf-le-legend">
                  <p>S - Sensitive (clinically effective at standard therapeutic dose)</p>
                  <p>R - Resistant (clinically ineffective at standard or increased dose)</p>
                  <p>M - Intermediate (may be effective at higher dose or in concentrated body sites)</p>
                  <p>Choice of antimicrobial depends on the clinical status, site of infection, and the drug pharmacokinetics/pharmacodynamics.</p>
                </div>
              }

              <!-- ── CHART SECTION ── -->
              @if (s.type === 'chart') {
                <div class="pf-le-grid3">
                  <div>
                    <label class="pf-label-mini">Parameter</label>
                    <pf-select
                      size="sm"
                      [options]="toOpts(parameters(), '— pick —')"
                      [value]="asChart(s).parameter"
                      (valueChange)="patchSection(selectedSectionIndex(), { parameter: $event })">
                    </pf-select>
                  </div>
                  <div>
                    <label class="pf-label-mini">Min</label>
                    <input type="number" class="pf-input pf-input--compact"
                           [value]="asChart(s).min"
                           (input)="patchSection(selectedSectionIndex(), { min: +$any($event.target).value })" />
                  </div>
                  <div>
                    <label class="pf-label-mini">Max</label>
                    <input type="number" class="pf-input pf-input--compact"
                           [value]="asChart(s).max"
                           (input)="patchSection(selectedSectionIndex(), { max: +$any($event.target).value })" />
                  </div>
                </div>

                <div class="pf-zones">
                  <div class="pf-le-cond-block__hdr">
                    <label class="pf-label-mini">Zones</label>
                    <button type="button" class="pf-link-btn" (click)="addZone(selectedSectionIndex())">+ Add zone</button>
                  </div>
                  @if (asChart(s).zones.length === 0) {
                    <p class="pf-le-tip">No zones yet — add bands to highlight low / normal / high ranges on the scale.</p>
                  }
                  @for (z of asChart(s).zones; track $index; let zi = $index) {
                    <div class="pf-zone">
                      <div class="pf-zone__row">
                        <input type="text" class="pf-input pf-input--compact"
                               placeholder="Label (low / normal / high)"
                               [value]="z.label ?? ''"
                               (input)="patchZone(selectedSectionIndex(), zi, { label: $any($event.target).value })" />
                        <span class="pf-le-tip pf-le-tip--inline">From</span>
                        <input type="number" class="pf-input pf-input--compact pf-input--num" style="width: 80px"
                               [value]="z.from"
                               (input)="patchZone(selectedSectionIndex(), zi, { from: +$any($event.target).value })" />
                        <span class="pf-le-tip pf-le-tip--inline">To</span>
                        <input type="number" class="pf-input pf-input--compact pf-input--num" style="width: 80px"
                               [value]="z.to"
                               (input)="patchZone(selectedSectionIndex(), zi, { to: +$any($event.target).value })" />
                        <span class="grow"></span>
                        @for (col of zoneColors; track col.value) {
                          <button type="button" class="pf-color-chip"
                                  [class.pf-color-chip--on]="z.color === col.value"
                                  [style.background]="col.hex"
                                  (click)="patchZone(selectedSectionIndex(), zi, { color: col.value })"
                                  [attr.aria-label]="col.label" [title]="col.label"></button>
                        }
                        <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                                (click)="removeZone(selectedSectionIndex(), zi)" aria-label="Remove zone">×</button>
                      </div>
                      <div class="pf-zone__bar">
                        <span class="pf-zone__bar-band"
                              [style.left.%]="zonePctLeftDraft(asChart(s), z)"
                              [style.width.%]="zonePctWidthDraft(asChart(s), z)"
                              [style.background]="zoneHex(z.color)"></span>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- ── IMAGE SECTION ── -->
              @if (s.type === 'image') {
                <label class="pf-label-mini">Caption</label>
                <input type="text" class="pf-input pf-input--compact"
                       [value]="asImage(s).caption ?? ''"
                       (input)="patchSection(selectedSectionIndex(), { caption: $any($event.target).value })"
                       placeholder="Attached images" />
                <p class="pf-le-tip" style="margin-top: 12px;">
                  Renders any images uploaded by the tech / pathologist during result entry.
                  Hidden by default when no images are attached.
                </p>
              }
            } @else {
              <p class="pf-le-empty">No section selected. Add one above to get started.</p>
            }
          </main>

          <!-- ── Live preview drawer ─────────────────────── -->
          @if (previewOpen()) {
            <aside class="pf-le-preview">
              <header class="pf-le-preview__hdr">
                <h4>Live preview</h4>
                <span class="grow"></span>
                <button type="button" class="pf-link-btn" (click)="refreshPreview()">Refresh</button>
                <button type="button" class="pf-icon-btn" (click)="togglePreview()" aria-label="Close preview">×</button>
              </header>

              <div class="pf-le-preview__samples">
                <span class="pf-label-mini">Sample values</span>
                <div class="pf-le-preview__sample-grid">
                  @for (p of parameters(); track p) {
                    <label class="pf-sample-input">
                      <span>{{ p }}</span>
                      <input type="text" class="pf-input pf-input--compact"
                             [value]="$any(sampleValues()[p] ?? '')"
                             (input)="setSampleValue(p, $any($event.target).value)" />
                    </label>
                  }
                </div>
              </div>

              <!-- The EXACT print: same jsPDF pipeline as the patient report,
                   with the typed sample values driving the engine. Reflects
                   the SAVED layout (refresh saves the draft first). -->
              <div class="pf-preview-render pf-preview-render--pdf">
                <pf-report-pdf-preview
                  [testId]="testId()"
                  [parameters]="parameters()"
                  [values]="sampleValues()"
                  [culture]="culture()"
                  [refreshToken]="previewToken()">
                </pf-report-pdf-preview>
              </div>
            </aside>
          }
        </div>

        <!-- Shared row-condition + section-condition templates so the grid &
             paragraph editors don't need to inline the same chooser twice. -->
        <ng-template #rowCondTpl let-c="c" let-ci="ci" let-ri="ri" let-isMerged="isMerged">
          <div class="pf-cond"
               [class.pf-cond--else]="c.else"
               [class.pf-cond--unset]="!c.else && !(c.if?.parameter)">
            <div class="pf-cond__head">
              <button type="button" class="pf-cond__mode"
                      (click)="toggleCondMode(selectedSectionIndex(), ri, ci)"
                      [title]="c.else ? 'Switch to IF (predicate)' : 'Switch to ELSE (fallback)'">
                {{ c.else ? 'ELSE' : 'IF' }}
              </button>
              @if (!c.else) {
                @if (!c.if?.parameter) {
                  <span class="pf-cond__warn" title="Predicate not set — this branch will never match">Pick a parameter →</span>
                }
                <pf-select
                  size="sm"
                  [options]="toOpts(parameters(), '— param —')"
                  [value]="c.if?.parameter ?? ''"
                  (valueChange)="patchCond(selectedSectionIndex(), ri, ci, { if: { ...(c.if ?? {}), parameter: $event } })">
                </pf-select>
                <pf-select
                  size="sm"
                  style="width: 72px"
                  [options]="operators"
                  [value]="c.if?.operator ?? '<'"
                  (valueChange)="patchCond(selectedSectionIndex(), ri, ci, { if: { ...(c.if ?? {}), operator: $event } })">
                </pf-select>
                <input type="number" class="pf-input pf-input--compact" style="width: 90px"
                       [value]="$any(c.if?.value ?? '')"
                       (input)="patchCond(selectedSectionIndex(), ri, ci, { if: { ...(c.if ?? {}), value: numOrStr($any($event.target).value) } })" />
              }
              <span class="grow"></span>
              <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                      (click)="removeCondition(selectedSectionIndex(), ri, ci)" aria-label="Remove condition">×</button>
            </div>
            <div class="pf-cond__then">
              <span class="pf-cond__kw">THEN</span>

              <!-- Row visibility — Default / Show / Hide. Used to gate
                   merged-note rows or hide a row entirely on a result. -->
              <span class="pf-le-tip pf-le-tip--inline">row</span>
              <label class="pf-bold-toggle">
                <input type="radio" [name]="'visrow-' + ri + '-' + ci"
                       [checked]="c.then.show === undefined && c.then.hide_section !== true && c.then.show_section !== true"
                       (change)="setCondVisibility(selectedSectionIndex(), ri, ci, 'default')" />
                <span>Default</span>
              </label>
              <label class="pf-bold-toggle">
                <input type="radio" [name]="'visrow-' + ri + '-' + ci"
                       [checked]="c.then.show === true || c.then.show_section === true"
                       (change)="setCondVisibility(selectedSectionIndex(), ri, ci, 'show')" />
                <span>Show</span>
              </label>
              <label class="pf-bold-toggle">
                <input type="radio" [name]="'visrow-' + ri + '-' + ci"
                       [checked]="c.then.show === false || c.then.hide_section === true"
                       (change)="setCondVisibility(selectedSectionIndex(), ri, ci, 'hide')" />
                <span>Hide</span>
              </label>

              <!-- Color + bold (existing). -->
              <span class="pf-le-tip pf-le-tip--inline" style="margin-left: 6px;">color</span>
              @for (col of colors; track col.value) {
                <button type="button" class="pf-color-chip"
                        [class.pf-color-chip--on]="(c.then.color ?? c.then.set_color ?? '') === col.value"
                        [style.background]="col.hex"
                        (click)="patchCond(selectedSectionIndex(), ri, ci, { then: { ...c.then, color: col.value || undefined } })"
                        [attr.aria-label]="col.label" [title]="col.label"></button>
              }
              <label class="pf-bold-toggle">
                <input type="checkbox" [checked]="!!(c.then.bold || c.then.set_bold)"
                       (change)="patchCond(selectedSectionIndex(), ri, ci, { then: { ...c.then, bold: $any($event.target).checked } })" />
                <span>Bold</span>
              </label>
            </div>

            @if (isMerged) {
              <!-- Merged rows render the row's note template, not column
                   cells. The override here is a single note string that
                   replaces the merged row's text on match. Engine reads
                   condition.then.merge_content for merged rows. -->
              <div class="pf-cond__cells">
                <div class="pf-cond__cells-hdr">
                  <span class="pf-le-tip pf-le-tip--inline">set note</span>
                  <span class="pf-le-tip" style="font-size: 10px;">
                    Replaces the merged row's text on match. Supports {{ phLabel }} placeholders.
                  </span>
                </div>
                <textarea class="pf-input pf-input--ta"
                          rows="2"
                          [value]="c.then.merge_content ?? ''"
                          (input)="setCondMergeContent(selectedSectionIndex(), ri, ci, $any($event.target).value)"
                          placeholder="Note text for this branch"></textarea>
              </div>
            } @else {
              <!-- Parameter rows: stamp values into specific dept columns. -->
              <div class="pf-cond__cells">
                <div class="pf-cond__cells-hdr">
                  <span class="pf-le-tip pf-le-tip--inline">override cells</span>
                  <button type="button" class="pf-link-btn"
                          (click)="addCondCell(selectedSectionIndex(), ri, ci)">+ Set cell</button>
                </div>
                @for (entry of condCellEntries(c); track entry[0]) {
                  <div class="pf-cond__cell-edit">
                    <pf-select
                      size="sm"
                      [options]="colOpts()"
                      [value]="entry[0]"
                      (valueChange)="setCondCellKey(selectedSectionIndex(), ri, ci, entry[0], $event)">
                    </pf-select>
                    <input type="text" class="pf-input pf-input--compact grow"
                           [value]="entry[1]"
                           (input)="setCondCellValue(selectedSectionIndex(), ri, ci, entry[0], $any($event.target).value)"
                           placeholder="value or {{ phLabel }}" />
                    <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                            (click)="removeCondCell(selectedSectionIndex(), ri, ci, entry[0])"
                            aria-label="Remove cell override">×</button>
                  </div>
                }
              </div>
            }
          </div>
        </ng-template>

        <ng-template #sectionCondTpl let-c="c" let-ci="ci" let-sec="sec">
          <div class="pf-cond" [class.pf-cond--else]="c.else">
            <div class="pf-cond__head">
              <button type="button" class="pf-cond__mode"
                      (click)="toggleSectionCondMode(selectedSectionIndex(), ci)"
                      [title]="c.else ? 'Switch to IF (predicate)' : 'Switch to ELSE (fallback)'">
                {{ c.else ? 'ELSE' : 'IF' }}
              </button>
              @if (!c.else) {
                <pf-select
                  size="sm"
                  [options]="toOpts(parameters(), '— param —')"
                  [value]="c.if?.parameter ?? ''"
                  (valueChange)="patchSectionCond(selectedSectionIndex(), ci, { if: { ...(c.if ?? {}), parameter: $event } })">
                </pf-select>
                <pf-select
                  size="sm"
                  style="width: 72px"
                  [options]="operators"
                  [value]="c.if?.operator ?? '<'"
                  (valueChange)="patchSectionCond(selectedSectionIndex(), ci, { if: { ...(c.if ?? {}), operator: $event } })">
                </pf-select>
                <input type="number" class="pf-input pf-input--compact" style="width: 90px"
                       [value]="$any(c.if?.value ?? '')"
                       (input)="patchSectionCond(selectedSectionIndex(), ci, { if: { ...(c.if ?? {}), value: numOrStr($any($event.target).value) } })" />
              }
              <span class="grow"></span>
              <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                      (click)="removeSectionCondition(selectedSectionIndex(), ci)" aria-label="Remove condition">×</button>
            </div>
            <div class="pf-cond__then">
              <span class="pf-cond__kw">THEN</span>
              <label class="pf-bold-toggle">
                <input type="radio" [name]="'show-' + sec.id + '-' + ci"
                       [checked]="c.then.show !== false"
                       (change)="patchSectionCond(selectedSectionIndex(), ci, { then: { ...c.then, show: true } })" />
                <span>Show</span>
              </label>
              <label class="pf-bold-toggle">
                <input type="radio" [name]="'show-' + sec.id + '-' + ci"
                       [checked]="c.then.show === false"
                       (change)="patchSectionCond(selectedSectionIndex(), ci, { then: { ...c.then, show: false } })" />
                <span>Hide</span>
              </label>
            </div>
          </div>
        </ng-template>
      }

    </pf-tile>
  `,
  styles: [`
    /* ───── Toolbar ───── */
    .pf-le-toolbar {
      display: flex; align-items: center; gap: 12px;
      padding-bottom: 14px;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--glass-border);
      flex-wrap: wrap;
    }
    .pf-le-toolbar__title { display: flex; flex-direction: column; gap: 2px; }
    .pf-le-toolbar__sub {
      font-size: 12px; color: var(--text-tertiary);
      margin: 0;
    }
    .pf-le-toolbar > .grow { flex: 1; }

    .pf-pill {
      display: inline-flex; align-items: center;
      padding: 3px 10px;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 9999px;
      border: 1px solid var(--glass-border);
    }
    .pf-pill--ok {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);
      border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 30%, transparent);
      color: var(--violet-text, #6d28d9);
    }

    /* ───── Empty / shell ───── */
    .pf-le-empty {
      text-align: center;
      padding: 36px 12px;
      font-size: 13px;
      color: var(--text-tertiary);
    }
    .pf-le-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .pf-le-shell--preview {
      grid-template-columns: minmax(0, 1fr) 320px;
    }
    @media (max-width: 1024px) {
      .pf-le-shell--preview { grid-template-columns: 1fr; }
    }
    .pf-le-main {
      display: flex; flex-direction: column;
      gap: 12px;
      min-width: 0;
    }

    /* ───── Section tabs strip ───── */
    .pf-le-stabs {
      display: flex; align-items: center; gap: 10px;
      flex-wrap: wrap;
    }
    .pf-le-stabs__scroll {
      display: flex; align-items: center; gap: 4px;
      flex-wrap: wrap;
      flex: 1; min-width: 0;
    }
    .pf-le-stabs__empty {
      font-size: 12px; color: var(--text-muted);
      margin: 0; padding: 4px 0;
    }
    .pf-le-stab {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 12px;
      border-radius: 9999px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
      font-size: 12.5px;
      max-width: 260px;
    }
    .pf-le-stab:hover { background: var(--bg-hover); color: var(--text-primary); }
    .pf-le-stab--active {
      background: rgba(168, 85, 247, 0.16);
      border-color: rgba(168, 85, 247, 0.45);
      color: var(--violet-text);
    }
    .pf-le-stab__type {
      padding: 1px 7px;
      font-size: 9px; font-weight: 800;
      letter-spacing: 0.16em; text-transform: uppercase;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.16);
      border: 1px solid rgba(168, 85, 247, 0.4);
      color: var(--violet-text);
    }
    .pf-le-stab__type[data-type='paragraph'] { background: rgba(59, 130, 246, 0.16); border-color: rgba(59, 130, 246, 0.4); color: #93c5fd; }
    .pf-le-stab__type[data-type='chart']     { background: var(--pf-sel-bg); border-color: var(--pf-sel-border); color: var(--text-secondary); }
    .pf-le-stab__type[data-type='image']     { background: color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 30%, transparent); color: var(--violet-text, #6d28d9); }
    .pf-le-stab__label {
      font-weight: 600;
      max-width: 180px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-le-stab--add {
      border-style: dashed;
      color: var(--text-muted);
      font-weight: 600;
    }
    .pf-le-stab__caret {
      display: inline-block;
      transition: transform 0.18s ease;
      font-size: 10px;
    }
    .pf-le-stab__caret--open { transform: rotate(180deg); }

    /* + Add section dropdown menu */
    .pf-le-stabs__addwrap { position: relative; }
    .pf-le-addmenu {
      position: absolute; top: calc(100% + 6px); right: 0;
      display: flex; flex-direction: column;
      min-width: 220px;
      padding: 6px;
      border-radius: 12px;
      background: var(--bg-card-solid, var(--glass-bg));
      border: 1px solid var(--glass-border);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      z-index: 30;
    }
    .pf-le-addmenu button {
      text-align: left;
      padding: 8px 10px;
      font-size: 12.5px;
      border: 0; background: transparent;
      border-radius: 8px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .pf-le-addmenu button:hover { color: var(--text-primary); background: var(--bg-hover); }
    .pf-le-addmenu button[data-type='grid']:hover      { color: var(--violet-text); background: rgba(168, 85, 247, 0.1); }
    .pf-le-addmenu button[data-type='paragraph']:hover { color: #93c5fd; background: rgba(59, 130, 246, 0.1); }
    .pf-le-addmenu button[data-type='chart']:hover     { color: var(--text-secondary); background: var(--pf-sel-bg); }
    .pf-le-addmenu button[data-type='image']:hover     { color: var(--violet-text, #6d28d9); background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, transparent); }

    /* ───── Section meta row ───── */
    .pf-le-smeta {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-le-smeta > .grow { flex: 1; }

    /* ───── Spreadsheet ───── */
    /* Outer wrapper keeps the visual frame (rounded border) without
       clipping — clipping would hide cell suggestion menus that drop
       below the cell. The inner __scroll handles horizontal overflow on
       narrow viewports. */
    .pf-le-sheet {
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      background: var(--glass-bg);
      width: 100%;
      overflow: visible;
    }
    .pf-le-sheet__scroll {
      overflow-x: auto;
      overflow-y: visible;
      border-radius: 12px;
    }
    .pf-le-sheet__tbl {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      min-width: 720px;
    }
    .pf-le-sheet__hdr-param,
    .pf-le-sheet__hdr {
      text-align: left;
      padding: 10px 12px 9px;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px solid rgba(168, 85, 247, 0.25);
      background: linear-gradient(180deg, rgba(168, 85, 247, 0.08), rgba(168, 85, 247, 0.02));
      /* Long headings ("Reference range") were colliding into their
         neighbour ("...rangeDescription") — clip inside the cell instead. */
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 0;
      vertical-align: bottom;
    }
    .pf-le-sheet__hdr-param { width: 200px; }
    .pf-le-sheet__hdr-actions {
      width: 44px;
      background: linear-gradient(180deg, rgba(168, 85, 247, 0.08), rgba(168, 85, 247, 0.02));
      border-bottom: 1px solid rgba(168, 85, 247, 0.25);
    }
    .pf-le-sheet__hdr-label {
      display: block;
      color: var(--text-primary);
      font-size: 12px;
      letter-spacing: 0;
      text-transform: none;
      font-weight: 700;
    }
    .pf-le-sheet__hdr-meta {
      display: block;
      font-size: 9.5px;
      color: var(--violet-text);
      margin-top: 3px;
      letter-spacing: 0.16em;
      font-weight: 800;
    }

    .pf-le-sheet__row td {
      padding: 4px 6px;
      border-bottom: 1px solid var(--glass-border);
      vertical-align: middle;
    }
    /* Subtle zebra striping for scannability across many rows. */
    .pf-le-sheet__row:nth-child(odd) td {
      background: rgba(255, 255, 255, 0.012);
    }
    .pf-le-sheet__row:hover td {
      background: rgba(168, 85, 247, 0.06) !important;
    }
    .pf-le-sheet__row--open td {
      background: rgba(168, 85, 247, 0.1) !important;
    }
    .pf-le-sheet__row--merged td {
      background: var(--pf-sel-bg) !important;
    }

    /* Parameter cell */
    .pf-le-sheet__c-param {
      display: flex; align-items: center; gap: 6px;
      padding-left: 12px !important;
      min-width: 180px;
    }
    .pf-le-sheet__cond-pill {
      padding: 1px 7px;
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.04em;
      border-radius: 9999px;
      background: var(--pf-sel-bg);
      border: 1px solid var(--pf-sel-border);
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    /* Data cell */
    .pf-le-sheet__c {
      position: relative;
      vertical-align: middle;
    }
    .pf-le-sheet__c--derived { background: var(--surface-2, transparent); }
    .pf-le-sheet__derived {
      display: block; padding: 4px 8px; font-size: 12px; font-style: italic;
      color: var(--text-tertiary, #94a3b8); white-space: nowrap;
    }
    .pf-le-sheet__c--locked {
      background: var(--pf-sel-bg) !important;
    }
    .pf-le-sheet__c--locked .pf-input--cell {
      color: var(--text-secondary);
      font-weight: 600;
    }
    .pf-le-sheet__c-inner {
      position: relative;
      display: flex; align-items: center;
    }

    /* Inline cell input — borderless, fills its td. Pulls a faint focus
       ring so the cell-being-edited reads like a spreadsheet selection.
       Default right-padding works for cells without the ▾ icon; cells
       that have it bump padding via the :has() rule below. */
    .pf-input--cell {
      width: 100%;
      padding: 7px 10px;
      font-size: 12.5px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: inherit;
      transition: background 0.12s ease, border-color 0.12s ease;
      text-overflow: ellipsis;
    }
    .pf-le-sheet__c-inner:has(.pf-le-sheet__caret) .pf-input--cell {
      padding-right: 28px;
    }
    .pf-input--cell:hover { background: rgba(255, 255, 255, 0.04); }
    .pf-input--cell:focus {
      background: rgba(168, 85, 247, 0.1);
      border-color: rgba(168, 85, 247, 0.55);
      outline: 0;
      box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.15);
    }
    .pf-le-sheet__c--locked .pf-input--cell:focus {
      background: var(--pf-sel-bg);
      border-color: var(--pf-sel-border);
      box-shadow: 0 0 0 2px var(--pf-sel-bg);
    }

    /* Right-aligned icon stack inside each cell. */
    .pf-le-sheet__c-icons {
      position: absolute;
      right: 4px; top: 50%;
      transform: translateY(-50%);
      display: inline-flex; align-items: center; gap: 1px;
    }

    /* ▾ Suggestion-menu trigger. */
    .pf-le-sheet__caret {
      width: 20px; height: 20px;
      border: 0; background: transparent;
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 0.12s, color 0.12s, transform 0.18s;
    }
    .pf-le-sheet__caret:hover { color: var(--text-primary); background: var(--bg-hover); }
    .pf-le-sheet__caret--open { transform: rotate(180deg); color: var(--violet-text); }

    /* 🔒 Lock toggle. Hidden by default; appears on row hover OR when the
       cell is locked. Locked state is unmistakable: solid amber colour on
       top of the amber-tinted cell background. */
    .pf-le-sheet__lock {
      width: 20px; height: 20px;
      border: 0; background: transparent;
      border-radius: 6px;
      color: var(--text-muted);
      opacity: 0;
      cursor: pointer;
      transition: opacity 0.12s, background 0.12s, color 0.12s;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pf-le-sheet__row:hover .pf-le-sheet__lock { opacity: 0.5; }
    .pf-le-sheet__lock:hover {
      opacity: 1;
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-le-sheet__lock:disabled { cursor: not-allowed; opacity: 0; }
    .pf-le-sheet__row:hover .pf-le-sheet__lock:disabled { opacity: 0; }
    .pf-le-sheet__lock--on {
      opacity: 1 !important;
      color: var(--text-secondary) !important;
      background: var(--pf-sel-bg);
    }
    .pf-le-sheet__lock--on:hover {
      background: var(--pf-sel-border);
    }

    /* Locked cell — clear amber theme so admins can't mistake it for a
       hovered/unlocked one. Cell background, input border, and text are
       all amber-tinted. */
    .pf-le-sheet__c--locked {
      background: var(--pf-sel-bg) !important;
    }
    .pf-le-sheet__c--locked .pf-input--cell {
      color: var(--text-secondary);
      font-weight: 600;
      border-color: var(--pf-sel-border);
    }

    /* Suggestion popup — anchored to .pf-le-sheet__c-inner. */
    .pf-le-sheet__menu {
      position: absolute;
      top: calc(100% + 4px); left: 0;
      min-width: 240px;
      max-width: 320px;
      max-height: 280px; overflow: auto;
      padding: 4px;
      border-radius: 10px;
      background: var(--bg-card-solid, #1a1a1f);
      border: 1px solid rgba(168, 85, 247, 0.45);
      box-shadow: 0 14px 32px rgba(0, 0, 0, 0.5);
      z-index: 50;
    }
    .pf-le-sheet__menu button {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%;
      padding: 6px 10px;
      font-size: 12px;
      border: 0; background: transparent;
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      text-align: left;
      transition: background 0.12s, color 0.12s;
    }
    .pf-le-sheet__menu button:hover {
      color: var(--violet-text);
      background: rgba(168, 85, 247, 0.12);
    }
    .pf-le-sheet__menu-lbl { font-weight: 600; color: var(--text-primary); flex: 1; }
    .pf-le-sheet__menu-hint {
      font-variant-numeric: tabular-nums;
      font-size: 10.5px;
      color: var(--text-muted);
    }
    .pf-le-sheet__menu-val {
      font-variant-numeric: tabular-nums;
      font-size: 10.5px;
      color: var(--text-tertiary);
    }

    /* Merged-row cell spans the whole table. */
    .pf-le-sheet__c-merged {
      padding-left: 4px !important;
    }

    /* Inline "Show when" rule on a merged row — shares the badge cell. */
    .pf-le-sheet__c-merged-rule {
      padding-left: 12px !important;
      vertical-align: middle;
    }
    .pf-merged-rule {
      display: inline-flex; align-items: center; gap: 6px;
      flex-wrap: wrap;
    }
    .pf-merged-rule__lbl {
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-merged-rule__param {
      width: 110px;
      padding: 4px 6px !important;
      font-size: 11.5px;
    }
    .pf-merged-rule__op {
      width: 50px;
      padding: 4px 4px !important;
      font-size: 11.5px;
    }
    .pf-merged-rule__val {
      width: 60px;
      padding: 4px 6px !important;
      font-size: 11.5px;
    }
    .pf-merged-rule__add {
      padding: 3px 9px !important;
      font-size: 10.5px !important;
      font-weight: 700 !important;
      letter-spacing: 0.04em;
      border-radius: 9999px;
      border: 1px dashed var(--pf-sel-border) !important;
      color: var(--text-muted) !important;
      opacity: 0.6;
      transition: opacity 0.12s, color 0.12s, border-color 0.12s;
    }
    .pf-le-sheet__row:hover .pf-merged-rule__add {
      opacity: 1;
      color: var(--text-secondary) !important;
      border-color: var(--pf-sel-border) !important;
    }

    /* Actions cell */
    .pf-le-sheet__c-actions {
      width: 38px;
      text-align: center;
    }
    .pf-icon-btn--sm {
      width: 22px; height: 22px;
      font-size: 13px;
      line-height: 1;
    }
    .pf-icon-btn--on {
      background: rgba(168, 85, 247, 0.16);
      color: var(--violet-text) !important;
      border-color: rgba(168, 85, 247, 0.45);
    }

    /* Add-row footer row */
    .pf-le-sheet__add td {
      padding: 6px 10px !important;
      background: rgba(0, 0, 0, 0.12) !important;
      border-bottom: 0 !important;
    }

    /* ───── Docked row-detail panel (conditions + actions) ─────
       Lives BELOW the spreadsheet, not as an in-table row. Keeps the
       table flow clean so admins always see the full row list. */
    .pf-le-detail-card {
      margin-top: 12px;
      border: 1px solid rgba(168, 85, 247, 0.45);
      border-left-width: 4px;
      border-radius: 12px;
      background: rgba(168, 85, 247, 0.04);
      overflow: hidden;
    }
    .pf-le-detail-card--merged {
      border-color: var(--pf-sel-border);
      border-left-color: var(--pf-sel-border);
      background: var(--pf-sel-bg);
    }

    .pf-le-sheet__detail-row td {
      padding: 0 !important;
      background: rgba(168, 85, 247, 0.06) !important;
      border-bottom: 1px solid var(--glass-border) !important;
      border-left: 4px solid rgba(168, 85, 247, 0.7) !important;
    }
    .pf-le-sheet__detail-row--merged td {
      background: var(--pf-sel-bg) !important;
      border-left-color: var(--pf-sel-border) !important;
    }

    /* Banner sits at the top of the detail panel and names the row
       being edited. The thick coloured left edge ties the panel
       visually to the active row. */
    .pf-le-detail-banner {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      background: rgba(168, 85, 247, 0.18);
      border-bottom: 1px solid rgba(168, 85, 247, 0.3);
    }
    .pf-le-detail-banner > .grow { flex: 1; }
    .pf-le-detail-banner__lbl {
      font-size: 12.5px; font-weight: 600;
      color: var(--text-primary);
      max-width: 60ch;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* Merged rows get the amber accent end-to-end (left bar + banner). */
    .pf-le-sheet__row--merged.pf-le-sheet__row--open + .pf-le-sheet__detail-row td,
    .pf-le-detail-banner--merged + * .pf-le-sheet__detail-row td {
      border-left-color: var(--pf-sel-border);
      background: var(--pf-sel-bg) !important;
    }
    .pf-le-detail-banner--merged {
      background: var(--pf-sel-bg);
      border-bottom-color: var(--pf-sel-border);
    }

    .pf-le-detail {
      display: grid;
      grid-template-columns: 1fr 200px;
      gap: 16px;
      padding: 12px 14px;
    }
    @media (max-width: 900px) {
      .pf-le-detail { grid-template-columns: 1fr; }
    }
    .pf-le-detail__col h5 {
      margin: 0 0 8px;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-le-detail__hdr {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 6px;
    }
    .pf-le-detail__hdr h5 { margin: 0; }
    .pf-le-detail__col--narrow { min-width: 0; }
    .pf-le-detail__actions {
      display: flex; flex-direction: column; gap: 4px;
      align-items: stretch;
    }
    .pf-le-detail__actions button {
      text-align: left;
      padding: 6px 10px;
    }

    /* ───── Conditions block (paragraph editor + row detail) ───── */
    .pf-le-cond-block {
      border: 1px dashed var(--glass-border);
      border-radius: 10px;
      padding: 10px;
      background: rgba(0, 0, 0, 0.12);
      margin-top: 12px;
    }
    .pf-le-cond-block__hdr {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px;
    }

    .pf-le-legend {
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px dashed var(--glass-border, rgba(148,163,184,0.3));
      border-radius: 8px;
    }
    .pf-le-legend p {
      margin: 0;
      font-size: 11px; line-height: 1.6;
      color: var(--text-tertiary, #94a3b8);
    }

    .pf-le-tip {
      font-size: 11.5px; line-height: 1.5;
      color: var(--text-muted);
      margin: 0;
    }
    .pf-le-tip--inline { display: inline; margin: 0 4px; }
    .pf-le-tip a { color: var(--violet-text); }

    .pf-le-grid3 {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
    }

    /* ───── Row badges ───── */
    .pf-row__badge {
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(168, 85, 247, 0.14);
      color: var(--violet-text);
    }
    .pf-row__badge--merged { background: var(--pf-sel-bg); color: var(--text-secondary); }

    /* ───── Conditions ───── */
    .pf-cond {
      display: flex; flex-direction: column; gap: 6px;
      padding: 8px;
      margin-bottom: 6px;
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      background: var(--glass-bg);
    }
    .pf-cond__head, .pf-cond__then {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    .pf-cond__head > .grow, .pf-cond__then > .grow { flex: 1; }
    .pf-cond__kw {
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
      min-width: 28px;
    }

    /* Click-to-toggle IF↔ELSE on each condition's head. Looks like a
       chip but is keyboard-focusable. */
    .pf-cond__mode {
      padding: 3px 10px;
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.16);
      border: 1px solid rgba(168, 85, 247, 0.4);
      color: var(--violet-text);
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
      min-width: 56px;
      text-align: center;
    }
    .pf-cond__mode:hover {
      background: rgba(168, 85, 247, 0.28);
      border-color: rgba(168, 85, 247, 0.6);
    }
    /* ELSE branches read amber so admins can scan IF vs ELSE quickly. */
    .pf-cond--else .pf-cond__mode {
      background: var(--pf-sel-bg);
      border-color: var(--pf-sel-border);
      color: var(--text-secondary);
    }
    .pf-cond--else .pf-cond__mode:hover {
      background: var(--pf-sel-border);
      border-color: var(--pf-sel-border);
    }
    .pf-cond--else {
      border-left: 3px solid var(--pf-sel-border);
    }
    /* Highlight an IF branch whose predicate has no parameter — that
       condition will never match, which usually means admin forgot to
       fill it in. */
    .pf-cond--unset {
      border-left: 3px solid rgba(244, 63, 94, 0.5);
    }
    .pf-cond__warn {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.04em;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(244, 63, 94, 0.14);
      border: 1px solid rgba(244, 63, 94, 0.4);
      color: var(--rose-text);
    }

    /* Cell-override list inside a condition. */
    .pf-cond__cells {
      display: flex; flex-direction: column; gap: 5px;
      margin-top: 4px;
      padding: 6px 8px;
      border: 1px dashed rgba(168, 85, 247, 0.25);
      border-radius: 8px;
      background: rgba(168, 85, 247, 0.04);
    }
    .pf-cond__cells-hdr {
      display: flex; align-items: center; justify-content: space-between;
    }
    .pf-cond__cell-edit {
      display: flex; align-items: center; gap: 6px;
    }
    .pf-cond__cell-edit > select { width: 140px; }
    .pf-cond__cell-edit > .grow { flex: 1; }

    .pf-color-chip {
      width: 18px; height: 18px;
      border-radius: 9999px;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;
    }
    .pf-color-chip--on { border-color: var(--text-primary); }
    .pf-bold-toggle {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11.5px;
      color: var(--text-secondary);
    }

    /* ───── Inputs ───── */
    .pf-input--inline-label { padding: 6px 10px; font-size: 13px; }
    .pf-input--compact { padding: 5px 8px; font-size: 12px; }
    .pf-input--mono { font-variant-numeric: tabular-nums; font-size: 11px; }
    .pf-input--ta { font-family: inherit; resize: vertical; min-height: 64px; }

    .pf-label-mini {
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
      display: block;
    }

    /* ───── Icon + link buttons ───── */
    .pf-icon-btn {
      width: 26px; height: 26px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      color: var(--text-muted);
      cursor: pointer;
    }
    .pf-icon-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: rgba(168, 85, 247, 0.4);
    }
    .pf-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pf-icon-btn--danger:hover:not(:disabled) {
      color: var(--red-text);
      border-color: rgba(244, 63, 94, 0.5);
    }

    .pf-link-btn {
      background: transparent; border: 0;
      padding: 5px 10px;
      font-size: 12px; font-weight: 600;
      color: var(--violet-text);
      cursor: pointer;
      border-radius: 6px;
    }
    .pf-link-btn:hover { background: rgba(168, 85, 247, 0.1); }
    .pf-link-btn--danger { color: var(--red-text); }
    .pf-link-btn--danger:hover { background: rgba(244, 63, 94, 0.12); }
    .pf-link-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* ───── Chart zone editor ───── */
    .pf-zones { margin-top: 4px; }
    .pf-zone {
      padding: 8px;
      margin-bottom: 8px;
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.18);
    }
    .pf-zone__row {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    .pf-zone__row > .grow { flex: 1; }
    .pf-zone__bar {
      position: relative; height: 8px;
      margin-top: 6px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 4px;
      overflow: hidden;
    }
    .pf-zone__bar-band {
      position: absolute; top: 0; bottom: 0;
    }

    /* ───── Live preview drawer ───── */
    .pf-le-preview {
      display: flex; flex-direction: column; gap: 12px;
      padding: 14px;
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      background: rgba(0, 0, 0, 0.22);
      position: sticky; top: 12px;
      max-height: calc(100dvh - 24px);
      overflow: auto;
    }
    .pf-le-preview__hdr {
      display: flex; align-items: center; gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px dashed var(--glass-border);
    }
    .pf-le-preview__hdr h4 {
      margin: 0; font-size: 12.5px; font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--text-primary);
    }
    .pf-le-preview__hdr > .grow { flex: 1; }
    .pf-le-preview__samples { display: flex; flex-direction: column; gap: 6px; }
    .pf-le-preview__sample-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
    }
    .pf-sample-input {
      display: flex; flex-direction: column; gap: 2px;
    }
    .pf-sample-input span {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
    }

    .pf-preview-render {
      padding: 14px;
      background: #ffffff;
      color: #0f172a;
      border-radius: 10px;
    }
    .pf-pv-label {
      margin: 0 0 6px; font-size: 11px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: #475569;
    }
    .pf-pv-section { margin-bottom: 14px; }
    .pf-pv-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .pf-pv-table th {
      background: #1B3A6B; color: #fff;
      padding: 6px 8px;
      text-align: left;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .pf-pv-row td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
    .pf-pv-row:nth-child(even) td { background: #F7F9FC; }
    .pf-pv-row--merged td {
      background: #f1f5f9; font-style: italic; color: #475569;
      text-align: center; padding: 8px;
    }
    .pf-pv-para { margin: 0; font-size: 12px; line-height: 1.5; color: #1e293b; white-space: pre-wrap; }
    .pf-pv-empty { font-size: 12px; color: #94a3b8; font-style: italic; margin: 0; padding: 6px 0; }
    .pf-pv-images { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
    .pf-pv-images img { width: 100%; border-radius: 6px; border: 1px solid #e2e8f0; }

    .pf-pv-chart { display: flex; flex-direction: column; gap: 4px; }
    .pf-pv-chart__bar {
      position: relative; height: 14px;
      background: #f1f5f9; border-radius: 7px; overflow: hidden;
    }
    .pf-pv-chart__zone { position: absolute; top: 0; bottom: 0; }
    .pf-pv-chart__marker {
      position: absolute; top: -3px; bottom: -3px;
      width: 3px; background: #0f172a;
      border-radius: 2px;
      transform: translateX(-1.5px);
    }
    .pf-pv-chart__axis {
      display: flex; justify-content: space-between;
      font-size: 10px; color: #64748b;
      font-variant-numeric: tabular-nums;
    }

    /* Generic flex helper used by toolbar / sticky-spacer spans. */
    .grow { flex: 1; }
  
    @media (max-width: 640px) {
      .pf-le-grid3 { grid-template-columns: 1fr; }
      /* Sticky preview pins over the editor on a short viewport — flow it. */
      [class*='preview'][style*='sticky'], .pf-le-preview { position: static; }
    }
`]
})
export class TestLayoutEditorComponent {
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  /** Test id (after the parent's saveTest creates the row). When empty, the
   *  component shows the "save the test first" prompt. */
  readonly testId = input<string>('');
  /** List of parameter machine names — feeds the parameter dropdowns + the
   *  preview panel's sample-value inputs. Owner is the parent test editor
   *  which already maintains the field list. */
  readonly parameters = input<string[]>([]);
  /** Test's department id — drives the dept-column lookup so the row
   *  editor can surface the configured columns instead of asking admin
   *  to type column names blindly. */
  readonly departmentId = input<string>('');
  /** True when the edited test is a culture (microFormat culture_sensitivity):
   *  unlocks the culture-only section palette. Every other test keeps the
   *  standard palette untouched. */
  readonly culture = input<boolean>(false);
  readonly cultureSourceOptions: PfSelectOption[] = [
    { value: 'specimen', label: 'Specimen' },
    { value: 'gramStain', label: 'Gram stain (bench gram stage)' },
    { value: 'growth', label: 'Growth check' },
    { value: 'id', label: 'Organism identification' },
    { value: 'colonyCount', label: 'Colony count' },
    { value: 'organisms', label: 'Organism(s) isolated' },
    { value: 'resistancePattern', label: 'Resistance pattern' },
    { value: 'intrinsicResistance', label: 'Intrinsic resistance' },
    { value: 'clinicalNotes', label: 'Clinical notes' },
    { value: 'infectionControlAdvice', label: 'Infection control advice' },
    { value: 'note', label: 'Bench summary note' },
  ];
  asCultureLine(sec: ReportSection): { source: string } {
    return sec as unknown as { source: string };
  }
  /** One-tap starter for culture tests: seeds the classic C&S arrangement
   *  (the reference report) as editable sections — rearrange from there. */
  seedCultureLayout() {
    const mk = (source: string, label: string, order: number): ReportSection =>
      ({ id: newId(), type: 'culture_line', order, label, source, conditions: [] } as ReportSection);
    const seeded: ReportSection[] = [
      mk('specimen', 'Specimen', 1),
      mk('gramStain', 'Gram stain', 2),
      mk('growth', 'Growth', 3),
      mk('colonyCount', 'Colony count', 4),
      mk('organisms', 'Organism(s) isolated', 5),
      { id: newId(), type: 'culture_ast', order: 6, conditions: [] } as ReportSection,
      mk('resistancePattern', 'Resistance pattern', 7),
      mk('intrinsicResistance', 'Intrinsic resistance', 8),
      mk('clinicalNotes', 'Clinical notes', 9),
      mk('infectionControlAdvice', 'Infection control advice', 10),
    ];
    this.mutateSections(() => seeded);
  }

  /** Department columns the test inherits — fetched whenever departmentId
   *  changes. Empty array when the dept hasn't been configured yet (the
   *  engine falls back to the canonical 5-col default in that case). */
  protected readonly deptColumns = signal<ReportColumn[]>([]);
  /** Quick-pick options for cell-key inputs, derived from deptColumns. */
  protected readonly columnNames = computed(() => this.deptColumns().map(c => c.name));

  protected readonly sections = signal<ReportSection[]>([]);

  /** Wrap a sections-mutating closure so the autosave effect sees the
   *  edit as dirty (loader-set values stay clean). Every method that
   *  modifies layout sections should route through this. */
  private mutateSections(fn: (arr: ReportSection[]) => ReportSection[]) {
    this._dirty = true;
    this.sections.update(fn);
  }
  protected readonly version = signal(0);
  protected readonly configured = signal(false);
  protected readonly saving = signal(false);

  protected readonly previewOpen = signal(false);
  /** Bumped to re-render the embedded PDF preview drawer. */
  protected readonly previewToken = signal(0);
  protected readonly sampleValues = signal<Record<string, unknown>>({});

  // ── Master-detail UI state ────────────────────────────────
  // The editor is a 2-pane layout: left rail lists sections, right pane edits
  // the selected one. We track selection by id (not index) so reordering and
  // deletes don't confuse the active selection. Row expansion is single-open
  // per pane — a row's body shows in a tabbed view (cells / locks / conds).
  protected readonly selectedSectionId = signal<string | null>(null);
  protected readonly selectedSection = computed<ReportSection | null>(() => {
    const id = this.selectedSectionId();
    return id ? this.sections().find(s => s.id === id) ?? null : null;
  });
  protected readonly selectedSectionIndex = computed(() => {
    const id = this.selectedSectionId();
    return id ? this.sections().findIndex(s => s.id === id) : -1;
  });
  protected readonly expandedRowId = signal<string | null>(null);
  protected readonly rowTab = signal<'cells' | 'conditions' | 'locks'>('cells');

  /** Resolves the currently-expanded row (the docked detail panel
   *  reads this) — looks up by id inside the active grid section. */
  protected readonly expandedRow = computed<{ row: GridRow; ri: number } | null>(() => {
    const id = this.expandedRowId();
    const sec = this.selectedSection();
    if (!id || !sec || sec.type !== 'grid') return null;
    const rows = (sec as GridSection).rows;
    const ri = rows.findIndex(r => r.id === id);
    return ri >= 0 ? { row: rows[ri], ri } : null;
  });

  /** Auto-select the first section once data lands (or after add/remove
   *  removed the active one). Keeps the right pane from sitting empty
   *  whenever the section list is non-empty. */
  private readonly _selectionGuard = effect(() => {
    const list = this.sections();
    const cur = this.selectedSectionId();
    if (list.length === 0) {
      if (cur !== null) this.selectedSectionId.set(null);
      return;
    }
    if (!cur || !list.some(s => s.id === cur)) {
      this.selectedSectionId.set(list[0].id);
    }
  });

  selectSection(id: string) {
    if (this.selectedSectionId() === id) return;
    this.selectedSectionId.set(id);
    this.expandedRowId.set(null);
    this.rowTab.set('cells');
  }

  toggleRow(id: string) {
    const cur = this.expandedRowId();
    this.expandedRowId.set(cur === id ? null : id);
    this.rowTab.set('cells');
  }

  setRowTab(t: 'cells' | 'conditions' | 'locks') { this.rowTab.set(t); }

  /** Counts surfaced as inline badges in the row header so admins can scan
   *  at-a-glance which rows have overrides / conditions / locks without
   *  expanding each one. */
  cellCount(r: GridRow): number {
    return r.row_merge ? 0 : Object.keys((r as GridRowParameter).cells ?? {}).length;
  }
  condCount(r: GridRow): number {
    return (r.conditions ?? []).length;
  }
  rowSummary(r: GridRow): string {
    if (r.row_merge) {
      const tpl = (r as GridRowMerged).merge_content?.template ?? '';
      return tpl ? tpl.slice(0, 40) + (tpl.length > 40 ? '…' : '') : 'Merged note';
    }
    const p = (r as GridRowParameter).parameter_name;
    return p || '— pick parameter —';
  }

  /** Add a section and immediately select it so admin lands on the editor.
   *  The section list rail also auto-scrolls via the `:focus` selector on
   *  the freshly-active button. */
  addSectionAndSelect(t: ReportSectionType) {
    this.addSection(t);
    const list = this.sections();
    if (list.length > 0) this.selectSection(list[list.length - 1].id);
  }

  // ── Spreadsheet helpers ───────────────────────────────────
  // The grid editor renders as a real table: columns are the dept's columns
  // (or the canonical default 5), rows are the section's parameter rows,
  // each cell is an inline-editable input. Locks live on the cells too —
  // 🔒 toggle per cell flips between "template (editable)" and "locked
  // (pinned value)" states. Saves the lock map to the server on blur.

  /** Dept columns to render in the spreadsheet — falls back to the
   *  canonical default 5-col structure when the dept hasn't been
   *  configured yet, so the engine and editor agree on what's there. */
  protected readonly deptColumnsForRender = computed<ReportColumn[]>(() => {
    const cols = this.deptColumns();
    return cols.length > 0 ? cols : DEFAULT_REPORT_COLUMNS;
  });

  /** + Add section dropdown open state — closed when the user picks one
   *  or clicks anywhere outside (toggle is on the trigger button). */
  protected readonly addPickerOpen = signal(false);
  toggleAddPicker() { this.addPickerOpen.update(v => !v); }
  addAndCloseMenu(t: ReportSectionType) {
    this.addSectionAndSelect(t);
    this.addPickerOpen.set(false);
  }

  /** True when this (parameter, column) pair has a lock entry. */
  hasLock(paramName: string | undefined, colName: string): boolean {
    if (!paramName) return false;
    const m = this._locks()[paramName];
    return !!(m && m[colName]);
  }

  /** Display value for a cell — strictly the per-row cells map. The
   *  legacy lock map is migrated into cells on load (see
   *  migrateLocksToCells), so this reads a single source of truth and
   *  cannot bleed across rows. */
  cellOrLockValue(r: GridRow, colName: string): string {
    if (r.row_merge) return '';
    return ((r as GridRowParameter).cells ?? {})[colName] ?? '';
  }

  /** Edit handler — ALWAYS writes to the row's cells map (per-row
   *  template). If the cell was previously locked (locks are keyed per
   *  parameter, not per row), this also drops the lock so typing one
   *  cell never changes the value of any other row. The lock backing
   *  data is migrated into the row's cells transparently. */
  setCellOrLock(sectionIdx: number, rowIdx: number, colName: string, value: string) {
    const sec = this.sections()[sectionIdx];
    if (!sec || sec.type !== 'grid') return;
    const r = (sec as GridSection).rows[rowIdx];
    if (!r || r.row_merge) return;
    const p = (r as GridRowParameter).parameter_name;

    // Auto-migrate: if there was a parameter-level lock for this cell,
    // drop it. Otherwise typing here would update the lock map and
    // bleed into every other row that shares the parameter.
    if (p && this.hasLock(p, colName)) {
      this.removeLock(p, colName);
      void this.saveLocks(p);
    }
    this.setCellValue(sectionIdx, rowIdx, colName, value);
  }

  /** Toggle a cell's lock state. On lock: seeds the lock value with the
   *  current cell template (so admin sees their existing text and can
   *  refine). On unlock: drops the lock entirely. Saves immediately via
   *  the locks API so the change persists without a Save click. */
  toggleCellLock(paramName: string, colName: string, currentTemplate: string) {
    if (!paramName) return;
    if (this.hasLock(paramName, colName)) {
      this.removeLock(paramName, colName);
    } else {
      // Seed lock value with whatever was in the cell template.
      this._locks.update(all => {
        const next = { ...all };
        const inner = { ...(next[paramName] ?? {}) };
        inner[colName] = { locked: true, value: currentTemplate };
        next[paramName] = inner;
        return next;
      });
    }
    // Fire-and-forget save — toast on failure inside saveLocks.
    void this.saveLocks(paramName);
  }

  /** Save the parameter's locks (used by cell input blur to persist
   *  edits without making admin click a Save Locks button). */
  commitLock(paramName: string) {
    if (!paramName || !(paramName in this._locks())) return;
    void this.saveLocks(paramName);
  }

  /** Placeholder text shown inside an unlocked cell input — uses the
   *  column's semantic type to suggest what belongs there. */
  cellPlaceholder(col: ReportColumn): string {
    switch (col.type) {
      case 'result': return this.phLabel;
      case 'unit':   return col.label.toLowerCase();
      case 'range':  return '12 – 16';
      case 'flag':   return '— computed —';
      default:       return col.label;
    }
  }

  // Template-suggestion menus surfaced as a `▾` button on certain cell
  // types. Click → menu of suggestions → click an option → it writes to
  // the cell. Saves typing the placeholder syntax exactly. Currently
  // open menu is tracked by a single signal so only one menu is up at
  // a time across the whole sheet.
  protected readonly _suggestOpen = signal<string | null>(null);
  isSuggestOpen(rowId: string, colName: string): boolean {
    return this._suggestOpen() === `${rowId}|${colName}`;
  }
  toggleSuggest(rowId: string, colName: string) {
    const key = `${rowId}|${colName}`;
    this._suggestOpen.update(cur => cur === key ? null : key);
  }
  closeSuggest() { this._suggestOpen.set(null); }

  /** Suggestions for a (column, row) — readable parameter names rather
   *  than placeholder syntax. The label is what admin sees in the menu;
   *  `value` is what gets stored (the engine still resolves `{{name}}`
   *  templates). The cell display strips the `{{ }}` wrapper too, so
   *  the spreadsheet stays readable end-to-end. */
  cellSuggestions(col: ReportColumn, r: GridRow): Array<{ label: string; value: string; hint?: string }> {
    if (r.row_merge) return [];
    const p = (r as GridRowParameter).parameter_name;
    switch (col.type) {
      case 'result':
        return [
          ...(p ? [{ label: p, value: `{{${p}}}`, hint: 'this row\'s result' }] : []),
          ...this.parameters()
            .filter(other => other !== p)
            .map(other => ({ label: other, value: `{{${other}}}`, hint: `pull from ${other}` })),
        ];
      case 'unit':
        return [
          ...(p ? [{ label: `${p} unit`, value: `{{${p}_unit}}`, hint: 'auto from parameter' }] : []),
          { label: 'g/dL',   value: 'g/dL' },
          { label: 'mg/dL',  value: 'mg/dL' },
          { label: '/µL',    value: '/µL' },
          { label: 'IU/mL',  value: 'IU/mL' },
          { label: '%',      value: '%' },
          { label: 'ng/mL',  value: 'ng/mL' },
          { label: 'mmol/L', value: 'mmol/L' },
        ];
      case 'range':
        return [
          ...(p ? [{ label: `${p} range`, value: `{{${p}_range}}`, hint: 'auto from parameter' }] : []),
          { label: 'Negative', value: 'Negative' },
          { label: '< 5',      value: '< 5' },
          { label: '12 – 16',  value: '12 – 16' },
        ];
      default:
        return [];
    }
  }

  /** Readable display value for a cell. A single placeholder like
   *  `{{glucose}}` is rendered as just `glucose`; everything else
   *  passes through. This keeps the spreadsheet visually clean while
   *  preserving the template syntax the engine needs at resolve time. */
  displayCellValue(r: GridRow, colName: string): string {
    const raw = this.cellOrLockValue(r, colName);
    const m = /^\s*\{\{\s*([^}\s]+)\s*\}\}\s*$/.exec(raw);
    return m ? m[1] : raw;
  }

  /** Input handler that mirrors the readable display — if the admin
   *  types a string that exactly matches a known parameter name, we
   *  store it as `{{name}}` so the engine resolves it. Anything else
   *  is stored as literal text. The displayCellValue regex hides the
   *  `{{ }}` again on the way back out. */
  setCellReadable(sectionIdx: number, rowIdx: number, colName: string, typed: string) {
    const trimmed = typed.trim();
    const isParam = trimmed.length > 0 && this.parameters().includes(trimmed);
    const stored = isParam ? `{{${trimmed}}}` : typed;
    this.setCellOrLock(sectionIdx, rowIdx, colName, stored);
  }

  // ── Row condition: cell overrides + visibility ─────────────
  // The engine already supports condition.then.cells (override per
  // column) and condition.then.show (true=force show, false=hide).
  // These helpers wire those into the row condition editor so admins
  // can build flows like "if glucose > 10 → set description to
  // 'Repeat test'" or "show this merged note row only when result > X".

  private getCond(sectionIdx: number, rowIdx: number, condIdx: number): ConditionRule | undefined {
    const sec = this.sections()[sectionIdx];
    if (!sec || sec.type !== 'grid') return undefined;
    const r = (sec as GridSection).rows[rowIdx];
    return (r?.conditions ?? [])[condIdx];
  }

  /** Iterable view of `condition.then.cells`. Used by the conditions UI
   *  so admins can edit each (column, value) pair as a row. */
  condCellEntries(c: ConditionRule): Array<[string, string]> {
    return Object.entries(c.then.cells ?? {});
  }

  /** Add an empty cell-override entry. Defaults to the first dept column
   *  not already overridden, falling back to `description`. */
  addCondCell(sectionIdx: number, rowIdx: number, condIdx: number) {
    const c = this.getCond(sectionIdx, rowIdx, condIdx);
    if (!c) return;
    const cells = { ...(c.then.cells ?? {}) };
    const cols = this.deptColumnsForRender();
    const firstFree = cols.find(col => !(col.name in cells))?.name
      ?? `cell_${Object.keys(cells).length + 1}`;
    cells[firstFree] = '';
    this.patchCond(sectionIdx, rowIdx, condIdx, { then: { cells } });
  }

  setCondCellKey(sectionIdx: number, rowIdx: number, condIdx: number, oldKey: string, newKey: string) {
    if (!newKey || newKey === oldKey) return;
    const c = this.getCond(sectionIdx, rowIdx, condIdx);
    if (!c || !((c.then.cells ?? {})[oldKey] !== undefined)) return;
    const cells = { ...(c.then.cells ?? {}) };
    cells[newKey] = cells[oldKey];
    delete cells[oldKey];
    this.patchCond(sectionIdx, rowIdx, condIdx, { then: { cells } });
  }

  setCondCellValue(sectionIdx: number, rowIdx: number, condIdx: number, key: string, value: string) {
    const c = this.getCond(sectionIdx, rowIdx, condIdx);
    if (!c) return;
    const cells = { ...(c.then.cells ?? {}), [key]: value };
    this.patchCond(sectionIdx, rowIdx, condIdx, { then: { cells } });
  }

  removeCondCell(sectionIdx: number, rowIdx: number, condIdx: number, key: string) {
    const c = this.getCond(sectionIdx, rowIdx, condIdx);
    if (!c) return;
    const cells = { ...(c.then.cells ?? {}) };
    delete cells[key];
    this.patchCond(sectionIdx, rowIdx, condIdx, { then: { cells } });
  }

  /** Visibility radios: 'default' = no opinion (signal undefined),
   *  'show' = force show, 'hide' = hide row when this branch matches. */
  setCondVisibility(sectionIdx: number, rowIdx: number, condIdx: number, mode: 'default' | 'show' | 'hide') {
    const showVal = mode === 'default' ? undefined : (mode === 'show');
    this.patchCond(sectionIdx, rowIdx, condIdx, { then: { show: showVal } });
  }

  /** Merged-row note override — written to condition.then.merge_content,
   *  which the engine reads to swap the row's note when this branch
   *  matches. Empty string clears the override. */
  setCondMergeContent(sectionIdx: number, rowIdx: number, condIdx: number, value: string) {
    this.patchCond(sectionIdx, rowIdx, condIdx, { then: { merge_content: value } });
  }

  // ── Inline merged-row "Show when" rule ─────────────────────
  // The merged row carries an inline `Show when [param] [op] [value]`
  // editor next to its badge. Editing parts auto-maintains the
  // canonical show-only-when scaffold (IF → show:true, ELSE → hide).
  // Picking "— always —" clears the conditions so the row always shows.

  /** Read one part of the row's first IF predicate. Defaults provided
   *  for empty rows so the inline editor renders sensibly. */
  getMergedRulePart(r: GridRow, part: 'parameter' | 'operator' | 'value'): string | number {
    const ifCond = (r.conditions ?? []).find(c => !c.else);
    const ifObj = ifCond?.if as Record<string, unknown> | undefined;
    if (!ifObj) {
      return part === 'value' ? 0 : (part === 'operator' ? '=' : '');
    }
    const v = ifObj[part];
    if (part === 'value') return typeof v === 'number' ? v : (v != null ? Number(v) || 0 : 0);
    return (typeof v === 'string' ? v : '') || (part === 'operator' ? '=' : '');
  }

  /** Update one part of the row's IF predicate. If the row has no
   *  conditions yet, seed the show-only-when pair first. If the
   *  parameter is set to '' (— always —), drop ALL conditions so the
   *  row always shows. */
  setMergedRulePart(sectionIdx: number, rowIdx: number, part: 'parameter' | 'operator' | 'value', value: string | number) {
    if (part === 'parameter' && (value === '' || value == null)) {
      this.patchRowConds(sectionIdx, rowIdx, _ => []);
      return;
    }
    this.patchRowConds(sectionIdx, rowIdx, list => {
      let next = [...list];
      let ifIdx = next.findIndex(c => !c.else);
      if (ifIdx < 0) {
        next = [
          { if: { parameter: '', operator: '=', value: 0 }, then: { show: true } },
          { else: true, then: { show: false } }
        ];
        ifIdx = 0;
      }
      const cur = next[ifIdx];
      const newV = part === 'value'
        ? (Number.isFinite(+value) ? +value : value)
        : value;
      next[ifIdx] = {
        ...cur,
        if: { ...(cur.if ?? {}), [part]: newV }
      };
      return next;
    });
  }

  /** Convenience: append two conditions to a (typically merged) row that
   *  together implement "show this row only when …". The first branch
   *  forces show on match; the second is an `else` that hides otherwise.
   *  Pre-seeds the IF with the first available parameter and `=` as the
   *  operator so the most common case ("show when glucose is X") is one
   *  number-edit away. Admin can still change any of it. */
  addShowOnlyWhen(sectionIdx: number, rowIdx: number) {
    const firstParam = this.parameters()[0] ?? '';
    this.patchRowCondsPublic(sectionIdx, rowIdx, conds => [
      ...conds,
      { if: { parameter: firstParam, operator: '=', value: 0 }, then: { show: true } },
      { else: true, then: { show: false } }
    ]);
  }

  // patchRowConds is private; re-export under a public name so the
  // helper above can call it. (Same body as patchRowConds.)
  private patchRowCondsPublic(sectionIdx: number, rowIdx: number, fn: (c: ConditionRule[]) => ConditionRule[]) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      if (!sec || sec.type !== 'grid') return arr;
      const rows = [...sec.rows];
      const r = rows[rowIdx];
      if (!r) return arr;
      rows[rowIdx] = { ...r, conditions: fn(r.conditions ?? []) } as GridRow;
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  /** Click-to-insert handler — ALWAYS writes the suggestion's value into
   *  the row's cells map (per-row template). If the cell is locked, we
   *  unlock it first; locks are keyed by (parameter, column) and would
   *  otherwise bleed across any other rows sharing the same parameter
   *  (or empty parameter). One pick → one row affected, period. */
  pickSuggestion(sectionIdx: number, rowIdx: number, colName: string, value: string) {
    const sec = this.sections()[sectionIdx] as GridSection | undefined;
    const r = sec?.rows?.[rowIdx];
    if (!r || r.row_merge) {
      this.closeSuggest();
      return;
    }
    const p = (r as GridRowParameter).parameter_name;

    // Drop the lock first so the per-row template visibly takes effect.
    // (We don't try to update the lock value because doing so would
    // propagate to every other row that shares this parameter name.)
    if (p && this.hasLock(p, colName)) {
      this.removeLock(p, colName);
      void this.saveLocks(p);
    }

    this.setCellValue(sectionIdx, rowIdx, colName, value);
    this.closeSuggest();
  }

  /** Options array for a parameter when it's a select/radio type — used
   *  by the conditions UI so the value chooser becomes a dropdown of the
   *  parameter's actual options instead of a free-text/number input. */
  paramOptions = input<Record<string, string[]>>({});

  /** Add a merged note row pre-wired with the Show-only-when IF/ELSE
   *  pair, then expand its detail panel. Each click of "+ Conditional
   *  note" gives admin a row that's hidden by default; they just type
   *  the note and tweak the predicate. */
  addConditionalNote(sectionIdx: number) {
    this.addRow(sectionIdx, true);
    const list = this.sections();
    const sec = list[sectionIdx];
    if (!sec || sec.type !== 'grid') return;
    const lastIdx = (sec as GridSection).rows.length - 1;
    if (lastIdx < 0) return;
    const last = (sec as GridSection).rows[lastIdx];
    if (!last) return;
    this.addShowOnlyWhen(sectionIdx, lastIdx);
    this.expandedRowId.set(last.id);
    this.rowTab.set('cells');
  }

  /** Add a row and immediately expand it — same UX rationale as section adds. */
  addRowAndExpand(sectionIdx: number, merged: boolean) {
    this.addRow(sectionIdx, merged);
    const list = this.sections();
    const sec = list[sectionIdx];
    if (sec && sec.type === 'grid') {
      const last = (sec as GridSection).rows[(sec as GridSection).rows.length - 1];
      if (last) {
        this.expandedRowId.set(last.id);
        this.rowTab.set('cells');
      }
    }
  }

  /** Move/delete that operate on the *currently selected* section — used by
   *  the right-pane header so admins don't have to scrub back to the rail. */
  moveSelected(dir: -1 | 1) {
    const i = this.selectedSectionIndex();
    if (i < 0) return;
    this.moveSection(i, dir);
  }
  removeSelected() {
    const i = this.selectedSectionIndex();
    if (i < 0) return;
    this.removeSection(i);
  }

  protected readonly operators: PfSelectOption[] = [...OPERATORS];
  protected readonly colors = COLOR_TOKENS;

  /** Convert a string array (parameter names) to PfSelectOption[] for pf-select. */
  toOpts(strs: readonly string[], emptyLabel?: string): PfSelectOption[] {
    const base: PfSelectOption[] = emptyLabel !== undefined
      ? [{ value: '', label: emptyLabel }] : [];
    return [...base, ...strs.map(s => ({ value: s, label: s }))];
  }

  /** Convert dept columns to PfSelectOption[] (name → label). */
  colOpts(): PfSelectOption[] {
    return this.deptColumnsForRender().map(c => ({ value: c.name, label: c.label ?? c.name }));
  }
  /** Literal label for `{{paramName}}` placeholders — kept off-template so
   *  the Angular parser doesn't try to interpolate the example. */
  protected readonly phLabel = '{{paramName}}';
  protected readonly phUnitLabel = '{{paramName_unit}}';
  protected readonly phRangeLabel = '{{paramName_range}}';
  protected readonly mergedTplPlaceholder = 'Note text — supports {{placeholders}}';
  protected readonly cellValuePlaceholder = 'value (use {{paramName}} to inject result)';
  protected readonly paragraphPlaceholder = 'The result is {{paramName}} {{paramName_unit}}…';

  /** Tracks whether `sections` reflects an unsaved local edit. The
   *  loader resets this to false after pulling fresh data; any
   *  subsequent user mutation flips it true and the autosave effect
   *  picks it up. */
  private _dirty = false;
  private _autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reload sections + locks whenever the parent rebinds testId. After
   *  both land, run a one-shot migration: parameter-level locks (which
   *  bleed across any rows sharing a parameter) get folded into the
   *  per-row cells map and deleted from the server. The spreadsheet
   *  thereafter reads from per-row cells only, so each text box is
   *  truly independent. */
  private readonly _loader = effect(() => {
    const id = this.testId();
    if (!id) {
      this.sections.set([]);
      this._locks.set({});
      return;
    }
    Promise.all([
      this.layout.getTestLayout(id).catch(() => null),
      this.layout.listLocks(id).catch(() => [] as Array<{ parameterName: string; columnLocks: Record<string, ColumnLock> }>)
    ]).then(([res, lockRows]) => {
      if (res) {
        this.sections.set([...(res.sections ?? [])].sort((a, b) => a.order - b.order));
        this.version.set(res.version);
        this.configured.set(res.configured);
      }
      const map: Record<string, Record<string, ColumnLock>> = {};
      for (const r of lockRows ?? []) map[r.parameterName] = { ...r.columnLocks };
      this._locks.set(map);

      this._dirty = false;
      if (Object.keys(map).length > 0) {
        void this.migrateLocksToCells();
      }
    });
  });

  /** Autosave: any change to `sections` (after the initial load) gets
   *  pushed to the server after a short debounce. Ensures the engine
   *  always sees the latest layout when a report is generated, without
   *  forcing admin to remember to click "Save layout". */
  private readonly _autosave = effect(() => {
    // Subscribe to sections updates.
    const list = this.sections();
    const id = this.testId();
    if (!id || !this._dirty) return;
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(async () => {
      try {
        await this.layout.saveTestLayout(id, this.stripDerivedCells(this.reindex(list)));
        this.configured.set(true);
        this._dirty = false;
      } catch {
        // Silent on autosave failures — admin still has the explicit
        // Save layout button to surface errors.
      }
    }, 600);
  });

  /** One-shot migration: take the loaded `_locks` map (parameter-keyed)
   *  and merge each lock value into the matching row's cells map. Then
   *  delete every lock from the server and clear local state. After
   *  this runs the engine sees the same values via per-row cells and
   *  the editor has no more parameter-level coupling. */
  private async migrateLocksToCells(): Promise<void> {
    const id = this.testId();
    if (!id) return;
    const locksMap = this._locks();
    const paramNames = Object.keys(locksMap);
    if (paramNames.length === 0) return;

    // Merge lock values into matching rows' cells.
    this.mutateSections(arr => arr.map(s => {
      if (s.type !== 'grid') return s;
      const grid = s as GridSection;
      return {
        ...grid,
        rows: grid.rows.map(r => {
          if (r.row_merge) return r;
          const pr = r as GridRowParameter;
          const paramLocks = pr.parameter_name ? locksMap[pr.parameter_name] : undefined;
          if (!paramLocks) return r;
          const newCells = { ...(pr.cells ?? {}) };
          for (const colName of Object.keys(paramLocks)) {
            const lock = paramLocks[colName];
            if (lock?.locked && lock.value != null && lock.value !== '') {
              // Don't overwrite a per-row override that was already typed.
              if (!(colName in newCells) || newCells[colName] === '') {
                newCells[colName] = lock.value;
              }
            }
          }
          return { ...pr, cells: newCells };
        })
      } as ReportSection;
    }));

    // Persist the migrated layout, then delete each parameter lock from
    // the server. Failures are swallowed — worst case the migration
    // re-runs on next load, which is idempotent.
    try {
      await this.layout.saveTestLayout(id, this.stripDerivedCells(this.reindex(this.sections())));
      for (const param of paramNames) {
        try { await this.layout.deleteLock(id, param); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    this._locks.set({});
  }

  /** Fetch the test's department columns whenever departmentId binds.
   *  These drive the row editor's "available columns" hints + auto-fill
   *  cell keys when the admin clicks a column chip.
   *
   *  IMPORTANT: cells are keyed by `col.name`. If two dept columns
   *  share a name (or both have an empty name) the spreadsheet inputs
   *  all bind to the same cells[name] entry and "type once, see it in
   *  every cell" follows. We sanitize names on load — derive missing
   *  ones from labels and suffix duplicates with `_2`, `_3`, etc. The
   *  edited names stay local; the canonical fix is to re-save the
   *  dept's column structure via the Report Columns admin. */
  private readonly _deptLoader = effect(() => {
    const deptId = this.departmentId();
    if (!deptId) {
      this.deptColumns.set([]);
      return;
    }
    this.layout.getDeptColumns(deptId).then(res => {
      const sorted = [...(res.columns ?? [])].sort((a, b) => a.order - b.order);
      const seen = new Set<string>();
      const sanitized = sorted.map((c, i) => {
        const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        let name = c.name && c.name.trim() !== ''
          ? c.name.trim()
          : (c.label ? slug(c.label) : `col_${i + 1}`);
        if (!name) name = `col_${i + 1}`;
        if (seen.has(name)) {
          let suffix = 2;
          while (seen.has(`${name}_${suffix}`)) suffix += 1;
          name = `${name}_${suffix}`;
        }
        seen.add(name);
        return { ...c, label: c.label ?? '', name } as ReportColumn;
      });
      this.deptColumns.set(sanitized);
    }).catch(() => this.deptColumns.set([]));
  });

  // ── Per-(test, parameter) cell locks ──────────────────────
  // Keyed by parameterName → { columnName → { locked, value } }.
  // Lock editor expansion is tracked separately so collapsing a
  // section doesn't lose unsaved edits.
  protected readonly _locks = signal<Record<string, Record<string, ColumnLock>>>({});
  protected readonly _lockOpen = signal<Set<string>>(new Set());
  protected readonly savingLock = signal<string | null>(null);

  isLockEditorOpen(p: string): boolean { return this._lockOpen().has(p); }
  toggleLockEditor(p: string) {
    this._lockOpen.update(s => {
      const next = new Set(s);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
    // First-time open and no rows yet → seed an empty entry so the user
    // sees the row editor without an extra "+ Lock another column" tap.
    if (this._lockOpen().has(p) && this.lockCount(p) === 0) {
      this.addLockColumn(p);
    }
  }
  lockEntries(p: string): Array<{ column: string; value: string | null; locked: boolean }> {
    const m = this._locks()[p] ?? {};
    return Object.keys(m).map(column => ({ column, value: m[column].value, locked: m[column].locked }));
  }
  lockCount(p: string): number {
    const m = this._locks()[p] ?? {};
    return Object.keys(m).filter(k => m[k].locked && m[k].value != null && m[k].value !== '').length;
  }
  addLockColumn(p: string) {
    this._locks.update(all => {
      const next = { ...all };
      const inner = { ...(next[p] ?? {}) };
      const key = uniqueKey(inner, 'column');
      inner[key] = { locked: true, value: '' };
      next[p] = inner;
      return next;
    });
  }
  renameLockColumn(p: string, oldKey: string, newKey: string) {
    if (!newKey.trim() || newKey === oldKey) return;
    this._locks.update(all => {
      const next = { ...all };
      const inner = { ...(next[p] ?? {}) };
      if (!(oldKey in inner)) return all;
      inner[newKey] = inner[oldKey];
      delete inner[oldKey];
      next[p] = inner;
      return next;
    });
  }
  setLockValue(p: string, column: string, value: string) {
    // Refuse writes for an empty parameter — locks are keyed by
    // parameter name, and `_locks[""]` would be shared across every
    // row that hasn't been assigned yet (cross-row bleed).
    if (!p) return;
    this._locks.update(all => {
      const next = { ...all };
      const inner = { ...(next[p] ?? {}) };
      inner[column] = { locked: true, value };
      next[p] = inner;
      return next;
    });
  }
  removeLock(p: string, column: string) {
    this._locks.update(all => {
      const next = { ...all };
      const inner = { ...(next[p] ?? {}) };
      delete inner[column];
      next[p] = inner;
      return next;
    });
  }
  async clearLocks(p: string) {
    if (!(await this.dialog.confirm({ title: 'Remove all column locks?', message: p, confirmLabel: 'Remove', tone: 'danger' }))) return;
    const id = this.testId();
    if (!id) return;
    this._locks.update(all => {
      const next = { ...all };
      delete next[p];
      return next;
    });
    try {
      await this.layout.deleteLock(id, p);
      this.toasts.success(`Locks cleared for ${p}`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    }
  }
  async saveLocks(p: string) {
    const id = this.testId();
    if (!id) return;
    this.savingLock.set(p);
    try {
      const map = this._locks()[p] ?? {};
      // Drop any rows with an empty column key (admin abandoned a fresh lock).
      const cleaned: Record<string, ColumnLock> = {};
      for (const k of Object.keys(map)) {
        if (!k.trim()) continue;
        cleaned[k] = map[k];
      }
      await this.layout.saveLock(id, p, cleaned);
      this._locks.update(all => ({ ...all, [p]: cleaned }));
      this.toasts.success(`Locks saved for ${p}`);
    } catch (e: unknown) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.savingLock.set(null);
    }
  }

  // ───────── Section helpers (cast guards for the union) ─────

  asGrid(s: ReportSection): GridSection { return s as GridSection; }
  asPara(s: ReportSection): ParagraphSection { return s as ParagraphSection; }
  asChart(s: ReportSection): ChartSection { return s as ChartSection; }
  asImage(s: ReportSection): ImageSection { return s as ImageSection; }
  asParam(r: GridRow): GridRowParameter { return r as GridRowParameter; }
  asMerged(r: GridRow): GridRowMerged { return r as GridRowMerged; }
  cellKeys(r: GridRow): string[] {
    return r.row_merge ? [] : Object.keys((r as GridRowParameter).cells ?? {});
  }
  defaultLabel(t: ReportSectionType): string {
    return t === 'grid' ? 'Results' : t === 'paragraph' ? 'Interpretation'
      : t === 'chart' ? 'Chart' : 'Attached images';
  }
  numOrStr(v: string): number | string {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== '' ? n : v;
  }

  // ───────── Section CRUD ─────────────────────────────────

  addSection(t: ReportSectionType) {
    const id = newId();
    const order = this.sections().length + 1;
    let s: ReportSection;
    switch (t) {
      case 'grid':      s = { id, type: 'grid', order, rows: [], conditions: [] }; break;
      case 'paragraph': s = { id, type: 'paragraph', order, template: '', conditions: [] }; break;
      case 'chart':     s = { id, type: 'chart', order, parameter: '', min: 0, max: 100, zones: [], conditions: [] }; break;
      case 'image':     s = { id, type: 'image', order, conditions: [] }; break;
      // Culture-only building blocks — the palette offers them only when the
      // host says the test is a culture (see the `culture` input).
      case 'culture_line': s = { id, type: 'culture_line', order, source: 'gramStain', conditions: [] }; break;
      case 'culture_ast':  s = { id, type: 'culture_ast', order, conditions: [] }; break;
    }
    this.mutateSections(arr => [...arr, s]);
  }

  patchSection(i: number, patch: Partial<ReportSection>) {
    this.mutateSections(arr => {
      const next = [...arr];
      next[i] = { ...next[i], ...patch } as ReportSection;
      return next;
    });
  }

  async removeSection(i: number) {
    if (!(await this.dialog.confirm({ title: 'Delete this section?', confirmLabel: 'Delete', tone: 'danger' }))) return;
    this.mutateSections(arr => this.reindex(arr.filter((_, idx) => idx !== i)));
  }

  moveSection(i: number, dir: -1 | 1) {
    this.mutateSections(arr => {
      const next = [...arr];
      const j = i + dir;
      if (j < 0 || j >= next.length) return arr;
      [next[i], next[j]] = [next[j], next[i]];
      return this.reindex(next);
    });
  }

  // ───────── Grid rows ────────────────────────────────────

  addRow(sectionIdx: number, merged: boolean) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      if (sec.type !== 'grid') return arr;
      const id = newId();
      const row: GridRow = merged
        ? { id, row_merge: true, merge_content: { type: 'paragraph', template: '' }, conditions: [] }
        : { id, parameter_name: '', cells: {}, row_merge: false, conditions: [] };
      next[sectionIdx] = { ...sec, rows: [...sec.rows, row] };
      return next;
    });
  }

  patchRow(sectionIdx: number, rowIdx: number, patch: Partial<GridRow>) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      rows[rowIdx] = { ...rows[rowIdx], ...patch } as GridRow;
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  removeRow(sectionIdx: number, rowIdx: number) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      next[sectionIdx] = { ...sec, rows: sec.rows.filter((_, i) => i !== rowIdx) };
      return next;
    });
  }

  moveRow(sectionIdx: number, rowIdx: number, dir: -1 | 1) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const j = rowIdx + dir;
      if (j < 0 || j >= rows.length) return arr;
      [rows[rowIdx], rows[j]] = [rows[j], rows[rowIdx]];
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  patchMergeTpl(sectionIdx: number, rowIdx: number, template: string) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const r = rows[rowIdx] as GridRowMerged;
      rows[rowIdx] = { ...r, merge_content: { ...r.merge_content, type: 'paragraph', template } };
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  // ───────── Cell key/value editing ───────────────────────

  addCellKey(sectionIdx: number, rowIdx: number) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const r = rows[rowIdx] as GridRowParameter;
      const newKey = uniqueKey(r.cells, 'column');
      rows[rowIdx] = { ...r, cells: { ...r.cells, [newKey]: '' } };
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  /** Click-to-add a specific dept column to a row's cell overrides.
   *  Used by the column chips above the cells list. If the column is
   *  already present, this is a no-op (chip styling shows the
   *  already-added state via .pf-col-chip--used). */
  addCellKeyNamed(sectionIdx: number, rowIdx: number, columnName: string) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const r = rows[rowIdx] as GridRowParameter;
      if (columnName in (r.cells ?? {})) return arr;
      // Prefill with the result placeholder for the row's parameter when
      // the column is the canonical "result" name — saves a typing step.
      const seedValue = columnName === 'result' && r.parameter_name
        ? `{{${r.parameter_name}}}`
        : '';
      rows[rowIdx] = { ...r, cells: { ...r.cells, [columnName]: seedValue } };
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  /** Has this row already overridden the named column? */
  hasCellKey(r: GridRow, name: string): boolean {
    return !r.row_merge && name in ((r as GridRowParameter).cells ?? {});
  }

  setCellValue(sectionIdx: number, rowIdx: number, key: string, value: string) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const r = rows[rowIdx] as GridRowParameter;
      rows[rowIdx] = { ...r, cells: { ...r.cells, [key]: value } };
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  renameCellKey(sectionIdx: number, rowIdx: number, oldKey: string, newKey: string) {
    if (oldKey === newKey || !newKey.trim()) return;
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const r = rows[rowIdx] as GridRowParameter;
      const cells: Record<string, string> = {};
      for (const k of Object.keys(r.cells)) {
        cells[k === oldKey ? newKey : k] = r.cells[k];
      }
      rows[rowIdx] = { ...r, cells };
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  removeCellKey(sectionIdx: number, rowIdx: number, key: string) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const r = rows[rowIdx] as GridRowParameter;
      const cells = { ...r.cells };
      delete cells[key];
      rows[rowIdx] = { ...r, cells };
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  // ───────── Conditions ──────────────────────────────────

  addCondition(sectionIdx: number, rowIdx: number) {
    this.patchRowConds(sectionIdx, rowIdx, conds => [
      ...conds,
      { if: { parameter: '', operator: '<', value: 0 }, then: {} }
    ]);
  }

  /** Append an `{ else: true, then: {} }` fallback. The engine applies
   *  the else branch when no `if` matches. We refuse a second one —
   *  the model only honors the first else encountered. */
  addElseCondition(sectionIdx: number, rowIdx: number) {
    const sec = this.sections()[sectionIdx];
    if (!sec || sec.type !== 'grid') return;
    const r = (sec as GridSection).rows[rowIdx];
    if (!r) return;
    const conds = r.conditions ?? [];
    if (conds.some(c => c.else)) return;
    this.patchRowConds(sectionIdx, rowIdx, list => [...list, { else: true, then: {} }]);
  }
  hasElseCondition(r: GridRow): boolean {
    return (r.conditions ?? []).some(c => c.else === true);
  }
  /** Flip a condition between IF and ELSE in place. Used by the small
   *  toggle button on each condition header. */
  toggleCondMode(sectionIdx: number, rowIdx: number, condIdx: number) {
    this.patchRowConds(sectionIdx, rowIdx, list => {
      const next = [...list];
      const c = next[condIdx];
      if (!c) return list;
      if (c.else) {
        const { else: _e, ...rest } = c;
        next[condIdx] = { ...rest, if: { parameter: '', operator: '<', value: 0 } };
      } else {
        const { if: _if, ...rest } = c;
        next[condIdx] = { ...rest, else: true };
      }
      return next;
    });
  }
  patchCond(sectionIdx: number, rowIdx: number, condIdx: number, patch: Partial<ConditionRule>) {
    this.patchRowConds(sectionIdx, rowIdx, conds => {
      const next = [...conds];
      next[condIdx] = { ...next[condIdx], ...patch, then: { ...next[condIdx].then, ...(patch.then ?? {}) } };
      return next;
    });
  }
  removeCondition(sectionIdx: number, rowIdx: number, condIdx: number) {
    this.patchRowConds(sectionIdx, rowIdx, conds => conds.filter((_, i) => i !== condIdx));
  }
  private patchRowConds(sectionIdx: number, rowIdx: number, fn: (c: ConditionRule[]) => ConditionRule[]) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      const r = rows[rowIdx];
      rows[rowIdx] = { ...r, conditions: fn(r.conditions ?? []) } as GridRow;
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  addSectionCondition(sectionIdx: number) {
    this.patchSectionConds(sectionIdx, conds => [
      ...conds,
      { if: { parameter: '', operator: '<', value: 0 }, then: { show: true } }
    ]);
  }
  addElseSectionCondition(sectionIdx: number) {
    const sec = this.sections()[sectionIdx];
    if (!sec) return;
    if ((sec.conditions ?? []).some(c => c.else)) return;
    this.patchSectionConds(sectionIdx, list => [...list, { else: true, then: { show: false } }]);
  }
  hasElseSectionCondition(s: ReportSection): boolean {
    return (s.conditions ?? []).some(c => c.else === true);
  }
  toggleSectionCondMode(sectionIdx: number, condIdx: number) {
    this.patchSectionConds(sectionIdx, list => {
      const next = [...list];
      const c = next[condIdx];
      if (!c) return list;
      if (c.else) {
        const { else: _e, ...rest } = c;
        next[condIdx] = { ...rest, if: { parameter: '', operator: '<', value: 0 } };
      } else {
        const { if: _if, ...rest } = c;
        next[condIdx] = { ...rest, else: true };
      }
      return next;
    });
  }
  patchSectionCond(sectionIdx: number, condIdx: number, patch: Partial<ConditionRule>) {
    this.patchSectionConds(sectionIdx, conds => {
      const next = [...conds];
      next[condIdx] = { ...next[condIdx], ...patch, then: { ...next[condIdx].then, ...(patch.then ?? {}) } };
      return next;
    });
  }
  removeSectionCondition(sectionIdx: number, condIdx: number) {
    this.patchSectionConds(sectionIdx, conds => conds.filter((_, i) => i !== condIdx));
  }
  private patchSectionConds(sectionIdx: number, fn: (c: ConditionRule[]) => ConditionRule[]) {
    this.mutateSections(arr => {
      const next = [...arr];
      next[sectionIdx] = { ...next[sectionIdx], conditions: fn(next[sectionIdx].conditions ?? []) } as ReportSection;
      return next;
    });
  }

  // ───────── Save + preview ───────────────────────────────

  async save() {
    const id = this.testId();
    if (!id) return;
    this.saving.set(true);
    try {
      const payload = this.stripDerivedCells(this.reindex(this.sections()));
      await this.layout.saveTestLayout(id, payload);
      this.configured.set(true);
      this.version.update(v => v + 1);
      this.toasts.success('Layout saved');
      // Refresh preview if visible.
      if (this.previewOpen()) this.refreshPreview();
    } catch (e: unknown) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.saving.set(false);
    }
  }

  togglePreview() {
    const next = !this.previewOpen();
    this.previewOpen.set(next);
    if (next) this.refreshPreview();
  }

  setSampleValue(name: string, raw: string) {
    const v = raw.trim() === '' ? '' : (Number.isFinite(+raw) ? +raw : raw);
    this.sampleValues.update(m => ({ ...m, [name]: v }));
    if (this.previewOpen()) this.refreshPreview();
  }

  async refreshPreview() {
    const id = this.testId();
    if (!id) return;
    try {
      // Save current draft to the server before previewing so the engine sees
      // the latest sections (the embedded PDF preview resolves server-side).
      // Skipped if there are no sections yet (draft-empty state).
      if (this.sections().length > 0) {
        await this.layout.saveTestLayout(id, this.stripDerivedCells(this.reindex(this.sections())));
      }
      this.previewToken.update(v => v + 1);
    } catch (e: unknown) {
      this.toasts.error(ApiError.from(e).message);
    }
  }

  // ───────── Chart zone editor ──────────────────────────

  /** Color tokens for chart zones — same canonical set as condition colors
   *  but with explicit "Default" stripped (zones must have a color). */
  protected readonly zoneColors = [
    { value: 'red',    label: 'Red',    hex: '#C0392B' },
    { value: 'orange', label: 'Orange', hex: '#E87722' },
    { value: 'green',  label: 'Green',  hex: '#1D9E75' },
  ];

  addZone(sectionIdx: number) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as ChartSection;
      if (sec.type !== 'chart') return arr;
      // Slot the new zone at the end of the existing range so it doesn't
      // overlap visually — admin tweaks from/to immediately.
      const last = sec.zones[sec.zones.length - 1];
      const from = last ? last.to : sec.min;
      const to = Math.min(sec.max, from + Math.max(1, (sec.max - sec.min) / 5));
      const zone = { from, to, color: 'green', label: '' };
      next[sectionIdx] = { ...sec, zones: [...sec.zones, zone] };
      return next;
    });
  }

  patchZone(sectionIdx: number, zoneIdx: number, patch: Partial<{ from: number; to: number; color: string; label: string }>) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as ChartSection;
      const zones = [...sec.zones];
      zones[zoneIdx] = { ...zones[zoneIdx], ...patch };
      next[sectionIdx] = { ...sec, zones };
      return next;
    });
  }

  removeZone(sectionIdx: number, zoneIdx: number) {
    this.mutateSections(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as ChartSection;
      next[sectionIdx] = { ...sec, zones: sec.zones.filter((_, i) => i !== zoneIdx) };
      return next;
    });
  }

  /** Same percentage math as the rendered chart, applied to the draft so
   *  the inline preview band updates as the admin tweaks from/to. */
  zonePctLeftDraft(chart: ChartSection, z: { from: number }): number {
    if (!chart || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((z.from - chart.min) / (chart.max - chart.min)) * 100));
  }
  zonePctWidthDraft(chart: ChartSection, z: { from: number; to: number }): number {
    if (!chart || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((z.to - z.from) / (chart.max - chart.min)) * 100));
  }

  // ───────── Chart preview math (resolved) ──────────────

  zoneHex(token: string): string {
    if (token === 'red')    return '#fecaca';
    if (token === 'orange') return '#fed7aa';
    if (token === 'green')  return '#bbf7d0';
    return token.startsWith('#') ? token : '#e2e8f0';
  }

  // ───────── Misc helpers ────────────────────────────────

  /** Unit / range columns print from the parameter (single source) — the
   *  spreadsheet shows them read-only and never stores a typed cell. */
  isDerivedCol(col: ReportColumn): boolean {
    return col.type === 'unit' || col.type === 'range';
  }

  /** Drop typed unit/range cells from grid rows before a save (legacy
   *  layouts and migrated locks carried them; the engine ignores them). */
  private stripDerivedCells(arr: ReportSection[]): ReportSection[] {
    const derived = new Set(['unit', 'range']);
    for (const c of this.deptColumnsForRender()) if (this.isDerivedCol(c)) derived.add(c.name);
    return arr.map(s => {
      if (s.type !== 'grid') return s;
      const g = s as GridSection;
      return {
        ...g,
        rows: (g.rows ?? []).map(r => {
          const cells = (r as GridRowParameter).cells;
          if (r.row_merge || !cells || !Object.keys(cells).some(k => derived.has(k))) return r;
          return { ...r, cells: Object.fromEntries(Object.entries(cells).filter(([k]) => !derived.has(k))) } as GridRow;
        }),
      } as ReportSection;
    });
  }

  private reindex<T extends { order: number }>(arr: T[]): T[] {
    return arr.map((s, i) => ({ ...s, order: i + 1 }));
  }
}

function newId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueKey(obj: Record<string, unknown>, base: string): string {
  if (!(base in obj)) return base;
  let i = 2;
  while ((`${base}_${i}`) in obj) i += 1;
  return `${base}_${i}`;
}
