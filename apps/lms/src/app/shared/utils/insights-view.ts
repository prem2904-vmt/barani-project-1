/**
 * Insights (Analytics) — pure DISPLAY helpers: how a server-computed Δ reads,
 * how a trend bucket labels and drills, how minutes read. Nothing here
 * recomputes a KPI (the calculation layer is the server's AnalyticsService);
 * these only decide words, tone and the drill range of a bucket the server
 * already returned.
 */
import { addDays } from './lab-clock';

export type DeltaTone = 'good' | 'bad' | 'neutral';
export type DeltaKind = 'change' | 'flat' | 'new' | 'none';

export interface DeltaView {
  kind: DeltaKind;
  tone: DeltaTone;
  /** Short chip text: "+12%", "−8%", "0%", "New", "—". */
  text: string;
  /** Screen-reader / tooltip sentence. */
  sentence: string;
  /** Arrow direction for the chip glyph. */
  dir: 'up' | 'down' | null;
}

/** Changes smaller than this (in %) read as neutral — a 0.6% wobble is not news. */
export const DELTA_NOISE_PCT = 2;

/**
 * How a KPI's Δ vs the previous equal period reads (owner, 2026-10-02):
 * - nothing this period AND nothing before (server Δ = null, value 0) → "—", neutral;
 * - something now, nothing before (server Δ = null) → "New", neutral — never "+∞%";
 * - nothing now but something before → the real "−100%" is still shown, but
 *   neutral: an in-progress period with no activity yet is not a red alarm;
 * - |Δ| under {@link DELTA_NOISE_PCT} → neutral;
 * - otherwise green/red by direction, inverted for "lower is better" (TAT),
 *   and never coloured for a mix metric (`neutral: true`, e.g. outsourced %).
 */
export function deltaView(
  current: number | null | undefined,
  deltaPct: number | null | undefined,
  opts: { lowerIsBetter?: boolean; neutral?: boolean } = {},
): DeltaView {
  const cur = current ?? 0;
  if (deltaPct == null) {
    if (!cur) return { kind: 'none', tone: 'neutral', text: '—', sentence: 'No data in this or the previous period', dir: null };
    return { kind: 'new', tone: 'neutral', text: 'New', sentence: 'Nothing in the previous period to compare with', dir: null };
  }
  const rounded = Math.round(deltaPct * 10) / 10;
  if (rounded === 0) return { kind: 'flat', tone: 'neutral', text: '0%', sentence: 'No change vs the previous period', dir: null };
  const dir: 'up' | 'down' = rounded > 0 ? 'up' : 'down';
  const abs = Math.abs(rounded);
  const text = `${rounded > 0 ? '+' : '−'}${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)}%`;
  const sentence = `${dir === 'up' ? 'Up' : 'Down'} ${text.slice(1)} vs the previous period`;
  let tone: DeltaTone = 'neutral';
  if (!opts.neutral && cur !== 0 && abs >= DELTA_NOISE_PCT) {
    const better = opts.lowerIsBetter ? dir === 'down' : dir === 'up';
    tone = better ? 'good' : 'bad';
  }
  return { kind: 'change', tone, text, sentence, dir };
}

export type BucketUnit = 'day' | 'week' | 'month';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d ?? 1];
}

/** "2 Oct" · "2 Oct 2026" (withYear). */
export function shortDay(ymd: string, withYear = false): string {
  const [y, m, d] = ymdParts(ymd);
  return `${d} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`;
}

/** X-axis label of a server trend bucket: day "2 Oct", week "w/c 28 Sep", month "Oct 2026". */
export function bucketAxisLabel(label: string, unit: string | null | undefined): string {
  if (!label) return '';
  if (unit === 'month' || /^\d{4}-\d{2}$/.test(label)) {
    const [y, m] = ymdParts(label);
    return `${MONTHS[m - 1]} ${y}`;
  }
  if (unit === 'week') return `w/c ${shortDay(label)}`;
  return shortDay(label);
}

function lastDayOfMonth(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The IST day range a clicked trend bucket stands for, clipped to the
 *  period on screen (server `BuildBuckets` mirror: a week starts on its
 *  Monday label, a month is "yyyy-MM"). Drives the chart → list drill. */
export function bucketRange(label: string, unit: string | null | undefined, periodFrom: string, periodTo: string): { fromYmd: string; toYmd: string } {
  let from: string, to: string;
  if (unit === 'month' || /^\d{4}-\d{2}$/.test(label)) {
    const [y, m] = ymdParts(label);
    from = `${y}-${String(m).padStart(2, '0')}-01`;
    to = lastDayOfMonth(y, m);
  } else if (unit === 'week') {
    from = label;
    to = addDays(label, 6);
  } else {
    from = to = label;
  }
  if (from < periodFrom) from = periodFrom;
  if (to > periodTo) to = periodTo;
  return { fromYmd: from, toYmd: to };
}

/** "1 – 2 Oct 2026" · "2 Oct 2026" · "28 Sep – 2 Oct 2026" · "1 Dec 2025 – 2 Jan 2026". */
export function rangeLabel(fromYmd: string, toYmd: string): string {
  if (fromYmd === toYmd) return shortDay(fromYmd, true);
  const [fy, fm] = ymdParts(fromYmd);
  const [ty, tm, td] = ymdParts(toYmd);
  if (fy === ty && fm === tm) return `${ymdParts(fromYmd)[2]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${shortDay(fromYmd)} – ${shortDay(toYmd)} ${ty}`;
  return `${shortDay(fromYmd, true)} – ${shortDay(toYmd, true)}`;
}

/** Minutes → "42 min" · "1h 35m" · "2d 3h". Null → "—". */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null || !isFinite(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  const d = Math.floor(m / 1440), h = Math.round((m % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** Indian-grouped integer ("12,34,567"). */
export function formatCount(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

/** Rupees, Indian grouping, no decimals; compact (₹1.2L / ₹3.4Cr) for tiles when asked. */
export function formatRupee(v: number | null | undefined, compact = false): string {
  if (v == null || !isFinite(v)) return '—';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (compact && a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (compact && a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}

/** True when a series has nothing worth drawing (empty or every point 0). */
export function allZero(values: ReadonlyArray<number | null | undefined>): boolean {
  return !values.length || values.every(v => !v);
}
