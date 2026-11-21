import type { ColDef } from 'ag-grid-community';
import { formatDuration } from './lab-priority';
import { labToday } from './lab-clock';

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
  const list = (x: unknown) => (Array.isArray(x) ? x : x ? String(x).split(/\s+/).filter(Boolean) : []) as string[];
  return { ...def, cellClass: [al.cellClass, ...list(def.cellClass)], headerClass: [al.headerClass, ...list(def.headerClass)] };
}
/** Text column: text filter over `get` (name · MRN · phone…), sorted case-insensitively by `sortBy` (default `get`) —
 *  the WHOLE text, not its first word; blanks / "—" last both ways. */
export function textCol<T>(def: ColDef<T>, get: Getter<T, string>, a: WorkAlign = 'left', sortBy: Getter<T, string | null> = get): ColDef<T> {
  return withAlign<T>({ ...def, ...(textFilterCol<T>(get) as ColDef<T>), ...textSort<T>(sortBy) }, a);
}
/** Categorical column (status / step / priority): the shared set filter of the values present; sorted by `rank`
 *  (a workflow / severity order) when given, else by the value's text. */
export function valuesCol<T>(def: ColDef<T>, get: Getter<T, string>, component: unknown, a: WorkAlign = 'left', rank?: Getter<T, number | null>): ColDef<T> {
  return withAlign<T>({ ...def, ...(setFilterCol<T>(get, component) as ColDef<T>), ...(rank ? numSort<T>(rank) : textSort<T>(get)) }, a);
}
/** Plain number column (a count): number filter + numeric sort on the same number. */
export function numberCol<T>(def: ColDef<T>, get: Getter<T, number | null>, a: WorkAlign = 'center'): ColDef<T> {
  return withAlign<T>({ ...def, ...(numberFilterCol<T>(get) as ColDef<T>), ...numSort<T>(get) }, a);
}
/** A drawn shape (the journey ring): centred. With `progress` (0–1 of the row's steps done) it sorts and filters by
 *  it like a ratio; without, it is decoration (no sort, no filter). */
export function shapeCol<T>(def: ColDef<T>, a: WorkAlign = 'center', progress?: Getter<T, number | null>): ColDef<T> {
  if (!progress) return withAlign<T>({ ...def, filter: false, sortable: false }, a);
  return withAlign<T>({ ...def, ...ratioFilter<T>(progress), ...numSort<T>(progress) }, a);
}
export function actionCol<T>(def: ColDef<T>): ColDef<T> {
  return withAlign<T>({ ...def, filter: false, sortable: false }, 'right');
}

// ── Due (owner 2026-11-21: the lab / validation / culture grids show TIME LEFT, not a journey ring — every row there
//    is by definition at that one step) ──────────────────────────────────────────────────────────────────────────
export interface DueCell { text: string; late: boolean; detail: string }
/** "in 25m" while there is time; rose "12m late" once past; "—" with no clock; "Done" when nothing is left to do. */
export function dueCell(remainingMin: number | null | undefined, opts: { done?: boolean } = {}): DueCell {
  if (opts.done) return { text: 'Done', late: false, detail: 'Nothing left to do' };
  if (remainingMin == null || !Number.isFinite(remainingMin)) return { text: '—', late: false, detail: 'No turnaround time set' };
  if (remainingMin > 0) return { text: `in ${formatDuration(remainingMin)}`, late: false, detail: `Due in ${formatDuration(remainingMin)}` };
  return { text: `${formatDuration(-remainingMin)} late`, late: true, detail: `Overdue by ${formatDuration(-remainingMin)}` };
}
/** The number the Due column sorts / filters on (minutes left; no clock sorts last). */
export function dueValue(remainingMin: number | null | undefined): number | null {
  return remainingMin == null || !Number.isFinite(remainingMin) ? null : Math.round(remainingMin);
}
/** AG-Grid comparator for a Due column: soonest (most late) first, no clock last. */
export function dueComparator(a: number | null | undefined, b: number | null | undefined): number {
  const x = a ?? Number.POSITIVE_INFINITY, y = b ?? Number.POSITIVE_INFINITY;
  return x === y ? 0 : x < y ? -1 : 1;
}

