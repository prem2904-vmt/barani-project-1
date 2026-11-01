import type { ReportTemplate } from '../models/report.model';

/**
 * Report colour palettes and the print-safe check (report layout plan §3.7).
 *
 * Pure and DI-free. A palette is a bundle of the template's EXISTING colour
 * columns (lab-name colour, accent bar, table header, hairline, high / low
 * value colours) — choosing one writes those columns, nothing new is stored;
 * `reportStyle.colors.palette` only remembers the choice.
 *
 * Print-safe means the report still reads on a black-and-white laser printer
 * and photocopier:
 *  - text colours keep WCAG contrast >= 4.5:1 on their background;
 *  - the HIGH and LOW value colours differ in lightness (CIE L*) by >= 25
 *    points, so they are told apart even without colour — and the H / L letters
 *    and bold weight still print whatever the colour (flags are never
 *    colour-only);
 *  - the accent is dark enough to print and is not a neon.
 */

export type PaletteId = 'ink' | 'navy' | 'teal' | 'forest' | 'plum' | 'slate';

/** The template columns a palette writes. */
export interface PaletteColors {
  primaryColor: string;
  accentColor: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  dividerColor: string;
  abnormalColor: string;
  abnormalLowColor: string;
}
export const PALETTE_KEYS: ReadonlyArray<keyof PaletteColors> = [
  'primaryColor', 'accentColor', 'tableHeaderBg', 'tableHeaderText', 'dividerColor', 'abnormalColor', 'abnormalLowColor',
];

/** Thresholds of the checks (one place; the specs and the editor share them). */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_ACCENT_CONTRAST = 3;
/** CIE L* points (0–100) between the High and Low colours. */
export const MIN_HIGH_LOW_GAP = 25;

export interface Palette { id: PaletteId; label: string; note: string; colors: PaletteColors }

/** HIGH is always a very dark red and LOW a mid-tone blue-grey, so they stay
 *  apart in greyscale; the family only tints the low colour. */
const HIGH = '#560c0c';

export const PALETTES: ReadonlyArray<Palette> = [
  { id: 'ink', label: 'Ink', note: 'Black and greys — prints the same on any printer.',
    colors: { primaryColor: '#111111', accentColor: '#333333', tableHeaderBg: '#efefef', tableHeaderText: '#111111',
      dividerColor: '#bdbdbd', abnormalColor: '#111111', abnormalLowColor: '#707070' } },
  { id: 'navy', label: 'Navy', note: 'Deep blue — the classic lab look.',
    colors: { primaryColor: '#1B3A6B', accentColor: '#0066CC', tableHeaderBg: '#E9EFF8', tableHeaderText: '#12284d',
      dividerColor: '#c3cfe2', abnormalColor: HIGH, abnormalLowColor: '#2a68d6' } },
  { id: 'teal', label: 'Teal', note: 'Fresh and clinical.',
    colors: { primaryColor: '#0F5E63', accentColor: '#0E7C86', tableHeaderBg: '#E6F3F4', tableHeaderText: '#0b3d41',
      dividerColor: '#b7d6d8', abnormalColor: HIGH, abnormalLowColor: '#12749f' } },
  { id: 'forest', label: 'Forest', note: 'Calm green.',
    colors: { primaryColor: '#1E4D2B', accentColor: '#2E7D32', tableHeaderBg: '#E8F2E9', tableHeaderText: '#143520',
      dividerColor: '#bcd6bf', abnormalColor: HIGH, abnormalLowColor: '#3a7391' } },
  { id: 'plum', label: 'Plum', note: 'Warm purple.',
    colors: { primaryColor: '#4A1D5E', accentColor: '#7B2D8E', tableHeaderBg: '#F1E9F5', tableHeaderText: '#34123f',
      dividerColor: '#d3bfdb', abnormalColor: HIGH, abnormalLowColor: '#5f72b8' } },
  { id: 'slate', label: 'Slate', note: 'Quiet blue-grey.',
    colors: { primaryColor: '#1F2937', accentColor: '#475569', tableHeaderBg: '#EEF1F5', tableHeaderText: '#111827',
      dividerColor: '#c4cbd5', abnormalColor: HIGH, abnormalLowColor: '#5a76a0' } },
];

/** What a template prints with when a colour column is empty (the renderer's own defaults). */
export const TODAY_COLORS: Readonly<PaletteColors> = Object.freeze({
  primaryColor: '#1B3A6B', accentColor: '#0066CC', tableHeaderBg: '#ffffff', tableHeaderText: '#000000',
  dividerColor: '#cccccc', abnormalColor: '#dc2626', abnormalLowColor: '#2563eb',
});

