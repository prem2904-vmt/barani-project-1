/**
 * OPD token slip (Agent B): an 80 mm receipt-printer slip with the token in
 * big type, the patient, doctor, visit number and the paid amount — printed
 * through the app's shared off-screen PDF print path (shared/utils/print-pdf.ts),
 * the same route invoices and reports use. jsPDF loads lazily.
 */
import type { OpdVisitDetail } from './desk.models';
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';

export interface TokenSlipText { token: string; lines: string[]; footer: string; }

/** The slip's words — pure, so the spec pins them. */
export function tokenSlipText(v: OpdVisitDetail, tenantName: string): TokenSlipText {
  const when = new Date(v.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const lines = [
    tenantName,
    v.patient.name + (v.patient.mrn ? ` · ${v.patient.mrn}` : ''),
    v.doctor.name + (v.doctor.department ? ` · ${v.doctor.department}` : ''),
    v.service?.name ?? v.purpose ?? 'Consultation',
    `${v.visitNumber ?? ''} · ${when}`.trim(),
  ];
  if (v.bill) lines.push(`${v.bill.invoiceNumber ?? 'Bill'} · ₹${v.bill.totalPaid} paid${v.bill.balance > 0 ? ` · ₹${v.bill.balance} due` : ''}`);
  if (v.labOrder) lines.push(`Lab order ${v.labOrder.orderNumber ?? ''} — go to sample collection`.trim());
  return { token: v.tokenLabel, lines, footer: 'Please wait for your token to be called.' };
}

export async function printTokenSlip(v: OpdVisitDetail, tenantName: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t = tokenSlipText(v, tenantName);
  const doc = new jsPDF({ unit: 'mm', format: [80, 110] });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('OPD TOKEN', 40, 10, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(40);
  doc.text(t.token, 40, 28, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let y = 40;
  for (const line of t.lines) {
    // jsPDF's core fonts have no ₹ glyph — print "Rs." on paper.
    for (const w of doc.splitTextToSize(line.replace(/₹/g, 'Rs. '), 70) as string[]) { doc.text(w, 40, y, { align: 'center' }); y += 5; }
  }
  doc.setFontSize(8);
  doc.text(t.footer, 40, Math.min(y + 4, 104), { align: 'center' });
  const url = URL.createObjectURL(doc.output('blob'));
  printPdfBlobUrl(url, { revokeOnDone: true });
}
