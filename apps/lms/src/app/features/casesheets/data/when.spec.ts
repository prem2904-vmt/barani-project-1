import { humanKey, whenText } from './when';

describe('plain-words time and page names', () => {
  const now = new Date(2030, 4, 10, 15, 0, 0);
  it('relative times', () => {
    expect(whenText(new Date(2030, 4, 10, 14, 59, 40).toISOString(), now)).toBe('just now');
    expect(whenText(new Date(2030, 4, 10, 14, 50).toISOString(), now)).toBe('10 min ago');
    expect(whenText(new Date(2030, 4, 10, 9, 5).toISOString(), now)).toMatch(/^today 09:05$/);
    expect(whenText(new Date(2030, 4, 9, 18, 30).toISOString(), now)).toMatch(/^yesterday 18:30$/);
    expect(whenText(new Date(2030, 1, 3).toISOString(), now)).toMatch(/2030/);
    expect(whenText(null, now)).toBe('');
  });
  it('page keys as words', () => {
    expect(humanKey('obstruction_details')).toBe('Obstruction details');
    expect(humanKey('rightEye')).toBe('Right eye');
  });
});
