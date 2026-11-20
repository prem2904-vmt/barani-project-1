import type { OrderTest } from '../models/order.model';
import { isSignedOrSkipped } from './line-status';
import { PipelineLike, RingStep, labRingSteps, validationApplies } from '../components/journey-ring/journey-ring';
import { JourneyDetail, JourneyDetailStep } from '../components/journey-ring/journey-detail';

/**
 * Lab work-list rows (My Work tubes / patients, the Pathologist queue) → the SHARED journey ring and its journey view
 * (owner 2026-11-20). Only what the lines already carry: the order's created time, the tube's collected / received
 * times, the lines' resulted / validated times and the resulting tech's name. The lab line is the ring's own
 * Billing · Sample · Dispatch · Result entry · Validation (or · Result where results release without validation).
 */

const ms = (s: string | null | undefined) => { const t = s ? Date.parse(s) : NaN; return Number.isNaN(t) ? null : t; };
const pick = (xs: (number | null)[], f: (...n: number[]) => number) => { const v = xs.filter((x): x is number => x !== null); return v.length ? f(...v) : null; };
const entered = (s: string | null | undefined) => s === 'entered' || isSignedOrSkipped(s);

/** The 5-step pipeline the ring reads (Billing · Sample · Dispatch · Result · Report) for these lines. */
export function labLinePipeline(lines: readonly OrderTest[]): PipelineLike[] {
  const received = lines.some(l => !!l.subOrder?.receivedAtLab);
  const allIn = lines.length > 0 && lines.every(l => entered(l.status));
  const anyIn = lines.some(l => entered(l.status));
  const allSigned = lines.length > 0 && lines.every(l => isSignedOrSkipped(l.status));
  return [
    { label: 'Billing', state: 'done' },
    { label: 'Sample', state: 'done' },
    { label: 'Dispatch', state: received ? 'done' : 'active' },
    { label: 'Result', state: allIn ? 'done' : received ? 'active' : 'pending' },
    { label: 'Report', state: allSigned ? 'done' : allIn || anyIn ? 'active' : 'pending' },
  ];
}

/** The ring's steps for these lines; `late` = the screen's own overdue / TAT rule. */
export function labLineRing(lines: readonly OrderTest[], late: boolean): RingStep[] {
  return labRingSteps(labLinePipeline(lines), { late, validation: validationApplies(lines) });
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(am|pm)$/i, m => ' ' + m.trim().toUpperCase());
}

/** The journey view for a lab row. `note` = what the current step is waiting on ("Due 22:38" / "Overdue by 20m"). */
export function labLineDetail(o: {
  lines: readonly OrderTest[]; ring: readonly RingStep[]; name: string; meta?: string | null; now?: number;
  lateMin?: number | null; note?: string | null; action?: JourneyDetail['action'];
}): JourneyDetail {
  const now = o.now ?? Date.now();
  const l = o.lines;
  const order = l[0]?.subOrder?.order as { createdAt?: string; dailyNo?: number | null } | undefined;
  const created = ms(order?.createdAt);
  const resultedLine = [...l].filter(x => ms(x.resultedAt) !== null).sort((a, b) => ms(b.resultedAt)! - ms(a.resultedAt)!)[0];
  const resulted = pick(l.map(x => ms(x.resultedAt)), Math.max);
  const validated = pick(l.map(x => ms(x.validatedAt)), Math.max);
  const times: Record<string, { t: number | null; by?: string | null }> = {
    Billing: { t: created },
    Sample: { t: pick(l.map(x => ms(x.subOrder?.collectedAt)), Math.min) },
    Dispatch: { t: pick(l.map(x => ms(x.subOrder?.receivedAtLab)), Math.min) },
    'Result entry': { t: resulted, by: resultedLine?.resultedByName ?? null },
    Validation: { t: validated },
    Result: { t: validated ?? resulted, by: resultedLine?.resultedByName ?? null },
  };
  let prev = created;
  const steps: JourneyDetailStep[] = o.ring.map((s, i) => {
    const step: JourneyDetailStep = { label: s.label, state: s.state };
    if (s.state === 'done') {
      const t = times[s.label]?.t ?? null;
      if (t !== null) {
        step.at = clock(t);
        if (prev !== null && i > 0) step.minutes = Math.max(0, Math.round((t - prev) / 60000));
        prev = t;
      }
      step.by = times[s.label]?.by ?? null;
    } else if (s.state === 'now' || s.state === 'late') {
      if (prev !== null) { step.at = clock(prev); step.minutes = Math.max(0, Math.round((now - prev) / 60000)); }
      step.note = o.note ?? null;
    }
    return step;
  });
  const received = times['Dispatch'].t;
  const finished = o.ring.length > 0 && o.ring.every(s => s.state === 'done');
  return {
    service: 'lab',
    showLabel: false,   // lab grids are a single-service context: a blank neutral disc
    name: o.name,
    meta: o.meta ?? null,
    token: order?.dailyNo ? `#${order.dailyNo}` : null,
    visit: received !== null ? `In lab since ${clock(received)}` : null,
    lateMin: o.lateMin ?? null,
    inClinicMin: !finished && received !== null ? Math.max(0, Math.round((now - received) / 60000)) : null,
    usualMin: null,
    steps,
    action: o.action ?? null,
  };
}
