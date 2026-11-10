/**
 * The engine's ONE seam to the design kit (replaces Prepare's `@prepare/pf-kit` copy).
 *  - pf-select (+ its option type) and every other kit primitive: the LMS ORIGINALS in `@prefrontal/shared`.
 *  - the dialog: the {@link FeDialog} token, provided by the app with the LMS DialogService.
 *  - pf-icon + Prepare's icon set: moved into this lib (`./icons`), stroked SVG only, never emoji.
 * Engine files import kit things from here only, so a later shared-kit extraction changes one file.
 */
export { SelectComponent } from '@prefrontal/shared';
export type { PfSelectOption } from '@prefrontal/shared';
export { FeDialog } from './kit-dialog';
export type { FeDialogAction, FeDialogActionResult, FeDialogApi, FeDialogRequest } from './kit-dialog';
export { PfGoogleMarkComponent, PfIconComponent } from './icons/icon.component';
export { ICONS } from './icons/icons';
export type { IconName } from './icons/icons';
