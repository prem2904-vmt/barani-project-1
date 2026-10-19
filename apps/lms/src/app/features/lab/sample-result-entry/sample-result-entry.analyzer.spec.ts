import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SampleResultEntryComponent } from './sample-result-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { DraftShelfService } from '../../../core/services/draft-shelf.service';
import type { RunDto } from '../../../shared/instruments/instrument.models';

/**
 * Sample result entry × analyzer PREFILL (instrument connector): the latest
 * run fills EMPTY fields only, never a typed value, and never submits /
 * saves by itself; a run switch re-fills only untouched fields; the endpoint
 * failing (404 / not deployed) changes nothing — no toast, entry as before.
 */
const num = (title: string, unit: string) => JSON.stringify({
  parameters: [{ name: 'result', title, type: 'numeric', unit, referenceRanges: [{ min: 0, max: 1000 }] }],
});
function line(id: string, code: string, name: string, extra: Record<string, unknown> = {}, testExtra: Record<string, unknown> = {}) {
  return {
    id, subOrderId: 'smp-1', testId: `t-${id}`, name, status: 'in_progress', ...extra,
    test: { id: `t-${id}`, name, testCode: code, parameters: num(name, 'mg/dL'), ...testExtra },
  };
}
function sampleFixture(): any {
  return {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-09-25T03:00:00Z',
    department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
    order: {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-09-25T03:00:00Z', samples: [],
      patient: { id: 'p1', displayName: 'Demo Patient', age: 40, sex: 'Male', mrn: 'AA0001' },
    },
    siblings: [],
    tests: [
      line('ot1', 'CHOL', 'Cholesterol'),
      line('ot2', 'TG', 'Triglycerides'),
      line('ot3', 'VLDL', 'VLDL Cholesterol', {}, { calculation: JSON.stringify({ kind: 'expr', expr: 'TG/5', inputs: ['TG'] }) }),
      // The tech already typed Zinc (saved draft on the server).
      line('ot5', 'ZN', 'Zinc', { currentResult: JSON.stringify({ values: { result: '90' } }) }),
    ],
  };
}
const mv = (orderTestId: string, value: string, flags: string[] = []) => ({
  analyzerCode: orderTestId.toUpperCase(), orderTestId, testId: null, catalogKey: 'K', parameterName: null,
  value, rawValue: value, unit: 'mg/dL', rawUnit: 'mg/dL', flags,
});
const RUNS: RunDto[] = [
  { messageId: 'm1', instrumentId: 'i1', instrumentName: 'Cobas c311', receivedAt: '2026-09-30T05:12:00Z', runAt: '2026-09-30T05:12:00Z',
    state: 'matched', values: [mv('ot1', '180', ['H']), mv('ot2', '100'), mv('ot5', '101')] },
  { messageId: 'm0', instrumentId: 'i1', instrumentName: 'Cobas c311', receivedAt: '2026-09-30T04:00:00Z', runAt: null,
    state: 'superseded', values: [mv('ot1', '170')] },
];

/** Every fixture rendered, destroyed before localStorage is wiped (a debounced
 *  local-draft write must never leak typed values into the next test). */
const live: Array<{ destroy(): void }> = [];
/** A fresh in-memory Storage per test (the runner's own localStorage may be
 *  missing or shared across files). */
function stubStorage() {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  });
}

async function render(opts: { prefill?: () => unknown; validate?: boolean } = {}) {
  const sample = sampleFixture();
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/instruments/results/by-sample/')) {
        return opts.prefill ? (opts.prefill() as any) : of({ orderSampleId: 'smp-1', barcode: '26123', runs: RUNS });
      }
      if (url.endsWith('/tests')) return of(sample);
      if (url.includes('lab-trends')) return of({ tests: [] });
      return of([]);
    }),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const q = convertToParamMap(opts.validate ? { validate: '1' } : {});
  const route = {
    paramMap: new BehaviorSubject(convertToParamMap({ sampleId: 'smp-1' })),
    queryParamMap: new BehaviorSubject(q),
    snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map(opts.validate ? [['validate', '1']] : []) },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      { provide: ToastService, useValue: toasts },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', registrationId: 'R1', tenantName: 'Demo Lab' }), hasPermission: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn() } },
      { provide: DraftShelfService, useValue: { drop: vi.fn() } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Demo Lab' }), ensureLoaded() {} } },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { url: '/lab/sample/smp-1', navigate: vi.fn(() => Promise.resolve(true)) } },
    ],
  });
  const f = TestBed.createComponent(SampleResultEntryComponent);
  live.push(f);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await f.whenStable();
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  f.detectChanges();
  const c = f.componentInstance;
  const el = f.nativeElement as HTMLElement;
  return { f, c, el, api, toasts };
}

