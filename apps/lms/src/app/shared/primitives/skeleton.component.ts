import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

export type SkeletonVariant = 'line' | 'block' | 'circle';

@Component({
  selector: 'pf-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
  styles: [`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
    }
    :host::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(168, 85, 247, 0.12) 50%,
        transparent 100%
      );
      animation: pf-shimmer 1.6s ease-in-out infinite;
      transform: translateX(-100%);
    }

    :host([data-variant='line'])   { height: 14px; border-radius: 7px; }
    :host([data-variant='block'])  { height: 48px; border-radius: 14px; }
    :host([data-variant='circle']) { border-radius: 9999px; }

    @keyframes pf-shimmer {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    @media (prefers-reduced-motion: reduce) {
      :host::after { animation: none; }
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
