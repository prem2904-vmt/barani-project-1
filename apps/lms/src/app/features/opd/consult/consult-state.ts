/**
 * Consult workspace state helpers (Agent C) — pure, so the stepper summaries,
 * the draft body and the "usual" set are unit-tested without a DOM.
 */
import type { OpdDiagnosis, OpdNoteVisibility } from '../shared/opd.models';
import type { RxUsual } from '../shared/rx-schedule';
import type { ConsultDraftBody, ConsultInvestigationItem, ConsultUsual } from './consult.api';
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
}

export const STEP_TITLES: Record<ConsultStep, string> = {
  1: 'Assessment & diagnosis', 2: 'Prescription', 3: 'Investigations', 4: 'Notes',
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
    case 3: return { text: s.tests.length ? s.tests.map(t => t.name).join(', ') : 'No tests yet' };
    case 4: return { text: 'Private · ' + (visibility === 'doctor' ? 'doctor only' : visibility === 'department' ? 'department doctors' : 'all doctors') };
  }
}

/** A step is "done" (tick) once it has content. Notes is never required. */
export function stepDone(step: ConsultStep, s: ConsultEditState): boolean {
  switch (step) {
    case 1: return s.diagnoses.length > 0;
    case 2: return s.lines.length > 0;
    case 3: return s.tests.length > 0;
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
    investigationItems: s.tests.map(t => ({ testId: t.testId, name: t.name })),
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

/** Apply a "usual" set: adds its lines (skipping drugs already on the Rx) and its
 *  tests (skipping ordered ones). Returns the new state + what was added (for undo). */
export function applyUsual(s: ConsultEditState, u: ConsultUsual, drugs: readonly ConsultDrugRef[]):
  { next: ConsultEditState; addedKeys: string[]; addedTests: string[] } {
  const have = new Set(s.lines.map(l => l.drug.id));
  const add = u.rx.map(d => fromDto({ ...d, id: undefined }, drugs)).filter(l => !have.has(l.drug.id));
  const haveT = new Set(s.tests.map(t => t.testId));
  const addT = u.tests.filter(t => !haveT.has(t.testId));
  return {
    next: { ...s, lines: [...s.lines, ...add], tests: [...s.tests, ...addT] },
    addedKeys: add.map(l => l.key), addedTests: addT.map(t => t.testId),
  };
}

/** Undo a usual set. */
export function undoUsual(s: ConsultEditState, keys: readonly string[], tests: readonly string[]): ConsultEditState {
  return { ...s, lines: s.lines.filter(l => !keys.includes(l.key)), tests: s.tests.filter(t => !tests.includes(t.testId)) };
}

/** Days between two yyyy-MM-dd dates (local). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00'), b = new Date(toIso + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
