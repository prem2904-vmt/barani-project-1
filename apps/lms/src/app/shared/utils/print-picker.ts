/**
 * "Tech picks what prints (per report)" — `printPicker: true` in a test's OR
 * a profile's Parameters wrapper. The setting follows what was ORDERED (owner
 * 2026-09-29, same rule as profile notes): a line ordered as part of a
 * profile takes the PROFILE's setting, overriding each member's own; a line
 * ordered on its own (or loose in a package) takes the test's own.
 *
 * The server resolves it (mw `PrintPickerRules`) and stamps `printPicker` on
 * every line of the result-entry responses — this mirror only READS that
 * value, falling back to the test's own flag when a line was not annotated
 * (an older server), which was the behaviour before profiles had the switch.
 */
export function printPickerFlag(parametersJson: string | null | undefined): boolean {
  if (!parametersJson) return false;
  try { return JSON.parse(parametersJson)?.printPicker === true; } catch { return false; }
}

export interface PrintPickerLine {
  printPicker?: boolean | null;
  printPickerDefault?: string | null;
  test?: { parameters?: string | null } | null;
}

export function resolvePrintPicker(t: PrintPickerLine): boolean {
  if (typeof t.printPicker === 'boolean') return t.printPicker;
  return printPickerFlag(t.test?.parameters);
}

/**
 * "Start with" for the picker (owner 2026-09-30) — `printPickerDefault` in
 * the same Parameters wrapper: 'none' = every value starts UNTICKED and the
 * tech ticks what prints; absent / anything else = 'all' (every value starts
 * ticked — the behaviour before the setting). Resolved by the SAME ordered
 * rule as the switch (mw `PrintPickerRules.ResolveDefault`, stamped as
 * `printPickerDefault`); this mirror falls back to the test's own value.
 */
export type PrintPickerDefault = 'all' | 'none';

export function printPickerDefaultOf(parametersJson: string | null | undefined): PrintPickerDefault {
  if (!parametersJson) return 'all';
  try {
    const v = JSON.parse(parametersJson)?.printPickerDefault;
    return typeof v === 'string' && v.toLowerCase() === 'none' ? 'none' : 'all';
  } catch { return 'all'; }
}

export function resolvePrintPickerDefault(t: PrintPickerLine): PrintPickerDefault {
  if (typeof t.printPickerDefault === 'string') return t.printPickerDefault.toLowerCase() === 'none' ? 'none' : 'all';
  return printPickerDefaultOf(t.test?.parameters);
}

/**
 * The value names hidden from THIS order's report, as result entry shows
 * them: a SAVED pick (`reportHiddenJson` present — even `[]`) always wins;
 * never picked + 'none' → every value hidden (all boxes unticked); never
 * picked + 'all' → nothing hidden. Mirrors mw `PrintPickerRules.EffectiveHidden`.
 */
export function effectiveHidden(
  saved: string | null | undefined,
  start: PrintPickerDefault,
  allNames: readonly string[],
): string[] {
  if (saved != null && saved.trim() !== '') {
    try { const a = JSON.parse(saved); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; }
    catch { return []; }
  }
  return start === 'none' ? [...allNames] : [];
}

/**
 * Does a result input hold a value? (owner 2026-09-30: entering a value ticks
 * its print box, clearing an auto-ticked one unticks it.) Numbers count
 * (0 included), text counts when not blank, a multi-select counts when at
 * least one non-blank pick is left; null / undefined / '' / [] do not.
 */
export function hasEnteredValue(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.some((x) => hasEnteredValue(x));
  if (typeof v === 'number') return !Number.isNaN(v);
  if (typeof v === 'boolean') return true;
  return String(v).trim() !== '';
}
