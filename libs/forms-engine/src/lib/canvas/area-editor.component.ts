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
import { FeDialog, PfIconComponent } from '../kit';
import { ApplyFieldChange } from '../build/contract';
import { FieldDef } from '../core/types';
import { FE_ASSETS } from '../fill/contract';
import { CanvasComponent } from './canvas.component';
import { CanvasValue, RegionShape, emptyCanvas } from './canvas-model';
import { Pt, fitView, hitRegion, shapeCentre, toPicture, toScreen } from './geometry';
import { regionPath } from './ink';
import { pictureConfig, pictureMarkers, resolvePicture } from './picture';
import {
  addArea,
  addMarker,
  moveMarker,
  ovalPoints,
  removeArea,
  removeMarker,
  renameArea,
  renameMarker,
  setAreaPoints,
  setAreaSentence,
  setMarkerSays,
} from './picture-edits';
import { capturePointer } from './pointer';

type Mode = 'select' | 'poly' | 'oval' | 'marker' | 'try';

/**
 * Studio, full screen: the picture with its areas (and a body map's fixed
 * markers). Tap an area to select it: its name and its sentence ("Pain over
 * the {region}") are written in a card right on the area, like the sentence
 * on a question card. On an uploaded picture or a blank sheet, areas are
 * drawn here (tap round the edge, or drag an oval) and reshaped by their
 * corner handles; a starter picture's areas keep their shape and only take
 * new words. "Markers" places a body map's tap markers (each one of the
 * question's choices, so its follow-ups are set up under Choices). "Try it"
 * is the doctor's view. Every change is one Studio edit (undoable there).
 */
