import { FieldDef } from '../../core/types';

/** The kinds that can be asked once per side (the server refuses any other). */
export const PAIR_INNER_KINDS: readonly string[] = ['number', 'measure', 'choice', 'multi', 'text', 'shorthand'];

export type PairSide = 'right' | 'left';
export type PairSideWords = 'rightLeft' | 'eyes' | 'ears';

export interface PairValue {
  right?: unknown;
  left?: unknown;
}

const blank = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v).length === 0);

/** The single question asked for each side (the field's one child). */
export function innerOf(field: FieldDef): FieldDef | null {
  return field.children?.[0] ?? null;
}

/** The words for the two sides, as the server writes them. */
export function sideLabels(config: Record<string, unknown> | undefined): { right: string; left: string } {
  const words = config?.['sideWords'];
  const [r, l] = words === 'eyes' ? ['RE', 'LE'] : words === 'ears' ? ['R ear', 'L ear'] : ['Right', 'Left'];
  const custom = (k: string, fallback: string) => {
    const v = config?.[k];
    return typeof v === 'string' && v.trim() ? v.trim() : fallback;
  };
  return { right: custom('rightLabel', r), left: custom('leftLabel', l) };
}

/** Sides in reading order: right first unless the field says left first. */
export function sideOrder(config: Record<string, unknown> | undefined): PairSide[] {
  return config?.['order'] === 'leftFirst' ? ['left', 'right'] : ['right', 'left'];
}

function asPair(value: unknown): PairValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PairValue) : {};
}

export function sideValue(value: unknown, side: PairSide): unknown {
  const v = asPair(value)[side];
  return blank(v) ? undefined : v;
}

/** The pair's answer after one side changes; a blank side is left out, nothing left = no answer. */
export function withSide(value: unknown, side: PairSide, next: unknown): PairValue | undefined {
  const out: PairValue = { ...asPair(value) };
  if (blank(next)) delete out[side];
  else out[side] = next;
  for (const k of ['right', 'left'] as const) if (blank(out[k])) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** Is the pair answered: either side holds something. */
export function pairAnswered(value: unknown): boolean {
  return !blank(sideValue(value, 'right')) || !blank(sideValue(value, 'left'));
}

/** Exactly one side answered: which one (the "same on both sides" shortcut copies it across). */
export function onlySide(value: unknown): PairSide | null {
  const r = !blank(sideValue(value, 'right'));
  const l = !blank(sideValue(value, 'left'));
  return r && !l ? 'right' : l && !r ? 'left' : null;
}

/**
 * The words the pair writes: "RE 6/9, LE 6/12"; equal sides "Bilateral 6/9" (unless `bilateral` is false); one blank side
 * writes only the other. `wordsOf` writes one side's answer (the inner kind's own words). Mirrors the server's SidePairKind.
 */
export function pairWords(field: FieldDef, value: unknown, wordsOf: (inner: FieldDef, v: unknown) => string): string {
  const inner = innerOf(field);
  if (!inner) return '';
  const side = (s: PairSide) => {
    const v = sideValue(value, s);
    return v === undefined ? '' : wordsOf(inner, v).trim();
  };
  const right = side('right');
  const left = side('left');
  if (right === '' && left === '') return '';
  const cfg = field.config ?? {};
  const w = sideLabels(cfg);
  if (right !== '' && left !== '') {
    if (cfg['bilateral'] !== false && right.toLowerCase() === left.toLowerCase()) return 'Bilateral ' + right;
    return sideOrder(cfg)[0] === 'left' ? `${w.left} ${left}, ${w.right} ${right}` : `${w.right} ${right}, ${w.left} ${left}`;
  }
  return right !== '' ? `${w.right} ${right}` : `${w.left} ${left}`;
}
