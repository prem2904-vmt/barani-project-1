import {
  TYPE_AHEAD_RESET_MS, TypeAheadBuffer, highlightParts, matchLabel, rankMatches, typeAheadIndex,
} from './type-ahead';

const items = (...labels: string[]) => labels.map(label => ({ label }));
const QUAL = items('Positive', 'Negative', 'Nil', 'Preliminary', 'Pending');
const DIP = items('Nil', 'Trace', '1+', '2+', '3+', '1++');

describe('type-ahead matcher', () => {
  it('a single letter selects the first option starting with it', () => {
    expect(typeAheadIndex(QUAL, 'p', -1)).toBe(0); // Positive
    expect(typeAheadIndex(QUAL, 'n', -1)).toBe(1); // Negative
  });

  it('is case-insensitive', () => {
    expect(typeAheadIndex(QUAL, 'P', -1)).toBe(0);
    expect(typeAheadIndex(QUAL, 'PrE', -1)).toBe(3);
  });

  it('more letters narrow by whole-label prefix', () => {
    expect(typeAheadIndex(QUAL, 'po', -1)).toBe(0); // Positive
    expect(typeAheadIndex(QUAL, 'pr', -1)).toBe(3); // Preliminary
    expect(typeAheadIndex(QUAL, 'pe', -1)).toBe(4); // Pending
    expect(typeAheadIndex(QUAL, 'ni', -1)).toBe(2); // Nil
  });

  it('prefers a whole-label prefix over a word-start match', () => {
    const opts = items('Not detected', 'Detected');
    expect(typeAheadIndex(opts, 'det', -1)).toBe(1);
    // …but falls back to the word start when nothing starts with it.
    expect(typeAheadIndex(items('Not detected', 'Reactive'), 'det', -1)).toBe(0);
  });

  it('ignores leading spaces / punctuation on labels and leading spaces in the query', () => {
    expect(typeAheadIndex(items('(Nil)', '- Positive'), 'pos', -1)).toBe(1);
    expect(typeAheadIndex(items('(Nil)', '- Positive'), 'nil', -1)).toBe(0);
    expect(typeAheadIndex(items('  Reactive'), 'rea', -1)).toBe(0);
    expect(typeAheadIndex(QUAL, '  ne', -1)).toBe(1);
  });

  it('digits and symbols: "1+" is exact, never "1++"; "2" finds 2+', () => {
    expect(typeAheadIndex(DIP, '1+', -1)).toBe(2);
    expect(typeAheadIndex(DIP, '1++', -1)).toBe(5);
    expect(typeAheadIndex(DIP, '2', -1)).toBe(3);
    expect(typeAheadIndex(DIP, '3+', -1)).toBe(4);
  });

  it('a repeated symbol that IS an option matches as typed (dipstick ++ / +++)', () => {
    const plus = items('Negative', '+', '++', '+++');
    expect(typeAheadIndex(plus, '+', -1)).toBe(1);
    expect(typeAheadIndex(plus, '++', -1)).toBe(2);
    expect(typeAheadIndex(plus, '+++', -1)).toBe(3);
  });

  it('pressing the same letter repeatedly cycles through options starting with it', () => {
    const opts = items('Positive', 'Negative', 'Preliminary');
    let cur = typeAheadIndex(opts, 'p', -1);
    expect(cur).toBe(0);
    cur = typeAheadIndex(opts, 'pp', cur); // no "pp…" label → cycle
    expect(cur).toBe(2);
    cur = typeAheadIndex(opts, 'ppp', cur);
    expect(cur).toBe(0);
    // A fresh single press from a P option also steps on (native select feel).
    expect(typeAheadIndex(opts, 'p', 2)).toBe(0);
    expect(typeAheadIndex(opts, 'p', 1)).toBe(0); // current is not a P → first P
  });

  it('the cycle only walks options that START with the letter, not word-starts', () => {
    const opts = items('Positive', 'Not performed', 'Preliminary');
    expect(typeAheadIndex(opts, 'p', 0)).toBe(2);
    expect(typeAheadIndex(opts, 'p', 2)).toBe(0);
  });

  it('no match returns -1 (caller keeps the current value) and skips disabled options', () => {
    expect(typeAheadIndex(QUAL, 'x', 0)).toBe(-1);
    expect(typeAheadIndex(QUAL, '', 0)).toBe(-1);
    const opts = [{ label: 'Positive', disabled: true }, { label: 'Pending' }];
    expect(typeAheadIndex(opts, 'p', -1)).toBe(1);
  });

  it('rankMatches orders exact < prefix < punctuation-prefix < word-start', () => {
    const r = rankMatches(items('Not reactive', '(Reactive)', 'Reactive weakly', 'Re'), 're');
    expect(r.map(h => [h.index, h.rank])).toEqual([[3, 0], [2, 1], [1, 2], [0, 3]]);
  });

  it('matchLabel reports the matched offset in the original label', () => {
    expect(matchLabel('Not detected', 'det')).toEqual({ rank: 3, start: 4 });
    expect(matchLabel('(Nil)', 'nil')).toEqual({ rank: 2, start: 1 });
  });
});

describe('TypeAheadBuffer', () => {
  it('joins keys typed within the window and resets after a pause', () => {
    const b = new TypeAheadBuffer();
    expect(b.push('p', 1000)).toBe('p');
    expect(b.push('o', 1000 + TYPE_AHEAD_RESET_MS - 1)).toBe('po');
    expect(b.active(1000 + TYPE_AHEAD_RESET_MS)).toBe(true);
    // Pause longer than the window → a new query.
    expect(b.push('n', 1000 + 3 * TYPE_AHEAD_RESET_MS)).toBe('n');
  });

  it('reset() clears it; active() goes false after the window', () => {
    const b = new TypeAheadBuffer(800);
    b.push('a', 0);
    expect(b.current(500)).toBe('a');
    expect(b.current(900)).toBe('');
    b.push('b', 1000);
    b.reset();
    expect(b.active(1000)).toBe(false);
  });
});

describe('highlightParts', () => {
  it('splits a label around the typed run', () => {
    expect(highlightParts('Positive', 'po')).toEqual(['', 'Po', 'sitive']);
    expect(highlightParts('Not detected', 'det')).toEqual(['Not ', 'det', 'ected']);
    expect(highlightParts('(Nil)', 'ni')).toEqual(['(', 'Ni', 'l)']);
    // Search-box text that only matches mid-word still highlights.
    expect(highlightParts('Haemoglobin', 'glob')).toEqual(['Haemo', 'glob', 'in']);
    expect(highlightParts('Positive', 'zz')).toEqual(['Positive', '', '']);
    expect(highlightParts('Positive', '')).toEqual(['Positive', '', '']);
  });
});
