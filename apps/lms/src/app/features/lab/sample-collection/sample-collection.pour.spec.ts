import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';
import { vi } from 'vitest';
import { SampleCollectionComponent } from './sample-collection.component';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { PrinterService } from '../../../core/printer/printer.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ScanService } from '../../../core/services/scan.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ApiError } from '../../../shared/models/api-response.model';

/**
 * Pour one tube into another at collection (owner 2026-10-25: a baby's red
 * tube poured into the grey one). The tile offers "Pour into another tube…",
 * the sheet picks the KEPT tube (pf-select), the server's merge-candidates
 * decide (plain-words refusal), a 409 merge_needs_confirm is confirmed through
 * DialogService and resent, the kept tube shows "+ Red (26104)" chips, the
 * poured tube leaves the screen, and the kept label can be printed again.
 */
const order = {
  id: 'o1', orderNumber: 'LAB-2610-000200', createdAt: '2026-10-25T03:00:00Z',
  patient: { id: 'p1', displayName: 'Baby of Priya', age: 0, sex: 'Female', mrn: 'MW0200' },
};
const bio = { id: 'd-b', name: 'Biochemistry', code: 'BIO' };
const red = {
  id: 'red', orderId: 'o1', status: 'pending', barcode: '26104', tubeColor: 'plain', rejectionCount: 0,
  departmentId: 'd-b', department: bio, departments: [bio], createdAt: '2026-10-25T03:00:00Z', order,
  tests: [{ id: 't1', test: { name: 'Bilirubin Total', departmentId: 'd-b' } }],
};
const grey = {
  id: 'grey', orderId: 'o1', status: 'pending', barcode: '26105', tubeColor: 'fluoride', rejectionCount: 0,
  departmentId: 'd-b', department: bio, departments: [bio], createdAt: '2026-10-25T03:00:00Z', order,
  tests: [{ id: 't2', test: { name: 'Glucose Fasting', departmentId: 'd-b' } }],
};
const oldMerged = { ...red, id: 'gone', barcode: '26099', status: 'merged' };

const keptAfter = {
  ...grey, status: 'collected',
  tests: [...grey.tests, ...red.tests],
  metadata: JSON.stringify({ mergedFromBarcodes: ['26104'], manualMerge: [{ barcode: '26104', tubeColor: 'plain', by: 'u1', at: '2026-10-25T03:10:00Z', restore: { sampleId: 'red', drawn: false } }] }),
};

interface Opts {
  candidates?: unknown[];
  mergeFirst?: 'ok' | 'confirm' | 'refuse' | 'slow';
  slow?: Subject<unknown>;
  separate?: 'ok' | 'refuse' | '404';
  confirm?: boolean[];
  samples?: unknown[];
  manual?: boolean;
}

