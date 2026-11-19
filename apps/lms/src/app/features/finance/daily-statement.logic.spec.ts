import {
  Closure, canCloseDay, closedWords, closureTotals, closureWord, dayRows, modeRows, money, money2, noteRequired, shiftsOf,
  varianceKind, varianceOf, varianceRow,
} from './daily-statement.logic';

const closure = (o: Partial<Closure>): Closure => ({ id: 'c', date: '2026-11-18', openingBalance: 0, expectedCash: 0, countedCash: 0, variance: 0, closedAt: '2026-11-18T15:42:00Z', ...o });

describe('Day closing — variance maths', () => {
  it('counted − expected, to the paisa', () => {
    expect(varianceOf(3950, 4000)).toBe(-50);
    expect(varianceOf(4100, 4000)).toBe(100);
    expect(varianceOf(4000, 4000)).toBe(0);
    expect(varianceOf(null, 4000)).toBeNull();
  });
  it('rounds float noise away (0.1 + 0.2 style sums)', () => {
    expect(varianceOf(0.3, 0.1 + 0.2)).toBe(0);
    expect(varianceOf(100.1, 100)).toBe(0.1);
    expect(varianceOf(1234.57, 1234.5649999)).toBe(0.01);
  });
  it('kinds and the summary row words', () => {
    expect(varianceKind(null)).toBe('none');
    expect(varianceKind(0)).toBe('balanced');
    expect(varianceKind(-50)).toBe('short');
    expect(varianceKind(100)).toBe('over');
    expect(varianceRow(-50)).toEqual({ label: 'Short by', amount: '₹50.00', kind: 'short' });
    expect(varianceRow(100)).toEqual({ label: 'Over by', amount: '₹100.00', kind: 'over' });
    expect(varianceRow(0)).toEqual({ label: 'Balanced', amount: '', kind: 'balanced' });
  });
  it('the Days list word and money formats', () => {
    expect(closureWord(0)).toBe('Balanced');
    expect(closureWord(-20)).toBe('Short ₹20');
    expect(closureWord(100)).toBe('Over ₹100');
    expect(closureWord(-20.5)).toBe('Short ₹20.50');
    expect(money(6850)).toBe('₹6,850');
    expect(money2(6850)).toBe('₹6,850.00');
    expect(money2(1234567.5)).toBe('₹12,34,567.50');
  });
});

describe('Day closing — Close day enablement', () => {
  const base = { loaded: true, closed: false, counted: 4000, variance: 0, note: '', saving: false };
  it('disabled until a count is entered', () => {
    expect(canCloseDay({ ...base, counted: null, variance: null })).toBe(false);
    expect(canCloseDay(base)).toBe(true);
  });
  it('balanced needs no note; short or over needs the note filled', () => {
    expect(noteRequired(0)).toBe(false);
    expect(noteRequired(-50)).toBe(true);
    expect(canCloseDay({ ...base, counted: 3950, variance: -50, note: '' })).toBe(false);
    expect(canCloseDay({ ...base, counted: 3950, variance: -50, note: '   ' })).toBe(false);
    expect(canCloseDay({ ...base, counted: 3950, variance: -50, note: 'change given' })).toBe(true);
    expect(canCloseDay({ ...base, counted: 4100, variance: 100, note: '' })).toBe(false);
  });
  it('a closed day, an unloaded statement and an in-flight save never close', () => {
    expect(canCloseDay({ ...base, closed: true })).toBe(false);
    expect(canCloseDay({ ...base, loaded: false })).toBe(false);
    expect(canCloseDay({ ...base, saving: true })).toBe(false);
  });
});

describe('Day closing — Days list, modes, snapshot', () => {
  const cs = [
    closure({ id: 'a', date: '2026-11-17', variance: -20 }),
    closure({ id: 'b', date: '2026-11-18' }),
    closure({ id: 'e', date: '2026-11-18', shift: 'evening', closedAt: '2026-11-18T16:00:00Z' }),
  ];
  it('today first as Open, then closures newest first', () => {
    const r = dayRows(cs, '2026-11-19', '');
    expect(r[0]).toMatchObject({ open: true, date: '2026-11-19', closure: null });
    expect(r.slice(1).map((x) => x.key)).toEqual(['e', 'b', 'a']);
  });
  it('a closed today replaces the Open row; the shift filter keeps one shift (and today open for it)', () => {
    const withToday = [...cs, closure({ id: 't', date: '2026-11-19' })];
    expect(dayRows(withToday, '2026-11-19', '').some((x) => x.open)).toBe(false);
    const ev = dayRows(cs, '2026-11-19', 'evening');
    expect(ev.map((x) => x.key)).toEqual(['open:2026-11-19:evening', 'e']);
    expect(shiftsOf(cs)).toEqual(['evening']);
  });
  it('the four modes always show (idle at 0); extra modes follow', () => {
    const rows = modeRows([{ mode: 'upi', count: 8, total: 3200 }, { mode: 'cheque', count: 1, total: 500 }], [{ mode: 'cash', count: 1, total: 100 }]);
    expect(rows.map((r) => r.label)).toEqual(['UPI', 'Cash', 'Card', 'Credit wallet', 'Cheque']);
    expect(rows[0]).toMatchObject({ collected: 3200, count: 8 });
    expect(rows[1]).toMatchObject({ collected: 0, refunded: 100 });
  });
  it('reads the closure snapshot, and survives a broken one', () => {
    const t = closureTotals({ totalsJson: JSON.stringify({ payments: [{ mode: 'cash', count: 2, total: 100.5 }, { mode: 'upi', count: 1, total: 49.5 }], refunds: [{ mode: 'cash', count: 1, total: 10 }] }) });
    expect(t).toMatchObject({ collected: 150, refunded: 10 });
    expect(closureTotals({ totalsJson: 'not json' })).toBeNull();
    expect(closureTotals({ totalsJson: null })).toBeNull();
  });
  it('closed-by words name the person only when it is the signed-in one', () => {
    const c = closure({ closedBy: 'u1', closedAt: '2026-11-18T15:42:00Z' });
    expect(closedWords(c, { id: 'u1', name: 'Kavya' })).toBe('Closed by Kavya, 9:12 PM');
    expect(closedWords(c, { id: 'u2', name: 'Ravi' })).toBe('Closed 9:12 PM');
  });
});
