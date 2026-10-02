import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  FLAG_CONDITIONS, FLAG_OPERATOR, analyzeLines, lineReach, reachWords, type CondIssue, type CondLine,
} from '../../../shared/utils/flag-conditions';
import type { InsightParam } from '../../../shared/utils/range-insight';
import { mergeStructureOntoLatest, type LooseSection } from '../../../shared/utils/layout-section-merge';
import { sectionsNeedResultsTable, withResultsTableFirst } from '../../../shared/utils/results-table';
import { defaultChartSpec, type ReportChartSpec } from '../../../shared/utils/report-chart/report-chart.model';
import type { ChartEditorContext } from '../../../shared/utils/report-chart/report-chart.sample';
import { ReportChartEditorComponent } from './report-chart-editor.component';
import { ProfileLayoutDesignerComponent } from './profile-layout-designer.component';
import type { ReportColumn, ReportSection } from '../../../shared/models/report-layout.model';

/** One raw layout section as stored — kept as-is so fields this surface
 *  doesn't understand (grid rows, templates, complex conditions…) survive
 *  intact. NOTHING here changes the storage shape: this surface only ever
 *  writes the same sections + conditions JSON the engine already reads. */
type RawSection = Record<string, unknown> & {
  id?: string; type?: string; order?: number; label?: string | null;
  hidden?: boolean; source?: string; template?: string;
  /** Chart block spec (docs/REPORT-CHARTS.md). */
  trend?: unknown;
  conditions?: RawRule[];
};
type RawRule = {
  if?: { parameter?: string; operator?: string; value?: unknown;
         and?: unknown; or?: unknown; has_images?: boolean };
  else?: boolean;
  then?: { show?: boolean; [k: string]: unknown };
  [k: string]: unknown;
};

/** The visibility rule in plain words. 'custom' = conditions this surface
 *  can't express — left untouched, edited in Advanced. */
type CondKind = 'always' | 'when' | 'hide_when' | 'custom';

/**
 * "What prints on the report" — shown as the DOCUMENT it produces, block by
 * block in print order:
 *   · the results table is a real miniature table (its actual columns, the
 *     test's actual parameters, "value" where the result will land);
 *   · a Text block is the sentence itself, typed in place;
 *   · every block can carry an if/else in plain words — "Prints only when
 *     Result is above 180" — stored as the SAME conditions JSON the engine
 *     already evaluates (backend untouched).
 * Reorder with the ↑ / ↓ arrows; every change saves itself. The builder
 * vocabulary stays behind the host's single Advanced link.
 */
