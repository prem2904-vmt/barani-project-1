import {
  canOfferPour, isMergedTube, manualMergesOf, mergeChipLabel, mergeRefusalText,
  extraSeriesOf, pourTargets, sampleMeta, shortTubeName, timedPourOk, warningLines,
} from './tube-merge';

describe('tube-merge helpers', () => {
  it('reads metadata.manualMerge from a JSON string or an object; junk → []', () => {
    const entry = { barcode: '26104', tubeColor: 'plain', by: 'u1', at: '2026-10-25T03:10:00Z' };
    expect(manualMergesOf({ metadata: JSON.stringify({ manualMerge: [entry] }) })).toEqual([entry]);
    expect(manualMergesOf({ metadata: { manualMerge: [entry, { tubeColor: 'x' }] } })).toEqual([entry]);
    expect(manualMergesOf({ metadata: '{bad json' })).toEqual([]);
    expect(manualMergesOf({ metadata: null })).toEqual([]);
    expect(sampleMeta({ metadata: '[1,2]' })).toEqual({});
  });

  it('chips name the poured tube by its cap and Sample ID', () => {
    expect(mergeChipLabel({ barcode: '26104', tubeColor: 'plain' })).toBe('+ Red (26104)');
    expect(mergeChipLabel({ barcode: '9', tubeColor: 'fluoride' })).toBe('+ Grey (9)');
    expect(shortTubeName(null)).toBe('Tube');
    expect(shortTubeName('custom')).toBe('Custom');
  });

  it('merged tubes are dead; pour targets skip them and the source itself', () => {
    expect(isMergedTube({ status: 'merged' })).toBe(true);
    expect(isMergedTube({ status: 'pending' })).toBe(false);
    const a = { id: 'a', orderId: 'o', status: 'pending' };
    const list = [a, { id: 'b', orderId: 'o', status: 'collected' }, { id: 'c', orderId: 'o', status: 'merged' }, { id: 'd', orderId: 'x', status: 'pending' }];
    expect(pourTargets(a, list).map(s => s.id)).toEqual(['b']);
  });

  it('only a tube still at the counter, in-house, a timed draw too, and not a pot offers a pour', () => {
    expect(canOfferPour({ status: 'pending', tubeColor: 'plain' })).toBe(true);
    expect(canOfferPour({ status: 'collected', tubeColor: 'edta' })).toBe(true);
    expect(canOfferPour({ status: 'dispatched' })).toBe(false);
    expect(canOfferPour({ status: 'pending', outsourcedVendorId: 'v' })).toBe(false);
    expect(canOfferPour({ status: 'pending', repeatOffsetMin: 0 })).toBe(true);
    expect(canOfferPour({ status: 'pending', repeatOffsetMin: 60 })).toBe(true);
    expect(canOfferPour({ status: 'pending', tubeColor: 'sterile' })).toBe(false);
    expect(canOfferPour({ status: 'pending', tubeColor: 'blood_culture' })).toBe(false);
  });

  it('refusal codes read as plain words; the server message wins', () => {
    expect(mergeRefusalText('merge_has_results')).toBe('This tube already has results.');
    expect(mergeRefusalText('merge_self')).toBe('A tube can’t be poured into itself.');
    expect(mergeRefusalText('nope')).toBe('This tube can’t be poured into that one.');
    expect(mergeRefusalText('merge_self', 'Server says no')).toBe('Server says no');
  });

  it('warning lines are de-duplicated and trimmed', () => {
    expect(warningLines([{ code: 'a', message: ' X ' }, { code: 'a', message: 'X' }, { code: 'b', message: '' }])).toEqual(['X']);
    expect(warningLines(null)).toEqual([]);
  });
});

describe('timed draws (pour rule mirror)', () => {
  const o = 'o';
  const base = (id: string, series?: string) => ({ id, orderId: o, status: 'pending', repeatOffsetMin: series ? 0 : null, repeatProfileTestId: series ?? null });
  const at = (id: string, offset: number, series: string, extra?: string[]) =>
    ({ id, orderId: o, status: 'pending', repeatOffsetMin: offset, repeatProfileTestId: series, metadata: extra ? JSON.stringify({ extraSeries: extra }) : null });

  it('first draws pour with untimed tubes and other first draws', () => {
    expect(timedPourOk(base('a'), base('b', 's1'))).toBe(true);
    expect(timedPourOk(base('a', 's1'), base('b', 's2'))).toBe(true);
  });

  it('a later draw pours only with another series at the same offset', () => {
    expect(timedPourOk(at('a', 60, 's1'), at('b', 60, 's2'))).toBe(true);
    expect(timedPourOk(at('a', 60, 's1'), at('b', 120, 's2'))).toBe(false);
    expect(timedPourOk(at('a', 60, 's1'), base('b', 's2'))).toBe(false);
    expect(timedPourOk(at('a', 60, 's1'), base('b'))).toBe(false);
    expect(timedPourOk(at('a', 60, 's1'), at('b', 60, 's1'))).toBe(false);          // same series twice
    expect(timedPourOk(at('a', 60, 's1', ['s2']), at('b', 60, 's2'))).toBe(false);  // already holds s2
    expect(timedPourOk(at('a', 60, 's1', ['s2']), at('b', 60, 's3'))).toBe(true);
    expect(extraSeriesOf(at('a', 60, 's1', ['s2']))).toEqual(['s2']);
  });

  it('pourTargets lists exactly the tubes the rule allows', () => {
    const src = at('ogtt60', 60, 'ogtt');
    const list = [src, at('ins60', 60, 'ins'), at('ins120', 120, 'ins'), base('ogtt0', 'ogtt'), base('plain'), at('ogtt60b', 60, 'ogtt')];
    expect(pourTargets(src, list).map(s => s.id)).toEqual(['ins60']);
    const first = base('ogtt0', 'ogtt');
    expect(pourTargets(first, list).map(s => s.id)).toEqual(['plain']);
  });

  it('the refusal speaks plainly', () => {
    expect(mergeRefusalText('merge_timed_series')).toBe('Only draws taken at the same time can be poured together.');
  });
});
