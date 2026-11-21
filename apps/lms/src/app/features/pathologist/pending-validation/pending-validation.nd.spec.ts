import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, EMPTY, Subject } from 'rxjs';
import { vi } from 'vitest';
import { PendingValidationComponent } from './pending-validation.component';
import { departmentsIn, enrich, groupBySample, nextTile, tileStatus } from './pending-validation.logic';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ThemeService } from '../../../core/services/theme.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { OrderTest } from '../../../shared/models/order.model';

/**
 * /pathologist on the nd pattern (docs/PF-PATTERN.md → "Pathologist queue"):
 * band (search + ONE neutral filter), QUEUE card (tube tiles, sample ID first,
 * ONE status word, department filter), SCOPE side card (the consultant's
 * departments + the ONE primary "Review next"), no native controls, no
 * monospace, full names. And the department scope the server applies.
 */
const NOW = Date.parse('2026-09-27T10:00:00Z');
const HAEM = { id: 'd-hae', name: 'Haematology', code: 'HEM' };
const MICRO = { id: 'd-mic', name: 'Microbiology', code: 'MIC' };
const LONG_NAME = 'Ms. Paravai Munusamy Ramalingam';

function line(id: string, o: {
  sample: string; barcode: string; dept: typeof HAEM; receivedMinAgo: number; tatHours: number;
  critical?: boolean; mine?: boolean; patient?: string; test?: string; priority?: string;
}): OrderTest {
  return {
    id, status: 'entered', subOrderId: o.sample, testId: 't-' + id,
    validatorAssignedTo: o.mine ? 'me' : undefined,
    resultedAt: new Date(NOW - 5 * 60000).toISOString(),
    currentResult: JSON.stringify({ values: {}, flags: { critical: !!o.critical, notifications: [] } }),
    test: { id: 't-' + id, name: o.test ?? 'CBC', tatHours: o.tatHours } as any,
    subOrder: {
      id: o.sample, barcode: o.barcode, departmentId: o.dept.id, department: o.dept as any,
      receivedAtLab: new Date(NOW - o.receivedMinAgo * 60000).toISOString(),
      order: { id: 'o-' + o.sample, priority: o.priority ?? 'routine', patient: { displayName: o.patient ?? LONG_NAME, age: 44, sex: 'Female', mrn: 'AA0007' } },
    } as any,
  } as unknown as OrderTest;
}

const QUEUE: OrderTest[] = [
  // Haematology tube, two tests, on time.
  line('l1', { sample: 's1', barcode: '0126117', dept: HAEM, receivedMinAgo: 10, tatHours: 4 }),
  line('l2', { sample: 's1', barcode: '0126117', dept: HAEM, receivedMinAgo: 10, tatHours: 4, test: 'ESR' }),
  // Haematology tube, overdue — but a NORMAL order (stays under Normal).
  line('l3', { sample: 's2', barcode: '0126118', dept: HAEM, receivedMinAgo: 300, tatHours: 2, patient: 'Mr. Arun Kumar' }),
  // Microbiology tube, due within the hour, critical, assigned to me.
  line('l4', { sample: 's3', barcode: '1126001', dept: MICRO, receivedMinAgo: 100, tatHours: 2, critical: true, mine: true, patient: 'Mrs. Latha Devi', test: 'Gram Stain' }),
];
/** A STAT order (front-desk emergency) — Urgent, nowhere near due. */
const STAT_LINE = line('l5', { sample: 's4', barcode: '0126120', dept: HAEM, receivedMinAgo: 5, tatHours: 6, priority: 'STAT', patient: 'Mr. Ravi Shankar' });

const SCOPE_ALL = { scoped: false, departments: [], validatedToday: 7, validatedTodayByMe: 3 };
const SCOPE_HAEM = { scoped: true, departments: [HAEM], validatedToday: 4, validatedTodayByMe: 2 };

const realMatchMedia = (window as any).matchMedia;
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(opts: { queue?: OrderTest[]; scope?: unknown; nd?: boolean; touch?: boolean; admin?: boolean; queue$?: Subject<OrderTest[]> } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover') ? !opts.touch : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/validation/queue')) return opts.queue$ ?? of(opts.queue ?? QUEUE);
      if (url === '/api/validation/scope') return of(opts.scope ?? SCOPE_ALL);
      return of([]);
    }),
    post: vi.fn(() => of({})),
  };
  const router = { url: '/pathologist', navigate: vi.fn(() => Promise.resolve(true)), events: of() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: ThemeService, useValue: { isNewDesign: signal(opts.nd !== false), isDark: signal(false) } },
      { provide: LiveQueueService, useValue: { on: () => EMPTY } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { prompt: vi.fn(async () => null), confirm: vi.fn(async () => false), choose: vi.fn(async () => null) } },
      { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me', tenantName: 'Micro World' }), hasPermission: (p: string) => !!opts.admin && p === 'manage_tenant', hasAnyPermission: () => false } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), tap: () => true, rearm() {}, attachSource() {}, detachSource() {} } },
      { provide: Router, useValue: router },
    ],
  });
  const f = TestBed.createComponent(PendingValidationComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  await settle(f);
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  return { f, el, c, api, router };
}

