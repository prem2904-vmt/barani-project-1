import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ApiService } from './api.service';
import { CommsShareService } from './comms-share.service';
import { DeviceClassService } from './device-class.service';
import { DialogService } from './dialog.service';
import { ReportActionsService } from './report-actions.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { ToastService } from './toast.service';

/** ⋮ Email + SMS rows (report viewer, results queue, patient profile) — one rule set in ReportActionsService. */
const BASE = (environment.reportPublicBaseUrl ?? '').replace(/\/+$/, '');
const REP = { id: 'r1', orderId: 'o1', qrToken: 'tok1', type: 'final' };

function setup(o: { touch?: boolean; perms?: string[]; doctor?: { name: string; phone: string } | null; pick?: string | null; switches?: Record<string, boolean> } = {}) {
  const perms = o.perms ?? ['deliver_report', 'view_order'];
  const api = {
    get: vi.fn((url: string) => url.startsWith('/api/whatsapp/reports/')
      ? of({ reportId: 'r1', patientOptOut: false, referralDoctor: o.doctor ?? null }) : of(null)),
    post: vi.fn((url: string) => url.endsWith('/email') ? of({ sent: [{ kind: 'patient', address: 'a@x.in' }], skipped: [] }) : of({})),
    put: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const dialog = { prompt: vi.fn(async () => null), confirm: vi.fn(async () => true), actions: vi.fn(async () => ({ action: o.pick ?? null, checked: false })) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: DeviceClassService, useValue: { isTouch: () => o.touch ?? false } },
      { provide: TenantEntitlementsService, useValue: { ensureLoaded: vi.fn(async () => undefined), moduleEnabled: (k: string) => o.switches?.[k] ?? true } },
      { provide: AuthService, useValue: {
        user: () => ({ tenantName: 'Demo Lab' }),
        hasPermission: (p: string) => perms.includes(p),
        hasAnyPermission: (ps: string[]) => ps.some(p => perms.includes(p)),
      } },
    ],
  });
  const svc = TestBed.inject(ReportActionsService);
  const comms = TestBed.inject(CommsShareService);
  const opened: string[] = [];
  comms.opener = (u) => opened.push(u);
  comms.smsPlatformOverride = 'android';
  return { svc, comms, api, toasts, dialog, opened };
}
afterEach(() => TestBed.resetTestingModule());
const ids = (a: { id: string }[]) => a.map(x => x.id);

describe('ReportActionsService — ⋮ Email / SMS rows', () => {
  it('desktop: Email (final report, email share on), never SMS', () => {
    const { svc } = setup({ touch: false });
    expect(ids(svc.channelActions(REP, { patientPhone: '9876543210' }))).toEqual(['email']);
  });

  it('phone / tablet: Email + SMS', () => {
    const { svc } = setup({ touch: true });
    const a = svc.channelActions(REP, { patientPhone: '9876543210' });
    expect(ids(a)).toEqual(['email', 'sms']);
    expect(a.map(x => x.icon)).toEqual(['mail', 'sms']);
  });

  it('no Email on a preliminary report, without an order, or when everyone is known to have no email', () => {
    const { svc } = setup({ touch: false });
    expect(svc.channelActions({ ...REP, type: 'partial' })).toEqual([]);
    expect(svc.channelActions({ ...REP, orderId: null })).toEqual([]);
    expect(svc.channelActions(REP, { patientEmail: null, doctorEmail: '' })).toEqual([]);
    expect(ids(svc.channelActions(REP, { patientEmail: null }))).toEqual(['email']);   // the doctor is unknown here: the server decides
    expect(ids(svc.channelActions(REP, { patientEmail: null, doctorEmail: 'd@y.in' }))).toEqual(['email']);
  });

  it('no SMS without a patient phone; nothing for view-only readers; the platform switches hide each row', () => {
    expect(ids(setup({ touch: true }).svc.channelActions(REP, { patientPhone: null }))).toEqual(['email']);
    TestBed.resetTestingModule();
    expect(setup({ touch: true, perms: ['view_report'] }).svc.channelActions(REP)).toEqual([]);
    TestBed.resetTestingModule();
    expect(ids(setup({ touch: true, switches: { emailShare: false } }).svc.channelActions(REP))).toEqual(['sms']);
    TestBed.resetTestingModule();
    expect(ids(setup({ touch: true, switches: { smsChat: false } }).svc.channelActions(REP))).toEqual(['email']);
  });
});

