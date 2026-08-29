import { isOrderDispatched, countCollected } from './dispatch-state';

const s = (...statuses: string[]) => statuses.map(status => ({ status }));

describe('isOrderDispatched', () => {
  it('is false for an empty order', () => {
    expect(isOrderDispatched([])).toBe(false);
  });

  it('is false while any tube is still pending', () => {
    expect(isOrderDispatched(s('dispatched', 'pending'))).toBe(false);
  });

  it('is false while any tube is collected but not dispatched', () => {
    expect(isOrderDispatched(s('dispatched', 'collected'))).toBe(false);
  });

  it('is true once every tube is dispatched', () => {
    expect(isOrderDispatched(s('dispatched', 'dispatched', 'dispatched'))).toBe(true);
  });

  // The reported bug: a fully-dispatched series whose tubes moved into a
  // post-dispatch state the old whitelist didn't list (e.g. received / in_lab)
  // must still count as dispatched — otherwise the Dispatch button lingered.
  it('is true for post-dispatch states outside the old whitelist', () => {
    expect(isOrderDispatched(s('received', 'in_lab', 'dispatched'))).toBe(true);
    expect(isOrderDispatched(s('completed', 'picked_up'))).toBe(true);
  });

  it('counts a mix of dispatched + missed as dispatched (nothing left to send)', () => {
    expect(isOrderDispatched(s('dispatched', 'missed'))).toBe(true);
  });
});

describe('countCollected', () => {
  it('counts only tubes awaiting dispatch', () => {
    expect(countCollected(s('collected', 'collected', 'dispatched', 'pending'))).toBe(2);
  });

  it('is zero when nothing is collected', () => {
    expect(countCollected(s('dispatched', 'pending'))).toBe(0);
    expect(countCollected([])).toBe(0);
  });
});
