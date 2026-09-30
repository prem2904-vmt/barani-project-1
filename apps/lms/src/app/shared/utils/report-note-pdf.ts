import type { jsPDF } from 'jspdf';
import { NoteBlock, NoteRun, parseNote } from './report-note-markup';

/**
 * TECHNICIAN REPORT NOTES on the PDF (owner 2026-09-30).
 *
 * Lays a parsed note out as printed lines — real bold / italic / underline,
 * bulleted and numbered lists with a hanging indent — wrapped to a width,
 * then draws it. Font-agnostic: the report passes `face` (its theme's font
 * for a bold / italic run — Classic Helvetica, Modern Source Sans 3) and the
 * token size, so the note follows the report theme like every other text.
 *
 * Two uses in report-pdf.ts: a full-width row INSIDE the results table (a
 * line / profile note — the row is sized from {@link layoutReportNote} and
 * painted in the table's didDrawCell) and a free block that breaks across
 * pages line by line (a department / whole-order note).
 */

export interface NoteStyle { b: boolean; i: boolean }

export interface NoteTypeset {
  /** Font size (pt). */
  size: number;
  /** Baseline-to-baseline distance (pt). */
  lineHeight: number;
  /** Select the font for a run's weight / slant (size is set separately). */
  face: (doc: jsPDF, style: NoteStyle) => void;
}

export interface NoteSeg { text: string; x: number; w: number; b: boolean; i: boolean; u: boolean }

export interface NoteLayoutLine {
  /** Baseline offset from the block's first baseline. */
  dy: number;
  segs: NoteSeg[];
  /** List marker drawn in the hanging indent (first line of an item only). */
  marker?: { kind: 'bullet'; x: number } | { kind: 'number'; text: string; right: number };
}

export interface NoteLayout {
  lines: NoteLayoutLine[];
  /** Height from the block's top to below its last line (pt). */
  height: number;
}

/** Hanging indent of a list item (pt). */
export const NOTE_LIST_INDENT = 14;
/** Extra air between blocks (a paragraph and a list), in lines. */
const BLOCK_GAP = 0.3;

/** A run; `keep` = never split at its spaces (the label). */
type LabelledRun = NoteRun & { keep?: boolean };

/** Split runs into word / space tokens that keep their style. */
function tokens(runs: LabelledRun[]): Array<{ text: string; space: boolean; st: { b: boolean; i: boolean; u: boolean } }> {
  const out: Array<{ text: string; space: boolean; st: { b: boolean; i: boolean; u: boolean } }> = [];
  for (const r of runs) {
    const st = { b: !!r.b, i: !!r.i, u: !!r.u };
    // The label ("Note (SGOT):") is one unbreakable piece.
    if (r.keep) { out.push({ text: r.text, space: false, st }); continue; }
    for (const part of r.text.split(/(\s+)/)) {
      if (!part) continue;
      out.push({ text: /^\s+$/.test(part) ? ' ' : part, space: /^\s+$/.test(part), st });
    }
  }
  return out;
}

/**
 * Lay a note out to `width`. `label` (e.g. "Note:") opens the note in bold;
 * when the note starts with a list it sits on its own line above it.
 */
