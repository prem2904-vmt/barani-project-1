import { describe, expect, it } from 'vitest';
import type { InstrumentConfig, InstrumentDto } from './instrument.models';
import { buildInstrumentConfig, buildUpsert, formFromInstrument } from './instrument-config';

const dtoOf = (config: unknown, transport = 'tcp-server') =>
  ({ name: 'X', make: null, model: null, serialNumber: null, isActive: true, transport, config }) as unknown as InstrumentDto;

const TCP = { type: 'tcp-server', port: 5001, host: '0.0.0.0' };
const LINK_T = { ackTimeoutMs: 15000, frameTimeoutMs: 30000, idleMs: 1500 };

/** Every stored protocol config must survive config → form → config untouched
 *  (the editor saves through exactly this path on EVERY step, incl. Code mapping). */
const CASES: Record<string, InstrumentConfig> = {
  'lifedx-hbpro over stx-etx (fields, id window, layout, path, decimals)': {
    transport: TCP as never,
    link: { type: 'stx-etx', ...LINK_T, terminator: '\r\n' },
    parser: {
      type: 'lifedx-hbpro',
      astm: { sampleIdField: 3, sampleIdComponent: 1 },
      hl7: { sampleIdField: 'OBR-3' },
      text: { linePattern: 'a', sampleIdPattern: 'b', qcPattern: 'c', fixedColumns: null },
      hbpro: {
        fields: [{ code: 'HbA1c', start: 63, end: 69, unit: '%', decimals: 1 }, { code: 'HbF', start: 69, end: 75, unit: null }],
        sampleIdStart: 4, sampleIdEnd: 12, layout: 'none', sampleIdPath: 'record[0]',
      } as never,
    },
  },
  'lifedx-hbpro with the built-in layout (no fields)': {
    transport: TCP as never,
    link: { type: 'stx-etx', ...LINK_T },
    parser: {
      type: 'lifedx-hbpro',
      astm: { sampleIdField: 3, sampleIdComponent: 1 }, hl7: { sampleIdField: 'OBR-3' },
      text: { linePattern: 'a', sampleIdPattern: 'b', qcPattern: 'c', fixedColumns: null },
      hbpro: { fields: [], layout: 'builtin' } as never,
    },
  },
  'sinocare-fhir over sinocare-sn (replyMode, ack, sampleIdField, path, extras)': {
    transport: TCP as never,
    link: { type: 'sinocare-sn', ...LINK_T, replyMode: 'echo', ackJson: '{"code":0}', headerBytes: 4 },
    parser: {
      type: 'sinocare-fhir',
      astm: { sampleIdField: 3, sampleIdComponent: 1 }, hl7: { sampleIdField: 'OBR-3' },
      text: { linePattern: 'a', sampleIdPattern: 'b', qcPattern: 'c', fixedColumns: null },
      sinocare: { sampleIdField: 'position', sampleIdPath: 'patient.id', extraFlag: true } as never,
    },
  },
  'hl7 + sampleIdPath + untouched extras': {
    transport: TCP as never,
    link: { type: 'mllp', ...LINK_T },
    parser: {
      type: 'hl7',
      astm: { sampleIdField: 3, sampleIdComponent: 1 },
      hl7: { sampleIdField: 'PID-3', sampleIdPath: 'OBX[1]-3' },
      text: { linePattern: 'a', sampleIdPattern: 'b', qcPattern: 'c', fixedColumns: null },
    },
    bidirectional: undefined, vendorNote: 'keep',
  } as never,
  'astm + sampleIdPath': {
    transport: TCP as never,
    link: { type: 'astm-e1381', ...LINK_T },
    parser: {
      type: 'astm',
      astm: { sampleIdField: 4, sampleIdComponent: 2, sampleIdPath: 'O|3' },
      hl7: { sampleIdField: 'OBR-3' },
      text: { linePattern: 'a', sampleIdPattern: 'b', qcPattern: 'c', fixedColumns: null },
    },
  },
  'text with fixedColumns': {
    transport: TCP as never,
    link: { type: 'raw', ...LINK_T },
    parser: {
      type: 'text',
      astm: { sampleIdField: 3, sampleIdComponent: 1 }, hl7: { sampleIdField: 'OBR-3' },
      text: { linePattern: 'a', sampleIdPattern: 'b', qcPattern: 'c', fixedColumns: [{ code: 'X', start: 0, end: 4 }], sampleIdPath: 'line[0]' } as never,
    },
  },
};

