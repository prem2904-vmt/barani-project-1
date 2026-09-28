import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { ApiError } from '../../shared/models/api-response.model';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { WaMessage, WaReportStatus, WhatsAppService } from './whatsapp.service';
import { WA_POLL_MS, WA_WATCH_MS, WhatsAppSendService, waSendLabel } from './whatsapp-send.service';

const MSG = (over: Partial<WaMessage> = {}): WaMessage => ({
  id: 'm1', reportId: 'rep-1', trigger: 'resend', kind: 'report_ready', status: 'sent', attempts: 1,
  to: '••••••••9229', toDisplay: '+91 ••••• 79229', createdAt: '2026-09-28T10:00:00Z', sentAt: '2026-09-28T10:00:01Z', ...over,
});
const STATUS = (latest: WaMessage): WaReportStatus => ({
  reportId: 'rep-1', patientId: 'p1', patientOptOut: false, autoSendEnabled: false, configured: true, canSend: true,
  latest, history: [latest],
});

describe('WhatsAppSendService (staff Send WhatsApp via the Cloud API)', () => {
  afterEach(() => { vi.useRealTimers(); TestBed.resetTestingModule(); });

  function make(opts: { perms?: string[]; canSend?: boolean; resend?: unknown; statuses?: WaMessage[] } = {}) {
    const perms = opts.perms ?? ['deliver_report'];
    const queue = [...(opts.statuses ?? [])];
    const wa = {
      settings: vi.fn(() => of({ canSend: opts.canSend ?? true })),
      resend: vi.fn(() => opts.resend ?? of(MSG())),
      reportStatus: vi.fn(() => of(STATUS(queue.length > 1 ? queue.shift()! : queue[0] ?? MSG()))),
    };
    const api = { post: vi.fn(() => of({})) };
    const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WhatsAppService, useValue: wa },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toasts },
        { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
      ],
    });
    return { svc: TestBed.inject(WhatsAppSendService), wa, api, toasts };
  }

  it('cloud() comes from GET /api/whatsapp/settings canSend, fetched once, delivery desk only', () => {
    const { svc, wa } = make();
    expect(svc.cloud()).toBe(false);
    svc.ensure();
    svc.ensure();
    expect(wa.settings).toHaveBeenCalledTimes(1);
    expect(svc.cloud()).toBe(true);
    expect(svc.canSend({ type: 'final' })).toBe(true);
    // A preliminary report never goes through the server send.
    expect(svc.canSend({ type: 'partial' })).toBe(false);
  });

  it('a lab without a sender (canSend false) keeps the wa.me flow', () => {
    const { svc } = make({ canSend: false });
    svc.ensure();
    expect(svc.cloud()).toBe(false);
    expect(svc.canSend({ type: 'final' })).toBe(false);
  });

  it('without deliver_report nothing is fetched or sent', async () => {
    const { svc, wa } = make({ perms: ['view_report'] });
    svc.ensure();
    expect(wa.settings).not.toHaveBeenCalled();
    expect(await svc.send('rep-1')).toBeNull();
    expect(wa.resend).not.toHaveBeenCalled();
  });

  it('send: Sending… → Sent with the masked number, records the delivery', async () => {
    const { svc, wa, api, toasts } = make();
    const p = svc.send('rep-1');
    expect(svc.state('rep-1')?.phase).toBe('sending');
    expect(svc.busy('rep-1')).toBe(true);
    const m = await p;
    expect(wa.resend).toHaveBeenCalledWith('rep-1');
    expect(m?.status).toBe('sent');
    expect(svc.state('rep-1')).toMatchObject({ phase: 'sent', to: '+91 ••••• 79229' });
    expect(toasts.success).toHaveBeenCalledWith('Sent on WhatsApp to +91 ••••• 79229', 5000);
    expect(api.post).toHaveBeenCalledWith('/api/reports/rep-1/deliver', { via: 'whatsapp', note: 'WhatsApp Cloud API' });
    svc['stopWatch']('rep-1');
  });

  it('watches the message: Delivered then Read as the webhook updates it', async () => {
    vi.useFakeTimers();
    const { svc, wa } = make({ statuses: [MSG({ status: 'delivered' }), MSG({ status: 'read' })] });
    await svc.send('rep-1');
    await vi.advanceTimersByTimeAsync(WA_POLL_MS);
    expect(svc.state('rep-1')?.phase).toBe('delivered');
    await vi.advanceTimersByTimeAsync(WA_POLL_MS);
    expect(svc.state('rep-1')?.phase).toBe('read');
    const calls = wa.reportStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(WA_POLL_MS * 3);
    // Read is final — polling stopped.
    expect(wa.reportStatus.mock.calls.length).toBe(calls);
  });

  it('stops watching after ~30 s when no webhook status arrives', async () => {
    vi.useFakeTimers();
    const { svc, wa } = make({ statuses: [MSG({ status: 'sent' })] });
    await svc.send('rep-1');
    await vi.advanceTimersByTimeAsync(WA_WATCH_MS + WA_POLL_MS * 2);
    const calls = wa.reportStatus.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(Math.ceil(WA_WATCH_MS / WA_POLL_MS) + 1);
    await vi.advanceTimersByTimeAsync(WA_POLL_MS * 5);
    expect(wa.reportStatus.mock.calls.length).toBe(calls);
    expect(svc.state('rep-1')?.phase).toBe('sent');
  });

  it('a Meta failure shows its reason and records no delivery', async () => {
    const reason = 'Message undeliverable — the number may not be on WhatsApp.';
    const { svc, api, toasts } = make({ resend: of(MSG({ status: 'failed', errorCode: 131026, errorReason: reason })) });
    await svc.send('rep-1');
    expect(svc.state('rep-1')).toMatchObject({ phase: 'failed', reason });
    expect(toasts.error).toHaveBeenCalledWith(reason, 8000);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opted-out / no-phone refusals are a clear toast, nothing recorded', async () => {
    for (const [code, msg] of [
      ['opted_out', 'This patient opted out of WhatsApp messages.'],
      ['no_phone', 'No valid mobile number on the patient record.'],
    ]) {
      TestBed.resetTestingModule();
      const { svc, api, toasts } = make({ resend: throwError(() => new ApiError(msg, code)) });
      expect(await svc.send('rep-1')).toBeNull();
      expect(toasts.error).toHaveBeenCalledWith(msg, 6000);
      expect(svc.state('rep-1')).toBeNull();
      expect(api.post).not.toHaveBeenCalled();
    }
  });

  it('not_configured flips the lab back to the wa.me flow', async () => {
    const { svc } = make({ resend: throwError(() => new ApiError('WhatsApp sending is not set up for this lab yet.', 'not_configured')) });
    svc.ensure();
    expect(svc.cloud()).toBe(true);
    await svc.send('rep-1');
    expect(svc.cloud()).toBe(false);
  });

  it('labels', () => {
    expect(waSendLabel('sending')).toBe('Sending…');
    expect(waSendLabel('sent')).toBe('Sent');
    expect(waSendLabel('delivered')).toBe('Delivered');
    expect(waSendLabel('read')).toBe('Read');
    expect(waSendLabel(null)).toBe('');
  });
});
