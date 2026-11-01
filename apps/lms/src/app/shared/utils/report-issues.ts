import { buildReportPdf, type ReportPdfInput } from './report-pdf';
import { findOverlaps, recordDrawing, type DrawnBox } from './report-overlap-detector';

/**
 * "Issues" for the report designer's band chip: would long names make this
 * template's paper overlap?
 *
 * The designer previews a short sample patient, so a short sample never shows
 * the problem. This re-renders the SAME template (same layout, same style)
 * with deliberately long names — a 44-character patient, a long doctor and
 * hospital, a long branch — under the overlap detector and reports what runs
 * into what. With text fitting off an existing lab sees the findings and is
 * nudged to turn fitting on; with it on the count is the leftovers (zero).
 *
 * Preview-only: nothing is stored, and the render is thrown away.
 */

export const STRESS_PATIENT = 'Thiruvenkatasamy Subramaniam Venkataraghavan';
export const STRESS_DOCTOR = 'Dr. Lakshminarasimhan Venkatasubramanian MD DM';
export const STRESS_HOSPITAL = 'Sri Ramachandra Institute of Higher Education and Research Hospital';
export const STRESS_BRANCH = 'Anna Nagar West Extension Collection Centre';

/** The snapshot with its patient / doctor / hospital / branch names lengthened. */
export function stressSnapshot(json: string): string {
  try {
    const snap = JSON.parse(json) as { patient?: Record<string, unknown>; order?: Record<string, unknown> };
    snap.patient = { ...(snap.patient ?? {}), displayName: STRESS_PATIENT };
    snap.order = { ...(snap.order ?? {}), refDoctorName: STRESS_DOCTOR, refHospitalName: STRESS_HOSPITAL, branchName: STRESS_BRANCH,
                   collectedBy: 'Priyadharshini Subramanian' };
    return JSON.stringify(snap);
  } catch { return json; }
}

export interface ReportIssues {
  /** Distinct places where two pieces of text / images run into each other. */
  count: number;
  /** Plain-words list, at most `max`. */
  lines: string[];
}

const label = (b: DrawnBox) => {
  if (b.kind === 'image') return 'a picture';
  const t = (b.text ?? '').trim();
  return t.length > 32 ? `"${t.slice(0, 32)}…"` : `"${t}"`;
};

/** The distinct collisions in a recording, in plain words (the same collision seen twice is counted once). */
export function distinctCollisions(boxes: ReadonlyArray<DrawnBox>): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const o of findOverlaps(boxes)) {
    const k = `${o.a.text ?? o.a.kind}|${o.b.text ?? o.b.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`${label(o.a)} runs into ${label(o.b)}`);
  }
  return lines;
}

export function reportIssues(input: ReportPdfInput, max = 5): ReportIssues {
  try {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    buildReportPdf({
      ...input,
      report: { ...input.report, data: stressSnapshot(input.report.data ?? '{}') },
      drawRecorder: d => { rec = recordDrawing(d); },
    });
    const lines = distinctCollisions(rec!.boxes);
    return { count: lines.length, lines: lines.slice(0, max) };
  } catch {
    return { count: 0, lines: [] };
  }
}
