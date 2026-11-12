import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { ApplyFieldChange } from '../../build/contract';
import { FieldDef, PicturePlace } from '../../core/types';
import { FE_ASSETS } from '../../fill/contract';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { totalConfig } from '../../narrative/combinations';
import { PictureChoiceDrawComponent } from './pictureChoice-draw.component';
import {
  Align,
  Corner,
  SNAP,
  addPart,
  alignPlaces,
  movePlace,
  pictureChoiceConfig,
  placeOf,
  resizePlace,
  safePath,
  setBoxConfig,
  setPartValue,
  setPicture,
  setTotal,
} from './pictureChoice-model';
import { pictureUrls } from './pictureChoice-urls';

const SHAPES: { value: string; label: string; aspect: number }[] = [
  { value: 'square', label: 'Square', aspect: 1 },
  { value: 'wide', label: 'Wide (4 : 3)', aspect: 4 / 3 },
  { value: 'wider', label: 'Wider (16 : 9)', aspect: 16 / 9 },
  { value: 'tall', label: 'Tall (3 : 4)', aspect: 0.75 },
  { value: 'taller', label: 'Taller (9 : 16)', aspect: 9 / 16 },
];
const ALIGNS: PfSelectOption<Align>[] = [
  { value: 'left', label: 'Left edges' },
  { value: 'centre', label: 'Centres across' },
  { value: 'right', label: 'Right edges' },
  { value: 'top', label: 'Top edges' },
  { value: 'middle', label: 'Middles down' },
  { value: 'bottom', label: 'Bottom edges' },
];
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

interface Drag {
  key: string;
  mode: 'move' | Corner;
  startX: number;
  startY: number;
  from: PicturePlace;
}

/**
 * Studio panel for `pictureChoice`: the box (its shape, one or several picks, names under the pictures, a picture
 * behind) and the parts laid out in it. Each part gets its picture by upload or by drawing; drag a part to move it,
 * a corner to resize it (a light grid keeps things tidy). A part's name, sentence and follow-ups are the question's
 * Choices, below, like any other choice; "Sentences for combinations" sits under those.
 */
