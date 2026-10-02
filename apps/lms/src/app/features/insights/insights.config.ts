/**
 * Insights — section + list catalogue and the server DTO shapes. The
 * component reads ONLY these; every number comes from
 * `/api/analytics/*` (AnalyticsService is the calculation layer).
 */

export type AnalyticsSection = 'overview' | 'volume' | 'revenue' | 'tests-depts' | 'referrals' | 'lab-ops' | 'outsourcing' | 'profitability';
export type OpsListKey = 'patients' | 'orders' | 'test-volume' | 'outsourced-tests' | 'referrals' | 'monthly-financial' | 'outstanding' | 'discounts' | 'refunds';
/** The left navigation's one id space: an analytics section or `list:<key>`. */
export type InsightsNavId = AnalyticsSection | `list:${OpsListKey}`;

export interface SectionDef {
  id: AnalyticsSection;
  label: string;
  /** One line under the main card's title. */
  blurb: string;
  /** Stroked 24px SVG path data. */
  icon: string;
  money?: boolean;
}

export const ICONS = {
  overview: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  volume: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  revenue: '<path d="M6 3h12"/><path d="M6 8h12"/><path d="M6 13l8.5 8"/><path d="M6 13h3a5 5 0 0 0 0-10"/>',
  tests: '<path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3"/><path d="M7.5 15h9"/>',
  referrals: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
  labops: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>',
  outsourcing: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  profit: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  sections: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  details: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  receipt: '<path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5Z"/><path d="M8 8h8M8 12h8"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
} as const;

export const SECTIONS: SectionDef[] = [
  { id: 'overview', label: 'Overview', icon: ICONS.overview, blurb: 'The period at a glance — tap a figure to see what drives it.' },
  { id: 'volume', label: 'Patients & Volume', icon: ICONS.volume, blurb: 'Who came in and how much work they brought.' },
  { id: 'revenue', label: 'Revenue', icon: ICONS.revenue, blurb: 'Billed, discounted, refunded and collected — net of GST.', money: true },
  { id: 'tests-depts', label: 'Tests & Departments', icon: ICONS.tests, blurb: 'Bench work by department, in-house and sent out.' },
  { id: 'referrals', label: 'Referrals', icon: ICONS.referrals, blurb: 'Which doctors and sources send patients.' },
  { id: 'lab-ops', label: 'Lab Operations', icon: ICONS.labops, blurb: 'Turnaround, backlog, rejections and people.' },
  { id: 'outsourcing', label: 'Outsourcing', icon: ICONS.outsourcing, blurb: 'Work sent to partner labs and what it costs.' },
  { id: 'profitability', label: 'Profitability', icon: ICONS.profit, blurb: 'Revenue against partner cost, per test and department.', money: true },
];

export interface OpsColumn { field: string; headerName: string; money?: boolean; date?: boolean; num?: boolean; ref?: boolean; minWidth?: number; flex?: number; }
export interface OpsListConfig {
  key: OpsListKey; label: string; endpoint: string;
  /** Stroked SVG path data (collapsed rail). */
  icon: string;
  /** What the list is, one line (side card). */
  about: string;
  /** Viewing (not just exporting) this list needs export_patient_data — every column is PII (Patients). */
  requiresExportPatientData?: boolean;
  /** Exporting this list needs export_patient_data (it carries a patient name/phone/DOB column). */
  patientExport?: boolean;
  /** The whole list is money — needs view_financial_analytics to view at all. */
  financialOnly?: boolean;
  /** Which band filters the server applies to this list (others are ignored by the endpoint). */
  takes: ReadonlyArray<'departmentId' | 'testId' | 'refDoctorId'>;
  columns: OpsColumn[];
}

