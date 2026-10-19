import { MIN_LOAD_MS, createLoadHold } from './min-duration';

describe('createLoadHold (first-load skeleton)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is on from creation (the first frame already draws the skeleton)', () => {
    expect(createLoadHold(true).active()).toBe(true);
    expect(createLoadHold(false).active()).toBe(false);
  });

  it('data already there in the same turn: no skeleton at all', () => {
    const h = createLoadHold(true);
    h.done();
    expect(h.active()).toBe(false);
  });

  it('an async answer is held for the minimum, then released', async () => {
    const h = createLoadHold(true);
    await Promise.resolve();                     // the load is genuinely async
    vi.advanceTimersByTime(100);
    h.done();
    expect(h.active()).toBe(true);
    vi.advanceTimersByTime(MIN_LOAD_MS - 101);
    expect(h.active()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.active()).toBe(false);
  });

  it('a slow answer is released at once', async () => {
    const h = createLoadHold(true);
    await Promise.resolve();
    vi.advanceTimersByTime(MIN_LOAD_MS + 200);
    h.done();
    expect(h.active()).toBe(false);
  });

  it('cancel() turns it off immediately', () => {
    const h = createLoadHold(true);
    h.cancel();
    expect(h.active()).toBe(false);
  });
});
