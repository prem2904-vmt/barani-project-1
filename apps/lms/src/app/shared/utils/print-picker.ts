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
  test?: { parameters?: string | null } | null;
}

export function resolvePrintPicker(t: PrintPickerLine): boolean {
  if (typeof t.printPicker === 'boolean') return t.printPicker;
  return printPickerFlag(t.test?.parameters);
}
