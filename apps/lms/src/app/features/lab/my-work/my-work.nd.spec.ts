import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Component, Input, output, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { MyWorkComponent } from './my-work.component';
import { SampleCollectionComponent } from '../sample-collection/sample-collection.component';
import { ReceiveSamplesComponent } from '../receive-samples/receive-samples.component';
import { ApiService } from '../../../core/services/api.service';
import { DraftShelfService } from '../../../core/services/draft-shelf.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ScanService } from '../../../core/services/scan.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';
import { NavBackService } from '../../../core/services/nav-back.service';

/** My Work in the new design: palette only (no colour dots on the tabs). */
function make(newDesign: boolean, web = false, process: Record<string, unknown> = { isEnabled: () => true, dispatchStepEnabled: () => false }) {
  configure(newDesign, web, process);
  return TestBed.runInInjectionContext(() => new MyWorkComponent()) as any;
}
function configure(newDesign: boolean, web: boolean, process: Record<string, unknown>) {
  (window as any).matchMedia = (q: string) => ({ matches: web && q === '(hover: hover) and (pointer: fine)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const loose = () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => undefined) });
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn(() => of([])), post: vi.fn(() => of({})) } },
      { provide: DraftShelfService, useValue: loose() },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: ToastService, useValue: loose() },
      { provide: DialogService, useValue: loose() },
      { provide: ProcessWorkflowService, useValue: process },
      { provide: BranchLabConfigService, useValue: loose() },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: TenantEntitlementsService, useValue: loose() },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: TenantStateService, useValue: { tenant: signal(null), ensureLoaded: () => undefined } },
      { provide: ThemeService, useValue: { isNewDesign: () => newDesign, isDark: () => false } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn(), url: '/lab/my-work', events: of(), createUrlTree: () => ({}), serializeUrl: () => '' } },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
    ],
  });
}

describe('My Work — new-design remap', () => {
  it('band tabs carry counts but no colour dots in the new design', () => {
    const c = make(true);
    const opts = c.tabOptions();
    expect(opts.length).toBeGreaterThanOrEqual(3);
    for (const o of opts) {
      expect(o.dot).toBeUndefined();
      expect(typeof o.count).toBe('number');
      expect(o.iconPath?.length).toBeGreaterThan(0);
    }
  });

  it('classic keeps its colour dots', () => {
    const c = make(false);
    expect(c.tabOptions().every((o: any) => !!o.dot)).toBe(true);
    expect(c.tabOptions().every((o: any) => o.iconPath === undefined)).toBe(true);
  });
});

describe('My Work — counter row hidden in the new design', () => {
  it('the queue filter defaults to "all" (nothing is filtered while the row is hidden)', () => {
    const c = make(true);
    expect(c.counter()).toBe('all');
  });
});

