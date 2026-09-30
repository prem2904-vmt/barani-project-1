/**
 * Report chart → jsPDF, as VECTOR drawing (docs/REPORT-CHARTS.md §5): lines,
 * rects, circles and real text — never a raster image — so the chart is crisp
 * at any zoom and its labels are selectable / searchable in the PDF.
 *
 * Self-contained: report-pdf.ts calls {@link drawReportChart} from its
 * section renderer and passes the few theme values the chart needs.
 */
import type { jsPDF } from 'jspdf';
import { type ChartData } from './report-chart.data';
import { chartWidth, layoutChart, type ChartColor, type ChartLayout, type ChartOp, type Measure } from './report-chart.layout';

export interface ChartPdfTheme {
  font: string;
  fontScale: number;
  /** Report accent (lines, markers, band tint). */
  accent: string;
  /** Body text colour. */
  text: string;
  /** Headings / axis ink. */
  ink: string;
  dim: string;
  hair: string;
  /** Template `flagStyle === 'bold_color'`: abnormal points in the high / low
   *  colours; otherwise abnormal = filled black + bold. */
  abnormalColored: boolean;
  abnormalColor: string;
  abnormalLowColor: string;
}

export const DEFAULT_CHART_THEME: ChartPdfTheme = {
  font: 'helvetica', fontScale: 1, accent: '#0066CC', text: '#1a1a1a', ink: '#000000',
  dim: '#666666', hair: '#9ca3af', abnormalColored: true, abnormalColor: '#dc2626', abnormalLowColor: '#2563eb',
};

/** Mix `hex` with white: t = 0 → hex, 1 → white. */
export function tint(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#e8eef7';
  const n = parseInt(m[1], 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - t) + 255 * t);
  return '#' + [ch(16), ch(8), ch(0)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Resolve a semantic colour for print. */
export function chartColor(c: ChartColor, th: ChartPdfTheme): string {
  switch (c) {
    case 'ink': return th.ink;
    case 'text': return th.text;
    case 'dim': return th.dim;
    case 'hair': return th.hair;
    case 'grid': return '#e5e7eb';
    case 'accent': return th.accent;
    case 'line2': return '#475569';
    case 'bar': return '#94a3b8';
    case 'band': return tint(th.accent, 0.9);
    case 'bandEdge': return tint(th.accent, 0.55);
    case 'high': return th.abnormalColored ? th.abnormalColor : th.ink;
    case 'low': return th.abnormalColored ? th.abnormalLowColor : th.ink;
    case 'paper': return '#ffffff';
  }
}

function pdfMeasure(doc: jsPDF, font: string): Measure {
  return (text, size, bold) => {
    doc.setFont(font, bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    return doc.getTextWidth(text);
  };
}

/** Lay the chart out with jsPDF's real font metrics. */
export function layoutReportChart(doc: jsPDF, data: ChartData, contentWidth: number, th: ChartPdfTheme): ChartLayout {
  return layoutChart(data, chartWidth(data.size, contentWidth), { measure: pdfMeasure(doc, th.font), fontScale: th.fontScale });
}

/** Paint a laid-out chart at (x0, y0). */
export function paintChart(doc: jsPDF, layout: ChartLayout, x0: number, y0: number, th: ChartPdfTheme): void {
  const col = (c: ChartColor) => chartColor(c, th);
  const dash = (d?: number[]) => {
    const api = doc as unknown as { setLineDashPattern?: (a: number[], p: number) => void };
    api.setLineDashPattern?.(d ?? [], 0);
  };
  for (const op of layout.ops as ChartOp[]) {
    switch (op.t) {
      case 'line':
        doc.setDrawColor(col(op.color)); doc.setLineWidth(op.w); dash(op.dash);
        doc.line(x0 + op.x1, y0 + op.y1, x0 + op.x2, y0 + op.y2);
        dash();
        break;
      case 'poly':
        doc.setDrawColor(col(op.color)); doc.setLineWidth(op.w); dash(op.dash);
        for (let i = 1; i < op.pts.length; i++) {
          doc.line(x0 + op.pts[i - 1][0], y0 + op.pts[i - 1][1], x0 + op.pts[i][0], y0 + op.pts[i][1]);
        }
        dash();
        break;
      case 'rect': {
        if (op.fill) doc.setFillColor(col(op.fill));
        if (op.stroke) { doc.setDrawColor(col(op.stroke)); doc.setLineWidth(op.lw ?? 0.5); }
        doc.rect(x0 + op.x, y0 + op.y, op.w, op.h, op.fill && op.stroke ? 'FD' : op.fill ? 'F' : 'S');
        break;
      }
      case 'circle': {
        if (op.fill) doc.setFillColor(col(op.fill));
        if (op.stroke) { doc.setDrawColor(col(op.stroke)); doc.setLineWidth(op.lw ?? 0.8); }
        doc.circle(x0 + op.cx, y0 + op.cy, op.r, op.fill && op.stroke ? 'FD' : op.fill ? 'F' : 'S');
        break;
      }
      case 'text': {
        const style = op.bold && op.italic ? 'bolditalic' : op.bold ? 'bold' : op.italic ? 'italic' : 'normal';
        doc.setFont(th.font, style);
        doc.setFontSize(op.size);
        doc.setTextColor(col(op.color));
        doc.text(op.text, x0 + op.x, y0 + op.y, { align: op.align });
        break;
      }
    }
  }
  doc.setLineWidth(0.5);
  doc.setTextColor(th.text);
}

/**
 * The report hook: lay out, keep the chart WHOLE (a new page when it does not
 * fit above `floor`), paint, and return the y below it. `newPage` returns the
 * top y of the fresh page.
 */
export function drawReportChart(
  doc: jsPDF, data: ChartData,
  at: { x: number; y: number; contentWidth: number; floor: number; newPage: () => number },
  th: ChartPdfTheme,
): number {
  const layout = layoutReportChart(doc, data, at.contentWidth, th);
  let y = at.y;
  if (y + layout.height > at.floor) y = at.newPage();
  paintChart(doc, layout, at.x, y, th);
  return y + layout.height;
}
