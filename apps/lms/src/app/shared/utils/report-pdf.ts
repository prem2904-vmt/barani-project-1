import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ReportColumn,
  ResolvedReportLayout,
  ResolvedRow,
  ResolvedSection,
} from '../models/report-layout.model';

/**
 * Render an A4 lab report PDF in the Drlogy template style — blue
 * accent (#0066CC), bold-uppercase "LAB NAME" wordmark, three-column
 * patient block with vertical separators (no background fills), centered
 * uppercase test name between hairlines, plain-text column headers with
 * a single underline rule, white body rows (no zebra), inline RED
 * "High"/"Low" tags beside the result, three-column signature footer,
 * and "****End of Report****" closing marker.
 *
 * Layouts that pre-configure per-test sections (grid/paragraph/image/
 * chart) are honored. Empty columns are dropped automatically so an
 * unused "Specimen" cell never leaves an empty column behind. Tests
 * without a configured layout fall through to a four-column legacy
 * table that mirrors the Drlogy shape (Investigation · Result ·
 * Reference Value · Unit).
 */
export interface ReportPdfInput {
  /** ReportEntity-like row. We only need a few fields. */
  report: {
    id: string;
    type: string;
    createdAt?: string;
    data?: string | null;
  };
  /** Practice letterhead — fed from /practice-settings. */
  practice?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    nablNumber?: string;
    /** Up to three sign-off lines for the footer. */
    sigLabTechName?: string;
    sigLabTechTitle?: string;
    sigPathologist1Name?: string;
    sigPathologist1Title?: string;
    sigPathologist2Name?: string;
    sigPathologist2Title?: string;
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
    /** Specimen / sample type — pulled from TestEntity.Parameters JSON
     *  during snapshot build. Rendered once below each test name; we
     *  no longer carry it as a per-row column. */
    sampleType?: string | null;
    status?: string;
    result?: Record<string, unknown> | null;
    resultedAt?: string;
    validatedAt?: string;
  }>;
}

// ── Page geometry ─────────────────────────────────────────────────
const A4 = { w: 595.28, h: 841.89 };
const MARGIN_X = 30;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 110; // reserves room for the 3-column sig block

// ── Drlogy palette ────────────────────────────────────────────────
const BLUE = '#0066CC';        // Wordmark "LAB", taglines, accent rules
const BLUE_DARK = '#003F8F';   // Hover/secondary blue (rarely used)
const BLACK = '#000000';
const TEXT = '#1a1a1a';
const TEXT_DIM = '#666666';
const HAIR = '#cccccc';
const FLAG_RED = '#dc2626';    // "High" / critical
const FLAG_BLUE = '#2563eb';   // "Low"

export function generateReportPdf(input: ReportPdfInput) {
  const { report, practice = {}, resolvedLayouts = {} } = input;
  const snap = parseSnapshot(report.data);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  drawLetterhead(doc, practice);
  const patientBottom = drawPatientBlock(doc, snap, report);

  // ── Body — grouped by department ───────────────────────────────
  const tests = snap.tests ?? [];
  const byDept = groupBy(tests, t => t.department ?? 'Tests');
  let cursorY = patientBottom + 14;

  for (const [dept, rows] of byDept.entries()) {
    if (cursorY > A4.h - MARGIN_BOTTOM - 90) { cursorY = newPage(doc, practice); }
    // Drlogy doesn't use coloured dept strips — they just put the dept
    // name as small uppercase blue text above the test, OR omit it
    // entirely. Use a thin blue label so multi-dept reports stay readable.
    if (byDept.size > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(BLUE);
      doc.text(dept.toUpperCase(), MARGIN_X, cursorY);
      cursorY += 12;
    }

    for (const t of rows) {
      const layout = t.testId ? resolvedLayouts[t.testId] : undefined;
      if (layout && layout.sections.length > 0) {
        cursorY = renderResolvedTest(doc, t, layout, cursorY, practice);
      } else {
        cursorY = renderLegacyTest(doc, t, cursorY, practice);
      }
      cursorY += 10;
    }
  }

  // ── Pending-depts banner (preliminary only) ────────────────────
  if (snap.isPartial && (snap.pendingDepts?.length ?? 0) > 0) {
    if (cursorY > A4.h - MARGIN_BOTTOM - 60) { cursorY = newPage(doc, practice); }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor('#92400e');
    doc.text(`Other departments still pending: ${snap.pendingDepts!.join(', ')}`,
      MARGIN_X, cursorY + 10);
    cursorY += 22;
  }

  // ── "Thanks for Reference  ...  ****End of Report****" line ────
  if (cursorY > A4.h - MARGIN_BOTTOM - 26) { cursorY = newPage(doc, practice); }
  drawEndOfReport(doc, snap, cursorY);

  // ── Signature footer + page numbers (every page, drawn last) ───
  drawSignatureFooter(doc, practice, snap);

  const tag = snap.isPartial ? 'PRELIM' : 'REPORT';
  const shortId = report.id.replace(/-/g, '').slice(-8).toUpperCase();
  doc.save(`${tag}-${shortId}.pdf`);
}

