import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { KpiStripComponent } from '../../shared/components/kpi-strip/kpi-strip.component';

interface SeedSummary {
  tenants: number; branches: number; departments: number;
  permissions: number; preSeededRoles: number; tests: number; workflows: number;
}

/**
 * Admin landing = the metrics overview. The live KPI strip (sales today /
 * yesterday, revenue, etc., configured under Admin → KPI cards) is the hero;
 * below it are at-a-glance config counts and shortcut cards into the
 * relevance-grouped settings hub (`/admin/manage`). The full settings hub
 * lives on its own page so this screen stays metrics-first.
 */
@Component({
  selector: 'pf-admin-overview',
  standalone: true,
  imports: [RouterLink, DatePipe, KpiStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-ov">
      <header class="pf-ov__hdr">
        <div class="pf-ov__hdr-l">
          <p class="pf-ov__eyebrow">{{ today | date:'EEEE, MMM d' }}</p>
          <h1 class="pf-ov__title">Overview · <span class="text-gradient">{{ userName() }}</span></h1>
        </div>
        <a routerLink="/admin/manage" class="pf-ov__manage press">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7M4.6 9a1.6 1.6 0 0 0-.3-1.7"/>
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>
          </svg>
          Manage settings
        </a>
      </header>

      <!-- Hero: live KPI metrics for the admin screen. -->
      <pf-kpi-strip screen="admin"></pf-kpi-strip>

      <!-- At-a-glance configuration counts. -->
      <div class="pf-ov__stats">
        <div class="pf-ov__stat"><span class="pf-ov__stat-v">{{ summary()?.branches ?? '—' }}</span><span class="pf-ov__stat-l">Branches</span></div>
        <div class="pf-ov__stat"><span class="pf-ov__stat-v">{{ summary()?.departments ?? '—' }}</span><span class="pf-ov__stat-l">Departments</span></div>
        <div class="pf-ov__stat"><span class="pf-ov__stat-v">{{ summary()?.tests ?? '—' }}</span><span class="pf-ov__stat-l">Tests</span></div>
        <div class="pf-ov__stat"><span class="pf-ov__stat-v">{{ summary()?.preSeededRoles ?? '—' }}</span><span class="pf-ov__stat-l">Roles</span></div>
        <div class="pf-ov__stat"><span class="pf-ov__stat-v">{{ summary()?.workflows ?? '—' }}</span><span class="pf-ov__stat-l">Form flows</span></div>
        <a routerLink="/dashboard" class="pf-ov__stat pf-ov__stat--link press">
          <span class="pf-ov__stat-v">TAT</span><span class="pf-ov__stat-l">Live turnaround →</span>
        </a>
      </div>

      <!-- Shortcuts into the settings hub, grouped by relevance. -->
      <p class="pf-ov__section">Manage</p>
      <div class="pf-ov__cards">
        @for (g of groups; track g.cat) {
          <a [routerLink]="['/admin/manage']" [queryParams]="{ cat: g.cat }" class="pf-ov__card press">
            <span class="pf-ov__card-ic" [attr.data-g]="g.cat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path [attr.d]="g.icon"/>
              </svg>
            </span>
            <span class="pf-ov__card-t">{{ g.label }}</span>
            <span class="pf-ov__card-s">{{ g.blurb }}</span>
          </a>
        }
      </div>
    </section>
  `,
  styles: [`
    .pf-ov { padding: 24px 16px 48px; max-width: 1180px; margin: 0 auto; }
    @media (min-width: 768px) { .pf-ov { padding: 28px 32px 48px; } }
    .pf-ov__hdr { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
    .pf-ov__eyebrow { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--text-muted); margin: 0; }
    .pf-ov__hdr-l { min-width: 0; }
    .pf-ov__title { font-size: 24px; font-weight: 800; letter-spacing: -.02em; margin: 6px 0 0; color: var(--text-primary); overflow-wrap: anywhere; }
    .text-gradient { background: var(--gradient-primary); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
    .pf-ov__manage { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font-size: 13px; font-weight: 700;
      border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary); }
    .pf-ov__manage svg { flex-shrink: 0; }
    @media (hover: hover) { .pf-ov__manage:hover { color: #fff; border-color: var(--glass-border-hover); } }

    .pf-ov__stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 18px 0 8px; }
    @media (min-width: 720px) { .pf-ov__stats { grid-template-columns: repeat(6, 1fr); } }
    .pf-ov__stat { padding: 14px 16px; border-radius: 14px; border: 1px solid var(--glass-border); background: var(--bg-card-solid, #14141f); display: flex; flex-direction: column; }
    .pf-ov__stat--link:hover { border-color: var(--violet-500, #8b5cf6); }
    .pf-ov__stat-v { font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-ov__stat-l { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); margin-top: 3px; }

    .pf-ov__section { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--text-muted); margin: 22px 0 10px; }
    .pf-ov__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .pf-ov__card { display: flex; flex-direction: column; gap: 4px; padding: 16px; border-radius: 16px; border: 1px solid var(--glass-border); background: var(--bg-card-solid, #14141f); transition: border-color .15s, transform .15s; }
    .pf-ov__card:hover { border-color: var(--violet-500, #8b5cf6); transform: translateY(-2px); }
    .pf-ov__card-ic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: rgba(124,58,237,.14); color: var(--violet-300, #c4b5fd); margin-bottom: 6px; }
    .pf-ov__card-ic svg { width: 19px; height: 19px; }
    .pf-ov__card-ic[data-g="catalog"] { background: rgba(16,185,129,.14); color: #6ee7b7; }
    .pf-ov__card-ic[data-g="org"] { background: rgba(59,130,246,.14); color: #93c5fd; }
    .pf-ov__card-ic[data-g="finance"] { background: rgba(245,158,11,.14); color: #fcd34d; }
    .pf-ov__card-ic[data-g="automation"] { background: rgba(236,72,153,.14); color: #f9a8d4; }
    .pf-ov__card-t { font-size: 15px; font-weight: 700; color: var(--text-primary); }
    .pf-ov__card-s { font-size: 12.5px; color: var(--text-tertiary); }

    /* ---- Touch / non-hover overrides (additive; never affect desktop hover) ---- */
    /* On touch devices, neutralize hover transforms/border so they don't stick after a tap. */
    @media (hover: none) {
      .pf-ov__card:hover { transform: none; border-color: var(--glass-border); }
      .pf-ov__card:active { transform: translateY(-1px); border-color: var(--violet-500, #8b5cf6); }
      .pf-ov__stat--link:hover { border-color: var(--glass-border); }
    }
    /* Coarse pointers: guarantee >=44px tap targets without changing the desktop look. */
    @media (pointer: coarse) {
      .pf-ov__manage { min-height: 44px; padding-top: 11px; padding-bottom: 11px; }
      .pf-ov__stat--link, .pf-ov__card { min-height: 44px; }
    }

    /* ---- Phone (<=640): ensure stat link / cards remain comfortable single-/two-up ---- */
    @media (max-width: 640px) {
      .pf-ov__title { font-size: 21px; }
      /* Header action goes full-width so it isn't cramped beside the title. */
      .pf-ov__manage { width: 100%; justify-content: center; }
    }

    /* ---- Web-below-desktop band (641-1279, incl. iPad + narrow browsers) ----
       The 6-up stat grid (which kicks in at >=720px) is too cramped beside the
       64px left rail at the lower end of this band. Drop to 3-up so the 6 stats
       form a tidy 2x3 with the title sitting above the same left edge. */
    @media (min-width: 641px) and (max-width: 1279px) {
      .pf-ov__stats { grid-template-columns: repeat(3, 1fr); }
    }
  `]
})
export class AdminOverviewComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly today = new Date();
  readonly userName = computed(() => this.auth.user()?.firstName || this.auth.user()?.displayName?.split(' ')[0] || 'Admin');
  readonly summary = signal<SeedSummary | null>(null);

  /** Shortcut cards into the settings hub, one per relevance group. */
  readonly groups = [
    { cat: 'catalog',    label: 'Tests & Catalog',        blurb: 'Tests, packages, inventory, report layout',          icon: 'M11 4h3v9m-3-9v9h3m-3 0c-4-1-4-7 0-9' },
    { cat: 'people',     label: 'People & Access',         blurb: 'Users, roles and the audit trail',                   icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' },
    { cat: 'org',        label: 'Branches & Organization', blurb: 'Branches, lab settings, queue, referrers',           icon: 'M4 21V7l8-4 8 4v14' },
    { cat: 'finance',    label: 'Billing & Finance',       blurb: 'GST, discounts, invoices, vendor wallets',           icon: 'M3 5h18v14H3z' },
    { cat: 'automation', label: 'Workflow & Automation',   blurb: 'Process, form flows, notifications, KPIs',           icon: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z' },
  ];

  ngOnInit(): void {
    this.api.get<SeedSummary>('/api/_seed/summary').subscribe({ next: s => this.summary.set(s) });
  }
}