@Component({
  selector: 'pf-report-structure',
  standalone: true,
  imports: [FormsModule, SelectComponent, ReportChartEditorComponent, ProfileLayoutDesignerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rsd">
      @if (loading()) {
        <div class="rsd__loading">
          @for (i of [0,1,2]; track i) { <div class="rsd__skel"></div> }
        </div>
      } @else {
        @for (row of rows(); track row.key; let i = $index; let first = $first; let last = $last) {
          <section class="rsd__blk" [class.rsd__blk--off]="row.hidden">
            <header class="rsd__head">
              <span class="rsd__num">{{ i + 1 }}</span>
              @if (renamingKey() === row.key) {
                <input class="rsd__rename" type="text" [ngModel]="renameDraft()"
                       (ngModelChange)="renameDraft.set($event)"
                       (keydown.enter)="commitRename(row)" (blur)="commitRename(row)"
                       (keydown.escape)="renamingKey.set(null)" />
              } @else {
                <span class="rsd__title">{{ row.name }}</span>
                @if (row.canRename) {
                  <button type="button" class="rsd__act" (click)="startRename(row)" title="Rename this block">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                }
              }
              <span class="rsd__grow"></span>
              <button type="button" class="rsd__act" [disabled]="first" (click)="moveRow(row, -1)" title="Print earlier">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
              </button>
              <button type="button" class="rsd__act" [disabled]="last" (click)="moveRow(row, 1)" title="Print later">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              @if (row.canHide) {
                <button type="button" class="rsd__pill press"
                        [class.rsd__pill--on]="!row.hidden"
                        (click)="toggleHidden(row)"
                        [title]="row.hidden ? 'Hidden from the report — tap to print it' : 'Prints on the report — tap to hide it'">
                  {{ row.hidden ? 'Hidden' : 'Prints' }}
                </button>
              } @else {
                <span class="rsd__pill rsd__pill--fixed">always prints</span>
              }
              @if (row.canDelete) {
                <button type="button" class="rsd__act rsd__act--danger" (click)="removeRow(row)" title="Remove this block">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              }
            </header>

            <div class="rsd__body">
              @switch (row.kind) {
                @case ('grid') {
                  <!-- The table itself: its real columns, the real parameters,
                       and where each value will land. -->
                  <div class="rsd__tscroll">
                    <table class="rsd__table">
                      <thead>
                        <tr>@for (c of columnLabels(); track $index) { <th>{{ c }}</th> }</tr>
                      </thead>
                      <tbody>
                        @for (p of shownParams(); track p) {
                          <tr>
                            <td class="rsd__td-name">{{ titleFor(p) }}</td>
                            @for (c of columnLabels().slice(1); track $index) {
                              <td class="rsd__td-val" [class.rsd__td-val--value]="isResultCol(c)">
                                {{ isResultCol(c) ? 'value' : '—' }}
                              </td>
                            }
                          </tr>
                        }
                        @if (moreParams() > 0) {
                          <tr><td class="rsd__td-more" [attr.colspan]="columnLabels().length">+ {{ moreParams() }} more parameter{{ moreParams() === 1 ? '' : 's' }}</td></tr>
                        }
                        @if (shownParams().length === 0) {
                          <tr><td class="rsd__td-more" [attr.colspan]="columnLabels().length">the test's values print here</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <button type="button" class="rsd__link" (click)="customizeColumns.emit()">Change the columns</button>
                  <!-- The Description COLUMN belongs to this table — its
                       per-parameter wording is edited right here. -->
                  <div class="rsd__descslot"><ng-content select="[descriptionEditor]"></ng-content></div>
                }
                @case ('paragraph') {
                  <textarea class="rsd__sentence" rows="2" [ngModel]="row.template || ''"
                            (ngModelChange)="setTemplate(row, $event)"
                            placeholder="Type the sentence that prints — e.g. Kindly correlate clinically."></textarea>
                }
                @case ('culture_line') {
                  <div class="rsd__srcrow">
                    <span class="rsd__srclbl">Shows</span>
                    <pf-select size="sm" [options]="sourceOptions" [value]="row.source || ''"
                               (valueChange)="setSource(row, $event)"></pf-select>
                  </div>
                }
                @case ('culture_ast') {
                  <p class="rsd__note">Organisms and their antibiotic results from the culture bench, with the S / R / M legend. The bench's own checkboxes choose which rows print.</p>
                  <!-- The exact legend the PDF prints under the AST tables. -->
                  <div class="rsd__legend">
                    <p>S - Sensitive (clinically effective at standard therapeutic dose)</p>
                    <p>R - Resistant (clinically ineffective at standard or increased dose)</p>
                    <p>M - Intermediate (may be effective at higher dose or in concentrated body sites)</p>
                    <p>Choice of antimicrobial depends on the clinical status, site of infection, and the drug pharmacokinetics/pharmacodynamics.</p>
                  </div>
                }
                @case ('chart') {
                  @if (row.trend && chartContext()) {
                    <pf-report-chart-editor [value]="row.trend" [title]="row.name" [context]="chartContext()!"
                      (specChange)="setChart(row, $event)" (titleChange)="setChartTitle(row, $event)"></pf-report-chart-editor>
                  } @else {
                    <p class="rsd__note">A single-value gauge — fine-tuning lives in the advanced editor below.</p>
                  }
                }
                @case ('image') {
                  <p class="rsd__note">Photos the tech marks “show” at result entry print here.
                    Hidden = they stay in the lab record only — nothing on the PDF.</p>
                }
                @default {
                  <p class="rsd__note">{{ row.hint }} — fine-tuning lives in the advanced editor below.</p>
                }
              }

              <!-- If / else, in plain words. Grid always prints; complex rules
                   stay untouched behind Advanced. -->
              @if (row.canHide && row.kind !== 'culture_line' && row.kind !== 'culture_ast') {
                <div class="rsd__when">
                  @if (condKind(row) === 'custom') {
                    <span class="rsd__when-custom">Has custom print rules — edit them in the Advanced editor below.</span>
                  } @else {
                    <span class="rsd__when-lbl">Prints</span>
                    <div class="rsd__when-sel"><pf-select size="sm" [options]="whenModeOptions" [value]="condKind(row)"
                               (valueChange)="setCondMode(row, $any($event))"></pf-select></div>
                    @if (condKind(row) !== 'always') {
                      <div class="rsd__when-sel"><pf-select size="sm" [options]="paramOptions()" [value]="cond(row).parameter"
                                 (valueChange)="setCondField(row, { parameter: $any($event) })"></pf-select></div>
                      <div class="rsd__when-sel rsd__when-sel--op"><pf-select size="sm" [options]="opOptions" [value]="opChoice(row)"
                                 (valueChange)="setOpChoice(row, $any($event))"></pf-select></div>
                      @if (!isFlagOp(row)) {
                        <input class="rsd__when-val" type="text" placeholder="value"
                               [ngModel]="cond(row).value" (ngModelChange)="setCondField(row, { value: $event })" />
                      }
                    }
                  }
                </div>
                @if (condKind(row) === 'when' || condKind(row) === 'hide_when') {
                  @if (reachHint(row); as hint) { <p class="rsd__reach">{{ hint }}</p> }
                  @for (m of rowIssues(row); track $index) {
                    <p class="rsd__issue" [class.rsd__issue--err]="m.severity === 'error'">{{ m.message }}</p>
                  }
                }
              }
            </div>
          </section>
        }

        <div class="rsd__foot">
          <div class="rsd__addwrap">
            <button type="button" class="rsd__add" (click)="addOpen.set(!addOpen())" [attr.aria-expanded]="addOpen()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add to the report
            </button>
            @if (addOpen()) {
              <div class="rsd__addmenu" role="menu">
                <button type="button" role="menuitem" (click)="addSection('paragraph')">
                  <strong>Sentence</strong><span>A fixed or conditional line — "Kindly correlate clinically."</span>
                </button>
                <button type="button" role="menuitem" (click)="addSection('image')">
                  <strong>Images</strong><span>Attachments captured with the result</span>
                </button>
                @if (!culture() && chartContext()) {
                  <button type="button" role="menuitem" (click)="addSection('chart')">
                    <strong>Chart</strong><span>Line, bar or dots — time points or chosen values</span>
                  </button>
                }
                @if (culture()) {
                  <button type="button" role="menuitem" (click)="addSection('culture_line')">
                    <strong>Report line</strong><span>Gram stain, growth, notes — any bench finding</span>
                  </button>
                  <button type="button" role="menuitem" (click)="addSection('culture_ast')">
                    <strong>Sensitivity table</strong><span>Organisms &amp; antibiotics (AST)</span>
                  </button>
                }
              </div>
            }
          </div>
          <span class="rsd__savestate" aria-live="polite">
            @if (saving()) { Saving… } @else if (savedTick()) {
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              Saved
            }
          </span>
        </div>

        @if (isProfile()) {
          <section class="rsd__onepage">
            <pf-profile-layout-designer
              [sections]="$any(rawSections() ?? [])"
              [resolvedColumns]="resolvedColumns()"
              [availableAnalyzerCodes]="availableAnalyzerCodes()"
              [hasDefault]="true"
              (sectionsChange)="onPageLayoutChange($event)"
              (restoreDefault)="onRestoreDefault()" />
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .rsd { display: flex; flex-direction: column; gap: 8px; }
    .rsd__loading { display: flex; flex-direction: column; gap: 8px; }
    .rsd__skel { height: 64px; border-radius: 12px; background: var(--glass-bg); animation: rsd-pulse 1.2s ease-in-out infinite; }
    @keyframes rsd-pulse { 50% { opacity: .45; } }

    .rsd__blk { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg);
      transition: border-color .15s, opacity .15s; }
    .rsd__blk--off { opacity: .55; }
    .rsd__blk--off .rsd__title { text-decoration: line-through; text-decoration-color: var(--text-tertiary); }

    .rsd__head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 6px; }
    .rsd__num { width: 22px; height: 22px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 7px; background: rgba(124,58,237,.14); color: var(--violet-text, #a78bfa);
      font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .rsd__title { font-size: 13.5px; font-weight: 700; color: var(--text-primary);
      min-width: 0; overflow-wrap: anywhere; }
    .rsd__grow { flex: 1; }
    .rsd__rename { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary);
      background: var(--bg-secondary, rgba(0,0,0,.25)); border: 1px solid rgba(168,85,247,.5); border-radius: 8px;
      padding: 6px 10px; outline: none; }
    .rsd__act { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
      border-radius: 9px; background: transparent; border: none; color: var(--text-tertiary); cursor: pointer;
      transition: color .15s, background .15s; }
    .rsd__act:disabled { opacity: .3; cursor: default; }
    @media (hover: hover) {
      .rsd__act:not(:disabled):hover { color: var(--text-primary); background: var(--glass-bg-hover, rgba(255,255,255,.06)); }
      .rsd__act--danger:not(:disabled):hover { color: #f87171; background: rgba(244,63,94,.12); }
    }
    .rsd__pill { height: 26px; padding: 0 12px; border-radius: 999px; border: 1px solid; cursor: pointer;
      font-size: 11.5px; font-weight: 700; background: transparent; }
    .rsd__pill--on { color: var(--violet-text, #6d28d9); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 30%, transparent); background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent); }
    .rsd__pill:not(.rsd__pill--on):not(.rsd__pill--fixed) { color: var(--text-tertiary); border-color: var(--glass-border); }
    .rsd__pill--fixed { color: var(--text-tertiary); border-color: transparent; cursor: default; font-weight: 500; }

    .rsd__body { padding: 0 12px 12px 38px; display: flex; flex-direction: column; gap: 10px; }

    /* The miniature results table — light "print" surface, real columns. */
    .rsd__tscroll { overflow-x: auto; }
    .rsd__table { width: 100%; border-collapse: collapse; background: #fff; color: #111;
      border-radius: 10px; overflow: hidden; font-size: 12px; border: 1px solid rgba(0,0,0,.08); }
    .rsd__table th { text-align: left; font-weight: 700; font-size: 11px; padding: 6px 10px;
      background: #f1f5f9; color: #334155; }
    .rsd__table td { padding: 5px 10px; border-top: 1px solid #e8edf3; }
    .rsd__td-name { font-weight: 600; }
    .rsd__td-val { color: #94a3b8; }
    .rsd__td-val--value { font-style: italic; color: #64748b; }
    .rsd__td-more { color: #94a3b8; font-style: italic; }
    .rsd__link { align-self: flex-start; background: none; border: none; padding: 0; font-size: 12.5px;
      font-weight: 600; color: var(--violet-text, #a78bfa); cursor: pointer; }
    .rsd__link:hover { text-decoration: underline; }
    .rsd__descslot:not(:empty) { margin-top: 4px; padding-top: 10px; border-top: 1px dashed var(--glass-border); }

    /* A sentence block IS the sentence. */
    .rsd__sentence { width: 100%; font-size: 13px; line-height: 1.55; color: var(--text-primary);
      background: var(--bg-secondary, rgba(0,0,0,.2)); border: 1px solid var(--glass-border);
      border-radius: 10px; padding: 9px 12px; resize: vertical; }
    .rsd__sentence:focus { outline: none; border-color: rgba(168,85,247,.5); }

    .rsd__srcrow { display: flex; align-items: center; gap: 10px; }
    .rsd__srclbl { font-size: 12px; color: var(--text-tertiary); }
    .rsd__srcrow pf-select { min-width: 260px; }
    .rsd__note { margin: 0; font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; }
    .rsd__legend {
      margin-top: 8px; padding: 8px 10px;
      border: 1px dashed var(--glass-border);
      border-radius: 8px;
    }
    .rsd__legend p { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--text-tertiary); }

    /* If / else, one readable line. */
    .rsd__when { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding-top: 8px; border-top: 1px dashed var(--glass-border); }
    .rsd__when-lbl { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .rsd__when-sel { min-width: 150px; }
    .rsd__when-sel--op { min-width: 130px; }
    .rsd__when-val { width: 90px; height: 32px; padding: 0 10px; border-radius: 9px; font-size: 13px;
      font-weight: 600; text-align: center; color: var(--text-primary);
      background: var(--input-bg, rgba(255,255,255,.03)); border: 1px solid var(--input-border, var(--glass-border)); }
    .rsd__when-val:focus { outline: none; border-color: rgba(168,85,247,.5); }
    .rsd__reach { margin: -2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .rsd__issue { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
    .rsd__issue::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 50%;
      background: #d97706; vertical-align: 1px; }
    .rsd__issue--err { color: #dc2626; }
    .rsd__issue--err::before { background: #dc2626; }
    .rsd__when-sel--op { min-width: 210px; }
    .rsd__when-custom { font-size: 12px; color: var(--text-secondary); }

    .rsd__foot { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
    .rsd__addwrap { position: relative; }
    .rsd__add { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px;
      border-radius: 10px; border: 1px dashed var(--glass-border); background: transparent;
      color: var(--text-secondary); font-size: 12.5px; font-weight: 600; cursor: pointer;
      transition: color .15s, border-color .15s; }
    @media (hover: hover) { .rsd__add:hover { color: var(--text-primary); border-color: rgba(168,85,247,.5); } }
    .rsd__addmenu { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 20; min-width: 300px;
      display: flex; flex-direction: column; padding: 6px; border-radius: 14px;
      background: var(--bg-secondary, #14141f); border: 1px solid var(--glass-border);
      box-shadow: 0 14px 34px rgba(0,0,0,.4); }
    .rsd__addmenu button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
      padding: 8px 12px; border: none; background: none; border-radius: 9px; cursor: pointer; text-align: left; }
    .rsd__addmenu button strong { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .rsd__addmenu button span { font-size: 11.5px; color: var(--text-tertiary); }
    @media (hover: hover) { .rsd__addmenu button:hover { background: var(--glass-bg-hover, rgba(255,255,255,.06)); } }

    .rsd__savestate { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-tertiary); }
    .rsd__savestate svg { color: var(--violet-text, #6d28d9); }
  `],
})
export class ReportStructureComponent {
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);

  readonly testId = input<string>('');
  readonly culture = input<boolean>(false);
  /** "Photos & video at result entry" is ON for this test → the print
   *  order always carries an Images block (the linker: its Prints/Hidden
   *  pill decides whether the tech's shown photos reach the PDF). */
  readonly attachments = input<boolean>(false);
  /** Parameter names — the miniature table's rows + condition parameters. */
  readonly parameters = input<string[]>([]);
  /** name → display title; conditions still store names. */
  readonly parameterTitles = input<Record<string, string>>({});
  /** Values switched off ("Prints on the report" unticked) — excluded from
   *  the miniature table so it mirrors the actual print. */
  readonly hiddenParams = input<string[]>([]);
  titleFor(name: string): string { return this.parameterTitles()[name] || name; }
  /** "Specimen · Result · Unit · Reference range" — the table's columns. */
  readonly columnsSummary = input<string>('');
  /** Bumped by the host after the advanced editor closes → reload. */
  readonly reloadToken = input<number>(0);

  /** What the chart editor knows about this test (time points, values,
   *  ranges) — null hides the Chart option (culture tests). */
  readonly chartContext = input<ChartEditorContext | null>(null);

  readonly changed = output<void>();
  readonly customizeColumns = output<void>();

  // ── Profile one-page layout (owner, 2026-10-02) ───────────────────────
  /** Only a profile/package gets the one-page layout designer — a single
   *  test's report is one block already. */
  readonly isProfile = input<boolean>(false);
  readonly resolvedColumns = input<ReportColumn[]>([]);
  readonly availableAnalyzerCodes = input<string[]>([]);

  onPageLayoutChange(next: ReportSection[]): void {
    this.commit(next as unknown as RawSection[], { debounce: true });
  }
  async onRestoreDefault(): Promise<void> {
    const id = this.testId();
    if (!id) return;
    try {
      const res = await this.layout.restorePageLayoutDefault(id);
      if (!res) { this.toasts.info('No default one-page layout is available for this profile.'); return; }
      this.rawSections.set((res.sections as unknown as RawSection[]) ?? []);
      this.toasts.success('Restored the default one-page layout.');
    } catch {
      this.toasts.error('Could not restore the default layout — check the connection and try again.');
    }
  }

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedTick = signal(false);
  readonly addOpen = signal(false);
  readonly renamingKey = signal<string | null>(null);
  readonly renameDraft = signal('');

  /** Raw stored sections (null = no saved layout → implicit structure). */
  /** protected, not private: the template passes it straight to
   *  pf-profile-layout-designer's [sections] input. */
  protected readonly rawSections = signal<RawSection[] | null>(null);

  /** The test records values of its OWN (an individual test — not a
   *  profile/package, whose members print their values). Its results table
   *  is then part of every saved print order: it can be moved, never
   *  deleted (patient-safety RCA 2026-09-27 — a Sentence-only save dropped
   *  the RESULT from the report). */
  readonly recordsValues = input<boolean>(false);
  /** The values that print ("Prints on the report" on) — the mw rule. */
  private readonly printingValues = computed<string[]>(() => {
    if (!this.recordsValues() || this.culture()) return [];
    const hidden = new Set(this.hiddenParams());
    return this.parameters().filter(p => !hidden.has(p));
  });
  /** A stored print order (e.g. Sentence-only, saved before the fix) that
   *  lacks the table this test needs → it is shown and saved FIRST. */
  private readonly missingTable = computed(() => {
    const raw = this.rawSections();
    return !!raw && sectionsNeedResultsTable(raw, this.printingValues());
  });

  constructor() {
    effect(() => {
      const id = this.testId();
      this.reloadToken();      // reload after the advanced editor closes
      if (!id) { this.loading.set(false); return; }
      void this.load(id);
    });
  }

  private async load(id: string) {
    this.loading.set(true);
    try {
      const res = await this.layout.getTestLayout(id);
      const secs = (res?.sections as unknown as RawSection[] | undefined) ?? [];
      this.rawSections.set(secs.length ? [...secs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : null);
    } catch {
      this.rawSections.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  // ── The miniature table ────────────────────────────────────
  readonly columnLabels = computed<string[]>(() => {
    const s = this.columnsSummary().trim();
    const parts = s ? s.split('·').map(x => x.trim()).filter(Boolean) : [];
    return parts.length >= 2 ? parts : ['Investigation', 'Result', 'Unit', 'Reference range'];
  });
  private static readonly MAX_PREVIEW_ROWS = 6;
  readonly shownParams = computed(() => {
    const hidden = new Set(this.hiddenParams());
    return this.parameters().filter(p => !hidden.has(p)).slice(0, ReportStructureComponent.MAX_PREVIEW_ROWS);
  });
  readonly moreParams = computed(() => {
    const hidden = new Set(this.hiddenParams());
    return Math.max(0, this.parameters().filter(p => !hidden.has(p)).length - ReportStructureComponent.MAX_PREVIEW_ROWS);
  });
  isResultCol(label: string): boolean { return /result/i.test(label); }

  // ── If / else, in plain words ──────────────────────────────
  readonly whenModeOptions: PfSelectOption[] = [
    { value: 'always', label: 'always' },
    { value: 'when', label: 'only when…' },
    { value: 'hide_when', label: 'except when…' },
  ];
  /** Numeric compares, then the flag choices (stored as the engine's
   *  `operator: 'flag'`, value = the choice — see flag-conditions.ts). */
  readonly opOptions: PfSelectOption[] = [
    { value: '>', label: 'is above' },
    { value: '<', label: 'is below' },
    { value: '>=', label: 'is at least' },
    { value: '<=', label: 'is at most' },
    { value: '=', label: 'equals' },
    { value: '!=', label: 'is not' },
    ...FLAG_CONDITIONS.map(o => ({ value: 'flag:' + o.value, label: o.label })),
  ];
  /** Each value's ranges (name → parameter) — what the flag choices read. */
  readonly paramDefs = input<Record<string, InsightParam>>({});
  isFlagOp(row: StructureRow): boolean { return this.cond(row).operator === FLAG_OPERATOR; }
  opChoice(row: StructureRow): string {
    const c = this.cond(row);
    return c.operator === FLAG_OPERATOR ? 'flag:' + c.value : c.operator;
  }
  setOpChoice(row: StructureRow, v: string) {
    if (v.startsWith('flag:')) this.setCondField(row, { operator: FLAG_OPERATOR, value: v.slice(5) });
    else this.setCondField(row, { operator: v, value: this.isFlagOp(row) ? '' : this.cond(row).value });
  }
  private lineOf(row: StructureRow): CondLine {
    const c = this.cond(row);
    return { operator: c.operator, value: this.coerce(c.value), negate: this.condKind(row) === 'hide_when' };
  }
  private defFor(name: string): InsightParam | null {
    const defs = this.paramDefs();
    const k = Object.keys(defs).find(x => x.trim().toLowerCase() === name.trim().toLowerCase());
    return k ? defs[k] : null;
  }
  /** "Prints for High and Critical high results" — from the ranges. */
  reachHint(row: StructureRow): string | null {
    const def = this.defFor(this.cond(row).parameter);
    if (!def?.referenceRanges?.length) return null;
    const reach = lineReach(this.lineOf(row), def);
    if (reach.size === 0) return null;
    return `Prints for ${reachWords(reach)}.`;
  }
  /** Blocks print independently: problems per block (never reached, a flag
   *  the ranges can't produce, blocks that print together). */
  private readonly blockIssues = computed(() => {
    const out = new Map<string, CondIssue[]>();
    const byParam = new Map<string, StructureRow[]>();
    for (const r of this.rows()) {
      const k = this.condKind(r);
      if (k !== 'when' && k !== 'hide_when') continue;
      const name = this.cond(r).parameter.trim().toLowerCase();
      byParam.set(name, [...(byParam.get(name) ?? []), r]);
    }
    byParam.forEach(rows => {
      const issues = analyzeLines(rows.map(r => this.lineOf(r)), this.defFor(this.cond(rows[0]).parameter), 'independent');
      for (const is of issues) {
        const key = rows[is.line].key;
        const blockNo = (k: number) => this.rows().findIndex(x => x.key === rows[k].key) + 1;
        const msg = is.message.replace(/block (\d+)/, (_, n) => `block ${blockNo(Number(n) - 1)}`);
        out.set(key, [...(out.get(key) ?? []), { ...is, message: msg }]);
      }
    });
    return out;
  });
  rowIssues(row: StructureRow): CondIssue[] { return this.blockIssues().get(row.key) ?? []; }
  readonly paramOptions = computed<PfSelectOption[]>(() =>
    this.parameters().map(p => ({ value: p, label: this.titleFor(p) })));

  /** Classify a block's stored conditions into the plain-words model.
   *  Anything richer (nested and/or, colors, variables, several rules)
   *  is 'custom' and NEVER rewritten by this surface. */
  condKind(row: StructureRow): CondKind {
    const c = row.conditions;
    if (!c || c.length === 0) return 'always';
    const simple = (r: RawRule) => {
      const p = r.if;
      const t = r.then ?? {};
      const thenKeys = Object.keys(t).filter(k => t[k] !== undefined);
      return p && p.parameter != null && p.operator != null && p.and == null && p.or == null
        && p.has_images == null && thenKeys.length === 1 && typeof t['show'] === 'boolean';
    };
    if (c.length === 1 && simple(c[0]) && c[0].then?.show === false) return 'hide_when';
    if (c.length === 2 && simple(c[0]) && c[0].then?.show === true
        && c[1].else === true && c[1].then?.show === false
        && Object.keys(c[1].then ?? {}).length === 1) return 'when';
    return 'custom';
  }
  cond(row: StructureRow): { parameter: string; operator: string; value: string } {
    const p = row.conditions?.[0]?.if;
    return {
      parameter: String(p?.parameter ?? this.parameters()[0] ?? ''),
      operator: String(p?.operator ?? '>'),
      value: p?.value == null ? '' : String(p.value),
    };
  }
  setCondMode(row: StructureRow, mode: CondKind) {
    if (mode === 'custom') return;
    const cur = this.cond(row);
    this.mutate(row.key, s => {
      if (mode === 'always') { delete s.conditions; return; }
      const pred = { parameter: cur.parameter || this.parameters()[0] || '',
                     operator: cur.operator, value: this.coerce(cur.value) };
      s.conditions = mode === 'when'
        ? [{ if: pred, then: { show: true } }, { else: true, then: { show: false } }]
        : [{ if: pred, then: { show: false } }];
    });
  }
  setCondField(row: StructureRow, patch: Partial<{ parameter: string; operator: string; value: string }>) {
    const kind = this.condKind(row);
    if (kind !== 'when' && kind !== 'hide_when') return;
    const cur = { ...this.cond(row), ...patch };
    this.mutate(row.key, s => {
      const pred = { parameter: cur.parameter, operator: cur.operator, value: this.coerce(cur.value) };
      s.conditions = kind === 'when'
        ? [{ if: pred, then: { show: true } }, { else: true, then: { show: false } }]
        : [{ if: pred, then: { show: false } }];
    }, { debounce: patch.value !== undefined });
  }
  private coerce(v: string): unknown {
    const n = parseFloat(String(v).replace(',', '.'));
    return String(v).trim() !== '' && Number.isFinite(n) && String(n) === String(v).trim() ? n : v;
  }

  // ── Row view-model ─────────────────────────────────────────
  readonly rows = computed<StructureRow[]>(() => {
    const raw = this.rawSections();
    // Attachments enabled but no Images block saved yet → an implicit one
    // trails the list (mirrors materialised(), which appends it on edit).
    const implicitImage: StructureRow = {
      key: 'implicit-image', kind: 'image', name: 'Images',
      hint: '', hidden: false, canRename: false, canDelete: false,
      canHide: true, implicit: true,
    };
    if (raw) {
      // The profile one-page layout rides in this SAME sections array (no
      // second storage) but is edited only by pf-profile-layout-designer —
      // it must never show as a generic, deletable/hideable block here.
      const out = raw.filter(s => s.type !== 'page_layout').map((s, i) => this.rowFor(s, i));
      // Mirrors materialised(): a missing results table leads the list.
      if (this.missingTable()) out.unshift(this.implicitGridRow());
      if (this.attachments() && !raw.some(s => s.type === 'image')) out.push(implicitImage);
      return out;
    }
    // Implicit structure — what the report prints today without a layout.
    if (this.culture()) {
      const out: StructureRow[] = CLASSIC_CULTURE.map((c, i) => ({
        key: `implicit-${i}`, kind: c.type, name: c.label, hint: c.hint,
        hidden: false, canRename: true, canDelete: c.type !== 'culture_ast',
        canHide: true, source: c.source, implicit: true,
      }));
      if (this.attachments()) out.push(implicitImage);
      return out;
    }
    const out: StructureRow[] = [this.implicitGridRow()];
    if (this.attachments()) out.push(implicitImage);
    return out;
  });

  private implicitGridRow(): StructureRow {
    return { key: 'implicit-grid', kind: 'grid', name: 'Results table',
      hint: '', hidden: false, canRename: false, canDelete: false, canHide: false, implicit: true };
  }

  private rowFor(s: RawSection, i: number): StructureRow {
    const t = s.type ?? '';
    const named: Record<string, string> = {
      grid: 'Results table',
      paragraph: 'Sentence',
      image: 'Images',
      chart: 'Chart',
      culture_line: s.label || this.sourceLabel(s.source ?? ''),
      culture_ast: 'Sensitivity table (AST)',
    };
    return {
      key: s.id ?? `s-${i}`, kind: t,
      name: s.label || named[t] || t || 'Block',
      hint: 'edit in the advanced editor',
      hidden: s.hidden === true,
      canRename: t === 'culture_line' || t === 'paragraph' || t === 'chart',
      canDelete: t !== 'grid',
      canHide: t !== 'grid',
      source: s.source, template: s.template, trend: s.trend,
      conditions: s.conditions, implicit: false,
    };
  }

  readonly sourceOptions: PfSelectOption[] = [
    { value: 'specimen', label: 'Specimen' },
    { value: 'gramStain', label: 'Gram stain (bench findings)' },
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
  sourceLabel(v: string): string {
    return this.sourceOptions.find(o => o.value === v)?.label ?? v ?? '';
  }

  // ── Mutations (all funnel through mutate → materialise + autosave) ──
  startRename(row: StructureRow) {
    this.renameDraft.set(row.name);
    this.renamingKey.set(row.key);
  }
  commitRename(row: StructureRow) {
    if (this.renamingKey() !== row.key) return;
    const v = this.renameDraft().trim();
    this.renamingKey.set(null);
    if (!v || v === row.name) return;
    this.mutate(row.key, s => { s.label = v; });
  }
  toggleHidden(row: StructureRow) {
    this.mutate(row.key, s => { s.hidden = s.hidden === true ? undefined : true; });
  }
  removeRow(row: StructureRow) {
    // The results table is never deleted (only moved) — canDelete hides the
    // button; this guards every other caller too.
    if (!row.canDelete) return;
    this.mutate(row.key, null);
  }
  setSource(row: StructureRow, v: string) {
    this.mutate(row.key, s => { s.source = v; if (!s.label) s.label = this.sourceLabel(v); });
  }
  setTemplate(row: StructureRow, v: string) {
    this.mutate(row.key, s => { s.template = v; }, { debounce: true });
  }
  setChart(row: StructureRow, spec: ReportChartSpec) {
    this.mutate(row.key, s => { s.trend = spec; }, { debounce: true });
  }
  setChartTitle(row: StructureRow, title: string) {
    const v = title.trim();
    this.mutate(row.key, s => { s.label = v || 'Chart'; });
  }
  moveRow(row: StructureRow, dir: -1 | 1) {
    const rows = this.rows();
    const idx = rows.findIndex(r => r.key === row.key);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= rows.length) return;
    const secs = this.materialised();
    const [moved] = secs.splice(idx, 1);
    secs.splice(to, 0, moved);
    this.commit(secs);
  }
  addSection(type: string) {
    this.addOpen.set(false);
    const secs = this.materialised();
    const s: RawSection = { id: newSecId(), type, order: secs.length + 1, conditions: [] };
    if (type === 'culture_line') { s.source = 'clinicalNotes'; s.label = 'Clinical notes'; }
    if (type === 'paragraph') s.template = '';
    if (type === 'chart') {
      const ctx = this.chartContext();
      s.label = 'Chart';
      s.trend = defaultChartSpec({ series: !!ctx?.series, parameters: ctx?.params.map(p => p.name) ?? [] });
    }
    secs.push(s);
    this.commit(secs);
  }

  /** Explicit sections — materialising the implicit structure on first edit.
   *  MUST mirror rows() index-for-index: mutate() maps row → section by
   *  position, so the implicit Images block appends here exactly when it
   *  appends there. */
  private materialised(): RawSection[] {
    const imageSec = (): RawSection => ({ id: newSecId(), type: 'image', order: 0, conditions: [] });
    const raw = this.rawSections();
    if (raw) {
      // The profile one-page layout section (if any) is NOT one of rows()'s
      // displayed blocks (filtered out there — it's edited only by
      // pf-profile-layout-designer) — pulled out here and re-appended LAST
      // so this array stays index-aligned with rows() for mutate()/moveRow()
      // (both position-based), then rides along untouched on save.
      const pageLayoutSec = raw.find(s => s.type === 'page_layout') ?? null;
      let secs = raw.filter(s => s.type !== 'page_layout').map(s => ({ ...s }));
      if (this.missingTable()) secs = withResultsTableFirst(secs, newSecId());
      if (this.attachments() && !secs.some(s => s.type === 'image')) secs.push(imageSec());
      return pageLayoutSec ? [...secs, pageLayoutSec] : secs;
    }
    if (this.culture()) {
      const secs = CLASSIC_CULTURE.map((c, i) => {
        const s: RawSection = { id: newSecId(), type: c.type, order: i + 1, label: c.label, conditions: [] };
        if (c.source) s.source = c.source;
        return s;
      });
      if (this.attachments()) secs.push(imageSec());
      return secs;
    }
    // Normal test: the implicit results table becomes a real grid section
    // with NO stored rows. The test's parameters[] ARE the report rows (single
    // source); a layout stores only rows the admin overrode, keyed by param —
    // a value added to the test later still prints (the engine lists every
    // parameter the layout doesn't).
    const secs: RawSection[] = [{
      id: newSecId(), type: 'grid', order: 1, conditions: [], rows: [],
    }];
    if (this.attachments()) secs.push(imageSec());
    return secs;
  }

  private mutate(key: string, fn: ((s: RawSection) => void) | null, opts?: { debounce?: boolean }) {
    let secs = this.materialised();
    // Implicit rows map onto the freshly materialised set by position.
    const rows = this.rows();
    const idx = rows.findIndex(r => r.key === key);
    if (idx < 0) return;
    if (fn === null) secs = secs.filter((_, i) => i !== idx);
    else if (secs[idx]) fn(secs[idx]);
    this.commit(secs, opts);
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private commit(secs: RawSection[], opts?: { debounce?: boolean }) {
    secs.forEach((s, i) => { s.order = i + 1; });
    this.rawSections.set(secs);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), opts?.debounce ? 700 : 120);
  }
  private async save() {
    const id = this.testId();
    const secs = this.rawSections();
    if (!id || !secs) return;
    this.saving.set(true); this.savedTick.set(false);
    try {
      // The Description column (projected into the results-table block)
      // writes this SAME layout's grid rows. Save on top of the latest stored
      // copy so its descriptions are never erased by this surface's copy
      // (layout-section-merge.ts; owner bug 2026-09-27).
      const latest = ((await this.layout.getTestLayout(id))?.sections ?? []) as unknown as LooseSection[];
      let merged = mergeStructureOntoLatest(latest, secs as LooseSection[]);
      // Last line of defence: what is saved always carries the results
      // table of a test with values (moved, never dropped).
      if (sectionsNeedResultsTable(merged, this.printingValues())) merged = withResultsTableFirst(merged, newSecId());
      merged = merged.map((s, i) => ({ ...s, order: i + 1 }));
      await this.layout.saveTestLayout(id, merged as never);
      this.savedTick.set(true);
      setTimeout(() => this.savedTick.set(false), 2200);
      this.changed.emit();
    } catch {
      this.toasts.error('Could not save the report structure — check the connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }
}

interface StructureRow {
  key: string;
  kind: string;
  name: string;
  hint: string;
  hidden: boolean;
  canRename: boolean;
  canDelete: boolean;
  /** The results table always prints (the report's core). */
  canHide: boolean;
  source?: string;
  template?: string;
  /** A chart block's Test Master spec (docs/REPORT-CHARTS.md). */
  trend?: unknown;
  conditions?: RawRule[];
  implicit: boolean;
}

const CLASSIC_CULTURE: Array<{ type: string; label: string; hint: string; source?: string }> = [
  { type: 'culture_line', label: 'Specimen', hint: 'picked at billing / the bench', source: 'specimen' },
  { type: 'culture_line', label: 'Gram stain', hint: 'bench Gram findings', source: 'gramStain' },
  { type: 'culture_line', label: 'Growth', hint: 'growth-check stage', source: 'growth' },
  { type: 'culture_line', label: 'Colony count', hint: 'when recorded', source: 'colonyCount' },
  { type: 'culture_line', label: 'Organism(s) isolated', hint: 'named isolates', source: 'organisms' },
  { type: 'culture_ast', label: 'Sensitivity table (AST)', hint: 'organisms & antibiotics from the bench' },
  { type: 'culture_line', label: 'Resistance pattern', hint: 'when written', source: 'resistancePattern' },
  { type: 'culture_line', label: 'Intrinsic resistance', hint: 'when written', source: 'intrinsicResistance' },
  { type: 'culture_line', label: 'Clinical notes', hint: 'when written', source: 'clinicalNotes' },
  { type: 'culture_line', label: 'Infection control advice', hint: 'when written', source: 'infectionControlAdvice' },
];

function newSecId(): string {
  return 's-' + Math.random().toString(36).slice(2, 10);
}