// ──────────────────────────────────────────────────────────────
// Letterhead — "LAB NAME" wordmark, address, phone, web band
// ──────────────────────────────────────────────────────────────

function drawLetterhead(doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>) {
  // Small blue logo disc (left)
  doc.setFillColor(BLUE);
  doc.circle(MARGIN_X + 14, MARGIN_TOP + 14, 14, 'F');
  // Inner white "+" mark
  doc.setFillColor('#ffffff');
  doc.rect(MARGIN_X + 13, MARGIN_TOP + 8,  2, 12, 'F');
  doc.rect(MARGIN_X + 8,  MARGIN_TOP + 13, 12, 2, 'F');

  // Wordmark — first word black bold, "PATHOLOGY LAB" blue bold.
  // We split the practice name on spaces and recolour the first token
  // to mimic Drlogy's "DRLOGY PATHOLOGY LAB" treatment without
  // forcing the words.
  const fullName = (practice.name ?? 'Prefrontal Pathology Lab').toUpperCase();
  const tokens = fullName.split(' ');
  const firstWord = tokens[0];
  const rest = tokens.slice(1).join(' ');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BLACK);
  const wordmarkX = MARGIN_X + 36;
  const wordmarkY = MARGIN_TOP + 18;
  doc.text(firstWord, wordmarkX, wordmarkY);
  const firstW = doc.getTextWidth(firstWord + ' ');
  doc.setTextColor(BLUE);
  doc.text(rest, wordmarkX + firstW, wordmarkY);

  // Tagline beneath wordmark
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  doc.text('Accurate', wordmarkX, wordmarkY + 14);
  const wA = doc.getTextWidth('Accurate ');
  doc.setTextColor(BLUE);
  doc.text('|', wordmarkX + wA, wordmarkY + 14);
  doc.setTextColor(BLACK);
  doc.text(' Caring', wordmarkX + wA + 4, wordmarkY + 14);
  const wB = doc.getTextWidth('Accurate | Caring ');
  doc.setTextColor(BLUE);
  doc.text('|', wordmarkX + wB, wordmarkY + 14);
  doc.setTextColor(BLACK);
  doc.text(' Instant', wordmarkX + wB + 4, wordmarkY + 14);

  // Right side: phone + email
  const rightX = A4.w - MARGIN_X;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  if (practice.phone) {
    doc.text(practice.phone, rightX, MARGIN_TOP + 14, { align: 'right' });
  }
  if (practice.email) {
    doc.text(practice.email, rightX, MARGIN_TOP + 28, { align: 'right' });
  }

  // Address line — small dim text spanning full width below the wordmark
  const addressY = MARGIN_TOP + 46;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DIM);
  if (practice.address) {
    doc.text(practice.address, MARGIN_X, addressY);
  }

  // Blue chevron band — a flat blue strip with a thin white slash motif.
  // jsPDF can't paint complex zigzags cheaply, so we approximate with
  // a flat blue band and a small "www" pill on the right.
  const bandY = MARGIN_TOP + 54;
  doc.setFillColor(BLUE);
  doc.rect(MARGIN_X, bandY, A4.w - 2 * MARGIN_X, 4, 'F');

  if (practice.website) {
    // Small white pill on the right with the website text in blue.
    const w = doc.getTextWidth(practice.website) + 12;
    doc.setFillColor('#ffffff');
    doc.rect(A4.w - MARGIN_X - w, bandY - 3, w, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(BLUE);
    doc.text(practice.website, A4.w - MARGIN_X - 6, bandY + 5.5, { align: 'right' });
  }
}

