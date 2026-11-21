import {
  MwDoneTube, MwGroup, MwRow, MwTube, NO_MW_FILTER, countLabel, deptOptions, filterMwRows, sortColOf, sortKeyOf, statusKeyOf, statusOptions, testsSummary,
  doneMenu, donePrimary, doneRowsOf, doneStatus, groupPrimary, groupStatus, mwColumns,
  patientRowsOf, sampleRowsOf, tatCell, tubeLate, tubeMenu, tubePrimary, tubeStatus,
} from './my-work.grid';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const line = (status: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'l-' + status, status, test: { name: 'CBC' }, subOrder: { id: 's1', receivedAtLab: '2026-11-20T09:20:00Z' }, ...extra }) as never;
const tube = (o: Partial<MwTube> = {}): MwTube & { patientName: string; patientMeta: string } => ({
  sampleId: 's1', deptName: 'Haematology', barcode: '0126101', tests: [line('pending')], allDone: false, hasDraft: false,
  assignedTo: 'me', rejections: [], remainingMin: 30, dueAt: NOW + 30 * 60000, patientName: 'Ms. Arya Stark', patientMeta: '30/F · AA0003', ...o,
});
const MY = { tab: 'my_work' as const, myId: 'me', canReassign: false, canEdit: true };
const Q = { ...MY, tab: 'service_queue' as const };

describe('My Work grid — status: ONE neutral pill + dot, no yellow', () => {
  it('My Work words follow the tube: To enter · Draft · Re-entry (rose) · Entered (green)', () => {
    expect(tubeStatus(tube(), MY)).toEqual({ label: 'To enter', tone: 'neutral' });
    expect(tubeStatus(tube({ hasDraft: true }), MY)).toEqual({ label: 'Draft', tone: 'violet' });
    expect(tubeStatus(tube({ rejections: [{ testName: 'CBC', reason: 'haemolysed' }] }), MY)).toEqual({ label: 'Re-entry', tone: 'rose' });
    expect(tubeStatus(tube({ allDone: true }), MY)).toEqual({ label: 'Entered', tone: 'green' });
  });
  it('the queue says who holds a claimed tube', () => {
    expect(tubeStatus(tube({ assignedTo: null }), Q).label).toBe('In queue');
    expect(tubeStatus(tube({ assignedTo: 'me' }), Q).label).toBe('Claimed · You');
    expect(tubeStatus(tube({ assignedTo: 't2' }), Q, () => 'Ravi T').label).toBe('Claimed · Ravi T');
    expect(tubeStatus(tube({ assignedTo: 't2' }), Q, () => 'Claimed').label).toBe('Claimed');   // name not loaded yet
  });
  it('a patient row shows the most pressing tube (rose wins), all-done only when every tube is done', () => {
    expect(groupStatus([tube({ allDone: true }), tube({ rejections: [{ testName: 'x', reason: 'y' }] })], MY).tone).toBe('rose');
    expect(groupStatus([tube({ allDone: true }), tube({ allDone: true })], MY).label).toBe('Entered');
    expect(groupStatus([tube({ allDone: true }), tube()], MY).label).toBe('To enter');
    expect(groupStatus([tube({ allDone: true }), tube({ hasDraft: true })], MY).label).toBe('Draft');
    expect(groupStatus([tube(), tube()], { tab: 'service_queue', myId: 'me' }).label).toBe('2 tubes');
    expect(groupStatus([tube()], { tab: 'service_queue', myId: 'me' }).label).toBe('Claimed · You');
  });
  it('completed: Validated (green) · Partly validated · n open (sky) · Submitted (violet)', () => {
    expect(doneStatus({ status: 'validated', openLines: 0 })).toEqual({ label: 'Validated', tone: 'green' });
    expect(doneStatus({ status: 'partial', openLines: 3 })).toEqual({ label: 'Partly validated · 3 open', tone: 'sky' });
    expect(doneStatus({ status: 'submitted', openLines: 0 }).tone).toBe('violet');
  });
});

