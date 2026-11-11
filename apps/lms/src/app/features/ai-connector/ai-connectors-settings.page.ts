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
import { CasesheetGateService } from '../casesheets/shared/casesheet-gate.service';
import { CaseSheetBuilderApi } from '../casesheets/studio/builder/builder-api';
import { BUILDER_SWITCH_OFF, BUILDER_SWITCH_ON, BUILDER_SWITCH_TITLE, builderWords } from '../casesheets/studio/builder/builder-models';
import { BuilderStatusService, CORTEX_BUILDER_ON } from '../casesheets/studio/builder/builder-status.service';
import {
  AI_CONNECTOR_ADMIN_PERMS, AI_CONNECTOR_CAN_SEE, AI_CONNECTOR_CAN_SUGGEST, AI_CONNECTOR_NEVER, AI_CONNECTOR_NEVER_ITEMS,
  AI_CONNECTOR_GRANT_LABEL, AI_CONNECTOR_SUGGEST_OFF, AI_CONNECTOR_SUGGEST_OFF_EFFECT, AI_CONNECTOR_SUGGEST_ON, AI_CONNECTOR_SUGGEST_TITLE, AI_PRIVACY_LEVELS, offersAppGrant,
  AiConnectorApi, AiConnectorGrant, AiConnectorState, AiPrivacyLevel, CLAUDE_STEPS, rememberedAppName,
} from './ai-connector.api';

