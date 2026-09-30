import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { OPD_API } from '../shared/opd-api';
import type { DrugForm, DrugSchedule, OpdRefund, PharmacyConfig } from '../shared/opd.models';
import type { RxSchedule } from '../shared/rx-schedule';

/**
 * Pharmacy (OPD Agent D) — the wire contract of prefrontal-mw
 * Controllers/Opd/Pharmacy*Controller.cs. Every call goes through the app's
 * ApiService under OPD_API.pharmacy (404 unless OPD is allowed).
 */

export type DrugOrigin = 'master' | 'override' | 'local';

/** A drug as this tenant sees it (copy-on-write). `id` is the STABLE id (the
 *  master row's when one exists) — stock, bills and Rx lines use it. */
export interface PharmacyDrugRow {
  id: string; rowId: string; catalogKey: string; origin: DrugOrigin; isMaster: boolean;
  name: string; generic?: string | null; strength?: string | null; form: DrugForm; unit?: string | null;
  packSize?: number | null; manufacturer?: string | null; schedule: DrugSchedule; hsnCode?: string | null;
  taxSlab: number; defaultMrp?: number | null; aliases: string[]; isActive: boolean; onHand?: number | null;
  /** Integrator (pharmacy_drugs): topical site kind + the usual Rx for doctor favourites. */
  siteKind?: string | null; usual?: Record<string, unknown> | null;
}

/** One grid row's edit (null/undefined fields are left as they are). */
export interface DrugEdit {
  id?: string | null; name?: string; generic?: string; strength?: string; form?: DrugForm; unit?: string;
  packSize?: number; manufacturer?: string; schedule?: DrugSchedule; hsnCode?: string; taxSlab?: number;
  defaultMrp?: number; isActive?: boolean; aliases?: string[]; revert?: boolean;
  /** "" clears. */
  siteKind?: string; usual?: Record<string, unknown> | null;
}

export interface StockRow {
  drugId: string; name: string; generic?: string | null; strength?: string | null; form: DrugForm; unit?: string | null;
  schedule: DrugSchedule; onHand: number; expiredQty: number; batches: number; nearestExpiry?: string | null;
  minQty?: number | null; reorderQty?: number | null; low: boolean;
}

export interface BatchRow {
  id: string; drugId: string; batchNo: string; expiryDate: string; mrp: number; purchasePrice: number;
  qtyOnHand: number; supplierId?: string | null; receivedAt: string; expired: boolean;
}

export interface MoveRow {
  id: string; drugId: string; drugName: string; batchId: string; batchNo: string;
  kind: 'receive' | 'dispense' | 'sale' | 'return_in' | 'return_out' | 'adjust' | 'expire';
  qty: number; refType?: string | null; refId?: string | null; note?: string | null; at: string; by: string; byName?: string | null;
}

export interface ReceiveBody {
  drugId: string; batchNo: string; expiryDate: string; mrp: number; purchasePrice: number; qty: number;
  supplierId?: string | null; note?: string | null;
}

export interface PersonRef { id?: string | null; name: string; meta?: string | null; phone?: string | null }

export interface RxQueueRow {
  visitId: string; visitNumber?: string | null; token: number; patientId: string; patientName: string; patientMeta?: string | null;
  doctorUserId: string; doctorName: string; completedAt?: string | null; lines: number; pending: number; status: 'pending' | 'partial';
}

export interface DrugBrief {
  id: string; name: string; generic?: string | null; strength?: string | null; form: DrugForm; unit?: string | null;
  schedule: DrugSchedule; hsnCode?: string | null; taxSlab: number; defaultMrp?: number | null; onHand: number;
}

export interface PickBatch { id: string; batchNo: string; expiryDate: string; mrp: number; qtyOnHand: number }

export interface RxLineView {
  rxLineId: string; drugId?: string | null; drugName: string; form: DrugForm; dose: number; site?: string | null;
  schedule: RxSchedule; durationDays: number; food?: 'Before' | 'After' | null; quantity: number; dispensed: number;
  remaining: number; dispenseStatus: 'pending' | 'partial' | 'dispensed' | 'not_dispensed'; notes?: string | null;
  drug?: DrugBrief | null; batches: PickBatch[]; substitutes: DrugBrief[];
}

