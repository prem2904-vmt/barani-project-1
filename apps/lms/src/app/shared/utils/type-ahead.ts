/**
 * Spreadsheet-style type-to-select for pf-select (owner request 2026-10-11:
 * lab techs pick Positive / Negative / Nil / 1+ … from the keyboard without
 * opening the list). Pure + DOM-free so the matcher is unit-tested on its own;
 * pf-select owns the key handling and only asks "which option for this query?".
 *
 * Ranking (case-insensitive, option order breaks ties):
 *   0  exact label            ("1+"  → "1+",  never "1++")
 *   1  whole-label prefix     ("po"  → "Positive")
 *   2  prefix after leading spaces / punctuation ("nil" → "(Nil)", "pos" → "- Positive")
 *   3  word-start             ("det" → "Not detected", "+" → "Trace +")
 * A query made of ONE character repeated ("pp", "nnn") that matches nothing
 * as typed cycles through the options starting with that character instead —
 * so P, P, P walks Positive → Preliminary → Positive. A repeated symbol that
 * IS a real option ("++", "+++") is matched as typed (dipstick grading).
 */

export const TYPE_AHEAD_RESET_MS = 800;

export interface TypeAheadItem {
  label: string;
  disabled?: boolean;
}

/** Where the query matched inside a label (for highlighting). */
export interface TypeAheadHit {
  index: number;
  rank: 0 | 1 | 2 | 3;
  /** Offset of the matched run inside the ORIGINAL label. */
  start: number;
  length: number;
}

const ALNUM = /[\p{L}\p{N}]/u;

function isAlnum(ch: string): boolean {
  return ALNUM.test(ch);
}

/** Offset of the first letter/digit (leading spaces + punctuation skipped). */
function firstAlnum(label: string): number {
  for (let i = 0; i < label.length; i++) if (isAlnum(label[i])) return i;
  return -1;
}

/** Best match position of `q` (already lower-cased, non-empty) in one label. */
export function matchLabel(label: string, q: string): { rank: 0 | 1 | 2 | 3; start: number } | null {
  if (!q) return null;
  const lower = label.toLowerCase();
  const lead = lower.length - lower.trimStart().length;
  const trimmed = lower.slice(lead);
  if (trimmed.trimEnd() === q) return { rank: 0, start: lead };
  if (trimmed.startsWith(q)) return { rank: 1, start: lead };
  const a = firstAlnum(lower);
  if (a > lead && lower.startsWith(q, a)) return { rank: 2, start: a };
  // Word start: a position whose previous char is not a letter/digit and
  // where the query begins. Symbols count too ("+" in "Trace +").
  for (let i = 1; i < lower.length; i++) {
    const prev = lower[i - 1];
    if (lower[i] === ' ') continue;
    if (!isAlnum(prev) && lower.startsWith(q, i)) return { rank: 3, start: i };
  }
  return null;
}

/** Every matching item, best rank first, then option order. */
export function rankMatches(items: readonly TypeAheadItem[], query: string): TypeAheadHit[] {
  const q = query.toLowerCase().trimStart();
  if (!q) return [];
  const hits: TypeAheadHit[] = [];
  items.forEach((it, index) => {
    if (it.disabled) return;
    const m = matchLabel(it.label, q);
    if (m) hits.push({ index, rank: m.rank, start: m.start, length: q.length });
  });
  return hits.sort((x, y) => x.rank - y.rank || x.index - y.index);
}

function isRepeatOfOneChar(q: string): boolean {
  return q.length > 1 && [...q].every(ch => ch === q[0]);
}

/**
 * The option a query selects, or -1 when nothing matches (the caller keeps
 * the current selection — never clears it).
 *
 * @param current index of the option shown right now (-1 = none); a single
 *   character (or a repeated one) steps to the NEXT option with that initial
 *   after it, wrapping — the cycle.
 */
export function typeAheadIndex(items: readonly TypeAheadItem[], query: string, current: number): number {
  const q = query.toLowerCase().trimStart();
  if (!q) return -1;
  const cycleChar = q.length === 1 ? q : (isRepeatOfOneChar(q) && !rankMatches(items, q).length ? q[0] : null);
  if (cycleChar === null) {
    const hits = rankMatches(items, q);
    return hits.length ? hits[0].index : -1;
  }
  const hits = rankMatches(items, cycleChar);
  if (!hits.length) return -1;
  // Cycle among options that START with the character (ranks 0–2), in
  // option order; word-start matches only when nothing starts with it.
  const starts = hits.filter(h => h.rank <= 2);
  const pool = (starts.length ? starts : hits).map(h => h.index).sort((a, b) => a - b);
  const pos = pool.indexOf(current);
  return pos < 0 ? pool[0] : pool[(pos + 1) % pool.length];
}

/**
 * The keystroke buffer: characters typed within `resetMs` of each other
 * build one query ("p" then "o" = "po"); a pause starts a new one.
 * `now` is injected so the timeout is testable without timers.
 */
export class TypeAheadBuffer {
  private query = '';
  private last = -Infinity;

  constructor(private readonly resetMs = TYPE_AHEAD_RESET_MS) {}

  /** Append one typed character; returns the query to match. */
  push(ch: string, now: number): string {
    if (now - this.last > this.resetMs) this.query = '';
    this.last = now;
    this.query += ch;
    return this.query;
  }

  /** True while a query is still being typed (Space then joins it). */
  active(now: number): boolean {
    return this.query.length > 0 && now - this.last <= this.resetMs;
  }

  current(now: number): string {
    return this.active(now) ? this.query : '';
  }

  reset(): void {
    this.query = '';
    this.last = -Infinity;
  }
}

/** Label split around the highlighted run: [before, hit, after]. For the
 *  open list's subtle prefix highlight; a search-box query that only matches
 *  mid-word (pf-select's `includes` filter) highlights its first occurrence. */
export function highlightParts(label: string, query: string): [string, string, string] {
  const q = query.toLowerCase().trimStart();
  if (!q) return [label, '', ''];
  const m = matchLabel(label, q);
  let start = m?.start ?? -1;
  if (start < 0) start = label.toLowerCase().indexOf(q);
  if (start < 0) return [label, '', ''];
  return [label.slice(0, start), label.slice(start, start + q.length), label.slice(start + q.length)];
}
