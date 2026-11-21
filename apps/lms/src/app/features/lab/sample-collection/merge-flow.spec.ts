import { additiveWords, chipSeparable, chipText, mergedInto, optimisticMerge, optimisticSeparate, placeholderTube, pourMotion, separateRefusalText, tubesInOne } from './merge-flow';

const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, barcode: `B-${id}`, tubeColor: 'fluoride', status: 'pending', metadata: null as unknown, collectedAt: null as string | null, ...extra });

describe('merge-flow — additive words and motion', () => {
  it('names a different additive in plain words; serum and gel are the same', () => {
    expect(additiveWords({ tubeColor: 'sst' }, { tubeColor: 'fluoride' })).toBe('Serum into Fluoride');
    expect(additiveWords({ tubeColor: 'edta' }, { tubeColor: 'plain' })).toBe('EDTA into Serum');
    expect(additiveWords({ tubeColor: 'plain' }, { tubeColor: 'sst' })).toBeNull();
    expect(additiveWords({ tubeColor: 'grey' }, { tubeColor: 'fluoride' })).toBeNull();
    expect(additiveWords({ tubeColor: 'mystery' }, { tubeColor: 'fluoride' })).toBeNull();
  });
  it('not drawn slides, drawn pours', () => {
    expect(pourMotion({ status: 'pending' })).toBe('slide');
    expect(pourMotion({ status: 'collected' })).toBe('pour');
  });
});

describe('merge-flow — optimistic merge + rollback', () => {
  it('removes the poured tube, adds the chip, keeps a snapshot to roll back to', () => {
    const list = [t('k'), t('g', { tubeColor: 'sst', barcode: '26310' }), t('x')];
    const r = optimisticMerge(list, 'k', 'g', '2026-11-21T10:00:00Z');
    expect(r.list.map(x => x.id)).toEqual(['k', 'x']);
    const keep = r.list[0];
    expect(mergedInto(keep)).toEqual([{ barcode: '26310', tubeColor: 'sst', sampleId: 'g', drawn: false }]);
    expect(chipText(mergedInto(keep)[0])).toBe('+ Gold · 26310');
    expect(tubesInOne(keep)).toBe('2 tubes in one');
    expect(keep.status).toBe('pending');                 // an undrawn tube doesn't make it drawn
    // rollback = the snapshot, untouched
    expect(r.snapshot).toEqual(list);
    expect(r.snapshot.map(x => x.id)).toEqual(['k', 'g', 'x']);
    expect(tubesInOne(r.snapshot[0])).toBeNull();
  });
  it('a drawn tube poured into an undrawn one makes it collected (like the server)', () => {
    const list = [t('k'), t('g', { status: 'collected', collectedAt: '2026-11-21T09:00:00Z' })];
    const r = optimisticMerge(list, 'k', 'g', '2026-11-21T10:00:00Z');
    expect(r.list[0].status).toBe('collected');
    expect(r.list[0].collectedAt).toBe('2026-11-21T09:00:00Z');
    expect(mergedInto(r.list[0])[0].drawn).toBe(true);
  });
  it('keeps other metadata keys and the retired-ID list', () => {
    const list = [t('k', { metadata: JSON.stringify({ extraSeries: ['s1'] }) }), t('g')];
    const meta = JSON.parse(optimisticMerge(list, 'k', 'g', 'now').list[0].metadata as string);
    expect(meta.extraSeries).toEqual(['s1']);
    expect(meta.mergedFromBarcodes).toEqual(['B-g']);
  });
  it('unknown ids change nothing', () => {
    const list = [t('k')];
    expect(optimisticMerge(list, 'k', 'nope', 'now').list).toEqual(list);
  });
});

describe('merge-flow — separate', () => {
  it('takes the chip off and puts the tube back right after the kept one; snapshot rolls back', () => {
    const merged = optimisticMerge([t('k'), t('g', { barcode: '26310', tubeColor: 'sst' }), t('x')], 'k', 'g', 'now');
    const back = merged.gone!;
    const r = optimisticSeparate(merged.list, 'k', back);
    expect(r.list.map(x => x.id)).toEqual(['k', 'g', 'x']);
    expect(mergedInto(r.list[0])).toEqual([]);
    expect(JSON.parse(r.list[0].metadata as string).mergedFromBarcodes).toBeUndefined();
    expect(r.snapshot.map(x => x.id)).toEqual(['k', 'x']);
  });
  it('a placeholder when the original row is not on this screen', () => {
    const keep = { ...t('k'), tests: [{ id: 'l1' }] };
    const p = placeholderTube(keep, { barcode: '26310', tubeColor: 'sst', sampleId: 'g', drawn: true });
    expect(p).toMatchObject({ id: 'g', barcode: '26310', tubeColor: 'sst', status: 'collected', tests: [] });
  });
  it('chips separate only at the counter and only for pours the server can undo', () => {
    const m = { barcode: '26310', tubeColor: 'sst', sampleId: 'g', drawn: false };
    expect(chipSeparable({ status: 'collected' }, m).ok).toBe(true);
    expect(chipSeparable({ status: 'dispatched' }, m)).toEqual({ ok: false, why: expect.stringMatching(/left the counter/) });
    expect(chipSeparable({ status: 'collected', receivedAtLab: 'x' }, m).ok).toBe(false);
    expect(chipSeparable({ status: 'collected' }, { ...m, sampleId: null }).why).toMatch(/before Separate existed/);
  });
  it('plain words for refusals; the server message wins', () => {
    expect(separateRefusalText('separate_dispatched')).toMatch(/left the counter/);
    expect(separateRefusalText('x', 'Server says no')).toBe('Server says no');
    expect(separateRefusalText(null)).toMatch(/can’t be taken back out/);
  });
});
