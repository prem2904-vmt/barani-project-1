import {
  ChangeDetectionStrategy, Component, Injector, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { TwoPanelComponent, TwoPanelGroup, injectTwoPanelCompact } from '@prefrontal/shared';
import { NavBackService } from '../../../core/services/nav-back.service';
import { SETTINGS_HOST } from '../../../shared/utils/settings-host';
import { SettingsAccessService } from './settings-access.service';
import { OpdAdminApi } from '../../opd/admin/opd-admin.api';
import { SettingsCategory, categoryTarget, locateSettings } from './settings-map';

const RAIL_KEY = 'pf.settings.rail';

function readRail(): boolean {
  try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
}

/**
 * The Settings shell (owner 2026-11-17): the SAME two-panel as the overview, one level in. Opening a setting slides
 * the left panel (260 ms, off under reduced motion) from the sections to THAT setting's categories under a back
 * arrow; the right side is the existing screen for the selected category (a route, or a `?tab=` / `?type=` of one).
 *
 *  - Wide: categories are always listed; the left panel can shrink to a thin rail. A setting's own path that only
 *    forwards (Outsourcing …) hops to its first category.
 *  - Phone: the categories list first, a tap drills in, back (chevron, edge swipe, hardware back) climbs one level
 *    at a time through NavBackService — detail → categories → the section on the overview.
 *  - Pages hosted here read SETTINGS_HOST and hide their own tab strip / back / brand (their actions stay).
 *
 * Which setting + category a URL is comes from settings-map.ts; which pages answer which path from settings.routes.ts.
 */
@Component({
  selector: 'pf-settings-shell',
  standalone: true,
  imports: [RouterOutlet, TwoPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: SETTINGS_HOST, useValue: { hosted: true as const } }],
  template: `
    <section class="pf-ss" data-testid="settings-shell">
      <pf-two-panel
        [groups]="groups()"
        [selected]="selectedId()"
        [compact]="compact()"
        [detailOpen]="detailOpen()"
        [navLabel]="itemLabel() + ' categories'"
        [navHead]="loc() ? itemLabel() : null"
        [navBackLabel]="'Back to ' + sectionLabel()"
        [navKey]="loc() ? itemId() : null"
        [animateNav]="true"
        [collapsible]="true"
        [rail]="rail()"
        [flush]="true"
        [stickyNav]="true"
        (pick)="pickCategory($event)"
        (back)="closeDetail()"
        (navBack)="toSections()"
        (railChange)="setRail($event)"
      >
        <router-outlet></router-outlet>
      </pf-two-panel>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-ss { display: flex; flex-direction: column; min-height: calc(100dvh - var(--top-strip-h, 64px)); padding: 20px 24px; }
    @media (max-width: 767px) { .pf-ss { padding: 12px 16px; } }
  `],
})
export class SettingsShellComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly access = inject(SettingsAccessService);
  private readonly injector = inject(Injector);
  private readonly navBack = inject(NavBackService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly compact = injectTwoPanelCompact();

  private readonly url = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url), startWith(this.router.url)),
    { initialValue: this.router.url },
  );
  private readonly parsed = computed(() => {
    const tree = this.router.parseUrl(this.url());
    const path = '/' + tree.root.children['primary']?.segments.map((s) => s.path).join('/');
    return { path, query: tree.queryParams as Record<string, string> };
  });

  /** Where the URL is: section → setting → category (null category = the setting's own forwarding path). */
  readonly loc = computed(() => {
    const p = this.parsed();
    return locateSettings(p.path, p.query);
  });
  readonly itemLabel = computed(() => this.loc()?.item.label ?? 'Settings');
  readonly itemId = computed(() => this.loc()?.item.id ?? '');
  readonly sectionLabel = computed(() => this.loc()?.section.label ?? 'Settings');
  /** Categories this person can open (a hidden one never lists; a hosted URL that names one is still served by its guard). */
  readonly cats = computed<SettingsCategory[]>(() => {
    const l = this.loc();
    return l ? this.access.visibleCategories(l.item) : [];
  });

  readonly groups = computed<TwoPanelGroup[]>(() => {
    const l = this.loc();
    if (!l) return [{ key: 'x', heading: 'Settings', items: [{ id: 'x', label: 'Settings' }] }];
    return [{ key: l.item.id, heading: l.item.label, items: this.cats().map((c) => ({ id: c.id, label: c.label })) }];
  });

  /** Wide: the URL's category, else the first. Phone: only what the URL names. */
  readonly selectedId = computed(() => {
    const l = this.loc();
    if (!l) return 'x';
    return l.category?.id ?? (this.compact() ? null : (this.cats()[0]?.id ?? null));
  });

  // ── Phone: categories list ⇄ one category's screen ──
  /** The phone shows the screen (true) or the category list (false). */
  readonly phoneDetail = signal(false);
  private lastItem: string | null = null;
  readonly detailOpen = computed(() => this.phoneDetail() || this.cats().length <= 1);

  readonly rail = signal(readRail());
  setRail(on: boolean): void {
    this.rail.set(on);
    try { localStorage.setItem(RAIL_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }

  constructor() {
    // A setting just opened: a category-specific URL (deep link, search hit) shows the screen; the setting's own
    // path shows the category list.
    effect(() => {
      const l = this.loc();
      const id = l?.item.id ?? null;
      if (id === this.lastItem) return;
      this.lastItem = id;
      if (!l) { this.phoneDetail.set(true); return; }
      const p = this.parsed();
      const bare = l.category === null || (p.path === l.item.path && Object.keys(p.query).length === 0
        && l.item.categories.length > 1);
      this.phoneDetail.set(!bare);
    });

    // Wide: land on a category (the setting's own path hops to the first; a tabbed page gets its `?tab=` in the URL).
    effect(() => {
      const l = this.loc();
      if (!l || this.compact() || !this.browser) return;
      const cats = this.cats();
      if (!cats.length) return;
      const p = this.parsed();
      if (!l.category) {
        const t = categoryTarget(l.item, cats[0]);
        void this.router.navigate([t.path], { queryParams: t.query, replaceUrl: true });
        return;
      }
      const want = l.category.query ?? {};
      if (Object.entries(want).some(([k, v]) => p.query[k] !== v)) {
        void this.router.navigate([], { queryParams: want, queryParamsHandling: 'merge', replaceUrl: true });
      }
    });

    // First time the OPD settings open: the tenant's starter set (once per session, server-side) — the old OPD hub did this.
    effect(() => {
      if (this.loc()?.section.id === 'opd') untracked(() => this.injector.get(OpdAdminApi).ensureStarter().subscribe());
    });

    // Phone back: screen → categories (when there are several) → the section on the overview.
    effect(() => {
      if (this.compact()) this.navBack.registerBackInterceptor(this.backHandler);
      else this.navBack.clearBackInterceptor(this.backHandler);
    });
  }

  private readonly backHandler = (): boolean => {
    if (!this.compact()) return false;
    if (this.phoneDetail() && this.cats().length > 1) { this.phoneDetail.set(false); return true; }
    return false;
  };
  ngOnDestroy(): void { this.navBack.clearBackInterceptor(this.backHandler); }

  /** Open a category: its own path (or the setting's), its view query, and clear the sibling categories' queries. */
  pickCategory(id: string): void {
    const l = this.loc();
    if (!l) return;
    const cat = l.item.categories.find((c) => c.id === id);
    if (!cat) return;
    const t = categoryTarget(l.item, cat);
    const queryParams: Record<string, string | null> = { ...t.query };
    for (const sib of l.item.categories) for (const k of Object.keys(sib.query ?? {})) if (!(k in queryParams)) queryParams[k] = null;
    this.phoneDetail.set(true);
    void this.router.navigate([t.path], { queryParams, queryParamsHandling: 'merge' });
  }

  /** Phone: leave the screen and show the category list again. */
  closeDetail(): void {
    if (this.cats().length > 1) this.phoneDetail.set(false);
    else this.toSections();
  }

  /** The back arrow on the left panel: up to the overview, on the section this setting belongs to. */
  toSections(): void {
    const l = this.loc();
    void this.router.navigate(['/admin'], { queryParams: l ? { section: l.section.id } : {} });
  }

}
