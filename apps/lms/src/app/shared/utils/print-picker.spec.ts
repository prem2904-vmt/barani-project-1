import { describe, expect, it } from 'vitest';
import { criticalNames, effectiveHidden, hasEnteredValue, printPickerDefaultOf, printPickerFlag, resolvePrintPicker, resolvePrintPickerDefault } from './print-picker';

const ON = JSON.stringify({ printPicker: true, parameters: [] });
const OFF = JSON.stringify({ parameters: [] });

describe('print picker — follows what was ordered', () => {
  it('reads only a real boolean on the wrapper', () => {
    expect(printPickerFlag(ON)).toBe(true);
    expect(printPickerFlag(OFF)).toBe(false);
    expect(printPickerFlag('{"printPicker":"true"}')).toBe(false);
    expect(printPickerFlag('not json')).toBe(false);
    expect(printPickerFlag(null)).toBe(false);
  });

  it('the server-resolved value wins over the member test (profile OFF beats member ON)', () => {
    expect(resolvePrintPicker({ printPicker: false, test: { parameters: ON } })).toBe(false);
  });

  it('profile ON beats member OFF', () => {
    expect(resolvePrintPicker({ printPicker: true, test: { parameters: OFF } })).toBe(true);
  });

  it('an unannotated line (older server) keeps the test\'s own setting', () => {
    expect(resolvePrintPicker({ test: { parameters: ON } })).toBe(true);
    expect(resolvePrintPicker({ printPicker: null, test: { parameters: OFF } })).toBe(false);
    expect(resolvePrintPicker({})).toBe(false);
  });
});

describe('print picker "Start with" (all | none)', () => {
  const NONE = JSON.stringify({ printPicker: true, printPickerDefault: 'none', parameters: [] });

  it('reads printPickerDefault off the wrapper — absent / junk = all (backward compatible)', () => {
    expect(printPickerDefaultOf(NONE)).toBe('none');
    expect(printPickerDefaultOf(ON)).toBe('all');
    expect(printPickerDefaultOf('{"printPickerDefault":false}')).toBe('all');
    expect(printPickerDefaultOf('not json')).toBe('all');
    expect(printPickerDefaultOf(null)).toBe('all');
  });

  it('the server-stamped value wins (a profile overrides its member) — else the test\'s own', () => {
    expect(resolvePrintPickerDefault({ printPickerDefault: 'all', test: { parameters: NONE } })).toBe('all');
    expect(resolvePrintPickerDefault({ printPickerDefault: 'none', test: { parameters: ON } })).toBe('none');
    expect(resolvePrintPickerDefault({ test: { parameters: NONE } })).toBe('none');
    expect(resolvePrintPickerDefault({})).toBe('all');
  });

  it('none + never picked → every value hidden; a SAVED pick always wins (even [])', () => {
    const names = ['Hb', 'PCV'];
    expect(effectiveHidden(null, 'none', names)).toEqual(['Hb', 'PCV']);
    expect(effectiveHidden('', 'none', names)).toEqual(['Hb', 'PCV']);
    expect(effectiveHidden('[]', 'none', names)).toEqual([]);
    expect(effectiveHidden('["PCV"]', 'none', names)).toEqual(['PCV']);
    expect(effectiveHidden(null, 'all', names)).toEqual([]);
    expect(effectiveHidden('["Hb"]', 'all', names)).toEqual(['Hb']);
  });
});

describe('a CRITICAL value always prints (owner 2026-10-01)', () => {
  const snap = (flagged: Record<string, string>) =>
    JSON.stringify({ values: {}, flagged: Object.fromEntries(Object.entries(flagged).map(([k, f]) => [k, { flag: f }])) });

  it('criticalNames reads the flagged map, ignoring non-critical flags', () => {
    expect(criticalNames(snap({ Hb: 'CH', PCV: 'N' }))).toEqual(['Hb']);
    expect(criticalNames(snap({ K: 'C' }))).toEqual(['K']);     // legacy direction-less critical still counts
    expect(criticalNames(snap({ Hb: 'H', PCV: 'L' }))).toEqual([]);
  });

  it('criticalNames is empty for no/unusable snapshot', () => {
    expect(criticalNames(null)).toEqual([]);
    expect(criticalNames(undefined)).toEqual([]);
    expect(criticalNames('not json')).toEqual([]);
    expect(criticalNames(JSON.stringify({ values: { Hb: 12 } }))).toEqual([]);
  });

  // ── Critic P1-4: a whole-line critical with no per-parameter flag ───────
  it('falls back to every name when the OVERALL flags.critical is true and no parameter resolved critical', () => {
    const withOverall = (flagged: Record<string, string>, critical: boolean) =>
      JSON.stringify({ values: {}, flagged: Object.fromEntries(Object.entries(flagged).map(([k, f]) => [k, { flag: f }])), flags: { critical } });
    // The Conditions engine marked the whole result critical (e.g. a qualitative "Positive") — no CL/CH anywhere.
    expect(criticalNames(withOverall({ Result: 'A' }, true), ['Result'])).toEqual(['Result']);
    // No allNames supplied → nothing to fall back to.
    expect(criticalNames(withOverall({ Result: 'A' }, true))).toEqual([]);
    // flags.critical false → no fallback, normal behaviour.
    expect(criticalNames(withOverall({ Hb: 'N' }, false), ['Hb'])).toEqual([]);
    // A real per-parameter critical still wins over (and skips) the fallback.
    expect(criticalNames(withOverall({ Hb: 'CH', PCV: 'N' }, true), ['Hb', 'PCV'])).toEqual(['Hb']);
  });

  it('effectiveHidden hides nothing on a line whose overall critical flag has no per-parameter flag to pin it to', () => {
    const names = ['Result', 'Note'];
    const critical = criticalNames(
      JSON.stringify({ values: {}, flagged: { Result: { flag: 'A' }, Note: { flag: '' } }, flags: { critical: true } }),
      names,
    );
    expect(effectiveHidden(null, 'none', names, critical)).toEqual([]);
  });

  it('effectiveHidden never hides a critical name — a saved pick is overridden', () => {
    const names = ['Hb', 'PCV'];
    expect(effectiveHidden('["Hb","PCV"]', 'all', names, ['Hb'])).toEqual(['PCV']);
  });

  it('effectiveHidden never hides a critical name — "start with none", never picked', () => {
    const names = ['Hb', 'PCV'];
    expect(effectiveHidden(null, 'none', names, ['Hb'])).toEqual(['PCV']);
  });

  it('no critical names leaves effectiveHidden unchanged (default param, backward compatible)', () => {
    const names = ['Hb', 'PCV'];
    expect(effectiveHidden(null, 'none', names)).toEqual(names);
    expect(effectiveHidden(null, 'none', names, [])).toEqual(names);
  });
});

describe('hasEnteredValue (entering a value ticks its print box)', () => {
  it('numbers (0 too), text, a non-empty multi-select count', () => {
    for (const v of [0, 13, '5', 'Pale yellow', ['Pus cells'], [' ', 'RBC'], true]) expect(hasEnteredValue(v)).toBe(true);
  });
  it('null / undefined / blank / empty or blank-only multi-select / NaN do not', () => {
    for (const v of [null, undefined, '', '   ', [], ['', ' '], NaN]) expect(hasEnteredValue(v)).toBe(false);
  });
});
