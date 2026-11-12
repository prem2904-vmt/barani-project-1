import { CombinationDef, FieldDef } from '../core/types';
import {
  combinationProblems,
  combinationText,
  combinationsOf,
  matchCombination,
  pickedKeys,
  narratePicks,
  picksWords,
  previewPicks,
  supportsCombinations,
} from './combinations';

const opts = [
  { key: 'rh', label: 'Right hand', says: 'the right hand', subFields: [] },
  { key: 'lh', label: 'Left hand', says: 'the left hand', subFields: [] },
  { key: 'll', label: 'Left leg', subFields: [] },
  { key: 'rl', label: 'Right leg', says: 'the right leg', subFields: [] },
];
const exact: CombinationDef = { id: 'c1', options: ['rh', 'lh'], match: 'exact', text: 'Both upper limbs are involved' };
const inc: CombinationDef = { id: 'c2', options: ['rh', 'lh'], match: 'includes', text: 'Both upper limbs are involved, along with {others}' };
const incPlain: CombinationDef = { id: 'c3', options: ['rh', 'lh'], match: 'includes', text: 'Both upper limbs are involved' };
const field = (rules: CombinationDef[]): FieldDef => ({ key: 'limbs', kind: 'pictureChoice', label: 'Limbs', options: opts, says: { include: true, combinations: rules } });

