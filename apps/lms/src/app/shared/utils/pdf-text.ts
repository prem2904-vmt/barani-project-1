import { jsPDF } from 'jspdf';

/**
 * jsPDF's built-in ("standard 14") fonts are WinAnsi/cp1252-encoded. Any
 * character outside that set is emitted as garbage — which is why units like
 * `×10⁹/L` printed as mojibake on reports while looking perfect in the app.
 *
 * The DATA is right: `⁹` is the correct character, and the browser renders it
 * properly everywhere else. Only the PDF back-end is limited, so we
 * transliterate at render time instead of degrading the catalogue.
 *
 * Superscripts collapse to caret form (`×10⁹/L` → `×10^9/L`) — including the
 * ones cp1252 *can* encode (¹²³), so a report never mixes `×10¹²/L` with
 * `×10^9/L` in the same column.
 */
/** Superscript → the bare character it stands for. A RUN collapses into one
 *  caret group, so ×10¹²/L becomes ×10^12/L and not ×10^1^2/L. */
const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', 'ⁿ': 'n',
};
/** Subscripts drop to plain digits — CO₂ → CO2, the usual plain-text form. */
const SUBSCRIPTS: Readonly<Record<string, string>> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};
/** Everything else that cp1252 can't hold. NOTE: µ (U+00B5), × (U+00D7),
 *  – (U+2013) and — (U+2014) ARE in cp1252 and are deliberately left alone. */
const OTHER: Readonly<Record<string, string>> = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'κ': 'kappa', 'λ': 'lambda',
  // GREEK SMALL MU (U+03BC) → MICRO SIGN (U+00B5, in cp1252). Units typed or
  // imported with the Greek letter rendered as garbage ("¼L" on reports —
  // HEM00010's μL was exactly this); visually identical, different codepoint.
  'μ': 'µ',
  'Α': 'Alpha', 'Β': 'Beta', 'Γ': 'Gamma', 'Δ': 'Delta',
  // ≥ ≤ ≠ ≈ ∞ and the Greek above print NATIVELY via the Symbol font when
  // drawn through installPdfTextSanitizer; these spellings are the fallback.
  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '∞': 'inf', '−': '-',
  '‐': '-', '‑': '-', '‒': '-', '⁄': '/', '′': "'", '″': '"',
  // Exotic spaces written as escapes — the literal glyphs are
  // indistinguishable in source and collapsed into duplicate keys.
  '\u00a0': ' ', '\u2007': ' ', '\u2009': ' ', '\u202f': ' ', '\u200b': '',
};

const SUP_RUN_RE = new RegExp(`[${Object.keys(SUPERSCRIPTS).join('')}]+`, 'g');
const SUB_RE = new RegExp(`[${Object.keys(SUBSCRIPTS).join('')}]`, 'g');
const OTHER_RE = new RegExp(`[${Object.keys(OTHER).join('')}]`, 'g');

// ──────────────────────────────────────────────────────────────
// Native glyphs from the PDF-standard Symbol font
// ──────────────────────────────────────────────────────────────

/**
 * Characters we can print as REAL glyphs instead of transliterating: the
 * PDF-standard Symbol font (one of the base 14 — every viewer has it, nothing
 * is embedded) carries them in its own built-in encoding. Each entry is the
 * Symbol-encoding byte and the glyph's advance width from Adobe's Symbol AFM
 * (1/1000 em) — jsPDF's bundled Symbol metrics are unreliable, so widths are
 * taken from here for measurement and positioning.
 *
 * Only characters cp1252 CAN'T hold belong here: ± µ × – — already print
 * natively in Helvetica/Times/Courier and must stay in the body font.
 */
const SYMBOL_GLYPHS: Readonly<Record<string, readonly [string, number]>> = {
  '≥': ['\u00b3', 549], '≤': ['\u00a3', 549], '≠': ['\u00b9', 549],
  '≈': ['\u00bb', 549], '∞': ['\u00a5', 713],
  'α': ['a', 631], 'β': ['b', 549], 'γ': ['g', 411], 'δ': ['d', 494],
  'κ': ['k', 549], 'λ': ['l', 549],
  'Α': ['A', 722], 'Β': ['B', 667], 'Γ': ['G', 603], 'Δ': ['D', 612],
};
const SYMBOL_CHARS = Object.keys(SYMBOL_GLYPHS).join('');
const SYMBOL_ANY_RE = new RegExp(`[${SYMBOL_CHARS}]`);
const SYMBOL_RUN_RE = new RegExp(`[${SYMBOL_CHARS}]+`, 'g');

