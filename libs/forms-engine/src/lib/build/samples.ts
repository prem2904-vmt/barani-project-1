import { Answers, FieldDef, FormDefinition } from '../core/types';
import { kindBuild } from '../kinds/build-registry';

/**
 * Typical answers for the live narrative in Studio: every field gets its
 * kind's sample answer, and the follow-ups of the options that sample picks
 * get theirs. The API writes the words from them (it is the truth for the
 * narrative); Studio only chooses the answers.
 */
export function sampleAnswers(def: FormDefinition, overrides: Answers = {}): Answers {
  const out: Answers = {};
  const walk = (f: FieldDef) => {
    const v = Object.prototype.hasOwnProperty.call(overrides, f.key) ? overrides[f.key] : sample(f);
    if (v === undefined) return;
    // a group's rows get their children's samples (a row is keyed by child key)
    out[f.key] =
      Array.isArray(v) && f.children?.length
        ? v.map((row) => {
            const filled: Answers = { ...(row as Answers) };
            for (const c of f.children ?? []) if (filled[c.key] === undefined) filled[c.key] = sample(c);
            return filled;
          })
        : v;
    const picked = new Set((Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase()));
    for (const o of f.options ?? []) if (picked.has(o.key.toLowerCase())) (o.subFields ?? []).forEach(walk);
  };
  for (const p of def.pages ?? []) (p.fields ?? []).forEach(walk);
  return out;
}

function sample(f: FieldDef): unknown {
  try {
    return kindBuild(f.kind).sample(f);
  } catch {
    return undefined;
  }
}
