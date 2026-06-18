import { ChangeDetectionStrategy, Component, Type, computed, effect, inject, input, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { PORTABLE_PANELS } from './portable-panels';

interface ResolvedPanel { type: string; label: string; cmp: Type<unknown>; }

/**
 * Renders the action-components the admin has DROPPED INTO this work-area but
 * that aren't native to it. Drop "Appointments" into the Lab work-area in
 * /admin/process and its panel appears on the Lab screen — "components come
 * where they're needed", without replacing the bespoke screen. Drag it back
 * out and the panel disappears. Generic: every registered portable action
 * works the same way, so this one host covers all of them.
 *
 * Usage: <pf-work-area-panels menu="lab" /> — `menu` is the work-area id this
 * screen represents (matches the workflow category id).
 */
@Component({
  selector: 'pf-work-area-panels',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of resolved(); track p.type) {
      <section class="wap">
        <header class="wap__hd">
          <span class="wap__dot"></span>{{ p.label }}
          <span class="wap__tag">moved here</span>
        </header>
        <ng-container *ngComponentOutlet="p.cmp" />
      </section>
    }
  `,
  styles: [`
    .wap { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg); margin: 0 0 16px; overflow: hidden; }
    .wap__hd { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--glass-border); font-size: 13px; font-weight: 700; color: var(--text-primary); }
    .wap__dot { width: 8px; height: 8px; border-radius: 50%; background: #7c3aed; flex-shrink: 0; }
    .wap__tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); border: 1px dashed var(--glass-border); border-radius: 999px; padding: 1px 7px; }
  `]
})
export class WorkAreaPanelsComponent {
  /** Work-area id this screen represents (matches the workflow category id). */
  readonly menu = input.required<string>();

  private readonly process = inject(ProcessWorkflowService);
  private readonly _resolved = signal<ResolvedPanel[]>([]);
  readonly resolved = this._resolved.asReadonly();

  // Portable actions placed in THIS work-area that aren't native to it.
  private readonly wanted = computed(() =>
    PORTABLE_PANELS.filter(p => p.native !== this.menu() && this.process.placedIn(p.type) === this.menu()));

  constructor() {
    this.process.loadActive();
    effect(() => {
      const want = this.wanted();
      if (want.length === 0) { this._resolved.set([]); return; }
      Promise.all(want.map(async p => ({ type: p.type, label: p.label, cmp: await p.load() })))
        .then(list => this._resolved.set(list))
        .catch(() => this._resolved.set([]));
    });
  }
}