describe('My Work grid — ONE primary at the row end = the old tile tap; the rest in ⋯', () => {
  it('My Work: Enter results / Continue (draft) / Re-enter; nothing when every test is in', () => {
    expect(tubePrimary(tube(), MY)!.label).toBe('Enter results');
    expect(tubePrimary(tube({ hasDraft: true }), MY)!.label).toBe('Continue');
    expect(tubePrimary(tube({ tests: [line('re_entry')] }), MY)!.label).toBe('Re-enter');
    expect(tubePrimary(tube({ allDone: true }), MY)).toBeNull();
    expect(tubePrimary(tube(), MY)!.id).toBe('enter');
  });
  it('Queue: Pick up — never on someone else\'s claimed tube (the tap did nothing there either)', () => {
    expect(tubePrimary(tube({ assignedTo: null }), Q)).toMatchObject({ id: 'pick', label: 'Pick up' });
    expect(tubePrimary(tube({ assignedTo: 'me' }), Q)!.id).toBe('pick');
    expect(tubePrimary(tube({ assignedTo: 't2' }), Q)).toBeNull();
  });
  it('Delegate sits in ⋯ exactly where the tile showed it', () => {
    expect(tubeMenu(tube(), MY).map(a => a.id)).toEqual(['delegate']);
    expect(tubeMenu(tube({ allDone: true }), MY)).toEqual([]);
    expect(tubeMenu(tube(), { ...Q, canReassign: false })).toEqual([]);
    expect(tubeMenu(tube(), { ...Q, canReassign: true }).map(a => a.id)).toEqual(['delegate']);
  });
  it('a patient with several tubes gets "N tubes" (the old expand); one tube = that tube\'s action', () => {
    expect(groupPrimary([tube()], MY, false)!.label).toBe('Enter results');
    expect(groupPrimary([tube(), tube({ sampleId: 's2' })], MY, false)).toMatchObject({ id: 'tubes', label: '2 tubes', aria: 'Show 2 tubes' });
    expect(groupPrimary([tube(), tube({ sampleId: 's2' })], MY, true)!.aria).toBe('Hide 2 tubes');
  });
  it('completed: Print once validated, else Edit (with the permission); View · Edit in ⋯', () => {
    const d = (status: string): MwDoneTube => ({ sampleId: 's9', tests: [], barcode: '0126109', deptName: 'Biochemistry', patientName: 'N',
      patientMeta: '', testNames: 'Urine', status, openLines: 0, completedAt: null });
    expect(donePrimary(d('validated'), { canEdit: true })!.id).toBe('print');
    expect(donePrimary(d('partial'), { canEdit: false })!.id).toBe('print');
    expect(donePrimary(d('submitted'), { canEdit: true })!.id).toBe('edit');
    expect(donePrimary(d('submitted'), { canEdit: false })).toBeNull();
    expect(doneMenu(d('validated'), { canEdit: true }).map(a => a.id)).toEqual(['view', 'edit']);
    expect(doneMenu(d('submitted'), { canEdit: true }).map(a => a.id)).toEqual(['view']);
    expect(doneMenu(d('validated'), { canEdit: false }).map(a => a.id)).toEqual(['view']);
  });
});

describe('My Work grid — Due + TAT', () => {
  it('no journey ring on the lab screens (owner 2026-11-21): a tube is late only past TAT with something left to enter', () => {
    expect(tubeLate(tube({ remainingMin: -5 }))).toBe(true);
    expect(tubeLate(tube({ remainingMin: 5 }))).toBe(false);
    expect(tubeLate(tube({ allDone: true, remainingMin: -5 }))).toBe(false);   // nothing left to enter is never late
  });
  it('TAT word is rose only when overdue; "in lab 40m" under it', () => {
    const ok = tatCell({ remainingMin: 30, dueAt: NOW + 30 * 60000 }, [line('pending')], false, NOW);
    expect(ok).toMatchObject({ text: 'Due in 30m', late: false, sub: 'in lab 40m' });
    const late = tatCell({ remainingMin: -20, dueAt: NOW - 20 * 60000 }, [line('pending')], false, NOW);
    expect(late).toMatchObject({ text: 'Overdue', late: true, detail: 'Overdue by 20m' });
    expect(tatCell({ remainingMin: null, dueAt: null }, [], true, NOW)).toMatchObject({ text: 'Done', late: false });
  });
});

