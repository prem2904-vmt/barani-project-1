/**
 * The prescription pad (consult v11) — PURE rules: word-start matching for
 * every row's entry field, what a key press in an entry does (routing), the
 * doctor's usual dose, and the per-user collapsed rows.
 */
import type { RxUsual } from '../shared/rx-schedule';

/** The pad's rows, in printed order. */
export type PadRow = 'find' | 'dx' | 'rx' | 'proc' | 'test' | 'adv' | 'fu' | 'note';
export const PAD_ROWS: readonly { key: PadRow; label: string; abbr: string }[] = [
  { key: 'find', label: 'Complaint & findings', abbr: 'C/O' },
  { key: 'dx', label: 'Diagnosis', abbr: 'Dx' },
  { key: 'rx', label: 'Medicines', abbr: 'Rx' },
  { key: 'proc', label: 'Procedures', abbr: '' },
  { key: 'test', label: 'Tests', abbr: 'Ix' },
  { key: 'adv', label: 'Advice', abbr: 'Adv' },
  { key: 'fu', label: 'Follow-up', abbr: 'F/U' },
  { key: 'note', label: 'Private note', abbr: '' },
];

const words = (s: string) => s.toLowerCase().split(/[\s+()/,.\-]+/).filter(Boolean);

/** Does `text` have a word starting with the typed word(s)? Every typed word
 *  must start some word ("amo" matches Amoxicillin, never Paracetamol). Pure. */
export function wordStartMatch(text: string, q: string): boolean {
  const qs = words(q);
  if (!qs.length) return false;
  const ws = words(text);
  return qs.every(t => ws.some(w => w.startsWith(t)));
}

export interface PadOption { id: string; label: string; meta?: string; }

/** The suggestions for a typed query: word-start matches, minus what is
 *  already on the row, best (label starts with the query) first. Pure. */
export function padSuggest<T extends PadOption>(options: readonly T[], q: string, exclude: ReadonlySet<string> = new Set(), max = 8): T[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return options
    .filter(o => !exclude.has(o.id) && wordStartMatch(`${o.label} ${o.meta ?? ''}`, t))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(t)) - Number(!b.label.toLowerCase().startsWith(t)))
    .slice(0, max);
}

/** What a key in an entry field does:
 *  - Enter on a suggestion → add it (Rx: with its usual dose, one step);
 *  - Enter on shorthand → add as typed; Enter with nothing matched → free
 *    text where the row allows it, else nothing;
 *  - Tab on a medicine suggestion → open the dose composer first. Pure. */
export type EntryAction = 'add' | 'add-parsed' | 'compose' | 'free' | 'none';
export function entryAction(key: 'Enter' | 'Tab', a: { hasPick: boolean; parsed: boolean; text: string; allowFree: boolean; composer: boolean }): EntryAction {
  if (key === 'Tab') return a.composer && a.hasPick && !a.parsed ? 'compose' : 'none';
  if (a.parsed) return 'add-parsed';
  if (a.hasPick) return 'add';
  return a.allowFree && a.text.trim() ? 'free' : 'none';
}

/** The usual dose a new line starts from: the doctor's own last line, else
 *  the drug master's UsualJson, else the fallback (1-0-1 · 5 days · after
 *  food). Pure. */
export function usualDoseFor(drugId: string, lastLines: Readonly<Record<string, RxUsual>>, usualJson: Readonly<Record<string, RxUsual>>, fallback: RxUsual): RxUsual {
  return lastLines[drugId] ?? usualJson[drugId] ?? fallback;
}

/** Fold / unfold a row (a new set — never mutates). Pure. */
export function toggleRow(collapsed: ReadonlySet<PadRow>, key: PadRow): Set<PadRow> {
  const n = new Set(collapsed);
  if (n.has(key)) n.delete(key); else n.add(key);
  return n;
}
/** localStorage key of the folded rows (per user). */
export const padCollapseKey = (userId: string | null | undefined) => `pf.opd.padCollapsed.${userId || 'anon'}`;
/** Read the folded rows back; anything unknown or malformed is ignored. Pure. */
export function parseCollapsed(raw: string | null): Set<PadRow> {
  try {
    const list = JSON.parse(raw ?? '[]');
    return new Set((Array.isArray(list) ? list : []).filter((k): k is PadRow => PAD_ROWS.some(r => r.key === k)));
  } catch { return new Set(); }
}

/** Common advice lines (one-tap chips under the Advice field). */
export const COMMON_ADVICE: readonly string[] = [
  'Drink plenty of fluids', 'Rest for 2 days', 'Warm salt-water gargles 3 times a day', 'Avoid cold drinks and ice cream',
  'Light, home-cooked food', 'Come back at once if the fever goes above 102 °F',
];

/** Advice is stored as text; on the pad it is one chip per line. Pure. */
export const adviceLines = (advice: string) => advice.split('\n').map(s => s.trim()).filter(Boolean);
