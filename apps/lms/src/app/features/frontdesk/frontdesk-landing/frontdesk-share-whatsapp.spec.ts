import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import { ApiError } from '../../../shared/models/api-response.model';

/**
 * Row Share → WhatsApp shares the REPORT for real (OPS-1113): WhatsApp Auto sends from the server,
 * WhatsApp Chat opens WhatsApp with the PDF drafted. No fake "sent" toast, no phone / no report refusals.
 * The sending itself (Auto success/failure toasts, Chat desktop/web/phone) is ReportActionsService +
 * WhatsAppSendService + WhatsAppManualService, covered by their own specs; here the screen's contract.
 */
const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const ts = readFileSync(`${DIR}/frontdesk-landing.component.ts`, 'utf8');
const proto = FrontdeskLandingComponent.prototype as any;

const ORDER = { id: 'o1', patient: { displayName: 'Asha Rao', phone: '+919876543210' } };
const REPORT = { id: 'r1', orderId: 'o1', type: 'final', status: 'generated', qrToken: 'tok', patient: { displayName: 'Asha Rao', phone: '+919811122233' } };

function harness(o: { mode?: 'auto' | 'chat' | null; report?: unknown; getErr?: boolean | 'not_found' } = {}) {
  const h = Object.create(proto);
  const toasts = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() };
  const calls: string[] = [];
  const sendWhatsApp = vi.fn(async (..._a: any[]) => { calls.push('send'); });
  const get = vi.fn(() => {
    calls.push('get');
    if (o.getErr === 'not_found') return throwError(() => new ApiError('No report for this order', 'not_found'));
    return o.getErr ? throwError(() => new Error('boom')) : of('report' in o ? o.report : REPORT);
  });
  const waManual = { prime: vi.fn(() => calls.push('prime')), release: vi.fn(() => calls.push('release')) };
  Object.assign(h, {
    api: { get }, toasts,
    waSend: { mode: vi.fn(() => ('mode' in o ? o.mode : 'chat')) },
    reportActions: { sendWhatsApp },
    waManual,
    _waSharing: signal<string | null>(null),
  });
  return { h, toasts, sendWhatsApp, get, waManual, calls };
}

