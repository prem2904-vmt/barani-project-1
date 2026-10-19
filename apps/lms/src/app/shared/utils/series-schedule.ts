/**
 * Repetitive-mode ("series") scheduling — pure functions shared by the
 * sample-collection drawer (and later the frontdesk order screens).
 *
 * A series is a set of tubes generated from one profile test with timed
 * repeats (e.g. OGTT: fasting / +60 min / +120 min). The backend marks each
 * such tube with `repeatOffsetMin` (0 = the anchor draw) and
 * `repeatProfileTestId` (groups siblings of the same series). Everything
 * here is CLIENT-side presentation state: the server keeps future tubes in
 * plain `pending` status; nothing below mutates anything.
 *
 * State machine (per tube, evaluated against its series siblings at nowMs):
 *
 *   repeatOffsetMin == null            → 'normal'  (not a series tube)
 *   status != 'pending'                → 'normal'  (collected/dispatched/…
 *                                        pass through — render as today)
 *   offset 0, pending                  → 'anchor'  (first draw, collect now)
 *   offset > 0, anchor not collected   → 'locked'  reason 'awaiting-anchor'
 *   offset > 0, now <  dueAt           → 'locked'  reason 'not-due'
 *   offset > 0, dueAt ≤ now < nextDue  → 'due'
 *   offset > 0, now ≥ dueAt, LAST off. → 'due'     (the tail never expires)
 *   offset > 0, now ≥ nextDue, ¬last   → 'missed'  (visual only — the server
 *                                        status stays pending; collectable
 *                                        via the drawer's override gesture)
 *
 *   dueAt   = anchor.collectedAt + offset minutes
 *   nextDue = due time of the next HIGHER offset in the same series
 */

/** Minimal sample shape the scheduler needs — `OrderSample` satisfies it. */
export interface SeriesSampleLike {
  id: string;
  status: string;
  collectedAt?: string | null;
  repeatOffsetMin?: number | null;
  repeatProfileTestId?: string | null;
}

export type SeriesStateKind = 'normal' | 'anchor' | 'locked' | 'due' | 'missed';
export type SeriesLockReason = 'awaiting-anchor' | 'not-due';

/** Flat (template-friendly) state: fields beyond `kind` are set when they
 *  apply — `reason` on 'locked'; `dueAt` on not-due/'due'/'missed';
 *  `msUntilDue` while locked not-due; `nextDueAt` on 'missed'. */
export interface SeriesState {
  kind: SeriesStateKind;
  reason?: SeriesLockReason;
  dueAt?: number;
  msUntilDue?: number;
  nextDueAt?: number;
}

const MIN_MS = 60_000;

/** True when two samples belong to the same repeat series. */
function sameSeries(a: SeriesSampleLike, b: SeriesSampleLike): boolean {
  return (a.repeatProfileTestId ?? '') === (b.repeatProfileTestId ?? '');
}

/** Epoch-ms the anchor tube was collected, or null while it's still pending
 *  (or has no parseable collectedAt). */
function anchorCollectedMs(anchor: SeriesSampleLike | undefined): number | null {
  if (!anchor || anchor.status === 'pending' || !anchor.collectedAt) return null;
  const t = Date.parse(anchor.collectedAt);
  return Number.isNaN(t) ? null : t;
}

/**
 * Compute the series state of `sample` among its `siblings` (the other
 * samples of the SAME order — non-series and other-series siblings are
 * filtered out internally) at wall-clock `nowMs`.
 */
export function seriesState(
  sample: SeriesSampleLike,
  siblings: readonly SeriesSampleLike[],
  nowMs: number
): SeriesState {
  const offset = sample.repeatOffsetMin;
  if (offset == null) return { kind: 'normal' };
  // Collected / dispatched / rejected / … render exactly as they do today.
  if (sample.status !== 'pending') return { kind: 'normal' };
  if (offset === 0) return { kind: 'anchor' };

  const series = siblings.filter(x => x.repeatOffsetMin != null && sameSeries(x, sample));
  const anchor = series.find(x => x.repeatOffsetMin === 0);
  // Defensive: a series tube with NO offset-0 sibling has no schedule to
  // compute — degrade to immediately collectable rather than locking the
  // tube forever.
  if (!anchor) return { kind: 'due', dueAt: nowMs };

  const anchorAt = anchorCollectedMs(anchor);
  if (anchorAt == null) return { kind: 'locked', reason: 'awaiting-anchor' };

  const dueAt = anchorAt + offset * MIN_MS;
  if (nowMs < dueAt) {
    return { kind: 'locked', reason: 'not-due', dueAt, msUntilDue: dueAt - nowMs };
  }

  // nextDue = due time of the next HIGHER offset in this series. The LAST
  // offset has no successor and stays 'due' forever once its time arrives.
  const higher = series
    .map(x => x.repeatOffsetMin as number)
    .filter(o => o > offset)
    .sort((a, b) => a - b);
  if (higher.length === 0) return { kind: 'due', dueAt };

  const nextDueAt = anchorAt + higher[0] * MIN_MS;
  if (nowMs < nextDueAt) return { kind: 'due', dueAt };
  return { kind: 'missed', dueAt, nextDueAt };
}

/**
 * Drawer/report ordering: normal tubes first (their existing order kept),
 * then series tubes grouped by series and ascending offset.
 */
export function sortForCollection<T extends SeriesSampleLike>(samples: readonly T[]): T[] {
  const normal = samples.filter(s => s.repeatOffsetMin == null);
  const series = samples
    .filter(s => s.repeatOffsetMin != null)
    .sort((a, b) =>
      (a.repeatProfileTestId ?? '').localeCompare(b.repeatProfileTestId ?? '') ||
      ((a.repeatOffsetMin ?? 0) - (b.repeatOffsetMin ?? 0)));
  return [...normal, ...series];
}

/** "+30 min" / "+2 h" offset chip; offset 0 reads as the first draw. */
export function offsetLabel(min: number): string {
  if (min <= 0) return 'First draw';
  if (min % 60 === 0) return `+${min / 60} h`;
  return `+${min} min`;
}

/** Live countdown "m:ss" (or "h:mm:ss" past the hour), never negative. */
export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Wall-clock "HH:mm" a due-instant lands on (local time, 24 h). */
export function dueClockLabel(dueAtMs: number): string {
  const d = new Date(dueAtMs);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}
