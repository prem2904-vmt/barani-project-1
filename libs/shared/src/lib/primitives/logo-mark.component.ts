import { ChangeDetectionStrategy, Component, HostBinding, Input, computed, signal } from '@angular/core';

export type LogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type LogoVariant = 'badge' | 'glyph' | 'mono';

/**
 * Canonical Prefrontal brand mark. Always use this instead of reaching for
 * <img src="/logo.svg"> or reinventing the gradient pill — it keeps the glyph,
 * gradient, and proportions identical wherever the brand appears.
 *
 * Variants:
 *  • badge — glyph on the signature violet→pink gradient pill (default).
 *  • glyph — bare glyph filled with the brand gradient (use on own backgrounds).
 *  • mono  — glyph in a single color via currentColor (use on saturated fills).
 */
@Component({
  selector: 'pf-logo-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="root" [attr.aria-label]="ariaLabel ?? 'Prefrontal'" [class.is-pulse]="pulse">
      <span class="pill" [class.pill-badge]="variant === 'badge'">
        @if (pulse && variant === 'badge') {
          <span class="ring r1" aria-hidden="true"></span>
          <span class="ring r2" aria-hidden="true"></span>
        }
        <svg class="glyph" viewBox="0 0 228 292" [attr.width]="glyphPx()" [attr.height]="glyphPx()"
             [attr.fill]="variant === 'glyph' ? 'url(#' + gradientId() + ')' : glyphColor()"
             aria-hidden="true">
          @if (variant === 'glyph') {
            <defs>
              <linearGradient [attr.id]="gradientId()" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#7c3aed"/>
                <stop offset="50%"  stop-color="#a855f7"/>
                <stop offset="100%" stop-color="#ec4899"/>
              </linearGradient>
            </defs>
          }
          <path d="M0 131.126V292H30.1634C29.572 247.788 28.744 156.113 30.1634 143.106C31.5829 130.099 40.2179 118.861 44.358 114.867C79.8444 80.639 117.696 104.599 132.187 120.857V81.4947C125.799 74.649 101.136 70.0852 89.6031 68.659C39.9222 63.1824 9.16731 108.022 0 131.126Z"/>
          <path d="M99 204C76.2887 212.215 47.6109 193.023 38.1479 182.469V220.976C126.154 259.996 162.35 199.583 169.447 164.499H227.113V136.26L171.222 137.116V72.0819C177.609 35.1151 211.735 26.4439 228 26.7291V0.201972C161.463 -4.07659 142.833 60.9576 140.171 68.659C137.51 76.3604 141.058 161.932 136.623 172.2L136.585 172.287C132.16 182.532 127.31 193.76 99 204Z"/>
        </svg>
      </span>
      @if (withWordmark) {
        <span class="wordmark" [style.color]="wordmarkColor">Prefrontal</span>
      }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .root {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      line-height: 1;
    }

    .pill {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      line-height: 0;
    }
    .pill-badge {
      border-radius: 9999px;
      background: var(--gradient-primary);
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35);
      color: #ffffff;
    }

    /* Pulse ---------------------------------------------------
       Heartbeat on the glyph + outward-expanding rings + glow
       intensity cycle. Matches the resident-fe brand rhythm. */
    .glyph {
      position: relative;
      z-index: 2;
      transition: filter 0.3s ease;
    }
    .is-pulse .glyph {
      animation: pf-logo-heartbeat 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite,
                 pf-logo-glow      2.4s ease-in-out infinite;
    }
    .is-pulse .pill-badge {
      animation: pf-logo-badge-glow 2.4s ease-in-out infinite;
    }

    .ring {
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      border: 1.5px solid rgba(168, 85, 247, 0.55);
      pointer-events: none;
      z-index: 1;
    }
    .ring.r1 { animation: pf-ring-expand 2s ease-out infinite; }
    .ring.r2 { animation: pf-ring-expand 2s ease-out infinite 1s; border-color: rgba(236, 72, 153, 0.45); }

    @keyframes pf-logo-heartbeat {
      0%, 100% { transform: scale(1); }
      15%      { transform: scale(1.08); }
      25%      { transform: scale(0.97); }
      35%      { transform: scale(1.04); }
      50%      { transform: scale(1); }
    }

    @keyframes pf-logo-glow {
      0%, 100% { filter: drop-shadow(0 0 2px rgba(168, 85, 247, 0.5)); }
      50%      { filter: drop-shadow(0 0 6px rgba(236, 72, 153, 0.85))
                         drop-shadow(0 0 12px rgba(168, 85, 247, 0.45)); }
    }

    @keyframes pf-logo-badge-glow {
      0%, 100% { box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35); }
      50%      { box-shadow: 0 4px 18px rgba(124, 58, 237, 0.55),
                             0 0 28px rgba(236, 72, 153, 0.35); }
    }

    @keyframes pf-ring-expand {
      0%   { transform: scale(1);    opacity: 0.9; }
      100% { transform: scale(1.75); opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .is-pulse .glyph,
      .is-pulse .pill-badge,
      .ring { animation: none; }
      .ring { display: none; }
    }

    /* Size buckets apply to both the pill (square) and the glyph within. */
    :host([data-size='xs']) .pill { width: 24px; height: 24px; }
    :host([data-size='sm']) .pill { width: 32px; height: 32px; }
    :host([data-size='md']) .pill { width: 40px; height: 40px; }
    :host([data-size='lg']) .pill { width: 56px; height: 56px; }
    :host([data-size='xl']) .pill { width: 72px; height: 72px; }

    /* Glyph variant skips the pill background (glyph sits directly on surface). */
    :host([data-variant='glyph']) .pill { background: transparent; box-shadow: none; }
    :host([data-variant='mono'])  .pill { background: transparent; box-shadow: none; color: currentColor; }

    .wordmark {
      font-family: 'Noto Sans', 'Inter', system-ui, sans-serif;
      font-weight: 600;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }
    :host([data-size='xs']) .wordmark { font-size: 12px; }
    :host([data-size='sm']) .wordmark { font-size: 13px; }
    :host([data-size='md']) .wordmark { font-size: 15px; }
    :host([data-size='lg']) .wordmark { font-size: 18px; }
    :host([data-size='xl']) .wordmark { font-size: 22px; }
  `]
})
export class LogoMarkComponent {
  @Input() @HostBinding('attr.data-size') size: LogoSize = 'sm';
  @Input() @HostBinding('attr.data-variant') variant: LogoVariant = 'badge';
  @Input() withWordmark = false;
  @Input() wordmarkColor = 'var(--text-primary)';
  @Input() ariaLabel?: string;
  @Input() pulse = false;

  // Glyph renders at ~52% of the pill so it breathes inside the badge.
  private readonly _glyphScale: Record<LogoSize, number> = {
    xs: 13, sm: 17, md: 21, lg: 28, xl: 36
  };

  readonly glyphPx = computed(() => this._glyphScale[this.size]);

  // Unique id per instance so multiple glyph-variant marks on one page
  // don't collide on gradient defs.
  private readonly _uid = signal(`pf-lg-${Math.random().toString(36).slice(2, 9)}`);
  readonly gradientId = computed(() => this._uid());

  glyphColor(): string {
    return this.variant === 'mono' ? 'currentColor' : '#ffffff';
  }
}
