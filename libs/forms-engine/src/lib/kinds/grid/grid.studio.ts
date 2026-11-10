import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Type,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FeDialog, PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { ApplyFieldChange } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { FE_KINDS, KindFill, feId, kindControl } from '../../fill/contract';
import {
  CELL_TOKENS,
  ROW_TOKENS,
  addColumn,
  addHeading,
  addOption,
  addPreset,
  addRows,
  cellOverride,
  gridLimitWords,
  mergeRight,
  moveColumn,
  moveRow,
  noBox,
  parseRowLabels,
  removeColumn,
  removeHeading,
  removeOption,
  removePreset,
  removeRow,
  renameOption,
  renameRow,
  restoreBox,
  serialiseGrid,
  setColumnType,
  setLabelSpan,
  setQuickFill,
  setRowHeader,
  setSentences,
  tokenParts,
  unmerge,
  updateColumn,
  updateHeading,
  updatePreset,
} from './grid-edits';
import { GRID_LIMITS, GridAnswer, GridConfig, GridField, GridFieldType, GridScope, gridConfig } from './grid-model';

type Token = { text: string; label: string };

/** Answer types in doctor words. */
export const GRID_TYPES: { value: GridFieldType; label: string }[] = [
  { value: 'text', label: 'Words' },
  { value: 'number', label: 'Number' },
  { value: 'choice', label: 'Choice' },
  { value: 'yesno', label: 'Yes or no' },
];
const SCOPES: { value: GridScope; label: string }[] = [
  { value: 'all', label: 'Every cell' },
  { value: 'row', label: 'One row' },
  { value: 'column', label: 'One column' },
];

/**
 * The real filler's table (loaded through the kind registry, so Studio shows exactly what the doctor gets), with
 * try-out answers that are never saved.
 */
@Component({
  selector: 'fe-grid-tryout',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="fe-gedit__k" [id]="labelId">{{ field().label }}</span>
    @if (control(); as c) {
      <ng-container
        [ngComponentOutlet]="c"
        [ngComponentOutletInputs]="{ field: field(), value: value(), set: set, labelId: labelId, scope: {}, disabled: false }"
      />
    } @else {
      <div class="fe-loading" role="status" aria-label="Opening the table"></div>
    }
  `,
})
export class GridTryoutComponent {
  readonly field = input.required<FieldDef>();
  protected readonly labelId = feId('fe-gtry');
  protected readonly value = signal<GridAnswer | undefined>(undefined);
  protected readonly control = signal<Type<KindFill> | null>(null);
  protected readonly set = (v: unknown) => this.value.set(v as GridAnswer | undefined);

  constructor() {
    const spec = inject(FE_KINDS, { optional: true })?.['grid'];
    if (spec) {
      const c = kindControl(spec);
      if (c instanceof Promise)
        c.then(
          (x) => this.control.set(x),
          () => undefined,
        );
      else this.control.set(c);
    }
  }

  clear(): void {
    this.value.set(undefined);
  }
}

/**
 * A sentence with placeholders, read as words ("‹the box name›: ‹the answer›"); tap to edit it in a box with
 * "Put in" chips (the established Studio sentence pattern). Saves on Done.
 */
@Component({
  selector: 'fe-gwords',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing()) {
      <div class="fe-gwords__edit">
        <input
          #boxEl
          class="pf-input"
          type="text"
          [attr.aria-label]="label()"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
          (keydown.enter)="done()"
          (keydown.escape)="$event.stopPropagation(); editing.set(false)"
        />
        <div class="fe-gwords__put" role="group" aria-label="Put in">
          <span class="fe-gwords__k">Put in</span>
          @for (t of tokens(); track t.text) {
            <button type="button" class="fe-chip fe-gwords__tok" (click)="put(t.text)"><pf-icon name="plus" [size]="14" /> {{ t.label }}</button>
          }
        </div>
        <div class="fe-gwords__acts">
          <button type="button" class="pf-btn pf-btn--tertiary" (click)="editing.set(false)">Cancel</button>
          <button type="button" class="pf-btn pf-btn--secondary" data-act="words-done" (click)="done()">
            <pf-icon name="check" [size]="18" /> Done
          </button>
        </div>
      </div>
    } @else {
      <button type="button" class="fe-gwords__read pf-touch" [attr.aria-label]="label() + ': ' + plain()" (click)="open()">
        <span class="fe-gwords__text">
          @for (p of parts(); track $index) {
            @if (p.token) {
              <span class="fe-gwords__chip">{{ p.text }}</span>
            } @else {
              <span>{{ p.text }}</span>
            }
          }
        </span>
        <pf-icon name="pen" [size]="16" />
      </button>
    }
  `,
})
export class GridWordsComponent {
  readonly value = input<string>('');
  /** Shown (in words) when there is no value of its own. */
  readonly fallback = input<string>('');
  readonly label = input<string>('Says');
  readonly tokens = input<readonly Token[]>(CELL_TOKENS);
  readonly save = output<string>();

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  private readonly boxEl = viewChild<ElementRef<HTMLInputElement>>('boxEl');
  protected readonly parts = computed(() => tokenParts(this.value() || this.fallback(), this.tokens()));
  protected readonly plain = computed(() => this.parts().map((p) => p.text).join(''));

