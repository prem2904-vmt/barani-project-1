import {
  SHARE_CARD_TYPES, wireMeta, captionWithoutLink, cardCaption, cardChip, cardEyebrow, cardIcon, cardOf, cardPreview, encodeMentions,
  findPrefrontalLink, isAutoCardBody, localCardRoute, parseCardMeta, prefrontalPath, safeAppRoute,
} from './share-card';

/** Share to Messages — the ONE card model (PF-PATTERN §18 "Shared records"). */
describe('share-card — the card a message carries', () => {
  it('generic columns win; every type is drawable', () => {
    for (const type of SHARE_CARD_TYPES) {
      const c = cardOf({ sharedRecordType: type, sharedRecordId: 'x1', sharedRecordTitle: 'T', sharedRecordSubtitle: 'S' });
      expect(c).toEqual({ type, id: 'x1', title: 'T', subtitle: 'S', meta: null });
      expect(cardEyebrow(type)).not.toBe('Record');
      expect(cardIcon(type)).toMatch(/^<(path|rect|circle)/);
    }
  });

  it('a built-in Insights section card (null id on the wire) still draws, keyed by its section', () => {
    expect(cardOf({ sharedRecordType: 'insights', sharedRecordId: null, sharedRecordTitle: 'Revenue', sharedRecordSubtitle: 'This month', sharedRecordMeta: '{"section":"revenue","period":"month"}' }))
      .toEqual({ type: 'insights', id: 'revenue', title: 'Revenue', subtitle: 'This month', meta: { section: 'revenue', period: 'month' } });
    expect(cardOf({ sharedRecordType: 'insights', sharedRecordTitle: 'Overview' })?.id).toBe('overview');
    expect(cardOf({ sharedRecordType: 'patient', sharedRecordId: null })).toBeNull();
  });

  it('legacy SharedReport* rows (before the generic refactor) still render as a report card', () => {
    expect(cardOf({ sharedReportId: 'r1', sharedReportPatientName: 'Priya Nair', sharedReportTestSummary: 'CBC' }))
      .toEqual({ type: 'report', id: 'r1', title: 'Priya Nair', subtitle: 'CBC', meta: null });
  });

  it('an unknown future type is dropped, never drawn wrong; no record → null', () => {
    expect(cardOf({ sharedRecordType: 'invoice', sharedRecordId: 'i1' })).toBeNull();
    expect(cardOf({})).toBeNull();
    expect(cardOf(null)).toBeNull();
  });

  it('meta arrives as an object OR the jsonb string; junk is ignored, values become strings', () => {
    expect(parseCardMeta({ parameter: 'Hb', value: 4.2, nested: { a: 1 }, nil: null })).toEqual({ parameter: 'Hb', value: '4.2' });
    expect(parseCardMeta('{"flag":"critical_low"}')).toEqual({ flag: 'critical_low' });
    expect(parseCardMeta('not json')).toBeNull();
    expect(parseCardMeta([1, 2])).toBeNull();
    const c = cardOf({ sharedRecordType: 'result', sharedRecordId: 't1', sharedRecordTitle: 'Hb 4.2 g/dL', sharedRecordMeta: '{"parameter":"hb","flag":"CL"}' });
    expect(c?.meta).toEqual({ parameter: 'hb', flag: 'CL' });
  });
});

describe('share-card — status chip (words, never a raw code)', () => {
  it('result flags in words; criticals carry the critical tone', () => {
    const chip = (flag: string) => cardChip({ type: 'result', meta: { flag } });
    expect(chip('critical_low')).toEqual({ label: 'Critical low', tone: 'critical' });
    expect(chip('CH')).toEqual({ label: 'Critical high', tone: 'critical' });
    expect(chip('H')).toEqual({ label: 'High', tone: 'flag' });
    expect(chip('low')).toEqual({ label: 'Low', tone: 'flag' });
    expect(chip('abnormal')).toEqual({ label: 'Abnormal', tone: 'flag' });
  });
  it('a status word the server stamped → a neutral chip; nothing → no chip', () => {
    expect(cardChip({ type: 'order', meta: { status: 'in_progress' } })).toEqual({ label: 'In progress', tone: 'neutral' });
    expect(cardChip({ type: 'order', meta: null })).toBeNull();
    expect(cardChip({ type: 'result', meta: { flag: 'normal' } })).toBeNull();
  });
});

describe('share-card — captions + previews', () => {
  it('the legacy endpoints\' auto text ("📄 Shared report: …") is never shown as a caption', () => {
    expect(isAutoCardBody('📄 Shared report: Priya · CBC')).toBe(true);
    expect(isAutoCardBody('👤 Shared patient: Priya · MRN1')).toBe(true);
    expect(isAutoCardBody('Can you check this Hb?')).toBe(false);
    expect(cardCaption({ sharedReportId: 'r1', body: '📄 Shared report: Priya' })).toBe('');
    expect(cardCaption({ sharedRecordType: 'result', sharedRecordId: 't', body: '  Recheck please  ' })).toBe('Recheck please');
  });
  it('one-line preview names the card ("Order: LAB-…"), never emoji', () => {
    expect(cardPreview({ type: 'order', title: 'LAB-2610-000200' })).toBe('Order: LAB-2610-000200');
  });
});

