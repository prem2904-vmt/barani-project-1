import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Render a downloadable A4 lab report PDF from the snapshot stored on
 * a Report row's `data` JSON. Built client-side with jsPDF — no server
 * round-trip — and mirrors the same structural rhythm as the invoice
 * PDF (header, patient/order block, items table, footer).
 */
export interface ReportPdfInput {
  /** ReportEntity-like row. We only need a few fields. */
  report: {
    id: string;
    type: string;
    createdAt?: string;
    data?: string | null;
  };
  /** Display-only practice letterhead. Wire to a real config later. */
  practice?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    nablNumber?: string;
  };
}

interface ReportSnapshot {
  patient?: {
    displayName?: string;
    age?: number | string;
    sex?: string;
    phone?: string;
  };
  order?: {
    id?: string;
    createdAt?: string;
    priority?: string;
    refDoctorName?: string;
  };
  type?: string;
  isPartial?: boolean;
  pendingDepts?: string[];
  tests?: Array<{
    testId?: string;
    name?: string;
    department?: string;
    departmentCode?: string;
    status?: string;
    result?: Record<string, unknown> | null;
    resultedAt?: string;
    validatedAt?: string;
  }>;
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 36;
const ACCENT = '#8b5cf6';
const TEXT = '#0f172a';
const MUTED = '#64748b';

export function generateReportPdf(input: ReportPdfInput) {
  const { report, practice = {} } = input;
  const snap = parseSnapshot(report.data);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // ── Header ──────────────────────────────────────────────────
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, A4.w, 6, 'F');

  doc.setTextColor(TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(practice.name ?? 'Prefrontal Lab', MARGIN, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  let y = 64;
  for (const line of [
    practice.address ?? '',
    [practice.phone, practice.email].filter(Boolean).join(' · '),
    practice.nablNumber ? `NABL: ${practice.nablNumber}` : ''
  ].filter(Boolean)) {
    doc.text(line, MARGIN, y);
    y += 12;
  }

  // Right-aligned: report number + type + date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(ACCENT);
  doc.text(snap.isPartial ? 'PRELIMINARY REPORT' : 'LAB REPORT',
    A4.w - MARGIN, 48, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT);
  doc.text(`#${report.id.replace(/-/g, '').slice(-8).toUpperCase()}`,
    A4.w - MARGIN, 64, { align: 'right' });
  doc.setTextColor(MUTED);
  doc.text(formatDate(report.createdAt), A4.w - MARGIN, 78, { align: 'right' });

  // Divider
  doc.setDrawColor('#e2e8f0');
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 108, A4.w - MARGIN, 108);

  // ── Patient + order block (two columns) ─────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text('PATIENT', MARGIN, 128);
  doc.text('ORDER', A4.w / 2, 128);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(TEXT);
  doc.text(snap.patient?.displayName ?? '—', MARGIN, 145);
  doc.text(`#${(snap.order?.id ?? '').replace(/-/g, '').slice(-8).toUpperCase() || '—'}`, A4.w / 2, 145);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const ageSex = [
    snap.patient?.age != null ? `${snap.patient.age}y` : '',
    snap.patient?.sex ?? ''
  ].filter(Boolean).join(' · ');
  if (ageSex) doc.text(ageSex, MARGIN, 159);
  if (snap.patient?.phone) doc.text(`Phone: ${snap.patient.phone}`, MARGIN, 171);

  if (snap.order?.createdAt) {
    doc.text(`Collected: ${formatDate(snap.order.createdAt)}`, A4.w / 2, 159);
  }
  if (snap.order?.refDoctorName) {
    doc.text(`Ref doctor: ${snap.order.refDoctorName}`, A4.w / 2, 171);
  }

  // ── Tests table — grouped by department ─────────────────────
  // jsPDF-autotable doesn't natively group, so we render
  // dept-headed sub-tables sequentially.
  const tests = snap.tests ?? [];
  const byDept = groupBy(tests, t => t.department ?? 'Tests');
  let cursorY = 195;

  for (const [dept, rows] of byDept.entries()) {
    if (cursorY > A4.h - 100) { doc.addPage(); cursorY = 60; }
    // Dept header strip
    doc.setFillColor('#f5f3ff');
    doc.rect(MARGIN, cursorY, A4.w - 2 * MARGIN, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(ACCENT);
    doc.text(dept.toUpperCase(), MARGIN + 8, cursorY + 12);
    cursorY += 18;

    // Build table rows: one row per parameter (or a single row if no
    // parameters), pulling values out of result.values[paramName].
    const tableRows: string[][] = [];
    for (const t of rows) {
      const values = t.result?.['values'] as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string }> | undefined;
      if (values && Object.keys(values).length > 0) {
        for (const [paramName, v] of Object.entries(values)) {
          tableRows.push([
            `${t.name ?? '—'} · ${paramName}`,
            String(v?.value ?? '—'),
            v?.unit ?? '—',
            v?.range ?? '—',
            v?.flag ?? '—'
          ]);
        }
      } else {
        tableRows.push([t.name ?? '—', '—', '—', '—', '—']);
      }
    }

    autoTable(doc, {
      startY: cursorY,
      head: [['Test / Parameter', 'Result', 'Unit', 'Reference', 'Flag']],
      body: tableRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: TEXT },
      headStyles: {
        fillColor: '#f8fafc',
        textColor: MUTED,
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'left'
      },
      bodyStyles: { fillColor: '#ffffff' },
      alternateRowStyles: { fillColor: '#fafafa' },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 75, halign: 'right', fontStyle: 'bold' },
        2: { cellWidth: 50, halign: 'center' },
        3: { cellWidth: 90, halign: 'center' },
        4: { cellWidth: 50, halign: 'center' }
      }
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  // ── Pending-depts banner (preliminary reports only) ─────────
  if (snap.isPartial && (snap.pendingDepts?.length ?? 0) > 0) {
    if (cursorY > A4.h - 80) { doc.addPage(); cursorY = 60; }
    doc.setFillColor('#fef3c7');
    doc.rect(MARGIN, cursorY, A4.w - 2 * MARGIN, 28, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor('#92400e');
    doc.text(`Other departments still pending: ${snap.pendingDepts!.join(', ')}`,
      MARGIN + 10, cursorY + 18);
    cursorY += 32;
  }

  // ── Footer ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(
    snap.isPartial
      ? 'Preliminary report — findings will be superseded by the final report.'
      : 'Computer-generated report. Verified by the lab pathologist.',
    A4.w / 2, A4.h - 24, { align: 'center' });

  // Filename: REPORT-INV-XXXX.pdf or PRELIM-XXXX.pdf
  const tag = snap.isPartial ? 'PRELIM' : 'REPORT';
  const shortId = report.id.replace(/-/g, '').slice(-8).toUpperCase();
  doc.save(`${tag}-${shortId}.pdf`);
}

function parseSnapshot(raw: string | null | undefined): ReportSnapshot {
  if (!raw) return {};
  try { return JSON.parse(raw) as ReportSnapshot; } catch { return {}; }
}

function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd} ${months[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}