export interface RxDetail {
  visitId: string; visitNumber?: string | null; token: number; patient: PersonRef; doctor: PersonRef; doctorRegNo?: string | null;
  completedAt?: string | null; consultStatus: string; lines: RxLineView[]; settings: PharmacyConfig; dispenses: DispenseSummary[];
}

/** `overrideReason` is required when `qty` is more than the Rx line's
 *  remaining quantity (critic #4). */
export interface DispenseLineInput { rxLineId?: string | null; drugId?: string | null; qty: number; batchId?: string | null; skip?: boolean; overrideReason?: string | null }
export interface PaymentBody { mode: PayMode; amount: number; reference?: string | null }
export type PayMode = 'cash' | 'upi' | 'card';

/** `patientAddress` / `prescriberAddress` are required only when an H1 / X
 *  line is on the Rx / cart and the tenant enforces schedules (critic #1). */
export interface CounterBody {
  patientId?: string | null; walkInName?: string | null; walkInPhone?: string | null;
  prescriberName?: string | null; prescriberRegNo?: string | null; lines: DispenseLineInput[]; discount?: number; notes?: string | null;
  patientAddress?: string | null; prescriberAddress?: string | null;
}

export interface DispenseLineView {
  id: string; rxLineId?: string | null; drugId: string; drugName: string; generic?: string | null; form: DrugForm; unit?: string | null;
  schedule: DrugSchedule; batchId: string; batchNo: string; expiryDate: string; qty: number; mrp: number; total: number; returnedQty: number;
  overrideReason?: string | null;
  /** night/pharm — critic #8: strength + GST slab for the "generic-first" bill print, and what was ORDERED when a substitute was given. */
  strength?: string | null; taxSlab?: number; rxDrugName?: string | null;
}

export interface BillView {
  id: string; invoiceNumber?: string | null; subTotal: number; discount: number; totalTaxable: number; totalCgst: number;
  totalSgst: number; totalTax: number; roundOff: number; totalPayable: number; totalPaid: number; balance: number; status: string;
  payments: { amount: number; mode: string; reference?: string | null; at: string }[];
}

export interface DispenseView {
  id: string; kind: 'rx' | 'walk_in'; number?: string | null; status: 'draft' | 'completed' | 'cancelled' | 'returned';
  visitId?: string | null; patientId?: string | null; customerName?: string | null; customerPhone?: string | null;
  prescriberName?: string | null; prescriberRegNo?: string | null; notes?: string | null; createdAt: string; dispensedAt?: string | null;
  editable: boolean; lines: DispenseLineView[]; bill?: BillView | null;
  /** Integrator: a walk-in's uploaded paper prescription (file name; URL via prescriptionUrl). */
  prescriptionFileName?: string | null;
  /** Integrator: credit notes on this sale's bill (patient returns). */
  refunds?: OpdRefund[] | null;
  /** night/pharm — critic #1: the address entered for an H1 / X line (re-shown when the draft is reopened). */
  patientAddress?: string | null;
  prescriberAddress?: string | null;
}

export interface DispenseSummary {
  id: string; kind: 'rx' | 'walk_in'; number?: string | null; status: string; createdAt: string; dispensedAt?: string | null;
  customerName?: string | null; total: number; paid: number; lines: number;
}

export interface H1Row {
  id: string; at: string; drugName: string; generic?: string | null; schedule: DrugSchedule; batchNo: string; qty: number;
  patientName: string; patientAddress?: string | null; prescriberName: string; prescriberRegNo?: string | null;
  dispenseNumber?: string | null; byName?: string | null; serial?: number | null; prescriberAddress?: string | null;
}

export interface SupplierRow {
  id: string; name: string; gstin?: string | null; drugLicenseNo?: string | null; phone?: string | null;
  email?: string | null; address?: string | null; isActive: boolean;
}
export type SupplierBody = Omit<SupplierRow, 'id'>;

