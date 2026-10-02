import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportColumn } from '../models/report-layout.model';
import type { ReportSignature } from '../models/report.model';
import { layoutSignatureBlock, SIG_IMG_H, SIG_IMG_W, SIG_ROW } from './report-signatures';
import { MM, PAGE } from './report-header-layout';
import { MIN_BODY_FONT_PT, fitMeter, type BodyArea } from './report-profile-layout';
import type { PageLayoutBox } from '../models/report-layout.model';

/**
 * Profile ONE-PAGE layout → jsPDF. Draws the BOX ARRANGEMENT the designer
 * produced inside the body area of a page report-pdf.ts has already started
 * fresh (letterhead + patient block already drawn by the caller — this file
 * never touches the header/footer; see report-pdf.ts's `renderOnePageProfile`
 * hook). Four box kinds are drawn here: `table`, `analyzer`, `signatures`,
 * `notes`. `chart` boxes are drawn by the CALLER (report-pdf.ts already owns
 * every report-chart drawing helper — renderReportChart — so a chart box is
 * just that same call aimed at the box's rect; duplicating the chart stack
 * here would be a second chart renderer, which the owner's brief explicitly
 * does not want).
 *
 * Geometry: every box's x/y/w/h is millimetres from the BODY area's top-left
 * (report-profile-layout.ts's `BodyArea`) — converted to absolute page
 * points here, once, via MM/body.top/body.left. No second position model.
 */

export interface ProfileTableRow {
  name?: string;
  cells: Record<string, string>;
  flag?: string | null;
  bold?: boolean;
  color?: string | null;
  isNote?: boolean;
  noteText?: string;
}

export interface ProfileTableTheme {
  font: string;
  headFill: string;
  headText: string;
  bodyText: string;
  dimText: string;
  hair: string;
  abnormalColor: string;
  abnormalLowColor: string;
  zebra: boolean;
  /** The report theme's abnormal-result treatment — same tokens
   *  renderColumnarTable reads (theme.flagStyle / theme.flagIndicator), so
   *  an abnormal value here looks EXACTLY like one in the continuous table
   *  (owner, 2026-10-02): bold-only vs bold+colour, and letter vs arrow vs
   *  no glyph at all. */
  flagStyle: 'bold' | 'bold_color';
  flagIndicator: 'letter' | 'arrow' | 'none';
}

function mmRect(b: Pick<PageLayoutBox, 'x' | 'y' | 'w' | 'h'>, body: BodyArea) {
  return {
    x: body.left + b.x * MM, y: body.top + b.y * MM,
    w: b.w * MM, h: b.h * MM,
  };
}

/** Mirrors renderColumnarTable's own per-row verdict (report-pdf.ts): a 'N'
 *  flag (or none) is never abnormal; H/CH is high, L/CL is low; 'A'
 *  (qualitative abnormal, e.g. a non-Normal dropdown pick) is bold-only,
 *  no colour/glyph — a direction means nothing for a text answer. Exported
 *  so this decision can be unit-tested directly, without a real/mocked
 *  jsPDF + autoTable round trip (report-profile-layout.pdf.spec.ts). */
export function rowVerdict(row: ProfileTableRow, th: ProfileTableTheme): { emphasise: boolean; color: string | null; glyph: string } {
  const flag = row.flag ?? null;
  const isNormal = !flag || flag === 'N';
  const isLow = flag === 'L' || flag === 'CL';
  const abnColor = isLow ? th.abnormalLowColor : th.abnormalColor;
  let emphasise = !!row.bold;
  let color: string | null = null;
  if (!isNormal && flag !== 'A') {
    emphasise = true;
    if (th.flagStyle === 'bold_color') color = abnColor;
  }
  if (flag === 'A') emphasise = true;
  // An explicit admin row colour (condition chip) always wins and always
  // bolds — same as renderColumnarTable's own `adminColor` handling, not
  // gated by the theme's flagStyle (the admin chose this colour on purpose).
  if (row.color) { color = row.color; emphasise = true; }
  const glyph = (flag && flag !== 'A' && !isNormal && th.flagIndicator !== 'none')
    ? (th.flagIndicator === 'arrow' ? (isLow ? '▼' : '▲') : flag)
    : '';
  return { emphasise, color, glyph };
}

