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
import { cultureStagesDone, cultureSummary, deptCountLabel, pendingStatus, queueStatus, reportStatus } from './report-queue.partial';
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

/** AG-Grid renders its rows a few ticks after a change (the grid IS the reports list since Reports v2). */
const settle = async (f: any) => { for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 60)); f.detectChanges(); } };

async function render(opts: { touch?: boolean; phone?: boolean; narrow?: boolean; orders?: unknown[]; queue?: unknown[]; nd?: boolean; perms?: string[]; wa?: Record<string, unknown>; waCloud?: boolean; paged?: boolean; apiGet?: (url: string) => unknown } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover') ? !opts.touch : q.includes('640px') ? !!opts.phone : q.includes('900px') ? !!(opts.phone || opts.narrow) : q.includes('1279px') ? !!(opts.phone || opts.narrow) : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = {
    get: vi.fn((url: string) => {
      const o = opts.apiGet?.(url);
      if (o !== undefined) return of(o);
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
  await settle(f);
  const c = f.componentInstance as any;
  const el = f.nativeElement as HTMLElement;
  /** Pick a status: the head's status pill (wide), else the component's filter (the menu's handler). */
  const tab = async (v: string) => {
    const side = el.querySelector(`[data-testid="rq-pill"] [data-filter="${v}"]`) as HTMLElement | null;
    if (side) side.click(); else c.onFilterMenu(v);
    f.detectChanges();
    await settle(f);
  };
  return { f, el, c, api, router, tab };
}

const menuItems = () => [...document.body.querySelectorAll('[role=menu] [role=menuitem] .pf-am-item__t')].map(b => b.textContent!.trim());
const closeMenus = () => document.querySelectorAll('.pf-am-layer').forEach(n => n.remove());

/** Grid rows: reports and partly-reported orders (AG-Grid row elements). */
const reportRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.ag-row.pf-rq2-row:not(.pf-rq2-row--partial)')];
const partialRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.ag-row.pf-rq2-row--partial')];
const nameOf = (row: Element) => row.querySelector('.pf-rq2-who__name')!.textContent!.trim();

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

describe('Reports v2 — frame: band = lab + search, STATUS side card LEFT, reports grid RIGHT', () => {
  it('the band carries only the search (no segmented, no band-corner buttons on web)', async () => {
    const { el } = await render();
    const band = el.querySelector('pf-hero-band') as HTMLElement;
    expect(band.querySelector('pf-segmented, [role=radiogroup]')).toBeNull();
    expect(band.querySelectorAll('.pf-hb__actions button').length).toBe(0);
    // No stats strip, no stats popover, no second filter control.
    expect(el.querySelector('.pf-rq-stats, .pf-rq-stat, .pf-rq-statbtn, .pf-rq-filter-m, [data-testid="rq-filter"]')).toBeNull();
  });

  it('status pill in the main card head: All · Completed · Partial · Delivered with dots + counts — no Failed', async () => {
    const { el } = await render();
    const pill = el.querySelector('[data-testid="rq-main"] .pf-card__head [data-testid="rq-pill"]') as HTMLElement;
    const items = [...pill.querySelectorAll<HTMLElement>('[role=radio]')];
    expect(items.map(i => i.querySelector('.seg-lbl')!.textContent!.trim())).toEqual(['All', 'Completed', 'Partial', 'Delivered']);
    expect(items.map(i => i.querySelector('.seg-count')!.textContent!.trim())).toEqual(['6', '2', '2', '1']);
    expect(items.slice(1).map(i => (i.querySelector('.seg-dot') as HTMLElement).style.background))
      .toEqual(['var(--violet-text)', 'var(--sky-text)', 'var(--green-text)']);
    expect(pill.querySelector('[aria-checked="true"]')?.getAttribute('data-filter')).toBe('pending');
    expect(el.textContent).not.toMatch(/Failed\s*1\b/);
  });

  it('TO SEND side card (LEFT): WhatsApp failed (Retry) · Not sent yet (Send) · Partial, waiting on results (no action)', async () => {
    const { el, c } = await render({ wa: { r1: { id: 'm1', reportId: 'r1', trigger: 'auto', kind: 'report_ready', status: 'held', attempts: 0, createdAt: '2026-09-26T13:08:00Z' } } });
    const side = el.querySelector('[data-testid="rq-side"]') as HTMLElement;
    expect(side.tagName).toBe('ASIDE');
    expect(side.parentElement!.firstElementChild).toBe(side);   // choose on the left, see on the right
    expect(side.querySelector('.pf-card__label')!.textContent!.trim()).toBe('To send');
    const t = c.toSend();
    expect(t.failed.map((x: any) => x.id)).toEqual(['r4']);
    expect(t.notSent.map((x: any) => x.id)).toEqual(['r1']);       // r2 is a preliminary: never sent from here
    expect(t.partial.length).toBe(2);
    expect(side.querySelector('[data-testid="rq-tosend-count"]')!.textContent!.trim()).toBe('4');
    const groups = [...side.querySelectorAll('.pf-rq2-q__group')].map(g => g.getAttribute('data-group'));
    expect(groups).toEqual(['failed', 'not-sent', 'partial']);
    expect(side.querySelector('[data-report="r4"] .pf-rq2-q__meta')!.textContent).toContain('LAB-2609-000102');
    expect(side.querySelector('[data-report="r4"] .pf-rq2-q__send')!.textContent!.trim()).toBe('Retry');
    expect(side.querySelector('[data-report="r1"] .pf-rq2-q__send')!.textContent!.trim()).toBe('Send');
    expect(side.querySelector('[data-report="r1"] .pf-rq2-q__meta')!.textContent).toContain('Sends by itself once the bill is paid');
    // Partial rows have no send action. "Send all" is in the HEAD, never at the bottom.
    const partialRowsInQueue = [...side.querySelectorAll('.pf-rq2-q__row')].filter(r => !r.hasAttribute('data-report'));
    expect(partialRowsInQueue.length).toBe(2);
    partialRowsInQueue.forEach(r => expect(r.querySelector('.pf-rq2-q__send')).toBeNull());
    expect(side.querySelector('.pf-card__head [data-testid="rq-send-all"]')).not.toBeNull();
    expect(side.querySelector('.pf-card__foot')).toBeNull();
  });

  it('TO SEND empty: "All reports delivered" with a quiet tick', async () => {
    const { el } = await render({ queue: [rep('d1', 'delivered')], orders: [] });
    const empty = el.querySelector('[data-testid="rq-tosend-empty"]') as HTMLElement;
    expect(empty.textContent!.trim()).toBe('All reports delivered');
    expect(empty.querySelector('svg')).not.toBeNull();
  });

  it('opt-out: an opted-out patient shows "Opted out", has no Send button and is left out of Send all', async () => {
    const r = await render({ waCloud: true, apiGet: (url: string) => url === '/api/whatsapp/reports/r1' ? { patientOptOut: true } : undefined });
    await settle(r.f);
    const row = r.el.querySelector('[data-testid="rq-side"] [data-report="r1"]') as HTMLElement;
    expect(row.querySelector('[data-testid="rq-optout"]')!.textContent!.trim()).toBe('Opted out');
    expect(row.querySelector('.pf-rq2-q__send')).toBeNull();
    expect(r.c.sendAllRows().map((x: any) => x.id)).toEqual(['r4']);
    const send = vi.spyOn(r.c.waSend, 'send').mockResolvedValue({ status: 'sent' } as never);
    await r.c.sendOne(r.c.items().find((x: any) => x.id === 'r1'));
    expect(send).not.toHaveBeenCalled();
  });

  it('Send all asks first (count + who is skipped) through DialogService, then sends each one with the fake sender', async () => {
    const r = await render({ waCloud: true, apiGet: (url: string) => url === '/api/whatsapp/reports/r1' ? { patientOptOut: true } : undefined });
    await settle(r.f);
    const dialog = TestBed.inject(DialogService) as any;
    const send = vi.spyOn(r.c.waSend, 'send').mockResolvedValue({ status: 'sent' } as never);
    // Cancel: nothing goes out.
    dialog.confirm.mockResolvedValueOnce(false);
    await r.c.sendAll();
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Send 1 report on WhatsApp?', message: expect.stringContaining('1 patient opted out of WhatsApp') }));
    expect(send).not.toHaveBeenCalled();
    // Confirm: exactly the eligible report, once.
    dialog.confirm.mockResolvedValueOnce(true);
    await r.c.sendAll();
    expect(send.mock.calls.map(c => c[0])).toEqual(['r4']);
    r.f.detectChanges();
    expect(r.c.toSend().failed[0].result).toBe('sent');
  });

  it('never double-sends: a second click while a send is in flight does nothing; buttons disable while sending', async () => {
    const r = await render({ waCloud: true });
    let resolve!: (m: unknown) => void;
    const send = vi.spyOn(r.c.waSend, 'send').mockImplementation(() => new Promise(res => { resolve = res; }) as never);
    const r4 = r.c.items().find((x: any) => x.id === 'r4') ?? { ...rep('r4', 'failed') };
    const first = r.c.sendOne(r4);
    void r.c.sendOne(r4);
    void r.c.sendOne(r4);
    r.f.detectChanges();
    expect(send).toHaveBeenCalledTimes(1);
    const btn = r.el.querySelector('[data-testid="rq-side"] [data-report="r4"] .pf-rq2-q__send') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Send all is refused while it runs too.
    (TestBed.inject(DialogService) as any).confirm.mockResolvedValue(true);
    resolve({ status: 'sent' });
    await first;
    r.f.detectChanges();
    expect(r.el.querySelector('[data-testid="rq-side"] [data-report="r4"] [data-testid="rq-sent"]')).not.toBeNull();
  });

  it('a queue row picks + highlights its report in the grid', async () => {
    const r = await render();
    r.c.pickFromQueue('r1');
    await new Promise(res => setTimeout(res, 80)); r.f.detectChanges(); await settle(r.f);
    expect(r.c.picked()).toBe('r:r1');
    const picked = r.el.querySelector('.ag-row.pf-rq2-row--picked .pf-rq2-who__name');
    expect(picked?.textContent?.trim()).toBe(FULL_NAME);
  });

  it('dots are theme tokens (light + dark), never hard-coded colours; no yellow', () => {
    expect(ndCss()).not.toMatch(/#(a78bfa|f59e0b|38bdf8|10b981|f43f5e|7dd3fc|6ee7b7|fb7185)/i);
    expect(css()).not.toMatch(/yellow|#facc15|#eab308/i);
  });

  it('main card head: icon + REPORTS + scope + count, then Generate (secondary) and Refresh (icon) — no primary on any tab', async () => {
    const { el, tab, c, f } = await render();
    const head = el.querySelector('[data-testid="rq-main"] .pf-card__head') as HTMLElement;
    expect(head.querySelector('.pf-card__label')!.textContent!.trim()).toBe('Reports');
    expect(head.querySelector('[data-testid="rq-pill"] [aria-checked="true"]')!.getAttribute('data-filter')).toBe('pending');
    expect(head.querySelector('.pf-rq2-count')!.textContent!.trim()).toBe('2 reports');
    const gen = head.querySelector('.pf-rq-generate') as HTMLElement;
    expect(gen.classList).toContain('pf-btn--secondary');
    expect(head.querySelector('.pf-rq2-refresh')!.getAttribute('aria-label')).toBe('Refresh');
    for (const v of ['all', 'pending', 'delivered', 'partial']) {
      await tab(v);
      expect(primaries(el).length).toBe(0);
    }
    c.toggle(PARTIAL_ORDER.id); f.detectChanges(); await settle(f);
    expect(primaries(el).length).toBe(0);
    expect(el.querySelector('.pf-rq-genpartial')!.classList).toContain('pf-btn--secondary');
  });

  it('Open in sheet sits in the head when sheets are available', async () => {
    const { el, c, f } = await render();
    expect(el.querySelector('[data-testid="open-in-sheet"]')).toBeNull();
    const spy = vi.spyOn(c.sheets, 'available').mockReturnValue(true);
    c.theme.isNewDesign.set(false); f.detectChanges(); c.theme.isNewDesign.set(true); f.detectChanges();
    const btn = el.querySelector('[data-testid="rq-main"] [data-testid="open-in-sheet"]') as HTMLElement;
    expect(btn).not.toBeNull();
    const open = vi.spyOn(c.sheets, 'open').mockResolvedValue(undefined);
    btn.click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ source: 'Reports' }));
    spy.mockRestore();
  });
});

describe('Reports v2 — the grid (Test Master\'s pf-data-grid)', () => {
  it('columns: # · Patient · Order · Status · Generated · Sent · Actions (Order + Generated fold away below 900px)', async () => {
    const { el, c } = await render();
    expect(el.querySelector('pf-data-grid[data-testid="rq-grid"]')).not.toBeNull();
    expect(c.colDefs().map((d: any) => d.headerName)).toEqual(['#', 'Patient', 'Order', 'Status', 'Generated', 'Sent', 'Actions']);
    expect(c.colDefs().filter((d: any) => d.hide).length).toBe(0);
    expect(c.colDefs().every((d: any) => !d.sortable)).toBe(true);   // the detail row must stay under its order
    expect([...el.querySelectorAll('.ag-header-cell-text')].map(h => h.textContent!.trim())).toEqual(['#', 'Patient', 'Order', 'Status', 'Generated', 'Sent', 'Actions']);
    TestBed.resetTestingModule();
    const narrow = await render({ narrow: true });
    expect(narrow.c.colDefs().filter((d: any) => d.hide).map((d: any) => d.colId)).toEqual(['order', 'generated']);
    expect(narrow.el.querySelector('[data-testid="rq-side"]')).toBeNull();
  });

  it('a report row: full name + "29/M · AA0012", order number, status pill, generated time, row actions, zoom source', async () => {
    const { el, f, tab } = await render();
    await tab('all');
    const rows = reportRows(el);
    expect(rows.length).toBe(4);
    const first = rows[0];
    expect(nameOf(first)).toBe(FULL_NAME);
    expect(first.querySelector('.pf-rq2-who__meta')!.textContent!.trim()).toBe('29/M · AA0012');
    expect(first.querySelector('[col-id="order"]')!.textContent!.trim()).toBe('LAB-2609-000102');
    expect(el.textContent).not.toContain('..');
    expect(el.querySelector('pf-chip')).toBeNull();
    // Row actions: kit .pf-rowact (secondary), text on web: View · Download · Share · ▾ · ⋯
    const acts = first.querySelectorAll('.pf-rowact');
    expect(acts.length).toBe(5);
    expect(first.querySelector('.pf-rowact[aria-label="View"]')!.classList).not.toContain('pf-rowact--icon');
    // List → report view zoom keeps working: every report row is a zoom source.
    const zs = f.debugElement.queryAll(By.directive(ZoomSourceDirective));
    expect(zs.length).toBe(4);
    expect(zs.map(z => z.injector.get(ZoomSourceDirective).keys())).toContainEqual(['r1', 'o-r1']);
  });

  it('touch: row actions become 44px icons (label kept for AT)', async () => {
    const { el, tab } = await render({ touch: true });
    await tab('all');
    const view = reportRows(el)[0].querySelector('.pf-rowact[aria-label="View"]') as HTMLElement;
    expect(view.classList).toContain('pf-rowact--icon');
    expect(view.querySelector('.pf-rowact__t')!.textContent).toBe('View');
  });

  it('View opens the report', async () => {
    const { el, tab, router } = await render();
    await tab('all');
    (reportRows(el)[0].querySelector('.pf-rowact[aria-label="View"]') as HTMLElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/reports/view', 'r1']);
  });

  it('empty states use .pf-empty', async () => {
    const { el, tab } = await render({ queue: [], orders: [] });
    await tab('delivered');
    expect(el.querySelector('.pf-empty .pf-empty__title')!.textContent).toContain('No reports here');
    await tab('partial');
    expect(el.querySelector('.pf-empty .pf-empty__title')!.textContent).toContain('No partial reports');
  });
});

describe('Reports v2 — status: ONE neutral pill with a coloured dot; "Unpaid" UNDER it', () => {
  it('every row on every tab has exactly one pill, never a chip; Unpaid is its own line under the pill', async () => {
    const { el, tab } = await render();
    for (const v of ['all', 'pending', 'partial', 'delivered']) {
      await tab(v);
      const rows = [...reportRows(el), ...partialRows(el)];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.querySelectorAll('.pf-rq2-pill').length).toBe(1);
        expect(row.querySelector('.pf-chip, pf-chip')).toBeNull();
        expect(row.querySelector('.pf-rq2-pill .pf-rq2-dot')).not.toBeNull();
      }
    }
  });

  it('labels on All: Completed (violet), Partial (sky) for a preliminary, Delivered (green), Failed (rose); Unpaid under r1', async () => {
    const { el, tab } = await render();
    await tab('all');
    const rows = reportRows(el);
    const got = rows.map(r => {
      const p = r.querySelector('.pf-rq2-pill') as HTMLElement;
      return [p.textContent!.trim(), p.getAttribute('data-status'), (p.querySelector('.pf-rq2-dot') as HTMLElement).style.background];
    });
    expect(got).toEqual([
      ['Completed', 'completed', 'var(--violet-text)'], ['Partial', 'partial', 'var(--sky-text)'],
      ['Delivered', 'delivered', 'var(--green-text)'], ['Failed', 'failed', 'var(--rose-text)'],
    ]);
    // r1's bill is due → "Unpaid" is a quiet line inside the status cell, AFTER the pill (a column), never a pill.
    const st = rows[0].querySelector('.pf-rq2-status') as HTMLElement;
    expect([...st.children].map(c => c.className)).toEqual(['pf-rq2-pill', 'pf-rq2-unpaid']);
    expect(st.querySelector('.pf-rq2-unpaid')!.textContent!.trim()).toBe('Unpaid');
    expect(rows.slice(1).some(r => r.querySelector('.pf-rq2-unpaid'))).toBe(false);
    expect(rows[1].textContent).not.toContain('Completed');
  });

  it('a delivered preliminary keeps "Preliminary" in the Sent cell; delivered/failed say what happened', async () => {
    const q = [rep('d1', 'delivered', 'partial', { deliveredVia: 'print' }), rep('f1', 'failed', 'final', { deliveryNote: 'Number not on WhatsApp' })];
    const { el, tab } = await render({ queue: q });
    await tab('all');
    const rows = reportRows(el);
    expect(rows[0].querySelector('.pf-rq2-pill')!.textContent!.trim()).toBe('Delivered');
    expect(rows[0].querySelector('.pf-rq2-sent')!.textContent!.trim()).toBe('Printed · Preliminary');
    expect(rows[1].querySelector('.pf-rq2-sent')!.textContent!.trim()).toBe('Number not on WhatsApp');
  });

  it('CSS: the pill is neutral (chip background, text colour); the dot carries the colour; Unpaid uses the rose token', () => {
    const rule = (sel: string) => ndCss().match(new RegExp(sel.replace(/[.[\]'()]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))?.[1] ?? '';
    const pill = rule('.pf-rq2-pill');
    expect(pill).toMatch(/background: var\(--pf-chip-bg\)/);
    expect(pill).toMatch(/color: var\(--text-primary\)/);
    expect(rule('.pf-rq2-unpaid')).toMatch(/var\(--rose-text\)/);
    expect(rule('.pf-rq2-status')).toMatch(/flex-direction: column/);
  });

  it('queueStatus + reportStatus', () => {
    expect(queueStatus('pending', 'final', false)).toEqual({ key: 'completed', label: 'Completed', unpaid: false, prelim: false });
    expect(queueStatus('pending', 'partial', true)).toEqual({ key: 'partial', label: 'Partial', unpaid: true, prelim: true });
    expect(queueStatus('delivered', 'partial', true)).toMatchObject({ key: 'delivered', unpaid: true, prelim: true });
    expect(queueStatus('failed', 'final', false)).toMatchObject({ key: 'failed', label: 'Failed' });
    expect(reportStatus('pending', 'final', false)).toMatchObject({ label: 'Completed', tone: 'green', extra: [] });
    expect(reportStatus('pending', 'partial', true)).toMatchObject({ label: 'Unpaid', tone: 'red', extra: ['Preliminary'] });
    expect(reportStatus('delivered', 'partial', true)).toMatchObject({ label: 'Delivered', extra: ['Preliminary', 'Payment due'] });
  });
});

describe('Reports v2 — Partial: the order opens INLINE (flat departments, Generate partial PDF at the top)', () => {
  async function openPartial() {
    const r = await render();
    await r.tab('partial');
    const row = partialRows(r.el).find(x => nameOf(x) === FULL_NAME)!;
    (row.querySelector('.pf-rq2-details') as HTMLElement).click();
    r.f.detectChanges(); await settle(r.f);
    const detail = r.el.querySelector('[data-testid="rq-detail"]') as HTMLElement;
    return { ...r, row, detail };
  }

  it('row: full name, "29/M · AA0012", the order number, the count line and ONE "Partial" pill', async () => {
    const { row } = await openPartial();
    expect(nameOf(row)).toBe(FULL_NAME);
    const metas = [...row.querySelectorAll('.pf-rq2-who__meta')].map(m => m.textContent!.trim());
    expect(metas).toEqual(['29/M · AA0012', '1 of 2 departments partly ready']);
    expect(row.querySelector('[col-id="order"]')!.textContent!.trim()).toBe('LAB-2609-000089');
    expect(row.querySelectorAll('.pf-rq2-pill').length).toBe(1);
    expect(row.querySelector('.pf-rq2-pill')!.textContent!.trim()).toBe('Partial');
  });

  it('the detail is a full-width row right under the order; Generate partial PDF comes FIRST', async () => {
    const { detail, el } = await openPartial();
    expect(detail.closest('.ag-full-width-row')).not.toBeNull();
    const top = detail.firstElementChild as HTMLElement;
    expect(top.classList).toContain('pf-rq2-detail__top');
    expect(top.querySelector('.pf-rq-genpartial')).not.toBeNull();
    expect(top.compareDocumentPosition(detail.querySelector('.pf-rq2-depts')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el.querySelector('.pf-rq2-depts .pf-card, .pf-rq2-depts .pf-rq-card')).toBeNull();   // no card in card
    expect(ndCss()).toMatch(/\.pf-rq2-depts\s+\.pf-rq-dept\s*\{[^}]*border: 0/);
  });

  it('Microbiology is ONE section that says what prints: the culture ready, the identification pending', async () => {
    const { detail } = await openPartial();
    const depts = [...detail.querySelectorAll<HTMLElement>('.pf-rq-dept:not(.pf-rq-dept--pending)')];
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
    const { detail, el } = await openPartial();
    const dl = detail.querySelector('.pf-rq-culture') as HTMLElement;
    const rows = [...dl.querySelectorAll('.pf-rq-culture__row')]
      .map(r => `${r.querySelector('dt')!.textContent!.trim()} ${r.querySelector('dd')!.textContent!.trim()}`);
    expect(rows).toEqual(['Growth Growth Detected (<10⁴ CFU/mL)', 'Organism Abiotrophia spp.', 'AST 8 drugs · 1 resistant']);
    expect(el.textContent).not.toMatch(/No parameter values/i);
  });

  it('pending = a neutral column with an SVG clock and department NAMES (no emoji, no amber)', async () => {
    const { detail } = await openPartial();
    const p = detail.querySelector('.pf-rq-dept--pending') as HTMLElement;
    expect(p.querySelector('.pf-rq-pending svg')).not.toBeNull();
    const txt = p.textContent!.replace(/\s+/g, ' ');
    expect(txt).toMatch(/Microbiology\s*1 of 2 tests/);
    expect(txt).toContain('Molecular Diagnostics');
    expect(txt).not.toMatch(/⏳|MIC,|MOL/);
    expect(ndCss()).not.toMatch(/245,\s*158,\s*11|#f59e0b|34,\s*211,\s*238|#67e8f9/);
  });

  it('Generate partial PDF (secondary) sends only the fully validated tubes', async () => {
    const { detail, api, f } = await openPartial();
    (detail.querySelector('.pf-rq-genpartial') as HTMLElement).click();
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/reports/generate/partial', { orderId: PARTIAL_ORDER.id, sampleIds: ['s-mic-1'] });
  });

  it('plain results: value rows with words for flags (High) and the critical badge (C / CL / CH), no glyphs', async () => {
    const r = await render();
    await r.tab('partial');
    r.c.toggle(VALUES_ORDER.id); r.f.detectChanges(); await settle(r.f);
    const row = partialRows(r.el).find(x => nameOf(x) === 'Ms. Paravai Munusamy')!;
    expect(row.querySelector('.pf-rq2-who__meta')!.textContent!.trim()).toBe('44/F · AA0007');
    expect(row.querySelector('[col-id="order"]')!.textContent!.trim()).toBe('#AAAA1111');
    expect(row.querySelector('.pf-rq-card__count')!.textContent!.trim()).toBe('1 of 2 departments ready');
    const detail = r.el.querySelector('[data-testid="rq-detail"]') as HTMLElement;
    const flags = [...detail.querySelectorAll('.pf-rq-value__flag')].map(x => x.textContent!.trim());
    expect(flags).toEqual(['High', 'C']);   // legacy saved 'C' shows as C; new rows badge CL / CH
    expect(detail.querySelector('.pf-rq-value__range')!.textContent!.trim()).toContain('12–15');
    expect(detail.textContent).not.toMatch(/[⚠⚑✓]/);
    expect(detail.querySelector('.pf-rq-dept--pending')!.textContent).toContain('Microbiology');
  });

  it('open / close: aria-expanded on Details + a row click; the detail row exists only while open; motion off under reduced motion', async () => {
    const r = await render();
    await r.tab('partial');
    const btn = () => partialRows(r.el)[0].querySelector('.pf-rq2-details') as HTMLElement;
    expect(btn().getAttribute('aria-expanded')).toBe('false');
    expect(r.el.querySelector('[data-testid="rq-detail"]')).toBeNull();
    btn().click(); r.f.detectChanges(); await settle(r.f);
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    expect(r.el.querySelector('[data-testid="rq-detail"]')!.id).toBe(btn().getAttribute('aria-controls'));
    // A click on the row (not on a button) toggles too.
    r.c.onGridRowClicked({ data: r.c.gridRows()[0], event: { target: document.body } });
    r.f.detectChanges(); await settle(r.f);
    expect(r.el.querySelector('[data-testid="rq-detail"]')).toBeNull();
    expect(css()).toMatch(/prefers-reduced-motion: reduce[\s\S]*pf-rq2-details__chev/);
  });

  it('the Partial tab honours the band search', async () => {
    const r = await render();
    await r.tab('partial');
    r.c.setQuery('paravai'); r.f.detectChanges(); await settle(r.f);
    expect(partialRows(r.el).map(nameOf)).toEqual(['Ms. Paravai Munusamy']);
  });
});

describe('Reports v2 — narrow (≤900px) and phone (≤640px)', () => {
  it('≤900px: no side card; the filter button inside the search opens a popover menu (dot · label · count · tick)', async () => {
    const { el, c, f } = await render({ narrow: true });
    expect(el.querySelector('[data-testid="rq-side"]')).toBeNull();
    const btn = el.querySelector('pf-hero-band [data-testid="rq-filter"]') as HTMLButtonElement;
    expect(btn.closest('.pf-hb__inline')).not.toBeNull();     // INSIDE the search field
    expect(btn.textContent!.trim()).toBe('Completed');
    expect(btn.getAttribute('aria-label')).toBe('Filter by status — Completed');
    const menu = c.filterMenu();
    expect(menu.map((a: any) => [a.label, a.count, !!a.current])).toEqual([
      ['All', 6, false], ['Completed', 2, true], ['Partial', 2, false], ['Delivered', 1, false]]);
    expect(menu[0].dot).toBe('ring');
    btn.click(); f.detectChanges(); await settle(f);
    const panel = document.querySelector('.pf-am-panel') as HTMLElement;
    expect(panel.classList).not.toContain('pf-am-panel--sheet');     // a dropdown, never a bottom sheet
    const rows = [...document.querySelectorAll<HTMLElement>('.pf-am-panel [role=menuitemradio]')];
    expect(rows.map(r => r.querySelector('.pf-am-item__t')!.textContent!.trim())).toEqual(['All', 'Completed', 'Partial', 'Delivered']);
    expect(rows[1].getAttribute('aria-checked')).toBe('true');
    expect(rows[0].querySelector('.pf-am-item__dot--ring')).not.toBeNull();
    expect(rows[3].querySelector('.pf-am-item__count')!.textContent!.trim()).toBe('1');
    rows[3].click(); f.detectChanges(); await settle(f);
    expect(c.filter()).toBe('delivered');
    expect(btn.textContent!.trim()).toBe('Delivered');
    closeMenus();
  });

  it('phone: band Refresh icon; two-line rows (no grid); name + pill on line 1, meta + "· Unpaid" on line 2', async () => {
    const { el, tab, c } = await render({ phone: true });
    expect(el.querySelector('pf-data-grid')).toBeNull();
    expect(el.querySelector('pf-hero-band .pf-rq2-bandrefresh')).not.toBeNull();
    expect(el.querySelector('[data-testid="rq-main"] .pf-rq2-refresh')).toBeNull();
    await tab('all');
    const rows = [...el.querySelectorAll<HTMLElement>('[data-testid="rq-list"] .pf-rq2-prow')];
    expect(rows.length).toBe(6);   // 2 partly-reported orders + 4 reports
    const r1 = rows.find(r => r.getAttribute('data-status') === 'completed')!;
    expect(r1.querySelector('.pf-rq2-prow__l1 .pf-rq2-prow__name')!.textContent!.trim()).toBe(FULL_NAME);
    expect(r1.querySelector('.pf-rq2-prow__l1 .pf-rq2-pill')!.textContent!.trim()).toBe('Completed');
    expect(r1.querySelector('.pf-rq2-prow__l2')!.textContent!.trim()).toBe('29/M · LAB-2609-000102 · ' + c.when('2026-09-26T13:07:00Z') + ' · Unpaid');
    expect(css()).toMatch(/\.pf-rq2-prow\s*\{[^}]*min-height: 64px/);
  });

  it('phone: a tap opens the sheet — patient + status, Unpaid note, ONE primary (WhatsApp per waMode), View · Download · Print, the rest as a list', async () => {
    const { el, f, c } = await render({ phone: true, perms: ['deliver_report', 'view_report', 'view_order', 'edit_result', 'view_patient', 'view_bill'] });
    (el.querySelector('.pf-rq2-prow[data-status="completed"]') as HTMLElement).click(); f.detectChanges();
    const sheet = document.querySelector('[data-testid="rq-sheet"]') as HTMLElement;
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.querySelector('.pf-rq2-sheet__name')!.textContent!.trim()).toBe(FULL_NAME);
    expect(sheet.querySelector('.pf-rq2-pill')!.textContent!.trim()).toBe('Completed');
    expect(sheet.querySelector('.pf-rq2-sheet__unpaid')!.textContent).toContain('Unpaid');
    const prim = sheet.querySelectorAll('.pf-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].textContent!.trim()).toBe('Share on WhatsApp');   // WhatsApp Chat is on (no sender)
    expect([...sheet.querySelectorAll('.pf-rq2-sheet__trio .pf-btn')].map(b => b.textContent!.trim())).toEqual(['View', 'Download', 'Print']);
    const rest = [...sheet.querySelectorAll('.pf-rq2-sheet__item')].map(b => b.getAttribute('data-action'));
    // The rest of the ⋯ rows, same order, minus what the primary + the trio already offer.
    expect(rest).toEqual(c.actionsFor(c.items()[0]).map((a: { id: string }) => a.id)
      .filter((id: string) => !['view', 'download', 'print', 'whatsapp', 'whatsapp-mine'].includes(id)));
    expect(rest).toEqual(expect.arrayContaining(['share', 'copy-link', 'email', 'edit', 'regenerate', 'patient']));
    const deliver = vi.spyOn(c, 'deliver').mockImplementation(() => {});
    (prim[0] as HTMLElement).click(); f.detectChanges();
    expect(deliver).toHaveBeenCalledWith(c.items()[0], 'whatsapp');
    expect(document.querySelector('[data-testid="rq-sheet"]')).toBeNull();
  });

  it('phone sheet: Print is the primary when WhatsApp is not available; view-only gets no primary', async () => {
    const r = await render({ phone: true, perms: ['deliver_report', 'view_report'] });
    vi.spyOn(r.c, 'waMode').mockReturnValue(null);
    (r.el.querySelector('.pf-rq2-prow[data-status="completed"]') as HTMLElement).click(); r.f.detectChanges();
    let sheet = document.querySelector('[data-testid="rq-sheet"]') as HTMLElement;
    expect(sheet.querySelector('.pf-btn--primary')!.textContent!.trim()).toBe('Print');
    expect([...sheet.querySelectorAll('.pf-rq2-sheet__trio .pf-btn')].map(b => b.textContent!.trim())).toEqual(['View', 'Download']);
    r.c.closeSheet(); r.f.detectChanges();
    TestBed.resetTestingModule();
    const v = await render({ phone: true, perms: ['view_report'] });
    (v.el.querySelector('.pf-rq2-prow[data-status="completed"]') as HTMLElement).click(); v.f.detectChanges();
    sheet = document.querySelector('[data-testid="rq-sheet"]') as HTMLElement;
    expect(sheet.querySelector('.pf-btn--primary')).toBeNull();
    expect([...sheet.querySelectorAll('.pf-rq2-sheet__trio .pf-btn')].map(b => b.textContent!.trim())).toEqual(['View', 'Download', 'Print']);
    v.c.closeSheet(); v.f.detectChanges();
  });

  it('phone sheet for a partly-reported order: its departments + Generate partial PDF', async () => {
    const { el, f } = await render({ phone: true });
    (el.querySelector('.pf-rq2-prow[data-status="partial"]') as HTMLElement | null);
    const c = f.componentInstance as any;
    await c.onFilterMenu('partial'); f.detectChanges(); await settle(f);
    (el.querySelector('.pf-rq2-prow[data-status="partial"]') as HTMLElement).click(); f.detectChanges();
    const sheet = document.querySelector('[data-testid="rq-sheet"]') as HTMLElement;
    expect(sheet.querySelector('[data-testid="rq-detail"] .pf-rq-dept__name')!.textContent!.trim()).toBe('Microbiology');
    expect(sheet.querySelector('.pf-rq-genpartial')).not.toBeNull();
    expect(sheet.querySelector('.pf-btn--primary')).toBeNull();
    c.closeSheet(); f.detectChanges();
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
  const rowNames = (el: HTMLElement) => [...el.querySelectorAll('.ag-row .pf-rq2-who__name, .pf-rq-row p.font-semibold')].map(n => n.textContent!.trim());

  for (const nd of [true, false]) {
    it(`view_report-only sees the SAME rows, minus the send actions (${nd ? 'new' : 'classic'} design)`, async () => {
      const full = await render({ nd, perms: ['deliver_report', 'view_report', 'edit_result'] });
      full.c._filter.set('all'); full.f.detectChanges(); await settle(full.f);
      const fullRows = rowNames(full.el);
      expect(fullRows.length).toBeGreaterThan(0);
      expect(full.el.querySelector('[title="WhatsApp Chat"]')).not.toBeNull();
      TestBed.resetTestingModule();

      const viewer = await render({ nd, perms: ['view_report'] });
      viewer.c._filter.set('all'); viewer.f.detectChanges(); await settle(viewer.f);
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

  it('view-only: a "View only" chip replaces Generate in the card head; Partial has no Generate button', async () => {
    const { el, tab, c, f } = await render({ perms: ['view_report'] });
    expect(el.querySelector('[data-testid="rq-main"] .pf-card__head .pf-rq-viewonly')?.textContent?.trim()).toBe('View only');
    expect(el.querySelector('.pf-rq-generate')).toBeNull();
    await tab('partial');
    expect(partialRows(el).length).toBeGreaterThan(0);
    c.toggle(PARTIAL_ORDER.id); f.detectChanges(); await settle(f);
    expect(el.querySelector('[data-testid="rq-detail"]')).not.toBeNull();
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
      c._filter.set('all'); f.detectChanges(); await settle(f);
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

  it('the ⋯ is a dots SVG button with a label, on web and touch', async () => {
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
  it('asks once for the final reports on screen and puts the WhatsApp status in the Sent cell', async () => {
    const { el, api, tab } = await render({
      wa: {
        r1: { id: 'm1', reportId: 'r1', trigger: 'auto', kind: 'report_ready', status: 'sent', attempts: 1, createdAt: '2026-09-26T13:08:00Z' },
        r4: { id: 'm4', reportId: 'r4', trigger: 'auto', kind: 'report_ready', status: 'failed', attempts: 1, createdAt: '2026-09-26T13:08:00Z' },
      },
    });
    // (the TO SEND queue reads its own pages — pageSize=200 — and asks once for ITS finals: r1 + r4)
    const loads = () => api.get.mock.calls.filter((c: unknown[]) => (c[0] as string).startsWith('/api/reports/queue') && !(c[0] as string).includes('pageSize=200')).length;
    await tab('all');
    const calls = api.post.mock.calls.filter((c: unknown[]) => c[0] === '/api/whatsapp/status'
      && JSON.stringify((c[1] as { reportIds: string[] }).reportIds) !== JSON.stringify(['r1', 'r4']));
    // One batch per queue load (the All tab is its own server page).
    expect(calls.length).toBe(loads());
    // Partials never go on WhatsApp — only finals are asked about.
    expect((calls.at(-1)![1] as unknown as { reportIds: string[] }).reportIds).toEqual(['r1', 'r3', 'r4']);
    const metas = [...el.querySelectorAll<HTMLElement>('.ag-row .pf-rq2-sent')].map(m => m.textContent!.trim());
    expect(metas).toContain('WhatsApp sent');
    expect(metas).toContain('WhatsApp failed');
  });

  it('no WhatsApp data → the Sent cell says nothing about WhatsApp', async () => {
    const { el, tab } = await render();
    await tab('all');
    const metas = reportRows(el).map(r => r.querySelector('.pf-rq2-sent')!.textContent!);
    expect(metas.length).toBe(4);
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

  it('WhatsApp posts the server send (no wa.me window) and the Sent cell shows Sent + the masked number', async () => {
    const { c, el, f, api, tab } = await render({ waCloud: true });
    await tab('all');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const r = c.items().find((x: { id: string }) => x.id === 'r1');
    c.deliver(r, 'whatsapp');
    await new Promise(res => setTimeout(res, 0));
    f.detectChanges(); await settle(f);
    expect(api.post).toHaveBeenCalledWith('/api/whatsapp/reports/r1/resend', {});
    expect(open).not.toHaveBeenCalled();
    const metas = [...el.querySelectorAll<HTMLElement>('.ag-row .pf-rq2-sent')].map(m => m.textContent!.trim());
    expect(metas).toContain('WhatsApp sent · +91 ••••• 43210');
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
    .filter((u: string) => u.startsWith('/api/reports/queue') && !u.includes('pageSize=200'));
  /** Rows in the grid model (AG-Grid only puts the visible ones in the DOM). */
  const cards = (_el: HTMLElement, c?: any) => (c ?? cur).gridRows().filter((x: any) => x.kind === 'report').length;
  let cur: any;
  const settleP = async (f: any) => { await f.whenStable(); f.detectChanges(); };

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
    expect(byTab).toEqual({ all: 124, pending: 120, partial: 2, delivered: 1 });   // no Failed tab: failures are TO SEND rows
  });

  it('the next page loads as the grid nears its end (no button at the bottom) until everything is shown', async () => {
    const { f, el, c, api } = await render({ paged: true, queue: many(120) });
    cur = c;
    expect(cards(el)).toBe(50);
    expect(el.querySelector('.pf-rq-more__btn, .pf-rq-more__count')).toBeNull();   // owner: nothing clickable at the bottom
    expect(el.querySelector('.pf-rq2-count')!.textContent!.trim()).toBe('50 of 120 reports');
    expect(c.nextPageCount()).toBe(50);
    expect(primaries(el).length).toBe(0);   // still no primary on the page
    // The grid's scroll handler: near the end → the next page.
    let handler: (() => void) | undefined;
    const gridApi = { addEventListener: (_: string, fn: () => void) => { handler = fn; }, getDisplayedRowCount: () => c.gridRows().length, getLastDisplayedRowIndex: () => c.gridRows().length - 2 };
    c.onGridReady({ api: gridApi });
    handler!(); await settleP(f);
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=2&pageSize=50&status=pending');
    expect(cards(el)).toBe(100);
    expect(c.nextPageCount()).toBe(20);

    c.loadMore(); await settleP(f);
    expect(cards(el)).toBe(120);
    expect(c.hasMorePages()).toBe(false);
    expect(el.querySelector('.pf-rq2-count')!.textContent!.trim()).toBe('120 reports');
    // Same rows, same order as the unpaged queue.
    expect(c.items().map((r: any) => r.id)).toEqual(many(120).map(r => r.id));
  });

  it('a live refresh reloads the pages already shown in ONE request (no collapse)', async () => {
    const { f, el, c, api } = await render({ paged: true, queue: many(120) });
    cur = c;
    c.loadMore(); await settleP(f);
    c.refresh(); await settleP(f);
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=100&status=pending');
    expect(cards(el)).toBe(100);
    c.loadMore(); await settleP(f);
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=3&pageSize=50&status=pending');
    expect(cards(el)).toBe(120);
  });

  it('switching tab asks the server for that status from page 1', async () => {
    const queue = [...many(3), rep('f1', 'failed'), rep('f2', 'failed')];
    const { el, api, tab, c } = await render({ paged: true, queue });
    cur = c;
    await tab('failed');
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=50&status=failed');
    expect(cards(el)).toBe(2);
    await tab('all');
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=50&status=all');
    const before = queueUrls(api).length;
    await tab('partial');   // same server status (all) — no reload
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
    await new Promise(r => setTimeout(r, 300)); await settleP(f);
    expect(queueUrls(api).length).toBe(n + 1);                      // one server search
    expect(queueUrls(api).at(-1)).toBe('/api/reports/queue?view=summary&page=1&pageSize=50&status=pending&q=priy');
    expect(c.items().map((r: any) => r.id)).toEqual(['b']);
  });

  it('an older server (array, no paging) still shows the whole queue with client counts and no further pages', async () => {
    const { c } = await render({ queue: many(60) });
    expect(c.items().length).toBe(60);
    expect(c.counts().all).toBe(60);
    expect(c.hasMorePages()).toBe(false);
  });
});

describe('Reports list — partly reported orders show under All (OPS-136)', () => {
  const names = (el: HTMLElement) => partialRows(el).map(nameOf);

  it('All lists the partly-reported orders (no report row yet) above the reports, and Partial still lists them', async () => {
    const { el, c, tab } = await render();
    await tab('all');
    expect(partialRows(el).length).toBe(2);
    expect(names(el).join(' ')).toContain('Ms. Paravai Munusamy');
    expect(reportRows(el).length).toBe(4);
    expect(c.gridRows().map((x: any) => x.kind)).toEqual(['partial', 'partial', 'report', 'report', 'report', 'report']);
    expect(c.allCount()).toBe(6);
    await tab('partial');
    expect(partialRows(el).length).toBe(2);
    expect(reportRows(el).length).toBe(0);
  });

  it('the other tabs never show them', async () => {
    const { el, tab } = await render();
    for (const v of ['pending', 'delivered', 'failed']) {
      await tab(v);
      expect(partialRows(el).length).toBe(0);
    }
  });

  it('an order that already has a report row (a generated partial) is not listed twice', async () => {
    // r2 below is the partial report of VALUES_ORDER: one row on All, not two.
    const q = [rep('r2', 'pending', 'partial', { orderId: VALUES_ORDER.id })];
    const { el, c, tab } = await render({ queue: q });
    await tab('all');
    expect(c.allCount()).toBe(2);   // 1 report + PARTIAL_ORDER only
    expect(partialRows(el).length).toBe(1);
    expect(reportRows(el).length).toBe(1);
    // On Partial, VALUES_ORDER's row carries ITS report's actions (View · Download · Share · ⋯) next to Details.
    await tab('partial');
    const row = partialRows(el).find(x => nameOf(x) === 'Ms. Paravai Munusamy')!;
    expect(row.querySelector('.pf-rq2-details')).not.toBeNull();
    expect(row.querySelector('.pf-rowact[aria-label="View"]')).not.toBeNull();
  });

  it('the band search narrows them; a search with no match hides them and shows the empty state', async () => {
    const { el, c, f, tab } = await render({ queue: [] });
    await tab('all');
    expect(partialRows(el).length).toBe(2);
    c.setQuery('paravai'); f.detectChanges(); await settle(f);
    expect(partialRows(el).length).toBe(1);
    c.setQuery('zzz-nobody'); f.detectChanges(); await settle(f);
    expect(partialRows(el).length).toBe(0);
    expect(el.querySelector('.pf-empty .pf-empty__title')).not.toBeNull();
  });

  it('with no partly-reported orders All is exactly the reports (count and rows unchanged)', async () => {
    const { el, c, tab } = await render({ orders: [] });
    await tab('all');
    expect(c.allCount()).toBe(4);
    expect(partialRows(el).length).toBe(0);
    expect(reportRows(el).length).toBe(4);
  });
});
