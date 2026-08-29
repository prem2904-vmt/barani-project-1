import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { ConsultDoctor, ConsultDraft } from '../../../shared/opd/consult';

/**
 * OPD consult builder (slice 1 — SHELL). The OPD counterpart to the lab test
 * picker: pick a consulting doctor for this branch, set the consult fee, and
 * (later) add procedures. Self-contained and presentational — it does NOT
 * persist anything yet and imports nothing from the lab feature, so it cannot
 * affect the live lab flow. A later slice turns the emitted draft into an
 * Order(Module='opd') and fills in the procedures catalog.
 */
@Component({
  selector: 'pf-consult-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-cb">
      <header class="pf-cb__head">
        <h3 class="pf-cb__title">New consultation</h3>
        @if (patientName) { <p class="pf-cb__patient">for {{ patientName }}</p> }
      </header>

      <!-- Doctor -->
      <label class="pf-cb__field">
        <span class="pf-cb__label">Consulting doctor</span>
        <select class="pf-cb__input" [value]="doctorId() ?? ''"
                (change)="onDoctor($any($event.target).value)">
          <option value="" disabled>Select a doctor…</option>
          @for (d of doctors; track d.id) {
            <option [value]="d.id">{{ d.name }}{{ d.department ? ' · ' + d.department : '' }}</option>
          }
        </select>
        @if (doctors.length === 0) {
          <span class="pf-cb__hint">No doctors onboarded for this branch yet.</span>
        }
      </label>

      <!-- Consult fee -->
      <label class="pf-cb__field">
        <span class="pf-cb__label">Consultation fee (₹)</span>
        <input type="number" min="0" class="pf-cb__input" [value]="fee()"
               (input)="onFee($any($event.target).value)" />
      </label>

      <!-- Procedures — placeholder step (catalog arrives later) -->
      <div class="pf-cb__field pf-cb__procedures" aria-disabled="true">
        <span class="pf-cb__label">Procedures</span>
        <div class="pf-cb__placeholder">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>
          </svg>
          <span>Procedures coming soon</span>
        </div>
      </div>

      <footer class="pf-cb__foot">
        <button type="button" class="pf-cb__submit press" [disabled]="!canSubmit()" (click)="submit()">
          Add consultation
        </button>
      </footer>
    </section>
  `,
  styles: [`
    .pf-cb { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px; }
    .pf-cb__head { display: flex; align-items: baseline; gap: 8px; }
    .pf-cb__title { font-size: 15px; font-weight: 700; color: var(--text-primary, #e2e8f0); }
    .pf-cb__patient { font-size: 12.5px; color: var(--text-tertiary, #94a3b8); }
    .pf-cb__field { display: flex; flex-direction: column; gap: 6px; }
    .pf-cb__label { font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .04em; color: var(--text-tertiary, #64748b); }
    .pf-cb__input { padding: 9px 11px; border-radius: 10px; font-size: 14px;
      color: var(--text-primary, #e2e8f0); background: var(--glass-bg, rgba(255,255,255,0.05));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.14)); }
    .pf-cb__hint { font-size: 12px; color: var(--text-tertiary, #64748b); }
    .pf-cb__placeholder { display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-radius: 10px; font-size: 13px; font-weight: 600;
      color: var(--text-tertiary, #64748b); background: rgba(148,163,184,0.08);
      border: 1px dashed var(--glass-border, rgba(255,255,255,0.16)); }
    .pf-cb__foot { display: flex; justify-content: flex-end; }
    .pf-cb__submit { padding: 9px 18px; border-radius: 10px; font-size: 13.5px; font-weight: 700;
      color: #fff; background: var(--brand, #a855f7); border: 1px solid transparent; cursor: pointer; }
    .pf-cb__submit:disabled { opacity: .55; cursor: default; }
  `],
})
export class ConsultBuilderComponent {
  /** Doctors pickable at the current branch (provided by the host; empty = none). */
  @Input() doctors: ConsultDoctor[] = [];
  /** Optional patient name for the header. */
  @Input() patientName?: string | null;
  /** Emitted when the user adds the consultation. Not persisted yet. */
  @Output() added = new EventEmitter<ConsultDraft>();

  readonly doctorId = signal<string | null>(null);
  readonly fee = signal<number>(0);

  readonly canSubmit = computed(() => !!this.doctorId());

  onDoctor(id: string) { this.doctorId.set(id || null); }
  onFee(raw: string) {
    const n = Number(raw);
    this.fee.set(Number.isFinite(n) && n >= 0 ? n : 0);
  }

  submit() {
    if (!this.canSubmit()) return;
    const id = this.doctorId();
    const doc = this.doctors.find(d => d.id === id) ?? null;
    this.added.emit({
      doctorId: id,
      doctorName: doc?.name ?? null,
      fee: this.fee(),
      procedures: [],
    });
  }
}
