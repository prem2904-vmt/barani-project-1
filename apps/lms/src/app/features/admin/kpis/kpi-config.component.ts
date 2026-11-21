import { ViewStateService } from '../../../shared/services/view-state.service';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Branch } from '../../../shared/models/tenant.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { DialogService } from '../../../core/services/dialog.service';
import { SkeletonTilesComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SettingsDepartment, kpiScreenInDepartment } from '../../../shared/utils/department-scope';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { SettingsSavebarComponent } from '../../../shared/components/setting-row/settings-savebar.component';
import { SETTINGS_HOST } from '../../../shared/utils/settings-host';
import { HasUnsavedChanges, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import { SG_ICON, SG_NARROW_MQ, sgActions, sgActionsCol, sgCell, sgMedia, sgRowOff, sgSwitch } from '../../../shared/settings-grid/settings-grid';
import { PfSelectOptGroup } from '../../../shared/primitives/select.component';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ColDef, GetRowIdParams, ICellRendererParams, RowDragEndEvent } from 'ag-grid-community';
import { numberCol, textCol, valuesCol } from '../../../shared/utils/work-grid';
import { WorkSetFilterComponent } from '../../../shared/components/work-set-filter/work-set-filter.component';

type Row = KpiAssignmentDto & { idx: number };

interface KpiCatalogItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  category: string;
  valueType: string;
  defaultLabel: string;
  defaultIcon?: string;
  defaultColor?: string;
}

interface KpiAssignmentDto {
  id: string;
  branchId: string | null;
  kpiId: string;
  screen: string;
  enabled: boolean;
  sortOrder: number;
}

interface KpiSaveItem {
  kpiId: string;
  enabled: boolean;
  order: number;
}

interface ScreenDef {
  id: string;
  label: string;
  hint: string;
}

const SCREENS: ScreenDef[] = [
  { id: 'admin',              label: 'Admin dashboard',     hint: 'Tenant-wide overview' },
  { id: 'frontdesk_landing',  label: 'Frontdesk landing',   hint: 'Reception home' },
  { id: 'lab_my_work',        label: 'Lab — My Work',       hint: 'Tech queue' },
  { id: 'sample_collection',  label: 'Sample collection',   hint: 'Phlebotomy / counter' },
  { id: 'receive_samples',    label: 'Receive samples',     hint: 'Lab receiving' },
  { id: 'pathologist',        label: 'Pathologist',         hint: 'Validation queue' },
  { id: 'report_queue',       label: 'Report queue',        hint: 'Delivery' },
  { id: 'billing_counter',    label: 'Billing counter',     hint: 'Cashier' },
  { id: 'tat_board',          label: 'TAT board',           hint: 'Ops monitor' }
];

const CATEGORY_LABELS: Record<string, string> = {
  operational: 'Operational',
  tat:         'TAT & SLA',
  financial:   'Financial',
  quality:     'Quality',
  workload:    'Workload'
};

