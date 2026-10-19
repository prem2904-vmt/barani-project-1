import { timesSched } from '../shared/rx-schedule';
import {
  PAD_ROWS, adviceLines, entryAction, padCollapseKey, padSuggest, parseCollapsed, toggleRow, usualDoseFor, wordStartMatch,
} from './pad';
import { defaultUsual } from './rx/rx-line';

describe('Prescription pad — word-start matching', () => {
  it('"amo" matches Amoxicillin, never Paracetamol; every typed word must start a word', () => {
    expect(wordStartMatch('Amoxicillin 500 mg', 'amo')).toBe(true);
    expect(wordStartMatch('Paracetamol 650 mg', 'amo')).toBe(false);
    expect(wordStartMatch('Amoxicillin + Clavulanate 625', 'clav')).toBe(true);
    expect(wordStartMatch('Upper GI endoscopy', 'endo')).toBe(true);
    expect(wordStartMatch('Upper GI endoscopy', 'upper endo')).toBe(true);
    expect(wordStartMatch('Upper GI endoscopy', 'scopy')).toBe(false);
    expect(wordStartMatch('anything', '  ')).toBe(false);
  });

  it('suggestions leave out what is already on the row and rank a label that starts with the query first', () => {
    const opts = [{ id: 'p', label: 'Paracetamol' }, { id: 'c', label: 'Co-amoxiclav' }, { id: 'a', label: 'Amoxicillin' }, { id: 'z', label: 'Azithromycin' }];
    expect(padSuggest(opts, 'amo').map(o => o.id)).toEqual(['a', 'c']);
    expect(padSuggest(opts, 'amo', new Set(['a'])).map(o => o.id)).toEqual(['c']);
    expect(padSuggest(opts, '')).toEqual([]);
  });
});

describe('Prescription pad — what a key does (routing)', () => {
  const base = { hasPick: true, parsed: false, text: 'amo', allowFree: false, composer: true };
  it('Enter adds the suggestion with its usual dose in one step', () => {
    expect(entryAction('Enter', base)).toBe('add');
  });
  it('Tab (Rx) opens the dose composer first; elsewhere Tab does nothing', () => {
    expect(entryAction('Tab', base)).toBe('compose');
    expect(entryAction('Tab', { ...base, composer: false })).toBe('none');
    expect(entryAction('Tab', { ...base, hasPick: false })).toBe('none');
  });
  it('shorthand adds as typed; free text only where the row allows it', () => {
    expect(entryAction('Enter', { ...base, parsed: true })).toBe('add-parsed');
    expect(entryAction('Enter', { ...base, hasPick: false, allowFree: true, text: 'Viral fever' })).toBe('free');
    expect(entryAction('Enter', { ...base, hasPick: false, allowFree: false })).toBe('none');
    expect(entryAction('Enter', { ...base, hasPick: false, allowFree: true, text: '  ' })).toBe('none');
  });
});

describe('Prescription pad — the usual dose', () => {
  const last = { a: { dose: 1, sched: timesSched([1, 1, 1]), dur: 3, food: 'After' as const } };
  const json = { a: { dose: 1, sched: timesSched([1, 0, 1]), dur: 5 }, b: { dose: 2, sched: timesSched([0, 0, 1]), dur: 10 } };
  const fallback = defaultUsual({ form: 'tab' });
  it('the doctor\'s last line, else the master UsualJson, else 1-0-1 · 5 days · after food', () => {
    expect(usualDoseFor('a', last, json, fallback)).toBe(last.a);
    expect(usualDoseFor('b', last, json, fallback)).toBe(json.b);
    expect(usualDoseFor('c', last, json, fallback)).toEqual({ dose: 1, sched: timesSched([1, 0, 1]), dur: 5, food: 'After' });
  });
});

describe('Prescription pad — folded rows', () => {
  it('rows are in printed order', () => {
    expect(PAD_ROWS.map(r => r.abbr || r.label)).toEqual(['C/O', 'Dx', 'Rx', 'Procedures', 'Ix', 'Adv', 'F/U', 'Private note']);
  });
  it('a tap folds / unfolds without mutating; the state round-trips per user', () => {
    const a = new Set<'dx'>();
    const b = toggleRow(a, 'dx');
    expect([...b]).toEqual(['dx']);
    expect(a.size).toBe(0);
    expect([...toggleRow(b, 'dx')]).toEqual([]);
    expect(padCollapseKey('u1')).toBe('pf.opd.padCollapsed.u1');
    expect([...parseCollapsed(JSON.stringify(['dx', 'adv', 'nope']))]).toEqual(['dx', 'adv']);
    expect(parseCollapsed('not json').size).toBe(0);
    expect(parseCollapsed(null).size).toBe(0);
  });
  it('advice is one chip per line', () => {
    expect(adviceLines('Rest\n\n  Drink fluids \n')).toEqual(['Rest', 'Drink fluids']);
  });
});
