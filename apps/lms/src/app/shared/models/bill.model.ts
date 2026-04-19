export interface Bill {
  id: string;
  orderId: string;
  patientId: string;
  branchId: string;
  type: string;
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
  totalPayable: number;
  totalPaid: number;
  balance: number;
  status: string;
  items: BillItem[];
  payments?: BillPayment[];
  createdAt: string;
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
