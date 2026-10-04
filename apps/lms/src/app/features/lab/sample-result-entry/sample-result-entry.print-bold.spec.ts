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
  const confirmSpy = vi.fn(async (_req: any) => !!opts.confirm);
  const dialog = {
    confirm: vi.fn(async (req: any) => /fields are empty|no value/.test(req?.title ?? '') ? true : confirmSpy(req)),
    prompt: vi.fn(),
  };
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
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api, dialog: { ...dialog, confirm: confirmSpy } };
}

const picks = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLInputElement>('input.pf-sre__printpick')).map(i => i.checked);
const boldBtn = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLButtonElement>(`[data-sre-bold="ot1::${name}"]`);
const field = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLInputElement>(`[data-sre-field="ot1::${name}"]`)!;

describe('Result entry — print picker "Start with: None ticked"', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('never picked + none → every value starts UNTICKED, and no inline warning is rendered', async () => {
    const { el } = await render(sampleFixture());
    expect(picks(el)).toEqual([false, false]);
    expect(el.querySelector('.pf-sre__nothing-prints')).toBeNull();
    expect(el.querySelector('.pf-sre__grow-warn')).toBeNull();
    expect(el.textContent).not.toContain('will print');
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

  // ── A CRITICAL value always prints (owner 2026-10-01) ─────────────────
  const criticalResult = () => JSON.stringify({
    values: { Hb: 20, PCV: 40 },
    flagged: { Hb: { value: 20, flag: 'CH' }, PCV: { value: 40, flag: 'N' } },
  });

  it('never picked + none, but Hb is CRITICAL → Hb still starts ticked; PCV (not critical) stays unticked', async () => {
    const { el } = await render(sampleFixture({ currentResult: criticalResult() }));
    expect(picks(el)).toEqual([true, false]);
  });

  it('a SAVED pick hiding BOTH is overridden for the critical one', async () => {
    const { el } = await render(sampleFixture({ currentResult: criticalResult(), reportHiddenJson: '["Hb","PCV"]' }));
    expect(picks(el)).toEqual([true, false]);
  });

  it('the critical checkbox is disabled — the tech cannot untick it, and no request is sent', async () => {
    const { el, api } = await render(sampleFixture({ currentResult: criticalResult() }));
    const boxes = Array.from(el.querySelectorAll<HTMLInputElement>('input.pf-sre__printpick'));
    expect(boxes[0].disabled).toBe(true);
    expect(boxes[1].disabled).toBe(false);
    boxes[0].dispatchEvent(new Event('change'));
    expect(api.put).not.toHaveBeenCalled();
  });

  // Critic P1-4: the Conditions engine can mark the WHOLE result critical
  // (flags.critical) with no single parameter carrying CL/CH (e.g. a
  // qualitative "Positive") — every value on the line must still print.
  const overallCriticalResult = () => JSON.stringify({
    values: { Hb: 20, PCV: 40 },
    flagged: { Hb: { value: 20, flag: 'A' }, PCV: { value: 40, flag: 'N' } },
    flags: { critical: true },
  });

  it('a whole-line critical with no per-parameter CL/CH prints every value and disables every checkbox', async () => {
    const { el } = await render(sampleFixture({ currentResult: overallCriticalResult() }));
    expect(picks(el)).toEqual([true, true]);
    const boxes = Array.from(el.querySelectorAll<HTMLInputElement>('input.pf-sre__printpick'));
    expect(boxes.every(b => b.disabled)).toBe(true);
  });

  it('submitting when NOTHING at all prints asks once (DialogService); Go back sends nothing', async () => {
    const { el, f, c, api, dialog } = await render(sampleFixture());
    c.setValue('ot1', 'Hb', 13);
    f.detectChanges();
    expect(picks(el)).toEqual([true, false]);            // auto-ticked
    el.querySelector<HTMLInputElement>('input.pf-sre__printpick')!.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(picks(el)).toEqual([false, false]);           // the tech unticked it
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

const hiddenPuts = (api: any) => api.put.mock.calls
  .filter(([u]: [string]) => u === '/api/results/ot1/report-hidden')
  .map(([, b]: [string, any]) => b.hidden);
const typeInto = (f: any, el: HTMLElement, name: string, v: string) => {
  const i = field(el, name);
  i.value = v;
  i.dispatchEvent(new Event('input'));
  f.detectChanges();
};

describe('Result entry — entering a value ticks its print box (owner 2026-09-30)', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('typing a value ticks that row (and saves it); more keystrokes send nothing new', async () => {
    const { el, f, api } = await render(sampleFixture());
    typeInto(f, el, 'Hb', '1');
    expect(picks(el)).toEqual([true, false]);
    expect(hiddenPuts(api)).toEqual([['PCV']]);
    typeInto(f, el, 'Hb', '13');
    typeInto(f, el, 'Hb', '13.5');
    expect(hiddenPuts(api)).toEqual([['PCV']]);
    expect(el.querySelector('.pf-sre__nothing-prints, .pf-sre__grow-warn')).toBeNull();
  });

  it('a dropdown / option-table pick and a multi-select pick tick too', async () => {
    const { el, f, c } = await render(sampleFixture());
    c.onSelectChange('ot1', 'Hb', 'Positive');
    c.onMultiSelectChange('ot1', 'PCV', ['Pus cells', 'RBC']);
    f.detectChanges();
    expect(picks(el)).toEqual([true, true]);
  });

  it('a hand untick on a row with a value is respected — later keystrokes never re-tick it', async () => {
    const { el, f, api } = await render(sampleFixture());
    typeInto(f, el, 'Hb', '12');
    el.querySelector<HTMLInputElement>('input.pf-sre__printpick')!.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(picks(el)).toEqual([false, false]);
    typeInto(f, el, 'Hb', '12.4');
    typeInto(f, el, 'Hb', '12.45');
    expect(picks(el)).toEqual([false, false]);
    expect(hiddenPuts(api).at(-1)).toEqual(['PCV', 'Hb']);
    // …until the value is cleared and entered again.
    typeInto(f, el, 'Hb', '');
    expect(picks(el)).toEqual([false, false]);
    typeInto(f, el, 'Hb', '9');
    expect(picks(el)).toEqual([true, false]);
  });

  it('clearing an AUTO-ticked row unticks it; clearing a HAND-ticked row keeps it ticked', async () => {
    const { el, f, api } = await render(sampleFixture());
    typeInto(f, el, 'Hb', '12');
    typeInto(f, el, 'Hb', '');
    expect(picks(el)).toEqual([false, false]);
    expect(hiddenPuts(api).at(-1)).toEqual(['PCV', 'Hb']);
    // PCV ticked by hand first, then a value typed and cleared.
    el.querySelectorAll<HTMLInputElement>('input.pf-sre__printpick')[1].dispatchEvent(new Event('change'));
    f.detectChanges();
    typeInto(f, el, 'PCV', '40');
    typeInto(f, el, 'PCV', '');
    expect(picks(el)).toEqual([false, true]);
  });

  it('"All ticked": entering / clearing values is a no-op (no request)', async () => {
    const { el, f, api } = await render(sampleFixture({ printPickerDefault: 'all' }));
    typeInto(f, el, 'Hb', '12');
    typeInto(f, el, 'Hb', '');
    expect(picks(el)).toEqual([true, true]);
    expect(hiddenPuts(api)).toEqual([]);
  });

  it('a SAVED pick wins on reload: loading values never moves a tick, and editing a saved value does not re-tick it', async () => {
    const cur = JSON.stringify({ values: { Hb: 13, PCV: 40 } });
    const { el, f, api } = await render(sampleFixture({ reportHiddenJson: '["Hb"]', currentResult: cur }));
    expect(picks(el)).toEqual([false, true]);
    expect(hiddenPuts(api)).toEqual([]);
    typeInto(f, el, 'Hb', '13.2');
    expect(picks(el)).toEqual([false, true]);
    expect(hiddenPuts(api)).toEqual([]);
  });

  it('the picker off → entering values never touches report-hidden', async () => {
    const { el, f, api } = await render(sampleFixture({ printPicker: false }, PARAMS({ printPicker: false })));
    expect(picks(el)).toEqual([]);
    typeInto(f, el, 'Hb', '12');
    expect(hiddenPuts(api)).toEqual([]);
  });

  it('quick ticks save in order: one request per line in flight, then the LATEST list', async () => {
    const { el, f, api } = await render(sampleFixture());
    const pending: Subject<{}>[] = [];
    api.put.mockImplementation(() => { const s = new Subject<{}>(); pending.push(s); return s; });
    typeInto(f, el, 'Hb', '12');
    typeInto(f, el, 'PCV', '40');
    expect(hiddenPuts(api)).toEqual([['PCV']]);          // second waits
    pending[0].next({}); pending[0].complete();
    expect(hiddenPuts(api)).toEqual([['PCV'], []]);      // latest state follows
  });

  it('Submit waits for the print choices in flight (the final report reads the SAVED list) — logic audit', async () => {
    const { el, f, c, api } = await render(sampleFixture());
    const pending: Subject<{}>[] = [];
    api.put.mockImplementation(() => { const s = new Subject<{}>(); pending.push(s); return s; });
    typeInto(f, el, 'Hb', '12');
    typeInto(f, el, 'PCV', '40');                        // queued behind the first save
    const submitted = c.submitAll();
    await new Promise(r => setTimeout(r, 0));
    expect(api.post.mock.calls.some(([u]) => u === '/api/samples/smp-1/results')).toBe(false);
    pending[0].next({}); pending[0].complete();          // first lands → the LATEST list goes out
    await new Promise(r => setTimeout(r, 0));
    expect(api.post.mock.calls.some(([u]) => u === '/api/samples/smp-1/results')).toBe(false);
    pending[1].next({}); pending[1].complete();          // every print choice saved
    await submitted;
    expect(api.post.mock.calls.some(([u]) => u === '/api/samples/smp-1/results')).toBe(true);
  });

  it('one ticked value anywhere → Submit asks nothing', async () => {
    const { c, api, dialog } = await render(sampleFixture());
    c.setValue('ot1', 'Hb', 13);
    await c.submitAll();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.post.mock.calls.some(([u]) => u === '/api/samples/smp-1/results')).toBe(true);
  });

  it('a tube line WITHOUT the picker prints → no dialog even when the picker line prints nothing', async () => {
    const smp = sampleFixture();
    smp.tests.push({
      id: 'ot2', subOrderId: 'smp-1', testId: 't2', name: 'ESR', status: 'in_progress', printPicker: false,
      test: { id: 't2', name: 'ESR', parameters: JSON.stringify({ parameters: [{ name: 'ESR', type: 'numeric' }] }) },
    });
    const { el, f, c, dialog } = await render(smp);
    typeInto(f, el, 'Hb', '12');
    el.querySelector<HTMLInputElement>('input.pf-sre__printpick')!.dispatchEvent(new Event('change'));
    c.setValue('ot2', 'ESR', 10);
    f.detectChanges();
    await c.submitAll();
    expect(dialog.confirm).not.toHaveBeenCalled();
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
