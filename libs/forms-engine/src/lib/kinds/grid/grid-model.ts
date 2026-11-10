import { FieldDef } from '../../core/types';

/**
 * The grid kind (legacy multi-textbox, grid and shape layouts): the TS mirror of the API's
 * `GridModel` / `GridLayout` / `GridQuickFill` / `GridText` (prefrontal-prepare-mw
 * `Prepare/Components/Grid`, docs/API.md "Grid and the hard cases"). The API is the truth for the
 * narrative and the printout; this mirror lays the grid out for the filler, writes answers in the
 * API's shape and runs Quick Fill exactly like the server (shared vectors:
 * `testing/grid-quick-fill.vectors.json`).
 */

export type GridFieldType = 'text' | 'number' | 'choice' | 'yesno';

export interface GridOption {
  key: string;
  label: string;
}

export interface GridSays {
  include?: boolean;
  prefix?: string;
  suffix?: string;
  template?: string;
}

/** A small field: a column's own field, or one of a cell's own list. */
export interface GridField {
  key: string;
  label: string;
  fieldLabel?: string;
  type?: GridFieldType;
  options?: GridOption[];
  display?: 'buttons' | 'dropdown';
  unit?: string;
  placeholder?: string;
  suggestions?: boolean;
  default?: string | number | boolean;
  says?: GridSays;
  image?: string;
}

export interface GridCellDef {
  column: string;
  colSpan?: number;
  /** Omitted = the column's own field; a list (even []) replaces it for this cell. */
  fields?: GridField[];
}

export interface GridRowDef {
  key: string;
  label: string;
  labelSpan?: number;
  cells?: GridCellDef[];
}

export interface GridHeaderGroup {
  label: string;
  from: string;
  span?: number;
}

export type GridScope = 'all' | 'row' | 'column';

export interface GridPreset {
  label: string;
  value?: string;
  scope?: GridScope;
}

export type GridShapeLayout = 'linear' | 'circle' | 'rectangle' | 'triangle' | 'square';

export interface GridConfig {
  display?: 'table' | 'sentences' | 'both';
  rowHeader?: string;
  columns: GridField[];
  headerGroups?: GridHeaderGroup[];
  rows: GridRowDef[];
  sentences?: { row?: string; rowSeparator?: string };
  quickFill?: { enabled?: boolean; presets?: GridPreset[] };
  shape?: { layout?: GridShapeLayout; centerImage?: string };
  includeSwitch?: boolean;
}

export type GridCellValue = string | number | boolean;
export type GridRowValues = Record<string, GridCellValue>;
export interface GridAnswer {
  print?: boolean;
  cells?: Record<string, GridRowValues>;
}

export const GRID_LIMITS = { rows: 200, columns: 24, fieldsPerCell: 12, cells: 6000, presets: 20, text: 500 } as const;

/** One thing to fill in: a small field in a cell of a row. `slot` = `columnKey` or `columnKey.fieldKey`. */
export interface GridSlot {
  slot: string;
  field: GridField;
  rowKey: string;
  rowLabel: string;
  columnKey: string;
  columnLabel: string;
}

export interface GridLaidCell {
  /** Index of the column the cell starts in. */
  column: number;
  colSpan: number;
  /** The cell carries its own field list (not the column's field). */
  own: boolean;
  slots: GridSlot[];
}

export interface GridLaidRow {
  def: GridRowDef;
  index: number;
  /** Rows this row's label covers (1 = its own); 0 = the row sits under a merged label above. */
  labelSpan: number;
  cells: GridLaidCell[];
}

export interface GridLayout {
  config: GridConfig;
  rows: GridLaidRow[];
  slots: GridSlot[];
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x !== null && x !== undefined) as T[]) : []);

function normField(f: GridField): GridField {
  return { ...f, key: f.key ?? '', label: f.label ?? '', type: f.type ?? 'text', options: arr<GridOption>(f.options) };
}

