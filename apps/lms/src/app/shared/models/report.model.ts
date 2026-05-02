export interface Report {
  id: string;
  orderId: string;
  patientId: string;
  type: string;
  status: string;
  data?: string;
  qrCode?: string;
  qrToken?: string;
  qrExpiresAt?: string;
  deliveredVia?: string;
  deliveryStatus: string;
  deliveryNote?: string;
  generatedBy?: string;
  createdAt: string;
  /** EF eager-loads Order.Patient on the queue endpoint, so the JSON
   *  carries a nested patient under order. Typed loosely so we can
   *  read displayName for the queue search/list without forcing the
   *  full Patient shape on every consumer of Report. */
  order?: { id: string; createdAt?: string; patient?: { displayName?: string; phone?: string } | null };
}

export interface ReportTemplate {
  id: string;
  tenantId: string;
  labName: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string;
  nablAccredited: boolean;
  nablNumber?: string;
  primaryColor: string;
  showPatientName: boolean;
  showAge: boolean;
  showRefDoctor: boolean;
  showCollectionDate: boolean;
  showReportDate: boolean;
  showOrderId: boolean;
  showAbhaId: boolean;
  showMethod: boolean;
  showInstrument: boolean;
  groupByDepartment: boolean;
  showCriticalFlag: boolean;
  showPathologistName: boolean;
  showSignature: boolean;
  signatureUrl?: string;
  disclaimer?: string;
  showQrCode: boolean;
  showPoweredBy: boolean;
}
