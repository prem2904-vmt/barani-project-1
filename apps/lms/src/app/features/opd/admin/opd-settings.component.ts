import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';

type FollowUpMode = 'off' | 'auto' | 'assisted';
interface FollowUpTier { withinDays: number; discountPercent: number; }
interface OpdSettings { followUpMode: FollowUpMode; tiers: FollowUpTier[]; }

/**
 * OPD → Settings: the follow-up policy (OPD build). Mirrors the Lab Settings
 * page pattern (pf-tile cards + the radio-card "gate") so the theme matches.
 * A repeat consult with the SAME doctor within a tier's window gets that tier's
 * discount; modes: Off / Automatic (auto-apply) / Assisted (a ceiling). Tiered.
 */
@Component({
  selector: 'pf-opd-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, TileComponent],
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

      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-os__title">Follow-up mode</h3>
        <p class="pf-os__hint">
          When a patient returns to the same doctor within a tier's window, apply that tier's discount.
        </p>
        <div class="pf-os__gate">
          @for (m of MODES; track m.value) {
            <button type="button" class="pf-os__gate-opt" [class.pf-os__gate-opt--on]="mode() === m.value"
                    (click)="mode.set(m.value)">
              <span class="pf-os__gate-radio"></span>
              <span class="pf-os__gate-text">
                <span class="pf-os__gate-t">{{ m.label }}</span>
                <span class="pf-os__gate-s">{{ m.desc }}</span>
              </span>
            </button>
          }
        </div>
      </pf-tile>

      @if (mode() !== 'off') {
        <pf-tile tone="default" padding="lg" class="block mb-5">
          <div class="pf-os__row-head">
            <h3 class="pf-os__title">Tiers</h3>
            <button type="button" class="pf-os__add press" (click)="addTier()">+ Add tier</button>
          </div>
          <p class="pf-os__hint">The tightest matching window applies. E.g. within 7 days → 100% off, within 30 days → 50% off.</p>

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
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-os__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700;
      color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-os__save:disabled { opacity: .5; cursor: default; }

    /* Card title/hint + radio-card gate — copied from the Lab Settings page. */
    .pf-os__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-os__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-os__gate { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .pf-os__gate-opt { display: flex; align-items: flex-start; gap: 12px; text-align: left; padding: 12px 14px;
      border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); cursor: pointer;
      transition: border-color .15s ease, background .15s ease; }
    .pf-os__gate-opt:hover { border-color: rgba(124,58,237,0.4); }
    .pf-os__gate-opt--on { border-color: rgba(124,58,237,0.6); background: rgba(124,58,237,0.06); }
    .pf-os__gate-radio { flex-shrink: 0; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%;
      border: 2px solid var(--border-input, #cbd5e1); position: relative; transition: border-color .15s ease; }
    .pf-os__gate-opt--on .pf-os__gate-radio { border-color: var(--color-violet-500, #7c3aed); }
    .pf-os__gate-opt--on .pf-os__gate-radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--color-violet-500, #7c3aed); }
    .pf-os__gate-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-os__gate-t { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-os__gate-s { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }

    .pf-os__row-head { display: flex; align-items: center; justify-content: space-between; }
    .pf-os__muted { margin-top: 10px; font-size: 13px; color: var(--text-tertiary); }
    .pf-os__add { padding: 6px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--color-violet-500, #7c3aed); background: transparent; border: 1px solid rgba(124,58,237,.35); }
    .pf-os__tier { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .pf-os__tier-txt { font-size: 13px; color: var(--text-secondary); }
    .pf-os__num { width: 74px; padding: 7px 9px; border-radius: 8px; font-size: 14px; text-align: right;
      color: var(--text-primary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-os__del { margin-left: auto; width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 17px;
      color: var(--text-secondary); background: transparent; border: 1px solid var(--glass-border); }
  `],
})
export class OpdSettingsComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly MODES: { value: FollowUpMode; label: string; desc: string }[] = [
    { value: 'off', label: 'Off', desc: 'No follow-up discount — every visit is billed at the full consultation fee.' },
    { value: 'auto', label: 'Automatic', desc: 'The matching tier’s discount is applied automatically when the consult is billed.' },
    { value: 'assisted', label: 'Assisted', desc: 'The matching tier’s discount is a ceiling — the front desk applies any amount up to it.' },
  ];
  readonly mode = signal<FollowUpMode>('off');
  readonly tiers = signal<FollowUpTier[]>([]);
  readonly saving = signal(false);

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
