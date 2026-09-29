import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import { TouchButtonComponent } from '../../primitives/touch-button.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { heldFlag } from '../../../shared/utils/min-duration';

/** One department of the order, as the backend's edit-plan describes it. */
export interface EditPlanDept {
  departmentId: string;
  departmentName: string;
  departmentCode?: string | null;
  testCount: number;
  editableCount: number;
  performerId?: string | null;
  performerName?: string | null;
  tests: string[];
}

export interface EditPlanTech { id: string; name: string; }

export interface EditPlan {
  orderId: string;
  orderNumber?: string | null;
  reportReleased: boolean;
  departments: EditPlanDept[];
  technicians: EditPlanTech[];
}

/**
 * Post-result EDIT popup.
 *
 * A finished result can be pulled back for correction. Every DEPARTMENT of the
 * order is checked by default — the common case is "the whole thing is wrong" —
 * and each row carries the tech who performed it, pre-selected but swappable to
 * any technician. A reason is mandatory: it lands in the order's activity log
 * and on the amended report. Confirming drops the selected work back into the
 * chosen techs' My Work.
 *
 * The host owns visibility: render `<pf-edit-result-dialog>` only while open,
 * and listen for `closed` / `edited`.
 */
@Component({
  selector: 'pf-edit-result-dialog',
  standalone: true,
  imports: [SkeletonRowsComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-erd-root" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <div class="pf-erd-backdrop" (click)="close()"></div>

      <div class="pf-erd-card">
        <span class="pf-erd-glow" aria-hidden="true"></span>

        <header class="pf-erd-head">
          <span class="pf-erd-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>
            </svg>
          </span>
          <div class="pf-erd-head-text">
            <h2 class="pf-erd-title">{{ title() }}</h2>
            <p class="pf-erd-sub">
              @if (plan(); as p) {
                {{ p.orderNumber ? p.orderNumber + ' · ' : '' }}Pick the work to correct — it returns to the technician's My Work.
              } @else {
                Loading the order's departments…
              }
            </p>
          </div>
          <button type="button" class="pf-erd-close" (click)="close()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </header>

        <div class="pf-erd-body">
          @if (loadingShown()) {
            <div class="pf-erd-loading">
              <pf-skeleton-rows [rows]="4" [dense]="true" [avatar]="false" label="Loading departments…"></pf-skeleton-rows>
            </div>
          } @else if (loadError()) {
            <p class="pf-erd-empty">{{ loadError() }}</p>
          } @else if (plan(); as p) {

            @if (p.reportReleased) {
              <p class="pf-erd-warn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                  <path d="M12 9v4"/><path d="M12 17h.01"/>
                </svg>
                A report has already been released — correcting this will issue an amended report once it is re-validated.
              </p>
            }

            @if (p.departments.length === 0) {
              <p class="pf-erd-empty">This order has no departments to edit.</p>
            }

            <ul class="pf-erd-list">
              @for (d of p.departments; track d.departmentId) {
                <li class="pf-erd-row" [class.pf-erd-row--off]="d.editableCount === 0">
                  <label class="pf-erd-pick">
                    <input type="checkbox"
                           [checked]="isChecked(d.departmentId)"
                           [disabled]="d.editableCount === 0"
                           (change)="toggle(d.departmentId, $any($event.target).checked)" />
                    <span class="pf-erd-dept">
                      <span class="pf-erd-dept-name">
                        {{ d.departmentName }}
                        @if (d.departmentCode) { <span class="pf-erd-code">{{ d.departmentCode }}</span> }
                      </span>
                      <span class="pf-erd-tests">{{ testsLabel(d) }}</span>
                      @if (d.editableCount === 0) {
                        <span class="pf-erd-note">nothing submitted yet</span>
                      }
                    </span>
                  </label>

                  <label class="pf-erd-tech">
                    <span class="pf-erd-tech-lbl">Send to</span>
                    <select class="pf-input pf-erd-select"
                            [disabled]="d.editableCount === 0 || !isChecked(d.departmentId)"
                            [value]="assigneeFor(d)"
                            (change)="setAssignee(d.departmentId, $any($event.target).value)">
                      @if (!d.performerId) {
                        <option value="">Unassigned — pick a technician</option>
                      }
                      @for (t of p.technicians; track t.id) {
                        <option [value]="t.id">{{ t.name }}</option>
                      }
                    </select>
                  </label>
                </li>
              }
            </ul>

            <label class="pf-erd-reason">
              <span class="pf-erd-reason-lbl">Reason — recorded in the activity log</span>
              <textarea class="pf-input pf-erd-textarea" rows="2"
                        placeholder="e.g. wrong sample used, typo in haemoglobin"
                        [value]="reason()"
                        (input)="reason.set($any($event.target).value)"></textarea>
            </label>
          }
        </div>

        <footer class="pf-erd-actions">
          <pf-touch-btn size="sm" variant="ghost" [disabled]="saving()" (pressed)="close()">Cancel</pf-touch-btn>
          <pf-touch-btn size="sm" [disabled]="!canConfirm()" [busy]="saving()" busyLabel="Sending…" (pressed)="confirm()">
            {{ saving() ? 'Sending…' : 'Send for correction' }}
          </pf-touch-btn>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .pf-erd-root {
      position: fixed; inset: 0; z-index: 72;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .pf-erd-backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.72);
      backdrop-filter: blur(14px) saturate(1.2);
      -webkit-backdrop-filter: blur(14px) saturate(1.2);
      animation: pf-erd-fade 0.22s ease-out both;
    }

    .pf-erd-card {
      position: relative;
      width: 100%; max-width: 36rem;
      max-height: calc(100dvh - 40px);
      display: flex; flex-direction: column;
      padding: 22px 22px 18px;
      border-radius: 20px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow:
        0 1px 0 0 rgba(255, 255, 255, 0.04) inset,
        0 30px 70px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(168, 85, 247, 0.08);
      overflow: hidden;
      animation: pf-erd-pop 0.3s cubic-bezier(0.2, 0.9, 0.25, 1.1) both;
    }
    .pf-erd-glow {
      position: absolute; top: -80px; left: -40px;
      width: 260px; height: 200px; pointer-events: none;
      background: radial-gradient(closest-side, rgba(168, 85, 247, 0.35), transparent 70%);
      filter: blur(20px); opacity: 0.9;
    }

    .pf-erd-head { position: relative; display: flex; align-items: flex-start; gap: 12px; }
    .pf-erd-icon {
      flex-shrink: 0; width: 38px; height: 38px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(236, 72, 153, 0.12));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: var(--violet-text);
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.25), 0 0 0 4px rgba(124, 58, 237, 0.06);
    }
    .pf-erd-head-text { flex: 1; min-width: 0; }
    .pf-erd-title {
      margin: 0; font-size: 16px; font-weight: 600;
      line-height: 1.35; letter-spacing: -0.011em; color: var(--text-primary);
    }
    .pf-erd-sub {
      margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary);
    }
    .pf-erd-close {
      flex-shrink: 0; width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9px; border: 1px solid var(--glass-border);
      background: transparent; color: var(--text-tertiary); cursor: pointer;
    }
    .pf-erd-close:hover { color: var(--text-primary); }

    .pf-erd-body { flex: 1; min-height: 0; overflow-y: auto; margin-top: 16px; }
    .pf-erd-loading { display: flex; justify-content: center; padding: 26px 0; }
    .pf-erd-empty { font-size: 13px; color: var(--text-tertiary); padding: 14px 0; }

    .pf-erd-warn {
      display: flex; align-items: flex-start; gap: 8px;
      margin: 0 0 12px;
      padding: 9px 11px;
      border-radius: 10px;
      font-size: 12px; line-height: 1.5;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.32);
      color: #fcd34d;
    }
    .pf-erd-warn svg { flex-shrink: 0; margin-top: 1px; }

    .pf-erd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-erd-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.09));
    }
    .pf-erd-row--off { opacity: 0.55; }

    .pf-erd-pick { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .pf-erd-row--off .pf-erd-pick { cursor: not-allowed; }
    .pf-erd-pick input { margin-top: 3px; flex-shrink: 0; }
    .pf-erd-dept { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-erd-dept-name {
      font-size: 13px; font-weight: 700; color: var(--text-primary);
      display: flex; align-items: center; gap: 6px;
    }
    .pf-erd-code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em;
      padding: 1px 5px; border-radius: 5px;
      background: rgba(168, 85, 247, 0.14);
      border: 1px solid rgba(168, 85, 247, 0.28);
      color: #c4b5fd;
    }
    .pf-erd-tests {
      font-size: 11.5px; color: var(--text-tertiary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-erd-note { font-size: 11px; color: var(--text-muted, rgba(255,255,255,0.45)); font-style: italic; }

    .pf-erd-tech { flex-shrink: 0; display: flex; flex-direction: column; gap: 3px; width: 170px; }
    .pf-erd-tech-lbl {
      font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-erd-select { width: 100%; font-size: 12.5px; padding: 6px 8px; }

    .pf-erd-reason { display: flex; flex-direction: column; gap: 5px; margin-top: 14px; }
    .pf-erd-reason-lbl {
      font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
      color: var(--text-secondary);
    }
    .pf-erd-textarea { width: 100%; resize: vertical; font-size: 13px; }

    .pf-erd-actions {
      flex-shrink: 0; margin-top: 16px; padding-top: 14px;
      border-top: 1px solid var(--glass-border);
      display: flex; justify-content: flex-end; gap: 8px;
    }

    @keyframes pf-erd-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-erd-pop {
      from { opacity: 0; transform: translateY(10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-erd-backdrop, .pf-erd-card { animation: none; }
    }

    /* Phone: the row stacks so the tech picker keeps a usable width at 360px. */
    @media (max-width: 560px) {
      .pf-erd-root { padding: 12px; }
      .pf-erd-card { padding: 18px 16px 14px; border-radius: 18px; }
      .pf-erd-row { flex-direction: column; align-items: stretch; gap: 9px; }
      .pf-erd-tech { width: 100%; }
      .pf-erd-actions { flex-direction: column-reverse; }
      .pf-erd-actions pf-touch-btn { width: 100%; }
    }
  `]
})
export class EditResultDialogComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  /** The order whose results are being corrected. */
  readonly orderId = input.required<string>();
  readonly title = input('Edit result');

  /** Emits the number of results re-opened. */
  readonly edited = output<number>();
  readonly closed = output<void>();

  private readonly _plan = signal<EditPlan | null>(null);
  readonly plan = this._plan.asReadonly();
  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();
  /** Skeleton held >= MIN_LOAD_MS (shared/utils/min-duration) so a fast
   *  load never flashes it. */
  readonly loadingShown = heldFlag(this.loading);
  private readonly _loadError = signal<string | null>(null);
  readonly loadError = this._loadError.asReadonly();
  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  readonly reason = signal('');

  /** departmentId → checked. Seeded to every editable department on load. */
  private readonly _checked = signal<Record<string, boolean>>({});
  /** departmentId → chosen technician id (overrides the performer default). */
  private readonly _assignee = signal<Record<string, string>>({});

  readonly canConfirm = computed(() => {
    if (this._saving() || this._loading()) return false;
    if (!this.reason().trim()) return false;
    const checked = this._checked();
    return Object.values(checked).some(Boolean);
  });

  constructor() {
    // Re-fetch whenever the host points the dialog at a different order.
    effect(() => {
      const id = this.orderId();
      if (id) void this.load(id);
    });
  }

  private async load(orderId: string) {
    this._loading.set(true);
    this._loadError.set(null);
    this.api.get<EditPlan>(`/api/results/edit-plan/${orderId}`).subscribe({
      next: p => {
        this._plan.set(p);
        // Default: every department that HAS something to correct is selected.
        const checked: Record<string, boolean> = {};
        const assignee: Record<string, string> = {};
        for (const d of p.departments ?? []) {
          checked[d.departmentId] = d.editableCount > 0;
          assignee[d.departmentId] = d.performerId ?? '';
        }
        this._checked.set(checked);
        this._assignee.set(assignee);
        this._loading.set(false);
      },
      error: e => {
        this._loading.set(false);
        this._loadError.set(ApiError.from(e).message || 'Could not load the order.');
      }
    });
  }

  isChecked(deptId: string): boolean { return this._checked()[deptId] === true; }

  toggle(deptId: string, on: boolean) {
    this._checked.update(m => ({ ...m, [deptId]: on }));
  }

  assigneeFor(d: EditPlanDept): string {
    return this._assignee()[d.departmentId] ?? d.performerId ?? '';
  }

  setAssignee(deptId: string, userId: string) {
    this._assignee.update(m => ({ ...m, [deptId]: userId }));
  }

  /** "CBC, ESR" — compact, with an overflow count rather than a long wrap. */
  testsLabel(d: EditPlanDept): string {
    const names = (d.tests ?? []).filter(Boolean);
    if (names.length === 0) return `${d.testCount} test${d.testCount === 1 ? '' : 's'}`;
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }

  confirm() {
    if (!this.canConfirm()) return;
    const plan = this._plan();
    if (!plan) return;

    const checked = this._checked();
    const assignee = this._assignee();
    const departments = (plan.departments ?? [])
      .filter(d => checked[d.departmentId] && d.editableCount > 0)
      .map(d => ({
        departmentId: d.departmentId,
        // Blank means "no explicit pick" — the backend falls back to whoever
        // performed it, so send null rather than an empty string.
        assignToUserId: (assignee[d.departmentId] || d.performerId) || null
      }));

    if (departments.length === 0) return;

    this._saving.set(true);
    this.api.post<{ reopened: number }>('/api/results/request-edit', {
      orderId: plan.orderId,
      reason: this.reason().trim(),
      departments
    }).subscribe({
      next: res => {
        this._saving.set(false);
        const n = res?.reopened ?? 0;
        this.toasts.success(`${n} result${n === 1 ? '' : 's'} sent back for correction`);
        this.edited.emit(n);
        this.closed.emit();
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  close() {
    if (this._saving()) return;
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.close(); }
}