export const OPS_LISTS: OpsListConfig[] = [
  { key: 'patients', label: 'Patients', endpoint: 'patients', icon: ICONS.volume, requiresExportPatientData: true, takes: [],
    about: 'Everyone with an order in the period, with their first-ever order date.', columns: [
    { field: 'mrn', headerName: 'MRN', minWidth: 120 }, { field: 'firstName', headerName: 'First name', minWidth: 140, flex: 1.2 },
    { field: 'lastName', headerName: 'Last name', minWidth: 140, flex: 1.2 }, { field: 'age', headerName: 'Age', num: true, minWidth: 80, flex: 0.5 },
    { field: 'sex', headerName: 'Sex', minWidth: 80, flex: 0.5 }, { field: 'phone', headerName: 'Phone', minWidth: 140 },
    { field: 'firstOrderAt', headerName: 'First order', date: true, minWidth: 170 },
  ] },
  { key: 'orders', label: 'Orders', endpoint: 'orders', icon: ICONS.receipt, patientExport: true, takes: [],
    about: 'Every order in the period with its billed value (excl. GST).', columns: [
    { field: 'orderNumber', headerName: 'Order', minWidth: 160 }, { field: 'patientName', headerName: 'Patient', minWidth: 180, flex: 1.4 },
    { field: 'mrn', headerName: 'MRN', minWidth: 120 }, { field: 'branchName', headerName: 'Branch', minWidth: 140 },
    { field: 'orderValue', headerName: 'Order value', money: true, minWidth: 130 }, { field: 'createdAt', headerName: 'Created', date: true, minWidth: 170 },
  ] },
  { key: 'test-volume', label: 'Test volume', endpoint: 'test-volume', icon: ICONS.tests, takes: ['departmentId', 'testId'],
    about: 'Each test ordered in the period, per branch, with how often and for how much.', columns: [
    { field: 'testName', headerName: 'Test', minWidth: 220, flex: 1.8 }, { field: 'branchName', headerName: 'Branch', minWidth: 140 },
    { field: 'orders', headerName: 'Orders', num: true, minWidth: 100 }, { field: 'value', headerName: 'Value', money: true, minWidth: 130 },
  ] },
  { key: 'outsourced-tests', label: 'Outsourced tests', endpoint: 'outsourced-tests', icon: ICONS.outsourcing, takes: ['departmentId'],
    about: 'Lines sent to a partner lab, with the billed value of their order line.', columns: [
    { field: 'testName', headerName: 'Test', minWidth: 200, flex: 1.6 }, { field: 'vendorName', headerName: 'Partner', minWidth: 160 },
    { field: 'branchName', headerName: 'Branch', minWidth: 140 }, { field: 'value', headerName: 'Value', money: true, minWidth: 120 },
    { field: 'orderId', headerName: 'Order ref', ref: true, minWidth: 110 }, { field: 'createdAt', headerName: 'Created', date: true, minWidth: 170 },
  ] },
  { key: 'referrals', label: 'Referrals', endpoint: 'referrals', icon: ICONS.referrals, takes: ['refDoctorId'],
    about: 'Referring doctors in the period, with their orders and order value.', columns: [
    { field: 'doctorName', headerName: 'Doctor', minWidth: 200, flex: 1.6 }, { field: 'branchName', headerName: 'Branch', minWidth: 140 },
    { field: 'orders', headerName: 'Orders', num: true, minWidth: 100 }, { field: 'orderValue', headerName: 'Order value', money: true, minWidth: 130 },
  ] },
  { key: 'monthly-financial', label: 'Payments', endpoint: 'monthly-financial', icon: ICONS.card, financialOnly: true, takes: [],
    about: 'Every payment and refund taken in the period, by mode.', columns: [
    { field: 'at', headerName: 'Paid at', date: true, minWidth: 170 }, { field: 'value', headerName: 'Amount', money: true, minWidth: 120 },
    { field: 'paymentMode', headerName: 'Mode', minWidth: 110 }, { field: 'status', headerName: 'Status', minWidth: 110, flex: 1.2 },
    { field: 'orderId', headerName: 'Order ref', ref: true, minWidth: 110 },
  ] },
  { key: 'outstanding', label: 'Outstanding payments', endpoint: 'outstanding', icon: ICONS.clock, financialOnly: true, patientExport: true, takes: [],
    about: 'Orders from the period that still have money to collect.', columns: [
    { field: 'patientName', headerName: 'Patient', minWidth: 180, flex: 1.4 }, { field: 'value', headerName: 'Due', money: true, minWidth: 120 },
    { field: 'at', headerName: 'Order date', date: true, minWidth: 170 }, { field: 'orderId', headerName: 'Order ref', ref: true, minWidth: 110 },
  ] },
  { key: 'discounts', label: 'Discounts', endpoint: 'discounts', icon: ICONS.percent, financialOnly: true, patientExport: true, takes: [],
    about: 'Bills in the period that carried a discount.', columns: [
    { field: 'patientName', headerName: 'Patient', minWidth: 180, flex: 1.4 }, { field: 'orderValue', headerName: 'Order value', money: true, minWidth: 130 },
    { field: 'discount', headerName: 'Discount', money: true, minWidth: 120 }, { field: 'orderId', headerName: 'Order ref', ref: true, minWidth: 110 },
  ] },
  { key: 'refunds', label: 'Refunds', endpoint: 'refunds', icon: ICONS.undo, financialOnly: true, patientExport: true, takes: [],
    about: 'Money returned to patients in the period.', columns: [
    { field: 'patientName', headerName: 'Patient', minWidth: 180, flex: 1.4 }, { field: 'orderValue', headerName: 'Order value', money: true, minWidth: 130 },
    { field: 'refund', headerName: 'Refund', money: true, minWidth: 120 }, { field: 'refundedAt', headerName: 'Refunded at', date: true, minWidth: 170 },
    { field: 'orderId', headerName: 'Order ref', ref: true, minWidth: 110 },
  ] },
];

