import { Observable } from 'rxjs';
import { Bill } from '../models/bill.model';

/** A partner (vendor) wallet as the API returns it. Every figure is DERIVED
 *  from the partner's ledger on the server (H8) — never compute it here. */
export interface VendorWalletBalance {
  id: string;
  name: string;
  code?: string;
  totalCredit: number;
  usedCredit: number;
  balance: number;
  outstanding: number;
  notifyThreshold?: number | null;
  isActive: boolean;
}

/** POST /api/billing/{id}/wallet-payment result: the settled bill plus the
 *  partner with its new ledger-derived balance. */
export interface WalletPaymentResult {
  bill: Bill;
  vendor: VendorWalletBalance;
}

/** The slice of ApiService this needs (kept narrow so specs can fake it). */
export interface WalletPaymentApi {
  post<T>(path: string, body: unknown): Observable<T>;
}

/**
 * H8 — pay a bill from a partner's credit wallet in ONE server call. The
 * server writes the bill payment, the partner's charge ledger row and the
 * wallet cache in ONE transaction, so a failure can never leave a charge with
 * no payment (the old flow was two calls: /vendors/{v}/charge then
 * /billing/{id}/payment).
 */
export function payBillFromWallet(
  api: WalletPaymentApi,
  billId: string,
  vendorId: string,
  amount: number,
  opts: { referenceNo?: string | null; reason?: string | null } = {},
): Observable<WalletPaymentResult> {
  return api.post<WalletPaymentResult>(`/api/billing/${billId}/wallet-payment`, {
    vendorId,
    amount,
    referenceNo: opts.referenceNo || vendorId,
    reason: opts.reason ?? null,
  });
}
