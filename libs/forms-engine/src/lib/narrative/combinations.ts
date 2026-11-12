import { CombinationDef, FieldDef } from '../core/types';

/**
 * Sentences for combinations of picks in a multi-select question (`says.combinations`).
 *
 * ONE helper for every multi-select kind, the TS mirror of the API's (prefrontal-mw `CaseSheets/Engine`). The API
 * writes the real narrative and is the truth; this decides which rule a set of picks fires (the same way) and
 * writes the preview line Studio shows, so the author sees the sentence while typing it.
 *
 * Rules, top to bottom, FIRST match wins:
 *  - `exact`    fires only when the picked set equals the rule's options;
 *  - `includes` fires when every option of the rule is picked (others may be, too).
 * When one fires, its `text` takes the place of the matched options; the other picks are narrated as they always
 * are, put where `{others}` stands, or after the text when there is no placeholder. Nothing fires: no change.
 */

/**
 * Kinds whose answer is a SET of option keys, so a question of that kind can carry combination sentences:
 * `multi` and `pictureChoice` (when more than one pick is allowed). Left out on purpose: `choice` / `yesno`
 * (one pick), `bodyMap` (its picks are areas with their own "Marked over …" sentence; its markers are not a
 * question's choices), `grid`, `size`, `repeat*` (rows, not a set).
 */
export const COMBINATION_KINDS: readonly string[] = ['multi', 'pictureChoice'];

export const OTHERS = '{others}';

export function supportsCombinations(f: Pick<FieldDef, 'kind' | 'config'> | null | undefined): boolean {
  if (!f || !COMBINATION_KINDS.includes(f.kind)) return false;
  return !(f.kind === 'pictureChoice' && f.config?.['multiple'] === false);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The rules the field carries (never a rule with no choices). */
export function combinationsOf(f: Pick<FieldDef, 'says'> | null | undefined): CombinationDef[] {
  const list = f?.says?.combinations;
  return Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.options) && c.options.length > 0) : [];
}

/** The picked keys of a multi-select answer, each once, in the order they were picked, in the option's own spelling. */
export function pickedKeys(f: Pick<FieldDef, 'options'>, value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? [value] : [];
  const opts = f.options ?? [];
  const out: string[] = [];
  for (const x of raw) {
    const k = opts.find((o) => same(o.key, x))?.key ?? x;
    if (!out.some((y) => same(y, k))) out.push(k);
  }
  return out;
}

/** The first rule the picked set fires, or null (then each pick says its own words). */
export function matchCombination(rules: readonly CombinationDef[], picked: readonly string[]): CombinationDef | null {
  const has = (k: string) => picked.some((p) => same(p, k));
  for (const r of rules) {
    if (!r.options.length || !r.options.every(has)) continue;
    if (r.match === 'exact' && picked.length !== new Set(r.options.map((o) => o.toLowerCase())).size) continue;
    return r;
  }
  return null;
}

/** The picks the rule did not take, in their order: these keep their own sentences. */
export function extrasOf(rule: CombinationDef, picked: readonly string[]): string[] {
  return picked.filter((p) => !rule.options.some((o) => same(o, p)));
}

/** What one pick says on its own: its own sentence, else its label as written. */
export function optionWords(f: Pick<FieldDef, 'options'>, key: string): string {
  const o = (f.options ?? []).find((x) => same(x.key, key));
  return (o?.says?.trim() || o?.label?.trim() || key).trim();
}

