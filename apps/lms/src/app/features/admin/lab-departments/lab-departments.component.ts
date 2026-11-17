import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
import { bindTabQuery, injectSettingsHosted } from '../../../shared/utils/settings-host';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';

/** A physical lab space within a branch; departments are placed into one. */
interface LabSpace { id: string; branchId: string; name: string; code?: string | null; order: number; }
/** Per-branch placement of a tenant-global department into one of that
 *  branch's spaces. No row = the department sits in the branch's default Lab. */
interface DeptSpaceLink { branchId: string; departmentId: string; spaceId: string; }

export type LabDepartmentsTab = 'departments' | 'spaces';
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
  imports: [SkeletonRowsComponent, BusyDirective, RouterLink, FormsModule, CdkDropList, CdkDrag, CdkDragHandle,
    ScreenHeaderComponent, HeroBandComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [placeholder]="tab() === 'departments' ? 'Search departments…' : 'Search branches and departments…'"
                      [value]="q()" (valueChange)="q.set($event)">
          @if (!hosted) {
            <ng-container band-tools>
              <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()" (valueChange)="pickTab($event)"></pf-segmented>
            </ng-container>
          }
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

      <div class="pf-band-body">
        @if (!theme.isNewDesign() && !hosted) {
          <pf-segmented class="ld-classic-tabs" size="sm" [options]="tabOptions" [value]="tab()" (valueChange)="pickTab($event)"></pf-segmented>
        }

        @if (listSkeleton()) {
          <pf-skeleton-rows [rows]="4" [avatar]="false" label="Loading departments…"></pf-skeleton-rows>
        } @else if (tab() === 'departments') {
          @if (addOpen()) {
            <section class="pf-card pf-anim-in ld-add" aria-label="New department" data-testid="ld-add-form">
              <div class="pf-card__head">
                <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
                <h3 class="pf-card__label">New department</h3>
              </div>
              <div class="ld-add__body">
                <label class="pf-field"><span class="pf-field__lbl">Name</span>
                  <input type="text" class="pf-input" [class.pf-input-error]="!!addErr().name" maxlength="80" data-testid="ld-add-name"
                         [ngModel]="draftName()" (ngModelChange)="draftName.set($event); addErr.set({})" placeholder="e.g. Cytogenetics" />
                  @if (addErr().name) { <span class="pf-field-error" data-testid="ld-add-name-err">{{ addErr().name }}</span> }
                </label>
                <label class="pf-field"><span class="pf-field__lbl">Code</span>
                  <input type="text" class="pf-input pf-num uppercase" [class.pf-input-error]="!!addErr().code" maxlength="12" data-testid="ld-add-code"
                         [ngModel]="draftCode()" (ngModelChange)="draftCode.set($event.toUpperCase()); addErr.set({})" placeholder="e.g. CYTO" />
                  @if (addErr().code) { <span class="pf-field-error" data-testid="ld-add-code-err">{{ addErr().code }}</span> }
                </label>
              </div>
              <div class="pf-card__foot">
                <button type="button" class="pf-btn pf-btn--tertiary press" (click)="toggleAdd()">Cancel</button>
                <button type="button" class="pf-btn pf-btn--primary press" data-testid="ld-add-save"
                        [disabled]="saving()" [pfBusy]="saving()" pfBusyLabel="Adding…" (click)="createDepartment()">Add department</button>
              </div>
            </section>
          }

          @if (departments().length === 0) {
            <p class="pf-band-empty">No departments yet.</p>
          } @else if (visibleDepartments().length === 0) {
            <p class="pf-band-empty">No departments match "{{ q() }}".</p>
          } @else {
            <p class="ld-hint">
              Departments marked <strong>{{ originLabel.catalogue }}</strong> arrive with the catalogue — switch them on or off.
              Departments marked <strong>{{ originLabel.lab }}</strong> are your own: rename, switch off, or delete them if nothing uses them.
            </p>
            <div class="space-y-2" data-testid="ld-list">
              @for (d of visibleDepartments(); track d.id) {
                <div class="pf-card ld-row" [class.ld-row--off]="!d.isActive" [attr.data-testid]="'ld-row-' + d.code">
                  <div class="ld-row__main">
                    @if (renamingId() === d.id) {
                      <input type="text" class="pf-input ld-row__rename" maxlength="80" data-testid="ld-rename-input"
                             [class.pf-input-error]="!!renameErr()" [ngModel]="renameDraft()" (ngModelChange)="renameDraft.set($event); renameErr.set('')"
                             (keydown.enter)="saveRename(d)" (keydown.escape)="cancelRename()" aria-label="Department name" />
                      @if (renameErr()) { <span class="pf-field-error" data-testid="ld-rename-err">{{ renameErr() }}</span> }
                    } @else {
                      <p class="ld-row__name">{{ d.name }}</p>
                    }
                    <p class="ld-row__meta">
                      <span class="pf-num">{{ d.code }}</span>
                      <span class="pf-chip pf-chip--static ld-chip" [class.ld-chip--own]="isLabMade(d)" data-testid="ld-origin">{{ isLabMade(d) ? originLabel.lab : originLabel.catalogue }}</span>
                    </p>
                  </div>
                  <div class="ld-row__acts">
                    @if (isLabMade(d)) {
                      @if (renamingId() === d.id) {
                        <button type="button" class="pf-btn pf-btn--tertiary press" (click)="cancelRename()">Cancel</button>
                        <button type="button" class="pf-btn pf-btn--primary press" data-testid="ld-rename-save" (click)="saveRename(d)">Save</button>
                      } @else {
                        <button type="button" class="ld-act press" data-testid="ld-rename" (click)="beginRename(d)" [attr.aria-label]="'Rename ' + d.name" title="Rename">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16v4Zm11-13 4 4"/></svg>
                        </button>
                        <button type="button" class="ld-act ld-act--danger press" data-testid="ld-delete" (click)="deleteDepartment(d)" [attr.aria-label]="'Delete ' + d.name" title="Delete">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                        </button>
                      }
                    }
                    <button type="button" class="ld-switch press" role="switch" data-testid="ld-switch"
                            [class.ld-switch--on]="d.isActive" [attr.aria-checked]="d.isActive"
                            [attr.aria-label]="(d.isActive ? 'Switch off ' : 'Switch on ') + d.name" (click)="toggleActive(d)">
                      <span class="ld-switch__knob"></span>
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        } @else {
          <!-- LAB SPACES — per branch: space names/codes (sample-ID prefixes) and
               where each department works. Tubes are counted per (space, colour). -->
          @if (branches().length === 0) {
            <p class="pf-band-empty">No branches yet.</p>
          } @else if (visibleBranches().length === 0) {
            <p class="pf-band-empty">No branches match "{{ q() }}".</p>
          } @else {
            <div class="space-y-2.5">
              @for (b of visibleBranches(); track b.id) {
                <div class="pf-card">
                  <button type="button" class="ld-br-toggle" [attr.aria-expanded]="isOpen(b.id)" (click)="toggleOpen(b.id)">
                    <span class="ld-br-badge">{{ (b.code || '??').slice(0, 2) }}</span>
                    <span class="ld-br-titles">
                      <span class="ld-row__name">{{ b.name }}</span>
                      <span class="ld-row__meta"><span class="pf-num">{{ b.code }}</span> · {{ spacesFor(b.id).length }} {{ spacesFor(b.id).length === 1 ? 'lab space' : 'lab spaces' }}</span>
                    </span>
                    <span class="ld-chev" [class.ld-chev--open]="isOpen(b.id)" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </span>
                  </button>
                  @if (isOpen(b.id)) {
                    <div class="ld-br-body">
                      <p class="ld-hint">Drag a department into a space. Tubes are counted per space and colour — departments in one space sharing a colour share a vial.</p>
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
                    </div>
                  }
                </div>
              }
            </div>
          }
        }
      </div>
    </section>
  `,
  styles: [`
    .ld-hint { margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: var(--text-tertiary); }
    .ld-link { color: var(--violet-text, #7c3aed); font-weight: 600; text-decoration: none; }
    .ld-link:hover { text-decoration: underline; }
    .ld-classic-tabs { display: block; margin-bottom: 14px; }
    .ld-add { margin-bottom: 16px; }
    .ld-add__body { padding: 16px 18px; display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
    .pf-card.ld-row { display: flex; flex-direction: row; text-align: left; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; overflow: visible; }
    .ld-row--off .ld-row__main { opacity: .55; }
    .ld-row__main { min-width: 0; flex: 1; }
    .ld-row__name { margin: 0; font-size: 14.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .ld-row__meta { margin: 3px 0 0; font-size: 12px; color: var(--text-tertiary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ld-row__rename { max-width: 360px; }
    .ld-row__acts { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .ld-chip { height: 22px; font-size: 11px; }
    .ld-chip--own { background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); color: var(--violet-text, #7c3aed); }
    .ld-act { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 9px;
      border: 1px solid var(--pf-line); background: transparent; color: var(--text-secondary); cursor: pointer; }
    .ld-act:hover { color: var(--text-primary); background: var(--bg-hover); }
    .ld-act--danger:hover { color: var(--red-text, #dc2626); }
    .ld-switch { position: relative; width: 42px; height: 24px; border-radius: 999px; padding: 0; cursor: pointer;
      border: 1px solid var(--pf-toggle-off, #e3e7eb); background: var(--pf-toggle-off, #e3e7eb); transition: background .2s, border-color .2s; flex-shrink: 0; }
    .ld-switch--on { background: var(--pf-switch-on, #7c3aed); border-color: var(--pf-switch-on, #7c3aed); }
    .ld-switch__knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
    .ld-switch--on .ld-switch__knob { transform: translateX(18px); }
    @media (prefers-reduced-motion: reduce) { .ld-switch, .ld-switch__knob { transition: none; } }
    .ld-br-toggle { width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: transparent; border: 0; cursor: pointer; text-align: left; }
    .ld-br-badge { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); color: var(--violet-text, #7c3aed); font-size: 13px; font-weight: 600; }
    .ld-br-titles { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .ld-chev { display: inline-flex; color: var(--text-muted); transition: transform .2s; }
    .ld-chev--open { transform: rotate(180deg); }
    .ld-br-body { padding: 16px 18px 18px; border-top: 1px solid var(--pf-line); }
    .pf-field-error { font-size: 11px; color: var(--red-text); }
    .pf-input-error { border-color: #ef4444 !important; }
    @media (max-width: 640px) {
      .ld-add__body { grid-template-columns: 1fr; }
      .pf-card.ld-row { flex-wrap: wrap; padding: 12px 14px; }
      .ld-row__acts { width: 100%; justify-content: flex-end; }
      :host .pf-input { font-size: 16px; }
      .ld-br-toggle, .ld-br-body { padding-left: 14px; padding-right: 14px; }
    }
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
    void this.router.navigate([], { queryParams: { tab: t }, queryParamsHandling: 'merge', replaceUrl: true });
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
    const all = this._departments();
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
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => { this._departments.set(l ?? []); this.listHold.done(); },
      error: () => this.listHold.done(),
    });
    this.api.get<Branch[]>('/api/tenants/branches?includeInactive=true').subscribe({ next: l => this._branches.set((l ?? []).filter(b => b.isActive !== false)) });
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
  beginRename(d: Department) { this.renamingId.set(d.id); this.renameDraft.set(d.name); this.renameErr.set(''); }
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
      error: e => { const err = ApiError.from(e); this.renameErr.set(departmentErrorMessage(err.code, err.message)); },
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
