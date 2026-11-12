import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { KNOWN_KINDS, KnownKind } from '../core/types';
import { FE_KINDS, KindSpec } from '../fill/contract';
import { BmiFill } from './bmi/bmi.fill';
import { ChoiceFill } from './choice/choice.fill';
import { DateFill } from './date/date.fill';
import { DurationFill } from './duration/duration.fill';
import { MeasureFill } from './measure/measure.fill';
import { MultiFill } from './multi/multi.fill';
import { NumberFill } from './number/number.fill';
import { RepeatFill } from './repeat/repeat.fill';
import { RepeatPagesFill } from './repeatPages/repeatPages.fill';
import { SizeFill } from './size/size.fill';
import { TextFill } from './text/text.fill';
import { YesnoFill } from './yesno/yesno.fill';

/** Kinds whose control is loaded on first use (heavy: the canvas engine, the grid). */
export const LAZY_KINDS: readonly string[] = ['drawing', 'bodyMap', 'photoMarkup', 'photos', 'eyeDiagram', 'grid', 'familyTree', 'ageChecklist', 'toothChart'];

/**
 * Every plain kind → its touch control. The ONLY place kinds are listed in
 * the UI (plan §4: no kind-specific `if` outside its folder);
 * `registry.spec.ts` fails if a catalogue kind has no control.
 */
export const KIND_SPECS: Record<KnownKind, KindSpec> = {
  text: { component: TextFill, group: false },
  number: { component: NumberFill },
  date: { component: DateFill },
  choice: { component: ChoiceFill, tapCompletes: true },
  multi: { component: MultiFill },
  yesno: { component: YesnoFill, tapCompletes: true },
  duration: { component: DurationFill },
  size: { component: SizeFill },
  measure: { component: MeasureFill },
  bmi: { component: BmiFill },
  repeat: { component: RepeatFill },
  repeatPages: { component: RepeatPagesFill },
  // heavy kinds (the canvas engine): loaded when a form first needs them, never in the first download
  drawing: { load: () => import('./drawing/drawing.fill').then((m) => m.DrawingFill) },
  bodyMap: { load: () => import('./bodyMap/bodyMap.fill').then((m) => m.BodyMapFill) },
  photoMarkup: { load: () => import('./photoMarkup/photoMarkup.fill').then((m) => m.PhotoMarkupFill) },
  photos: { load: () => import('./photos/photos.fill').then((m) => m.PhotosFill) },
  eyeDiagram: { load: () => import('./eyeDiagram/eyeDiagram.fill').then((m) => m.EyeDiagramFill) },
  grid: { load: () => import('./grid/grid.fill').then((m) => m.GridFill) },
  familyTree: { load: () => import('./familyTree/familyTree.fill').then((m) => m.FamilyTreeFill) },
  ageChecklist: { load: () => import('./ageChecklist/ageChecklist.fill').then((m) => m.AgeChecklistFill) },
  toothChart: { load: () => import('./toothChart/toothChart.fill').then((m) => m.ToothChartFill) },
};

export const REGISTERED_KINDS: readonly string[] = KNOWN_KINDS;

/** The filler's providers: the kind registry. Voice and wizard nav are provided by the app / the wizard. */
export function provideFormsEngine(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: FE_KINDS, useValue: KIND_SPECS }]);
}

/** Does one tap finish this field's answer (auto-advance)? */
export function tapCompletes(kind: string, display?: unknown): boolean {
  const spec = (KIND_SPECS as Record<string, KindSpec>)[kind];
  if (!spec?.tapCompletes) return kind === 'duration' && display === 'period';
  // a long list in a dropdown, or a tick box, is not a "one tap" answer
  return display !== 'check' && display !== 'switch';
}
