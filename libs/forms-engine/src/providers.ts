/**
 * The light entry for the app's root providers (app.config.ts). Importing the full `@prefrontal/forms-engine` barrel at
 * the root pulls Studio, the canvas engine and every kind into the first download; this file reaches only the
 * registry (plain kinds bundled, heavy kinds loaded on first use), the injection tokens and the narrative-table
 * reader the root API services use.
 */
export { provideFormsEngine } from './lib/kinds/registry';
export { FE_ASSETS, FE_VOICE } from './lib/fill/contract';
export { toNarrativeTables } from './lib/narrative/narrative-table';
export { FeDialog } from './lib/kit-dialog';
export type { FeDialogApi } from './lib/kit-dialog';
