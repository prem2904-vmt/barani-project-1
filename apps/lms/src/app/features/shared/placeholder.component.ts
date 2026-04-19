import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'pf-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-3xl">
      <div class="pf-card">
        <h1 class="text-xl font-semibold text-slate-900">{{ title() }}</h1>
        <p class="mt-2 text-sm text-slate-600">{{ description() }}</p>
        <p class="mt-4 text-xs text-slate-400">Screen shell in place · full UI ships in the next stage.</p>
      </div>
    </section>
  `
})
export class PlaceholderComponent {
  readonly title = input<string>('Coming soon');
  readonly description = input<string>('This screen is next up on the build list.');
}