describe('My Work grid — rows + columns', () => {
  it('sample focus: a row per tube, Urgent bucket first, keyed by the sample id', () => {
    const rows = sampleRowsOf([
      { priority: 'urgent', tubes: [tube({ sampleId: 'u1' })] },
      { priority: 'normal', tubes: [tube({ sampleId: 'n1' }), tube({ sampleId: 'n2' })] },
    ]);
    expect(rows.map(r => [r.kind, r.id, (r as { priority?: string }).priority])).toEqual([['tube', 'u1', 'urgent'], ['tube', 'n1', 'normal'], ['tube', 'n2', 'normal']]);
  });
  it('patient focus: a row per patient; an open patient gets ONE inline tubes row under it', () => {
    const g = (id: string): MwGroup => ({ orderId: id, patientName: id, patientMeta: '', items: [], priority: 'normal', remainingMin: null, dueAt: null });
    const rows = patientRowsOf([{ priority: 'normal', groups: [{ group: g('o1'), tubes: [tube()] }, { group: g('o2'), tubes: [tube(), tube()] }] }], id => id === 'o2');
    expect(rows.map(r => `${r.kind}:${r.id}`)).toEqual(['patient:o1', 'patient:o2', 'detail:o2~tubes']);
    expect((rows[1] as { open: boolean }).open).toBe(true);
  });
  it('completed: a row per finished tube', () => {
    expect(doneRowsOf([{ sampleId: 'x' } as MwDoneTube]).map(r => r.id)).toEqual(['x']);
  });
  it('NO Tests column (owner 2026-11-20); the actions column never hides; low-value columns fold first', () => {
    const vis = (m: Parameters<typeof mwColumns>[0], f: Parameters<typeof mwColumns>[1]) => mwColumns(m, f).filter(c => !c.hide).map(c => c.colId);
    expect(vis('sample', 'full')).toEqual(['sample', 'patient', 'priority', 'due', 'wait', 'status', 'acts']);
    expect(vis('patient', 'full')).toEqual(['patient', 'priority', 'due', 'wait', 'status', 'acts']);
    expect(vis('sample', 'fold')).toEqual(['sample', 'patient', 'due', 'wait', 'acts']);
    expect(vis('sample', 'tight')).toEqual(['patient', 'due', 'acts']);   // fits a 520px card
    expect(vis('done', 'full')).toEqual(['sample', 'patient', 'status', 'when', 'acts']);
    for (const m of ['sample', 'patient', 'done'] as const) expect(mwColumns(m, 'full').map(c => c.colId)).not.toContain('journey');
    expect(vis('done', 'tight')).toEqual(['patient', 'acts']);
    for (const m of ['sample', 'patient', 'done'] as const) expect(mwColumns(m, 'full').map(c => c.colId)).not.toContain('tests');
    expect(mwColumns('sample', 'full').map(c => c.header).join(' ')).not.toMatch(/High/);
  });
});

describe('My Work grid — compact tests ("Biochemistry · 12 tests")', () => {
  const t = (dept: string, extra: Record<string, unknown> = {}) => ({ id: Math.random().toString(), test: { name: 'T', department: { id: dept, name: dept } }, subOrder: {}, ...extra }) as never;
  it('one department: its name + the count; several: "N departments"; a profile counts as one test', () => {
    expect(testsSummary([t('Biochemistry'), t('Biochemistry')])).toBe('Biochemistry · 2 tests');
    expect(testsSummary([t('Biochemistry')])).toBe('Biochemistry · 1 test');
    expect(testsSummary([t('Biochemistry'), t('Haematology'), t('Haematology')])).toBe('2 departments · 3 tests');
    expect(testsSummary([t('Biochemistry', { profileTestId: 'p1' }), t('Biochemistry', { profileTestId: 'p1' })])).toBe('Biochemistry · 1 test');
  });
});

