import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { PfSenseService } from '../../core/services/pf-sense.service';

/**
 * The band's sparkle button that opens the assistant panel. Renders NOTHING
 * unless the `assistant` beta is on (BetaFeaturesService) AND the admin has
 * PF Sense switched on for this `feature` (PfSenseService) — two gates, both required.
 * Quiet ghost band button; the label is a bare text node so the band turns it
 * icon-only on phones (same trick as Refresh).
 */
@Component({
  selector: 'pf-assistant-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <button type="button" class="pf-hb-btn pf-hb-btn--ghost press pf-asst-btn" (click)="pressed.emit()"
              [attr.aria-expanded]="expanded()"
              aria-label="Ask Cortex (beta)" title="Ask Cortex (beta)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3.5 12.9 8.6 18 10.5 12.9 12.4 11 17.5 9.1 12.4 4 10.5 9.1 8.6Z"/><path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7Z"/></svg>
        {{ label() }}
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-asst-btn svg { color: var(--color-violet-600, #7c3aed); }
    :host-context(.dark) .pf-asst-btn svg, :host-context([data-theme='dark']) .pf-asst-btn svg { color: var(--violet-text, #c4b5fd); }
  `],
})
export class AssistantButtonComponent {
  private readonly beta = inject(BetaFeaturesService);
  private readonly sense = inject(PfSenseService);
  readonly feature = input<'instruments_assistant' | 'insights_assistant'>('instruments_assistant');
  readonly label = input('Ask Cortex');
  readonly expanded = input(false);
  readonly pressed = output<void>();
  readonly visible = computed(() => this.beta.enabled('assistant') && this.sense.shown(this.feature()));

  constructor() { void this.beta.ensureLoaded(); void this.sense.ensureLoaded(); }
}
