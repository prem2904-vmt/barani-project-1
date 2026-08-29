import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';

type FollowUpMode = 'off' | 'auto' | 'assisted';
interface FollowUpTier { withinDays: number; discountPercent: number; }
interface OpdSettings { followUpMode: FollowUpMode; tiers: FollowUpTier[]; }

/**
 * OPD → Settings: the follow-up policy (OPD build). A repeat consultation with
 * the SAME doctor within a tier's window gets that tier's discount. Three modes:
 * Off / Automatic (auto-apply the %) / Assisted (the % is a ceiling the front
 * desk works within). Tiered — multiple (within-days → %) rules.
 */
@Component({
  selector: 'pf-opd-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-3xl mx-auto w-full">
      <pf-screen-header
        eyebrow="OPD" title="OPD Settings" subtitle="Follow-up policy for repeat consultations"
        parentRoute="/admin/opd">
        <div actions>
          <button type="button" class="pf-os__save press" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-os__card">
        <h3 class="pf-os__h">Follow-up mode</h3>
        <div class="pf-os__seg" role="group" aria-label="Follow-up mode">
          @for (m of MODES; track m.value) {
            <button type="button" class="pf-os__seg-btn" [class.pf-os__seg-btn--on]="mode() === m.value"
                    (click)="mode.set(m.value)">{{ m.label }}</button>
          }
        </div>
        <p class="pf-os__desc">{{ modeDesc() }}</p>
      </div>

      @if (mode() !== 'off') {
        <div class="pf-os__card">
          <div class="pf-os__row-head">
            <h3 class="pf-os__h">Tiers</h3>
            <button type="button" class="pf-os__add press" (click)="addTier()">+ Add tier</button>
          </div>
          <p class="pf-os__desc">A repeat visit to the same doctor within the window gets that tier's discount. The tightest matching window applies.</p>

          @if (tiers().length === 0) {
            <p class="pf-os__muted">No tiers yet — add one.</p>
          }
          @for (t of tiers(); track $index) {
            <div class="pf-os__tier">
              <span class="pf-os__tier-txt">Within</span>
              <input type="number" min="1" class="pf-os__num" [ngModel]="t.withinDays"
                     (ngModelChange)="setTier($index, 'withinDays', $event)" />
              <span class="pf-os__tier-txt">days →</span>
              <input type="number" min="0" max="100" class="pf-os__num" [ngModel]="t.discountPercent"
                     (ngModelChange)="setTier($index, 'discountPercent', $event)" />
              <span class="pf-os__tier-txt">% {{ mode() === 'assisted' ? 'max' : 'off' }}</span>
              <button type="button" class="pf-os__del press" (click)="removeTier($index)" aria-label="Remove">×</button>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .pf-os__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700;
      color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-os__save:disabled { opacity: .5; cursor: default; }
    .pf-os__card { margin-top: 14px; padding: 18px; border-radius: 16px;
      background: var(--bg-card, rgba(255,255,255,0.03)); border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); }
    .pf-os__h { font-size: 14px; font-weight: 700; color: var(--text-primary, #f8fafc); }
    .pf-os__seg { display: inline-flex; margin-top: 12px; padding: 4px; border-radius: 12px; gap: 4px;
      background: var(--glass-bg, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border, rgba(255,255,255,0.12)); }
    .pf-os__seg-btn { padding: 8px 18px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary, #cbd5e1); background: transparent; border: 0; }
    .pf-os__seg-btn--on { color: #fff; background: var(--brand, #a855f7); }
    .pf-os__desc { margin-top: 10px; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary, #cbd5e1); }
    .pf-os__muted { margin-top: 10px; font-size: 13px; color: var(--text-tertiary, #64748b); }
    .pf-os__row-head { display: flex; align-items: center; justify-content: space-between; }
    .pf-os__add { padding: 6px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--brand, #a855f7); background: transparent; border: 1px solid rgba(168,85,247,.35); }
    .pf-os__tier { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .pf-os__tier-txt { font-size: 13px; color: var(--text-secondary, #cbd5e1); }
    .pf-os__num { width: 74px; padding: 7px 9px; border-radius: 8px; font-size: 14px; text-align: right;
      color: var(--text-primary, #e2e8f0); background: var(--input-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--input-border, var(--glass-border, rgba(255,255,255,0.14))); }
    .pf-os__del { margin-left: auto; width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 17px;
      color: var(--text-secondary, #94a3b8); background: transparent; border: 1px solid var(--glass-border, rgba(255,255,255,0.14)); }
  `],
})
export class OpdSettingsComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly MODES: { value: FollowUpMode; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'auto', label: 'Automatic' },
    { value: 'assisted', label: 'Assisted' },
  ];
  readonly mode = signal<FollowUpMode>('off');
  readonly tiers = signal<FollowUpTier[]>([]);
  readonly saving = signal(false);

  readonly modeDesc = computed(() => {
    switch (this.mode()) {
      case 'auto': return 'The matching tier’s discount is applied automatically when the consult is billed.';
      case 'assisted': return 'The matching tier’s discount is a ceiling — the front desk applies any amount up to it.';
      default: return 'No follow-up discount — every visit is billed at the full consultation fee.';
    }
  });

  constructor() {
    this.api.get<OpdSettings>('/api/opd/settings').subscribe({
      next: s => { if (s) { this.mode.set(s.followUpMode ?? 'off'); this.tiers.set(s.tiers ?? []); } },
      error: () => { /* defaults: off */ },
    });
  }

  addTier() { this.tiers.update(ts => [...ts, { withinDays: 7, discountPercent: 50 }]); }
  removeTier(i: number) { this.tiers.update(ts => ts.filter((_, idx) => idx !== i)); }
  setTier(i: number, key: keyof FollowUpTier, v: number) {
    const n = Math.max(0, Math.round(Number(v) || 0));
    this.tiers.update(ts => ts.map((t, idx) => idx === i ? { ...t, [key]: key === 'discountPercent' ? Math.min(100, n) : n } : t));
  }

  save() {
    if (this.saving()) return;
    this.saving.set(true);
    const body: OpdSettings = {
      followUpMode: this.mode(),
      tiers: this.mode() === 'off' ? [] : this.tiers().filter(t => t.withinDays > 0),
    };
    this.api.put('/api/opd/settings', body).subscribe({
      next: () => { this.saving.set(false); this.toasts.success('OPD settings saved'); },
      error: () => { this.saving.set(false); this.toasts.error('Could not save settings'); },
    });
  }
}
