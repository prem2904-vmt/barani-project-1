/**
 * Tells the chat hub what THIS device is showing, so the server pushes every
 * recipient device EXCEPT one that is in the foreground on that very thread
 * (lazy chunk — loaded once the chat socket is up).
 *
 * Report = (visible, conversation ids on screen, this device's push handle).
 * The handle is the native APNs / FCM token, or the browser's Web Push
 * endpoint — whatever the server pushes this device through; a device with no
 * handle (Electron, a browser without push) has nothing to suppress and sends
 * nothing. Sent on: socket (re)connect, app / tab visibility change, the set
 * of on-screen threads changing (debounced), and a heartbeat while visible —
 * the server treats a report older than 70 s as "not viewing" (fail-open: a
 * suspended app that couldn't say goodbye still gets its pushes).
 *
 * Going to the background is reported SYNCHRONOUSLY ({@link hide}) with the
 * last known handle (stage 2026-09-28: a minimised iPad got no chat push — iOS
 * froze the app between the visibility event and the debounced, awaited send,
 * so the server still believed it was viewing). The server additionally
 * requires the device to ack the message before it skips it.
 */

export interface ForegroundDeps {
  /** hub.invoke('ReportForeground', visible, conversationIds, pushHandle) */
  send(visible: boolean, conversationIds: string[], pushHandle: string): Promise<unknown>;
  /** Conversation ids a reader surface / docked window shows right now. */
  viewed(): string[];
  /** Document / app is in the foreground. */
  visible(): boolean;
  /** This device's push handle (token / endpoint), or null. */
  handle(): Promise<string | null>;
  /** Threads that just came on screen (native: clear their notifications). */
  onViewed?(conversationIds: string[]): void;
}

export interface ForegroundOptions {
  heartbeatMs?: number;
  debounceMs?: number;
  /** Test seam for DOM events. */
  target?: Pick<Document, 'addEventListener' | 'removeEventListener'> | null;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

export class ForegroundReporter {
  private readonly heartbeatMs: number;
  private readonly debounceMs: number;
  private last = '';
  private lastSentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private prevViewed = new Set<string>();
  /** The handle of the last report — lets {@link hide} send without awaiting. */
  private lastHandle: string | null = null;
  private readonly onVis = () => { if (this.deps.visible()) this.poke(0); else this.hide(); };
  private readonly onHide = () => this.hide();

  constructor(private readonly deps: ForegroundDeps, private readonly opts: ForegroundOptions = {}) {
    this.heartbeatMs = opts.heartbeatMs ?? 25_000;
    this.debounceMs = opts.debounceMs ?? 250;
  }

  start(): this {
    const doc = this.opts.target === undefined ? (typeof document !== 'undefined' ? document : null) : this.opts.target;
    const win = this.opts.win === undefined ? (typeof window !== 'undefined' ? window : null) : this.opts.win;
    doc?.addEventListener('visibilitychange', this.onVis);
    win?.addEventListener('focus', this.onVis);
    win?.addEventListener('pagehide', this.onHide);
    this.beat = setInterval(() => { if (this.deps.visible()) void this.flush(false, true); }, this.heartbeatMs);
    this.poke(0);
    return this;
  }

  /** Something changed (thread opened / closed, reconnect) — report soon. */
  poke(delayMs = this.debounceMs): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(false); }, delayMs);
  }

  /** Going to the background (hidden tab, pagehide, native app pause): tell
   *  the hub NOW, in this very tick — no debounce, no await before the send —
   *  because the OS may freeze the app right after this event returns. */
  hide(): void {
    if (this.stopped) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const handle = this.lastHandle;
    if (!handle) { void this.flush(true); return; } // never reported yet — nothing on the server to clear
    const key = `0||${handle}`;
    if (key === this.last) return;
    this.prevViewed = new Set();
    this.last = key;
    this.lastSentAt = Date.now();
    try {
      void Promise.resolve(this.deps.send(false, [], handle)).catch(() => { this.last = ''; });
    } catch { this.last = ''; }
  }

  /** Reconnected: the server forgot this socket's state — resend. */
  resend(): void { this.last = ''; this.poke(0); }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.beat) clearInterval(this.beat);
    this.timer = null; this.beat = null;
    const doc = this.opts.target === undefined ? (typeof document !== 'undefined' ? document : null) : this.opts.target;
    const win = this.opts.win === undefined ? (typeof window !== 'undefined' ? window : null) : this.opts.win;
    doc?.removeEventListener('visibilitychange', this.onVis);
    win?.removeEventListener('focus', this.onVis);
    win?.removeEventListener('pagehide', this.onHide);
  }

  /** Send the current state if it changed (or a heartbeat is due). */
  async flush(forceHidden = false, heartbeat = false): Promise<void> {
    if (this.stopped) return;
    const handle = await this.deps.handle().catch(() => null);
    if (!handle) return;
    this.lastHandle = handle;
    const visible = !forceHidden && this.deps.visible();
    const ids = visible ? [...new Set(this.deps.viewed().filter(Boolean))].sort().slice(0, 8) : [];
    const key = `${visible ? 1 : 0}|${ids.join(',')}|${handle}`;
    const due = heartbeat && Date.now() - this.lastSentAt >= this.heartbeatMs - 1000;
    if (key === this.last && !due) return;
    if (visible) {
      const fresh = ids.filter(id => !this.prevViewed.has(id));
      if (fresh.length) this.deps.onViewed?.(fresh);
    }
    this.prevViewed = new Set(ids);
    try {
      await this.deps.send(visible, ids, handle);
      this.last = key;
      this.lastSentAt = Date.now();
    } catch { /* socket down — the reconnect resends */ }
  }
}
