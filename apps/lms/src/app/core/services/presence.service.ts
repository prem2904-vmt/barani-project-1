import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  DisplayPresence, PresenceKey, isPresenceKey, presenceIsDnd, presenceLabel
} from '../../shared/models/presence.model';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { CallReachService } from './call-reach.service';
import { ApiService } from './api.service';
import { SignalingService } from './signaling.service';
import { ToastService } from './toast.service';

/**
 * My presence status + everyone else's CUSTOM statuses (Teams-style
 * presets: Available / Busy / With a patient / On rounds / In surgery /
 * Do not disturb / Away).
 *
 * - `myStatus` is set via PATCH /api/auth/me/status (persisted server-side
 *   across sessions) and mirrored to localStorage so a reload shows the
 *   last-known value immediately (the /me profile doesn't carry it).
 * - `others` is fed live from SignalR's `UserPresenceChanged` (the PATCH
 *   endpoint fans the new status out to the whole tenant) and seeded from
 *   any users-list payload that carries `presenceStatus` (e.g. /api/users).
 *   Keys are AuthIds — the same id space SignalR + the directory use.
 *
 * The hub's automatic connection presence ('active'/'away'/'in-a-call'/
 * 'offline') stays in SignalingService.userPresences; consumers combine
 * both: custom status when known + online, connection presence otherwise.
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly signaling = inject(SignalingService);
  private readonly toasts = inject(ToastService);
  private readonly scope = inject(SessionScopeService);
  private readonly reach = inject(CallReachService);

  /** Namespaced per tenant + user (`pf.myPresenceStatus:<tenant>:<user>`):
   *  the old device-wide key showed the previous account's "In surgery" on
   *  the next person's avatar. */
  private static readonly STORE_KEY = 'pf.myPresenceStatus';

  /** My own status. Seeded from the last value this device set for ME. */
  readonly myStatus = signal<PresenceKey>(this.readStored());
  /** True while my status is DND-grade (calls blocked, pushes silenced). */
  readonly myStatusIsDnd = computed(() => presenceIsDnd(this.myStatus()));
  readonly saving = signal(false);

  /** Others' custom statuses, keyed by AuthId. */
  private readonly _others = signal<Map<string, PresenceKey>>(new Map());
  readonly others = this._others.asReadonly();

  constructor() {
    // New account: its own last-known status, nobody else's cache.
    this.scope.onChange(() => {
      this.myStatus.set(this.readStored());
      this._others.set(new Map());
      this.saving.set(false);
    });
    // Live updates — the PATCH endpoint broadcasts UserPresenceChanged with
    // the custom key to the whole tenant (including my other devices).
    // Non-custom statuses ('active'/'in-a-call'/…) are connection presence
    // and stay in SignalingService; ignore them here.
    this.signaling.userPresenceChanged.subscribe(({ userId, status, custom }) => {
      if (!isPresenceKey(status) || !userId) return;
      // Hub CONNECTION "away" (last tab closed) shares its word with the
      // custom "Away" preset. Only a flagged custom event may set it —
      // otherwise a reconnecting user stayed "Away" forever (the 'active'
      // that follows isn't a preset, so nothing ever cleared it).
      if (status === 'away' && custom !== true) return;
      const myAuthId = this.auth.user()?.authId ?? '';
      if (myAuthId && userId === myAuthId) {
        this.myStatus.set(status);
        this.persist(status);
      }
      const m = new Map(this._others());
      m.set(userId, status);
      this._others.set(m);
    });
  }

  /**
   * THE presence every avatar shows (messages list, thread header, people
   * search, new-chat picker, navbar popover, chat windows, call tiles).
   * Reads the live hub maps (snapshot + deltas) and the custom statuses, so
   * any caller in a template/computed updates in real time. Not connected
   * (offline / away) or on a call wins over a custom status.
   */
  displayStatus(userId: string | null | undefined): DisplayPresence | null {
    if (!userId) return null;
    const conn = this.signaling.userPresences().get(userId);
    // No live connection, but a registered phone / browser the server can
    // ring by push: honestly "away" — callable ("Will ring their devices"),
    // never shown as online.
    if (!conn) return this.reach.reachable().has(userId) ? 'away' : 'offline';
    if (conn === 'away' || conn === 'in-a-call') return conn;
    return this._others().get(userId) ?? (userId === this.auth.user()?.authId ? this.myStatus() : null) ?? 'active';
  }

  /** Custom status for a user (AuthId), or null when none is known. */
  statusFor(userId: string): PresenceKey | null {
    return this._others().get(userId) ?? null;
  }

  /** Set my status. Optimistic: the dot flips immediately, reverts on error. */
  async setStatus(key: PresenceKey): Promise<void> {
    const prev = this.myStatus();
    if (key === prev) return;
    this.myStatus.set(key);
    this.persist(key);
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.patch<{ status: string }>('/api/auth/me/status', { status: key }));
      this.toasts.info(`Status set to ${presenceLabel(key)}`, 2500);
    } catch {
      this.myStatus.set(prev);
      this.persist(prev);
      this.toasts.error('Could not update your status.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Seed the others-map (and my own status) from a users-list payload that
   *  carries `presenceStatus` — e.g. GET /api/users. Live events win later. */
  seedFromUsers(users: Array<{ authId?: string | null; presenceStatus?: string | null }>): void {
    let next: Map<string, PresenceKey> | null = null;
    const myAuthId = this.auth.user()?.authId ?? '';
    for (const u of users) {
      if (!u.authId || !isPresenceKey(u.presenceStatus)) continue;
      if (myAuthId && u.authId === myAuthId) {
        if (this.myStatus() !== u.presenceStatus) {
          this.myStatus.set(u.presenceStatus);
          this.persist(u.presenceStatus);
        }
        continue;
      }
      next ??= new Map(this._others());
      next.set(u.authId, u.presenceStatus);
    }
    if (next) this._others.set(next);
  }

  private readStored(): PresenceKey {
    if (!this.scope.identity()) return 'available';
    try {
      const v = localStorage.getItem(this.scope.storageKey(PresenceService.STORE_KEY));
      return isPresenceKey(v) ? v : 'available';
    } catch { return 'available'; }
  }
  private persist(key: PresenceKey): void {
    if (!this.scope.identity()) return;
    try { localStorage.setItem(this.scope.storageKey(PresenceService.STORE_KEY), key); } catch { /* private mode */ }
  }
}
