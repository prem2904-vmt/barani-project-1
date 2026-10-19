import { OpdVisitStatus, canMoveVisit } from './opd.models';

/** Same cases as the C# OpdGateUnitTests.Visit_status_flow — keep in sync. */
describe('canMoveVisit mirrors OpdVisitStatus.CanMove', () => {
  const rows: Array<[OpdVisitStatus, OpdVisitStatus, boolean]> = [
    ['booked', 'waiting', true], ['booked', 'vitals', true], ['vitals', 'waiting', true],
    ['waiting', 'in_consult', true], ['in_consult', 'completed', true], ['in_consult', 'waiting', true],
    ['waiting', 'cancelled', true], ['booked', 'no_show', true],
    ['booked', 'completed', false], ['completed', 'waiting', false], ['in_consult', 'cancelled', false], ['cancelled', 'booked', false],
  ];
  it.each(rows)('%s → %s = %s', (from, to, ok) => expect(canMoveVisit(from, to)).toBe(ok));
});
