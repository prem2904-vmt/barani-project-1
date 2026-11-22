import { ViewStateService } from '../../../shared/services/view-state.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Branch } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandMatch } from '../../../shared/utils/band-search';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { NgTemplateOutlet } from '@angular/common';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { SG_ICON, SG_NARROW_MQ, SG_PHONE_MQ, SgAction, SgStatus, sgActions, sgActionsCol, sgBare, sgByStatus, sgCell, sgMedia, sgPillCol, sgRowOff, sgStatusOptions } from '../../../shared/settings-grid/settings-grid';
import { textCol } from '../../../shared/utils/work-grid';
import { HasUnsavedChanges, confirmLeaveUnsaved, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import type { ColDef, GetRowIdParams, ICellRendererParams } from 'ag-grid-community';

/** A branch's saved GST setup (read-only here; edited in Billing). */
interface GstRow { branchId: string; gstin: string; }


@Component({
  selector: 'pf-branches',
  standalone: true,
  imports: [SkeletonRowsComponent, BusyDirective, RouterLink, NgTemplateOutlet, DataGridComponent, SegmentedComponent,
    FormsModule,
    ScreenHeaderComponent,
    TouchButtonComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): search branches and departments;
             "Add branch" rides the band's actions. -->
        <pf-hero-band [back]="true" placeholder="Search branches…"
                      [value]="q()" (valueChange)="q.set($event)">
          
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Branches"
        subtitle="Manage collection sites. Departments and lab spaces now live under Lab.">
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

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels pf-br-panels" [class.pf-sg-panels--single]="!newBranchOpen()" [class.pf-sg-panels--narrow]="narrow()">
          <!-- Add branch: a LEFT side card (sheet on narrow), like every settings grid's form. -->
          @if (newBranchOpen()) {
            @if (narrow()) { <div class="pf-sheet-backdrop" (click)="requestCloseForm()"></div> }
            <aside class="pf-card pf-sg-side pf-br-new" [class.pf-sg-side--sheet]="narrow()" aria-label="New branch" (keydown.escape)="requestCloseForm()">
              @if (narrow()) { <span class="pf-sg-sheet-handle" aria-hidden="true"></span> }
              <div class="pf-card__head">
                <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>
                <h3 class="pf-card__label">New branch</h3>
                <span class="pf-card__spacer"></span>
                <!-- Actions in the head (owner 2026-11-17: nothing clickable at the bottom). -->
                <button type="button" class="pf-btn pf-btn--primary press" data-testid="branch-create" [disabled]="creatingBranch() || !hasUnsavedChanges()"
                        [pfBusyInactive]="creatingBranch() || !hasUnsavedChanges()" [title]="creatingBranch() || hasUnsavedChanges() ? 'Create branch' : 'Nothing entered yet'"
                        [pfBusy]="creatingBranch()" pfBusyLabel="Creating…" (click)="createBranch()">Create branch</button>
<button type="button" class="pf-btn pf-btn--icon" (click)="requestCloseForm()" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
              <div class="pf-card__body pf-br-new__body">
                <label class="pf-field"><span class="pf-field__lbl">Name</span>
                  <input type="text" class="pf-input" [ngModel]="newBranch().name" (ngModelChange)="patchNewBranch({ name: $event })" /></label>
                <label class="pf-field"><span class="pf-field__lbl">Code</span>
                  <input type="text" class="pf-input pf-num uppercase" [ngModel]="newBranch().code" (ngModelChange)="patchNewBranch({ code: $event.toUpperCase() })" /></label>
                <label class="pf-field"><span class="pf-field__lbl">City</span>
                  <input type="text" class="pf-input" [ngModel]="newBranch().city" (ngModelChange)="patchNewBranch({ city: $event })" /></label>
                <label class="pf-field"><span class="pf-field__lbl">State</span>
                  <input type="text" class="pf-input" [ngModel]="newBranch().state" (ngModelChange)="patchNewBranch({ state: $event })" /></label>
              </div>
              
            </aside>
          }

          <section class="pf-card pf-sg-main pf-br-main" [class.pf-sg-main--bare]="bare" aria-label="Branches">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>
              <span class="pf-card__label">Branches</span>
              <span class="pf-card__note pf-sg-hint">GSTIN is set in <a class="pf-br-link" routerLink="/admin/billing">Billing</a></span>
              <span class="pf-card__spacer"></span>
              <ng-container *ngTemplateOutlet="headToolsTpl"></ng-container>
            </header>
            <div class="pf-sg-main__body">
              <pf-data-grid viewStateKey="admin.branches.g1" [rowData]="gridBranches()" [columnDefs]="colDefs()" [getRowId]="getRowId" [getRowClass]="rowClass"
                            [loading]="listSkeleton()" loadingLabel="Loading branches…"
                            [emptyTitle]="branches().length === 0 ? 'No branches yet.' : 'No branches match your search.'"></pf-data-grid>
            </div>
          </section>
        </div>
      </div>
    </section>

    <!-- Head tools: count · All / Active / Inactive. -->
    <ng-template #headToolsTpl>
      <span class="pf-sg-count pf-num">{{ gridBranches().length }} {{ gridBranches().length === 1 ? 'branch' : 'branches' }}</span>
      <pf-segmented class="pf-sg-status-filter" size="sm" [options]="statusOptions()" [value]="status()" (valueChange)="status.set($event)" aria-label="Filter by status"></pf-segmented>
          <!-- The page's action, IN the pane (owner: no band buttons in Settings), after the head tools. -->
            <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press" (click)="toggleNewBranch()"
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
    </ng-template>
  `,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  styles: [`
    .pf-br-new__body { gap: 12px; }
    .pf-br-panels { grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); }
    .pf-br-panels.pf-sg-panels--single, .pf-br-panels.pf-sg-panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-br-card { overflow: visible; }
    .pf-br-name { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-br-meta { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .pf-br-chip { height: 24px; font-size: 11.5px; }
    .pf-br-link { color: var(--violet-text, #7c3aed); font-weight: 600; text-decoration: none; }
    .pf-br-link:hover { text-decoration: underline; }
    .pf-branch-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; }
    .pf-branch-badge {
      display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);
      color: var(--violet-text, #7c3aed); font-size: 13px; font-weight: 600; letter-spacing: 0.02em;
    }
    .pf-dcard-toggle {
      font-size: 11.5px; color: var(--text-secondary); background: transparent;
      border: 1px solid var(--pf-line); border-radius: 8px; padding: 5px 10px; cursor: pointer; white-space: nowrap;
    }
    .pf-dcard-toggle:hover { color: var(--text-primary); background: var(--bg-hover); }
    .pf-branch-titlewrap { min-width: 0; flex: 1 1 auto; }
    .pf-branch-titlecol { min-width: 0; }
    @media (max-width: 640px) {
      .pf-branch-grid { grid-template-columns: 1fr !important; }
      :host .pf-input, :host input[type="text"] { font-size: 16px; }
      .pf-branch-toggle { padding: 12px 14px; align-items: flex-start; flex-wrap: wrap; }
      .pf-br-side { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
    }
  `]
})
export class BranchesComponent implements OnInit, HasUnsavedChanges {
  // ── Test Master grid (pf-data-grid) ──
  protected readonly bare = sgBare();
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  private readonly headToolsTpl = viewChild<TemplateRef<unknown>>('headToolsTpl');
  /** Count + status filter, for the Settings card head. */
  readonly headTools = computed(() => this.headToolsTpl());
  readonly status = signal<SgStatus>('all');
  readonly statusOptions = computed(() => sgStatusOptions(this._branches().length, this._branches().filter(b => b.isActive === false).length));
  readonly gridBranches = computed(() => sgByStatus(this.visibleBranches(), this.status(), b => b.isActive !== false));
  readonly getRowId = (p: GetRowIdParams<Branch>) => p.data.id;
  readonly rowClass = sgRowOff<Branch>(b => b.isActive !== false);
  actionsFor(b: Branch): SgAction[] {
    if (!this.canRetireBranch()) return [];
    const on = b.isActive !== false;
    return [{ label: on ? 'Deactivate branch' : 'Reactivate branch', aria: `${on ? 'Deactivate' : 'Reactivate'} ${b.name}`, icon: true, path: SG_ICON.power, run: () => { void this.toggleBranchActive(b); } }];
  }
  readonly colDefs = computed<ColDef<Branch>[]>(() => {
    this._gst();
    const web = !this.phone();
    const cols: ColDef<Branch>[] = [
      textCol<Branch>({ colId: 'name', headerName: 'Branch', flex: 1.4, minWidth: 180, sort: 'asc',
        cellRenderer: (p: ICellRendererParams<Branch>) => sgCell(p.data?.name, p.data?.hasPfBox ? 'PF Box' : null, true) }, b => b.name ?? ''),
      textCol<Branch>({ colId: 'code', headerName: 'Code', width: 110, minWidth: 90, flex: 0, cellClass: 'pf-num',
        valueFormatter: p => (p.value as string) || '—' }, b => b.code || ''),
      textCol<Branch>({ colId: 'place', headerName: 'City, State', flex: 1, minWidth: 150,
        valueFormatter: p => (p.value as string) || '—' }, b => [b.city, b.state].filter(Boolean).join(', ')),
      textCol<Branch>({ colId: 'gstin', headerName: 'GSTIN', flex: 1, minWidth: 160,
        cellRenderer: (p: ICellRendererParams<Branch>) => { const g = p.data ? this.gstinOf(p.data.id) : ''; const el = sgCell(g || null, g ? null : 'Not set'); if (!g) el.firstElementChild?.remove(); else el.classList.add('pf-num'); return el; } },
        b => this.gstinOf(b.id) ?? ''),
      sgPillCol<Branch>(b => b.isActive !== false),
    ];
    // Phone (owner 2026-11-21: the power button was cut off at the right edge): Branch + the action only — the status
    // rides the name's second line. The action column is pinned at every size so it always shows in full.
    if (this.canRetireBranch()) cols.push(sgActionsCol<Branch>(web, [], 1, p => (p.data ? sgActions(web, this.actionsFor(p.data)) : document.createElement('span')), true));
    if (this.phone()) {
      return cols.filter(c => ['name', 'actions'].includes(c.colId ?? '')).map(c => c.colId !== 'name' ? c : {
        ...c, minWidth: 120,
        cellRenderer: (p: ICellRendererParams<Branch>) => sgCell(p.data?.name,
          [p.data?.isActive === false ? 'Inactive' : 'Active', p.data?.code, p.data?.hasPfBox ? 'PF Box' : null].filter(Boolean).join(' · '), true),
      });
    }
    return cols;
  });

  // ── Unsaved changes (the Add branch form) ──
  readonly unsavedLabel = 'the new branch';
  hasUnsavedChanges(): boolean {
    if (!this.newBranchOpen() || this.creatingBranch()) return false;
    const b = this._newBranch();
    return !!(b.name.trim() || b.code.trim() || b.city.trim() || b.state.trim());
  }
  private readonly unloadGuard = guardUnsavedOnUnload(this);
  async requestCloseForm(): Promise<void> {
    if (await confirmLeaveUnsaved(this.dialog, this)) { this.newBranchOpen.set(false); this.toggleNewBranchReset(); }
  }
  private toggleNewBranchReset() { this._newBranch.set({ name: '', code: '', type: 'lab', city: '', state: '', hasPfBox: false }); }

  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  /** Retiring a branch is for tenant-wide admins (the server enforces it too). */
  protected readonly canRetireBranch = computed(() => this.auth.hasPermission('manage_tenant'));

  /** Band pill search over branch name, code, city and state. */
  readonly q = signal('');
  readonly visibleBranches = computed(() => {
    const q = this.q();
    const all = this._branches();
    if (!q.trim()) return all;
    return all.filter(b => bandMatch(q, b.name, b.code, b.city, b.state));
  });

  private readonly _branches = signal<Branch[]>([]);
  private readonly _gst = signal<GstRow[]>([]);
  readonly branches = this._branches.asReadonly();

  protected readonly newBranchOpen = signal(false);
  private readonly _newBranch = signal({ name: '', code: '', type: 'lab', city: '', state: '', hasPfBox: false });
  readonly newBranch = this._newBranch.asReadonly();

  // ── Loading feedback (PF-PATTERN "Loading feedback") ──
  private readonly listHold = createLoadHold(true);
  /** First load: skeleton cards until the branches land (held, no flash). */
  readonly listSkeleton = this.listHold.active;
  readonly creatingBranch = signal(false);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.destroyRef.onDestroy(() => this.listHold.cancel());
    this.api.get<Branch[]>('/api/tenants/branches?includeInactive=true').subscribe({
      next: l => { this._branches.set(l ?? []); this.listHold.done(); },
      error: () => this.listHold.done(),
    });
    // GSTIN is shown, not edited, here (Billing owns it). A caller without the
    // billing permission simply sees "not set".
    this.api.get<GstRow[]>('/api/config/gst').subscribe({ next: l => this._gst.set(l ?? []), error: () => { } });
  }

  gstinOf(branchId: string): string {
    return (this._gst().find(g => g.branchId === branchId)?.gstin ?? '').trim();
  }

  codeInitials(code: string): string {
    return code ? code.slice(0, 2) : '??';
  }

  // ── Branch ─────────────────────────────────────
  toggleNewBranch() {
    if (this.newBranchOpen() && this.hasUnsavedChanges()) { void this.requestCloseForm(); return; }
    this.newBranchOpen.update(v => !v);
    this._newBranch.set({ name: '', code: '', type: 'lab', city: '', state: '', hasPfBox: false });
  }
  patchNewBranch(p: Partial<{ name: string; code: string; city: string; state: string; hasPfBox: boolean }>) {
    this._newBranch.update(v => ({ ...v, ...p }));
  }
  createBranch() {
    const b = this._newBranch();
    if (!b.name.trim() || !b.code.trim()) { this.toasts.warning('Name and code required'); return; }
    if (this.creatingBranch()) return;
    this.creatingBranch.set(true);
    this.api.post<Branch>('/api/tenants/branches', b).subscribe({
      next: saved => { this.creatingBranch.set(false); this._branches.update(list => [...list, saved]); this.toasts.success('Branch added'); this.newBranchOpen.set(false); this.toggleNewBranchReset(); },
      error: e => { this.creatingBranch.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  /** Deactivate / reactivate a whole branch. The server refuses the branch you are
   *  working in and the last active one; its message is shown as-is. */
  async toggleBranchActive(b: Branch) {
    const isActive = b.isActive === false;
    if (!isActive) {
      const ok = await this.dialog.confirm({
        title: `Deactivate ${b.name}?`,
        message: 'It disappears from branch switchers and pickers. Orders, samples and reports stay as they are; you can reactivate it any time.',
        confirmLabel: 'Deactivate', tone: 'danger',
      });
      if (!ok) return;
    }
    this.api.patch<Branch>('/api/tenants/branches/' + b.id, { isActive }).subscribe({
      next: () => {
        this._branches.update(list => list.map(x => x.id === b.id ? { ...x, isActive } : x));
        this.toasts.success(isActive ? `${b.name} reactivated` : `${b.name} deactivated`);
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('admin.branches', { q: this.q, status: this.status });
}