describe('ReportActionsService — Email send', () => {
  it('unknown emails → the server decides ("both"); no question asked', async () => {
    const { svc, api, dialog, toasts } = setup();
    expect(svc.runChannel('email', REP, { name: 'Asha', phone: '9876543210' })).toBe(true);
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/reports/by-order/o1/email', { to: 'both' }));
    expect(dialog.actions).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith('Report emailed to a@x.in', 5000);
  });

  it('both emails known → "Send to both / patient / doctor" (both first); the pick is sent; cancel sends nothing', async () => {
    const a = setup({ pick: 'doctor' });
    await a.svc.sendEmail(REP, { patientEmail: 'a@x.in', doctorEmail: 'd@y.in', doctorName: 'Dr. Ravi' });
    expect((a.dialog.actions.mock.calls as any)[0][0].actions.map((x: { value: string }) => x.value)).toEqual(['both', 'patient', 'doctor']);
    expect((a.dialog.actions.mock.calls as any)[0][0].message).toContain('Dr. Ravi: d@y.in');
    expect(a.api.post).toHaveBeenCalledWith('/api/reports/by-order/o1/email', { to: 'doctor' });
    TestBed.resetTestingModule();
    const b = setup({ pick: null });
    await b.svc.sendEmail(REP, { patientEmail: 'a@x.in', doctorEmail: 'd@y.in' });
    expect(b.api.post).not.toHaveBeenCalledWith('/api/reports/by-order/o1/email', expect.anything());
  });

  it('only one side has an email → straight to that side', async () => {
    const a = setup();
    await a.svc.sendEmail(REP, { patientEmail: 'a@x.in', doctorEmail: null });
    expect(a.api.post).toHaveBeenCalledWith('/api/reports/by-order/o1/email', { to: 'patient' });
    await a.svc.sendEmail(REP, { patientEmail: null, doctorEmail: 'd@y.in' });
    expect(a.api.post).toHaveBeenCalledWith('/api/reports/by-order/o1/email', { to: 'doctor' });
  });
});

describe('ReportActionsService — SMS Chat', () => {
  it('opens Messages with the report-ready line + the report link WhatsApp uses; records the patient hand-over', async () => {
    const { svc, opened, api } = setup({ touch: true });
    expect(await svc.sendSms(REP, { name: 'Asha Rao', phone: '9876543210' })).toBe(true);
    expect(opened).toHaveLength(1);
    const body = decodeURIComponent(opened[0].split('?body=')[1]);
    expect(opened[0].startsWith('sms:+919876543210?body=')).toBe(true);
    expect(body).toBe(`Dear Asha Rao, your report from Demo Lab is ready. View it here: ${BASE}/reports/public/tok1`);
    expect(api.post).toHaveBeenCalledWith('/api/reports/r1/deliver', { via: 'sms', note: 'SMS opened (manual)' });
  });

  it('a referral doctor with their own number → "Send to patient / Send to doctor"; the doctor gets the doctor message, no delivery record', async () => {
    const { svc, opened, dialog, api } = setup({ touch: true, doctor: { name: 'Dr. Ravi Kumar', phone: '9845012345' }, pick: 'doctor' });
    expect(await svc.sendSms(REP, { name: 'Asha Rao', phone: '9876543210' })).toBe(true);
    expect((dialog.actions.mock.calls as any)[0][0].actions.map((x: { value: string }) => x.value)).toEqual(['patient', 'doctor']);
    expect(opened[0].startsWith('sms:+919845012345?body=')).toBe(true);
    expect(decodeURIComponent(opened[0].split('?body=')[1])).toContain('Dear Dr. Ravi Kumar, the report of Asha Rao from Demo Lab is ready.');
    expect(api.post).not.toHaveBeenCalledWith('/api/reports/r1/deliver', expect.anything());
  });

  it('iOS uses &body=', async () => {
    const { svc, comms, opened } = setup({ touch: true });
    comms.smsPlatformOverride = 'ios';
    await svc.sendSms(REP, { name: 'Asha', phone: '9876543210' }, { to: 'patient', doctor: null });
    expect(opened[0].startsWith('sms:+919876543210&body=')).toBe(true);
  });

  it('never on a computer, even when called', async () => {
    const { svc, opened } = setup({ touch: false });
    expect(await svc.sendSms(REP, { name: 'Asha', phone: '9876543210' })).toBe(false);
    expect(opened).toEqual([]);
  });
});