  protected open(): void {
    this.draft.set(this.value() || this.fallback());
    this.editing.set(true);
    setTimeout(() => this.boxEl()?.nativeElement.focus());
  }

  protected put(text: string): void {
    const el = this.boxEl()?.nativeElement;
    const cur = this.draft();
    const at = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? at;
    this.draft.set(cur.slice(0, at) + text + cur.slice(end));
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  }

  protected done(): void {
    const v = this.draft().trim();
    this.save.emit(v === this.fallback() ? '' : v);
    this.editing.set(false);
  }
}

/** Shared: config in, a change through `apply` (one Studio edit per change). */
@Directive()
abstract class GridEditing {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
  protected readonly cfg = computed(() => gridConfig(this.field()));
  /** A plain-words note for an edit that was refused (a limit, an overlap). */
  protected readonly note = signal('');

  /** Run a pure edit; nothing is written when it is refused (the same config comes back). */
  protected edit(fn: (c: GridConfig) => GridConfig, refused = ''): boolean {
    const before = this.cfg();
    const next = fn(before);
    if (next === before) {
      this.note.set(refused);
      return false;
    }
    this.note.set('');
    const stored = serialiseGrid(next);
    this.apply()((f) => (f.config = stored));
    return true;
  }
}

interface RowCell {
  key: string;
  label: string;
  state: string;
  covered: boolean;
  merged: boolean;
  none: boolean;
  own: boolean;
  canMerge: boolean;
}

/**
 * The table editor, full screen (desktop first; works on a tablet): columns (heading, answer type, unit, choices,
 * starting answer, its words), rows (typed in one go, "18-11" for a quadrant; merged labels; per-cell merge and
 * "no box"), merged headings, Quick fill chips, the row sentence — beside the real table as the doctor will see
 * it. Lifted to <body> while open (ENGINEERING-RULES: a full-screen overlay is lifted).
 */
