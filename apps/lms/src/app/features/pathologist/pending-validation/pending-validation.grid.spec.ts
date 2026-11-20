import { pvColumns, pvJourney, pvRows, pvWaiting } from './pending-validation.grid';
import type { QueueTile } from './pending-validation.logic';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const tile = (key: string, o: Partial<QueueTile> = {}): QueueTile => ({
  key, sampleId: key, sampleLabel: key, deptId: 'd', dept: 'Haematology', patientName: 'P', patientMeta: '', items: [],
  testNames: [], priority: 'normal', tat: 'onTrack', remainingMin: 60, anyCritical: false, mine: false, ...o,
});

describe('Pathologist grid — rows', () => {
  it('Urgent group rows first, then Normal, each in the queue\'s own order', () => {
    const rows = pvRows([{ tiles: [tile('u1', { priority: 'urgent' })] }, { tiles: [tile('n1'), tile('n2')] }]);
    expect(rows.map(r => r.key)).toEqual(['u1', 'n1', 'n2']);
  });
});

describe('Pathologist grid — waiting since entered (rose when past TAT)', () => {
  it('time since the latest entry + "entered <time>"', () => {
    const w = pvWaiting({ items: [{ resultedAt: '2026-11-20T09:48:00Z' }, { resultedAt: '2026-11-20T09:30:00Z' }] as never, remainingMin: 30 }, NOW);
    expect(w.text).toBe('12m');
    expect(w.sub).toMatch(/^entered /);
    expect(w.late).toBe(false);
  });
  it('late once overdue; "—" with nothing entered', () => {
    expect(pvWaiting({ items: [] as never, remainingMin: -1 }, NOW)).toEqual({ text: '—', sub: '', late: true });
  });
});

describe('Pathologist grid — journey (the open step is validation)', () => {
  it('entered tubes wait on validation: now, or late past TAT', () => {
    expect(pvJourney({ remainingMin: 20 }).map(s => s.state)).toEqual(['done', 'done', 'done', 'now']);
    expect(pvJourney({ remainingMin: -5 }).map(s => s.state)).toEqual(['done', 'done', 'done', 'late']);
    expect(pvJourney({ remainingMin: null }).at(-1)!.label).toBe('Validated');
  });
});

describe('Pathologist grid — columns fold by the main card width', () => {
  const vis = (f: Parameters<typeof pvColumns>[0]) => pvColumns(f).filter(c => !c.hide).map(c => c.colId);
  it('full: Sample ID · Patient · Tests · Status · Journey · Waiting · actions', () => {
    expect(vis('full')).toEqual(['sample', 'patient', 'tests', 'status', 'journey', 'wait', 'acts']);
  });
  it('fold: Status folds under the patient, Journey hides; tight: Tests fold under the patient; actions never hide', () => {
    expect(vis('fold')).toEqual(['sample', 'patient', 'tests', 'wait', 'acts']);
    expect(vis('tight')).toEqual(['sample', 'patient', 'wait', 'acts']);
  });
});
