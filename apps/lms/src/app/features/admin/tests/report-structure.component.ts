import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule, CellClickedEvent, CellValueChangedEvent, ColDef,
  ModuleRegistry, RowDragEndEvent,
} from 'ag-grid-community';
import { PfSelectOption } from '../../../shared/primitives/select.component';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { gridThemeDark, gridThemeLight } from './tests/tests.component';
import { RangeSelectEditorComponent } from './test-editor/range-select-editor.component';

ModuleRegistry.registerModules([AllCommunityModule]);

/** One raw layout section as stored — kept as-is so fields this surface
 *  doesn't understand (conditions, grid rows, templates…) survive intact. */
type RawSection = Record<string, unknown> & {
  id?: string; type?: string; order?: number; label?: string | null;
  hidden?: boolean; source?: string; template?: string;
};

/**
 * "What prints on the report" — the print-order surface of the test editor,
 * in the SAME grid language as the reference ranges: one block per row, drag
 * the handle to reorder, edit names and content in place, click Prints to
 * keep a line off the PDF. Every change saves itself.
 *
 * Storage: the SAME per-test layout sections every other part of the system
 * reads. A test with no saved layout shows its implicit structure (results
 * table + notes — or the classic C&S arrangement for cultures); the first
 * real change materialises that structure as sections and carries on.
 * Unknown fields on existing sections are preserved verbatim. The builder
 * vocabulary stays behind the host's single Advanced link.
 */
