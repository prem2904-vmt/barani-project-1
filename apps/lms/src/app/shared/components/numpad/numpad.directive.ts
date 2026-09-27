import { DestroyRef, Directive, ElementRef, computed, effect, inject, input, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NumpadChar, parseKeySet } from './numpad-keys';
import { focusTargetOf, navigableFields, nextField } from './numpad-nav';
import { NUMPAD_EVENT, NumpadField, NumpadFlag, NumpadScopeLike, NumpadService } from './numpad.service';
import { NumpadPanelComponent } from './numpad-panel.component';

/**
 * The screen's result list, for "Next": which fields count and where the
 * primary CTA is. Put it on the element that wraps the results.
 *
 *   <div pfNumpadScope="input.pf-sre__ginput, .pf-sre__gselect .pf-dd__trigger"
 *        pfNumpadCta=".pf-sre-submit">
 *
 * Next walks the fields DOWN the list (document order), skipping hidden,
 * disabled, read-only and `data-numpad-skip` (calculated) fields. A dropdown
 * in between is focused and opened; after the choice the screen's own
 * "advance after select" continues and the pad comes back on the next
 * numeric field. Past the last field the CTA gets focus.
 */
@Directive({
  selector: '[pfNumpadScope]',
  standalone: true,
})
export class NumpadScopeDirective implements NumpadScopeLike {
  /** CSS selector for the result fields (markers or focus targets). */
  readonly pfNumpadScope = input<string>('');
  /** CSS selector for the screen's Submit / Save CTA (the visible one wins;
   *  looked up in the scope first, then the page). */
  readonly pfNumpadCta = input<string | null>(null);

  private readonly host = inject(ElementRef).nativeElement as HTMLElement;
  private readonly doc = inject(DOCUMENT);

  private selector(): string {
    return this.pfNumpadScope() || '[data-pf-numpad]';
  }

  fields(): HTMLElement[] {
    return navigableFields(this.host, this.selector());
  }

  isLast(from: HTMLElement): boolean {
    return nextField(this.fields(), from) === null;
  }

  cta(): HTMLElement | null {
    const sel = this.pfNumpadCta();
    if (!sel) return null;
    const pick = (root: ParentNode) => {
      const all = Array.from(root.querySelectorAll<HTMLElement>(sel));
      return all.find(b => b.getClientRects().length > 0) ?? all[0] ?? null;
    };
    return pick(this.host) ?? pick(this.doc);
  }

  advance(from: HTMLElement, opts: { openPicker?: boolean } = {}): 'field' | 'cta' | 'end' {
    const next = nextField(this.fields(), from);
    if (next) {
      focusField(next, !!opts.openPicker);
      return 'field';
    }
    const cta = this.cta();
    if (cta && !(cta as HTMLButtonElement).disabled) {
      cta.focus({ preventScroll: true });
      cta.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return 'cta';
    }
    return 'end';
  }
}

/** Focus a field the way Enter always has (select the text, keep it in
 *  view); a dropdown trigger also opens when the pad asked for it. */
export function focusField(el: HTMLElement, openPicker = false): void {
  const target = focusTargetOf(el) ?? el;
  target.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number')) {
    try { target.select(); } catch { /* no selection API */ }
  }
  target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  if (openPicker && target.matches('.pf-dd__trigger, [aria-haspopup="listbox"], [role="combobox"]')) {
    // After the Next tap has finished: opening inside it would let the same
    // click reach the dropdown's outside-click listener and shut it again.
    setTimeout(() => { if (target.ownerDocument.activeElement === target) target.click(); });
  }
}

const NON_TYPING_KEYS = new Set([
  'Unidentified', 'Process', 'Dead', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock',
  'Fn', 'FnLock', 'Hyper', 'Super', 'OS', 'AltGraph', 'NumLock', 'ScrollLock',
]);
/** A real typed key (not a modifier alone or an IME placeholder). */
export function isTypedKey(e: KeyboardEvent): boolean {
  return !!e.key && !NON_TYPING_KEYS.has(e.key);
}

