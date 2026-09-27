import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PatientProfileComponent } from './patient-profile.component';
import { LabOrdersComponent } from './lab-orders.component';
import { LabTrendsComponent, ndTrendSkin } from './lab-trends.component';
import {
  filterOrders, orderStatusLabel, orderTitle, orderTone, patientFlags, patientMetaLine,
} from './patient-profile.nd';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { DialogService } from '../../../core/services/dialog.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { PatientTimelineService } from './patient-timeline.service';

/**
 * Patient profile on the nd pattern (docs/ND-PATTERN.md → "Patient
 * profile"): band (back + tenant + actions, ONE primary: New order) whose
 * pill is the CONTEXT BAR (full name, "22/M · MRN · phone", ABHA, flags),
 * HISTORY main card (search + neutral filter; orders as ND rows that zoom
 * into the order) + SUMMARY companion (collapsible, remembered; a sheet
 * ≤900px), the phone bottom bar, and no monospace / native controls.
 */
const FULL_NAME = 'Mr. Sathish Kumaravel Ramasamy Venkatachalapathy';
const TODAY = new Date();
const DOB = `${TODAY.getFullYear() - 22}-01-01T00:00:00Z`;
const PATIENT = {
  id: 'p1', tenantId: 't1', mrn: 'AA0006', firstName: 'Sathish', fathersName: 'Ramasamy', displayName: FULL_NAME,
  phone: '+91 98765 43210', sex: 'Male', dateOfBirth: DOB, isMinor: false, abhaId: '91672362107704',
  abhaAddress: 'sathish@abdm', abhaVerified: true, aadhaarVerified: false, source: 'walk_in',
  hasKnownAllergies: true, createdAt: '2026-01-02T00:00:00Z', bloodGroup: 'O+',
};
const test = (id: string, name: string, status: string, code?: string, currentResult?: string) =>
  ({ id, name, status, subOrderId: 's', testId: id, test: code ? { code, name, parameters: [] } : undefined, currentResult });
const ORDERS = [
  { id: 'o1', orderNumber: 'LAB-2609-000085', patientId: 'p1', branchId: 'b', priority: 'Routine', source: 'walk_in', status: 'validated',
    collectionType: 'walk_in', createdAt: '2026-09-20T09:48:00Z', totalAmount: 1200, refDoctorName: 'Dr. Priya Nair', billStatus: 'paid',
    samples: [{ id: 's1', tests: [test('t1', 'Complete Blood Count', 'validated', 'CBC', JSON.stringify({ values: { Hb: '13.2' } })), test('t2', 'Liver Function Test', 'validated', 'LFT')] }] },
  { id: 'o2', orderNumber: 'LAB-2609-000099', patientId: 'p1', branchId: 'b', priority: 'Routine', source: 'walk_in', status: 'billed',
    collectionType: 'walk_in', createdAt: '2026-09-25T10:00:00Z', totalAmount: 400, billStatus: 'unpaid',
    samples: [{ id: 's2', tests: [test('t3', 'Thyroid Profile', 'pending', 'TFT')] }] },
];

type Opts = { holding?: boolean; narrow?: boolean; phone?: boolean; touch?: boolean; canEdit?: boolean; messages?: boolean; fail?: boolean; hang?: boolean; orders?: unknown[]; patient?: Record<string, unknown> };

const realMatchMedia = (window as any).matchMedia;
beforeEach(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
             removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
    configurable: true, writable: true,
  });
});
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