export interface PdfSafeTextOptions {
  /** Leave the Symbol-font characters (≥ ≤ ≠ ≈ ∞ and Greek) in place for a
   *  symbol-aware draw — see {@link installPdfTextSanitizer}. */
  keepSymbols?: boolean;
  /** The text will be drawn in an EMBEDDED Unicode font (a report theme's
   *  TTF — see report-fonts.ts): it carries ⁹ ≥ µ ₹ … natively, so nothing
   *  is transliterated here. A glyph the font lacks is replaced at draw time
   *  (see {@link unicodeFontSafeText}). */
  native?: boolean;
}

/** Transliterate one string into something the PDF fonts can actually draw. */
export function pdfSafeText(value: unknown, opts: PdfSafeTextOptions = {}): string {
  if (value == null) return '';
  const s = String(value);
  if (opts.native) return s;
  if (!/[^\x20-\x7e]/.test(s)) return s;   // fast path: plain ASCII
  return s
    .replace(SUP_RUN_RE, run => '^' + [...run].map(c => SUPERSCRIPTS[c] ?? c).join(''))
    .replace(SUB_RE, c => SUBSCRIPTS[c] ?? c)
    .replace(OTHER_RE, c => (opts.keepSymbols && SYMBOL_GLYPHS[c]) ? c : (OTHER[c] ?? c));
}

/** True when `text` holds a character drawn from the Symbol font. */
export function hasSymbolGlyph(text: string): boolean {
  return SYMBOL_ANY_RE.test(text);
}

