import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, EMPTY } from 'rxjs';
import { vi } from 'vitest';
import { ReportQueueComponent } from './report-queue.component';
import { WhatsAppSendService } from '../../../core/services/whatsapp-send.service';
import { WhatsAppManualService } from '../../../core/services/whatsapp-manual.service';
import { cultureStagesDone, cultureSummary, deptCountLabel, pendingStatus, reportStatus } from './report-queue.partial';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ThemeService } from '../../../core/services/theme.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { ZoomSourceDirective } from '../../../core/navigation/zoom.directive';

/**
 * Reports list on the nd pattern (docs/PF-PATTERN.md → "Reports list"):
 * ONE status filter in the band pill (no duplicate stats strip, no colour
 * dots), cards with the full name + Noto meta, no primary on the page, and
 * the Partial tab's truthful per-department model (the owner's order:
 * a signed-out culture on one Microbiology tube, an identification still on
 * a second Microbiology tube, and a Molecular tube in progress).
 */
const FULL_NAME = 'Mr. Sathish Kumaravel Ramasamy';
const PATIENT = { displayName: FULL_NAME, age: 29, sex: 'Male', mrn: 'AA0012', phone: '9876543210' };
const CULTURE_PARAMS = JSON.stringify({ parameters: [], microFormat: 'culture_sensitivity' });
const CULTURE_RESULT = JSON.stringify({
  note: 'Gram / Direct smear: …',
  stages: [
    { key: 'gram', caseLabel: null, values: { fields: [{ name: 'pus_cells', title: 'Pus Cells', value: 'Few' }] } },
    { key: 'growth', caseLabel: null, values: { fields: [
      { name: 'growth', title: 'Growth', value: 'Growth Detected' },
      { name: 'colony_count', title: 'Colony Count', value: '<10⁴ CFU/mL' }] } },
    { key: 'identification', caseLabel: null, values: { fields: [{ name: 'organism', title: 'Organism isolated', value: 'Abiotrophia spp.' }] } },
    { key: 'ast', caseLabel: null, values: {} },
  ],
  values: {
    noGrowth: false,
    organisms: [{ name: 'Abiotrophia spp.', antibiotics: [
      { name: 'Amoxicillin-Clavulanate', interpretation: '' }, { name: 'Cefixime', interpretation: '' },
      { name: 'Ceftazidime', interpretation: '' }, { name: 'Imipenem', interpretation: '' },
      { name: 'Ceftriaxone', interpretation: 'R' }, { name: 'Cefuroxime', interpretation: '' },
      { name: 'Cefoperazone-Sulbactam', interpretation: '' }, { name: 'Piperacillin-Tazobactam', interpretation: '' },
    ] }],
  },
});
const MIC = { id: 'dep-mic', code: 'MIC', name: 'Microbiology' };
const MOL = { id: 'dep-mol', code: 'MOL', name: 'Molecular Diagnostics' };
const HAEM = { id: 'dep-hae', code: 'HAE', name: 'Haematology' };

const PARTIAL_ORDER = {
  id: '7920cd24-aa27-48da-bc33-35f60010178a', orderNumber: 'LAB-2609-000089', createdAt: '2026-09-26T13:07:00Z',
  patient: PATIENT,
  samples: [
    { id: 's-mic-1', status: 'received', departmentId: MIC.id, department: MIC, tests: [
      { id: 'ot-cult', status: 'validated', currentResult: CULTURE_RESULT,
        test: { name: 'Bacterial Culture & Sensitivity', parameters: CULTURE_PARAMS } }] },
    { id: 's-mic-2', status: 'dispatched', departmentId: MIC.id, department: MIC, tests: [
      { id: 'ot-ident', status: 'pending', currentResult: null,
        test: { name: 'Bacterial Identification', parameters: CULTURE_PARAMS } }] },
    { id: 's-mol', status: 'received', departmentId: MOL.id, department: MOL, tests: [
      { id: 'ot-pcr', status: 'in_progress', currentResult: null,
        test: { name: 'Bacterial PCR Detection', parameters: JSON.stringify({ parameters: [] }) } }] },
  ],
};
/** A plain-values partial: Haematology ready (with a High + Critical), Micro pending. */
const VALUES_ORDER = {
  id: 'aaaa1111-0000-0000-0000-000000000000', orderNumber: null, createdAt: '2026-09-26T05:00:00Z',
  patient: { displayName: 'Ms. Paravai Munusamy', age: 44, sex: 'Female', mrn: 'AA0007' },
  samples: [
    { id: 's-hae', status: 'received', departmentId: HAEM.id, department: HAEM, tests: [
      { id: 'ot-cbc', status: 'validated',
        currentResult: JSON.stringify({ values: { hb: '18', k: '7' }, flagged: { hb: { flag: 'H', range: '12–15' }, k: { flag: 'C' } } }),
        test: { name: 'CBC', parameters: JSON.stringify({ parameters: [
          { name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }, { name: 'k', title: 'Potassium', unit: 'mmol/L' }] }) } }] },
    { id: 's-mic-3', status: 'received', departmentId: MIC.id, department: MIC, tests: [
      { id: 'ot-urine', status: 'entered', currentResult: null, test: { name: 'Urine Culture', parameters: CULTURE_PARAMS } }] },
  ],
};

const rep = (id: string, deliveryStatus: string, type = 'final', extra: Record<string, unknown> = {}) => ({
  id, orderId: `o-${id}`, patientId: 'p1', type, status: 'generated', deliveryStatus,
  createdAt: '2026-09-26T13:07:00Z', qrToken: 't',
  order: { id: `o-${id}`, orderNumber: 'LAB-2609-000102', patient: PATIENT },
  ...extra,
});
const QUEUE = [
  rep('r1', 'pending'), rep('r2', 'pending', 'partial'), rep('r3', 'delivered'), rep('r4', 'failed'),
];

const realMatchMedia = (window as any).matchMedia;
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

/** A paging server (DB optimisation phase 3) over `all`: status + a name
 *  search applied, then the page; counts over the whole queue. */
function pagedQueue(all: any[], url: string) {
  const qs = new URLSearchParams(url.split('?')[1] ?? '');
  const page = Number(qs.get('page') ?? 1), size = Number(qs.get('pageSize') ?? 50);
  const status = qs.get('status') ?? 'all', q = (qs.get('q') ?? '').toLowerCase();
  const rows = all.filter(r => (status === 'all' || r.deliveryStatus === status)
    && (!q || (r.order?.patient?.displayName ?? '').toLowerCase().includes(q)));
  const n = (st: string) => all.filter(r => r.deliveryStatus === st).length;
  return {
    items: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size,
    hasMore: page * size < rows.length,
    counts: { all: all.length, pending: n('pending'), delivered: n('delivered'), failed: n('failed') },
  };
}

