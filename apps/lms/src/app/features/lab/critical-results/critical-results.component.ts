import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet, formatDate } from '@angular/common';
import { AllCommunityModule, CellClickedEvent, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry, RowClassParams } from 'ag-grid-community';
import { AgGridAngular, ICellRendererAngularComp } from 'ag-grid-angular';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, PfAction } from '../../../shared/components/actions-menu/actions-menu.component';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  CriticalRegisterFilter, CriticalResultEvent, CriticalResultStatus, criticalMethodLabel, criticalRoleLabel,
  criticalStatusWord, needsAckBy,
} from '../../../shared/models/critical-result.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { CriticalCommunicationDialogComponent } from '../../../shared/components/critical-communication-dialog/critical-communication-dialog.component';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { bandFilter } from '../../../shared/utils/band-search';
import { LAB_TIME_ZONE, labDaysAgo, labToday } from '../../../shared/utils/lab-clock';
import { plural } from '../../../shared/utils/plural';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { spinDelay } from '../../../shared/utils/busy';

ModuleRegistry.registerModules([AllCommunityModule]);

type StatusFilter = CriticalResultStatus | 'all';
type QuickRange = 'today' | '7d' | '30d' | 'custom';

const PAGE_SIZE = 200;


interface ActsParams extends ICellRendererParams<CriticalResultEvent> {
  web: boolean;
  userId: string | null | undefined;
  onMenu: (e: CriticalResultEvent, id: 'ack' | 'comm') => void;
}

/**
 * The row's actions: ONE next-step button (Acknowledge while this user has not acknowledged, else Communicate) and,
 * when a second step is open, the rest in the kit's pf-actions-menu. The primary keeps `data-act` so the grid's
 * cellClicked handler runs the existing flow unchanged.
 */
