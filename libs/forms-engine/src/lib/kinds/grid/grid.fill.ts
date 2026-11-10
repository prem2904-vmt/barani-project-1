import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FeDialog, PfIconComponent } from '../../kit';
import { FE_ASSETS, KindFill } from '../../fill/contract';
import { CellPanelAction, CellPanelChip, GridCellPanelComponent } from './grid-cell-panel.component';
import {
  GridAnswer,
  GridCellValue,
  GridLaidCell,
  GridLaidRow,
  GridPreset,
  GridSlot,
  applyChip,
  asAnswer,
  cellValue,
  chipActive,
  chipFits,
  chipText,
  clearAlong,
  fillCount,
  fillFrom,
  gridConfig,
  gridLayout,
  headerBand,
  presetsOf,
  shapePositions,
  valueText,
  withCell,
} from './grid-model';

/** Narrower than this per column and the table turns into one card per row (no sideways scroll, no squeezed taps). */
export const GRID_MIN_COLUMN_PX = 44;
/** A one-tap answer (a choice, Yes / No) moves to the next cell after this pause, so the tick is seen first. */
export const GRID_ADVANCE_MS = 220;

/**
 * Does the table fit this width with every column at least GRID_MIN_COLUMN_PX wide? (`labelChars` null = no label
 * column; width 0 = not measured yet: a table.)
 */
export function fitsAsTable(width: number, labelChars: number | null, columns: number): boolean {
  if (!width) return true;
  const labelPx = labelChars === null ? 0 : Math.max(48, Math.max(labelChars, 3) * 0.8 * 8 + 24);
  return (width - labelPx) / Math.max(1, columns) >= GRID_MIN_COLUMN_PX;
}

type Open = { type: 'cell'; row: number; cell: number } | { type: 'row'; row: number } | { type: 'column'; col: number } | null;

interface CellRef {
  row: number;
  cell: number;
}

/**
 * grid (legacy multi-textbox, grid and shape layouts): rows × columns of small fields — a dental chart, an eye
 * examination, a neurological table. The layout follows the legacy one 1:1 (a framed table: the Quick fill bar and
 * "Include in narrative" on top, the column headings, then one line per row with its label first; every column
 * shares the width, so it fits a phone with no sideways scroll), skinned with the kit. Touch (plan §4): tap a cell
 * and its sheet opens inline under the row with the right input; a choice or Yes / No moves on to the next cell by
 * itself. Quick fill chips above (every cell), on a row label (that row) and on a column heading (that column);
 * "Same for all of …" copies a cell down its column or across its row.
 */
