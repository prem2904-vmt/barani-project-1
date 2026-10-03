import { visitItems } from './consult-records';
import type { ConsultPastConsult, ConsultWorkspace } from './consult.api';
import { fitChips } from './vitals-strip.component';

describe('Vitals chips — whole chips only', () => {
  it('all fit → all show', () => {
    expect(fitChips([100, 80, 90], 300, 8)).toBe(3);
  });
  it('otherwise the trailing chips fold into "+N" and the +N chip always has room', () => {
    // 100 + 8 + 80 = 188; + 8 + 48 (the +N) = 244 ≤ 260 → 2 shown; a 3rd would need 196 + 90 > room.
    expect(fitChips([100, 80, 90, 70], 260, 8, 48)).toBe(2);
    expect(fitChips([200, 80], 150, 8, 48)).toBe(0);
  });
});

describe('Patient panel records — no tile for the consult the doctor is in', () => {
  const ws = { visit: { id: 'v-now', status: 'in_consult', tokenLabel: 'A3', purpose: 'Rash', checkedInAt: '2026-10-03T04:00:00Z' },
    vitals: { visitId: 'v-now', bpSys: 120, bpDia: 80, recordedAt: '2026-10-03T04:10:00Z' } } as unknown as ConsultWorkspace;
  const past = [{ visitId: 'v-old', visitDate: '2026-09-03T05:00:00Z', doctorName: 'Dr Rao', diagnoses: [], rx: [], investigations: [] }] as unknown as ConsultPastConsult[];
  const base = { ws, history: past, orders: [], docs: [], trends: null, intakeCount: 0 };
  it("today: Vitals record + Desk note, but no Today's consult tile", () => {
    const items = visitItems({ ...base, dayKey: '2026-10-03', todayKey: '2026-10-03' });
    expect(items.some(i => i.consultId)).toBe(false);
    expect(items.map(i => i.title)).toEqual(['Vitals record', 'Desk note']);
  });
  it('a past visit keeps its consult tile (compare opens it)', () => {
    const items = visitItems({ ...base, dayKey: '2026-09-03', todayKey: '2026-10-03' });
    expect(items.find(i => i.consultId === 'v-old')?.compare).toBe(true);
  });
});