@Component({
  selector: 'fe-grid-editor',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, GridWordsComponent, GridTryoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fe-gedit',
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': "'Table: ' + field().label",
    '(keydown.escape)': 'closed.emit()',
  },
  template: `
    <header class="fe-gedit__bar">
      <span class="fe-gedit__icon" aria-hidden="true"><pf-icon name="k-grid" [size]="18" /></span>
      <h2 class="fe-gedit__title">Table · {{ field().label }}</h2>
      <span class="fe-gedit__sum">{{ summary() }}</span>
      <span class="fe-gedit__spacer"></span>
      <button type="button" class="pf-btn pf-btn--primary" data-act="close-editor" (click)="closed.emit()"><pf-icon name="check" [size]="18" /> Done</button>
    </header>
    <div class="pf-card__body fe-gedit__body">
      <div class="fe-gedit__cols">
        <div class="fe-gedit__edit">
          <div class="fe-chips fe-gedit__tabs" role="tablist" aria-label="Parts of the table">
            @for (t of tabs; track t.id) {
              <button
                type="button"
                class="fe-chip"
                role="tab"
                [attr.data-tab]="t.id"
                [attr.aria-selected]="tab() === t.id"
                [attr.aria-pressed]="tab() === t.id"
                (click)="tab.set(t.id); note.set('')"
              >
                <pf-icon [name]="t.icon" [size]="16" /> {{ t.label }}
              </button>
            }
          </div>
          @if (note()) {
            <p class="fe-gedit__note" role="alert">{{ note() }}</p>
          }

          @switch (tab()) {
            @case ('columns') {
              <ol class="fe-gedit__list" aria-label="Columns">
                @for (c of cfg().columns; track c.key; let i = $index; let first = $first; let last = $last) {
                  <li class="fe-gedit__item" [attr.data-column]="c.key">
                    <div class="fe-gedit__row">
                      <span class="fe-gedit__n" aria-hidden="true">{{ i + 1 }}</span>
                      <input
                        class="pf-input"
                        type="text"
                        [attr.aria-label]="'Column ' + (i + 1) + ' heading'"
                        [value]="c.label"
                        (change)="renameColumn(i, $any($event.target).value)"
                      />
                      <button type="button" class="fe-iconbtn" [attr.aria-label]="'Move ' + c.label + ' left'" [disabled]="first" (click)="edit(moveCol(i, -1))">
                        <pf-icon name="chevron-left" [size]="20" />
                      </button>
                      <button type="button" class="fe-iconbtn" [attr.aria-label]="'Move ' + c.label + ' right'" [disabled]="last" (click)="edit(moveCol(i, 1))">
                        <pf-icon name="chevron-right" [size]="20" />
                      </button>
                      <button
                        type="button"
                        class="fe-iconbtn"
                        data-act="open-column"
                        [attr.aria-label]="(openCol() === c.key ? 'Close ' : 'Open ') + c.label"
                        [attr.aria-expanded]="openCol() === c.key"
                        (click)="openCol.set(openCol() === c.key ? null : c.key)"
                      >
                        <pf-icon [name]="openCol() === c.key ? 'minus' : 'more'" [size]="20" />
                      </button>
                    </div>
                    <p class="fe-gedit__hint">{{ typeWords(c) }}</p>
                    @if (openCol() === c.key) {
                      <div class="fe-gedit__detail">
                        <span class="fe-gedit__k">Answer</span>
                        <div class="fe-chips" role="radiogroup" [attr.aria-label]="c.label + ': answer'">
                          @for (t of types; track t.value) {
                            <button type="button" class="fe-chip" role="radio" [attr.data-type]="t.value" [attr.aria-checked]="(c.type ?? 'text') === t.value" (click)="edit(setType(i, t.value))">
                              {{ t.label }}
                            </button>
                          }
                        </div>
                        @if (c.type === 'number') {
                          <label class="fe-gedit__lbl"
                            >Unit <span class="fe-gedit__opt">(optional)</span>
                            <input class="pf-input fe-gedit__short" type="text" data-input="unit" placeholder="e.g. mm" [value]="c.unit ?? ''" (change)="setCol(i, 'unit', $any($event.target).value)" />
                          </label>
                        }
                        @if (c.type === 'choice') {
                          <span class="fe-gedit__k">Choices</span>
                          <ul class="fe-gedit__opts">
                            @for (o of c.options ?? []; track o.key) {
                              <li class="fe-gedit__row">
                                <input class="pf-input" type="text" [attr.aria-label]="'Choice ' + o.label" [value]="o.label" (change)="edit(renameOpt(i, o.key, $any($event.target).value))" />
                                <button
                                  type="button"
                                  class="fe-iconbtn"
                                  [attr.aria-label]="'Remove the choice ' + o.label"
                                  [disabled]="(c.options?.length ?? 0) <= 1"
                                  (click)="edit(removeOpt(i, o.key))"
                                >
                                  <pf-icon name="trash" [size]="18" />
                                </button>
                              </li>
                            }
                          </ul>
                          <div class="fe-gedit__row">
                            <input #optEl class="pf-input" type="text" data-input="new-choice" placeholder="Add a choice" [attr.aria-label]="'Add a choice to ' + c.label" (keydown.enter)="addOpt(i, optEl)" />
                            <button type="button" class="pf-btn pf-btn--secondary" data-act="add-choice" (click)="addOpt(i, optEl)"><pf-icon name="plus" [size]="18" /> Add</button>
                          </div>
                          <span class="fe-gedit__k">Shown as</span>
                          <div class="fe-chips" role="radiogroup" [attr.aria-label]="c.label + ': shown as'">
                            <button type="button" class="fe-chip" role="radio" [attr.aria-checked]="c.display !== 'dropdown'" (click)="setCol(i, 'display', undefined)">Buttons</button>
                            <button type="button" class="fe-chip" role="radio" [attr.aria-checked]="c.display === 'dropdown'" (click)="setCol(i, 'display', 'dropdown')">A list to search</button>
                          </div>
                        }
                        <span class="fe-gedit__k">Starts with <span class="fe-gedit__opt">(on a new case sheet; the doctor can change it)</span></span>
                        @switch (c.type ?? 'text') {
                          @case ('choice') {
                            <pf-select [options]="defaultChoices(c)" [value]="c.default ?? ''" placeholder="Nothing" (valueChange)="setCol(i, 'default', $event || undefined)" />
                          }
                          @case ('yesno') {
                            <div class="fe-chips" role="radiogroup" [attr.aria-label]="c.label + ': starts with'">
                              <button type="button" class="fe-chip" role="radio" [attr.aria-checked]="c.default === undefined" (click)="setCol(i, 'default', undefined)">Nothing</button>
                              <button type="button" class="fe-chip" role="radio" [attr.aria-checked]="c.default === true" (click)="setCol(i, 'default', true)">Yes</button>
                              <button type="button" class="fe-chip" role="radio" [attr.aria-checked]="c.default === false" (click)="setCol(i, 'default', false)">No</button>
                            </div>
                          }
                          @default {
                            <input
                              class="pf-input"
                              type="text"
                              data-input="default"
                              placeholder="Nothing"
                              [attr.aria-label]="c.label + ': starts with'"
                              [value]="c.default ?? ''"
                              (change)="setDefault(i, c, $any($event.target).value)"
                            />
                          }
                        }
                        <span class="fe-gedit__k">In the sentences</span>
                        <button type="button" role="switch" class="pf-toggle fe-gedit__switch pf-touch" data-act="include" [attr.aria-checked]="c.says?.include !== false" (click)="toggleInclude(i, c)">
                          <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
                          <span>{{ c.says?.include === false ? 'Left out of the sentences' : 'Written in the sentences' }}</span>
                        </button>
                        @if (c.says?.include !== false) {
                          <fe-gwords [value]="c.says?.template ?? ''" fallback="{label}: {value}" [label]="c.label + ' says'" (save)="setTemplate(i, $event)" />
                          <label class="fe-gedit__lbl"
                            >Its name in the sentences <span class="fe-gedit__opt">(when it differs from the heading)</span>
                            <input class="pf-input" type="text" data-input="field-label" [placeholder]="c.label" [value]="c.fieldLabel ?? ''" (change)="setCol(i, 'fieldLabel', $any($event.target).value)" />
                          </label>
                        }
                        <div class="fe-gedit__acts">
                          <button type="button" class="pf-btn pf-btn--tertiary" data-act="remove-column" [disabled]="cfg().columns.length <= 1" (click)="askRemoveColumn(i, c)">
                            <pf-icon name="trash" [size]="18" /> Remove this column
                          </button>
                        </div>
                      </div>
                    }
                  </li>
                }
              </ol>
              <div class="fe-gedit__row">
                <input #colEl class="pf-input" type="text" data-input="new-column" placeholder="New column heading" aria-label="New column heading" (keydown.enter)="addCol(colEl)" />
                <button type="button" class="pf-btn pf-btn--secondary" data-act="add-column" (click)="addCol(colEl)"><pf-icon name="plus" [size]="18" /> Add a column</button>
              </div>
            }

            @case ('rows') {
              <label class="fe-gedit__lbl"
                >Heading of the first column <span class="fe-gedit__opt">(e.g. Tooth)</span>
                <input class="pf-input" type="text" data-input="row-header" [value]="cfg().rowHeader ?? ''" (change)="edit(rowHeader($any($event.target).value))" />
              </label>
              <div class="fe-gedit__add">
                <label class="fe-gedit__lbl" for="fe-gedit-rows">Add rows</label>
                <p class="fe-gedit__hint">One per line or separated by commas. 18-11 counts down, 21-28 counts up.</p>
                <textarea id="fe-gedit-rows" #rowsEl class="pf-input fe-gedit__area" rows="2" data-input="new-rows" placeholder="e.g. 18-11, or Lids, Conjunctiva, Cornea"></textarea>
                <div>
                  <button type="button" class="pf-btn pf-btn--secondary" data-act="add-rows" (click)="addRowsFrom(rowsEl)"><pf-icon name="plus" [size]="18" /> Add these rows</button>
                </div>
              </div>
              <ol class="fe-gedit__list" aria-label="Rows">
                @for (r of cfg().rows; track r.key; let i = $index; let first = $first; let last = $last) {
                  <li class="fe-gedit__item" [attr.data-row]="r.key" [class.fe-gedit__item--under]="underMerge(i)">
                    <div class="fe-gedit__row">
                      <span class="fe-gedit__n" aria-hidden="true">{{ i + 1 }}</span>
                      <input
                        class="pf-input"
                        type="text"
                        [attr.aria-label]="'Row ' + (i + 1)"
                        [value]="r.label"
                        [placeholder]="underMerge(i) ? 'Under the merged label above' : 'No label'"
                        (change)="edit(renameRowAt(i, $any($event.target).value))"
                      />
                      <button type="button" class="fe-iconbtn" [attr.aria-label]="'Move ' + (r.label || 'row ' + (i + 1)) + ' up'" [disabled]="first" (click)="edit(moveRowAt(i, -1))">
                        <pf-icon name="arrow-up" [size]="20" />
                      </button>
                      <button type="button" class="fe-iconbtn" [attr.aria-label]="'Move ' + (r.label || 'row ' + (i + 1)) + ' down'" [disabled]="last" (click)="edit(moveRowAt(i, 1))">
                        <pf-icon name="arrow-down" [size]="20" />
                      </button>
                      <button
                        type="button"
                        class="fe-iconbtn"
                        data-act="open-row"
                        [attr.aria-label]="(openRow() === r.key ? 'Close ' : 'Open ') + (r.label || 'row ' + (i + 1))"
                        [attr.aria-expanded]="openRow() === r.key"
                        (click)="openRow.set(openRow() === r.key ? null : r.key)"
                      >
                        <pf-icon [name]="openRow() === r.key ? 'minus' : 'more'" [size]="20" />
                      </button>
                    </div>
                    @if (openRow() === r.key) {
                      <div class="fe-gedit__detail">
                        <span class="fe-gedit__k">Its label covers</span>
                        <div class="fe-stepper">
                          <button type="button" class="fe-stepper__btn" aria-label="Cover one row fewer" [disabled]="(r.labelSpan ?? 1) <= 1" (click)="edit(span(i, (r.labelSpan ?? 1) - 1))">
                            <pf-icon name="minus" [size]="20" />
                          </button>
                          <span class="fe-numbox fe-numbox--static" aria-live="polite"
                            ><span class="fe-numbox__v">{{ r.labelSpan ?? 1 }}</span><span class="fe-numbox__u">{{ (r.labelSpan ?? 1) === 1 ? 'row' : 'rows' }}</span></span
                          >
                          <button
                            type="button"
                            class="fe-stepper__btn"
                            aria-label="Cover one more row"
                            data-act="span-more"
                            [disabled]="i + (r.labelSpan ?? 1) >= cfg().rows.length"
                            (click)="edit(span(i, (r.labelSpan ?? 1) + 1))"
                          >
                            <pf-icon name="plus" [size]="20" />
                          </button>
                        </div>
                        <span class="fe-gedit__k">Cells in this row</span>
                        <ul class="fe-gedit__cells">
                          @for (c of rowCells(i); track c.key) {
                            <li class="fe-gedit__cell" [attr.data-cell]="c.key">
                              <span class="fe-gedit__cellname">{{ c.label }}</span>
                              <span class="fe-gedit__cellstate">{{ c.state }}</span>
                              @if (!c.covered) {
                                <span class="fe-gedit__cellacts">
                                  @if (c.canMerge) {
                                    <button type="button" class="pf-btn pf-btn--tertiary" data-act="merge" (click)="edit(merge(i, c.key))">Merge with the next column</button>
                                  }
                                  @if (c.merged) {
                                    <button type="button" class="pf-btn pf-btn--tertiary" data-act="unmerge" (click)="edit(split(i, c.key))">Unmerge</button>
                                  }
                                  @if (c.none) {
                                    <button type="button" class="pf-btn pf-btn--tertiary" data-act="restore" (click)="edit(restore(i, c.key))">Put the box back</button>
                                  } @else if (!c.own) {
                                    <button type="button" class="pf-btn pf-btn--tertiary" data-act="no-box" (click)="edit(none(i, c.key))">No box here</button>
                                  }
                                </span>
                              }
                            </li>
                          }
                        </ul>
                        <div class="fe-gedit__acts">
                          <button type="button" class="pf-btn pf-btn--tertiary" data-act="remove-row" [disabled]="cfg().rows.length <= 1" (click)="edit(removeRowAt(i))">
                            <pf-icon name="trash" [size]="18" /> Remove this row
                          </button>
                        </div>
                      </div>
                    }
                  </li>
                }
              </ol>
            }

            @case ('headings') {
              <p class="fe-gedit__hint">A heading over several columns, e.g. Right eye over Distance and Near.</p>
              <ul class="fe-gedit__list" aria-label="Merged headings">
                @for (g of cfg().headerGroups ?? []; track $index; let i = $index) {
                  <li class="fe-gedit__item" [attr.data-heading]="i">
                    <div class="fe-gedit__row">
                      <input class="pf-input" type="text" [attr.aria-label]="'Heading ' + (i + 1)" [value]="g.label" (change)="edit(heading(i, { label: $any($event.target).value.trim() }))" />
                      <button type="button" class="fe-iconbtn" [attr.aria-label]="'Remove the heading ' + g.label" (click)="edit(dropHeading(i))"><pf-icon name="trash" [size]="18" /></button>
                    </div>
                    <div class="fe-gedit__pair">
                      <span class="fe-gedit__k">Starts at</span>
                      <pf-select [options]="columnChoices()" [value]="g.from" (valueChange)="$event && edit(heading(i, { from: $event }), overlap)" />
                      <span class="fe-gedit__k">Covers</span>
                      <div class="fe-stepper">
                        <button type="button" class="fe-stepper__btn" aria-label="One column fewer" [disabled]="(g.span ?? 1) <= 1" (click)="edit(heading(i, { span: (g.span ?? 1) - 1 }))">
                          <pf-icon name="minus" [size]="20" />
                        </button>
                        <span class="fe-numbox fe-numbox--static"
                          ><span class="fe-numbox__v">{{ g.span ?? 1 }}</span><span class="fe-numbox__u">{{ (g.span ?? 1) === 1 ? 'column' : 'columns' }}</span></span
                        >
                        <button type="button" class="fe-stepper__btn" aria-label="One column more" (click)="edit(heading(i, { span: (g.span ?? 1) + 1 }), overlap)">
                          <pf-icon name="plus" [size]="20" />
                        </button>
                      </div>
                    </div>
                  </li>
                } @empty {
                  <li class="fe-gedit__hint">No merged headings yet.</li>
                }
              </ul>
              <div>
                <button type="button" class="pf-btn pf-btn--secondary" data-act="add-heading" (click)="edit(newHeading, 'Every column already has a heading over it.')">
                  <pf-icon name="plus" [size]="18" /> Add a heading
                </button>
              </div>
            }

            @case ('quick') {
              <button
                type="button"
                role="switch"
                class="pf-toggle fe-gedit__switch pf-touch"
                data-act="quick-on"
                [attr.aria-checked]="cfg().quickFill?.enabled !== false"
                (click)="edit(quickOn(cfg().quickFill?.enabled === false))"
              >
                <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
                <span>Quick fill chips</span>
              </button>
              <p class="fe-gedit__hint">
                A chip fills every cell it fits: a box of words takes its words, a choice the choice of the same name, a number box a number, a yes or no box Yes or No. Tapping it again takes it back.
              </p>
              <ul class="fe-gedit__list" aria-label="Quick fill chips">
                @for (p of cfg().quickFill?.presets ?? []; track $index; let i = $index) {
                  <li class="fe-gedit__item" [attr.data-preset]="i">
                    <div class="fe-gedit__row">
                      <input class="pf-input" type="text" [attr.aria-label]="'Chip ' + (i + 1)" [value]="p.label" (change)="edit(preset(i, { label: $any($event.target).value }))" />
                      <button type="button" class="fe-iconbtn" [attr.aria-label]="'Remove the chip ' + p.label" (click)="edit(dropPreset(i))"><pf-icon name="trash" [size]="18" /></button>
                    </div>
                    <label class="fe-gedit__lbl"
                      >Writes <span class="fe-gedit__opt">(when it differs from the chip)</span>
                      <input class="pf-input" type="text" [placeholder]="p.label" [value]="p.value ?? ''" (change)="edit(preset(i, { value: $any($event.target).value }))" />
                    </label>
                    <div class="fe-chips" role="radiogroup" [attr.aria-label]="p.label + ': fills'">
                      @for (s of scopes; track s.value) {
                        <button type="button" class="fe-chip" role="radio" [attr.data-scope]="s.value" [attr.aria-checked]="(p.scope ?? 'all') === s.value" (click)="edit(preset(i, { scope: s.value }))">
                          {{ s.label }}
                        </button>
                      }
                    </div>
                  </li>
                }
              </ul>
              <div class="fe-gedit__row">
                <input #chipEl class="pf-input" type="text" data-input="new-chip" placeholder="e.g. All normal" aria-label="New chip" (keydown.enter)="addChip(chipEl)" />
                <button type="button" class="pf-btn pf-btn--secondary" data-act="add-chip" (click)="addChip(chipEl)"><pf-icon name="plus" [size]="18" /> Add a chip</button>
              </div>
            }

            @case ('words') {
              <p class="fe-gedit__hint">Used when the case sheet writes this table as sentences (In the case sheet, in the settings). Each row writes one sentence from its answers.</p>
              <span class="fe-gedit__k">Each row says</span>
              <fe-gwords [value]="cfg().sentences?.row ?? ''" fallback="{row}: {cells}" [tokens]="rowTokens" label="Each row says" (save)="edit(rowSentence($event))" />
              <label class="fe-gedit__lbl"
                >Between rows
                <input
                  class="pf-input fe-gedit__short"
                  type="text"
                  data-input="separator"
                  placeholder="a full stop"
                  [value]="cfg().sentences?.rowSeparator ?? ''"
                  (change)="edit(separator($any($event.target).value))"
                />
              </label>
              <p class="fe-gedit__hint">What each answer says is set per column (Columns, In the sentences).</p>
            }
          }
        </div>

        <aside class="fe-gedit__preview" aria-labelledby="fe-gedit-pv">
          <div class="fe-gedit__pvhead">
            <h3 class="fe-gedit__pvtitle" id="fe-gedit-pv">As the doctor sees it</h3>
            <button type="button" class="pf-btn pf-btn--tertiary" (click)="tryout()?.clear()"><pf-icon name="refresh" [size]="16" /> Start again</button>
          </div>
          <p class="fe-gedit__hint">Tap a cell to try it. Nothing is saved.</p>
          <fe-grid-tryout #tryEl [field]="field()" />
        </aside>
      </div>
    </div>
  `,
})
export class GridEditorComponent extends GridEditing {
  private readonly dialog = inject(FeDialog);
  readonly closed = output<void>();

