import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ReportViewerComponent, RV_DONE_MS } from './report-viewer.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { DialogService } from '../../../core/services/dialog.service';
import { ReportActionsService } from '../../../core/services/report-actions.service';
import { WhatsAppSendService } from '../../../core/services/whatsapp-send.service';

/**
 * Report view on the nd pattern (docs/PF-PATTERN.md → "Report view"):
 * band (back + tenant + actions, ONE primary) + CONTEXT BAR (patient,
 * order, status, date), PREVIEW main card (skeleton → the painted PDF,
 * one zoom target throughout) + REPORT side card (collapsible strip), the
 * phone More sheet, and no native controls.
 */
const FULL_NAME = 'Mr. Sathish Kumaravel Ramasamy';
const REPORT = {
  id: 'rep-1', orderId: 'ord-1', patientId: 'p1', type: 'final', status: 'generated',
  deliveryStatus: 'pending', createdAt: '2026-09-26T04:30:00Z', qrToken: 'tok',
  data: JSON.stringify({
    patient: { displayName: FULL_NAME, age: 29, sex: 'Male', mrn: 'AA0012', phone: '9876543210' },
    order: { id: 'ord-1', orderNumber: 'LAB-2609-000123' },
    type: 'final', isPartial: false, tests: [],
  }),
};

type Opts = { current?: { displayName?: string; phone?: string }; narrow?: boolean; phone?: boolean; perms?: boolean | string[]; messages?: boolean; fail?: boolean; partial?: boolean; holding?: boolean; partner?: boolean | 'attached'; waCloud?: boolean; waStatus?: string; pdfParts?: unknown };

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
  vi.useRealTimers();
});

async function render(opts: Opts = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!(opts.narrow || opts.phone) : q.includes('640px') ? !!opts.phone
      : q.includes('hover') ? !opts.phone : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  // The real PDF paint (jsPDF + pdf.js) can't run here: the tests drive
  // the ready / error signals themselves.
  const renderSpy = vi.spyOn(ReportViewerComponent.prototype, 'renderPdfView').mockResolvedValue(undefined);
  const report0 = opts.partial
    ? { ...REPORT, type: 'partial', data: JSON.stringify({ ...JSON.parse(REPORT.data), isPartial: true, pendingDepts: ['Microbiology'] }) }
    : REPORT;
  const report = opts.current ? { ...report0, patient: opts.current } : report0;
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/reports/')) return opts.fail ? throwError(() => new Error('boom')) : of(report);
      if (url === '/api/config/report-template') return of({ dateFormat: 'dd MMM yyyy', timeFormat: '24h' });
      if (url === '/api/directory/users') return of([{ id: 'u2', displayName: 'Priya Nair', email: 'priya@lab', isActive: true }]);
      if (url === '/api/whatsapp/settings') return of({ canSend: !!opts.waCloud });
      return of([]);
    }),
    post: vi.fn((url: string) => url.endsWith('/resend')
      ? of({ id: 'm1', reportId: 'rep-1', trigger: 'resend', kind: 'report_ready', status: opts.waStatus ?? 'sent', attempts: 1,
             to: '••••••••3210', toDisplay: '+91 ••••• 43210', createdAt: '2026-09-28T10:00:00Z', errorReason: opts.waStatus === 'failed' ? 'Message undeliverable.' : null })
      : of({})),
  };
  const holding = signal(!!opts.holding);
  const outsourcing = {
    apiBase: '',
    partnerReports: vi.fn(async () => opts.partner
      ? [{ orderTestId: 'ot9', testName: 'Vitamin D', partnerLabName: 'Metro Labs', url: '/x.pdf',
           ...(opts.partner === 'attached' ? { attachToReport: true, inReport: true } : {}) }]
      : []),
    pdfParts: vi.fn(async () => opts.pdfParts ?? { stored: true, combined: false, parts: [] }),
    setAttachToReport: vi.fn(async () => []),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', displayName: 'Admin User', tenantName: 'Micro World' }), hasPermission: (p: string) => Array.isArray(opts.perms) ? opts.perms.includes(p) : opts.perms !== false } },
      { provide: ChatService, useValue: { openConversationWithContext: vi.fn(async () => 'c1'), shareReport: vi.fn(async () => {}) } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => opts.messages !== false } },
      { provide: OutsourcingService, useValue: outsourcing },
      { provide: ReportLayoutService, useValue: { preview: () => of({ sections: [] }) } },
      { provide: ZoomTransitionService, useValue: { holding, attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'rep-1']]) } } },
      { provide: Router, useValue: { url: '/reports/view/rep-1', navigate: vi.fn(() => Promise.resolve(true)), events: of() } },
    ],
  });
  const f = TestBed.createComponent(ReportViewerComponent);
  f.detectChanges();
  await f.whenStable();
  await new Promise(r => setTimeout(r, 0));
  f.detectChanges();
  const c = f.componentInstance as any;
  const ready = () => { c._pdfReady.set(true); c.pageCount.set(2); f.detectChanges(); };
  return { f, el: f.nativeElement as HTMLElement, c, api, renderSpy, holding, ready, outsourcing };
}

