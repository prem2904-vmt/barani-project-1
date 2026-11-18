import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  TemplateRef,
  Type,
  viewChild,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import { Location, NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import { SETTINGS_HOST, createSettingsHost, pickHostSearch } from "../../shared/utils/settings-host";
import { confirmLeaveUnsaved, hasUnsavedChangesContract } from "../../shared/utils/unsaved-changes";
import { DialogService } from "../../core/services/dialog.service";
import { SegmentedComponent } from "../../shared/primitives/segmented.component";
import { SETTINGS_FULL_PAGE_ROUTES, SETTINGS_SHELL_CHILDREN } from "./settings/settings.routes";
import { OPD_ADMIN_ROUTES } from "../opd/opd.routes";
import { CASESHEET_SHELL_ROUTES } from "../casesheets/casesheets.routes";
import { Route } from "@angular/router";
import { map } from "rxjs";
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
  imports: [RouterLink, HeroBandComponent, SettingsResultsComponent, TwoPanelComponent, NgComponentOutlet, NgTemplateOutlet, SegmentedComponent],
  providers: [{ provide: SETTINGS_HOST, useFactory: createSettingsHost }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-ov pf-band-page">
      <!-- Test Master's frame (DESIGN-V2): the search is the band pill — no second search box. -->
      <pf-hero-band
        [shellBand]="true"
        [pageSearch]="inlineSearch()"
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
            <ng-container panel-tools>
              @if (inlineCats().length > 1) {
                <pf-segmented size="sm" ariaLabel="Category" [options]="inlineCats()" [value]="inlineTab()" (valueChange)="pickInlineTab($any($event))"></pf-segmented>
              }
              @if (inlineHeadTools(); as ht) { <ng-container *ngTemplateOutlet="ht"></ng-container> }
              @if (inlineCmp()) {
                @for (pa of inlineActions(); track $index) { <span class="pf-ov__acts"><ng-container *ngTemplateOutlet="pa.tpl"></ng-container></span> }
              }
            </ng-container>
            @if (inlineCmp(); as cmp) {
              <!-- A section with ONE setting shows that setting right here (owner): no tile, no extra click. -->
              <div class="pf-ss__main pf-ov__inline" [class.pf-ss__main--one]="inlineCats().length > 1" data-testid="ov-inline">
                <ng-container *ngComponentOutlet="cmp; injector: inlineInjector()"></ng-container>
              </div>
            } @else {
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
            }
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
      .pf-ov__inline { padding: 4px 6px 16px; }
      .pf-ov__acts { display: inline-flex; align-items: center; gap: 8px; }

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
    // An inline setting needs no count (its own head tools say what it holds).
    return n > 1 ? `${n} settings` : null;
  });
  readonly gearIcon = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z';
  // ── A section with ONE setting renders that setting inline (owner 2026-11-17) ──
  private readonly injector = inject(Injector);
  private readonly inlineItem = computed(() => {
    const items = this.allItems().find(i => i.section.id === this.selectedId())?.items ?? [];
    return items.length === 1 ? items[0] : null;
  });
  readonly inlineCmp = signal<Type<unknown> | null>(null);
  /** Settles when the inline page's lazy load has finished (specs await it before teardown). */
  inlineReady: Promise<unknown> = Promise.resolve();
  private readonly loadInline = effect(() => {
    const it = this.inlineItem();
    this.inlineCmp.set(null);
    if (!it) return;
    const r = inlineRoute(it.path);
    const load = r?.loadComponent;
    if (!load) return;
    this.inlineReady = Promise.resolve(load()).then((m: unknown) => {
      if (this.inlineItem() !== it) return;
      const t = (m && typeof m === 'object' && 'default' in (m as object)) ? (m as { default: Type<unknown> }).default : m as Type<unknown>;
      this.inlineCmp.set(t);
    });
  });
  /** The setting's route data (e.g. which tabs a reused screen shows) on top of the overview's live route. */
  readonly inlineInjector = computed(() => {
    const it = this.inlineItem();
    const data = (it && inlineRoute(it.path)?.data) ?? {};
    const real = this.route;
    const proxy = real ? Object.create(real, {
      snapshot: { get: () => Object.assign(Object.create(real.snapshot), { data: { ...real.snapshot.data, ...data } }) },
      data: { value: real.data.pipe(map((d) => ({ ...d, ...data }))) },
    }) : null;
    return Injector.create({ providers: proxy ? [{ provide: ActivatedRoute, useValue: proxy }] : [], parent: this.injector });
  });
  /** Its categories (hosted ones, `?tab=`), as a switch in the main card head. */
  private readonly host = inject(SETTINGS_HOST);
  readonly inlineSearch = computed(() => this.inlineCmp() ? pickHostSearch(this.host.searches(), this.inlineCats().length > 1 ? this.inlineTab() : null) : null);
  /** The inline page's actions, in its card head (never the band's corner); per picked category when they belong to one. */
  readonly inlineActions = computed(() => {
    const sel = this.inlineCats().length > 1 ? this.inlineTab() : null;
    return this.host.actions().filter((a) => !a.group || !sel || a.group === sel);
  });
  /** Its categories as the card head's pill: the page's run-time list (SETTINGS_HOST.categories), else the map's `?tab=` ones. */
  readonly inlineCats = computed(() => {
    const dyn = this.host.categories();
    if (this.inlineItem() && dyn?.length) return dyn.map(c => ({ value: c.id, label: c.label }));
    return (this.inlineItem()?.categories ?? []).filter(c => c.query?.['tab']).map(c => ({ value: c.query!['tab'], label: c.label }));
  });
  readonly inlineTab = computed(() => this.params()?.get('tab') ?? this.inlineCats()[0]?.value ?? '');
  pickInlineTab(t: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: t }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  private readonly outlet = viewChild(NgComponentOutlet);
  private readonly hostEl = inject(ElementRef<HTMLElement>);
  private groupObserver: MutationObserver | null = null;
  /** The inline page shows only the picked category's group (pages mark them `pf-setting-group [id]`). */
  private readonly showPickedGroup = effect(() => {
    const sel = this.inlineCmp() ? this.inlineTab() : null;
    setTimeout(() => {
      const root = (this.hostEl.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="ov-inline"]');
      this.groupObserver?.disconnect();
      if (!root || !sel) return;
      const apply = () => {
        const groups = Array.from(root.querySelectorAll<HTMLElement>('pf-setting-group[data-group]')).filter(g => !g.parentElement?.closest('pf-setting-group[data-group]'));
        const has = groups.some(g => g.dataset['group'] === sel);
        for (const g of groups) { const v = has && g.dataset['group'] !== sel ? 'none' : ''; if (g.style.display !== v) g.style.display = v; }
      };
      apply();
      if (typeof MutationObserver !== 'undefined') { this.groupObserver = new MutationObserver(() => apply()); this.groupObserver.observe(root, { childList: true, subtree: true }); }
    }, 0);
  });
  readonly inlineHeadTools = computed<TemplateRef<unknown> | null>(() => {
    this.inlineCmp();
    const inst = (this.outlet() as unknown as { componentInstance?: { headTools?: () => TemplateRef<unknown> | undefined } } | undefined)?.componentInstance;
    return typeof inst?.headTools === 'function' ? (inst.headTools() ?? null) : null;
  });

  tileKey(t: SectionTile): string { return t.href.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-'); }

  /** True when the phone's detail was pushed by a tap here, so back can POP it. */
  private pushedDetail = false;
  pickSection(id: string): void {
    // An inline page with unsaved changes asks first (Save / Leave without saving / Stay).
    const inst = (this.outlet() as unknown as { componentInstance?: unknown } | undefined)?.componentInstance;
    if (id !== this.selectedId() && hasUnsavedChangesContract(inst) && inst.hasUnsavedChanges()) {
      void confirmLeaveUnsaved(this.dialog, inst).then((ok) => { if (ok) this.doPickSection(id); });
      return;
    }
    this.doPickSection(id);
  }
  private readonly dialog = inject(DialogService);
  private doPickSection(id: string): void {
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
  ngOnDestroy(): void { this.navBack.clearBackInterceptor(this.backHandler); this.groupObserver?.disconnect(); }

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

/** The route that serves a settings path (hosted card page, full page, OPD or case-sheet admin), for inline rendering. */
function inlineRoute(path: string): Route | undefined {
  const p = path.replace(/^\//, '');
  return [...SETTINGS_SHELL_CHILDREN, ...SETTINGS_FULL_PAGE_ROUTES, ...OPD_ADMIN_ROUTES, ...CASESHEET_SHELL_ROUTES].find(r => r.path === p && !r.redirectTo);
}
