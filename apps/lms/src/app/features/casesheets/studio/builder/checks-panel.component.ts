import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { BuilderStatusService } from './builder-status.service';
import { CheckView, SOURCE_LABEL, summaryLine } from './builder-models';
import { ChecksStore } from './checks.store';

/** The option checks: "if this option is picked, this shows". The server plays them; failures only warn. */
@Component({
  selector: 'st-checks-panel',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ck-top">
      @if (summary(); as s) {
        <p class="ck-sum" data-summary [attr.data-failing]="s.failed > 0 ? 'true' : null">{{ line() }}</p>
      } @else if (store.busy()) {
        <p class="ck-sum" role="status">Looking at the checks…</p>
      } @else {
        <p class="ck-sum">No checks yet. Run them to see what each option does.</p>
      }
      <div class="ck-acts">
        <button type="button" class="pf-btn pf-btn--secondary" data-act="run-all" [disabled]="!!store.busy()" [attr.aria-busy]="store.busy() === 'run' ? 'true' : null" (click)="store.run()">
          {{ store.busy() === 'run' ? 'Running…' : 'Run all' }}
        </button>
        @if (status.cortex()) {
          <button type="button" class="pf-btn pf-btn--secondary" data-act="suggest" [disabled]="!!store.busy()" [attr.aria-busy]="store.busy() === 'suggest' ? 'true' : null" (click)="store.suggest()">
            <pf-icon name="sparkle" [size]="16" /> {{ store.busy() === 'suggest' ? 'Cortex is thinking…' : 'Ask Cortex for more checks' }}
          </button>
        }
      </div>
    </div>
    @if (store.error(); as err) {
      <p class="ck-err" role="alert" data-error>{{ err }}</p>
    }
    <ul class="ck-list" data-checks role="list">
      @for (c of store.checks(); track c.id) {
        <li class="ck-item" [attr.data-check]="c.id" [attr.data-state]="state(c)">
          <div class="ck-head">
            <span class="ck-mark" [attr.data-state]="state(c)" aria-hidden="true">
              @if (state(c) === 'pass') { <pf-icon name="check" [size]="14" /> } @else if (state(c) === 'fail') { <pf-icon name="x" [size]="14" /> }
            </span>
            <span class="ck-title">{{ c.title }}</span>
            <span class="ck-state" [attr.data-state]="state(c)">{{ stateWords(c) }}</span>
          </div>
          @if (c.given.length) {
            <p class="ck-row"><span class="ck-k">Given</span> <span data-given>{{ c.given.join(' · ') }}</span></p>
          }
          @if (c.expect.length) {
            <p class="ck-row"><span class="ck-k">Expect</span> <span data-expect>{{ c.expect.join(' · ') }}</span></p>
          }
          @if (c.result && !c.result.pass && c.result.failures.length) {
            <ul class="ck-fail" data-failures>
              @for (f of c.result.failures; track $index) { <li>{{ f }}</li> }
            </ul>
          }
          <div class="ck-foot">
            <span class="ck-src" [attr.data-source]="c.source">{{ sourceLabel(c) }}</span>
            @if (c.source !== 'auto') {
              <button type="button" class="pf-btn pf-btn--tertiary ck-rm" data-act="remove" [attr.aria-label]="'Remove the check ' + c.title" (click)="store.remove(c)">Remove</button>
            }
          </div>
        </li>
      } @empty {
        @if (!store.busy() && summary()) {
          <li class="ck-none">This form has nothing to check yet. Add options that open follow-ups or pages.</li>
        }
      }
    </ul>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; }
    .ck-top { display: grid; gap: 8px; flex: none; }
    .ck-sum { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .ck-sum[data-failing] { color: var(--red-text, #b91c1c); }
    .ck-acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .ck-err { margin: 0; font-size: 13px; color: var(--red-text, #b91c1c); }
    .ck-list { list-style: none; margin: 0; padding: 2px; flex: 1; min-height: 0; overflow-y: auto; display: grid; gap: 8px; align-content: start; }
    .ck-none { font-size: 13.5px; color: var(--text-secondary); padding: 8px 4px; }
    .ck-item { padding: 10px 12px; border: 1px solid var(--pf-line); border-radius: 12px; background: var(--pf-card-bg); display: grid; gap: 5px; min-width: 0; }
    .ck-item[data-state='fail'] { border-color: color-mix(in srgb, var(--red-text, #b91c1c) 40%, transparent); }
    .ck-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .ck-mark { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--text-tertiary); color: #fff; margin-top: 1px; }
    .ck-mark[data-state='pass'] { background: var(--green-text, #15803d); border-color: var(--green-text, #15803d); }
    .ck-mark[data-state='fail'] { background: var(--red-text, #b91c1c); border-color: var(--red-text, #b91c1c); }
    .ck-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: break-word; }
    .ck-state { flex: none; font-size: 12px; font-weight: 600; color: var(--text-tertiary); }
    .ck-state[data-state='pass'] { color: var(--green-text, #15803d); }
    .ck-state[data-state='fail'] { color: var(--red-text, #b91c1c); }
    .ck-row { margin: 0; font-size: 13px; color: var(--text-secondary); overflow-wrap: break-word; }
    .ck-k { display: inline-block; min-width: 44px; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--text-tertiary); }
    .ck-fail { margin: 0; padding-left: 18px; font-size: 13px; color: var(--red-text, #b91c1c); }
    .ck-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ck-src { font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--pf-line); color: var(--text-secondary); background: var(--pf-chip-bg, transparent); }
    .ck-src[data-source='cortex'] { color: var(--accent-primary, #7c5cff); }
    .ck-rm { min-height: 32px; }
  `],
})
export class ChecksPanelComponent {
  protected readonly store = inject(ChecksStore);
  protected readonly status = inject(BuilderStatusService);
  protected readonly summary = this.store.summary;
  protected readonly line = computed(() => {
    const s = this.summary();
    return s ? summaryLine(s) : '';
  });

  protected state(c: CheckView): 'pass' | 'fail' | 'new' {
    return !c.result ? 'new' : c.result.pass ? 'pass' : 'fail';
  }
  protected stateWords(c: CheckView): string {
    return { pass: 'Passes', fail: 'Fails', new: 'Not run yet' }[this.state(c)];
  }
  protected sourceLabel(c: CheckView): string {
    return SOURCE_LABEL[c.source];
  }
}
