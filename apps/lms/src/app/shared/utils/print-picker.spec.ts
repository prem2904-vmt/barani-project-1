import { describe, expect, it } from 'vitest';
import { printPickerFlag, resolvePrintPicker } from './print-picker';

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
