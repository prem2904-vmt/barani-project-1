import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { AuthService } from '../../../core/auth/auth.service';
import { canOpenRoute } from '../../../core/auth/route-access';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { BetaFeatureKey, BetaFeaturesService } from '../../../core/services/beta-features.service';

interface LabTile {
  title: string;
  href: string;
  subtitle: string;
  iconPath: string;
  /** Shown only while this lab feature is on (core/modules/lab-features). */
  feature?: 'homeCollection';
  /** BETA surface: listed only while BetaFeaturesService says so (pf.<key>() + server flag + dev). */
  beta?: BetaFeatureKey;
}

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
        <!-- Band pill (owner): the hub's search filters its tiles. -->
        <pf-hero-band [back]="true" placeholder="Search lab settings — tests, report, referral, KPIs…"
                      [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
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
        <p class="pf-band-empty">No lab settings match "{{ q() }}".</p>
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
    const featureOn = (t: LabTile) => (t.feature !== 'homeCollection' || this.features.homeCollectionEnabled())
      && (!t.beta || this.beta.enabled(t.beta));
    // hasAnyPermission reads the session signal, so this re-evaluates on change.
    if (typeof this.auth?.hasAnyPermission !== 'function') return this.tiles.filter(featureOn);
    const ctx = { hasAny: (p: string[]) => this.auth.hasAnyPermission(p) };
    return this.tiles.filter(t => featureOn(t) && canOpenRoute(t.href, ctx));
  });
  readonly visibleTiles = computed(() => bandFilter(this.openableTiles(), this.q(), (t) => [t.title, t.subtitle]));

  readonly tiles: LabTile[] = [
    { title: 'Tests & Packages', href: '/admin/tests',
      subtitle: 'Tests, parameters, reference ranges, packages',
      iconPath: 'M11 4h3v9M11 13h3M11 4v9c-4-1-4-7 0-9ZM14 7h2a3 3 0 0 1 3 3M6 21h14M9 17h8' },
    { title: 'Report Template', href: '/admin/reports',
      subtitle: 'Branding, header, columns, signatures, colours',
      iconPath: 'M4 4h11l5 5v11H4zM15 4v5h5M8 14h8M8 18h6' },
    { title: 'Referral Labs', href: '/admin/referral-labs',
      subtitle: 'Outsourced / external labs',
      iconPath: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9' },
    { title: 'Lab settings', href: '/admin/lab-settings',
      subtitle: 'Sample finding, queues, payment and validation rules',
      iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3ZM8 12h8' },
    { title: 'Microbiology / Culture', href: '/admin/microbiology',
      subtitle: 'Culture bench: stage lock timeout, takeover, per-stage TAT',
      iconPath: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M14 17h.01' },
    { title: 'Instruments', href: '/admin/instruments',
      subtitle: 'Analyzers (CBC first): connection, protocol, code mapping, pairing',
      iconPath: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2' },
    { title: 'Bridges', href: '/admin/bridges',
      subtitle: 'Prefrontal Bridges: add, Wi-Fi, analyzers they connect',
      iconPath: 'M5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2ZM7 16.5h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0' },
    { title: 'AI connectors', href: '/admin/ai-connectors', beta: 'mcp',
      subtitle: 'Let AI apps like Claude read your lab’s numbers',
      iconPath: 'M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8' },
    { title: 'Referring Network', href: '/admin/referring-network',
      subtitle: 'Hospitals + doctors that send patients to your lab',
      iconPath: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01' },
    { title: 'Home-collection agents', href: '/admin/home-collection', feature: 'homeCollection',
      subtitle: 'Agents · coverage areas · weightage',
      iconPath: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6' },
    { title: 'Notifications', href: '/admin/notifications',
      subtitle: 'In-app alerts and overdue warnings',
      iconPath: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM11 20a1 1 0 0 0 2 0' },
    { title: 'KPI cards', href: '/admin/kpis',
      subtitle: 'Pick which KPIs show on each lab screen',
      iconPath: 'M3 12h4l3-9 4 18 3-9h4' },
  ];
}