// ──────────────────────────────────────────────────────────────
// Patient block — three columns with thin vertical separators
// ──────────────────────────────────────────────────────────────

function drawPatientBlock(
  doc: jsPDF,
  snap: ReportSnapshot,
  report: ReportPdfInput['report']
): number {
  const top = MARGIN_TOP + 70;
  const blockH = 80;
  const w = A4.w - 2 * MARGIN_X;
  const col1W = w * 0.36;
  const col2W = w * 0.36;
  const col3W = w * 0.28;

  // Top + bottom hairlines (no background fill — Drlogy style)
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, top, A4.w - MARGIN_X, top);
  doc.line(MARGIN_X, top + blockH, A4.w - MARGIN_X, top + blockH);

  // Vertical separators between the three columns
  doc.line(MARGIN_X + col1W, top + 6, MARGIN_X + col1W, top + blockH - 6);
  doc.line(MARGIN_X + col1W + col2W, top + 6, MARGIN_X + col1W + col2W, top + blockH - 6);

  // ── Col 1 — Patient identity ──
  const x1 = MARGIN_X + 10;
  let y = top + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(BLACK);
  doc.text(snap.patient?.displayName ?? '—', x1, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  if (snap.patient?.age != null) {
    doc.text(`Age : ${snap.patient.age} Years`, x1, y);
    y += 12;
  }
  if (snap.patient?.sex) {
    doc.text(`Sex : ${snap.patient.sex}`, x1, y);
    y += 12;
  }
  const pid = (snap.order?.id ?? '').replace(/-/g, '').slice(-8).toUpperCase();
  if (pid) {
    doc.text(`PID : ${pid}`, x1, y);
  }

  // ── Col 2 — Specimens collected + Ref doctor ──
  const x2 = MARGIN_X + col1W + 10;
  y = top + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(BLUE);
  doc.text('Specimen(s) :', x2, y);
  y += 13;

  // Roll up unique specimens across all tests in the order so the
  // sample type IS visible somewhere even if a particular layout
  // doesn't echo it. Falls back to a "Phone:" line if nothing was
  // captured (older snapshots).
  const specimens = Array.from(new Set(
    (snap.tests ?? [])
      .map(t => (t.sampleType ?? '').trim())
      .filter(s => s.length > 0)
  ));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  if (specimens.length > 0) {
    const text = specimens.join(', ');
    const lines = doc.splitTextToSize(text, col2W - 20);
    doc.text(lines, x2, y);
    y += lines.length * 11 + 6;
  } else if (snap.patient?.phone) {
    doc.text(`Phone: ${snap.patient.phone}`, x2, y);
    y += 14;
  }

  if (snap.order?.refDoctorName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(BLACK);
    doc.text('Ref. By: ', x2, y);
    const refW = doc.getTextWidth('Ref. By: ');
    doc.setFont('helvetica', 'bold');
    doc.text(snap.order.refDoctorName, x2 + refW, y);
  }

  // ── Col 3 — Sample IDs + registration/collection/report times ──
  const x3 = MARGIN_X + col1W + col2W + 10;
  y = top + 14;
  // Tiny barcode-style placeholder: a row of black bars to evoke a barcode.
  drawBarcodePlaceholder(doc, x3, y, col3W - 20, 18);
  // Sample ID number under the barcode
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(BLACK);
  const barcodeText = pid || (report.id.replace(/-/g, '').slice(-12).toUpperCase());
  doc.text(barcodeText, x3 + (col3W - 20) / 2, y + 26, { align: 'center' });
  y += 36;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(BLACK);
  const drawTimeLine = (label: string, value: string) => {
    if (!value) return;
    doc.setFont('helvetica', 'normal');
    doc.text(label, x3, y);
    const labelW = doc.getTextWidth(label);
    doc.setFont('helvetica', 'bold');
    doc.text(value, x3 + labelW + 2, y);
    y += 11;
  };
  drawTimeLine('Registered on: ', formatShort(snap.order?.createdAt));
  drawTimeLine('Collected on: ',  formatShort(snap.order?.createdAt));
  drawTimeLine('Reported on: ',   formatShort(report.createdAt));

  return top + blockH;
}

