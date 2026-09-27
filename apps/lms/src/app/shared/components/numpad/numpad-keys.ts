/**
 * Pure text-edit rules for the result numpad (no DOM, no Angular).
 *
 * The numpad never decides what a field ACCEPTS — the screen's own keydown
 * validator does (the directive replays each key through it first, see
 * numpad.directive.ts). These helpers only perform the edit once a key has
 * been accepted: insert at the caret / over the selection, or delete.
 */

/** A character key on the pad. */
export type NumpadChar = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '-' | '<' | '>';

export const NUMPAD_DIGITS: readonly NumpadChar[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const NUMPAD_SYMBOLS: readonly NumpadChar[] = ['.', '-', '<', '>'];
export const NUMPAD_ALL: readonly NumpadChar[] = [...NUMPAD_DIGITS, ...NUMPAD_SYMBOLS];

/** A field value plus where the caret lands after an edit. */
export interface TextEdit {
  value: string;
  caret: number;
}

function clampSel(value: string, start: number | null | undefined, end: number | null | undefined) {
  const len = value.length;
  const s = start == null || start < 0 || start > len ? len : start;
  const e = end == null || end < s || end > len ? s : end;
  return { s, e };
}

/** Insert `text` at the caret, replacing any selection. A null selection
 *  (inputs whose type has no selection API) appends. */
export function insertText(value: string, start: number | null | undefined, end: number | null | undefined, text: string): TextEdit {
  const v = value ?? '';
  const { s, e } = clampSel(v, start, end);
  return { value: v.slice(0, s) + text + v.slice(e), caret: s + text.length };
}

/** Backspace: delete the selection, or the one character before the caret. */
export function backspaceText(value: string, start: number | null | undefined, end: number | null | undefined): TextEdit {
  const v = value ?? '';
  const { s, e } = clampSel(v, start, end);
  if (e > s) return { value: v.slice(0, s) + v.slice(e), caret: s };
  if (s === 0) return { value: v, caret: 0 };
  return { value: v.slice(0, s - 1) + v.slice(s), caret: s - 1 };
}

/**
 * Which keys a field SHOWS (not which it accepts). `null`/'' = every key.
 * Tokens (space or comma separated): `digits` (or `0-9`), `.`, `-`, `<`, `>`.
 * Digits are always shown — a numpad without them is not a numpad.
 */
export function parseKeySet(spec: string | null | undefined): ReadonlySet<NumpadChar> {
  const raw = (spec ?? '').trim();
  if (!raw) return new Set(NUMPAD_ALL);
  const out = new Set<NumpadChar>(NUMPAD_DIGITS);
  for (const tok of raw.split(/[\s,]+/)) {
    if ((NUMPAD_SYMBOLS as readonly string[]).includes(tok)) out.add(tok as NumpadChar);
  }
  return out;
}
