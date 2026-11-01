import type { ResolvedReportLayout } from '../models/report-layout.model';
import type { ReportTemplate } from '../models/report.model';
import type { ReportPdfInput } from './report-pdf';
import { PNG_1x1, RICH_COLUMNS, RICH_LAYOUTS, richSnapshot, richTemplate } from './report-theme.spec-helpers';

/**
 * The "long names" fixtures of the report-fit work: the kind of text that
 * overlaps on paper today. A NON-spec module on purpose (see
 * report-header-legacy.spec-helpers.ts).
 *
 * 40-character patient name · a referring doctor with a long qualification
 * string · a 60-character hospital · a long test name · a 48-character lab
 * name · 7 signatories over 3 departments (long names, titles, registration
 * numbers) · 2 trendograms.
 */

export const LONG_PATIENT = 'Thiruvenkatasamy Subramaniam Venkataraghavan';
export const LONG_DOCTOR = 'Dr. Lakshminarasimhan Venkatasubramanian MD DM';
export const LONG_HOSPITAL = 'Sri Ramachandra Institute of Higher Education and Research Hospital';
export const LONG_TEST = 'Glucose-6-Phosphate Dehydrogenase (G6PD) Quantitative, Erythrocyte';
export const LONG_LAB = 'Prefrontal Pathology And Molecular Diagnostics Centre';
export const LONG_BRANCH = 'Anna Nagar West Extension Collection Centre';
export const LONG_SIG_NAME = 'Dr. Lakshminarasimhan Venkatasubramanian';
export const LONG_SIG_TITLE = 'Consultant Clinical Biochemist and Molecular Pathologist';

const sig = (name: string, title: string, regNo: string) => ({ name, title, regNo });

const G6PD_LAYOUT = {
  testId: 'g6pd', testName: LONG_TEST, departmentName: 'Biochemistry', columns: RICH_COLUMNS, configured: true,
  sections: [{
    id: 'g6pd-g', type: 'grid', order: 1, isVisible: true,
    rows: [{
      id: 'r-g6pd', parameterName: LONG_TEST, title: LONG_TEST, isMerged: false, isBold: false, unit: 'U/g Hb',
      cells: { name: LONG_TEST, result: '8.2', unit: 'U/g Hb', range: '6.9 – 11.0' },
    }],
  }],
} as unknown as ResolvedReportLayout;

export const LONG_LAYOUTS: Record<string, ResolvedReportLayout> = { ...RICH_LAYOUTS, g6pd: G6PD_LAYOUT };

export function longNameSnapshot(): Record<string, unknown> {
  const base = richSnapshot() as { tests: unknown[]; patient: Record<string, unknown>; order: Record<string, unknown> };
  return {
    ...base,
    patient: { ...base.patient, displayName: LONG_PATIENT, mrn: 'CHN-2609-004217-3-EXTENDED' },
    order: { ...base.order, refDoctorName: LONG_DOCTOR, refHospitalName: LONG_HOSPITAL, branchName: LONG_BRANCH,
             collectedBy: 'Priyadharshini Subramanian', departments: 'Biochemistry, Haematology, Microbiology' },
    tests: [
      ...base.tests,
      { testId: 'g6pd', name: LONG_TEST, department: 'Biochemistry', sampleType: 'EDTA Whole Blood', sampleId: '26005',
        status: 'validated', method: 'Spectrophotometry', result: { values: { [LONG_TEST]: { value: '8.2', unit: 'U/g Hb', range: '6.9 – 11.0', flag: 'N' } } } },
    ],
    // 7 signatories over 3 departments.
    deptSignatures: [
      { department: 'Biochemistry', signatures: [
        sig(LONG_SIG_NAME, LONG_SIG_TITLE, 'TNMC 88213/2009/Biochem'), sig('Arun Kumar Raghunathan Iyer', 'Senior Lab Technician', 'TN-LT-4412'),
        sig('Dr. Meena Iyer', 'MD Biochemistry', 'TNMC 88213'), sig('Priyadharshini S', 'Lab Technician', 'TN-LT-9921') ] },
      { department: 'Haematology', signatures: [sig('Kavya Ramanathan', 'Lab Technician', 'TN-LT-5120'), sig('Dr. S. Balaji Venkatachalam', 'MD Pathology', 'TNMC 70455')] },
      { department: 'Microbiology', signatures: [sig('Dr. Farah Khan', 'MD Microbiology', 'TNMC 91022')] },
    ],
  };
}

/** The long-name report. `fit` turns text fitting on in the template's style. */
export function longNameInput(opts: { fit?: boolean; patch?: Partial<ReportTemplate>; style?: Record<string, unknown> } = {}): ReportPdfInput {
  const style = { ...(opts.fit ? { fit: { enabled: true } } : {}), ...(opts.style ?? {}) };
  const meta = { options: { abnormalSummary: true, specimenLine: true }, ...(Object.keys(style).length ? { reportStyle: { v: 1, ...style } } : {}) };
  return {
    report: { id: 'r-long-1', type: 'final', createdAt: '2026-09-29T09:15:00Z', data: JSON.stringify(longNameSnapshot()) },
    template: richTemplate({
      labName: LONG_LAB,
      address: '14 Gandhi Road, T. Nagar, Chennai 600017, Tamil Nadu, India (opposite the Government Hospital, near the Metro station)',
      metadata: JSON.stringify(meta), ...(opts.patch ?? {}),
    }),
    resolvedLayouts: LONG_LAYOUTS,
    imageCache: { '/uploads/logo.png': PNG_1x1 },
    publicBaseUrl: 'https://reports.example.test',
    trendograms: [{ title: 'Haemoglobin trend', dataUrl: PNG_1x1 }, { title: 'Total Bilirubin trend', dataUrl: PNG_1x1 }],
  };
}

/** The three patient layouts, as template patches. */
export const PATIENT_LAYOUT_PATCHES: Array<[string, Partial<ReportTemplate>]> = [
  ['three-col', {}],
  ['four-col', { patientLayout: 'four-col-grid' }],
  ['stacked', { patientLayout: 'stacked' }],
  ['columns', { patientColumnsJson: JSON.stringify([['name', 'age', 'sex', 'mrn', 'phone'], ['specimen', 'refdoctor', 'refhospital', 'branch', 'collectedby', 'orderid'], ['barcode', 'registered', 'collected', 'reported']]) }],
];