@Component({
  selector: 'fe-grid-fill',
  standalone: true,
  imports: [NgTemplateOutlet, PfIconComponent, GridCellPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.fe-gridk-host]': 'true' },
  template: `
    <div class="fe-gridk" role="group" [attr.aria-labelledby]="labelId()" [class.fe-gridk--off]="!printOn()" [attr.data-layout]="mode()">
      @if (allChips().length || cfg().includeSwitch) {
        <div class="fe-gridk__bar">
          @if (allChips().length) {
            <div class="fe-gridk__qf" role="group" aria-label="Quick fill">
              <span class="fe-gridk__qf-lbl" aria-hidden="true">Quick fill</span>
              @for (c of allChips(); track c.preset.label) {
                <button
                  type="button"
                  class="fe-chip fe-gridk__chip"
                  [attr.data-chip]="c.preset.label"
                  data-scope="all"
                  [attr.aria-pressed]="c.active"
                  [disabled]="disabled()"
                  (click)="chip(c.preset, {}, c.active)"
                >
                  <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                  {{ c.preset.label }}
                </button>
              }
            </div>
          }
          @if (cfg().includeSwitch) {
            <button
              type="button"
              class="fe-chip fe-switchrow fe-gridk__print"
              role="switch"
              data-act="print"
              [attr.aria-checked]="printOn()"
              [disabled]="disabled()"
              (click)="togglePrint()"
            >
              <span class="fe-switchrow__txt">Include in narrative</span>
              <span class="pf-toggle__track fe-switch" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            </button>
          }
        </div>
      }

      @switch (mode()) {
        @case ('shape') {
          <div class="fe-gridk__shape" [attr.data-shape]="cfg().shape?.layout">
            @if (centreUrl()) {
              <div class="fe-gridk__centre" aria-hidden="true"><img [src]="centreUrl()" alt="" /></div>
            }
            @for (p of shapeBoxes(); track p.cell.column) {
              <div class="fe-gridk__pos" [style.left.%]="p.x" [style.top.%]="p.y">
                <span class="fe-gridk__badge" aria-hidden="true">{{ p.n }}</span>
                <ng-container *ngTemplateOutlet="cellTpl; context: { $implicit: p.cell, row: 0, cellIdx: p.idx, showHead: true }" />
              </div>
            }
          </div>
          @if (isOpenRow(0)) {
            <ng-container *ngTemplateOutlet="panelTpl" />
          }
        }
        @case ('stacked') {
          <div class="fe-gridk__stack">
            @for (r of layout().rows; track r.def.key; let ri = $index) {
              <div class="fe-gridk__card" [attr.data-row]="r.def.key">
                @if (r.def.label || groupLabel(ri)) {
                  <ng-container *ngTemplateOutlet="rowLabelTpl; context: { $implicit: r, ri: ri, text: r.def.label || groupLabel(ri) }" />
                }
                <div class="fe-gridk__cardcells">
                  @for (c of r.cells; track c.column; let ci = $index) {
                    <ng-container *ngTemplateOutlet="cellTpl; context: { $implicit: c, row: ri, cellIdx: ci, showHead: true }" />
                  }
                </div>
              </div>
              @if (isOpenRow(ri)) {
                <ng-container *ngTemplateOutlet="panelTpl" />
              }
            }
          </div>
        }
        @default {
          <div class="fe-gridk__table" [style.grid-template-columns]="template()">
            @if (band(); as b) {
              @if (labelCol()) {
                <div class="fe-gridk__corner" [style.grid-row]="1" [style.grid-column]="1" aria-hidden="true"></div>
              }
              @for (g of b; track g.start) {
                <div
                  class="fe-gridk__band"
                  [class.fe-gridk__band--empty]="!g.label"
                  [style.grid-row]="1"
                  [style.grid-column]="colLine(g.start) + ' / span ' + g.span"
                >
                  {{ g.label }}
                </div>
              }
            }
            @if (labelCol()) {
              <div class="fe-gridk__corner fe-gridk__rowhead" [style.grid-row]="headLine()" [style.grid-column]="1">{{ cfg().rowHeader }}</div>
            }
            @for (col of cfg().columns; track col.key; let ci = $index) {
              @if (disabled() || !columnTappable()) {
                <div class="fe-gridk__head" [style.grid-row]="headLine()" [style.grid-column]="colLine(ci)" [attr.data-col]="col.key">{{ col.label }}</div>
              } @else {
                <button
                  type="button"
                  class="fe-gridk__head fe-gridk__head--tap"
                  [style.grid-row]="headLine()"
                  [style.grid-column]="colLine(ci)"
                  [attr.data-col]="col.key"
                  [attr.aria-expanded]="isOpenColumn(ci)"
                  [attr.aria-label]="col.label + ': quick fill or clear this column'"
                  (click)="toggleOpen({ type: 'column', col: ci })"
                >
                  {{ col.label }}
                </button>
              }
            }
            @if (openColumn() !== null) {
              <div class="fe-gridk__panelslot" [style.grid-row]="headLine() + 1" style="grid-column: 1 / -1">
                <ng-container *ngTemplateOutlet="panelTpl" />
              </div>
            }
            @for (r of layout().rows; track r.def.key; let ri = $index) {
              @if (labelCol() && r.labelSpan > 0) {
                <div class="fe-gridk__labslot" [style.grid-row]="rowLine(ri) + ' / span ' + r.labelSpan" [style.grid-column]="1">
                  <ng-container *ngTemplateOutlet="rowLabelTpl; context: { $implicit: r, ri: ri, text: r.def.label }" />
                </div>
              }
              @for (c of r.cells; track c.column; let ci = $index) {
                <div class="fe-gridk__slot" [style.grid-row]="rowLine(ri)" [style.grid-column]="colLine(c.column) + ' / span ' + c.colSpan">
                  <ng-container *ngTemplateOutlet="cellTpl; context: { $implicit: c, row: ri, cellIdx: ci, showHead: false }" />
                </div>
              }
              @if (panelAfter() === ri) {
                <div class="fe-gridk__panelslot" [style.grid-row]="rowLine(ri) + 1" style="grid-column: 1 / -1">
                  <ng-container *ngTemplateOutlet="panelTpl" />
                </div>
              }
            }
          </div>
        }
      }
    </div>

    <ng-template #rowLabelTpl let-r let-ri="ri" let-text="text">
      @if (disabled() || !rowTappable()) {
        <div class="fe-gridk__rowlab" [attr.data-rowlabel]="r.def.key">{{ text }}</div>
      } @else {
        <button
          type="button"
          class="fe-gridk__rowlab fe-gridk__rowlab--tap"
          [attr.data-rowlabel]="r.def.key"
          [attr.aria-expanded]="isOpen({ type: 'row', row: ri })"
          [attr.aria-label]="rowWords(r) + ': quick fill or clear this row'"
          (click)="toggleOpen({ type: 'row', row: ri })"
        >
          {{ text }}
        </button>
      }
    </ng-template>

    <ng-template #cellTpl let-c let-ri="row" let-ci="cellIdx" let-showHead="showHead">
      @if (!c.slots.length) {
        <div class="fe-gridk__cell fe-gridk__cell--none" aria-hidden="true"></div>
      } @else if (disabled()) {
        <div class="fe-gridk__cell fe-gridk__cell--ro" [attr.data-cell]="cellId(ri, c)">
          <ng-container *ngTemplateOutlet="cellBody; context: { $implicit: c, ri: ri, showHead: showHead }" />
        </div>
      } @else {
        <button
          type="button"
          class="fe-gridk__cell"
          [class.fe-gridk__cell--open]="isOpen({ type: 'cell', row: ri, cell: ci })"
          [class.fe-gridk__cell--filled]="filled(ri, c)"
          [attr.data-cell]="cellId(ri, c)"
          [attr.aria-expanded]="isOpen({ type: 'cell', row: ri, cell: ci })"
          [attr.aria-label]="cellWords(ri, c)"
          (click)="toggleOpen({ type: 'cell', row: ri, cell: ci })"
        >
          <ng-container *ngTemplateOutlet="cellBody; context: { $implicit: c, ri: ri, showHead: showHead }" />
        </button>
      }
    </ng-template>

    <ng-template #cellBody let-c let-ri="ri" let-showHead="showHead">
      @if (showHead) {
        <span class="fe-gridk__cellhead">{{ cfg().columns[c.column]?.label }}</span>
      }
      @if (c.slots.length === 1) {
        @if (text(ri, c.slots[0]); as t) {
          <span class="fe-gridk__val">{{ t }}</span>
        } @else {
          <span class="fe-gridk__ph">{{ c.slots[0].field.placeholder || '' }}</span>
        }
      } @else {
        @for (s of c.slots; track s.slot) {
          <span class="fe-gridk__line" [class.fe-gridk__line--empty]="!text(ri, s)">
            <span class="fe-gridk__lk">{{ s.field.label }}</span>
            @if (text(ri, s); as t) {
              <span class="fe-gridk__val">{{ t }}</span>
            }
          </span>
        }
      }
    </ng-template>

    <ng-template #panelTpl>
      @switch (open()?.type) {
        @case ('cell') {
          <fe-grid-cell
            [slots]="openSlots()"
            [values]="openValues()"
            [rowHeader]="cfg().rowHeader ?? ''"
            [chips]="panelChips()"
            [words]="allWords()"
            [canPrev]="navIndex() > 0"
            [canNext]="navIndex() >= 0 && navIndex() < nav().length - 1"
            [rowFill]="rowFill()"
            [columnFill]="columnFill()"
            (act)="onPanel($event)"
          />
        }
        @default {
          <section class="fe-gsheet fe-gsheet--line" data-line-sheet [attr.data-for]="open()?.type" data-no-swipe [attr.aria-label]="lineTitle()">
            <header class="fe-gsheet__head">
              <span class="fe-gsheet__title"><span class="fe-gsheet__what">{{ lineTitle() }}</span></span>
            </header>
            @if (lineChips().length) {
              <div class="fe-chips" role="group" aria-label="Quick fill">
                @for (c of lineChips(); track c.preset.label) {
                  <button
                    type="button"
                    class="fe-chip"
                    [attr.data-chip]="c.preset.label"
                    [attr.data-scope]="c.scope"
                    [attr.aria-pressed]="c.active"
                    (click)="lineChip(c)"
                  >
                    <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                    {{ c.preset.label }}
                  </button>
                }
              </div>
            } @else {
              <p class="fe-field__hint">Tap a cell to fill it in.</p>
            }
            <footer class="fe-gsheet__foot">
              <button type="button" class="pf-btn pf-btn--tertiary" data-act="clear-line" [disabled]="!lineHasAnswers()" (click)="clearLine()">
                <pf-icon name="trash" [size]="18" /> Clear {{ open()?.type === 'row' ? 'this row' : 'this column' }}
              </button>
              <span class="fe-gsheet__spacer"></span>
              <button type="button" class="pf-btn pf-btn--secondary" data-act="done" (click)="open.set(null)">Done</button>
            </footer>
          </section>
        }
      }
    </ng-template>
  `,
})
export class GridFill extends KindFill {
  private readonly dialog = inject(FeDialog);
  private readonly assets = inject(FE_ASSETS);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly cfg = computed(() => gridConfig(this.field()));
  protected readonly layout = computed(() => gridLayout(this.cfg()));
  protected readonly answer = computed(() => asAnswer(this.value()));
  protected readonly printOn = computed(() => this.answer()?.print !== false);
  protected readonly band = computed(() => headerBand(this.cfg()));

