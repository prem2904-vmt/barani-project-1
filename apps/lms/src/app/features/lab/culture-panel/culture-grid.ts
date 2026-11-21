import type { CultureCaseView, CultureStageView } from './culture-panel.component';
import type { GridFold, WorkStatus } from '../../../shared/utils/work-grid';
import { matchesDailyNo } from '../../../shared/utils/daily-no';
import { formatPatientMeta } from '../../../shared/models/patient.model';

/**
 * My Work's CULTURE tab as the work grid (owner 2026-11-20: "Culture is not following that grid in the lab"). Pure
 * rules over the culture queue's own case rows (GET /api/microbiology/culture-queue — nothing new is read): the status
 * word, the incubation day, the read-due rule, Due (the next read), filters and columns. One row per
 * case; the row (and its one primary) opens the bench, as the card did.
 */

export type CultureStatusKey = 'all' | 'incubating' | 'read_due' | 'in_progress' | 'to_start' | 'signout';
export interface CultureStatus extends WorkStatus { key: CultureStatusKey }
export const CULTURE_STATUS_LABEL: Record<CultureStatusKey, string> = {
  all: 'All', incubating: 'Incubating', read_due: 'Read due', in_progress: 'In progress', to_start: 'To start', signout: 'Awaiting sign-out',
};
export const CULTURE_STATUSES: CultureStatusKey[] = ['read_due', 'incubating', 'in_progress', 'to_start', 'signout'];

const t = (s: string | null | undefined) => { const v = s ? Date.parse(s) : NaN; return Number.isNaN(v) ? null : v; };

/** The stage whose incubation clock is still running (the card's "Incubating · … · ready in …"). */
export function incubating(c: CultureCaseView, now: number): CultureStageView | null {
  return c.stages?.find(s => { const u = t(s.incubateUntil); return u !== null && u > now; }) ?? null;
}
/** A plate whose incubation has ended while its stage is still not done: the read is due (rose). */
export function readDue(c: CultureCaseView, now: number): CultureStageView | null {
  return c.stages?.find(s => { const u = t(s.incubateUntil); return s.state !== 'done' && u !== null && u <= now; }) ?? null;
}
/** The first not-done stage (the card's "Next: …"). */
export function currentStage(c: CultureCaseView): CultureStageView | null {
  return c.stages?.find(s => s.state !== 'done') ?? null;
}
/** 1-based incubation day from the case's creation (the card's "Day 2"). */
export function cultureDay(c: CultureCaseView, now: number): number {
  const start = t(c.createdAt);
  return start === null ? 1 : Math.max(1, Math.floor((now - start) / 86_400_000) + 1);
}

/** ONE status per case. Awaiting sign-out › read due (rose) › incubating › someone holds a stage › to start. */
export function cultureStatus(c: CultureCaseView, now: number): CultureStatus {
  const s = (key: CultureStatusKey, tone: WorkStatus['tone']): CultureStatus => ({ key, label: CULTURE_STATUS_LABEL[key], tone });
  if (c.caseState === 'awaiting_signout' || (c.stages?.length && !currentStage(c))) return s('signout', 'green');
  if (readDue(c, now)) return s('read_due', 'rose');
  if (incubating(c, now)) return s('incubating', 'sky');
  if (c.stages?.some(x => x.state === 'picked')) return s('in_progress', 'violet');
  return s('to_start', 'neutral');
}

/** "Urine · Bacterial Culture & Sensitivity · Microbiology" — the specimen leads the test line. */
export function cultureMeta(c: CultureCaseView): string {
  return [c.specimen, c.testName || 'Culture', c.departmentName].filter(Boolean).join(' · ');
}
/** The patient line, exactly as My Work: "32/F · AA0023". An older server without the patient → the specimen. */
export function culturePatientMeta(c: CultureCaseView): string {
  return c.patient ? formatPatientMeta(c.patient as never) : c.specimen ?? '';
}

