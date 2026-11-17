import {
  ChangeDetectionStrategy, Component, DestroyRef, NgZone, OnInit, computed, effect, inject, input, output, signal,
} from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WaConnectState, WaSettings, WaSignupConfig, WaSignupResult, WaTenantTemplate, WhatsAppService,
} from '../../../core/services/whatsapp.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import {
  EmbeddedSignupMessage, FacebookSdk, loadFacebookSdk, parseEmbeddedSignupMessage,
} from '../../../shared/utils/whatsapp-embedded-signup';

/** One Embedded Signup attempt: the signed state (from our server), the code
 *  (from FB.login) and the session info (from Meta's postMessage) arrive in
 *  any order; complete runs once all that can arrive has. */
interface Attempt {
  state: string | null;
  loginDone: boolean;
  code: string | null;
  info: EmbeddedSignupMessage | null;
  infoWaitOver: boolean;
  sent: boolean;
}

/** How long to wait for Meta's session message after the code arrives (the
 *  code lives 30 s; coexistence may never send phone_number_id). */
export const WA_INFO_WAIT_MS = 2500;

/**
 * Lab settings → "Your WhatsApp number": the lab connects its OWN WhatsApp
 * Business number through Meta Embedded Signup (Facebook JS SDK, loaded only
 * here), sees its health, and can disconnect back to the shared Prefrontal
 * number. States come from the server: not connected · connecting ·
 * connected · action needed. Connect / Disconnect need `manage_tenant`; the
 * Connect button exists only while WhatsApp:EmbeddedSignupEnabled is on.
 */