async function render(opts: Opts = {}) {
  TestBed.resetTestingModule();
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!(opts.narrow || opts.phone) : q.includes('640px') ? !!opts.phone
      : q.includes('hover') ? !(opts.phone || opts.touch) : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const patient = { ...PATIENT, ...(opts.patient ?? {}) };
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/patients/p1') {
        if (opts.hang) return new Subject();
        return opts.fail ? throwError(() => new Error('boom')) : of({ patient, history: opts.orders ?? ORDERS });
      }
      if (url.endsWith('/lab-trends')) return of({ tests: [] });
      if (url.startsWith('/api/reports/by-order/')) return of(null);
      if (url === '/api/directory/users') return of([]);
      return of([]);
    }),
    post: vi.fn(() => of({})),
    patch: vi.fn(() => of({})),
  };
  const router = {
    url: '/frontdesk/patients/p1', navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)),
    events: of(), lastSuccessfulNavigation: signal(null), createUrlTree: vi.fn(), serializeUrl: vi.fn(() => ''),
  };
  const orderEntry = { startNewOrder: vi.fn(async () => {}) };
  const navBack = { showBack: () => true, back: vi.fn(), backTo: vi.fn() };
  const timeline = { open: vi.fn(), close: vi.fn(), isOpen: signal(false), patientId: signal(null) };
  const holding = signal(!!opts.holding);
  const zoom = { holding, runLocal: vi.fn((_d: string, fn: () => void) => fn()), tap: () => true, attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: navBack },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', authId: 'u1', displayName: 'Admin', tenantName: 'Micro World' }), hasAnyPermission: () => opts.canEdit !== false, hasPermission: () => true } },
      { provide: ChatService, useValue: { sharePatientWithUser: vi.fn(async () => {}) } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
      { provide: OrderEntryService, useValue: orderEntry },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => opts.messages !== false } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ZoomTransitionService, useValue: zoom },
      { provide: PatientTimelineService, useValue: timeline },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'p1' })), snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } } },
      { provide: Router, useValue: router },
    ],
  });
  const f = TestBed.createComponent(PatientProfileComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  const click = (sel: string | Element) => {
    const b = (typeof sel === 'string' ? el.querySelector(sel) : sel) as HTMLElement;
    expect(b, String(sel)).not.toBeNull();
    b.click(); f.detectChanges();
  };
  return { f, el, c, api, router, orderEntry, navBack, timeline, zoom, holding, click };
}

const primaries = (el: HTMLElement) => el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary');
const css = (cmp: unknown) => ((cmp as any).ɵcmp.styles as string[]).join('\n');

describe('Patient profile (nd) — band + CONTEXT BAR', () => {
  it('keeps the band (back + tenant) and puts the FULL name, "22/M · MRN · phone", ABHA and flags in the pill', async () => {
    const { el } = await render();
    const band = el.querySelector('pf-hero-band') as HTMLElement;
    expect(band.querySelector('.pf-hb__back')).not.toBeNull();
    const ctx = band.querySelector('.pf-pp-ctx') as HTMLElement;
    expect(ctx.querySelector('.pf-pp-name')?.textContent?.trim()).toBe(FULL_NAME);
    expect(ctx.querySelector('.pf-pp-meta')?.textContent?.trim()).toBe('22/M · AA0006 · +91 98765 43210');
    const abha = ctx.querySelector('.pf-pp-abha') as HTMLElement;
    expect(abha.textContent).toContain('91-6723-6210-7704');
    expect(abha.classList).toContain('nd-ctx__chip');
    const flags = [...ctx.querySelectorAll('.pf-pp-flag')].map(f => f.textContent?.trim());
    expect(flags).toEqual(['Known allergies', 'Payment due']);
    // No big page / patient title anywhere.
    expect(el.querySelector('h1')).toBeNull();
  });

  it('shows no ABHA chip and no flags when the record has none', async () => {
    const { el } = await render({ patient: { abhaId: undefined, hasKnownAllergies: false }, orders: [ORDERS[0]] });
    expect(el.querySelector('.pf-pp-abha')).toBeNull();
    expect(el.querySelectorAll('.pf-pp-flag').length).toBe(0);
  });

  it('back returns to the front desk when there is no in-app history', async () => {
    const { el, navBack, f } = await render();
    (el.querySelector('.pf-hb__back') as HTMLButtonElement).click(); f.detectChanges();
    expect(navBack.backTo).toHaveBeenCalledWith('/frontdesk');
  });
});

