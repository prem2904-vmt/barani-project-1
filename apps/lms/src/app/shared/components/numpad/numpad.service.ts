import {
  ApplicationRef, ComponentRef, DestroyRef, EnvironmentInjector, Injectable, Injector, Type,
  createComponent, inject, signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ImpactStyle } from '@capacitor/haptics';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NUMPAD_SYMBOLS, NumpadChar, backspaceText, insertText } from './numpad-keys';
import { scrollParentOf } from './numpad-nav';
import { isTouchCapable, readTouchEnv } from './touch-capability';
import { KeyboardService } from '../../../core/services/keyboard.service';
import { PfKeysKind, PfKeysLayout, PfKeysPrefix, layoutStorageKey, layoutsFor, resolveLayout } from './pf-keys-layouts';

/** The live flag hint a screen already shows for the field (L / H / CL…). */
export interface NumpadFlag {
  tone: 'low' | 'high' | 'critical' | 'normal' | string;
  label: string;
}

/** What "Next" can do for a field (the screen's NumpadScopeDirective). */
export interface NumpadScopeLike {
  isLast(from: HTMLElement): boolean;
  advance(from: HTMLElement, opts?: { openPicker?: boolean }): 'field' | 'cta' | 'end';
}

/** A numeric result field the pad can type into (the pfNumpad directive). */
export interface NumpadField {
  readonly el: HTMLInputElement;
  readonly scope: NumpadScopeLike | null;
  keys(): ReadonlySet<NumpadChar>;
  label(): string;
  unit(): string | null;
  flag(): NumpadFlag | null;
  /** Fire the native `change` once if the pad edited the value (screens
   *  that save on change see exactly what a keyboard would give them). */
  flushChange(): void;
  markDirty(): void;
  /** Which surface serves the field: the result numpad (default) or PF Keys. */
  readonly kind?: 'numpad' | 'keys';
}

/** A SEARCH field served by PF Keys (the pfKeys directive). */
export interface PfKeysField extends NumpadField {
  readonly kind: 'keys';
  keysKind(): PfKeysKind;
  /** The field's own default layout (null = the kind's default). */
  defaultLayout(): PfKeysLayout | null;
  /** Primary key label ("Add", "Search", "Open"…) and its aria-label. */
  enterLabel(): string;
  enterAria(): string;
  /** What the primary key does: 'primary' (the violet CTA) or 'remove'
   *  (Enter takes the highlighted item OUT — neutral key, muted-red). */
  enterTone(): PfKeysEnterTone;
  /** The screen already moves a highlight with ↑/↓ → show arrow keys. */
  arrows(): boolean;
  /** Department prefix keys for the code pad. */
  prefixes(): PfKeysPrefix[];
  /** Escape hatch: THIS field uses the system keyboard until blur. */
  useSystemKeyboard(): void;
}

/** The primary key's look: the violet CTA, or a destructive-neutral Remove. */
export type PfKeysEnterTone = 'primary' | 'remove';

export function isKeysField(f: NumpadField | null | undefined): f is PfKeysField {
  return !!f && f.kind === 'keys';
}

/** Surface owners (one panel each, mounted lazily on <body>). */
export type PadSurface = 'numpad' | 'keys';
/** <html> class + CSS variable published while PF Keys is docked. */
export const PF_KEYS_OPEN_CLASS = 'pf-keys-open';
export const PF_KEYS_HEIGHT_VAR = '--pf-keys-h';
/** Window event fired when PF Keys opens / closes / changes height. */
export const PF_KEYS_EVENT = 'pf-keys:resize';
/** Elements marked with this attribute are the page host PF Keys pads (the
 *  shell's main scroller) so in-flow pages end right above the keys. */
export const PF_KEYS_HOST_ATTR = 'data-pf-keys-host';

/** Marker on every event the pad synthesises, so the directive can tell a
 *  pad press from a real (hardware) key. */
export const NUMPAD_EVENT = '__pfNumpad';

