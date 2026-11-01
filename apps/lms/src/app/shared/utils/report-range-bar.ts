import type { jsPDF } from 'jspdf';
import { reportNumber, reportRangeBounds, type ReportBounds } from './report-flag';

/**
 * The range-bar column of the results table (report layout plan 3.11): a small
 * number line per numeric row - the normal range as a grey bar, the value as a
 * marker. Turned on by `reportStyle.charts.rangeBar` (the Modern and Compact
 * presets), never by default.
 *
 * Pure geometry first (`rangeBarModel`, in a 0..1 box so it is testable
 * without a PDF), then one painter. Rules:
 *  - Text rows, qualitative results and rows whose range has no number print
 *    nothing - the cell stays blank (`rowRangeBar` returns null).
 *  - The marker never contradicts the printed flag: H / L comes from the row's
 *    own flag (the same one the Result column prints), the position from the
 *    value. A value off the end of the line pins to the end.
 *  - Never colour-only: an abnormal value is a DIAMOND with a bold H / L beside
 *    it; a normal one is a filled circle. It reads the same in black and white.
 */

export type RangeBarState = 'normal' | 'high' | 'low';

export interface RangeBarModel {
  /** Band ends, 0..1 along the line. An open end runs to the edge of the line. */
  band0: number; band1: number;
  openLow: boolean; openHigh: boolean;
  /** The value, 0..1. */
  marker: number;
  /** The value was beyond the line and is pinned to its end. */
  pinned: boolean;
  state: RangeBarState;
}

export interface RangeBarRow {
  value: number;
  bounds: ReportBounds;
  state: RangeBarState;
}

/** The normal bounds out of a printed reference cell. A cell that names several
 *  different bands (every band, when sex / age matched none) is ambiguous and
 *  gets no bar rather than the wrong one. */
