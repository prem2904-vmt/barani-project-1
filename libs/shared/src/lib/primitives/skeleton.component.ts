import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

export type SkeletonVariant = 'line' | 'block' | 'circle' | 'pill';

/**
 * The one skeleton primitive (the skeleton KIT in skeleton-kit.component.ts
 * composes it into rows, tables, cards, detail panes, forms and tiles).
 *
 * Neutral placeholder with ONE shimmer sweep shared by every block on the
 * page (the gradient is viewport-anchored, so neighbouring bars light up
 * together instead of each running its own band). Light + dark from the
 * theme class on <html>; prefers-reduced-motion = static fill, no sweep.
 * Never used alone as a loading state: wrap it in a kit preset (or give the
 * region aria-busy + a polite live label yourself).
 */
@Component({
  selector: 'pf-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'pf-skel' },
  template: ``,
  styles: [`
    :host {
      --pf-skel-base: rgba(255, 255, 255, 0.07);
      --pf-skel-shine: rgba(255, 255, 255, 0.13);
      display: block;
      position: relative;
      flex: none;
      max-width: 100%;
      border-radius: 10px;
      background-color: var(--pf-skel-base);
      background-image: linear-gradient(
        90deg,
        transparent 0%,
        transparent 38%,
        var(--pf-skel-shine) 50%,
        transparent 62%,
        transparent 100%
      );
      background-size: 200vw 100%;
      background-repeat: no-repeat;
      background-attachment: fixed;
      animation: pf-skel-sweep 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    :host-context(.light) {
      --pf-skel-base: rgba(15, 23, 42, 0.07);
      --pf-skel-shine: rgba(255, 255, 255, 0.75);
    }

    :host([data-variant='line'])   { height: 12px; border-radius: 6px; }
    :host([data-variant='block'])  { height: 48px; border-radius: 12px; }
    :host([data-variant='circle']) { border-radius: 9999px; aspect-ratio: 1; }
    :host([data-variant='pill'])   { height: 28px; border-radius: 9999px; }

    @keyframes pf-skel-sweep {
      from { background-position: -100vw 0; }
      to   { background-position: 100vw 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      :host { animation: none; background-image: none; }
    }
  `]
})
export class SkeletonComponent {
  @Input() @HostBinding('attr.data-variant') variant: SkeletonVariant = 'line';

  @Input()
  @HostBinding('style.width')
  width?: string;

  @Input()
  @HostBinding('style.height')
  height?: string;
}
