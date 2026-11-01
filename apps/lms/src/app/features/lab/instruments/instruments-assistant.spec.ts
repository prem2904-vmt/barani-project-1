import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { BetaFeaturesService } from '../../../core/services/beta-features.service';
import { SENSE_ON } from '../../../core/services/pf-sense.testing';
import { PlatformService } from '../../../core/services/platform.service';
import { DialogService } from '../../../core/services/dialog.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import { AssistantApiService } from '../../../shared/assistant/assistant-api.service';
import { MAP_PREFILL_STATE_KEY, MappingPrefill } from '../../../shared/assistant/assistant.models';
import type { InstrumentDto } from '../../../shared/instruments/instrument.models';
import { buildInstrumentConfig, emptyInstrumentForm } from '../../../shared/instruments/instrument-config';
import { InstrumentsListComponent } from './instruments-list.component';
import { InstrumentEditorComponent } from './instrument-editor.component';
import { ConnectWizardComponent } from './connect-wizard/connect-wizard.component';

/**
 * Instruments assistant (BETA) on the three instrument screens: the band's
 * sparkle only with the beta on; "Add to mapping" opens the EXISTING Code
 * mapping with the row prefilled — and never saves it.
 */
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function instrument(extra: Partial<InstrumentDto> = {}): InstrumentDto {
  const f = emptyInstrumentForm();
  f.tcpServer.port = 5599;
  return {
    id: 'i1', name: 'Snibe Maglumi', make: 'Snibe', model: 'X3', serialNumber: 'S1', transport: 'tcp-server',
    config: buildInstrumentConfig({ ...f, transport: 'tcp-server' }), isActive: true, status: 'offline', lastSeenAt: null,
    hasDeviceKey: false, unmatchedCount: 1, ...extra,
  } as InstrumentDto;
}

const TESTS = [{ id: 't1', name: 'Fasting Blood Sugar', testCode: 'BIO010', catalogKey: 'MW-FBS', type: 'individual', unit: 'mg/dL' }];
const GLU: MappingPrefill = { instrumentId: 'i1', analyzerCode: 'GLU', unit: 'mg/dL', testId: 't1', testCode: 'BIO010', testName: 'Fasting Blood Sugar' };

const beta = (on: boolean) => ({ provide: BetaFeaturesService, useValue: { enabled: (k: string) => on && k === 'assistant', ensureLoaded: async () => undefined } });
const assistantApi = { provide: AssistantApiService, useValue: { providers: () => of([{ id: 'gemini', label: 'Gemini', available: true }]), chat: vi.fn() } };
const senseOn = SENSE_ON;
const sparkle = (el: HTMLElement) => el.querySelector('pf-hero-band .pf-hb__actions pf-assistant-button button');

describe('Instruments assistant — band button (beta gate)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('instruments list: no sparkle with the beta off; on → it opens the panel', async () => {
    let p = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? [instrument()] : []), providers: [senseOn, beta(false), assistantApi] });
    await flush(); p.f.detectChanges();
    expect(sparkle(p.el)).toBeNull();
    TestBed.resetTestingModule();

    p = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? [instrument()] : []), providers: [senseOn, beta(true), assistantApi] });
    await flush(); p.f.detectChanges();
    const b = sparkle(p.el) as HTMLButtonElement;
    expect(b).not.toBeNull();
    b.click(); p.f.detectChanges(); await flush(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-asst')).not.toBeNull();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    // the list offers the instruments to ask about
    expect(p.cmp.assistantContext().instruments).toEqual([{ id: 'i1', name: 'Snibe Maglumi' }]);
  });

  it('instruments list: "Add to mapping" opens that instrument with the row in navigation state (not the URL)', async () => {
    const p = renderBandPage(InstrumentsListComponent, { getFor: () => [], providers: [senseOn, beta(true), assistantApi] });
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    p.cmp.onAssistantMapping(GLU);
    expect(nav).toHaveBeenCalledWith(['/admin/instruments', 'i1'], { state: { [MAP_PREFILL_STATE_KEY]: GLU } });
    nav.mockClear();
    p.cmp.onAssistantMapping({ ...GLU, instrumentId: null });
    expect(nav).not.toHaveBeenCalled();
  });

  it('connect wizard: sparkle with the beta on; mapping waits for Create, then asks before leaving', async () => {
    const dialog = { confirm: vi.fn(async () => true), prompt: vi.fn() };
    const p = renderBandPage(ConnectWizardComponent, { providers: [senseOn, beta(true), assistantApi, { provide: DialogService, useValue: dialog },
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => false } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined }] });
    await flush(); p.f.detectChanges();
    expect(sparkle(p.el)).not.toBeNull();
    expect(p.cmp.assistantContext()).toMatchObject({ instrumentId: null, canAddMapping: false });
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await p.cmp.onAssistantMapping(GLU);
    expect(dialog.confirm).not.toHaveBeenCalled();
    p.cmp.created.set(instrument({ id: 'i9', name: 'Snibe' }));
    expect(p.cmp.assistantContext()).toMatchObject({ instrumentId: 'i9', canAddMapping: true, subject: 'Snibe' });
    await p.cmp.onAssistantMapping(GLU);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(['/admin/instruments', 'i9'], { state: { [MAP_PREFILL_STATE_KEY]: { ...GLU, instrumentId: 'i9' } } });
  });
});

