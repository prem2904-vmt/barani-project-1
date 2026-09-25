import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
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

/**
 * Collect-sample flow in the new-design language: ONLY the main call to
 * action is primary; the full-screen drawer hides the app bar while open.
 */
function make(perms: string[] = [], dispatchStep = false, pending: any[] = []) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn((url: string) => of(url.includes('pending-collection') ? pending : [])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) } },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p), user: () => null } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: {} },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => dispatchStep, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });
  return TestBed.runInInjectionContext(() => new SampleCollectionComponent()) as any;
}

/** Rendered drawer (it teleports itself to <body>). */
async function renderDrawer(samples: any[]) {
  make([], false, samples);
  const f = TestBed.createComponent(SampleCollectionComponent);
  const c = f.componentInstance as any;
  c.embedded = true;
  f.detectChanges();
  await new Promise(r => setTimeout(r, 0));   // ngOnInit loads the queue
  c._openOrderId.set('o1');
  f.detectChanges();
  await new Promise(r => setTimeout(r, 0));   // teleport happens in a microtask
  f.detectChanges();
  const drawer = document.body.querySelector('.pf-drawer') as HTMLElement;
  return { f, c, drawer };
}

const S = (id: string, status = 'pending', extra: any = {}) =>
  ({ id, orderId: 'o1', status, barcode: 'B-' + id, specimenType: 'Serum', department: 'BIO', tests: [{ test: { name: 'Glucose' } }], createdAt: '2026-09-25T00:00:00Z', order: { orderNumber: 'LAB-1', patient: { displayName: 'P' } }, ...extra });
const G = (samples: any[], extra: any = {}) => ({
  orderId: 'o1', orderNo: 'LAB-1', patientName: 'P', patientMeta: '', createdAt: '', samples,
  totalVials: samples.length, collected: samples.filter(s => s.status !== 'pending').length, paymentHold: false, ...extra });

describe('Collect sample — colour discipline (primary only on the main CTA)', () => {
  it('"Collect all to finish" (disabled) is NOT primary', () => {
    const c = make();
    const g = G([S('a'), S('b', 'collected')]);
    expect(c.doneLabel(g)).toBe('Collect all to finish');
    expect(c.finishIsPrimary(g)).toBe(false);
  });

  it('finish becomes the primary CTA once every vial is drawn and nothing else is offered', () => {
    const c = make();
    const g = G([S('a', 'collected'), S('b', 'collected')]);
    expect(c.dispatchCtaShown(g)).toBe(false);
    expect(c.finishIsPrimary(g)).toBe(true);
  });

  it('when Dispatch is the call to action, finish steps down to secondary', () => {
    const c = make(['dispatch_sample'], true);
    const g = G([S('a', 'collected')]);
    expect(c.dispatchCtaShown(g)).toBe(true);
    expect(c.finishIsPrimary(g)).toBe(false);
  });

  it('a payment hold offers Bill (primary) to billers; finish stays secondary', () => {
    const c = make(['create_bill'], true);
    const g = G([S('a', 'collected')], { paymentHold: true });
    expect(c.dispatchCtaShown(g)).toBe(true);
    expect(c.finishIsPrimary(g)).toBe(false);
  });
});

describe('Collect sample — full-screen flow hides the app bar', () => {
  afterEach(() => document.documentElement.classList.remove('pf-collect-immersive'));

  it('html.pf-collect-immersive is set while the drawer is open and removed on close / destroy', () => {
    const c = make();
    c._pending.set([S('a')]);
    c._openOrderId.set('o1');
    TestBed.tick();
    expect(document.documentElement.classList).toContain('pf-collect-immersive');
    c._openOrderId.set(null);
    TestBed.tick();
    expect(document.documentElement.classList).not.toContain('pf-collect-immersive');
    c._openOrderId.set('o1');
    TestBed.tick();
    expect(document.documentElement.classList).toContain('pf-collect-immersive');
    c.ngOnDestroy();
    expect(document.documentElement.classList).not.toContain('pf-collect-immersive');
  });
});

describe('Collect sample — rendered in the new-design language', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pf-collect-immersive');
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
  });

  it('drawer carries the theme-token class and the phone grid class', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b')]);
    expect(drawer).not.toBeNull();
    expect(drawer.classList).toContain('pf-drawer--nd');
    expect(drawer.querySelector('.pf-drawer__tubes')!.classList).toContain('pf-drawer__tubes--grid');
  });

  it('secondary actions are neutral (ghost); the disabled finish is not primary', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b')]);
    const foot = drawer.querySelector('.pf-drawer__foot') as HTMLElement;
    const cant = foot.querySelector('[aria-label="Can\'t collect"]') as HTMLElement;
    expect(cant.classList).toContain('pf-btn-ghost');
    expect(cant.classList).not.toContain('pf-btn-primary');
    const finish = foot.querySelector('.pf-drawer__finish') as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(finish.classList).not.toContain('pf-btn-primary');
    expect(foot.querySelectorAll('.pf-btn-primary').length).toBe(0);
  });

  it('when every vial is drawn, the finish button is the ONE primary', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected')]);
    const primaries = drawer.querySelectorAll('.pf-drawer__foot .pf-btn-primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].classList).toContain('pf-drawer__finish');
  });

  it('the counter re-renders its tick element with the drawn count', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected'), S('b')]);
    expect(drawer.querySelector('.pf-drawer__progress-num .pf-tick')?.textContent).toBe('1');
  });
});