const clean = (o: unknown) => JSON.parse(JSON.stringify(o));

describe('instrument config — every save round-trips the stored protocol', () => {
  for (const [name, cfg] of Object.entries(CASES)) {
    it(`${name}: config → form → config is unchanged`, () => {
      const dto = dtoOf(cfg);
      const form = formFromInstrument(dto);
      expect(form.protocol).toBe(cfg.parser.type);
      expect(clean(buildInstrumentConfig(form, cfg))).toEqual(clean(cfg));
    });

    it(`${name}: a Code-mapping-step save (untouched form + saved config base) sends the same config`, () => {
      const dto = dtoOf(cfg);
      // Editor: applyDto → configBase = dto.config, form = formFromInstrument(dto); mapping edits never touch the form.
      const body = buildUpsert(formFromInstrument(dto), dto.config, null);
      expect(clean(body.config)).toEqual(clean(cfg));
      // …and a second save after the server echoes it back is stable too.
      const again = buildUpsert(formFromInstrument(dtoOf(body.config)), body.config, null);
      expect(clean(again.config)).toEqual(clean(cfg));
    });
  }

  it('edited fields still win over the stored config', () => {
    const cfg = CASES['lifedx-hbpro over stx-etx (fields, id window, layout, path, decimals)'];
    const f = formFromInstrument(dtoOf(cfg));
    f.hbpro.fields = 'HbA1c 63 69 %\nHbX 80 86';
    const out = buildInstrumentConfig(f, cfg);
    const h = out.parser.hbpro as unknown as { fields: Record<string, unknown>[]; sampleIdStart: number; layout: string };
    expect(h.fields).toEqual([{ code: 'HbA1c', start: 63, end: 69, unit: '%', decimals: 1 }, { code: 'HbX', start: 80, end: 86, unit: null }]);
    expect(h.sampleIdStart).toBe(4);
    f.sampleIdPath = null;
    expect((buildInstrumentConfig(f, cfg).parser.hbpro as { sampleIdPath?: string }).sampleIdPath).toBeUndefined();
  });

  it('a stored protocol this screen does not know survives a save (form shows auto); choosing one replaces it', () => {
    const cfg = {
      transport: TCP, link: { type: 'future-link', ...LINK_T, x: 1 },
      parser: { type: 'future-parser', future: { a: 1 } },
    } as unknown as InstrumentConfig;
    const f = formFromInstrument(dtoOf(cfg));
    expect(f.protocol).toBe('auto');
    expect(clean(buildUpsert(f, cfg, null).config)).toEqual(clean(cfg));
    f.protocol = 'hl7';
    const out = buildInstrumentConfig(f, cfg);
    expect(out.parser.type).toBe('hl7');
    expect(out.link.type).toBe('mllp');
  });

  it('a config handed back as a JSON string, or a parser with no type, still reads as the preset', () => {
    const cfg = CASES['sinocare-fhir over sinocare-sn (replyMode, ack, sampleIdField, path, extras)'];
    expect(formFromInstrument(dtoOf(JSON.stringify(cfg))).protocol).toBe('sinocare-fhir');
    const noType = { ...cfg, parser: { ...cfg.parser, type: undefined } };
    expect(formFromInstrument(dtoOf(noType)).protocol).toBe('sinocare-fhir');
    expect(clean(buildInstrumentConfig(formFromInstrument(dtoOf(JSON.stringify(cfg))), JSON.stringify(cfg) as never))).toEqual(clean(cfg));
  });
});
