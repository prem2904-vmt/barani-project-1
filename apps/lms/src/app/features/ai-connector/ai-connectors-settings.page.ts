import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../shared/directives/busy.directive';
import { ApiError } from '../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { SkeletonFormComponent } from '../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../shared/utils/min-duration';
import { copyText } from '../../shared/utils/report-share';
import { SelectComponent } from '../../shared/primitives/select.component';
import {
  AI_CONNECTOR_ADMIN_PERMS, AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_NEVER, AI_PRIVACY_LEVELS, AiConnectorApi, AiConnectorState, AiPrivacyLevel, CLAUDE_STEPS,
} from './ai-connector.api';

/**
 * Lab settings → AI connectors (MCP Phase 0). One lab-wide switch, DEFAULT
 * OFF, that lets AI apps (Claude, ChatGPT…) read the lab's numbers through
 * the read-only connector — each person still signs in and presses Allow.
 *
 * ND pattern: band (back to Lab settings) → AI CONNECTORS main card (the
 * switch, status, what an app could read) + CONNECT CLAUDE side card (the
 * connector address with Copy, three plain steps). The switch is admin-only
 * and every flip asks first (DialogService). Anyone else sees the status
 * only, read-only. The server decides; a refused save says so in words.
 */
@Component({
  selector: 'pf-ai-connectors-settings',
  standalone: true,
  imports: [HeroBandComponent, ScreenHeaderComponent, BusyDirective, SkeletonFormComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page pf-aic px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [customSearch]="true" [contextBar]="true">
          <div band-search class="pf-ctx">
            <span class="pf-ctx__primary">AI connectors</span>
            @if (state(); as s) {
              <span class="pf-ctx__chip"><span class="pf-aic__dot" [attr.data-on]="s.enabled" aria-hidden="true"></span>{{ s.enabled ? 'On' : 'Off' }}</span>
            }
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings" title="AI connectors"
        subtitle="Let AI apps like Claude read your lab's numbers" parentRoute="/lab/settings"></pf-screen-header>

      <div class="pf-band-body">
        <div class="pf-aic__grid" [class.pf-aic__grid--solo]="!isAdmin()">
          <section class="pf-card pf-aic__main" aria-labelledby="pf-aic-title">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8"/></svg>
              </span>
              <h2 class="pf-card__label" id="pf-aic-title">AI connectors</h2>
            </header>
            <div class="pf-card__body pf-aic__body">
              @if (skeleton()) {
                <pf-skeleton-form [fields]="3" [cols]="1" label="Loading AI connectors…"></pf-skeleton-form>
              } @else if (loadError()) {
                <div class="pf-aic__err" role="alert">
                  <p>Couldn’t load the AI connector setting. Check your connection and try again.</p>
                  <button type="button" class="pf-btn pf-btn--secondary press" (click)="load()">Try again</button>
                </div>
              } @else if (state(); as s) {
                @if (isAdmin()) {
                  <div class="pf-aic__switchrow">
                    <div class="pf-aic__switchtext">
                      <span class="pf-aic__switchtitle" id="pf-aic-switch-label">Allow AI apps to connect</span>
                      <span class="pf-aic__switchsub">{{ s.enabled ? 'On — people in your lab can connect an app and read the lab’s numbers.' : 'Off — no app can connect. Nothing is shared.' }}</span>
                    </div>
                    <button type="button" class="pf-toggle pf-aic__toggle press" role="switch" [attr.aria-checked]="s.enabled"
                            aria-labelledby="pf-aic-switch-label" [disabled]="saving()" [pfBusy]="saving()" (click)="toggle()">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                } @else {
                  <p class="pf-aic__status" role="status">
                    <span class="pf-aic__dot" [attr.data-on]="s.enabled" aria-hidden="true"></span>
                    {{ s.enabled ? 'AI connectors are on for your lab.' : 'AI connectors are off for your lab.' }}
                  </p>
                  <p class="pf-field__hint">Only a lab admin can change this.</p>
                }
                <h3 class="pf-aic__sec">What a connected app can read</h3>
                @for (g of canSee; track g.title) {
                  <div class="pf-aic__grp">
                    <h4 class="pf-aic__grptitle">{{ g.title }}@if (g.when) {<span class="pf-aic__grpwhen"> — {{ g.when }}</span>}</h4>
                    <ul class="pf-aic__list">
                      @for (line of g.items; track line) {
                        <li><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>{{ line }}</span></li>
                      }
                    </ul>
                  </div>
                }
                <p class="pf-field__hint">{{ never }}</p>
                <h3 class="pf-aic__sec" id="pf-aic-level-label">What an app may see about patients</h3>
                @if (isAdmin()) {
                  <pf-select [options]="levelOptions" [value]="level()" [disabled]="saving()"
                             aria-label="What an app may see about patients" (valueChange)="changeLevel($event)"></pf-select>
                } @else {
                  <p class="pf-aic__status" role="status">{{ levelInfo().label }}</p>
                }
                <p class="pf-field__hint pf-aic__levelhint">{{ levelInfo().summary }}</p>
                <ul class="pf-aic__levels" aria-label="The three levels">
                  @for (l of levels; track l.value) {
                    <li [attr.data-current]="l.value === level()"><strong>{{ l.label }}</strong><span>{{ l.summary }}</span></li>
                  }
                </ul>
                <p class="pf-field__hint">Read only — an app can’t add, change or delete anything, and it sees only what the person who connected it may see. Each person signs in and presses Allow themselves.</p>
              }
            </div>
          </section>

          @if (isAdmin() && state(); as s) {
            <aside class="pf-card pf-aic__side" aria-labelledby="pf-aic-claude">
              <header class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
                </span>
                <h2 class="pf-card__label" id="pf-aic-claude">Connect Claude</h2>
              </header>
              <div class="pf-card__body pf-aic__sidebody">
                @if (!s.enabled) {
                  <p class="pf-field__hint">Turn the switch on first — until then Claude can’t connect.</p>
                }
                <span class="pf-field__lbl" id="pf-aic-url-label">Connector address</span>
                <div class="pf-aic__url">
                  <!-- Shown whole (wraps, never cut) and selectable in one tap. -->
                  <div id="pf-aic-url" class="pf-aic__urltext" tabindex="0" role="textbox" aria-readonly="true"
                       aria-labelledby="pf-aic-url-label" aria-describedby="pf-aic-url-hint">{{ s.connectorUrl }}</div>
                  <button type="button" class="pf-btn pf-btn--secondary press pf-aic__copy" (click)="copy()" aria-label="Copy connector address">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                    {{ copied() ? 'Copied' : 'Copy' }}
                  </button>
                </div>
                <p class="pf-field__hint" id="pf-aic-url-hint">The same address for everyone in your lab.</p>
                <ol class="pf-aic__steps">
                  @for (step of steps; track $index) {
                    <li><span class="pf-aic__n">{{ $index + 1 }}</span><span>{{ step }}</span></li>
                  }
                </ol>
              </div>
            </aside>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-aic__grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 400px; align-items: start; max-width: 1100px; margin: 0 auto; width: 100%; }
    .pf-aic__grid--solo { grid-template-columns: minmax(0, 720px); justify-content: center; }
    @media (max-width: 1023px) { .pf-aic__grid { grid-template-columns: minmax(0, 1fr); max-width: 720px; } }
    .pf-aic__body { gap: 14px; padding: 16px 18px 18px; }
    .pf-aic__switchrow { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0 14px; border-bottom: 1px solid var(--pf-line); }
    .pf-aic__switchtext { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-aic__switchtitle { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-aic__switchsub { font-size: 13px; line-height: 1.45; color: var(--text-secondary); text-wrap: pretty; }
    .pf-aic__toggle { min-width: 44px; min-height: 44px; justify-content: center; flex: none; }
    .pf-aic__status { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-aic__dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--text-tertiary); flex: none; }
    .pf-aic__dot[data-on='true'] { background: var(--pf-switch-on, #7c3aed); }
    .pf-ctx__chip .pf-aic__dot { margin-right: 2px; }
    .pf-aic__sec { margin: 4px 0 0; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-aic__grp { display: grid; gap: 6px; }
    .pf-aic__grptitle { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.4; color: var(--text-primary); }
    .pf-aic__grpwhen { font-weight: 400; color: var(--text-secondary); }
    .pf-aic__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .pf-aic__list li { display: flex; align-items: flex-start; gap: 10px; font-size: 13.5px; line-height: 1.45; color: var(--text-primary); }
    .pf-aic__list svg { flex: none; margin-top: 2px; color: var(--violet-text, #7c3aed); }
    .pf-aic__levels { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .pf-aic__levels li { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--pf-line); border-radius: var(--pf-radius-sm, 10px); font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
    .pf-aic__levels li[data-current='true'] { border-color: var(--color-violet-600, #7c3aed); }
    .pf-aic__levels strong { font-size: 13.5px; color: var(--text-primary); }
    .pf-aic__levelhint { margin-top: -6px; }
    .pf-aic__sidebody { gap: 10px; padding: 16px 18px 18px; }
    .pf-aic__url { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
    .pf-aic__urltext { flex: 1 1 200px; min-width: 0; padding: 11px 12px; border-radius: var(--pf-radius-sm, 10px);
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent); color: var(--text-primary);
      font-size: 13.5px; line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; user-select: all; }
    .pf-aic__urltext:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-aic__copy { flex: none; }
    .pf-aic__steps { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 10px; }
    .pf-aic__steps li { display: flex; align-items: flex-start; gap: 10px; font-size: 13.5px; line-height: 1.45; color: var(--text-primary); }
    .pf-aic__n { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; border-radius: 999px;
      border: 1px solid var(--pf-line); font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .pf-aic__err { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    .pf-aic__err p { margin: 0; font-size: 13px; color: var(--text-secondary); }
    @media (max-width: 640px) {
      /* ND §12: card labels are 12px on phones — beat the global phone heading cap. */
      .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; }
      .pf-aic__sec { font-size: 11px !important; line-height: 1.3 !important; }
      .pf-aic__copy { width: 100%; }
    }
  `],
})
export class AiConnectorsSettingsPage {
  private readonly api = inject(AiConnectorApi);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  readonly canSee = AI_CONNECTOR_CAN_SEE;
  readonly never = AI_CONNECTOR_NEVER;
  readonly steps = CLAUDE_STEPS;
  readonly levels = AI_PRIVACY_LEVELS;
  readonly levelOptions = AI_PRIVACY_LEVELS.map(l => ({ value: l.value, label: l.label }));
  readonly level = computed<AiPrivacyLevel>(() => this.state()?.privacyLevel ?? 'counts');
  readonly levelInfo = computed(() => AI_PRIVACY_LEVELS.find(l => l.value === this.level()) ?? AI_PRIVACY_LEVELS[0]);
  readonly state = signal<AiConnectorState | null>(null);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly copied = signal(false);
  private readonly loadHold = createLoadHold(true);
  readonly skeleton = this.loadHold.active;
  /** The switch + connector address are for lab admins only. */
  readonly isAdmin = computed(() => this.auth.hasAnyPermission(AI_CONNECTOR_ADMIN_PERMS));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loadError.set(false);
    try {
      this.state.set(await firstValueFrom(this.api.get()));
    } catch {
      this.loadError.set(true);
    } finally {
      this.loadHold.done();
    }
  }

  /** Flip the lab switch — always asks first. */
  async toggle(): Promise<void> {
    const cur = this.state();
    if (!cur || this.saving() || !this.isAdmin()) return;
    const next = !cur.enabled;
    const ok = await this.dialog.confirm(next
      ? {
        title: 'Turn on AI connectors?',
        message: 'People in your lab will be able to connect an AI app such as Claude and let it read the lab’s numbers — counts, turnaround, pending work and analyzer status — and your Test Master (tests, tubes, preparation, report times and normal ranges). It can’t change anything, and each person must sign in and press Allow.',
        confirmLabel: 'Turn on',
        tone: 'primary',
      }
      : {
        title: 'Turn off AI connectors?',
        message: 'Every connected app stops working for your lab straight away. People can connect again after you turn this back on.',
        confirmLabel: 'Turn off',
        tone: 'danger',
      });
    if (!ok) return;
    this.saving.set(true);
    try {
      const s = await firstValueFrom(this.api.setEnabled(next));
      this.state.set(s ?? { ...cur, enabled: next });
      this.toasts.success(next ? 'AI connectors turned on' : 'AI connectors turned off');
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(err.code === 'forbidden' || /forbid|permission|not allowed/i.test(err.message)
        ? 'Only a lab admin can change this.'
        : 'Couldn’t save — check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Change what outside AI may see — always asks first, and says what changes in plain words. */
  async changeLevel(next: AiPrivacyLevel | null): Promise<void> {
    const cur = this.state();
    if (!cur || !next || next === this.level() || this.saving() || !this.isAdmin()) return;
    const to = AI_PRIVACY_LEVELS.find(l => l.value === next);
    if (!to) return;
    const widening = AI_PRIVACY_LEVELS.findIndex(l => l.value === next) > AI_PRIVACY_LEVELS.findIndex(l => l.value === this.level());
    const ok = await this.dialog.confirm({
      title: `Change to “${to.label}”?`,
      message: `${to.summary} ${widening ? 'Connected apps can see more straight away.' : 'Connected apps see less straight away.'} Patient names are never shared at any level.`,
      confirmLabel: 'Change',
      tone: widening ? 'danger' : 'primary',
    });
    if (!ok) { this.state.set({ ...cur }); return; }   // re-render the select back to the saved value
    this.saving.set(true);
    try {
      const s = await firstValueFrom(this.api.setPrivacyLevel(next));
      this.state.set(s ?? { ...cur, privacyLevel: next });
      this.toasts.success('Saved');
    } catch (e) {
      const err = ApiError.from(e);
      this.state.set({ ...cur });
      this.toasts.error(err.code === 'forbidden' || /forbid|permission|not allowed/i.test(err.message)
        ? 'Only a lab admin can change this.'
        : 'Couldn’t save — check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async copy(): Promise<void> {
    const url = this.state()?.connectorUrl;
    if (!url) return;
    const ok = await copyText(url);
    if (ok) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } else {
      this.toasts.error('Couldn’t copy — select the address and copy it.');
    }
  }
}
