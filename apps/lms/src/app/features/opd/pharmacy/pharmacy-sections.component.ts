import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export type PharmacySection = 'dispense' | 'counter' | 'stock' | 'purchases' | 'suppliers' | 'returns' | 'h1';

/** The pharmacy's sections, in counter order (routes are wired in opd.routes.ts). */
export const PHARMACY_SECTIONS: readonly { key: PharmacySection; label: string; path: string }[] = [
  { key: 'dispense', label: 'Prescriptions', path: '/opd/pharmacy' },
  { key: 'counter', label: 'Counter', path: '/opd/pharmacy/counter' },
  { key: 'stock', label: 'Stock', path: '/opd/pharmacy/stock' },
  { key: 'purchases', label: 'Purchases', path: '/opd/pharmacy/purchase-orders' },
  { key: 'suppliers', label: 'Suppliers', path: '/opd/pharmacy/suppliers' },
  { key: 'returns', label: 'Returns', path: '/opd/pharmacy/returns' },
  { key: 'h1', label: 'H1 register', path: '/opd/pharmacy/h1-register' },
];

/**
 * The pharmacy section switch — a neutral nd-kit segmented control of links,
 * projected into the band pill's tools slot (ND §1: the pill is the context
 * bar). The current section is the raised neutral segment (aria-current),
 * never violet. Scrolls sideways on narrow screens.
 */
@Component({
  selector: 'pf-pharmacy-sections',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="nd-seg ph-sec" aria-label="Pharmacy sections">
      @for (s of sections; track s.key) {
        <a class="nd-seg__item ph-sec__item" [routerLink]="s.path"
           [attr.aria-current]="s.key === active() ? 'page' : null"
           [attr.aria-pressed]="s.key === active()">{{ s.label }}</a>
      }
    </nav>
  `,
  styles: [`
    :host { display: block; min-width: 0; max-width: 100%; }
    .ph-sec { max-width: 100%; overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap; }
    .ph-sec::-webkit-scrollbar { display: none; }
    .ph-sec__item { display: inline-flex; align-items: center; white-space: nowrap; text-decoration: none; }
    @media (max-width: 640px) { .ph-sec__item { height: 40px; } }
  `],
})
export class PharmacySectionsComponent {
  readonly active = input.required<PharmacySection>();
  protected readonly sections = PHARMACY_SECTIONS;
}