  protected readonly tabs = [
    { id: 'columns', label: 'Columns', icon: 'columns' as const },
    { id: 'rows', label: 'Rows', icon: 'rows' as const },
    { id: 'headings', label: 'Headings', icon: 'k-grid' as const },
    { id: 'quick', label: 'Quick fill', icon: 'zap' as const },
    { id: 'words', label: 'Sentences', icon: 'text' as const },
  ];
  protected readonly types = GRID_TYPES;
  protected readonly scopes = SCOPES;
  protected readonly rowTokens = ROW_TOKENS;
  protected readonly overlap = 'That would run into another heading.';
  protected readonly tab = signal<string>('columns');
  protected readonly openCol = signal<string | null>(null);
  protected readonly openRow = signal<string | null>(null);
  protected readonly tryout = viewChild<GridTryoutComponent>('tryEl');

  protected readonly summary = computed(() => gridSummary(this.cfg()));
  protected readonly columnChoices = computed<PfSelectOption<string>[]>(() => this.cfg().columns.map((c) => ({ value: c.key, label: c.label || c.key })));

  constructor() {
    super();
    if (typeof document !== 'undefined') {
      // full screen above everything: lift the editor out of the settings card (a transform there would become the
      // box "fixed" is measured from)
      const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
      // after the first render: Angular inserts the host into the panel's view after the constructor
      afterNextRender(() => document.body.appendChild(host));
      const destroy = inject(DestroyRef);
      destroy.onDestroy(() => host.remove());
      document.documentElement.classList.add('fe-cv-locked');
      destroy.onDestroy(() => document.documentElement.classList.remove('fe-cv-locked'));
    }
  }

