import { describe, expect, it } from 'vitest';
import type { DetectResult, InstrumentDto, LoincSuggestionDto } from './instrument.models';
import {
  CBC_DEFAULT_MAPS, DEFAULT_TEXT_LINE_PATTERN, applyDetectProposal, applyLoincSuggestions, buildInstrumentConfig, buildUpsert,
  codesFromMessages, connectionSummary, controlCharsText, emptyCodeMapRow, emptyInstrumentForm, formFromInstrument,
  mergeUnmappedCodes, previewLine, previewRows, renderControlChars, sharedCodeHint, statusWord, toCodeMapUpserts, validateCodeMaps,
  validateInstrumentForm, withCbcDefaults, withM51Defaults, M51_HL7_MAPS,
} from './instrument-config';
import { codeMapSuggestionsUrl, messagesUrl } from './instruments-api.service';

describe('instrument config — wizard form → contract config JSON', () => {
  it('serial: port, 9600 8N1, flow control → rtscts / xon', () => {
    const f = emptyInstrumentForm();
    f.name = 'Sysmex XN';
    f.serial = { path: 'COM3', baudRate: 19200, dataBits: 7, parity: 'even', stopBits: 2, flow: 'rtscts' };
    const cfg = buildInstrumentConfig(f);
    expect(cfg.transport).toEqual({ type: 'serial', path: 'COM3', baudRate: 19200, dataBits: 7, parity: 'even', stopBits: 2, rtscts: true, xon: false });
    f.serial.flow = 'xonxoff';
    expect(buildInstrumentConfig(f).transport).toMatchObject({ rtscts: false, xon: true });
  });

  it('tcp-server listens on 0.0.0.0; tcp-client carries host + reconnect', () => {
    const f = emptyInstrumentForm();
    f.transport = 'tcp-server'; f.tcpServer.port = 5001;
    expect(buildInstrumentConfig(f).transport).toEqual({ type: 'tcp-server', port: 5001, host: '0.0.0.0' });
    f.transport = 'tcp-client'; f.tcpClient = { host: ' 192.168.1.50 ', port: 5100 };
    expect(buildInstrumentConfig(f).transport).toEqual({ type: 'tcp-client', host: '192.168.1.50', port: 5100, reconnectMs: 5000 });
  });

  it('folder: path + pattern + poll; moveTo only when set', () => {
    const f = emptyInstrumentForm();
    f.transport = 'folder'; f.folder = { path: 'C:/LIS/out', pattern: '*.txt', moveTo: '' };
    expect(buildInstrumentConfig(f).transport).toEqual({ type: 'folder', path: 'C:/LIS/out', pattern: '*.txt', pollMs: 2000 });
    f.folder.moveTo = 'C:/LIS/done';
    expect(buildInstrumentConfig(f).transport).toMatchObject({ moveTo: 'C:/LIS/done' });
  });

  it('protocol picks the link layer; parser carries all three sub-configs with the contract defaults', () => {
    const f = emptyInstrumentForm();
    expect(buildInstrumentConfig(f).link.type).toBe('auto');
    f.protocol = 'astm';
    const astm = buildInstrumentConfig(f);
    expect(astm.link).toMatchObject({ type: 'astm-e1381', ackTimeoutMs: 15000, frameTimeoutMs: 30000 });
    expect(astm.parser).toMatchObject({ type: 'astm', astm: { sampleIdField: 3, sampleIdComponent: 1 }, hl7: { sampleIdField: 'OBR-3' } });
    expect(astm.parser.text?.linePattern).toBe(DEFAULT_TEXT_LINE_PATTERN);
    f.protocol = 'hl7'; expect(buildInstrumentConfig(f).link.type).toBe('mllp');
    f.protocol = 'text'; expect(buildInstrumentConfig(f).link.type).toBe('raw');
  });

  it('an edit keeps tuned link timings + unknown keys from the saved config', () => {
    const f = emptyInstrumentForm(); f.protocol = 'astm'; f.serial.path = 'COM1';
    const cfg = buildInstrumentConfig(f, {
      link: { type: 'astm-e1381', ackTimeoutMs: 9000, terminator: '\u0004' }, extraThing: 1,
    } as never);
    expect(cfg.link).toMatchObject({ ackTimeoutMs: 9000, terminator: '\u0004' });
    expect((cfg as Record<string, unknown>)['extraThing']).toBe(1);
  });

  it('round-trips: config → form → config', () => {
    const f = emptyInstrumentForm();
    f.name = 'Mindray BC-5150'; f.make = 'Mindray'; f.transport = 'tcp-client'; f.tcpClient = { host: '10.0.0.9', port: 5100 };
    f.protocol = 'hl7'; f.hl7.sampleIdField = 'SPM-2';
    const up = buildUpsert(f);
    const dto = { ...up, id: 'x', transport: 'tcp-client', isActive: true } as unknown as InstrumentDto;
    const back = formFromInstrument(dto);
    expect(back).toMatchObject({ name: 'Mindray BC-5150', make: 'Mindray', transport: 'tcp-client', protocol: 'hl7' });
    expect(buildInstrumentConfig(back)).toEqual(up.config);
    expect(up.model).toBeNull();
  });

  it('validation: name, port / host, regex per step', () => {
    const f = emptyInstrumentForm();
    expect(validateInstrumentForm(f).map((i) => i.field)).toEqual(['name', 'serial.path']);
    f.name = 'A'; f.transport = 'tcp-client'; f.tcpClient = { host: '', port: 70000 };
    expect(validateInstrumentForm(f).map((i) => i.field)).toEqual(['tcpClient.host', 'tcpClient.port']);
    f.transport = 'tcp-server'; f.tcpServer.port = 5001; f.protocol = 'text'; f.text.linePattern = '([';
    expect(validateInstrumentForm(f)).toEqual([{ step: 'protocol', field: 'text.linePattern', message: expect.any(String) }]);
  });

  it('"Use this" applies a detect proposal to the protocol step (copy; unknown = unchanged)', () => {
    const f = emptyInstrumentForm();
    const d: DetectResult = {
      protocol: 'astm', link: 'astm-e1381', confidence: 0.94, reasons: ['ENQ/STX framing'],
      proposed: { link: { type: 'astm-e1381', ackTimeoutMs: 12000 }, parser: { type: 'astm', astm: { sampleIdField: 3, sampleIdComponent: 2 } } },
    };
    const { form, link } = applyDetectProposal(f, d);
    expect(form.protocol).toBe('astm');
    expect(form.astm).toEqual({ sampleIdField: 3, sampleIdComponent: 2 });
    expect(f.protocol).toBe('auto');                // input untouched
    expect(buildInstrumentConfig(form, { link: link! }).link.ackTimeoutMs).toBe(12000);
    expect(applyDetectProposal(f, { ...d, protocol: 'unknown' }).form.protocol).toBe('auto');
  });
});

