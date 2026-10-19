import JsBarcode from 'jsbarcode';

/**
 * Tube-label LAYOUT — one pure source of truth for where things sit on a
 * specimen label, shared by BOTH print paths:
 *   • the DOM label card (browser / Electron print dialog → exact-size @page);
 *   • the 1-bpp bitmap streamed to the thermal printer (label-render.ts).
 *
 * Landscape: the label stock is wide and short (50×25, 38×25, 2×1 in), so the
 * code sits BESIDE the patient text, never under it:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Mr. Kesavan L 29M      ║║ ║ ║║║ ║║ ║║║ ║ ║║  │   text block (left)
 *   │ MRN AA0008             ║║ ║ ║║║ ║║ ║║║ ║ ║║  │   code block (right,
 *   │ BIO                    ║║ ║ ║║║ ║║ ║║║ ║ ║║  │   full inner height)
 *   │ 26220                  ║║ ║ ║║║ ║║ ║║║ ║ ║║  │
 *   └──────────────────────────────────────────────┘
 *
 * All units are millimetres. Nothing here truncates: text that doesn't fit
 * shrinks, then wraps.
 */
export type TubeCodeMode = 'barcode' | 'qr' | 'datamatrix';

/** Common tube-label stock, offered as presets in Printing → Label. */
export const LABEL_SIZE_PRESETS: readonly { label: string; widthMm: number; heightMm: number }[] = [
  { label: '50 × 25 mm', widthMm: 50, heightMm: 25 },
  { label: '50 × 20 mm', widthMm: 50, heightMm: 20 },
  { label: '38 × 25 mm', widthMm: 38, heightMm: 25 },
  { label: '2 × 1 in', widthMm: 50.8, heightMm: 25.4 },
];

/** Code-128 quiet zone each side, in modules (ISO/IEC 15417 asks ≥ 10X). */
export const QUIET_MODULES = 10;
/** Target narrow-bar width: 0.25 mm = 2 dots on a 203-dpi head. */
export const TARGET_X_MM = 0.25;
/** Below this narrow-bar width common tube scanners start to miss reads. */
export const MIN_X_MM = 0.19;

export interface Box { x: number; y: number; w: number; h: number }

export interface TubeLabelGeometry {
  widthMm: number;
  heightMm: number;
  padMm: number;
  gapMm: number;
  /** Left: patient text block. */
  text: Box;
  /** Right: the code's box. For a barcode this INCLUDES both quiet zones. */
  code: Box;
  /** Barcode only: the bars themselves (code box minus quiet zones). */
  bars?: Box;
  /** Barcode only: the narrow-bar (module) width in mm. */
  xMm?: number;
  /** Barcode only: false when the bars are narrower than MIN_X_MM. */
  scannable: boolean;
}

/** Number of Code-128 modules JsBarcode draws for `value` (no quiet zone).
 *  Uses JsBarcode's object renderer — no DOM needed. 0 if un-encodable. */
export function code128Modules(value: string): number {
  try {
    const o: { encodings?: { data: string }[] } = {};
    JsBarcode(o as unknown as HTMLElement, value, { format: 'CODE128' });
    return (o.encodings ?? []).reduce((n, e) => n + e.data.length, 0);
  } catch {
    return 0;
  }
}

/**
 * Where the text and the code go on a W × H mm label.
 *  • 2-D code (QR / Data Matrix): a square on the right, as tall as the inner
 *    label but never wider than 42 % of it, centred vertically.
 *  • 1-D barcode: full inner height on the right; its width is what the bars
 *    need at 0.25 mm/module + 10-module quiet zones, clamped to 50–68 % of the
 *    inner width so the text keeps ≥ ~30 %.
 */
export function tubeLabelGeometry(widthMm: number, heightMm: number, mode: TubeCodeMode, barcodeModules = 101): TubeLabelGeometry {
  const W = Math.max(10, widthMm);
  const H = Math.max(10, heightMm);
  const pad = round2(clamp(H * 0.06, 1.2, 2));
  const gap = 1.2;
  const innerW = W - 2 * pad;
  const innerH = H - 2 * pad;

  if (mode === 'barcode') {
    const modules = Math.max(1, barcodeModules) + 2 * QUIET_MODULES;
    const want = modules * TARGET_X_MM;
    const codeW = round2(clamp(want, innerW * 0.5, innerW * 0.68));
    const xMm = codeW / modules;
    const quiet = QUIET_MODULES * xMm;
    const code: Box = { x: round2(W - pad - codeW), y: pad, w: codeW, h: round2(innerH) };
    return {
      widthMm: W, heightMm: H, padMm: pad, gapMm: gap,
      text: { x: pad, y: pad, w: round2(innerW - codeW - gap), h: round2(innerH) },
      code,
      bars: { x: round2(code.x + quiet), y: code.y, w: round2(codeW - 2 * quiet), h: code.h },
      xMm: round3(xMm),
      scannable: xMm >= MIN_X_MM,
    };
  }

  const side = round2(Math.min(innerH, innerW * 0.42));
  return {
    widthMm: W, heightMm: H, padMm: pad, gapMm: gap,
    text: { x: pad, y: pad, w: round2(innerW - side - gap), h: round2(innerH) },
    code: { x: round2(W - pad - side), y: round2((H - side) / 2), w: side, h: side },
    scannable: true,
  };
}

