/**
 * Report charts on the lab screens (docs/REPORT-CHARTS.md §7): which layout
 * a line's chart lives on, and the order's current results in the snapshot
 * shape the chart reads — so the pathologist sees the chart that will print.
 */
import type { ChartTestLike } from './report-chart.data';

interface OrderTestLike {
  testId?: string;
  name?: string;
  packageTestId?: string | null;
  packageType?: string | null;
  profileTestId?: string | null;
  currentResult?: string | null;
  test?: { name?: string; testCode?: string | null } | null;
}
interface OrderLike {
  samples?: Array<{ repeatOffsetMin?: number | null; tests?: OrderTestLike[] | null }> | null;
}

/** The test whose layout carries the chart for this line: its nearest
 *  profile, else the test itself (a package's name never prints). */
export function chartOwnerOf(t: OrderTestLike): string {
  return t.profileTestId || (t.packageType === 'profile' ? t.packageTestId : null) || t.testId || '';
}

/** A saved result's printable values: mw's flagged map (value + flag +
 *  range + band numbers), else the raw values. */
export function savedValues(currentResult: string | null | undefined): Record<string, unknown> {
  if (!currentResult) return {};
  try {
    const r = JSON.parse(currentResult) as { flagged?: Record<string, unknown>; values?: Record<string, unknown> };
    return (r?.flagged && Object.keys(r.flagged).length ? r.flagged : r?.values) ?? {};
  } catch { return {}; }
}

/** Every line of the order, as chart snapshot tests (series offsets from the tube). */
export function chartTestsFromOrder(order: OrderLike | null | undefined): ChartTestLike[] {
  const out: ChartTestLike[] = [];
  for (const s of order?.samples ?? []) for (const t of s.tests ?? []) {
    out.push({
      testId: t.testId, name: t.name ?? t.test?.name, code: t.test?.testCode ?? null,
      packageTestId: t.packageTestId ?? null, profileTestId: t.profileTestId ?? null,
      repeatOffsetMin: s.repeatOffsetMin ?? null,
      result: { values: savedValues(t.currentResult) },
    });
  }
  return out;
}
