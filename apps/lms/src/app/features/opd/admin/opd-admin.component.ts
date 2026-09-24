import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';

interface OpdTile {
  title: string;
  href: string;
  subtitle: string;
  iconPath: string;
}

/**
 * OPD module settings hub (/admin/opd). Mirrors the Lab Settings hub so the
 * theme carries across modules — Doctors (per-doctor consultation fee) and OPD
 * Settings (follow-up policy). Each future module ships its own equivalent hub.
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
        <pf-hero-band [back]="true" placeholder="Search OPD settings — doctors, fees, follow-up…"
                      [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="OPD"
        title="OPD Settings"
        subtitle="Outpatient department configuration — doctors, consultation fees and follow-up policy.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-lsh">
        @for (t of visibleTiles(); track t.href) {
          <a [routerLink]="t.href" class="pf-lsh__tile press">
            <span class="pf-lsh__ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path [attr.d]="t.iconPath"></path>
              </svg>
            </span>
            <span class="pf-lsh__text">
              <span class="pf-lsh__t">{{ t.title }}</span>
              <span class="pf-lsh__s">{{ t.subtitle }}</span>
            </span>
            <svg class="pf-lsh__chev" width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
      display: flex; flex-direction: column; gap: 4px;
      padding: 18px; border-radius: 16px; text-decoration: none;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      background: var(--bg-card, rgba(255,255,255,0.03));
      transition: border-color .15s, transform .1s, background .15s;
    }
    .pf-lsh__tile:hover { border-color: rgba(168,85,247,.4); background: rgba(255,255,255,0.05); }
    .pf-lsh__tile:active { transform: scale(.99); }
    .pf-lsh__ic {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: 11px; margin-bottom: 6px; flex-shrink: 0;
      color: var(--violet-text); background: rgba(168,85,247,.14); border: 1px solid rgba(168,85,247,.22);
    }
    .pf-lsh__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-lsh__t { font-size: 15px; font-weight: 650; color: var(--text-primary, #f8fafc); }
    .pf-lsh__s { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary, #cbd5e1); }
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

  readonly tiles: OpdTile[] = [
    { title: 'Doctors', href: '/admin/opd/doctors',
      subtitle: 'Consultation fee per doctor, department & specialisation',
      iconPath: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
    { title: 'OPD Settings', href: '/admin/opd/settings',
      subtitle: 'Follow-up policy — tiered discounts on repeat visits',
      iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 5 4.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.83 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.91 9H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' },
  ];
}
