import { activeWords, fromWorkStatus, statusWords, statusWordsText, toneOfWork } from './status-words';
import { whereWords } from '../../features/frontdesk/frontdesk-landing/flow-grid/flow-row';
import { doneWords, groupWords, tubeWords, type MwTube } from '../../features/lab/my-work/my-work.grid';
import { cultureWords } from '../../features/lab/culture-panel/culture-grid';
import { pvWords } from '../../features/pathologist/pending-validation/pending-validation.grid';
import { queueWords } from '../../features/reports/report-queue/report-queue.partial';
import { FLOW_COL_ALIAS, flowColId } from '../../features/frontdesk/frontdesk-landing/flow-grid/flow-fold';

/**
 * Status words (owner design D, 2026-11-21): every table status → two lines of words + ONE tone
 * (late = soft rose, done = soft green, else normal). No pill, no dot anywhere.
 */
describe('status words — the shared helper', () => {
  it('builds two lines; an empty detail drops line 2; blank line 1 reads "—"', () => {
    expect(statusWords('Billed', '0 of 2 tubes collected')).toEqual({ now: 'Billed', detail: '0 of 2 tubes collected', tone: 'normal' });
    expect(statusWords('Ready', '  ')).toEqual({ now: 'Ready', detail: null, tone: 'normal' });
    expect(statusWords('', null, 'late').now).toBe('—');
    expect(statusWords('Failed', 'Number invalid', 'late', 'WhatsApp said no').title).toBe('WhatsApp said no');
  });
  it('old pill tones → word colour: green = done, rose = late, the rest normal', () => {
    expect(toneOfWork('green')).toBe('done');
    expect(toneOfWork('rose')).toBe('late');
    for (const t of ['violet', 'sky', 'neutral', undefined, 'amber']) expect(toneOfWork(t)).toBe('normal');
  });
  it('a WorkStatus label splits on " · " into line 1 + detail; late overrides all but done', () => {
    expect(fromWorkStatus({ label: 'Claimed · You', tone: 'neutral' })).toEqual({ now: 'Claimed', detail: 'You', tone: 'normal' });
    expect(fromWorkStatus({ label: 'Draft', tone: 'violet' }, 'Saved', { late: true }).tone).toBe('late');
    expect(fromWorkStatus({ label: 'Entered', tone: 'green' }, null, { late: true }).tone).toBe('done');
  });
  it('one line for aria / tooltips; Active / Inactive never rose', () => {
    expect(statusWordsText(statusWords('Billed', 'Next: collect'))).toBe('Billed, Next: collect');
    expect(statusWordsText(null)).toBe('');
    expect(activeWords(true)).toEqual({ now: 'Active', detail: null, tone: 'normal' });
    expect(activeWords(false).tone).toBe('normal');
  });
});

describe('Frontdesk Where now — whereWords', () => {
  const row = (o: Partial<Parameters<typeof whereWords>[0]>) =>
    ({ where: 'Billed', whereSub: '0 of 2 tubes collected', tone: 'violet', late: false, status: 'ip', ...o }) as Parameters<typeof whereWords>[0];
  it('line 1 = the stage word, line 2 = its detail', () => {
    expect(whereWords(row({}))).toEqual({ now: 'Billed', detail: '0 of 2 tubes collected', tone: 'normal' });
  });
  it('late (over 30 min at the stage), payment due (rose stage) and not collected read rose', () => {
    expect(whereWords(row({ late: true })).tone).toBe('late');
    expect(whereWords(row({ tone: 'rose' })).tone).toBe('late');
    expect(whereWords(row({ where: '1 of 2 not collected' })).tone).toBe('late');
  });
  it('done reads green and never rose', () => {
    expect(whereWords(row({ tone: 'green', where: 'Report ready', late: true })).tone).toBe('done');
    expect(whereWords(row({ status: 'done', tone: 'violet' })).tone).toBe('done');
  });
  it('a draft / OPD visit keeps its own two lines', () => {
    expect(whereWords(row({ where: 'Draft', whereSub: '2 tests · not ordered yet', tone: 'neutral' })))
      .toEqual({ now: 'Draft', detail: '2 tests · not ordered yet', tone: 'normal' });
    expect(whereWords(row({ where: 'Waiting', whereSub: 'Dr. Rao · General' }))).toEqual({ now: 'Waiting', detail: 'Dr. Rao · General', tone: 'normal' });
  });
  it('a saved "journey" column id maps to "where" (the Journey column merged in)', () => {
    expect(FLOW_COL_ALIAS['journey']).toBe('where');
    expect(flowColId('journey')).toBe('where');
    expect(flowColId('pay')).toBe('pay');
  });
});

