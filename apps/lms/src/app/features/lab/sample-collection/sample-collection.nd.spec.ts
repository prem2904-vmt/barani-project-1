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

describe('Collect sample — the bottom navbar stays visible', () => {
  it('opening the drawer never hides the nav (no immersive html class)', () => {
    const c = make();
    c._pending.set([S('a')]);
    c._openOrderId.set('o1');
    TestBed.tick();
    const cls = document.documentElement.classList;
    expect(cls).not.toContain('pf-collect-immersive');
    expect(cls).not.toContain('pf-immersive');
  });
});

describe('Collect sample — rendered on the nd pattern', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pf-collect-immersive');
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
  });

  it('band + two-card layout from the kit (pf-page, pf-body--split, VIALS + COLLECTION cards)', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b')]);
    expect(drawer.classList).toContain('pf-drawer--nd');
    expect(drawer.querySelector('pf-hero-band')).not.toBeNull();
    expect(drawer.querySelector('.pf-page')).not.toBeNull();
    const body = drawer.querySelector('.pf-body.pf-body--split') as HTMLElement;
    const cards = [...body.querySelectorAll(':scope > .pf-card')];
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.pf-card__label')?.textContent?.trim()).toBe('Vials');
    expect(cards[1].querySelector('.pf-card__label')?.textContent?.trim()).toBe('Collection');
    expect(cards[1].querySelector('.pf-card__foot')).not.toBeNull();
    // the old page header is gone
    expect(drawer.querySelector('.pf-drawer__head, .pf-drawer__hint')).toBeNull();
  });

  it('context bar: FULL patient name (no truncation), order ID, sample ID, counter — and NO filter control', async () => {
    const { drawer } = await renderDrawer([S('a')]);
    const ctx = drawer.querySelector('.pf-sc-ctx') as HTMLElement;
    const name = ctx.querySelector('.pf-sc-chip__name') as HTMLElement;
    expect(name.textContent?.trim()).toBe('Ms. Paravai Munusamy');
    expect(name.textContent).not.toContain('..');
    expect(name.className).not.toMatch(/truncate/);
    expect(ctx.querySelector('.pf-sc-chip--order')?.textContent).toContain('LAB-2609-000085');
    expect(ctx.querySelector('.pf-sc-chip--samples')?.textContent).toContain('B-a');
    expect(ctx.querySelector('.pf-seg, [role="radiogroup"], .pf-sc-ctx__filters')).toBeNull();
    expect(drawer.querySelector('.pf-sc-vials__filters')).toBeNull();
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
    const { drawer, f, c } = await renderDrawer([S('a'), S('b')]);   // 2nd tube: no auto-finish (OPS-124)
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
    expect(cant.classList).toContain('pf-btn--secondary');
    expect(cant.classList).not.toContain('pf-btn--primary');
    const finish = foot.querySelector('.pf-drawer__finish') as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(finish.classList).not.toContain('pf-btn--primary');
    expect(foot.querySelectorAll('.pf-btn--primary, .pf-btn-primary').length).toBe(0);
  });

  it('when every vial is drawn, finish is the ONE primary in the footer', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected')]);
    const primaries = drawer.querySelectorAll('.pf-sc-foot .pf-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].classList).toContain('pf-drawer__finish');
  });

  it('phone: COLLECTION as a sticky bottom bar; "More" opens it as a sheet', async () => {
    const { drawer, f, c } = await renderDrawer([S('a')]);
    const bar = drawer.querySelector('.pf-bottombar.pf-sc-bar') as HTMLElement;
    expect(bar.querySelector('.pf-bottombar__info')?.textContent?.trim()).toBe('0/1 drawn');
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

describe('pf-kit — the Collect screen is built from the kit classes', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pf-collect-immersive');
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
  });
  it('every kit building block is present in the rendered drawer', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b', 'collected')]);
    for (const cls of ['pf-page', 'pf-body', 'pf-body--split', 'pf-card', 'pf-card__head', 'pf-card__icon',
      'pf-card__label', 'pf-card__body', 'pf-card__foot', 'pf-btn', 'pf-btn--secondary', 'pf-btn--icon',
      'pf-chip', 'pf-chip--static', 'pf-band-chip', 'pf-num', 'pf-bottombar']) {
      expect(drawer.querySelector('.' + cls), cls).not.toBeNull();
    }
  });
});