describe('My Work grid — card-head filters', () => {
  const mk = (id: string, o: Partial<MwTube> = {}, priority: 'urgent' | 'normal' = 'normal', dept = 'bio', mrn = 'AA00' + id) =>
    ({ kind: 'tube', id, priority, tube: tube({ sampleId: id, barcode: '01261' + id, patientName: 'P ' + id,
      tests: [{ id: 'l' + id, status: 'pending', test: { name: 'X', department: { id: dept, name: dept } },
        subOrder: { id, barcode: '01261' + id, order: { patient: { displayName: 'P ' + id, mrn } } } }] as never, ...o }) }) as MwRow;
  const rows = [mk('01'), mk('02', { hasDraft: true }, 'urgent', 'hae'), mk('03', { rejections: [{ testName: 'x', reason: 'y' }] }), mk('04', { hasDraft: true })];
  const statusOf = (r: MwRow) => statusKeyOf(tubeStatus((r as { tube: MwTube }).tube, MY).label);
  it('search matches the sample ID, the patient and the MRN', () => {
    expect(filterMwRows(rows, { ...NO_MW_FILTER, q: '0126102' }, statusOf).map(r => r.id)).toEqual(['02']);
    expect(filterMwRows(rows, { ...NO_MW_FILTER, q: 'p 03' }, statusOf).map(r => r.id)).toEqual(['03']);
    expect(filterMwRows(rows, { ...NO_MW_FILTER, q: 'aa0004' }, statusOf).map(r => r.id)).toEqual(['04']);
  });
  it('status · priority · department narrow together', () => {
    expect(filterMwRows(rows, { ...NO_MW_FILTER, status: 'draft' }, statusOf).map(r => r.id)).toEqual(['02', '04']);
    expect(filterMwRows(rows, { ...NO_MW_FILTER, status: 'draft', priority: 'urgent' }, statusOf).map(r => r.id)).toEqual(['02']);
    expect(filterMwRows(rows, { ...NO_MW_FILTER, dept: 'hae' }, statusOf).map(r => r.id)).toEqual(['02']);
  });
  it('the pill lists only statuses the view has, with counts on the other filters', () => {
    expect(statusOptions(rows, NO_MW_FILTER, 'work', statusOf).map(o => `${o.label} ${o.count}`)).toEqual(['All 4', 'To enter 1', 'Draft 2', 'Re-entry 1']);
    expect(statusOptions(rows, { ...NO_MW_FILTER, priority: 'urgent' }, 'work', statusOf).map(o => `${o.label} ${o.count}`)).toEqual(['All 1', 'Draft 1']);
  });
  it('a patient\'s inline tubes row follows its patient', () => {
    const g = (id: string): MwGroup => ({ orderId: id, patientName: id, patientMeta: '', items: [], priority: 'normal', remainingMin: null, dueAt: null });
    const pr = patientRowsOf([{ priority: 'normal', groups: [{ group: g('keep'), tubes: [tube()] }, { group: g('drop'), tubes: [tube()] }] }], () => true);
    expect(filterMwRows(pr, { ...NO_MW_FILTER, q: 'keep' }, () => 'to_enter').map(r => r.id)).toEqual(['keep', 'keep~tubes']);
  });
  it('departments for the Filters menu; "4 of 9 samples" while filtered', () => {
    expect(deptOptions(rows)).toEqual([{ id: 'bio', name: 'bio' }, { id: 'hae', name: 'hae' }]);
    expect(countLabel(4, 9, 'sample')).toBe('4 of 9 samples');
    expect(countLabel(9, 9, 'sample')).toBe('9 samples');
    expect(countLabel(1, 1, 'patient')).toBe('1 patient');
  });
  it('status keys from the words', () => {
    expect(['To enter', 'Draft', 'Re-entry', 'Entered', 'In queue', 'Claimed · You', '2 tubes', 'Validated', 'Partly validated · 3 open', 'Submitted'].map(statusKeyOf))
      .toEqual(['to_enter', 'draft', 're_entry', 'entered', 'in_queue', 'claimed', 'claimed', 'validated', 'partial', 'submitted']);
  });
});

describe('My Work grid — header sort = the old band sort picker (persisted LabSortService key)', () => {
  it('headers map to the same keys; no header / Due = the default order (Urgent first, then soonest due)', () => {
    expect(sortKeyOf('sample', { colId: 'sample', sort: 'asc' })).toBe('sample');
    expect(sortKeyOf('sample', { colId: 'patient', sort: 'asc' })).toBe('patient');
    expect(sortKeyOf('sample', { colId: 'wait', sort: 'desc' })).toBe('oldest');
    expect(sortKeyOf('sample', { colId: 'wait', sort: 'asc' })).toBe('newest');
    expect(sortKeyOf('sample', { colId: 'due', sort: 'asc' })).toBe('default');
    expect(sortKeyOf('sample', null)).toBe('default');
    expect(sortKeyOf('done', { colId: 'when', sort: 'desc' })).toBe('default');
    expect(sortKeyOf('done', { colId: 'when', sort: 'asc' })).toBe('oldest');
  });
  it('a saved key shows its arrow on the matching header (round trip)', () => {
    for (const k of ['default', 'oldest', 'newest', 'patient', 'sample'] as const) expect(sortKeyOf('sample', sortColOf('sample', k))).toBe(k);
    for (const k of ['default', 'oldest', 'patient', 'sample'] as const) expect(sortKeyOf('done', sortColOf('done', k))).toBe(k);
    expect(sortColOf('patient', 'sample')).toBeNull();   // patient focus has no Sample ID column
  });
});
