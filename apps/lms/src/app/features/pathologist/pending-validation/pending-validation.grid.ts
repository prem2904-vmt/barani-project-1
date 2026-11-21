import { tatStateFor } from '../../../shared/utils/lab-priority';
import { logicalTestCount } from '../../../shared/models/order.model';
import { GridFold, waitText } from '../../../shared/utils/work-grid';
import type { QueueTile } from './pending-validation.logic';

/**
 * The Pathologist queue as a GRID (owner 2026-11-20): pure row / column rules behind the screen's pf-data-grid.
 * One row per tube (per department of a shared tube) — the same QueueTile the tiles drew; Urgent rows first (the old
 * groups' order), a rose leading rule on an Urgent order. Row tap = open the review (the old tile tap).
 */

/** Urgent group first, then Normal — each already in the queue's order (mine → priority → least time left). */
export function pvRows(groups: Array<{ tiles: QueueTile[] }>): QueueTile[] {
  return groups.flatMap(g => g.tiles);
}

/** Waiting since the results were entered ("12m", "entered 9:48 PM"); rose once the tube is past its TAT. */
export interface PvWait { text: string; sub: string; late: boolean }
export function pvWaiting(t: Pick<QueueTile, 'items' | 'remainingMin'>, now: number = Date.now()): PvWait {
  const at = t.items.map(i => i.resultedAt).filter((v): v is string => !!v).sort().pop() ?? null;
  const time = at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return { text: at ? waitText(at, now) : '—', sub: time ? `entered ${time}` : '', late: tatStateFor(t.remainingMin) === 'overdue' };
}

export interface PvColPlan { colId: string; header: string; hide: boolean }
/**
 * No Tests column (owner 2026-11-20: long test lists made rows 6–8 lines): department + count ride the meta line. No
 * journey ring (owner 2026-11-21: every row waits on validation) — Due = time left to TAT.
 * full  : Sample ID · Patient · Status · Due · Waiting · actions.
 * fold  : Status folds under the patient (actions keep their full size).
 * tight : Sample ID and Waiting fold into the patient cell; Due and the actions always stay (no sideways scroll down
 *         to a 520px card, owner 2026-11-21).
 */
export function pvColumns(fold: GridFold): PvColPlan[] {
  const f = fold !== 'full', t = fold === 'tight';
  const c = (colId: string, header: string, hide = false): PvColPlan => ({ colId, header, hide });
  return [c('sample', 'Sample ID', t), c('patient', 'Patient'), c('status', 'Status', f), c('due', 'Due'), c('wait', 'Waiting', t), c('acts', '')];
}

/** "44/F · AA0007 · Haematology · 2 tests" — the entered time lives in the Waiting column ("entered 9:48 PM"). */
export function pvMeta(t: Pick<QueueTile, 'patientMeta' | 'dept' | 'items'>): string {
  const n = logicalTestCount(t.items as never);
  return [t.patientMeta, t.dept, `${n} test${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}
