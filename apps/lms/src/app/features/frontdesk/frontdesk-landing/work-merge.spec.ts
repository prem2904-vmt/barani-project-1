import { vi } from 'vitest';
import {
  AnnotateBucket, MinimalWorkOrder, WorkBucket, buildMergedWork, mergeWorkRows, primaryWorkStatus, sortMergedWork,
} from './work-merge';

interface O extends MinimalWorkOrder { id: string; createdAt: string; dailyNo?: number | null; dailyNoDay?: string | null }

function order(id: string, createdAt: string, dailyNo?: number | null, dailyNoDay?: string | null): O {
  return { id, createdAt, dailyNo: dailyNo ?? null, dailyNoDay: dailyNoDay ?? null };
}

describe('work-merge — precedence', () => {
  it('Outsourced > Payments due > In progress > Completed, whatever order the statuses arrive in', () => {
    expect(primaryWorkStatus(['done', 'ip', 'billing', 'out'])).toBe('out');
    expect(primaryWorkStatus(['done', 'ip', 'billing'])).toBe('billing');
    expect(primaryWorkStatus(['done', 'ip'])).toBe('ip');
    expect(primaryWorkStatus(['done'])).toBe('done');
    expect(primaryWorkStatus(new Set(['out', 'done']))).toBe('out');
  });
});

describe('work-merge — mergeWorkRows (dedupe by order id)', () => {
  it('an order in two feeds appears ONCE, carrying both statuses', () => {
    const o1 = order('o1', '2026-09-30T04:00:00Z', 3, '2026-09-30');
    const buckets: WorkBucket<O>[] = [
      { status: 'ip', orders: [o1] },
      { status: 'billing', orders: [o1] },
    ];
    const rows = mergeWorkRows(buckets);
    expect(rows.length).toBe(1);
    expect(rows[0].order).toBe(o1);
    expect(new Set(rows[0].statuses)).toEqual(new Set(['ip', 'billing']));
    expect(rows[0].primary).toBe('billing'); // billing outranks ip
    expect(rows[0].secondary).toEqual(['ip']);
  });

  it('an order in only one feed carries just that status, no secondary', () => {
    const o1 = order('o1', '2026-09-30T04:00:00Z');
    const rows = mergeWorkRows([{ status: 'done', orders: [o1] }]);
    expect(rows[0].primary).toBe('done');
    expect(rows[0].secondary).toEqual([]);
  });

  it('different orders never merge; each keeps its own row', () => {
    const o1 = order('o1', '2026-09-30T04:00:00Z');
    const o2 = order('o2', '2026-09-30T05:00:00Z');
    const rows = mergeWorkRows([{ status: 'ip', orders: [o1, o2] }]);
    expect(rows.map(r => r.order.id).sort()).toEqual(['o1', 'o2']);
  });

  it('an annotate feed with NO synthesize adds its status to an EXISTING row only — never creates one', () => {
    const o1 = order('o1', '2026-09-30T04:00:00Z');
    const buckets: WorkBucket<O>[] = [{ status: 'ip', orders: [o1] }];
    const annotate: AnnotateBucket<O>[] = [
      { status: 'out', items: [{ orderId: 'o1', data: 'tube-1' }, { orderId: 'orphan-not-in-any-bucket', data: 'tube-2' }] },
    ];
    const rows = mergeWorkRows(buckets, annotate);
    expect(rows.length).toBe(1); // the orphan id never became a row
    expect(rows[0].order.id).toBe('o1');
    expect(new Set(rows[0].statuses)).toEqual(new Set(['ip', 'out']));
    expect(rows[0].primary).toBe('out'); // outsourced outranks in-progress
    expect(rows[0].secondary).toEqual(['ip']);
    expect(rows[0].source).toBe('order');
    expect(rows[0].annotateData.out).toBe('tube-1');
  });

  it('every row from a WorkBucket has source "order"', () => {
    const o1 = order('o1', '2026-09-30T04:00:00Z');
    expect(mergeWorkRows([{ status: 'done', orders: [o1] }])[0].source).toBe('order');
  });

  it('an annotate feed WITH synthesize creates a row for an order with no WorkBucket row at all', () => {
    const annotate: AnnotateBucket<O, string>[] = [{
      status: 'out',
      items: [{ orderId: 'only-outsourced', data: 'tube-9' }],
      synthesize: item => order(item.orderId, '2026-09-30T04:00:00Z', 7, '2026-09-30'),
    }];
    const rows = mergeWorkRows([], annotate);
    expect(rows.length).toBe(1);
    expect(rows[0].order.id).toBe('only-outsourced');
    expect(rows[0].order.dailyNo).toBe(7);
    expect(rows[0].statuses).toEqual(['out']);
    expect(rows[0].primary).toBe('out');
    expect(rows[0].secondary).toEqual([]);
    expect(rows[0].source).toBe('synthetic');
    expect(rows[0].annotateData.out).toBe('tube-9');
  });

  it('synthesize is only consulted for an order with no existing row — a real row is never replaced', () => {
    const o1 = order('o1', '2026-09-30T04:00:00Z', 1, '2026-09-30');
    const synthesize = vi.fn(() => order('o1', '2026-09-30T04:00:00Z', 99, '2026-09-30'));
    const rows = mergeWorkRows(
      [{ status: 'ip', orders: [o1] }],
      [{ status: 'out', items: [{ orderId: 'o1', data: 'tube' }], synthesize }],
    );
    expect(synthesize).not.toHaveBeenCalled();
    expect(rows[0].order).toBe(o1); // the REAL order, not a synthetic stand-in
    expect(rows[0].source).toBe('order');
  });

  it('two annotate items for the same new order keep ONE row with both statuses', () => {
    const annotateOut: AnnotateBucket<O, string> = {
      status: 'out', items: [{ orderId: 'x', data: 'tube' }],
      synthesize: item => order(item.orderId, '2026-09-30T04:00:00Z'),
    };
    const annotateBilling: AnnotateBucket<O, number> = { status: 'billing', items: [{ orderId: 'x', data: 500 }] };
    const rows = mergeWorkRows([], [annotateOut, annotateBilling]);
    expect(rows.length).toBe(1);
    expect(new Set(rows[0].statuses)).toEqual(new Set(['out', 'billing']));
    expect(rows[0].annotateData).toEqual({ out: 'tube', billing: 500 });
  });
});

