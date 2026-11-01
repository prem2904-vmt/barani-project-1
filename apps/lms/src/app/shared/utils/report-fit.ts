/**
 * Text fitting for the report renderer — pure, DI-free, measure-then-draw.
 *
 * `fitText` answers one question: "this text must live in `maxW` points —
 * what lines, at what size, and how tall is that?" The caller draws exactly
 * what comes back and lays out the NEXT thing from the returned height, so
 * nothing is ever drawn at a guessed y and nothing overlaps.
 *
 *  1. Fits on one line at `startPt` → done (the common case; the caller
 *     then draws exactly as it always did).
 *  2. Wrap at soft break points (space, `/`, `-`, `(`, `,`, `·`) up to
 *     `maxLines` lines. A single word wider than the box is broken by
 *     characters, so no line is ever wider than `maxW`.
 *  3. Still too many lines → shrink: binary-search the largest size in
 *     [minPt, startPt] that fits `maxLines`, and tighten the line height a
 *     little (the less the text shrinks, the less it tightens).
 *  4. Still too long at `minPt`:
 *       policy 'clinical' → keep the floor size and let the block GROW
 *         (more lines). A clinical value is never cut.
 *       policy 'label'    → ellipsis on the last line (decorative text only).
 *
 * Credit: the shrink-on-overflow scheme (largest scale in [floor, 1.0] by
 * 12-step binary search, line height tightened by min((1-scale)*0.8, 0.2))
 * follows the idea in storytold's deckcraft text crate and the truncate
 * policy follows figcraft's text auto-resize modes (both MIT OR Apache-2.0).
 * Re-implemented here from the idea; no code copied.
 */

/** The slice of jsPDF the engine needs. The caller sets the FONT; the engine
 *  only changes the size while measuring. */
export interface FitDoc {
  getTextWidth(text: string): number;
  setFontSize(size: number): unknown;
}

export type FitPolicy = 'clinical' | 'label';

export interface FitOptions {
  maxW: number;
  /** Wrap up to this many lines before shrinking (≥ 1). */
  maxLines: number;
  startPt: number;
  minPt: number;
  policy: FitPolicy;
  /** Width available to LINE 1 only (a label already sits in front of the
   *  value); continuation lines get `maxW`. Default `maxW`. */
  firstLineW?: number;
  /** Line-height factor at full size (jsPDF default 1.15). */
  lineFactor?: number;
}

export interface FitResult {
  lines: string[];
  /** Font size the lines were measured (and must be drawn) at. */
  pt: number;
  /** Distance between baselines. */
  lineH: number;
  /** Total height: lines × lineH. */
  h: number;
  shrunk: boolean;
  /** Ellipsis was needed (policy 'label' only). */
  truncated: boolean;
  /** More lines than `maxLines` at the floor size (policy 'clinical'). */
  grew: boolean;
}

const BREAK_AFTER = new Set([' ', '/', '-', ',', '·', ';']);

/** Split into unbreakable chunks: break AFTER space / / - , · ; and BEFORE '('. */
export function softTokens(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' && cur.trim()) { out.push(cur); cur = ''; }
    cur += ch;
    // A break char keeps the space that follows it ('Quantitative, ' is one chunk).
    if (BREAK_AFTER.has(ch) && text[i + 1] !== ' ') { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

function wrapAt(doc: FitDoc, text: string, pt: number, firstW: number, restW: number): string[] {
  doc.setFontSize(pt);
  const w = (t: string) => doc.getTextWidth(t);
  const lines: string[] = [];
  let line = '';
  const limit = () => (lines.length === 0 ? firstW : restW);
  const flush = () => { lines.push(line.replace(/\s+$/, '')); line = ''; };
  for (const tok of softTokens(text)) {
    if (w((line + tok).replace(/\s+$/, '')) <= limit() || !line.trim() && w(tok.replace(/\s+$/, '')) <= limit()) {
      line += tok; continue;
    }
    if (line.trim()) flush();
    // A chunk wider than a whole line: break it by characters.
    let rest = tok;
    while (w(rest.replace(/\s+$/, '')) > limit() && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && w(rest.slice(0, n)) > limit()) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line.trim() || lines.length === 0) flush();
  return lines;
}

function ellipsize(doc: FitDoc, line: string, pt: number, maxW: number): string {
  doc.setFontSize(pt);
  const dots = '…';
  let s = line.replace(/\s+$/, '');
  while (s.length > 1 && doc.getTextWidth(s + dots) > maxW) s = s.slice(0, -1).replace(/\s+$/, '');
  return s + dots;
}

export function fitText(doc: FitDoc, text: string, o: FitOptions): FitResult {
  const factor = o.lineFactor ?? 1.15;
  const firstW = Math.max(1, o.firstLineW ?? o.maxW);
  const restW = Math.max(1, o.maxW);
  const maxLines = Math.max(1, Math.floor(o.maxLines));
  const startPt = o.startPt;
  const minPt = Math.min(o.minPt, startPt);
  const done = (lines: string[], pt: number, extra: Partial<FitResult> = {}): FitResult => {
    const tighten = Math.min((1 - pt / startPt) * 0.8, 0.2);
    const lineH = pt * factor * (1 - tighten);
    doc.setFontSize(pt);
    return { lines, pt, lineH, h: lines.length * lineH, shrunk: pt < startPt, truncated: false, grew: false, ...extra };
  };
  const raw = text ?? '';
  doc.setFontSize(startPt);
  if (!raw.includes('\n') && doc.getTextWidth(raw) <= firstW) return done([raw], startPt);

  const atStart = wrapAt(doc, raw, startPt, firstW, restW);
  if (atStart.length <= maxLines) return done(atStart, startPt);

  // Largest size in [minPt, startPt] that fits maxLines (12-step binary search).
  if (minPt < startPt) {
    const floorLines = wrapAt(doc, raw, minPt, firstW, restW);
    if (floorLines.length <= maxLines) {
      let lo = minPt, hi = startPt, best = floorLines, bestPt = minPt;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const l = wrapAt(doc, raw, mid, firstW, restW);
        if (l.length <= maxLines) { best = l; bestPt = mid; lo = mid; } else hi = mid;
      }
      return done(best, bestPt);
    }
  }
  const atFloor = wrapAt(doc, raw, minPt, firstW, restW);
  if (o.policy === 'label' && atFloor.length > maxLines) {
    const kept = atFloor.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(doc, kept[maxLines - 1] + ' ' + atFloor.slice(maxLines).join(' '), minPt,
      maxLines === 1 ? firstW : restW);
    return done(kept, minPt, { truncated: true });
  }
  return done(atFloor, minPt, { grew: atFloor.length > maxLines });
}
