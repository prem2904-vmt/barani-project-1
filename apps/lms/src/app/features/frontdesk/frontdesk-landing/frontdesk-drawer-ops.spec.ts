import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/** OPS-122 / OPS-131 / OPS-132: the front desk order drawer + invoice viewer + the Today list. */
const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const ts = readFileSync(`${DIR}/frontdesk-landing.component.ts`, 'utf8');
const proto = FrontdeskLandingComponent.prototype as any;

describe('OPS-131 - order summary drawer', () => {
  it('shows the Order ID under the patient header', () => {
    expect(html).toMatch(/data-test="drawer-order-id"[\s\S]{0,120}Order \{\{ so\.orderNumber \}\}/);
  });
  it('relabels Doctor to Referral doctor and offers the shared edit-referral dialog', () => {
    expect(html).toContain('<dt>Referral doctor</dt>');
    expect(html).not.toContain('<dt>Doctor</dt>');
    expect(html).toMatch(/<pf-edit-referral-dialog \[orderId\]="so\.id" \(saved\)="onReferralSaved\(so, \$event\)"/);
    expect(html).toContain('data-test="drawer-edit-referral"');
  });
  it('the preliminary report has no reference range column', () => {
    const prelim = html.slice(html.indexOf('<section class="pf-prelim">'), html.indexOf('Timeline') > 0 ? html.indexOf('<section class="pf-prelim">') + 3500 : undefined);
    expect(prelim).not.toContain('pf-prelim__row-range');
    expect(prelim).toContain('pf-prelim__row-value');
  });
  it('the edit button needs modify_order (the same permission as the server) and an open order', () => {
    const hasPermission = vi.fn((p: string) => p === 'modify_order');
    const h = Object.create(proto);
    Object.assign(h, { auth: { hasPermission } });
    expect(h.canEditReferral({ id: 'o', status: 'billed' })).toBe(true);
    expect(h.canEditReferral({ id: 'o', status: 'cancelled' })).toBe(false);
    hasPermission.mockReturnValue(false);
    expect(h.canEditReferral({ id: 'o', status: 'billed' })).toBe(false);
  });
  it('a saved referral updates the open drawer and the list row at once', () => {
    const toasts = { success: vi.fn() };
    const o = { id: 'o1', refDoctorName: 'Old' };
    const h = Object.create(proto);
    Object.assign(h, {
      toasts, referralFor: signal('o1'), _orders: signal([o, { id: 'o2', refDoctorName: 'Other' }]), _selectedOrder: signal(o),
    });
    h.onReferralSaved(o, { changed: true, reportAmended: false, order: { refDoctorName: 'Dr New', refHospitalName: 'H' } });
    expect(h.referralFor()).toBeNull();
    expect(h._selectedOrder().refDoctorName).toBe('Dr New');
    expect(h._orders().map((x: any) => x.refDoctorName)).toEqual(['Dr New', 'Other']);
    h.referralFor.set('o1');
    h.onReferralSaved(o, { changed: false, reportAmended: false });
    expect(h.referralFor()).toBeNull();
    expect(h._orders()[0].refDoctorName).toBe('Dr New');
  });
});

