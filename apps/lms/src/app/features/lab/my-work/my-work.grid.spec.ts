import {
  MwDoneTube, MwGroup, MwTube, doneJourney, doneMenu, donePrimary, doneRowsOf, doneStatus, groupPrimary, groupStatus, mwColumns,
  patientRowsOf, sampleRowsOf, tatCell, tubeJourney, tubeMenu, tubePrimary, tubeStatus,
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

describe('My Work grid — journey + TAT', () => {
  it('Collected → Received → Entered → Validated; the open step is now, rose (late) past TAT', () => {
    expect(tubeJourney(tube()).map(s => s.state)).toEqual(['done', 'done', 'now', 'todo']);
    expect(tubeJourney(tube({ remainingMin: -5 })).map(s => s.state)).toEqual(['done', 'done', 'late', 'todo']);
    expect(tubeJourney(tube({ allDone: true, tests: [line('entered')] })).map(s => s.state)).toEqual(['done', 'done', 'done', 'now']);
    expect(tubeJourney(tube({ allDone: true, tests: [line('validated')] })).every(s => s.state === 'done')).toBe(true);
    expect(doneJourney({ status: 'partial' }).map(s => s.state)).toEqual(['done', 'done', 'done', 'now']);
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
  it('columns come from what the tiles showed; the actions column is never hidden; low-value columns fold first', () => {
    const vis = (m: Parameters<typeof mwColumns>[0], f: Parameters<typeof mwColumns>[1]) => mwColumns(m, f).filter(c => !c.hide).map(c => c.colId);
    expect(vis('sample', 'full')).toEqual(['sample', 'patient', 'tests', 'priority', 'journey', 'tat', 'status', 'acts']);
    expect(vis('patient', 'full')).toEqual(['patient', 'tests', 'priority', 'journey', 'tat', 'status', 'acts']);
    expect(vis('sample', 'fold')).toEqual(['sample', 'patient', 'tests', 'journey', 'tat', 'acts']);
    expect(vis('sample', 'tight')).toEqual(['sample', 'patient', 'tat', 'acts']);
    expect(vis('done', 'full')).toEqual(['sample', 'patient', 'tests', 'journey', 'status', 'when', 'acts']);
    expect(vis('done', 'tight')).toEqual(['sample', 'patient', 'acts']);
    // Priority is Urgent / Normal only — the column is named Priority, never "High".
    expect(mwColumns('sample', 'full').map(c => c.header).join(' ')).not.toMatch(/High/);
  });
});
