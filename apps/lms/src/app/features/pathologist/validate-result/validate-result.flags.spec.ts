import { ValidateResultComponent } from './validate-result.component';

/**
 * Test Master single-source — Stage 1 safety net.
 *
 * validate-result's value rows RECOMPUTE flags client-side (valueRowsFor
 * ~1378-1402): sex/age band via the shared resolver, STRICT criticals, but
 * only the PARAMETER-level critical pair (band criticals ignored) and the
 * mw-saved snapshot flag is never read. Frozen here before Phase 0 swaps the
 * recompute for the saved flag.
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

describe('ValidateResult.valueRowsFor — client-side flag recompute (CURRENT)', () => {
  it('returns [] for no test/params/snapshot values', () => {
    expect(rows(null)).toEqual([]);
    expect(rows({ currentResult: null, test: { parameters: '{}' } })).toEqual([]);
    expect(rows({ currentResult: '{"values":{}}', test: { parameters: 'bad' } })).toEqual([]);
  });

  it('selects the band for the patient sex (female 12.5 → normal, male 12.5 → abnormal)', () => {
    expect(rows(ot({ hb: '12.5' }, [hb]))[0].flag).toBe('normal');
    expect(rows(ot({ hb: '12.5' }, [hb], { sex: 'Male', age: 30 }))[0].flag).toBe('abnormal');
  });

  it('prints the selected band + unit as the range and exposes min/max', () => {
    const [r] = rows(ot({ hb: '13' }, [hb]));
    expect(r.range).toBe('12–15 g/dL');
    expect(r.min).toBe(12);
    expect(r.max).toBe(15);
    expect(r.numeric).toBe(13);
  });

  it('critical is STRICT: exactly at the param-level limit is not critical', () => {
    expect(rows(ot({ hb: '7' }, [hb]))[0].flag).toBe('abnormal');
    expect(rows(ot({ hb: '6.9' }, [hb]))[0].flag).toBe('critical');
    expect(rows(ot({ hb: '20.1' }, [hb]))[0].flag).toBe('critical');
  });

  it('IGNORES band-scoped criticals (only the parameter-level pair is used)', () => {
    const k = { name: 'k', title: 'K', referenceRanges: [{ min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }] };
    const [r] = rows(ot({ k: '7' }, [k]));
    expect(r.flag).toBe('abnormal');
    expect(r.critHigh).toBeUndefined();
  });

  it('IGNORES the mw-saved snapshot flag', () => {
    const t = ot({ hb: '13' }, [hb], undefined, { flagged: { hb: { value: '13', flag: 'C' } } });
    expect(rows(t)[0].flag).toBe('normal');
  });

  it('countsFor() tallies the recomputed flags', () => {
    const t = ot({ hb: '6', x: '1' }, [hb, { name: 'x', title: 'X', referenceRanges: [{ min: 2, max: 3 }] }]);
    expect(P.countsFor.call({ valueRowsFor: (o: any) => rows(o) }, t))
      .toEqual({ total: 2, normal: 0, abnormal: 1, critical: 1 });
  });

  it.skip('TARGET phase 0: flag = snapshot.flagged[param].flag (C → critical, L/H/A → abnormal, N → normal)', () => {
    const t = ot({ hb: '13' }, [hb], undefined, { flagged: { hb: { value: '13', flag: 'C', range: '12–15' } } });
    expect(rows(t)[0].flag).toBe('critical');
  });

  it.skip('TARGET phase 0: band-scoped criticals are honoured (via the saved flag)', () => {
    const k = { name: 'k', title: 'K', referenceRanges: [{ min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }] };
    const t = ot({ k: '7' }, [k], undefined, { flagged: { k: { value: '7', flag: 'C' } } });
    expect(rows(t)[0].flag).toBe('critical');
  });
});
