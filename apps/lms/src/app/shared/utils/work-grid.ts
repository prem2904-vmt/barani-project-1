import type { ColDef } from 'ag-grid-community';
import { formatDuration } from './lab-priority';

/**
 * Work-list grids (owner 2026-11-20: "the grid format we had against Frontdesk and Results — touch devices get more
 * room for taps"). The pure rules My Work and the Pathologist queue share; the look lives in
 * `shared/styles/_work-grid.scss`, the row height in the shared grid theme (never per screen).
 */

/** Smallest tap target on touch (ND §1) and the room between two neighbouring controls. */
export const TOUCH_TARGET_PX = 44;
export const TOUCH_GAP_PX = 8;

/** How a row action is drawn: text on web (fine pointer + hover), a 44 px target on touch; always 8 px apart. */
export function rowActionSizing(touch: boolean): { minSize: number; gap: number } {
  return { minSize: touch ? TOUCH_TARGET_PX : 32, gap: TOUCH_GAP_PX };
}

export interface Box { left: number; right: number; top: number; bottom: number; name?: string }

/**
 * The touch rule as data: every control ≥ 44×44 and ≥ 8 px from the next control on the same line.
 * Returns the problems (empty = fine). Used by the unit specs and the screens audit.
 */
export function touchViolations(boxes: readonly Box[]): string[] {
  const out: string[] = [];
  for (const b of boxes) {
    const w = b.right - b.left, h = b.bottom - b.top;
    if (w < TOUCH_TARGET_PX - 0.5 || h < TOUCH_TARGET_PX - 0.5) out.push(`${b.name ?? 'control'} is ${Math.round(w)}×${Math.round(h)}`);
  }
  const s = [...boxes].sort((a, b) => a.left - b.left);
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    const sameLine = b.top < a.bottom && b.bottom > a.top;
    if (sameLine && b.left - a.right < TOUCH_GAP_PX - 0.5) out.push(`${a.name ?? 'control'} → ${b.name ?? 'control'}: ${Math.round(b.left - a.right)}px apart`);
  }
  return out;
}

/**
 * Column tiers by the GRID's own width (My Work's pane and the Pathologist's main card change width with their side
 * panes): `full` = every column; `fold` (iPad landscape, a narrow window) = low-value columns fold into the patient /
 * tests cells so the row actions keep their full size; `tight` = only what a tech needs to pick the row.
 */
export type GridFold = 'full' | 'fold' | 'tight';
export function gridFold(width: number, full = 1040, fold = 700): GridFold {
  if (width >= full) return 'full';
  if (width >= fold) return 'fold';
  return 'tight';
}

/**
 * The tier that FITS: the widest tier whose visible columns' minimum widths (+ room for the grid's own chrome) fit the
 * grid. Fixed breakpoints drifted from the real column sums and clipped the row actions; this never can.
 */
export function fitFold(width: number, need: (f: GridFold) => number, slack = 20): GridFold {
  if (width >= need('full') + slack) return 'full';
  if (width >= need('fold') + slack) return 'fold';
  return 'tight';
}

/**
 * Step folding (owner 2026-11-21: "work grids NEVER scroll sideways"): fold one step at a time, in the given order,
 * until the visible columns' minimum widths (+ `slack` for the grid's own chrome / scrollbar) fit `width`. Each step
 * says how many px it frees. Returns the folded step ids (a prefix of `steps`). The last steps may still not fit a
 * very narrow grid — the caller's tightest minimums must then be the floor.
 */
export function foldSteps<K extends string>(width: number, base: number, steps: ReadonlyArray<{ id: K; saves: number }>, slack = 20): Set<K> {
  const out = new Set<K>();
  let need = base;
  for (const st of steps) {
    if (width >= need + slack) break;
    out.add(st.id);
    need -= st.saves;
  }
  return out;
}

/** Sum of the minimum widths of the columns a plan shows. */
export function minWidthOf(plan: ReadonlyArray<{ colId: string; hide: boolean }>, mins: Record<string, number>): number {
  return plan.filter(c => !c.hide).reduce((n, c) => n + (mins[c.colId] ?? 0), 0);
}

/** Status pill tones (neutral pill + a small coloured dot). No yellow: rose = late / sent back, violet = in hand. */
export type WorkTone = 'neutral' | 'violet' | 'green' | 'rose' | 'sky';
export interface WorkStatus { label: string; tone: WorkTone }

/** "40m" / "2h 5m" since an ISO time (empty when unknown). */
export function waitText(fromIso: string | null | undefined, now: number = Date.now()): string {
  const t = fromIso ? Date.parse(fromIso) : NaN;
  if (!Number.isFinite(t)) return '';
  return formatDuration(Math.max(0, (now - t) / 60000));
}

// ── Column rules every work grid shares (owner 2026-11-20: Frontdesk, Lab / Pathologist, Results) ──────────────
//  ALIGNMENT — text read left-to-right (patient name + meta, a status with a sub-line, IDs that are scanned) stays
//  LEFT; short same-shape values (priority, the journey ring, TAT / waiting, a single status pill) are CENTRED; the
//  row actions (primary + ⋯) are RIGHT. The header always aligns with its cells.
//  COLUMN FILTERS — every data column has Test Master's header filter: text (IDs, patient: name · MRN · phone),
//  set (statuses / priority / step — the values present), number (minutes). They AND with the card head's filters.