  // edit builders (pure functions, bound for the template)
  protected readonly moveCol = (i: number, d: 1 | -1) => (c: GridConfig) => moveColumn(c, i, d);
  protected readonly setType = (i: number, t: GridFieldType) => (c: GridConfig) => setColumnType(c, i, t);
  protected readonly renameOpt = (i: number, k: string, l: string) => (c: GridConfig) => renameOption(c, i, k, l);
  protected readonly removeOpt = (i: number, k: string) => (c: GridConfig) => removeOption(c, i, k);
  protected readonly rowHeader = (w: string) => (c: GridConfig) => setRowHeader(c, w);
  protected readonly renameRowAt = (i: number, l: string) => (c: GridConfig) => renameRow(c, i, l);
  protected readonly moveRowAt = (i: number, d: 1 | -1) => (c: GridConfig) => moveRow(c, i, d);
  protected readonly removeRowAt = (i: number) => (c: GridConfig) => removeRow(c, i);
  protected readonly span = (i: number, n: number) => (c: GridConfig) => setLabelSpan(c, i, n);
  protected readonly merge = (i: number, k: string) => (c: GridConfig) => mergeRight(c, i, k);
  protected readonly split = (i: number, k: string) => (c: GridConfig) => unmerge(c, i, k);
  protected readonly none = (i: number, k: string) => (c: GridConfig) => noBox(c, i, k);
  protected readonly restore = (i: number, k: string) => (c: GridConfig) => restoreBox(c, i, k);
  protected readonly heading = (i: number, p: { label?: string; from?: string; span?: number }) => (c: GridConfig) => updateHeading(c, i, p);
  protected readonly dropHeading = (i: number) => (c: GridConfig) => removeHeading(c, i);
  protected readonly newHeading = (c: GridConfig) => addHeading(c);
  protected readonly quickOn = (on: boolean) => (c: GridConfig) => setQuickFill(c, on);
  protected readonly preset = (i: number, p: { label?: string; value?: string; scope?: GridScope }) => (c: GridConfig) => updatePreset(c, i, p);
  protected readonly dropPreset = (i: number) => (c: GridConfig) => removePreset(c, i);
  protected readonly rowSentence = (row: string) => (c: GridConfig) => setSentences(c, { row });
  protected readonly separator = (rowSeparator: string) => (c: GridConfig) => setSentences(c, { rowSeparator });

