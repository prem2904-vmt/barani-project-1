import { jsPDF } from 'jspdf';
import { installPdfTextSanitizer } from '../../../shared/utils/pdf-text';
import { printPdfBlobUrl } from '../../../shared/utils/print-pdf';
import { fetchAssetBlob } from '../../../shared/utils/upload-fetch';
import autoTable from 'jspdf-autotable';
import { Bill } from '../../../shared/models/bill.model';
import { billRoundOff } from '../../../shared/utils/bill-math';
import { Order } from '../../../shared/models/order.model';

/**
 * Generate a professional A4 PDF invoice directly with jsPDF (sharp, searchable,
 * paginates cleanly). Three letterhead STYLES (classic / modern / letterhead) and
 * two GST document MODES (Tax Invoice — CGST Rule 46 full particulars; Bill of
 * Supply — Rule 49, no tax columns / reverse-charge / place-of-supply). All
 * letterhead + footer content is template-driven so admins can customise it.
 */
export type InvoiceTemplateStyle = 'classic' | 'modern' | 'letterhead' | 'cashbill';

export interface InvoicePdfInput {
  bill: Bill;
  order: Order | null;
  invoiceNumber: string;
  effectivePayable: number;
  tatLabel: string;
  /** Lab letterhead, from the invoice-template config. */
  practice?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    gstin?: string;
  };
  /** Patient result-tracking QR (PNG data URL) → /track/{token}. */
  qrDataUrl?: string;
  /** Staff order QR (PNG data URL) → /o/{orderId}. */
  orderQrDataUrl?: string;
  /** "TAX INVOICE" (default) or "BILL OF SUPPLY". */
  docTitle?: string;
  // ── Template customisation ──
  template?: InvoiceTemplateStyle;
  accentColor?: string;
  logoDataUrl?: string;
  tagline?: string;
  footerText?: string;
  bankDetails?: string;
  signatureLabel?: string;
  jurisdiction?: string;
  declaration?: string;
  /** Cashier / counter staff name — printed in the Cash Bill footer. */
  cashierName?: string;
  /** The printing user's saved digital signature (PNG data URL). Drawn above the
   *  cashier line on the Cash Bill when present. */
  cashierSignatureDataUrl?: string;
  /** Paper the invoice prints on. 'a4' is the full page; the rest are
   *  continuous thermal receipt rolls, cut to exact content height:
   *    thermal_25in → 2.5 in (≈64 mm)
   *    thermal_3in  → 3 in   (≈80 mm, the common desk receipt printer)
   *    thermal      → 4 in   (≈104 mm) — kept as the legacy alias so rows
   *                   saved before the narrower sizes existed still work.
   *  Applies to EVERY letterhead style, not just the Cash Bill. */
  paperSize?: 'a4' | 'thermal' | 'thermal_3in' | 'thermal_25in';
  action?: 'save' | 'print' | 'view' | 'blob';
}

const A4 = { w: 595.28, h: 841.89 }; // pt
const MARGIN = 40;
const TEXT_PRIMARY = '#0f172a';
const TEXT_MUTED = '#64748b';
const HAIR = '#e2e8f0';

/** Staff "open order" QR on invoices — disabled for now (owner, 2026-09-26).
 *  The patient result-tracking QR is unaffected. Flip to re-enable. */
export const STAFF_ORDER_QR_ENABLED = false;

