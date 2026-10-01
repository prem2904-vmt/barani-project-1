/**
 * Analytics / Lab Insights (Phase 1) — the filter band's period presets
 * resolved to IST calendar days, TS mirror of the server's single source
 * (prefrontal-mw Prefrontal/Services/Analytics/AnalyticsDefinitions.cs
 * `ResolvePeriod`; rule 1 "one source of truth" — tested TS mirrors of
 * server logic are an allowed second copy). Built on the app's ONE IST
 * clock (`lab-clock.ts`) — never a raw `Date` day boundary.
 */
import { addDays, istDayRange, labToday } from './lab-clock';

export type AnalyticsPeriodPreset = 'today' | '7d' | 'month' | 'lastMonth' | 'quarter' | 'custom';

export interface AnalyticsPeriod {
  /** IST calendar days, inclusive. */
  fromYmd: string;
  toYmd: string;
  /** [from, to) UTC instants — what the API's date-range filters expect. */
  fromUtc: string;
  toUtc: string;
}

export const ANALYTICS_PERIOD_OPTIONS: ReadonlyArray<{ value: AnalyticsPeriodPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'custom', label: 'Custom' },
];

function monthStartOf(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function quarterStartOf(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, '0')}-01`;
}

/** Resolve a period preset (+ optional custom range) against "now" (defaults
 *  to `new Date()`, overridable only by tests/specs) into IST calendar days
 *  and their query instants. Throws on an unknown preset or an incomplete
 *  custom range — the caller (the filter band) never sends a half-built one. */
export function resolveAnalyticsPeriod(
  preset: AnalyticsPeriodPreset, customFromYmd?: string, customToYmd?: string, now: Date = new Date(),
): AnalyticsPeriod {
  const today = labToday(now);
  let fromYmd: string, toYmd: string;
  switch (preset) {
    case 'today':
      fromYmd = toYmd = today;
      break;
    case '7d':
      toYmd = today;
      fromYmd = addDays(today, -6);
      break;
    case 'month':
      toYmd = today;
      fromYmd = monthStartOf(today);
      break;
    case 'lastMonth': {
      const firstOfThis = monthStartOf(today);
      toYmd = addDays(firstOfThis, -1);
      fromYmd = monthStartOf(toYmd);
      break;
    }
    case 'quarter':
      toYmd = today;
      fromYmd = quarterStartOf(today);
      break;
    case 'custom':
      if (!customFromYmd || !customToYmd) throw new Error('custom period needs both from and to');
      if (customToYmd < customFromYmd) throw new Error('custom period: to must not be before from');
      fromYmd = customFromYmd;
      toYmd = customToYmd;
      break;
    default:
      throw new Error(`unknown analytics period preset '${preset}'`);
  }
  const { from, to } = istDayRange(fromYmd, toYmd);
  return { fromYmd, toYmd, fromUtc: from, toUtc: to };
}
