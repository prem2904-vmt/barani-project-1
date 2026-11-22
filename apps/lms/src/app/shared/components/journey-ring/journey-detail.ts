import type { RingService, RingState } from './journey-ring';

/**
 * What the tap-to-expand journey view shows (owner-approved 2026-11-20). The HOST screen builds it from data it
 * already has — every timing / who / reason is optional: a step with nothing known shows just its name.
 */
export interface JourneyDetailStep {
  label: string;
  state: RingState;
  /** "9:40 AM" — when the step started / happened. */
  at?: string | null;
  /** Minutes the step took (done) or has taken so far (current). */
  minutes?: number | null;
  /** Who did it, when known by name. */
  by?: string | null;
  /** Current step: what is happening ("0 of 2 tubes drawn"); late / blocked: the reason ("₹450 due …"). */
  note?: string | null;
}

export interface JourneyDetail {
  service: RingService;
  /** The ring's inner service label (same rule as the row's ring). */
  showLabel: boolean;
  name: string;
  /** "34/F · AA0001". */
  meta?: string | null;
  /** "#12" — shown in the service chip. */
  token?: string | null;
  /** "Walk-in · 9:40 AM". */
  visit?: string | null;
  /** Late chip "Late · 41m" (null = not late). */
  lateMin?: number | null;
  /** Time in clinic so far; `usualMin` = the usual time for this visit type when the data has one (else omitted). */
  inClinicMin?: number | null;
  usualMin?: number | null;
  steps: JourneyDetailStep[];
  /** The row's own primary next action — the host's existing handler, never new logic. */
  action?: { label: string; aria?: string; run: () => void } | null;
}

/** "Step k of n" — the current (now / late) step, or n when everything is done. */
export function detailStepOf(steps: readonly { state: RingState }[]): { k: number; n: number } {
  const i = steps.findIndex(s => s.state === 'now' || s.state === 'late');
  return { k: i < 0 ? steps.length : i + 1, n: steps.length };
}

/** The timeline row's words: done → "9:40 AM · 4m", current → started + so far, todo → "Not started". */
export function detailLine(s: JourneyDetailStep): { time: string; sub: string } {
  if (s.state === 'todo') return { time: '', sub: 'Not started' };
  const time = [s.at, s.minutes != null ? fmtMinutes(s.minutes) : null].filter(Boolean).join(' · ');
  return { time, sub: s.by ?? '' };
}

/** Time-in-clinic bar: share of the usual time (capped at 100%), over = rose. No usual time → no bar. */
export function detailTat(inClinic: number | null | undefined, usual: number | null | undefined): { pct: number; over: boolean } | null {
  if (inClinic == null || !usual) return null;
  return { pct: Math.min(100, Math.round((inClinic / usual) * 100)), over: inClinic > usual };
}

export function fmtMinutes(m: number): string {
  if (m < 60) return `${Math.max(0, Math.round(m))}m`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h}h ${r}m` : `${h}h`;
}