async function render(opts: { touch?: boolean; orders?: unknown[]; queue?: unknown[]; nd?: boolean; perms?: string[]; wa?: Record<string, unknown>; waCloud?: boolean; paged?: boolean } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover') ? !opts.touch : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = {
    get: vi.fn((url: string) => {
      // Default: a server that predates paging answers the whole queue as an
      // array whatever the params (the screen must still work against it).
      if (url.startsWith('/api/reports/queue?view=summary'))
        return of(opts.paged ? pagedQueue((opts.queue ?? QUEUE) as any[], url) : (opts.queue ?? QUEUE));
      if (url === '/api/orders/partial-ready') return of(opts.orders ?? [PARTIAL_ORDER, VALUES_ORDER]);
      if (url === '/api/billing/outstanding') return of({ due: [{ orderId: 'o-r1' }] });
      if (url === '/api/whatsapp/settings') return of({ canSend: !!opts.waCloud });
      return of([]);
    }),
    post: vi.fn((url: string, _body?: unknown) => (url === '/api/whatsapp/status' ? of(opts.wa ?? {})
      : url.endsWith('/resend') ? of({ id: 'm9', reportId: 'r1', trigger: 'resend', kind: 'report_ready', status: 'sent', attempts: 1,
          to: '••••••••3210', toDisplay: '+91 ••••• 43210', createdAt: '2026-09-28T10:00:00Z' })
      : of({}))),
  };
  const router = { url: '/reports', navigate: vi.fn(() => Promise.resolve(true)), events: of() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: ThemeService, useValue: { isNewDesign: signal(opts.nd !== false), isDark: signal(false) } },
      { provide: LiveQueueService, useValue: { on: () => EMPTY } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { prompt: vi.fn(async () => null), confirm: vi.fn(async () => false) } },
      { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World' }), hasPermission: (p: string) => !opts.perms || opts.perms.includes(p), hasAnyPermission: (ps: string[]) => !opts.perms || ps.some(p => opts.perms!.includes(p)) } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), tap: () => true, rearm() {}, attachSource() {}, detachSource() {} } },
      { provide: Router, useValue: router },
    ],
  });
  const f = TestBed.createComponent(ReportQueueComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  const c = f.componentInstance as any;
  const el = f.nativeElement as HTMLElement;
  const tab = (v: string) => {
    (el.querySelector(`.pf-rq-seg [data-filter="${v}"]`) as HTMLElement).click();
    f.detectChanges();
  };
  return { f, el, c, api, router, tab };
}

const menuItems = () => [...document.body.querySelectorAll('[role=menu] [role=menuitem] .pf-am-item__t')].map(b => b.textContent!.trim());
const closeMenus = () => document.querySelectorAll('.pf-am-layer').forEach(n => n.remove());

const primaries = (el: HTMLElement) =>
  el.querySelectorAll('.pf-btn--primary, .pf-hb-btn--primary, pf-touch-btn[variant="primary"], .pf-btn--primary');
/** Component CSS with Angular's scoping attributes stripped. */
const css = () => ((ReportQueueComponent as any).ɵcmp.styles as string[]).join('\n')
  .replace(/\[_ng(content|host)-%COMP%\]/g, '');
/** Just the new-design rules (the classic look keeps its own palette). */
const ndCss = () => css().slice(css().indexOf('.pf-rq-seg'));

describe('Reports list — summary rows (DB optimisation phase 2)', () => {
  it('loads the queue through the summary view (no rendered snapshots in the list)', async () => {
    const { api } = await render();
    const urls = api.get.mock.calls.map((c: unknown[]) => c[0] as string).filter((u: string) => u.startsWith('/api/reports/queue'));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u: string) => u.startsWith('/api/reports/queue?view=summary&'))).toBe(true);
  });

  it('rendering a row with nothing stored yet (download / print / share / archive) reads the full report by id first', async () => {
    const { c, api } = await render();
    const row = { id: 'r-sum', orderId: 'o1', type: 'final', deliveryStatus: 'pending' };
    await c.storedPdf(row).catch(() => { /* the render itself needs more than this stub */ });
    expect(api.get).toHaveBeenCalledWith('/api/reports/r-sum');
  });
});