export function rangeBarBounds(range: string | null | undefined): ReportBounds | null {
  const lines = String(range ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const found: ReportBounds[] = [];
  for (const l of lines) {
    const b = reportRangeBounds(l);
    if (b && (b.low != null || b.high != null)) found.push(b);
  }
  if (found.length === 0) return null;
  const same = found.every(b => (b.low ?? null) === (found[0].low ?? null) && (b.high ?? null) === (found[0].high ?? null));
  return same ? found[0] : null;
}

/** What one results row needs for a bar, or null when it has none. */
export function rowRangeBar(
  r: { result?: string; range?: string; flag?: string; isLow?: boolean },
): RangeBarRow | null {
  const raw = String(r.result ?? '').trim();
  // A result such as "Positive" or "Nil" has no place on a number line.
  if (!/^[<>≤≥≈~=]?\s*-?[\d.]/.test(raw)) return null;
  const value = reportNumber(raw);
  if (value == null) return null;
  const bounds = rangeBarBounds(r.range);
  if (!bounds) return null;
  const f = String(r.flag ?? '').trim().toUpperCase();
  const state: RangeBarState = f === 'H' ? 'high' : f === 'L' ? 'low' : 'normal';
  return { value, bounds, state };
}

/** Where the band and the marker sit on a 0..1 line. */
export function rangeBarModel(row: RangeBarRow): RangeBarModel | null {
  const lo = row.bounds.low ?? null, hi = row.bounds.high ?? null;
  if (lo == null && hi == null) return null;
  let d0: number, d1: number;
  if (lo != null && hi != null) {
    if (hi <= lo) return null;
    const pad = (hi - lo) * 0.75;
    d0 = lo - pad; d1 = hi + pad;
    if (lo >= 0 && d0 < 0) d0 = 0;
  } else if (hi != null) {                   // "<= 41": the line starts at zero
    d0 = hi > 0 ? 0 : hi * 2;
    d1 = hi > 0 ? hi * 1.8 : hi * 0.2 + 1;
    if (d1 <= hi) d1 = hi + Math.max(1, Math.abs(hi) * 0.8);
  } else {                                   // "> 40"
    const l = lo as number;
    d0 = l > 0 ? 0 : l * 2;
    d1 = l > 0 ? l * 2 : l * 0.2 + 1;
    if (d1 <= l) d1 = l + Math.max(1, Math.abs(l));
  }
  const span = d1 - d0;
  const at = (v: number) => Math.min(1, Math.max(0, (v - d0) / span));
  const rawPos = (row.value - d0) / span;
  return {
    band0: lo != null ? at(lo) : 0,
    band1: hi != null ? at(hi) : 1,
    openLow: lo == null, openHigh: hi == null,
    marker: Math.min(1, Math.max(0, rawPos)),
    pinned: rawPos < 0 || rawPos > 1,
    state: row.state,
  };
}

export interface RangeBarPaint {
  accent: string;
  ink: string;
  /** Abnormal colours when the template colours flags, else null (ink). */
  highColor: string | null;
  lowColor: string | null;
  /** Report face for the H / L letter. */
  font: [string, string];
}

/** Paint the bar inside a table cell. Standard jsPDF vector ops only. */
export function drawRangeBar(
  doc: jsPDF, cell: { x: number; y: number; width: number; height: number }, row: RangeBarRow, p: RangeBarPaint,
): void {
  const m = rangeBarModel(row);
  if (!m) return;
  // 12 pt each side: room for the marker's half width + its letter, so H always sits right of the
  // marker and L left of it - away from the band, never on top of it.
  const pad = 12;
  const x0 = cell.x + pad;
  const w = Math.max(10, cell.width - 2 * pad);
  const cy = cell.y + cell.height / 2;
  // The track: a thin neutral line; the normal range: a thicker grey bar over it.
  doc.setLineCap('round' as never);
  doc.setDrawColor('#d1d5db'); doc.setLineWidth(1);
  doc.line(x0, cy, x0 + w, cy);
  doc.setDrawColor('#94a3b8'); doc.setLineWidth(4.2);
  doc.line(x0 + m.band0 * w, cy, x0 + m.band1 * w, cy);
  doc.setLineCap('butt' as never);
  // Closed ends of the band get a short tick, so it reads as a range in black and white.
  doc.setDrawColor('#475569'); doc.setLineWidth(0.7);
  if (!m.openLow) doc.line(x0 + m.band0 * w, cy - 3.6, x0 + m.band0 * w, cy + 3.6);
  if (!m.openHigh) doc.line(x0 + m.band1 * w, cy - 3.6, x0 + m.band1 * w, cy + 3.6);

  const mx = x0 + m.marker * w;
  if (m.state === 'normal') {
    doc.setFillColor(p.accent); doc.setDrawColor('#ffffff'); doc.setLineWidth(0.8);
    doc.circle(mx, cy, 2.9, 'FD');
    return;
  }
  const col = (m.state === 'high' ? p.highColor : p.lowColor) ?? p.ink;
  const r = 4;
  doc.setFillColor(col); doc.setDrawColor('#ffffff'); doc.setLineWidth(0.8);
  doc.lines([[r, r], [-r, r], [-r, -r], [r, -r]], mx, cy - r, [1, 1], 'FD', true);
  const letter = m.state === 'high' ? 'H' : 'L';
  // A paper-white pad under the letter, so the thin track never strikes through it.
  const lx = m.state === 'high' ? mx + r + 1 : mx - r - 1 - 5.2;
  doc.setFillColor('#ffffff');
  doc.rect(lx, cy - 3.6, 5.2, 7.2, 'F');
  doc.setTextColor(col);
  doc.setFont(p.font[0], p.font[1]);
  doc.setFontSize(7);
  if (m.state === 'high') doc.text(letter, mx + r + 1.5, cy + 2.4);
  else doc.text(letter, mx - r - 1.5, cy + 2.4, { align: 'right' });
}
