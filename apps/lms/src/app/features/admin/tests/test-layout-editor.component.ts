import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ConditionRule,
  GridRow,
  GridRowMerged,
  GridRowParameter,
  GridSection,
  ImageSection,
  ParagraphSection,
  ChartSection,
  ReportSection,
  ReportSectionType,
  ResolvedReportLayout,
  ResolvedRow,
  ResolvedSection,
} from '../../../shared/models/report-layout.model';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

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
  imports: [FormsModule, TileComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-tile tone="default" padding="lg" class="block">
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 class="section-title">Report Layout</h3>
          <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
            Sections render top-to-bottom in the PDF and viewer. Each section
            uses the column structure configured for this test's department.
          </p>
        </div>
        <div class="flex items-center gap-2">
          @if (configured()) {
            <span class="pf-pill pf-pill--ok">Configured · v{{ version() }}</span>
          }
          <pf-touch-btn size="sm" variant="secondary"
                        [disabled]="!testId() || sections().length === 0"
                        (pressed)="togglePreview()">
            {{ previewOpen() ? 'Hide preview' : 'Preview' }}
          </pf-touch-btn>
          <pf-touch-btn size="sm" variant="primary"
                        [disabled]="saving() || !testId()"
                        (pressed)="save()">
            {{ saving() ? 'Saving…' : 'Save layout' }}
          </pf-touch-btn>
        </div>
      </div>

      <!-- ── Section list ─────────────────────────────────── -->
      @if (!testId()) {
        <p class="text-center py-6 text-[13px]" style="color: var(--text-tertiary);">
          Save the test first — then come back here to design its report layout.
        </p>
      } @else {
        <ul class="pf-section-list">
          @for (s of sections(); track s.id; let i = $index) {
            <li class="pf-section">
              <header class="pf-section__hdr">
                <span class="pf-section__type" [attr.data-type]="s.type">{{ s.type }}</span>
                <input type="text" class="pf-input pf-input--inline-label"
                       [value]="s.label ?? ''"
                       (input)="patchSection(i, { label: $any($event.target).value || null })"
                       [placeholder]="defaultLabel(s.type)" />
                <span class="grow"></span>
                <button type="button" class="pf-icon-btn"
                        [disabled]="i === 0" (click)="moveSection(i, -1)" aria-label="Move up">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m18 15-6-6-6 6"/>
                  </svg>
                </button>
                <button type="button" class="pf-icon-btn"
                        [disabled]="i === sections().length - 1" (click)="moveSection(i, 1)" aria-label="Move down">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </button>
                <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                        (click)="removeSection(i)" aria-label="Delete section">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </header>

              <!-- ─── GRID SECTION ─── -->
              @if (s.type === 'grid') {
                <div class="pf-section__body">
                  <ul class="pf-row-list">
                    @for (r of asGrid(s).rows; track r.id; let ri = $index) {
                      <li class="pf-row">
                        <header class="pf-row__hdr">
                          @if (r.row_merge) {
                            <span class="pf-row__badge pf-row__badge--merged">Merged row</span>
                          } @else {
                            <span class="pf-row__badge">Parameter</span>
                            <select class="pf-input pf-input--inline-label"
                                    [ngModel]="asParam(r).parameter_name"
                                    (ngModelChange)="patchRow(i, ri, { parameter_name: $event })">
                              <option value="">— pick parameter —</option>
                              @for (p of parameters(); track p) {
                                <option [value]="p">{{ p }}</option>
                              }
                            </select>
                          }
                          <span class="grow"></span>
                          <button type="button" class="pf-icon-btn"
                                  [disabled]="ri === 0" (click)="moveRow(i, ri, -1)" aria-label="Move row up">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                              <path d="m18 15-6-6-6 6"/>
                            </svg>
                          </button>
                          <button type="button" class="pf-icon-btn"
                                  [disabled]="ri === asGrid(s).rows.length - 1"
                                  (click)="moveRow(i, ri, 1)" aria-label="Move row down">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                              <path d="m6 9 6 6 6-6"/>
                            </svg>
                          </button>
                          <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                                  (click)="removeRow(i, ri)" aria-label="Delete row">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            </svg>
                          </button>
                        </header>

                        @if (r.row_merge) {
                          <div class="pf-row__body">
                            <label class="pf-label-mini">Merged content (spans all columns)</label>
                            <textarea class="pf-input pf-input--ta"
                                      rows="2"
                                      [value]="asMerged(r).merge_content?.template ?? ''"
                                      (input)="patchMergeTpl(i, ri, $any($event.target).value)"
                                      [attr.placeholder]="mergedTplPlaceholder"></textarea>
                          </div>
                        } @else {
                          <div class="pf-row__body">
                            <label class="pf-label-mini">Cell template overrides
                              <span class="text-[10px]" style="color: var(--text-muted);">
                                · {{ phLabel }} resolve to result values
                              </span>
                            </label>
                            <div class="pf-cells">
                              <!-- Render input per column key the admin has decided to override.
                                   We don't enumerate dept columns here (we don't know them);
                                   admin types the column.name directly. -->
                              @for (k of cellKeys(r); track k; let ki = $index) {
                                <div class="pf-cell">
                                  <input type="text" class="pf-input pf-input--mono pf-input--compact"
                                         placeholder="column.name"
                                         [value]="k"
                                         (input)="renameCellKey(i, ri, k, $any($event.target).value)" />
                                  <input type="text" class="pf-input pf-input--compact grow"
                                         [attr.placeholder]="cellValuePlaceholder"
                                         [value]="asParam(r).cells[k]"
                                         (input)="setCellValue(i, ri, k, $any($event.target).value)" />
                                  <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                                          (click)="removeCellKey(i, ri, k)" aria-label="Remove cell override">×</button>
                                </div>
                              }
                              <button type="button" class="pf-link-btn" (click)="addCellKey(i, ri)">+ Cell override</button>
                            </div>
                          </div>
                        }

                        <!-- Per-row conditions (color / bold / cells) -->
                        <div class="pf-row__conds">
                          <div class="flex items-center justify-between mb-2">
                            <label class="pf-label-mini">Conditions</label>
                            <button type="button" class="pf-link-btn"
                                    (click)="addCondition(i, ri)">+ Add condition</button>
                          </div>
                          @for (c of (r.conditions ?? []); track $index; let ci = $index) {
                            <div class="pf-cond">
                              <div class="pf-cond__head">
                                @if (c.else) {
                                  <span class="pf-cond__kw">ELSE</span>
                                } @else {
                                  <span class="pf-cond__kw">IF</span>
                                  <select class="pf-input pf-input--compact"
                                          [ngModel]="c.if?.parameter ?? ''"
                                          (ngModelChange)="patchCond(i, ri, ci, { if: { ...(c.if ?? {}), parameter: $event } })">
                                    <option value="">— param —</option>
                                    @for (p of parameters(); track p) {
                                      <option [value]="p">{{ p }}</option>
                                    }
                                  </select>
                                  <select class="pf-input pf-input--compact"
                                          style="width: 60px"
                                          [ngModel]="c.if?.operator ?? '<'"
                                          (ngModelChange)="patchCond(i, ri, ci, { if: { ...(c.if ?? {}), operator: $event } })">
                                    @for (op of operators; track op.value) {
                                      <option [value]="op.value">{{ op.label }}</option>
                                    }
                                  </select>
                                  <input type="number" class="pf-input pf-input--compact"
                                         style="width: 90px"
                                         [value]="$any(c.if?.value ?? '')"
                                         (input)="patchCond(i, ri, ci, { if: { ...(c.if ?? {}), value: numOrStr($any($event.target).value) } })" />
                                }
                                <span class="grow"></span>
                                <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                                        (click)="removeCondition(i, ri, ci)" aria-label="Remove condition">×</button>
                              </div>
                              <div class="pf-cond__then">
                                <span class="pf-cond__kw">THEN</span>
                                <span class="text-[11px]" style="color: var(--text-muted);">color:</span>
                                @for (col of colors; track col.value) {
                                  <button type="button" class="pf-color-chip"
                                          [class.pf-color-chip--on]="(c.then.color ?? c.then.set_color ?? '') === col.value"
                                          [style.background]="col.hex"
                                          (click)="patchCond(i, ri, ci, { then: { ...c.then, color: col.value || undefined } })"
                                          [attr.aria-label]="col.label" [title]="col.label"></button>
                                }
                                <label class="pf-bold-toggle">
                                  <input type="checkbox" [checked]="!!(c.then.bold || c.then.set_bold)"
                                         (change)="patchCond(i, ri, ci, { then: { ...c.then, bold: $any($event.target).checked } })" />
                                  <span>Bold</span>
                                </label>
                              </div>
                            </div>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                  <div class="flex gap-2 mt-3">
                    <button type="button" class="pf-link-btn" (click)="addRow(i, false)">+ Parameter row</button>
                    <button type="button" class="pf-link-btn" (click)="addRow(i, true)">+ Merged row</button>
                  </div>
                </div>
              }

              <!-- ─── PARAGRAPH SECTION ─── -->
              @if (s.type === 'paragraph') {
                <div class="pf-section__body">
                  <label class="pf-label-mini">Template
                    <span class="text-[10px]" style="color: var(--text-muted);">
                      — use {{ phLabel }} for results, {{ phUnitLabel }} / {{ phRangeLabel }} for metadata
                    </span>
                  </label>
                  <textarea class="pf-input pf-input--ta"
                            rows="4"
                            [value]="asPara(s).template"
                            (input)="patchSection(i, { template: $any($event.target).value })"
                            [attr.placeholder]="paragraphPlaceholder"></textarea>

                  <!-- Section-level conditions (show/hide) -->
                  <div class="pf-row__conds" style="margin-top: 12px;">
                    <div class="flex items-center justify-between mb-2">
                      <label class="pf-label-mini">Show this section when…</label>
                      <button type="button" class="pf-link-btn"
                              (click)="addSectionCondition(i)">+ Add condition</button>
                    </div>
                    @for (c of (s.conditions ?? []); track $index; let ci = $index) {
                      <div class="pf-cond">
                        <div class="pf-cond__head">
                          @if (c.else) {
                            <span class="pf-cond__kw">ELSE</span>
                          } @else {
                            <span class="pf-cond__kw">IF</span>
                            <select class="pf-input pf-input--compact"
                                    [ngModel]="c.if?.parameter ?? ''"
                                    (ngModelChange)="patchSectionCond(i, ci, { if: { ...(c.if ?? {}), parameter: $event } })">
                              <option value="">— param —</option>
                              @for (p of parameters(); track p) {
                                <option [value]="p">{{ p }}</option>
                              }
                            </select>
                            <select class="pf-input pf-input--compact" style="width: 60px"
                                    [ngModel]="c.if?.operator ?? '<'"
                                    (ngModelChange)="patchSectionCond(i, ci, { if: { ...(c.if ?? {}), operator: $event } })">
                              @for (op of operators; track op.value) {
                                <option [value]="op.value">{{ op.label }}</option>
                              }
                            </select>
                            <input type="number" class="pf-input pf-input--compact" style="width: 90px"
                                   [value]="$any(c.if?.value ?? '')"
                                   (input)="patchSectionCond(i, ci, { if: { ...(c.if ?? {}), value: numOrStr($any($event.target).value) } })" />
                          }
                          <span class="grow"></span>
                          <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                                  (click)="removeSectionCondition(i, ci)" aria-label="Remove condition">×</button>
                        </div>
                        <div class="pf-cond__then">
                          <span class="pf-cond__kw">THEN</span>
                          <label class="pf-bold-toggle">
                            <input type="radio" [name]="'show-' + s.id + '-' + ci"
                                   [checked]="c.then.show !== false"
                                   (change)="patchSectionCond(i, ci, { then: { ...c.then, show: true } })" />
                            <span>Show</span>
                          </label>
                          <label class="pf-bold-toggle">
                            <input type="radio" [name]="'show-' + s.id + '-' + ci"
                                   [checked]="c.then.show === false"
                                   (change)="patchSectionCond(i, ci, { then: { ...c.then, show: false } })" />
                            <span>Hide</span>
                          </label>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- ─── CHART SECTION ─── -->
              @if (s.type === 'chart') {
                <div class="pf-section__body">
                  <div class="grid grid-cols-3 gap-3">
                    <div>
                      <label class="pf-label-mini">Parameter</label>
                      <select class="pf-input pf-input--compact"
                              [ngModel]="asChart(s).parameter"
                              (ngModelChange)="patchSection(i, { parameter: $event })">
                        <option value="">— pick —</option>
                        @for (p of parameters(); track p) { <option [value]="p">{{ p }}</option> }
                      </select>
                    </div>
                    <div>
                      <label class="pf-label-mini">Min</label>
                      <input type="number" class="pf-input pf-input--compact"
                             [value]="asChart(s).min"
                             (input)="patchSection(i, { min: +$any($event.target).value })" />
                    </div>
                    <div>
                      <label class="pf-label-mini">Max</label>
                      <input type="number" class="pf-input pf-input--compact"
                             [value]="asChart(s).max"
                             (input)="patchSection(i, { max: +$any($event.target).value })" />
                    </div>
                  </div>
                  <p class="text-[11px] mt-3" style="color: var(--text-muted);">
                    Zone editor (low/normal/high colored bands) — coming in the next pass.
                  </p>
                </div>
              }

              <!-- ─── IMAGE SECTION ─── -->
              @if (s.type === 'image') {
                <div class="pf-section__body">
                  <label class="pf-label-mini">Caption</label>
                  <input type="text" class="pf-input pf-input--compact"
                         [value]="asImage(s).caption ?? ''"
                         (input)="patchSection(i, { caption: $any($event.target).value })"
                         placeholder="Attached images" />
                  <p class="text-[11px] mt-3" style="color: var(--text-muted);">
                    Renders any images uploaded by the tech / pathologist during result entry.
                    Hidden by default when no images are attached.
                  </p>
                </div>
              }
            </li>
          }
        </ul>

        <!-- Add section -->
        <div class="pf-section-add">
          <span class="text-[12px]" style="color: var(--text-tertiary);">Add section:</span>
          <pf-touch-btn size="sm" variant="secondary" (pressed)="addSection('grid')">+ Grid</pf-touch-btn>
          <pf-touch-btn size="sm" variant="secondary" (pressed)="addSection('paragraph')">+ Paragraph</pf-touch-btn>
          <pf-touch-btn size="sm" variant="secondary" (pressed)="addSection('chart')">+ Chart</pf-touch-btn>
          <pf-touch-btn size="sm" variant="secondary" (pressed)="addSection('image')">+ Image</pf-touch-btn>
        </div>

        <!-- ── Live preview panel ───────────────────────────── -->
        @if (previewOpen()) {
          <div class="pf-preview-panel">
            <header class="pf-preview-panel__hdr">
              <h4 class="text-[13px] font-semibold m-0" style="color: var(--text-primary);">Live preview</h4>
              <span class="grow"></span>
              <pf-touch-btn size="sm" variant="ghost" (pressed)="refreshPreview()">Refresh</pf-touch-btn>
            </header>

            <!-- Sample value inputs -->
            <div class="pf-sample-inputs">
              <span class="text-[10.5px] font-mono uppercase tracking-[0.16em]"
                    style="color: var(--text-muted);">Sample values</span>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                @for (p of parameters(); track p) {
                  <div class="pf-sample-input">
                    <label>{{ p }}</label>
                    <input type="text" class="pf-input pf-input--compact"
                           [value]="$any(sampleValues()[p] ?? '')"
                           (input)="setSampleValue(p, $any($event.target).value)" />
                  </div>
                }
              </div>
            </div>

            <!-- Rendered preview -->
            @if (previewLoading()) {
              <p class="text-center py-4 text-[12px]" style="color: var(--text-tertiary);">Resolving…</p>
            } @else if (preview(); as pv) {
              <div class="pf-preview-render">
                @for (sec of pv.sections; track sec.id) {
                  <div class="pf-pv-section" [attr.data-type]="sec.type">
                    @if (sec.label) { <h5 class="pf-pv-label">{{ sec.label }}</h5> }

                    @if (sec.type === 'grid' && sec.rows) {
                      <table class="pf-pv-table">
                        <thead>
                          <tr>
                            @for (c of pv.columns; track c.id) {
                              <th [style.width.%]="c.width">{{ c.label }}</th>
                            }
                          </tr>
                        </thead>
                        <tbody>
                          @for (r of sec.rows; track r.id) {
                            @if (r.isMerged) {
                              <tr class="pf-pv-row pf-pv-row--merged">
                                <td [attr.colspan]="pv.columns.length">{{ r.mergeContent }}</td>
                              </tr>
                            } @else {
                              <tr class="pf-pv-row"
                                  [style.color]="r.color || null"
                                  [style.font-weight]="r.isBold ? '700' : null">
                                @for (c of pv.columns; track c.id) {
                                  <td>{{ r.cells[c.name] }}</td>
                                }
                              </tr>
                            }
                          }
                        </tbody>
                      </table>
                    }

                    @if (sec.type === 'paragraph') {
                      <p class="pf-pv-para">{{ sec.content }}</p>
                    }

                    @if (sec.type === 'image') {
                      @if (sec.imageUrls && sec.imageUrls.length > 0) {
                        <div class="pf-pv-images">
                          @for (u of sec.imageUrls; track u) {
                            <img [src]="u" alt="" />
                          }
                        </div>
                      } @else {
                        <p class="pf-pv-empty">No images attached.</p>
                      }
                    }

                    @if (sec.type === 'chart' && sec.chart) {
                      <div class="pf-pv-chart">
                        <div class="pf-pv-chart__bar">
                          @for (z of sec.chart.zones; track z.from) {
                            <span class="pf-pv-chart__zone"
                                  [style.left.%]="zonePctLeft(sec.chart, z)"
                                  [style.width.%]="zonePctWidth(sec.chart, z)"
                                  [style.background]="zoneHex(z.color)"></span>
                          }
                          @if (sec.chart.value !== null && sec.chart.value !== undefined) {
                            <span class="pf-pv-chart__marker"
                                  [style.left.%]="markerPct(sec.chart)"></span>
                          }
                        </div>
                        <div class="pf-pv-chart__axis">
                          <span>{{ sec.chart.min }}</span>
                          <span>{{ sec.chart.value ?? '–' }}</span>
                          <span>{{ sec.chart.max }}</span>
                        </div>
                      </div>
                    }
                  </div>
                }
                @if (pv.sections.length === 0) {
                  <p class="pf-pv-empty">No sections visible for these values.</p>
                }
              </div>
            }
          </div>
        }
      }
    </pf-tile>
  `,
  styles: [`
    .pf-pill {
      display: inline-flex; align-items: center;
      padding: 3px 10px;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 9999px;
      border: 1px solid var(--glass-border);
    }
    .pf-pill--ok {
      background: rgba(16, 185, 129, 0.14);
      border-color: rgba(16, 185, 129, 0.4);
      color: #34d399;
    }

    .pf-section-list {
      display: flex; flex-direction: column; gap: 12px;
      list-style: none; padding: 0; margin: 0 0 14px;
    }
    .pf-section {
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      background: var(--glass-bg);
      overflow: hidden;
    }
    .pf-section__hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-section__hdr > .grow { flex: 1; }
    .pf-section__type {
      padding: 3px 10px;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.16);
      border: 1px solid rgba(168, 85, 247, 0.4);
      color: #c4b5fd;
    }
    .pf-section__type[data-type='grid']      { background: rgba(168, 85, 247, 0.16); border-color: rgba(168, 85, 247, 0.4); color: #c4b5fd; }
    .pf-section__type[data-type='paragraph'] { background: rgba(59, 130, 246, 0.16); border-color: rgba(59, 130, 246, 0.4); color: #93c5fd; }
    .pf-section__type[data-type='chart']     { background: rgba(245, 158, 11, 0.16); border-color: rgba(245, 158, 11, 0.4); color: #fcd34d; }
    .pf-section__type[data-type='image']     { background: rgba(16, 185, 129, 0.16); border-color: rgba(16, 185, 129, 0.4); color: #6ee7b7; }
    .pf-section__body { padding: 14px; }

    .pf-row-list {
      display: flex; flex-direction: column; gap: 10px;
      list-style: none; padding: 0; margin: 0;
    }
    .pf-row {
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.18);
    }
    .pf-row__hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-row__hdr > .grow { flex: 1; }
    .pf-row__badge {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(168, 85, 247, 0.14);
      color: #c4b5fd;
    }
    .pf-row__badge--merged { background: rgba(245, 158, 11, 0.14); color: #fcd34d; }
    .pf-row__body { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .pf-row__conds {
      padding: 10px;
      border-top: 1px dashed var(--glass-border);
      background: rgba(0, 0, 0, 0.12);
    }

    .pf-cells { display: flex; flex-direction: column; gap: 6px; }
    .pf-cell { display: flex; align-items: center; gap: 6px; }
    .pf-cell > .grow { flex: 1; }

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

    .pf-input--inline-label { padding: 5px 8px; font-size: 12.5px; }
    .pf-input--compact { padding: 5px 8px; font-size: 12px; }
    .pf-input--mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }
    .pf-input--ta { font-family: inherit; resize: vertical; min-height: 64px; }

    .pf-label-mini {
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
      display: block;
    }

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
      color: #f87171;
      border-color: rgba(244, 63, 94, 0.5);
    }

    .pf-link-btn {
      background: transparent; border: 0;
      padding: 5px 10px;
      font-size: 12px; font-weight: 600;
      color: #c4b5fd;
      cursor: pointer;
      border-radius: 6px;
    }
    .pf-link-btn:hover { background: rgba(168, 85, 247, 0.1); }

    .pf-section-add {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 12px;
      border: 1px dashed var(--glass-border);
      border-radius: 12px;
    }

    /* ── Live preview ── */
    .pf-preview-panel {
      margin-top: 18px;
      padding: 14px;
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      background: rgba(0, 0, 0, 0.22);
    }
    .pf-preview-panel__hdr {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 12px;
    }
    .pf-preview-panel__hdr > .grow { flex: 1; }
    .pf-sample-inputs { margin-bottom: 14px; }
    .pf-sample-input {
      display: flex; flex-direction: column; gap: 2px;
    }
    .pf-sample-input label {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
    }

    .pf-preview-render {
      padding: 16px;
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
    .pf-pv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .pf-pv-table th {
      background: #1B3A6B; color: #fff;
      padding: 7px 9px;
      text-align: left;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .pf-pv-row td { padding: 6px 9px; border-bottom: 1px solid #e2e8f0; }
    .pf-pv-row:nth-child(even) td { background: #F7F9FC; }
    .pf-pv-row--merged td {
      background: #f1f5f9; font-style: italic; color: #475569;
      text-align: center; padding: 8px;
    }
    .pf-pv-para { margin: 0; font-size: 12.5px; line-height: 1.5; color: #1e293b; white-space: pre-wrap; }
    .pf-pv-empty { font-size: 12px; color: #94a3b8; font-style: italic; margin: 0; padding: 6px 0; }
    .pf-pv-images { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
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
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
  `]
})
export class TestLayoutEditorComponent {
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);

  /** Test id (after the parent's saveTest creates the row). When empty, the
   *  component shows the "save the test first" prompt. */
  readonly testId = input<string>('');
  /** List of parameter machine names — feeds the parameter dropdowns + the
   *  preview panel's sample-value inputs. Owner is the parent test editor
   *  which already maintains the field list. */
  readonly parameters = input<string[]>([]);

  protected readonly sections = signal<ReportSection[]>([]);
  protected readonly version = signal(0);
  protected readonly configured = signal(false);
  protected readonly saving = signal(false);

  protected readonly previewOpen = signal(false);
  protected readonly previewLoading = signal(false);
  protected readonly preview = signal<ResolvedReportLayout | null>(null);
  protected readonly sampleValues = signal<Record<string, unknown>>({});

  protected readonly operators = OPERATORS;
  protected readonly colors = COLOR_TOKENS;
  /** Literal label for `{{paramName}}` placeholders — kept off-template so
   *  the Angular parser doesn't try to interpolate the example. */
  protected readonly phLabel = '{{paramName}}';
  protected readonly phUnitLabel = '{{paramName_unit}}';
  protected readonly phRangeLabel = '{{paramName_range}}';
  protected readonly mergedTplPlaceholder = 'Note text — supports {{placeholders}}';
  protected readonly cellValuePlaceholder = 'value (use {{paramName}} to inject result)';
  protected readonly paragraphPlaceholder = 'The result is {{paramName}} {{paramName_unit}}…';

  /** Reload sections whenever the parent rebinds testId. */
  private readonly _loader = effect(() => {
    const id = this.testId();
    if (!id) {
      this.sections.set([]);
      return;
    }
    this.layout.getTestLayout(id).then(res => {
      this.sections.set([...(res.sections ?? [])].sort((a, b) => a.order - b.order));
      this.version.set(res.version);
      this.configured.set(res.configured);
    }).catch(() => this.sections.set([]));
  });

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
    }
    this.sections.update(arr => [...arr, s]);
  }

  patchSection(i: number, patch: Partial<ReportSection>) {
    this.sections.update(arr => {
      const next = [...arr];
      next[i] = { ...next[i], ...patch } as ReportSection;
      return next;
    });
  }

  removeSection(i: number) {
    if (!confirm('Delete this section?')) return;
    this.sections.update(arr => this.reindex(arr.filter((_, idx) => idx !== i)));
  }

  moveSection(i: number, dir: -1 | 1) {
    this.sections.update(arr => {
      const next = [...arr];
      const j = i + dir;
      if (j < 0 || j >= next.length) return arr;
      [next[i], next[j]] = [next[j], next[i]];
      return this.reindex(next);
    });
  }

  // ───────── Grid rows ────────────────────────────────────

  addRow(sectionIdx: number, merged: boolean) {
    this.sections.update(arr => {
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
    this.sections.update(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      const rows = [...sec.rows];
      rows[rowIdx] = { ...rows[rowIdx], ...patch } as GridRow;
      next[sectionIdx] = { ...sec, rows };
      return next;
    });
  }

  removeRow(sectionIdx: number, rowIdx: number) {
    this.sections.update(arr => {
      const next = [...arr];
      const sec = next[sectionIdx] as GridSection;
      next[sectionIdx] = { ...sec, rows: sec.rows.filter((_, i) => i !== rowIdx) };
      return next;
    });
  }

  moveRow(sectionIdx: number, rowIdx: number, dir: -1 | 1) {
    this.sections.update(arr => {
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
    this.sections.update(arr => {
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
    this.sections.update(arr => {
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

  setCellValue(sectionIdx: number, rowIdx: number, key: string, value: string) {
    this.sections.update(arr => {
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
    this.sections.update(arr => {
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
    this.sections.update(arr => {
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
    this.sections.update(arr => {
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
    this.sections.update(arr => {
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
      const payload = this.reindex(this.sections());
      await this.layout.saveTestLayout(id, payload);
      this.configured.set(true);
      this.version.update(v => v + 1);
      this.toasts.success('Layout saved');
      // Refresh preview if visible.
      if (this.previewOpen()) this.refreshPreview();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      this.toasts.error(msg);
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
    this.previewLoading.set(true);
    try {
      // Save current draft to the server before previewing so the engine sees
      // the latest sections. Lightweight — same shape we'd persist anyway.
      // Skipped if there are no sections yet (draft-empty state).
      if (this.sections().length > 0) {
        await this.layout.saveTestLayout(id, this.reindex(this.sections()));
      }
      const pv = await this.layout.preview(id, this.sampleValues(), []);
      this.preview.set(pv);
    } catch (e: unknown) {
      this.toasts.error('Preview failed');
    } finally {
      this.previewLoading.set(false);
    }
  }

  // ───────── Chart preview math ─────────────────────────

  zonePctLeft(chart: ResolvedReportLayout['sections'][number]['chart'], z: { from: number }): number {
    if (!chart || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((z.from - chart.min) / (chart.max - chart.min)) * 100));
  }
  zonePctWidth(chart: ResolvedReportLayout['sections'][number]['chart'], z: { from: number; to: number }): number {
    if (!chart || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((z.to - z.from) / (chart.max - chart.min)) * 100));
  }
  markerPct(chart: ResolvedReportLayout['sections'][number]['chart']): number {
    if (!chart || chart.value === null || chart.value === undefined || chart.max <= chart.min) return 0;
    return Math.max(0, Math.min(100, ((chart.value - chart.min) / (chart.max - chart.min)) * 100));
  }
  zoneHex(token: string): string {
    if (token === 'red')    return '#fecaca';
    if (token === 'orange') return '#fed7aa';
    if (token === 'green')  return '#bbf7d0';
    return token.startsWith('#') ? token : '#e2e8f0';
  }

  // ───────── Misc helpers ────────────────────────────────

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