export const paletteById = (id: string): Palette | undefined => PALETTES.find(p => p.id === id);

// ── colour maths ──────────────────────────────────────────────

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
/** `#rrggbb` (lower-case) or null when `v` is not a hex colour. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = HEX.exec(v.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return '#' + h;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? '#000000';
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
const toHex = (rgb: number[]): string =>
  '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');

const lin = (c: number): number => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance, 0–1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** CIE L* (perceived lightness), 0–100 — what a greyscale print shows. */
export function lightness(hex: string): number {
  const y = relativeLuminance(hex);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}
/** `base` mixed toward `toward` by `t` (0 = base, 1 = toward). */
export function mix(base: string, toward: string, t: number): string {
  const a = hexToRgb(base), b = hexToRgb(toward);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}
/** Black or white — whichever reads better on `bg`. */
export function readableOn(bg: string): '#000000' | '#ffffff' {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#000000') ? '#ffffff' : '#000000';
}
/** The grey a black-and-white print shows for `hex`. */
export function greyOf(hex: string): string {
  const y = relativeLuminance(hex);
  const g = (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055) * 255;
  return toHex([g, g, g]);
}
/** A neon: very saturated AND light — prints muddy or washes out. */
export function isNeon(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex).map(c => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const s = mx === 0 ? 0 : (mx - mn) / mx;
  return s > 0.85 && lightness(hex) > 60;
}

// ── custom accent ─────────────────────────────────────────────

/** Everything else, derived from one accent colour: lab-name colour = the
 *  accent darkened, header row = an 8% tint with the readable ink, hairline =
 *  a 25% tint. High and Low use the print-safe pair. */
/** The accent darkened (35% at least) until it reads as text on white. */
function darkEnough(accent: string): string {
  for (let t = 0.35; t < 0.96; t += 0.1) {
    const c = mix(accent, '#000000', t);
    if (contrastRatio(c, '#ffffff') >= MIN_TEXT_CONTRAST) return c;
  }
  return mix(accent, '#000000', 0.9);
}

export function derivePaletteFromAccent(accentHex: string): PaletteColors {
  const accent = normalizeHex(accentHex) ?? normalizeHex(TODAY_COLORS.accentColor)!;
  const headerBg = mix(accent, '#ffffff', 0.92);
  return {
    primaryColor: darkEnough(accent),
    accentColor: accent,
    tableHeaderBg: headerBg,
    tableHeaderText: readableOn(headerBg) === '#ffffff' ? '#ffffff' : mix(accent, '#000000', 0.8),
    dividerColor: mix(accent, '#ffffff', 0.75),
    abnormalColor: HIGH,
    abnormalLowColor: '#2a68d6',
  };
}

// ── the check ─────────────────────────────────────────────────

export interface ColorCheck {
  id: 'header-text' | 'lab-name' | 'accent' | 'flags-text' | 'flags-grey' | 'body-text';
  label: string;
  ok: boolean;
  /** One plain sentence: the measured value and what to do. */
  detail: string;
}

type CheckInput = Partial<PaletteColors> & { bodyTextColor?: string | null };
const pick = (v: unknown, d: string): string => normalizeHex(v) ?? d;

/** The print-safe checks for a set of colours (blank / junk columns use the
 *  renderer's defaults). `flagsColoured` = the template prints High / Low in
 *  colour (flag style "bold + colour"); when it does not, the two colours are
 *  not used and that check passes by construction. */
