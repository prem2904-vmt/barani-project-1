import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ShareService } from '../../../core/services/share.service';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { LabOrdersComponent } from './lab-orders.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { ReportActionsService } from '../../../core/services/report-actions.service';

/**
 * Patient profile → an order zoomed in: the ⋮ report actions next to
 * Repeat / View report. Shown only once the order has a report; rows by the
 * endpoint / route guard each one uses; each runs the shared flow.
 */
const REP = {
  id: 'rep-1', orderId: 'o1', qrToken: 'q1', type: 'final',
  data: JSON.stringify({ patient: { displayName: 'Priya Nair', phone: '9876543210' } }),
};
const order = (withReport = true) => ({
  id: 'o1', orderNumber: 'LAB-1', createdAt: '2026-09-26T10:00:00Z', status: 'validated', samples: [],
  ...(withReport ? { report: { id: 'rep-1', status: 'final', deliveryStatus: 'pending' } } : {}),
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.pf-am-layer').forEach(n => n.remove());
  vi.restoreAllMocks();
});

async function render(o: { perms?: string[]; withReport?: boolean; waCloud?: boolean; rep?: unknown; messages?: boolean } = {}) {
  const perms = o.perms ?? ['view_order', 'deliver_report', 'view_report'];
  const api = {
    get: vi.fn((url: string) => url === '/api/reports/by-order/o1' ? of(o.rep ?? REP)
      : url === '/api/whatsapp/settings' ? of({ canSend: !!o.waCloud }) : of(null)),
    post: vi.fn(() => of({})),
  };
  const router = { url: '/frontdesk/patients/p1', navigate: vi.fn(() => Promise.resolve(true)), events: of() };
  (window as any).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { prompt: vi.fn(async () => null), confirm: vi.fn(async () => false), choose: vi.fn(async () => null) } },
      { provide: AuthService, useValue: {
        user: () => ({ id: 'u1', tenantName: 'Micro World' }),
        hasPermission: (p: string) => perms.includes(p),
        hasAnyPermission: (ps: string[]) => ps.some(p => perms.includes(p)),
      } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), runLocal: (_d: string, fn: () => void) => fn(), attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} } },
      { provide: Router, useValue: router },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => o.messages !== false } },
    ],
  });
  const f = TestBed.createComponent(LabOrdersComponent);
  f.componentRef.setInput('orders', [order(o.withReport !== false)]);
  f.componentRef.setInput('patientId', 'p1');
  f.componentRef.setInput('detailId', 'o1');
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api, router };
}
const ids = (c: any) => c.detailActions().map((a: { id: string }) => a.id);

