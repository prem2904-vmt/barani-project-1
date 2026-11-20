import { labLineDetail, labLinePipeline, labLineRing } from './lab-line-journey';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const line = (status: string, extra: Record<string, unknown> = {}) => ({
  id: status, status, resultedByName: 'Ravi T',
  subOrder: { collectedAt: '2026-11-20T09:05:00Z', receivedAtLab: '2026-11-20T09:20:00Z', order: { createdAt: '2026-11-20T09:00:00Z', dailyNo: 12 } },
  ...extra,
}) as never;

describe('lab-line journey (shared ring for the lab grids)', () => {
  it('pipeline from the lines: not received → Dispatch is current; entered → Report is current', () => {
    expect(labLinePipeline([line('pending', { subOrder: {} })]).map(s => s.state)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
    expect(labLinePipeline([line('pending')]).map(s => s.state)).toEqual(['done', 'done', 'done', 'active', 'pending']);
    expect(labLinePipeline([line('entered')]).map(s => s.state)).toEqual(['done', 'done', 'done', 'done', 'active']);
    expect(labLinePipeline([line('validated')]).every(s => s.state === 'done')).toBe(true);
  });
  it('the journey view: blank disc (single-service), token, in-lab time, step times + who, the row\'s action', () => {
    const lines = [line('entered', { resultedAt: '2026-11-20T09:40:00Z' })];
    const run = () => undefined;
    const d = labLineDetail({ lines, ring: labLineRing(lines, false), name: 'Ms. Arya Stark', meta: '30/F', now: NOW, note: 'Due 11:00', action: { label: 'Review', run } });
    expect(d).toMatchObject({ service: 'lab', showLabel: false, name: 'Ms. Arya Stark', token: '#12', inClinicMin: 40, lateMin: null, usualMin: null });
    expect(d.visit).toMatch(/^In lab since /);
    expect(d.steps.map(s => s.label)).toEqual(['Billing', 'Sample', 'Dispatch', 'Result entry', 'Validation']);
    expect(d.steps[3]).toMatchObject({ state: 'done', by: 'Ravi T', minutes: 20 });
    expect(d.steps[4]).toMatchObject({ state: 'now', note: 'Due 11:00', minutes: 20 });
    expect(d.action!.run).toBe(run);
  });
  it('late rows carry the late minutes and the reason on the current step', () => {
    const lines = [line('pending')];
    const d = labLineDetail({ lines, ring: labLineRing(lines, true), name: 'P', now: NOW, lateMin: 25, note: 'Overdue by 25m' });
    expect(d.lateMin).toBe(25);
    expect(d.steps.find(s => s.state === 'late')).toMatchObject({ label: 'Result entry', note: 'Overdue by 25m' });
  });
});
