import { cashVariance } from '../../shared/models/expense.model';

/**
 * Day closing (Finance → Daily statement) — the pure logic behind the screen (no Angular): the cash variance to
 * the paisa, the plain words for it, when Close day is allowed, the by-mode rows and the closure snapshot reader.
 */

export interface ModeTotal { mode: string; count: number; total: number; }

/** A closure as `/api/finance/closures` and the statement carry it. A legacy close made in the expense book alone
 *  (`source: 'expense_book'`, before the one day-close) has no count: expected / counted / variance are null. */
export interface Closure {
  id: string;
  date: string;
  shift?: string | null;
  openingBalance: number;
  expectedCash: number | null;
  countedCash: number | null;
  variance: number | null;
  totalsJson?: string | null;
  note?: string | null;
  closedBy?: string | null;
  closedAt: string;
  /** Who closed it (the server's name lookup), when known. */
  closedByName?: string | null;
  /** day_close (the one day-close) · daily_statement (older, payment split only) · expense_book (legacy, no count). */
  source?: 'day_close' | 'daily_statement' | 'expense_book' | null;
}

/** "1,234.50" / "₹ 1,234.5" / "" → a paisa-exact number (null = blank / not money). */
export function parseRupees(text: string): number | null {
  const t = (text ?? '').replace(/[,₹\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) / 100 !== n) return null;
  return n;
}

export type VarianceKind = 'none' | 'balanced' | 'short' | 'over';

/** Counted − expected to the paisa (negative = the drawer is short). Null until a count is typed. */
export function varianceOf(counted: number | null, expected: number): number | null {
  return counted === null ? null : cashVariance(counted, expected) + 0;   // + 0: never -0
}

export function varianceKind(variance: number | null): VarianceKind {
  if (variance === null) return 'none';
  if (variance === 0) return 'balanced';
  return variance < 0 ? 'short' : 'over';
}

