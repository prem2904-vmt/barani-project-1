import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal, output } from '@angular/core';
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
} from '../../../shared/models/report-layout.model';
import { PreviewProfileMember, ReportPdfPreviewComponent } from './report-pdf-preview.component';
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
  selector: 'pf-test-notes-editor',
  standalone: true,
  imports: [SelectComponent, TileComponent, TouchButtonComponent, LoadingLogoComponent, ReportPdfPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid gap-5 {{ hidePreview() ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-[1.3fr_1fr]' }}">

      <!-- ─────────────── LEFT: section editor ─────────────── -->
      <div class="block" [class.pf-tnotes-card]="!slim()">

        <!-- Test picker + status. The picker disappears when the host already
             knows the test (Test Master); the status pill stays useful. -->
        <div class="flex items-center justify-between flex-wrap gap-3 mb-4" [hidden]="slim()">
          <div class="flex items-center gap-3 pf-test-pick" [hidden]="!!fixedTestId()">
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

          <!-- ── 1 · DESCRIPTION column ─────────────────────────────
               What most departments actually want here: the text printed in
               the report's Description column beside each parameter. -->
          <div class="pf-tl-block">
            <h4 class="pf-tl-h">Description column</h4>
            <p class="pf-tl-hint">
              Printed in the report's <strong>Description</strong> column beside each
              parameter — e.g. what a high or low value means. Leave blank for none.
            </p>
            @for (name of paramNames(); track name) {
              <div class="pf-tl-desc-row">
                <span class="pf-tl-desc-name">{{ name }}</span>
                <input type="text" class="pf-input pf-input--compact grow"
                       [value]="descriptionFor(name)"
                       (input)="setDescription(name, $any($event.target).value)"
                       placeholder="e.g. High in dehydration · Low in anaemia" />
              </div>
            } @empty {
              <p class="text-[12px] py-1" style="color: var(--text-tertiary);">This test has no parameters.</p>
            }
          </div>

          <!-- ── 2 · NOTES & INTERPRETATION paragraphs ─────────────
               Slim mode drops this: Sentence blocks on the print-order
               surface author the same paragraph sections. -->
          @if (!slim()) {
          <div class="pf-tl-block">
            <h4 class="pf-tl-h">Notes &amp; interpretation</h4>
            <p class="pf-tl-hint">
              Free-text paragraphs printed under this test's results. Supports
              placeholders — e.g. {{ '{{Hemoglobin}}' }}, {{ '{{Hemoglobin_range}}' }}.
            </p>
            @for (ps of paragraphSecs(); track ps.s.id) {
              <div class="pf-tl-para">
                <div class="flex items-center gap-2 mb-1">
                  <input type="text" class="pf-input pf-input--compact grow"
                         [value]="ps.s.label ?? ''"
                         (input)="patchSection(ps.si, { label: $any($event.target).value })"
                         placeholder="Heading (e.g. Interpretation)" />
                  <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                          (click)="removeSection(ps.si)" aria-label="Delete note">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    </svg>
                  </button>
                </div>
                <textarea class="pf-input min-h-[72px]"
                          [value]="paraSection(ps.s).template"
                          (input)="patchSection(ps.si, { template: $any($event.target).value })"
                          placeholder="e.g. Values above {{ '{{Hemoglobin_range}}' }} suggest…"></textarea>
              </div>
            }
            <button type="button" class="pf-link-btn" (click)="addParagraphPreset('Interpretation')">+ Add note block</button>
          </div>
          }

          <!-- ── 3 · ADVANCED: raw table layout (kept, tucked away) ── -->
          @if (!slim()) {
          <button type="button" class="pf-tl-adv-toggle press" (click)="showAdvanced.set(!showAdvanced())">
            {{ showAdvanced() ? '▾' : '▸' }} Advanced table layout
            <span class="pf-tl-adv-sub">custom rows &amp; per-cell templates — most tests don't need this</span>
          </button>

          @if (showAdvanced()) {
          <ul class="pf-sec-list">
            @for (s of sections(); track s.id; let si = $index) {
              @if (s.type !== 'paragraph') {
              <li class="pf-sec-card">

                <!-- Section header bar -->
                <div class="pf-sec-head">
                  <span class="pf-sec-badge pf-sec-badge--grid">{{ s.type }}</span>

                  <input type="text" class="pf-input pf-input--compact grow"
                         [value]="s.label ?? ''"
                         (input)="patchSection(si, { label: $any($event.target).value })"
                         placeholder="Section label (optional)" />

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


              </li>
              }
            }
          </ul>
          <button type="button" class="pf-link-btn" (click)="addSection('grid')">+ Custom table section</button>
          }
          }

          <!-- Save footer -->
          <div class="flex items-center justify-end gap-3 mt-4">
            <pf-touch-btn size="sm" variant="primary"
                          [disabled]="saving()" (pressed)="save()">
              @if (saving()) { Saving… } @else { Save }
            </pf-touch-btn>
          </div>

        } @else {
          <p class="text-center py-6 text-[13px]" style="color: var(--text-tertiary);">
            Select a test to edit its report layout.
          </p>
        }
      </div>

      <!-- ─────────────── RIGHT: live preview ───────────────
           The EXACT printed output: the same jsPDF pipeline as the patient
           report, embedded — not an HTML approximation. -->
      @if (!hidePreview()) {
      <aside class="xl:sticky xl:top-4 h-fit">
        <div class="flex items-center justify-between mb-2">
          <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
             style="color: var(--text-muted);">Live preview</p>
          <button type="button" class="pf-link-btn" [disabled]="!selectedTestId()"
                  (click)="refreshPreview()">Refresh</button>
        </div>

        <pf-report-pdf-preview
          [testId]="selectedTestId()"
          [testName]="selectedTest()?.name || ''"
          [parameters]="paramNames()"
          [profileMembers]="profileMembers()"
          [columnsOverride]="columnsOverride()"
          [refreshToken]="previewToken()">
        </pf-report-pdf-preview>

        <p class="text-[10px] mt-2" style="color: var(--text-tertiary);">
          Rendered by the same PDF engine as the patient report — what you see here is the exact print.
        </p>
      </aside>
      }
    </div>
  `,
  styles: [`
    .pf-tnotes-card { border: 1px solid var(--glass-border); border-radius: 16px;
      background: var(--glass-bg); padding: 1.75rem; }
    /* ── Simple-mode blocks ── */
    .pf-tl-block { margin-bottom: 18px; padding: 14px; border: 1px solid var(--glass-border, rgba(148,163,184,0.16));
      border-radius: 14px; background: rgba(255,255,255,0.02); }
    .pf-tl-h { margin: 0 0 2px; font-size: 14px; font-weight: 700; color: var(--text-primary, #e2e8f0); }
    .pf-tl-hint { margin: 0 0 10px; font-size: 12px; line-height: 1.45; color: var(--text-tertiary, #94a3b8); }
    .pf-tl-desc-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .pf-tl-desc-name { flex: 0 0 190px; font-size: 12.5px; font-weight: 600; color: var(--text-secondary, #cbd5e1);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-tl-para { margin-bottom: 12px; }
    .pf-tl-adv-toggle { display: block; width: 100%; text-align: left; margin: 4px 0 10px; padding: 10px 12px;
      border: 1px dashed var(--glass-border, rgba(148,163,184,0.3)); border-radius: 12px; background: transparent;
      font-size: 13px; font-weight: 600; color: var(--text-secondary, #cbd5e1); cursor: pointer; }
    .pf-tl-adv-toggle:hover { border-color: rgba(168,85,247,0.4); }
    .pf-tl-adv-sub { display: block; margin-top: 2px; font-size: 11px; font-weight: 400; color: var(--text-tertiary, #94a3b8); }

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
  
    @media (max-width: 640px) {
      .pf-tl-desc-row { flex-wrap: wrap; }
      .pf-tl-desc-name { flex: 1 1 100%; }
    }
`]
})
export class TestNotesEditorComponent implements OnInit {
  /** When embedded in the Report Template shell (which has its own shared PDF
   *  preview on the right), hide this editor's own preview pane and render the
   *  section editor full-width. */
  readonly hidePreview = input(false);
  /** Slim mode (test editor): ONLY the Description column. Sentences are
   *  authored on the print-order surface and power tools in Advanced —
   *  repeating them here was three surfaces editing the same sections. */
  readonly slim = input(false);
  /** Drive the editor from a KNOWN test (Test Master embeds it inside a test
   *  that is already open) instead of its own dropdown. When set, the picker
   *  row is hidden and the catalogue fetch is skipped entirely. */
  readonly fixedTestId = input<string>('');
  /** Parameter names supplied by the HOST (Test Master has the live form
   *  fields; the embedded editor has no catalogue). Fixes the empty preview /
   *  empty Description list for tests with no saved layout. */
  readonly parameters = input<string[]>([]);
  /** Profile members from the host — lets a PROFILE preview print exactly as
   *  the report does (member rows + profile notes + column override). */
  readonly profileMembers = input<PreviewProfileMember[]>([]);
  /** LIVE per-test column override from the host's columns editor, previewed
   *  before it is saved. */
  readonly columnsOverride = input<ReportColumn[] | null>(null);

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
  /** Bumped to re-render the embedded PDF preview (Refresh / after Save). */
  protected readonly previewToken = signal(0);

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

  constructor() {
    // Host-driven test id: load whenever it changes (and skip the catalogue
    // fetch — the host already resolved the test).
    effect(() => {
      const id = this.fixedTestId();
      if (id && id !== this.selectedTestId()) this.selectTest(id);
    });
  }

  ngOnInit() {
    if (this.fixedTestId()) return;   // embedded: no dropdown to populate
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

  // ── Simple-mode state & helpers ─────────────────────────
  /** Advanced (raw table) editor collapsed by default — most departments only
   *  need the description column + note paragraphs. */
  protected readonly showAdvanced = signal(false);

  /** Paragraph sections with their real index (for patch/remove by index). */
  protected paragraphSecs(): Array<{ s: ReportSection; si: number }> {
    return this.sections().map((s, si) => ({ s, si })).filter(x => x.s.type === 'paragraph');
  }

  /** Parameter names of the selected test (from the test master), used to lay
   *  out the Description-column fields even before any layout exists. */
  protected paramNames(): string[] {
    const host = this.parameters();
    if (host.length > 0) return host;
    const t = this.selectedTest();
    const raw = (t as unknown as { parameters?: unknown })?.parameters;
    if (!raw) return this.gridParamNames();
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;
      const list = (obj['parameters'] ?? obj['fields']) as Array<{ name?: string; label?: string }> | undefined;
      const names = (list ?? []).map(p => (p.name || p.label || '').trim()).filter(Boolean);
      return names.length ? names : this.gridParamNames();
    } catch { return this.gridParamNames(); }
  }
  private gridParamNames(): string[] {
    const g = this.sections().find(s => s.type === 'grid') as GridSection | undefined;
    return (g?.rows ?? []).map(r => (r as GridRowParameter).parameter_name).filter(Boolean);
  }

  /** The Description-column text for one parameter (first grid section). */
  protected descriptionFor(name: string): string {
    const g = this.sections().find(s => s.type === 'grid') as GridSection | undefined;
    const row = (g?.rows ?? []).find(r => (r as GridRowParameter).parameter_name === name) as GridRowParameter | undefined;
    return row?.cells?.['description'] ?? '';
  }

  /** Write the Description cell — creating the grid section / row on demand so
   *  the admin never has to touch the advanced editor for this. */
  protected setDescription(name: string, value: string): void {
    this.sections.update(arr => {
      const next = [...arr];
      let gi = next.findIndex(s => s.type === 'grid');
      if (gi < 0) {
        // No table yet → synthesize one row per test parameter, preserving order.
        const rows: GridRow[] = this.paramNamesFromTest().map(n => ({
          id: this.newId('row'), row_merge: false, parameter_name: n, cells: {},
        }) as unknown as GridRow);
        next.push({ id: this.newId('sec'), type: 'grid', order: next.length, isVisible: true, rows } as unknown as ReportSection);
        gi = next.length - 1;
      }
      const g = { ...(next[gi] as GridSection) };
      g.rows = [...(g.rows ?? [])];
      let ri = g.rows.findIndex(r => (r as GridRowParameter).parameter_name === name);
      if (ri < 0) {
        g.rows.push({ id: this.newId('row'), row_merge: false, parameter_name: name, cells: {} } as unknown as GridRow);
        ri = g.rows.length - 1;
      }
      const row = { ...(g.rows[ri] as GridRowParameter) };
      row.cells = { ...(row.cells ?? {}), description: value };
      g.rows[ri] = row as unknown as GridRow;
      next[gi] = g;
      return next;
    });
  }
  /** Parameter names strictly from the test master (for row synthesis). */
  private paramNamesFromTest(): string[] {
    const host = this.parameters();
    if (host.length > 0) return host;
    const t = this.selectedTest();
    const raw = (t as unknown as { parameters?: unknown })?.parameters;
    if (!raw) return [];
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;
      const list = (obj['parameters'] ?? obj['fields']) as Array<{ name?: string; label?: string }> | undefined;
      return (list ?? []).map(p => (p.name || p.label || '').trim()).filter(Boolean);
    } catch { return []; }
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
      : TestNotesEditorComponent.DEFAULT_CELL_COLUMNS;
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
  /** Fires after a successful save — hosts refresh their live preview. */
  readonly saved = output<void>();
  async save() {
    const testId = this.selectedTestId();
    if (!testId) return;
    this.saving.set(true);
    try {
      const payload = this.reindex(this.sections());
      await this.layout.saveTestLayout(testId, payload);
      this.configured.set(true);
      this.toasts.success('Layout saved');
      this.saved.emit();
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
    // Host-supplied parameter names (the embedded Test Master case, where
    // selectedTest() is empty because the catalogue was never fetched).
    for (const n of this.parameters()) {
      if (n && !(n in values)) values[n] = '1.0';
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
    this.previewToken.update(v => v + 1);   // re-render the embedded PDF
    this.previewing.set(true);
    this.previewError.set('');
    try {
      // Still fetched for cellColumnNames() — the advanced cell-template grid
      // lists the department's resolved column names.
      const resolved = await this.layout.preview(testId, this.sampleValues(), [], { sex: 'Female', age: 35 });
      this.preview.set(resolved);
    } catch (e: unknown) {
      this.previewError.set(ApiError.from(e).message);
    } finally {
      this.previewing.set(false);
    }
  }
}
