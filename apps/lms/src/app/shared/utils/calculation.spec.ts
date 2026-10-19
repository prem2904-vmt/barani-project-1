import { evalExpr, evaluateCalc, parseCalc, ageYearsFromDob, lintExpr, CalcContext } from './calculation';

const ctxOf = (vals: Record<string, number | null>, extra: Partial<CalcContext> = {}): CalcContext => ({
  value: (r) => vals[r],
  ...extra,
});

describe('evalExpr', () => {
  const L = (vals: Record<string, number>) => (n: string) => vals[n] ?? null;

  it('does arithmetic with precedence and parens', () => {
    expect(evalExpr('BIO153 - BIO155 - (BIO154 / 5)', L({ BIO153: 200, BIO155: 50, BIO154: 100 }))).toBe(130);
    expect(evalExpr('HEM011 * 100 / HEM013', L({ HEM011: 15, HEM013: 45 }))).toBeCloseTo(33.33, 2);
    expect(evalExpr('2 + 3 * 4', L({}))).toBe(14);
  });

  it('supports pow/min/max and unary minus', () => {
    expect(evalExpr('pow(HEM106 / MNPT, ISI)', L({ HEM106: 24, MNPT: 12, ISI: 1 }))).toBe(2);
    expect(evalExpr('pow(10, BIO375 - 6.1)', L({ BIO375: 7.1 }))).toBeCloseTo(10, 6);
    expect(evalExpr('min(3, 5) + max(3, 5)', L({}))).toBe(8);
    expect(evalExpr('-BIO001 + 5', L({ BIO001: 2 }))).toBe(3);
  });

  it('evaluates comparisons to 1/0 (validWhen grammar)', () => {
    expect(evalExpr('BIO154 <= 400', L({ BIO154: 400 }))).toBe(1);
    expect(evalExpr('BIO154 <= 400', L({ BIO154: 401 }))).toBe(0);
    expect(evalExpr('AGE >= 18', L({ AGE: 17 }))).toBe(0);
  });

  it('resolves CODE:Param identifiers (spaces allowed in the param part)', () => {
    expect(evalExpr('HEM019:Neutrophils % / 2', (n) => (n === 'HEM019:Neutrophils %' ? 60 : null))).toBe(30);
  });

  it('returns null on missing refs, division by zero, and malformed input', () => {
    expect(evalExpr('BIO154 / 5', L({}))).toBeNull();
    expect(evalExpr('BIO153 / BIO155', L({ BIO153: 1, BIO155: 0 }))).toBeNull();
    expect(evalExpr('BIO153 +', L({ BIO153: 1 }))).toBeNull();
    expect(evalExpr('BIO153 $ 2', L({ BIO153: 1 }))).toBeNull();
  });
});

