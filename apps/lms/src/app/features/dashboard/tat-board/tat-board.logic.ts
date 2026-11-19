import { TatState, formatDuration } from '../../../shared/utils/lab-priority';
import { LAB_TIME_ZONE, istDateOf } from '../../../shared/utils/lab-clock';

/**
 * Turnaround board — the pure logic behind the screen (no Angular): status → plain words, the four buckets and
 * their counts, department counts, the by-sample grouping and the time words. Everything is derived from the rows
 * the existing `/api/dashboard/tat` answer carries (plus the optional catalogue lookup for department / culture).
 */

/** The server's legacy TAT words → the board's TAT state (urgent = overdue, high = within the hour). */
export const FROM_SERVER: Record<string, TatState> = { urgent: 'overdue', high: 'dueSoon', normal: 'onTrack' };

export type TatBucket = 'overdue' | 'dueSoon' | 'onTrack' | 'all';
export type TatMode = 'sample' | 'test';

/** One in-flight test line as the board holds it (server row + the catalogue enrichment). */
export interface TatLine {
  orderTestId: string;
  orderId?: string | null;
  patient?: string | null;
  test?: string | null;
  status: string;
  receivedAtLab?: string | null;
  elapsedMinutes: number;
  remainingMinutes: number | null;
  tat: TatState;
  /** From the Test Master by test name — null when the catalogue isn't readable. */
  deptId?: string | null;
  deptName?: string | null;
  culture?: boolean;
}

/** One "sample" row: the tests of ONE order in ONE department (a tube), at the clock of its latest line. */
export interface SampleGroup {
  key: string;
  orderId: string | null;
  patient: string;
  deptId: string | null;
  deptName: string | null;
  lines: TatLine[];
  tat: TatState;
  /** Minutes past the due time of the MOST late line (≤ 0 = nothing is late). */
  lateMin: number | null;
  receivedAt: number | null;
  /** Epoch ms of the soonest due line. */
  dueAt: number | null;
  /** The status words of the lines (distinct, in line order). */
  nowWords: string[];
}

const STATUS_WORD: Record<string, string> = {
  pending: 'Waiting for result',
  received: 'Waiting for result',
  in_progress: 'In progress',
  re_entry: 'Result being re-entered',
  entered: 'Waiting to validate',
  awaiting_validation: 'Waiting to validate',
  rejected: 'Rejected, needs a new sample',
  validated: 'Validated',
  delivered: 'Delivered',
};

