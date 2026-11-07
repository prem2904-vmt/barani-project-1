import { ApplicationRef, Injectable, inject, signal } from '@angular/core';

/**
 * "Set / change PIN" dialog (OPS-107). The avatar menus (top strip, bottom-nav
 * More) call `open()` from their tap handler; the one `<pf-set-pin-dialog>` in
 * the shell renders it.
 *
 * iPad / WKWebView only raises the keypad for a focus() that runs INSIDE the
 * user's tap. The dialog is rendered by a different component, so `open()`
 * flips the signal, runs change detection SYNCHRONOUSLY and then calls the
 * focus hook the dialog registered - all still inside the caller's click.
 */
@Injectable({ providedIn: 'root' })
export class SetPinDialogService {
  private readonly app = inject(ApplicationRef);
  private readonly _open = signal(false);
  readonly isOpen = this._open.asReadonly();
  /** Registered by the dialog component: focuses its first PIN field. */
  focusHook: (() => void) | null = null;

  open(): void {
    this._open.set(true);
    try { this.app.tick(); } catch { /* a failed tick must never block opening */ }
    this.focusHook?.();
  }

  close(): void {
    this._open.set(false);
  }
}
