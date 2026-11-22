import { SkelSettingRowsComponent } from '../../shared/components/skeleton-frame/skeleton-frame.component';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SettingRowComponent } from '../../shared/components/setting-row/setting-row.component';
import { SETTINGS_HOST, bindTabQuery, injectSettingsHosted } from '../../shared/utils/settings-host';
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
import { CasesheetGateService } from '../casesheets/shared/casesheet-gate.service';
import { CaseSheetBuilderApi } from '../casesheets/studio/builder/builder-api';
import { BUILDER_SWITCH_OFF, BUILDER_SWITCH_ON, BUILDER_SWITCH_TITLE, builderWords } from '../casesheets/studio/builder/builder-models';
import { BuilderStatusService, CORTEX_BUILDER_ON } from '../casesheets/studio/builder/builder-status.service';
import {
  AI_CONNECTOR_ADMIN_PERMS, AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST, AI_CONNECTOR_NEVER, AI_CONNECTOR_NEVER_ITEMS,
  AI_CONNECTOR_GRANT_LABEL, AI_CONNECTOR_SUGGEST_OFF, AI_CONNECTOR_SUGGEST_OFF_EFFECT, AI_CONNECTOR_SUGGEST_ON, AI_CONNECTOR_SUGGEST_TITLE, AI_PRIVACY_LEVELS, offersAppGrant,
  AiConnectorApi, AiConnectorGrant, AiConnectorState, AiPrivacyLevel, CONNECT_APPS, rememberedAppName,
} from './ai-connector.api';

/** The main card's sections (segmented tabs in its header). */
export type AicTab = 'settings' | 'can' | 'apps' | 'connect';

/**
 * Lab settings → AI connector (MCP Phase 0). One lab-wide switch, DEFAULT
 * OFF, that lets apps (Claude, ChatGPT…) read the lab's numbers through the
 * connector — each person still signs in and presses Allow.
 *
 * ND pattern, NO inner scroll (owner, 2026-11-01): band (back to Lab
 * settings) → AI CONNECTOR main card whose header carries segmented tabs, so
 * every section fits the window at 1280×720 instead of one long wall:
 *   Settings      — the two switches, what apps may see about patients
 *                   (pf-select + "Compare the levels"), who can use it, the
 *                   masking note;
 *   What apps see — a compact two-column Can / Never list (the full wording
 *                   opens on demand in a DialogService notice);
 *   Your apps     — the person's OWN apps allowed to suggest, with Revoke.
 * + CONNECT AN APP category (admin only): the connector address with Copy
 * and three short steps. Every switch flip / level change / revoke asks first
 * (DialogService). Anyone else sees the state read-only. The server decides;
 * a refused save says so in words.
 */