@Component({
  selector: 'pf-kpi-config',
  standalone: true,
  imports: [BusyDirective, SkeletonTilesComponent, CommonModule, SelectComponent, HeroBandComponent, DataGridComponent, SettingsSavebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-kpi-page pf-band-page">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the catalog search, plus the scope and screen
             pickers; Discard / Save ride the band actions. -->
        <pf-hero-band [back]="true" placeholder="Search KPIs to add — name, code, description…"
                      [value]="filterQuery()" (valueChange)="filterQuery.set($event)">
          <ng-container band-tools>
            <pf-select class="pf-kpi-bandsel pf-kpi-bandsel--scope" size="sm" [options]="scopeOptions()"
                       [value]="selectedScope()" (valueChange)="onScopeChange($event)"
                       aria-label="Configure for"></pf-select>
          </ng-container>
          
        </pf-hero-band>
      }
      <header class="pf-kpi-hdr pf-classic-only items-center">
        @if (navBack.showBack()) {
          <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        }
        <div>
          <h1>KPI configuration</h1>
          <p>Pick which KPI cards appear on each screen. Configure tenant-wide for everyone, or per-branch for that branch only — both layers stack.</p>
        </div>
      </header>

      <section class="pf-kpi-controls pf-classic-only">
        <label class="pf-kpi-control">
          <span class="pf-kpi-control__lbl">Configure for</span>
          <pf-select
            [options]="scopeOptions()"
            [value]="selectedScope()"
            (valueChange)="onScopeChange($event)"></pf-select>
        </label>

        <div class="pf-kpi-screens" role="tablist" aria-label="Screen">
          @for (s of screens(); track s.id) {
            <button type="button"
                    class="pf-kpi-screen-tab"
                    [attr.aria-pressed]="selectedScreen() === s.id"
                    (click)="selectScreen(s.id)">
              <span class="pf-kpi-screen-tab__label">{{ s.label }}</span>
              <span class="pf-kpi-screen-tab__hint">{{ s.hint }}</span>
              @if (assignedCountForScreen(s.id) > 0) {
                <span class="pf-kpi-screen-tab__count">{{ assignedCountForScreen(s.id) }}</span>
              }
            </button>
          }
        </div>
      </section>

      <div class="pf-band-body pf-band-body--fill pf-kpi-body">
      @if (department() && !screens().length) {
        <p class="pf-band-empty" data-testid="kpi-dept-empty">This department has no number cards yet.</p>
      } @else {
        <div class="pf-sg-panels pf-kpi-panels" [class.pf-sg-panels--single]="hosted" [class.pf-sg-panels--narrow]="narrow()">
          <!-- SIDE card (LEFT): the screens. In the Settings shell its side card lists them (SETTINGS_HOST.categories). -->
          @if (!hosted && !narrow()) {
            <aside class="pf-card pf-sg-side pf-kpi-side" aria-label="Screens">
              <header class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></span>
                <span class="pf-card__label">Screens</span>
              </header>
              <ul class="pf-card__body pf-kpi-scr">
                @for (s of screens(); track s.id) {
                  <li>
                    <button type="button" class="pf-kpi-scr__btn" [attr.aria-pressed]="selectedScreen() === s.id" (click)="selectScreen(s.id)" [attr.data-testid]="'kpi-scr-' + s.id">
                      <span class="pf-kpi-scr__name">{{ s.label }}<span class="pf-kpi-scr__hint">{{ s.hint }}</span></span>
                      <span class="pf-kpi-scr__n pf-num">{{ assignedCountForScreen(s.id) }}</span>
                    </button>
                  </li>
                }
              </ul>
            </aside>
          }
          <!-- MAIN card: THIS screen's cards as a Test Master grid. -->
          <section class="pf-card pf-sg-main pf-kpi-main" [class.pf-sg-main--bare]="hosted" [attr.aria-label]="currentScreenLabel()">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg></span>
              <span class="pf-card__label">{{ currentScreenLabel() }}</span>
              <span class="pf-card__spacer"></span>
              <ng-container *ngTemplateOutlet="headToolsTpl"></ng-container>
            </header>
            <div class="pf-sg-main__body">
              <pf-data-grid viewStateKey="admin.kpis.g1" [rowData]="gridRows()" [columnDefs]="colDefs()" [defaultColDef]="defaultColDef" [getRowId]="getRowId"
                            [getRowClass]="rowClass" [rowDragManaged]="true" (rowDragEnd)="onRowDragEnd($event)"
                            [loading]="loading()" loadingLabel="Loading number cards…"
                            emptyTitle="No cards on this screen yet" emptyBody="Add KPI picks one from the catalogue; drag rows to reorder."></pf-data-grid>
            </div>
            <!-- Save / Discard IN the card, only while something changed (owner: no band buttons in Settings). -->
            <pf-settings-savebar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="reload()"></pf-settings-savebar>
          </section>
        </div>
      }
      </div>
    </div>

    <!-- Head tools (left → right): the scope and count note · the dynamic Add KPI picker · (narrow) the screen picker. -->
    <ng-template #headToolsTpl>
      <span class="pf-sg-count" data-testid="kpi-note">{{ scopeLabel() }} · {{ assigned().length }} {{ assigned().length === 1 ? 'card' : 'cards' }}</span>
      @if (narrow() && !hosted) {
        <pf-select class="pf-kpi-headsel" size="sm" [options]="screenOptions()" [value]="selectedScreen()" (valueChange)="selectScreen($event)" aria-label="Screen"></pf-select>
      }
      <pf-select class="pf-kpi-add" size="sm" [groups]="addGroups()" [options]="addOptions()" [value]="''" [searchable]="true"
                 placeholder="+ Add KPI" (valueChange)="addById($event)" aria-label="Add KPI" data-testid="kpi-add"></pf-select>
    </ng-template>
  `,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    :host { display: block; }

    .pf-kpi-page {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px clamp(16px, 3vw, 32px);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* NEW design: the workshop fills the band body and each pane scrolls on
       its own — no page-level scroll. Stacked (<=900px) the body scrolls. */
    :host-context(.design-new) .pf-kpi-workshop {
      flex: 1 1 auto; min-height: 0; align-items: stretch;
      grid-template-rows: minmax(0, 1fr);
    }
    :host-context(.design-new) .pf-kpi-catalog,
    :host-context(.design-new) .pf-kpi-assigned { min-height: 0; overflow-y: auto; }
    :host-context(.design-new) .pf-kpi-catalog__hdr,
    :host-context(.design-new) .pf-kpi-assigned__hdr {
      position: sticky; top: 0; z-index: 1; background: var(--bg-card-solid);
    }
    @media (max-width: 900px) {
      :host-context(.design-new) .pf-kpi-body { display: block !important; overflow-y: auto !important; }
      :host-context(.design-new) .pf-kpi-workshop { grid-template-rows: none; }
      :host-context(.design-new) .pf-kpi-catalog,
      :host-context(.design-new) .pf-kpi-assigned { overflow-y: visible; }
    }
    .pf-kpi-bandsel { display: block; min-width: 190px; }
    .pf-kpi-page.pf-band-page { max-width: none; margin: 0; padding: 24px clamp(16px, 3vw, 32px) 40px; gap: 0; }
    .pf-kpi-panels { grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); }
    .pf-kpi-panels.pf-sg-panels--single, .pf-kpi-panels.pf-sg-panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-kpi-scr { list-style: none; margin: 0; padding: 6px; gap: 2px; }
    .pf-kpi-scr__btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; padding: 8px 10px;
      border: 0; border-radius: var(--pf-radius-sm); background: transparent; font: inherit; text-align: left; cursor: pointer; color: var(--text-primary); }
    .pf-kpi-scr__btn:hover:not([aria-pressed='true']) { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    .pf-kpi-scr__btn[aria-pressed='true'] { background: var(--pf-sel-bg); box-shadow: inset 0 0 0 1px var(--pf-sel-border); }
    .pf-kpi-scr__name { display: flex; flex-direction: column; min-width: 0; font-size: 13.5px; font-weight: 500; }
    .pf-kpi-scr__hint { font-size: 11.5px; font-weight: 400; color: var(--text-tertiary); }
    .pf-kpi-scr__n { flex: none; font-size: 12px; color: var(--text-tertiary); }
    .pf-kpi-add { flex: 0 1 220px; min-width: 180px; }
    .pf-kpi-headsel { flex: 0 1 200px; min-width: 160px; }
    .pf-kpi-bandsel--scope { min-width: 170px; }
    @media (max-width: 640px) { .pf-kpi-bandsel, .pf-kpi-bandsel--scope { min-width: 150px; } }

    .pf-kpi-hdr h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text-primary);
      margin: 0;
    }
    .pf-kpi-hdr p {
      margin: 6px 0 0;
      font-size: 13.5px;
      color: var(--text-secondary);
      max-width: 72ch;
    }

    .pf-kpi-controls {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .pf-kpi-control {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 320px;
    }
    .pf-kpi-control__lbl {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }

    /* ── Screen tabs ───────────────────────────────────────── */
    .pf-kpi-screens {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 8px;
    }
    .pf-kpi-screen-tab {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 14px;
      text-align: left;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .pf-kpi-screen-tab:hover {
      color: var(--text-primary);
      background: var(--glass-bg-hover);
    }
    .pf-kpi-screen-tab[aria-pressed='true'] {
      color: white;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.32), rgba(217, 70, 239, 0.18));
      border-color: rgba(168, 85, 247, 0.5);
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.18);
    }
    .pf-kpi-screen-tab__label {
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: -0.005em;
    }
    .pf-kpi-screen-tab__hint {
      font-size: 11.5px;
      color: var(--text-tertiary);
    }
    .pf-kpi-screen-tab[aria-pressed='true'] .pf-kpi-screen-tab__hint { color: rgba(255,255,255,0.7); }
    .pf-kpi-screen-tab__count {
      position: absolute;
      top: 8px;
      right: 8px;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.22);
      border: 1px solid rgba(168, 85, 247, 0.4);
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #d8b4fe;
    }
    .pf-kpi-screen-tab[aria-pressed='true'] .pf-kpi-screen-tab__count {
      background: rgba(255,255,255,0.18);
      border-color: rgba(255,255,255,0.32);
      color: white;
    }

    /* ── Workshop ──────────────────────────────────────────── */
    .pf-kpi-workshop {
      display: grid;
      grid-template-columns: minmax(280px, 360px) 1fr;
      gap: 20px;
      align-items: flex-start;
    }
    @media (max-width: 900px) {
      .pf-kpi-workshop { grid-template-columns: 1fr; }
    }

    .pf-kpi-catalog,
    .pf-kpi-assigned {
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      overflow: hidden;
    }

    .pf-kpi-catalog__hdr {
      padding: 14px 16px;
      border-bottom: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pf-kpi-catalog__hdr h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-kpi-search {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 10px;
      font-size: 13px;
      outline: none;
    }
    .pf-kpi-search:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,0.18); }

    .pf-kpi-cat { padding: 8px 8px 4px; }
    .pf-kpi-cat h3 {
      margin: 0 0 6px;
      padding: 4px 8px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-kpi-cat ul { list-style: none; margin: 0; padding: 0; }

    .pf-kpi-cat__row {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: "name action" "desc action" "type action";
      gap: 2px 12px;
      padding: 8px 10px;
      border: 0;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease;
    }
    .pf-kpi-cat__row:hover:not(:disabled) { background: var(--bg-hover); }
    .pf-kpi-cat__row:disabled { opacity: 0.6; cursor: default; }
    .pf-kpi-cat__name {
      grid-area: name;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-kpi-cat__desc {
      grid-area: desc;
      font-size: 11.5px;
      color: var(--text-secondary);
      line-height: 1.35;
    }
    .pf-kpi-cat__type {
      grid-area: type;
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      letter-spacing: 0.04em;
    }
    .pf-kpi-cat__add, .pf-kpi-cat__pill {
      grid-area: action;
      align-self: center;
      font-size: 11.5px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 8px;
    }
    .pf-kpi-cat__add { color: var(--violet-text, #6d28d9); background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, transparent); }
    .pf-kpi-tile__switch { flex: none; }
    @media (pointer: coarse) { .pf-kpi-tile__switch { min-width: 44px; min-height: 44px; justify-content: center; } }
    .pf-kpi-cat__pill { color: var(--text-muted); background: rgba(255,255,255,0.04); }

    /* ── Assigned column ───────────────────────────────────── */
    .pf-kpi-assigned__hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-kpi-assigned__hdr h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-kpi-assigned__sub {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--text-tertiary);
    }
    .pf-kpi-assigned__actions { display: flex; gap: 8px; }

    .pf-kpi-btn {
      padding: 0.5rem 0.95rem;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 9px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .pf-kpi-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .pf-kpi-btn--ghost {
      background: transparent;
      color: var(--text-secondary);
      border-color: var(--glass-border);
    }
    .pf-kpi-btn--ghost:hover:not([disabled]) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-kpi-btn--primary {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.32);
    }
    .pf-kpi-btn--primary:hover:not([disabled]) { filter: brightness(1.08); }

    .pf-kpi-assigned__list { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

    .pf-kpi-tile {
      display: grid;
      grid-template-columns: 24px 28px 1fr auto auto;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: var(--bg-elevated, rgba(255,255,255,0.02));
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .pf-kpi-tile:hover { border-color: rgba(168, 85, 247, 0.32); }
    .pf-kpi-tile--dragging { opacity: 0.5; }
    .pf-kpi-tile--over { border-color: rgba(168, 85, 247, 0.7); background: rgba(168,85,247,0.06); }

    .pf-kpi-tile__grip {
      display: inline-flex; align-items: center;
      cursor: grab;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      font-size: 16px;
      letter-spacing: -2px;
      user-select: none;
    }
    .pf-kpi-tile--dragging .pf-kpi-tile__grip { cursor: grabbing; }

    .pf-kpi-tile__pos {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: rgba(168, 85, 247, 0.14);
      color: var(--violet-text);
      font-size: 11.5px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .pf-kpi-tile__body { min-width: 0; display: flex; flex-direction: column; }
    .pf-kpi-tile__label { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-kpi-tile__meta { font-size: 11.5px; color: var(--text-tertiary); margin-top: 1px; }

    .pf-kpi-tile__toggle {
      position: relative;
      display: inline-flex;
      width: 36px;
      height: 20px;
      cursor: pointer;
    }
    .pf-kpi-tile__toggle input { opacity: 0; width: 0; height: 0; }
    .pf-kpi-tile__toggle span {
      position: absolute;
      inset: 0;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 9999px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pf-kpi-tile__toggle span::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background: var(--text-muted);
      transition: left 0.18s ease, background 0.18s ease;
    }
    .pf-kpi-tile__toggle input:checked + span {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      border-color: transparent;
    }
    .pf-kpi-tile__toggle input:checked + span::after { left: 18px; background: white; }

    .pf-kpi-tile__x {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .pf-kpi-tile__x:hover {
      background: rgba(239, 68, 68, 0.1);
      color: var(--red-text);
    }

    .pf-kpi-empty {
      padding: 32px;
      text-align: center;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .pf-kpi-empty--card { padding: 48px 24px; }
    .pf-kpi-empty p { margin: 4px 0; }

    .pf-kpi-loading {
      padding: 48px;
      text-align: center;
      color: var(--text-tertiary);
      font-size: 13px;
    }

    /* Back chevron — shown at all widths when navBack.showBack() is true.
       Single consistent back affordance across phone, tablet and desktop. */
    .pf-hdr-back {
      width: 38px;
      height: 38px;
      margin-left: -8px;
      border-radius: 11px;
      color: var(--text-primary);
      background: transparent;
      border: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background .15s ease, transform .08s ease;
    }
    .pf-hdr-back:active { transform: scale(0.9); background: var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover: hover) {
      .pf-hdr-back:hover { background: var(--glass-bg, rgba(255,255,255,0.06)); }
    }
    /* Lay the header out as a row at all widths so the chevron sits beside
       and vertically centered with the title on phone, tablet and desktop. */
    .pf-kpi-hdr { display: flex; align-items: center; gap: 8px; }

    /* ═══════════════════════════════════════════════════════════
       CROSS-PLATFORM OVERRIDES — additive only.
       Desktop-web (>=1280px) is untouched by everything below.
       ═══════════════════════════════════════════════════════════ */

    /* Gate hover affordances so touch devices don't get sticky hover
       states. Desktop (hover-capable) keeps its existing base hovers. */
    @media (hover: none) {
      .pf-kpi-screen-tab:hover { color: var(--text-secondary); background: var(--glass-bg); }
      .pf-kpi-screen-tab[aria-pressed='true']:hover { color: white; background: linear-gradient(135deg, rgba(139, 92, 246, 0.32), rgba(217, 70, 239, 0.18)); }
      .pf-kpi-cat__row:hover:not(:disabled) { background: transparent; }
      .pf-kpi-tile:hover { border-color: var(--glass-border); }
      .pf-kpi-btn--ghost:hover:not([disabled]) { background: transparent; color: var(--text-secondary); }
      .pf-kpi-btn--primary:hover:not([disabled]) { filter: none; }
      .pf-kpi-tile__x:hover { background: transparent; color: var(--text-muted); }
    }

    /* Coarse pointers (touch): enlarge interactive controls to >=44px. */
    @media (pointer: coarse) {
      .pf-kpi-tile__x { width: 44px; height: 44px; }
      .pf-kpi-tile__toggle { width: 46px; height: 28px; }
      .pf-kpi-tile__toggle span::after { width: 22px; height: 22px; top: 2px; left: 2px; }
      .pf-kpi-tile__toggle input:checked + span::after { left: 20px; }
      .pf-kpi-cat__row { padding-top: 11px; padding-bottom: 11px; }
      .pf-kpi-tile__grip { font-size: 18px; padding: 4px 0; }
    }

    /* Below desktop (<=1279): guard long KPI labels/names from overflowing
       their grid cells. Desktop-web (>=1280) keeps its existing rendering. */
    @include dt.tablet-tier {
      .pf-kpi-cat__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .pf-kpi-tile__label,
      .pf-kpi-tile__meta {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    /* iPad / tablet (641–1279): keep the two-column workshop where it fits.
       The base rule collapses to one column below 900px; for the 901–1279
       band the base two-column layout already applies, so nothing extra is
       needed there. Below 900 we tune spacing for the stacked layout. */
    @include dt.tablet-band {
      .pf-kpi-page { padding-top: 20px; }
    }

    /* Phone (<=640): single-column everything, no horizontal overflow,
       16px inputs to stop iOS zoom, comfortable tap targets, and an action
       row that wraps instead of crowding. */
    @media (max-width: 640px) {
      .pf-kpi-page {
        padding: 16px 14px;
        gap: 16px;
      }
      .pf-kpi-control { max-width: none; }

      /* Stack screen tabs full-width so each is an easy tap target.
         Reserve room on the right so the count badge never sits on the text. */
      .pf-kpi-screens { grid-template-columns: 1fr; }
      .pf-kpi-screen-tab { padding: 12px 40px 12px 14px; min-height: 48px; }

      /* Workshop already collapses to one column via the 900px base rule.
         Cap the catalog height so it doesn't push the assigned list far
         down — scroll within itself rather than the whole page. */
      .pf-kpi-workshop { gap: 14px; }
      .pf-kpi-catalog {
        max-height: 50dvh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      .pf-kpi-catalog__hdr { position: sticky; top: 0; z-index: 1; background: var(--bg-card-solid); }
      .pf-kpi-search { font-size: 16px; }

      /* Assigned header: let title + actions stack and the buttons fill. */
      .pf-kpi-assigned__hdr {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .pf-kpi-assigned__actions { width: 100%; }
      .pf-kpi-assigned__actions .pf-kpi-btn { flex: 1; min-height: 44px; }

      /* Catalog rows comfortable to tap. */
      .pf-kpi-cat__row { min-height: 48px; align-content: center; }
    }
  
    /* Touch reorder buttons — drag doesn't exist on touch. Hidden where a
       mouse can drag, shown on coarse pointers. */
    .pf-kpi-tile__updown { display: none; }
    .pf-kpi-tile__mv {
      width: 34px; height: 22px; border-radius: 6px; border: 1px solid var(--glass-border);
      background: var(--glass-bg); color: var(--text-secondary); font-size: 10px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 34px !important; min-height: 22px !important;
    }
    .pf-kpi-tile__mv:disabled { opacity: .3; }
    @media (pointer: coarse) {
      .pf-kpi-tile__updown { display: inline-flex; flex-direction: column; gap: 3px; }
      .pf-kpi-tile__grip { display: none; }
      .pf-kpi-tile__mv { min-height: 30px !important; }
    }
`]
})
export class KpiConfigComponent implements OnInit, HasUnsavedChanges {
  // ── Test Master frame (owner 2026-11-17: "this screen is horrible") ──
  /** In the Settings shell its side card lists the screens; the grid is bare and the shell's head shows headTools. */
  private readonly settingsHost = inject(SETTINGS_HOST, { optional: true });
  protected readonly hosted = !!this.settingsHost;
  readonly narrow = sgMedia(SG_NARROW_MQ);
  private readonly headToolsTpl = viewChild<TemplateRef<unknown>>('headToolsTpl');
  readonly headTools = computed(() => this.headToolsTpl());
  readonly defaultColDef: ColDef = { sortable: false, resizable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };
  readonly getRowId = (p: GetRowIdParams<KpiAssignmentDto & { idx: number }>) => p.data.kpiId;
  readonly rowClass = sgRowOff<KpiAssignmentDto>(a => a.enabled);
  readonly gridRows = computed(() => this._draft().map((a, idx) => ({ ...a, idx })));
  readonly colDefs = computed<ColDef<Row>[]>(() => {
    this._catalog();
    const web = !this.narrow();
    const n = this._draft().length;
    return [
      numberCol<Row>({ colId: 'order', headerName: '#', width: 76, minWidth: 76, maxWidth: 76, flex: 0, rowDrag: true, cellClass: 'pf-num' },
        r => r.idx + 1, 'left'),
      textCol<Row>({ colId: 'kpi', headerName: 'KPI', flex: 1.6, minWidth: 200,
        cellRenderer: (p: ICellRendererParams<Row>) => sgCell(p.data ? this.kpiName(p.data.kpiId) : '', p.data ? this.kpiDesc(p.data.kpiId) : null, true) },
        r => this.kpiName(r.kpiId)),
      textCol<Row>({ colId: 'kind', headerName: 'Category · type', flex: 1, minWidth: 150,
        cellRenderer: (p: ICellRendererParams<Row>) => { const el = sgCell(null, p.data ? `${this.kpiCategory(p.data.kpiId)} · ${this.kpiValueType(p.data.kpiId)}` : null); el.firstElementChild?.remove(); return el; } },
        r => `${this.kpiCategory(r.kpiId)} · ${this.kpiValueType(r.kpiId)}`),
      valuesCol<Row>({ colId: 'status', headerName: 'Shown', width: 96, minWidth: 96, maxWidth: 96, flex: 0, wrapText: false, autoHeight: false,
        cellRenderer: (p: ICellRendererParams<Row>) => (p.data
          ? sgSwitch(p.data.enabled, this.kpiName(p.data.kpiId), () => this.toggleEnabled(p.data!.idx)) : document.createElement('span')) },
        r => (r.enabled ? 'Shown' : 'Hidden'), WorkSetFilterComponent, 'left', r => (r.enabled ? 0 : 1)),
      sgActionsCol<Row>(web, [], 3, p => {
        const d = p.data;
        if (!d) return document.createElement('span');
        const el = sgActions(web, [
          { label: 'Move up', aria: `Move ${this.kpiName(d.kpiId)} up`, icon: true, path: '<path d="m18 15-6-6-6 6"/>', run: () => this.move(d.idx, -1) },
          { label: 'Move down', aria: `Move ${this.kpiName(d.kpiId)} down`, icon: true, path: '<path d="m6 9 6 6 6-6"/>', run: () => this.move(d.idx, 1) },
          { label: 'Remove', aria: `Remove ${this.kpiName(d.kpiId)}`, icon: true, danger: true, path: SG_ICON.trash, run: () => this.removeAt(d.idx) },
        ]);
        const btns = el.querySelectorAll('button');
        if (d.idx === 0) btns[0].disabled = true;
        if (d.idx === n - 1) btns[1].disabled = true;
        return el;
      }, false),
    ];
  });
  /** Drag-to-reorder (the # column's handle): the grid's new order becomes the draft's. */
  onRowDragEnd(e: RowDragEndEvent<KpiAssignmentDto & { idx: number }>): void {
    const ids: string[] = [];
    e.api.forEachNode(n => { if (n.data) ids.push(n.data.kpiId); });
    const byId = new Map(this._draft().map(a => [a.kpiId, a] as const));
    const next = ids.map((id, i) => ({ ...byId.get(id)!, sortOrder: i })).filter(a => !!a.kpiId);
    if (next.length === this._draft().length) this._draft.set(next);
  }
  /** Add KPI: the catalogue grouped by category (Financial, Operational, TAT & SLA …), already-added ones left out. */
  readonly addGroups = computed<PfSelectOptGroup<string>[]>(() => this.filteredCatalog()
    .map(g => ({ label: g.label, options: g.items.filter(k => !this.isAssigned(k.id)).map(k => ({ value: k.id, label: k.defaultLabel || k.name, hint: k.valueType })) }))
    .filter(g => g.options.length));
  readonly addOptions = computed<PfSelectOption<string>[]>(() => this.addGroups().flatMap(g => g.options));
  addById(id: string): void {
    const k = this._catalog().find(x => x.id === id);
    if (k) this.addToScreen(k);
  }
  kpiDesc(kpiId: string): string | null { return this._catalog().find(x => x.id === kpiId)?.description ?? null; }

