import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { AllCommunityModule, CellValueChangedEvent, ColDef, GetRowIdParams, GridApi, GridReadyEvent, ICellRendererParams, ModuleRegistry } from 'ag-grid-community';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { AuthService } from '../../../core/auth/auth.service';
import {
  SG_ICON, SG_NARROW_MQ, SG_PHONE_MQ, SgAction, SgStatus, sgActions, sgActionsCol, sgByStatus, sgCell, sgGridTheme, sgMedia, sgRowOff, sgStatusCol,
  sgStatusOptions,
} from '../../../shared/settings-grid/settings-grid';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CdkDragDrop, CdkDropList, CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Branch, Department } from '../../../shared/models/tenant.model';
import { DEPARTMENT_ORIGIN_LABEL, departmentOrigin, departmentErrorMessage } from '../../../shared/utils/test-origin';
import { bandMatch } from '../../../shared/utils/band-search';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SETTINGS_HOST, bindTabQuery, injectSettingsHosted } from '../../../shared/utils/settings-host';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonRowsComponent, SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';

ModuleRegistry.registerModules([AllCommunityModule]);

/** A physical lab space within a branch; departments are placed into one. */
interface LabSpace { id: string; branchId: string; name: string; code?: string | null; order: number; }
/** Per-branch placement of a tenant-global department into one of that
 *  branch's spaces. No row = the department sits in the branch's default Lab. */
interface DeptSpaceLink { branchId: string; departmentId: string; spaceId: string; }

export type LabDepartmentsTab = 'departments' | 'spaces';
/** A branch's lab spaces as a Settings-shell category: `?tab=spaces-<branchId>`. */
export const SPACE_TAB_PREFIX = 'spaces-';
export const LAB_DEPARTMENTS_TABS: readonly LabDepartmentsTab[] = ['departments', 'spaces'];

/**
 * Lab › Departments and lab spaces (owner 2026-11-17).
 *   Departments tab — every department of the lab, on or off; the ones the lab
 *     made itself ("Made here") can also be added, renamed and deleted. The
 *     catalogue's ("From the catalogue") only switch on or off.
 *   Lab spaces tab — per branch: space names and codes (sample-ID prefixes) and
 *     which space each department works in. Moved here from Branches.
 * Deep link: /admin/lab/departments?tab=departments|spaces.
 */
