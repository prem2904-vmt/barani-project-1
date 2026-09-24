import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ORIGIN_ICON_PATHS, originHint, originLabel, originOf, TestOrigin } from '../utils/test-origin';

/**
 * The ONE "where does this test come from" chip (Test Master single source):
 * Master / Customised / Branch / Own test. Quiet on purpose: a small tinted
 * pill with a stroked SVG glyph, shown in the Test Master grid and the test
 * editor header. Renders nothing for a row without an origin (older payloads).
 *
 * Styles live in the global stylesheet (`.pf-origin-badge`) so the AG Grid
 * cell (built with {@link originBadgeElement}) renders the identical pill.
 *
 *   <pf-origin-badge [origin]="test.origin" [catalogMode]="test.catalogMode" />
 */
@Component({
  selector: 'pf-origin-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (kind(); as k) {
      <span [class]="'pf-origin-badge pf-origin-badge--' + k"
            role="note" [attr.title]="hint()" [attr.aria-label]="label() + '. ' + hint()">
        <svg class="pf-origin-badge__icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path [attr.d]="icon()" />
        </svg>
        <span>{{ label() }}</span>
      </span>
    }
  `,
  styles: [`:host { display: inline-flex; vertical-align: middle; }`],
})
export class OriginBadgeComponent {
  readonly origin = input<string | null | undefined>(null);
  /** 'clone' switches to "your copy" wording (see test-origin.ts). */
  readonly catalogMode = input<string | null | undefined>(null);
  protected readonly kind = computed<TestOrigin | null>(() => originOf({ origin: this.origin() }));
  protected readonly label = computed(() => originLabel({ origin: this.origin(), catalogMode: this.catalogMode() }));
  protected readonly hint = computed(() => originHint({ origin: this.origin(), catalogMode: this.catalogMode() }));
  protected readonly icon = computed(() => {
    const k = this.kind();
    return k ? ORIGIN_ICON_PATHS[k] : '';
  });
}

/** Same pill as a plain DOM node, for AG Grid cell renderers. Returns an
 *  empty span for a row without an origin. */
export function originBadgeElement(origin: string | null | undefined, catalogMode?: string | null): HTMLElement {
  const k = originOf({ origin });
  const pill = document.createElement('span');
  if (!k) return pill;
  pill.className = `pf-origin-badge pf-origin-badge--${k}`;
  pill.setAttribute('role', 'note');
  pill.title = originHint({ origin, catalogMode });
  pill.innerHTML =
    '<svg class="pf-origin-badge__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + `<path d="${ORIGIN_ICON_PATHS[k]}"/></svg>`;
  const text = document.createElement('span');
  text.textContent = originLabel({ origin, catalogMode });
  pill.appendChild(text);
  return pill;
}
