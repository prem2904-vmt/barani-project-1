import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * Foundation placeholder for a case-sheet screen a later work package fills (WP0-ui). Same band + card language as
 * the OPD stub, so a routed-but-empty screen still looks like the app. The route's `data.title` / `data.subtitle`
 * bind to the inputs (withComponentInputBinding). WP5 / WP6 / WP7 replace the `loadComponent` of each route in
 * casesheets.routes.ts with the real page; nothing else depends on this.
 */
@Component({
  selector: 'pf-casesheet-placeholder',
  standalone: true,
  imports: [ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [customSearch]="true" [contextBar]="true">
          <div band-search class="pf-ctx">
            <span class="pf-ctx__primary">{{ title() }}</span>
            <span class="pf-ctx__chip"><span class="pf-ctx__k">Case sheets</span>Being built</span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Case sheets" [title]="title()" [subtitle]="subtitle()"></pf-screen-header>
      <div class="pf-band-body">
        <div class="pf-cs-stub pf-card">
          <h2 class="pf-cs-stub__t">{{ title() }}</h2>
          <p class="pf-cs-stub__s">{{ subtitle() }}</p>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-cs-stub { max-width: 640px; margin: 8px auto 0; gap: 10px; padding: 28px 24px; overflow: visible; }
    .pf-cs-stub__t { margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary); }
    .pf-cs-stub__s { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--text-secondary); }
  `],
})
export class CasesheetPlaceholderPage {
  protected readonly theme = inject(ThemeService);
  readonly title = input<string>('Case sheets');
  readonly subtitle = input<string>('This case-sheet screen is being built.');
}
