export interface Bill {
  id: string;
  orderId: string;
  patientId: string;
  branchId: string;
  type: string;
  /** Server-allocated invoice number (prefix + running counter). */
  invoiceNumber?: string;
  /** Resolved by the server: the user who ACTUALLY billed / collected the last
   *  payment. The invoice prints THIS name + signature — never those of
   *  whoever happens to download the PDF later. */
  cashierName?: string | null;
  cashierSignatureUrl?: string | null;
  supplierGstin?: string;
  placeOfSupply?: string;
  isInterstate: boolean;
  subTotal: number;
  overrideDiscount: number;
  overrideDiscountReason?: string;
  totalDiscount: number;
  totalTaxable: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  /** Whole-rupee bill total (owner round-off rule). */
  totalPayable: number;
  /** ±0.xx taking taxable + GST to the whole-rupee payable (server-derived;
   *  absent/0 on bills raised before round-off). Read via billRoundOff(). */
  roundOff?: number;
  totalPaid: number;
  balance: number;
  status: string;
  items: BillItem[];
  payments?: BillPayment[];
  refunds?: BillRefund[];
  createdAt: string;
}

export interface BillRefund {
  id: string;
  billId: string;
  amount: number;
  mode: string;
  reason?: string;
  refundedAt: string;
}

export interface BillItem {
  id: string;
  billId: string;
  testId: string;
  testName: string;
  hsnSacCode?: string;
  price: number;
  discount: number;
  taxableAmount: number;
  taxSlab: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  total: number;
}

export interface BillPayment {
  id: string;
  billId: string;
  amount: number;
  mode: string;
  referenceNo?: string;
  paidAt: string;
}

export interface CreateBillInput {
  orderId: string;
  discount: number;
  discountReason?: string;
}

export interface PaymentInput {
  amount: number;
  mode: string;
  referenceNo?: string;
}
