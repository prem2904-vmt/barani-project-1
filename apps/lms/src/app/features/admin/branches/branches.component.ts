import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, CdkDropList, CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { DEPARTMENTS_FROM_MASTER } from '../../../shared/utils/test-origin';
import { Branch, Department, SubBranch } from '../../../shared/models/tenant.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandMatch } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';

/** A physical lab space within a branch; departments are assigned to one. */
interface LabSpace { id: string; branchId: string; name: string; code?: string | null; order: number; }
/** Per-branch placement of a tenant-global department into one of that
 *  branch's spaces. No row = the department sits in the branch's default Lab. */
interface DeptSpaceLink { branchId: string; departmentId: string; spaceId: string; }


@Component({
  selector: 'pf-branches',
  standalone: true,
  imports: [
    FormsModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    SelectComponent,
    ScreenHeaderComponent,
    TouchButtonComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): search branches, sub-branches and departments;
             "Add branch" rides the band's actions. -->
        <pf-hero-band [back]="true" placeholder="Search branches, sub-branches, departments…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="!newBranchOpen()"
                    [class.pf-hb-btn--ghost]="newBranchOpen()" (click)="toggleNewBranch()"
                    [attr.aria-label]="newBranchOpen() ? 'Cancel new branch' : 'Add branch'">
              @if (newBranchOpen()) {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              } @else {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              }
              {{ newBranchOpen() ? 'Cancel' : 'Add branch' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Branches & Departments"
        subtitle="Manage collection sites, sub-branches, and their lab departments.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleNewBranch()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"/>
              <path d="M5 12h14"/>
            </svg>
          </span>
          {{ newBranchOpen() ? 'Cancel' : 'Add branch' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      @if (newBranchOpen()) {
        <section class="nd-card nd-anim-in pf-br-new" aria-label="New branch">
          <div class="nd-card__head">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>
            <h3 class="nd-card__label">New branch</h3>
          </div>
          <div class="grid grid-cols-2 gap-3 pf-branch-grid pf-br-new__body">
            <label class="nd-field"><span class="nd-field__lbl">Name</span>
              <input type="text" class="nd-input" [ngModel]="newBranch().name" (ngModelChange)="patchNewBranch({ name: $event })" /></label>
            <label class="nd-field"><span class="nd-field__lbl">Code</span>
              <input type="text" class="nd-input nd-num uppercase" [ngModel]="newBranch().code" (ngModelChange)="patchNewBranch({ code: $event.toUpperCase() })" /></label>
            <label class="nd-field"><span class="nd-field__lbl">City</span>
              <input type="text" class="nd-input" [ngModel]="newBranch().city" (ngModelChange)="patchNewBranch({ city: $event })" /></label>
            <label class="nd-field"><span class="nd-field__lbl">State</span>
              <input type="text" class="nd-input" [ngModel]="newBranch().state" (ngModelChange)="patchNewBranch({ state: $event })" /></label>
          </div>
          <div class="nd-card__foot">
            <button type="button" class="nd-btn nd-btn--tertiary press" (click)="toggleNewBranch()">Cancel</button>
            <button type="button" class="nd-btn nd-btn--primary press" (click)="createBranch()">Create branch</button>
          </div>
        </section>
      }

      @if (branches().length === 0) {
        <p class="pf-band-empty">No branches yet.</p>
      } @else if (visibleBranches().length === 0) {
        <p class="pf-band-empty">No branches match "{{ q() }}".</p>
      } @else {
        <div class="space-y-2.5">
          @for (b of visibleBranches(); track b.id) {
            <div class="nd-card pf-br-card">
              <button type="button"
                      class="pf-branch-toggle"
                      [attr.aria-expanded]="isOpen(b.id)"
                      (click)="toggle(b.id)">
                <div class="flex items-center gap-3 text-left pf-branch-titlewrap">
                  <span class="pf-branch-badge">{{ codeInitials(b.code) }}</span>
                  <div class="pf-branch-titlecol">
                    <p class="pf-br-name">{{ b.name }}</p>
                    <p class="pf-br-meta">{{ b.city ?? '—' }} · <span class="nd-num">{{ b.code }}</span></p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  @if (b.hasPfBox) {
                    <span class="nd-chip nd-chip--static pf-br-chip">PF Box</span>
                  }
                  <span class="pf-br-count"><span class="nd-num">{{ subBranchesFor(b.id).length }}</span> sub · <span class="nd-num">{{ allDeptsFor(b.id).length }}</span> depts</span>
                  <span class="pf-chevron" [class.pf-chevron-open]="isOpen(b.id)" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </span>
                </div>
              </button>

              @if (isOpen(b.id)) {
                <div class="pf-branch-body">
                  <!-- SUB-BRANCHES -->
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="pf-br-sec">Sub-branches</h4>
                    <pf-touch-btn size="sm" variant="ghost" (pressed)="beginAddSubBranch(b.id)">
                      <span icon-left aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 5v14"/>
                          <path d="M5 12h14"/>
                        </svg>
                      </span>
                      Add sub-branch
                    </pf-touch-btn>
                  </div>

                  @if (subBranchesFor(b.id).length === 0) {
                    <p class="text-[13px] mb-3" style="color: var(--text-tertiary);">
                      No sub-branches.
                    </p>
                  } @else {
                    <div class="space-y-2 mb-3">
                      @for (sb of subBranchesFor(b.id); track sb.id) {
                        <div class="pf-sub-card">
                          <div class="flex items-center justify-between pf-sub-row">
                            <div class="flex items-center gap-2 pf-sub-titlewrap">
                              <span class="pf-sub-badge">{{ codeInitials(sb.code) }}</span>
                              <div class="pf-sub-titlecol">
                                <p class="pf-br-subname">{{ sb.name }}</p>
                                <p class="pf-br-meta"><span class="nd-num">{{ sb.code }}</span> · {{ sb.type }}</p>
                              </div>
                            </div>
                            <div class="flex items-center gap-2">
                              @if (sb.isActive) {
                                <span class="nd-chip nd-chip--static pf-br-chip"><span class="pf-dot-on" aria-hidden="true"></span>Active</span>
                                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="deactivateSubBranch(sb)"
                                        aria-label="Deactivate sub-branch" title="Deactivate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg><span class="nd-rowact__t">Deactivate</span></button>
                              } @else {
                                <span class="nd-chip nd-chip--static pf-br-chip">Inactive</span>
                              }
                            </div>
                          </div>
                          <div class="pf-sub-deps">
                            <span class="pf-br-sec">Departments</span>
                            @if (deptsForSubBranch(sb.id).length === 0) {
                              <span class="text-[12px]" style="color: var(--text-tertiary);">None assigned</span>
                            } @else {
                              @for (d of deptsForSubBranch(sb.id); track d.id) {
                                <div class="pf-dept-pill" [class.pf-dept-pill--inactive]="!d.isActive">
                                  <span>{{ d.name }}</span>
                                  @if (!d.isActive) {
                                    <span class="nd-chip nd-chip--static pf-br-chip">Inactive</span>
                                  }
                                  <button type="button" class="pf-unassign pf-dept-power"
                                          (click)="toggleDeptActive(d)"
                                          [attr.aria-label]="d.isActive ? 'Deactivate department' : 'Reactivate department'"
                                          [title]="d.isActive ? 'Deactivate department' : 'Reactivate department'">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                      <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
                                      <line x1="12" y1="2" x2="12" y2="12"/>
                                    </svg>
                                  </button>
                                  <button type="button" class="pf-unassign"
                                          (click)="unassignDepartment(sb.id, d.id)"
                                          aria-label="Unassign from sub-branch" title="Unassign from sub-branch">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              }
                            }
                            @if (unassignedDeptsFor(b.id).length > 0) {
                              <pf-select
                                class="pf-br-assign"
                                size="sm"
                                [options]="deptsAsOpts(unassignedDeptsFor(b.id))"
                                [value]="''"
                                placeholder="+ Assign dept"
                                (valueChange)="assignDepartment(sb.id, $event)">
                              </pf-select>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }

                  @if (addingSubBranchFor() === b.id) {
                    <div class="pf-sub-form">
                      <div class="grid grid-cols-2 gap-2 pf-branch-grid">
                        <input type="text" class="nd-input" placeholder="Sub-branch name" aria-label="Sub-branch name"
                               [ngModel]="subBranchDraft().name" (ngModelChange)="patchSubBranchDraft({ name: $event })" />
                        <input type="text" class="nd-input nd-num uppercase" placeholder="CODE" aria-label="Sub-branch code"
                               [ngModel]="subBranchDraft().code" (ngModelChange)="patchSubBranchDraft({ code: $event.toUpperCase() })" />
                        <pf-select
                          [options]="subBranchTypeOpts"
                          [value]="subBranchDraft().type"
                          (valueChange)="patchSubBranchDraft({ type: $any($event) })">
                        </pf-select>
                        <input type="text" class="nd-input" placeholder="City" aria-label="City"
                               [ngModel]="subBranchDraft().city" (ngModelChange)="patchSubBranchDraft({ city: $event })" />
                      </div>
                      <div class="flex gap-2 justify-end mt-3">
                        <button type="button" class="nd-btn nd-btn--tertiary press" (click)="cancelAddSubBranch()">Cancel</button>
                        <!-- Secondary: "Add branch" in the band is this view's one primary. -->
                        <button type="button" class="nd-btn nd-btn--secondary press" (click)="createSubBranch(b.id)">Save sub-branch</button>
                      </div>
                    </div>
                  }

                  <!-- LAB SPACES BOARD — workflow-style: drag departments between
                       spaces. Tubes are counted per (space, colour): departments
                       in one space whose tests share a colour share one vial. -->
                  <div class="pf-branch-deps-header">
                    <h4 class="pf-br-sec">Departments & lab spaces</h4>
                  </div>
                  <!-- Departments are master-provided (TM owner rule 4): a lab
                       places, enables or disables them — it never creates one. -->
                  <p class="pf-dept-source pf-br-hint">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                    {{ DEPARTMENTS_FROM_MASTER }}
                  </p>
                  <p class="pf-br-hint">
                    Drag a department into a space. Tubes are counted per space + colour — departments in one space sharing a colour share a vial.
                  </p>
                  <!-- Structure notice: the board's arrangement only DRIVES orders
                       in Auto mode. Integrated = the one Lab space; Standalone =
                       one space per department. The arrangement is kept either way
                       so switching to Auto restores it. -->
                  @if (structureOf(b) === 'integrated') {
                    <p class="text-[11px] mb-2" style="color: var(--text-secondary);">
                      This branch runs <strong>Integrated</strong> — one lab, one space: every department shares "Lab (default)".
                      Space arrangement below is saved but only applies after switching the branch to <strong>Auto</strong> in Lab settings.
                    </p>
                  } @else if (structureOf(b) === 'standalone') {
                    <p class="text-[11px] mb-2" style="color: var(--text-secondary);">
                      This branch runs <strong>Standalone</strong> — every department is its own space with its own sample-ID prefix.
                      Space arrangement below only applies after switching the branch to <strong>Auto</strong> in Lab settings.
                    </p>
                  }

                  <div class="pf-board">
                    <!-- Departments come from the Test Master — this board only
                         links the real departments into spaces (no hard-coded
                         create-catalog). -->

                    <!-- Default "Lab" lane — departments not moved into a specific
                         space live here (they share the "LAB" sample prefix and a
                         single Lab space). -->
                    <div class="pf-lane">
                      <div class="pf-lane-hdr">
                        <span class="pf-lane-name">Lab (default)</span>
                        <input class="pf-lane-code-input uppercase"
                               [value]="b.defaultLabCode || ''" (change)="setDefaultLabCode(b, $any($event.target).value)"
                               maxlength="16" placeholder="no prefix" aria-label="Default Lab code — prefixes sample IDs"
                               title="Sample-ID prefix for the default Lab space (e.g. LAB → LAB-2607-00001). Leave blank for no prefix — the ID is just the date + number." />
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
                            <button type="button" class="pf-dcard-toggle" (click)="toggleDeptActive(d)" [attr.aria-label]="(d.isActive ? 'Deactivate ' : 'Reactivate ') + d.name">{{ d.isActive ? 'Deactivate' : 'Reactivate' }}</button>
                          </div>
                        } @empty { <p class="pf-lane-empty">No departments in the default Lab space</p> }
                      </div>
                    </div>

                    <!-- One lane per space -->
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
                              <button type="button" class="pf-dcard-toggle" (click)="toggleDeptActive(d)" [attr.aria-label]="(d.isActive ? 'Deactivate ' : 'Reactivate ') + d.name">{{ d.isActive ? 'Deactivate' : 'Reactivate' }}</button>
                            </div>
                          } @empty { <p class="pf-lane-empty">Drag departments here</p> }
                        </div>
                      </div>
                    }

                    <!-- Add-space tile — mirrors the process builder's "+ Add work-area". -->
                    <button type="button" class="pf-add-space-lane press" (click)="addSpace(b.id)">
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
      </div>
    </section>
  `,
  styles: [`
    /* ── ND audit: kit pieces ── */
    .pf-br-new { margin-bottom: 16px; }
    .pf-br-new__body { padding: 16px 18px; }
    .pf-br-card { overflow: visible; }
    .pf-br-name { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-br-subname { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-br-meta { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-br-count { font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-br-chip { height: 24px; font-size: 11.5px; }
    .pf-br-sec { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); }
    .pf-br-hint { margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: var(--text-tertiary); display: flex; align-items: center; gap: 6px; }
    .pf-br-note { margin: 0 0 10px; padding: 8px 12px; border-radius: var(--nd-radius-sm); font-size: 12px; line-height: 1.5;
      color: var(--text-secondary); background: var(--nd-chip-bg); border: 1px solid var(--nd-line); }
    .pf-br-assign { width: 170px; }
    .pf-unassign svg { display: block; }

    .pf-branch-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    @media (hover: hover) {
      .pf-branch-toggle:hover { background: var(--bg-hover); }
    }

    .pf-branch-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      /* The kit icon chip (violet tint) — the gradient is the primary CTA only. */
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);
      color: var(--violet-text, #7c3aed);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .pf-sub-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: var(--nd-chip-bg);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 600;
      border: 1px solid var(--nd-line);
    }

    .pf-chevron { display: inline-flex; color: var(--text-muted); transition: transform 0.2s ease; }
    .pf-chevron-open { transform: rotate(180deg); }

    .pf-branch-body {
      padding: 16px 18px 18px;
      border-top: 1px solid var(--nd-line);
    }

    .pf-sub-card {
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--bg-card-solid);
      border: 1px solid var(--border-muted);

    }
    .pf-sub-deps {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--border-muted);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pf-dept-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 4px 4px 10px;
      border-radius: 9999px;
      background: var(--nd-chip-bg);
      border: 1px solid var(--nd-line);
      font-size: 12px;
      color: var(--text-primary);
    }
    .pf-unassign {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
    }
    @media (hover: hover) {
      .pf-unassign:hover { background: var(--bg-hover); color: var(--text-primary); }
    }

    .pf-container-ctl { display: inline-flex; align-items: center; gap: 6px; }
    .pf-container-color {
      width: 30px; height: 30px; padding: 0; border: 1px solid var(--glass-border);
      border-radius: 8px; background: transparent; cursor: pointer;
    }
    .pf-container-color::-webkit-color-swatch { border: none; border-radius: 6px; }
    .pf-container-color::-moz-color-swatch { border: none; border-radius: 6px; }
    .pf-container-label { width: 140px; padding: 6px 8px; }
    /* ── Inline field error (routed from the shared ApiError contract) ── */
    .pf-input-error {
      border-color: #ef4444 !important;
      box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.35);
    }
    .pf-field-error {
      flex-basis: 100%;
      margin-top: 3px;
      font-size: 11px;
      color: var(--red-text);
    }

    .pf-mini-select {
      appearance: none;
      padding: 4px 10px;
      border-radius: 8px;
      border: 1px solid var(--border-muted);
      background: var(--bg-card-solid);
      color: var(--text-primary);
      font-size: 12px;
      cursor: pointer;
    }

    .pf-sub-form {
      padding: 12px;
      border-radius: 10px;
      background: var(--bg-card-solid);
      border: 1px dashed var(--border-muted);
      margin-bottom: 12px;
    }

    .pf-branch-deps-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 14px 0 10px;
      padding-top: 12px;
      border-top: 1px solid var(--border-muted);
    }

    .pf-dept-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 10px;
      background: var(--bg-card-solid);
      border: 1px solid var(--border-muted);
    }

    /* ── Lab spaces board (drag-drop, workflow-style) ── */
    .pf-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .pf-lane--catalog { background: rgba(124,58,237,0.05); border-color: rgba(124,58,237,0.25); }
    .pf-catalog-search { display: flex; align-items: center; gap: 6px; margin: 8px 8px 4px; padding: 6px 9px; border-radius: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); color: var(--text-muted); }
    .pf-catalog-search__input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--text-primary); font-size: 12.5px; }
    .pf-catalog-chip {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; cursor: grab;
      background: var(--bg-card-solid, #14141f); border: 1px solid rgba(124,58,237,0.28);
    }
    .pf-catalog-chip:active { cursor: grabbing; }
    .pf-catalog-chip__name { font-size: 12.5px; font-weight: 600; color: var(--text-primary); flex: 1; min-width: 0; word-break: break-word; }
    /* Catalog list scrolls when long. */
    .pf-lane--catalog .pf-lane-body { max-height: 300px; overflow-y: auto; }
    .pf-lane--catalog .pf-lane-body::-webkit-scrollbar { width: 8px; }
    .pf-lane--catalog .pf-lane-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; }
    /* Add-department autocomplete dropdown. */
    .pf-add-sugg { display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; border-radius: 8px; border: 1px solid var(--glass-border, rgba(255,255,255,0.12)); background: var(--bg-card-solid, #14141f); padding: 3px; }
    .pf-add-sugg__item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; color: var(--text-primary); font-size: 12.5px; cursor: pointer; text-align: left; }
    .pf-add-sugg__item:hover { background: rgba(124,58,237,0.14); }
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
    .pf-lane-code-input--missing { border-color: var(--nd-sel-border); }
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

    .pf-dot-on {
      width: 8px; height: 8px; border-radius: 9999px;
      width: 6px; height: 6px; background: var(--color-violet-600, #7c3aed);
    }
    .pf-dot-off {
      width: 8px; height: 8px; border-radius: 9999px;
      background: var(--text-muted); opacity: 0.4;
    }

    /* ── Inactive departments: greyed but still operable (the toggle must
       stay clickable so an admin can reactivate). ── */
    .pf-dept-row--inactive > div:first-child,
    .pf-dept-pill--inactive > span:first-child { opacity: 0.5; }
    .pf-dept-row--inactive,
    .pf-dept-pill--inactive { border-style: dashed; }

    /* ── Touch sizing: larger tap target for the inline unassign control ── */
    @media (pointer: coarse) {
      .pf-unassign {
        position: relative;
        width: 28px;
        height: 28px;
        font-size: 16px;
      }
      /* Extend the tappable region to >=44px without changing visual size */
      .pf-unassign::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 44px;
        height: 44px;
        transform: translate(-50%, -50%);
      }
    }

    /* ── Below desktop (<1280): keep long branch/sub-branch names from
       overflowing the header row; truncate with ellipsis. Desktop >=1280
       stays byte-identical. ── */
    @media (max-width: 1279px) {
      .pf-branch-titlewrap { min-width: 0; flex: 1 1 auto; }
      .pf-branch-titlecol { min-width: 0; }
      .pf-sub-titlewrap { min-width: 0; flex: 1 1 auto; }
      .pf-sub-titlecol { min-width: 0; }
      .pf-trunc {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }
      /* Keep badges/chevron from being squished by the flexible title column */
      .pf-branch-badge,
      .pf-sub-badge,
      .pf-chevron { flex-shrink: 0; }

      /* Keep the right-hand meta cluster (PF Box chip + count + chevron) on a
         single line beside the truncating title instead of wrapping/crowding */
      .pf-branch-toggle > div:last-child { flex-shrink: 0; white-space: nowrap; }
      .pf-sub-row > div:last-child { flex-shrink: 0; }
    }

    /* ── Phone (<=640): single-column forms, no horizontal overflow ── */
    @media (max-width: 640px) {
      /* New-branch + sub-branch forms: stack fields */
      .pf-branch-grid { grid-template-columns: 1fr !important; }

      /* Lift every text box on this page to >=16px so iOS doesn't auto-zoom the
         page when a field is focused (the main "not optimised for mobile" issue).
         Scoped to :host so the shared .pf-input primitive is untouched globally. */
      :host .pf-input,
      :host input[type="text"] {
        font-size: 16px;
      }

      /* Department add-row: give each field its own full-width line (the fixed
         w-32 CODE box crammed beside the name was the cramped bit), then the
         Save / Cancel buttons sit on the row below. */
      .pf-dept-add { gap: 8px; }
      .pf-dept-add__name,
      .pf-dept-add__code {
        flex: 1 1 100%;
        width: 100% !important;
      }

      /* Branch header row: let the right cluster wrap instead of overflowing */
      .pf-branch-toggle {
        padding: 12px 14px;
        align-items: flex-start;
        gap: 10px;
      }
      .pf-branch-toggle > div:last-child {
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }

      .pf-branch-body { padding: 14px 14px 16px; }

      /* Sub-branch dept assignment + branch dept assignment selects:
         stop fixed pixel widths from forcing overflow */
      .pf-sub-deps pf-select,
      .pf-dept-row pf-select { width: 100% !important; }

      /* Sub-branch card inner header: allow controls to wrap */
      .pf-sub-card .pf-sub-row { flex-wrap: wrap; gap: 8px; }

      /* Department rows: stack name above the assign/status controls */
      .pf-dept-row {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .pf-dept-row > div:last-child {
        flex-wrap: wrap;
        justify-content: flex-end;
      }
    }
  `]
})
export class BranchesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (ND-PATTERN). */
  protected readonly web = webPointerSignal();

  /** Band pill search. A branch shows when it — or one of its sub-branches,
   *  or a department on its board — matches. Departments are tenant-global,
   *  so a department hit keeps every branch (each board shows it). */
  readonly q = signal('');
  readonly visibleBranches = computed(() => {
    const q = this.q();
    const all = this._branches();
    if (!q.trim()) return all;
    const deptHit = this._departments().some(d => bandMatch(q, d.name, d.code));
    if (deptHit) return all;
    return all.filter(b =>
      bandMatch(q, b.name, b.code, b.city, b.state)
      || this._subBranches().some(sb => sb.branchId === b.id && bandMatch(q, sb.name, sb.code, sb.city, sb.type)));
  });

  private readonly _branches = signal<Branch[]>([]);
  private readonly _subBranches = signal<SubBranch[]>([]);
  private readonly _departments = signal<Department[]>([]);
  private readonly _spaces = signal<LabSpace[]>([]);
  /** Per-branch department→space placements. Departments are tenant-global —
   *  each branch arranges the SAME departments into its own spaces, so the
   *  placement is a (branchId, departmentId) → spaceId link, never a field on
   *  the department itself. No link = the branch's default "Lab" space. */
  private readonly _links = signal<DeptSpaceLink[]>([]);
  private readonly _openIds = signal<Set<string>>(new Set());

  readonly branches = this._branches.asReadonly();
  readonly subBranches = this._subBranches.asReadonly();
  readonly departments = this._departments.asReadonly();

  readonly subBranchTypeOpts: PfSelectOption[] = [
    { value: 'lab', label: 'Lab (in-house)' },
    { value: 'collection-center', label: 'Collection center' },
    { value: 'satellite', label: 'Satellite' }
  ];

  deptsAsOpts(depts: Department[]): PfSelectOption[] {
    return depts.map(d => ({ value: d.id, label: d.name }));
  }

  subBranchesAsOpts(sbs: SubBranch[]): PfSelectOption[] {
    return sbs.map(s => ({ value: s.id, label: s.name }));
  }

  protected readonly newBranchOpen = signal(false);
  private readonly _newBranch = signal({ name: '', code: '', type: 'lab', city: '', state: '', hasPfBox: false });
  readonly newBranch = this._newBranch.asReadonly();


  protected readonly addingSubBranchFor = signal<string | null>(null);
  private readonly _subBranchDraft = signal({ name: '', code: '', type: 'lab', city: '' });
  readonly subBranchDraft = this._subBranchDraft.asReadonly();

  ngOnInit() {
    // Hierarchical fetch pulls branches with their sub-branches+departments eagerly
    this.api.get<Branch[]>('/api/tenants/branches?includeSubBranches=true').subscribe({
      next: list => {
        const branches = list ?? [];
        this._branches.set(branches);
        const subs: SubBranch[] = [];
        branches.forEach(b => { (b.subBranches ?? []).forEach(sb => subs.push(sb)); });
        this._subBranches.set(subs);
      }
    });
    this.api.get<Department[]>('/api/tenants/departments').subscribe({ next: l => this._departments.set(l ?? []) });
    this.api.get<LabSpace[]>('/api/tenants/lab-spaces').subscribe({ next: l => this._spaces.set(l ?? []) });
    this.api.get<DeptSpaceLink[]>('/api/tenants/department-space-links').subscribe({ next: l => this._links.set(l ?? []) });
  }

  // ── Lab spaces (group departments; drives tube counting) ──────────
  spacesFor(branchId: string): LabSpace[] {
    return this._spaces().filter(s => s.branchId === branchId).sort((a, b) => a.order - b.order);
  }
  /** This branch's placement for a department (spaceId), or null = default Lab. */
  private linkFor(branchId: string, deptId: string): string | null {
    const l = this._links().find(x => x.branchId === branchId && x.departmentId === deptId);
    if (!l) return null;
    // Guard: ignore a link whose space no longer exists in this branch.
    return this.spacesFor(branchId).some(s => s.id === l.spaceId) ? l.spaceId : null;
  }
  /** Departments in this branch's default "Lab" lane = every department this
   *  branch hasn't placed into one of its own spaces. */
  branchDeptsNoSpace(branchId: string): Department[] {
    return this.unassignedDeptsFor(branchId).filter(d => !this.linkFor(branchId, d.id));
  }
  /** Departments this branch has placed into the given space (space ids are
   *  branch-unique, so no extra branch filter is needed). */
  branchDeptsInSpace(spaceId: string): Department[] {
    const ids = new Set(this._links().filter(l => l.spaceId === spaceId).map(l => l.departmentId));
    return this._departments().filter(d => ids.has(d.id));
  }
  /** CDK connected-list ids for a branch's board (Unassigned + each space). */
  laneIdsFor(branchId: string): string[] {
    return ['unassigned-' + branchId, ...this.spacesFor(branchId).map(s => 'sp-' + s.id)];
  }


  /** A department card was moved between lanes → re-place it FOR THIS BRANCH.
   *  targetSpaceId null = back to the branch's default "Lab" space. */
  dropDept(event: CdkDragDrop<any[]>, branchId: string, targetSpaceId: string | null): void {
    if (event.previousContainer === event.container) return;
    const dept = event.previousContainer.data[event.previousIndex] as Department;
    if (dept) this.setDeptSpace(dept, branchId, targetSpaceId);
  }

  addSpace(branchId: string) {
    const order = this.spacesFor(branchId).length;
    this.api.post<LabSpace>('/api/tenants/lab-spaces', { branchId, name: `Space ${order + 1}`, order }).subscribe({
      next: sp => this._spaces.update(l => [...l, sp]),
      error: e => this.toasts.error(ApiError.from(e).message),
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
  /** The default "Lab" code prefixes sample IDs for departments that sit in the
   *  default Lab space (no dedicated space). Stored on the branch. */
  setDefaultLabCode(b: Branch, raw: string) {
    const code = (raw || '').trim().toUpperCase();
    this._branches.update(list => list.map(x => x.id === b.id ? { ...x, defaultLabCode: code || null } : x));
    this.api.patch(`/api/tenants/branches/${b.id}`, { defaultLabCode: code }).subscribe({
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  /** The space code prefixes every sample ID drawn in this space (MIC → MIC-2607-00001). */
  setSpaceCode(sp: LabSpace, raw: string) {
    const code = (raw || '').trim().toUpperCase();
    this._spaces.update(l => l.map(s => s.id === sp.id ? { ...s, code } : s));
    this.api.patch(`/api/tenants/lab-spaces/${sp.id}`, { code }).subscribe({ error: () => { } });
  }
  deleteSpace(sp: LabSpace) {
    this._spaces.update(l => l.filter(s => s.id !== sp.id));
    // Its placements go too — those departments fall back to Lab (default).
    this._links.update(l => l.filter(x => x.spaceId !== sp.id));
    this.api.delete(`/api/tenants/lab-spaces/${sp.id}`).subscribe({
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  /** Place a department into a space FOR ONE BRANCH (null = default Lab).
   *  Only this branch's link row changes — other branches are untouched. */
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

  codeInitials(code: string): string {
    return code ? code.slice(0, 2) : '??';
  }

  /** Resolved lab structure for a branch: auto (default) | integrated |
   *  standalone. Mirrors the backend's resolution (legacy "individual" =
   *  standalone, empty/unknown = auto). */
  structureOf(b: Branch): 'integrated' | 'standalone' | 'auto' {
    const v = b.labStructure;
    return v === 'standalone' || v === 'individual' ? 'standalone' : v === 'integrated' ? 'integrated' : 'auto';
  }

  toggle(id: string) {
    const next = new Set(this._openIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this._openIds.set(next);
  }
  isOpen(id: string) { return this._openIds().has(id); }

  subBranchesFor(branchId: string): SubBranch[] {
    return this._subBranches().filter(sb => sb.branchId === branchId);
  }
  // Departments come from the Test Master and are TENANT-GLOBAL — they are not
  // mapped to any branch. Every branch board shows the same full set; what
  // differs per branch is only the placement into that branch's spaces (the
  // link rows). A department's legacy branchId is ignored here.
  allDeptsFor(_branchId: string): Department[] {
    return this._departments();
  }
  unassignedDeptsFor(_branchId: string): Department[] {
    return this._departments().filter(d => !d.subBranchId);
  }
  deptsForSubBranch(subBranchId: string): Department[] {
    return this._departments().filter(d => d.subBranchId === subBranchId);
  }

  // ── Branch ─────────────────────────────────────
  toggleNewBranch() {
    this.newBranchOpen.update(v => !v);
    this._newBranch.set({ name: '', code: '', type: 'lab', city: '', state: '', hasPfBox: false });
  }
  patchNewBranch(p: Partial<{ name: string; code: string; city: string; state: string; hasPfBox: boolean }>) {
    this._newBranch.update(v => ({ ...v, ...p }));
  }
  createBranch() {
    const b = this._newBranch();
    if (!b.name.trim() || !b.code.trim()) { this.toasts.warning('Name and code required'); return; }
    this.api.post<Branch>('/api/tenants/branches', b).subscribe({
      next: saved => { this._branches.update(list => [...list, saved]); this.toasts.success('Branch added'); this.toggleNewBranch(); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // ── Sub-branch ─────────────────────────────────
  beginAddSubBranch(branchId: string) {
    this.addingSubBranchFor.set(branchId);
    this._subBranchDraft.set({ name: '', code: '', type: 'lab', city: '' });
  }
  patchSubBranchDraft(p: Partial<{ name: string; code: string; type: string; city: string }>) {
    this._subBranchDraft.update(v => ({ ...v, ...p }));
  }
  cancelAddSubBranch() { this.addingSubBranchFor.set(null); }
  createSubBranch(branchId: string) {
    const d = this._subBranchDraft();
    if (!d.name.trim() || !d.code.trim()) { this.toasts.warning('Name and code required'); return; }
    this.api.post<SubBranch>(`/api/tenants/branches/${branchId}/sub-branches`, d).subscribe({
      next: saved => {
        this._subBranches.update(list => [...list, saved]);
        this.toasts.success('Sub-branch added');
        this.cancelAddSubBranch();
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
  deactivateSubBranch(sb: SubBranch) {
    if (!sb.isActive) return;
    this.api.delete(`/api/tenants/sub-branches/${sb.id}`).subscribe({
      next: () => {
        this._subBranches.update(list => list.map(x => x.id === sb.id ? { ...x, isActive: false } : x));
        this.toasts.success('Sub-branch deactivated');
      }
    });
  }

  // ── Department ─────────────────────────────────
  // Departments come ONLY from the Admin Test Master (TM owner rule 4): a
  // lab places them in spaces and enables/disables them; creating one is
  // refused server-side (403 departments_master_only), so there is no
  // "add department" UI anywhere in the LMS.
  protected readonly DEPARTMENTS_FROM_MASTER = DEPARTMENTS_FROM_MASTER;

  /** Persist the department's sample container colour + label (the collector's
   *  tube guide). PATCH /api/tenants/departments/:id. */
  saveContainer(dept: Department, color: string, label: string) {
    const containerColor = /^#[0-9a-fA-F]{6}$/.test((color ?? '').trim()) ? color.trim().toLowerCase() : null;
    const containerLabel = (label ?? '').trim() || null;
    if ((dept.containerColor ?? null) === containerColor && (dept.containerLabel ?? null) === containerLabel) return;
    this.api.patch<Department>('/api/tenants/departments/' + dept.id, { containerColor: containerColor ?? '', containerLabel: containerLabel ?? '' }).subscribe({
      next: () => {
        this._departments.update(list =>
          list.map(d => d.id === dept.id ? { ...d, containerColor, containerLabel } : d));
        this.toasts.success('Container updated');
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /**
   * Soft lifecycle toggle: PATCH { isActive } (same endpoint/pattern as the
   * sample-code edit above). Deactivating hides the department from pickers
   * server-side but keeps every order/sample that references it.
   */
  toggleDeptActive(dept: Department) {
    const isActive = !dept.isActive;
    this.api.patch<Department>('/api/tenants/departments/' + dept.id, { isActive }).subscribe({
      next: () => {
        this._departments.update(list =>
          list.map(d => d.id === dept.id ? { ...d, isActive } : d));
        this.toasts.success(isActive ? `${dept.name} reactivated` : `${dept.name} deactivated`);
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // ── Assignment ─────────────────────────────────
  assignDepartment(subBranchId: string, departmentId: string) {
    if (!subBranchId || !departmentId) return;
    this.api.post(`/api/tenants/sub-branches/${subBranchId}/departments/${departmentId}`, {}).subscribe({
      next: () => {
        this._departments.update(list => list.map(d => d.id === departmentId ? { ...d, subBranchId } : d));
        this.toasts.success('Department assigned');
      }
    });
  }
  unassignDepartment(subBranchId: string, departmentId: string) {
    this.api.delete(`/api/tenants/sub-branches/${subBranchId}/departments/${departmentId}`).subscribe({
      next: () => {
        this._departments.update(list => list.map(d => d.id === departmentId ? { ...d, subBranchId: undefined } : d));
        this.toasts.success('Department unassigned');
      }
    });
  }
}
