import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * Foundation placeholder for an OPD screen that a feature agent has not built
 * yet (OPD dark build). Same band + card language as the module placeholder so
 * a routed-but-empty screen still looks like the app. Feature agents REPLACE
 * the page component that uses this; nothing else depends on it.
 */
@Component({
  selector: 'pf-opd-stub-page',
  standalone: true,
  imports: [ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [customSearch]="true" [contextBar]="true">
          <div band-search class="pf-ctx">
            <span class="pf-ctx__primary">{{ title() }}</span>
            <span class="pf-ctx__chip"><span class="pf-ctx__k">OPD</span>Being built</span>
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="OPD" [title]="title()" [subtitle]="subtitle()"></pf-screen-header>
      <div class="pf-band-body">
        <div class="pf-opd-stub pf-card">
          <h2 class="pf-opd-stub__t">{{ title() }}</h2>
          <p class="pf-opd-stub__s">{{ subtitle() }}</p>
          @if (plan().length) {
            <div class="pf-opd-stub__plan">
              @for (p of plan(); track p) {
                <div class="pf-row pf-opd-stub__row">
                  <span class="pf-opd-stub__dot" aria-hidden="true"></span>
                  <span class="pf-row__name">{{ p }}</span>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-opd-stub { max-width: 640px; margin: 8px auto 0; gap: 10px; padding: 28px 24px; overflow: visible; }
    .pf-opd-stub__t { margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary); }
    .pf-opd-stub__s { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--text-secondary); }
    .pf-opd-stub__plan { margin-top: 10px; display: grid; gap: 8px; }
    .pf-opd-stub__row { min-height: 44px; }
    .pf-opd-stub__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pf-sel-border); flex-shrink: 0; }
  `],
})
export class OpdStubPageComponent {
  protected readonly theme = inject(ThemeService);
  readonly title = input.required<string>();
  readonly subtitle = input<string>('This OPD screen is being built.');
  readonly plan = input<string[]>([]);
}
