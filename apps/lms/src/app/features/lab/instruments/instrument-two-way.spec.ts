import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ApiError } from '../../../shared/models/api-response.model';
import type { Test } from '../../../shared/models/test.model';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import type { InstrumentDto } from '../../../shared/instruments/instrument.models';
import { DeviceOrdersDto, TwoWayForm, emptyTwoWayForm } from '../../../shared/instruments/instrument-two-way';
import { FX_INSTRUMENTS } from '../../../shared/bridges/testing/bridge-fixtures';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { InstrumentEditorComponent } from './instrument-editor.component';
import { InstrumentTwoWayComponent } from './instrument-two-way.component';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

const TESTS = [
  { id: 't1', name: 'Complete Blood Count', catalogKey: 'HEM001', type: 'profile', testCode: 'CBC' },
  { id: 't2', name: 'Glucose, fasting', catalogKey: 'BIO010', type: 'individual', testCode: 'GLU' },
] as unknown as Test[];

const FOUND: DeviceOrdersDto = {
  sampleId: '26329', found: true, priority: 'urgent', collectedAt: null, specimen: 'Whole blood',
  patient: { id: 'AA0007', name: 'Paravai Munusamy', sex: 'F', dob: null, ageYears: 44 },
  tests: [{ code: 'CBC', testCatalogKey: 'HEM001', name: 'Complete Blood Count' }],
  unmapped: [{ testCatalogKey: 'BIO010', name: 'Glucose, fasting' }],
};

/** The section alone, its value held like the editor holds it. */
function renderSection(opts: { value?: Partial<TwoWayForm>; protocol?: 'auto' | 'astm' | 'hl7' | 'text'; id?: string | null; get?: () => unknown } = {}) {
  const api = { get: vi.fn(opts.get ?? (() => of(FOUND))), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  TestBed.configureTestingModule({ imports: [InstrumentTwoWayComponent], providers: [{ provide: ApiService, useValue: api }] });
  const f = TestBed.createComponent(InstrumentTwoWayComponent);
  let value: TwoWayForm = { ...emptyTwoWayForm(), ...(opts.value ?? {}) };
  f.componentRef.setInput('value', value);
  f.componentRef.setInput('protocol', opts.protocol ?? 'auto');
  f.componentRef.setInput('instrumentId', opts.id === undefined ? 'inst-1' : opts.id);
  f.componentRef.setInput('tests', TESTS);
  f.componentInstance.valueChange.subscribe((v) => { value = v; f.componentRef.setInput('value', v); });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const text = () => el.textContent ?? '';
  const modeBtn = (m: string) => el.querySelector<HTMLButtonElement>(`[role=radio][data-mode="${m}"]`)!;
  const click = (b: Element | null) => { (b as HTMLElement).click(); f.detectChanges(); };
  return { f, el, api, cmp: f.componentInstance, text, modeBtn, click, value: () => value };
}

describe('Two-way section — show / hide', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Off: the four modes + note, order codes + barcode test; no patient / HL7 / worklist settings', () => {
    const p = renderSection();
    expect(p.el.querySelectorAll('[role=radio]').length).toBe(4);
    expect(p.modeBtn('off').getAttribute('aria-checked')).toBe('true');
    expect(p.text()).toContain('The tube still has to be loaded on the analyzer');
    expect(p.text()).toContain('The analyzer reads the tube barcode and asks Prefrontal which tests to run.');
    expect(p.el.querySelector('[role=switch]')).toBeNull();
    expect(p.text()).not.toContain('HL7 messages');
    expect(p.text()).not.toContain('Check for new samples every');
    expect(p.text()).toContain('Order codes');
    expect(p.text()).toContain('Test a barcode');
  });

  it('Analyzer asks: patient switch (off), HL7 answer style, order codes, barcode test — no worklist timing', () => {
    const p = renderSection();
    p.click(p.modeBtn('query'));
    expect(p.value().mode).toBe('query');
    expect(p.el.querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('false');
    expect(p.text()).toContain('How to answer a barcode question');
    expect(p.text()).not.toContain('Worklist message');
    expect(p.text()).not.toContain('Check for new samples every');
    expect(p.text()).toContain('Order codes');
    expect(p.text()).toContain('Test a barcode');
  });

  it('Send worklist: window + check-every and the worklist message; Both shows both HL7 choices', () => {
    const p = renderSection({ value: { mode: 'worklist' } });
    expect(p.text()).toContain('Send samples collected in the last');
    expect(p.text()).toContain('Check for new samples every');
    expect(p.text()).toContain('Worklist message');
    expect(p.text()).not.toContain('How to answer a barcode question');
    p.click(p.modeBtn('both'));
    expect(p.text()).toContain('Worklist message');
    expect(p.text()).toContain('How to answer a barcode question');
  });

  it('HL7 choices hidden when the protocol is ASTM or text', () => {
    const p = renderSection({ value: { mode: 'both' }, protocol: 'astm' });
    expect(p.text()).not.toContain('HL7 messages');
    expect(p.text()).toContain('Check for new samples every');
  });

  it('arrow keys move the mode like a radio group', () => {
    const p = renderSection();
    p.modeBtn('off').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    p.f.detectChanges();
    expect(p.value().mode).toBe('query');
  });

  it('patient switch toggles sendPatient', () => {
    const p = renderSection({ value: { mode: 'query' } });
    p.click(p.el.querySelector('[role=switch]'));
    expect(p.value().sendPatient).toBe(true);
  });
});