/** Cheap visual stand-in for a Code-128 barcode — black bars of
 *  varying widths in a band. Good enough for a printed report; a real
 *  barcode can be wired up later with a font or canvas pass. */
function drawBarcodePlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(BLACK);
  const widths = [1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 2, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 2];
  let cx = x;
  let i = 0;
  while (cx < x + w - 2) {
    const bw = widths[i % widths.length];
    const gap = (i % 3 === 0) ? 1.5 : 1;
    doc.rect(cx, y, bw, h, 'F');
    cx += bw + gap;
    i++;
  }
}

// ──────────────────────────────────────────────────────────────
// Per-test renderers — Drlogy table style (plain header + hairline)
// ──────────────────────────────────────────────────────────────

function renderResolvedTest(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  layout: ResolvedReportLayout,
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 70) { y = newPage(doc, practice); }

  drawTestHeading(doc, t.name ?? layout.testName ?? 'Test', y);
  y += 26;

  for (const sec of layout.sections) {
    if (!sec.isVisible) continue;
    if (y > A4.h - MARGIN_BOTTOM - 40) { y = newPage(doc, practice); }

    switch (sec.type) {
      case 'grid':
        y = renderGridSection(doc, layout, sec, t, y);
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
    y += 4;
  }
  return y;
}

/** Drlogy-style centered uppercase test name. */
function drawTestHeading(doc: jsPDF, name: string, y: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(BLACK);
  doc.text(name.toUpperCase(), A4.w / 2, y + 14, { align: 'center' });
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y + 22, A4.w - MARGIN_X, y + 22);
}

/** Resolved grid section → Drlogy 4-column shape.
 *
 *  Empty columns are dropped automatically; a synthesized "Investigation"
 *  column is prepended whenever the layout doesn't already include a
 *  parameter-name column. Bold result cells get red/blue inline color
 *  when the engine's conditions paint the row.
 *
 *  Specimen / sample type (per-test) is rendered as a small dim
 *  italic line BENEATH the test name in the parameter cell, not as a
 *  separate column — matching Drlogy ("CREATININE, SERUM" with
 *  "Compensated Jaffe's reaction, IDMS traceable" italic below). */
