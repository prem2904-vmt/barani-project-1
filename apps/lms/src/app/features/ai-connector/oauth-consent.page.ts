import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SessionService } from '../../core/auth/session.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../shared/directives/busy.directive';
import { SkeletonFormComponent } from '../../shared/primitives/skeleton-kit.component';
import { AI_CONNECTOR_CAN_SEE, AiConnectorApi, AiConnectorState } from './ai-connector.api';
import { ConsentRedirector } from './consent-redirect';
import {
  ConsentError, ConsentErrorKind, OAuthAuthorizationDetails, OAuthConsentClient, consentErrorText,
  isConsentNeeded, redirectHost, safeRedirectUrl,
} from './oauth-consent.client';

/** What the screen is showing. */
export type ConsentPhase = 'loading' | 'ready' | 'error' | 'leaving';

/**
 * /oauth/consent?authorization_id=… — Supabase's OAuth 2.1 server sends the
 * browser here when an AI app (Claude, ChatGPT…) asks to connect to the lab.
 * Outside the shell, like /login (consentGuard handles signed-out and the
 * temporary-password case, keeping this exact URL).
 *
 * ND pattern: band (tenant · context chips: the app, Read only, who is signed
 * in) → ACCESS main card (what the app could read, in plain words) + REQUEST
 * side card (app, lab, user, where you go back to) whose footer holds the
 * decision: **Allow** is the one primary, **Deny** always there. Never
 * auto-approves — only the Allow button calls approve(). The lab switch off ⇒
 * explain + Deny only. The app's name is untrusted text: interpolated (text),
 * never bound as HTML, never its logo URL.
 */
