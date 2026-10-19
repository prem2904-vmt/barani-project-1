import type { ReportColumn, ResolvedReportLayout, ResolvedRow } from '../models/report-layout.model';
import type { ReportTemplate } from '../models/report.model';
import type { ReportPdfInput } from './report-pdf';

/**
 * A RICH multi-department report used by the report-theme specs (typography
 * read-back, Classic fingerprint, sample renders): a biochemistry PROFILE with
 * an abnormal value + an interpretation Sentence, a compact single-analyte
 * test with a method line and a ≥ / ≤ range, a CBC with a tech "print in
 * bold" value and ×10⁹/L units, a multi-band (qualified) reference range, a
 * value description row, a tech observation, a microbiology culture with AST,
 * a narrative (paragraph) test, per-department signatories, the abnormal
 * summary sheet, disclaimer + footer text. Long enough for 2+ pages.
 *
 * A NON-spec module on purpose (see report-header-legacy.spec-helpers.ts).
 */

export const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const col = (name: string, label: string, type: string, order: number, width: number, linkedNext = false): ReportColumn =>
  ({ id: `c-${name}`, name, label, order, width, type, locked: false, ...(linkedNext ? { linkedNext: true } : {}) } as ReportColumn);

/** Investigation · Result+Unit (linked) · Unit · Reference range — the usual department set. */
export const RICH_COLUMNS: ReportColumn[] = [
  col('name', 'Investigation', 'name', 0, 36),
  col('result', 'Result', 'result', 1, 18, true),
  col('unit', 'Unit', 'unit', 2, 12),
  col('range', 'Reference Range', 'range', 3, 34),
];

type Val = { value: string; unit?: string; range?: string; flag?: string; description?: string };

function row(name: string, v: Val, extra: Partial<ResolvedRow> = {}): ResolvedRow {
  return {
    id: `r-${name}`, parameterName: name, title: name, isMerged: false, isBold: false, unit: v.unit,
    cells: { name, result: v.value, unit: v.unit ?? '', range: v.range ?? '', ...(v.description ? { description: v.description } : {}) },
    ...extra,
  } as ResolvedRow;
}

function gridLayout(testId: string, testName: string, dept: string, values: Record<string, Val>,
                    more: Partial<ResolvedReportLayout> = {}, sentences: Array<{ label: string; content: string }> = []): ResolvedReportLayout {
  return {
    testId, testName, departmentName: dept, columns: RICH_COLUMNS, configured: true,
    sections: [
      { id: `${testId}-g`, type: 'grid', order: 1, isVisible: true,
        rows: Object.entries(values).map(([n, v]) => row(n, v)) },
      ...sentences.map((s, i) => ({ id: `${testId}-p${i}`, type: 'paragraph', order: 2 + i, isVisible: true, label: s.label, content: s.content })),
    ],
    ...more,
  } as unknown as ResolvedReportLayout;
}

// ── Biochemistry — Liver Function Test (a PROFILE) ─────────────────
const LFT: Record<string, Record<string, Val>> = {
  bil: { 'Total Bilirubin': { value: '0.8', unit: 'mg/dL', range: '0.3 – 1.2', flag: 'N' } },
  alt: { 'SGPT (ALT)': { value: '96', unit: 'U/L', range: '≤ 41', flag: 'H' } },
  ast: { 'SGOT (AST)': { value: '38', unit: 'U/L', range: '≤ 40', flag: 'N' } },
  alp: { 'Alkaline Phosphatase': { value: '104', unit: 'U/L', range: '40 – 129', flag: 'N',
                                   description: 'Enzyme mostly from liver and bone; raised in cholestasis and bone growth.' } },
  alb: { 'Albumin': { value: '3.1', unit: 'g/dL', range: '3.5 – 5.2', flag: 'L' } },
};

