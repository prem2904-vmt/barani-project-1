import type { ReportTemplate } from '../models/report.model';
import { swapAgeSexColumns } from './report-patient-text';
import { TODAY_COLORS, detectPalette, paletteById, paletteColumns, type PaletteColors, type PaletteId } from './report-palettes';
import { DEFAULT_REPORT_STYLE, STYLE_PRESETS, readReportStyle, writeReportStyle, type ReportStyle, type ReportStylePatch } from './report-style';
import { readReportTheme, writeReportTheme, type ReportThemeId } from './report-theme';

/**
 * STYLE PRESETS — one-click bundles of the report style (report layout plan §3.12).
 *
 *  - Classic = today. Applying it puts every bundled key back to its default,
 *    the Classic type theme and today's colours.
 *  - Modern  = text fitting, "45 Y / Male" in one field, tinted patient block,
 *    patient name on later pages, "Page 2 of 3", Source Sans 3, the Teal palette.
 *  - Compact = Compact density + squeeze, "45 Yrs / M", patient name on later
 *    pages, "Page 2 of 3", Classic type, the Ink (black / grey) palette.
 *
 * A preset writes EXACTLY the keys listed in `PRESET_KEYS` (plus the type
 * theme, the seven palette colour columns and — when the strip is arranged —
 * the age / sex chips), and nothing else: a lab's own field names, minimum
 * font size, logo, signatures and sequencing are left alone. Keys of later
 * phases (signature placement, chart look) are not in the bundle until their
 * renderers exist, so a preset never changes paper in a way the summary does
 * not say. Signature placement and wording (`signatures.placement` / `.show`)
 * joined the bundle with their renderer (Phase 6); image height, per-row limit,
 * stationery reserve and the verified text stay the lab's own.
 */

export type PresetId = 'classic' | 'modern' | 'compact';
export const PRESET_IDS: ReadonlyArray<PresetId> = ['classic', 'modern', 'compact'];

/** Dotted `reportStyle` paths a preset owns (every one is reset to its default
 *  unless the preset sets it). */
export const PRESET_KEYS: ReadonlyArray<string> = [
  'fit.enabled',
  'patient.ageSex', 'patient.ageStyle', 'patient.sexStyle', 'patient.joiner', 'patient.labelJoiner',
  'patient.frame', 'patient.continuation',
  'pageNumbers', 'density', 'squeeze', 'colors.palette',
  'signatures.placement', 'signatures.show',
];

/** The type theme and colours each preset brings. */
const PRESET_THEME: Readonly<Record<PresetId, ReportThemeId>> = { classic: 'classic', modern: 'source-sans', compact: 'classic' };
const PRESET_PALETTE: Readonly<Record<PresetId, PaletteId | null>> = { classic: null, modern: 'teal', compact: 'ink' };

const getPath = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
const setPath = (o: Record<string, unknown>, path: string, v: unknown): void => {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[ks[ks.length - 1]] = v;
};

/** The full bundle of a preset: every PRESET_KEY at the preset's value or the default. */
export function presetBundle(id: PresetId): ReportStylePatch {
  const out: Record<string, unknown> = {};
  const over = STYLE_PRESETS[id] as unknown;
  for (const k of PRESET_KEYS) {
    const v = getPath(over, k);
    setPath(out, k, v !== undefined ? v : getPath(DEFAULT_REPORT_STYLE, k));
  }
  setPath(out, 'preset', id);
  if (id === 'classic') setPath(out, 'colors.palette', getPath(DEFAULT_REPORT_STYLE, 'colors.palette'));
  return out as ReportStylePatch;
}

/** The template fields applying `id` changes. Immutable — `tpl` is not touched.
 *  `metadata` carries the style and the type theme; the colour columns and the
 *  arranged age / sex chips ride along. */
export function applyStylePreset(tpl: ReportTemplate, id: PresetId): Partial<ReportTemplate> {
  let metadata = writeReportStyle(tpl, presetBundle(id));
  metadata = writeReportTheme({ metadata }, PRESET_THEME[id]);
  const out: Partial<ReportTemplate> = { metadata };
  const pal = PRESET_PALETTE[id];
  const colors: PaletteColors = pal ? paletteById(pal)!.colors : TODAY_COLORS;
  Object.assign(out, paletteColumns(colors));
  if (tpl.patientColumnsJson) {
    try {
      const cols = JSON.parse(tpl.patientColumnsJson) as string[][];
      if (Array.isArray(cols)) out.patientColumnsJson = JSON.stringify(swapAgeSexColumns(cols, id !== 'classic'));
    } catch { /* an unreadable arrangement is left as it is */ }
  }
  return out;
}

/** Which preset the template currently equals (style bundle + type theme +
 *  palette), else 'custom'. */
export function detectPreset(tpl: Pick<ReportTemplate, 'metadata'> & Partial<ReportTemplate>): PresetId | 'custom' {
  const style = readReportStyle(tpl) as ReportStyle;
  const theme = readReportTheme(tpl);
  const pal = detectPalette(tpl);
  for (const id of PRESET_IDS) {
    if (PRESET_THEME[id] !== theme) continue;
    const want = PRESET_PALETTE[id];
    if (want ? pal !== want : pal !== 'custom') continue;
    const bundle = presetBundle(id);
    if (PRESET_KEYS.every(k => JSON.stringify(getPath(style, k)) === JSON.stringify(getPath(bundle, k)))) return id;
  }
  return 'custom';
}

export interface PresetInfo { id: PresetId; label: string; desc: string; changes: string[] }

/** What each preset does, in the words the card shows ("what this changes"). */
export const PRESET_INFO: ReadonlyArray<PresetInfo> = [
  { id: 'classic', label: 'Classic', desc: 'The report as it prints today.',
    changes: [
      'Long text is not fitted',
      'Age and sex on two lines, as the layout prints them',
      'Lined patient block; no patient name on later pages',
      'Page number only',
      'Each department signs at the end of its own results, with the signature image',
      'Normal row spacing, no squeeze',
      'Classic type; navy and blue colours',
    ] },
  { id: 'modern', label: 'Modern', desc: 'Clean and airy, with a teal accent.',
    changes: [
      'Long text wraps or shrinks to fit',
      'Age and sex in one field: 45 Y / Male',
      'Tinted patient block; name on later pages',
      '“Page 2 of 3” page numbers',
      'One sign-off after End of Report, with signature images',
      'Source Sans 3 type, Teal colours',
    ] },
  { id: 'compact', label: 'Compact', desc: 'Fewer pages, plain black and grey.',
    changes: [
      'Long text wraps or shrinks to fit',
      'Age and sex in one field: 45 Yrs / M',
      'Name on later pages; “Page 2 of 3”',
      'Tight rows; squeezes a small overflow onto one page',
      'One sign-off after End of Report as “Electronically verified by …” lines',
      'Classic type, Ink (black and grey) colours',
    ] },
];
