import { SCHED_DEFAULTS, timesSched } from '../../shared/rx-schedule';
import type { ConsultDrugRef, ConsultRxLine } from './rx-model';
import {
  ONGOING_NOTE, RX_DAYS_OPTIONS, RX_FOOD_OPTIONS, RX_PATTERN_OPTIONS, applyDays, applyFood, applyPattern, daysLabel, defaultUsual, doseDots,
  foodLabel, formName, isOngoing, needsDoseToken, patternId, patternLabel, rxSentence, usualFromJson,
} from './rx-line';
import { rxPrintDots, rxPrintRows } from '../rx-print';

const PARA: ConsultDrugRef = { id: 'd-pcm', name: 'Paracetamol', strength: '650 mg', form: 'tab' };
const AMOX: ConsultDrugRef = { id: 'd-amox', name: 'Amoxicillin', strength: '500 mg', form: 'cap' };
const SYR: ConsultDrugRef = { id: 'd-syr', name: 'Ambrolite', form: 'syrup', unit: 'bottle' };
const DROPS: ConsultDrugRef = { id: 'd-eye', name: 'Moxicip', form: 'drops', siteKind: 'eye' };
const START = new Date(2026, 9, 3);
const L = (drug: ConsultDrugRef, pat: number[], dur = 5, food: 'After' | 'Before' | 'With' | undefined = 'After', dose = 1): ConsultRxLine =>
  ({ key: 'k', drug, line: { drugId: drug.id, dose, sched: timesSched(pat), dur, ...(food ? { food } : {}) } });

describe('Rx token option sets (consult v6, owner-approved)', () => {
  it('pattern · days · food rows', () => {
    expect(RX_PATTERN_OPTIONS.map(o => o.label)).toEqual(['1-0-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', '0-1-0', '½-0-½', 'SOS', 'More…']);
    expect(RX_DAYS_OPTIONS.map(o => o.id)).toEqual(['1', '3', '5', '7', '10', '15', '30', 'ongoing']);
    expect(RX_FOOD_OPTIONS.map(o => o.label)).toEqual(['After food', 'Before food', 'With food', 'Any time']);
  });

  it('token labels and the selected option', () => {
    const l = L(PARA, [1, 0, 1]);
    expect([patternLabel(l.line), daysLabel(l), foodLabel(l.line)]).toEqual(['1-0-1', '5 days', 'After food']);
    expect(patternId(l.line)).toBe('1-0-1');
    expect(patternLabel({ sched: timesSched([0.5, 0, 0.5]) })).toBe('½-0-½');
    expect(patternId({ sched: timesSched([0.5, 0, 0.5]) })).toBe('½-0-½');
    expect(patternLabel({ sched: SCHED_DEFAULTS.sos })).toBe('SOS');
    expect(patternLabel({ sched: { type: 'hours', every: 8, awake: false } })).toBe('Every 8 h');
    expect(patternId({ sched: { type: 'hours', every: 8, awake: false } })).toBeNull();
    expect(foodLabel({})).toBe('Any time');
    expect(daysLabel({ ...l, line: { ...l.line, dur: 1 } })).toBe('1 day');
  });

  it('applying a pick never mutates, keeps the dose and the days', () => {
    const l = L(PARA, [1, 0, 1], 7, 'After', 2);
    const p = applyPattern(l.line, '1-1-1');
    expect(p).toMatchObject({ dose: 2, dur: 7, sched: timesSched([1, 1, 1]) });
    expect(l.line.sched).toEqual(timesSched([1, 0, 1]));
    expect(applyPattern(l.line, '½-0-½').sched).toEqual(timesSched([0.5, 0, 0.5]));
    expect(applyPattern(l.line, 'sos').sched).toEqual(SCHED_DEFAULTS.sos);
    expect(applyPattern(l.line, 'more')).toBe(l.line);
    // a taper becomes a plain 5-day course
    const taper = { ...l.line, dur: 0, sched: SCHED_DEFAULTS.steps };
    expect(applyPattern(taper, '1-0-1')).toMatchObject({ dur: 5, sched: timesSched([1, 0, 1]) });
    expect(applyFood(l.line, 'With').food).toBe('With');
    expect('food' in applyFood(l.line, '')).toBe(false);
  });

  it('Ongoing = 30 days dispensed + the ongoing note; a number clears it', () => {
    const on = applyDays(L(PARA, [1, 0, 1]), 'ongoing');
    expect(on.line.dur).toBe(30);
    expect(on.notes).toBe(ONGOING_NOTE);
    expect(isOngoing(on)).toBe(true);
    expect(daysLabel(on)).toBe('Ongoing');
    const back = applyDays(on, '10');
    expect(back.line.dur).toBe(10);
    expect(back.notes).toBeNull();
  });
});