@Component({
  selector: 'pf-cr-acts',
  standalone: true,
  imports: [ActionsMenuComponent, ActionsMenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (e) {
      <span class="pf-cr-acts">
        @if (primary(); as p) {
          <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web" [attr.data-act]="p.id"
                  [attr.aria-label]="p.label + ' — ' + e.testName" [attr.title]="p.label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              @if (p.id === 'ack') { <path d="M20 6 9 17l-5-5"/> } @else { <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.7a2 2 0 0 1 1.7 2z"/> }
            </svg>
            <span class="pf-rowact__t">{{ p.label }}</span>
          </button>
        }
        @if (menu().length) {
          <pf-actions-menu [actions]="menu()" heading="Critical result" label="More actions" (action)="pick($event)">
            <button pfActionsTrigger type="button" class="pf-rowact pf-rowact--icon" [attr.aria-label]="'More actions — ' + e.testName" title="More actions">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5h.01"/><path d="M12 12h.01"/><path d="M12 19h.01"/></svg>
            </button>
          </pf-actions-menu>
        }
      </span>
    }
  `,
})
export class CriticalActionsCellComponent implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  e: CriticalResultEvent | undefined;
  web = true;
  private params!: ActsParams;
  private readonly steps = signal<Array<{ id: 'ack' | 'comm'; label: string }>>([]);
  readonly primary = computed(() => this.steps()[0] ?? null);
  readonly menu = computed<PfAction[]>(() => this.steps().slice(1).map(x => ({ id: x.id, label: x.label, icon: x.id === 'comm' ? 'chat' : undefined })));
  agInit(p: ActsParams): void {
    this.params = p; this.e = p.data; this.web = p.web;
    const e = p.data; const steps: Array<{ id: 'ack' | 'comm'; label: string }> = [];
    if (e && needsAckBy(e, p.userId)) steps.push({ id: 'ack', label: 'Acknowledge' });
    if (e && e.status !== 'communicated') steps.push({ id: 'comm', label: p.web ? 'Communicate' : 'Record communication' });
    this.steps.set(steps); this.cdr.markForCheck();
  }
  refresh(p: ActsParams): boolean { this.agInit(p); return true; }
  pick(id: string) { if (this.e) this.params.onMenu(this.e, id === 'ack' ? 'ack' : 'comm'); }
}

/** ISO instant → "29 Sep, 2:45 pm" in the lab's IST day (never the device zone). */
export function istStamp(iso?: string | null): string {
  if (!iso) return '';
  try { return formatDate(iso, 'd MMM, h:mm a', 'en-US', LAB_TIME_ZONE); } catch { return ''; }
}

/** Only the events matching the band search (patient, MRN, order, sample, test, values). */
export function searchEvents(rows: readonly CriticalResultEvent[], q: string): CriticalResultEvent[] {
  return bandFilter(rows, q, e => [e.patientName, e.patientMrn, e.orderNumber, e.sampleBarcode, e.testName, e.testCode, e.summary,
    e.acknowledgedByName, e.communicatedToName]);
}

/**
 * Lab → Critical results: the NABL acknowledgement register. ND pattern —
 * band (search pill; quiet Refresh + Export CSV, no primary), a FILTERS
 * companion on the LEFT (status, IST date range, branch) and the register
 * grid (AG-Grid, the app's Test Master theme) as the main card. Each row
 * carries ONE status word (Not acknowledged · Acknowledged · Communicated)
 * and its two row actions. The CSV comes from the server (every filtered row,
 * IST stamps) for the audit file.
 */
@Component({
  selector: 'pf-critical-results',
  standalone: true,
  imports: [NgTemplateOutlet, AgGridAngular, HeroBandComponent, ScreenHeaderComponent, PfDateComponent, SelectComponent, CriticalCommunicationDialogComponent, BusyDirective, SkeletonTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-cr pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/lab/my-work" placeholder="Search patient, MRN, order, test…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            @if (narrow()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="sheetOpen.set(true)"
                      aria-haspopup="dialog" [attr.aria-expanded]="sheetOpen()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/></svg>
                Filters
              </button>
            }
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="loading()" [pfBusy]="loading()" pfBusyLabel="Refreshing…" (click)="load()" aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>
              Refresh
            </button>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press pf-cr__export" [disabled]="exporting()" [pfBusy]="exporting()" pfBusyLabel="Preparing the CSV…" (click)="exportCsv()" title="Download the NABL register as CSV">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
              {{ exporting() ? 'Preparing…' : 'Export CSV' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab" title="Critical results" subtitle="NABL acknowledgement register" parentRoute="/lab/my-work">
        <div actions>
          <button type="button" class="pf-btn pf-btn--secondary" [disabled]="exporting()" [pfBusy]="exporting()" pfBusyLabel="Preparing the CSV…" (click)="exportCsv()">Export CSV</button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-cr__body">
        <div class="pf-cr__panels" [class.pf-cr__panels--narrow]="narrow()">
          <!-- FILTERS: the companion comes first (left); a sheet on phones. -->
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-cr__side pf-cr__side--sheet" role="dialog" aria-modal="true" aria-label="Filters" (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sheet__handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="filterHead; context: { sheet: true }"></ng-container>
                <ng-container *ngTemplateOutlet="filterBody"></ng-container>
              </aside>
            }
          } @else {
            <aside class="pf-card pf-cr__side" aria-label="Filters">
              <ng-container *ngTemplateOutlet="filterHead; context: { sheet: false }"></ng-container>
              <ng-container *ngTemplateOutlet="filterBody"></ng-container>
            </aside>
          }

          <!-- MAIN: the register -->
          <section class="pf-card pf-cr__main" aria-label="Critical results register">
            <header class="pf-card__head pf-cr__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4 1-2 1.5 1h5.27"/></svg>
              </span>
              <h2 class="pf-card__label">Critical results</h2>
              <span class="pf-card__note pf-cr__hint">Every critical value with who acknowledged it and who was told — the NABL record.</span>
              <span class="pf-cr__count pf-num" aria-live="polite">{{ countLabel() }}</span>
            </header>
            <div class="pf-cr__grid-wrap">
              @if (listSkeleton()) {
                <!-- First load / empty refresh: the register's shape, never an empty grid. -->
                <pf-skeleton-table class="pf-cr__skel" [rows]="8" [cols]="6" label="Loading critical results…"></pf-skeleton-table>
              } @else if (!loading() && visibleRows().length === 0) {
                <div class="pf-empty pf-empty--compact">
                  <span class="pf-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  </span>
                  <p class="pf-empty__title">{{ q().trim() ? 'No critical results match "' + q().trim() + '"' : 'No critical results in this range' }}</p>
                  <p class="pf-empty__body">{{ q().trim() ? 'Try another name, order or test.' : 'Widen the date range or switch the status filter to All.' }}</p>
                </div>
              } @else {
                <ag-grid-angular class="pf-cr__grid" [theme]="gridTheme()" [rowData]="visibleRows()" [columnDefs]="colDefs()"
                                 [defaultColDef]="defaultColDef" [getRowId]="getRowId" [getRowClass]="getRowClass"
                                 [animateRows]="true" [suppressCellFocus]="true" (cellClicked)="onCellClicked($event)">
                </ag-grid-angular>
              }
              @if (truncated()) {
                <p class="pf-cr__more pf-num">Showing the latest {{ rows().length }} of {{ total() }} — narrow the dates, or Export CSV for every row.</p>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <ng-template #filterHead let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/></svg>
        </span>
        <h2 class="pf-card__label">Filters</h2>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close filters">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
    </ng-template>

    <ng-template #filterBody>
      <div class="pf-card__body pf-cr__filters">
        <div class="pf-field">
          <span class="pf-field__lbl" id="pf-cr-status-lbl">Status</span>
          <ul class="pf-side-list pf-cr__statuses" role="radiogroup" aria-labelledby="pf-cr-status-lbl" data-testid="cr-status">
            @for (o of statusOptions(); track o.value) {
              <li>
                <button type="button" class="pf-side-item pf-cr__status" role="radio" [class.is-on]="status() === o.value"
                        [attr.aria-checked]="status() === o.value" (click)="setStatus(o.value)">
                  <span class="pf-cr-dot" [attr.data-tone]="o.tone" aria-hidden="true"></span>
                  <span class="pf-cr__sname">{{ o.label }}</span>
                  @if (o.count != null) { <span class="pf-num pf-cr__scount">{{ o.count }}</span> }
                </button>
              </li>
            }
          </ul>
        </div>
        <div class="pf-field">
          <span class="pf-field__lbl" id="pf-cr-range-lbl">Detected (IST)</span>
          <span class="pf-seg pf-cr__seg" role="radiogroup" aria-labelledby="pf-cr-range-lbl">
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="quick() === 'today'" (click)="setQuick('today')">Today</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="quick() === '7d'" (click)="setQuick('7d')">7 days</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="quick() === '30d'" (click)="setQuick('30d')">30 days</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="quick() === 'custom'" (click)="setQuick('custom')">Custom</button>
          </span>
          <div class="pf-cr__dates">
            <label class="pf-cr__dates-lbl" for="pf-cr-from">From</label>
            <pf-date label="From" inputId="pf-cr-from" [value]="from()" [max]="to() || today" (valueChange)="setFrom($event)"></pf-date>
            <label class="pf-cr__dates-lbl" for="pf-cr-to">To</label>
            <pf-date label="To" inputId="pf-cr-to" [value]="to()" [min]="from()" [max]="today" (valueChange)="setTo($event)"></pf-date>
          </div>
        </div>
        @if (branchOptions().length > 1) {
          <div class="pf-field">
            <label class="pf-field__lbl" for="pf-cr-branch">Branch</label>
            <pf-select id="pf-cr-branch" size="sm" [options]="branchOptions()" [value]="branchId()" (valueChange)="setBranch($event)"></pf-select>
          </div>
        }
        <p class="pf-field__hint">Acknowledge = "I have seen this". Record communication = who was told, how and when. Viewing alone is never recorded.</p>
      </div>
    </ng-template>

    @if (dialogFor(); as e) {
      <pf-critical-communication-dialog [event]="e" (closed)="dialogFor.set(null)" (saved)="onCommunicated($event)"></pf-critical-communication-dialog>
    }
  `,
  styles: [`
    .pf-cr__skel { display: block; }
    :host { display: block; min-height: 0; }
    .pf-cr__body { display: flex; flex-direction: column; min-height: 0; }
    .pf-cr__panels { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: stretch; flex: 1 1 auto; min-height: 0; }
    .pf-cr__panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-cr__side { min-height: 0; }
    .pf-cr__side--sheet {
      position: fixed; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); z-index: 80; max-height: 80dvh;
      border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .pf-cr__side--sheet .pf-sheet__handle { display: block; width: 40px; height: 4px; margin: 8px auto 0; border-radius: 999px; background: var(--pf-line); }
    .pf-cr__filters { gap: 16px; }
    /* Four options share one row inside the 300px card: equal cells, tight padding, never wrapping onto the next label. */
    .pf-cr__seg { flex-wrap: nowrap; width: 100%; }
    .pf-cr__seg .pf-seg__item { flex: 1 1 0; min-width: 0; padding-inline: 6px; justify-content: center; white-space: nowrap; }
    .pf-cr__statuses { padding: 0; margin-bottom: 4px; }
    .pf-cr__sname { flex: 1 1 auto; min-width: 0; }
    .pf-cr__scount { flex: none; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-cr-dot { width: 8px; height: 8px; border-radius: 999px; flex: none; background: var(--text-tertiary); --pf-cr-tone: var(--text-tertiary); }
    .pf-cr-dot[data-tone='red'] { background: var(--red-text, #b91c1c); }
    .pf-cr-dot[data-tone='amber'] { background: var(--amber-text, #b45309); }
    .pf-cr-dot[data-tone='green'] { background: var(--green-text, #15803d); }
    .pf-cr-dot[data-tone='none'] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--text-tertiary); }
    .pf-cr__dates { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; align-items: center; }
    .pf-cr__dates-lbl { font-size: 12px; color: var(--text-tertiary); }
    .pf-cr__main { min-width: 0; min-height: 0; }
    .pf-cr__head { flex-wrap: nowrap; }
    .pf-cr__hint { color: var(--text-tertiary); }
    .pf-cr__count { flex: none; margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-cr__grid-wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-cr__grid { display: block; width: 100%; flex: 1 1 auto; height: calc(100dvh - 300px); min-height: 320px; }
    :host-context(.design-new) .pf-cr__grid { height: auto; min-height: 280px; }
    .pf-cr__main ::ng-deep .ag-root-wrapper { border: 0; border-radius: 0; }
    /* One thin critical stripe on the row's left edge only: no pinned-column divider, no header resize dividers. */
    .pf-cr__grid { --ag-pinned-column-border: none; }
    .pf-cr__main ::ng-deep .ag-cell-first-right-pinned, .pf-cr__main ::ng-deep .ag-header-cell-first-right-pinned { border-left: 0; }
    .pf-cr__main ::ng-deep .ag-header-cell-resize::after, .pf-cr__main ::ng-deep .ag-header-cell::after { display: none; }
    .pf-cr__main ::ng-deep .ag-pinned-right-header, .pf-cr__main ::ng-deep .ag-pinned-right-cols-container { border-left: 0; }
    .pf-cr__more { margin: 0; padding: 8px 14px; font-size: 12px; color: var(--text-tertiary); border-top: 1px solid var(--pf-line); }
    /* Row cells: ONE status word (dot + colour), row actions as kit .pf-rowact. */
    .pf-cr__main ::ng-deep .pf-cr-status { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1.3; white-space: nowrap; --pf-cr-tone: var(--text-secondary); color: var(--text-primary); background: var(--pf-chip-bg); box-shadow: inset 0 0 0 1px var(--pf-line); }
    .pf-cr__main ::ng-deep .pf-cr-status[data-tone='red'] { --pf-cr-tone: var(--red-text, #b91c1c); }
    .pf-cr__main ::ng-deep .pf-cr-status[data-tone='amber'] { --pf-cr-tone: var(--amber-text, #b45309); }
    .pf-cr__main ::ng-deep .pf-cr-status[data-tone='green'] { --pf-cr-tone: var(--green-text, #15803d); }
    .pf-cr__main ::ng-deep .pf-cr-status__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pf-cr-tone); flex: none; }
    .pf-cr__main ::ng-deep .pf-cr-acts { display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end; width: 100%; min-height: 44px; }
    .pf-cr__main ::ng-deep .pf-cr-acts .pf-rowact { min-height: 44px; }
    .pf-cr__main ::ng-deep .ag-header-cell[col-id='actions'] .ag-header-cell-resize,
    .pf-cr__main ::ng-deep .ag-header-cell[col-id='actions']::after { display: none; }
    .pf-cr__main ::ng-deep .ag-header-cell.pf-cr-acthead .ag-header-cell-label { justify-content: flex-end; }
    .pf-cr__main ::ng-deep .pf-cr-cell { line-height: 1.3; display: flex; flex-direction: column; justify-content: center; min-height: 100%; padding: 8px 0; white-space: normal; overflow-wrap: break-word; }
    .pf-cr__main ::ng-deep .pf-cr-nb { white-space: nowrap; }
    .pf-cr__main ::ng-deep .pf-cr-cell__sub { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-cr__main ::ng-deep .pf-cr-cell--stack { gap: 2px; }
    .pf-cr__main ::ng-deep .ag-cell.pf-cr-actcell { padding-left: 6px; padding-right: 6px; }
    .pf-cr__main ::ng-deep .pf-cr-acts .pf-rowact--icon { width: 44px; height: 44px; }
    .pf-cr__main ::ng-deep .pf-cr-row--open .ag-cell[col-id='detectedAt'] { box-shadow: inset 3px 0 0 var(--red-text, #dc2626); }
    @media (max-width: 900px) {
      .pf-cr__grid { height: calc(100dvh - 260px); }
    }
    @media (max-width: 640px) {
      .pf-cr__hint { display: none; }
      .pf-cr__main ::ng-deep .pf-cr-acts { gap: 4px; }
    }
  `],
})
export class CriticalResultsComponent {
  private readonly svc = inject(CriticalResultsService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  readonly today = labToday();
  readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  readonly isCoarse = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  readonly narrow = signal(this.mq('(max-width: 900px)'));
  readonly sheetOpen = signal(false);

  // ── Filters ───────────────────────────────────────────────────────────
  readonly q = signal('');
  readonly status = signal<StatusFilter>('open');
  readonly quick = signal<QuickRange>('30d');
  readonly from = signal<string | null>(labDaysAgo(30));
  readonly to = signal<string | null>(labToday());
  readonly branchId = signal<string>('');
  readonly branchOptions = computed<PfSelectOption<string>[]>(() => {
    const list = this.auth.user()?.branches ?? [];
    if (list.length < 2) return [];
    return [{ value: '', label: 'All branches' }, ...list.map(b => ({ value: b.id, label: b.name }))];
  });

  // ── Data ───────────────────────────────────────────────────────────────
  readonly rows = signal<CriticalResultEvent[]>([]);
  readonly total = signal(0);
  readonly openCount = signal(0);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  /** Skeleton while the register loads with nothing on screen yet (after 150ms). */
  readonly listSkeleton = spinDelay(computed(() => this.loading() && this.rows().length === 0));
  /** Events whose Acknowledge request is in flight (no double acknowledgement). */
  private readonly acking = new Set<string>();
  readonly dialogFor = signal<CriticalResultEvent | null>(null);
  readonly visibleRows = computed(() => searchEvents(this.rows(), this.q()));
  readonly truncated = computed(() => this.total() > this.rows().length);
  readonly countLabel = computed(() => {
    const n = this.visibleRows().length;
    const open = this.openCount();
    return `${plural(n, 'record')}${open > 0 ? ` · ${open} not acknowledged` : ''}`;
  });
  readonly statusOptions = computed<Array<{ value: StatusFilter; label: string; tone: string; count?: number | null }>>(() => [
    { value: 'open', label: 'Not acknowledged', tone: 'red', count: this.openCount() },
    { value: 'acknowledged', label: 'Acknowledged', tone: 'amber' },
    { value: 'communicated', label: 'Communicated', tone: 'green' },
    { value: 'all', label: 'All', tone: 'none' },
  ]);

  // ── Grid ───────────────────────────────────────────────────────────────
  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  readonly getRowId = (p: GetRowIdParams<CriticalResultEvent>) => p.data.id;
  readonly getRowClass = (p: RowClassParams<CriticalResultEvent>) => (p.data?.status === 'open' ? 'pf-cr-row--open' : '');
  readonly defaultColDef: ColDef<CriticalResultEvent> = { sortable: true, resizable: true, filter: false, minWidth: 120, autoHeight: true, wrapText: true };
  readonly colDefs = computed<ColDef<CriticalResultEvent>[]>(() => {
    const me = this.auth.user()?.id;
    const canAct = this.auth.hasAnyPermission(['enter_result', 'validate_result']);
    const web = !this.isCoarse && !this.isPhone;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
    const cell = (main: string, sub?: string) =>
      `<div class="pf-cr-cell"><span>${esc(main)}</span>${sub ? `<span class="pf-cr-cell__sub">${whole(sub)}</span>` : ''}</div>`;
    const whole = (sub: string) => sub.split(' · ').map(x => `<span class="pf-cr-nb">${esc(x)}</span>`).join(' · ');
    const multiBranch = this.branchOptions().length > 1;
    const cols: ColDef<CriticalResultEvent>[] = [
      { colId: 'detectedAt', headerName: 'Detected', minWidth: 190, width: 190, flex: 0, sort: 'desc',
        valueGetter: p => p.data?.detectedAt ?? '',
        cellRenderer: (p: { data?: CriticalResultEvent }) => cell(istStamp(p.data?.detectedAt), [
          p.data?.detectedByName ? 'by ' + p.data.detectedByName : '',
          p.data?.alertedAt ? p.data.alertedCount + ' alerted' : '',
        ].filter(Boolean).join(' · ')) },
      { colId: 'patient', headerName: 'Patient', flex: 1.3, minWidth: 120,
        valueGetter: p => p.data?.patientName ?? '',
        cellRenderer: (p: { data?: CriticalResultEvent }) => cell(p.data?.patientName ?? '',
          [p.data?.patientMrn, p.data?.orderNumber, multiBranch ? p.data?.branchName : null].filter(Boolean).join(' · ')) },
      { colId: 'test', headerName: 'Test', flex: 1.4, minWidth: 110,
        valueGetter: p => p.data?.testName ?? '',
        cellRenderer: (p: { data?: CriticalResultEvent }) => cell(p.data?.testName ?? '', p.data?.summary) },
      { colId: 'status', headerName: 'Status', flex: 1.5, minWidth: this.isCoarse ? 200 : 230,
        valueGetter: p => p.data?.status ?? '',
        cellRenderer: (p: { data?: CriticalResultEvent }) => {
          const e = p.data; if (!e) return '';
          const st = criticalStatusWord(e.status);
          const lines: string[] = [];
          if (e.acknowledgedAt) lines.push(`${esc(e.acknowledgedByName ?? '')}, ${esc(istStamp(e.acknowledgedAt))}`);
          if (e.communicatedAt) lines.push(`Told ${esc(e.communicatedToName ?? '')}${e.communicatedToRole ? ' (' + esc(criticalRoleLabel(e.communicatedToRole)) + ')' : ''} by ${esc(criticalMethodLabel(e.communicationMethod).toLowerCase())}, ${esc(istStamp(e.communicatedAt))}`
            + (e.communicationNotes ? ` · ${esc(e.communicationNotes)}` : ''));
          return `<div class="pf-cr-cell"><span><span class="pf-cr-status" data-tone="${st.tone}"><span class="pf-cr-status__dot" aria-hidden="true"></span>${st.label}</span></span>`
            + lines.map(l => `<span class="pf-cr-cell__sub">${l}</span>`).join('') + `</div>`;
        } },
    ];
    if (canAct) cols.push({
      colId: 'actions', headerName: 'Actions', headerClass: 'pf-cr-acthead', sortable: false, resizable: false, pinned: 'right', lockPinned: true,
      minWidth: web ? 196 : 116, width: web ? 196 : 116, flex: 0, cellClass: 'pf-cr-actcell',
      cellRenderer: CriticalActionsCellComponent,
      cellRendererParams: { web, userId: me, onMenu: (e: CriticalResultEvent, id: 'ack' | 'comm') => (id === 'ack' ? this.acknowledge(e) : this.dialogFor.set(e)) },
    });
    return this.phoneTrim(cols);
  });

  constructor() {
    // Any filter change reloads (the search is client-side on the loaded page).
    effect(() => {
      this.status(); this.from(); this.to(); this.branchId();
      this.load();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.sheetOpen()) this.sheetOpen.set(false); }

  private mq(query: string): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    const m = window.matchMedia(query);
    const on = (ev: MediaQueryListEvent) => this.narrow?.set(ev.matches);
    try { m.addEventListener('change', on); this.destroyRef.onDestroy(() => m.removeEventListener('change', on)); } catch { /* old Safari */ }
    return m.matches;
  }

  /** Phones: one stacked RECORD column (who · what · status) between the
   *  compact time and the 44px icon actions — a 390px grid cannot hold six
   *  columns, and nothing may be truncated. */
  protected phoneTrim(cols: ColDef<CriticalResultEvent>[]): ColDef<CriticalResultEvent>[] {
    if (!this.isPhone) return cols;
    const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
    const record: ColDef<CriticalResultEvent> = {
      colId: 'record', headerName: 'Record', flex: 1, minWidth: 150,
      valueGetter: p => p.data?.patientName ?? '',
      cellRenderer: (p: { data?: CriticalResultEvent }) => {
        const e = p.data; if (!e) return '';
        const st = criticalStatusWord(e.status);
        return `<div class="pf-cr-cell pf-cr-cell--stack"><span>${esc(e.patientName)}</span>` +
          `<span class="pf-cr-cell__sub">${esc([e.patientMrn, e.orderNumber].filter(Boolean).join(' · '))}</span>` +
          `<span>${esc(e.testName)} <span class="pf-cr-cell__sub">${esc(e.summary)}</span></span>` +
          `<span><span class="pf-cr-status" data-tone="${st.tone}" title="${st.label}"><span class="pf-cr-status__dot" aria-hidden="true"></span>${e.status === 'open' ? "Not ack'd" : st.label}</span></span></div>`;
      },
    };
    const detected = cols.find(c => c.colId === 'detectedAt');
    const actions = cols.find(c => c.colId === 'actions');
    return [
      { ...detected, headerName: 'When', width: 92, minWidth: 92, cellRenderer: (p: { data?: CriticalResultEvent }) => {
        const [d, t] = istStamp(p.data?.detectedAt).split(', ');
        return `<div class="pf-cr-cell"><span>${esc(d)}</span><span class="pf-cr-cell__sub">${esc(t ?? '')}</span></div>`;
      } },
      record,
      ...(actions ? [{ ...actions, width: 108, minWidth: 108 }] : []),
    ];
  }

  filter(): CriticalRegisterFilter {
    return { status: this.status(), from: this.from(), to: this.to(), branchId: this.branchId() || null, page: 1, pageSize: PAGE_SIZE };
  }

  load() {
    this.loading.set(true);
    this.svc.list(this.filter()).subscribe({
      next: page => {
        this.rows.set(page?.items ?? []);
        this.total.set(page?.total ?? 0);
        this.openCount.set(page?.openCount ?? 0);
        this.loading.set(false);
      },
      error: err => { this.loading.set(false); this.toasts.error(ApiError.from(err).message); },
    });
  }

  setStatus(s: StatusFilter) { this.status.set(s); }
  setBranch(id: string) { this.branchId.set(id ?? ''); }
  setQuick(r: QuickRange) {
    this.quick.set(r);
    if (r === 'today') { this.from.set(labToday()); this.to.set(labToday()); }
    else if (r === '7d') { this.from.set(labDaysAgo(6)); this.to.set(labToday()); }
    else if (r === '30d') { this.from.set(labDaysAgo(30)); this.to.set(labToday()); }
  }
  setFrom(v: string | null) { if (v !== this.from()) { this.quick.set('custom'); this.from.set(v); } }
  setTo(v: string | null) { if (v !== this.to()) { this.quick.set('custom'); this.to.set(v); } }

  onCellClicked(ev: CellClickedEvent<CriticalResultEvent>) {
    const target = (ev.event?.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
    const e = ev.data;
    if (!target || !e) return;
    if (target.dataset['act'] === 'ack') this.acknowledge(e, target);
    else if (target.dataset['act'] === 'comm') this.dialogFor.set(e);
  }

  acknowledge(e: CriticalResultEvent, btn?: HTMLElement) {
    if (this.acking.has(e.id)) return;
    this.acking.add(e.id);
    // DOM-built row action: busy in the same frame (the row re-renders on success).
    const release = () => { this.acking.delete(e.id); btn?.removeAttribute('aria-busy'); btn?.classList.remove('pf-is-busy'); btn?.removeAttribute('disabled'); };
    btn?.setAttribute('aria-busy', 'true'); btn?.classList.add('pf-is-busy'); btn?.setAttribute('disabled', '');
    this.svc.acknowledge(e.id, 'register').subscribe({
      next: updated => { release(); this.toasts.success('Critical result acknowledged'); this.replace(updated); },
      error: err => { release(); this.toasts.error(ApiError.from(err).message); },
    });
  }

  onCommunicated(updated: CriticalResultEvent) {
    this.dialogFor.set(null);
    this.replace(updated);
  }

  private replace(updated: CriticalResultEvent) {
    const before = this.rows().find(r => r.id === updated.id);
    this.rows.update(list => list.map(r => (r.id === updated.id ? updated : r)));
    if (before?.status === 'open' && updated.status !== 'open') this.openCount.update(n => Math.max(0, n - 1));
  }

  exportCsv() {
    if (this.exporting()) return;
    this.exporting.set(true);
    const f = this.filter();
    this.svc.exportCsv(f).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `critical-results-${f.from ?? 'all'}_to_${f.to ?? 'all'}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      },
      error: err => { this.exporting.set(false); this.toasts.error(ApiError.from(err).message); },
    });
  }
}
