import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, GridApi, GridReadyEvent, ICellRendererParams, ModuleRegistry, RowClassParams } from 'ag-grid-community';
import { ThemeService } from '../../../core/services/theme.service';
import { gridThemeDark, gridThemeLight } from '../tests/tests/grid-theme';
import { TM_NARROW, TM_TWO_PANEL_STYLES, mediaSignal } from '../tests/tests/tm-two-panel';

ModuleRegistry.registerModules([AllCommunityModule]);
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Test } from '../../../shared/models/test.model';
import { Department } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { AuthService } from '../../../core/auth/auth.service';
import { TestPricingService } from '../../../core/services/test-pricing.service';
import {
  PriceWriteItem, TENANT_PRICE_SCOPE, effectivePrice, isOffered, isPriceDefault,
} from '../../../shared/utils/test-pricing';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { isPackage, shownDepartmentName } from '../../../shared/utils/package-department';
import { testListUrl } from '../../../shared/utils/test-list-url';
import { SheetRoundtripService } from '../../files/roundtrip/sheet-roundtrip.service';
import { PRICES_DATASET_ID } from '../../files/roundtrip/prices-dataset';

/** Department-filter value for the "Packages" option (packages have no department). */
export const PACKAGES_FILTER = '__packages__';

/** One allowed specimen of a test with its own price row (owner 2026-09-29:
 *  price by specimen). `orig` null = the base price applies. */
export interface SpecimenPriceRow {
  testId: string;
  code: string;
  name: string;
  orig: number | null;
  basePrice: number;
}

export interface PriceRow {
  id: string;
  name: string;
  deptName: string;
  deptId: string;
  /** A package — it carries no department (owner 2026-09-27); listed under
   *  its own "Packages" filter, never under a department. */
  isPackage?: boolean;
  /** Saved effective price for the viewed scope (₹1 when never priced). */
  orig: number;
  /** Still at the ₹1 default (nobody priced it for this scope). */
  notPriced: boolean;
  /** Saved "offered here" flag for the viewed scope. */
  offered: boolean;
  /** Test / Profile / Package (the grid's Type column). */
  kind?: 'individual' | 'profile' | 'package';
}

/** One grid row: a test, or one of its specimen price rows. */
export interface PriceGridRow { key: string; testId: string; spec: string | null; name: string; meta: string; type: string; }

/**
 * Admin test-PRICING screen — the per-tenant pricing table (Test Master
 * single source, phase 2). A flat, filterable list of every test with an
 * inline-editable price and an "Offered here" switch, plus a bulk percentage
 * change scoped to whatever is currently filtered. The page itself never
 * scrolls — only the rows region does (natural page scroll on phone).
 *
 * Prices live ONLY in the pricing table: every test starts at the ₹1 default
 * (shown as just "₹1") until priced here. Reads come from
 * GET /api/tests (the DTO carries the effective price + `priceIsDefault` +
 * `isOffered`); writes go through PATCH /api/tests/prices/bulk only.
 *
 * Branch isolation ON → a branch picker: each branch has its own prices, and
 * "All branches" edits the tenant default every branch inherits. Isolation
 * OFF → no picker, one tenant price.
 */