export function layoutReportNote(
  doc: jsPDF, src: string | NoteBlock[], width: number, t: NoteTypeset, label?: string | null,
): NoteLayout {
  const blocks = typeof src === 'string' ? parseNote(src) : src;
  const lines: NoteLayoutLine[] = [];
  let dy = 0;
  let first = true;
  doc.setFontSize(t.size);
  const measure = (text: string, st: NoteStyle) => { t.face(doc, st); return doc.getTextWidth(text); };

  const flow = (runs: NoteRun[], left: number, marker?: NoteLayoutLine['marker'], lead?: LabelledRun[]) => {
    let cur: NoteSeg[] = [];
    let x = left;
    let lineMarker = marker;
    const push = () => {
      // Trailing spaces never widen a line (underline would run past the word).
      while (cur.length && /^\s*$/.test(cur[cur.length - 1].text)) cur.pop();
      lines.push({ dy, segs: cur, ...(lineMarker ? { marker: lineMarker } : {}) });
      lineMarker = undefined;
      dy += t.lineHeight;
      cur = [];
      x = left;
    };
    const all = [...(lead ? tokens(lead) : []), ...tokens(runs)];
    for (const tok of all) {
      if (tok.space) {
        if (!cur.length) continue;                       // no leading space on a wrapped line
        const w = measure(' ', tok.st);
        cur.push({ text: ' ', x, w, ...tok.st });
        x += w;
        continue;
      }
      let word = tok.text;
      let w = measure(word, tok.st);
      if (x + w > width && cur.some(s => s.text.trim())) push();
      // A word wider than the whole line breaks by characters.
      while (x + w > width && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && x + measure(word.slice(0, n), tok.st) > width) n--;
        const head = word.slice(0, n);
        cur.push({ text: head, x, w: measure(head, tok.st), ...tok.st });
        push();
        word = word.slice(n);
        w = measure(word, tok.st);
      }
      cur.push({ text: word, x, w, ...tok.st });
      x += w;
    }
    push();
  };

  const labelRun: LabelledRun[] | undefined = label ? [{ text: label, b: true, keep: true }, { text: ' ' }] : undefined;
  blocks.forEach((b, bi) => {
    if (bi > 0) dy += t.lineHeight * BLOCK_GAP;
    if (b.kind === 'p') {
      for (const line of b.lines) {
        flow(line, 0, undefined, first ? labelRun : undefined);
        first = false;
      }
      return;
    }
    if (first && labelRun) {
      flow([], 0, undefined, labelRun.slice(0, 1));
      first = false;
    }
    b.items.forEach((item, n) => {
      const marker: NoteLayoutLine['marker'] = b.kind === 'ul'
        ? { kind: 'bullet', x: NOTE_LIST_INDENT * 0.45 }
        : { kind: 'number', text: `${b.start + n}.`, right: NOTE_LIST_INDENT - 3 };
      flow(item, NOTE_LIST_INDENT, marker);
      first = false;
    });
  });
  if (!blocks.length && labelRun) flow([], 0, undefined, labelRun.slice(0, 1));
  // Height: the last line's baseline + its descent.
  const height = lines.length ? dy - t.lineHeight + t.size * 1.2 : 0;
  return { lines, height };
}

/**
 * Draw a laid-out note with its first baseline at (x, y). `color` is the
 * body text colour; underlines are drawn in it too.
 */
export function drawReportNote(doc: jsPDF, layout: NoteLayout, x: number, y: number, t: NoteTypeset, color: string): void {
  doc.setFontSize(t.size);
  doc.setTextColor(color);
  doc.setDrawColor(color);
  doc.setFillColor(color);
  for (const line of layout.lines) drawLine(doc, line, x, y + line.dy, t);
}

/** Draw ONE laid-out line with its baseline at `baseY` (free blocks draw
 *  line by line so they can break across pages). */
export function drawReportNoteLine(doc: jsPDF, line: NoteLayoutLine, x: number, baseY: number, t: NoteTypeset, color: string): void {
  doc.setFontSize(t.size);
  doc.setTextColor(color);
  doc.setDrawColor(color);
  doc.setFillColor(color);
  drawLine(doc, line, x, baseY, t);
}

function drawLine(doc: jsPDF, line: NoteLayoutLine, x: number, baseY: number, t: NoteTypeset): void {
  if (line.marker?.kind === 'bullet') {
    doc.circle(x + line.marker.x, baseY - t.size * 0.3, Math.max(1, t.size * 0.14), 'F');
  } else if (line.marker?.kind === 'number') {
    t.face(doc, { b: false, i: false });
    doc.text(line.marker.text, x + line.marker.right, baseY, { align: 'right' });
  }
  // Underline: ONE stroke per run of consecutive underlined pieces (the
  // spaces between underlined words included).
  let uFrom: number | null = null, uTo = 0;
  const stroke = () => {
    if (uFrom === null) return;
    doc.setLineWidth(Math.max(0.4, t.size * 0.055));
    const uy = baseY + t.size * 0.14;
    doc.line(x + uFrom, uy, x + uTo, uy);
    uFrom = null;
  };
  for (const s of line.segs) {
    if (!s.text) continue;
    if (s.text.trim()) {
      t.face(doc, { b: s.b, i: s.i });
      doc.text(s.text, x + s.x, baseY);
    }
    if (s.u) { if (uFrom === null) uFrom = s.x; uTo = s.x + s.w; }
    else stroke();
  }
  stroke();
}
