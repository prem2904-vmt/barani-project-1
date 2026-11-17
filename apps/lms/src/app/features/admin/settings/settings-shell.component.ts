import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { TwoPanelComponent, TwoPanelGroup, injectTwoPanelCompact } from '@prefrontal/shared';
import { NavBackService } from '../../../core/services/nav-back.service';
import { SETTINGS_HOST, createSettingsHost } from '../../../shared/utils/settings-host';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SettingsSiblingsComponent } from './settings-siblings.component';
import { SettingsAccessService } from './settings-access.service';
import { OpdAdminApi } from '../../opd/admin/opd-admin.api';
import { SettingsCategory, categoryPath, categoryTarget, isFullScreenSettingsPath, locateSettings } from './settings-map';

/**
 * The Settings shell, in TEST MASTER's frame (owner 2026-11-17, DESIGN-V2): `pf-band-page` → ONE band (back chevron to
 * the Settings section, the pill = the hosted page's search or "Search all settings", the page's actions top-right)
 * → `pf-band-body--fill`. Below it either
 *  - ONE full-width main card (`single` settings and settings with one category): head = the setting's icon + name,
 *    body = the page's rows (its few categories are group labels inside), or
 *  - Test Master's two cards: the side card lists the setting's categories under a back chevron (it slides in,
 *    260 ms, off under reduced motion), the main card (head = icon + category) holds the selected category.
 * Only the card bodies scroll — never the page. Full-screen sibling pages of the setting (Report design, Consultation
 * forms …) are a small switch in the band (pf-settings-siblings). Phone: categories list → screen; back climbs one
 * level through NavBackService.
 *
 * Hosted pages read SETTINGS_HOST: their pf-hero-band renders nothing in place and hands this band its actions and
 * search. Which setting + category a URL is comes from settings-map.ts; which pages answer which path from
 * settings.routes.ts.
 */
