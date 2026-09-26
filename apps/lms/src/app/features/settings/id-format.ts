/**
 * ID-number formats (/api/config/{patient|sample|order}-id) — the preview
 * logic lifted from the Organization page so Settings shows the SAME
 * "Looks like" the backend will produce (GenerateScoped: a separator between
 * every non-empty part; the counter restarts each month).
 */
export type IdScope = 'patient' | 'sample' | 'order';

export interface IdFormatConfig {
  enabled?: boolean;
  datePrefix?: string;
  separator?: string;
  padding?: number;
  prefix?: string | null;
  serialMode?: 'numeric' | 'alpha' | string;
  letterCount?: number;
}

/** Stand-in prefix for the preview: the space code (samples), the module
 *  code (orders). Patients use their own "Starts with". */
export const ID_SAMPLE_PREFIX: Record<Exclude<IdScope, 'patient'>, string> = { sample: 'MIC', order: 'LAB' };

export const ID_DEFAULTS: Record<IdScope, Required<Omit<IdFormatConfig, 'prefix'>> & { prefix: string | null }> = {
  patient: { enabled: false, datePrefix: 'ddmmyy', separator: '-', padding: 4, prefix: null, serialMode: 'numeric', letterCount: 2 },
  sample: { enabled: true, datePrefix: 'yymm', separator: '-', padding: 5, prefix: null, serialMode: 'numeric', letterCount: 2 },
  order: { enabled: true, datePrefix: 'yymm', separator: '-', padding: 6, prefix: null, serialMode: 'numeric', letterCount: 2 },
};

export const DATE_OPTIONS = [
  { value: 'yymm', label: 'Year and month' },
  { value: 'yymmdd', label: 'Full date, year first' },
  { value: 'ddmmyy', label: 'Full date, day first' },
  { value: 'mmyy', label: 'Month and year' },
  { value: 'mmdd', label: 'Month and day' },
  { value: 'yy', label: 'Year only' },
  { value: 'dd', label: 'Day only' },
  { value: 'none', label: 'No date' },
];

export function padCap(pad: unknown, alpha: boolean): number {
  const max = alpha ? 6 : 10;
  const n = Math.abs(parseInt(String(pad), 10));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

export function datePart(fmt: string | undefined, now = new Date()): string {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  switch (fmt) {
    case 'yymmdd': return yy + mm + dd;
    case 'ddmmyy': return dd + mm + yy;
    case 'mmdd': return mm + dd;
    case 'yymm': return yy + mm;
    case 'mmyy': return mm + yy;
    case 'yy': return yy;
    case 'dd': return dd;
    default: return '';
  }
}

function serial(c: IdFormatConfig, defPad: number): string {
  const alpha = c.serialMode === 'alpha';
  const pad = padCap(c.padding ?? defPad, alpha);
  return alpha
    ? 'A'.repeat(Math.min(Math.max(c.letterCount ?? 2, 1), 4)) + '1'.padStart(pad, '0')
    : '1'.padStart(pad, '0');
}

/** What the FIRST new number will look like with today's date. */
export function idPreview(scope: IdScope, c: IdFormatConfig, now = new Date()): string {
  const d = ID_DEFAULTS[scope];
  if (scope === 'patient') {
    const head = (c.prefix ?? '') + datePart(c.datePrefix ?? d.datePrefix, now);
    const sep = c.separator ?? '';
    const ser = serial(c, d.padding);
    return head.length ? `${head}${sep}${ser}` : ser;
  }
  const parts = [ID_SAMPLE_PREFIX[scope], datePart(c.datePrefix ?? d.datePrefix, now), serial(c, d.padding)];
  return parts.filter((p) => p.length).join(c.separator ?? '');
}
