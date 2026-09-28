import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ApiService } from './api.service';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { ReportActionsService } from './report-actions.service';

/** The ⋮ menu's shared report actions: the patient link (tracking token,
 *  falling back to the report's own public link), share / copy per platform,
 *  and the delivery-record rules for print / WhatsApp. */
const BASE = (environment.reportPublicBaseUrl ?? '').replace(/\/+$/, '');

function setup(o: { perms?: string[]; trackFails?: boolean; clip?: 'ok' | 'fail'; webShare?: boolean } = {}) {
  const perms = o.perms ?? ['view_order', 'deliver_report'];
  const api = {
    get: vi.fn((url: string) => url.endsWith('/track-token')
      ? (o.trackFails ? throwError(() => new Error('403')) : of({ token: 'trk 1' }))
      : of(null)),
    post: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const dialog = { prompt: vi.fn(async () => null), confirm: vi.fn(async () => true), choose: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: {
        user: () => ({ tenantName: 'Micro World' }),
        hasPermission: (p: string) => perms.includes(p),
        hasAnyPermission: (ps: string[]) => ps.some(p => perms.includes(p)),
      } },
    ],
  });
  const svc = TestBed.inject(ReportActionsService);
  const writeText = vi.fn(async () => { if (o.clip === 'fail') throw new Error('denied'); });
  const share = vi.fn(async () => {});
  svc.shareEnv = { capacitor: null, navigator: { share: o.webShare ? share : undefined, clipboard: { writeText } } as never, document: null };
  return { svc, api, toasts, dialog, writeText, share };
}
afterEach(() => TestBed.resetTestingModule());

describe('ReportActionsService — patient link', () => {
  it('uses the order tracking page /track/{token} (never expires) when the user may mint it', async () => {
    const { svc, api } = setup();
    expect(await svc.patientLink({ id: 'r1', orderId: 'o1', qrToken: 'q1' })).toBe(`${BASE}/track/trk%201`);
    expect(api.get).toHaveBeenCalledWith('/api/orders/o1/track-token');
  });

  it('without the track-token permission it falls back to the report link /reports/public/{qrToken}', async () => {
    const { svc, api } = setup({ perms: ['deliver_report'] });
    expect(await svc.patientLink({ id: 'r1', orderId: 'o1', qrToken: 'q1' })).toBe(`${BASE}/reports/public/q1`);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('a failing track-token call also falls back to the report link', async () => {
    const { svc } = setup({ trackFails: true });
    expect(await svc.patientLink({ id: 'r1', orderId: 'o1', qrToken: 'q1' })).toBe(`${BASE}/reports/public/q1`);
  });

  it('canLink: delivery desk only (deliver_report), with a track-token permission + order or a report token', () => {
    expect(setup().svc.canLink({ id: 'r', orderId: 'o' })).toBe(true);
    TestBed.resetTestingModule();
    expect(setup({ perms: ['deliver_report'] }).svc.canLink({ id: 'r', orderId: 'o' })).toBe(false);
    TestBed.resetTestingModule();
    expect(setup({ perms: ['deliver_report'] }).svc.canLink({ id: 'r', qrToken: 'q' })).toBe(true);
    TestBed.resetTestingModule();
    // view-only readers / validators never hand the patient link out
    expect(setup({ perms: ['view_report', 'view_order', 'validate_result'] }).svc.canLink({ id: 'r', orderId: 'o', qrToken: 'q' })).toBe(false);
  });

  it('prefetch on menu-open caches the link: one API call for open + tap', async () => {
    const { svc, api } = setup();
    svc.prefetch({ id: 'r1', orderId: 'o1' });
    await svc.copyLink({ id: 'r1', orderId: 'o1' });
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe('ReportActionsService — share / copy', () => {
  it('Share… opens the Web Share sheet with the link when the device has one', async () => {
    const { svc, share, writeText } = setup({ webShare: true });
    expect(await svc.share({ id: 'r1', orderId: 'o1' }, 'Priya Nair')).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${BASE}/track/trk%201`, text: expect.stringContaining('Priya Nair') }));
    expect(writeText).not.toHaveBeenCalled();
    expect(svc.shareHint()).toMatch(/share sheet/i);
  });

  it('Share… copies the link (and says so) where there is no share sheet', async () => {
    const { svc, toasts, writeText } = setup();
    expect(await svc.share({ id: 'r1', orderId: 'o1' })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(`${BASE}/track/trk%201`);
    expect(toasts.success).toHaveBeenCalledWith('Patient report link copied');
    expect(svc.shareHint()).toMatch(/copies/i);
  });

  it('clipboard blocked: shows the link in a DialogService prompt (never window.prompt/alert)', async () => {
    const { svc, dialog } = setup({ clip: 'fail' });
    expect(await svc.copyLink({ id: 'r1', orderId: 'o1' })).toBe('failed');
    expect(dialog.prompt).toHaveBeenCalledWith(expect.objectContaining({ initialValue: `${BASE}/track/trk%201` }));
  });

  it('no link at all → an error toast, nothing shared', async () => {
    const { svc, toasts, share } = setup({ perms: ['deliver_report'], webShare: true });
    expect(await svc.share({ id: 'r1', orderId: 'o1' })).toBe('failed');
    expect(share).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });
});

describe('ReportActionsService — WhatsApp', () => {
  it('needs deliver_report; opens wa.me with the report link and records the delivery', () => {
    const { svc, api } = setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    svc.whatsApp({ id: 'r1', orderId: 'o1' }, { name: 'Priya', phone: '9876543210' });
    expect(open).toHaveBeenCalledWith(expect.stringContaining('wa.me'), '_blank', 'noopener');
    expect(api.post).toHaveBeenCalledWith('/api/reports/r1/deliver', { via: 'whatsapp', note: 'wa.me link' });
    open.mockRestore();
  });

  it('without deliver_report it does nothing', () => {
    const { svc, api } = setup({ perms: ['view_report'] });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    svc.whatsApp({ id: 'r1' }, { name: 'Priya', phone: '9876543210' });
    expect(open).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
