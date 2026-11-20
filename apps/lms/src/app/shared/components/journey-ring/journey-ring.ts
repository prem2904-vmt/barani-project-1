/**
 * `pf-journey-ring` — the pure step model (owner-approved 2026-11-20). A row's journey is the list of ITS OWN steps
 * (never padded to a fixed count), each done / now / late / todo. Screen-agnostic: no Frontdesk / Lab imports —
 * a screen maps its own data (an order's pipeline, a status) through these helpers and hands the steps to the ring.
 *
 *  - `ringSteps(labels, current, { late })` — the generic builder: steps before `current` are done, `current` is now
 *    (or late when blocked / past its threshold), the rest todo; `current` = −1 → every step done.
 *  - `labRingSteps(pipeline, { late, validation })` — the lab line: Billing · Sample · Dispatch · Result entry ·
 *    Validation (5), or Billing · Sample · Dispatch · Result (4) where results release without validation.
 *  - `validationApplies(tests)` — read from the row's own tests: a line released the moment it was resulted (no
 *    separate validation) means no validation step; anything else (and no evidence yet) keeps it.
 *  - `statusRingSteps(service, status, { late })` — OPD / IPD / Scan / ER from the order status alone.
 */

export type RingService = 'lab' | 'opd' | 'ipd' | 'scan' | 'er';
export type RingState = 'done' | 'now' | 'late' | 'todo';
export interface RingStep { label: string; state: RingState }

/** Inner disc text. */
export const RING_SERVICE_LABEL: Record<RingService, string> = { lab: 'LAB', opd: 'OPD', ipd: 'IPD', scan: 'SCAN', er: 'ER' };
/** Spoken / tooltip name. */
export const RING_SERVICE_NAME: Record<RingService, string> = { lab: 'Lab', opd: 'OPD', ipd: 'IPD', scan: 'Scan', er: 'ER' };

export function ringSteps(labels: readonly string[], current: number, opts: { late?: boolean } = {}): RingStep[] {
  return labels.map((label, i) => ({
    label,
    state: current < 0 || i < current ? 'done' : i === current ? (opts.late ? 'late' : 'now') : 'todo',
  }));
}

/** One step of an existing pipeline (e.g. the Frontdesk drawer's Billing → Sample → Dispatch → Result → Report). */
export interface PipelineLike { label: string; state: 'done' | 'active' | 'pending' | 'stopped' }

export const LAB_STEPS_VALIDATED = ['Billing', 'Sample', 'Dispatch', 'Result entry', 'Validation'] as const;
export const LAB_STEPS_DIRECT = ['Billing', 'Sample', 'Dispatch', 'Result'] as const;

/** The lab line from a 5-step pipeline (Billing · Sample · Dispatch · Result · Report). Without validation the last
 *  two collapse into ONE "Result" step (done only when the report is). A stopped step (sample not collected) is the
 *  current one and reads late — it is blocked. */
export function labRingSteps(pipeline: readonly PipelineLike[], opts: { late?: boolean; validation?: boolean } = {}): RingStep[] {
  const validation = opts.validation !== false;
  const base = pipeline.slice(0, 3);
  const result = pipeline[3], report = pipeline[4];
  const steps: PipelineLike[] = validation
    ? [...base, ...(result ? [result] : []), ...(report ? [report] : [])]
    : [...base, ...(report ? [{ label: 'Result', state: report.state === 'done' ? 'done' : (result?.state === 'pending' ? 'pending' : 'active') } as PipelineLike] : [])];
  const labels = validation ? LAB_STEPS_VALIDATED.slice(0, steps.length) : LAB_STEPS_DIRECT.slice(0, steps.length);
  const current = steps.findIndex(s => s.state !== 'done');
  const blocked = current >= 0 && steps[current].state === 'stopped';
  return ringSteps(labels, current, { late: opts.late || blocked });
}

/** Does this row's lab work go through validation? From its own test lines: released at the moment of result entry
 *  (validatedAt === resultedAt) on every released line = direct release (no validation step). */
export function validationApplies(tests: readonly { status?: string; resultedAt?: string | null; validatedAt?: string | null }[]): boolean {
  const released = tests.filter(t => t.status === 'validated' && t.validatedAt);
  if (!released.length) return true;
  return !released.every(t => t.resultedAt && t.resultedAt === t.validatedAt);
}