describe('instrument config — code maps', () => {
  it('CBC defaults: 20 codes; WBC/PLT ×1000 dp0 to HEM019/HEM030; absolute counts ×1 dp2', () => {
    expect(CBC_DEFAULT_MAPS).toHaveLength(20);
    const rows = withCbcDefaults([]);
    expect(rows.find((r) => r.analyzerCode === 'WBC')).toMatchObject({ testCatalogKey: 'HEM019', factor: 1000, decimals: 0 });
    expect(rows.find((r) => r.analyzerCode === 'PLT')).toMatchObject({ testCatalogKey: 'HEM030', factor: 1000, decimals: 0 });
    expect(rows.find((r) => r.analyzerCode === 'RBC')).toMatchObject({ testCatalogKey: 'HEM012', decimals: 2 });
    expect(rows.find((r) => r.analyzerCode === 'HGB')).toMatchObject({ testCatalogKey: 'HEM011', decimals: 1 });
    for (const [i, c] of ['NEUT%', 'LYMPH%', 'MONO%', 'EOS%', 'BASO%'].entries()) {
      expect(rows.find((r) => r.analyzerCode === c)).toMatchObject({ testCatalogKey: `HEM02${i}`, decimals: 1 });
    }
    for (const [i, c] of ['NEUT#', 'LYMPH#', 'MONO#', 'EOS#', 'BASO#'].entries()) {
      expect(rows.find((r) => r.analyzerCode === c)).toMatchObject({ testCatalogKey: `HEM02${5 + i}`, factor: 1, decimals: 2 });
    }
  });

  it('CBC defaults never override an existing mapping; a blank row with a CBC code is filled', () => {
    const rows = withCbcDefaults([
      { ...emptyCodeMapRow('wbc'), testCatalogKey: 'CUSTOM', factor: 1 },
      emptyCodeMapRow('HGB'),
    ]);
    expect(rows.filter((r) => r.analyzerCode.toUpperCase() === 'WBC')).toHaveLength(1);
    expect(rows.find((r) => r.analyzerCode === 'wbc')!.testCatalogKey).toBe('CUSTOM');
    expect(rows.find((r) => r.analyzerCode === 'HGB')!.testCatalogKey).toBe('HEM011');
    expect(rows).toHaveLength(20);
  });

  it('Medonic M51 (HL7, OBX-3 comp 1 = LOINC): 22 analytes, WBC/PLT ×1000, codes from a real Arun-lab run', () => {
    // NM codes the M51 sent on 2026-10-01 (sample 10614), excluding ones with no Test Master test.
    const sent = ['6690-2', '770-8', '736-9', '5905-5', '713-8', '706-2', '751-8', '731-0', '742-7', '711-2', '704-7',
      '789-8', '718-7', '4544-3', '787-2', '785-6', '786-4', '788-0', '777-3', '32623-1', '32207-3', '11003'];
    const rows = withM51Defaults([]);
    expect(M51_HL7_MAPS).toHaveLength(22);
    expect(rows.map((r) => r.analyzerCode).sort()).toEqual([...sent].sort());
    expect(new Set(rows.map((r) => r.testCatalogKey)).size).toBe(22);
    expect(rows.find((r) => r.analyzerCode === '6690-2')).toMatchObject({ testCatalogKey: 'HEM019', factor: 1000, decimals: 0 });
    expect(rows.find((r) => r.analyzerCode === '777-3')).toMatchObject({ testCatalogKey: 'HEM030', factor: 1000, decimals: 0 });
    expect(rows.find((r) => r.analyzerCode === '751-8')).toMatchObject({ testCatalogKey: 'HEM025', factor: 1, decimals: 2 });
    // Same never-override rule as the CBC defaults.
    const kept = withM51Defaults([{ ...emptyCodeMapRow('6690-2'), testCatalogKey: 'CUSTOM', factor: 1 }]);
    expect(kept.find((r) => r.analyzerCode === '6690-2')!.testCatalogKey).toBe('CUSTOM');
    expect(kept).toHaveLength(22);
  });

  it('unmapped-code merge: new codes only, case-insensitive, blanks + dupes dropped', () => {
    const { rows, added } = mergeUnmappedCodes([emptyCodeMapRow('WBC')], ['wbc', 'RET%', ' ', null, 'RET%', 'IG#']);
    expect(added).toBe(2);
    expect(rows.map((r) => r.analyzerCode)).toEqual(['WBC', 'RET%', 'IG#']);
  });

  it('codes from the listen session feed the merge', () => {
    expect(codesFromMessages([{ sampleId: '1', results: [{ code: 'WBC', value: '7' }, { code: 'RBC', value: '4' }] }])).toEqual(['WBC', 'RBC']);
  });

  it('validation + PUT body: blank rows dropped, duplicates / missing test flagged, trimmed', () => {
    const rows = [
      { ...emptyCodeMapRow(' WBC '), testCatalogKey: 'HEM019', factor: 1000, decimals: 0 },
      { ...emptyCodeMapRow('wbc'), testCatalogKey: 'HEM019' },
      emptyCodeMapRow('RET'),
      emptyCodeMapRow(''),
    ];
    expect(validateCodeMaps(rows).map((i) => i.index)).toEqual([1, 2]);
    expect(toCodeMapUpserts(rows)).toEqual([
      { analyzerCode: 'WBC', testCatalogKey: 'HEM019', parameterName: null, factor: 1000, offset: 0, decimals: 0, unit: null },
      { analyzerCode: 'wbc', testCatalogKey: 'HEM019', parameterName: null, factor: 1, offset: 0, decimals: null, unit: null },
    ]);
  });
});