describe('Front desk - Share report on WhatsApp', () => {
  it('hands the fetched report to the one WhatsApp path (Auto or Chat decided there), with the current patient phone', async () => {
    const { h, sendWhatsApp, toasts, get } = harness();
    await h.shareReportWhatsapp(ORDER);
    expect(get).toHaveBeenCalledWith('/api/reports/by-order/o1');
    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(sendWhatsApp.mock.calls[0][0]).toBe(REPORT);
    expect(sendWhatsApp.mock.calls[0][1]).toEqual({ name: 'Asha Rao', phone: '+919811122233' });
    expect(toasts.success).not.toHaveBeenCalled();   // no fake "sent": Auto's toast comes from the server answer
    expect(h._waSharing()).toBeNull();
  });

  it('Auto mode also goes through the same path (the service sends from the server)', async () => {
    const { h, sendWhatsApp } = harness({ mode: 'auto' });
    await h.shareReportWhatsapp(ORDER);
    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('no phone: a clear message, nothing fetched or sent', async () => {
    const { h, sendWhatsApp, toasts, get } = harness();
    await h.shareReportWhatsapp({ id: 'o1', patient: { displayName: 'Asha Rao', phone: ' ' } });
    expect(toasts.warning).toHaveBeenCalledWith(expect.stringMatching(/no mobile number/i));
    expect(get).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('no report yet (or only a superseded one): warns, sends nothing', async () => {
    for (const report of [null, { ...REPORT, supersededByReportId: 'r2' }]) {
      const { h, sendWhatsApp, toasts } = harness({ report });
      await h.shareReportWhatsapp(ORDER);
      expect(toasts.warning).toHaveBeenCalledWith(expect.stringMatching(/no report yet/i));
      expect(sendWhatsApp).not.toHaveBeenCalled();
      expect(toasts.success).not.toHaveBeenCalled();
    }
  });

  it('a failed report read shows a real error, never success', async () => {
    const { h, sendWhatsApp, toasts } = harness({ getErr: true });
    await h.shareReportWhatsapp(ORDER);
    expect(toasts.error).toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(h._waSharing()).toBeNull();
  });

  it('neither Auto nor Chat available: does nothing', async () => {
    const { h, sendWhatsApp, get } = harness({ mode: null });
    await h.shareReportWhatsapp(ORDER);
    expect(get).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('a second click while one share is in flight is ignored', async () => {
    const { h, sendWhatsApp } = harness();
    h._waSharing.set('o9');
    await h.shareReportWhatsapp(ORDER);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('bulk WhatsApp shares each selected order only in Auto; Chat does nothing (no fake "queued")', async () => {
    const a = harness({ mode: 'auto' });
    Object.assign(a.h, { _orders: signal([ORDER, { ...ORDER, id: 'o2' }, { ...ORDER, id: 'o3' }]), _selectedIds: signal(new Set(['o1', 'o2'])), clearSelection: vi.fn() });
    await a.h.bulkWhatsapp();
    expect(a.sendWhatsApp).toHaveBeenCalledTimes(2);
    const c = harness({ mode: 'chat' });
    Object.assign(c.h, { _orders: signal([ORDER]), _selectedIds: signal(new Set(['o1'])), clearSelection: vi.fn() });
    await c.h.bulkWhatsapp();
    expect(c.sendWhatsApp).not.toHaveBeenCalled();
    expect(c.toasts.success).not.toHaveBeenCalled();
  });

  it('the template offers WhatsApp only when a mode exists (row menus + Auto-only bulk) and the fake toast is gone', () => {
    expect((html.match(/@else if \(waShareMode\(\)\) \{[\s\S]{0,600}shareReportWhatsapp/g) ?? []).length).toBe(2);
    expect(html).toMatch(/@if \(waShareMode\(\) === 'auto'\) \{\s*<button[^>]*bulkWhatsapp/);
    expect(ts).not.toMatch(/Report link sent via WhatsApp/);
    expect(ts).not.toMatch(/WhatsApp queued to/);
  });

  // ── Web: the tab opens IN the click (2026-11-13: "blocked the WhatsApp window") ──

  it('WhatsApp Chat: the tab is primed BEFORE the report is fetched, and released after (unused tab never lingers)', async () => {
    const { h, calls } = harness({ mode: 'chat' });
    await h.shareReportWhatsapp(ORDER);
    expect(calls).toEqual(['prime', 'get', 'send', 'release']);
  });

  it('WhatsApp Auto never opens a tab', async () => {
    const { h, waManual } = harness({ mode: 'auto' });
    await h.shareReportWhatsapp(ORDER);
    expect(waManual.prime).not.toHaveBeenCalled();
  });

  it('no report yet: the primed tab is closed again', async () => {
    const { h, waManual, sendWhatsApp } = harness({ report: null });
    await h.shareReportWhatsapp(ORDER);
    expect(waManual.prime).toHaveBeenCalled();
    expect(waManual.release).toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('the server\'s "no report" (not_found) is the same friendly warning, not an error', async () => {
    const { h, toasts, waManual } = harness({ getErr: 'not_found' });
    await h.shareReportWhatsapp(ORDER);
    expect(toasts.warning).toHaveBeenCalledWith(expect.stringMatching(/no report yet/i));
    expect(toasts.error).not.toHaveBeenCalled();
    expect(waManual.release).toHaveBeenCalled();
  });

  // ── Referral doctor ──

  const WITH_DOC = { ...ORDER, refDoctorName: 'Dr. Ravi', refDoctorPhone: '+91 98450 12345' };

  it('the single WhatsApp row means the patient (no second question once the tab is open)', async () => {
    const { h, sendWhatsApp } = harness();
    await h.shareReportWhatsapp(ORDER);
    expect(sendWhatsApp.mock.calls[0][2]).toEqual({ to: 'patient', doctor: null });
  });

  it('"Send to doctor" passes the doctor + the pick; works even when the patient has no phone', async () => {
    const { h, sendWhatsApp, toasts } = harness();
    await h.shareReportWhatsapp({ ...WITH_DOC, patient: { displayName: 'Asha Rao', phone: '' } }, 'doctor');
    expect(toasts.warning).not.toHaveBeenCalled();
    expect(sendWhatsApp.mock.calls[0][2]).toEqual({ to: 'doctor', doctor: { name: 'Dr. Ravi', phone: '+91 98450 12345' } });
  });

  it('"Send to patient" with a doctor on the order goes to the patient', async () => {
    const { h, sendWhatsApp } = harness();
    await h.shareReportWhatsapp(WITH_DOC, 'patient');
    expect(sendWhatsApp.mock.calls[0][2].to).toBe('patient');
  });

  it('waDoctorPhone: only a named doctor with a valid number that is not the patient\'s own', () => {
    expect(proto.waDoctorPhone(WITH_DOC)).toBe('+919845012345');
    expect(proto.waDoctorPhone(ORDER)).toBeNull();
    expect(proto.waDoctorPhone({ ...WITH_DOC, refDoctorPhone: '123' })).toBeNull();
    expect(proto.waDoctorPhone({ ...WITH_DOC, refDoctorPhone: '9876543210' })).toBeNull();   // = patient's
    expect(proto.waDoctorPhone({ ...WITH_DOC, refDoctorName: '' })).toBeNull();
  });

  it('the template: Chat + doctor number → "Send to patient" / "Send to doctor" rows in both menus; the drawer shows the doctor\'s phone', () => {
    expect((html.match(/waShareMode\(\) === 'chat' && waDoctorPhone\(/g) ?? []).length).toBe(2);
    expect((html.match(/data-test="share-whatsapp-patient"/g) ?? []).length).toBe(2);
    expect((html.match(/data-test="share-whatsapp-doctor"/g) ?? []).length).toBe(2);
    expect(html).toMatch(/shareReportWhatsapp\(o, 'doctor'\)/);
    expect(html).toMatch(/shareReportWhatsapp\(row\.order, 'doctor'\)/);
    expect(html).toMatch(/so\.refDoctorPhone[\s\S]{0,200}data-test="drawer-doctor-phone"/);
    expect(html).not.toMatch(/<select|<datalist/);
  });
});