  protected readonly open = signal<Open>(null);
  /** The grid's width (ResizeObserver); decides table or one card per row. */
  readonly width = signal(0);

  /** A first column for the row labels (legacy: always, unless the grid is one unlabelled row of boxes). */
  protected readonly labelCol = computed(() => !!this.cfg().rowHeader?.trim() || this.cfg().rows.some((r) => r.label?.trim()));
  private readonly labelChars = computed(() => {
    const labels = [this.cfg().rowHeader ?? '', ...this.cfg().rows.map((r) => r.label ?? '')];
    return Math.min(Math.max(0, ...labels.map((l) => l.length)), 18);
  });
  /** Legacy `gridColumnTemplate`: the label column sized by its longest label (capped), every data column an equal share. */
  protected readonly template = computed(() => {
    const n = this.cfg().columns.length;
    const cols = `repeat(${n}, minmax(0, 1fr))`;
    return this.labelCol() ? `minmax(48px, calc(${Math.max(this.labelChars(), 3)}ch * 0.8 + 24px)) ${cols}` : cols;
  });

  protected readonly mode = computed<'table' | 'stacked' | 'shape'>(() => {
    const shape = this.cfg().shape?.layout;
    if (shape && shape !== 'linear' && this.layout().rows.length === 1) return 'shape';
    return fitsAsTable(this.width(), this.labelCol() ? this.labelChars() : null, this.cfg().columns.length) ? 'table' : 'stacked';
  });