// ── Biochemistry — Fasting glucose (compact single analyte) ─────────
const GLU: Record<string, Val> = {
  'Glucose, Fasting (FBS)': { value: '132', unit: 'mg/dL', flag: 'H',
    range: 'Normal: 70 – 99\nPrediabetes: 100 – 125\nDiabetes: ≥ 126' },
};

// ── Haematology — Complete Blood Count ─────────────────────────────
const CBC: Record<string, Val> = {
  'Haemoglobin': { value: '13.8', unit: 'g/dL', range: '13.0 – 17.0', flag: 'N' },
  'Total Leucocyte Count': { value: '7.9', unit: '×10⁹/L', range: '4.0 – 10.0', flag: 'N' },
  'Platelet Count': { value: '182', unit: '×10⁹/L', range: '150 – 410', flag: 'N' },
  'RBC Count': { value: '4.62', unit: '×10¹²/L', range: '4.5 – 5.5', flag: 'N' },
  'Haematocrit (PCV)': { value: '41.2', unit: '%', range: '40 – 50', flag: 'N' },
  'MCV': { value: '89.2', unit: 'fL', range: '83 – 101', flag: 'N' },
  'MCH': { value: '29.9', unit: 'pg', range: '27 – 32', flag: 'N' },
  'MCHC': { value: '33.5', unit: 'g/dL', range: '31.5 – 34.5', flag: 'N' },
  'RDW-CV': { value: '13.1', unit: '%', range: '11.6 – 14.0', flag: 'N' },
  'Neutrophils': { value: '62', unit: '%', range: '40 – 80', flag: 'N' },
  'Lymphocytes': { value: '28', unit: '%', range: '20 – 40', flag: 'N' },
  'Eosinophils': { value: '7', unit: '%', range: '1 – 6', flag: 'H' },
  'Monocytes': { value: '3', unit: '%', range: '2 – 10', flag: 'N' },
  'ESR': { value: '12', unit: 'mm/hr', range: '0 – 15', flag: 'N' },
  'Mean Platelet Volume with an unusually long parameter name that must wrap inside its column': {
    value: '10.4', unit: 'fL', range: '7.5 – 11.5', flag: 'N' },
};

// ── Thyroid (compact, micro-unit µIU/mL) ───────────────────────────
const TSH: Record<string, Val> = {
  'TSH (Thyroid Stimulating Hormone)': { value: '5.9', unit: 'µIU/mL', range: '0.27 – 4.20', flag: 'H' },
};

export const RICH_LAYOUTS: Record<string, ResolvedReportLayout> = {
  bil: gridLayout('bil', 'Total Bilirubin', 'Biochemistry', LFT['bil']),
  alt: gridLayout('alt', 'SGPT (ALT)', 'Biochemistry', LFT['alt']),
  ast: gridLayout('ast', 'SGOT (AST)', 'Biochemistry', LFT['ast']),
  alp: gridLayout('alp', 'Alkaline Phosphatase', 'Biochemistry', LFT['alp']),
  alb: gridLayout('alb', 'Albumin', 'Biochemistry', LFT['alb']),
  lft: gridLayout('lft', 'Liver Function Test', 'Biochemistry', {}, {}, [
    { label: 'Interpretation', content: 'Raised ALT with low albumin suggests hepatocellular injury. Correlate clinically and repeat in 2 weeks; ₹ 350 re-test offer applies. Temperature noted 37.2 °C.' },
  ]),
  glu: gridLayout('glu', 'Glucose, Fasting (FBS)', 'Biochemistry', GLU),
  tsh: gridLayout('tsh', 'TSH (Thyroid Stimulating Hormone)', 'Biochemistry', TSH),
  cbc: gridLayout('cbc', 'Complete Blood Count', 'Haematology', CBC),
  pbs: {
    testId: 'pbs', testName: 'Peripheral Smear Examination', departmentName: 'Haematology', columns: [], configured: true,
    valuesInNarrative: true,
    sections: [
      { id: 'pbs-p1', type: 'paragraph', order: 1, isVisible: true, label: 'RBC',
        content: 'RBC: Predominantly normocytic normochromic. No haemoparasites seen.' },
      { id: 'pbs-p2', type: 'paragraph', order: 2, isVisible: true, label: 'Impression',
        content: 'Impression: Mild eosinophilia. Clinical correlation is advised.' },
    ],
  } as unknown as ResolvedReportLayout,
};

