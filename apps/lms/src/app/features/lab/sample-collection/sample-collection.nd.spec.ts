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
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { signal } from '@angular/core';

/**
 * Collect-sample flow in the new-design language: ONLY the main call to
 * action is primary; the full-screen drawer hides the app bar while open.
 */
function make(perms: string[] = [], dispatchStep = false, pending: any[] = []) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn((url: string) => of(url.includes('pending-collection') ? pending : [])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) } },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p), user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: {} },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => dispatchStep, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
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
  ({ id, orderId: 'o1', status, barcode: 'B-' + id, specimenType: 'Serum', department: 'BIO', tests: [{ test: { name: 'Glucose' } }], createdAt: '2026-09-25T00:00:00Z', order: { orderNumber: 'LAB-2609-000085', patient: { id: 'p1', displayName: 'Ms. Paravai Munusamy', age: 44, sex: 'Female', mrn: 'AA0007' } }, ...extra });
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

describe('Collect sample — rendered on the nd pattern', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pf-collect-immersive');
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
  });

  it('band + two-card layout from the kit (nd-page, nd-body--split, VIALS + COLLECTION cards)', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b')]);
    expect(drawer.classList).toContain('pf-drawer--nd');
    expect(drawer.querySelector('pf-hero-band')).not.toBeNull();
    expect(drawer.querySelector('.nd-page')).not.toBeNull();
    const body = drawer.querySelector('.nd-body.nd-body--split') as HTMLElement;
    const cards = [...body.querySelectorAll(':scope > .nd-card')];
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.nd-card__label')?.textContent?.trim()).toBe('Vials');
    expect(cards[1].querySelector('.nd-card__label')?.textContent?.trim()).toBe('Collection');
    expect(cards[1].querySelector('.nd-card__foot')).not.toBeNull();
    // the old page header is gone
    expect(drawer.querySelector('.pf-drawer__head, .pf-drawer__hint')).toBeNull();
  });

  it('context bar: FULL patient name (no truncation), order ID, sample ID, filters, counter', async () => {
    const { drawer } = await renderDrawer([S('a')]);
    const ctx = drawer.querySelector('.pf-sc-ctx') as HTMLElement;
    const name = ctx.querySelector('.pf-sc-chip__name') as HTMLElement;
    expect(name.textContent?.trim()).toBe('Ms. Paravai Munusamy');
    expect(name.textContent).not.toContain('..');
    expect(name.className).not.toMatch(/truncate/);
    expect(ctx.querySelector('.pf-sc-chip--order')?.textContent).toContain('LAB-2609-000085');
    expect(ctx.querySelector('.pf-sc-chip--samples')?.textContent).toContain('B-a');
    expect([...ctx.querySelectorAll('.pf-sc-ctx__filters [role="radio"]')].map(b => b.textContent?.replace(/\s+/g, ' ').trim()))
      .toEqual(['All 1', 'Pending 1', 'Drawn 0', 'External 0']);
    expect(ctx.querySelector('.pf-sc-ctx__count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('0/1 drawn');
  });

  it('several samples collapse into an "N samples" chip that lists them', async () => {
    const { drawer, f } = await renderDrawer([S('a'), S('b'), S('c')]);
    const chip = drawer.querySelector('button.pf-sc-chip--samples') as HTMLButtonElement;
    expect(chip.textContent?.trim()).toBe('3 samples');
    chip.click();
    f.detectChanges();
    const pop = drawer.querySelector('.pf-sc-samples__pop') as HTMLElement;
    expect(pop.classList).toContain('pf-sc-samples__pop--open');
    expect(pop.textContent).toContain('B-b');
  });

  it('the status filter narrows the vial tiles', async () => {
    const { drawer, f } = await renderDrawer([S('a'), S('b', 'collected')]);
    expect(drawer.querySelectorAll('.pf-sc-tile').length).toBe(2);
    const drawn = [...drawer.querySelectorAll('.pf-sc-ctx__filters [role="radio"]')].find(b => b.textContent?.includes('Drawn')) as HTMLButtonElement;
    drawn.click();
    f.detectChanges();
    expect(drawer.querySelectorAll('.pf-sc-tile').length).toBe(1);
    expect(drawn.getAttribute('aria-checked')).toBe('true');
  });

  it('tiles keep the ORIGINAL tube illustration (cap + blood fill) as the hero', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b', 'collected')]);
    const tiles = drawer.querySelectorAll('.pf-sc-tile');
    expect(tiles.length).toBe(2);
    for (const t of tiles) {
      expect(t.querySelector('svg.pf-vial')).not.toBeNull();
      expect(t.querySelector('.pf-vial__blood')).not.toBeNull();
    }
  });

  it('tapping a tile plays the fill: blood y rises 320 → 130 and the tile turns drawn', async () => {
    const { drawer, f, c } = await renderDrawer([S('a')]);
    const tile = drawer.querySelector('.pf-sc-tile') as HTMLElement;
    const blood = () => drawer.querySelector('.pf-sc-tile .pf-vial__blood') as SVGElement;
    expect(blood().getAttribute('y')).toBe('320');
    expect(tile.classList).not.toContain('pf-tube--done');
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.detectChanges();
    expect(blood().getAttribute('y')).toBe('130');
    expect(drawer.querySelector('.pf-sc-tile')!.classList).toContain('pf-tube--done');
    expect(c.api.patch).toHaveBeenCalledWith('/api/samples/a/collect');
  });

  it('COLLECTION footer: secondaries are nd secondary; the disabled finish is not primary', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b')]);
    const foot = drawer.querySelector('.pf-sc-foot') as HTMLElement;
    const cant = foot.querySelector('[aria-label="Can\'t collect"]') as HTMLElement;
    expect(cant.classList).toContain('nd-btn--secondary');
    expect(cant.classList).not.toContain('nd-btn--primary');
    const finish = foot.querySelector('.pf-drawer__finish') as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(finish.classList).not.toContain('nd-btn--primary');
    expect(foot.querySelectorAll('.nd-btn--primary, .pf-btn-primary').length).toBe(0);
  });

  it('when every vial is drawn, finish is the ONE primary in the footer', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected')]);
    const primaries = drawer.querySelectorAll('.pf-sc-foot .nd-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].classList).toContain('pf-drawer__finish');
  });

  it('phone: COLLECTION as a sticky bottom bar; "More" opens it as a sheet', async () => {
    const { drawer, f, c } = await renderDrawer([S('a')]);
    const bar = drawer.querySelector('.nd-bottombar.pf-sc-bar') as HTMLElement;
    expect(bar.querySelector('.nd-bottombar__info')?.textContent?.trim()).toBe('0/1 drawn');
    expect(bar.querySelector('.pf-sc-bar__cta')?.textContent?.trim()).toBe('Collect all to finish');
    (bar.querySelector('[aria-label="More collection actions"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.actionsOpen()).toBe(true);
    expect(drawer.querySelector('.pf-sc-side')!.classList).toContain('pf-sc-side--open');
  });

  it('the counter re-renders its tick element with the drawn count', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected'), S('b')]);
    expect(drawer.querySelector('.pf-sc-ctx__count .pf-tick')?.textContent).toBe('1');
  });
});

describe('nd-kit — the Collect screen is built from the kit classes', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pf-collect-immersive');
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
  });
  it('every kit building block is present in the rendered drawer', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b', 'collected')]);
    for (const cls of ['nd-page', 'nd-body', 'nd-body--split', 'nd-card', 'nd-card__head', 'nd-card__icon',
      'nd-card__label', 'nd-card__body', 'nd-card__foot', 'nd-btn', 'nd-btn--secondary', 'nd-btn--icon',
      'nd-seg', 'nd-seg__item', 'nd-chip', 'nd-band-chip', 'nd-row', 'nd-row--done', 'nd-mono', 'nd-bottombar']) {
      expect(drawer.querySelector('.' + cls), cls).not.toBeNull();
    }
  });
});
