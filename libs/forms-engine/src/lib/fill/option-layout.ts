import { FieldDef } from '../core/types';

/** Kept for callers; buttons no longer turn into a dropdown by count (owner 2026-11-12, legacy buttonSelect). */
export const CHOICE_BUTTONS_MAX = 8;
/** A dropdown only pays off for long lists; short lists stay on the page even when the form says dropdown. */
export const MULTI_CHIPS_MAX = 12;

/**
 * How a choice / multi field lays out its options — the legacy MyPrefrontal form, 1:1:
 *  - `cards`  legacy multiselect-expand: full-width cards (icon tile, title + description, round tick), one per
 *             row (two per row when the field is half width); a chosen card opens its follow-ups INSIDE itself.
 *             Every multi; a single choice whose options carry an icon (legacy buttonSelect with descriptions stayed
 *             buttons, the description under the label).
 *  - `grid`   legacy radio (checkbox-group): equal-width buttons, 2 per row (3 when the count divides by 3).
 *  - `row`    legacy buttonSelect: buttons share the row equally and only wrap when they don't fit.
 *  - `select` legacy select: the searchable pf-select (a dropdown, or a long list).
 *  - `images` legacy imageSelect tiles.
 */
export type OptionLayout = 'cards' | 'grid' | 'row' | 'select' | 'images';

export function optionLayout(f: FieldDef): OptionLayout {
  const display = f.config?.['display'];
  const opts = f.options ?? [];
  if (f.kind === 'multi') {
    if (display === 'dropdown' && opts.length > MULTI_CHIPS_MAX) return 'select';
    if (display === 'images') return 'images';
    return 'cards';
  }
  if (display === 'images') return 'images';
  // legacy buttonSelect shows every option as a button however many there are; only an author's `dropdown` is a list
  if (display === 'dropdown') return 'select';
  if (opts.some((o) => !!o.icon)) return 'cards';
  return display === 'list' ? 'grid' : 'row';
}

/** Cards show the chosen option's follow-up questions inside the card, so the field host leaves them out. */
export function followUpsInside(f: FieldDef): boolean {
  return (f.kind === 'multi' || f.kind === 'choice') && optionLayout(f) === 'cards';
}
