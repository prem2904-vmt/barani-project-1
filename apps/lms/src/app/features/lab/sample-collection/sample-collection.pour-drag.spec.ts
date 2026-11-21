import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
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
 * DRAG a tube onto another to pour it (owner 2026-10-25), on top of the
 * pour sheet below. Original sheet doc: pour one tube into another at collection (owner 2026-10-25: a baby's red
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
  metadata: JSON.stringify({ mergedFromBarcodes: ['26104'], manualMerge: [{ barcode: '26104', tubeColor: 'plain', by: 'u1', at: '2026-10-25T03:10:00Z' }] }),
};

interface Opts {
  candidates?: unknown[];
  mergeFirst?: 'ok' | 'confirm' | 'refuse';
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
        if (opts.mergeFirst === 'refuse')
          return throwError(() => new ApiError('', 'merge_already_received'));
        if (opts.mergeFirst === 'confirm' && mergeCalls === 1 && !body.confirmWarnings)
          return throwError(() => new ApiError('Confirm', 'merge_needs_confirm', undefined,
            { warnings: [{ code: 'additive_mismatch', message: 'Serum test into a fluoride (gray) tube' }] }));
        return of({ sample: keptAfter, warnings: [], retired: ['26104'] });
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
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
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


const ev = (el: HTMLElement, x: number, y: number, pointerType = 'mouse') =>
  ({ pointerId: pointerType === 'touch' ? 7 : 1, pointerType, button: 0, clientX: x, clientY: y, currentTarget: el }) as any;
const sampleOf = (c: any, id: string) => c.activeGroup().samples.find((s: any) => s.id === id);
const tubeEl = (f: any, code: string) => tileOf(f, code).querySelector<HTMLElement>('.pf-tube')!;
/** Point "under the pointer" at a tile (jsdom has no layout). */
function pointAt(el: HTMLElement | null) {
  (document as any).elementFromPoint = () => el ?? document.body;
}
const sheetOf = (f: any) => drawerOf(f).querySelector('.pf-pour');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Sample collection — drag a tube onto another to pour it', () => {
  afterEach(() => {
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
    delete (document as any).elementFromPoint;
    try { localStorage.removeItem('pf.collect.pourDragHint'); } catch { /* */ }
    TestBed.resetTestingModule();
  });

  it('only pourable tubes are draggable (grip shown); outsourced tubes are not', async () => {
    const out = { ...grey, id: 'out', barcode: '26106', outsourcedVendorId: 'v1' };
    const { f, c } = render({ samples: [red, grey, out] });
    await open(f, c);
    expect(tubeEl(f, '26104').classList).toContain('pf-tube--draggable');
    expect(tubeEl(f, '26104').querySelector('.pf-tube__grip')).not.toBeNull();
    expect(tubeEl(f, '26106').classList).not.toContain('pf-tube--draggable');
    // A press on a non-pourable tube never starts the gesture.
    c.onVialDown(sampleOf(c, 'out'), ev(tubeEl(f, '26106'), 10, 10));
    expect(c.pourDrag.phase).toBe('idle');
    c.onVialUp();
  });