/** "a, b and c": the joiner the case sheet uses between picks. */
export function joinWords(parts: readonly string[]): string {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] ?? '';
  return `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
}

const CONNECTORS = /(?:[,;]?\s*(?:along with|together with|as well as|plus|along|with|and|also))+\s*$/i;

/**
 * The rule's text with `{others}` filled (every one of them), or the extras after it (joined like any list)
 * when there is no placeholder. Nothing else picked: each `{others}` and the clause before it, back to the last
 * comma, semicolon or linking word, are dropped; the text after it stays.
 */
export function combinationText(rule: Pick<CombinationDef, 'text'>, extraKeys: string[] | string): string {
  const extras = Array.isArray(extraKeys) ? extraKeys : extraKeys ? [extraKeys] : [];
  const text = rule.text ?? '';
  if (!text.includes(OTHERS)) return joinWords([text.trim(), ...extras]);
  if (extras.length) return text.split(OTHERS).join(joinWords(extras)).trim();
  const [first, ...rest] = text.split(OTHERS);
  let out = first;
  for (const part of rest) {
    out = out.replace(CONNECTORS, '').replace(/[,;\s]+$/, '') + part;
  }
  return out.replace(/^[\s,;:]+/, '').trim();
}

/** The sentence the picks write, for the combination that fires or (none fits) each pick's own words. */
export function picksWords(f: Pick<FieldDef, 'options' | 'says'>, picked: readonly string[]): { words: string; fires: string | null } {
  const rule = matchCombination(combinationsOf(f), picked);
  if (!rule) return { words: joinWords(picked.map((k) => optionWords(f, k))), fires: null };
  return { words: combinationText(rule, extrasOf(rule, picked).map((k) => optionWords(f, k))), fires: rule.id };
}

// ───────────── the worked-out total (pictureChoice: each part's `value`, `config.total`) ─────────────

/** `config.total`: the sum of the picked parts' numbers, written after the picks ("Total burn area 27%"). Absent = none. */
export interface TotalConfig {
  label: string;
  unit: string;
  decimals: number;
}

export function totalConfig(f: Pick<FieldDef, 'config'>): TotalConfig | null {
  const t = (f.config ?? {})['total'];
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  const d = typeof o['decimals'] === 'number' && Number.isFinite(o['decimals']) ? Math.round(o['decimals']) : 0;
  return {
    label: typeof o['label'] === 'string' && o['label'].trim() ? (o['label'] as string).trim() : 'Total',
    unit: typeof o['unit'] === 'string' ? (o['unit'] as string).trim() : '',
    decimals: Math.min(4, Math.max(0, d)),
  };
}

/** Half away from zero, to `decimals` places. */
function roundAway(n: number, decimals: number): number {
  const k = 10 ** decimals;
  return (Math.sign(n) * Math.round(Math.abs(n) * k + 1e-9)) / k;
}

/** The sum of the picked parts' numbers (a part with no number adds nothing), rounded. */
export function totalOf(f: Pick<FieldDef, 'options' | 'config'>, picked: readonly string[]): number {
  const sum = (f.options ?? []).reduce(
    (n, o) => (picked.some((p) => same(p, o.key)) && typeof o.value === 'number' && Number.isFinite(o.value) ? n + o.value : n),
    0,
  );
  return roundAway(sum, totalConfig(f)?.decimals ?? 0);
}

/** "Total burn area 27%" (a % or ° unit sits against the number, any other after a space); null: no total set, or nothing picked. */
export function totalLine(f: Pick<FieldDef, 'options' | 'config'>, picked: readonly string[]): string | null {
  const t = totalConfig(f);
  if (!t || !picked.length) return null;
  const n = totalOf(f, picked).toFixed(t.decimals); // the server writes "F<decimals>": trailing zeros are kept (27.50)
  const unit = !t.unit ? '' : /^[%°]/.test(t.unit) ? t.unit : ` ${t.unit}`;
  return `${t.label} ${n}${unit}`;
}

/**
 * What a multi-select question writes for its picks, without follow-up questions (the API writes those):
 * prefix · the sentence (a combination's, or each pick's own words) · suffix; then the total; then
 * "Denies …" for what was not picked. Nothing picked writes nothing. Mirror of the API's MultiNarration, pinned by
 * `docs/vectors/casesheet-combinations.json`.
 */
export function narratePicks(f: Pick<FieldDef, 'options' | 'says' | 'config'>, picked: readonly string[]): string {
  if (!picked.length) return '';
  const { words } = picksWords(f, picked);
  const body = [f.says?.prefix?.trim(), words, f.says?.suffix?.trim()].filter(Boolean).join(' ');
  const parts = [body];
  const total = totalLine(f, picked);
  if (total) parts.push(total);
  const nh = f.says?.negativeHistory;
  if (nh?.enabled) {
    const left = (f.options ?? []).filter((o) => !picked.some((p) => same(p, o.key))).map((o) => optionWords(f, o.key));
    if (left.length) parts.push(`${nh.prefix} ${joinWords(left)}`);
    return parts.filter(Boolean).join('. ') + (left.length ? '.' : '');
  }
  return parts.filter(Boolean).join('. ');
}

/** Studio's preview line for sample picks. */
export function previewPicks(f: Pick<FieldDef, 'options' | 'says' | 'config'>, picked: readonly string[]): string {
  return narratePicks(f, picked);
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => same(x, y)));

export interface CombinationProblem {
  /** Index of the rule the warning is about. */
  index: number;
  /** Plain words (a warning, never a block). */
  text: string;
}

/** Warnings for a question's rules, in plain words: no choice, an unknown choice, the same rule twice, a rule that can never fire. */
export function combinationProblems(f: Pick<FieldDef, 'options' | 'says'>): CombinationProblem[] {
  const all = f.says?.combinations ?? [];
  const out: CombinationProblem[] = [];
  const name = (k: string) => (f.options ?? []).find((o) => same(o.key, k))?.label ?? k;
  all.forEach((r, i) => {
    if (!r.options?.length) {
      out.push({ index: i, text: 'Pick at least one choice for this sentence.' });
      return;
    }
    const gone = r.options.filter((k) => !(f.options ?? []).some((o) => same(o.key, k)));
    if (gone.length) out.push({ index: i, text: `${joinWords(gone.map(name))} ${gone.length > 1 ? 'are' : 'is'} no longer a choice of this question.` });
    const dup = all.findIndex((x, j) => j < i && x.match === r.match && !!x.options && sameSet(x.options, r.options));
    if (dup >= 0) {
      out.push({ index: i, text: `Same choices and match as sentence ${dup + 1}, so this one never fires.` });
    } else if (r.match === 'exact') {
      const shadow = all.findIndex(
        (x, j) => j < i && x.match === 'includes' && !!x.options?.length && x.options.every((k) => r.options.some((y) => same(y, k))),
      );
      if (shadow >= 0)
        out.push({ index: i, text: `Sentence ${shadow + 1} (“plus anything else”) is higher up and always fires first, so this one never fires.` });
    }
  });
  return out;
}

let seq = 0;
/** A short id for a new rule, unique among the question's rules. */
export function newCombinationId(f: Pick<FieldDef, 'says'>): string {
  const taken = new Set((f.says?.combinations ?? []).map((c) => c.id));
  let id: string;
  do id = `c${++seq}`;
  while (taken.has(id));
  return id;
}
