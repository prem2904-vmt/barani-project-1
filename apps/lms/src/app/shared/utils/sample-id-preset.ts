/**
 * Sample-ID search preset (a lab user's suggestion): the lab screens' sample
 * search boxes open pre-typed with the CURRENT sample-ID head — "2609" in
 * September, "2610" in October — so a lab doing 1000+ samples a day types only
 * the tail number. A user working a single department / space gets its code
 * too ("HEM26…", "MIC-2609-").
 *
 * Mirrors the backend composition exactly (BarcodeService.HeadFor +
 * MrnGenerator.GenerateScoped): ID = [prefix][sep][date][sep][serial], empty
 * parts dropped. The date is the LAB's date (the branch timezone, default
 * Asia/Kolkata) — never the device's or UTC's — and is computed at focus
 * time, so the preset rolls over on the 1st without a reload.
 */

/** GET /api/config/sample-search-preset. */
export interface SampleSearchPresetConfig {
  /** Server's effective switch (tenant setting ?? default, and a head exists). */
  enabled: boolean;
  /** The lab's explicit Lab-settings choice; null = automatic. */
  setting: boolean | null;
  /** Automatic default: on for formats starting with year+month. */
  defaultEnabled: boolean;
  /** This user's sample-ID prefix ("" when IDs start with the date). */
  prefix: string;
  prefixSource: 'lab' | 'space' | 'department';
  datePrefix: string;
  separator: string;
  padding: number;
  serialMode: string;
  timeZone: string;
}

export const DEFAULT_LAB_TIME_ZONE = 'Asia/Kolkata';

export interface LabDate { yy: string; mm: string; dd: string }

/** The lab's calendar date for an instant, in `timeZone` (IANA). Falls back
 *  to IST arithmetic (UTC+05:30, no DST) when Intl can't resolve the zone. */
export function labDate(now: Date, timeZone: string | null | undefined = DEFAULT_LAB_TIME_ZONE): LabDate {
  const tz = timeZone || DEFAULT_LAB_TIME_ZONE;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: '2-digit', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const yy = get('year'), mm = get('month'), dd = get('day');
    if (/^\d{2}$/.test(yy) && /^\d{2}$/.test(mm) && /^\d{2}$/.test(dd)) return { yy, mm, dd };
  } catch { /* unknown zone / no Intl tz data → IST below */ }
  const ist = new Date(now.getTime() + 330 * 60_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return { yy: two(ist.getUTCFullYear() % 100), mm: two(ist.getUTCMonth() + 1), dd: two(ist.getUTCDate()) };
}

/** The 1st of the month after `d` (Dec → Jan of the next year). */
export function nextLabMonth(d: LabDate): LabDate {
  const m = Number(d.mm) + 1;
  const two = (x: number) => String(x).padStart(2, '0');
  return m > 12
    ? { yy: two((Number(d.yy) + 1) % 100), mm: '01', dd: '01' }
    : { yy: d.yy, mm: two(m), dd: '01' };
}

/** The date part of an ID for a format ("yymm" → "2609"); "" for "none". */
export function formatDatePart(datePrefix: string | null | undefined, d: LabDate): string {
  switch ((datePrefix ?? '').toLowerCase()) {
    case 'yymmdd': return d.yy + d.mm + d.dd;
    case 'ddmmyy': return d.dd + d.mm + d.yy;
    case 'mmdd': return d.mm + d.dd;
    case 'yymm': return d.yy + d.mm;
    case 'mmyy': return d.mm + d.yy;
    case 'yy': return d.yy;
    case 'dd': return d.dd;
    default: return '';
  }
}

/** Everything an ID prints before its running number, e.g. "2609",
 *  "HEM26", "MIC-2609-". Same rule as the server's HeadFor. */
export function sampleIdHead(prefix: string | null | undefined, datePrefix: string | null | undefined,
                             separator: string | null | undefined, d: LabDate): string {
  const sep = separator ?? '';
  const head = [(prefix ?? '').trim().toUpperCase(), formatDatePart(datePrefix, d)].filter(p => p.length > 0).join(sep);
  return head.length > 0 ? head + sep : '';
}

/**
 * The text to pre-type, or null for none. `setting` is the live Lab-settings
 * value (tenant state) so a toggle applies without refetching the config;
 * undefined → use the config's own.
 */
export function samplePreset(cfg: SampleSearchPresetConfig | null | undefined, now: Date = new Date(),
                             setting?: boolean | null): string | null {
  if (!cfg) return null;
  const explicit = setting !== undefined ? setting : cfg.setting;
  const on = explicit ?? cfg.defaultEnabled;
  if (!on) return null;
  const head = sampleIdHead(cfg.prefix, cfg.datePrefix, cfg.separator, labDate(now, cfg.timeZone));
  return head.length > 0 ? head : null;
}