describe('rxSentence — the plain sentence + the total', () => {
  it('same amount at each time', () => {
    expect(rxSentence(L(PARA, [1, 0, 1]), START)).toEqual({ text: 'Take 1 tablet in the morning and at night, after food, for 5 days', qty: '10 tablets' });
    expect(rxSentence(L(PARA, [1, 1, 1], 3), START).text).toBe('Take 1 tablet in the morning, in the afternoon and at night, after food, for 3 days');
    expect(rxSentence(L(AMOX, [1, 1, 1, 1], 5, 'Before'), START).text)
      .toBe('Take 1 capsule in the morning, in the afternoon, in the evening and at night, before food, for 5 days');
  });

  it('different amounts per time, halves and doses', () => {
    expect(rxSentence(L(PARA, [1, 0, 0.5]), START).text).toBe('Take 1 tablet in the morning and ½ tablet at night, after food, for 5 days');
    expect(rxSentence(L(PARA, [0.5, 0, 0.5]), START)).toEqual({ text: 'Take ½ tablet in the morning and at night, after food, for 5 days', qty: '5 tablets' });
    expect(rxSentence(L(PARA, [1, 0, 1], 5, 'After', 2), START)).toEqual({ text: 'Take 2 tablets in the morning and at night, after food, for 5 days', qty: '20 tablets' });
    expect(rxSentence(L(PARA, [0, 0, 1], 1, 'With'), START).text).toBe('Take 1 tablet at night, with food, for 1 day');
    expect(rxSentence({ drug: PARA, line: { drugId: PARA.id, dose: 1, sched: timesSched([1, 0, 0]), dur: 5 } }, START).text).toBe('Take 1 tablet in the morning, for 5 days');
  });

  it('SOS: only when needed, "up to" the most the pharmacy gives', () => {
    const l: ConsultRxLine = { key: 'k', drug: PARA, line: { drugId: PARA.id, dose: 1, sched: SCHED_DEFAULTS.sos, dur: 3, food: 'After' } };
    const s = rxSentence(l, START);
    expect(s.text).toBe('Take 1 tablet only when needed — at most 3 a day, at least 6 hours apart, after food, for 3 days');
    expect(s.qty).toBe('up to 9 tablets');
  });

  it('ongoing, packs and sites', () => {
    const on = applyDays(L(PARA, [1, 0, 1]), 'ongoing');
    expect(rxSentence(on, START)).toEqual({ text: 'Take 1 tablet in the morning and at night, after food, continue until your next visit', qty: '60 tablets (30 days)' });
    expect(rxSentence(L(SYR, [1, 1, 1], 5, 'After', 5), START)).toEqual({ text: 'Take 5 ml in the morning, in the afternoon and at night, after food, for 5 days', qty: '1 bottle' });
    const eye: ConsultRxLine = { key: 'k', drug: DROPS, line: { drugId: DROPS.id, dose: 2, site: 'Both eyes', sched: timesSched([1, 1, 1]), dur: 7 } };
    expect(rxSentence(eye, START).text).toBe('Put 2 drops in both eyes in the morning, in the afternoon and at night, for 7 days');
  });

  it('an advanced schedule reads through the shared model', () => {
    const l: ConsultRxLine = { key: 'k', drug: PARA, line: { drugId: PARA.id, dose: 1, sched: { type: 'hours', every: 8, awake: false }, dur: 3, food: 'After' } };
    expect(rxSentence(l, START).text).toBe('Take 1 tablet every 8 hours, round the clock, after food, for 3 days');
  });
});

describe('Dose dots, usual dose, form words', () => {
  it('M / A / E / N amounts for a clock schedule; null otherwise', () => {
    expect(doseDots({ sched: timesSched([1, 0, 1]), dose: 1 })).toEqual([1, 0, 0, 1]);
    expect(doseDots({ sched: timesSched([1, 1, 1, 1]), dose: 2 })).toEqual([2, 2, 2, 2]);
    expect(doseDots({ sched: timesSched([0.5, 0, 0.5]), dose: 1 })).toEqual([0.5, 0, 0, 0.5]);
    expect(doseDots({ sched: SCHED_DEFAULTS.sos, dose: 1 })).toBeNull();
    const rows = rxPrintRows([L(PARA, [1, 0, 1])], START);
    expect(rows[0][2]).toContain('Take 1 tablet in the morning and at night, after food, for 5 days.');
    expect(rxPrintDots([L(PARA, [1, 0, 1]), { ...L(PARA, [1, 0, 1]), line: { ...L(PARA, [1, 0, 1]).line, sched: SCHED_DEFAULTS.sos } }]))
      .toEqual([{ dots: [1, 0, 0, 1], text: '' }, { dots: null, text: 'SOS · max 3/day' }]);
  });

  it('the usual: the master UsualJson, else 1-0-1 · 5 days · after food', () => {
    expect(usualFromJson({ dose: 1, schedule: { type: 'times', pat: [1, 1, 1] }, durationDays: 3, food: 'After' }))
      .toEqual({ dose: 1, sched: timesSched([1, 1, 1]), dur: 3, food: 'After' });
    expect(usualFromJson(null)).toBeNull();
    expect(usualFromJson({ dose: 1 })).toBeNull();
    expect(defaultUsual(PARA)).toEqual({ dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' });
    expect(defaultUsual(DROPS)).toEqual({ dose: 1, sched: timesSched([1, 0, 1]), dur: 5 });
    expect(defaultUsual(SYR).dose).toBe(5);
  });

  it('form words and when a dose token shows', () => {
    expect([formName(PARA), formName(AMOX), formName(SYR), formName(DROPS)]).toEqual(['Tablet', 'Capsule', 'Syrup', 'Eye drops']);
    expect(needsDoseToken(L(PARA, [1, 0, 1]))).toBe(false);
    expect(needsDoseToken(L(PARA, [1, 0, 1], 5, 'After', 2))).toBe(true);
    expect(needsDoseToken(L(SYR, [1, 0, 1], 5, 'After', 5))).toBe(true);
  });
});
