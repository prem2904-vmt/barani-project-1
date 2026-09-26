import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SettingAnchorDirective } from '../../../shared/components/settings-page/setting-anchor.directive';
import { ThemeService } from '../../../core/services/theme.service';

interface StageTat { stageKey: string; tatHours: number; }
interface MicroSettings { lockTimeoutMinutes: number; allowSupervisorTakeover: boolean; stageTats: StageTat[]; }

const STAGE_LABELS: Record<string, string> = {
  gram: 'Gram stain',
  growth: 'Growth check',
  identification: 'Organism ID',
  ast: 'Antibiotic test',
};

/**
 * Microbiology / Culture settings — the culture bench's stage soft-lock timeout,
 * the supervisor-takeover switch, and per-stage turnaround targets that drive the
 * overdue alerts. ONE scrolling page (ND-PATTERN §19): kit sections + .nd-set rows,
 * slate switch, kit fields; `stage-lock` / `turnaround` are search anchors.
 */
@Component({
  selector: 'pf-culture-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, HeroBandComponent, SettingAnchorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- ND-PATTERN §19: one scrolling page, no pill tabs; the pill names
             the page; Save rides the band actions. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <h1 class="nd-band-page">Microbiology</h1>
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
        subtitle="Step lock and time targets for the culture bench"
        parentRoute="/lab/settings">
        <div actions>
          <button type="button" class="pf-cs__save press" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="nd-setpage">
      <div class="nd-setcol">
      <section class="nd-card nd-setsec" id="sec-lock" aria-labelledby="pf-cs-h-lock">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
          <h2 class="nd-card__label pf-cs__title" id="pf-cs-h-lock">Step lock</h2>
        </div>
        <div class="nd-set" pfSettingAnchor="stage-lock">
          <div class="nd-set__text">
            <label class="nd-set__label" for="pf-cs-lock">Free a held step after</label>
            <p class="nd-set__help">Idle minutes before the step goes back. 0 = never.</p>
          </div>
          <div class="nd-set__ctl">
            <input id="pf-cs-lock" type="number" min="0" max="1440" inputmode="numeric" class="nd-input nd-num pf-cs__num"
                   aria-describedby="pf-cs-lock-u" [(ngModel)]="lockTimeoutMinutes" />
            <span class="pf-cs__unit" id="pf-cs-lock-u">minutes</span>
          </div>
        </div>
        <div class="nd-set">
          <div class="nd-set__text">
            <p class="nd-set__label" id="pf-cs-takeover-l">Supervisor can take over</p>
            <p class="nd-set__help">A supervisor can free a step someone else holds.</p>
          </div>
          <div class="nd-set__ctl">
            <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="allowSupervisorTakeover"
                    aria-labelledby="pf-cs-takeover-l"
                    (click)="allowSupervisorTakeover = !allowSupervisorTakeover">
              <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
            </button>
          </div>
        </div>
      </section>

      <section class="nd-card nd-setsec" id="sec-tat" aria-labelledby="pf-cs-h-tat">
        <div class="nd-card__head">
          <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
          <h2 class="nd-card__label pf-cs__title" id="pf-cs-h-tat">Time targets</h2>
        </div>
        <div class="nd-set" pfSettingAnchor="turnaround">
          <div class="nd-set__text">
            <p class="nd-set__label">Hours before a step is late</p>
            <p class="nd-set__help">A late step sends an overdue alert.</p>
          </div>
        </div>
        @for (t of stageTats(); track t.stageKey) {
          <div class="nd-set nd-set--sub">
            <div class="nd-set__text">
              <label class="nd-set__label" [attr.for]="'pf-cs-tat-' + t.stageKey">{{ label(t.stageKey) }}</label>
            </div>
            <div class="nd-set__ctl">
              <input [id]="'pf-cs-tat-' + t.stageKey" type="number" min="1" max="336" inputmode="numeric" class="nd-input nd-num pf-cs__num"
                     [attr.aria-describedby]="'pf-cs-tat-u-' + t.stageKey"
                     [ngModel]="t.tatHours" (ngModelChange)="setTat(t.stageKey, $event)" />
              <span class="pf-cs__unit" [id]="'pf-cs-tat-u-' + t.stageKey">hours</span>
            </div>
          </div>
        }
      </section>
      </div>
      </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-cs__save { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; color: #fff;
      background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-cs__save:disabled { opacity: .5; cursor: default; }
    .pf-cs__title { margin: 0; }
    .pf-cs__num { width: 96px; text-align: right; }
    .pf-cs__unit { font-size: 13px; color: var(--text-secondary); }
  `],
})
export class CultureSettingsComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);

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
