// Patient age — THE one client-side helper (owner, 2026-09-29: "DOB is
// directly related to the age calculation").
//
// The date of birth is the single source. Every screen that shows or uses a
// patient's age goes through here. Mirrors the server's `PatientAge`
// (Prefrontal/Services/PatientAge.cs), rule for rule:
//
//  • A DOB is its CALENDAR date (the yyyy-MM-dd the user typed; the server
//    stores it as UTC midnight) — never shifted by the browser's time zone.
//  • Calendar age = whole years / months / days to today's local date
//    (the lab's date: every lab runs in IST, as do its browsers).
//  • Band-pick age (reference ranges, live flag hint) = whole days / 365.25 —
//    the SAME metric the server flags with, so the hint matches the saved flag.
//    The server's `ageYears` is preferred when a payload carries it.
//  • Display: years ≥ 1 → years; else months ≥ 1 → months; else days.
//    An infant is never "0 Y".
//  • No DOB → the stored whole-years `age` (legacy rows).

/** The minimum a patient-like object needs to carry. */
export interface AgeSource {
  dateOfBirth?: string | null;
  age?: number | null;
  /** Server-computed fractional band age (days / 365.25), when present. */
  ageYears?: number | null;
  /** Server-computed display ("34 Y" / "8 M" / "12 D") — e.g. a report
   *  snapshot's age at collection, which carries no DOB. */
  ageDisplay?: string | null;
}

export interface AgeParts {
  years: number;
  /** Months after `years` (0–11). */
  months: number;
  /** Days after `months`. */
  days: number;
  /** Days since birth. */
  totalDays: number;
  /** Total whole months since birth. */
  totalMonths: number;
  /** Fractional years for band selection (totalDays / 365.25). */
  fractionalYears: number;
}

/** A DOB string's calendar date (local midnight), or null. Accepts
 *  "yyyy-MM-dd" and full ISO instants ("…T00:00:00Z" → that UTC date). */
export function dobDate(dob: string | null | undefined): Date | null {
  if (!dob) return null;
  const m = String(dob).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const iso = String(dob);
    // An instant that is not UTC midnight (e.g. IST midnight sent as
    // "…T18:30:00.000Z") → its LOCAL date, like the server's lab-local read.
    const t = iso.length > 10 ? new Date(iso) : null;
    if (t && !isNaN(t.getTime()) && !/T00:00(:00(\.0+)?)?(Z|\+00:00)?$/.test(iso)) {
      return new Date(t.getFullYear(), t.getMonth(), t.getDate());
    }
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  const d = new Date(String(dob));
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const localToday = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** y/m/d + n months, clamped to the month's last day (as .NET AddMonths). */
function addMonths(d: Date, n: number): Date {
  const y = d.getFullYear(), m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last));
}

const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

/** Calendar age of a DOB on `now`'s local date. Null when absent / invalid / in the future. */
export function ageParts(dob: string | null | undefined, now: Date = new Date()): AgeParts | null {
  const b = dobDate(dob);
  if (!b) return null;
  const t = localToday(now);
  if (b > t) return null;
  let years = t.getFullYear() - b.getFullYear();
  if (addMonths(b, years * 12) > t) years--;
  const anchor = addMonths(b, years * 12);
  let months = (t.getFullYear() - anchor.getFullYear()) * 12 + t.getMonth() - anchor.getMonth();
  if (addMonths(anchor, months) > t) months--;
  const days = dayDiff(addMonths(anchor, months), t);
  const totalDays = dayDiff(b, t);
  return { years, months, days, totalDays, totalMonths: years * 12 + months, fractionalYears: totalDays / 365.25 };
}

/** The patient's calendar age: DOB-derived, else the stored whole years. */
export function patientAge(p: AgeSource | null | undefined, now: Date = new Date()): AgeParts | null {
  if (!p) return null;
  const fromDob = ageParts(p.dateOfBirth, now);
  if (fromDob) return fromDob;
  const shown = /^\s*(\d+)\s*([YMD])\s*$/i.exec(p.ageDisplay ?? '');
  if (shown) {
    const n = +shown[1], u = shown[2].toUpperCase();
    const fy = typeof p.ageYears === 'number' && Number.isFinite(p.ageYears) ? p.ageYears : null;
    if (u === 'Y') return { years: n, months: 0, days: 0, totalDays: Math.round(n * 365.25), totalMonths: n * 12, fractionalYears: fy ?? n };
    if (u === 'M') return { years: 0, months: n, days: 0, totalDays: Math.round(n * 30.4375), totalMonths: n, fractionalYears: fy ?? n / 12 };
    return { years: 0, months: 0, days: n, totalDays: n, totalMonths: 0, fractionalYears: fy ?? n / 365.25 };
  }
  const a = typeof p.age === 'number' && Number.isFinite(p.age) && p.age >= 0 ? Math.floor(p.age) : null;
  if (a == null) return null;
  const totalDays = Math.round(a * 365.25);
  return { years: a, months: 0, days: 0, totalDays, totalMonths: a * 12, fractionalYears: a };
}