/** What the stage cell says under the stage name: who holds it, or the incubation countdown. */
export function stageSub(c: CultureCaseView, now: number, myId: string | null | undefined): string {
  const inc = incubating(c, now);
  if (inc) return `Incubating · ready in ${readyIn(inc, now)}`;
  const due = readDue(c, now);
  if (due) return `Read due · ${due.label}`;
  const held = c.stages?.find(x => x.state === 'picked');
  if (held) return held.holderUserId && held.holderUserId === myId ? 'You' : held.holderName || 'In progress';
  return '';
}
export function readyIn(s: CultureStageView, now: number): string {
  const u = t(s.incubateUntil);
  if (u === null) return '';
  const ms = u - now;
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Due = the next read (owner 2026-11-21: no journey ring on the lab screens): minutes until the plate is ready
 *  (incubating), negative once the read is due (rose "40m late"); null when no clock runs. */
export function cultureDueMin(c: CultureCaseView, now: number): number | null {
  const inc = incubating(c, now);
  if (inc) return ((t(inc.incubateUntil) ?? now) - now) / 60000;
  const due = readDue(c, now);
  if (due) return ((t(due.incubateUntil) ?? now) - now) / 60000;
  return null;
}

/** The one primary: "Open" → the culture bench (as the card tap; sign-out happens there too). */
export function culturePrimary(c: CultureCaseView, now: number): { label: string; aria: string } {
  const id = c.barcode || c.sampleId || 'case';
  return cultureStatus(c, now).key === 'signout'
    ? { label: 'Open', aria: `Open culture ${id} to sign out` }
    : { label: 'Open', aria: `Open the bench for ${id}` };
}

/** The Next-step pill: the first not-done stage ("Gram / Direct smear", "Growth"), or Sign-out; tone = the status. */
export function nextStep(c: CultureCaseView, now: number): { label: string; tone: WorkStatus['tone']; title: string } {
  const st = cultureStatus(c, now);
  const cur = currentStage(c);
  return { label: cur?.label ?? 'Sign-out', tone: st.tone, title: [st.label, stageSub(c, now, null)].filter(Boolean).join(' · ') };
}
/** The Test column: "Urine · Bacterial Culture & Sensitivity · Microbiology". */
export function cultureTest(c: CultureCaseView): string {
  return cultureMeta(c);
}

// ── Card-head filters ──────────────────────────────────────────────────────────

export interface CultureFilter { q: string; status: string; dept: string | null }
export function filterCultures(rows: CultureCaseView[], f: CultureFilter, now: number): CultureCaseView[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(c =>
    (!q || [c.barcode, c.sampleId, c.patientName, c.patient?.mrn, c.testName, c.specimen].filter(Boolean).join(' ').toLowerCase().includes(q) || matchesDailyNo(q, c))
    && (f.status === 'all' || cultureStatus(c, now).key === f.status)
    && (!f.dept || c.departmentName === f.dept));
}
export function cultureStatusOptions(rows: CultureCaseView[], f: CultureFilter, now: number): Array<{ value: string; label: string; count: number }> {
  const base = filterCultures(rows, { ...f, status: 'all' }, now);
  const n = (k: CultureStatusKey) => base.filter(c => cultureStatus(c, now).key === k).length;
  return [{ value: 'all', label: 'All', count: base.length },
    ...CULTURE_STATUSES.map(k => ({ value: k as string, label: CULTURE_STATUS_LABEL[k], count: n(k) })).filter(o => o.count > 0 || o.value === f.status)];
}
export function cultureDepts(rows: CultureCaseView[]): Array<{ id: string; name: string }> {
  return [...new Set(rows.map(c => c.departmentName).filter((d): d is string => !!d))].sort().map(d => ({ id: d, name: d }));
}

// ── Columns ──────────────────────────────────────────────────────────────────

export interface CultureColPlan { colId: string; header: string; hide: boolean }
/** Owner 2026-11-21: Sample ID · Patient · Test · department · Day · Next step · Due · Open.
 *  fold  : the Test line folds under the patient.
 *  tight : Sample ID, Day and Next step fold into the patient cell too — the grid never scrolls sideways (≥ 520px). */
export function cultureColumns(fold: GridFold): CultureColPlan[] {
  const f = fold !== 'full', tt = fold === 'tight';
  const c = (colId: string, header: string, hide = false): CultureColPlan => ({ colId, header, hide });
  return [c('sample', 'Sample ID', tt), c('patient', 'Patient'), c('test', 'Test', f), c('day', 'Day', tt), c('next', 'Next step', tt),
    c('due', 'Due'), c('acts', '')];
}
