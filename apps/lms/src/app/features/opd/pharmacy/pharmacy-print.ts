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
import { numberToWordsINR } from '../../frontdesk/billing/invoice-pdf';
import type { BillView, DispenseLineView, PharmacyInvoiceHeader } from './pharmacy.api';
import type { InstructionLine } from './pharmacy-instructions';
import { taxableFromMrp } from './pharmacy-math';

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
  /** night/money (critic item #4): the GST tax invoice letterhead — name /
   *  address / phone off the branch, GSTIN off the branch's GST config (the
   *  ONE GST home). When given, the bill section prints as a proper tax
   *  invoice: letterhead + drug-licence line, amount in words, a pharmacist
   *  sign line. Omit it for the plain "instructions only" print. */
  practice?: PharmacyInvoiceHeader | null;
  /** A4 or A5 (default A5, the counter/dispense print size). */
  format?: 'a4' | 'a5';
}

const rs = (n: number) => 'Rs. ' + (Number(n) || 0).toFixed(2);

/** A line's taxable value + CGST/SGST split, derived from its (post-discount,
 *  GST-inclusive) total the SAME way the server extracts tax from an
 *  inclusive MRP (`taxableFromMrp` — never a second tax rule). */
export function lineTaxSplit(l: Pick<DispenseLineView, 'total' | 'taxSlab'>): { taxable: number; cgst: number; sgst: number } {
  const taxable = taxableFromMrp(l.total, l.taxSlab ?? 0);
  const half = Math.round((l.total - taxable) * 50) / 100;
  return { taxable, cgst: half, sgst: half };
}

/** "Generic (Brand) strength form" — generic first, NMC 2002 Reg 1.5
 *  (critic #8). Falls back to the brand alone when there is no generic. */
export function itemLabel(l: Pick<DispenseLineView, 'drugName' | 'generic' | 'strength' | 'form'>): string {
  if (!l.generic) return l.drugName + (l.strength ? ' ' + l.strength : '') + ' ' + l.form;
  return `${l.generic} (${l.drugName}) ${l.strength ? l.strength + ' ' : ''}${l.form}`;
}

/** Build the PDF document (exported for tests). */
export function buildPharmacyPdf(input: PharmacyPrintInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: input.format ?? 'a5' });
  installPdfTextSanitizer(doc);
  const W = doc.internal.pageSize.getWidth();
  const M = 10;
  let y = 12;
  const p = input.practice;
  const isTaxInvoice = !!p && !!input.bill;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(input.clinic, M, y);
  if (isTaxInvoice) { doc.setFontSize(9); doc.text('TAX INVOICE', W - M, y, { align: 'right' }); }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(input.title ?? 'Your medicines and how to take them', M, (y += 5));
  if (input.number) doc.text(input.number, W - M, 12, { align: 'right' });
  doc.text((input.at ?? new Date()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), W - M, 17, { align: 'right' });
  y += 6;
  // The letterhead (critic item #4): address / phone / GSTIN off the branch
  // (the ONE GST home); no drug-licence field exists anywhere yet, so a
  // clearly-marked placeholder prints instead of inventing one.
  if (p) {
    doc.setFontSize(8); doc.setTextColor(90);
    const bits = [p.address, p.phone ? 'Ph: ' + p.phone : null, p.gstin ? 'GSTIN: ' + p.gstin : null].filter(Boolean).join('  ·  ');
    if (bits) doc.text(bits, M, y);
    doc.text('Drug Licence No.: [not on file — add under Branch settings]', M, (y += 4));
    doc.setTextColor(0);
    y += 3;
  }
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

  // Bill — generic-first (critic #8 / NMC 2002 Reg 1.5): "Generic (Brand)
  // strength form", batch, expiry MM/YY, qty, MRP, GST%; a substituted line
  // says what was actually prescribed.
  if (input.lines.length) {
    // A tax invoice needs HSN + the per-line taxable / CGST / SGST split
    // (critic item #4); the plain instructions sheet keeps the shorter GST% column.
    const head = isTaxInvoice
      ? [['Item', 'HSN', 'Batch · Exp', 'Qty', 'MRP', 'Taxable', 'CGST', 'SGST', 'Amount']]
      : [['Item', 'Batch · Exp', 'Qty', 'MRP', 'GST%', 'Amount']];
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head,
      body: input.lines.map(l => {
        const item = itemLabel(l) + (l.rxDrugName ? `\nSubstituted for ${l.rxDrugName}` : '');
        const batchExp = `${l.batchNo} · ${l.expiryDate.slice(5, 7)}/${l.expiryDate.slice(0, 4)}`;
        if (isTaxInvoice) {
          const t = lineTaxSplit(l);
          return [item, l.hsnCode || '—', batchExp, String(l.qty), rs(l.mrp), rs(t.taxable), rs(t.cgst), rs(t.sgst), rs(l.total)];
        }
        return [item, batchExp, String(l.qty), rs(l.mrp), `${l.taxSlab ?? 0}%`, rs(l.total)];
      }),
      styles: { fontSize: isTaxInvoice ? 7.5 : 8.5, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [245, 245, 245], textColor: 40 },
      columnStyles: isTaxInvoice
        ? { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } }
        : { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      rowPageBreak: 'avoid',
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  }
  const b = input.bill;
  if (b) {
    const rows: [string, string][] = [['Taxable value', rs(b.totalTaxable)]];
    if (b.discount > 0) rows.unshift(['Discount', '- ' + rs(b.discount)]);
    rows.push(isTaxInvoice
      ? ['CGST', rs(b.totalCgst)]
      : ['GST (CGST ' + rs(b.totalCgst) + ' + SGST ' + rs(b.totalSgst) + ')', rs(b.totalTax)]);
    if (isTaxInvoice) rows.push(['SGST', rs(b.totalSgst)]);
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
    if (isTaxInvoice) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8);
      doc.text(`(Amount in words: Rupees ${numberToWordsINR(Math.round(b.totalPayable))} Only)`, M, (y += 3), { maxWidth: W - 2 * M });
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.text('Pharmacist\'s signature: ______________________', W - M - 70, (y += 6));
    }
    if (b.invoiceNumber) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text('Invoice ' + b.invoiceNumber + ' · MRP includes GST', M, y);
    }
  }
  return doc;
}

/** Print (off-screen iframe, the app's shared helper). */
export function printPharmacySheet(input: PharmacyPrintInput): void {
  const doc = buildPharmacyPdf(input);
  printPdfBlobUrl(doc.output('bloburl') as unknown as string, { revokeOnDone: true });
}