/** A tap that ends this far from where it started is a scroll, not a tap. */
const TAP_SLOP_PX = 12;
/** After Next, programmatic focus onto the next numeric field keeps the pad
 *  up (dropdowns / free text in between hand focus back later). */
const CHAIN_MS = 120_000;
/** A focus this soon after a finger touch counts as a touch focus. */
const TOUCH_FOCUS_MS = 1_000;
/** PF Keys: how long a blurred search field may take to get focus back
 *  (a tapped result row hands it straight back) before the keys close. */
const KEYS_REFOCUS_MS = 180;
/** Backspace held this long clears the whole field. */
export const LONG_PRESS_MS = 500;

/**
 * The ONE result numpad: a single overlay shared by every numeric result
 * field on touch devices (see docs/ND-PATTERN.md → 8. Touch → "Result numpad").
 *
 * - iPad / wide touch: a compact pad DOCKED in a bottom corner (right by
 *   default; the grip moves it left, remembered per user). It never moves
 *   while focus walks the fields — type, Enter, type, Enter — and the
 *   field being edited is scrolled clear of it.
 * - Phone: a bottom-docked sheet (safe-area aware); the page scrolls so the
 *   field stays visible above it.
 * - Desktop / fine pointer: never shown; fields behave exactly as before.
 */
@Injectable({ providedIn: 'root' })
export class NumpadService {
  private readonly doc = inject(DOCUMENT);
  private readonly appRef = inject(ApplicationRef);
  private readonly env = inject(EnvironmentInjector);
  private readonly capacitor = inject(CapacitorService, { optional: true });
  private readonly injector = inject(Injector);
  private cornerLoadedFor: string | null = null;

  /** Coarse (touch) primary pointer — the only place the pad exists. */
  readonly touch = signal(false);
  readonly reducedMotion = signal(false);

  readonly current = signal<NumpadField | null>(null);
  readonly open = signal(false);
  readonly mode = signal<'corner' | 'sheet' | 'dock'>('corner');
  /** PF Keys: the layout on screen for the current search field. */
  readonly keysLayout = signal<PfKeysLayout>('qwerty');
  /** Which bottom corner the docked (wide-screen) pad sits in. */
  readonly corner = signal<'right' | 'left'>('right');
  /** Mirrors the field while the pad is up (header echo). */
  readonly value = signal('');
  /** Keys this field shows. */
  readonly keys = signal<ReadonlySet<NumpadChar>>(new Set());
  /** Symbol keys the field's own validator would accept RIGHT NOW. */
  readonly accepts = signal<ReadonlySet<NumpadChar>>(new Set());
  /** Last field in the list → the primary key reads "Done". */
  readonly isLast = signal(false);
  /** Brief "not accepted" pulse on a key. */
  readonly rejected = signal<string | null>(null);

  private readonly panelRefs = new Map<Type<unknown>, ComponentRef<unknown>>();
  private readonly surfaces: Record<PadSurface, HTMLElement | null> = { numpad: null, keys: null };
  /** The surface of whatever is showing now (for focus containment). */
  private get panelEl(): HTMLElement | null {
    return this.surfaces[isKeysField(this.current()) ? 'keys' : 'numpad'];
  }
  private keysChrome = false;
  private keysChromeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTouchAt = 0;
  /** A real finger touch was seen: this device is touch-capable for good. */
  private touchSeen = false;
  private chainUntil = 0;
  private tapCandidate = false;
  private tapX = 0;
  private tapY = 0;
  private layoutQueued = false;
  private padded: { el: HTMLElement; prev: string; prio?: string } | null = null;
  private rejectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const view = this.doc.defaultView;
    if (!view) return;
    const mq = (q: string, set: (v: boolean) => void) => {
      if (typeof view.matchMedia !== 'function') return;
      const m = view.matchMedia(q);
      set(!!m.matches);
      m.addEventListener?.('change', e => set(e.matches));
    };
    // Touch-capable = native shell / touch points / ANY coarse pointer (see
    // touch-capability.ts — an iPad with a trackpad reports pointer: fine).
    const recheck = () => {
      const v = isTouchCapable(readTouchEnv(view)) || this.touchSeen;
      this.touch.set(v);
      if (!v) this.hide();
    };
    recheck();
    for (const q of ['(pointer: coarse)', '(any-pointer: coarse)']) {
      try { view.matchMedia?.(q).addEventListener?.('change', recheck); } catch { /* old engines */ }
    }
    mq('(prefers-reduced-motion: reduce)', v => this.reducedMotion.set(v));