@Component({
  selector: 'pf-settings-shell',
  standalone: true,
  imports: [RouterOutlet, TwoPanelComponent, HeroBandComponent, SettingsSiblingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: SETTINGS_HOST, useFactory: createSettingsHost }],
  template: `
    <section class="pf-ss pf-band-page" data-testid="settings-shell">
      <!-- Test Master's band: back · lab · the search pill (the page's own search, else "Search <setting>" filtering
           the rows) with the page switch · the page's save state and actions. -->
      <pf-hero-band [shellBand]="true" [back]="true" [backAction]="backToSection"
                    [placeholder]="'Search ' + itemLabel()" [value]="q()" (valueChange)="q.set($event)">
        <ng-container band-tools><pf-settings-siblings></pf-settings-siblings></ng-container>
      </pf-hero-band>
      <div class="pf-band-body pf-band-body--fill pf-ss__body">
        @if (single()) {
          <!-- One category: ONE main card (TM head), its groups one under the other. -->
          <section class="pf-ss__card" [class.pf-card]="!ownsCard()" [class.pf-ss__card--bare]="ownsCard()" [attr.aria-label]="itemLabel()">
            <header class="pf-card__head" [hidden]="ownsCard()">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="itemIcon()"/></svg>
              </span>
              <h2 class="pf-card__label pf-ss__title" data-testid="tp-nav-title">{{ itemLabel() }}</h2>
              @if (itemBlurb()) { <span class="pf-card__note pf-ss__note">{{ itemBlurb() }}</span> }
            </header>
            <div class="pf-ss__scroll">
              <div class="pf-ss__main" data-testid="settings-main"><router-outlet></router-outlet></div>
              @if (q().trim() && noMatch()) { <p class="pf-band-empty" data-testid="ss-no-match">No settings match "{{ q() }}".</p> }
            </div>
          </section>
        } @else {
          <pf-two-panel
            [groups]="groups()"
            [selected]="selectedId()"
            [compact]="compact()"
            [detailOpen]="detailOpen()"
            [navLabel]="itemLabel() + ' categories'"
            [navHead]="loc() ? itemLabel() : null"
            [navIcon]="itemIcon()"
            [panelIcon]="itemIcon()"
            [panelNote]="panelNote()"
            [backLabel]="'Back to ' + itemLabel()"
            [navBackLabel]="'Back to ' + sectionLabel()"
            [navKey]="loc() ? itemId() : null"
            [animateNav]="true"
            [flush]="true"
            [bareMain]="ownsCard()"
            (pick)="pickCategory($event)"
            (back)="closeDetail()"
            (navBack)="toSections()"
          >
            <div class="pf-ss__main pf-ss__main--one" data-testid="settings-main"><router-outlet></router-outlet></div>
          </pf-two-panel>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-ss__body { min-height: 0; }
    :root:not(.design-new) .pf-ss { display: flex; flex-direction: column; height: calc(100dvh - var(--top-strip-h, 64px)); padding: 0 16px; }
    :root:not(.design-new) .pf-ss__body { flex: 1; display: flex; flex-direction: column; padding-bottom: 12px; }
    .pf-ss__card { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-ss__card--bare .pf-ss__main { padding: 0 !important; }
    .pf-ss__scroll { flex: 1 1 auto; min-height: 0; }
    .pf-ss__title { margin: 0; flex: none; }
    .pf-ss__note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-ss__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; margin: 0 -4px; padding: 0 4px; }
    .pf-ss__main { padding: 14px 24px 24px; }
    @media (max-width: 767px) { .pf-ss__main { padding: 8px 14px 16px; } .pf-ss__note { display: none; } }
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
  readonly itemIcon = computed(() => this.loc()?.item.iconPath ?? null);
  readonly itemBlurb = computed(() => this.loc()?.item.blurb ?? null);
  /** The main card head's note: the selected category's scope ("this branch" …). */
  readonly panelNote = computed(() => this.cats().find((c) => c.id === this.selectedId())?.scope ?? null);
  readonly sectionLabel = computed(() => this.loc()?.section.label ?? 'Settings');
  /** Categories this person can open (a hidden one never lists; a hosted URL that names one is still served by its guard). */
  readonly cats = computed<SettingsCategory[]>(() => {
    const l = this.loc();
    if (!l) return [];
    // Full-screen pages are not hosted: they are the band's page switch, never a category row here.
    return this.access.visibleCategories(l.item).filter((c) => !isFullScreenSettingsPath(categoryPath(l.item, c)));
  });
  /** ONE main card (no side card): a `single` setting, or one with a single hosted category. */
  readonly single = computed(() => this.cats().length <= 1);

  readonly groups = computed<TwoPanelGroup[]>(() => {
    const l = this.loc();
    if (!l) return [{ key: 'x', heading: 'Settings', items: [{ id: 'x', label: 'Settings' }] }];
    return [{ key: l.item.id, heading: l.item.label, items: this.cats().map((c) => ({ id: c.id, label: c.label, note: c.scope })) }];
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

  /** The hosted page's band parts (its actions, its search) — this shell's own SETTINGS_HOST. */
  protected readonly host = inject(SETTINGS_HOST);
  readonly q = signal('');
  readonly noMatch = signal(false);
  /** The shown page renders its OWN card (a grid page, a board): the frame drops its wrapper card — never card-in-card. */
  readonly ownsCard = signal(false);
  private readonly hostEl = inject(ElementRef<HTMLElement>);
  /** The band pill filters the rows on this page (label + hint text); a group card with no match hides. */
  private filterState: { words: string; sel: string | null } = { words: '', sel: null };
  private observer: MutationObserver | null = null;
  private applyQueued = false;
  /** The band pill filters the rows; with two cards the main card shows ONLY the selected group. Re-applied whenever
   *  the page's DOM changes (groups render after their data arrives). */
  private readonly filterRows = effect(() => {
    this.filterState = { words: this.q().trim().toLowerCase(), sel: this.single() ? null : this.selectedId() };
    this.url();
    if (!this.browser) return;
    setTimeout(() => { this.watchMain(); this.applyFilter(); }, 0);
  });

  private watchMain(): void {
    const root = (this.hostEl.nativeElement as HTMLElement).querySelector('[data-testid="settings-main"]');
    if (!root || typeof MutationObserver === 'undefined') return;
    if ((this.observer as unknown as { root?: Element } | null)?.root === root) return;
    this.observer?.disconnect();
    const obs = new MutationObserver(() => {
      if (this.applyQueued) return;
      this.applyQueued = true;
      queueMicrotask(() => { this.applyQueued = false; this.applyFilter(); });
    });
    obs.observe(root, { childList: true, subtree: true });
    (obs as unknown as { root: Element }).root = root;
    this.observer = obs;
  }

  private applyFilter(): void {
    const { words, sel } = this.filterState;
    const root = (this.hostEl.nativeElement as HTMLElement).querySelector('[data-testid="settings-main"]');
    if (!root) return;
    const show = (el: HTMLElement, on: boolean) => { const v = on ? '' : 'none'; if (el.style.display !== v) el.style.display = v; };
    const groups = Array.from(root.querySelectorAll<HTMLElement>('pf-setting-group[data-group]'))
      .filter((g) => !g.parentElement?.closest('pf-setting-group[data-group]'));
    const has = !!sel && groups.some((g) => g.dataset['group'] === sel);
    for (const g of groups) show(g, !(has && g.dataset['group'] !== sel));
    let shown = 0;
    root.querySelectorAll<HTMLElement>('pf-setting-row, .pf-nc-card').forEach((r) => {
      const hit = !words || (r.textContent ?? '').toLowerCase().includes(words);
      show(r, hit);
      if (hit && !r.closest('pf-setting-group[style*="none"]')) shown++;
    });
    root.querySelectorAll<HTMLElement>('pf-setting-group:not(.pf-sgroup--plain)').forEach((g) => {
      if (g.dataset['group'] && has && g.dataset['group'] !== sel) return;
      const rows = Array.from(g.querySelectorAll<HTMLElement>('pf-setting-row, .pf-nc-card'));
      show(g, !(words && rows.length > 0 && rows.every((r) => r.style.display === 'none')));
    });
    if (this.noMatch() !== (!!words && shown === 0)) this.noMatch.set(!!words && shown === 0);
    // A visible card inside the page (root holds only the page — the frame's own cards are outside it).
    const own = Array.from(root.querySelectorAll<HTMLElement>('.pf-card')).some((c) => c.getClientRects().length > 0);
    if (this.ownsCard() !== own) this.ownsCard.set(own);
  }
  /** The band's back chevron: where the person came from (an in-app link), else up to this setting's section. */
  readonly backToSection = (): void => this.navBack.back();

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
    if (!this.compact() || this.single()) return false;
    if (this.phoneDetail() && this.cats().length > 1) { this.phoneDetail.set(false); return true; }
    return false;
  };
  ngOnDestroy(): void { this.navBack.clearBackInterceptor(this.backHandler); this.observer?.disconnect(); }

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
    // A category is a view of the same setting: replace the entry, so back leaves the setting (not the last category).
    void this.router.navigate([t.path], { queryParams, queryParamsHandling: 'merge', replaceUrl: t.path === this.parsed().path });
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
