import { ValidateResultComponent } from './validate-result.component';

/**
 * Test Master single source — validate-result's value rows.
 *
 * Phase 0 (done): the flag and printed range are mw's SAVED verdict
 * (snapshot `flagged[param]`), so the pathologist signs off exactly what the
 * report prints. The band (sex/age resolver) and its criticals only draw the
 * range bar. The old client recompute (param-only criticals, saved flag
 * ignored) is retired.
 */
const P = ValidateResultComponent.prototype as any;
const ctx = { snapshotFor: P.snapshotFor };
const rows = (t: any) => P.valueRowsFor.call(ctx, t);

const ot = (values: Record<string, unknown>, params: any[], patient: any = { sex: 'Female', age: 30 }, extra: any = {}) => ({
  currentResult: JSON.stringify({ values, ...extra }),
  test: { parameters: JSON.stringify({ parameters: params }) },
  subOrder: { order: { patient } },
});

const hb = {
  name: 'hb', title: 'Hb', unit: 'g/dL', type: 'numeric', criticalLow: 7, criticalHigh: 20,
  referenceRanges: [
    { min: 13, max: 17, sex: 'M' },
    { min: 12, max: 15, sex: 'F' },
  ],
};

describe('ValidateResult.valueRowsFor — saved flag (Phase 0)', () => {
  it('returns [] for no test/params/snapshot values', () => {
    expect(rows(null)).toEqual([]);
    expect(rows({ currentResult: null, test: { parameters: '{}' } })).toEqual([]);
    expect(rows({ currentResult: '{"values":{}}', test: { parameters: 'bad' } })).toEqual([]);
  });

  it('the range bar uses the band for the patient sex (female → 12–15, male → 13–17)', () => {
    expect(rows(ot({ hb: '12.5' }, [hb]))[0]).toMatchObject({ min: 12, max: 15 });
    expect(rows(ot({ hb: '12.5' }, [hb], { sex: 'Male', age: 30 }))[0]).toMatchObject({ min: 13, max: 17 });
  });

  it('legacy snapshot (no saved verdict): the selected band + unit print, value unflagged', () => {
    const [r] = rows(ot({ hb: '6' }, [hb]));
    expect(r.range).toBe('12–15 g/dL');
    expect(r.numeric).toBe(6);
    expect(r.flag).toBe('normal');
  });

  it('saved range wins over the client band text', () => {
    const t = ot({ hb: '13' }, [hb], undefined, { flagged: { hb: { value: '13', flag: 'N', range: '11.5–15.5', unit: 'g/dL' } } });
    expect(rows(t)[0].range).toBe('11.5–15.5 g/dL');
  });

  it('bar criticals: band criticals ahead of the parameter pair', () => {
    const k = { name: 'k', title: 'K', criticalHigh: 9, referenceRanges: [{ min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }] };
    const [r] = rows(ot({ k: '4' }, [k]));
    expect(r.critLow).toBe(2.5);
    expect(r.critHigh).toBe(6.5);
  });

  it('countsFor() tallies the saved flags', () => {
    const t = ot({ hb: '6', x: '1' }, [hb, { name: 'x', title: 'X', referenceRanges: [{ min: 2, max: 3 }] }], undefined,
      { flagged: { hb: { flag: 'C' }, x: { flag: 'L' } } });
    expect(P.countsFor.call({ valueRowsFor: (o: any) => rows(o) }, t))
      .toEqual({ total: 2, normal: 0, abnormal: 1, critical: 1 });
  });

  it('TARGET phase 0: flag = snapshot.flagged[param].flag (C → critical, L/H/A → abnormal, N → normal)', () => {
    const t = ot({ hb: '13' }, [hb], undefined, { flagged: { hb: { value: '13', flag: 'C', range: '12–15' } } });
    expect(rows(t)[0].flag).toBe('critical');
    const a = ot({ hb: '13' }, [hb], undefined, { flagged: { hb: { value: '13', flag: 'A' } } });
    expect(rows(a)[0].flag).toBe('abnormal');
  });

  it('owner 2026-09-27: the chip badges CL / CH; legacy C shows as C', () => {
    const cl = rows(ot({ hb: '6' }, [hb], undefined, { flagged: { hb: { value: '6', flag: 'CL' } } }))[0];
    const ch = rows(ot({ hb: '21' }, [hb], undefined, { flagged: { hb: { value: '21', flag: 'CH' } } }))[0];
    const legacy = rows(ot({ hb: '21' }, [hb], undefined, { flagged: { hb: { value: '21', flag: 'C' } } }))[0];
    expect([cl.flag, ch.flag, legacy.flag]).toEqual(['critical', 'critical', 'critical']);
    expect(P.flagLabel(cl.flag, cl.crit)).toBe('CL');
    expect(P.flagLabel(ch.flag, ch.crit)).toBe('CH');
    expect(P.flagLabel(legacy.flag, legacy.crit)).toBe('C');
    expect(P.flagLabel('abnormal', '')).toBe('ABNORMAL');
  });

  it('TARGET phase 0: band-scoped criticals are honoured (via the saved flag)', () => {
    const k = { name: 'k', title: 'K', referenceRanges: [{ min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }] };
    const t = ot({ k: '7' }, [k], undefined, { flagged: { k: { value: '7', flag: 'C' } } });
    expect(rows(t)[0].flag).toBe('critical');
  });
});
