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
  order?: { id: string; createdAt?: string; patient?: { displayName?: string; phone?: string; mrn?: string; sex?: string | null; age?: number | null } | null };
}

/** One sign-off block in the report footer. Up to three may be present
 *  (typically: lab technician, pathologist 1, pathologist 2). */
export interface ReportSignature {
  name?: string;
  title?: string;
  regNo?: string;
  signatureUrl?: string;
}

/** Tenant-wide configuration for the printed lab-report PDF. Mirrors the
 *  six tabs of the admin editor: identity, header & logo, theme, patient
 *  block, date & time, signatures & footer. Every visible chrome element
 *  of the generated report is admin-tunable here. */
export interface ReportTemplate {
  id: string;
  tenantId: string;

  // ── Identity ─────────────────────────────────────────────
  labName: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoUrl?: string;
  nablAccredited: boolean;
  nablNumber?: string;
  nablLogoUrl?: string;

  // ── Header & logo layout ─────────────────────────────────
  /** 'drlogy' | 'centered' | 'banner' | 'minimal' */
  headerPreset?: string;
  /** 'left' | 'center' | 'right' */
  logoPosition?: string;
  /** 'sm' | 'md' | 'lg' */
  logoSize?: string;
  topAccentBar?: boolean;

  // ── Pre-printed letterpad mode ───────────────────────────
  /** When true, PRINTING asks letterhead paper vs plain paper for each job;
   *  letterhead paper renders with NO header/footer/logo, leaving blank space
   *  at the top (letterpadHeaderMm) and bottom (letterpadFooterMm) of every
   *  page. It never affects digital outputs (preview, download, share,
   *  WhatsApp, archived PDF, public link) — those always carry the letterhead.
   *  See shared/utils/print-letterhead.ts. */
  letterpadMode?: boolean;
  letterpadHeaderMm?: number;
  letterpadFooterMm?: number;

  // ── Theme — colors + typography ──────────────────────────
  primaryColor: string;
  accentColor?: string;
  tableHeaderBg?: string;
  tableHeaderText?: string;
  bodyTextColor?: string;
  dividerColor?: string;
  /** 'helvetica' | 'times' | 'courier' */
  fontFamily?: string;
  /** 'sm' | 'md' | 'lg' */
  fontSize?: string;
  /** 'plain' | 'bordered' | 'striped' */
  tableStyle?: string;
  zebraRows?: boolean;

  // ── Patient block ────────────────────────────────────────
  /** 'three-col' | 'four-col-grid' | 'stacked' */
  patientLayout?: string;
  showPatientName: boolean;
  showAge: boolean;
  showRefDoctor: boolean;
  showOrderId: boolean;
  showAbhaId: boolean;
  showBarcode?: boolean;
  showQrCode: boolean;
  /** JSON array of custom patient-registration fields the lab chose to print on
   *  the report: `[{ name, title }]`. The values come from the patient's saved
   *  registration attributes (snapshot.patient.attributes). */
  patientFieldsJson?: string;
  /** JSON `string[][]` — drag-arranged item keys per column for the 3-column
   *  patient block (which items go in each column, in what order). */
  patientColumnsJson?: string;

  // ── Date & time ──────────────────────────────────────────
  /** Token: 'dd MMM yyyy' | 'dd/MM/yyyy' | 'MMM dd, yyyy' | 'yyyy-MM-dd' */
  dateFormat?: string;
  /** 'none' | '12h' | '24h' */
  timeFormat?: string;
  dateTimeSeparator?: string;
  showRegistered?: boolean;
  showCollectionDate: boolean;
  showReportDate: boolean;

  // ── Results display ──────────────────────────────────────
  showMethod: boolean;
  showInstrument: boolean;
  groupByDepartment: boolean;
  /** When true, each department's tests start on a NEW PAGE in the report. */
  departmentPageBreak?: boolean;
  showCriticalFlag: boolean;
  /** Template-level (singular, common to every test) results-table columns.
   *  JSON-serialised ReportColumn[] — order, type, width, lock, and linkedNext
   *  (merge-with-next) per column. Drives the main results table directly in
   *  both the live preview and generated reports. When absent, the renderer
   *  falls back to its built-in column layout. Supersedes the per-department
   *  columns for the continuous results table. */
  resultColumnsJson?: string;
  /** Abnormal-flag styling in the results table:
   *  'bold' (bold value + indicator) | 'bold_color' (also tints high/low). */
  flagStyle?: string;
  /** Abnormal indicator glyph: 'letter' (H/L) | 'arrow' (↑/↓). */
  flagIndicator?: string;
  /** Colour for HIGH abnormals when flagStyle is 'bold_color' (hex). */
  abnormalColor?: string;
  /** Colour for LOW abnormals when flagStyle is 'bold_color' (hex). */
  abnormalLowColor?: string;

  // ── Signatures & footer ──────────────────────────────────
  showPathologistName: boolean;
  showSignature: boolean;
  signatureUrl?: string;
  /** JSON-serialised ReportSignature[] (up to 3). The editor stores
   *  signatures as an array; the API persists it as a JSON string. */
  signaturesJson?: string;
  disclaimer?: string;
  footerText?: string;
  watermarkText?: string;
  /** 0.0–1.0 */
  watermarkOpacity?: number;
  showSampleCollectionBand?: boolean;
  endOfReportText?: string;
  showPoweredBy: boolean;

  /** Free-form JSON (server column `metadata`, jsonb). The report designer
   *  keeps the letterhead layout under `headerLayout` — see
   *  shared/utils/report-header-layout.ts. Absent = print as the header
   *  style always did. */
  metadata?: string | null;
}
