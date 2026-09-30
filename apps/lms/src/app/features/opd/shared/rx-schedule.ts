/**
 * OPD PRESCRIBING MODEL — the Rx schedule (pure, DOM-free).
 *
 * THE SINGLE SOURCE for how an Rx line is read, spoken and counted:
 *   - Consult (Agent C, `opd/consult/**`) writes lines with it and shows the
 *     plain-language line + 14-day strip;
 *   - Pharmacy (Agent D, `opd/pharmacy/**`) dispenses the quantity it derives.
 * Never re-derive a quantity or a sentence anywhere else.
 *
 * Ported faithfully from the owner's clickable mockup (opd-mockup/index.html,
 * "PRESCRIBING MODEL"): perDaySched, dayInfo, rxQty, say/L10N, shortSched,
 * whenShort, lineShort, strip, parseRx. Differences from the mockup are only
 * structural: the drug is passed in explicitly (no global drugBy), the start
 * date is a parameter (no hard-coded START), and the strip returns data cells
 * instead of HTML.
 *
 * SERVER MIRROR: prefrontal-mw `Prefrontal/Services/Opd/RxSchedule.cs`
 * (TotalDays / PerDay / DayInfo / Quantity). The two MUST stay in sync — their
 * specs pin the SAME quantity fixtures (rx-schedule.spec.ts ↔ RxScheduleTests.cs).
 *
 * Schedule JSON (stored as-is on the Rx line):
 *   { type:'times',  pat:[m,a,n] | [m,a,e,n] }                 1-0-1, 1-1-1-1 …
 *   { type:'hours',  every, awake }   awake = 6 AM–10 PM, else round the clock
 *   { type:'days',   mode:'alt'|'nth'|'weekly', n?, wd? }       wd: 0 = Sun … 6 = Sat
 *   { type:'sos',    max (per day), gap (hours) }
 *   { type:'cycle',  on, off, pat, cycles }
 *   { type:'steps',  steps:[{ sched, dur, dose? }] }            taper
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type RxSchedule =
  | { type: 'times'; pat: number[] }
  | { type: 'hours'; every: number; awake: boolean }
  | { type: 'days'; mode: 'alt' | 'nth' | 'weekly'; n?: number; wd?: number[] }
  | { type: 'sos'; max: number; gap: number }
  | { type: 'cycle'; on: number; off: number; pat: number[]; cycles: number }
  | { type: 'steps'; steps: RxStep[] };

/** One taper step. `sched` is any schedule except another 'steps'. */
export interface RxStep { sched: RxSchedule; dur: number; dose?: number }

export type RxFood = 'Before' | 'After';

export interface RxLine {
  drugId: string;
  /** Units per administration (tablets, ml, drops, sprays, puffs; ½ = 0.5). */
  dose: number;
  /** Where (drops / sprays / creams) — one of {@link SITES}. */
  site?: string;
  sched: RxSchedule;
  /** Days. Ignored for 'steps' (each step has its own) and 'cycle' (on/off × cycles). */
  dur: number;
  food?: RxFood;
}

export type DrugForm =
  | 'tab' | 'cap' | 'sachet' | 'vaginal_tab' | 'pessary' | 'injection'
  | 'syrup' | 'drops' | 'spray' | 'inhaler' | 'cream' | 'gel' | 'ointment' | 'lotion' | 'solution'
  | 'shampoo' | 'soap' | 'powder' | 'gargle' | 'mouthwash';
export type SiteKind = 'eye' | 'ear' | 'nose' | 'skin' | 'mouth' | 'vagina';

/** What the model needs to know about a drug (a projection of the Drug master). */
export interface RxDrugRef {
  id: string;
  /** Brand / display name. */
  name: string;
  form: DrugForm;
  /** Pack unit for pack forms ('bottle', 'tube', 'inhaler' …). */
  unit?: string;
  /** Generic / composition — searched by parseRx. */
  generic?: string;
  /** Extra search words (e.g. 'co-amoxiclav'). */
  aliases?: string;
  /** Which site list applies (drops / sprays / creams). */
  siteKind?: SiteKind;
}

