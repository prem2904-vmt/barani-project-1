/**
 * Consult workspace state helpers (Agent C) — pure, so the draft body and the
 * "usual" set are unit-tested without a DOM.
 */
import type { OpdDiagnosis, OpdNoteVisibility } from '../shared/opd.models';
import type { RxUsual } from '../shared/rx-schedule';
import type {
  ConsultDraftBody, ConsultDraftPatchBody, ConsultInvestigationItem, ConsultProcedureDraft, ConsultProcedureDto, ConsultUsual,
} from './consult.api';
import { proceduresBody } from './procedure-rules';
import { ConsultDrugRef, ConsultRxLine, fromDto, toDto } from './rx/rx-model';
import type { OpdRxLineDto } from '../shared/opd.models';

export interface ConsultEditState {
  answers: Record<string, unknown>;
  chiefComplaint: string;
  diagnoses: OpdDiagnosis[];
  advice: string;
  privateNotes: string;
  privateNotesVisibility: OpdNoteVisibility;
  lines: ConsultRxLine[];
  tests: ConsultInvestigationItem[];
  followUpDays: number | null;
  /** Procedures done in the consult; undefined = not loaded (the draft leaves them alone). */
  procedures?: ConsultProcedureDraft[];
}

/** Server capabilities the body depends on (feature-detected from the workspace). */
export interface BodyOpts { procedureLater?: boolean; procedureRecord?: boolean; procedureForms?: boolean }

export function draftBody(s: ConsultEditState, followUpDate: string | null, start?: Date, opts: BodyOpts = {}): ConsultDraftBody {
  return {
    answers: s.answers,
    chiefComplaint: s.chiefComplaint.trim() || null,
    diagnoses: s.diagnoses,
    advice: s.advice.trim() || null,
    privateNotes: s.privateNotes.trim() || null,
    privateNotesVisibility: s.privateNotesVisibility,
    followUpDate,
    rx: s.lines.map(l => toDto(l, start)),
    investigationItems: s.tests.map(t => ({ testId: t.testId, name: t.name, ...(t.specimen ? { specimen: t.specimen } : {}) })),
    ...(s.procedures ? { procedures: proceduresBody(s.procedures, !!opts.procedureLater, !!opts.procedureRecord, !!opts.procedureForms) } : {}),
  };
}

// ── Dirty-section autosave (owner 2026-10-01) ───────────────────────────────
// Mirrors mw DraftPatchBody's sections. Every ConsultEditState FIELD maps to
// exactly one section; chiefComplaint/advice/privateNotes/privateNotesVisibility
// and the follow-up are bundled as "notes" (same grouping as mw's
// DraftNotesPatch), so autosave sends only what actually changed since the
// last save instead of the whole edit state on every tick.
export type DraftSection = 'answers' | 'diagnoses' | 'rx' | 'investigations' | 'procedures' | 'notes';
export const SECTION_OF: Record<keyof ConsultEditState, DraftSection> = {
  answers: 'answers', chiefComplaint: 'notes', diagnoses: 'diagnoses', advice: 'notes',
  privateNotes: 'notes', privateNotesVisibility: 'notes', lines: 'rx', tests: 'investigations',
  followUpDays: 'notes', procedures: 'procedures',
};

/** The PATCH body for only the given dirty sections — the UI mirror of mw's
 *  ApplyPatchAsync null-section-skipping. A section not in `dirty` is simply
 *  left off the body (server: untouched). */
export function draftPatchBody(dirty: ReadonlySet<DraftSection>, s: ConsultEditState, followUpDate: string | null, start?: Date, opts: BodyOpts = {}): ConsultDraftPatchBody {
  const body: ConsultDraftPatchBody = {};
  if (dirty.has('answers')) body.answers = s.answers;
  if (dirty.has('diagnoses')) body.diagnoses = s.diagnoses;
  if (dirty.has('rx')) body.rx = s.lines.map(l => toDto(l, start));
  if (dirty.has('investigations'))
    body.investigationItems = s.tests.map(t => ({ testId: t.testId, name: t.name, ...(t.specimen ? { specimen: t.specimen } : {}) }));
  if (dirty.has('procedures') && s.procedures) body.procedures = proceduresBody(s.procedures, !!opts.procedureLater, !!opts.procedureRecord, !!opts.procedureForms);
  if (dirty.has('notes'))
    body.notes = {
      chiefComplaint: s.chiefComplaint.trim() || null, advice: s.advice.trim() || null,
      privateNotes: s.privateNotes.trim() || null, privateNotesVisibility: s.privateNotesVisibility,
      followUpDate, followUpNote: null,
    };
  return body;
}

