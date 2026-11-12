import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FeDialog, PfIconComponent } from '../../kit';
import { isAnswered, withValue } from '../../core/pages';
import { lookupIn, isShown } from '../../core/rules';
import { Answers, FieldDef } from '../../core/types';
import { KindFill, injectLegacy } from '../../fill/contract';
import { FieldHostComponent } from '../../fill/field-host.component';

/**
 * repeat: a group of questions the doctor can add again and again (each
 * ulcer, each scar). Each repetition is a quiet card with its own fields;
 * "Add another" adds one (up to the form's limit); the bin removes one
 * (asks first when it holds answers). Rows that were never touched are not
 * saved: the form's default count only decides how many empty cards show.
 */
@Component({
  selector: 'fe-repeat-fill',
  standalone: true,
  imports: [FieldHostComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-rows" [class.fe-rows--legacy]="legacy()" role="group" [attr.aria-labelledby]="labelId()">
      @if (legacy()) {
        <!-- legacy recursive-input: the question and a count box on one row, then one block per count -->
        <div class="fe-countrow">
          <span class="fe-countrow__lbl">{{ field().label }}</span>
          <input
            type="number"
            class="fe-countrow__in"
            data-count="rows"
            [attr.min]="minCount()"
            [attr.max]="maxCount()"
            [attr.aria-label]="field().label"
            [value]="rows().length"
            [disabled]="disabled()"
            (input)="typeCount($any($event.target).value)"
          />
        </div>
      }
      @for (row of rows(); track $index; let i = $index) {
        <section class="fe-row" [attr.aria-label]="rowTitle(i)" [attr.data-row]="i">
          <header class="fe-row__head">
            <span class="fe-row__title">{{ rowTitle(i) }}</span>
            @if (rows().length > minCount() && legacy()) {
              <button
                type="button"
                class="fe-row__remove"
                [attr.aria-label]="'Remove ' + rowTitle(i)"
                [disabled]="disabled()"
                (click)="remove(i)"
              >
                <pf-icon name="x" [size]="14" />
                Remove
              </button>
            } @else if (rows().length > minCount()) {
              <button
                type="button"
                class="fe-iconbtn"
                [attr.aria-label]="'Remove ' + rowTitle(i)"
                [disabled]="disabled()"
                (click)="remove(i)"
              >
                <pf-icon name="trash" [size]="20" />
              </button>
            }
          </header>
          <div class="fe-grid">
            @for (c of shownChildren(row); track c.key) {
              <fe-field
                [field]="c"
                [scope]="row"
                [lookup]="rowLookup(row)"
                [setValue]="rowSetter(i)"
                [lockedKeys]="disabled() ? allChildKeys() : noKeys"
              />
            }
          </div>
        </section>
      }
      @if (rows().length < maxCount() && !legacy()) {
        <button type="button" class="pf-btn pf-btn--secondary fe-add" [disabled]="disabled()" (click)="add()">
          <pf-icon name="plus" [size]="18" />
          {{ rows().length ? 'Add another' : 'Add ' + prefix().toLowerCase() }}
        </button>
      }
    </div>
  `,
})
export class RepeatFill extends KindFill {
  private readonly dialog = inject(FeDialog);
  protected readonly legacy = injectLegacy();
  protected readonly noKeys: ReadonlySet<string> = new Set();

  protected readonly minCount = computed(() => (this.config()['minCount'] as number) ?? 0);
  protected readonly maxCount = computed(() => (this.config()['maxCount'] as number) ?? 10);
  private readonly defaultCount = computed(() => (this.config()['defaultCount'] as number) ?? 1);
  protected readonly prefix = computed(() => ((this.config()['labelPrefix'] as string) || this.field().label).trim());
  private readonly suffix = computed(() => ((this.config()['labelSuffix'] as string) ?? '').trim());
  protected readonly allChildKeys = computed(() => new Set((this.field().children ?? []).map((c) => c.key)));

  /** Saved rows, or the form's default number of empty cards. */
  protected readonly rows = computed<Answers[]>(() => {
    const v = this.value();
    if (Array.isArray(v)) return v.map((r) => (r && typeof r === 'object' ? (r as Answers) : {}));
    return Array.from(
      { length: Math.max(this.minCount(), Math.min(this.defaultCount(), this.maxCount())) },
      () => ({}),
    );
  });

  protected rowTitle(i: number): string {
    return [this.prefix(), String(i + 1), this.suffix()].filter(Boolean).join(' ');
  }

  protected shownChildren(row: Answers): FieldDef[] {
    const get = this.rowLookup(row);
    return (this.field().children ?? []).filter((c) => isShown(c.showWhen, get));
  }

  protected rowLookup(row: Answers) {
    return lookupIn(row, this.scope());
  }

  private readonly setters = new Map<number, (k: string, v: unknown) => void>();
  protected rowSetter(i: number): (k: string, v: unknown) => void {
    let s = this.setters.get(i);
    if (!s) {
      s = (k, v) => {
        const rows = this.rows().map((r, j) => (j === i ? withValue(r, k, v) : r));
        this.emit(rows);
      };
      this.setters.set(i, s);
    }
    return s;
  }

  /** Legacy count box: grow with empty blocks or cut from the end (the legacy box did not ask). */
  protected typeCount(raw: string): void {
    const n = parseInt(raw, 10);
    const count = Math.max(this.minCount(), Math.min(this.maxCount(), Number.isNaN(n) ? this.minCount() : n));
    const rows = this.rows().slice(0, count);
    while (rows.length < count) rows.push({});
    this.emit(rows);
  }

  protected add(): void {
    if (this.rows().length >= this.maxCount()) return;
    this.emit([...this.rows(), {}]);
  }

  protected async remove(i: number): Promise<void> {
    const row = this.rows()[i];
    if (Object.values(row).some(isAnswered)) {
      const ok = await this.dialog.confirm({
        title: `Remove ${this.rowTitle(i)}?`,
        message: 'Its answers will be removed from this case sheet.',
        confirmLabel: 'Remove',
        cancelLabel: 'Keep',
        tone: 'danger',
      });
      if (!ok) return;
    }
    const rows = this.rows().filter((_, j) => j !== i);
    this.emit(rows.length ? rows : undefined);
  }
}
