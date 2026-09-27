import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * CONSOLIDATED SHEET — "Summary of abnormal results" (owner, 2026-09-27).
 *
 * One page (or more, when a long report has many) printed as the FIRST page
 * of the report, before the department pages: every HIGH / LOW value from
 * the whole report, grouped by department → test / panel, in report order.
 * Per-lab switch: Admin → Lab settings (also in the report designer), stored
 * as the report template's metadata option `abnormalSummary` — the template
 * is server-served to every viewer, so the report reads the same for all.
 *
 * What counts (the rules the specs pin):
 *  - a value the REPORT prints as H or L. Criticals are stored CL / CH (legacy
 *    C) and reach the report as L / H (reportFlag) — so they are in, marked
 *    exactly as the report marks them (bold + H / L / arrow). Never "C";
 *  - a legacy direction-less critical the report prints bold with no letter
 *    (abnormal, no letter) — still abnormal, so it is listed too;
 *  - NOT a qualitative 'A' option (not a high / low) and not a normal 'N';
 *  - only VALIDATED results (a row from a test not yet validated is skipped);
 *  - only what the report PRINTS: hidden rows are already gone from the
 *    groups this reads, and the groups are the ones the report renders.
 *
 * Kept out of report-pdf.ts on purpose: the collector is pure, and the
 * renderer takes the page theme + drawing hooks from the caller.
 */

/** The fields of one printed report row the sheet reads (report-pdf PanelRowData). */
export interface SummarySourceRow {
  kind: 'param' | 'note';
  name?: string;
  result?: string;
  range?: string;
  unit?: string;
  /** Report letter: 'H' | 'L' | 'A' | '' (never 'C'). */
  flag?: string;
  isLow?: boolean;
  abnormal?: boolean;
  /** The row's test is not validated yet — never on the sheet. */
  unvalidated?: boolean;
  /** Note rows (kind 'note') — never on the sheet. */
  note?: string;
}

/** One printed panel / test (report-pdf PanelGroup). */
export interface SummarySourceGroup {
  testName: string;
  department?: string;
  rows: SummarySourceRow[];
}

export interface AbnormalSummaryRow {
  name: string;
  result: string;
  unit: string;
  range: string;
  /** 'H' | 'L' | '' (a direction-less critical prints no letter). */
  flag: 'H' | 'L' | '';
  isLow: boolean;
}

export interface AbnormalSummaryTest {
  testName: string;
  /** A single-analyte test prints as ONE row (no panel band) — as on the report. */
  compact: boolean;
  rows: AbnormalSummaryRow[];
}

export interface AbnormalSummaryDept {
  department: string;
  tests: AbnormalSummaryTest[];
}

/** Test statuses that mean the result is signed off. */
const VALIDATED_STATUSES = new Set(['validated', 'completed', 'delivered', 'released', 'reported', 'approved', 'final']);

/**
 * Is a snapshot test's result validated? `validatedAt` or a signed-off
 * status. A snapshot test with NEITHER a status nor a timestamp (the admin
 * live preview's sample data) counts as validated — every stored report
 * carries its tests' status.
 */
export function summaryTestValidated(t: { status?: string | null; validatedAt?: string | null }): boolean {
  if (t.validatedAt) return true;
  const s = String(t.status ?? '').trim().toLowerCase();
  return !s || VALIDATED_STATUSES.has(s);
}

/** Does this printed row belong on the sheet? */
export function isSummaryRow(r: SummarySourceRow): boolean {
  if (r.kind !== 'param' || r.unvalidated) return false;
  if (!String(r.result ?? '').trim() || String(r.result).trim() === '—') return false;
  const f = String(r.flag ?? '').trim().toUpperCase();
  if (f === 'H' || f === 'L') return true;
  // A critical whose direction can't be read prints bold with no letter.
  return f === '' && r.abnormal === true;
}

/** Leading number test (qualitative results never grow a unit). */
function looksNumeric(result: string | null | undefined): boolean {
  return /^[<>≤≥≈~=]*\s*-?\d/.test(String(result ?? '').trim());
}

/**
 * Every abnormal value of the printed report, grouped by department (first
 * seen) → test / panel (report order) → rows (report order). Empty when the
 * report has none — the caller then prints no sheet.
 */
