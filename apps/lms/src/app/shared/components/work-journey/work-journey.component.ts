import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { JourneyStep } from '../../utils/work-grid';

/**
 * The work grids' Journey cell (My Work, Pathologist) — today's progress representation: one small bar per real
 * workflow step (done · now · late in rose · still to come). ISOLATED on purpose: the shared journey ring (being built
 * for Frontdesk) replaces this ONE element in each grid's journey template — swap `<pf-work-journey [steps]>` for the
 * ring and nothing else changes.
 */
@Component({
  selector: 'pf-work-journey',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steps().length) {
      <span class="wj" role="img" [attr.aria-label]="aria()">
        @for (s of steps(); track $index) { <span class="wj__step" [attr.data-state]="s.state" [attr.title]="s.label"></span> }
      </span>
    } @else { <span class="wj__none">—</span> }`,
  styles: [`
    :host { display: inline-flex; align-items: center; }
    .wj { display: inline-flex; align-items: center; gap: 4px; }
    .wj__step { width: 16px; height: 6px; border-radius: 999px; background: var(--pf-line); }
    .wj__step[data-state='done'] { background: color-mix(in srgb, var(--violet-text) 55%, var(--pf-line)); }
    .wj__step[data-state='now'] { background: var(--violet-text); box-shadow: 0 0 0 2px color-mix(in srgb, var(--violet-text) 22%, transparent); }
    .wj__step[data-state='late'] { background: var(--red-text); box-shadow: 0 0 0 2px color-mix(in srgb, var(--red-text) 22%, transparent); }
    .wj__none { color: var(--text-tertiary); }
  `],
})
export class WorkJourneyComponent {
  readonly steps = input<readonly JourneyStep[]>([]);
  readonly aria = computed(() => {
    const s = this.steps();
    const at = s.find(x => x.state === 'now' || x.state === 'late');
    const done = s.filter(x => x.state === 'done').length;
    return at ? `${at.label}${at.state === 'late' ? ' (late)' : ''} — step ${done + 1} of ${s.length}` : `${done} of ${s.length} steps done`;
  });
}