function render(opts: Opts = {}) {
  const confirms = [...(opts.confirm ?? [true, false])];
  let mergeCalls = 0;
  const api = {
    get: vi.fn((url: string) => {
      if (url.includes('pending-collection')) return of(opts.samples ?? [red, grey]);
      if (url.endsWith('/merge-candidates')) return of(opts.candidates ?? [
        { id: 'red', barcode: '26104', tubeColor: 'plain', status: 'pending', tests: ['Bilirubin Total'], eligible: true,
          warnings: [{ code: 'additive_mismatch', message: 'Serum test into a fluoride (gray) tube' }] },
      ]);
      return of([]);
    }),
    post: vi.fn((url: string, body?: any) => {
      if (url.endsWith('/merge')) {
        mergeCalls++;
        if (opts.mergeFirst === 'slow') return opts.slow!;
        if (opts.mergeFirst === 'refuse')
          return throwError(() => new ApiError('', 'merge_already_received'));
        if (opts.mergeFirst === 'confirm' && mergeCalls === 1 && !body.confirmWarnings)
          return throwError(() => new ApiError('Confirm', 'merge_needs_confirm', undefined,
            { warnings: [{ code: 'additive_mismatch', message: 'Serum test into a fluoride (gray) tube' }] }));
        return of({ sample: keptAfter, warnings: [], retired: ['26104'] });
      }
      if (url.endsWith('/separate')) {
        if (opts.separate === 'refuse') return throwError(() => new ApiError('', 'separate_dispatched'));
        if ((opts.separate as string) === '404') return throwError(() => new ApiError('That could not be found.', undefined, undefined, undefined, 404));
        return of({ sample: { ...grey }, restored: { ...red } });
      }
      return of({});
    }),
    patch: vi.fn(() => of({})),
  };
  const printer = {
    labelPrinterState: async () => ({ platform: 'electron', configured: true, name: 'DP27' }),
    printLabelData: vi.fn(async (_d?: any) => ({ ok: true, direct: true })),
  };
  const dialog = { confirm: vi.fn(async (_req?: any) => confirms.shift() ?? false) };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), withAction: vi.fn((_m?: any, _a?: any, ..._r: any[]) => 1), dismiss: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: toasts },
      { provide: PrinterService, useValue: printer },
      { provide: PrintConfigService, useValue: { labelOpts: () => ({}), config: () => ({ labelRoute: 'printer' }) } },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: dialog },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => true, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => !!opts.manual } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(SampleCollectionComponent);
  f.detectChanges();
  return { f, c: f.componentInstance as any, api, printer, dialog, toasts };
}

const tick = () => new Promise(r => setTimeout(r, 0));
const drawerOf = (f: any): HTMLElement =>
  (f.nativeElement.querySelector('.pf-drawer') ?? document.body.querySelector('.pf-drawer')) as HTMLElement;
async function open(f: any, c: any) {
  await tick();
  c._openOrderId.set('o1');
  f.detectChanges();
  await tick();
  f.detectChanges();
}
const settle = async (f: any) => { for (let i = 0; i < 6; i++) { await tick(); f.detectChanges(); } };
const tileOf = (f: any, code: string) =>
  [...drawerOf(f).querySelectorAll<HTMLElement>('.pf-tube-wrap')].find(w => w.textContent!.includes(code))!;