@Component({
  selector: 'fe-picturechoice-panel',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, PictureChoiceDrawComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-kpanel" data-kind-panel="pictureChoice">
      <h3 class="fe-kpanel__title">The box</h3>
      <div class="fe-pcp__row">
        <span class="fe-pcp__lbl">Shape</span>
        <pf-select [options]="shapes" [value]="shape()" (valueChange)="setShape($event)" />
      </div>
      <button type="button" role="switch" class="pf-toggle fe-pcp__switch" data-act="multiple" [attr.aria-checked]="cfg().multiple" (click)="toggle('multiple')">
        <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
        <span>The doctor can pick more than one</span>
      </button>
      <button type="button" role="switch" class="pf-toggle fe-pcp__switch" data-act="labels" [attr.aria-checked]="cfg().showLabels" (click)="toggle('showLabels')">
        <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
        <span>Show each name under its picture</span>
      </button>
      <button type="button" role="switch" class="pf-toggle fe-pcp__switch" data-act="total" [attr.aria-checked]="!!total()" (click)="toggleTotal()">
        <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
        <span>Show a total of the picked parts’ numbers</span>
      </button>
      @if (total(); as t) {
        <div class="fe-pcp__total" data-total-settings>
          <label class="fe-pcp__lbl">Total’s name
            <input class="pf-input" type="text" data-total-label [value]="t.label" (change)="editTotal({ label: $any($event.target).value })" />
          </label>
          <label class="fe-pcp__lbl">Unit
            <input class="pf-input" type="text" data-total-unit placeholder="%" [value]="t.unit" (change)="editTotal({ unit: $any($event.target).value })" />
          </label>
          <label class="fe-pcp__lbl">Decimals
            <input class="pf-input" type="text" inputmode="numeric" data-total-decimals [value]="t.decimals" (change)="editTotal({ decimals: +$any($event.target).value || 0 })" />
          </label>
        </div>
      }
      @if (assets) {
        <div class="fe-img__acts">
          <button type="button" class="pf-btn pf-btn--secondary" data-act="bg-upload" [disabled]="busy()" (click)="bgIn.click()">
            <pf-icon name="image" [size]="18" /> {{ cfg().background ? 'Change the picture behind' : 'Add a picture behind the parts' }}
          </button>
          @if (cfg().background) {
            <button type="button" class="pf-btn pf-btn--tertiary" data-act="bg-remove" (click)="setBackground(null)">Remove it</button>
          }
          <input #bgIn class="fe-file" type="file" accept="image/png,image/jpeg,image/svg+xml" tabindex="-1" aria-hidden="true" (change)="uploadBackground($any($event.target))" />
        </div>
      }

      <h3 class="fe-kpanel__title">Parts · {{ parts().length }}</h3>
      <div class="fe-pcl" [class.fe-pcl--grid]="snapOn()">
        <div #box class="fe-pcl__box" [style.aspect-ratio]="cfg().aspect" data-layout (pointerdown)="selected.set(null)">
          @if (bgUrl(); as bg) {
            <img class="fe-pc__bg" [src]="bg" alt="" draggable="false" />
          }
          @for (p of parts(); track p.key) {
            <div
              class="fe-pcl__part"
              role="button"
              tabindex="0"
              [class.fe-pcl__part--sel]="p.key === selected()"
              [attr.aria-label]="'Move ' + p.label + '. Arrow keys nudge it, Shift and arrows resize it.'"
              [attr.data-part]="p.key"
              [style.left.%]="p.place.x * 100"
              [style.top.%]="p.place.y * 100"
              [style.width.%]="p.place.w * 100"
              [style.height.%]="p.place.h * 100"
              (pointerdown)="startDrag($event, p.key, 'move', p.place)"
              (pointermove)="onDrag($event)"
              (pointerup)="endDrag($event)"
              (pointercancel)="endDrag($event)"
              (keydown)="onKey($event, p.key, p.place)"
              (focus)="selected.set(p.key)"
            >
              <span class="fe-pc__art" aria-hidden="true">
                @if (p.url) {
                  <img [src]="p.url" alt="" draggable="false" />
                } @else if (p.path) {
                  <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><path [attr.d]="p.path" /></svg>
                } @else {
                  <span class="fe-pc__initial">{{ p.label.charAt(0).toUpperCase() }}</span>
                }
              </span>
              <span class="fe-pc__label">{{ p.label }}</span>
              @if (p.key === selected()) {
                @for (c of corners; track c) {
                  <span
                    class="fe-pcl__h"
                    [class]="'fe-pcl__h fe-pcl__h--' + c"
                    [attr.data-corner]="c"
                    aria-hidden="true"
                    (pointerdown)="startDrag($event, p.key, c, p.place)"
                    (pointermove)="onDrag($event)"
                    (pointerup)="endDrag($event)"
                    (pointercancel)="endDrag($event)"
                  ></span>
                }
              }
            </div>
          }
        </div>
      </div>
      <div class="fe-img__acts">
        <button type="button" class="pf-btn pf-btn--secondary" data-act="add-part" (click)="add()">
          <pf-icon name="plus" [size]="18" /> Add a part
        </button>
        <button type="button" role="switch" class="pf-toggle fe-pcp__switch fe-pcp__switch--inline" data-act="snap" [attr.aria-checked]="snapOn()" (click)="snapOn.set(!snapOn())">
          <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
          <span>Snap to a grid</span>
        </button>
      </div>
      @if (parts().length > 1) {
        <pf-select
          [options]="aligns"
          [value]="lineValue"
          placeholder="Line up all parts…"
          (valueChange)="line($event)"
        />
      }
      @if (!parts().length) {
        <p class="fe-img__empty">No parts yet. Add a part, then give it a picture by uploading or drawing.</p>
      }

      @if (current(); as c) {
        <div class="fe-pcp__sel" data-selected-part>
          <p class="fe-pcp__name">{{ c.label }}</p>
          @if (total()) {
            <label class="fe-pcp__lbl">Number for this part
              <input class="pf-input" type="text" inputmode="decimal" data-part-value placeholder="e.g. 9" [value]="c.value ?? ''" (change)="setValue($any($event.target).value)" />
            </label>
          }
          @if (drawing()) {
            <fe-picturechoice-draw (done)="drawn($event)" (cancelled)="drawing.set(false)" />
          } @else {
            <div class="fe-img__acts">
              @if (assets) {
                <button type="button" class="pf-btn pf-btn--secondary" data-act="part-upload" [disabled]="busy()" (click)="partIn.click()">
                  <pf-icon name="upload" [size]="18" /> Upload a picture
                </button>
                <input #partIn class="fe-file" type="file" accept="image/png,image/jpeg,image/svg+xml" tabindex="-1" aria-hidden="true" data-part-input (change)="uploadPart($any($event.target))" />
              }
              <button type="button" class="pf-btn pf-btn--secondary" data-act="part-draw" (click)="drawing.set(true)">
                <pf-icon name="pen" [size]="18" /> Draw it
              </button>
              @if (c.url || c.path) {
                <button type="button" class="pf-btn pf-btn--tertiary" data-act="part-clear" (click)="clearPicture()">Remove its picture</button>
              }
              <button type="button" class="pf-btn pf-btn--tertiary" data-act="part-remove" (click)="removePart()">
                <pf-icon name="trash" [size]="18" /> Remove this part
              </button>
            </div>
            <p class="fe-pcp__hint">Change its name, what it says and its follow-up questions under Choices.</p>
          }
        </div>
      }
      @if (busy()) {
        <p class="fe-img__empty" role="status">Uploading…</p>
      }
      @if (error()) {
        <p class="fe-img__err" role="alert">{{ error() }}</p>
      }
    </section>
  `,
})
export class PictureChoicePanelComponent {
  protected readonly assets = inject(FE_ASSETS);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly urls = pictureUrls(() => this.field());

  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();

  protected readonly shapes = SHAPES.map((s) => ({ value: s.value, label: s.label })) as PfSelectOption<string>[];
  protected readonly aligns = ALIGNS;
  protected readonly lineValue = null as unknown as Align;
  protected readonly corners = CORNERS;
  protected readonly selected = signal<string | null>(null);
  protected readonly snapOn = signal(true);
  protected readonly drawing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The part being dragged, shown at its live place until the pointer lets go (one Studio edit, not one per move). */
  private readonly live = signal<{ key: string; place: PicturePlace } | null>(null);
  private drag: Drag | null = null;

  protected readonly cfg = computed(() => pictureChoiceConfig(this.field()));
  protected readonly shape = computed(() => {
    const a = this.cfg().aspect;
    return SHAPES.reduce((best, s) => (Math.abs(s.aspect - a) < Math.abs(best.aspect - a) ? s : best), SHAPES[0]).value;
  });
  protected readonly bgUrl = computed(() => {
    const id = this.cfg().background;
    return id ? (this.urls()[id] ?? null) : null;
  });
  protected readonly parts = computed(() => {
    const opts = this.field().options ?? [];
    const live = this.live();
    return opts.map((o, i) => ({
      key: o.key,
      label: o.label,
      place: live?.key === o.key ? live.place : placeOf(o, i, opts.length),
      url: o.asset ? (this.urls()[o.asset] ?? null) : null,
      path: o.asset ? null : safePath(o.drawn),
      value: o.value,
    }));
  });
  protected readonly total = computed(() => totalConfig(this.field()));
  protected readonly current = computed(() => this.parts().find((p) => p.key === this.selected()) ?? null);

  // ── the box ──
  protected setShape(v: string | null): void {
    const s = SHAPES.find((x) => x.value === v);
    if (s) this.apply()((f) => setBoxConfig(f, { aspect: s.aspect }));
  }
  protected toggle(name: 'multiple' | 'showLabels'): void {
    this.apply()((f) => setBoxConfig(f, { [name]: !pictureChoiceConfig(f)[name] }));
  }
  protected setBackground(id: string | null): void {
    this.apply()((f) => setBoxConfig(f, { background: id }));
  }
  protected async uploadBackground(el: HTMLInputElement): Promise<void> {
    const ref = await this.upload(el);
    if (ref) this.setBackground(ref);
  }

  protected toggleTotal(): void {
    this.apply()((f) => setTotal(f, totalConfig(f) ? null : {}));
  }
  protected editTotal(t: { label?: string; unit?: string; decimals?: number }): void {
    this.apply()((f) => setTotal(f, t));
  }
  protected setValue(v: string): void {
    const k = this.selected();
    if (k) this.apply()((f) => setOn(f, k, (o) => setPartValue(o, v)));
  }

  // ── parts ──
  protected add(): void {
    let key = '';
    const n = (this.field().options ?? []).length + 1;
    this.apply()((f) => (key = addPart(f, `Part ${n}`).key));
    this.selected.set(key);
    this.drawing.set(false);
  }
  protected removePart(): void {
    const k = this.selected();
    if (!k) return;
    this.apply()((f) => (f.options = (f.options ?? []).filter((o) => o.key !== k)));
    this.selected.set(null);
  }
  protected line(how: Align | null): void {
    if (!how) return;
    this.apply()((f) => {
      const opts = f.options ?? [];
      const next = alignPlaces(opts.map((o, i) => placeOf(o, i, opts.length)), how);
      opts.forEach((o, i) => (o.place = next[i]));
    });
  }
  protected async uploadPart(el: HTMLInputElement): Promise<void> {
    const k = this.selected();
    const ref = await this.upload(el);
    if (k && ref) this.apply()((f) => setOn(f, k, (o) => setPicture(o, { asset: ref })));
  }
  protected drawn(d: string): void {
    const k = this.selected();
    this.drawing.set(false);
    if (k) this.apply()((f) => setOn(f, k, (o) => setPicture(o, { drawn: d })));
  }
  protected clearPicture(): void {
    const k = this.selected();
    if (k) this.apply()((f) => setOn(f, k, (o) => setPicture(o, null)));
  }
  private async upload(el: HTMLInputElement): Promise<string | null> {
    const file = el.files?.[0];
    el.value = '';
    if (!file || !this.assets) return null;
    if (file.type && !/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) {
      this.error.set('Please choose a PNG, JPEG or SVG picture.');
      return null;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      return (await this.assets.uploadTemplate(file)).assetId;
    } catch {
      this.error.set('The picture could not be uploaded. Check that it is under 4 MB and try again.');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  // ── drag, resize, keys ──
  protected startDrag(ev: PointerEvent, key: string, mode: 'move' | Corner, from: PicturePlace): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.selected.set(key);
    this.drawing.set(false);
    this.drag = { key, mode, startX: ev.clientX, startY: ev.clientY, from };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }
  protected onDrag(ev: PointerEvent): void {
    const d = this.drag;
    const r = this.box()?.nativeElement.getBoundingClientRect();
    if (!d || !r?.width || !r.height) return;
    ev.stopPropagation();
    const dx = (ev.clientX - d.startX) / r.width;
    const dy = (ev.clientY - d.startY) / r.height;
    const place = d.mode === 'move' ? movePlace(d.from, dx, dy, this.snapOn()) : resizePlace(d.from, d.mode, dx, dy, this.snapOn());
    this.live.set({ key: d.key, place });
  }
  protected endDrag(ev: PointerEvent): void {
    const d = this.drag;
    const l = this.live();
    this.drag = null;
    this.live.set(null);
    if (!d) return;
    ev.stopPropagation();
    if (l && JSON.stringify(l.place) !== JSON.stringify(d.from)) this.commit(d.key, l.place);
  }
  protected onKey(ev: KeyboardEvent, key: string, p: PicturePlace): void {
    const step = ev.key === 'ArrowLeft' ? [-1, 0] : ev.key === 'ArrowRight' ? [1, 0] : ev.key === 'ArrowUp' ? [0, -1] : ev.key === 'ArrowDown' ? [0, 1] : null;
    if (!step) return;
    ev.preventDefault();
    const [dx, dy] = [step[0] * SNAP, step[1] * SNAP];
    this.commit(key, ev.shiftKey ? resizePlace(p, 'se', dx, dy, this.snapOn()) : movePlace(p, dx, dy, this.snapOn()));
  }
  /** One Studio edit for the new place of a part. */
  private commit(key: string, place: PicturePlace): void {
    this.apply()((f) => setOn(f, key, (o) => (o.place = place)));
  }
}

function setOn(f: FieldDef, key: string, change: (o: NonNullable<FieldDef['options']>[number]) => void): void {
  const opts = f.options ?? [];
  // a part nobody has placed yet is pinned to the place it shows at, so a first edit never moves the others
  opts.forEach((o, i) => (o.place ??= placeOf(o, i, opts.length)));
  const o = opts.find((x) => x.key === key);
  if (o) change(o);
}