@Component({
  selector: 'pf-wa-connect-card',
  standalone: true,
  imports: [BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-card pf-wac" data-testid="ls-wa-connect-card" [attr.data-state]="state()">
      <div class="pf-card__head">
        <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg></span>
        <h3 class="pf-card__label pf-wac__title">Your WhatsApp number</h3>
        <span class="pf-card__spacer"></span>
        <span class="pf-chip pf-chip--static pf-wac__state" data-testid="wac-state">
          <span class="pf-wac__dot" [attr.data-tone]="tone()" aria-hidden="true"></span>{{ stateLabel() }}
        </span>
      </div>

      <div class="pf-wac__body">
        @switch (state()) {
          @case ('not_connected') {
            <p class="pf-wac__lead">
              Reports go from <strong>Prefrontal's shared WhatsApp number</strong>, with your lab's name in the message.
              Connect your own WhatsApp Business number so patients see your lab's name and number.
            </p>
          }
          @case ('connecting') {
            <p class="pf-wac__lead pf-wac__lead--status" role="status">
              <svg class="pf-wac__spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>
              Finish the steps in the Meta window. Keep this page open — we'll set up your number when you're done.
            </p>
          }
          @case ('action_needed') {
            <div class="pf-wac__alert" role="alert" data-testid="wac-alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>
              <div>
                <p class="pf-wac__alert-t">Action needed</p>
                <p class="pf-wac__alert-s">{{ actionText() }}</p>
                @if (sender()?.source !== 'tenant') {
                  <p class="pf-wac__alert-s">Until this is fixed, reports go from Prefrontal's shared number.</p>
                }
              </div>
            </div>
          }
        }

        @if (hasNumber()) {
          <dl class="pf-wac__facts" data-testid="wac-facts">
            <div class="pf-wac__fact"><dt>Business name</dt><dd>{{ sender()?.verifiedName || '—' }}</dd></div>
            <div class="pf-wac__fact"><dt>Number</dt><dd class="pf-wac__num">{{ sender()?.displayPhoneNumber || '—' }}</dd></div>
            <div class="pf-wac__fact"><dt>Quality</dt>
              <dd><span class="pf-wac__dot" [attr.data-tone]="qualityTone()" aria-hidden="true"></span>{{ qualityLabel() }}</dd></div>
            <div class="pf-wac__fact"><dt>Messaging limit</dt><dd>{{ limitLabel() }}</dd></div>
          </dl>
          @if (templates().length) {
            <ul class="pf-wac__tpls" data-testid="wac-templates" aria-label="Message templates on your WhatsApp account">
              @for (t of templates(); track t.kind) {
                <li class="pf-wac__tpl">
                  <span class="pf-wac__tpl-name">{{ t.kind === 'pdf' ? 'Report with PDF' : 'Report link' }}
                    <span class="pf-wac__tpl-code">{{ t.name }}</span></span>
                  <span class="pf-chip pf-chip--static pf-wac__tpl-st" [attr.data-tone]="templateTone(t)">
                    <span class="pf-wac__dot" [attr.data-tone]="templateTone(t)" aria-hidden="true"></span>{{ templateLabel(t) }}
                  </span>
                  @if (t.reason) { <span class="pf-wac__tpl-why">{{ t.reason }}</span> }
                </li>
              }
            </ul>
            @if (state() === 'connected' && sender()?.source !== 'tenant') {
              <p class="pf-wac__hint">Meta is reviewing your report template. Reports keep going from the shared number until it's approved — then they switch to yours automatically.</p>
            }
          }
        }

        @if (canManage() && (showConnect() || hasNumber())) {
          <div class="pf-wac__actions">
            @if (showConnect()) {
              <button type="button" class="pf-btn pf-btn--secondary pf-wac__btn" data-testid="wac-connect"
                      [disabled]="busy() || !sdkReady()" [pfBusy]="localConnecting()" pfBusyLabel="Connecting…" (click)="connect()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>
                {{ hasNumber() ? 'Reconnect WhatsApp' : 'Connect WhatsApp' }}
              </button>
            }
            @if (hasNumber()) {
              <button type="button" class="pf-btn pf-btn--secondary pf-wac__btn" data-testid="wac-refresh"
                      [disabled]="busy()" [pfBusy]="busyAction() === 'refresh'" pfBusyLabel="Checking…" (click)="refresh()">Check status</button>
              <button type="button" class="pf-btn pf-btn--danger pf-wac__btn" data-testid="wac-disconnect"
                      [disabled]="busy()" [pfBusy]="busyAction() === 'disconnect'" pfBusyLabel="Disconnecting…" (click)="disconnect()">Disconnect</button>
            }
          </div>
          @if (showConnect() && !hasNumber()) {
            <p class="pf-wac__hint">You'll sign in with Facebook, pick your business and WhatsApp number. You can keep using the WhatsApp Business app on the same number.</p>
          }
          @if (sdkError()) { <p class="pf-wac__hint pf-wac__hint--err" role="alert">{{ sdkError() }}</p> }
        } @else if (!canManage() && state() === 'not_connected' && canConnect()) {
          <p class="pf-wac__hint">Ask your lab admin to connect your WhatsApp number.</p>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-wac { margin-bottom: 16px; }
    .pf-wac__title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-wac__state { height: auto; min-height: 28px; gap: 6px; white-space: nowrap; }
    .pf-wac__body { padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
    .pf-wac__lead { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
    .pf-wac__lead--status { display: flex; gap: 8px; align-items: flex-start; }
    .pf-wac__lead strong { color: var(--text-primary); font-weight: 600; }
    .pf-wac__spin { flex-shrink: 0; margin-top: 2px; color: var(--color-violet-500, #7c3aed); animation: pf-wac-spin 0.9s linear infinite; }
    @keyframes pf-wac-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .pf-wac__spin { animation: none; } }

    .pf-wac__dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; background: var(--text-tertiary, #94a3b8); flex-shrink: 0; }
    .pf-wac__dot[data-tone='ok']   { background: var(--color-violet-500, #7c3aed); }
    .pf-wac__dot[data-tone='wait'] { background: #d97706; }
    .pf-wac__dot[data-tone='bad']  { background: #dc2626; }

    .pf-wac__alert { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--pf-radius, 12px);
      border: 1px solid rgba(220, 38, 38, 0.35); background: rgba(220, 38, 38, 0.06); color: #b91c1c; }
    .pf-wac__alert svg { flex-shrink: 0; margin-top: 1px; }
    .pf-wac__alert-t { margin: 0; font-size: 13px; font-weight: 600; }
    .pf-wac__alert-s { margin: 2px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }

    .pf-wac__facts { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px 16px; }
    .pf-wac__fact { min-width: 0; }
    .pf-wac__fact dt { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-wac__fact dd { margin: 3px 0 0; font-size: 13.5px; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-wac__num { font-variant-numeric: tabular-nums; }

    .pf-wac__tpls { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-top: 1px solid var(--pf-line, rgba(148,163,184,0.25)); }
    .pf-wac__tpl { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 10px 0; border-bottom: 1px solid var(--pf-line, rgba(148,163,184,0.25)); }
    .pf-wac__tpl-name { flex: 1 1 200px; font-size: 13px; color: var(--text-primary); }
    .pf-wac__tpl-code { display: block; font-size: 11.5px; color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-wac__tpl-st { height: auto; min-height: 28px; }
    .pf-wac__tpl-why { flex-basis: 100%; font-size: 12px; color: var(--text-secondary); }

    .pf-wac__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-wac__btn { min-height: 40px; display: inline-flex; align-items: center; gap: 8px; }
    .pf-wac__hint { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); }
    .pf-wac__hint--err { color: #b91c1c; }

    :host-context([data-theme='dark']) .pf-wac__alert { color: #fca5a5; border-color: rgba(248,113,113,0.4); background: rgba(248,113,113,0.08); }
    :host-context([data-theme='dark']) .pf-wac__hint--err { color: #fca5a5; }

    @media (max-width: 640px) {
      .pf-wac__body { padding: 12px 14px 16px; }
      .pf-wac__actions { flex-direction: column; }
      .pf-wac__btn { width: 100%; min-height: 44px; justify-content: center; }
      .pf-wac__facts { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class WaConnectCardComponent implements OnInit {
  readonly settings = input.required<WaSettings>();
  /** New settings after connect / refresh / disconnect — the page replaces its copy. */
  readonly changed = output<WaSettings>();

  private readonly wa = inject(WhatsAppService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly busy = signal(false);
  /** Which of Check status / Disconnect is running (its button shows the dots). */
  protected readonly busyAction = signal<'refresh' | 'disconnect' | null>(null);
  /** Local "connecting" while the popup is open (the server state catches up on reload). */
  protected readonly localConnecting = signal(false);
  private readonly sdk = signal<FacebookSdk | null>(null);
  private readonly config = signal<WaSignupConfig | null>(null);
  protected readonly sdkError = signal<string | null>(null);
  protected readonly sdkReady = computed(() => !!this.sdk() && !!this.config());
  private attempt: Attempt | null = null;

  protected readonly sender = computed(() => this.settings().sender ?? null);
  readonly canConnect = computed(() => !!this.sender()?.canConnect);
  readonly canManage = computed(() => this.auth.hasPermission('manage_tenant'));

  readonly state = computed<WaConnectState>(() => {
    if (this.localConnecting()) return 'connecting';
    const s = this.sender();
    if (!s) return 'not_connected';
    if (s.state) return s.state;
    // Older server: derive from the raw status.
    if (s.status === 'connected') return 'connected';
    if (s.status === 'error') return 'action_needed';
    return 'not_connected';
  });

  protected readonly hasNumber = computed(() => !!this.sender()?.phoneNumberId && this.sender()?.tokenStored === true);
  protected readonly showConnect = computed(() =>
    this.canConnect() && this.state() !== 'connecting' && (this.state() !== 'connected'));
  protected readonly templates = computed<WaTenantTemplate[]>(() => this.sender()?.templates ?? []);

  readonly stateLabel = computed(() => ({
    not_connected: 'Using Prefrontal number',
    connecting: 'Connecting',
    connected: 'Connected',
    action_needed: 'Action needed',
  })[this.state()]);

  readonly tone = computed(() => ({ not_connected: 'muted', connecting: 'wait', connected: 'ok', action_needed: 'bad' })[this.state()]);

  readonly actionText = computed(() => {
    const s = this.sender();
    if (s?.error) return s.error;
    if (s?.paymentStatus === 'failed')
      return 'Meta could not charge your WhatsApp account (payment method error) — add or update the payment method in the billing card below.';
    const bad = this.templates().find(t => ['REJECTED', 'PAUSED', 'DISABLED', 'ERROR', 'NOT_FOUND'].includes((t.status ?? '').toUpperCase()));
    if (bad) {
      const what = bad.kind === 'pdf' ? 'report-with-PDF' : 'report';
      return `Meta ${this.templateLabel(bad).toLowerCase()} your ${what} template${bad.reason ? ` (${bad.reason})` : ''}.`;
    }
    return 'Your WhatsApp connection needs attention — reconnect to fix it.';
  });

  readonly qualityTone = computed(() => {
    switch ((this.sender()?.qualityRating ?? '').toUpperCase()) {
      case 'GREEN': return 'ok';
      case 'YELLOW': return 'wait';
      case 'RED': return 'bad';
      default: return 'muted';
    }
  });
  readonly qualityLabel = computed(() => {
    switch ((this.sender()?.qualityRating ?? '').toUpperCase()) {
      case 'GREEN': return 'High';
      case 'YELLOW': return 'Medium';
      case 'RED': return 'Low';
      default: return 'Not rated yet';
    }
  });
  readonly limitLabel = computed(() => waLimitLabel(this.sender()?.messagingLimitTier));

  templateLabel(t: WaTenantTemplate): string {
    switch ((t.status ?? '').toUpperCase()) {
      case 'APPROVED': return 'Approved';
      case 'PENDING': case 'IN_APPEAL': return 'In review';
      case 'REJECTED': return 'Rejected';
      case 'PAUSED': return 'Paused';
      case 'DISABLED': return 'Disabled';
      case 'NOT_FOUND': return 'Missing';
      case 'ERROR': return 'Not created';
      case '': return 'Not submitted';
      default: return t.status!;
    }
  }
  templateTone(t: WaTenantTemplate): string {
    const s = (t.status ?? '').toUpperCase();
    if (s === 'APPROVED') return 'ok';
    if (s === 'PENDING' || s === 'IN_APPEAL' || s === '') return 'wait';
    return 'bad';
  }

  constructor() {
    // Load the SDK only when this lab admin can actually connect.
    effect(() => {
      if (this.canConnect() && this.canManage() && !this.config() && !this.sdkError()) this.prepare();
    });
  }

  ngOnInit() {
    const onMessage = (ev: MessageEvent) => this.onMessage(ev);
    window.addEventListener('message', onMessage);
    this.destroyRef.onDestroy(() => window.removeEventListener('message', onMessage));
  }

  private preparing = false;
  private prepare() {
    if (this.preparing) return;
    this.preparing = true;
    this.wa.signupConfig().subscribe({
      next: cfg => {
        this.config.set(cfg);
        loadFacebookSdk(cfg.appId, cfg.graphVersion).then(
          fb => this.zone.run(() => this.sdk.set(fb)),
          e => this.zone.run(() => this.sdkError.set(e instanceof Error ? e.message : 'Could not load Facebook sign-in.')),
        );
      },
      error: e => { this.preparing = false; this.sdkError.set(ApiError.from(e).message); },
    });
  }

  /** FB.login runs synchronously inside the click (popup blockers); the
   *  signed state is fetched in parallel and joined before complete. */
  connect() {
    const fb = this.sdk();
    const cfg = this.config();
    if (!fb || !cfg || this.busy()) return;
    const a: Attempt = { state: null, loginDone: false, code: null, info: null, infoWaitOver: false, sent: false };
    this.attempt = a;
    this.busy.set(true);
    this.localConnecting.set(true);

    this.wa.startOnboarding().subscribe({
      next: r => { a.state = r.state; this.tryComplete(a); },
      error: e => { this.finish(a); this.toasts.error(ApiError.from(e).message); },
    });

    fb.login(resp => this.zone.run(() => {
      a.loginDone = true;
      a.code = resp?.authResponse?.code ?? null;
      if (a.code && !a.info) {
        setTimeout(() => this.zone.run(() => { a.infoWaitOver = true; this.tryComplete(a); }), WA_INFO_WAIT_MS);
      }
      this.tryComplete(a);
    }), {
      config_id: cfg.configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: cfg.extras,
    });
  }

  /** Meta's WA_EMBEDDED_SIGNUP postMessage — only from facebook.com. */
  onMessage(ev: MessageEvent) {
    const m = parseEmbeddedSignupMessage(ev);
    const a = this.attempt;
    if (!m || !a || a.sent) return;
    this.zone.run(() => {
      a.info = m;
      this.tryComplete(a);
    });
  }

  private tryComplete(a: Attempt) {
    if (a.sent || this.attempt !== a || !a.state) return;
    const ev = a.info?.event ?? null;
    const aborted = ev === 'CANCEL' || ev === 'ERROR';
    // Wait for the login callback unless Meta already told us it was aborted.
    if (!a.loginDone && !aborted) return;
    // With a code, give the session message a moment (it carries the ids).
    if (a.code && !a.info && !a.infoWaitOver) return;
    a.sent = true;

    const body: WaSignupResult = {
      state: a.state,
      code: aborted ? null : a.code,
      wabaId: a.info?.wabaId ?? null,
      phoneNumberId: a.info?.phoneNumberId ?? null,
      businessId: a.info?.businessId ?? null,
      event: ev ?? (a.code ? 'FINISH' : 'CANCEL'),
      errorMessage: a.info?.errorMessage ?? null,
    };
    this.wa.completeOnboarding(body).subscribe({
      next: s => {
        this.finish(a);
        this.changed.emit(s);
        this.toasts.success('Your WhatsApp number is connected');
      },
      error: e => {
        this.finish(a);
        const err = ApiError.from(e);
        if (err.code !== 'cancelled') this.toasts.error(err.message);
        this.reload();
      },
    });
  }

  private finish(a: Attempt) {
    if (this.attempt === a) this.attempt = null;
    this.busy.set(false);
    this.localConnecting.set(false);
  }

  private reload() {
    this.wa.settings().subscribe({ next: s => this.changed.emit(s), error: () => undefined });
  }

  refresh() {
    if (this.busy()) return;
    this.busy.set(true);
    this.busyAction.set('refresh');
    this.wa.refreshOnboarding().subscribe({
      next: s => { this.busy.set(false); this.busyAction.set(null); this.changed.emit(s); this.toasts.success('WhatsApp status updated'); },
      error: e => { this.busy.set(false); this.busyAction.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }

  async disconnect() {
    if (this.busy()) return;
    const ok = await this.dialog.confirm({
      title: 'Disconnect your WhatsApp number?',
      message: 'Reports will go from Prefrontal\'s shared WhatsApp number again, with your lab\'s name in the message. You can connect your number again at any time.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;
    this.busy.set(true);
    this.busyAction.set('disconnect');
    this.wa.disconnect().subscribe({
      next: s => { this.busy.set(false); this.busyAction.set(null); this.changed.emit(s); this.toasts.success('Disconnected — reports go from the shared Prefrontal number'); },
      error: e => { this.busy.set(false); this.busyAction.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }
}

/** "TIER_2K" → "2,000 conversations / day"; "TIER_UNLIMITED" → "Unlimited". */
export function waLimitLabel(tier: string | null | undefined): string {
  const t = (tier ?? '').toUpperCase();
  if (!t) return 'Not known yet';
  if (t.includes('UNLIMITED')) return 'Unlimited';
  const m = /TIER_(\d+)(K?)/.exec(t);
  if (!m) return tier!;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return `${n.toLocaleString('en-IN')} business-initiated / day`;
}
