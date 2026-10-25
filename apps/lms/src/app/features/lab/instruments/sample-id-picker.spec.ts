import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformService } from '../../../core/services/platform.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import type { InstrumentDto } from '../../../shared/instruments/instrument.models';
import type { SampleIdFormat } from '../../../shared/instruments/sample-id-path';
import { FX_INSTRUMENTS } from '../../../shared/bridges/testing/bridge-fixtures';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { InstrumentEditorComponent } from './instrument-editor.component';
import { SampleIdPickerComponent } from './sample-id-picker.component';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const MEDONIC = ['MSH|^~\\&|Medonic|Lab|||20261024182301||ORU^R01|1|P|2.3.1', 'PID|1||||^261000013',
  'OBR|1||26703|01001^Automated Count^99MRC||20261024182150', 'OBX|1|NM|6690-2^WBC^LN||8.26|10*3/uL|||||F'].join('\r');
const HBPRO = 'S04----19MS TEST PATNT  29 F0329';

function renderPicker(raw: string | null, format: SampleIdFormat, path = '') {
  TestBed.configureTestingModule({ imports: [SampleIdPickerComponent] });
  const f = TestBed.createComponent(SampleIdPickerComponent);
  const picked: string[] = [];
  f.componentRef.setInput('raw', raw);
  f.componentRef.setInput('format', format);
  f.componentRef.setInput('path', path);
  f.componentInstance.pathChange.subscribe((p) => { picked.push(p); f.componentRef.setInput('path', p); });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, picked, text: () => (el.textContent ?? '').replace(/\s+/g, ' ') };
}

describe('Sample number picker', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('no message yet → plain-words empty state', () => {
    const p = renderPicker(null, 'hl7');
    expect(p.el.querySelector('[data-testid=sip-empty]')!.textContent).toContain('Send one result from the analyzer first, then pick the sample number here.');
  });

  it('HL7: tap the value → PID.5.2 picked, live preview shows the number', () => {
    const p = renderPicker(MEDONIC, 'hl7');
    expect(p.text()).toContain('Tap the sample number in the message below.');
    const cell = p.el.querySelector<HTMLButtonElement>('button[aria-label="PID.5.2 261000013"]')!;
    cell.click(); p.f.detectChanges();
    expect(p.picked).toEqual(['PID.5.2']);
    expect(p.text()).toContain('Sample number will be read from PID-5.2 → 261000013');
    expect(cell.getAttribute('aria-pressed')).toBe('true');
  });

  it('a saved path that reads nothing says the standard setting is used', () => {
    const p = renderPicker(MEDONIC, 'hl7', 'PV1.19');
    expect(p.text()).toContain('Nothing at PV1-19 in this message — the standard setting is used instead.');
  });

  it('HBPro: two taps select a character range', () => {
    const p = renderPicker(HBPRO, 'hbpro');
    const ch = (i: number) => p.el.querySelector<HTMLButtonElement>(`button[aria-label^="Line 1, character ${i}:"]`)!;
    ch(7).click(); p.f.detectChanges();
    expect(p.text()).toContain('Now tap the last character');
    ch(8).click(); p.f.detectChanges();
    expect(p.picked).toEqual(['7-9']);
    expect(p.text()).toContain('Sample number will be read from characters 7–8 → 19');
  });

  it('Clear emits an empty path', () => {
    const p = renderPicker(MEDONIC, 'hl7', 'OBR.3');
    [...p.el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Clear')!.click();
    expect(p.picked).toEqual(['']);
  });
});

describe('Instrument editor — Custom sample number', () => {
  afterEach(() => TestBed.resetTestingModule());
  const hl7Dto: InstrumentDto = { ...FX_INSTRUMENTS[0], bridgeId: null, bridgeName: null };

  function render(dto: InstrumentDto, messages: { items: unknown[] } = { items: [] }) {
    return renderBandPage(InstrumentEditorComponent, {
      getFor: (u) => {
        if (u === `/api/instruments/${dto.id}`) return dto;
        if (u === '/api/instruments/messages/m1') return { id: 'm1', raw: MEDONIC };
        if (u.startsWith('/api/instruments/messages')) return { total: messages.items.length, page: 1, pageSize: 20, ...messages };
        return [];
      },
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: dto.id }) } } },
        { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => false } },
        { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
      ],
    });
  }

  it('Custom with no message on the server → the empty state', async () => {
    const p = render(hl7Dto);
    await flush();
    p.cmp.go('protocol');
    p.cmp.setSampleIdMode('custom');
    await flush(); p.f.detectChanges();
    expect(p.el.textContent).toContain('Send one result from the analyzer first');
  });

  it('Custom → last server message shown, pick PID-5.2, Save stores parser.hl7.sampleIdPath', async () => {
    const p = render(hl7Dto, { items: [{ id: 'm1', instrumentId: hl7Dto.id, sampleId: '26703', receivedAt: '2026-10-24T12:00:00Z', state: 'unmatched', protocol: 'hl7' }] });
    await flush();
    p.cmp.go('protocol');
    p.cmp.setSampleIdMode('custom');
    await flush(); p.f.detectChanges();
    const cell = p.el.querySelector<HTMLButtonElement>('button[aria-label="PID.5.2 261000013"]')!;
    expect(cell).toBeTruthy();
    cell.click(); p.f.detectChanges();
    expect(p.el.textContent).toContain('Sample number will be read from PID-5.2');
    expect(p.el.textContent).toContain('261000013');
    p.api.put.mockImplementation((() => of(hl7Dto)) as never);
    await p.cmp.save();
    const body = (p.api.put.mock.calls[0] as unknown[])[1] as { config: { parser: { hl7: unknown } } };
    expect(body.config.parser.hl7).toEqual({ sampleIdField: 'OBR-3', sampleIdPath: 'PID.5.2' });
  });

  it('standard instrument: Save sends the parser exactly as before (no sampleIdPath)', async () => {
    const p = render(hl7Dto);
    await flush();
    p.api.put.mockImplementation((() => of(hl7Dto)) as never);
    await p.cmp.save();
    const body = (p.api.put.mock.calls[0] as unknown[])[1] as { config: { parser: { hl7: unknown } } };
    expect(JSON.stringify(body.config.parser)).not.toContain('sampleIdPath');
    expect(body.config.parser.hl7).toEqual({ sampleIdField: 'OBR-3' });
  });
});
