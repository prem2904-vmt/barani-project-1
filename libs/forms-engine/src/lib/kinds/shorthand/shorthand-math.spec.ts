import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SHORTHAND_PRESETS,
  ShorthandValue,
  nearestQuarter,
  obstetricWarnings,
  presetOf,
  shorthandProblem,
  writeShorthand,
} from './shorthand-math';

interface Vector {
  name: string;
  preset: string;
  config?: { lmp?: boolean };
  value: ShorthandValue;
  text?: string;
  problem: boolean;
  warnings?: string[];
}

/** The same file the server's tests read (docs/vectors/casesheet-pair.json): both engines must give exactly these results. */
const vectors = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'docs/vectors/casesheet-pair.json'), 'utf8')) as { cases: Vector[] }
).cases;

describe('clinical shorthand: vectors shared with the server', () => {
  it('has cases for every preset', () => {
    expect([...new Set(vectors.map((v) => v.preset))].sort()).toEqual([...SHORTHAND_PRESETS].sort());
  });

  it.each(vectors.map((v) => [`${v.name} (${v.preset})`, v] as const))('%s', (_n, v) => {
    expect(shorthandProblem(v.preset, v.value) !== null).toBe(v.problem);
    if (v.text !== undefined) expect(writeShorthand(v.preset, v.value, v.config?.lmp ?? true)).toBe(v.text);
    if (v.warnings) expect(obstetricWarnings(v.value)).toEqual(v.warnings);
  });
});

describe('clinical shorthand: helpers', () => {
  it('typed refraction values land on quarters', () => {
    expect(nearestQuarter(1.1)).toBe(1);
    expect(nearestQuarter(-1.13)).toBe(-1.25);
    expect(nearestQuarter(0.37)).toBe(0.25);
    expect(nearestQuarter(-0.38)).toBe(-0.5);
  });

  it('the preset defaults to the obstetric score and ignores words it does not know', () => {
    expect(presetOf(undefined)).toBe('obstetricScore');
    expect(presetOf({ preset: 'refraction' })).toBe('refraction');
    expect(presetOf({ preset: 'tooth' })).toBe('obstetricScore');
  });
});