/** "₹50" / "₹50.25" — whole rupees without decimals, paise when present. */
export function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  const whole = Math.round(v * 100) % 100 === 0;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** "₹6,850.00" — always two decimals (the figures strip and the count summary). */
export function money2(n: number | null | undefined): string {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The summary row for a variance: "Short by ₹50.00" / "Over by ₹100.00" / "Balanced". */
export function varianceRow(variance: number | null): { label: string; amount: string; kind: VarianceKind } {
  const kind = varianceKind(variance);
  if (kind === 'short') return { label: 'Short by', amount: money2(Math.abs(variance!)), kind };
  if (kind === 'over') return { label: 'Over by', amount: money2(variance!), kind };
  if (kind === 'balanced') return { label: 'Balanced', amount: '', kind };
  return { label: 'Short or over', amount: '—', kind };
}

/** The Days list's word under a closed day: "Balanced" / "Short ₹20" / "Over ₹100" ("No count" for a legacy
 *  expense-book close, which never counted the drawer). */
export function closureWord(variance: number | null | undefined): string {
  if (variance === null || variance === undefined) return 'No count';
  const k = varianceKind(variance);
  return k === 'short' ? `Short ${money(Math.abs(variance))}` : k === 'over' ? `Over ${money(variance)}` : 'Balanced';
}

/** Does a counted amount that is not balanced need a note? (Yes: short or over.) */
export function noteRequired(variance: number | null): boolean {
  return variance !== null && variance !== 0;
}

/**
 * Close day is allowed only when there is something to close: the day is open, a count is entered, the note is
 * filled when the drawer is short or over, and nothing is already being saved.
 */
export function canCloseDay(o: { loaded: boolean; closed: boolean; counted: number | null; variance: number | null; note: string; saving: boolean }): boolean {
  if (!o.loaded || o.closed || o.saving || o.counted === null) return false;
  return !noteRequired(o.variance) || o.note.trim().length > 0;
}

/** The statement's payments with the four always-on modes first (idle ones at 0) and any other mode after. */
export const MODE_DEFS: { id: string; label: string; iconPath: string }[] = [
  { id: 'upi', label: 'UPI', iconPath: 'M4 4h16v16H4zM9 9h6v6H9z' },
  { id: 'cash', label: 'Cash', iconPath: 'M3 6h18v12H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z' },
  { id: 'card', label: 'Card', iconPath: 'M3 5h18v14H3zM3 10h18' },
  { id: 'wallet', label: 'Credit wallet', iconPath: 'M4 7h16v12H4zM4 7l2-3h12l2 3M16 13h2' },
];
export const OTHER_ICON = 'M12 8v8M8 12h8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';

export interface ModeRow { mode: string; label: string; iconPath: string; collected: number; count: number; refunded: number; }

export function modeRows(payments: readonly ModeTotal[], refunds: readonly ModeTotal[]): ModeRow[] {
  const pay = new Map(payments.map((p) => [p.mode, p]));
  const ref = new Map(refunds.map((r) => [r.mode, r]));
  const rows: ModeRow[] = MODE_DEFS.map((d) => ({
    mode: d.id, label: d.label, iconPath: d.iconPath,
    collected: pay.get(d.id)?.total ?? 0, count: pay.get(d.id)?.count ?? 0, refunded: ref.get(d.id)?.total ?? 0,
  }));
  const known = new Set(MODE_DEFS.map((d) => d.id));
  for (const m of new Set([...pay.keys(), ...ref.keys()].filter((k) => !known.has(k)))) {
    rows.push({ mode: m, label: m.charAt(0).toUpperCase() + m.slice(1), iconPath: OTHER_ICON,
      collected: pay.get(m)?.total ?? 0, count: pay.get(m)?.count ?? 0, refunded: ref.get(m)?.total ?? 0 });
  }
  return rows;
}

/** A closure's by-mode snapshot (what the day collected when it was closed), or null when unreadable. */
export function closureTotals(c: Pick<Closure, 'totalsJson'>): { collected: number; refunded: number; payments: ModeTotal[]; refunds: ModeTotal[] } | null {
  if (!c.totalsJson) return null;
  try {
    const j = JSON.parse(c.totalsJson) as { payments?: ModeTotal[]; refunds?: ModeTotal[] };
    const payments = Array.isArray(j.payments) ? j.payments : [];
    const refunds = Array.isArray(j.refunds) ? j.refunds : [];
    return { collected: payments.reduce((n, p) => n + (p.total ?? 0), 0), refunded: refunds.reduce((n, r) => n + (r.total ?? 0), 0), payments, refunds };
  } catch { return null; }
}

/** One row of the Days list. */
export interface DayRow {
  key: string;
  date: string;
  shift: string | null;
  /** null = today still open. */
  closure: Closure | null;
  open: boolean;
}

/**
 * The Days list: today first (as "Open" unless a closure for today + the shown shift exists), then the closures
 * newest first. `shift` filters ('' = all shifts); `today` is the IST business day.
 */
export function dayRows(closures: readonly Closure[], today: string, shift: string): DayRow[] {
  const keep = closures.filter((c) => !shift || (c.shift ?? '') === shift);
  const sorted = keep.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
  const rows: DayRow[] = sorted.map((c) => ({ key: c.id, date: c.date, shift: c.shift ?? null, closure: c, open: false }));
  const todayClosed = sorted.some((c) => c.date === today && (c.shift ?? '') === shift);
  if (!todayClosed) rows.unshift({ key: `open:${today}:${shift}`, date: today, shift: shift || null, closure: null, open: true });
  return rows;
}

/** The pill search over the Days list: date, weekday words, shift, . */
export function dayHaystack(r: DayRow, dayWords: string): unknown[] {
  return [r.date, dayWords, r.shift, r.open ? 'open today' : 'closed', r.closure ? closureWord(r.closure.variance) : '', r.closure?.closedByName];
}

/** The shifts the closures know, sorted — for the shift pick. */
export function shiftsOf(closures: readonly Closure[]): string[] {
  return [...new Set(closures.map((c) => (c.shift ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** "9:12 PM" in the lab's clock (IST). */
export function timeOf(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? timeFmt.format(t).replace(/\s/g, ' ') : '';
}

/** yyyy-MM-dd (an IST business day) → "18 Nov". */
export function dayShort(ymd: string): string {
  const t = Date.parse(ymd + 'T12:00:00Z');
  return Number.isFinite(t) ? dayFmt.format(t) : ymd;
}

/** The word under a closed day: "Closed by Kavya, 9:12 PM" (the server's name; else the name only when it is the
 *  signed-in person's). */
export function closedWords(c: Pick<Closure, 'closedBy' | 'closedAt' | 'closedByName'>, me: { id?: string; name?: string } | null): string {
  const at = timeOf(c.closedAt);
  const name = c.closedByName?.trim() || (me?.id && c.closedBy && c.closedBy === me.id ? me.name : '');
  const by = name ? ` by ${name}` : '';
  return `Closed${by}${at ? (by ? ', ' : ' ') + at : ''}`;
}
