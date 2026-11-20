import { tatStateFor } from '../../../shared/utils/lab-priority';
import { logicalTestCount } from '../../../shared/models/order.model';
import { GridFold, waitText } from '../../../shared/utils/work-grid';
import type { RingStep } from '../../../shared/components/journey-ring/journey-ring';
import { labLineRing } from '../../../shared/utils/lab-line-journey';
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

/** The shared ring's lab line: everything here is entered, so Validation is the open step — late past the TAT. */
export function pvRing(t: Pick<QueueTile, 'items' | 'remainingMin'>): RingStep[] {
  return labLineRing(t.items, tatStateFor(t.remainingMin) === 'overdue');
}

export interface PvColPlan { colId: string; header: string; hide: boolean }
/**
 * No Tests column (owner 2026-11-20: long test lists made rows 6–8 lines): department + count ride the meta line.
 * full  : Sample ID · Patient · Status · Journey · Waiting · actions.
 * fold  : Status folds under the patient (actions keep their full size); the journey ring stays.
 * tight : the ring folds too.
 */
export function pvColumns(fold: GridFold): PvColPlan[] {
  const f = fold !== 'full', t = fold === 'tight';
  const c = (colId: string, header: string, hide = false): PvColPlan => ({ colId, header, hide });
  return [c('sample', 'Sample ID'), c('patient', 'Patient'), c('status', 'Status', f), c('journey', 'Journey', t), c('wait', 'Waiting'), c('acts', '')];
}

/** "44/F · AA0007 · Haematology · 2 tests · entered 9:48 PM". */
export function pvMeta(t: Pick<QueueTile, 'patientMeta' | 'dept' | 'items'>): string {
  const n = logicalTestCount(t.items as never);
  const at = t.items.map(i => i.resultedAt).filter(Boolean).sort().pop();
  const time = at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return [t.patientMeta, t.dept, `${n} test${n === 1 ? '' : 's'}`, time && `entered ${time}`].filter(Boolean).join(' · ');
}