/** The main card's sections (segmented tabs in its header). */
export type AicTab = 'settings' | 'can' | 'apps';

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
 * + CONNECT CLAUDE side card (admin only): the connector address with Copy
 * and three short steps. Every switch flip / level change / revoke asks first
 * (DialogService). Anyone else sees the state read-only. The server decides;
 * a refused save says so in words.
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
            <span class="pf-ctx__primary">AI connector</span>
            @if (state(); as s) {
              <span class="pf-ctx__chip"><span class="pf-aic__dot" [attr.data-on]="s.enabled" aria-hidden="true"></span>{{ s.enabled ? 'On' : 'Off' }}</span>
            }
          </div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings" title="AI connector"
        subtitle="Let apps like Claude read your lab's numbers and suggest Test Master changes" parentRoute="/lab/settings"></pf-screen-header>

      <div class="pf-band-body">
        <div class="pf-aic__grid" [class.pf-aic__grid--solo]="!isAdmin()">
          <section class="pf-card pf-aic__main" aria-labelledby="pf-aic-title">
            <header class="pf-card__head pf-aic__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8"/></svg>
              </span>
              <h2 class="pf-card__label" id="pf-aic-title">AI connector</h2>
              @if (state()) {
                <div class="pf-seg pf-aic__tabs" role="tablist" aria-label="AI connector sections">
                  <button type="button" class="pf-seg__item" role="tab" id="pf-aic-tab-settings" aria-controls="pf-aic-panel"
                          [attr.aria-selected]="tab() === 'settings'" (click)="pick('settings')">Settings</button>
                  <button type="button" class="pf-seg__item" role="tab" id="pf-aic-tab-can" aria-controls="pf-aic-panel"
                          [attr.aria-selected]="tab() === 'can'" (click)="pick('can')">What apps see</button>
                  @if (showApps()) {
                    <button type="button" class="pf-seg__item" role="tab" id="pf-aic-tab-apps" aria-controls="pf-aic-panel"
                            [attr.aria-selected]="tab() === 'apps'" (click)="pick('apps')">Your apps<span class="pf-num pf-aic__count">{{ grants().length }}</span></button>
                  }
                </div>
              }
            </header>
            <div class="pf-card__body pf-aic__body">
              @if (skeleton()) {
                <pf-skeleton-form [fields]="3" [cols]="1" label="Loading AI connector…"></pf-skeleton-form>
              } @else if (loadError()) {
                <div class="pf-aic__err" role="alert">
                  <p>Couldn’t load the AI connector setting. Check your connection and try again.</p>
                  <button type="button" class="pf-btn pf-btn--secondary press" (click)="load()">Try again</button>
                </div>
              } @else if (state(); as s) {
                <div id="pf-aic-panel" role="tabpanel" class="pf-aic__panel" [attr.aria-labelledby]="'pf-aic-tab-' + tab()">
                  @switch (tab()) {
                    @case ('settings') {
                      <ul class="pf-aic__rows">
                        <li class="pf-aic__row">
                          <div class="pf-aic__rowtext">
                            <span class="pf-aic__rowtitle" id="pf-aic-switch-label">Allow apps to connect</span>
                            @if (isAdmin()) {
                              <span class="pf-aic__rowsub">{{ s.enabled ? 'On — people in your lab can connect an app and read the lab’s numbers.' : 'Off — no app can connect. Nothing is shared.' }}</span>
                              @if (s.enabled) { <span class="pf-aic__rowsub pf-aic__rowwarn">Apps can no longer read anything while this is off. {{ suggestOffEffect }}</span> }
                            } @else {
                              <span class="pf-aic__rowsub" role="status">{{ s.enabled ? 'AI connectors are on for your lab.' : 'AI connectors are off for your lab.' }}</span>
                            }
                          </div>
                          @if (isAdmin()) {
                            <button type="button" class="pf-toggle pf-aic__toggle press" role="switch" [attr.aria-checked]="s.enabled"
                                    aria-labelledby="pf-aic-switch-label" [disabled]="saving()" [pfBusy]="saving()" (click)="toggle()">
                              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                            </button>
                          } @else {
                            <span class="pf-aic__state"><span class="pf-aic__dot" [attr.data-on]="s.enabled" aria-hidden="true"></span>{{ s.enabled ? 'On' : 'Off' }}</span>
                          }
                        </li>
                        <li class="pf-aic__row">
                          <div class="pf-aic__rowtext">
                            <span class="pf-aic__rowtitle" id="pf-aic-suggest-label">{{ suggestTitle }}</span>
                            @if (isAdmin()) {
                              <span class="pf-aic__rowsub">{{ s.proposals ? suggestOn : suggestOff }}</span>
                              @if (s.proposals) { <span class="pf-aic__rowsub pf-aic__rowwarn">{{ suggestOffEffect }}</span> }
                            } @else {
                              <span class="pf-aic__rowsub" role="status">{{ s.proposals ? 'Connected assistants can suggest Test Master changes.' : 'Connected assistants can’t suggest Test Master changes.' }}</span>
                            }
                          </div>
                          @if (isAdmin()) {
                            <button type="button" class="pf-toggle pf-aic__toggle press" role="switch" id="pf-aic-suggest" [attr.aria-checked]="!!s.proposals"
                                    aria-labelledby="pf-aic-suggest-label" [disabled]="saving()" (click)="toggleProposals()">
                              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                            </button>
                          } @else {
                            <span class="pf-aic__state"><span class="pf-aic__dot" [attr.data-on]="!!s.proposals" aria-hidden="true"></span>{{ s.proposals ? 'On' : 'Off' }}</span>
                          }
                        </li>
                        @if (builderSwitchShown()) {
                          <li class="pf-aic__row" data-builder-switch>
                            <div class="pf-aic__rowtext">
                              <span class="pf-aic__rowtitle" id="pf-aic-builder-label">{{ builderTitle }}</span>
                              <span class="pf-aic__rowsub">{{ builderOn() ? builderOnWords : builderOffWords }}</span>
                            </div>
                            <button type="button" class="pf-toggle pf-aic__toggle press" role="switch" id="pf-aic-builder" [attr.aria-checked]="builderOn()"
                                    aria-labelledby="pf-aic-builder-label" [disabled]="saving()" (click)="toggleBuilder()">
                              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                            </button>
                          </li>
                        }
                        <li class="pf-aic__row pf-aic__row--level">
                          <div class="pf-aic__rowtext">
                            <span class="pf-aic__rowtitle" id="pf-aic-level-label">What apps may see about patients</span>
                            <span class="pf-aic__rowsub pf-aic__levelhint">{{ levelInfo().summary }}</span>
                          </div>
                          <div class="pf-aic__levelctl">
                            @if (isAdmin()) {
                              <pf-select class="pf-aic__level" [options]="levelOptions" [value]="level()" [disabled]="saving()"
                                         aria-label="What apps may see about patients" (valueChange)="changeLevel($event)"></pf-select>
                            } @else {
                              <span class="pf-aic__state pf-aic__levelname" role="status">{{ levelInfo().label }}</span>
                            }
                            <button type="button" class="pf-aic__link press" (click)="compareLevels()">Compare the levels</button>
                          </div>
                        </li>
                      </ul>
                      <div class="pf-aic__notes">
                        <p class="pf-aic__note">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>
                          <span><strong>Who can use it.</strong>
                            @if (s.proposals) {
                              An app can read, and suggest Test Master changes for your approval. It can’t apply, approve, or delete anything itself.
                            } @else {
                              Read only — an app can’t add, change or delete anything.
                            }
                            Each person signs in and presses Allow. An app sees only what their role allows.
                            @if (!isAdmin()) { Only a lab admin can change these. }
                          </span>
                        </p>
                        <p class="pf-aic__note">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>
                          <span><strong>Patients are masked.</strong> Apps see counts and short codes only — never a name, phone or ID number. The codes open inside Prefrontal.</span>
                        </p>
                      </div>
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
                      <button type="button" class="pf-aic__link press" (click)="showFullList()">See the full list</button>
                    }
                    @case ('apps') {
                      <h3 class="pf-aic__sec" id="pf-aic-grants-label">Apps you’ve allowed to suggest changes</h3>
                      @if (grantsError()) {
                        <p class="pf-field__hint" role="alert">Couldn’t load your list. <button type="button" class="pf-btn pf-btn--tertiary press" (click)="loadGrants()">Try again</button></p>
                      } @else if (grants().length === 0) {
                        <p class="pf-aic__empty">None. No app can suggest Test Master or case sheet changes with your account.</p>
                      } @else {
                        <ul class="pf-aic__grants" aria-labelledby="pf-aic-grants-label">
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
                      <p class="pf-field__hint">Only your own apps are listed. Revoking stops the app suggesting changes straight away; it can still read.</p>
                    }
                  }
                </div>
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
                  <p class="pf-aic__off" role="status">Turn on “Allow apps to connect” first — until then Claude can’t connect.</p>
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
                <h3 class="pf-aic__sec">Steps</h3>
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
    /* NO inner scroll (owner rule): the card bodies grow with their content and every section is sized to
       fit the window at 1280×720 — long content is split into the header tabs, never scrolled in a box. */
    .pf-aic .pf-card__body { overflow: visible; }
    .pf-aic__grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 360px; align-items: start; max-width: 1180px; margin: 0 auto; width: 100%; }
    .pf-aic__grid--solo { grid-template-columns: minmax(0, 760px); justify-content: center; }
    @media (max-width: 1023px) { .pf-aic__grid { grid-template-columns: minmax(0, 1fr); max-width: 760px; } }
    .pf-aic__head { flex-wrap: wrap; row-gap: 8px; }
    .pf-aic__tabs { margin-left: auto; }
    .pf-aic__count { margin-left: 2px; font-weight: 500; color: var(--text-tertiary); }
    .pf-aic__body { padding: 6px 18px 16px; }
    .pf-aic__panel { display: flex; flex-direction: column; gap: 12px; }

    /* Settings: one row per setting, hairline between, control on the right. */
    .pf-aic__rows { list-style: none; margin: 0; padding: 0; }
    .pf-aic__row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 13px 0; border-bottom: 1px solid var(--pf-line); }
    .pf-aic__row--level { align-items: flex-start; }
    .pf-aic__rowtext { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; }
    .pf-aic__rowtitle { font-size: 14.5px; font-weight: 600; line-height: 1.35; color: var(--text-primary); }
    .pf-aic__rowsub { font-size: 13px; line-height: 1.45; color: var(--text-secondary); text-wrap: pretty; }
    .pf-aic__rowwarn { font-weight: 500; }
    .pf-aic__toggle { min-width: 44px; min-height: 44px; justify-content: center; flex: none; }
    .pf-aic__levelctl { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; width: 250px; }
    .pf-aic__level { width: 100%; }
    .pf-aic__levelctl .pf-aic__link { align-self: flex-end; }
    .pf-aic__state { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 4px 10px; border-radius: 999px;
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent); font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
    .pf-aic__levelname { white-space: normal; text-align: right; }
    .pf-aic__link { align-self: flex-start; min-height: 32px; padding: 0; margin-top: 2px; border: 0; background: none; cursor: pointer;
      font: inherit; font-size: 13px; font-weight: 500; color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    .pf-aic__link:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; border-radius: 4px; }
    .pf-aic__notes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-top: 4px; }
    .pf-aic__note { display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 12px 14px; border-radius: var(--pf-radius-sm, 10px);
      background: var(--pf-chip-bg, transparent); border: 1px solid var(--pf-line); font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .pf-aic__note svg { flex: none; margin-top: 1px; color: var(--violet-text, #7c3aed); }
    .pf-aic__note strong { font-weight: 600; color: var(--text-primary); }

    /* What apps see: compact Can / Never columns. */
    .pf-aic__cn { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 16px; padding-top: 10px; }
    .pf-aic__sec { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-aic__can, .pf-aic__never { list-style: none; margin: 0; padding: 0; display: grid; }
    .pf-aic__can { gap: 12px; }
    .pf-aic__grp { display: flex; align-items: flex-start; gap: 10px; }
    .pf-aic__grp svg { flex: none; margin-top: 3px; color: var(--violet-text, #7c3aed); }
    .pf-aic__grptext { display: grid; gap: 1px; min-width: 0; }
    .pf-aic__grptitle { font-size: 13.5px; font-weight: 600; line-height: 1.4; color: var(--text-primary); }
    .pf-aic__grpwhen { font-weight: 400; color: var(--text-tertiary); }
    .pf-aic__grpbrief { font-size: 13px; line-height: 1.4; color: var(--text-secondary); }
    .pf-aic__nevercol { padding: 12px 14px; border-radius: var(--pf-radius-sm, 10px); border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent); align-self: start; }
    .pf-aic__never { gap: 9px; }
    .pf-aic__never li { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; line-height: 1.4; color: var(--text-primary); }
    .pf-aic__never svg { flex: none; margin-top: 3px; color: var(--text-tertiary); }

    /* Your apps. */
    .pf-aic__panel > .pf-aic__sec { margin: 10px 0 0; }
    .pf-aic__empty { margin: 0; padding: 14px; border-radius: var(--pf-radius-sm, 10px); border: 1px dashed var(--pf-line); font-size: 13px; color: var(--text-secondary); }
    .pf-aic__grants { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .pf-aic__grant { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 8px 8px 14px; border: 1px solid var(--pf-line); border-radius: var(--pf-radius-sm, 10px); }
    .pf-aic__granttext { display: grid; gap: 2px; min-width: 0; }
    .pf-aic__grantname { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-aic__grantsub { font-size: 12.5px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-aic__revoke { flex: none; min-height: 44px; }

    .pf-aic__dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--text-tertiary); flex: none; }
    .pf-aic__dot[data-on='true'] { background: var(--pf-switch-on, #7c3aed); }
    .pf-ctx__chip .pf-aic__dot { margin-right: 2px; }

    /* Connect Claude side card. */
    .pf-aic__sidebody { gap: 10px; padding: 16px 18px 18px; }
    .pf-aic__off { margin: 0; padding: 10px 12px; border-radius: var(--pf-radius-sm, 10px); border: 1px solid var(--pf-line); font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
    .pf-aic__url { display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
    .pf-aic__urltext { flex: 1 1 180px; min-width: 0; padding: 10px 12px; border-radius: var(--pf-radius-sm, 10px);
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent); color: var(--text-primary);
      font-size: 13px; line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; user-select: all; }
    .pf-aic__urltext:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-aic__copy { flex: none; min-height: 44px; }
    .pf-aic__sidebody .pf-aic__sec { margin: 6px 0 0; }
    .pf-aic__steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .pf-aic__steps li { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.45; color: var(--text-primary); }
    .pf-aic__n { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; border-radius: 999px;
      border: 1px solid var(--pf-line); font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .pf-aic__err { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding-top: 10px; }
    .pf-aic__err p { margin: 0; font-size: 13px; color: var(--text-secondary); }

    @media (max-width: 760px) {
      .pf-aic__notes, .pf-aic__cn { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 640px) {
      /* ND §12: card labels are 12px on phones — beat the global phone heading cap. */
      .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; }
      .pf-aic__sec { font-size: 11px !important; line-height: 1.3 !important; }
      .pf-aic__tabs { margin-left: 0; width: 100%; }
      .pf-aic__body { padding: 4px 14px 14px; }
      .pf-aic__row--level { flex-direction: column; align-items: stretch; gap: 10px; }
      .pf-aic__levelctl { width: 100%; align-items: stretch; }
      .pf-aic__levelctl .pf-aic__link { align-self: flex-start; }
      .pf-aic__levelname { align-self: flex-start; text-align: left; }
      .pf-aic__copy { width: 100%; justify-content: center; }
      .pf-aic__link { min-height: 44px; }
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
  readonly steps = CLAUDE_STEPS;
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
  readonly tab = computed<AicTab>(() => (this.picked() === 'apps' && !this.showApps() ? 'settings' : this.picked()));

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
