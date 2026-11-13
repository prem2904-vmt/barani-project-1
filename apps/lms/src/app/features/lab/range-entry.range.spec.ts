import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { ResultEntryComponent } from './result-entry/result-entry.component';
import { SampleResultEntryComponent } from './sample-result-entry/sample-result-entry.component';
import { invalidNumbers } from './sample-result-entry/submit-all';
import { ApiService } from '../../core/services/api.service';
import { ScanService } from '../../core/services/scan.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { PlatformService } from '../../core/services/platform.service';
import { DraftShelfService } from '../../core/services/draft-shelf.service';
import { AuthService } from '../../core/auth/auth.service';
import { NumpadService } from '../../shared/components/numpad/numpad.service';

/**
 * Range results on a value the Test Master switched to "Allow a range or
 * < / >" (owner 2026-10-24): the desktop grid field becomes text, keys /
 * numpad / paste accept "0-4", "<5", ">100", the live flag follows the rule,
 * submit goes through, Submit all agrees, and a calc reads a range as NO
 * number (never the next parameter's). The sibling value without the switch
 * keeps today's behaviour (pinned in range-entry.untouched.spec.ts).
 */
const PLAIN = JSON.stringify({
  parameters: [
    { id: 'p-pus', name: 'pus', title: 'Pus cells', type: 'numeric', unit: '/HPF', criticalHigh: 50,
      allowRange: true, rangeFlag: 'ends', referenceRanges: [{ min: 2, max: 5 }] },
    { id: 'p-epi', name: 'epi', title: 'Epithelial cells', type: 'numeric', unit: '/HPF', criticalHigh: 50,
      referenceRanges: [{ min: 2, max: 5 }] },
  ],
});
const VALUES = ['0-4', '4-6', '<5', '>100', '5', '6', '60', '1', ' 7 ', '-3', '4-', 'abc', '1e2', '6-4'];
const KEYS = ['0', '5', '.', '-', '–', '<', '>', '=', ' ', 'a', 'e', 'Backspace'];
const STARTS = ['', '1', '1.', '-', '0-4', '<'];

function common() {
  return [
    { provide: ScanService, useValue: { manualEntry: () => true } },
    { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn() } },
    { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
    { provide: TenantStateService, useValue: { tenant: signal({ name: 'Demo Lab' }), ensureLoaded() {} } },
    { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', registrationId: 'R1', tenantName: 'Demo Lab' }), hasPermission: () => true } },
  ];
}

function keyed(input: HTMLInputElement, start: string, key: string): string {
  input.value = start;
  try { input.setSelectionRange(start.length, start.length); } catch { /* number input */ }
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  return ev.defaultPrevented ? 'x' : 'ok';
}

function pasted(input: HTMLInputElement, text: string): string {
  input.value = '';
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  input.dispatchEvent(ev);
  return `${ev.defaultPrevented ? 'x' : 'ok'}:${input.value}`;
}

async function renderResultEntry(view: 'grid' | 'cards') {
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const ot = {
    id: 'ot1', subOrderId: 's1', testId: 't1', status: 'in_progress',
    subOrder: { barcode: '26123', order: { patient: { id: 'p1', displayName: 'Demo Patient', sex: 'M', age: 40 } } },
    test: { id: 't1', name: 'Urine', parameters: PLAIN },
  };
  const api = {
    get: vi.fn((url: string) => (url === '/api/results/ot1' ? of(ot) : of([]))),
    post: vi.fn(() => of({ flags: { critical: false } })), put: vi.fn(() => of({})), patch: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      ...common(),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'ot1' }), queryParamMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({ id: 'ot1' })), queryParamMap: of(convertToParamMap({})) } },
      { provide: Router, useValue: { url: '/lab/result/ot1', navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)), getCurrentNavigation: () => null } },
    ],
  });
  TestBed.inject(NumpadService).touch.set(false);
  try { localStorage.setItem('pf-result-view', view); } catch { /* no storage */ }
  const f = TestBed.createComponent(ResultEntryComponent);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await f.whenStable();
  (f.componentInstance as any).setViewMode(view);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, c: f.componentInstance as any, api, toasts, input: () => el.querySelector('input[data-param="pus"]') as HTMLInputElement };
}

