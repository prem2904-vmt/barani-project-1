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
import { drawTextWithSuperscripts, hasSuperscript, measureWithSuperscripts, pdfSafeText } from '../pdf-text';
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
  /** The report theme's face for a weight → [jsPDF font name, style] (an
   *  embedded theme font, e.g. Source Sans 3). Absent: `font` + the weight. */
  face?: (weight: 'normal' | 'bold' | 'italic' | 'bolditalic') => [string, string];
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

/** Mix `hex` with black: t = 0 → hex, 1 → black. */
export function shade(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#1e3a5f';
  const n = parseInt(m[1], 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * (1 - t));
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
    case 's3': return tint(th.accent, 0.45);
    case 's4': return '#94a3b8';
    case 's5': return shade(th.accent, 0.4);
    case 's6': return '#1e293b';
    // Parts of a whole: shades of the accent + slate, distinct in greyscale.
    case 'p1': return th.accent;
    case 'p2': return tint(th.accent, 0.38);
    case 'p3': return shade(th.accent, 0.42);
    case 'p4': return tint(th.accent, 0.64);
    case 'p5': return '#475569';
    case 'p6': return tint(th.accent, 0.82);
    case 'p7': return '#94a3b8';
    case 'p8': return shade(th.accent, 0.7);
  }
}

/** [font, style] for a weight in the report theme. */
function faceFor(th: ChartPdfTheme, weight: 'normal' | 'bold' | 'italic' | 'bolditalic'): [string, string] {
  return th.face ? th.face(weight) : [th.font, weight];
}

function pdfMeasure(doc: jsPDF, th: ChartPdfTheme): Measure {
  return (text, size, bold) => {
    const [f, st] = faceFor(th, bold ? 'bold' : 'normal');
    doc.setFont(f, st);
    doc.setFontSize(size);
    // Units such as 10³/µL print with raised digits (pdf-text.ts), measured so.
    const safe = pdfSafeText(text);
    return hasSuperscript(safe) ? measureWithSuperscripts(doc, safe, size) : doc.getTextWidth(text);
  };
}

/** Lay the chart out with jsPDF's real font metrics. */
export function layoutReportChart(doc: jsPDF, data: ChartData, contentWidth: number, th: ChartPdfTheme): ChartLayout {
  return layoutChart(data, chartWidth(data.size, contentWidth), { measure: pdfMeasure(doc, th), fontScale: th.fontScale });
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
      case 'path': {
        if (!op.segs.length) break;
        const fillOp = !!op.fill;
        const strokeOp = !!op.stroke;
        if (fillOp) doc.setFillColor(col(op.fill!));
        if (strokeOp) { doc.setDrawColor(col(op.stroke!)); doc.setLineWidth(op.lw ?? 0.8); dash(op.dash); }
        const translucent = fillOp && op.opacity != null && op.opacity < 1;
        // A translucent fill is painted on its own (the stroke stays opaque).
        const draw = (mode: 'fill' | 'stroke' | 'fillStroke') => {
          for (const sg of op.segs) {
            switch (sg[0]) {
              case 'M': doc.moveTo(x0 + sg[1], y0 + sg[2]); break;
              case 'L': doc.lineTo(x0 + sg[1], y0 + sg[2]); break;
              case 'C': doc.curveTo(x0 + sg[1], y0 + sg[2], x0 + sg[3], y0 + sg[4], x0 + sg[5], y0 + sg[6]); break;
              case 'Z': doc.close(); break;
            }
          }
          if (mode === 'fill') doc.fill(); else if (mode === 'stroke') doc.stroke(); else doc.fillStroke();
        };
        if (translucent) {
          const api = doc as unknown as { GState?: new (p: { opacity: number }) => unknown; setGState?: (g: unknown) => void };
          if (api.GState && api.setGState) {
            api.setGState(new api.GState({ opacity: op.opacity! }));
            draw('fill');
            api.setGState(new api.GState({ opacity: 1 }));
          } else {
            doc.setFillColor(tint(col(op.fill!), 1 - op.opacity!));
            draw('fill');
          }
          if (strokeOp) draw('stroke');
        } else {
          draw(fillOp && strokeOp ? 'fillStroke' : fillOp ? 'fill' : 'stroke');
        }
        if (strokeOp) dash();
        break;
      }
      case 'text': {
        const [f, style] = faceFor(th, op.bold && op.italic ? 'bolditalic' : op.bold ? 'bold' : op.italic ? 'italic' : 'normal');
        doc.setFont(f, style);
        doc.setFontSize(op.size);
        doc.setTextColor(col(op.color));
        const safe = pdfSafeText(op.text);
        if (hasSuperscript(safe)) {
          const w = measureWithSuperscripts(doc, safe, op.size);
          const tx = x0 + op.x - (op.align === 'center' ? w / 2 : op.align === 'right' ? w : 0);
          drawTextWithSuperscripts(doc, safe, tx, y0 + op.y, op.size);
        } else {
          doc.text(op.text, x0 + op.x, y0 + op.y, { align: op.align });
        }
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
