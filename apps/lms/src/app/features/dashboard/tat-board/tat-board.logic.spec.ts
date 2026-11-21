import {
  TatLine, bucketCounts, clockWords, defaultBucket, deptCounts, dueAtOf, dueInWords, groupBySample, humanize, inBucket,
  lateWords, lineHaystack, sortLines, sortSamples, statusWord, testsSummary, toLine,
} from './tat-board.logic';

const NOW = Date.parse('2026-11-19T10:00:00Z');   // 15:30 IST
const row = (id: string, o: Partial<TatLine> & { level?: string } = {}) => {
  const { level, ...rest } = o;
  return { ...toLine({ orderTestId: id, orderId: 'o1', patient: 'Ravi Kumar', test: 'Haemoglobin', status: 'pending',
    receivedAtLab: '2026-11-19T04:00:00Z', elapsedMinutes: 360, remainingMinutes: -30, level: level ?? 'urgent' }), ...rest } as TatLine;
};

describe('TAT — status in plain words', () => {
  it('maps every raw status to words, never the raw key', () => {
    expect(statusWord('pending')).toBe('Waiting for result');
    expect(statusWord('received')).toBe('Waiting for result');
    expect(statusWord('in_progress')).toBe('In progress');
    expect(statusWord('entered')).toBe('Waiting to validate');
    expect(statusWord('re_entry')).toBe('Result being re-entered');
    expect(statusWord('rejected')).toBe('Rejected, needs a new sample');
  });

  it('a culture still waiting for its result is incubating; once entered it waits to validate', () => {
    expect(statusWord('pending', true)).toBe('Culture incubating');
    expect(statusWord('in_progress', true)).toBe('Culture incubating');
    expect(statusWord('entered', true)).toBe('Waiting to validate');
  });

  it('an unknown status is humanised (no underscores, sentence case)', () => {
    expect(statusWord('awaiting_courier')).toBe('Awaiting courier');
    expect(humanize('some_raw_status')).toBe('Some raw status');
    expect(statusWord('')).not.toMatch(/_/);
    expect(statusWord(null)).toBe('In progress');
  });
});

describe('TAT — buckets', () => {
  const lines = [
    row('a1', { orderId: 'A', test: 'Hb', level: 'urgent' }),
    row('a2', { orderId: 'A', test: 'RBC', level: 'urgent' }),
    row('b1', { orderId: 'B', test: 'TSH', level: 'high', remainingMinutes: 20 }),
    row('c1', { orderId: 'C', test: 'HbA1c', level: 'normal', remainingMinutes: 300 }),
    row('c2', { orderId: 'A', test: 'Urea', level: 'normal', remainingMinutes: 300 }),
  ];

  it('counts samples and tests per bucket; a sample counts in a bucket for the tests that sit there', () => {
    const c = bucketCounts(lines, NOW);
    expect(c.overdue).toMatchObject({ samples: 1, tests: 2 });
    expect(c.dueSoon).toMatchObject({ samples: 1, tests: 1 });
    expect(c.onTrack).toMatchObject({ samples: 2, tests: 2 });
    expect(c.all).toMatchObject({ samples: 3, tests: 5 });
  });

  it('inBucket returns that bucket\'s tests (all = everything)', () => {
    expect(inBucket(lines, 'overdue').map((l) => l.orderTestId)).toEqual(['a1', 'a2']);
    expect(inBucket(lines, 'all').length).toBe(5);
  });

  it('opens on Overdue when anything is late, else on everything in progress', () => {
    expect(defaultBucket(bucketCounts(lines, NOW))).toBe('overdue');
    expect(defaultBucket(bucketCounts(lines.filter((l) => l.tat !== 'overdue'), NOW))).toBe('all');
  });

  it('keeps today\'s due-soon logic: the server\'s "high" word is the within-the-hour bucket', () => {
    expect(toLine({ orderTestId: 'x', status: 'pending', elapsedMinutes: 1, remainingMinutes: 5, level: 'high' }).tat).toBe('dueSoon');
    expect(toLine({ orderTestId: 'x', status: 'pending', elapsedMinutes: 1, remainingMinutes: null, level: 'weird' }).tat).toBe('onTrack');
  });
});

describe('TAT — by-sample grouping', () => {
  const lines = [
    row('1', { orderId: 'A', patient: 'Prem', test: 'Hb', deptId: 'h', deptName: 'Haematology', remainingMinutes: -300, level: 'urgent' }),
    row('2', { orderId: 'A', patient: 'Prem', test: 'RBC', deptId: 'h', deptName: 'Haematology', remainingMinutes: -120, level: 'urgent' }),
    row('3', { orderId: 'A', patient: 'Prem', test: 'Urea', deptId: 'b', deptName: 'Biochemistry', remainingMinutes: 40, level: 'high' }),
    row('4', { orderId: 'B', patient: 'Kavya', test: 'TSH', deptId: 'b', deptName: 'Biochemistry', remainingMinutes: 500, level: 'normal' }),
  ];

  it('one row per order and department (a tube), tests together', () => {
    const g = groupBySample(lines, NOW);
    expect(g.length).toBe(3);
    const hem = g.find((x) => x.deptName === 'Haematology')!;
    expect(hem.lines.map((l) => l.test)).toEqual(['Hb', 'RBC']);
    expect(hem.patient).toBe('Prem');
  });

  it('a sample is as late as its latest test, due at its soonest test, with the worst TAT state', () => {
    const hem = groupBySample(lines, NOW).find((x) => x.deptName === 'Haematology')!;
    expect(hem.lateMin).toBe(300);
    expect(hem.tat).toBe('overdue');
    const biochemA = groupBySample(lines, NOW).find((x) => x.orderId === 'A' && x.deptName === 'Biochemistry')!;
    expect(biochemA.tat).toBe('dueSoon');
    expect(biochemA.lateMin).toBe(-40);
  });

  it('without a department the whole order is one sample', () => {
    const noDept = lines.map((l) => ({ ...l, deptId: null, deptName: null }));
    expect(groupBySample(noDept, NOW).length).toBe(2);
  });

  it('sorts most late first, then soonest due', () => {
    const order = sortSamples(groupBySample(lines, NOW)).map((g) => `${g.orderId}:${g.deptName}`);
    expect(order).toEqual(['A:Haematology', 'A:Biochemistry', 'B:Biochemistry']);
    expect(sortLines(lines).map((l) => l.orderTestId)).toEqual(['1', '2', '3', '4']);
  });

  it('plain words per sample: distinct statuses, culture aware', () => {
    const g = groupBySample([row('1', { status: 'pending' }), row('2', { status: 'entered' }), row('3', { status: 'pending' })], NOW)[0];
    expect(g.nowWords).toEqual(['Waiting for result', 'Waiting to validate']);
    const cul = groupBySample([row('9', { status: 'in_progress', culture: true })], NOW)[0];
    expect(cul.nowWords).toEqual(['Culture incubating']);
  });
});