export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
export interface PoRow {
  id: string; poNumber?: string | null; status: PoStatus; supplierId: string; supplierName: string; orderedAt?: string | null;
  expectedOn?: string | null; total: number; lines: number; createdAt: string;
}
export interface PoLineView {
  id: string; drugId: string; drugName: string; strength?: string | null; form: DrugForm; qty: number; receivedQty: number;
  unitCost: number; taxSlab: number; defaultMrp?: number | null;
}
export interface PoView extends Omit<PoRow, 'lines'> { notes?: string | null; lines: PoLineView[] }
export interface PoBody { supplierId: string; expectedOn?: string | null; notes?: string | null; lines: { drugId: string; qty: number; unitCost: number; taxSlab?: number | null }[] }
export interface GrnLine { poLineId: string; batchNo: string; expiryDate: string; mrp: number; qty: number; purchasePrice?: number | null }

const P = OPD_API.pharmacy;
const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? '?' + p.join('&') : '';
};

@Injectable({ providedIn: 'root' })
export class PharmacyApi {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  // Drugs
  searchDrugs(q: string, take = 20): Observable<PharmacyDrugRow[]> { return this.api.get(`${P}/drugs/search${qs({ q, take })}`); }
  drugMaster(q?: string): Observable<PharmacyDrugRow[]> { return this.api.get(`${P}/drug-master${qs({ q })}`); }
  saveDrugMaster(rows: DrugEdit[]): Observable<PharmacyDrugRow[]> { return this.api.put(`${P}/drug-master`, { rows }); }

  // Settings
  settings(): Observable<PharmacyConfig> { return this.api.get(`${P}/settings`); }
  saveSettings(s: PharmacyConfig): Observable<PharmacyConfig> { return this.api.put(`${P}/settings`, s); }

  // Rx
  rxQueue(): Observable<RxQueueRow[]> { return this.api.get(`${P}/rx-queue`); }
  rx(visitId: string): Observable<RxDetail> { return this.api.get(`${P}/rx/${visitId}`); }
  dispenseRx(visitId: string, body: { lines: DispenseLineInput[]; discount?: number; payment?: PaymentBody | null; notes?: string | null;
    patientAddress?: string | null; prescriberAddress?: string | null }): Observable<DispenseView | null> {
    return this.api.post(`${P}/rx/${visitId}/dispense`, body);
  }
  dispenses(date?: string | null, kind?: string | null, status?: string | null): Observable<DispenseSummary[]> {
    return this.api.get(`${P}/dispenses${qs({ date, kind, status })}`);
  }
  dispense(id: string): Observable<DispenseView> { return this.api.get(`${P}/dispenses/${id}`); }
  /** Collect a later payment on a DISPENSED sale (an Rx given "bill later", or
   *  any completed sale still carrying a balance). */
  payDispense(id: string, body: PaymentBody): Observable<DispenseView> { return this.api.post(`${P}/dispenses/${id}/pay`, body); }

  // Counter
  counterCreate(body: CounterBody): Observable<DispenseView> { return this.api.post(`${P}/counter`, body); }
  counterUpdate(id: string, body: CounterBody): Observable<DispenseView> { return this.api.put(`${P}/counter/${id}`, body); }
  counterPay(id: string, body: PaymentBody): Observable<DispenseView> { return this.api.post(`${P}/counter/${id}/pay`, body); }
  counterCancel(id: string): Observable<DispenseView> { return this.api.post(`${P}/counter/${id}/cancel`, {}); }

  // Returns
  /** A patient return; the money back is a credit note (refunded / creditNoteNumber), capped to what was paid. */
  patientReturn(dispenseLineId: string, qty: number, reason?: string | null, refundMode?: string | null): Observable<{
    dispenseLineId: string; returnedQty: number; refundDue: number; refunded?: number; creditNoteNumber?: string | null;
  }> {
    return this.api.post(`${P}/returns/patient`, { dispenseLineId, qty, reason, refundMode: refundMode ?? null });
  }
  supplierReturn(batchId: string, qty: number, supplierId?: string | null, reason?: string | null): Observable<BatchRow> {
    return this.api.post(`${P}/stock/return-to-supplier`, { batchId, qty, supplierId, reason });
  }
  returns(): Observable<MoveRow[]> { return this.api.get(`${P}/stock/returns`); }

