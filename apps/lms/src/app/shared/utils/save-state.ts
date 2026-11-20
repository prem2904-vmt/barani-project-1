/**
 * The words of a Save that has nothing to save (owner 2026-11-19: Save is DISABLED until something changed — the kit's
 * disabled primary, never hidden). Every Save button uses these so the tooltip / screen-reader text is one phrase.
 *
 *   <button class="pf-hb-btn pf-hb-btn--primary" [disabled]="!canSave()" [attr.aria-disabled]="ariaDisabled(!canSave())"
 *           [title]="saveTitle(canSave(), 'Save')">Save</button>
 *
 * A button that also carries `[pfBusy]` passes the state as `[pfBusyInactive]="!canSave()"` instead: the busy directive
 * owns the host's aria-disabled and would overwrite a template `[attr.aria-disabled]`.
 */
export const NO_CHANGES_TITLE = 'No changes to save';

/** The button's title: its own label while it can save (or is saving), else "No changes to save". */
export function saveTitle(enabled: boolean, label = 'Save'): string {
  return enabled ? label : NO_CHANGES_TITLE;
}

/** `aria-disabled` value for an attribute binding: "true" or null (attribute removed). */
export function ariaDisabled(disabled: boolean): 'true' | null {
  return disabled ? 'true' : null;
}