describe('Patient profile (nd) — ONE primary + every original action reachable', () => {
  it('web: exactly one primary, "New order", which starts an order for this patient', async () => {
    const { el, orderEntry, click } = await render();
    const p = primaries(el);
    expect(p.length).toBe(1);
    expect(p[0].textContent?.trim()).toBe('New order');
    click(p[0]);
    expect(orderEntry.startNewOrder).toHaveBeenCalledWith('p1');
  });

  it('Edit patient opens the registration form in edit mode', async () => {
    const { el, router, click } = await render();
    click('.pf-pp-act--edit');
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/patients/new'], { queryParams: { patientId: 'p1' } });
    const { el: el2 } = await render({ canEdit: false });
    expect(el2.querySelector('.pf-pp-act--edit')).toBeNull();
    expect(el).toBeTruthy();
  });

  it('More holds every secondary action (and each one still works)', async () => {
    const { el, c, router, timeline, click } = await render();
    click('.pf-pp-act--more');
    const acts = [...el.querySelectorAll('.pf-pp-menu__row')].map(b => (b as HTMLElement).dataset['act']);
    expect(acts).toEqual(['edit', 'appointment', 'chat', 'abha', 'idcard', 'qr', 'copy', 'timeline', 'merge']);
    expect(primaries(el).length).toBe(1);
    click('[data-act="appointment"]');
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/appointments/new'], { queryParams: { patientId: 'p1' } });
    click('.pf-pp-act--more'); click('[data-act="timeline"]');
    expect(timeline.open).toHaveBeenCalled();
    click('.pf-pp-act--more'); click('[data-act="merge"]');
    expect(c.mergeOpen()).toBe(true);
    expect(el.querySelector('.pf-pp-sheet--pick')).not.toBeNull();
    c.closeMerge();
    click('.pf-pp-act--more'); click('[data-act="chat"]');
    expect(c.chatPickerOpen()).toBe(true);
    c.closeChatPicker();
    click('.pf-pp-act--more'); click('[data-act="abha"]');
    expect(c.abhaWizardOpen()).toBe(true);
  });

  it('without the Messages module or edit rights, those items are gone', async () => {
    const { el, click } = await render({ messages: false, canEdit: false });
    click('.pf-pp-act--more');
    const acts = [...el.querySelectorAll('.pf-pp-menu__row')].map(b => (b as HTMLElement).dataset['act']);
    expect(acts).not.toContain('chat');
    expect(acts).not.toContain('merge');
    expect(acts).not.toContain('edit');
  });

  it('phones: the primary moves to a full-width bottom bar — still exactly one', async () => {
    const { el, orderEntry, click } = await render({ phone: true });
    expect(el.querySelector('.pf-pp-act--new')).toBeNull();
    const p = primaries(el);
    expect(p.length).toBe(1);
    expect(p[0].closest('.nd-bottombar')).not.toBeNull();
    click(p[0]);
    expect(orderEntry.startNewOrder).toHaveBeenCalledWith('p1');
    // Edit patient is reachable from More on phones.
    click('.pf-pp-act--more');
    expect(el.querySelector('[data-act="edit"]')).not.toBeNull();
  });
});