describe('work-merge — sortMergedWork', () => {
  const row = (o: O) => mergeWorkRows([{ status: 'ip', orders: [o] }])[0];

  it('newest business day first', () => {
    const today = order('t', '2026-09-30T06:00:00Z', 1, '2026-09-30');
    const yesterday = order('y', '2026-09-29T06:00:00Z', 1, '2026-09-29');
    const sorted = sortMergedWork([row(yesterday), row(today)]);
    expect(sorted.map(r => r.order.id)).toEqual(['t', 'y']);
  });

  it('within a day, ascending by the daily serial — arrival order', () => {
    const a = order('a', '2026-09-30T04:00:00Z', 3, '2026-09-30');
    const b = order('b', '2026-09-30T05:00:00Z', 1, '2026-09-30');
    const c = order('c', '2026-09-30T06:00:00Z', 2, '2026-09-30');
    const sorted = sortMergedWork([row(a), row(b), row(c)]);
    expect(sorted.map(r => r.order.id)).toEqual(['b', 'c', 'a']);
  });

  it('a row with no serial for its day sorts AFTER the numbered rows of that day, oldest-created first', () => {
    const numbered = order('n', '2026-09-30T04:00:00Z', 1, '2026-09-30');
    const unNumberedOld = order('u1', '2026-09-30T02:00:00Z', null, '2026-09-30');
    const unNumberedNew = order('u2', '2026-09-30T03:00:00Z', null, '2026-09-30');
    const sorted = sortMergedWork([row(unNumberedNew), row(numbered), row(unNumberedOld)]);
    expect(sorted.map(r => r.order.id)).toEqual(['n', 'u1', 'u2']);
  });

  it('a multi-day range: groups by day (newest first) THEN serial ascending within each day', () => {
    const day2n2 = order('d2n2', '2026-09-30T08:00:00Z', 2, '2026-09-30');
    const day2n1 = order('d2n1', '2026-09-30T04:00:00Z', 1, '2026-09-30');
    const day1n2 = order('d1n2', '2026-09-29T08:00:00Z', 2, '2026-09-29');
    const day1n1 = order('d1n1', '2026-09-29T04:00:00Z', 1, '2026-09-29');
    const sorted = sortMergedWork([row(day1n2), row(day2n2), row(day1n1), row(day2n1)]);
    expect(sorted.map(r => r.order.id)).toEqual(['d2n1', 'd2n2', 'd1n1', 'd1n2']);
  });

  it('falls back to the IST calendar day of createdAt when dailyNoDay is missing', () => {
    // 2026-09-30T20:00:00Z = 2026-10-01 01:30 IST — the next IST day.
    const noDay = order('nd', '2026-09-30T20:00:00Z', 5, null);
    const withDay = order('wd', '2026-09-30T04:00:00Z', 1, '2026-09-30');
    const sorted = sortMergedWork([row(withDay), row(noDay)]);
    expect(sorted.map(r => r.order.id)).toEqual(['nd', 'wd']); // 1 Oct IST sorts before 30 Sep IST
  });
});

describe('work-merge — buildMergedWork (merge + sort together)', () => {
  it('dedupes AND sorts in one call', () => {
    const o1 = order('o1', '2026-09-30T04:00:00Z', 2, '2026-09-30'); // in progress + billing
    const o2 = order('o2', '2026-09-30T03:00:00Z', 1, '2026-09-30'); // completed only
    const buckets: WorkBucket<O>[] = [
      { status: 'ip', orders: [o1] },
      { status: 'billing', orders: [o1] },
      { status: 'done', orders: [o2] },
    ];
    const rows = buildMergedWork(buckets);
    expect(rows.map(r => r.order.id)).toEqual(['o2', 'o1']); // serial 1 then 2
    expect(rows[1].primary).toBe('billing');
    expect(rows[1].secondary).toEqual(['ip']);
    expect(rows[0].primary).toBe('done');
  });
});
