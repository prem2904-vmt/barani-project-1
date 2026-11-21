import { criticalStatusWords } from './critical-status-words';

describe('criticalStatusWords', () => {
  it('open / unknown reads as late (rose) "Not acknowledged"', () => {
    expect(criticalStatusWords('open')).toEqual({ now: 'Not acknowledged', detail: null, tone: 'late' });
    expect(criticalStatusWords('whatever').tone).toBe('late');
  });
  it('acknowledged is normal text with the who/when line', () => {
    expect(criticalStatusWords('acknowledged', ['Asha, 3 Nov, 10:12 am'])).toEqual({ now: 'Acknowledged', detail: 'Asha, 3 Nov, 10:12 am', tone: 'normal' });
  });
  it('communicated is done (green) and joins both detail lines', () => {
    expect(criticalStatusWords('communicated', ['Asha, 10:12', 'Told Dr Rao by phone, 10:20'])).toEqual({
      now: 'Communicated', detail: 'Asha, 10:12 · Told Dr Rao by phone, 10:20', tone: 'done' });
  });
});
