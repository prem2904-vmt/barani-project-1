import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ResolvedReportLayout,
  ResolvedRow,
  ResolvedSection,
} from '../models/report-layout.model';

/**
 * Render a downloadable A4 lab report PDF from the snapshot stored on
 * a Report row's `data` JSON. Built client-side with jsPDF — no server
 * round-trip — and mirrors the same structural rhythm as the invoice
 * PDF (header, patient/order block, items table, footer).
 *
 * When `resolvedLayouts` is supplied (a map of testId → ResolvedReportLayout
 * fetched from /api/report-layout/preview/:id), the per-test sections
 * render dynamically — column widths from `pv.columns`, navy header row,
 * row colors + bold from conditions, merged rows full-width grey/italic,
 * paragraph blocks, image grids, chart bars. Tests without a configured
 * layout fall through to the legacy "Test / Result / Unit / Reference /
 * Flag" table so unconfigured reports still produce a sensible PDF.
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
  /** Optional: per-test resolved layouts. When provided, the PDF renders
   *  the configured sections instead of the legacy parameter table. */
  resolvedLayouts?: Record<string, ResolvedReportLayout>;
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
  const { report, practice = {}, resolvedLayouts = {} } = input;
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

    for (const t of rows) {
      const layout = t.testId ? resolvedLayouts[t.testId] : undefined;
      if (layout && layout.sections.length > 0) {
        // Dynamic — admin-configured per-test layout.
        cursorY = renderResolvedTest(doc, t.name ?? layout.testName ?? 'Test', layout, cursorY);
      } else {
        // Fallback — legacy parameter table for tests without a layout.
        cursorY = renderLegacyTest(doc, t, cursorY);
      }
      cursorY += 6;
    }
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

// ──────────────────────────────────────────────────────────────
// Per-test renderers
// ──────────────────────────────────────────────────────────────

/**
 * Render a single test using its admin-configured ResolvedReportLayout.
 * Walks the resolved sections in order — grid, paragraph, image, chart —
 * and emits the PDF equivalent of the on-screen viewer. Returns the
 * cursorY after this test's content (so the next test can stack below).
 */
function renderResolvedTest(
  doc: jsPDF,
  testName: string,
  layout: ResolvedReportLayout,
  startY: number
): number {
  let y = startY;
  if (y > A4.h - 100) { doc.addPage(); y = 60; }

  // Test name as a small bold heading above its sections.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT);
  doc.text(testName, MARGIN, y + 12);
  y += 18;

  for (const sec of layout.sections) {
    if (!sec.isVisible) continue;
    if (y > A4.h - 80) { doc.addPage(); y = 60; }

    if (sec.label) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(MUTED);
      doc.text(sec.label.toUpperCase(), MARGIN, y + 9);
      y += 14;
    }

    switch (sec.type) {
      case 'grid':
        y = renderGridSection(doc, layout, sec, y);
        break;
      case 'paragraph':
        y = renderParagraphSection(doc, sec, y);
        break;
      case 'image':
        y = renderImageSection(doc, sec, y);
        break;
      case 'chart':
        y = renderChartSection(doc, sec, y);
        break;
    }
    y += 6;
  }
  return y;
}

/** Resolved grid section → autoTable with column widths from pv.columns,
 *  navy header row, alternating row backgrounds, row colors + bold from
 *  conditions, merged rows full-width grey/italic. */
