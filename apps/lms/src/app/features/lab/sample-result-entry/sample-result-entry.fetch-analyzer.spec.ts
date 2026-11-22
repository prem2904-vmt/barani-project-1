import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
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

/**
 * "Fetch from analyzer" (owner, 2026-10-02): a refresh button in sample
 * result entry — the connector pushes automatically, so this re-queries
 * for (a) an unmatched instrument message reported against THIS tube's
 * barcode (a timing miss at ingest) and attaches it, then (b) reloads the
 * sample so any newly attached analyzer image/value shows. Never a device
 * command; never shown in validate/view-only mode.
 */
const num = (title: string, unit: string) => JSON.stringify({
  parameters: [{ name: 'result', title, type: 'numeric', unit, referenceRanges: [{ min: 0, max: 1000 }] }],
});

function sampleFixture(): any {
  return {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-10-02T03:00:00Z',
    department: { id: 'd1', name: 'Haematology', code: 'HAE' },
    order: {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-10-02T03:00:00Z', samples: [],
      patient: { id: 'p1', displayName: 'Demo Patient', age: 40, sex: 'Male', mrn: 'AA0001' },
    },
    siblings: [],
    tests: [{ id: 'ot1', subOrderId: 'smp-1', testId: 't-ot1', name: 'Hemoglobin', status: 'in_progress',
      test: { id: 't-ot1', name: 'Hemoglobin', testCode: 'HGB', parameters: num('Hemoglobin', 'g/dL') } }],
  };
}

const live: Array<{ destroy(): void }> = [];
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

async function render(opts: { unmatched?: unknown[]; attachOk?: boolean; validate?: boolean } = {}) {
  const sample = sampleFixture();
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/instruments/messages')) {
      expect(url).toContain('state=unmatched');
      expect(url).toContain('sampleId=26123');
      return of({ items: opts.unmatched ?? [], total: (opts.unmatched ?? []).length, page: 1, pageSize: 20 });
    }
    if (url.startsWith('/api/instruments/results/by-sample/')) return of({ orderSampleId: 'smp-1', barcode: '26123', runs: [] });
    if (url.endsWith('/tests')) return of(sample);
    if (url.includes('lab-trends')) return of({ tests: [] });
    return of([]);
  });
  const post = vi.fn((url: string) => {
    if (url.includes('/attach')) return opts.attachOk === false ? Promise.reject(new Error('conflict')) : of({});
    return of({});
  });
  const api = { get, post, patch: vi.fn(() => of({})), put: vi.fn(() => of({})) };
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
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, api, toasts };
}

describe('Sample result entry — Fetch from analyzer', () => {
  beforeEach(() => stubStorage());
  afterEach(() => {
    while (live.length) { try { live.pop()!.destroy(); } catch { /* ignore */ } }
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('is offered in normal entry; queries unmatched messages for THIS tube\'s barcode and attaches them', async () => {
    const { c, el, api, toasts } = await render({ unmatched: [{ id: 'm1' }, { id: 'm2' }] });
    expect(el.querySelector('.pf-sre-fetch')).not.toBeNull();
    // Owner 2026-11-22: it sits at the right end of the FIRST results card's head — once, not a bar above the cards.
    expect(el.querySelectorAll('.pf-sre-fetch').length).toBe(1);
    const head = el.querySelector('.pf-sre__test > .pf-card__head')!;
    expect(head.lastElementChild?.classList.contains('pf-sre-fetch')).toBe(true);
    await c.fetchFromAnalyzer();
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/api/instruments/messages?'));
    expect(api.post).toHaveBeenCalledWith('/api/instruments/messages/m1/attach', { barcode: '26123' });
    expect(api.post).toHaveBeenCalledWith('/api/instruments/messages/m2/attach', { barcode: '26123' });
    // Reloads the sample afterwards (the second /tests GET).
    expect(api.get.mock.calls.filter((a: unknown[]) => String(a[0]).endsWith('/tests')).length).toBeGreaterThanOrEqual(2);
    expect(toasts.success).toHaveBeenCalledWith('2 new analyzer results attached.');
  });

  it('no unmatched messages: still reloads, tells the tech nothing new arrived (no error)', async () => {
    const { c, toasts } = await render({ unmatched: [] });
    await c.fetchFromAnalyzer();
    expect(toasts.info).toHaveBeenCalledWith('No new analyzer results yet.');
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('an attach race (another tech / no longer unmatched) is swallowed — not a failure', async () => {
    const { c, toasts } = await render({ unmatched: [{ id: 'm1' }], attachOk: false });
    await c.fetchFromAnalyzer();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.info).toHaveBeenCalledWith('No new analyzer results yet.');
  });

  it('never shown in validation mode', async () => {
    const { el } = await render({ validate: true });
    expect(el.querySelector('.pf-sre-fetch')).toBeNull();
  });
});