    const onDown = (e: PointerEvent) => this.onPointerDown(e);
    const onUp = (e: PointerEvent) => this.onPointerUp(e);
    const onMove = () => this.queueLayout();
    this.doc.addEventListener('pointerdown', onDown, true);
    this.doc.addEventListener('pointerup', onUp, true);
    view.addEventListener('scroll', onMove, true);
    view.addEventListener('resize', onMove);
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('pointerdown', onDown, true);
      this.doc.removeEventListener('pointerup', onUp, true);
      view.removeEventListener('scroll', onMove, true);
      view.removeEventListener('resize', onMove);
      for (const ref of this.panelRefs.values()) ref.destroy();
      this.panelRefs.clear();
      this.dropKeysChrome();
    });
  }

  // ── Overlay host ────────────────────────────────────────────────────
  /** Mount the panel once, at the end of <body> (called by the directive,
   *  which owns the panel import — keeps this file free of a cycle). */
  ensurePanel(panel: Type<unknown>): void {
    if (this.panelRefs.has(panel)) return;
    const ref = createComponent(panel, { environmentInjector: this.env });
    this.appRef.attachView(ref.hostView);
    this.doc.body.appendChild(ref.location.nativeElement);
    this.panelRefs.set(panel, ref);
  }

  /** A pad's surface element (for measuring + focus containment). */
  registerSurface(el: HTMLElement | null, owner: PadSurface = 'numpad'): void {
    this.surfaces[owner] = el;
    if (el) this.queueLayout();
  }

  // ── Field lifecycle (from the directive) ───────────────────────────
  /** A numpad field got focus: show the pad when the focus came from a
   *  finger, or from Next (the chain). Programmatic / Tab focus doesn't. */
  focused(f: NumpadField): void {
    if (!this.touch()) return;
    const now = Date.now();
    if (now - this.lastTouchAt < TOUCH_FOCUS_MS || now < this.chainUntil) this.show(f);
  }

  /** A finger / pen touched the screen: decided per tap, not only at init
   *  (so a device the environment check missed still gets the pad). */
  markTouch(): void {
    this.lastTouchAt = Date.now();
    if (!this.touchSeen) { this.touchSeen = true; this.touch.set(true); }
  }

  /** A finger tapped an already-focused field: bring the pad back. */
  tapped(f: NumpadField): void {
    if (!this.touch()) return;
    this.lastTouchAt = Date.now();
    if (this.doc.activeElement === f.el) this.show(f);
  }

  blurred(f: NumpadField): void {
    // PF Keys: a tap on a result row / chip moves focus away for a moment and
    // the screen hands it straight back — wait for that before closing.
    const delay = isKeysField(f) ? KEYS_REFOCUS_MS : 0;
    setTimeout(() => {
      f.flushChange();
      if (this.current() !== f) return;
      const a = this.doc.activeElement;
      if (a === f.el || (a && this.panelEl?.contains(a))) {
        // A screen reader moved focus onto a key: keep the field in charge.
        if (a !== f.el) f.el.focus({ preventScroll: true });
        return;
      }
      this.hide();
    }, delay);
  }

  /** A real (hardware) key reached the field: typing works as always and
   *  the pad steps aside. */
  hardwareKey(f: NumpadField): void {
    this.chainUntil = 0;
    if (this.current() === f) this.hide();
  }

  released(f: NumpadField): void {
    if (this.current() === f) this.hide();
  }

  show(f: NumpadField): void {
    this.loadCorner();
    const prev = this.current();
    if (isKeysField(f) && (prev !== f || !this.open())) this.keysLayout.set(this.loadLayout(f));
    this.current.set(f);
    if (!isKeysField(f) && this.keysChrome) { this.dropKeysChrome(); this.unpadIfKeys(); }
    this.refresh();
    this.cancelUnpad();
    this.open.set(true);            // already open → stays put, only the field changes
    this.queueLayout();
  }

  hide(): void {
    this.open.set(false);
    this.current.set(null);
    this.unpadSoon();
  }

  // ── PF Keys (search fields on tablets) ──────────────────────────────
  private layoutKey(kind: PfKeysKind): string {
    let id = 'anon';
    try {
      const u = this.injector.get(AuthService, null)?.user?.();
      id = u?.id || u?.authId || 'anon';
    } catch { /* no auth in this context */ }
    return layoutStorageKey(id, kind);
  }

  private loadLayout(f: PfKeysField): PfKeysLayout {
    let remembered: string | null = null;
    try { remembered = this.doc.defaultView?.localStorage.getItem(this.layoutKey(f.keysKind())) ?? null; } catch { /* storage off */ }
    return resolveLayout(f.keysKind(), remembered, f.defaultLayout());
  }

  /** 123 / ABC: switch the layout and remember it (per user, per kind). */
  setLayout(layout: PfKeysLayout): void {
    const f = this.current();
    if (!isKeysField(f) || !layoutsFor(f.keysKind()).includes(layout)) return;
    this.keysLayout.set(layout);
    try { this.doc.defaultView?.localStorage.setItem(this.layoutKey(f.keysKind()), layout); } catch { /* storage off */ }
    this.haptic();
    this.queueLayout();
  }

  /** The field's kind changed while it is up (order create: Tests → Patient). */
  rekey(f: PfKeysField): void {
    if (this.current() !== f || !this.open()) return;
    this.keysLayout.set(this.loadLayout(f));
    this.queueLayout();
  }

  /** ↑ / ↓: move the screen's OWN highlight (only offered where it exists). */
  arrow(dir: 1 | -1): void {
    const f = this.current();
    if (!f) return;
    f.el.dispatchEvent(this.key(dir > 0 ? 'ArrowDown' : 'ArrowUp', true));
    this.haptic();
  }

  /** The keyboard key: this field switches to the system keyboard. */
  systemKeyboard(): void {
    const f = this.current();
    if (!isKeysField(f)) return;
    this.chainUntil = 0;
    this.hide();
    f.useSystemKeyboard();
  }

  /** Publish the docked height (CSS var + class on <html>), hide the bottom
   *  navbar like any keyboard, and pad the page host so in-flow pages end
   *  right above the keys. */
  private applyKeysChrome(h: number): void {
    if (this.keysChromeTimer) { clearTimeout(this.keysChromeTimer); this.keysChromeTimer = null; }
    const root = this.doc.documentElement;
    const prev = root.style.getPropertyValue(PF_KEYS_HEIGHT_VAR);
    root.style.setProperty(PF_KEYS_HEIGHT_VAR, `${h}px`);
    root.classList.add(PF_KEYS_OPEN_CLASS);
    if (!this.keysChrome) {
      this.keysChrome = true;
      this.keyboardSvc()?.setInAppKeyboard?.(true);
    }
    if (prev !== `${h}px`) this.doc.defaultView?.dispatchEvent(new Event(PF_KEYS_EVENT));
  }

  private dropKeysChrome(): void {
    if (this.keysChromeTimer) { clearTimeout(this.keysChromeTimer); this.keysChromeTimer = null; }
    if (!this.keysChrome) return;
    this.keysChrome = false;
    const root = this.doc.documentElement;
    root.style.removeProperty(PF_KEYS_HEIGHT_VAR);
    root.classList.remove(PF_KEYS_OPEN_CLASS);
    this.keyboardSvc()?.setInAppKeyboard?.(false);
    this.doc.defaultView?.dispatchEvent(new Event(PF_KEYS_EVENT));
  }

  private keyboardSvc(): KeyboardService | null {
    try { return this.injector.get(KeyboardService, null); } catch { return null; }
  }

  /** The Hide key: pad away, chain over, field keeps focus (tap it again). */
  dismiss(): void {
    this.chainUntil = 0;
    const f = this.current();
    this.hide();
    f?.el.focus({ preventScroll: true });
  }

  // ── Keys ─────────────────────────────────────────────────────────────
  /** Type one character — ONLY if the field's own keydown validator lets it
   *  through (the same rules a keyboard meets; nothing new is invented). */
  press(ch: NumpadChar | string): boolean {
    const f = this.current();
    if (!f || !ch) return false;
    this.bumpChain();
    // A prefix key types several characters: each one meets the validator.
    for (const c of ch) {
      if (!this.offer(f.el, c)) {
        this.flashReject(ch);
        return false;
      }
    }
    const el = f.el;
    const sel = this.selection(el);
    const edit = insertText(el.value, sel.start, sel.end, ch);
    this.write(f, edit.value, edit.caret);
    this.haptic();
    return true;
  }

  backspace(): void {
    const f = this.current();
    if (!f) return;
    this.bumpChain();
    if (!this.offer(f.el, 'Backspace')) return;
    const sel = this.selection(f.el);
    const edit = backspaceText(f.el.value, sel.start, sel.end);
    if (edit.value === f.el.value) return;
    this.write(f, edit.value, edit.caret);
    this.haptic();
  }

  /** Long-press on backspace. */
  clear(): void {
    const f = this.current();
    if (!f || f.el.value === '') return;
    this.bumpChain();
    if (!this.offer(f.el, 'Backspace')) return;
    this.write(f, '', 0);
    this.haptic(ImpactStyle.Medium);
  }

  /** Next (or Done on the last field). */
  next(): void {
    const f = this.current();
    if (!f) return;
    f.flushChange();
    this.chainUntil = Date.now() + CHAIN_MS;
    this.haptic();
    if (!f.scope) {
      // No scope on this screen: the field's own Enter handler decides.
      f.el.dispatchEvent(this.key('Enter', true));
      return;
    }
    const res = f.scope.advance(f.el, { openPicker: true });
    if (res !== 'field') {
      this.chainUntil = 0;
      if (this.current() === f) this.hide();
      if (res === 'end') f.el.blur();
    }
  }

  // ── Internals ────────────────────────────────────────────────────────
  /** Runs after EVERY key press: keep it cheap — signals only change
   *  when their content does (no re-render of every key per press). */
  private refresh(): void {
    const f = this.current();
    if (!f) return;
    this.value.set(f.el.value ?? '');
    const shown = f.keys();
    if (!sameSet(this.keys(), shown)) this.keys.set(shown);
    const ok = new Set<NumpadChar>();
    for (const s of NUMPAD_SYMBOLS) if (shown.has(s) && this.offer(f.el, s)) ok.add(s);
    if (!sameSet(this.accepts(), ok)) this.accepts.set(ok);
    this.isLast.set(f.scope ? f.scope.isLast(f.el) : false);
  }

  /** Re-read the field (value / accepted keys) — e.g. after a hardware
   *  edit or a screen rewriting the value. The label / unit / flag are the
   *  directive's signal inputs, read live by the panel. */
  sync(f: NumpadField): void {
    if (this.current() === f && this.open()) this.refresh();
  }

  private key(key: string, bubbles = false): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key, bubbles, cancelable: true });
    (ev as unknown as Record<string, boolean>)[NUMPAD_EVENT] = true;
    return ev;
  }

  /** Replay a key through the field's own keydown listeners (not bubbling,
   *  so page-level shortcuts never see pad presses). */
  private offer(el: HTMLInputElement, key: string): boolean {
    const ev = this.key(key);
    el.dispatchEvent(ev);
    return !ev.defaultPrevented;
  }

  private selection(el: HTMLInputElement): { start: number | null; end: number | null } {
    try {
      return { start: el.selectionStart, end: el.selectionEnd };
    } catch {
      return { start: null, end: null };
    }
  }

  private write(f: NumpadField, value: string, caret: number): void {
    const el = f.el;
    el.value = value;
    try { el.setSelectionRange(caret, caret); } catch { /* no selection API */ }
    f.markDirty();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (this.doc.activeElement !== el) el.focus({ preventScroll: true });
    this.refresh();
  }

  private bumpChain(): void {
    this.chainUntil = Date.now() + CHAIN_MS;
  }

  private flashReject(ch: string): void {
    this.rejected.set(ch);
    if (this.rejectTimer) clearTimeout(this.rejectTimer);
    this.rejectTimer = setTimeout(() => this.rejected.set(null), 360);
  }

  private haptic(style: ImpactStyle = ImpactStyle.Light): void {
    try { void this.capacitor?.impact?.(style)?.catch?.(() => {}); } catch { /* no haptics */ }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') this.markTouch();
    this.tapCandidate = false;
    if (!this.open()) return;
    const t = e.target as Element | null;
    if (!t || this.panelEl?.contains(t) || this.current()?.el === t || t.closest?.('[data-pf-numpad], [data-pf-keys]')) return;
    this.tapCandidate = true;
    this.tapX = e.clientX;
    this.tapY = e.clientY;
  }

  /** A genuine tap outside the pad and the field closes the pad (like a
   *  keyboard's tap-away); taps on other controls just move focus. */
  private onPointerUp(e: PointerEvent): void {
    if (!this.tapCandidate) return;
    this.tapCandidate = false;
    if (Math.hypot(e.clientX - this.tapX, e.clientY - this.tapY) > TAP_SLOP_PX) return;
    const f = this.current();
    if (!f) return;
    this.chainUntil = 0;
    const t = e.target as Element | null;
    const interactive = !!t?.closest?.('input, textarea, select, button, a[href], label, [role="button"], [role="combobox"], [tabindex]');
    // PF Keys: a tap on a result row / chip acts on the search and the
    // screen keeps the field focused — the keys stay (blur decides).
    if (isKeysField(f) && interactive) return;
    this.hide();
    if (!interactive) f.el.blur();
  }

  private queueLayout(): void {
    if (!this.open() || this.layoutQueued) return;
    const view = this.doc.defaultView;
    if (!view) return;
    this.layoutQueued = true;
    const run = () => { this.layoutQueued = false; this.layoutNow(); };
    if (typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(run);
    else setTimeout(run);
  }

  /** Dock the pad and lift the field clear of it (sync; specs call it). */
  layoutNow(): void {
    const f = this.current();
    const view = this.doc.defaultView;
    if (!f || !this.open() || !view) return;
    const vw = view.visualViewport?.width ?? view.innerWidth;
    const vh = view.visualViewport?.height ?? view.innerHeight;
    if (isKeysField(f)) {
      // PF Keys: docked full width at the bottom, like a keyboard.
      this.mode.set('dock');
      const keys = this.panelEl;
      if (!keys) return;
      const kh = keys.offsetHeight || 0;
      if (!kh) return;
      this.applyKeysChrome(kh);
      this.reveal(f.el, kh, vh - kh, true);
      return;
    }
    // Tablet / wide: a fixed corner. Phone: the bottom sheet.
    this.mode.set(vw >= 700 && vh >= 500 ? 'corner' : 'sheet');
    const surface = this.panelEl;
    if (!surface) return;
    // From layout, not the (animating) rect: the entrance transform would
    // report the pad lower than where it settles.
    const bottom = parseFloat(view.getComputedStyle(surface).bottom) || 0;
    const h = surface.offsetHeight || 0;
    const padTop = vh - bottom - h;
    this.reveal(f.el, bottom + h, padTop);
  }

  // ── Corner (per user) ───────────────────────────────────────────────
  private cornerKey(): string {
    let id = 'anon';
    try {
      const u = this.injector.get(AuthService, null)?.user?.();
      id = u?.id || u?.authId || 'anon';
    } catch { /* no auth in this context */ }
    return `pf-numpad-corner:${id}`;
  }

  private loadCorner(): void {
    const key = this.cornerKey();
    if (this.cornerLoadedFor === key) return;
    this.cornerLoadedFor = key;
    try {
      const v = this.doc.defaultView?.localStorage.getItem(key);
      this.corner.set(v === 'left' ? 'left' : 'right');
    } catch { this.corner.set('right'); }
  }

  /** The grip: swap bottom-right ⇄ bottom-left (left-handed techs). */
  toggleCorner(): void {
    const next = this.corner() === 'right' ? 'left' : 'right';
    this.corner.set(next);
    try { this.doc.defaultView?.localStorage.setItem(this.cornerKey(), next); } catch { /* storage off */ }
    this.current()?.el.focus({ preventScroll: true });
  }

  /** Keep the field above the docked pad: pad the scroller so even the
   *  last row can scroll clear, then scroll just enough. `limitY` is the
   *  pad's top edge in viewport px. */
  private reveal(el: HTMLElement, sheetH: number, limitY: number, keys = false): void {
    if (!sheetH) return;
    // PF Keys pads the page host (the shell's scroller) so a fixed-height
    // page ends right above the keys; `!important` because the shell's own
    // keyboard rule zeroes that padding while any keyboard is up.
    const host = keys ? el.closest<HTMLElement>(`[${PF_KEYS_HOST_ATTR}]`) : null;
    const scroller = host ?? scrollParentOf(el);
    if (!scroller) {
      // No page scroller to pad: just bring the field into view.
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return;
    }
    const pad = keys ? `${sheetH}px` : `${sheetH + 16}px`;
    if (!this.padded || this.padded.el !== scroller) {
      this.unpad();
      this.padded = { el: scroller, prev: scroller.style.paddingBottom, prio: scroller.style.getPropertyPriority('padding-bottom') };
    }
    if (keys) scroller.style.setProperty('padding-bottom', pad, 'important');
    else if (scroller.style.paddingBottom !== pad) scroller.style.paddingBottom = pad;
    const r = el.getBoundingClientRect();
    const limit = limitY - 12;
    let dy = 0;
    if (r.bottom > limit) dy = r.bottom - limit;
    else if (r.top < 12) dy = r.top - 12;
    if (dy) {
      const smooth = !this.reducedMotion();
      if (typeof scroller.scrollBy === 'function') {
        scroller.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'auto' });
      } else {
        scroller.scrollTop += dy;
      }
    }
  }

  private unpadTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelUnpad(): void {
    if (this.unpadTimer) { clearTimeout(this.unpadTimer); this.unpadTimer = null; }
  }
  /** Keep the list padding across a short hop (dropdown in between) so the
   *  page doesn't jump; drop it once the pad has really gone. */
  private unpadSoon(): void {
    this.cancelUnpad();
    this.unpadTimer = setTimeout(() => { this.unpadTimer = null; if (!this.open()) this.unpad(); }, 800);
    // PF Keys chrome (height var, navbar) goes back as soon as the keys have
    // really gone — a focus hop that brings them straight back keeps it.
    if (this.keysChrome && !this.keysChromeTimer) {
      this.keysChromeTimer = setTimeout(() => {
        this.keysChromeTimer = null;
        if (!this.open() || !isKeysField(this.current())) {
          this.dropKeysChrome();
          this.unpadIfKeys();
        }
      }, KEYS_REFOCUS_MS);
    }
  }

  /** The keys' host padding goes with the keys (not 800ms later: the page
   *  would sit short of the screen bottom with nothing below it). */
  private unpadIfKeys(): void {
    if (this.padded && this.padded.el.style.getPropertyPriority('padding-bottom') === 'important' && this.padded.prio !== 'important') this.unpad();
  }

  private unpad(): void {
    if (!this.padded) return;
    const { el, prev, prio } = this.padded;
    if (prio) el.style.setProperty('padding-bottom', prev, prio);
    else if (el.style.getPropertyPriority('padding-bottom')) { el.style.removeProperty('padding-bottom'); if (prev) el.style.paddingBottom = prev; }
    else el.style.paddingBottom = prev;
    this.padded = null;
  }
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** PF Keys and the result numpad share ONE engine: the same service. */
export { NumpadService as PfKeysService };
