/**
 * Consult ⇄ Rx glue (Agent C). Pure, DOM-free. Everything about how a line is
 * COUNTED, SPOKEN or PARSED lives in the shared model
 * (features/opd/shared/rx-schedule.ts) — this file only maps the wire DTO and
 * the drug master onto it, and holds the consult's picker vocabularies
 * (timing presets in doctor words, "then…" presets) and the inline allergy
 * check (a tested TS mirror of the server's AllergyCheck).
 */
import type { DrugForm, OpdPatientAllergy, OpdRxLineDto } from '../../shared/opd.models';
import {
  FORMS, RxDrugRef, RxLine, RxSchedule, SCHED_DEFAULTS, SiteKind, SITES, formOf, rxQty, timesSched, totalDays,
} from '../../shared/rx-schedule';
import type { ConsultDrug } from '../consult.api';

/** A drug the consult can prescribe: the master row projected onto the model. */
export interface ConsultDrugRef extends RxDrugRef {
  strength?: string | null;
  schedule?: string | null;
  /** Free-text drug typed by the doctor (no master row). */
  free?: boolean;
}

const DRUG_FORMS = Object.keys(FORMS) as DrugForm[];

/** Which site list a drops / spray / cream uses (by the master's name + generic). */
export function siteKindOf(form: DrugForm, text: string): SiteKind | undefined {
  if (!FORMS[form]?.site) return undefined;
  const t = text.toLowerCase();
  if (form === 'cream') return 'skin';
  if (/\b(eye|ophth|ocular|opht)/.test(t)) return 'eye';
  if (/\b(ear|otic|oto)/.test(t)) return 'ear';
  if (/\b(nasal|nose|nostril|rhin)/.test(t) || form === 'spray') return 'nose';
  return form === 'drops' ? 'eye' : 'skin';
}

export function drugRefOf(d: ConsultDrug): ConsultDrugRef {
  const form = (DRUG_FORMS.includes(d.form as DrugForm) ? d.form : 'tab') as DrugForm;
  return {
    id: d.id, name: d.name, form, unit: d.unit ?? undefined, generic: d.generic ?? undefined,
    aliases: d.aliases ?? undefined, strength: d.strength, schedule: d.schedule,
    siteKind: siteKindOf(form, `${d.name} ${d.generic ?? ''}`),
  };
}

/** A free-text drug (not in the master) — prescribable, dispensed by name. */
export function freeDrug(name: string, form: DrugForm = 'tab'): ConsultDrugRef {
  return { id: 'free:' + name.trim().toLowerCase(), name: name.trim(), form, free: true, siteKind: siteKindOf(form, name) };
}

/** An editable consult line: the model line + its drug + the wire extras. */
export interface ConsultRxLine {
  key: string;
  drug: ConsultDrugRef;
  line: RxLine;
  allergyAck?: boolean;
  allergyAckNote?: string | null;
  notes?: string | null;
  id?: string;
  dispenseStatus?: OpdRxLineDto['dispenseStatus'];
}

let seq = 0;
export const lineKey = () => 'rx' + (++seq) + '-' + Math.random().toString(36).slice(2, 7);

export function toDto(l: ConsultRxLine, start?: Date): OpdRxLineDto {
  return {
    id: l.id, drugId: l.drug.free ? null : l.drug.id, drugName: l.drug.name, form: l.drug.form,
    dose: l.line.dose, site: l.line.site ?? null, schedule: l.line.sched, durationDays: totalDays(l.line),
    food: formOf(l.drug).food ? (l.line.food ?? null) : null,
    // Display only — the SERVER computes the stored quantity (RxScheduleMath).
    quantity: rxQty(l.line, l.drug, start),
    allergyAck: !!l.allergyAck, allergyAckNote: l.allergyAckNote ?? null, notes: l.notes ?? null,
  };
}

export function fromDto(d: OpdRxLineDto, drugs: readonly ConsultDrugRef[] = []): ConsultRxLine {
  const known = d.drugId ? drugs.find(x => x.id === d.drugId) : undefined;
  const drug: ConsultDrugRef = known ?? {
    id: d.drugId ?? 'free:' + d.drugName.toLowerCase(), name: d.drugName, form: d.form, free: !d.drugId,
    siteKind: siteKindOf(d.form, d.drugName),
  };
  const sched = d.schedule as RxSchedule;
  return {
    key: lineKey(), id: d.id, drug,
    line: { drugId: drug.id, dose: Number(d.dose) || 1, site: d.site ?? undefined, sched, dur: sched.type === 'steps' || sched.type === 'cycle' ? 0 : d.durationDays, food: d.food ?? undefined },
    allergyAck: !!d.allergyAck, allergyAckNote: d.allergyAckNote, notes: d.notes, dispenseStatus: d.dispenseStatus,
  };
}

