import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type PfButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'icon' | 'quiet';
export type PfButtonType = 'button' | 'submit' | 'reset';

/** Accessible native button styled with the shared new-design kit. */
@Component({
  selector: 'pf-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button [class]="buttonClasses()" [type]="type()" [disabled]="disabled()">
      <ng-content />
    </button>
  `,
  styles: [`
    :host { display: contents; }
    .pf-btn--full { width: 100%; }
  `],
})
export class PfButtonComponent {
  readonly variant = input<PfButtonVariant>('secondary');
  readonly type = input<PfButtonType>('button');
  readonly disabled = input(false);
  readonly fullWidth = input(false);

  readonly buttonClasses = computed(() => [
    'pf-btn inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50',
    `pf-btn--${this.variant()}`,
    this.fullWidth() ? 'pf-btn--full' : '',
  ].filter(Boolean).join(' '));
}
