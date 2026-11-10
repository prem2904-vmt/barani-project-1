import { FieldDef, FormDefinition, OptionDef, PageDef } from '../core/types';
import { findField } from './doc';

/**
 * The API's validator answers with `{severity, path, message}` where `path`
 * is like `pages[1].fields[0](pain).options[2].key`. Studio lists them per
 * field in plain words with a tap-to-jump target. The API is the truth for
 * WHAT is wrong; this only finds WHERE and says it simply.
 */

export interface FormProblem {
  severity: 'error' | 'warning' | string;
  path: string;
  message: string;
}

export interface PlacedProblem {
  severity: 'error' | 'warning';
  /** Plain words, without keys. */
  text: string;
  pageKey: string | null;
  pageTitle: string | null;
  fieldKey: string | null;
  fieldLabel: string | null;
  /** Where to look on the card: the sentence, a condition, the choices, its settings. */
  area: 'says' | 'showWhen' | 'options' | 'settings' | 'label' | 'narrative' | 'form';
  raw: FormProblem;
}

export function placeProblems(def: FormDefinition, problems: readonly FormProblem[]): PlacedProblem[] {
  return problems.map((p) => placeProblem(def, p));
}

export function placeProblem(def: FormDefinition, p: FormProblem): PlacedProblem {
  const path = p.path ?? '';
  let pageKey: string | null = null;
  let pageTitle: string | null = null;
  let field: FieldDef | null = null;

  const pageIdx = /^pages\[(\d+)\]/.exec(path);
  if (pageIdx) {
    const page = def.pages?.[Number(pageIdx[1])];
    pageKey = page?.key ?? null;
    pageTitle = page?.title ?? null;
  }
  // the deepest "(key)" names the field; else walk the [i] indexes
  const keys = [...path.matchAll(/\((\w+)\)/g)].map((m) => m[1]);
  const named = keys.length ? findField(def, keys[keys.length - 1]) : null;
  field = named ?? walkIndexes(def, path);
  const fieldsKey = /^fields\.(\w+)/.exec(path);
  if (!field && fieldsKey) field = findField(def, fieldsKey[1]);
  if (field && !pageKey) {
    const page = (def.pages ?? []).find((pg) => JSON.stringify(pg.fields).includes(`"key":"${field!.key}"`));
    pageKey = page?.key ?? null;
    pageTitle = page?.title ?? null;
  }

  const area = areaOf(path);
  return {
    severity: p.severity === 'error' ? 'error' : 'warning',
    text: plainWords(def, p.message, area),
    pageKey,
    pageTitle,
    fieldKey: field?.key ?? null,
    fieldLabel: field?.label || null,
    area,
    raw: p,
  };
}

function walkIndexes(def: FormDefinition, path: string): FieldDef | null {
  const steps = [...path.matchAll(/(pages|fields|options|subFields|children)\[(\d+)\]/g)];
  let page: PageDef | null = null;
  let field: FieldDef | null = null;
  let option: OptionDef | null = null;
  for (const [, what, n] of steps) {
    const i = Number(n);
    const f = field as FieldDef | null as FieldDef | undefined;
    if (what === 'pages') page = def.pages?.[i] ?? null;
    else if (what === 'fields') field = page?.fields?.[i] ?? null;
    else if (what === 'options') option = f?.options?.[i] ?? null;
    else if (what === 'subFields') field = option?.subFields?.[i] ?? null;
    else if (what === 'children') field = f?.children?.[i] ?? null;
  }
  return field;
}

function areaOf(path: string): PlacedProblem['area'] {
  const tail = path.replace(/^.*\)/, '');
  if (/showWhen/.test(path)) return 'showWhen';
  if (/says/.test(tail)) return 'says';
  if (/options/.test(tail)) return 'options';
  if (/label/.test(tail)) return 'label';
  if (/config|children/.test(tail)) return 'settings';
  if (/^narrative/.test(path)) return 'narrative';
  if (/fields|\(\w+\)/.test(path)) return 'settings';
  return 'form';
}

/** Server words → doctor words (keys out, the thing to do in). Unknown messages pass through. */
function plainWords(def: FormDefinition, message: string, area: PlacedProblem['area']): string {
  const m = message ?? '';
  let x: RegExpExecArray | null;
  if ((x = /^Field '(\w+)' does not exist\.?$/.exec(m)))
    return area === 'showWhen'
      ? '“Show when” uses a question that is no longer in the form. Choose another one or remove the condition.'
      : 'This uses a question that is no longer in the form.';
  if (/needs at least one option/.test(m)) return 'Add at least one choice.';
  if (/needs at least one field to repeat/.test(m)) return 'Add at least one question to repeat.';
  if (/This field has no label/.test(m)) return 'Give this question a name.';
  if ((x = /The field key '(\w+)' is used twice/.exec(m))) return 'Two questions share the same inner name. Remove the copy and add it again.';
  if (/The option key .* used twice/.test(m)) return 'Two choices share the same inner name. Remove one and add it again.';
  if (/An option needs a key/.test(m)) return 'A choice has no name.';
  if ((x = /^Section '(\w+)' does not exist/.exec(m))) return 'It writes into a paragraph that was removed. Pick another “Writes into”.';
  if ((x = /^Option '(\w+)' points at page '(\w+)'/.exec(m))) return 'A choice opens a page that was removed.';
  if ((x = /^Page '(\w+)' does not exist/.exec(m))) return 'It repeats a page that was removed.';
  if (/cannot sit inside another repeating group/.test(m)) return 'A repeating group can’t be inside another group or inside a choice.';
  if (/must sit directly on a page/.test(m)) return 'This kind of question must be directly on a page, not inside another one.';
  if ((x = /^\{\{(\w+)\}\} is not a field/.exec(m))) {
    const f = findField(def, x[1]);
    return f ? m : 'A paragraph mentions a question that is no longer in the form; that part stays empty.';
  }
  if (/nested too deeply/.test(m)) return 'Follow-up questions go too many levels deep.';
  if (/at most \d+ pages/.test(m)) return m;
  if (/A form key|key starts with a letter/.test(m)) return 'An inner name has characters that aren’t allowed. Rename the question.';
  return m.replace(/'(\w+)'/g, (_all, k) => {
    const f = findField(def, k);
    return f ? `“${f.label}”` : `“${k}”`;
  });
}

export const errorsOnly = (ps: readonly PlacedProblem[]) => ps.filter((p) => p.severity === 'error');
