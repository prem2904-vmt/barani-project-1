import { describe, expect, it } from 'vitest';
import { ageInYears, ageParts, bandAgeYears, dobDate, formatAge, formatAgeParts, patientAge } from './patient-age';
import { labelAgeSex } from '../../core/printer/label-print.service';
import { formatPatientInfo, formatPatientMeta } from '../models/patient.model';
import { selectReferenceRange } from './reference-range';
import { dobFromAge } from '../forms/patient-fields';

// Mirrors mw Prefrontal.Tests/PatientAgeTests.cs — same dates, same answers.
const NOW = new Date(2026, 8, 29, 15, 0); // 29 Sep 2026, afternoon (local)

describe('patient-age: calendar parts (server parity)', () => {
  const cases: [string, number, number, number, string][] = [
    ['1992-03-15', 34, 6, 14, '34 Y'],
    ['1992-09-29', 34, 0, 0, '34 Y'],
    ['1992-09-30', 33, 11, 30, '33 Y'],
    ['2019-01-10', 7, 8, 19, '7 Y'],
    ['2026-01-20', 0, 8, 9, '8 M'],
    ['2026-09-17', 0, 0, 12, '12 D'],
    ['2026-09-29', 0, 0, 0, '0 D'],
    ['2025-09-29', 1, 0, 0, '1 Y'],
  ];
  it.each(cases)('%s → %i y %i m %i d (%s)', (dob, y, m, d, shown) => {
    const a = ageParts(dob, NOW)!;
    expect([a.years, a.months, a.days]).toEqual([y, m, d]);
    expect(formatAgeParts(a)).toBe(shown);
  });

  it('future / invalid / empty → null', () => {
    expect(ageParts('2026-10-01', NOW)).toBeNull();
    expect(ageParts('garbage', NOW)).toBeNull();
    expect(ageParts(null, NOW)).toBeNull();
  });

  it('reads the server canonical form and an IST-midnight instant as the typed date', () => {
    expect(dobDate('2020-05-01T00:00:00Z')!.getDate()).toBe(1);
    expect(dobDate('2020-05-01')!.getMonth()).toBe(4);
    // IST midnight 1 May sent as ISO by an old client: 30 Apr 18:30Z → 1 May locally (IST runner) —
    // on any runner it is the LOCAL date of that instant, like the server's lab-local read.
    const inst = new Date('2020-04-30T18:30:00.000Z');
    expect(dobDate('2020-04-30T18:30:00.000Z')!.getDate()).toBe(inst.getDate());
  });

  it('band age = whole days / 365.25 (server BandYears)', () => {
    expect(bandAgeYears({ dateOfBirth: '2026-01-20' }, NOW)).toBeCloseTo(252 / 365.25, 10);
    expect(bandAgeYears({ age: 25 }, NOW)).toBe(25);
    expect(bandAgeYears({ dateOfBirth: '1992-03-15', age: 6 }, NOW)!).toBeGreaterThan(34);
    // Server-provided wins.
    expect(bandAgeYears({ ageYears: 0.5, dateOfBirth: '2000-01-01' }, NOW)).toBe(0.5);
    expect(bandAgeYears(null, NOW)).toBeNull();
  });

  it('DOB beats a stale stored age everywhere', () => {
    const p = { dateOfBirth: '2000-09-01T00:00:00Z', age: 6 };
    expect(ageInYears(p, NOW)).toBe(26);
    expect(formatAge(p, 'short', '', NOW)).toBe('26 Y');
  });

  it('snapshot ageDisplay (no DOB) is honoured — infant months survive the report', () => {
    expect(formatAge({ age: 0, ageDisplay: '8 M' }, 'Years', '', NOW)).toBe('8 Months');
    expect(formatAge({ age: 0, ageDisplay: '12 D' }, 'yrs', '', NOW)).toBe('12 days');
    expect(patientAge({ age: 0, ageDisplay: '8 M', ageYears: 0.69 }, NOW)!.fractionalYears).toBe(0.69);
    expect(formatAge({ age: 37 }, 'Years', '', NOW)).toBe('37 Years');
  });
});

describe('patient-age: display styles keep adult formats byte-identical', () => {
  const adult = { dateOfBirth: '1992-03-15' };
  const infant = { dateOfBirth: '2026-01-20' };
  const newborn = { dateOfBirth: '2026-09-28' };
  it.each([
    ['short', '34 Y', '8 M', '1 D'],
    ['Y', '34Y', '8M', '1D'],
    ['y', '34y', '8m', '1d'],
    ['num', '34', '8M', '1D'],
    ['yrs', '34 yrs', '8 mos', '1 days'],
    ['Years', '34 Years', '8 Months', '1 Days'],
    ['long', '34 years', '8 months', '1 day'],
  ] as const)('%s', (style, a, i, n) => {
    expect(formatAge(adult, style, '', NOW)).toBe(a);
    expect(formatAge(infant, style, '', NOW)).toBe(i);
    expect(formatAge(newborn, style, '', NOW)).toBe(n);
  });
  it('unknown → fallback', () => expect(formatAge({}, 'y', '—', NOW)).toBe('—'));
});

