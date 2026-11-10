import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FeDialog, IconName, PfIconComponent } from '../kit';
import {
  CanvasBackground,
  CanvasLabel,
  CanvasMarker,
  CanvasPin,
  CanvasRegion,
  CanvasValue,
  DEFAULT_INKS,
  DEFAULT_MAX_PINS,
  INK_SIZES,
  INK_SIZE_NAMES,
  InkSizeName,
  InkStroke,
  LABEL_SIZE,
  MAX_LABELS,
  MAX_LABEL_CHARS,
  MAX_PINS,
  MAX_POINTS,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES,
  canvasId,
  inkName,
  renumberPins,
  storePoint,
  totalPoints,
} from './canvas-model';
import {
  Pt,
  View,
  clampView,
  fitView,
  hitRegion,
  hitRegionNear,
  labelAt,
  shapeCentre,
  strokesUnder,
  toPicture,
  toScreen,
  zoomAt,
} from './geometry';
import { CanvasHistory } from './history';
import { regionPath, strokePath } from './ink';
import { PointerRouter, capturePointer, readPointer } from './pointer';

export type CanvasTool = 'mark' | 'pen' | 'eraser' | 'pin' | 'text';

const TOOL_WORDS: Record<CanvasTool, { name: string; icon: IconName }> = {
  mark: { name: 'Mark areas', icon: 'tap' },
  pen: { name: 'Pen', icon: 'pen' },
  eraser: { name: 'Eraser', icon: 'eraser' },
  pin: { name: 'Pin', icon: 'map-pin' },
  text: { name: 'Text', icon: 'type' },
};

/** A finger that moves less than this (CSS px) is a tap. */
const TAP_SLOP = 10;

/**
 * The canvas engine's surface (plan §4): one component for every image kind.
 *
 *  - Ink is vector (perfect-freehand), rendered as SVG: sharp at any device
 *    pixel ratio and any zoom; Apple Pencil pressure, coalesced samples.
 *  - Palm rejection and gestures come from `PointerRouter`: pen draws,
 *    fingers pan / pinch once a pen is seen; mouse draws, Ctrl / ⌘ + wheel zooms.
 *  - Tools: Mark areas (tap a region), Pen, Eraser (whole strokes, never
 *    white paint), Pin (48px numbered pins), Text. Undo / redo, three
 *    thicknesses, four colours, Fit, Full screen (same picture, nothing lost).
 *  - Every finished action is ONE `changed` emit and one undo step.
 *
 * The kind decides what the answer means (regions = options with follow-ups,
 * pins' questions); this component only edits the picture.
 */