function renderGridSection(
  doc: jsPDF,
  layout: ResolvedReportLayout,
  sec: ResolvedSection,
  t: NonNullable<ReportSnapshot['tests']>[number],
  startY: number
): number {
  const rows = sec.rows ?? [];
  if (rows.length === 0) return startY;
  const bodyRows = rows.filter(r => !r.isMerged);

  // ── Step 1. Drop columns that are empty across every body row ──
  // (specimen-as-text with no template ends up as "" — gone.)
  const liveColumns: ReportColumn[] = layout.columns.filter(c => {
    if (bodyRows.length === 0) return true;
    return bodyRows.some(r => {
      const v = r.cells[c.name];
      return v != null && String(v).trim() !== '';
    });
  });
  const cols = liveColumns.length > 0 ? liveColumns : layout.columns.slice(1); // never the whole "all empty" list

  // ── Step 2. Synthesize Investigation column if needed ──
  // Show it whenever any row has a `parameterName` AND that name isn't
  // already echoed verbatim by some existing cell. The previous
  // "unique-cells" heuristic was unreliable for single-row tests
  // (a single value is trivially unique), so we check the actual
  // parameter-name overlap directly.
  const showInvestigation = (() => {
    if (bodyRows.length === 0) return false;
    const anyName = bodyRows.some(r => (r.parameterName ?? '').trim().length > 0);
    if (!anyName) return false;
    const layoutAlreadyShowsName = bodyRows.every(r => {
      const pn = (r.parameterName ?? '').trim().toLowerCase();
      if (!pn) return true;
      return cols.some(c => (r.cells[c.name] ?? '').trim().toLowerCase() === pn);
    });
    return !layoutAlreadyShowsName;
  })();

  // ── Step 3. Compute widths in pts (Drlogy uses generous Investigation, narrow Unit) ──
  const usable = A4.w - 2 * MARGIN_X;
  const investWidth = showInvestigation ? 0.32 * usable : 0;
  const remaining = usable - investWidth;
  const totalPct = cols.reduce((s, c) => s + c.width, 0) || 1;
  const dataColWidths = cols.map(c => (c.width / totalPct) * remaining);

  // ── Step 4. Build head + body ──
  type RowCell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const head: RowCell[][] = [[
    ...(showInvestigation ? [{ content: 'Investigation', styles: { halign: 'left' as const } }] : []),
    ...cols.map((c, i) => ({ content: titleCaseHeader(c.label), styles: { halign: (i === 0 && !showInvestigation ? 'left' : alignFor(c.type)) as 'left' | 'right' | 'center' } })),
  ]];

  const totalCols = (showInvestigation ? 1 : 0) + cols.length;
  // Prefer the snapshot's sampleType when present; otherwise fall back
  // to the layout's sampleType (which the engine fills from the test's
  // Parameters JSON). This lets older reports — whose snapshot was
  // serialised before per-test sampleType was tracked — still show the
  // specimen line as long as the layout response carries it.
  const sampleTypeLine = ((t.sampleType ?? layout.sampleType) ?? '').trim();

  const body: RowCell[][] = rows.map((r, idx): RowCell[] => {
    if (r.isMerged) {
      return [{
        content: r.mergeContent ?? '',
        colSpan: totalCols,
        styles: {
          fillColor: '#f8fafc',
          textColor: TEXT,
          fontStyle: 'italic',
          halign: 'center',
          fontSize: 8.5
        }
      }];
    }
    // Bold parameter name + (only on first non-merged row) the sample-type sub-line in italic.
    const isFirstBodyRow = bodyRows.length > 0 && bodyRows[0].id === r.id;
    const paramTitle = humanize(r.parameterName ?? '');
    const investContent = isFirstBodyRow && sampleTypeLine
      ? `${paramTitle}\n${sampleTypeLine}`
      : paramTitle;
    const investCell: RowCell[] = showInvestigation
      ? [{ content: investContent, styles: { fontStyle: 'bold', textColor: BLACK, fontSize: 9 } }]
      : [];

    const dataCells: RowCell[] = cols.map(c => {
      const value = r.cells[c.name] ?? '';
      const styles: Record<string, unknown> = {};
      if (c.type === 'result') {
        styles['fontStyle'] = 'bold';
        styles['textColor'] = r.color ?? BLACK;
      } else if (r.color && (c.type === 'flag')) {
        styles['fontStyle'] = 'bold';
        styles['textColor'] = r.color;
      } else {
        styles['textColor'] = TEXT;
      }
      // If this is the result column and the row is colored, render
      // "value  High/Low" inline (Drlogy pattern) instead of a separate flag col.
      if (c.type === 'result' && r.color && !showsFlagColumn(cols)) {
        const tag = flagLabel(r);
        if (tag) {
          return { content: `${value}    ${tag}`, styles };
        }
      }
      return { content: value, styles };
    });
    return [...investCell, ...dataCells];
  });

  // Drop the synthetic Flag column if the layout already has one and any
  // row colors are mapped onto it; otherwise let the result-cell inline tag
  // do the job. (No separate flag column emitted here.)
  const columnStyles: Record<number, { cellWidth: number; halign?: string }> = {};
  let idx = 0;
  if (showInvestigation) {
    columnStyles[idx++] = { cellWidth: investWidth, halign: 'left' };
  }
  cols.forEach((c, i) => {
    columnStyles[idx++] = { cellWidth: dataColWidths[i], halign: alignFor(c.type) };
  });

  autoTable(doc, {
    startY,
    head: head as unknown as Array<Array<string | RowCell>>,
    body: body as unknown as Array<Array<string | RowCell>>,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
      textColor: TEXT,
      lineColor: HAIR,
      lineWidth: 0,
    },
    headStyles: {
      fillColor: '#ffffff',
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: 10,
      halign: 'left',
      cellPadding: { top: 4, right: 6, bottom: 8, left: 6 },
      lineColor: HAIR,
      lineWidth: { top: 0, right: 0, bottom: 0.5, left: 0 } as unknown as number,
    },
    bodyStyles: { fillColor: '#ffffff' },
    columnStyles: columnStyles as unknown as Record<number, { cellWidth: number }>,
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}

/** True if the layout includes any flag-type column. When it does, the
 *  renderer leaves the inline tag off the result cell. */
function showsFlagColumn(cols: ReportColumn[]): boolean {
  return cols.some(c => c.type === 'flag');
}

/** Resolved paragraph section → wrapped text block. */
function renderParagraphSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const text = sec.content ?? '';
  if (!text.trim()) return startY;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT);
  const usable = A4.w - 2 * MARGIN_X;
  const lines = doc.splitTextToSize(text, usable);
  let y = startY + 11;
  for (const ln of lines) {
    if (y > A4.h - MARGIN_BOTTOM - 12) { y = newPage(doc, {}) + 6; }
    doc.text(ln, MARGIN_X, y);
    y += 12;
  }
  return y + 2;
}

function renderImageSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const urls = sec.imageUrls ?? [];
  if (urls.length === 0) return startY;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT_DIM);
  doc.text(`[ ${urls.length} attached image${urls.length === 1 ? '' : 's'} ]`, MARGIN_X, startY + 11);
  return startY + 18;
}

function renderChartSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const chart = sec.chart;
  if (!chart || chart.max <= chart.min) return startY;

  const barX = MARGIN_X;
  const barY = startY + 6;
  const barW = A4.w - 2 * MARGIN_X;
  const barH = 11;

  doc.setFillColor('#f1f5f9');
  doc.roundedRect(barX, barY, barW, barH, 4, 4, 'F');

  const range = chart.max - chart.min;
  for (const z of chart.zones) {
    const left  = ((z.from - chart.min) / range) * barW;
    const width = ((z.to - z.from) / range) * barW;
    if (width <= 0) continue;
    doc.setFillColor(zoneHexForPdf(z.color));
    doc.rect(barX + left, barY, width, barH, 'F');
  }

  if (chart.value !== null && chart.value !== undefined) {
    const mx = barX + ((chart.value - chart.min) / range) * barW;
    doc.setFillColor(BLUE);
    doc.rect(mx - 1.5, barY - 3, 3, barH + 6, 'F');
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DIM);
  doc.text(String(chart.min), barX, barY + barH + 12);
  if (chart.value !== null && chart.value !== undefined) {
    doc.text(String(chart.value), barX + barW / 2, barY + barH + 12, { align: 'center' });
  }
  doc.text(String(chart.max), barX + barW, barY + barH + 12, { align: 'right' });

  return barY + barH + 18;
}

