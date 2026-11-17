import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
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

/** A branch's saved GST setup (read-only here; edited in Billing). */
interface GstRow { branchId: string; gstin: string; }


@Component({
  selector: 'pf-branches',
  standalone: true,
  imports: [SkeletonRowsComponent, BusyDirective, RouterLink, 
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

      <div class="pf-band-body">
      @if (newBranchOpen()) {
        <section class="pf-card pf-anim-in pf-br-new" aria-label="New branch">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>
            <h3 class="pf-card__label">New branch</h3>
          </div>
          <div class="grid grid-cols-2 gap-3 pf-branch-grid pf-br-new__body">
            <label class="pf-field"><span class="pf-field__lbl">Name</span>
              <input type="text" class="pf-input" [ngModel]="newBranch().name" (ngModelChange)="patchNewBranch({ name: $event })" /></label>
            <label class="pf-field"><span class="pf-field__lbl">Code</span>
              <input type="text" class="pf-input pf-num uppercase" [ngModel]="newBranch().code" (ngModelChange)="patchNewBranch({ code: $event.toUpperCase() })" /></label>
            <label class="pf-field"><span class="pf-field__lbl">City</span>
              <input type="text" class="pf-input" [ngModel]="newBranch().city" (ngModelChange)="patchNewBranch({ city: $event })" /></label>
            <label class="pf-field"><span class="pf-field__lbl">State</span>
              <input type="text" class="pf-input" [ngModel]="newBranch().state" (ngModelChange)="patchNewBranch({ state: $event })" /></label>
          </div>
          <div class="pf-card__foot">
            <button type="button" class="pf-btn pf-btn--tertiary press" (click)="toggleNewBranch()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary press" [disabled]="creatingBranch()" [pfBusy]="creatingBranch()" pfBusyLabel="Creating…" (click)="createBranch()">Create branch</button>
          </div>
        </section>
      }

      @if (listSkeleton()) {
        <!-- First load: the branch cards' shape, not "No branches yet". -->
        <pf-skeleton-rows [rows]="3" [avatar]="false" label="Loading branches…"></pf-skeleton-rows>
      } @else if (branches().length === 0) {
        <p class="pf-band-empty">No branches yet.</p>
      } @else if (visibleBranches().length === 0) {
        <p class="pf-band-empty">No branches match "{{ q() }}".</p>
      } @else {
        <div class="space-y-2.5">
          @for (b of visibleBranches(); track b.id) {
            <div class="pf-card pf-br-card">
              <div class="pf-branch-toggle">
                <div class="flex items-center gap-3 text-left pf-branch-titlewrap">
                  <span class="pf-branch-badge">{{ codeInitials(b.code) }}</span>
                  <div class="pf-branch-titlecol">
                    <p class="pf-br-name">{{ b.name }}@if (b.isActive === false) { <span class="pf-chip pf-chip--static pf-br-chip" data-testid="br-inactive-chip">Inactive</span> }</p>
                    <p class="pf-br-meta">{{ b.city ?? '—' }} · <span class="pf-num">{{ b.code }}</span></p>
                    <p class="pf-br-meta" data-testid="br-gstin">
                      GSTIN: @if (gstinOf(b.id); as g) { <span class="pf-num">{{ g }}</span> } @else { not set }
                      <a class="pf-br-link" routerLink="/admin/billing">Edit in Billing</a>
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2 pf-br-side">
                  @if (b.hasPfBox) {
                    <span class="pf-chip pf-chip--static pf-br-chip">PF Box</span>
                  }
                  @if (canRetireBranch()) {
                    <button type="button" class="pf-dcard-toggle" data-testid="br-toggle-active"
                            (click)="toggleBranchActive(b)"
                            [attr.aria-label]="(b.isActive === false ? 'Reactivate ' : 'Deactivate ') + b.name">
                      {{ b.isActive === false ? 'Reactivate branch' : 'Deactivate branch' }}
                    </button>
                  }
                </div>
              </div>
            </div>
          }
        </div>
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-br-new { margin-bottom: 16px; }
    .pf-br-new__body { padding: 16px 18px; }
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
export class BranchesComponent implements OnInit {
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
      next: saved => { this.creatingBranch.set(false); this._branches.update(list => [...list, saved]); this.toasts.success('Branch added'); this.toggleNewBranch(); },
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
}
