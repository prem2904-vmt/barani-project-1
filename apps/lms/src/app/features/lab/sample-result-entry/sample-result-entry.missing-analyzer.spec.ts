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
 * "Analyzer graphs not received" (owner decision 2, 2026-10-02): the warning
 * banner in BOTH normal entry and validate mode — a profile's enabled
 * page_layout expects an analyzer image code that isn't attached to this
 * sample yet. Reuses missingAnalyzerWarning() (report-profile-layout.ts,
 * already unit-tested) — this file only proves the screen wires it up:
 * fetches the profile's layout, compares against the SAME attachmentsFor()
 * the gallery already reads, and shows (or doesn't) the banner.
 */
const num = (title: string, unit: string) => JSON.stringify({
  parameters: [{ name: 'result', title, type: 'numeric', unit, referenceRanges: [{ min: 0, max: 1000 }] }],
});
function cbcLine(id: string, name: string, attachments: Array<{ param: string }> = []) {
  return {
    id, subOrderId: 'smp-1', testId: `t-${id}`, name, status: 'in_progress',
    packageTestId: 'pkg-cbc', packageType: 'profile', profileTestId: 'pkg-cbc', profileName: 'CBC',
    attachmentsJson: attachments.length ? JSON.stringify(attachments.map((a, i) => ({ id: 'a' + i, url: '/u/' + i, kind: 'image', show: true, ...a }))) : null,
    test: { id: `t-${id}`, name, testCode: id.toUpperCase(), parameters: num(name, 'g/dL') },
  };
}
function sampleFixture(attachments: Array<{ param: string }> = []): any {
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
    tests: [cbcLine('hgb', 'Hemoglobin', attachments)],
  };
}
const PAGE_LAYOUT_SECTIONS = (enabled: boolean) => [
  { id: 'g1', type: 'grid', order: 1, rows: [] },
  { id: 'page-layout', type: 'page_layout', order: 2, v: 1, enabled, boxes: [
    { id: 'table', kind: 'table', x: 0, y: 0, w: 100, h: 150 },
    { id: 'analyzer-12003', kind: 'analyzer', ref: '12003', label: 'WBC histogram', x: 110, y: 0, w: 40, h: 40 },
    { id: 'analyzer-12053', kind: 'analyzer', ref: '12053', label: 'RBC histogram', x: 110, y: 50, w: 40, h: 40 },
  ] },
];

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

async function render(opts: { attachments?: Array<{ param: string }>; layoutEnabled?: boolean; noLayout?: boolean; validate?: boolean } = {}) {
  const sample = sampleFixture(opts.attachments ?? []);
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/report-layout/test/')) {
      if (opts.noLayout) return of({ testId: 'pkg-cbc', sections: [{ id: 'g1', type: 'grid', order: 1, rows: [] }], version: 1, configured: false });
      return of({ testId: 'pkg-cbc', sections: PAGE_LAYOUT_SECTIONS(opts.layoutEnabled ?? true), version: 1, configured: true });
    }
    if (url.startsWith('/api/instruments/messages')) return of({ items: [], total: 0, page: 1, pageSize: 20 });
    if (url.startsWith('/api/instruments/results/by-sample/')) return of({ orderSampleId: 'smp-1', barcode: '26123', runs: [] });
    if (url.endsWith('/tests')) return of(sample);
    if (url.includes('lab-trends')) return of({ tests: [] });
    return of([]);
  });
  const api = { get, post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})) };
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
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  f.detectChanges();
  return { f, c: f.componentInstance, el: f.nativeElement as HTMLElement, api };
}

describe('Sample result entry — "Analyzer graphs not received"', () => {
  beforeEach(() => stubStorage());
  afterEach(() => {
    while (live.length) { try { live.pop()!.destroy(); } catch { /* ignore */ } }
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('no analyzer images attached: warns for every analyzer box the profile layout expects', async () => {
    const { c, el } = await render({ attachments: [] });
    expect(c.missingAnalyzerWarnings()).toHaveLength(2);
    expect(c.missingAnalyzerWarnings().map((w: { message: string }) => w.message).join(' ')).toContain('WBC histogram');
    expect(el.querySelector('.pf-sre-warnbar')).not.toBeNull();
  });

  it('one image attached: warns only for the still-missing one', async () => {
    const { c } = await render({ attachments: [{ param: 'instrument:12003' }] });
    expect(c.missingAnalyzerWarnings()).toHaveLength(1);
    expect(c.missingAnalyzerWarnings()[0].message).toContain('RBC histogram');
  });

  it('both images attached: no warning at all', async () => {
    const { c, el } = await render({ attachments: [{ param: 'instrument:12003' }, { param: 'instrument:12053' }] });
    expect(c.missingAnalyzerWarnings()).toHaveLength(0);
    expect(el.querySelector('.pf-sre-warnbar')).toBeNull();
  });

  it('the profile layout is DISABLED: never warns, even with zero images', async () => {
    const { c } = await render({ attachments: [], layoutEnabled: false });
    expect(c.missingAnalyzerWarnings()).toHaveLength(0);
  });

  it('the profile has no page_layout at all: never warns', async () => {
    const { c } = await render({ attachments: [], noLayout: true });
    expect(c.missingAnalyzerWarnings()).toHaveLength(0);
  });

  it('shows in VALIDATE mode too (owner: "in validate mode (and in result entry)")', async () => {
    const { c, el } = await render({ attachments: [], validate: true });
    expect(c.missingAnalyzerWarnings().length).toBeGreaterThan(0);
    expect(el.querySelector('.pf-sre-warnbar')).not.toBeNull();
  });
});
