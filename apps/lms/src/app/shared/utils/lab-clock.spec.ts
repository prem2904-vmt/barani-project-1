import { addDays, istDateOf, istDayRange, istDayStart, labDaysAgo, labToday } from './lab-clock';

describe('lab-clock (strict IST, mirror of the server LabClock)', () => {
  it('00:30 IST on 1 Oct is 1 Oct even though UTC is still 30 Sep', () => {
    const paidAt = new Date('2026-09-30T19:00:00Z');
    expect(istDateOf(paidAt)).toBe('2026-10-01');
    expect(labToday(paidAt)).toBe('2026-10-01');
  });

  it('23:59 IST stays on its day', () => {
    expect(istDateOf('2026-09-30T18:29:00Z')).toBe('2026-09-30');
  });

  it('an IST day is 18:30Z → 18:30Z', () => {
    expect(istDayStart('2026-10-01').toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(istDayRange('2026-10-01')).toEqual({ from: '2026-09-30T18:30:00.000Z', to: '2026-10-01T18:30:00.000Z' });
    expect(istDayRange('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-31T18:30:00.000Z', to: '2026-09-30T18:30:00.000Z' });
  });

  it('day arithmetic crosses month and year boundaries', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(labDaysAgo(29, new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-02');
  });

  it('does not depend on the device timezone (fixed +05:30 arithmetic)', () => {
    // 2027-01-01 00:15 IST
    expect(istDateOf(Date.UTC(2026, 11, 31, 18, 45))).toBe('2027-01-01');
  });
});