  protected typeWords(c: GridField): string {
    const t = GRID_TYPES.find((x) => x.value === (c.type ?? 'text'))?.label ?? 'Words';
    if (c.type === 'choice') return `${t}: ${(c.options ?? []).map((o) => o.label).join(', ')}`;
    if (c.type === 'number' && c.unit) return `${t} in ${c.unit}`;
    return t;
  }

  protected renameColumn(i: number, label: string): void {
    const words = label.trim().slice(0, 80);
    if (words) this.edit((c) => updateColumn(c, i, (x) => (x.label = words)));
  }

  protected setCol(i: number, prop: keyof GridField, value: unknown): void {
    const v = typeof value === 'string' ? value.trim() : value;
    this.edit((c) =>
      updateColumn(c, i, (x) => {
        const o = x as unknown as Record<string, unknown>;
        if (v === '' || v === undefined || v === null) delete o[prop];
        else o[prop] = v;
      }),
    );
  }

  protected setDefault(i: number, c: GridField, text: string): void {
    const t = text.trim();
    if (c.type === 'number' && t !== '') {
      const n = Number(t.replace(',', '.'));
      if (!Number.isFinite(n)) {
        this.note.set('A number box starts with a number.');
        return;
      }
      this.setCol(i, 'default', n);
      return;
    }
    this.setCol(i, 'default', t);
  }

