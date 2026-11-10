import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { NumpadComponent, numberText, parseNumber } from '../../fill/numpad.component';
import { feId } from '../../fill/contract';
import { GridCellValue, GridField, GridPreset, GridSlot, resolveChip } from './grid-model';

/** More options than this and a searchable list is quicker than buttons (the choice kind's rule). */
const BUTTONS_MAX = 8;

/** What the cell panel asks the grid to do. */
export type CellPanelAction =
  | { kind: 'set'; slot: GridSlot; value: GridCellValue | null; oneTap: boolean }
  | { kind: 'fill'; slot: GridSlot; along: 'row' | 'column' }
  | { kind: 'chip'; preset: GridPreset; scope: 'row' | 'column' }
  | { kind: 'move'; dir: 1 | -1 }
  | { kind: 'close' };

export interface CellPanelChip {
  preset: GridPreset;
  scope: 'row' | 'column';
  active: boolean;
}

/**
 * The cell sheet (plan §4 "tap a cell → that cell's control"): opened INLINE under the tapped row, full
 * width, so the iPad keyboard never covers it and nothing floats (the numpad's rule). The right input per
 * field: buttons (or a searchable list) for a choice, Yes / No, the in-app number pad, a text box.
 * Previous / next cell, "Same for the whole row / column", the row's and column's Quick Fill chips, Done.
 */