/** Let the grid (pf-data-grid → AG-Grid) render its rows. */
const settle = async (f: { detectChanges(): void }) => { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 40)); f.detectChanges(); } };
/** The queue's rows (one per tube) — grid rows since the grid redesign (owner 2026-11-20). */
const tilesOf = (el: Element) => [...el.querySelectorAll<HTMLElement>('.ag-row.pv-row:not(.ag-opacity-zero)')];
/** Rows leaving the grid fade out first (animateRows): wait them out. */
const leave = async (f: { detectChanges(): void }) => { await new Promise(r => setTimeout(r, 600)); await settle(f); };
const idsOf = (el: Element) => tilesOf(el).map(t => t.querySelector('.pv-tile__id')!.textContent!.trim());
/** A segment's words: label + count, space-joined. */
const words = (e: Element) => [...e.children].map(c => c.textContent!.trim()).join(' ');
/** Component CSS with Angular's scoping attributes stripped. */
const css = () => ((PendingValidationComponent as any).ɵcmp.styles as string[]).join('\n')
  .replace(/\[_ng(content|host)-%COMP%\]/g, '');
/** Just the new-design rules. The queue is ND-only now (no `.pv-nd` scoping prefix any more), so it is ALL of the
 *  component CSS; indexOf = -1 used to slice just the last character and make every ndCss() check vacuous. */
const ndCss = () => { const all = css(); const i = all.indexOf('.pv-nd'); return i < 0 ? all : all.slice(i); };
/** Primaries on the page proper — the phone bottom bar mirrors the side
 *  card's primary (display:none above 640px), so it's counted separately. */
const primaries = (root: Element) =>
  [...root.querySelectorAll('.pf-btn--primary, .pf-hb-btn--primary, pf-touch-btn[variant="primary"], .pf-btn--primary')]
    .filter(b => !b.closest('.pf-bottombar'));

