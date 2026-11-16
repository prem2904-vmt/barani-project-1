import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * "Not offered here" tag for a test this tenant / branch doesn't offer
 * (Test Master grid rows). A plain DOM node so AG Grid cell renderers can
 * use it; styles live in the global stylesheet (`.pf-price-flag--off`).
 */
export function notOfferedElement(): HTMLElement {
  return flagElement('Not offered here');
}

/** "Inactive" tag for a Test Master row whose Active/Inactive switch is off */
export function inactiveElement(): HTMLElement {
  const tag = flagElement('Inactive');
  tag.classList.add('pf-price-flag--inactive');
  return tag;
}

function flagElement(label: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'pf-price-flag pf-price-flag--off';
  tag.innerHTML =
    '<svg class="pf-price-flag__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
  const text = document.createElement('span');
  text.textContent = label;
  tag.appendChild(text);
  return tag;
}

/**
 * Angular component wrapper for template usage.
 */
@Component({
  selector: 'pf-price-flag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="'pf-price-flag pf-price-flag--off' + (kind() === 'inactive' ? ' pf-price-flag--inactive' : '')" role="status">
      <svg class="pf-price-flag__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/>
        <path d="M5.6 5.6l12.8 12.8"/>
      </svg>
      <span>{{ label() }}</span>
    </span>
  `,
  styles: [`:host { display: inline-flex; vertical-align: middle; }`],
})
export class PriceFlagComponent {
  readonly kind = input<'not-offered' | 'inactive'>('not-offered');
  protected readonly label = computed(() => (this.kind() === 'inactive' ? 'Inactive' : 'Not offered here'));
}