  protected defaultChoices(c: GridField): PfSelectOption<string>[] {
    return [{ value: '', label: 'Nothing' }, ...(c.options ?? []).map((o) => ({ value: o.key, label: o.label }))];
  }

  protected toggleInclude(i: number, c: GridField): void {
    const leaveOut = c.says?.include !== false;
    this.edit((cfg) =>
      updateColumn(cfg, i, (x) => {
        x.says = { ...(x.says ?? {}) };
        if (leaveOut) x.says.include = false;
        else delete x.says.include;
      }),
    );
  }

  protected setTemplate(i: number, template: string): void {
    this.edit((cfg) =>
      updateColumn(cfg, i, (x) => {
        x.says = { ...(x.says ?? {}) };
        if (template) x.says.template = template.slice(0, 300);
        else delete x.says.template;
      }),
    );
  }

  protected addCol(el: HTMLInputElement): void {
    const label = (el.value.trim() || `Column ${this.cfg().columns.length + 1}`).slice(0, 80);
    let added: string | null = null;
    const ok = this.edit((c) => {
      const next = addColumn(c, label);
      added = next === c ? null : (next.columns.at(-1)?.key ?? null);
      return next;
    }, gridLimitWords(this.cfg(), 'column') ?? '');
    if (ok) {
      el.value = '';
      this.openCol.set(added); // the new column opens
    }
  }