@Component({
  selector: 'fe-area-editor',
  standalone: true,
  imports: [PfIconComponent, CanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fe-areas',
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': "'Areas of ' + field().label",
    '(keydown.escape)': 'escape()',
  },
  template: `
    <div class="fe-areas__bar" role="toolbar" aria-label="Areas">
      <div class="fe-cv__group" role="radiogroup" aria-label="What a tap does">
        <button type="button" class="fe-cv__tool" role="radio" data-mode="select" [attr.aria-checked]="mode() === 'select'" (click)="setMode('select')">
          <pf-icon name="tap" [size]="22" /><span class="fe-cv__tool-txt">Select</span>
        </button>
        @if (!starter()) {
          <button type="button" class="fe-cv__tool" role="radio" data-mode="poly" [attr.aria-checked]="mode() === 'poly'" (click)="setMode('poly')">
            <pf-icon name="shape" [size]="22" /><span class="fe-cv__tool-txt">Draw an area</span>
          </button>
          <button type="button" class="fe-cv__tool" role="radio" data-mode="oval" [attr.aria-checked]="mode() === 'oval'" (click)="setMode('oval')">
            <pf-icon name="ellipse" [size]="22" /><span class="fe-cv__tool-txt">Oval</span>
          </button>
        }
        @if (allowMarkers()) {
          <button type="button" class="fe-cv__tool" role="radio" data-mode="marker" [attr.aria-checked]="mode() === 'marker'" (click)="setMode('marker')">
            <pf-icon name="map-pin" [size]="22" /><span class="fe-cv__tool-txt">Markers</span>
          </button>
        }
        <button type="button" class="fe-cv__tool" role="radio" data-mode="try" [attr.aria-checked]="mode() === 'try'" (click)="setMode('try')">
          <pf-icon name="eye" [size]="22" /><span class="fe-cv__tool-txt">Try it</span>
        </button>
      </div>
      <span class="fe-cv__spacer"></span>
      <span class="fe-areas__count">{{ areas().length }} {{ areas().length === 1 ? 'area' : 'areas' }}</span>
      <button type="button" class="pf-btn pf-btn--primary" data-act="done" (click)="closed.emit()">Done</button>
    </div>
    <p class="fe-areas__hint" role="status">{{ hint() }}</p>
    @if (pic(); as p) {
      @if (mode() === 'try') {
        <fe-canvas
          class="fe-areas__try"
          [value]="tryDoc()"
          [background]="p.background"
          [regions]="p.regions"
          [tools]="p.regions.length ? ['mark'] : ['pin']"
          [markers]="tryMarkers()"
          [label]="field().label"
          (changed)="tryDoc.set($event)"
          (markerTapped)="toggleTry($event)"
        />
      } @else {
        <div
          #surfaceEl
          class="fe-areas__surface"
          [attr.data-mode]="mode()"
          (pointerdown)="down($event)"
          (pointermove)="move($event)"
          (pointerup)="up($event)"
          (pointercancel)="cancelDrag()"
        >
          <svg class="fe-cv__svg" [attr.width]="box().w" [attr.height]="box().h" aria-hidden="true">
            <g [attr.transform]="transform()">
              <rect class="fe-cv__paper" x="0" y="0" [attr.width]="p.w" [attr.height]="p.h" />
              @if (p.background.kind === 'image' && p.background.url) {
                <image [attr.href]="p.background.url" x="0" y="0" [attr.width]="p.w" [attr.height]="p.h" />
              }
              @for (r of shown(); track r.key) {
                <path class="fe-area" [class.is-selected]="r.key === selected()" [attr.data-area]="r.key" [attr.d]="r.d" />
              }
              @if (draftPath(); as d) {
                <path class="fe-area fe-area--draft" [attr.d]="d" />
              }
            </g>
          </svg>
          @for (r of shown(); track r.key) {
            <span class="fe-areas__name" [class.is-selected]="r.key === selected()" [style.left.px]="r.c.x" [style.top.px]="r.c.y">{{ r.label }}</span>
          }
          @for (m of markerSpots(); track m.key) {
            <button
              type="button"
              class="fe-areas__handle fe-areas__marker"
              [class.is-selected]="m.key === selectedMarker()"
              [attr.data-marker]="m.key"
              [style.left.px]="m.x"
              [style.top.px]="m.y"
              [attr.aria-label]="m.label + ': drag to move, tap to edit'"
              (pointerdown)="grabMarker($event, m.key)"
            >
              <span class="fe-areas__marker-name">{{ m.label }}</span>
            </button>
          }
          @for (h of handles(); track h.i) {
            <button
              type="button"
              class="fe-areas__handle"
              [attr.data-handle]="h.i"
              [style.left.px]="h.x"
              [style.top.px]="h.y"
              [attr.aria-label]="'Corner ' + (h.i + 1) + ': drag to move'"
              (pointerdown)="grab($event, h.i)"
            ></button>
          }
          @for (q of draftDots(); track $index; let i = $index) {
            <button
              type="button"
              class="fe-areas__handle fe-areas__handle--draft"
              [class.is-first]="i === 0"
              [style.left.px]="q.x"
              [style.top.px]="q.y"
              [attr.aria-label]="i === 0 ? 'First point: tap to close the area' : 'Point ' + (i + 1)"
              (pointerdown)="$event.stopPropagation()"
              (click)="i === 0 && draft().length >= 3 ? finishPoly() : null"
            ></button>
          }
          @if (card(); as c) {
            <div class="fe-areas__card" data-area-card [style.left.px]="c.x" [style.top.px]="c.y" (pointerdown)="$event.stopPropagation()">
              <label class="fe-sub">
                <span class="fe-sub__lbl">Name</span>
                <input class="fe-text__input" type="text" data-area-name maxlength="80" [value]="c.label" (change)="rename(c.key, $any($event.target).value)" />
              </label>
              <label class="fe-sub">
                <span class="fe-sub__lbl">Says, when marked</span>
                <input
                  class="fe-text__input"
                  type="text"
                  data-area-says
                  maxlength="200"
                  [value]="c.says"
                  placeholder="e.g. Pain over the {region}"
                  (change)="says(c.key, $any($event.target).value)"
                />
              </label>
              <span class="fe-areas__note">“&#123;region&#125;” is the area’s name and “&#123;note&#125;” the doctor’s note on it. Left empty, it joins “Marked over …”.</span>
              <div class="fe-img__acts">
                @if (!starter()) {
                  <button type="button" class="pf-btn pf-btn--secondary" data-act="remove-area" (click)="remove(c.key)">
                    <pf-icon name="trash" [size]="18" />
                    Remove
                  </button>
                }
                <button type="button" class="pf-btn pf-btn--secondary" data-act="close-card" (click)="selected.set(null)">Close</button>
              </div>
            </div>
          }
          @if (markerCard(); as c) {
            <div class="fe-areas__card" data-marker-card [style.left.px]="c.x" [style.top.px]="c.y" (pointerdown)="$event.stopPropagation()">
              <label class="fe-sub">
                <span class="fe-sub__lbl">Name</span>
                <input class="fe-text__input" type="text" data-marker-name [value]="c.label" (change)="renameMk(c.key, $any($event.target).value)" />
              </label>
              <label class="fe-sub">
                <span class="fe-sub__lbl">Says, when tapped</span>
                <input class="fe-text__input" type="text" data-marker-says [value]="c.says" [placeholder]="c.label.toLowerCase()" (change)="saysMk(c.key, $any($event.target).value)" />
              </label>
              <span class="fe-areas__note">Its follow-up questions are under Choices in the question’s settings.</span>
              <div class="fe-img__acts">
                <button type="button" class="pf-btn pf-btn--secondary" data-act="remove-marker" (click)="removeMk(c.key)">
                  <pf-icon name="trash" [size]="18" />
                  Remove
                </button>
                <button type="button" class="pf-btn pf-btn--secondary" (click)="selectedMarker.set(null)">Close</button>
              </div>
            </div>
          }
        </div>
        @if (mode() === 'poly' && draft().length) {
          <div class="fe-img__acts fe-areas__draft-acts">
            <button type="button" class="pf-btn pf-btn--secondary" data-act="undo-point" (click)="draft.set(draft().slice(0, -1))">
              <pf-icon name="undo" [size]="18" />
              Undo point
            </button>
            <button type="button" class="pf-btn pf-btn--secondary" data-act="cancel-area" (click)="draft.set([])">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary" data-act="finish-area" [disabled]="draft().length < 3" (click)="finishPoly()">
              Finish area
            </button>
          </div>
        }
      }
    } @else {
      <div class="fe-img__loading" role="status">Loading the picture…</div>
    }
  `,
})
export class AreaEditorComponent {
  private readonly dialog = inject(FeDialog);
  private readonly assets = inject(FE_ASSETS);
  private readonly destroyRef = inject(DestroyRef);

  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
  readonly startWith = input<string | null>(null);
  /** bodyMap: fixed tap markers can be placed. */
  readonly allowMarkers = input(false);
  readonly closed = output<void>();