const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-btn--primary, .pf-hb-btn--primary');
/** Component CSS with Angular's scoping attributes stripped. */
const css = () => ((ReportViewerComponent as any).ɵcmp.styles as string[]).join('\n')
  .replace(/\[_ng(content|host)-%COMP%\]/g, '');

describe('Report view (nd) — band + CONTEXT BAR', () => {
  it('keeps the band (back to the Results list) and puts patient, order, status and date in the pill', async () => {
    const { el } = await render();
    const band = el.querySelector('pf-hero-band') as HTMLElement;
    expect(band).not.toBeNull();
    expect(el.querySelector('pf-screen-header')).toBeNull();
    expect(band.querySelector('.pf-hb__back')).not.toBeNull();
    const ctx = band.querySelector('.pf-rv-ctx') as HTMLElement;
    expect(ctx.querySelector('.pf-rv-chip--patient .pf-rv-chip__name')?.textContent?.trim()).toBe(FULL_NAME);
    expect(ctx.querySelector('.pf-rv-chip--patient .pf-rv-chip__meta')?.textContent).toContain('29/M');
    expect(ctx.querySelector('.pf-rv-chip--order')?.textContent).toContain('LAB-2609-000123');
    expect(ctx.querySelector('.pf-rv-chip--status')?.textContent).toContain('Final');
    expect(ctx.querySelector('.pf-rv-chip--status')?.textContent).toContain('Completed');
    expect(ctx.querySelector('.pf-rv-ctx__date')?.textContent?.trim()).toContain('2026');
  });

  it('a preliminary report says so in the pill and above the pages (an SVG, never a glyph)', async () => {
    const { el } = await render({ partial: true });
    expect(el.querySelector('.pf-rv-chip--status')?.textContent).toContain('Preliminary');
    const note = el.querySelector('.pf-rv-notice') as HTMLElement;
    expect(note.textContent).toContain('Microbiology');
    expect(note.querySelector('svg')).not.toBeNull();
    expect(note.textContent).not.toMatch(/⚠/);
  });
});