/** Whole years (DOB-derived, else stored) or null — for workflow rules
 *  ("age < 18") and anything that genuinely wants whole years. */
export function ageInYears(p: AgeSource | null | undefined, now: Date = new Date()): number | null {
  return patientAge(p, now)?.years ?? null;
}

/** Fractional years for reference-band selection and the live flag hint —
 *  the server's metric. Server `ageYears` first, else from the DOB, else the
 *  stored age. */
export function bandAgeYears(p: AgeSource | null | undefined, now: Date = new Date()): number | null {
  if (!p) return null;
  if (typeof p.ageYears === 'number' && Number.isFinite(p.ageYears) && p.ageYears >= 0) return p.ageYears;
  return patientAge(p, now)?.fractionalYears ?? null;
}

/**
 * How an age prints. Adult output is byte-identical to each screen's old
 * format; an infant swaps in months / days in the same style.
 *
 *  style      adult        infant (8 months / 12 days)
 *  'short'    "34 Y"       "8 M" / "12 D"      (canonical, = server ageDisplay)
 *  'Y'        "34Y"        "8M" / "12D"        (tube labels, post-payment)
 *  'y'        "34y"        "8m" / "12d"        (compact lists)
 *  'num'      "34"         "8M" / "12D"        (the "34/M" age/sex slot)
 *  'yrs'      "34 yrs"     "8 mos" / "12 days"
 *  'Years'    "34 Years"   "8 Months" / "12 Days"   (report "Age :")
 *  'long'     "34 years"   "8 months" / "1 day"     (singular at 1)
 */
export type AgeStyle = 'short' | 'Y' | 'y' | 'num' | 'yrs' | 'Years' | 'long';

/** Months / days are never abbreviated on anything a PATIENT reads (the report
 *  strip, the public report page — OPS-141): `spellInfant` prints them in full
 *  whatever the style ("8 months", "12 days", "1 month"; the 'Years' style
 *  keeps its capitals: "8 Months"). Years still follow the style. */
export function formatAgeParts(a: AgeParts, style: AgeStyle = 'short', spellInfant = false): string {
  const unit: 'y' | 'm' | 'd' = a.years >= 1 ? 'y' : a.totalMonths >= 1 ? 'm' : 'd';
  const n = unit === 'y' ? a.years : unit === 'm' ? a.totalMonths : a.totalDays;
  const one = n === 1;
  if (spellInfant && unit !== 'y') {
    const word = unit === 'm' ? (one ? 'month' : 'months') : (one ? 'day' : 'days');
    return `${n} ${style === 'Years' ? word.charAt(0).toUpperCase() + word.slice(1) : word}`;
  }
  switch (style) {
    case 'Y': return `${n}${unit.toUpperCase()}`;
    case 'y': return `${n}${unit}`;
    case 'num': return unit === 'y' ? `${n}` : `${n}${unit.toUpperCase()}`;
    case 'yrs': return `${n} ${unit === 'y' ? 'yrs' : unit === 'm' ? 'mos' : 'days'}`;
    case 'Years': return `${n} ${unit === 'y' ? 'Years' : unit === 'm' ? 'Months' : 'Days'}`;
    case 'long': return `${n} ${unit === 'y' ? (one ? 'year' : 'years') : unit === 'm' ? (one ? 'month' : 'months') : (one ? 'day' : 'days')}`;
    default: return `${n} ${unit.toUpperCase()}`;
  }
}

/** The patient's age in `style`, or `fallback` ('' by default) when unknown. */
export function formatAge(p: AgeSource | null | undefined, style: AgeStyle = 'short', fallback = '', now: Date = new Date(), spellInfant = false): string {
  const a = patientAge(p, now);
  return a ? formatAgeParts(a, style, spellInfant) : fallback;
}

/** "yyyy-MM-dd" of a local date. */
export function isoDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
