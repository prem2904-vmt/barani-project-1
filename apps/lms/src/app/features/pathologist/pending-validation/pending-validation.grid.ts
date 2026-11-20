import { tatStateFor } from '../../../shared/utils/lab-priority';
import { GridFold, JourneyStep, waitText } from '../../../shared/utils/work-grid';
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

/** Collected → Received → Entered → Validated: everything in this queue is entered; validation is the open step. */
export function pvJourney(t: Pick<QueueTile, 'remainingMin'>): JourneyStep[] {
  return [
    { label: 'Collected', state: 'done' }, { label: 'Received', state: 'done' }, { label: 'Entered', state: 'done' },
    { label: 'Validated', state: tatStateFor(t.remainingMin) === 'overdue' ? 'late' : 'now' },
  ];
}

export interface PvColPlan { colId: string; header: string; hide: boolean }
/**
 * full  : Sample ID · Patient · Tests · Status · Journey · Waiting · actions.
 * fold  : Journey hides; Status folds under the patient (actions keep their full size).
 * tight : Tests fold under the patient too.
 */
export function pvColumns(fold: GridFold): PvColPlan[] {
  const f = fold !== 'full', t = fold === 'tight';
  const c = (colId: string, header: string, hide = false): PvColPlan => ({ colId, header, hide });
  return [c('sample', 'Sample ID'), c('patient', 'Patient'), c('tests', 'Tests', t), c('status', 'Status', f),
    c('journey', 'Journey', f), c('wait', 'Waiting'), c('acts', '')];
}
