import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';

/** One raw layout section as stored — kept as-is so fields this surface
 *  doesn't understand (conditions, grid rows, templates…) survive intact. */
type RawSection = Record<string, unknown> & {
  id?: string; type?: string; order?: number; label?: string | null;
  hidden?: boolean; source?: string; template?: string;
};

/**
 * "What prints on the report" — the print-order surface of the test editor.
 *
 * The report, as a list, in the order it prints. Drag to rearrange, tap the
 * eye to keep a line off the PDF, click a name to rename it. Every change
 * saves itself. The builder vocabulary (sections, inspectors, conditions)
 * lives behind the single Advanced link the host renders below this list —
 * this surface is for the person who runs the lab, not the person who
 * built the software.
 *
 * Storage: the SAME per-test layout sections every other part of the system
 * reads. A test with no saved layout shows its implicit structure (results
 * table + notes — or the classic C&S arrangement for cultures) read-only-ish;
 * the first real change materialises that structure as sections and carries
 * on. Unknown fields on existing sections are preserved verbatim.
 */
@Component({
  selector: 'pf-report-structure',
  standalone: true,
  imports: [DragDropModule, FormsModule, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rs">
      @if (loading()) {
        <div class="rs__loading">
          @for (i of [0,1,2]; track i) { <div class="rs__skel"></div> }
        </div>
      } @else {
        <ul class="rs__list" cdkDropList (cdkDropListDropped)="drop($event)">
          @for (row of rows(); track row.key) {
            <li class="rs__row" cdkDrag [cdkDragDisabled]="renamingKey() === row.key"
                [class.rs__row--off]="row.hidden"
                [class.rs__row--open]="expandedKey() === row.key">
              <div class="rs__row-main">
                <span class="rs__grip" cdkDragHandle aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/></svg>
                </span>

                @if (renamingKey() === row.key) {
                  <input class="rs__rename" type="text" [ngModel]="renameDraft()"
                         (ngModelChange)="renameDraft.set($event)"
                         (keydown.enter)="commitRename(row)" (blur)="commitRename(row)"
                         (keydown.escape)="renamingKey.set(null)" />
                } @else {
                  <button type="button" class="rs__name" (click)="toggleExpand(row)"
                          [attr.aria-expanded]="expandedKey() === row.key">
                    <span class="rs__name-txt">{{ row.name }}</span>
                    <span class="rs__hint">{{ row.hint }}</span>
                  </button>
                }

                <span class="rs__row-actions">
                  @if (row.canRename && renamingKey() !== row.key) {
                    <button type="button" class="rs__act" (click)="startRename(row)" title="Rename this line">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                  }
                  @if (row.canHide) {
                  <button type="button" class="rs__act" (click)="toggleHidden(row)"
                          [title]="row.hidden ? 'Hidden from the report — tap to print it' : 'Prints on the report — tap to hide it'"
                          [attr.aria-pressed]="row.hidden">
                    @if (row.hidden) {
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/></svg>
                    } @else {
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                  }
                  @if (row.canDelete) {
                    <button type="button" class="rs__act rs__act--danger" (click)="removeRow(row)" title="Remove this line from the report">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                    </button>
                  }
                </span>
              </div>

              @if (expandedKey() === row.key) {
                <div class="rs__detail">
                  @switch (row.kind) {
                    @case ('culture_line') {
                      <label class="rs__d-lbl">Where its text comes from</label>
                      <pf-select size="sm" [options]="sourceOptions" [value]="row.source || ''"
                                 (valueChange)="setSource(row, $event)"></pf-select>
                    }
                    @case ('paragraph') {
                      <label class="rs__d-lbl">Text printed on the report</label>
                      <textarea class="rs__d-text" rows="3" [ngModel]="row.template || ''"
                                (ngModelChange)="setTemplate(row, $event)"
                                placeholder="e.g. Kindly correlate clinically."></textarea>
                    }
                    @case ('grid') {
                      <p class="rs__d-note">The results table — every parameter of this test, laid out on {{ columnsSummary() || 'the department columns' }}.
                        <button type="button" class="rs__d-link" (click)="customizeColumns.emit()">Change the columns</button>
                      </p>
                    }
                    @case ('culture_ast') {
                      <p class="rs__d-note">Organisms and their antibiotic results from the culture bench, with the S / R / M legend. The bench's own checkboxes choose which rows print.</p>
                    }
                    @default {
                      <p class="rs__d-note">Fine-tuning for this block lives in the advanced editor below.</p>
                    }
                  }
                </div>
              }
            </li>
          }
        </ul>

        <div class="rs__foot">
          <div class="rs__addwrap">
            <button type="button" class="rs__add" (click)="addOpen.set(!addOpen())" [attr.aria-expanded]="addOpen()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add to the report
            </button>
            @if (addOpen()) {
              <div class="rs__addmenu" role="menu">
                <button type="button" role="menuitem" (click)="addSection('paragraph')">
                  <strong>Text</strong><span>A fixed sentence or interpretation note</span>
                </button>
                <button type="button" role="menuitem" (click)="addSection('image')">
                  <strong>Images</strong><span>Attachments captured with the result</span>
                </button>
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
          <span class="rs__savestate" aria-live="polite">
            @if (saving()) { Saving… } @else if (savedTick()) {
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              Saved
            }
          </span>
        </div>
      }
    </div>
  `,
  styles: [`
    .rs { display: block; }
    .rs__loading { display: flex; flex-direction: column; gap: 8px; }
    .rs__skel { height: 46px; border-radius: 12px; background: var(--glass-bg); animation: rs-pulse 1.2s ease-in-out infinite; }
    @keyframes rs-pulse { 50% { opacity: .45; } }

    .rs__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .rs__row {
      border: 1px solid var(--glass-border); border-radius: 12px;
      background: var(--glass-bg);
      transition: border-color .15s, opacity .15s, background .15s;
    }
    .rs__row--off { opacity: .55; }
    .rs__row--off .rs__name-txt { text-decoration: line-through; text-decoration-color: var(--text-tertiary); }
    .rs__row--open { border-color: rgba(168, 85, 247, .4); }
    .rs__row.cdk-drag-preview { box-shadow: 0 12px 28px rgba(0, 0, 0, .35); background: var(--bg-secondary, #14141f); }
    .rs__row.cdk-drag-placeholder { opacity: .25; }
    .cdk-drop-list-dragging .rs__row { transition: transform 200ms cubic-bezier(0, 0, 0.2, 1); }

    .rs__row-main { display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 4px; min-height: 46px; }
    .rs__grip { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 34px;
      color: var(--text-tertiary); cursor: grab; flex-shrink: 0; touch-action: none; }
    .rs__grip:active { cursor: grabbing; }

    .rs__name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px;
      background: none; border: none; padding: 4px 2px; text-align: left; cursor: pointer; }
    .rs__name-txt { font-size: 13.5px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rs__hint { font-size: 11.5px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .rs__rename { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary);
      background: var(--bg-secondary, rgba(0,0,0,.25)); border: 1px solid rgba(168,85,247,.5); border-radius: 8px; padding: 6px 10px; outline: none; }

    .rs__row-actions { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .rs__act { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border-radius: 9px; background: transparent; border: none; color: var(--text-tertiary); cursor: pointer;
      transition: color .15s, background .15s; }
    @media (hover: hover) {
      .rs__act:hover { color: var(--text-primary); background: var(--glass-bg-hover, rgba(255,255,255,.06)); }
      .rs__act--danger:hover { color: #f87171; background: rgba(244,63,94,.12); }
    }

    .rs__detail { padding: 2px 14px 12px 38px; display: flex; flex-direction: column; gap: 6px; }
    .rs__d-lbl { font-size: 11px; font-weight: 600; color: var(--text-tertiary); }
    .rs__d-text { width: 100%; font-size: 13px; color: var(--text-primary); background: var(--bg-secondary, rgba(0,0,0,.2));
      border: 1px solid var(--glass-border); border-radius: 10px; padding: 8px 10px; resize: vertical; }
    .rs__d-text:focus { outline: none; border-color: rgba(168,85,247,.5); }
    .rs__d-note { margin: 0; font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; }
    .rs__d-link { background: none; border: none; padding: 0; margin-left: 6px; font-size: 12.5px; font-weight: 600;
      color: var(--violet-text, #a78bfa); cursor: pointer; }
    .rs__d-link:hover { text-decoration: underline; }

    .rs__foot { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
    .rs__addwrap { position: relative; }
    .rs__add { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px;
      border-radius: 10px; border: 1px dashed var(--glass-border); background: transparent;
      color: var(--text-secondary); font-size: 12.5px; font-weight: 600; cursor: pointer;
      transition: color .15s, border-color .15s; }
    @media (hover: hover) { .rs__add:hover { color: var(--text-primary); border-color: rgba(168,85,247,.5); } }
    .rs__addmenu { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 20; min-width: 280px;
      display: flex; flex-direction: column; padding: 6px; border-radius: 14px;
      background: var(--bg-secondary, #14141f); border: 1px solid var(--glass-border);
      box-shadow: 0 14px 34px rgba(0,0,0,.4); }
    .rs__addmenu button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
      padding: 8px 12px; border: none; background: none; border-radius: 9px; cursor: pointer; text-align: left; }
    .rs__addmenu button strong { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .rs__addmenu button span { font-size: 11.5px; color: var(--text-tertiary); }
    @media (hover: hover) { .rs__addmenu button:hover { background: var(--glass-bg-hover, rgba(255,255,255,.06)); } }

    .rs__savestate { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-tertiary); }
    .rs__savestate svg { color: #34d399; }
  `],
})
export class ReportStructureComponent {
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);

  readonly testId = input<string>('');
  readonly culture = input<boolean>(false);
  /** Parameter names — used when materialising the implicit results table. */
  readonly parameters = input<string[]>([]);
  /** "Specimen · Result · Unit · Reference range" — shown on the table row. */
  readonly columnsSummary = input<string>('');
  /** Bumped by the host after the advanced editor closes → reload. */
  readonly reloadToken = input<number>(0);

  readonly changed = output<void>();
  readonly customizeColumns = output<void>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedTick = signal(false);
  readonly addOpen = signal(false);
  readonly expandedKey = signal<string | null>(null);
  readonly renamingKey = signal<string | null>(null);
  readonly renameDraft = signal('');

  /** Raw stored sections (null = no saved layout → implicit structure). */
  private readonly rawSections = signal<RawSection[] | null>(null);

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

  // ── Row view-model ─────────────────────────────────────────
  readonly rows = computed<StructureRow[]>(() => {
    const raw = this.rawSections();
    if (raw) return raw.map((s, i) => this.rowFor(s, i));
    // Implicit structure — what the report prints today without a layout.
    if (this.culture()) {
      return CLASSIC_CULTURE.map((c, i) => ({
        key: `implicit-${i}`, kind: c.type, name: c.label, hint: c.hint,
        hidden: false, canRename: true, canDelete: c.type !== 'culture_ast',
        canHide: true, source: c.source, implicit: true,
      }));
    }
    return [
      { key: 'implicit-grid', kind: 'grid', name: 'Results table',
        hint: this.columnsSummary() || 'every parameter, on the department columns',
        hidden: false, canRename: false, canDelete: false, canHide: false, implicit: true },
      { key: 'implicit-notes', kind: 'notes', name: 'Notes & description',
        hint: 'edited below', hidden: false, canRename: false, canDelete: false, canHide: false, implicit: true },
    ];
  });

  private rowFor(s: RawSection, i: number): StructureRow {
    const t = s.type ?? '';
    const named: Record<string, { name: string; hint: string }> = {
      grid: { name: 'Results table', hint: this.columnsSummary() || 'every parameter, on the department columns' },
      paragraph: { name: 'Text', hint: (s.template ?? '').toString().slice(0, 60) || 'fixed text on the report' },
      image: { name: 'Images', hint: 'attachments captured with the result' },
      chart: { name: 'Chart', hint: 'edit in the advanced editor' },
      culture_line: { name: s.label || this.sourceLabel(s.source ?? ''), hint: SOURCE_HINTS[s.source ?? ''] ?? '' },
      culture_ast: { name: 'Sensitivity table (AST)', hint: 'organisms & antibiotics from the bench' },
    };
    const d = named[t] ?? { name: s.label || t || 'Block', hint: 'edit in the advanced editor' };
    const name = s.label || d.name;
    return {
      key: s.id ?? `s-${i}`, kind: t, name,
      hint: d.hint.toLowerCase() === name.toLowerCase() ? '' : d.hint,
      hidden: s.hidden === true,
      canRename: t === 'culture_line' || t === 'paragraph',
      canDelete: t !== 'grid',
      canHide: t !== 'grid',
      source: s.source, template: s.template, implicit: false,
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
  toggleExpand(row: StructureRow) {
    this.addOpen.set(false);
    this.expandedKey.set(this.expandedKey() === row.key ? null : row.key);
  }
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
    this.mutate(row.key, null);
  }
  setSource(row: StructureRow, v: string) {
    this.mutate(row.key, s => { s.source = v; if (!s.label) s.label = this.sourceLabel(v); });
  }
  setTemplate(row: StructureRow, v: string) {
    this.mutate(row.key, s => { s.template = v; }, { debounce: true });
  }
  drop(ev: CdkDragDrop<unknown>) {
    if (ev.previousIndex === ev.currentIndex) return;
    const secs = this.materialised();
    moveItemInArray(secs, ev.previousIndex, ev.currentIndex);
    this.commit(secs);
  }
  addSection(type: string) {
    this.addOpen.set(false);
    const secs = this.materialised();
    const s: RawSection = { id: newSecId(), type, order: secs.length + 1, conditions: [] };
    if (type === 'culture_line') { s.source = 'clinicalNotes'; s.label = 'Clinical notes'; }
    if (type === 'paragraph') s.template = '';
    secs.push(s);
    this.commit(secs);
    this.expandedKey.set(s.id!);
  }

  /** Explicit sections — materialising the implicit structure on first edit. */
  private materialised(): RawSection[] {
    const raw = this.rawSections();
    if (raw) return raw.map(s => ({ ...s }));
    if (this.culture()) {
      return CLASSIC_CULTURE.map((c, i) => {
        const s: RawSection = { id: newSecId(), type: c.type, order: i + 1, label: c.label, conditions: [] };
        if (c.source) s.source = c.source;
        return s;
      });
    }
    // Normal test: the implicit results table becomes a real grid section with
    // one row per parameter (mirrors the engine's own default synthesis).
    return [{
      id: newSecId(), type: 'grid', order: 1, conditions: [],
      rows: this.parameters().map(p => ({ id: newSecId(), parameter_name: p, row_merge: false, cells: {} })),
    }];
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
      await this.layout.saveTestLayout(id, secs as never);
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
  /** The results table always prints (the report's core) — its eye is off. */
  canHide: boolean;
  source?: string;
  template?: string;
  implicit: boolean;
}

/** Friendly per-source second lines — what the line MEANS, never an echo
 *  of its name. */
const SOURCE_HINTS: Record<string, string> = {
  specimen: 'picked at billing / the bench',
  gramStain: 'bench Gram findings',
  growth: 'growth-check stage',
  id: 'identification stage',
  colonyCount: 'prints when recorded',
  organisms: 'named isolates',
  resistancePattern: 'prints when written',
  intrinsicResistance: 'prints when written',
  clinicalNotes: 'prints when written',
  infectionControlAdvice: 'prints when written',
  note: 'bench summary line',
};

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