  // ── grid lines (explicit placement: spans + the inline sheet) ──
  protected readonly headLine = computed(() => (this.band() ? 2 : 1));
  protected readonly openColumn = computed(() => {
    const o = this.open();
    return o?.type === 'column' ? o.col : null;
  });
  /** The row the inline sheet sits under: the last row of the tapped row's merged label (never splits a merge). */
  protected readonly panelAfter = computed(() => {
    const o = this.open();
    if (!o || o.type === 'column') return null;
    return this.groupEnd(o.row);
  });
  protected colLine(ci: number): number {
    return ci + (this.labelCol() ? 2 : 1);
  }
  protected rowLine(ri: number): number {
    const base = this.headLine() + 1 + (this.openColumn() !== null ? 1 : 0);
    const after = this.panelAfter();
    return base + ri + (after !== null && ri > after ? 1 : 0);
  }
  private groupEnd(ri: number): number {
    const rows = this.layout().rows;
    let g = ri;
    while (g > 0 && rows[g].labelSpan === 0) g--;
    return g + Math.max(1, rows[g]?.labelSpan ?? 1) - 1;
  }
  /** A row under a merged label (stacked cards repeat the label so each card says what it is). */
  protected groupLabel(ri: number): string {
    const rows = this.layout().rows;
    let g = ri;
    while (g > 0 && rows[g].labelSpan === 0) g--;
    return rows[g]?.def.label ?? '';
  }
  protected isOpenRow(ri: number): boolean {
    return this.panelAfter() === ri;
  }
  protected isOpenColumn(ci: number): boolean {
    return this.openColumn() === ci;
  }
  protected isOpen(o: Open): boolean {
    return JSON.stringify(this.open()) === JSON.stringify(o);
  }
  protected toggleOpen(o: Open): void {
    this.open.set(this.isOpen(o) ? null : o);
  }