describe('evaluateCalc', () => {
  it('computes a plain expr (VLDL = TG/5)', () => {
    const r = evaluateCalc({ kind: 'expr', expr: 'BIO154 / 5', inputs: ['BIO154'] }, ctxOf({ BIO154: 150 }));
    expect(r).toEqual({ value: 30, missing: [], invalid: false });
  });

  it('reports missing dependencies instead of a value', () => {
    const r = evaluateCalc(
      { kind: 'expr', expr: 'BIO153 - BIO155', inputs: ['BIO153', 'BIO155'] },
      ctxOf({ BIO153: 200, BIO155: null })
    );
    expect(r.value).toBeNull();
    expect(r.missing).toEqual(['BIO155']);
    expect(r.invalid).toBe(false);
  });

  it('marks invalid when the validWhen gate fails (Friedewald above TG 400)', () => {
    const def = {
      kind: 'expr',
      expr: 'BIO153 - BIO155 - (BIO154 / 5)',
      inputs: ['BIO153', 'BIO155', 'BIO154'],
      validWhen: 'BIO154 <= 400',
    };
    expect(evaluateCalc(def, ctxOf({ BIO153: 300, BIO155: 40, BIO154: 500 })))
      .toEqual({ value: null, missing: [], invalid: true });
    expect(evaluateCalc(def, ctxOf({ BIO153: 300, BIO155: 40, BIO154: 200 })).value).toBe(220);
  });

  it('uses lab-constant defaults and tenant overrides (INR)', () => {
    const def = { kind: 'inr', expr: 'pow(HEM106 / MNPT, ISI)', inputs: ['HEM106'], constants: ['ISI', 'MNPT'] };
    // Defaults: MNPT 12, ISI 1 → PT 18s = 1.5
    expect(evaluateCalc(def, ctxOf({ HEM106: 18 })).value).toBe(1.5);
    // Tenant reagent: ISI 1.2 → 1.5^1.2
    const r = evaluateCalc(def, ctxOf({ HEM106: 18 }, { constant: (n) => (n === 'ISI' ? 1.2 : undefined) }));
    expect(r.value).toBeCloseTo(Math.pow(1.5, 1.2), 2);
  });

  it('computes CKD-EPI 2021 creatinine with sex branching and the age gate', () => {
    const def = { kind: 'ckdepi2021_cr', inputs: ['BIO055'], validWhen: 'AGE >= 18' };
    // Published check value: female, 55y, Scr 0.8 → ≈ 85–86
    const f = evaluateCalc(def, ctxOf({ BIO055: 0.8, AGE: 55 }, { age: 55, sex: 'F' }));
    expect(f.value).toBeGreaterThan(80);
    expect(f.value).toBeLessThan(92);
    // Same inputs male ≠ female (different K/alpha/factor)
    const m = evaluateCalc(def, ctxOf({ BIO055: 0.8, AGE: 55 }, { age: 55, sex: 'M' }));
    expect(m.value).not.toEqual(f.value);
    // Under 18 → invalid, not a number
    const kid = evaluateCalc(def, ctxOf({ BIO055: 0.8, AGE: 10 }, { age: 10, sex: 'M' }));
    expect(kid).toEqual({ value: null, missing: [], invalid: true });
  });

  it('computes RPI with the doc maturation-factor bands', () => {
    const def = { kind: 'rpi', inputs: ['HEM060', 'HEM013'], constants: ['NORMAL_HCT'] };
    // RET 6%, HCT 30 → corrected 6×30/45 = 4, factor(26–35) 1.5 → 2.67
    expect(evaluateCalc(def, ctxOf({ HEM060: 6, HEM013: 30 })).value).toBeCloseTo(2.67, 2);
    // HCT 40 → factor 1
    expect(evaluateCalc(def, ctxOf({ HEM060: 6, HEM013: 40 })).value).toBeCloseTo(6 * 40 / 45, 2);
  });

  it('computes the R-value from dynamic ULNs', () => {
    const def = { kind: 'r_value', inputs: ['BIO107', 'BIO108'] };
    const r = evaluateCalc(def, ctxOf({ BIO107: 200, BIO108: 120 }, {
      uln: (c) => (c === 'BIO107' ? 40 : 120),
    }));
    // (200/40)/(120/120) = 5 → hepatocellular
    expect(r.value).toBe(5);
    // Missing ULN reports it, no crash
    const miss = evaluateCalc(def, ctxOf({ BIO107: 200, BIO108: 120 }, { uln: () => null }));
    expect(miss.value).toBeNull();
    expect(miss.missing).toContain('BIO107 ULN');
  });
});

describe('parseCalc', () => {
  it('accepts computable kinds and rejects documentary/broken payloads', () => {
    expect(parseCalc('{"kind":"expr","expr":"BIO154 / 5"}')?.kind).toBe('expr');
    expect(parseCalc('{"kind":"analyzer"}')).toBeNull();
    expect(parseCalc('{"kind":"clinical_excluded"}')).toBeNull();
    expect(parseCalc('not json')).toBeNull();
    expect(parseCalc(null)).toBeNull();
  });
});

describe('lintExpr', () => {
  it('accepts valid formulas and lists their refs (functions excluded)', () => {
    expect(lintExpr('BIO153 - BIO155 - (BIO154 / 5)')).toEqual({
      ok: true, refs: ['BIO153', 'BIO155', 'BIO154'],
    });
    expect(lintExpr('pow(HEM106 / MNPT, ISI)')).toEqual({
      ok: true, refs: ['HEM106', 'MNPT', 'ISI'],
    });
  });

  it('rejects grammar errors', () => {
    expect(lintExpr('BIO153 +').ok).toBe(false);
    expect(lintExpr('BIO153 $ 2').ok).toBe(false);
    expect(lintExpr('(BIO153').ok).toBe(false);
  });

  it('does not false-negative on subtraction inside a divisor', () => {
    expect(lintExpr('BIO153 / (BIO154 - BIO155)').ok).toBe(true);
  });
});

describe('ageYearsFromDob', () => {
  it('derives fractional years and rejects bad input', () => {
    const now = new Date('2026-08-16T00:00:00Z');
    expect(ageYearsFromDob('1990-08-16', now)).toBeCloseTo(36, 1);
    expect(ageYearsFromDob('2030-01-01', now)).toBeNull();
    expect(ageYearsFromDob('garbage', now)).toBeNull();
    expect(ageYearsFromDob(null, now)).toBeNull();
  });
});
