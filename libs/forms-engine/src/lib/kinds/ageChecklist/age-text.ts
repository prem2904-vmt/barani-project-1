/**
 * The patient's age as whole DAYS: the one unit the age checklist compares in. Mirror of the server's `AgeText.cs`
 * (shared vectors `casesheet-family.vectors.json` pin both). 1 month = 30.4375 days (365.25 / 12), 1 week = 7.
 */
export const DAYS_PER_MONTH = 30.4375;

const PART = /(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m|weeks?|wks?|w|days?|d)\b/gi;
const BARE = /^\d+(?:\.\d+)?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

const roundHalfUp = (x: number): number => Math.round(x); // positive numbers only: Math.round rounds .5 up, like AwayFromZero

export function toDays(n: number, unit: 'years' | 'months' | 'weeks' | 'days' | string): number {
  const per = unit === 'years' ? 12 * DAYS_PER_MONTH : unit === 'months' ? DAYS_PER_MONTH : unit === 'weeks' ? 7 : 1;
  return roundHalfUp(n * per);
}

function dayNumber(iso: string): number | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

/** Days from what the sheet's age question holds, or null. A birth date needs `asOf` (YYYY-MM-DD). */
export function parseAge(text: string | null | undefined, asOf?: string | null): number | null {
  if (!text || !text.trim()) return null;
  const t = text.trim();
  if (ISO.test(t) && t.length >= 10) {
    const born = dayNumber(t.slice(0, 10));
    if (born !== null) {
      const on = asOf ? dayNumber(asOf) : null;
      if (on === null || on < born) return null;
      return on - born;
    }
  }
  if (BARE.test(t)) return toDays(Number(t), 'years');
  let total = 0;
  let any = false;
  for (const m of t.matchAll(PART)) {
    const n = Number(m[1]);
    const u = m[2][0].toLowerCase();
    total += n * (u === 'y' ? 12 * DAYS_PER_MONTH : u === 'm' ? DAYS_PER_MONTH : u === 'w' ? 7 : 1);
    any = true;
  }
  return any ? roundHalfUp(total) : null;
}

/** "5 days", "6 weeks", "18 months", "2 years 6 months". */
export function ageWords(days: number): string {
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  const months = days / DAYS_PER_MONTH;
  if (months < 3) return `${roundHalfUp(days / 7)} weeks`;
  if (months < 24) {
    const mo = Math.floor(months);
    return mo === 1 ? '1 month' : `${mo} months`;
  }
  const years = Math.floor(months / 12);
  const rest = Math.floor(months - years * 12);
  const y = years === 1 ? '1 year' : `${years} years`;
  return rest === 0 ? y : `${y} ${rest === 1 ? '1 month' : rest + ' months'}`;
}

const AGE_WORDS = new Set(['age', 'patientage']);
const norm = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/** The age the sheet already knows: the question named in `config.ageField`, else the sheet's own age question (the one the patient record fills). */
export function ageFromSheet(
  self: { key: string; config?: Record<string, unknown> },
  fields: { key: string; label: string }[],
  answers: Record<string, unknown>,
  asOf?: string | null,
): number | null {
  const text = (k: string): string | null => {
    const v = answers[k];
    return v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  const named = self.config?.['ageField'];
  if (typeof named === 'string' && named.trim()) return parseAge(text(named), asOf);
  for (const f of fields) {
    if (f.key === self.key || !(AGE_WORDS.has(norm(f.key)) || AGE_WORDS.has(norm(f.label)))) continue;
    const d = parseAge(text(f.key), asOf);
    if (d !== null) return d;
  }
  return null;
}