// ── Timing popover (doctor words) ─────────────────────────────────────────

export interface TimingOption { id: string; label: string; hint?: string; sched: RxSchedule; }

/** The grid chips (one tap). */
export const TIMING_GRID: readonly TimingOption[] = [
  { id: '1-0-1', label: '1-0-1', sched: timesSched([1, 0, 1]) },
  { id: '1-0-0', label: '1-0-0', sched: timesSched([1, 0, 0]) },
  { id: '0-0-1', label: '0-0-1', sched: timesSched([0, 0, 1]) },
  { id: '0-1-0', label: '0-1-0', sched: timesSched([0, 1, 0]) },
  { id: '1-1-1', label: '1-1-1', sched: timesSched([1, 1, 1]) },
  { id: '1-1-1-1', label: '1-1-1-1', sched: timesSched([1, 1, 1, 1]) },
  { id: 'sos', label: 'When needed (SOS)', sched: SCHED_DEFAULTS.sos },
];

/** The longer list under the grid. */
export const TIMING_MORE: readonly TimingOption[] = [
  { id: 'alt', label: 'Every other day', sched: { type: 'days', mode: 'alt' } },
  { id: 'q2h', label: 'Every 2 hours', hint: 'while awake', sched: { type: 'hours', every: 2, awake: true } },
  { id: 'q4h', label: 'Every 4 hours', hint: 'while awake', sched: { type: 'hours', every: 4, awake: true } },
  { id: 'weekly', label: 'Once a week…', sched: { type: 'days', mode: 'weekly', wd: [1] } },
  { id: 'cycle', label: '21 days on, 7 off', sched: { type: 'cycle', on: 21, off: 7, pat: [1, 0, 0], cycles: 1 } },
];

export const ALL_TIMINGS: readonly TimingOption[] = [...TIMING_GRID, ...TIMING_MORE];

/** Which timing option a schedule is (for the selected state). */
export function timingIdOf(s: RxSchedule): string | null {
  const j = JSON.stringify(s);
  const hit = ALL_TIMINGS.find(o => JSON.stringify(o.sched) === j);
  if (hit) return hit.id;
  if (s.type === 'sos') return 'sos';
  if (s.type === 'days' && s.mode === 'weekly') return 'weekly';
  if (s.type === 'cycle') return 'cycle';
  return null;
}

/** "+ then…" presets: what the continuation step becomes. */
export interface ThenPreset { id: string; label: string; step: { sched: RxSchedule; dur: number; dose?: number } }
export const THEN_PRESETS: readonly ThenPreset[] = [
  { id: 'same-5', label: 'Same, 5 more days', step: { sched: timesSched([1, 0, 1]), dur: 5 } },
  { id: 'once-5', label: 'Once a day, 5 days', step: { sched: timesSched([1, 0, 0]), dur: 5 } },
  { id: 'tds-5', label: '3 times a day, 5 days', step: { sched: timesSched([1, 1, 1]), dur: 5 } },
  { id: 'night-7', label: 'At night, 7 days', step: { sched: timesSched([0, 0, 1]), dur: 7 } },
  { id: 'sos-3', label: 'When needed, 3 days', step: { sched: SCHED_DEFAULTS.sos, dur: 3 } },
];

/** Add a continuation ("then…") to a line: a plain line becomes a 2-step taper;
 *  a taper gets one more step. The first step keeps the line's own dose. */
export function addThen(l: RxLine, preset: ThenPreset['step']): RxLine {
  const clone = JSON.parse(JSON.stringify(l)) as RxLine;
  const step = JSON.parse(JSON.stringify(preset)) as ThenPreset['step'];
  if (step.sched.type === 'times' && step.sched.pat.join('') === '101' && clone.sched.type === 'times') step.sched = { ...clone.sched };
  if (clone.sched.type === 'steps') { clone.sched.steps.push(step); return clone; }
  if (clone.sched.type === 'cycle') return clone; // a cycle does not taper
  clone.sched = { type: 'steps', steps: [{ sched: clone.sched, dur: clone.dur || 5 }, step] };
  clone.dur = 0;
  return clone;
}

/** Remove taper step k; a taper left with one step collapses to a plain line. */
export function removeStep(l: RxLine, k: number): RxLine {
  const clone = JSON.parse(JSON.stringify(l)) as RxLine;
  if (clone.sched.type !== 'steps') return clone;
  clone.sched.steps.splice(k, 1);
  if (clone.sched.steps.length === 1) {
    const only = clone.sched.steps[0];
    clone.sched = only.sched;
    clone.dur = only.dur;
    if (only.dose != null) clone.dose = only.dose;
  }
  return clone;
}

