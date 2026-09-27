import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { signal } from '@angular/core';
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

/**
 * ONE band per screen (owner's iPad, 2026-09-28): the collection drawer showed
 * UNDER a second "Micro World" band (the queue's: tenant + Refresh, with an
 * empty strip where its search row was hidden). Two causes, both pinned here:
 *   1. a native-only `top: var(--navbar-height)` offset pushed the new-design
 *      full-screen drawer 64px down, uncovering the queue band behind it;
 *   2. the queue band stayed rendered while the drawer was open.
 * Every host of the collection screen — /sample-collection (bottom-bar
 * Collect), /lab/collect, the ?orderId deep link, and My Work's embedded
 * Collect pane — must show exactly one band: the drawer's (back + pills).
 */
const S = (id: string, orderId = 'o1') =>
  ({ id, orderId, status: 'pending', barcode: '2614' + id, tubeColor: 'sst', specimenType: 'Serum', department: 'BIO',
     tests: [{ test: { name: 'Liver Function Test' } }], createdAt: '2026-09-25T00:00:00Z',
     order: { orderNumber: 'LAB-2609-000098', patient: { id: 'p1', displayName: 'Mr. Arun Kumar', age: 52, sex: 'Male', mrn: 'MW0098' } } });

function setup(q: Record<string, string>, pending: any[]) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: {
        get: vi.fn((url: string) => of(url.includes('pending-collection') ? pending
          : url.includes('/api/orders/') ? { id: 'o1', orderNumber: 'LAB-2609-000098', patient: pending[0].order.patient, samples: pending } : [])),
        post: vi.fn(() => of({})), patch: vi.fn(() => of({})) } },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: () => false, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: {} },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => false, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map(Object.entries(q)) } } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ThemeService, useValue: { isNewDesign: signal(true), isDark: signal(true) } },
    ],
  });
}

const tick = () => new Promise(r => setTimeout(r, 0));

/** Render one host flavour and open order o1's drawer. */
async function openIn(host: 'route' | 'embedded' | 'deeplink', pending = [S('1')]) {
  setup(host === 'deeplink' ? { orderId: 'o1', from: '/frontdesk' } : {}, pending);
  const f = TestBed.createComponent(SampleCollectionComponent);
  const c = f.componentInstance as any;
  if (host === 'embedded') c.embedded = true;
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await tick();
  f.detectChanges();
  const queueBands = document.querySelectorAll('pf-hero-band').length;
  if (host !== 'deeplink') c._openOrderId.set('o1');
  f.detectChanges();
  await tick();
  f.detectChanges();
  return { f, c, queueBands };
}

describe('Collect — exactly one band on every host', () => {
  afterEach(() => {
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
    TestBed.resetTestingModule();
  });

  it('/sample-collection & /lab/collect (bottom-bar Collect): queue band before, drawer band ONLY after opening', async () => {
    const { f, queueBands } = await openIn('route');
    expect(queueBands).toBe(1);                         // the queue's own band
    const bands = document.querySelectorAll('pf-hero-band');
    expect(bands.length).toBe(1);
    const band = bands[0] as HTMLElement;
    expect(band.closest('.pf-drawer')).not.toBeNull();  // it is the drawer's band
    expect(band.querySelector('.pf-hb__back')).not.toBeNull();
    expect(band.querySelector('.pf-sc-ctx .pf-sc-chip--order')?.textContent).toContain('LAB-2609-000098');
    expect(band.querySelector('.pf-sc-ctx__count')?.textContent).toContain('drawn');
    expect(band.textContent).not.toContain('Refresh');
    f.nativeElement.remove();
  });

  it('closing the drawer brings the queue band back (still one)', async () => {
    const { f, c } = await openIn('route');
    c._openOrderId.set(null);
    f.detectChanges();
    const bands = document.querySelectorAll('pf-hero-band');
    expect(bands.length).toBe(1);
    expect((bands[0] as HTMLElement).closest('.pf-drawer')).toBeNull();
    f.nativeElement.remove();
  });

  it('My Work embedded Collect pane: the collection adds only the drawer band', async () => {
    const { f, queueBands } = await openIn('embedded');
    expect(queueBands).toBe(0);                         // My Work's band is the pane's band
    const bands = document.querySelectorAll('pf-hero-band');
    expect(bands.length).toBe(1);
    expect((bands[0] as HTMLElement).closest('.pf-drawer')).not.toBeNull();
    f.nativeElement.remove();
  });

  it('?orderId deep link (Frontdesk / order screen "Collect"): one band, the drawer\'s', async () => {
    const { f } = await openIn('deeplink');
    const bands = document.querySelectorAll('pf-hero-band');
    expect(bands.length).toBe(1);
    expect((bands[0] as HTMLElement).closest('.pf-drawer')).not.toBeNull();
    f.nativeElement.remove();
  });
});

