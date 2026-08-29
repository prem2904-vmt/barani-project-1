import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';

/**
 * OPD admin landing (/admin/opd). Tiles for the OPD configuration surfaces —
 * Doctors (per-doctor consultation fee) and OPD Settings (follow-up policy).
 */
@Component({
  selector: 'pf-opd-admin',
  standalone: true,
  imports: [RouterLink, ScreenHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <pf-screen-header class="px-4 md:px-8 pt-6"
        [eyebrow]="'Admin'" [title]="'OPD'" [subtitle]="'Outpatient department configuration'"
        parentRoute="/admin">
      </pf-screen-header>

      <div class="px-4 md:px-8 lg:px-10 max-w-screen-xl mx-auto w-full pf-opd__grid">
        <a routerLink="/admin/opd/doctors" class="pf-opd__tile press">
          <div class="pf-opd__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div>
            <h3 class="pf-opd__title">Doctors</h3>
            <p class="pf-opd__sub">Consultation fee per doctor, department &amp; specialisation.</p>
          </div>
        </a>

        <a routerLink="/admin/opd/settings" class="pf-opd__tile press">
          <div class="pf-opd__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
          <div>
            <h3 class="pf-opd__title">OPD Settings</h3>
            <p class="pf-opd__sub">Follow-up policy (tiered discounts on repeat visits).</p>
          </div>
        </a>
      </div>
    </section>
  `,
  styles: [`
    .pf-opd__grid { margin-top: 14px; display: grid; gap: 14px;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .pf-opd__tile { display: flex; gap: 14px; align-items: flex-start; padding: 18px;
      border-radius: 16px; text-decoration: none; color: inherit;
      background: var(--glass-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); transition: border-color .15s, background .15s; }
    .pf-opd__tile:hover { border-color: color-mix(in srgb, var(--brand, #a855f7) 45%, transparent);
      background: color-mix(in srgb, var(--brand, #a855f7) 6%, transparent); }
    .pf-opd__icon { width: 44px; height: 44px; flex: 0 0 auto; border-radius: 12px;
      display: flex; align-items: center; justify-content: center; color: var(--brand, #a855f7);
      background: color-mix(in srgb, var(--brand, #a855f7) 14%, transparent); }
    .pf-opd__title { font-size: 15px; font-weight: 700; color: var(--text-primary, #e2e8f0); }
    .pf-opd__sub { font-size: 13px; color: var(--text-tertiary, #64748b); margin-top: 2px; }
  `],
})
export class OpdAdminComponent {}