describe('Lab My Work — tube / patient / completed words', () => {
  const line = (status: string) => ({ id: 'l-' + status, status, test: { name: 'CBC' }, subOrder: { id: 's1' } }) as never;
  const tube = (o: Partial<MwTube> = {}): MwTube => ({
    sampleId: 's1', deptName: 'Haematology', barcode: '0126101', tests: [line('pending')], allDone: false, hasDraft: false,
    assignedTo: 'me', rejections: [], remainingMin: 30, dueAt: null, ...o,
  });
  const MY = { tab: 'my_work' as const, myId: 'me' };
  const Q = { tab: 'service_queue' as const, myId: 'me' };
  it('To enter · Draft · Re-entry (rose, the reason) · Entered (green)', () => {
    expect(tubeWords(tube(), MY)).toEqual({ now: 'To enter', detail: 'Nothing entered yet', tone: 'normal' });
    expect(tubeWords(tube({ hasDraft: true }), MY)).toEqual({ now: 'Draft', detail: 'Saved, not submitted', tone: 'normal' });
    expect(tubeWords(tube({ rejections: [{ testName: 'CBC', reason: 'haemolysed' }] }), MY)).toEqual({ now: 'Re-entry', detail: 'Sent back · fix and resubmit', tone: 'late' });
    expect(tubeWords(tube({ allDone: true }), MY)).toEqual({ now: 'Entered', detail: 'All 1 test in', tone: 'done' });
  });
  it('past its TAT with work left reads rose', () => {
    expect(tubeWords(tube({ remainingMin: -12 }), MY)).toEqual({ now: 'To enter', detail: 'Past TAT · nothing entered', tone: 'late' });
    expect(tubeWords(tube({ remainingMin: -12, hasDraft: true }), MY).tone).toBe('late');
    expect(tubeWords(tube({ remainingMin: -12, allDone: true }), MY).tone).toBe('done');
  });
  it('the queue: In queue / Not picked up; Claimed / By you · By <name>', () => {
    expect(tubeWords(tube({ assignedTo: null }), Q)).toEqual({ now: 'In queue', detail: 'Not picked up · 1 test', tone: 'normal' });
    expect(tubeWords(tube({ assignedTo: 'me' }), Q)).toEqual({ now: 'Claimed', detail: 'By you', tone: 'normal' });
    expect(tubeWords(tube({ assignedTo: 't2' }), Q, () => 'Ravi T').detail).toBe('By Ravi T');
    expect(tubeWords(tube({ assignedTo: 't2' }), Q, () => 'Claimed').detail).toBe('By another technician');
  });
  it('a patient with 2+ tubes counts the tubes entered; rose wins', () => {
    const two = [tube({ allDone: true }), tube({ sampleId: 's2' })];
    expect(groupWords(two, MY)).toEqual({ now: 'To enter', detail: '1 of 2 tubes entered', tone: 'normal' });
    expect(groupWords([tube({ allDone: true }), tube({ sampleId: 's2', allDone: true })], MY)).toEqual({ now: 'Entered', detail: 'All 2 tubes in', tone: 'done' });
    expect(groupWords([tube(), tube({ sampleId: 's2', rejections: [{ testName: 'X', reason: 'y' }] })], MY).tone).toBe('late');
    expect(groupWords([tube({ assignedTo: null }), tube({ sampleId: 's2', assignedTo: null })], Q)).toEqual({ now: 'In queue', detail: '2 tubes', tone: 'normal' });
    expect(groupWords([tube()], MY)).toEqual(tubeWords(tube(), MY));
  });
  it('completed: Validated (green) · Partly validated · Submitted', () => {
    expect(doneWords({ status: 'validated', openLines: 0 })).toEqual({ now: 'Validated', detail: 'Report ready', tone: 'done' });
    expect(doneWords({ status: 'partial', openLines: 2 })).toEqual({ now: 'Partly validated', detail: '2 tests still open', tone: 'normal' });
    expect(doneWords({ status: 'submitted', openLines: 3 })).toEqual({ now: 'Submitted', detail: 'Waiting for validation', tone: 'normal' });
  });
});