describe('instrument config — one analyzer code on several rows (Erba GLU)', () => {
  const glu = (key: string) => ({ ...emptyCodeMapRow('GLU'), testCatalogKey: key });

  it('the same code with DIFFERENT tests is allowed and all rows are saved, in order', () => {
    const rows = [glu('BIO010'), glu('BIO011'), { ...glu('BIO496'), analyzerCode: 'glu' }];
    expect(validateCodeMaps(rows)).toEqual([]);
    expect(toCodeMapUpserts(rows).map((u) => u.testCatalogKey)).toEqual(['BIO010', 'BIO011', 'BIO496']);
  });

  it('the same code AND test twice is still an error (case-insensitive)', () => {
    const issues = validateCodeMaps([glu('BIO010'), { ...glu('bio010'), analyzerCode: ' glu ' }]);
    expect(issues).toEqual([{ index: 1, message: 'glu is mapped to this test twice' }]);
  });

  it('a plain hint on the shared code’s first row only', () => {
    const rows = [glu('BIO010'), { ...emptyCodeMapRow('WBC'), testCatalogKey: 'HEM019' }, glu('BIO011')];
    expect(sharedCodeHint(rows, 0)).toBe('Same code on several rows: the one ordered on the tube is used');
    expect(sharedCodeHint(rows, 1)).toBeNull();
    expect(sharedCodeHint(rows, 2)).toBeNull();
    expect(sharedCodeHint([glu('BIO010')], 0)).toBeNull();
    expect(sharedCodeHint([emptyCodeMapRow(''), emptyCodeMapRow('')], 0)).toBeNull();
  });
});

