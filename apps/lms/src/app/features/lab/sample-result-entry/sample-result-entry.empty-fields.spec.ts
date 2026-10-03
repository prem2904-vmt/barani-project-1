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
 * (harness copied from the print-bold spec)
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
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
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
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api, dialog };
}


const submitted = (api: any) => api.post.mock.calls.some(([u]: [string, any]) => u === '/api/samples/smp-1/results');

/**
 * Owner bug 2026-10-03 (Salem 26285 / 26262): the tech filled 8 of Urine
 * Routine's 13 lines and pressed Submit — the 5 dipstick lines silently stayed
 * behind, the order never completed and no report was made. Submit (one tube)
 * now asks the SAME "Some fields are empty" question as Submit all.
 */
describe('Result entry — Submit with empty fields asks first', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('a half-filled tube lists the empty fields; Go back submits nothing', async () => {
    const { c, api, dialog } = await render(sampleFixture({ printPickerDefault: 'all' }, PARAMS()));
    c.setValue('ot1', 'Hb', 13);
    await c.submitAll();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    const req = dialog.confirm.mock.calls[0][0];
    expect(req.title).toBe('Some fields are empty');
    expect(req.items).toEqual(['26123 · Haemogram — Packed Cell Volume']);
    expect(req.confirmLabel).toBe('Submit anyway');
    expect(submitted(api)).toBe(false);
  });

  it('Submit anyway sends what was entered', async () => {
    const { c, api, dialog } = await render(sampleFixture({ printPickerDefault: 'all' }, PARAMS()), { confirm: true });
    c.setValue('ot1', 'Hb', 13);
    await c.submitAll();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(submitted(api)).toBe(true);
  });

  it('every field filled → no question', async () => {
    const { c, api, dialog } = await render(sampleFixture({ printPickerDefault: 'all' }, PARAMS()));
    c.setValue('ot1', 'Hb', 13);
    c.setValue('ot1', 'PCV', 40);
    await c.submitAll();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(submitted(api)).toBe(true);
  });

  it('a second, entirely blank test on the tube is named too (the dipstick case)', async () => {
    const smp = sampleFixture({ printPickerDefault: 'all' }, PARAMS());
    smp.tests.push({
      id: 'ot2', subOrderId: 'smp-1', testId: 't2', name: 'Urine Bilirubin', status: 'pending',
      test: { id: 't2', name: 'Urine Bilirubin', parameters: JSON.stringify({
        parameters: [{ name: 'Urine Bilirubin', type: 'select', options: ['Negative', 'Positive'] }] }) },
    });
    const { c, api, dialog } = await render(smp);
    c.setValue('ot1', 'Hb', 13);
    c.setValue('ot1', 'PCV', 40);
    await c.submitAll();
    const req = dialog.confirm.mock.calls[0][0];
    expect(req.title).toBe('1 test has no value');
    expect(req.message).toContain('Urine Bilirubin');
    expect(req.question).toBe('Submit without them?');
    expect(req.items).toEqual(['26123 · Urine Bilirubin — Urine Bilirubin']);
    expect(submitted(api)).toBe(false);
    expect(api.post.mock.calls.some(([u]: [string, any]) => u.endsWith('/not-reported'))).toBe(false);
  });

  it('Submit without them: the filled test is submitted, the blank one is closed as not reported (never sent as an empty result)', async () => {
    const smp = sampleFixture({ printPickerDefault: 'all' }, PARAMS());
    smp.tests.push({
      id: 'ot2', subOrderId: 'smp-1', testId: 't2', name: 'Urine Bilirubin', status: 'pending',
      test: { id: 't2', name: 'Urine Bilirubin', parameters: JSON.stringify({
        parameters: [{ name: 'Urine Bilirubin', type: 'select', options: ['Negative', 'Positive'] }] }) },
    });
    const { c, api } = await render(smp, { confirm: true });
    c.setValue('ot1', 'Hb', 13);
    c.setValue('ot1', 'PCV', 40);
    await c.submitAll();
    const results = api.post.mock.calls.find(([u]: [string, any]) => u === '/api/samples/smp-1/results');
    expect(results![1].results.map((r: any) => r.orderTestId)).toEqual(['ot1']);
    const skip = api.post.mock.calls.find(([u]: [string, any]) => u === '/api/samples/smp-1/not-reported');
    expect(skip![1]).toEqual({ orderTestIds: ['ot2'] });
  });
});
