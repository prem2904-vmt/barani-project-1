/**
 * The one-line prescription (consult v6) — PURE rules behind the three
 * tappable tokens of an Rx line (pattern · days · food), the plain sentence
 * under it, the print slip's dose dots, and the doctor's usual dose. Every
 * COUNT still comes from the shared model (features/opd/shared/rx-schedule.ts:
 * rxQty / qtyWords / sayRx) — nothing here re-derives a quantity.
 */
import {
  FORMS, RxDrugRef, RxFood, RxLine, RxSchedule, RxUsual, SCHED_DEFAULTS, formOf, qtyWords, sayRx, shortSched, timesSched,
} from '../../shared/rx-schedule';
import type { ConsultDrugRef, ConsultRxLine } from './rx-model';

// ── Token option sets ────────────────────────────────────────────────────

export interface RxTokenOption { id: string; label: string; }

/** Pattern row: one tap sets the timing; "More…" opens the advanced schedules. */
export const RX_PATTERN_OPTIONS: readonly RxTokenOption[] = [
  { id: '1-0-0', label: '1-0-0' }, { id: '0-0-1', label: '0-0-1' }, { id: '1-0-1', label: '1-0-1' }, { id: '1-1-1', label: '1-1-1' },
  { id: '1-1-1-1', label: '1-1-1-1' }, { id: '0-1-0', label: '0-1-0' }, { id: '½-0-½', label: '½-0-½' }, { id: 'sos', label: 'SOS' },
  { id: 'more', label: 'More…' },
];
/** Days row (Ongoing = until the next visit; 30 days are dispensed). */
export const RX_DAYS_OPTIONS: readonly RxTokenOption[] = [
  ...[1, 3, 5, 7, 10, 15, 30].map(n => ({ id: String(n), label: `${n} d` })),
  { id: 'ongoing', label: 'Ongoing' },
];
/** Food row ('' = any time). */
export const RX_FOOD_OPTIONS: readonly RxTokenOption[] = [
  { id: 'After', label: 'After food' }, { id: 'Before', label: 'Before food' }, { id: 'With', label: 'With food' }, { id: '', label: 'Any time' },
];

/** An "ongoing" line is stored as a 30-day course with this note (the
 *  pharmacy dispenses a month; the patient reads "until your next visit"). */
export const ONGOING_DAYS = 30;
export const ONGOING_NOTE = 'Ongoing — continue until the next visit';
export const isOngoing = (l: Pick<ConsultRxLine, 'notes'>) => (l.notes ?? '').trim() === ONGOING_NOTE;

const half = (n: number) => (n === 0.5 ? '½' : String(n));
const patOf = (id: string) => id.split('-').map(x => (x === '½' ? 0.5 : +x));

// ── Token labels ─────────────────────────────────────────────────────────

/** The pattern token's text: 1-0-1, ½-0-½, SOS, Every 8 h, Alternate days… */
export function patternLabel(line: Pick<RxLine, 'sched'>): string {
  const s = line.sched;
  if (s.type === 'times') return s.pat.map(half).join('-');
  if (s.type === 'sos') return 'SOS';
  if (s.type === 'hours') return `Every ${s.every} h`;
  return shortSched(s);
}
/** Which pattern option is selected (null = an advanced schedule). */
export function patternId(line: Pick<RxLine, 'sched'>): string | null {
  const s = line.sched;
  if (s.type === 'sos') return 'sos';
  if (s.type !== 'times') return null;
  const id = s.pat.map(half).join('-');
  return RX_PATTERN_OPTIONS.some(o => o.id === id) ? id : null;
}
export function daysLabel(l: Pick<ConsultRxLine, 'line' | 'notes'>): string {
  if (isOngoing(l)) return 'Ongoing';
  const s = l.line.sched;
  const n = s.type === 'steps' ? s.steps.reduce((a, x) => a + x.dur, 0) : s.type === 'cycle' ? (s.on + s.off) * (s.cycles || 1) : l.line.dur;
  return `${n} day${n === 1 ? '' : 's'}`;
}
export function daysId(l: Pick<ConsultRxLine, 'line' | 'notes'>): string { return isOngoing(l) ? 'ongoing' : String(l.line.dur); }
export function foodLabel(line: Pick<RxLine, 'food'>): string {
  return RX_FOOD_OPTIONS.find(o => o.id === (line.food ?? ''))?.label ?? 'Any time';
}
/** The days token only edits a plain course (a taper / cycle has its own lengths). */
export const daysEditable = (line: Pick<RxLine, 'sched'>) => line.sched.type !== 'steps' && line.sched.type !== 'cycle';

