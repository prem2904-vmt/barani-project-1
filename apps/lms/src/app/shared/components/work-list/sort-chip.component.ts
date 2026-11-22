import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, output } from '@angular/core';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, PfAction } from '../actions-menu/actions-menu.component';
import { SortChipOption, sortChipText } from './work-list';

/**
 * `<pf-sort-chip>` — a list's sort (owner 2026-11-21): a small pf-styled chip "Sort: Due ↓" that opens the shared
 * menu (popover on tablets, bottom sheet on phones) with the same sort choices the grid headers give. Never a native
 * or browser-like dropdown. 44px tall on every size.
 */
@Component({
  selector: 'pf-sort-chip',
  standalone: true,
  imports: [ActionsMenuComponent, ActionsMenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'pf-sortchip-host' },
  template: `
    <pf-actions-menu [actions]="actions()" [checkCurrent]="true" heading="Sort" label="Sort this list" [width]="240" (action)="pick.emit($event)">
      <button pfActionsTrigger type="button" class="pf-sortchip press" data-testid="sort-chip">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>
        </svg>
        <span class="pf-sortchip__t">{{ text() }}</span>
      </button>
    </pf-actions-menu>
  `,
  styles: [`
    .pf-sortchip-host { display: inline-flex; flex: none; }
    .pf-sortchip {
      display: inline-flex; align-items: center; gap: 6px; height: 44px; min-height: 44px; padding: 0 12px;
      border-radius: 999px; border: 1px solid var(--pf-line, var(--glass-border)); background: var(--pf-chip-bg, transparent);
      color: var(--text-secondary); font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer;
    }
    .pf-sortchip:hover { color: var(--text-primary); }
    .pf-sortchip:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
  `],
})
export class SortChipComponent {
  readonly options = input<SortChipOption[]>([]);
  readonly value = input<string | null>(null);
  readonly pick = output<string>();
  protected readonly text = computed(() => sortChipText(this.options(), this.value()));
  protected readonly actions = computed<PfAction[]>(() => this.options().map(o => ({ id: o.id, label: o.label, current: o.id === this.value() })));
}
