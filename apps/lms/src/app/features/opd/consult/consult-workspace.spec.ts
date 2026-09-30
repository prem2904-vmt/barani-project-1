import { TestBed } from '@angular/core/testing';
import type { OpdPatientAllergy, OpdRxLineDto } from '../shared/opd.models';
import { timesSched } from '../shared/rx-schedule';
import {
  ConsultEditState, applyUsual, daysBetween, draftBody, stepDone, stepSummary, undoUsual, usualsFrom,
} from './consult-state';
import { ConsultCompleteSheetComponent, addDaysIso, followUpFeeText } from './complete-sheet.component';
import { bmiOf, vitalFlag } from './vitals-strip.component';
import { nextToCall, tabOf } from './my-patients.page';
import type { ConsultQueueRow } from './consult.api';
import { ConsultDrugRef, ConsultRxLine } from './rx/rx-model';
import { addMedia, withoutConsultOwned } from './consult-workspace.page';
import { mediaRefOf } from './consult.api';
import { allQuestions, normalizeSchema } from '../admin/forms/renderer';
import { recentResultsOf } from './glance-panel.component';
import { rxPrintRows } from './rx-print';

const CLAV: ConsultDrugRef = { id: 'd-clav', name: 'Clavumox 625', form: 'tab', generic: 'Amoxicillin + Clavulanic acid' };
const PEN: OpdPatientAllergy = { id: 'a1', patientId: 'p', allergen: 'Penicillin', status: 'active' };
const LINE: ConsultRxLine = { key: 'k1', drug: CLAV, line: { drugId: CLAV.id, dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' } };
const BASE: ConsultEditState = {
  answers: {}, chiefComplaint: '', diagnoses: [], advice: '', privateNotes: '', privateNotesVisibility: 'doctor', lines: [], tests: [], followUpDays: null,
};
const dto = (drugId: string, pat = [1, 0, 1]): OpdRxLineDto => ({ drugId, drugName: drugId, form: 'tab', dose: 1, schedule: timesSched(pat), durationDays: 5, food: 'After' });

describe('Consult stepper summaries + ticks', () => {
  it('step 1: findings pending → diagnosis', () => {
    expect(stepSummary(1, BASE, [], 'doctor').text).toBe('Nothing noted yet · diagnosis pending');
    expect(stepSummary(1, { ...BASE, chiefComplaint: 'Nasal block' }, [], 'doctor').text).toBe('Findings noted · diagnosis pending');
    const s = { ...BASE, diagnoses: [{ label: 'Acute rhinosinusitis' }] };
    expect(stepSummary(1, s, [], 'doctor').text).toBe('Acute rhinosinusitis');
    expect(stepDone(1, BASE)).toBe(false);
    expect(stepDone(1, s)).toBe(true);
  });
  it('step 2 warns about an unreviewed allergy', () => {
    const s = { ...BASE, lines: [LINE] };
    expect(stepSummary(2, BASE, [], 'doctor').text).toBe('No medicines yet');
    expect(stepSummary(2, s, [PEN], 'doctor')).toEqual({ text: '1 medicine · allergy check', warn: true });
    expect(stepSummary(2, { ...BASE, lines: [{ ...LINE, allergyAck: true }] }, [PEN], 'doctor')).toEqual({ text: '1 medicine' });
  });
  it('steps 3 and 4', () => {
    expect(stepSummary(3, { ...BASE, tests: [{ testId: 't', name: 'Total IgE' }] }, [], 'doctor').text).toBe('Total IgE');
    expect(stepSummary(4, BASE, [], 'doctor').text).toBe('Private · doctor only');
    expect(stepSummary(4, BASE, [], 'all_doctors').text).toBe('Private · all doctors');
    expect(stepDone(4, BASE)).toBe(false);
  });
});

describe('Consult draft body + usual set', () => {
  it('draftBody sends the Rx in the shared schedule model and the tests as ids', () => {
    const b = draftBody({ ...BASE, lines: [LINE], tests: [{ testId: 't1', name: 'AEC', price: 150 }], chiefComplaint: '  x ' }, '2026-10-07');
    expect(b.rx[0]).toMatchObject({ drugId: 'd-clav', schedule: { type: 'times', pat: [1, 0, 1] }, durationDays: 5 });
    expect(b.investigationItems).toEqual([{ testId: 't1', name: 'AEC' }]);
    expect(b.chiefComplaint).toBe('x');
    expect(b.followUpDate).toBe('2026-10-07');
  });
  it('applyUsual adds only what is missing, and undo removes exactly that', () => {
    const s = { ...BASE, lines: [LINE] };
    const r = applyUsual(s, { rx: [dto('d-clav'), dto('d-mont', [0, 0, 1])], tests: [{ testId: 't1', name: 'AEC' }] }, [CLAV]);
    expect(r.next.lines.map(l => l.drug.id)).toEqual(['d-clav', 'd-mont']);
    expect(r.next.tests.map(t => t.testId)).toEqual(['t1']);
    const u = undoUsual(r.next, r.addedKeys, r.addedTests);
    expect(u.lines.map(l => l.drug.id)).toEqual(['d-clav']);
    expect(u.tests).toEqual([]);
  });
  it('usualsFrom takes the first set that mentions a drug', () => {
    const u = usualsFrom([dto('a', [0, 0, 1])], [dto('a', [1, 1, 1]), dto('b')]);
    expect(u['a'].sched).toEqual(timesSched([0, 0, 1]));
    expect(u['b'].sched).toEqual(timesSched([1, 0, 1]));
  });
  it('dates', () => {
    expect(daysBetween('2026-09-30', '2026-10-07')).toBe(7);
    expect(addDaysIso(new Date(2026, 8, 30), 14)).toBe('2026-10-14');
  });
});

describe('Complete consult sheet', () => {
  it('follow-up fee rule text', () => {
    expect(followUpFeeText(null, null)).toBe('No follow-up booked.');
    expect(followUpFeeText(7, { withinDays: 10, fee: 0 })).toContain('free');
    expect(followUpFeeText(7, { withinDays: 10, fee: 200 })).toContain('₹200');
    expect(followUpFeeText(14, { withinDays: 10, fee: 200 })).toContain('Outside');
  });

  function sheet(unresolved: number) {
    TestBed.configureTestingModule({ imports: [ConsultCompleteSheetComponent] });
    const f = TestBed.createComponent(ConsultCompleteSheetComponent);
    f.componentRef.setInput('patientName', 'Kavitha Ramesh');
    f.componentRef.setInput('token', 3);
    f.componentRef.setInput('diagnoses', [{ label: 'Acute rhinosinusitis' }]);
    f.componentRef.setInput('lines', [LINE]);
    f.componentRef.setInput('tests', [{ testId: 't1', name: 'AEC (eosinophils)', price: 150 }, { testId: 't2', name: 'Total IgE', price: 900 }]);
    f.componentRef.setInput('followUpDays', 7);
    f.componentRef.setInput('followUpRule', { withinDays: 10, fee: 0 });
    f.componentRef.setInput('unresolved', unresolved);
    f.detectChanges();
    return f;
  }
  it('summarises the outputs and sends on confirm', () => {
    const f = sheet(0);
    const el: HTMLElement = f.nativeElement;
    expect(el.textContent).toContain('Acute rhinosinusitis');
    expect(el.textContent).toContain('Clavumox 625');
    expect(el.textContent).toContain('1 tab · 1-0-1 · 5 days · after food');
    expect(el.textContent).toContain('₹1050');
    expect(el.textContent).toContain('not built yet');
    let sent = 0; f.componentInstance.confirm.subscribe(() => sent++);
    const btn = [...el.querySelectorAll('button')].find(b => b.textContent!.includes('Complete & send')) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(sent).toBe(1);
  });
  it('an unresolved allergy blocks sending and says why', () => {
    const f = sheet(1);
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.cs__warn')!.textContent).toContain('conflicts with a recorded allergy');
    const btn = [...el.querySelectorAll('button')].find(b => b.textContent!.includes('Complete & send')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
  it('follow-up quick picks emit their days', () => {
    const f = sheet(0);
    const got: (number | null)[] = [];
    f.componentInstance.followUpDaysChange.subscribe(d => got.push(d));
    const picks = [...(f.nativeElement as HTMLElement).querySelectorAll('.cs__pick')] as HTMLButtonElement[];
    expect(picks.map(p => p.textContent!.trim())).toEqual(['5 days', '1 week', '2 weeks', 'None']);
    picks[2].click(); picks[3].click();
    expect(got).toEqual([14, null]);
  });
});

describe('Vitals strip rules', () => {
  it('flags out-of-band values and computes BMI', () => {
    const v = { visitId: 'v', pulse: 84, bpSys: 128, bpDia: 82, tempF: 99.1, spo2: 98, respRate: 16, weightKg: 68, heightCm: 161 };
    expect(vitalFlag('temp', v)).toBe('high');
    expect(vitalFlag('pulse', v)).toBeNull();
    expect(vitalFlag('spo2', { ...v, spo2: 91 })).toBe('low');
    expect(vitalFlag('bp', { ...v, bpSys: 150 })).toBe('high');
    expect(bmiOf(v)).toBe(26.2);
    expect(vitalFlag('bmi', v)).toBe('high');
  });
});

describe('My patients queue', () => {
  const row = (token: number, status: ConsultQueueRow['status']): ConsultQueueRow => ({
    visitId: 'v' + token, patientId: 'p', patientName: 'P' + token, token, status, isFollowUp: false, hasVitals: true, allergyCount: 0, doctorUserId: 'd',
  });
  it('buckets statuses and calls the lowest waiting token next', () => {
    expect([tabOf('booked'), tabOf('vitals'), tabOf('waiting'), tabOf('in_consult'), tabOf('completed'), tabOf('cancelled')])
      .toEqual(['waiting', 'waiting', 'waiting', 'in_consult', 'completed', null]);
    expect(nextToCall([row(5, 'waiting'), row(2, 'booked'), row(3, 'waiting'), row(1, 'completed')])?.token).toBe(3);
    expect(nextToCall([row(2, 'booked')])?.token).toBe(2);
    expect(nextToCall([row(1, 'completed')])).toBeNull();
  });
});

describe('Form renderer + media + glance + print helpers', () => {
  it('the consult renders through A\'s renderer: a v1 form still normalises to questions', () => {
    const doc = normalizeSchema({ sections: [{ key: 's', title: 'ENT', fields: [{ key: 'a', label: 'A', type: 'text' }] }] });
    expect(allQuestions(doc).map(q => q.key)).toEqual(['a']);
  });
  it('the consult drops form questions it owns (chief complaint) so nothing is asked twice', () => {
    const doc = withoutConsultOwned({ schemaVersion: 2, sections: [{ key: 'f', title: 'F', fields: [
      { key: 'chief_complaints', label: 'Chief complaints', type: 'short' }, { key: 'duration', label: 'Duration', type: 'num' }] }] });
    expect(allQuestions(doc).map(q => q.key)).toEqual(['duration']);
  });
  it('addMedia appends a stored file to the answer, per side for a left & right question', () => {
    const ref = mediaRefOf({ id: 'tenants/t/opd/consult/v/f.jpg', name: 'ear.jpg', kind: 'image', contentType: 'image/jpeg', size: 10, url: 'https://x' });
    const a1 = addMedia({}, { key: 'otoscopy' }, ref);
    expect(a1['otoscopy']).toEqual([{ id: 'tenants/t/opd/consult/v/f.jpg', name: 'ear.jpg', kind: 'image', url: 'https://x' }]);
    const a2 = addMedia(a1, { key: 'otoscopy' }, { ...ref, name: 'ear2.jpg' });
    expect((a2['otoscopy'] as unknown[]).length).toBe(2);
    const s1 = addMedia({ tm: { l: [ref] } }, { key: 'tm', side: 'r' }, ref);
    expect(s1['tm']).toEqual({ l: [ref], r: [ref] });
  });
  it('recent results = latest point per parameter, newest first', () => {
    const r = recentResultsOf({ tests: [
      { testName: 'CBC', parameters: [{ name: 'Hb', unit: 'g/dL', points: [{ date: '2026-08-01', value: 10.2, flag: 'L' }, { date: '2026-09-12', value: 11.4, flag: 'N' }] }] },
      { testName: 'Lipid', parameters: [{ name: 'LDL', unit: 'mg/dL', points: [{ date: '2026-06-01', value: 150, flag: 'H' }] }] },
    ] });
    expect(r.map(x => `${x.param}=${x.value}`)).toEqual(['Hb=11.4', 'LDL=150']);
  });
  it('the printout rows carry the shorthand + the patient sentence + quantity, never private notes', () => {
    const rows = rxPrintRows([LINE], new Date(2026, 8, 30));
    expect(rows[0][2]).toContain('1 tab · 1-0-1 · 5 days · after food');
    expect(rows[0][2]).toContain('Take 1 tablet in the morning and at night, after food, for 5 days.');
    expect(rows[0][3]).toBe('10 tablets');
  });
});
