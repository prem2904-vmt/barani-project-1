import { Injectable, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { SignalingService, isOnlineStatus } from './signaling.service';

/** How a call to a colleague will reach them right now. */
export type CallReach = 'online' | 'push' | 'offline';

/** Tooltip / aria text for a call button, by reach. */
export function callHint(reach: CallReach, name?: string): string {
  const who = name ? ` ${name}` : '';
  // Offline with no registered device: still callable (they may open the
  // app within the ring window); it just reads as a normal call.
  return reach === 'push' ? 'Will ring their devices' : `Voice call${who}`;
}

/**
 * OFFLINE CALLING — presence never blocks a call. A colleague with no live
 * connection is still callable: the server rings their registered phone /
 * browser by push (iOS VoIP → CallKit, Android full-screen FCM, Web Push).
 *
 * This service keeps the honest picture of who is reachable that way
 * (GET /api/devices/reachable — ids only, my tenant only), so the UI can
 *   • show such a person as "away" (not "online", not a dead "offline"), and
 *   • keep the call button enabled with the tooltip "Will ring their devices".
 */
@Injectable({ providedIn: 'root' })
export class CallReachService implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly signaling = inject(SignalingService);
  private readonly scope = inject(SessionScopeService);

  /** AuthIds reachable by push (have a ring-capable device). */
  readonly reachable = signal<Set<string>>(new Set());

  private static readonly REFRESH_MS = 3 * 60 * 1000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;

  constructor() {
    this.scope.onChange(() => this.reachable.set(new Set()));
    effect(() => {
      const signedIn = !!this.auth.user();
      untracked(() => {
        if (signedIn) {
          void this.refresh();
          if (!this.timer && typeof setInterval !== 'undefined') {
            this.timer = setInterval(() => void this.refresh(), CallReachService.REFRESH_MS);
          }
        } else if (this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
      });
    });
  }

  /** Re-read the reachable set (cheap; ids only). Never throws. */
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const ids = await firstValueFrom(this.api.get<string[]>('/api/devices/reachable'));
        this.reachable.set(new Set((ids ?? []).map(String)));
      } catch { /* keep the last known set */ }
      finally { this.inflight = null; }
    })();
    return this.inflight;
  }

  /** online (live socket) → push (rings a registered device) → offline. */
  reachOf(userId: string): CallReach {
    if (isOnlineStatus(this.signaling.userPresences().get(userId))) return 'online';
    return this.reachable().has(userId) ? 'push' : 'offline';
  }

  /** Connection presence for display: the hub's value when connected; a
   *  push-reachable person with no connection reads "away" (callable), not
   *  "offline". Never claims "online" for someone who isn't. */
  displayConnection(userId: string): string {
    const conn = this.signaling.userPresences().get(userId);
    if (conn) return conn;
    return this.reachable().has(userId) ? 'away' : 'offline';
  }

  hint(userId: string, name?: string): string {
    return callHint(this.reachOf(userId), name);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