describe('share-card — local fallback routes (older server without /cards/resolve)', () => {
  it('each type lands on the app\'s own screen; the guards + API stay the gate', () => {
    expect(localCardRoute({ type: 'patient', id: 'p1' })).toEqual({ route: '/p/p1' });
    expect(localCardRoute({ type: 'order', id: 'o1' })).toEqual({ route: '/o/o1', queryParams: { view: 'detail' } });
    expect(localCardRoute({ type: 'report', id: 'r1' })).toEqual({ route: '/reports/view/r1' });
    expect(localCardRoute({ type: 'result', id: 't1', meta: { sampleId: 's1', parameter: 'Hb' } }))
      .toEqual({ route: '/lab/sample/s1', queryParams: { view: '1', param: 'Hb' } });
    expect(localCardRoute({ type: 'result', id: 't1' })).toBeNull();
    expect(localCardRoute({ type: 'validation', id: 't1' })).toEqual({ route: '/pathologist/validate/t1' });
    expect(localCardRoute({ type: 'analyzer', id: 'm1', meta: { tab: 'qc' } })).toEqual({ route: '/lab/analyzer-results', queryParams: { message: 'm1', tab: 'qc' } });
    expect(localCardRoute({ type: 'insights', id: 'overview', meta: { period: 'month' } })).toEqual({ route: '/insights', queryParams: { section: 'overview', period: 'month' } });
  });
  it('only in-app paths are ever navigated (no protocol, host or markup)', () => {
    expect(safeAppRoute('/lab/sample/1')).toBe('/lab/sample/1');
    expect(safeAppRoute('https://evil.test/x')).toBeNull();
    expect(safeAppRoute('//evil.test/x')).toBeNull();
    expect(safeAppRoute('/a"onmouseover')).toBeNull();
    expect(safeAppRoute(42)).toBeNull();
  });
});

describe('share-card — pasted links', () => {
  const G = '0b8a1c2d-1111-4222-8333-944455556666';
  it('our hosts + record paths only; desktop hash links unwrap', () => {
    expect(prefrontalPath(`https://med-dev.prefrontal.health/o/${G}`)).toBe(`/o/${G}`);
    expect(prefrontalPath(`https://lab.example.com/reports/view/${G}`, 'lab.example.com')).toBe(`/reports/view/${G}`);
    expect(prefrontalPath(`https://x.prefrontal.health/#/lab/sample/${G}`)).toBe(`/lab/sample/${G}`);
    expect(prefrontalPath(`https://x.prefrontal.health/lab/analyzer-results?tab=qc&message=${G}`)).toBe(`/lab/analyzer-results?tab=qc&message=${G}`);
    expect(prefrontalPath('https://x.prefrontal.health/insights?section=revenue&period=month')).toBe('/insights?section=revenue&period=month');
    // Not ours / not a record / credentials / other schemes.
    expect(prefrontalPath(`https://evil.test/o/${G}`)).toBeNull();
    expect(prefrontalPath('https://x.prefrontal.health/frontdesk/patients/new')).toBeNull();
    expect(prefrontalPath('https://x.prefrontal.health/lab/my-work')).toBeNull();
    expect(prefrontalPath(`https://u:p@x.prefrontal.health/o/${G}`)).toBeNull();
    expect(prefrontalPath(`javascript:alert(1)//x.prefrontal.health/o/${G}`)).toBeNull();
  });
  it('finds the first record link in text (trailing punctuation trimmed); caption keeps the rest', () => {
    const url = `https://med.prefrontal.health/p/${G}`;
    const text = `Please see ${url}). Thanks`;
    expect(findPrefrontalLink(text)).toBe(url);
    expect(findPrefrontalLink('see https://google.com/o/1')).toBeNull();
    expect(captionWithoutLink(`Please see ${url} thanks`, url)).toBe('Please see thanks');
    expect(captionWithoutLink(url, url)).toBe('');
  });
});

describe('share-card — @mentions in a note', () => {
  it('"@Priya Nair" → "@<authId>" on the wire + the mention list (longest name first)', () => {
    const people = [{ id: 'a1', name: 'Priya' }, { id: 'a2', name: 'Priya Nair' }];
    expect(encodeMentions('@Priya Nair can you check?', people)).toEqual({ body: '@a2 can you check?', mentions: ['a2'] });
    expect(encodeMentions('@Priya and @Priya Nair', people)).toEqual({ body: '@a1 and @a2', mentions: ['a2', 'a1'] });
    expect(encodeMentions('no mentions', people)).toEqual({ body: 'no mentions', mentions: [] });
  });
});

describe('share-card — wire meta (what the server reads)', () => {
  it('result → {parameter} only; insights → the view; every other card → none', () => {
    expect(wireMeta({ type: 'result', meta: { parameter: 'hb', value: '4.2', flag: 'CL' } })).toEqual({ parameter: 'hb' });
    expect(wireMeta({ type: 'insights', meta: { section: 'revenue', period: 'custom', from: '2026-10-01', to: '2026-10-31', branch: 'b1', x: 'y' } }))
      .toEqual({ section: 'revenue', period: 'custom', from: '2026-10-01', to: '2026-10-31', branch: 'b1' });
    expect(wireMeta({ type: 'analyzer', meta: { tab: 'qc' } })).toBeNull();
    expect(wireMeta({ type: 'result', meta: null })).toBeNull();
  });
});