  // ── words on the cells ──
  protected text(ri: number, s: GridSlot): string {
    return valueText(s.field, cellValue(this.answer(), this.layout().rows[ri].def.key, s.slot));
  }
  protected filled(ri: number, c: GridLaidCell): boolean {
    return c.slots.some((s: GridSlot) => !!this.text(ri, s));
  }
  protected cellId(ri: number, c: GridLaidCell): string {
    return `${this.layout().rows[ri].def.key}/${this.cfg().columns[c.column]?.key}`;
  }
  protected rowWords(r: GridLaidRow): string {
    const head = this.cfg().rowHeader?.trim();
    return r.def.label ? (head ? `${head} ${r.def.label}` : r.def.label) : 'This row';
  }
  protected cellWords(ri: number, c: GridLaidCell): string {
    const r = this.layout().rows[ri];
    const where = [r.def.label ? this.rowWords(r) : '', this.cfg().columns[c.column]?.label].filter(Boolean).join(', ');
    const said = c.slots.map((s) => {
      const t = this.text(ri, s);
      return c.slots.length > 1 ? `${s.field.label} ${t || 'empty'}` : t || 'empty';
    });
    return `${where}: ${said.join(', ')}`;
  }

  // ── Quick fill ──
  private readonly presets = computed(() => ({
    all: presetsOf(this.cfg(), 'all'),
    row: presetsOf(this.cfg(), 'row'),
    column: presetsOf(this.cfg(), 'column'),
  }));
  protected readonly allChips = computed(() =>
    this.presets().all.map((p) => ({ preset: p, active: chipActive(this.layout(), this.answer(), p) })),
  );
  protected readonly allWords = computed(() => this.presets().all.map(chipText));
  protected readonly rowTappable = computed(() => true);
  protected readonly columnTappable = computed(() => true);

  protected chip(p: GridPreset, where: { row?: string; column?: string }, active: boolean): void {
    this.write(applyChip(this.layout(), this.answer(), p, where, active));
  }

  protected togglePrint(): void {
    const a = this.answer();
    this.write({ ...(a ?? {}), cells: a?.cells ?? {}, print: !this.printOn() });
  }

  private write(a: GridAnswer | undefined): void {
    this.emit(a);
  }

  // ── the open cell ──
  /** Every fillable cell, down each column then the next column (a chart is charted tooth by tooth). */
  protected readonly nav = computed<CellRef[]>(() => {
    const refs: (CellRef & { col: number })[] = [];
    this.layout().rows.forEach((r, ri) => r.cells.forEach((c, ci) => c.slots.length && refs.push({ row: ri, cell: ci, col: c.column })));
    return refs.sort((a, b) => a.col - b.col || a.row - b.row).map(({ row, cell }) => ({ row, cell }));
  });
  protected readonly navIndex = computed(() => {
    const o = this.open();
    if (o?.type !== 'cell') return -1;
    return this.nav().findIndex((r) => r.row === o.row && r.cell === o.cell);
  });
  private readonly openCell = computed(() => {
    const o = this.open();
    if (o?.type !== 'cell') return null;
    const row = this.layout().rows[o.row];
    const cell = row?.cells[o.cell];
    return row && cell ? { row, cell } : null;
  });
  protected readonly openSlots = computed(() => this.openCell()?.cell.slots ?? []);
  protected readonly openValues = computed(() => {
    const oc = this.openCell();
    const out: Record<string, GridCellValue | null> = {};
    if (oc) for (const s of oc.cell.slots) out[s.slot] = cellValue(this.answer(), oc.row.def.key, s.slot);
    return out;
  });
  protected readonly panelChips = computed<CellPanelChip[]>(() => {
    const oc = this.openCell();
    if (!oc) return [];
    const rowKey = oc.row.def.key;
    const colKey = this.cfg().columns[oc.cell.column]?.key;
    const l = this.layout();
    return [
      ...this.presets()
        .row.filter((p) => chipFits(l, p, { row: rowKey }))
        .map((p) => ({ preset: p, scope: 'row' as const, active: chipActive(l, this.answer(), p, { row: rowKey }) })),
      ...this.presets()
        .column.filter((p) => chipFits(l, p, { column: colKey }))
        .map((p) => ({ preset: p, scope: 'column' as const, active: chipActive(l, this.answer(), p, { column: colKey }) })),
    ];
  });
  protected readonly rowFill = computed(() => {
    const s = this.openSlots()[0];
    return s && this.openSlots().length === 1 ? fillCount(this.layout(), this.answer(), s, 'row') : 0;
  });
  protected readonly columnFill = computed(() => {
    const s = this.openSlots()[0];
    return s && this.openSlots().length === 1 ? fillCount(this.layout(), this.answer(), s, 'column') : 0;
  });

  private advance: ReturnType<typeof setTimeout> | null = null;