/** OPD / IPD / Scan / ER: the order status is all the row carries, so three honest steps each. */
export const STATUS_STEPS: Record<Exclude<RingService, 'lab'>, readonly string[]> = {
  opd: ['Billing', 'Consult', 'Done'],
  ipd: ['Admission', 'Care', 'Discharge'],
  scan: ['Billing', 'Scan', 'Report'],
  er: ['Triage', 'Treatment', 'Out'],
};
const FINISHED = new Set(['validated', 'delivered', 'completed']);

export function statusRingSteps(service: Exclude<RingService, 'lab'>, status: string, opts: { late?: boolean } = {}): RingStep[] {
  const labels = STATUS_STEPS[service];
  if (status === 'cancelled') return labels.map(label => ({ label, state: 'todo' as const }));
  let current = 1;
  if (FINISHED.has(status)) current = -1;
  else if (status === 'created' || status === 'draft') current = 0;
  else if (service === 'scan' && (status === 'resulted' || status === 'partially_validated')) current = 2;
  return ringSteps(labels, current, opts);
}

/* ── Words ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** "Lab · step 3 of 5 · Dispatch · in progress" / "… · late" / "Lab · all 5 steps done". */
export function ringAria(service: RingService, steps: readonly RingStep[], name = RING_SERVICE_NAME[service]): string {
  const n = steps.length;
  if (!n) return `${name} · no steps`;
  const i = steps.findIndex(s => s.state === 'now' || s.state === 'late');
  if (i < 0) return steps.every(s => s.state === 'done') ? `${name} · all ${n} steps done` : `${name} · not started`;
  return `${name} · step ${i + 1} of ${n} · ${steps[i].label} · ${steps[i].state === 'late' ? 'late' : 'in progress'}`;
}

/** The tooltip's lines: done / now / late / next. */
export function ringTipLines(steps: readonly RingStep[]): { label: string; state: RingState; word: string }[] {
  return steps.map(s => ({ ...s, word: s.state === 'done' ? 'done' : s.state === 'now' ? 'now' : s.state === 'late' ? 'late' : 'next' }));
}

/* ── Geometry (viewBox 0 0 44 44) ─────────────────────────────────────────────────────────────────────────── */

export const RING = { size: 44, c: 22, r: 19, width: 5, disc: 13, gap: 0.16 };

/** One stroked arc per step, equal shares, a small gap between them (none for a single step: a full circle). */
export function ringSegments(n: number): { d: string; a0: number; a1: number }[] {
  if (n <= 0) return [];
  const { c, r, gap } = RING;
  const T = 2 * Math.PI;
  if (n === 1) {
    return [{ d: `M${c} ${c - r}A${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`, a0: 0, a1: T }];
  }
  const w = T / n;
  const g = Math.min(gap, w * 0.35);
  const p = (a: number) => [Math.round((c + r * Math.sin(a)) * 100) / 100, Math.round((c - r * Math.cos(a)) * 100) / 100];
  return Array.from({ length: n }, (_, i) => {
    const a0 = i * w + g / 2, a1 = (i + 1) * w - g / 2;
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return { d: `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`, a0, a1 };
  });
}

/** An OPD VISIT (the OPD desk's own record): Check-in → Vitals (when the tenant's workflow takes vitals) → Doctor
 *  queue → Consult; completed = every step done, cancelled / no-show = nothing started. From the visit's status. */
export const OPD_VISIT_STEPS = ['Check-in', 'Vitals', 'Doctor queue', 'Consult'] as const;

export function opdVisitRingSteps(status: string, opts: { late?: boolean; vitals?: boolean } = {}): RingStep[] {
  const labels: string[] = opts.vitals === false ? OPD_VISIT_STEPS.filter(l => l !== 'Vitals') : [...OPD_VISIT_STEPS];
  if (status === 'cancelled' || status === 'no_show') return labels.map(label => ({ label, state: 'todo' as const }));
  if (status === 'completed') return ringSteps(labels, -1);
  const at: Record<string, string> = { booked: 'Check-in', vitals: 'Vitals', waiting: 'Doctor queue', in_consult: 'Consult' };
  let i = labels.indexOf(at[status] ?? 'Check-in');
  if (i < 0) i = labels.indexOf('Doctor queue');          // "vitals" status with vitals switched off
  return ringSteps(labels, i, opts);
}