describe('Collect sample — layout above the nav, External row, adaptive tiles', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  it('the drawer is an .pf-fullscreen view (ends above the navbar via --pf-nav-h)', async () => {
    const { drawer } = await renderDrawer([S('a')]);
    expect(drawer.classList).toContain('pf-fullscreen');
  });

  it('tile size class by vial count: 1 → xl, 3 → lg, 6 → md, 9 → sm', () => {
    const c = make();
    const sizeFor = (n: number) => c.tileSize(G(Array.from({ length: n }, (_, i) => S('s' + i))));
    expect(sizeFor(1)).toBe('xl');
    expect(sizeFor(3)).toBe('lg');
    expect(sizeFor(6)).toBe('md');
    expect(sizeFor(9)).toBe('sm');
  });

  it('the grid carries the size class', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b'), S('c')]);
    expect(drawer.querySelector('.pf-sc-grid')!.classList).toContain('pf-sc-grid--lg');
  });

  it('External is its own row OUTSIDE the tap area; clicking it does not draw', async () => {
    const { drawer, f, c } = await renderDrawer([S('a')]);
    const wrap = drawer.querySelector('.pf-tube-wrap') as HTMLElement;
    const tile = wrap.querySelector('.pf-sc-tile') as HTMLElement;
    const ext = wrap.querySelector('.pf-sc-ext') as HTMLButtonElement;
    expect(ext).not.toBeNull();
    expect(tile.contains(ext)).toBe(false);
    expect(ext.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy(); // tile first, then External
    expect(ext.textContent).toContain('External (brought in)');
    ext.click();
    f.detectChanges();
    expect(c.api.patch).not.toHaveBeenCalledWith('/api/samples/a/collect');
    expect(c.api.patch).toHaveBeenCalledWith('/api/samples/a/source', { source: 'external' });
  });

  it('sample ID reads on one line: "Sample ID 26117"', async () => {
    const { drawer } = await renderDrawer([S('a')]);
    expect(drawer.querySelector('.pf-sc-tile .pf-tube__code')?.textContent?.replace(/\u00a0/g, ' ').trim()).toBe('Sample ID B-a');
  });
});

describe('Collect sample — palette + one font family', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  it('the drawn state carries no green: no green/emerald/success classes, no green fills', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected'), S('b')]);
    const html = drawer.innerHTML.toLowerCase();
    expect(html).not.toMatch(/emerald|green|text-success|bg-success/);
    for (const g of ['#10b981', '#34d399', '#059669', '#047857']) expect(html).not.toContain(g);
    // the check badge on the drawn tube is violet
    expect(drawer.querySelector('.pf-sc-tile.pf-tube--done circle[fill="#7c3aed"]')).not.toBeNull();
  });

  it('IDs and times use the tabular-number class, never a monospace class', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected')]);
    expect(drawer.querySelector('.font-mono, .pf-mono, [font-family*="monospace"]')).toBeNull();
    expect(drawer.querySelector('.pf-sc-chip--order .pf-num')?.textContent).toBe('LAB-2609-000085');
    expect(drawer.querySelector('.pf-sc-tile .pf-tube__code .pf-num')?.textContent).toBe('B-a');
    expect(drawer.querySelector('.pf-sc-tile .pf-tube__stamp.pf-num')).not.toBeNull();
  });
});

