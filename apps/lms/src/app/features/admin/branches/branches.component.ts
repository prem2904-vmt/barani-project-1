import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch, Department, SubBranch } from '../../../shared/models/tenant.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

@Component({
  selector: 'pf-branches',
  standalone: true,
  imports: [
    FormsModule,
    SelectComponent,
    ChipComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
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

      @if (newBranchOpen()) {
        <pf-tile tone="violet" padding="lg" class="block mb-4">
          <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
              style="color: var(--text-muted);">New branch</h3>
          <div class="grid grid-cols-2 gap-3 pf-branch-grid">
            <div><label class="pf-label">Name</label>
              <input type="text" class="pf-input" [ngModel]="newBranch().name" (ngModelChange)="patchNewBranch({ name: $event })" /></div>
            <div><label class="pf-label">Code</label>
              <input type="text" class="pf-input uppercase" [ngModel]="newBranch().code" (ngModelChange)="patchNewBranch({ code: $event.toUpperCase() })" /></div>
            <div><label class="pf-label">City</label>
              <input type="text" class="pf-input" [ngModel]="newBranch().city" (ngModelChange)="patchNewBranch({ city: $event })" /></div>
            <div><label class="pf-label">State</label>
              <input type="text" class="pf-input" [ngModel]="newBranch().state" (ngModelChange)="patchNewBranch({ state: $event })" /></div>
          </div>
          <div class="mt-4 flex gap-2 justify-end">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="toggleNewBranch()">Cancel</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" (pressed)="createBranch()">Create</pf-touch-btn>
          </div>
        </pf-tile>
      }

      @if (branches().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">No branches yet.</p>
          </div>
        </pf-tile>
      } @else {
        <div class="space-y-2.5">
          @for (b of branches(); track b.id) {
            <pf-tile tone="default" padding="none" class="block">
              <button type="button"
                      class="pf-branch-toggle"
                      (click)="toggle(b.id)">
                <div class="flex items-center gap-3 text-left pf-branch-titlewrap">
                  <span class="pf-branch-badge">{{ codeInitials(b.code) }}</span>
                  <div class="pf-branch-titlecol">
                    <p class="text-[15px] font-semibold pf-trunc" style="color: var(--text-primary);">{{ b.name }}</p>
                    <p class="text-[12px] mt-0.5 pf-trunc" style="color: var(--text-tertiary);">
                      {{ b.city ?? '—' }} · {{ b.code }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  @if (b.hasPfBox) {
                    <pf-chip tone="violet" size="sm">PF Box</pf-chip>
                  }
                  <span class="text-[12px] font-mono" style="color: var(--text-muted);">
                    {{ subBranchesFor(b.id).length }} sub · {{ allDeptsFor(b.id).length }} depts
                  </span>
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
                    <h4 class="text-[11px] font-mono uppercase tracking-[0.16em]"
                        style="color: var(--text-muted);">Sub-branches</h4>
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
                                <p class="text-[14px] font-semibold pf-trunc" style="color: var(--text-primary);">
                                  → {{ sb.name }}
                                </p>
                                <p class="text-[11px] font-mono mt-0.5 pf-trunc" style="color: var(--text-muted);">
                                  {{ sb.code }} · {{ sb.type }}
                                </p>
                              </div>
                            </div>
                            <div class="flex items-center gap-2">
                              @if (sb.isActive) {
                                <span class="pf-dot-on" aria-label="Active"></span>
                              } @else {
                                <pf-chip tone="default" size="sm">Inactive</pf-chip>
                              }
                              <pf-touch-btn size="sm" variant="ghost" (pressed)="deactivateSubBranch(sb)">
                                {{ sb.isActive ? 'Deactivate' : '—' }}
                              </pf-touch-btn>
                            </div>
                          </div>
                          <div class="pf-sub-deps">
                            <span class="text-[11px] font-mono uppercase tracking-[0.14em]"
                                  style="color: var(--text-muted);">Departments</span>
                            @if (deptsForSubBranch(sb.id).length === 0) {
                              <span class="text-[12px]" style="color: var(--text-tertiary);">None assigned</span>
                            } @else {
                              @for (d of deptsForSubBranch(sb.id); track d.id) {
                                <div class="pf-dept-pill">
                                  <span>{{ d.name }}</span>
                                  <input type="number" inputmode="numeric" min="1" max="99"
                                         class="pf-input pf-sample-input pf-sample-input--pill" placeholder="01"
                                         title="Sample # — 2-digit code (01–99) prefixing the short sample barcode"
                                         [value]="d.sampleCode ?? ''"
                                         (change)="saveSampleCode(d, $any($event.target).value)" />
                                  <button type="button" class="pf-unassign"
                                          (click)="unassignDepartment(sb.id, d.id)"
                                          title="Unassign from sub-branch">
                                    ×
                                  </button>
                                </div>
                              }
                            }
                            @if (unassignedDeptsFor(b.id).length > 0) {
                              <pf-select
                                style="width: 160px"
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
                        <input type="text" class="pf-input" placeholder="Sub-branch name"
                               [ngModel]="subBranchDraft().name" (ngModelChange)="patchSubBranchDraft({ name: $event })" />
                        <input type="text" class="pf-input uppercase" placeholder="CODE"
                               [ngModel]="subBranchDraft().code" (ngModelChange)="patchSubBranchDraft({ code: $event.toUpperCase() })" />
                        <pf-select
                          [options]="subBranchTypeOpts"
                          [value]="subBranchDraft().type"
                          (valueChange)="patchSubBranchDraft({ type: $any($event) })">
                        </pf-select>
                        <input type="text" class="pf-input" placeholder="City"
                               [ngModel]="subBranchDraft().city" (ngModelChange)="patchSubBranchDraft({ city: $event })" />
                      </div>
                      <div class="flex gap-2 justify-end mt-3">
                        <pf-touch-btn size="sm" variant="ghost" (pressed)="cancelAddSubBranch()">Cancel</pf-touch-btn>
                        <pf-touch-btn size="sm" variant="primary" (pressed)="createSubBranch(b.id)">Save</pf-touch-btn>
                      </div>
                    </div>
                  }

                  <!-- BRANCH-LEVEL DEPARTMENTS (not routed to any sub-branch) -->
                  <div class="pf-branch-deps-header">
                    <h4 class="text-[11px] font-mono uppercase tracking-[0.16em]"
                        style="color: var(--text-muted);">Branch departments (unassigned)</h4>
                    <pf-touch-btn size="sm" variant="ghost" (pressed)="beginAddDept(b.id)">
                      <span icon-left aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 5v14"/>
                          <path d="M5 12h14"/>
                        </svg>
                      </span>
                      Add
                    </pf-touch-btn>
                  </div>

                  <p class="text-[11px] mb-2" style="color: var(--text-tertiary);">
                    Sample # is a 2-digit code (01–99) that prefixes the short sample barcode (DD + YY + running number).
                  </p>

                  @if (unassignedDeptsFor(b.id).length === 0) {
                    <p class="text-[13px]" style="color: var(--text-tertiary);">
                      All departments are assigned to sub-branches.
                    </p>
                  } @else {
                    <div class="space-y-1.5">
                      @for (d of unassignedDeptsFor(b.id); track d.id) {
                        <div class="pf-dept-row">
                          <div>
                            <span class="text-[14px] font-medium" style="color: var(--text-primary);">{{ d.name }}</span>
                            <span class="text-[11px] font-mono ml-2" style="color: var(--text-muted);">{{ d.code }}</span>
                          </div>
                          <div class="flex items-center gap-2">
                            <label class="pf-sample-field">
                              <span class="pf-sample-label">Sample #</span>
                              <input type="number" inputmode="numeric" min="1" max="99"
                                     class="pf-input pf-sample-input" placeholder="01"
                                     [value]="d.sampleCode ?? ''"
                                     (change)="saveSampleCode(d, $any($event.target).value)" />
                            </label>
                            @if (subBranchesFor(b.id).length > 0) {
                              <pf-select
                                style="width: 150px"
                                size="sm"
                                [options]="subBranchesAsOpts(subBranchesFor(b.id))"
                                [value]="''"
                                placeholder="Assign →"
                                (valueChange)="assignDepartment($event, d.id)">
                              </pf-select>
                            }
                            @if (d.isActive) {
                              <span class="pf-dot-on" aria-label="Active"></span>
                            } @else {
                              <span class="pf-dot-off" aria-label="Inactive"></span>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }

                  @if (addingDeptFor() === b.id) {
                    <div class="pf-dept-add mt-4 flex gap-2 flex-wrap">
                      <input type="text" class="pf-input pf-dept-add__name flex-1 min-w-0" placeholder="Department name"
                             [ngModel]="deptDraft().name" (ngModelChange)="patchDeptDraft({ name: $event })" />
                      <input type="text" class="pf-input pf-dept-add__code w-32 uppercase" placeholder="CODE"
                             [ngModel]="deptDraft().code" (ngModelChange)="patchDeptDraft({ code: $event.toUpperCase() })" />
                      <pf-touch-btn size="sm" variant="primary" (pressed)="createDepartment(b.id)">Save</pf-touch-btn>
                      <pf-touch-btn size="sm" variant="ghost" (pressed)="cancelAddDept()">Cancel</pf-touch-btn>
                    </div>
                  }
                </div>
              }
            </pf-tile>
          }
        </div>
      }
    </section>
  `,
  styles: [`
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
      background: var(--gradient-primary);
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
    }
    .pf-sub-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(236, 72, 153, 0.12);
      color: #ec4899;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid rgba(236, 72, 153, 0.25);
    }

    .pf-chevron { display: inline-flex; color: var(--text-muted); transition: transform 0.2s ease; }
    .pf-chevron-open { transform: rotate(180deg); }

    .pf-branch-body {
      padding: 16px 18px 18px;
      border-top: 1px solid var(--border-muted);
      background: var(--glass-bg);
    }

    .pf-sub-card {
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--bg-card-solid);
      border: 1px solid var(--border-muted);
      border-left: 3px solid rgba(236, 72, 153, 0.55);
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
      background: rgba(124, 58, 237, 0.08);
      border: 1px solid rgba(124, 58, 237, 0.22);
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

    /* ── Per-department sample code (2-digit prefix) ── */
    .pf-sample-field {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pf-sample-label {
      font-size: 11px;
      font-family: ui-monospace, monospace;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .pf-sample-input {
      width: 64px;
      text-align: center;
      padding: 6px 8px;
      -moz-appearance: textfield;
    }
    .pf-sample-input::-webkit-outer-spin-button,
    .pf-sample-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    /* Compact variant inside the assigned-department pill */
    .pf-sample-input--pill {
      width: 52px;
      padding: 2px 6px;
      font-size: 12px;
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

    .pf-dot-on {
      width: 8px; height: 8px; border-radius: 9999px;
      background: #10b981;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.55);
    }
    .pf-dot-off {
      width: 8px; height: 8px; border-radius: 9999px;
      background: var(--text-muted); opacity: 0.4;
    }

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

  private readonly _branches = signal<Branch[]>([]);
  private readonly _subBranches = signal<SubBranch[]>([]);
  private readonly _departments = signal<Department[]>([]);
  private readonly _openIds = signal<Set<string>>(new Set());

  readonly branches = this._branches.asReadonly();
  readonly subBranches = this._subBranches.asReadonly();
  readonly departments = this._departments.asReadonly();

  readonly subBranchTypeOpts: PfSelectOption[] = [
    { value: 'lab',               label: 'Lab (in-house)' },
    { value: 'collection-center', label: 'Collection center' },
    { value: 'satellite',         label: 'Satellite' }
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

  protected readonly addingDeptFor = signal<string | null>(null);
  private readonly _deptDraft = signal({ name: '', code: '' });
  readonly deptDraft = this._deptDraft.asReadonly();

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
  }

  codeInitials(code: string): string {
    return code ? code.slice(0, 2) : '??';
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
  allDeptsFor(branchId: string): Department[] {
    return this._departments().filter(d => d.branchId === branchId);
  }
  unassignedDeptsFor(branchId: string): Department[] {
    return this._departments().filter(d => d.branchId === branchId && !d.subBranchId);
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
      next: saved => { this._branches.update(list => [...list, saved]); this.toasts.success('Branch added'); this.toggleNewBranch(); }
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
      }
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
  beginAddDept(branchId: string) {
    this.addingDeptFor.set(branchId);
    this._deptDraft.set({ name: '', code: '' });
  }
  patchDeptDraft(p: Partial<{ name: string; code: string }>) { this._deptDraft.update(v => ({ ...v, ...p })); }
  cancelAddDept() { this.addingDeptFor.set(null); }
  createDepartment(branchId: string) {
    const d = this._deptDraft();
    if (!d.name.trim() || !d.code.trim()) { this.toasts.warning('Name and code required'); return; }
    this.api.post<Department>('/api/tenants/departments', { name: d.name, code: d.code, branchId }).subscribe({
      next: saved => { this._departments.update(list => [...list, saved]); this.toasts.success('Department added'); this.cancelAddDept(); }
    });
  }

  /**
   * Persist a department's 2-digit sample code. Empty input clears it (null);
   * otherwise the value is clamped to 1–99 before PATCHing. No-ops when the
   * value is unchanged or invalid (e.g. non-numeric).
   */
  saveSampleCode(dept: Department, raw: string) {
    const trimmed = (raw ?? '').trim();
    let sampleCode: number | null;
    if (trimmed === '') {
      sampleCode = null;
    } else {
      const n = Math.floor(Number(trimmed));
      if (!Number.isFinite(n)) { return; }
      sampleCode = Math.min(99, Math.max(1, n));
    }

    const current = dept.sampleCode ?? null;
    if (current === sampleCode) { return; }

    this.api.patch<Department>('/api/tenants/departments/' + dept.id, { sampleCode }).subscribe({
      next: () => {
        this._departments.update(list =>
          list.map(d => d.id === dept.id ? { ...d, sampleCode: sampleCode ?? undefined } : d));
        this.toasts.success(
          sampleCode === null
            ? 'Sample code cleared'
            : `Sample code set to ${String(sampleCode).padStart(2, '0')}`);
      },
      error: () => this.toasts.error('Could not save sample code')
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
