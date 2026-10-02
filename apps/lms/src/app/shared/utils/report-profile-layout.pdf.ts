import type { jsPDF } from 'jspdf';
import { MM } from './report-header-layout';
import type { BodyArea } from './report-profile-layout';
import type { PageLayoutBox } from '../models/report-layout.model';

/**
 * Profile ONE-PAGE layout → jsPDF. Draws the BOX ARRANGEMENT the designer
 * produced inside the body area of a page report-pdf.ts has already started
 * fresh (letterhead + patient block already drawn by the caller — this file
 * never touches the header/footer; see report-pdf.ts's `renderOnePageProfile`
 * hook). Two box kinds are drawn here: `analyzer` and `notes`; the `table`
 * and `signatures` boxes are the report's OWN renderColumnarTable /
 * drawInlineSignatures aimed at the box (theme-exact, one renderer each). `chart` boxes are drawn by the CALLER (report-pdf.ts already owns
 * every report-chart drawing helper — renderReportChart — so a chart box is
 * just that same call aimed at the box's rect; duplicating the chart stack
 * here would be a second chart renderer, which the owner's brief explicitly
 * does not want).
 *
 * Geometry: every box's x/y/w/h is millimetres from the BODY area's top-left
 * (report-profile-layout.ts's `BodyArea`) — converted to absolute page
 * points here, once, via MM/body.top/body.left. No second position model.
 */

function mmRect(b: Pick<PageLayoutBox, 'x' | 'y' | 'w' | 'h'>, body: BodyArea) {
  return { x: body.left + b.x * MM, y: body.top + b.y * MM, w: b.w * MM, h: b.h * MM };
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
  // The caption sits INSIDE the box's top edge — the box is exactly what
  // the lab drew, never a label spilling above it onto a neighbour.
  const labelH = box.label ? 10 : 0;
  if (box.label) {
    doc.setFont(labelFont, 'bold'); doc.setFontSize(7.5); doc.setTextColor(labelColor);
    const caption = (doc.splitTextToSize(box.label, r.w) as string[])[0] ?? box.label;
    doc.text(caption, r.x, r.y + 7);
  }
  if (!dataUrl) return;
  try {
    const dims = (doc as unknown as { getImageProperties: (u: string) => { width: number; height: number } }).getImageProperties(dataUrl);
    const availW = r.w, availH = r.h - labelH;
    const scale = Math.min(availW / dims.width, availH / dims.height);
    const w = dims.width * scale, h = dims.height * scale;
    const x = r.x + (availW - w) / 2, y = r.y + labelH + (availH - h) / 2;
    doc.addImage(dataUrl, 'PNG', x, y, w, h, undefined, 'FAST');
  } catch { /* a corrupt/unreadable cached image never blocks the page */ }
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
