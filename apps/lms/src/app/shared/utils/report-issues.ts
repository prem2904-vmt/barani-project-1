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

/** Where the person fixes a warning: the setting that changes it (tab + element id + the control to focus). */
export interface ReportIssueTarget { tab: 'patient'; anchor: string; focus: string; }
/** Every overlap warning today comes from long names: the Patient strip's "Long text" setting fixes it. */
export const LONG_TEXT_TARGET: ReportIssueTarget = { tab: 'patient', anchor: 'pf-long-text', focus: '[aria-label="Fit long text"]' };

/** One warning: its plain words, where it sits on the long-names page (mm, page 1-based) and the field that fixes it. */
export interface ReportIssueSpot {
  line: string;
  page: number;
  x: number; y: number; w: number; h: number;
  target: ReportIssueTarget;
}

export interface ReportIssues {
  /** Distinct places where two pieces of text / images run into each other. */
  count: number;
  /** Plain-words list, at most `max`. */
  lines: string[];
  /** The same warnings with their spot on the page and the field that fixes each (at most `max`). */
  spots?: ReportIssueSpot[];
}

const label = (b: DrawnBox) => {
  if (b.kind === 'image') return 'a picture';
  const t = (b.text ?? '').trim();
  return t.length > 32 ? `"${t.slice(0, 32)}…"` : `"${t}"`;
};

/** The distinct collisions in a recording, in plain words (the same collision seen twice is counted once). */
export function distinctCollisions(boxes: ReadonlyArray<DrawnBox>): string[] {
  return collisionSpots(boxes).map(s => s.line);
}

/** The distinct collisions with the rectangle both pieces cover (mm) and the field that fixes them. */
export function collisionSpots(boxes: ReadonlyArray<DrawnBox>): ReportIssueSpot[] {
  const seen = new Set<string>();
  const out: ReportIssueSpot[] = [];
  for (const o of findOverlaps(boxes)) {
    const k = `${o.a.text ?? o.a.kind}|${o.b.text ?? o.b.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const x = Math.min(o.a.x, o.b.x), y = Math.min(o.a.y, o.b.y);
    const w = Math.max(o.a.x + o.a.w, o.b.x + o.b.w) - x, h = Math.max(o.a.y + o.a.h, o.b.y + o.b.h) - y;
    out.push({ line: `${label(o.a)} runs into ${label(o.b)}`, page: o.a.page, x, y, w, h, target: LONG_TEXT_TARGET });
  }
  return out;
}

/** The long-names input the warnings are measured on (the preview popup shows it so a warning's spot is visible). */
export function stressInput(input: ReportPdfInput): ReportPdfInput {
  return { ...input, report: { ...input.report, data: stressSnapshot(input.report.data ?? '{}') } };
}

export function reportIssues(input: ReportPdfInput, max = 5): ReportIssues {
  try {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    buildReportPdf({
      ...stressInput(input),
      drawRecorder: d => { rec = recordDrawing(d); },
    });
    const spots = collisionSpots(rec!.boxes);
    return { count: spots.length, lines: spots.slice(0, max).map(s => s.line), spots: spots.slice(0, max) };
  } catch {
    return { count: 0, lines: [], spots: [] };
  }
}
