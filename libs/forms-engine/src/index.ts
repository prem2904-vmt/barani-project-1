/**
 * forms-engine: the v2 form-definition types (TS mirror of the API), the rule
 * engine (show-when, links, triggers), the page wizard model and, per kind,
 * the doctor's touch control. Plan §4 / §6.
 */
export const FORMS_ENGINE_SCHEMA_VERSION = 2 as const;
// The kit seam (LMS originals + the FeDialog token + the engine's own pf-icon set).
export * from './lib/kit';
export * from './lib/core/types';
export * from './lib/core/rules';
export * from './lib/core/pages';
export * from './lib/fill/contract';
export * from './lib/fill/field-host.component';
export * from './lib/fill/hold.directive';
export * from './lib/kinds/registry';
// Studio (Phase 3): the build half of each kind + pure definition edits.
export * from './lib/build/contract';
export * from './lib/kinds/build-registry';
export * from './lib/build/doc';
export * from './lib/build/conditions';
export * from './lib/build/samples';
export * from './lib/build/diff';
export * from './lib/build/problems';
// Phase 4: the canvas engine and the image kinds.
export * from './lib/canvas/canvas-model';
export * from './lib/canvas/answer';
export * from './lib/canvas/geometry';
export * from './lib/canvas/history';
export * from './lib/canvas/ink';
export * from './lib/canvas/pointer';
export * from './lib/canvas/picture';
export * from './lib/canvas/photo';
export * from './lib/canvas/canvas.component';
// Phase 5: tables in the narrative (grids).
export * from './lib/narrative/narrative-table';
export * from './lib/narrative/narrative-table.component';
// Group "pair": one question for both sides, and the clinical shorthand notation.
export * from './lib/kinds/shorthand/shorthand-math';
export * from './lib/kinds/sidePair/side-pair-model';
