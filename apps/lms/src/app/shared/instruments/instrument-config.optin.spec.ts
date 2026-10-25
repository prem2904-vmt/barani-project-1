import { describe, expect, it } from 'vitest';
import type { InstrumentDto } from './instrument.models';
import {
  DEFAULT_SINOCARE_ACK_JSON, PROTOCOL_OPTIONS, applyDetectProposal, badHbproLines, buildInstrumentConfig, emptyInstrumentForm,
  formFromInstrument, linkForProtocol, parseHbproFields, validateInstrumentForm,
} from './instrument-config';

/** LifeDx HBPro + Sinocare iCARE presets (desktop connector, 2026-10-24). */
describe('instrument config — opt-in analyzer presets', () => {
  it('plain labels, and each preset carries its own link', () => {
    expect(PROTOCOL_OPTIONS.find((o) => o.value === 'lifedx-hbpro')?.label).toBe('LifeDx HBPro (STX/ETX text)');
    expect(PROTOCOL_OPTIONS.find((o) => o.value === 'sinocare-fhir')?.label).toBe('Sinocare iCARE (SN frames)');
    expect(linkForProtocol('lifedx-hbpro')).toBe('stx-etx');
    expect(linkForProtocol('sinocare-fhir')).toBe('sinocare-sn');
  });

  it('HBPro: position lines → parser.hbpro.fields; bad lines flagged', () => {
    const f = emptyInstrumentForm();
    f.name = 'HBPro'; f.transport = 'tcp-server'; f.protocol = 'lifedx-hbpro';
    f.hbpro.fields = '# code start end unit\nHbA1c 63 69 %\nHbF 69 75';
    const cfg = buildInstrumentConfig(f);
    expect(cfg.link.type).toBe('stx-etx');
    expect(cfg.parser.hbpro).toEqual({ fields: [{ code: 'HbA1c', start: 63, end: 69, unit: '%' }, { code: 'HbF', start: 69, end: 75, unit: null }] });
    expect(cfg.parser.sinocare).toBeUndefined();
    expect(parseHbproFields('x 5 3')).toEqual([]);
    expect(badHbproLines('HbA1c 63 69 %\nnope\nx 5 3')).toEqual(['nope', 'x 5 3']);
    f.hbpro.fields = 'nope';
    expect(validateInstrumentForm(f).some((i) => i.field === 'hbpro.fields')).toBe(true);
    // round trip
    const back = formFromInstrument({ name: 'HBPro', make: null, model: null, serialNumber: null, isActive: true, transport: 'tcp-server', config: cfg } as unknown as InstrumentDto);
    expect(back.protocol).toBe('lifedx-hbpro');
    expect(back.hbpro.fields).toBe('HbA1c 63 69 %\nHbF 69 75');
  });

  it('Sinocare: replyMode + ack JSON on the link, sample-ID field on the parser; invalid reply JSON flagged', () => {
    const f = emptyInstrumentForm();
    f.name = 'iCARE'; f.transport = 'tcp-server'; f.protocol = 'sinocare-fhir';
    let cfg = buildInstrumentConfig(f);
    expect(cfg.link).toMatchObject({ type: 'sinocare-sn', replyMode: 'none', ackJson: DEFAULT_SINOCARE_ACK_JSON });
    expect(cfg.parser.sinocare).toEqual({ sampleIdField: 'medicalRecordNo' });
    f.sinocare = { replyMode: 'echo', ackJson: '{"code":0}', sampleIdField: 'position' };
    cfg = buildInstrumentConfig(f);
    expect(cfg.link).toMatchObject({ replyMode: 'echo', ackJson: '{"code":0}' });
    expect(cfg.parser.sinocare).toEqual({ sampleIdField: 'position' });
    const back = formFromInstrument({ name: 'iCARE', make: null, model: null, serialNumber: null, isActive: true, transport: 'tcp-server', config: cfg } as unknown as InstrumentDto);
    expect(back.sinocare).toEqual({ replyMode: 'echo', ackJson: '{"code":0}', sampleIdField: 'position' });
    f.sinocare.ackJson = '{oops';
    expect(validateInstrumentForm(f).some((i) => i.field === 'sinocare.ackJson')).toBe(true);
  });

  it('an existing ASTM / text instrument builds exactly as before (no preset keys)', () => {
    for (const p of ['astm', 'hl7', 'text', 'auto'] as const) {
      const f = emptyInstrumentForm(); f.name = 'x'; f.protocol = p;
      const cfg = buildInstrumentConfig(f);
      expect(Object.keys(cfg.parser).sort()).toEqual(['astm', 'hl7', 'text', 'type']);
      expect(cfg.link['replyMode']).toBeUndefined();
    }
  });

  it('"Use this" on a Sinocare detection lands on the preset', () => {
    const { form, link } = applyDetectProposal(emptyInstrumentForm(), {
      protocol: 'sinocare-fhir', link: 'sinocare-sn', confidence: 0.85, reasons: [],
      proposed: { link: { type: 'sinocare-sn', replyMode: 'none' }, parser: { type: 'sinocare-fhir', sinocare: { sampleIdField: 'medicalRecordNo' } } },
    });
    expect(form.protocol).toBe('sinocare-fhir');
    expect(link?.type).toBe('sinocare-sn');
  });
});
