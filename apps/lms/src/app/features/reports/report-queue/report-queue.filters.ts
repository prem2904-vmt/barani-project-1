import { addDays, istDateOf } from '../../../shared/utils/lab-clock';
import type { Report } from '../../../shared/models/report.model';
import type { PrelimOrder } from './report-queue.partial';

/**
 * Results FILTERS side card (owner 2026-11-20, "just like the Expenses filter"): pure rules, no Angular.
 *
 * The queue API pages by delivery status + search only (no dates, doctor or channel), so these filters run on the
 * LOADED rows. The queue is ordered newest first, so a date range is complete once the oldest loaded report is older
 * than the range's start (`shouldScan` keeps loading pages until then, within a page cap). Doctor / channel without a
 * date scan the latest `SCAN_PAGES_NO_DATE` pages.
 */

/** Date presets: All (the screen's old view — no date limit), Today, 7 days, This month, or a custom From / To. */
export type DatePreset = 'all' | 'today' | '7d' | 'month' | 'custom';
/** An IST day range, both ends inclusive (YYYY-MM-DD); null = open. */
export interface DayRange { from: string | null; to: string | null }

export interface RqClientFilters {
  range: DayRange;
  /** Referring doctor name ('' = any). */
  doctor: string;
  /** Delivered via ('' = any): print | whatsapp | email | sms | … as stored on the report. */
  via: string;
}

export const NO_CLIENT_FILTERS: RqClientFilters = { range: { from: null, to: null }, doctor: '', via: '' };

/** Pages a date-bounded scan may read (50 rows each). */
export const SCAN_PAGES_DATE = 40;
/** Pages a doctor / channel scan reads when no date bounds it. */
export const SCAN_PAGES_NO_DATE = 10;

export function presetRange(p: DatePreset, today: string): DayRange {
  if (p === 'today') return { from: today, to: today };
  if (p === '7d') return { from: addDays(today, -6), to: today };
  if (p === 'month') return { from: today.slice(0, 8) + '01', to: today };
  return { from: null, to: null };
}

export function dateActive(r: DayRange): boolean { return !!(r.from || r.to); }

export function clientActive(f: RqClientFilters): boolean {
  return dateActive(f.range) || !!f.doctor || !!f.via;
}

/** The instant falls inside the IST day range (an undated row passes only an open range). */
export function inDayRange(iso: string | null | undefined, r: DayRange): boolean {
  if (!dateActive(r)) return true;
  if (!iso) return false;
  const d = istDateOf(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return (!r.from || d >= r.from) && (!r.to || d <= r.to);
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function reportPasses(r: Report, f: RqClientFilters): boolean {
  if (!inDayRange(r.createdAt, f.range)) return false;
  if (f.doctor && norm(r.order?.refDoctorName) !== norm(f.doctor)) return false;
  if (f.via && (r.deliveryStatus !== 'delivered' || norm(r.deliveredVia) !== norm(f.via))) return false;
  return true;
}

/** A partly-reported order: dated by the order; never "delivered via" anything yet. */
export function partialPasses(po: PrelimOrder, f: RqClientFilters): boolean {
  if (f.via) return false;
  if (!inDayRange(po.createdAt, f.range)) return false;
  if (f.doctor && norm(po.refDoctorName) !== norm(f.doctor)) return false;
  return true;
}

/** Distinct referring doctors on the rows (display spelling of the first seen), A→Z. */
export function doctorNames(rows: readonly Report[], partials: readonly PrelimOrder[] = []): string[] {
  const seen = new Map<string, string>();
  const add = (n: string | null | undefined) => { const k = norm(n); if (k && !seen.has(k)) seen.set(k, (n ?? '').trim()); };
  rows.forEach((r) => add(r.order?.refDoctorName));
  partials.forEach((p) => add(p.refDoctorName));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Distinct delivery channels on the delivered rows, in a fixed order (unknown ones after). */
export function viaKeys(rows: readonly Report[]): string[] {
  const order = ['whatsapp', 'print', 'email', 'sms'];
  const set = new Set(rows.filter((r) => r.deliveryStatus === 'delivered').map((r) => norm(r.deliveredVia)).filter(Boolean));
  return [...set].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
}

export function viaLabel(v: string): string {
  const k = norm(v);
  if (k === 'print') return 'Print';
  if (k === 'whatsapp') return 'WhatsApp';
  if (k === 'email') return 'Email';
  if (k === 'sms') return 'SMS';
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : '';
}

export interface BreakdownRow<K extends string = string> { key: K; label: string; count: number; dot: string; share: number }

/** Adds each row's share (0–100) of the group's total — the hairline bar under it. */
export function withShares<K extends string>(rows: Omit<BreakdownRow<K>, 'share'>[]): BreakdownRow<K>[] {
  const sum = rows.reduce((n, r) => n + r.count, 0);
  return rows.map((r) => ({ ...r, share: sum > 0 ? Math.round((r.count / sum) * 1000) / 10 : 0 }));
}

/** How many filters are on (the narrow Filters button's badge): status, dates, doctor, channel. */
export function activeCount(status: string, f: RqClientFilters): number {
  return (status !== 'all' ? 1 : 0) + (dateActive(f.range) ? 1 : 0) + (f.doctor ? 1 : 0) + (f.via ? 1 : 0);
}

/** Keep reading pages while a client filter needs rows the screen has not loaded yet. */
export function shouldScan(o: {
  active: boolean; hasMore: boolean; busy: boolean; pages: number; from: string | null; oldestIso?: string | null;
}): boolean {
  if (!o.active || !o.hasMore || o.busy) return false;
  if (o.pages >= (o.from ? SCAN_PAGES_DATE : SCAN_PAGES_NO_DATE)) return false;
  // Newest first: once the oldest loaded report is before the range, every later page is too.
  if (o.from && o.oldestIso && istDateOf(o.oldestIso) < o.from) return false;
  return true;
}