/** Legacy renderer — used when a test has no admin-configured layout.
 *  Drlogy 4-column shape: Investigation · Result · Reference Value · Unit.
 *  Inline RED "High"/blue "Low" tag in the Result cell. */
function renderLegacyTest(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 70) { y = newPage(doc, practice); }

  drawTestHeading(doc, t.name ?? '—', y);
  y += 26;

  const values = t.result?.['values'] as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string }> | undefined;
  type LCell = { content: string; styles?: Record<string, unknown> };
  const tableRows: LCell[][] = [];
  const sampleTypeLine = (t.sampleType ?? '').trim();
  const entries = values ? Object.entries(values) : [];

  if (entries.length > 0) {
    entries.forEach(([paramName, v], i) => {
      const flag = (v?.flag ?? '').toUpperCase();
      const flagText = flag === 'H' ? 'High' : flag === 'L' ? 'Low' : flag === 'C' ? 'Critical' : '';
      const valueText = String(v?.value ?? '—');
      const investContent = (i === 0 && sampleTypeLine)
        ? `${humanize(paramName)}\n${sampleTypeLine}`
        : humanize(paramName);
      const resultStyles: Record<string, unknown> = {
        fontStyle: 'bold',
        textColor: flagText === 'Low' ? FLAG_BLUE : flagText ? FLAG_RED : BLACK,
      };
      tableRows.push([
        { content: investContent, styles: { fontStyle: 'bold', textColor: BLACK } },
        { content: flagText ? `${valueText}    ${flagText}` : valueText, styles: resultStyles },
        { content: v?.range ?? '—' },
        { content: v?.unit ?? '—' },
      ]);
    });
  } else {
    tableRows.push([{ content: 'No parameters recorded.', styles: { halign: 'center', fontStyle: 'italic', textColor: TEXT_DIM } }]);
  }

  autoTable(doc, {
    startY: y,
    head: [['Investigation', 'Result', 'Reference Value', 'Unit']],
    body: tableRows as unknown as Array<Array<string | LCell>>,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
      textColor: TEXT,
      lineColor: HAIR,
      lineWidth: 0,
    },
    headStyles: {
      fillColor: '#ffffff',
      textColor: BLACK,
      fontStyle: 'bold',
      fontSize: 10,
      halign: 'left',
      cellPadding: { top: 4, right: 6, bottom: 8, left: 6 },
      lineColor: HAIR,
      lineWidth: { top: 0, right: 0, bottom: 0.5, left: 0 } as unknown as number,
    },
    bodyStyles: { fillColor: '#ffffff' },
    columnStyles: {
      0: { cellWidth: 180 },
      1: { cellWidth: 130, fontStyle: 'bold' },
      2: { cellWidth: 130 },
      3: { cellWidth: 'auto' as unknown as number },
    },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}

// ──────────────────────────────────────────────────────────────
// "Thanks for Reference  ...  ****End of Report****"
// ──────────────────────────────────────────────────────────────

function drawEndOfReport(doc: jsPDF, snap: ReportSnapshot, startY: number) {
  const y = startY + 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  doc.text('Thanks for Reference', MARGIN_X, y);
  doc.text(snap.isPartial ? '****End of Preliminary Report****' : '****End of Report****',
    A4.w / 2, y, { align: 'center' });
}

// ──────────────────────────────────────────────────────────────
// Three-column signature footer — runs on every page
// ──────────────────────────────────────────────────────────────

function drawSignatureFooter(
  doc: jsPDF,
  practice: NonNullable<ReportPdfInput['practice']>,
  snap: ReportSnapshot
) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawSigFooterPage(doc, practice, snap, i, total);
  }
}

