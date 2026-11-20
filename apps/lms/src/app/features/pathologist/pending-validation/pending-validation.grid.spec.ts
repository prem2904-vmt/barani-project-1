import { pvColumns, pvMeta, pvRing, pvRows, pvWaiting } from './pending-validation.grid';
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

describe('Pathologist grid — the shared ring (Validation is the open step)', () => {
  const items = [{ status: 'entered', subOrder: { receivedAtLab: '2026-11-20T09:00:00Z' } }] as never;
  it('entered tubes wait on validation: now, or late past the TAT', () => {
    expect(pvRing({ items, remainingMin: 20 }).map(s => s.state)).toEqual(['done', 'done', 'done', 'done', 'now']);
    expect(pvRing({ items, remainingMin: -5 }).map(s => s.state)).toEqual(['done', 'done', 'done', 'done', 'late']);
    expect(pvRing({ items, remainingMin: null }).at(-1)!.label).toBe('Validation');
  });
});

describe('Pathologist grid — columns (no Tests column) fold by the main card width', () => {
  const vis = (f: Parameters<typeof pvColumns>[0]) => pvColumns(f).filter(c => !c.hide).map(c => c.colId);
  it('full: Sample ID · Patient · Status · Journey · Waiting · actions', () => {
    expect(vis('full')).toEqual(['sample', 'patient', 'status', 'journey', 'wait', 'acts']);
  });
  it('fold: Status folds under the patient, the journey ring stays; tight: the ring folds; actions never hide', () => {
    expect(vis('fold')).toEqual(['sample', 'patient', 'journey', 'wait', 'acts']);
    expect(vis('tight')).toEqual(['sample', 'patient', 'wait', 'acts']);
  });
  it('meta line: age/sex · MRN · department · N tests · entered time', () => {
    const m = pvMeta({ patientMeta: '44/F · AA0007', dept: 'Haematology', items: [{ resultedAt: '2026-11-20T09:48:00Z' }, { resultedAt: '2026-11-20T09:40:00Z' }] as never });
    expect(m).toMatch(/^44\/F · AA0007 · Haematology · 2 tests · entered /);
  });
});
