/**
 * Pharmacy print — the patient's medicine sheet + bill as a PDF, the app's
 * PDF approach (jsPDF + autotable, the shared text sanitiser, the shared
 * off-screen print iframe). One A5 page per sale: the plain-language
 * instructions (rx-schedule sayRx), the 14-day dose-pattern strip for
 * non-daily schedules, then the bill (BillMath totals from the server).
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { installPdfTextSanitizer } from '../../../shared/utils/pdf-text';
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import type { BillView, DispenseLineView } from './pharmacy.api';
import type { InstructionLine } from './pharmacy-instructions';

export interface PharmacyPrintInput {
  clinic: string;
  title?: string;
  patientName: string;
  patientMeta?: string | null;
  doctor?: string | null;
  doctorRegNo?: string | null;
  number?: string | null;
  at?: Date;
  instructions: InstructionLine[];
  lines: DispenseLineView[];
  bill?: BillView | null;
}

const rs = (n: number) => 'Rs. ' + (Number(n) || 0).toFixed(2);

/** Build the PDF document (exported for tests). */
export function buildPharmacyPdf(input: PharmacyPrintInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  installPdfTextSanitizer(doc);
  const W = doc.internal.pageSize.getWidth();
  const M = 10;
  let y = 12;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(input.clinic, M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(input.title ?? 'Your medicines and how to take them', M, (y += 5));
  if (input.number) doc.text(input.number, W - M, 12, { align: 'right' });
  doc.text((input.at ?? new Date()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), W - M, 17, { align: 'right' });
  y += 6;
  doc.setDrawColor(200); doc.line(M, y, W - M, y);
  y += 5;
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(input.patientName + (input.patientMeta ? '  ' : ''), M, y);
  if (input.patientMeta) { doc.setFont('helvetica', 'normal'); doc.text(input.patientMeta, M + doc.getTextWidth(input.patientName + '  '), y); }
  if (input.doctor) { doc.setFont('helvetica', 'normal'); doc.text(input.doctor + (input.doctorRegNo ? ' · Reg. ' + input.doctorRegNo : ''), W - M, y, { align: 'right' }); }
  y += 4;

  // Instructions (one row each; non-daily lines get a 14-day strip under the words).
  if (input.instructions.length) autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['#', 'Medicine', 'How to take it']],
    body: input.instructions.map((l, i) => [String(i + 1), l.name, l.say + (l.strip ? '\n' : '')]),
    styles: { fontSize: 9, cellPadding: 1.8, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: [245, 243, 255], textColor: 40, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 38, fontStyle: 'bold' } },
    rowPageBreak: 'avoid',
    didDrawCell: data => {
      const line = input.instructions[data.row.index];
      if (data.section !== 'body' || data.column.index !== 2 || !line?.strip) return;
      // The strip: 14 small boxes; filled = a dose day (count inside), dash = off day, blank = after the course.
      const size = 3.6, gap = 0.6;
      const x0 = data.cell.x + 1.8;
      const y0 = data.cell.y + data.cell.height - size - 1.4;
      line.strip.forEach((c, k) => {
        const x = x0 + k * (size + gap);
        doc.setDrawColor(170);
        if (c.day && c.day.n > 0) { doc.setFillColor(124, 58, 237); doc.rect(x, y0, size, size, 'F'); doc.setTextColor(255); }
        else { doc.rect(x, y0, size, size); doc.setTextColor(120); }
        doc.setFontSize(6);
        doc.text(c.day == null ? '' : c.day.n === 0 ? '-' : String(c.day.n), x + size / 2, y0 + size - 1, { align: 'center' });
        doc.setTextColor(0);
      });
    },
    didParseCell: data => {
      const line = input.instructions[data.row.index];
      if (data.section === 'body' && data.column.index === 2 && line?.strip) data.cell.styles.minCellHeight = 13;
    },
  });
  if (input.instructions.length) y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  // Bill.
  if (input.lines.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Item', 'Batch · Exp', 'Qty', 'MRP', 'Amount']],
      body: input.lines.map(l => [l.drugName, `${l.batchNo} · ${l.expiryDate.slice(5, 7)}/${l.expiryDate.slice(0, 4)}`, String(l.qty), rs(l.mrp), rs(l.total)]),
      styles: { fontSize: 8.5, cellPadding: 1.5 },
      headStyles: { fillColor: [245, 245, 245], textColor: 40 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      rowPageBreak: 'avoid',
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  }
  const b = input.bill;
  if (b) {
    const rows: [string, string][] = [['Taxable value', rs(b.totalTaxable)]];
    if (b.discount > 0) rows.unshift(['Discount', '- ' + rs(b.discount)]);
    rows.push(['GST (CGST ' + rs(b.totalCgst) + ' + SGST ' + rs(b.totalSgst) + ')', rs(b.totalTax)]);
    if (b.roundOff) rows.push(['Round-off', (b.roundOff > 0 ? '+ ' : '- ') + rs(Math.abs(b.roundOff))]);
    rows.push(['Total', rs(b.totalPayable)]);
    rows.push(['Paid', rs(b.totalPaid)]);
    doc.setFontSize(9);
    for (const [k, v] of rows) {
      const bold = k === 'Total';
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.text(k, W - M - 60, y); doc.text(v, W - M, y, { align: 'right' });
      y += 4.5;
    }
    if (b.invoiceNumber) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Invoice ' + b.invoiceNumber + ' · MRP includes GST', M, y); }
  }
  return doc;
}

/** Print (off-screen iframe, the app's shared helper). */
export function printPharmacySheet(input: PharmacyPrintInput): void {
  const doc = buildPharmacyPdf(input);
  printPdfBlobUrl(doc.output('bloburl') as unknown as string, { revokeOnDone: true });
}
