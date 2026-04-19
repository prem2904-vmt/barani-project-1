import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch, Department } from '../../../shared/models/tenant.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

@Component({
  selector: 'pf-branches',
  standalone: true,
  imports: [
    FormsModule,
    ChipComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto">
      <pf-screen-header
        eyebrow="Admin"
        title="Branches & Departments"
        subtitle="Manage collection sites and their lab departments.">
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
          <div class="grid grid-cols-2 gap-3">
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
                <div class="flex items-center gap-3 text-left">
                  <span class="pf-branch-badge">{{ codeInitials(b.code) }}</span>
                  <div>
                    <p class="text-[15px] font-semibold" style="color: var(--text-primary);">{{ b.name }}</p>
                    <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
                      {{ b.city ?? '—' }} · {{ b.code }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  @if (b.hasPfBox) {
                    <pf-chip tone="violet" size="sm">PF Box</pf-chip>
                  }
                  <span class="text-[12px] font-mono" style="color: var(--text-muted);">
                    {{ departmentsFor(b.id).length }} depts
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
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="text-[11px] font-mono uppercase tracking-[0.16em]"
                        style="color: var(--text-muted);">Departments</h4>
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

                  @if (departmentsFor(b.id).length === 0) {
                    <p class="text-[13px]" style="color: var(--text-tertiary);">
                      No departments yet.
                    </p>
                  } @else {
                    <div class="space-y-1.5">
                      @for (d of departmentsFor(b.id); track d.id) {
                        <div class="pf-dept-row">
                          <div>
                            <span class="text-[14px] font-medium" style="color: var(--text-primary);">{{ d.name }}</span>
                            <span class="text-[11px] font-mono ml-2" style="color: var(--text-muted);">{{ d.code }}</span>
                          </div>
                          @if (d.isActive) {
                            <span class="pf-dot-on" aria-label="Active"></span>
                          } @else {
                            <span class="pf-dot-off" aria-label="Inactive"></span>
                          }
                        </div>
                      }
                    </div>
                  }

                  @if (addingDeptFor() === b.id) {
                    <div class="mt-4 flex gap-2 flex-wrap">
                      <input type="text" class="pf-input flex-1 min-w-0" placeholder="Department name"
                             [ngModel]="deptDraft().name" (ngModelChange)="patchDeptDraft({ name: $event })" />
                      <input type="text" class="pf-input w-32 uppercase" placeholder="CODE"
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
    .pf-branch-toggle:hover { background: var(--bg-hover); }

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

    .pf-chevron {
      display: inline-flex;
      color: var(--text-muted);
      transition: transform 0.2s ease;
    }
    .pf-chevron-open { transform: rotate(180deg); }

    .pf-branch-body {
      padding: 16px 18px 18px;
      border-top: 1px solid var(--border-muted);
      background: var(--glass-bg);
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
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: #10b981;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.55);
    }
    .pf-dot-off {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: var(--text-muted);
      opacity: 0.4;
    }
  `]
})
export class BranchesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  private readonly _branches = signal<Branch[]>([]);
  private readonly _departments = signal<Department[]>([]);
  private readonly _openIds = signal<Set<string>>(new Set());

  readonly branches = this._branches.asReadonly();
  readonly departments = this._departments.asReadonly();

  protected readonly newBranchOpen = signal(false);
  private readonly _newBranch = signal({ name: '', code: '', type: 'lab', city: '', state: '', hasPfBox: false });
  readonly newBranch = this._newBranch.asReadonly();

  protected readonly addingDeptFor = signal<string | null>(null);
  private readonly _deptDraft = signal({ name: '', code: '' });
  readonly deptDraft = this._deptDraft.asReadonly();

  ngOnInit() {
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({ next: l => this._branches.set(l ?? []) });
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

  departmentsFor(branchId: string): Department[] {
    return this._departments().filter(d => d.branchId === branchId);
  }

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
}
