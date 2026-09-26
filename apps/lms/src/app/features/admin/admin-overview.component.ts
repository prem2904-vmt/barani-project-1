import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { ActivatedRoute, RouterLink } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { searchAdmin, visibleCategories } from "./admin-catalog";
import { AdminAccessService, AdminDirectoryComponent, AdminSearchResultsComponent } from "./admin-directory.component";
import { AuthService } from "../../core/auth/auth.service";
import { ApiService } from "../../core/services/api.service";
import { ApiError } from "../../shared/models/api-response.model";
import { ToastService } from "../../core/services/toast.service";

interface SeedSummary {
  tenants: number;
  branches: number;
  departments: number;
  permissions: number;
  preSeededRoles: number;
  tests: number;
  workflows: number;
}

interface DashMetrics {
  from: string;
  to: string;
  cashIn: number;
  cashOut: number;
  net: number;
  revenue: number;
  balanceDue: number;
  patients: number;
  orders: number;
  tests: number;
}

type RangeKey = "today" | "yesterday" | "7d" | "30d";

interface KpiCard {
  key: keyof DashMetrics;
  label: string;
  kind: "money" | "count";
  color: string; // data-color for the accent
  icon: string; // svg path
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
  selector: "pf-admin-overview",
  standalone: true,
  imports: [RouterLink, DatePipe, HeroBandComponent, AdminDirectoryComponent, AdminSearchResultsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-ov pf-band-page">
      @if (theme.isNewDesign()) {
      <!-- Common hero search (designer band): the admin settings jump-box —
           same q()/setQ pipeline as the inline box it replaces. -->
      <pf-hero-band
        placeholder="Search settings — try barcode, GST, users"
        [value]="q()"
        (valueChange)="setQ($event)">
        <ng-container band-tools>
          <!-- Date range rides in the search bar (owner) — one control
               strip instead of a separate filter row. -->
          <div class="pf-ov__filter pf-ov__filter--band">
            <!-- Neutral kit segment (ND-PATTERN §3): the selected range is a
                 raised neutral segment, never the primary gradient. -->
            <span class="nd-seg pf-ov__seg" role="radiogroup" aria-label="Date range">
              @for (r of ranges; track r.key) {
                <button type="button" class="nd-seg__item pf-ov__range" role="radio" [attr.aria-checked]="range() === r.key"
                        (click)="setRange(r.key)">{{ r.label }}</button>
              }
            </span>
            <!-- Phone: the pills don't fit, so the range collapses to a
                 calendar ICON that opens the same list — and it lives in the
                 search bar rather than as a "Today" pill parked under it
                 (owner). Shown only <=640px in the new design. -->
            <div class="pf-ov__range-dd pf-ov__range-dd--band">
              <button type="button" class="pf-ov__range-ddbtn pf-ov__range-ddbtn--icon"
                      [class.is-open]="filterOpen()"
                      [attr.aria-expanded]="filterOpen()"
                      [attr.aria-label]="'Date range — ' + rangeLabel()"
                      [title]="'Date range — ' + rangeLabel()"
                      (click)="filterOpen.set(!filterOpen())">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2"/>
                  <path d="M8 3v4M16 3v4M3 10h18"/>
                </svg>
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
          </div>
        </ng-container>
        <!-- Refresh is a quiet button on the band, not a bar icon (owner):
             it's the least-used control on the screen. -->
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="load()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>
            </svg>
            Refresh
          </button>
        </ng-container>
      </pf-hero-band>
      }
      @if (!theme.isNewDesign()) {
      <!-- NEW design drops the big page titles app-wide (the navbar carries
           the context); classic keeps its greeting header. -->
      <header class="pf-ov__hdr">
        <div class="pf-ov__hdr-l">
          <p class="pf-ov__eyebrow">{{ today | date: "EEEE, MMM d" }}</p>
          <h1 class="pf-ov__title">
            Overview · <span class="text-gradient">{{ userName() }}</span>
          </h1>
        </div>
      </header>
      }

      <div class="pf-band-body pf-ov__body">
      <!-- Admin search: one box that jumps to any config screen (item 140). -->
      <label class="pf-ov__search pf-classic-only">
        <svg
          class="pf-ov__search-ic"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          class="pf-ov__search-in"
          type="search"
          name="search-admin-settings"
          [value]="q()"
          (input)="setQ($any($event.target).value)"
          placeholder="Search settings — try barcode, GST, users"
          aria-label="Search settings and pages"
        />
        @if (q()) {
          <button
            type="button"
            class="pf-ov__search-clr"
            (click)="setQ('')"
            aria-label="Clear search"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        }
      </label>

      @if (q().trim()) {
        <!-- Search mode: pages AND single settings, one row each (ND §6).
             A setting row deep-links to its row on the page (#anchor). -->
        <pf-admin-search-results [hits]="hits()" [query]="q().trim()"></pf-admin-search-results>
      } @else {
        <!-- Date filter -->
        <div class="pf-ov__filter pf-classic-only" role="tablist" aria-label="Date range">
          <!-- Desktop / iPad: segmented pills. -->
          @for (r of ranges; track r.key) {
            <button
              type="button"
              role="tab"
              class="pf-ov__range"
              [class.pf-ov__range--on]="range() === r.key"
              [attr.aria-selected]="range() === r.key"
              (click)="setRange(r.key)"
            >
              {{ r.label }}
            </button>
          }
          <!-- Phone: a single status button + dropdown (same pattern as the lab
             Stats popover) so the row stays compact. -->
          <div class="pf-ov__range-dd">
            <button
              type="button"
              class="pf-ov__range-ddbtn"
              [class.is-open]="filterOpen()"
              [attr.aria-expanded]="filterOpen()"
              (click)="filterOpen.set(!filterOpen())"
            >
              <span>{{ rangeLabel() }}</span>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            @if (filterOpen()) {
              <div
                class="pf-ov__range-bd"
                aria-hidden="true"
                (click)="filterOpen.set(false)"
              ></div>
              <div class="pf-ov__range-pop" role="menu" aria-label="Date range">
                @for (r of ranges; track r.key) {
                  <button
                    type="button"
                    role="menuitemradio"
                    class="pf-ov__range-opt"
                    [class.is-on]="range() === r.key"
                    [attr.aria-checked]="range() === r.key"
                    (click)="setRange(r.key); filterOpen.set(false)"
                  >
                    {{ r.label }}
                  </button>
                }
              </div>
            }
          </div>
          <span class="pf-ov__filter-spacer"></span>
          <button
            type="button"
            class="pf-ov__refresh press pf-classic-only"
            (click)="load()"
            aria-label="Refresh"
            [class.pf-ov__refresh--busy]="loading()"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        <!-- Hero: connected KPI grid for the chosen window. -->
        <div
          class="pf-ov__kpis"
          [class.pf-ov__kpis--loading]="loading() && !metrics()"
        >
          @for (c of cards; track c.key) {
            <div class="pf-ov__kpi nd-card">
              <span class="nd-card__icon pf-ov__kpi-ic">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path [attr.d]="c.icon" />
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
          <div class="pf-ov__stat nd-card">
            <span class="pf-ov__stat-v">{{ branchCount() ?? "—" }}</span
            ><span class="pf-ov__stat-l">Branches</span>
          </div>
          <div class="pf-ov__stat nd-card">
            <span class="pf-ov__stat-v">{{ deptCount() ?? "—" }}</span
            ><span class="pf-ov__stat-l">Departments</span>
          </div>
          <div class="pf-ov__stat nd-card">
            <span class="pf-ov__stat-v">{{ testCount() ?? "—" }}</span
            ><span class="pf-ov__stat-l">Tests</span>
          </div>
          <div class="pf-ov__stat nd-card">
            <span class="pf-ov__stat-v">{{ roleCount() ?? "—" }}</span
            ><span class="pf-ov__stat-l">Roles</span>
          </div>
          <div class="pf-ov__stat nd-card">
            <span class="pf-ov__stat-v">{{ summary()?.workflows ?? "—" }}</span
            ><span class="pf-ov__stat-l">Form flows</span>
          </div>
          <a
            routerLink="/dashboard"
            class="pf-ov__stat pf-ov__stat--link nd-card press"
          >
            <span class="pf-ov__stat-v">TAT</span
            ><span class="pf-ov__stat-l">Live turnaround →</span>
          </a>
        </div>

        <!-- Every admin page, grouped by its category, ONE tap away
             (ND-PATTERN "Admin pages"). Only what this user can open;
             empty categories are hidden. -->
        <h2 class="pf-ov__section" id="pf-ov-settings">Settings</h2>
        <pf-admin-directory [categories]="cats()" [focus]="focusCat()"></pf-admin-directory>
      }
      </div>
    </section>
  `,
  styles: [
    `
      /* Use the full screen width on web — the KPI / config / manage grids all
       auto-fit, so they spread into the freed space instead of sitting in a
       narrow centred column. A high cap (2200px) just stops absurd stretch on
       ultra-wide 4K displays. Phone/iPad are unaffected (already full-width). */
      .pf-ov {
        padding: 24px 16px 48px;
        max-width: 2200px;
        margin: 0 auto;
      }
      @media (min-width: 768px) {
        .pf-ov {
          padding: 28px 40px 48px;
        }
      }
      .pf-ov__hdr {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
        flex-wrap: wrap;
      }
      .pf-ov__eyebrow {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--text-muted);
        margin: 0;
      }
      .pf-ov__hdr-l {
        min-width: 0;
      }
      .pf-ov__title {
        font-size: 24px;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin: 6px 0 0;
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }
      .text-gradient {
        background: var(--gradient-primary);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      /* ── Admin search box ── */
      .pf-ov__search {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        max-width: 520px;
        margin: 0 0 16px;
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid var(--glass-border);
        background: var(--glass-bg);
        color: var(--text-primary);
      }
      .pf-ov__search:focus-within {
        border-color: var(--violet-500, #8b5cf6);
        box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
      }
      .pf-ov__search-ic {
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .pf-ov__search-in {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text-primary);
        font-size: 13.5px;
      }
      .pf-ov__search-in::-webkit-search-decoration,
      .pf-ov__search-in::-webkit-search-cancel-button,
      .pf-ov__search-in::-webkit-search-results-button,
      .pf-ov__search-in::-webkit-search-results-decoration {
        display: none;
      }
      .pf-ov__search-in::-ms-clear,
      .pf-ov__search-in::-ms-expand {
        display: none;
      }
      .pf-ov__search-in::placeholder {
        color: var(--text-muted);
      }
      .pf-ov__search-clr {
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 7px;
        flex-shrink: 0;
        border: 0;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
      }
      @media (hover: hover) {
        .pf-ov__search-clr:hover {
          color: var(--text-primary);
          background: var(--glass-bg);
        }
      }
      @media (max-width: 640px) {
        .pf-ov__search {
          max-width: 100%;
        }
        .pf-ov__search-in {
          font-size: 16px;
        }
      }
      .pf-ov__manage {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 9px 14px;
        border-radius: 11px;
        font-size: 13px;
        font-weight: 700;
        border: 1px solid var(--glass-border);
        background: var(--glass-bg);
        color: var(--text-secondary);
      }
      .pf-ov__manage svg {
        flex-shrink: 0;
      }
      @media (hover: hover) {
        .pf-ov__manage:hover {
          color: #fff;
          border-color: var(--glass-border-hover);
        }
      }

      /* ── Date filter ── */
      .pf-ov__filter--band { margin: 0 !important; flex-wrap: nowrap; }
      .pf-ov__filter--band .pf-ov__range { height: 28px; padding: 0 10px; font-size: 12px; }
      .pf-ov__filter {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
      }
      .pf-ov__range {
        padding: 7px 14px;
        border-radius: 999px;
        font-size: 12.5px;
        font-weight: 700;
        cursor: pointer;
        border: 1px solid var(--glass-border);
        background: var(--glass-bg);
        color: var(--text-secondary);
        transition:
          background 0.15s,
          color 0.15s,
          border-color 0.15s;
      }
      .pf-ov__range--on {
        background: var(--gradient-primary);
        border-color: transparent;
        color: #fff;
      }
      @media (hover: hover) {
        .pf-ov__range:not(.pf-ov__range--on):hover {
          color: var(--text-primary);
          border-color: var(--glass-border-hover);
        }
      }
      .pf-ov__filter-spacer {
        flex: 1;
      }
      .pf-ov__refresh {
        width: 38px;
        height: 38px;
        border-radius: 11px;
        display: inline-grid;
        place-items: center;
        flex-shrink: 0;
        border: 1px solid var(--glass-border);
        background: var(--glass-bg);
        color: var(--text-secondary);
        cursor: pointer;
      }
      .pf-ov__refresh--busy svg {
        animation: pf-ov-spin 0.8s linear infinite;
      }
      @keyframes pf-ov-spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* Phone date dropdown (status button + popover) — hidden on desktop/iPad
       where the segmented pills show instead. */
      .pf-ov__range-dd {
        position: relative;
        display: none;
      }
      .pf-ov__range-ddbtn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 700;
        border: 1px solid var(--glass-border);
        background: var(--glass-bg);
        color: var(--text-primary);
        cursor: pointer;
      }
      .pf-ov__range-ddbtn svg {
        transition: transform 0.15s ease;
      }
      .pf-ov__range-ddbtn.is-open svg {
        transform: rotate(180deg);
      }
      .pf-ov__range-bd {
        position: fixed;
        inset: 0;
        z-index: 60;
        background: transparent;
      }
      .pf-ov__range-pop {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        z-index: 61;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 170px;
        padding: 6px;
        border-radius: 12px;
        background: var(--bg-card-solid, #14141f);
        border: 1px solid var(--glass-border-hover, var(--glass-border));
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.5);
      }
      .pf-ov__range-opt {
        text-align: left;
        padding: 11px 12px;
        border-radius: 9px;
        font-size: 13.5px;
        font-weight: 600;
        background: transparent;
        border: 0;
        color: var(--text-secondary);
        cursor: pointer;
      }
      .pf-ov__range-opt.is-on {
        background: var(--nd-sel-bg);
        color: var(--text-primary);
      }

      /* ── KPI grid ── */
      .pf-ov__kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 12px;
      }
      .pf-ov__kpis--loading {
        opacity: 0.5;
      }
      .pf-ov__kpi {
        position: relative;
        padding: 16px 16px 15px;
        border-radius: 16px;
        border: 1px solid var(--nd-line);
        background: var(--nd-card-bg);
        box-shadow: var(--nd-shadow-sm);
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow: hidden;
      }
      .pf-ov__kpi::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 3px;
        background: var(--kc, #8b5cf6);
      }
      .pf-ov__kpi-ic {
        width: 34px;
        height: 34px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        margin-bottom: 8px;
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);
        color: var(--violet-text, #7c3aed);
      }
      .pf-ov__kpi-ic svg {
        width: 18px;
        height: 18px;
      }
      .pf-ov__kpi-l {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
      }
      .pf-ov__kpi-v {
        font-size: 25px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }

      .pf-ov__stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin: 10px 0 8px;
      }
      @media (min-width: 720px) {
        .pf-ov__stats {
          grid-template-columns: repeat(6, 1fr);
        }
      }
      .pf-ov__stat {
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid var(--nd-line);
        background: var(--nd-card-bg);
        box-shadow: var(--nd-shadow-sm);
        display: flex;
        flex-direction: column;
      }
      .pf-ov__stat--link:hover {
        border-color: var(--nd-sel-border);
      }
      .pf-ov__stat-v {
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
      .pf-ov__stat-l {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: var(--text-muted);
        margin-top: 3px;
      }

      .pf-ov__section {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--text-muted);
        margin: 22px 0 10px;
      }
      .pf-ov__cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .pf-ov__card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px;
        border-radius: 16px;
        border: 1px solid var(--nd-line);
        background: var(--nd-card-bg);
        box-shadow: var(--nd-shadow-sm);
        transition:
          border-color 0.15s,
          transform 0.15s;
      }
      .pf-ov__card:hover {
        border-color: var(--nd-sel-border);
        transform: translateY(-2px);
      }
      .pf-ov__card-ic {
        width: 38px;
        height: 38px;
        border-radius: 11px;
        display: grid;
        place-items: center;
        margin-bottom: 6px;
      }
      .pf-ov__card-ic svg {
        width: 19px;
        height: 19px;
      }
      .pf-ov__card-t {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .pf-ov__card-s {
        font-size: 12.5px;
        color: var(--text-tertiary);
      }

      /* ── New design (ND-PATTERN): palette only — every KPI / card icon is
         the violet kit chip on a kit card (no per-metric rainbow, no left
         colour bars); section labels in Noto (no mono); the range is a
         neutral nd-seg; only .pf-band-body scrolls. ── */
      :host-context(.design-new) .pf-ov__kpi::before { display: none; }
      .pf-ov__kpi.nd-card, .pf-ov__stat.nd-card, .pf-ov__card.nd-card { overflow: visible; }
      .pf-ov__kpi-ic.nd-card__icon { width: 34px; height: 34px; border-radius: 10px; margin-bottom: 8px; }
      .pf-ov__card-ic.nd-card__icon { width: 38px; height: 38px; border-radius: 11px; }
      .pf-ov__seg { flex: none; }
      .pf-ov__seg .nd-seg__item { height: 30px; }
      :host-context(.design-new) .pf-ov__body { padding-top: 4px; }
      /* Phone: the range collapses to the calendar icon (below). */
      @media (max-width: 640px) { .pf-ov__seg { display: none; } }
      @media (prefers-reduced-motion: reduce) {
        .pf-ov__card, .pf-ov__card:hover { transition: none; transform: none; }
        .pf-ov__refresh--busy svg { animation: none; }
      }

      /* ---- Touch / non-hover overrides (additive; never affect desktop hover) ---- */
      @media (hover: none) {
        .pf-ov__card:hover {
          transform: none;
          border-color: var(--nd-line);
        }
        .pf-ov__card:active {
          transform: translateY(-1px);
          border-color: var(--nd-sel-border);
        }
        .pf-ov__stat--link:hover {
          border-color: var(--nd-line);
        }
      }
      @media (pointer: coarse) {
        .pf-ov__manage {
          min-height: 44px;
          padding-top: 11px;
          padding-bottom: 11px;
        }
        .pf-ov__range,
        .pf-ov__refresh {
          min-height: 44px;
        }
        .pf-ov__stat--link,
        .pf-ov__card {
          min-height: 44px;
        }
      }

      /* ---- Phone (<=640) ---- */
      @media (max-width: 640px) {
        .pf-ov__title {
          font-size: 21px;
        }
        /* Phone: swap the segmented pills for the compact status dropdown. */
        .pf-ov__range {
          display: none;
        }
        .pf-ov__range-dd {
          display: inline-flex;
        }
        /* NEW design: the range belongs in the search bar as an icon, not as
           a "Today" pill under it (owner). The band copy turns on; the
           classic-row copy stays out of the way. */
        :host-context(.design-new) .pf-ov__range-dd--band { display: inline-flex; }
        :host-context(.design-new) .pf-ov__filter:not(.pf-ov__filter--band) { display: none !important; }
        .pf-ov__range-ddbtn--icon {
          width: 44px; height: 44px; padding: 0;
          justify-content: center;
          border-radius: 9999px;
        }
        .pf-ov__range-ddbtn--icon.is-open {
          color: var(--text-primary);
          background: var(--nd-sel-bg);
        }
        .pf-ov__kpis {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .pf-ov__kpi-v {
          font-size: 21px;
        }

        /* Phone: the MANAGE cards become a single-column LIST — icon left, title
         over subtitle, no 2-up tiles. (Grid layout keeps title/subtitle grouped
         beside the icon without a template wrapper.) */
        .pf-ov__cards {
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .pf-ov__card {
          display: grid;
          grid-template-columns: auto 1fr;
          grid-template-rows: auto auto;
          column-gap: 14px;
          row-gap: 2px;
          align-items: center;
          padding: 13px 14px;
        }
        .pf-ov__card-ic {
          grid-row: 1 / 3;
          align-self: center;
          margin-bottom: 0;
        }
        .pf-ov__card-t {
          grid-column: 2;
          grid-row: 1;
        }
        .pf-ov__card-s {
          grid-column: 2;
          grid-row: 2;
        }
      }

      /* ---- Web-below-desktop band (641-1279, incl. iPad + narrow browsers) ---- */
      @media (min-width: 641px) and (max-width: 1279px) {
        .pf-ov__stats {
          grid-template-columns: repeat(3, 1fr);
        }
      }
    `,
  ],
})
export class AdminOverviewComponent implements OnInit {
  private readonly api = inject(ApiService);
  /** Design gate: new design hides the big overview title. */
  readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);

  readonly today = new Date();
  readonly userName = computed(
    () =>
      this.auth.user()?.firstName ||
      this.auth.user()?.displayName?.split(" ")[0] ||
      "Admin",
  );
  readonly summary = signal<SeedSummary | null>(null);
  // Tenant-scoped counts — /_seed/summary counts across ALL tenants (OPS-32:
  // a 1-branch tenant saw 35 branches / 8443 tests) and its role count misses
  // custom roles (OPS-21). Fetched per-tenant on every visit.
  readonly branchCount = signal<number | null>(null);
  readonly deptCount = signal<number | null>(null);
  readonly testCount = signal<number | null>(null);
  readonly roleCount = signal<number | null>(null);

  readonly metrics = signal<DashMetrics | null>(null);
  readonly loading = signal(false);
  readonly range = signal<RangeKey>("today");
  readonly filterOpen = signal(false);
  readonly rangeLabel = computed(
    () => this.ranges.find((r) => r.key === this.range())?.label ?? "Today",
  );

  readonly ranges: Array<{ key: RangeKey; label: string }> = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
  ];

  /** Hero KPI cards — keys map onto the metrics payload. */
  readonly cards: KpiCard[] = [
    {
      key: "cashIn",
      label: "Cash in",
      kind: "money",
      color: "emerald",
      icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
    },
    {
      key: "cashOut",
      label: "Cash out",
      kind: "money",
      color: "rose",
      icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
    },
    {
      key: "net",
      label: "Net cash",
      kind: "money",
      color: "violet",
      icon: "M3 17l6-6 4 4 8-8M21 7v5h-5",
    },
    {
      key: "revenue",
      label: "Billed",
      kind: "money",
      color: "amber",
      icon: "M4 4h16v16l-3-2-2 2-3-2-3 2-2-2-3 2zM8 9h8M8 13h5",
    },
    {
      key: "balanceDue",
      label: "Balance due",
      kind: "money",
      color: "orange",
      icon: "M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    },
    {
      key: "patients",
      label: "Patients",
      kind: "count",
      color: "blue",
      icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87",
    },
    {
      key: "orders",
      label: "Orders",
      kind: "count",
      color: "teal",
      icon: "M9 5h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 11h6M9 15h4",
    },
    {
      key: "tests",
      label: "Tests",
      kind: "count",
      color: "pink",
      icon: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9",
    },
  ];

  // ── Admin search (item 140) ────────────────────────────────────
  // A flat index of every config screen / admin page so any setting is one
  // keystroke away from the Overview. Each entry links straight to its route.
  private readonly _q = signal("");
  readonly q = this._q.asReadonly();
  setQ(v: string): void {
    this._q.set(v ?? "");
  }

  // Search over pages AND single settings (admin-catalog.ts), plain words +
  // synonyms, only what this user may open.
  private readonly access = inject(AdminAccessService);
  private readonly route = inject(ActivatedRoute);
  readonly cats = computed(() => visibleCategories(this.access));
  readonly hits = computed(() => searchAdmin(this._q(), this.access));
  /** `/admin?cat=lab` (the back chevron of an admin page) scrolls to that category. */
  readonly focusCat = toSignal(this.route.queryParamMap.pipe(map((m) => m.get("cat"))), { initialValue: null });

  ngOnInit(): void {
    this.access.ensureLoaded();
    this.api
      .get<SeedSummary>("/api/_seed/summary")
      .subscribe({ next: (s) => this.summary.set(s) });
    // Tenant-scoped KPI counts (branches/departments/roles/tests for THIS tenant).
    this.api.get<unknown[]>("/api/tenants/branches").subscribe({ next: (b) => this.branchCount.set(b?.length ?? 0) });
    this.api.get<unknown[]>("/api/tenants/departments").subscribe({ next: (d) => this.deptCount.set(d?.length ?? 0) });
    this.api.get<unknown[]>("/api/roles/").subscribe({ next: (r) => this.roleCount.set(r?.length ?? 0) });
    this.api.get<any>("/api/tests").subscribe({ next: (t) => this.testCount.set(Array.isArray(t) ? t.length : (t?.total ?? t?.items?.length ?? 0)) });
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
      next: (m) => {
        this.metrics.set(m);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
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
    if (r === "yesterday") {
      from.setDate(from.getDate() - 1);
      to = new Date(startOfToday);
    } else if (r === "7d") {
      from.setDate(from.getDate() - 6);
    } else if (r === "30d") {
      from.setDate(from.getDate() - 29);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }

  formatCard(c: KpiCard): string {
    const m = this.metrics();
    if (!m) return "—";
    const v = Number(m[c.key] ?? 0);
    if (c.kind === "money") {
      const sign = v < 0 ? "-" : "";
      return `${sign}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    }
    return v.toLocaleString("en-IN");
  }
}