describe('Two-way section — validation messages', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('worklist numbers outside the contract ranges are flagged', () => {
    const p = renderSection({ value: { mode: 'worklist' } });
    const [hours, secs] = Array.from(p.el.querySelectorAll<HTMLInputElement>('.pf-tw-unit input'));
    hours.value = '200'; hours.dispatchEvent(new Event('input')); p.f.detectChanges();
    secs.value = '5'; secs.dispatchEvent(new Event('input')); p.f.detectChanges();
    expect(p.value().worklistWindowHours).toBe(200);
    expect(p.text()).toContain('Hours must be a whole number from 1 to 168');
    expect(p.text()).toContain('Seconds must be a whole number from 15 to 3600');
  });

  it('an order code with a delimiter is flagged on its row', () => {
    const p = renderSection({ value: { mode: 'query', orderCodes: [{ testCatalogKey: 'HEM001', code: 'CB|C' }] } });
    expect(p.text()).toContain('A code can’t contain | ^ ~ \\ or &');
    expect(p.el.querySelector('.pf-tw-code--err')).not.toBeNull();
  });

  it('Add order code adds a blank row; remove drops it', () => {
    const p = renderSection({ value: { mode: 'query' } });
    const add = Array.from(p.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Add order code'))!;
    p.click(add);
    expect(p.value().orderCodes).toEqual([{ testCatalogKey: '', code: '' }]);
    p.click(p.el.querySelector('.pf-tw-code__rm'));
    expect(p.value().orderCodes).toEqual([]);
  });
});

describe('Two-way section — "Test a barcode"', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function check(p: ReturnType<typeof renderSection>, code = '26329') {
    const input = p.el.querySelector<HTMLInputElement>('.pf-tw-try input')!;
    input.value = code; input.dispatchEvent(new Event('input')); p.f.detectChanges();
    p.el.querySelector<HTMLFormElement>('.pf-tw-try')!.dispatchEvent(new Event('submit'));
    await flush(); p.f.detectChanges();
  }

  it('a new instrument can’t be tested yet', () => {
    const p = renderSection({ value: { mode: 'query' }, id: null });
    expect(p.text()).toContain('Create the instrument first');
    expect(p.el.querySelector('.pf-tw-try')).toBeNull();
  });

  it('found: calls the preview endpoint; tests + codes, unmapped with the hint, no patient line while details are off', async () => {
    const p = renderSection({ value: { mode: 'query' } });
    await check(p);
    expect(p.api.get).toHaveBeenCalledWith('/api/instruments/inst-1/orders-preview?sampleId=26329');
    const res = p.el.querySelector('[data-state=found]')!;
    expect(res.textContent).toContain('Sample 26329 found');
    expect(res.textContent).toContain('Urgent · Whole blood');
    expect(res.textContent).toContain('The analyzer would be asked to run 1 test');
    expect(res.querySelector('.pf-tw-res__code')!.textContent).toBe('CBC');
    expect(res.textContent).toContain('Not sent — no code for this analyzer');
    expect(res.textContent).toContain('Glucose, fasting');
    expect(res.textContent).toContain('Map these in Code mapping');
    expect(res.textContent).not.toContain('Paravai');
  });

  it('patient line only when patient details are on', async () => {
    const p = renderSection({ value: { mode: 'query', sendPatient: true } });
    await check(p);
    expect(p.text()).toContain('Paravai Munusamy · Female · 44 y · ID AA0007');
  });

  it('"Add order codes for these" turns unmapped tests into order-code rows', async () => {
    const p = renderSection({ value: { mode: 'query' } });
    await check(p);
    const btn = Array.from(p.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Add order codes for these'))!;
    p.click(btn);
    expect(p.value().orderCodes).toEqual([{ testCatalogKey: 'BIO010', code: '' }]);
  });

  it('not found: plain "No order for …" state', async () => {
    const p = renderSection({ value: { mode: 'query' }, get: () => of({ sampleId: '999', found: false, tests: [], unmapped: [] }) });
    await check(p, '999');
    const res = p.el.querySelector('[data-state=not-found]')!;
    expect(res.textContent).toContain('No order for 999');
    expect(res.textContent).toContain('nothing to run');
  });

  it('Off: the preview still runs, with the "Two-way is off" note above the result', async () => {
    const p = renderSection();
    await check(p);
    expect(p.api.get).toHaveBeenCalledWith('/api/instruments/inst-1/orders-preview?sampleId=26329');
    expect(p.el.querySelector('.pf-tw__offnote')!.textContent).toContain('Two-way is off — this is what the analyzer would be told once you switch it on.');
    expect(p.el.querySelector('[data-state=found]')).not.toBeNull();
  });

  it('a mode is on → no "Two-way is off" note', async () => {
    const p = renderSection({ value: { mode: 'query' } });
    await check(p);
    expect(p.el.querySelector('.pf-tw__offnote')).toBeNull();
  });

  it('a server error on the preview → the server message, shown plainly', async () => {
    const p = renderSection({ value: { mode: 'query' }, get: () => throwError(() => new ApiError('Could not read that order.', 'validation')) });
    await check(p);
    expect(p.el.querySelector('[role=alert]')!.textContent).toContain('Could not read that order.');
  });
});