describe('Reports list (nd) — band', () => {
  it('ONE status filter in the pill: neutral radios with plain tabular counts, no stats strip', async () => {
    const { el } = await render();
    const band = el.querySelector('pf-hero-band') as HTMLElement;
    const seg = band.querySelector('pf-segmented.pf-rq-seg') as HTMLElement;
    const rg = seg.querySelector('[role=radiogroup]') || seg;
    expect(rg.getAttribute('role')).toBe('radiogroup');
    const items = [...seg.querySelectorAll<HTMLElement>('[role=radio]')];
    expect(items.map(i => (i.querySelector('.seg-lbl') || i.querySelector('.pf-rq-seg__lbl'))!.textContent!.trim()))
      .toEqual(['All', 'Completed', 'Partial', 'Delivered', 'Failed']);
    expect(items.map(i => (i.querySelector('.seg-count') || i.querySelector('.pf-rq-seg__count'))!.textContent!.trim())).toEqual(['6', '2', '2', '1', '1']);
    items.forEach(i => expect((i.querySelector('.seg-count') || i.querySelector('.pf-rq-seg__count'))!.classList).toContain('pf-num'));
    // Default = Completed, raised neutral (aria-checked), never a gradient.
    expect(seg.querySelector('[aria-checked="true"]')?.getAttribute('data-filter')).toBe('pending');
    // No duplicate strip anywhere, no second filter control.
    expect(el.querySelector('.pf-rq-stats, .pf-rq-stat, .pf-rq-statbtn, .pf-rq-filter-m')).toBeNull();
    expect(el.querySelectorAll('[role=radiogroup]').length).toBe(1);
  });

  it('no coloured status dots — only Failed may use the muted red (its count)', async () => {
    const { el } = await render();
    expect(el.querySelector('.seg-dot, .pf-rq-stat__dot, .pf-rq-row__accent')).toBeNull();
    const warn = [...el.querySelectorAll('.seg-count--warn, .pf-rq-seg__count--warn')];
    expect(warn.length).toBe(1);
    expect(warn[0].closest('[data-filter]')?.getAttribute('data-filter')).toBe('failed');
    expect(ndCss()).not.toMatch(/#(a78bfa|f59e0b|38bdf8|10b981|f43f5e)/i);
  });

  it('arrow keys move the filter (radiogroup)', async () => {
    const { el, c, f } = await render();
    // pf-segmented owns the keys on its radiogroup: the event comes from the checked radio and bubbles up to it.
    const checked = el.querySelector('.pf-rq-seg [role="radio"][aria-checked="true"]') as HTMLElement;
    expect(checked.getAttribute('data-filter')).toBe('pending');
    checked.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    f.detectChanges();
    expect(c.filter()).toBe('partial');
  });

  it('Generate is a quiet band action — the page has no primary on any tab', async () => {
    const { el, tab, c, f } = await render();
    const gen = el.querySelector('.pf-rq-generate') as HTMLElement;
    expect(gen.classList).toContain('pf-hb-btn--ghost');
    for (const v of ['all', 'pending', 'delivered', 'failed', 'partial']) {
      tab(v);
      expect(primaries(el).length).toBeLessThanOrEqual(1);
      expect(primaries(el).length).toBe(0);
    }
    c.toggle(PARTIAL_ORDER.id); f.detectChanges();
    expect(primaries(el).length).toBe(0);
    expect(el.querySelector('.pf-rq-genpartial')!.classList).toContain('pf-btn--secondary');
  });
});

describe('Reports list (nd) — report cards (Completed / Delivered / Failed / All)', () => {
  it('full name, Noto meta with the order number, neutral chips, secondary row actions, zoom source', async () => {
    const { el, f, tab } = await render();
    tab('all');
    const cards = [...el.querySelectorAll<HTMLElement>('.pf-rq-card--report')];
    expect(cards.length).toBe(4);
    const first = cards[0];
    expect(first.querySelector('.pf-rq-card__name')!.textContent!.trim()).toBe(FULL_NAME);
    const meta = first.querySelector('.pf-rq-card__meta')!.textContent!.trim();
    expect(meta).toContain('29/M · AA0012 · Order LAB-2609-000102');
    expect(meta).not.toContain('|');
    expect(el.textContent).not.toContain('..');
    // ONE status per card (dot + coloured word, no chip) — see the status block below.
    expect(el.querySelector('pf-chip')).toBeNull();
    // Row actions: kit .pf-rowact (secondary), text on web.
    const acts = first.querySelectorAll('.pf-rowact');
    expect(acts.length).toBe(5);
    expect(first.querySelector('.pf-rowact[aria-label="View"]')!.classList).not.toContain('pf-rowact--icon');
    // List → report view zoom keeps working: every card is a zoom source.
    const zs = f.debugElement.queryAll(By.directive(ZoomSourceDirective));
    expect(zs.length).toBe(4);
    expect(zs[0].injector.get(ZoomSourceDirective).keys()).toEqual(['r1', 'o-r1']);
  });

  it('touch: row actions become 44px icons (label kept for AT)', async () => {
    const { el, tab } = await render({ touch: true });
    tab('all');
    const view = el.querySelector('.pf-rq-card--report .pf-rowact[aria-label="View"]') as HTMLElement;
    expect(view.classList).toContain('pf-rowact--icon');
    expect(view.querySelector('.pf-rowact__t')!.textContent).toBe('View');
  });

  it('View opens the report', async () => {
    const { el, tab, router } = await render();
    tab('all');
    (el.querySelector('.pf-rq-card--report .pf-rowact[aria-label="View"]') as HTMLElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/reports/view', 'r1']);
  });

  it('empty states use .pf-empty', async () => {
    const { el, tab } = await render({ queue: [], orders: [] });
    tab('delivered');
    expect(el.querySelector('.pf-empty .pf-empty__title')!.textContent).toContain('No reports here');
    tab('partial');
    expect(el.querySelector('.pf-empty .pf-empty__title')!.textContent).toContain('No partial reports');
  });
});

describe('Reports list (nd) — ONE status per card (dot + coloured word, no chip)', () => {
  const statuses = (card: Element) => [...card.querySelectorAll<HTMLElement>('.pf-rq-status')];

  it('every card on every tab has at most one status element, never a chip', async () => {
    const { el, tab } = await render();
    for (const v of ['all', 'pending', 'partial', 'delivered', 'failed']) {
      tab(v);
      const cards = [...el.querySelectorAll<HTMLElement>('.pf-rq-card')];
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        const head = card.querySelector('.pf-rq-card__head') as HTMLElement;
        expect(statuses(head).length).toBe(1);
        expect(head.querySelector('.pf-chip, pf-chip, .pf-rq-type, .pf-rq-unpaid, .pf-rq-chip')).toBeNull();
        const s = statuses(head)[0];
        expect(s.classList).not.toContain('pf-chip');
        expect(s.querySelector('.pf-rq-status__dot, .pf-rq-status__mark')).not.toBeNull();
      }
    }
  });

  it('labels + tones on All: Unpaid (red), Preliminary (amber, not Completed), Delivered (check), Failed (red)', async () => {
    const { el, tab } = await render();
    tab('all');
    const cards = [...el.querySelectorAll<HTMLElement>('.pf-rq-card--report')];
    const got = cards.map(c => {
      const s = statuses(c)[0];
      return [s.textContent!.trim(), s.getAttribute('data-tone')];
    });
    // r1 is Completed but its bill is due → Unpaid; r2 is a partial report.
    expect(got).toEqual([['Unpaid', 'red'], ['Preliminary', 'amber'], ['Delivered', 'green'], ['Failed', 'red']]);
    expect(cards[1].textContent).not.toContain('Completed');
    expect(cards[2].querySelector('.pf-rq-status__mark')).not.toBeNull();
    // What the one status hides moves to the meta line, not a second chip.
    expect(cards[0].querySelector('.pf-rq-card__meta')!.textContent).not.toContain('Payment due');
  });

  it('a delivered or unpaid preliminary keeps "Preliminary" in the meta line', async () => {
    const q = [rep('d1', 'delivered', 'partial'), rep('r1', 'pending', 'partial')];
    const { el, tab } = await render({ queue: q });
    tab('all');
    const cards = [...el.querySelectorAll<HTMLElement>('.pf-rq-card--report')];
    expect(statuses(cards[0])[0].textContent!.trim()).toBe('Delivered');
    expect(cards[0].querySelector('.pf-rq-card__meta')!.textContent).toMatch(/ · Preliminary$/);
    expect(statuses(cards[1])[0].textContent!.trim()).toBe('Unpaid');   // o-r1 has a balance due
    expect(cards[1].querySelector('.pf-rq-card__meta')!.textContent).toMatch(/ · Preliminary$/);
  });

  it('CSS: no chip background, fixed right column, app status tokens only', () => {
    const rule = (sel: string) => {
      const m = ndCss().match(new RegExp(sel.replace(/[.[\]'()]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
      return m ? m[1] : '';
    };
    const base = rule('.pf-rq-status');
    expect(base).toMatch(/background: none/);
    expect(base).toMatch(/border: 0/);
    expect(base).toMatch(/min-width: \d+px/);
    expect(base).toMatch(/justify-content: flex-end/);
    expect(base).toMatch(/--pf-tone: var\(--green-text\)/);
    // (the compiler may drop or swap the attribute quotes)
    const tone = (t: string) => ndCss().match(new RegExp(`\\.pf-rq-status\\[data-tone=["']?${t}["']?\\]\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(tone('amber')).toMatch(/var\(--amber-text\)/);
    expect(tone('red')).toMatch(/var\(--red-text\)/);
  });

  it('reportStatus priority', () => {
    expect(reportStatus('pending', 'final', false)).toMatchObject({ label: 'Completed', tone: 'green', extra: [] });
    expect(reportStatus('pending', 'partial', false)).toMatchObject({ label: 'Preliminary', tone: 'amber', extra: [] });
    expect(reportStatus('pending', 'partial', true)).toMatchObject({ label: 'Unpaid', tone: 'red', extra: ['Preliminary'] });
    expect(reportStatus('delivered', 'partial', true)).toMatchObject({ label: 'Delivered', extra: ['Preliminary', 'Payment due'] });
    expect(reportStatus('failed', 'final', false)).toMatchObject({ label: 'Failed', tone: 'red' });
  });
});

describe('Reports list (nd) — Partial tab, truthful per department', () => {
  async function openPartial() {
    const r = await render();
    r.tab('partial');
    const card = r.el.querySelector(`.pf-rq-card--partial`) as HTMLElement;
    (card.querySelector('.pf-rq-card__toggle') as HTMLElement).click();
    r.f.detectChanges();
    return { ...r, card };
  }

  it('header: full name (wraps), "29/M · AA0012 · Order …" in Noto, a neutral department chip', async () => {
    const { card } = await openPartial();
    expect(card.querySelector('.pf-rq-card__name')!.textContent!.trim()).toBe(FULL_NAME);
    const meta = card.querySelector('.pf-rq-card__meta')!.textContent!.trim();
    expect(meta.startsWith('29/M · AA0012 · Order LAB-2609-000089 · ')).toBe(true);
    expect(meta).not.toMatch(/\||#7920cd24|created/);
    // 2 departments (MIC with 2 tubes, MOL): MIC is partly ready, MOL pending.
    // The count is a meta line under the name, not a chip; the status is ONE
    // amber "Preliminary" word.
    expect(card.querySelector('.pf-rq-chip, .pf-rq-card__head .pf-chip')).toBeNull();
    expect(card.querySelector('.pf-rq-card__count')!.textContent!.trim()).toBe('1 of 2 departments partly ready');
    const st = card.querySelectorAll('.pf-rq-card__head .pf-rq-status');
    expect(st.length).toBe(1);
    expect(st[0].textContent!.trim()).toBe('Preliminary');
    expect(st[0].getAttribute('data-tone')).toBe('amber');
  });

  it('Microbiology is ONE section that says what prints: the culture ready, the identification pending', async () => {
    const { card } = await openPartial();
    const depts = [...card.querySelectorAll<HTMLElement>('.pf-rq-dept')];
    expect(depts.length).toBe(1);                      // MOL has nothing ready → named in "Still pending" only
    const mic = depts[0];
    expect(mic.querySelector('.pf-rq-dept__code')!.classList).toContain('pf-chip');
    expect(mic.querySelector('.pf-rq-dept__name')!.textContent!.trim()).toBe('Microbiology');
    expect(mic.querySelector('.pf-rq-dept__note')!.textContent!.trim()).toBe('1 of 2 tests ready');
    const tests = [...mic.querySelectorAll<HTMLElement>('.pf-rq-test')];
    expect(tests.map(t => t.querySelector('.pf-rq-test__state')!.textContent!.trim())).toEqual(['Ready', 'Pending']);
    expect(tests[1].querySelector('.pf-rq-test__status')!.textContent).toContain('Sample not received at the lab yet');
  });

  it('culture tests show the stage summary, never "No parameter values"', async () => {
    const { card, el } = await openPartial();
    const dl = card.querySelector('.pf-rq-culture') as HTMLElement;
    const rows = [...dl.querySelectorAll('.pf-rq-culture__row')]
      .map(r => `${r.querySelector('dt')!.textContent!.trim()} ${r.querySelector('dd')!.textContent!.trim()}`);
    expect(rows).toEqual(['Growth Growth Detected (<10⁴ CFU/mL)', 'Organism Abiotrophia spp.', 'AST 8 drugs · 1 resistant']);
    expect(el.textContent).not.toMatch(/No parameter values/i);
  });

  it('pending = a neutral info row with an SVG clock and department NAMES (no emoji, no amber)', async () => {
    const { card } = await openPartial();
    const p = card.querySelector('.pf-rq-pending') as HTMLElement;
    expect(p.querySelector('svg')).not.toBeNull();
    const txt = p.textContent!.replace(/\s+/g, ' ');
    expect(txt).toContain('Microbiology (1 of 2 tests)');
    expect(txt).toContain('Molecular Diagnostics');
    expect(txt).not.toMatch(/⏳|MIC,|MOL/);
    expect(ndCss()).not.toMatch(/245,\s*158,\s*11|#f59e0b|34,\s*211,\s*238|#67e8f9/);
  });

  it('Generate partial PDF (secondary) sends only the fully validated tubes', async () => {
    const { card, api, f } = await openPartial();
    (card.querySelector('.pf-rq-genpartial') as HTMLElement).click();
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/reports/generate/partial', { orderId: PARTIAL_ORDER.id, sampleIds: ['s-mic-1'] });
  });

  it('plain results: value rows with words for flags (High) and the critical badge (C / CL / CH), no glyphs', async () => {
    const r = await render();
    r.tab('partial');
    r.c.toggle(VALUES_ORDER.id); r.f.detectChanges();
    const card = r.el.querySelectorAll<HTMLElement>('.pf-rq-card--partial')[1];
    expect(card.querySelector('.pf-rq-card__meta')!.textContent).toContain('44/F · AA0007 · Order #AAAA1111');
    expect(card.querySelector('.pf-rq-card__count')!.textContent!.trim()).toBe('1 of 2 departments ready');
    const flags = [...card.querySelectorAll('.pf-rq-value__flag')].map(x => x.textContent!.trim());
    expect(flags).toEqual(['High', 'C']);   // legacy saved 'C' shows as C; new rows badge CL / CH
    expect(card.textContent).not.toMatch(/[⚠⚑✓]/);
    expect(card.querySelector('.pf-rq-pending')!.textContent).toContain('Microbiology');
  });

  it('collapse: aria-expanded + inert when closed; motion is off under reduced motion', async () => {
    const r = await render();
    r.tab('partial');
    const card = r.el.querySelector('.pf-rq-card--partial') as HTMLElement;
    const btn = card.querySelector('.pf-rq-card__toggle') as HTMLElement;
    const body = card.querySelector('.pf-rq-card__collapse') as HTMLElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(body.hasAttribute('inert')).toBe(true);
    btn.click(); r.f.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(body.hasAttribute('inert')).toBe(false);
    expect(css()).toMatch(/prefers-reduced-motion: reduce[\s\S]*pf-rq-card__collapse/);
  });

  it('the Partial tab honours the band search', async () => {
    const r = await render();
    r.tab('partial');
    r.c.setQuery('paravai'); r.f.detectChanges();
    const names = [...r.el.querySelectorAll('.pf-rq-card--partial .pf-rq-card__name')].map(n => n.textContent!.trim());
    expect(names).toEqual(['Ms. Paravai Munusamy']);
  });
});

describe('Reports list (nd) — one font, no native controls', () => {
  it('no monospace anywhere in the component CSS; no native select / datalist', async () => {
    const { el } = await render();
    expect(css()).not.toMatch(/monospace|JetBrains|Courier/i);
    expect(el.querySelector('select, datalist')).toBeNull();
  });
});

describe('report-queue.partial helpers', () => {
  it('culture progress in plain words', () => {
    const t = (status: string, currentResult: string | null = null) => ({ status, currentResult } as any);
    const snap3 = JSON.stringify({ stages: [{ key: 'gram' }, { key: 'growth' }, { key: 'identification' }, { key: 'growth', caseLabel: 'Sub A' }] });
    expect(cultureStagesDone(snap3)).toBe(3);
    expect(pendingStatus(t('in_progress', snap3), { status: 'received' }, true)).toBe('Culture in progress · 3 of 4 stages done');
    expect(pendingStatus(t('in_progress'), { status: 'received' }, true)).toBe('Culture in progress on the bench');
    expect(pendingStatus(t('entered'), { status: 'received' }, true)).toBe('Culture awaiting sign-out');
    expect(pendingStatus(t('entered'), { status: 'received' }, false)).toBe('Awaiting validation');
    expect(pendingStatus(t('validated'), { status: 'received' }, false)).toContain('rest of its tube');
    expect(pendingStatus(t('pending'), { status: 'received' }, false)).toBe('Not started');
  });

  it('no growth reads as such; empty snapshot = no lines', () => {
    expect(cultureSummary(JSON.stringify({ values: { noGrowth: true, organisms: [] }, stages: [] })))
      .toEqual([{ label: 'Growth', value: 'No growth' }]);
    expect(cultureSummary(null)).toEqual([]);
  });

  it('department count label', () => {
    expect(deptCountLabel(1, 0, 3)).toBe('1 of 3 departments ready');
    expect(deptCountLabel(0, 1, 2)).toBe('1 of 2 departments partly ready');
    expect(deptCountLabel(1, 1, 3)).toBe('1 of 3 departments ready · 1 partly');
  });
});

describe('Reports list — same reports for every viewer, actions by permission', () => {
  const rowNames = (el: HTMLElement) => [...el.querySelectorAll('.pf-rq-card__name, .pf-rq-row p.font-semibold')].map(n => n.textContent!.trim());

  for (const nd of [true, false]) {
    it(`view_report-only sees the SAME rows, minus the send actions (${nd ? 'new' : 'classic'} design)`, async () => {
      const full = await render({ nd, perms: ['deliver_report', 'view_report', 'edit_result'] });
      full.c._filter.set('all'); full.f.detectChanges();
      const fullRows = rowNames(full.el);
      expect(fullRows.length).toBeGreaterThan(0);
      expect(full.el.querySelector('[title="WhatsApp Chat"]')).not.toBeNull();
      TestBed.resetTestingModule();

      const viewer = await render({ nd, perms: ['view_report'] });
      viewer.c._filter.set('all'); viewer.f.detectChanges();
      expect(rowNames(viewer.el)).toEqual(fullRows);                       // identical list
      expect(viewer.el.querySelector('[title="WhatsApp Chat"]')).toBeNull();  // no delivery
      expect(viewer.el.querySelector('[title="View on screen"]')).not.toBeNull();
      expect(viewer.el.querySelector('[title="Download PDF"]')).not.toBeNull();
      // No Generate / Regenerate; branch managers (no edit_result, no bench
      // perms) get the ⋮ with read-only rows only (View / Download / Print).
      expect(viewer.el.querySelector('.pf-rq-generate')).toBeNull();
      const r0 = viewer.c.items()[0];
      expect(viewer.c.rowActions().get(r0.id).map((a: { id: string }) => a.id)).toEqual(['view', 'download', 'print']);
    });
  }

  it('view-only: a "View only" chip replaces Generate in the band; Partial has no Generate button', async () => {
    const { el, tab } = await render({ perms: ['view_report'] });
    expect(el.querySelector('.pf-rq-viewonly')?.textContent?.trim()).toBe('View only');
    expect(el.querySelector('.pf-rq-generate')).toBeNull();
    tab('partial');
    expect(el.querySelectorAll('.pf-rq-card').length).toBeGreaterThan(0);
    expect(el.querySelector('.pf-rq-genpartial')).toBeNull();
  });

  it('view-only + edit_result (Lab Technician): the ⋮ keeps Open lab results + Edit, never Regenerate / share', async () => {
    const { el, f } = await render({ perms: ['view_report', 'edit_result', 'enter_result'] });
    const more = el.querySelector('.pf-rq-more') as HTMLButtonElement;
    expect(more).not.toBeNull();
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    more.click(); f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    const items = menuItems();
    expect(items).toEqual(['View report', 'Download PDF', 'Print', 'Edit results', 'Open lab results']);
    closeMenus();
  });

  it('view-only: the send / generate handlers are inert even if called directly', async () => {
    const { c, api } = await render({ perms: ['view_report'] });
    const r = c.items()[0];
    c.deliver(r, 'print');
    await c.regenerate(r);
    await c.promptGenerate();
    c.generatePartial({ id: 'o1', readySampleIds: ['s1'] });
    const posted = (api.post.mock.calls as unknown as unknown[][]).map(a => String(a[0]));
    expect(posted.filter((u: string) => /\/deliver|\/generate/.test(u))).toEqual([]);
  });

  for (const nd of [true, false]) {
    it(`view-only can PRINT from the list (${nd ? 'new' : 'classic'} design) — a row Print, no Share menu`, async () => {
      const { el, c, f } = await render({ nd, perms: ['view_report'] });
      c._filter.set('all'); f.detectChanges();
      const print = el.querySelector('.pf-rq-print') as HTMLButtonElement;
      expect(print).not.toBeNull();
      expect(el.querySelector('[title="WhatsApp Chat"]')).toBeNull();
      const spy = vi.spyOn(c, 'printReport').mockResolvedValue(undefined);
      print.click();
      expect(spy).toHaveBeenCalled();
    });
  }

  it('view-only print is NOT a delivery: nothing is recorded', async () => {
    const { c, api } = await render({ perms: ['view_report'] });
    api.post.mockClear();   // init's /backfill
    const job = vi.spyOn(c, 'printJob').mockResolvedValue(true);
    await c.printReport(c.items()[0]);
    expect(job).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('the delivery desk\'s print still records the delivery (via print); a dismissed print records nothing', async () => {
    const { c, api } = await render({ perms: ['deliver_report', 'view_report'] });
    api.post.mockClear();   // init's /backfill
    const job = vi.spyOn(c, 'printJob').mockResolvedValue(true);
    await c.printReport(c.items()[0]);
    expect(api.post).toHaveBeenCalledWith(`/api/reports/${c.items()[0].id}/deliver`, expect.objectContaining({ via: 'print' }));
    api.post.mockClear();
    job.mockResolvedValue(false);
    await c.printReport(c.items()[0]);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('the delivery desk keeps Print inside the Share menu, not as a row button', async () => {
    const { el } = await render({ perms: ['deliver_report', 'view_report'] });
    expect(el.querySelector('.pf-rq-print')).toBeNull();
  });

  it('no report permission → no print at all', async () => {
    const { c, api } = await render({ perms: ['edit_result'] });
    api.post.mockClear();   // init's /backfill
    const job = vi.spyOn(c, 'printJob').mockResolvedValue(true);
    await c.printReport(c.items()[0] ?? { id: 'x' });
    expect(job).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('the delivery desk (deliver_report) keeps Generate and Regenerate', async () => {
    const { el, f } = await render({ perms: ['deliver_report', 'view_report'] });
    expect(el.querySelector('.pf-rq-generate')).not.toBeNull();
    expect(el.querySelector('.pf-rq-viewonly')).toBeNull();
    (el.querySelector('.pf-rq-more') as HTMLButtonElement).click(); f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    expect(menuItems()).toContain('Regenerate');
    closeMenus();
  });
});

describe('Reports list — ⋮ report actions', () => {
  afterEach(() => closeMenus());
  const ids = (c: any, i = 0) => c.rowActions().get(c.items()[i].id).map((a: { id: string }) => a.id);

  it('full delivery desk: share rows, the PDF, workflow steps and go-to — in that order', async () => {
    const { c } = await render({ perms: ['deliver_report', 'view_report', 'view_order', 'edit_result', 'view_patient', 'enter_result'] });
    expect(ids(c)).toEqual(['share', 'copy-link', 'whatsapp-mine', 'email', 'view', 'download', 'print', 'edit', 'regenerate', 'patient', 'lab']);
  });

  it('pathologist in Results (view_report + validate_result): no share rows, but Regenerate', async () => {
    const { c } = await render({ perms: ['view_report', 'validate_result'] });
    expect(ids(c)).toEqual(['view', 'download', 'print', 'regenerate', 'lab']);
  });

  it('every row id runs the SAME existing handler', async () => {
    const { c } = await render();
    const r = c.items()[0];
    const spies = {
      deliver: vi.spyOn(c, 'deliver').mockImplementation(() => {}),
      view: vi.spyOn(c, 'view').mockImplementation(() => {}),
      downloadPdf: vi.spyOn(c, 'downloadPdf').mockResolvedValue(undefined),
      printReport: vi.spyOn(c, 'printReport').mockResolvedValue(undefined),
      openEditDialog: vi.spyOn(c, 'openEditDialog').mockImplementation(() => {}),
      regenerate: vi.spyOn(c, 'regenerate').mockResolvedValue(undefined),
      viewLabResults: vi.spyOn(c, 'viewLabResults').mockResolvedValue(undefined),
    };
    for (const id of ['whatsapp', 'view', 'download', 'print', 'edit', 'regenerate', 'lab']) c.runRowAction(r, id);
    expect(spies.deliver).toHaveBeenCalledWith(r, 'whatsapp');
    for (const k of ['view', 'downloadPdf', 'printReport', 'openEditDialog', 'regenerate', 'viewLabResults'] as const) {
      expect(spies[k], k).toHaveBeenCalledWith(r);
    }
  });

  it('Regenerate from the menu still asks first (DialogService) — cancel posts nothing', async () => {
    const { c, api } = await render();
    api.post.mockClear();
    c.runRowAction(c.items()[0], 'regenerate');
    await new Promise(r => setTimeout(r, 0));
    const dialog = TestBed.inject(DialogService) as any;
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Open patient goes to the patient profile', async () => {
    const { c, router } = await render();
    c.runRowAction(c.items()[0], 'patient');
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/patients', 'p1']);
  });

  it('the ⋮ is a vertical-dots SVG button with a label, on web and touch', async () => {
    for (const touch of [false, true]) {
      const { el } = await render({ touch });
      const more = el.querySelector('.pf-rq-more') as HTMLButtonElement;
      expect(more.getAttribute('aria-label')).toBe('Report actions');
      expect(more.querySelectorAll('svg path').length).toBe(3);
      expect(more.classList.contains('pf-rowact--icon')).toBe(touch);
      TestBed.resetTestingModule();
    }
  });
});

describe('Reports list (nd) — WhatsApp auto-send status', () => {
  it('asks once for the final reports on screen and puts the WhatsApp status in the card meta', async () => {
    const { el, api, tab } = await render({
      wa: {
        r1: { id: 'm1', reportId: 'r1', trigger: 'auto', kind: 'report_ready', status: 'sent', attempts: 1, createdAt: '2026-09-26T13:08:00Z' },
        r4: { id: 'm4', reportId: 'r4', trigger: 'auto', kind: 'report_ready', status: 'failed', attempts: 1, createdAt: '2026-09-26T13:08:00Z' },
      },
    });
    const loads = () => api.get.mock.calls.filter((c: unknown[]) => (c[0] as string).startsWith('/api/reports/queue')).length;
    tab('all');
    const calls = api.post.mock.calls.filter((c: unknown[]) => c[0] === '/api/whatsapp/status');
    // One batch per queue load (the All tab is its own server page).
    expect(calls.length).toBe(loads());
    // Partials never go on WhatsApp — only finals are asked about.
    expect((calls.at(-1)![1] as unknown as { reportIds: string[] }).reportIds).toEqual(['r1', 'r3', 'r4']);
    const metas = [...el.querySelectorAll<HTMLElement>('.pf-rq-card__meta')].map(m => m.textContent!.trim());
    expect(metas.some(m => m.endsWith('WhatsApp sent'))).toBe(true);
    expect(metas.some(m => m.endsWith('WhatsApp failed'))).toBe(true);
  });

  it('no WhatsApp data → the meta is unchanged', async () => {
    const { el, tab } = await render();
    tab('all');
    const metas = [...el.querySelectorAll<HTMLElement>('.pf-rq-card__meta')].map(m => m.textContent!);
    expect(metas.every(m => !m.includes('WhatsApp'))).toBe(true);
  });
});

describe('Reports list — ONE WhatsApp action: Auto, else Chat', () => {
  afterEach(() => closeMenus());
  const ids = (c: any, i = 0) => c.rowActions().get(c.items()[i].id).map((a: { id: string }) => a.id);

  it('the ⋮ offers ONE WhatsApp row — WhatsApp Auto — when the lab has a sender', async () => {
    const { c } = await render({ waCloud: true, perms: ['deliver_report', 'view_report', 'view_order'] });
    expect(ids(c)).toEqual(['share', 'copy-link', 'whatsapp', 'email', 'view', 'download', 'print', 'regenerate']);
    expect(c.rowActions().get(c.items()[0].id).find((a: { id: string }) => a.id === 'whatsapp').label).toBe('WhatsApp Auto');
  });

  it('no sender: the ONE row is WhatsApp Chat', async () => {
    const { c } = await render({ waCloud: false, perms: ['deliver_report', 'view_report', 'view_order'] });
    expect(ids(c)).toContain('whatsapp-mine');
    expect(ids(c)).not.toContain('whatsapp');
    expect(c.rowActions().get(c.items()[0].id).find((a: { id: string }) => a.id === 'whatsapp-mine').label).toBe('WhatsApp Chat');
  });

  it('WhatsApp posts the server send (no wa.me window) and the row meta shows Sent + the masked number', async () => {
    const { c, el, f, api, tab } = await render({ waCloud: true });
    tab('all');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const r = c.items().find((x: { id: string }) => x.id === 'r1');
    c.deliver(r, 'whatsapp');
    await new Promise(res => setTimeout(res, 0));
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/whatsapp/reports/r1/resend', {});
    expect(open).not.toHaveBeenCalled();
    const metas = [...el.querySelectorAll<HTMLElement>('.pf-rq-card__meta')].map(m => m.textContent!.trim());
    expect(metas.some(m => m.endsWith('WhatsApp sent · +91 ••••• 43210'))).toBe(true);
    (TestBed.inject(WhatsAppSendService) as any).stopWatch('r1');
  });

  it('WhatsApp Chat: one click (no confirm), the click-to-chat window on this computer; recorded once it opened', async () => {
    const { c, api } = await render({ waCloud: true });
    const manual = TestBed.inject(WhatsAppManualService);
    const open = vi.fn((..._a: unknown[]) => ({ opener: null, focus: vi.fn() }));
    manual.win = { open, screen: { availWidth: 1440, availHeight: 900 }, navigator: { userAgent: 'Macintosh' } } as never;
    manual.bridge = () => null;
    const r = c.items()[0];
    c.runRowAction(r, 'whatsapp-mine');
    for (let i = 0; i < 4; i++) await new Promise(res => setTimeout(res, 0));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://web.whatsapp.com/send?'), 'pf-whatsapp');
    expect(api.post).not.toHaveBeenCalledWith(expect.stringMatching(/\/resend$/), {});
    expect(api.post).toHaveBeenCalledWith(`/api/reports/${r.id}/deliver`, { via: 'whatsapp', note: 'WhatsApp opened (manual)' });
  });

  it('WhatsApp Chat, patient opted out and the person cancels: nothing opens, nothing recorded', async () => {
    const { c, api } = await render({ waCloud: false });
    const base = api.get.getMockImplementation() as (url: string) => unknown;
    api.get.mockImplementation(((url: string) =>
      url.startsWith('/api/whatsapp/reports/') ? of({ patientOptOut: true }) : base(url)) as never);
    const manual = TestBed.inject(WhatsAppManualService);
    const open = vi.fn();
    manual.win = { open, screen: { availWidth: 1440, availHeight: 900 }, navigator: { userAgent: 'Macintosh' } } as never;
    manual.bridge = () => null;
    const r = c.items()[0];
    c.deliver(r, 'whatsapp');
    for (let i = 0; i < 4; i++) await new Promise(res => setTimeout(res, 0));
    expect(TestBed.inject(DialogService).confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'This patient opted out of WhatsApp' }));
    expect(open).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalledWith(`/api/reports/${r.id}/deliver`, expect.anything());
  });
});

describe('Reports list — server paging (DB optimisation phase 3)', () => {
  const many = (n: number, status = 'pending') =>
    Array.from({ length: n }, (_, i) => rep(`p${String(i).padStart(3, '0')}`, status));
  const queueUrls = (api: any) => api.get.mock.calls.map((c: unknown[]) => c[0] as string)
    .filter((u: string) => u.startsWith('/api/reports/queue'));
  const cards = (el: HTMLElement) => el.querySelectorAll('.pf-rq-card--report').length;
  const moreBtn = (el: HTMLElement) => el.querySelector('.pf-rq-more__btn') as HTMLButtonElement | null;
  const settle = async (f: any) => { await f.whenStable(); f.detectChanges(); };

  it('asks for page 1 of the default (Completed) tab, 50 rows', async () => {
    const { api } = await render({ paged: true });
    expect(queueUrls(api)[0]).toBe('/api/reports/queue?view=summary&page=1&pageSize=50&status=pending');
  });

  it('tab counts come from the server (whole queue), not the loaded page', async () => {
    const queue = [...many(120), rep('f1', 'failed'), rep('d1', 'delivered')];
    const { c } = await render({ paged: true, queue });
    expect(c.items().length).toBe(50);
    expect(c.counts()).toEqual({ all: 122, pending: 120, delivered: 1, failed: 1 });
    const byTab = Object.fromEntries(c.ndFilters().map((x: any) => [x.value, x.count]));
    // The All pill = the server's 122 reports + the 2 partly-reported orders that have no report row (OPS-136).
    expect(byTab).toMatchObject({ all: 124, pending: 120, delivered: 1, failed: 1 });
  });

  it('Load more appends the next page until everything is shown, then hides', async () => {
    const { f, el, c, api } = await render({ paged: true, queue: many(120) });
    expect(cards(el)).toBe(50);
    expect(moreBtn(el)!.textContent).toContain('Load 50 more');
    expect(el.querySelector('.pf-rq-more__count')!.textContent).toContain('Showing 50 of 120');
    expect(primaries(el).length).toBe(0);   // still no primary on the page

    moreBtn(el)!.click(); await settle(f);
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=2&pageSize=50&status=pending');
    expect(cards(el)).toBe(100);
    expect(moreBtn(el)!.textContent).toContain('Load 20 more');

    moreBtn(el)!.click(); await settle(f);
    expect(cards(el)).toBe(120);
    expect(moreBtn(el)).toBeNull();
    // Same rows, same order as the unpaged queue.
    expect(c.items().map((r: any) => r.id)).toEqual(many(120).map(r => r.id));
  });

  it('a live refresh reloads the pages already shown in ONE request (no collapse)', async () => {
    const { f, el, c, api } = await render({ paged: true, queue: many(120) });
    moreBtn(el)!.click(); await settle(f);
    c.refresh(); await settle(f);
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=100&status=pending');
    expect(cards(el)).toBe(100);
    moreBtn(el)!.click(); await settle(f);
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=3&pageSize=50&status=pending');
    expect(cards(el)).toBe(120);
  });

  it('switching tab asks the server for that status from page 1', async () => {
    const queue = [...many(3), rep('f1', 'failed'), rep('f2', 'failed')];
    const { el, api, tab } = await render({ paged: true, queue });
    tab('failed');
    await Promise.resolve();
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=50&status=failed');
    expect(cards(el)).toBe(2);
    tab('all');
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=50&status=all');
    const before = queueUrls(api).length;
    tab('partial');   // same server status (all) — no reload
    expect(queueUrls(api).length).toBe(before);
  });

  it('search narrows the loaded rows at once and asks the server once typing pauses', async () => {
    const queue = [rep('a', 'pending', 'final', { order: { id: 'o-a', patient: { displayName: 'Anand Krishnan' } } }),
                   rep('b', 'pending', 'final', { order: { id: 'o-b', patient: { displayName: 'Priya Kumar' } } })];
    const { f, c, api } = await render({ paged: true, queue });
    const n = queueUrls(api).length;
    c.setQuery('pri'); c.setQuery('priy'); f.detectChanges();
    expect(c.visible().map((r: any) => r.id)).toEqual(['b']);      // client-side, immediately
    expect(queueUrls(api).length).toBe(n);                          // debounced
    await new Promise(r => setTimeout(r, 300)); await settle(f);
    expect(queueUrls(api).length).toBe(n + 1);                      // one server search
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=50&status=pending&q=priy');
    expect(c.items().map((r: any) => r.id)).toEqual(['b']);
  });

  it('an older server (array, no paging) still shows the whole queue with client counts and no Load more', async () => {
    const { el, c } = await render({ queue: many(60) });
    expect(c.items().length).toBe(60);
    expect(c.counts().all).toBe(60);
    expect(moreBtn(el)).toBeNull();
  });
});

describe('Reports list — partly reported orders show under All (OPS-136)', () => {
  const names = (el: HTMLElement) => [...el.querySelectorAll('.pf-rq-card--partial .pf-rq-card__name')].map(n => n.textContent!.trim());

  it('All lists the partly-reported orders (no report row yet) above the reports, and Partial still lists them', async () => {
    const { el, c, tab } = await render();
    tab('all');
    expect(el.querySelectorAll('[data-testid="all-partials"] .pf-rq-card--partial').length).toBe(2);
    expect(names(el).join(' ')).toContain('Ms. Paravai Munusamy');
    expect(el.querySelectorAll('.pf-rq-card--report').length).toBe(4);
    expect(c.allCount()).toBe(6);
    tab('partial');
    expect(el.querySelectorAll('.pf-rq-card--partial').length).toBe(2);
    expect(el.querySelector('[data-testid="all-partials"]')).toBeNull();
  });

  it('the other tabs never show them', async () => {
    const { el, tab } = await render();
    for (const v of ['pending', 'delivered', 'failed']) {
      tab(v);
      expect(el.querySelector('[data-testid="all-partials"]')).toBeNull();
      expect(el.querySelector('.pf-rq-card--partial')).toBeNull();
    }
  });

  it('an order that already has a report row (a generated partial) is not listed twice', async () => {
    // r2 below is the partial report of VALUES_ORDER: one card on All, not two.
    const q = [rep('r2', 'pending', 'partial', { orderId: VALUES_ORDER.id })];
    const { el, c, tab } = await render({ queue: q });
    tab('all');
    expect(c.allCount()).toBe(2);   // 1 report + PARTIAL_ORDER only
    expect(el.querySelectorAll('[data-testid="all-partials"] .pf-rq-card--partial').length).toBe(1);
    expect(el.querySelectorAll('.pf-rq-card--report').length).toBe(1);
  });

  it('the band search narrows them; a search with no match hides them and shows the empty state', async () => {
    const { el, c, f, tab } = await render({ queue: [] });
    tab('all');
    expect(el.querySelectorAll('.pf-rq-card--partial').length).toBe(2);
    c.setQuery('paravai'); f.detectChanges();
    expect(el.querySelectorAll('.pf-rq-card--partial').length).toBe(1);
    c.setQuery('zzz-nobody'); f.detectChanges();
    expect(el.querySelectorAll('.pf-rq-card--partial').length).toBe(0);
    expect(el.querySelector('.pf-empty .pf-empty__title')).not.toBeNull();
  });

  it('with no partly-reported orders All is exactly the reports (count and rows unchanged)', async () => {
    const { el, c, tab } = await render({ orders: [] });
    tab('all');
    expect(c.allCount()).toBe(4);
    expect(el.querySelector('[data-testid="all-partials"]')).toBeNull();
    expect(el.querySelectorAll('.pf-rq-card--report').length).toBe(4);
  });
});