// ── SORT + FILTER ON THE REAL VALUE (owner 2026-11-21: "wherever the math is there, it should sort by the math") ──
//  Every data column of a work grid is built by ONE typed helper that sets the sort value (valueGetter), the
//  comparator, the filter and its value together — so a column can never be built with a filter and no sort, or sort
//  by its displayed text ("1364h 20m" < "41m"). Durations / due / money / counts / dates / tokens sort NUMERICALLY;
//  text sorts case-insensitively by the whole text; blanks ("—", null) go LAST in both directions. Header clicks cycle
//  asc → desc → none. A full-width detail row returns its parent's value, so it never leaves its parent.

/** asc → desc → none on every sortable work-grid header. */
export const SORT_CYCLE: ColDef['sortingOrder'] = ['asc', 'desc', null];

const BLANK_TEXT = new Set(['', '—', '-', '–']);
const isBlankNum = (v: unknown): boolean => v == null || typeof v !== 'number' || !Number.isFinite(v);
const isBlankText = (v: unknown): boolean => v == null || BLANK_TEXT.has(String(v).trim());

/** Numeric compare with blanks last in BOTH directions (AG-Grid flips the result when `desc`). */
export function compareNum(a: number | null | undefined, b: number | null | undefined, desc = false): number {
  const na = isBlankNum(a), nb = isBlankNum(b);
  if (na && nb) return 0;
  if (na) return desc ? -1 : 1;
  if (nb) return desc ? 1 : -1;
  return (a as number) === (b as number) ? 0 : (a as number) < (b as number) ? -1 : 1;
}
/** Text compare: case- and accent-insensitive, digits by value ("Bed 2" < "Bed 10"), blanks / "—" last both ways. */
export function compareText(a: string | null | undefined, b: string | null | undefined, desc = false): number {
  const na = isBlankText(a), nb = isBlankText(b);
  if (na && nb) return 0;
  if (na) return desc ? -1 : 1;
  if (nb) return desc ? 1 : -1;
  return String(a).trim().localeCompare(String(b).trim(), 'en', { sensitivity: 'base', numeric: true });
}
/** AG-Grid comparator signature → compareNum / compareText. */
export const numComparator = (a: unknown, b: unknown, _na?: unknown, _nb?: unknown, desc?: boolean): number =>
  compareNum(a as number | null, b as number | null, !!desc);
export const textComparator = (a: unknown, b: unknown, _na?: unknown, _nb?: unknown, desc?: boolean): number =>
  compareText(a as string | null, b as string | null, !!desc);

type SortPart<T> = Pick<ColDef<T>, 'sortable' | 'sortingOrder' | 'valueGetter' | 'comparator'>;
function numSort<T>(get: Getter<T, number | null>): SortPart<T> {
  return { sortable: true, sortingOrder: SORT_CYCLE, valueGetter: p => (p.data ? get(p.data) : null), comparator: numComparator };
}
function textSort<T>(get: Getter<T, string | null>): SortPart<T> {
  return { sortable: true, sortingOrder: SORT_CYCLE, valueGetter: p => (p.data ? get(p.data) : null), comparator: textComparator };
}

// ── Formatting: ONE duration formatter for every grid ("2d 4h", never "1364h 20m") ──────────────────────────────
/** "40m" · "6h 59m" · "2d 4h" (minutes rounded, min 1m; sign ignored). "—" when unknown. */
export function durationText(min: number | null | undefined): string {
  return isBlankNum(min) ? '—' : formatDuration(min as number);
}

// ── Number-filter presets (a tap, no typing; listed first, the typed "Greater than" stays the default) ─────────────────────────────────────────────────────────────────
interface Preset { displayKey: string; displayName: string; numberOfInputs: 0; predicate: (fv: unknown[], v: number | null) => boolean }
const preset = (displayKey: string, displayName: string, test: (v: number) => boolean): Preset =>
  ({ displayKey, displayName, numberOfInputs: 0, predicate: (_f, v) => !isBlankNum(v) && test(v as number) });
const NUM_OPTIONS = ['greaterThan', 'lessThan', 'inRange', 'equals'];