/** "some_raw_status" → "Some raw status" — the fallback so a raw key never reaches the screen. */
export function humanize(raw: string | null | undefined): string {
  const t = (raw ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'In progress';
}

/** The plain-words "Now" for a line's raw status. A culture still waiting for its result is incubating. */
export function statusWord(status: string | null | undefined, culture = false): string {
  const s = (status ?? '').trim().toLowerCase();
  if (culture && (s === 'pending' || s === 'received' || s === 'in_progress')) return 'Culture incubating';
  return STATUS_WORD[s] ?? humanize(s);
}

/** The server row → the board's line (the TAT state from the server's legacy word). */
export function toLine(r: {
  orderTestId: string; orderId?: string | null; patient?: string | null; test?: string | null; status: string;
  receivedAtLab?: string | null; elapsedMinutes: number; remainingMinutes: number | null; level?: string;
}): TatLine {
  return { ...r, tat: FROM_SERVER[r.level ?? ''] ?? 'onTrack' };
}

/** Minutes the line is past due (positive = late); null when it has no clock. */
export function lateMinutes(l: Pick<TatLine, 'remainingMinutes'>): number | null {
  return l.remainingMinutes == null ? null : Math.round(-l.remainingMinutes);
}

/** Epoch ms the line is due: lab receipt + elapsed + remaining (the server's own numbers). */
export function dueAtOf(l: Pick<TatLine, 'receivedAtLab' | 'elapsedMinutes' | 'remainingMinutes'>, now: number): number | null {
  if (l.remainingMinutes == null) return null;
  const rec = l.receivedAtLab ? new Date(l.receivedAtLab).getTime() : NaN;
  if (Number.isFinite(rec) && Number.isFinite(l.elapsedMinutes)) return rec + (l.elapsedMinutes + l.remainingMinutes) * 60000;
  return now + l.remainingMinutes * 60000;
}

const worst = (a: TatState, b: TatState): TatState => {
  const rank: Record<TatState, number> = { overdue: 0, dueSoon: 1, onTrack: 2 };
  return rank[a] <= rank[b] ? a : b;
};

/** Group lines into samples: one row per order + department (the tube), lines in the given order. */
export function groupBySample(lines: readonly TatLine[], now: number = Date.now()): SampleGroup[] {
  const map = new Map<string, SampleGroup>();
  for (const l of lines) {
    const dept = l.deptId ?? l.deptName ?? null;
    const key = `${l.orderId ?? l.orderTestId}|${dept ?? ''}`;
    let g = map.get(key);
    if (!g) {
      g = { key, orderId: l.orderId ?? null, patient: l.patient ?? '', deptId: l.deptId ?? null, deptName: l.deptName ?? null,
        lines: [], tat: 'onTrack', lateMin: null, receivedAt: null, dueAt: null, nowWords: [] };
      map.set(key, g);
    }
    g.lines.push(l);
  }
  for (const g of map.values()) {
    g.tat = g.lines.map((l) => l.tat).reduce(worst, 'onTrack' as TatState);
    const lates = g.lines.map(lateMinutes).filter((n): n is number => n !== null);
    g.lateMin = lates.length ? Math.max(...lates) : null;
    const recs = g.lines.map((l) => (l.receivedAtLab ? new Date(l.receivedAtLab).getTime() : NaN)).filter(Number.isFinite);
    g.receivedAt = recs.length ? Math.min(...recs) : null;
    const dues = g.lines.map((l) => dueAtOf(l, now)).filter((n): n is number => n !== null);
    g.dueAt = dues.length ? Math.min(...dues) : null;
    g.nowWords = [...new Set(g.lines.map((l) => statusWord(l.status, l.culture)))];
  }
  return [...map.values()];
}

/** Most late first; ties and the on-time rows by soonest due. */
export function sortSamples(groups: readonly SampleGroup[]): SampleGroup[] {
  return groups.slice().sort((a, b) => (b.lateMin ?? -Infinity) - (a.lateMin ?? -Infinity)
    || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
}

export function sortLines(lines: readonly TatLine[]): TatLine[] {
  return lines.slice().sort((a, b) => (lateMinutes(b) ?? -Infinity) - (lateMinutes(a) ?? -Infinity)
    || (a.remainingMinutes ?? Infinity) - (b.remainingMinutes ?? Infinity));
}

export interface BucketCount { id: TatBucket; samples: number; tests: number; }

/** Samples and tests per bucket (a sample counts in a bucket for the tests of it that sit there). */
export function bucketCounts(lines: readonly TatLine[], now: number = Date.now()): Record<TatBucket, BucketCount> {
  const of = (id: TatBucket, sel: readonly TatLine[]): BucketCount => ({ id, samples: groupBySample(sel, now).length, tests: sel.length });
  return {
    overdue: of('overdue', lines.filter((l) => l.tat === 'overdue')),
    dueSoon: of('dueSoon', lines.filter((l) => l.tat === 'dueSoon')),
    onTrack: of('onTrack', lines.filter((l) => l.tat === 'onTrack')),
    all: of('all', lines),
  };
}

/** The lines a bucket shows. */
export function inBucket(lines: readonly TatLine[], bucket: TatBucket): TatLine[] {
  return bucket === 'all' ? lines.slice() : lines.filter((l) => l.tat === bucket);
}

/** The bucket the board opens on: Overdue when anything is late, else everything in progress. */
export function defaultBucket(counts: Record<TatBucket, BucketCount>): TatBucket {
  return counts.overdue.tests > 0 ? 'overdue' : 'all';
}

export interface DeptCount { id: string; name: string; samples: number; late: number; }

/** Departments with their in-progress samples and how many of them are late. Empty when no line knows its department. */
export function deptCounts(lines: readonly TatLine[], now: number = Date.now()): DeptCount[] {
  const known = lines.filter((l) => l.deptName);
  const byDept = new Map<string, TatLine[]>();
  for (const l of known) byDept.set(l.deptId ?? l.deptName!, [...(byDept.get(l.deptId ?? l.deptName!) ?? []), l]);
  return [...byDept.entries()].map(([id, ls]) => ({
    id, name: ls[0].deptName!,
    samples: groupBySample(ls, now).length,
    late: groupBySample(ls.filter((l) => l.tat === 'overdue'), now).length,
  })).sort((a, b) => b.late - a.late || b.samples - a.samples || a.name.localeCompare(b.name));
}

/** The grid's search: patient, order, test, department and the plain-words status. */
export function lineHaystack(l: TatLine): unknown[] {
  return [l.patient, l.orderId, l.test, l.deptName, statusWord(l.status, l.culture)];
}

/** "Tests" cell of a sample: the headline + the first five names with "+N" beyond them. */
export function testsSummary(lines: readonly TatLine[], max = 5): { head: string; names: string } {
  const names = lines.map((l) => l.test || 'Test');
  if (names.length === 1) return { head: names[0], names: '' };
  const shown = names.slice(0, max).join(', ');
  return { head: `${names.length} tests`, names: names.length > max ? `${shown} +${names.length - max}` : shown };
}

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: LAB_TIME_ZONE });
const dayFmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: LAB_TIME_ZONE });

/** "3:20 PM" today, "Tomorrow 1:05 PM" / "Yesterday 3:20 PM", else "17 Nov, 3:20 PM" — in the lab's clock (IST). */
export function clockWords(at: number | null, now: number = Date.now()): string {
  if (at == null || !Number.isFinite(at)) return '—';
  const time = timeFmt.format(at).replace(/\s/g, ' ');
  const d = istDateOf(new Date(at));
  const today = istDateOf(new Date(now));
  if (d === today) return time;
  const diff = Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return `${dayFmt.format(at)}, ${time}`;
}

/** The "Late by" cell: how long past due, or an empty dash. */
export function lateWords(lateMin: number | null): string {
  return lateMin != null && lateMin >= 0 ? formatDuration(lateMin) : '—';
}

/** The quiet second line under Due for work not yet late: "in 25m". */
export function dueInWords(lateMin: number | null): string {
  return lateMin != null && lateMin < 0 ? `in ${formatDuration(lateMin)}` : '';
}
