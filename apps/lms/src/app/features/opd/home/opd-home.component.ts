import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { AuthService } from '../../../core/auth/auth.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { opdAreasFor, orderOpdAreas } from '../shared/opd-nav';

/**
 * OPD home (/opd) — the OPD section's hub, owned by the FOUNDATION (OPD dark
 * build). Tiles = OPD_AREAS filtered by permission; same tile language as the
 * Lab settings hub. Reached from More → OPD, only when the OPD gate is open.
 */
@Component({
  selector: 'pf-opd-home',
  standalone: true,
  imports: [RouterLink, ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search OPD — desk, queue, vitals, consults, pharmacy…"
                      [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="OPD" title="Outpatient"
        subtitle="Front desk, vitals, token queue, consults and pharmacy."></pf-screen-header>
      <div class="pf-band-body">
        <div class="pf-opdh">
          @for (t of tiles(); track t.id) {
            <a [routerLink]="t.href" class="pf-opdh__tile nd-card press">
              <span class="nd-card__icon pf-opdh__ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="t.iconPath"></path>
                </svg>
              </span>
              <span class="pf-opdh__text">
                <span class="pf-opdh__t">{{ t.title }}</span>
                <span class="pf-opdh__s">{{ t.subtitle }}</span>
              </span>
              <svg class="pf-opdh__chev" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6"></path>
              </svg>
            </a>
          }
        </div>
        @if (!tiles().length) { <p class="pf-band-empty">Nothing matches "{{ q() }}".</p> }
      </div>
    </section>
  `,
  styles: [`
    .pf-opdh { display: grid; gap: 14px; margin-top: 8px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .pf-opdh__tile { gap: 4px; padding: 18px; text-decoration: none; overflow: visible;
      transition: border-color var(--nd-dur-fast) ease, transform 100ms ease; }
    .pf-opdh__tile:hover { border-color: var(--nd-sel-border); }
    .pf-opdh__tile:active { transform: scale(.99); }
    .pf-opdh__tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .pf-opdh__tile { transition: none; } .pf-opdh__tile:active { transform: none; } }
    .pf-opdh__ic { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 6px; }
    .pf-opdh__text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-opdh__t { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-opdh__s { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-opdh__chev { display: none; color: var(--text-muted, #94a3b8); flex-shrink: 0; }
    @media (max-width: 640px) {
      .pf-opdh { grid-template-columns: 1fr; gap: 8px; }
      .pf-opdh__tile { flex-direction: row; align-items: center; gap: 14px; padding: 13px 14px; }
      .pf-opdh__ic { width: 36px; height: 36px; margin-bottom: 0; }
      .pf-opdh__text { flex: 1; }
      .pf-opdh__s { font-size: 12px; }
      .pf-opdh__chev { display: block; }
    }
  `],
})
export class OpdHomeComponent {
  protected readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  readonly q = signal('');
  private readonly allowed = computed(() => {
    this.auth.user(); // re-evaluate when the profile loads
    return opdAreasFor(p => this.auth.hasAnyPermission(p));
  });
  /** Doctors see Consults first — their main reason to be in OPD. */
  private readonly ordered = computed(() => orderOpdAreas(this.allowed(), this.auth.isDoctor()));
  readonly tiles = computed(() => bandFilter(this.ordered(), this.q(), a => [a.title, a.subtitle]));
}
