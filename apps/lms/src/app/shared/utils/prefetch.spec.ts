import { isPrefetched, prefetch, prefetchWhenIdle, resetPrefetchForTests } from './prefetch';

describe('prefetch (warm a lazy screen before the tap)', () => {
  beforeEach(() => { resetPrefetchForTests(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete (window as { requestIdleCallback?: unknown }).requestIdleCallback; });

  it('dedupes by key: one load however often it is asked', async () => {
    const loader = vi.fn(async () => 'mod');
    void prefetch('k', loader);
    void prefetch('k', loader);
    await prefetch('k', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(isPrefetched('k')).toBe(true);
  });

  it('a failed load can retry on the next ask', async () => {
    const loader = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockImplementationOnce(async () => 'mod');
    await prefetch('k', loader);
    expect(isPrefetched('k')).toBe(false);
    await prefetch('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(isPrefetched('k')).toBe(true);
  });

  it('idle: waits for the browser to be idle (fallback timer without requestIdleCallback)', () => {
    const loader = vi.fn(async () => 'mod');
    prefetchWhenIdle('k', loader, 600);
    expect(loader).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('idle: uses requestIdleCallback when present, and cancel() stops it', () => {
    const cbs: Array<() => void> = [];
    (window as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => { cbs.push(cb); return cbs.length; };
    (window as { cancelIdleCallback?: unknown }).cancelIdleCallback = (id: number) => { cbs[id - 1] = () => { /* cancelled */ }; };
    const loader = vi.fn(async () => 'mod');
    const cancel = prefetchWhenIdle('k', loader);
    cancel();
    cbs.forEach(cb => cb());
    expect(loader).not.toHaveBeenCalled();
    prefetchWhenIdle('k2', loader);
    cbs.forEach(cb => cb());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('idle warm-up is skipped on a data-saver connection', () => {
    const nav = navigator as Navigator & { connection?: unknown };
    const had = Object.getOwnPropertyDescriptor(nav, 'connection');
    Object.defineProperty(nav, 'connection', { value: { saveData: true }, configurable: true });
    try {
      const loader = vi.fn(async () => 'mod');
      prefetchWhenIdle('k', loader, 10);
      vi.advanceTimersByTime(100);
      expect(loader).not.toHaveBeenCalled();
    } finally {
      if (had) Object.defineProperty(nav, 'connection', had); else delete (nav as { connection?: unknown }).connection;
    }
  });
});
