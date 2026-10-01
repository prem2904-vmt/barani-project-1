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
import { isCriticalFlag, parseResultSnapshot } from './result-flag';

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
 *
 * Owner 2026-10-01: a CRITICAL value always prints. Whatever the saved pick
 * / "start with" says, a name in {@link criticalNames} is removed from the
 * hidden set here — the ONE place every report-preview / print-choice screen
 * reads before it treats a value as hidden. Only critical is mandatory; a
 * merely abnormal value stays the tech's choice.
 */
export function effectiveHidden(
  saved: string | null | undefined,
  start: PrintPickerDefault,
  allNames: readonly string[],
  critical: readonly string[] = [],
): string[] {
  let hidden: string[];
  if (saved != null && saved.trim() !== '') {
    try {
      const a = JSON.parse(saved);
      hidden = Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
    } catch { hidden = []; }
  } else {
    hidden = start === 'none' ? [...allNames] : [];
  }
  if (critical.length === 0) return hidden;
  const crit = new Set(critical.map((c) => c.toLowerCase()));
  return hidden.filter((n) => !crit.has(n.toLowerCase()));
}

/**
 * Parameter names flagged CRITICAL (CL / CH, or legacy C) on a line's saved
 * result snapshot (`currentResult`'s `flagged` map, written by mw
 * `ResultFlaggingService` at save time — analyzer-prefilled values are saved
 * through the same path, so they're covered without a separate check).
 * Mirrors mw `PrintPickerRules.CriticalNames`.
 */
export function criticalNames(currentResult: string | null | undefined): string[] {
  const flagged = parseResultSnapshot(currentResult)?.flagged;
  if (!flagged) return [];
  return Object.keys(flagged).filter((name) => isCriticalFlag(flagged[name]?.flag));
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
