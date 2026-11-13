import { Injectable, TemplateRef, signal } from '@angular/core';

/**
 * One bottom bar (owner, 2026-11-02): while a case sheet is open, the LMS bottom navbar shows the form's own
 * controls (Back · Pages · Next / Finish, with their holds) in place of the work areas; leaving the sheet puts the
 * work areas back. The case page owns the controls (an ng-template, so every binding and style stays in the page)
 * and lends them to the bar here; the bar only renders whatever it is given.
 */
@Injectable({ providedIn: 'root' })
export class FormBarService {
  private readonly current = signal<{ owner: object; tpl: TemplateRef<unknown>; home?: () => void } | null>(null);
  readonly template = () => this.current()?.tpl ?? null;
  /** Where the PF logo goes while the sheet owns the bar (owner 2026-11-13: logo = back home, like legacy). */
  readonly home = () => this.current()?.home ?? null;

  /** Show these controls in the bar (the owner is whoever may later take them back). */
  show(owner: object, tpl: TemplateRef<unknown>, home?: () => void): void {
    this.current.set({ owner, tpl, home });
  }

  /** Take them back — only the owner that showed them can (a newer page may already own the bar). */
  clear(owner: object): void {
    if (this.current()?.owner === owner) this.current.set(null);
  }
}
