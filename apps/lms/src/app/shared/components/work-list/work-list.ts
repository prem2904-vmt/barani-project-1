import type { PfAction } from '../actions-menu/actions-menu.component';

/**
 * THE small-screen work list (owner 2026-11-21: "iPad and iPhone … need not be a grid, but it should make the user
 * understand. A grid on mobile is horrible"). Below 1024px every work list (Frontdesk scopes, Lab Intake / Queue /
 * My Work / Completed / Culture, Validate, Outsourced …) is drawn by `<pf-work-list>` — full-width divider rows in
 * the desktop grid's family, never boxed cards:
 *   line 1 — the name (whole words) with the token chip;
 *   line 2 — the key facts in the SAME order as the desktop grid's columns;
 *   line 3 — the status in WORDS (soft rose late / green done, no pill) with the time (Waiting / Due) on the right;
 *   right edge — ONE primary (≥44px) + ⋯ for the rest.
 * Pure helpers only here (unit-tested); the component draws.
 */

/** Below this the work lists are drawn by `<pf-work-list>`; at 1024px and up, the grid. */
export const WORK_LIST_MQ = '(max-width: 1023.98px)';

/** Status words — the same shape as status-words' `StatusWords` (now · detail · tone), so a screen can hand either. */
export type WorkListTone = 'normal' | 'late' | 'done';
export interface WorkListStatus { now: string; detail?: string | null; tone?: WorkListTone }

export interface WorkListPrimary { id: string; label: string; disabled?: boolean; busy?: boolean; busyLabel?: string; aria?: string }

export interface WorkListItem<T = unknown> {
  id: string;
  /** Line 1: the person / the record's name. */
  name: string;
  /** The daily token source (`{ dailyNo, dailyNoDay }`) for `<pf-daily-no>`, or a plain token text. */
  daily?: unknown;
  token?: string | null;
  /** A short id shown before the name (a sample ID when the list is sample-focused). */
  lead?: string | null;
  /** "Urgent" next to the name (rose words, never a pill). */
  urgent?: boolean;
  /** Line 2: the key facts in the grid's column order; blanks drop out. */
  facts?: Array<string | null | undefined | false>;
  /** Line 3 left: the status in words. */
  status?: WorkListStatus | null;
  /** Line 3 right: the time (Waiting / Due), rose when late. */
  time?: { text: string; late?: boolean; title?: string } | null;
  /** A quiet extra line (a rejection reason). */
  notes?: string[];
  /** The ONE primary action, right edge. */
  primary?: WorkListPrimary | null;
  /** The rest, behind ⋯. */
  more?: PfAction[];
  /** Nothing to do on this row right now (received / not dispatched yet) — the row says so in words. */
  noAction?: boolean;
  /** An indented sub-row (a patient's tube under the patient row). */
  sub?: boolean;
  /** Selected / open look. */
  selected?: boolean;
  /** A screen's own state key, on the row as `data-key` (tests / styling hooks). */
  key?: string;
  /** aria-label for the row tap (defaults to the name). */
  aria?: string;
  /** The screen's own row, handed back on every output. */
  data?: T;
}

/** Line 2 text: facts joined with " · ", blanks and duplicates dropped. */
export function factsLine(facts: WorkListItem['facts']): string {
  const out: string[] = [];
  for (const f of facts ?? []) {
    const s = typeof f === 'string' ? f.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out.join(' · ');
}

/** Line 3 text: "Now · detail". */
export function statusLine(s: WorkListStatus | null | undefined): string {
  if (!s) return '';
  const d = (s.detail ?? '').trim();
  const n = (s.now ?? '').trim();
  return d ? `${n} · ${d}` : n;
}

/** Status words, turned soft rose when the row's clock says it is late (a finished row stays green). */
export function lateWords<S extends WorkListStatus>(w: S, late: boolean): S {
  return late && w.tone !== 'done' ? { ...w, tone: 'late' } : w;
}

/** A pill tone from the work grids (violet / sky / green / rose / neutral) → the word colour. */
export function toneOf(t: string | null | undefined, late = false): WorkListTone {
  if (t === 'green' || t === 'done' || t === 'ok') return 'done';
  if (late || t === 'rose' || t === 'late' || t === 'warning') return 'late';
  return 'normal';
}

// ── Sort chip (the grid headers' sort, for a list) ──
export type SortDir = 'asc' | 'desc';
export interface SortChipOption { id: string; label: string }
export interface SortableColumn { id: string; label: string; /** Default direction first in the menu. */ first?: SortDir }

/** Every column twice — the same asc / desc a header tap gives: "Due ↑", "Due ↓". Ids are `<col>:<dir>`. */
export function columnSortOptions(cols: SortableColumn[]): SortChipOption[] {
  const out: SortChipOption[] = [];
  for (const c of cols) {
    const dirs: SortDir[] = c.first === 'desc' ? ['desc', 'asc'] : ['asc', 'desc'];
    for (const d of dirs) out.push({ id: `${c.id}:${d}`, label: `${c.label} ${d === 'asc' ? '↑' : '↓'}` });
  }
  return out;
}

/** `"due:desc"` → `{ col: 'due', dir: 'desc' }` (null for anything else). */
export function parseSortId(id: string | null | undefined): { col: string; dir: SortDir } | null {
  const m = /^(.+):(asc|desc)$/.exec(id ?? '');
  return m ? { col: m[1], dir: m[2] as SortDir } : null;
}

/** The chip's words: "Sort: Due ↓", or just "Sort" when nothing is picked. */
export function sortChipText(options: SortChipOption[], value: string | null | undefined): string {
  const o = options.find(x => x.id === value);
  return o ? `Sort: ${o.label}` : 'Sort';
}

/** Sort list items by a `<col>:<dir>` id with the column's REAL value (numbers / text); blanks last both ways, stable. */
export function sortItems<T>(items: T[], sortId: string | null | undefined, values: Record<string, (t: T) => number | string | null | undefined>): T[] {
  const p = parseSortId(sortId);
  const get = p ? values[p.col] : undefined;
  if (!p || !get) return items;
  const dir = p.dir === 'asc' ? 1 : -1;
  return items.map((t, i) => ({ t, i, v: get(t) })).sort((a, b) => {
    const x = a.v, y = b.v;
    const bx = x == null || x === '', by = y == null || y === '';
    if (bx || by) return bx && by ? a.i - b.i : bx ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return c ? c * dir : a.i - b.i;
  }).map(r => r.t);
}
