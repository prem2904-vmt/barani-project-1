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
import { loadEditorFields, writeParameters } from '../../shared/utils/test-parameters';

/**
 * HARD RULE of range entry (owner 2026-10-24): a numeric value WITHOUT the
 * Test Master switch "Allow a range or < / >" behaves byte-for-byte as before
 * — keys, paste, the invalid check, submit, the live flag, calc reads and the
 * editor save. This spec uses ONLY behaviour/APIs that existed before the
 * feature; its golden table was captured by running it on unchanged main
 * (13808803) and must stay green there AND on the branch, unedited.
 */
const PLAIN = JSON.stringify({
  parameters: [
    { id: 'p-pus', name: 'pus', title: 'Pus cells', type: 'numeric', unit: '/HPF', criticalHigh: 50,
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
      { provide: Router, useValue: { url: '/lab/result/ot1', navigate: vi.fn(() => Promise.resolve(true)), getCurrentNavigation: () => null } },
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
        { name: 'result', title: 'Pus cells', type: 'numeric', unit: '/HPF', criticalHigh: 50, referenceRanges: [{ min: 2, max: 5 }] },
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
      { provide: Router, useValue: { url: '/lab/sample/smp-1', navigate: vi.fn(() => Promise.resolve(true)) } },
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

async function dumpAll(): Promise<string> {
  const out: string[] = [];

  // ── per-test result entry: grid (desktop number field) ──
  {
    const r = await renderResultEntry('grid');
    out.push(`grid.type=${r.input().type}`);
    out.push('grid.keys=' + KEYS.map(k => keyed(r.input(), '', k)).join(','));
    r.f.destroy();
    TestBed.resetTestingModule();
  }
  // ── per-test result entry: cards (text field) ──
  {
    const r = await renderResultEntry('cards');
    const p = r.c.parameters().find((x: any) => x.name === 'pus');
    out.push(`cards.type=${r.input().type}`);
    for (const s of STARTS) out.push(`cards.keys[${s}]=` + KEYS.map(k => keyed(r.input(), s, k)).join(','));
    for (const t of ['0-4', '<5', '12 mg/dL', ' 7 ', '-3']) out.push(`cards.paste[${t}]=${pasted(r.input(), t)}|${r.c.valueOf('pus') ?? ''}`);
    for (const v of VALUES) {
      r.c.setValue('pus', v);
      const fl = r.c.flagFor(p);
      out.push(`re.value[${v}]=${fl ? fl.tone + ':' + fl.label : '-'}|invalid=${r.c.isInvalidNumeric(p)}`);
    }
    r.c.setValue('pus', '0-4');
    r.c.submit();
    out.push(`re.submit[0-4]=posted:${r.api.post.mock.calls.length}|warn:${r.toasts.warning.mock.calls.map((c: any[]) => c[0]).join(';')}`);
    // calc read of a sibling's saved values — falls back to the first number.
    const sib = { currentResult: JSON.stringify({ values: { a: '0-4', b: 7 } }), test: { parameters: PLAIN } };
    out.push(`re.sibling=${r.c.siblingValue(sib, null)}|named=${r.c.siblingValue(sib, 'a')}`);
    r.f.destroy();
    TestBed.resetTestingModule();
  }
  // ── sample result entry ──
  {
    const r = await renderSampleEntry();
    const t = r.sample.tests[0];
    const p = r.c.parametersFor(t)[0];
    out.push(`sre.type=${r.input().type}`);
    for (const s of STARTS) out.push(`sre.keys[${s}]=` + KEYS.map(k => keyed(r.input(), s, k)).join(','));
    for (const tx of ['0-4', '<5', '12 mg/dL', ' 7 ', '-3']) out.push(`sre.paste[${tx}]=${pasted(r.input(), tx)}|${r.c.getValue('ot1', 'result') ?? ''}`);
    for (const v of VALUES) {
      r.c.setValue('ot1', 'result', v);
      const fl = r.c.flagFor(t, p);
      out.push(`sre.value[${v}]=${fl ? fl.tone + ':' + fl.label : '-'}|invalid=${r.c.isInvalidNumber(t, p)}`);
    }
    r.f.destroy();
    TestBed.resetTestingModule();
  }
  // ── Submit all's invalid list ──
  {
    const t = { id: 'ot1', status: 'in_progress', test: { parameters: PLAIN } };
    for (const v of VALUES) out.push(`all.invalid[${v}]=${invalidNumbers({ tests: [t], values: { ot1: { pus: v } } } as any).join(',')}`);
  }
  // ── Test Master save of a plain numeric value ──
  out.push('editor.save=' + writeParameters(PLAIN, loadEditorFields(PLAIN)));
  return out.join('\n');
}

// Captured on unchanged main 13808803 — do not regenerate.
const GOLDEN = `grid.type=number
grid.keys=ok,ok,ok,ok,x,x,x,x,x,x,x,ok
cards.type=text
cards.keys[]=ok,ok,ok,ok,x,x,x,x,x,x,x,ok
cards.keys[1]=ok,ok,ok,ok,x,x,x,x,x,x,x,ok
cards.keys[1.]=ok,ok,x,ok,x,x,x,x,x,x,x,ok
cards.keys[-]=ok,ok,ok,x,x,x,x,x,x,x,x,ok
cards.keys[0-4]=ok,ok,ok,x,x,x,x,x,x,x,x,ok
cards.keys[<]=ok,ok,ok,ok,x,x,x,x,x,x,x,ok
cards.paste[0-4]=x:04|04
cards.paste[<5]=x:5|5
cards.paste[12 mg/dL]=x:12|12
cards.paste[ 7 ]=x:7|7
cards.paste[-3]=ok:|7
re.value[0-4]=low:Low|invalid=true
re.value[4-6]=normal:Normal|invalid=true
re.value[<5]=-|invalid=true
re.value[>100]=-|invalid=true
re.value[5]=normal:Normal|invalid=false
re.value[6]=high:High|invalid=false
re.value[60]=critical:CH · above 50|invalid=false
re.value[1]=low:Low|invalid=false
re.value[ 7 ]=high:High|invalid=false
re.value[-3]=low:Low|invalid=false
re.value[4-]=normal:Normal|invalid=true
re.value[abc]=-|invalid=true
re.value[1e2]=critical:CH · above 50|invalid=false
re.value[6-4]=high:High|invalid=true
re.submit[0-4]=posted:0|warn:One or more numeric results are not valid numbers — fix them before submitting.
re.sibling=7|named=null
sre.type=text
sre.keys[]=ok,ok,ok,ok,x,x,x,x,x,x,x,ok
sre.keys[1]=ok,ok,ok,ok,x,x,x,x,x,x,x,ok
sre.keys[1.]=ok,ok,x,ok,x,x,x,x,x,x,x,ok
sre.keys[-]=ok,ok,ok,x,x,x,x,x,x,x,x,ok
sre.keys[0-4]=ok,ok,ok,x,x,x,x,x,x,x,x,ok
sre.keys[<]=ok,ok,ok,ok,x,x,x,x,x,x,x,ok
sre.paste[0-4]=x:04|04
sre.paste[<5]=x:5|5
sre.paste[12 mg/dL]=x:12|12
sre.paste[ 7 ]=x:7|7
sre.paste[-3]=ok:|7
sre.value[0-4]=-|invalid=true
sre.value[4-6]=-|invalid=true
sre.value[<5]=-|invalid=true
sre.value[>100]=-|invalid=true
sre.value[5]=-|invalid=false
sre.value[6]=high:High|invalid=false
sre.value[60]=critical:CH · above 50|invalid=false
sre.value[1]=low:Low|invalid=false
sre.value[ 7 ]=high:High|invalid=false
sre.value[-3]=low:Low|invalid=false
sre.value[4-]=-|invalid=true
sre.value[abc]=-|invalid=true
sre.value[1e2]=critical:CH · above 50|invalid=false
sre.value[6-4]=-|invalid=true
all.invalid[0-4]=Pus cells
all.invalid[4-6]=Pus cells
all.invalid[<5]=Pus cells
all.invalid[>100]=Pus cells
all.invalid[5]=
all.invalid[6]=
all.invalid[60]=
all.invalid[1]=
all.invalid[ 7 ]=
all.invalid[-3]=
all.invalid[4-]=Pus cells
all.invalid[abc]=Pus cells
all.invalid[1e2]=
all.invalid[6-4]=Pus cells
editor.save={"parameters":[{"id":"p-pus","name":"pus","title":"Pus cells","type":"numeric","unit":"/HPF","referenceRanges":[{"min":2,"max":5}],"criticalHigh":50}]}`;

describe('range entry — values WITHOUT the switch are untouched', () => {
  it('keys, paste, invalid check, submit, live flag, calc read and editor save match main', async () => {
    const dump = await dumpAll();
    expect(dump).toBe(GOLDEN);
  }, 60_000);   // renders three screens — generous under a loaded full run
});
