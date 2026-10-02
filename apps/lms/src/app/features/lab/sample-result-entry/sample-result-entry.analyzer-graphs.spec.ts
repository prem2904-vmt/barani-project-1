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
 * Analyzer graphs card (owner 2026-10-02). Original harness note — "Analyzer graphs not received": the warning
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
function cbcLine(id: string, name: string, attachments: Array<{ param: string; name?: string }> = []) {
  return {
    id, subOrderId: 'smp-1', testId: `t-${id}`, name, status: 'in_progress',
    packageTestId: 'pkg-cbc', packageType: 'profile', profileTestId: 'pkg-cbc', profileName: 'CBC',
    attachmentsJson: attachments.length ? JSON.stringify(attachments.map((a, i) => ({ id: 'a' + i, url: '/u/' + i, kind: 'image', show: true, ...a }))) : null,
    test: { id: `t-${id}`, name, testCode: id.toUpperCase(), parameters: num(name, 'g/dL') },
  };
}
function sampleFixture(attachments: Array<{ param: string; name?: string }> = []): any {
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
    tests: [cbcLine('hgb', 'Hemoglobin', attachments), cbcLine('wbc', 'Total Leukocyte Count', [{ param: 'instrument:12153', name: 'DIFF' }])],
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

async function render(opts: { attachments?: Array<{ param: string; name?: string }>; layoutEnabled?: boolean; noLayout?: boolean; validate?: boolean } = {}) {
  const sample = sampleFixture(opts.attachments ?? []);
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/report-layout/test/')) {
      if (opts.noLayout) return of({ testId: 'pkg-cbc', sections: [{ id: 'g1', type: 'grid', order: 1, rows: [] }], version: 1, configured: false });
      return of({ testId: 'pkg-cbc', sections: PAGE_LAYOUT_SECTIONS(opts.layoutEnabled ?? true), version: 1, configured: true });
    }
    if (url.startsWith('/api/instruments/messages')) return of({ items: [], total: 0, page: 1, pageSize: 20 });
    if (url.startsWith('/api/instruments/results/by-sample/')) return of({ orderSampleId: 'smp-1', barcode: '26123', runs: [{ messageId: 'm1', instrumentId: 'i1', instrumentName: 'Arun CBC', receivedAt: '2026-10-02T11:32:00Z', runAt: '2026-10-02T11:32:00Z', state: 'matched', values: [] }] });
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

describe('Sample result entry — Analyzer graphs card', () => {
  beforeEach(() => stubStorage());
  afterEach(() => { while (live.length) live.pop()!.destroy(); vi.unstubAllGlobals(); TestBed.resetTestingModule(); });

  it('instrument graphs leave the line chips and appear in ONE "Analyzer graphs" card with human labels, in the analyzer order', async () => {
    const { c, el } = await render({ attachments: [{ param: 'instrument:12053', name: 'RBC' }, { param: 'result', name: 'photo.jpg' }] });
    expect(c.analyzerGraphs().map(g => [g.code, g.label])).toEqual([['12053', 'RBC histogram'], ['12153', 'WBC DIFF scattergram']]);
    // The tech's own photo keeps its chip; no chip says "instrument:…".
    const chips = Array.from(el.querySelectorAll('.pf-sre__attach-name')).map(e => e.textContent ?? '');
    expect(chips.some(t => t.includes('photo.jpg'))).toBe(true);
    expect(chips.some(t => t.includes('instrument:'))).toBe(false);
    const card = el.querySelector('pf-analyzer-graphs')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('RBC histogram');
    expect(card.textContent).toContain('From Arun CBC');
    expect(card.querySelectorAll('.pf-ag__item').length).toBe(2);
  });

  it('the eye on a graph flips its print flag through the SAME attachments save', async () => {
    const { c, api } = await render({ attachments: [{ param: 'instrument:12053', name: 'RBC' }] });
    c.toggleGraphShow(c.analyzerGraphs()[0]);
    const call = (api.put as ReturnType<typeof vi.fn>).mock.calls.find(a => String(a[0]).includes('/attachments'))!;
    expect(call[0]).toBe('/api/results/hgb/attachments');
    expect((call[1] as { attachments: Array<{ show: boolean }> }).attachments[0].show).toBe(false);
  });

});