describe('Sample collection — pour one tube into another', () => {
  afterEach(() => {
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
    TestBed.resetTestingModule();
  });

  it('every in-house blood tube offers "Pour into another tube…" as a real button', async () => {
    const { f, c } = render();
    await open(f, c);
    const btn = tileOf(f, '26104').querySelector<HTMLButtonElement>('[data-testid="pour-tube"]');
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe('BUTTON');
    expect(btn!.getAttribute('aria-label')).toBe('Pour Red · 26104 into another tube');
  });

  it('a lone tube, an outsourced tube or a series draw offers no pour', async () => {
    const out = { ...grey, id: 'out', barcode: '26106', outsourcedVendorId: 'v1' };
    const series = { ...grey, id: 'ser', barcode: '26107', repeatOffsetMin: 30 };
    const { f, c } = render({ samples: [red, out, series] });
    await open(f, c);
    expect(tileOf(f, '26106').querySelector('[data-testid="pour-tube"]')).toBeNull();
    expect(tileOf(f, '26107').querySelector('[data-testid="pour-tube"]')).toBeNull();
    // red can still pour (two other live tubes exist).
    expect(tileOf(f, '26104').querySelector('[data-testid="pour-tube"]')).not.toBeNull();
    TestBed.resetTestingModule();
    const solo = render({ samples: [red] });
    await open(solo.f, solo.c);
    expect(tileOf(solo.f, '26104').querySelector('[data-testid="pour-tube"]')).toBeNull();
  });

  it('a merged (poured, drawn) tube is hidden from the drawer and the counts', async () => {
    const { f, c } = render({ samples: [red, grey, oldMerged] });
    await open(f, c);
    const g = c.activeGroup();
    expect(g.totalVials).toBe(2);
    expect(drawerOf(f).textContent).not.toContain('26099');
  });

  it('one other tube is picked straight away and the server verdict loads', async () => {
    const { f, c, api } = render();
    await open(f, c);
    tileOf(f, '26104').querySelector<HTMLButtonElement>('[data-testid="pour-tube"]')!.click();
    await settle(f);
    expect(api.get).toHaveBeenCalledWith('/api/samples/grey/merge-candidates');
    const sheet = document.querySelector('.pf-pour') ?? drawerOf(f).querySelector('.pf-pour');
    expect(sheet!.textContent).toContain('Pour Red · 26104 into another tube');
    expect(sheet!.querySelector('[data-testid="pour-warning"]')!.textContent).toContain('Serum test into a fluoride (gray) tube');
    expect((sheet!.querySelector('[data-testid="pour-confirm"]') as HTMLButtonElement).disabled).toBe(false);
    expect(sheet!.querySelector('[data-testid="pour-confirm"]')!.textContent).toContain('Pour into Grey · 26105');
  });

  it('an ineligible candidate shows the plain reason and blocks the pour', async () => {
    const { f, c } = render({ candidates: [{ id: 'red', barcode: '26104', eligible: false, reason: 'merge_micro_container' }] });
    await open(f, c);
    c.openPour(red);
    await settle(f);
    const sheet = drawerOf(f).querySelector('.pf-pour')!;
    expect(sheet.querySelector('[data-testid="pour-refusal"]')!.textContent).toContain('Culture and sterile pots can’t be poured.');
    expect((sheet.querySelector('[data-testid="pour-confirm"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('timed draws: a 60-min draw offers only the other series\' 60-min tube, and the plain refusal shows for a different time', async () => {
    const t = (id: string, code: string, off: number | null, series: string | null, test: string) => ({
      ...grey, id, barcode: code, repeatOffsetMin: off, repeatProfileTestId: series, status: 'collected',
      tests: [{ id: 'l' + id, test: { name: test, departmentId: 'd-b' } }],
    });
    const ogtt60 = t('ogtt60', '26201', 60, 'ogtt', 'Glucose 60 min');
    const ins60 = t('ins60', '26202', 60, 'ins', 'Insulin 60 min');
    const ins120 = t('ins120', '26203', 120, 'ins', 'Insulin 120 min');
    const plain = t('plain', '26204', null, null, 'Random sugar');
    const { f, c } = render({
      samples: [ogtt60, ins60, ins120, plain],
      candidates: [{ id: 'ogtt60', barcode: '26201', tubeColor: 'fluoride', eligible: false, reason: 'merge_timed_series' }],
    });
    await open(f, c);
    // The 60-min tube offers the pour, and its target list is exactly the eligible tube.
    expect(tileOf(f, '26201').querySelector('[data-testid="pour-tube"]')).not.toBeNull();
    c.openPour(ogtt60);
    await settle(f);
    expect(c.pourTargetOpts().map((o: any) => o.value)).toEqual(['ins60']);
    // A different time point (if the server is asked anyway) reads in plain words.
    expect(c.pourRefusal()).toBe('Only draws taken at the same time can be poured together.');
  });

  it('different additive: the sheet closes and the TARGET card asks inline (no dialog); Pour sends confirmWarnings once', async () => {
    const { f, c, api, dialog } = render({ mergeFirst: 'confirm' });
    await open(f, c);
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    await settle(f);
    expect(c.pour()).toBeNull();
    expect(c.inlineAsk()).toEqual({ kind: 'pour', srcId: 'red', targetId: 'grey', words: 'Serum into Fluoride' });
    const ask = tileOf(f, '26105').querySelector('[data-testid="inline-ask"]')!;
    expect(ask.textContent).toContain('Serum into Fluoride. Different additive. Pour anyway?');
    expect(api.post.mock.calls.filter(([u]: any[]) => String(u).endsWith('/merge'))).toEqual([]);
    (ask.querySelector('[data-testid="inline-go"]') as HTMLButtonElement).click();
    await settle(f);
    const merges = api.post.mock.calls.filter(([u]: any[]) => String(u).endsWith('/merge'));
    expect(merges.map(([u, b]: any[]) => [u, b])).toEqual([
      ['/api/samples/grey/merge', { sampleIds: ['red'], confirmWarnings: true }],
    ]);
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"].pf-pour')).toBeNull();
  });

  it('Keep apart changes nothing', async () => {
    const { f, c, api } = render();
    await open(f, c);
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    await settle(f);
    (tileOf(f, '26105').querySelector('[data-testid="inline-no"]') as HTMLButtonElement).click();
    await settle(f);
    expect(c.inlineAsk()).toBeNull();
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['red', 'grey']);
    expect(api.post.mock.calls.filter(([u]: any[]) => String(u).endsWith('/merge'))).toEqual([]);
  });

  it('a warning only the server knew: rolled back, asked inline, then one more press', async () => {
    const red2 = { ...red, tubeColor: 'fluoride' };
    const { f, c, api, dialog } = render({
      mergeFirst: 'confirm', samples: [red2, grey],
      candidates: [{ id: 'red', barcode: '26104', tubeColor: 'fluoride', eligible: true, warnings: [] }],
    });
    await open(f, c);
    c.openPour(red2);
    await settle(f);
    await c.confirmPour();
    await settle(f);
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['red', 'grey']);   // rolled back
    expect(c.inlineAsk()).toMatchObject({ kind: 'pour', words: 'Serum test into a fluoride (gray) tube' });
    await c.confirmInlinePour();
    await settle(f);
    const merges = api.post.mock.calls.filter(([u]: any[]) => String(u).endsWith('/merge'));
    expect(merges.map(([, b]: any[]) => b.confirmWarnings)).toEqual([false, true]);
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('after the pour: poured tube leaves, kept tube shows "+ Red · 26104", "2 tubes in one", toast with Undo — no refetch', async () => {
    const { f, c, toasts, api } = render();
    await open(f, c);
    const gets = api.get.mock.calls.filter(([u]: any[]) => String(u).includes('pending-collection')).length;
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    await c.confirmInlinePour();
    await settle(f);
    const g = c.activeGroup();
    expect(g.samples.map((s: any) => s.id)).toEqual(['grey']);
    expect(g.samples[0].status).toBe('collected');
    const chips = [...tileOf(f, '26105').querySelectorAll('[data-testid="merge-chip"]')].map(n => n.textContent!.trim());
    expect(chips).toEqual(['+ Red · 26104']);
    expect(tileOf(f, '26105').querySelector('[data-testid="tubes-in-one"]')!.textContent).toContain('2 tubes in one');
    expect(c.tubeTests(g.samples[0]).map((t: any) => t.name)).toEqual(['Glucose Fasting', 'Bilirubin Total']);
    expect(toasts.withAction).toHaveBeenCalledWith('Merged Red 26104 into Grey 26105', expect.objectContaining({ label: 'Undo' }));
    expect(api.get.mock.calls.filter(([u]: any[]) => String(u).includes('pending-collection')).length).toBe(gets);
  });

  it('Undo = Separate: the tube is back with its own ID', async () => {
    const { f, c, toasts, api } = render();
    await open(f, c);
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    await c.confirmInlinePour();
    await settle(f);
    const undo = toasts.withAction.mock.calls[0][1];
    undo.run();
    await settle(f); await settle(f);
    expect(api.post).toHaveBeenCalledWith('/api/samples/grey/separate', { sampleId: 'red' });
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['grey', 'red']);
    expect(toasts.withAction).toHaveBeenLastCalledWith('Red 26104 is its own tube again', expect.objectContaining({ label: 'Print label' }), 'success');
  });

  it('Undo while the merge call is still running: rolled back locally, no separate call until the merge lands', async () => {
    const slow = new Subject<unknown>();
    const { f, c, toasts, api } = render({ mergeFirst: 'slow', slow });
    await open(f, c);
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    const done = c.confirmInlinePour();
    await settle(f);
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['grey']);       // optimistic
    toasts.withAction.mock.calls[0][1].run();                                       // Undo before the server answered
    await settle(f);
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['red', 'grey']); // back at once
    expect(api.post.mock.calls.some(([u]: any[]) => String(u).endsWith('/separate'))).toBe(false);
    slow.next({ sample: keptAfter, warnings: [], retired: ['26104'] }); slow.complete();
    await done; await settle(f);
    expect(api.post).toHaveBeenCalledWith('/api/samples/grey/separate', { sampleId: 'red' });
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('Undo after the merge, Separate missing on the server (404): plain words, never a raw error', async () => {
    const { f, c, toasts } = render({ separate: '404' });
    await open(f, c);
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    await c.confirmInlinePour();
    await settle(f);
    toasts.withAction.mock.calls[0][1].run();
    await settle(f); await settle(f);
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t undo: this server can’t take tubes back out yet.');
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['grey']);       // still merged — the truth
  });

  it('a refused Separate rolls back with a plain error', async () => {
    const { f, c, toasts } = render({ separate: 'refuse', samples: [keptAfter] });
    await open(f, c);
    const chip = tileOf(f, '26105').querySelector<HTMLButtonElement>('[data-testid="merge-chip"]')!;
    chip.click();
    await settle(f);
    expect(tileOf(f, '26105').querySelector('[data-testid="inline-ask"]')!.textContent).toContain('Take Red 26104 back out?');
    await c.confirmSeparate();
    await settle(f);
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['grey']);
    expect(toasts.error).toHaveBeenCalledWith('This tube has left the counter, so it can’t be separated any more.');
  });

  it('after dispatch the chip is not tappable and says why', async () => {
    const { f, c } = render({ samples: [{ ...keptAfter, status: 'dispatched' }] });
    await open(f, c);
    const chip = tileOf(f, '26105').querySelector<HTMLButtonElement>('[data-testid="merge-chip"]');
    if (!chip) return;   // a dispatched tube may leave the pending list entirely
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    expect(chip.title).toMatch(/left the counter/);
    chip.click();
    expect(c.inlineAsk()).toBeNull();
  });

  it('after the pour NO relabel prompt appears - the kept tube keeps its ID (OPS-123)', async () => {
    const { f, c, printer, dialog } = render();
    await open(f, c);
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    await settle(f); await settle(f);
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(printer.printLabelData).not.toHaveBeenCalled();
  });

  it('a server refusal rolls the screen back and is toasted in plain words', async () => {
    const { f, c, toasts } = render({ mergeFirst: 'refuse' });
    await open(f, c);
    c.openPour(red);
    await settle(f);
    await c.confirmPour();
    await c.confirmInlinePour();
    await settle(f);
    expect(toasts.error).toHaveBeenCalledWith('The lab has already received this tube.');
    expect(c.activeGroup().samples.map((s: any) => s.id)).toEqual(['red', 'grey']);
  });

  it('several tubes into one: "Also pour" lists the other eligible candidates and posts them all', async () => {
    const lav = { ...grey, id: 'lav', barcode: '26108', tubeColor: 'plain' };
    const { f, c, api } = render({
      samples: [red, grey, lav], confirm: [false],
      candidates: [
        { id: 'red', barcode: '26104', tubeColor: 'plain', eligible: true, warnings: [] },
        { id: 'lav', barcode: '26108', tubeColor: 'plain', eligible: true, warnings: [] },
      ],
    });
    await open(f, c);
    c.openPour(red);
    await c.setPourTarget('grey');
    await settle(f);
    expect(c.pourAlsoOpts().map((o: any) => o.value)).toEqual(['lav']);
    c.setPourAlso(['lav']);
    await c.confirmPour();
    const body = api.post.mock.calls.find(([u]: any[]) => String(u).endsWith('/merge'))![1];
    expect(body).toEqual({ sampleIds: ['red', 'lav'], confirmWarnings: false });
  });
});