export function collectAbnormalResults(groups: SummarySourceGroup[]): AbnormalSummaryDept[] {
  const out: AbnormalSummaryDept[] = [];
  const byDept = new Map<string, AbnormalSummaryDept>();
  for (const g of groups) {
    const params = g.rows.filter(r => r.kind === 'param');
    const rows = params.filter(isSummaryRow).map<AbnormalSummaryRow>(r => {
      const f = String(r.flag ?? '').trim().toUpperCase();
      const result = String(r.result ?? '').trim();
      return {
        name: String(r.name ?? '').trim() || g.testName,
        result,
        unit: looksNumeric(result) ? String(r.unit ?? '').trim() : '',
        range: String(r.range ?? '').trim(),
        flag: f === 'H' || f === 'L' ? f : '',
        isLow: f === 'L' || (f === '' && !!r.isLow),
      };
    });
    if (!rows.length) continue;
    const dept = (g.department ?? '').trim();
    let d = byDept.get(dept);
    if (!d) { d = { department: dept, tests: [] }; byDept.set(dept, d); out.push(d); }
    d.tests.push({ testName: g.testName, compact: params.length === 1, rows });
  }
  return out;
}

/** Total abnormal values on the sheet. */
export function summaryCount(depts: AbnormalSummaryDept[]): number {
  return depts.reduce((n, d) => n + d.tests.reduce((m, t) => m + t.rows.length, 0), 0);
}

// ──────────────────────────────────────────────────────────────
// Renderer
// ──────────────────────────────────────────────────────────────

/** Page theme + geometry + table hooks, handed over by report-pdf. */
export interface SummaryRenderContext {
  font: 'helvetica' | 'times' | 'courier';
  fontScale: number;
  primary: string;
  black: string;
  text: string;
  dim: string;
  hair: string;
  flagStyle: 'bold' | 'bold_color';
  flagIndicator: 'letter' | 'arrow' | 'none';
  abnormalColor: string;
  abnormalLowColor: string;
  pageW: number;
  marginX: number;
  /** Table floor (bottom margin) and the top of a continuation page. */
  marginBottom: number;
  continueTop: number;
  bodyStyles: Record<string, unknown>;
  headStyles: Record<string, unknown>;
  zebra: boolean;
  /** Superscript units / multi-band range cells — the report's own hooks. */
  willDrawCell?: (d: unknown, rangeColIdx: number) => void;
  didDrawCell?: (d: unknown) => void;
}

export const SUMMARY_TITLE = 'SUMMARY OF ABNORMAL RESULTS';
export const SUMMARY_INTRO = 'Results outside the reference range, gathered from the full report that follows.';

type Cell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
type Meta = { arrow: 'up' | 'down'; color: string; text: string; bold: boolean } | null;

/**
 * Draw the sheet from `startY` (below the patient block). Grows onto further
 * pages by itself when it is long; the caller starts the department pages on
 * a fresh page after it. Returns the y below the table.
 */
