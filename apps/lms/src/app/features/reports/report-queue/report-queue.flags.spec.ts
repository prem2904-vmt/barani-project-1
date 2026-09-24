import { ReportQueueComponent } from './report-queue.component';

/**
 * Test Master single source — report-queue's preliminary-values preview.
 *
 * Phase 0 (done): the flag and printed range are the ones mw SAVED with the
 * result (snapshot `flagged[param]`), via the shared savedValueRows helper.
 * The old browser recompute (`referenceRanges[0]`, inclusive criticals,
 * band criticals ignored, saved flag ignored) is retired.
 * Pure method → prototype.call on a bare context.
 */
const P = ReportQueueComponent.prototype as any;
const extract = (t: any) => P.extractValues.call({}, t);

const ot = (values: Record<string, unknown>, params: any[], extra: Record<string, unknown> = {}) => ({
  currentResult: JSON.stringify({ values, ...extra }),
  test: { parameters: JSON.stringify({ parameters: params }) },
});

describe('ReportQueue.extractValues — saved flag (Phase 0)', () => {
  const hb = {
    name: 'hb', title: 'Haemoglobin', unit: 'g/dL', criticalLow: 7, criticalHigh: 20,
    referenceRanges: [
      { min: 13, max: 17, sex: 'M' },
      { min: 12, max: 15, sex: 'F' },
    ],
  };

  it('returns [] without a snapshot, without parameters, or on malformed JSON', () => {
    expect(extract({ currentResult: null, test: { parameters: '{}' } })).toEqual([]);
    expect(extract({ currentResult: '{"values":{}}', test: {} })).toEqual([]);
    expect(extract({ currentResult: 'not json', test: { parameters: '{}' } })).toEqual([]);
    expect(extract({ currentResult: '{"values":{"a":1}}', test: { parameters: 'nope' } })).toEqual([]);
  });

  it('no [0] shortcut: without a saved verdict the value is unflagged and EVERY band is listed', () => {
    const [row] = extract(ot({ hb: '12.5' }, [hb]));
    expect(row.flag).toBe('normal');
    expect(row.range).toContain('13–17');
    expect(row.range).toContain('12–15');
    expect(row.unit).toBe('g/dL');
    expect(row.title).toBe('Haemoglobin');
  });

  it('never recomputes criticals in the browser (a saved N at the param limit stays normal)', () => {
    const t = ot({ hb: '7' }, [hb], { flagged: { hb: { value: '7', flag: 'N', range: '12–15' } } });
    expect(extract(t)[0].flag).toBe('normal');
  });

  it('band-scoped criticals are honoured via the saved flag', () => {
    const p = { name: 'k', title: 'K', referenceRanges: [{ min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }] };
    expect(extract(ot({ k: '7' }, [p], { flagged: { k: { value: '7', flag: 'C' } } }))[0].flag).toBe('critical');
  });

  it('missing values print as an em dash; empty title falls back to name', () => {
    const rows = extract(ot({ hb: 'haemolysed' }, [hb, { name: 'x', title: '' }]));
    expect(rows[0].flag).toBe('normal');
    expect(rows[1].value).toBe('—');
    expect(rows[1].title).toBe('x');
    expect(rows[1].range).toBeUndefined();
  });

  it('TARGET phase 0: flag comes from the saved snapshot flagged[param].flag (no client recompute)', () => {
    const t = ot({ hb: '15' }, [hb], { flagged: { hb: { value: '15', flag: 'L', range: '12–15 g/dL' } } });
    const [row] = extract(t);
    expect(row.flag).toBe('abnormal');           // L/H/A → abnormal, C → critical, N → normal
    expect(row.range).toBe('12–15 g/dL');        // printed range = the band mw applied
  });

  it('TARGET phase 0: saved "C" maps to critical even when the client would say normal', () => {
    const t = ot({ hb: '15' }, [hb], { flagged: { hb: { value: '15', flag: 'C' } } });
    expect(extract(t)[0].flag).toBe('critical');
  });
});