/**
 * `pfNumpad` — a numeric result field that uses the in-app numpad on touch
 * devices. Desktop / fine pointers: nothing changes (no attribute touched).
 *
 * Touch-capable devices (touch-capability.ts: Capacitor native shell,
 * maxTouchPoints, any coarse pointer — an iPad in desktop-UA mode with a
 * trackpad included), and any field a finger touches (applied on
 * pointerdown, before iOS focuses it): the system keyboard is suppressed
 * with `inputmode="none"` — the
 * field stays a real, editable text box (caret, selection, screen-reader
 * semantics, hardware keyboards and Scribble all still work); `readonly` is
 * never used. A `type="number"` field becomes `type="text"` on touch so
 * partial values like "1." or "-" survive while typing.
 *
 * Every pad key is first replayed as a keydown through the field's OWN
 * validator (e.g. `allowOnlyNumbers`) and only lands if accepted — the
 * validation rules stay exactly as they are.
 */
@Directive({
  selector: 'input[pfNumpad]',
  standalone: true,
  host: {
    'data-pf-numpad': '',
    '(focus)': 'onFocus()',
    '(blur)': 'onBlur()',
    '(pointerdown)': 'onPointerDown($event)',
    '(keydown)': 'onKeydown($event)',
    '(input)': 'onInput()',
    '(change)': 'dirty = false',
  },
})
export class NumpadDirective implements NumpadField {
  /** Off (`[pfNumpad]="false"`) for read-only views. */
  readonly pfNumpad = input(true, { transform: (v: boolean | '' | null | undefined) => v !== false && v !== null });
  /** Keys to show: `null` = all; e.g. "digits ." for a size in mm. */
  readonly pfNumpadKeys = input<string | null>(null);
  readonly pfNumpadLabel = input<string | null>(null);
  readonly pfNumpadUnit = input<string | null>(null);
  readonly pfNumpadFlag = input<NumpadFlag | null | undefined>(null);

  readonly el = inject(ElementRef).nativeElement as HTMLInputElement;
  readonly scope: NumpadScopeLike | null = inject(NumpadScopeDirective, { optional: true });
  private readonly svc = inject(NumpadService);

  private readonly keySet = computed(() => parseKeySet(this.pfNumpadKeys()));
  /** Pad mode: enabled AND a touch device. */
  readonly active = computed(() => this.pfNumpad() && this.svc.touch());

  dirty = false;
  private saved: { inputmode: string | null; type: string } | null = null;

  constructor() {
    effect(() => {
      const on = this.active();
      untracked(() => this.applyMode(on));
    });
    inject(DestroyRef).onDestroy(() => {
      this.svc.released(this);
      this.applyMode(false);
    });
  }

  keys(): ReadonlySet<NumpadChar> { return this.keySet(); }
  label(): string {
    return this.pfNumpadLabel() || this.el.getAttribute('aria-label') || this.el.getAttribute('placeholder') || 'Result';
  }
  unit(): string | null { return this.pfNumpadUnit() || null; }
  flag(): NumpadFlag | null { return this.pfNumpadFlag() ?? null; }
  markDirty(): void { this.dirty = true; }
  flushChange(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private applyMode(on: boolean): void {
    const el = this.el;
    if (on && !this.saved) {
      this.saved = { inputmode: el.getAttribute('inputmode'), type: el.type };
      el.setAttribute('inputmode', 'none');
      if (el.type === 'number') el.type = 'text';
      el.setAttribute('autocomplete', 'off');
      this.svc.ensurePanel(NumpadPanelComponent);
    } else if (!on && this.saved) {
      const s = this.saved;
      this.saved = null;
      if (s.inputmode == null) el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', s.inputmode);
      if (el.type !== s.type) el.type = s.type;
      this.svc.released(this);
    }
  }

  onFocus(): void {
    if (this.active()) this.svc.focused(this);
  }

  onBlur(): void {
    if (this.active()) this.svc.blurred(this);
    else this.flushChange();
  }

  onPointerDown(e: PointerEvent): void {
    if (!this.pfNumpad()) return;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    // A finger on the field: iOS reads inputmode when focus lands (right
    // after this event), so suppress the system keyboard NOW, synchronously
    // — not on the next change-detection pass.
    this.svc.markTouch();
    this.applyMode(true);
    this.svc.tapped(this);
  }

  onKeydown(e: KeyboardEvent): void {
    if ((e as unknown as Record<string, unknown>)[NUMPAD_EVENT]) return;
    // A key actually TYPED on a hardware keyboard: real typing, the pad
    // steps aside (tapping the field brings it back). An attached-but-idle
    // keyboard — or a lone modifier / IME placeholder event — changes nothing.
    if (this.active() && isTypedKey(e)) this.svc.hardwareKey(this);
  }

  onInput(): void {
    if (this.active()) this.svc.sync(this);
  }
}
