import { ENT_SAMPLE } from '../testing/ent-sample';
import { allFields } from '../core/types';
import { sampleAnswers } from './samples';

describe('sample answers for the live narrative', () => {
  it('answers every top-level field of the ENT sample with a value its kind accepts', () => {
    const a = sampleAnswers(ENT_SAMPLE);
    for (const p of ENT_SAMPLE.pages)
      for (const f of p.fields) if (f.kind !== 'unsupported') expect(a[f.key], f.key).not.toBeUndefined();
  });

  it('follow-ups are answered only under the options the sample picks', () => {
    const a = sampleAnswers(ENT_SAMPLE);
    const picked = allFields(ENT_SAMPLE).filter((f) => (f.options ?? []).some((o) => (o.subFields ?? []).length));
    for (const f of picked) {
      const chosen = new Set((Array.isArray(a[f.key]) ? (a[f.key] as string[]) : [a[f.key]]).map(String));
      for (const o of f.options ?? [])
        for (const s of o.subFields ?? []) if (!chosen.has(o.key)) expect(a[s.key], `${f.key}/${o.key}/${s.key}`).toBeUndefined();
    }
  });

  it('a given answer overrides the sample', () => {
    const first = ENT_SAMPLE.pages[0].fields[0];
    expect(sampleAnswers(ENT_SAMPLE, { [first.key]: 'X' })[first.key]).toBe('X');
  });
});