function drawSigFooterPage(
  doc: jsPDF,
  practice: NonNullable<ReportPdfInput['practice']>,
  snap: ReportSnapshot,
  pageNo: number,
  pageTotal: number
) {
  const sigY = A4.h - 86;
  const sigsW = A4.w - 2 * MARGIN_X;
  const colW = sigsW / 3;

  // Cursive-script signature placeholder (faint grey)
  const sigPaths: { name?: string; title?: string }[] = [
    { name: practice.sigLabTechName,      title: practice.sigLabTechTitle      },
    { name: practice.sigPathologist1Name, title: practice.sigPathologist1Title },
    { name: practice.sigPathologist2Name, title: practice.sigPathologist2Title },
  ];

  sigPaths.forEach((s, i) => {
    if (!s.name) return;
    const cx = MARGIN_X + i * colW;
    const px = cx + colW / 2;
    // Faint scribble line as a signature placeholder
    doc.setDrawColor(TEXT_DIM);
    doc.setLineWidth(0.6);
    const baseY = sigY;
    doc.line(px - 22, baseY,     px - 14, baseY - 6);
    doc.line(px - 14, baseY - 6, px - 4,  baseY + 4);
    doc.line(px - 4,  baseY + 4, px + 6,  baseY - 4);
    doc.line(px + 6,  baseY - 4, px + 18, baseY + 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(BLACK);
    doc.text(s.name, px, baseY + 18, { align: 'center' });

    if (s.title) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(TEXT_DIM);
      doc.text(`(${s.title})`, px, baseY + 30, { align: 'center' });
    }
  });

  // Bottom strip: "Generated on : <date>" on the left, "Page N of M" on the right
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, A4.h - 30, A4.w - MARGIN_X, A4.h - 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text(`Generated on :  ${formatShort(new Date().toISOString())}`, MARGIN_X, A4.h - 18);
  doc.text(`Page ${pageNo} of ${pageTotal}`, A4.w - MARGIN_X, A4.h - 18, { align: 'right' });

  // Blue band at the bottom (Drlogy "Sample Collection" strip)
  if (snap.patient?.phone) {
    doc.setFillColor(BLUE);
    doc.rect(0, A4.h - 12, A4.w, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor('#ffffff');
    doc.text(`Sample Collection  ${snap.patient.phone}`, A4.w / 2, A4.h - 3.5, { align: 'center' });
  }
}

/** Add a new page and redraw the per-page furniture (letterhead etc.
 *  are not repeated — Drlogy reports keep the body pages clean and
 *  rely on the bottom strip alone). */
function newPage(doc: jsPDF, _practice: NonNullable<ReportPdfInput['practice']>): number {
  doc.addPage();
  return MARGIN_TOP + 10;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Result is right-aligned, unit/range center-aligned, text/flag left. */
function alignFor(type: string): 'left' | 'right' | 'center' {
  if (type === 'result') return 'left';
  if (type === 'unit' || type === 'range') return 'left';
  return 'left';
}

function titleCaseHeader(label: string): string {
  // Drlogy uses title case ("Investigation", "Result", "Reference Value", "Unit").
  // The admin layout sometimes ships caps ("REFERENCE RANGE") — gently normalise.
  if (!label) return '';
  return label
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function flagLabel(r: ResolvedRow): string {
  if (!r.color) return '';
  const c = r.color.toLowerCase();
  if (c.includes('dc26') || c.includes('ef44') || c.includes('red') || c.includes('b91c')) return 'High';
  if (c.includes('2563') || c.includes('3b82') || c.includes('blue')) return 'Low';
  return '';
}

function zoneHexForPdf(token: string): string {
  if (token === 'red')    return '#fecaca';
  if (token === 'orange') return '#fed7aa';
  if (token === 'green')  return '#bbf7d0';
  return token.startsWith('#') ? token : '#e2e8f0';
}

/** "hemoglobin_a1c" → "Hemoglobin A1c". */
function humanize(s: string): string {
  if (!s) return '—';
  if (/\s/.test(s) || /^[A-Z]/.test(s)) return s;
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, c => c.toUpperCase());
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

/** "02:31 PM 02 Dec, 2X" — Drlogy short stamp style. */
function formatShort(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const hh = String(h).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${hh}:${m} ${ampm} ${dd} ${months[d.getMonth()]}, ${d.getFullYear()}`;
}