/** A field's config read safely (a config that never passed the checker gives an empty grid, never an error). */
export function gridConfig(field: FieldDef | { config?: Record<string, unknown> }): GridConfig {
  const c = (field.config ?? {}) as Partial<GridConfig>;
  return {
    ...c,
    display: c.display ?? 'table',
    columns: arr<GridField>(c.columns).map(normField),
    rows: arr<GridRowDef>(c.rows).map((r) => ({
      ...r,
      key: r.key ?? '',
      label: r.label ?? '',
      cells: arr<GridCellDef>(r.cells).map((cell) => ({
        ...cell,
        column: cell.column ?? '',
        ...(cell.fields !== undefined && cell.fields !== null ? { fields: arr<GridField>(cell.fields).map(normField) } : {}),
      })),
    })),
    headerGroups: arr<GridHeaderGroup>(c.headerGroups),
    quickFill: c.quickFill ? { ...c.quickFill, presets: arr<GridPreset>(c.quickFill.presets) } : undefined,
  };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Lay the grid out: every cell worked out (merged cells, cells with their own fields, merged row labels). */
export function gridLayout(cfg: GridConfig): GridLayout {
  const colIndex = new Map<string, number>();
  cfg.columns.forEach((c, i) => {
    if (!colIndex.has(c.key.toLowerCase())) colIndex.set(c.key.toLowerCase(), i);
  });
  const rows: GridLaidRow[] = cfg.rows.map((row, ri) => {
    const overrides = new Map<number, GridCellDef>();
    for (const c of row.cells ?? []) {
      const ci = colIndex.get((c.column ?? '').toLowerCase());
      if (ci !== undefined && !overrides.has(ci)) overrides.set(ci, c);
    }
    const cells: GridLaidCell[] = [];
    for (let ci = 0; ci < cfg.columns.length; ci++) {
      const col = cfg.columns[ci];
      const over = overrides.get(ci);
      const span = Math.min(Math.max(over?.colSpan ?? 1, 1), cfg.columns.length - ci);
      const base = { rowKey: row.key, rowLabel: row.label, columnKey: col.key, columnLabel: col.label };
      const own = !!over?.fields;
      const slots: GridSlot[] = own
        ? over!.fields!.map((f) => ({ ...base, slot: `${col.key}.${f.key}`, field: f }))
        : [{ ...base, slot: col.key, field: col }];
      cells.push({ column: ci, colSpan: span, own, slots });
      ci += span - 1;
    }
    return { def: row, index: ri, labelSpan: 1, cells };
  });
  // merged row labels (the server's rule: clamp to the rows left; a row under a merge has no label of its own)
  for (let i = 0; i < rows.length; i++) {
    const span = Math.min(Math.max(rows[i].def.labelSpan ?? 1, 1), rows.length - i);
    rows[i].labelSpan = span;
    for (let k = 1; k < span; k++) rows[i + k].labelSpan = 0;
    i += span - 1;
  }
  return { config: cfg, rows, slots: rows.flatMap((r) => r.cells.flatMap((c) => c.slots)) };
}

/** The merged heading band above the column headings, gaps filled with unlabelled groups; null when none or they overlap. */
export function headerBand(cfg: GridConfig): { label: string; span: number; start: number }[] | null {
  const groups = cfg.headerGroups ?? [];
  if (!groups.length) return null;
  const index = new Map(cfg.columns.map((c, i) => [c.key.toLowerCase(), i]));
  const sorted = groups
    .filter((g) => index.has((g.from ?? '').toLowerCase()))
    .map((g) => ({ start: index.get(g.from.toLowerCase())!, label: g.label ?? '', span: Math.max(1, g.span ?? 1) }))
    .sort((a, b) => a.start - b.start);
  const band: { label: string; span: number; start: number }[] = [];
  let at = 0;
  for (const g of sorted) {
    if (g.start < at) return null;
    if (g.start > at) band.push({ label: '', span: g.start - at, start: at });
    const span = Math.min(g.span, cfg.columns.length - g.start);
    band.push({ label: g.label, span, start: g.start });
    at = g.start + span;
  }
  if (at < cfg.columns.length) band.push({ label: '', span: cfg.columns.length - at, start: at });
  return band;
}

// ───────────────────────── answers ─────────────────────────

export function asAnswer(v: unknown): GridAnswer | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as GridAnswer) : null;
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function cellValue(answer: GridAnswer | null, rowKey: string, slot: string): GridCellValue | null {
  const v = answer?.cells?.[rowKey]?.[slot];
  return blank(v) ? null : (v as GridCellValue);
}

/** A new answer with one slot set (null / '' clears it; an emptied row is dropped; nothing left = undefined, the field is cleared). */
export function withCell(answer: GridAnswer | null, rowKey: string, slot: string, value: GridCellValue | null): GridAnswer | undefined {
  const cells = { ...(answer?.cells ?? {}) };
  const row = { ...(cells[rowKey] ?? {}) };
  if (blank(value)) delete row[slot];
  else row[slot] = value as GridCellValue;
  if (Object.keys(row).length) cells[rowKey] = row;
  else delete cells[rowKey];
  return tidy({ ...(answer ?? {}), cells });
}

