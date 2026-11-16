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
import { AuthService } from "../../core/auth/auth.service";
import { BetaFeaturesService } from "../../core/services/beta-features.service";
import { OpdGateService } from "../opd/shared/opd-gate.service";
import { canOpenRoute } from "../../core/auth/route-access";
import { ProcessWorkflowService } from "../../core/services/process-workflow.service";
import { TenantEntitlementsService } from "../../core/services/tenant-entitlements.service";
import { LabFeaturesService } from "../../core/services/lab-features.service";
import { NavBackService } from "../../core/services/nav-back.service";
import { SettingsCatalogService } from "../../core/services/settings-catalog.service";
import { SettingsResultsComponent } from "../../shared/components/settings-results/settings-results.component";
import { ADMIN_CATEGORIES, LAB_SETTINGS_TILES, SettingsTile } from "../../shared/utils/settings-tiles";

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
 * Settings overview = the two-panel hub (owner 2026-11-15). LEFT: the grouped
 * section list (Departments, Organization, All departments last). RIGHT: the
 * selected section's tiles — the same tiles and routes the old cards, the
 * settings hub and the Lab hub had; only the way you reach them changed. The
 * business numbers (cash, billed, patients, config counters) moved out: that is
 * Insights' job.
 *
 * The selected section lives in the URL (`/admin?section=lab`), so old deep
 * links (`/admin/manage?cat=org`, `/lab/settings`) land on the same section.
 * Phone: the list first, a tap drills into the section, back (chevron, swipe,
 * browser) returns to the list.
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
  private readonly auth = inject(AuthService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly entitlements = inject(TenantEntitlementsService);
  /** OPD dark build: the OPD module card shows only when the OPD gate is open. */
  private readonly opdGate = inject(OpdGateService);
  private readonly labFeatures = inject(LabFeaturesService);
  private readonly navBack = inject(NavBackService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly location = inject(Location);

  /** Route-access context for filtering links (ROUTE_ACCESS — same rule as the
   *  guards), so a custom admin role never sees a card that lands on /403. */
  protected canOpen(href: string): boolean {
    // hasAnyPermission already honours '*' (super-admin). Workflow actions and
    // module entitlements too (the same ROUTE_ACCESS the guards read), so a
    // switched-off feature — e.g. Home collection — never surfaces here.
    return canOpenRoute(href, {
      hasAny: (p) => this.auth.hasAnyPermission(p),
      isEnabled: (a) => this.process.isEnabled(a),
      moduleEnabled: (m) => this.entitlements.moduleEnabled(m),
    });
  }
  private openable<T extends { href?: string }>(items: T[]): T[] {
    return items.filter((i) => (!i.href || this.canOpen(i.href))
      && (!i.href?.startsWith('/admin/opd') || this.opdGate.visible()));
  }

  readonly groups: Array<{
    cat: string;
    label: string;
    blurb: string;
    icon: string;
    href?: string;
    /** dept = a department / product module; org = organization-wide; all = shared by every department (listed last). */
    section: 'dept' | 'org' | 'all';
  }> = this.openable([
    // Module-first admin: one card per MODULE (Lab here; OPD/IPD/Pharmacy slot in
    // as each ships), then the shared/platform cards. Module ENABLEMENT lives in
    // the platform console (admin.prefrontal.health) — not here.
    {
      cat: "lab",
      section: "dept",
      label: "Lab",
      blurb:
        "Tests & catalog, report layout, lab settings, referrals, alerts, KPIs",
      icon: "M9 3h6M10 3v5.5L5.5 17A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 8.5V3",
      href: "/lab/settings",
    },
    {
      cat: "radiology",
      section: "dept",
      label: "Radiology / Imaging",
      blurb: "X-ray, CT, MRI, ultrasound, PACS — coming soon",
      icon: "M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z",
      href: "/admin/radiology",
    },
    {
      cat: "opd",
      section: "dept",
      label: "OPD",
      blurb: "Appointments, consultation, vitals, prescriptions — coming soon",
      icon: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2",
      href: "/admin/opd",
    },
    {
      cat: "ipd",
      section: "dept",
      label: "IPD",
      blurb: "Admissions, beds & wards, nursing, discharge — coming soon",
      icon: "M3 7v12M3 13h18v6M21 19v-4a3 3 0 0 0-3-3h-7v4M7 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
      href: "/admin/ipd",
    },
    {
      cat: "pharmacy",
      section: "dept",
      label: "Pharmacy",
      blurb: "Dispensing, stock, formulary, purchase — coming soon",
      icon: "M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7",
      href: "/admin/pharmacy",
    },
    {
      cat: "inventory",
      section: "dept",
      label: "Inventory",
      blurb: "Stock, batches, expiry alerts, per-item usage",
      icon: "M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8",
      href: "/admin/inventory",
    },
    {
      cat: "payroll",
      section: "dept",
      label: "Payroll",
      blurb: "Employees, attendance, payslips — coming soon",
      icon: "M3 7h18v12H3zM3 11h18M7 15h4M12 3v4",
      href: "/admin/payroll",
    },
    {
      cat: "emergency",
      section: "dept",
      label: "Emergency (ER)",
      blurb: "Triage, ER registration, observation — coming soon",
      icon: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z",
      href: "/admin/emergency",
    },
    {
      cat: "bloodbank",
      section: "dept",
      label: "Blood Bank",
      blurb: "Donors, cross-match, unit inventory — coming soon",
      icon: "M12 3s6 6 6 10a6 6 0 0 1-12 0c0-4 6-10 6-10Z",
      href: "/admin/blood-bank",
    },
    {
      cat: "insurance",
      section: "dept",
      label: "Insurance",
      blurb: "Policies, claims, pre-auth, TPA, reimbursement — coming soon",
      icon: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3ZM9 12l2 2 4-4",
      href: "/admin/insurance",
    },
    {
      cat: "people",
      section: "org",
      label: "People & Access",
      blurb: "Users, roles and the audit trail",
      icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    },
    {
      cat: "org",
      section: "org",
      label: "Branches & Organization",
      blurb: "Branches, departments, IDs, appointments, referral & vendors",
      icon: "M4 21V7l8-4 8 4v14",
    },
    {
      cat: "finance",
      section: "org",
      label: "Billing & Finance",
      blurb: "GST, discounts, invoices, daily statement",
      icon: "M3 5h18v14H3z",
    },
    {
      cat: "automation",
      section: "org",
      label: "Platform & Automation",
      blurb: "Process builder & form flows",
      icon: "M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z",
    },
    {
      cat: "communication",
      section: "all",
      label: "Communication",
      blurb: "WhatsApp, email and SMS for every department",
      icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5",
      href: "/admin/communication",
    },
  ]);


  /** Files (beta `neuron`, dev only): an ordinary section next to Communication, same style, no badge. */
  private readonly beta = inject(BetaFeaturesService);
  private readonly filesTile = computed(() => this.beta.enabled('neuron') && this.canOpen('/admin/files')
    ? [{
        cat: 'files', section: 'all' as const, label: 'Files', blurb: 'Neuron, Synapse, Axon, Myelin, Retina: access, templates, storage',
        icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', href: '/admin/files',
      }]
    : []);

  /** The tiles of one section, each one the SAME tile (title, route, icon) the old
   *  cards / settings hub / Lab hub listed, filtered by the same access rules. */
  private tilesFor(g: { cat: string; label: string; blurb: string; icon: string; href?: string }): SectionTile[] {
    if (g.cat === 'lab') {
      const featureOn = (t: (typeof LAB_SETTINGS_TILES)[number]) =>
        (t.feature !== 'homeCollection' || this.labFeatures.homeCollectionEnabled())
        && (!t.beta || this.beta.enabled(t.beta));
      return LAB_SETTINGS_TILES.filter((t) => featureOn(t) && this.canOpen(t.href));
    }
    const cat = ADMIN_CATEGORIES.find((c) => c.id === g.cat);
    if (cat) return cat.tiles.filter((t: SettingsTile) => this.canOpen(t.href));
    // A single-page section (Inventory, Communication, Files, the coming-soon
    // modules): its one tile is the page itself.
    return g.href ? [{ title: g.label, subtitle: g.blurb, href: g.href, iconPath: g.icon }] : [];
  }

  /** Departments first, then the organization, then what every department shares (Communication, Files) LAST. */
  readonly sections = computed(() => {
    const all = [...this.groups, ...this.filesTile()];
    return ([
      { key: 'dept', label: 'Departments' },
      { key: 'org', label: 'Organization' },
      { key: 'all', label: 'All departments' },
    ] as const).map(s => ({
      ...s,
      items: all.filter(g => g.section === s.key)
        .map(g => ({ ...g, tiles: this.tilesFor(g) }))
        .filter(g => g.tiles.length > 0),
    })).filter(s => s.items.length > 0);
  });

  readonly panelGroups = computed<TwoPanelGroup[]>(() => this.sections().map(s => ({
    key: s.key,
    heading: s.label,
    items: s.items.map(g => ({
      id: g.cat,
      label: g.label,
      description: g.blurb,
      note: g.tiles.length > 1 ? String(g.tiles.length) : undefined,
    })),
  })));

  private readonly allItems = computed(() => this.sections().flatMap(s => s.items));

  // ── Selected section (kept in the URL: /admin?section=lab) ─────────────
  private readonly params = this.route ? toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap }) : signal(null);
  readonly compact = injectTwoPanelCompact();
  private readonly urlSection = computed(() => {
    const id = this.params()?.get('section') ?? null;
    return id && this.allItems().some(i => i.cat === id) ? id : null;
  });
  /** Wide: the URL's section, else the first one. Phone: only what the URL names (none = the list). */
  readonly selectedId = computed(() => this.urlSection() ?? (this.compact() ? null : (this.allItems()[0]?.cat ?? null)));
  readonly detailOpen = computed(() => this.urlSection() !== null);
  readonly selectedTiles = computed(() => this.allItems().find(i => i.cat === this.selectedId())?.tiles ?? []);
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
