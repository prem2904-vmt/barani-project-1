import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { ModulePlaceholderComponent } from '../../modules/module-placeholder.component';
import { casesheetLinks } from '../casesheets.routes';
import { CASESHEET_FORMS_MANAGE } from '../shared/casesheet-permissions';
import { CasesheetGateService } from '../shared/casesheet-gate.service';

interface IpdTile {
  title: string;
  subtitle: string;
  iconPath: string;
  /** Absent = a "coming soon" tile (not a link). */
  href?: string;
}

/**
 * Admin > IPD (/admin/ipd). Gate closed (or no `casesheet_forms_manage`): exactly the module "coming soon" page it
 * always was. Gate open: a settings hub in the lab-settings-hub tile pattern - a MyPrefrontal tile (case sheet form
 * authoring, grouped by department) and the IPD "coming soon" tile for the rest of the module.
 */
@Component({
  selector: 'pf-ipd-hub',
  standalone: true,
  imports: [RouterLink, ScreenHeaderComponent, HeroBandComponent, ModulePlaceholderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showHub()) {
      <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
        @if (theme.isNewDesign()) {
          <pf-hero-band [back]="true" placeholder="Search IPD settings" [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
        }
        <pf-screen-header class="pf-classic-only" eyebrow="IPD" title="IPD settings"
          subtitle="Case sheet forms for your doctors, and the rest of inpatient care as it arrives."></pf-screen-header>

        <div class="pf-band-body">
          <div class="pf-lsh" data-hub="ipd">
            @for (t of visibleTiles(); track t.title) {
              @if (t.href) {
                <a [routerLink]="t.href" class="pf-lsh__tile pf-card press" [attr.data-tile]="t.title">
                  <span class="pf-card__icon pf-lsh__ic">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="t.iconPath"></path></svg>
                  </span>
                  <span class="pf-lsh__text">
                    <span class="pf-lsh__t">{{ t.title }}</span>
                    <span class="pf-lsh__s">{{ t.subtitle }}</span>
                  </span>
                  <svg class="pf-lsh__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
                </a>
              } @else {
                <div class="pf-lsh__tile pf-card pf-lsh__tile--soon" [attr.data-tile]="t.title" aria-disabled="true">
                  <span class="pf-card__icon pf-lsh__ic">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="t.iconPath"></path></svg>
                  </span>
                  <span class="pf-lsh__text">
                    <span class="pf-lsh__t">{{ t.title }} <span class="pf-lsh__soon">Coming soon</span></span>
                    <span class="pf-lsh__s">{{ t.subtitle }}</span>
                  </span>
                </div>
              }
            }
          </div>
          @if (!visibleTiles().length) {
            <p class="pf-band-empty">No IPD settings match "{{ q() }}".</p>
          }
        </div>
      </section>
    } @else {
      <pf-module-placeholder />
    }
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
    a.pf-lsh__tile:hover { border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3)); }
    a.pf-lsh__tile:active { transform: scale(.99); }
    a.pf-lsh__tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-lsh__tile--soon { opacity: .78; }
    @media (prefers-reduced-motion: reduce) { .pf-lsh__tile { transition: none; } a.pf-lsh__tile:active { transform: none; } }
    .pf-lsh__ic { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 6px; }
    .pf-lsh__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-lsh__t { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-lsh__s { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-lsh__soon { margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--text-secondary); background: color-mix(in srgb, var(--text-tertiary) 16%, transparent); }
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
export class IpdHubComponent {
  protected readonly theme = inject(ThemeService);
  private readonly gate = inject(CasesheetGateService);
  private readonly auth = inject(AuthService);

  readonly q = signal('');

  /** The hub needs the gate open AND the permission; otherwise the page is the module placeholder it always was. */
  readonly showHub = computed(() => this.gate.visible() && this.auth.hasPermission(CASESHEET_FORMS_MANAGE));

  /** MyPrefrontal first, then the IPD "coming soon" tile. */
  readonly tiles: IpdTile[] = [
    { title: 'MyPrefrontal', href: casesheetLinks.adminHome(),
      subtitle: 'Case sheet forms for your doctors, grouped by department. Start from a master form or build your own.',
      iconPath: 'M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1ZM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5' },
    { title: 'IPD',
      subtitle: 'Admissions, beds and wards, nursing, discharge.',
      iconPath: 'M3 7v12M3 13h18v6M21 19v-4a3 3 0 0 0-3-3h-7v4M7 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' },
  ];
  readonly visibleTiles = computed(() => bandFilter(this.tiles, this.q(), (t) => [t.title, t.subtitle]));
}
