import { vi } from 'vitest';
import { ForegroundReporter, type ForegroundDeps } from './chat-foreground.reporter';

/**
 * Foreground-state reporting (drives server-side push suppression): what the
 * hub hears for visible / hidden / thread changes, de-duplication, the
 * heartbeat that keeps a visible report fresh, and "no push handle → nothing
 * to report".
 */
describe('ForegroundReporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make(over: Partial<ForegroundDeps> = {}) {
    const state = { visible: true, viewed: ['c1'] as string[], handle: 'apns-token' as string | null };
    const sent: Array<[boolean, string[], string]> = [];
    const onViewed = vi.fn();
    const doc = new EventTarget();
    const win = new EventTarget();
    const r = new ForegroundReporter({
      send: async (v, ids, h) => { sent.push([v, ids, h]); },
      viewed: () => state.viewed,
      visible: () => state.visible,
      handle: async () => state.handle,
      onViewed,
      ...over,
    }, { heartbeatMs: 25_000, debounceMs: 250, target: doc as unknown as Document, win: win as unknown as Window });
    return { r, state, sent, onViewed, doc, win };
  }
  const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

  it('reports the thread on screen at start, then only on change', async () => {
    const t = make();
    t.r.start();
    await tick(0);
    expect(t.sent).toEqual([[true, ['c1'], 'apns-token']]);
    expect(t.onViewed).toHaveBeenCalledWith(['c1']);

    t.r.poke(); await tick(300);
    expect(t.sent.length).toBe(1);             // unchanged → not resent

    t.state.viewed = ['c2', 'c1'];
    t.r.poke(); await tick(300);
    expect(t.sent.at(-1)).toEqual([true, ['c1', 'c2'], 'apns-token']);
    expect(t.onViewed).toHaveBeenLastCalledWith(['c2']); // only the newly shown thread
    t.r.stop();
  });

  it('going to the background reports hidden with no threads; back reports again', async () => {
    const t = make();
    t.r.start(); await tick(0);
    t.state.visible = false;
    t.doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(t.sent.at(-1)).toEqual([false, [], 'apns-token']);
    t.state.visible = true;
    t.doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(t.sent.at(-1)).toEqual([true, ['c1'], 'apns-token']);
    t.r.stop();
  });

  it('pagehide reports hidden immediately', async () => {
    const t = make();
    t.r.start(); await tick(0);
    t.win.dispatchEvent(new Event('pagehide')); await tick(0);
    expect(t.sent.at(-1)).toEqual([false, [], 'apns-token']);
    t.r.stop();
  });

  it('hide() sends "hidden" synchronously with the last handle — before any timer or await', async () => {
    const t = make();
    t.r.start(); await tick(0);
    t.r.hide();                                  // no tick: the OS may freeze us right now
    expect(t.sent.at(-1)).toEqual([false, [], 'apns-token']);
    t.r.hide();
    expect(t.sent.length).toBe(2);               // de-duplicated
    t.r.poke(0); await tick(0);                  // back (state still visible) → reports the thread
    expect(t.sent.at(-1)).toEqual([true, ['c1'], 'apns-token']);
    t.r.stop();
  });

  it('a hidden visibilitychange cancels a pending debounced report and hides at once', async () => {
    const t = make();
    t.r.start(); await tick(0);
    t.state.viewed = ['c2'];
    t.r.poke();                                  // debounced "visible on c2" pending…
    t.state.visible = false;
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.sent.at(-1)).toEqual([false, [], 'apns-token']);
    await tick(1000);
    expect(t.sent.some(s => s[0] && s[1].includes('c2'))).toBe(false);
    t.r.stop();
  });

  it('heartbeats while visible so the server-side report stays fresh', async () => {
    const t = make();
    t.r.start(); await tick(0);
    await tick(25_000);
    expect(t.sent.length).toBe(2);
    t.state.visible = false;
    await tick(25_000);                         // hidden: no heartbeat
    expect(t.sent.filter(s => s[0]).length).toBe(2);
    t.r.stop();
  });

  it('with no push handle there is nothing to suppress — sends nothing', async () => {
    const t = make();
    t.state.handle = null;
    t.r.start(); await tick(1000);
    expect(t.sent).toEqual([]);
    t.r.stop();
  });

  it('resend after a reconnect repeats the same state (the server forgot it)', async () => {
    const t = make();
    t.r.start(); await tick(0);
    t.r.resend(); await tick(0);
    expect(t.sent.length).toBe(2);
    expect(t.sent[1]).toEqual(t.sent[0]);
    t.r.stop();
  });

  it('a failed send is retried on the next change (not recorded as sent)', async () => {
    let fail = true;
    const sent: unknown[] = [];
    const t = make({ send: async (...a) => { if (fail) throw new Error('down'); sent.push(a); } });
    t.r.start(); await tick(0);
    fail = false;
    t.r.poke(); await tick(300);
    expect(sent.length).toBe(1);
    t.r.stop();
  });

  it('caps the report at 8 threads and ignores empties', async () => {
    const t = make();
    t.state.viewed = ['', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'a'];
    t.r.start(); await tick(0);
    expect(t.sent[0][1]).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    t.r.stop();
  });
});
