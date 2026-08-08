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
  'Α': 'Alpha', 'Β': 'Beta', 'Γ': 'Gamma', 'Δ': 'Delta',
  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '∞': 'inf', '−': '-',
  '‐': '-', '‑': '-', '‒': '-', '⁄': '/', '′': "'", '″': '"',
  // Exotic spaces written as escapes — the literal glyphs are
  // indistinguishable in source and collapsed into duplicate keys.
  '\u00a0': ' ', '\u2007': ' ', '\u2009': ' ', '\u202f': ' ', '\u200b': '',
};

const SUP_RUN_RE = new RegExp(`[${Object.keys(SUPERSCRIPTS).join('')}]+`, 'g');
const SUB_RE = new RegExp(`[${Object.keys(SUBSCRIPTS).join('')}]`, 'g');
const OTHER_RE = new RegExp(`[${Object.keys(OTHER).join('')}]`, 'g');

/** Transliterate one string into something the PDF fonts can actually draw. */
export function pdfSafeText(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (!/[^\x20-\x7e]/.test(s)) return s;   // fast path: plain ASCII
  return s
    .replace(SUP_RUN_RE, run => '^' + [...run].map(c => SUPERSCRIPTS[c] ?? c).join(''))
    .replace(SUB_RE, c => SUBSCRIPTS[c] ?? c)
    .replace(OTHER_RE, c => OTHER[c] ?? c);
}

/**
 * Route EVERY draw on this document through {@link pdfSafeText} by wrapping
 * `doc.text` once. A single choke point beats sanitising at the ~50 call sites
 * that build a report, and it also covers jspdf-autotable, which renders its
 * cells through this same method — so table units and test names are fixed
 * without touching the table code.
 */
export function installPdfTextSanitizer(doc: jsPDF): void {
  const d = doc as unknown as { text: (...a: unknown[]) => unknown; __pfSanitized?: boolean };
  if (d.__pfSanitized) return;          // idempotent — safe on a re-used doc
  const original = d.text.bind(doc);
  d.text = (text: unknown, ...rest: unknown[]) =>
    original(Array.isArray(text) ? text.map(pdfSafeText) : pdfSafeText(text), ...rest);
  d.__pfSanitized = true;
}
