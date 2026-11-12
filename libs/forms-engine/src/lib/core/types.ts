/**
 * TS mirror of the API's v2 form definition (prefrontal-prepare-mw
 * `Prepare/Forms/FormDefinition.cs`; JSON Schema at GET /api/forms/schema).
 *
 * The API is the truth for the shape and for the narrative. This mirror is
 * used by the filler only: which pages and fields are visible, which value a
 * link or a trigger writes, what is still missing before Finish.
 */

/** The 12 plain kinds (plan §4). An imported legacy kind with no v2 home is `unsupported`. */
export const PLAIN_KINDS = [
  'text',
  'number',
  'date',
  'choice',
  'multi',
  'yesno',
  'duration',
  'size',
  'measure',
  'bmi',
  'repeat',
  'repeatPages',
] as const;
export type PlainKind = (typeof PLAIN_KINDS)[number];

/** The image kinds (plan §4, Phase 4), all on the one canvas engine (`lib/canvas`). */
export const IMAGE_KINDS = ['drawing', 'bodyMap', 'photoMarkup', 'photos', 'eyeDiagram'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** Rows × columns of small fields (plan §4, Phase 5; legacy multi-textbox). */
export const TABLE_KINDS = ['grid'] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

/** Options that are pictures laid out in a box (`pictureChoice`; a multi-select, or a single choice when `multiple` is off). */
export const PICTURE_CHOICE_KINDS = ['pictureChoice'] as const;
export type PictureChoiceKind = (typeof PICTURE_CHOICE_KINDS)[number];

/** One question asked for both sides, and the clinical shorthand boxes (group "pair"). */
export const PAIR_KINDS = ['sidePair', 'shorthand'] as const;
export type PairKind = (typeof PAIR_KINDS)[number];

/** Every kind the UI can fill and build. */
export const KNOWN_KINDS = [...PLAIN_KINDS, ...IMAGE_KINDS, ...TABLE_KINDS, ...PICTURE_CHOICE_KINDS, ...PAIR_KINDS] as const;
export type KnownKind = PlainKind | ImageKind | TableKind | PictureChoiceKind | PairKind;
export type KindName = KnownKind | 'unsupported' | (string & {});

export type ConditionOp =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual';

export interface ConditionDef {
  /** Key of the field the condition reads. */
  field: string;
  op: ConditionOp | (string & {});
  value?: unknown;
}

export interface ShowWhenDef {
  logic?: 'and' | 'or';
  visibility?: 'show' | 'hide';
  conditions: ConditionDef[];
}

/**
 * One sentence for a particular set of picks in a multi-select question (`says.combinations`; engine:
 * `narrative/combinations.ts`, mirror of the API's). `exact` fires only when the picked set equals `options`;
 * `includes` when every one of them is picked (others may be too). First match wins; `{others}` in `text` is
 * where the other picks' own sentences go.
 */
export interface CombinationDef {
  id: string;
  options: string[];
  match: 'exact' | 'includes';
  text: string;
}

export interface SaysDef {
  include?: boolean;
  /** Sentences for combinations of picks (multi-select kinds only; absent or empty = every pick says its own words). */
  combinations?: CombinationDef[];
  sections?: { section: string; order: number }[];
  prefix?: string;
  suffix?: string;
  sentence?: string;
  subheading?: boolean;
  negativeHistory?: { enabled: boolean; prefix: string };
  whenTrue?: string;
  whenFalse?: string;
}

export interface OptionDef {
  key: string;
  label: string;
  says?: string;
  icon?: string;
  imageAssetId?: string;
  color?: string;
  description?: string;
  linkedPage?: string;
  subFields?: FieldDef[];
  /** pictureChoice: a number this part is worth (a burns chart: its share of the body); picked parts add up to `config.total`. */
  value?: number;
  /** pictureChoice: where this part sits in the box, as fractions of the box (scales with it). */
  place?: PicturePlace;
  /** pictureChoice: the part's picture, an uploaded image / SVG asset id … */
  asset?: string;
  /** … or path data drawn in Studio (a 0–100 square; the API sanitises it). */
  drawn?: string;
}

/** A part's rectangle in the box: fractions 0..1 of its width / height. */
export interface PicturePlace {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FieldWidth = 'full' | 'half' | 'third' | 'quarter';

export interface FieldDef {
  key: string;
  kind: KindName;
  label: string;
  placeholder?: string;
  helper?: string;
  icon?: string;
  required?: boolean;
  width?: FieldWidth;
  showWhen?: ShowWhenDef | null;
  default?: unknown;
  config?: Record<string, unknown>;
  options?: OptionDef[];
  children?: FieldDef[];
  says?: SaysDef;
}

export interface PageDef {
  key: string;
  title: string;
  subtitle?: string;
  icon?: string;
  color?: string;
  group?: string;
  required?: boolean;
  canSkip?: boolean;
  showWhen?: ShowWhenDef | null;
  fields: FieldDef[];
}

export interface GroupDef {
  key: string;
  title: string;
  icon?: string;
  color?: string;
  order?: number;
}

export interface NarrativeSectionDef {
  key: string;
  title: string;
  order?: number;
  template?: string;
  [extra: string]: unknown;
}

/** Value-sharing link (legacy componentLinks), field keys only. A ref is `key` or `fieldKey::optionKey::subFieldKey`. */
export interface LinkDef {
  name?: string;
  fields: string[];
  /** mirror: any field propagates; cascade: only the primary does. */
  mode?: 'mirror' | 'cascade' | (string & {});
  primary?: string | null;
  disableLinked?: boolean;
}

export interface TriggerCondition {
  source: string;
  op: ConditionOp | (string & {});
  value?: unknown;
}

export interface TriggerAction {
  target: string;
  /** setValue | copyValue */
  action: 'setValue' | 'copyValue' | (string & {});
  value?: unknown;
  source?: string | null;
}

/** "When X then set Y" (legacy conditionalLinks), field keys only. */
export interface TriggerDef {
  name?: string;
  enabled?: boolean;
  logic?: 'and' | 'or';
  conditions: TriggerCondition[];
  actions: TriggerAction[];
}

export interface FormDefinition {
  schemaVersion?: number;
  title?: string;
  specialty?: string;
  description?: string;
  groups?: GroupDef[];
  pages: PageDef[];
  narrative?: { sections: NarrativeSectionDef[] };
  links?: LinkDef[];
  triggers?: TriggerDef[];
}

/** Answers by field key. Option sub-fields live under their own keys; repeat rows are objects keyed by child key. */
export type Answers = Record<string, unknown>;

// ---- value shapes per kind (valueSchema in /api/components) ----

export interface DurationValue {
  amount?: number | null;
  value?: number | null;
  valueTo?: number | null;
  unit: string;
}
export type DurationPeriod = 'morning' | 'afternoon' | 'evening' | 'night';
export interface SizeValue {
  dimensions: (number | null)[];
  unit: string;
}
export interface MeasureValue {
  value: number | null;
  unit: string;
}
export interface BmiValue {
  height: number | null;
  heightUnit: string;
  weight: number | null;
  weightUnit: string;
}
export interface RepeatPagesInstance {
  page: string;
  index: number;
  values: Answers;
}
export interface RepeatPagesValue {
  instances: RepeatPagesInstance[];
}

/** Read a config value with a fallback (config is free-form per kind). */
export function cfg<T>(field: FieldDef, name: string, fallback: T): T {
  const v = field.config?.[name];
  return v === undefined || v === null ? fallback : (v as T);
}

/** Every field in the form: top-level, option sub-fields and repeat children, depth first. */
export function allFields(def: FormDefinition): FieldDef[] {
  const out: FieldDef[] = [];
  const walk = (f: FieldDef) => {
    out.push(f);
    for (const o of f.options ?? []) for (const s of o.subFields ?? []) walk(s);
    for (const c of f.children ?? []) walk(c);
  };
  for (const p of def.pages) for (const f of p.fields) walk(f);
  return out;
}
