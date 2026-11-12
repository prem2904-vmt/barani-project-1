import { Injectable } from '@angular/core';

/**
 * The "back" gesture / Android hardware back closes the topmost open overlay (the Start menu, the account
 * menu) before it does anything to the page. NavBackService.back() and the Capacitor backButton listener
 * both ask closeTop() first. An overlay registers while it is open and unregisters when it closes.
 */
@Injectable({ providedIn: 'root' })
export class OverlayBackService {
  private readonly closers: Array<() => void> = [];

  /** Returns the unregister function. */
  register(close: () => void): () => void {
    this.closers.push(close);
    return () => {
      const i = this.closers.lastIndexOf(close);
      if (i >= 0) this.closers.splice(i, 1);
    };
  }

  /** Closes the most recently opened overlay; true when there was one. */
  closeTop(): boolean {
    const close = this.closers.pop();
    if (!close) return false;
    close();
    return true;
  }

  get open(): boolean {
    return this.closers.length > 0;
  }
}
