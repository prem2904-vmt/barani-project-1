import { describe, expect, it } from 'vitest';
import { tatNowWords } from './tat-board.logic';

describe('tatNowWords', () => {
  it('a normal step is plain text, no detail', () => {
    expect(tatNowWords(['In progress'])).toEqual({ now: 'In progress', detail: null, tone: 'normal' });
    expect(tatNowWords(['Waiting for result']).tone).toBe('normal');
  });
  it('a rejected sample is late (rose)', () => {
    expect(tatNowWords(['Rejected, needs a new sample']).tone).toBe('late');
  });
  it('other steps of the sample go to the quiet line', () => {
    expect(tatNowWords(['In progress', 'Waiting to validate', 'Culture incubating'])).toEqual({
      now: 'In progress', detail: 'Also: waiting to validate, culture incubating', tone: 'normal' });
  });
  it('no steps falls back to In progress', () => {
    expect(tatNowWords([]).now).toBe('In progress');
  });
});
