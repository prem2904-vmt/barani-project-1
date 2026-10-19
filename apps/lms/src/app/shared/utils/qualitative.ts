/**
 * Qualitative positive/negative-ish parameter detection — shared by BOTH
 * result-entry screens (result-entry + sample-result-entry).
 *
 * A parameter whose options (or type) describe a two-state qualitative
 * outcome — positive/negative, reactive/non-reactive, present/absent,
 * detected/not detected — must render as a dropdown of those options, never
 * a free text box. The dropdown also carries an empty "—" choice because
 * these results are optional-style entries.
 */

const QUAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["positive", "negative"],
  ["reactive", "non reactive"],
  ["present", "absent"],
  ["detected", "not detected"],
];

/** Default options offered when only the TYPE marks the field qualitative. */
const QUAL_TYPE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "positive negative": ["Positive", "Negative"],
  "pos neg": ["Positive", "Negative"],
  "positive or negative": ["Positive", "Negative"],
  qualitative: ["Positive", "Negative"],
  "reactive non reactive": ["Reactive", "Non-reactive"],
  "present absent": ["Present", "Absent"],
  "detected not detected": ["Detected", "Not detected"],
};

/** Lowercase and collapse separators so 'Non-Reactive' == 'non_reactive'. */
const norm = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, " ");

/**
 * The dropdown options for a qualitative parameter, or null when the
 * parameter is NOT qualitative (leave its existing render kind alone).
 * When the parameter carries its own options list containing a qualitative
 * pair, that list is returned verbatim (extra options like 'Weakly positive'
 * are preserved); when only the type is qualitative, a sensible default
 * pair is supplied.
 */
export function qualitativeOptionsFor(p: {
  type?: string;
  options?: string[];
}): string[] | null {
  const opts = (p.options ?? []).map(String).filter((o) => o.trim().length > 0);
  if (opts.length >= 2) {
    const set = new Set(opts.map(norm));
    for (const [a, b] of QUAL_PAIRS) {
      if (set.has(a) && set.has(b)) return opts;
    }
    return null; // options exist but aren't a qualitative pair → unchanged
  }
  const t = norm(String(p.type ?? ""));
  const defaults = QUAL_TYPE_OPTIONS[t];
  return defaults ? [...defaults] : null;
}