describe('TAT — departments, tests cell, words', () => {
  const lines = [
    row('1', { orderId: 'A', deptId: 'h', deptName: 'Haematology' }),
    row('2', { orderId: 'B', deptId: 'h', deptName: 'Haematology', level: 'normal', remainingMinutes: 200 }),
    row('3', { orderId: 'C', deptId: 'b', deptName: 'Biochemistry', level: 'normal', remainingMinutes: 200 }),
  ];
  it('department counts: samples and how many are late; none when no line knows its department', () => {
    expect(deptCounts(lines, NOW)).toEqual([
      { id: 'h', name: 'Haematology', samples: 2, late: 1 },
      { id: 'b', name: 'Biochemistry', samples: 1, late: 0 },
    ]);
    expect(deptCounts(lines.map((l) => ({ ...l, deptId: null, deptName: null })), NOW)).toEqual([]);
  });

  it('tests cell: headline + first five names with +N beyond', () => {
    const names = ['Hb', 'RBC', 'MCV', 'RDW', 'WBC', 'Neut', 'Lymph'].map((t, i) => row(String(i), { test: t }));
    expect(testsSummary(names)).toEqual({ head: '7 tests', names: 'Hb, RBC, MCV, RDW, WBC +2' });
    expect(testsSummary(names.slice(0, 3))).toEqual({ head: '3 tests', names: 'Hb, RBC, MCV' });
    expect(testsSummary(names.slice(0, 1))).toEqual({ head: 'Hb', names: '' });
  });

  it('search matches patient, order, test, department and the plain-words status', () => {
    const l = row('1', { orderId: 'ORD-77', patient: 'Prem Kumar', test: 'Lipid profile', deptName: 'Biochemistry', status: 'entered' });
    const hay = lineHaystack(l).join(' ').toLowerCase();
    for (const w of ['prem', 'ord-77', 'lipid', 'biochemistry', 'waiting to validate']) expect(hay).toContain(w);
  });

  it('Late by / Due words in the lab clock', () => {
    expect(lateWords(21 * 60 + 5)).toBe('21h 5m');
    expect(lateWords(-10)).toBe('—');
    expect(lateWords(null)).toBe('—');
    expect(dueInWords(-25)).toBe('in 25m');
    expect(dueInWords(30)).toBe('');
    expect(clockWords(NOW, NOW)).toBe('3:30 PM');
    expect(clockWords(NOW + 24 * 3600_000, NOW)).toBe('Tomorrow 3:30 PM');
    expect(clockWords(NOW - 24 * 3600_000, NOW)).toBe('Yesterday 3:30 PM');
    expect(clockWords(null, NOW)).toBe('—');
  });

  it('due time = lab receipt + elapsed + remaining', () => {
    const l = row('1', { receivedAtLab: '2026-11-19T04:00:00Z', elapsedMinutes: 360, remainingMinutes: -30 });
    expect(dueAtOf(l, NOW)).toBe(Date.parse('2026-11-19T09:30:00Z'));
    expect(dueAtOf(row('2', { remainingMinutes: null }), NOW)).toBeNull();
  });
});

import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { tatColumns, type TatGridRow } from './tat-board.component';

describe('TAT board grid columns', () => {
  const row = (o: Partial<TatGridRow> = {}): TatGridRow => ({ id: 'r', patient: 'Asha', head: 'CBC', names: '', dept: 'Haematology',
    receivedAt: 1_700_000_000_000, dueAt: 1_700_003_600_000, lateMin: 12, now: ['Waiting'], openId: 'x', ...o });
  for (const phone of [false, true]) {
    it(`${phone ? 'phone' : 'desktop'}: every data column sorts and filters; Open is action-only`, () => {
      const cols = tatColumns({ phone, mid: false, web: !phone, now: Date.now(), open: () => undefined });
      for (const c of cols) {
        if (c.colId === 'actions') { expect(c.sortable).toBe(false); expect(c.filter).toBe(false); continue; }
        expect(sortsAndFilters(c as never), String(c.colId)).toBe(true);
      }
    });
  }
  it('Late by sorts on minutes, Received / Due on the epoch', () => {
    const cols = tatColumns({ phone: false, mid: false, web: true, now: 0, open: () => undefined });
    const vg = (id: string) => (cols.find(c => c.colId === id)!.valueGetter as (p: { data: TatGridRow }) => unknown)({ data: row() });
    expect(vg('late')).toBe(12);
    expect(vg('received')).toBe(1_700_000_000_000);
    expect(vg('due')).toBe(1_700_003_600_000);
  });
});