describe('OPS-122 - WhatsApp from the invoice viewer', () => {
  it('the viewer has a WhatsApp button gated on the lab\'s WhatsApp Chat switch', () => {
    const viewer = html.slice(html.indexOf('<!-- Invoice preview'));
    expect(viewer).toMatch(/@if \(waChatOn\(\)\) \{[\s\S]{0,200}shareInvoiceWhatsapp\(\)/);
    expect(viewer).toContain('data-test="invoice-whatsapp"');
  });
  it('sends the viewer\'s own PDF to the patient of the open order, with the due when unpaid', async () => {
    const sendInvoice = vi.fn(async (a: any) => { await a.pdf(); return 'opened'; });
    const blobFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ blob: async () => new Blob(['x']) } as any);
    const h = Object.create(proto);
    Object.assign(h, {
      waManual: { sendInvoice }, auth: { user: () => ({ tenantName: 'Arun Lab' }) },
      invoiceCtx: { order: { id: 'o', patient: { phone: '9876543210', displayName: 'Asha' } }, bill: { invoiceNumber: 'INV-9', totalPayable: 400, totalPaid: 250, balance: 150 } },
      invoiceBlobUrl: 'blob:inv', invoiceSharing: signal(false),
    });
    await h.shareInvoiceWhatsapp();
    expect(sendInvoice).toHaveBeenCalledWith(expect.objectContaining({ phone: '9876543210', patientName: 'Asha', labName: 'Arun Lab', invoiceNumber: 'INV-9', amount: 400, balance: 150 }));
    expect(blobFetch).toHaveBeenCalledWith('blob:inv');
    expect(h.invoiceSharing()).toBe(false);
    blobFetch.mockRestore();
  });
  it('opening the viewer KEEPS the share context (the re-test bug: the preview reset wiped it, so WhatsApp did nothing)', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:inv-1');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const order = { id: 'o', orderNumber: 'LAB-1', status: 'validated', createdAt: new Date().toISOString(), samples: [], patient: { phone: '9876543210', displayName: 'Asha', age: 30, gender: 'F' } };
    const bill = { id: 'b', orderId: 'o', invoiceNumber: 'INV-9', subTotal: 400, totalDiscount: 0, totalTaxable: 400, totalTax: 0, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalPayable: 400, totalPaid: 400, balance: 0, items: [{ name: 'CBC', quantity: 1, unitPrice: 400, taxable: 400, total: 400, gstRate: 0 }], payments: [] };
    const h = Object.create(proto);
    Object.assign(h, {
      api: { post: vi.fn(() => of(bill)), get: vi.fn((u: string) => of(u.includes('track-token') ? { token: 't' } : { showLogo: false })) },
      toasts: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
      auth: { user: () => ({ tenantName: 'Arun Lab', displayName: 'Desk' }) },
      sanitizer: { bypassSecurityTrustResourceUrl: (u: string) => u },
      invoiceLoading: signal(false), invoicePreviewUrl: signal(null), invoicePreviewNumber: signal(''),
      invoiceBlobUrl: null, invoiceCtx: null,
    });
    await h.viewInvoice(order);
    expect(h.toasts.error).not.toHaveBeenCalled();
    expect(h.invoicePreviewUrl()).toBeTruthy();
    expect(h.invoiceCtx).toEqual({ order, bill });
    expect(h.invoiceBlobUrl).toBeTruthy();
    created.mockRestore(); revoked.mockRestore();
  });
  it('does nothing without an open invoice', async () => {
    const sendInvoice = vi.fn();
    const h = Object.create(proto);
    Object.assign(h, { waManual: { sendInvoice }, invoiceCtx: null, invoiceBlobUrl: null, invoiceSharing: signal(false) });
    await h.shareInvoiceWhatsapp();
    expect(sendInvoice).not.toHaveBeenCalled();
  });
});

describe('OPS-132 - Today / no-chip list is date-bound; the Payments due TAB lists every due', () => {
  it('the tab and its chip counts read paymentsDueAll (no date window); the merged list keeps the window', () => {
    const all = ts.slice(ts.indexOf('readonly paymentsDueAll = computed'), ts.indexOf('readonly paymentsDueOrders = computed'));
    expect(all).not.toContain('inWorkWindow');
    expect(all).not.toContain('dueInWindow');
    expect(ts).toMatch(/label: 'Payments due', count: this\.paymentsDueAll\(\)\.length/);
    expect(html).not.toMatch(/data-tone="warning">\{\{ paymentsDueOrders\(\)\.length/);
    expect(html.match(/\{\{ paymentsDueAll\(\)\.length \}\}/g)?.length).toBe(2);
    expect(ts).toMatch(/_rightTab\(\) !== null\) return this\.shownPaymentsDueTab\(\)/);
    expect(ts).toContain('buildFrontdeskMergedWork(this.shownInProgress(), this.shownCompleted(), this.shownPaymentsDue(), tubes)');
  });
});

describe('OPS-132 - Payments due follows the creation day only (behaviour: work-status-filter.spec.ts)', () => {
  it('paymentsDueOrders is the windowed view of paymentsDueAll, with no "touched today" bonus', () => {
    const body = ts.slice(ts.indexOf('readonly paymentsDueOrders = computed'), ts.indexOf('readonly paymentsDueOrders = computed') + 200);
    expect(body).toContain('dueInWindow(this.paymentsDueAll(), this.workBounds())');
    expect(body).not.toContain('hadTodayActivity');
  });
  it('dues whose order is not in the loaded feed are read by id whenever the bills or the feed change', () => {
    const eff = ts.slice(ts.indexOf('_loadMissingDueOrders = effect'), ts.indexOf('_loadMissingDueOrders = effect') + 260);
    expect(eff).toContain('this._bills()');
    expect(eff).toContain('this._orders()');
    expect(eff).toContain('this.fetchOrdersForBills(bills)');
  });
});
