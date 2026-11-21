import type { WorkListItem } from '../../../../shared/components/work-list/work-list';
import { type FlowRow, whereWords } from './flow-row';

/**
 * Frontdesk below 1024px (owner 2026-11-21): the flow grid's rows as `<pf-work-list>` items — the SAME rows, the
 * facts in the grid's column order (Patient meta · Visit for · Payment), "Where now" as the status words (soft rose
 * when late, green when finished) with Waiting on the right, and the row's Next + ⋯ at the right edge.
 */
export function flowListItems(rows: FlowRow[]): WorkListItem<FlowRow>[] {
  return rows.map(r => {
    return {
      id: r.id,
      name: r.name,
      daily: r.dailyNo != null ? { dailyNo: r.dailyNo, dailyNoDay: r.dailyNoDay } : null,
      urgent: r.urgent,
      facts: [r.meta, r.tags.length > 1 ? r.tags.join(' + ') : null, r.payDue || r.pay ? r.pay : null],
      status: whereWords(r),
      time: r.wait && r.wait !== '—' ? { text: r.wait, late: r.late } : null,
      selected: !!r.selected,
      noAction: !r.next && !r.more.length,
      aria: `Open ${r.name}`,
      data: r,
    };
  });
}
