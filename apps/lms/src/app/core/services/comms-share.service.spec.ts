import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { ApiError } from '../../shared/models/api-response.model';
import { ApiService } from './api.service';
import { CommsShareService, looksLikeEmail } from './comms-share.service';
import { DeviceClassService } from './device-class.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { ToastService } from './toast.service';

/** Email + SMS Chat rules (owner 2026-11-13): email = platform switch + lab setting; SMS = platform switch + lab
 *  setting + a phone / tablet ONLY (never a computer); the toasts repeat the server's answer. */
function setup(o: { touch?: boolean; perms?: string[]; switches?: Record<string, boolean>; settings?: unknown; post?: () => unknown } = {}) {
  const toasts = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() };
  const api = {
    get: vi.fn((url: string) => url === '/api/settings/communication'
      ? (o.settings === 'error' ? throwError(() => new Error('403')) : of(o.settings ?? null)) : of(null)),
    post: vi.fn(() => (o.post ? o.post() : of({ sent: [], skipped: [] }))),
    put: vi.fn(() => of({})),
  };
  const perms = o.perms ?? ['deliver_report'];
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p), user: () => ({ tenantName: 'Demo Lab' }) } },
      { provide: DeviceClassService, useValue: { isTouch: () => o.touch ?? false } },
      { provide: TenantEntitlementsService, useValue: { ensureLoaded: vi.fn(async () => undefined), moduleEnabled: (k: string) => o.switches?.[k] ?? true } },
    ],
  });
  return { svc: TestBed.inject(CommsShareService), api, toasts };
}
afterEach(() => TestBed.resetTestingModule());

describe('CommsShareService — who sees Email / SMS', () => {
  it('Email: on by default for the delivery desk; off with the platform switch, the lab setting, or no deliver_report', () => {
    expect(setup().svc.emailOn()).toBe(true);
    TestBed.resetTestingModule();
    expect(setup({ switches: { emailShare: false } }).svc.emailOn()).toBe(false);
    TestBed.resetTestingModule();
    expect(setup({ perms: ['view_report'] }).svc.emailOn()).toBe(false);
    TestBed.resetTestingModule();
    const s = setup({ settings: { email: { enabled: false }, sms: { chat: true }, whatsapp: {} } });
    s.svc.ensure();
    expect(s.svc.emailOn()).toBe(false);
  });

  it('SMS: never on a computer (desktop / web desktop), even with every switch on', () => {
    expect(setup({ touch: false }).svc.smsOn()).toBe(false);
  });

  it('SMS: on a phone / tablet when the platform switch + the lab setting allow it', () => {
    expect(setup({ touch: true }).svc.smsOn()).toBe(true);
    TestBed.resetTestingModule();
    expect(setup({ touch: true, switches: { smsChat: false } }).svc.smsOn()).toBe(false);
    TestBed.resetTestingModule();
    const s = setup({ touch: true, settings: { email: { enabled: true }, sms: { chat: false }, whatsapp: {} } });
    s.svc.ensure();
    expect(s.svc.smsOn()).toBe(false);
    s.svc.apply({ sms: { chat: true } });   // the Communication page saved it on
    expect(s.svc.smsOn()).toBe(true);
  });

  it('the native shell counts as a phone even when the device class says desktop', () => {
    const w = window as unknown as { Capacitor?: unknown };
    w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    try {
      expect(setup({ touch: false }).svc.smsOn()).toBe(true);
    } finally { delete w.Capacitor; }
  });

  it('a settings read the user may not see keeps the platform switches deciding (fail-open, like WhatsApp)', () => {
    const s = setup({ touch: true, settings: 'error' });
    s.svc.ensure();
    expect(s.svc.emailOn()).toBe(true);
    expect(s.svc.smsOn()).toBe(true);
  });
});

describe('CommsShareService — email sends', () => {
  it('POSTs the report email with the pick and toasts exactly what the server said', async () => {
    const s = setup({ post: () => of({ sent: [{ kind: 'patient', address: 'a@x.in' }], skipped: [{ kind: 'doctor', reason: 'no_email' }] }) });
    await s.svc.emailReport('o1', 'doctor');
    expect(s.api.post).toHaveBeenCalledWith('/api/reports/by-order/o1/email', { to: 'doctor' });
    expect(s.toasts.success).toHaveBeenCalledWith('Report emailed to a@x.in', 5000);
    expect(s.toasts.warning).toHaveBeenCalledWith('Not emailed to the referral doctor: no email address on file', 7000);
    expect(s.svc.emailing()).toBeNull();
  });

  it('invoice → POST /api/billing/{id}/email {} (patient only)', async () => {
    const s = setup({ post: () => of({ sent: [{ kind: 'patient', address: 'a@x.in' }], skipped: [] }) });
    await s.svc.emailInvoice('b1');
    expect(s.api.post).toHaveBeenCalledWith('/api/billing/b1/email', {});
    expect(s.toasts.success).toHaveBeenCalledWith('Invoice emailed to a@x.in', 5000);
  });

  it('a server refusal is an error toast with its words — never a success', async () => {
    const s = setup({ post: () => throwError(() => new ApiError("Prefrontal email isn't set up on this server yet", 'not_configured')) });
    expect(await s.svc.emailReport('o1', 'both')).toBeNull();
    expect(s.toasts.error).toHaveBeenCalledWith("Prefrontal email isn't set up on this server yet", 7000);
    expect(s.toasts.success).not.toHaveBeenCalled();
  });

  it('one send at a time; nothing without deliver_report', async () => {
    const s = setup({ perms: [] });
    expect(await s.svc.emailReport('o1', 'patient')).toBeNull();
    expect(s.api.post).not.toHaveBeenCalled();
  });

  it('looksLikeEmail', () => {
    expect(looksLikeEmail('a@x.in')).toBe(true);
    for (const v of ['', null, 'a@x', 'a x@y.in', undefined]) expect(looksLikeEmail(v as never)).toBe(false);
  });
});

describe('CommsShareService — SMS opens the Messages app', () => {
  it('builds the platform\'s sms: link and opens it; an invalid number says so and opens nothing', () => {
    const s = setup({ touch: true });
    const opened: string[] = [];
    s.svc.opener = (u) => opened.push(u);
    s.svc.smsPlatformOverride = 'ios';
    expect(s.svc.openSms('9876543210', 'Hi there')).toBe(true);
    s.svc.smsPlatformOverride = 'android';
    expect(s.svc.openSms('9876543210', 'Hi there')).toBe(true);
    expect(opened).toEqual(['sms:+919876543210&body=Hi%20there', 'sms:+919876543210?body=Hi%20there']);
    expect(s.svc.openSms('123', 'x')).toBe(false);
    expect(s.toasts.warning).toHaveBeenCalledWith(expect.stringMatching(/no valid mobile number/));
    expect(opened).toHaveLength(2);
  });

  it('without a test opener it clicks a real sms: link (the native shells hand it to Messages)', () => {
    const s = setup({ touch: true });
    s.svc.smsPlatformOverride = 'android';
    const clicked: string[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.getAttribute('href')!); });
    try {
      s.svc.openSms('9876543210', 'x');
    } finally { spy.mockRestore(); }
    expect(clicked).toEqual(['sms:+919876543210?body=x']);
    expect(document.querySelector('a[href^="sms:"]')).toBeNull();   // removed again
  });
});
