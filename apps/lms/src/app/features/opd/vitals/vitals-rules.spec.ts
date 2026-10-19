import { bmi, bmiBand, parseReading, validateVitals, vitalFlags, vitalsSummary } from './vitals-rules';

/** Same fixtures as prefrontal-mw FrontdeskRulesTests (OpdVitalsRules). */
describe('vitals rules', () => {
  it('derives BMI to one decimal with its band', () => {
    expect(bmi(68, 161)).toBe(26.2);
    expect(bmiBand(26.2)).toBe('Overweight');
    expect(bmi(68, null)).toBeNull();
    expect(bmiBand(18.4)).toBe('Underweight');
    expect(bmiBand(18.5)).toBe('Normal');
    expect(bmiBand(null)).toBeNull();
  });
  it('flags impossible readings per field, a lone BP half and an empty form', () => {
    expect(validateVitals({ spo2: 140 }).spo2).toBeTruthy();
    expect(validateVitals({}).form).toBeTruthy();
    expect(validateVitals({ bpSys: 120 }).bpDia).toBeTruthy();
    expect(validateVitals({ bpSys: 80, bpDia: 90 }).bpDia).toBeTruthy();
    expect(validateVitals({ bpSys: 128, bpDia: 82, pulse: 84, tempF: 99.1, spo2: 98, respRate: 16, weightKg: 68, heightCm: 161 })).toEqual({});
    expect(validateVitals({ note: 'Refused BP' })).toEqual({});
  });
  it('flags readings outside the screening bands', () => {
    expect(vitalFlags({ bpSys: 142, bpDia: 90, pulse: 110, spo2: 92, tempF: 101 }).map(f => f.key)).toEqual(['bp', 'pulse', 'spo2', 'tempF']);
    expect(vitalFlags({ bpSys: 128, bpDia: 82, pulse: 84, spo2: 98, tempF: 99.1 })).toEqual([]);
    expect(vitalFlags({ bpSys: 85, bpDia: 55 })[0]).toEqual({ key: 'bp', level: 'low', label: 'BP low' });
  });
  it('parses typed readings (no spinners): digits, one dot for decimal fields', () => {
    expect(parseReading('', false)).toBeNull();
    expect(parseReading('128', false)).toBe(128);
    expect(parseReading('99.1', true)).toBe(99.1);
    expect(parseReading('99.1', false)).toBeNaN();
  });
  it('summarises for rows', () => {
    expect(vitalsSummary({ bpSys: 128, bpDia: 82, spo2: 98 })).toBe('BP 128/82 · SpO₂ 98%');
    expect(vitalsSummary({ pulse: 80 })).toBe('Pulse 80');
    expect(vitalsSummary(null)).toBeNull();
  });
});
