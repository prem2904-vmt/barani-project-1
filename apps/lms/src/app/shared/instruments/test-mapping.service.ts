import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../models/api-response.model';
import { TestMappingApiService } from './test-mapping-api.service';
import {
  ActiveTestMapping, TEST_MAPPING_PING_MS, TEST_MAPPING_POLL_MS, endedNote, isSessionGone, isSessionReplaced, sameAnalyzerId, testMappingErrorText,
} from './test-mapping';

export type TestMappingEndReason = 'closed' | 'left' | 'logout';

/**
 * The ONE running "Test with an analyzer ID" (at most one per app). Root so
 * the sign-out sequence can end it (SessionService) and so a window close
 * reaches it; the Status-tab card only renders it.
 *
 * Lifecycle (nothing is ever left on):
 *  - start → POST, then a ping every 15 s + a status poll every 3 s;
 *  - the server says `ended` (consumed after the run, or expired) → the card
 *    shows the note and returns to its empty form;
 *  - Close / leaving the instrument page / logout → DELETE;
 *  - window close / reload (`pagehide` / `beforeunload`) → keepalive DELETE.
 */
@Injectable({ providedIn: 'root' })
export class TestMappingService {
  private readonly api = inject(TestMappingApiService);

  private readonly _active = signal<ActiveTestMapping | null>(null);
  readonly active = this._active.asReadonly();
  /** The plain-words note left after a test ended ("Done — 5 results attached to 26117."). */
  readonly note = signal<string | null>(null);
  /** Bumps whenever results were routed — the screen reloads its result list. */
  readonly routedTick = signal(0);
  readonly busy = signal(false);

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private readonly onUnload = () => this.endOnUnload();

  /** Start a test (the server resolves the typed tube number), keep it alive. */
  async start(instrumentId: string, analyzerId: string, sampleCode: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const aId = analyzerId.trim();
    const code = sampleCode.trim();
    if (!aId) return { ok: false, error: 'Type the ID the analyzer sends' };
    if (!code) return { ok: false, error: 'Type the Prefrontal sample number' };
    if (this._active() || this.busy()) return { ok: false, error: 'A test is already running — close it first' };
    this.busy.set(true);
    this.note.set(null);
    try {
      const res = await firstValueFrom(this.api.start(instrumentId, { analyzerId: aId, sampleId: code }));
      this._active.set({
        instrumentId, sessionId: res.sessionId, analyzerId: aId, sampleId: code,
        sampleLabel: code, status: res.status ?? 'waiting', routedCount: 0, quietSecondsLeft: null,
      });
      const every = res.pingEverySeconds && res.pingEverySeconds > 0 ? res.pingEverySeconds * 1000 : TEST_MAPPING_PING_MS;
      this.startTimers(Math.min(every, TEST_MAPPING_PING_MS));
      void this.poll();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: testMappingErrorText(ApiError.from(e), { sample: code, analyzerId: aId }) };
    } finally {
      this.busy.set(false);
    }
  }

  /** Close / "Finish now" / leave the page / logout: end it on the server now.
   *  Results already attached stay attached ("Done — N results attached to …"). */
  async end(reason: TestMappingEndReason = 'closed'): Promise<void> {
    const a = this._active();
    if (!a) return;
    this.clear();
    if (reason === 'closed') this.note.set(a.routedCount > 0 ? endedNote(a, 'closed') : null);
    try { await firstValueFrom(this.api.end(a.instrumentId, a.sessionId)); } catch { /* the 60 s expiry is the backstop */ }
  }

  /** The window is closing: a keepalive DELETE that outlives the page. */
  endOnUnload(): void {
    const a = this._active();
    if (!a) return;
    this.clear();
    this.api.endOnUnload(a.instrumentId, a.sessionId);
  }

  /** "Test with this ID" on an unmatched result whose ID the running test
   *  already waits for → re-run it through the mapping (no resend needed). */
  isRunningFor(instrumentId: string, analyzerId: string | null | undefined): boolean {
    const a = this._active();
    return !!a && a.instrumentId === instrumentId && sameAnalyzerId(a.analyzerId, analyzerId);
  }

  async reingest(messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const a = this._active();
    if (!a) return { ok: false, error: 'No test is running' };
    try {
      await firstValueFrom(this.api.reingest(a.instrumentId, a.sessionId, messageId));
      void this.poll();
      return { ok: true };
    } catch (e) {
      const err = ApiError.from(e);
      if (this.sessionEnded(err, a.sessionId)) return { ok: false, error: testMappingErrorText(err, { analyzerId: a.analyzerId }) };
      return { ok: false, error: testMappingErrorText(err, { analyzerId: a.analyzerId }) };
    }
  }

  // ── timers ──────────────────────────────────────────────────────────
  private startTimers(pingMs = TEST_MAPPING_PING_MS) {
    this.stopTimers();
    this.pingTimer = setInterval(() => void this.ping(), pingMs);
    this.pollTimer = setInterval(() => void this.poll(), TEST_MAPPING_POLL_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onUnload);
      window.addEventListener('beforeunload', this.onUnload);
    }
  }

  private stopTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pingTimer = this.pollTimer = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onUnload);
      window.removeEventListener('beforeunload', this.onUnload);
    }
  }

  private clear() {
    this.stopTimers();
    this._active.set(null);
  }

  private async ping() {
    const a = this._active();
    if (!a) return;
    try { await firstValueFrom(this.api.ping(a.instrumentId, a.sessionId)); }
    catch (e) {
      // The server no longer knows it (expired / restarted / ended elsewhere).
      this.sessionEnded(ApiError.from(e), a.sessionId, a);
    }
  }

  private async poll() {
    const a = this._active();
    if (!a || this.polling) return;
    this.polling = true;
    try {
      const s = await firstValueFrom(this.api.status(a.instrumentId, a.sessionId));
      const cur = this._active();
      if (!cur || cur.sessionId !== a.sessionId) return;
      const routed = Math.max(0, s.routedCount ?? 0);
      if (routed !== cur.routedCount) this.routedTick.update((n) => n + 1);
      const next: ActiveTestMapping = {
        ...cur, status: s.status, routedCount: routed, quietSecondsLeft: s.quietSecondsLeft ?? null,
        sampleLabel: s.barcode || cur.sampleLabel,
      };
      if (s.status === 'ended') { this.finish(next, s.endedReason ?? null); return; }
      this._active.set(next);
    } catch (e) {
      this.sessionEnded(ApiError.from(e), a.sessionId, a);
    } finally {
      this.polling = false;
    }
  }

  /** The server says this session is no longer the live one: gone (expired / restarted) or replaced
   *  (the same user started again elsewhere). True = it was ended here. */
  private sessionEnded(err: ApiError, sessionId: string, a: ActiveTestMapping | null = this._active()): boolean {
    if (!a || this._active()?.sessionId !== sessionId) return false;
    const replaced = isSessionReplaced(err);
    if (!replaced && !isSessionGone(err)) return false;
    this.finish(this._active() ?? a, replaced ? 'replaced' : 'expired');
    return true;
  }

  private finish(a: ActiveTestMapping, reason: string | null) {
    this.clear();
    this.note.set(endedNote(a, reason));
  }
}