function renderGridSection(
  doc: jsPDF,
  layout: ResolvedReportLayout,
  sec: ResolvedSection,
  startY: number
): number {
  const rows = sec.rows ?? [];
  if (rows.length === 0) return startY;

  // Compute column widths in points from the percentage-based widths in
  // pv.columns. Total available row width = A4.w - 2*MARGIN.
  const usable = A4.w - 2 * MARGIN;
  const colWidths = layout.columns.map(c => (c.width / 100) * usable);
  const head = [layout.columns.map(c => c.label)];

  // Each row → array of cell strings keyed by column.name. Merged rows
  // get a single string that spans all columns; autoTable's `colSpan`
  // is honored when we emit a 1-element row matching the head length
  // via a `didParseCell` hook approach. Simpler: emit a single cell with
  // colSpan pre-computed.
  type RowCell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const body: RowCell[][] = rows.map((r): RowCell[] => {
    if (r.isMerged) {
      return [{
        content: r.mergeContent ?? '',
        colSpan: layout.columns.length,
        styles: {
          fillColor: '#f1f5f9',
          textColor: '#475569',
          fontStyle: 'italic',
          halign: 'center',
          fontSize: 9
        }
      }];
    }
    const cells: RowCell[] = layout.columns.map(c => ({ content: r.cells[c.name] ?? '' }));
    if (r.color || r.isBold) {
      const styles: Record<string, unknown> = {};
      if (r.color) styles['textColor'] = r.color;
      if (r.isBold) styles['fontStyle'] = 'bold';
      cells.forEach(cell => { cell.styles = { ...(cell.styles ?? {}), ...styles }; });
    }
    return cells;
  });

  autoTable(doc, {
    startY,
    head,
    body: body as unknown as Array<Array<string | RowCell>>,
    margin: { left: MARGIN, right: MARGIN },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: TEXT },
    headStyles: {
      fillColor: '#1B3A6B',
      textColor: '#ffffff',
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'left'
    },
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: { fillColor: '#F7F9FC' },
    columnStyles: layout.columns.reduce((acc, _c, i) => {
      acc[i] = { cellWidth: colWidths[i] };
      return acc;
    }, {} as Record<number, { cellWidth: number }>)
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}

/** Resolved paragraph section → wrapped text block. */
function renderParagraphSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const text = sec.content ?? '';
  if (!text.trim()) return startY;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(TEXT);
  const usable = A4.w - 2 * MARGIN;
  const lines = doc.splitTextToSize(text, usable);
  doc.text(lines, MARGIN, startY + 11);
  return startY + 11 + lines.length * 12 + 4;
}

/** Resolved image section → grid of attached images, max 2 per row. */
function renderImageSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const urls = sec.imageUrls ?? [];
  if (urls.length === 0) return startY;
  // jsPDF can't fetch + decode async cross-origin images here without
  // turning the whole renderer async. For now we leave a placeholder
  // line so the caller knows where images would go. (Can swap to real
  // image embeds via doc.addImage(dataUrl, …) once the report endpoint
  // returns base64-encoded thumbnails.)
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(`[ ${urls.length} attached image${urls.length === 1 ? '' : 's'} ]`, MARGIN, startY + 11);
  return startY + 18;
}

/** Resolved chart section → horizontal bar with colored zones + marker. */
function renderChartSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const chart = sec.chart;
  if (!chart || chart.max <= chart.min) return startY;

  const barX = MARGIN;
  const barY = startY + 6;
  const barW = A4.w - 2 * MARGIN;
  const barH = 12;

  // Bar background
  doc.setFillColor('#f1f5f9');
  doc.roundedRect(barX, barY, barW, barH, 4, 4, 'F');

  // Zones
  const range = chart.max - chart.min;
  for (const z of chart.zones) {
    const left  = ((z.from - chart.min) / range) * barW;
    const width = ((z.to - z.from) / range) * barW;
    if (width <= 0) continue;
    doc.setFillColor(zoneHexForPdf(z.color));
    doc.rect(barX + left, barY, width, barH, 'F');
  }

  // Marker
  if (chart.value !== null && chart.value !== undefined) {
    const mx = barX + ((chart.value - chart.min) / range) * barW;
    doc.setFillColor('#0f172a');
    doc.rect(mx - 1.5, barY - 3, 3, barH + 6, 'F');
  }

  // Axis labels
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(String(chart.min), barX, barY + barH + 12);
  if (chart.value !== null && chart.value !== undefined) {
    doc.text(String(chart.value), barX + barW / 2, barY + barH + 12, { align: 'center' });
  }
  doc.text(String(chart.max), barX + barW, barY + barH + 12, { align: 'right' });

  return barY + barH + 18;
}

/** Token-or-hex → hex for jsPDF's setFillColor. Pastel zones for chart. */
function zoneHexForPdf(token: string): string {
  if (token === 'red')    return '#fecaca';
  if (token === 'orange') return '#fed7aa';
  if (token === 'green')  return '#bbf7d0';
  return token.startsWith('#') ? token : '#e2e8f0';
}

/** Legacy renderer — used when a test has no admin-configured layout. */
function renderLegacyTest(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  startY: number
): number {
  let y = startY;
  if (y > A4.h - 80) { doc.addPage(); y = 60; }

  const values = t.result?.['values'] as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string }> | undefined;
  const tableRows: string[][] = [];
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

  autoTable(doc, {
    startY: y,
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
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
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
