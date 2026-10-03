/**
 * Report readiness — what Lab → Completed's Print says when an order has no
 * report yet, instead of a bare "No report for this order" (owner bug
 * 2026-10-03, sample 26285: 8 of 13 urine lines validated, 5 still open, so
 * no report could exist and Print just failed).
 *
 * The server owns the rule (`GET /api/reports/readiness/{orderId}` →
 * `ReportDeliveryRules.ReadinessOf`): a FINAL report needs every in-house
 * line validated; a PARTIAL (preliminary) report may carry only tubes whose
 * every line is validated. This file only turns that answer into the dialog.
 */

/** One tube still holding the report back (server `PendingTube`). */
export interface ReadinessPendingTube {
  sampleId: string;
  barcode?: string | null;
  status: string;
  tests: string[];
}

/** `GET /api/reports/readiness/{orderId}` (server `ReportDeliveryRules.Readiness`). */
export interface ReportReadiness {
  hasReport: boolean;
  reportId?: string | null;
  reportType?: string | null;
  complete: boolean;
  pending: ReadinessPendingTube[];
  partialSampleIds: string[];
}

export function reportReadinessUrl(orderId: string): string {
  return `/api/reports/readiness/${encodeURIComponent(orderId)}`;
}

/** What Print does next:
 *  - `generate`: every line is validated but no report exists (generation was
 *    skipped or failed) → offer "Generate now" (final).
 *  - `partial`: lines are still open, but some tubes are fully validated →
 *    offer a clearly-marked PRELIMINARY report of those tubes.
 *  - `pending`: nothing can be released yet → say which tubes / tests are open
 *    and offer to open the first one.
 *  - `ready`: a report exists (the by-order read raced) → just print it. */
export type ReadinessPlanKind = 'ready' | 'generate' | 'partial' | 'pending';

export interface ReadinessPlan {
  kind: ReadinessPlanKind;
  title: string;
  message: string;
  /** One line per open tube: "26287 · Epithelial Casts, Waxy Casts +14 more". */
  items: string[];
  /** The tube to open from the dialog (first open tube), if any. */
  openSampleId: string | null;
  /** Tubes a partial would carry (kind === 'partial'). */
  partialSampleIds: string[];
}

const MAX_TESTS_PER_LINE = 3;

export function pendingLine(t: ReadinessPendingTube): string {
  const shown = t.tests.slice(0, MAX_TESTS_PER_LINE).join(', ');
  const more = t.tests.length - MAX_TESTS_PER_LINE;
  const what = more > 0 ? `${shown} +${more} more` : shown;
  const id = t.barcode || 'Sample';
  const undrawn = t.status === 'pending' ? ' (not collected yet)' : '';
  return `${id}${undrawn} · ${what}`;
}

/** @param canRelease the user may generate a report (deliver_report or
 *  validate_result — the server's guard on generate / generate/partial). */
export function planReadiness(r: ReportReadiness, canRelease: boolean): ReadinessPlan {
  const items = (r.pending ?? []).map(pendingLine);
  const openSampleId = r.pending?.[0]?.sampleId ?? null;
  const partialSampleIds = r.partialSampleIds ?? [];
  if (r.hasReport) {
    return { kind: 'ready', title: 'Report ready', message: '', items: [], openSampleId: null, partialSampleIds: [] };
  }
  if (r.complete) {
    return {
      kind: canRelease ? 'generate' : 'pending',
      title: 'Report not generated yet',
      message: canRelease
        ? 'Every test on this order is validated, but the report was not created. Generate it now?'
        : 'Every test on this order is validated, but the report was not created. Ask someone who releases reports to generate it.',
      items: [],
      openSampleId: null,
      partialSampleIds: [],
    };
  }
  const nOpen = (r.pending ?? []).reduce((n, t) => n + t.tests.length, 0);
  const tubes = (r.pending ?? []).length;
  const head = `The report is created when all tests on this order are validated: ` +
    `${nOpen} test${nOpen === 1 ? '' : 's'} on ${tubes} sample${tubes === 1 ? '' : 's'} still pending.`;
  if (canRelease && partialSampleIds.length > 0) {
    return {
      kind: 'partial',
      title: 'Final report not ready',
      message: `${head} You can print a PRELIMINARY report of the fully validated sample${partialSampleIds.length === 1 ? '' : 's'} now.`,
      items,
      openSampleId,
      partialSampleIds,
    };
  }
  return { kind: 'pending', title: 'Report not ready yet', message: head, items, openSampleId, partialSampleIds: [] };
}

/** The Completed tab's tube status: a tube is "validated" only when every
 *  line on it is — the tech's own finished lines AND the lines the server
 *  says are still open (`subOrder.openLines`). */
export type CompletedTubeStatus = 'validated' | 'entered' | 'partial';

export function completedTubeStatus(lineStatuses: string[], openLines: number): CompletedTubeStatus {
  const allMineValidated = lineStatuses.length > 0 && lineStatuses.every(s => s === 'validated');
  if (!allMineValidated) return 'entered';
  return openLines > 0 ? 'partial' : 'validated';
}
