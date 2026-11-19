import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterNextRender, inject, input, output, signal,
} from '@angular/core';
import {
  SPLITTER_DEFAULTS, clampSideWidth, keyedSideWidth, readSideWidth, splitterRange, writeSideWidth,
} from './pane-splitter';

/**
 * `<pf-pane-splitter storageKey="pf-lms.<screen>.side-w.<user>" />` — the draggable divider between a two-panel
 * screen's side card and its main card (shared; Frontdesk first, owner 2026-11-19).
 *
 * Place it BETWEEN the two cards, inside the row that holds them. It writes the side card's width as `--pf-side-w`
 * on that row (its parent), so the screen's stylesheet sizes the side card with
 * `flex: 0 0 clamp(<min>px, var(--pf-side-w), <max>%)` — the stylesheet's own `--pf-side-w` is the default.
 *  - Drag (pointer events, mouse / touch / pen): live width, saved per user on release (localStorage, try/catch).
 *  - Keyboard: focusable `role="separator"`; ← / → move 16px (Shift ×4), End = widest, Home = reset.
 *  - Double-click (or Home) resets to the default (the saved width is forgotten).
 *  - The saved width is applied in ngOnInit — the same render pass as the cards — so the first paint already has it.
 *  - Touch: a 44px grab area around a 1px hairline; hidden below 1024px (the screens stack there).
 *  - No motion of its own beyond a colour change, and none of that under reduced motion.
 */
@Component({
  selector: 'pf-pane-splitter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'separator',
    tabindex: '0',
    'aria-orientation': 'vertical',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'now()',
    '[attr.aria-valuemin]': 'range().min',
    '[attr.aria-valuemax]': 'range().max',
    '[attr.data-dragging]': "dragging() ? 'true' : null",
    '[attr.title]': 'label() + " (double-click to reset)"',
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp($event)',
    '(pointercancel)': 'onUp($event)',
    '(lostpointercapture)': 'onUp($event)',
    '(dblclick)': 'reset()',
    '(keydown)': 'onKey($event)',
  },
  template: `<span class="pf-split__line" aria-hidden="true"></span><span class="pf-split__grip" aria-hidden="true"></span>`,
  styles: [`
    :host {
      display: none;
      position: relative;
      flex: 0 0 12px;
      align-self: stretch;
      cursor: col-resize;
      touch-action: none;
      outline: none;
      z-index: 2;
    }
    @media (min-width: 1024px) { :host { display: block; } }
    /* Touch: a 44px grab area that overlaps the cards' edges, so the visible gap stays 12px. */
    @media (pointer: coarse) { :host { flex-basis: 44px; margin: 0 -16px; } }
    .pf-split__line {
      position: absolute; top: 12px; bottom: 12px; left: 50%; width: 1px; transform: translateX(-50%);
      background: var(--pf-line, rgba(148, 163, 184, 0.35));
      transition: background-color 140ms ease, width 140ms ease;
    }
    .pf-split__grip {
      position: absolute; top: 50%; left: 50%; width: 4px; height: 32px; border-radius: 999px;
      transform: translate(-50%, -50%);
      background: var(--text-tertiary, #94a3b8); opacity: 0;
      transition: opacity 140ms ease, background-color 140ms ease;
    }
    :host(:hover) .pf-split__grip, :host(:focus-visible) .pf-split__grip, :host([data-dragging]) .pf-split__grip { opacity: 0.55; }
    :host(:focus-visible) .pf-split__line, :host([data-dragging]) .pf-split__line {
      width: 2px; background: var(--color-primary, #7c3aed);
    }
    :host([data-dragging]) .pf-split__grip, :host(:focus-visible) .pf-split__grip { background: var(--color-primary, #7c3aed); opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .pf-split__line, .pf-split__grip { transition: none; } }
  `],
})
export class PaneSplitterComponent implements OnInit {
  /** localStorage key — per screen AND per user (e.g. `pf-lms.frontdesk.side-w.<userId>`). */
  readonly storageKey = input.required<string>();
  /** Smallest side-card width, px. */
  readonly min = input(SPLITTER_DEFAULTS.min);
  /** Largest side-card width as a fraction of the row. */
  readonly maxFraction = input(SPLITTER_DEFAULTS.maxFraction);
  /** Which neighbour is the side card: the one before the splitter ('start') or after it ('end'). */
  readonly side = input<'start' | 'end'>('start');
  readonly label = input('Resize panels');