describe('Sample result entry — analyzer prefill', () => {
  beforeEach(() => stubStorage());
  afterEach(() => {
    while (live.length) { try { live.pop()!.destroy(); } catch { /* ignore */ } }
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('the latest run fills EMPTY fields; a typed value is never overwritten; nothing is submitted', async () => {
    const { c, el, api } = await render();
    expect(api.get).toHaveBeenCalledWith('/api/instruments/results/by-sample/smp-1');
    expect(c.getValue('ot1', 'result')).toBe('180');
    expect(c.getValue('ot2', 'result')).toBe('100');
    expect(c.getValue('ot5', 'result')).toBe('90');           // typed — kept
    expect(c.getValue('ot3', 'result')).toBe('20');           // VLDL = TG/5 recomputed from the prefill
    expect(api.post).not.toHaveBeenCalled();                  // never auto-submit / auto-save
    expect(api.put).not.toHaveBeenCalled();
    const chips = Array.from(el.querySelectorAll('.pf-sre__an-chip')).map((x) => x.textContent!.trim());
    expect(chips.some((t) => /^From Cobas c311 · \d{1,2}:\d{2}\s?(AM|PM)$/i.test(t))).toBe(true);
    expect(chips).toContain('Analyzer 101');                  // Zinc: what the analyzer sent, value untouched
    expect(el.querySelector('.pf-sre__an-flag[data-flag="H"]')).not.toBeNull();
  });

  it('once the tech edits a prefilled value, the badge says what the analyzer sent', async () => {
    const { f, c } = await render();
    c.setValue('ot1', 'result', '175');
    f.detectChanges();
    expect(c.analyzerBadgeFor({ id: 'ot1' }, { name: 'result' })).toMatchObject({ kind: 'edited', label: 'Analyzer 180' });
  });

  it('run picker: switching re-fills untouched fields only', async () => {
    const { f, c, el } = await render();
    expect(el.querySelector('pf-select.pf-sre-run')).not.toBeNull();   // 2 runs → the picker shows
    c.setValue('ot2', 'result', '120');                                 // tech edits TG
    c.applyAnalyzerRun('m0');
    f.detectChanges();
    expect(c.getValue('ot1', 'result')).toBe('170');                   // still the old prefill → re-filled
    expect(c.getValue('ot2', 'result')).toBe('120');                   // typed → kept
    expect(c.getValue('ot5', 'result')).toBe('90');
    expect(c.analyzerRunId()).toBe('m0');
  });

  it('endpoint 404 / error: silent (no toast), entry works as before', async () => {
    const { c, el, toasts } = await render({ prefill: () => throwError(() => new Error('Not found')) });
    expect(toasts.error).not.toHaveBeenCalled();
    expect(c.getValue('ot1', 'result')).toBe('');
    expect(c.getValue('ot5', 'result')).toBe('90');
    expect(el.querySelector('.pf-sre__an-chip')).toBeNull();
    expect(el.querySelector('input[data-sre-field="ot1::result"]')).not.toBeNull();
  });

  it('a malformed payload (no runs) changes nothing', async () => {
    const { c, el } = await render({ prefill: () => of([]) });
    expect(c.getValue('ot1', 'result')).toBe('');
    expect(el.querySelector('pf-select.pf-sre-run')).toBeNull();
  });

  it('validation mode never asks for (or applies) analyzer values', async () => {
    const { api } = await render({ validate: true });
    expect(api.get.mock.calls.some((a: unknown[]) => String(a[0]).includes('/api/instruments/'))).toBe(false);
  });
});
