import { FieldDef, FormDefinition, allFields, updateField } from '@prefrontal/forms-engine';

/* ---------------- "Check this" markers ---------------- */

export function checkNoteOf(f: Pick<FieldDef, 'config'>): string {
  const n = f.config?.['checkNote'];
  return typeof n === 'string' ? n.trim() : '';
}

/** How many questions Cortex marked for a look (sub-fields and repeat children included). */
export function countChecks(def: FormDefinition | null | undefined): number {
  return def ? allFields(def).filter((f) => checkNoteOf(f)).length : 0;
}

/** This question without its marker (Looks right). */
export function clearCheck(def: FormDefinition, key: string): FormDefinition {
  return updateField(def, key, (f) => {
    if (!f.config) return;
    delete f.config['checkNote'];
    if (!Object.keys(f.config).length) delete f.config;
  });
}

/** A question's own content (without its follow-ups and children, which are other questions) and without its marker. */
function signature(f: FieldDef): string {
  const { config, options, children, ...rest } = f;
  const c = config ? { ...config } : undefined;
  if (c) delete c['checkNote'];
  return JSON.stringify({
    ...rest,
    config: c && Object.keys(c).length ? c : undefined,
    options: options?.map(({ subFields, ...o }) => ({ ...o, n: subFields?.length ?? 0 })),
    children: children?.length ?? 0,
  });
}

/** The question's content per marked key, taken before an edit. */
export function markedSignatures(def: FormDefinition | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (def) for (const f of allFields(def)) if (checkNoteOf(f)) m.set(f.key, signature(f));
  return m;
}

/** After an edit: a marked question whose content changed loses its marker ("any edit clears it"). */
export function dropEditedChecks(before: Map<string, string>, next: FormDefinition): FormDefinition {
  let out = next;
  if (!before.size) return out;
  for (const f of allFields(next)) {
    const was = before.get(f.key);
    if (was !== undefined && checkNoteOf(f) && signature(f) !== was) out = clearCheck(out, f.key);
  }
  return out;
}