export interface FormDef {
  verb: 'take' | 'put' | 'use' | 'apply' | 'insert' | 'give';
  one: string;
  many: string;
  doses: number[];
  food?: boolean;
  site?: boolean;
  /** Dispensed as one pack (bottle / tube / inhaler) — quantity is always 1. */
  pack?: boolean;
  /** Said as just its unit word ("a thin layer"), never a counted number
   *  (creams / gels / ointments / lotions / powders). Quantity math (packs
   *  vs. units) is unchanged — this only affects the plain-language line. */
  noDoseCount?: boolean;
}

/** ENT / Derm / Gynae / general OPD dose-form vocabulary (critic §1 #5) — the
 *  ONE source; mirrored server-side by Services/Opd/RxSchedule.cs
 *  (RxScheduleMath.AllForms) and Services/Opd/Pharmacy/PharmacyRules.cs. */
export const FORMS: Readonly<Record<DrugForm, FormDef>> = {
  // Countable
  tab:         { verb: 'take',   one: 'tablet', many: 'tablets', doses: [0.5, 1, 2], food: true },
  cap:         { verb: 'take',   one: 'capsule', many: 'capsules', doses: [1, 2], food: true },
  sachet:      { verb: 'take',   one: 'sachet', many: 'sachets', doses: [1, 2], food: true },
  vaginal_tab: { verb: 'insert', one: 'vaginal tablet', many: 'vaginal tablets', doses: [1], site: true },
  pessary:     { verb: 'insert', one: 'pessary', many: 'pessaries', doses: [1], site: true },
  injection:   { verb: 'give',   one: 'injection', many: 'injections', doses: [1] },
  // Pack (dispensed as one pack / tube / bottle — quantity is always 1)
  syrup:     { verb: 'take',  one: 'ml', many: 'ml', doses: [5, 10, 15], food: true, pack: true },
  drops:     { verb: 'put',   one: 'drop', many: 'drops', doses: [1, 2, 3], site: true, pack: true },
  spray:     { verb: 'use',   one: 'spray', many: 'sprays', doses: [1, 2], site: true, pack: true },
  inhaler:   { verb: 'use',   one: 'puff', many: 'puffs', doses: [1, 2], pack: true },
  cream:     { verb: 'apply', one: 'a thin layer', many: 'a thin layer', doses: [1], site: true, pack: true, noDoseCount: true },
  gel:       { verb: 'apply', one: 'a thin layer', many: 'a thin layer', doses: [1], site: true, pack: true, noDoseCount: true },
  ointment:  { verb: 'apply', one: 'a thin layer', many: 'a thin layer', doses: [1], site: true, pack: true, noDoseCount: true },
  lotion:    { verb: 'apply', one: 'a thin layer', many: 'a thin layer', doses: [1], site: true, pack: true, noDoseCount: true },
  solution:  { verb: 'apply', one: 'ml', many: 'ml', doses: [1, 2, 5], site: true, pack: true },
  shampoo:   { verb: 'use',   one: 'a wash', many: 'a wash', doses: [1], pack: true, noDoseCount: true },
  soap:      { verb: 'use',   one: 'a wash', many: 'a wash', doses: [1], pack: true, noDoseCount: true },
  powder:    { verb: 'apply', one: 'a light dusting', many: 'a light dusting', doses: [1], site: true, pack: true, noDoseCount: true },
  gargle:    { verb: 'use',   one: 'a gargle', many: 'a gargle', doses: [1], site: true, pack: true, noDoseCount: true },
  mouthwash: { verb: 'use',   one: 'a rinse', many: 'a rinse', doses: [1], site: true, pack: true, noDoseCount: true },
};

export const SITES: Readonly<Record<SiteKind, string[]>> = {
  eye: ['Both eyes', 'Right eye', 'Left eye'],
  ear: ['Both ears', 'Right ear', 'Left ear'],
  nose: ['Both nostrils', 'Right nostril', 'Left nostril'],
  skin: ['Affected area', 'Face', 'Scalp', 'Left side', 'Right side', 'Both sides'],
  mouth: ['Mouth', 'Throat'],
  vagina: ['Vagina'],
};

