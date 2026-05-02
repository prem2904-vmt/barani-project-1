import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { KpiStripComponent } from '../../shared/components/kpi-strip/kpi-strip.component';

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
  gradient: GradientKey;
  /** SVG `d` path, drawn on 24×24 viewBox with currentColor stroke. */
  iconPath: string;
  /** Optional second path inside the same icon. */
  iconExtra?: string;
  subtitle: () => string;
}

@Component({
  selector: 'pf-admin-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, KpiStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-5 md:px-8 pt-5 pb-10">

      <!-- Admin-configured KPI strip — silently hides if nothing is assigned. -->
      <pf-kpi-strip screen="admin"></pf-kpi-strip>

      <!-- Eyebrow + greeting -->
      <header class="mb-6">
        <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
           style="color: var(--text-muted);">
          {{ today | date:'EEEE, MMM d' }}
        </p>
        <h1 class="mt-1 text-[32px] md:text-[40px] leading-[1.05] font-semibold tracking-tight"
            style="color: var(--text-primary);">
          Good day, <span class="text-gradient">{{ userName() }}</span>.
        </h1>
      </header>

      <!-- KPI row removed — admin-configurable KPIs render via the
           <pf-kpi-strip screen="admin"> at the top of this section. -->

      <!-- Configuration tiles -->
      <h2 class="text-[11px] font-mono uppercase tracking-[0.14em] mb-3"
          style="color: var(--text-muted);">Configuration</h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4">
        @for (tile of tiles; track tile.title) {
          <a [routerLink]="tile.href" class="pf-card group press block">
            <div class="flex items-start gap-4">
              <span class="pf-tile-icon shrink-0" [attr.data-g]="tile.gradient">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                     stroke="currentColor" stroke-width="1.75"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path [attr.d]="tile.iconPath"/>
                  @if (tile.iconExtra) { <path [attr.d]="tile.iconExtra"/> }
                </svg>
              </span>
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ tile.title }}</p>
                <p class="mt-0.5 text-[12.5px]" style="color: var(--text-tertiary);">{{ tile.subtitle() }}</p>
              </div>
              <span class="pf-tile-arrow shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14m-5-6 6 6-6 6"/>
                </svg>
              </span>
            </div>
          </a>
        }
      </div>
    </section>
  `,
  styles: [`
    .pf-tile-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      position: relative;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .pf-tile-icon::after {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 18px;
      background: inherit;
      opacity: 0.22;
      filter: blur(10px);
      z-index: -1;
      transition: opacity 0.3s ease, filter 0.3s ease;
    }
    :host :global(.pf-card:hover) .pf-tile-icon        { transform: scale(1.06); }
    :host :global(.pf-card:hover) .pf-tile-icon::after { opacity: 0.4; filter: blur(14px); }

    /* Gradient variants — background: inherit hits ::after too. */
    .pf-tile-icon[data-g='violet']   { background: linear-gradient(135deg, #7c3aed, #a855f7); }
    .pf-tile-icon[data-g='fuchsia']  { background: linear-gradient(135deg, #9333ea, #d946ef); }
    .pf-tile-icon[data-g='pink']     { background: linear-gradient(135deg, #db2777, #f472b6); }
    .pf-tile-icon[data-g='rose']     { background: linear-gradient(135deg, #e11d48, #fb7185); }
    .pf-tile-icon[data-g='amber']    { background: linear-gradient(135deg, #d97706, #fbbf24); }
    .pf-tile-icon[data-g='emerald']  { background: linear-gradient(135deg, #059669, #10b981); }
    .pf-tile-icon[data-g='teal']     { background: linear-gradient(135deg, #0d9488, #2dd4bf); }
    .pf-tile-icon[data-g='sky']      { background: linear-gradient(135deg, #0284c7, #38bdf8); }

    .pf-tile-arrow {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: transform 0.25s ease, color 0.25s ease, background 0.25s ease;
    }
    :host :global(.pf-card:hover) .pf-tile-arrow {
      color: var(--text-primary);
      background: var(--glass-bg-hover);
      transform: translateX(2px);
    }
  `]
})
export class AdminDashboardComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);

  private readonly _summary = signal<SeedSummary | null>(null);

  readonly today = new Date();
  readonly userName = () => this.auth.user()?.firstName || this.auth.user()?.displayName || 'there';
  readonly summary = this._summary.asReadonly();

  readonly tiles: Tile[] = [
    {
      title: 'Users & Access',
      href: '/admin/users',
      gradient: 'violet',
      iconPath: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
      iconExtra: 'M2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21.5 20a5 5 0 0 0-4.5-4',
      subtitle: () => `${this._summary()?.preSeededRoles ?? '—'} pre-seeded roles · ${this._summary()?.permissions ?? '—'} permissions`
    },
    {
      title: 'Tests & Packages',
      href: '/admin/tests',
      gradient: 'emerald',
      iconPath: 'M11 4h3v9M11 13h3M11 4v9c-4-1-4-7 0-9ZM14 7h2a3 3 0 0 1 3 3',
      iconExtra: 'M6 21h14M9 17h8',
      subtitle: () => `${this._summary()?.tests ?? '—'} tests configured`
    },
    {
      title: 'Branches',
      href: '/admin/branches',
      gradient: 'sky',
      iconPath: 'M4 21V7l8-4 8 4v14',
      iconExtra: 'M9 21v-5h6v5M12 8v4m-2-2h4',
      subtitle: () => `${this._summary()?.branches ?? '—'} branches · ${this._summary()?.departments ?? '—'} departments`
    },
    {
      title: 'Billing Config',
      href: '/admin/billing',
      gradient: 'amber',
      iconPath: 'M3 5h18v14H3z',
      iconExtra: 'M3 10h18M7 15h3',
      subtitle: () => 'GST, discounts, invoice settings'
    },
    {
      title: 'Vendor Wallets',
      href: '/admin/vendors',
      gradient: 'fuchsia',
      iconPath: 'M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14',
      iconExtra: 'M17 14h.01',
      subtitle: () => 'B2B credit accounts · top-ups & usage history'
    },
    {
      title: 'Report Template',
      href: '/admin/reports',
      gradient: 'fuchsia',
      iconPath: 'M4 4h11l5 5v11H4z',
      iconExtra: 'M15 4v5h5M8 14h8M8 18h6',
      subtitle: () => 'Branding, layout, footer'
    },
    {
      title: 'Notifications',
      href: '/admin/notifications',
      gradient: 'rose',
      iconPath: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z',
      iconExtra: 'M11 20a1 1 0 0 0 2 0',
      subtitle: () => 'Alerts, escalations, patient messages'
    },
    {
      title: 'Workflows',
      href: '/admin/workflows',
      gradient: 'pink',
      iconPath: 'M3 4h6v6H3zM15 4h6v6h-6zM9 14h6v6H9z',
      iconExtra: 'M9 7h6M12 14V10',
      subtitle: () => `${this._summary()?.workflows ?? '—'} screens configured`
    },
    {
      title: 'TAT Dashboard',
      href: '/dashboard',
      gradient: 'teal',
      iconPath: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
      subtitle: () => 'Live turnaround tracking'
    },
    {
      title: 'KPI cards',
      href: '/admin/kpis',
      gradient: 'violet',
      iconPath: 'M3 12h4l3-9 4 18 3-9h4',
      subtitle: () => 'Pick which KPIs show on each screen'
    }
  ];

  ngOnInit(): void {
    this.api.get<SeedSummary>('/api/_seed/summary').subscribe({
      next: s => this._summary.set(s)
    });
  }
}
