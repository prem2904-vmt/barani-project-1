import { GRID_LIMITS, GridCellDef, GridConfig, GridField, GridFieldType, GridHeaderGroup, GridPreset, GridRowDef, GridScope } from './grid-model';

/**
 * Studio edits of a grid's config (ENGINEERING-RULES §8: Studio edits are pure functions — config in, new config
 * out; the input is never changed). Each one keeps the config valid for the API's checker (docs/API.md "Grid and
 * the hard cases"): unique keys, merged cells and labels clamped, merged headings never overlapping, the limits.
 * An edit that would break a limit returns the config unchanged; `gridLimitWords` says why in plain words.
 */

const clone = <T>(v: T): T => structuredClone(v);
const lc = (s: string) => (s ?? '').toLowerCase();

/** A key from a label: letters, digits and _, starting with a letter, at most `max` long, not in `taken` (any case). */
export function keyFrom(label: string, taken: Iterable<string>, fallback = 'col', max = 32): string {
  const used = new Set([...taken].map(lc));
  let base = (label ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+(\w)/g, (_m, c: string) => c.toUpperCase())
    .replace(/[^A-Za-z0-9_]/g, '');
  if (base) base = base.charAt(0).toLowerCase() + base.slice(1);
  if (!/^[A-Za-z]/.test(base)) base = base ? `${fallback}${base}` : fallback;
  base = base.slice(0, max);
  if (!used.has(lc(base))) return base;
  for (let n = 2; ; n++) {
    const tail = String(n);
    const k = base.slice(0, max - tail.length) + tail;
    if (!used.has(lc(k))) return k;
  }
}

/** Plain-words reason an edit was refused (or null when it is fine). */
export function gridLimitWords(cfg: GridConfig, what: 'column' | 'row' | 'preset' | 'option', at = 0): string | null {
  if (what === 'column' && cfg.columns.length >= GRID_LIMITS.columns) return `A table has at most ${GRID_LIMITS.columns} columns.`;
  if (what === 'row' && cfg.rows.length >= GRID_LIMITS.rows) return `A table has at most ${GRID_LIMITS.rows} rows.`;
  if (what === 'preset' && (cfg.quickFill?.presets?.length ?? 0) >= GRID_LIMITS.presets)
    return `At most ${GRID_LIMITS.presets} Quick fill chips.`;
  if (what === 'option' && (cfg.columns[at]?.options?.length ?? 0) >= 100) return 'At most 100 choices in a column.';
  return null;
}

// ───────────────────────── tidy (after any structural edit) ─────────────────────────

/** Clamp merged cells and labels, drop cells covered by a merge, drop headings that overlap or point nowhere. */
export function tidyGrid(cfg: GridConfig): GridConfig {
  const out = clone(cfg);
  const index = new Map(out.columns.map((c, i) => [lc(c.key), i]));
  const n = out.columns.length;
  for (const row of out.rows) {
    const cells = (row.cells ?? [])
      .filter((c) => index.has(lc(c.column)))
      .sort((a, b) => index.get(lc(a.column))! - index.get(lc(b.column))!);
    const kept: GridCellDef[] = [];
    let coveredTo = -1;
    for (const c of cells) {
      const at = index.get(lc(c.column))!;
      if (at <= coveredTo) continue; // under an earlier merge (or a second cell for one column)
      const span = Math.min(Math.max(c.colSpan ?? 1, 1), n - at);
      const cell: GridCellDef = { column: out.columns[at].key };
      if (span > 1) cell.colSpan = span;
      if (c.fields) cell.fields = c.fields;
      if (span > 1 || cell.fields) kept.push(cell);
      coveredTo = at + span - 1;
    }
    if (kept.length) row.cells = kept;
    else delete row.cells;
  }
  // merged row labels: clamp; a row under a merge has none of its own
  for (let i = 0; i < out.rows.length; i++) {
    const span = Math.min(Math.max(out.rows[i].labelSpan ?? 1, 1), out.rows.length - i);
    if (span > 1) out.rows[i].labelSpan = span;
    else delete out.rows[i].labelSpan;
    for (let k = 1; k < span; k++) delete out.rows[i + k].labelSpan;
    i += span - 1;
  }
  // merged headings: known columns, clamped, no overlap (the earlier one wins)
  const groups = (out.headerGroups ?? [])
    .filter((g) => index.has(lc(g.from)))
    .map((g) => ({ ...g, from: out.columns[index.get(lc(g.from))!].key, start: index.get(lc(g.from))! }))
    .sort((a, b) => a.start - b.start);
  const band: GridHeaderGroup[] = [];
  let at = 0;
  for (const g of groups) {
    if (g.start < at) continue;
    const span = Math.min(Math.max(g.span ?? 1, 1), n - g.start);
    band.push({ label: g.label ?? '', from: g.from, ...(span > 1 ? { span } : {}) });
    at = g.start + span;
  }
  if (band.length) out.headerGroups = band;
  else delete out.headerGroups;
  return out;
}

