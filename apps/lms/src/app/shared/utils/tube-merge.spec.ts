import {
  canOfferPour, isMergedTube, manualMergesOf, mergeChipLabel, mergeRefusalText,
  pourTargets, sampleMeta, shortTubeName, warningLines,
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

  it('only a tube still at the counter, in-house, not timed and not a pot offers a pour', () => {
    expect(canOfferPour({ status: 'pending', tubeColor: 'plain' })).toBe(true);
    expect(canOfferPour({ status: 'collected', tubeColor: 'edta' })).toBe(true);
    expect(canOfferPour({ status: 'dispatched' })).toBe(false);
    expect(canOfferPour({ status: 'pending', outsourcedVendorId: 'v' })).toBe(false);
    expect(canOfferPour({ status: 'pending', repeatOffsetMin: 0 })).toBe(false);
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
