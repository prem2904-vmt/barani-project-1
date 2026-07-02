import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  PresenceKey, isPresenceKey, presenceIsDnd, presenceLabel
} from '../../shared/models/presence.model';
import { AuthService } from '../auth/auth.service';
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

  private static readonly STORE_KEY = 'pf.myPresenceStatus';

  /** My own status. Seeded from the last value this device set. */
  readonly myStatus = signal<PresenceKey>(PresenceService.readStored());
  /** True while my status is DND-grade (calls blocked, pushes silenced). */
  readonly myStatusIsDnd = computed(() => presenceIsDnd(this.myStatus()));
  readonly saving = signal(false);

  /** Others' custom statuses, keyed by AuthId. */
  private readonly _others = signal<Map<string, PresenceKey>>(new Map());
  readonly others = this._others.asReadonly();

  constructor() {
    // Live updates — the PATCH endpoint broadcasts UserPresenceChanged with
    // the custom key to the whole tenant (including my other devices).
    // Non-custom statuses ('active'/'in-a-call'/…) are connection presence
    // and stay in SignalingService; ignore them here.
    this.signaling.userPresenceChanged.subscribe(({ userId, status }) => {
      if (!isPresenceKey(status) || !userId) return;
      const myAuthId = this.auth.user()?.authId ?? '';
      if (myAuthId && userId === myAuthId) {
        this.myStatus.set(status);
        PresenceService.persist(status);
      }
      const m = new Map(this._others());
      m.set(userId, status);
      this._others.set(m);
    });
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
    PresenceService.persist(key);
    this.saving.set(true);
    try {
      await firstValueFrom(this.api.patch<{ status: string }>('/api/auth/me/status', { status: key }));
      this.toasts.info(`Status set to ${presenceLabel(key)}`, 2500);
    } catch {
      this.myStatus.set(prev);
      PresenceService.persist(prev);
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
          PresenceService.persist(u.presenceStatus);
        }
        continue;
      }
      next ??= new Map(this._others());
      next.set(u.authId, u.presenceStatus);
    }
    if (next) this._others.set(next);
  }

  private static readStored(): PresenceKey {
    try {
      const v = localStorage.getItem(PresenceService.STORE_KEY);
      return isPresenceKey(v) ? v : 'available';
    } catch { return 'available'; }
  }
  private static persist(key: PresenceKey): void {
    try { localStorage.setItem(PresenceService.STORE_KEY, key); } catch { /* private mode */ }
  }
}