/** A chart / KPI click narrows the LIST only (the band stays put): a
 *  bucket's day range and/or one department / test / referrer. */
export interface ListDrill {
  label: string;
  fromYmd?: string; toYmd?: string;
  departmentId?: string; testId?: string; refDoctorId?: string;
}

// ── Server DTOs (camelCase JSON; money fields OMITTED without permission) ──

export interface OverviewDto {
  patients: number; patientsDeltaPct?: number | null;
  tests: number; testsDeltaPct?: number | null;
  billedNet?: number | null; billedNetDeltaPct?: number | null;
  collected?: number | null; collectedDeltaPct?: number | null;
  avgBillValue?: number | null; avgBillValueDeltaPct?: number | null;
  testsPerPatient: number; testsPerPatientDeltaPct?: number | null;
  outsourcedPct: number; outsourcedPctDeltaPct?: number | null;
  medianTatMinutes?: number | null; medianTatDeltaPct?: number | null;
}
export interface Trend<P> { bucketUnit: string; points: P[]; }
export interface VolumeTrendPoint { bucket: string; patients: number; newPatients: number; returningPatients: number; tests: number; testsPerPatient: number; }
export interface RevenueTrendPoint { bucket: string; gross: number; discount: number; refund: number; net: number; collected: number; avgBillValue: number; }
export interface DeptRevenueRow { departmentName: string; revenue: number; departmentId?: string | null; }
export interface TopTestRow { testName: string; orders: number; revenue: number; testId?: string | null; }
export interface TestVolumeByDeptRow { departmentName: string; inHouse: number; outsourced: number; departmentId?: string | null; }
export interface TopTestVolumeRow { testName: string; count: number; pctOfTotal: number; testId?: string | null; }
export interface ReferralVolumeTrendPoint { bucket: string; orders: number; }
export interface TopReferringDoctorRow { doctorName: string; patients: number; orders: number; revenue?: number | null; doctorId?: string | null; }
export interface SourceTypeRevenueRow { sourceType: string; revenue: number; }
export interface TatByDeptRow { departmentName: string; medianMinutes: number; p90Minutes: number; pctWithinTarget: number; count: number; departmentId?: string | null; }
export interface PendingByStageRow { stage: string; count: number; overdue: number; }
export interface RejectionReasonRow { reason: string; count: number; }
export interface StaffProductivityRow { userName: string; entered: number; validated: number; }
export interface ReportDeliveryRow { status: string; count: number; }
export interface CriticalValuesSummary { count: number; medianMinutesToAcknowledge: number | null; medianMinutesToCommunicate: number | null; }
export interface OutsourcedVolumeTrendPoint { bucket: string; count: number; }
export interface TestsByVendorRow { vendorName: string; count: number; revenue: number; }
export interface OutsourcingCostResult { revenue: number; cost: number; noPriceCount: number; lineCount: number; }
export interface OutsourcingCostTrendPoint { bucket: string; revenue: number; cost: number; noPriceCount: number; }
export interface ProfitabilityRow { name: string; revenue: number; cost: number | null; margin: number | null; hasOutsourcedLines: boolean; noPriceCount: number; id?: string | null; }

export const REVENUE_SERIES = ['net', 'collected', 'gross', 'discount', 'refund'] as const;
export type RevenueSeriesKey = typeof REVENUE_SERIES[number];
export const REVENUE_SERIES_LABEL: Record<RevenueSeriesKey, string> = {
  gross: 'Gross', discount: 'Discount', refund: 'Refund', net: 'Billed (net)', collected: 'Collected',
};
