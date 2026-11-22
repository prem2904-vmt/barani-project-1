import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ApiService } from './api.service';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { ReportActionsService } from './report-actions.service';
import { WhatsAppManualService } from './whatsapp-manual.service';

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
  // WhatsApp flows archive the PDF in the background (`void this.archive()` →
  // a lazy import of report-blob). Left real, that import can land after this
  // file's environment is torn down and fails the WHOLE unit run with
  // EnvironmentTeardownError (blocked the dev release 2026-11-22). The archive
  // is best-effort and covered by report-blob.spec; stub it here.
  vi.spyOn(svc as unknown as { archive: () => Promise<void> }, 'archive').mockResolvedValue(undefined);
  const writeText = vi.fn(async () => { if (o.clip === 'fail') throw new Error('denied'); });
  const share = vi.fn(async () => {});
  svc.shareEnv = { capacitor: null, navigator: { share: o.webShare ? share : undefined, clipboard: { writeText } } as never, document: null };
  // WhatsApp Chat (manual) on a desktop browser: the named popup.
  const manual = TestBed.inject(WhatsAppManualService);
  const open = vi.fn(() => ({ opener: null, focus: vi.fn() }));
  manual.win = { open, screen: { availWidth: 1440, availHeight: 900 }, navigator: { userAgent: 'Macintosh' } } as never;
  manual.bridge = () => null;
  return { svc, api, toasts, dialog, writeText, share, open };
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