@Component({
  selector: 'fe-grid-cell',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, NumpadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-gsheet" [attr.aria-labelledby]="titleId" data-cell-sheet data-no-swipe>
      <header class="fe-gsheet__head">
        <span class="fe-gsheet__title" [id]="titleId">
          @if (where()) {
            <span class="fe-gsheet__where">{{ where() }}</span>
          }
          <span class="fe-gsheet__what">{{ heading() }}</span>
        </span>
        <span class="fe-gsheet__nav">
          <button type="button" class="fe-iconbtn" aria-label="Previous cell" data-act="prev" [disabled]="!canPrev()" (click)="act.emit({ kind: 'move', dir: -1 })">
            <pf-icon name="chevron-left" [size]="20" />
          </button>
          <button type="button" class="fe-iconbtn" aria-label="Next cell" data-act="next" [disabled]="!canNext()" (click)="act.emit({ kind: 'move', dir: 1 })">
            <pf-icon name="chevron-right" [size]="20" />
          </button>
        </span>
      </header>

      @for (s of slots(); track s.slot) {
        <div class="fe-gsheet__field" [attr.data-slot]="s.slot">
          @if (slots().length > 1 || s.field.type === 'yesno') {
            <span class="fe-sub__lbl" [id]="labelIdOf(s)">{{ s.field.label }}</span>
          }
          @switch (s.field.type ?? 'text') {
            @case ('choice') {
              @if (useSelect(s.field)) {
                <pf-select
                  [options]="selectOptions(s.field)"
                  [value]="valueOf(s)"
                  [searchable]="true"
                  [placeholder]="'Choose ' + s.field.label.toLowerCase()"
                  (valueChange)="set(s, $event, true)"
                />
              } @else {
                <div class="fe-chips" role="radiogroup" [attr.aria-label]="s.field.label">
                  @for (o of s.field.options ?? []; track o.key) {
                    <button
                      type="button"
                      class="fe-chip"
                      role="radio"
                      [attr.data-option]="o.key"
                      [attr.aria-checked]="o.key === valueOf(s)"
                      (click)="set(s, o.key === valueOf(s) ? null : o.key, true)"
                    >
                      <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                      {{ o.label }}
                    </button>
                  }
                </div>
              }
            }
            @case ('yesno') {
              <div class="fe-chips" role="radiogroup" [attr.aria-labelledby]="labelIdOf(s)">
                @for (b of yesNo; track b.v) {
                  <button
                    type="button"
                    class="fe-chip"
                    role="radio"
                    [attr.data-option]="b.label"
                    [attr.aria-checked]="valueOf(s) === b.v"
                    (click)="set(s, valueOf(s) === b.v ? null : b.v, true)"
                  >
                    <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                    {{ b.label }}
                  </button>
                }
              </div>
            }
            @case ('number') {
              <div class="fe-gsheet__num">
                <span class="fe-numbox fe-numbox--static" aria-live="polite" [attr.aria-label]="s.field.label + ': ' + (numText(s) || 'empty')">
                  <span class="fe-numbox__v">{{ numText(s) || '–' }}</span>
                  @if (s.field.unit) {
                    <span class="fe-numbox__u">{{ s.field.unit }}</span>
                  }
                </span>
              </div>
              <fe-numpad
                [label]="s.field.label"
                [text]="numText(s)"
                (textChange)="typeNumber(s, $event)"
                (done)="act.emit({ kind: 'move', dir: 1 })"
              />
            }
            @default {
              <input
                class="fe-text__input fe-gsheet__text"
                type="text"
                [attr.data-text]="s.slot"
                [attr.aria-label]="s.field.label"
                [attr.maxlength]="500"
                [placeholder]="s.field.placeholder || ''"
                [value]="valueOf(s) ?? ''"
                (input)="typeText(s, $any($event.target).value)"
                (keydown.enter)="act.emit({ kind: 'move', dir: 1 })"
              />
              @if (textChips(s).length) {
                <div class="fe-chips fe-gsheet__quick" role="group" [attr.aria-label]="'Quick words for ' + s.field.label">
                  @for (c of textChips(s); track c) {
                    <button type="button" class="fe-chip" [attr.aria-pressed]="valueOf(s) === c" (click)="set(s, valueOf(s) === c ? null : c, false)">{{ c }}</button>
                  }
                </div>
              }
            }
          }
        </div>
      }

      @if (chips().length) {
        <div class="fe-gsheet__chips" role="group" aria-label="Quick fill for this row or column">
          @for (c of chips(); track c.scope + c.preset.label) {
            <button
              type="button"
              class="fe-chip"
              [attr.data-chip]="c.preset.label"
              [attr.data-scope]="c.scope"
              [attr.aria-pressed]="c.active"
              (click)="act.emit({ kind: 'chip', preset: c.preset, scope: c.scope })"
            >
              <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
              {{ c.preset.label }}
              <span class="fe-gsheet__scope">{{ c.scope === 'row' ? rowName() : columnName() }}</span>
            </button>
          }
        </div>
      }

      <footer class="fe-gsheet__foot">
        @if (fillRow()) {
          <button type="button" class="pf-btn pf-btn--tertiary" data-act="fill-row" (click)="act.emit({ kind: 'fill', slot: slots()[0], along: 'row' })">
            <pf-icon name="arrow-right" [size]="18" /> Same for all of {{ rowName() }}
          </button>
        }
        @if (fillColumn()) {
          <button type="button" class="pf-btn pf-btn--tertiary" data-act="fill-column" (click)="act.emit({ kind: 'fill', slot: slots()[0], along: 'column' })">
            <pf-icon name="arrow-down" [size]="18" /> Same for all of {{ columnName() }}
          </button>
        }
        <span class="fe-gsheet__spacer"></span>
        <button type="button" class="pf-btn pf-btn--secondary" data-act="done" (click)="act.emit({ kind: 'close' })">Done</button>
      </footer>
    </section>
  `,
})
export class GridCellPanelComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The slots of the open cell (one, or a cell's own list). */
  readonly slots = input.required<GridSlot[]>();
  readonly values = input.required<Record<string, GridCellValue | null>>();
  readonly rowHeader = input<string>('');
  readonly chips = input<CellPanelChip[]>([]);
  /** All-scope chip words that fit this text cell (offered as quick words). */
  readonly words = input<string[]>([]);
  readonly canPrev = input<boolean>(false);
  readonly canNext = input<boolean>(false);
  /** Cells "Same for the whole row / column" would write (0 hides the button). */
  readonly rowFill = input<number>(0);
  readonly columnFill = input<number>(0);
  readonly act = output<CellPanelAction>();

  protected readonly titleId = feId('fe-gsheet');
  protected readonly yesNo = [
    { v: true, label: 'Yes' },
    { v: false, label: 'No' },
  ];
  private readonly ids = new Map<string, string>();

  protected readonly first = computed(() => this.slots()[0] ?? null);
  protected readonly rowName = computed(() => {
    const s = this.first();
    if (!s) return '';
    const head = this.rowHeader().trim();
    return s.rowLabel ? (head ? `${head.toLowerCase()} ${s.rowLabel}` : s.rowLabel) : 'the row';
  });
  protected readonly columnName = computed(() => this.first()?.columnLabel || 'the column');
  protected readonly where = computed(() => {
    const s = this.first();
    if (!s) return '';
    const head = this.rowHeader().trim();
    return s.rowLabel ? (head ? `${head} ${s.rowLabel}` : s.rowLabel) : '';
  });
  protected readonly heading = computed(() => this.first()?.columnLabel || this.first()?.field.label || '');

  private single = computed(() => this.slots().length === 1);
  private hasValue = computed(() => {
    const s = this.first();
    return !!s && this.values()[s.slot] !== null && this.values()[s.slot] !== undefined;
  });
  protected readonly fillRow = computed(() => this.single() && this.hasValue() && this.rowFill() > 0);
  protected readonly fillColumn = computed(() => this.single() && this.hasValue() && this.columnFill() > 0);

  /** Typed numbers stay as text while typing ("12." survives); written as a number. */
  private readonly typing = signal<Record<string, string>>({});

  constructor() {
    // A new cell: bring the sheet into view and put the cursor in a lone text box (the keyboard is the input there).
    let last = '';
    effect(() => {
      const key = this.slots().map((s) => `${s.rowKey}/${s.slot}`).join('|');
      if (key === last) return;
      last = key;
      this.typing.set({});
      setTimeout(() => {
        const el = this.host.nativeElement;
        el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        if (this.slots().length === 1) el.querySelector<HTMLInputElement>('input.fe-gsheet__text')?.focus({ preventScroll: true });
      }, 60);
    });
  }

  protected labelIdOf(s: GridSlot): string {
    let id = this.ids.get(s.slot);
    if (!id) this.ids.set(s.slot, (id = feId('fe-gsl')));
    return id;
  }

  protected valueOf(s: GridSlot): GridCellValue | null {
    const v = this.values()[s.slot];
    return v === undefined ? null : v;
  }

  protected useSelect(f: GridField): boolean {
    return f.display === 'dropdown' || (f.options?.length ?? 0) > BUTTONS_MAX;
  }

  protected selectOptions(f: GridField): PfSelectOption<string>[] {
    return (f.options ?? []).map((o) => ({ value: o.key, label: o.label }));
  }

  protected numText(s: GridSlot): string {
    return this.typing()[s.slot] ?? numberText(this.valueOf(s));
  }

  protected textChips(s: GridSlot): string[] {
    return this.words().filter((w) => resolveChip(s.field, w) !== undefined);
  }

  protected set(s: GridSlot, value: GridCellValue | null, oneTap: boolean): void {
    // a one-tap answer moves on only when the cell holds one field (several fields: the doctor finishes the cell)
    this.act.emit({ kind: 'set', slot: s, value, oneTap: oneTap && value !== null && this.single() });
  }

  protected typeText(s: GridSlot, text: string): void {
    this.act.emit({ kind: 'set', slot: s, value: text === '' ? null : text.slice(0, 500), oneTap: false });
  }

  protected typeNumber(s: GridSlot, text: string): void {
    this.typing.update((t) => ({ ...t, [s.slot]: text }));
    this.act.emit({ kind: 'set', slot: s, value: parseNumber(text), oneTap: false });
  }
}
