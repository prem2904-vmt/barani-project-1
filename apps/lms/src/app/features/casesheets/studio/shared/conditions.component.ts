import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import {
  ConditionRow,
  ConditionSet,
  FormDefinition,
  ShowWhenDef,
  conditionSources,
  describeShowWhen,
  fromShowWhen,
  locate,
  opsFor,
  startRow,
  toShowWhen,
  valueChoices,
  withOp,
} from '@prefrontal/forms-engine';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';

/**
 * "Show when [Pain] [is] [Yes]", built by tapping. Each row: pick the
 * question, the words ("is", "includes", "is more than"), then the answer as
 * chips (or a number). Two or more rows ask "all of these / any of these".
 * Reads back as one sentence above the rows; stored as the structured rule.
 */
@Component({
  selector: 'st-conditions',
  standalone: true,
  imports: [PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cb" role="group" [attr.aria-label]="'When ' + subject() + ' shows'">
      <p class="cb-say" aria-live="polite">{{ sentence() }}</p>

      @if (set().rows.length) {
        <div class="cb-mode">
          <div class="cb-seg" role="radiogroup" aria-label="Show or hide">
            <button type="button" role="radio" class="cb-seg__b pf-touch" [attr.aria-checked]="set().visibility === 'show'" (click)="patch({ visibility: 'show' })">Show</button>
            <button type="button" role="radio" class="cb-seg__b pf-touch" [attr.aria-checked]="set().visibility === 'hide'" (click)="patch({ visibility: 'hide' })">Hide</button>
          </div>
          @if (set().rows.length > 1) {
            <span class="cb-k">when</span>
            <div class="cb-seg" role="radiogroup" aria-label="All or any">
              <button type="button" role="radio" class="cb-seg__b pf-touch" [attr.aria-checked]="set().match === 'all'" (click)="patch({ match: 'all' })">all of these</button>
              <button type="button" role="radio" class="cb-seg__b pf-touch" [attr.aria-checked]="set().match === 'any'" (click)="patch({ match: 'any' })">any of these</button>
            </div>
          }
        </div>
      }

      @for (r of set().rows; track $index; let i = $index) {
        <div class="cb-row" [attr.data-cond]="i">
          <pf-select
            class="cb-field"
            [options]="fieldOptions()"
            [value]="r.field"
            [searchable]="true"
            placeholder="Pick a question"
            (valueChange)="setField(i, $event)"
          />
          @if (r.field) {
            <pf-select class="cb-op" [options]="opOptions(r.field)" [value]="r.op" (valueChange)="setOp(i, $event)" />
            @let vc = choices(r.field);
            @if (needsValue(r)) {
              @if (vc.kind === 'number') {
                <input
                  class="pf-input cb-num"
                  type="text"
                  inputmode="decimal"
                  [attr.aria-label]="'Number for ' + labelOf(r.field)"
                  [value]="r.value ?? ''"
                  (change)="setValue(i, toNumber($any($event.target).value))"
                />
              } @else {
                <div class="cb-vals" role="radiogroup" [attr.aria-label]="'Answer of ' + labelOf(r.field)">
                  @for (o of vc.options; track o.value) {
                    <button
                      type="button"
                      role="radio"
                      class="fe-chip"
                      [attr.aria-checked]="o.value === r.value"
                      [attr.aria-pressed]="o.value === r.value"
                      (click)="setValue(i, o.value)"
                    >
                      {{ o.label }}
                    </button>
                  }
                </div>
              }
            }
          }
          <button type="button" class="pf-btn pf-btn--icon cb-x" [attr.aria-label]="'Remove this condition'" (click)="remove(i)">
            <pf-icon name="x" [size]="18" />
          </button>
        </div>
      }

      <div class="cb-foot">
        <button type="button" class="pf-btn pf-btn--secondary" (click)="add()">
          <pf-icon name="plus" [size]="18" /> {{ set().rows.length ? 'Add another condition' : 'Show only when…' }}
        </button>
        @if (set().rows.length) {
          <button type="button" class="pf-btn pf-btn--tertiary" (click)="clear()">Always show</button>
        }
        <span class="cb-spacer"></span>
        @if (showDone()) {
          <button type="button" class="pf-btn pf-btn--secondary" (click)="done.emit()"><pf-icon name="check" [size]="18" /> Done</button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .cb {
        display: grid;
        gap: 12px;
      }
      .cb-say {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .cb-mode {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .cb-k {
        color: var(--text-secondary);
      }
      .cb-seg {
        display: inline-flex;
        gap: 4px;
        padding: 4px;
        border-radius: 14px;
        background: var(--pf-chip-bg);
      }
      .cb-seg__b {
        padding: 0 16px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }
      .cb-seg__b[aria-checked='true'] {
        background: var(--pf-card-bg);
        color: var(--text-primary);
        box-shadow: 0 0 0 1px var(--pf-line), 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .cb-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        padding: 10px;
        border: 1px solid var(--pf-line);
        border-radius: 14px;
        background: var(--pf-card-bg);
      }
      .cb-field {
        flex: 1 1 220px;
        min-width: 0;
      }
      .cb-op {
        flex: 0 1 190px;
        min-width: 150px;
      }
      .cb-num {
        width: 120px;
      }
      .cb-vals {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        flex: 1 1 100%;
      }
      .cb-x {
        margin-left: auto;
      }
      .cb-foot {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .cb-spacer {
        flex: 1 1 auto;
      }
    `,
  ],
})
export class ConditionsComponent {
  readonly definition = input.required<FormDefinition>();
  /** The question (or null for a page) the rule belongs to. */
  readonly selfKey = input<string | null>(null);
  readonly subject = input('this question');
  readonly value = input<ShowWhenDef | null | undefined>(null);
  readonly changed = output<ShowWhenDef | null>();
  readonly done = output<void>();
  /** The settings panels keep the builder open all the time, so they have no Done. */
  readonly showDone = input(true);

  protected readonly set = signal<ConditionSet>({ rows: [], match: 'all', visibility: 'show' });

  constructor() {
    effect(() => this.set.set(fromShowWhen(this.value())));
  }

  protected readonly sentence = computed(() => describeShowWhen(this.definition(), toShowWhen(this.set())));

  protected readonly fieldOptions = computed<PfSelectOption<string>[]>(() =>
    conditionSources(this.definition(), this.selfKey()).map((f) => {
      const page = locate(this.definition(), f.key)?.page.title;
      return { value: f.key, label: f.label || 'Untitled question', hint: page };
    }),
  );

  protected opOptions(fieldKey: string): PfSelectOption<string>[] {
    return opsFor(this.definition(), fieldKey).map((o) => ({ value: o.op, label: o.words }));
  }

  protected choices(fieldKey: string) {
    return valueChoices(this.definition(), fieldKey);
  }

  protected labelOf(fieldKey: string): string {
    return this.fieldOptions().find((o) => o.value === fieldKey)?.label ?? 'the question';
  }

  protected needsValue(r: ConditionRow): boolean {
    return !opsFor(this.definition(), r.field).find((o) => o.op === r.op)?.noValue;
  }

  protected toNumber(v: string): number | string {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : v;
  }

  private commit(next: ConditionSet): void {
    this.set.set(next);
    this.changed.emit(toShowWhen(next));
  }

  protected patch(p: Partial<ConditionSet>): void {
    this.commit({ ...this.set(), ...p });
  }

  protected add(): void {
    const first = this.fieldOptions()[0]?.value ?? '';
    const row: ConditionRow = first ? startRow(this.definition(), first) : { field: '', op: 'equals' };
    this.commit({ ...this.set(), rows: [...this.set().rows, row] });
  }

  protected remove(i: number): void {
    this.commit({ ...this.set(), rows: this.set().rows.filter((_, j) => j !== i) });
  }

  protected clear(): void {
    this.commit({ ...this.set(), rows: [] });
  }

  private setRow(i: number, row: ConditionRow): void {
    this.commit({ ...this.set(), rows: this.set().rows.map((r, j) => (j === i ? row : r)) });
  }

  protected setField(i: number, key: string): void {
    this.setRow(i, startRow(this.definition(), key));
  }

  protected setOp(i: number, op: string): void {
    this.setRow(i, withOp(this.definition(), this.set().rows[i], op));
  }

  protected setValue(i: number, value: unknown): void {
    this.setRow(i, { ...this.set().rows[i], value });
  }
}
