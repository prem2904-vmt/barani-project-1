import { Injectable, Injector, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, SessionEndReason } from './auth.service';
import { PushService } from '../services/push.service';
import { ChatService } from '../services/chat.service';
import { SignalingService } from '../services/signaling.service';
import { WebrtcService } from '../services/webrtc.service';
import { PatientProfileService } from '../services/patient-profile.service';
import { AppointmentBookingService } from '../services/appointment-booking.service';
import { TenantStateService } from '../services/tenant-state.service';
import { BranchLabConfigService } from '../services/branch-lab-config.service';
import { TenantEntitlementsService } from '../services/tenant-entitlements.service';

/** Named steps of the sign-out sequence, in the order they run. */
export type SignOutStep =
  | 'revoke' | 'push' | 'sockets' | 'timers' | 'clear' | 'navigate';

/** Ceiling per network step: sign-out must finish even offline. */
const STEP_TIMEOUT_MS = 4000;

function settle(p: Promise<unknown> | unknown, ms = STEP_TIMEOUT_MS): Promise<void> {
  return Promise.race([
    Promise.resolve(p).then(() => undefined, () => undefined),
    new Promise<void>(r => setTimeout(r, ms)),
  ]);
}

/**
 * The ONE sign-out sequence (login audit 2026-09-29). There used to be six
 * entry points — the avatar menu, the phone "More" sheet, the forced
 * password screen, the idle-lock escape hatch, the HTTP interceptor and the
 * profile loader — each doing a different subset: only the avatar menu
 * closed the sockets, only two unregistered push (a forced sign-out kept
 * ringing the phone), none replaced history, and the authed UI flashed empty
 * before the login screen came up. Every path now runs, in order:
 *
 *  1. revoke   — this device's refresh token, server side (best effort);
 *  2. push     — unregister this device (web VAPID / APNs / FCM + VoIP),
 *                while the access token still authenticates;
 *  3. sockets  — close the chat + signaling hubs, reset WebRTC;
 *  4. timers   — stop the refresh tick, close overlays, reset tenant caches;
 *  5. clear    — tokens, user / tenant / permission state, session storage
 *                keys (per-device conveniences stay), other tabs told;
 *  6. navigate — /login with history REPLACED, carrying the reason note and
 *                (for an expiry) the return URL.
 *
 * A cover (`ending`) hides the app from step 1 until the login screen is in
 * place, so the half-cleared authed UI never paints. Concurrent calls join
 * the running sequence — a burst of 401s ends the session exactly once.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private readonly _ending = signal(false);
  /** True while a sign-out is running — drives the full-screen cover and
   *  tells the interceptor not to retry / redirect anything meanwhile. */
  readonly ending = this._ending.asReadonly();

  private running: Promise<void> | null = null;
  /** Test hook: every step as it runs. */
  onStep: ((step: SignOutStep) => void) | null = null;

  constructor() {
    this.auth.setSessionEndHandler((reason) => this.end(reason));
  }

  /** The user chose to sign out. */
  logout(): Promise<void> {
    return this.end('user');
  }

  /**
   * The session can't continue (dead refresh token, suspended tenant). One
   * clean redirect to the login screen with a note and the return URL; a
   * call with no session left (a stray 401 after sign-out) only makes sure
   * we are on the login screen — it never starts a second sequence.
   */
  expire(reason: Extract<SessionEndReason, 'expired' | 'suspended'> = 'expired'): Promise<void> {
    if (this.running) return this.running;
    if (!this.auth.session() && !this.auth.user()) {
      const url = this.router.url || '/';
      if (SessionService.isPublicUrl(url)) return Promise.resolve();
      return this.router.navigate(['/login'], {
        replaceUrl: true,
        queryParams: SessionService.loginParams(reason, url),
      }).then(() => undefined, () => undefined);
    }
    return this.end(reason);
  }

  private end(reason: SessionEndReason): Promise<void> {
    this.running ??= this.run(reason).finally(() => { this.running = null; });
    return this.running;
  }

  private step(s: SignOutStep): void {
    try { this.onStep?.(s); } catch { /* test hook */ }
  }

  private get<T>(token: new (...args: never[]) => T): T | null {
    try { return this.injector.get(token); } catch { return null; }
  }

  private async run(reason: SessionEndReason): Promise<void> {
    const from = this.router.url || '/';
    this._ending.set(true);
    try {
      // 1. Revoke — only for a chosen sign-out: an expired session has no
      //    live token to revoke with, and "elsewhere" was revoked by the tab
      //    that signed out.
      this.step('revoke');
      if (reason === 'user') await settle(this.auth.revokeSession());

      // 2. Push — needs the (still valid) access token, so before the clear.
      //    Another tab signing out already dropped this browser's web push.
      this.step('push');
      if (reason !== 'elsewhere') await settle(this.get(PushService)?.unregister());

      // 3. Sockets.
      this.step('sockets');
      await settle(this.get(ChatService)?.disconnect());
      await settle(this.get(SignalingService)?.disconnect());
      try { this.get(WebrtcService)?.reset(); } catch { /* no call */ }

      // 4. Timers / pollers / overlays / tenant caches. (User-scoped pollers
      //    stop themselves when the user signal clears in step 5.)
      this.step('timers');
      this.auth.stopSessionTimers();
      try { this.get(PatientProfileService)?.close(); } catch { /* */ }
      try { this.get(AppointmentBookingService)?.close(); } catch { /* */ }
      try { this.get(TenantStateService)?.reset(); } catch { /* */ }
      try { this.get(BranchLabConfigService)?.reset(); } catch { /* */ }
      try { this.get(TenantEntitlementsService)?.reset(); } catch { /* */ }

      // 5. Clear.
      this.step('clear');
      this.auth.clearLocalSession({ broadcast: reason !== 'elsewhere' });

      // 6. Navigate — replace the current entry; the authed entries behind
      //    it are guarded, so Back lands on the login screen, never the app.
      this.step('navigate');
      await this.router.navigate(['/login'], {
        replaceUrl: true,
        queryParams: SessionService.loginParams(reason, from),
      }).catch(() => false);
    } finally {
      this._ending.set(false);
    }
  }

  /** The login screen's query: the note to show and where to go back to. */
  static loginParams(reason: SessionEndReason, from: string): Record<string, string> | undefined {
    if (reason === 'user') return undefined;
    const params: Record<string, string> = { reason };
    if (reason === 'expired' && SessionService.isReturnable(from)) params['returnUrl'] = from;
    return params;
  }

  /** Worth returning to after signing in again. */
  static isReturnable(url: string): boolean {
    return !!url && url !== '/' && url.startsWith('/') && !url.startsWith('//')
      && !url.startsWith('/login') && !url.startsWith('/set-password');
  }

  /** Public, no-login pages (invoice QR tracking, the patient report link). */
  static isPublicUrl(url: string): boolean {
    return url.startsWith('/login') || url.startsWith('/track/') || url.startsWith('/reports/public/');
  }
}
