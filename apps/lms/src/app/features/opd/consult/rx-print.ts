import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { installPdfTextSanitizer } from '../../../shared/utils/pdf-text';
import type { OpdDiagnosis } from '../shared/opd.models';
import { lineShort, qtyWords, sayRx } from '../shared/rx-schedule';
import type { ConsultRxLine } from './rx/rx-model';

/**
 * The consult summary / prescription printout (Agent C) — the app's existing
 * PDF approach (jsPDF + jspdf-autotable, the cp1252 sanitiser from
 * shared/utils/pdf-text), letterhead from the tenant's invoice-template config
 * (name / address / phone) when readable. NEVER prints private notes.
 * Pure function of its input: the page gathers the data.
 */
export interface RxPrintInput {
  practice: { name?: string; address?: string; phone?: string; email?: string };
  patient: { name: string; ageSex?: string | null; mrn?: string | null; phone?: string | null };
  doctor: { name?: string | null; regNo?: string | null; department?: string | null };
  visit: { date: Date; token?: number | string | null; visitNumber?: string | null };
  vitals?: string | null;
  chiefComplaint?: string | null;
  diagnoses: OpdDiagnosis[];
  lines: ConsultRxLine[];
  tests: { name: string }[];
  advice?: string | null;
  followUp?: string | null;
  lang?: string;
}

const MARGIN = 40;

/** Rows of the medicine table: n · medicine · how (shorthand) · qty, plus the patient sentence. */
export function rxPrintRows(lines: readonly ConsultRxLine[], start: Date, lang = 'en'): string[][] {
  return lines.map((l, i) => [
    String(i + 1),
    l.drug.name + (l.drug.generic ? `\n${l.drug.generic}` : ''),
    lineShort(l.line, l.drug, lang) + '\n' + sayRx(l.line, l.drug, lang),
    qtyWords(l.line, l.drug, start),
  ]);
}

export function buildRxPdf(inp: RxPrintInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  installPdfTextSanitizer(doc);
  const W = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  // Letterhead
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor('#0f172a');
  doc.text(inp.practice.name || 'Clinic', MARGIN, y); y += 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor('#64748b');
  const contact = [inp.practice.address, inp.practice.phone, inp.practice.email].filter(Boolean).join('  ·  ');
  if (contact) { doc.text(doc.splitTextToSize(contact, W - 2 * MARGIN), MARGIN, y); y += 12; }
  doc.setDrawColor('#e2e8f0'); doc.line(MARGIN, y, W - MARGIN, y); y += 18;

  // Doctor + patient block
  doc.setTextColor('#0f172a'); doc.setFontSize(10.5); doc.setFont('helvetica', 'bold');
  doc.text(inp.doctor.name || 'Doctor', MARGIN, y);
  doc.text(inp.patient.name, W / 2, y);
  y += 13; doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor('#475569');
  doc.text([inp.doctor.department, inp.doctor.regNo ? 'Reg. No. ' + inp.doctor.regNo : null].filter(Boolean).join(' · ') || ' ', MARGIN, y);
  doc.text([inp.patient.ageSex, inp.patient.mrn].filter(Boolean).join(' · ') || ' ', W / 2, y);
  y += 12;
  const when = inp.visit.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.text([when, inp.visit.token != null ? 'Token ' + inp.visit.token : null, inp.visit.visitNumber].filter(Boolean).join(' · '), W / 2, y);
  y += 18;

  const block = (label: string, text: string | null | undefined) => {
    if (!text) return;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor('#64748b');
    doc.text(label.toUpperCase(), MARGIN, y); y += 12;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#0f172a');
    const wrapped = doc.splitTextToSize(text, W - 2 * MARGIN) as string[];
    doc.text(wrapped, MARGIN, y); y += wrapped.length * 12 + 8;
  };
  block('Vitals', inp.vitals);
  block('Complaint', inp.chiefComplaint);
  block('Diagnosis', inp.diagnoses.map(d => d.label + (d.code ? ` (${d.code})` : '')).join(', '));

  if (inp.lines.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor('#0f172a');
    doc.text('Rx', MARGIN, y + 4); y += 12;
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['#', 'Medicine', 'How to take', 'Qty']],
      body: rxPrintRows(inp.lines, inp.visit.date, inp.lang),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: '#0f172a', lineColor: '#e2e8f0', valign: 'top' },
      headStyles: { fillColor: '#f1f5f9', textColor: '#334155', fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 150 }, 3: { cellWidth: 70 } },
      rowPageBreak: 'avoid',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 16;
  }
  block('Investigations', inp.tests.map(t => t.name).join(', '));
  block('Advice', inp.advice);
  block('Follow-up', inp.followUp);

  // Signature
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 90) { doc.addPage(); y = MARGIN; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor('#0f172a');
  doc.text(inp.doctor.name || '', W - MARGIN, pageH - 60, { align: 'right' });
  doc.setTextColor('#64748b'); doc.setFontSize(8.5);
  doc.text('Signature', W - MARGIN, pageH - 48, { align: 'right' });
  return doc;
}
