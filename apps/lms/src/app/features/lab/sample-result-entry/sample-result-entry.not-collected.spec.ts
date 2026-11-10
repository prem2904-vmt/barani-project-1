import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { vi } from 'vitest';
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
 * (harness copied from the empty-fields spec)
 * Owner 2026-09-30, result entry:
 *  1. "Tech picks what prints" gets a "Start with": None ticked → every value
 *     starts UNTICKED until the tech ticks it; a SAVED pick always wins (never
 *     reset on reload); the stamped (ordered-as) value wins over the test's
 *     own. No per-row nag; ONE dialog before submit / validate only when
 *     nothing at all would print. Entering a value ticks its row.
 *  2. A "B" toggle beside every result (and Ctrl/Cmd+B inside the field)
 *     marks that value "print in bold"; it rides every draft / submit.
 */
const PARAMS = (extra: Record<string, unknown> = {}) => JSON.stringify({
  printPicker: true, ...extra,
  parameters: [
    { name: 'Hb', title: 'Haemoglobin', type: 'numeric', unit: 'g/dL' },
    { name: 'PCV', title: 'Packed Cell Volume', type: 'numeric', unit: '%' },
  ],
});

function sampleFixture(line: Record<string, unknown> = {}, testParams = PARAMS({ printPickerDefault: 'none' })): any {
  return {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-09-25T03:00:00Z',
    department: { id: 'd1', name: 'Haematology', code: 'HEM' },
    order: {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-09-25T03:00:00Z', samples: [],
      patient: { id: 'p1', displayName: 'Test Patient', age: 29, sex: 'Male', mrn: 'AA0012' },
    },
    siblings: [],
    tests: [{
      id: 'ot1', subOrderId: 'smp-1', testId: 't1', name: 'Haemogram', status: 'in_progress',
      printPicker: true, printPickerDefault: 'none',
      test: { id: 't1', name: 'Haemogram', parameters: testParams },
      ...line,
    }],
  };
}

async function render(sample: any, opts: { confirm?: boolean } = {}) {
  const api = {
    get: vi.fn((url: string) => {
      if (url.endsWith('/tests')) return of(sample);
      if (url.includes('lab-trends')) return of({ tests: [] });
      return of([]);
    }),
    post: vi.fn((_url: string, _body: any) => of({ sample, submitted: 1, results: [] })),
    patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  const params$ = new BehaviorSubject(convertToParamMap({ sampleId: 'smp-1' }));
  const query$ = new BehaviorSubject(convertToParamMap({}));
  // The print-choice dialogs are what these specs assert. A half-filled tube
  // also asks "Some fields are empty" (empty-fields spec) — answered
  // "Submit anyway" here and kept out of the counted spy.
  const dialog = { confirm: vi.fn(async (_req: any) => !!opts.confirm), prompt: vi.fn() };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: toasts },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: DialogService, useValue: dialog },
      { provide: DraftShelfService, useValue: { drop: vi.fn() } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ActivatedRoute, useValue: { paramMap: params$, queryParamMap: query$,
        snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: { url: '/lab/sample/smp-1', navigate: vi.fn(() => Promise.resolve(true)) } },
    ],
  });
  const f = TestBed.createComponent(SampleResultEntryComponent);
  f.detectChanges();
  await f.whenStable();
  await new Promise(r => setTimeout(r, 0));
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api, dialog, toasts };
}


const posted = (api: any) => api.post.mock.calls.map(([u]: [string, any]) => u);

/**
 * OPS-120 (tester, 2026-11-10): on a partly collected order, the tube that is NOT collected yet still let the
 * tech type results. The server refuses them; the screen now locks that tube: a plain banner, the result cards
 * inert, no Save draft / Submit, no autosave.
 */
describe('Result entry — a tube that is not collected yet is locked (OPS-120)', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('pending tube: banner, inert cards, no Save draft / Submit this sample, Submit disabled', async () => {
    const smp = sampleFixture({ printPickerDefault: 'all' }, PARAMS());
    smp.status = 'pending';
    const { el, c } = await render(smp);
    expect(c.notCollected()).toBe(true);
    expect(c.hasWritable()).toBe(false);
    expect(el.querySelector('[data-not-collected]')?.textContent).toContain('not collected yet');
    const cards = Array.from(el.querySelectorAll('.pf-sre__test'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.hasAttribute('inert')).toBe(true);
    expect(el.querySelector('.pf-sre-draft')).toBeNull();
    const submit = el.querySelector('.pf-sre-submit') as HTMLButtonElement | null;
    if (submit) expect(submit.disabled).toBe(true);
  });

  it('a value set on a pending tube is never autosaved', async () => {
    const smp = sampleFixture({ printPickerDefault: 'all' }, PARAMS());
    smp.status = 'pending';
    const { c, api } = await render(smp);
    vi.useFakeTimers();
    try {
      c.setValue('ot1', 'Hb', 13);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(posted(api).filter((u: string) => u.includes('/draft') || u.includes('/results'))).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('rejected tube says to collect a new sample', async () => {
    const smp = sampleFixture({ printPickerDefault: 'all' }, PARAMS());
    smp.status = 'rejected';
    const { el } = await render(smp);
    expect(el.querySelector('[data-not-collected]')?.textContent).toContain('rejected');
  });

  it('a received tube is untouched: no banner, cards editable', async () => {
    const { el, c } = await render(sampleFixture({ printPickerDefault: 'all' }, PARAMS()));
    expect(c.notCollected()).toBe(false);
    expect(el.querySelector('[data-not-collected]')).toBeNull();
    for (const card of Array.from(el.querySelectorAll('.pf-sre__test'))) expect(card.hasAttribute('inert')).toBe(false);
    expect(c.hasWritable()).toBe(true);
  });
});

describe('Result entry — locked tube hides Fetch from analyzer (OPS-120)', () => {
  afterEach(() => { TestBed.resetTestingModule(); });
  it('no Fetch from analyzer on a pending tube', async () => {
    const smp = sampleFixture({ printPickerDefault: 'all' }, PARAMS());
    smp.status = 'pending';
    const { el } = await render(smp);
    expect(el.querySelector('.pf-sre-fetch')).toBeNull();
  });
});