describe('instrument config — LOINC auto-match (applyLoincSuggestions)', () => {
  const single = (code: string, catalogKey: string, testName: string, opts: Partial<LoincSuggestionDto> = {}): LoincSuggestionDto => ({
    code, isTest: true, skipReason: null, candidates: [{ testId: 't-' + catalogKey, testName, catalogKey, unit: null }],
    suggestedFactor: null, suggestedDecimals: null, suggestedUnit: null, confidence: 'loinc-exact', ...opts,
  });

  it('a single candidate fills the test + the suggested factor/decimals/unit and flags loincMatched', () => {
    const s = single('6690-2', 'HEM019', 'Total Leukocyte Count', { suggestedFactor: 1000, suggestedDecimals: 0, suggestedUnit: 'cells/µL' });
    const { rows, added, matched, skipped } = applyLoincSuggestions([], [s]);
    expect(added).toBe(1);
    expect(matched).toBe(1);
    expect(skipped).toEqual([]);
    expect(rows).toEqual([{
      analyzerCode: '6690-2', testCatalogKey: 'HEM019', parameterName: '', factor: 1000, offset: 0, decimals: 0,
      unit: 'cells/µL', testName: 'Total Leukocyte Count', loincMatched: true, loincCandidates: undefined,
    }]);
  });

  it('no special-case factor falls back to factor 1 and the candidate’s OWN unit', () => {
    const s = single('718-7', 'HEM011', 'Haemoglobin', { candidates: [{ testId: 't2', testName: 'Haemoglobin', catalogKey: 'HEM011', unit: 'g/dL' }] });
    const { rows } = applyLoincSuggestions([], [s]);
    expect(rows[0]).toMatchObject({ testCatalogKey: 'HEM011', factor: 1, decimals: null, unit: 'g/dL' });
  });

  it('an EXISTING blank row for the same code is filled in place, not duplicated', () => {
    const s = single('6690-2', 'HEM019', 'Total Leukocyte Count');
    const { rows, added } = applyLoincSuggestions([emptyCodeMapRow('6690-2')], [s]);
    expect(added).toBe(0); // filled in place, not a new row
    expect(rows).toHaveLength(1);
    expect(rows[0].testCatalogKey).toBe('HEM019');
  });

  it('a row that already has a test is left untouched', () => {
    const existing = { ...emptyCodeMapRow('6690-2'), testCatalogKey: 'CUSTOM' };
    const s = single('6690-2', 'HEM019', 'Total Leukocyte Count');
    const { rows, added, matched } = applyLoincSuggestions([existing], [s]);
    expect(added).toBe(0);
    expect(matched).toBe(1); // still counted — the caller may ignore it; the row itself is untouched
    expect(rows[0].testCatalogKey).toBe('CUSTOM');
  });

  it('two or more candidates: the row carries loincCandidates, no test picked, no auto-pick factor', () => {
    const s: LoincSuggestionDto = {
      code: '6690-2', isTest: true, skipReason: null, confidence: 'loinc-exact',
      candidates: [
        { testId: 't1', testName: 'Total Leukocyte Count', catalogKey: 'HEM019', unit: 'cells/µL' },
        { testId: 't2', testName: 'Haemoglobin', catalogKey: 'HEM011', unit: 'g/dL' },
      ],
      suggestedFactor: null, suggestedDecimals: null, suggestedUnit: null,
    };
    const { rows, added, matched } = applyLoincSuggestions([], [s]);
    expect(added).toBe(1);
    expect(matched).toBe(0);
    expect(rows[0].testCatalogKey).toBe('');
    expect(rows[0].loincCandidates).toHaveLength(2);
  });

  it('a non-analyte (ignore-list) code is skipped — never added as a row', () => {
    const s: LoincSuggestionDto = { code: '30525-0', isTest: false, skipReason: 'age', candidates: [], suggestedFactor: null, suggestedDecimals: null, suggestedUnit: null, confidence: null };
    const { rows, added, skipped } = applyLoincSuggestions([], [s]);
    expect(added).toBe(0);
    expect(rows).toEqual([]);
    expect(skipped).toEqual([{ code: '30525-0', reason: 'age' }]);
  });

  it('a LOINC code with no candidate (not ignored, not matched) adds a plain blank row', () => {
    const s: LoincSuggestionDto = { code: '88888-3', isTest: true, skipReason: null, candidates: [], suggestedFactor: null, suggestedDecimals: null, suggestedUnit: null, confidence: null };
    const { rows, added, matched } = applyLoincSuggestions([], [s]);
    expect(added).toBe(1);
    expect(matched).toBe(0);
    expect(rows[0]).toMatchObject({ analyzerCode: '88888-3', testCatalogKey: '' });
  });
});