/** Standard durations offered by the pickers (days). */
export const DURATIONS = [3, 5, 7, 10, 14, 30] as const;
export const STEP_DURATIONS = [1, 2, 3, 5, 7, 10, 14] as const;

export function formOf(d: Pick<RxDrugRef, 'form'> | null | undefined): FormDef {
  return (d && FORMS[d.form]) || FORMS.tab;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const timesSched = (pat: number[]): RxSchedule => ({ type: 'times', pat });
const AWAKE2: RxSchedule = { type: 'hours', every: 2, awake: true };

/** Defaults for a new schedule of a kind (mockup SDEF). */
export const SCHED_DEFAULTS: Readonly<{ sos: RxSchedule; steps: RxSchedule }> = {
  sos: { type: 'sos', max: 3, gap: 6 },
  steps: { type: 'steps', steps: [{ sched: AWAKE2, dur: 1 }, { sched: timesSched([1, 1, 1, 1]), dur: 5 }] },
};

/** A doctor's "usual" for a drug — everything on a line but the drug id. */
export type RxUsual = Omit<RxLine, 'drugId'>;

/** The mockup's example "usuals" (ENT clinic). Demo / test fixtures and a seed
 *  for favourites — real usuals come from the doctor's own data. */
export const RX_USUAL_EXAMPLES: Readonly<Record<string, RxUsual>> = {
  amc: { dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' },
  mlc: { dose: 1, sched: timesSched([0, 0, 1]), dur: 10, food: 'After' },
  flu: { dose: 2, site: 'Both nostrils', sched: timesSched([1, 0, 1]), dur: 14 },
  pcm: { dose: 1, sched: { type: 'sos', max: 3, gap: 6 }, dur: 3, food: 'After' },
  oto: { dose: 3, site: 'Both ears', sched: timesSched([1, 1, 1]), dur: 7 },
  azi: { dose: 1, sched: timesSched([1, 0, 0]), dur: 3, food: 'After' },
  pan: { dose: 1, sched: timesSched([1, 0, 0]), dur: 14, food: 'Before' },
  cet: { dose: 1, sched: timesSched([0, 0, 1]), dur: 5, food: 'After' },
  met: { dose: 1, sched: timesSched([1, 0, 1]), dur: 30, food: 'After' },
  tel: { dose: 1, sched: timesSched([1, 0, 0]), dur: 30, food: 'After' },
  clo: { dose: 1, site: 'Affected area', sched: { type: 'days', mode: 'alt' }, dur: 14 },
  fol: { dose: 1, sched: timesSched([0, 1, 0]), dur: 30, food: 'After' },
  ors: { dose: 1, sched: timesSched([1, 1, 1]), dur: 3 },
  cal: { dose: 1, sched: timesSched([0, 1, 0]), dur: 30, food: 'After' },
  sal: { dose: 2, site: 'Both nostrils', sched: clone(SCHED_DEFAULTS.steps), dur: 0 },
  eye: { dose: 1, site: 'Both eyes', sched: clone(SCHED_DEFAULTS.steps), dur: 0 },
  inh: { dose: 2, sched: timesSched([1, 0, 1]), dur: 30 },
  syr: { dose: 10, sched: timesSched([1, 1, 1]), dur: 5, food: 'After' },
};

const FALLBACK_USUAL: RxUsual = { dose: 1, sched: timesSched([1, 0, 1]), dur: 5 };

/** A new line for a drug: the usual (if any) else 1 · 1-0-1 · 5 days (mockup newLine). */
export function newRxLine(drugId: string, usual?: RxUsual | null, over?: Partial<RxLine>): RxLine {
  const l: RxLine = { ...clone(usual ?? FALLBACK_USUAL), drugId };
  if (over) for (const k of Object.keys(over) as (keyof RxLine)[]) (l as any)[k] = clone(over[k]);
  return l;
}

// ── Day arithmetic (the single source for the strip AND the quantity) ──────────

/** Total course length in days. */
export function totalDays(l: Pick<RxLine, 'sched' | 'dur'>): number {
  const s = l.sched;
  if (s.type === 'steps') return s.steps.reduce((a, st) => a + st.dur, 0);
  if (s.type === 'cycle') return (s.on + s.off) * (s.cycles || 1);
  return l.dur;
}

/** Local-calendar day `i` days after `start` (DST-safe, no ms arithmetic). */
export function addDays(start: Date, i: number): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
}

/** Administrations on day `i` (0-based) of a (non-steps) schedule. `start` is
 *  day 0 — only the weekly mode needs it. */
export function perDaySched(s: RxSchedule, i: number, start: Date = new Date()): number {
  switch (s.type) {
    case 'times': return sum(s.pat);
    case 'hours': return s.awake ? Math.floor(16 / s.every) + 1 : Math.floor(24 / s.every);
    case 'days':
      if (s.mode === 'alt') return i % 2 === 0 ? 1 : 0;
      if (s.mode === 'nth') return i % (s.n || 3) === 0 ? 1 : 0;
      return (s.wd || []).indexOf(addDays(start, i).getDay()) >= 0 ? 1 : 0;
    case 'sos': return s.max;
    case 'cycle': return i % (s.on + s.off) < s.on ? sum(s.pat) : 0;
  }
  return 0;
}

export interface RxDayInfo {
  /** Administrations that day (for SOS: the maximum). */
  n: number;
  /** Units per administration that day (a taper step may change it). */
  dose: number;
  /** Taper step index (0 when not a taper). */
  step: number;
}

/** What happens on day `i`, or null past the end of the course. */
export function dayInfo(l: RxLine, i: number, start: Date = new Date()): RxDayInfo | null {
  if (i >= totalDays(l)) return null;
  const s = l.sched;
  if (s.type === 'steps') {
    let acc = 0;
    for (let k = 0; k < s.steps.length; k++) {
      const st = s.steps[k];
      if (i < acc + st.dur) return { n: perDaySched(st.sched, i - acc, addDays(start, acc)), dose: st.dose != null ? st.dose : l.dose, step: k };
      acc += st.dur;
    }
    return null;
  }
  return { n: perDaySched(s, i, start), dose: l.dose, step: 0 };
}

/** Pharmacy quantity: units from the schedule (a taper sums its steps; alternate
 *  days halves; ½ tablets round UP); pack forms (bottle / tube / inhaler) = 1. */
export function rxQty(l: RxLine, drug: Pick<RxDrugRef, 'form'>, start: Date = new Date()): number {
  if (formOf(drug).pack) return 1;
  let t = 0;
  const n = totalDays(l);
  for (let i = 0; i < n; i++) { const x = dayInfo(l, i, start); if (x) t += x.n * x.dose; }
  return Math.max(1, Math.ceil(t));
}

// ── Plain language (one phrase table per language; ta / hi add the same keys) ──

export interface RxPhrases {
  verb: Record<FormDef['verb'], string>;
  slots3: string[];
  slots4: string[];
  nTimes: (n: number) => string;
  and: string;
  then: string;
  everyHour: string;
  everyHours: (n: number) => string;
  awake: string;
  clock: string;
  alt: string;
  nth: (n: number) => string;
  weekly: (days: string[]) => string;
  days: string[];
  sos: (max: number, gap: number) => string;
  cycle: (on: number, off: number) => string;
  food: (f: RxFood) => string;
  forDur: (n: number) => string;
  site: (form: DrugForm, s: string) => string;
  thin: string;
  half: string;
}

const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th');

export const L10N: Readonly<Record<string, RxPhrases>> = {
  en: {
    verb: { take: 'Take', put: 'Put', use: 'Use', apply: 'Apply', insert: 'Insert', give: 'Give' },
    slots3: ['in the morning', 'in the afternoon', 'at night'],
    slots4: ['in the morning', 'at noon', 'in the evening', 'at night'],
    nTimes: n => (n === 1 ? 'once a day' : n === 2 ? 'twice a day' : n + ' times a day'),
    and: ' and ', then: ', then ',
    everyHour: 'every hour', everyHours: n => 'every ' + n + ' hours',
    awake: ' while awake (6 AM–10 PM)', clock: ', round the clock',
    alt: 'every other day',
    nth: n => 'every ' + ordinal(n) + ' day',
    weekly: ds => 'every ' + ds.join(' and '),
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    sos: (m, g) => 'only when needed — at most ' + m + ' a day, at least ' + g + ' hours apart',
    cycle: (on, off) => 'for ' + on + ' days, then stop for ' + off + ' days, and repeat',
    food: f => f.toLowerCase() + ' food',
    forDur: n => 'for ' + (n % 7 === 0 && n >= 7 ? (n === 7 ? '1 week' : n / 7 + ' weeks') : n === 1 ? '1 day' : n + ' days'),
    site: (kind, s) => {
      const t = /^Both/.test(s) || s === 'Affected area' ? (s === 'Affected area' ? 'the affected area' : s.toLowerCase()) : 'the ' + s.toLowerCase();
      if (kind === 'spray' && s === 'Both nostrils') return 'in each nostril';
      return (kind === 'cream' ? 'on ' : 'in ') + t;
    },
    thin: 'a thin layer', half: '½',
  },
};

const phrases = (lang: string) => L10N[lang] ?? L10N['en'];

function doseWords(d: Pick<RxDrugRef, 'form'>, n: number, Lx: RxPhrases): string {
  const f = formOf(d);
  if (f.noDoseCount) return f.one;
  return (n === 0.5 ? Lx.half : n) + ' ' + (n > 1 ? f.many : f.one);
}

function timesWords(p: number[], Lx: RxPhrases): string {
  const on = p.map((x, i) => (x ? i : -1)).filter(i => i >= 0);
  const names = p.length === 4 ? Lx.slots4 : Lx.slots3;
  if (on.length >= 3) return Lx.nTimes(on.length);
  return on.map(i => names[i]).join(Lx.and);
}

function schedWords(s: RxSchedule, Lx: RxPhrases): string {
  switch (s.type) {
    case 'times': return timesWords(s.pat, Lx);
    case 'hours': return (s.every === 1 ? Lx.everyHour : Lx.everyHours(s.every)) + (s.awake ? Lx.awake : Lx.clock);
    case 'days': return s.mode === 'alt' ? Lx.alt : s.mode === 'nth' ? Lx.nth(s.n || 3) : Lx.weekly((s.wd || []).map(i => Lx.days[i]));
    case 'sos': return Lx.sos(s.max, s.gap);
    case 'cycle': return timesWords(s.pat, Lx) + ' ' + Lx.cycle(s.on, s.off);
  }
  return '';
}

/** The plain-language line printed for the patient (mockup `say`), e.g.
 *  "Take 1 tablet in the morning and at night, after food, for 5 days." */
export function sayRx(l: RxLine, drug: Pick<RxDrugRef, 'form'>, lang = 'en'): string {
  const Lx = phrases(lang);
  const f = formOf(drug);
  const site = f.site && l.site ? ' ' + Lx.site(drug.form, l.site) : '';
  const food = f.food && l.food ? ', ' + Lx.food(l.food) : '';
  const s = l.sched;
  let body: string;
  if (s.type === 'steps') {
    const perDose = s.steps.some(st => st.dose != null);
    body = (perDose ? '' : doseWords(drug, l.dose, Lx) + site + ' ')
      + s.steps.map(st => (perDose ? doseWords(drug, st.dose != null ? st.dose : l.dose, Lx) + site + ' ' : '')
        + schedWords(st.sched, Lx) + ' ' + Lx.forDur(st.dur)).join(Lx.then)
      + food;
  } else if (s.type === 'cycle') {
    body = doseWords(drug, l.dose, Lx) + site + ' ' + schedWords(s, Lx) + food;
  } else {
    body = doseWords(drug, l.dose, Lx) + site + ' ' + schedWords(s, Lx) + food + ', ' + Lx.forDur(l.dur);
  }
  return Lx.verb[f.verb] + ' ' + body + '.';
}

/** Compact schedule label (pharmacy / lists), e.g. "1-0-1", "SOS · max 3/day". */
export function shortSched(s: RxSchedule, lang = 'en'): string {
  const Lx = phrases(lang);
  switch (s.type) {
    case 'times': return s.pat.length === 4 ? sum(s.pat) + '× a day' : s.pat.join('-');
    case 'hours': return 'Every ' + s.every + ' h' + (s.awake ? '' : ' · 24 h');
    case 'days': return s.mode === 'alt' ? 'Alternate days' : s.mode === 'nth' ? 'Every ' + ordinal(s.n || 3) + ' day' : (s.wd || []).map(i => Lx.days[i].slice(0, 3)).join(', ');
    case 'sos': return 'SOS · max ' + s.max + '/day';
    case 'cycle': return s.on + ' on / ' + s.off + ' off';
    case 'steps': return s.steps.map(st => shortSched(st.sched, lang)).join(' → ');
  }
}

/** The "When" cell of an Rx grid line (mockup `whenShort`). '' for steps (each
 *  step renders its own). */
export function whenShort(s: RxSchedule, lang = 'en'): string {
  const Lx = phrases(lang);
  switch (s.type) {
    case 'times': return s.pat.join('-');
    case 'hours': return 'Every ' + s.every + ' h' + (s.awake ? '' : ', day & night');
    case 'days': return s.mode === 'alt' ? 'Every other day' : s.mode === 'nth' ? 'Every ' + ordinal(s.n || 3) + ' day' : 'Weekly · ' + (s.wd || []).map(i => Lx.days[i].slice(0, 3)).join(', ');
    case 'sos': return 'SOS · max ' + s.max;
    case 'cycle': return s.pat.join('-') + ' · ' + s.on + ' on, ' + s.off + ' off';
  }
  return '';
}

/** True when the line needs more than the plain m-a-n grid (timing editor). */
export function isComplex(l: Pick<RxLine, 'sched'>): boolean { return l.sched.type !== 'times'; }

/** "10 tablets" / "1 bottle" — what the pharmacy hands over (mockup `qtyWords`). */
export function qtyWords(l: RxLine, drug: Pick<RxDrugRef, 'form' | 'unit'>, start: Date = new Date()): string {
  const f = formOf(drug);
  const q = rxQty(l, drug, start);
  return f.pack ? '1 ' + (drug.form === 'cream' ? 'tube' : (drug.unit || 'pack')) : q + ' ' + (q === 1 ? f.one : f.many);
}

const SHORTU: Record<Exclude<DrugForm, 'cream'>, [string, string]> = {
  tab: ['tab', 'tabs'], cap: ['cap', 'caps'], sachet: ['sachet', 'sachets'],
  vaginal_tab: ['tab', 'tabs'], pessary: ['pessary', 'pessaries'], injection: ['inj', 'inj'],
  syrup: ['ml', 'ml'], drops: ['drop', 'drops'], spray: ['spray', 'sprays'], inhaler: ['puff', 'puffs'],
  gel: ['application', 'applications'], ointment: ['application', 'applications'], lotion: ['application', 'applications'],
  solution: ['ml', 'ml'], shampoo: ['wash', 'washes'], soap: ['wash', 'washes'], powder: ['dusting', 'dustings'],
  gargle: ['gargle', 'gargles'], mouthwash: ['rinse', 'rinses'],
};

/** Grid dose cell, e.g. "½ tab", "2 sprays", "Thin layer", "A wash". */
export function doseShort(d: Pick<RxDrugRef, 'form'>, n: number): string {
  if (d.form === 'cream') return 'Thin layer';
  const f = formOf(d);
  if (f.noDoseCount) return f.one.charAt(0).toUpperCase() + f.one.slice(1);
  const u = SHORTU[d.form as Exclude<DrugForm, 'cream'>] || SHORTU.tab;
  return (n === 0.5 ? '½' : n) + ' ' + (n > 1 ? u[1] : u[0]);
}

export interface RxSegment { sched: RxSchedule; dur: number; dose: number; k: number }

/** The line as segments: one per taper step, else a single segment (k = -1). */
export function segsOf(l: RxLine): RxSegment[] {
  return l.sched.type === 'steps'
    ? l.sched.steps.map((st, k) => ({ sched: st.sched, dur: st.dur, dose: st.dose != null ? st.dose : l.dose, k }))
    : [{ sched: l.sched, dur: l.dur, dose: l.dose, k: -1 }];
}

const dayW = (n: number) => n + (n === 1 ? ' day' : ' days');

/** One-line doctor's shorthand of a line (mockup `lineShort`), e.g.
 *  "1 tab · 1-0-1 · 5 days · after food". */
export function lineShort(l: RxLine, drug: Pick<RxDrugRef, 'form'>, lang = 'en'): string {
  const f = formOf(drug);
  const cycles = l.sched.type === 'cycle' ? (l.sched.cycles || 1) : 1;
  return segsOf(l).map((sg, i) => [
    doseShort(drug, sg.dose),
    i === 0 && f.site ? l.site : '',
    whenShort(sg.sched, lang),
    sg.sched.type === 'cycle' ? cycles + (cycles === 1 ? ' cycle' : ' cycles') : dayW(sg.dur || 0),
    i === 0 && f.food && l.food ? l.food.toLowerCase() + ' food' : '',
  ].filter(Boolean).join(' · ')).join(', then ');
}

// ── 14-day strip (data, not HTML) ────────────────────────────────────────────

export interface RxStripDay extends RxDayInfo {
  /** SOS day — `n` is a ceiling ("up to"), draw hollow dots. */
  sos: boolean;
}

export interface RxStripCell {
  date: Date;
  /** 0 = Sun … 6 = Sat. */
  weekday: number;
  /** Day 0 of the strip. */
  today: boolean;
  /** null ⇒ the course is over on that day ("done"). n = 0 ⇒ an off day. */
  day: RxStripDay | null;
}

/** The dose-pattern strip for the next `days` days from `start` (mockup `strip`). */
export function stripDays(l: RxLine, start: Date = new Date(), days = 14): RxStripCell[] {
  const out: RxStripCell[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const x = dayInfo(l, i, start);
    const sos = l.sched.type === 'sos' || (!!x && l.sched.type === 'steps' && l.sched.steps[x.step].sched.type === 'sos');
    out.push({ date, weekday: date.getDay(), today: i === 0, day: x ? { ...x, sos } : null });
  }
  return out;
}

// ── Shorthand parser ("clav 1-0-1 5d af") ────────────────────────────────────

const FQ: Record<string, number[]> = {
  od: [1, 0, 0], bd: [1, 0, 1], bid: [1, 0, 1], tds: [1, 1, 1], tid: [1, 1, 1], qid: [1, 1, 1, 1], hs: [0, 0, 1],
};

/** Drug lookup for parseRx — best match by brand prefix, then word start in
 *  brand + generic + aliases, then substring (mockup `bestDrug`). */
export function bestDrug<D extends RxDrugRef>(drugs: readonly D[], q: string): D | null {
  q = (q || '').trim().toLowerCase();
  if (!q) return null;
  let best: D | null = null, bs = 9;
  const rq = q.replace(/[^a-z0-9 ]/g, '');
  for (const d of drugs) {
    const bb = d.name.toLowerCase();
    const all = (d.name + ' ' + (d.generic || '') + ' ' + (d.aliases || '')).toLowerCase();
    const sc = bb.indexOf(q) === 0 ? 0 : (rq && new RegExp('(^|[^a-z])' + rq).test(all)) ? 1 : all.indexOf(q) >= 0 ? 2 : 9;
    if (sc < bs) { bs = sc; best = d; }
  }
  return best;
}

export interface RxParseResult<D extends RxDrugRef = RxDrugRef> {
  /** The drug words typed. */
  name: string;
  /** No drug matched `name`. */
  none?: true;
  drug?: D;
  line?: RxLine;
  /** Any instruction (schedule / duration / dose / food / side) was recognised. */
  any?: boolean;
}

/**
 * Parse doctor shorthand into a line: "<drug words> [dose][unit] [1-0-1 | od bd
 * tds qid hs bid tid | q2h | sos prn | eod alt | weekly] [5d | 2w | x5] [af bf
 * after before ac pc] [both right left be re le]". Words after the first
 * instruction never join the drug name. Returns null for empty input or no drug
 * words; `{ name, none: true }` when no drug matches.
 * `usualOf` supplies the doctor's usual for a drug (the base of the line).
 */
export function parseRx<D extends RxDrugRef>(
  raw: string,
  drugs: readonly D[],
  usualOf: (drugId: string) => RxUsual | null | undefined = id => RX_USUAL_EXAMPLES[id],
): RxParseResult<D> | null {
  const s = String(raw || '').toLowerCase()
    .replace(/(\d+(?:\.\d+)?|½)\s+(tabs?|tablets?|caps?|drops?|sprays?|puffs?|ml|sachets?)\b/g, '$1$2')
    .replace(/(\d+)\s+(d|days?|w|wks?|weeks?)\b/g, '$1$2')
    .replace(/\b(after|before)\s+(food|meals?)\b/g, '$1')
    .replace(/\bx\s+(\d)/g, 'x$1');
  const toks = s.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const name: string[] = [];
  const o: { sched?: RxSchedule; dur?: number; dose?: number; food?: RxFood; side?: number } = {};
  let instr = false;
  for (const t of toks) {
    let m: RegExpMatchArray | null;
    let hit = true;
    if ((m = t.match(/^([0-2]|½)-([0-2]|½)-([0-2]|½)(?:-([0-2]))?$/))) o.sched = timesSched(m.slice(1).filter(x => x != null).map(x => (x === '½' ? 0.5 : +x)));
    else if ((m = t.match(/^q([1-8])h$/))) o.sched = { type: 'hours', every: +m[1], awake: true };
    else if (FQ[t]) o.sched = timesSched(FQ[t].slice());
    else if (t === 'sos' || t === 'prn') o.sched = clone(SCHED_DEFAULTS.sos);
    else if (t === 'eod' || t === 'alt') o.sched = { type: 'days', mode: 'alt' };
    else if (t === 'weekly') o.sched = { type: 'days', mode: 'weekly', wd: [1] };
    else if ((m = t.match(/^x?(\d{1,3})(d|days?|w|wks?|weeks?)$/))) o.dur = +m[1] * (m[2][0] === 'w' ? 7 : 1);
    else if (/^(af|after|pc)$/.test(t)) o.food = 'After';
    else if (/^(bf|before|ac)$/.test(t)) o.food = 'Before';
    else if ((m = t.match(/^(\d+(?:\.\d+)?|½|half)(tabs?|tablets?|caps?|drops?|sprays?|puffs?|ml|sachets?)?$/)) && name.length
      && (m[2] || +m[1] <= 4 || m[1] === '½' || m[1] === 'half')) o.dose = m[1] === '½' || m[1] === 'half' ? 0.5 : +m[1];
    else if (/^(both|right|left|be|re|le)$/.test(t) && name.length) o.side = t[0] === 'b' ? 0 : t[0] === 'r' ? 1 : 2;
    else if (/^(food|for|x|a|day|daily|times|eyes?|ears?|nostrils?|nose|in|each)$/.test(t) && name.length) hit = false;
    else { hit = false; if (!instr) name.push(t); }
    if (hit) instr = true;
  }
  if (!name.length) return null;
  const nm = name.join(' ');
  const d = bestDrug(drugs, nm) || bestDrug(drugs, name[0]);
  if (!d) return { name: nm, none: true };
  const l = newRxLine(d.id, usualOf(d.id));
  const f = formOf(d);
  let any = false;
  if (o.sched) { l.sched = o.sched; if (!l.dur) l.dur = o.sched.type === 'sos' ? 3 : 5; any = true; }
  if (o.dur) {
    if (l.sched.type === 'steps') l.sched.steps[l.sched.steps.length - 1].dur = o.dur; else l.dur = o.dur;
    any = true;
  }
  if (o.dose && d.form !== 'cream') { l.dose = o.dose; any = true; }
  if (o.food && f.food) { l.food = o.food; any = true; }
  if (o.side != null && f.site) { l.site = SITES[d.siteKind || 'skin'][o.side] || l.site; any = true; }
  return { name: nm, drug: d, line: l, any };
}