/** Draws the table box: only the VISIBLE columns the lab configured, in
 *  their configured order/width (percent of the box's own width — not the
 *  page's). Font shrinks per the fit meter (never below MIN_BODY_FONT_PT);
 *  overflow still paginates via autoTable's own page-break rather than ever
 *  cutting a row — the "flows to a second page" owner decision. */
export function drawProfileTableBox(
  doc: jsPDF, box: PageLayoutBox, body: BodyArea, resolvedColumns: ReportColumn[], rows: ProfileTableRow[], theme: ProfileTableTheme,
): number {
  const r = mmRect(box, body);
  const visible = (box.columns ?? resolvedColumns.map(c => ({ name: c.name, visible: true })))
    .filter(c => c.visible);
  const cols = visible
    .map(c => ({ cfg: c, col: resolvedColumns.find(rc => rc.name === c.name) }))
    .filter((x): x is { cfg: NonNullable<PageLayoutBox['columns']>[number]; col: ReportColumn } => !!x.col);
  if (cols.length === 0) return r.y;

  const totalWeight = cols.reduce((s, c) => s + (c.cfg.width ?? c.col.width ?? 1), 0) || 1;
  const widths = cols.map(c => (r.w * (c.cfg.width ?? c.col.width ?? 1)) / totalWeight);

  const baseFont = box.fontSize ?? 9;
  const m = fitMeter(rows.length, r.h, baseFont);
  const fontPt = Math.max(MIN_BODY_FONT_PT, m.shrinkToPt);

  const head = [cols.map(c => c.col.label)];
  const tableBody = rows.map(row => {
    if (row.isNote) {
      return cols.map((c, i) => (i === 0 ? { content: row.noteText ?? '', colSpan: cols.length, styles: { fontStyle: 'italic', textColor: theme.dimText } } : ''));
    }
    // Same verdict the continuous table computes — and, like it, the
    // bold/colour/glyph treatment lands ONLY on the result cell (the name,
    // unit and range cells print plain), never the whole row.
    const { emphasise, color, glyph } = rowVerdict(row, theme);
    return cols.map(c => {
      const key = c.col.type === 'name' ? 'name' : c.col.name;
      let text = key === 'name' ? (row.name ?? '') : (row.cells[c.col.name] ?? '');
      const isResultCol = c.col.type === 'result';
      const styles: Record<string, unknown> = {};
      if (isResultCol) {
        if (glyph) text = text ? `${text}  ${glyph}` : glyph;
        if (color) styles['textColor'] = color;
        if (emphasise) styles['fontStyle'] = 'bold';
      } else if (key === 'name' && row.bold) {
        styles['fontStyle'] = 'bold';
      }
      return { content: text, styles };
    });
  });

  autoTable(doc, {
    startY: r.y,
    head,
    body: tableBody as unknown as Array<Array<string | Record<string, unknown>>>,
    // `top: 56` matches every other results table in this report (
    // tablePageMargins()) — a small repeat-header offset for a CONTINUATION
    // page, unrelated to this box's own startY. `bottom` is this box's own
    // floor (the body area's bottom edge, i.e. the footer/signature reserve).
    margin: { left: r.x, right: PAGE.w - (r.x + r.w), top: 56, bottom: PAGE.h - (body.top + body.h) },
    tableWidth: r.w,
    theme: 'plain',
    styles: { font: theme.font, fontSize: fontPt, textColor: theme.bodyText, lineColor: theme.hair, lineWidth: 0.4, cellPadding: 2.2 },
    headStyles: { fontSize: fontPt, fontStyle: 'bold', fillColor: theme.headFill, textColor: theme.headText },
    alternateRowStyles: theme.zebra ? { fillColor: '#f8fafc' } : undefined,
    columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])),
    rowPageBreak: 'avoid',
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Analyzer image box: the authenticated attachment's PNG, letterboxed
 *  inside the box (never cropped/stretched), with its label above. `dataUrl`
 *  is already in cache (report-pdf.ts's preloadReportImages / IMG_CACHE —
 *  the SAME authenticated fetch every other result image uses, never a
 *  public/presigned URL). Nothing is drawn when the image isn't cached —
 *  the box is hidden upstream (collapseMissingAnalyzerBoxes), this is only
 *  the last-resort guard against a cache miss. */
