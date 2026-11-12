import { Injectable, TemplateRef, signal } from '@angular/core';

/**
 * Contextual actions in the bottom nav (owner 2026-11-12: a case sheet's Back / Next belong in the bar, not in a strip
 * above it). A page lends an ng-template (so every binding, hold and disabled state stays in the page) and the bar
 * renders it on the right, before Messages / the bell / the avatar, inside `[data-nav-actions]`. The work areas stay.
 *
 * Rules: the page shows the slot only while it is the screen, and clears it when it goes (only the owner that showed
 * the actions can take them back — a newer page may already own the slot). Buttons in the template use the kit's
 * `pf-btn` classes; the bar sizes them (icon-only on phones).
 */
@Injectable({ providedIn: 'root' })
export class NavActionsService {
  private readonly current = signal<{ owner: object; tpl: TemplateRef<unknown> } | null>(null);
  readonly template = () => this.current()?.tpl ?? null;

  show(owner: object, tpl: TemplateRef<unknown>): void {
    this.current.set({ owner, tpl });
  }

  clear(owner: object): void {
    if (this.current()?.owner === owner) this.current.set(null);
  }
}
