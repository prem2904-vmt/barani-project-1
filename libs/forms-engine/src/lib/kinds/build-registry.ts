import { KindBuild, resolve } from '../build/contract';
import { FieldDef, KNOWN_KINDS, KnownKind, PLAIN_KINDS, PlainKind } from '../core/types';
import { BMI_BUILD } from './bmi/bmi.build';
import { BODY_MAP_BUILD } from './bodyMap/bodyMap.build';
import { DRAWING_BUILD } from './drawing/drawing.build';
import { EYE_DIAGRAM_BUILD } from './eyeDiagram/eyeDiagram.build';
import { GRID_BUILD } from './grid/grid.build';
import { PHOTO_MARKUP_BUILD } from './photoMarkup/photoMarkup.build';
import { PHOTOS_BUILD } from './photos/photos.build';
import { CHOICE_BUILD } from './choice/choice.build';
import { DATE_BUILD } from './date/date.build';
import { DURATION_BUILD } from './duration/duration.build';
import { MEASURE_BUILD } from './measure/measure.build';
import { MULTI_BUILD } from './multi/multi.build';
import { NUMBER_BUILD } from './number/number.build';
import { REPEAT_BUILD } from './repeat/repeat.build';
import { REPEAT_PAGES_BUILD } from './repeatPages/repeatPages.build';
import { SIZE_BUILD } from './size/size.build';
import { TEXT_BUILD } from './text/text.build';
import { YESNO_BUILD } from './yesno/yesno.build';

/**
 * Every plain kind → its Studio descriptor (the build half of the kind
 * contract). `registry.spec.ts` fails if a catalogue kind has none.
 */
export const KIND_BUILDS: Record<KnownKind, KindBuild> = {
  text: TEXT_BUILD,
  number: NUMBER_BUILD,
  date: DATE_BUILD,
  choice: CHOICE_BUILD,
  multi: MULTI_BUILD,
  yesno: YESNO_BUILD,
  duration: DURATION_BUILD,
  size: SIZE_BUILD,
  measure: MEASURE_BUILD,
  bmi: BMI_BUILD,
  repeat: REPEAT_BUILD,
  repeatPages: REPEAT_PAGES_BUILD,
  drawing: DRAWING_BUILD,
  bodyMap: BODY_MAP_BUILD,
  photoMarkup: PHOTO_MARKUP_BUILD,
  photos: PHOTOS_BUILD,
  eyeDiagram: EYE_DIAGRAM_BUILD,
  grid: GRID_BUILD,
};

/** A kind the UI has no descriptor for (an imported legacy field). */
const UNKNOWN: KindBuild = {
  kind: 'text',
  name: 'Not supported yet',
  hint: 'An old field this version cannot show yet. It is kept so nothing is lost.',
  icon: 'alert',
  group: 'Ask',
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: [],
  config: [],
  sample: () => undefined,
};

export function kindBuild(kind: string): KindBuild {
  return (KIND_BUILDS as Record<string, KindBuild>)[kind] ?? { ...UNKNOWN, kind: kind as KnownKind };
}

export function isPlainKind(kind: string): kind is PlainKind {
  return (PLAIN_KINDS as readonly string[]).includes(kind);
}

/** A kind this UI fills and builds (plain or image). */
export function isKnownKind(kind: string): kind is KnownKind {
  return (KNOWN_KINDS as readonly string[]).includes(kind);
}

/** The field's "if none / if no" style. */
export const ifNoneOf = (f: FieldDef) => resolve(kindBuild(f.kind).ifNone, f);
export const conditionOpsOf = (f: FieldDef) => resolve(kindBuild(f.kind).conditionOps, f);
export const conditionValueOf = (f: FieldDef) => resolve(kindBuild(f.kind).conditionValue, f);
