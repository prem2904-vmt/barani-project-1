import { describe, expect, it } from 'vitest';
import { instrumentStatusWords } from './instrument-status-words';
import type { InstrumentDto } from './instrument.models';

const dto = (over: Partial<InstrumentDto>): InstrumentDto => ({ id: 'i1', name: 'A', ...over } as InstrumentDto);

describe('instrumentStatusWords', () => {
  const cases: Array<[string, string, 'normal' | 'late' | 'done']> = [
    ['online', 'Online', 'done'],
    ['waiting', 'Waiting for analyzer', 'normal'],
    ['running', 'Connector running', 'normal'],
    ['never', 'Never connected', 'normal'],
    ['offline', 'Offline', 'late'],
    ['not_connected', 'Not connected', 'late'],
    ['error', 'Error', 'late'],
  ];
  for (const [status, now, tone] of cases) {
    it(`${status} -> ${now} (${tone})`, () => {
      const w = instrumentStatusWords(dto({ status } as Partial<InstrumentDto>));
      expect(w.now).toBe(now);
      expect(w.tone).toBe(tone);
    });
  }
  it('a missing status reads as never connected; the error detail is line 2', () => {
    expect(instrumentStatusWords(dto({})).now).toBe('Never connected');
    expect(instrumentStatusWords(dto({ status: 'error', errorDetail: 'Port busy' } as Partial<InstrumentDto>)).detail).toBe('Port busy');
  });
});