@Component({
  selector: 'pf-ai-connectors-settings',
  standalone: true,
  imports: [SkelSettingRowsComponent, HeroBandComponent, ScreenHeaderComponent, BusyDirective, SkeletonFormComponent, SelectComponent, SettingRowComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Test Master's frame (owner 2026-11-17): band = back + search pill; ONE main card whose head carries the categories
         (Settings | What apps see | Your apps | Connect an app); flush rows, no nested cards. Inline in the Settings
         overview the overview's card IS the main card: the categories become its head pill (SETTINGS_HOST). -->
    <section class="pf-band-page pf-aic px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search Connected apps" [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Organization" title="AI connector"
        subtitle="Let apps like Claude read your lab's numbers and suggest Test Master changes"></pf-screen-header>

      <div class="pf-band-body">
        <ng-template #aicBody>
          @if (skeleton()) {
            <pf-skel-setting-rows [rows]="3" label="Loading AI connector…"></pf-skel-setting-rows>
          } @else if (loadError()) {
            <div class="pf-aic__err" role="alert">
              <p>Couldn’t load the AI connector setting. Check your connection and try again.</p>
              <button type="button" class="pf-btn pf-btn--secondary press" (click)="load()">Try again</button>
            </div>
          } @else if (state(); as s) {
            <div id="pf-aic-panel" role="tabpanel" class="pf-aic__panel" [attr.aria-labelledby]="hosted ? null : 'pf-aic-tab-' + tab()">
              @switch (tab()) {
                @case ('settings') {
                  <pf-setting-row label="Allow apps to connect" id="pf-aic-switch-label"
                                  [hint]="isAdmin() ? (s.enabled ? 'On — people in your lab can connect an app and read the lab’s numbers. Apps can no longer read anything while this is off. ' + suggestOffEffect : 'Off — no app can connect. Nothing is shared.') : (s.enabled ? 'AI connectors are on for your lab.' : 'AI connectors are off for your lab.')">
                    @if (isAdmin()) {
                      <button type="button" class="pf-toggle pf-aic__toggle press" role="switch" [attr.aria-checked]="s.enabled"
                              aria-label="Allow apps to connect" [disabled]="saving()" [pfBusy]="saving()" (click)="toggle()">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    } @else {
                      <span class="pf-aic__state"><span class="pf-aic__dot" [attr.data-on]="s.enabled" aria-hidden="true"></span>{{ s.enabled ? 'On' : 'Off' }}</span>
                    }
                  </pf-setting-row>
                  <pf-setting-row [label]="suggestTitle"
                                  [hint]="isAdmin() ? (s.proposals ? suggestOn + ' ' + suggestOffEffect : suggestOff) : (s.proposals ? 'Connected assistants can suggest Test Master changes.' : 'Connected assistants can’t suggest Test Master changes.')">
                    @if (isAdmin()) {
                      <button type="button" class="pf-toggle pf-aic__toggle press" role="switch" id="pf-aic-suggest" [attr.aria-checked]="!!s.proposals"
                              [attr.aria-label]="suggestTitle" [disabled]="saving()" (click)="toggleProposals()">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    } @else {
                      <span class="pf-aic__state"><span class="pf-aic__dot" [attr.data-on]="!!s.proposals" aria-hidden="true"></span>{{ s.proposals ? 'On' : 'Off' }}</span>
                    }
                  </pf-setting-row>
                  @if (builderSwitchShown()) {
                    <pf-setting-row data-builder-switch [label]="builderTitle" [hint]="builderOn() ? builderOnWords : builderOffWords">
                      <button type="button" class="pf-toggle pf-aic__toggle press" role="switch" id="pf-aic-builder" [attr.aria-checked]="builderOn()"
                              [attr.aria-label]="builderTitle" [disabled]="saving()" (click)="toggleBuilder()">
                        <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                      </button>
                    </pf-setting-row>
                  }
                  <pf-setting-row label="What apps may see about patients">
                    <span row-hint class="pf-aic__levelhint">{{ levelInfo().summary }}</span>
                    <button type="button" class="pf-btn pf-btn--tertiary pf-aic__link press" (click)="compareLevels()">Compare the levels</button>
                    @if (isAdmin()) {
                      <pf-select class="pf-aic__level" [options]="levelOptions" [value]="level()" [disabled]="saving()"
                                 aria-label="What apps may see about patients" (valueChange)="changeLevel($event)"></pf-select>
                    } @else {
                      <span class="pf-aic__state pf-aic__levelname" role="status">{{ levelInfo().label }}</span>
                    }
                  </pf-setting-row>
                  <!-- Who can use it + masking: ONE muted note (not cards). -->
                  <p class="pf-aic__note" data-testid="aic-note">
                    @if (s.proposals) {
                      An app can read, and suggest Test Master changes for your approval. It can’t apply, approve, or delete anything itself.
                    } @else {
                      Read only — an app can’t add, change or delete anything.
                    }
                    Each person signs in and presses Allow; an app sees only what their role allows.
                    Patients are masked: apps see counts and short codes only — never a name, phone or ID number; the codes open inside Prefrontal.
                    @if (!isAdmin()) { Only a lab admin can change these. }
                  </p>
                }
                @case ('can') {
                  <div class="pf-aic__cn">
                    <section class="pf-aic__cancol" aria-labelledby="pf-aic-can-label">
                      <h3 class="pf-aic__sec" id="pf-aic-can-label">Can read</h3>
                      <ul class="pf-aic__can">
                        @for (g of canSee; track g.title) {
                          <li class="pf-aic__grp">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                            <span class="pf-aic__grptext">
                              <span class="pf-aic__grptitle">{{ g.title }}@if (g.when) {<span class="pf-aic__grpwhen"> — {{ g.when }}</span>}</span>
                              <span class="pf-aic__grpbrief">{{ g.brief }}</span>
                            </span>
                          </li>
                        }
                      </ul>
                    </section>
                    <section class="pf-aic__nevercol" aria-labelledby="pf-aic-never-label">
                      <h3 class="pf-aic__sec" id="pf-aic-never-label">Never</h3>
                      <ul class="pf-aic__never">
                        @for (line of neverItems; track line) {
                          <li>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                            <span>{{ line }}</span>
                          </li>
                        }
                      </ul>
                    </section>
                  </div>
                  <button type="button" class="pf-btn pf-btn--tertiary pf-aic__link press" (click)="showFullList()">See the full list</button>
                }
                @case ('apps') {
                  @if (grantsError()) {
                    <p class="pf-field__hint" role="alert">Couldn’t load your list. <button type="button" class="pf-btn pf-btn--tertiary press" (click)="loadGrants()">Try again</button></p>
                  } @else if (grants().length === 0) {
                    <pf-setting-row label="Apps you’ve allowed to suggest changes" hint="None. No app can suggest Test Master or case sheet changes with your account."></pf-setting-row>
                  } @else {
                    <ul class="pf-aic__grants" aria-label="Apps you’ve allowed to suggest changes">
                      @for (g of grants(); track g.clientId) {
                        <li class="pf-aic__grant">
                          <span class="pf-aic__granttext">
                            <span class="pf-aic__grantname">{{ grantName(g) }}</span>
                            <span class="pf-aic__grantsub" data-grant-label>{{ grantLabel }}</span>
                            <span class="pf-aic__grantsub">Allowed {{ grantDate(g) }} · app {{ shortId(g) }}</span>
                          </span>
                          <button type="button" class="pf-btn pf-btn--secondary press pf-aic__revoke" [disabled]="revoking() === g.clientId"
                                  [pfBusy]="revoking() === g.clientId" pfBusyLabel="Revoking…" (click)="revoke(g)"
                                  [attr.aria-label]="'Revoke ' + grantName(g)">Revoke</button>
                        </li>
                      }
                    </ul>
                  }
                  <p class="pf-aic__note">Only your own apps are listed. Revoking stops the app suggesting changes straight away; it can still read.</p>
                }
                @case ('connect') {
                  @if (!s.enabled) {
                    <p class="pf-aic__note" role="status">Turn on “Allow apps to connect” first — until then no app can connect.</p>
                  }
                  <pf-setting-row label="App" hint="Pick the app you want to connect.">
                    <pf-select class="pf-aic__app" [options]="appOptions" [value]="appId()" aria-label="App"
                               (valueChange)="appId.set($event)"></pf-select>
                  </pf-setting-row>
                  <pf-setting-row label="Connector address" hint="The same address for everyone in your lab.">
                    <!-- Shown whole (wraps, never cut) and selectable in one tap. -->
                    <div id="pf-aic-url" class="pf-aic__urltext" tabindex="0" role="textbox" aria-readonly="true" aria-label="Connector address">{{ s.connectorUrl }}</div>
                    <button type="button" class="pf-btn pf-btn--secondary press pf-aic__copy" (click)="copy()" aria-label="Copy connector address">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                      {{ copied() ? 'Copied' : 'Copy' }}
                    </button>
                  </pf-setting-row>
                  <pf-setting-row [label]="'Steps in ' + app().name" [hint]="app().note" [stack]="true">
                    <ol class="pf-aic__steps">
                      @for (step of appSteps(); track $index) {
                        <li><span class="pf-aic__n">{{ $index + 1 }}</span><span>{{ step }}</span></li>
                      }
                    </ol>
                  </pf-setting-row>
                }
              }
            </div>
          }
        </ng-template>

        @if (hosted) {
          <ng-container *ngTemplateOutlet="aicBody"></ng-container>
        } @else {
          <section class="pf-card pf-aic__main" aria-labelledby="pf-aic-title">
            <header class="pf-card__head pf-aic__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8"/></svg>
              </span>
              <h2 class="pf-card__label" id="pf-aic-title">AI connector</h2>
              @if (state()) {
                <div class="pf-seg pf-aic__tabs" role="tablist" aria-label="AI connector sections">
                  @for (c of cats(); track c.id) {
                    <button type="button" class="pf-seg__item" role="tab" [id]="'pf-aic-tab-' + c.id" aria-controls="pf-aic-panel"
                            [attr.aria-selected]="tab() === c.id" (click)="pick(c.id)">{{ c.label }}@if (c.id === 'apps') {<span class="pf-num pf-aic__count">{{ grants().length }}</span>}</button>
                  }
                </div>
              }
            </header>
            <div class="pf-card__body pf-aic__body"><ng-container *ngTemplateOutlet="aicBody"></ng-container></div>
          </section>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* NO inner scroll (owner, 2026-11-01): the card body grows with its rows; long content is split into the head's categories. */
    .pf-aic .pf-card__body { overflow: visible; }
    .pf-aic__head { flex-wrap: wrap; row-gap: 8px; }
    .pf-aic__tabs { margin-left: auto; }
    .pf-aic__count { margin-left: 4px; font-weight: 500; color: var(--text-tertiary); }
    .pf-aic__body { padding: 4px 24px 20px; display: block; }
    .pf-aic__panel { display: flex; flex-direction: column; }
    .pf-aic__toggle { flex: none; }
    .pf-aic__level { width: 240px; }
    .pf-aic__link { height: 32px; min-height: 32px; padding: 0 10px; }
    .pf-aic__state { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 4px 10px; border-radius: 999px;
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent); font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
    .pf-aic__levelhint { font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    .pf-aic__note { margin: 12px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); text-wrap: pretty; }
    .pf-aic__dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--text-tertiary); flex: none; }
    .pf-aic__dot[data-on='true'] { background: var(--pf-switch-on, #7c3aed); }

    /* What apps see: Can / Never, flush (no boxes). */
    .pf-aic__cn { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px; padding-top: 12px; }
    .pf-aic__sec { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-aic__can, .pf-aic__never { list-style: none; margin: 0; padding: 0; display: grid; }
    .pf-aic__can { gap: 12px; }
    .pf-aic__grp { display: flex; align-items: flex-start; gap: 10px; }
    .pf-aic__grp svg { flex: none; margin-top: 3px; color: var(--violet-text, #7c3aed); }
    .pf-aic__grptext { display: grid; gap: 1px; min-width: 0; }
    .pf-aic__grptitle { font-size: 13.5px; font-weight: 500; line-height: 1.4; color: var(--text-primary); }
    .pf-aic__grpwhen { font-weight: 400; color: var(--text-tertiary); }
    .pf-aic__grpbrief { font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    .pf-aic__never { gap: 9px; }
    .pf-aic__never li { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; line-height: 1.4; color: var(--text-primary); }
    .pf-aic__never svg { flex: none; margin-top: 3px; color: var(--text-tertiary); }
    .pf-aic__cn + .pf-aic__link { align-self: flex-start; margin-top: 10px; }

    /* Your apps: one row per app. */
    .pf-aic__grants { list-style: none; margin: 0; padding: 0; }
    .pf-aic__grant { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 10px 0; border-bottom: 1px solid var(--pf-line); }
    .pf-aic__granttext { display: grid; gap: 2px; min-width: 0; }
    .pf-aic__grantname { font-size: 13.5px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-aic__grantsub { font-size: 12.5px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-aic__revoke { flex: none; height: 34px; min-height: 34px; }

    /* Connect an app. */
    .pf-aic__app { min-width: 240px; max-width: 100%; }
    .pf-aic__urltext { max-width: 420px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent);
      color: var(--text-primary); font-size: 13px; line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; user-select: all; }
    .pf-aic__urltext:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-aic__copy { flex: none; height: 34px; min-height: 34px; }
    .pf-aic__steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .pf-aic__steps li { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.45; color: var(--text-primary); }
    .pf-aic__n { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; border-radius: 999px;
      border: 1px solid var(--pf-line); font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .pf-aic__err { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding-top: 10px; }
    .pf-aic__err p { margin: 0; font-size: 13px; color: var(--text-secondary); }

    @media (max-width: 760px) { .pf-aic__cn { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 640px) {
      .pf-aic__tabs { margin-left: 0; width: 100%; flex-wrap: wrap; }
      .pf-aic__body { padding: 4px 14px 14px; }
      .pf-aic__level { width: 100%; }
      .pf-aic__copy { width: 100%; justify-content: center; }
    }
  `],
})
export class AiConnectorsSettingsPage {
  private readonly api = inject(AiConnectorApi);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  readonly canSee = [...AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST];
  readonly never = AI_CONNECTOR_NEVER;
  readonly neverItems = AI_CONNECTOR_NEVER_ITEMS;
  readonly suggestTitle = AI_CONNECTOR_SUGGEST_TITLE;
  readonly grantLabel = AI_CONNECTOR_GRANT_LABEL;
  readonly suggestOn = AI_CONNECTOR_SUGGEST_ON;
  readonly suggestOff = AI_CONNECTOR_SUGGEST_OFF;
  readonly suggestOffEffect = AI_CONNECTOR_SUGGEST_OFF_EFFECT;
  readonly appOptions = CONNECT_APPS.map(a => ({ value: a.id, label: a.name }));
  readonly appId = signal<string>(CONNECT_APPS[0].id);
  readonly app = computed(() => CONNECT_APPS.find(a => a.id === this.appId()) ?? CONNECT_APPS[0]);
  /** The picked app's steps with the lab's connector address filled in. */
  readonly appSteps = computed(() => this.app().steps.map(t => t.split('{url}').join(this.state()?.connectorUrl ?? '')));
  readonly levels = AI_PRIVACY_LEVELS;
  readonly levelOptions = AI_PRIVACY_LEVELS.map(l => ({ value: l.value, label: l.label }));
  readonly level = computed<AiPrivacyLevel>(() => this.state()?.privacyLevel ?? 'counts');
  readonly levelInfo = computed(() => AI_PRIVACY_LEVELS.find(l => l.value === this.level()) ?? AI_PRIVACY_LEVELS[0]);
  readonly state = signal<AiConnectorState | null>(null);
  /** The signed-in person's OWN allowed apps (the server never returns anyone else's). */
  readonly grants = signal<AiConnectorGrant[]>([]);
  readonly grantsError = signal(false);
  readonly revoking = signal<string | null>(null);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly copied = signal(false);
  private readonly loadHold = createLoadHold(true);
  readonly skeleton = this.loadHold.active;
  /** The switch + connector address are for lab admins only. */
  readonly isAdmin = computed(() => this.auth.hasAnyPermission(AI_CONNECTOR_ADMIN_PERMS));
  /** "Your apps" shows while the lab allows suggestions (Test Master, or case sheets through the builder switch), or while the
   *  person still has an old grant to revoke. ONE per-app grant covers both. */
  readonly showApps = computed(() => offersAppGrant(this.state()) || this.builderOn() || this.grants().length > 0);
  private readonly picked = signal<AicTab>('settings');
  /** The open section — falls back to Settings when "Your apps" goes away. */
  readonly tab = computed<AicTab>(() => {
    const t = this.picked();
    if (t === 'apps' && !this.showApps()) return 'settings';
    if (t === 'connect' && !this.isAdmin()) return 'settings';
    return t;
  });

  // ---- "Let connected apps build case sheets" (case-sheet builder beta: console switch + case-sheet gate + the server) ----
  // The services are only created when the console switch is on, so the rest of this screen never touches them.
  private readonly builderFlag = inject(CORTEX_BUILDER_ON)();
  private readonly builderStatus = this.builderFlag ? inject(BuilderStatusService) : null;
  private readonly builderApi = this.builderFlag ? inject(CaseSheetBuilderApi) : null;
  private readonly csGate = this.builderFlag ? inject(CasesheetGateService) : null;
  readonly builderTitle = BUILDER_SWITCH_TITLE;
  readonly builderOnWords = BUILDER_SWITCH_ON;
  readonly builderOffWords = BUILDER_SWITCH_OFF;
  readonly builderSwitchShown = computed(() => !!this.csGate?.visible() && !!this.builderStatus?.canChangeSwitch());
  readonly builderOn = computed(() => !!this.builderStatus?.status()?.connectorSwitch);

  async toggleBuilder(): Promise<void> {
    const st = this.builderStatus;
    const api = this.builderApi;
    if (!st || !api || this.saving()) return;
    const next = !this.builderOn();
    const ok = await this.dialog.confirm(next
      ? { title: 'Let connected apps build case sheets?', message: BUILDER_SWITCH_ON + ' Each person still allows each app, with the box “Also let this app suggest Test Master and case sheet changes”.', confirmLabel: 'Turn on', tone: 'primary' }
      : { title: 'Stop connected apps building case sheets?', message: 'Connected apps can no longer suggest case sheets. Suggestions already waiting in Pending changes stay there until someone approves or rejects them.', confirmLabel: 'Turn off', tone: 'danger' });
    if (!ok) return;
    this.saving.set(true);
    try {
      await api.setConnector(next);
      st.setSwitch(next);
      this.toasts.success(next ? 'Connected apps can now suggest case sheets' : 'Connected apps can no longer suggest case sheets');
    } catch (e) {
      this.toasts.error(builderWords(e, 'Couldn’t save — check your connection and try again.'));
    } finally {
      this.saving.set(false);
    }
  }

  constructor() {
    void this.load();
    void this.builderStatus?.load();
  }

  pick(t: AicTab): void { this.picked.set(t); }

  // ── Categories: the card head's pill here, the overview's card-head pill when inline (SETTINGS_HOST) ──
  protected readonly hosted = injectSettingsHosted();
  readonly q = signal('');
  readonly cats = computed<{ id: AicTab; label: string }[]>(() => [
    { id: 'settings', label: 'Settings' },
    { id: 'can', label: 'What apps see' },
    ...(this.showApps() ? [{ id: 'apps' as AicTab, label: 'Your apps' }] : []),
    ...(this.isAdmin() && this.state() ? [{ id: 'connect' as AicTab, label: 'Connect an app' }] : []),
  ]);
  private readonly settingsHost = inject(SETTINGS_HOST, { optional: true });
  private readonly publishCats = (() => {
    const host = this.settingsHost;
    if (!host) return null;
    inject(DestroyRef).onDestroy(() => host.categories.set(null));
    return effect(() => host.categories.set(this.state() ? this.cats().map((c) => ({ id: c.id, label: c.label })) : null));
  })();
  private readonly followTab = bindTabQuery(['settings', 'can', 'apps', 'connect', 'claude'] as const, (t) => this.picked.set(t === 'claude' ? 'connect' : t));

  async load(): Promise<void> {
    this.loadError.set(false);
    try {
      this.state.set(await firstValueFrom(this.api.get()));
    } catch {
      this.loadError.set(true);
    } finally {
      this.loadHold.done();
    }
    if (!this.loadError()) await this.loadGrants();
  }

  async loadGrants(): Promise<void> {
    this.grantsError.set(false);
    try {
      this.grants.set((await firstValueFrom(this.api.listGrants())) ?? []);
    } catch {
      this.grantsError.set(true);
    }
  }

  grantName(g: AiConnectorGrant): string { return rememberedAppName(g.clientId) ?? 'Connected app'; }
  shortId(g: AiConnectorGrant): string { return '…' + g.clientId.slice(-6); }
  grantDate(g: AiConnectorGrant): string {
    const d = new Date(g.updatedAt || g.createdAt);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** The full wording behind the compact Can / Never list (the same lines the consent screen shows). */
  showFullList(): Promise<void> {
    return this.dialog.alert({
      title: 'What a connected app can read',
      message: this.never,
      items: this.canSee.flatMap(g => g.items.map(line => `${g.title}${g.when ? ` (${g.when})` : ''}: ${line}`)),
      confirmLabel: 'Done',
    });
  }

  /** The three privacy levels, in plain words. */
  compareLevels(): Promise<void> {
    return this.dialog.alert({
      title: 'What apps may see about patients',
      message: `Your lab is on “${this.levelInfo().label}”. Patient names are never shared at any level.`,
      items: this.levels.map(l => `${l.label}: ${l.summary}`),
      confirmLabel: 'Done',
    });
  }

  /** Stop one app suggesting changes — asks first; takes effect on the server at once. */
  async revoke(g: AiConnectorGrant): Promise<void> {
    if (this.revoking()) return;
    const name = this.grantName(g);
    const ok = await this.dialog.confirm({
      title: `Revoke ${name}?`,
      message: `${name} will no longer be able to suggest Test Master or case sheet changes with your account, starting now. It can still read what your account may see. Suggestions it already made stay in Pending changes.`,
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!ok) return;
    this.revoking.set(g.clientId);
    try {
      await firstValueFrom(this.api.deleteGrant(g.clientId));
      this.grants.update(list => list.filter(x => x.clientId !== g.clientId));
      this.toasts.success(`${name} can no longer suggest changes`);
    } catch {
      this.toasts.error('Couldn’t revoke — check your connection and try again.');
    } finally {
      this.revoking.set(null);
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
        message: 'People in your lab will be able to connect an app such as Claude and let it read the lab’s numbers — counts, turnaround, pending work and analyzer status — and your Test Master (tests, tubes, preparation, report times and normal ranges). It can’t change anything by itself, and each person must sign in and press Allow.',
        confirmLabel: 'Turn on',
        tone: 'primary',
      }
      : {
        title: 'Turn off AI connectors?',
        message: 'Every connected app stops working for your lab straight away, and it can no longer read anything. ' + AI_CONNECTOR_SUGGEST_OFF_EFFECT + ' People can connect again after you turn this back on.',
        confirmLabel: 'Turn off',
        tone: 'danger',
      });
    if (!ok) return;
    this.saving.set(true);
    try {
      const s = await firstValueFrom(this.api.setEnabled(next));
      this.state.set(s ?? { ...cur, enabled: next });
      if (!next) this.grants.set([]);   // switch off also removed every app's permission
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

  /** Flip "let connected assistants suggest Test Master changes" — always asks first. Off by default. */
  async toggleProposals(): Promise<void> {
    const cur = this.state();
    if (!cur || this.saving() || !this.isAdmin()) return;
    const next = !cur.proposals;
    const ok = await this.dialog.confirm(next
      ? {
        title: 'Let connected assistants suggest changes?',
        message: 'A connected assistant such as Claude will be able to suggest changes to your Test Master — prices, new tests, edits to a test, what is in a profile. Each suggestion waits in Test Master, Pending changes. Nothing changes until someone with Test Master permission approves it there, one by one. Each person who connects an app still presses Allow, and the app must ask for this access.',
        confirmLabel: 'Turn on',
        tone: 'primary',
      }
      : {
        title: 'Stop assistants suggesting changes?',
        message: `${AI_CONNECTOR_SUGGEST_OFF_EFFECT} Connected assistants go back to reading only. Suggestions already waiting in Pending changes stay there until someone approves or rejects them.`,
        confirmLabel: 'Turn off',
        tone: 'danger',
      });
    if (!ok) return;
    this.saving.set(true);
    try {
      const s = await firstValueFrom(this.api.setProposals(next));
      this.state.set(s ?? { ...cur, proposals: next });
      if (!next) this.grants.set([]);   // the server removed every app's permission; nothing to show until people allow again
      this.toasts.success(next ? 'Assistants can now suggest Test Master changes' : 'Assistants can no longer suggest changes');
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(err.code === 'forbidden' || /forbid|permission|not allowed/i.test(err.message)
        ? 'Only a lab admin can change this.'
        : 'Couldn’t save — check your connection and try again.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Change what a connected app may see — always asks first, and says what changes in plain words. */
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
