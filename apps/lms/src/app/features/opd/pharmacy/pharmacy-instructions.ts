/**
 * Patient instructions after a dispense — the plain-language line, the dose
 * pattern strip for non-daily schedules, and the WhatsApp-ready message.
 * EVERYTHING here comes from the shared Rx model (../shared/rx-schedule.ts:
 * sayRx, stripDays, lineShort, isComplex); nothing re-derives a quantity or a
 * sentence (docs/OPD-DARK.md §6).
 */
import {
  isComplex, lineShort, sayRx, stripDays, type DrugForm, type RxLine, type RxStripCell,
} from '../shared/rx-schedule';
import type { RxLineView } from './pharmacy.api';

export interface InstructionLine {
  /** Brand name actually given (a substitute shows its own name). */
  name: string;
  /** "Take 1 tablet in the morning and at night, after food, for 5 days." */
  say: string;
  /** Doctor's shorthand, e.g. "1 tab · 1-0-1 · 5 days · after food". */
  short: string;
  /** Non-daily schedules (alternate days, weekly, cycles, tapers, every N h) get the 14-day strip. */
  strip: RxStripCell[] | null;
}

/** The Rx line in the shared model's shape (drug id is irrelevant for wording). */
export function toRxLine(l: Pick<RxLineView, 'drugId' | 'dose' | 'site' | 'schedule' | 'durationDays' | 'food'>): RxLine {
  return {
    drugId: l.drugId ?? '',
    dose: Number(l.dose) || 1,
    site: l.site ?? undefined,
    sched: l.schedule,
    dur: l.durationDays,
    food: l.food ?? undefined,
  };
}

/** Is this schedule "every day, same times"? Those don't need the strip. */
export function needsStrip(l: RxLine): boolean {
  return isComplex(l) && l.sched.type !== 'sos';
}

export function instructionFor(line: Pick<RxLineView, 'drugId' | 'dose' | 'site' | 'schedule' | 'durationDays' | 'food' | 'form' | 'drugName'>,
  givenName?: string | null, start: Date = new Date()): InstructionLine {
  const rx = toRxLine(line);
  const drug = { form: line.form as DrugForm };
  return {
    name: givenName || line.drugName,
    say: sayRx(rx, drug),
    short: lineShort(rx, drug),
    strip: needsStrip(rx) ? stripDays(rx, start, 14) : null,
  };
}

/** The strip as text for print / WhatsApp: the dose count per day, "–" an off day, "·" after the course. */
export function stripGlyphs(cells: RxStripCell[]): string {
  return cells.map(c => (c.day == null ? '·' : c.day.n === 0 ? '–' : String(c.day.n))).join(' ');
}

/** The WhatsApp message (plain text; wa.me can't attach files). */
export function whatsAppText(opts: { patientFirstName?: string | null; clinic: string; doctor?: string | null; lines: InstructionLine[] }): string {
  const hello = `Hello${opts.patientFirstName ? ' ' + opts.patientFirstName : ''}, here are your medicines from ${opts.clinic}${opts.doctor ? ' (' + opts.doctor + ')' : ''}:`;
  const body = opts.lines.map((l, i) => {
    const pattern = l.strip ? `\n   Next 14 days: ${stripGlyphs(l.strip)}` : '';
    return `${i + 1}. *${l.name}* — ${l.say}${pattern}`;
  }).join('\n');
  return `${hello}\n\n${body}\n\nPlease take them exactly as written. Call us if you have any questions.`;
}