describe('ReportActionsService — WhatsApp Chat (manual, every lab)', () => {
  it('needs deliver_report; one click (no confirm), opens the WhatsApp window with the report link and records the delivery', async () => {
    const { svc, api, open, dialog } = setup();
    expect(await svc.whatsApp({ id: 'r1', orderId: 'o1', qrToken: 'q1' }, { name: 'Priya', phone: '9876543210' })).toBe(true);
    expect(dialog.confirm).not.toHaveBeenCalled();
    const [url, name] = open.mock.calls[0] as unknown as [string, string];
    expect(name).toBe('pf-whatsapp');
    expect(url.startsWith('https://web.whatsapp.com/send?phone=919876543210&text=')).toBe(true);
    expect(new URL(url).searchParams.get('text')).toBe(`Dear Priya, your report from Micro World is ready. View it here: ${BASE}/reports/public/q1`);
    expect(api.post).toHaveBeenCalledWith('/api/reports/r1/deliver', { via: 'whatsapp', note: 'WhatsApp opened (manual)' });
  });

  it('referral doctor picked: opens the DOCTOR\'s chat with the doctor message; no patient delivery record', async () => {
    const { svc, api, open } = setup();
    expect(await svc.whatsApp({ id: 'r1', orderId: 'o1', qrToken: 'q1' }, { name: 'Priya', phone: '9876543210' },
      { to: 'doctor', doctor: { name: 'Dr. Ravi', phone: '9845012345' } })).toBe(true);
    const [url, name] = open.mock.calls[0] as unknown as [string, string];
    expect(name).toBe('pf-whatsapp');
    expect(url.startsWith('https://web.whatsapp.com/send?phone=919845012345&text=')).toBe(true);
    expect(new URL(url).searchParams.get('text')).toBe(`Dear Dr. Ravi, the report of Priya from Micro World is ready. View it here: ${BASE}/reports/public/q1`);
    expect(api.post).not.toHaveBeenCalledWith('/api/reports/r1/deliver', expect.anything());
  });

  it('"Send to patient" with a doctor on the order: the patient\'s chat + the delivery record', async () => {
    const { svc, api, open } = setup();
    await svc.whatsApp({ id: 'r1', orderId: 'o1', qrToken: 'q1' }, { name: 'Priya', phone: '9876543210' },
      { to: 'patient', doctor: { name: 'Dr. Ravi', phone: '9845012345' } });
    expect(String((open.mock.calls[0] as unknown as [string])[0])).toContain('phone=919876543210');
    expect(api.post).toHaveBeenCalledWith('/api/reports/r1/deliver', { via: 'whatsapp', note: 'WhatsApp opened (manual)' });
  });

  it('opted-out patient, cancelled at the opt-out dialog: nothing opens, nothing recorded', async () => {
    const { svc, api, open, dialog } = setup();
    api.get.mockImplementation((url: string) => of(url.includes('/api/whatsapp/reports/r1') ? { patientOptOut: true } : null) as never);
    dialog.confirm.mockResolvedValueOnce(false);
    expect(await svc.whatsApp({ id: 'r1' }, { name: 'Priya', phone: '9876543210' })).toBe(false);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'This patient opted out of WhatsApp' }));
    expect(open).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalledWith('/api/reports/r1/deliver', expect.anything());
  });

  it('without deliver_report it does nothing', async () => {
    const { svc, api, open } = setup({ perms: ['view_report'] });
    await svc.whatsApp({ id: 'r1' }, { name: 'Priya', phone: '9876543210' });
    expect(open).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('ReportActionsService — WhatsApp Cloud API (lab sends from its number)', () => {
  function cloud(canSend = true, platform: Record<string, boolean> = {}) {
    const ctx = setup();
    ctx.api.get.mockImplementation(((url: string) => url === '/api/whatsapp/settings' ? of({ canSend })
      : url === '/api/tenants/module-config' ? of(platform) : of(null)) as never);
    ctx.api.post.mockImplementation(((url: string) => url.endsWith('/resend')
      ? of({ id: 'm1', reportId: 'r1', trigger: 'resend', kind: 'report_ready', status: 'sent', attempts: 1, toDisplay: '+91 ••••• 43210', createdAt: '' })
      : of({})) as never);
    return ctx;
  }

  it('no sender (or before the flag is known): ONE row, WhatsApp Chat', () => {
    const { svc } = cloud(false);
    expect(svc.whatsAppActions({ id: 'r1', type: 'final' }).map(a => a.id)).toEqual(['whatsapp-mine']);
    svc.warmWhatsApp();
    const rows = svc.whatsAppActions({ id: 'r1', type: 'final' });
    expect(rows.map(a => a.label)).toEqual(['WhatsApp Chat']);
    expect(rows[0].hint).toBe('Opens WhatsApp with the report ready; you press Send');
  });

  it('with a sender: ONE row, WhatsApp Auto — final reports only (a preliminary report is WhatsApp Chat)', () => {
    const { svc } = cloud();
    svc.warmWhatsApp();
    const rows = svc.whatsAppActions({ id: 'r1', type: 'final' });
    expect(rows.map(a => [a.id, a.label])).toEqual([['whatsapp', 'WhatsApp Auto']]);
    expect(svc.whatsAppActions({ id: 'r1', type: 'partial' }).map(a => [a.id, a.label])).toEqual([['whatsapp-mine', 'WhatsApp Chat']]);
  });

  it('Prefrontal switched WhatsApp Auto off: the lab with a sender gets WhatsApp Chat instead', () => {
    const { svc } = cloud(true, { whatsappAuto: false, whatsappChat: true });
    svc.warmWhatsApp();
    expect(svc.whatsAppActions({ id: 'r1', type: 'final' }).map(a => [a.id, a.label])).toEqual([['whatsapp-mine', 'WhatsApp Chat']]);
  });

  it('WhatsApp Chat switched off (no Auto): no WhatsApp row, and the manual flow refuses', async () => {
    const { svc, api, open } = cloud(false, { whatsappAuto: true, whatsappChat: false });
    svc.warmWhatsApp();
    expect(svc.whatsAppActions({ id: 'r1', type: 'final' })).toEqual([]);
    expect(await svc.whatsApp({ id: 'r1' }, { name: 'Priya', phone: '9876543210' })).toBe(false);
    svc.sendWhatsApp({ id: 'r1', orderId: 'o1', type: 'final' }, { name: 'Priya', phone: '9876543210' });
    await new Promise(r => setTimeout(r, 0));
    expect(open).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('both switches ABSENT (an older server / a lab with an old config row): both modes stay on', () => {
    const { svc } = cloud(true, { inventory: true } as never);
    svc.warmWhatsApp();
    expect(svc.whatsAppActions({ id: 'r1', type: 'final' }).map(a => a.label)).toEqual(['WhatsApp Auto']);
    expect(svc.whatsAppActions({ id: 'r1', type: 'partial' }).map(a => a.label)).toEqual(['WhatsApp Chat']);
  });

  it('sendWhatsApp posts the server send (no wa.me window) when the lab has a sender', async () => {
    const { svc, api, toasts } = cloud();
    svc.warmWhatsApp();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    svc.sendWhatsApp({ id: 'r1', orderId: 'o1', type: 'final' }, { name: 'Priya', phone: '9876543210' });
    await new Promise(r => setTimeout(r, 0));
    expect(api.post).toHaveBeenCalledWith('/api/whatsapp/reports/r1/resend', {});
    expect(open).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith('Sent by WhatsApp Auto to +91 ••••• 43210', 5000);
    open.mockRestore();
  });

  it('sendWhatsApp falls back to WhatsApp Chat when the lab has no sender', async () => {
    const { svc, api, open } = cloud(false);
    svc.warmWhatsApp();
    svc.sendWhatsApp({ id: 'r1', orderId: 'o1', type: 'final' }, { name: 'Priya', phone: '9876543210' });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://web.whatsapp.com/send?phone=919876543210'), 'pf-whatsapp');
    expect(api.post).not.toHaveBeenCalledWith('/api/whatsapp/reports/r1/resend', {});
  });
});
