import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  COLUMN_TYPE_OPTIONS,
  DEFAULT_RESULT_COLUMNS,
  ReportColumn,
} from '../../../shared/models/report-layout.model';
import { Department } from '../../../shared/models/tenant.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';

/** Emitted to the parent so the live preview reflects the columns being edited
 *  for the selected department before they're even saved. */
export interface ColumnsEditorState {
  departmentName: string;
  departmentCode: string;
  columns: ReportColumn[];
}

/**
 * Per-DEPARTMENT results-table column editor. Pick a department, edit its
 * columns, save (per-department, via /api/report-layout/department/:id). Each
 * department keeps its own layout, so different departments render with
 * different columns in the report.
 *
 * Two interactions drive the rendered report:
 *   • Drag the ⠿ handle to REORDER columns.
 *   • The 🔗 button LINKS a column with the one after it; consecutive linked
 *     columns MERGE into one report cell (Result + Unit → "11.4 g/dL") and the
 *     group keeps the first column's header. Both linked columns highlight.
 */
@Component({
  selector: 'pf-report-columns-editor',
  standalone: true,
  imports: [SkeletonTableComponent, SelectComponent, TouchButtonComponent, DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-ce-root">

      <!-- ── Toolbar: department · status · actions ───────────────
           Host-managed mode (Test Master's per-test override) has no
           department picker and no toolbar — the HOST saves. -->
      @if (!hostManaged()) {
      <div class="pf-ce-bar">
        <pf-select
          style="width: 230px"
          [options]="deptOptions()"
          [value]="selectedDeptId()"
          [placeholder]="departments().length === 0 ? 'Loading…' : 'Department'"
          (valueChange)="selectDepartment($event)">
        </pf-select>
        @if (selectedDeptId()) {
          @if (configured()) { <span class="pf-status-pill pf-status-pill--ok">Configured</span> }
          @else { <span class="pf-status-pill pf-status-pill--default">Defaults — not saved</span> }
        }
        <span class="grow"></span>
        <pf-touch-btn size="sm" variant="secondary" (pressed)="resetToDefaults()">Reset</pf-touch-btn>
        <pf-touch-btn size="sm" variant="secondary"
                      [disabled]="!totalOk() || applyingAll()" (pressed)="applyToAll()">
          {{ applyingAll() ? 'Applying…' : 'Apply to all' }}
        </pf-touch-btn>
        <!-- Secondary: the host page's band owns the ONE primary. -->
        <pf-touch-btn size="sm" variant="secondary"
                      [disabled]="!totalOk() || saving()" (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </div>
      }

      @if (loading()) {
        <div class="flex justify-center py-8">
          <pf-skeleton-table [rows]="6" [cols]="5" label="Loading report columns…"></pf-skeleton-table>
        </div>
      } @else if (selectedDeptId() || hostManaged()) {

        <p class="pf-ce-hint">
          @if (hostManaged()) {
            This strip IS this record's printed table — left to right. Drag a card to
            reorder · tap a card to rename it, choose what it shows, or delete it ·
            tap the link between two cards to merge them into one cell (Result + Unit
            → "11.4 g/dL") · "+ Add column" for a new one. It follows the department's
            layout until you save an override here.
          } @else {
            This strip IS the printed table for <strong>{{ selectedDeptName() }}</strong> — left to right,
            widths to scale. Drag a card to reorder · tap a card to edit it · tap the
            link dot between two cards to merge them into one cell
            (Result + Unit → "11.4 g/dL").
          }
        </p>

        <!-- ── THE STRIP: a live miniature of the report table ───── -->
        <div class="pf-ce-strip" cdkDropList cdkDropListOrientation="horizontal"
             (cdkDropListDropped)="drop($event)">
          @for (c of columns(); track c.id; let i = $index; let last = $last) {
            <div class="pf-ce-col" cdkDrag
                 [style.flexGrow]="c.width || 1"
                 [class.pf-ce-col--on]="selectedIdx() === i"
                 [class.pf-ce-col--linkL]="i > 0 && columns()[i-1].linkedNext"
                 [class.pf-ce-col--linkR]="c.linkedNext && !last"
                 (click)="selectCol(i)">
              <span class="pf-ce-col__label">{{ c.label || '—' }}</span>
              <span class="pf-ce-col__meta">{{ typeLabel(c.type) }}@if (!hostManaged()) { · {{ c.width }}% }</span>
              @if (c.locked) { <span class="pf-ce-col__lock" title="Locked value"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> }
            </div>
            @if (!last) {
              <button type="button" class="pf-ce-chain press"
                      [class.pf-ce-chain--on]="c.linkedNext"
                      (click)="toggleLinkAt(i); $event.stopPropagation()"
                      [title]="c.linkedNext ? 'Unmerge these columns' : 'Merge into one cell'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </button>
            }
          }
        </div>

        <!-- ── Width bar: shares of the printed page width ─────────
             Hidden in host-managed mode (pick + order + rename only —
             widths redistribute proportionally on their own). -->
        @if (!hostManaged()) {
        <div class="pf-ce-widthbar" aria-hidden="true">
          @for (c of columns(); track c.id; let i = $index) {
            <div class="pf-ce-widthseg" [style.flexGrow]="c.width || 1"
                 [class.pf-ce-widthseg--on]="selectedIdx() === i" (click)="selectCol(i)"></div>
          }
        </div>
        <div class="pf-ce-widthrow">
          <span class="pf-ce-total" [class.pf-ce-total--bad]="!totalOk()">
            Total {{ totalWidth() }}%@if (!totalOk()) { <span> · must be 100</span> }
          </span>
          <button type="button" class="pf-link-btn" (click)="distributeEvenly()">Distribute to 100%</button>
          <button type="button" class="pf-link-btn" (click)="addColumn()">+ Add column</button>
        </div>
        } @else {
          <div class="pf-ce-widthrow" style="margin-top: 10px;">
            <button type="button" class="pf-link-btn" (click)="addColumn()">+ Add column</button>
            @if (missingSourceCols().length > 0) {
              <span class="pf-ce-dim">Add back:</span>
              @for (c of missingSourceCols(); track c.name) {
                <button type="button" class="pf-link-btn" (click)="addBack(c)">+ {{ c.label || c.name }}</button>
              }
            }
          </div>
        }

        <!-- ── Inspector: the ONE selected column's details ──────── -->
        @if (selectedCol(); as sc) {
          <div class="pf-ce-inspector">
            <div class="pf-ce-insp-grid">
              <div>
                <label class="pf-label">Column heading</label>
                <!-- Host-managed = RENAME only: patch the label and never
                     re-derive the machine name, which is the cells[name] storage key —
                     changing it would orphan every saved cell template. -->
                @if (hostManaged()) {
                  <input type="text" class="pf-input pf-input--compact"
                         [value]="sc.label ?? ''"
                         (input)="patchCol(selectedIdx()!, { label: $any($event.target).value })" />
                } @else {
                  <input type="text" class="pf-input pf-input--compact"
                         [value]="sc.label ?? ''"
                         (input)="onLabelInput(selectedIdx()!, $any($event.target).value)" />
                }
              </div>
              <div>
                <label class="pf-label">Shows</label>
                <pf-select size="sm" [options]="typeOptions" [value]="sc.type"
                           (valueChange)="patchCol(selectedIdx()!, { type: $any($event) })"></pf-select>
              </div>
              @if (!hostManaged()) {
              <div>
                <label class="pf-label">Width %</label>
                <div class="pf-ce-step">
                  <button type="button" class="pf-ce-step__btn press" (click)="stepWidth(selectedIdx()!, -1)">−</button>
                  <input type="number" class="pf-input pf-input--compact pf-ce-step__num" min="1" max="99"
                         [value]="sc.width"
                         (input)="patchCol(selectedIdx()!, { width: clampWidth($any($event.target).value) })" />
                  <button type="button" class="pf-ce-step__btn press" (click)="stepWidth(selectedIdx()!, 1)">+</button>
                </div>
              </div>
              }
              <div>
                <label class="pf-label">Fixed text (lock)</label>
                <div class="flex items-center gap-2">
                  <button type="button" class="pf-icon-btn press" [class.pf-icon-btn--on]="sc.locked"
                          (click)="patchCol(selectedIdx()!, { locked: !sc.locked })"
                          [title]="sc.locked ? 'Unlock — value resolves automatically' : 'Lock to a fixed text'">
                    @if (sc.locked) {
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    } @else {
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                    }
                  </button>
                  @if (sc.locked) {
                    <input type="text" class="pf-input pf-input--compact grow"
                           [value]="sc.lockedValue ?? ''"
                           (input)="patchCol(selectedIdx()!, { lockedValue: $any($event.target).value })"
                           placeholder="e.g. Blood - EDTA" />
                  } @else {
                    <span class="pf-ce-dim">Auto from results</span>
                  }
                </div>
              </div>
            </div>
            <div class="pf-ce-insp-foot">
              <span class="pf-ce-dim pf-ce-mono">field: {{ sc.name }}</span>
              <button type="button" class="pf-link-btn pf-link-btn--danger"
                      [disabled]="columns().length <= 1"
                      (click)="removeCol(selectedIdx()!)">Delete column</button>
            </div>
          </div>
        } @else {
          <p class="pf-ce-dim mt-3">Tap a column card to edit it.</p>
        }

        <!-- ── SIGNATORIES: who signs this department's report block ──
             Department-scoped — not part of a per-test override. -->
        @if (!hostManaged()) {
        <div class="pf-ce-inspector" style="margin-top: 16px;">
          <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h4 style="margin:0; font-size:13px; font-weight:700; color: var(--text-primary);">Signatories — {{ selectedDeptName() }}</h4>
            <pf-touch-btn size="sm" variant="secondary" [disabled]="sigSaving()" (pressed)="saveSignatories()">
              {{ sigSaving() ? 'Saving…' : 'Save signatories' }}
            </pf-touch-btn>
          </div>
          <p class="pf-ce-dim" style="margin: 0 0 10px;">
            Printed at the end of this department's report section, in this order (drag to reorder, max 7).
            <b>Dynamic</b> = whoever actually did the activity signs; <b>Fixed</b> = always this person.
            The designation you type prints under the name. No rows → the technician + validator sign automatically.
          </p>
          <ul class="pf-sig-list" cdkDropList (cdkDropListDropped)="dropSig($event)">
            @for (s of signatories(); track s._key; let i = $index) {
              <li class="pf-sig-row" cdkDrag>
                <span class="pf-sig-grip" cdkDragHandle><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/></svg></span>
                <span class="pf-sig-pos">{{ i + 1 }}</span>
                <div class="pf-sig-mode">
                  <pf-select size="sm" [options]="sigModeOptions" [value]="s.mode"
                             (valueChange)="patchSig(i, { mode: $any($event) })"></pf-select>
                </div>
                <div class="pf-sig-who">
                  @if (s.mode === 'role') {
                    <pf-select size="sm" [options]="sigRoleOptions" [value]="s.role"
                               (valueChange)="patchSig(i, { role: $any($event) })"></pf-select>
                  } @else {
                    <pf-select size="sm" [searchable]="true" [options]="sigUserOptions()" [value]="s.userId ?? ''"
                               placeholder="— pick a person —"
                               (valueChange)="patchSig(i, { userId: $any($event) || null })"></pf-select>
                  }
                </div>
                <input type="text" class="pf-input pf-input--compact pf-sig-desig"
                       [value]="s.designation" (input)="patchSig(i, { designation: $any($event.target).value })"
                       placeholder="Designation (e.g. Consultant Pathologist)" />
                <button type="button" class="pf-link-btn pf-link-btn--danger" (click)="removeSig(i)" aria-label="Remove signatory"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
              </li>
            } @empty {
              <li class="pf-ce-dim" style="padding: 6px 0;">No slots — the department signs automatically (Tested by + Validated by).</li>
            }
          </ul>
          @if (signatories().length < 7) {
            <button type="button" class="pf-link-btn" (click)="addSig()">+ Add signatory</button>
          }
        </div>
        }

      } @else {
        <p class="text-center py-6 text-[13px]" style="color: var(--text-tertiary);">Select a department to start.</p>
      }
    </div>
  `,
  styles: [`
    .pf-ce-root { display: block; }
    .grow { flex: 1; }
    .pf-ce-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .pf-ce-hint { margin: 0 0 10px; font-size: 11.5px; line-height: 1.5; color: var(--text-tertiary, #94a3b8); }
    .pf-ce-chain-demo { font-size: 11px; }

    /* ── The strip ── */
    .pf-ce-strip { display: flex; align-items: stretch; gap: 0; min-height: 60px; }
    .pf-ce-col {
      position: relative; flex-basis: 0; min-width: 56px;
      display: flex; flex-direction: column; justify-content: center; gap: 2px;
      padding: 8px 9px; cursor: pointer; user-select: none;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25));
      border-radius: 10px; margin: 0 3px;
      background: rgba(255,255,255,0.03);
    }
    .pf-ce-col:hover { border-color: rgba(168,85,247,0.45); }
    .pf-ce-col--on { border-color: var(--violet-500, #8b5cf6); background: rgba(139,92,246,0.12); }
    /* Linked pair reads as ONE joined cell */
    .pf-ce-col--linkR { border-top-right-radius: 0; border-bottom-right-radius: 0; margin-right: 0; border-right-style: dashed; }
    .pf-ce-col--linkL { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: 0; border-left-style: dashed; }
    .pf-ce-col__label { font-size: 12px; font-weight: 700; color: var(--text-primary, #e2e8f0);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-ce-col__meta { font-size: 10px; color: var(--text-tertiary, #94a3b8);
      font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-ce-col__lock { position: absolute; top: 4px; right: 6px; font-size: 10px; }
    .pf-ce-chain {
      align-self: center; flex: 0 0 auto; z-index: 1;
      width: 24px; height: 24px; margin: 0 -1px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.35));
      background: var(--bg-card-solid, #14161e); color: var(--text-tertiary, #94a3b8); cursor: pointer;
    }
    .pf-ce-chain:hover { color: var(--text-primary, #e2e8f0); border-color: rgba(168,85,247,0.5); }
    .pf-ce-chain--on { background: var(--violet-600, #7c3aed); border-color: transparent; color: #fff; }

    /* ── Width bar ── */
    .pf-ce-widthbar { display: flex; gap: 2px; height: 8px; margin: 10px 3px 6px; }
    .pf-ce-widthseg { flex-basis: 0; border-radius: 4px; background: rgba(148,163,184,0.35); cursor: pointer; }
    .pf-ce-widthseg--on { background: var(--violet-500, #8b5cf6); }
    .pf-ce-widthrow { display: flex; align-items: center; gap: 14px; margin: 0 3px 4px; }
    .pf-ce-total { font-size: 12px; font-weight: 600; color: var(--violet-text, #6d28d9); font-variant-numeric: tabular-nums; }
    .pf-ce-total--bad { color: #f87171; }

    /* ── Inspector ── */
    .pf-ce-inspector { margin-top: 10px; padding: 12px; border: 1px solid var(--glass-border, rgba(148,163,184,0.2));
      border-radius: 14px; background: rgba(255,255,255,0.02); }
    .pf-ce-insp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .pf-ce-insp-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
    .pf-ce-step { display: flex; align-items: center; gap: 6px; }
    .pf-ce-step__btn { width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.3)); background: transparent;
      color: var(--text-secondary, #cbd5e1); font-size: 15px; font-weight: 700; }
    .pf-ce-step__num { width: 64px; text-align: center; }
    .pf-ce-dim { font-size: 12px; color: var(--text-tertiary, #94a3b8); }
    .pf-ce-mono { font-variant-numeric: tabular-nums; font-size: 11px; }

    .pf-status-pill { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      padding: 4px 10px; border-radius: 999px; border: 1px solid; white-space: nowrap; }
    .pf-status-pill--ok { color: var(--violet-text, #6d28d9); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 30%, transparent); background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent); }
    .pf-status-pill--default { color: var(--text-secondary); border-color: var(--nd-sel-border); background: var(--nd-sel-bg); }
    .pf-icon-btn { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.3)); background: transparent; color: var(--text-tertiary, #94a3b8); cursor: pointer; }
    .pf-icon-btn--on { color: #fff; background: var(--violet-600, #7c3aed); border-color: transparent; }
    .pf-link-btn { background: none; border: none; padding: 0; font-size: 12.5px; font-weight: 600;
      color: var(--violet-400, #a78bfa); cursor: pointer; }
    .pf-link-btn:hover { color: var(--violet-300, #c4b5fd); }
    .pf-link-btn--danger { color: #f87171; }
    .pf-link-btn:disabled { opacity: 0.4; cursor: default; }

    /* CDK drag ghosts */
    .cdk-drag-preview.pf-ce-col { opacity: 0.9; }
    .cdk-drag-placeholder { opacity: 0.25; }
    .cdk-drop-list-dragging .pf-ce-col { transition: transform 200ms ease; }

    .pf-sig-list { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-sig-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.18)); background: rgba(255,255,255,0.02); }
    .pf-sig-grip { cursor: grab; color: var(--text-tertiary, #94a3b8); }
    .pf-sig-pos { width: 18px; text-align: center; font-size: 11px; font-weight: 700; color: var(--violet-400, #a78bfa);
      font-variant-numeric: tabular-nums; }
    .pf-sig-mode { width: 190px; flex: 0 0 auto; }
    .pf-sig-who { flex: 1; min-width: 150px; }
    .pf-sig-desig { flex: 1; min-width: 150px; }

    @media (pointer: coarse) {
      .pf-ce-chain { width: 32px; height: 32px; }
      .pf-ce-step__btn, .pf-icon-btn { width: 40px; height: 40px; }
    }
  
    /* ── Phone (additive; desktop untouched) ── */
    @media (max-width: 640px) {
      .pf-ce-strip { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .pf-sig-row { flex-wrap: wrap; }
      .pf-sig-mode, .pf-sig-who, .pf-sig-desig { width: 100%; min-width: 0; }
      .pf-ce-bar pf-select { width: 100% !important; }
    }
`],
})
export class ReportColumnsEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);

  /** Emits the live columns + which department they belong to, so the parent's
   *  preview can apply them to that department's sample tests immediately. */
  readonly stateChange = output<ColumnsEditorState>();

  /** HOST-MANAGED mode (Test Master's per-test/per-profile column override):
   *  no department picker, no save toolbar, no signatories, no width knobs —
   *  pick + order + rename only. The host seeds `initialColumns`, listens to
   *  `stateChange`, and does the saving itself. `sourceColumns` (the dept set)
   *  powers the "Add back" chips for re-inserting dropped columns. */
  readonly hostManaged = input(false);
  readonly initialColumns = input<ReportColumn[] | null>(null);
  readonly sourceColumns = input<ReportColumn[]>([]);

  /** Dept columns not currently in the set — offered as "Add back" chips. */
  protected readonly missingSourceCols = computed<ReportColumn[]>(() => {
    if (!this.hostManaged()) return [];
    const have = new Set(this.columns().map(c => c.name));
    return this.sourceColumns().filter(c => !have.has(c.name));
  });

  /** Re-insert a dropped department column; widths re-normalize to 100. */
  addBack(col: ReportColumn) {
    this.setCols(this.normalizeTo100([...this.columns(), { ...col }]));
  }

  /** The initialColumns array reference we've already seeded from — so the seed
   *  effect adopts a NEW host seed exactly once and never re-seeds on an edit. */
  private seededRef: ReportColumn[] | null = null;

  constructor() {
    // Host-managed seed: adopt the host's initialColumns when it hands a
    // genuinely NEW array (opening the editor, or re-seeding after revert).
    //
    // BUG FIX (report-columns discard): the effect's body writes `columns` and
    // then emits it (emitState reads this.columns()), which made `columns` a
    // dependency of the effect — so every user edit (setCols → columns.set)
    // re-fired the effect, re-seeded from initialColumns and silently discarded
    // the rename/reorder (and re-emitted the seed, clobbering the host's live
    // state). Fixed two ways, belt-and-suspenders: (1) a REFERENCE guard so we
    // only seed once per new host array — an edit never changes initialColumns'
    // reference, so it early-returns; (2) untracked() around the writes+emit so
    // `columns` isn't tracked as a dependency at all.
    effect(() => {
      if (!this.hostManaged()) return;
      const seed = this.initialColumns();
      if (!seed || seed === this.seededRef) return;
      this.seededRef = seed;
      untracked(() => {
        const sorted = [...seed]
          .sort((a, b) => a.order - b.order)
          .map(c => ({ ...c, label: c.label ?? '', name: c.name && c.name.trim() ? c.name : this.slugifyName(c.label ?? '') }));
        this.columns.set(this.applyDefaultResultUnitLink(this.ensureNameColumn(sorted)));
        this.selectedIdx.set(null);
        this.emitState();
      });
    });
  }

  protected readonly typeOptions = COLUMN_TYPE_OPTIONS;
  protected readonly departments = signal<Department[]>([]);
  protected readonly selectedDeptId = signal<string>('');
  protected readonly columns = signal<ReportColumn[]>([]);
  protected readonly configured = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly applyingAll = signal(false);

  protected readonly totalWidth = computed(() =>
    this.columns().reduce((s, c) => s + (Number(c.width) || 0), 0)
  );
  protected readonly totalOk = computed(() => Math.abs(this.totalWidth() - 100) < 0.5);

  private selectedDept?: Department;
  selectedDeptName(): string { return this.selectedDept?.name ?? ''; }

  /** The card currently open in the inspector (index into columns()). */
  protected readonly selectedIdx = signal<number | null>(null);
  protected readonly selectedCol = computed<ReportColumn | null>(() => {
    const i = this.selectedIdx();
    return i == null ? null : (this.columns()[i] ?? null);
  });
  selectCol(i: number) { this.selectedIdx.set(this.selectedIdx() === i ? null : i); }

  /** The chain button between card i and i+1 → toggle the merge. */
  toggleLinkAt(i: number) { this.patchCol(i, { linkedNext: !this.columns()[i]?.linkedNext }); }

  stepWidth(i: number, delta: number) {
    const c = this.columns()[i];
    if (!c) return;
    this.patchCol(i, { width: this.clampWidth((Number(c.width) || 0) + delta) });
  }

  /** One tap to make widths legal again (scale to exactly 100). */
  distributeEvenly() { this.setCols(this.normalizeTo100(this.columns())); }

  // ── Signatories (per-department report sign-off slots) ──
  protected readonly users = signal<Array<{ id: string; displayName: string }>>([]);
  protected readonly sigModeOptions = [
    { value: 'role', label: 'Dynamic — by activity' },
    { value: 'user', label: 'Fixed — a person' },
  ];
  protected readonly sigRoleOptions = [
    { value: 'tested_by', label: 'Whoever tested (entered results)' },
    { value: 'validated_by', label: 'Whoever validated' },
  ];
  protected readonly sigUserOptions = computed(() =>
    this.users().map(u => ({ value: u.id, label: u.displayName })));
  protected readonly signatories = signal<Array<{ _key: string; mode: 'role' | 'user'; role: string; userId: string | null; designation: string }>>([]);
  protected readonly sigSaving = signal(false);
  private sigKey(): string { return 's-' + Math.random().toString(36).slice(2, 9); }

  private loadSignatories(deptId: string) {
    this.api.get<Array<{ mode: string; role?: string | null; userId?: string | null; designation?: string }>>(
      `/api/report-layout/department/${deptId}/signatories`).subscribe({
      next: rows => this.signatories.set((rows ?? []).map(r => ({
        _key: this.sigKey(),
        mode: r.mode === 'user' ? 'user' as const : 'role' as const,
        role: r.role || 'tested_by',
        userId: r.userId ?? null,
        designation: r.designation ?? '',
      }))),
      error: () => this.signatories.set([]),
    });
  }
  addSig() {
    if (this.signatories().length >= 7) return;
    this.signatories.update(l => [...l, { _key: this.sigKey(), mode: 'role', role: 'tested_by', userId: null, designation: '' }]);
  }
  removeSig(i: number) { this.signatories.update(l => l.filter((_, idx) => idx !== i)); }
  patchSig(i: number, p: Partial<{ mode: 'role' | 'user'; role: string; userId: string | null; designation: string }>) {
    this.signatories.update(l => l.map((s, idx) => idx === i ? { ...s, ...p } : s));
  }
  dropSig(ev: CdkDragDrop<unknown>) {
    if (ev.previousIndex === ev.currentIndex) return;
    this.signatories.update(l => { const n = l.slice(); moveItemInArray(n, ev.previousIndex, ev.currentIndex); return n; });
  }
  saveSignatories() {
    const deptId = this.selectedDeptId();
    if (!deptId) return;
    this.sigSaving.set(true);
    this.api.post(`/api/report-layout/department/${deptId}/signatories`, {
      signatories: this.signatories().map(s => ({ mode: s.mode, role: s.role, userId: s.userId, designation: s.designation })),
    }).subscribe({
      next: () => { this.sigSaving.set(false); this.toasts.success('Signatories saved'); },
      error: e => { this.sigSaving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  typeLabel(t: string): string {
    return this.typeOptions.find(o => o.value === t)?.label ?? t;
  }

  ngOnInit() {
    if (this.hostManaged()) return;   // host seeds columns; no dept/users fetches
    this.api.get<Array<{ id: string; displayName: string }>>('/api/users/').subscribe({
      next: l => this.users.set((l ?? []).map(u => ({ id: u.id, displayName: u.displayName }))),
      error: () => { /* users list optional */ },
    });
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: list => {
        const depts = this.dedupeByCode(list ?? []);
        this.departments.set(depts);
        if (depts.length > 0 && !this.selectedDeptId()) this.selectDepartment(depts[0].id);
      },
      error: () => this.toasts.error('Failed to load departments')
    });
  }

  /** Departments come one-per-branch; collapse to one entry per code. */
  private dedupeByCode(list: Department[]): Department[] {
    const byKey = new Map<string, Department>();
    for (const d of list) {
      const key = (d.code?.trim() || d.name?.trim() || d.id).toUpperCase();
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, d); continue; }
      if (existing.branchId && !d.branchId) byKey.set(key, d);
    }
    return [...byKey.values()];
  }

  deptOptions(): PfSelectOption[] {
    return this.departments().map(d => ({ value: d.id, label: d.name + (d.code ? ' · ' + d.code : '') }));
  }

  selectDepartment(deptId: string) {
    if (!deptId) { this.selectedDeptId.set(''); return; }
    this.selectedDeptId.set(deptId);
    this.selectedIdx.set(null); // stale card index from the previous department
    this.loadSignatories(deptId);
    this.selectedDept = this.departments().find(d => d.id === deptId);
    this.loading.set(true);
    this.layout.getDeptColumns(deptId).then(res => {
      const sorted = [...res.columns]
        .sort((a, b) => a.order - b.order)
        .map(c => ({ ...c, label: c.label ?? '', name: c.name && c.name.trim() ? c.name : this.slugifyName(c.label ?? '') }));
      this.columns.set(this.applyDefaultResultUnitLink(this.ensureNameColumn(sorted)));
      this.configured.set(res.configured);
      this.loading.set(false);
      this.emitState();
    }).catch(() => {
      this.columns.set(DEFAULT_RESULT_COLUMNS.map(c => ({ ...c })));
      this.configured.set(false);
      this.loading.set(false);
      this.toasts.error('Failed to load columns; showing defaults');
      this.emitState();
    });
  }

  /** When a loaded config has NO merges yet, merge an adjacent Result→Unit by
   *  default so every department shows the unit beside the value ("11.4 g/dL").
   *  Once any link exists the admin's exact choices are kept. */
  private applyDefaultResultUnitLink(cols: ReportColumn[]): ReportColumn[] {
    if (cols.some(c => c.linkedNext)) return cols;
    const ri = cols.findIndex(c => c.type === 'result');
    if (ri >= 0 && cols[ri + 1]?.type === 'unit') {
      return cols.map((c, i) => (i === ri ? { ...c, linkedNext: true } : c));
    }
    return cols;
  }

  /** Guarantee an Investigation (parameter-name) column so the param name shows.
   *  If a loaded config lacks one, prepend it and rescale widths back to 100. */
  private ensureNameColumn(cols: ReportColumn[]): ReportColumn[] {
    if (cols.some(c => c.type === 'name')) return this.normalizeTo100(cols);
    const nameCol: ReportColumn = { id: 'rc-name', name: 'name', label: 'Investigation', order: 0, width: 30, type: 'name', locked: false };
    return this.normalizeTo100([nameCol, ...cols]);
  }

  /** Scale widths so they sum to 100 (backend requires it on save). */
  private normalizeTo100(cols: ReportColumn[]): ReportColumn[] {
    if (cols.length === 0) return cols;
    const sum = cols.reduce((s, c) => s + (Number(c.width) || 0), 0);
    const scaled = cols.map(c => ({ ...c, width: sum > 0 ? Math.round((Number(c.width) || 0) / sum * 100) : Math.round(100 / cols.length) }));
    const diff = 100 - scaled.reduce((s, c) => s + c.width, 0);
    if (diff !== 0) scaled[scaled.length - 1].width += diff;
    return scaled;
  }

  private setCols(cols: ReportColumn[]) {
    const reindexed = cols.map((c, i) => ({ ...c, order: i + 1 }));
    this.columns.set(reindexed);
    this.emitState();
  }

  private emitState() {
    this.stateChange.emit({
      departmentName: this.selectedDept?.name ?? '',
      departmentCode: this.selectedDept?.code ?? '',
      columns: this.columns(),
    });
  }

  patchCol(i: number, patch: Partial<ReportColumn>) {
    this.setCols(this.columns().map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  onLabelInput(i: number, label: string) {
    const cur = this.columns()[i];
    const prevDerived = this.slugifyName(cur.label ?? '');
    const patch: Partial<ReportColumn> = { label };
    if (!cur.name || cur.name === prevDerived) patch.name = this.slugifyName(label);
    this.patchCol(i, patch);
  }

  slugifyName(raw: string): string {
    if (!raw) return '';
    return raw.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  clampWidth(v: unknown): number {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(1, Math.min(99, Math.round(n)));
  }

  drop(event: CdkDragDrop<ReportColumn[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const next = this.columns().slice();
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.setCols(next);
  }

  addColumn() {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `c-${Date.now()}`;
    const existing = new Set(this.columns().map(c => c.name));
    let name = 'new_column';
    let suffix = 2;
    while (existing.has(name)) name = `new_column_${suffix++}`;
    const newCol: ReportColumn = { id, name, label: 'New column', order: this.columns().length + 1, width: 10, type: 'text', locked: false, lockedValue: null };
    this.setCols(this.normalizeTo100([...this.columns(), newCol]));
    this.selectedIdx.set(this.columns().length - 1);
  }

  removeCol(i: number) {
    if (this.columns().length <= 1) return;
    this.selectedIdx.set(null);
    this.setCols(this.normalizeTo100(this.columns().filter((_, idx) => idx !== i)));
  }

  resetToDefaults() {
    this.setCols(DEFAULT_RESULT_COLUMNS.map(c => ({ ...c })));
  }

  /** Save the current column layout to EVERY department, so the same mapping
   *  (e.g. Result + Unit merged) is present across all departments. */
  async applyToAll() {
    if (!this.totalOk()) { this.toasts.error(`Column widths must sum to 100 (got ${this.totalWidth()})`); return; }
    const depts = this.departments();
    if (depts.length === 0) return;
    this.applyingAll.set(true);
    const cols = this.columns().map((c, i) => ({ ...c, order: i + 1 }));
    let ok = 0;
    let lastError = '';
    for (const d of depts) {
      try { await this.layout.saveDeptColumns(d.id, cols); ok++; }
      catch (e: unknown) { lastError = ApiError.from(e).message; /* keep going */ }
    }
    this.applyingAll.set(false);
    if (ok === depts.length) this.toasts.success(`Applied to all ${ok} departments`);
    else this.toasts.error(`Applied to ${ok} of ${depts.length} departments — ${lastError}`);
    this.configured.set(true);
  }

  async save() {
    const deptId = this.selectedDeptId();
    if (!deptId) return;
    if (!this.totalOk()) { this.toasts.error(`Column widths must sum to 100 (got ${this.totalWidth()})`); return; }
    this.saving.set(true);
    try {
      await this.layout.saveDeptColumns(deptId, this.columns().map((c, i) => ({ ...c, order: i + 1 })));
      this.configured.set(true);
      this.toasts.success('Column structure saved');
    } catch (e: unknown) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.saving.set(false);
    }
  }
}
