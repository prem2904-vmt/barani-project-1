import { describe, expect, it } from 'vitest';
import type { DetectResult, InstrumentDto } from './instrument.models';
import {
  CBC_DEFAULT_MAPS, DEFAULT_TEXT_LINE_PATTERN, applyDetectProposal, buildInstrumentConfig, buildUpsert, codesFromMessages,
  connectionSummary, controlCharsText, emptyCodeMapRow, emptyInstrumentForm, formFromInstrument, mergeUnmappedCodes,
  previewLine, previewRows, renderControlChars, statusWord, toCodeMapUpserts, validateCodeMaps, validateInstrumentForm,
  withCbcDefaults,
} from './instrument-config';
import { messagesUrl } from './instruments-api.service';

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
});