// ── Text ────────────────────────────────────────────────────────────────

export type LabelLineRole = 'flag' | 'name' | 'meta' | 'dept' | 'id' | 'extra';

export interface LabelLineSpec {
  role: LabelLineRole;
  text: string;
  heavy: boolean;
  mono: boolean;
  /** Preferred (largest) font size, mm (cap height ≈ 0.7 × this). */
  maxMm: number;
  /** Smallest size we shrink to before wrapping instead. */
  minMm: number;
  /** Lines this field may wrap to at its preferred size before shrinking. */
  maxLines: number;
}

export interface FittedLine extends LabelLineSpec {
  fontMm: number;
  /** Estimated wrapped line count at `fontMm` (≥ 1). */
  lines: number;
}

/** Average advance per character as a fraction of the font size. Bold sans
 *  runs ~0.55 em; monospace is exactly 0.6 em. Conservative on purpose — an
 *  over-estimate shrinks text a touch, an under-estimate would overflow. */
const CHAR_EM = { sans: 0.56, mono: 0.61 };
export const LINE_HEIGHT = 1.12;

export function estimateTextWidthMm(text: string, fontMm: number, mono: boolean): number {
  return text.length * fontMm * (mono ? CHAR_EM.mono : CHAR_EM.sans);
}

/**
 * Size each line to the text column: shrink until it fits within its line
 * budget; at the minimum size it WRAPS (more lines) rather than being cut.
 * Then, if the stack is taller than the column, scale everything down
 * together (floor 1.5 mm ≈ 4 pt) so the whole block stays on the label.
 */
export function fitLabelText(specs: LabelLineSpec[], colWmm: number, colHmm: number): FittedLine[] {
  const w = Math.max(1, colWmm);
  const fitted: FittedLine[] = specs.map((s) => {
    const linesAt = (f: number) => Math.max(1, Math.ceil(estimateTextWidthMm(s.text, f, s.mono) / w - 1e-9));
    // The longest word must fit the column on its own, so a line breaks
    // between words (a mid-word break only happens at the minimum size).
    const longest = s.text.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
    // (If it can't fit even at the minimum, don't shrink for it — it wraps.)
    const canFitWord = estimateTextWidthMm(longest, s.minMm, s.mono) <= w;
    const wordFits = (f: number) => !canFitWord || estimateTextWidthMm(longest, f, s.mono) <= w;
    const shrinkTo = (budget: number, floor: number) => {
      let f = s.maxMm;
      while (f > floor && (linesAt(f) > budget || !wordFits(f))) f = round2(f - 0.05);
      return Math.max(f, floor);
    };
    // A multi-line field (the name) first tries ONE line down to ~80 % of
    // its size — "Mr. Kesavan L  29M" reads better unbroken — then wraps.
    let fs = s.maxLines > 1 ? shrinkTo(1, Math.max(s.minMm, round2(s.maxMm * 0.8))) : NaN;
    if (!(fs >= s.minMm && linesAt(fs) === 1 && wordFits(fs))) fs = shrinkTo(s.maxLines, s.minMm);
    return { ...s, fontMm: fs, lines: linesAt(fs) };
  });
  const height = (ls: FittedLine[]) => ls.reduce((h, l) => h + l.fontMm * LINE_HEIGHT * l.lines, 0);
  const total = height(fitted);
  if (total > colHmm) {
    const k = colHmm / total;
    return fitted.map((l) => {
      const fs = Math.max(1.5, round2(l.fontMm * k));
      return { ...l, fontMm: fs, lines: Math.max(1, Math.ceil(estimateTextWidthMm(l.text, fs, l.mono) / w - 1e-9)) };
    });
  }
  return fitted;
}

/** The label's `@page` rule for the browser print path: exact stock size,
 *  zero margin, so one label = one page on the label printer. */
export function labelPageCss(widthMm: number, heightMm: number): string {
  return `@page { size: ${fmt(widthMm)}mm ${fmt(heightMm)}mm; margin: 0; }`;
}

function fmt(n: number): string { return String(Math.round(n * 10) / 10); }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
