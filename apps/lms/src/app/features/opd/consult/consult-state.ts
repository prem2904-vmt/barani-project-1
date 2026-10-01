/**
 * Consult workspace state helpers (Agent C) — pure, so the stepper summaries,
 * the draft body and the "usual" set are unit-tested without a DOM.
 */
import type { OpdDiagnosis, OpdNoteVisibility } from '../shared/opd.models';
import type { RxUsual } from '../shared/rx-schedule';
import type { ConsultDraftBody, ConsultInvestigationItem, ConsultProcedureDraft, ConsultProcedureDto, ConsultUsual } from './consult.api';
import { proceduresBody } from './procedure-rules';
import { ConsultDrugRef, ConsultRxLine, fromDto, toDto, unresolvedAllergies } from './rx/rx-model';
import type { OpdPatientAllergy, OpdRxLineDto } from '../shared/opd.models';

export type ConsultStep = 1 | 2 | 3 | 4;

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

export const STEP_TITLES: Record<ConsultStep, string> = {
  1: 'Assessment & diagnosis', 2: 'Prescription', 3: 'Tests & procedures', 4: 'Notes',
};

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** The one-line summary under each rail step. */
export function stepSummary(step: ConsultStep, s: ConsultEditState, allergies: readonly OpdPatientAllergy[], visibility: string): { text: string; warn?: boolean } {
  switch (step) {
    case 1: {
      const findings = s.chiefComplaint.trim() || Object.values(s.answers).some(v => v != null && v !== '' && !(Array.isArray(v) && !v.length));
      if (s.diagnoses.length) return { text: s.diagnoses.map(d => d.label).join(', ') };
      return { text: (findings ? 'Findings noted' : 'Nothing noted yet') + ' · diagnosis pending' };
    }
    case 2: {
      if (!s.lines.length) return { text: 'No medicines yet' };
      const bad = unresolvedAllergies(s.lines, allergies).length;
      return bad ? { text: plural(s.lines.length, 'medicine') + ' · allergy check', warn: true } : { text: plural(s.lines.length, 'medicine') };
    }
    case 3: {
      const names = [...s.tests.map(t => t.name), ...(s.procedures ?? []).map(p => p.name)];
      return { text: names.length ? names.join(', ') : 'No tests yet' };
    }
    case 4: return { text: 'Private · ' + (visibility === 'doctor' ? 'doctor only' : visibility === 'department' ? 'department doctors' : 'all doctors') };
  }
}

/** A step is "done" (tick) once it has content. Notes is never required. */
export function stepDone(step: ConsultStep, s: ConsultEditState): boolean {
  switch (step) {
    case 1: return s.diagnoses.length > 0;
    case 2: return s.lines.length > 0;
    case 3: return s.tests.length > 0 || (s.procedures?.length ?? 0) > 0;
    case 4: return s.privateNotes.trim().length > 0 || s.advice.trim().length > 0;
  }
}

export function draftBody(s: ConsultEditState, followUpDate: string | null, start?: Date): ConsultDraftBody {
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
    ...(s.procedures ? { procedures: proceduresBody(s.procedures) } : {}),
  };
}

let procSeq = 0;
/** A saved procedure → the editor's row. */
export function procedureDraftOf(p: ConsultProcedureDto): ConsultProcedureDraft {
  return {
    key: 'p' + (++procSeq), id: p.id, serviceId: p.serviceId, name: p.name, code: p.code ?? null, qty: p.qty, rulePrice: p.rulePrice, price: p.price,
    priceReason: p.priceReason ?? null, priceSetByName: p.priceSetByName ?? null, side: p.side ?? null, note: p.note ?? null, status: p.status,
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
