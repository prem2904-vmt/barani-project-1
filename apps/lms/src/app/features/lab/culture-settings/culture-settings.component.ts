import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
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
 * overdue alerts. Mirrors the Lab/OPD settings pattern (pf-tile cards).
 */
@Component({
  selector: 'pf-culture-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, TileComponent, HeroBandComponent, SegmentedComponent],
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
        eyebrow="Lab · Microbiology" title="Culture settings"
        subtitle="Stage lock + turnaround for the culture bench"
        parentRoute="/lab/settings">
        <div actions>
          <button type="button" class="pf-cs__save press" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-band-narrow">
      @if (showSec('lock')) {
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-cs__title">Stage lock</h3>
        <p class="pf-cs__hint">When a tech picks up a stage it's locked to them. If it sits idle this long,
          it's auto-released back to the pool so an absent tech never strands a case. Set 0 to never auto-release.</p>
        <div class="pf-cs__row">
          <span class="pf-cs__lbl">Auto-release after</span>
          <input type="number" min="0" max="1440" class="pf-cs__num" [(ngModel)]="lockTimeoutMinutes" />
          <span class="pf-cs__lbl">minutes idle</span>
        </div>
        <label class="pf-cs__check">
          <input type="checkbox" [(ngModel)]="allowSupervisorTakeover" />
          <span>Allow a supervisor to force-release a stage another tech holds</span>
        </label>
      </pf-tile>

      }

      @if (showSec('tat')) {
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-cs__title">Turnaround targets</h3>
        <p class="pf-cs__hint">Each stage raises an "overdue" alert once it runs past its target.</p>
        @for (t of stageTats(); track t.stageKey) {
          <div class="pf-cs__row">
            <span class="pf-cs__lbl pf-cs__lbl--wide">{{ label(t.stageKey) }}</span>
            <input type="number" min="1" max="336" class="pf-cs__num"
                   [ngModel]="t.tatHours" (ngModelChange)="setTat(t.stageKey, $event)" />
            <span class="pf-cs__lbl">hours</span>
          </div>
        }
      </pf-tile>
      }
      </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-cs__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; color: #fff;
      background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-cs__save:disabled { opacity: .5; cursor: default; }
    .pf-cs__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-cs__hint { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-cs__row { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    .pf-cs__lbl { font-size: 13px; color: var(--text-secondary); }
    .pf-cs__lbl--wide { min-width: 190px; }
    .pf-cs__num { width: 84px; padding: 7px 9px; border-radius: 8px; font-size: 14px; text-align: right;
      color: var(--text-primary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cs__check { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
    .pf-cs__check input { margin-top: 2px; }
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

  constructor() {
    this.api.get<MicroSettings>('/api/microbiology/settings').subscribe({
      next: s => {
        if (!s) return;
        this.lockTimeoutMinutes = s.lockTimeoutMinutes ?? 60;
        this.allowSupervisorTakeover = s.allowSupervisorTakeover ?? true;
        this.stageTats.set(s.stageTats ?? []);
      },
      error: () => { /* defaults */ },
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