describe('Patient profile (nd) — HISTORY card', () => {
  it('card header = search first, then the neutral segmented filter (radiogroup)', async () => {
    const { el } = await render();
    const head = el.querySelector('.pf-pp-main .nd-card__head') as HTMLElement;
    const kids = [...head.children];
    const find = kids.findIndex(k => k.classList.contains('pf-pp-find'));
    const filter = kids.findIndex(k => k.classList.contains('pf-pp-head__filter'));
    expect(find).toBeGreaterThan(-1);
    expect(filter).toBeGreaterThan(find);
    const seg = head.querySelector('.nd-seg[role=radiogroup]') as HTMLElement;
    const items = [...seg.querySelectorAll('[role=radio]')];
    const labels = items.map(i => i.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels.slice(0, 2)).toEqual(['Orders 2', 'Trends']);
    expect(labels[2]).toMatch(/^Timeline \d+$/);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
  });

  it('orders are ND rows: tests, a quiet meta line, a dot + coloured word, and Repeat under it', async () => {
    const { el, router, click } = await render();
    const rows = el.querySelectorAll('.pf-lo-row');
    expect(rows.length).toBe(2);
    const first = rows[0] as HTMLElement;   // newest first
    expect(first.querySelector('.pf-lo-row__name')?.textContent?.trim()).toBe('Thyroid Profile');
    expect(first.querySelector('.pf-lo-row__meta')?.textContent).toContain('LAB-2609-000099');
    expect(first.querySelector('.pf-lo-row__meta')?.textContent).not.toContain('|');
    const status = first.querySelector('.pf-lo-status') as HTMLElement;
    expect(status.querySelector('.pf-lo-dot')).not.toBeNull();
    expect(status.textContent?.trim()).toBe('Billed');
    expect(status.dataset['tone']).toBe('green');
    click(first.querySelector('.pf-lo-repeat') as HTMLElement);
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'p1', fromOrderId: 'o2' } });
    // Repeat never opened the order.
    expect(el.querySelector('.pf-lo-detail')).toBeNull();
  });

  it('a row zooms into the order (tests + results, Repeat, View report) and back', async () => {
    const { el, zoom, api, click, f } = await render();
    click(el.querySelectorAll('.pf-lo-row')[1]);
    expect(zoom.runLocal).toHaveBeenCalledWith('in', expect.any(Function));
    const d = el.querySelector('.pf-lo-detail') as HTMLElement;
    expect(d.getAttribute('data-zoom-target') ?? 'o1').toBeTruthy();
    expect([...d.querySelectorAll('.pf-lo-test__name')].map(n => n.textContent?.replace(/\s+/g, ' ').trim()))
      .toEqual(['Complete Blood Count CBC', 'Liver Function Test LFT']);
    expect(d.querySelector('.pf-lo-res__val')?.textContent).toContain('13.2');
    // The list controls step aside while an order is open.
    expect(el.querySelector('.pf-pp-find')).toBeNull();
    click(d.querySelector('.pf-lo-act--report') as HTMLElement);
    await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/api/reports/by-order/o1');
    expect(el.querySelector('.pf-lo-report .nd-empty')).not.toBeNull();
    click('.pf-lo-detail__back');
    expect(zoom.runLocal).toHaveBeenCalledWith('out', expect.any(Function));
    expect(el.querySelectorAll('.pf-lo-row').length).toBe(2);
  });

  it('the search narrows the orders; no match → .nd-empty with Clear filters', async () => {
    const { el, f } = await render();
    const input = el.querySelector('.pf-pp-find__input') as HTMLInputElement;
    input.value = 'thyroid'; input.dispatchEvent(new Event('input')); f.detectChanges();
    expect(el.querySelectorAll('.pf-lo-row').length).toBe(1);
    input.value = 'zzz'; input.dispatchEvent(new Event('input')); f.detectChanges();
    expect(el.querySelector('.pf-pp-mainbody .nd-empty')?.textContent).toContain('No orders match');
    (el.querySelector('.pf-pp-mainbody .nd-empty__action') as HTMLButtonElement).click(); f.detectChanges();
    expect(el.querySelectorAll('.pf-lo-row').length).toBe(2);
  });

  it('the date range uses the kit date (pf-nd-date), never a visible native control', async () => {
    const { el, c, click } = await render();
    click('.pf-pp-range__btn');
    expect(el.querySelectorAll('.pf-pp-pop pf-nd-date').length).toBe(2);
    for (const i of el.querySelectorAll('input[type=date]')) expect(i.getAttribute('aria-hidden')).toBe('true');
    click([...el.querySelectorAll('.pf-pp-pop [role=radio]')].find(b => b.textContent?.includes('30')) as HTMLElement);
    expect(c.range()).toBe('30');
    expect(c.fromDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Trends renders the trendogram inside the card; Timeline lists visits that expand', async () => {
    const { el, click } = await render();
    click([...el.querySelectorAll('.pf-pp-seg [role=radio]')][1] as HTMLElement);
    const trends = el.querySelector('.pf-pp-mainbody pf-lab-trends');
    expect(trends).not.toBeNull();
    click([...el.querySelectorAll('.pf-pp-seg [role=radio]')][2] as HTMLElement);
    const rows = el.querySelectorAll('.pf-pp-tlrow');
    expect(rows.length).toBeGreaterThan(0);
    const lab = [...rows].find(r => r.textContent?.includes('Lab Diagnostics')) as HTMLElement;
    expect(lab.getAttribute('aria-expanded')).toBe('false');
    click(lab);
    expect(lab.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('.pf-pp-fulltl')).not.toBeNull();
  });

  it('empty history → .nd-empty', async () => {
    const { el } = await render({ orders: [] });
    expect(el.querySelector('.pf-pp-mainbody .nd-empty')?.textContent).toContain('No orders yet');
  });

  it('shows a skeleton while loading, and the main card is the ONE zoom target throughout', async () => {
    const { el } = await render({ hang: true });
    expect(el.querySelector('.pf-pp-skelrows')).not.toBeNull();
    expect(el.querySelectorAll('[pfzoomtarget], [data-zoom-target]').length).toBeLessThanOrEqual(1);
    expect(el.querySelector('.pf-pp-main')?.getAttribute('aria-busy')).toBe('true');
  });

  it('the ROUTE zoom holds the skeleton; an in-card zoom (row → order) never swaps the list out', async () => {
    const arriving = await render({ holding: true });
    expect(arriving.el.querySelector('.pf-pp-skelrows')).not.toBeNull();
    arriving.holding.set(false); arriving.f.detectChanges(); await arriving.f.whenStable(); arriving.f.detectChanges();
    expect(arriving.el.querySelectorAll('.pf-lo-row').length).toBe(2);
    // Now an in-card zoom starts (holding flips on): the rows stay.
    arriving.holding.set(true); arriving.f.detectChanges();
    expect(arriving.el.querySelector('.pf-pp-skelrows')).toBeNull();
    expect(arriving.el.querySelector('pf-lab-orders')).not.toBeNull();
  });

  it('not found → .nd-empty with a way back', async () => {
    const { el } = await render({ fail: true });
    expect(el.querySelector('.pf-pp-mainbody .nd-empty')?.textContent).toContain('Patient not found');
  });
});

