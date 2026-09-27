import { Injectable, signal } from '@angular/core';

export type DialogKind = 'prompt' | 'confirm' | 'choice';

/** One option of a `choose()` dialog — rendered as a selectable card. */
export interface DialogChoice {
  value: string;
  label: string;
  hint?: string;
}
export type DialogTone = 'primary' | 'danger';

export interface DialogRequest {
  kind: DialogKind;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
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
}

interface PendingDialog extends DialogRequest {
  id: string;
  resolve: (result: string | boolean | null) => void;
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

  resolve(result: string | boolean | null): void {
    const a = this._active();
    if (!a) return;
    this._active.set(null);
    a.resolve(result);
  }

  private mkId(): string {
    return 'd-' + Math.random().toString(36).slice(2, 9);
  }
}
