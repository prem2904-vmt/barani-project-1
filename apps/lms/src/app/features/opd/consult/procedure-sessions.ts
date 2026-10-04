/**
 * Procedure forms (e.g. a laser hair-removal session) — PURE helpers for the
 * "last session" chips, "copy all", the sessions table and the line summary.
 * Answers use the same OpdFormSchema / answers shape as consult forms; the
 * past sessions come from GET …/patients/{id}/procedure-history?serviceId=.
 */
import { allQuestions, answerText, normalizeSchema } from '../admin/forms/renderer';
import type { OpdQuestion } from '../admin/forms/renderer';

export interface ProcedureSession {
  date: string; visitId: string; doctorName?: string | null; procedureName?: string | null;
  answers?: Record<string, unknown> | null; record?: string | null; media?: unknown[] | null;
}

const has = (v: unknown) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
const shortDate = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** One answer in a few words; a left / right answer as "R … · L …". */
export function valueText(q: OpdQuestion, v: unknown): string {
  if (!has(v)) return '';
  if (q.sides && v && typeof v === 'object' && !Array.isArray(v)) {
    const s = v as { r?: unknown; l?: unknown };
    return [has(s.r) ? 'R ' + answerText(q, s.r) : '', has(s.l) ? 'L ' + answerText(q, s.l) : ''].filter(Boolean).join(' · ');
  }
  return answerText(q, v);
}

/** Newest session first. Pure. */
export function sortSessions(list: readonly ProcedureSession[]): ProcedureSession[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date));
}

/** The "Last: 14 J/cm² · 12 Sep" chip per question, from the newest past
 *  session that answered it (today's visit excluded). Pure. */
export function lastHints(schema: unknown, sessions: readonly ProcedureSession[], todayVisitId?: string | null): Record<string, string> {
  const qs = allQuestions(normalizeSchema(schema));
  const past = sortSessions(sessions).filter(s => s.visitId !== todayVisitId);
  const out: Record<string, string> = {};
  for (const q of qs) {
    const s = past.find(x => has(x.answers?.[q.key]));
    if (s) { const t = valueText(q, s.answers![q.key]); if (t) out[q.key] = `${t} · ${shortDate(s.date)}`; }
  }
  return out;
}

/** The value to copy for one question (deep copy, from the newest session that has it). Pure. */
export function lastValue(key: string, sessions: readonly ProcedureSession[], todayVisitId?: string | null): unknown {
  const s = sortSessions(sessions).filter(x => x.visitId !== todayVisitId).find(x => has(x.answers?.[key]));
  return s ? JSON.parse(JSON.stringify(s.answers![key])) : undefined;
}

/** "Copy all from last session": every question the last session answered
 *  (only the form's own questions) laid over today's answers. Pure. */
export function copyAllFromLast(schema: unknown, now: Record<string, unknown>, sessions: readonly ProcedureSession[], todayVisitId?: string | null): Record<string, unknown> {
  const last = sortSessions(sessions).find(x => x.visitId !== todayVisitId);
  if (!last?.answers) return { ...now };
  const keys = new Set(allQuestions(normalizeSchema(schema)).map(q => q.key));
  const out = { ...now };
  for (const [k, v] of Object.entries(last.answers)) if (keys.has(k) && has(v)) out[k] = JSON.parse(JSON.stringify(v));
  return out;
}

export interface SessionsTable { dates: string[]; rows: { key: string; label: string; cells: string[]; changed: boolean[] }[]; }

/** All sessions side by side: the form's questions as rows, dates as
 *  columns (oldest → newest; today's answers last when given), a value that
 *  differs from the session before highlighted. Pure. */
export function sessionsTable(schema: unknown, sessions: readonly ProcedureSession[], today?: { date: string; answers: Record<string, unknown> } | null): SessionsTable {
  const cols = [...sessions].sort((a, b) => a.date.localeCompare(b.date)).map(s => ({ date: s.date, answers: s.answers ?? {} }));
  if (today) cols.push(today);
  const rows = allQuestions(normalizeSchema(schema)).map(q => {
    const cells = cols.map(c => valueText(q, c.answers[q.key]));
    return { key: q.key, label: q.label, cells, changed: cells.map((c, i) => i > 0 && (c || cells[i - 1]) !== '' && c !== cells[i - 1]) };
  }).filter(r => r.cells.some(Boolean));
  return { dates: cols.map(c => c.date), rows };
}

/** Today is session N (past sessions + 1). Pure. */
export function sessionNumber(sessions: readonly ProcedureSession[], todayVisitId?: string | null): number {
  return sessions.filter(s => s.visitId !== todayVisitId).length + 1;
}

/** The line summary's key readings: the first `max` answered numeric /
 *  short answers, e.g. ["16 J/cm²", "Upper lip"]. Pure. */
export function keyReadings(schema: unknown, answers: Record<string, unknown> | null | undefined, max = 2): string[] {
  if (!answers) return [];
  const qs = allQuestions(normalizeSchema(schema));
  const order = [...qs.filter(q => q.type === 'num'), ...qs.filter(q => q.type !== 'num' && ['one', 'short', 'yn', 'scale'].includes(q.type))];
  return order.map(q => valueText(q, answers[q.key])).filter(Boolean).slice(0, max);
}
