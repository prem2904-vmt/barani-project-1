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



const TEXT_PARAMS = (normal: string, unit = '') => JSON.stringify({
  parameters: [{ name: 'f', title: 'Finding', type: 'textarea', normalValue: normal, unit }],
});
const textTube = (normal: string, unit = '', line: Record<string, unknown> = {}) =>
  sampleFixture(line, TEXT_PARAMS(normal, unit));
const P = (c: any, s: any) => c.parametersFor(s.tests[0])[0];

/** OPS-117 re-test: the bench shows what the server will flag for a written result. */
describe('Result entry - written result against its written reference (OPS-117 / OPS-128)', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('plain-words reference: a different word is Abnormal while typing, the same word (any case) is not', async () => {
    const smp = textTube('Negative');
    const { c } = await render(smp);
    const t = smp.tests[0]; const p = P(c, smp);
    c.setValue('ot1', 'f', 'Positive');
    expect(c.flagFor(t, p)?.label).toBe('Abnormal');
    c.setValue('ot1', 'f', 'negative');
    expect(c.flagFor(t, p)).toBeNull();
    c.setValue('ot1', 'f', '   ');
    expect(c.flagFor(t, p)).toBeNull();
  });

  it('several accepted words joined with "/"', async () => {
    const smp = textTube('Non-reactive / Negative');
    const { c } = await render(smp);
    c.setValue('ot1', 'f', 'Negative');
    expect(c.flagFor(smp.tests[0], P(c, smp))).toBeNull();
    c.setValue('ot1', 'f', 'Reactive');
    expect(c.flagFor(smp.tests[0], P(c, smp))?.label).toBe('Abnormal');
  });

  it('no reference typed: never flagged', async () => {
    const smp = textTube('');
    const { c } = await render(smp);
    c.setValue('ot1', 'f', 'anything');
    expect(c.flagFor(smp.tests[0], P(c, smp))).toBeNull();
  });

  it('a number rule in the reference ("< 5") is the server\'s call: no guess while typing', async () => {
    const smp = textTube('< 5', 'mg/L');
    const { c } = await render(smp);
    c.setValue('ot1', 'f', '9');
    expect(c.flagFor(smp.tests[0], P(c, smp))).toBeNull();
  });

  it('a SAVED verdict (H from the number rule) shows as High when the value is unchanged, and goes away once edited', async () => {
    const snap = JSON.stringify({ values: { f: '9' }, flagged: { f: { value: '9', flag: 'H' } } });
    const smp = textTube('< 5', 'mg/L', { currentResult: snap });
    const { c } = await render(smp);
    const t = smp.tests[0]; const p = P(c, smp);
    c.setValue('ot1', 'f', '9');
    expect(c.flagFor(t, p)?.label).toBe('High');
    c.setValue('ot1', 'f', '3');
    expect(c.flagFor(t, p)).toBeNull();
  });

  it('the unit prints beside a written result and in the unit column', async () => {
    const smp = textTube('< 5', 'mg/L');
    const { el } = await render(smp);
    expect(el.querySelector('.pf-sre__gunit-inline')?.textContent?.trim()).toBe('mg/L');
    expect(el.querySelector('td.pf-sre__gc-unit')?.textContent?.trim()).toBe('mg/L');
  });

  it('a written test with no unit shows a dash, not an empty unit', async () => {
    const smp = textTube('Negative');
    const { el } = await render(smp);
    expect(el.querySelector('.pf-sre__gunit-inline')).toBeNull();
    expect(el.querySelector('td.pf-sre__gc-unit')?.textContent?.trim()).toBe('—');
  });
});
