import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';

interface LabTile {
  title: string;
  href: string;
  subtitle: string;
  iconPath: string;
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
  imports: [RouterLink, ScreenHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Lab"
        title="Lab Settings"
        subtitle="Everything specific to your lab — catalog, report layout, lab settings, referrals, alerts.">
      </pf-screen-header>

      <div class="pf-lsh">
        @for (t of tiles; track t.href) {
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
      color: #c4b5fd; background: rgba(168,85,247,.14); border: 1px solid rgba(168,85,247,.22);
    }
    .pf-lsh__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-lsh__t { font-size: 15px; font-weight: 650; color: var(--text-primary, #f8fafc); }
    .pf-lsh__s { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary, #cbd5e1); }
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
      subtitle: 'Collection mode, billing mode, patient ID format',
      iconPath: 'M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3ZM8 12h8' },
    { title: 'Referring Network', href: '/admin/referring-network',
      subtitle: 'Hospitals + doctors that send patients to your lab',
      iconPath: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01' },
    { title: 'Home-collection agents', href: '/admin/home-collection',
      subtitle: 'Agents · coverage areas · weightage',
      iconPath: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6' },
    { title: 'Notifications', href: '/admin/notifications',
      subtitle: 'Alerts, escalations, patient messages',
      iconPath: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM11 20a1 1 0 0 0 2 0' },
    { title: 'KPI cards', href: '/admin/kpis',
      subtitle: 'Pick which KPIs show on each lab screen',
      iconPath: 'M3 12h4l3-9 4 18 3-9h4' },
  ];
}
