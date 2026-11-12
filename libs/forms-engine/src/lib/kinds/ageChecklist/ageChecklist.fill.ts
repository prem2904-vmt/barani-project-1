import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill, feId } from '../../fill/contract';
import { ageFromSheet, ageWords, toDays } from './age-text';
import { ChecklistItem, ItemAnswer, ItemState, resolveItems, stateOf } from './checklist-data';

/** The stored answer of an ageChecklist field (API "Checklist by age"). */
export interface AgeChecklistAnswer {
  ageDays?: number;
  items?: Record<string, ItemAnswer>;
  note?: string;
}

interface Row {
  item: ChecklistItem;
  state: ItemState;
  answer: ItemAnswer | undefined;
  hint: string;
}

interface Group {
  name: string;
  rows: Row[];
}

const UNITS: { value: 'years' | 'months' | 'weeks' | 'days'; label: string }[] = [
  { value: 'years', label: 'Years' },
  { value: 'months', label: 'Months' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'days', label: 'Days' },
];

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * ageChecklist (milestones / vaccines / own list): every line is "Yes" or "Not yet" (vaccines: "Given" / "Not given"). The age comes from the
 * sheet's age question unless the doctor sets it here; lines that start later are tucked away; a line that is late for the age is marked in words
 * (not only colour). "All done for this age" ticks every line shown, so only the exceptions need a tap.
 */