  /** The new width (px) after a drag / key; null = reset to the default. */
  readonly widthChange = output<number | null>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly dragging = signal(false);
  readonly now = signal<number | null>(null);
  readonly range = signal<{ min: number; max: number }>({ min: SPLITTER_DEFAULTS.min, max: SPLITTER_DEFAULTS.min });

  private pointerId: number | null = null;
  private startX = 0;
  private startW = 0;
  private bodySelect = '';

  constructor() {
    afterNextRender(() => {
      this.measure();
      const onResize = () => this.measure();
      window.addEventListener('resize', onResize);
      this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
    });
  }

  ngOnInit(): void {
    // Same render pass as the cards: the saved width is on the row before the first paint (no jump).
    const saved = readSideWidth(this.storageKey());
    if (saved !== null) this.apply(saved);
  }

  private bounds() { return { min: this.min(), maxFraction: this.maxFraction() }; }
  private row(): HTMLElement | null { return this.host.nativeElement.parentElement; }
  private sideEl(): HTMLElement | null {
    const h = this.host.nativeElement;
    return (this.side() === 'start' ? h.previousElementSibling : h.nextElementSibling) as HTMLElement | null;
  }
  private rowWidth(): number { return this.row()?.getBoundingClientRect().width ?? 0; }
  private sideWidth(): number { return this.sideEl()?.getBoundingClientRect().width ?? this.min(); }

  /** Refresh the ARIA numbers from the real layout. */
  measure(): void {
    const rw = this.rowWidth();
    this.range.set(splitterRange(rw, this.bounds()));
    const w = this.sideWidth();
    this.now.set(w > 0 ? Math.round(w) : null);
  }

  private apply(width: number | null): void {
    const row = this.row();
    if (!row) return;
    if (width === null) row.style.removeProperty('--pf-side-w');
    else row.style.setProperty('--pf-side-w', `${Math.round(width)}px`);
  }

  private commit(width: number | null): void {
    this.apply(width);
    writeSideWidth(this.storageKey(), width);
    this.widthChange.emit(width);
    this.measure();
  }

  /** Back to the stylesheet's default `--pf-side-w`; the saved width is forgotten. */
  reset(): void { this.commit(null); }

  onDown(ev: PointerEvent): void {
    if (ev.button !== undefined && ev.button !== 0) return;
    const el = this.host.nativeElement;
    try { el.setPointerCapture(ev.pointerId); } catch { /* synthetic events */ }
    this.pointerId = ev.pointerId;
    this.startX = ev.clientX;
    this.startW = this.sideWidth();
    this.dragging.set(true);
    this.bodySelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    ev.preventDefault();
  }

  onMove(ev: PointerEvent): void {
    if (this.pointerId !== ev.pointerId) return;
    const dx = (ev.clientX - this.startX) * (this.side() === 'start' ? 1 : -1);
    const w = clampSideWidth(this.startW + dx, this.rowWidth(), this.bounds());
    this.apply(w);
    this.now.set(w);
  }

  onUp(ev: PointerEvent): void {
    if (this.pointerId === null || (this.pointerId !== ev.pointerId && ev.type !== 'lostpointercapture')) return;
    const el = this.host.nativeElement;
    try { if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    this.pointerId = null;
    this.dragging.set(false);
    document.body.style.userSelect = this.bodySelect;
    const w = this.now();
    if (w !== null && Math.abs(w - this.startW) >= 1) this.commit(clampSideWidth(w, this.rowWidth(), this.bounds()));
  }

  onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Home') { ev.preventDefault(); this.reset(); return; }
    const sign = this.side() === 'start' ? 1 : -1;
    // For an 'end' side card the arrows still move the DIVIDER the way they point.
    const key = sign === 1 ? ev.key : ev.key === 'ArrowLeft' ? 'ArrowRight' : ev.key === 'ArrowRight' ? 'ArrowLeft' : ev.key;
    const next = keyedSideWidth(key, ev.shiftKey, this.sideWidth(), this.rowWidth(), this.bounds());
    if (next === null) return;
    ev.preventDefault();
    this.commit(next);
  }
}