/** Drop empty rows; an answer with no cells and no print switch is no answer. */
function tidy(a: GridAnswer): GridAnswer | undefined {
  const cells: Record<string, GridRowValues> = {};
  for (const [k, row] of Object.entries(a.cells ?? {})) {
    const kept = Object.fromEntries(Object.entries(row ?? {}).filter(([, v]) => !blank(v)));
    if (Object.keys(kept).length) cells[k] = kept as GridRowValues;
  }
  const out: GridAnswer = { ...a, cells };
  if (!Object.keys(cells).length && out.print === undefined) return undefined;
  return out;
}

/** A grid counts as answered when at least one cell has a value (`false` for a yes/no counts). */
export function gridAnswered(v: unknown): boolean {
  const a = asAnswer(v);
  return Object.values(a?.cells ?? {}).some((row) => Object.values(row ?? {}).some((x) => !blank(x)));
}

// ───────────────────────── words ─────────────────────────

/** What a cell's answer reads as (the API's GridText.ValueText): a choice by its label, a number with its unit, Yes / No. */
export function valueText(f: GridField, v: unknown): string {
  if (blank(v)) return '';
  switch (f.type ?? 'text') {
    case 'yesno':
      return v === true || v === 'true' ? 'Yes' : v === false || v === 'false' ? 'No' : '';
    case 'choice': {
      const raw = String(v).trim();
      return (f.options ?? []).find((o) => same(o.key, raw))?.label ?? raw;
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return '';
      const t = String(Math.round(n * 1e6) / 1e6);
      return f.unit?.trim() ? `${t} ${f.unit}` : t;
    }
    default:
      return String(v).trim();
  }
}

// ───────────────────────── Quick Fill (mirror of GridQuickFill) ─────────────────────────

/** The chip's words: `value`, else its label. */
export function chipText(p: GridPreset): string {
  return p.value && p.value.trim() ? p.value : p.label;
}

/** The value a chip writes into a field; `undefined` when the chip does not fit the field. */
export function resolveChip(f: GridField, chip: string): GridCellValue | undefined {
  const c = (chip ?? '').trim();
  if (!c) return undefined;
  switch (f.type ?? 'text') {
    case 'choice':
      return (f.options ?? []).find((o) => same(o.key, c) || same(o.label, c))?.key;
    case 'yesno':
      if (same(c, 'yes') || same(f.label, c)) return true;
      if (same(c, 'no')) return false;
      return undefined;
    case 'number': {
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(c)) return undefined;
      return Number(c);
    }
    default:
      return c.length > GRID_LIMITS.text ? c.slice(0, GRID_LIMITS.text) : c;
  }
}

export interface ChipWhere {
  row?: string | null;
  column?: string | null;
}

function inScope(s: GridSlot, where: ChipWhere): boolean {
  if (where.row && !same(s.rowKey, where.row)) return false;
  if (where.column && !same(s.columnKey, where.column)) return false;
  return true;
}

/** Apply (or, with `clear`, take back) a chip over the grid, a row or a column. A new answer; the input is not changed. */
export function applyChip(layout: GridLayout, answer: GridAnswer | null, preset: GridPreset, where: ChipWhere = {}, clear = false): GridAnswer {
  const result: GridAnswer = structuredClone(answer ?? {});
  const cells = (result.cells ??= {});
  const chip = chipText(preset);
  for (const s of layout.slots) {
    if (!inScope(s, where)) continue;
    const v = resolveChip(s.field, chip);
    if (v === undefined) continue;
    const row = cells[s.rowKey];
    if (clear) {
      if (row && s.slot in row && row[s.slot] === v) {
        delete row[s.slot];
        if (!Object.keys(row).length) delete cells[s.rowKey];
      }
      continue;
    }
    (cells[s.rowKey] ??= {})[s.slot] = v;
  }
  if (!clear) result.print = true;
  return result;
}

/** Is the chip "on": every cell it fits (in that scope) holds its value, and there is at least one such cell. */
export function chipActive(layout: GridLayout, answer: GridAnswer | null, preset: GridPreset, where: ChipWhere = {}): boolean {
  const chip = chipText(preset);
  let any = false;
  for (const s of layout.slots) {
    if (!inScope(s, where)) continue;
    const v = resolveChip(s.field, chip);
    if (v === undefined) continue;
    any = true;
    if (cellValue(answer, s.rowKey, s.slot) !== v) return false;
  }
  return any;
}

/** The chips of one scope (the grid's own when Quick Fill is on). */
export function presetsOf(cfg: GridConfig, scope: GridScope): GridPreset[] {
  if (cfg.quickFill?.enabled === false) return [];
  return (cfg.quickFill?.presets ?? []).filter((p) => (p.scope ?? 'all') === scope && p.label?.trim());
}