  private readonly surfaceEl = viewChild<ElementRef<HTMLElement>>('surfaceEl');

  protected readonly mode = signal<Mode>('select');
  readonly selected = signal<string | null>(null);
  readonly selectedMarker = signal<string | null>(null);
  readonly draft = signal<Pt[]>([]);
  protected readonly tryDoc = signal<CanvasValue>(emptyCanvas());
  protected readonly tryOn = signal<string[]>([]);
  protected readonly box = signal({ w: 0, h: 0 });
  /** A reshape / oval / marker move in progress (shown live, written once on release). */
  private readonly live = signal<{ key: string; shape: RegionShape } | null>(null);
  private readonly liveMarker = signal<{ key: string; x: number; y: number } | null>(null);
  private drag:
    | { kind: 'vertex'; i: number; id: number }
    | { kind: 'oval'; from: Pt; id: number }
    | { kind: 'marker'; key: string; id: number; moved: number; sx: number; sy: number }
    | null = null;

  readonly pic = resolvePicture(this.assets, () => this.field());
  protected readonly starter = computed(() => this.pic()?.starter ?? false);
  readonly areas = computed(() => {
    const words = new Map(pictureConfig(this.field()).regions.map((r) => [r.id, r]));
    return (this.pic()?.regions ?? []).map((r) => ({ ...r, says: words.get(r.key)?.sentence ?? '' }));
  });
  readonly view = computed(() => {
    const p = this.pic();
    return p ? fitView(p.w, p.h, this.box().w, this.box().h) : { scale: 1, x: 0, y: 0 };
  });
  protected readonly transform = computed(() => `translate(${this.view().x} ${this.view().y}) scale(${this.view().scale})`);

  protected readonly hint = computed(() => {
    switch (this.mode()) {
      case 'poly':
        return this.draft().length < 3
          ? 'Tap round the edge of the area, point by point.'
          : 'Tap the first point, or Finish, to close the area.';
      case 'oval':
        return 'Drag across the area to draw an oval.';
      case 'marker':
        return 'Tap the picture to place a marker; drag a marker to move it, tap it to name it.';
      case 'try':
        return 'This is what the doctor sees: tap to mark.';
      default:
        return this.starter()
          ? 'Tap an area to rename it or write what it says. This picture’s areas keep their shape.'
          : 'Tap an area to name it and write what it says. Drag its corners to reshape it.';
    }
  });

