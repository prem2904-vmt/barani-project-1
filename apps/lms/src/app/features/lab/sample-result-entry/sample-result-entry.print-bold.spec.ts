import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
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
 * Owner 2026-09-30, result entry:
 *  1. "Tech picks what prints" gets a "Start with": None ticked → every value
 *     starts UNTICKED until the tech ticks it; a SAVED pick always wins (never
 *     reset on reload); the stamped (ordered-as) value wins over the test's
 *     own; a test with nothing ticked is warned before submit.
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

const picks = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>('input.pf-sre__printpick')).map(i => i.checked);
const boldBtn = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLButtonElement>(`[data-sre-bold="ot1::${name}"]`);
const field = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLInputElement>(`[data-sre-field="ot1::${name}"]`)!;

describe('Result entry — print picker "Start with: None ticked"', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('never picked + none → every value starts UNTICKED, with the nothing-prints note', async () => {
    const { el } = await render(sampleFixture());
    expect(picks(el)).toEqual([false, false]);
    expect(el.querySelector('.pf-sre__nothing-prints')?.textContent).toContain('Nothing from Haemogram will print');
  });

  it('ticking one saves hidden = the rest (the tech ticks what prints)', async () => {
    const { el, f, api } = await render(sampleFixture());
    el.querySelector<HTMLInputElement>('input.pf-sre__printpick')!.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(api.put).toHaveBeenCalledWith('/api/results/ot1/report-hidden', { hidden: ['PCV'] });
    expect(picks(el)).toEqual([true, false]);
    expect(el.querySelector('.pf-sre__nothing-prints')).toBeNull();
  });

  it('a SAVED pick wins on reload — even "print everything" ([])', async () => {
    const saved = await render(sampleFixture({ reportHiddenJson: '[]' }));
    expect(picks(saved.el)).toEqual([true, true]);
    TestBed.resetTestingModule();
    const some = await render(sampleFixture({ reportHiddenJson: '["PCV"]' }));
    expect(picks(some.el)).toEqual([true, false]);
  });

  it('the stamped (ordered-as) value wins: a profile saying "all" overrides the member\'s own "none"', async () => {
    const { el } = await render(sampleFixture({ printPickerDefault: 'all' }));
    expect(picks(el)).toEqual([true, true]);
  });

  it('an older server (no stamp) falls back to the test\'s own "Start with"', async () => {
    const { el } = await render(sampleFixture({ printPickerDefault: undefined }));
    expect(picks(el)).toEqual([false, false]);
  });

  it('submitting a test with nothing ticked asks first (DialogService); Go back sends nothing', async () => {
    const { c, api, dialog } = await render(sampleFixture());
    c.setValue('ot1', 'Hb', 13);
    await c.submitAll();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    const req = dialog.confirm.mock.calls[0][0];
    expect(req.title).toContain('Nothing will print');
    expect(req.items).toEqual(['Haemogram']);
    expect(api.post.mock.calls.some(([u]) => u === '/api/samples/smp-1/results')).toBe(false);
  });

  it('with the default "all" nothing is asked', async () => {
    const { c, api, dialog } = await render(sampleFixture({ printPickerDefault: 'all' }));
    c.setValue('ot1', 'Hb', 13);
    await c.submitAll();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.post.mock.calls.some(([u]) => u === '/api/samples/smp-1/results')).toBe(true);
  });
});

describe('Result entry — "print in bold" per value', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('every result has a B toggle (aria-pressed, "Print in bold"); clicking bolds the field and rides the submit', async () => {
    const { el, f, c, api } = await render(sampleFixture({ printPickerDefault: 'all' }));
    const b = boldBtn(el, 'Hb')!;
    expect(b).not.toBeNull();
    expect(boldBtn(el, 'PCV')).not.toBeNull();
    expect(b.getAttribute('title')).toBe('Print in bold');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.querySelector('svg')).not.toBeNull();
    b.click();
    f.detectChanges();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(field(el, 'Hb').closest('.pf-sre__rv')!.classList).toContain('pf-sre__rv--bold');
    c.setValue('ot1', 'Hb', 13);
    await c.submitAll();
    const [, body] = api.post.mock.calls.find(([u]) => u === '/api/samples/smp-1/results')!;
    expect(body.results[0]).toMatchObject({ orderTestId: 'ot1', bold: ['Hb'] });
  });

  it('Ctrl+B / Cmd+B inside the field toggles it (and does nothing without the modifier)', async () => {
    const { el, f, c } = await render(sampleFixture({ printPickerDefault: 'all' }));
    const input = field(el, 'PCV');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(c.isBold({ id: 'ot1' }, { name: 'PCV' })).toBe(false);
    const ev = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    f.detectChanges();
    expect(ev.defaultPrevented).toBe(true);
    expect(boldBtn(el, 'PCV')!.getAttribute('aria-pressed')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', metaKey: true, bubbles: true, cancelable: true }));
    f.detectChanges();
    expect(boldBtn(el, 'PCV')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the saved picks come back pressed; a submitted result shows them read-only', async () => {
    const cur = JSON.stringify({ values: { Hb: 13, PCV: 40 }, bold: ['PCV'] });
    const { el } = await render(sampleFixture({ printPickerDefault: 'all', currentResult: cur, status: 'entered' }));
    const pcv = boldBtn(el, 'PCV')!;
    expect(pcv.getAttribute('aria-pressed')).toBe('true');
    expect(pcv.disabled).toBe(true);
    expect(boldBtn(el, 'Hb')).toBeNull();          // read-only + not bold → no toggle
    expect(field(el, 'PCV').closest('.pf-sre__rv')!.classList).toContain('pf-sre__rv--bold');
  });

  it('the draft endpoints carry it too (saved list survives a re-open)', async () => {
    const cur = JSON.stringify({ values: { Hb: 13 }, bold: ['Hb'] });
    const { c, api } = await render(sampleFixture({ printPickerDefault: 'all', currentResult: cur }));
    await c.saveDraft();
    const [, body] = api.post.mock.calls.find(([u]) => u === '/api/samples/smp-1/results/draft')!;
    expect(body.results[0].bold).toEqual(['Hb']);
  });

  it('touch: the toggle is a 44px target', () => {
    const css = ((SampleResultEntryComponent as any).ɵcmp.styles as string[]).join('\n').replace(/\[_ng(content|host)-%COMP%\]/g, '');
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.pf-sre__bold\s*\{\s*width:\s*44px;\s*height:\s*44px/);
  });
});
