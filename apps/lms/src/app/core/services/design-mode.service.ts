import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { UI_SWITCHES_ENABLED } from './theme.service';

/**
 * Design mode — designer tooling for the code→Figma pipeline.
 *
 * A user holding the `design_mode` permission gets a toggle in the avatar
 * menu. While ON, the app is frozen for pixel-clean captures (the global
 * `pf-design-mode` class on <html> pauses animations/transitions and hides
 * the text caret) and a small floating badge shows the screen slug +
 * breakpoint, so the Figma frame can be named consistently.
 *
 * The capture itself rides the html.to.design browser extension — one click
 * there lands the live DOM in Figma as editable layers. This service only
 * makes the screen capture-clean and gates who sees the affordance; it
 * grants no data access.
 */
@Injectable({ providedIn: 'root' })
export class DesignModeService {
  private static readonly KEY = 'pf-design-mode';

  private readonly auth = inject(AuthService);

  /** Whether the signed-in user may use design mode at all. */
  /** Off while the UI switches are locked (theme.service UI_SWITCHES_ENABLED). */
  readonly available = computed(() => UI_SWITCHES_ENABLED && this.auth.hasPermission('design_mode'));

  private readonly _enabled = signal(this.restore());
  readonly enabled = computed(() => this._enabled() && this.available());

  /** Badge collapsed to a dot so it stays out of a capture's way. */
  readonly minimized = signal(false);

  constructor() {
    // Reflect the mode onto <html> so global styles can freeze the UI —
    // driven off `enabled` so losing the permission also drops the class.
    effect(() => {
      if (typeof document === 'undefined') return;
      document.documentElement.classList.toggle('pf-design-mode', this.enabled());
    });
  }

  toggle(): void {
    this.set(!this._enabled());
  }

  set(on: boolean): void {
    this._enabled.set(on);
    this.minimized.set(false);
    try {
      if (on) localStorage.setItem(DesignModeService.KEY, '1');
      else localStorage.removeItem(DesignModeService.KEY);
    } catch { /* storage unavailable (private mode) — mode still works for the session */ }
  }

  private restore(): boolean {
    try { return localStorage.getItem(DesignModeService.KEY) === '1'; }
    catch { return false; }
  }
}
