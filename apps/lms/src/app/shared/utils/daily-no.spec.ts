import { dailyNoHtml, dailyNoLabel, dailyNoOf, dailyNoTitle, matchesDailyNo, parseDailyNoQuery } from './daily-no';
import { labToday } from './lab-clock';

const TODAY = '2026-09-30';

describe('daily patient number (utils/daily-no)', () => {
  it('labels today as "12" (no # prefix), another day with its date', () => {
    expect(dailyNoLabel(12, TODAY, TODAY)).toBe('12');
    expect(dailyNoLabel(3, '2026-09-29', TODAY)).toBe('3 · 29 Sep');
    expect(dailyNoLabel(null, TODAY, TODAY)).toBe('');
    expect(dailyNoLabel(0, TODAY, TODAY)).toBe('');
  });

  it('titles say what the number is', () => {
    expect(dailyNoTitle(12, TODAY, TODAY)).toBe("Today's patient number 12");
    expect(dailyNoTitle(3, '2026-09-29', TODAY)).toBe('Patient number 3 on 29 Sep');
  });

  it('reads the number off an order or a row that carries the order', () => {
    expect(dailyNoOf({ dailyNo: 4, dailyNoDay: TODAY })).toEqual({ dailyNo: 4, dailyNoDay: TODAY });
    expect(dailyNoOf({ barcode: '26259', order: { dailyNo: 5, dailyNoDay: TODAY } })).toEqual({ dailyNo: 5, dailyNoDay: TODAY });
    expect(dailyNoOf({ barcode: '26259' })).toEqual({});
    expect(dailyNoOf(null)).toEqual({});
  });

  it('parses a bare number search ("12", "#12"), nothing else', () => {
    expect(parseDailyNoQuery('12')).toBe(12);
    expect(parseDailyNoQuery(' #7 ')).toBe(7);
    expect(parseDailyNoQuery('26259')).toBeNull();          // a sample ID, not a daily number
    expect(parseDailyNoQuery('LAB-2609-000157')).toBeNull();
    expect(parseDailyNoQuery('Arun')).toBeNull();
    expect(parseDailyNoQuery('0')).toBeNull();
    expect(parseDailyNoQuery('')).toBeNull();
  });

  it('search "12" finds only TODAY\'s #12', () => {
    expect(matchesDailyNo('12', { dailyNo: 12, dailyNoDay: TODAY }, TODAY)).toBe(true);
    expect(matchesDailyNo('#12', { order: { dailyNo: 12, dailyNoDay: TODAY } }, TODAY)).toBe(true);
    expect(matchesDailyNo('12', { dailyNo: 12, dailyNoDay: '2026-09-29' }, TODAY)).toBe(false);
    expect(matchesDailyNo('12', { dailyNo: 13, dailyNoDay: TODAY }, TODAY)).toBe(false);
    expect(matchesDailyNo('Arun', { dailyNo: 12, dailyNoDay: TODAY }, TODAY)).toBe(false);
  });

  it('renders the grid chip as escaped HTML with the kit class', () => {
    expect(dailyNoHtml({ dailyNo: 2, dailyNoDay: TODAY }, TODAY))
      .toBe(`<span class="pf-dayno" title="Today&#39;s patient number 2">2</span>`);
    expect(dailyNoHtml({}, TODAY)).toBe('');
  });

  it('defaults "today" to the IST business day (labToday)', () => {
    expect(dailyNoLabel(1, labToday())).toBe('1');
  });
});
