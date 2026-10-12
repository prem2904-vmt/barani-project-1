import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type LoadingSize = 'micro' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type LoadingColor = 'purple' | 'emerald' | 'white';

@Component({
  selector: 'pf-loading-logo',
  standalone: true,
  templateUrl: './loading-logo.component.html',
  styleUrl: './loading-logo.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoadingLogoComponent {
  @Input() size: LoadingSize = 'md';
  @Input() color: LoadingColor = 'purple';
  @Input() showText = false;
  @Input() text = 'Loading…';
  @Input() showDna = false;
  @Input() inline = false;
  @Input() horizontal = false;

  /** Unique id so multiple instances on the same page don't collide on SVG defs. */
  readonly uniqueId = Math.random().toString(36).substring(2, 9);
}