export function generateInvoicePdf(rawInput: InvoicePdfInput): string | void {
  const input: InvoicePdfInput = STAFF_ORDER_QR_ENABLED ? rawInput : { ...rawInput, orderQrDataUrl: undefined };
  const {
    bill, order, invoiceNumber, effectivePayable, tatLabel, practice = {},
    qrDataUrl, orderQrDataUrl, docTitle, action = 'save',
    template = 'classic', accentColor = '#1B3A6B', logoDataUrl,
    tagline, footerText, bankDetails, signatureLabel = 'Authorised Signatory',
    jurisdiction, declaration,
  } = input;

  const title = (docTitle ?? 'TAX INVOICE').toUpperCase();
  const isTaxInvoice = title.includes('TAX');

  // ── Cash Bill style — a self-contained monochrome layout that
  //    mirrors the classic Indian diagnostic "CASH BILL" receipt
  //    (centered header, S.No/Test/Amount table, Mode-of-Payment +
  //    Total/Discount/Net Payable/Collected block, amount-in-words,
  //    Due-Amount box). Prints on A4 or a 4-inch thermal roll. ─────
  // Thermal is a PAPER choice, not a letterhead choice: a lab on classic or
  // modern still needs the receipt roll at the counter. Previously this was
  // nested under `template === 'cashbill'`, so picking Thermal did nothing
  // unless the Cash Bill style happened to be selected.
  const thermalW = thermalWidthPt(input.paperSize);
  if (thermalW) {
    // Two passes: render once onto an over-tall page purely to MEASURE where
    // the content ends, then render again onto a page cut to exactly that
    // height. Beats maintaining height arithmetic by hand (which drifted every
    // time a row was added) and guarantees the printer feeds/cuts right after
    // the bill — no trailing blank paper at any of the three widths.
    const probe = new jsPDF({ unit: 'pt', format: [thermalW, 4000] });
    installPdfTextSanitizer(probe);
    const used = drawThermalBill(probe, input, isTaxInvoice, thermalW);
    const hPt = Math.max(220, Math.ceil(used + 12));
    const tdoc = new jsPDF({ unit: 'pt', format: [thermalW, hPt] });
    installPdfTextSanitizer(tdoc);
    drawThermalBill(tdoc, input, isTaxInvoice, thermalW);
    return finishInvoice(tdoc, input);
  }

  if (template === 'cashbill') {
    const cbDoc = new jsPDF({ unit: 'pt', format: 'a4' });
    installPdfTextSanitizer(cbDoc);
    drawCashBill(cbDoc, input, isTaxInvoice);
    return finishInvoice(cbDoc, input);
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  installPdfTextSanitizer(doc);
  const accent = accentColor || '#1B3A6B';
  const right = A4.w - MARGIN;

  // ── Header (per template style) ─────────────────────────────
  let y = drawHeader(doc, template, accent, practice, tagline, logoDataUrl);

  // Document-title + meta block (right-aligned), drawn just under the header.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(accent);
  doc.text(title, right, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_PRIMARY);
  let metaY = y + 15;
  doc.text(`Invoice No: ${invoiceNumber}`, right, metaY, { align: 'right' }); metaY += 12;
  doc.setTextColor(TEXT_MUTED);
  doc.text(`Date: ${formatDate(bill.createdAt)}`, right, metaY, { align: 'right' }); metaY += 12;
  if (isTaxInvoice && bill.placeOfSupply) {
    doc.text(`Place of supply: ${bill.placeOfSupply}`, right, metaY, { align: 'right' }); metaY += 12;
  }

  // ── Bill-to block (left) ────────────────────────────────────
  const patient = order?.patient;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('BILL TO', MARGIN, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(TEXT_PRIMARY);
  doc.text(patient?.displayName ?? '—', MARGIN, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  let by = y + 30;
  const ageSex = [patient?.age != null ? `${patient.age}y` : '', patient?.sex ?? ''].filter(Boolean).join(' · ');
  if (ageSex) { doc.text(ageSex, MARGIN, by); by += 12; }
  if (patient?.phone) { doc.text(`Phone: ${patient.phone}`, MARGIN, by); by += 12; }

  y = Math.max(metaY, by) + 14;

  // ── Items table (columns depend on document mode) ───────────
  y = drawItemsTable(doc, bill, isTaxInvoice, accent, template, y);

  // ── Totals (right-aligned; tax split only for Tax Invoice) ──
  y = drawTotals(doc, bill, effectivePayable, isTaxInvoice, accent, y);

  // Reverse-charge declaration (Tax Invoice only — CGST Rule 46).
  if (isTaxInvoice) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text('Tax payable on reverse charge: No', MARGIN, y);
    y += 14;
  }

  if (tatLabel) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_PRIMARY);
    doc.text(`Estimated report: ${tatLabel.replace('≈', '~').replace('to report', '').trim() || tatLabel}`, MARGIN, y);
    y += 14;
  }

  // ── Footer: declaration · bank · signatory · QR · note ──────
  drawFooter(doc, { accent, footerText, bankDetails, signatureLabel, jurisdiction, declaration, practice, qrDataUrl, orderQrDataUrl });

  return finishInvoice(doc, input);
}

/** Emit the built document per the requested action. */
function finishInvoice(doc: jsPDF, input: InvoicePdfInput): string | void {
  const action = input.action ?? 'save';
  if (action === 'blob') return doc.output('bloburl') as unknown as string;
  if (action === 'view') { window.open(doc.output('bloburl') as unknown as string, '_blank'); return; }
  if (action === 'print') {
    // Shared helper: an off-screen A4-sized iframe. A 0-sized one prints blank.
    printPdfBlobUrl(doc.output('bloburl') as unknown as string, { revokeOnDone: true });
    return;
  }
  doc.save(`${input.invoiceNumber}.pdf`);
}