// ── Applying a token pick (pure: a new line, never a mutation) ──────────

const copy = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** Set the timing from the pattern row. Keeps the dose and the days; a taper
 *  or cycle becomes a plain 5-day course; SOS defaults to 3 a day, 6 h apart. */
export function applyPattern(line: RxLine, id: string): RxLine {
  if (id === 'more') return line;
  const next = copy(line);
  const wasPlain = line.sched.type !== 'steps' && line.sched.type !== 'cycle';
  next.sched = id === 'sos' ? copy(SCHED_DEFAULTS.sos) : timesSched(patOf(id));
  if (!wasPlain || !next.dur) next.dur = id === 'sos' ? 3 : 5;
  return next;
}
/** Set the course length ('ongoing' = 30 days + the ongoing note). */
export function applyDays(l: ConsultRxLine, id: string): ConsultRxLine {
  const line = copy(l.line);
  if (id === 'ongoing') { line.dur = ONGOING_DAYS; return { ...l, line, notes: ONGOING_NOTE }; }
  line.dur = Math.max(1, Math.round(+id) || 1);
  return { ...l, line, notes: isOngoing(l) ? null : l.notes ?? null };
}
export function applyFood(line: RxLine, id: string): RxLine {
  const next = copy(line);
  if (id === 'Before' || id === 'After' || id === 'With') next.food = id as RxFood; else delete next.food;
  return next;
}

// ── The plain sentence ───────────────────────────────────────────────────

const SLOT3 = ['in the morning', 'in the afternoon', 'at night'];
const SLOT4 = ['in the morning', 'in the afternoon', 'in the evening', 'at night'];
const joinAnd = (a: string[]) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

function amount(drug: Pick<RxDrugRef, 'form'>, n: number): string {
  const f = formOf(drug);
  if (f.noDoseCount) return f.one;
  return `${half(n)} ${n > 1 ? f.many : f.one}`;
}

export interface RxSentence { text: string; qty: string; }

/**
 * The line as the patient will read it — and as it prints — e.g.
 *   "Take 1 tablet in the morning and at night, after food, for 5 days"
 *   "Take 1 tablet in the morning and ½ tablet at night, before food, for 7 days"
 *   "Take 1 tablet only when needed — at most 3 a day, at least 6 hours apart, for 3 days"
 * plus the total the pharmacy hands over ("10 tablets", "up to 9 tablets",
 * "1 bottle"). A per-slot amount is the slot count × the dose. Pure.
 */
export function rxSentence(l: Pick<ConsultRxLine, 'line' | 'drug' | 'notes'>, start: Date = new Date()): RxSentence {
  const { line, drug } = l;
  const f = formOf(drug);
  const ongoing = isOngoing(l);
  const qtyRaw = qtyWords(line, drug, start);
  const s = line.sched;
  let qty = s.type === 'sos' && !f.pack ? `up to ${qtyRaw}` : qtyRaw;
  if (ongoing) qty = `${qtyRaw} (${ONGOING_DAYS} days)`;
  if (s.type !== 'times') {
    // Advanced schedules read through the shared model's sentence.
    let t = sayRx(line, drug).replace(/\.$/, '');
    if (ongoing) t = t.replace(/, for \d+ (days?|weeks?)$/, '') + ', continue until your next visit';
    return { text: t, qty };
  }
  const names = s.pat.length === 4 ? SLOT4 : SLOT3;
  const on = s.pat.map((x, i) => ({ i, n: x * line.dose })).filter(x => x.n > 0);
  if (!on.length) return { text: 'Choose when the patient should take it', qty: '' };
  const site = f.site && line.site ? ' ' + siteWords(drug, line.site) : '';
  const same = on.every(x => x.n === on[0].n);
  const when = same
    ? `${amount(drug, on[0].n)}${site} ${joinAnd(on.map(x => names[x.i]))}`
    : joinAnd(on.map((x, k) => `${amount(drug, x.n)}${k === 0 ? site : ''} ${names[x.i]}`));
  const verb = ({ take: 'Take', put: 'Put', use: 'Use', apply: 'Apply', insert: 'Insert', give: 'Give' } as const)[f.verb];
  const food = f.food && line.food ? `, ${line.food.toLowerCase()} food` : '';
  const dur = ongoing ? ', continue until your next visit' : `, for ${line.dur} day${line.dur === 1 ? '' : 's'}`;
  return { text: `${verb} ${when}${food}${dur}`, qty };
}

