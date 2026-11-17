import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { Location } from "@angular/common";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { TwoPanelComponent, TwoPanelGroup, injectTwoPanelCompact } from "@prefrontal/shared";
import { ThemeService } from "../../core/services/theme.service";
import { HeroBandComponent } from "../../shared/components/hero-band/hero-band.component";
import { NavBackService } from "../../core/services/nav-back.service";
import { SettingsCatalogService } from "../../core/services/settings-catalog.service";
import { SettingsResultsComponent } from "../../shared/components/settings-results/settings-results.component";
import { SettingsAccessService } from "./settings/settings-access.service";
import { LEGACY_SECTION, SETTINGS_GROUPS, settingsPages } from "./settings/settings-map";

/** One section's tile as the right panel shows it. */
interface SectionTile {
  /** Opens its own full-screen page (not the Settings frame). */
  external?: boolean;
  title: string;
  subtitle: string;
  href: string;
  queryParams?: Record<string, string>;
  iconPath: string;
  iconExtra?: string;
}

/**
 * Settings overview = the two-panel hub (owner 2026-11-15, re-homed 2026-11-17). LEFT: the grouped section list
 * (Departments: Lab, OPD, Pharmacy, IPD, Inventory — each only when the lab has it; Organization: profile, branches,
 * numbers, people, billing, connected apps, message channels, files). RIGHT: the selected section's settings as
 * tiles. A tile opens that setting INSIDE the Settings shell (settings-shell.component.ts), where the left panel
 * slides to the setting's categories. The map is settings/settings-map.ts; who sees what is SettingsAccessService.
 *
 * The selected section lives in the URL (`/admin?section=lab`), so old deep links (`/admin/manage?cat=org`,
 * `/lab/settings`, `/admin?section=finance`) land on the section that holds them now. Phone: the list first, a tap
 * drills into the section, back (chevron, swipe, browser) returns to the list.
 */