/** Draw the letterhead in the chosen style; returns the Y where body starts. */
function drawHeader(
  doc: jsPDF, style: InvoiceTemplateStyle, accent: string,
  practice: NonNullable<InvoicePdfInput['practice']>, tagline?: string, logo?: string,
): number {
  const name = practice.name ?? 'Prefrontal Lab';
  const contact: string[] = [practice.address ?? '', [practice.phone, practice.email].filter(Boolean).join(' · '),
    practice.gstin ? `GSTIN: ${practice.gstin}` : ''].filter((l): l is string => !!l);

  if (style === 'letterhead') {
    // Pre-printed stationery — leave whitespace for the printed letterhead.
    return 120;
  }

  if (style === 'modern') {
    // Accent band with the lab identity reversed out in white.
    const bandH = 78;
    doc.setFillColor(accent);
    doc.rect(0, 0, A4.w, bandH, 'F');
    let tx = MARGIN;
    if (logo) { try { doc.addImage(logo, 'PNG', MARGIN, 16, 46, 46); tx = MARGIN + 58; } catch { /* ignore */ } }
    doc.setTextColor('#ffffff');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text(name, tx, 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    let cy = 48;
    if (tagline) { doc.text(tagline, tx, cy); cy += 11; }
    for (const line of contact) { doc.text(line, tx, cy); cy += 11; }
    return bandH + 26;
  }

  // classic — black-on-white, thin rules, the most "serious" look.
  doc.setFillColor(accent);
  doc.rect(0, 0, A4.w, 4, 'F'); // slim accent strip
  let tx = MARGIN;
  if (logo) { try { doc.addImage(logo, 'PNG', MARGIN, 24, 44, 44); tx = MARGIN + 56; } catch { /* ignore */ } }
  doc.setTextColor(TEXT_PRIMARY);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(21);
  doc.text(name, tx, 46);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.setTextColor(TEXT_MUTED);
  let cy = 60;
  if (tagline) { doc.text(tagline, tx, cy); cy += 11; }
  for (const line of contact) { doc.text(line, tx, cy); cy += 11; }
  const ruleY = Math.max(cy + 2, 78);
  doc.setDrawColor(accent); doc.setLineWidth(1);
  doc.line(MARGIN, ruleY, A4.w - MARGIN, ruleY);
  return ruleY + 22;
}

/** Items table. Tax Invoice shows HSN/SAC + GST%; Bill of Supply omits tax. */
function drawItemsTable(doc: jsPDF, bill: Bill, isTaxInvoice: boolean, accent: string, style: InvoiceTemplateStyle, startY: number): number {
  const head = isTaxInvoice
    ? [['#', 'Particulars', 'HSN/SAC', 'Taxable', 'GST %', 'Amount']]
    : [['#', 'Particulars', 'HSN/SAC', 'Amount']];
  const body = bill.items.map((it, i) => isTaxInvoice
    ? [String(i + 1), it.testName, it.hsnSacCode ?? '—', formatMoney(it.taxableAmount ?? it.price - it.discount),
       `${(it.cgstRate + it.sgstRate + it.igstRate).toFixed(0)}%`, formatMoney(it.total)]
    : [String(i + 1), it.testName, it.hsnSacCode ?? '—', formatMoney(it.total)]);

  const lightAccent = style === 'classic' ? '#f1f5f9' : tint(accent);
  autoTable(doc, {
    startY,
    head, body,
    margin: { left: MARGIN, right: MARGIN },
    theme: style === 'classic' ? 'grid' : 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 6, textColor: TEXT_PRIMARY, lineColor: HAIR, lineWidth: style === 'classic' ? 0.4 : 0 },
    headStyles: { fillColor: lightAccent, textColor: style === 'classic' ? TEXT_PRIMARY : accent, fontStyle: 'bold', fontSize: 8.5, halign: 'left', lineColor: HAIR, lineWidth: style === 'classic' ? 0.4 : { top: 0, right: 0, bottom: 0.6, left: 0 } as unknown as number },
    bodyStyles: { fillColor: '#ffffff' },
    columnStyles: isTaxInvoice
      ? { 0: { cellWidth: 22, halign: 'right' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 60 }, 3: { cellWidth: 64, halign: 'right' }, 4: { cellWidth: 42, halign: 'right' }, 5: { cellWidth: 70, halign: 'right', fontStyle: 'bold' } }
      : { 0: { cellWidth: 22, halign: 'right' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 80 }, 3: { cellWidth: 80, halign: 'right', fontStyle: 'bold' } },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
}

/** Totals block (right-aligned). Tax Invoice splits CGST/SGST or IGST. */
function drawTotals(doc: jsPDF, bill: Bill, payable: number, isTaxInvoice: boolean, accent: string, startY: number): number {
  const labelX = A4.w - MARGIN - 150;
  const valueX = A4.w - MARGIN;
  let ty = startY;
  const line = (label: string, value: string, opts?: { bold?: boolean; color?: string }) => {
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
    doc.setFontSize(opts?.bold ? 11 : 9.5);
    doc.setTextColor(TEXT_MUTED);
    doc.text(label, labelX, ty);
    doc.setTextColor(opts?.color ?? TEXT_PRIMARY);
    doc.text(value, valueX, ty, { align: 'right' });
    ty += opts?.bold ? 18 : 15;
  };

  line('Subtotal', formatMoney(bill.subTotal));
  if (bill.totalDiscount > 0) line('Discount', `−${formatMoney(bill.totalDiscount)}`, { color: '#059669' });
  if (isTaxInvoice && bill.totalTax > 0) {
    line('Taxable value', formatMoney(bill.totalTaxable));
    if (bill.isInterstate && bill.totalIgst > 0) {
      line('IGST', formatMoney(bill.totalIgst));
    } else {
      line('CGST', formatMoney(bill.totalCgst));
      line('SGST', formatMoney(bill.totalSgst));
    }
  }
  // Owner round-off rule: taxable + GST + round-off = the whole-rupee Total.
  const roundOff = billRoundOff(bill);
  if (roundOff !== 0) line('Round off', `${roundOff > 0 ? '+' : '−'}Rs. ${Math.abs(roundOff).toFixed(2)}`);
  ty += 2;
  doc.setDrawColor(accent); doc.setLineWidth(0.8);
  doc.line(labelX, ty, valueX, ty);
  ty += 16;
  line('Total', formatMoney(payable), { bold: true, color: accent });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.text(bill.balance <= 0 ? 'Paid in full' : `Balance ${formatMoney(bill.balance)}`, valueX, ty, { align: 'right' });
  return ty + 18;
}

interface FooterOpts {
  accent: string; footerText?: string; bankDetails?: string; signatureLabel: string;
  jurisdiction?: string; declaration?: string;
  practice: NonNullable<InvoicePdfInput['practice']>;
  qrDataUrl?: string; orderQrDataUrl?: string;
}
function drawFooter(doc: jsPDF, o: FooterOpts): void {
  // QR cards (bottom): patient tracking (left) + staff order (right of centre).
  const drawQrCard = (data: string, cardX: number, caption: string) => {
    const qrSize = 58, pad = 7;
    const cardW = qrSize + pad * 2, cardH = qrSize + pad * 2 + 13;
    const cardY = A4.h - 28 - cardH;
    doc.setFillColor('#ffffff'); doc.setDrawColor(HAIR); doc.setLineWidth(0.6);
    doc.roundedRect(cardX, cardY, cardW, cardH, 5, 5, 'FD');
    try { doc.addImage(data, 'PNG', cardX + pad, cardY + pad, qrSize, qrSize); } catch { /* ignore */ }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(o.accent);
    doc.text(caption, cardX + cardW / 2, cardY + cardH - 6, { align: 'center' });
  };
  if (o.qrDataUrl) drawQrCard(o.qrDataUrl, MARGIN, 'SCAN TO TRACK REPORT');
  if (o.orderQrDataUrl) drawQrCard(o.orderQrDataUrl, MARGIN + 96, 'STAFF: OPEN ORDER');

  // Left text column: declaration + footer terms + bank details.
  let fy = A4.h - 120;
  const colRight = A4.w - MARGIN;
  doc.setFontSize(8); doc.setTextColor(TEXT_MUTED);
  const declaration = o.declaration ?? 'Certified that the particulars given above are true and correct.';
  doc.setFont('helvetica', 'italic');
  for (const l of doc.splitTextToSize(declaration, 260)) { doc.text(l, A4.w / 2 + 30, fy); fy += 10; }
  if (o.bankDetails) {
    doc.setFont('helvetica', 'normal');
    for (const l of doc.splitTextToSize(`Bank: ${o.bankDetails}`, 260)) { doc.text(l, A4.w / 2 + 30, fy); fy += 10; }
  }

  // Signatory block (right).
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(TEXT_PRIMARY);
  doc.text(`For ${o.practice.name ?? 'Prefrontal Lab'}`, colRight, A4.h - 92, { align: 'right' });
  doc.setDrawColor(HAIR); doc.setLineWidth(0.5);
  doc.line(colRight - 130, A4.h - 56, colRight, A4.h - 56);
  doc.setFontSize(8); doc.setTextColor(TEXT_MUTED);
  doc.text(o.signatureLabel, colRight, A4.h - 46, { align: 'right' });

  // Footer terms + jurisdiction + computer-generated note (centred, bottom).
  const notes = [
    o.footerText,
    o.jurisdiction ? `Subject to ${o.jurisdiction} jurisdiction.` : '',
    'This is a computer-generated invoice.',
  ].filter(Boolean).join('  ·  ');
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(TEXT_MUTED);
  doc.text(notes, A4.w / 2, A4.h - 16, { align: 'center', maxWidth: A4.w - 2 * MARGIN });
}

// ──────────────────────────────────────────────────────────────
// Cash Bill — monochrome diagnostic-receipt layout
// ──────────────────────────────────────────────────────────────

const CB_INK = '#111111';
const CB_GREY = '#444444';
const CB_RULE = '#333333';

/** Computed, presentation-ready Cash Bill values — shared by the A4 and thermal
 *  renderers so both obey the same rules (no Sample ID, bill number in the head,
 *  no per-test discount, gross Total → Discount → adjusted Net Payable). */
export interface CashBillModel {
  patientName: string; ptId: string; mobile: string; dateStr: string;
  invoiceNo: string; referredBy: string;
  items: { sno: string; name: string; amount: string }[];
  payments: { label: string; amount: string; ref: string }[];
  grossTotal: string; discount: string; hasDiscount: boolean;
  /** GST on the discounted taxable value (the bill's), so the stack adds up:
   *  Total − Discount + GST = Net Payable. */
  tax: string; hasTax: boolean;
  /** "+0.10" / "-0.40": taking the exact figure to the whole-rupee Net Payable. */
  roundOff: string; hasRoundOff: boolean;
  netPayable: string; collected: string; isCredit: boolean;
  isPaid: boolean; paidOrDueLabel: string; paidOrDueAmount: string;
  amountWords: string;
}

export function buildCashBillModel(input: InvoicePdfInput): CashBillModel {
  const { bill, order, invoiceNumber, effectivePayable } = input;
  const patient = order?.patient;
  const ageSex = [patient?.age != null ? String(patient.age) : '', patient?.sex ?? ''].filter(Boolean).join(' / ');
  const patientName = patient?.displayName
    ? (ageSex ? `${patient.displayName} (${ageSex})` : patient.displayName) : '—';

  // Requirement: keep the Total as-is (gross, before any discount) and apply the
  // discount once at the bill level. Items therefore show the un-discounted price
  // (it.price), the Total is the gross sum, and Net Payable is the adjusted figure.
  // The invoice is the source of truth: the discount is the bill's own
  // (totalDiscount), never "gross − payable" — on a GST bill that mixed the tax
  // in (₹1000 @18% − ₹295 printed a ₹168.10 discount).
  const grossTotalNum = bill.items.reduce((s, it) => s + (it.price ?? 0), 0) || bill.subTotal || 0;
  const discountNum = Math.max(0, Number(bill.totalDiscount) || 0);
  const taxNum = Math.max(0, Number(bill.totalTax) || 0);
  const roundOffNum = billRoundOff(bill);

  const payments = (bill.payments ?? []).map(p => ({
    // A wallet payment is drawn from the patient's prepaid credit — label it "Credit".
    label: ((p.mode || 'PAID').toLowerCase() === 'wallet' ? 'CREDIT' : (p.mode || 'PAID')).toUpperCase(),
    amount: plain(p.amount),  // same comma-grouped format as the totals column
    // Keep a short, traceable reference — a full txn UUID used to overrun the
    // amount and overlap the totals column. Long ids collapse to "#<last 8>".
    ref: shortPayRef(p.referenceNo),
  }));
  if (payments.length === 0 && bill.totalPaid > 0) payments.push({ label: 'PAID', amount: plain(bill.totalPaid), ref: '' });

  // Credit bills (paid from the patient's wallet / on credit) suppress the
  // Net Payable + Collected Amount rows; cash and every other mode keep them.
  const isCredit = (bill.payments ?? []).some(p => {
    const mode = (p.mode || '').toLowerCase();
    return mode === 'wallet' || mode === 'credit';
  });

  const isPaid = bill.balance <= 0;
  return {
    patientName,
    ptId: patient?.mrn ?? shortId(order?.id),
    mobile: patient?.phone ?? '—',
    dateStr: formatDateTime(bill.createdAt),
    invoiceNo: invoiceNumber,
    referredBy: order?.refDoctorName ?? '',
    items: bill.items.map((it, i) => ({ sno: String(i + 1), name: it.testName, amount: plain(it.price ?? it.total) })),
    payments,
    grossTotal: plain(grossTotalNum),
    discount: plain(discountNum),
    hasDiscount: discountNum > 0,
    tax: plain(taxNum),
    hasTax: taxNum > 0,
    roundOff: `${roundOffNum > 0 ? '+' : '-'} ${Math.abs(roundOffNum).toFixed(2)}`,
    hasRoundOff: roundOffNum !== 0,
    netPayable: plain(effectivePayable),
    collected: plain(bill.totalPaid),
    isCredit,
    isPaid,
    paidOrDueLabel: isPaid ? 'Amount Paid' : 'Due Amount',
    paidOrDueAmount: plain(isPaid ? bill.totalPaid : Math.max(0, bill.balance)),
    amountWords: numberToWordsINR(Math.round(effectivePayable)),
  };
}

function drawCashBill(doc: jsPDF, input: InvoicePdfInput, isTaxInvoice: boolean): void {
  const { practice = {}, logoDataUrl, tagline, cashierName, cashierSignatureDataUrl, qrDataUrl, orderQrDataUrl } = input;
  const m = buildCashBillModel(input);
  const cx = A4.w / 2;
  const rightX = A4.w - MARGIN;

  // ── Header — logo at left, identity centred ──
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'PNG', MARGIN, 30, 50, 50); } catch { /* ignore */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(CB_INK);
  doc.text(practice.name ?? 'Diagnostic Centre', cx, 42, { align: 'center' });
  let hy = 56;
  if (tagline) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(CB_GREY);
    doc.text(tagline, cx, hy, { align: 'center' }); hy += 11;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(CB_GREY);
  if (practice.address) {
    for (const l of doc.splitTextToSize(practice.address, A4.w - 220)) { doc.text(l, cx, hy, { align: 'center' }); hy += 11; }
  }
  const contactLine = [practice.phone ? `Phone: ${practice.phone}` : '', practice.email ?? '', practice.gstin ? `GSTIN: ${practice.gstin}` : '']
    .filter(Boolean).join('    ');
  if (contactLine) { doc.text(contactLine, cx, hy, { align: 'center' }); hy += 11; }

  let y = Math.max(hy, 92) + 4;
  doc.setDrawColor(CB_RULE); doc.setLineWidth(0.7); doc.line(MARGIN, y, rightX, y);
  y += 22;

  // ── Title ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(CB_INK);
  doc.text(isTaxInvoice ? 'TAX INVOICE' : 'CASH BILL', cx, y, { align: 'center' });
  y += 24;

  // ── Patient result-tracking QR — right side of the CASH BILL body, beside
  //    the meta block (easiest thing to scan; staff-order QR stays bottom).
  //    Vertically centred in the band between the header rule (y-46) and the
  //    items-table rule (y+56) so it doesn't sink to the bottom. ──
  if (qrDataUrl) {
    const qs = 52, qxr = rightX - qs;
    const bandTop = y - 46, bandBottom = y + 56;
    const qyr = bandTop + (bandBottom - bandTop - qs) / 2;
    try { doc.addImage(qrDataUrl, 'PNG', qxr, qyr, qs, qs); } catch { /* ignore */ }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(CB_GREY);
    doc.text('SCAN TO TRACK', qxr + qs / 2, qyr + qs + 7, { align: 'center' });
  }

  // ── Patient / meta block — two columns, aligned colons. Order (Sample ID
  //    removed, Invoice/Bill No added): left = Name, Patient ID, Mobile;
  //    right = Date, Invoice No, Referred by. ──
  const colL = MARGIN, colR = cx + 16;
  const labGap = 80;
  const kv = (x: number, yy: number, label: string, value: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(CB_GREY);
    doc.text(label, x, yy);
    doc.text(':', x + labGap, yy);
    doc.setTextColor(CB_INK);
    doc.text(value || '—', x + labGap + 6, yy);
  };
  let ly = y;
  kv(colL, ly, 'Patient Name', m.patientName);
  kv(colR, ly, 'Date', m.dateStr); ly += 16;
  kv(colL, ly, 'Patient ID', m.ptId);
  kv(colR, ly, 'Invoice No', m.invoiceNo); ly += 16;
  kv(colL, ly, 'Mobile No', m.mobile);
  if (m.referredBy) kv(colR, ly, 'Referred By', m.referredBy);
  ly += 16;
  y = ly + 8;

  // ── Items table: S.No | Test Name | Amount (Quantity removed) ──
  autoTable(doc, {
    startY: y,
    head: [['S.No', 'Test Name', 'Amount']],
    body: m.items.map(it => [it.sno, it.name, it.amount]),
    margin: { left: MARGIN, right: MARGIN },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: { top: 5, right: 6, bottom: 5, left: 6 }, textColor: CB_INK, lineWidth: 0 },
    headStyles: { fillColor: '#ffffff', textColor: CB_INK, fontStyle: 'bold', fontSize: 9.5, lineColor: CB_RULE, lineWidth: { top: 0.7, right: 0, bottom: 0.7, left: 0 } as unknown as number },
    bodyStyles: { fillColor: '#ffffff' },
    // Amount column: zero right-padding so the values sit flush to the table's
    // right edge (rightX) — the exact edge the Total / Net Payable / Amount Paid
    // stack aligns to below, so the whole money column lines up top to bottom.
    columnStyles: { 0: { cellWidth: 48, halign: 'left' }, 1: { cellWidth: 'auto', halign: 'left' }, 2: { cellWidth: 96, halign: 'right', cellPadding: { top: 5, right: 0, bottom: 5, left: 6 } } },
    // Right-align the "Amount" header too so it sits directly above the values
    // (autoTable leaves head cells left-aligned even when the column is right).
    didParseCell: d => { if (d.section === 'head' && d.column.index === 2) d.cell.styles.halign = 'right'; },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setDrawColor(CB_RULE); doc.setLineWidth(0.7); doc.line(MARGIN, y, rightX, y);
  y += 18;

  // ── Mode of Payment (left, amounts aligned) + totals (right) ──
  const blockTop = y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(CB_GREY);
  doc.text('Mode of Payment', MARGIN, y);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(CB_INK);
  let py = y + 15;
  const payColonX = MARGIN + 66;    // aligned colon, mirroring the totals column
  const payAmtX = MARGIN + 150;     // right edge the payment amounts align to
  if (m.payments.length > 0) {
    for (const p of m.payments) {
      // "CASH : 10,240" — label, aligned colon, right-aligned amount (matches Total).
      doc.text(p.label, MARGIN, py);
      doc.text(':', payColonX, py);
      doc.text(p.amount, payAmtX, py, { align: 'right' });
      py += 14;
    }
  } else {
    doc.text('—', MARGIN, py); py += 14;
  }

  const tLabelX = cx + 16, tColonX = rightX - 78;
  let ty = blockTop;
  const tot = (label: string, value: string, bold = false, color = CB_INK) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10); doc.setTextColor(color);
    doc.text(label, tLabelX, ty);
    doc.text(':', tColonX, ty);
    doc.text(value, rightX, ty, { align: 'right' });
    ty += 17;
  };
  // One continuous vertical stack — every amount right-aligned to the same
  // edge: Total (gross) → Discount → Net Payable → Collected → Amount Paid / Due
  // (divider above, emphasised). Credit bills drop Net Payable + Collected
  // Amount (redundant/confusing for a credit sale); cash + every other mode
  // keep the full stack.
  tot('Total', m.grossTotal);
  if (m.hasDiscount) tot('Discount', `- ${m.discount}`, false, '#166534');
  if (m.hasTax) tot('GST', m.tax);
  if (m.hasRoundOff) tot('Round off', m.roundOff);
  if (!m.isCredit) {
    tot('Net Payable', m.netPayable, true);
    tot('Collected Amount', m.collected);
  }
  ty += 2;
  doc.setDrawColor(CB_RULE); doc.setLineWidth(0.6); doc.line(tLabelX, ty, rightX, ty); ty += 15;
  tot(m.paidOrDueLabel, m.paidOrDueAmount, true);

  // ── Amount in words (left column, below the payment + totals blocks) ──
  let wy = Math.max(py, ty) + 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(CB_INK);
  for (const l of doc.splitTextToSize(`(Amount in words: ${m.amountWords} Only)`, cx + 10 - MARGIN)) { doc.text(l, MARGIN, wy); wy += 14; }

  // ── Staff order QR (bottom-left). The patient track QR sits at the top-right
  //    of the cash-bill body, beside the meta block. ──
  if (orderQrDataUrl) {
    const qrSize = 46, qrTop = A4.h - qrSize - 54;
    try {
      doc.addImage(orderQrDataUrl, 'PNG', MARGIN, qrTop, qrSize, qrSize);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(CB_GREY);
      doc.text('STAFF ORDER', MARGIN + qrSize / 2, qrTop + qrSize + 8, { align: 'center' });
    } catch { /* ignore */ }
  }

  // ── Cashier signature — bottom-right, above the closing note. The printing
  //    user's saved signature image sits above the line; name below. ──
  const sigY = A4.h - 44;
  if (cashierSignatureDataUrl) {
    const sw = 120, sh = 34;
    try { doc.addImage(cashierSignatureDataUrl, 'PNG', rightX - sw, sigY - sh - 2, sw, sh); } catch { /* ignore */ }
  }
  doc.setDrawColor(CB_RULE); doc.setLineWidth(0.5);
  doc.line(rightX - 150, sigY, rightX, sigY);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(CB_INK);
  doc.text(cashierName ? `Cashier: ${cashierName}` : 'Cashier', rightX, sigY + 12, { align: 'right' });

  // Computer-generated note (very bottom).
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor('#555555');
  doc.text('This is a computerized bill and does not require signature', MARGIN, A4.h - 22);
}