describe('Instrument editor — Two-way step', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(dto: InstrumentDto) {
    return renderBandPage(InstrumentEditorComponent, {
      getFor: (u) => {
        if (u === `/api/instruments/${dto.id}`) return dto;
        if (u.startsWith('/api/instruments/messages')) return { items: [], total: 0, page: 1, pageSize: 20 };
        return [];
      },
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: dto.id }) } } },
        { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => false } },
        { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
      ],
    });
  }
  const old = FX_INSTRUMENTS[2];

  it('has a "Two-way" step after Code mapping; an old instrument loads as Off', async () => {
    const p = render(old);
    await flush();
    expect(p.cmp.tabs().map((t: { label: string }) => t.label)).toEqual(['Status', 'Basics', 'Connection', 'Protocol', 'Listen', 'Code mapping', 'Two-way', 'Device']);
    p.cmp.go('twoway'); p.f.detectChanges();
    expect(p.el.textContent).toContain('Two-way with the analyzer');
    expect(p.el.querySelector('[role=radio][data-mode="off"]')!.getAttribute('aria-checked')).toBe('true');
    expect(p.el.textContent).toContain('Two-way');
  });

  it('saving an old instrument without touching the section sends NO bidirectional block', async () => {
    const p = render(old);
    await flush();
    p.api.put.mockImplementation((() => of(old)) as never);
    await p.cmp.save();
    const body = (p.api.put.mock.calls[0] as unknown[])[1] as { config: Record<string, unknown> };
    expect('bidirectional' in body.config).toBe(false);
  });

  it('choosing a mode is saved in config.bidirectional', async () => {
    const p = render(old);
    await flush();
    p.cmp.go('twoway'); p.f.detectChanges();
    (p.el.querySelector('[role=radio][data-mode="query"]') as HTMLElement).click(); p.f.detectChanges();
    expect(p.cmp.dirty()).toBe(true);
    p.api.put.mockImplementation((() => of(old)) as never);
    await p.cmp.save();
    const body = (p.api.put.mock.calls[0] as unknown[])[1] as { config: Record<string, unknown> };
    expect(body.config['bidirectional']).toMatchObject({ mode: 'query', sendPatient: false, orderCodes: {} });
  });

  it('an invalid two-way setting blocks Save and opens the Two-way step', async () => {
    const p = render(old);
    await flush();
    p.cmp.patchTwoWay({ ...emptyTwoWayForm(), mode: 'worklist', worklistWindowHours: 0 });
    p.cmp.go('basics');
    await p.cmp.save();
    expect(p.api.put).not.toHaveBeenCalled();
    expect(p.cmp.tab()).toBe('twoway');
    expect(p.toasts.error).toHaveBeenCalledWith('Hours must be a whole number from 1 to 168');
  });
});
