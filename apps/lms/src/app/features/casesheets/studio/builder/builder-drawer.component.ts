import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SegmentedComponent, SegmentedOption } from '@prefrontal/shared';
import { BuilderStatusService } from './builder-status.service';
import { ChecksPanelComponent } from './checks-panel.component';
import { ChecksStore } from './checks.store';
import { CortexChatComponent } from './cortex-chat.component';

export type BuilderTab = 'cortex' | 'checks';

/**
 * One drawer for the two builder tools, so "What it writes" and the question card keep their places: Cortex (the chat) and
 * Checks. A side panel on a computer, a bottom sheet on a phone (clear of the bottom nav). The backdrop closes it, and so does Esc (the editor's own handler).
 */
@Component({
  selector: 'st-builder-drawer',
  standalone: true,
  imports: [PfIconComponent, SegmentedComponent, CortexChatComponent, ChecksPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bd-backdrop" aria-hidden="true" (click)="closed.emit()"></div>
    <aside class="pf-card bd" role="dialog" aria-modal="false" aria-labelledby="bd-h" data-builder-drawer>
      <header class="pf-card__head bd-head">
        <span class="pf-card__icon"><pf-icon [name]="tab() === 'cortex' ? 'sparkle' : 'check'" [size]="16" /></span>
        <h2 class="pf-card__label" id="bd-h">{{ tab() === 'cortex' ? 'Cortex' : 'Checks' }}</h2>
        @if (tabs().length > 1) {
          <pf-segmented class="bd-tabs" ariaLabel="Show" [options]="tabs()" [value]="tab()" (valueChange)="tabChange.emit($event)" />
        }
        <button type="button" class="pf-btn pf-btn--icon bd-x" aria-label="Close" data-act="close-builder" (click)="closed.emit()"><pf-icon name="x" [size]="20" /></button>
      </header>
      <div class="pf-card__body bd-body">
        @if (tab() === 'cortex' && status.cortex()) {
          <st-cortex-chat />
        } @else {
          <st-checks-panel />
        }
      </div>
    </aside>
  `,
  styles: [`
    :host { display: contents; }
    /* Desktop: below the band (Preview / Publish stay reachable) and above the bottom nav. */
    .bd { position: fixed; z-index: 40; top: var(--pf-band-clear, 132px); right: 12px; bottom: calc(var(--pf-nav-h, 88px) + 8px); width: min(420px, calc(100vw - 24px)); display: flex; flex-direction: column;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22); }
    .bd-head { flex: none; flex-wrap: nowrap; gap: 8px; }
    @media (max-width: 640px) { .bd-head .pf-card__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
    .bd-tabs { margin-left: auto; }
    .bd-x { margin-left: 4px; }
    .bd-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .bd-backdrop { display: none; }
    @media (max-width: 1023px) {
      .bd-backdrop { display: block; position: fixed; inset: 0; z-index: 39; background: rgba(15, 23, 42, 0.35); }
      .bd { top: auto; left: 12px; right: 12px; width: auto; bottom: calc(var(--pf-nav-h, 88px) + 8px);
        height: min(calc(100dvh - var(--pf-nav-h, 88px) - 96px), 640px); animation: bd-rise var(--pf-dur-sheet, 360ms) var(--pf-spring, ease-out) both; }
    }
    @keyframes bd-rise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .bd { animation: none; } }
  `],
})
export class BuilderDrawerComponent {
  protected readonly status = inject(BuilderStatusService);
  private readonly checks = inject(ChecksStore);
  readonly tab = input.required<BuilderTab>();
  readonly tabChange = output<BuilderTab>();
  readonly closed = output<void>();

  protected readonly tabs = computed<SegmentedOption<BuilderTab>[]>(() => [
    ...(this.status.cortex() ? [{ value: 'cortex' as const, label: 'Cortex' }] : []),
    { value: 'checks' as const, label: 'Checks', count: this.checks.failing() || null, warn: this.checks.failing() > 0 },
  ]);
}