describe('Culture — Next step words', () => {
  const NOW = Date.parse('2026-11-21T10:00:00Z');
  const kase = (o: Record<string, unknown>) => ({ orderTestId: 'o1', createdAt: '2026-11-19T10:00:00Z', ...o }) as never;
  it('read due → rose; incubating → when it is ready; not started; sign-out', () => {
    const due = cultureWords(kase({ stages: [{ label: 'Growth', state: 'pending', incubateUntil: '2026-11-21T09:00:00Z' }] }), NOW);
    expect(due.now).toBe('Growth');
    expect(due.tone).toBe('late');
    expect(due.detail).toBe('Read due · Day 3');
    const inc = cultureWords(kase({ stages: [{ label: 'Growth', state: 'pending', incubateUntil: '2026-11-21T12:00:00Z' }] }), NOW);
    expect(inc.now).toBe('Growth');
    expect(inc.tone).toBe('normal');
    expect(inc.detail).toMatch(/^Incubating · ready in 2h/);   // shared duration words (work-grid durationText)
    expect(cultureWords(kase({ stages: [{ label: 'Gram', state: 'pending' }] }), NOW)).toEqual({ now: 'Gram', detail: 'Not started', tone: 'normal' });
    expect(cultureWords(kase({ stages: [{ label: 'Gram', state: 'done' }] }), NOW)).toEqual({ now: 'Sign-out', detail: 'Ready to sign out', tone: 'normal' });
    expect(cultureWords(kase({ stages: [{ label: 'Gram', state: 'picked', holderUserId: 'me' }] }), NOW, 'me').detail).toBe('You');
  });
});

describe('Pathologist — validation queue words', () => {
  it('Critical / Not acknowledged (rose) · Overdue (rose) · Due soon · To validate', () => {
    expect(pvWords({ key: 'critical', label: 'Critical' }, true)).toEqual({ now: 'Critical', detail: 'Not acknowledged', tone: 'late' });
    expect(pvWords({ key: 'critical', label: 'Critical' }, false)).toEqual({ now: 'Critical', detail: 'Acknowledged · to validate', tone: 'late' });
    expect(pvWords({ key: 'overdue', label: 'Overdue' }, false)).toEqual({ now: 'Overdue', detail: 'Past its TAT · to validate', tone: 'late' });
    expect(pvWords({ key: 'due', label: 'Due in 20m' }, false)).toEqual({ now: 'Due soon', detail: 'Due in 20m', tone: 'normal' });
    expect(pvWords({ key: 'ontime', label: 'On time' }, false)).toEqual({ now: 'To validate', detail: 'On time', tone: 'normal' });
  });
});

describe('Results — report status words', () => {
  it('Ready / Not sent yet · Partial / Preliminary · Delivered / how (green) · Failed / reason (rose)', () => {
    expect(queueWords({ key: 'completed', label: 'Ready' }, '')).toEqual({ now: 'Ready', detail: 'Not sent yet', tone: 'normal' });
    expect(queueWords({ key: 'partial', label: 'Partial' }, '')).toEqual({ now: 'Partial', detail: 'Preliminary report', tone: 'normal' });
    expect(queueWords({ key: 'delivered', label: 'Delivered' }, 'WhatsApp · read 10:12')).toEqual({ now: 'Delivered', detail: 'WhatsApp · read 10:12', tone: 'done' });
    expect(queueWords({ key: 'delivered', label: 'Delivered' }, '')).toEqual({ now: 'Delivered', detail: 'Sent', tone: 'done' });
    expect(queueWords({ key: 'failed', label: 'Failed' }, 'WhatsApp number invalid')).toEqual({ now: 'Failed', detail: 'WhatsApp number invalid', tone: 'late' });
    expect(queueWords({ key: 'failed', label: 'Failed' }, '')).toEqual({ now: 'Failed', detail: 'Not delivered', tone: 'late' });
  });
});
