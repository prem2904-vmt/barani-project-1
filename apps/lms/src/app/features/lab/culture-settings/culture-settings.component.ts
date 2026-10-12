import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';

/** Band pill tabs — one per section card. */
export type CultureSettingsTab = 'lock' | 'tat';

interface StageTat { stageKey: string; tatHours: number; }
interface MicroSettings { lockTimeoutMinutes: number; allowSupervisorTakeover: boolean; stageTats: StageTat[]; }

const STAGE_LABELS: Record<string, string> = {
  gram: 'Gram / Direct smear',
  growth: 'Growth check',
  identification: 'Organism identification',
  ast: 'Antibiotic sensitivity',
};

/**
 * Microbiology / Culture settings — the culture bench's stage soft-lock timeout,
 * the supervisor-takeover switch, and per-stage turnaround targets that drive the
 * overdue alerts. Kit cards (pf-card) with the icon-chip header; slate switch; kit fields.
 */
@Component({
  selector: 'pf-culture-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, HeroBandComponent, SegmentedComponent, BusyDirective, SkeletonFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-3xl mx-auto w-full">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): no search — the two cards become tabs in a
             tabs-only pill; Save rides the band actions. -->
        <pf-hero-band [back]="true" backTo="/lab/settings" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()"
                          (valueChange)="tab.set($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving() || formSkeleton()"
                    [pfBusy]="saving()" pfBusyLabel="Saving…"
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
        eyebrow="Lab · Microbiology" title="Culture settings"
        subtitle="Stage lock + turnaround for the culture bench"
        parentRoute="/lab/settings">
        <div actions>
          <button type="button" class="pf-cs__save press" [disabled]="saving() || formSkeleton()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-band-narrow">
      @if (formSkeleton()) {
        <!-- Settings on their way: the card's fields as a skeleton (held
             600ms) — never the defaults dressed up as the saved values. -->
        <section class="pf-card pf-cs__card">
          <div class="pf-cs__body"><pf-skeleton-form [fields]="3" [cols]="1" label="Loading culture settings…"></pf-skeleton-form></div>
        </section>
      }
      @if (showSec('lock') && !formSkeleton()) {
      <section class="pf-card pf-cs__card">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
          <h3 class="pf-card__label pf-cs__title">Stage lock</h3>
        </div>
        <div class="pf-cs__body">
          <p class="pf-cs__hint">When a tech picks up a stage it's locked to them. If it sits idle this long,
            it's auto-released back to the pool so an absent tech never strands a case. Set 0 to never auto-release.</p>
          <div class="pf-cs__row">
            <label class="pf-cs__lbl" for="pf-cs-lock">Auto-release after</label>
            <input id="pf-cs-lock" type="number" min="0" max="1440" inputmode="numeric" class="pf-input pf-num pf-cs__num" [(ngModel)]="lockTimeoutMinutes" />
            <span class="pf-cs__lbl">minutes idle</span>
          </div>
          <button type="button" class="pf-toggle pf-cs__check" role="switch" [attr.aria-checked]="allowSupervisorTakeover"
                  (click)="allowSupervisorTakeover = !allowSupervisorTakeover">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            <span>Allow a supervisor to force-release a stage another tech holds</span>
          </button>
        </div>
      </section>
      }

      @if (showSec('tat') && !formSkeleton()) {
      <section class="pf-card pf-cs__card">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
          <h3 class="pf-card__label pf-cs__title">Turnaround targets</h3>
        </div>
        <div class="pf-cs__body">
          <p class="pf-cs__hint">Each stage raises an "overdue" alert once it runs past its target.</p>
          @for (t of stageTats(); track t.stageKey) {
            <div class="pf-cs__row">
              <label class="pf-cs__lbl pf-cs__lbl--wide" [attr.for]="'pf-cs-tat-' + t.stageKey">{{ label(t.stageKey) }}</label>
              <input [id]="'pf-cs-tat-' + t.stageKey" type="number" min="1" max="336" inputmode="numeric" class="pf-input pf-num pf-cs__num"
                     [ngModel]="t.tatHours" (ngModelChange)="setTat(t.stageKey, $event)" />
              <span class="pf-cs__lbl">hours</span>
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
    .pf-cs__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; color: #fff;
      background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-cs__save:disabled { opacity: .5; cursor: default; }
    .pf-cs__card { margin-bottom: 16px; }
    .pf-cs__title { margin: 0; }
    .pf-cs__body { padding: 16px 18px 18px; }
    .pf-cs__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; text-wrap: pretty; }
    .pf-cs__row { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    .pf-cs__lbl { font-size: 13px; color: var(--text-secondary); }
    .pf-cs__lbl--wide { min-width: 190px; }
    .pf-cs__num { width: 96px; text-align: right; }
    .pf-cs__check { margin-top: 16px; font-size: 13px; white-space: normal; text-align: left; min-height: 32px; }
  `],
})
export class CultureSettingsComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  /** Band pill tabs (new design). Classic shows both cards, as before. */
  readonly tabOptions: SegmentedOption<CultureSettingsTab>[] = [
    { value: 'lock', label: 'Stage lock' },
    { value: 'tat', label: 'Turnaround' },
  ];
  readonly tab = signal<CultureSettingsTab>('lock');
  showSec(key: CultureSettingsTab): boolean {
    return !this.theme.isNewDesign() || this.tab() === key;
  }

  lockTimeoutMinutes = 60;
  allowSupervisorTakeover = true;
  readonly stageTats = signal<StageTat[]>([]);
  readonly saving = signal(false);
  /** First-load skeleton (PF-PATTERN "Loading feedback"). */
  private readonly loadHold = createLoadHold(true);
  readonly formSkeleton = this.loadHold.active;

  constructor() {
    this.api.get<MicroSettings>('/api/microbiology/settings').subscribe({
      next: s => {
        this.loadHold.done();
        if (!s) return;
        this.lockTimeoutMinutes = s.lockTimeoutMinutes ?? 60;
        this.allowSupervisorTakeover = s.allowSupervisorTakeover ?? true;
        this.stageTats.set(s.stageTats ?? []);
      },
      error: () => { this.loadHold.done(); /* defaults */ },
      complete: () => this.loadHold.done(),
    });
  }

  label(key: string): string { return STAGE_LABELS[key] ?? key; }

  setTat(key: string, hours: number) {
    const n = Math.max(1, Math.round(Number(hours) || 1));
    this.stageTats.update(list => list.map(t => t.stageKey === key ? { ...t, tatHours: n } : t));
  }

  save() {
    if (this.saving()) return;
    this.saving.set(true);
    const body: MicroSettings = {
      lockTimeoutMinutes: Math.max(0, Math.round(Number(this.lockTimeoutMinutes) || 0)),
      allowSupervisorTakeover: this.allowSupervisorTakeover,
      stageTats: this.stageTats(),
    };
    this.api.put('/api/microbiology/settings', body).subscribe({
      next: () => { this.saving.set(false); this.toasts.success('Culture settings saved'); },
      error: () => { this.saving.set(false); this.toasts.error('Could not save settings'); },
    });
  }
}