describe('Collect sample — symmetric tiles, lean COLLECTION panel', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));
  const JAR = (id: string, status = 'pending') =>
    S(id, status, { specimenType: 'Urine', department: 'CPY', tests: [{ test: { name: 'Urine Routine', sampleType: 'Urine' } }] });

  it('every tile has the same fixed illustration box (tube and jar alike), bottom-aligned SVGs', async () => {
    const { drawer } = await renderDrawer([S('a'), JAR('b')]);
    const tiles = [...drawer.querySelectorAll('.pf-sc-tile')];
    expect(tiles.length).toBe(2);
    for (const t of tiles) {
      const box = t.querySelector(':scope > .pf-sc-illo') as HTMLElement;
      expect(box).not.toBeNull();
      const svg = box.querySelector('svg.pf-vial') as SVGElement;
      expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');
      // text block comes right after the box in both tiles → rows align
      expect(box.nextElementSibling?.classList).toContain('pf-tube__body');
    }
    // same size class drives the same box for both container types
    expect(drawer.querySelector('.pf-sc-grid')!.classList).toContain('pf-sc-grid--xl');
  });

  it('the check badge sits in the same corner of the box for every container type', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected'), JAR('b', 'collected')]);
    const checks = [...drawer.querySelectorAll('.pf-sc-illo > .pf-sc-illo__check')];
    expect(checks.length).toBe(2);
  });

  it('COLLECTION: one status line, no per-tube list', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b', 'collected')]);
    const side = drawer.querySelector('.pf-sc-side') as HTMLElement;
    expect(side.querySelector('.pf-sc-summary, .pf-sc-sumrow')).toBeNull();
    expect(side.querySelector('.pf-sc-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 of 2 remaining');
  });

  it('status line reads "All vials collected" when done', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected')]);
    expect(drawer.querySelector('.pf-sc-status')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('All vials collected');
  });

  it('extra info renders only when the data exists', async () => {
    let r = await renderDrawer([S('a')]);
    expect(r.drawer.querySelector('.pf-sc-info')).toBeNull();
    r.drawer.remove();
    TestBed.resetTestingModule();
    const rich = S('b', 'pending', {
      tests: [{ test: { name: 'Glucose Fasting', fastingRequired: true } }],
      order: { orderNumber: 'LAB-2609-000085', priority: 'Urgent', refDoctorName: 'Dr. A. Sharma',
               patient: { id: 'p1', displayName: 'Ms. Paravai Munusamy', age: 44, sex: 'Female', mrn: 'AA0007' } },
    });
    r = await renderDrawer([rich]);
    const info = r.drawer.querySelector('.pf-sc-info') as HTMLElement;
    expect(info).not.toBeNull();
    const text = info.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Urgent');
    expect(text).toContain('Required for Glucose Fasting');
    expect(text).toContain('Dr. A. Sharma');
    expect(text).not.toContain('Hospital');
  });
});

describe('Collect sample — COLLECTION panel fills with what the tiles do not show', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  it('lists each tube\'s tests with the draw volume', async () => {
    const a = S('a', 'pending', { tests: [{ test: { name: 'Complete Blood Count', sampleVolumeMl: 2 } }, { test: { name: 'ESR' } }] });
    const { drawer } = await renderDrawer([a]);
    const sec = drawer.querySelector('.pf-sc-side [aria-label="Tests by tube"]') as HTMLElement;
    expect(sec).not.toBeNull();
    const rows = [...sec.querySelectorAll('.pf-sc-tests__list li')].map(li =>
      [...li.querySelectorAll('span')].map(sp => sp.textContent!.trim()).join(' | '));
    expect(rows).toEqual(['Complete Blood Count | 2 mL', 'ESR']);
  });

  it('timeline: Ordered → Drawn (k of n until done) → Dispatched', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected', { collectedAt: '2026-09-25T06:12:00Z' }), S('b')]);
    const steps = [...drawer.querySelectorAll('.pf-sc-timeline__step')];
    expect(steps.map(s => s.querySelector('.pf-sc-timeline__label')!.textContent)).toEqual(['Ordered', 'Drawn', 'Dispatched']);
    expect(steps[0].classList).toContain('pf-sc-timeline__step--done');
    expect(steps[1].classList).not.toContain('pf-sc-timeline__step--done');
    expect(steps[1].querySelector('.pf-sc-timeline__at')!.textContent!.trim()).toBe('1 of 2');
    expect(steps[2].querySelector('.pf-sc-timeline__at')!.textContent!.trim()).toBe('—');
  });

  it('Drawn completes with the last draw time once every vial is drawn', async () => {
    const { drawer } = await renderDrawer([S('a', 'collected', { collectedAt: '2026-09-25T06:12:00Z' })]);
    const drawn = drawer.querySelectorAll('.pf-sc-timeline__step')[1];
    expect(drawn.classList).toContain('pf-sc-timeline__step--done');
    expect(drawn.querySelector('.pf-sc-timeline__at')!.textContent!.trim()).not.toBe('—');
  });
});

