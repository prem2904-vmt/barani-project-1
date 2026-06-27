import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';

interface SeedSummary {
  tenants: number; branches: number; departments: number;
  permissions: number; preSeededRoles: number; tests: number; workflows: number;
}

interface DashMetrics {
  from: string; to: string;
  cashIn: number; cashOut: number; net: number;
  revenue: number; balanceDue: number;
  patients: number; orders: number; tests: number;
}

type RangeKey = 'today' | 'yesterday' | '7d' | '30d';

interface KpiCard {
  key: keyof DashMetrics;
  label: string;
  kind: 'money' | 'count';
  color: string;     // data-color for the accent
  icon: string;      // svg path
  sub?: string;
}

/**
 * Admin landing = the connected business dashboard. A date filter (today by
 * default) drives a live KPI grid pulled from /api/dashboard/metrics — cash in
 * / out / net, billed revenue, outstanding balance, and patient / order / test
 * volumes for the window. Below it: at-a-glance config counts and shortcuts into
 * the settings hub (`/admin/manage`).
 */
@Component({
  selector: 'pf-admin-overview',
  standalone: true,
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-ov">
      <header class="pf-ov__hdr">
        <div class="pf-ov__hdr-l">
          <p class="pf-ov__eyebrow">{{ today | date:'EEEE, MMM d' }}</p>
          <h1 class="pf-ov__title">Overview · <span class="text-gradient">{{ userName() }}</span></h1>
        </div>
      </header>

      <!-- Date filter -->
      <div class="pf-ov__filter" role="tablist" aria-label="Date range">
        <!-- Desktop / iPad: segmented pills. -->
        @for (r of ranges; track r.key) {
          <button type="button" role="tab" class="pf-ov__range"
                  [class.pf-ov__range--on]="range() === r.key"
                  [attr.aria-selected]="range() === r.key"
                  (click)="setRange(r.key)">{{ r.label }}</button>
        }
        <!-- Phone: a single status button + dropdown (same pattern as the lab
             Stats popover) so the row stays compact. -->
        <div class="pf-ov__range-dd">
          <button type="button" class="pf-ov__range-ddbtn" [class.is-open]="filterOpen()"
                  [attr.aria-expanded]="filterOpen()" (click)="filterOpen.set(!filterOpen())">
            <span>{{ rangeLabel() }}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          @if (filterOpen()) {
            <div class="pf-ov__range-bd" aria-hidden="true" (click)="filterOpen.set(false)"></div>
            <div class="pf-ov__range-pop" role="menu" aria-label="Date range">
              @for (r of ranges; track r.key) {
                <button type="button" role="menuitemradio" class="pf-ov__range-opt"
                        [class.is-on]="range() === r.key"
                        [attr.aria-checked]="range() === r.key"
                        (click)="setRange(r.key); filterOpen.set(false)">{{ r.label }}</button>
              }
            </div>
          }
        </div>
        <span class="pf-ov__filter-spacer"></span>
        <button type="button" class="pf-ov__refresh press" (click)="load()" aria-label="Refresh"
                [class.pf-ov__refresh--busy]="loading()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>
          </svg>
        </button>
      </div>

      <!-- Hero: connected KPI grid for the chosen window. -->
      <div class="pf-ov__kpis" [class.pf-ov__kpis--loading]="loading() && !metrics()">
        @for (c of cards; track c.key) {
          <div class="pf-ov__kpi" [attr.data-color]="c.color">
            <span class="pf-ov__kpi-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path [attr.d]="c.icon"/>
              </svg>
            </span>
            <span class="pf-ov__kpi-l">{{ c.label }}</span>
            <span class="pf-ov__kpi-v">{{ formatCard(c) }}</span>
          </div>
        }
      </div>

      <!-- At-a-glance configuration counts. -->
      <p class="pf-ov__section">Configuration</p>
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
    /* Use the full screen width on web — the KPI / config / manage grids all
       auto-fit, so they spread into the freed space instead of sitting in a
       narrow centred column. A high cap (2200px) just stops absurd stretch on
       ultra-wide 4K displays. Phone/iPad are unaffected (already full-width). */
    .pf-ov { padding: 24px 16px 48px; max-width: 2200px; margin: 0 auto; }
    @media (min-width: 768px) { .pf-ov { padding: 28px 40px 48px; } }
    .pf-ov__hdr { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
    .pf-ov__eyebrow { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--text-muted); margin: 0; }
    .pf-ov__hdr-l { min-width: 0; }
    .pf-ov__title { font-size: 24px; font-weight: 800; letter-spacing: -.02em; margin: 6px 0 0; color: var(--text-primary); overflow-wrap: anywhere; }
    .text-gradient { background: var(--gradient-primary); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
    .pf-ov__manage { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font-size: 13px; font-weight: 700;
      border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary); }
    .pf-ov__manage svg { flex-shrink: 0; }
    @media (hover: hover) { .pf-ov__manage:hover { color: #fff; border-color: var(--glass-border-hover); } }

    /* ── Date filter ── */
    .pf-ov__filter { display: flex; align-items: center; gap: 6px; margin-bottom: 14px; }
    .pf-ov__range {
      padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 700; cursor: pointer;
      border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary);
      transition: background .15s, color .15s, border-color .15s;
    }
    .pf-ov__range--on { background: var(--gradient-primary); border-color: transparent; color: #fff; }
    @media (hover: hover) { .pf-ov__range:not(.pf-ov__range--on):hover { color: var(--text-primary); border-color: var(--glass-border-hover); } }
    .pf-ov__filter-spacer { flex: 1; }
    .pf-ov__refresh { width: 38px; height: 38px; border-radius: 11px; display: inline-grid; place-items: center; flex-shrink: 0;
      border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary); cursor: pointer; }
    .pf-ov__refresh--busy svg { animation: pf-ov-spin .8s linear infinite; }
    @keyframes pf-ov-spin { to { transform: rotate(360deg); } }

    /* Phone date dropdown (status button + popover) — hidden on desktop/iPad
       where the segmented pills show instead. */
    .pf-ov__range-dd { position: relative; display: none; }
    .pf-ov__range-ddbtn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 999px;
      font-size: 13px; font-weight: 700; border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-primary); cursor: pointer; }
    .pf-ov__range-ddbtn svg { transition: transform .15s ease; }
    .pf-ov__range-ddbtn.is-open svg { transform: rotate(180deg); }
    .pf-ov__range-bd { position: fixed; inset: 0; z-index: 60; background: transparent; }
    .pf-ov__range-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 61; display: flex; flex-direction: column; gap: 2px;
      min-width: 170px; padding: 6px; border-radius: 12px; background: var(--bg-card-solid, #14141f); border: 1px solid var(--glass-border-hover, var(--glass-border)); box-shadow: 0 20px 48px rgba(0,0,0,0.5); }
    .pf-ov__range-opt { text-align: left; padding: 11px 12px; border-radius: 9px; font-size: 13.5px; font-weight: 600; background: transparent; border: 0; color: var(--text-secondary); cursor: pointer; }
    .pf-ov__range-opt.is-on { background: var(--gradient-primary); color: #fff; }

    /* ── KPI grid ── */
    .pf-ov__kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .pf-ov__kpis--loading { opacity: .5; }
    .pf-ov__kpi { position: relative; padding: 16px 16px 15px; border-radius: 16px; border: 1px solid var(--glass-border);
      background: var(--bg-card-solid, #14141f); display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
    .pf-ov__kpi::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--kc, #8b5cf6); }
    .pf-ov__kpi-ic { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; margin-bottom: 8px;
      background: color-mix(in srgb, var(--kc, #8b5cf6) 16%, transparent); color: var(--kc, #8b5cf6); }
    .pf-ov__kpi-ic svg { width: 18px; height: 18px; }
    .pf-ov__kpi-l { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
    .pf-ov__kpi-v { font-size: 25px; font-weight: 800; letter-spacing: -.02em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-ov__kpi[data-color="emerald"] { --kc: #34d399; }
    .pf-ov__kpi[data-color="rose"]    { --kc: #fb7185; }
    .pf-ov__kpi[data-color="violet"]  { --kc: #a78bfa; }
    .pf-ov__kpi[data-color="amber"]   { --kc: #fbbf24; }
    .pf-ov__kpi[data-color="orange"]  { --kc: #fb923c; }
    .pf-ov__kpi[data-color="blue"]    { --kc: #60a5fa; }
    .pf-ov__kpi[data-color="teal"]    { --kc: #2dd4bf; }
    .pf-ov__kpi[data-color="pink"]    { --kc: #f472b6; }

    .pf-ov__stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 10px 0 8px; }
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
    @media (hover: none) {
      .pf-ov__card:hover { transform: none; border-color: var(--glass-border); }
      .pf-ov__card:active { transform: translateY(-1px); border-color: var(--violet-500, #8b5cf6); }
      .pf-ov__stat--link:hover { border-color: var(--glass-border); }
    }
    @media (pointer: coarse) {
      .pf-ov__manage { min-height: 44px; padding-top: 11px; padding-bottom: 11px; }
      .pf-ov__range, .pf-ov__refresh { min-height: 44px; }
      .pf-ov__stat--link, .pf-ov__card { min-height: 44px; }
    }

    /* ---- Phone (<=640) ---- */
    @media (max-width: 640px) {
      .pf-ov__title { font-size: 21px; }
      /* Phone: swap the segmented pills for the compact status dropdown. */
      .pf-ov__range { display: none; }
      .pf-ov__range-dd { display: inline-flex; }
      .pf-ov__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pf-ov__kpi-v { font-size: 21px; }
    }

    /* ---- Web-below-desktop band (641-1279, incl. iPad + narrow browsers) ---- */
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

  readonly metrics = signal<DashMetrics | null>(null);
  readonly loading = signal(false);
  readonly range = signal<RangeKey>('today');
  readonly filterOpen = signal(false);
  readonly rangeLabel = computed(() => this.ranges.find(r => r.key === this.range())?.label ?? 'Today');

  readonly ranges: Array<{ key: RangeKey; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' },
  ];

  /** Hero KPI cards — keys map onto the metrics payload. */
  readonly cards: KpiCard[] = [
    { key: 'cashIn',     label: 'Cash in',      kind: 'money', color: 'emerald', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
    { key: 'cashOut',    label: 'Cash out',     kind: 'money', color: 'rose',    icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
    { key: 'net',        label: 'Net cash',     kind: 'money', color: 'violet',  icon: 'M3 17l6-6 4 4 8-8M21 7v5h-5' },
    { key: 'revenue',    label: 'Billed',       kind: 'money', color: 'amber',   icon: 'M4 4h16v16l-3-2-2 2-3-2-3 2-2-2-3 2zM8 9h8M8 13h5' },
    { key: 'balanceDue', label: 'Balance due',  kind: 'money', color: 'orange',  icon: 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' },
    { key: 'patients',   label: 'Patients',     kind: 'count', color: 'blue',    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87' },
    { key: 'orders',     label: 'Orders',       kind: 'count', color: 'teal',    icon: 'M9 5h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 11h6M9 15h4' },
    { key: 'tests',      label: 'Tests',        kind: 'count', color: 'pink',    icon: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9' },
  ];

  readonly groups = [
    { cat: 'catalog',    label: 'Tests & Catalog',        blurb: 'Tests, packages, inventory, report layout',          icon: 'M11 4h3v9m-3-9v9h3m-3 0c-4-1-4-7 0-9' },
    { cat: 'people',     label: 'People & Access',         blurb: 'Users, roles and the audit trail',                   icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' },
    { cat: 'org',        label: 'Branches & Organization', blurb: 'Branches, lab settings, queue, referrers',           icon: 'M4 21V7l8-4 8 4v14' },
    { cat: 'finance',    label: 'Billing & Finance',       blurb: 'GST, discounts, invoices, vendor wallets',           icon: 'M3 5h18v14H3z' },
    { cat: 'automation', label: 'Workflow & Automation',   blurb: 'Process, form flows, notifications, KPIs',           icon: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z' },
  ];

  ngOnInit(): void {
    this.api.get<SeedSummary>('/api/_seed/summary').subscribe({ next: s => this.summary.set(s) });
    this.load();
  }

  setRange(r: RangeKey): void {
    if (this.range() === r) return;
    this.range.set(r);
    this.load();
  }

  load(): void {
    const { from, to } = this.windowFor(this.range());
    this.loading.set(true);
    const url = `/api/dashboard/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    this.api.get<DashMetrics>(url).subscribe({
      next: m => { this.metrics.set(m); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  /** Local-midnight window boundaries for the chosen range, as ISO instants. */
  private windowFor(r: RangeKey): { from: string; to: string } {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    let from = new Date(startOfToday);
    let to = new Date(startOfTomorrow);
    if (r === 'yesterday') {
      from.setDate(from.getDate() - 1);
      to = new Date(startOfToday);
    } else if (r === '7d') {
      from.setDate(from.getDate() - 6);
    } else if (r === '30d') {
      from.setDate(from.getDate() - 29);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }

  formatCard(c: KpiCard): string {
    const m = this.metrics();
    if (!m) return '—';
    const v = Number(m[c.key] ?? 0);
    if (c.kind === 'money') {
      const sign = v < 0 ? '-' : '';
      return `${sign}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    }
    return v.toLocaleString('en-IN');
  }
}
