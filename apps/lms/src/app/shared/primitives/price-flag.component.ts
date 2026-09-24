import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NOT_PRICED_LABEL } from '../utils/test-pricing';

/**
 * The ONE "still at the default price" marker (owner-approved wording:
 * "₹1 · not priced yet"). Quiet on purpose: a small muted-amber pill with a
 * price-tag glyph, shown wherever a test's price is displayed and
 * `priceIsDefault` is true — order cart and picker, booking, Test Master grid,
 * test editor, pricing page.
 *
 * Styles live in the global stylesheet (`.pf-price-flag`) so the AG Grid cell
 * (built with {@link priceFlagElement}) renders the identical pill.
 *
 *   <pf-price-flag />                 → "₹1 · not priced yet"
 *   <pf-price-flag [compact]="true" /> → "not priced yet" (next to a ₹1 already shown)
 */
@Component({
  selector: 'pf-price-flag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pf-price-flag" [attr.title]="title" role="note" [attr.aria-label]="title">
      <svg class="pf-price-flag__icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path [attr.d]="TAG_PATH" />
        <circle cx="7.5" cy="7.5" r="1.25" />
      </svg>
      <span>{{ compact() ? 'not priced yet' : label }}</span>
    </span>
  `,
  styles: [`:host { display: inline-flex; vertical-align: middle; }`],
})
export class PriceFlagComponent {
  /** Drop the "₹1 ·" prefix where ₹1 is already printed beside it. */
  readonly compact = input(false);
  protected readonly label = NOT_PRICED_LABEL;
  protected readonly title = 'Default price ₹1. Set a price in Test Master or Pricing.';
  protected readonly TAG_PATH = PRICE_TAG_PATH;
}

/** Stroked price-tag outline (24×24). */
export const PRICE_TAG_PATH =
  'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82z';

/** Same pill as a plain DOM node, for AG Grid cell renderers. */
export function priceFlagElement(compact = false): HTMLElement {
  const pill = document.createElement('span');
  pill.className = 'pf-price-flag';
  pill.setAttribute('role', 'note');
  pill.title = 'Default price ₹1. Set a price in Test Master or Pricing.';
  pill.innerHTML =
    '<svg class="pf-price-flag__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + `<path d="${PRICE_TAG_PATH}"/><circle cx="7.5" cy="7.5" r="1.25"/></svg>`;
  const text = document.createElement('span');
  text.textContent = compact ? 'not priced yet' : NOT_PRICED_LABEL;
  pill.appendChild(text);
  return pill;
}

/** "Not offered here" tag (grid rows / pricing rows), same family of pill. */
export function notOfferedElement(): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'pf-price-flag pf-price-flag--off';
  tag.innerHTML =
    '<svg class="pf-price-flag__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
  const text = document.createElement('span');
  text.textContent = 'Not offered here';
  tag.appendChild(text);
  return tag;
}
