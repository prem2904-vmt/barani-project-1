import { Type } from '@angular/core';
import { FieldDef, KnownKind, OptionDef } from '../core/types';

/**
 * The Studio half of the "add a new component" contract (plan §4): every
 * kind has ONE `kinds/<kind>/<kind>.build.ts` that tells Studio, in plain
 * doctor words, how the kind is named, which icon it has, what a new field
 * starts with, what its "if none / if no" line is, how a condition on it
 * reads, and a sample answer for the live narrative. Studio never writes a
 * kind-specific `if`: it reads these descriptors.
 */

/** How a kind writes "nothing chosen" / "No" (shown on the field card). */
export type IfNoneStyle =
  /** multi: "Denies bleeding and pain." (says.negativeHistory.prefix) */
  | 'negativeHistory'
  /** yes/no buttons: the "No" option's own words */
  | 'noOption'
  /** tick box: says.whenFalse */
  | 'whenFalse'
  | null;

/** What a condition on this kind compares with. */
export type ConditionValueKind = 'options' | 'yesno' | 'number' | 'none';

export interface ConditionOpWords {
  op: string;
  /** "is", "includes", "is more than"… */
  words: string;
  /** The op takes no value ("is answered"). */
  noValue?: boolean;
}

/** Plain words for one config property (the schema itself comes from GET /api/components). */
export interface ConfigWords {
  name: string;
  label: string;
  hint?: string;
  /** enum value → plain words */
  choices?: Record<string, string>;
  /** Show this setting only for fields where it applies (a setting that belongs to one preset). Default: always. */
  when?: (f: FieldDef) => boolean;
}

export interface KindBuild {
  kind: KnownKind;
  /** Plain name in the palette and on the card ("Multiple choice"). */
  name: string;
  /** One short line: what it is for. */
  hint: string;
  /** pf-icon name (Prepare's icon set). */
  icon: string;
  /** Palette group. */
  group: 'Ask' | 'Measure' | 'Repeat' | 'Picture' | 'Table';
  /** A new field of this kind starts with these options (copied). */
  starterOptions?: OptionDef[];
  /** A new field of this kind starts with these settings (under the catalogue's defaults). */
  starterConfig?: Record<string, unknown>;
  /** A new field of this kind starts with this one question inside (left and right: the question asked for each side). Its key is made unique. */
  starterChild?: Omit<FieldDef, 'key'>;
  /** A new field's sentence ({value} is the answer). */
  sentence(label: string): string;
  /** The placeholders its sentence understands, in doctor words (default: {value} = "the answer"). */
  sentenceTokens?: { text: string; label: string }[];
  ifNone: IfNoneStyle | ((f: FieldDef) => IfNoneStyle);
  conditionValue: ConditionValueKind | ((f: FieldDef) => ConditionValueKind);
  conditionOps: ConditionOpWords[] | ((f: FieldDef) => ConditionOpWords[]);
  /** Plain words for the kind's settings (order = display order). */
  config: ConfigWords[];
  /** A typical answer for the live narrative. */
  sample(f: FieldDef): unknown;
  /**
   * The kind's own Studio panel (image kinds: the picture and its areas), shown in the question's settings
   * above the generic ones. Inputs: `field` (FieldDef) and `apply` ((change: (f: FieldDef) => void) => void).
   */
  panel?: Type<unknown>;
}

/** What a kind's Studio panel is given (see `KindBuild.panel`). */
export type ApplyFieldChange = (change: (f: FieldDef) => void) => void;

export const ANSWERED_OPS: ConditionOpWords[] = [
  { op: 'isNotEmpty', words: 'is answered', noValue: true },
  { op: 'isEmpty', words: 'is not answered', noValue: true },
];

export const NUMBER_OPS: ConditionOpWords[] = [
  { op: 'greaterThan', words: 'is more than' },
  { op: 'lessThan', words: 'is less than' },
  { op: 'equals', words: 'is' },
  ...ANSWERED_OPS,
];

export function resolve<T>(v: T | ((f: FieldDef) => T), f: FieldDef): T {
  return typeof v === 'function' ? (v as (f: FieldDef) => T)(f) : v;
}

export const opt = (key: string, label: string, says?: string): OptionDef => ({
  key,
  label,
  ...(says ? { says } : {}),
  subFields: [],
});
