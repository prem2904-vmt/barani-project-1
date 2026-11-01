import type { ResolvedReportLayout } from '../models/report-layout.model';
import type { ReportSignature } from '../models/report.model';
import { buildReportPdfWithLayout, type ReportPdfInput } from './report-pdf';
import { describeOverlap, findOverlaps, recordDrawing, type DrawnBox } from './report-overlap-detector';
import { PNG_1x1, RICH_COLUMNS, richSnapshot, richTemplate } from './report-theme.spec-helpers';

/**
 * Fixtures of the signature space decider (phase 6). A NON-spec module on
 * purpose (see report-header-legacy.spec-helpers.ts): `departments` named
 * departments of `perDept` single-analyte tests each, signed by the first `n`
 * of seven fixed people - the people are shared between departments, so
 * "one user signs two departments" is the normal case here.
 */

export const SIGNERS: ReportSignature[] = [
  { name: 'Arun Kumar', title: 'Lab Technician', regNo: 'TN-LT-4412' },
  { name: 'Dr. Meena Iyer', title: 'MD Biochemistry', regNo: 'TNMC 88213' },
  { name: 'Dr. Ravi Shankar', title: 'MD Pathology', regNo: 'TNMC 70441' },
  { name: 'Priya Natarajan', title: 'Senior Technologist', regNo: 'TN-LT-5590' },
  { name: 'Dr. S. Lakshmi', title: 'DNB Microbiology', regNo: 'TNMC 66120' },
  { name: 'Karthik Subramanian', title: 'Quality Manager', regNo: 'QM-114' },
  { name: 'Dr. Anand Rajan', title: 'Lab Director', regNo: 'TNMC 51207' },
];
export const DEPTS = ['Biochemistry', 'Haematology', 'Serology'];

export const withImage = (s: ReportSignature): ReportSignature => ({ ...s, signatureUrl: PNG_1x1 });

const layout = (id: string, name: string, dept: string): ResolvedReportLayout => ({
  testId: id, testName: name, departmentName: dept, columns: RICH_COLUMNS, configured: true,
  sections: [{ id: `${id}-g`, type: 'grid', order: 1, isVisible: true,
    rows: [{ id: `r-${id}`, parameterName: name, title: name, isMerged: false, isBold: false, unit: 'mg/dL',
             cells: { name, result: '42', unit: 'mg/dL', range: '10 – 90' } }] }],
} as unknown as ResolvedReportLayout);

export interface SigFixture {
  /** Signatories per department (the first n of SIGNERS; with images when `images`). */
  n?: number;
  departments?: number;
  perDept?: number;
  images?: boolean;
  /** `reportStyle.signatures` overrides. */
  signatures?: Record<string, unknown>;
  /** Other reportStyle keys. */
  style?: Record<string, unknown>;
  blankLetterhead?: boolean;
  templatePatch?: Record<string, unknown>;
  /** Template-level signatories (the every-page placement's report-level list). */
  templateSigs?: ReportSignature[];
}

export function sigInput(f: SigFixture = {}): ReportPdfInput {
  const nDept = f.departments ?? 1, per = f.perDept ?? 3, n = f.n ?? 2;
  const depts = DEPTS.slice(0, nDept);
  const base = richSnapshot() as { patient: unknown; order: unknown };
  const tests: Array<Record<string, unknown>> = [];
  const layouts: Record<string, ResolvedReportLayout> = {};
  depts.forEach((d, di) => {
    for (let i = 0; i < per; i++) {
      const id = `t${di}-${i}`, name = `Analyte ${di + 1}.${i + 1}`;
      tests.push({ testId: id, name, department: d, sampleType: 'Serum', sampleId: '26001', status: 'validated', method: 'Photometry',
        validatedAt: '2026-09-29T09:45:00', result: { values: { [name]: { value: '42', unit: 'mg/dL', range: '10 – 90', flag: 'N' } } } });
      layouts[id] = layout(id, name, d);
    }
  });
  const sigs = SIGNERS.slice(0, n).map(s => (f.images ? withImage(s) : s));
  const snap = {
    patient: base.patient, order: base.order, type: 'final', tests,
    deptSignatures: depts.map(d => ({ department: d, signatures: sigs })),
  };
  const meta: Record<string, unknown> = { options: { specimenLine: true } };
  const style = { ...(f.style ?? {}), ...(f.signatures ? { signatures: f.signatures } : {}) };
  if (Object.keys(style).length) meta['reportStyle'] = { v: 1, ...style };
  return {
    report: { id: 'r-sig-1', type: 'final', createdAt: '2026-09-29T09:15:00', data: JSON.stringify(snap) },
    template: richTemplate({
      metadata: JSON.stringify(meta),
      ...(f.templateSigs ? { signaturesJson: JSON.stringify(f.templateSigs) } : {}),
      ...(f.templatePatch ?? {}),
    } as never),
    resolvedLayouts: layouts,
    imageCache: { '/uploads/logo.png': PNG_1x1 },
    publicBaseUrl: 'https://reports.example.test',
    ...(f.blankLetterhead ? { blankLetterhead: true } : {}),
  };
}

/** Render with the draw recorder on: the document, every drawn box (top-down y), the overlaps. */
export function renderSig(input: ReportPdfInput) {
  let rec: ReturnType<typeof recordDrawing> | null = null;
  const built = buildReportPdfWithLayout({ ...input, drawRecorder: d => { rec = recordDrawing(d); } });
  const boxes: DrawnBox[] = rec!.boxes;
  return { ...built, boxes, pages: built.doc.getNumberOfPages(), overlaps: findOverlaps(boxes).map(describeOverlap) };
}

export const namesOf = (boxes: DrawnBox[], n = SIGNERS.length) =>
  SIGNERS.slice(0, n).map(s => ({ name: s.name!, at: boxes.filter(b => b.kind === 'text' && b.text === s.name) }));