/** Waiting / time-in-lab presets (minutes since). `lateAfter` = the screen's own "late" rule. */
export function waitPresets(lateAfter = 30): Preset[] {
  return [
    preset('wgLate', 'Late only', v => v >= lateAfter),
    preset('wgOver30', '> 30 min', v => v > 30),
    preset('wgOver1h', '> 1 h', v => v > 60),
    preset('wgOver4h', '> 4 h', v => v > 240),
    preset('wgOverDay', '> 1 day', v => v > 1440),
  ];
}
/** Due presets (minutes LEFT; negative = late). */
export function duePresets(): Preset[] {
  return [
    preset('wgLate', 'Late only', v => v < 0),
    preset('wgDue30', 'Due in 30 min', v => v >= 0 && v <= 30),
    preset('wgDue2h', 'Due in 2 h', v => v >= 0 && v <= 120),
    preset('wgOnTime', 'Not late', v => v >= 0),
  ];
}

// ── Typed column helpers ──────────────────────────────────────────────────────────────────────────────────────
export interface DurationOpts {
  /** 'wait' = minutes since (bigger = longer waiting); 'due' = minutes left (negative = late). */
  kind?: 'wait' | 'due';
  /** The screen's late rule for the Waiting presets (minutes). */
  lateAfter?: number;
  align?: WorkAlign;
}
/** Duration column (Waiting / Due / TAT / incubation): sorts and filters on MINUTES; filter in minutes with presets. */
export function durationCol<T>(def: ColDef<T>, minutes: Getter<T, number | null>, o: DurationOpts = {}): ColDef<T> {
  const presets = o.kind === 'due' ? duePresets() : waitPresets(o.lateAfter);
  return withAlign<T>({
    ...def, ...numSort<T>(minutes),
    filter: 'agNumberColumnFilter', filterValueGetter: p => (p.data ? minutes(p.data) : null),
    filterParams: { maxNumConditions: 1, buttons: ['reset'], filterOptions: [...presets, ...NUM_OPTIONS], defaultOption: 'greaterThan',
      filterPlaceholder: 'Minutes' },
  }, o.align ?? 'center');
}

/** Money column ("₹450 due" vs "Paid"): sorts on PAISE (integer, no float drift), filters in rupees. `rupees` =
 *  the amount the column is about (the due); null = nothing billed (sorts last). */
export function moneyCol<T>(def: ColDef<T>, rupees: Getter<T, number | null>, a: WorkAlign = 'center'): ColDef<T> {
  const paise = (r: T) => { const v = rupees(r); return isBlankNum(v) ? null : Math.round((v as number) * 100); };
  return withAlign<T>({
    ...def, ...numSort<T>(paise),
    filter: 'agNumberColumnFilter', filterValueGetter: p => (p.data ? rupees(p.data) : null),
    filterParams: { maxNumConditions: 1, buttons: ['reset'], filterPlaceholder: '₹', defaultOption: 'greaterThan',
      filterOptions: [preset('wgDue', 'Has dues', v => v > 0), preset('wgClear', 'Nothing due', v => v === 0), ...NUM_OPTIONS] },
  }, a);
}

/** A count "done of total" as a ratio (0–1); total 0 / unknown → null. */
export function ratioValue(done: number | null | undefined, total: number | null | undefined): number | null {
  if (isBlankNum(done) || isBlankNum(total) || !(total as number > 0)) return null;
  return (done as number) / (total as number);
}
function ratioFilter<T>(ratio: Getter<T, number | null>): Pick<ColDef<T>, 'filter' | 'filterValueGetter' | 'filterParams'> {
  return {
    filter: 'agNumberColumnFilter',
    filterValueGetter: p => { const v = p.data ? ratio(p.data) : null; return isBlankNum(v) ? null : Math.round((v as number) * 100); },
    filterParams: { maxNumConditions: 1, buttons: ['reset'], filterPlaceholder: '%', defaultOption: 'greaterThan',
      filterOptions: [preset('wgNone', 'None yet', v => v === 0), preset('wgSome', 'Partly', v => v > 0 && v < 100), preset('wgAll', 'All done', v => v >= 100), ...NUM_OPTIONS] },
  };
}
/** Count column ("0 of 2 drawn"): sorts by the ratio done / total (ties: bigger total first in asc = less done);
 *  filters by percent done with presets None yet / Partly / All done. */