describe('labels + patient lines use the DOB', () => {
  it('tube label: "34Y M", infant "8M F", never "0Y"', () => {
    expect(labelAgeSex({ dateOfBirth: '1992-03-15', age: 6, sex: 'Male' }, NOW)).toBe('34Y M');
    expect(labelAgeSex({ dateOfBirth: '2026-01-20', age: 0, sex: 'Female' }, NOW)).toBe('8M F');
    expect(labelAgeSex({ age: 52, sex: 'Male' }, NOW)).toBe('52Y M');
    expect(labelAgeSex({ sex: 'Male' }, NOW)).toBe('M');
  });
  it('the "age/sex" slot', () => {
    const dob = ageParts('1990-01-01')!; // live today
    expect(formatPatientMeta({ dateOfBirth: '1990-01-01', age: 1, sex: 'Male', mrn: 'AA1' })).toBe(`${dob.years}/M · AA1`);
    expect(formatPatientInfo({ firstName: 'Ravi', fathersName: 'K', age: 40, sex: 'M', mrn: 'X' })).toBe('Ravi K | 40/M | X');
  });
});

describe('flag band pick: adult / child / infant (the live hint = the saved flag)', () => {
  const bands = [
    { segment: 'Newborn', minAge: 0, maxAge: 28, ageUnit: 'days', min: 14, max: 24 },
    { segment: 'Infant', minAge: 1, maxAge: 12, ageUnit: 'months', min: 10, max: 14 },
    { segment: 'Child', minAge: 1, maxAge: 12, ageUnit: 'years', min: 11, max: 15 },
    { segment: 'Adult male', sex: 'M', minAge: 18, min: 13, max: 17 },
  ];
  it.each([
    ['2026-09-17', 'Newborn'],
    ['2026-01-20', 'Infant'],
    ['2019-01-10', 'Child'],
    ['1992-03-15', 'Adult male'],
  ])('%s → %s (stored age 0 ignored)', (dob, seg) => {
    const r = selectReferenceRange(bands as never, 'M', bandAgeYears({ dateOfBirth: dob, age: 0 }, NOW));
    expect((r as { segment?: string } | undefined)?.segment).toBe(seg);
  });
});

describe('registration round-trip: age box → estimated DOB → same age back', () => {
  it.each([
    [40, 'years' as const, '40 Y'],
    [8, 'months' as const, '8 M'],
    [12, 'days' as const, '12 D'],
  ])('%i %s', (n, unit, shown) => {
    const dob = dobFromAge(n, unit, NOW);
    expect(formatAge({ dateOfBirth: dob }, 'short', '', NOW)).toBe(shown);
  });
});

describe('patient-age: months / days spelled in full (OPS-141)', () => {
  const baby = (dob: string) => ageParts(dob, NOW)!;
  const styles = ['short', 'Y', 'y', 'num', 'yrs', 'Years', 'long'] as const;

  it.each(styles)('%s: an 8-month-old never gets an abbreviation', (st) => {
    const out = formatAgeParts(baby('2026-01-20'), st, true);
    expect(out).toMatch(st === 'Years' ? /^8 Months$/ : /^8 months$/);
  });
  it.each(styles)('%s: 12 days / 1 day / 0 days', (st) => {
    const cap = (w: string) => (st === 'Years' ? w[0].toUpperCase() + w.slice(1) : w);
    expect(formatAgeParts(baby('2026-09-17'), st, true)).toBe(`12 ${cap('days')}`);
    expect(formatAgeParts(baby('2026-09-28'), st, true)).toBe(`1 ${cap('day')}`);
    expect(formatAgeParts(baby('2026-09-29'), st, true)).toBe(`0 ${cap('days')}`);
  });
  it('1 month is singular; the day before 1 year is still months', () => {
    expect(formatAgeParts(baby('2026-08-29'), 'short', true)).toBe('1 month');
    expect(formatAgeParts(baby('2025-09-30'), 'yrs', true)).toBe('11 months');
  });
  it('years follow the chosen style, spelled or not (boundary 1 year)', () => {
    expect(formatAgeParts(baby('2025-09-29'), 'yrs', true)).toBe('1 yrs');
    expect(formatAgeParts(baby('1992-03-15'), 'short', true)).toBe('34 Y');
    expect(formatAgeParts(baby('1992-03-15'), 'Y', true)).toBe('34Y');
  });
  it('off by default: the compact styles used by tube labels are untouched', () => {
    expect(formatAgeParts(baby('2026-01-20'), 'Y')).toBe('8M');
    expect(formatAgeParts(baby('2026-01-20'), 'yrs')).toBe('8 mos');
  });
  it('a server ageDisplay-only patient (report snapshot) is spelled too', () => {
    expect(formatAge({ ageDisplay: '6 M', ageYears: 0.5 }, 'short', '', NOW, true)).toBe('6 months');
    expect(formatAge({ ageDisplay: '12 D' }, 'Years', '', NOW, true)).toBe('12 Days');
  });
});
