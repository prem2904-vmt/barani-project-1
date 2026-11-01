import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { filterSettingsTiles } from '../../../shared/utils/settings-search';
import { settingsKeywordsFor } from '../../../shared/utils/settings-catalog';
import { AuthService } from '../../../core/auth/auth.service';
import { canOpenRoute } from '../../../core/auth/route-access';

interface PartnerTile {
  title: string;
  href: string;
  subtitle: string;
  iconPath: string;
}

/**
 * Partners hub — one landing that combines the three "external party" admin
 * screens that used to be scattered: Referral Labs (outsourced/external labs),
 * Vendor Wallets (B2B credit accounts) and the Referring Network (hospitals +
 * doctors that send patients). Each tile links to its existing dedicated page;
 * those pages are unchanged — this is purely a combined entry point so referral
 * labs and vendors "all display here". Tile-hub pattern mirrors the Lab hub.
 */
@Component({
  selector: 'pf-partners',
  standalone: true,
  imports: [RouterLink, ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the hub's search filters its tiles. -->
        <pf-hero-band [back]="true" placeholder="Search referral labs, vendors, referring network…"
                      [value]="q()" (valueChange)="q.set($event)" (submitted)="openTop()"></pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Referral & Vendors"
        subtitle="Your outside parties in one place — referral labs, vendor credit accounts and the referring network.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-ph">
        @for (t of visibleTiles(); track t.href) {
          <a [routerLink]="t.href" class="pf-ph__tile pf-card press">
            <span class="pf-card__icon pf-ph__ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path [attr.d]="t.iconPath"></path>
              </svg>
            </span>
            <span class="pf-ph__text">
              <span class="pf-ph__t">{{ t.title }}</span>
              <span class="pf-ph__s">{{ t.subtitle }}</span>
            </span>
            <svg class="pf-ph__chev" width="18" height="18" viewBox="0 0 24 24" fill="none"
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
    .pf-ph {
      display: grid; gap: 14px; margin-top: 8px;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    }
    .pf-ph__tile {
      gap: 4px; padding: 18px; text-decoration: none; overflow: visible;
      transition: border-color var(--pf-dur-fast) ease, transform 100ms ease;
    }
    .pf-ph__tile:hover { border-color: var(--pf-sel-border); }
    .pf-ph__tile:active { transform: scale(.99); }
    .pf-ph__tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .pf-ph__tile { transition: none; } .pf-ph__tile:active { transform: none; } }
    .pf-ph__ic { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 6px; }
    .pf-ph__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-ph__t { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ph__s { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-ph__chev { display: none; color: var(--text-muted, #94a3b8); flex-shrink: 0; }

    /* Phones: drop the 2-up tile grid to a single-column LIST — icon left,
       text beside it, chevron right. Reads as a settings list, not cards. */
    @media (max-width: 640px) {
      .pf-ph { grid-template-columns: 1fr; gap: 8px; }
      .pf-ph__tile { flex-direction: row; align-items: center; gap: 14px; padding: 13px 14px; }
      .pf-ph__ic { width: 36px; height: 36px; margin-bottom: 0; }
      .pf-ph__text { flex: 1; }
      .pf-ph__s { font-size: 12px; }
      .pf-ph__chev { display: block; }
    }
  `],
})
export class PartnersComponent {
  protected readonly theme = inject(ThemeService);
  /** Band pill search over the tiles — the ONE precise matcher (title +
   *  the page's keywords, never the subtitle). */
  readonly q = signal('');
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Only tiles whose page this person can open (the same ROUTE_ACCESS the
   *  guards use) — a Lab Admin (Technical) sees Referral Labs + Partner
   *  Prices, never a tile that lands on /403. */
  readonly openableTiles = computed(() => {
    if (typeof this.auth?.hasAnyPermission !== 'function') return this.tiles.slice();
    const ctx = { hasAny: (p: string[]) => this.auth.hasAnyPermission(p) };
    return this.tiles.filter((t) => canOpenRoute(t.href, ctx));
  });
  readonly visibleTiles = computed(() =>
    filterSettingsTiles(this.openableTiles(), this.q(), (t) => t.title, (t) => settingsKeywordsFor(t.href)));
  /** Enter in the band search opens the top tile. */
  openTop(): void {
    const top = this.q().trim() ? this.visibleTiles()[0] : undefined;
    if (top) void this.router.navigateByUrl(top.href);
  }

  readonly tiles: PartnerTile[] = [
    { title: 'Referral Labs', href: '/admin/referral-labs',
      subtitle: 'Outsourced / external labs you send tests to',
      iconPath: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9' },
    { title: 'Partner Prices', href: '/admin/partner-prices',
      subtitle: 'What each referral lab charges per test — feeds Insights\' outsourcing margin',
      iconPath: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
    { title: 'Vendor Wallets', href: '/admin/vendors',
      subtitle: 'B2B credit accounts · top-ups & usage',
      iconPath: 'M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7H5a2 2 0 0 1-2-2ZM17 14h.01' },
    { title: 'Referring Network', href: '/admin/referring-network',
      subtitle: 'Hospitals + doctors that send patients to your lab',
      iconPath: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01' },
  ];
}