/** Learn the server-assigned ids a Rx PATCH echoed back, by POSITION (the
 *  server returns the lines in the SAME order they were sent/sorted) — a
 *  line that already carried an id is left alone. A length mismatch is
 *  never guessed at: the lines are returned as-is (the next full load, or a
 *  later patch, settles it). */
export function reconcileRxIds(lines: readonly ConsultRxLine[], serverRx: readonly OpdRxLineDto[]): ConsultRxLine[] {
  if (lines.length !== serverRx.length) return [...lines];
  return lines.map((l, i) => (l.id || !serverRx[i]?.id ? l : { ...l, id: serverRx[i].id! }));
}

/** Same idea for procedures, but positional against the DRAFT (non-billed)
 *  subset only — proceduresBody() already drops billed rows before sending,
 *  so the server never sees (or echoes) them. */
export function reconcileProcedureIds(procedures: readonly ConsultProcedureDraft[], serverRows: readonly ConsultProcedureDto[]): ConsultProcedureDraft[] {
  const draftIdx = procedures.map((p, i) => ({ p, i })).filter(x => x.p.status !== 'billed');
  if (draftIdx.length !== serverRows.length) return [...procedures];
  const next = [...procedures];
  draftIdx.forEach(({ p, i }, k) => { if (!p.id && serverRows[k]?.id) next[i] = { ...p, id: serverRows[k].id }; });
  return next;
}

let procSeq = 0;
/** A saved procedure → the editor's row. */
export function procedureDraftOf(p: ConsultProcedureDto): ConsultProcedureDraft {
  return {
    key: 'p' + (++procSeq), id: p.id, serviceId: p.serviceId, name: p.name, code: p.code ?? null, qty: p.qty, rulePrice: p.rulePrice, price: p.price,
    priceReason: p.priceReason ?? null, priceSetByName: p.priceSetByName ?? null, side: p.side ?? null, note: p.note ?? null, status: p.status,
    when: p.when === 'later' ? 'later' : 'now', preferredWithin: p.preferredWithin ?? null, prepNote: p.prepNote ?? null, record: p.record ?? null, answers: p.answers ?? null,
  };
}

/** The doctor's usual line per drug (last seen first wins): feeds parseRx / new lines. */
export function usualsFrom(...sets: (readonly OpdRxLineDto[] | undefined | null)[]): Record<string, RxUsual> {
  const out: Record<string, RxUsual> = {};
  for (const set of sets) for (const d of set ?? []) {
    if (!d.drugId || out[d.drugId]) continue;
    const l = fromDto(d).line;
    out[d.drugId] = { dose: l.dose, site: l.site, sched: l.sched, dur: l.dur, food: l.food };
  }
  return out;
}

/** Acknowledgements reset on any line copied / swapped into a new Rx. */
export const FRESH_ACKS = { allergyAck: false, allergyAckNote: null, pregnancyAck: false, pregnancyAckNote: null } as const;

/** Apply a "usual" set: adds its lines (skipping drugs already on the Rx), its
 *  tests (skipping ordered ones) and — a template fallback only (critic §1 #6)
 *  — its advice, but ONLY when the doctor hasn't written any yet. Returns the
 *  new state + what was added (for undo). */
export function applyUsual(s: ConsultEditState, u: ConsultUsual, drugs: readonly ConsultDrugRef[]):
  { next: ConsultEditState; addedKeys: string[]; addedTests: string[]; addedAdvice: boolean } {
  const have = new Set(s.lines.map(l => l.drug.id));
  // Never carry an acknowledgement onto a NEW prescription (logic audit P0): a
  // "usual" can come from another patient's consult — allergy / pregnancy
  // reviews belong to that patient, not this one.
  const add = u.rx.map(d => fromDto({ ...d, id: undefined, ...FRESH_ACKS }, drugs)).filter(l => !have.has(l.drug.id));
  const haveT = new Set(s.tests.map(t => t.testId));
  const addT = u.tests.filter(t => !haveT.has(t.testId));
  const addedAdvice = !!u.advice && !s.advice.trim();
  return {
    next: { ...s, lines: [...s.lines, ...add], tests: [...s.tests, ...addT], advice: addedAdvice ? u.advice! : s.advice },
    addedKeys: add.map(l => l.key), addedTests: addT.map(t => t.testId), addedAdvice,
  };
}

/** Undo a usual set. */
export function undoUsual(s: ConsultEditState, keys: readonly string[], tests: readonly string[], addedAdvice = false): ConsultEditState {
  return { ...s, lines: s.lines.filter(l => !keys.includes(l.key)), tests: s.tests.filter(t => !tests.includes(t.testId)), advice: addedAdvice ? '' : s.advice };
}

/** Days between two yyyy-MM-dd dates (local). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00'), b = new Date(toIso + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
