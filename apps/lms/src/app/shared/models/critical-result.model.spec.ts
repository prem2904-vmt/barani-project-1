import { CriticalResultEvent, criticalMethodLabel, criticalRoleLabel, criticalStatusWord, criticalViaLabel, needsAckBy } from './critical-result.model';
import { CriticalResultsService } from '../../core/services/critical-results.service';

/** The pure halves of the critical-result record the screens share. */
const ev = (over: Partial<CriticalResultEvent> = {}): CriticalResultEvent => ({
  id: 'e1', status: 'open', source: 'live', orderTestId: 'ot1', orderId: 'o1', resultVersion: 2,
  patientId: 'p1', patientName: 'Ms. Paravai Munusamy Ramalingam', testId: 't1', testName: 'Potassium',
  summary: 'Potassium 7.2 mmol/L CH', values: [], detectedAt: '2026-09-29T06:00:00Z', alertedCount: 3,
  acknowledgements: [], ...over,
});

describe('critical-result model', () => {
  it('has exactly one status word per state, red only for the unacknowledged', () => {
    expect(criticalStatusWord('open')).toEqual({ label: 'Not acknowledged', tone: 'red' });
    expect(criticalStatusWord('acknowledged')).toEqual({ label: 'Acknowledged', tone: 'amber' });
    expect(criticalStatusWord('communicated')).toEqual({ label: 'Communicated', tone: 'green' });
  });

  it('needsAckBy: a record is pending for a user until THEY acknowledge it (viewing never counts)', () => {
    const e = ev({ status: 'acknowledged', acknowledgements: [{ userId: 'u2', name: 'Dr A', at: '2026-09-29T06:05:00Z', via: 'bell' }] });
    expect(needsAckBy(e, 'u2')).toBe(false);
    expect(needsAckBy(e, 'me')).toBe(true);
    expect(needsAckBy(ev(), 'me')).toBe(true);
    // No user id known: only an open record needs a hand.
    expect(needsAckBy(ev(), null)).toBe(true);
    expect(needsAckBy(e, null)).toBe(false);
  });

  it('labels the method, role and channel in plain words', () => {
    expect(criticalMethodLabel('in_person')).toBe('In person');
    expect(criticalMethodLabel('whatsapp')).toBe('WhatsApp');
    expect(criticalRoleLabel('referring_doctor')).toBe('Referring doctor');
    expect(criticalViaLabel('pathologist_queue')).toBe('from the pathologist queue');
    expect(criticalViaLabel('legacy')).toBe('legacy (bell read)');
    expect(criticalMethodLabel(null)).toBe('');
  });

  it('builds the register query from the filter (IST business days, no empty keys)', () => {
    expect(CriticalResultsService.query({ status: 'all' })).toBe('');
    expect(CriticalResultsService.query({ status: 'open', from: '2026-09-01', to: '2026-09-29', branchId: null, page: 1, pageSize: 200 }))
      .toBe('?status=open&from=2026-09-01&to=2026-09-29&page=1&pageSize=200');
    expect(CriticalResultsService.query({ branchId: 'b2' })).toBe('?branchId=b2');
  });
});
