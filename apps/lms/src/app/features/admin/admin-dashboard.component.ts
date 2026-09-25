import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../shared/primitives/segmented.component';

interface SeedSummary {
  tenants: number;
  branches: number;
  departments: number;
  permissions: number;
  preSeededRoles: number;
  tests: number;
  workflows: number;
}

type GradientKey = 'violet' | 'pink' | 'emerald' | 'amber' | 'sky' | 'rose' | 'fuchsia' | 'teal';

interface Tile {
  title: string;
  href: string;
  queryParams?: Record<string, string>;
  gradient: GradientKey;
  iconPath: string;
  iconExtra?: string;
  subtitle: () => string;
}

interface Category {
  id: string;
  label: string;
  iconPath: string;
  iconExtra?: string;
  /** Signature gradient for this category — every tile in the right
   *  pane inherits it, so the colour reads as "this is the Setup
   *  family" rather than a jumble of unrelated hues. */
  gradient: GradientKey;
  /** One-line description shown under the pane title — frames what
   *  the user can do in this section. */
  blurb: string;
  /** Footer bullet points: 2–3 short tips / typical tasks for the
   *  section. Fills the dead space below sparse tile lists. */
  tips: string[];
  tiles: Tile[];
}

/**
 * Two-panel admin dashboard. Left rail lists categories (Setup, Tests,
 * Reports, Billing, Workflows, Insights…); the right pane shows the
 * tiles under the selected category. Replaces the previous flat grid
 * of ~11 tiles + a separate "More" popover in the navbar — both
 * fed off the same admin links and made the surface feel crowded.
 *
 * The default selection is the first category. Keyboard nav (Up/Down)
 * + URL deep-link via `?cat=` so we can route directly to a category
 * from outside (e.g. the dashboard tile on FD landing).
 */