@Component({
  selector: "pf-admin-overview",
  standalone: true,
  imports: [RouterLink, HeroBandComponent, SettingsResultsComponent, TwoPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-ov pf-band-page">
      <!-- Test Master's frame (DESIGN-V2): the search is the band pill — no second search box. -->
      <pf-hero-band
        [back]="true"
        [backAction]="compact() && detailOpen() ? closeFn : null"
        placeholder="Search all settings"
        [value]="q()"
        (valueChange)="setQ($event)"
        (submitted)="openTopHit()"
      ></pf-hero-band>
      <div class="pf-band-body pf-band-body--fill pf-ov__body">
        @if (q().trim()) {
          <!-- Search mode: ONE ranked row per matching setting / page across every section (the one settings
               catalog + matcher). Enter opens the top row. -->
          <section class="pf-card pf-ov__results" aria-label="Search results">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              </span>
              <span class="pf-card__label">Search results</span>
            </header>
            <div class="pf-card__body">
              <pf-settings-results [hits]="results()" [query]="q()"></pf-settings-results>
            </div>
          </section>
        } @else {
          <pf-two-panel
            [groups]="panelGroups()"
            [selected]="selectedId()"
            [compact]="compact()"
            [detailOpen]="detailOpen()"
            navLabel="Settings sections"
            navTitle="Settings"
            [navIcon]="gearIcon"
            [panelNote]="panelNote()"
            (pick)="pickSection($event)"
            (back)="closeDetail()"
          >
            <div class="pf-ov__tiles" data-testid="ov-tiles">
              @for (t of selectedTiles(); track t.href + t.title) {
                <a [routerLink]="t.href" [queryParams]="t.queryParams ?? null" class="pf-ov__tile press"
                   [attr.data-testid]="'ov-tile-' + tileKey(t)">
                  <span class="pf-card__icon pf-ov__tile-ic">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path [attr.d]="t.iconPath" />
                      @if (t.iconExtra) { <path [attr.d]="t.iconExtra" /> }
                    </svg>
                  </span>
                  <span class="pf-ov__tile-text">
                    <span class="pf-ov__tile-t">
                      {{ t.title }}
                      @if (t.external) {
                        <svg class="pf-ov__tile-ext" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Opens its own page"><path d="M7 17 17 7M8 7h9v9"/></svg>
                      }
                    </span>
                    <span class="pf-ov__tile-s">{{ t.subtitle }}</span>
                  </span>
                </a>
              }
            </div>
          </pf-two-panel>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .pf-ov__body { min-height: 0; }
      :root:not(.design-new) .pf-ov { display: flex; flex-direction: column; height: calc(100dvh - var(--top-strip-h, 64px)); padding: 0 16px; }
      :root:not(.design-new) .pf-ov__body { flex: 1; display: flex; flex-direction: column; padding-bottom: 12px; }
      .pf-ov__results { flex: 1 1 auto; }

      /* Main card body: this section's tiles — the existing tile look, tighter. */
      .pf-ov__tiles { display: grid; gap: 10px; align-content: start; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); }
      .pf-ov__tile {
        display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border-radius: 12px;
        border: 1px solid var(--pf-line, var(--glass-border)); background: var(--pf-card-bg, transparent);
        color: var(--text-primary); text-decoration: none;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .pf-ov__tile:hover { border-color: var(--pf-sel-border, #9aa4ae); background: var(--pf-chip-bg); }
      .pf-ov__tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
      .pf-ov__tile-ic { width: 32px; height: 32px; border-radius: 9px; }
      .pf-ov__tile-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .pf-ov__tile-t { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
      .pf-ov__tile-ext { flex: none; color: var(--text-tertiary); }
      .pf-ov__tile-s {
        font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary, var(--text-muted));
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      @media (hover: none) { .pf-ov__tile:hover { background: var(--pf-card-bg, transparent); border-color: var(--pf-line, var(--glass-border)); } }
      @media (prefers-reduced-motion: reduce) { .pf-ov__tile { transition: none; } }
      @media (max-width: 767px) { .pf-ov__tiles { grid-template-columns: 1fr; } }
    `,
  ],
})
export class AdminOverviewComponent implements OnDestroy {
  /** Design gate: new design hides the big overview title. */
  readonly theme = inject(ThemeService);
  private readonly access = inject(SettingsAccessService);
  private readonly navBack = inject(NavBackService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly location = inject(Location);

  /** Sections this person can open at least one setting in, grouped Departments → Organization. Read live. */
  private readonly sections = computed(() => this.access.visibleSections());

  readonly panelGroups = computed<TwoPanelGroup[]>(() => {
    const all = this.sections();
    return SETTINGS_GROUPS
      .map((g) => ({
        key: g.key,
        heading: g.heading,
        items: all.filter((s) => s.section.group === g.key).map((s) => ({
          id: s.section.id,
          label: s.section.label,
          description: s.section.blurb,
          icon: s.section.iconPath,
          note: s.items.length > 1 ? String(s.items.length) : undefined,
        })),
      }))
      .filter((g) => g.items.length > 0);
  });

  private readonly allItems = computed(() => this.sections());

  // ── Selected section (kept in the URL: /admin?section=lab) ─────────────
  private readonly params = this.route ? toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap }) : signal(null);
  readonly compact = injectTwoPanelCompact();
  private readonly urlSection = computed(() => {
    const raw = this.params()?.get('section') ?? null;
    // Old links (`?section=org`, `/admin/manage?cat=finance` …) name the section that holds them now.
    const id = raw && this.allItems().some(i => i.section.id === raw) ? raw : (raw ? (LEGACY_SECTION[raw] ?? null) : null);
    return id && this.allItems().some(i => i.section.id === id) ? id : null;
  });
  /** Wide: the URL's section, else the first one. Phone: only what the URL names (none = the list). */
  readonly selectedId = computed(() => this.urlSection() ?? (this.compact() ? null : (this.allItems()[0]?.section.id ?? null)));
  readonly detailOpen = computed(() => this.urlSection() !== null);
  readonly selectedTiles = computed<SectionTile[]>(() =>
    (this.allItems().find(i => i.section.id === this.selectedId())?.items ?? []).map((i) => ({
      external: settingsPages(i).every((p) => p.fullScreen),
      title: i.label, subtitle: i.blurb, href: i.path, iconPath: i.iconPath, iconExtra: i.iconExtra,
    })));
  /** Main-card head note: how many settings the section holds. */
  readonly panelNote = computed(() => {
    const n = this.selectedTiles().length;
    return n ? `${n} setting${n === 1 ? '' : 's'}` : null;
  });
  readonly gearIcon = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z';
  tileKey(t: SectionTile): string { return t.href.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-'); }

  /** True when the phone's detail was pushed by a tap here, so back can POP it. */
  private pushedDetail = false;
  pickSection(id: string): void {
    const phone = this.compact();
    this.pushedDetail = phone && this.urlSection() === null;
    void this.router.navigate([], {
      relativeTo: this.route, queryParams: { section: id }, queryParamsHandling: 'merge', replaceUrl: !this.pushedDetail,
    });
    if (this.q()) this.setQ('');
  }
  /** The band's back chevron on a phone section (the ONE back — no back inside the cards). */
  readonly closeFn = (): void => this.closeDetail();
  /** Phone: leave the section and show the list again. */
  closeDetail(): void {
    if (this.pushedDetail) {
      this.pushedDetail = false;
      this.location.back();
      return;
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: { section: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private readonly backHandler = (): boolean => {
    if (!(this.compact() && this.detailOpen())) return false;
    this.closeDetail();
    return true;
  };
  private readonly registerBack = effect(() => {
    if (this.compact() && this.detailOpen()) this.navBack.registerBackInterceptor(this.backHandler);
    else this.navBack.clearBackInterceptor(this.backHandler);
  });
  ngOnDestroy(): void { this.navBack.clearBackInterceptor(this.backHandler); }

  // ── Settings search (one box across every tile) ────────────────────────
  // The search reads the ONE settings catalog (shared/utils/settings-catalog)
  // with the ONE precise matcher — titles + keywords, whole words / prefixes,
  // ranked; filtered to what this person can open.
  /** `?q=` seeds the search (the Settings frame's band pill on a setting page sends its words here). */
  private readonly _q = signal(this.route?.snapshot.queryParamMap.get('q') ?? "");
  readonly q = this._q.asReadonly();
  setQ(v: string): void {
    this._q.set(v ?? "");
  }
  private readonly catalog = inject(SettingsCatalogService);
  readonly results = computed(() => this.catalog.search(this._q()));
  /** Enter in the search opens the top hit. */
  openTopHit(): void {
    const top = this.results()[0];
    if (top) void this.router.navigate([top.href], { queryParams: top.queryParams ?? {} });
  }
}
