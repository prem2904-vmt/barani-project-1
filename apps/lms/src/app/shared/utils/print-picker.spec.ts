import { describe, expect, it } from 'vitest';
import { effectiveHidden, printPickerDefaultOf, printPickerFlag, resolvePrintPicker, resolvePrintPickerDefault } from './print-picker';

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
