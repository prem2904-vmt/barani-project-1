import { isDrawn, isNotCollected, notCollectedLabel, notCollectedSamples, shortReason } from './sample-not-collected';

describe('sample-not-collected (QA #6 state model)', () => {
  it('not collected = rejected with no collection stamp', () => {
    expect(isNotCollected({ status: 'rejected' })).toBe(true);
    expect(isNotCollected({ status: 'rejected', collectedAt: '2026-09-27T08:00:00Z' })).toBe(false);
    expect(isNotCollected({ status: 'pending' })).toBe(false);
    expect(isNotCollected({ status: 'collected', collectedAt: 'x' })).toBe(false);
  });

  it('a not-collected tube is never drawn', () => {
    expect(isDrawn({ status: 'rejected' })).toBe(false);
    expect(isDrawn({ status: 'pending' })).toBe(false);
    expect(isDrawn({ status: 'collected', collectedAt: 'x' })).toBe(true);
    expect(isDrawn({ status: 'dispatched', collectedAt: 'x' })).toBe(true);
  });

  it('labels every-tube vs partial, reason label only by default', () => {
    expect(notCollectedLabel([{ status: 'rejected', rejectedReason: 'Patient refused — anxious' }]))
      .toBe('Not collected — Patient refused');
    expect(notCollectedLabel([{ status: 'rejected', rejectedReason: 'Patient refused — anxious' }], { full: true }))
      .toBe('Not collected — Patient refused — anxious');
    expect(notCollectedLabel([
      { status: 'collected', collectedAt: 'x' },
      { status: 'rejected', rejectedReason: 'Vein not found' },
    ])).toBe('1 of 2 not collected — Vein not found');
  });

  it('collapses several reasons and tolerates a missing one', () => {
    expect(notCollectedLabel([
      { status: 'rejected', rejectedReason: 'Patient refused' },
      { status: 'rejected', rejectedReason: 'Vein not found' },
    ])).toBe('Not collected — Patient refused +1');
    expect(notCollectedLabel([{ status: 'rejected' }])).toBe('Not collected');
  });

  it('is null / empty when nothing is not-collected', () => {
    expect(notCollectedLabel([{ status: 'pending' }])).toBeNull();
    expect(notCollectedLabel(null)).toBeNull();
    expect(notCollectedSamples(undefined)).toEqual([]);
    expect(shortReason(undefined)).toBe('');
  });
});