describe('instrument config — code-map-suggestions URL (codeMapSuggestionsUrl)', () => {
  it('codes joined; no units param when nothing is known', () => {
    const url = codeMapSuggestionsUrl('i1', ['6690-2', '718-7']);
    expect(url).toBe('/api/instruments/i1/code-map-suggestions?codes=6690-2%2C718-7');
  });

  it('units carried 1:1 by index, blank for an unknown code', () => {
    const url = codeMapSuggestionsUrl('i1', ['6690-2', '718-7'], ['10^3/uL', null]);
    const q = new URL('http://x' + url).searchParams;
    expect(q.get('codes')).toBe('6690-2,718-7');
    expect(q.get('units')).toBe('10^3/uL,');
  });
});

describe('instrument config — raw capture + preview + summaries', () => {
  it('control characters render visibly (<STX> … <CR>) and frames break per line', () => {
    const raw = '\u0005\u00021H|\\^&\r\u0003A1\r\n\u0004';
    expect(controlCharsText(raw)).toBe('<ENQ><STX>1H|\\^&<CR>\n<ETX>A1<CR><LF>\n<EOT>');
    const segs = renderControlChars('\u0002R|1');
    expect(segs).toEqual([{ text: '<STX>', ctrl: true }, { text: 'R|1', ctrl: false }]);
  });

  it('parsed preview rows + line text ("Sample 26123 · WBC 7.8 10^3/µL · H")', () => {
    const rows = previewRows([{ sampleId: '26123', results: [{ code: 'WBC', value: '7.8', unit: '10^3/µL', flags: ['H'] }] }]);
    expect(previewLine(rows[0])).toBe('Sample 26123 · WBC 7.8 10^3/µL · H');
    expect(previewLine({ ...rows[0], qc: true, flags: '' })).toBe('QC · WBC 7.8 10^3/µL');
  });

  it('connection summary + status word', () => {
    expect(connectionSummary({ transport: { type: 'serial', path: 'COM3', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, rtscts: false, xon: false } })).toBe('Serial COM3 · 9600 8N1');
    expect(connectionSummary({ transport: { type: 'tcp-client', host: '10.0.0.9', port: 5100, reconnectMs: 5000 } })).toBe('TCP client · 10.0.0.9:5100');
    expect(connectionSummary(null)).toBe('—');
    expect(statusWord('online').tone).toBe('green');
    expect(statusWord('never').label).toBe('Never connected');
  });

  it('messages URL clamps page size ≤ 100', () => {
    expect(messagesUrl({ state: 'unmatched', pageSize: 500 })).toBe('/api/instruments/messages?state=unmatched&page=1&pageSize=100');
    expect(messagesUrl({ instrumentId: 'i 1' })).toBe('/api/instruments/messages?instrumentId=i+1&page=1&pageSize=50');
  });

  it('messages URL carries sampleId (Fetch from analyzer — the tube already open)', () => {
    expect(messagesUrl({ state: 'unmatched', sampleId: '26123' })).toBe('/api/instruments/messages?state=unmatched&sampleId=26123&page=1&pageSize=50');
    expect(messagesUrl({ sampleId: null })).toBe('/api/instruments/messages?page=1&pageSize=50');
  });
});