export type WorkAlign = 'left' | 'center' | 'right';
const ALIGN_CLASS: Record<WorkAlign, { headerClass: string; cellClass: string }> = {
  left: { headerClass: 'wg-h-left', cellClass: 'wg-c-left' },
  center: { headerClass: 'wg-h-center', cellClass: 'wg-c-center' },
  right: { headerClass: 'wg-h-right', cellClass: 'wg-c-right' },
};
/** Header + cell classes for an alignment (merge with a column's own cellClass). */
export function alignCol(a: WorkAlign, extraCell?: string): { headerClass: string; cellClass: string[] } {
  const c = ALIGN_CLASS[a];
  return { headerClass: c.headerClass, cellClass: [c.cellClass, ...(extraCell ? [extraCell] : [])] };
}

type Getter<T, V> = (row: T) => V;
interface FilterColLike<T> { filter: unknown; filterValueGetter: (p: { data?: T }) => unknown; filterParams?: Record<string, unknown> }

/** Text filter ("contains"): IDs, patient (name · MRN · phone). */
export function textFilterCol<T>(get: Getter<T, string>): FilterColLike<T> {
  return { filter: 'agTextColumnFilter', filterValueGetter: p => (p.data ? get(p.data) : ''),
    filterParams: { maxNumConditions: 1, buttons: ['reset'], debounceMs: 150 } };
}
/** Number filter in minutes (TAT / waiting). */
export function numberFilterCol<T>(get: Getter<T, number | null>): FilterColLike<T> {
  return { filter: 'agNumberColumnFilter', filterValueGetter: p => (p.data ? get(p.data) : null),
    filterParams: { maxNumConditions: 1, buttons: ['reset'], filterOptions: ['lessThan', 'greaterThan', 'equals', 'inRange'] } };
}
/** Date filter (a finished time). */
export function dateFilterCol<T>(get: Getter<T, string | null>): FilterColLike<T> {
  return {
    filter: 'agDateColumnFilter', filterValueGetter: p => { const v = p.data ? get(p.data) : null; return v ? new Date(v) : null; },
    filterParams: {
      maxNumConditions: 1, buttons: ['reset'],
      comparator: (day: Date, cell: Date | null) => {
        if (!cell) return -1;
        const c = new Date(cell.getFullYear(), cell.getMonth(), cell.getDate()).getTime();
        return c === day.getTime() ? 0 : c < day.getTime() ? -1 : 1;
      },
    },
  };
}
/** Set-style filter of the values present (statuses, priority, journey step) — `filter` = the shared component. */
export function setFilterCol<T>(get: Getter<T, string>, component: unknown): FilterColLike<T> {
  return { filter: component, filterValueGetter: p => (p.data ? get(p.data) : '') };
}
/** Minutes since an ISO time (null when unknown) — the number the TAT / Waiting filters compare. */
export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null;
}

/** A BOUND set-style filter (Results' Status / Generated / Sent): the header filter IS the screen's own filter state
 *  (`GridChoiceFilterParams`), one choice, both ways — `filter` = the shared WorkSetFilterComponent. */
export function choiceFilterCol<P>(params: P, component: unknown): { filter: unknown; filterParams: P; suppressHeaderMenuButton: true; suppressHeaderFilterButton: false } {
  return { filter: component, filterParams: params, suppressHeaderMenuButton: true, suppressHeaderFilterButton: false };
}

// ── Whole-column helpers (alignment + filter in one call) — the Frontdesk flow grid builds its columns with these ──
//  textCol (Token / ID / Patient), valuesCol (Where now / Status / Payment), numberCol (Waiting / TAT), shapeCol
//  (the ring: centred, no filter), actionCol (right, never filtered). A column's own cellClass / headerClass is kept.

function withAlign<T>(def: ColDef<T>, a: WorkAlign): ColDef<T> {
  const al = ALIGN_CLASS[a];
  const list = (x: unknown) => (Array.isArray(x) ? x : x ? [x as string] : []) as string[];
  return { ...def, cellClass: [al.cellClass, ...list(def.cellClass)], headerClass: [al.headerClass, ...list(def.headerClass)] };
}
export function textCol<T>(def: ColDef<T>, get: Getter<T, string>, a: WorkAlign = 'left'): ColDef<T> {
  return withAlign<T>({ ...def, ...(textFilterCol<T>(get) as ColDef<T>) }, a);
}
export function valuesCol<T>(def: ColDef<T>, get: Getter<T, string>, component: unknown, a: WorkAlign = 'left'): ColDef<T> {
  return withAlign<T>({ ...def, ...(setFilterCol<T>(get, component) as ColDef<T>) }, a);
}
export function numberCol<T>(def: ColDef<T>, get: Getter<T, number | null>, a: WorkAlign = 'center'): ColDef<T> {
  return withAlign<T>({ ...def, ...(numberFilterCol<T>(get) as ColDef<T>) }, a);
}
export function shapeCol<T>(def: ColDef<T>, a: WorkAlign = 'center'): ColDef<T> {
  return withAlign<T>({ ...def, filter: false }, a);
}
export function actionCol<T>(def: ColDef<T>): ColDef<T> {
  return withAlign<T>({ ...def, filter: false, sortable: false }, 'right');
}