@Component({
  selector: 'pf-report-structure',
  standalone: true,
  imports: [AgGridAngular],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rs">
      @if (loading()) {
        <div class="rs__loading">
          @for (i of [0,1,2]; track i) { <div class="rs__skel"></div> }
        </div>
      } @else {
        <ag-grid-angular class="rs__grid" [theme]="gridTheme()"
          [rowData]="rows()" [columnDefs]="colDefs" [defaultColDef]="defaultColDef"
          domLayout="autoHeight" [getRowId]="$any(rowId)" [popupParent]="popupParent"
          [singleClickEdit]="true" [stopEditingWhenCellsLoseFocus]="true"
          [rowDragManaged]="true" [suppressMoveWhenRowDragging]="false"
          [rowClassRules]="rowClassRules"
          (rowDragEnd)="onRowDragEnd($event)"
          (cellValueChanged)="onCellChanged($event)"
          (cellClicked)="onCellClicked($event)">
        </ag-grid-angular>

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

    .rs__grid { width: 100%; }
    .rs__grid .ag-cell { cursor: pointer; }
    @media (hover: hover) { .rs__grid .ag-cell:hover { background: rgba(124,58,237,.06); } }
    .rs__grid .rs-off .ag-cell { opacity: .55; }
    .rs__grid .rs-off .rs-name { text-decoration: line-through; text-decoration-color: var(--text-tertiary); }
    .rs-name { font-weight: 600; }
    .rs-detail { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
    .rs-detail__txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rs-detail__txt--dim { color: var(--text-tertiary, #94a3b8); }
    .rs-detail svg { color: var(--text-tertiary, #64748b); flex-shrink: 0; }
    .rs-printed { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .rs-printed--on { color: #34d399; }
    .rs-printed--off { color: var(--text-tertiary, #94a3b8); }
    .rs-printed--always { color: var(--text-tertiary, #94a3b8); font-weight: 500; }
    .rs-del { display: flex; align-items: center; justify-content: center; color: var(--text-tertiary, #64748b); }
    .rs-del:hover { color: #f87171; }

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
  private readonly themeSvc = inject(ThemeService);

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

  // ── Grid plumbing ──────────────────────────────────────────
  readonly gridTheme = computed(() =>
    (this.themeSvc.isDark() ? gridThemeDark : gridThemeLight)
      .withParams({ rowHeight: 48, headerHeight: 42, cellHorizontalPadding: 14 }));
  readonly popupParent: HTMLElement | undefined =
    typeof document !== 'undefined' ? document.body : undefined;
  readonly rowId = (p: { data: StructureRow }) => p.data.key;
  readonly rowClassRules = { 'rs-off': (p: { data?: StructureRow }) => p.data?.hidden === true };
  readonly defaultColDef: ColDef = {
    editable: false, sortable: false, resizable: true, suppressHeaderMenuButton: true,
  };
  private static readonly CHEVRON =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  readonly colDefs: ColDef[] = [
    { field: 'name', headerName: 'Prints as', minWidth: 170, flex: 1.1, rowDrag: true,
      cellClass: 'rs-name',
      editable: p => p.data.canRename === true,
      cellEditor: 'agTextCellEditor' },
    { field: 'details', headerName: 'What it shows', minWidth: 220, flex: 1.7,
      editable: p => p.data.kind === 'culture_line' || p.data.kind === 'paragraph',
      valueGetter: p => p.data.kind === 'culture_line' ? (p.data.source ?? '')
        : p.data.kind === 'paragraph' ? (p.data.template ?? '') : '',
      valueSetter: p => { p.data.details = p.newValue; return true; },
      cellEditorSelector: p => p.data.kind === 'culture_line'
        ? { component: RangeSelectEditorComponent, popup: true,
            params: { options: this.sourceOptions.map(o => ({ value: String(o.value), label: o.label })) } }
        : { component: 'agLargeTextCellEditor', popup: true, params: { maxLength: 4000, rows: 6, cols: 46 } },
      cellRenderer: (p: { data: StructureRow }) => this.detailsHtml(p.data) },
    { field: 'printed', headerName: 'Prints', width: 110, minWidth: 100, maxWidth: 130,
      valueGetter: p => !p.data.hidden,
      cellRenderer: (p: { data: StructureRow }) => {
        if (!p.data.canHide) return '<span class="rs-printed rs-printed--always">always</span>';
        return p.data.hidden
          ? '<span class="rs-printed rs-printed--off">No — hidden</span>'
          : '<span class="rs-printed rs-printed--on">Yes</span>';
      } },
    { colId: 'del', headerName: '', width: 44, maxWidth: 44, resizable: false,
      cellClass: 'rs-del',
      cellRenderer: (p: { data: StructureRow }) => p.data.canDelete
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
        : '' },
  ];

  /** Second column, rendered: what the block shows, plus a chevron when a
   *  click edits it in place. */
  private detailsHtml(r: StructureRow): string {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (r.kind === 'culture_line') {
      const label = this.sourceLabel(r.source ?? '');
      const hint = SOURCE_HINTS[r.source ?? ''] ?? '';
      return `<span class="rs-detail"><span class="rs-detail__txt">${esc(label)}` +
        (hint ? ` <span class="rs-detail__txt--dim">· ${esc(hint)}</span>` : '') +
        `</span>${ReportStructureComponent.CHEVRON}</span>`;
    }
    if (r.kind === 'paragraph') {
      const t = (r.template ?? '').trim();
      return `<span class="rs-detail"><span class="rs-detail__txt${t ? '' : ' rs-detail__txt--dim'}">` +
        `${esc(t || 'tap to write the text that prints')}</span>${ReportStructureComponent.CHEVRON}</span>`;
    }
    if (r.kind === 'grid') {
      return `<span class="rs-detail"><span class="rs-detail__txt rs-detail__txt--dim">` +
        `${esc(this.columnsSummary() || 'every parameter, on the department columns')} — tap to change the columns</span></span>`;
    }
    return `<span class="rs-detail"><span class="rs-detail__txt rs-detail__txt--dim">${esc(r.hint)}</span></span>`;
  }

  onRowDragEnd(e: RowDragEndEvent) {
    const keys: string[] = [];
    e.api.forEachNode(n => { if (n.data) keys.push((n.data as StructureRow).key); });
    const rows = this.rows();
    const order = new Map(rows.map((r, i) => [r.key, i]));
    if (keys.length !== rows.length) return;
    const secs = this.materialised();
    const next = keys.map(k => secs[order.get(k)!]).filter(Boolean);
    this.commit(next);
  }
  onCellChanged(e: CellValueChangedEvent) {
    const row = e.data as StructureRow;
    if (e.colDef.field === 'name') {
      const v = String(e.newValue ?? '').trim();
      if (v) this.mutate(row.key, s => { s.label = v; });
    } else if (e.colDef.field === 'details') {
      const v = String(e.newValue ?? '');
      if (row.kind === 'culture_line') this.mutate(row.key, s => { s.source = v; if (!s.label) s.label = this.sourceLabel(v); });
      else if (row.kind === 'paragraph') this.mutate(row.key, s => { s.template = v; }, { debounce: true });
    }
  }
  onCellClicked(e: CellClickedEvent) {
    const row = e.data as StructureRow | undefined;
    if (!row) return;
    if (e.colDef.field === 'printed' && row.canHide) this.mutate(row.key, s => { s.hidden = s.hidden === true ? undefined : true; });
    else if (e.colDef.colId === 'del' && row.canDelete) this.mutate(row.key, null);
    else if (e.colDef.field === 'details' && row.kind === 'grid') this.customizeColumns.emit();
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

  addSection(type: string) {
    this.addOpen.set(false);
    const secs = this.materialised();
    const s: RawSection = { id: newSecId(), type, order: secs.length + 1, conditions: [] };
    if (type === 'culture_line') { s.source = 'clinicalNotes'; s.label = 'Clinical notes'; }
    if (type === 'paragraph') s.template = '';
    secs.push(s);
    this.commit(secs);
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
  /** Grid-editor scratch cell (valueSetter target); real state lives in sections. */
  details?: string;
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
