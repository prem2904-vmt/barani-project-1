import milestones from './data/milestones.json';
import vaccines from './data/vaccines-uip.json';
import { toDays } from './age-text';

/** One line of a checklist by age; ages are in days. Mirror of the server's `AgeChecklistData.cs`. */
export interface ChecklistItem {
  key: string;
  label: string;
  group: string;
  delay: string;
  fromDays: number;
  flagDays: number;
  /** Screen only (the server does not need it): a line of small print under the item. */
  note?: string;
}

export type ItemState = 'open' | 'done' | 'flagged' | 'later';
export type ItemAnswer = 'done' | 'notDone';

/** The reference data (sources are written inside each file). */
export const MILESTONE_DATA = milestones;
export const VACCINE_DATA = vaccines;

type Cfg = Record<string, unknown> | undefined;

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function milestoneItems(): ChecklistItem[] {
  return milestones.items.map((i) => ({
    key: i.key,
    label: i.label,
    group: i.domain,
    delay: i.delay,
    fromDays: toDays(i.fromMonths, 'months'),
    flagDays: toDays(i.byMonths, 'months'),
  }));
}

export function vaccineItems(): ChecklistItem[] {
  return vaccines.items.map((i) => ({
    key: i.key,
    label: i.label,
    group: i.group,
    delay: i.label,
    fromDays: toDays(i.due.n, i.due.unit),
    flagDays: toDays(i.until.n, i.until.unit) + 1,
    note: (i as { note?: string }).note,
  }));
}

export function domains(): { key: string; label: string }[] {
  return milestones.domains;
}

/** The lines a field asks about: the preset's (minus `exclude`), or the author's own list. */
export function resolveItems(config: Cfg): ChecklistItem[] {
  const exclude = new Set(strs(config?.['exclude']));
  const preset = config?.['preset'];
  if (preset === 'vaccines') return vaccineItems().filter((i) => !exclude.has(i.key));
  if (preset === 'custom') {
    const items = Array.isArray(config?.['items']) ? (config!['items'] as Record<string, unknown>[]) : [];
    return items.map((i) => {
      const label = String(i['label'] ?? '');
      const by = typeof i['byMonths'] === 'number' ? (i['byMonths'] as number) : null;
      const delay = typeof i['delay'] === 'string' && i['delay'] ? (i['delay'] as string) : `${label} not done`;
      return {
        key: String(i['key'] ?? ''),
        label,
        group: typeof i['group'] === 'string' ? (i['group'] as string) : '',
        delay,
        fromDays: 0,
        flagDays: by === null ? 0 : toDays(by, 'months'),
      };
    });
  }
  const wanted = new Set(strs(config?.['domains']));
  const names = new Map(domains().map((d) => [d.key, d.label]));
  return milestoneItems()
    .filter((i) => !exclude.has(i.key) && (wanted.size === 0 || wanted.has(i.group)))
    .map((i) => ({ ...i, group: names.get(i.group) ?? i.group }));
}

/**
 * Where one line stands (server `StateOf`): done = ticked; below the age it starts = later, never flagged; flagged = "not yet / not given" and
 * the age has reached the one it is expected by (or the age is unknown); an unanswered line stays open unless `unsetIsMissing`.
 */
export function stateOf(item: ChecklistItem, answer: ItemAnswer | null | undefined, ageDays: number | null, unsetIsMissing: boolean): ItemState {
  if (answer === 'done') return 'done';
  if (ageDays !== null && ageDays < item.fromDays) return 'later';
  const missing = answer === 'notDone' || unsetIsMissing;
  if (!missing) return 'open';
  if (ageDays === null) return 'flagged';
  return item.flagDays <= 0 || ageDays >= item.flagDays ? 'flagged' : 'open';
}
