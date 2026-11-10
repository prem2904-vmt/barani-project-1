import { ChangeDetectionStrategy, Component, ElementRef, computed, signal, viewChildren } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { capturePointer } from '../../canvas/pointer';
import { KindFill, feId } from '../../fill/contract';

export type EyeKey = 're' | 'le';
export type EomMark = '+' | '-';
export type EyeBox = 'top' | 'right' | 'bottom' | 'left';

/** eyeDiagram, preset `movements`: 8 gaze positions per eye, clockwise from straight up (API "Image kinds"). */
export interface EomValue {
  re: EomMark[];
  le: EomMark[];
  includeInPdf?: boolean;
}
/** eyeDiagram, preset `boxes`: four boxes around each eye. */
export interface EyeFieldsValue {
  re: Partial<Record<EyeBox, string>>;
  le: Partial<Record<EyeBox, string>>;
  includeInPdf?: boolean;
}
/** One box's settings (`config.boxes.re.top`…). */
export interface EyeBoxConfig {
  label?: string;
  inputType?: 'text' | 'dropdown';
  defaultValue?: string;
  options?: string[];
}

export const EYES: { key: EyeKey; short: string; name: string }[] = [
  { key: 're', short: 'RE', name: 'Right eye' },
  { key: 'le', short: 'LE', name: 'Left eye' },
];
export const GAZE_WORDS = ['up', 'up and right', 'right', 'down and right', 'down', 'down and left', 'left', 'up and left'];
export const EYE_BOXES: EyeBox[] = ['top', 'left', 'right', 'bottom'];
const BOX_DEFAULT: Record<EyeBox, string> = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

/** Marker centres in % of an eye's square box (ring radius 37%). */
export function gazePoint(i: number): { x: number; y: number } {
  const a = ((-90 + i * 45) * Math.PI) / 180;
  return { x: 50 + 37 * Math.cos(a), y: 50 + 37 * Math.sin(a) };
}

/** A stored eom answer, made whole (8 marks per eye, '+' where missing). */
export function eomOf(v: unknown): EomValue {
  const o = (v ?? {}) as Partial<Record<EyeKey, unknown>>;
  const eye = (x: unknown): EomMark[] =>
    Array.from({ length: 8 }, (_, i) => (Array.isArray(x) && x[i] === '-' ? '-' : '+'));
  return { re: eye(o.re), le: eye(o.le) };
}

/** "Include in the case sheet" (absent = yes). */
export function includedOf(v: unknown): boolean {
  return (v as { includeInPdf?: unknown } | null)?.includeInPdf !== false;
}

/**
 * eyeDiagram (legacy eom + eyeFields, one kind with presets; API "Image kinds"):
 *  - `movements`: two eyes, each ringed by 8 gaze markers (48px). Every marker
 *    starts full (+); tap — or slide across several — to mark restricted (−).
 *    One slide toggles each marker once (the legacy gesture, kept).
 *  - `boxes`: four boxes around each eye (labels, defaults and choices from
 *    the form); tap a box to type, or pick one of its choices.
 *  - "Include in the case sheet" (when the form shows the switch) leaves it out of the words and the PDF.
 */
