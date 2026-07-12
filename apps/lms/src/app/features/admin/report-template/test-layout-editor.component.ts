import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  GridRow,
  GridRowParameter,
  GridSection,
  ParagraphSection,
  ReportColumn,
  ReportSection,
  ResolvedReportLayout,
  ResolvedRow,
} from '../../../shared/models/report-layout.model';
import { Test } from '../../../shared/models/test.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

/**
 * Per-test report LAYOUT editor. Lives inside the Report Template tile as a
 * new "Per-test layout" tab. Admin picks a test, edits its ordered sections
 * (grid / paragraph), then saves via the per-test layout endpoint. The right
 * pane renders a live preview by POSTing sample result values to the engine's
 * /preview endpoint and rendering the returned ResolvedReportLayout.
 *
 * Mirrors report-columns-editor.component.ts conventions: standalone, signals,
 * OnPush, ReportLayoutService for HTTP, structured live preview.
 *
 * Scope: grid + paragraph sections are fully editable. A paragraph section can
 * be labelled (e.g. "Interpretation", "Method / Notes") so admins can attach
 * interpretive content per test.
 */
@Component({
  selector: 'pf-test-layout-editor',
  standalone: true,
  imports: [SelectComponent, TileComponent, TouchButtonComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid gap-5 {{ hidePreview() ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-[1.3fr_1fr]' }}">

      <!-- ─────────────── LEFT: section editor ─────────────── -->
      <pf-tile tone="default" padding="lg" class="block">

        <!-- Test picker + status -->
        <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div class="flex items-center gap-3 pf-test-pick">
            <label class="text-[11px] font-mono uppercase tracking-[0.16em]"
                   style="color: var(--text-muted);">Test</label>
            <pf-select
              style="width: 260px"
              [options]="testOptions()"
              [value]="selectedTestId()"
              [placeholder]="tests().length === 0 ? 'Loading…' : 'Select a test'"
              (valueChange)="selectTest($event)">
            </pf-select>
          </div>

          @if (selectedTestId()) {
            @if (configured()) {
              <span class="pf-status-pill pf-status-pill--ok">Configured</span>
            } @else {
              <span class="pf-status-pill pf-status-pill--default">No layout yet</span>
            }
          }
        </div>

        @if (loading()) {
          <div class="flex justify-center py-8">
            <pf-loading-logo size="md" color="purple" [showDna]="true"
                             [showText]="true" text="Loading layout…"></pf-loading-logo>
          </div>
        } @else if (selectedTestId()) {

          @if (sections().length === 0) {
            <p class="text-center py-5 text-[13px]" style="color: var(--text-tertiary);">
              No sections yet. Add a grid (results table) or a paragraph (notes / interpretation).
            </p>
          }

          <ul class="pf-sec-list">
            @for (s of sections(); track s.id; let si = $index) {
              <li class="pf-sec-card">

                <!-- Section header bar -->
                <div class="pf-sec-head">
                  <span class="pf-sec-badge"
                        [class.pf-sec-badge--grid]="s.type === 'grid'"
                        [class.pf-sec-badge--para]="s.type === 'paragraph'">
                    {{ s.type }}
                  </span>

                  <input type="text" class="pf-input pf-input--compact grow"
                         [value]="s.label ?? ''"
                         (input)="patchSection(si, { label: $any($event.target).value })"
                         [placeholder]="s.type === 'paragraph' ? 'Section label (e.g. Interpretation, Method / Notes)' : 'Section label (optional)'" />

                  <div class="pf-sec-head__actions">
                    <button type="button" class="pf-icon-btn" [disabled]="si === 0"
                            (click)="moveSection(si, -1)" aria-label="Move up">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                    </button>
                    <button type="button" class="pf-icon-btn" [disabled]="si === sections().length - 1"
                            (click)="moveSection(si, 1)" aria-label="Move down">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                            (click)="removeSection(si)" aria-label="Delete section">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- ───── GRID section body ───── -->
                @if (s.type === 'grid') {
                  <div class="pf-sec-body">
                    @if (gridRows(s).length === 0) {
                      <p class="text-[12px] py-1" style="color: var(--text-tertiary);">No rows yet.</p>
                    }
                    <ul class="pf-row-list">
                      @for (r of gridRows(s); track r.id; let ri = $index) {
                        <li class="pf-grid-row">
                          <div class="flex items-center gap-2">
                            <input type="text" class="pf-input pf-input--compact grow"
                                   [value]="paramRow(r).parameter_name"
                                   (input)="patchGridRow(si, ri, { parameter_name: $any($event.target).value })"
                                   placeholder="Parameter name (e.g. Hemoglobin)" />
                            <button type="button" class="pf-icon-btn" [disabled]="ri === 0"
                                    (click)="moveGridRow(si, ri, -1)" aria-label="Move row up">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                            </button>
                            <button type="button" class="pf-icon-btn" [disabled]="ri === gridRows(s).length - 1"
                                    (click)="moveGridRow(si, ri, 1)" aria-label="Move row down">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                            </button>
                            <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                                    (click)="removeGridRow(si, ri)" aria-label="Delete row">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              </svg>
                            </button>
                          </div>

                          <!-- Per-column cell templates -->
                          <div class="pf-cell-grid">
                            @for (col of cellColumnNames(); track col) {
                              <div class="pf-cell-field">
                                <span class="pf-cell-label">{{ col }}</span>
                                <input type="text" class="pf-input pf-input--mono pf-input--compact"
                                       [value]="paramRow(r).cells[col] || ''"
                                       (input)="patchCell(si, ri, col, $any($event.target).value)"
                                       [placeholder]="cellPlaceholder(col)" />
                              </div>
                            }
                          </div>
                        </li>
                      }
                    </ul>
                    <button type="button" class="pf-link-btn" (click)="addGridRow(si)">+ Add parameter row</button>
                  </div>
                }

                <!-- ───── PARAGRAPH section body ───── -->
                @if (s.type === 'paragraph') {
                  <div class="pf-sec-body">
                    <textarea class="pf-input min-h-[88px]"
                              [value]="paraSection(s).template"
                              (input)="patchSection(si, { template: $any($event.target).value })"
                              placeholder="Free text. Supports {{ '{{placeholders}}' }} — e.g. {{ '{{Hemoglobin}}' }}, {{ '{{Hemoglobin_unit}}' }}, {{ '{{Hemoglobin_range}}' }}."></textarea>
                    <p class="text-[10.5px] mt-1" style="color: var(--text-tertiary);">
                      Use this for interpretation, method or notes. Placeholders resolve from entered results.
                    </p>
                  </div>
                }

              </li>
            }
          </ul>

          <!-- Add-section + save footer -->
          <div class="flex items-center justify-between gap-3 mt-4 flex-wrap">
            <div class="flex items-center gap-2">
              <button type="button" class="pf-link-btn" (click)="addSection('grid')">+ Grid section</button>
              <button type="button" class="pf-link-btn" (click)="addSection('paragraph')">+ Paragraph section</button>
              <button type="button" class="pf-link-btn" (click)="addParagraphPreset('Interpretation')">+ Interpretation</button>
              <button type="button" class="pf-link-btn" (click)="addParagraphPreset('Method / Notes')">+ Method / Notes</button>
            </div>
            <pf-touch-btn size="sm" variant="primary"
                          [disabled]="saving()" (pressed)="save()">
              @if (saving()) { Saving… } @else { Save layout }
            </pf-touch-btn>
          </div>

        } @else {
          <p class="text-center py-6 text-[13px]" style="color: var(--text-tertiary);">
            Select a test to edit its report layout.
          </p>
        }
      </pf-tile>

      <!-- ─────────────── RIGHT: live preview ─────────────── -->
      @if (!hidePreview()) {
      <aside class="xl:sticky xl:top-4 h-fit">
        <div class="flex items-center justify-between mb-2">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
             style="color: var(--text-muted);">
            Live preview {{ previewing() ? '(rendering…)' : '' }}
          </p>
          <button type="button" class="pf-link-btn" [disabled]="!selectedTestId() || previewing()"
                  (click)="refreshPreview()">Refresh</button>
        </div>

        <pf-tile tone="default" padding="lg" class="block">
          @if (!selectedTestId()) {
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              Pick a test to preview its resolved report.
            </p>
          } @else if (previewError()) {
            <p class="text-[12.5px]" style="color: #f87171;">{{ previewError() }}</p>
          } @else if (!preview()) {
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              Save or hit Refresh to render a preview with sample values.
            </p>
          } @else {
            <div class="pf-preview">
              <p class="text-[14px] font-semibold" style="color: var(--text-primary);">
                {{ preview()!.testName }}
              </p>
              @if (preview()!.sampleType) {
                <p class="text-[11px] italic mb-1" style="color: var(--text-tertiary);">
                  {{ preview()!.sampleType }}
                </p>
              }
              <p class="text-[11px] mb-3" style="color: var(--text-muted);">
                {{ preview()!.departmentName }}
              </p>

              @for (sec of preview()!.sections; track sec.id) {
                @if (sec.isVisible) {
                  <div class="pf-prev-sec">
                    @if (sec.label) {
                      <p class="pf-prev-sec__label">{{ sec.label }}</p>
                    }

                    @if (sec.type === 'grid' && sec.rows) {
                      <table class="pf-prev-table">
                        <thead>
                          <tr>
                            @for (vc of previewVCols(); track vc.id) {
                              <th [style.width.%]="vc.width">{{ vc.label }}</th>
                            }
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of sec.rows; track row.id) {
                            <tr>
                              @for (vc of previewVCols(); track vc.id) {
                                <td [style.color]="row.color || null"
                                    [style.font-weight]="row.isBold ? '700' : null">
                                  {{ cellText(row, vc) }}
                                </td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>
                    }

                    @if (sec.type === 'paragraph') {
                      <p class="pf-prev-para">{{ sec.content }}</p>
                    }
                  </div>
                }
              }
            </div>
          }
        </pf-tile>

        <p class="text-[10px] mt-2" style="color: var(--text-tertiary);">
          Preview runs the layout engine with sample result values for this test's parameters.
        </p>
      </aside>
      }
    </div>
  `,
  styles: [`
    .pf-input--compact { padding: 6px 10px; font-size: 12.5px; }
    .pf-input--mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }

    .pf-status-pill {
      display: inline-flex; align-items: center; padding: 4px 10px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; border-radius: 9999px;
      border: 1px solid var(--glass-border);
    }
    .pf-status-pill--ok { background: rgba(16,185,129,0.14); border-color: rgba(16,185,129,0.4); color: #34d399; }
    .pf-status-pill--default { background: rgba(245,158,11,0.10); border-color: rgba(245,158,11,0.32); color: #fbbf24; }

    .pf-sec-list { display: flex; flex-direction: column; gap: 12px; list-style: none; padding: 0; margin: 0; }
    .pf-sec-card { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg); overflow: hidden; }
    .pf-sec-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px dashed var(--glass-border); }
    .pf-sec-head__actions { display: inline-flex; gap: 4px; }
    .pf-sec-head .grow { flex: 1; min-width: 120px; }
    .pf-sec-body { padding: 12px; }

    .pf-sec-badge {
      display: inline-flex; align-items: center; padding: 3px 8px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; border-radius: 7px;
      border: 1px solid var(--glass-border); color: var(--text-muted);
    }
    .pf-sec-badge--grid { background: rgba(59,130,246,0.14); border-color: rgba(59,130,246,0.4); color: #60a5fa; }
    .pf-sec-badge--para { background: rgba(168,85,247,0.14); border-color: rgba(168,85,247,0.5); color: #c4b5fd; }

    .pf-row-list { display: flex; flex-direction: column; gap: 10px; list-style: none; padding: 0; margin: 0 0 8px; }
    .pf-grid-row { padding: 10px; border: 1px solid var(--glass-border); border-radius: 10px; background: rgba(255,255,255,0.02); }
    .pf-grid-row .grow { flex: 1; }

    .pf-cell-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 8px; }
    .pf-cell-field { display: flex; flex-direction: column; gap: 2px; }
    .pf-cell-label { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; }

    .pf-icon-btn {
      width: 26px; height: 26px; flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid var(--glass-border);
      border-radius: 8px; color: var(--text-muted); cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }
    .pf-icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pf-icon-btn--danger:hover:not(:disabled) { color: #f87171; border-color: rgba(244,63,94,0.5); }

    .pf-link-btn { background: transparent; border: 0; padding: 6px 10px; font-size: 12.5px; font-weight: 600; color: #c4b5fd; cursor: pointer; border-radius: 8px; }
    .pf-link-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* ── Additive cross-platform overrides only — desktop-web (>=1280)
         stays byte-identical. ──────────────────────────────────────── */

    /* Gate hovers so touch taps don't stick. */
    @media (hover: hover) {
      .pf-link-btn:hover:not(:disabled) { background: rgba(168,85,247,0.1); }
    }

    /* Coarse pointers: 26px reorder/delete buttons and the small link
       buttons fall below the 44px touch minimum — enlarge hit area only. */
    @media (pointer: coarse) {
      .pf-icon-btn { width: 36px; height: 36px; min-width: 44px; min-height: 44px; }
      .pf-link-btn { min-height: 44px; display: inline-flex; align-items: center; }
    }

    /* Phone (<=640): test picker uses a fixed inline width (260px) that
       can crowd the status pill — let its row wrap and the select fill
       the line. Guard the preview table from pushing the page wide. */
    @media (max-width: 640px) {
      .pf-test-pick { flex: 1 1 100%; }
      :host ::ng-deep .pf-test-pick pf-select { width: 100% !important; }
      .pf-preview { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    }

    .pf-preview { font-size: 12.5px; }
    .pf-prev-sec { margin-top: 12px; }
    .pf-prev-sec__label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 5px; }
    .pf-prev-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .pf-prev-table th { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--glass-border); color: var(--text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .pf-prev-table td { padding: 5px 6px; border-bottom: 1px dashed var(--glass-border); color: var(--text-primary); }
    .pf-prev-para { white-space: pre-wrap; color: var(--text-primary); line-height: 1.55; }
  `]
})
export class TestLayoutEditorComponent implements OnInit {
  /** When embedded in the Report Template shell (which has its own shared PDF
   *  preview on the right), hide this editor's own preview pane and render the
   *  section editor full-width. */
  readonly hidePreview = input(false);

  private readonly api = inject(ApiService);
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);

  protected readonly tests = signal<Test[]>([]);
  protected readonly selectedTestId = signal<string>('');
  protected readonly sections = signal<ReportSection[]>([]);
  protected readonly configured = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  protected readonly preview = signal<ResolvedReportLayout | null>(null);
  protected readonly previewing = signal(false);
  protected readonly previewError = signal<string>('');

  /** Visual columns for the preview table — consecutive LINKED columns merged
   *  into one (Result + Unit → "11.4 g/dL"), keeping the first column's header.
   *  Mirrors the PDF renderer so the preview matches the printed report. */
  protected readonly previewVCols = computed<{ id: string; label: string; width: number; members: ReportColumn[] }[]>(() => {
    let cols = (this.preview()?.columns ?? []).slice();
    // Default-merge an adjacent Result→Unit when no link is configured yet.
    if (!cols.some(c => c.linkedNext)) {
      const ri = cols.findIndex(c => c.type === 'result');
      if (ri >= 0 && cols[ri + 1]?.type === 'unit') {
        cols = cols.map((c, i) => (i === ri ? { ...c, linkedNext: true } : c));
      }
    }
    const out: { id: string; label: string; width: number; members: ReportColumn[] }[] = [];
    for (let i = 0; i < cols.length; i++) {
      const members: ReportColumn[] = [cols[i]];
      while (cols[i]?.linkedNext && i + 1 < cols.length) { members.push(cols[++i]); }
      out.push({ id: members[0].id, label: members[0].label, width: members.reduce((s, m) => s + (m.width || 0), 0), members });
    }
    return out;
  });

  /** Merged cell text for a row across a visual column's members. */
  protected cellText(row: ResolvedRow, vc: { members: ReportColumn[] }): string {
    return vc.members
      .map(m => row.cells[m.name])
      .filter(v => v != null && String(v).trim() !== '')
      .map(v => String(v).trim())
      .join(' ');
  }

  /** Default column names a grid row exposes cell templates for. Matches the
   *  default department column set; admins can leave cells blank to fall back
   *  to engine-resolved values (result/unit/range pull automatically). */
  private static readonly DEFAULT_CELL_COLUMNS = ['specimen', 'result', 'unit', 'range', 'description'];

  testOptions(): PfSelectOption[] {
    return this.tests().map(t => ({
      value: t.id,
      label: t.name + (t.code ? ' · ' + t.code : ''),
    }));
  }

  protected readonly selectedTest = computed<Test | undefined>(() =>
    this.tests().find(t => t.id === this.selectedTestId()));

  ngOnInit() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: list => this.tests.set((list ?? []).filter(t => t.type === 'individual')),
      error: () => this.toasts.error('Failed to load tests'),
    });
  }

  selectTest(testId: string) {
    if (!testId) { this.selectedTestId.set(''); this.sections.set([]); this.preview.set(null); return; }
    this.selectedTestId.set(testId);
    this.preview.set(null);
    this.previewError.set('');
    this.loading.set(true);
    this.layout.getTestLayout(testId).then(res => {
      const sorted = [...(res.sections ?? [])].sort((a, b) => a.order - b.order);
      this.sections.set(sorted);
      this.configured.set(res.configured);
      this.loading.set(false);
      this.refreshPreview();
    }).catch(() => {
      this.sections.set([]);
      this.configured.set(false);
      this.loading.set(false);
      this.toasts.error('Failed to load layout');
    });
  }

  // ── Narrowing helpers for the template ──────────────────
  gridRows(s: ReportSection): GridRow[] { return s.type === 'grid' ? (s as GridSection).rows : []; }
  paramRow(r: GridRow): GridRowParameter { return r as GridRowParameter; }
  paraSection(s: ReportSection): ParagraphSection { return s as ParagraphSection; }

  cellColumnNames(): string[] {
    // Prefer the columns the engine actually resolved (preview reflects the
    // department's configured columns); fall back to defaults.
    const fromPreview = this.preview()?.columns?.map(c => c.name);
    return (fromPreview && fromPreview.length > 0)
      ? fromPreview
      : TestLayoutEditorComponent.DEFAULT_CELL_COLUMNS;
  }

  cellPlaceholder(col: string): string {
    if (col === 'result') return '{{value}} or blank → auto';
    if (col === 'unit') return 'blank → auto';
    if (col === 'range') return 'blank → auto';
    return '{{placeholder}}';
  }

  // ── Section mutations ───────────────────────────────────
  private newId(prefix: string): string {
    return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  patchSection(i: number, patch: { label?: string | null; template?: string }) {
    this.sections.update(arr => {
      const next = [...arr];
      next[i] = { ...next[i], ...patch } as ReportSection;
      return next;
    });
  }

  moveSection(i: number, dir: -1 | 1) {
    const j = i + dir;
    this.sections.update(arr => {
      if (j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return this.reindex(next);
    });
  }

  removeSection(i: number) {
    this.sections.update(arr => this.reindex(arr.filter((_, idx) => idx !== i)));
  }

  addSection(type: 'grid' | 'paragraph') {
    const order = this.sections().length + 1;
    const base = { id: this.newId(type), order, label: null as string | null, conditions: [] };
    const section: ReportSection = type === 'grid'
      ? { ...base, type: 'grid', rows: [] }
      : { ...base, type: 'paragraph', template: '' };
    this.sections.update(arr => [...arr, section]);
  }

  addParagraphPreset(label: string) {
    const order = this.sections().length + 1;
    const section: ParagraphSection = {
      id: this.newId('paragraph'), order, label, conditions: [],
      type: 'paragraph', template: '',
    };
    this.sections.update(arr => [...arr, section]);
  }

  // ── Grid row mutations ──────────────────────────────────
  addGridRow(si: number) {
    this.sections.update(arr => {
      const next = [...arr];
      const sec = next[si] as GridSection;
      const row: GridRowParameter = {
        id: this.newId('row'), parameter_name: '', cells: {}, row_merge: false, conditions: [],
      };
      next[si] = { ...sec, rows: [...sec.rows, row] };
      return next;
    });
  }

  patchGridRow(si: number, ri: number, patch: Partial<GridRowParameter>) {
    this.sections.update(arr => {
      const next = [...arr];
      const sec = next[si] as GridSection;
      const rows = [...sec.rows];
      rows[ri] = { ...rows[ri], ...patch } as GridRow;
      next[si] = { ...sec, rows };
      return next;
    });
  }

  patchCell(si: number, ri: number, col: string, value: string) {
    this.sections.update(arr => {
      const next = [...arr];
      const sec = next[si] as GridSection;
      const rows = [...sec.rows];
      const row = rows[ri] as GridRowParameter;
      rows[ri] = { ...row, cells: { ...row.cells, [col]: value } };
      next[si] = { ...sec, rows };
      return next;
    });
  }

  removeGridRow(si: number, ri: number) {
    this.sections.update(arr => {
      const next = [...arr];
      const sec = next[si] as GridSection;
      next[si] = { ...sec, rows: sec.rows.filter((_, idx) => idx !== ri) };
      return next;
    });
  }

  moveGridRow(si: number, ri: number, dir: -1 | 1) {
    const rj = ri + dir;
    this.sections.update(arr => {
      const next = [...arr];
      const sec = next[si] as GridSection;
      if (rj < 0 || rj >= sec.rows.length) return arr;
      const rows = [...sec.rows];
      [rows[ri], rows[rj]] = [rows[rj], rows[ri]];
      next[si] = { ...sec, rows };
      return next;
    });
  }

  private reindex(arr: ReportSection[]): ReportSection[] {
    return arr.map((s, i) => ({ ...s, order: i + 1 }));
  }

  // ── Save ────────────────────────────────────────────────
  async save() {
    const testId = this.selectedTestId();
    if (!testId) return;
    this.saving.set(true);
    try {
      const payload = this.reindex(this.sections());
      await this.layout.saveTestLayout(testId, payload);
      this.configured.set(true);
      this.toasts.success('Layout saved');
      this.refreshPreview();
    } catch (e: unknown) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Live preview ────────────────────────────────────────
  /** Build sample result values keyed by this test's parameter names so the
   *  engine's result/unit/range columns and {{placeholders}} resolve to
   *  something visible. */
  private sampleValues(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    // Parameters declared on the edited grid rows.
    for (const s of this.sections()) {
      if (s.type !== 'grid') continue;
      for (const r of (s as GridSection).rows) {
        if (!r.row_merge) {
          const name = (r as GridRowParameter).parameter_name?.trim();
          if (name) values[name] = '1.0';
        }
      }
    }
    // Parameters declared on the test entity (so preview works even before
    // grid rows are added).
    const test = this.selectedTest();
    if (test?.parameters) {
      try {
        const parsed = JSON.parse(test.parameters);
        const list: Array<{ name?: string }> = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.parameters) ? parsed.parameters : [];
        for (const p of list) {
          if (p?.name && !(p.name in values)) values[p.name] = '1.0';
        }
      } catch { /* parameters not JSON — ignore */ }
    }
    return values;
  }

  async refreshPreview() {
    const testId = this.selectedTestId();
    if (!testId) return;
    this.previewing.set(true);
    this.previewError.set('');
    try {
      const resolved = await this.layout.preview(testId, this.sampleValues(), [], { sex: 'Female', age: 35 });
      this.preview.set(resolved);
    } catch (e: unknown) {
      this.previewError.set(ApiError.from(e).message);
    } finally {
      this.previewing.set(false);
    }
  }
}