describe('Pathologist queue (nd) — layout', () => {
  it('band + QUEUE card + SCOPE side card; ONE primary (Review next), in the side card', async () => {
    const { el } = await render();
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
    expect(el.querySelector('.pf-body.pf-body--split')).not.toBeNull();
    const cards = [...el.querySelectorAll('.pf-body > .pf-card')];
    expect(cards.map(c => c.querySelector('.pf-card__label')?.textContent?.trim())).toEqual(['Pending validation', 'Your scope']);
    const p = primaries(el);
    expect(p.length).toBe(1);
    expect(p[0].closest('.pv-side')).not.toBeNull();
    expect(p[0].textContent).toContain('Review next');
    // The bottom bar carries at most the same one action.
    expect(el.querySelectorAll('.pf-bottombar .pf-btn--primary').length).toBeLessThanOrEqual(1);
    // Refresh is a quiet ghost on the band.
    expect(el.querySelector('.pv-refresh')!.classList).toContain('pf-hb-btn--ghost');
  });

  it('no native controls, no emoji; selected states are neutral radios', async () => {
    const { el } = await render();
    expect(el.querySelector('select, datalist, input[type=checkbox], input[type=radio]')).toBeNull();
    expect(el.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u);
    const seg = el.querySelector('pf-hero-band .pf-seg') as HTMLElement;
    expect(seg.getAttribute('role')).toBe('radiogroup');
    const tabs = [...seg.querySelectorAll('[role=radio]')];
    expect(tabs.map(words)).toEqual(['All 3', 'Assigned to me 1']);
    expect(seg.querySelector('[aria-checked="true"]')?.getAttribute('data-tab')).toBe('all');
    // No classic chrome in the new design.
    expect(el.querySelector('pf-screen-header, pf-kpi-strip, pf-avatar')).toBeNull();
  });

  it('no monospace anywhere in the new-design CSS; tokens only (no raw decoration hues)', () => {
    expect(ndCss()).not.toMatch(/monospace|JetBrains|Courier|font-mono/i);
    expect(ndCss()).not.toMatch(/#(a78bfa|f59e0b|38bdf8|10b981|f43f5e|a855f7)/i);
  });
});

describe('Pathologist queue (nd) — tiles', () => {
  it('one ROW per tube: sample ID first (tabular), FULL name, meta joined with ·, one status word', async () => {
    const { el } = await render();
    const tiles = tilesOf(el);
    expect(tiles.length).toBe(3);
    expect(el.querySelector('pf-data-grid[data-testid="pv-grid"]')).not.toBeNull();
    const hae = tiles.find(t => t.querySelector('.pv-tile__id')!.textContent!.trim() === '0126117')!;
    expect(hae.querySelector('.pv-tile__id')!.classList).toContain('pf-num');
    expect(hae.querySelector('.pv-tile__who')!.textContent!.trim()).toBe(LONG_NAME);   // never cut
    expect(hae.querySelector('.pv-tile__meta')!.textContent).toContain('44/F · AA0007 · Haematology');
    expect(hae.querySelector('.pv-tile__meta')!.textContent).not.toContain('|');
    // No Tests column (owner 2026-11-20): department + count in the meta line, the names in its tooltip.
    expect(hae.querySelector('.pv-tile__meta')!.textContent).toContain('Haematology · 2 tests');
    expect(hae.querySelector('.pv-tile__meta')!.getAttribute('title')).toBe('CBC · ESR');
    expect(hae.querySelector('.pv-tile__tests')).toBeNull();
    // ONE status each: a neutral pill + dot, no chip.
    for (const t of tiles) {
      expect(t.querySelectorAll('.pv-status').length).toBe(1);
      expect(t.querySelector('.pv-status .pv-status__dot')).not.toBeNull();
      expect(t.querySelector('.pf-chip, pf-chip')).toBeNull();
    }
    const word = (id: string) => tiles.find(t => t.querySelector('.pv-tile__id')!.textContent!.trim() === id)!
      .querySelector('.pv-status')!.textContent!.trim();
    expect(word('0126117')).toBe('On time');
    expect(word('0126118')).toBe('Overdue');
    expect(word('1126001')).toBe('Critical');
    // Status tones: rose for critical / overdue, never amber (owner: no yellow).
    const tone = (id: string) => tiles.find(t => t.querySelector('.pv-tile__id')!.textContent!.trim() === id)!
      .querySelector('.pv-status')!.getAttribute('data-tone');
    expect([tone('0126118'), tone('1126001')]).toEqual(['rose', 'rose']);
  });

  it('Urgent (order priority) rows come first with a rose leading rule + "Urgent"; never "High"', async () => {
    const { el } = await render({ queue: [...QUEUE, STAT_LINE] });
    const rows = tilesOf(el);
    const urgent = rows.filter(r => r.classList.contains('wg-row--urgent'));
    expect(urgent.map(r => r.querySelector('.pv-tile__id')!.textContent!.trim())).toEqual(['0126120']);
    expect(urgent[0].querySelector('.wg-prio[data-p="urgent"]')!.textContent!.trim()).toBe('Urgent');
    // The grid keeps the old groups' order: Urgent first, then Normal (mine → priority → least time left).
    expect(el.querySelector('.ag-row[row-index="0"]')!.classList).toContain('wg-row--urgent');
    expect(el.textContent).not.toMatch(/\bHigh\b/);
  });

  it('header filters on every data column (not the actions) + the shared alignment; Due instead of a journey ring', async () => {
    const { c, el } = await render();
    const by = Object.fromEntries(c.cols().map((d: any) => [d.colId, d]));
    expect(by['sample'].filter).toBe('agTextColumnFilter');
    expect(by['patient'].filter).toBe('agTextColumnFilter');
    expect(by['wait'].filter).toBe('agNumberColumnFilter');
    expect(typeof by['status'].filter).toBe('function');
    expect(by['acts'].filter).toBe(false);
    expect([by['sample'].headerClass, by['patient'].headerClass, by['status'].headerClass, by['wait'].headerClass, by['acts'].headerClass].map(h => [h].flat().join(' ')))
      .toEqual(['wg-h-left', 'wg-h-left', 'wg-h-center', 'wg-h-center', 'wg-h-right']);
    // Every data column SORTS on its real value (owner 2026-11-21), asc → desc → none; the actions never.
    for (const k of ['sample', 'patient', 'status', 'due', 'wait']) {
      expect(by[k].sortable, k).toBe(true);
      expect(by[k].sortingOrder, k).toEqual(['asc', 'desc', null]);
      expect(typeof by[k].comparator, k).toBe('function');
    }
    expect(by['acts'].sortable).toBe(false);
    expect(typeof by['wait'].valueGetter({ data: c.gridRows()[0] })).toBe('number');
    // Due (time left to TAT) instead of a journey ring: sortable, centred, rose once late.
    expect(by['due'].sortable).toBe(true);
    expect([by['due'].headerClass].flat().join(' ')).toBe('wg-h-center');
    expect(by['journey']).toBeUndefined();
    expect(el.querySelector('pf-journey-ring')).toBeNull();
    const due = Object.fromEntries(tilesOf(el).map(t => [t.querySelector('.pv-tile__id')!.textContent!.trim(), t.querySelector('.pv-due')!]));
    expect(due['0126118'].textContent!.trim()).toMatch(/late$/);
    expect(due['0126118'].classList).toContain('wg-tat--late');
    expect(due['0126117'].textContent!.trim()).toMatch(/^in /);
  });

  it('row action: ONE text "Review" (44px tall on touch, never icon-only); a tap anywhere on the row opens the review', async () => {
    const web = await render();
    const btn = web.el.querySelector('.ag-row .pv-review') as HTMLElement;
    expect(btn.classList).toContain('pf-rowact');
    expect(btn.classList).not.toContain('pf-rowact--icon');
    expect(btn.textContent!.trim()).toBe('Review');
    TestBed.resetTestingModule();
    const touch = await render({ touch: true });
    expect(touch.el.querySelector('.ag-row .pv-review')!.classList).not.toContain('pf-rowact--icon');
    expect(touch.el.querySelector('.ag-row .pv-review')!.getAttribute('aria-label')).toMatch(/^Review /);
    // Touch sizing comes from the shared work-grid cells: ≥44px controls, 8px apart.
    expect(css()).toMatch(/not \(\(hover: hover\) and \(pointer: fine\)\)[^{]*\{[^}]*\.wg-act\s*\{[^}]*min-height:\s*44px/);
    expect(css()).toMatch(/\.wg-acts\s*\{[^}]*gap:\s*8px/);
    // Tap a tube's row → the same sample screen the tech used, in validate mode.
    const row = tilesOf(touch.el).find(t => t.querySelector('.pv-tile__id')!.textContent!.trim() === '0126117')!;
    touch.c.onRow({ data: touch.c.gridRows().find((g: any) => g.sampleLabel === '0126117'), event: { target: row.querySelector('.pv-tile__who') } });
    expect(touch.router.navigate).toHaveBeenCalledWith(['/lab/sample', 's1'], { queryParams: { validate: 1 } });
  });

  it('Assigned to me filters locally; Review next opens mine first', async () => {
    const { el, c, f, router } = await render();
    (el.querySelector('[data-tab="mine"]') as HTMLElement).click();
    f.detectChanges(); await leave(f);
    expect(idsOf(el)).toEqual(['1126001']);
    c.setTab('all'); f.detectChanges();
    (el.querySelector('.pv-side .pv-next') as HTMLElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/lab/sample', 's3'], { queryParams: { validate: 1 } });
  });

  it('department filter appears only with more than one department and narrows the tiles', async () => {
    const { el, f } = await render();
    const seg = el.querySelector('.pv-depts') as HTMLElement;
    expect([...seg.querySelectorAll('[role=radio]')].map(words))
      .toEqual(['All', 'Haematology 2', 'Microbiology 1']);
    ([...seg.querySelectorAll<HTMLElement>('[role=radio]')].find(r => r.textContent!.includes('Microbiology')))!.click();
    f.detectChanges(); await leave(f);
    expect(idsOf(el)).toEqual(['1126001']);

    TestBed.resetTestingModule();
    const one = await render({ queue: QUEUE.filter(q => q.subOrder?.departmentId === HAEM.id), scope: SCOPE_HAEM });
    expect(one.el.querySelector('.pv-depts')).toBeNull();
  });

  it('first load: the side card numbers are placeholders and Review next says it is loading', async () => {
    const queue$ = new Subject<OrderTest[]>();
    const { f, el } = await render({ queue$ });
    const stats = el.querySelector('.pv-stats')!;
    expect(stats.querySelectorAll('pf-skeleton').length).toBe(4);
    expect(el.querySelector('.pv-next')!.textContent).toContain('Loading the queue');
    expect(el.textContent).not.toContain('Nothing to review');
    queue$.next(QUEUE); queue$.complete();
    f.detectChanges();
    expect(stats.querySelectorAll('pf-skeleton').length).toBe(0);
    expect(el.querySelector('.pv-next')!.textContent).toContain('Review next');
  });

  it('empty queue: the kit empty state and a disabled, non-primary Review next', async () => {
    const { el } = await render({ queue: [] });
    expect(el.querySelector('.pf-empty')).not.toBeNull();
    expect(el.querySelector('.pf-empty__title')!.textContent).toContain('Nothing to validate');
    const next = el.querySelector('.pv-side .pv-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(next.classList).not.toContain('pf-btn--primary');
    expect(primaries(el).length).toBe(0);
  });
});

describe('Pathologist queue (nd) — department scope', () => {
  it('a scoped consultant sees their departments on the side card, not "All departments"', async () => {
    const { el } = await render({ queue: QUEUE.filter(q => q.subOrder?.departmentId === HAEM.id), scope: SCOPE_HAEM });
    const depts = [...el.querySelectorAll('.pv-side .pv-dept')].map(d => d.textContent!.trim());
    expect(depts).toEqual(['Haematology']);
    expect(el.querySelector('.pv-side')!.textContent).toContain("only these departments' results");
    expect(el.querySelector('.pv-side')!.textContent).toMatch(/Validated today\s*4/);
  });

  it('an unassigned consultant sees every department with a hint to get assigned', async () => {
    const { el } = await render();
    expect([...el.querySelectorAll('.pv-side .pv-dept')].map(d => d.textContent!.trim())).toEqual(['All departments']);
    expect(el.querySelector('.pv-side')!.textContent).toContain('Users & roles');
  });

  it('an admin is told they see every department', async () => {
    const { el } = await render({ admin: true });
    expect(el.querySelector('.pv-side')!.textContent).toContain('As an admin you see every department');
  });

  it('the new design asks for the whole scoped queue (tabs filter locally) and the scope', async () => {
    const { api, c } = await render();
    expect(api.get).toHaveBeenCalledWith('/api/validation/queue?mine=false');
    expect(api.get).toHaveBeenCalledWith('/api/validation/scope');
    c.setTab('mine');
    expect(api.get.mock.calls.filter((x: unknown[]) => String(x[0]).startsWith('/api/validation/queue')).length).toBe(1);
  });
});

describe('Pathologist queue — classic stays classic', () => {
  it('classic keeps the segmented tabs + KPI strip and asks the server for ?mine', async () => {
    const { el, api, c } = await render({ nd: false });
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('pf-segmented')).not.toBeNull();
    c.setTab('mine');
    expect(api.get).toHaveBeenCalledWith('/api/validation/queue?mine=true');
  });
});

describe('pending-validation.logic', () => {
  const tiles = () => groupBySample(enrich([...QUEUE, STAT_LINE], NOW), 'me');
  it('groups by tube; mine first, then Urgent, then soonest due', () => {
    const t = tiles();
    expect(t.map(x => x.sampleLabel)).toEqual(['1126001', '0126120', '0126118', '0126117']);
    expect(t[1].priority).toBe('urgent'); // STAT → Urgent
    expect(t[2].priority).toBe('normal'); // overdue but Normal
    expect(t[2].tat).toBe('overdue');
    expect(t[3].items.length).toBe(2);
    expect(t[0].mine).toBe(true);
  });
  it('status word: critical › overdue › due in N › on time', () => {
    expect(tileStatus({ anyCritical: true, remainingMin: 500 }).label).toBe('Critical');
    expect(tileStatus({ anyCritical: false, remainingMin: -5 })).toEqual({ key: 'overdue', label: 'Overdue', tone: 'red' });
    expect(tileStatus({ anyCritical: false, remainingMin: 19.6 })).toEqual({ key: 'due', label: 'Due in 20m', tone: 'amber' });
    expect(tileStatus({ anyCritical: false, remainingMin: 200 }).tone).toBe('green');
    expect(tileStatus({ anyCritical: false, remainingMin: null }).label).toBe('On time');
  });
  it('next = mine, then critical, then most urgent', () => {
    const t = tiles();
    expect(nextTile(t)!.sampleLabel).toBe('1126001');
    expect(nextTile(t.filter(x => !x.mine))!.sampleLabel).toBe('0126120');
    expect(nextTile(t.filter(x => !x.mine && x.priority === 'normal'))!.sampleLabel).toBe('0126118');
    expect(nextTile([])).toBeNull();
  });
  it('departments in the queue, alphabetical with counts', () => {
    expect(departmentsIn(tiles())).toEqual([
      { id: 'd-hae', name: 'Haematology', count: 3 }, // incl. the STAT tube
      { id: 'd-mic', name: 'Microbiology', count: 1 },
    ]);
  });
});
