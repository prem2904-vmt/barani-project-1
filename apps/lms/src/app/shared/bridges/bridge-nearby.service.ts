import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { BridgesApiService } from './bridges-api.service';
import type { NearbyBridgeDto } from './bridge.models';

export const MANAGE_BRIDGES = 'manage_bridges';

export interface BridgeNearbyConfig {
  /** Poll interval while the tab is visible. */
  pollMs: number;
  /** "Not now" hides an offer for this long. */
  snoozeMs: number;
  now: () => number;
}
export const BRIDGE_NEARBY_CONFIG = new InjectionToken<BridgeNearbyConfig>('BRIDGE_NEARBY_CONFIG', {
  providedIn: 'root',
  factory: () => ({ pollMs: 120_000, snoozeMs: 24 * 3600_000, now: () => Date.now() }),
});

const SNOOZE_KEY = 'pf.bridges.nearby.snooze';

/** Snoozes from localStorage, dropping expired ones. Never throws. */
export function readSnoozes(now: number): Record<string, number> {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj ?? {})) if (typeof v === 'number' && v > now) out[k] = v;
    return out;
  } catch { return {}; }
}

function writeSnoozes(s: Record<string, number>): void {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/**
 * "New Bridge found nearby — Add?" (bridge-api v1, B.2 `GET /api/bridges/nearby`).
 * Server path only, so it works on the plain web too. Polls ONLY for users
 * with `manage_bridges`: at start, every 2 minutes while the tab is visible,
 * and when the tab comes back. An offer is just an offer — adding it still
 * needs the admin's confirm on the add screen.
 */
@Injectable({ providedIn: 'root' })
export class BridgeNearbyService {
  private readonly api = inject(BridgesApiService);
  private readonly auth = inject(AuthService);
  private readonly cfg = inject(BRIDGE_NEARBY_CONFIG);

  /** Every unclaimed Bridge the server matched to this network. */
  readonly nearby = signal<NearbyBridgeDto[]>([]);
  private readonly snoozes = signal<Record<string, number>>({});
  /** The ones not snoozed — the banner shows the first, one at a time. */
  readonly offers = computed(() => {
    const s = this.snoozes();
    const now = this.cfg.now();
    return this.nearby().filter((n) => !(s[n.announcementId] > now));
  });
  readonly current = computed(() => this.offers()[0] ?? null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private inFlight = false;
  private readonly onVisible = () => { if (this.visible()) void this.poll(); };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** May this user see offers? Super-admin `*` passes. */
  canManage(): boolean {
    try { return this.auth.hasAnyPermission([MANAGE_BRIDGES]); } catch { return false; }
  }

  /** Idempotent; the shell calls it once signed in. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.snoozes.set(readSnoozes(this.cfg.now()));
    void this.poll();
    if (this.cfg.pollMs > 0) this.timer = setInterval(() => { if (this.visible()) void this.poll(); }, this.cfg.pollMs);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    if (typeof window !== 'undefined') window.addEventListener('focus', this.onVisible);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.onVisible);
    this.nearby.set([]);
  }

  /** One fetch. Without the permission it never calls the server. */
  async poll(): Promise<void> {
    if (!this.canManage()) { this.nearby.set([]); return; }
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const list = await new Promise<NearbyBridgeDto[]>((resolve) => {
        this.api.nearby().subscribe({ next: (l) => resolve(Array.isArray(l) ? l : []), error: () => resolve(this.nearby()) });
      });
      this.nearby.set(list.slice(0, 5));
    } finally {
      this.inFlight = false;
    }
  }

  /** "Not now": hide this Bridge's offer for 24 h (per browser). */
  snooze(announcementId: string): void {
    const now = this.cfg.now();
    const next = { ...readSnoozes(now), [announcementId]: now + this.cfg.snoozeMs };
    writeSnoozes(next);
    this.snoozes.set(next);
  }

  /** After a claim: drop it from the offers at once. */
  forget(announcementId: string): void {
    this.nearby.update((l) => l.filter((n) => n.announcementId !== announcementId));
  }

  private visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }
}