  protected addOpt(i: number, el: HTMLInputElement): void {
    if (this.edit((c) => addOption(c, i, el.value), gridLimitWords(this.cfg(), 'option', i) ?? '')) el.value = '';
  }

  protected addRowsFrom(el: HTMLTextAreaElement): void {
    const room = GRID_LIMITS.rows - this.cfg().rows.length;
    const labels = parseRowLabels(el.value, Math.max(0, room));
    if (!labels.length) {
      this.note.set(room <= 0 ? `A table has at most ${GRID_LIMITS.rows} rows.` : 'Type the rows first, e.g. 18-11.');
      return;
    }
    if (this.edit((c) => addRows(c, labels))) el.value = '';
  }

  protected addChip(el: HTMLInputElement): void {
    const refused = !el.value.trim()
      ? 'Type the chip first, e.g. All normal.'
      : (gridLimitWords(this.cfg(), 'preset') ?? `There is already a chip “${el.value.trim()}”.`);
    if (this.edit((c) => addPreset(c, el.value), refused)) el.value = '';
  }

  protected async askRemoveColumn(i: number, c: GridField): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Remove the column ${c.label}?`,
      message: 'Answers already given in it are no longer shown or printed.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (ok) {
      this.edit((cfg) => removeColumn(cfg, i));
      this.openCol.set(null);
    }
  }

  /** Is the row under a merged label above it? */
  protected underMerge(i: number): boolean {
    const rows = this.cfg().rows;
    for (let k = 0; k < i; k++) if ((rows[k].labelSpan ?? 1) > 1 && k + (rows[k].labelSpan ?? 1) - 1 >= i) return true;
    return false;
  }

  /** The row's cells, column by column, in plain words. */
  protected rowCells(i: number): RowCell[] {
    const cfg = this.cfg();
    let coveredTo = -1;
    return cfg.columns.map((col, ci) => {
      const o = cellOverride(cfg, i, col.key);
      const covered = ci <= coveredTo;
      const span = covered ? 1 : Math.min(o?.colSpan ?? 1, cfg.columns.length - ci);
      if (!covered && span > 1) coveredTo = ci + span - 1;
      const none = !covered && !!o?.fields && o.fields.length === 0;
      const own = !covered && !!o?.fields && o.fields.length > 0;
      const state = covered
        ? 'Part of the merged cell before it'
        : none
          ? 'No box'
          : own
            ? `Its own ${o!.fields!.length === 1 ? 'box' : `${o!.fields!.length} boxes`}`
            : span > 1
              ? `Spans ${span} columns`
              : 'The column’s box';
      return { key: col.key, label: col.label, state, covered, merged: span > 1, none, own, canMerge: !covered && ci + span < cfg.columns.length };
    });
  }
}

/** "32 rows · 3 columns · 1 merged heading · 2 Quick fill chips". */
export function gridSummary(cfg: GridConfig): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [n(cfg.rows.length, 'row', 'rows'), n(cfg.columns.length, 'column', 'columns')];
  if (cfg.headerGroups?.length) parts.push(n(cfg.headerGroups.length, 'merged heading', 'merged headings'));
  const chips = cfg.quickFill?.enabled === false ? 0 : (cfg.quickFill?.presets?.length ?? 0);
  if (chips) parts.push(n(chips, 'Quick fill chip', 'Quick fill chips'));
  return parts.join(' · ');
}

/**
 * Studio panel for `grid` (in the question's settings): what the table holds, the real table to try, and "Edit the
 * table" — the full-screen editor beside the preview.
 */
@Component({
  selector: 'fe-grid-panel',
  standalone: true,
  imports: [PfIconComponent, GridEditorComponent, GridTryoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-kpanel" data-kind-panel="grid">
      <h3 class="fe-kpanel__title">Table · {{ summary() }}</h3>
      <div class="fe-img__acts">
        <button type="button" class="pf-btn pf-btn--secondary" data-act="edit-table" (click)="editing.set(true)"><pf-icon name="k-grid" [size]="18" /> Edit the table</button>
      </div>
      <p class="fe-gedit__hint">Rows, columns, merged headings, Quick fill chips and the words it writes. Try it below; nothing is saved.</p>
      <div class="fe-gedit__mini"><fe-grid-tryout [field]="field()" /></div>
    </section>
    @if (editing()) {
      <fe-grid-editor [field]="field()" [apply]="apply()" (closed)="editing.set(false)" />
    }
  `,
})
export class GridPanelComponent extends GridEditing {
  protected readonly editing = signal(false);
  protected readonly summary = computed(() => gridSummary(this.cfg()));

  constructor() {
    super();
    // another question selected: close the editor
    let key = '';
    effect(() => {
      const k = this.field().key;
      if (key && k !== key) this.editing.set(false);
      key = k;
    });
  }
}