@Component({
  selector: 'pf-lab-departments',
  standalone: true,
  imports: [SkeletonRowsComponent, SkeletonTableComponent, BusyDirective, RouterLink, FormsModule, CdkDropList, CdkDrag, CdkDragHandle,
    ScreenHeaderComponent, HeroBandComponent, SegmentedComponent, NgTemplateOutlet, DataGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [placeholder]="tab() === 'departments' ? 'Search departments…' : 'Search branches and departments…'"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            @if (narrow() && !hosted) {
              <!-- Narrow widths: the Departments / Lab spaces tree opens as a sheet (Test Master). -->
              <button type="button" class="pf-chip pf-sg-chip press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" data-testid="ld-tree-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
                {{ tab() === 'departments' ? 'Departments' : 'Lab spaces · ' + (selectedBranch()?.name || 'Branch') }}
              </button>
            }
          </ng-container>
          @if (tab() === 'departments') {
            <ng-container band-actions>
              <button type="button" class="pf-hb-btn press" data-testid="ld-add"
                      [class.pf-hb-btn--primary]="!addOpen()" [class.pf-hb-btn--ghost]="addOpen()"
                      (click)="toggleAdd()" [attr.aria-label]="addOpen() ? 'Cancel new department' : 'Add department'">
                @if (addOpen()) {
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                }
                {{ addOpen() ? 'Cancel' : 'Add department' }}
              </button>
            </ng-container>
          }
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab" title="Departments and lab spaces"
        subtitle="Which departments the lab runs, and the lab space each one works in."></pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels ld-panels" [class.pf-sg-panels--narrow]="narrow()" [class.pf-sg-panels--single]="hosted">
          <!-- SIDE card (LEFT): Departments, and Lab spaces with its branch tree. In the Settings shell the shell's
               side card lists the same (SETTINGS_HOST.categories: Departments + one row per branch). -->
          @if (hosted) {
          } @else if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-sg-side pf-sg-side--sheet ld-side" role="dialog" aria-modal="true" aria-label="Departments and lab spaces"
                     (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sg-sheet-handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="tree; context: { sheet: true }"></ng-container>
              </aside>
            }
          } @else {
            <aside class="pf-card pf-sg-side ld-side" aria-label="Departments and lab spaces">
              <ng-container *ngTemplateOutlet="tree; context: { sheet: false }"></ng-container>
            </aside>
          }

          <!-- MAIN card (RIGHT) -->
          @if (tab() === 'departments') {
            <section class="pf-card pf-sg-main ld-main" [class.pf-sg-main--bare]="hosted" aria-label="Departments">
              <header class="pf-card__head pf-sg-main__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
                <span class="pf-card__label">Departments</span>
                <span class="pf-card__note pf-sg-hint">{{ originLabel.catalogue }}: switch on or off · {{ originLabel.lab }}: double-click the name to rename, or delete if unused</span>
                <ng-container *ngTemplateOutlet="deptTools"></ng-container>
              </header>
              @if (addOpen()) {
                <!-- Add department: ONE compact row above the grid. -->
                <div class="ld-add pf-anim-in" aria-label="New department" data-testid="ld-add-form">
                  <label class="pf-field ld-add__name"><span class="pf-field__lbl">Name</span>
                    <input type="text" class="pf-input" [class.pf-input-error]="!!addErr().name" maxlength="80" data-testid="ld-add-name"
                           [ngModel]="draftName()" (ngModelChange)="draftName.set($event); addErr.set({})" placeholder="e.g. Cytogenetics" />
                    @if (addErr().name) { <span class="pf-field-error" data-testid="ld-add-name-err">{{ addErr().name }}</span> }
                  </label>
                  <label class="pf-field ld-add__code"><span class="pf-field__lbl">Code</span>
                    <input type="text" class="pf-input pf-num uppercase" [class.pf-input-error]="!!addErr().code" maxlength="12" data-testid="ld-add-code"
                           [ngModel]="draftCode()" (ngModelChange)="draftCode.set($event.toUpperCase()); addErr.set({})" placeholder="e.g. CYTO" />
                    @if (addErr().code) { <span class="pf-field-error" data-testid="ld-add-code-err">{{ addErr().code }}</span> }
                  </label>
                  <div class="ld-add__acts">
                    <button type="button" class="pf-btn pf-btn--tertiary press" (click)="toggleAdd()">Cancel</button>
                    <button type="button" class="pf-btn pf-btn--primary press" data-testid="ld-add-save"
                            [disabled]="saving()" [pfBusy]="saving()" pfBusyLabel="Adding…" (click)="createDepartment()">Add department</button>
                  </div>
                </div>
              }
              <div class="pf-sg-main__body">
                <pf-data-grid [rowData]="visibleDepartments()" [columnDefs]="colDefs()" [defaultColDef]="defaultColDef" [getRowId]="getRowId"
                              [getRowClass]="rowClass" [singleClickEdit]="isCoarse" [suppressCellFocus]="false"
                              [loading]="listSkeleton()" loadingLabel="Loading departments…"
                              [emptyTitle]="departments().length === 0 ? 'No departments yet.' : 'No departments match your search.'"
                              (gridReady)="onGridReady($event)" (cellValueChanged)="onCellValueChanged($event)"></pf-data-grid>
              </div>
            </section>
          } @else {
            <section class="pf-card pf-sg-main ld-main ld-spaces" [class.pf-sg-main--bare]="hosted" aria-label="Lab spaces">
              <header class="pf-card__head pf-sg-main__head">
                <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>
                <span class="pf-card__label" data-testid="ld-spaces-title">Lab spaces{{ selectedBranch() ? ' · ' + selectedBranch()!.name : '' }}</span>
                @if (selectedBranch(); as b) {
                  <span class="pf-card__note pf-sg-hint">Drag a department into a space · each code prefixes sample IDs</span>
                  <span class="pf-sg-count pf-num">{{ spacesFor(b.id).length }} {{ spacesFor(b.id).length === 1 ? 'space' : 'spaces' }}</span>
                }
              </header>
              <div class="pf-card__body ld-board-body">
                @if (listSkeleton()) {
                  <pf-skeleton-rows [rows]="4" [avatar]="false" label="Loading lab spaces…"></pf-skeleton-rows>
                } @else if (branches().length === 0) {
                  <p class="pf-band-empty">No branches yet.</p>
                } @else if (selectedBranch(); as b) {
                  <p class="ld-hint">Tubes are counted per space and colour — departments in one space sharing a colour share a vial.</p>
                  <p class="ld-hint" data-testid="br-sample-id-note">
                    Each space's code (and the Lab code) is the sample-ID prefix; the date and number part is set in
                    <a class="ld-link" routerLink="/admin/lab/sample-numbers" [queryParams]="{ tab: 'sample' }">Lab › Sample numbers</a>.
                  </p>
                  @if (structureOf(b) === 'integrated') {
                    <p class="ld-hint">This branch runs <strong>Integrated</strong> — one lab, one space: every department shares "Lab (default)". The arrangement below is saved but only applies after switching the branch to <strong>Auto</strong> in Lab structure (Sample numbers).</p>
                  } @else if (structureOf(b) === 'standalone') {
                    <p class="ld-hint">This branch runs <strong>Standalone</strong> — every department keeps its own sample-ID prefix; tubes are still shared across departments. The arrangement below only applies after switching the branch to <strong>Auto</strong> in Lab structure (Sample numbers).</p>
                  }
            <div class="pf-board">
              <div class="pf-lane">
                <div class="pf-lane-hdr">
                  <span class="pf-lane-name">Lab (default)</span>
                  <input class="pf-lane-code-input uppercase" [value]="b.defaultLabCode || ''" (change)="setDefaultLabCode(b, $any($event.target).value)"
                         maxlength="16" placeholder="no prefix" aria-label="Default Lab code — prefixes sample IDs"
                         title="Sample-ID prefix for the default Lab space (e.g. LAB → LAB-2607-00001). Leave blank for no prefix." />
                  <span class="pf-lane-count">{{ branchDeptsNoSpace(b.id).length }}</span>
                </div>
                <div class="pf-lane-body" cdkDropList [cdkDropListData]="branchDeptsNoSpace(b.id)"
                     [cdkDropListConnectedTo]="laneIdsFor(b.id)" [id]="'unassigned-' + b.id"
                     (cdkDropListDropped)="dropDept($event, b.id, null)">
                  @for (d of branchDeptsNoSpace(b.id); track d.id) {
                    <div class="pf-dcard" cdkDrag [class.pf-dcard--inactive]="!d.isActive">
                      <span class="pf-dcard-grip" cdkDragHandle aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
                      <span class="pf-dcard-name">{{ d.name }}</span>
                      <span class="pf-dcard-code">{{ d.code }}</span>
                    </div>
                  } @empty { <p class="pf-lane-empty">No departments in the default Lab space</p> }
                </div>
              </div>
              @for (sp of spacesFor(b.id); track sp.id) {
                <div class="pf-lane">
                  <div class="pf-lane-hdr">
                    <span class="pf-lane-edit">
                      <input class="pf-lane-name-input" [value]="sp.name" (change)="renameSpace(sp, $any($event.target).value)" placeholder="Space name" aria-label="Space name" />
                      <svg class="pf-lane-edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16v4Zm11-13 4 4"/></svg>
                    </span>
                    <input class="pf-lane-code-input uppercase" [class.pf-lane-code-input--missing]="!sp.code" [value]="sp.code || ''" (change)="setSpaceCode(sp, $any($event.target).value)" maxlength="16" placeholder="CODE" aria-label="Space code — prefixes sample IDs" title="Sample-ID prefix (e.g. MIC → MIC-2607-00001)" />
                    <button type="button" class="pf-lane-del press" (click)="deleteSpace(sp)" aria-label="Delete space" title="Delete space">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                    </button>
                  </div>
                  <div class="pf-lane-body" cdkDropList [cdkDropListData]="branchDeptsInSpace(sp.id)"
                       [cdkDropListConnectedTo]="laneIdsFor(b.id)" [id]="'sp-' + sp.id"
                       (cdkDropListDropped)="dropDept($event, b.id, sp.id)">
                    @for (d of branchDeptsInSpace(sp.id); track d.id) {
                      <div class="pf-dcard" cdkDrag [class.pf-dcard--inactive]="!d.isActive">
                        <span class="pf-dcard-grip" cdkDragHandle aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
                        <span class="pf-dcard-name">{{ d.name }}</span>
                        <span class="pf-dcard-code">{{ d.code }}</span>
                      </div>
                    } @empty { <p class="pf-lane-empty">Drag departments here</p> }
                  </div>
                </div>
              }
              <button type="button" class="pf-add-space-lane press" [disabled]="addingSpaceFor() === b.id" [pfBusy]="addingSpaceFor() === b.id" pfBusyLabel="Adding…" (click)="addSpace(b.id)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add space
              </button>
            </div>

                } @else {
                  <p class="pf-band-empty">Pick a branch.</p>
                }
              </div>
            </section>
          }
        </div>
      </div>
    </section>

    <!-- Head tools (count + status filter): the shell renders them in ITS card head when hosted (headTools). -->
    <ng-template #deptTools>
      <span class="pf-sg-count pf-num">{{ visibleDepartments().length }} {{ visibleDepartments().length === 1 ? 'department' : 'departments' }}</span>
      <pf-segmented class="pf-sg-status-filter" size="sm" [options]="statusOptions()" [value]="status()"
                    (valueChange)="status.set($event)" aria-label="Filter by status"></pf-segmented>
    </ng-template>
    <ng-template #spaceTools>
      @if (selectedBranch(); as b) {
        <span class="pf-sg-count pf-num">{{ spacesFor(b.id).length }} {{ spacesFor(b.id).length === 1 ? 'space' : 'spaces' }}</span>
      }
    </ng-template>

    <!-- The tree: Departments · Lab spaces ▸ branches (Test Master's department rows). -->
    <ng-template #tree let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14"/></svg></span>
        <span class="pf-card__label">Lab</span>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      <ul class="pf-card__body ld-tree" role="tree" aria-label="Departments and lab spaces">
        <li class="ld-node" role="treeitem" [attr.aria-selected]="tab() === 'departments'">
          <button type="button" class="ld-node__btn" data-testid="ld-node-departments" [attr.aria-pressed]="tab() === 'departments'" (click)="pickTab('departments')">
            <span class="ld-node__name">Departments</span>
            <span class="ld-node__n pf-num">{{ departments().length }}</span>
          </button>
        </li>
        <li class="ld-node" role="treeitem" [attr.aria-expanded]="spacesOpen()">
          <div class="ld-node__row">
            <button type="button" class="ld-node__chev" (click)="spacesOpen.set(!spacesOpen())" [attr.aria-label]="spacesOpen() ? 'Collapse lab spaces' : 'Expand lab spaces'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [class.ld-chev--open]="spacesOpen()"><path d="m9 18 6-6-6-6"/></svg>
            </button>
            <button type="button" class="ld-node__btn" data-testid="ld-node-spaces" [attr.aria-pressed]="tab() === 'spaces' && !branchId()" (click)="pickTab('spaces')">
              <span class="ld-node__name">Lab spaces</span>
              <span class="ld-node__n pf-num">{{ branches().length }} {{ branches().length === 1 ? 'branch' : 'branches' }}</span>
            </button>
          </div>
          @if (spacesOpen()) {
            <ul class="ld-tree__kids" role="group">
              @for (b of visibleBranches(); track b.id) {
                <li class="ld-node ld-node--kid" role="treeitem" [attr.aria-selected]="tab() === 'spaces' && selectedBranch()?.id === b.id">
                  <button type="button" class="ld-node__btn" [attr.data-testid]="'ld-branch-' + b.id"
                          [attr.aria-pressed]="tab() === 'spaces' && selectedBranch()?.id === b.id" (click)="pickBranch(b.id)">
                    <span class="ld-node__name">{{ b.name }}@if (b.code) {<span class="ld-node__code pf-num">{{ b.code }}</span>}</span>
                    <span class="ld-node__n pf-num">{{ spacesFor(b.id).length }} {{ spacesFor(b.id).length === 1 ? 'space' : 'spaces' }}</span>
                  </button>
                </li>
              } @empty {
                <li class="ld-node ld-node--kid ld-node--empty">{{ branches().length ? 'No branches match "' + q() + '"' : 'No branches yet' }}</li>
              }
            </ul>
          }
        </li>
      </ul>
    </ng-template>
  `,
  styles: [`
    .ld-hint { margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: var(--text-tertiary); }
    .ld-link { color: var(--violet-text, #7c3aed); font-weight: 600; text-decoration: none; }
    .ld-link:hover { text-decoration: underline; }
    .ld-panels { flex: 1 1 auto; }
    /* Tree (Test Master's department rows) */
    .ld-tree { list-style: none; margin: 0; padding: 6px; gap: 2px; }
    .ld-tree__kids { list-style: none; margin: 2px 0 0; padding: 0 0 0 22px; display: flex; flex-direction: column; gap: 2px; }
    .ld-node__row { display: flex; align-items: center; gap: 2px; }
    .ld-node__btn { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;
      min-height: 40px; padding: 8px 10px; border: 0; border-radius: var(--pf-radius-sm); background: transparent;
      font: inherit; text-align: left; cursor: pointer; color: var(--text-primary); }
    .ld-node__btn:hover:not([aria-pressed='true']) { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    .ld-node__btn[aria-pressed='true'] { background: var(--pf-sel-bg); box-shadow: inset 0 0 0 1px var(--pf-sel-border); }
    .ld-node__btn:focus-visible, .ld-node__chev:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .ld-node__name { min-width: 0; font-size: 13.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .ld-node__code { font-size: 11px; font-weight: 600; color: var(--text-tertiary); }
    .ld-node__n { flex: none; font-size: 12px; color: var(--text-tertiary); }
    .ld-node__chev { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 32px; padding: 0;
      border: 0; background: transparent; color: var(--text-tertiary); cursor: pointer; border-radius: 6px; }
    .ld-node__chev svg { transition: transform var(--pf-dur-fast, 120ms) ease; }
    .ld-chev--open { transform: rotate(90deg); }
    .ld-node--empty { padding: 8px 10px; font-size: 12px; color: var(--text-tertiary); }
    @media (pointer: coarse) { .ld-node__chev { width: 44px; height: 44px; } .ld-node__btn { min-height: 44px; } }
    /* Add department: one compact row above the grid */
    .ld-add { flex: none; display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; padding: 12px 14px; border-bottom: 1px solid var(--pf-line); }
    .ld-add__name { flex: 2 1 220px; }
    .ld-add__code { flex: 1 1 120px; }
    .ld-add__acts { display: flex; gap: 8px; margin-left: auto; }
    .ld-board-body { padding: 14px 16px; }
    :host ::ng-deep .ld-chip { height: 22px; font-size: 11px; }
    :host ::ng-deep .ld-chip--own { background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); color: var(--violet-text, #7c3aed); }
    .pf-field-error { font-size: 11px; color: var(--red-text); }
    .pf-input-error { border-color: #ef4444 !important; }
    @media (max-width: 640px) { :host .pf-input { font-size: 16px; } }
    /* ── Lab spaces board (drag-drop, workflow-style) ── */
    .pf-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .pf-lane {
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); border-radius: 12px;
      background: var(--glass-bg, rgba(255,255,255,0.02)); display: flex; flex-direction: column; overflow: hidden;
    }
    .pf-lane-hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border-bottom: 1px solid var(--glass-border, rgba(255,255,255,0.08)); }
    .pf-lane-name { font-size: 12.5px; font-weight: 650; color: var(--text-primary); }
    .pf-lane-count { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-muted); }
    .pf-lane-edit { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; border-bottom: 1px dashed var(--glass-border, rgba(255,255,255,0.2)); }
    .pf-lane-edit:focus-within { border-bottom-color: #7c3aed; }
    .pf-lane-name-input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; font-size: 12.5px; font-weight: 650; color: var(--text-primary); padding: 3px 2px; }
    .pf-lane-edit-icon { color: var(--text-muted); flex-shrink: 0; }
    .pf-lane-edit:focus-within .pf-lane-edit-icon { color: var(--violet-text); }
    .pf-lane-code-input { flex-shrink: 0; width: 64px; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 7px; outline: none; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--text-primary); padding: 3px 6px; text-align: center; }
    .pf-lane-code-input::placeholder { color: var(--text-muted); font-weight: 600; letter-spacing: 0.1em; }
    .pf-lane-code-input:focus { border-color: var(--violet-text); }
    /* No code yet → tint the field so admins notice it prefixes the sample ID. */
    .pf-lane-code-input--missing { border-color: var(--pf-sel-border); }
    .pf-add-space-lane {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
      min-height: 90px; border: 1.5px dashed var(--glass-border, rgba(255,255,255,0.2)); border-radius: 12px;
      background: transparent; color: var(--text-tertiary); font-size: 12.5px; font-weight: 700; cursor: pointer;
      letter-spacing: .02em; transition: border-color .15s, color .15s, background .15s;
    }
    .pf-add-space-lane:hover { border-color: #7c3aed; color: #c4b5fd; background: rgba(124,58,237,0.07); }
    .pf-dept-source { display: flex; align-items: center; gap: 6px; }
    .pf-lane-del { display: inline-flex; padding: 4px; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 6px; flex-shrink: 0; }
    .pf-lane-del:hover { color: #f87171; background: rgba(248,113,113,0.12); }
    .pf-lane-body { min-height: 60px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
    .pf-lane-empty { font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px 4px; margin: 0; }

    .pf-dcard {
      display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; min-width: 0;
      border-radius: 10px; padding: 8px 10px;
      background: var(--bg-card-solid, #14141f); border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
    }
    .pf-dcard--inactive { opacity: .55; }
    .pf-dcard-grip { display: inline-flex; color: var(--text-muted); cursor: grab; flex-shrink: 0; }
    .pf-dcard-grip:active { cursor: grabbing; }
    .pf-dcard-name { font-size: 12.5px; font-weight: 600; color: var(--text-primary); flex: 1; min-width: 0; line-height: 1.2; word-break: break-word; }
    .pf-dcard-code { font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--text-muted); flex-shrink: 0; }
    .pf-dcard-toggle {
      margin-left: auto; font-size: 10.5px; color: var(--text-secondary); background: transparent;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.14)); border-radius: 6px; padding: 3px 7px; cursor: pointer; flex-shrink: 0; white-space: nowrap;
    }
    .pf-dcard-toggle:hover { color: var(--text-primary); border-color: rgba(168,85,247,.4); }
    .cdk-drag-preview { border-radius: 10px; box-shadow: 0 10px 28px rgba(0,0,0,.5); }
    .cdk-drag-placeholder { opacity: .3; }
    .cdk-drop-list-dragging .pf-dcard:not(.cdk-drag-placeholder) { transition: transform .18s cubic-bezier(0,0,.2,1); }


  `]
})
export class LabDepartmentsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  protected readonly originLabel = DEPARTMENT_ORIGIN_LABEL;
  protected isLabMade(d: Department): boolean { return departmentOrigin(d) === 'lab'; }

  readonly tabOptions: SegmentedOption<LabDepartmentsTab>[] = [
    { value: 'departments', label: 'Departments' },
    { value: 'spaces', label: 'Lab spaces' },
  ];
  readonly tab = signal<LabDepartmentsTab>('departments');
  /** Inside the Settings shell the left panel lists the two tabs; `?tab=` drives this page. */
  protected readonly hosted = injectSettingsHosted();
  private readonly followTab = bindTabQuery(LAB_DEPARTMENTS_TABS, (t) => { if (this.tab() !== t) { this.tab.set(t); this.q.set(''); } });
  /** Switch tab and keep it in the URL (`?tab=`) so reload / link / back return to it. */
  pickTab(t: LabDepartmentsTab): void {
    this.tab.set(t);
    this.q.set('');
    if (t === 'spaces') this.spacesOpen.set(true);
    if (this.narrow() && t === 'departments') this.sheetOpen.set(false);
    void this.router.navigate([], { queryParams: { tab: t, branch: t === 'spaces' ? this.selectedBranch()?.id ?? null : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ── Settings shell: the shell's side card lists Departments + one row per branch; its head shows headTools ──
  private readonly settingsHost = inject(SETTINGS_HOST, { optional: true });
  private readonly branchesLoaded = signal(false);
  /** The ?tab= the page was opened with (before the shell had this page's rows). */
  private initialTab: string | null = (() => {
    try { return String(inject(Router).parseUrl(inject(Router).url).queryParams['tab'] ?? '') || null; } catch { return null; }
  })();
  private readonly deptToolsTpl = viewChild<TemplateRef<unknown>>('deptTools');
  private readonly spaceToolsTpl = viewChild<TemplateRef<unknown>>('spaceTools');
  /** Count + status filter (departments) / space count (a branch), for the shell's card head. */
  readonly headTools = computed(() => (this.tab() === 'departments' ? this.deptToolsTpl() : this.spaceToolsTpl()));
  private readonly listSections = (() => {
    const host = this.settingsHost;
    if (!host?.categories) return null;
    inject(DestroyRef).onDestroy(() => host.categories.set(null));
    return effect(() => {
      // Publish only once the branches are known, and never fewer than TWO rows: the shell switches between its
      // one-card and two-panel frames on the row count, and a switch re-creates this page (a reload loop).
      if (!this.branchesLoaded()) return;
      const branches = this._branches();
      const n = this._departments().length;
      const spaces = this._spaces();
      host.categories.set([
        { id: 'departments', label: 'Departments', note: String(n) },
        // A tree (owner): "Lab spaces" is a heading row, its branches are indented children.
        ...(branches.length ? [
          { id: 'spaces', label: 'Lab spaces', note: `${branches.length} ${branches.length === 1 ? 'branch' : 'branches'}`, heading: true },
          ...branches.map((b) => {
            const k = spaces.filter((x) => x.branchId === b.id).length;
            return { id: SPACE_TAB_PREFIX + b.id, label: b.name, note: `${k} ${k === 1 ? 'space' : 'spaces'}`, parent: 'spaces' };
          }),
        ] : [{ id: 'spaces', label: 'Lab spaces', note: 'No branches yet' }]),
      ]);
      // A deep link to a branch (?tab=spaces-<id>) arrived before these rows existed, so the shell fell back to its
      // first row: take the person to the branch they asked for, once.
      const want = this.initialTab;
      if (want?.startsWith(SPACE_TAB_PREFIX) && branches.some((b) => SPACE_TAB_PREFIX + b.id === want)) {
        this.initialTab = null;
        untracked(() => this.pickBranch(want.slice(SPACE_TAB_PREFIX.length)));
      }
    });
  })();
  // ── Tree: Lab spaces ▸ branch (deep link ?tab=spaces&branch=<id>; default = the user's current branch) ──
  private readonly auth = inject(AuthService, { optional: true });
  readonly branchId = signal<string | null>(null);
  readonly spacesOpen = signal(true);
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly sheetOpen = signal(false);
  readonly selectedBranch = computed(() => {
    const list = this._branches();
    const want = this.branchId() ?? this.auth?.activeBranchId?.() ?? null;
    return list.find(b => b.id === want) ?? list[0] ?? null;
  });
  /** The shell writes ?tab=spaces-<branchId> for a branch row. */
  private readonly followBranchTab = (() => {
    inject(ActivatedRoute, { optional: true })?.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      const t = q.get('tab') ?? '';
      if (t.startsWith(SPACE_TAB_PREFIX)) { this.tab.set('spaces'); this.branchId.set(t.slice(SPACE_TAB_PREFIX.length)); }
      else if (t === 'spaces' && q.get('branch')) this.branchId.set(q.get('branch'));
    });
  })();

  pickBranch(id: string): void {
    this.branchId.set(id);
    this.tab.set('spaces');
    if (this.narrow()) this.sheetOpen.set(false);
    const queryParams = this.hosted ? { tab: SPACE_TAB_PREFIX + id, branch: null } : { tab: 'spaces', branch: id };
    void this.router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ── Departments grid (Test Master) ──
  readonly isCoarse = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  readonly status = signal<SgStatus>('all');
  readonly statusOptions = computed(() => sgStatusOptions(this._departments().length, this._departments().filter(d => !d.isActive).length));
  readonly gridTheme = sgGridTheme();
  private gridApi: GridApi<Department> | null = null;
  readonly getRowId = (p: GetRowIdParams<Department>) => p.data.id;
  readonly rowClass = sgRowOff<Department>(d => d.isActive);
  readonly defaultColDef: ColDef<Department> = { sortable: true, resizable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };
  actionsFor(d: Department): SgAction[] {
    if (!this.isLabMade(d)) return [];
    return [
      { label: 'Rename', aria: 'Rename ' + d.name, path: SG_ICON.edit, icon: true, run: () => this.beginRename(d) },
      { label: 'Delete', aria: 'Delete ' + d.name, path: SG_ICON.trash, icon: true, danger: true, run: () => { void this.deleteDepartment(d); } },
    ];
  }
  readonly colDefs = computed<ColDef<Department>[]>(() => {
    const web = !this.isCoarse && !this.phone();
    const cols: ColDef<Department>[] = [
      { colId: 'name', field: 'name', headerName: 'Department', flex: 1.6, minWidth: 180, sort: 'asc',
        editable: p => !!p.data && this.isLabMade(p.data),
        valueParser: p => String(p.newValue ?? '').trim().slice(0, 80) || p.oldValue,
        cellRenderer: (p: ICellRendererParams<Department>) => sgCell(p.data?.name, null, true) },
      { colId: 'code', field: 'code', headerName: 'Code', width: 110, minWidth: 90, flex: 0, cellClass: 'pf-num' },
      { colId: 'origin', headerName: 'Origin', width: 170, minWidth: 140, flex: 0,
        valueGetter: p => (p.data && this.isLabMade(p.data) ? this.originLabel.lab : this.originLabel.catalogue),
        cellRenderer: (p: ICellRendererParams<Department>) => {
          const el = document.createElement('span');
          const own = !!p.data && this.isLabMade(p.data);
          el.className = 'pf-chip pf-chip--static ld-chip' + (own ? ' ld-chip--own' : '');
          el.dataset['testid'] = 'ld-origin';
          el.textContent = own ? this.originLabel.lab : this.originLabel.catalogue;
          return el;
        } },
      sgStatusCol<Department>(d => d.isActive, d => d.name, d => this.toggleActive(d)),
    ];
    // Rename / Delete only exist for the lab's own departments: no blank, divided actions column for a catalogue-only list.
    if (this._departments().some(d => this.isLabMade(d))) {
      cols.push(sgActionsCol<Department>(web, [], 2, p => (p.data ? sgActions(web, this.actionsFor(p.data)) : document.createElement('span')), false));
    }
    if (this.phone()) return cols.filter(c => c.colId !== 'origin');
    return cols;
  });
  onGridReady(e: GridReadyEvent<Department>) { this.gridApi = e.api; }
  /** Inline rename (lab-made only): the grid edit lands here → the same PATCH as before. */
  onCellValueChanged(e: CellValueChangedEvent<Department>) {
    if (e.colDef.colId !== 'name' || !e.data) return;
    const d = this._departments().find(x => x.id === e.data!.id);
    if (!d) return;
    // AG-Grid has already written the new value into the row object: compare with the value it replaced.
    this.renameDraft.set(String(e.newValue ?? ''));
    this.saveRename({ ...d, name: String(e.oldValue ?? '') });
  }

  readonly q = signal('');
  private readonly _branches = signal<Branch[]>([]);
  private readonly _departments = signal<Department[]>([]);
  private readonly _spaces = signal<LabSpace[]>([]);
  private readonly _links = signal<DeptSpaceLink[]>([]);
  private readonly _openIds = signal<Set<string>>(new Set());
  readonly branches = this._branches.asReadonly();
  readonly departments = this._departments.asReadonly();

  readonly visibleDepartments = computed(() => {
    const q = this.q();
    const all = sgByStatus(this._departments(), this.status(), d => d.isActive);
    return q.trim() ? all.filter(d => bandMatch(q, d.name, d.code)) : all;
  });
  readonly visibleBranches = computed(() => {
    const q = this.q();
    const all = this._branches();
    if (!q.trim()) return all;
    if (this._departments().some(d => bandMatch(q, d.name, d.code))) return all;
    return all.filter(b => bandMatch(q, b.name, b.code, b.city, b.state));
  });

  private readonly listHold = createLoadHold(true);
  readonly listSkeleton = this.listHold.active;
  readonly addingSpaceFor = signal<string | null>(null);

  // ── Add / rename ──
  readonly addOpen = signal(false);
  readonly draftName = signal('');
  readonly draftCode = signal('');
  readonly addErr = signal<{ name?: string; code?: string }>({});
  readonly saving = signal(false);
  readonly renamingId = signal<string | null>(null);
  readonly renameDraft = signal('');
  readonly renameErr = signal('');

  ngOnInit() {
    this.destroyRef.onDestroy(() => this.listHold.cancel());
    const t = this.router.parseUrl(this.router.url).queryParams['tab'];
    if ((LAB_DEPARTMENTS_TABS as readonly string[]).includes(t)) this.tab.set(t as LabDepartmentsTab);
    const br = this.router.parseUrl(this.router.url).queryParams['branch'];
    if (typeof br === 'string' && br) this.branchId.set(br);
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => { this._departments.set(l ?? []); this.listHold.done(); },
      error: () => this.listHold.done(),
    });
    this.api.get<Branch[]>('/api/tenants/branches?includeInactive=true').subscribe({
      next: l => { this._branches.set((l ?? []).filter(b => b.isActive !== false)); this.branchesLoaded.set(true); },
      error: () => this.branchesLoaded.set(true),
    });
    this.api.get<LabSpace[]>('/api/tenants/lab-spaces').subscribe({ next: l => this._spaces.set(l ?? []) });
    this.api.get<DeptSpaceLink[]>('/api/tenants/department-space-links').subscribe({ next: l => this._links.set(l ?? []) });
  }

  // ── Departments ──
  toggleAdd() {
    this.addOpen.update(v => !v);
    this.draftName.set(''); this.draftCode.set(''); this.addErr.set({});
  }
  createDepartment() {
    const name = this.draftName().trim();
    const code = this.draftCode().trim().toUpperCase();
    if (!name || !code) {
      this.addErr.set({ name: name ? undefined : 'Give the department a name.', code: code ? undefined : 'Give it a short code.' });
      return;
    }
    if (this.saving()) return;
    this.saving.set(true);
    this.api.post<Department>('/api/tenants/departments', { name, code }).subscribe({
      next: d => {
        this.saving.set(false);
        this._departments.update(l => [...l, d].sort((a, b) => a.name.localeCompare(b.name)));
        this.toasts.success(`${d.name} added`);
        this.toggleAdd();
      },
      error: e => {
        this.saving.set(false);
        const err = ApiError.from(e);
        const msg = departmentErrorMessage(err.code, err.message);
        if (err.code === 'dept_code_taken' || err.field === 'code') this.addErr.set({ code: msg });
        else if (err.code === 'dept_name_taken' || err.field === 'name') this.addErr.set({ name: msg });
        else this.toasts.error(msg);
      },
    });
  }
  beginRename(d: Department) {
    this.renamingId.set(d.id); this.renameDraft.set(d.name); this.renameErr.set('');
    const node = this.gridApi?.getRowNode(d.id);
    if (node && node.rowIndex != null) this.gridApi!.startEditingCell({ rowIndex: node.rowIndex, colKey: 'name' });
  }
  cancelRename() { this.renamingId.set(null); this.renameErr.set(''); }
  saveRename(d: Department) {
    const name = this.renameDraft().trim();
    if (!name) { this.renameErr.set('A department needs a name.'); return; }
    if (name === d.name) { this.cancelRename(); return; }
    this.api.patch<Department>(`/api/tenants/departments/${d.id}`, { name }).subscribe({
      next: () => {
        this._departments.update(l => l.map(x => x.id === d.id ? { ...x, name } : x).sort((a, b) => a.name.localeCompare(b.name)));
        this.toasts.success('Renamed');
        this.cancelRename();
      },
      error: e => {
        const err = ApiError.from(e);
        const msg = departmentErrorMessage(err.code, err.message);
        this.renameErr.set(msg);
        this.toasts.error(msg);
        // The grid cell shows the saved name again.
        this._departments.update(l => l.map(x => x.id === d.id ? { ...x } : x));
      },
    });
  }
  async deleteDepartment(d: Department) {
    const ok = await this.dialog.confirm({
      title: `Delete ${d.name}?`,
      message: 'This removes the department. If tests, samples or appointments already use it, it cannot be deleted — switch it off instead.',
      confirmLabel: 'Delete', tone: 'danger',
    });
    if (!ok) return;
    this.api.delete(`/api/tenants/departments/${d.id}`).subscribe({
      next: () => {
        this._departments.update(l => l.filter(x => x.id !== d.id));
        this._links.update(l => l.filter(x => x.departmentId !== d.id));
        this.toasts.success(`${d.name} deleted`);
      },
      error: e => { const err = ApiError.from(e); this.toasts.error(departmentErrorMessage(err.code, err.message)); },
    });
  }
  toggleActive(d: Department) {
    const isActive = !d.isActive;
    this.api.patch<Department>(`/api/tenants/departments/${d.id}`, { isActive }).subscribe({
      next: () => {
        this._departments.update(l => l.map(x => x.id === d.id ? { ...x, isActive } : x));
        this.toasts.success(isActive ? `${d.name} switched on` : `${d.name} switched off`);
      },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  // ── Lab spaces (moved from Branches) ──
  toggleOpen(id: string) {
    const next = new Set(this._openIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this._openIds.set(next);
  }
  isOpen(id: string) { return this._openIds().has(id); }
  spacesFor(branchId: string): LabSpace[] {
    return this._spaces().filter(s => s.branchId === branchId).sort((a, b) => a.order - b.order);
  }
  private linkFor(branchId: string, deptId: string): string | null {
    const l = this._links().find(x => x.branchId === branchId && x.departmentId === deptId);
    if (!l) return null;
    return this.spacesFor(branchId).some(s => s.id === l.spaceId) ? l.spaceId : null;
  }
  branchDeptsNoSpace(branchId: string): Department[] {
    return this._departments().filter(d => !this.linkFor(branchId, d.id));
  }
  branchDeptsInSpace(spaceId: string): Department[] {
    const ids = new Set(this._links().filter(l => l.spaceId === spaceId).map(l => l.departmentId));
    return this._departments().filter(d => ids.has(d.id));
  }
  laneIdsFor(branchId: string): string[] {
    return ['unassigned-' + branchId, ...this.spacesFor(branchId).map(s => 'sp-' + s.id)];
  }
  dropDept(event: CdkDragDrop<any[]>, branchId: string, targetSpaceId: string | null): void {
    if (event.previousContainer === event.container) return;
    const dept = event.previousContainer.data[event.previousIndex] as Department;
    if (dept) this.setDeptSpace(dept, branchId, targetSpaceId);
  }
  addSpace(branchId: string) {
    const order = this.spacesFor(branchId).length;
    if (this.addingSpaceFor() === branchId) return;
    this.addingSpaceFor.set(branchId);
    this.api.post<LabSpace>('/api/tenants/lab-spaces', { branchId, name: `Space ${order + 1}`, order }).subscribe({
      next: sp => { this.addingSpaceFor.set(null); this._spaces.update(l => [...l, sp]); },
      error: e => { this.addingSpaceFor.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }
  private renameSpaceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  renameSpace(sp: LabSpace, name: string) {
    this._spaces.update(l => l.map(s => s.id === sp.id ? { ...s, name } : s));
    clearTimeout(this.renameSpaceTimers[sp.id]);
    this.renameSpaceTimers[sp.id] = setTimeout(() => {
      this.api.patch(`/api/tenants/lab-spaces/${sp.id}`, { name }).subscribe({ error: () => { } });
    }, 500);
  }
  setDefaultLabCode(b: Branch, raw: string) {
    const code = (raw || '').trim().toUpperCase();
    this._branches.update(list => list.map(x => x.id === b.id ? { ...x, defaultLabCode: code || null } : x));
    this.api.patch(`/api/tenants/branches/${b.id}`, { defaultLabCode: code }).subscribe({
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  setSpaceCode(sp: LabSpace, raw: string) {
    const code = (raw || '').trim().toUpperCase();
    this._spaces.update(l => l.map(s => s.id === sp.id ? { ...s, code } : s));
    this.api.patch(`/api/tenants/lab-spaces/${sp.id}`, { code }).subscribe({ error: () => { } });
  }
  deleteSpace(sp: LabSpace) {
    this._spaces.update(l => l.filter(s => s.id !== sp.id));
    this._links.update(l => l.filter(x => x.spaceId !== sp.id));
    this.api.delete(`/api/tenants/lab-spaces/${sp.id}`).subscribe({
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  setDeptSpace(dept: Department, branchId: string, spaceId: string | null) {
    const prev = this.linkFor(branchId, dept.id);
    const next = spaceId || null;
    if (prev === next) return;
    const apply = (sid: string | null) => this._links.update(links => {
      const rest = links.filter(x => !(x.branchId === branchId && x.departmentId === dept.id));
      return sid ? [...rest, { branchId, departmentId: dept.id, spaceId: sid }] : rest;
    });
    apply(next);
    this.api.patch(`/api/tenants/departments/${dept.id}/space`, { spaceId: next, branchId }).subscribe({
      error: e => { apply(prev); this.toasts.error(ApiError.from(e).message); },
    });
  }
  structureOf(b: Branch): 'integrated' | 'standalone' | 'auto' {
    const v = b.labStructure;
    return v === 'standalone' || v === 'individual' ? 'standalone' : v === 'integrated' ? 'integrated' : 'auto';
  }
}
