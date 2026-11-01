import type { ReportTemplate } from '../models/report.model';
import { buildReportPdfWithLayout, type ReportPdfInput } from './report-pdf';
import { recordDrawing, type DrawnBox } from './report-overlap-detector';
import { distinctCollisions, stressSnapshot } from './report-issues';
import type { TidyProbe, TidyProbeFn } from './report-tidy';

/**
 * How the tidy measures a template: it renders the SAME sample report the designer previews (sample data only - a made-up
 * patient, never a real one), twice per question:
 *   - once with deliberately long names (the overlap stress of `report-issues.ts`) under the overlap detector, to count
 *     collisions;
 *   - once as the plain sample, for the resolved letterhead layout and what a squeeze would do.
 * Preview-only: nothing is stored and every render is thrown away.
 */
export function makeTidyProbe(base: Omit<ReportPdfInput, 'template'>): TidyProbeFn {
  return (template: ReportTemplate): TidyProbe => {
    let boxes: DrawnBox[] = [];
    try {
      buildReportPdfWithLayout({
        ...base, template,
        report: { ...base.report, data: stressSnapshot(base.report.data ?? '{}') },
        drawRecorder: d => { boxes = recordDrawing(d).boxes; },
      });
    } catch { boxes = []; }
    const plain = buildReportPdfWithLayout({ ...base, template });
    return { issues: distinctCollisions(boxes).length, layout: plain.layout, squeeze: plain.squeeze };
  };
}