async function renderSampleEntry() {
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const sample: any = {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-09-25T03:00:00Z', department: { id: 'd1', name: 'Clinical Pathology', code: 'CLP' },
    order: { id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-09-25T03:00:00Z', samples: [],
      patient: { id: 'p1', displayName: 'Demo Patient', age: 40, sex: 'Male', mrn: 'AA0001' } },
    siblings: [],
    tests: [{ id: 'ot1', subOrderId: 'smp-1', testId: 't1', name: 'Pus cells', status: 'in_progress',
      test: { id: 't1', name: 'Pus cells', testCode: 'PUS', parameters: JSON.stringify({ parameters: [
        { name: 'result', title: 'Pus cells', type: 'numeric', unit: '/HPF', criticalHigh: 50, allowRange: true, referenceRanges: [{ min: 2, max: 5 }] },
      ] }) } }],
  };
  const api = {
    get: vi.fn((url: string) => url.endsWith('/tests') ? of(sample) : url.includes('lab-trends') ? of({ tests: [] }) : of([])),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      ...common(),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      { provide: DraftShelfService, useValue: { drop: vi.fn() } },
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ sampleId: 'smp-1' })), queryParamMap: new BehaviorSubject(convertToParamMap({})), snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: { url: '/lab/sample/smp-1', navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) } },
    ],
  });
  TestBed.inject(NumpadService).touch.set(false);
  const f = TestBed.createComponent(SampleResultEntryComponent);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await f.whenStable();
  await new Promise(r => setTimeout(r, 0));
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, c: f.componentInstance as any, sample, toasts, input: () => el.querySelector('input[data-sre-field="ot1::result"]') as HTMLInputElement };
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  document.body.querySelectorAll('pf-result-entry, pf-sample-result-entry, pf-numpad-panel').forEach(n => n.remove());
  TestBed.resetTestingModule();
});