  it('shows the helper line until the first drag, then never again', async () => {
    const { f, c } = render();
    await open(f, c);
    expect(drawerOf(f).querySelector('[data-testid="pour-drag-hint"]')!.textContent)
      .toContain('Hold and drag a tube onto another to pour it in');
    pointAt(tubeEl(f, '26105'));
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10));
    c.pourDrag.move(ev(tubeEl(f, '26104'), 60, 10));
    c.pourDrag.cancel();
    await settle(f);
    expect(drawerOf(f).querySelector('[data-testid="pour-drag-hint"]')).toBeNull();
  });

  it('mouse: drag onto a tube with another additive turns it soft rose ("Serum into Fluoride · check"); the drop asks INLINE — nothing poured yet, no sheet', async () => {
    const { f, c, api } = render();
    await open(f, c);
    pointAt(tubeEl(f, '26105'));
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10));
    c.pourDrag.move(ev(tubeEl(f, '26104'), 80, 20));
    await settle(f);
    // Eligibility asked at drag start, for the target.
    expect(api.get).toHaveBeenCalledWith('/api/samples/grey/merge-candidates');
    expect(tubeEl(f, '26104').classList).toContain('pf-tube--pour-src');
    expect(tubeEl(f, '26105').classList).toContain('pf-tube--pour-ok');
    expect(tubeEl(f, '26105').classList).toContain('pf-tube--pour-over');
    expect(tubeEl(f, '26105').classList).toContain('pf-tube--pour-warn');
    expect(tubeEl(f, '26105').querySelector('[data-testid="drop-warn"]')!.textContent).toContain('Serum into Fluoride · check');
    const ghost = document.body.querySelector('[data-testid="pour-ghost"]')!;
    expect(ghost.textContent).toContain('Red · 26104');
    expect(ghost.textContent).toContain('Pour into Grey · 26105');
    c.pourDrag.up(ev(tubeEl(f, '26104'), 80, 20));
    await settle(f);
    expect(c.pour()).toBeNull();
    expect(c.inlineAsk()).toMatchObject({ kind: 'pour', srcId: 'red', targetId: 'grey', words: 'Serum into Fluoride' });
    expect(tileOf(f, '26105').querySelector('[data-testid="inline-ask"]')).not.toBeNull();
    // Never pours without the inline Pour.
    expect(api.post.mock.calls.filter(([u]: any[]) => String(u).endsWith('/merge')).length).toBe(0);
  });

  it('the click that trails a drop never also marks the tube drawn', async () => {
    const { f, c } = render();
    await open(f, c);
    const spy = vi.spyOn(c, 'toggleCollected');
    pointAt(tubeEl(f, '26104')); // dropped back on itself
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10));
    c.pourDrag.move(ev(tubeEl(f, '26104'), 60, 10));
    c.pourDrag.up(ev(tubeEl(f, '26104'), 60, 10));
    c.onVialClick(sampleOf(c, 'red'), new Event('click'));
    expect(spy).not.toHaveBeenCalled();
    expect(c.pour()).toBeNull();
  });

  it('a plain tap on a draggable tube still marks it drawn, exactly as before', async () => {
    const { f, c } = render();
    await open(f, c);
    const spy = vi.spyOn(c, 'toggleCollected');
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10));
    c.pourDrag.up(ev(tubeEl(f, '26104'), 10, 10));
    c.onVialUp();
    tubeEl(f, '26104').click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ id: 'red' });
  });

  it('an ineligible tube dims, names the reason while over it, and a drop there snaps back with nothing changed', async () => {
    const { f, c, api } = render({ candidates: [{ id: 'red', barcode: '26104', eligible: false, reason: 'merge_already_received' }] });
    await open(f, c);
    pointAt(tubeEl(f, '26105'));
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10));
    c.pourDrag.move(ev(tubeEl(f, '26104'), 80, 20));
    await settle(f);
    const t = tubeEl(f, '26105');
    expect(t.classList).toContain('pf-tube--pour-no');
    expect(t.querySelector('[data-testid="pour-drop-reason"]')!.textContent).toContain('Already received');
    expect(document.body.querySelector('[data-testid="pour-ghost"]')!.textContent).toContain('Can’t pour: Already received');
    c.pourDrag.up(ev(tubeEl(f, '26104'), 80, 20));
    await wait(260);
    await settle(f);
    expect(c.pour()).toBeNull();
    expect(c.dragSrc()).toBeNull();
    expect(document.body.querySelector('[data-testid="pour-ghost"]')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    expect(c.activeGroup().samples.map((s: any) => s.id).sort()).toEqual(['grey', 'red']);
  });

  it('a drop outside every tube snaps back with nothing changed', async () => {
    const { f, c, api } = render();
    await open(f, c);
    pointAt(null);
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10));
    c.pourDrag.move(ev(tubeEl(f, '26104'), 300, 500));
    await settle(f);
    expect(document.body.querySelector('[data-testid="pour-ghost"]')!.textContent).toContain('Drop it on another tube');
    c.pourDrag.up(ev(tubeEl(f, '26104'), 300, 500));
    await wait(260);
    await settle(f);
    expect(c.pour()).toBeNull();
    expect(c.dragSrc()).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('touch: a quick move is a scroll (no drag); hold ~260 ms then drag drops onto the target (inline ask)', async () => {
    const { f, c } = render();
    await open(f, c);
    pointAt(tubeEl(f, '26105'));
    // Flick before the hold: scroll wins.
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10, 'touch'));
    c.pourDrag.move(ev(tubeEl(f, '26104'), 10, 60, 'touch'));
    expect(c.pourDrag.phase).toBe('idle');
    expect(c.pourDrag.blocksTouchScroll()).toBe(false);
    c.onVialUp();
    // Hold, then drag.
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10, 'touch'));
    await wait(340);
    await settle(f);
    expect(c.pourDrag.phase).toBe('lifted');
    expect(c.pourDrag.blocksTouchScroll()).toBe(true);
    expect(tubeEl(f, '26104').classList).toContain('pf-tube--pour-lift');
    c.pourDrag.move(ev(tubeEl(f, '26104'), 90, 30, 'touch'));
    c.pourDrag.up(ev(tubeEl(f, '26104'), 90, 30, 'touch'));
    await settle(f);
    expect(c.inlineAsk()?.targetId ?? c.inlineAsk()?.keepId).toBe('grey');
  });

  it('the touch hold blocks the page scroll only while a tube is lifted', async () => {
    const { f, c } = render();
    await open(f, c);
    const mk = () => { const e = new Event('touchmove', { cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; };
    expect(mk()).toBe(false);
    c.onVialDown(sampleOf(c, 'red'), ev(tubeEl(f, '26104'), 10, 10, 'touch'));
    expect(mk()).toBe(false); // still could be a scroll
    await wait(340);
    expect(mk()).toBe(true);
    c.pourDrag.cancel();
    expect(mk()).toBe(false);
  });

  it('the "Pour into another tube…" button stays as the keyboard fallback', async () => {
    const { f, c } = render();
    await open(f, c);
    const btn = tileOf(f, '26104').querySelector<HTMLButtonElement>('[data-testid="pour-tube"]')!;
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    await settle(f);
    expect(c.pour()?.targetId).toBe('grey');
  });
});