export function checkColors(c: CheckInput, flagsColoured = true): ColorCheck[] {
  const d = TODAY_COLORS;
  const primary = pick(c.primaryColor, d.primaryColor);
  const accent = pick(c.accentColor, primary);
  const hBg = pick(c.tableHeaderBg, d.tableHeaderBg);
  const hText = pick(c.tableHeaderText, d.tableHeaderText);
  const body = pick(c.bodyTextColor, '#1a1a1a');
  const high = pick(c.abnormalColor, d.abnormalColor);
  const low = pick(c.abnormalLowColor, d.abnormalLowColor);
  const r1 = (n: number) => (Math.round(n * 10) / 10).toString();

  const out: ColorCheck[] = [];
  const hdr = contrastRatio(hText, hBg);
  out.push({ id: 'header-text', label: 'Table header is readable', ok: hdr >= MIN_TEXT_CONTRAST,
    detail: hdr >= MIN_TEXT_CONTRAST ? `Contrast ${r1(hdr)} : 1.` : `Contrast ${r1(hdr)} : 1 — needs ${MIN_TEXT_CONTRAST} : 1. Use darker header text or a lighter header row.` });
  const bodyC = contrastRatio(body, '#ffffff');
  out.push({ id: 'body-text', label: 'Body text is readable', ok: bodyC >= MIN_TEXT_CONTRAST,
    detail: bodyC >= MIN_TEXT_CONTRAST ? `Contrast ${r1(bodyC)} : 1.` : `Contrast ${r1(bodyC)} : 1 — needs ${MIN_TEXT_CONTRAST} : 1. Use a darker body text.` });
  const nameC = contrastRatio(primary, '#ffffff');
  out.push({ id: 'lab-name', label: 'Lab name is readable', ok: nameC >= MIN_TEXT_CONTRAST,
    detail: nameC >= MIN_TEXT_CONTRAST ? `Contrast ${r1(nameC)} : 1.` : `Contrast ${r1(nameC)} : 1 — needs ${MIN_TEXT_CONTRAST} : 1. Use a darker lab name colour.` });
  const accC = contrastRatio(accent, '#ffffff');
  const neon = isNeon(accent);
  const accOk = accC >= MIN_ACCENT_CONTRAST && !neon;
  out.push({ id: 'accent', label: 'Accent prints cleanly', ok: accOk,
    detail: neon ? 'This accent is a neon — it washes out on paper. Pick a deeper shade.'
      : accC < MIN_ACCENT_CONTRAST ? `Too light to print clearly (${r1(accC)} : 1, needs ${MIN_ACCENT_CONTRAST} : 1). Pick a deeper shade.`
      : `Contrast ${r1(accC)} : 1.` });
  if (flagsColoured) {
    const hc = contrastRatio(high, '#ffffff'), lc = contrastRatio(low, '#ffffff');
    const fOk = hc >= MIN_TEXT_CONTRAST && lc >= MIN_TEXT_CONTRAST;
    out.push({ id: 'flags-text', label: 'High and Low values are readable', ok: fOk,
      detail: fOk ? `High ${r1(hc)} : 1, Low ${r1(lc)} : 1.` : `High ${r1(hc)} : 1, Low ${r1(lc)} : 1 — both need ${MIN_TEXT_CONTRAST} : 1. Use deeper colours.` });
    const gap = Math.abs(lightness(low) - lightness(high));
    out.push({ id: 'flags-grey', label: 'High and Low differ in black and white', ok: gap >= MIN_HIGH_LOW_GAP,
      detail: gap >= MIN_HIGH_LOW_GAP ? `${Math.round(gap)} points apart in lightness. The H and L letters print as well.`
        : `Only ${Math.round(gap)} points apart in lightness (needs ${MIN_HIGH_LOW_GAP}) — on a black-and-white print they look alike. Make one darker. The H and L letters still tell them apart.` });
  } else {
    out.push({ id: 'flags-grey', label: 'High and Low differ in black and white', ok: true,
      detail: 'High and Low print as bold H and L letters, without colour — nothing to lose in black and white.' });
  }
  return out;
}

/** True when every check passes. */
export const allChecksPass = (checks: ReadonlyArray<ColorCheck>): boolean => checks.every(c => c.ok);

// ── reading and writing the template ──────────────────────────

type ColourFields = Pick<ReportTemplate, 'primaryColor' | 'accentColor' | 'tableHeaderBg' | 'tableHeaderText' | 'dividerColor' | 'abnormalColor' | 'abnormalLowColor'>;

/** The template columns a palette writes — exactly the seven PALETTE_KEYS. */
export function paletteColumns(colors: PaletteColors): Pick<ReportTemplate, keyof PaletteColors> {
  const out = {} as Record<string, string>;
  for (const k of PALETTE_KEYS) out[k] = colors[k];
  return out as unknown as Pick<ReportTemplate, keyof PaletteColors>;
}

/** The colours a template actually prints with (blank columns = defaults). */
export function templateColors(tpl: Partial<ColourFields> | null | undefined): PaletteColors {
  const t = tpl ?? {};
  const out = {} as Record<string, string>;
  for (const k of PALETTE_KEYS) out[k] = pick(t[k], TODAY_COLORS[k]);
  return out as unknown as PaletteColors;
}

/** Which curated palette a template's colours equal exactly, else 'custom'. */
export function detectPalette(tpl: Partial<ColourFields> | null | undefined): PaletteId | 'custom' {
  const cur = templateColors(tpl);
  const hit = PALETTES.find(p => PALETTE_KEYS.every(k => p.colors[k].toLowerCase() === cur[k].toLowerCase()));
  return hit ? hit.id : 'custom';
}
