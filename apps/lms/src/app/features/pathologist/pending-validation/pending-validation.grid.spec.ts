import { pvColumns, pvMeta, pvRows, pvWaiting } from './pending-validation.grid';
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

describe('Pathologist grid — columns (no Tests column) fold by the main card width', () => {
  const vis = (f: Parameters<typeof pvColumns>[0]) => pvColumns(f).filter(c => !c.hide).map(c => c.colId);
  it('full: Sample ID · Patient · Status · Due · Waiting · actions — no journey ring (owner 2026-11-21)', () => {
    expect(vis('full')).toEqual(['sample', 'patient', 'status', 'due', 'wait', 'acts']);
    expect(pvColumns('full').map(c => c.colId)).not.toContain('journey');
  });
  it('fold: Status folds under the patient; tight: Sample ID + Waiting fold; Due and the actions never hide', () => {
    expect(vis('fold')).toEqual(['sample', 'patient', 'due', 'wait', 'acts']);
    expect(vis('tight')).toEqual(['patient', 'due', 'acts']);   // fits a 520px card
  });
  it('meta line: age/sex · MRN · department · N tests (the entered time is in the Waiting column)', () => {
    const m = pvMeta({ patientMeta: '44/F · AA0007', dept: 'Haematology', items: [{ resultedAt: '2026-11-20T09:48:00Z' }, { resultedAt: '2026-11-20T09:40:00Z' }] as never });
    expect(m).toBe('44/F · AA0007 · Haematology · 2 tests');
  });
});