@Component({
  selector: 'fe-eyediagram-fill',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-eye" role="group" [attr.aria-labelledby]="labelId()" [attr.data-preset]="preset()">
      @if (preset() === 'movements') {
        <div class="fe-eye__pair">
          @for (e of eyes; track e.key) {
            <div
              #eyeBoxEl
              class="fe-eye__box"
              role="group"
              [attr.data-eye]="e.key"
              [attr.aria-label]="e.name + ' movements'"
              (pointerdown)="slideStart($event, e.key)"
              (pointermove)="slideMove($event)"
              (pointerup)="slideEnd()"
              (pointercancel)="slideEnd()"
            >
              <svg class="fe-eye__art" viewBox="0 0 100 100" aria-hidden="true">
                <circle class="fe-eye__ring" cx="50" cy="50" r="37" />
                <path class="fe-eye__lid" d="M24 50 Q50 31 76 50 Q50 69 24 50 Z" />
                <circle class="fe-eye__iris" cx="50" cy="50" r="9" />
                <circle class="fe-eye__pupil" cx="50" cy="50" r="4" />
              </svg>
              @for (m of eom()[e.key]; track $index; let i = $index) {
                <button
                  type="button"
                  class="fe-eye__mk"
                  [attr.data-mk]="i"
                  [class.is-restricted]="m === '-'"
                  [style.left.%]="pos[i].x"
                  [style.top.%]="pos[i].y"
                  [attr.aria-pressed]="m === '-'"
                  [attr.aria-label]="e.name + ', looking ' + gaze[i] + ': ' + (m === '-' ? 'restricted' : 'full')"
                  [disabled]="disabled()"
                  (click)="keyToggle($event, e.key, i)"
                >
                  <span class="fe-eye__mk-glyph" aria-hidden="true">{{ m === '-' ? '−' : '+' }}</span>
                </button>
              }
              <span class="fe-eye__name">{{ e.short }}</span>
            </div>
          }
        </div>
        <p class="fe-field__hint">Tap a marker, or slide across several, to mark restricted (−). Tap again for full (+).</p>
        @if (!disabled()) {
          <div class="fe-img__acts">
            <button type="button" class="pf-btn pf-btn--secondary" data-act="all-full" (click)="allFull()">
              <pf-icon name="check" [size]="18" />
              {{ value() ? 'All full again' : 'All full' }}
            </button>
            @if (value()) {
              <button type="button" class="pf-btn pf-btn--secondary" data-act="clear-eye" (click)="emit(undefined)">
                <pf-icon name="x" [size]="18" />
                Not examined
              </button>
            }
          </div>
        }
      } @else {
        <div class="fe-eye__pair">
          @for (e of eyes; track e.key) {
            <div class="fe-eye__fields" role="group" [attr.data-eye]="e.key" [attr.aria-label]="e.name">
              @for (b of boxes; track b) {
                <button
                  type="button"
                  class="fe-eye__fbox pf-touch"
                  [attr.data-box]="b"
                  [class.is-open]="editing()?.eye === e.key && editing()?.box === b"
                  [attr.aria-expanded]="editing()?.eye === e.key && editing()?.box === b"
                  [attr.aria-label]="e.name + ', ' + boxLabel(e.key, b) + ': ' + (shown(e.key, b) || 'empty') + '. Tap to change.'"
                  [disabled]="disabled()"
                  (click)="edit(e.key, b)"
                >
                  <span class="fe-eye__flbl">{{ boxLabel(e.key, b) }}</span>
                  <span class="fe-eye__fval" [class.is-empty]="!shown(e.key, b)">{{ shown(e.key, b) || '—' }}</span>
                </button>
              }
              <span class="fe-eye__fcentre" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="40" height="40">
                  <path class="fe-eye__lid" d="M4 24 Q24 9 44 24 Q24 39 4 24 Z" />
                  <circle class="fe-eye__iris" cx="24" cy="24" r="7" />
                  <circle class="fe-eye__pupil" cx="24" cy="24" r="3" />
                </svg>
                <span class="fe-eye__name">{{ e.short }}</span>
              </span>
            </div>
          }
        </div>
        @if (editing(); as ed) {
          <div class="fe-pin-panel" data-eye-editor>
            <label class="fe-sub" [attr.for]="inputId">
              <span class="fe-sub__lbl">{{ eyeName(ed.eye) }} — {{ boxLabel(ed.eye, ed.box) }}</span>
            </label>
            @if (choicesFor(ed.eye, ed.box).length) {
              <div class="fe-chips" role="radiogroup" [attr.aria-label]="boxLabel(ed.eye, ed.box)">
                @for (c of choicesFor(ed.eye, ed.box); track c) {
                  <button
                    type="button"
                    class="fe-chip"
                    role="radio"
                    [attr.aria-checked]="shown(ed.eye, ed.box) === c"
                    (click)="setBox(ed.eye, ed.box, shown(ed.eye, ed.box) === c ? '' : c)"
                  >
                    <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                    {{ c }}
                  </button>
                }
              </div>
            }
            @if (!dropdown(ed.eye, ed.box)) {
            <input
              class="fe-text__input"
              type="text"
              [id]="inputId"
              data-eye-input
              [value]="shown(ed.eye, ed.box)"
              placeholder="Type here"
              (input)="setBox(ed.eye, ed.box, $any($event.target).value)"
              (keydown.enter)="editing.set(null)"
            />
            }
            <div class="fe-img__acts">
              <button type="button" class="pf-btn pf-btn--primary" (click)="editing.set(null)">Done</button>
            </div>
          </div>
        }
      }
      @if (includeSwitch() && value()) {
        <button
          type="button"
          role="switch"
          class="pf-toggle fe-eye__include pf-touch"
          data-act="include"
          [attr.aria-checked]="included()"
          [disabled]="disabled()"
          (click)="setIncluded(!included())"
        >
          <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
          <span>Include in the case sheet</span>
        </button>
      }
    </div>
  `,
})
export class EyeDiagramFill extends KindFill {
  protected readonly eyes = EYES;
  protected readonly gaze = GAZE_WORDS;
  protected readonly boxes = EYE_BOXES;
  protected readonly pos = Array.from({ length: 8 }, (_, i) => gazePoint(i));
  protected readonly inputId = feId('fe-eye');
  private readonly eyeBoxEls = viewChildren<ElementRef<HTMLElement>>('eyeBoxEl');

  protected readonly preset = computed(() => (this.config()['preset'] === 'boxes' ? 'boxes' : 'movements'));
  protected readonly eom = computed(() => eomOf(this.value()));
  protected readonly fields = computed<EyeFieldsValue>(() => {
    const o = (this.value() ?? {}) as Partial<EyeFieldsValue>;
    const eye = (x: unknown) => (x && typeof x === 'object' ? (x as Partial<Record<EyeBox, string>>) : {});
    return { re: eye(o.re), le: eye(o.le) };
  });
  protected readonly editing = signal<{ eye: EyeKey; box: EyeBox } | null>(null);

  private slide: { eye: EyeKey; done: Set<string>; marks: EomValue } | null = null;

  protected readonly includeSwitch = computed(() => this.config()['includeSwitch'] !== false);
  protected readonly included = computed(() => includedOf(this.value()));

  private box(e: EyeKey, b: EyeBox): EyeBoxConfig {
    const all = this.config()['boxes'] as Partial<Record<EyeKey, Partial<Record<EyeBox, EyeBoxConfig>>>> | undefined;
    return all?.[e]?.[b] ?? {};
  }

  protected boxLabel(e: EyeKey, b: EyeBox): string {
    return this.box(e, b).label?.trim() || BOX_DEFAULT[b];
  }

  protected choicesFor(e: EyeKey, b: EyeBox): string[] {
    const c = this.box(e, b).options;
    return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  }

  /** A drop-down box offers only its choices (as chips: no native select, no typing). */
  protected dropdown(e: EyeKey, b: EyeBox): boolean {
    return this.box(e, b).inputType === 'dropdown' && this.choicesFor(e, b).length > 0;
  }

  /** What a box shows: the answer, else the form's default value. */
  protected shown(e: EyeKey, b: EyeBox): string {
    const v = this.value() as Partial<EyeFieldsValue> | null;
    if (v) return v[e]?.[b] ?? '';
    return this.box(e, b).defaultValue ?? '';
  }

  protected allFull(): void {
    this.emit({ re: Array(8).fill('+'), le: Array(8).fill('+'), ...(this.included() ? {} : { includeInPdf: false }) });
  }

  protected setIncluded(on: boolean): void {
    const v = (this.value() ?? {}) as Record<string, unknown>;
    const { includeInPdf: _old, ...rest } = v;
    this.emit(on ? rest : { ...rest, includeInPdf: false });
  }

  protected eyeName(k: EyeKey): string {
    return EYES.find((e) => e.key === k)!.name;
  }

  // ---- eom: tap or slide ----

  protected slideStart(ev: PointerEvent, eye: EyeKey): void {
    if (this.disabled()) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    capturePointer(ev.currentTarget as Element, ev.pointerId);
    this.slide = { eye, done: new Set(), marks: this.eom() };
    this.toggleUnder(ev);
  }

  protected slideMove(ev: PointerEvent): void {
    if (this.slide) this.toggleUnder(ev);
  }

  protected slideEnd(): void {
    const s = this.slide;
    this.slide = null;
    if (s && s.done.size) this.write(s.marks);
  }

  /** Keyboard (Enter / Space): a click with no pointer behind it. */
  protected keyToggle(ev: MouseEvent, eye: EyeKey, i: number): void {
    if (ev.detail !== 0) return; // pointer taps are handled on pointerdown
    const m = this.eom();
    this.write({ ...m, [eye]: m[eye].map((x, j) => (j === i ? flip(x) : x)) });
  }

  private toggleUnder(ev: PointerEvent): void {
    const s = this.slide!;
    // any eye box under the finger (a slide may cross from one eye to the other)
    for (const boxRef of this.eyeBoxEls()) {
      const box = boxRef.nativeElement;
      const eye = box.dataset['eye'] as EyeKey;
      const r = box.getBoundingClientRect();
      if (r.width === 0) continue;
      for (let i = 0; i < 8; i++) {
        const cx = r.left + (r.width * this.pos[i].x) / 100;
        const cy = r.top + (r.height * this.pos[i].y) / 100;
        if (Math.hypot(ev.clientX - cx, ev.clientY - cy) > 24) continue;
        const k = `${eye}${i}`;
        if (s.done.has(k)) continue;
        s.done.add(k);
        s.marks = { ...s.marks, [eye]: s.marks[eye].map((x, j) => (j === i ? flip(x) : x)) };
        // show it at once; saved when the finger lifts
        this.write(s.marks);
      }
    }
  }

  private write(m: EomValue): void {
    // a tap examines both eyes: "Eye movements are full in both eyes" is an answer too
    this.emit({ re: m.re, le: m.le, ...(this.included() ? {} : { includeInPdf: false }) });
  }

  // ---- fields ----

  protected edit(eye: EyeKey, box: EyeBox): void {
    const now = this.editing();
    this.editing.set(now?.eye === eye && now.box === box ? null : { eye, box });
    setTimeout(() => document.getElementById(this.inputId)?.focus({ preventScroll: true }), 50);
  }

  protected setBox(eye: EyeKey, box: EyeBox, text: string): void {
    // the first edit starts from what the boxes show (the form's defaults)
    const f: EyeFieldsValue = this.value()
      ? this.fields()
      : {
          re: Object.fromEntries(EYE_BOXES.map((b) => [b, this.shown('re', b)]).filter(([, v]) => v)),
          le: Object.fromEntries(EYE_BOXES.map((b) => [b, this.shown('le', b)]).filter(([, v]) => v)),
        };
    const side = { ...f[eye] };
    const t = text.trim() ? text.slice(0, 60) : '';
    if (t) side[box] = t;
    else delete side[box];
    const next: EyeFieldsValue = { re: f.re, le: f.le, [eye]: side };
    if (!this.included()) next.includeInPdf = false;
    const empty = !Object.keys(next.re).length && !Object.keys(next.le).length;
    this.emit(empty ? undefined : next);
  }
}

function flip(m: EomMark): EomMark {
  return m === '+' ? '-' : '+';
}
