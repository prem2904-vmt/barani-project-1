import { Injectable, signal } from '@angular/core';

export type DialogKind = 'prompt' | 'confirm' | 'choice' | 'actions';

/** One option of a `choose()` dialog — rendered as a selectable card. */
export interface DialogChoice {
  value: string;
  label: string;
  hint?: string;
}
export type DialogTone = 'primary' | 'danger';

/** One footer button of an `actions()` dialog. Exactly one should be
 *  'primary' (the CTA); the rest 'secondary'. */
export interface DialogAction {
  value: string;
  label: string;
  variant?: 'primary' | 'secondary';
}

/** Result of an `actions()` dialog: the button pressed (null = dismissed) and
 *  the state of its optional checkbox. */
export interface DialogActionResult {
  action: string | null;
  checked: boolean;
}

export interface DialogRequest {
  kind: DialogKind;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  /** Header glyph override (default: info / pencil / warning by kind+tone). */
  icon?: 'printer';
  /** Optional list under the message (scrolls when long) — e.g. the empty
   *  fields a "Submit all" would leave blank. */
  items?: string[];
  /** Optional closing question under the list ("Do you still want to submit?"). */
  question?: string;

  // prompt-only
  placeholder?: string;
  initialValue?: string;
  multiline?: boolean;
  inputType?: 'text' | 'number' | 'email' | 'tel';
  required?: boolean;

  // choice-only
  choices?: DialogChoice[];
  /** Pre-selected choice (the sensible default). */
  initialChoice?: string;

  // actions-only
  actions?: DialogAction[];
  /** Optional checkbox above the footer (e.g. "Don't ask again"). */
  checkbox?: { label: string; initial?: boolean };
}

interface PendingDialog extends DialogRequest {
  id: string;
  resolve: (result: string | boolean | null, checked?: boolean) => void;
}

/**
 * Themed replacement for `window.prompt` / `window.confirm`.
 *
 * Usage:
 *   const reason = await dialog.prompt({ title: 'Reject sample?', placeholder: 'Reason…', tone: 'danger' });
 *   if (!reason) return;
 *
 *   const ok = await dialog.confirm({ title: 'Restore this version?', tone: 'primary' });
 *   if (!ok) return;
 *
 * The <pf-dialog-host> component rendered once inside the shell consumes
 * `active()` and renders the themed modal.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly _active = signal<PendingDialog | null>(null);
  readonly active = this._active.asReadonly();

  prompt(req: Omit<DialogRequest, 'kind'>): Promise<string | null> {
    return new Promise<string | null>(resolve => {
      this._active.set({
        id: this.mkId(),
        kind: 'prompt',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        tone: 'primary',
        ...req,
        resolve: (result) => resolve(result as string | null)
      });
    });
  }

  confirm(req: Omit<DialogRequest, 'kind'>): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this._active.set({
        id: this.mkId(),
        kind: 'confirm',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        tone: 'primary',
        ...req,
        resolve: (result) => resolve(!!result)
      });
    });
  }

  /** One quick pick between a few options (cards, one pre-selected). Resolves
   *  to the chosen `value`, or null when dismissed (Cancel / Esc / backdrop). */
  choose(req: Omit<DialogRequest, 'kind'> & { choices: DialogChoice[] }): Promise<string | null> {
    return new Promise<string | null>(resolve => {
      this._active.set({
        id: this.mkId(),
        kind: 'choice',
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
        tone: 'primary',
        initialChoice: req.choices[0]?.value,
        ...req,
        resolve: (result) => resolve(typeof result === 'string' ? result : null)
      });
    });
  }

  /** Several explicit actions (+ Cancel) and an optional checkbox. Resolves to
   *  the pressed action's `value` (null when dismissed) and the checkbox. */
  actions(req: Omit<DialogRequest, 'kind' | 'actions'> & { actions: DialogAction[] }): Promise<DialogActionResult> {
    return new Promise<DialogActionResult>(resolve => {
      this._active.set({
        id: this.mkId(),
        kind: 'actions',
        cancelLabel: 'Cancel',
        tone: 'primary',
        ...req,
        resolve: (result, checked) => resolve({
          action: typeof result === 'string' ? result : null,
          checked: !!checked,
        }),
      });
    });
  }

  resolve(result: string | boolean | null, checked?: boolean): void {
    const a = this._active();
    if (!a) return;
    this._active.set(null);
    a.resolve(result, checked);
  }

  private mkId(): string {
    return 'd-' + Math.random().toString(36).slice(2, 9);
  }
}