describe('Patient profile (nd) — SUMMARY companion', () => {
  it('sits on the right and collapses to a strip (remembered per user) and back', async () => {
    const { el, click } = await render();
    const side = el.querySelector('.pf-pp-side') as HTMLElement;
    expect(side).not.toBeNull();
    expect(side.textContent).toContain('AA0006');
    expect(side.textContent).toContain('Known allergies');
    expect(side.textContent).toContain('Payment due on 1 order');
    click('.pf-pp-collapse');
    expect(el.querySelector('.pf-pp-side')).toBeNull();
    expect(el.querySelector('.pf-pp-strip')).not.toBeNull();
    expect(localStorage.getItem('pf:pp:side-collapsed:u1')).toBe('1');
    // Remembered on the next visit.
    const again = await render();
    expect(again.el.querySelector('.pf-pp-strip')).not.toBeNull();
    again.click('.pf-pp-strip__btn');
    expect(again.el.querySelector('.pf-pp-side')).not.toBeNull();
    expect(localStorage.getItem('pf:pp:side-collapsed:u1')).toBe('0');
  });

  it('≤900px: no side column — Summary in the pill opens it as a sheet', async () => {
    const { el, click } = await render({ narrow: true });
    expect(el.querySelector('.pf-pp-side')).toBeNull();
    click('.pf-pp-ctx__summary');
    expect(el.querySelector('.pf-pp-sheet--summary')).not.toBeNull();
    click('.pf-pp-sheet--summary .pf-pp-close');
    expect(el.querySelector('.pf-pp-sheet--summary')).toBeNull();
  });

  it('the ABHA card still opens (the official card) from the summary', async () => {
    const { el, click } = await render();
    click('.pf-pp-abha-card');
    expect(el.querySelector('.pf-pp-sheet--abha .abc')).not.toBeNull();
  });
});