@Component({
  selector: 'pf-oauth-consent',
  standalone: true,
  imports: [HeroBandComponent, BusyDirective, SkeletonFormComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-oc">
      <pf-hero-band [customSearch]="true" [contextBar]="true">
        <div band-search class="pf-ctx" aria-label="Request">
          <span class="pf-ctx__primary pf-oc__app">{{ appName() || 'Connect an app' }}</span>
          <span class="pf-ctx__chip"><span class="pf-ctx__k">Access</span>Read only</span>
          @if (userName()) {
            <span class="pf-ctx__chip pf-oc__hide-phone"><span class="pf-ctx__k">Signed in</span>{{ userName() }}</span>
          }
        </div>
      </pf-hero-band>

      <div class="pf-oc__body">
        <div class="pf-oc__grid" [class.pf-oc__grid--solo]="phase() === 'error'">
          <section class="pf-card pf-oc__main" aria-labelledby="pf-oc-title">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7H6a4 4 0 0 0 0 8h3M15 7h3a4 4 0 0 1 0 8h-3M8 11h8"/></svg>
              </span>
              <h1 class="pf-card__label" id="pf-oc-title">Connect an app</h1>
            </header>
            <div class="pf-card__body pf-oc__mainbody" aria-live="polite">
              @switch (phase()) {
                @case ('loading') {
                  <pf-skeleton-form [fields]="4" [cols]="1" label="Loading the request…"></pf-skeleton-form>
                }
                @case ('error') {
                  <div class="pf-oc__state" role="alert">
                    <span class="pf-oc__state-icon" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
                    </span>
                    <p class="pf-oc__state-title">{{ errorTitle() }}</p>
                    <p class="pf-oc__state-body">{{ errorText() }}</p>
                    <div class="pf-oc__state-actions">
                      @if (errorKind() === 'signed-out') {
                        <button type="button" class="pf-btn pf-btn--primary press" (click)="signInAgain()">Sign in again</button>
                      } @else if (errorKind() === 'network') {
                        <button type="button" class="pf-btn pf-btn--secondary press" (click)="load()">Try again</button>
                      } @else if (errorKind() !== 'framed') {
                        <a class="pf-btn pf-btn--tertiary press" routerLink="/">Open Prefrontal</a>
                      }
                    </div>
                  </div>
                }
                @case ('leaving') {
                  <div class="pf-oc__state">
                    <p class="pf-oc__state-title">Taking you back to {{ appName() || 'the app' }}…</p>
                    <p class="pf-oc__state-body">You can close this tab if it doesn’t move on its own.</p>
                  </div>
                }
                @default {
                  @if (labOff()) {
                    <div class="pf-oc__note" role="status">
                      <span class="pf-oc__note-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                      </span>
                      <div>
                        <p class="pf-oc__note-title">Your lab hasn’t turned on AI connectors</p>
                        <p class="pf-oc__note-body">Ask your lab admin to switch them on in Lab settings → AI connectors, then connect again. For now you can only deny this request.</p>
                      </div>
                    </div>
                  } @else if (connectorError()) {
                    <div class="pf-oc__note" role="alert">
                      <span class="pf-oc__note-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
                      </span>
                      <div>
                        <p class="pf-oc__note-title">Couldn’t check your lab’s AI connector setting</p>
                        <p class="pf-oc__note-body">Check your connection and try again. You can still deny this request.</p>
                      </div>
                    </div>
                  }
                  <p class="pf-oc__lead"><strong class="pf-oc__name">{{ appName() }}</strong> wants to read your lab’s numbers.</p>
                  <h2 class="pf-oc__sec">It could see</h2>
                  <ul class="pf-oc__list">
                    @for (line of canSee; track line) {
                      <li class="pf-oc__item">
                        <svg class="pf-oc__tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                        <span>{{ line }}</span>
                      </li>
                    }
                  </ul>
                  <p class="pf-oc__readonly">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/></svg>
                    <span>Read only — it can’t add, change or delete anything. It sees only what your own account may see.</span>
                  </p>
                }
              }
            </div>
          </section>

          @if (phase() !== 'error') {
            <aside class="pf-card pf-oc__side" aria-label="Request details">
              <header class="pf-card__head">
                <span class="pf-card__icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>
                </span>
                <h2 class="pf-card__label">Request</h2>
              </header>
              <div class="pf-card__body">
                <dl class="pf-oc__facts">
                  <div class="pf-oc__fact"><dt>App</dt><dd class="pf-oc__name">{{ appName() || '—' }}</dd></div>
                  <div class="pf-oc__fact"><dt>Lab</dt><dd>{{ labName() || '—' }}</dd></div>
                  <div class="pf-oc__fact"><dt>Signed in as</dt><dd>{{ userName() || '—' }}</dd></div>
                  @if (backTo()) {
                    <div class="pf-oc__fact"><dt>Goes back to</dt><dd class="pf-oc__host">{{ backTo() }}</dd></div>
                  }
                </dl>
                <p class="pf-field__hint">Only allow an app you started connecting yourself. You can turn the connection off later in that app.</p>
                @if (decideError()) {
                  <p class="pf-oc__err" role="alert">{{ decideError() }}</p>
                }
              </div>
              <div class="pf-card__foot pf-oc__foot">
                @if (connectorError() && phase() === 'ready') {
                  <button type="button" class="pf-btn pf-btn--secondary press" (click)="load()" [disabled]="!!busy()">Try again</button>
                }
                <button type="button" class="pf-btn pf-btn--secondary press pf-oc__deny"
                        [class.pf-span]="!canAllow() && !connectorError()"
                        [disabled]="phase() !== 'ready' || !!busy()"
                        [pfBusy]="busy() === 'deny'" pfBusyLabel="Denying…" (click)="deny()">
                  {{ busy() === 'deny' ? 'Denying…' : 'Deny' }}
                </button>
                @if (canAllow()) {
                  <button type="button" class="pf-btn pf-btn--primary press pf-oc__allow"
                          [disabled]="!!busy()"
                          [pfBusy]="busy() === 'allow'" pfBusyLabel="Allowing…" (click)="allow()">
                    {{ busy() === 'allow' ? 'Allowing…' : 'Allow' }}
                  </button>
                }
              </div>
            </aside>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100dvh; background: var(--bg-primary); }
    .pf-oc { --pf-hb-bleed: 0px; display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .pf-oc > pf-hero-band { flex: none; }
    .pf-oc__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 16px 24px; }
    .pf-oc__grid { display: grid; gap: 16px; max-width: 1040px; margin: 0 auto; grid-template-columns: minmax(0, 1fr) 380px; align-items: start; }
    .pf-oc__grid--solo { grid-template-columns: minmax(0, 560px); justify-content: center; }
    .pf-oc__mainbody { gap: 14px; padding: 18px 20px 20px; }
    .pf-oc__lead { margin: 0; font-size: 17px; line-height: 1.45; color: var(--text-primary); text-wrap: pretty; }
    .pf-oc__name { font-weight: 600; overflow-wrap: anywhere; }
    .pf-oc__app { overflow-wrap: anywhere; }
    .pf-oc__sec { margin: 4px 0 0; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-oc__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .pf-oc__item { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.45; color: var(--text-primary); }
    .pf-oc__tick { flex: none; margin-top: 2px; color: var(--violet-text, #7c3aed); }
    .pf-oc__readonly { display: flex; align-items: flex-start; gap: 10px; margin: 4px 0 0; padding: 12px 14px; border-radius: 12px;
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg, transparent); font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
    .pf-oc__readonly svg { flex: none; margin-top: 1px; color: var(--violet-text, #7c3aed); }
    .pf-oc__note { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--amber-text, #b45309) 35%, var(--pf-line)); background: color-mix(in srgb, var(--amber-text, #b45309) 7%, transparent); }
    .pf-oc__note-icon { flex: none; color: var(--amber-text, #b45309); margin-top: 1px; }
    .pf-oc__note-title { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-oc__note-body { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .pf-oc__facts { margin: 0; display: grid; gap: 0; }
    .pf-oc__fact { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--pf-line); }
    .pf-oc__fact dt { font-size: 12.5px; color: var(--text-tertiary); flex: none; }
    .pf-oc__fact dd { margin: 0; font-size: 13.5px; font-weight: 500; color: var(--text-primary); text-align: right; min-width: 0; overflow-wrap: anywhere; }
    .pf-oc__host { font-variant-numeric: tabular-nums; }
    .pf-oc__err { margin: 0; font-size: 13px; line-height: 1.45; color: var(--red-text, #b91c1c); }
    .pf-oc__state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 28px 8px; }
    .pf-oc__state-icon { display: inline-flex; color: var(--text-tertiary); }
    .pf-oc__state-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-oc__state-body { margin: 0; max-width: 380px; font-size: 13px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .pf-oc__state-actions { margin-top: 8px; display: flex; gap: 10px; }
    .pf-oc__state-actions .pf-btn { min-width: 160px; text-decoration: none; }

    @media (max-width: 1023px) {
      .pf-oc__grid { grid-template-columns: minmax(0, 1fr); max-width: 640px; }
    }
    /* Phones: one column that scrolls; the decision rides a bar at the
       bottom (thumb reach), above the home indicator. */
    @media (max-width: 640px) {
      .pf-oc__body { padding: 4px 16px calc(96px + env(safe-area-inset-bottom)); }
      .pf-oc__hide-phone { display: none; }
      .pf-oc__mainbody { padding: 16px; }
      .pf-oc__lead { font-size: 16px; }
      /* ND §12: card labels are 12px on phones — beat the global phone heading cap. */
      .pf-card__label { font-size: 12px !important; line-height: 1.3 !important; }
      .pf-oc__sec { font-size: 11px !important; line-height: 1.3 !important; }
      .pf-oc__foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; border-radius: 0;
        padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); box-shadow: 0 -6px 18px rgba(15, 23, 42, .08); }
    }
  `],
})
export class OAuthConsentPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);
  private readonly client = inject(OAuthConsentClient);
  private readonly connectorApi = inject(AiConnectorApi);
  private readonly redirector = inject(ConsentRedirector);

  readonly canSee = AI_CONNECTOR_CAN_SEE;
  readonly phase = signal<ConsentPhase>('loading');
  readonly details = signal<OAuthAuthorizationDetails | null>(null);
  readonly connector = signal<AiConnectorState | null>(null);
  readonly connectorError = signal(false);
  readonly errorKind = signal<ConsentErrorKind | null>(null);
  readonly busy = signal<'allow' | 'deny' | null>(null);
  readonly decideError = signal<string | null>(null);

  /** The client name exactly as Supabase returns it (rendered as text). */
  readonly appName = computed(() => this.details()?.client?.name?.trim() || '');
  readonly userName = computed(() => this.auth.user()?.displayName || '');
  readonly labName = computed(() => this.connector()?.labName || this.auth.user()?.tenantName || '');
  readonly backTo = computed(() => redirectHost(this.details()?.redirect_uri));
  /** The lab switch is OFF (only once the server said so). */
  readonly labOff = computed(() => this.connector()?.enabled === false);
  /** Allow only with a live request AND the lab's switch confirmed ON. */
  readonly canAllow = computed(() => this.phase() === 'ready' && this.connector()?.enabled === true);
  readonly errorText = computed(() => consentErrorText(this.errorKind() ?? 'unknown'));
  readonly errorTitle = computed(() => {
    switch (this.errorKind()) {
      case 'signed-out': return 'Sign in again';
      case 'network': return 'No connection';
      case 'framed': return 'Open this page directly in your browser';
      default: return 'This request can’t be used';
    }
  });

  private get authorizationId(): string {
    return this.route.snapshot.queryParamMap.get('authorization_id')?.trim() ?? '';
  }

  ngOnInit(): void {
    // Clickjacking guard: this page is only ever used as a top-level page. Inside a frame we
    // never load the request and never render Allow.
    if (OAuthConsentPage.isFramed()) { this.fail('framed'); return; }
    void this.load();
  }

  /** True when this page sits inside another page's frame (or the check itself is blocked). */
  static isFramed(): boolean {
    try { return typeof window !== 'undefined' && window.top !== window.self; } catch { return true; }
  }

  /** Read the request + the lab switch together. Already consented ⇒ straight back. */
  async load(): Promise<void> {
    const id = this.authorizationId;
    this.decideError.set(null);
    if (!id) { this.fail('missing'); return; }
    this.phase.set('loading');
    this.connectorError.set(false);
    const connectorP = firstValueFrom(this.connectorApi.get())
      .then(c => { this.connector.set(c); })
      .catch(() => { this.connector.set(null); this.connectorError.set(true); });
    try {
      const d = await this.client.getDetails(id);
      if (!isConsentNeeded(d)) { this.leave(d.redirect_url); return; }
      this.details.set(d);
    } catch (e) {
      this.fail(e instanceof ConsentError ? e.kind : 'unknown');
      return;
    }
    await connectorP;
    this.phase.set('ready');
  }

  async allow(): Promise<void> {
    if (!this.canAllow() || this.busy()) return;
    await this.decide('allow');
  }

  async deny(): Promise<void> {
    if (this.phase() !== 'ready' || this.busy()) return;
    await this.decide('deny');
  }

  private async decide(action: 'allow' | 'deny'): Promise<void> {
    const id = this.details()?.authorization_id;
    if (!id) return;
    this.busy.set(action);
    this.decideError.set(null);
    try {
      const r = action === 'allow' ? await this.client.approve(id) : await this.client.deny(id);
      this.leave(r?.redirect_url);
    } catch (e) {
      const kind = e instanceof ConsentError ? e.kind : 'unknown';
      if (kind === 'expired' || kind === 'signed-out' || kind === 'missing') this.fail(kind);
      else this.decideError.set(consentErrorText(kind));
    } finally {
      this.busy.set(null);
    }
  }

  /** Go back to the app — only to a safe absolute URL. */
  private leave(url: string | undefined): void {
    const safe = safeRedirectUrl(url);
    if (!safe) { this.fail('unknown'); return; }
    this.phase.set('leaving');
    this.redirector.go(safe);
  }

  private fail(kind: ConsentErrorKind): void {
    this.errorKind.set(kind);
    this.phase.set('error');
  }

  /** Dead session: the standard end-of-session sequence, back to /login with
   *  this consent URL as the return. */
  signInAgain(): void {
    void this.session.expire('expired');
  }
}