describe('My Work — round 5 (owner): headers, counts, row actions, dots', () => {
  const css = () => ((MyWorkComponent as any).ɵcmp.styles as string[]).join('\n');

  it('pane header label has no fill; only the icon chip is tinted', () => {
    // The classic tab-strip track behind icon + word is stripped in the new design…
    expect(css()).toMatch(/\.design-new[^{]*\.pf-mw-tabs[^{]*\{[^}]*background:\s*none/);
    // …and the title itself never carries a background.
    expect(css()).toMatch(/\.pf-mw-pane__title[^{]*\{[^}]*background:\s*none/);
  });

  it('row actions follow the device mode: text on web, icon on touch', () => {
    expect(make(true, true).webPointer()).toBe(true);
    TestBed.resetTestingModule();
    expect(make(true, false).webPointer()).toBe(false);
  });

  it('NORMAL group dot is neutral in the new design (no green)', () => {
    const rule = css().match(/\.design-new[^{]*\.pf-dot\[data-priority=["']?normal["']?\][^{]*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).not.toMatch(/#10b981|#34d399|16,\s*185,\s*129/i);
  });

  it('queue "done" stat is violet, not green, in the new design', () => {
    expect(css()).toMatch(/\.design-new[^{]*\.pf-tq__stat--done[^{]*\{[^}]*violet-text/);
  });

  it('pane count is pluralised', () => {
    const c = make(true);
    expect(c.paneCountLabel()).toBe('0 items');
    expect(c.plural(1, 'sample')).toBe('1 sample');
    expect(c.plural(2, 'sample')).toBe('2 samples');
  });
});

describe('My Work — round 6 (owner): sample ID is the primary line', () => {
  const css = () => ((MyWorkComponent as any).ɵcmp.styles as string[]).join('\n');
  it('tile ID is 15px / 600 / primary text colour; name 13px secondary', () => {
    expect(css()).toMatch(/\.design-new[^{]*\.pf-tq__id[^{]*\{[^}]*font-size:\s*15px\s*!important;\s*font-weight:\s*600\s*!important;[^}]*color:\s*var\(--text-primary\)/);
    expect(css()).toMatch(/\.design-new[^{]*\.pf-tq__who[^{]*\{[^}]*font-size:\s*13px/);
  });
  it('Normal-priority tiles lose the stripe (only Urgent keeps its red one)', () => {
    expect(css()).toMatch(/\.pf-tq[^{\s]*:not\(\.pf-tq--urgent\)\s[^{]*\.pf-tq__cap[^{]*\{[^}]*transparent/);
    expect(css()).not.toMatch(/pf-tq--high/);
  });
});

/** Owner (2026-09-27): the LEFT companion slot depends on the workflow.
 *   collection in the Lab + no dispatch/intake → the COLLECTION card;
 *   dispatch + Lab Intake on                  → the Lab Intake card;
 *   neither                                   → full-width work pane. */
/** An in-memory Storage (the runner's own localStorage may be missing). */
function memStorage() {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  });
}

const wfBase = { active: () => null, loadActive: () => undefined, refreshActive: () => undefined, placedIn: () => null };
const WF = {
  collectPane: { ...wfBase, isEnabled: (t: string) => t !== 'lab_intake' && t !== 'dispatch', collectsInLab: () => true, dispatchStepEnabled: () => false },
  // A stale config with lab_intake still ticked but no dispatch: tubes still
  // auto-receive, so Collection wins.
  collectStaleIntake: { ...wfBase, isEnabled: (t: string) => t !== 'dispatch', collectsInLab: () => true, dispatchStepEnabled: () => false },
  intake: { ...wfBase, isEnabled: () => true, collectsInLab: () => true, dispatchStepEnabled: () => true },
  neither: { ...wfBase, isEnabled: (t: string) => t !== 'lab_intake', collectsInLab: () => false, dispatchStepEnabled: () => false },
};

describe('My Work — left companion follows the workflow', () => {
  beforeEach(memStorage);
  afterEach(() => vi.unstubAllGlobals());
  const deps = (): unknown[] => {
    const d = (MyWorkComponent as any).ɵcmp?.dependencies;
    return (typeof d === 'function' ? d() : d) ?? [];
  };

  it('collection in the Lab + no dispatch/intake → Collection companion, no Lab Intake', () => {
    for (const wf of [WF.collectPane, WF.collectStaleIntake]) {
      TestBed.resetTestingModule();
      const c = make(true, true, wf);
      expect(c.showCollect()).toBe(true);
      expect(c.showIntake()).toBe(false);
      expect(c.showLeftPane()).toBe(true);
      expect(c.leftPaneOpen()).toBe(true);     // open by default (collecting is the point)
    }
    expect(deps()).toContain(SampleCollectionComponent);
  });

  it('dispatch + Lab Intake on → Lab Intake as today, no Collection companion', () => {
    const c = make(false, true, WF.intake);
    expect(c.showCollect()).toBe(false);
    expect(c.showIntake()).toBe(true);
    expect(c.leftPaneOpen()).toBe(true);       // classic: intake always open
  });

  it('neither → full-width work pane (no left column)', () => {
    const c = make(false, true, WF.neither);
    expect(c.showCollect()).toBe(false);
    expect(c.showIntake()).toBe(false);
    expect(c.showLeftPane()).toBe(false);
    expect(c.leftPaneOpen()).toBe(false);
  });

  it('collection collapses to its strip and is remembered per user', () => {
    const c = make(true, true, WF.collectPane);
    c.collapseCollect();
    expect(c.leftPaneOpen()).toBe(false);
    expect(localStorage.getItem('pf-lms.my-work.collect-collapsed')).toBe('1');
    TestBed.resetTestingModule();
    const again = make(true, true, WF.collectPane);
    expect(again.collectOpen()).toBe(false);   // still collapsed next visit
    again.expandCollect();
    expect(again.collectOpen()).toBe(true);
    expect(localStorage.getItem('pf-lms.my-work.collect-collapsed')).toBeNull();
  });

  it('phones never strand the first tab when no companion applies', () => {
    const c = make(true, true, WF.neither);
    TestBed.tick();
    expect(c.mobileTab()).not.toBe('intake');
  });
});

/** Rendered: the real My Work template with the two embedded screens stubbed. */
@Component({ selector: 'pf-sample-collection', standalone: true, template: '<input class="pf-scan__input" />' })
class StubCollect { @Input() embedded = false; readonly sampleCollected = output<void>(); }
@Component({ selector: 'pf-receive-samples', standalone: true, template: '' })
class StubReceive { @Input() embedded = false; readonly sampleReceived = output<void>(); }

function render(wf: Record<string, unknown>) {
  configure(true, true, wf);
  TestBed.overrideComponent(MyWorkComponent, {
    remove: { imports: [SampleCollectionComponent, ReceiveSamplesComponent] },
    add: { imports: [StubCollect, StubReceive] },
  });
  const f = TestBed.createComponent(MyWorkComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, cmp: f.componentInstance as any };
}

describe('My Work — Collection companion (rendered)', () => {
  beforeEach(memStorage);
  afterEach(() => vi.unstubAllGlobals());

  it('renders the embedded collect pane on the left, titled Collection', () => {
    const { el } = render(WF.collectPane);
    const pane = el.querySelector('.pf-mw-collect');
    expect(pane).not.toBeNull();
    expect(pane!.querySelector('.pf-mw-pane__title')!.textContent).toContain('Collection');
    const sc = pane!.querySelector('pf-sample-collection');
    expect(sc).not.toBeNull();
    // It is the FIRST pane of the split (left), and Lab Intake is absent.
    expect(el.querySelector('.pf-mw-split > .pf-mw-pane')).toBe(pane);
    expect(el.querySelector('pf-receive-samples')).toBeNull();
  });

  it('intake workflow renders Lab Intake and no collect pane', () => {
    const { el, cmp } = render(WF.intake);
    cmp.expandIntake();
    TestBed.tick();
    expect(el.querySelector('.pf-mw-collect')).toBeNull();
    expect(el.querySelector('pf-receive-samples')).not.toBeNull();
  });

  it('collecting in the pane refreshes the work list and counts', () => {
    const { f, cmp } = render(WF.collectPane);
    const api = TestBed.inject(ApiService) as any;
    const refresh = vi.spyOn(cmp, 'refresh');
    const before = api.get.mock.calls.length;
    const stub = f.debugElement.query(By.directive(StubCollect)).componentInstance as StubCollect;
    stub.sampleCollected.emit();          // tube drawn → auto-received
    expect(refresh).toHaveBeenCalled();   // the list refetches straight away
    expect(api.get.mock.calls.length).toBeGreaterThan(before);   // + counts
  });

  it('band Collect focuses the pane search in place (no navigation)', async () => {
    const { el, cmp } = render(WF.collectPane);
    cmp.collapseCollect();
    TestBed.tick();
    expect(el.querySelector('.pf-mw-collect')).toBeNull();   // collapsed to the strip
    const router = TestBed.inject(Router) as any;
    cmp.focusCollectFn();
    TestBed.tick();
    await new Promise(r => setTimeout(r, 0));
    const input = el.querySelector('.pf-mw-collect .pf-scan__input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

/** Owner (2026-09-29): the queue groups by the ORDER priority (Urgent /
 *  Normal) — TAT is a chip, never a "High" group. */
describe('My Work — priority groups + TAT chip', () => {
  const now = Date.now();
  const row = (id: string, priority: string, receivedMinAgo: number, tatHours: number) => ({
    id, status: 'pending', subOrderId: 's-' + id, testId: 't-' + id, name: 'CBC',
    test: { id: 't-' + id, name: 'CBC', tatHours },
    subOrder: {
      id: 's-' + id, barcode: 'B' + id, status: 'received',
      receivedAtLab: new Date(now - receivedMinAgo * 60000).toISOString(),
      order: { id: 'o-' + id, priority, patient: { displayName: 'P ' + id } },
    },
  });

  it('Urgent (not yet due) under Urgent; overdue Normal under Normal with an overdue clock', () => {
    const c = make(true);
    c._rows.set([row('1', 'urgent', 5, 6), row('2', 'routine', 300, 2), row('3', 'STAT', 0, 4)]);
    const b = c.buckets();
    expect(b.map((x: any) => x.label)).toEqual(['Urgent', 'Normal']);
    expect(b[0].items.map((i: any) => i.id).sort()).toEqual(['1', '3']);
    expect(b[1].items.map((i: any) => i.id)).toEqual(['2']);
    const normalTube = c.sampleRows(b[1].items)[0];
    expect(normalTube.remainingMin).toBeLessThan(0);
    const g = c.patientGroups(b[1].items)[0];
    expect(g.priority).toBe('normal');
    expect(g.remainingMin).toBeLessThan(0);
  });

  it('sample rows sort by TAT due within the group (overdue first)', () => {
    const c = make(true);
    c._rows.set([row('a', 'routine', 0, 8), row('b', 'routine', 200, 2), row('c', 'routine', 90, 2)]);
    const [, normal] = c.buckets();
    expect(c.sampleRows(normal.items).map((t: any) => t.barcode)).toEqual(['Bb', 'Bc', 'Ba']);
  });

  it('tile tone follows priority only (Urgent rose, Normal default — no amber)', () => {
    const c = make(true);
    expect(c.toneFor('urgent')).toBe('rose');
    expect(c.toneFor('normal')).toBe('default');
  });
});
