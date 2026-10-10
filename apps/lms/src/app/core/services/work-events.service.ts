import { Injectable, InjectionToken, effect, inject, signal, untracked } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { EMPTY, Observable, Subject, fromEvent, interval, merge } from 'rxjs';
import { debounceTime, filter, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { FOREVER_RETRY, HUB_FACTORY } from './hub-factory';

/** A work list a screen shows. Screens subscribe by area, never by event. */
export type WorkArea =
  | 'frontdesk' | 'collection' | 'receive' | 'my_work' | 'validation'
  | 'reports' | 'billing' | 'appointments' | 'consults' | 'bridges';

/** Server → client, exactly as WorkHub sends it: ids + type, no PHI. */
export interface WorkEvent {
  type: string;
  id?: string | null;
  branchId?: string | null;
  at?: string;
}

/** Why a subscribed screen is being told to refetch. */
export interface WorkChange {
  reason: 'event' | 'focus' | 'reconnect' | 'poll';
  event?: WorkEvent;
}

/**
 * Which lists an event touches. Exact type first, then its `order.` /
 * `sample.` … prefix, so a new server event still refreshes the right family.
 * Collection hears billing because a pay-first order only enters the
 * collection queue once it is paid.
 */
const BY_TYPE: Record<string, WorkArea[]> = {
  'order.created':       ['frontdesk', 'collection', 'billing'],
  'order.updated':       ['frontdesk', 'collection', 'billing', 'receive', 'my_work'],
  'order.cancelled':     ['frontdesk', 'collection', 'billing', 'receive', 'my_work', 'validation', 'reports'],
  'sample.received':     ['receive', 'my_work', 'frontdesk', 'collection'],
  'sample.rejected':     ['collection', 'frontdesk', 'receive', 'my_work'],
  'result.draft':        ['my_work'],
  'result.submitted':    ['my_work', 'validation', 'frontdesk'],
  'result.assigned':     ['my_work', 'validation'],
  'result.reopened':     ['my_work', 'validation', 'reports'],
  'result.validated':    ['validation', 'my_work', 'reports', 'frontdesk'],
  'result.rejected':     ['validation', 'my_work', 'frontdesk'],
  'patient.created':     ['frontdesk'],
  // Prefrontal Bridge (bridge-api v1, C.8): online/offline, claim, revoke,
  // command completion, and a new unknown analyzer that talked to a Bridge.
  'bridge.updated':         ['bridges'],
  'bridge.source_detected': ['bridges'],
};
const BY_PREFIX: Record<string, WorkArea[]> = {
  order:       ['frontdesk', 'collection', 'billing'],
  sample:      ['collection', 'frontdesk', 'receive'],
  result:      ['my_work', 'validation'],
  report:      ['reports', 'frontdesk'],
  bill:        ['billing', 'frontdesk', 'collection'],
  appointment: ['appointments', 'frontdesk', 'collection'],
  consult:     ['consults'],
  patient:     ['frontdesk'],
  bridge:      ['bridges'],
};

export function workAreasFor(type: string): WorkArea[] {
  return BY_TYPE[type] ?? BY_PREFIX[(type ?? '').split('.')[0]] ?? [];
}

export interface WorkEventsConfig {
  /** Burst window: many events → one refetch. */
  debounceMs: number;
  /** Slow safety poll, ONLY while the socket is down (0 = off). */
  fallbackPollMs: number;
}
export const WORK_EVENTS_CONFIG = new InjectionToken<WorkEventsConfig>('WORK_EVENTS_CONFIG', {
  providedIn: 'root',
  factory: () => ({ debounceMs: 400, fallbackPollMs: 60_000 }),
});

/**
 * Live work screens. ONE lightweight socket (/hubs/work) per signed-in tab,
 * joined to the user's tenant + ACTIVE branch; the server pushes a tiny
 * `WorkEvent` after each work transition commits (order created / cancelled,
 * sample collected / not-collected / recollected / dispatched / received,
 * result submitted / validated, report ready / delivered, bill paid /
 * pay-later …). Screens call {@link on} with the lists they show and simply
 * REFETCH — debounced, so a burst is one request — with their own endpoint
 * and permissions. Screens refresh LISTS only; a form being edited is never
 * reloaded from here.
 *
 * Resilience: refetch on reconnect and when the tab becomes visible again; a
 * slow fallback poll runs only while the socket is down.
 *
 * Account switch (Messages RCA 2026-09-27 rules): the socket, its group and
 * every handler belong to one session — a session change stops it, and an
 * event arriving late on the old socket is dropped. The shell (re)starts it.
 */
@Injectable({ providedIn: 'root' })
export class WorkEventsService {
  private readonly auth = inject(AuthService);
  private readonly scope = inject(SessionScopeService);
  private readonly hubFactory = inject(HUB_FACTORY);
  private readonly cfg = inject(WORK_EVENTS_CONFIG);

  /** Socket up AND joined to a branch group. */
  readonly connected = signal(false);
  /** The branch the server confirmed we are listening to. */
  readonly joinedBranch = signal<string | null>(null);

  private readonly bus = new Subject<WorkEvent>();
  private readonly resync = new Subject<void>();
  private connection: signalR.HubConnection | null = null;
  private connecting: Promise<void> | null = null;
  private connectedAs: string | null = null;
  private wanted = false;
  private reviveTimer: ReturnType<typeof setTimeout> | null = null;
  private reviveAttempt = 0;
  /** Set by the first start(): the shell wants the socket for this tab. */
  private autostart = false;

  constructor() {
    this.scope.onChange(() => void this.reset());
    // "Add account" swaps the user IN PLACE (no reload, the shell stays):
    // once the shell has started us, follow the signed-in user — the session
    // reset above tears the old socket down, this rebuilds it for the new one.
    const user = this.auth.user;
    if (typeof user === 'function') {
      effect(() => {
        const u = user();
        untracked(() => { if (this.autostart && u) void this.start().catch(() => undefined); });
      });
    }
    // Branch switch (or a refused stale branch being dropped): rejoin.
    const branch = (this.auth as { activeBranchId?: () => string | null }).activeBranchId;
    if (typeof branch === 'function') {
      effect(() => {
        const b = branch();
        untracked(() => {
          if (this.connection && this.connected() && b && b !== this.joinedBranch()) void this.join(this.connection);
        });
      });
    }
  }

  private identity(): string {
    const u = this.auth.user?.();
    return u?.authId ?? u?.id ?? '';
  }

  /** Server push → subscribers. Public for the tests and any in-app emitter. */
  push(e: WorkEvent): void {
    if (e && typeof e.type === 'string' && e.type) this.bus.next(e);
  }

  /** Raw events of ONE type, undebounced — for a one-off reaction such as
   *  the shell's "new analyzer found" toast. Lists use {@link on}. */
  ofType(type: string): Observable<WorkEvent> {
    return this.bus.pipe(filter(e => e.type === type));
  }

  /**
   * Debounced "refetch now" for screens showing any of `areas`. Emits on a
   * matching server event, on reconnect, when the tab becomes visible, and on
   * the fallback poll while disconnected. Unsubscribe (takeUntilDestroyed) on
   * destroy — nothing else to clean up.
   */
  on(...areas: WorkArea[]): Observable<WorkChange> {
    const wanted = new Set(areas);
    const events$ = this.bus.pipe(
      filter(e => workAreasFor(e.type).some(a => wanted.has(a))),
      map((event): WorkChange => ({ reason: 'event', event })),
    );
    const hasDoc = typeof document !== 'undefined';
    const visible = () => !hasDoc || document.visibilityState !== 'hidden';
    const focus$ = hasDoc
      ? fromEvent(document, 'visibilitychange').pipe(
          filter(() => document.visibilityState === 'visible'),
          map((): WorkChange => ({ reason: 'focus' })))
      : EMPTY;
    const resync$ = this.resync.pipe(map((): WorkChange => ({ reason: 'reconnect' })));
    const poll$ = this.cfg.fallbackPollMs > 0
      ? interval(this.cfg.fallbackPollMs).pipe(
          filter(() => !this.connected() && visible()),
          map((): WorkChange => ({ reason: 'poll' })))
      : EMPTY;
    return merge(events$, focus$, resync$, poll$).pipe(debounceTime(this.cfg.debounceMs));
  }

  // ── Connection lifecycle ───────────────────────────────────────────────

  /** Idempotent. Called by the shell once a user is signed in. */
  async start(): Promise<void> {
    this.autostart = true;
    const me = this.identity();
    if (!me) return;
    if (this.connection && this.connectedAs !== me) await this.reset();
    this.wanted = true;
    if (this.connection && this.connection.state !== signalR.HubConnectionState.Disconnected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open(me);
    try { await this.connecting; } finally { this.connecting = null; }
  }

  private async open(me: string): Promise<void> {
    const conn = this.hubFactory(
      `${environment.apiUrl}/hubs/work`,
      async () => (await this.auth.getAccessToken()) ?? '',
      FOREVER_RETRY);
    this.connection = conn;
    this.connectedAs = me;

    // Every handler is bound to THIS connection: a late event from a
    // replaced / previous-account socket is dropped.
    const mine = () => this.connection === conn;
    conn.on('WorkEvent', (e: WorkEvent) => { if (mine()) this.push(e); });
    conn.onreconnecting(() => { if (mine()) this.connected.set(false); });
    conn.onreconnected(async () => {
      if (!mine()) return;
      await this.join(conn);        // groups die with the old connection id
      if (mine()) this.resync.next();
    });
    conn.onclose(() => {
      if (!mine()) return;
      this.connected.set(false);
      this.scheduleRevive();
    });

    try {
      await conn.start();
    } catch {
      if (mine()) this.scheduleRevive();
      return;
    }
    if (!mine()) { void conn.stop().catch(() => undefined); return; }
    this.reviveAttempt = 0;
    const wasRevive = this.revived;
    this.revived = false;
    await this.join(conn);
    // A revived socket may have missed events while it was dead.
    if (wasRevive && mine()) this.resync.next();
  }
  private revived = false;

  private async join(conn: signalR.HubConnection): Promise<void> {
    const branch = (this.auth as { activeBranchId?: () => string | null }).activeBranchId?.() ?? null;
    let joined: string | null = null;
    try { joined = (await conn.invoke<string | null>('JoinBranch', branch)) ?? null; } catch { joined = null; }
    if (this.connection !== conn) return;
    this.joinedBranch.set(joined);
    // Refused (stale branch) → treat as disconnected so the fallback poll
    // keeps the screens fresh until the branch is re-seeded and we rejoin.
    this.connected.set(joined !== null);
  }

  private scheduleRevive(): void {
    if (!this.wanted || this.reviveTimer || !this.identity()) return;
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(this.reviveAttempt++, 4));
    this.reviveTimer = setTimeout(() => {
      this.reviveTimer = null;
      if (!this.wanted || !this.identity()) return;
      this.revived = true;
      void this.start().catch(() => undefined);
    }, delay);
  }

  /** Clean slate: stop the socket (its handlers die with it) and forget the
   *  group. Safe when nothing is connected. */
  async reset(): Promise<void> {
    const old = this.connection;
    this.connection = null;
    this.connectedAs = null;
    this.connecting = null;
    this.wanted = false;
    this.revived = false;
    if (this.reviveTimer) { clearTimeout(this.reviveTimer); this.reviveTimer = null; }
    this.reviveAttempt = 0;
    this.connected.set(false);
    this.joinedBranch.set(null);
    if (old) { try { await old.stop(); } catch { /* already gone */ } }
  }
}