describe('Report view (nd) — actions', () => {
  it('ONE primary (Send WhatsApp) in the band; Edit / Print / Share with are quiet secondaries', async () => {
    const { el } = await render();
    const actions = el.querySelector('pf-hero-band .pf-hb__actions') as HTMLElement;
    expect(primaries(el).length).toBe(1);
    expect(actions.querySelector('.pf-hb-btn--primary')?.getAttribute('aria-label')).toBe('Send WhatsApp');
    for (const k of ['edit', 'print', 'share', 'more']) {
      const b = actions.querySelector(`.pf-rv-act--${k}`) as HTMLElement;
      expect(b, k).not.toBeNull();
      expect(b.classList).toContain('pf-hb-btn--ghost');
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
    // Web: plain text labels, no icon mode.
    expect(actions.querySelector('.pf-rv-act--print')?.classList).not.toContain('pf-rv-act--icon');
    expect(actions.querySelector('.pf-rv-act--print .pf-rv-act__t')?.textContent?.trim()).toBe('Print');
  });

  it('every original action still works: Edit, Print, Share with…, Send WhatsApp, partner report', async () => {
    const { el, c, f, api } = await render({ partner: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    (el.querySelector('.pf-rv-act--edit') as HTMLButtonElement).click();
    expect(c.editDialogOpen()).toBe(true);
    c.editDialogOpen.set(false);

    const print = vi.spyOn(c, 'print').mockResolvedValue(undefined);
    (el.querySelector('.pf-rv-act--print') as HTMLButtonElement).click();
    expect(print).toHaveBeenCalled();

    (el.querySelector('.pf-rv-act--share') as HTMLButtonElement).click();
    await f.whenStable(); f.detectChanges();
    expect(el.querySelector('.pf-rv-sheet--share')).not.toBeNull();
    expect(el.querySelector('.pf-rv-share__row')?.textContent).toContain('Priya Nair');
    c.closeSharePicker(); f.detectChanges();

    (el.querySelector('.pf-rv-act--send') as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith(expect.stringContaining('wa.me'), '_blank', 'noopener');
    expect(api.post).toHaveBeenCalledWith('/api/reports/rep-1/deliver', expect.objectContaining({ via: 'whatsapp' }));

    f.detectChanges();
    const partner = el.querySelector('.pf-rv-partner .pf-rowact') as HTMLButtonElement;
    expect(partner.getAttribute('aria-label')).toContain('Vitamin D');
    partner.click();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('Edit hides without edit_result, Share without the Messages module', async () => {
    const { el } = await render({ perms: ['deliver_report'], messages: false });
    expect(el.querySelector('.pf-rv-act--edit')).toBeNull();
    expect(el.querySelector('.pf-rv-act--share')).toBeNull();
    expect(primaries(el).length).toBe(1);
  });

  it('VIEW-ONLY (view_report, no deliver_report): the report shows with Print, but no Send / Share', async () => {
    const { el } = await render({ perms: ['view_report'] });
    expect(el.querySelector('.pf-rv-act--send')).toBeNull();
    expect(el.querySelector('.pf-rv-act--print')).not.toBeNull();   // owner 2026-09-27: view-only may print
    expect(el.querySelector('.pf-rv-act--share')).toBeNull();
    expect(el.querySelector('.pf-rv-act--edit')).toBeNull();
    expect(primaries(el).length).toBe(0);
    // …a view_report + edit_result viewer (Lab Technician) keeps Edit and its sheet.
    TestBed.resetTestingModule();
    const lt = await render({ perms: ['view_report', 'edit_result'] });
    expect(lt.el.querySelector('.pf-rv-act--edit')).not.toBeNull();
    expect(lt.el.querySelector('.pf-rv-act--send')).toBeNull();
  });

  it('VIEW-ONLY: Print prints (letterpad choice honoured) and records NO delivery', async () => {
    const { c, api } = await render({ perms: ['view_report'] });
    const blob = vi.spyOn(c, 'buildPdfBlob').mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    const had = (URL as any).createObjectURL;
    (URL as any).createObjectURL = vi.fn(() => 'blob:print');
    try {
      await c.print();
    } finally {
      (URL as any).createObjectURL = had;
      document.querySelectorAll('iframe[src="blob:print"]').forEach(f => f.remove());
    }
    expect(blob).toHaveBeenCalled();
    expect(c.done()).toBe('print');
    expect(api.post).not.toHaveBeenCalled();   // no /deliver, no archive upload
  });

  it('VIEW-ONLY phones: the ⋮ sheet holds Download + Print only (no share, no send)', async () => {
    const { el, f } = await render({ perms: ['view_report'], phone: true });
    (el.querySelector('.pf-rv-act--more') as HTMLButtonElement).click();
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    const rows = Array.from(document.body.querySelectorAll('[role=menu] [role=menuitem]')).map(b => b.querySelector('.pf-am-item__t')?.textContent?.trim());
    expect(rows).toEqual(['Download PDF', 'Print']);
    document.querySelectorAll('.pf-am-layer').forEach(n => n.remove());
  });

  it('no report permission path: without view/deliver/validate there is no Print', async () => {
    const { el } = await render({ perms: ['edit_result'] });
    expect(el.querySelector('.pf-rv-act--print')).toBeNull();
  });

  it('VIEW-ONLY: deliverWhatsApp() never records a delivery', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { c, api } = await render({ perms: ['view_report'] });
    c.deliverWhatsApp();
    expect(open).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining('/deliver'), expect.anything());
  });

  it('Send shows a brief "Sent" success state (SVG check), then returns to its label', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { el, f, c } = await render();
    vi.useFakeTimers();
    (el.querySelector('.pf-rv-act--send') as HTMLButtonElement).click();
    f.detectChanges();
    const send = el.querySelector('.pf-rv-act--send') as HTMLElement;
    expect(send.classList).toContain('pf-rv-act--done');
    expect(send.querySelector('.pf-rv-act__t')?.textContent?.trim()).toBe('Sent');
    expect(send.querySelector('.pf-rv-act__check')).not.toBeNull();
    // The recorded delivery shows in the REPORT card.
    expect(c.deliveryLine()).toBe('Delivered via WhatsApp');
    vi.advanceTimersByTime(RV_DONE_MS + 10);
    f.detectChanges();
    expect(el.querySelector('.pf-rv-act--send .pf-rv-act__t')?.textContent?.trim()).toBe('Send WhatsApp');
  });
});

describe('Report view (nd) — PREVIEW card, skeleton + zoom', () => {
  it('the skeleton shows before the preview renders; the pages fade in once painted', async () => {
    const { el, ready } = await render();
    expect(el.querySelector('.pf-rv-skel')).not.toBeNull();
    expect(el.querySelector('.pf-rv-pages')?.classList).not.toContain('pf-rv-pages--in');
    expect(el.querySelector('.pf-rv-card')?.getAttribute('aria-busy')).toBe('true');
    ready();
    expect(el.querySelector('.pf-rv-skel')).toBeNull();
    expect(el.querySelector('.pf-rv-pages')?.classList).toContain('pf-rv-pages--in');
    expect(el.querySelector('.pf-rv-card__count')?.textContent?.trim()).toBe('2 pages');
  });

  it('ONE zoom target (the card) from skeleton to pages; the skeleton is held through the morph', async () => {
    const { el, holding, f, ready } = await render({ holding: true });
    const card = el.querySelector('.pf-rv-card') as HTMLElement;
    expect(card.hasAttribute('data-zoom-target')).toBe(true);
    expect(el.querySelectorAll('[data-zoom-target]').length).toBe(1);
    expect(el.querySelector('.pf-rv-skel')).not.toBeNull();
    expect(el.querySelector('.pf-rv-pages')).toBeNull();          // not mounted mid-morph
    holding.set(false); f.detectChanges();
    expect(el.querySelector('.pf-rv-pages')).not.toBeNull();
    ready();
    expect(el.querySelector('.pf-rv-card')).toBe(card);          // never swapped
  });

  it('errors use the kit .pf-empty with Try again (load + render)', async () => {
    const a = await render({ fail: true });
    expect(a.el.querySelector('.pf-rv-preview .pf-empty .pf-empty__title')?.textContent).toContain('Couldn’t load');
    TestBed.resetTestingModule();
    const b = await render();
    b.c._pdfError.set('Could not render the report PDF.'); b.f.detectChanges();
    const empty = b.el.querySelector('.pf-rv-preview .pf-empty') as HTMLElement;
    expect(empty.textContent).toContain('Could not render the report PDF.');
    (empty.querySelector('button') as HTMLButtonElement).click();
    expect(b.renderSpy).toHaveBeenCalled();
  });
});

describe('Report view (nd) — REPORT side card', () => {
  it('sits on the right with the status line and collapses to a strip (remembered) and back', async () => {
    const { el, f } = await render();
    const side = el.querySelector('.pf-rv-side') as HTMLElement;
    expect(side.querySelector('.pf-card__label')?.textContent?.trim()).toBe('Report');
    expect(side.querySelector('.pf-rv-state')?.textContent).toContain('Ready to deliver');
    // Side card comes AFTER the preview (an action / summary companion → RIGHT).
    const body = el.querySelector('.pf-rv-body') as HTMLElement;
    expect(body.lastElementChild).toBe(side);
    (el.querySelector('.pf-rv-collapse') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-rv-side')).toBeNull();
    expect(el.querySelector('.pf-rv-strip')).not.toBeNull();
    expect(body.classList).toContain('pf-rv-body--collapsed');
    expect(localStorage.getItem('pf:rv:side-collapsed:u1')).toBe('1');
    (el.querySelector('.pf-rv-strip__btn') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-rv-side')).not.toBeNull();
    expect(localStorage.getItem('pf:rv:side-collapsed:u1')).toBe('0');
  });

  it('≤900px: no side column — Details in the pill opens the REPORT card as a sheet', async () => {
    const { el, f } = await render({ narrow: true });
    expect(el.querySelector('.pf-rv-side')).toBeNull();
    const details = el.querySelector('.pf-rv-ctx .pf-rv-ctx__details') as HTMLButtonElement;
    expect(details.getAttribute('aria-label')).toBe('Report details');
    details.click(); f.detectChanges();
    expect(el.querySelector('.pf-rv-sheet--details .pf-rv-state')).not.toBeNull();
    expect(el.querySelector('.pf-rv-scrim')).not.toBeNull();
  });
});

describe('Report view (nd) — phones', () => {
  it('the ⋮ sheet reaches EVERY action (the primary stays in the band)', async () => {
    const { el, f, c } = await render({ phone: true });
    const print = vi.spyOn(c, 'print').mockResolvedValue(undefined);
    const trigger = el.querySelector('.pf-rv-act--more') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    trigger.click();
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    const menu = document.body.querySelector('[role=menu]') as HTMLElement;
    expect(menu.classList).toContain('pf-am-panel--sheet');
    const rows = Array.from(menu.querySelectorAll('[role=menuitem]')).map(b => b.querySelector('.pf-am-item__t')?.textContent?.trim());
    expect(rows).toEqual(['Share…', 'Copy patient link', 'Send on WhatsApp', 'Share with a colleague', 'Download PDF', 'Print',
      'Edit results', 'Regenerate', 'Open patient', 'Open lab results']);
    (menu.querySelector('[data-action=print]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(print).toHaveBeenCalled();
    expect(document.body.querySelector('[role=menu]')).toBeNull();
    // Touch → the band buttons are icon buttons with their words kept for AT.
    expect(el.querySelector('.pf-rv-act--send')?.classList).toContain('pf-rv-act--icon');
    expect(el.querySelector('.pf-rv-act--send')?.getAttribute('aria-label')).toBe('Send WhatsApp');
  });

  it('phone CSS: 44px icons, full-width preview, sheets above the navbar', () => {
    const s = css();
    const phone = s.slice(s.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.pf-rv-band\s+\.pf-rv-act\s*\{/);
    expect(phone).toMatch(/width: 44px/);
    expect(s).toMatch(/\.pf-rv-card\s*\{\s*border-radius: 0/);
    expect(s).toMatch(/bottom: var\(--pf-nav-h/);
  });
});

describe('Report view (nd) — rules', () => {
  it('no native controls, no emoji / glyph icons, SVG strokes at 1.8', async () => {
    const { el, f, c } = await render({ partner: true });
    await c.openSharePicker(); f.detectChanges();
    expect(el.querySelectorAll('select, datalist').length).toBe(0);
    expect(el.textContent).not.toMatch(/[✕⚠✓✔]/u);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    // (the shared band's own back chevron is not this screen's)
    const strokes = Array.from(el.querySelectorAll('svg[stroke-width]')).filter(s => !s.closest('.pf-hb__back')).map(s => s.getAttribute('stroke-width'));
    expect(strokes.length).toBeGreaterThan(0);
    expect(new Set(strokes)).toEqual(new Set(['1.8']));
  });

  it('reduced motion switches every animation + the collapse transition off', () => {
    const s = css();
    const rm = s.slice(s.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of ['.pf-rv-in', '.pf-rv-act--done', '.pf-rv-pages--in', '.pf-rv-side', '.pf-rv-strip', '.pf-rv-scrim', '.pf-rv-sheet']) {
      expect(rm, cls).toContain(cls);
    }
    expect(rm).toMatch(/animation: none !important/);
    expect(rm).toMatch(/\.pf-rv-body\s*\{\s*transition: none !important/);
  });

  it('palette: no green / amber in the component styles; Noto tabular numbers for IDs + dates', async () => {
    const s = css();
    expect(s).not.toMatch(/#(b45309|fef3c7|78350f|f59e0b|92400e|10b981|16a34a|22c55e)/i);
    expect(s).not.toMatch(/monospace/);
    const { el } = await render();
    expect(el.querySelector('.pf-rv-chip--order .pf-num')).not.toBeNull();
    expect(el.querySelector('.pf-rv-ctx__date')?.classList).toContain('pf-num');
  });
});

describe('Report view (nd) — ⋮ report actions: permission + state rules', () => {
  const ids = (c: any) => (c.menuActions() as Array<{ id: string }>).map(a => a.id);
  afterEach(() => document.querySelectorAll('.pf-am-layer').forEach(n => n.remove()));

  it('the ⋮ shows on web too (not only phones), with a popover beside the button', async () => {
    const { el, f } = await render();
    const trigger = el.querySelector('pf-actions-menu .pf-rv-act--more') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toBe('Report actions');
    trigger.click(); f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    expect(document.body.querySelector('[role=menu]')?.classList).not.toContain('pf-am-panel--sheet');
  });

  it('pathologist (validate_result only): Download, Print, Regenerate, Open lab results — no share / send / edit', async () => {
    const { c } = await render({ perms: ['validate_result'] });
    expect(ids(c)).toEqual(['download', 'print', 'regenerate', 'lab']);
  });

  it('delivery desk without edit_result / lab access: share rows + WhatsApp, no Edit / Lab results', async () => {
    const { c } = await render({ perms: ['deliver_report', 'view_order', 'view_patient'], messages: false });
    expect(ids(c)).toEqual(['share', 'copy-link', 'whatsapp', 'download', 'print', 'regenerate', 'patient']);
  });

  it('a PRELIMINARY report is never regenerated as final from here', async () => {
    const { c } = await render({ partial: true });
    expect(ids(c)).not.toContain('regenerate');
  });

  it('Regenerate asks first (DialogService) — cancel sends nothing', async () => {
    const { c, api } = await render();
    const confirm = vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(false);
    c.runAction('regenerate');
    await new Promise(r => setTimeout(r, 0));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Regenerate report?' }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Regenerate confirmed → POST /api/reports/generate and the viewer moves to the new version', async () => {
    const { c, api } = await render();
    vi.spyOn(TestBed.inject(DialogService), 'confirm').mockResolvedValue(true);
    api.post.mockReturnValue(of({ ...REPORT, id: 'rep-2' }) as never);
    const router = TestBed.inject(Router) as any;
    await c.regenerate();
    expect(api.post).toHaveBeenCalledWith('/api/reports/generate', { orderId: 'ord-1', type: 'final' });
    expect(c.report().id).toBe('rep-2');
    expect(router.navigate).toHaveBeenCalledWith(['/reports/view', 'rep-2'], { replaceUrl: true });
  });

  it('Share… / Copy patient link go through the shared ReportActionsService (prefetched on open)', async () => {
    const { c } = await render();
    const svc = TestBed.inject(ReportActionsService);
    const share = vi.spyOn(svc, 'share').mockResolvedValue('shared');
    const copy = vi.spyOn(svc, 'copyLink').mockResolvedValue('copied');
    const pre = vi.spyOn(svc, 'prefetch').mockImplementation(() => {});
    c.onMenuOpened();
    expect(pre).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1' }));
    c.runAction('share');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1' }), FULL_NAME);
    c.runAction('copy-link');
    expect(copy).toHaveBeenCalled();
  });

  it('Open patient / Open lab results navigate to the existing screens', async () => {
    const { c, api } = await render();
    const router = TestBed.inject(Router) as any;
    c.runAction('patient');
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/patients', 'p1']);
    api.get.mockImplementation(((url: string) => url === '/api/orders/ord-1' ? of({ samples: [{ id: 's9' }] }) : of([])) as never);
    await c.openLabResults();
    expect(router.navigate).toHaveBeenCalledWith(['/lab/sample', 's9'], { queryParams: { view: 1 } });
  });

  it('Download PDF saves the same PDF the preview shows (no delivery recorded)', async () => {
    const { c, api } = await render();
    vi.spyOn(c, 'buildPdfBlob').mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    const had = (URL as any).createObjectURL;
    (URL as any).createObjectURL = vi.fn(() => 'blob:dl');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try { await c.download(); } finally { (URL as any).createObjectURL = had; }
    expect(click).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Report view (nd) — Send WhatsApp through the lab\'s WhatsApp Cloud API number', () => {
  const sendBtn = (el: HTMLElement) => el.querySelector('.pf-rv-act--send') as HTMLButtonElement;

  it('lab with a sender: the primary sends from the server (no wa.me window) and shows Sent with the check', async () => {
    const { el, f, c, api } = await render({ waCloud: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(c.waCloud()).toBe(true);
    expect(primaries(el).length).toBe(1);
    sendBtn(el).click();
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/whatsapp/reports/rep-1/resend', {});
    expect(open).not.toHaveBeenCalled();
    expect(sendBtn(el).textContent).toContain('Sent');
    expect(sendBtn(el).querySelector('svg')).not.toBeNull();
    expect(sendBtn(el).getAttribute('aria-label')).toBe('Sent on WhatsApp');
    expect(c.waState()).toMatchObject({ phase: 'sent', to: '+91 ••••• 43210' });
    // The delivery is recorded like the wa.me flow; the REPORT card reflects it.
    expect(api.post).toHaveBeenCalledWith('/api/reports/rep-1/deliver', { via: 'whatsapp', note: 'WhatsApp Cloud API' });
    expect(c.deliveryLine()).toBe('Delivered via WhatsApp');
    (TestBed.inject(WhatsAppSendService) as any).stopWatch('rep-1');
  });

  it('a Meta failure keeps the label "Send WhatsApp" and records no delivery', async () => {
    const { el, f, api } = await render({ waCloud: true, waStatus: 'failed' });
    sendBtn(el).click();
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
    expect(sendBtn(el).textContent).toContain('Send WhatsApp');
    expect(api.post).not.toHaveBeenCalledWith('/api/reports/rep-1/deliver', expect.anything());
  });

  it('the ⋮ keeps wa.me as the secondary "Share via my WhatsApp"', async () => {
    const { c } = await render({ waCloud: true });
    const ids = c.menuActions().map((a: { id: string }) => a.id);
    expect(ids).toContain('whatsapp');
    expect(ids).toContain('whatsapp-mine');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    c.runAction('whatsapp-mine');
    expect(open).toHaveBeenCalledWith(expect.stringContaining('wa.me'), '_blank', 'noopener');
  });

  it('wa.me goes to the patient AS ON FILE (a corrected name / mobile), not the issued snapshot', async () => {
    const { c } = await render({ waCloud: true, current: { displayName: 'Ms. Yamini Rao', phone: '9123456789' } });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    c.runAction('whatsapp-mine');
    const url = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(url).toContain('9123456789');
    expect(url).not.toContain('9876543210');
    expect(url).toContain('Hi Ms. Yamini Rao,');
  });

  it('lab without a sender: today\'s wa.me flow, one WhatsApp row', async () => {
    const { el, c, api } = await render({ waCloud: false });
    expect(c.waCloud()).toBe(false);
    expect(c.menuActions().map((a: { id: string }) => a.id)).not.toContain('whatsapp-mine');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    sendBtn(el).click();
    expect(open).toHaveBeenCalledWith(expect.stringContaining('wa.me'), '_blank', 'noopener');
    expect(api.post).not.toHaveBeenCalledWith('/api/whatsapp/reports/rep-1/resend', {});
  });

  it('a preliminary report never goes through the server send', async () => {
    const { c } = await render({ waCloud: true, partial: true });
    expect(c.waCloud()).toBe(false);
  });
});

describe('Report view (nd) — partner reports tell the truth about the PDF', () => {
  const where = (el: HTMLElement) => el.querySelector('[data-testid="rv-partner-where"]') as HTMLElement;

  it('attached AND joined in the served PDF: "In this PDF, after our report" — no Attach action', async () => {
    const { el, f, c } = await render({ partner: 'attached',
      pdfParts: { stored: true, combined: true, parts: [{ url: '/x.pdf', joined: true, problem: null }] } });
    c.refreshPdfParts('rep-1'); await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    expect(where(el).textContent?.trim()).toBe('In this PDF, after our report');
    expect(el.querySelector('[data-testid="rv-partner-attach"]')).toBeNull();
  });

  it('attached but the served PDF lacks it (LAB-2609-000154): a red warning with the reason, never "In this PDF"', async () => {
    const { el, f, c } = await render({ partner: 'attached',
      pdfParts: { stored: true, combined: false, parts: [{ url: '/x.pdf', joined: false, problem: 'The partner file is no longer on the server.' }] } });
    expect(where(el).textContent).not.toContain('In this PDF');
    c.refreshPdfParts('rep-1'); await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    expect(where(el).textContent?.trim()).toBe('Not in this PDF — The partner file is no longer on the server.');
    expect(where(el).classList).toContain('pf-rv-partner__lab--warn');
  });

  it('a legacy upload (LAB-2609-000153): "Attach to report" attaches every line of that file and reloads the preview', async () => {
    const { el, f, outsourcing, renderSpy } = await render({ partner: true });
    expect(where(el).textContent?.trim()).toBe('Sent as a separate file — attach it to send one PDF');
    const btn = el.querySelector('[data-testid="rv-partner-attach"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toContain('Vitamin D');
    const before = renderSpy.mock.calls.length;
    const fetched = outsourcing.partnerReports.mock.calls.length;
    btn.click();
    await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    expect(outsourcing.setAttachToReport).toHaveBeenCalledWith(['ot9'], true);
    expect(outsourcing.partnerReports.mock.calls.length).toBe(fetched + 1);
    // The preview is painted again from the server — now ours + the partner pages.
    expect(renderSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it('no Attach action without the desk permission', async () => {
    const { el } = await render({ partner: true, perms: ['view_report'] });
    expect(el.querySelector('[data-testid="rv-partner-attach"]')).toBeNull();
  });
});
