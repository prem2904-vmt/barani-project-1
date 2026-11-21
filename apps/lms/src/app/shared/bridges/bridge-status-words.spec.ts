import { describe, expect, it } from 'vitest';
import { bridgeStatusWords, linkStateWords } from './bridge-status-words';

describe('bridgeStatusWords', () => {
  it('online is done, offline and error are late, pending and never are normal', () => {
    expect(bridgeStatusWords('online')).toEqual({ now: 'Online', detail: null, tone: 'done' });
    expect(bridgeStatusWords('offline', 'Last seen 5 min ago')).toEqual({ now: 'Offline', detail: 'Last seen 5 min ago', tone: 'late' });
    expect(bridgeStatusWords('error').tone).toBe('late');
    expect(bridgeStatusWords('pending')).toEqual({ now: 'Waiting for the Bridge', detail: null, tone: 'normal' });
    expect(bridgeStatusWords(null)).toEqual({ now: 'Never connected', detail: null, tone: 'normal' });
  });
});

describe('linkStateWords', () => {
  const cases: Array<[string, string, 'normal' | 'late' | 'done']> = [
    ['connected', 'Connected', 'done'],
    ['listening', 'Waiting for analyzer', 'normal'],
    ['connecting', 'Connecting', 'normal'],
    ['reconnecting', 'Reconnecting', 'normal'],
    ['stopped', 'Stopped', 'normal'],
    ['error', 'Error', 'late'],
    ['unknown', 'No report yet', 'normal'],
  ];
  for (const [state, now, tone] of cases) {
    it(`${state} -> ${now} (${tone})`, () => {
      const w = linkStateWords(state);
      expect(w.now).toBe(now);
      expect(w.tone).toBe(tone);
    });
  }
  it('line 2 is the last result', () => {
    expect(linkStateWords('connected', 'Last result 2 min ago').detail).toBe('Last result 2 min ago');
  });
});