// ──────────────────────────────────────────────────────────────
// Thermal Cash Bill — single-column 4-inch (≈104 mm) receipt roll
// ──────────────────────────────────────────────────────────────

/** Estimate the continuous-roll height (pt) so the page is cut right after the
 *  content. Deliberately a little generous — trailing whitespace is fine on a
 *  roll, a clipped bill is not. */
/** Roll width in points for a thermal paperSize, or null for A4.
 *  72 pt = 1 inch. 'thermal' is the legacy 4-inch alias. */
function thermalWidthPt(paperSize: InvoicePdfInput['paperSize']): number | null {
  switch (paperSize) {
    case 'thermal_25in': return 180; // 2.5 in ≈ 64 mm
    case 'thermal_3in':  return 216; // 3 in   ≈ 80 mm
    case 'thermal':      return 288; // 4 in   ≈ 104 mm (legacy default)
    default:             return null;
  }
}

/** Per-width type scale. A layout tuned for the 4-inch roll overflows at 2.5 in,
 *  so margins, font sizes and the two fixed columns (meta label, amount) shrink
 *  with the paper instead of being hardcoded. */
function thermalMetrics(W: number) {
  if (W <= 180) return { MG: 10, name: 10, body: 6.8, small: 6, labelW: 50, amtW: 46, qr: 52, snoW: 15 };
  if (W <= 216) return { MG: 12, name: 11, body: 7.4, small: 6.2, labelW: 58, amtW: 52, qr: 60, snoW: 17 };
  return { MG: 14, name: 12, body: 8, small: 6.5, labelW: 66, amtW: 58, qr: 68, snoW: 20 };
}