const sig = (name: string, title: string, regNo: string) => ({ name, title, regNo });

export function richSnapshot(): Record<string, unknown> {
  const member = (id: string, name: string, values: Record<string, Val>) => ({
    testId: id, name, department: 'Biochemistry', sampleType: 'Serum', sampleId: '26001',
    packageTestId: 'lft', packageName: 'Liver Function Test', packageType: 'profile',
    status: 'validated', method: id === 'alt' || id === 'ast' ? 'IFCC without P5P' : 'Photometry',
    result: { values },
  });
  return {
    patient: { id: 'p1', displayName: 'Lakshmi Narayanan Venkataraman', age: 46, sex: 'Female', phone: '9840012345', mrn: 'CHN-2609-004217-3' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000142', createdAt: '2026-09-29T03:40:00Z',
             refDoctorName: 'Dr. R. Subramanian, MD', branchName: 'Anna Nagar', collectedBy: 'Priya S', trackToken: 'tok123' },
    type: 'final',
    tests: [
      member('bil', 'Total Bilirubin', LFT['bil']),
      member('alt', 'SGPT (ALT)', LFT['alt']),
      member('ast', 'SGOT (AST)', LFT['ast']),
      member('alp', 'Alkaline Phosphatase', LFT['alp']),
      member('alb', 'Albumin', LFT['alb']),
      { testId: 'glu', name: 'Glucose, Fasting (FBS)', department: 'Biochemistry', sampleType: 'Fluoride Plasma', sampleId: '26002',
        status: 'validated', method: 'Hexokinase', result: { values: GLU }, observations: ['Sample slightly haemolysed.'] },
      { testId: 'tsh', name: 'TSH (Thyroid Stimulating Hormone)', department: 'Biochemistry', sampleType: 'Serum', sampleId: '26001',
        status: 'validated', method: 'CLIA', result: { values: TSH } },
      { testId: 'cbc', name: 'Complete Blood Count', department: 'Haematology', sampleType: 'EDTA Whole Blood', sampleId: '26003',
        status: 'validated', method: 'Flow cytometry / Impedance',
        result: { values: CBC, bold: ['Haemoglobin'] } },
      { testId: 'pbs', name: 'Peripheral Smear Examination', department: 'Haematology', sampleType: 'EDTA Whole Blood', sampleId: '26003',
        status: 'validated', result: { values: {} } },
      { testId: 'cs1', name: 'Urine Culture & Sensitivity', department: 'Microbiology', sampleType: 'Urine', sampleId: '26004',
        status: 'validated',
        result: { microFormat: 'culture_sensitivity', note: 'Significant bacteriuria.', values: {
          specimen: 'Mid-stream urine', gramStain: 'Gram negative bacilli seen', colonyCount: '> 10⁵ CFU/mL',
          organisms: [{ name: 'Escherichia coli', antibiotics: [
            { name: 'Amikacin', interpretation: 'S' }, { name: 'Ciprofloxacin', interpretation: 'R' },
            { name: 'Nitrofurantoin', interpretation: 'S' }, { name: 'Ceftriaxone', interpretation: 'I' },
            { name: 'Meropenem', interpretation: 'S' }, { name: 'Co-trimoxazole', interpretation: 'R' },
          ] }],
          resistancePattern: 'ESBL producer',
          clinicalNotes: 'Treat as per sensitivity; repeat culture after therapy.',
        } } },
    ],
    deptSignatures: [
      { department: 'Biochemistry', signatures: [sig('Arun Kumar', 'Lab Technician', 'TN-LT-4412'), sig('Dr. Meena Iyer', 'MD Biochemistry', 'TNMC 88213')] },
      { department: 'Haematology', signatures: [sig('Kavya R', 'Lab Technician', 'TN-LT-5120'), sig('Dr. S. Balaji', 'MD Pathology', 'TNMC 70455')] },
      { department: 'Microbiology', signatures: [sig('Dr. Farah Khan', 'MD Microbiology', 'TNMC 91022')] },
    ],
  };
}

