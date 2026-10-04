import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OrderTest } from '../../../shared/models/order.model';
import { enrichWorkLines, groupByPriority, soonestDue } from './my-work.priority';

/**
 * Owner (2026-09-29): "In lab there is only URGENT and NORMAL priority —
 * there is no High option at all." My Work groups by the ORDER's priority;
 * TAT is a separate "Overdue / Due in … / Due 14:30" chip.
 */
const NOW = new Date(2026, 8, 29, 12, 0, 0).getTime();

function line(id: string, o: { priority?: string; receivedMinAgo: number; tatHours: number; barcode?: string }): OrderTest {
  return {
    id, status: 'pending', subOrderId: 's-' + id, testId: 't-' + id, name: 'CBC',
    test: { id: 't-' + id, name: 'CBC', tatHours: o.tatHours } as any,
    subOrder: {
      id: 's-' + id, barcode: o.barcode ?? id, status: 'received',
      receivedAtLab: new Date(NOW - o.receivedMinAgo * 60000).toISOString(),
      order: { id: 'o-' + id, priority: o.priority ?? 'routine', patient: { displayName: 'P ' + id } },
    } as any,
  } as unknown as OrderTest;
}

describe('My Work — priority is the ORDER priority (Urgent / Normal)', () => {
  it('an Urgent order that is NOT yet due shows under Urgent', () => {
    const g = groupByPriority(enrichWorkLines([line('u1', { priority: 'urgent', receivedMinAgo: 5, tatHours: 6 })], NOW));
    expect(g.map(x => x.label)).toEqual(['Urgent', 'Normal']);
    expect(g[0].items.map(i => i.id)).toEqual(['u1']);
    expect(g[0].items[0]._tat).toBe('onTrack');
    expect(g[1].items).toEqual([]);
  });

  it('a Normal order that is overdue stays under Normal, with an Overdue TAT state', () => {
    const g = groupByPriority(enrichWorkLines([line('n1', { priority: 'routine', receivedMinAgo: 300, tatHours: 2 })], NOW));
    expect(g[0].items).toEqual([]);
    expect(g[1].items.map(i => i.id)).toEqual(['n1']);
    expect(g[1].items[0]._tat).toBe('overdue');
    expect(g[1].items[0]._remainingMin!).toBeLessThan(0);
  });

  it('STAT maps to Urgent; routine / normal / empty map to Normal', () => {
    const rows = enrichWorkLines([
      line('a', { priority: 'STAT', receivedMinAgo: 0, tatHours: 4 }),
      line('b', { priority: 'stat', receivedMinAgo: 0, tatHours: 4 }),
      line('c', { priority: 'routine', receivedMinAgo: 0, tatHours: 4 }),
      line('d', { priority: 'Normal', receivedMinAgo: 0, tatHours: 4 }),
      line('e', { priority: '', receivedMinAgo: 0, tatHours: 4 }),
    ], NOW);
    expect(rows.map(r => r._priority)).toEqual(['urgent', 'urgent', 'normal', 'normal', 'normal']);
  });

  it('only two groups exist, and neither is "High"', () => {
    const g = groupByPriority([]);
    expect(g.map(x => x.priority)).toEqual(['urgent', 'normal']);
    expect(g.map(x => x.label)).not.toContain('High' as never);
  });

  it('sort: Urgent group first; within each, soonest due (overdue first); no clock last', () => {
    const rows = enrichWorkLines([
      line('n-far', { receivedMinAgo: 0, tatHours: 8 }),
      line('n-over', { receivedMinAgo: 200, tatHours: 2 }),
      line('n-none', { receivedMinAgo: 0, tatHours: 0 }),
      line('u-far', { priority: 'urgent', receivedMinAgo: 0, tatHours: 6 }),
      line('n-soon', { receivedMinAgo: 90, tatHours: 2 }),
      line('u-over', { priority: 'STAT', receivedMinAgo: 130, tatHours: 2 }),
    ], NOW);
    const g = groupByPriority(rows);
    expect(g[0].items.map(i => i.id)).toEqual(['u-over', 'u-far']);
    expect(g[1].items.map(i => i.id)).toEqual(['n-over', 'n-soon', 'n-far', 'n-none']);
    expect(soonestDue(g[1].items).id).toBe('n-over');
  });

  it('a test with no TAT budget is never "overdue"', () => {
    const [r] = enrichWorkLines([line('x', { receivedMinAgo: 999, tatHours: 0 })], NOW);
    expect(r._tat).toBe('onTrack');
    expect(r._remainingMin).toBeNull();
  });
});

describe('No "High" PRIORITY label anywhere in the lab queues', () => {
  const root = resolve(process.cwd(), 'apps/lms/src/app');
  const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
  // Result-flag code (H = above range) is a RESULT flag, not a priority —
  // strip those idioms before scanning.
  const stripResultFlags = (src: string) => src
    .replace(/tone:\s*['"]high['"],\s*label:\s*['"](High|Abnormal)['"]/g, '')
    .replace(/tone === ['"]low['"] \|\| tone === ['"]high['"]/g, '')
    .replace(/criticalHigh/g, '');
  const files = [
    'features/lab/my-work/my-work.component.ts',
    'features/lab/my-work/my-work.priority.ts',
    'features/lab/result-entry/result-entry.component.ts',
    'features/lab/sample-result-entry/sample-result-entry.component.ts',
    'features/lab/sample-result-entry/sample-result-entry.component.html',
    'features/lab/sample-collection/sample-collection.component.html',
    'features/lab/receive-samples/receive-samples.component.ts',
    'features/pathologist/pending-validation/pending-validation.component.ts',
    'features/pathologist/pending-validation/pending-validation.logic.ts',
    'features/dashboard/tat-board/tat-board.component.ts',
    'shared/components/tat-indicator/tat-indicator.component.ts',
  ];
  for (const f of files) {
    it(`${f}: no High priority / TAT level`, () => {
      const src = stripResultFlags(read(f));
      expect(src).not.toMatch(/label:\s*['"]High['"]/);
      expect(src).not.toMatch(/>\s*High\s*</);
      expect(src).not.toMatch(/level\s*===\s*['"]high['"]/);
      expect(src).not.toMatch(/data-level=['"]?high/);
      expect(src).not.toMatch(/pf-tq--high|pf-tat-high|pf-urg-high|urg-high/);
      expect(src).not.toMatch(/'urgent'\s*\|\s*'high'\s*\|\s*'normal'/);
    });
  }
});
