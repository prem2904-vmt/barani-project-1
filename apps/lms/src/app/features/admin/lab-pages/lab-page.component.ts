import { ChangeDetectionStrategy, Component, DestroyRef, Signal, computed, inject, input, output, signal } from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { LabPageDef, resolveLabTab } from '../../../shared/utils/lab-settings-pages';

/**
 * The open category of a Lab page, kept in the URL (`?tab=`, replacing the
 * history entry) so a reload, a shared link, a settings-search hit and the
 * Settings shell's left panel all land on the same category.
 */
export function labPageTab(page: LabPageDef): { tab: Signal<string>; pick: (id: string) => void } {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const destroyRef = inject(DestroyRef);
  const q = toSignal(route.queryParamMap, { initialValue: route.snapshot.queryParamMap });
  const picked = signal<string | null>(null);
  route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => picked.set(null));
  const tab = computed(() => resolveLabTab(page, picked() ?? q().get('tab')));
  return {
    tab,
    pick: (id: string) => {
      picked.set(id);
      void router.navigate([], { relativeTo: route, queryParams: { tab: id }, queryParamsHandling: 'merge', replaceUrl: true });
    },
  };
}

/**
 * Shell of a card-based Lab settings page: the new-design band (back chevron +
 * the page's categories as a tabs-only pill) over the open category's cards.
 * Pages made of an existing full screen (appointments, referring network,
 * alerts, numbers, agents) render that screen directly instead — it brings its
 * own band — so a category is either cards here or a whole screen.
 */
@Component({
  selector: 'pf-lab-page',
  standalone: true,
  imports: [HeroBandComponent, ScreenHeaderComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10" [attr.data-lab-page]="page().path">
      <pf-hero-band [back]="true" [tabsOnly]="true">
        @if (options().length > 1) {
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="options()" [value]="tab()"
                          (valueChange)="tabChange.emit($event)"></pf-segmented>
          </ng-container>
        }
      </pf-hero-band>
      <pf-screen-header class="pf-classic-only" eyebrow="Lab" [title]="page().title" [subtitle]="subtitle()"></pf-screen-header>
      <div class="pf-band-body">
        @if (options().length > 1) {
          <div class="pf-classic-only pf-lp__tabs">
            <pf-segmented size="sm" [options]="options()" [value]="tab()" (valueChange)="tabChange.emit($event)"></pf-segmented>
          </div>
        }
        <div class="pf-lp__col" [attr.data-lab-tab]="tab()">
          <ng-content></ng-content>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .pf-lp__tabs { margin: 0 0 16px; overflow-x: auto; }
    .pf-lp__col { max-width: 56rem; }
  `],
})
export class LabPageComponent {
  readonly page = input.required<LabPageDef>();
  readonly tab = input.required<string>();
  readonly subtitle = input('');
  readonly tabChange = output<string>();
  protected readonly options = computed<SegmentedOption<string>[]>(() =>
    this.page().categories.map(c => ({ value: c.id, label: c.label })));
}
