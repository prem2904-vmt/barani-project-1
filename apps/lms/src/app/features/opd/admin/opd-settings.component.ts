import { SkelSettingRowsComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { dirtySnapshot } from '../../../shared/utils/dirty-snapshot';
import { NO_CHANGES_TITLE } from '../../../shared/utils/save-state';
import { bindSaveShortcut } from '../../../shared/utils/save-shortcut';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';

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
  imports: [SkelSettingRowsComponent, FormsModule, ScreenHeaderComponent, TileComponent, HeroBandComponent, SegmentedComponent, BusyDirective, SkeletonFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-3xl mx-auto w-full">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): no search — the follow-up MODE is the pill's switch
             (tabs-only pill); tiers sit in the body; Save rides the band. -->
        <pf-hero-band [back]="true" backTo="/admin/opd" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="modeOptions" [value]="mode()"
                          (valueChange)="mode.set($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving() || formSkeleton() || !changed()" [pfBusyInactive]="saving() || formSkeleton() || !changed()"
                    [pfBusy]="saving()" pfBusyLabel="Saving…"
                    (click)="save()" aria-label="Save changes" [title]="changed() || saving() ? 'Save changes' : NO_CHANGES">
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
        eyebrow="OPD" title="OPD Settings" subtitle="Follow-up policy for repeat consultations"
        parentRoute="/admin/opd">
        <div actions>
          <button type="button" class="pf-os__save press" [disabled]="saving() || formSkeleton() || !changed()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()" [pfBusyInactive]="saving() || formSkeleton() || !changed()" [attr.title]="(!changed() && !saving()) ? 'No changes to save' : null">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-band-narrow">
      @if (formSkeleton()) {
        <!-- Settings on their way: a skeleton of the card (held 600ms), never
             the "Off" default dressed up as the saved policy. -->
        <section class="pf-card pf-os__card">
          <pf-skel-setting-rows [rows]="3" label="Loading OPD settings…"></pf-skel-setting-rows>
        </section>
      } @else if (theme.isNewDesign()) {
        <!-- The mode is picked in the pill; its meaning stays readable here. -->
        <p class="pf-os__modehint" role="status">
          <strong>Follow-up: {{ modeLabel() }}.</strong> {{ modeDesc() }}
        </p>
      } @else {
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
      }

      @if (mode() !== 'off' && !formSkeleton()) {
        <section class="pf-card pf-os__card">
          <div class="pf-card__head pf-os__row-head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82z"/><circle cx="7.5" cy="7.5" r="1.25"/></svg></span>
            <h3 class="pf-card__label pf-os__title">Tiers</h3>
            <span class="pf-card__spacer"></span>
            <button type="button" class="pf-btn pf-btn--tertiary pf-os__add press" (click)="addTier()">+ Add tier</button>
          </div>
          <div class="pf-os__body">
            <p class="pf-os__hint">The tightest matching window applies. E.g. within 7 days → 100% off, within 30 days → 50% off.</p>

            @if (tiers().length === 0) {
              <p class="pf-os__muted">No tiers yet — add one.</p>
            }
            @for (t of tiers(); track $index) {
              <div class="pf-row pf-os__tier">
                <span class="pf-os__tier-txt">Within</span>
                <input type="number" min="1" inputmode="numeric" class="pf-input pf-num pf-os__num" [ngModel]="t.withinDays"
                       (ngModelChange)="setTier($index, 'withinDays', $event)" aria-label="Within days" />
                <span class="pf-os__tier-txt">days →</span>
                <input type="number" min="0" max="100" inputmode="numeric" class="pf-input pf-num pf-os__num" [ngModel]="t.discountPercent"
                       (ngModelChange)="setTier($index, 'discountPercent', $event)" aria-label="Discount percent" />
                <span class="pf-os__tier-txt">% {{ mode() === 'assisted' ? 'max' : 'off' }}</span>
                <button type="button" class="pf-os__del press" (click)="removeTier($index)" aria-label="Remove tier" title="Remove tier">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
            }
          </div>
        </section>
      }
      </div>
      </div>
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

    .pf-os__modehint { margin: 0 0 16px; padding: 12px 14px; border-radius: var(--pf-radius); font-size: 13px; line-height: 1.55;
      color: var(--text-secondary); background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    .pf-os__modehint strong { color: var(--text-primary); font-weight: 600; }
    .pf-os__card { margin-bottom: 16px; }
    .pf-os__card .pf-os__title { margin: 0; font-size: 13px; }
    .pf-os__body { padding: 14px 18px 18px; }
    .pf-os__card .pf-os__hint { margin: 0; }
    .pf-os__muted { margin-top: 10px; font-size: 13px; color: var(--text-tertiary); }
    .pf-os__add { height: 36px; min-height: 36px; }
    .pf-os__tier { gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .pf-os__tier-txt { font-size: 13px; color: var(--text-secondary); }
    .pf-os__num { width: 84px; text-align: right; }
    .pf-os__del { margin-left: auto; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px;
      border-radius: 8px; cursor: pointer; color: var(--text-tertiary); background: transparent; border: 1px solid transparent; }
    .pf-os__del:hover { color: var(--red-text, #b91c1c); border-color: var(--pf-line); }
  `],
})
export class OpdSettingsComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly MODES: { value: FollowUpMode; label: string; desc: string }[] = [
    { value: 'off', label: 'Off', desc: 'No clinic-wide rule. A service with its own follow-up rule (set on the service) still applies it.' },
    { value: 'auto', label: 'Automatic', desc: 'The matching tier’s discount is applied automatically when the consult is billed.' },
    { value: 'assisted', label: 'Assisted', desc: 'The matching tier’s discount is a ceiling — the front desk applies any amount up to it.' },
  ];
  readonly mode = signal<FollowUpMode>('off');
  protected readonly theme = inject(ThemeService);
  /** The band pill's switch (new design) — same three modes as the classic radio cards. */
  readonly modeOptions: SegmentedOption<FollowUpMode>[] = this.MODES.map((m) => ({ value: m.value, label: m.label, hint: m.desc }));
  readonly modeLabel = computed(() => this.MODES.find((m) => m.value === this.mode())?.label ?? '');
  readonly modeDesc = computed(() => this.MODES.find((m) => m.value === this.mode())?.desc ?? '');
  readonly tiers = signal<FollowUpTier[]>([]);
  readonly saving = signal(false);
  /** First-load skeleton (PF-PATTERN "Loading feedback"). */
  private readonly loadHold = createLoadHold(true);
  readonly formSkeleton = this.loadHold.active;

  /** Owner 2026-11-19: Save only when the rule differs from what was loaded / last saved. */
  private readonly snap = dirtySnapshot(() => ({ m: this.mode(), t: this.tiers() }));
  readonly changed = this.snap.dirty;
  protected readonly NO_CHANGES = NO_CHANGES_TITLE;
  private readonly _saveKey = bindSaveShortcut({ canSave: () => this.changed() && !this.saving() && !this.formSkeleton(), save: () => this.save() });

  constructor() {
    this.api.get<OpdSettings>('/api/opd/settings').subscribe({
      next: s => { this.loadHold.done(); if (s) { this.mode.set(s.followUpMode ?? 'off'); this.tiers.set(s.tiers ?? []); } this.snap.mark(); },
      error: () => { this.loadHold.done(); this.snap.mark(); /* defaults: off */ },
      complete: () => this.loadHold.done(),
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
      next: () => { this.saving.set(false); this.snap.mark(); this.toasts.success('OPD settings saved'); },
      error: () => { this.saving.set(false); this.toasts.error('Could not save settings'); },
    });
  }
}