  /** Areas with the live reshape applied, their path and their name's screen spot. */
  protected readonly shown = computed(() => {
    const lv = this.live();
    const out = this.areas().map((a) => {
      const shape = lv && lv.key === a.key ? lv.shape : a.shape;
      const c0 = shapeCentre(shape);
      return { key: a.key, label: a.label, shape, d: regionPath(shape), c: toScreen(this.view(), c0.x, c0.y) };
    });
    if (lv?.key === '__new') {
      const c0 = shapeCentre(lv.shape);
      out.push({ key: '__new', label: '', shape: lv.shape, d: regionPath(lv.shape), c: toScreen(this.view(), c0.x, c0.y) });
    }
    return out;
  });

  protected readonly markerSpots = computed(() => {
    const p = this.pic();
    if (!p || !this.allowMarkers() || this.mode() === 'try') return [];
    const lm = this.liveMarker();
    return pictureMarkers(this.field(), p, []).map((m) => {
      const x = lm?.key === m.key ? lm.x : m.x;
      const y = lm?.key === m.key ? lm.y : m.y;
      return { key: m.key, label: m.label, ...toScreen(this.view(), x, y) };
    });
  });

  protected readonly tryMarkers = computed(() => {
    const p = this.pic();
    return p && this.allowMarkers() ? pictureMarkers(this.field(), p, this.tryOn()) : [];
  });

  /** Corner handles of the selected area (every other corner on a long outline, so they never crowd). */
  protected readonly handles = computed(() => {
    const s = this.shown().find((r) => r.key === this.selected())?.shape;
    if (!s || this.mode() !== 'select' || this.starter() || s.type !== 'poly') return [];
    const step = s.points.length / 2 > 16 ? 2 : 1;
    const out: { i: number; x: number; y: number }[] = [];
    for (let i = 0; i * 2 + 1 < s.points.length; i += step) out.push({ i, ...toScreen(this.view(), s.points[i * 2], s.points[i * 2 + 1]) });
    return out;
  });

  protected readonly draftPath = computed(() => {
    const d = this.draft();
    if (!d.length) return null;
    return d.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  });
  protected readonly draftDots = computed(() => this.draft().map((p) => toScreen(this.view(), p.x, p.y)));

  private place(cx: number, cy: number): { x: number; y: number } {
    const W = 300;
    const H = 300;
    const b = this.box();
    const right = cx + 40 + W <= b.w;
    return {
      x: Math.max(8, Math.min(b.w - W - 8, right ? cx + 40 : cx - 40 - W)),
      y: Math.max(8, Math.min(b.h - H - 8, cy - H / 2)),
    };
  }

  /** The selected area's card, placed beside it and kept on the surface. */
  protected readonly card = computed(() => {
    const key = this.selected();
    const a = this.areas().find((x) => x.key === key);
    const r = this.shown().find((x) => x.key === key);
    if (!a || !r || this.mode() !== 'select' || this.live()) return null;
    return { key: a.key, label: a.label, says: a.says, ...this.place(r.c.x, r.c.y) };
  });

  protected readonly markerCard = computed(() => {
    const key = this.selectedMarker();
    const m = this.markerSpots().find((x) => x.key === key);
    const o = (this.field().options ?? []).find((x) => x.key === key);
    if (!m || this.liveMarker()) return null;
    return { key: m.key, label: m.label, says: o?.says ?? '', ...this.place(m.x, m.y) };
  });