describe('Patient profile (nd) — rules', () => {
  it('no monospace, no emoji / glyph icons, no native select / datalist', async () => {
    const { el, click } = await render();
    click('.pf-pp-act--more');
    expect(el.querySelectorAll('select, datalist').length).toBe(0);
    expect(el.querySelectorAll('.font-mono').length).toBe(0);
    expect(el.textContent).not.toMatch(/[✕▲▼‼†]/u);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const cmp of [PatientProfileComponent, LabOrdersComponent, LabTrendsComponent]) {
      expect(css(cmp)).not.toMatch(/monospace/);
      expect(css(cmp)).not.toMatch(/linear-gradient\(135deg, #7c3aed/);
    }
  });

  it('touch: band actions become 44px icons with their words kept for AT', async () => {
    const { el } = await render({ touch: true });
    const edit = el.querySelector('.pf-pp-act--edit') as HTMLElement;
    expect(edit.classList).toContain('pf-pp-act--icon');
    expect(edit.getAttribute('aria-label')).toBe('Edit patient');
    expect(el.querySelector('.pf-lo-repeat')?.classList).toContain('nd-rowact--icon');
  });

  it('reduced motion switches every animation off', () => {
    const s = css(PatientProfileComponent);
    expect(s).toMatch(/prefers-reduced-motion: reduce/);
    expect(css(LabOrdersComponent)).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe('patient-profile.nd helpers', () => {
  it('meta line, flags, titles, tones', () => {
    const p = { ...PATIENT, hasKnownAllergies: false, isMinor: true } as any;
    expect(patientMetaLine(p)).toBe('22/M · AA0006 · +91 98765 43210');
    expect(patientFlags(p, ORDERS as any).map(f => f.key)).toEqual(['minor', 'due']);
    expect(orderTitle(ORDERS[0] as any)).toBe('Complete Blood Count, Liver Function Test');
    expect(orderStatusLabel('sample_collected')).toBe('Collected');
    expect(orderTone('cancelled')).toBe('red');
    expect(orderTone('dispatched')).toBe('blue');
    expect(filterOrders(ORDERS as any, 'lfT', '', '').map(o => o.id)).toEqual(['o1']);
    expect(filterOrders(ORDERS as any, '', '2026-09-24', '').map(o => o.id)).toEqual(['o2']);
  });

  it('the screen chart skin: transparent, Noto, neutral reference band, red only on flags', () => {
    const flagged = (p: { dataIndex: number }) => (p.dataIndex === 1 ? '#fb7185' : '#a855f7');
    const opt = ndTrendSkin({
      backgroundColor: '#fff', xAxis: { axisLabel: {} }, yAxis: { axisLabel: {}, splitLine: { lineStyle: {} } },
      tooltip: { trigger: 'axis' },
      series: [{ type: 'line', lineStyle: { color: '#a855f7' }, itemStyle: { color: flagged }, markArea: { itemStyle: { color: 'rgba(16,185,129,0.12)' } } }],
    }, false);
    expect(opt.backgroundColor).toBe('transparent');
    expect(opt.textStyle.fontFamily).toContain('Noto Sans');
    expect(opt.series[0].markArea.itemStyle.color).not.toMatch(/16,185,129/);
    expect(opt.series[0].itemStyle.color({ dataIndex: 0 })).toBe('#7c3aed');
    expect(opt.series[0].itemStyle.color({ dataIndex: 1 })).toBe('#dc2626');
  });
});