  protected onPanel(a: CellPanelAction): void {
    const l = this.layout();
    switch (a.kind) {
      case 'set':
        this.write(withCell(this.answer(), a.slot.rowKey, a.slot.slot, a.value));
        if (a.oneTap) {
          const from = this.open();
          if (this.advance) clearTimeout(this.advance);
          this.advance = setTimeout(() => {
            if (JSON.stringify(this.open()) === JSON.stringify(from)) this.move(1, true);
          }, GRID_ADVANCE_MS);
        }
        return;
      case 'fill':
        this.write(fillFrom(l, this.answer(), a.slot, a.along));
        return;
      case 'chip': {
        const oc = this.openCell();
        if (!oc) return;
        const where = a.scope === 'row' ? { row: oc.row.def.key } : { column: this.cfg().columns[oc.cell.column]?.key };
        this.chip(a.preset, where, chipActive(l, this.answer(), a.preset, where));
        return;
      }
      case 'move':
        this.move(a.dir, false);
        return;
      case 'close':
        this.open.set(null);
    }
  }

  private move(dir: 1 | -1, closeAtEnd: boolean): void {
    const i = this.navIndex();
    const next = this.nav()[i + dir];
    if (next) this.open.set({ type: 'cell', ...next });
    else if (closeAtEnd) this.open.set(null);
  }

  // ── the row / column sheet ──
  private readonly lineWhere = computed<{ row?: string; column?: string } | null>(() => {
    const o = this.open();
    if (o?.type === 'row') return { row: this.layout().rows[o.row]?.def.key };
    if (o?.type === 'column') return { column: this.cfg().columns[o.col]?.key };
    return null;
  });
  protected readonly lineTitle = computed(() => {
    const o = this.open();
    if (o?.type === 'row') {
      const r = this.layout().rows[o.row];
      return r ? this.rowWords(r) : '';
    }
    if (o?.type === 'column') return `${this.cfg().columns[o.col]?.label ?? ''} column`;
    return '';
  });
  protected readonly lineChips = computed(() => {
    const o = this.open();
    const where = this.lineWhere();
    if (!o || !where || o.type === 'cell') return [];
    const scope = o.type;
    const l = this.layout();
    return this.presets()
      [scope].filter((p) => chipFits(l, p, where))
      .map((p) => ({ preset: p, scope, active: chipActive(l, this.answer(), p, where) }));
  });
  protected readonly lineHasAnswers = computed(() => {
    const where = this.lineWhere();
    if (!where) return false;
    return this.layout().slots.some(
      (s) =>
        (!where.row || s.rowKey === where.row) &&
        (!where.column || s.columnKey === where.column) &&
        cellValue(this.answer(), s.rowKey, s.slot) !== null,
    );
  });
  protected lineChip(c: { preset: GridPreset; active: boolean }): void {
    const where = this.lineWhere();
    if (where) this.chip(c.preset, where, c.active);
  }
  protected async clearLine(): Promise<void> {
    const where = this.lineWhere();
    if (!where) return;
    const ok = await this.dialog.confirm({
      title: `Clear ${this.lineTitle()}?`,
      message: 'Every answer in it is removed from this case sheet.',
      confirmLabel: 'Clear',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (ok) this.write(clearAlong(this.layout(), this.answer(), where));
  }

  // ── shapes (legacy plain multi-textbox: boxes around a picture) ──
  protected readonly shapeBoxes = computed(() => {
    const row = this.layout().rows[0];
    if (!row) return [];
    const pos = shapePositions(this.cfg().shape?.layout ?? 'circle', row.cells.length);
    return row.cells.map((cell, idx) => ({ cell, idx, n: idx + 1, ...pos[idx] }));
  });
  protected readonly centreUrl = signal<string | null>(null);

  constructor() {
    super();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((e) => this.width.set(e[0]?.contentRect.width ?? 0)) : null;
    ro?.observe(this.el.nativeElement);
    inject(DestroyRef).onDestroy(() => {
      ro?.disconnect();
      if (this.advance) clearTimeout(this.advance);
    });
    effect(() => {
      const id = this.cfg().shape?.centerImage;
      untracked(() => {
        this.centreUrl.set(null);
        if (id && this.assets)
          this.assets.asset(id).then(
            (a) => this.centreUrl.set(a.url),
            () => this.centreUrl.set(null),
          );
      });
    });
    // a closed or locked grid has no open sheet
    effect(() => {
      if (this.disabled()) untracked(() => this.open.set(null));
    });
  }
}