  // Stock
  stock(q?: string | null, low = false): Observable<StockRow[]> { return this.api.get(`${P}/stock${qs({ q, low: low || null })}`); }
  batches(drugId: string, includeEmpty = false): Observable<BatchRow[]> { return this.api.get(`${P}/stock/${drugId}/batches${qs({ includeEmpty: includeEmpty || null })}`); }
  moves(drugId?: string | null, take = 100): Observable<MoveRow[]> { return this.api.get(`${P}/stock/moves${qs({ drugId, take })}`); }
  receive(body: ReceiveBody): Observable<BatchRow> { return this.api.post(`${P}/stock/receive`, body); }
  adjust(batchId: string, delta: number, reason: string): Observable<BatchRow> { return this.api.post(`${P}/stock/adjust`, { batchId, delta, reason }); }
  expire(batchId?: string | null): Observable<{ batches: number }> { return this.api.post(`${P}/stock/expire`, { batchId: batchId ?? null }); }
  setReorder(drugId: string, minQty: number, reorderQty: number): Observable<unknown> { return this.api.put(`${P}/stock/reorder`, { drugId, minQty, reorderQty }); }

  // Purchasing
  suppliers(includeInactive = false): Observable<SupplierRow[]> { return this.api.get(`${P}/suppliers${qs({ includeInactive: includeInactive || null })}`); }
  saveSupplier(id: string | null, body: SupplierBody): Observable<SupplierRow> {
    return id ? this.api.put(`${P}/suppliers/${id}`, body) : this.api.post(`${P}/suppliers`, body);
  }
  purchaseOrders(status?: string | null): Observable<PoRow[]> { return this.api.get(`${P}/purchase-orders${qs({ status })}`); }
  purchaseOrder(id: string): Observable<PoView> { return this.api.get(`${P}/purchase-orders/${id}`); }
  createPo(body: PoBody): Observable<PoView> { return this.api.post(`${P}/purchase-orders`, body); }
  updatePo(id: string, body: PoBody): Observable<PoView> { return this.api.put(`${P}/purchase-orders/${id}`, body); }
  sendPo(id: string): Observable<PoView> { return this.api.post(`${P}/purchase-orders/${id}/send`, {}); }
  cancelPo(id: string): Observable<PoView> { return this.api.post(`${P}/purchase-orders/${id}/cancel`, {}); }
  receivePo(id: string, lines: GrnLine[]): Observable<PoView> { return this.api.post(`${P}/purchase-orders/${id}/receive`, { lines }); }

  // H1
  /** `schedule` 'H1' | 'X' = that register alone (the row's schedule is snapshotted at sale). */
  h1(from?: string | null, to?: string | null, schedule?: string | null): Observable<H1Row[]> { return this.api.get(`${P}/h1-register${qs({ from, to, schedule })}`); }
  h1Csv(from?: string | null, to?: string | null, schedule?: string | null): Observable<Blob> { return this.api.getBlob(`${P}/h1-register/export${qs({ from, to, schedule })}`); }

  // Walk-in: the uploaded paper prescription (FormData through HttpClient — the app's upload convention).
  uploadPrescription(id: string, file: File): Observable<DispenseView> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<{ success: boolean; data?: DispenseView; message?: string; error?: string }>(
      `${environment.apiUrl}${P}/counter/${id}/prescription`, fd).pipe(map(r => {
        if (!r?.success || !r.data) throw new Error(r?.message || r?.error || 'Upload failed');
        return r.data;
      }));
  }
  prescriptionUrl(id: string): Observable<string> { return this.api.get(`${P}/counter/${id}/prescription`); }
}
