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
import { LEGACY_SECTION, SETTINGS_GROUPS } from "./settings/settings-map";

/** One section's tile as the right panel shows it. */
interface SectionTile {
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
      @if (theme.isNewDesign()) {
        <pf-hero-band
          placeholder="Search all settings"
          [value]="q()"
          (valueChange)="setQ($event)"
          (submitted)="openTopHit()"
        ></pf-hero-band>
      }
      <div class="pf-band-body pf-ov__body">
        <label class="pf-ov__search pf-classic-only">
          <svg class="pf-ov__search-ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input class="pf-ov__search-in" type="search" name="search-admin-settings" [value]="q()"
                 (input)="setQ($any($event.target).value)" (keydown.enter)="openTopHit()"
                 placeholder="Search all settings" aria-label="Search all settings" />
        </label>

        @if (q().trim()) {
          <!-- Search mode: ONE ranked row per matching setting / page across
               every section (the one settings catalog + matcher). Enter opens
               the top row. -->
          <div class="pf-ov__results pf-card">
            <pf-settings-results [hits]="results()" [query]="q()"></pf-settings-results>
          </div>
        } @else {
          <pf-two-panel
            [groups]="panelGroups()"
            [selected]="selectedId()"
            [compact]="compact()"
            [detailOpen]="detailOpen()"
            navLabel="Settings sections"
            (pick)="pickSection($event)"
            (back)="closeDetail()"
          >
            <div class="pf-ov__tiles" data-testid="ov-tiles">
              @for (t of selectedTiles(); track t.href + t.title) {
                <a [routerLink]="t.href" [queryParams]="t.queryParams ?? null" class="pf-ov__tile press"
                   [attr.data-testid]="'ov-tile-' + tileKey(t)">
                  <span class="pf-card__icon pf-ov__tile-ic">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path [attr.d]="t.iconPath" />
                      @if (t.iconExtra) { <path [attr.d]="t.iconExtra" /> }
                    </svg>
                  </span>
                  <span class="pf-ov__tile-t">{{ t.title }}</span>
                  <span class="pf-ov__tile-s">{{ t.subtitle }}</span>
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
      .pf-ov { display: flex; flex-direction: column; min-height: calc(100dvh - var(--top-strip-h, 64px)); }
      .pf-ov__body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 20px 24px; }
      @media (max-width: 767px) { .pf-ov__body { padding: 12px 16px; } }
      .pf-ov__results { padding: 16px; overflow-y: auto; }
      .pf-ov__search {
        display: flex; align-items: center; gap: 9px; width: 100%; max-width: 520px; margin: 0 0 16px;
        padding: 10px 14px; border-radius: 12px; border: 1px solid var(--glass-border);
        background: var(--glass-bg); color: var(--text-primary);
      }
      .pf-ov__search-ic { color: var(--text-muted); flex-shrink: 0; }
      .pf-ov__search-in { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--text-primary); font-size: 13.5px; }
      .pf-ov__search-in::-webkit-search-cancel-button { display: none; }
      @media (max-width: 640px) { .pf-ov__search-in { font-size: 16px; } }

      /* Right panel: this section's tiles. */
      .pf-ov__tiles { display: grid; gap: 14px; align-content: start; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
      .pf-ov__tile {
        display: flex; flex-direction: column; gap: 6px; min-height: 96px; padding: 16px; border-radius: var(--pf-radius, 14px);
        border: 1px solid var(--pf-line, var(--glass-border)); background: var(--card-bg, transparent);
        color: var(--text-primary); text-decoration: none;
        transition: border-color 120ms ease, transform 100ms ease;
      }
      .pf-ov__tile:hover { border-color: var(--pf-sel-border, #9aa4ae); transform: translateY(-1px); }
      .pf-ov__tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
      .pf-ov__tile-ic { width: 36px; height: 36px; border-radius: 10px; margin-bottom: 4px; }
      .pf-ov__tile-t { font-size: 15px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
      .pf-ov__tile-s { font-size: 13px; line-height: 1.45; color: var(--text-tertiary, var(--text-muted)); overflow-wrap: anywhere; }
      @media (hover: none) { .pf-ov__tile:hover { transform: none; border-color: var(--pf-line, var(--glass-border)); } }
      @media (prefers-reduced-motion: reduce) { .pf-ov__tile, .pf-ov__tile:hover { transition: none; transform: none; } }
      @media (max-width: 767px) { .pf-ov__tiles { grid-template-columns: 1fr; } .pf-ov__tile { min-height: 80px; } }
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
      title: i.label, subtitle: i.blurb, href: i.path, iconPath: i.iconPath, iconExtra: i.iconExtra,
    })));
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
  private readonly _q = signal("");
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
