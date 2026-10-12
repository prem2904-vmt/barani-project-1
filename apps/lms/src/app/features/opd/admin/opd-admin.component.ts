import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { OpdAdminApi } from './opd-admin.api';

interface OpdTile {
  title: string;
  href: string;
  subtitle: string;
  iconPath: string;
}

/**
 * OPD module settings hub (/admin/opd, Agent A). Mirrors the Lab Settings hub
 * (lab-settings-hub tile pattern) so the theme carries across modules: OPD
 * Master, Doctors, Consultation forms, Workflow, the follow-up policy, and
 * links to the pharmacy's drug master / settings (Agent D). Opening it asks
 * the server for the tenant's lazy starter set (once).
 */
@Component({
  selector: 'pf-opd-admin',
  standalone: true,
  imports: [RouterLink, ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the hub's search filters its tiles. -->
        <pf-hero-band [back]="true" placeholder="Search OPD settings — services, doctors, forms, workflow…"
                      [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="OPD"
        title="OPD Settings"
        subtitle="Set up the clinic — services and prices, doctors, consultation forms and the visit flow.">
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
        <p class="pf-band-empty">No OPD settings match "{{ q() }}".</p>
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
    .pf-lsh__tile:hover { border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3)); }
    .pf-lsh__tile:active { transform: scale(.99); }
    .pf-lsh__tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .pf-lsh__tile { transition: none; } .pf-lsh__tile:active { transform: none; } }
    .pf-lsh__ic { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 6px; }
    .pf-lsh__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-lsh__t { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-lsh__s { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-lsh__chev { display: none; color: var(--text-muted, #94a3b8); flex-shrink: 0; }

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
export class OpdAdminComponent {
  protected readonly theme = inject(ThemeService);
  /** Band pill search over the tiles (title + subtitle). */
  readonly q = signal('');
  readonly visibleTiles = computed(() => bandFilter(this.tiles, this.q(), (t) => [t.title, t.subtitle]));

  constructor() {
    // First open of OPD settings: the tenant's starter set (once, server-side).
    inject(OpdAdminApi).ensureStarter().subscribe();
  }

  /** Set-up tiles (owner mockup "Settings → OPD & pharmacy · set up"). Pharmacy
   *  settings and the drug master are Agent D's screens — linked only. */
  readonly tiles: OpdTile[] = [
    { title: 'OPD Master', href: '/admin/opd/departments',
      subtitle: 'Departments, consultation and procedure services, per-doctor or common prices, follow-up rule',
      iconPath: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
    { title: 'Doctors', href: '/admin/opd/doctors',
      subtitle: 'Fee per service, room, token prefix and the days each doctor sits',
      iconPath: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
    { title: 'Consultation forms', href: '/admin/opd/forms',
      subtitle: "One shared library, edited right on the doctor's own screen — vitals, diagnosis and prescription are built in",
      iconPath: 'M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1ZM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5' },
    { title: 'OPD workflow', href: '/admin/opd/workflow',
      subtitle: 'Steps, stations, who does what, when the patient pays, tokens and who reads notes',
      iconPath: 'M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM19 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5 7v4a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4' },
    { title: 'Follow-up policy', href: '/admin/opd/settings',
      subtitle: 'Clinic-wide follow-up discounts for services without their own follow-up rule',
      iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 5 4.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.83 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.91 9H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' },
    { title: 'Drug master & stock', href: '/admin/opd/drugs',
      subtitle: 'Generic, brand, schedule, HSN / GST, MRP — batches and expiry per branch',
      iconPath: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7' },
    { title: 'Pharmacy settings', href: '/admin/opd/pharmacy',
      subtitle: 'Batch picking, walk-in bills and Schedule H / H1 / X checks',
      iconPath: 'M3 9h18l-2 11H5L3 9ZM8 9V6a4 4 0 0 1 8 0v3' },
  ];
}