export function ratioCol<T>(def: ColDef<T>, count: Getter<T, { done: number; total: number } | null>, a: WorkAlign = 'center'): ColDef<T> {
  const ratio = (r: T) => { const c = count(r); return c ? ratioValue(c.done, c.total) : null; };
  // Tie-break inside the ratio by the total (0 of 3 before 0 of 1 when ascending: more still to do).
  const key = (r: T) => { const c = count(r); const v = c ? ratioValue(c.done, c.total) : null; return v == null || !c ? null : v - Math.min(c.total, 999) / 1e6; };
  return withAlign<T>({ ...def, ...numSort<T>(key), ...ratioFilter<T>(ratio) }, a);
}

/** Epoch ms of an ISO time / epoch (null when unknown). */
export function epochOf(v: string | number | Date | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
}
/** Date / time column ("Completed 9:48 PM", "Yesterday", "18 Nov"): sorts on EPOCH, AG-Grid date filter. */
export function dateCol<T>(def: ColDef<T>, at: Getter<T, string | number | null>, a: WorkAlign = 'center'): ColDef<T> {
  const iso = (r: T) => { const e = epochOf(at(r)); return e == null ? null : new Date(e).toISOString(); };
  return withAlign<T>({ ...def, ...numSort<T>(r => epochOf(at(r))), ...(dateFilterCol<T>(iso) as ColDef<T>) }, a);
}

/** The sort number of a daily token: its IST day then its number ("12" today, "2 · 1 Oct" = 1 Oct's #2). */
export function tokenValue(no: number | null | undefined, day?: string | null, today: string = labToday()): number | null {
  if (isBlankNum(no) || !((no as number) > 0)) return null;
  const d = Date.parse(`${day || today}T00:00:00Z`);
  return (Number.isFinite(d) ? d / 86_400_000 : 0) * 100_000 + (no as number);
}
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** …from a token's LABEL: "#12", "12", "A-12", "2 · 1 Oct" (an older day; the year is the latest not after today). */
export function tokenLabelValue(label: string | null | undefined, today: string = labToday()): number | null {
  const s = String(label ?? '').trim();
  const m = /(\d+)\s*(?:·\s*(\d{1,2})\s+([A-Za-z]{3}))?\s*$/.exec(s);
  if (!m) return null;
  const no = Number(m[1]);
  if (!m[2]) return tokenValue(no, today, today);
  const mon = MON[m[3].toLowerCase()];
  if (!mon) return tokenValue(no, today, today);
  const ty = Number(today.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, '0');
  let day = `${ty}-${pad(mon)}-${pad(Number(m[2]))}`;
  if (day > today) day = `${ty - 1}-${pad(mon)}-${pad(Number(m[2]))}`;
  return tokenValue(no, day, today);
}
/** Token column (daily number "12" / "2 · 1 Oct", OPD "A-12"): sorts by day then number; text filter on the label. */
export function tokenCol<T>(def: ColDef<T>, label: Getter<T, string>, value: Getter<T, number | null>, a: WorkAlign = 'center'): ColDef<T> {
  return withAlign<T>({ ...def, ...(textFilterCol<T>(label) as ColDef<T>), ...numSort<T>(value) }, a);
}

/** A BOUND choice-filter column (Results' Status / Generated / Sent: the header filter IS the side card's state) that
 *  still sorts on its real value — `num` (epoch, a rank) or `text` (case-insensitive, blanks last). */
export function choiceCol<T, P>(def: ColDef<T>, params: P, component: unknown, sort: { num: Getter<T, number | null> } | { text: Getter<T, string | null> }, a: WorkAlign = 'left'): ColDef<T> {
  const by = 'num' in sort ? numSort<T>(sort.num) : textSort<T>(sort.text);
  return withAlign<T>({ ...def, ...(choiceFilterCol(params, component) as ColDef<T>), ...by }, a);
}

/** Does a column def sort and filter? (the rule the specs check on every grid's data columns) */
export function sortsAndFilters(c: ColDef<unknown>): boolean {
  return c.sortable === true && !!c.filter && typeof c.comparator === 'function' && typeof c.valueGetter === 'function';
}
