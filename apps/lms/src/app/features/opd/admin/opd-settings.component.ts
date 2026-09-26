import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';
import { SettingAnchorDirective } from '../../../shared/components/settings-page/setting-anchor.directive';

type FollowUpMode = 'off' | 'auto' | 'assisted';
interface FollowUpTier { withinDays: number; discountPercent: number; }
interface OpdSettings { followUpMode: FollowUpMode; tiers: FollowUpTier[]; }

/**
 * OPD → Settings: the follow-up policy (OPD build). ONE page (ND-PATTERN §19):
 * the mode is a `.nd-set` row with a segmented radiogroup (anchor `follow-up`).
 * A repeat consult with the SAME doctor within a tier's window gets that tier's
 * discount; modes: Off / Automatic (auto-apply) / Assisted (a ceiling). Tiered.
 */
@Component({
  selector: 'pf-opd-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, HeroBandComponent, SegmentedComponent, SettingAnchorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- ND-PATTERN §19: one page, no pill switch; the pill names the page;
             the follow-up mode is a row in the body; Save rides the band. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <h1 class="nd-band-page">OPD settings</h1>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving()"
                    (click)="save()" aria-label="Save changes" title="Save changes">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <path d="M17 21v-8H7v8M7 3v5h8"/>
              </svg>
              {{ saving() ? 'Saving…' : 'Save changes' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="OPD" title="OPD Settings" subtitle="Follow-up discount for repeat visits"
        parentRoute="/admin/opd">
        <div actions>
          <button type="button" class="pf-os__save press" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="nd-setpage">
      <div class="nd-setcol">
      <section class="nd-card nd-setsec" id="sec-follow-up" aria-labelledby="pf-os-h-fu">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg></span>
          <h2 class="nd-card__label pf-os__title" id="pf-os-h-fu">Follow-up</h2>
        </div>
        <div class="nd-set" pfSettingAnchor="follow-up">
          <div class="nd-set__text">
            <p class="nd-set__label" id="pf-os-mode-l">Follow-up discount</p>
            <p class="nd-set__help pf-os__modehint" role="status">{{ modeDesc() }}</p>
          </div>
          <div class="nd-set__ctl">
            <pf-segmented size="sm" [options]="modeOptions" [value]="mode()" ariaLabelledby="pf-os-mode-l"
                          (valueChange)="mode.set($event)"></pf-segmented>
          </div>
        </div>
      </section>

      @if (mode() !== 'off') {
        <section class="nd-card nd-setsec pf-os__card" id="sec-tiers" aria-labelledby="pf-os-h-tiers">
          <div class="nd-card__head pf-os__row-head">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82z"/><circle cx="7.5" cy="7.5" r="1.25"/></svg></span>
            <h2 class="nd-card__label pf-os__title" id="pf-os-h-tiers">Tiers</h2>
            <span class="nd-card__spacer"></span>
            <button type="button" class="nd-btn nd-btn--tertiary pf-os__add press" (click)="addTier()">+ Add tier</button>
          </div>
          <div class="nd-set">
            <div class="nd-set__text">
              <p class="nd-set__label">Discount by days since last visit</p>
              <p class="nd-set__help">The shortest matching window wins.</p>
            </div>
          </div>
          @if (tiers().length === 0) {
            <div class="nd-set"><p class="nd-set__help">No tiers yet. Add one.</p></div>
          }
          @for (t of tiers(); track $index) {
            <div class="nd-set nd-set--sub pf-os__tier">
              <span class="pf-os__tier-txt">Within</span>
              <input type="number" min="1" inputmode="numeric" class="nd-input nd-num pf-os__num" [ngModel]="t.withinDays"
                     (ngModelChange)="setTier($index, 'withinDays', $event)" [attr.aria-label]="'Tier ' + ($index + 1) + ': within days'" />
              <span class="pf-os__tier-txt">days</span>
              <input type="number" min="0" max="100" inputmode="numeric" class="nd-input nd-num pf-os__num" [ngModel]="t.discountPercent"
                     (ngModelChange)="setTier($index, 'discountPercent', $event)" [attr.aria-label]="'Tier ' + ($index + 1) + ': discount percent'" />
              <span class="pf-os__tier-txt">% {{ mode() === 'assisted' ? 'max' : 'off' }}</span>
              <button type="button" class="pf-os__del press" (click)="removeTier($index)" [attr.aria-label]="'Remove tier ' + ($index + 1)" title="Remove tier">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          }
        </section>
      }
      </div>
      </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-os__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700;
      color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-os__save:disabled { opacity: .5; cursor: default; }
    .pf-os__title { margin: 0; }
    .pf-os__add { height: 36px; min-height: 36px; }
    .pf-os__tier { gap: 8px; flex-wrap: wrap; }
    .pf-os__tier-txt { font-size: 13px; color: var(--text-secondary); }
    .pf-os__num { width: 84px; text-align: right; }
    .pf-os__del { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px;
      border-radius: 8px; cursor: pointer; color: var(--text-tertiary); background: transparent; border: 1px solid transparent; }
    .pf-os__del:hover { color: var(--red-text, #b91c1c); border-color: var(--nd-line); }
    .pf-os__del:focus-visible, .pf-os__add:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    @media (pointer: coarse) { .pf-os__del, .pf-os__add { width: 44px; height: 44px; min-height: 44px; } .pf-os__add { width: auto; } }
  `],
})
export class OpdSettingsComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly MODES: { value: FollowUpMode; label: string; desc: string }[] = [
    { value: 'off', label: 'Off', desc: 'Every visit pays the full fee.' },
    { value: 'auto', label: 'Automatic', desc: 'The tier discount is applied by itself.' },
    { value: 'assisted', label: 'Assisted', desc: 'Front desk can give up to the tier discount.' },
  ];
  readonly mode = signal<FollowUpMode>('off');
  protected readonly theme = inject(ThemeService);
  /** The follow-up mode segmented control (Off / Automatic / Assisted). */
  readonly modeOptions: SegmentedOption<FollowUpMode>[] = this.MODES.map((m) => ({ value: m.value, label: m.label, hint: m.desc }));
  readonly modeLabel = computed(() => this.MODES.find((m) => m.value === this.mode())?.label ?? '');
  readonly modeDesc = computed(() => this.MODES.find((m) => m.value === this.mode())?.desc ?? '');
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