describe('Instrument editor — mapping prefill hand-off', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

  function render(on = true) {
    const dto = instrument();
    return renderBandPage(InstrumentEditorComponent, {
      getFor: (u) => {
        if (u === `/api/instruments/${dto.id}`) return dto;
        if (u.endsWith('/code-maps')) return [{ analyzerCode: 'WBC', testCatalogKey: 'MW-WBC', testName: 'WBC', factor: 1, offset: 0, unit: '' }];
        if (u.endsWith('/image-maps')) return [];
        if (u.startsWith('/api/tests')) return TESTS;
        if (u.startsWith('/api/instruments/messages')) return { items: [], total: 0, page: 1, pageSize: 20 };
        return [];
      },
      providers: [
        // The band's sparkle (pf-assistant-button) also reads PfSenseService.shown(): stub it like the list / wizard tests do,
        // or the real service's status fetch races the six flush ticks and the sparkle is sometimes not there yet (flaky).
        senseOn, beta(on), assistantApi,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'i1' }) } } },
        { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => false } },
        { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
      ],
    });
  }
  const savedCodeMaps = (p: ReturnType<typeof render>) =>
    (p.api.put.mock.calls as unknown as [string][]).filter(([u]) => String(u).includes('code-maps')).length;

  it('editor band: sparkle only with the beta on', async () => {
    let p = render(false);
    await flush(); p.f.detectChanges();
    expect(sparkle(p.el)).toBeNull();
    TestBed.resetTestingModule();
    p = render(true);
    await flush(); p.f.detectChanges();
    expect(sparkle(p.el)).not.toBeNull();
  });

  it('the panel’s Add to mapping → Code mapping tab, the row prefilled + marked, unsaved — never saved for them', async () => {
    const p = render();
    await flush(); p.f.detectChanges();
    expect(p.cmp.tab()).toBe('status');
    p.cmp.onAssistantMapping(GLU);
    p.f.detectChanges();
    expect(p.cmp.tab()).toBe('mapping');
    expect(p.cmp.maps().map((r: { analyzerCode: string; testCatalogKey: string }) => [r.analyzerCode, r.testCatalogKey]))
      .toEqual([['WBC', 'MW-WBC'], ['GLU', 'MW-FBS']]);
    expect(p.cmp.mapsDirty()).toBe(true);
    const rows = p.el.querySelectorAll('.pf-ie-maps tbody tr:not(.pf-ie-row-msg)');
    expect(rows[1].classList.contains('pf-ie-row--prefill')).toBe(true);
    expect((rows[1].querySelector('input') as HTMLInputElement).value).toBe('GLU');
    expect(p.el.querySelector('.pf-savestate')).not.toBeNull();
    expect(p.toasts.success).toHaveBeenCalledWith('GLU added to Code mapping — check it, then Save');
    expect(savedCodeMaps(p)).toBe(0);
    expect(p.api.post).not.toHaveBeenCalled();
  });

  it('arriving from the list / wizard: the navigation state prefills once the maps + tests are loaded', async () => {
    vi.spyOn(Router.prototype, 'getCurrentNavigation').mockReturnValue({ extras: { state: { [MAP_PREFILL_STATE_KEY]: GLU } } } as never);
    const p = render();
    await flush(); p.f.detectChanges();
    expect(p.cmp.tab()).toBe('mapping');
    expect(p.cmp.maps().some((r: { analyzerCode: string; testCatalogKey: string }) => r.analyzerCode === 'GLU' && r.testCatalogKey === 'MW-FBS')).toBe(true);
    expect(savedCodeMaps(p)).toBe(0);
  });

  it('the mapPrefill input does the same; another instrument’s row is ignored', async () => {
    const p = render();
    await flush(); p.f.detectChanges();
    p.f.componentRef.setInput('mapPrefill', { ...GLU, instrumentId: 'other' });
    p.f.detectChanges(); await flush();
    expect(p.cmp.maps()).toHaveLength(1);
    p.f.componentRef.setInput('mapPrefill', GLU);
    p.f.detectChanges(); await flush();
    expect(p.cmp.maps()).toHaveLength(2);
    expect(p.cmp.tab()).toBe('mapping');
  });
});