  constructor() {
    effect(() => {
      const k = this.startWith();
      untracked(() => this.selected.set(k));
    });
    effect((onCleanup) => {
      const el = this.surfaceEl()?.nativeElement;
      if (!el) return;
      const measure = () => {
        const r = el.getBoundingClientRect();
        this.box.set({ w: Math.round(r.width), h: Math.round(r.height) });
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
    if (typeof document !== 'undefined') {
      // full screen above everything: lift the editor out of the settings sheet (a sheet's transform would
      // otherwise become the box "fixed" is measured from)
      const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
      document.body.appendChild(host);
      this.destroyRef.onDestroy(() => host.remove());
      document.documentElement.classList.add('fe-cv-locked');
      this.destroyRef.onDestroy(() => document.documentElement.classList.remove('fe-cv-locked'));
    }
  }

  protected setMode(m: Mode): void {
    this.mode.set(m);
    this.draft.set([]);
    this.selected.set(null);
    this.selectedMarker.set(null);
    const p = this.pic();
    if (m === 'try' && p) {
      this.tryDoc.set(emptyCanvas(p.w, p.h));
      this.tryOn.set([]);
    }
  }

  protected toggleTry(key: string): void {
    const on = this.tryOn();
    this.tryOn.set(on.includes(key) ? on.filter((k) => k !== key) : [...on, key]);
  }

  protected escape(): void {
    if (this.draft().length) this.draft.set([]);
    else if (this.selected() || this.selectedMarker()) {
      this.selected.set(null);
      this.selectedMarker.set(null);
    } else this.closed.emit();
  }

  private picAt(ev: PointerEvent): Pt {
    const r = this.surfaceEl()!.nativeElement.getBoundingClientRect();
    return toPicture(this.view(), ev.clientX - r.left, ev.clientY - r.top);
  }

  private inside(p: Pt): boolean {
    const pic = this.pic();
    return !!pic && p.x >= 0 && p.y >= 0 && p.x <= pic.w && p.y <= pic.h;
  }

  private frac(points: number[]): [number, number][] {
    const p = this.pic()!;
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < points.length; i += 2) out.push([points[i] / p.w, points[i + 1] / p.h]);
    return out;
  }

  protected down(ev: PointerEvent): void {
    const p = this.picAt(ev);
    const m = this.mode();
    if (m === 'select') {
      const hit = hitRegion(this.pic()?.regions ?? [], p);
      this.selected.set(hit?.key ?? null);
      this.selectedMarker.set(null);
    } else if (m === 'poly') {
      if (!this.inside(p)) return;
      const d = this.draft();
      const first = d[0];
      if (first && d.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) * this.view().scale < 24) {
        void this.finishPoly();
        return;
      }
      this.draft.set([...d, { x: Math.round(p.x), y: Math.round(p.y) }]);
    } else if (m === 'oval' && this.inside(p)) {
      ev.preventDefault();
      capturePointer(ev.currentTarget as Element, ev.pointerId);
      this.drag = { kind: 'oval', from: p, id: ev.pointerId };
      this.live.set({ key: '__new', shape: ellipseFrom(p, p) });
    } else if (m === 'marker' && this.inside(p)) {
      void this.newMarker(p);
    }
  }

  protected grab(ev: PointerEvent, i: number): void {
    ev.stopPropagation();
    ev.preventDefault();
    capturePointer(this.surfaceEl()?.nativeElement, ev.pointerId);
    this.drag = { kind: 'vertex', i, id: ev.pointerId };
  }

  protected grabMarker(ev: PointerEvent, key: string): void {
    ev.stopPropagation();
    ev.preventDefault();
    capturePointer(this.surfaceEl()?.nativeElement, ev.pointerId);
    this.drag = { kind: 'marker', key, id: ev.pointerId, moved: 0, sx: ev.clientX, sy: ev.clientY };
  }

  protected move(ev: PointerEvent): void {
    const d = this.drag;
    const pic = this.pic();
    if (!d || d.id !== ev.pointerId || !pic) return;
    const p = this.picAt(ev);
    const q = { x: clamp(p.x, 0, pic.w), y: clamp(p.y, 0, pic.h) };
    if (d.kind === 'oval') {
      this.live.set({ key: '__new', shape: ellipseFrom(d.from, q) });
      return;
    }
    if (d.kind === 'marker') {
      d.moved = Math.max(d.moved, Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy));
      if (d.moved > 8) this.liveMarker.set({ key: d.key, ...q });
      return;
    }
    const key = this.selected();
    const base = (this.live()?.key === key ? this.live()!.shape : this.areas().find((a) => a.key === key)?.shape) ?? null;
    if (!key || !base) return;
    this.live.set({ key, shape: moveHandle(base, d.i, q) });
  }

