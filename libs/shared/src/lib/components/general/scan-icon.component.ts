import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The ONE scan glyph (owner). Frontdesk's QR mark is the source of truth:
 * before this, frontdesk, lab intake, my work, collect, patient search and
 * the ABHA wizard each drew a different scanner. Everything that means
 * "point the camera / read a code" renders this component so the icon can
 * never drift apart again.
 */
@Component({
  selector: 'pf-scan-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" [attr.stroke-width]="weight()"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; justify-content: center; }
  `],
})
export class ScanIconComponent {
  readonly size = input(18);
  readonly weight = input(1.9);
}
