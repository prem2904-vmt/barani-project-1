import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill, feId } from '../../fill/contract';
import { PALETTE } from '../familyTree/family-layout';
import {
  DEFAULT_CONDITIONS,
  Dentition,
  SURFACES,
  Surface,
  ToothCondition,
  ToothMark,
  lowerRow,
  mergeMarks,
  surfaceWord,
  toothName,
  upperRow,
} from './teeth';

export interface ToothChartAnswer {
  marks?: ToothMark[];
  note?: string;
}

interface ToothView {
  code: string;
  whole: string | null;
  top: string | null;
  bottom: string | null;
  left: string | null;
  right: string | null;
  centre: string | null;
  crosses: string[];
  label: string;
}

interface Quadrant {
  id: string;
  name: string;
  /** First half of its row = the viewer's left, where mesial faces right. */
  leftSide: boolean;
  upper: boolean;
  teeth: string[];
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * toothChart: FDI numbers, adult / child / mixed. Four quadrants (one picture of the arch when there is room, a quadrant per row on a phone);
 * tap a tooth, then a condition from the list; for conditions that sit on part of a tooth, tap the surfaces on a small cross that is drawn the
 * way the tooth looks on the chart. A tooth can carry several conditions.
 */
@Component({
  selector: 'fe-toothchart-fill',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-tooth" role="group" [attr.aria-labelledby]="labelId()" [attr.data-dentition]="dentition()">
      @if (dentition() === 'mixed') {
        <div class="fe-chips" role="radiogroup" aria-label="Which teeth">
          <button type="button" class="fe-chip" role="radio" data-set="adult" [attr.aria-checked]="!baby()" (click)="baby.set(false)">Adult teeth</button>
          <button type="button" class="fe-chip" role="radio" data-set="baby" [attr.aria-checked]="baby()" (click)="baby.set(true)">Baby teeth</button>
        </div>
      }

      <div class="fe-tooth__arch">
        @for (q of quadrants(); track q.id) {
          <div [class]="'fe-tooth__quad fe-tooth__quad--' + q.id" [attr.data-quad]="q.id">
            <span class="fe-tooth__qname">{{ q.name }}</span>
            <div class="fe-tooth__teeth">
              @for (code of q.teeth; track code) {
                <button
                  type="button"
                  class="fe-tooth__t"
                  [attr.data-tooth]="code"
                  [attr.aria-pressed]="selected() === code"
                  [attr.aria-label]="view(code).label"
                  [disabled]="disabled() && !hasMarkOn(code)"
                  (click)="select(code)"
                >
                  <svg class="fe-tooth__glyph" viewBox="0 0 30 30" aria-hidden="true">
                    <rect class="fe-tooth__cell" x="0" y="0" width="30" height="30" />
                    @if (view(code).whole) {
                      <rect x="0" y="0" width="30" height="30" [attr.fill]="view(code).whole" fill-opacity="0.4" />
                    }
                    @if (view(code).top) {
                      <polygon points="0,0 30,0 20,10 10,10" [attr.fill]="view(code).top" fill-opacity="0.85" />
                    }
                    @if (view(code).bottom) {
                      <polygon points="0,30 30,30 20,20 10,20" [attr.fill]="view(code).bottom" fill-opacity="0.85" />
                    }
                    @if (view(code).left) {
                      <polygon points="0,0 10,10 10,20 0,30" [attr.fill]="view(code).left" fill-opacity="0.85" />
                    }
                    @if (view(code).right) {
                      <polygon points="30,0 20,10 20,20 30,30" [attr.fill]="view(code).right" fill-opacity="0.85" />
                    }
                    @if (view(code).centre) {
                      <rect x="10" y="10" width="10" height="10" [attr.fill]="view(code).centre" fill-opacity="0.85" />
                    }
                    <path class="fe-tooth__lines" d="M0 0L10 10M30 0L20 10M0 30L10 20M30 30L20 20M10 10H20V20H10Z" />
                    @for (c of view(code).crosses; track c) {
                      <path class="fe-tooth__cross" d="M3 3L27 27M27 3L3 27" [attr.stroke]="c" />
                    }
                  </svg>
                  <span>{{ code }}</span>
                </button>
              }
            </div>
          </div>
        }
      </div>

      @if (selected(); as code) {
        <div class="fe-tooth__panel" data-panel>
          <h4 class="fe-tooth__ptitle">Tooth {{ code }} · {{ name(code) }}</h4>
          <div class="fe-chips" role="group" aria-label="Condition of this tooth">
            @for (c of conditions(); track c.key) {
              <button
                type="button"
                class="fe-chip"
                [attr.data-cond]="c.key"
                [attr.aria-pressed]="hasMark(code, c.key)"
                [disabled]="disabled()"
                (click)="tapCondition(code, c.key)"
              >
                <span class="fe-fam__dot" [style.background]="colour(c.key)"></span>{{ c.label }}
              </button>
            }
          </div>
          @if (surfaceCondition(code); as sc) {
            <span class="fe-fam__k">{{ sc.label }} on which surfaces? (none = the whole tooth)</span>
            <div class="fe-tooth__cross5" role="group" [attr.aria-label]="sc.label + ' surfaces'">
              @for (p of crossFor(code); track p.surface) {
                <button
                  type="button"
                  class="fe-tooth__s"
                  [attr.data-pos]="p.pos"
                  [attr.data-surface]="p.surface"
                  [attr.aria-pressed]="surfaceOn(code, sc.key, p.surface)"
                  [disabled]="disabled()"
                  (click)="tapSurface(code, sc.key, p.surface)"
                >
                  {{ p.word }}
                </button>
              }
            </div>
          }
          <div class="fe-fam__row">
            <button type="button" class="pf-btn pf-btn--primary" data-act="done" (click)="selected.set(null)"><pf-icon name="check" [size]="18" /> Done</button>
            @if (hasMarkOn(code) && !disabled()) {
              <button type="button" class="pf-btn pf-btn--secondary" data-act="clear-tooth" (click)="clearTooth(code)"><pf-icon name="x" [size]="18" /> Clear this tooth</button>
            }
          </div>
        </div>
      }

      @if (marks().length) {
        <div class="fe-chips" role="group" aria-label="Marked teeth">
          @for (m of marks(); track m.tooth + m.condition) {
            <button type="button" class="fe-chip" data-marked [attr.aria-label]="'Tooth ' + m.tooth + ', ' + condLabel(m.condition) + '. Tap to change.'" (click)="select(m.tooth)">
              <span class="fe-fam__dot" [style.background]="colour(m.condition)"></span>{{ m.tooth }} · {{ condLabel(m.condition) }}{{ m.surfaces.length ? ' (' + m.surfaces.join('') + ')' : '' }}
            </button>
          }
        </div>
      }

      <div class="fe-fam__field">
        <label class="fe-fam__k" [attr.for]="noteId">Note (optional)</label>
        <input class="fe-text__input" type="text" [id]="noteId" data-note [value]="note()" maxlength="500" [disabled]="disabled()" (change)="setNote($any($event.target).value)" />
      </div>
    </div>
  `,
})
export class ToothChartFill extends KindFill {
  protected readonly noteId = feId('fe-tooth-note');
  protected readonly selected = signal<string | null>(null);
  /** The condition whose surfaces are being set. */
  private readonly active = signal<string | null>(null);
  protected readonly baby = signal(false);

  protected readonly dentition = computed<Dentition>(() => {
    const d = this.config()['dentition'];
    return d === 'child' || d === 'mixed' ? d : 'adult';
  });
  private readonly showBaby = computed(() => this.dentition() === 'child' || (this.dentition() === 'mixed' && this.baby()));

  protected readonly conditions = computed<ToothCondition[]>(() => {
    const c = this.config()['conditions'];
    return Array.isArray(c) && c.length ? (c as ToothCondition[]) : DEFAULT_CONDITIONS;
  });
  private readonly answer = computed<ToothChartAnswer>(() => (this.value() as ToothChartAnswer | null) ?? {});
  protected readonly marks = computed(() => mergeMarks(this.answer().marks));
  protected readonly note = computed(() => this.answer().note ?? '');

  protected readonly quadrants = computed<Quadrant[]>(() => {
    const baby = this.showBaby();
    const up = upperRow(baby);
    const lo = lowerRow(baby);
    const h = up.length / 2;
    const p = baby ? 5 : 1; // first quadrant digit of the set
    return [
      { id: 'q' + p, name: 'Upper right', leftSide: true, upper: true, teeth: up.slice(0, h) },
      { id: 'q' + (p + 1), name: 'Upper left', leftSide: false, upper: true, teeth: up.slice(h) },
      { id: 'q' + (p + 3), name: 'Lower right', leftSide: true, upper: false, teeth: lo.slice(0, h) },
      { id: 'q' + (p + 2), name: 'Lower left', leftSide: false, upper: false, teeth: lo.slice(h) },
    ];
  });

  protected readonly colour = (key: string): string => {
    const i = this.conditions().findIndex((c) => c.key === key);
    const c = this.conditions()[i];
    return c?.color ?? (i < 0 ? '#6b7280' : PALETTE[i % PALETTE.length]);
  };
  protected readonly condLabel = (key: string): string => this.conditions().find((c) => c.key === key)?.label ?? key;
  protected readonly name = toothName;

  private readonly views = computed(() => {
    const map = new Map<string, ToothView>();
    for (const q of this.quadrants())
      for (const code of q.teeth) {
        const v: ToothView = { code, whole: null, top: null, bottom: null, left: null, right: null, centre: null, crosses: [], label: '' };
        const on = this.marks().filter((m) => m.tooth === code);
        const topS: Surface = q.upper ? 'B' : 'L';
        const botS: Surface = q.upper ? 'L' : 'B';
        const leftS: Surface = q.leftSide ? 'D' : 'M';
        const rightS: Surface = q.leftSide ? 'M' : 'D';
        for (const m of on) {
          const col = this.colour(m.condition);
          if (!m.surfaces.length) v.whole ??= col;
          if (m.surfaces.includes(topS)) v.top = col;
          if (m.surfaces.includes(botS)) v.bottom = col;
          if (m.surfaces.includes(leftS)) v.left = col;
          if (m.surfaces.includes(rightS)) v.right = col;
          if (m.surfaces.includes('O')) v.centre = col;
          if (this.conditions().find((c) => c.key === m.condition)?.cross) v.crosses.push(col);
        }
        const what = on.map((m) => this.condLabel(m.condition).toLowerCase() + (m.surfaces.length ? ' (' + m.surfaces.map((s) => surfaceWord(code, s)).join(', ') + ')' : ''));
        v.label = `Tooth ${code}, ${toothName(code)}${what.length ? ': ' + what.join('; ') : ''}`;
        map.set(code, v);
      }
    return map;
  });

  protected view = (code: string): ToothView => this.views().get(code)!;
  protected hasMark = (code: string, cond: string): boolean => this.marks().some((m) => m.tooth === code && m.condition === cond);
  protected hasMarkOn = (code: string): boolean => this.marks().some((m) => m.tooth === code);

  protected select(code: string): void {
    if (this.disabled() && !this.hasMarkOn(code)) return;
    if (this.selected() === code) {
      this.selected.set(null);
      return;
    }
    // a marked tooth from the list below may be on the other set of teeth
    if (this.dentition() === 'mixed') this.baby.set(code[0] >= '5');
    this.selected.set(code);
    this.active.set(this.marks().find((m) => m.tooth === code)?.condition ?? null);
  }

  /** The condition whose surfaces can be set on this tooth right now. */
  protected surfaceCondition(code: string): ToothCondition | null {
    const key = this.active();
    const c = this.conditions().find((x) => x.key === key);
    return c?.surfaces && this.hasMark(code, c.key) ? c : null;
  }

  protected surfaceOn = (code: string, cond: string, s: Surface): boolean =>
    !!this.marks().find((m) => m.tooth === code && m.condition === cond)?.surfaces.includes(s);

  protected crossFor(code: string): { pos: string; surface: Surface; word: string }[] {
    const q = this.quadrants().find((x) => x.teeth.includes(code));
    const upper = q?.upper ?? true;
    const left = q?.leftSide ?? true;
    const at = (pos: string, surface: Surface) => ({ pos, surface, word: cap(surfaceWord(code, surface)) });
    return [at('top', upper ? 'B' : 'L'), at('left', left ? 'D' : 'M'), at('centre', 'O'), at('right', left ? 'M' : 'D'), at('bottom', upper ? 'L' : 'B')];
  }

  protected tapCondition(code: string, cond: string): void {
    const has = this.hasMark(code, cond);
    if (!has) {
      this.active.set(cond);
      this.write([...this.marks(), { tooth: code, condition: cond, surfaces: [] }]);
    } else if (this.active() !== cond) {
      this.active.set(cond);
    } else {
      this.active.set(null);
      this.write(this.marks().filter((m) => !(m.tooth === code && m.condition === cond)));
    }
  }

  protected tapSurface(code: string, cond: string, s: Surface): void {
    this.write(
      this.marks().map((m) => {
        if (m.tooth !== code || m.condition !== cond) return m;
        const on = m.surfaces.includes(s);
        return { ...m, surfaces: (on ? m.surfaces.filter((x) => x !== s) : [...m.surfaces, s]).sort((a, b) => SURFACES.indexOf(a) - SURFACES.indexOf(b)) };
      }),
    );
  }

  protected clearTooth(code: string): void {
    this.active.set(null);
    this.write(this.marks().filter((m) => m.tooth !== code));
  }

  protected setNote(v: string): void {
    const note = v.trim();
    this.commit(this.marks(), note);
  }

  private write(marks: Required<ToothMark>[]): void {
    this.commit(marks, this.note());
  }

  private commit(marks: Required<ToothMark>[], note: string): void {
    const out: ToothChartAnswer = {};
    if (marks.length) out.marks = marks.map((m) => (m.surfaces.length ? { tooth: m.tooth, condition: m.condition, surfaces: m.surfaces } : { tooth: m.tooth, condition: m.condition }));
    if (note) out.note = note;
    this.emit(Object.keys(out).length ? out : undefined);
  }
}