@Component({
  selector: 'pf-pricing',
  standalone: true,
  imports: [AgGridAngular, SkeletonTableComponent, BusyDirective, FormsModule, ScreenHeaderComponent, SelectComponent, TileComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-pricing" [class.pf-pricing--embedded]="embedded()">
      @if (embedded()) {
      <!-- Inside Test Master (owner 2026-11-17, "make this a grid view"): Test Master's two-panel — LEFT the
           Departments side card ("All" first, counts), RIGHT the main card: head (Prices · branch, count, branch
           pick, bulk change) over a flush grid with inline price / offered editing. Save / Discard stay in the
           band (bandActions). Narrow: the department pick moves into the head. -->
      <div class="pf-2p pf-pr" [class.pf-2p--narrow]="narrow()">
        @if (!narrow()) {
          <aside class="pf-card pf-2p__side" aria-label="Departments" data-testid="pr-side">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
              <span class="pf-card__label">Departments</span>
            </header>
            <ul class="pf-card__body pf-side-list pf-pr__depts">
              @for (d of deptRail(); track d.value) {
                <li>
                  <button type="button" class="pf-side-item pf-pr__dept" [attr.aria-pressed]="selectedDeptId() === d.value" (click)="selectedDeptId.set(d.value)">
                    <span class="pf-pr__dname">{{ d.label }}</span>
                    <span class="pf-pr__dcount pf-num">{{ d.count }}</span>
                  </button>
                </li>
              }
            </ul>
          </aside>
        }
        <section class="pf-card pf-2p__main" aria-label="Prices" data-testid="pr-main">
          <header class="pf-card__head pf-2p__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/></svg></span>
            <span class="pf-card__label">Prices{{ isolationOn() ? ' · ' + scopeName() : '' }}</span>
            <span class="pf-2p__count"><span class="pf-num">{{ filtered().length }}</span> test{{ filtered().length === 1 ? '' : 's' }}</span>
            <div class="pf-2p__tools">
              @if (narrow()) {
                <pf-select class="pf-pr__deptpick" size="sm" [options]="deptOptions()" [value]="selectedDeptId()" aria-label="Department"
                           (valueChange)="selectedDeptId.set($event)"></pf-select>
              }
              @if (isolationOn()) {
                <pf-select class="pf-pr__branch" size="sm" [options]="branchOptions()" [value]="scopeValue()" aria-label="Branch"
                           (valueChange)="setScope($event)"></pf-select>
              }
              @if (neuronOn()) {
                <!-- Edit these prices in a Neuron sheet (all departments; Code / Test / Department / Type locked), then Send to Prefrontal from the sheet. -->
                <button type="button" class="pf-btn pf-btn--secondary pf-2p__hbtn press" data-testid="pr-open-neuron"
                        [disabled]="loading() || opening() || dirtyCount() > 0" [pfBusy]="opening()" pfBusyLabel="Making the sheet…"
                        [title]="dirtyCount() > 0 ? 'Save or discard your changes first' : 'Edit these prices in a Neuron sheet'" (click)="openInNeuron()">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
                  {{ opening() ? 'Opening…' : 'Open in Neuron' }}
                </button>
              }
              <span class="pf-pr__bulk" role="group" aria-label="Bulk change">
                <span class="pf-pr__bulkk">Bulk change</span>
                <input type="number" class="pf-input pf-num pf-pr__pct" [ngModel]="pct()" (ngModelChange)="pct.set($any($event))"
                       step="1" inputmode="decimal" aria-label="Percentage" title="Enter a negative % to reduce" />
                <span class="pf-pricing__unit">%</span>
                <button type="button" class="pf-btn pf-btn--secondary pf-2p__hbtn press" [disabled]="!filtered().length || !pct()" (click)="applyBulk()">Apply to <span class="pf-num">{{ filtered().length }}</span></button>
              </span>
            </div>
          </header>
          <div class="pf-2p__body">
            @if (loading()) {
              <pf-skeleton-table class="pf-2p__skel" [rows]="12" [cols]="4" label="Loading prices…"></pf-skeleton-table>
            }
            <ag-grid-angular
              class="pf-2p__grid"
              [theme]="gridTheme()"
              [rowData]="gridRows()"
              [columnDefs]="prCols"
              [defaultColDef]="prDefaultCol"
              [getRowId]="prRowId"
              [getRowClass]="prRowClass"
              [singleClickEdit]="isCoarse"
              [stopEditingWhenCellsLoseFocus]="true"
              [overlayNoRowsTemplate]="'No tests match this filter.'"
              (gridReady)="onPrGridReady($event)">
            </ag-grid-angular>
          </div>
        </section>
      </div>
      } @else {

      <!-- ── Fixed chrome: header + filters + bulk bar ───────────── -->
      <div class="pf-pricing__chrome px-4 md:px-8 pt-6">
        @if (!embedded()) {
          <pf-screen-header eyebrow="Admin" title="Pricing"
            subtitle="Edit test prices by department. Bulk-raise a whole department or the filtered list.">
          </pf-screen-header>
        }

        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-3 mb-3">
          @if (isolationOn()) {
            <pf-select class="pf-pricing__branch"
              [options]="branchOptions()"
              [value]="scopeValue()"
              placeholder="Branch"
              (valueChange)="setScope($event)">
            </pf-select>
          }
          <pf-select class="pf-pricing__dept"
            [options]="deptOptions()"
            [value]="selectedDeptId()"
            placeholder="All departments"
            (valueChange)="selectedDeptId.set($event)">
          </pf-select>
          @if (bandQuery() === null) {
            <input type="search" class="pf-input pf-pricing__search" aria-label="Search test name"
                   placeholder="Search test name…"
                   [ngModel]="search()" (ngModelChange)="search.set($event)" />
          }
          <span class="pf-pricing__count ml-auto">
            <span class="pf-num">{{ filtered().length }}</span> test{{ filtered().length === 1 ? '' : 's' }}
          </span>
        </div>

        <!-- Bulk percentage increase -->
        <div class="pf-pricing__bulk">
          <span class="pf-pricing__bulk-k">Bulk change</span>
          <div class="flex items-center gap-1">
            <input type="number" class="pf-input pf-num pf-pricing__pct" [ngModel]="pct()" (ngModelChange)="pct.set($any($event))"
                   step="1" inputmode="decimal" aria-label="Percentage" />
            <span class="pf-pricing__unit">%</span>
          </div>
          <pf-touch-btn size="sm" variant="secondary" [disabled]="!filtered().length || !pct()" (pressed)="applyBulk()">
            Apply to {{ filtered().length }} filtered
          </pf-touch-btn>
          <span class="pf-pricing__hint">
            {{ scopeLabel() }} · enter a negative % to reduce.
          </span>
        </div>
      </div>

      <!-- ── Scrollable rows ─────────────────────────────────────── -->
      <div class="pf-pricing__scroll px-4 md:px-8">
        @if (loading()) {
          <div class="flex justify-center py-10">
            <pf-skeleton-table [rows]="10" [cols]="4" [header]="false" label="Loading prices…"></pf-skeleton-table>
          </div>
        } @else if (!filtered().length) {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="pf-pricing__empty">No tests match this filter.</p>
          </pf-tile>
        } @else {
          <div class="pf-pricing__head">
            <span class="grow">Test</span>
            <span class="pf-pricing__offer-h">Offered</span>
            <span class="pf-pricing__price-h">Price (₹)</span>
          </div>
          <ul class="pf-pricing__list">
            @for (r of filtered(); track r.id) {
              <li class="pf-row pf-pricing__row" [class.pf-pricing__row--dirty]="isDirty(r.id) || specimenDirty(r.id)"
                  [class.pf-pricing__row--off]="!offeredNow(r.id)">
                <div class="grow min-w-0">
                  <p class="pf-row__name pf-pricing__name">{{ r.name }}</p>
                  <p class="pf-pricing__meta">
                    <span>{{ r.isPackage ? 'Package' : (r.deptName || 'No department') }}</span>
                    @if (!offeredNow(r.id)) {
                      <span class="pf-price-flag pf-price-flag--off">Not offered here</span>
                    }
                  </p>
                </div>
                <div class="pf-pricing__offer">
                  <!-- Kit switch (violet ON). -->
                  <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="offeredNow(r.id)"
                          (click)="setOffered(r.id, !offeredNow(r.id))" [attr.aria-label]="'Offered here: ' + r.name">
                    <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                  </button>
                </div>
                <div class="pf-pricing__price">
                  <span class="pf-pricing__unit">₹</span>
                  <input type="number" class="pf-input pf-num pf-pricing__price-in" [attr.aria-label]="'Price of ' + r.name" min="0" step="0.01" inputmode="decimal"
                         [ngModel]="edits()[r.id]" (ngModelChange)="setPrice(r.id, $any($event))" />
                </div>
              </li>
              <!-- A test with allowed specimens expands into one row per
                   specimen: its own price, or blank = the test's price. -->
              @for (sp of specimenRowsOf(r.id); track sp.code) {
                <li class="pf-row pf-pricing__row pf-pricing__row--spec" [attr.data-spec]="r.id + '|' + sp.code"
                    [class.pf-pricing__row--dirty]="isSpecimenDirty(r.id, sp.code)">
                  <div class="grow min-w-0 pf-pricing__spec">
                    <p class="pf-row__name pf-pricing__name">{{ sp.name }}</p>
                    <p class="pf-pricing__meta"><span>Specimen of {{ r.name }}</span></p>
                  </div>
                  <div class="pf-pricing__offer"></div>
                  <div class="pf-pricing__price">
                    <span class="pf-pricing__unit">₹</span>
                    <input type="number" class="pf-input pf-num pf-pricing__price-in" [attr.aria-label]="'Price of ' + r.name + ' on ' + sp.name"
                           min="0" step="0.01" inputmode="decimal" [placeholder]="'base ' + round2(edits()[r.id])"
                           [ngModel]="specimenPriceNow(r.id, sp.code)" (ngModelChange)="setSpecimenPrice(r.id, sp.code, $any($event))" />
                  </div>
                </li>
              }
            }
          </ul>
          <div class="h-2"></div>
        }
      </div>
      }

      <!-- ── Sticky save bar (only when there are unsaved edits) ──── -->
      <!-- In Test Master's new design the host's BAND carries Save / Discard
           (owner): no separate bar. -->
      @if (dirtyCount() > 0 && !bandActions()) {
        <div class="pf-pricing__savebar">
          <span class="pf-savestate"><span class="pf-savestate__dot" aria-hidden="true"></span>
            <span class="pf-num">{{ dirtyCount() }}</span> unsaved change{{ dirtyCount() === 1 ? '' : 's' }}
          </span>
          <div class="flex items-center gap-2 ml-auto">
            <button type="button" class="pf-btn pf-btn--tertiary press" [disabled]="saving()" (click)="discard()">Discard</button>
            <button type="button" class="pf-btn pf-btn--primary pf-pricing__save press" [disabled]="saving()"
                    [pfBusy]="saving()" pfBusyLabel="Saving prices…" (click)="save()">
              @if (saving()) { Saving… } @else { Save changes }
            </button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [TM_TWO_PANEL_STYLES, `
    :host { display: block; height: 100%; }
    :host:has(.pf-pricing--embedded) { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; height: auto; }
    .pf-pricing--embedded { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: visible; }
    .pf-pr__dname { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
    .pf-pr__dcount { flex: none; font-size: 11.5px; font-weight: 700; color: var(--text-tertiary); }
    .pf-pr__branch { width: 190px; }
    .pf-pr__deptpick { width: 200px; }
    .pf-pr__bulk { display: inline-flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
    .pf-pr__bulkk { font-size: 12.5px; font-weight: 500; color: var(--text-secondary); white-space: nowrap; }
    .pf-pr__pct { width: 64px; height: 34px; min-height: 34px; padding: 4px 8px; text-align: right; }
    .pf-pr ::ng-deep .ag-row.pf-pr__row--off .pf-pr__name { color: var(--text-tertiary); }
    .pf-pr ::ng-deep .ag-cell.pf-pr__dirty { background: var(--pf-in-tint); box-shadow: inset 2px 0 0 var(--pf-sel-border); }
    .pf-pr ::ng-deep .pf-pr__cell { display: flex; flex-direction: column; justify-content: center; min-width: 0; line-height: 1.3; padding: 6px 0; }
    .pf-pr ::ng-deep .pf-pr__name { font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-pr ::ng-deep .pf-pr__meta { font-size: 12px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-pr ::ng-deep .pf-pr__spec { padding-left: 18px; }
    .pf-pr ::ng-deep .ag-row .ag-cell { display: flex; align-items: center; }
    .pf-pr ::ng-deep .ag-row .ag-cell.ag-right-aligned-cell { justify-content: flex-end; }
    .pf-pr ::ng-deep .ag-row .ag-cell > .pf-pr__cell { flex: 1 1 auto; }
    @media (max-width: 640px) { .pf-pr__bulkk { display: none; } .pf-2p__tools { width: 100%; } .pf-pr__branch, .pf-pr__deptpick { flex: 1 1 140px; width: auto; min-width: 0; } .pf-pr__bulk { flex: 1 1 100%; } .pf-pr__bulk .pf-2p__hbtn { margin-left: auto; } }
    .pf-pricing { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .pf-pricing__chrome { flex: 0 0 auto; }
    .pf-pricing__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }

    /* Embedded in the Tests "Pricing" tab: flow naturally, no own padding/header,
       and keep the save bar pinned to the bottom of the viewport while scrolling. */
    :host { display: block; }
    .pf-pricing--embedded { height: auto; overflow: visible; }
    .pf-pricing--embedded .pf-pricing__chrome,
    .pf-pricing--embedded .pf-pricing__scroll { padding-left: 0; padding-right: 0; }
    .pf-pricing--embedded .pf-pricing__chrome { padding-top: 0; }
    .pf-pricing--embedded .pf-pricing__scroll { overflow-y: visible; flex: 0 1 auto; }
    .pf-pricing--embedded .pf-pricing__savebar { position: sticky; bottom: 0; border-radius: 12px; }

    .pf-pricing__dept { width: 240px; max-width: 100%; display: inline-block; }
    .pf-pricing__branch { width: 220px; max-width: 100%; display: inline-block; }
    .pf-pricing__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-pricing__row--spec { background: var(--surface-subtle, rgba(0,0,0,.02)); }
    .pf-pricing__spec { padding-left: 24px; position: relative; }
    .pf-pricing__spec::before { content: ''; position: absolute; left: 10px; top: 8px; bottom: 8px; border-left: 2px solid var(--border-subtle, rgba(0,0,0,.12)); }
    .pf-pricing__offer-h { width: 64px; text-align: center; }
    .pf-pricing__offer { width: 64px; flex: 0 0 auto; display: flex; justify-content: center; }
    .pf-pricing__row--off { opacity: 0.6; }
    .pf-pricing__search { width: 260px; max-width: 100%; }

    .pf-pricing__bulk {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
      padding: 10px 12px; margin-bottom: 12px;
      border: 1px solid var(--pf-line); border-radius: var(--pf-radius);
      background: var(--pf-card-bg);
    }
    .pf-pricing__bulk-k { font-size: 12.5px; font-weight: 600; white-space: nowrap; color: var(--text-primary); }
    .pf-pricing__unit { font-size: 13px; color: var(--text-tertiary); }
    .pf-pricing__hint { font-size: 12px; color: var(--text-tertiary); }
    .pf-pricing__count { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-pricing__empty { text-align: center; font-size: 13px; color: var(--text-tertiary); }
    .pf-pricing__name { margin: 0; font-size: 14px; font-weight: 500; }
    .pf-pricing__pct { width: 74px; text-align: right; }

    .pf-pricing__head {
      display: flex; align-items: center; gap: 12px;
      padding: 0 12px 8px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--text-tertiary); border-bottom: 1px solid var(--pf-line); margin-bottom: 8px;
    }
    .pf-pricing__head .grow { flex: 1; }
    .pf-pricing__price-h { width: 150px; text-align: right; }

    .pf-pricing__list { display: flex; flex-direction: column; gap: 6px; list-style: none; padding: 0; margin: 0; }
    .pf-pricing__row { gap: 12px; }
    /* Edited = the kit's "in" tint (subtle violet) + the neutral selected border. */
    .pf-pricing__row--dirty { border-color: var(--pf-sel-border); background: var(--pf-in-tint); }
    .pf-pricing__price { display: flex; align-items: center; gap: 6px; width: 150px; flex: 0 0 auto; }
    .pf-pricing__price-in { width: 120px; text-align: right; }

    .pf-pricing__savebar {
      flex: 0 0 auto; display: flex; align-items: center; gap: 12px;
      padding-top: 12px; padding-bottom: 12px; margin-top: 4px;
      padding-inline: 14px; border: 1px solid var(--pf-line); border-radius: var(--pf-radius);
      background: var(--pf-card-bg); box-shadow: var(--pf-shadow-sm);
    }

    /* Phone (<=640): the page scrolls naturally; the chrome isn't pinned so the
       list gets full height, and the save bar sticks above the bottom nav. */
    @media (max-width: 640px) {
      .pf-pricing { height: auto; overflow: visible; }
      .pf-pricing__scroll { flex: 0 1 auto; overflow-y: visible; }
      .pf-pricing__dept, .pf-pricing__search, .pf-pricing__branch { width: 100%; }
      .pf-pricing__savebar {
        position: sticky;
        bottom: 8px;   /* the shell already keeps in-flow pages above the navbar */
        border-radius: 14px;
        margin: 8px 0;
      }
    }

    /* Touch + iOS: 44px targets, 16px inputs (no zoom). */
    @media (pointer: coarse) { :host input { min-height: 44px; } }
    @media (max-width: 768px) { :host input { font-size: 16px; } }
  `]
})
export class PricingComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly pricing = inject(TestPricingService);
  /** Looked up lazily (Files pulls in the file API): screens and specs without it simply have no "Open in Neuron". */
  private readonly injector = inject(Injector);
  private roundtrip(): SheetRoundtripService | null { try { return this.injector.get(SheetRoundtripService); } catch { return null; } }

  /** "Open in Neuron": Files + Neuron storable by this person + the pricing permission (the sheet round-trip's own check). */
  readonly neuronOn = computed(() => { try { return !!this.roundtrip()?.canOpen(PRICES_DATASET_ID); } catch { return false; } });
  readonly opening = signal(false);
  /** The sheet holds the VIEWED scope's prices (all departments): the branch picked here, "All branches", or the lab price (isolation off). */
  async openInNeuron() {
    if (this.opening() || this.dirtyCount() > 0) return;
    const scope = this.isolationOn() ? this.scopeValue() : '';
    const name = this.isolationOn() ? this.scopeName() : (this.auth.user?.()?.tenantName || 'All branches');
    this.opening.set(true);
    try { await this.roundtrip()?.openInNeuron(PRICES_DATASET_ID, scope, name, 'Test Master'); }
    finally { this.opening.set(false); }
  }

  /** When rendered inside another screen (e.g. the Tests "Pricing" tab) hide the
   *  own header and flow naturally instead of the fixed-page / inner-scroll. */
  readonly embedded = input(false);
  /** The host band renders this table's Save (primary) + Discard; the
   *  sticky save bar is not shown (Test Master, new design). */
  readonly bandActions = input(false);
  /** Unsaved price edits: the host (Test Master's band) steps its Create
   *  down so this save bar's "Save changes" is the view's ONE primary. */
  readonly editingChange = output<boolean>();
  private readonly _emitEditing = effect(() => this.editingChange.emit(this.dirtyCount() > 0));

  // ── Test Master grid view (embedded) ──
  private readonly themeSvc = inject(ThemeService);
  readonly gridTheme = computed(() => (this.themeSvc.isDark() ? gridThemeDark : gridThemeLight));
  readonly narrow = mediaSignal(TM_NARROW, inject(DestroyRef));
  readonly isCoarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  private prApi: GridApi<PriceGridRow> | null = null;
  /** Test rows + their specimen rows, in the filtered order. */
  readonly gridRows = computed<PriceGridRow[]>(() => {
    const out: PriceGridRow[] = [];
    for (const r of this.filtered()) {
      const type = r.isPackage || r.kind === 'package' ? 'Package' : r.kind === 'profile' ? 'Profile' : 'Test';
      out.push({ key: r.id, testId: r.id, spec: null, name: r.name, meta: r.isPackage ? 'Package' : (r.deptName || 'No department'), type });
      for (const sp of this.specimenRowsOf(r.id))
        out.push({ key: r.id + '|' + sp.code, testId: r.id, spec: sp.code, name: sp.name, meta: 'Specimen of ' + r.name, type: 'Specimen' });
    }
    return out;
  });
  /** The rail: All, every department (deduped), Packages — with counts. */
  readonly deptRail = computed(() => {
    const rows = this._rows();
    return this.deptOptions().map(o => ({
      value: o.value, label: o.label,
      count: !o.value ? rows.length : o.value === PACKAGES_FILTER ? rows.filter(r => r.isPackage).length
        : rows.filter(r => !r.isPackage && r.deptId === o.value).length,
    }));
  });
  scopeName(): string { return this.branchOptions().find(o => o.value === this.scopeValue())?.label ?? 'All branches'; }
  readonly prRowId = (p: { data: PriceGridRow }) => p.data.key;
  readonly prRowClass = (p: RowClassParams<PriceGridRow>) => (p.data && !p.data.spec && !this.offeredNow(p.data.testId) ? 'pf-pr__row--off' : '');
  readonly prDefaultCol: ColDef<PriceGridRow> = { sortable: true, resizable: true, suppressMovable: true };
  readonly prCols: ColDef<PriceGridRow>[] = [
    { headerName: 'Test', field: 'name', flex: 2, minWidth: 150, autoHeight: true,
      cellRenderer: (p: ICellRendererParams<PriceGridRow>) => {
        const w = document.createElement('div'); w.className = 'pf-pr__cell' + (p.data?.spec ? ' pf-pr__spec' : '');
        const n = document.createElement('span'); n.className = 'pf-pr__name'; n.textContent = p.data?.name ?? '';
        const m = document.createElement('span'); m.className = 'pf-pr__meta';
        m.textContent = (p.data?.meta ?? '') + (this.phone() && p.data && p.data.type !== 'Test' && p.data.type !== 'Specimen' && p.data.type !== p.data.meta ? ' · ' + p.data.type : '') + (p.data && !p.data.spec && !this.offeredNow(p.data.testId) ? ' · Not offered here' : '');
        w.append(n, m); return w;
      } },
    { headerName: 'Type', field: 'type', colId: 'type', width: 110, minWidth: 96 },
    { headerName: 'Offered', colId: 'offered', width: 104, minWidth: 72, sortable: false,
      cellClassRules: { 'pf-pr__dirty': p => !!p.data && !p.data.spec && this.offeredDirty(p.data.testId) },
      cellRenderer: (p: ICellRendererParams<PriceGridRow>) => {
        if (!p.data || p.data.spec) return '';
        const id = p.data.testId; const on = this.offeredNow(id);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'pf-toggle'; b.setAttribute('role', 'switch');
        b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-label', 'Offered here: ' + p.data.name);
        b.innerHTML = '<span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>';
        b.addEventListener('click', ev => { ev.stopPropagation(); this.setOffered(id, !this.offeredNow(id)); });
        return b;
      } },
    { headerName: 'Price (₹)', colId: 'price', width: 140, minWidth: 96, editable: true, type: 'rightAligned',
      cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 0, precision: 2 },
      cellStyle: { fontVariantNumeric: 'tabular-nums' },
      valueGetter: p => !p.data ? null : p.data.spec ? this.specimenPriceNow(p.data.testId, p.data.spec) : this.edits()[p.data.testId],
      valueFormatter: p => (p.value === '' || p.value == null ? (p.data?.spec ? 'base' : '') : '₹' + Number(p.value).toLocaleString('en-IN')),
      valueSetter: p => {
        if (!p.data) return false;
        const v = p.newValue;
        if (p.data.spec) this.setSpecimenPrice(p.data.testId, p.data.spec, v === null || v === undefined || v === '' ? '' : Number(v));
        else this.setPrice(p.data.testId, Number(v ?? 0));
        return true;
      },
      cellClassRules: { 'pf-pr__dirty': p => !!p.data && (p.data.spec ? this.isSpecimenDirty(p.data.testId, p.data.spec) : this.priceDirty(p.data.testId)) } },
  ];
  onPrGridReady(e: GridReadyEvent<PriceGridRow>) { this.prApi = e.api; this.fitPhone(); }
  /** Phones: Test · Offered · Price only (the type rides in the Test cell's muted line). */
  private readonly phone = mediaSignal('(max-width: 640px)', inject(DestroyRef));
  private readonly _phoneCols = effect(() => { this.phone(); this.fitPhone(); });
  private fitPhone() {
    const api = this.prApi;
    if (!api || api.isDestroyed?.()) return;
    const ph = this.phone();
    api.setColumnsVisible(['type'], !ph);
    api.setColumnWidths([{ key: 'offered', newWidth: ph ? 76 : 104 }, { key: 'price', newWidth: ph ? 104 : 140 }]);
  }
  /** Edits live in signals: repaint the cells (dirty marks, switches) when they change. */
  private readonly _repaint = effect(() => {
    this.edits(); this.specimenEdits();
    const api = this.prApi;
    if (api && !api.isDestroyed?.()) queueMicrotask(() => api.refreshCells({ force: true }));
  });
  /** An Offered flip also changes the row's look (muted when not offered). */
  private readonly _redraw = effect(() => {
    this.offeredEdits();
    const api = this.prApi;
    if (api && !api.isDestroyed?.()) queueMicrotask(() => api.redrawRows());
  });
  priceDirty(id: string): boolean { const r = this._rows().find(x => x.id === id); return !!r && this.round2(this.edits()[id]) !== this.round2(r.orig); }
  offeredDirty(id: string): boolean { const r = this._rows().find(x => x.id === id); const o = this.offeredEdits(); return !!r && id in o && o[id] !== r.offered; }

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  /** Bound by a host that owns the search (Test Master's band pill); it
   *  replaces the search box here. null = standalone page. */
  readonly bandQuery = input<string | null>(null);
  readonly selectedDeptId = signal<string>('');
  readonly pct = signal<number>(10);

  private readonly _rows = signal<PriceRow[]>([]);
  /** The per-specimen rows (GET /api/tests/prices/specimens), by test id. */
  private readonly _specimenRows = signal<Record<string, SpecimenPriceRow[]>>({});
  /** `${testId}|${code}` → edited specimen price ('' = back to the base price). */
  readonly specimenEdits = signal<Record<string, number | ''>>({});
  /** testId → current (possibly edited) price. */
  readonly edits = signal<Record<string, number>>({});
  /** testId → edited "offered here" flag (only rows the user flipped). */
  readonly offeredEdits = signal<Record<string, boolean>>({});

  /** Tenant runs branch isolation → prices are per branch (picker shown). */
  readonly isolationOn = this.pricing.isolationOn;
  /** Viewed pricing scope when isolation is ON: '' = the acting branch,
   *  a branch id, or TENANT_PRICE_SCOPE ("All branches" = tenant default). */
  readonly scope = signal<string>('');

  readonly branchOptions = computed<PfSelectOption[]>(() => [
    { value: TENANT_PRICE_SCOPE, label: 'All branches', hint: 'Tenant default' },
    ...((this.auth.user?.()?.branches ?? []).map(b => ({ value: b.id, label: b.name }))),
  ]);
  /** The picker's shown value ('' resolves to the acting branch). */
  readonly scopeValue = computed(() => this.scope() || (this.auth.activeBranchId?.() ?? TENANT_PRICE_SCOPE));


  private readonly _departments = signal<Department[]>([]);

  readonly deptOptions = computed<PfSelectOption[]>(() => [
    { value: '', label: 'All departments' },
    ...this.dedupeByCode(this._departments()).map(d => ({ value: d.id, label: d.name + (d.code ? ' · ' + d.code : '') })),
    { value: PACKAGES_FILTER, label: 'Packages' },
  ]);

  readonly filtered = computed<PriceRow[]>(() => {
    const s = (this.bandQuery() ?? this.search()).trim().toLowerCase();
    const dept = this.selectedDeptId();
    return this._rows().filter(r =>
      (!dept || (dept === PACKAGES_FILTER ? !!r.isPackage : (!r.isPackage && r.deptId === dept))) &&
      (!s || r.name.toLowerCase().includes(s))
    );
  });

  readonly dirtyCount = computed(() => {
    const e = this.edits();
    const o = this.offeredEdits();
    const base = this._rows().reduce((n, r) =>
      n + (this.round2(e[r.id]) !== this.round2(r.orig) || (r.id in o && o[r.id] !== r.offered) ? 1 : 0), 0);
    return base + this.dirtySpecimenWrites().length;
  });

  // ── Price by specimen (owner 2026-09-29) ──
  specimenRowsOf(testId: string): SpecimenPriceRow[] { return this._specimenRows()[testId] ?? []; }
  private static specKey(testId: string, code: string): string { return `${testId}|${code}`; }
  /** The specimen's shown price: the edit, else the saved own price, else '' (base). */
  specimenPriceNow(testId: string, code: string): number | '' {
    const k = PricingComponent.specKey(testId, code);
    const e = this.specimenEdits();
    if (k in e) return e[k];
    const row = this.specimenRowsOf(testId).find(s => s.code === code);
    return row?.orig == null ? '' : row.orig;
  }
  setSpecimenPrice(testId: string, code: string, val: number | '' | null) {
    const k = PricingComponent.specKey(testId, code);
    const v = val === '' || val == null || !Number.isFinite(Number(val)) ? '' : Math.max(0, Number(val));
    this.specimenEdits.update(e => ({ ...e, [k]: v }));
  }
  isSpecimenDirty(testId: string, code: string): boolean {
    const k = PricingComponent.specKey(testId, code);
    const e = this.specimenEdits();
    if (!(k in e)) return false;
    const row = this.specimenRowsOf(testId).find(s => s.code === code);
    const saved = row?.orig == null ? '' : this.round2(row.orig);
    const now = e[k] === '' ? '' : this.round2(e[k] as number);
    return saved !== now;
  }
  specimenDirty(testId: string): boolean { return this.specimenRowsOf(testId).some(s => this.isSpecimenDirty(testId, s.code)); }
  /** The specimen writes to send: price (own) or null (= back to the base price). */
  private dirtySpecimenWrites(): PriceWriteItem[] {
    const out: PriceWriteItem[] = [];
    for (const [testId, rows] of Object.entries(this._specimenRows()))
      for (const s of rows)
        if (this.isSpecimenDirty(testId, s.code)) {
          const v = this.specimenPriceNow(testId, s.code);
          out.push({ testId, specimenCode: s.code, price: v === '' ? null : this.round2(v) } as PriceWriteItem);
        }
    return out;
  }

  scopeLabel(): string {
    const dept = this.selectedDeptId();
    if (dept === PACKAGES_FILTER) return 'Applies to packages';
    const name = this._departments().find(d => d.id === dept)?.name;
    return dept && name ? `Applies to ${name}` : 'Applies to all departments';
  }

  isDirty(id: string): boolean {
    const row = this._rows().find(r => r.id === id);
    if (!row) return false;
    const o = this.offeredEdits();
    return this.round2(this.edits()[id]) !== this.round2(row.orig) || (id in o && o[id] !== row.offered);
  }

  /** Offered here, including an unsaved flip. */
  offeredNow(id: string): boolean {
    const o = this.offeredEdits();
    return id in o ? o[id] : (this._rows().find(r => r.id === id)?.offered ?? true);
  }

  setOffered(id: string, on: boolean) {
    this.offeredEdits.update(o => ({ ...o, [id]: !!on }));
  }

  /** Switch the viewed branch (isolation ON). Unsaved edits are dropped. */
  setScope(v: string) {
    if ((v ?? '') === this.scopeValue()) return;
    this.scope.set(v ?? '');
    this.load();
  }

  /** Branch the save writes: explicit branch when isolation is ON (the acting
   *  branch for ''), null for "All branches" and whenever isolation is OFF. */
  private writeBranchId(): string | null {
    if (!this.isolationOn()) return null;
    const v = this.scopeValue();
    return v && v !== TENANT_PRICE_SCOPE ? v : null;
  }

  ngOnInit() {
    this.pricing.ensureLoaded();
    this.load();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: list => this._departments.set(list ?? []),
      error: () => { /* dept filter degrades to none */ },
    });
  }

  private load() {
    this.loading.set(true);
    // Isolation ON + a picked scope reads that scope's view; otherwise the
    // plain list (acting branch / tenant price).
    // Summary view (DB optimisation phase 2): the grid reads only list fields.
    const url = testListUrl({ branchId: this.isolationOn() && this.scope() ? this.scope() : null });
    this.api.get<Test[]>(url).subscribe({
      next: list => {
        const rows: PriceRow[] = (list ?? []).map(t => ({
          id: t.id,
          name: t.name,
          // A package carries no department — a legacy stored one is ignored.
          deptName: shownDepartmentName(t),
          deptId: isPackage(t) ? '' : (t.department?.id ?? t.departmentId ?? ''),
          isPackage: isPackage(t),
          orig: effectivePrice(t),
          notPriced: isPriceDefault(t),
          offered: isOffered(t),
          kind: t.type,
        })).sort((a, b) => (a.deptName || '~').localeCompare(b.deptName || '~') || a.name.localeCompare(b.name));
        this._rows.set(rows);
        this.edits.set(Object.fromEntries(rows.map(r => [r.id, r.orig])));
        this.offeredEdits.set({});
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.toasts.error('Failed to load tests'); },
    });
    this.loadSpecimenRows();
  }

  /** The per-specimen expansion for the viewed scope (empty when the tenant
   *  has no test with allowed specimens, or the micro module is absent). */
  private loadSpecimenRows() {
    const scope = this.isolationOn() && this.scope() ? this.scope() : null;
    const url = scope && scope !== TENANT_PRICE_SCOPE ? `/api/tests/prices/specimens?branchId=${encodeURIComponent(scope)}` : '/api/tests/prices/specimens';
    this.api.get<Array<{ testId: string; specimenCode: string; specimenName: string; price?: number | null; basePrice: number }>>(url).subscribe({
      next: list => {
        const by: Record<string, SpecimenPriceRow[]> = {};
        for (const r of list ?? []) {
          (by[r.testId] ??= []).push({ testId: r.testId, code: r.specimenCode, name: r.specimenName, orig: r.price ?? null, basePrice: Number(r.basePrice) });
        }
        this._specimenRows.set(by);
        this.specimenEdits.set({});
      },
      error: () => { this._specimenRows.set({}); this.specimenEdits.set({}); },
    });
  }

  setPrice(id: string, val: number) {
    const n = Number(val);
    this.edits.update(e => ({ ...e, [id]: Number.isFinite(n) ? Math.max(0, n) : 0 }));
  }

  /** Apply the percentage to every CURRENTLY FILTERED row (department + search). */
  applyBulk() {
    const p = Number(this.pct());
    if (!Number.isFinite(p) || p === 0) return;
    const factor = 1 + p / 100;
    const ids = new Set(this.filtered().map(r => r.id));
    this.edits.update(e => {
      const next = { ...e };
      for (const id of ids) next[id] = this.round2(Math.max(0, (next[id] ?? 0) * factor));
      return next;
    });
    this.toasts.info(`${p > 0 ? '+' : ''}${p}% applied to ${ids.size} test${ids.size === 1 ? '' : 's'} — review and Save.`);
  }

  discard() {
    this.edits.set(Object.fromEntries(this._rows().map(r => [r.id, r.orig])));
    this.offeredEdits.set({});
    this.specimenEdits.set({});
  }

  async save() {
    const e = this.edits();
    const o = this.offeredEdits();
    const updates: PriceWriteItem[] = [];
    for (const r of this._rows()) {
      const priceChanged = this.round2(e[r.id]) !== this.round2(r.orig);
      const offeredChanged = r.id in o && o[r.id] !== r.offered;
      if (!priceChanged && !offeredChanged) continue;
      const u: PriceWriteItem = { testId: r.id };
      if (priceChanged) u.price = this.round2(e[r.id]);
      if (offeredChanged) u.isOffered = o[r.id];
      updates.push(u);
    }
    const specimenWrites = this.dirtySpecimenWrites();
    updates.push(...specimenWrites);
    if (updates.length === 0) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.pricing.save(updates, this.writeBranchId()));
      // Commit: new originals become the saved values (a priced row is no
      // longer at the default).
      this._rows.update(rows => rows.map(r => {
        const u = updates.find(x => x.testId === r.id && !x.specimenCode);
        if (!u) return r;
        return {
          ...r,
          orig: u.price ?? r.orig,
          notPriced: u.price != null ? false : r.notPriced,
          offered: u.isOffered ?? r.offered,
        };
      }));
      this.offeredEdits.set({});
      // Specimen rows: the saved value becomes the original (null = base).
      if (specimenWrites.length) {
        this._specimenRows.update(by => {
          const next: Record<string, SpecimenPriceRow[]> = {};
          for (const [testId, rows] of Object.entries(by))
            next[testId] = rows.map(s => {
              const w = specimenWrites.find(x => x.testId === testId && x.specimenCode === s.code);
              return w ? { ...s, orig: w.price ?? null } : s;
            });
          return next;
        });
        this.specimenEdits.set({});
      }
      this.toasts.success(`Updated ${updates.length} price${updates.length === 1 ? '' : 's'}`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.saving.set(false);
    }
  }

  round2(n: number | undefined): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  private dedupeByCode(list: Department[]): Department[] {
    const byKey = new Map<string, Department>();
    for (const d of list) {
      const key = (d.code?.trim() || d.name?.trim() || d.id).toUpperCase();
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, d); continue; }
      if (existing.branchId && !d.branchId) byKey.set(key, d);
    }
    return [...byKey.values()];
  }
}
