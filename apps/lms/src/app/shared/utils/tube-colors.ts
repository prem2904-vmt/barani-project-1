/**
 * THE tube/container vocabulary. One list, used everywhere a container is
 * named, coloured or picked.
 *
 * It existed in four places — the Test Master grid, the test editor's picker,
 * the collection screen's vial renderer and the printed label card — each with
 * its own copy of the keys, labels and hexes. Adding a container in one left
 * the others rendering a fallback, and the label card had drifted furthest:
 * it derived the tube from the DEPARTMENT and ignored the test's configured
 * container entirely, so the vial drawn on the collection screen and the tube
 * printed on the label could disagree on the same order.
 *
 * `tubeColor` on the test is the authoritative field (Test Master → order
 * sample). Everything here is presentation for that value.
 */
export interface TubeColor {
  key: string;
  /** Full name, as the picker and the vial caption show it. */
  label: string;
  /** Short name for tight spaces — the printed label's chip. */
  short: string;
  hex: string;
}

/** Canonical NABL containers, in the order the picker offers them. */
export const TUBE_COLORS: readonly TubeColor[] = [
  { key: 'sst',      label: 'SST · Gold',               short: 'Gold',       hex: '#eab308' },
  { key: 'plain',    label: 'Plain · Red',              short: 'Red',        hex: '#ef4444' },
  { key: 'edta',     label: 'EDTA · Lavender',          short: 'Lavender',   hex: '#a855f7' },
  { key: 'fluoride', label: 'Fluoride · Grey',          short: 'Grey',       hex: '#9ca3af' },
  { key: 'heparin',  label: 'Lithium Heparin · Green',  short: 'Green',      hex: '#22c55e' },
  { key: 'citrate',  label: 'Sodium Citrate · Blue',    short: 'Blue',       hex: '#38bdf8' },
  { key: 'esr',      label: 'ESR · Black',              short: 'Black',      hex: '#1f2937' },
  { key: 'trace',    label: 'Trace metal · Royal blue', short: 'Royal blue', hex: '#1d4ed8' },
  { key: 'sterile',  label: 'Sterile Container',        short: 'Sterile',    hex: '#e5e7eb' },
  { key: 'urine',    label: 'Urine Bottle · Yellow',    short: 'Urine',      hex: '#facc15' },
  { key: 'multiple', label: 'Multiple',                 short: 'Multiple',   hex: '#6366f1' },
];

/** Pre-NABL keys still stored on older tests, mapped onto the canonical ones
 *  so an old row never renders as "no container". */
const LEGACY_KEYS: Readonly<Record<string, string>> = {
  red: 'plain', lavender: 'edta', grey: 'fluoride', blue: 'citrate',
  gold: 'sst', yellow: 'urine', green: 'heparin', black: 'esr',
};

const BY_KEY = new Map(TUBE_COLORS.map(t => [t.key, t]));

/** Resolve a stored `tubeColor` to its container, or undefined when unset or
 *  unrecognised — callers then fall back to their own default. */
export function tubeColor(key?: string | null): TubeColor | undefined {
  const k = (key ?? '').trim().toLowerCase();
  if (!k) return undefined;
  return BY_KEY.get(k) ?? BY_KEY.get(LEGACY_KEYS[k] ?? '');
}

/** Hex for a stored key, with a neutral grey when it resolves to nothing. */
export function tubeHex(key?: string | null): string {
  return tubeColor(key)?.hex ?? '#9ca3af';
}