@Component({
  selector: 'fe-agechecklist-fill',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-fam fe-agec" role="group" [attr.aria-labelledby]="labelId()" [attr.data-preset]="preset()">
      <div class="fe-agec__age">
        @if (age() !== null && !editingAge()) {
          <span>Age <strong data-age>{{ ageText() }}</strong></span>
          <button type="button" class="fe-chip" data-act="change-age" [disabled]="disabled()" (click)="editingAge.set(true)">
            <pf-icon name="pen" [size]="16" /> Change age
          </button>
        } @else {
          <label class="fe-fam__k" [attr.for]="ageId">{{ age() === null ? 'How old is the patient?' : 'Age' }}</label>
          <input
            class="fe-text__input fe-agec__ageinput"
            type="text"
            inputmode="decimal"
            [id]="ageId"
            data-age-input
            [value]="ageNumber()"
            [disabled]="disabled()"
            (input)="ageNumber.set($any($event.target).value)"
          />
          <div class="fe-chips" role="radiogroup" aria-label="Unit of age">
            @for (u of units; track u.value) {
              <button type="button" class="fe-chip" role="radio" [attr.data-unit]="u.value" [attr.aria-checked]="ageUnit() === u.value" (click)="ageUnit.set(u.value)">
                {{ u.label }}
              </button>
            }
          </div>
          <button type="button" class="pf-btn pf-btn--primary" data-act="set-age" [disabled]="disabled() || !ageValid()" (click)="setAge()">
            <pf-icon name="check" [size]="18" /> Use this age
          </button>
        }
      </div>

      @if (!disabled()) {
        <div class="fe-fam__row">
          <button type="button" class="fe-chip" data-act="all-done" (click)="allDone()">
            <pf-icon name="check" [size]="16" /> All done for this age
          </button>
          @if (answered()) {
            <button type="button" class="fe-chip" data-act="clear" (click)="clear()"><pf-icon name="x" [size]="16" /> Clear</button>
          }
        </div>
      }

      @for (g of groups(); track g.name) {
        <section class="fe-agec__group" [attr.aria-label]="g.name || 'Items'">
          @if (g.name) {
            <h4 class="fe-agec__ghead">{{ g.name }}</h4>
          }
          @for (r of g.rows; track r.item.key) {
            <div class="fe-agec__item" [class.is-flagged]="r.state === 'flagged'" [attr.data-item]="r.item.key" [attr.data-state]="r.state">
              <div class="fe-agec__text">
                <span class="fe-agec__label">{{ r.item.label }}</span>
                @if (r.state === 'flagged') {
                  <span class="fe-agec__hint fe-agec__late">{{ preset() === 'vaccines' ? 'Overdue' : 'Later than expected' }}</span>
                } @else if (r.hint) {
                  <span class="fe-agec__hint">{{ r.hint }}</span>
                }
              </div>
              <div class="fe-agec__btns" role="radiogroup" [attr.aria-label]="r.item.label">
                <button type="button" class="fe-chip" role="radio" data-answer="done" [attr.aria-checked]="r.answer === 'done'" [disabled]="disabled()" (click)="tap(r.item.key, 'done')">
                  {{ yesWord() }}
                </button>
                <button type="button" class="fe-chip" role="radio" data-answer="notDone" [attr.aria-checked]="r.answer === 'notDone'" [disabled]="disabled()" (click)="tap(r.item.key, 'notDone')">
                  {{ noWord() }}
                </button>
              </div>
            </div>
          }
        </section>
      }

      @if (laterCount() > 0) {
        <button type="button" class="fe-chip" data-act="later" [attr.aria-pressed]="showLater()" (click)="showLater.set(!showLater())">
          {{ showLater() ? 'Hide' : 'Show' }} {{ laterCount() }} later {{ laterCount() === 1 ? 'item' : 'items' }}
        </button>
      }

      <div class="fe-fam__field">
        <label class="fe-fam__k" [attr.for]="noteId">Note (optional)</label>
        <input class="fe-text__input" type="text" [id]="noteId" data-note [value]="note()" [disabled]="disabled()" maxlength="500" (change)="setNote($any($event.target).value)" />
      </div>
    </div>
  `,
})
export class AgeChecklistFill extends KindFill {
  protected readonly units = UNITS;
  protected readonly ageId = feId('fe-agec-age');
  protected readonly noteId = feId('fe-agec-note');

  protected readonly editingAge = signal(false);
  protected readonly ageNumber = signal('');
  protected readonly ageUnit = signal<'years' | 'months' | 'weeks' | 'days'>('months');
  protected readonly showLater = signal(false);

  protected readonly preset = computed(() => String(this.config()['preset'] ?? 'milestones'));
  private readonly items = computed(() => resolveItems(this.config()));
  private readonly answer = computed<AgeChecklistAnswer>(() => (this.value() as AgeChecklistAnswer | null) ?? {});
  protected readonly answers = computed(() => this.answer().items ?? {});
  protected readonly note = computed(() => this.answer().note ?? '');
  protected readonly answered = computed(() => Object.keys(this.answers()).length > 0);

  /** The age: the one set here, else the sheet's own age question. */
  protected readonly age = computed<number | null>(() => {
    const own = this.answer().ageDays;
    if (typeof own === 'number') return own;
    const scope = this.scope();
    return ageFromSheet(
      { key: this.field().key, config: this.config() },
      Object.keys(scope).map((key) => ({ key, label: '' })),
      scope,
      today(),
    );
  });
  protected readonly ageText = computed(() => (this.age() === null ? '' : ageWords(this.age()!)));
  protected readonly ageValid = computed(() => {
    const n = Number(this.ageNumber());
    return this.ageNumber().trim() !== '' && Number.isFinite(n) && n >= 0 && toDays(n, this.ageUnit()) <= 43830;
  });

  protected readonly yesWord = computed(() => (this.preset() === 'vaccines' ? 'Given' : 'Yes'));
  protected readonly noWord = computed(() => (this.preset() === 'vaccines' ? 'Not given' : 'Not yet'));
  private readonly unsetIsMissing = computed(() => this.config()['unsetIsMissing'] === true);

  private readonly rows = computed<Row[]>(() => {
    const age = this.age();
    const a = this.answers();
    const vaccines = this.preset() === 'vaccines';
    return this.items().map((item) => {
      const answer = a[item.key];
      const state = stateOf(item, answer, age, this.unsetIsMissing());
      const hint =
        vaccines || item.flagDays <= 0
          ? (item.note ?? '')
          : `Expected by ${ageWords(item.flagDays)}`;
      return { item, state, answer, hint };
    });
  });

  protected readonly laterCount = computed(() => this.rows().filter((r) => r.state === 'later').length);

  protected readonly groups = computed<Group[]>(() => {
    const out: Group[] = [];
    for (const r of this.rows()) {
      if (r.state === 'later' && !this.showLater()) continue;
      let g = out.find((x) => x.name === r.item.group);
      if (!g) out.push((g = { name: r.item.group, rows: [] }));
      g.rows.push(r);
    }
    return out;
  });

  protected setAge(): void {
    if (!this.ageValid()) return;
    const days = toDays(Number(this.ageNumber()), this.ageUnit());
    this.editingAge.set(false);
    this.write({ ...this.answer(), ageDays: days });
  }

  protected tap(key: string, a: ItemAnswer): void {
    const items = { ...this.answers() };
    if (items[key] === a) delete items[key];
    else items[key] = a;
    this.write({ ...this.answer(), items });
  }

  protected allDone(): void {
    const items = { ...this.answers() };
    for (const r of this.rows()) if (r.state !== 'later' && !items[r.item.key]) items[r.item.key] = 'done';
    this.write({ ...this.answer(), items });
  }

  protected clear(): void {
    this.emit(undefined);
  }

  protected setNote(v: string): void {
    const note = v.trim();
    const { note: _old, ...rest } = this.answer();
    this.write(note ? { ...rest, note } : rest);
  }

  /** The first answer also stores the age that was used, so the case note says the same tomorrow. */
  private write(next: AgeChecklistAnswer): void {
    const items = next.items && Object.keys(next.items).length ? next.items : undefined;
    const age = next.ageDays ?? (items ? (this.age() ?? undefined) : undefined);
    const out: AgeChecklistAnswer = {};
    if (age !== undefined) out.ageDays = age;
    if (items) out.items = items;
    if (next.note) out.note = next.note;
    this.emit(Object.keys(out).length === 0 ? undefined : out);
  }
}