  protected async up(ev: PointerEvent): Promise<void> {
    const d = this.drag;
    if (!d || d.id !== ev.pointerId) return;
    this.drag = null;
    if (d.kind === 'marker') {
      const lm = this.liveMarker();
      this.liveMarker.set(null);
      const pic = this.pic();
      if (lm && pic) this.apply()((f) => moveMarker(f, lm.key, lm.x / pic.w, lm.y / pic.h));
      else {
        this.selectedMarker.set(d.key);
        this.selected.set(null);
      }
      return;
    }
    const lv = this.live();
    this.live.set(null);
    if (!lv) return;
    if (d.kind === 'vertex') {
      const shape = lv.shape;
      if (shape.type === 'poly') this.apply()((f) => setAreaPoints(f, lv.key, this.frac(shape.points)));
      return;
    }
    const s = lv.shape;
    if (s.type !== 'ellipse' || s.rx * this.view().scale < 10 || s.ry * this.view().scale < 10) return;
    const pic = this.pic()!;
    await this.name(ovalPoints(s.cx, s.cy, s.rx, s.ry).map(([x, y]) => [x / pic.w, y / pic.h] as [number, number]));
  }

  protected cancelDrag(): void {
    this.drag = null;
    this.live.set(null);
    this.liveMarker.set(null);
  }

  async finishPoly(): Promise<void> {
    const d = this.draft();
    if (d.length < 3) return;
    this.draft.set([]);
    await this.name(this.frac(d.flatMap((p) => [p.x, p.y])));
  }

  private async name(points: [number, number][]): Promise<void> {
    const label = await this.dialog.prompt({
      title: 'Name this area',
      message: 'The doctor sees this name when they tap the area.',
      placeholder: 'e.g. Right knee',
      confirmLabel: 'Add area',
      required: true,
    });
    if (!label?.trim()) return;
    let id = '';
    this.apply()((f) => {
      id = addArea(f, label, points, (this.pic()?.regions ?? []).map((r) => r.key));
    });
    this.mode.set('select');
    this.selected.set(id || null);
  }

  private async newMarker(p: Pt): Promise<void> {
    const pic = this.pic()!;
    const label = await this.dialog.prompt({
      title: 'Name this marker',
      message: 'The doctor taps it to mark it; its follow-up questions open under the picture.',
      placeholder: 'e.g. Forehead',
      confirmLabel: 'Add marker',
      required: true,
    });
    if (!label?.trim()) return;
    let key = '';
    this.apply()((f) => {
      key = addMarker(f, label, p.x / pic.w, p.y / pic.h);
    });
    this.selectedMarker.set(key || null);
  }

  protected rename(key: string, label: string): void {
    this.apply()((f) => renameArea(f, key, label));
  }

  protected says(key: string, words: string): void {
    this.apply()((f) => setAreaSentence(f, key, words));
  }

  protected renameMk(key: string, label: string): void {
    if (label.trim()) this.apply()((f) => renameMarker(f, key, label));
  }

  protected saysMk(key: string, words: string): void {
    this.apply()((f) => setMarkerSays(f, key, words));
  }

  protected async remove(key: string): Promise<void> {
    const a = this.areas().find((x) => x.key === key);
    const ok = await this.dialog.confirm({
      title: `Remove ${a?.label ?? 'this area'}?`,
      message: 'Its words go too.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    this.selected.set(null);
    this.apply()((f) => removeArea(f, key));
  }

  protected async removeMk(key: string): Promise<void> {
    const o = (this.field().options ?? []).find((x) => x.key === key);
    const n = o?.subFields?.length ?? 0;
    const ok = await this.dialog.confirm({
      title: `Remove ${o?.label ?? 'this marker'}?`,
      message: n ? `Its words and its ${n} follow-up ${n === 1 ? 'question' : 'questions'} go too.` : 'Its words go too.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    this.selectedMarker.set(null);
    this.apply()((f) => removeMarker(f, key));
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function ellipseFrom(a: Pt, b: Pt): RegionShape {
  return {
    type: 'ellipse',
    cx: Math.round((a.x + b.x) / 2),
    cy: Math.round((a.y + b.y) / 2),
    rx: Math.round(Math.abs(b.x - a.x) / 2),
    ry: Math.round(Math.abs(b.y - a.y) / 2),
  };
}

/** Move one corner of an area's outline. */
export function moveHandle(s: RegionShape, i: number, p: Pt): RegionShape {
  if (s.type === 'ellipse') return s;
  const points = [...s.points];
  points[i * 2] = Math.round(p.x * 10) / 10;
  points[i * 2 + 1] = Math.round(p.y * 10) / 10;
  return { type: 'poly', points };
}
