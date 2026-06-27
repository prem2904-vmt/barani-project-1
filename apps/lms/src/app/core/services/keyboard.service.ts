import { Injectable, inject, signal } from '@angular/core';
import { PlatformService } from './platform.service';

/**
 * Tracks the on-screen (soft) keyboard's visibility so chrome can react to it —
 * e.g. the floating bottom-nav hides while the user is typing, and the messages
 * composer drops its nav-clearance padding so it sits right above the keyboard.
 *
 * Native (Capacitor) only — the @capacitor/keyboard plugin emits reliable
 * keyboardWillShow / keyboardWillHide events. On web/desktop the `visible`
 * signal simply stays false (there's no virtual keyboard to dodge).
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private readonly platform = inject(PlatformService);

  /** True while the soft keyboard is on screen (native only). */
  readonly visible = signal(false);

  private _wired = false;

  constructor() {
    void this.wire();
  }

  private async wire(): Promise<void> {
    if (this._wired || !this.platform.isCapacitor()) return;
    this._wired = true;
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      // willShow/willHide fire a touch earlier than didShow/didHide, so the
      // nav animates out as the keyboard slides up rather than after.
      await Keyboard.addListener('keyboardWillShow', () => this.visible.set(true));
      await Keyboard.addListener('keyboardWillHide', () => this.visible.set(false));
    } catch {
      // Plugin missing (web/electron) — leave `visible` false.
    }
  }
}