export function drawAnalyzerImageBox(
  doc: jsPDF, box: PageLayoutBox, body: BodyArea, dataUrl: string | null | undefined, labelColor: string, labelFont: string,
): void {
  const r = mmRect(box, body);
  if (box.label) {
    doc.setFont(labelFont, 'bold'); doc.setFontSize(8); doc.setTextColor(labelColor);
    doc.text(box.label, r.x, r.y - 2);
  }
  if (!dataUrl) return;
  const labelH = box.label ? 10 : 0;
  try {
    const dims = (doc as unknown as { getImageProperties: (u: string) => { width: number; height: number } }).getImageProperties(dataUrl);
    const availW = r.w, availH = r.h - labelH;
    const scale = Math.min(availW / dims.width, availH / dims.height);
    const w = dims.width * scale, h = dims.height * scale;
    const x = r.x + (availW - w) / 2, y = r.y + labelH + (availH - h) / 2;
    doc.addImage(dataUrl, 'PNG', x, y, w, h, undefined, 'FAST');
  } catch { /* a corrupt/unreadable cached image never blocks the page */ }
}

/** Signatures box: the department's own sign-off, laid out with the SAME
 *  `layoutSignatureBlock` geometry report-pdf.ts uses for every other
 *  department's inline sign-off — no second signature logic, just a
 *  narrower drawing pass scoped to this box. */
export function drawSignaturesBox(
  doc: jsPDF, box: PageLayoutBox, body: BodyArea, sigs: ReportSignature[], imgCache: Record<string, string>, textColor: string, nameFont: string,
): void {
  const r = mmRect(box, body);
  const block = layoutSignatureBlock(sigs, r.x, r.w, r.y);
  for (const row of block.rows) {
    const baseY = row.top + SIG_ROW.base;
    for (const { sig, cx } of row.slots) {
      const src = sig.signatureUrl ? (sig.signatureUrl.startsWith('data:') ? sig.signatureUrl : imgCache[sig.signatureUrl]) : null;
      if (src) { try { doc.addImage(src, 'PNG', cx - SIG_IMG_W / 2, baseY - 20, SIG_IMG_W, SIG_IMG_H, undefined, 'FAST'); } catch { /* scribble fallback below */ } }
      if ((sig.name ?? '').trim()) {
        doc.setFont(nameFont, 'bold'); doc.setFontSize(9.5); doc.setTextColor(textColor);
        doc.text(sig.name!.trim(), cx, baseY + SIG_ROW.name, { align: 'center' });
      }
    }
  }
}

/** Notes box: a plain wrapped paragraph — used for a short profile-level
 *  remark the lab wants inline with the layout (distinct from the report's
 *  Sentence blocks, which stay in the table's own rows). */
export function drawNotesBox(doc: jsPDF, box: PageLayoutBox, body: BodyArea, text: string, color: string, font: string): void {
  const r = mmRect(box, body);
  doc.setFont(font, 'normal'); doc.setFontSize(8.5); doc.setTextColor(color);
  const lines = doc.splitTextToSize(text, r.w) as string[];
  doc.text(lines, r.x, r.y + 8);
}
