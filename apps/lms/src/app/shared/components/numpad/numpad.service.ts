import {
  ApplicationRef, ComponentRef, DestroyRef, EnvironmentInjector, Injectable, Type,
  createComponent, inject, signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ImpactStyle } from '@capacitor/haptics';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { NUMPAD_SYMBOLS, NumpadChar, backspaceText, insertText } from './numpad-keys';
import { placePopover, PopoverSpot, scrollParentOf } from './numpad-nav';

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
}

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
/** Backspace held this long clears the whole field. */
export const LONG_PRESS_MS = 500;

/**
 * The ONE result numpad: a single overlay shared by every numeric result
 * field on touch devices (see docs/ND-PATTERN.md → 8. Touch → "Result numpad").
 *
 * - iPad / wide touch: a popover next to the focused field (below, above,
 *   right, left — never over it).
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

  /** Coarse (touch) primary pointer — the only place the pad exists. */
  readonly touch = signal(false);
  readonly reducedMotion = signal(false);

  readonly current = signal<NumpadField | null>(null);
  readonly open = signal(false);
  readonly mode = signal<'popover' | 'sheet'>('popover');
  readonly spot = signal<PopoverSpot | null>(null);
  /** Mirrors the field while the pad is up (header echo). */
  readonly value = signal('');
  /** Keys this field shows. */
  readonly keys = signal<ReadonlySet<NumpadChar>>(new Set());
  /** Symbol keys the field's own validator would accept RIGHT NOW. */
  readonly accepts = signal<ReadonlySet<NumpadChar>>(new Set());
  /** Last field in the list → the primary key reads "Done". */
  readonly isLast = signal(false);
  /** Brief "not accepted" pulse on a key. */
  readonly rejected = signal<NumpadChar | null>(null);

  private panelRef: ComponentRef<unknown> | null = null;
  private panelEl: HTMLElement | null = null;
  private lastTouchAt = 0;
  private chainUntil = 0;
  private tapCandidate = false;
  private tapX = 0;
  private tapY = 0;
  private layoutQueued = false;
  private padded: { el: HTMLElement; prev: string } | null = null;
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
    mq('(pointer: coarse)', v => { this.touch.set(v); if (!v) this.hide(); });
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
      this.panelRef?.destroy();
    });
  }

  // ── Overlay host ────────────────────────────────────────────────────
  /** Mount the panel once, at the end of <body> (called by the directive,
   *  which owns the panel import — keeps this file free of a cycle). */
  ensurePanel(panel: Type<unknown>): void {
    if (this.panelRef) return;
    const ref = createComponent(panel, { environmentInjector: this.env });
    this.appRef.attachView(ref.hostView);
    this.doc.body.appendChild(ref.location.nativeElement);
    this.panelRef = ref;
  }

  /** The pad's surface element (for measuring + focus containment). */
  registerSurface(el: HTMLElement | null): void {
    this.panelEl = el;
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

  /** A finger tapped an already-focused field: bring the pad back. */
  tapped(f: NumpadField): void {
    if (!this.touch()) return;
    this.lastTouchAt = Date.now();
    if (this.doc.activeElement === f.el) this.show(f);
  }

  blurred(f: NumpadField): void {
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
    });
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
    const was = this.current();
    this.current.set(f);
    this.refresh();
    if (!this.open() || was !== f) {
      this.spot.set(null);          // measured before it becomes visible
      this.open.set(true);
    }
    this.queueLayout();
  }

  hide(): void {
    this.open.set(false);
    this.current.set(null);
    this.spot.set(null);
    this.unpad();
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
  press(ch: NumpadChar): boolean {
    const f = this.current();
    if (!f) return false;
    this.bumpChain();
    if (!this.offer(f.el, ch)) {
      this.flashReject(ch);
      return false;
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
  private refresh(): void {
    const f = this.current();
    if (!f) return;
    this.value.set(f.el.value ?? '');
    const shown = f.keys();
    this.keys.set(shown);
    const ok = new Set<NumpadChar>();
    for (const s of NUMPAD_SYMBOLS) if (shown.has(s) && this.offer(f.el, s)) ok.add(s);
    this.accepts.set(ok);
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

  private flashReject(ch: NumpadChar): void {
    this.rejected.set(ch);
    if (this.rejectTimer) clearTimeout(this.rejectTimer);
    this.rejectTimer = setTimeout(() => this.rejected.set(null), 360);
  }

  private haptic(style: ImpactStyle = ImpactStyle.Light): void {
    try { void this.capacitor?.impact?.(style)?.catch?.(() => {}); } catch { /* no haptics */ }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') this.lastTouchAt = Date.now();
    this.tapCandidate = false;
    if (!this.open()) return;
    const t = e.target as Element | null;
    if (!t || this.panelEl?.contains(t) || this.current()?.el === t || t.closest?.('[data-pf-numpad]')) return;
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

  /** Position the pad for the current field (sync; specs call it). */
  layoutNow(): void {
    const f = this.current();
    const view = this.doc.defaultView;
    if (!f || !this.open() || !view) return;
    const vw = view.visualViewport?.width ?? view.innerWidth;
    const vh = view.visualViewport?.height ?? view.innerHeight;
    const wide = vw >= 700 && vh >= 500;
    const surface = this.panelEl;
    const r = f.el.getBoundingClientRect();
    if (wide && surface) {
      this.mode.set('popover');
      const spot = placePopover(
        { top: r.top, left: r.left, width: r.width, height: r.height },
        { width: surface.offsetWidth || 264, height: surface.offsetHeight || 330 },
        { width: vw, height: vh },
      );
      if (spot) {
        this.unpad();
        this.spot.set(spot);
        return;
      }
    }
    // Phone (or nowhere to float): dock at the bottom and lift the field.
    this.mode.set('sheet');
    this.spot.set({ top: 0, left: 0, placement: 'below' });
    this.reveal(f.el, surface?.offsetHeight ?? 0, vh);
  }

  /** Keep the field above the docked sheet: pad the scroller so even the
   *  last row can scroll clear, then scroll just enough. */
  private reveal(el: HTMLElement, sheetH: number, vh: number): void {
    if (!sheetH) return;
    const scroller = scrollParentOf(el);
    if (!this.padded || this.padded.el !== scroller) {
      this.unpad();
      this.padded = { el: scroller, prev: scroller.style.paddingBottom };
      scroller.style.paddingBottom = `${sheetH + 16}px`;
    }
    const r = el.getBoundingClientRect();
    const limit = vh - sheetH - 12;
    let dy = 0;
    if (r.bottom > limit) dy = r.bottom - limit;
    else if (r.top < 12) dy = r.top - 12;
    if (dy) {
      const smooth = !this.reducedMotion();
      if (scroller === this.doc.scrollingElement || scroller === this.doc.documentElement) {
        this.doc.defaultView?.scrollBy?.({ top: dy, behavior: smooth ? 'smooth' : 'auto' });
      } else if (typeof scroller.scrollBy === 'function') {
        scroller.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'auto' });
      } else {
        scroller.scrollTop += dy;
      }
    }
  }

  private unpad(): void {
    if (!this.padded) return;
    this.padded.el.style.paddingBottom = this.padded.prev;
    this.padded = null;
  }
}