/** Split "Diabetes: ≥126" into [{t:'Diabetes: '},{t:'≥',sym:true},{t:'126'}]. */
export function splitSymbolRuns(text: string): Array<{ t: string; sym?: boolean }> {
  const out: Array<{ t: string; sym?: boolean }> = [];
  let last = 0;
  SYMBOL_RUN_RE.lastIndex = 0;
  for (const m of text.matchAll(SYMBOL_RUN_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: text.slice(last, i) });
    out.push({ t: m[0], sym: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

/** Unicode symbol run → the bytes the Symbol font's built-in encoding expects. */
export function toSymbolEncoding(run: string): string {
  return [...run].map(c => SYMBOL_GLYPHS[c]?.[0] ?? c).join('');
}

/** Width of a symbol run in em (Symbol AFM widths). */
export function symbolRunUnitWidth(run: string): number {
  return [...run].reduce((w, c) => w + (SYMBOL_GLYPHS[c]?.[1] ?? 500), 0) / 1000;
}

// ──────────────────────────────────────────────────────────────
// Embedded Unicode fonts (report themes)
// ──────────────────────────────────────────────────────────────

/** An embedded TTF font's glyph lookup (jsPDF TTFFont metadata). */
type GlyphFont = { metadata?: { characterToGlyph?: (code: number) => number } };

/**
 * Text for an EMBEDDED Unicode font: every character the font has prints as
 * itself (×10⁹/L, ≥ 126, µIU/mL, ₹, °C — no transliteration). jsPDF's
 * Identity-H writer STOPS at the first character the font has no glyph for
 * (it silently drops the rest of the line), so each missing character is
 * replaced: the cp1252 transliteration when the font can draw that, a space
 * for an exotic space, nothing for a zero-width one, else "?".
 */
export function unicodeFontSafeText(text: string, font: GlyphFont): string {
  const meta = font.metadata;
  if (!meta?.characterToGlyph || !/[^\x20-\x7e]/.test(text)) return text;
  // A method of the TTF metadata — call it on its object.
  const has = (c: string) => c === '\n' || c === '\r' || meta.characterToGlyph!(c.charCodeAt(0)) !== 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (has(c)) { out += c; continue; }
    const alt = SUPERSCRIPTS[c] ?? SUBSCRIPTS[c] ?? OTHER[c];
    if (alt !== undefined && [...alt].every(has)) { out += alt; continue; }
    out += /\s/.test(c) ? ' ' : '?';
  }
  return out;
}

/** Mark `fontName` (a family registered with doc.addFont) as an embedded
 *  Unicode font on this document: the sanitizer then draws its text natively. */
export function registerUnicodeFont(doc: jsPDF, fontName: string): void {
  const d = doc as unknown as WrappableDoc;
  (d.__pfUnicodeFonts ??= new Set<string>()).add(fontName.toLowerCase());
}

/** The current font when it is a registered embedded Unicode font, else null. */
function activeUnicodeFont(d: WrappableDoc): GlyphFont | null {
  if (!d.__pfUnicodeFonts?.size) return null;
  const f = d.getFont() as unknown as { fontName: string } & GlyphFont;
  return d.__pfUnicodeFonts.has(String(f.fontName).toLowerCase()) ? f : null;
}

type TextOptions = Record<string, unknown> & {
  align?: string; maxWidth?: number; lineHeightFactor?: number;
};
type WrappableDoc = {
  text: (...a: unknown[]) => unknown;
  getStringUnitWidth: (text: string, options?: unknown) => number;
  splitTextToSize: (text: string, size: number, options?: unknown) => string[];
  getFont: () => { fontName: string; fontStyle: string };
  setFont: (name: string, style?: string) => unknown;
  getFontSize: () => number;
  getLineHeightFactor?: () => number;
  internal: { scaleFactor: number };
  __pfSanitized?: boolean;
  __pfUnicodeFonts?: Set<string>;
};

/**
 * Route EVERY draw on this document through {@link pdfSafeText} by wrapping
 * `doc.text` once. A single choke point beats sanitising at the ~50 call sites
 * that build a report, and it also covers jspdf-autotable, which renders its
 * cells through this same method — so table units and test names are fixed
 * without touching the table code.
 *
 * Lines holding ≥ ≤ ≠ ≈ ∞ or Greek are drawn as MIXED RUNS: the body text in
 * the current font, the symbols in the PDF-standard Symbol font, each run
 * placed at the running advance so "Diabetes: ≥126 mg/dL" prints exactly as
 * Test Master shows it. Alignment (left/center/right), multi-line text,
 * maxWidth wrapping and baseline are honoured; anything exotic (rotation, a
 * transform matrix, the legacy positional signature) falls back to the old
 * transliteration ("≥" → ">="), which is always safe.
 *
 * `getStringUnitWidth` (and therefore `getTextWidth`, and autotable's column
 * sizing and right/centre alignment) is wrapped the same way so a symbol is
 * measured at its real Symbol-font width. Text with no symbol is passed
 * through untouched, so every existing layout measures exactly as before.
 */
export function installPdfTextSanitizer(doc: jsPDF): void {
  const d = doc as unknown as WrappableDoc;
  if (d.__pfSanitized) return;          // idempotent — safe on a re-used doc
  const original = d.text.bind(doc);
  const originalUnitWidth = d.getStringUnitWidth.bind(doc);

  /** em width of an already-sanitised line that may hold symbol runs. */
  const unitWidth = (line: string, options?: unknown): number =>
    splitSymbolRuns(line).reduce((w, r) =>
      w + (r.sym ? symbolRunUnitWidth(r.t) : originalUnitWidth(r.t, options)), 0);

  d.getStringUnitWidth = (text: string, options?: unknown) => {
    // An embedded Unicode font measures what it will actually draw.
    const uf = typeof text === 'string' ? activeUnicodeFont(d) : null;
    if (uf) return originalUnitWidth(unicodeFontSafeText(text, uf), options);
    return typeof text === 'string' && hasSymbolGlyph(text)
      ? unitWidth(pdfSafeText(text, { keepSymbols: true }), options)
      : originalUnitWidth(text, options);
  };

  const flat = (text: unknown) =>
    Array.isArray(text) ? text.map(t => pdfSafeText(t)) : pdfSafeText(text);

  d.text = (text: unknown, x: unknown, y: unknown, options?: unknown, ...rest: unknown[]) => {
    // Embedded Unicode font (a report theme): native glyphs, no Symbol runs.
    const uf = activeUnicodeFont(d);
    if (uf) {
      const native = (t: unknown) => unicodeFontSafeText(t == null ? '' : String(t), uf);
      return original(Array.isArray(text) ? text.map(native) : native(text), x, y, options, ...rest);
    }
    const opts = (options ?? {}) as TextOptions;
    const plainCall = typeof x === 'number' && typeof y === 'number'
      && (options == null || (typeof options === 'object' && !Array.isArray(options)))
      && rest.every(r => r == null)
      && opts['angle'] == null && opts['rotationDirection'] == null;
    const rawLines: string[] = Array.isArray(text)
      ? text.map(t => String(t ?? ''))
      : String(text ?? '').split(/\r\n|\r|\n/);
    if (!plainCall || !rawLines.some(hasSymbolGlyph)) {
      return original(flat(text), x, y, options, ...rest);
    }

    const { align, maxWidth, lineHeightFactor, ...runOpts } = opts;
    let lines = rawLines.map(l => pdfSafeText(l, { keepSymbols: true }));
    if (typeof maxWidth === 'number' && maxWidth > 0) {
      lines = lines.flatMap(l => d.splitTextToSize(l, maxWidth));
    }
    const k = d.internal.scaleFactor;
    const fs = d.getFontSize();
    const lh = fs * (lineHeightFactor ?? d.getLineHeightFactor?.() ?? 1.15) / k;

    lines.forEach((line, i) => {
      const ly = (y as number) + i * lh;
      if (!hasSymbolGlyph(line)) {
        // justify has no meaning for a single line — it draws flush left.
        original(line, x, ly, { ...runOpts, align: align === 'justify' ? 'left' : align });
        return;
      }
      const w = unitWidth(line) * fs / k;
      let cx = (x as number) - (align === 'right' ? w : align === 'center' ? w / 2 : 0);
      for (const run of splitSymbolRuns(line)) {
        if (run.sym) {
          const f = d.getFont();
          d.setFont('symbol', 'normal');
          original(toSymbolEncoding(run.t), cx, ly, runOpts);
          d.setFont(f.fontName, f.fontStyle);
          cx += symbolRunUnitWidth(run.t) * fs / k;
        } else {
          original(run.t, cx, ly, runOpts);
          cx += originalUnitWidth(run.t) * fs / k;
        }
      }
    });
    return doc;
  };
  d.__pfSanitized = true;
}

// ──────────────────────────────────────────────────────────────
// True superscripts
// ──────────────────────────────────────────────────────────────

/** `^9`, `^12`, `^-3` … — the caret form pdfSafeText leaves behind. */
const SUP_MARKER = /\^([0-9+-]+)/g;

/** Split "×10^9/L" into runs: [{t:'×10'},{t:'9',sup:true},{t:'/L'}]. */
export function splitSuperscriptRuns(text: string): Array<{ t: string; sup?: boolean }> {
  const out: Array<{ t: string; sup?: boolean }> = [];
  let last = 0;
  // matchAll CLONES the regex but COPIES its lastIndex — so a preceding
  // hasSuperscript() call on the same string left the scan starting PAST the
  // first ^marker, no runs matched, and the whole caret string drew as one
  // flat run. That is why reports kept printing ×10^12/L despite the raised-
  // digit engine being wired up and firing.
  SUP_MARKER.lastIndex = 0;
  for (const m of text.matchAll(SUP_MARKER)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: text.slice(last, i) });
    out.push({ t: m[1], sup: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

export function hasSuperscript(text: string): boolean {
  // .test() on a /g regex ADVANCES lastIndex; reset on both sides so this
  // probe can never poison a later split (and vice versa).
  SUP_MARKER.lastIndex = 0;
  const hit = SUP_MARKER.test(text);
  SUP_MARKER.lastIndex = 0;
  return hit;
}

/** Width of `text` with its superscript runs rendered smaller. */
export function measureWithSuperscripts(
  doc: { getTextWidth: (s: string) => number; setFontSize: (n: number) => void },
  text: string, fontSize: number
): number {
  let w = 0;
  for (const run of splitSuperscriptRuns(text)) {
    doc.setFontSize(run.sup ? fontSize * SUP_SCALE : fontSize);
    w += doc.getTextWidth(run.t);
  }
  doc.setFontSize(fontSize);
  return w;
}

const SUP_SCALE = 0.66;   // superscript glyph size, relative to the body size
const SUP_RISE  = 0.32;   // how far above the baseline, as a fraction of size

/**
 * Draw text with REAL raised superscripts — "×10⁹/L" rather than "×10^9/L".
 *
 * jsPDF's built-in fonts are cp1252, which has no ⁹, so the glyph itself can't
 * be printed. Embedding a Unicode font would cost a few hundred KB and would
 * override the admin's Helvetica/Times/Courier choice, so instead the digits
 * are drawn smaller and raised — which is what a superscript actually IS
 * typographically, and it inherits whichever font is selected.
 *
 * Returns the total advance width.
 */
export function drawTextWithSuperscripts(
  doc: {
    text: (t: string, x: number, y: number) => unknown;
    getTextWidth: (s: string) => number;
    setFontSize: (n: number) => void;
  },
  text: string, x: number, y: number, fontSize: number
): number {
  let cx = x;
  for (const run of splitSuperscriptRuns(text)) {
    if (run.sup) {
      doc.setFontSize(fontSize * SUP_SCALE);
      doc.text(run.t, cx, y - fontSize * SUP_RISE);
    } else {
      doc.setFontSize(fontSize);
      doc.text(run.t, cx, y);
    }
    cx += doc.getTextWidth(run.t);
  }
  doc.setFontSize(fontSize);
  return cx - x;
}
