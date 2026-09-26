import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { NavBackService } from '../../core/services/nav-back.service';
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { searchAdmin, visibleCategories } from './admin-catalog';
import { AdminAccessService, AdminDirectoryComponent, AdminSearchResultsComponent } from './admin-directory.component';

/**
 * Settings hub (/admin/manage). Same list as the Admin home (ND-PATTERN
 * "Admin pages"): every category card with its pages one tap away — no
 * category pill to pick first. `?cat=` (old deep links, the hub's back
 * target) scrolls to and highlights that category. The band pill searches
 * pages AND single settings.
 */
@Component({
  selector: 'pf-admin-dashboard',
  standalone: true,
  imports: [HeroBandComponent, AdminDirectoryComponent, AdminSearchResultsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-admin-page pf-band-page">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search settings — try barcode, GST, users"
                      [value]="q()" (valueChange)="setQ($event)"></pf-hero-band>
      }
      <header class="pf-admin-hdr pf-classic-only">
        <button type="button" class="pf-hdr-back" (click)="navBack.back()" aria-label="Back to Admin">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <h1 class="pf-admin-hdr__title">Settings</h1>
        <input class="pf-admin-search" type="search" [value]="q()"
               (input)="setQ($any($event.target).value)"
               placeholder="Search settings — try barcode, GST, users"
               aria-label="Search settings and pages" />
      </header>

      <div class="pf-band-body">
        @if (q().trim()) {
          <pf-admin-search-results [hits]="results()" [query]="q().trim()"></pf-admin-search-results>
        } @else {
          <pf-admin-directory [categories]="cats()" [focus]="focusCat()"></pf-admin-directory>
        }
      </div>
    </section>
  `,
  styles: [`
    .pf-admin-page { padding: 20px 24px; }
    @media (max-width: 768px) { .pf-admin-page { padding: 14px; } }
    :host-context(html.cap-native) .pf-admin-page { padding-top: calc(14px + env(safe-area-inset-top)); }
    .pf-admin-hdr { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin: 8px 0 16px; }
    .pf-admin-hdr__title { margin: 0; flex: 1 1 auto; font-size: 22px; font-weight: 700; color: var(--text-primary); }
    .pf-hdr-back { display: inline-grid; place-items: center; width: 44px; height: 44px; margin-left: -8px; border: 0; border-radius: 11px; background: transparent; color: var(--text-primary); cursor: pointer; }
    .pf-hdr-back:focus-visible, .pf-admin-search:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-admin-search { width: 100%; max-width: 420px; padding: 9px 14px; border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 13.5px; }
    @media (max-width: 640px) { .pf-admin-search { max-width: 100%; font-size: 16px; } }
  `],
})
export class AdminDashboardComponent implements OnInit {
  protected readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);
  private readonly access = inject(AdminAccessService);
  private readonly route = inject(ActivatedRoute);

  private readonly _q = signal('');
  readonly q = this._q.asReadonly();
  setQ(v: string) { this._q.set(v ?? ''); }

  readonly cats = computed(() => visibleCategories(this.access));
  readonly results = computed(() => searchAdmin(this._q(), this.access));
  readonly focusCat = toSignal(this.route.queryParamMap.pipe(map((m) => m.get('cat'))), { initialValue: null });

  ngOnInit(): void { this.access.ensureLoaded(); }
}