@Component({
  selector: 'fe-canvas',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fe-cv',
    '[class.fe-cv--full]': 'full()',
    '[class.fe-cv--disabled]': 'disabled()',
    '[attr.data-tool]': 'tool()',
    '(keydown)': 'onKey($event)',
    '[attr.tabindex]': 'full() ? -1 : null',
    '[attr.role]': "full() ? 'dialog' : null",
    '[attr.aria-label]': "full() ? label() + ', full screen' : null",
  },
  template: `
    @if (!disabled()) {
      <div class="fe-cv__bar" role="toolbar" [attr.aria-label]="label() + ': tools'">
        @if (tools().length > 1) {
          <div class="fe-cv__group" role="radiogroup" aria-label="Tool">
            @for (t of tools(); track t) {
              <button
                type="button"
                class="fe-cv__tool"
                role="radio"
                [attr.data-tool]="t"
                [attr.aria-checked]="tool() === t"
                [attr.aria-label]="words[t].name"
                (click)="pickTool(t)"
              >
                <pf-icon [name]="words[t].icon" [size]="22" />
                <span class="fe-cv__tool-txt">{{ words[t].name }}</span>
              </button>
            }
          </div>
        }
        @if (inksTool()) {
          <button
            type="button"
            class="fe-cv__tool fe-cv__style"
            data-act="style"
            [attr.aria-expanded]="trayOpen()"
            [attr.aria-label]="'Colour and thickness: ' + colorName(color()) + ', ' + sizeNames[sizeName()]"
            (click)="trayOpen.set(!trayOpen())"
          >
            <span class="fe-cv__dot" [attr.data-color]="color()" [style.background]="color()"></span>
          </button>
        }
        <span class="fe-cv__spacer"></span>
        <div class="fe-cv__group">
          <button
            type="button"
            class="fe-cv__tool"
            data-act="undo"
            aria-label="Undo"
            [disabled]="!canUndo()"
            (click)="undo()"
          >
            <pf-icon name="undo" [size]="22" />
          </button>
          <button
            type="button"
            class="fe-cv__tool"
            data-act="redo"
            aria-label="Redo"
            [disabled]="!canRedo()"
            (click)="redo()"
          >
            <pf-icon name="redo" [size]="22" />
          </button>
          @if (zoomed()) {
            <button type="button" class="fe-cv__tool" data-act="fit" aria-label="Fit the picture" (click)="fit()">
              <pf-icon name="zoom-fit" [size]="22" />
            </button>
          }
          <button
            type="button"
            class="fe-cv__tool"
            data-act="full"
            [attr.aria-label]="full() ? 'Close full screen' : 'Full screen'"
            [attr.aria-pressed]="full()"
            (click)="toggleFull()"
          >
            <pf-icon [name]="full() ? 'minimize' : 'maximize'" [size]="22" />
          </button>
        </div>
      </div>
      @if (trayOpen() && inksTool()) {
        <div class="fe-cv__tray" role="group" aria-label="Colour and thickness">
          <div class="fe-cv__group" role="radiogroup" aria-label="Colour">
            @for (c of palette(); track c) {
              <button
                type="button"
                class="fe-cv__swatch"
                role="radio"
                [attr.data-color]="c"
                [attr.aria-checked]="color() === c"
                [attr.aria-label]="colorName(c)"
                (click)="color.set(c)"
              >
                <span class="fe-cv__dot" [attr.data-color]="c" [style.background]="c"></span>
              </button>
            }
          </div>
          <div class="fe-cv__group" role="radiogroup" aria-label="Thickness">
            @for (s of sizes; track s) {
              <button
                type="button"
                class="fe-cv__swatch"
                role="radio"
                [attr.data-size]="s"
                [attr.aria-checked]="sizeName() === s"
                [attr.aria-label]="sizeNames[s]"
                (click)="sizeName.set(s)"
              >
                <span class="fe-cv__line" [attr.data-size]="s"></span>
              </button>
            }
          </div>
        </div>
      }
    }
    <div
      #surfaceEl
      class="fe-cv__surface"
      [style.aspect-ratio]="doc().w + ' / ' + doc().h"
      [attr.data-gesture]="gesture()"
      (pointerdown)="onDown($event)"
      (pointermove)="onMove($event)"
      (pointerup)="onUp($event)"
      (pointercancel)="onCancel($event)"
      (wheel)="onWheel($event)"
      (contextmenu)="$event.preventDefault()"
    >
      <svg
        class="fe-cv__svg"
        [attr.width]="box().w"
        [attr.height]="box().h"
        [attr.viewBox]="'0 0 ' + box().w + ' ' + box().h"
        role="img"
        [attr.aria-label]="summary()"
      >
        <g [attr.transform]="transform()">
          <rect class="fe-cv__paper" [class.is-doc]="!!imageUrl() && !artwork()" x="0" y="0" [attr.width]="doc().w" [attr.height]="doc().h" />
          @if (imageUrl(); as url) {
            <image
              class="fe-cv__image"
              [class.is-art]="artwork()"
              [attr.href]="url"
              x="0"
              y="0"
              [attr.width]="doc().w"
              [attr.height]="doc().h"
              preserveAspectRatio="xMidYMid meet"
            />
          }
          @for (r of regionPaths(); track r.key) {
            <path
              class="fe-cv__region"
              [class.is-marked]="marked().has(r.key)"
              [attr.data-region]="r.key"
              [attr.d]="r.d"
            />
          }
          @for (s of visibleInk(); track s.id) {
            <path
              class="fe-ink"
              [class.fe-ink--hl]="s.tool === 'highlighter'"
              [attr.data-color]="s.color"
              [attr.fill]="s.color"
              [attr.d]="pathOf(s)"
            />
          }
          @if (livePath(); as d) {
            <path class="fe-ink fe-ink--live" [attr.data-color]="color()" [attr.fill]="color()" [attr.d]="d" />
          }
          @for (l of doc().labels; track l.id) {
            <text class="fe-cv__label" [attr.x]="l.x" [attr.y]="l.y" [attr.font-size]="labelSize()">
              {{ l.text }}
            </text>
          }
          @if (eraserAt(); as e) {
            <circle class="fe-cv__eraser" [attr.cx]="e.x" [attr.cy]="e.y" [attr.r]="eraserRadius()" />
          }
        </g>
      </svg>
      @for (m of markers(); track m.key) {
        <button
          type="button"
          class="fe-cv__marker"
          [class.is-on]="m.on"
          [attr.data-marker]="m.key"
          [attr.aria-pressed]="m.on"
          [attr.aria-label]="m.label + (m.on ? ': marked. Tap to clear.' : ': tap to mark.')"
          [style.left.px]="markerScreen(m).x"
          [style.top.px]="markerScreen(m).y"
          [style.width.px]="m.size"
          [style.height.px]="m.size"
          [style.--fe-mk]="m.color ?? null"
          [disabled]="disabled()"
          (pointerdown)="$event.stopPropagation()"
          (click)="markerTapped.emit(m.key)"
        >
          <span class="fe-cv__marker-dot" aria-hidden="true"></span>
          <span class="fe-cv__marker-name">{{ m.label }}</span>
        </button>
      }
      @for (p of doc().pins; track p.id) {
        <button
          type="button"
          class="fe-cv__pin"
          [class.is-open]="openPin() === p.id"
          [attr.data-pin]="p.n"
          [style.left.px]="pinScreen(p).x"
          [style.top.px]="pinScreen(p).y"
          [attr.aria-label]="pinWords(p)"
          [disabled]="disabled() && !pinsOpenWhenDisabled()"
          (pointerdown)="$event.stopPropagation()"
          (click)="pinTapped.emit(p.id)"
        >
          <span class="fe-cv__pin-n">{{ p.n }}</span>
        </button>
      }
      @if (flash(); as f) {
        <span class="fe-cv__flash" role="status" [style.left.px]="f.x" [style.top.px]="f.y">{{ f.text }}</span>
      }
    </div>
  `,
})
export class CanvasComponent {
  private readonly dialog = inject(FeDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly value = input.required<CanvasValue>();
  readonly background = input<CanvasBackground>({ kind: 'blank' });
  readonly regions = input<readonly CanvasRegion[]>([]);
  readonly tools = input<readonly CanvasTool[]>(['pen', 'eraser', 'text']);
  readonly disabled = input(false);
  readonly label = input('Drawing');
  /** The pin whose questions are open (highlighted). */
  readonly openPin = input<string | null>(null);
  /** Let pins open their answers on a locked picture (read-only view). */
  readonly pinsOpenWhenDisabled = input(false);
  /** The pen's colours (`config.inkColors`), else black / red / blue / green. */
  readonly inks = input<readonly string[] | null>(null);
  /** Most pins (`config.maxPins`, default 30, at most 100). */
  readonly maxPins = input<number>(DEFAULT_MAX_PINS);
  /** bodyMap's fixed markers (picture units). */
  readonly markers = input<readonly CanvasMarker[]>([]);

  /** Every finished action: a stroke, an erase, a pin, a label, a region tap, undo / redo. */
  readonly changed = output<CanvasValue>();
  /** A pin was tapped (or just dropped): the kind opens its questions. */
  readonly pinTapped = output<string>();
  /** A fixed marker was tapped (the kind toggles it). */
  readonly markerTapped = output<string>();

  protected readonly words = TOOL_WORDS;
  protected readonly palette = computed(() => (this.inks()?.length ? this.inks()! : DEFAULT_INKS));
  protected readonly colorName = inkName;
  protected readonly sizes = Object.keys(INK_SIZES) as InkSizeName[];
  protected readonly sizeNames = INK_SIZE_NAMES;

  private readonly surfaceEl = viewChild.required<ElementRef<HTMLElement>>('surfaceEl');

  readonly tool = signal<CanvasTool>('pen');
  readonly color = signal<string>(DEFAULT_INKS[0]);
  readonly sizeName = signal<InkSizeName>('medium');
  protected readonly trayOpen = signal(false);
  readonly full = signal(false);

  /** The picture being edited (the input, or what this component last wrote). */
  readonly doc = signal<CanvasValue>({ w: 1000, h: 625, ink: [], pins: [], labels: [], regions: [] });
  private history = new CanvasHistory<CanvasValue>(this.doc());
  private lastEmitted: CanvasValue | null = null;
  private readonly steps = signal(0); // bumps on every history move (undo / redo buttons)
  protected readonly canUndo = computed(() => (this.steps(), this.history.canUndo));
  protected readonly canRedo = computed(() => (this.steps(), this.history.canRedo));

  readonly box = signal({ w: 0, h: 0 });
  private readonly userView = signal<View | null>(null);
  private readonly fitted = computed(() => fitView(this.doc().w, this.doc().h, this.box().w, this.box().h));
  readonly view = computed(() => this.userView() ?? this.fitted());
  protected readonly zoomed = computed(() => this.view().scale > this.fitted().scale * 1.01);
  protected readonly transform = computed(() => {
    const v = this.view();
    return `translate(${v.x} ${v.y}) scale(${v.scale})`;
  });

  // live stroke / eraser
  private live: { points: number[]; pen: boolean } | null = null;
  protected readonly livePath = signal<string | null>(null);
  private erasing: { last: Pt; removed: Set<string> } | null = null;
  protected readonly erased = signal<ReadonlySet<string>>(new Set());
  protected readonly eraserAt = signal<Pt | null>(null);
  private tapStart: { x: number; y: number; moved: number; pointerType: string } | null = null;
  protected readonly gesture = signal<string>('idle');
  protected readonly flash = signal<{ text: string; x: number; y: number } | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly router = new PointerRouter({
    strokeStart: (x, y, p, pen) => this.strokeStart(x, y, p, pen),
    strokeMove: (pts) => this.strokeMove(pts),
    strokeEnd: (keep) => this.strokeEnd(keep),
    pan: (dx, dy) => this.panBy(dx, dy),
    pinch: (k, cx, cy, dx, dy) => this.pinchBy(k, cx, cy, dx, dy),
  });

  protected readonly inksTool = computed(() => this.tool() === 'pen');
  protected readonly marked = computed(() => new Set(this.doc().regions));
  protected readonly visibleInk = computed(() => {
    const gone = this.erased();
    return gone.size ? this.doc().ink.filter((s) => !gone.has(s.id)) : this.doc().ink;
  });
  protected readonly imageUrl = computed(() => {
    const b = this.background();
    return b.kind === 'image' ? b.url : null;
  });
  /** A bundled starter drawing: paper and lines follow the theme (an uploaded picture or photo stays a white document). */
  protected readonly artwork = computed(() => {
    const b = this.background();
    return b.kind === 'image' && b.art === true;
  });
  protected readonly labelSize = computed(() => Math.round(this.doc().w * LABEL_SIZE * 10) / 10);
  protected readonly regionPaths = computed(() => this.regions().map((r) => ({ key: r.key, d: regionPath(r.shape) })));
  protected readonly eraserRadius = computed(() => this.doc().w * 0.02);

  protected readonly summary = computed(() => {
    const d = this.doc();
    const names = this.regions()
      .filter((r) => d.regions.includes(r.key))
      .map((r) => r.label);
    const bits = [
      d.ink.length ? `${d.ink.length} ${d.ink.length === 1 ? 'line' : 'lines'}` : '',
      d.pins.length ? `${d.pins.length} ${d.pins.length === 1 ? 'pin' : 'pins'}` : '',
      d.labels.length ? `${d.labels.length} ${d.labels.length === 1 ? 'label' : 'labels'}` : '',
      names.length ? `marked: ${names.join(', ')}` : '',
    ].filter(Boolean);
    return `${this.label()}${bits.length ? ' — ' + bits.join(', ') : ' — empty'}`;
  });

  private readonly paths = new WeakMap<InkStroke, string>();

  constructor() {
    // Adopt the stored picture; our own writes come back as the same object and are ignored.
    effect(() => {
      const v = this.value();
      untracked(() => {
        if (v === this.lastEmitted) return;
        this.history.reset(v);
        this.doc.set(v);
        this.steps.update((n) => n + 1);
      });
    });
    // The first allowed tool is where a doctor starts (a body map starts on "Mark areas", a drawing on the pen).
    let started = false;
    effect(() => {
      const ts = this.tools();
      untracked(() => {
        if (!started || !ts.includes(this.tool())) this.tool.set(ts[0] ?? 'pen');
        started = true;
      });
    });
    // a form's own palette: start on its first colour
    effect(() => {
      const pal = this.palette();
      untracked(() => {
        if (!pal.includes(this.color())) this.color.set(pal[0]);
      });
    });
    effect((onCleanup) => {
      const el = this.surfaceEl().nativeElement;
      const measure = () => {
        const r = el.getBoundingClientRect();
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (w !== this.box().w || h !== this.box().h) {
          this.box.set({ w, h });
          this.userView.set(null);
        }
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
    this.destroyRef.onDestroy(() => {
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.setPageLock(false);
      if (this.home) {
        this.home = null;
        this.host.nativeElement.remove();
      }
    });
  }

  // ---------- public API (kinds and tests) ----------

  undo(): void {
    this.apply(this.history.undo(), false);
  }

  redo(): void {
    this.apply(this.history.redo(), false);
  }

  pickTool(t: CanvasTool): void {
    this.tool.set(t);
    if (t !== 'pen') this.trayOpen.set(false);
  }

  fit(): void {
    this.userView.set(null);
  }

  toggleFull(): void {
    const on = !this.full();
    this.full.set(on);
    this.lift(on);
    this.setPageLock(on);
    this.userView.set(null);
    if (on) setTimeout(() => this.host.nativeElement.focus({ preventScroll: true }));
  }

  private home: { parent: Node; next: Node | null } | null = null;

  /**
   * Full screen lifts the canvas to <body> (a card, sheet or page animation with a transform
   * would otherwise be the box "position: fixed" is measured from) and puts it back after;
   * it is the same component, so nothing is lost.
   */
  private lift(on: boolean): void {
    const el = this.host.nativeElement;
    if (typeof document === 'undefined') return;
    if (on && el.parentNode && !this.home) {
      this.home = { parent: el.parentNode, next: el.nextSibling };
      document.body.appendChild(el);
    } else if (!on && this.home) {
      const { parent, next } = this.home;
      this.home = null;
      if (parent.isConnected) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
      else el.remove();
    }
  }

  /** Remove a pin (from the kind's pin panel). One undo step. */
  removePin(id: string): void {
    const d = this.doc();
    this.commit({ ...d, pins: renumberPins(d.pins.filter((p) => p.id !== id)) });
  }

  /** Change a pin (its label / answers). One undo step. */
  updatePin(id: string, patch: Partial<CanvasPin>): void {
    const d = this.doc();
    this.commit({ ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }

  /** Mark / unmark a region by key (the chips under the picture). */
  toggleRegion(key: string): void {
    const d = this.doc();
    const regions = d.regions.includes(key) ? d.regions.filter((k) => k !== key) : [...d.regions, key];
    this.commit({ ...d, regions });
  }

  // ---------- template helpers ----------

  protected pathOf(s: InkStroke): string {
    let d = this.paths.get(s);
    if (d === undefined) {
      d = strokePath(s);
      this.paths.set(s, d);
    }
    return d;
  }

  protected pinScreen(p: CanvasPin): Pt {
    return toScreen(this.view(), p.x, p.y);
  }

  protected pinWords(p: CanvasPin): string {
    const where = this.regions().find((r) => r.key === p.region)?.label;
    return [`Pin ${p.n}`, p.label, where ? `on ${where}` : ''].filter(Boolean).join(', ') + '. Open it.';
  }

  protected markerScreen(m: CanvasMarker): Pt {
    return toScreen(this.view(), m.x, m.y);
  }

  // ---------- pointer input ----------

  protected onDown(ev: PointerEvent): void {
    if (this.disabled()) return;
    ev.preventDefault();
    capturePointer(ev.currentTarget as Element, ev.pointerId);
    // tap tools work with a finger even after a pen was seen; drawing tools reject the palm
    const t = this.tool();
    this.router.fingerTaps = t === 'mark' || t === 'pin' || t === 'text';
    this.router.down(readPointer(ev, this.rect()));
    this.gesture.set(this.router.gesture);
  }

  protected onMove(ev: PointerEvent): void {
    if (this.disabled()) return;
    this.router.move(readPointer(ev, this.rect()));
  }

  protected onUp(ev: PointerEvent): void {
    if (this.disabled()) return;
    this.router.up(readPointer(ev, this.rect()));
    this.gesture.set(this.router.gesture);
  }

  protected onCancel(ev: PointerEvent): void {
    if (this.disabled()) return;
    this.router.cancel(readPointer(ev, this.rect()));
    this.gesture.set(this.router.gesture);
  }

  /** Ctrl / ⌘ + wheel (a trackpad pinch) zooms; in full screen the plain wheel zooms too. */
  protected onWheel(ev: WheelEvent): void {
    if (!(ev.ctrlKey || ev.metaKey || this.full())) return;
    ev.preventDefault();
    const r = this.rect();
    const k = Math.exp(-ev.deltaY * 0.0025);
    this.zoomBy(k, ev.clientX - r.left, ev.clientY - r.top);
  }

  protected onKey(ev: KeyboardEvent): void {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) this.redo();
      else this.undo();
    } else if (mod && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      this.redo();
    } else if (ev.key === 'Escape' && this.full()) {
      this.toggleFull();
    }
  }

  private rect(): { left: number; top: number } {
    return this.surfaceEl().nativeElement.getBoundingClientRect();
  }

  private pic(x: number, y: number): Pt {
    return toPicture(this.view(), x, y);
  }

  private strokeStart(x: number, y: number, pressure: number, pen: boolean): void {
    const t = this.tool();
    if (t === 'pen') {
      if (this.doc().ink.length >= MAX_STROKES || totalPoints(this.doc()) >= MAX_POINTS) {
        this.showFlash('This drawing is full: erase a line to add another', x, y);
        return;
      }
      const p = this.pic(x, y);
      this.live = { points: [...storePoint(p.x, p.y, pressure)], pen };
      this.renderLive();
    } else if (t === 'eraser') {
      const p = this.pic(x, y);
      this.erasing = { last: p, removed: new Set() };
      this.eraseTo(p);
    } else {
      this.tapStart = { x, y, moved: 0, pointerType: pen ? 'pen' : 'touch' };
    }
  }

  private strokeMove(pts: { x: number; y: number; pressure: number }[]): void {
    const t = this.tool();
    if (t === 'pen' && this.live) {
      for (const s of pts) {
        if (this.live.points.length >= Math.min(MAX_POINTS_PER_STROKE, MAX_POINTS - totalPoints(this.doc())) * 3) break;
        const p = this.pic(s.x, s.y);
        const n = this.live.points.length;
        // skip sub-pixel jitter (keeps the answer small)
        if (Math.hypot(p.x - this.live.points[n - 3], p.y - this.live.points[n - 2]) * this.view().scale < 0.75) continue;
        this.live.points.push(...storePoint(p.x, p.y, s.pressure));
      }
      this.renderLive();
    } else if (t === 'eraser' && this.erasing) {
      for (const s of pts) this.eraseTo(this.pic(s.x, s.y));
    } else if (this.tapStart) {
      const last = pts[pts.length - 1];
      const dx = last.x - this.tapStart.x;
      const dy = last.y - this.tapStart.y;
      this.tapStart.moved = Math.max(this.tapStart.moved, Math.hypot(dx, dy));
      if (this.tapStart.moved > TAP_SLOP && this.zoomed()) {
        // a drag with a tap tool moves the zoomed picture
        this.panBy(dx, dy);
        this.tapStart.x = last.x;
        this.tapStart.y = last.y;
      }
    }
  }

  private strokeEnd(keep: boolean): void {
    const t = this.tool();
    if (t === 'pen' && this.live) {
      const live = this.live;
      this.live = null;
      this.livePath.set(null);
      if (!keep || live.points.length < 3) return;
      const stroke: InkStroke = {
        id: canvasId(),
        color: this.color(),
        size: Math.round(this.doc().w * INK_SIZES[this.sizeName()] * 10) / 10,
        points: live.points,
        ...(live.pen ? { pen: true } : {}),
      };
      const d = this.doc();
      this.commit({ ...d, ink: [...d.ink, stroke] });
    } else if (t === 'eraser' && this.erasing) {
      const gone = this.erasing.removed;
      this.erasing = null;
      this.eraserAt.set(null);
      this.erased.set(new Set());
      if (!keep || gone.size === 0) return;
      const d = this.doc();
      this.commit({ ...d, ink: d.ink.filter((s) => !gone.has(s.id)) });
    } else if (this.tapStart) {
      const tap = this.tapStart;
      this.tapStart = null;
      if (keep && tap.moved <= TAP_SLOP) void this.tapAt(tap.x, tap.y);
    }
  }

  private renderLive(): void {
    const l = this.live;
    if (!l) return;
    this.livePath.set(
      strokePath({ points: l.points, size: this.doc().w * INK_SIZES[this.sizeName()], pen: l.pen }, false),
    );
  }

  private eraseTo(p: Pt): void {
    const e = this.erasing;
    if (!e) return;
    const hits = strokesUnder(this.doc().ink, e.last, p, this.eraserRadius());
    e.last = p;
    this.eraserAt.set(p);
    if (hits.size) {
      for (const id of hits) e.removed.add(id);
      this.erased.set(new Set(e.removed));
    }
  }

  private async tapAt(x: number, y: number): Promise<void> {
    const t = this.tool();
    const p = this.pic(x, y);
    const d = this.doc();
    if (p.x < 0 || p.y < 0 || p.x > d.w || p.y > d.h) return;
    if (t === 'mark') {
      const r = hitRegionNear(this.regions(), p, 14 / this.view().scale);
      if (!r) {
        this.showFlash('Tap inside an area to mark it', x, y);
        return;
      }
      const on = !d.regions.includes(r.key);
      this.toggleRegion(r.key);
      const c = toScreen(this.view(), shapeCentre(r.shape).x, shapeCentre(r.shape).y);
      this.showFlash(on ? r.label : `${r.label} cleared`, c.x, c.y);
    } else if (t === 'pin') {
      if (d.pins.length >= Math.min(MAX_PINS, this.maxPins())) {
        this.showFlash('No more pins on this picture', x, y);
        return;
      }
      const region = hitRegion(this.regions(), p);
      const pin: CanvasPin = {
        id: canvasId('p'),
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        n: d.pins.length + 1,
        ...(region ? { region: region.key } : {}),
      };
      this.commit({ ...d, pins: [...d.pins, pin] });
      this.pinTapped.emit(pin.id);
    } else if (t === 'text') {
      const hit = labelAt(d.labels, p, this.labelSize());
      const text = await this.dialog.prompt({
        title: hit ? 'Change the label' : 'Write a label',
        message: hit ? 'Clear the words to remove the label.' : undefined,
        placeholder: 'e.g. 3 cm scar',
        initialValue: hit?.text ?? '',
        confirmLabel: hit ? 'Save' : 'Add',
      });
      if (text === null) return;
      const words = text.trim().slice(0, MAX_LABEL_CHARS);
      const now = this.doc();
      if (hit) {
        this.commit({
          ...now,
          labels: words
            ? now.labels.map((l) => (l.id === hit.id ? { ...l, text: words } : l))
            : now.labels.filter((l) => l.id !== hit.id),
        });
      } else if (words && now.labels.length < MAX_LABELS) {
        const label: CanvasLabel = {
          id: canvasId('t'),
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          text: words,
        };
        this.commit({ ...now, labels: [...now.labels, label] });
      }
    }
  }

  private showFlash(text: string, x: number, y: number): void {
    this.flash.set({ text, x, y });
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 1400);
  }

  // ---------- view ----------

  private panBy(dx: number, dy: number): void {
    const v = this.view();
    const d = this.doc();
    this.userView.set(clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }, d.w, d.h, this.box().w, this.box().h));
  }

  private pinchBy(k: number, cx: number, cy: number, dx: number, dy: number): void {
    const d = this.doc();
    const z = zoomAt(this.view(), k, cx, cy, this.fitted());
    this.userView.set(clampView({ scale: z.scale, x: z.x + dx, y: z.y + dy }, d.w, d.h, this.box().w, this.box().h));
  }

  zoomBy(k: number, cx: number, cy: number): void {
    this.pinchBy(k, cx, cy, 0, 0);
  }

  // ---------- history ----------

  private commit(next: CanvasValue): void {
    this.history.push(next);
    this.apply(next, true);
  }

  private apply(next: CanvasValue, _fresh: boolean): void {
    this.steps.update((n) => n + 1);
    if (next === this.doc()) return;
    this.doc.set(next);
    this.lastEmitted = next;
    this.changed.emit(next);
  }

  /** While full screen, the page behind does not move. */
  private setPageLock(on: boolean): void {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('fe-cv-locked', on);
  }
}