const typeIn = (input: HTMLInputElement, text: string): string => {
  input.value = '';
  for (const ch of text) {
    const ev = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    if (!ev.defaultPrevented) { input.value += ch; input.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  return input.value;
};

vi.setConfig({ testTimeout: 30_000 });   // component renders under a loaded full run

describe('range entry — per-test result entry', () => {
  it('grid: ONLY the switched value is a text field; the other stays type=number', async () => {
    const r = await renderResultEntry('grid');
    expect(r.input().type).toBe('text');
    expect(r.input().hasAttribute('data-range-entry')).toBe(true);
    const epi = r.el.querySelector('input[data-param="epi"]') as HTMLInputElement;
    expect(epi.type).toBe('number');
    expect(epi.hasAttribute('data-range-entry')).toBe(false);
  });

  it('keys accept "0-4", "<5", ">100", "<=5"; letters and a second < are refused', async () => {
    const r = await renderResultEntry('grid');
    expect(typeIn(r.input(), '0-4')).toBe('0-4');
    expect(typeIn(r.input(), '<5')).toBe('<5');
    expect(typeIn(r.input(), '>100')).toBe('>100');
    expect(typeIn(r.input(), '<=5')).toBe('<=5');
    expect(typeIn(r.input(), '1.5 - 2.5')).toBe('1.5 - 2.5');
    expect(typeIn(r.input(), '5<a')).toBe('5');
    expect(r.c.valueOf('pus')).toBe('5');
  });

  it('paste: a range lands as typed; junk still falls back to the numeric clean-up', async () => {
    const r = await renderResultEntry('cards');
    expect(pasted(r.input(), ' 0 - 4 ')).toBe('x:0 - 4');
    expect(r.c.valueOf('pus')).toBe('0 - 4');
    expect(pasted(r.input(), '12 mg/dL')).toBe('x:12');
  });

  it('live flag by the rule: "0-4" Normal, "4-6" High, ">100" critical; never invalid', async () => {
    const r = await renderResultEntry('grid');
    const p = r.c.parameters().find((x: any) => x.name === 'pus');
    const chip = (v: string) => { r.c.setValue('pus', v); const f = r.c.flagFor(p); return f ? `${f.tone}:${f.label}` : '-'; };
    expect(chip('2-4')).toBe('normal:Normal');
    expect(chip('0-4')).toBe('low:Low');          // lower end below 2
    expect(chip('4-6')).toBe('high:High');
    expect(chip('<5')).toBe('normal:Normal');
    expect(chip('>100')).toBe('critical:CH · above 100'.replace('100', '50'));
    for (const v of ['0-4', '4-6', '<5', '>100', '<=5', '5']) { r.c.setValue('pus', v); expect(r.c.isInvalidNumeric(p)).toBe(false); }
    for (const v of ['6-4', '4-', 'abc']) { r.c.setValue('pus', v); expect(r.c.isInvalidNumeric(p)).toBe(true); }
  });

  it('submit sends the range verbatim; the same text on the sibling still blocks', async () => {
    const r = await renderResultEntry('grid');
    r.c.setValue('pus', '0-4');
    r.c.setValue('epi', '3');
    r.c.submit();
    expect(r.toasts.warning).not.toHaveBeenCalled();
    expect(r.api.post).toHaveBeenCalledWith('/api/results/ot1/enter', expect.objectContaining({ values: { pus: '0-4', epi: '3' } }));
    r.api.post.mockClear();
    r.c.setValue('epi', '0-4');
    r.c._saving?.set?.(false);
    r.c.submit();
    expect(r.api.post).not.toHaveBeenCalled();
    expect(r.toasts.warning).toHaveBeenCalled();
  });

  it('calc: a range value of a switched value reads as no number — never the next value', async () => {
    const r = await renderResultEntry('grid');
    const switched = { currentResult: JSON.stringify({ values: { pus: '0-4', epi: 7 } }), test: { parameters: PLAIN } };
    expect(r.c.siblingValue(switched, null)).toBeNull();
    expect(r.c.siblingValue(switched, 'pus')).toBeNull();
    expect(r.c.siblingValue(switched, 'epi')).toBe(7);
    // Same values, test WITHOUT the switch → today's first-number fallback.
    const plain = { currentResult: switched.currentResult, test: { parameters: PLAIN.replace('"allowRange":true,', '') } };
    expect(r.c.siblingValue(plain, null)).toBe(7);
  });
});

describe('range entry — sample result entry + Submit all', () => {
  it('keys, paste, live flag and the invalid check follow the switch', async () => {
    const r = await renderSampleEntry();
    const t = r.sample.tests[0];
    const p = r.c.parametersFor(t)[0];
    expect(typeIn(r.input(), '0-4')).toBe('0-4');
    expect(typeIn(r.input(), '>100')).toBe('>100');
    expect(pasted(r.input(), '<5')).toBe('x:<5');
    expect(r.c.getValue('ot1', 'result')).toBe('<5');
    r.c.setValue('ot1', 'result', '4-6');
    expect(r.c.flagFor(t, p)?.label).toBe('High');
    expect(r.c.isInvalidNumber(t, p)).toBe(false);
    r.c.setValue('ot1', 'result', '2-4');
    expect(r.c.flagFor(t, p)).toBeNull();          // SRE shows no chip for Normal
    r.c.setValue('ot1', 'result', '6-4');
    expect(r.c.isInvalidNumber(t, p)).toBe(true);
  });

  it('Submit all: a range is valid only where the switch is on', () => {
    const t = { id: 'ot1', status: 'in_progress', test: { parameters: PLAIN } };
    expect(invalidNumbers({ tests: [t], values: { ot1: { pus: '0-4', epi: '3' } } } as any)).toEqual([]);
    expect(invalidNumbers({ tests: [t], values: { ot1: { pus: '0-4', epi: '0-4' } } } as any)).toEqual(['Epithelial cells']);
  });
});
