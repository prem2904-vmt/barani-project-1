/**
 * PF Keys — pure layout rules (no DOM, no Angular).
 *
 * PF Keys is the LMS's own keypad for SEARCH fields on TABLETS (see
 * pf-keys.directive.ts). It is the result numpad generalised: the same
 * engine (numpad.service.ts) types into the field, only the key layouts
 * differ. Three layouts:
 *
 *  - `qwerty` — compact Q–P / A–L / Z–M + 123 · space · ⌫ · Add ↵ · hide;
 *  - `code`   — department prefix grid + 3×4 digits (1–9, – 0 .) + ⌫ · ABC · Add ↵;
 *  - `number` — 3×4 digits (1–9, 0) + ⌫ · ABC · Search ↵ (phone / MRN).
 */

/** Which kind of search a field is — decides the default layout and the
 *  "123" target. Remembered layout is per user per kind. */
export type PfKeysKind = 'test' | 'patient' | 'sample';
export type PfKeysLayout = 'qwerty' | 'code' | 'number';

export const PF_KEYS_KINDS: readonly PfKeysKind[] = ['test', 'patient', 'sample'];

/** Default layout per field kind (owner-approved). */
export const PF_KEYS_DEFAULT_LAYOUT: Readonly<Record<PfKeysKind, PfKeysLayout>> = {
  test: 'qwerty',
  patient: 'number',
  sample: 'code',
};

/** Where the `123` key on QWERTY leads for a kind. */
export function numericLayoutOf(kind: PfKeysKind): PfKeysLayout {
  return kind === 'patient' ? 'number' : 'code';
}

/** Layouts a kind may show (QWERTY + its numeric layout). */
export function layoutsFor(kind: PfKeysKind): PfKeysLayout[] {
  return ['qwerty', numericLayoutOf(kind)];
}

/** Normalise a directive input ('' / true / unknown → null = off). */
export function parseKind(v: unknown): PfKeysKind | null {
  return typeof v === 'string' && (PF_KEYS_KINDS as readonly string[]).includes(v) ? (v as PfKeysKind) : null;
}

/** The layout to open with: the remembered one (if the kind allows it), else
 *  the field's explicit default, else the kind's default. */
export function resolveLayout(kind: PfKeysKind, remembered: string | null | undefined, fieldDefault?: PfKeysLayout | null): PfKeysLayout {
  const allowed = layoutsFor(kind);
  if (remembered && (allowed as string[]).includes(remembered)) return remembered as PfKeysLayout;
  if (fieldDefault && allowed.includes(fieldDefault)) return fieldDefault;
  return PF_KEYS_DEFAULT_LAYOUT[kind];
}

/** localStorage key for the remembered layout (per user, per field kind). */
export function layoutStorageKey(userId: string, kind: PfKeysKind): string {
  return `pf-keys-layout:${userId || 'anon'}:${kind}`;
}

export const QWERTY_ROWS: readonly (readonly string[])[] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

/** Code pad digit grid (mock C): 1–9, then – 0 . */
export const CODE_DIGITS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', '.'];
/** Number pad digit grid (patient phone / MRN): 1–9, then 0. */
export const NUMBER_DIGITS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** A department prefix key on the code pad. */
export interface PfKeysPrefix {
  /** What the key shows (the department's code, e.g. "HEM"). */
  label: string;
  /** What it types (defaults to the label). */
  insert?: string;
  /** Screen-reader name (the department's name). */
  name?: string;
  /** Small second line (e.g. the sample prefix "01·26"). */
  hint?: string;
}

/** Minimal department shape (shared/models/tenant.model Department). */
export interface PfKeysDept {
  name?: string | null;
  code?: string | null;
  sampleCode?: number | null;
  isActive?: boolean | null;
}

/**
 * The lab's OWN department codes as prefix keys (never hardcoded).
 *  - `test`: the department code (test codes start with it: HEM001).
 *  - `sample`: the short sample barcode starts DD + YY (the department's
 *    2-digit sample code + the year) — that is what the key types when the
 *    department has one; otherwise its letter code (legacy HAEM2608… ids).
 * Unique by label, inactive departments and blank codes skipped, A→Z.
 */
export function deptPrefixes(depts: readonly PfKeysDept[] | null | undefined, kind: PfKeysKind, year = new Date().getFullYear()): PfKeysPrefix[] {
  const out = new Map<string, PfKeysPrefix>();
  const yy = String(year % 100).padStart(2, '0');
  for (const d of depts ?? []) {
    if (!d || d.isActive === false) continue;
    const code = (d.code ?? '').trim().toUpperCase();
    if (!code || out.has(code)) continue;
    const sc = d.sampleCode;
    if (kind === 'sample' && sc != null && sc >= 1 && sc <= 99) {
      const dd = String(sc).padStart(2, '0');
      out.set(code, { label: code, insert: dd + yy, name: d.name ?? code, hint: `${dd}·${yy}` });
    } else {
      out.set(code, { label: code, insert: code, name: d.name ?? code });
    }
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Screen-reader name for a character key. */
export function keyAria(ch: string): string {
  if (/^[a-z]$/i.test(ch)) return `Letter ${ch.toUpperCase()}`;
  if (/^[0-9]$/.test(ch)) return `Digit ${ch}`;
  switch (ch) {
    case ' ': return 'Space';
    case '-': return 'Hyphen';
    case '.': return 'Dot';
    default: return ch;
  }
}