@Component({
  selector: 'pf-admin-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, HeroBandComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-admin-page pf-band-page">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the settings search, and the category switch
             inside the pill so any category is one tap away. -->
        <pf-hero-band [back]="true" placeholder="Search settings — inventory, invoice, patient ID…"
                      [value]="q()" (valueChange)="setQ($event)">
          <ng-container band-tools>
            <pf-segmented class="pf-admin-catseg" size="sm" [options]="categoryOptions" [value]="active()"
                          (valueChange)="pickCategory($event)"></pf-segmented>
          </ng-container>
        </pf-hero-band>
      }
      <header class="pf-admin-hdr pf-classic-only">
        <div class="pf-admin-hdr__left">
          <p class="pf-admin-hdr__eyebrow">{{ today | date:'EEEE, MMM d' }}</p>
          <div class="flex items-center gap-1.5">
            <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Back to overview">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h1 class="pf-admin-hdr__title">Admin · <span class="text-gradient">{{ userName() }}</span></h1>
          </div>
          <p class="pf-admin-hdr__sub">Pick a category — or search every config screen.</p>
        </div>
        <div class="pf-admin-hdr__right">
          <input class="pf-admin-search" type="search" [value]="q()"
                 (input)="setQ($any($event.target).value)"
                 placeholder="Search settings — inventory, invoice, patient ID…"
                 aria-label="Search admin settings" />
        </div>
      </header>

      <div class="pf-band-body">
      <div class="pf-admin-layout">
        <!-- Category is chosen on the Overview screen and deep-linked via ?cat=;
             the left category rail was redundant with those cards, so this hub
             shows just the selected category full-width. Back returns to it. -->
        <div class="pf-admin-pane nd-card">
          @if (q().trim()) {
            <header class="nd-card__head pf-admin-pane__hdr">
              <span class="nd-card__icon pf-admin-pane__chip">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              </span>
              <h2 class="nd-card__label pf-admin-pane__title">Search results</h2>
              <p class="nd-card__note pf-admin-pane__blurb">for “{{ q() }}”</p>
              <span class="pf-admin-pane__count nd-num">{{ results().length }} {{ results().length === 1 ? 'match' : 'matches' }}</span>
            </header>
            <div class="pf-admin-pane__grid">
              @for (r of results(); track r.tile.title) {
                <a [routerLink]="r.tile.href" [queryParams]="r.tile.queryParams ?? null"
                   class="pf-admin-tile nd-row group press">
                  <span class="nd-card__icon pf-admin-tile__icon">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                         stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path [attr.d]="r.tile.iconPath"/>
                      @if (r.tile.iconExtra) { <path [attr.d]="r.tile.iconExtra"/> }
                    </svg>
                  </span>
                  <div class="pf-admin-tile__body">
                    <p class="pf-admin-tile__title">{{ r.tile.title }}</p>
                    <p class="pf-admin-tile__sub">{{ r.cat.label }}</p>
                  </div>
                  <span class="pf-admin-tile__arrow">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-6 6 6-6 6"/></svg>
                  </span>
                </a>
              } @empty {
                <p class="pf-band-empty">No settings match “{{ q() }}”.</p>
              }
            </div>
          } @else if (activeCategory(); as cat) {
            <header class="nd-card__head pf-admin-pane__hdr">
              <span class="nd-card__icon pf-admin-pane__chip">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="cat.iconPath"/>
                  @if (cat.iconExtra) { <path [attr.d]="cat.iconExtra"/> }
                </svg>
              </span>
              <h2 class="nd-card__label pf-admin-pane__title">{{ cat.label }}</h2>
              <p class="nd-card__note pf-admin-pane__blurb">{{ cat.blurb }}</p>
              <span class="pf-admin-pane__count nd-num">{{ cat.tiles.length }} {{ cat.tiles.length === 1 ? 'setting' : 'settings' }}</span>
            </header>

            <div class="pf-admin-pane__grid">
              @for (tile of cat.tiles; track tile.title) {
                <a [routerLink]="tile.href" [queryParams]="tile.queryParams ?? null"
                   class="pf-admin-tile nd-row group press">
                  <span class="nd-card__icon pf-admin-tile__icon">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                         stroke="currentColor" stroke-width="1.7"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path [attr.d]="tile.iconPath"/>
                      @if (tile.iconExtra) { <path [attr.d]="tile.iconExtra"/> }
                    </svg>
                  </span>
                  <div class="pf-admin-tile__body">
                    <p class="pf-admin-tile__title">{{ tile.title }}</p>
                    <p class="pf-admin-tile__sub">{{ tile.subtitle() }}</p>
                  </div>
                  <span class="pf-admin-tile__arrow">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M5 12h14m-5-6 6 6-6 6"/>
                    </svg>
                  </span>
                </a>
              }
            </div>

            <!-- Footer "what's in this section" panel — pads the bottom
                 of the pane for sparse categories (Identity has only 2
                 tiles; would otherwise leave a big dark void). -->
            <aside class="pf-admin-tips">
              <h3 class="pf-admin-tips__title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                What you can do here
              </h3>
              <ul class="pf-admin-tips__list">
                @for (tip of cat.tips; track tip) {
                  <li class="pf-admin-tips__item">
                    <span class="pf-admin-tips__bullet" aria-hidden="true"></span>
                    {{ tip }}
                  </li>
                }
              </ul>
            </aside>
          }
        </div>
      </div>
      </div>
    </section>
  `,
  styles: [`
    /* Page wrapper: claim the full viewport so the rail + pane fill
       the space and there's no big empty band at the bottom. The KPI
       strip + header stay above and the layout flexes to fill what's
       left. */
    .pf-admin-page {
      padding: 20px 24px;
      min-height: calc(100dvh - var(--top-strip-h, 64px));
      display: flex; flex-direction: column;
    }
    @media (max-width: 768px) {
      .pf-admin-page { padding: 14px; }
    }
    /* Native (Capacitor): add the top safe-area inset so the "Admin" header
       clears the status bar / Dynamic Island — and the taller status bar shown
       during an active call — instead of being clipped at the top edge. */
    :host-context(html.cap-native) .pf-admin-page {
      padding-top: calc(14px + env(safe-area-inset-top));
    }

    /* Compact header — was a tall greeting card. */
    .pf-admin-hdr {
      display: flex; flex-wrap: wrap; align-items: center;
      justify-content: space-between; gap: 16px;
      margin: 8px 0 16px;
    }
    .pf-admin-hdr__left {
      min-width: 0;
      flex: 1 1 auto;
    }
    .pf-admin-hdr__eyebrow {
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--text-muted);
      margin: 0 0 2px;
    }
    .pf-admin-hdr__title {
      font-size: 22px; font-weight: 700; letter-spacing: -0.01em;
      color: var(--text-primary);
      margin: 0;
    }
    .pf-admin-hdr__sub {
      font-size: 12.5px;
      color: var(--text-tertiary);
      margin: 4px 0 0;
    }
    .pf-admin-hdr__right {
      flex: 0 1 auto;
      min-width: 280px;
      max-width: 420px;
      width: 100%;
    }

    /* Mobile-only back chevron before the title (phone-only via md:hidden in
       markup; hidden on /admin root by NavBackService.showBack()). */
    .pf-hdr-back { width:38px; height:38px; margin-left:-8px; border-radius:11px; color:var(--text-primary); background:transparent; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform:scale(0.9); background:var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover:hover){ .pf-hdr-back:hover{ background:var(--glass-bg, rgba(255,255,255,0.06)); } }
    .pf-admin-search {
      width: 100%;
      padding: 9px 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13.5px;
    }
    .pf-admin-search::placeholder { color: var(--text-muted); }
    .pf-admin-search:focus { outline: none; border-color: var(--violet-500, #8b5cf6); box-shadow: 0 0 0 3px rgba(124,58,237,.18); }

    .pf-admin-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
      align-items: stretch;
      flex: 1;
      min-height: 0; /* allow children to shrink for overflow-y */
    }
    @media (max-width: 768px) {
      .pf-admin-layout { gap: 14px; }
    }

    /* ── Right pane ─────────────────────────────────────── */
    /* The pane is ONE kit card: BILLING-style header (violet icon chip +
       UPPERCASE label + note + a plain muted count), tiles scroll inside. */
    .pf-admin-pane { min-width: 0; overflow: visible; }
    .pf-admin-pane__hdr { margin: 0; }
    .pf-admin-pane__blurb { margin: 0; }
    .pf-admin-pane__grid, .pf-admin-tips { margin-left: 16px; margin-right: 16px; }
    .pf-admin-pane__grid { margin-top: 16px; }
    .pf-admin-pane > :last-child { margin-bottom: 16px; }
    .pf-admin-pane__title { margin: 0; }
    .pf-admin-pane__count { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-admin-pane__grid {
      display: grid;
      /* Larger min so each tile gets more room — 2-up on most desktops,
         3-up only on very wide monitors. Tiles also stretch to a
         minimum height so they have presence. */
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 14px;
      align-content: start;
    }

    /* ── Tile card ──────────────────────────────────────── */
    .pf-admin-tile {
      gap: 16px; padding: 18px; min-height: 96px; border-radius: var(--nd-radius);
      text-decoration: none;
      transition: border-color var(--nd-dur-fast) ease, transform 100ms ease;
    }
    .pf-admin-tile:hover { border-color: var(--nd-sel-border); transform: translateY(-1px); }
    .pf-admin-tile:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    /* Tile icon — inherits the active category's signature gradient.
       That single colour family is what makes the pane feel coherent
       (was a jumble of 3 random gradients per tile). */
    .pf-admin-tile__icon { width: 44px; height: 44px; border-radius: 12px; }
    .pf-admin-tile__body { flex: 1; min-width: 0; }
    .pf-admin-tile__title {
      font-weight: 600; font-size: 15px; line-height: 1.2; margin: 0;
      color: var(--text-primary); letter-spacing: -0.01em;
    }
    .pf-admin-tile__sub {
      font-size: 12.5px; line-height: 1.45; margin: 4px 0 0;
      color: var(--text-tertiary);
    }
    .pf-admin-tile__arrow {
      width: 30px; height: 30px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--text-muted);
      transition: color 0.15s, transform 0.15s;
      flex-shrink: 0;
    }
    .pf-admin-tile:hover .pf-admin-tile__arrow {
      color: var(--text-primary);
      transform: translateX(3px);
    }

    /* ── Tips panel below the grid ──────────────────────── */
    .pf-admin-tips {
      margin-top: 18px;
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--nd-chip-bg);
      border: 1px solid var(--nd-line);
    }
    .pf-admin-tips__title {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--text-secondary);
      margin: 0 0 10px;
    }
    .pf-admin-tips__list {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 6px;
    }
    .pf-admin-tips__item {
      display: flex; align-items: flex-start; gap: 10px;
      font-size: 12.5px; line-height: 1.45;
      color: var(--text-secondary);
    }
    .pf-admin-tips__bullet {
      flex-shrink: 0; margin-top: 7px;
      width: 6px; height: 6px; border-radius: 9999px; background: var(--nd-sel-border);
    }

    /* ─────────────────────────────────────────────────────────────
       CROSS-PLATFORM OVERRIDES — additive only. Desktop-web (>=1280,
       fine pointer) is untouched by everything below.
       ───────────────────────────────────────────────────────────── */

    /* Touch devices: the desktop :hover styles (lift transforms, colour
       shifts, chevron reveal) get stuck after a tap on coarse pointers.
       Neutralise them only where there's no true hover — this cannot
       reach a desktop mouse (hover:hover). */
    @media (prefers-reduced-motion: reduce) {
      .pf-admin-tile, .pf-admin-tile:hover, .pf-admin-tile__arrow { transition: none; transform: none; }
    }
    @media (hover: none) {
      .pf-admin-tile:hover {
        border-color: var(--nd-line);
        transform: none;
      }
      .pf-admin-tile:hover .pf-admin-tile__arrow {
        color: var(--text-muted);
        transform: none;
      }
    }

    /* Coarse-pointer sizing: guarantee the rail buttons and tiles meet
       the 44px touch target on phone/tablet. Cannot affect a fine
       desktop pointer. */
    @media (pointer: coarse) {
      .pf-admin-rail__btn { min-height: 44px; }
      .pf-admin-tile__arrow { width: 36px; height: 36px; }
    }

    /* Phone (<=640): single column already falls out of the 340px grid
       min + the 768px rail collapse, but tighten the search field so it
       can't push horizontal overflow, and give the horizontal rail row
       momentum scrolling without a scrollbar gutter. Cannot affect
       desktop. */
    @media (max-width: 640px) {
      /* >=16px so focusing the field never triggers iOS WKWebView auto-zoom. */
      .pf-admin-search { max-width: 100%; font-size: 16px; }
      .pf-admin-rail {
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .pf-admin-rail::-webkit-scrollbar { display: none; }
      .pf-admin-rail__btn { min-width: 160px; }
      .pf-admin-tile { padding: 16px; gap: 12px; min-height: 96px; }

      /* The 340px grid min overflows a ~360px phone (content area is
         narrower than the track min once page + pane padding is removed),
         producing horizontal scroll. Force a true single column. */
      .pf-admin-pane__grid { grid-template-columns: 1fr; }

      /* Kill the desktop nested-scroll model on phone: the rail + pane each
         own an internal overflow region sized by the flex:1 layout, which
         becomes a scroll trap and hides content behind the bottom-nav pill.
         Let the page flow naturally so the shell-main scroll container (which
         already reserves --tab-nav-total-height) handles scrolling + pill
         clearance. */
      .pf-admin-page { min-height: 0; }
      .pf-admin-layout { flex: 0 1 auto; min-height: 0; }
      .pf-admin-pane { overflow-y: visible; }
    }

    /* iPad / tablet band (641–1279): the category rail was removed, so the
       layout is a single full-width pane (same as desktop/phone). Earlier this
       band forced a 200px + pane two-column grid for the old rail, which now
       crams the lone pane into the 200px track and wastes the rest of the width.
       Use one full-width column and let the tiles go 2-up. Bounded so it can
       never touch desktop (>=1280) or phone (<=640). */
    @media (min-width: 641px) and (max-width: 1279px) {
      .pf-admin-layout {
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
      }
      .pf-admin-pane__grid {
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      }
    }
  `]
})
export class AdminDashboardComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  protected readonly navBack = inject(NavBackService);

  private readonly _summary = signal<SeedSummary | null>(null);
  readonly summary = this._summary.asReadonly();

  // Tenant-scoped counts for the KPI tiles. The /_seed/summary endpoint counts
  // across ALL tenants (OPS-32: a 1-branch tenant saw "35 branches"), and its
  // role count only covers global pre-seeded roles (OPS-21: a new custom role
  // never showed up). These are fetched per-tenant on every visit instead.
  private readonly _branchCount = signal<number | null>(null);
  private readonly _deptCount = signal<number | null>(null);
  private readonly _roleCount = signal<number | null>(null);
  readonly today = new Date();
  readonly userName = () => this.auth.user()?.firstName || this.auth.user()?.displayName || 'there';

  // ── Categories + tiles ──────────────────────────────────
  // Tiles map 1:1 to existing admin routes. Subtitles read live
  // counts from /api/_seed/summary where applicable so the dashboard
  // doubles as a quick status glance.
  readonly categories: Category[] = [
    {
      id: 'people',
      label: 'People & Access',
      gradient: 'violet',
      iconPath: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
      iconExtra: 'M2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
      blurb: 'Who can do what — staff, roles and a full audit trail of every change.',
      tips: [
        'Invite new staff by email; they pick a password on first sign-in.',
        'Permissions are bundled into roles (Reception, Lab Tech, Pathologist…).',
        'The audit trail records every change — who, when, before → after.'
      ],
      tiles: [
        { title: 'Users & Access', href: '/admin/users', gradient: 'violet',
          iconPath: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
          iconExtra: 'M2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21.5 20a5 5 0 0 0-4.5-4',
          subtitle: () => `${this._roleCount() ?? '—'} roles · ${this._summary()?.permissions ?? '—'} permissions` },
        { title: 'Audit trail', href: '/admin/audit', gradient: 'rose',
          iconPath: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
          iconExtra: 'M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2ZM9 12h6M9 16h6',
          subtitle: () => 'Every change — who, when, before→after' },
      ]
    },
    {
      id: 'org',
      label: 'Branches & Organization',
      gradient: 'sky',
      iconPath: 'M4 21V7l8-4 8 4v14',
      iconExtra: 'M9 21v-5h6v5',
      blurb: 'The structure of your lab — branches, departments, collection/billing modes, queues, referrers.',
      tips: [
        'Add branches as you grow; toggle front-desk vs dedicated-counter collection per branch.',
        'Configure queue modes, slots and home-collection agent coverage.',
        'Maintain the referring hospitals + doctors that send you patients.'
      ],
      tiles: [
        { title: 'Branches & Departments', href: '/admin/branches', gradient: 'sky',
          iconPath: 'M4 21V7l8-4 8 4v14', iconExtra: 'M9 21v-5h6v5M12 8v4m-2-2h4',
          subtitle: () => `${this._branchCount() ?? '—'} branches · ${this._deptCount() ?? '—'} departments` },
        { title: 'Organization & Identity', href: '/admin/organization', gradient: 'sky',
          iconPath: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
          subtitle: () => 'Patient ID format · data tools' },
        { title: 'Appointments & queue', href: '/admin/appointments', gradient: 'amber',
          iconPath: 'M8 2v4M16 2v4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', iconExtra: 'M3 10h18M8 14h.01M12 14h.01M16 14h.01',
          subtitle: () => 'Queue mode · slots · priority engine' },
        { title: 'Referral & Vendors', href: '/admin/partners', gradient: 'fuchsia',
          iconPath: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01',
          subtitle: () => 'Referral labs, vendor wallets & referring network — all here' },
        { title: 'Branding', href: '/setup', gradient: 'violet',
          iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', iconExtra: 'M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
          subtitle: () => 'Logo & lab name shown in the top bar' },
      ]
    },
    {
      id: 'finance',
      label: 'Billing & Finance',
      gradient: 'amber',
      iconPath: 'M3 5h18v14H3z',
      iconExtra: 'M3 10h18M7 15h3',
      blurb: 'Money flow — GST registration, discount policy, invoice numbering, vendor (B2B) wallets.',
      tips: [
        'Set GST rate + filing frequency per branch; tax slabs roll up automatically.',
        'Cap reception discounts to keep margins; require approval above a threshold.',
        'Vendor wallets let referring hospitals / collection centres run on credit.'
      ],
      tiles: [
        { title: 'Finance', href: '/finance', gradient: 'emerald',
          iconPath: 'M3 3v18h18', iconExtra: 'M7 14l4-4 3 3 5-6',
          subtitle: () => 'End-to-end money in vs out · Lab · export CSV' },
        { title: 'Billing Config',  href: '/admin/billing', gradient: 'amber',
          iconPath: 'M3 5h18v14H3z', iconExtra: 'M3 10h18M7 15h3',
          subtitle: () => 'GST, discounts, invoice numbering, UPI / online payment' },
        { title: 'Daily Statement',  href: '/finance/daily', gradient: 'amber',
          iconPath: 'M4 4h16v16H4z', iconExtra: 'M8 9h8M8 13h8M8 17h5',
          subtitle: () => 'Opening / closing balance · cash count · day closure' },
        { title: 'Vendor Credit Wallets',  href: '/admin/vendors', gradient: 'fuchsia',
          iconPath: 'M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14',
          iconExtra: 'M17 14h.01',
          subtitle: () => 'B2B credit accounts · top-ups & usage' },
      ]
    },
    {
      id: 'automation',
      label: 'Platform & Automation',
      gradient: 'pink',
      iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z',
      iconExtra: 'M9 7h6M12 14V10',
      blurb: 'Cross-module platform controls — enable modules, and design the menus/forms staff use.',
      tips: [
        'Modules: turn products (Lab, OPD, IPD, Pharmacy…) and their features on or off.',
        'Process builder: which menus exist, what actions sit inside, and who can use them.',
        'Form flows: drag-build the Patient Register, Order Create and Appointment fields.'
      ],
      tiles: [
        { title: 'Process builder', href: '/admin/process', gradient: 'pink',
          iconPath: 'M4 5h5v5H4zM15 5h5v5h-5zM9.5 7.5h5.5M7 10v4a2 2 0 0 0 2 2h6M9 16h5v4H9z',
          subtitle: () => 'Menus, actions & role access — drives the live nav' },
        { title: 'Form Flows',    href: '/admin/workflows', gradient: 'pink',
          iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z', iconExtra: 'M9 7h6M12 14V10',
          subtitle: () => `${this._summary()?.workflows ?? '—'} screen forms configured` },
      ]
    },
  ];

  private readonly _active = signal<string>(this.categories[0].id);
  readonly active = this._active.asReadonly();
  readonly activeCategory = computed<Category | undefined>(() =>
    this.categories.find(c => c.id === this._active())
  );
  select(id: string) { this._active.set(id); }

  protected readonly theme = inject(ThemeService);
  /** Category switch in the band pill (short labels; icons on phones). */
  readonly categoryOptions: SegmentedOption<string>[] = this.categories.map(c => ({
    value: c.id,
    label: ({ people: 'People & Access', org: 'Branches & Org', finance: 'Billing & Finance', automation: 'Platform' } as Record<string, string>)[c.id] ?? c.label,
    iconPath: [c.iconPath, ...(c.iconExtra ? [c.iconExtra] : [])],
  }));
  /** Picking a category from the pill leaves search mode so the pick shows. */
  pickCategory(id: string) { this._q.set(''); this._active.set(id); }

  // Admin-wide tile search: flatten every category's tiles and match on title,
  // subtitle, and category label so a setting is one keystroke away.
  private readonly _q = signal('');
  readonly q = this._q.asReadonly();
  setQ(v: string) { this._q.set(v ?? ''); }
  readonly results = computed<{ tile: Tile; cat: Category }[]>(() => {
    const term = this._q().trim().toLowerCase();
    if (!term) return [];
    const out: { tile: Tile; cat: Category }[] = [];
    for (const cat of this.categories) {
      for (const tile of cat.tiles) {
        let sub = '';
        try { sub = tile.subtitle() ?? ''; } catch { /* summary not loaded */ }
        if (`${tile.title} ${sub} ${cat.label} ${cat.blurb}`.toLowerCase().includes(term)) {
          out.push({ tile, cat });
        }
      }
    }
    return out;
  });

  ngOnInit(): void {
    // Optional deep-link: /admin?cat=billing routes straight in.
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat');
    if (cat && this.categories.some(c => c.id === cat)) this._active.set(cat);
    this.api.get<SeedSummary>('/api/_seed/summary').subscribe({
      next: s => this._summary.set(s)
    });
    // Tenant-scoped KPI counts (re-fetched on every visit, so a newly created
    // role / branch reflects immediately).
    this.api.get<unknown[]>('/api/tenants/branches').subscribe({ next: b => this._branchCount.set(b?.length ?? 0) });
    this.api.get<unknown[]>('/api/tenants/departments').subscribe({ next: d => this._deptCount.set(d?.length ?? 0) });
    this.api.get<unknown[]>('/api/roles/').subscribe({ next: r => this._roleCount.set(r?.length ?? 0) });
  }
}
