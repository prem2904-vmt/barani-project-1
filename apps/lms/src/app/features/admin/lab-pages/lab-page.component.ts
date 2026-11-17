import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Signal, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
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
 * A Lab settings page in the Settings shell (Test Master's frame, DESIGN-V2): the shell owns the band and the card;
 * this renders the page's rows. A ONE-card page (owner 2026-11-17) shows every category as a small uppercase group
 * (`pf-setting-group [id]` / pf-lab-settings `[groups]`); `?tab=` (a deep link, a search hit) scrolls to that group.
 * A page with its own Save puts it in `[page-actions]` — the shell's band shows it.
 */
@Component({
  selector: 'pf-lab-page',
  standalone: true,
  imports: [HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page" [attr.data-lab-page]="page().path">
      <pf-hero-band [back]="true" [tabsOnly]="true">
        <ng-container band-actions><ng-content select="[page-actions]"></ng-content></ng-container>
      </pf-hero-band>
      <div class="pf-band-body">
        <div class="pf-lp__col pf-sgrid" [attr.data-lab-tab]="tab()">
          <ng-content></ng-content>
        </div>
      </div>
    </section>
  `,
  styles: [`:host { display: block; width: 100%; }`],
})
export class LabPageComponent {
  readonly page = input.required<LabPageDef>();
  readonly tab = input.required<string>();
  /** Kept for callers; the shell's card head names the page now. */
  readonly subtitle = input('');
  readonly tabChange = output<string>();
  private readonly el = inject(ElementRef<HTMLElement>);
  constructor() {
    // A category named in the URL (not the first): bring its group into view once it has rendered.
    effect(() => {
      const t = this.tab();
      if (!t || t === this.page().categories[0]?.id) return;
      setTimeout(() => {
        const g = (this.el.nativeElement as HTMLElement).querySelector(`[data-group="${t}"]`);
        (g as HTMLElement | null)?.scrollIntoView?.({ block: 'start' });
      }, 250);
    });
  }
}