describe('Patient profile order detail — ⋮ report actions', () => {
  it('delivery desk: share rows, WhatsApp, download, print, open full report, repeat', async () => {
    const { c, el } = await render();
    expect(ids(c)).toEqual(['share', 'copy-link', 'whatsapp', 'download', 'print', 'open-report', 'repeat']);
    const kebab = el.querySelector('.pf-lo-detail__acts pf-actions-menu .pf-lo-act--more') as HTMLButtonElement;
    expect(kebab.getAttribute('aria-label')).toBe('Report actions');
    // Repeat + View report stay as buttons; the ⋮ joins them.
    expect(el.querySelector('.pf-lo-act--repeat')).not.toBeNull();
    expect(el.querySelector('.pf-lo-act--report')).not.toBeNull();
  });

  it('reception with view_order only: no share / WhatsApp, no full viewer — download, print, repeat', async () => {
    const { c } = await render({ perms: ['view_order'] });
    expect(ids(c)).toEqual(['download', 'print', 'repeat']);
  });

  it('no report on the order yet → no ⋮ at all', async () => {
    const { c, el } = await render({ withReport: false });
    expect(ids(c)).toEqual([]);
    expect(el.querySelector('pf-actions-menu')).toBeNull();
  });

  it('opening fetches the stored report once and warms its patient link', async () => {
    const { c, api } = await render();
    const svc = TestBed.inject(ReportActionsService);
    const pre = vi.spyOn(svc, 'prefetch').mockImplementation(() => {});
    c.onMenuOpened(c.openOrder());
    await new Promise(r => setTimeout(r, 0));
    expect(pre).toHaveBeenCalledWith({ id: 'rep-1', orderId: 'o1', qrToken: 'q1' });
    const share = vi.spyOn(svc, 'share').mockResolvedValue('shared');
    await c.runDetailAction(c.openOrder(), 'share');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1', orderId: 'o1' }), 'Priya Nair');
    expect(api.get.mock.calls.filter((a: unknown[]) => a[0] === '/api/reports/by-order/o1').length).toBe(1);
  });

  it('rows run the shared flows: WhatsApp gets the snapshot patient, download / print the stored report', async () => {
    const { c, router } = await render();
    const svc = TestBed.inject(ReportActionsService);
    const wa = vi.spyOn(svc, 'whatsApp').mockImplementation(() => {});
    const dl = vi.spyOn(svc, 'download').mockResolvedValue(true);
    const pr = vi.spyOn(svc, 'print').mockResolvedValue(true);
    const o = c.openOrder();
    await c.runDetailAction(o, 'whatsapp');
    expect(wa).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1' }), { name: 'Priya Nair', phone: '9876543210' });
    await c.runDetailAction(o, 'download');
    expect(dl).toHaveBeenCalled();
    await c.runDetailAction(o, 'print');
    expect(pr).toHaveBeenCalled();
    await c.runDetailAction(o, 'open-report');
    expect(router.navigate).toHaveBeenCalledWith(['/reports/view', 'rep-1']);
    await c.runDetailAction(o, 'repeat');
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'p1', fromOrderId: 'o1' } });
  });

  it('lab sends WhatsApp from its number: Send WhatsApp (server) + Share via my WhatsApp (wa.me)', async () => {
    const { c } = await render({ waCloud: true });
    expect(ids(c)).toEqual(['share', 'copy-link', 'whatsapp', 'whatsapp-mine', 'download', 'print', 'open-report', 'repeat']);
    const svc = TestBed.inject(ReportActionsService);
    const send = vi.spyOn(svc, 'sendWhatsApp').mockImplementation(() => {});
    const mine = vi.spyOn(svc, 'whatsApp').mockImplementation(() => {});
    const o = c.openOrder();
    await c.runDetailAction(o, 'whatsapp');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1' }), { name: 'Priya Nair', phone: '9876543210' });
    await c.runDetailAction(o, 'whatsapp-mine');
    expect(mine).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1' }), { name: 'Priya Nair', phone: '9876543210' });
  });

  it('WhatsApp goes to the CURRENT patient on file (profile correction), not the issued snapshot', async () => {
    const { c } = await render({ waCloud: true, rep: { ...REP, patient: { displayName: 'Priya Menon', phone: '9000000001' } } });
    const svc = TestBed.inject(ReportActionsService);
    const send = vi.spyOn(svc, 'sendWhatsApp').mockImplementation(() => {});
    await c.runDetailAction(c.openOrder(), 'whatsapp');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'rep-1' }), { name: 'Priya Menon', phone: '9000000001' });
  });
});

describe('Patient profile order detail — Send to colleague (Share to Messages)', () => {
  it('a secondary in the detail band opens the share sheet with THIS order as the card', async () => {
    const { el } = await render();
    const btn = el.querySelector('.pf-lo-act--chat') as HTMLButtonElement;
    expect(btn.className).toContain('pf-btn--secondary');
    btn.click();
    const sheet = TestBed.inject(ShareService).sheet()!;
    expect(sheet.target).toEqual({ type: 'order', id: 'o1' });
    expect(sheet.title).toBe('LAB-1');
    expect(el.querySelectorAll('.pf-btn--primary').length).toBe(0);
  });
  it('without the Messages module there is no Send to colleague', async () => {
    const { el } = await render({ messages: false });
    expect(el.querySelector('.pf-lo-act--chat')).toBeNull();
  });
});