/** Sites offered for the drug (empty when the form has no site). */
export function sitesFor(d: ConsultDrugRef): string[] {
  return formOf(d).site ? SITES[d.siteKind || 'skin'] : [];
}

// ── Inline allergy check (mirror of server AllergyCheck — keep in sync) ───

/** Drug-class families: an allergy to the family (or any member) flags every member. */
export const ALLERGY_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  penicillin: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'dicloxacillin', 'piperacillin', 'clavulanate', 'clavulanic', 'co-amoxiclav', 'benzathine'],
  cephalosporin: ['cephalosporin', 'cefalexin', 'cephalexin', 'cefuroxime', 'cefixime', 'cefpodoxime', 'ceftriaxone', 'cefadroxil', 'cefdinir'],
  sulfa: ['sulfa', 'sulpha', 'sulfonamide', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'sulfasalazine'],
  nsaid: ['nsaid', 'ibuprofen', 'diclofenac', 'naproxen', 'aceclofenac', 'mefenamic', 'ketorolac', 'aspirin', 'etoricoxib'],
  macrolide: ['macrolide', 'azithromycin', 'clarithromycin', 'erythromycin', 'roxithromycin'],
  fluoroquinolone: ['fluoroquinolone', 'quinolone', 'ciprofloxacin', 'levofloxacin', 'ofloxacin', 'moxifloxacin', 'norfloxacin'],
  tetracycline: ['tetracycline', 'doxycycline', 'minocycline'],
};

const words = (s: string | null | undefined) => (s || '').toLowerCase().split(/[^a-z0-9-]+/).filter(w => w.length > 2);

/** The families (or plain words) a text belongs to. */
function familiesOf(text: string): Set<string> {
  const out = new Set<string>();
  const ws = words(text);
  for (const [fam, members] of Object.entries(ALLERGY_FAMILIES)) {
    if (ws.some(w => members.some(m => w === m || w.startsWith(m)))) out.add(fam);
  }
  return out;
}

export interface AllergyHit { allergy: OpdPatientAllergy; reason: string; }

/** Does prescribing `drug` conflict with an active allergy? Returns the first hit. */
export function allergyHit(drug: Pick<ConsultDrugRef, 'id' | 'name' | 'generic' | 'free'>, allergies: readonly OpdPatientAllergy[]): AllergyHit | null {
  const drugText = `${drug.name} ${drug.generic ?? ''}`;
  const drugWords = new Set(words(drugText));
  const drugFams = familiesOf(drugText);
  for (const a of allergies) {
    if (a.status && a.status !== 'active') continue;
    if (a.drugId && !drug.free && a.drugId === drug.id) return { allergy: a, reason: `${drug.name} is the recorded allergen.` };
    const aText = `${a.allergen} ${a.generic ?? ''}`;
    const direct = words(aText).find(w => drugWords.has(w));
    if (direct) return { allergy: a, reason: `${drug.name} contains ${direct}.` };
    const fam = [...familiesOf(aText)].find(f => drugFams.has(f));
    if (fam) return { allergy: a, reason: `${drug.name} is ${drug.generic ? drug.generic.toLowerCase() : drug.name.toLowerCase()} — a ${fam}.` };
  }
  return null;
}

/** Lines whose allergy conflict has not been reviewed (blocks Complete). */
export function unresolvedAllergies(lines: readonly ConsultRxLine[], allergies: readonly OpdPatientAllergy[]): ConsultRxLine[] {
  return lines.filter(l => !l.allergyAck && !!allergyHit(l.drug, allergies));
}

/** A safe alternative from the master for an allergic line: same form, no hit,
 *  preferring a drug the doctor already prescribes for the diagnosis. */
export function swapCandidate(line: ConsultRxLine, drugs: readonly ConsultDrugRef[], allergies: readonly OpdPatientAllergy[], prefer: readonly string[] = []): ConsultDrugRef | null {
  const ok = drugs.filter(d => d.id !== line.drug.id && d.form === line.drug.form && !allergyHit(d, allergies));
  const fams = familiesOf(`${line.drug.name} ${line.drug.generic ?? ''}`);
  const antibiotic = ['penicillin', 'cephalosporin', 'macrolide', 'fluoroquinolone', 'tetracycline'].some(f => fams.has(f));
  const ranked = ok.map(d => {
    const df = familiesOf(`${d.name} ${d.generic ?? ''}`);
    const score = (prefer.includes(d.id) ? 0 : 2) + (antibiotic && [...df].some(f => ['macrolide', 'fluoroquinolone', 'tetracycline'].includes(f)) ? 0 : 1);
    return { d, score };
  }).sort((a, b) => a.score - b.score);
  return antibiotic ? (ranked.find(r => r.score <= 2)?.d ?? null) : (ranked[0]?.d ?? null);
}