/** Does any slot in this scope take the chip? (a chip that fits nothing is not shown there) */
export function chipFits(layout: GridLayout, preset: GridPreset, where: ChipWhere): boolean {
  const chip = chipText(preset);
  return layout.slots.some((s) => inScope(s, where) && resolveChip(s.field, chip) !== undefined);
}

// ───────────────────────── fill a row / a column from one cell ─────────────────────────

/** The same answer for another field: same type and, for a choice, an option with the same key. */
function carry(from: GridField, to: GridField, v: GridCellValue): GridCellValue | undefined {
  if ((from.type ?? 'text') !== (to.type ?? 'text')) return undefined;
  if ((to.type ?? 'text') === 'choice') return (to.options ?? []).find((o) => same(o.key, String(v)))?.key;
  return v;
}

/**
 * "Same for the whole row / column": copy a cell's answer into every other cell of its row (or column) that takes
 * the same kind of answer. Cells that already hold something are overwritten (like a chip). Returns the new answer.
 */
export function fillFrom(layout: GridLayout, answer: GridAnswer | null, from: GridSlot, along: 'row' | 'column'): GridAnswer {
  const v = cellValue(answer, from.rowKey, from.slot);
  const result: GridAnswer = structuredClone(answer ?? {});
  if (v === null) return result;
  const cells = (result.cells ??= {});
  for (const s of layout.slots) {
    if (s.rowKey === from.rowKey && s.slot === from.slot) continue;
    if (along === 'row' ? !same(s.rowKey, from.rowKey) : !same(s.slot, from.slot)) continue;
    const w = carry(from.field, s.field, v);
    if (w === undefined) continue;
    (cells[s.rowKey] ??= {})[s.slot] = w;
  }
  result.print = true;
  return result;
}

/** How many other cells `fillFrom` would write with the cell's current answer (0 when it is empty). */
export function fillCount(layout: GridLayout, answer: GridAnswer | null, from: GridSlot, along: 'row' | 'column'): number {
  const v = cellValue(answer, from.rowKey, from.slot);
  if (v === null) return 0;
  return layout.slots.filter(
    (s) =>
      !(s.rowKey === from.rowKey && s.slot === from.slot) &&
      (along === 'row' ? same(s.rowKey, from.rowKey) : same(s.slot, from.slot)) &&
      carry(from.field, s.field, v) !== undefined,
  ).length;
}

/** Empty a row or a column (the "Clear" of the row / column sheet). */
export function clearAlong(layout: GridLayout, answer: GridAnswer | null, where: ChipWhere): GridAnswer | undefined {
  const result: GridAnswer = structuredClone(answer ?? {});
  for (const s of layout.slots) {
    if (!inScope(s, where)) continue;
    const row = result.cells?.[s.rowKey];
    if (row) delete row[s.slot];
  }
  return tidy(result);
}

/** Positions (percent of the box) of n boxes around a centre picture: the legacy multi-textbox shapes. */
export function shapePositions(layout: GridShapeLayout, n: number): { x: number; y: number }[] {
  if (n <= 0) return [];
  if (layout === 'circle') {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: 50 + Math.cos(a) * 36, y: 50 + Math.sin(a) * 36 };
    });
  }
  if (layout === 'triangle') {
    const ring = [
      { x: 50, y: 8 },
      { x: 68, y: 38 },
      { x: 86, y: 70 },
      { x: 92, y: 92 },
      { x: 50, y: 92 },
      { x: 8, y: 92 },
      { x: 14, y: 70 },
      { x: 32, y: 38 },
    ];
    return pick(ring, n);
  }
  if (layout === 'rectangle' || layout === 'square') {
    const ring = [
      { x: 10, y: 10 },
      { x: 50, y: 8 },
      { x: 90, y: 10 },
      { x: 92, y: 50 },
      { x: 90, y: 90 },
      { x: 50, y: 92 },
      { x: 10, y: 90 },
      { x: 8, y: 50 },
    ];
    return pick(ring, n);
  }
  return [];
}

function pick(ring: { x: number; y: number }[], n: number): { x: number; y: number }[] {
  if (n <= ring.length) {
    const step = ring.length / n;
    return Array.from({ length: n }, (_, i) => ring[Math.floor(i * step) % ring.length]);
  }
  // more boxes than the ring holds: walk the perimeter evenly
  return Array.from({ length: n }, (_, i) => {
    const t = i / n;
    const seg = t * ring.length;
    const a = ring[Math.floor(seg) % ring.length];
    const b = ring[(Math.floor(seg) + 1) % ring.length];
    const f = seg - Math.floor(seg);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  });
}
