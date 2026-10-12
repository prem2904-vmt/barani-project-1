import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Screen header — navigation header with optional leading back chevron,
 * title, subtitle, and right-aligned actions cluster.
 */
@Component({
  selector: 'pf-screen-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .pf-hdr-back {
      width: 38px;
      height: 38px;
      margin-left: -8px;
      border-radius: 11px;
      color: var(--text-primary);
      background: transparent;
      border: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background .15s ease, transform .08s ease;
    }
    .pf-hdr-back:active {
      transform: scale(0.9);
      background: var(--glass-bg, rgba(255, 255, 255, 0.06));
    }
    @media (hover: hover) {
      .pf-hdr-back:hover { background: var(--glass-bg, rgba(255, 255, 255, 0.06)); }
    }
    :host-context(.design-new) h1,
    :host-context(.design-new) .pf-hdr-subtitle { display: none; }
  `],
  template: `
    <header class="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 md:gap-4 mb-2 md:mb-3">
      @if (showBack() && !noBack()) {
        <button
          type="button"
          class="pf-hdr-back shrink-0 inline-flex items-center justify-center"
          (click)="handleBack()"
          aria-label="Go back"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      }
      <div class="min-w-fit max-w-full flex-1">
        @if (title()) {
          <h1 class="text-xl md:text-2xl font-bold tracking-tight text-[var(--text-primary)]">{{ title() }}</h1>
        }
        @if (subtitle()) {
          <p class="pf-hdr-subtitle text-xs md:text-sm text-[var(--text-tertiary)] mt-0.5">{{ subtitle() }}</p>
        }
        <ng-content select="[header-content]"></ng-content>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <ng-content select="[header-actions]"></ng-content>
        <ng-content></ng-content>
      </div>
    </header>
  `
})
export class ScreenHeaderComponent {
  readonly title = input<string>('');
  readonly subtitle = input<string>('');
  readonly showBack = input<boolean>(false);
  readonly noBack = input<boolean>(false);

  readonly back = output<void>();

  protected handleBack(): void {
    this.back.emit();
    if (typeof window !== 'undefined' && window.history) {
      window.history.back();
    }
  }
}