export function renderAbnormalSummary(doc: jsPDF, depts: AbnormalSummaryDept[], startY: number, ctx: SummaryRenderContext): number {
  const x0 = ctx.marginX, x1 = ctx.pageW - ctx.marginX;
  const count = summaryCount(depts);
  let y = startY;

  // Heading band — the department-band look of the report body.
  doc.setFont(ctx.font, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(ctx.primary);
  doc.text(SUMMARY_TITLE, x0, y + 12);
  doc.setFont(ctx.font, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(ctx.dim);
  doc.text(`${count} ${count === 1 ? 'result' : 'results'} outside the reference range`, x1, y + 12, { align: 'right' });
  doc.setDrawColor(ctx.primary);
  doc.setLineWidth(1);
  doc.line(x0, y + 17, x1, y + 17);
  doc.setFont(ctx.font, 'italic');
  doc.setFontSize(8);
  doc.setTextColor(ctx.dim);
  doc.text(SUMMARY_INTRO, x0, y + 29);
  y += 36;

  const head: Cell[][] = [[
    { content: 'Investigation' }, { content: 'Result' }, { content: 'Reference range' },
  ]];
  const body: Cell[][] = [];
  const meta: Meta[] = [];
  const useArrow = ctx.flagIndicator === 'arrow';
  for (const d of depts) {
    // Every department with a value gets its band — the reader scans by department.
    if (d.department) {
      body.push([{ content: d.department.toUpperCase(), colSpan: 3,
        styles: { fontStyle: 'bold', fontSize: 9.5 * ctx.fontScale, textColor: ctx.primary, fillColor: '#ffffff',
                  cellPadding: { top: 8, right: 6, bottom: 3, left: 6 } } }]);
      meta.push(null);
    }
    for (const t of d.tests) {
      if (!t.compact) {
        body.push([{ content: t.testName.toUpperCase(), colSpan: 3,
          styles: { fillColor: '#eef2f7', textColor: ctx.primary, fontStyle: 'bold', fontSize: 9 * ctx.fontScale } }]);
        meta.push(null);
      }
      for (const r of t.rows) {
        // Exactly the report's marking: bold (+ the high / low colour when the
        // lab prints colour) unless the lab turned the indicator off.
        const marked = ctx.flagIndicator !== 'none';
        const colour = marked && ctx.flagStyle === 'bold_color' ? (r.isLow ? ctx.abnormalLowColor : ctx.abnormalColor) : ctx.black;
        let value = [r.result, r.unit].filter(Boolean).join(' ');
        const glyph = r.flag && ctx.flagIndicator === 'letter' ? r.flag : '';
        if (glyph) value = `${value}  ${glyph}`;
        body.push([
          { content: t.compact ? (r.name || t.testName) : r.name, styles: { fontStyle: 'bold', textColor: ctx.black } },
          { content: value, styles: { fontStyle: marked ? 'bold' : 'normal', textColor: colour } },
          { content: r.range, styles: { textColor: ctx.dim } },
        ]);
        meta.push(useArrow && r.flag ? { arrow: r.isLow ? 'down' : 'up', color: colour, text: value, bold: marked } : null);
      }
    }
  }

  const usable = x1 - x0;
  const widths = [0.44, 0.24, 0.32].map(w => w * usable);
  autoTable(doc, {
    startY: y,
    head: head as never,
    body: body as never,
    margin: { left: x0, right: ctx.marginX, bottom: ctx.marginBottom, top: ctx.continueTop },
    theme: 'plain',
    styles: ctx.bodyStyles,
    headStyles: ctx.headStyles,
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: ctx.zebra ? { fillColor: '#f8fafc' } : undefined,
    columnStyles: { 0: { cellWidth: widths[0] }, 1: { cellWidth: widths[1] }, 2: { cellWidth: widths[2] } },
    didDrawPage: (p: { pageNumber: number }) => {
      // A long sheet: say so on the continuation page's top line.
      if (p.pageNumber > 1) {
        doc.setFont(ctx.font, 'bold');
        doc.setFontSize(9);
        doc.setTextColor(ctx.primary);
        doc.text(`${SUMMARY_TITLE} — CONTINUED`, x0, ctx.continueTop - 14);
        doc.setDrawColor(ctx.hair);
        doc.setLineWidth(0.5);
        doc.line(x0, ctx.continueTop - 10, x1, ctx.continueTop - 10);
      }
    },
    willDrawCell: (d: unknown) => ctx.willDrawCell?.(d, 2),
    didDrawCell: (d: { section: string; column: { index: number }; row: { index: number }; cell: { x: number; y: number; width: number } }) => {
      ctx.didDrawCell?.(d);
      if (d.section !== 'body' || d.column.index !== 1) return;
      const m = meta[d.row.index];
      if (!m) return;
      // The report's arrow: a small filled triangle right after the value
      // (standard PDF fonts have no ↑ / ↓ glyphs).
      const fs = 9 * ctx.fontScale, s = 3.2;
      doc.setFont(ctx.font, m.bold ? 'bold' : 'normal');
      doc.setFontSize(fs);
      const cx = Math.min(d.cell.x + 6 + doc.getTextWidth(m.text) + 8, d.cell.x + d.cell.width - 9);
      const cy = d.cell.y + 4 + fs * 0.42;
      doc.setFillColor(m.color);
      if (m.arrow === 'up') doc.triangle(cx - s, cy + s, cx + s, cy + s, cx, cy - s, 'F');
      else doc.triangle(cx - s, cy - s, cx + s, cy - s, cx, cy + s, 'F');
    },
  } as never);
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
}
