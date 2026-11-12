import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vectors from '../testing/casesheet-family.vectors.json';
import { ageWords, parseAge } from '../kinds/ageChecklist/age-text';
import { resolveItems, stateOf } from '../kinds/ageChecklist/checklist-data';
import { FamilyAnswer, buildLayout } from '../kinds/familyTree/family-layout';
import { isValidTooth, lowerRow, surfaceWord, toothName, upperRow, SURFACES } from '../kinds/toothChart/teeth';

/**
 * Group "family" parity with the server (prefrontal-mw `FamilyKindsTests.FamilyVectors_Are_Current`): the same reference data, the same age
 * reading and wording, the same line table and states, the same pedigree layout and the same tooth numbering. The vectors file is written by
 * the server; this spec only reads it.
 */
const ROOT = process.cwd();
const sha = (file: string) =>
  createHash('sha256')
    .update(readFileSync(resolve(ROOT, 'libs/forms-engine/src/lib/kinds/ageChecklist/data', file), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');

describe('family kinds match the server (shared vectors casesheet-family.json)', () => {
  it('the reference data files are byte-for-byte the server ones (SHA-256)', () => {
    expect(sha('milestones.json')).toBe(vectors.dataSha256['milestones.json']);
    expect(sha('vaccines-uip.json')).toBe(vectors.dataSha256['vaccines-uip.json']);
  });

  describe('age reading', () => {
    for (const c of vectors.ageParse as { text: string; asOf?: string; days: number | null }[])
      it(`reads "${c.text}"${c.asOf ? ' on ' + c.asOf : ''} as ${c.days} days`, () => {
        expect(parseAge(c.text, c.asOf ?? null)).toBe(c.days ?? null);
      });
    for (const c of vectors.ageWords)
      it(`${c.days} days is written "${c.words}"`, () => {
        expect(ageWords(c.days)).toBe(c.words);
      });
  });

  describe('checklist lines', () => {
    for (const preset of ['milestones', 'vaccines'] as const)
      it(`the ${preset} table (keys, labels, groups, ages in days)`, () => {
        const mine = resolveItems({ preset }).map((i) => ({ key: i.key, label: i.label, group: i.group, fromDays: i.fromDays, flagDays: i.flagDays }));
        expect(mine).toEqual(vectors.items[preset]);
      });
    for (const c of vectors.states as { preset: 'milestones' | 'vaccines'; key: string; answer: string | null; age: number | null; unsetIsMissing: boolean; state: string }[])
      it(`${c.preset} ${c.key} answered ${c.answer} at ${c.age} (unsetIsMissing ${c.unsetIsMissing}) is ${c.state}`, () => {
        const item = resolveItems({ preset: c.preset }).find((i) => i.key === c.key)!;
        expect(stateOf(item, c.answer as 'done' | null, c.age, c.unsetIsMissing)).toBe(c.state);
      });
  });

  describe('pedigree layout', () => {
    for (const c of vectors.layouts as { name: string; answer: unknown; nodes: Record<string, unknown>[]; lines: unknown[][]; width: number; height: number }[])
      it(c.name, () => {
        const l = buildLayout(c.answer as FamilyAnswer);
        expect(l.nodes.map((n) => ({ id: n.id, number: n.number, relation: n.relation, shape: n.shape, x: n.x, y: n.y }))).toEqual(c.nodes);
        expect(l.lines.map((n) => [n.kind, n.x1, n.y1, n.x2, n.y2, n.double])).toEqual(c.lines);
        expect([l.width, l.height]).toEqual([c.width, c.height]);
      });
  });

  describe('tooth numbering', () => {
    const t = vectors.teeth;
    it('validity and names', () => {
      expect(t.samples.map((s: string) => isValidTooth(s))).toEqual(t.valid);
      expect(t.samples.map((s: string) => (isValidTooth(s) ? toothName(s) : null))).toEqual(t.names);
    });
    it('surface words', () => {
      expect(t.surfaceCases.map((c: { tooth: string; surface: string }) => surfaceWord(c.tooth, c.surface))).toEqual(t.surfaceWords);
      expect(SURFACES).toEqual(t.surfaceOrder);
    });
    it('the chart rows, left to right as the doctor faces the patient', () => {
      expect(upperRow(false)).toEqual(t.upperAdult);
      expect(lowerRow(false)).toEqual(t.lowerAdult);
      expect(upperRow(true)).toEqual(t.upperBaby);
      expect(lowerRow(true)).toEqual(t.lowerBaby);
    });
  });
});
