import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { filterSettingsTiles } from '../../../shared/utils/settings-search';
import { settingsKeywordsFor } from '../../../shared/utils/settings-catalog';
import { AuthService } from '../../../core/auth/auth.service';
import { canOpenRoute } from '../../../core/auth/route-access';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { LAB_SETTINGS_TILES, LabSettingsTile } from '../../../shared/utils/settings-tiles';


/**
 * Lab module settings hub. Everything lab-SPECIFIC lives here inside the Lab
 * world — tests/catalog, report layout, lab settings, referral network,
 * notifications and KPIs — instead of the global admin (which now holds only
 * platform/org concerns). Each future module (OPD, IPD, Pharmacy) ships its own
 * equivalent hub, so no module's config ever pollutes another's or the org admin.
 */
@Component({
  selector: 'pf-lab-settings-hub',
  standalone: true,
  imports: [RouterLink, ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the hub's search filters its tiles — the ONE
             precise matcher over each tile's title + the settings on its page
             (never the subtitle); Enter opens the top tile. -->
        <pf-hero-band [back]="true" placeholder="Search lab settings — tests, report, email, referral, KPIs…"
                      [value]="q()" (valueChange)="q.set($event)" (submitted)="openTop()"></pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Lab"
        title="Lab Settings"
        subtitle="Everything specific to your lab — catalog, report layout, lab settings, referrals, alerts.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-lsh">
        @for (t of visibleTiles(); track t.href) {
          <a [routerLink]="t.href" class="pf-lsh__tile pf-card press">
            <span class="pf-card__icon pf-lsh__ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path [attr.d]="t.iconPath"></path>
              </svg>
            </span>
            <span class="pf-lsh__text">
              <span class="pf-lsh__t">{{ t.title }}</span>
              <span class="pf-lsh__s">{{ t.subtitle }}</span>
            </span>
            <svg class="pf-lsh__chev" width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6"></path>
            </svg>
          </a>
        }
      </div>
      @if (!visibleTiles().length) {
        <p class="pf-band-empty">No settings match “{{ q() }}”.</p>
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-lsh {
      display: grid; gap: 14px; margin-top: 8px;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    }
    .pf-lsh__tile {
      gap: 4px; padding: 18px; text-decoration: none; overflow: visible;
      transition: border-color var(--pf-dur-fast) ease, transform 100ms ease;
    }
    .pf-lsh__tile:hover { border-color: var(--pf-sel-border); }
    .pf-lsh__tile:active { transform: scale(.99); }
    .pf-lsh__tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .pf-lsh__tile { transition: none; } .pf-lsh__tile:active { transform: none; } }
    .pf-lsh__ic { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 6px; }
    .pf-lsh__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-lsh__t { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-lsh__s { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-lsh__chev { display: none; color: var(--text-muted, #94a3b8); flex-shrink: 0; }

    /* Phones: drop the 2-up tile grid to a single-column LIST — icon left,
       text beside it, chevron right. Reads as a settings list, not cards. */
    @media (max-width: 640px) {
      .pf-lsh { grid-template-columns: 1fr; gap: 8px; }
      .pf-lsh__tile { flex-direction: row; align-items: center; gap: 14px; padding: 13px 14px; }
      .pf-lsh__ic { width: 36px; height: 36px; margin-bottom: 0; }
      .pf-lsh__text { flex: 1; }
      .pf-lsh__s { font-size: 12px; }
      .pf-lsh__chev { display: block; }
    }
  `],
})
export class LabSettingsHubComponent {
  protected readonly theme = inject(ThemeService);
  /** Band pill search over the tiles (title + subtitle). */
  readonly q = signal('');
  private readonly auth = inject(AuthService);
  /** Home collection off (entitlement OR workflow — the ONE lab-feature rule)
   *  ⇒ its agents tile is gone too, like its route. */
  private readonly features = inject(LabFeaturesService);
  private readonly beta = inject(BetaFeaturesService);
  /** Only tiles whose destination the user can open (the same ROUTE_ACCESS
   *  table the guards use): a Lab Admin (Technical) sees Tests, Report
   *  Template, Referral Labs, Lab settings and Microbiology — never a tile that
   *  lands on /403 (Referring Network, Notifications, KPI cards…) — and never a
   *  tile for a lab feature that is switched off. */
  readonly openableTiles = computed(() => {
    const featureOn = (t: LabSettingsTile) => (t.feature !== 'homeCollection' || this.features.homeCollectionEnabled())
      && (!t.beta || this.beta.enabled(t.beta));
    // hasAnyPermission reads the session signal, so this re-evaluates on change.
    if (typeof this.auth?.hasAnyPermission !== 'function') return this.tiles.filter(featureOn);
    const ctx = { hasAny: (p: string[]) => this.auth.hasAnyPermission(p) };
    return this.tiles.filter(t => featureOn(t) && canOpenRoute(t.href, ctx));
  });
  readonly visibleTiles = computed(() =>
    filterSettingsTiles(this.openableTiles(), this.q(), (t) => t.title, (t) => settingsKeywordsFor(t.href)));
  private readonly router = inject(Router);
  /** Enter in the band search opens the top tile. */
  openTop(): void {
    const top = this.q().trim() ? this.visibleTiles()[0] : undefined;
    if (top) void this.router.navigateByUrl(top.href);
  }

  readonly tiles: LabSettingsTile[] = LAB_SETTINGS_TILES;

}
