import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';

interface DoctorRow {
  id: string;
  name: string;
  department?: string | null;
  specializations: string[];
  regNo?: string | null;
  fee: number;
}

/**
 * OPD → Doctors (admin). A Test-Master-style grid of the tenant's doctors with
 * an editable per-doctor consultation fee. The fee is per doctor (a specialist
 * and a junior charge differently); it auto-fills the consult screen when the
 * front desk picks that doctor. Batch-edits fees inline and saves the changed
 * rows via PATCH /api/doctors/{id}.
 */
@Component({
  selector: 'pf-doctors-admin',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <pf-screen-header class="px-4 md:px-8 pt-6"
        [eyebrow]="'OPD'" [title]="'Doctors'" [subtitle]="'Consultation fee per doctor'"
        parentRoute="/admin/opd">
        <div actions>
          <button type="button" class="pf-da__save press" [disabled]="!dirty() || saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="px-4 md:px-8 lg:px-10 max-w-screen-xl mx-auto w-full">
        @if (loading()) {
          <p class="pf-da__muted">Loading doctors…</p>
        } @else if (rows().length === 0) {
          <div class="pf-da__empty">
            <p>No doctors yet.</p>
            <p class="pf-da__muted">Create a user with a Doctor-type role — they'll appear here.</p>
          </div>
        } @else {
          <div class="pf-da__table" role="table">
            <div class="pf-da__row pf-da__row--head" role="row">
              <span>Doctor</span><span>Department</span><span>Specialisation</span><span class="pf-da__fee-h">Consultation fee (₹)</span>
            </div>
            @for (r of rows(); track r.id) {
              <div class="pf-da__row" role="row">
                <span class="pf-da__name">{{ r.name }}</span>
                <span class="pf-da__muted">{{ r.department || '—' }}</span>
                <span class="pf-da__muted">{{ r.specializations.length ? r.specializations.join(', ') : '—' }}</span>
                <span>
                  <input type="number" min="0" class="pf-da__fee"
                         [ngModel]="r.fee" (ngModelChange)="setFee(r.id, $event)" />
                </span>
              </div>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .pf-da__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700;
      color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-da__save:disabled { opacity: .5; cursor: default; }
    .pf-da__muted { color: var(--text-tertiary, #64748b); font-size: 13px; }
    .pf-da__empty { padding: 32px; text-align: center; border-radius: 14px;
      border: 1px dashed var(--glass-border, rgba(255,255,255,0.14)); }
    .pf-da__table { margin-top: 12px; border-radius: 14px; overflow: hidden;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); }
    .pf-da__row { display: grid; grid-template-columns: 1.4fr 1fr 1.6fr 160px; gap: 12px;
      align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--glass-border, rgba(255,255,255,0.06)); }
    .pf-da__row:last-child { border-bottom: 0; }
    .pf-da__row--head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      color: var(--text-tertiary, #64748b); background: rgba(148,163,184,0.06); }
    .pf-da__fee-h { text-align: right; }
    .pf-da__name { font-weight: 600; color: var(--text-primary, #e2e8f0); }
    .pf-da__fee { width: 100%; padding: 8px 10px; border-radius: 8px; text-align: right; font-size: 14px;
      color: var(--text-primary, #e2e8f0); background: var(--input-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--input-border, var(--glass-border, rgba(255,255,255,0.14))); }
  `],
})
export class DoctorsAdminComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly rows = signal<DoctorRow[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  private readonly _dirty = signal<Set<string>>(new Set());
  readonly dirty = computed(() => this._dirty().size > 0);

  constructor() {
    this.api.get<DoctorRow[]>('/api/doctors').subscribe({
      next: docs => { this.rows.set((docs ?? []).map(d => ({ ...d, fee: d.fee ?? 0 }))); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toasts.error('Could not load doctors'); },
    });
  }

  setFee(id: string, v: number) {
    const n = Number(v);
    const fee = Number.isFinite(n) && n >= 0 ? n : 0;
    this.rows.update(rs => rs.map(r => r.id === id ? { ...r, fee } : r));
    this._dirty.update(s => new Set(s).add(id));
  }

  save() {
    const changed = this.rows().filter(r => this._dirty().has(r.id));
    if (!changed.length || this.saving()) return;
    this.saving.set(true);
    let done = 0, failed = 0;
    for (const r of changed) {
      this.api.patch(`/api/doctors/${r.id}`, { fee: r.fee }).subscribe({
        next: () => { if (++done + failed === changed.length) this.finishSave(failed); },
        error: () => { failed++; if (done + failed === changed.length) this.finishSave(failed); },
      });
    }
  }
  private finishSave(failed: number) {
    this.saving.set(false);
    this._dirty.set(new Set());
    if (failed) this.toasts.error(`${failed} fee(s) failed to save`);
    else this.toasts.success('Fees saved');
  }
}