function siteWords(drug: Pick<RxDrugRef, 'form'>, site: string): string {
  if (drug.form === 'spray' && site === 'Both nostrils') return 'in each nostril';
  const t = site === 'Affected area' ? 'the affected area' : /^Both/.test(site) ? site.toLowerCase() : 'the ' + site.toLowerCase();
  return (drug.form === 'cream' ? 'on ' : 'in ') + t;
}

/** Morning / afternoon / evening / night amounts for the print slip's dose
 *  dots (0 = no dose that slot); null for a schedule that isn't by the clock
 *  (SOS, every few hours, alternate days, tapers, cycles). Pure. */
export function doseDots(line: Pick<RxLine, 'sched' | 'dose'>): [number, number, number, number] | null {
  const s = line.sched;
  if (s.type !== 'times') return null;
  const d = line.dose;
  return s.pat.length === 4
    ? [s.pat[0] * d, s.pat[1] * d, s.pat[2] * d, s.pat[3] * d]
    : [s.pat[0] * d, s.pat[1] * d, 0, s.pat[2] * d];
}

// ── The doctor's usual dose ──────────────────────────────────────────────

/** A drug master row's `usual` JSON ({ dose, schedule, durationDays, food })
 *  as a model usual; null when absent or unreadable. Pure. */
export function usualFromJson(u: Record<string, unknown> | null | undefined): RxUsual | null {
  if (!u || typeof u !== 'object') return null;
  const sched = (u['schedule'] ?? u['sched']) as RxSchedule | undefined;
  if (!sched || typeof sched !== 'object' || !('type' in sched)) return null;
  const dose = Number(u['dose']);
  const dur = Number(u['durationDays'] ?? u['dur']);
  const food = u['food'];
  return {
    dose: Number.isFinite(dose) && dose > 0 ? dose : 1,
    sched: copy(sched),
    dur: Number.isFinite(dur) && dur >= 0 ? dur : 5,
    ...(food === 'Before' || food === 'After' || food === 'With' ? { food: food as RxFood } : {}),
    ...(typeof u['site'] === 'string' ? { site: u['site'] as string } : {}),
  };
}

/** No usual on record: 1-0-1 · 5 days · after food (food only where the form takes it). Pure. */
export function defaultUsual(drug: Pick<RxDrugRef, 'form'>): RxUsual {
  const f = formOf(drug);
  return { dose: f.doses.includes(1) ? 1 : f.doses[0], sched: timesSched([1, 0, 1]), dur: 5, ...(f.food ? { food: 'After' as RxFood } : {}) };
}

/** "Tablet", "Capsule", "Syrup", "Eye drops"… — the line's form word. */
export function formName(d: Pick<ConsultDrugRef, 'form' | 'siteKind'>): string {
  if (d.form === 'drops') return d.siteKind === 'ear' ? 'Ear drops' : d.siteKind === 'nose' ? 'Nasal drops' : 'Eye drops';
  const names: Partial<Record<string, string>> = {
    tab: 'Tablet', cap: 'Capsule', sachet: 'Sachet', vaginal_tab: 'Vaginal tablet', pessary: 'Pessary', injection: 'Injection', syrup: 'Syrup',
    spray: 'Spray', inhaler: 'Inhaler', cream: 'Cream', gel: 'Gel', ointment: 'Ointment', lotion: 'Lotion', solution: 'Solution',
    shampoo: 'Shampoo', soap: 'Soap', powder: 'Powder', gargle: 'Gargle', mouthwash: 'Mouthwash',
  };
  return names[d.form] ?? (FORMS[d.form]?.one ?? '');
}
/** Show a separate dose token when a slot isn't simply "1 unit" (2 tablets,
 *  10 ml, 2 drops…). A cream / wash has no counted dose. */
export function needsDoseToken(l: Pick<ConsultRxLine, 'drug' | 'line'>): boolean {
  const f = formOf(l.drug);
  if (f.noDoseCount) return false;
  return l.line.dose !== 1 || !f.doses.includes(1) || !!f.pack;
}
