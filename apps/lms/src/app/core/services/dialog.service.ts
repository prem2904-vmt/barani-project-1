import { Injectable, signal } from '@angular/core';

export type DialogKind = 'prompt' | 'confirm';
export type DialogTone = 'primary' | 'danger';

export interface DialogRequest {
  kind: DialogKind;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;

  // prompt-only
  placeholder?: string;
  initialValue?: string;
  multiline?: boolean;
  inputType?: 'text' | 'number' | 'email' | 'tel';
  required?: boolean;
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
