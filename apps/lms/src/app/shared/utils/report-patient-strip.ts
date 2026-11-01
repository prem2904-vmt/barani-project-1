import type { jsPDF } from 'jspdf';
import type { TypeEl } from './report-theme';
import { fitText } from './report-fit';

/**
 * Patient strip — measure, then draw (report layout plan §3.5, phase 1).
 *
 * Every text cell of the strip (a "Label : value" pair, the patient name, a
 * grid value) is measured BEFORE it is drawn: it comes back as lines + a size
 * + a height, and the caller moves the next cell, the separators and the block
 * bottom down by exactly that height. A long patient name or doctor therefore
 * wraps (then shrinks to the lab's floor, then grows the block) instead of
 * running into the next column.
 *
 * This module is the cell primitives; report-pdf.ts owns the layouts and the
 * theme. The primitives take a `StripEnv` so there is no import cycle and the
 * module stays testable.
 *
 * Used ONLY when the template's `reportStyle.fit.enabled` is on. A cell that
 * fits on one line is drawn with exactly the calls the classic path makes, so
 * turning fitting on changes nothing for text that already fit.
 */

export interface StripEnv {
  doc: jsPDF;
  /** Never shrink below this (pt) — `reportStyle.fit.minPt`. */
  minPt: number;
  /** Wrap up to this many lines before shrinking — `reportStyle.fit.maxLines`. */
  maxLines: number;
  /** Theme prints the label regular and the value in the value's style. */
  splitLabels: boolean;
  /** Set the face + size an element prints in; returns the size. */
  font(el: TypeEl): number;
}

/** Hanging indent for wrapped lines: under the value when the label is short,
 *  flush left when the label would eat the column. */
const HANG_MAX_SHARE = 0.4;

/** One plain text cell (the patient name, a grid value). Returns the new y:
 *  `y + (extra lines) × lineH + step`. */
export function stripText(
  env: StripEnv, el: TypeEl, text: string, x: number, y: number, colW: number, step: number,
): number {
  const { doc } = env;
  const start = env.font(el);
  const fit = fitText(doc, text, { maxW: colW, maxLines: env.maxLines, startPt: start, minPt: env.minPt, policy: 'clinical' });
  env.font(el);
  if (fit.lines.length === 1 && fit.pt === start) { doc.text(text, x, y); return y + step; }
  doc.setFontSize(fit.pt);
  fit.lines.forEach((l, i) => doc.text(l, x, y + i * fit.lineH));
  return y + (fit.lines.length - 1) * fit.lineH + step;
}

/** A "Label : value" pair. Returns the new y. */
export function stripPair(
  env: StripEnv, label: string, value: string, x: number, y: number, colW: number,
  labelEl: TypeEl, valueEl: TypeEl, step: number,
  opts: {
    /** Draw label and value as two texts even in a theme that prints the pair
     *  as one string (the items that always did: Ref. By, custom fields…). */
    force?: boolean;
    /** Ink for the label / the value (set before each is drawn). */
    labelColor?: string; valueColor?: string;
  } = {},
): number {
  const { doc } = env;
  const split = env.splitLabels || !!opts.force;
  const ink = (c?: string) => { if (c) doc.setTextColor(c); };
  const lblSize = env.font(labelEl);
  const lw = doc.getTextWidth(label);
  // Classic prints the whole pair in the LABEL's face; a split theme prints the
  // value in the value's own.
  const valEl = split ? valueEl : labelEl;
  const valStart = env.font(valEl);
  const fit = fitText(doc, value, {
    maxW: Math.max(20, colW - (lw <= colW * HANG_MAX_SHARE ? lw : 0)),
    firstLineW: Math.max(20, colW - lw), maxLines: env.maxLines, startPt: valStart, minPt: env.minPt, policy: 'clinical',
  });
  if (fit.lines.length === 1 && fit.pt === valStart) {
    // Fits as it always did → the very same draw calls.
    env.font(labelEl);
    ink(opts.labelColor);
    if (!split) { doc.text(`${label}${value}`, x, y); return y + step; }
    doc.text(label, x, y);
    env.font(valueEl);
    ink(opts.valueColor);
    doc.text(value, x + lw, y);
    return y + step;
  }
  env.font(labelEl);
  doc.setFontSize(lblSize);
  ink(opts.labelColor);
  doc.text(label, x, y);
  env.font(valEl);
  doc.setFontSize(fit.pt);
  ink(opts.valueColor);
  const indent = lw <= colW * HANG_MAX_SHARE ? lw : 0;
  fit.lines.forEach((l, i) => doc.text(l, x + (i === 0 ? lw : indent), y + i * fit.lineH));
  return y + (fit.lines.length - 1) * fit.lineH + step;
}

/** Height a text cell will take (no drawing) — for rows that must be sized
 *  before they are drawn (the 4-col grid's two rows). */
export function stripTextHeight(env: StripEnv, el: TypeEl, text: string, colW: number): { lines: number; lineH: number } {
  const start = env.font(el);
  const fit = fitText(env.doc, text, { maxW: colW, maxLines: env.maxLines, startPt: start, minPt: env.minPt, policy: 'clinical' });
  return { lines: fit.lines.length, lineH: fit.lineH };
}
