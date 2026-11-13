import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/**
 * Front desk Share menu: Email + SMS next to WhatsApp (2026-11-13). Rules per channel / device / doctor:
 * - Email when email sharing is on and the patient or the referral doctor has an email;
 * - SMS only on a phone / tablet (CommsShareService.smsOn) with a valid mobile; the doctor row only with
 *   the doctor's own number;
 * - the Share button shows when ANY channel can share.
 */
const proto = FrontdeskLandingComponent.prototype as any;
const REPORT = { id: 'r1', orderId: 'o1', type: 'final', qrToken: 'tok', patient: { displayName: 'Asha Rao', phone: '+919876543210' } };

function harness(o: { wa?: 'auto' | 'chat' | null; email?: boolean; sms?: boolean } = {}) {
  const h = Object.create(proto);
  const comms = {
    emailOn: () => o.email ?? true, invoiceEmailOn: () => o.email ?? true, smsOn: () => o.sms ?? false,
    emailReport: vi.fn(async () => null), emailInvoice: vi.fn(async () => null), emailing: signal<string | null>(null),
  };
  const sendSms = vi.fn(async () => true);
  Object.assign(h, {
    comms, toasts: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
    api: { get: vi.fn(() => of(REPORT)) },
    waSend: { mode: vi.fn(() => ('wa' in o ? o.wa : null)) },
    reportActions: { sendSms },
    _smsSharing: signal<string | null>(null),
    invoiceCtx: null,
  });
  return { h, comms, sendSms };
}
const order = (extra: Record<string, unknown> = {}) => ({ id: 'o1', patient: { displayName: 'Asha Rao', phone: '+919876543210', email: 'asha@x.in' }, ...extra });

describe('Front desk Share — Email / SMS rows', () => {
  it('Email: patient only, doctor only, both, or none', () => {
    const { h } = harness();
    expect(h.emailFor(order())).toEqual({ patient: true, doctor: false });
    expect(h.emailFor(order({ refDoctorName: 'Dr. Ravi', refDoctorEmail: 'ravi@y.in' }))).toEqual({ patient: true, doctor: true });
    expect(h.emailFor(order({ patient: { phone: '9876543210', email: '' }, refDoctorName: 'Dr. Ravi', refDoctorEmail: 'ravi@y.in' }))).toEqual({ patient: false, doctor: true });
    expect(h.emailFor(order({ patient: { phone: '9876543210', email: null } }))).toBeNull();
    // A doctor email without a referral doctor on the order is ignored.
    expect(h.emailFor(order({ patient: { email: null }, refDoctorEmail: 'x@y.in' }))).toBeNull();
  });

  it('Email off (platform / lab) → no Email rows', () => {
    expect(harness({ email: false }).h.emailFor(order())).toBeNull();
  });

  it('SMS: never on a computer; on a phone: patient + doctor (own number only)', () => {
    expect(harness({ sms: false }).h.smsFor(order())).toBeNull();
    const { h } = harness({ sms: true });
    expect(h.smsFor(order())).toEqual({ patient: true, doctor: false });
    expect(h.smsFor(order({ refDoctorName: 'Dr. Ravi', refDoctorPhone: '+919845012345' }))).toEqual({ patient: true, doctor: true });
    // The doctor "number" is the patient's own → no doctor row.
    expect(h.smsFor(order({ refDoctorName: 'Dr. Ravi', refDoctorPhone: '9876543210' }))).toEqual({ patient: true, doctor: false });
    expect(h.smsFor(order({ patient: { phone: '' } }))).toBeNull();
  });

  it('the Share button shows when ANY channel can share (not only WhatsApp)', () => {
    expect(harness({ wa: null, email: false, sms: false }).h.shareAvailable(order())).toBe(false);
    expect(harness({ wa: 'chat', email: false }).h.shareAvailable(order())).toBe(true);
    expect(harness({ wa: null, email: true }).h.shareAvailable(order())).toBe(true);
    expect(harness({ wa: null, email: true }).h.shareAvailable(order({ patient: { phone: '' } }))).toBe(false);
    expect(harness({ wa: null, email: false, sms: true }).h.shareAvailable(order())).toBe(true);
  });

  it('Email rows call the server path with the pick (the toast comes from the server answer)', async () => {
    const { h, comms } = harness();
    await h.emailReport(order({ refDoctorName: 'Dr. Ravi', refDoctorEmail: 'ravi@y.in' }), 'both');
    expect(comms.emailReport).toHaveBeenCalledWith('o1', 'both');
    expect(h.toasts.success).not.toHaveBeenCalled();
  });

  it('SMS rows fetch the report then open Messages through ReportActionsService (doctor contact passed)', async () => {
    const { h, sendSms } = harness({ sms: true });
    await h.smsReport(order({ refDoctorName: 'Dr. Ravi', refDoctorPhone: '+919845012345' }), 'doctor');
    expect(h.api.get).toHaveBeenCalledWith('/api/reports/by-order/o1');
    expect(sendSms).toHaveBeenCalledWith(REPORT, { name: 'Asha Rao', phone: '+919876543210' }, { to: 'doctor', doctor: { name: 'Dr. Ravi', phone: '+919845012345' } });
    expect(h._smsSharing()).toBeNull();
  });

  it('invoice viewer Email: only with a patient email (never the doctor); POSTs the bill', async () => {
    const { h, comms } = harness();
    expect(h.invoiceEmailOn()).toBe(false);
    h.invoiceCtx = { order: order({ refDoctorEmail: 'ravi@y.in' }), bill: { id: 'b1' } };
    expect(h.invoiceEmailOn()).toBe(true);
    await h.emailInvoice();
    expect(comms.emailInvoice).toHaveBeenCalledWith('b1', null, undefined);   // no rendered PDF in this harness
    h.invoiceCtx = { order: order({ patient: { email: null }, refDoctorEmail: 'ravi@y.in' }), bill: { id: 'b1' } };
    expect(h.invoiceEmailOn()).toBe(false);
  });
});