const css = () => ((SampleCollectionComponent as any).ɵcmp.styles as string[]).join('\n');

describe('Collect — native drawer is full-screen from the top (no stacked band)', () => {
  it('the native --navbar-height top offset is CLASSIC-only; the nd drawer is never pushed down', () => {
    const rules = css().split('}').filter(r => /cap-native/.test(r) && /navbar-height/.test(r));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      const selectors = r.slice(0, r.indexOf('{'));
      // every selector the offset applies to excludes the new-design drawer
      for (const sel of selectors.split(',')) expect(sel).toContain(':not(.pf-drawer--nd');
    }
  });
});

describe('Collect — vial grid: one left-aligned column rule for every count', () => {
  const gridRule = (cls: string) => {
    const all = css();
    const m = [...all.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(x => x[1].includes('.' + cls) && /grid-template-columns/.test(x[2])
      && !/@media|:has|pf-drawer/.test(x[1]));
    return m.map(x => x[2]);
  };

  it('xl (1–2 vials) uses the SAME columns + alignment as md/sm (3+ vials): auto-fill, start', () => {
    const decls = ['pf-sc-grid--xl', 'pf-sc-grid--lg', 'pf-sc-grid--md', 'pf-sc-grid--sm'].map(c => gridRule(c).join(';'));
    for (const d of decls) {
      expect(d).toMatch(/repeat\(auto-fill,\s*minmax\(200px,\s*1fr\)\)/);
      expect(d).toMatch(/justify-content:\s*start/);
      expect(d).not.toMatch(/auto-fit|justify-content:\s*center/);
    }
    expect(new Set(decls).size).toBe(1);
  });

  it('no centring special case for a lone vial (desktop, iPad or phone)', () => {
    expect(css()).not.toMatch(/pf-sc-grid--xl[^{]*:has\([^)]*only-child\)[^{]*\{[^}]*grid-template-columns/);
    expect(css()).not.toMatch(/\.pf-sc-grid(--\w+)?(\[[^\]]*\])?(:has\([^)]*\))?\s*[,{][^}]*justify-content:\s*center/);
  });

  it('single-vial drawer renders the same grid classes as multi (xl), with the tap tile + External row', async () => {
    setup({}, [S('1')]);
    const f = TestBed.createComponent(SampleCollectionComponent);
    const c = f.componentInstance as any;
    f.detectChanges(); await tick();
    c._openOrderId.set('o1'); f.detectChanges(); await tick(); f.detectChanges();
    const grid = document.querySelector('.pf-sc-grid') as HTMLElement;
    expect(grid.classList).toContain('pf-sc-grid--xl');
    const wrap = grid.querySelector('.pf-tube-wrap') as HTMLElement;
    expect(wrap.querySelector('.pf-sc-tile[role="button"]')).not.toBeNull();
    expect(wrap.querySelector('.pf-sc-ext')).not.toBeNull();
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
    TestBed.resetTestingModule();
  });
});