  /** Shell side card: one row per screen (with its card count); the shell writes ?tab=<screen>. */
  private readonly listScreens = (() => {
    const host = this.settingsHost;
    if (!host?.categories) return null;
    inject(DestroyRef).onDestroy(() => host.categories.set(null));
    return effect(() => {
      const list = this.screens();
      if (list.length < 2) return;   // never flip the shell between its one-card and two-panel frames
      host.categories.set(list.map(s => ({ id: s.id, label: s.label, note: `${this.assignedCountForScreen(s.id)} cards` })));
    });
  })();
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly destroyRefK = inject(DestroyRef);
  /** ?tab=<screen> (the shell's side card) picks the screen — subscribed in ngOnInit, once the fields exist. */
  private followScreenTab(): void {
    this.route?.queryParamMap.pipe(takeUntilDestroyed(this.destroyRefK)).subscribe(q => {
      const t = q.get('tab');
      if (t && t !== untracked(() => this.selectedScreen()) && this.screens().some(s => s.id === t)) void this.selectScreen(t);
    });
  }

  // ── Unsaved changes ──
  readonly unsavedLabel = 'the number cards';
  hasUnsavedChanges(): boolean { return this.dirty() && !this.saving(); }
  saveChanges(): Promise<boolean> { return this.persist(); }
  private readonly unloadGuard = guardUnsavedOnUnload(this);

  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);
  private readonly dialog = inject(DialogService);

  /** Show only one department's screens (Numbers on lab screens, OPD screens).
   *  No value = every screen (the old single page). */
  readonly department = input<SettingsDepartment | null>(null);
  protected readonly screens = computed(() => SCREENS.filter(s => kpiScreenInDepartment(s.id, this.department())));

  // Catalog + branches load once and stay.
  private readonly _catalog = signal<KpiCatalogItem[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  // Assignments are scoped to the currently selected (screen, scope) — they
  // reload whenever either changes.
  private readonly _assigned = signal<KpiAssignmentDto[]>([]);
  // Local edit buffer — what the user is staging. Compared against
  // `_assigned` to detect dirty state.
  private readonly _draft = signal<KpiAssignmentDto[]>([]);
  // Counts per screen (across the current scope) for the screen-tab badges.
  private readonly _screenCounts = signal<Record<string, number>>({});

  private readonly _loading = signal(true);
  private readonly _saving = signal(false);
  protected readonly filterQuery = signal('');

  /**
   * Selected scope encoded as a single string so it fits the pf-select
   * value model. `__tenant` = tenant-wide; otherwise the branch GUID.
   */
  protected readonly selectedScope = signal<string>('__tenant');
  protected readonly selectedScreen = signal<string>(SCREENS[0].id);

  // Drag-and-drop indices.
  protected readonly draggingIndex = signal<number | null>(null);
  protected readonly dragOverIndex = signal<number | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly assigned = this._draft.asReadonly();

  readonly currentScreenLabel = computed(() =>
    this.screens().find(s => s.id === this.selectedScreen())?.label ?? this.selectedScreen());

  readonly scopeOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '__tenant', label: 'All branches (tenant-wide)' },
    ...this._branches().map(b => ({ value: b.id, label: b.name }))
  ]);

  /** Screen picker in the band pill: label carries the assigned-card count. */
  readonly screenOptions = computed<PfSelectOption<string>[]>(() => this.screens().map(s => {
    const n = this.assignedCountForScreen(s.id);
    return { value: s.id, label: n > 0 ? `${s.label} · ${n}` : s.label, hint: s.hint };
  }));

  readonly scopeLabel = computed(() => {
    const scope = this.selectedScope();
    if (scope === '__tenant') return 'All branches';
    const b = this._branches().find(x => x.id === scope);
    return b ? `Branch · ${b.name}` : 'Branch';
  });

  readonly dirty = computed(() => {
    const a = this._assigned();
    const d = this._draft();
    if (a.length !== d.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].kpiId !== d[i].kpiId) return true;
      if (a[i].enabled !== d[i].enabled) return true;
      if (a[i].sortOrder !== d[i].sortOrder) return true;
    }
    return false;
  });

  /**
   * Catalog grouped by category, then filtered by the search query. Items
   * already assigned in the draft are kept visible but disabled (so the
   * admin can see they exist; the "added" pill makes the state explicit).
   */
  readonly filteredCatalog = computed(() => {
    const q = this.filterQuery().trim().toLowerCase();
    const matches = (k: KpiCatalogItem) =>
      !q ||
      k.name.toLowerCase().includes(q) ||
      k.code.toLowerCase().includes(q) ||
      (k.description ?? '').toLowerCase().includes(q);

    const grouped = new Map<string, KpiCatalogItem[]>();
    for (const k of this._catalog()) {
      if (!matches(k)) continue;
      const list = grouped.get(k.category) ?? [];
      list.push(k);
      grouped.set(k.category, list);
    }
    return Array.from(grouped.entries()).map(([category, items]) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      items: items.slice().sort((a, b) => a.name.localeCompare(b.name))
    }));
  });

  ngOnInit() {
    // A department's first screen (the page opens on it, not on 'Admin dashboard').
    const first = this.screens()[0];
    if (first) this.selectedScreen.set(first.id);
    else if (this.department()) { this._loading.set(false); return; }
    const tab = this.route?.snapshot.queryParamMap.get('tab');
    if (tab && this.screens().some(s => s.id === tab)) this.selectedScreen.set(tab);
    this.followScreenTab();
    this.loadCatalog();
    this.loadBranches();
    this.loadAssignmentsForCurrentScope();
  }

  // ── Scope / screen pickers ─────────────────────────────────
  /** Themed confirm (never window.confirm) before dropping staged edits. */
  private async okToDiscard(): Promise<boolean> {
    if (!this.dirty()) return true;
    return this.dialog.confirm({ title: 'Discard unsaved changes?', tone: 'danger' });
  }

  async onScopeChange(value: string) {
    if (value === this.selectedScope()) return;
    if (!(await this.okToDiscard())) return;
    this.selectedScope.set(value);
    this.loadAssignmentsForCurrentScope();
  }

  async selectScreen(id: string) {
    if (id === this.selectedScreen()) return;
    if (!(await this.okToDiscard())) return;
    this.selectedScreen.set(id);
    this.loadAssignmentsForCurrentScope();
  }

  // ── Catalog ↔ assigned ─────────────────────────────────────
  isAssigned(kpiId: string): boolean {
    return this._draft().some(a => a.kpiId === kpiId);
  }

  addToScreen(k: KpiCatalogItem) {
    if (this.isAssigned(k.id)) return;
    const next = this._draft();
    const newRow: KpiAssignmentDto = {
      // Empty id signals "not yet persisted"; backend's bulk save is keyed
      // by (scope, screen, kpiId) so the id round-trip isn't required.
      id: '',
      branchId: this.selectedScope() === '__tenant' ? null : this.selectedScope(),
      kpiId: k.id,
      screen: this.selectedScreen(),
      enabled: true,
      sortOrder: next.length
    };
    this._draft.set([...next, newRow]);
  }

  removeAt(index: number) {
    const next = this._draft().slice();
    next.splice(index, 1);
    next.forEach((a, i) => a.sortOrder = i);
    this._draft.set(next);
  }

  toggleEnabled(index: number) {
    const next = this._draft().slice();
    next[index] = { ...next[index], enabled: !next[index].enabled };
    this._draft.set(next);
  }

  // ── Drag & drop reorder ────────────────────────────────────
  onDragStart(ev: DragEvent, index: number) {
    this.draggingIndex.set(index);
    ev.dataTransfer?.setData('text/plain', String(index));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  onDragOver(ev: DragEvent, index: number) {
    if (this.draggingIndex() === null) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    this.dragOverIndex.set(index);
  }
  onDrop(ev: DragEvent, target: number) {
    ev.preventDefault();
    const src = this.draggingIndex();
    this.draggingIndex.set(null);
    this.dragOverIndex.set(null);
    if (src === null || src === target) return;
    const next = this._draft().slice();
    const [moved] = next.splice(src, 1);
    next.splice(target, 0, moved);
    next.forEach((a, i) => a.sortOrder = i);
    this._draft.set(next);
  }
  onDragEnd() {
    this.draggingIndex.set(null);
    this.dragOverIndex.set(null);
  }

  /** Touch reorder: HTML5 drag events never fire on touch devices, so the
   *  ↑/↓ buttons (coarse pointers only) are the phone/iPad path. Same array
   *  mutation as onDrop, one step at a time. */
  move(index: number, delta: -1 | 1) {
    const target = index + delta;
    const next = this._draft().slice();
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    next.forEach((a, i) => a.sortOrder = i);
    this._draft.set(next);
  }

  // ── Catalog look-ups ───────────────────────────────────────
  kpiName(kpiId: string): string {
    const k = this._catalog().find(x => x.id === kpiId);
    return k ? (k.defaultLabel || k.name) : kpiId;
  }
  kpiCategory(kpiId: string): string {
    const k = this._catalog().find(x => x.id === kpiId);
    return k ? (CATEGORY_LABELS[k.category] ?? k.category) : '—';
  }
  kpiValueType(kpiId: string): string {
    const k = this._catalog().find(x => x.id === kpiId);
    return k ? k.valueType : '—';
  }

  assignedCountForScreen(screen: string): number {
    if (screen === this.selectedScreen()) return this._draft().length;
    return this._screenCounts()[screen] ?? 0;
  }

  // ── Persist ────────────────────────────────────────────────
  save() { void this.persist(); }

  private persist(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
    const items: KpiSaveItem[] = this._draft().map((a, i) => ({
      kpiId: a.kpiId,
      enabled: a.enabled,
      order: i
    }));
    const branchId = this.selectedScope() === '__tenant' ? null : this.selectedScope();
    this._saving.set(true);
    this.api.post<KpiAssignmentDto[]>('/api/kpis/assignments', {
      screen: this.selectedScreen(),
      branchId,
      items
    }).subscribe({
      next: rows => {
        this._assigned.set(rows ?? []);
        this._draft.set((rows ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder));
        this._saving.set(false);
        this.toasts.success('KPI layout saved');
        this.refreshScreenCounts();
        resolve(true);
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(ApiError.from(e).message);
        resolve(false);
      }
    });
    });
  }

  async reload() {
    if (!(await this.okToDiscard())) return;
    this.loadAssignmentsForCurrentScope();
  }

  // ── Loaders ────────────────────────────────────────────────
  private loadCatalog() {
    this.api.get<KpiCatalogItem[]>('/api/kpis').subscribe({
      next: list => this._catalog.set(list ?? []),
      error: () => this.toasts.error('Could not load KPI catalog')
    });
  }

  private loadBranches() {
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({
      next: list => this._branches.set(list ?? []),
      error: () => this._branches.set([])
    });
  }

  private loadAssignmentsForCurrentScope() {
    this._loading.set(true);
    const scope = this.selectedScope();
    const params = new URLSearchParams({ screen: this.selectedScreen() });
    if (scope !== '__tenant') params.set('branchId', scope);
    this.api.get<KpiAssignmentDto[]>(`/api/kpis/assignments?${params}`).subscribe({
      next: list => {
        const sorted = (list ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
        this._assigned.set(sorted);
        this._draft.set(sorted.map(x => ({ ...x })));
        this._loading.set(false);
        this.refreshScreenCounts();
      },
      error: () => {
        this._assigned.set([]);
        this._draft.set([]);
        this._loading.set(false);
      }
    });
  }

  /**
   * Fetch every screen's count so the screen-tab badges stay accurate when
   * the admin moves between screens. We could persist this in a single
   * endpoint later — for now we issue one call per screen which keeps the
   * backend dumb.
   */
  private refreshScreenCounts() {
    const scope = this.selectedScope();
    const branchParam = scope === '__tenant' ? '' : `&branchId=${scope}`;
    const counts: Record<string, number> = {};
    const screens = this.screens();
    let pending = screens.length;
    if (pending === 0) { this._screenCounts.set(counts); return; }
    for (const s of screens) {
      this.api.get<KpiAssignmentDto[]>(`/api/kpis/assignments?screen=${s.id}${branchParam}`).subscribe({
        next: list => {
          counts[s.id] = (list ?? []).length;
          pending--;
          if (pending === 0) this._screenCounts.set(counts);
        },
        error: () => { pending--; if (pending === 0) this._screenCounts.set(counts); }
      });
    }
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('admin.kpis', { q: this.filterQuery, scope: this.selectedScope });
}