export function richTemplate(patch: Partial<ReportTemplate> = {}): ReportTemplate {
  return {
    id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
    address: '14 Gandhi Road, T. Nagar, Chennai 600017', phone: '+91 98400 12345', email: 'lab@microworld.in',
    website: 'www.microworld.in', logoUrl: '/uploads/logo.png',
    nablAccredited: true, nablNumber: 'MC-1234', nablLogoUrl: '',
    headerPreset: 'classic', logoPosition: 'left', logoSize: 'md', topAccentBar: true,
    primaryColor: '#1B3A6B', accentColor: '#0066CC', fontFamily: 'helvetica', fontSize: 'md',
    showPatientName: true, showAge: true, showRefDoctor: true, showOrderId: true, showAbhaId: false,
    showQrCode: true, showCollectionDate: true, showReportDate: true, showMethod: true,
    showInstrument: false, groupByDepartment: true, showCriticalFlag: true,
    showPathologistName: true, showSignature: true, showPoweredBy: true,
    footerText: 'Reg. No. TN/1234 · GSTIN 33ABCDE1234F1Z5',
    metadata: JSON.stringify({ options: { abnormalSummary: true, specimenLine: true } }),
    ...patch,
  } as ReportTemplate;
}

export function richInput(patch: Partial<ReportTemplate> = {}, snapPatch: Record<string, unknown> = {}): ReportPdfInput {
  return {
    report: { id: 'r-rich-1', type: 'final', createdAt: '2026-09-29T09:15:00Z',
              data: JSON.stringify({ ...richSnapshot(), ...snapPatch }) },
    template: richTemplate(patch),
    resolvedLayouts: RICH_LAYOUTS,
    imageCache: { '/uploads/logo.png': PNG_1x1 },
    publicBaseUrl: 'https://reports.example.test',
  };
}

/** Classic-fingerprint matrix: the rich body under every patient-block
 *  layout and the flag styles — the body elements the header golden does
 *  not reach. Name → template patch. */
export function classicBodyMatrix(): Array<[string, Partial<ReportTemplate>]> {
  return [
    ['three-col', {}],
    ['four-col', { patientLayout: 'four-col-grid' }],
    ['stacked', { patientLayout: 'stacked', showAbhaId: true }],
    ['columns', { patientColumnsJson: JSON.stringify([['name', 'age', 'sex', 'mrn', 'phone'], ['specimen', 'refdoctor', 'refhospital', 'branch', 'collectedby', 'orderid'], ['barcode', 'registered', 'collected', 'reported', 'profile_qr']]) }],
    ['arrow-color', { flagIndicator: 'arrow', flagStyle: 'bold_color' }],
    ['none-flag-zebra', { flagIndicator: 'none', tableStyle: 'bordered', zebraRows: true }],
    ['font-lg-times', { fontSize: 'lg', fontFamily: 'times' }],
    ['font-sm-courier', { fontSize: 'sm', fontFamily: 'courier', departmentPageBreak: true }],
    ['centered', { headerPreset: 'centered', watermarkText: 'SAMPLE' }],
    ['banner', { headerPreset: 'banner' }],
    ['minimal', { headerPreset: 'minimal', showSampleCollectionBand: false }],
    ['no-summary', { metadata: null, showMethod: false, groupByDepartment: false }],
  ];
}

export function stripVolatile(pdf: string): string {
  return pdf.replace(/\/CreationDate \([^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');
}