describe('combination sentences (shared by every multi-select kind)', () => {
  it('which kinds carry them: multi and pictureChoice with more than one pick, nothing else', () => {
    expect(supportsCombinations({ kind: 'multi' })).toBe(true);
    expect(supportsCombinations({ kind: 'pictureChoice' })).toBe(true);
    expect(supportsCombinations({ kind: 'pictureChoice', config: { multiple: false } })).toBe(false);
    for (const k of ['choice', 'yesno', 'bodyMap', 'grid', 'text', 'repeat']) expect(supportsCombinations({ kind: k }), k).toBe(false);
    expect(supportsCombinations(null)).toBe(false);
  });

  it('exact fires only on the same set; includes fires when every one is picked', () => {
    expect(matchCombination([exact], ['rh', 'lh'])?.id).toBe('c1');
    expect(matchCombination([exact], ['lh', 'rh'])?.id).toBe('c1'); // order of picks never matters
    expect(matchCombination([exact], ['rh', 'lh', 'll'])).toBeNull();
    expect(matchCombination([exact], ['rh'])).toBeNull();
    expect(matchCombination([inc], ['rh', 'lh', 'll'])?.id).toBe('c2');
    expect(matchCombination([inc], ['rh', 'lh'])?.id).toBe('c2');
    expect(matchCombination([inc], ['rh', 'll'])).toBeNull();
  });

  it('keys match in any case; a rule with no options never fires', () => {
    expect(matchCombination([{ ...exact, options: ['RH', 'Lh'] }], ['rh', 'lh'])?.id).toBe('c1');
    expect(matchCombination([{ ...exact, options: [] }], [])).toBeNull();
  });

  it('first match wins: the author orders them', () => {
    expect(matchCombination([exact, inc], ['rh', 'lh'])?.id).toBe('c1');
    expect(matchCombination([inc, exact], ['rh', 'lh'])?.id).toBe('c2');
    expect(matchCombination([exact, inc], ['rh', 'lh', 'rl'])?.id).toBe('c2');
  });

  const words = (rules: CombinationDef[], picked: string[]) => picksWords(field(rules), picked).words;

  it('exact rule: the rule text replaces the matched picks', () => {
    expect(words([exact], ['rh', 'lh'])).toBe('Both upper limbs are involved');
  });

  it('includes with {others}: the other picks say their own words there, in the order picked', () => {
    expect(words([inc], ['rh', 'lh', 'll', 'rl'])).toBe('Both upper limbs are involved, along with Left leg and the right leg');
    expect(words([inc], ['rh', 'rl', 'lh', 'll'])).toBe('Both upper limbs are involved, along with the right leg and Left leg');
  });

  it('includes with {others} and no extras: the placeholder and the clause before it go', () => {
    expect(words([inc], ['rh', 'lh'])).toBe('Both upper limbs are involved');
    expect(combinationText({ text: 'Both hands; together with {others}' }, [])).toBe('Both hands');
    expect(combinationText({ text: 'Both hands, along with {others}, on examination' }, [])).toBe('Both hands, on examination');
    expect(combinationText({ text: 'A {others} B {others}' }, ['x'])).toBe('A x B x');
  });

  it('includes without a placeholder: the extras follow the sentence like any list', () => {
    expect(words([incPlain], ['rh', 'lh', 'rl'])).toBe('Both upper limbs are involved and the right leg');
    expect(words([incPlain], ['rh', 'lh', 'll', 'rl'])).toBe('Both upper limbs are involved, Left leg and the right leg');
    expect(words([incPlain], ['rh', 'lh'])).toBe('Both upper limbs are involved');
  });

  it('no match: each pick says its own words (today); picks are the answer\'s order', () => {
    expect(picksWords(field([exact]), ['rh']).fires).toBeNull();
    expect(previewPicks(field([exact]), ['rh', 'll'])).toBe('the right hand and Left leg');
    expect(previewPicks({ options: opts }, ['rh'])).toBe('the right hand');
  });

  it('prefix, suffix, total and "Denies" wrap the sentence in that order', () => {
    const f: FieldDef = {
      ...field([exact]),
      config: { total: { label: 'Score', unit: 'pts' } },
      says: { include: true, prefix: 'Involves', suffix: 'today', combinations: [exact], negativeHistory: { enabled: true, prefix: 'Denies' } },
      options: opts.map((o, i) => ({ ...o, value: i + 1 })),
    };
    expect(narratePicks(f, ['rh', 'lh'])).toBe('Involves Both upper limbs are involved today. Score 3 pts. Denies Left leg and the right leg.');
    expect(narratePicks(f, [])).toBe('');
  });

  it('a question with no combinations is untouched (absent, empty or malformed)', () => {
    expect(combinationsOf({})).toEqual([]);
    expect(combinationsOf({ says: { include: true, combinations: [] } })).toEqual([]);
    expect(combinationsOf({ says: { include: true, combinations: [{ id: 'x', options: [], match: 'exact', text: '' }] } })).toEqual([]);
    expect(previewPicks({ options: opts, says: { include: true } }, ['rh', 'lh'])).toBe('the right hand and the left hand');
  });

  it('picked keys: once each, in the order picked, in the option\'s own spelling', () => {
    expect(pickedKeys({ options: opts }, ['LL', 'rh', 'RH'])).toEqual(['ll', 'rh']);
    expect(pickedKeys({ options: opts }, 'lh')).toEqual(['lh']);
    expect(pickedKeys({ options: opts }, null)).toEqual([]);
  });

  describe('warnings (never a block), in plain words', () => {
    it('a clean set has none', () => {
      expect(combinationProblems(field([exact, inc]))).toEqual([]);
    });
    it('no choice, an unknown choice', () => {
      const p = combinationProblems(field([{ id: 'a', options: [], match: 'exact', text: 'x' }, { id: 'b', options: ['rh', 'zz'], match: 'exact', text: 'y' }]));
      expect(p.map((x) => x.index)).toEqual([0, 1]);
      expect(p[0].text).toContain('at least one');
      expect(p[1].text).toContain('zz');
    });
    it('the same choices and match twice', () => {
      const p = combinationProblems(field([exact, { ...exact, id: 'dup', options: ['lh', 'rh'] }]));
      expect(p).toHaveLength(1);
      expect(p[0].index).toBe(1);
      expect(p[0].text).toContain('sentence 1');
    });
    it('an exact rule below an includes rule that always fires first', () => {
      const p = combinationProblems(field([inc, exact]));
      expect(p).toHaveLength(1);
      expect(p[0].index).toBe(1);
      expect(p[0].text).toContain('always fires first');
      // the other way round is the normal, useful order
      expect(combinationProblems(field([exact, inc]))).toEqual([]);
    });
  });
});
