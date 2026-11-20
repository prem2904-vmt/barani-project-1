import type { Order } from '../../../../shared/models/order.model';
import type { JourneyDetail, JourneyDetailStep } from '../../../../shared/components/journey-ring/journey-detail';
import { fmtMinutes } from '../../../../shared/components/journey-ring/journey-detail';
import { isNotCollected } from '../../../../shared/utils/sample-not-collected';
import { CurrencyInrPipe } from '../../../../shared/pipes/currency-inr.pipe';
import { LATE_AFTER_MIN, type FlowRow } from './flow-row';

/**
 * The flow grid row → the shared journey view (tap a ring). Only data the row already carries: the order's own
 * timestamps (created, tubes collected / dispatched / received, lines resulted / validated, the resulting tech's
 * name), its dues and the grid's late rule. A step with no timestamp shows just its name; there is no "usual time"
 * per visit type in the data, so the view shows time in clinic only.
 */
const inr = new CurrencyInrPipe();
const DONE = new Set(['validated', 'delivered', 'completed', 'cancelled']);
const ms = (s: string | null | undefined) => { const t = s ? Date.parse(s) : NaN; return Number.isNaN(t) ? null : t; };
const min = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.min(...v) : null; };
const max = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.max(...v) : null; };

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(/\s?(am|pm)$/i, m => ' ' + m.trim().toUpperCase());
}

const SOURCE: Record<string, string> = { walkin: 'Walk-in', walk_in: 'Walk-in', appointment: 'Appointment', home_collection: 'Home collection', online: 'Online booking' };

/** When each lab step finished (null = not known / not yet), by the ring's own step label. */
function labStepTimes(o: Order): Record<string, { t: number | null; by?: string | null }> {
  const live = (o.samples ?? []).filter(s => !isNotCollected(s));
  const tests = live.flatMap(s => s.tests ?? []);
  const lastResult = [...tests].filter(t => ms(t.resultedAt) !== null).sort((a, b) => ms(b.resultedAt)! - ms(a.resultedAt)!)[0];
  const resulted = max(tests.map(t => ms(t.resultedAt)));
  const validated = max(tests.map(t => ms(t.validatedAt)));
  return {
    Billing: { t: o.status === 'created' || o.status === 'draft' ? null : ms(o.createdAt as unknown as string) },
    Sample: { t: min(live.map(s => ms(s.collectedAt))) },
    Dispatch: { t: min(live.map(s => ms(s.receivedAtLab) ?? ms(s.dispatchedAt))) },
    'Result entry': { t: resulted, by: lastResult?.resultedByName ?? null },
    Validation: { t: validated },
    Result: { t: validated ?? resulted, by: lastResult?.resultedByName ?? null },
  };
}

/** The reason a late / blocked current step is late — only from what the row knows. */
function lateReason(row: FlowRow, label: string): string | null {
  if (/not collected/i.test(row.where)) return row.where;
  if (label === 'Billing' && row.due > 0) return `${inr.transform(row.due)} due — payment not taken yet.`;
  if (row.late && row.waitMin !== null) return `Waiting ${fmtMinutes(row.waitMin)} — over the ${LATE_AFTER_MIN}-minute limit.`;
  return null;
}

export function flowJourneyDetail(row: FlowRow, now: number, opts: {
  showLabel: boolean; action?: JourneyDetail['action'];
}): JourneyDetail {
  const ring = row.ring ?? [];
  const o = row.order;
  const created = o ? ms(o.createdAt as unknown as string) : (row.draft?.savedAt ?? null);
  const times = o && row.service === 'lab' && row.kind === 'order' ? labStepTimes(o) : null;
  let prev = created;
  const steps: JourneyDetailStep[] = ring.map((s, i) => {
    const step: JourneyDetailStep = { label: s.label, state: s.state };
    if (s.state === 'done') {
      const t = times?.[s.label]?.t ?? (i === 0 ? created : null);
      if (t !== null) {
        step.at = clock(t);
        if (prev !== null && i > 0) step.minutes = Math.max(0, Math.round((t - prev) / 60000));
        prev = t;
      }
      step.by = times?.[s.label]?.by ?? null;
    } else if (s.state === 'now' || s.state === 'late') {
      if (prev !== null) { step.at = clock(prev); step.minutes = Math.max(0, Math.round((now - prev) / 60000)); }
      step.note = s.state === 'late' ? (lateReason(row, s.label) ?? row.whereSub) || null : row.whereSub || null;
    }
    return step;
  });
  const finished = !!o && DONE.has(o.status);
  const src = o ? SOURCE[(o.source ?? o.collectionType ?? '').toLowerCase()] : 'Draft';
  return {
    service: row.service,
    showLabel: opts.showLabel,
    name: row.name,
    meta: row.meta || null,
    token: o?.dailyNo ? `#${o.dailyNo}` : null,
    visit: [src, created !== null ? clock(created) : null].filter(Boolean).join(' · ') || null,
    lateMin: row.late ? row.waitMin : null,
    inClinicMin: !finished && created !== null ? Math.max(0, Math.round((now - created) / 60000)) : null,
    usualMin: null,
    steps,
    action: opts.action ?? null,
  };
}
