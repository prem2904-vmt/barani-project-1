/**
 * Reference-band COMPARATOR as the editor presents it: one choice per band —
 * a two-sided "low – high" range, or a one-sided bound with its operator
 * (<, ≤, >, ≥). Stored exactly like the seeded catalogue (build_bio_v11.py /
 * build_ims_v11.py) and read by the ONE resolver (mw `RangeDef.MinOp/MaxOp`,
 * client `reference-range.ts`):
 *
 *   between  → { min, max }             (inclusive both ends — no ops)
 *   <  x     → { max: x }               (strict one-sided = the default, no op)
 *   ≤  x     → { max: x, maxOp: 'lte' }
 *   >  x     → { min: x }               (strict, no op)
 *   ≥  x     → { min: x, minOp: 'gte' }
 *
 * A band without ops keeps behaving exactly as before (two-sided inclusive,
 * one-sided strict). Shared byte-identical by prefrontal-ui and
 * prefrontal-admin-ui.
 */

export type RangeBound = 'between' | 'lt' | 'lte' | 'gt' | 'gte';

export interface BoundBand {
  min?: number | null;
  max?: number | null;
  minOp?: 'gt' | 'gte' | null;
  maxOp?: 'lt' | 'lte' | null;
}

export interface RangeBoundOption {
  value: RangeBound;
  /** Short cell text: the symbol + plain words. */
  label: string;
  /** What it means for the flag — used as the editor's hint. */
  hint: string;
}

export const RANGE_BOUND_OPTIONS: readonly RangeBoundOption[] = [
  { value: 'between', label: 'Low – high', hint: 'Normal from the low value to the high value (both included).' },
  { value: 'lt', label: '< Below', hint: 'Normal below the value — the value itself is flagged H.' },
  { value: 'lte', label: '≤ At or below', hint: 'Normal at or below the value — the value itself is normal.' },
  { value: 'gt', label: '> Above', hint: 'Normal above the value — the value itself is flagged L.' },
  { value: 'gte', label: '≥ At or above', hint: 'Normal at or above the value — the value itself is normal.' },
];

/** The comparator a band reads as. Both bounds (or neither) = 'between'. */
export function boundOf(b: BoundBand | null | undefined): RangeBound {
  const hasMin = b?.min != null;
  const hasMax = b?.max != null;
  if (hasMin === hasMax) return 'between';
  if (hasMax) return b?.maxOp === 'lte' ? 'lte' : 'lt';
  return b?.minOp === 'gte' ? 'gte' : 'gt';
}

/** The band's printed label for its comparator (cell renderer). */
export function boundLabel(bound: string | null | undefined): string {
  return RANGE_BOUND_OPTIONS.find(o => o.value === bound)?.label ?? RANGE_BOUND_OPTIONS[0].label;
}

/**
 * The band with its comparator switched to `bound`. The value carries across
 * (a one-sided band's single value moves to the side the new operator uses);
 * every other key of the band is kept. Ops are written only when inclusive —
 * strict one-sided and two-sided bands carry none, like the seeded catalogue.
 */
export function withBound<T extends BoundBand>(b: T, bound: RangeBound): T {
  const next: T = { ...b };
  delete next.minOp;
  delete next.maxOp;
  const single = b.max ?? b.min ?? null;
  switch (bound) {
    case 'between':
      next.min = b.min ?? null;
      next.max = b.max ?? null;
      break;
    case 'lt':
    case 'lte':
      next.min = null;
      next.max = b.min != null && b.max != null ? b.max : single;
      if (bound === 'lte') next.maxOp = 'lte';
      break;
    case 'gt':
    case 'gte':
      next.max = null;
      next.min = b.min != null && b.max != null ? b.min : single;
      if (bound === 'gte') next.minOp = 'gte';
      break;
  }
  return next;
}

/** Which value cells a comparator uses: 'min' (low) and/or 'max' (high). */
export function boundUses(bound: RangeBound, side: 'min' | 'max'): boolean {
  if (bound === 'between') return true;
  return side === 'max' ? bound === 'lt' || bound === 'lte' : bound === 'gt' || bound === 'gte';
}
