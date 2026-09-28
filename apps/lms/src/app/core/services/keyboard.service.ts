import { Injectable, NgZone, inject, signal } from '@angular/core';
import { PlatformService } from './platform.service';

/**
 * Tracks the on-screen (soft) keyboard's visibility so chrome can react to it —
 * e.g. the floating bottom-nav hides while the user is typing, and the messages
 * composer drops its nav-clearance padding so it sits right above the keyboard.
 *
 * WHY THREE SIGNALS (and not just @capacitor/keyboard):
 * On a real iOS device in a WKWebView the @capacitor/keyboard
 * keyboardWillShow/Hide events proved unreliable — depending on resize mode,
 * focus path and timing they sometimes never fire, so the nav stayed up. There
 * is no single trustworthy signal, so we fuse three and treat the keyboard as
 * "up" if ANY of them says so, and "down" only when they all agree:
 *
 *   (a) window.visualViewport — the authoritative "the keyboard is actually
 *       occupying screen space" measure. Keyboard is up when the gap between
 *       the largest layout-viewport height we've seen and the current visual
 *       viewport (height + offsetTop) exceeds a threshold. We re-baseline the
 *       reference height whenever the keyboard is down, so resize:'native'
 *       (where the whole WebView shrinks) and device rotation both stay correct.
 *   (b) focusin/focusout on editable elements — the FAST trigger. Fires the
 *       instant a textarea/input gains focus, before the viewport settles, so
 *       the nav hides without a visible flash. Debounced on blur so focus
 *       hopping between two fields doesn't flicker.
 *   (c) @capacitor/keyboard events — kept as a third corroborating signal.
 *
 * ZONE HANDLING: visualViewport events aren't reliably patched by Zone.js and
 * the Capacitor plugin callbacks fire OUTSIDE Angular's zone — so every commit
 * of the `visible` signal runs inside zone.run, otherwise OnPush views (the
 * bottom-nav) never re-check and the nav fails to hide. Listeners themselves
 * are registered with runOutsideAngular so high-frequency scroll/resize events
 * don't thrash change detection; we only enter the zone when `visible` flips.
 *
 * Gated to native (Capacitor) OR coarse-pointer (touch) hosts so a desktop
 * browser — where there's no virtual keyboard to dodge — is never affected.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private readonly platform = inject(PlatformService);
  private readonly zone = inject(NgZone);

  /** True while the soft keyboard is on screen (native / touch only). */
  readonly visible = signal(false);

  private _wired = false;

  // Per-source latches. The committed `visible` is the OR of all three.
  private capUp = false;     // @capacitor/keyboard says the keyboard is up
  private vvUp = false;      // visualViewport gap exceeds the threshold
  private focusUp = false;   // an editable element currently holds focus
  private inAppUp = false;  // PF Keys (the in-app search keypad) is docked

  /**
   * Reference "full" layout-viewport height (keyboard down) to measure the gap
   * against. With resize:'native' the whole WebView — and thus
   * window.innerHeight — shrinks when the keyboard opens, so we can't read the
   * full height live. Instead we snapshot it whenever the keyboard is down
   * (and re-snapshot, which also handles rotation).
   */
  private baseInnerH = 0;

  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pixels of viewport the keyboard must eat before we count it as "up". */
  private static readonly THRESHOLD = 120;
  /** Debounce blur so focus hopping between editables doesn't flicker. */
  private static readonly BLUR_DEBOUNCE_MS = 150;

  constructor() {
    this.wire();
  }

  private wire(): void {
    if (this._wired || typeof window === 'undefined') return;

    // Gate: native OR a coarse-pointer (touch) host. Desktop browsers — where
    // there is no soft keyboard — are left entirely alone (visible stays false).
    const coarsePointer =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!this.platform.isCapacitor() && !coarsePointer) return;

    this._wired = true;
    this.baseInnerH = window.innerHeight;

    // Register listeners outside Angular — they fire often (esp. vv scroll);
    // commit() re-enters the zone only when `visible` actually changes.
    this.zone.runOutsideAngular(() => {
      const vv = window.visualViewport;
      if (vv) {
        const onVv = () => this.onViewport();
        vv.addEventListener('resize', onVv);
        vv.addEventListener('scroll', onVv);
      }
      // Layout-viewport resize (rotation, native keyboard resize) — keeps the
      // reference height fresh even on hosts without visualViewport.
      window.addEventListener('resize', () => this.onViewport());

      // Capture phase so we see focus changes on any nested editable.
      window.addEventListener('focusin', (e) => this.onFocusIn(e), true);
      window.addEventListener('focusout', () => this.onFocusOut(), true);

      // Tap-outside dismissal (see onPointerDown/onPointerUp).
      window.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
      window.addEventListener('pointerup', (e) => this.onPointerUp(e), true);
      window.addEventListener('pointercancel', () => { this.tapCandidate = false; }, true);
    });

    void this.wireCapacitor();
  }

  // ── (a) visualViewport ────────────────────────────────────────────────
  private onViewport(): void {
    const vv = window.visualViewport;
    if (!vv) return;

    // Re-baseline the full height whenever the keyboard is down. focusUp is set
    // synchronously on focusin (before the viewport shrinks), so once the user
    // is in a field we freeze the pre-keyboard height; the moment they blur it
    // re-snapshots — which also tracks device rotation correctly.
    if (!this.focusUp && !this.capUp) {
      this.baseInnerH = window.innerHeight;
    }

    const gap = this.baseInnerH - vv.height - vv.offsetTop;
    const nextVvUp = gap > KeyboardService.THRESHOLD;
    if (nextVvUp !== this.vvUp) {
      this.vvUp = nextVvUp;
      this.commit();
    }
  }

  // ── (b) focusin / focusout ─────────────────────────────────────────────
  private onFocusIn(e: Event): void {
    if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
    if (!this.isEditable(e.target as Element | null)) return;
    if (!this.focusUp) { this.focusUp = true; this.commit(); }
  }

  private onFocusOut(): void {
    // focusout fires BEFORE the next focusin when focus hops between fields, so
    // debounce and re-check the live active element before declaring it closed.
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (this.isEditable(document.activeElement)) return; // still typing
      if (this.focusUp) { this.focusUp = false; this.commit(); }
    }, KeyboardService.BLUR_DEBOUNCE_MS);
  }

  /** An element that, when focused, summons the soft keyboard. */
  private isEditable(el: Element | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const input = el as HTMLInputElement;
      if (input.readOnly) return false;
      // The result numpad's fields (inputmode="none" / pfNumpad): iOS raises
      // no system keyboard for them, so focusing one is NOT "keyboard up" —
      // the bottom bar and page layout stay as they are. Only the viewport /
      // Capacitor keyboard signals can say otherwise.
      if (input.getAttribute('inputmode') === 'none' || input.hasAttribute('data-pf-numpad')) return false;
      // (A PF Keys search field is marked `data-pf-keys`; while it uses the
      // keys its inputmode is "none" — caught above. Switched to the system
      // keyboard (escape hatch) it is a normal field again and counts.)
      // Non-text input types don't raise a keyboard.
      const noKeyboard = new Set([
        'checkbox', 'radio', 'button', 'submit', 'reset',
        'range', 'color', 'file', 'image', 'hidden',
      ]);
      return !noKeyboard.has(input.type);
    }
    return false;
  }

  // ── Tap-outside dismissal ──────────────────────────────────────────────
  // WKWebView (and Android WebView) never dismiss the soft keyboard when the
  // user taps empty space — unlike every native app. So: a genuine TAP (not a
  // scroll drag) on anything that is neither an editable nor an interactive
  // control blurs the focused field and hides the keyboard. Matters most on
  // iPad, where the keyboard otherwise squats over half the work area.
  private tapCandidate = false;
  private tapX = 0;
  private tapY = 0;

  /** Movement beyond this is a scroll/drag, not a tap — leave the keyboard. */
  private static readonly TAP_SLOP_PX = 12;

  private onPointerDown(e: PointerEvent): void {
    this.tapCandidate = false;
    if (!this.visible()) return;
    const target = e.target as Element | null;
    if (!target || this.keepsKeyboard(target)) return;
    this.tapCandidate = true;
    this.tapX = e.clientX;
    this.tapY = e.clientY;
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.tapCandidate) return;
    this.tapCandidate = false;
    if (Math.hypot(e.clientX - this.tapX, e.clientY - this.tapY) > KeyboardService.TAP_SLOP_PX) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.isEditable(active)) active.blur();
    void this.hideNativeKeyboard();
  }

  /**
   * Taps that must NOT dismiss: another editable (focus hop), and interactive
   * controls that act on the focused field — send/save buttons, chips, pickers,
   * labels (which focus their input). `data-keep-keyboard` is the escape hatch
   * for any custom widget that needs the exemption.
   */
  private keepsKeyboard(target: Element): boolean {
    return !!target.closest(
      'input, textarea, select, button, a[href], label, [contenteditable="true"], ' +
      '[role="button"], [role="option"], [role="menuitem"], [role="tab"], ' +
      '[role="listbox"], [role="combobox"], [data-keep-keyboard]'
    );
  }

  private async hideNativeKeyboard(): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.hide();
    } catch {
      // Plugin missing (web/electron) — blur alone closes the keyboard there.
    }
  }

  // ── (c) @capacitor/keyboard ────────────────────────────────────────────
  private async wireCapacitor(): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.addListener('keyboardWillShow', () => { this.capUp = true; this.commit(); });
      await Keyboard.addListener('keyboardWillHide', () => { this.capUp = false; this.commit(); });
    } catch {
      // Plugin missing (web/electron) — the other two signals carry it.
    }
  }

  /**
   * Force every latch down and re-commit. Call when a view that owns an input
   * tears down (e.g. a chat thread closes): iOS sometimes never fires
   * keyboardWillHide, leaving `capUp` stuck true → `visible` stuck true → the
   * bottom-nav stays hidden on the screen you returned to. This guarantees a
   * clean "keyboard down" state; if a field is genuinely still focused the
   * focus/viewport signals will immediately raise it again.
   */
  reset(): void {
    if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
    this.capUp = false;
    this.vvUp = false;
    this.focusUp = false;
    this.inAppUp = false;
    if (typeof window !== 'undefined') this.baseInnerH = window.innerHeight;
    this.commit();
  }

  /**
   * PF Keys (shared/components/numpad → pfKeys) docks full-width at the
   * bottom like a keyboard: while it is up the app treats it as one — the
   * docked navbar steps aside and the shell drops its nav clearance (the
   * keys publish their own height as `--pf-keys-h`). The corner result
   * numpad never calls this: it floats above the bar.
   */
  setInAppKeyboard(up: boolean): void {
    if (up === this.inAppUp) return;
    this.inAppUp = up;
    this.commit();
  }

  // ── Commit ─────────────────────────────────────────────────────────────
  /**
   * Keyboard is "up" if ANY signal says so, "down" only when all agree. Re-enter
   * Angular's zone only on an actual change so OnPush chrome reacts without
   * change-detection thrash on every scroll/resize tick.
   */
  private commit(): void {
    const up = this.capUp || this.vvUp || this.focusUp || this.inAppUp;
    if (up === this.visible()) return;
    this.zone.run(() => this.visible.set(up));
  }
}
