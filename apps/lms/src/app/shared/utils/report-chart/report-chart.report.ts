/**
 * The report-pdf.ts glue for chart blocks — kept here so report-pdf.ts only
 * carries a two-line hook (docs/REPORT-CHARTS.md §6).
 *
 * `setReportChartContext` is called once per render with the snapshot's
 * tests (a profile's chart reads its members' values) and the resolved
 * layouts (row titles for "chosen values" x labels).
 */
import type { jsPDF } from 'jspdf';
import type { ResolvedReportLayout, ResolvedSection } from '../../models/report-layout.model';
import { buildChartData, type ChartTestLike } from './report-chart.data';
import { drawReportChart, layoutReportChart, type ChartPdfTheme } from './report-chart.pdf';

let TESTS: readonly ChartTestLike[] = [];
let TITLES: Record<string, string> = {};

export function setReportChartContext(
  tests: readonly ChartTestLike[] | null | undefined,
  layouts: Record<string, ResolvedReportLayout> | null | undefined,
): void {
  TESTS = tests ?? [];
  const titles: Record<string, string> = {};
  for (const l of Object.values(layouts ?? {})) {
    for (const s of l?.sections ?? []) for (const r of s.rows ?? []) {
      const n = (r.parameterName ?? '').trim();
      const t = (r.title ?? '').trim();
      if (n && t && !titles[n]) titles[n] = t;
    }
  }
  TITLES = titles;
}

function dataFor(sec: ResolvedSection, ownerId: string) {
  return buildChartData(sec.trend, sec.label, ownerId, TESTS, TITLES);
}

/** Draw one chart block; returns the y below it (unchanged when nothing plots). */
export function renderReportChart(
  doc: jsPDF, sec: ResolvedSection, ownerId: string, y: number, th: ChartPdfTheme,
  at: { x: number; contentWidth: number; floor: number; newPage: () => number },
): number {
  const data = dataFor(sec, ownerId);
  if (!data || data.empty) return y;
  return drawReportChart(doc, data, { ...at, y: y + 4 }, th) + 6;
}

/** Height of the chart when it is the block's FIRST visible section (so its
 *  heading moves with it); 0 otherwise. */
export function reportChartLead(doc: jsPDF, layout: ResolvedReportLayout, th: ChartPdfTheme, contentWidth = 535.28): number {
  const first = layout.sections.find(s => s.isVisible);
  if (!first || first.type !== 'chart' || !first.trend) return 0;
  const data = dataFor(first, layout.testId);
  return data && !data.empty ? layoutReportChart(doc, data, contentWidth, th).height + 10 : 0;
}
