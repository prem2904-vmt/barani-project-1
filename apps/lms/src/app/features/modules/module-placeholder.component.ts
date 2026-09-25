import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../core/services/theme.service';
import { MODULE_CATALOG, ModuleDef, moduleDef } from '../../core/modules/module-catalog';

/**
 * Shared placeholder shell for modules that are entitled but not yet built (OPD,
 * IPD, Pharmacy, Payroll). Route supplies `data: { moduleId }`; we render the
 * module's planned features from the catalog so the nav → route → screen wiring
 * is proven end-to-end now, and each screen fills in as its module ships.
 */
@Component({
  selector: 'pf-module-placeholder',
  standalone: true,
  imports: [ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mod(); as m) {
      <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
        @if (theme.isNewDesign()) {
          <!-- Same band as every step (owner). Nothing to search: the pill is
               the context bar — which module this is + its status. -->
          <pf-hero-band [back]="true" [customSearch]="true" [contextBar]="true">
            <div band-search class="nd-ctx pf-phm-ctx">
              <span class="nd-ctx__primary">{{ m.label }}</span>
              <span class="nd-ctx__chip"><span class="nd-ctx__k">Status</span>Coming soon</span>
              <span class="nd-ctx__chip"><span class="nd-ctx__k">Features</span><span class="nd-num">{{ m.features.length }}</span></span>
            </div>
          </pf-hero-band>
        }
        <pf-screen-header class="pf-classic-only" [eyebrow]="'Module'" [title]="m.label" [subtitle]="m.blurb"></pf-screen-header>

        <div class="pf-band-body">
        <div class="pf-ph nd-card">
          <span class="nd-card__icon pf-ph__glyph">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path [attr.d]="m.iconPath"></path>
            </svg>
          </span>
          <h2 class="pf-ph__title">{{ m.label }} is coming soon</h2>
          <p class="pf-ph__sub">
            {{ m.blurb }} This module is enabled for your organization. Its screens are being built —
            here's what it will include.
          </p>

          <div class="pf-ph__feats">
            @for (f of m.features; track f.key) {
              <div class="nd-row pf-ph__feat">
                <span class="pf-ph__dot" aria-hidden="true"></span>
                <span class="nd-row__name pf-ph__feat-label">{{ f.label }}</span>
              </div>
            }
          </div>
        </div>
        </div>
      </section>
    }
  `,
  styles: [`
    .pf-ph {
      max-width: 620px; margin: 8px auto 0; text-align: center;
      align-items: center; gap: 10px; padding: 36px 24px; overflow: visible;
    }
    .pf-ph__glyph { width: 64px; height: 64px; border-radius: 18px; margin-bottom: 4px; }
    .pf-ph__title { margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary); }
    .pf-ph__sub { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--text-secondary); max-width: 460px; text-wrap: pretty; }
    .pf-ph__feats {
      margin-top: 14px; width: 100%; display: grid; gap: 8px;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    }
    .pf-ph__feat { min-height: 44px; text-align: left; }
    .pf-ph__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--nd-sel-border); flex-shrink: 0; }
  `],
})
export class ModulePlaceholderComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly theme = inject(ThemeService);
  private readonly _id = signal<string>(this.route.snapshot.data['moduleId'] ?? '');
  readonly mod = computed<ModuleDef | undefined>(() => moduleDef(this._id()) ?? MODULE_CATALOG[0]);
}