/**
 * Draw the receipt-roll bill and return the Y where the content ends (the
 * caller uses that to cut the page). Everything flows top-to-bottom — nothing
 * is pinned to the page bottom, which is what lets the two-pass measurement
 * produce an exact-height roll.
 *
 * The tracking QR sits at the TOP, directly under the title, mirroring the
 * restructured A4 report: the patient's first action is scanning to track, so
 * it should not be buried under the totals.
 */
function drawThermalBill(doc: jsPDF, input: InvoicePdfInput, isTaxInvoice: boolean, W: number): number {
  const { practice = {}, logoDataUrl, tagline, cashierName, cashierSignatureDataUrl, qrDataUrl, orderQrDataUrl } = input;
  const m = buildCashBillModel(input);
  const M = thermalMetrics(W);
  const MG = M.MG;
  const cx = W / 2, rightX = W - MG;
  const inner = W - 2 * MG;

  // ── Header (centred) ──
  let y = 18;
  // addImage anchors at the TOP of the box while text() anchors at the
  // BASELINE, so every image→text hand-off has to clear the image box *and*
  // one text ascent. Missing that is what put the logo on top of the lab name.
  if (logoDataUrl) {
    const lw = Math.min(36, inner * 0.28);
    try {
      doc.addImage(logoDataUrl, 'PNG', cx - lw / 2, y, lw, lw);
      y += lw + 6 + M.name;          // image box + gap + ascent of the name
    } catch { /* logo optional */ }
  } else {
    y += M.name;                     // no logo: still drop to the first baseline
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(M.name); doc.setTextColor(CB_INK);
  for (const l of doc.splitTextToSize(practice.name ?? 'Diagnostic Centre', inner)) {
    doc.text(l, cx, y, { align: 'center' }); y += M.name + 1;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(M.small + 1); doc.setTextColor(CB_GREY);
  if (tagline) {
    doc.setFont('helvetica', 'italic');
    for (const l of doc.splitTextToSize(tagline, inner)) { doc.text(l, cx, y, { align: 'center' }); y += 9; }
    doc.setFont('helvetica', 'normal');
  }
  if (practice.address) {
    for (const l of doc.splitTextToSize(practice.address, inner)) { doc.text(l, cx, y, { align: 'center' }); y += 8.5; }
  }
  const contact = [practice.phone ? `Ph: ${practice.phone}` : '', practice.gstin ? `GSTIN: ${practice.gstin}` : ''].filter(Boolean).join('   ');
  if (contact) { for (const l of doc.splitTextToSize(contact, inner)) { doc.text(l, cx, y, { align: 'center' }); y += 9; } }

  y += 3; doc.setDrawColor(CB_RULE); doc.setLineWidth(0.6); doc.line(MG, y, rightX, y); y += 14;

  // ── Title ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(M.name); doc.setTextColor(CB_INK);
  doc.text(isTaxInvoice ? 'TAX INVOICE' : 'CASH BILL', cx, y, { align: 'center' }); y += 14;

  // ── QRs at the top, centred side by side (single QR centres on its own) ──
  const qrs: Array<{ data: string; caption: string }> = [];
  if (qrDataUrl) qrs.push({ data: qrDataUrl, caption: 'TRACK REPORT' });
  if (orderQrDataUrl) qrs.push({ data: orderQrDataUrl, caption: 'STAFF ORDER' });
  const CAP_GAP = 5;   // whitespace between a QR and its caption
  if (qrs.length > 0) {
    const gap = qrs.length > 1 ? Math.max(12, inner * 0.07) : 0;
    const blockW = qrs.length * M.qr + gap * (qrs.length - 1);
    let qx = cx - blockW / 2;
    let drew = false;
    for (const q of qrs) {
      try { doc.addImage(q.data, 'PNG', qx, y, M.qr, M.qr); drew = true; } catch { qx += M.qr + gap; continue; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(M.small - 0.5); doc.setTextColor(CB_GREY);
      doc.text(q.caption, qx + M.qr / 2, y + M.qr + CAP_GAP + M.small, { align: 'center' });
      qx += M.qr + gap;
    }
    // Caption baseline sits (qr + capGap) below the QR top; the next element is
    // another text baseline, so clear the caption's own line plus a gap —
    // otherwise "TRACK REPORT" lands on the "Patient Name" row.
    if (drew) y += M.qr + CAP_GAP + M.small + 10 + M.body;
  }

  // ── Meta (single column) ──
  const kv = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(M.body); doc.setTextColor(CB_GREY);
    doc.text(label, MG, y);
    doc.text(':', MG + M.labelW, y);
    doc.setTextColor(CB_INK);
    const vx = MG + M.labelW + 6;
    doc.text(doc.splitTextToSize(value || '—', rightX - vx)[0] ?? '—', vx, y);
    y += M.body + 4.5;
  };
  kv('Patient Name', m.patientName);
  kv('Patient ID', m.ptId);
  kv('Mobile No', m.mobile);
  kv('Date', m.dateStr);
  kv('Invoice No', m.invoiceNo);
  if (m.referredBy) kv('Referred By', m.referredBy);
  y += 2;

  // ── Items: S.No | Test | Amount ──
  autoTable(doc, {
    startY: y,
    head: [['#', 'Test', 'Amount']],
    body: m.items.map(it => [it.sno, it.name, it.amount]),
    // bottom: 0 so the exact-height second pass can't trigger a page break.
    margin: { left: MG, right: MG, top: 0, bottom: 0 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: M.body, cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }, textColor: CB_INK, lineWidth: 0 },
    headStyles: { fillColor: '#ffffff', textColor: CB_INK, fontStyle: 'bold', fontSize: M.body, lineColor: CB_RULE, lineWidth: { top: 0.6, right: 0, bottom: 0.6, left: 0 } as unknown as number },
    // Amount flush-right (no right padding) so it lines up with the totals
    // stack below, which right-aligns to rightX.
    columnStyles: {
      0: { cellWidth: M.snoW, halign: 'left' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: M.amtW, halign: 'right', cellPadding: { top: 2.5, right: 0, bottom: 2.5, left: 2.5 } },
    },
    didParseCell: d => { if (d.section === 'head' && d.column.index === 2) d.cell.styles.halign = 'right'; },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setDrawColor(CB_RULE); doc.setLineWidth(0.6); doc.line(MG, y, rightX, y); y += 13;

  // ── Mode of Payment ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(M.body + 0.5); doc.setTextColor(CB_INK);
  doc.text('Mode of Payment', MG, y); y += M.body + 4.5;
  doc.setFont('helvetica', 'normal');
  if (m.payments.length > 0) {
    for (const p of m.payments) {
      doc.text(`${p.label} :`, MG, y);
      doc.text(p.amount, rightX, y, { align: 'right' });
      y += M.body + 4.5;
    }
  } else { doc.text('—', MG, y); y += M.body + 4.5; }
  y += 2;

  // ── Totals ──
  const tot = (label: string, value: string, bold = false, color = CB_INK) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? M.body + 1.5 : M.body + 0.5);
    doc.setTextColor(color);
    doc.text(label, MG, y);
    doc.text(value, rightX, y, { align: 'right' });
    y += M.body + 5.5;
  };
  tot('Total', m.grossTotal);
  if (m.hasDiscount) tot('Discount', `- ${m.discount}`, false, '#166534');
  if (m.hasTax) tot('GST', m.tax);
  if (m.hasRoundOff) tot('Round off', m.roundOff);
  if (!m.isCredit) {
    tot('Net Payable', m.netPayable, true);
    tot('Collected Amount', m.collected);
  }
  y += 2;
  doc.setDrawColor(CB_RULE); doc.setLineWidth(0.6); doc.line(MG, y, rightX, y); y += M.body + 5.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(M.body + 1.5); doc.setTextColor(CB_INK);
  doc.text(m.paidOrDueLabel, MG, y);
  doc.text(m.paidOrDueAmount, rightX, y, { align: 'right' }); y += M.body + 7;

  // ── Amount in words ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(M.body + 0.5); doc.setTextColor(CB_INK);
  for (const l of doc.splitTextToSize(`(In words: ${m.amountWords} Only)`, inner)) { doc.text(l, MG, y); y += M.body + 3; }
  y += 4;

  // ── Cashier signature — saved signature image above the name ──
  if (cashierSignatureDataUrl) {
    const sw = Math.min(96, inner * 0.55);
    try {
      doc.addImage(cashierSignatureDataUrl, 'PNG', MG, y, sw, sw * 0.27);
      y += sw * 0.27 + 4 + M.body;   // image box + gap + ascent of the name line
    } catch { /* signature optional */ }
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(M.body); doc.setTextColor(CB_INK);
  doc.text(cashierName ? `Cashier: ${cashierName}` : 'Cashier', MG, y); y += M.body + 6;

  // ── Closing note ──
  doc.setFont('helvetica', 'normal'); doc.setFontSize(M.small); doc.setTextColor('#555555');
  for (const l of doc.splitTextToSize('Computerized bill — no signature required', inner)) {
    doc.text(l, cx, y, { align: 'center' }); y += M.small + 2.5;
  }

  return y;
}

/** Plain rupee amount with Indian grouping, no currency symbol — matches
 *  the cash-bill style ("2,570" / "2,570.00"). */
function plain(n: number): string {
  const v = n ?? 0;
  const whole = Math.round(v) === v;
  return v.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** Short, traceable payment reference. A full transaction UUID (e.g. a wallet
 *  txn id) would overrun the amount and overlap the totals column, so long ids
 *  collapse to "#<last 8>"; short human refs (cheque no. etc.) pass through. */
function shortPayRef(ref: string | null | undefined): string {
  const r = (ref ?? '').trim();
  if (!r) return '';
  const short = r.length > 14 ? `#${r.replace(/-/g, '').slice(-8)}` : r;
  return `(${short})`;
}

function shortId(id: string | undefined | null): string {
  if (!id) return '—';
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}

function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Integer rupees → English words, Indian numbering (lakh/crore). */
function numberToWordsINR(num: number): string {
  if (!isFinite(num) || num <= 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const twoDigits = (n: number): string => {
    if (n < 20) return ones[n];
    return `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`;
  };
  const threeDigits = (n: number): string => {
    const h = Math.floor(n / 100), r = n % 100;
    return `${h ? ones[h] + ' Hundred' + (r ? ' ' : '') : ''}${r ? twoDigits(r) : ''}`;
  };
  let n = Math.floor(num);
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Lighten a hex accent toward white for table-head fills (modern style). */
function tint(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#eef2f7';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * 0.88);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Map an invoice-template config row → the template fields `generateInvoicePdf`
 *  consumes. Reused by every caller so the admin's choices apply everywhere. */
export function invoiceTemplateFieldsFrom(tpl: Record<string, unknown> | null | undefined): Partial<InvoicePdfInput> {
  if (!tpl) return {};
  return {
    template: (tpl['template'] as InvoiceTemplateStyle) || 'classic',
    paperSize: (tpl['paperSize'] as 'a4' | 'thermal') || 'a4',
    accentColor: (tpl['accentColor'] as string) || undefined,
    tagline: (tpl['tagline'] as string) || undefined,
    footerText: (tpl['footerText'] as string) || undefined,
    bankDetails: (tpl['bankDetails'] as string) || undefined,
    signatureLabel: (tpl['signatureLabel'] as string) || undefined,
    jurisdiction: (tpl['jurisdiction'] as string) || undefined,
    declaration: (tpl['declaration'] as string) || undefined,
  };
}

/** Fetch an image URL and return a PNG/JPEG data URL for jsPDF.addImage (which
 *  can't take a remote URL). Server-relative paths ("/uploads/…") are resolved
 *  against `baseUrl` (the API origin) so uploaded logos load in dev + prod.
 *  Returns undefined on any failure (logo optional). */
export async function loadImageDataUrl(url: string | null | undefined, baseUrl?: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  try {
    // "/uploads/…" logos are private — fetched with the session (upload-fetch.ts).
    const blob = await fetchAssetBlob(url, baseUrl ?? '');
    if (!blob) return undefined;
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

function formatMoney(n: number): string {
  return `Rs. ${(n ?? 0).toLocaleString('en-IN')}`;
}

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
