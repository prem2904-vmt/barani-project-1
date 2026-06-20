import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';

/**
 * Generate a properly-laid-out PDF invoice and trigger a browser
 * download. We render structured elements (header, patient block, item
 * table, totals, footer) directly with jsPDF rather than rasterising
 * the on-screen tile — that way the output is sharp, searchable,
 * paginates cleanly, and fits an A4 page regardless of viewport.
 *
 * No backend round-trip required; jsPDF is bundled client-side.
 */
export interface InvoicePdfInput {
  bill: Bill;
  order: Order | null;
  invoiceNumber: string;
  effectivePayable: number;
  tatLabel: string;
  /** Display constants for the lab letterhead. Pull from a real
   *  practice-config endpoint once we have one. */
  practice?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    gstin?: string;
  };
  /** Optional QR (PNG data URL) linking to the public result-tracking page. */
  qrDataUrl?: string;
  /** Document title — "TAX INVOICE" (default) or "BILL OF SUPPLY". */
  docTitle?: string;
}

const A4 = { w: 595.28, h: 841.89 }; // pt — jsPDF default
const MARGIN = 36;                    // ~½ inch
const ACCENT = '#8b5cf6';
const TEXT_PRIMARY = '#0f172a';
const TEXT_MUTED = '#64748b';

export function generateInvoicePdf(input: InvoicePdfInput) {
  const { bill, order, invoiceNumber, effectivePayable, tatLabel, practice = {}, qrDataUrl, docTitle } = input;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // ── Header ──────────────────────────────────────────────────
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, A4.w, 6, 'F');

  doc.setTextColor(TEXT_PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(practice.name ?? 'Prefrontal Lab', MARGIN, 50);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  const addressLines = [
    practice.address ?? '',
    [practice.phone, practice.email].filter(Boolean).join(' · '),
    practice.gstin ? `GSTIN: ${practice.gstin}` : ''
  ].filter(Boolean);
  let cursorY = 66;
  for (const line of addressLines) {
    doc.text(line, MARGIN, cursorY);
    cursorY += 12;
  }

  // Right-aligned: "INVOICE" badge + number + date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(ACCENT);
  doc.text(docTitle ?? 'TAX INVOICE', A4.w - MARGIN, 50, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_PRIMARY);
  doc.text(invoiceNumber, A4.w - MARGIN, 66, { align: 'right' });
  doc.setTextColor(TEXT_MUTED);
  doc.text(formatDate(bill.createdAt), A4.w - MARGIN, 80, { align: 'right' });

  // Divider
  doc.setDrawColor('#e2e8f0');
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 110, A4.w - MARGIN, 110);

  // ── Bill-to block ───────────────────────────────────────────
  const patient = order?.patient;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT_MUTED);
  doc.text('BILL TO', MARGIN, 130);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(TEXT_PRIMARY);
  doc.text(patient?.displayName ?? '—', MARGIN, 148);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  const patientLines: string[] = [];
  const ageSex = [patient?.age != null ? `${patient.age}y` : '', patient?.sex ?? '']
    .filter(Boolean).join(' · ');
  if (ageSex) patientLines.push(ageSex);
  if (patient?.phone) patientLines.push(`Phone: ${patient.phone}`);
  let py = 162;
  for (const line of patientLines) { doc.text(line, MARGIN, py); py += 12; }

  // ── Items table ─────────────────────────────────────────────
  const rows = bill.items.map(item => [
    item.testName,
    item.hsnSacCode ?? '—',
    formatMoney(item.price),
    item.discount > 0 ? `−${formatMoney(item.discount)}` : '—',
    `${(item.cgstRate + item.sgstRate + item.igstRate).toFixed(0)}%`,
    formatMoney(item.total)
  ]);

  autoTable(doc, {
    startY: 200,
    head: [['Test', 'HSN/SAC', 'Price', 'Discount', 'GST', 'Amount']],
    body: rows,
    margin: { left: MARGIN, right: MARGIN },
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 7, textColor: TEXT_PRIMARY },
    headStyles: {
      fillColor: '#f5f3ff',
      textColor: ACCENT,
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'left'
    },
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: { fillColor: '#fafafa' },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 65 },
      2: { cellWidth: 60, halign: 'right' },
      3: { cellWidth: 60, halign: 'right' },
      4: { cellWidth: 38, halign: 'right' },
      5: { cellWidth: 70, halign: 'right', fontStyle: 'bold' }
    }
  });

  // ── Totals (right-aligned) ──────────────────────────────────
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  const labelX = A4.w - MARGIN - 130;
  const valueX = A4.w - MARGIN;
  let ty = finalY;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Subtotal', labelX, ty);
  doc.setTextColor(TEXT_PRIMARY);
  doc.text(formatMoney(bill.subTotal), valueX, ty, { align: 'right' });
  ty += 16;

  if (bill.totalTax > 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('GST', labelX, ty);
    doc.setTextColor(TEXT_PRIMARY);
    doc.text(formatMoney(bill.totalTax), valueX, ty, { align: 'right' });
    ty += 16;
  }

  const flatDiscount = (bill.subTotal + bill.totalTax) - effectivePayable;
  if (flatDiscount > 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text('Discount', labelX, ty);
    doc.setTextColor('#059669');
    doc.text(`−${formatMoney(flatDiscount)}`, valueX, ty, { align: 'right' });
    ty += 16;
  }

  // Total bar
  ty += 4;
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(0.8);
  doc.line(labelX, ty, valueX, ty);
  ty += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(TEXT_PRIMARY);
  doc.text('Total', labelX, ty);
  doc.setTextColor(ACCENT);
  doc.text(formatMoney(effectivePayable), valueX, ty, { align: 'right' });

  // Paid / balance line below
  ty += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(TEXT_MUTED);
  doc.text(bill.balance <= 0 ? 'Paid in full' : `Balance ${formatMoney(bill.balance)}`,
           valueX, ty, { align: 'right' });

  // ── Footer ──────────────────────────────────────────────────
  if (tatLabel) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(TEXT_PRIMARY);
    doc.text(`Estimated report: ${tatLabel.replace('≈', '~').replace('to report', '').trim() || tatLabel}`,
             MARGIN, ty);
  }

  // ── Result-tracking QR (bottom-left) ────────────────────────
  if (qrDataUrl) {
    const qrSize = 70;
    const qrY = A4.h - 24 - qrSize - 14;
    try { doc.addImage(qrDataUrl, 'PNG', MARGIN, qrY, qrSize, qrSize); } catch { /* bad data url */ }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text('Scan to track your report', MARGIN, qrY + qrSize + 10);
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('This is a computer-generated invoice. No physical signature required.',
           A4.w / 2, A4.h - 24, { align: 'center' });

  // ── Save ────────────────────────────────────────────────────
  doc.save(`${invoiceNumber}.pdf`);
}

function formatMoney(n: number): string {
  // Indian locale grouping; jsPDF can't render the ₹ glyph reliably with
  // its default Helvetica, so prefix Rs. instead.
  return `Rs. ${n.toLocaleString('en-IN')}`;
}

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