describe('Collect sample — layering + seamless arrival', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  it('new design: the drawer stays inside the page (not teleported) under the app bar (z below 40)', async () => {
    const { drawer, f } = await renderDrawer([S('a')]);
    expect((f.nativeElement as HTMLElement).contains(drawer)).toBe(true);
    expect(drawer.parentElement).not.toBe(document.body);
  });

  it('deep-link loading shows the band + card skeleton (not a full-screen loader)', async () => {
    make([], false, []);
    const f = TestBed.createComponent(SampleCollectionComponent);
    const c = f.componentInstance as any;
    c._deepLinkMode.set(true);      // what ?orderId= sets in ngOnInit
    c._openOrderId.set('o9');       // order not loaded yet → no activeGroup
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const skel = el.querySelector('.pf-sc-skel') as HTMLElement;
    expect(skel).not.toBeNull();
    expect(skel.querySelector('pf-hero-band')).not.toBeNull();
    expect(skel.querySelectorAll('.pf-card').length).toBe(2);
    expect(el.querySelector('pf-loading-logo')).toBeNull();
  });
});

describe('Collect sample — an outsourced tube is just a tube with a small mark', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pf-collect-immersive');
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
  });

  it('same tile + tube, plus ONLY a neutral "Outsourced" chip (no partner name, no split banner)', async () => {
    const { drawer } = await renderDrawer([S('a'), S('b', 'pending', { outsourcedVendorId: 'lab-1', tubeColor: 'red' })]);
    const tiles = [...drawer.querySelectorAll('.pf-tube.pf-sc-tile')] as HTMLElement[];
    expect(tiles.length).toBe(2);
    const marks = tiles.map(t => t.querySelector('.pf-tube__out'));
    expect(marks[0]).toBeNull();
    expect(marks[1]?.textContent?.trim()).toBe('Outsourced');
    expect(marks[1]?.classList).toContain('pf-chip');
    // Same tube illustration + tap-to-draw state as the in-house tile.
    expect(tiles[1].querySelector('.pf-sc-illo')).not.toBeNull();
    expect(tiles[1].querySelector('.pf-tube__stamp--pending')?.textContent?.trim())
      .toBe(tiles[0].querySelector('.pf-tube__stamp--pending')?.textContent?.trim());
    // No split banner / create-tube button anywhere.
    expect(drawer.querySelector('.pf-sc__splits, .pf-sc__split-btn')).toBeNull();
    expect(drawer.textContent).not.toContain('Draw/split');
  });
});

describe('Collect sample — leaves by itself once everything drawable is drawn (OPS-124)', () => {
  const timed = (id: string) => S(id, 'pending', { repeatOffsetMin: 120, repeatBaseAt: new Date().toISOString() });

  it('tubes still to draw: tapping one keeps the drawer open', async () => {
    const { c, drawer } = await renderDrawer([S('a'), S('b')]);
    (drawer.querySelectorAll('.pf-sc-tile')[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(c._openOrderId()).toBe('o1');
  });

  it('the last drawable tube collected: toast + the same exit as "Done" (drawer closed)', async () => {
    const { c, drawer } = await renderDrawer([S('a'), S('b', 'collected')]);
    const toast = vi.spyOn(c.toasts, 'success');
    (drawer.querySelector('.pf-sc-tile:not(.pf-tube--done)') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    expect(c.api.patch).toHaveBeenCalledWith('/api/samples/a/collect');
    expect(toast).toHaveBeenCalledWith('Collected');
    expect(c._openOrderId()).toBeNull();
  });

  it('deep-linked from the front desk: auto-finish navigates back to where it came from', () => {
    const c = make([], false, [S('a', 'collected')]);
    c._returnTo = '/frontdesk';
    c._openOrderId.set('o1');
    c._pending.set([S('a', 'collected')]);
    c.autoFinishIfDone('o1');
    expect(c.router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
  });

  it('a dispatch step is the next action: the drawer stays open', () => {
    const c = make(['dispatch_sample'], true, []);
    c._openOrderId.set('o1');
    c._pending.set([S('a', 'collected')]);
    c.autoFinishIfDone('o1');
    expect(c._openOrderId()).toBe('o1');
  });

  it('nothing collected yet (or another order open): never closes', () => {
    const c = make([], false, []);
    c._openOrderId.set('o1');
    c._pending.set([S('a')]);
    c.autoFinishIfDone('o1');
    c.autoFinishIfDone('other');
    expect(c._openOrderId()).toBe('o1');
  });
});