/** The config as the API stores it: no empty lists, no defaults written out, no options on a non-choice. */
export function serialiseGrid(cfg: GridConfig): Record<string, unknown> {
  const field = (f: GridField): GridField => {
    const o: GridField = { ...f };
    if ((o.type ?? 'text') !== 'choice') {
      delete o.options;
      delete o.display;
    }
    if ((o.type ?? 'text') !== 'number') delete o.unit;
    for (const k of Object.keys(o) as (keyof GridField)[]) if (o[k] === undefined || o[k] === '') delete o[k];
    if (o.key === undefined) o.key = f.key;
    if (o.label === undefined) o.label = '';
    if (o.says && !Object.keys(o.says).length) delete o.says;
    return o;
  };
  const t = tidyGrid(cfg);
  const out: Record<string, unknown> = { ...t };
  out['columns'] = t.columns.map(field);
  out['rows'] = t.rows.map((r) => {
    const row: GridRowDef = { key: r.key, label: r.label ?? '' };
    if (r.labelSpan && r.labelSpan > 1) row.labelSpan = r.labelSpan;
    if (r.cells?.length) row.cells = r.cells.map((c) => ({ ...c, ...(c.fields ? { fields: c.fields.map(field) } : {}) }));
    return row;
  });
  if (!t.headerGroups?.length) delete out['headerGroups'];
  if (t.quickFill) {
    const presets = (t.quickFill.presets ?? []).map((p) => {
      const q: GridPreset = { label: p.label };
      if (p.value?.trim()) q.value = p.value;
      if (p.scope && p.scope !== 'all') q.scope = p.scope;
      return q;
    });
    out['quickFill'] = { enabled: t.quickFill.enabled !== false, presets };
  } else delete out['quickFill'];
  if (t.sentences) {
    const s: Record<string, string> = {};
    if (t.sentences.row?.trim()) s['row'] = t.sentences.row;
    if (t.sentences.rowSeparator !== undefined && t.sentences.rowSeparator !== '') s['rowSeparator'] = t.sentences.rowSeparator;
    if (Object.keys(s).length) out['sentences'] = s;
    else delete out['sentences'];
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// ───────────────────────── columns ─────────────────────────

export function addColumn(cfg: GridConfig, label = 'New column', type: GridFieldType = 'text'): GridConfig {
  if (gridLimitWords(cfg, 'column')) return cfg;
  const out = clone(cfg);
  const col: GridField = { key: keyFrom(label, out.columns.map((c) => c.key)), label, type };
  if (type === 'choice') col.options = [{ key: 'normal', label: 'Normal' }];
  out.columns.push(col);
  return tidyGrid(out);
}

export function updateColumn(cfg: GridConfig, at: number, change: (c: GridField) => void): GridConfig {
  if (!cfg.columns[at]) return cfg;
  const out = clone(cfg);
  change(out.columns[at]);
  return out;
}

/** Remove a column: its cells, the merges that started there and its merged heading go with it. */
export function removeColumn(cfg: GridConfig, at: number): GridConfig {
  const col = cfg.columns[at];
  if (!col || cfg.columns.length <= 1) return cfg;
  const out = clone(cfg);
  const key = lc(col.key);
  // a merge running over the column loses one column; a heading starting on it moves to the next column
  const index = new Map(out.columns.map((c, i) => [lc(c.key), i]));
  for (const row of out.rows) {
    for (const c of row.cells ?? []) {
      const start = index.get(lc(c.column));
      if (start !== undefined && start < at && start + (c.colSpan ?? 1) - 1 >= at) c.colSpan = (c.colSpan ?? 1) - 1;
    }
    row.cells = (row.cells ?? []).filter((c) => lc(c.column) !== key);
  }
  out.headerGroups = (out.headerGroups ?? []).flatMap((g) => {
    const start = index.get(lc(g.from));
    if (start === undefined) return [];
    const span = g.span ?? 1;
    if (start === at) return span > 1 && out.columns[at + 1] ? [{ ...g, from: out.columns[at + 1].key, span: span - 1 }] : [];
    if (start < at && start + span - 1 >= at) return [{ ...g, span: span - 1 }];
    return [g];
  });
  out.columns.splice(at, 1);
  return tidyGrid(out);
}

/** Move a column left (-1) or right (+1). Merges and headings are re-checked (one may stop fitting). */
export function moveColumn(cfg: GridConfig, at: number, dir: 1 | -1): GridConfig {
  const to = at + dir;
  if (!cfg.columns[at] || !cfg.columns[to]) return cfg;
  const out = clone(cfg);
  [out.columns[at], out.columns[to]] = [out.columns[to], out.columns[at]];
  return tidyGrid(out);
}

/** Change a column's answer type; a choice starts with one choice, a non-choice loses its choices; a default that no longer fits goes. */
export function setColumnType(cfg: GridConfig, at: number, type: GridFieldType): GridConfig {
  return updateColumn(cfg, at, (c) => {
    if ((c.type ?? 'text') === type) return;
    c.type = type;
    if (type === 'choice') c.options = c.options?.length ? c.options : [{ key: 'normal', label: 'Normal' }];
    else {
      delete c.options;
      delete c.display;
    }
    if (type !== 'number') delete c.unit;
    delete c.default;
  });
}

export function addOption(cfg: GridConfig, at: number, label: string): GridConfig {
  const words = label.trim();
  if (!words || gridLimitWords(cfg, 'option', at)) return cfg;
  return updateColumn(cfg, at, (c) => {
    const opts = (c.options ??= []);
    if (opts.some((o) => lc(o.label) === lc(words))) return;
    opts.push({ key: keyFrom(words, opts.map((o) => o.key), 'opt', 60), label: words });
  });
}

/** Rename keeps the key (answers already saved keep pointing at it). */
export function renameOption(cfg: GridConfig, at: number, key: string, label: string): GridConfig {
  if (!label.trim()) return cfg;
  return updateColumn(cfg, at, (c) => {
    const o = c.options?.find((x) => x.key === key);
    if (o) o.label = label.trim();
  });
}

/** The last choice stays (a choice needs at least one). */
export function removeOption(cfg: GridConfig, at: number, key: string): GridConfig {
  if ((cfg.columns[at]?.options?.length ?? 0) <= 1) return cfg;
  return updateColumn(cfg, at, (c) => {
    c.options = (c.options ?? []).filter((o) => o.key !== key);
    if (c.default !== undefined && !c.options.some((o) => o.key === c.default)) delete c.default;
  });
}

// ───────────────────────── rows ─────────────────────────

/**
 * Rows typed in one go: one per line, or separated by commas; "18-11" (or 18…11, 18..11) counts down or up
 * (a dental quadrant). At most what the table still has room for.
 */
export function parseRowLabels(text: string, room: number = GRID_LIMITS.rows): string[] {
  const out: string[] = [];
  for (const piece of (text ?? '').split(/[\n,;]+/)) {
    const p = piece.trim();
    if (!p) continue;
    const range = p.match(/^(\d{1,4})\s*(?:-|–|—|…|\.\.\.?|to)\s*(\d{1,4})$/i);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const step = a <= b ? 1 : -1;
      for (let n = a; step > 0 ? n <= b : n >= b; n += step) {
        out.push(String(n));
        if (out.length >= room) return out;
      }
    } else out.push(p.slice(0, 80));
    if (out.length >= room) return out.slice(0, room);
  }
  return out;
}

export function addRows(cfg: GridConfig, labels: string[]): GridConfig {
  const room = GRID_LIMITS.rows - cfg.rows.length;
  if (room <= 0 || !labels.length) return cfg;
  const out = clone(cfg);
  const taken = out.rows.map((r) => r.key);
  for (const label of labels.slice(0, room)) {
    // a number becomes "t18"-like keys (keys start with a letter)
    const key = keyFrom(label, taken, 'row', 64);
    taken.push(key);
    out.rows.push({ key, label });
  }
  return tidyGrid(out);
}

export function addRow(cfg: GridConfig, label = `Row ${cfg.rows.length + 1}`): GridConfig {
  return addRows(cfg, [label]);
}

export function renameRow(cfg: GridConfig, at: number, label: string): GridConfig {
  if (!cfg.rows[at]) return cfg;
  const out = clone(cfg);
  out.rows[at].label = label.trim().slice(0, 80);
  return out;
}

/** Remove a row; a merged label above that covered it loses one row. */
export function removeRow(cfg: GridConfig, at: number): GridConfig {
  if (!cfg.rows[at] || cfg.rows.length <= 1) return cfg;
  const out = clone(cfg);
  for (let i = 0; i < at; i++) {
    const span = out.rows[i].labelSpan ?? 1;
    if (span > 1 && i + span - 1 >= at) out.rows[i].labelSpan = span - 1;
  }
  // a merged label starting on the removed row passes to the row under it
  const own = out.rows[at].labelSpan ?? 1;
  if (own > 2 && out.rows[at + 1]) out.rows[at + 1].labelSpan = own - 1;
  out.rows.splice(at, 1);
  return tidyGrid(out);
}

/** Move a row up (-1) or down (+1); merged labels touching the two rows are undone (they would cover other rows). */
export function moveRow(cfg: GridConfig, at: number, dir: 1 | -1): GridConfig {
  const to = at + dir;
  if (!cfg.rows[at] || !cfg.rows[to]) return cfg;
  const out = clone(cfg);
  const lo = Math.min(at, to);
  for (let i = 0; i <= lo + 1; i++) {
    const span = out.rows[i].labelSpan ?? 1;
    if (span > 1 && i + span - 1 >= lo) delete out.rows[i].labelSpan;
  }
  [out.rows[at], out.rows[to]] = [out.rows[to], out.rows[at]];
  return tidyGrid(out);
}

/** "Merge this label with the next n − 1 rows" (n = 1 undoes it). Rows under the merge lose merges of their own. */
export function setLabelSpan(cfg: GridConfig, at: number, n: number): GridConfig {
  if (!cfg.rows[at]) return cfg;
  const out = clone(cfg);
  // a row under someone else's merge can't start one: undo the outer merge first
  for (let i = 0; i < at; i++) {
    const span = out.rows[i].labelSpan ?? 1;
    if (span > 1 && i + span - 1 >= at) delete out.rows[i].labelSpan;
  }
  out.rows[at].labelSpan = Math.max(1, Math.min(n, out.rows.length - at));
  return tidyGrid(out);
}

// ───────────────────────── one cell of a row ─────────────────────────

/** The override of a row's cell in a column (null = the column's own field). */
export function cellOverride(cfg: GridConfig, rowAt: number, colKey: string): GridCellDef | null {
  return cfg.rows[rowAt]?.cells?.find((c) => lc(c.column) === lc(colKey)) ?? null;
}

function withCellDef(cfg: GridConfig, rowAt: number, colKey: string, change: (c: GridCellDef) => void): GridConfig {
  if (!cfg.rows[rowAt] || !cfg.columns.some((c) => lc(c.key) === lc(colKey))) return cfg;
  const out = clone(cfg);
  const row = out.rows[rowAt];
  const cells = (row.cells ??= []);
  let cell = cells.find((c) => lc(c.column) === lc(colKey));
  if (!cell) cells.push((cell = { column: colKey }));
  change(cell);
  return tidyGrid(out);
}

/** Merge a cell with the column to its right (one more each time). */
export function mergeRight(cfg: GridConfig, rowAt: number, colKey: string): GridConfig {
  return withCellDef(cfg, rowAt, colKey, (c) => (c.colSpan = (c.colSpan ?? 1) + 1));
}

export function unmerge(cfg: GridConfig, rowAt: number, colKey: string): GridConfig {
  return withCellDef(cfg, rowAt, colKey, (c) => delete c.colSpan);
}

/** No box in this cell (a read-only blank). */
export function noBox(cfg: GridConfig, rowAt: number, colKey: string): GridConfig {
  return withCellDef(cfg, rowAt, colKey, (c) => (c.fields = []));
}

/** Back to the column's own box. */
export function restoreBox(cfg: GridConfig, rowAt: number, colKey: string): GridConfig {
  return withCellDef(cfg, rowAt, colKey, (c) => delete c.fields);
}

// ───────────────────────── merged headings ─────────────────────────

/** Would a heading over `span` columns from `from` overlap another one (ignoring heading `except`)? */
export function headingOverlaps(cfg: GridConfig, from: string, span: number, except = -1): boolean {
  const index = new Map(cfg.columns.map((c, i) => [lc(c.key), i]));
  const s = index.get(lc(from));
  if (s === undefined) return true;
  const e = s + Math.max(1, span) - 1;
  return (cfg.headerGroups ?? []).some((g, i) => {
    if (i === except) return false;
    const gs = index.get(lc(g.from));
    if (gs === undefined) return false;
    const ge = gs + Math.max(1, g.span ?? 1) - 1;
    return gs <= e && s <= ge;
  });
}

/** Add a merged heading over the first free columns (two when there is room). Returns cfg unchanged when every column has one. */
export function addHeading(cfg: GridConfig, label = 'Heading'): GridConfig {
  for (let i = 0; i < cfg.columns.length; i++) {
    const key = cfg.columns[i].key;
    if (headingOverlaps(cfg, key, 1)) continue;
    const span = cfg.columns[i + 1] && !headingOverlaps(cfg, key, 2) ? 2 : 1;
    const out = clone(cfg);
    (out.headerGroups ??= []).push({ label, from: key, ...(span > 1 ? { span } : {}) });
    return tidyGrid(out);
  }
  return cfg;
}

/** Change a heading; refused (unchanged) when it would overlap another. */
export function updateHeading(cfg: GridConfig, at: number, patch: Partial<GridHeaderGroup>): GridConfig {
  const g = cfg.headerGroups?.[at];
  if (!g) return cfg;
  const next = { ...g, ...patch };
  if (headingOverlaps(cfg, next.from, next.span ?? 1, at)) return cfg;
  const out = clone(cfg);
  out.headerGroups![at] = next;
  return tidyGrid(out);
}

export function removeHeading(cfg: GridConfig, at: number): GridConfig {
  if (!cfg.headerGroups?.[at]) return cfg;
  const out = clone(cfg);
  out.headerGroups!.splice(at, 1);
  return tidyGrid(out);
}

// ───────────────────────── Quick fill ─────────────────────────

export function setQuickFill(cfg: GridConfig, enabled: boolean): GridConfig {
  const out = clone(cfg);
  out.quickFill = { ...(out.quickFill ?? {}), enabled, presets: out.quickFill?.presets ?? [] };
  return out;
}

export function addPreset(cfg: GridConfig, label: string, scope: GridScope = 'all', value?: string): GridConfig {
  const words = label.trim().slice(0, 40);
  if (!words || gridLimitWords(cfg, 'preset')) return cfg;
  if ((cfg.quickFill?.presets ?? []).some((p) => lc(p.label) === lc(words) && (p.scope ?? 'all') === scope)) return cfg; // already there
  const out = clone(cfg);
  out.quickFill = { enabled: out.quickFill?.enabled ?? true, presets: [...(out.quickFill?.presets ?? [])] };
  out.quickFill.presets!.push({ label: words, ...(value?.trim() ? { value: value.trim().slice(0, 200) } : {}), ...(scope !== 'all' ? { scope } : {}) });
  return out;
}

export function updatePreset(cfg: GridConfig, at: number, patch: Partial<GridPreset>): GridConfig {
  const p = cfg.quickFill?.presets?.[at];
  if (!p) return cfg;
  const next = { ...p, ...patch };
  if (!next.label?.trim()) return cfg;
  next.label = next.label.trim().slice(0, 40);
  if (!next.value?.trim()) delete next.value;
  if (!next.scope || next.scope === 'all') delete next.scope;
  const out = clone(cfg);
  out.quickFill!.presets![at] = next;
  return out;
}

export function removePreset(cfg: GridConfig, at: number): GridConfig {
  if (!cfg.quickFill?.presets?.[at]) return cfg;
  const out = clone(cfg);
  out.quickFill!.presets!.splice(at, 1);
  return out;
}

// ───────────────────────── words ─────────────────────────

export function setRowHeader(cfg: GridConfig, words: string): GridConfig {
  const out = clone(cfg);
  out.rowHeader = words.trim().slice(0, 60);
  return out;
}

export function setSentences(cfg: GridConfig, patch: { row?: string; rowSeparator?: string }): GridConfig {
  const out = clone(cfg);
  out.sentences = { ...(out.sentences ?? {}), ...patch };
  return out;
}

/** The placeholders of a cell sentence and of a row sentence, in doctor words (never shown as {braces} on the card). */
export const CELL_TOKENS = [
  { text: '{label}', label: 'the box name' },
  { text: '{value}', label: 'the answer' },
  { text: '{row}', label: 'the row' },
  { text: '{column}', label: 'the column' },
  { text: '{unit}', label: 'the unit' },
] as const;
export const ROW_TOKENS = [
  { text: '{row}', label: 'the row' },
  { text: '{cells}', label: 'its answers' },
] as const;

/** A template split into words and placeholders (for the read-only line). */
export function tokenParts(text: string, tokens: readonly { text: string; label: string }[]): { text: string; token: boolean }[] {
  const out: { text: string; token: boolean }[] = [];
  const re = /\{[a-z]+\}/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const t = tokens.find((x) => x.text.toLowerCase() === m[0].toLowerCase());
    if (!t) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index), token: false });
    out.push({ text: t.label, token: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), token: false });
  return out;
}
