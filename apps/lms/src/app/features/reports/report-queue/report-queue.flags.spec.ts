import { ReportQueueComponent } from './report-queue.component';

/**
 * Test Master single-source — Stage 1 safety net.
 *
 * report-queue's preliminary-values preview RECOMPUTES a flag in the browser
 * (extractValues ~469-484) instead of reading the flag mw saved in the result
 * snapshot (`flagged[param].flag`). These specs freeze TODAY's behaviour so the
 * Phase-0 switch ("flags = the flag mw saved, no client recompute") is a
 * deliberate, visible change. Pure method → prototype.call on a bare context.
 */
const P = ReportQueueComponent.prototype as any;
const extract = (t: any) => P.extractValues.call({}, t);

const ot = (values: Record<string, unknown>, params: any[], extra: Record<string, unknown> = {}) => ({
  currentResult: JSON.stringify({ values, ...extra }),
  test: { parameters: JSON.stringify({ parameters: params }) },
});

describe('ReportQueue.extractValues — client-side flag recompute (CURRENT)', () => {
  const hb = {
    name: 'hb', title: 'Haemoglobin', unit: 'g/dL', criticalLow: 7, criticalHigh: 20,
    referenceRanges: [
      { min: 13, max: 17, sex: 'M' },   // first band — always used today
      { min: 12, max: 15, sex: 'F' },
    ],
  };

  it('returns [] without a snapshot, without parameters, or on malformed JSON', () => {
    expect(extract({ currentResult: null, test: { parameters: '{}' } })).toEqual([]);
    expect(extract({ currentResult: '{"values":{}}', test: {} })).toEqual([]);
    expect(extract({ currentResult: 'not json', test: { parameters: '{}' } })).toEqual([]);
    expect(extract({ currentResult: '{"values":{"a":1}}', test: { parameters: 'nope' } })).toEqual([]);
  });

  it('judges against referenceRanges[0] regardless of patient sex (the [0] shortcut)', () => {
    // 12.5 is inside the FEMALE band but below the first (male) band.
    const [row] = extract(ot({ hb: '12.5' }, [hb]));
    expect(row.flag).toBe('abnormal');
    expect(row.range).toBe('13–17 g/dL');
    expect(row.unit).toBe('g/dL');
    expect(row.title).toBe('Haemoglobin');
  });

  it('critical is INCLUSIVE here (<= / >=) — differs from validate-result and mw (strict)', () => {
    expect(extract(ot({ hb: '7' }, [hb]))[0].flag).toBe('critical');
    expect(extract(ot({ hb: '20' }, [hb]))[0].flag).toBe('critical');
  });

  it('uses only the PARAMETER-level criticals — band-scoped criticals are ignored', () => {
    const p = { name: 'k', title: 'K', referenceRanges: [{ min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }] };
    // 7 is past the band critical-high but no param-level critical → just abnormal.
    expect(extract(ot({ k: '7' }, [p]))[0].flag).toBe('abnormal');
  });

  it('non-numeric and missing values are "normal" and missing prints as an em dash', () => {
    const rows = extract(ot({ hb: 'haemolysed' }, [hb, { name: 'x', title: '' }]));
    expect(rows[0].flag).toBe('normal');
    expect(rows[1].value).toBe('—');
    expect(rows[1].title).toBe('x');       // empty title falls back to name
    expect(rows[1].range).toBeUndefined();
  });

  it('IGNORES the flag mw saved in the snapshot (flagged[param].flag)', () => {
    const t = ot({ hb: '15' }, [hb], { flagged: { hb: { value: '15', flag: 'L', range: '12–15' } } });
    // mw said Low for this patient; the browser recomputes "normal" from band[0].
    expect(extract(t)[0].flag).toBe('normal');
  });

  it.skip('TARGET phase 0: flag comes from the saved snapshot flagged[param].flag (no client recompute)', () => {
    const t = ot({ hb: '15' }, [hb], { flagged: { hb: { value: '15', flag: 'L', range: '12–15 g/dL' } } });
    const [row] = extract(t);
    expect(row.flag).toBe('abnormal');           // L/H/A → abnormal, C → critical, N → normal
    expect(row.range).toBe('12–15 g/dL');        // printed range = the band mw applied
  });

  it.skip('TARGET phase 0: saved "C" maps to critical even when the client would say normal', () => {
    const t = ot({ hb: '15' }, [hb], { flagged: { hb: { value: '15', flag: 'C' } } });
    expect(extract(t)[0].flag).toBe('critical');
  });
});
